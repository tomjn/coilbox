//! Generates the Zero-K lobby protocol types, and the dispatch that picks one of
//! them by command name, from the C# vendored under `upstream/`.
//!
//! Two outputs land in `OUT_DIR`:
//!
//! - `types.rs`, one Rust type per C# class or enum the protocol can reach.
//! - `dispatch.rs`, the `ZerokMessage` enum, its decoder, and the `Command`
//!   impls that give each command its wire name and direction.
//!
//! Only what a command can reach is generated. `IContentService.cs` is vendored
//! for three types the server pushes on connect, and the HTTP API around them is
//! left alone rather than turned into Rust nobody would call.
//!
//! Four rules decide whether the result is right, and every one of them is
//! settled by `CommandJsonSerializer` upstream rather than guessed at:
//!
//! - Its settings register no string converter, so an enum goes over the wire as
//!   a number.
//! - Json.NET writes a `DateTime` as an ISO 8601 string.
//! - `NullValueHandling.Ignore` drops a null member from the JSON entirely, so
//!   every reference member is optional in both directions.
//! - A computed property is not something the server can read back, so it is not
//!   carried.

#[path = "build/csharp.rs"]
mod csharp;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use csharp::{ClassDef, CsType, Direction, EnumDef, Member, Model, TypeDef};

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let upstream = manifest.join("upstream");
    println!("cargo:rerun-if-changed=build/csharp.rs");
    println!("cargo:rerun-if-changed=upstream/sources.txt");
    println!("cargo:rerun-if-changed=upstream/upstream-version.txt");

    let mut model = Model::default();
    for source in sources(&upstream) {
        let path = upstream.join(&source);
        println!("cargo:rerun-if-changed=upstream/{source}");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        model.read(&source, &text);
    }

    let plan = Plan::build(&model);
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set"));
    write_rust(&out.join("types.rs"), &plan.types(&model));
    write_rust(&out.join("dispatch.rs"), &plan.dispatch(&model));
}

/// The vendored files, in the order `sources.txt` lists them.
fn sources(upstream: &Path) -> Vec<String> {
    let list = upstream.join("sources.txt");
    std::fs::read_to_string(&list)
        .unwrap_or_else(|e| panic!("read {}: {e}", list.display()))
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

/// What to generate, and what to call each of it in Rust.
struct Plan {
    /// The types a command can reach, in declaration order.
    reachable: Vec<Vec<String>>,
    /// A C# path to the Rust name it is generated under.
    names: BTreeMap<Vec<String>, String>,
    /// The commands, as the wire name paired with its C# path.
    commands: Vec<(String, Vec<String>)>,
}

impl Plan {
    fn build(model: &Model) -> Plan {
        let mut commands = Vec::new();
        let mut wanted: BTreeSet<Vec<String>> = BTreeSet::new();
        let mut queue: Vec<Vec<String>> = Vec::new();
        for def in &model.types {
            if let TypeDef::Class(class) = def {
                if class.message.is_some() {
                    let name = class.path.last().expect("a class has a name").clone();
                    commands.push((name, class.path.clone()));
                    queue.push(class.path.clone());
                }
            }
        }
        assert!(
            !commands.is_empty(),
            "no class in the vendored sources carries [Message(...)], so either the attribute has \
             been renamed upstream or the reader has stopped seeing it"
        );

        // Walk out from the commands. A type nothing can reach is upstream's
        // business, not ours.
        while let Some(path) = queue.pop() {
            if !wanted.insert(path.clone()) {
                continue;
            }
            let Some(TypeDef::Class(class)) = model.resolve(&path, &[]) else {
                continue;
            };
            for member in &class.members {
                for reference in referenced(&member.ty) {
                    if let Some(def) = model.resolve(&reference, &class.path) {
                        queue.push(def.path().to_vec());
                    }
                }
            }
        }

        let reachable: Vec<Vec<String>> = model
            .types
            .iter()
            .map(|def| def.path().to_vec())
            .filter(|path| wanted.contains(path))
            .collect();

        // Short names read far better than the qualified ones, and nearly every
        // nested type has one going spare. Where two do not, both are qualified,
        // so which name a type has never depends on the order they are read in.
        let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
        for path in &reachable {
            *seen
                .entry(path.last().expect("a type has a name").as_str())
                .or_default() += 1;
        }
        let mut names: BTreeMap<Vec<String>, String> = BTreeMap::new();
        for path in &reachable {
            let short = path.last().expect("a type has a name");
            let name = if seen[short.as_str()] == 1 {
                short.clone()
            } else {
                path.concat()
            };
            if let Some(clash) = names.iter().find(|(_, taken)| *taken == &name) {
                panic!(
                    "{} and {} would both generate as {name}",
                    clash.0.join("."),
                    path.join(".")
                );
            }
            names.insert(path.clone(), name);
        }

        for (wire, _) in &commands {
            assert!(
                wire != "Unknown" && wire != "Invalid",
                "a command called {wire} would collide with ZerokMessage's own variant"
            );
        }

        Plan {
            reachable,
            names,
            commands,
        }
    }

    /// The Rust name of a type a member refers to, resolved from `from`.
    fn named(&self, model: &Model, reference: &[String], from: &[String]) -> Option<&String> {
        let def = model.resolve(reference, from)?;
        self.names.get(def.path())
    }

    fn types(&self, model: &Model) -> String {
        let mut out = String::from(
            "// Generated from the C# under `upstream/`. Do not edit. See build.rs.\n\n",
        );
        for path in &self.reachable {
            let def = model
                .resolve(path, &[])
                .expect("a reachable type is in the model");
            out.push_str(&match def {
                TypeDef::Class(class) => self.class(model, class),
                TypeDef::Enum(enumeration) => self.enumeration(enumeration),
            });
            out.push('\n');
        }
        out
    }

    fn class(&self, model: &Model, class: &ClassDef) -> String {
        let name = &self.names[&class.path];
        let mut out = docs(&class.docs, "");
        if !class.docs.is_empty() {
            out.push_str("///\n");
        }
        out.push_str(&format!(
            "/// `{}` in `{}`.\n",
            class.path.join("."),
            class.source
        ));
        out.push_str(
            "#[derive(Clone, Debug, Default, PartialEq, ::serde::Serialize, \
             ::serde::Deserialize)]\n#[serde(default)]\n",
        );
        out.push_str(&format!("pub struct {name} {{\n"));
        for member in &class.members {
            out.push_str(&self.field(model, class, member));
        }
        out.push_str("}\n");
        out
    }

    fn field(&self, model: &Model, class: &ClassDef, member: &Member) -> String {
        let (ty, optional) = self.rust_type(model, &member.ty, class);
        let ty = if optional {
            format!("Option<{ty}>")
        } else {
            ty
        };
        let mut out = docs(&member.docs, "    ");
        out.push_str(&format!("    #[serde(rename = \"{}\"", member.name));
        if optional {
            // What Json.NET's NullValueHandling.Ignore does, from this side.
            out.push_str(", skip_serializing_if = \"Option::is_none\"");
        }
        out.push_str(")]\n");
        out.push_str(&format!("    pub {}: {ty},\n", snake(&member.name)));
        out
    }

    /// The Rust type for a C# one, and whether it is optional on the wire.
    ///
    /// A reference type is optional whether or not it says so, because the
    /// server omits it when it is null. A value type is only optional when C#
    /// marks it nullable, because 0 and false are written like any other value.
    fn rust_type(&self, model: &Model, ty: &CsType, class: &ClassDef) -> (String, bool) {
        match ty {
            CsType::Object => ("::serde_json::Value".to_string(), true),
            CsType::List(item) | CsType::Array(item) => {
                if **item
                    == (CsType::Named {
                        path: vec!["byte".to_string()],
                        nullable: false,
                    })
                {
                    panic!(
                        "{}.{} is a byte array, which Json.NET writes as base64 rather than a \
                         list, and no command needed one until now",
                        class.path.join("."),
                        class.source
                    );
                }
                let (item, _) = self.rust_type(model, item, class);
                // An element is never optional. Nothing upstream puts a null in
                // a list, and one arriving is a parse failure the caller sees
                // rather than a field that silently reads as absent.
                (format!("Vec<{item}>"), true)
            }
            CsType::Dict(key, value) => {
                assert!(
                    **key
                        == (CsType::Named {
                            path: vec!["string".to_string()],
                            nullable: false,
                        }),
                    "{} has a dictionary keyed by {key:?} rather than a string, which is not a \
                     JSON object",
                    class.path.join(".")
                );
                let (value, _) = self.rust_type(model, value, class);
                (
                    format!("::std::collections::BTreeMap<String, {value}>"),
                    true,
                )
            }
            CsType::Unsupported(written) => panic!(
                "{} has a member typed {written}, a generic this reader has no mapping for",
                class.path.join(".")
            ),
            CsType::Named { path, nullable } => {
                if let Some(builtin) = builtin(path) {
                    return (builtin.name.to_string(), *nullable || builtin.reference);
                }
                match model.resolve(path, &class.path) {
                    Some(TypeDef::Class(_)) => {
                        let name = self
                            .named(model, path, &class.path)
                            .expect("a resolved class is in the plan");
                        (name.clone(), true)
                    }
                    Some(TypeDef::Enum(_)) => {
                        let name = self
                            .named(model, path, &class.path)
                            .expect("a resolved enum is in the plan");
                        (name.clone(), *nullable)
                    }
                    None => panic!(
                        "{} refers to {}, which none of the vendored files declares. Add the file \
                         that does to upstream/sources.txt and re-run scripts/zerok-refresh.sh, \
                         or the member cannot be typed.",
                        class.path.join("."),
                        path.join(".")
                    ),
                }
            }
        }
    }

    fn enumeration(&self, enumeration: &EnumDef) -> String {
        let name = &self.names[&enumeration.path];
        assert!(
            !enumeration.values.iter().any(|value| value.name == "Other"),
            "{} already has a value called Other, which the catch-all variant needs",
            enumeration.path.join(".")
        );
        let mut numbers = BTreeSet::new();
        for value in &enumeration.values {
            assert!(
                numbers.insert(value.number),
                "{} gives {} the number {}, which another value already has, so the two cannot \
                 both be read back",
                enumeration.path.join("."),
                value.name,
                value.number
            );
        }

        let mut out = docs(&enumeration.docs, "");
        if !enumeration.docs.is_empty() {
            out.push_str("///\n");
        }
        out.push_str(&format!(
            "/// `{}` in `{}`.\n///\n",
            enumeration.path.join("."),
            enumeration.source
        ));
        out.push_str(
            "/// Zero-K sends this as a number. A number this list does not name arrives as\n\
             /// `Other` holding it, so a server ahead of the pinned commit costs one field\n\
             /// rather than the whole message.\n",
        );
        if enumeration.flags {
            out.push_str(
                "///\n/// Upstream marks this `[Flags]`, so the number can be values added \
                 together.\n/// Any combination arrives as `Other`.\n",
            );
        }
        out.push_str(
            "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, ::serde::Serialize, \
             ::serde::Deserialize)]\n#[serde(from = \"i32\", into = \"i32\")]\n",
        );
        out.push_str(&format!("pub enum {name} {{\n"));
        for value in &enumeration.values {
            out.push_str(&docs(&value.docs, "    "));
            if let Some(text) = &value.description {
                out.push_str(&format!("    /// Upstream labels this \"{text}\".\n"));
            }
            out.push_str(&format!("    {},\n", value.name));
        }
        out.push_str("    /// A number the pinned commit does not name, kept so it survives a\n");
        out.push_str("    /// round trip.\n    Other(i32),\n}\n\n");

        out.push_str(&format!("impl From<i32> for {name} {{\n    fn from(number: i32) -> Self {{\n        match number {{\n"));
        for value in &enumeration.values {
            out.push_str(&format!(
                "            {} => Self::{},\n",
                value.number, value.name
            ));
        }
        out.push_str("            other => Self::Other(other),\n        }\n    }\n}\n\n");

        out.push_str(&format!(
            "impl From<{name}> for i32 {{\n    fn from(value: {name}) -> Self {{\n        match \
             value {{\n"
        ));
        for value in &enumeration.values {
            out.push_str(&format!(
                "            {name}::{} => {},\n",
                value.name, value.number
            ));
        }
        out.push_str("            ");
        out.push_str(&format!(
            "{name}::Other(other) => other,\n        }}\n    }}\n}}\n\n"
        ));

        // C# leaves an enum member at 0 when nothing sets it, so that is what an
        // absent one has to read as.
        out.push_str(&format!(
            "impl Default for {name} {{\n    fn default() -> Self {{\n        Self::from(0)\n    \
             }}\n}}\n"
        ));

        // Upstream's `[Description]` is the wording it shows a person, and for a
        // refusal code it is the only wording there is. Generated rather than
        // transcribed, so a reworded reason arrives with the next refresh.
        if enumeration.values.iter().any(|v| v.description.is_some()) {
            out.push_str(&format!(
                "\nimpl {name} {{\n    /// The label upstream gives this value, from its \
                 `[Description]`.\n    /// `None` for a value it does not label, and for a number \
                 it does not name.\n    pub fn description(self) -> Option<&'static str> {{\n     \
                    match self {{\n"
            ));
            for value in &enumeration.values {
                let answer = value.description.as_ref().map_or_else(
                    || "None".to_string(),
                    |text| format!("Some({:?})", text.as_str()),
                );
                out.push_str(&format!("            Self::{} => {answer},\n", value.name));
            }
            out.push_str("            Self::Other(_) => None,\n        }\n    }\n}\n");
        }
        out
    }

    fn dispatch(&self, model: &Model) -> String {
        let mut variants = String::new();
        let mut arms = String::new();
        let mut names = String::new();
        let mut impls = String::new();
        let mut table = String::new();

        for (wire, path) in &self.commands {
            let rust = &self.names[path];
            let Some(TypeDef::Class(class)) = model.resolve(path, &[]) else {
                unreachable!("a command is a class");
            };
            let direction = match class.message.expect("a command carries [Message]") {
                Direction::Server => "Server",
                Direction::Client => "Client",
                Direction::Both => "Both",
            };
            variants.push_str(&format!(
                "    /// `{wire}`, which {}.\n    {wire}(crate::types::{rust}),\n",
                match direction {
                    "Server" => "only the server sends",
                    "Client" => "only a client sends",
                    _ => "either side sends",
                }
            ));
            arms.push_str(&format!(
                "            \"{wire}\" => ::serde_json::from_str::<crate::types::{rust}>(body)\n \
                 .map(ZerokMessage::{wire}),\n"
            ));
            names.push_str(&format!(
                "            ZerokMessage::{wire}(_) => \"{wire}\",\n"
            ));
            impls.push_str(&format!(
                "impl crate::Command for crate::types::{rust} {{\n    const NAME: &'static str = \
                 \"{wire}\";\n    const DIRECTION: crate::Direction = \
                 crate::Direction::{direction};\n}}\n\n"
            ));
            table.push_str(&format!(
                "    (\"{wire}\", crate::Direction::{direction}),\n"
            ));
        }

        format!(
            r#"// Generated from the C# under `upstream/`. Do not edit. See build.rs.

/// One parsed Zero-K message, one variant per command.
///
/// A command this build does not know is [`ZerokMessage::Unknown`] rather than an
/// error, because Zero-K's server is free to be ahead of the pinned commit and a
/// line we cannot read is still a line we can show in the protocol console.
#[derive(Clone, Debug, PartialEq)]
pub enum ZerokMessage {{
{variants}    /// The name is not one this build knows.
    Unknown {{ name: String, body: String }},
    /// The name is known but the JSON does not fit the generated type. Usually
    /// means the server has moved on from the pinned commit.
    Invalid {{ name: String, body: String, error: String }},
}}

impl ZerokMessage {{
    /// Decode one command by name. Total: an unreadable message comes back as
    /// [`ZerokMessage::Unknown`] or [`ZerokMessage::Invalid`] rather than an
    /// `Err`, so a caller never has to decide what to do with a line it cannot
    /// parse beyond showing it.
    pub fn decode(name: &str, body: &str) -> ZerokMessage {{
        let decoded = match name {{
{arms}            _ => {{
                return ZerokMessage::Unknown {{
                    name: name.to_string(),
                    body: body.to_string(),
                }}
            }}
        }};
        match decoded {{
            Ok(message) => message,
            Err(error) => ZerokMessage::Invalid {{
                name: name.to_string(),
                body: body.to_string(),
                error: error.to_string(),
            }},
        }}
    }}

    /// The command name this message came in under.
    pub fn name(&self) -> &str {{
        match self {{
{names}            ZerokMessage::Unknown {{ name, .. }} => name,
            ZerokMessage::Invalid {{ name, .. }} => name,
        }}
    }}
}}

/// Every command the pinned commit declares, with the side that sends it.
pub const COMMANDS: &[(&str, crate::Direction)] = &[
{table}];

{impls}"#
        )
    }
}

/// Every named type a C# type refers to, as written.
fn referenced(ty: &CsType) -> Vec<Vec<String>> {
    match ty {
        CsType::Named { path, .. } => vec![path.clone()],
        CsType::List(item) | CsType::Array(item) => referenced(item),
        CsType::Dict(key, value) => {
            let mut out = referenced(key);
            out.extend(referenced(value));
            out
        }
        CsType::Object | CsType::Unsupported(_) => Vec::new(),
    }
}

/// A C# type the CLR provides, and how it lands in Rust.
struct Builtin {
    name: &'static str,
    /// Whether it is a reference type, which the server omits when it is null.
    reference: bool,
}

fn builtin(path: &[String]) -> Option<Builtin> {
    let (name, reference) = match path.join(".").as_str() {
        "string" | "String" => ("String", true),
        "bool" | "Boolean" => ("bool", false),
        "sbyte" => ("i8", false),
        "byte" => ("u8", false),
        "short" | "Int16" => ("i16", false),
        "ushort" | "UInt16" => ("u16", false),
        "int" | "Int32" => ("i32", false),
        "uint" | "UInt32" => ("u32", false),
        "long" | "Int64" => ("i64", false),
        "ulong" | "UInt64" => ("u64", false),
        "float" | "Single" => ("f32", false),
        "double" | "Double" => ("f64", false),
        // Json.NET writes a DateTime as ISO 8601. It stays a string here because
        // the kind is round-tripped: a UTC one ends in `Z`, a local one carries
        // an offset, and an unspecified one carries neither, so a type that
        // insists on RFC 3339 would refuse the third.
        "DateTime" | "TimeSpan" | "Guid" => ("String", false),
        _ => return None,
    };
    Some(Builtin { name, reference })
}

/// Rust doc lines for a set of C# ones, indented to sit with what they document.
fn docs(lines: &[String], indent: &str) -> String {
    lines
        .iter()
        .map(|line| {
            if line.is_empty() {
                format!("{indent}///\n")
            } else {
                format!("{indent}/// {line}\n")
            }
        })
        .collect()
}

/// C# `PascalCase` as Rust `snake_case`, keeping runs of capitals together so
/// `SteamID` reads as `steam_id` rather than `steam_i_d`.
fn snake(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let mut out = String::new();
    for (at, &c) in chars.iter().enumerate() {
        if c.is_uppercase() && at > 0 {
            let after_lower = chars[at - 1].is_lowercase() || chars[at - 1].is_ascii_digit();
            let starts_word = chars[at - 1].is_uppercase()
                && chars.get(at + 1).is_some_and(|next| next.is_lowercase());
            if after_lower || starts_word {
                out.push('_');
            }
        }
        out.extend(c.to_lowercase());
    }
    if KEYWORDS.contains(&out.as_str()) {
        return format!("r#{out}");
    }
    out
}

/// Rust keywords a field name has to be escaped past. The three that cannot be
/// raw identifiers are left out, because a member named for one of them would
/// need a rename rather than an escape, and none exists to rename.
const KEYWORDS: &[&str] = &[
    "abstract", "as", "async", "await", "become", "box", "break", "const", "continue", "do", "dyn",
    "else", "enum", "extern", "false", "final", "fn", "for", "if", "impl", "in", "let", "loop",
    "macro", "match", "mod", "move", "mut", "override", "priv", "pub", "ref", "return", "static",
    "struct", "trait", "true", "try", "type", "typeof", "unsafe", "unsized", "use", "virtual",
    "where", "while", "yield",
];

/// Writes Rust source, formatted, so a compiler error in generated code points
/// at something readable.
fn write_rust(out: &Path, source: &str) {
    let parsed: syn::File = syn::parse_str(source).unwrap_or_else(|e| {
        // The unformatted text is the only way to see what went wrong, because
        // there is no file to look at yet.
        let _ = std::fs::write(out.with_extension("broken.rs"), source);
        panic!(
            "the generated code does not parse: {e}. It has been written to {} to look at.",
            out.with_extension("broken.rs").display()
        )
    });
    std::fs::write(out, prettyplease::unparse(&parsed)).expect("write the generated code");
}
