//! The divergence check: did the run reproduce the match the replay recorded
//! (issue #1184).
//!
//! A replay is a stream of orders. Playing it back simulates the match again,
//! and the events a run records are only true if that simulation was the same
//! one. The replay says what the real one came to, in its trailer, from the
//! engine that played it: the winning ally teams, the time the game ended, and
//! every team's final totals. So a run is compared with its own replay, and a
//! run that disagrees is reported with the figures that disagreed rather than
//! handed on as events.
//!
//! Three kinds of figure are compared.
//!
//! - What the trailer holds against what the logger read when the game ended:
//!   the winners, every team's sample count, and every team's nineteen totals.
//! - What the logger counted against what the trailer says it should have
//!   counted: a `unit_created` line per unit a team produced and a
//!   `unit_destroyed` line per unit a team lost. This is the check on the
//!   logger itself, and it is the one a log with events missing fails.
//! - The engine's own verdict. A replay carries the checksum every player's
//!   simulation had as the match was played, and the engine compares its own
//!   against each one as it plays back, logging `[DESYNC WARNING]` for a frame
//!   that differs (`rts/Net/NetCommands.cpp`). A run with any is a different
//!   match from that frame on. That checksum covers where every object is and
//!   which way it faces, its waypoints, and the random number generator. It
//!   does not cover health or a team's resources.
//!
//! What this catches was measured by perturbing the Splinter Faction match
//! below on purpose, once each. Giving a team 500 metal was caught by the
//! totals alone. Drawing one random number was caught by both: 270 desync
//! warnings, the game a second longer, and twelve totals different. Taking 50
//! health off a unit that then regenerated it was caught by neither, and the
//! log that run wrote was the same as an unperturbed run's, byte for byte. So
//! the check answers for what coilbox records, which is where it is trusted,
//! and not for every value the simulation holds.
//!
//! Everything is compared for equality. No tolerance is applied, because none
//! was needed: on the runs measured for this issue every figure matched to the
//! last bit. Those were a 769 second Splinter Faction match
//! (`2026-08-24_00-24-25`, two teams, 23,091 frames) and a 232 second Metal
//! Factions match between two of the game's own AIs (6,976 frames, recorded for
//! the purpose), both on engine `2026.07.01-102-g6e5c5a0`, each played back
//! under the analysis game. The totals are 32 bit floats on both sides and the
//! logger writes enough digits for each to read back as the same float, so a
//! difference of any size is a real one.
//!
//! The final frame is the one figure the trailer does not hold exactly. The
//! header has the game's length in whole seconds, written as the frame divided
//! by the 30 frames a second the engine simulates, and each team's sample count
//! places the end within one statistics period. Both are compared exactly, which
//! pins the frame to the second.

use serde::{Deserialize, Serialize};

use super::log::{EventLog, LogLine, LoggedTeam};
use crate::model::{DemoTrailer, TeamStatSample};

/// `GAME_SPEED` in `rts/Sim/Misc/GlobalConstants.h`: simulation frames a
/// second. A constant of the engine, not a setting.
const FRAMES_PER_SECOND: i32 = 30;

/// One figure the run and the replay disagree on.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Disagreement {
    /// Which figure: `winners`, `gameSeconds`, `teams`, `desyncWarnings`, or a
    /// statistic's name such as `metalProduced`.
    pub figure: String,
    /// The team the figure belongs to, when it is a team's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<i32>,
    /// What the replay recorded.
    pub recorded: String,
    /// What the run observed.
    pub observed: String,
    /// Observed minus recorded, for a figure that is a number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difference: Option<f64>,
}

fn list(values: &[u32]) -> String {
    values
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Collects disagreements, so each comparison is one line where it is made.
struct Findings(Vec<Disagreement>);

impl Findings {
    fn count(&mut self, figure: &str, team: Option<i32>, recorded: i64, observed: i64) {
        if recorded != observed {
            self.0.push(Disagreement {
                figure: figure.into(),
                team,
                recorded: recorded.to_string(),
                observed: observed.to_string(),
                difference: Some((observed - recorded) as f64),
            });
        }
    }

    fn total(&mut self, figure: &str, team: i32, recorded: f32, observed: f32) {
        // Exact, see the module comment. Two NaNs are the same answer here.
        if recorded != observed && !(recorded.is_nan() && observed.is_nan()) {
            self.0.push(Disagreement {
                figure: figure.into(),
                team: Some(team),
                recorded: recorded.to_string(),
                observed: observed.to_string(),
                difference: Some(f64::from(observed) - f64::from(recorded)),
            });
        }
    }

    fn team(&mut self, team: i32, recorded: &TeamStatSample, observed: &LoggedTeam) {
        let totals = [
            ("metalUsed", recorded.metal_used, observed.metal_used),
            ("energyUsed", recorded.energy_used, observed.energy_used),
            (
                "metalProduced",
                recorded.metal_produced,
                observed.metal_produced,
            ),
            (
                "energyProduced",
                recorded.energy_produced,
                observed.energy_produced,
            ),
            ("metalExcess", recorded.metal_excess, observed.metal_excess),
            (
                "energyExcess",
                recorded.energy_excess,
                observed.energy_excess,
            ),
            (
                "metalReceived",
                recorded.metal_received,
                observed.metal_received,
            ),
            (
                "energyReceived",
                recorded.energy_received,
                observed.energy_received,
            ),
            ("metalSent", recorded.metal_sent, observed.metal_sent),
            ("energySent", recorded.energy_sent, observed.energy_sent),
            ("damageDealt", recorded.damage_dealt, observed.damage_dealt),
            (
                "damageReceived",
                recorded.damage_received,
                observed.damage_received,
            ),
        ];
        for (figure, recorded, observed) in totals {
            self.total(figure, team, recorded, observed);
        }
        let counts = [
            (
                "unitsProduced",
                recorded.units_produced,
                observed.units_produced,
            ),
            ("unitsDied", recorded.units_died, observed.units_died),
            (
                "unitsReceived",
                recorded.units_received,
                observed.units_received,
            ),
            ("unitsSent", recorded.units_sent, observed.units_sent),
            (
                "unitsCaptured",
                recorded.units_captured,
                observed.units_captured,
            ),
            (
                "unitsOutCaptured",
                recorded.units_out_captured,
                observed.units_out_captured,
            ),
            ("unitsKilled", recorded.units_killed, observed.units_killed),
        ];
        for (figure, recorded, observed) in counts {
            self.count(figure, Some(team), recorded.into(), observed.into());
        }
    }
}

/// How many times the engine said its simulation differed from a recorded
/// player's, in the output of a run.
pub fn desync_warnings(engine_log: &str) -> usize {
    engine_log.matches("[DESYNC WARNING]").count()
}

/// Whether the replay recorded an outcome to check a run against.
///
/// The engine writes the statistics when a game ends and at no other time, so a
/// match that was quit part way through has none, and neither does one whose
/// statistics were never recorded. There is then nothing to say a run matched.
pub fn has_recorded_outcome(trailer: &DemoTrailer) -> bool {
    !trailer.teams.is_empty() && trailer.teams.iter().all(|team| !team.samples.is_empty())
}

/// Compare a run with the replay it played.
///
/// `game_seconds` is the header's game length. `desync_warnings` is
/// [`desync_warnings`] of the engine's output. The log must hold a game over
/// line: a run without one did not finish, which is a different answer from one
/// that diverged and is the caller's to give.
///
/// Empty means the run reproduced the match.
pub fn compare(
    trailer: &DemoTrailer,
    game_seconds: u32,
    log: &EventLog,
    desync_warnings: usize,
) -> Vec<Disagreement> {
    let mut found = Findings(Vec::new());
    let Some(over) = log.game_over() else {
        found.0.push(Disagreement {
            figure: "gameOver".into(),
            team: None,
            recorded: "the game ended".into(),
            observed: "the run recorded no game over".into(),
            difference: None,
        });
        return found.0;
    };

    found.count("desyncWarnings", None, 0, desync_warnings as i64);

    let mut recorded_winners = trailer.winning_ally_teams.clone();
    let mut observed_winners = over.winners.clone();
    recorded_winners.sort_unstable();
    observed_winners.sort_unstable();
    if recorded_winners != observed_winners {
        found.0.push(Disagreement {
            figure: "winners".into(),
            team: None,
            recorded: list(&recorded_winners),
            observed: list(&observed_winners),
            difference: None,
        });
    }

    found.count(
        "gameSeconds",
        None,
        i64::from(game_seconds),
        i64::from(over.frame / FRAMES_PER_SECOND),
    );
    found.count(
        "teams",
        None,
        trailer.teams.len() as i64,
        over.teams.len() as i64,
    );

    for series in &trailer.teams {
        let team = series.team;
        let Some(observed) = over.teams.iter().find(|t| t.team == team) else {
            // Already reported as a team count that differs, unless the run saw
            // the same number of other teams.
            found.count("samples", Some(team), series.samples.len() as i64, 0);
            continue;
        };
        found.count(
            "samples",
            Some(team),
            series.samples.len() as i64,
            observed.samples as i64,
        );
        let Some(last) = series.samples.last() else {
            continue;
        };
        found.team(team, last, observed);

        // The logger against the trailer: one line per unit made and per unit
        // lost. A log with events missing fails here even when the simulation
        // itself reproduced.
        let lines = |wanted: fn(&LogLine) -> Option<i32>| {
            log.lines
                .iter()
                .filter(|line| wanted(line) == Some(team))
                .count() as i64
        };
        found.count(
            "unitCreatedLines",
            Some(team),
            last.units_produced.into(),
            lines(|line| match line {
                LogLine::UnitCreated(event) => Some(event.team),
                _ => None,
            }),
        );
        found.count(
            "unitDestroyedLines",
            Some(team),
            last.units_died.into(),
            lines(|line| match line {
                LogLine::UnitDestroyed(event) => Some(event.team),
                _ => None,
            }),
        );
    }
    found.0
}

#[cfg(test)]
pub(super) mod tests {
    use super::super::log::{parse_log, tests::FIXTURE};
    use super::*;
    use crate::model::TeamStatSeries;

    /// The trailer of the match the logger's fixture file records: the same
    /// winners, sample counts and totals, as the engine would have written them.
    pub(in super::super) fn fixture_trailer() -> DemoTrailer {
        let early = |frame| TeamStatSample {
            frame,
            ..Default::default()
        };
        DemoTrailer {
            winning_ally_teams: vec![0],
            team_stat_period_sec: 16,
            players: None,
            teams: vec![
                TeamStatSeries {
                    team: 0,
                    samples: vec![
                        early(0),
                        early(480),
                        TeamStatSample {
                            // The trailer holds the frame the next sample was
                            // due, which is past the end of the game.
                            frame: 1920,
                            metal_used: 1234.5677,
                            energy_used: 5000.0,
                            metal_produced: 1500.0,
                            energy_produced: 9000.5,
                            metal_excess: 0.3,
                            damage_dealt: 4100.0,
                            units_produced: 3,
                            units_died: 1,
                            units_killed: 2,
                            ..Default::default()
                        },
                    ],
                },
                TeamStatSeries {
                    team: 1,
                    samples: vec![
                        early(0),
                        TeamStatSample {
                            frame: 1920,
                            metal_used: 300.0,
                            energy_used: 2000.0,
                            metal_produced: 900.0,
                            energy_produced: 4000.0,
                            damage_received: 4100.0,
                            units_produced: 2,
                            units_died: 2,
                            ..Default::default()
                        },
                    ],
                },
            ],
        }
    }

    /// 1501 frames is 50 whole seconds.
    pub(in super::super) const FIXTURE_SECONDS: u32 = 50;

    #[test]
    fn a_run_that_matches_its_replay_has_nothing_to_report() {
        let log = parse_log(FIXTURE);

        assert_eq!(
            compare(&fixture_trailer(), FIXTURE_SECONDS, &log, 0),
            Vec::new()
        );
    }

    fn only(found: Vec<Disagreement>) -> Disagreement {
        assert_eq!(found.len(), 1, "{found:?}");
        found.into_iter().next().unwrap()
    }

    #[test]
    fn a_different_winner_is_named() {
        let mut trailer = fixture_trailer();
        trailer.winning_ally_teams = vec![1];

        let d = only(compare(&trailer, FIXTURE_SECONDS, &parse_log(FIXTURE), 0));
        assert_eq!((d.figure.as_str(), d.team), ("winners", None));
        assert_eq!((d.recorded.as_str(), d.observed.as_str()), ("1", "0"));
    }

    #[test]
    fn winners_are_compared_whatever_order_they_come_in() {
        let mut trailer = fixture_trailer();
        trailer.winning_ally_teams = vec![2, 0];
        let text = FIXTURE.replace("\"winners\":[0]", "\"winners\":[0,2]");

        assert_eq!(
            compare(&trailer, FIXTURE_SECONDS, &parse_log(&text), 0),
            Vec::new()
        );
    }

    /// The smallest step a 32 bit float can take is a difference, and it is
    /// reported with its size.
    #[test]
    fn a_total_that_differs_by_one_step_of_a_float_is_a_disagreement() {
        let mut trailer = fixture_trailer();
        let next = f32::from_bits(1500.0_f32.to_bits() + 1);
        trailer.teams[0].samples[2].metal_produced = next;

        let d = only(compare(&trailer, FIXTURE_SECONDS, &parse_log(FIXTURE), 0));
        assert_eq!((d.figure.as_str(), d.team), ("metalProduced", Some(0)));
        assert_eq!(d.observed, "1500");
        let difference = d.difference.expect("a number");
        assert!(difference < 0.0 && difference > -0.001, "{difference}");
    }

    #[test]
    fn a_game_that_ended_at_another_second_is_a_disagreement() {
        let d = only(compare(&fixture_trailer(), 51, &parse_log(FIXTURE), 0));

        assert_eq!(d.figure, "gameSeconds");
        assert_eq!((d.recorded.as_str(), d.observed.as_str()), ("51", "50"));
        assert_eq!(d.difference, Some(-1.0));
    }

    #[test]
    fn a_team_with_another_number_of_samples_is_a_disagreement() {
        let mut trailer = fixture_trailer();
        let extra = trailer.teams[1].samples[0].clone();
        trailer.teams[1].samples.insert(0, extra);

        let d = only(compare(&trailer, FIXTURE_SECONDS, &parse_log(FIXTURE), 0));
        assert_eq!((d.figure.as_str(), d.team), ("samples", Some(1)));
        assert_eq!(d.difference, Some(-1.0));
    }

    /// The check on the logger rather than on the simulation: the totals agree
    /// and a line is missing.
    #[test]
    fn a_log_missing_a_destroyed_unit_is_caught_by_the_trailers_own_count() {
        let missing: String = FIXTURE
            .lines()
            .filter(|line| !(line.contains("unit_destroyed") && line.contains("\"unit\":5,")))
            .map(|line| format!("{line}\n"))
            .collect();

        let d = only(compare(
            &fixture_trailer(),
            FIXTURE_SECONDS,
            &parse_log(&missing),
            0,
        ));
        assert_eq!((d.figure.as_str(), d.team), ("unitDestroyedLines", Some(1)));
        assert_eq!((d.recorded.as_str(), d.observed.as_str()), ("2", "1"));
    }

    #[test]
    fn a_log_missing_a_created_unit_is_caught_too() {
        let missing: String = FIXTURE
            .lines()
            .filter(|line| !(line.contains("unit_created") && line.contains("\"unit\":3,")))
            .map(|line| format!("{line}\n"))
            .collect();

        let d = only(compare(
            &fixture_trailer(),
            FIXTURE_SECONDS,
            &parse_log(&missing),
            0,
        ));
        assert_eq!((d.figure.as_str(), d.team), ("unitCreatedLines", Some(0)));
    }

    #[test]
    fn an_engine_that_reported_a_desync_did_not_reproduce_the_match() {
        let log = "[f=0000450] Error: [DESYNC WARNING] checksum a from demo player 0 (x) does not match our checksum b for frame-number 450\n\
            [f=0000480] Error: [DESYNC WARNING] checksum c from demo player 0 (x) does not match our checksum d for frame-number 480\n";
        assert_eq!(desync_warnings(log), 2);
        assert_eq!(desync_warnings("[f=0000450] nothing wrong\n"), 0);

        let d = only(compare(
            &fixture_trailer(),
            FIXTURE_SECONDS,
            &parse_log(FIXTURE),
            desync_warnings(log),
        ));
        assert_eq!(d.figure, "desyncWarnings");
        assert_eq!((d.recorded.as_str(), d.observed.as_str()), ("0", "2"));
    }

    #[test]
    fn a_run_with_no_game_over_is_not_called_a_match() {
        let cut = FIXTURE.rfind("{\"kind\":\"game_over\"").unwrap();

        let d = only(compare(
            &fixture_trailer(),
            FIXTURE_SECONDS,
            &parse_log(&FIXTURE[..cut]),
            0,
        ));
        assert_eq!(d.figure, "gameOver");
    }

    #[test]
    fn a_team_the_run_never_saw_is_a_disagreement() {
        let mut trailer = fixture_trailer();
        trailer.teams.push(TeamStatSeries {
            team: 2,
            samples: vec![TeamStatSample::default()],
        });

        let found = compare(&trailer, FIXTURE_SECONDS, &parse_log(FIXTURE), 0);
        let figures: Vec<_> = found.iter().map(|d| (d.figure.as_str(), d.team)).collect();
        assert_eq!(figures, vec![("teams", None), ("samples", Some(2))]);
    }

    #[test]
    fn a_replay_that_was_quit_part_way_has_no_outcome_to_check_against() {
        assert!(has_recorded_outcome(&fixture_trailer()));

        let mut quit = fixture_trailer();
        quit.teams.clear();
        assert!(!has_recorded_outcome(&quit));

        let mut unrecorded = fixture_trailer();
        unrecorded.teams[1].samples.clear();
        assert!(!has_recorded_outcome(&unrecorded));
    }
}
