//! Skirmish-AI enumeration: native engine AIs plus a game's bundled Lua AIs.
//!
//! `GetSkirmishAICount` lists the engine's native AIs (from its AI data dirs); each
//! AI's `shortName`/`version`/`name`/`description` come from the shared `GetInfo*`
//! accessors, just like map/game metadata. A game's *own* AIs are Lua AIs declared
//! in its `LuaAI.lua` — these are NOT reported by `GetSkirmishAICount`, so when a
//! game archive is given we mount it and read `LuaAI.lua` from the VFS directly (as
//! skylobby does), then honour the game's `validais.lua` whitelist over the lot.

use crate::ffi::Unitsync;
use crate::model::{SkirmishAi, SkirmishAiOutput};
use regex::Regex;
use std::path::Path;

/// Load unitsync, list native skirmish AIs, and (when `game_archive` is given)
/// the game's Lua AIs, in one `Init` session.
pub fn render(lib: &str, game_archive: Option<&str>) -> SkirmishAiOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return SkirmishAiOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let native_count = us.skirmish_ai_count().max(0);
    let mut ais: Vec<SkirmishAi> = (0..native_count)
        .map(|i| read_ai(&us, i, "native"))
        .collect();

    if let Some(game) = game_archive.filter(|g| !g.is_empty()) {
        if us.add_all_archives(game) {
            errors.extend(us.drain_errors());
            // The game's own Lua AIs are declared in its `LuaAI.lua`, read from the
            // mounted VFS. `GetSkirmishAICount` only lists the engine's native AI
            // interfaces — mounting a game does not add its Lua AIs to that count —
            // so we read the file directly, as skylobby does.
            for (name, desc) in us.lua_ais() {
                ais.push(lua_ai(name, desc));
            }
            // Honour the game's validais.lua whitelist while its archive is still
            // mounted (the Lua parser reads from the VFS). Absent file -> `None`,
            // and an empty/garbled whitelist -> no usable patterns; both fall back
            // to keeping every AI (see `retain_valid`).
            if let Some(patterns) = us.valid_ais() {
                ais = retain_valid(ais, &patterns);
            }
            us.remove_all_archives();
        } else {
            errors.push("this engine's libunitsync can't load game archives".into());
        }
    }

    errors.extend(us.drain_errors());
    us.uninit();

    SkirmishAiOutput { ais, errors }
}

/// Build a Lua-AI entry from a `LuaAI.lua` declaration. The `name` doubles as the
/// unitsync `shortName` (the value written to `[AI].ShortName` / `[TEAM].LuaAI`),
/// and the `desc` becomes the description shown in the picker — empty descriptions
/// collapse to `None`.
fn lua_ai(name: String, desc: String) -> SkirmishAi {
    SkirmishAi {
        short_name: name.clone(),
        version: None,
        name: Some(name),
        description: (!desc.is_empty()).then_some(desc),
        kind: "lua".to_string(),
    }
}

/// Read one AI's info block into a [`SkirmishAi`] with the given `kind`.
fn read_ai(us: &Unitsync, i: i32, kind: &str) -> SkirmishAi {
    let info = us.skirmish_ai_info(i);
    SkirmishAi {
        short_name: info.get("shortName").cloned().unwrap_or_default(),
        version: info.get("version").cloned(),
        name: info.get("name").cloned(),
        description: info.get("description").cloned(),
        kind: kind.to_string(),
    }
}

/// Keep only the AIs whose `short_name` matches one of the `validais.lua` name
/// patterns. Each pattern is compiled as a regex and matched with `is_match`
/// (unanchored — a substring hit counts), mirroring skylobby's `re-find`; a
/// pattern that fails to compile is skipped. When no pattern is usable (an
/// empty or entirely-garbled whitelist), fall back to showing every AI rather
/// than hiding them all — a broken whitelist shouldn't nuke the AI list, and to
/// the user it's indistinguishable from having no whitelist at all.
fn retain_valid(ais: Vec<SkirmishAi>, patterns: &[String]) -> Vec<SkirmishAi> {
    let regexes: Vec<Regex> = patterns.iter().filter_map(|p| Regex::new(p).ok()).collect();
    if regexes.is_empty() {
        return ais;
    }
    ais.into_iter()
        .filter(|ai| regexes.iter().any(|re| re.is_match(&ai.short_name)))
        .collect()
}

/// Print a skirmish-AI error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = SkirmishAiOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ai(short: &str) -> SkirmishAi {
        SkirmishAi {
            short_name: short.to_string(),
            version: None,
            name: None,
            description: None,
            kind: "native".to_string(),
        }
    }

    fn kept(ais: Vec<SkirmishAi>, patterns: &[&str]) -> Vec<String> {
        let pats: Vec<String> = patterns.iter().map(|s| s.to_string()).collect();
        retain_valid(ais, &pats)
            .into_iter()
            .map(|a| a.short_name)
            .collect()
    }

    #[test]
    fn lua_ai_builds_lua_kind_entry() {
        let a = lua_ai("SimpleAI".into(), "EasyAI (Simple)".into());
        assert_eq!(a.short_name, "SimpleAI");
        assert_eq!(a.name.as_deref(), Some("SimpleAI"));
        assert_eq!(a.description.as_deref(), Some("EasyAI (Simple)"));
        assert_eq!(a.kind, "lua");
        assert_eq!(a.version, None);
    }

    #[test]
    fn lua_ai_empty_desc_is_none() {
        let a = lua_ai("Sandbox".into(), String::new());
        assert_eq!(a.short_name, "Sandbox");
        assert_eq!(a.description, None);
    }

    // Uses SplinterFaction's real validais.lua patterns. Note the *regex*
    // semantics we chose: `Simple*AI` is `Simpl` + `e*` + `AI`, so it matches
    // "SimpleAI" but NOT "SimpleConstructorAI" (the `AI` must follow the e's).
    #[test]
    fn keeps_pattern_matches_drops_the_rest() {
        let ais = vec![
            ai("SimpleAI"),
            ai("SimpleConstructorAI"),
            ai("ChickensAI"),
            ai("Sandbox"),
            ai("BARb"),
        ];
        assert_eq!(
            kept(ais, &["Simple*AI", "ChickensAI", "Sandbox"]),
            vec!["SimpleAI", "ChickensAI", "Sandbox"],
        );
    }

    // `is_match` is unanchored, so a bare name matches any AI containing it.
    #[test]
    fn matches_as_substring() {
        let ais = vec![ai("ChickensAI"), ai("SuperChickensAIv2"), ai("KAIK")];
        assert_eq!(
            kept(ais, &["Chickens"]),
            vec!["ChickensAI", "SuperChickensAIv2"],
        );
    }

    // A garbled pattern is skipped; usable patterns still filter normally.
    #[test]
    fn invalid_pattern_is_skipped() {
        assert_eq!(
            kept(vec![ai("ChickensAI"), ai("Sandbox")], &["Chickens", "("]),
            vec!["ChickensAI"],
        );
    }

    // When NO pattern is usable (empty or entirely-garbled whitelist), fall back
    // to keeping every AI rather than hiding them all.
    #[test]
    fn no_usable_patterns_keeps_all() {
        assert_eq!(
            kept(vec![ai("ChickensAI"), ai("Sandbox")], &["("]),
            vec!["ChickensAI", "Sandbox"],
        );
        assert_eq!(
            kept(vec![ai("ChickensAI"), ai("Sandbox")], &[]),
            vec!["ChickensAI", "Sandbox"],
        );
    }
}
