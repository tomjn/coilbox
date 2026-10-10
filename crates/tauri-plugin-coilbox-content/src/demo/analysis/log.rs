//! Reading the replay logger's file (issues #1154 and #1159).
//!
//! The logger, `lua/replay-logger/luarules/gadgets/coilbox_replay_logger.lua`,
//! writes one JSON object per line and flushes each one. Every line has a
//! `kind`. The format is meant to grow: a later logger adds kinds for damage,
//! army value and projectiles, and fields to the kinds here. So this reader
//! keeps a kind it does not know as [`LogLine::Unknown`] rather than failing,
//! and ignores a field it does not know.
//!
//! A file that stops part way through is expected, because an engine that is
//! killed or crashes leaves one. Every line up to the last whole one reads, and
//! [`EventLog::truncated`] says the last one did not.

use serde::{Deserialize, Serialize};

use super::super::def_sets::UnitDef;

/// The format this reader was written against. The logger raises its own
/// number when a line loses or changes a field, never for an addition.
pub const FORMAT_VERSION: u32 = 1;

/// Which logger this coilbox ships, counted up from 1. Raised whenever the
/// gadget starts recording something it did not before: a new kind of line, or
/// a new field on an old one. The gadget does not write it. It is stamped on a
/// stored analysis, so a file from before the change can be told from one made
/// after it. `the_logger_writes_the_kinds_this_version_stands_for` fails when
/// the gadget gains a kind and this was not raised with it.
pub const LOGGER_VERSION: u32 = 3;

/// The first line: what the gadget saw the run as.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LogHeader {
    pub format: u32,
    /// `Game.gameName`, which under the analysis game is the analysis game's
    /// name and not the one the replay was recorded on.
    pub game: String,
    pub game_version: String,
    pub game_short_name: String,
    pub map: String,
    pub engine: String,
    /// The map's size in world units, which is what turns a position into a
    /// place on a map picture.
    pub map_size_x: f32,
    pub map_size_z: f32,
    pub gaia_team: i32,
    /// How many frames lie between two `start_unit_position` lines for one
    /// unit. 0 from a logger that wrote none.
    pub position_frames: i32,
    /// How many `unit_def` lines follow. 0 from a logger that wrote none.
    pub unit_defs: u32,
}

/// A unit being created, finished, destroyed or handed to another team.
///
/// `def` is a unit definition id as that run's engine numbered them. `x`, `y`
/// and `z` are world coordinates, where the unit was on that frame.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitEvent {
    pub frame: i32,
    pub unit: i32,
    pub def: i32,
    pub team: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    /// Present and true on a unit its team started with: one created for a
    /// team other than Gaia, by no builder, on the frame that team's first unit
    /// was created. The engine has no idea of a commander, so this is not one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_unit: Option<bool>,
    /// The team the unit left. On `unit_given` only, where `team` is the team
    /// it went to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<i32>,
    /// Present and true on a `unit_given` the engine counted as a capture, and
    /// absent on a gift.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured: Option<bool>,
    /// The unit that built it. On `unit_created` only, and absent for a unit
    /// nothing built.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builder: Option<i32>,
    /// What destroyed it. On `unit_destroyed` only, and absent for a death with
    /// no attacker, which is how the engine reports a cancelled build or a self
    /// destruct.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_def: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attacker_team: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon: Option<i32>,
}

/// Where a living start unit was. Written every [`LogHeader::position_frames`]
/// frames, and left out when the unit has not moved since the last one. Its
/// `unit_created` line is its first position and its `unit_destroyed` line its
/// last.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartUnitPosition {
    pub frame: i32,
    pub unit: i32,
    /// The team the unit belonged to on that frame.
    pub team: i32,
    pub x: f32,
    pub z: f32,
}

/// One of the engine's unit definitions, as the run's own `UnitDefs` table had
/// it. The logger writes one for each, in id order, straight after the header.
/// Every `def` on a later line is an `id` here.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitDefLine {
    pub id: u32,
    #[serde(flatten)]
    pub def: UnitDef,
}

/// One team's last statistics sample as Lua read it when the game ended, with
/// the number of samples the team had. The fields are the engine's own
/// `TeamStatistics`, the same ones the replay's trailer holds.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LoggedTeam {
    pub team: i32,
    pub samples: usize,
    /// The frame the game ended on. Lua reports the current frame for a team's
    /// newest sample, where the trailer holds the frame its next sample was due.
    pub frame: i32,
    pub metal_used: f32,
    pub energy_used: f32,
    pub metal_produced: f32,
    pub energy_produced: f32,
    pub metal_excess: f32,
    pub energy_excess: f32,
    pub metal_received: f32,
    pub energy_received: f32,
    pub metal_sent: f32,
    pub energy_sent: f32,
    pub damage_dealt: f32,
    pub damage_received: f32,
    pub units_produced: i32,
    pub units_died: i32,
    pub units_received: i32,
    pub units_sent: i32,
    pub units_captured: i32,
    pub units_out_captured: i32,
    pub units_killed: i32,
}

/// The last line: who won, on which frame, and every team's totals.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LoggedGameOver {
    pub frame: i32,
    pub winners: Vec<u32>,
    pub teams: Vec<LoggedTeam>,
}

/// One line of the log.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LogLine {
    Header(LogHeader),
    /// Boxed because a definition is several times the size of any other line.
    UnitDef(Box<UnitDefLine>),
    GameStart {
        frame: i32,
    },
    UnitCreated(UnitEvent),
    UnitFinished(UnitEvent),
    UnitDestroyed(UnitEvent),
    UnitGiven(UnitEvent),
    StartUnitPosition(StartUnitPosition),
    GameOver(LoggedGameOver),
    /// A kind a later logger writes and this reader does not know.
    #[serde(other)]
    Unknown,
}

/// How many lines of each kind a log holds. This is what a run is judged on: a
/// logger that never loaded writes nothing and raises nothing, so the counts
/// are the only thing that tells it from a quiet match.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct EventCounts {
    pub header: usize,
    /// The engine's unit definitions. A stored file keeps this count and not
    /// the lines, which go to the unit definition store.
    pub unit_def: usize,
    pub game_start: usize,
    pub unit_created: usize,
    pub unit_finished: usize,
    pub unit_destroyed: usize,
    pub unit_given: usize,
    pub start_unit_position: usize,
    pub game_over: usize,
    /// Lines of a kind this reader does not know.
    pub unknown: usize,
}

/// A parsed log.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EventLog {
    /// Every line that read, in file order, the header and game over included.
    pub lines: Vec<LogLine>,
    /// Whole lines that are not a JSON object with a `kind`. A healthy log has
    /// none.
    pub malformed: usize,
    /// The file ended part way through a line, which is what an interrupted run
    /// leaves. Everything before it still read.
    pub truncated: bool,
}

impl EventLog {
    pub fn header(&self) -> Option<&LogHeader> {
        self.lines.iter().find_map(|line| match line {
            LogLine::Header(header) => Some(header),
            _ => None,
        })
    }

    pub fn game_over(&self) -> Option<&LoggedGameOver> {
        self.lines.iter().find_map(|line| match line {
            LogLine::GameOver(over) => Some(over),
            _ => None,
        })
    }

    pub fn counts(&self) -> EventCounts {
        let mut counts = EventCounts::default();
        for line in &self.lines {
            match line {
                LogLine::Header(_) => counts.header += 1,
                LogLine::UnitDef(_) => counts.unit_def += 1,
                LogLine::GameStart { .. } => counts.game_start += 1,
                LogLine::UnitCreated(_) => counts.unit_created += 1,
                LogLine::UnitFinished(_) => counts.unit_finished += 1,
                LogLine::UnitDestroyed(_) => counts.unit_destroyed += 1,
                LogLine::UnitGiven(_) => counts.unit_given += 1,
                LogLine::StartUnitPosition(_) => counts.start_unit_position += 1,
                LogLine::GameOver(_) => counts.game_over += 1,
                LogLine::Unknown => counts.unknown += 1,
            }
        }
        counts
    }
}

/// The engine's unit definitions in id order, when `lines` hold the whole
/// list: as many as the header says, with ids that count up from 1. Anything
/// else is no list, because a definition is found by its place in it and a
/// list with a hole would name the wrong unit for every id after the hole.
pub fn unit_defs_of(lines: &[LogLine]) -> Option<Vec<UnitDef>> {
    let expected = lines.iter().find_map(|line| match line {
        LogLine::Header(header) => Some(header.unit_defs as usize),
        _ => None,
    })?;
    let defs: Vec<&UnitDefLine> = lines
        .iter()
        .filter_map(|line| match line {
            LogLine::UnitDef(def) => Some(def.as_ref()),
            _ => None,
        })
        .collect();
    let whole = expected > 0
        && defs.len() == expected
        && defs
            .iter()
            .enumerate()
            .all(|(index, line)| line.id as usize == index + 1);
    whole.then(|| defs.into_iter().map(|line| line.def.clone()).collect())
}

/// Parse the logger's file.
///
/// The logger ends every line with a newline, so text after the last newline is
/// a line that was being written when the run stopped.
pub fn parse_log(text: &str) -> EventLog {
    let mut log = EventLog::default();
    let (whole, rest) = match text.rfind('\n') {
        Some(end) => (&text[..end], &text[end + 1..]),
        None => ("", text),
    };
    log.truncated = !rest.trim().is_empty();
    for line in whole.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<LogLine>(line) {
            Ok(parsed) => log.lines.push(parsed),
            Err(_) => log.malformed += 1,
        }
    }
    log
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// What the logger's own fixture match writes. `lua/replay-logger/tests/
    /// logger_test.lua` fails if the logger stops producing exactly this, and
    /// the tests here fail if the reader stops understanding it.
    pub(in super::super) const FIXTURE: &str =
        include_str!("../../../../../lua/replay-logger/tests/fixtures/match.jsonl");

    #[test]
    fn the_fixture_match_reads_with_the_counts_the_logger_test_asserts() {
        let log = parse_log(FIXTURE);

        assert_eq!(
            log.counts(),
            EventCounts {
                header: 1,
                unit_def: 0,
                game_start: 1,
                unit_created: 7,
                unit_finished: 6,
                unit_destroyed: 4,
                unit_given: 2,
                start_unit_position: 2,
                game_over: 1,
                unknown: 0,
            }
        );
        assert_eq!(log.malformed, 0);
        assert!(!log.truncated);
    }

    /// Ties [`LOGGER_VERSION`] to the gadget. A stored analysis is called
    /// outdated by that number alone, so a gadget that gains a kind without it
    /// being raised would leave old files looking current.
    #[test]
    fn the_logger_writes_the_kinds_this_version_stands_for() {
        // A line's kind is either written out in the line, or handed to the
        // function that builds a unit's line.
        let logger = super::super::game::LOGGER;
        let mut kinds: Vec<&str> = ["\"kind\":\"", "unitLine(\""]
            .iter()
            .flat_map(|marker| logger.split(marker).skip(1))
            .filter_map(|rest| rest.split('"').next())
            .filter(|kind| {
                !kind.is_empty() && kind.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
            })
            .collect();
        kinds.sort_unstable();
        kinds.dedup();

        assert_eq!(
            (LOGGER_VERSION, kinds),
            (
                3,
                vec![
                    "game_over",
                    "game_start",
                    "header",
                    "start_unit_position",
                    "unit_created",
                    "unit_def",
                    "unit_destroyed",
                    "unit_finished",
                    "unit_given"
                ]
            ),
            "the gadget writes a different set of kinds: raise LOGGER_VERSION and update this list"
        );
    }

    #[test]
    fn the_header_says_what_the_gadget_saw() {
        let log = parse_log(FIXTURE);
        let header = log.header().expect("header");

        assert_eq!(header.format, FORMAT_VERSION);
        assert_eq!(header.game, "Test Game");
        assert_eq!(header.game_version, "1.0");
        assert_eq!(header.game_short_name, "TG");
        assert_eq!(header.map, "Test Map");
        assert_eq!(header.engine, "2026.01.0 test");
        assert_eq!((header.map_size_x, header.map_size_z), (4096.0, 2048.0));
        assert_eq!(header.gaia_team, 2);
        assert_eq!(header.position_frames, 60);
        assert_eq!(header.unit_defs, 0);
    }

    #[test]
    fn a_destroyed_unit_carries_where_it_died_and_what_killed_it() {
        let log = parse_log(FIXTURE);
        let destroyed: Vec<&UnitEvent> = log
            .lines
            .iter()
            .filter_map(|line| match line {
                LogLine::UnitDestroyed(event) => Some(event),
                _ => None,
            })
            .collect();

        assert_eq!(
            destroyed[1],
            &UnitEvent {
                frame: 900,
                unit: 5,
                def: 50,
                team: 1,
                x: 2000.0,
                y: 7.5,
                z: 1000.0,
                start_unit: None,
                from: None,
                captured: None,
                builder: None,
                attacker: Some(3),
                attacker_def: Some(40),
                attacker_team: Some(0),
                weapon: Some(7),
            }
        );
        // A cancelled build: a death nothing caused.
        assert_eq!(destroyed[0].attacker, None);
        assert_eq!(destroyed[0].attacker_team, None);
    }

    #[test]
    fn a_created_unit_names_its_builder_when_it_has_one() {
        let log = parse_log(FIXTURE);
        let created: Vec<&UnitEvent> = log
            .lines
            .iter()
            .filter_map(|line| match line {
                LogLine::UnitCreated(event) => Some(event),
                _ => None,
            })
            .collect();

        assert_eq!(created[0].builder, None);
        assert_eq!(created[2].builder, Some(1));
        assert_eq!(
            (created[0].x, created[0].y, created[0].z),
            (100.0, 5.3, 200.0)
        );
    }

    /// The totals are 32 bit floats in the engine and in the trailer. The
    /// logger writes enough digits for each to read back as the same float.
    #[test]
    fn the_game_over_totals_read_back_as_the_floats_the_engine_held() {
        let log = parse_log(FIXTURE);
        let over = log.game_over().expect("game over");

        assert_eq!(over.frame, 1501);
        assert_eq!(over.winners, vec![0]);
        assert_eq!(over.teams.len(), 2);
        let team = &over.teams[0];
        assert_eq!((team.team, team.samples, team.frame), (0, 3, 1501));
        assert_eq!(team.metal_used, 1234.5677_f32);
        assert_eq!(team.metal_excess, 0.3_f32);
        assert_eq!(team.energy_produced, 9000.5);
        assert_eq!(
            (team.units_produced, team.units_died, team.units_killed),
            (4, 1, 2)
        );
        assert_eq!(over.teams[1].damage_received, 4100.0);
    }

    #[test]
    fn a_unit_its_team_started_with_says_so_and_no_other_unit_does() {
        let log = parse_log(FIXTURE);
        let flagged: Vec<(i32, i32)> = log
            .lines
            .iter()
            .filter_map(|line| match line {
                LogLine::UnitCreated(event) if event.start_unit == Some(true) => {
                    Some((event.unit, event.team))
                }
                _ => None,
            })
            .collect();

        assert_eq!(flagged, vec![(1, 0), (2, 1)]);
        let last = log.lines.iter().rev().find_map(|line| match line {
            LogLine::UnitDestroyed(event) => Some(event),
            _ => None,
        });
        assert_eq!(last.map(|e| (e.unit, e.start_unit)), Some((2, Some(true))));
    }

    #[test]
    fn a_unit_that_changed_team_names_both_teams_and_whether_it_was_captured() {
        let log = parse_log(FIXTURE);
        let given: Vec<&UnitEvent> = log
            .lines
            .iter()
            .filter_map(|line| match line {
                LogLine::UnitGiven(event) => Some(event),
                _ => None,
            })
            .collect();

        assert_eq!(given.len(), 2);
        assert_eq!((given[0].frame, given[0].unit, given[0].def), (1050, 6, 52));
        assert_eq!(
            (given[0].team, given[0].from, given[0].captured),
            (1, Some(0), None)
        );
        assert_eq!(
            (given[1].team, given[1].from, given[1].captured),
            (0, Some(1), Some(true))
        );
        assert_eq!((given[0].x, given[0].z), (300.0, 300.0));
    }

    #[test]
    fn a_start_units_position_carries_the_frame_the_team_and_the_place() {
        let log = parse_log(FIXTURE);
        let positions: Vec<&StartUnitPosition> = log
            .lines
            .iter()
            .filter_map(|line| match line {
                LogLine::StartUnitPosition(position) => Some(position),
                _ => None,
            })
            .collect();

        assert_eq!(
            positions,
            vec![
                &StartUnitPosition {
                    frame: 120,
                    unit: 1,
                    team: 0,
                    x: 130.0,
                    z: 215.0,
                },
                &StartUnitPosition {
                    frame: 660,
                    unit: 2,
                    team: 1,
                    x: 3850.0,
                    z: 1790.0,
                },
            ]
        );
    }

    /// The store writes each line back out, so a new kind or field has to
    /// survive that or a stored file would lose it.
    #[test]
    fn the_new_lines_serialise_back_as_the_logger_wrote_them() {
        for line in FIXTURE.lines().filter(|line| {
            line.contains("unit_given")
                || line.contains("start_unit_position")
                || line.contains("startUnit")
        }) {
            let parsed: LogLine = serde_json::from_str(line).unwrap();
            let original: serde_json::Value = serde_json::from_str(line).unwrap();
            // Through text, as the store does. A value built directly would
            // widen each 32 bit coordinate into digits the logger never wrote.
            let written: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&parsed).unwrap()).unwrap();
            assert_eq!(written, original, "{line}");
        }
    }

    /// What the logger writes for the unit definitions in its own test, which
    /// fails if the logger stops producing exactly this.
    pub(in super::super::super) const UNIT_DEFS_FIXTURE: &str =
        include_str!("../../../../../lua/replay-logger/tests/fixtures/unit_defs.jsonl");

    #[test]
    fn the_engines_unit_definitions_read_in_id_order() {
        let log = parse_log(UNIT_DEFS_FIXTURE);

        assert_eq!(log.malformed, 0);
        assert_eq!((log.counts().header, log.counts().unit_def), (1, 4));
        let defs = unit_defs_of(&log.lines).expect("a whole list");
        assert_eq!(defs.len(), 4);
        assert_eq!(
            defs[0],
            UnitDef {
                name: "tgcom".into(),
                human_name: Some("Commander".into()),
                metal_cost: Some(2500.0),
                energy_cost: Some(25000.5),
                mobile: true,
                builder: true,
                builds: true,
                armed: true,
                metal_make: Some(1.5),
                energy_make: Some(25.0),
                metal_storage: Some(500.0),
                radar_distance: Some(700.0),
                ..Default::default()
            }
        );
        assert_eq!(defs[1].extracts_metal, Some(0.001));
        assert_eq!((defs[1].mobile, defs[1].builder), (false, false));
        assert_eq!(defs[2].human_name, None);
        assert_eq!(defs[3].name, "tg\"odd");
        assert_eq!(
            (defs[3].metal_cost, defs[3].transport_capacity),
            (Some(0.0), Some(8.0))
        );
    }

    /// A definition is found by its place in the list.
    #[test]
    fn a_list_that_is_cut_short_or_out_of_order_is_no_list() {
        let lines: Vec<&str> = UNIT_DEFS_FIXTURE.lines().collect();
        let without = |skip: usize| -> String {
            lines
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != skip)
                .map(|(_, line)| format!("{line}\n"))
                .collect()
        };
        let defs = |text: &str| unit_defs_of(&parse_log(text).lines);

        // No header, so nothing says how many there should be.
        assert!(defs(&without(0)).is_none());
        assert!(defs(&without(1)).is_none());
        assert!(defs(&without(3)).is_none());
        // A run stopped part way through the list.
        assert!(defs(&without(4)).is_none());
        let swapped = format!(
            "{}\n{}\n{}\n{}\n{}\n",
            lines[0], lines[2], lines[1], lines[3], lines[4]
        );
        assert!(defs(&swapped).is_none());
        // A logger from before the list was written.
        assert!(defs(FIXTURE).is_none());
    }

    #[test]
    fn a_kind_a_later_logger_adds_is_kept_as_unknown_and_stops_nothing() {
        let text = "{\"kind\":\"header\",\"format\":1}\n\
            {\"kind\":\"unit_damaged\",\"frame\":10,\"unit\":1,\"damage\":50}\n\
            {\"kind\":\"unit_created\",\"frame\":10,\"unit\":2,\"def\":3,\"team\":0,\"x\":1.0,\"y\":2.0,\"z\":3.0}\n";
        let log = parse_log(text);

        assert_eq!(log.counts().unknown, 1);
        assert_eq!(log.counts().unit_created, 1);
        assert_eq!(log.malformed, 0);
    }

    #[test]
    fn a_field_a_later_logger_adds_is_ignored() {
        let text = "{\"kind\":\"unit_created\",\"frame\":10,\"unit\":2,\"def\":3,\"team\":0,\
            \"x\":1.0,\"y\":2.0,\"z\":3.0,\"cost\":120,\"veteran\":true}\n";
        let log = parse_log(text);

        assert_eq!(log.counts().unit_created, 1);
        assert_eq!(log.malformed, 0);
    }

    /// The reason for one object per line: a run that is killed leaves a file
    /// that reads up to the line it stopped in.
    #[test]
    fn a_file_cut_off_mid_line_reads_up_to_the_last_whole_line() {
        let cut = FIXTURE.rfind("\"winners\"").expect("the game over line");
        let log = parse_log(&FIXTURE[..cut]);

        assert!(log.truncated);
        assert_eq!(log.malformed, 0);
        assert_eq!(log.counts().unit_destroyed, 4);
        assert!(log.game_over().is_none());
        assert!(log.header().is_some());
    }

    #[test]
    fn a_whole_line_that_is_not_json_is_counted_and_skipped() {
        let log = parse_log("{\"kind\":\"header\",\"format\":1}\nnot json\n{\"no\":\"kind\"}\n");

        assert_eq!(log.malformed, 2);
        assert_eq!(log.counts().header, 1);
        assert!(!log.truncated);
    }

    /// A run that never started the logger leaves no file, or an empty one, and
    /// that has to read as nothing rather than as an error.
    #[test]
    fn an_empty_file_is_a_log_with_nothing_in_it() {
        let log = parse_log("");

        assert_eq!(log.counts(), EventCounts::default());
        assert!(log.header().is_none());
        assert!(!log.truncated);
    }

    #[test]
    fn a_line_serialises_back_under_the_same_kind() {
        let log = parse_log(FIXTURE);
        let json = serde_json::to_value(&log.lines[2]).unwrap();

        assert_eq!(json["kind"], "unit_created");
        assert_eq!(json["def"], 12);
        assert!(json.get("builder").is_none());
    }
}
