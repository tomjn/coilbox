//! Every order in a replay, reduced two ways from one walk of the stream: where
//! the orders were aimed (#1152) and how many each team gave over time (#1149).
//!
//! Orders arrive as `Command` events, one per packet, and a packet can hold many
//! orders. Everything here iterates `orders` and never counts events.
//!
//! The first reduction is the density layer on a replay's map. An order has a
//! position only when its command says so, and where in the parameters depends
//! on the command. [`RULES`] is that knowledge in one table. An order aimed at a
//! unit has no position in the stream and is counted. A command the engine does
//! not define may carry anything, so none is guessed at: it is counted too.
//!
//! The second is commands per minute. The engine's own APM figure is
//! `PlayerStatistics::numCommands`, which `CSelectedUnitsHandler::GiveCommand`
//! raises by one for each command given with `fromUser` set, on the player's own
//! machine. That is a click through the engine's interface and a widget calling
//! `Spring.GiveOrder`, both of which reach the stream as `NETMSG_COMMAND`. A
//! widget calling `Spring.GiveOrderToUnit` and its siblings goes through
//! `SendCommandsToUnits` instead, which the stream marks as a Lua order, and
//! the counter never sees it. So the closest unit here is one order, counted
//! for each origin on its own, and the selection origin is the one that agrees
//! with the engine's count in kind.

use std::collections::BTreeMap;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

use super::build_orders::{player_teams, unwrap_insert, Seats};
use super::{find_game, parse_tdf, player_names, read_header_and_script, stream};
use crate::model::{
    CommandSeries, DemoCommandRates, DemoOrderPoints, DemoStream, Order, OrderSource,
    StreamEventKind, PREGAME_FRAME,
};

/// The simulation rate (`GAME_SPEED` in `rts/Sim/Misc/GlobalConstants.h`).
const GAME_SPEED: i32 = 30;

/// `TeamStatistics::statsPeriod` in `rts/Sim/Misc/TeamStatistics.h`, which the
/// engine writes into every demo header (`CDemoRecorder`). Used only when a
/// header names no period.
pub(super) const DEFAULT_STATS_PERIOD_SEC: u32 = 15;

// The command ids, from `rts/Sim/Units/CommandAI/Command.h`.
const CMD_STOP: i32 = 0;
const CMD_REMOVE: i32 = 2;
const CMD_WAIT: i32 = 5;
const CMD_TIMEWAIT: i32 = 6;
const CMD_DEATHWAIT: i32 = 7;
const CMD_SQUADWAIT: i32 = 8;
const CMD_GATHERWAIT: i32 = 9;
const CMD_MOVE: i32 = 10;
const CMD_PATROL: i32 = 15;
const CMD_FIGHT: i32 = 16;
const CMD_ATTACK: i32 = 20;
const CMD_AREA_ATTACK: i32 = 21;
const CMD_GUARD: i32 = 25;
const CMD_GROUPSELECT: i32 = 35;
const CMD_GROUPADD: i32 = 36;
const CMD_GROUPCLEAR: i32 = 37;
const CMD_REPAIR: i32 = 40;
const CMD_FIRE_STATE: i32 = 45;
const CMD_MOVE_STATE: i32 = 50;
const CMD_SETBASE: i32 = 55;
const CMD_INTERNAL: i32 = 60;
const CMD_SELFD: i32 = 65;
const CMD_LOAD_UNITS: i32 = 75;
const CMD_LOAD_ONTO: i32 = 76;
const CMD_UNLOAD_UNITS: i32 = 80;
const CMD_UNLOAD_UNIT: i32 = 81;
const CMD_ONOFF: i32 = 85;
const CMD_RECLAIM: i32 = 90;
const CMD_CLOAK: i32 = 95;
const CMD_STOCKPILE: i32 = 100;
const CMD_MANUALFIRE: i32 = 105;
const CMD_RESTORE: i32 = 110;
const CMD_REPEAT: i32 = 115;
const CMD_TRAJECTORY: i32 = 120;
const CMD_RESURRECT: i32 = 125;
const CMD_CAPTURE: i32 = 130;
const CMD_AUTOREPAIRLEVEL: i32 = 135;
const CMD_IDLEMODE: i32 = 145;
const CMD_FAILED: i32 = 150;

/// What an order is for, coarsely. The number is what crosses to the frontend
/// in [`DemoOrderPoints::kind`], so the values are part of the contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OrderKind {
    /// Move and patrol.
    Move = 0,
    /// Attack, area attack, fight and manual fire.
    Attack = 1,
    /// Placing a building, which is any negative id.
    Build = 2,
    /// Reclaim, repair, resurrect, capture and restore.
    Support = 3,
    /// Positioned, and none of the above: loading and unloading transports.
    Other = 4,
}

/// How many parameters a form of a command has.
#[derive(Clone, Copy, Debug)]
enum Params {
    Exactly(usize),
    AtLeast(usize),
}

impl Params {
    fn fits(self, n: usize) -> bool {
        match self {
            Params::Exactly(want) => n == want,
            Params::AtLeast(want) => n >= want,
        }
    }
}

/// What a form of a command is aimed at.
#[derive(Clone, Copy, Debug)]
enum Aimed {
    /// A unit or a feature, by id. No place in the stream.
    Unit,
    /// A map position: `x, y, z` starting at this parameter. A radius or a
    /// facing after it does not change where the centre is.
    At(usize),
}

/// One command and the forms of its parameters.
struct Rule {
    id: i32,
    kind: OrderKind,
    forms: &'static [(Params, Aimed)],
}

use Aimed::{At, Unit};
use OrderKind::{Attack, Move, Other, Support};
use Params::{AtLeast, Exactly};

/// Which commands have a position, and where in their parameters. Each row
/// cites the engine source it was read from. `CommandAI.cpp` is
/// `rts/Sim/Units/CommandAI/CommandAI.cpp`, and `Command.h` is beside it.
///
/// A command that takes a position or a unit id is `CMDTYPE_ICON_UNIT_OR_MAP`
/// and its relatives in `Command.h`: one parameter is an id, three are a point,
/// four are a point and a radius.
const RULES: &[Rule] = &[
    // `AllowedCommand` checks the position of a move with `IsCommandInMap`, which
    // reads `GetPos(0)`. A line move (six parameters) leads with the front's
    // middle, so the first three still hold a point.
    Rule {
        id: CMD_MOVE,
        kind: Move,
        forms: &[(AtLeast(3), At(0))],
    },
    // `MobileCAI::ExecutePatrol` and `CBuilderCAI::ExecutePatrol` read `GetPos(0)`.
    Rule {
        id: CMD_PATROL,
        kind: Move,
        forms: &[(AtLeast(3), At(0))],
    },
    // `CCommandAI::AllowedCommand` treats one parameter as a unit
    // (`hasTarget` in `CCommandAI::SlowUpdate`) and `MobileCAI::ExecuteFight`
    // reads `GetPos(0)` as the destination, `GetPos(3)` being the start of a
    // dragged line when there are six.
    Rule {
        id: CMD_FIGHT,
        kind: Attack,
        forms: &[(Exactly(1), Unit), (AtLeast(3), At(0))],
    },
    // `AllowedCommand`: one parameter is `GetCommandUnit`, anything else is a
    // ground target at `GetPos(0)`, with a fourth parameter after it
    // (`haveGroundAttackCmd` is `GetNumParams() >= 3`).
    Rule {
        id: CMD_ATTACK,
        kind: Attack,
        forms: &[(Exactly(1), Unit), (AtLeast(3), At(0))],
    },
    // `Command::IsAreaCommand` is true for every area attack, with the centre
    // in the first three and the radius in the fourth.
    Rule {
        id: CMD_AREA_ATTACK,
        kind: Attack,
        forms: &[(AtLeast(3), At(0))],
    },
    // `AllowedCommand` runs manual fire through the attack case: a unit for one
    // parameter, a ground target otherwise.
    Rule {
        id: CMD_MANUALFIRE,
        kind: Attack,
        forms: &[(Exactly(1), Unit), (AtLeast(3), At(0))],
    },
    // `CMDTYPE_ICON_UNIT`, and `ExecuteGuard` reads `GetParam(0)` as a unit.
    Rule {
        id: CMD_GUARD,
        kind: Other,
        forms: &[(Exactly(1), Unit)],
    },
    // `Command::IsAreaCommand`: four parameters are an area, one is a unit. The
    // five parameter form is `CBuilderCAI::ExecuteRepair`'s: a unit, then the
    // area it must stay within, which `IsCommandInMap` reads at `GetPos(1)`.
    Rule {
        id: CMD_REPAIR,
        kind: Support,
        forms: &[(Exactly(1), Unit), (Exactly(4), At(0)), (Exactly(5), At(1))],
    },
    // As repair: `ExecuteReclaim`, with the five parameter form at `GetPos(1)`
    // in `IsCommandInMap`. A feature is a unit id plus `MaxUnits()`, still one
    // parameter.
    Rule {
        id: CMD_RECLAIM,
        kind: Support,
        forms: &[(Exactly(1), Unit), (Exactly(4), At(0)), (Exactly(5), At(1))],
    },
    // As repair: `ExecuteCapture` and `IsCommandInMap`.
    Rule {
        id: CMD_CAPTURE,
        kind: Support,
        forms: &[(Exactly(1), Unit), (Exactly(4), At(0)), (Exactly(5), At(1))],
    },
    // `IsAreaCommand` for four parameters, `ExecuteResurrect` for one (a feature).
    Rule {
        id: CMD_RESURRECT,
        kind: Support,
        forms: &[(Exactly(1), Unit), (Exactly(4), At(0))],
    },
    // `CBuilderCAI::ExecuteRestore` reads a centre and a radius, and
    // `IsAreaCommand` is not true for it, so only the four parameter form is read.
    Rule {
        id: CMD_RESTORE,
        kind: Support,
        forms: &[(Exactly(4), At(0))],
    },
    // `Command::IsAreaCommand` for four parameters. One is a unit, as
    // `MobileCAI::ExecuteLoadUnits` reads it.
    Rule {
        id: CMD_LOAD_UNITS,
        kind: Other,
        forms: &[(Exactly(1), Unit), (Exactly(4), At(0))],
    },
    // `CMDTYPE_ICON_UNIT`, the transport to board.
    Rule {
        id: CMD_LOAD_ONTO,
        kind: Other,
        forms: &[(Exactly(1), Unit)],
    },
    // `IsAreaCommand` for five parameters, and `MobileCAI::ExecuteUnloadUnits`
    // reads the radius at `GetParam(3)` when there are four or more, with the
    // facing at the fifth.
    Rule {
        id: CMD_UNLOAD_UNITS,
        kind: Other,
        forms: &[(AtLeast(4), At(0))],
    },
    // `MobileCAI::ExecuteUnloadUnit`: a point, with a facing as the fifth.
    Rule {
        id: CMD_UNLOAD_UNIT,
        kind: Other,
        forms: &[(AtLeast(3), At(0))],
    },
];

/// Commands that take no target. Each is a state, a queue edit or a wait.
const NO_TARGET: &[i32] = &[
    CMD_STOP,
    CMD_REMOVE,
    CMD_WAIT,
    CMD_TIMEWAIT,
    CMD_DEATHWAIT,
    CMD_SQUADWAIT,
    CMD_GATHERWAIT,
    CMD_GROUPSELECT,
    CMD_GROUPADD,
    CMD_GROUPCLEAR,
    CMD_FIRE_STATE,
    CMD_MOVE_STATE,
    CMD_SETBASE,
    CMD_INTERNAL,
    CMD_SELFD,
    CMD_ONOFF,
    CMD_CLOAK,
    CMD_STOCKPILE,
    CMD_REPEAT,
    CMD_TRAJECTORY,
    CMD_AUTOREPAIRLEVEL,
    CMD_IDLEMODE,
    CMD_FAILED,
];

/// What one order is aimed at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Aim {
    At {
        x: f32,
        z: f32,
        kind: OrderKind,
    },
    /// A unit or a feature.
    Unit,
    /// A command that takes no target, or a build with no position, which a
    /// factory takes as a queue order (`BuildInfo::Parse`).
    NoTarget,
    /// An id the engine does not define.
    Custom,
    /// An id the engine defines, with parameters that fit none of its forms, or
    /// a position that is not a number.
    Malformed,
}

/// Where an order is aimed. An insert is read as the command it wraps, the way
/// [`super::build_orders`] reads one.
pub(super) fn aim(order: &Order) -> Aim {
    if let Some(inserted) = unwrap_insert(order) {
        // An insert inside an insert is not something the engine unwraps twice.
        return if inserted.id == super::build_orders::CMD_INSERT {
            Aim::Malformed
        } else {
            aim_of(inserted.id, inserted.params)
        };
    }
    if order.id == super::build_orders::CMD_INSERT {
        // Fewer than three parameters is no insert (`ExecuteInsert`).
        return Aim::Malformed;
    }
    aim_of(order.id, &order.params)
}

fn aim_of(id: i32, params: &[f32]) -> Aim {
    if id < 0 {
        // `BuildInfo::Parse`: three or more parameters are a position, and
        // fewer are a factory queue order.
        return place(OrderKind::Build, 0, params).unwrap_or(Aim::NoTarget);
    }
    if let Some(rule) = RULES.iter().find(|r| r.id == id) {
        return match rule.forms.iter().find(|(p, _)| p.fits(params.len())) {
            Some((_, Unit)) => Aim::Unit,
            Some((_, At(from))) => place(rule.kind, *from, params).unwrap_or(Aim::Malformed),
            None => Aim::Malformed,
        };
    }
    if NO_TARGET.contains(&id) {
        Aim::NoTarget
    } else {
        Aim::Custom
    }
}

/// The point at `from`, or `None` when the parameters are too short or not
/// numbers.
fn place(kind: OrderKind, from: usize, params: &[f32]) -> Option<Aim> {
    let [x, _y, z] = *params.get(from..from + 3)?.first_chunk::<3>()?;
    (x.is_finite() && z.is_finite()).then_some(Aim::At { x, z, kind })
}

/// Everything one walk of the stream finds.
#[derive(Default)]
struct Reduction {
    x: Vec<f32>,
    z: Vec<f32>,
    frame: Vec<i32>,
    team: Vec<i16>,
    player: Vec<u8>,
    kind: Vec<u8>,
    source: Vec<u8>,
    unit_aimed: u32,
    no_target: u32,
    custom: u32,
    malformed: u32,
    /// Orders given in each bucket of match time, by team and sender.
    buckets: BTreeMap<(i32, OrderSource), Vec<u32>>,
    pregame: u32,
    unattributed: u32,
    last_frame: i32,
    incomplete: bool,
}

/// Walk the stream once. `period_frames` is the bucket length in frames.
fn reduce(
    stream: &DemoStream,
    names: std::collections::HashMap<u32, String>,
    teams: std::collections::HashMap<u32, i32>,
    period_frames: i32,
) -> Reduction {
    let mut out = Reduction {
        last_frame: stream.last_frame,
        incomplete: stream.stopped.is_some(),
        ..Default::default()
    };
    let mut seats = Seats::new(names, teams);
    for e in &stream.events {
        seats.observe(&e.kind);
        let StreamEventKind::Command {
            player,
            origin,
            orders,
            ..
        } = &e.kind
        else {
            continue;
        };
        let team = seats.team_of(origin, *player);
        let source = OrderSource::from(origin);
        for order in orders {
            // Every order counts toward the rate, whatever it is aimed at. The
            // engine's own counter counts a fire state change too.
            if e.frame == PREGAME_FRAME {
                out.pregame += 1;
            } else if let Some(team) = team {
                let bucket = (e.frame / period_frames) as usize;
                let counts = out.buckets.entry((team, source)).or_default();
                if counts.len() <= bucket {
                    counts.resize(bucket + 1, 0);
                }
                counts[bucket] += 1;
            } else {
                out.unattributed += 1;
            }

            match aim(order) {
                Aim::At { x, z, kind } => {
                    out.x.push(x);
                    out.z.push(z);
                    out.frame.push(e.frame);
                    out.team
                        .push(team.and_then(|t| i16::try_from(t).ok()).unwrap_or(-1));
                    out.player.push(*player);
                    out.kind.push(kind as u8);
                    out.source.push(match source {
                        OrderSource::Selection => 0,
                        OrderSource::Lua => 1,
                        OrderSource::Ai => 2,
                    });
                }
                Aim::Unit => out.unit_aimed += 1,
                Aim::NoTarget => out.no_target += 1,
                Aim::Custom => out.custom += 1,
                Aim::Malformed => out.malformed += 1,
            }
        }
    }
    out
}

/// The positioned orders of a walked stream as plain columns, for a caller
/// that bins them and sends no points anywhere (`map_grids`).
pub(super) struct Positioned {
    pub(super) x: Vec<f32>,
    pub(super) z: Vec<f32>,
    pub(super) frame: Vec<i32>,
    pub(super) unit_aimed: u32,
    pub(super) custom: u32,
}

pub(super) fn positioned_orders(
    stream: &DemoStream,
    names: std::collections::HashMap<u32, String>,
    teams: std::collections::HashMap<u32, i32>,
) -> Positioned {
    // The bucket length only shapes the rates, which this caller drops.
    let period_frames = DEFAULT_STATS_PERIOD_SEC as i32 * GAME_SPEED;
    let r = reduce(stream, names, teams, period_frames);
    Positioned {
        x: r.x,
        z: r.z,
        frame: r.frame,
        unit_aimed: r.unit_aimed,
        custom: r.custom,
    }
}

fn pack<T>(values: &[T], bytes: impl Fn(&T) -> Vec<u8>) -> String {
    STANDARD.encode(values.iter().flat_map(bytes).collect::<Vec<u8>>())
}

impl Reduction {
    fn points(self) -> DemoOrderPoints {
        DemoOrderPoints {
            count: self.x.len() as u32,
            x: pack(&self.x, |v| v.to_le_bytes().to_vec()),
            z: pack(&self.z, |v| v.to_le_bytes().to_vec()),
            frame: pack(&self.frame, |v| v.to_le_bytes().to_vec()),
            team: pack(&self.team, |v| v.to_le_bytes().to_vec()),
            player: STANDARD.encode(&self.player),
            kind: STANDARD.encode(&self.kind),
            source: STANDARD.encode(&self.source),
            unit_aimed: self.unit_aimed,
            no_target: self.no_target,
            custom: self.custom,
            malformed: self.malformed,
            last_frame: self.last_frame,
            incomplete: self.incomplete,
        }
    }

    fn rates(
        self,
        period_sec: u32,
        period_is_default: bool,
        period_frames: i32,
    ) -> DemoCommandRates {
        // Whole buckets only. The stretch after the last one is shorter than the
        // others and its count over its own length is a spike.
        let whole = (self.last_frame.max(0) / period_frames) as usize;
        let mut trailing = 0;
        let series = self
            .buckets
            .into_iter()
            .map(|((team, source), mut counts)| {
                if counts.len() > whole {
                    trailing += counts[whole..].iter().sum::<u32>();
                }
                counts.resize(whole, 0);
                CommandSeries {
                    team,
                    source,
                    counts,
                }
            })
            .collect();
        DemoCommandRates {
            period_sec,
            period_is_default,
            buckets: whole as u32,
            series,
            pregame: self.pregame,
            trailing,
            unattributed: self.unattributed,
            last_frame: self.last_frame,
            incomplete: self.incomplete,
        }
    }
}

/// The header's period in seconds and whether it is the engine's default.
fn period(header_sec: u32) -> (u32, bool) {
    if header_sec > 0 {
        (header_sec, false)
    } else {
        (DEFAULT_STATS_PERIOD_SEC, true)
    }
}

/// What the walk of one replay reads: its stream, its seats and its period.
fn walk(demo: &Path) -> Result<(Reduction, u32, bool, i32), String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let (period_sec, is_default) = period(raw.team_stat_period_sec);
    let period_frames = i32::try_from(period_sec)
        .ok()
        .and_then(|s| s.checked_mul(GAME_SPEED))
        .filter(|f| *f > 0)
        .ok_or("the replay's statistics period is not usable")?;
    let stream = stream::read_stream(demo)?;
    let reduction = reduce(
        &stream,
        player_names(&game),
        player_teams(&game),
        period_frames,
    );
    Ok((reduction, period_sec, is_default, period_frames))
}

/// Every positioned order in a replay, packed. The whole file is read and the
/// whole stream walked, so this is for one replay on demand.
pub fn demo_order_points(demo: &Path) -> Result<DemoOrderPoints, String> {
    Ok(walk(demo)?.0.points())
}

/// How many orders each team gave in each period of a replay.
pub fn demo_command_rates(demo: &Path) -> Result<DemoCommandRates, String> {
    let (reduction, sec, is_default, frames) = walk(demo)?;
    Ok(reduction.rates(sec, is_default, frames))
}

#[cfg(test)]
mod tests {
    use super::super::stream::fixture::Packets;
    use super::*;
    use std::collections::HashMap;

    const ALT: u8 = 1 << 7;
    const NO_AI: u8 = 255;

    fn order(id: i32, params: &[f32]) -> Order {
        Order {
            id,
            options: 0,
            params: params.to_vec(),
        }
    }

    fn at(x: f32, z: f32, kind: OrderKind) -> Aim {
        Aim::At { x, z, kind }
    }

    fn insert(wrapped: i32, params: &[f32]) -> Order {
        let mut all = vec![0.0, wrapped as f32, 0.0];
        all.extend_from_slice(params);
        Order {
            id: super::super::build_orders::CMD_INSERT,
            options: ALT,
            params: all,
        }
    }

    fn reduced(p: Packets, teams: &[(u32, i32)]) -> Reduction {
        reduce(
            &p.walked(),
            HashMap::new(),
            teams.iter().copied().collect(),
            450,
        )
    }

    // ---- the table: one test per row -----------------------------------

    #[test]
    fn move_reads_the_first_three_parameters() {
        let want = at(1.0, 3.0, Move);
        assert_eq!(aim(&order(CMD_MOVE, &[1.0, 2.0, 3.0])), want);
        // A dragged line leads with its middle.
        assert_eq!(aim(&order(CMD_MOVE, &[1.0, 2.0, 3.0, 9.0, 9.0, 9.0])), want);
        assert_eq!(aim(&order(CMD_MOVE, &[1.0, 2.0])), Aim::Malformed);
    }

    #[test]
    fn patrol_reads_the_first_three_parameters() {
        assert_eq!(
            aim(&order(CMD_PATROL, &[4.0, 0.0, 6.0])),
            at(4.0, 6.0, Move)
        );
    }

    #[test]
    fn fight_is_a_unit_for_one_parameter_and_a_point_for_three_or_more() {
        assert_eq!(aim(&order(CMD_FIGHT, &[77.0])), Aim::Unit);
        assert_eq!(
            aim(&order(CMD_FIGHT, &[1.0, 2.0, 3.0])),
            at(1.0, 3.0, Attack)
        );
        // Six parameters: the destination is first, the line's start after it.
        assert_eq!(
            aim(&order(CMD_FIGHT, &[1.0, 2.0, 3.0, 8.0, 8.0, 8.0])),
            at(1.0, 3.0, Attack)
        );
        assert_eq!(aim(&order(CMD_FIGHT, &[1.0, 2.0])), Aim::Malformed);
    }

    #[test]
    fn attack_is_a_unit_for_one_parameter_and_ground_for_three_or_four() {
        assert_eq!(aim(&order(CMD_ATTACK, &[5.0])), Aim::Unit);
        assert_eq!(
            aim(&order(CMD_ATTACK, &[1.0, 2.0, 3.0])),
            at(1.0, 3.0, Attack)
        );
        assert_eq!(
            aim(&order(CMD_ATTACK, &[1.0, 2.0, 3.0, 64.0])),
            at(1.0, 3.0, Attack)
        );
    }

    #[test]
    fn area_attack_uses_its_centre() {
        assert_eq!(
            aim(&order(CMD_AREA_ATTACK, &[1.0, 2.0, 3.0, 200.0])),
            at(1.0, 3.0, Attack)
        );
    }

    #[test]
    fn manual_fire_is_a_unit_or_a_ground_target() {
        assert_eq!(aim(&order(CMD_MANUALFIRE, &[5.0])), Aim::Unit);
        assert_eq!(
            aim(&order(CMD_MANUALFIRE, &[1.0, 2.0, 3.0])),
            at(1.0, 3.0, Attack)
        );
    }

    #[test]
    fn guard_and_load_onto_are_aimed_at_a_unit() {
        assert_eq!(aim(&order(CMD_GUARD, &[5.0])), Aim::Unit);
        assert_eq!(aim(&order(CMD_LOAD_ONTO, &[5.0])), Aim::Unit);
        assert_eq!(aim(&order(CMD_GUARD, &[])), Aim::Malformed);
    }

    #[test]
    fn reclaim_repair_and_capture_take_a_unit_an_area_or_a_unit_in_an_area() {
        for id in [CMD_RECLAIM, CMD_REPAIR, CMD_CAPTURE] {
            assert_eq!(aim(&order(id, &[9.0])), Aim::Unit, "{id}");
            assert_eq!(
                aim(&order(id, &[1.0, 2.0, 3.0, 150.0])),
                at(1.0, 3.0, Support),
                "{id}"
            );
            // A unit, then the area it must stay in: the point is the second to
            // fourth parameters.
            assert_eq!(
                aim(&order(id, &[9.0, 1.0, 2.0, 3.0, 150.0])),
                at(1.0, 3.0, Support),
                "{id}"
            );
            assert_eq!(aim(&order(id, &[1.0, 2.0, 3.0])), Aim::Malformed, "{id}");
        }
    }

    #[test]
    fn resurrect_takes_a_feature_or_an_area() {
        assert_eq!(aim(&order(CMD_RESURRECT, &[9.0])), Aim::Unit);
        assert_eq!(
            aim(&order(CMD_RESURRECT, &[1.0, 2.0, 3.0, 80.0])),
            at(1.0, 3.0, Support)
        );
    }

    #[test]
    fn restore_is_only_its_area_form() {
        assert_eq!(
            aim(&order(CMD_RESTORE, &[1.0, 2.0, 3.0, 80.0])),
            at(1.0, 3.0, Support)
        );
        assert_eq!(aim(&order(CMD_RESTORE, &[9.0])), Aim::Malformed);
    }

    #[test]
    fn load_units_takes_a_unit_or_an_area() {
        assert_eq!(aim(&order(CMD_LOAD_UNITS, &[9.0])), Aim::Unit);
        assert_eq!(
            aim(&order(CMD_LOAD_UNITS, &[1.0, 2.0, 3.0, 80.0])),
            at(1.0, 3.0, Other)
        );
    }

    #[test]
    fn unloading_takes_a_point_with_a_radius_and_a_facing_after_it() {
        assert_eq!(
            aim(&order(CMD_UNLOAD_UNITS, &[1.0, 2.0, 3.0, 80.0, 2.0])),
            at(1.0, 3.0, Other)
        );
        assert_eq!(
            aim(&order(CMD_UNLOAD_UNITS, &[1.0, 2.0, 3.0, 80.0])),
            at(1.0, 3.0, Other)
        );
        assert_eq!(
            aim(&order(CMD_UNLOAD_UNIT, &[1.0, 2.0, 3.0])),
            at(1.0, 3.0, Other)
        );
        assert_eq!(
            aim(&order(CMD_UNLOAD_UNIT, &[1.0, 2.0, 3.0, 1.0])),
            at(1.0, 3.0, Other)
        );
    }

    #[test]
    fn a_build_with_a_position_is_placed_and_one_without_is_a_queue_order() {
        assert_eq!(
            aim(&order(-242, &[7576.0, 376.5, 2040.0, 3.0])),
            at(7576.0, 2040.0, OrderKind::Build)
        );
        assert_eq!(aim(&order(-242, &[])), Aim::NoTarget);
        assert_eq!(aim(&order(-242, &[1.0, 2.0])), Aim::NoTarget);
    }

    #[test]
    fn state_and_queue_commands_have_no_target() {
        for id in NO_TARGET {
            assert_eq!(aim(&order(*id, &[1.0])), Aim::NoTarget, "{id}");
        }
    }

    #[test]
    fn an_id_the_engine_does_not_define_is_custom_whatever_its_parameters() {
        // A game's command, a Lua registered one, and an id in neither range.
        for id in [10_000, 31_001, 39_999, 140, 3] {
            assert_eq!(aim(&order(id, &[1.0, 2.0, 3.0])), Aim::Custom, "{id}");
            assert_eq!(aim(&order(id, &[])), Aim::Custom, "{id}");
        }
    }

    #[test]
    fn a_position_that_is_not_a_number_is_not_placed() {
        assert_eq!(aim(&order(CMD_MOVE, &[f32::NAN, 0.0, 1.0])), Aim::Malformed);
        assert_eq!(
            aim(&order(CMD_MOVE, &[1.0, 0.0, f32::INFINITY])),
            Aim::Malformed
        );
    }

    #[test]
    fn every_rule_names_a_different_command() {
        let mut ids: Vec<i32> = RULES
            .iter()
            .map(|r| r.id)
            .chain(NO_TARGET.iter().copied())
            .collect();
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "a command is in the table twice");
    }

    // ---- insert --------------------------------------------------------

    #[test]
    fn an_insert_is_read_as_the_command_it_wraps() {
        assert_eq!(aim(&insert(CMD_MOVE, &[1.0, 2.0, 3.0])), at(1.0, 3.0, Move));
        assert_eq!(
            aim(&insert(-242, &[7576.0, 376.5, 2040.0, 3.0])),
            at(7576.0, 2040.0, OrderKind::Build)
        );
        assert_eq!(aim(&insert(CMD_GUARD, &[5.0])), Aim::Unit);
        assert_eq!(aim(&insert(10_001, &[1.0, 2.0, 3.0])), Aim::Custom);
    }

    #[test]
    fn a_short_or_nested_insert_is_malformed() {
        let short = Order {
            id: super::super::build_orders::CMD_INSERT,
            options: ALT,
            params: vec![0.0, 10.0],
        };
        assert_eq!(aim(&short), Aim::Malformed);
        let nested = insert(
            super::super::build_orders::CMD_INSERT,
            &[0.0, 10.0, 0.0, 1.0, 2.0, 3.0],
        );
        assert_eq!(aim(&nested), Aim::Malformed);
    }

    // ---- the points ----------------------------------------------------

    fn unpack<const N: usize>(text: &str) -> Vec<[u8; N]> {
        let bytes = STANDARD.decode(text).unwrap();
        bytes.as_chunks::<N>().0.to_vec()
    }

    #[test]
    fn positioned_orders_are_packed_in_parallel_columns() {
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .newframes(10)
                .command(3, &order(CMD_MOVE, &[100.0, 5.0, 200.0]))
                .unit_command(3, NO_AI, 0, 40, &order(-7, &[1.0, 2.0, 3.0, 0.0]), None)
                .unit_command(1, 2, 5, 41, &order(CMD_FIGHT, &[9.0, 0.0, 8.0]), None),
            &[(3, 4)],
        )
        .points();
        assert_eq!(got.count, 3);
        let x: Vec<f32> = unpack::<4>(&got.x)
            .into_iter()
            .map(f32::from_le_bytes)
            .collect();
        let z: Vec<f32> = unpack::<4>(&got.z)
            .into_iter()
            .map(f32::from_le_bytes)
            .collect();
        let frame: Vec<i32> = unpack::<4>(&got.frame)
            .into_iter()
            .map(i32::from_le_bytes)
            .collect();
        let team: Vec<i16> = unpack::<2>(&got.team)
            .into_iter()
            .map(i16::from_le_bytes)
            .collect();
        assert_eq!(x, [100.0, 1.0, 9.0]);
        assert_eq!(z, [200.0, 3.0, 8.0]);
        assert_eq!(frame, [10, 10, 10]);
        // The first two are player 3 on team 4. The third is an AI's own team.
        assert_eq!(team, [4, 4, 5]);
        assert_eq!(STANDARD.decode(&got.player).unwrap(), [3, 3, 1]);
        assert_eq!(
            STANDARD.decode(&got.kind).unwrap(),
            [
                OrderKind::Move as u8,
                OrderKind::Build as u8,
                OrderKind::Attack as u8
            ]
        );
        assert_eq!(STANDARD.decode(&got.source).unwrap(), [0, 1, 2]);
    }

    #[test]
    fn orders_with_no_place_are_counted_by_why() {
        let got = reduced(
            Packets::default()
                .command(0, &order(CMD_ATTACK, &[5.0]))
                .command(0, &order(CMD_GUARD, &[5.0]))
                .command(0, &order(CMD_STOP, &[]))
                .command(0, &order(-30, &[]))
                .command(0, &order(31_001, &[1.0, 2.0, 3.0]))
                .command(0, &order(CMD_MOVE, &[1.0])),
            &[],
        )
        .points();
        assert_eq!(got.count, 0);
        assert_eq!(
            (got.unit_aimed, got.no_target, got.custom, got.malformed),
            (2, 2, 1, 1)
        );
    }

    /// One packet can hold many orders. Each is counted, and the packet is not.
    #[test]
    fn a_packet_of_several_orders_is_several_entries() {
        let orders = [
            order(CMD_MOVE, &[1.0, 0.0, 1.0]),
            order(CMD_ATTACK, &[7.0]),
            order(CMD_MOVE, &[2.0, 0.0, 2.0]),
        ];
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .unit_commands(0, false, &[40, 41], &orders),
            &[(0, 0)],
        );
        assert_eq!(got.x.len(), 2);
        assert_eq!(got.unit_aimed, 1);
        assert_eq!(got.buckets[&(0, OrderSource::Lua)], vec![3]);
    }

    #[test]
    fn an_empty_walk_packs_to_empty_columns() {
        let got = reduced(Packets::default(), &[]).points();
        assert_eq!(got.count, 0);
        assert_eq!(got.x, "");
        assert_eq!(got.source, "");
    }

    #[test]
    fn the_points_serialise_flat_and_camel_case() {
        let json = serde_json::to_value(reduced(Packets::default(), &[]).points()).unwrap();
        let keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        for want in [
            "count",
            "x",
            "z",
            "frame",
            "team",
            "player",
            "kind",
            "source",
            "unitAimed",
            "noTarget",
            "custom",
            "malformed",
            "lastFrame",
            "incomplete",
        ] {
            assert!(keys.contains(&want), "{want} is missing from {keys:?}");
        }
    }

    // ---- the rates -----------------------------------------------------

    #[test]
    fn orders_fall_in_the_bucket_of_their_frame_for_their_team() {
        // 450 frames a bucket. Frames 0 to 449 are the first.
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .command(0, &order(CMD_STOP, &[]))
                .newframes(449)
                .command(0, &order(CMD_STOP, &[]))
                .newframes(1)
                .command(0, &order(CMD_STOP, &[]))
                .command(1, &order(CMD_STOP, &[]))
                .newframes(450)
                .command(0, &order(CMD_STOP, &[])),
            &[(0, 7), (1, 7)],
        );
        // Players 0 and 1 share team 7, so they are added.
        assert_eq!(got.buckets[&(7, OrderSource::Selection)], vec![2, 2, 1]);
    }

    #[test]
    fn the_three_senders_are_three_series() {
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .command(0, &order(CMD_STOP, &[]))
                .unit_command(0, NO_AI, 0, 40, &order(CMD_STOP, &[]), None)
                .unit_command(0, 2, 5, 41, &order(CMD_STOP, &[]), None),
            &[(0, 0)],
        );
        assert_eq!(got.buckets[&(0, OrderSource::Selection)], vec![1]);
        assert_eq!(got.buckets[&(0, OrderSource::Lua)], vec![1]);
        // The AI's orders are its own team's, not its host's.
        assert_eq!(got.buckets[&(5, OrderSource::Ai)], vec![1]);
        assert_eq!(got.buckets.len(), 3);
    }

    #[test]
    fn orders_before_the_game_and_from_nobody_are_counted_apart() {
        let got = reduced(
            Packets::default()
                .command(0, &order(CMD_STOP, &[]))
                .keyframe(0)
                .command(9, &order(CMD_STOP, &[])),
            &[(0, 0)],
        );
        assert_eq!(got.pregame, 1);
        assert_eq!(got.unattributed, 1);
        assert!(got.buckets.is_empty());
    }

    /// Only whole buckets are returned, and the rest is counted.
    #[test]
    fn the_stretch_after_the_last_whole_bucket_is_left_out_and_counted() {
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .command(0, &order(CMD_STOP, &[]))
                .newframes(460)
                .command(0, &order(CMD_STOP, &[]))
                .command(0, &order(CMD_STOP, &[])),
            &[(0, 0)],
        )
        .rates(15, false, 450);
        // 460 frames: one whole bucket of 450 and ten frames over.
        assert_eq!(got.buckets, 1);
        assert_eq!(got.series[0].counts, vec![1]);
        assert_eq!(got.trailing, 2);
    }

    #[test]
    fn a_team_quiet_in_a_bucket_has_a_zero_there() {
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .newframes(500)
                .command(0, &order(CMD_STOP, &[]))
                .newframes(400),
            &[(0, 0)],
        )
        .rates(15, false, 450);
        assert_eq!(got.buckets, 2);
        assert_eq!(got.series[0].counts, vec![0, 1]);
    }

    #[test]
    fn a_replay_with_no_period_in_its_header_takes_the_engines_default() {
        assert_eq!(period(0), (15, true));
        assert_eq!(period(30), (30, false));
    }

    #[test]
    fn a_stream_that_stopped_early_says_so() {
        let mut stream = Packets::default()
            .command(0, &order(CMD_MOVE, &[1.0, 2.0, 3.0]))
            .walked();
        stream.stopped = Some(crate::model::StreamStop {
            offset: 1,
            reason: "x".into(),
        });
        let got = reduce(&stream, HashMap::new(), HashMap::new(), 450);
        assert!(got.incomplete);
        assert_eq!(got.x.len(), 1);
    }

    #[test]
    fn the_rates_serialise_with_their_sender_tagged_by_name() {
        let got = reduced(
            Packets::default()
                .keyframe(0)
                .newframes(450)
                .command(0, &order(CMD_STOP, &[])),
            &[(0, 3)],
        )
        .rates(15, false, 450);
        let json = serde_json::to_value(&got).unwrap();
        assert_eq!(json["periodSec"], 15);
        assert_eq!(json["series"][0]["team"], 3);
        assert_eq!(json["series"][0]["source"], "selection");
    }

    /// Counts for the largest replay in `~/.spring/demos`, which is what the
    /// issue asks to see before the layer is believed. Run with
    /// `cargo test -p tauri-plugin-coilbox-content real_replay_order_counts -- --ignored --nocapture`.
    /// Prints no names.
    #[test]
    #[ignore = "reads the replays on this machine"]
    fn real_replay_order_counts() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let dir = Path::new(&home).join(".spring/demos");
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        files.sort_by_key(|f| std::fs::metadata(f).map(|m| m.len()).unwrap_or(0));
        let Some(largest) = files.last() else {
            return;
        };
        let started = std::time::Instant::now();
        let (r, ..) = walk(largest).expect("the largest replay reads");
        let walked = started.elapsed();
        let mut by_kind = [0u32; 5];
        let mut by_source = [0u32; 3];
        for (k, s) in r.kind.iter().zip(&r.source) {
            by_kind[*k as usize] += 1;
            by_source[*s as usize] += 1;
        }
        println!(
            "bytes on disk\t{}",
            std::fs::metadata(largest).map(|m| m.len()).unwrap_or(0)
        );
        println!("walk and reduce ms\t{}", walked.as_millis());
        println!("positioned\t{}", r.x.len());
        println!("move/attack/build/support/other\t{by_kind:?}");
        println!("selection/widget/ai positioned\t{by_source:?}");
        println!("unit aimed\t{}", r.unit_aimed);
        println!("no target\t{}", r.no_target);
        println!("custom\t{}", r.custom);
        println!("malformed\t{}", r.malformed);
        println!("last frame\t{}", r.last_frame);
        let started = std::time::Instant::now();
        let points = r.points();
        let json = serde_json::to_string(&points).unwrap();
        println!("pack and serialise ms\t{}", started.elapsed().as_millis());
        println!("response bytes\t{}", json.len());
        println!("x min/max\t{:?}", min_max(&points.x));
        println!("z min/max\t{:?}", min_max(&points.z));
    }

    fn min_max(packed: &str) -> (f32, f32) {
        let v: Vec<f32> = unpack::<4>(packed)
            .into_iter()
            .map(f32::from_le_bytes)
            .collect();
        (
            v.iter().copied().fold(f32::INFINITY, f32::min),
            v.iter().copied().fold(f32::NEG_INFINITY, f32::max),
        )
    }
}
