//! A replay's build orders, picked out of the walked demo stream (#1145).
//!
//! A build order is a command whose id is negative, and the unit definition id
//! is the absolute value (`BuildInfo::CreateCommandID`). It reaches the stream
//! two ways, both read against `rts/Sim/Units/CommandAI/` in RecoilEngine:
//!
//! - As the command itself. With three or more parameters they are `x, y, z`
//!   and it is a placed building, and with exactly four the last is the facing
//!   (`BuildInfo::Parse`). With fewer than three it has no position, which a
//!   builder refuses and a factory takes as a queue order (`CFactoryCAI`).
//! - Wrapped in `CMD_INSERT` (#3818), whose parameters are `where, wrapped id,
//!   wrapped options` and then the wrapped command's own
//!   (`CCommandAI::ExecuteInsert`). `where` is a queue position when the insert
//!   carries the alt bit and a command tag when it does not.
//!
//! What comes out is what was ordered. A builder drops a build it cannot reach,
//! a second order on the same spot cancels the first, and none of that is in
//! the stream.

use std::collections::HashMap;
use std::path::Path;

use super::{find_game, parse_tdf, player_names, read_header_and_script, stream, Section};
use crate::model::{
    BuildOrder, BuildOrderPlayer, BuildPosition, BuildSlot, CommandOrigin, DemoBuildOrders,
    DemoStream, Order, StreamEventKind, TeamAction,
};

/// `CMD_INSERT` in `rts/Sim/Units/CommandAI/Command.h`.
const CMD_INSERT: i32 = 1;

// The option bits, from the same header.
const RIGHT_MOUSE_KEY: u8 = 1 << 4;
const SHIFT_KEY: u8 = 1 << 5;
const CONTROL_KEY: u8 = 1 << 6;
const ALT_KEY: u8 = 1 << 7;

/// `NUM_FACINGS` in `rts/Sim/Misc/GlobalConstants.h`.
const NUM_FACINGS: i32 = 4;

/// Read a replay's build orders. The whole file is read and the whole stream
/// walked, so this is for one replay on demand and not for a listing.
pub fn demo_build_orders(demo: &Path) -> Result<DemoBuildOrders, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let stream = stream::read_stream(demo)?;
    Ok(build_orders_from_stream(
        &stream,
        player_names(&game),
        player_teams(&game),
    ))
}

/// Map player number to team from the start script's `[playerN]` sections. A
/// spectator has no team that can be ordered to build, and is left out.
fn player_teams(game: &Section) -> HashMap<u32, i32> {
    let mut out = HashMap::new();
    for (name, sec) in &game.children {
        let Some(num) = name
            .strip_prefix("player")
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        if sec.get("spectator").is_some_and(|s| s.trim() == "1") {
            continue;
        }
        if let Some(team) = sec.get("team").and_then(|t| t.trim().parse().ok()) {
            out.insert(num, team);
        }
    }
    out
}

/// The build orders of a walked stream, with every other event dropped.
///
/// `names` and `teams` are the start script's, by player number. The stream
/// changes both as it goes: a late joiner brings a name and a seat, and a player
/// can move to another team. An order takes the team its player was on when it
/// arrived.
pub(super) fn build_orders_from_stream(
    stream: &DemoStream,
    mut names: HashMap<u32, String>,
    mut teams: HashMap<u32, i32>,
) -> DemoBuildOrders {
    let mut out = DemoBuildOrders {
        last_frame: stream.last_frame,
        incomplete: stream.stopped.is_some(),
        ..Default::default()
    };
    // How many units each player has selected, which is who an order from the
    // engine's own interface goes to.
    let mut selected: HashMap<u8, u32> = HashMap::new();

    for e in &stream.events {
        match &e.kind {
            StreamEventKind::PlayerName { player, name } => {
                names
                    .entry(u32::from(*player))
                    .or_insert_with(|| name.clone());
            }
            StreamEventKind::NewPlayer {
                player,
                spectator,
                team,
                name,
            } => {
                names.insert(u32::from(*player), name.clone());
                if *spectator {
                    teams.remove(&u32::from(*player));
                } else {
                    teams.insert(u32::from(*player), i32::from(*team));
                }
            }
            StreamEventKind::Team {
                player,
                action: TeamAction::JoinTeam { team },
            } => {
                teams.insert(u32::from(*player), i32::from(*team));
            }
            StreamEventKind::Select { player, units } => {
                selected.insert(*player, units.len() as u32);
            }
            StreamEventKind::Command {
                player,
                origin,
                units,
                pairwise,
                orders,
            } => {
                let builders = match origin {
                    CommandOrigin::Selection => selected.get(player).copied().unwrap_or(0),
                    // Each order goes to the one unit beside it.
                    _ if *pairwise => 1,
                    _ => units.len() as u32,
                };
                let team = match origin {
                    CommandOrigin::Ai { team, .. } => Some(i32::from(*team)),
                    _ => teams.get(&u32::from(*player)).copied(),
                };
                for order in orders {
                    let b = match read_build(order) {
                        Some(Build::Order(b)) => b,
                        Some(Build::Removal) => {
                            out.removals += 1;
                            continue;
                        }
                        None => continue,
                    };
                    let new = BuildOrder {
                        frame: e.frame,
                        player: *player,
                        team,
                        origin: *origin,
                        unit_def_id: b.unit_def_id,
                        position: b.position,
                        facing: b.facing,
                        count: b.count,
                        slot: b.slot,
                        builders,
                        options: b.options,
                    };
                    // A widget orders several builders with one packet each,
                    // all in one frame. That is one building ordered once.
                    let same_building = (new.position.is_some()
                        && *origin != CommandOrigin::Selection)
                        .then(|| {
                            out.orders
                                .iter_mut()
                                .rev()
                                .take_while(|o| o.frame == new.frame)
                                .find(|o| {
                                    BuildOrder {
                                        builders: new.builders,
                                        ..(*o).clone()
                                    } == new
                                })
                        })
                        .flatten();
                    match same_building {
                        Some(first) => first.builders += builders,
                        None => out.orders.push(new),
                    }
                }
            }
            _ => {}
        }
    }

    let mut players: Vec<u8> = out.orders.iter().map(|o| o.player).collect();
    players.sort_unstable();
    players.dedup();
    out.players = players
        .into_iter()
        .filter_map(|player| {
            names.get(&u32::from(player)).map(|name| BuildOrderPlayer {
                player,
                name: name.clone(),
            })
        })
        .collect();
    out
}

/// What one order says about building, apart from who sent it and when.
struct BuildFacts {
    unit_def_id: i32,
    position: Option<BuildPosition>,
    facing: Option<u8>,
    count: u32,
    slot: BuildSlot,
    options: u8,
}

enum Build {
    Order(BuildFacts),
    /// A factory queue order with the right mouse bit, which takes units off
    /// the queue (`CFactoryCAI::GiveCommandReal`).
    Removal,
}

/// Read an order as a build, or `None` when it is not one.
fn read_build(order: &Order) -> Option<Build> {
    if order.id < 0 {
        let mut facts = build_facts(order.id, order.options, &order.params);
        if facts.position.is_none() {
            if order.options & RIGHT_MOUSE_KEY != 0 {
                return Some(Build::Removal);
            }
            if order.options & ALT_KEY != 0 {
                facts.slot = BuildSlot::Front;
            }
        } else if order.options & SHIFT_KEY == 0 {
            facts.slot = BuildSlot::Replace;
        }
        return Some(Build::Order(facts));
    }
    if order.id != CMD_INSERT {
        return None;
    }
    // `ExecuteInsert`: fewer than three parameters is no insert at all.
    let [place, id, options, params @ ..] = order.params.as_slice() else {
        return None;
    };
    // The engine reads all three with a plain cast, so the same here.
    let id = *id as i32;
    if id >= 0 {
        return None;
    }
    let mut facts = build_facts(id, *options as u8, params);
    facts.slot = if order.options & ALT_KEY != 0 {
        BuildSlot::InsertAt {
            position: *place as i32,
        }
    } else {
        BuildSlot::InsertAtTag {
            tag: *place as u32,
            after: order.options & RIGHT_MOUSE_KEY != 0,
        }
    };
    Some(Build::Order(facts))
}

/// The parts a build command carries whichever way it arrived. The slot is
/// `Append` until the caller says otherwise.
fn build_facts(id: i32, options: u8, params: &[f32]) -> BuildFacts {
    let position = match params {
        [x, y, z, ..] => Some(BuildPosition {
            x: *x,
            y: *y,
            z: *z,
        }),
        _ => None,
    };
    // `BuildInfo::Parse` reads a facing from exactly four parameters.
    let facing = match params {
        [_, _, _, facing] => Some(((*facing as i32).abs() % NUM_FACINGS) as u8),
        _ => None,
    };
    // `GetCountMultiplierFromOptions`, which only a factory applies.
    let mut count = 1;
    if position.is_none() {
        if options & SHIFT_KEY != 0 {
            count *= 5;
        }
        if options & CONTROL_KEY != 0 {
            count *= 20;
        }
    }
    BuildFacts {
        unit_def_id: id.saturating_neg(),
        position,
        facing,
        count,
        slot: BuildSlot::Append,
        options,
    }
}

#[cfg(test)]
mod tests {
    use super::super::stream::fixture::Packets;
    use super::*;

    const NO_AI: u8 = 255;

    fn order(id: i32, options: u8, params: &[f32]) -> Order {
        Order {
            id,
            options,
            params: params.to_vec(),
        }
    }

    fn read(p: Packets) -> DemoBuildOrders {
        build_orders_from_stream(&p.walked(), HashMap::new(), HashMap::new())
    }

    /// The one order a stream holds.
    fn only(p: Packets) -> BuildOrder {
        let mut got = read(p).orders;
        assert_eq!(got.len(), 1, "{got:?}");
        got.remove(0)
    }

    fn at(x: f32, y: f32, z: f32) -> Option<BuildPosition> {
        Some(BuildPosition { x, y, z })
    }

    #[test]
    fn a_placed_build_carries_its_unit_position_facing_and_frame() {
        let b = only(
            Packets::default()
                .keyframe(0)
                .newframes(90)
                .select(3, &[41])
                .command(3, &order(-242, 0, &[7576.0, 376.5, 2040.0, 3.0])),
        );
        assert_eq!(
            b,
            BuildOrder {
                frame: 90,
                player: 3,
                team: None,
                origin: CommandOrigin::Selection,
                unit_def_id: 242,
                position: at(7576.0, 376.5, 2040.0),
                facing: Some(3),
                count: 1,
                slot: BuildSlot::Replace,
                builders: 1,
                options: 0,
            }
        );
    }

    #[test]
    fn a_placed_build_with_no_facing_does_not_invent_one() {
        let b = only(Packets::default().command(0, &order(-7, 0, &[1.0, 2.0, 3.0])));
        assert_eq!(b.position, at(1.0, 2.0, 3.0));
        assert_eq!(b.facing, None);
    }

    #[test]
    fn a_shift_queued_build_is_appended_and_a_plain_one_replaces() {
        let got = read(
            Packets::default()
                .command(0, &order(-7, SHIFT_KEY, &[1.0, 2.0, 3.0, 0.0]))
                .command(0, &order(-7, 0, &[1.0, 2.0, 3.0, 0.0])),
        );
        let slots: Vec<_> = got.orders.iter().map(|o| o.slot).collect();
        assert_eq!(slots, vec![BuildSlot::Append, BuildSlot::Replace]);
        // Shift multiplies a factory order and never a placed building.
        assert_eq!(got.orders[0].count, 1);
    }

    #[test]
    fn a_factory_queue_order_has_no_position_and_counts_its_modifiers() {
        let got = read(
            Packets::default()
                .command(0, &order(-30, 0, &[]))
                .command(0, &order(-30, SHIFT_KEY, &[]))
                .command(0, &order(-30, CONTROL_KEY, &[]))
                .command(0, &order(-30, SHIFT_KEY | CONTROL_KEY, &[]))
                .command(0, &order(-30, ALT_KEY, &[])),
        );
        assert!(got.orders.iter().all(|o| o.position.is_none()));
        let counts: Vec<_> = got.orders.iter().map(|o| o.count).collect();
        assert_eq!(counts, vec![1, 5, 20, 100, 1]);
        let slots: Vec<_> = got.orders.iter().map(|o| o.slot).collect();
        assert_eq!(slots[..4], [BuildSlot::Append; 4]);
        assert_eq!(slots[4], BuildSlot::Front);
        assert_eq!(got.removals, 0);
    }

    #[test]
    fn taking_a_unit_off_a_factory_queue_is_counted_and_is_not_a_build() {
        let got = read(
            Packets::default()
                .command(0, &order(-30, RIGHT_MOUSE_KEY, &[]))
                .command(0, &order(-30, RIGHT_MOUSE_KEY | SHIFT_KEY, &[])),
        );
        assert_eq!(got.orders, vec![]);
        assert_eq!(got.removals, 2);
    }

    /// The right mouse bit only removes from a factory queue. A builder given
    /// a position builds there whatever the bit says.
    #[test]
    fn a_placed_build_with_the_right_mouse_bit_is_still_a_build() {
        let b = only(Packets::default().command(
            0,
            &order(-7, RIGHT_MOUSE_KEY | SHIFT_KEY, &[1.0, 2.0, 3.0, 1.0]),
        ));
        assert_eq!(b.unit_def_id, 7);
        assert_eq!(b.slot, BuildSlot::Append);
    }

    /// The packet #3818 quotes from a real replay.
    #[test]
    fn an_insert_by_position_is_the_build_it_wraps() {
        let b = only(Packets::default().command(
            0,
            &order(
                CMD_INSERT,
                ALT_KEY,
                &[0.0, -242.0, 0.0, 7576.0, 376.877, 2040.0, 3.0],
            ),
        ));
        assert_eq!(b.unit_def_id, 242);
        assert_eq!(b.position, at(7576.0, 376.877, 2040.0));
        assert_eq!(b.facing, Some(3));
        assert_eq!(b.slot, BuildSlot::InsertAt { position: 0 });
        // The wrapped command's bits, not the insert's.
        assert_eq!(b.options, 0);
    }

    #[test]
    fn an_insert_counts_back_from_the_end_with_a_negative_position() {
        let b = only(Packets::default().command(
            0,
            &order(
                CMD_INSERT,
                ALT_KEY,
                &[-1.0, -9.0, f32::from(SHIFT_KEY), 5.0, 6.0, 7.0, 0.0],
            ),
        ));
        assert_eq!(b.slot, BuildSlot::InsertAt { position: -1 });
        assert_eq!(b.options, SHIFT_KEY);
    }

    /// Without the alt bit the first parameter is a command tag, not a
    /// position, and the right mouse bit puts the build after that command.
    #[test]
    fn an_insert_by_tag_keeps_the_tag_and_which_side_of_it() {
        let wrapped = [77.0, -9.0, 0.0, 5.0, 6.0, 7.0, 0.0];
        let got = read(
            Packets::default()
                .command(0, &order(CMD_INSERT, 0, &wrapped))
                .command(0, &order(CMD_INSERT, RIGHT_MOUSE_KEY, &wrapped)),
        );
        let slots: Vec<_> = got.orders.iter().map(|o| o.slot).collect();
        assert_eq!(
            slots,
            vec![
                BuildSlot::InsertAtTag {
                    tag: 77,
                    after: false
                },
                BuildSlot::InsertAtTag {
                    tag: 77,
                    after: true
                },
            ]
        );
        assert_eq!(got.removals, 0);
    }

    #[test]
    fn an_insert_into_a_factory_queue_has_no_position_and_counts_its_modifiers() {
        let b = only(Packets::default().command(
            0,
            &order(
                CMD_INSERT,
                ALT_KEY | CONTROL_KEY,
                &[0.0, -30.0, f32::from(SHIFT_KEY)],
            ),
        ));
        assert_eq!(b.position, None);
        assert_eq!(b.count, 5);
        assert_eq!(b.slot, BuildSlot::InsertAt { position: 0 });
    }

    #[test]
    fn an_insert_that_wraps_something_else_or_nothing_is_not_a_build() {
        let got = read(
            Packets::default()
                // A move, inserted.
                .command(
                    0,
                    &order(CMD_INSERT, ALT_KEY, &[0.0, 10.0, 0.0, 1.0, 2.0, 3.0]),
                )
                // Too short to be an insert.
                .command(0, &order(CMD_INSERT, ALT_KEY, &[0.0, -5.0])),
        );
        assert_eq!(got.orders, vec![]);
    }

    #[test]
    fn an_order_that_is_not_a_build_is_ignored() {
        let got = read(
            Packets::default()
                .command(0, &order(10, 0, &[1.0, 2.0, 3.0]))
                .command(0, &order(0, 0, &[]))
                .chat(0, 254, "gg")
                .select(0, &[1, 2]),
        );
        assert_eq!(got, DemoBuildOrders::default().with_last_frame(-1));
    }

    #[test]
    fn a_stream_with_no_builds_is_an_empty_list_and_not_incomplete() {
        let got = read(Packets::default().keyframe(0).newframes(3));
        assert_eq!(got.orders, vec![]);
        assert_eq!(got.last_frame, 3);
        assert!(!got.incomplete);
    }

    /// The selection is the builders. Three selected builders given one order
    /// is one order, and a new selection replaces the old one.
    #[test]
    fn one_order_to_several_selected_builders_is_one_order() {
        let got = read(
            Packets::default()
                .select(0, &[10, 11, 12])
                .select(1, &[50])
                .command(0, &order(-7, 0, &[1.0, 2.0, 3.0, 0.0]))
                .select(0, &[10])
                .command(0, &order(-7, 0, &[9.0, 2.0, 3.0, 0.0]))
                .command(2, &order(-7, 0, &[5.0, 2.0, 3.0, 0.0])),
        );
        let builders: Vec<_> = got.orders.iter().map(|o| o.builders).collect();
        assert_eq!(builders, vec![3, 1, 0]);
    }

    /// The four messages that carry orders, and the three things that send
    /// them.
    #[test]
    fn builds_are_read_from_every_message_and_every_origin() {
        // A building apiece, so none is taken for another builder's share of
        // the same one.
        let build = |x: f32| order(-7, 0, &[x, 2.0, 3.0, 0.0]);
        let got = read(
            Packets::default()
                // NETMSG_COMMAND
                .command(0, &build(1.0))
                // NETMSG_AICOMMAND from a widget, then from a skirmish AI
                .unit_command(0, NO_AI, 0, 40, &build(2.0), None)
                .unit_command(0, 2, 5, 41, &build(3.0), None)
                // NETMSG_AICOMMAND_TRACKED
                .unit_command(0, 2, 5, 41, &build(4.0), Some(99))
                // NETMSG_AICOMMANDS
                .unit_commands(0, false, &[40, 41], &[build(5.0)]),
        );
        let origins: Vec<_> = got.orders.iter().map(|o| o.origin).collect();
        let ai = CommandOrigin::Ai { ai: 2, team: 5 };
        assert_eq!(
            origins,
            vec![
                CommandOrigin::Selection,
                CommandOrigin::Lua,
                ai,
                ai,
                CommandOrigin::Lua
            ]
        );
        assert!(got.orders.iter().all(|o| o.unit_def_id == 7));
        // An AI's order belongs to the AI's team, not its host's.
        assert_eq!(got.orders[2].team, Some(5));
    }

    /// One widget packet can hold many orders, so the orders are what is
    /// counted and never the packets.
    #[test]
    fn a_packet_of_several_orders_is_several_builds() {
        let orders = [
            order(-7, SHIFT_KEY, &[1.0, 2.0, 3.0, 0.0]),
            order(10, SHIFT_KEY, &[1.0, 2.0, 3.0]),
            order(-8, SHIFT_KEY, &[4.0, 5.0, 6.0, 0.0]),
        ];
        let all = read(Packets::default().unit_commands(0, false, &[40, 41], &orders));
        assert_eq!(
            all.orders
                .iter()
                .map(|o| (o.unit_def_id, o.builders))
                .collect::<Vec<_>>(),
            vec![(7, 2), (8, 2)]
        );
        // Pairwise, each order goes to the one unit beside it.
        let paired = read(Packets::default().unit_commands(0, true, &[40, 41, 42], &orders));
        assert!(paired.orders.iter().all(|o| o.builders == 1));
    }

    /// Read from real replays: a widget gives each builder the same build in
    /// a packet of its own, all in one frame.
    #[test]
    fn one_building_a_widget_orders_from_several_builders_is_one_order() {
        let here = order(-21, 0, &[456.0, 17.5, 1384.0, 0.0]);
        let there = order(-21, SHIFT_KEY, &[728.0, 12.9, 1384.0, 0.0]);
        let got = read(
            Packets::default()
                .unit_command(0, NO_AI, 0, 29016, &here, None)
                .unit_command(0, NO_AI, 0, 29016, &there, None)
                .unit_command(0, NO_AI, 0, 7070, &here, None)
                .unit_command(0, NO_AI, 0, 7070, &there, None)
                // Another player, and then a later frame, are other orders.
                .unit_command(1, NO_AI, 1, 300, &here, None)
                .keyframe(0)
                .unit_command(0, NO_AI, 0, 5571, &here, None),
        );
        assert_eq!(
            got.orders
                .iter()
                .map(|o| (o.frame, o.player, o.position.map(|p| p.x), o.builders))
                .collect::<Vec<_>>(),
            vec![
                (-1, 0, Some(456.0), 2),
                (-1, 0, Some(728.0), 2),
                (-1, 1, Some(456.0), 1),
                (0, 0, Some(456.0), 1),
            ]
        );
    }

    /// A factory has no position to tell two orders apart by, and two orders
    /// for the same unit are two units.
    #[test]
    fn two_factory_orders_in_one_frame_stay_two() {
        let unit = order(-30, 0, &[]);
        let got = read(
            Packets::default()
                .unit_command(0, NO_AI, 0, 40, &unit, None)
                .unit_command(0, NO_AI, 0, 41, &unit, None),
        );
        assert_eq!(got.orders.len(), 2);
    }

    #[test]
    fn an_order_takes_the_team_its_player_was_on_when_it_arrived() {
        let build = order(-7, 0, &[1.0, 2.0, 3.0, 0.0]);
        let stream = Packets::default()
            .command(0, &build)
            .command(4, &build)
            // TEAMMSG_JOIN_TEAM
            .team(0, 3, 6, 0)
            .command(0, &build)
            .new_player(4, 0, 2, "Latecomer")
            .command(4, &build)
            .walked();
        let got = build_orders_from_stream(
            &stream,
            HashMap::from([(0, "Host".to_string())]),
            HashMap::from([(0, 1)]),
        );
        let teams: Vec<_> = got.orders.iter().map(|o| o.team).collect();
        assert_eq!(teams, vec![Some(1), None, Some(6), Some(2)]);
        assert_eq!(
            got.players,
            vec![
                BuildOrderPlayer {
                    player: 0,
                    name: "Host".into()
                },
                BuildOrderPlayer {
                    player: 4,
                    name: "Latecomer".into()
                },
            ]
        );
    }

    #[test]
    fn a_stream_that_stopped_early_gives_what_it_read_and_says_so() {
        let mut stream = Packets::default()
            .command(0, &order(-7, 0, &[1.0, 2.0, 3.0, 0.0]))
            .walked();
        stream.stopped = Some(crate::model::StreamStop {
            offset: 40,
            reason: "a packet claims 500 bytes and the stream has 1 left".into(),
        });
        let got = build_orders_from_stream(&stream, HashMap::new(), HashMap::new());
        assert_eq!(got.orders.len(), 1);
        assert!(got.incomplete);
    }

    #[test]
    fn the_script_seats_players_and_leaves_spectators_out() {
        let game = find_game(&parse_tdf(
            "[game]{[player0]{name=A;team=2;spectator=0;}[player1]{name=B;team=0;spectator=1;}[player7]{name=C;team=5;}}",
        ));
        assert_eq!(player_teams(&game), HashMap::from([(0, 2), (7, 5)]));
    }

    #[test]
    fn a_build_order_serialises_flat_with_its_slot_tagged() {
        let b = only(Packets::default().command(
            0,
            &order(CMD_INSERT, ALT_KEY, &[0.0, -242.0, 0.0, 1.0, 2.0, 3.0, 1.0]),
        ));
        assert_eq!(
            serde_json::to_value(&b).unwrap(),
            serde_json::json!({
                "frame": -1,
                "player": 0,
                "origin": { "kind": "selection" },
                "unitDefId": 242,
                "position": { "x": 1.0, "y": 2.0, "z": 3.0 },
                "facing": 1,
                "count": 1,
                "slot": { "kind": "insertAt", "position": 0 },
                "builders": 0,
                "options": 0,
            })
        );
    }

    impl DemoBuildOrders {
        fn with_last_frame(mut self, frame: i32) -> Self {
            self.last_frame = frame;
            self
        }
    }

    /// Counts for every replay in `~/.spring/demos`, which is how much of a
    /// build order #3818's insert case is. Run with
    /// `cargo test -p tauri-plugin-coilbox-content real_replay_build_order_counts -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads the replays on this machine"]
    fn real_replay_build_order_counts() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let dir = Path::new(&home).join(".spring/demos");
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        files.sort();
        println!("plain\tinsert\tplaced\tqueue\tremovals\tplayers\tms\tfile");
        for file in files {
            let started = std::time::Instant::now();
            let Ok(got) = demo_build_orders(&file) else {
                continue;
            };
            let ms = started.elapsed().as_millis();
            let insert = got
                .orders
                .iter()
                .filter(|o| {
                    matches!(
                        o.slot,
                        BuildSlot::InsertAt { .. } | BuildSlot::InsertAtTag { .. }
                    )
                })
                .count();
            let placed = got.orders.iter().filter(|o| o.position.is_some()).count();
            println!(
                "{}\t{insert}\t{placed}\t{}\t{}\t{}\t{ms}\t{}",
                got.orders.len() - insert,
                got.orders.len() - placed,
                got.removals,
                got.players.len(),
                file.file_name().unwrap_or_default().to_string_lossy(),
            );
        }
    }
}
