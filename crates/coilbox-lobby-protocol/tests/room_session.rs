//! A scripted room session, checked against the real client fold.
//!
//! Every line [`RoomState::apply`] produces is delivered to the clients it is
//! addressed to and folded through `parse_line` + `reduce`, exactly as the real
//! client does. The assertion is then that each client's `LobbyState` holds the
//! battle the room believes in, rather than the battle the test author expected.
//! A server that drifts from the client fails here.
//!
//! The harness answers `REQUESTBATTLESTATUS` the way `conn.rs` does, because a
//! member's seat only reaches the room through that reply.

use std::collections::{BTreeMap, BTreeSet};

use coilbox_lobby_protocol::server::{parse_client_line, Outbound, PeerId, RoomConfig, RoomState};
use coilbox_lobby_protocol::{
    command, default_battle_status, parse_line, reduce, Battle, BattleStatus, ClientStatus, Delta,
    LobbyState, ServerMessage,
};

const ALICE: PeerId = 1;
const BOB: PeerId = 2;

/// A room and the clients connected to it, each folding what it is sent.
struct Session {
    room: RoomState,
    clients: BTreeMap<PeerId, LobbyState>,
    deltas: BTreeMap<PeerId, Vec<Delta>>,
    /// Who is still on the end of a socket. A client that has been dropped keeps
    /// the state and the deltas it had, the way a disconnected lobby window keeps
    /// showing what it last knew.
    connected: BTreeSet<PeerId>,
}

impl Session {
    fn new(approve_joins: bool) -> Self {
        Session {
            room: RoomState::new(RoomConfig {
                host: "alice".into(),
                ip: "192.168.0.5".into(),
                approve_joins,
            }),
            clients: BTreeMap::new(),
            deltas: BTreeMap::new(),
            connected: BTreeSet::new(),
        }
    }

    /// Open a connection and run the handshake, as the client's login machine
    /// does: greeting, `LISTCOMPFLAGS`, `LOGIN`.
    fn log_in(&mut self, peer: PeerId, name: &str) {
        self.clients.insert(peer, LobbyState::new());
        self.deltas.insert(peer, Vec::new());
        self.connected.insert(peer);
        let greeting = self.room.connect(peer);
        self.deliver(greeting);
        self.send(peer, "LISTCOMPFLAGS");
        self.send(
            peer,
            &command::login(
                name,
                "aGFzaA==",
                "127.0.0.1",
                "Coilbox 0.1",
                "1",
                &["u", "sp"],
            ),
        );
    }

    /// One client line in, everything it produces delivered and folded.
    fn send(&mut self, peer: PeerId, line: &str) {
        let out = self.room.apply(peer, parse_client_line(line));
        self.deliver(out);
    }

    fn deliver(&mut self, out: Vec<Outbound>) {
        let mut replies: Vec<(PeerId, String)> = Vec::new();
        let mut closed: Vec<PeerId> = Vec::new();
        for o in &out {
            if let Outbound::Close { peer } = o {
                closed.push(*peer);
            }
            let peers: Vec<PeerId> = self.connected.iter().copied().collect();
            for peer in peers {
                let Some(line) = o.line_for(peer) else {
                    continue;
                };
                let msg = parse_line(line);
                // The client answers the seat prompt itself. Without this the room
                // never learns the team, ally and colour a member arrived with.
                if matches!(msg, ServerMessage::RequestBattleStatus) {
                    let (bs, color) = self.clients[&peer].my_battle_status_or_default();
                    replies.push((peer, command::my_battle_status(bs, color)));
                }
                let state = self.clients.get_mut(&peer).expect("client is connected");
                let produced = reduce(state, msg);
                self.deltas.entry(peer).or_default().extend(produced);
            }
        }
        for peer in closed {
            self.connected.remove(&peer);
            let out = self.room.disconnect(peer);
            self.deliver(out);
        }
        for (peer, line) in replies {
            self.send(peer, &line);
        }
    }

    /// Drop a connection the way a dead socket does, with no `EXIT` first.
    fn drop_peer(&mut self, peer: PeerId) {
        self.connected.remove(&peer);
        let out = self.room.disconnect(peer);
        self.deliver(out);
    }

    fn battle_seen_by(&self, peer: PeerId) -> Battle {
        self.clients[&peer]
            .battles
            .get(&1)
            .expect("battle 1 in this client's state")
            .clone()
    }

    fn deltas_for(&self, peer: PeerId) -> &[Delta] {
        &self.deltas[&peer]
    }
}

fn open_battle_line() -> String {
    command::open_battle(
        0,
        0,
        "*",
        8452,
        16,
        -1,
        0,
        -1,
        "spring",
        "105.1.1",
        "Red Comet",
        "Tom's LAN game",
        "Beyond All Reason test-1234",
    )
}

/// The room the whole session runs in: alice hosts, sets the game up, and bob
/// joins after everything is already in place.
fn hosted_session() -> Session {
    let mut s = Session::new(false);
    s.log_in(ALICE, "alice");
    s.send(ALICE, &open_battle_line());

    // The host seats themselves as a player, which the protocol default is not.
    let host_seat = BattleStatus {
        mode: true,
        ..default_battle_status()
    };
    s.send(ALICE, &command::my_battle_status(host_seat, 255));

    let mut tags = BTreeMap::new();
    tags.insert("game/startpostype".to_string(), "2".to_string());
    tags.insert("game/modoptions/maxunits".to_string(), "2000".to_string());
    s.send(ALICE, &command::set_script_tags(&tags));
    s.send(ALICE, &command::add_start_rect(0, 0, 0, 50, 200));
    s.send(ALICE, &command::add_start_rect(1, 150, 0, 200, 200));
    s.send(
        ALICE,
        &command::add_bot("Barb", default_battle_status(), 65_280, "BARb"),
    );
    s
}

/// The whole point: what the joiner ends up holding is what the room holds.
///
/// Compared as one struct rather than field by field, so a field the room learns
/// to keep and forgets to send fails this without anybody remembering to assert
/// it.
#[test]
fn the_joiner_folds_the_room_the_host_built() {
    let mut s = hosted_session();
    s.log_in(BOB, "bob");
    s.send(BOB, "JOINBATTLE 1 * s3cret");

    let bob_seat = BattleStatus {
        ally: 1,
        team_id: 1,
        mode: true,
        ..default_battle_status()
    };
    s.send(BOB, &command::my_battle_status(bob_seat, 16_711_680));
    s.send(BOB, "SAYBATTLE hello   there");
    s.send(ALICE, "UPDATEBATTLEINFO 1 0 -1 Supreme Isthmus 1.5");

    let room = s.room.battle_view().expect("the room has a battle");

    // The host sees everything the room holds, script passwords included: they
    // are the one who needs them, for the start script.
    assert_eq!(s.battle_seen_by(ALICE), room);

    // The joiner sees the same room minus everybody's script password, which is
    // the one thing the room deliberately keeps from them.
    let mut without_passwords = room.clone();
    for member in without_passwords.members.values_mut() {
        member.script_password = None;
    }
    assert_eq!(s.battle_seen_by(BOB), without_passwords);

    // Spot checks on the parts of that comparison worth naming.
    assert_eq!(room.members["bob"].battle_status, bob_seat);
    assert_eq!(
        room.members["bob"].script_password.as_deref(),
        Some("s3cret")
    );
    assert_eq!(room.map, "Supreme Isthmus 1.5");
    assert_eq!(room.script_tags["game/modoptions/maxunits"], "2000");
    assert_eq!(room.start_rects[&1].left, 150);
    assert_eq!(room.bots["Barb"].owner, "alice");
    assert_eq!(s.clients[&BOB].current_battle, Some(1));
    assert_eq!(s.clients[&ALICE].host_port, Some(8452));

    // Chat landed in the battle's own channel, spacing intact, for both of them.
    // The map change is in there too: a client turns that into a notice of its
    // own, off the same UPDATEBATTLEINFO that moved the room.
    for peer in [ALICE, BOB] {
        let chat = &s.clients[&peer].channels["__battle__1"].messages;
        assert_eq!(chat.len(), 2);
        assert_eq!(chat[0].from, "bob");
        assert_eq!(chat[0].text, "hello   there");
        assert_eq!(chat[1].text, "Host changed the map to Supreme Isthmus 1.5");
    }
}

/// The ordering constraint, from the joiner's side.
///
/// The script tags and start boxes were set before bob existed. If the room sent
/// them before his `JOINBATTLE` acknowledgement he would have no current battle
/// to file them under, they would be dropped without a trace, and he would sit in
/// a room with no boxes and no options.
#[test]
fn options_and_boxes_set_before_the_joiner_arrived_still_reach_them() {
    let mut s = hosted_session();
    s.log_in(BOB, "bob");
    s.send(BOB, "JOINBATTLE 1 * s3cret");

    let battle = s.battle_seen_by(BOB);
    assert_eq!(battle.script_tags["game/startpostype"], "2");
    assert_eq!(battle.start_rects.len(), 2);
    assert_eq!(battle.start_rects[&0].right, 50);
    assert_eq!(battle.bots["Barb"].ai_dll, "BARb");
    // And the roster he never saw join, with the seats they are already in.
    assert_eq!(battle.members.len(), 2);
    assert!(battle.members["alice"].battle_status.mode);
    assert_eq!(battle.members["alice"].team_color, 255);
}

/// There is no start message in the protocol. The host's client sets its own
/// ingame bit, the room broadcasts it, and the joiner's battle room launches off
/// the delta that produces.
#[test]
fn the_joiner_launches_off_the_hosts_ingame_bit() {
    let mut s = hosted_session();
    s.log_in(BOB, "bob");
    s.send(BOB, "JOINBATTLE 1 * s3cret");
    assert!(!s.clients[&BOB].users["alice"].status.ingame);

    let ingame = ClientStatus {
        ingame: true,
        ..Default::default()
    };
    s.send(ALICE, &command::my_status(ingame));

    assert!(s.clients[&BOB].users["alice"].status.ingame);
    assert!(s.deltas_for(BOB).contains(&Delta::PlayerWentIngame {
        name: "alice".into()
    }));
}

/// Approval changes when the joiner is let in, not what they are told once they
/// are. The room they end up in is the same room.
#[test]
fn an_approved_joiner_ends_up_in_the_same_room() {
    let mut s = Session::new(true);
    s.log_in(ALICE, "alice");
    s.send(ALICE, &open_battle_line());
    s.log_in(BOB, "bob");

    s.send(BOB, "JOINBATTLE 1 * s3cret");
    assert_eq!(s.clients[&BOB].current_battle, None, "still waiting");
    assert_eq!(s.room.pending_joins().len(), 1);

    s.send(ALICE, &command::join_battle_accept("bob"));
    assert_eq!(s.clients[&BOB].current_battle, Some(1));
    assert!(s.battle_seen_by(BOB).members.contains_key("bob"));
    assert!(s.room.pending_joins().is_empty());
}

/// A joiner turned away has to be told why, in words, rather than dropped.
#[test]
fn a_turned_away_joiner_is_told_in_words() {
    let mut s = Session::new(true);
    s.log_in(ALICE, "alice");
    s.send(ALICE, &open_battle_line());
    s.log_in(BOB, "bob");

    s.send(BOB, "JOINBATTLE 1 * s3cret");
    s.send(ALICE, "JOINBATTLEDENY bob this is a private game");

    assert_eq!(s.clients[&BOB].current_battle, None);
    assert!(s.deltas_for(BOB).contains(&Delta::JoinBattleFailed {
        reason: "this is a private game".into()
    }));
}

/// The host quitting has to reach the joiner as a closed battle, not as silence.
#[test]
fn the_host_quitting_takes_the_battle_with_it() {
    let mut s = hosted_session();
    s.log_in(BOB, "bob");
    s.send(BOB, "JOINBATTLE 1 * s3cret");
    assert_eq!(s.clients[&BOB].current_battle, Some(1));

    s.drop_peer(ALICE);

    assert_eq!(s.clients[&BOB].current_battle, None);
    assert!(s.clients[&BOB].battles.is_empty());
    assert!(!s.clients[&BOB].users.contains_key("alice"));
    assert!(s.room.battle_view().is_none());
}

/// A kicked player is out of the battle on their own screen too, and stays out.
#[test]
fn a_kicked_player_is_out_on_their_own_screen() {
    let mut s = hosted_session();
    s.log_in(BOB, "bob");
    s.send(BOB, "JOINBATTLE 1 * s3cret");

    s.send(ALICE, "KICKFROMBATTLE bob");
    assert!(!s.battle_seen_by(ALICE).members.contains_key("bob"));

    // Back on a fresh connection, under the same name, and turned away at login.
    s.log_in(3, "bob");
    assert!(s.deltas_for(3).contains(&Delta::LoginDenied {
        reason: "you were kicked from this room".into()
    }));
    assert_eq!(s.clients[&3].current_battle, None);
}
