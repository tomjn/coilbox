//! Generates the Tachyon protocol types, and the dispatch table that picks one
//! of them, from the vendored JSON Schema bundle.
//!
//! Two outputs land in `OUT_DIR`:
//!
//! - `types.rs`, everything typify makes of `schema/compiled.json`.
//! - `dispatch.rs`, the `TachyonMessage` enum and its decoder, one entry per
//!   member of the bundle's top-level `anyOf`.
//!
//! The dispatch is generated rather than hand-written because the bundle holds
//! 166 commands. A hand-written match of that size would be wrong within one
//! schema refresh, and it would be wrong silently.

use std::collections::BTreeMap;
use std::path::PathBuf;

/// Marks the local patch described in `schema/README.md`.
const PATCH_MARKER: &str = "x-coilbox-patched";

/// Commands that decode into a hand-written type rather than the generated one,
/// keyed on the schema title.
///
/// `lobby/updated` is an RFC 7386 merge patch, where a field set to `null`
/// means remove and a field left out means leave alone. Typify writes both as
/// `Option<T>`, so the generated type cannot tell them apart. See
/// `src/merge_patch.rs`.
const OVERRIDES: &[(&str, &str)] =
    &[("LobbyUpdatedEvent", "crate::merge_patch::LobbyUpdatedEvent")];

fn main() {
    let schema_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schema/compiled.json");
    println!("cargo:rerun-if-changed={}", schema_path.display());

    let text = std::fs::read_to_string(&schema_path).expect("read the vendored schema");
    check_patch(&text);

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set"));
    write_types(&text, &out_dir.join("types.rs"));
    write_dispatch(&text, &out_dir.join("dispatch.rs"));
}

/// Fails the build if a re-vendored bundle has lost the `privateBattle.ip` patch.
fn check_patch(text: &str) {
    if text.contains(PATCH_MARKER) {
        return;
    }
    panic!(
        "the vendored schema has lost the privateBattle.ip patch. The upstream spec types the \
         game server's IP address as a UUID, so battle/start cannot be parsed without it. \
         Re-apply the patch described in crates/coilbox-tachyon-protocol/schema/README.md, or \
         delete this check if upstream has fixed it."
    );
}

fn write_types(text: &str, out: &PathBuf) {
    let schema: schemars::schema::RootSchema =
        serde_json::from_str(text).expect("parse the schema as draft-07");

    let mut space = typify::TypeSpace::new(&typify::TypeSpaceSettings::default());
    space
        .add_root_schema(schema)
        .expect("turn the schema into a type space");

    write_rust(out, &space.to_stream().to_string());
}

/// One member of the bundle's top-level `anyOf`, which is one Tachyon command
/// in one direction.
struct Command {
    /// The schema title, which is also the generated type name.
    title: String,
    /// `type` in the envelope: `request`, `response` or `event`.
    kind: String,
}

fn write_dispatch(text: &str, out: &PathBuf) {
    let bundle: serde_json::Value = serde_json::from_str(text).expect("parse the schema as JSON");
    let members = bundle["anyOf"]
        .as_array()
        .expect("the bundle is a top-level anyOf");

    // Keyed on the pair the envelope carries, which is unique across the bundle.
    let mut commands: BTreeMap<(String, String), Command> = BTreeMap::new();
    for member in members {
        let title = member["title"]
            .as_str()
            .expect("every member has a title")
            .to_string();
        // A response is itself an anyOf of a success and a failure schema, which
        // share the command id and the type. Either one answers for both.
        let shape = member.get("anyOf").map_or(member, |any| &any[0]);
        let props = &shape["properties"];
        let command_id = props["commandId"]["const"]
            .as_str()
            .expect("every member pins a command id")
            .to_string();
        let kind = props["type"]["const"]
            .as_str()
            .expect("every member pins a type")
            .to_string();
        let previous = commands.insert(
            (command_id.clone(), kind.clone()),
            Command {
                title,
                kind: kind.clone(),
            },
        );
        assert!(
            previous.is_none(),
            "two schemas share the command id {command_id} and the type {kind}, so the envelope \
             cannot tell them apart"
        );
    }

    let mut variants = String::new();
    let mut arms = String::new();
    for ((command_id, _), command) in &commands {
        let title = &command.title;
        let path = decoded_type(title);
        let kind = match command.kind.as_str() {
            "request" => "Request",
            "response" => "Response",
            "event" => "Event",
            other => panic!("unexpected envelope type {other}"),
        };
        variants.push_str(&format!(
            "    /// `{command_id}`, as a {}.\n    {title}({path}),\n",
            command.kind
        ));
        arms.push_str(&format!(
            "            (\"{command_id}\", MessageKind::{kind}) => ::serde_json::from_str::\
             <{path}>(raw).map(TachyonMessage::{title}),\n"
        ));
    }

    let source = format!(
        r#"
/// A parsed Tachyon message, one variant per command and direction.
///
/// Every variant holds the generated type for the whole message, envelope
/// fields included, because that is the unit typify names after the schema
/// title. A response variant is an enum over the success and failure shapes,
/// so a typed failure reason comes out of the same value.
#[derive(Clone, Debug)]
pub enum TachyonMessage {{
{variants}    /// The frame is not a Tachyon envelope, or it names a command this
    /// schema does not have.
    Unknown {{ raw: String }},
    /// The envelope is fine and the command is known, but the body does not
    /// match the schema. Usually means the server has moved on from the
    /// vendored bundle.
    Invalid {{ command_id: String, raw: String, error: String }},
}}

impl TachyonMessage {{
    /// Decodes the body for a known command. `None` means the command id and
    /// type pair is not in the schema.
    fn decode(
        envelope: &Envelope,
        raw: &str,
    ) -> Option<Result<TachyonMessage, ::serde_json::Error>> {{
        let decoded = match (envelope.command_id.as_str(), envelope.kind) {{
{arms}            _ => return None,
        }};
        Some(decoded)
    }}
}}
"#
    );

    write_rust(out, &source);
}

/// The type a command decodes into, generated unless [`OVERRIDES`] names it.
fn decoded_type(title: &str) -> String {
    OVERRIDES
        .iter()
        .find(|(schema_title, _)| *schema_title == title)
        .map_or_else(
            || format!("crate::types::{title}"),
            |(_, path)| (*path).to_string(),
        )
}

/// Writes Rust source, formatted, so a compiler error in generated code points
/// at something readable.
fn write_rust(out: &PathBuf, source: &str) {
    let parsed: syn::File = syn::parse_str(source).expect("generated code parses");
    std::fs::write(out, prettyplease::unparse(&parsed)).expect("write the generated code");
}
