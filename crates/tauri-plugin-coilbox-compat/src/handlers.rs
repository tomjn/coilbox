//! The call-in handlers a base game's own Lua defines, read from the worker's
//! Lua compat scan (issue #4622), so its mutator gets only the call-in adapters
//! the game needs. See [`coilbox_compat::for_game`].
//!
//! Only the base archive's own files count. The scan also reads the archives
//! the game depends on, but which of those a machine resolves depends on what
//! it has installed, and two players have to build the same mutator.

use coilbox_compat::Handler;
use coilbox_luacompat::Hit;
use serde::Deserialize;

#[derive(Deserialize)]
struct Scan {
    #[serde(default)]
    files: Vec<FileHits>,
    #[serde(default)]
    archives: Vec<String>,
    #[serde(default)]
    errors: Vec<String>,
}

#[derive(Deserialize)]
struct FileHits {
    archive: String,
    hits: Vec<Hit>,
}

/// The handlers the Lua in `archive` defines, from the scan's JSON, in the
/// order the scan reports them. A scan that did not read all of the archive's
/// Lua is an error, as a handler it missed could change the answer.
pub fn handlers_in(scan: &str, archive: &str) -> Result<Vec<Handler>, String> {
    let scan: Scan = serde_json::from_str(scan)
        .map_err(|e| format!("the Lua compat scan did not come back as JSON: {e}"))?;
    let (open, read) = (
        format!("could not open archive {archive}"),
        format!(" in {archive}"),
    );
    let unread = scan
        .errors
        .iter()
        .find(|e| **e == open || e.ends_with(&read));
    if let Some(e) = unread {
        return Err(format!("the Lua of {archive} could not be scanned: {e}"));
    }
    if !scan.archives.iter().any(|a| a == archive) {
        let why = scan.errors.join("; ");
        return Err(format!("the Lua compat scan did not read {archive}: {why}"));
    }
    Ok(scan
        .files
        .into_iter()
        .filter(|f| f.archive == archive)
        .flat_map(|f| f.hits)
        .filter_map(|hit| {
            Some(Handler {
                entry: hit.entry_id,
                params: hit.params?,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handler(entry: &str, params: &[&str]) -> Handler {
        Handler {
            entry: entry.into(),
            params: params.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn the_handlers_come_from_the_base_archive_only() {
        let scan = r#"{
          "files": [
            {"archive": "xta-9.65.sd7", "path": "LuaRules/Gadgets/a.lua", "hits": [
              {"entryId": "signature:UnitDamaged@95.0", "line": 1, "column": 10,
               "text": "gadget:UnitDamaged", "params": ["u", "d"]},
              {"entryId": "removed:Spring.GetUnitTravel", "line": 4, "column": 1,
               "text": "Spring.GetUnitTravel"}
            ]},
            {"archive": "otherdep.sdz", "path": "LuaRules/Gadgets/b.lua", "hits": [
              {"entryId": "signature:AllowCommand@105.0", "line": 1, "column": 10,
               "text": "gadget:AllowCommand", "params": ["x"]}
            ]}
          ],
          "filesScanned": 2,
          "archives": ["xta-9.65.sd7", "otherdep.sdz"],
          "unresolved": ["Missing Dep"],
          "errors": ["could not read LuaRules/b.lua in otherdep.sdz"]
        }"#;
        assert_eq!(
            handlers_in(scan, "xta-9.65.sd7").unwrap(),
            [handler("signature:UnitDamaged@95.0", &["u", "d"])]
        );
    }

    #[test]
    fn a_scan_that_missed_the_base_archive_s_lua_is_an_error() {
        let unread = r#"{"files": [], "archives": ["xta.sd7"],
          "errors": ["could not read LuaRules/main.lua in xta.sd7"]}"#;
        assert!(handlers_in(unread, "xta.sd7").is_err());
        let unopened = r#"{"files": [], "archives": ["xta.sd7"],
          "errors": ["could not open archive xta.sd7"]}"#;
        assert!(handlers_in(unopened, "xta.sd7").is_err());
        let never_read = r#"{"files": [], "archives": [],
          "errors": ["worker panicked while scanning Lua"]}"#;
        assert!(handlers_in(never_read, "xta.sd7").is_err());
        assert!(handlers_in("not json", "xta.sd7").is_err());
    }
}
