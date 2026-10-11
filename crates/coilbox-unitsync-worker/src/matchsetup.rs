//! One match's setup, for reading the unit list the engine built for it
//! (issue #3847).
//!
//! A replay names a unit by the engine's unit definition id, which is a
//! position in the list the engine built when that match loaded. The engine
//! ran the game's `gamedata/defs.lua` with the match's mod options, teams and
//! AIs to hand, and unitsync runs it with none. [`MatchSetup`] is what a start
//! script says about those, in the shape the engine holds it once
//! `CGameSetup::Init` has renumbered everything from zero. The content plugin
//! builds one from a replay's start script and the worker turns it into the
//! Lua table `lua/match-unit-list/match_unit_list.lua` answers from.
//!
//! Most replays need none of it. A match played with every mod option at the
//! game's own default and no Lua AI gets the list the game's unit pages
//! already read, and [`MatchSetup::reduced`] is what says so. Only the others
//! cost a second run of the game's definitions, once for each distinct setup.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The stand-in for the engine's team and option functions, and the engine's
/// rules for refusing a definition. Kept as a Lua file so its own test suite
/// runs it (`lua/match-unit-list/tests`).
pub const MATCH_UNIT_LIST_LUA: &str =
    include_str!("../../../lua/match-unit-list/match_unit_list.lua");

/// A match's setup as the engine holds it. Every index counts from zero with
/// no gaps, which is what `CGameSetup::Init` does to a start script's own
/// numbering, so a team's place in `teams` is its team id.
///
/// The maps are sorted and the fields are written in one order, so two equal
/// setups always serialise to the same text. The cache key is made from it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchSetup {
    /// The `[modoptions]` section, keys lowercased, values as written.
    pub mod_options: BTreeMap<String, String>,
    /// The `[mapoptions]` section, the same way.
    pub map_options: BTreeMap<String, String>,
    pub teams: Vec<MatchTeam>,
    pub ally_teams: Vec<MatchAllyTeam>,
    pub players: Vec<MatchPlayer>,
    /// The skirmish AIs in the order the script declares them, which is the
    /// order the engine numbers them in.
    pub ais: Vec<MatchAi>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchTeam {
    /// The leading player's id, or -1 for none.
    pub leader: i32,
    pub ally_team: i32,
    /// Lowercased, as `TeamBase::SetValue` keeps it.
    pub side: String,
    pub income_multiplier: f32,
    /// Every key of the team's section the engine has no field for.
    pub custom: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchAllyTeam {
    /// The other ally teams this one is allied with.
    pub allies: Vec<u32>,
    pub custom: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchPlayer {
    pub team: i32,
    pub spectator: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchAi {
    pub team: i32,
    pub short_name: String,
    /// The name the engine gave it, made unique among players and AIs.
    pub name: String,
    /// The hosting player's id.
    pub host: i32,
}

/// What a game says that decides whether a setup changes its unit list: each
/// mod option's default, and the short names of its Lua AIs. Read once for
/// each archive and kept beside its unit dataset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchFacts {
    /// Each declared mod option, by lowercased key.
    pub options: BTreeMap<String, OptionDefault>,
    /// The short names in the game's `LuaAI.lua`.
    pub lua_ais: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OptionDefault {
    /// `bool`, `number`, `list` or `string`.
    pub kind: String,
    pub default: String,
}

impl OptionDefault {
    /// Whether a start script's value is this option's default. A number or a
    /// boolean is compared as the 32 bit float the engine's Lua would hold,
    /// so `1` and `1.0` are one value. Anything else is compared as text.
    fn is(&self, value: &str) -> bool {
        if self.kind == "number" || self.kind == "bool" {
            if let (Ok(a), Ok(b)) = (
                value.trim().parse::<f32>(),
                self.default.trim().parse::<f32>(),
            ) {
                return a == b;
            }
        }
        value == self.default
    }
}

/// What the info cache holds under a match setup's key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "is", rename_all = "camelCase")]
pub enum MatchListEntry<T> {
    /// The list is the game's unit dataset, entry for entry, and is read from
    /// that blob.
    SameAsDefault,
    /// The list itself.
    List { dataset: T },
}

impl MatchSetup {
    /// The text the cache key is made from.
    pub fn canonical(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Whether the match has a Gaia team. `CGameSetup::Init` reads
    /// `ModOptions\LuaGaia` with a default of 1, as a C++ stream reads a
    /// bool: a whole number that is not zero, and false for text that is not
    /// a number.
    pub fn has_gaia(&self) -> bool {
        match self.mod_options.get("luagaia") {
            None => true,
            Some(value) => value.trim().parse::<i64>().is_ok_and(|n| n != 0),
        }
    }

    /// The setup to read the unit list with: this one, or the empty setup
    /// when nothing in it is known to change the list.
    ///
    /// That is a match whose every mod option is at the default the game
    /// declares and whose AIs are none of the game's Lua AIs. An option the
    /// game does not declare counts as changed, because a definition script
    /// can read any key.
    ///
    /// Teams, players and map options alone do not count. The read every unit
    /// page uses has none of them, and a replay read with it has to stay as
    /// cheap as it was.
    pub fn reduced(&self, facts: &MatchFacts) -> MatchSetup {
        let options_changed = self.mod_options.iter().any(|(key, value)| {
            !facts
                .options
                .get(key)
                .is_some_and(|option| option.is(value))
        });
        let lua_ai = self
            .ais
            .iter()
            .any(|ai| facts.lua_ais.contains(&ai.short_name));
        if options_changed || lua_ai {
            self.clone()
        } else {
            MatchSetup::default()
        }
    }

    /// The Lua that goes ahead of the script running `gamedata/defs.lua`: the
    /// setup as a table, then [`MATCH_UNIT_LIST_LUA`]. `lua_ais` is the game's
    /// own list, which is what makes an AI a Lua AI to the engine
    /// (`CSkirmishAIHandler::IsLuaAI`).
    ///
    /// The empty setup writes `nil` for the table, which installs nothing and
    /// leaves only the engine's refusal rules.
    pub fn prelude(&self, lua_ais: &[String]) -> String {
        if *self == MatchSetup::default() {
            return format!("local __cb_match = nil\n{MATCH_UNIT_LIST_LUA}\n");
        }
        format!(
            "local __cb_match = {}\n{MATCH_UNIT_LIST_LUA}\n",
            self.lua_table(lua_ais)
        )
    }

    /// The setup as the Lua table the stand-in reads, with the Gaia team and
    /// its ally team added the way `CTeamHandler::LoadFromSetup` adds them:
    /// last, allied with nobody but itself.
    fn lua_table(&self, lua_ais: &[String]) -> String {
        let gaia = self.has_gaia();
        let ally_count = self.ally_teams.len() + usize::from(gaia);

        let mut teams: Vec<String> = self
            .teams
            .iter()
            .map(|t| {
                lua_team(
                    t.leader,
                    t.ally_team,
                    &t.side,
                    t.income_multiplier,
                    &t.custom,
                )
            })
            .collect();
        if gaia {
            teams.push(lua_team(
                -1,
                self.ally_teams.len() as i32,
                "",
                1.0,
                &BTreeMap::new(),
            ));
        }

        let mut allies: Vec<String> = Vec::new();
        for (index, ally) in self.ally_teams.iter().enumerate() {
            let row: Vec<&str> = (0..ally_count)
                .map(|other| {
                    let allied = other == index || ally.allies.contains(&(other as u32));
                    // Gaia is every ally team's enemy.
                    let is_gaia = gaia && other == self.ally_teams.len();
                    if allied && !is_gaia {
                        "true"
                    } else {
                        "false"
                    }
                })
                .collect();
            allies.push(format!("{{ {} }}", row.join(", ")));
        }
        if gaia {
            let row: Vec<&str> = (0..ally_count)
                .map(|other| {
                    if other == self.ally_teams.len() {
                        "true"
                    } else {
                        "false"
                    }
                })
                .collect();
            allies.push(format!("{{ {} }}", row.join(", ")));
        }

        let mut ally_custom: Vec<String> =
            self.ally_teams.iter().map(|a| lua_map(&a.custom)).collect();
        if gaia {
            ally_custom.push("{}".into());
        }

        let players: Vec<String> = self
            .players
            .iter()
            .map(|p| format!("{{ team = {}, spectator = {} }}", p.team, p.spectator))
            .collect();

        let ais: Vec<String> = self
            .ais
            .iter()
            .map(|ai| {
                let lua = if lua_ais.contains(&ai.short_name) {
                    lua_string(&ai.short_name)
                } else {
                    "false".into()
                };
                format!(
                    "{{ team = {}, name = {}, host = {}, lua = {lua} }}",
                    ai.team,
                    lua_string(&ai.name),
                    ai.host
                )
            })
            .collect();

        format!(
            "{{\n  modOptions = {},\n  mapOptions = {},\n  teams = {{ {} }},\n  allies = {{ {} }},\n  allyCustom = {{ {} }},\n  players = {{ {} }},\n  ais = {{ {} }},\n  gaia = {},\n}}",
            lua_map(&self.mod_options),
            lua_map(&self.map_options),
            teams.join(", "),
            allies.join(", "),
            ally_custom.join(", "),
            players.join(", "),
            ais.join(", "),
            if gaia {
                self.teams.len().to_string()
            } else {
                "false".into()
            },
        )
    }
}

fn lua_team(
    leader: i32,
    ally: i32,
    side: &str,
    income: f32,
    custom: &BTreeMap<String, String>,
) -> String {
    let income = if income.is_finite() {
        format!("{}", f64::from(income))
    } else {
        "1".into()
    };
    format!(
        "{{ leader = {leader}, ally = {ally}, side = {}, income = {income}, custom = {} }}",
        lua_string(side),
        lua_map(custom)
    )
}

fn lua_map(map: &BTreeMap<String, String>) -> String {
    if map.is_empty() {
        return "{}".into();
    }
    let entries: Vec<String> = map
        .iter()
        .map(|(key, value)| format!("[{}] = {}", lua_string(key), lua_string(value)))
        .collect();
    format!("{{ {} }}", entries.join(", "))
}

/// A Lua string literal holding exactly `text`, in ASCII. The same escaping
/// `defsprobe.rs` uses for the files it lays over a game.
fn lua_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for byte in text.bytes() {
        match byte {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            b' '..=b'~' => out.push(byte as char),
            _ => out.push_str(&format!("\\{byte:03}")),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape the content plugin writes, shared with its own test so the
    /// two halves cannot drift apart.
    const FIXTURE: &str = include_str!("../tests/fixtures/match_setup.json");

    fn fixture() -> MatchSetup {
        serde_json::from_str(FIXTURE).expect("the fixture")
    }

    fn option(kind: &str, default: &str) -> OptionDefault {
        OptionDefault {
            kind: kind.into(),
            default: default.into(),
        }
    }

    fn facts() -> MatchFacts {
        MatchFacts {
            options: BTreeMap::from([
                ("maxunits".to_string(), option("number", "2000")),
                ("unit_pack".to_string(), option("bool", "0")),
                ("map_waterlevel".to_string(), option("number", "0")),
                ("scoremode".to_string(), option("list", "disabled")),
            ]),
            lua_ais: vec!["RaptorsAI".into()],
        }
    }

    #[test]
    fn the_fixture_reads_and_writes_back_as_itself() {
        let setup = fixture();
        assert_eq!(setup.teams.len(), 3);
        assert_eq!(setup.ais[0].short_name, "RaptorsAI");
        let again: MatchSetup = serde_json::from_str(&setup.canonical()).unwrap();
        assert_eq!(again, setup);
        // The fixture is in the canonical form already, so the key made from
        // what the content plugin sends is the key made from what is parsed.
        assert_eq!(setup.canonical(), FIXTURE.trim());
    }

    #[test]
    fn a_setup_at_the_games_defaults_with_no_lua_ai_is_the_empty_one() {
        let mut setup = fixture();
        setup.ais[0].short_name = "BARb".into();
        setup.mod_options = BTreeMap::from([
            ("maxunits".to_string(), "2000".to_string()),
            ("unit_pack".to_string(), "0".to_string()),
            ("map_waterlevel".to_string(), "0.0".to_string()),
            ("scoremode".to_string(), "disabled".to_string()),
        ]);
        assert_eq!(setup.reduced(&facts()), MatchSetup::default());
    }

    #[test]
    fn a_changed_option_keeps_the_whole_setup() {
        let mut setup = fixture();
        setup.ais.clear();
        setup.mod_options = BTreeMap::from([("unit_pack".to_string(), "1".to_string())]);
        assert_eq!(setup.reduced(&facts()), setup);
    }

    #[test]
    fn an_option_the_game_does_not_declare_keeps_the_whole_setup() {
        let mut setup = fixture();
        setup.ais.clear();
        setup.mod_options = BTreeMap::from([("tweakdefs".to_string(), String::new())]);
        assert_eq!(setup.reduced(&facts()), setup);
    }

    #[test]
    fn a_lua_ai_keeps_the_whole_setup() {
        let mut setup = fixture();
        setup.mod_options.clear();
        assert_eq!(setup.reduced(&facts()), setup);
    }

    #[test]
    fn a_list_option_is_compared_as_text() {
        assert!(option("list", "disabled").is("disabled"));
        assert!(!option("list", "disabled").is("Disabled"));
        assert!(option("number", "0.5").is(".5"));
        assert!(!option("number", "0.5").is("0.6"));
        assert!(option("bool", "1").is("1.0"));
    }

    #[test]
    fn gaia_follows_the_luagaia_option() {
        let mut setup = MatchSetup::default();
        assert!(setup.has_gaia());
        setup.mod_options.insert("luagaia".into(), "0".into());
        assert!(!setup.has_gaia());
        setup.mod_options.insert("luagaia".into(), "1".into());
        assert!(setup.has_gaia());
        setup.mod_options.insert("luagaia".into(), "false".into());
        assert!(!setup.has_gaia());
    }

    #[test]
    fn the_empty_setup_installs_nothing() {
        let prelude = MatchSetup::default().prelude(&[]);
        assert!(prelude.starts_with("local __cb_match = nil\n"));
        assert!(prelude.contains("local function __cb_engine_keeps"));
    }

    #[test]
    fn the_table_adds_gaia_last_and_marks_the_lua_ai() {
        let table = fixture().lua_table(&["RaptorsAI".to_string()]);
        // Three teams in the script, so Gaia is team 3 on ally team 2.
        assert!(table.contains("gaia = 3,"), "{table}");
        assert!(
            table.contains("{ leader = -1, ally = 2, side = \"\", income = 1, custom = {} }"),
            "{table}"
        );
        assert!(
            table.contains("allies = { { true, false, false }, { false, true, false }, { false, false, true } }"),
            "{table}"
        );
        assert!(table.contains("lua = \"RaptorsAI\""), "{table}");
        let native = fixture().lua_table(&[]);
        assert!(native.contains("lua = false"), "{native}");
    }

    #[test]
    fn a_value_cannot_end_its_string() {
        assert_eq!(lua_string("a\"b\\c\n"), "\"a\\\"b\\\\c\\010\"");
    }

    #[test]
    fn the_entry_says_which_of_the_two_it_is() {
        let same: MatchListEntry<u32> = MatchListEntry::SameAsDefault;
        assert_eq!(
            serde_json::to_string(&same).unwrap(),
            r#"{"is":"sameAsDefault"}"#
        );
        let list = MatchListEntry::List { dataset: 7u32 };
        assert_eq!(
            serde_json::to_string(&list).unwrap(),
            r#"{"is":"list","dataset":7}"#
        );
    }
}
