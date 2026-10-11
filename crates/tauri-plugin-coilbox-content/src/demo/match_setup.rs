//! A replay's start script as the engine holds it once it has read it (#3847).
//!
//! A replay names a unit by the engine's unit definition id, a position in the
//! list the engine built when the match loaded. The engine built it with the
//! match's mod options, teams and AIs to hand, so reading that list back needs
//! them too. This is what the start script says about each, renumbered the way
//! `CGameSetup::Init` (`rts/Game/GameSetup.cpp` in the engine) renumbers it:
//! players, teams and ally teams counted from zero in the order of their
//! section numbers, with every reference to one moved to its new number.
//!
//! The unitsync worker reads this and answers the engine's team and option
//! functions from it (`coilbox_unitsync_worker::matchsetup`). The two crates do
//! not depend on each other, so the shape is pinned by one fixture both test
//! against.
//!
//! No player's name is in it. A name is read only to give an AI the name the
//! engine would, which has to differ from every player's.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

use super::{index_suffix, Section};

/// `MAX_PLAYERS` and `MAX_TEAMS` in the engine's
/// `rts/Sim/Misc/GlobalConstants.h`. The engine looks for sections numbered
/// below these and for no others.
const MAX_PLAYERS: i32 = 251;
const MAX_TEAMS: i32 = 255;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchSetup {
    pub mod_options: BTreeMap<String, String>,
    pub map_options: BTreeMap<String, String>,
    pub teams: Vec<MatchTeam>,
    pub ally_teams: Vec<MatchAllyTeam>,
    pub players: Vec<MatchPlayer>,
    pub ais: Vec<MatchAi>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchTeam {
    pub leader: i32,
    pub ally_team: i32,
    pub side: String,
    pub income_multiplier: f32,
    pub custom: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchAllyTeam {
    pub allies: Vec<u32>,
    pub custom: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchPlayer {
    pub team: i32,
    pub spectator: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchAi {
    pub team: i32,
    pub short_name: String,
    pub name: String,
    pub host: i32,
}

/// C's `atoi`: the whole number a string starts with, or zero.
fn atoi(text: &str) -> i32 {
    let text = text.trim_start();
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (-1i64, rest),
        None => (1, text.strip_prefix('+').unwrap_or(text)),
    };
    let end = digits
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(digits.len());
    digits[..end]
        .parse::<i64>()
        .map(|n| (sign * n).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32)
        .unwrap_or(0)
}

/// C's `atof`, as far as a start script writes a number.
fn atof(text: &str) -> f32 {
    let text = text.trim();
    let end = text
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E')))
        .unwrap_or(text.len());
    text[..end].parse::<f32>().unwrap_or(0.0)
}

/// The numbered sections of one kind, lowest number first, which is the order
/// the engine walks them in.
fn numbered<'a>(game: &'a Section, prefix: &str, below: i32) -> Vec<(i32, &'a Section)> {
    let mut found: Vec<(i32, &Section)> = Vec::new();
    for (name, section) in &game.children {
        let Some(index) = index_suffix(name, prefix) else {
            continue;
        };
        // A number written with a sign or leading zeros is not one the engine
        // would ask for by name.
        if !(0..below).contains(&index) || *name != format!("{prefix}{index}") {
            continue;
        }
        if !found.iter().any(|(seen, _)| *seen == index) {
            found.push((index, section));
        }
    }
    found.sort_by_key(|(index, _)| *index);
    found
}

fn section_map(section: Option<&Section>) -> BTreeMap<String, String> {
    section
        .map(|s| s.keys.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// The setup a start script describes, or `None` for a script the engine would
/// refuse to start: a team led by a player that is not there, a team on an ally
/// team that is not there, or an AI on a team or hosted by a player that is not
/// there. A replay of a match that was played has none of these.
pub(super) fn match_setup(game: &Section) -> Option<MatchSetup> {
    // `LoadPlayers`: the player's new number is its place among the sections.
    let player_sections = numbered(game, "player", MAX_PLAYERS);
    let player_remap: HashMap<i32, i32> = player_sections
        .iter()
        .enumerate()
        .map(|(new, (old, _))| (*old, new as i32))
        .collect();
    let mut names: HashSet<String> = player_sections
        .iter()
        .filter_map(|(_, p)| p.get("name").map(str::to_string))
        .collect();

    // `LoadSkirmishAIs`: the visible name is made unique among the players and
    // the AIs before it.
    let mut ais: Vec<MatchAi> = Vec::new();
    for (_, ai) in numbered(game, "ai", MAX_PLAYERS) {
        let short_name = ai.get("shortname").unwrap_or("").to_string();
        let visible = ai.get("name").unwrap_or(&short_name).to_string();
        let mut name = visible.clone();
        let mut instance = 0;
        while names.contains(&name) {
            name = format!("{visible}_{instance}");
            instance += 1;
        }
        names.insert(name.clone());
        ais.push(MatchAi {
            team: atoi(ai.get("team").unwrap_or("-1")),
            short_name,
            name,
            host: atoi(ai.get("host").unwrap_or("-1")),
        });
    }

    // `LoadTeams`, with `TeamBase::SetValue` (`rts/Sim/Misc/TeamBase.cpp`)
    // deciding which keys are the team's own fields and which are custom.
    let team_sections = numbered(game, "team", MAX_TEAMS);
    let team_remap: HashMap<i32, i32> = team_sections
        .iter()
        .enumerate()
        .map(|(new, (old, _))| (*old, new as i32))
        .collect();
    let mut teams: Vec<MatchTeam> = Vec::new();
    for (_, section) in &team_sections {
        let mut team = MatchTeam {
            leader: -1,
            ally_team: -1,
            side: String::new(),
            income_multiplier: 1.0,
            custom: BTreeMap::new(),
        };
        // `SetAdvantage` and `SetIncomeMultiplier`. The engine applies the keys
        // in its hash map's order, so a script that sets more than one of the
        // three has no defined answer there. Here the last of them wins.
        let advantage = |a: f32| (a.max(-1.0) + 1.0).max(0.0);
        if let Some(value) = section.get("handicap") {
            team.income_multiplier = advantage(atof(value) / 100.0);
        }
        if let Some(value) = section.get("advantage") {
            team.income_multiplier = advantage(atof(value));
        }
        if let Some(value) = section.get("incomemultiplier") {
            team.income_multiplier = atof(value).max(0.0);
        }
        for (key, value) in &section.keys {
            match key.as_str() {
                "handicap" | "advantage" | "incomemultiplier" => {}
                "rgbcolor" | "startposx" | "startposz" => {}
                "teamleader" => team.leader = atoi(value),
                "allyteam" => team.ally_team = atoi(value),
                "side" => team.side = value.to_lowercase(),
                _ => {
                    team.custom.insert(key.clone(), value.clone());
                }
            }
        }
        teams.push(team);
    }

    // `LoadAllyTeams`. The engine reads each ally team's allies from the
    // section numbered by its new place and not by its own number, so that is
    // the section read here too.
    let ally_sections = numbered(game, "allyteam", MAX_TEAMS);
    let ally_remap: HashMap<i32, i32> = ally_sections
        .iter()
        .enumerate()
        .map(|(new, (old, _))| (*old, new as i32))
        .collect();
    let mut ally_teams: Vec<MatchAllyTeam> = Vec::new();
    for (new, (_, section)) in ally_sections.iter().enumerate() {
        let custom = section
            .keys
            .iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "startrecttop" | "startrectbottom" | "startrectleft" | "startrectright"
                )
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let mut allies: Vec<u32> = Vec::new();
        if let Some(read) = game.child(&format!("allyteam{new}")) {
            let count = atoi(read.get("numallies").unwrap_or("0"));
            for b in 0..count.max(0) {
                let other = atoi(read.get(&format!("ally{b}")).unwrap_or("0"));
                // A number that names no ally team reads as the first one.
                let other = ally_remap.get(&other).copied().unwrap_or(0) as u32;
                if other as usize != new && !allies.contains(&other) {
                    allies.push(other);
                }
            }
        }
        allies.sort_unstable();
        ally_teams.push(MatchAllyTeam { allies, custom });
    }

    // `RemapPlayers`, `RemapTeams` and `RemapAllyteams`.
    for team in &mut teams {
        team.leader = *player_remap.get(&team.leader)?;
        team.ally_team = *ally_remap.get(&team.ally_team)?;
    }
    for ai in &mut ais {
        ai.team = *team_remap.get(&ai.team)?;
        ai.host = *player_remap.get(&ai.host)?;
    }
    let mut players: Vec<MatchPlayer> = Vec::new();
    for (_, section) in &player_sections {
        let spectator = atoi(section.get("spectator").unwrap_or("0")) != 0;
        let team = if spectator {
            // A spectator starts out watching the first team.
            0
        } else {
            *team_remap.get(&atoi(section.get("team").unwrap_or("0")))?
        };
        players.push(MatchPlayer { team, spectator });
    }

    Some(MatchSetup {
        mod_options: section_map(game.child("modoptions")),
        map_options: section_map(game.child("mapoptions")),
        teams,
        ally_teams,
        players,
        ais,
    })
}

#[cfg(test)]
mod tests {
    use super::super::{find_game, parse_tdf};
    use super::*;

    /// The shape the unitsync worker reads, from its own tests.
    const FIXTURE: &str =
        include_str!("../../../coilbox-unitsync-worker/tests/fixtures/match_setup.json");

    /// Sections numbered with gaps and out of order, a spectator on a team, a
    /// team colour, a start box and an old style handicap.
    const SCRIPT: &str = "[GAME]\n{\n\
        [modoptions]\n{\nexperimentallegionfaction=1;\nMaxUnits=2000;\n}\n\
        [TEAM7]\n{\nteamleader=3;\nallyteam=3;\nhandicap=50;\nraptorstartbox=1;\n}\n\
        [PLAYER9]\n{\nname=Carol;\nteam=4;\nspectator=1;\n}\n\
        [PLAYER3]\n{\nname=Alice;\nteam=2;\nspectator=0;\n}\n\
        [PLAYER5]\n{\nname=Bob;\nteam=4;\n}\n\
        [AI0]\n{\nname=Raptors;\nshortname=RaptorsAI;\nteam=7;\nhost=3;\n}\n\
        [TEAM2]\n{\nteamleader=3;\nallyteam=1;\nside=Armada;\nrgbcolor=1 0 0;\n}\n\
        [TEAM4]\n{\nteamleader=5;\nallyteam=1;\nside=Cortex;\n}\n\
        [ALLYTEAM1]\n{\nnumallies=0;\nstartrecttop=0;\n}\n\
        [ALLYTEAM3]\n{\nnumallies=0;\n}\n\
        }\n";

    fn setup_of(script: &str) -> Option<MatchSetup> {
        match_setup(&find_game(&parse_tdf(script)))
    }

    #[test]
    fn a_script_is_renumbered_the_way_the_engine_does_it() {
        let setup = setup_of(SCRIPT).expect("a script the engine would start");
        assert_eq!(serde_json::to_string(&setup).unwrap(), FIXTURE.trim());
    }

    #[test]
    fn an_ai_named_like_a_player_gets_a_name_of_its_own() {
        let script = SCRIPT.replace("name=Raptors;", "name=Alice;");
        let setup = setup_of(&script).unwrap();
        assert_eq!(setup.ais[0].name, "Alice_0");
    }

    #[test]
    fn an_ai_with_no_name_is_called_by_its_short_name() {
        let script = SCRIPT.replace("name=Raptors;\n", "");
        assert_eq!(setup_of(&script).unwrap().ais[0].name, "RaptorsAI");
    }

    #[test]
    fn allies_are_read_and_renumbered() {
        let script = SCRIPT.replace(
            "[ALLYTEAM1]\n{\nnumallies=0;",
            "[ALLYTEAM1]\n{\nnumallies=1;\nally0=1;",
        );
        let setup = setup_of(&script).unwrap();
        // The engine reads the allies of the ally team now numbered 1 from the
        // section numbered 1, which is the first one's.
        assert_eq!(setup.ally_teams[0].allies, Vec::<u32>::new());
        assert_eq!(setup.ally_teams[1].allies, vec![0]);
    }

    #[test]
    fn the_newer_income_keys_are_read() {
        let advantage = SCRIPT.replace("handicap=50;", "advantage=0.25;");
        assert_eq!(
            setup_of(&advantage).unwrap().teams[2].income_multiplier,
            1.25
        );
        let income = SCRIPT.replace("handicap=50;", "incomemultiplier=3;");
        assert_eq!(setup_of(&income).unwrap().teams[2].income_multiplier, 3.0);
    }

    #[test]
    fn a_script_the_engine_would_refuse_has_no_setup() {
        let no_leader = SCRIPT.replace("teamleader=5;", "teamleader=6;");
        assert_eq!(setup_of(&no_leader), None);
        let no_ally = SCRIPT.replace("allyteam=3;", "allyteam=2;");
        assert_eq!(setup_of(&no_ally), None);
        let no_team = SCRIPT.replace("team=7;\nhost=3;", "team=8;\nhost=3;");
        assert_eq!(setup_of(&no_team), None);
    }

    #[test]
    fn a_script_with_nothing_in_it_is_the_empty_setup() {
        assert_eq!(setup_of("[GAME]\n{\n}\n"), Some(MatchSetup::default()));
    }

    #[test]
    fn numbers_are_read_as_c_reads_them() {
        assert_eq!(atoi(" 12abc"), 12);
        assert_eq!(atoi("-3"), -3);
        assert_eq!(atoi("abc"), 0);
        assert_eq!(atof("1.5 "), 1.5);
        assert_eq!(atof("x"), 0.0);
    }
}
