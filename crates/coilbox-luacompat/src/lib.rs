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
//!   A call-in is a name the engine calls, so calling it is not a use. The hit
//!   for a definition carries the arguments the handler takes, which pick the
//!   call-in adapters a compat mutator gets (issue #4622).
//!
//! A definition of a chain (`function Spring.GetUnitTravel()`) is not a use
//! either. It is a game supplying the function itself.
//!
//! A removed or renamed name with no dot, such as `spairs`, is a global
//! function rather than a call-in, so it is a use wherever it is read, as a
//! chain is. Declaring it local or assigning to it is not a use. A parameter
//! or an assignment target after the first that has its name is taken as a
//! read, as the scan does not follow those lists.
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
    /// Entry ids by removed or renamed global function, such as `spairs`.
    globals: HashMap<String, Vec<String>>,
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
            } else if entry.kind == "removed" || entry.kind == "renamed" {
                &mut out.globals
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
    /// For a call-in defined as a function, the arguments it takes from the
    /// engine as the source names them, with `...` kept. The table a
    /// `gadget.UnitDamaged(self, ...)` is defined on is not one of them, and
    /// `gadget:UnitDamaged(...)` names none. `None` for a member chain, and
    /// for a call-in assigned something other than a function.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<String>>,
    /// For a member chain called as the whole right side of an assignment,
    /// the names its results go to, in order. `local a, b = f()` gives `a, b`,
    /// and `local c = select(3, f())` gives `_, _, c`. An operator after the
    /// call keeps only the first. `None` for a call whose results go anywhere
    /// else, and for anything that is not a call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub results: Option<Vec<String>>,
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
    let dotted = end - start > 1 && toks[end - 2].is_sym(".");
    let args = arguments(toks, end, dotted);
    push(hits, &catalogue.call_ins, last, &toks[start..end], args);
    end
}

/// The names in the parameter list that opens at `open`, or `None` when no
/// list opens there. With `receiver`, the first is the table the function is
/// called on, as `g:UnitDamaged(...)` calls a `gadget.UnitDamaged(self, ...)`,
/// and is left out.
fn arguments(toks: &[Token], open: usize, receiver: bool) -> Option<Vec<String>> {
    if !toks.get(open)?.is_sym("(") {
        return None;
    }
    let mut names = Vec::new();
    for t in &toks[open + 1..] {
        if t.is_sym(")") {
            if receiver && !names.is_empty() {
                names.remove(0);
            }
            return Some(names);
        }
        if t.kind == Kind::Ident || t.is_sym("...") {
            names.push(t.text.clone());
        } else if !t.is_sym(",") {
            return None;
        }
    }
    None
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
        let from = hits.len();
        push(hits, &catalogue.chains, &joined, parts, None);
        let taken = results(toks, at, end);
        for hit in &mut hits[from..] {
            hit.results = taken.clone();
        }
    }
    let declared =
        toks.get(end).is_some_and(|t| t.is_sym("=")) || (at > 0 && toks[at - 1].is_ident("local"));
    if parts.len() == 1 && !declared {
        push(hits, &catalogue.globals, &joined, parts, None);
    }

    // `gadget.UnitDamaged = function` or a bare global `UnitDamaged = ...`.
    // `local UnitDamaged = ...` is a local, which the engine never calls, and
    // `UnitDamaged = nil` switches a call-in off rather than defining it.
    let assigned = toks.get(end).is_some_and(|t| t.is_sym("="))
        && !toks.get(end + 1).is_some_and(|t| t.is_ident("nil"));
    let is_local = at > 0 && toks[at - 1].is_ident("local");
    if assigned && !is_local {
        let args = toks
            .get(end + 1)
            .filter(|t| t.is_ident("function"))
            .and_then(|_| arguments(toks, end + 2, parts.len() > 1));
        push(
            hits,
            &catalogue.call_ins,
            &parts[parts.len() - 1].text,
            parts,
            args,
        );
    }
    end
}

/// The index of the `)` that closes the `(` at `open`.
fn closing(toks: &[Token], open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (i, t) in toks.iter().enumerate().skip(open) {
        if t.is_sym("(") {
            depth += 1;
        } else if t.is_sym(")") {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

/// [`Hit::results`] for the chain at `at..end`.
fn results(toks: &[Token], at: usize, end: usize) -> Option<Vec<String>> {
    if !toks.get(end)?.is_sym("(") {
        return None;
    }
    let close = closing(toks, end)?;
    // `= f(...)`, or `= select(N, f(...))`, which skips N - 1 results.
    let (eq, skipped, after) = if toks[at.checked_sub(1)?].is_sym("=") {
        (at - 1, 0, close + 1)
    } else {
        let sel = at.checked_sub(4)?;
        let n: usize = toks[at - 2].text.parse().ok()?;
        let shape = toks[sel].is_ident("select")
            && toks[sel + 1].is_sym("(")
            && toks[at - 2].kind == Kind::Number
            && toks[at - 1].is_sym(",")
            && toks.get(close + 1)?.is_sym(")")
            && n > 0;
        if !shape || !toks[sel.checked_sub(1)?].is_sym("=") {
            return None;
        }
        (sel - 1, n - 1, close + 2)
    };
    let mut names = Vec::new();
    let mut i = eq;
    loop {
        let name = toks.get(i.checked_sub(1)?)?;
        if name.kind != Kind::Ident {
            return None;
        }
        names.push(name.text.clone());
        i -= 1;
        if i > 0 && toks[i - 1].is_sym(",") {
            i -= 1;
        } else {
            break;
        }
    }
    if i > 0 && (toks[i - 1].is_sym(".") || toks[i - 1].is_sym(":")) {
        return None;
    }
    names.reverse();
    let mut out = vec!["_".to_string(); skipped];
    out.extend(names);
    match toks.get(after) {
        None => Some(out),
        Some(t) if t.is_sym(";") => Some(out),
        Some(t) if t.is_ident("and") || t.is_ident("or") => Some(out[..=skipped].to_vec()),
        Some(t) if t.kind == Kind::Ident => Some(out),
        Some(t)
            if t.kind == Kind::Sym
                && !["(", ")", ",", ".", ":", "[", "{"].contains(&t.text.as_str()) =>
        {
            Some(out[..=skipped].to_vec())
        }
        Some(_) => None,
    }
}

/// Add a hit for each entry stored under `key`, with the source text of `parts`.
fn push(
    hits: &mut Vec<Hit>,
    map: &HashMap<String, Vec<String>>,
    key: &str,
    parts: &[Token],
    params: Option<Vec<String>>,
) {
    let Some(ids) = map.get(key) else { return };
    let first = &parts[0];
    let text: String = parts.iter().map(|t| t.text.as_str()).collect();
    for id in ids {
        hits.push(Hit {
            entry_id: id.clone(),
            line: first.line,
            column: first.column,
            text: text.clone(),
            params: params.clone(),
            results: None,
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
                params: None,
                results: Some(vec!["x".into()]),
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

    fn params(src: &str) -> Vec<Option<Vec<String>>> {
        scan(src, &catalogue())
            .into_iter()
            .map(|h| h.params)
            .collect()
    }

    fn names(list: &[&str]) -> Option<Vec<String>> {
        Some(list.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn a_call_in_definition_reports_the_arguments_it_takes() {
        assert_eq!(
            params("function gadget:UnitDamaged(unitID, unitDefID, ...)\nend"),
            [names(&["unitID", "unitDefID", "..."])]
        );
        assert_eq!(
            params("function UnitDamaged(u, d) end"),
            [names(&["u", "d"])]
        );
        assert_eq!(params("function gadget:UnitDamaged() end"), [names(&[])]);
    }

    #[test]
    fn the_table_a_dotted_call_in_is_defined_on_is_not_an_argument() {
        assert_eq!(
            params("function gadget.UnitDamaged(self, u, d) end"),
            [names(&["u", "d"])]
        );
        assert_eq!(
            params("gadget.UnitDamaged = function(self, u) end"),
            [names(&["u"])]
        );
        assert_eq!(
            params("UnitDamaged = function(u, d) end"),
            [names(&["u", "d"])]
        );
    }

    #[test]
    fn a_call_in_assigned_something_else_has_no_arguments_to_report() {
        assert_eq!(params("gadget.UnitDamaged = handler"), [None]);
        assert_eq!(params("local f = Spring.GetUnitTravel"), [None]);
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

    fn with_globals() -> Catalogue {
        Catalogue::from_json(
            r#"{"entries":[
              {"id":"removed:snext","kind":"removed","name":"snext"},
              {"id":"removed:spairs","kind":"removed","name":"spairs"}
            ]}"#,
        )
        .unwrap()
    }

    fn global_hits(src: &str) -> Vec<(String, u32)> {
        scan(src, &with_globals())
            .into_iter()
            .map(|h| (h.entry_id, h.column))
            .collect()
    }

    /// Issue #4692: a removed global such as `spairs` is a use wherever it is
    /// read, as a chain is, and not only where it is defined, as a call-in is.
    #[test]
    fn a_removed_global_is_a_use_where_it_is_read() {
        assert_eq!(
            global_hits("for k, v in spairs(t) do end"),
            [("removed:spairs".to_string(), 13)]
        );
        assert_eq!(
            global_hits("local snext = snext"),
            [("removed:snext".to_string(), 15)]
        );
        assert_eq!(
            global_hits("System = { snext = snext }"),
            [("removed:snext".to_string(), 20)]
        );
    }

    #[test]
    fn defining_or_naming_a_field_after_a_removed_global_is_not_a_use() {
        assert!(global_hits("function snext(t, k) end").is_empty());
        assert!(global_hits("snext = next").is_empty());
        assert!(global_hits("local spairs = pairs").is_empty());
        assert!(global_hits("t.snext(x) t:spairs()").is_empty());
        assert!(global_hits("if snext == nil then end").len() == 1);
    }

    fn results(src: &str) -> Vec<Option<Vec<String>>> {
        scan(src, &catalogue())
            .into_iter()
            .map(|h| h.results)
            .collect()
    }

    /// Issue #4694: how a call site takes a function's results tells whether
    /// it was written for the order they came in before a change.
    #[test]
    fn a_call_assigned_to_names_reports_them_as_its_results() {
        assert_eq!(
            results("local _, _, isDead = Spring.GetUnitTravel(team.id)"),
            [names(&["_", "_", "isDead"])]
        );
        assert_eq!(
            results("travel, period = Spring.GetUnitTravel(u);"),
            [names(&["travel", "period"])]
        );
        assert_eq!(
            results("local _,_,_,_,_,_,r,g,b = Spring.GetUnitTravel(t); return r,g,b"),
            [names(&["_", "_", "_", "_", "_", "_", "r", "g", "b"])]
        );
    }

    #[test]
    fn a_call_inside_select_reports_the_results_select_skips() {
        assert_eq!(
            results("local teamOptions = select(7, Spring.GetUnitTravel(teamID))\nlocal m = 1"),
            [names(&["_", "_", "_", "_", "_", "_", "teamOptions"])]
        );
        assert_eq!(
            results("local a, b = select(2, Spring.GetUnitTravel(x))"),
            [names(&["_", "a", "b"])]
        );
    }

    #[test]
    fn an_operator_after_the_call_keeps_only_the_first_result() {
        assert_eq!(
            results("local a, b = Spring.GetUnitTravel(x) or 0"),
            [names(&["a"])]
        );
        assert_eq!(
            results("local dead = select(3, Spring.GetUnitTravel(x)) == true"),
            [names(&["_", "_", "dead"])]
        );
    }

    #[test]
    fn a_call_whose_results_go_anywhere_else_reports_none() {
        for src in [
            "Spring.GetUnitTravel(x)",
            "return Spring.GetUnitTravel(x)",
            "local f = Spring.GetUnitTravel",
            "local a, b = Spring.GetUnitTravel(x), 1",
            "local a = Spring.GetUnitTravel(x).y",
            "local a = Spring.GetUnitTravel(x)[1]",
            "obj.a, b = Spring.GetUnitTravel(x)",
            "local n = g(select(2, Spring.GetUnitTravel(x)))",
            "local n = select('#', Spring.GetUnitTravel(x))",
            "local n = t.select(2, Spring.GetUnitTravel(x))",
            "local a = Spring.GetUnitTravel{x}",
        ] {
            assert_eq!(results(src), [None], "{src}");
        }
    }

    #[test]
    fn the_embedded_catalogue_lists_the_synced_iterators_as_removed_globals() {
        let hits = scan("snext(t) spairs(t) sipairs(t)", Catalogue::embedded());
        let ids: Vec<&str> = hits.iter().map(|h| h.entry_id.as_str()).collect();
        assert_eq!(ids, ["removed:snext", "removed:spairs", "removed:sipairs"]);
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
