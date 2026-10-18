//! Finds the Lua an old game wrote against an engine API that has since been
//! removed or changed (issue #4553).
//!
//! The list of names comes from the catalogue in
//! `src/data/engineLuaCompat.json` (issue #4552). [`scan`] tokenises one Lua
//! 5.1 source and reports every use of a name in it. It evaluates nothing, so a
//! name built at run time (`Spring["Get" .. x]`) is not seen.
//!
//! Two shapes are matched:
//!
//! - A member chain such as `Spring.GetUnitTravel` or `UnitDefs.canCapture`,
//!   wherever it is written: called, assigned to a local, or passed on. The
//!   whole chain has to match, so `MySpring.GetUnitTravel` and
//!   `obj.Spring.GetUnitTravel` do not.
//! - A call-in such as `UnitDamaged`, where the code defines it: `function
//!   gadget:UnitDamaged(`, `function UnitDamaged(`, or `gadget.UnitDamaged =`.
//!   A call-in is a name the engine calls, so calling it is not a use.
//!
//! A definition of a chain (`function Spring.GetUnitTravel()`) is not a use
//! either. It is a game supplying the function itself.
//!
//! Comments and strings never produce a hit. Catalogue entries of kind `file`
//! are names of files, not of Lua, and are not matched here.

mod lex;

use lex::{lex, Kind, Token};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// The catalogue the app ships, read once. Embedded rather than passed in: the
/// worker that scans runs apart from the webview and has no other way to reach
/// the file, and building it in means the scanner and the catalogue it was
/// tested against cannot drift apart.
static EMBEDDED: &str = include_str!("../../../src/data/engineLuaCompat.json");

#[derive(Deserialize)]
struct File {
    entries: Vec<RawEntry>,
}

#[derive(Deserialize)]
struct RawEntry {
    id: String,
    kind: String,
    name: String,
}

/// The names to look for, from the catalogue.
#[derive(Debug, Default)]
pub struct Catalogue {
    /// Entry ids by dotted chain, such as `Spring.GetUnitTravel`.
    chains: HashMap<String, Vec<String>>,
    /// Entry ids by bare call-in name, such as `UnitDamaged`.
    call_ins: HashMap<String, Vec<String>>,
}

impl Catalogue {
    /// Read a catalogue from the JSON `scripts/build-engine-lua-compat.mjs`
    /// writes. Only each entry's `id`, `kind` and `name` are used.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let file: File = serde_json::from_str(json)?;
        let mut out = Catalogue::default();
        for entry in file.entries {
            if entry.kind == "file" {
                continue;
            }
            let map = if entry.name.contains('.') {
                &mut out.chains
            } else {
                &mut out.call_ins
            };
            map.entry(entry.name).or_default().push(entry.id);
        }
        Ok(out)
    }

    /// The catalogue built into this crate.
    pub fn embedded() -> &'static Catalogue {
        static PARSED: OnceLock<Catalogue> = OnceLock::new();
        PARSED.get_or_init(|| {
            Catalogue::from_json(EMBEDDED).expect("src/data/engineLuaCompat.json is valid")
        })
    }
}

/// One use of a catalogue name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// The catalogue entry, such as `removed:Spring.GetUnitTravel`.
    pub entry_id: String,
    /// 1-based line of the first character of `text`.
    pub line: u32,
    /// 1-based column, in characters, of the first character of `text`.
    pub column: u32,
    /// The name as the source wrote it: `Spring.GetUnitTravel`, or
    /// `gadget:UnitDamaged` for a definition.
    pub text: String,
}

/// Every use of a name in `catalogue` found in `source`, in source order.
pub fn scan(source: &str, catalogue: &Catalogue) -> Vec<Hit> {
    let toks = lex(source);
    let mut hits = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let t = &toks[i];
        if t.kind != Kind::Ident {
            i += 1;
            continue;
        }
        // A name after `.` or `:` belongs to a chain that started earlier, or
        // to a value that is not a plain name. Either way it is not a start.
        if i > 0 && (toks[i - 1].is_sym(".") || toks[i - 1].is_sym(":")) {
            i += 1;
            continue;
        }
        if t.is_ident("function") {
            // `local function Name` is a local, which the engine never calls.
            let local = i > 0 && toks[i - 1].is_ident("local");
            i = if local {
                i + 1
            } else {
                definition(&toks, i, catalogue, &mut hits)
            };
        } else {
            i = chain_use(&toks, i, catalogue, &mut hits);
        }
    }
    hits
}

/// `function a.b:Name(`. Returns the index after the name.
fn definition(toks: &[Token], at: usize, catalogue: &Catalogue, hits: &mut Vec<Hit>) -> usize {
    let start = at + 1;
    if toks.get(start).is_none_or(|t| t.kind != Kind::Ident) {
        return start;
    }
    let mut end = start + 1;
    while toks
        .get(end)
        .is_some_and(|t| t.is_sym(".") || t.is_sym(":"))
        && toks.get(end + 1).is_some_and(|t| t.kind == Kind::Ident)
    {
        end += 2;
    }
    let last = &toks[end - 1].text;
    push(hits, &catalogue.call_ins, last, &toks[start..end]);
    end
}

/// A chain of names joined by `.`, starting at `at`. Returns the index after it.
fn chain_use(toks: &[Token], at: usize, catalogue: &Catalogue, hits: &mut Vec<Hit>) -> usize {
    let mut end = at + 1;
    while toks.get(end).is_some_and(|t| t.is_sym("."))
        && toks.get(end + 1).is_some_and(|t| t.kind == Kind::Ident)
    {
        end += 2;
    }
    let parts = &toks[at..end];
    let joined: String = parts.iter().map(|t| t.text.as_str()).collect();
    // `parts` alternates names and dots, so joining it gives `a.b.c`.
    if catalogue.chains.contains_key(&joined) {
        push(hits, &catalogue.chains, &joined, parts);
    }

    // `gadget.UnitDamaged = function` or a bare global `UnitDamaged = ...`.
    // `local UnitDamaged = ...` is a local, which the engine never calls, and
    // `UnitDamaged = nil` switches a call-in off rather than defining it.
    let assigned = toks.get(end).is_some_and(|t| t.is_sym("="))
        && !toks.get(end + 1).is_some_and(|t| t.is_ident("nil"));
    let is_local = at > 0 && toks[at - 1].is_ident("local");
    if assigned && !is_local {
        push(
            hits,
            &catalogue.call_ins,
            &parts[parts.len() - 1].text,
            parts,
        );
    }
    end
}

/// Add a hit for each entry stored under `key`, with the source text of `parts`.
fn push(hits: &mut Vec<Hit>, map: &HashMap<String, Vec<String>>, key: &str, parts: &[Token]) {
    let Some(ids) = map.get(key) else { return };
    let first = &parts[0];
    let text: String = parts.iter().map(|t| t.text.as_str()).collect();
    for id in ids {
        hits.push(Hit {
            entry_id: id.clone(),
            line: first.line,
            column: first.column,
            text: text.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalogue() -> Catalogue {
        Catalogue::from_json(
            r#"{"entries":[
              {"id":"removed:Spring.GetUnitTravel","kind":"removed","name":"Spring.GetUnitTravel"},
              {"id":"removed:Spring.MakeFont","kind":"removed","name":"Spring.MakeFont"},
              {"id":"renamed:Game.version","kind":"renamed","name":"Game.version"},
              {"id":"signature:Game.version","kind":"signature","name":"Game.version"},
              {"id":"signature:UnitDamaged@95.0","kind":"signature","name":"UnitDamaged"},
              {"id":"file:lockluaui.txt","kind":"file","name":"lockluaui.txt"}
            ]}"#,
        )
        .unwrap()
    }

    fn ids(src: &str) -> Vec<String> {
        scan(src, &catalogue())
            .into_iter()
            .map(|h| h.entry_id)
            .collect()
    }

    #[test]
    fn hits_a_call() {
        let hits = scan("local x = Spring.GetUnitTravel(unitID)", &catalogue());
        assert_eq!(
            hits,
            vec![Hit {
                entry_id: "removed:Spring.GetUnitTravel".into(),
                line: 1,
                column: 11,
                text: "Spring.GetUnitTravel".into(),
            }]
        );
    }

    #[test]
    fn hits_a_function_taken_without_calling_it() {
        assert_eq!(
            ids("local f = Spring.GetUnitTravel"),
            ["removed:Spring.GetUnitTravel"]
        );
    }

    #[test]
    fn does_not_hit_a_longer_table_name() {
        assert!(ids("MySpring.GetUnitTravel(1)").is_empty());
        assert!(ids("obj.Spring.GetUnitTravel(1)").is_empty());
        assert!(ids("Spring.GetUnitTravelX(1)").is_empty());
    }

    #[test]
    fn hits_a_call_in_definition() {
        let hits = scan("function gadget:UnitDamaged(unitID)\nend", &catalogue());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entry_id, "signature:UnitDamaged@95.0");
        assert_eq!(hits[0].text, "gadget:UnitDamaged");
        assert_eq!((hits[0].line, hits[0].column), (1, 10));
    }

    #[test]
    fn hits_a_call_in_defined_other_ways() {
        assert_eq!(ids("function UnitDamaged() end").len(), 1);
        assert_eq!(ids("function gadget.UnitDamaged() end").len(), 1);
        assert_eq!(ids("gadget.UnitDamaged = function() end").len(), 1);
        assert_eq!(ids("UnitDamaged = function() end").len(), 1);
    }

    #[test]
    fn a_call_in_that_is_only_called_or_local_is_not_a_hit() {
        assert!(ids("gadget:UnitDamaged(1)").is_empty());
        assert!(ids("UnitDamaged(1)").is_empty());
        assert!(ids("local UnitDamaged = 1").is_empty());
        assert!(ids("local function UnitDamaged() end").is_empty());
        assert!(ids("UnitDamaged = nil").is_empty());
        assert!(ids("if x.UnitDamaged == 1 then end").is_empty());
    }

    #[test]
    fn defining_the_removed_function_is_not_a_use() {
        assert!(ids("function Spring.GetUnitTravel() return 0 end").is_empty());
    }

    #[test]
    fn a_comment_that_names_it_is_not_a_hit() {
        assert!(ids("-- Spring.GetUnitTravel(unitID)\nlocal a = 1").is_empty());
        assert!(ids("--[[ Spring.GetUnitTravel(unitID) ]]").is_empty());
        assert!(ids("--[==[\nSpring.GetUnitTravel\n]]\nstill comment ]==]").is_empty());
    }

    #[test]
    fn a_string_that_contains_it_is_not_a_hit() {
        assert!(ids(r#"local s = "Spring.GetUnitTravel(1)""#).is_empty());
        assert!(ids("local s = 'Spring.GetUnitTravel(1)'").is_empty());
        assert!(ids("local s = [[Spring.GetUnitTravel(1)]]").is_empty());
        assert!(ids("local s = [==[\nSpring.GetUnitTravel]]\n]==]").is_empty());
        assert!(ids(r#"local s = "a \" Spring.GetUnitTravel""#).is_empty());
    }

    #[test]
    fn code_after_a_comment_or_string_is_still_scanned() {
        assert_eq!(
            ids("--[[ x ]] Spring.MakeFont()"),
            ["removed:Spring.MakeFont"]
        );
        assert_eq!(
            ids("local s = [[x]]; Spring.MakeFont()"),
            ["removed:Spring.MakeFont"]
        );
        // A comment marker inside a string does not start a comment.
        assert_eq!(
            ids("local s = '--'; Spring.MakeFont()"),
            ["removed:Spring.MakeFont"]
        );
    }

    #[test]
    fn lines_and_columns_count_past_long_forms() {
        let src = "--[[\none\ntwo\n]]\nlocal s = [[\na\n]]\n  Spring.MakeFont()";
        let hits = scan(src, &catalogue());
        assert_eq!((hits[0].line, hits[0].column), (8, 3));
    }

    #[test]
    fn one_name_with_two_entries_gives_two_hits() {
        assert_eq!(
            ids("local v = Game.version"),
            ["renamed:Game.version", "signature:Game.version"]
        );
    }

    #[test]
    fn spaces_inside_a_chain_are_allowed() {
        assert_eq!(ids("Spring . MakeFont ()"), ["removed:Spring.MakeFont"]);
    }

    #[test]
    fn file_entries_are_not_matched() {
        assert!(ids("local f = lockluaui.txt").is_empty());
    }

    #[test]
    fn an_unfinished_file_still_reports_what_came_before() {
        assert_eq!(
            ids("Spring.MakeFont()\nlocal s = \"never closed\n--[[ never closed"),
            ["removed:Spring.MakeFont"]
        );
    }

    #[test]
    fn the_embedded_catalogue_parses_and_finds_the_issue_s_four_functions() {
        let src =
            "Spring.MakeFont() gl.Smoothing() Spring.SetUnitToFeature() Spring.GetUnitTravel()";
        let hits = scan(src, Catalogue::embedded());
        let ids: Vec<&str> = hits.iter().map(|h| h.entry_id.as_str()).collect();
        for want in [
            "removed:Spring.MakeFont",
            "removed:gl.Smoothing",
            "removed:Spring.SetUnitToFeature",
            "removed:Spring.GetUnitTravel",
        ] {
            assert!(ids.contains(&want), "missing {want} in {ids:?}");
        }
    }
}
