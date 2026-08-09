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

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Marks the local patch described in `schema/README.md`.
const PATCH_MARKER: &str = "x-coilbox-patched";

/// Every field in the bundle that is both optional and nullable, recorded so
/// that a schema refresh adding one has to be looked at. See
/// [`check_nullable_optional`].
const NULLABLE_OPTIONAL: &str = "schema/nullable-optional.txt";

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
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let schema_path = manifest.join("schema/compiled.json");
    println!("cargo:rerun-if-changed={}", schema_path.display());

    let text = std::fs::read_to_string(&schema_path).expect("read the vendored schema");
    check_patch(&text);
    check_nullable_optional(&text, &manifest);

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

/// Fails the build when the bundle holds an optional and nullable field that
/// [`NULLABLE_OPTIONAL`] does not already list.
///
/// Typify writes both "the field is absent" and "the field is present and null"
/// as `Option<T>`, so a generated type cannot tell leave alone from remove.
/// That is the whole reason `lobby/updated` is hand written, and a field
/// arriving with a schema refresh would generate quietly and read wrongly. The
/// recorded list turns that into a build failure.
fn check_nullable_optional(text: &str, manifest: &Path) {
    let bundle: serde_json::Value = serde_json::from_str(text).expect("parse the schema as JSON");
    let mut found = BTreeSet::new();
    for member in bundle["anyOf"]
        .as_array()
        .expect("the bundle is a top-level anyOf")
    {
        let title = member["title"].as_str().expect("every member has a title");
        walk(member, title, &mut found);
    }
    for (name, definition) in bundle["definitions"]
        .as_object()
        .expect("the bundle has shared definitions")
    {
        walk(definition, name, &mut found);
    }

    let path = manifest.join(NULLABLE_OPTIONAL);
    println!("cargo:rerun-if-changed={}", path.display());
    let recorded: BTreeSet<String> = std::fs::read_to_string(&path)
        .expect("read the recorded optional and nullable fields")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect();

    let new: Vec<&String> = found.difference(&recorded).collect();
    let gone: Vec<&String> = recorded.difference(&found).collect();
    assert!(
        new.is_empty() && gone.is_empty(),
        "the bundle's optional and nullable fields have moved.\n  new: {new:#?}\n  gone: \
         {gone:#?}\nFor each new one, absent and null mean different things on the wire and the \
         generated Option<T> cannot tell them apart. Decide whether the command needs a \
         hand-written type in src/merge_patch.rs with an OVERRIDES entry, then record the field \
         in {NULLABLE_OPTIONAL}."
    );
}

/// Records every field of `node` that is optional and nullable, then walks into
/// each field's own schema. A `$ref` is not followed, because the definition it
/// points at is walked on its own.
fn walk(node: &serde_json::Value, path: &str, found: &mut BTreeSet<String>) {
    if let Some(properties) = node
        .get("properties")
        .and_then(serde_json::Value::as_object)
    {
        let required = node.get("required").and_then(serde_json::Value::as_array);
        for (name, schema) in properties {
            let field = format!("{path}.{name}");
            let required = required
                .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(name.as_str())));
            if !required && is_nullable(schema) {
                found.insert(field.clone());
            }
            walk(schema, &field, found);
        }
    }
    // A member of one of these is the same field, so the path does not grow.
    for key in ["anyOf", "allOf", "oneOf"] {
        if let Some(members) = node.get(key).and_then(serde_json::Value::as_array) {
            for member in members {
                walk(member, path, found);
            }
        }
    }
    if let Some(items) = node.get("items") {
        walk(items, &format!("{path}[]"), found);
    }
    if let Some(patterned) = node
        .get("patternProperties")
        .and_then(serde_json::Value::as_object)
    {
        for schema in patterned.values() {
            walk(schema, &format!("{path}.*"), found);
        }
    }
}

/// Whether the schema admits null, either as one arm of an `anyOf` or as one of
/// a list of types.
fn is_nullable(schema: &serde_json::Value) -> bool {
    if schema["type"].as_str() == Some("null") {
        return true;
    }
    if let Some(types) = schema["type"].as_array() {
        if types.iter().any(|name| name.as_str() == Some("null")) {
            return true;
        }
    }
    ["anyOf", "oneOf"].iter().any(|key| {
        schema[*key]
            .as_array()
            .is_some_and(|members| members.iter().any(is_nullable))
    })
}

fn write_types(text: &str, out: &PathBuf) {
    let mut bundle: serde_json::Value =
        serde_json::from_str(text).expect("parse the schema as JSON");
    let loosened = loosen_failure_reasons(&mut bundle);
    assert!(
        loosened > 0,
        "no failed response in the bundle has an enum of reasons, so either the shape of a \
         response has changed or this transform no longer finds them. See \
         loosen_failure_reasons."
    );

    let schema: schemars::schema::RootSchema =
        serde_json::from_value(bundle).expect("parse the schema as draft-07");

    let mut space = typify::TypeSpace::new(&typify::TypeSpaceSettings::default());
    space
        .add_root_schema(schema)
        .expect("turn the schema into a type space");

    write_rust(out, &space.to_stream().to_string());
}

/// Turns each failed response's `reason` from a closed enum into a plain string,
/// and reports how many it changed.
///
/// Teiserver is free to be ahead of the vendored bundle, and a reason we have
/// never heard of is still a reason we can show. A generated enum cannot read
/// one, so the whole response would fail to parse and a legible refusal would
/// arrive as an unreadable frame. That is the failure this loses.
///
/// Nothing is given up by it. The reasons are inlined per command, so typify
/// makes 68 near-duplicate enums out of them whose names move on every schema
/// refresh, which is why `tachyon_rpc.rs` matches a reason by its wire value
/// rather than by type. A string is what that code wants anyway.
fn loosen_failure_reasons(node: &mut serde_json::Value) -> usize {
    let mut loosened = 0;

    if let Some(properties) = node
        .get_mut("properties")
        .and_then(serde_json::Value::as_object_mut)
    {
        let failed = properties
            .get("status")
            .is_some_and(|status| status["const"].as_str() == Some("failed"));
        if failed {
            if let Some(reason) = properties.get_mut("reason") {
                if reason.get("enum").is_some() {
                    *reason = serde_json::json!({ "type": "string" });
                    loosened += 1;
                }
            }
        }
    }

    match node {
        serde_json::Value::Object(fields) => {
            for value in fields.values_mut() {
                loosened += loosen_failure_reasons(value);
            }
        }
        serde_json::Value::Array(members) => {
            for member in members {
                loosened += loosen_failure_reasons(member);
            }
        }
        _ => {}
    }
    loosened
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

    // A refresh that renames a schema would otherwise leave the override
    // pointing at nothing, and the command would quietly go back to the
    // generated type.
    for (title, path) in OVERRIDES {
        assert!(
            commands.values().any(|command| command.title == *title),
            "OVERRIDES decodes {title} into {path}, but no schema in the bundle has that title, \
             so the hand-written type is unreachable"
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
