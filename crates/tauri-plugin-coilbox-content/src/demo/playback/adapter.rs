//! A game's playback adapter (issue #3799): a small Lua file that says which of
//! the base game's gadgets and widgets to switch off during playback, which unit
//! and feature definitions to leave out, which of the game's rules parameters
//! to record and set back (issue #3982), and optionally what to do when the
//! player places a unit.
//!
//! The rules parameters are the one part a recording reads as well as a
//! playback: `analysis.rs` chooses the adapter the same way before it records,
//! and names the parameters in the recorder's request.
//!
//! This module reads the data in it, matches it to a game, picks which one a
//! launch uses and works out the files that switch things off. The hooks are
//! Lua the player calls in the engine, and are not read here.
//!
//! The chosen adapter is written into the playback game at [`PATH`], and the
//! player reads it from there (`luarules/rewind_player/coilbox_player_adapter.lua`).
//! `lua/rewind-player/README.md` documents the format for a game maker.
//!
//! The data is read with the sandboxed Spring Lua evaluator that reads a game's
//! other config (`coilbox-springlua`), so an adapter can compute its lists in
//! Lua. The evaluator cannot run a hook against an engine, so functions are
//! dropped from what it hands back.

use std::collections::BTreeMap;
use std::path::Path;

use coilbox_springlua::SpringLua;
use serde::Deserialize;

use super::REWIND_PLAYER_FILES;
use crate::demo::analysis::game::lua_string;

/// Where the playback game holds the adapter in use, and where a game holds its
/// own inside its archive. The player's `Adapter.PATH` is the same string, and a
/// test holds the two together.
pub const PATH: &str = "coilbox_rewind/adapter.lua";

/// What stands in for a gadget or widget the adapter switches off. The engine's
/// gadget and widget handlers take a file that returns `false` as one that asked
/// not to be loaded, and load nothing for it.
pub const SHADOW: &str =
    "-- Coilbox rewind: this stands in for a file of the same name in the game being\n\
-- played back, which the game's adapter switches off for playback.\n\
return false\n";

/// A version, as the numbers at its start.
#[derive(Clone, Debug)]
pub struct Version(Vec<u64>);

impl Version {
    /// The numbers a version starts with, or `None` when it has none. It skips
    /// whatever comes before the first digit ("v", "stable-", "test-"), reads
    /// numbers joined by single dots and stops at anything else, so
    /// "1.7 (Beta 10.1)" is 1.7, "test-30922-8064a43" is 30922 and "$VERSION"
    /// has none.
    pub fn parse(text: &str) -> Option<Version> {
        let mut rest = text.trim_start_matches(|c: char| !c.is_ascii_digit());
        let mut numbers = Vec::new();
        while !rest.is_empty() {
            let digits = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            numbers.push(rest[..digits].parse::<u64>().ok()?);
            rest = &rest[digits..];
            match rest.strip_prefix('.') {
                Some(after) if after.starts_with(|c: char| c.is_ascii_digit()) => rest = after,
                _ => break,
            }
        }
        (!numbers.is_empty()).then_some(Version(numbers))
    }
}

impl PartialEq for Version {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
    }
}

impl Eq for Version {}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Number by number, with a missing number counting as zero.
impl Ord for Version {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        let longest = self.0.len().max(other.0.len());
        for at in 0..longest {
            let ours = self.0.get(at).copied().unwrap_or(0);
            let theirs = other.0.get(at).copied().unwrap_or(0);
            match ours.cmp(&theirs) {
                std::cmp::Ordering::Equal => {}
                unequal => return unequal,
            }
        }
        std::cmp::Ordering::Equal
    }
}

/// A game's adapter, as far as coilbox reads it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Adapter {
    pub name: Option<String>,
    /// The game's `shortname`. A shipped adapter needs one.
    pub short_name: Option<String>,
    /// The first version it is for, inclusive.
    pub min: Option<Version>,
    /// The last version it is for, inclusive.
    pub max: Option<Version>,
    /// Gadget files to switch off, relative to `luarules/gadgets/`.
    pub gadgets: Vec<String>,
    /// Widget files to switch off, relative to `luaui/widgets/`.
    pub widgets: Vec<String>,
    /// Unit definition names to hide.
    pub units: Vec<String>,
    /// Feature definition names to skip.
    pub features: Vec<String>,
    /// Team rules parameters the recorder keeps and the player sets back.
    pub team_params: Vec<String>,
    /// Game rules parameters the recorder keeps and the player sets back.
    pub game_params: Vec<String>,
}

/// The keys of an adapter. `hooks` is the player's and is dropped before this
/// is read.
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
struct Raw {
    name: Option<String>,
    shortname: Option<String>,
    versions: Option<RawVersions>,
    gadgets: List,
    widgets: List,
    units: List,
    features: List,
    #[serde(rename = "teamParams")]
    team_params: List,
    #[serde(rename = "gameParams")]
    game_params: List,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
struct RawVersions {
    min: Option<String>,
    max: Option<String>,
}

/// A list of names. Lua has one kind of table, so an empty list can arrive as
/// either an array or an object.
#[derive(Default)]
struct List(Vec<String>);

impl<'de> Deserialize<'de> for List {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::Array(items) => items
                .into_iter()
                .map(|item| match item {
                    serde_json::Value::String(text) => Ok(text),
                    other => Err(D::Error::custom(format!("{other} is not a name"))),
                })
                .collect::<Result<Vec<_>, _>>()
                .map(List),
            serde_json::Value::Object(map) if map.is_empty() => Ok(List(Vec::new())),
            _ => Err(D::Error::custom("it is not a list of names")),
        }
    }
}

/// Lua that runs an adapter's source and hands back its data: the table it
/// returned, copied without its functions and without `hooks`. The source goes
/// on the first line, so an error's line number is the file's own.
fn wrap(source: &str) -> String {
    format!(
        "local function adapter() {source}\nend\n\
         local raw = adapter()\n\
         if type(raw) ~= 'table' then return raw end\n\
         local function copy(value)\n\
           local out = {{}}\n\
           for key, item in pairs(value) do\n\
             if type(item) == 'table' then out[key] = copy(item)\n\
             elseif type(item) ~= 'function' then out[key] = item end\n\
           end\n\
           return out\n\
         end\n\
         local data = copy(raw)\n\
         data.hooks = nil\n\
         return data\n"
    )
}

/// A file or folder name in an adapter's list: a path inside one folder, in
/// forward slashes, with no `..` and no empty parts.
fn is_inside(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// Whether `path`, relative to the game's root, is a file coilbox puts in the
/// playback game, which an adapter must not shadow.
fn is_player_file(path: &str) -> bool {
    REWIND_PLAYER_FILES
        .iter()
        .any(|(rel, _)| rel.eq_ignore_ascii_case(path))
}

fn files(kind: &str, folder: &str, list: &[String]) -> Result<(), String> {
    for name in list {
        let lua = name.to_ascii_lowercase().ends_with(".lua");
        if !is_inside(name) || !lua {
            return Err(format!(
                "{name:?} in {kind} is not a .lua file inside {folder}, written with forward slashes"
            ));
        }
        if is_player_file(&format!("{folder}{name}")) {
            return Err(format!(
                "{name:?} in {kind} is one of coilbox's own files, and switching it off would stop the playback"
            ));
        }
    }
    Ok(())
}

fn names(kind: &str, list: &[String]) -> Result<(), String> {
    match list.iter().find(|name| name.trim().is_empty()) {
        Some(_) => Err(format!("{kind} has a name that is empty")),
        None => Ok(()),
    }
}

/// A list of rules parameters: names, each once. The recorder and the player
/// know a parameter by its place in the list, so a name twice would be two
/// parameters writing one.
fn params(kind: &str, list: &[String]) -> Result<(), String> {
    names(kind, list)?;
    for (at, name) in list.iter().enumerate() {
        if list[..at].contains(name) {
            return Err(format!("{kind} names {name:?} twice"));
        }
    }
    Ok(())
}

fn bound(which: &str, text: &Option<String>) -> Result<Option<Version>, String> {
    match text {
        None => Ok(None),
        Some(text) => Version::parse(text)
            .map(Some)
            .ok_or_else(|| format!("versions.{which} is {text:?}, which has no number in it")),
    }
}

impl Adapter {
    /// Reads an adapter's source.
    pub fn parse(source: &str) -> Result<Adapter, String> {
        let lua = SpringLua::new(Path::new("adapter-has-no-files"))
            .map_err(|e| format!("could not start the Lua evaluator: {e}"))?;
        let value = lua
            .eval_value_raw(&wrap(source), "adapter.lua")
            .map_err(|e| format!("the adapter could not be run: {e}"))?;
        if !value.is_object() && !value.is_array() {
            return Err(format!("the adapter returned {value}, and not a table"));
        }
        let raw: Raw = serde_json::from_value(value)
            .map_err(|e| format!("the adapter is not in the format: {e}"))?;

        files("gadgets", "luarules/gadgets/", &raw.gadgets.0)?;
        files("widgets", "luaui/widgets/", &raw.widgets.0)?;
        names("units", &raw.units.0)?;
        names("features", &raw.features.0)?;
        params("teamParams", &raw.team_params.0)?;
        params("gameParams", &raw.game_params.0)?;
        let versions = raw.versions.unwrap_or_default();
        let (min, max) = (bound("min", &versions.min)?, bound("max", &versions.max)?);
        if let (Some(min), Some(max)) = (&min, &max) {
            if min > max {
                return Err(format!(
                    "versions.min ({:?}) comes after versions.max ({:?})",
                    versions.min.unwrap_or_default(),
                    versions.max.unwrap_or_default()
                ));
            }
        }
        Ok(Adapter {
            name: raw.name,
            short_name: raw.shortname.filter(|name| !name.trim().is_empty()),
            min,
            max,
            gadgets: raw.gadgets.0,
            widgets: raw.widgets.0,
            units: raw.units.0,
            features: raw.features.0,
            team_params: raw.team_params.0,
            game_params: raw.game_params.0,
        })
    }

    /// Whether this adapter is for the game with `short_name` at `version`. The
    /// short name is compared without regard to case. An adapter with a range
    /// is for no game whose version has no number in it.
    pub fn applies_to(&self, short_name: &str, version: Option<&str>) -> bool {
        let Some(ours) = &self.short_name else {
            return false;
        };
        if !ours.trim().eq_ignore_ascii_case(short_name.trim()) {
            return false;
        }
        if self.min.is_none() && self.max.is_none() {
            return true;
        }
        let Some(version) = version.and_then(Version::parse) else {
            return false;
        };
        self.min.as_ref().is_none_or(|min| &version >= min)
            && self.max.as_ref().is_none_or(|max| &version <= max)
    }

    /// The files in the playback game that stand in for what the adapter
    /// switches off, by path.
    pub fn shadows(&self) -> Vec<String> {
        let gadgets = self.gadgets.iter().map(|g| format!("luarules/gadgets/{g}"));
        let widgets = self.widgets.iter().map(|w| format!("luaui/widgets/{w}"));
        gadgets.chain(widgets).collect()
    }
}

/// Where the adapter a launch uses came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// The game's own archive holds it.
    Game,
    /// Coilbox ships it.
    App,
    /// No adapter applies.
    None,
}

/// The adapter a launch uses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chosen {
    pub source: Source,
    pub adapter: Option<Adapter>,
    /// What to write at [`PATH`].
    pub text: String,
}

impl Chosen {
    /// No adapter, and nothing wrong. The player plays the match as it would
    /// without one.
    pub fn none() -> Chosen {
        Chosen {
            source: Source::None,
            adapter: None,
            text: "-- No adapter applies to this game.\nreturn false\n".into(),
        }
    }

    /// No adapter, because one that should have applied could not be used. The
    /// player logs `problem`.
    fn failed(problem: &str) -> Chosen {
        Chosen {
            text: format!(
                "-- An adapter was found and could not be used.\nreturn {{ problem = {} }}\n",
                lua_string(problem)
            ),
            ..Chosen::none()
        }
    }
}

/// Picks the adapter for a game. `own` is what the game's archive holds at
/// [`PATH`] (`Ok(None)` when it holds nothing, `Err` when it could not be
/// read), and `shipped` is coilbox's own, as file names and sources.
///
/// A game's own adapter wins, and applies whatever its short name and range say,
/// since it is in the archive of the version being played. When it cannot be
/// used the launch carries on with a shipped one, and with none if there is
/// none, and the player logs why. Of the shipped adapters, the first in file
/// name order that applies wins.
pub fn choose(
    own: Result<Option<String>, String>,
    shipped: &[(&str, &str)],
    short_name: &str,
    version: Option<&str>,
) -> Chosen {
    let mut problem = None;
    match own {
        Ok(Some(text)) => match Adapter::parse(&text) {
            Ok(adapter) => {
                return Chosen {
                    source: Source::Game,
                    adapter: Some(adapter),
                    text,
                }
            }
            Err(e) => problem = Some(format!("the game's own adapter could not be used: {e}")),
        },
        Ok(None) => {}
        Err(e) => problem = Some(format!("the game's own adapter could not be read: {e}")),
    }
    let mut by_name: BTreeMap<&str, &str> = BTreeMap::new();
    by_name.extend(shipped.iter().copied());
    for (_, text) in by_name {
        if let Ok(adapter) = Adapter::parse(text) {
            if adapter.applies_to(short_name, version) {
                return Chosen {
                    source: Source::App,
                    adapter: Some(adapter),
                    text: text.to_string(),
                };
            }
        }
    }
    problem.map_or_else(Chosen::none, |problem| Chosen::failed(&problem))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap_or_else(|| panic!("{text} has no version in it"))
    }

    // ---- versions --------------------------------------------------------

    /// What the installed games declare, from a scan of the games on this
    /// machine, with the numbers they start with.
    #[test]
    fn a_version_is_the_numbers_it_starts_with() {
        for (text, numbers) in [
            ("0.1.89", vec![0, 1, 89]),
            ("V15.9.8", vec![15, 9, 8]),
            ("v2.58", vec![2, 58]),
            ("v1.14.8.0", vec![1, 14, 8, 0]),
            ("stable-8405", vec![8405]),
            ("test-30922-8064a43", vec![30922]),
            ("b63", vec![63]),
            ("1.7 (Beta 10.1)", vec![1, 7]),
            ("0.46 for Spring 0.88", vec![0, 46]),
            ("0.1.89-rc1", vec![0, 1, 89]),
            ("  3.2  ", vec![3, 2]),
        ] {
            assert_eq!(v(text), Version(numbers), "{text}");
        }
    }

    #[test]
    fn a_text_with_no_number_has_no_version() {
        for text in ["", "$VERSION", "KRE $VERSION", "dev", "..", "v."] {
            assert_eq!(Version::parse(text), None, "{text:?}");
        }
        // A number too long for the comparison is not a version either.
        assert_eq!(Version::parse("99999999999999999999999"), None);
    }

    #[test]
    fn versions_compare_by_number_and_not_by_text() {
        assert!(v("0.1.9") < v("0.1.89"));
        assert!(v("0.1.89") < v("0.2"));
        assert!(v("V15.9.8") < v("V15.10"));
        assert!(v("test-9999-a") < v("test-30922-b"));
    }

    #[test]
    fn a_missing_number_counts_as_zero() {
        assert_eq!(v("1.2").cmp(&v("1.2.0")), std::cmp::Ordering::Equal);
        assert!(v("1.2") < v("1.2.1"));
        assert!(v("1") == v("1.0.0"));
    }

    // ---- reading ---------------------------------------------------------

    const FULL: &str = r#"
        -- A comment first.
        return {
            name = "Test game",
            shortname = "TG",
            versions = { min = "0.1.80", max = "0.1.99" },
            gadgets = { "game_end.lua", "sub/other.lua" },
            widgets = { "gui_bars.lua" },
            units = { "armcom_start" },
            features = { "rock" },
            hooks = {
                afterFrame = function() end,
            },
        }
    "#;

    #[test]
    fn an_adapter_is_read_from_its_lua() {
        let adapter = Adapter::parse(FULL).unwrap();

        assert_eq!(adapter.name.as_deref(), Some("Test game"));
        assert_eq!(adapter.short_name.as_deref(), Some("TG"));
        assert_eq!(adapter.min, Some(v("0.1.80")));
        assert_eq!(adapter.max, Some(v("0.1.99")));
        assert_eq!(adapter.gadgets, ["game_end.lua", "sub/other.lua"]);
        assert_eq!(adapter.widgets, ["gui_bars.lua"]);
        assert_eq!(adapter.units, ["armcom_start"]);
        assert_eq!(adapter.features, ["rock"]);
    }

    /// The numbers a game keeps for itself, which the recorder keeps and the
    /// player sets back (issue #3982).
    #[test]
    fn an_adapter_names_the_rules_parameters_to_keep() {
        let adapter = Adapter::parse(
            "return { teamParams = { 'supplyUsed', 'researchPoints' }, gameParams = { 'wave' } }",
        )
        .unwrap();

        assert_eq!(adapter.team_params, ["supplyUsed", "researchPoints"]);
        assert_eq!(adapter.game_params, ["wave"]);
        assert!(Adapter::parse(FULL).unwrap().team_params.is_empty());
    }

    #[test]
    fn a_rules_parameter_has_a_name_and_is_named_once() {
        for source in [
            "return { teamParams = { '' } }",
            "return { gameParams = { ' ' } }",
            "return { teamParams = { 4 } }",
            "return { teamParams = 'supplyUsed' }",
            "return { teamParams = { 'a', 'a' } }",
            "return { gameParams = { 'wave', 'wave' } }",
        ] {
            assert!(Adapter::parse(source).is_err(), "{source}");
        }
        // The same name for a team and for the game is two parameters.
        assert!(Adapter::parse("return { teamParams = { 'a' }, gameParams = { 'a' } }").is_ok());
    }

    #[test]
    fn an_adapter_can_be_empty() {
        let adapter = Adapter::parse("return {}").unwrap();

        assert_eq!(adapter, Adapter::default());
    }

    #[test]
    fn empty_lists_are_fine() {
        let adapter =
            Adapter::parse("return { gadgets = {}, widgets = {}, units = {}, features = {} }")
                .unwrap();

        assert_eq!(adapter, Adapter::default());
    }

    #[test]
    fn a_hook_that_calls_the_engine_is_not_run_to_read_the_data() {
        let adapter = Adapter::parse(
            "return { gadgets = { 'a.lua' }, hooks = { afterFrame = function() Spring.Echo('x') end } }",
        )
        .unwrap();

        assert_eq!(adapter.gadgets, ["a.lua"]);
    }

    #[test]
    fn lua_that_works_the_lists_out_is_read() {
        let adapter = Adapter::parse(
            "local names = {} for _, n in ipairs({'a', 'b'}) do names[#names + 1] = n .. '.lua' end return { gadgets = names }",
        )
        .unwrap();

        assert_eq!(adapter.gadgets, ["a.lua", "b.lua"]);
    }

    #[test]
    fn lua_that_does_not_return_a_table_is_refused() {
        for source in [
            "return 3",
            "return false",
            "return 'text'",
            "",
            "local x = 1",
        ] {
            assert!(Adapter::parse(source).is_err(), "{source}");
        }
    }

    #[test]
    fn lua_that_does_not_compile_or_loops_for_ever_is_refused() {
        assert!(Adapter::parse("return {").is_err());
        let err = Adapter::parse("while true do end").unwrap_err();
        assert!(err.contains("budget") || err.contains("loop"), "{err}");
    }

    #[test]
    fn a_key_nobody_reads_is_refused_so_a_misspelling_cannot_switch_nothing_off() {
        let err = Adapter::parse("return { gadget = { 'game_end.lua' } }").unwrap_err();

        assert!(err.contains("gadget"), "{err}");
    }

    #[test]
    fn a_list_of_the_wrong_kind_is_refused() {
        for source in [
            "return { gadgets = 'game_end.lua' }",
            "return { widgets = { 4 } }",
            "return { units = { {} } }",
            "return { features = true }",
            "return { name = {} }",
            "return { shortname = 4 }",
            "return { versions = '1.0' }",
            "return { versions = { min = 1 } }",
            "return { versions = { low = '1' } }",
        ] {
            assert!(Adapter::parse(source).is_err(), "{source}");
        }
    }

    #[test]
    fn a_name_in_a_list_cannot_be_empty() {
        for source in [
            "return { units = { '' } }",
            "return { features = { '  ' } }",
            "return { gadgets = { '' } }",
        ] {
            assert!(Adapter::parse(source).is_err(), "{source}");
        }
    }

    #[test]
    fn a_version_range_is_checked() {
        let none = Adapter::parse("return { versions = { min = 'dev' } }").unwrap_err();
        assert!(none.contains("dev"), "{none}");
        let backwards =
            Adapter::parse("return { versions = { min = '2.0', max = '1.0' } }").unwrap_err();
        assert!(backwards.contains("after"), "{backwards}");
        assert!(Adapter::parse("return { versions = { min = '1.0', max = '1.0' } }").is_ok());
        assert!(Adapter::parse("return { versions = {} }").is_ok());
    }

    #[test]
    fn a_file_to_switch_off_is_a_lua_file_inside_the_folder() {
        for bad in [
            "../game_end.lua",
            "sub/../x.lua",
            "/game_end.lua",
            "game_end.txt",
            "game_end",
            "a\\b.lua",
            "a//b.lua",
            "./a.lua",
        ] {
            let source = format!("return {{ gadgets = {{ {bad:?} }} }}");
            let err = Adapter::parse(&source).unwrap_err();
            assert!(err.contains("gadgets"), "{bad}: {err}");
            let source = format!("return {{ widgets = {{ {bad:?} }} }}");
            assert!(Adapter::parse(&source).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_players_own_files_cannot_be_switched_off() {
        for (kind, file) in [
            ("gadgets", "coilbox_rewind_player.lua"),
            ("gadgets", "!coilbox_rewind_guard.lua"),
            ("gadgets", "COILBOX_REWIND_PLAYER.LUA"),
            ("widgets", "coilbox_rewind_timeline.lua"),
        ] {
            let err = Adapter::parse(&format!("return {{ {kind} = {{ '{file}' }} }}")).unwrap_err();
            assert!(err.contains("coilbox's own"), "{file}: {err}");
        }
        // The same name in the other folder is the base game's.
        assert!(Adapter::parse("return { widgets = { 'coilbox_rewind_player.lua' } }").is_ok());
    }

    // ---- matching --------------------------------------------------------

    fn adapter(short: &str, range: &str) -> Adapter {
        Adapter::parse(&format!(
            "return {{ shortname = {short:?}, versions = {{ {range} }} }}"
        ))
        .unwrap()
    }

    #[test]
    fn an_adapter_is_matched_by_the_short_name_whatever_its_case() {
        let adapter = adapter("SF", "");

        assert!(adapter.applies_to("SF", Some("0.1.89")));
        assert!(adapter.applies_to("sf", Some("0.1.89")));
        assert!(adapter.applies_to(" SF ", None));
        assert!(!adapter.applies_to("BYAR", Some("0.1.89")));
        assert!(!adapter.applies_to("", None));
    }

    #[test]
    fn an_adapter_with_no_range_is_for_every_version_even_none() {
        let adapter = adapter("SF", "");

        assert!(adapter.applies_to("SF", None));
        assert!(adapter.applies_to("SF", Some("$VERSION")));
        assert!(adapter.applies_to("SF", Some("0.0.1")));
    }

    #[test]
    fn a_range_includes_both_ends() {
        let adapter = adapter("SF", "min = '0.1.80', max = '0.1.89'");

        assert!(adapter.applies_to("SF", Some("0.1.80")));
        assert!(adapter.applies_to("SF", Some("0.1.85")));
        assert!(adapter.applies_to("SF", Some("0.1.89")));
    }

    #[test]
    fn a_version_outside_the_range_does_not_match() {
        let adapter = adapter("SF", "min = '0.1.80', max = '0.1.89'");

        assert!(!adapter.applies_to("SF", Some("0.1.79")));
        assert!(!adapter.applies_to("SF", Some("0.1.90")));
        assert!(!adapter.applies_to("SF", Some("0.2")));
        assert!(!adapter.applies_to("SF", Some("1.0.0")));
    }

    #[test]
    fn a_range_can_have_one_end() {
        let from = adapter("BYAR", "min = 'test-27000'");
        assert!(from.applies_to("BYAR", Some("test-30922-8064a43")));
        assert!(!from.applies_to("BYAR", Some("test-26999-abc")));
        let until = adapter("BA", "max = 'V15.9.8'");
        assert!(until.applies_to("BA", Some("V15.9.8")));
        assert!(!until.applies_to("BA", Some("V16")));
    }

    #[test]
    fn a_game_with_no_readable_version_matches_no_range() {
        let adapter = adapter("SF", "min = '0.1.80'");

        assert!(!adapter.applies_to("SF", None));
        assert!(!adapter.applies_to("SF", Some("$VERSION")));
    }

    // ---- shadows ---------------------------------------------------------

    #[test]
    fn each_gadget_and_widget_is_shadowed_in_its_own_folder() {
        let adapter = Adapter::parse(FULL).unwrap();

        assert_eq!(
            adapter.shadows(),
            [
                "luarules/gadgets/game_end.lua",
                "luarules/gadgets/sub/other.lua",
                "luaui/widgets/gui_bars.lua"
            ]
        );
        assert!(Adapter::default().shadows().is_empty());
    }

    #[test]
    fn a_shadow_asks_the_handler_not_to_load_it() {
        assert!(SHADOW.contains("return false"), "{SHADOW}");
        assert!(!SHADOW.contains(';'));
    }

    // ---- choosing --------------------------------------------------------

    const SHIPPED: &str =
        "return { name = 'Shipped', shortname = 'SF', gadgets = { 'game_end.lua' } }";
    const OWN: &str = "return { name = 'Own', gadgets = { 'own.lua' } }";

    fn shipped<'a>() -> Vec<(&'a str, &'a str)> {
        vec![("sf.lua", SHIPPED)]
    }

    #[test]
    fn a_game_with_no_adapter_gets_the_default_that_changes_nothing() {
        let chosen = choose(Ok(None), &[], "SF", Some("0.1.89"));

        assert_eq!(chosen.source, Source::None);
        assert_eq!(chosen.adapter, None);
        assert!(
            chosen.text.trim().ends_with("\nreturn false"),
            "{}",
            chosen.text
        );
        assert_eq!(chosen, Chosen::none());
    }

    #[test]
    fn a_shipped_adapter_is_used_for_its_game() {
        let chosen = choose(Ok(None), &shipped(), "SF", Some("0.1.89"));

        assert_eq!(chosen.source, Source::App);
        assert_eq!(chosen.text, SHIPPED);
        assert_eq!(chosen.adapter.unwrap().gadgets, ["game_end.lua"]);
    }

    #[test]
    fn a_shipped_adapter_is_not_used_for_another_game() {
        let chosen = choose(Ok(None), &shipped(), "BYAR", Some("1"));

        assert_eq!(chosen, Chosen::none());
    }

    #[test]
    fn a_shipped_adapter_is_not_used_outside_its_versions() {
        let ranged = "return { shortname = 'SF', versions = { max = '0.1.89' } }";
        let list = [("sf.lua", ranged)];

        assert_eq!(
            choose(Ok(None), &list, "SF", Some("0.1.89")).source,
            Source::App
        );
        assert_eq!(
            choose(Ok(None), &list, "SF", Some("0.1.90")),
            Chosen::none()
        );
    }

    #[test]
    fn the_games_own_adapter_wins_over_a_shipped_one() {
        let chosen = choose(Ok(Some(OWN.into())), &shipped(), "SF", Some("0.1.89"));

        assert_eq!(chosen.source, Source::Game);
        assert_eq!(chosen.text, OWN);
        assert_eq!(chosen.adapter.unwrap().name.as_deref(), Some("Own"));
    }

    /// The adapter is in the archive of the version being played, so its range
    /// and short name say nothing about whether it applies.
    #[test]
    fn the_games_own_adapter_applies_whatever_its_range_says() {
        let own =
            "return { shortname = 'ELSE', versions = { max = '0.0.1' }, gadgets = { 'x.lua' } }";

        let chosen = choose(Ok(Some(own.into())), &[], "SF", Some("5.0"));

        assert_eq!(chosen.source, Source::Game);
    }

    #[test]
    fn the_first_shipped_adapter_that_matches_is_used() {
        let list = [
            ("a_other.lua", "return { shortname = 'OTHER' }"),
            ("b_sf.lua", "return { name = 'first', shortname = 'SF' }"),
            ("c_sf.lua", "return { name = 'second', shortname = 'SF' }"),
        ];

        let chosen = choose(Ok(None), &list, "SF", None);

        assert_eq!(chosen.adapter.unwrap().name.as_deref(), Some("first"));
    }

    #[test]
    fn a_shipped_adapter_without_a_short_name_matches_no_game() {
        let list = [("x.lua", "return { gadgets = { 'a.lua' } }")];

        assert_eq!(choose(Ok(None), &list, "SF", None), Chosen::none());
    }

    #[test]
    fn a_games_own_adapter_that_cannot_be_read_falls_back_and_says_why() {
        let broken = choose(Ok(Some("return {".into())), &shipped(), "SF", Some("1"));
        assert_eq!(broken.source, Source::App);

        let alone = choose(Ok(Some("return {".into())), &[], "SF", Some("1"));
        assert_eq!(alone.source, Source::None);
        assert!(alone.adapter.is_none());
        assert!(alone.text.contains("problem"), "{}", alone.text);
        assert!(
            alone.text.contains("the game's own adapter"),
            "{}",
            alone.text
        );
    }

    #[test]
    fn an_archive_that_could_not_be_read_is_a_problem_and_not_a_failed_launch() {
        let chosen = choose(Err("could not open the archive x".into()), &[], "SF", None);

        assert_eq!(chosen.source, Source::None);
        assert!(
            chosen.text.contains("could not open the archive x"),
            "{}",
            chosen.text
        );
    }

    #[test]
    fn a_problem_is_written_as_a_lua_string_that_cannot_end_early() {
        let chosen = choose(Err("odd \"quote\" \\ and\nnewline".into()), &[], "SF", None);

        assert!(
            chosen.text.contains(&lua_string(
                "the game's own adapter could not be read: odd \"quote\" \\ and\nnewline"
            )),
            "{}",
            chosen.text
        );
    }

    #[test]
    fn a_shipped_adapter_that_is_broken_is_skipped_and_the_rest_still_match() {
        let list = [
            ("a_broken.lua", "return {"),
            ("b_sf.lua", "return { shortname = 'SF' }"),
        ];

        let chosen = choose(Ok(None), &list, "SF", None);

        assert_eq!(chosen.source, Source::App);
    }

    // ---- the adapters coilbox ships -------------------------------------

    /// Every adapter in `lua/rewind-player/adapters/` reads, names a short name
    /// and does not shadow the player.
    #[test]
    fn every_shipped_adapter_reads() {
        for (file, source) in super::super::REWIND_PLAYER_ADAPTERS {
            let adapter = Adapter::parse(source).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert!(adapter.short_name.is_some(), "{file} names no shortname");
        }
    }

    /// Splinter Faction's adapter is chosen for every release of the game and
    /// for a game folder under development, which declares no version, and for
    /// no other game. What it switches off is spelled out here, so that a
    /// change to the list is a change somebody meant (issue #3800).
    #[test]
    fn splinter_factions_adapter_is_for_every_version_of_it_and_no_other_game() {
        let shipped = super::super::REWIND_PLAYER_ADAPTERS;

        for version in [Some("0.1.88"), Some("0.1.89"), Some("$VERSION"), None] {
            let chosen = choose(Ok(None), shipped, "SF", version);
            assert_eq!(chosen.source, Source::App, "{version:?}");
            let adapter = chosen.adapter.unwrap();
            assert_eq!(adapter.name.as_deref(), Some("Splinter Faction"));
            assert_eq!(
                adapter.shadows(),
                [
                    "luarules/gadgets/game_end.lua",
                    "luarules/gadgets/game_team_com_ends.lua",
                    "luarules/gadgets/game_spawn.lua",
                    "luarules/gadgets/unit_deathContainerSpawn.lua",
                    "luarules/gadgets/unit_auto_health_regeneration.lua",
                    "luarules/gadgets/unit_area_heal_radius.lua",
                    "luaui/widgets/gui_static_factionchooser.lua",
                    "luaui/widgets/gui_static_placement.lua",
                    "luaui/widgets/gui_static_sharemenu.lua",
                    "luaui/widgets/gui_static_selected_units_buttons.lua",
                    "luaui/widgets/gui_build_eta.lua",
                ]
            );
            assert!(adapter.units.is_empty() && adapter.features.is_empty());
            // The numbers on the game's resource bar that are not the
            // engine's: its supply and its research points (issue #3982).
            assert_eq!(
                adapter.team_params,
                ["supplyUsed", "supplyMax", "researchPoints"]
            );
            assert!(adapter.game_params.is_empty());
        }
        for other in ["MF", "BA"] {
            assert_eq!(choose(Ok(None), shipped, other, Some("1")), Chosen::none());
        }
    }

    /// Beyond All Reason's adapter is chosen for every version of the game and
    /// for no other. It has no range of versions, because the game has a new
    /// one most days and a replay is played on the one it was recorded on. What
    /// it switches off is spelled out here, so that a change to the list is a
    /// change somebody meant (issue #3801).
    #[test]
    fn beyond_all_reasons_adapter_is_for_every_version_of_it_and_no_other_game() {
        let shipped = super::super::REWIND_PLAYER_ADAPTERS;

        for (short_name, version) in [
            ("BYAR", Some("test-30922-8064a43")),
            ("BYAR", Some("test-1-0000000")),
            ("byar", Some("$VERSION")),
            ("BYAR", None),
        ] {
            let chosen = choose(Ok(None), shipped, short_name, version);
            assert_eq!(chosen.source, Source::App, "{version:?}");
            let adapter = chosen.adapter.unwrap();
            assert_eq!(adapter.name.as_deref(), Some("Beyond All Reason"));
            assert_eq!(
                adapter.shadows(),
                [
                    "luarules/gadgets/game_end.lua",
                    "luarules/gadgets/game_team_com_ends.lua",
                    "luarules/gadgets/game_initial_spawn.lua",
                    "luarules/gadgets/unit_tombstones.lua",
                    "luarules/gadgets/unit_prevent_lab_hax2.lua",
                    "luarules/gadgets/unit_mex_upgrade_reclaimer.lua",
                    "luarules/gadgets/unit_geo_upgrade_reclaimer.lua",
                    "luarules/gadgets/unit_footprint_clearance.lua",
                    "luarules/gadgets/unit_attached_con_turret.lua",
                    "luarules/gadgets/unit_attached_con_turret_mex.lua",
                    "luarules/gadgets/game_critters.lua",
                    "luarules/gadgets/unit_carrier_spawner.lua",
                    "luarules/gadgets/unit_explosion_spawner.lua",
                    "luarules/gadgets/unit_custom_weapons_cluster.lua",
                    "luarules/gadgets/unit_custom_weapons_behaviours.lua",
                    "luarules/gadgets/unit_custom_weapons_overpen.lua",
                    "luarules/gadgets/unit_lightning_splash_dmg.lua",
                    "luarules/gadgets/unit_juno_damage.lua",
                    "luarules/gadgets/unit_juno_damage_mini.lua",
                    "luarules/gadgets/unit_juno_rework_damage.lua",
                    "luarules/gadgets/game_preventcombomb.lua",
                    "luarules/gadgets/game_quick_start.lua",
                    "luarules/gadgets/game_assistdronespawn.lua",
                    "luarules/gadgets/game_commander_builder.lua",
                    "luarules/gadgets/game_coop_ii.lua",
                    "luarules/gadgets/unit_scenario_loadout.lua",
                    "luarules/gadgets/unit_zombies.lua",
                    "luarules/gadgets/unit_evolution.lua",
                    "luarules/gadgets/unit_respawning.lua",
                    "luarules/gadgets/unit_xmas.lua",
                    "luarules/gadgets/game_easter_eggs.lua",
                    "luarules/gadgets/ai_ruins.lua",
                    "luaui/widgets/gui_gridmenu.lua",
                    "luaui/widgets/gui_ordermenu.lua",
                    "luaui/widgets/camera_player_tv.lua",
                ]
            );
            assert!(adapter.units.is_empty() && adapter.features.is_empty());
            // What the game's panels read that is the game's own: each team's
            // commander and its energy converters (issue #3982).
            assert_eq!(
                adapter.team_params,
                ["startUnit", "mmLevel", "mmCapacity", "mmUse", "mmAvgEffi"]
            );
            assert!(adapter.game_params.is_empty());
        }
        // The original project still uses the short name BAR.
        for other in ["BAR", "BA", "SF"] {
            let chosen = choose(Ok(None), shipped, other, Some("1"));
            assert_ne!(
                chosen.adapter.and_then(|a| a.name).as_deref(),
                Some("Beyond All Reason"),
                "{other}"
            );
        }
    }

    /// The player reads the adapter from the path this side writes it to.
    #[test]
    fn the_adapter_sits_where_the_player_looks() {
        let reader = REWIND_PLAYER_FILES
            .iter()
            .find(|(rel, _)| *rel == "luarules/rewind_player/coilbox_player_adapter.lua")
            .expect("the player's adapter reader is shipped")
            .1;

        assert!(reader.contains(&format!("M.PATH = \"{PATH}\"")));
    }
}
