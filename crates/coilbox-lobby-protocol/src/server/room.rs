//! The authoritative model behind a room the host runs itself.
//!
//! [`RoomState::apply`] is the mirror of [`crate::reduce`]: a command in, a list
//! of lines out, no IO and no clock. The plugin owns the sockets and decides what
//! a peer id means. This decides what every peer is told.
//!
//! What it holds that [`crate::LobbyState`] does not: which socket is which
//! player, the script password each member arrived with, and the joins waiting on
//! the host's approval. A client only ever sees its own view of a room, so none of
//! those have anywhere to live on the client side.
//!
//! # Ordering
//!
//! `SETSCRIPTTAGS`, `REMOVESCRIPTTAGS`, `ADDSTARTRECT` and `REMOVESTARTRECT` carry
//! no battle id, so a client files them under whatever battle it is currently in.
//! Everything this module sends a joiner in reply to their `JOINBATTLE` therefore
//! goes out after their `JOINBATTLE` acknowledgement, never before: sent first
//! they are dropped in silence and the joiner sits in a room with no start boxes
//! and no game options.
//!
//! # Starting the match
//!
//! There is no start message in the protocol. A joiner's battle room launches when
//! the host's `ingame` bit goes up, so the host's client sends `MYSTATUS` and the
//! room broadcasts `CLIENTSTATUS`. That is the whole trigger.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::client::ClientCommand;
use super::line::{self, BattleOpened};
use crate::state::{Battle, Bot, MemberStatus, StartRect};
use crate::status::{BattleStatus, ClientStatus};

/// A connected socket, named by whatever the driving plugin counts with.
pub type PeerId = u64;

/// The protocol version in the greeting. Every client we care about checks only
/// that the greeting has four fields, but this is the version the room speaks.
const PROTOCOL_VERSION: &str = "0.38";

/// The greeting's NAT-help port. A room does no hole punching, so nothing ever
/// dials it. It is here because the field is not optional.
const NAT_HELP_PORT: u16 = 8452;

/// The compatibility flags a room supports: `u` for names rather than session ids
/// in battle-status lines, `sp` for script passwords. Our own client asks for
/// exactly these two.
const COMP_FLAGS: [&str; 2] = ["u", "sp"];

/// Where a line goes.
///
/// `All` includes the peer whose command produced it, because that is how a real
/// server behaves and the client relies on the echo: chat it sent appears when the
/// room says it back, not when it types it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outbound {
    /// One line to one peer.
    To { peer: PeerId, line: String },
    /// One line to every logged-in peer.
    All { line: String },
    /// One line to every logged-in peer except this one, which is getting a
    /// different version of it. Only `JOINEDBATTLE` needs this: the script
    /// password in it is the host's business alone.
    AllExcept { peer: PeerId, line: String },
    /// Drop this connection once the lines already queued for it have gone out.
    /// A refusal the peer cannot recover from, so the room stops talking to it.
    Close { peer: PeerId },
}

impl Outbound {
    /// The line this peer is due, if any.
    ///
    /// The addressing half of delivery, which is the half that does not need to
    /// know who is logged in. [`Outbound::Close`] carries no line, so it answers
    /// `None` for everybody, the peer it closes included.
    pub fn line_for(&self, peer: PeerId) -> Option<&str> {
        match self {
            Outbound::To { peer: to, line } if *to == peer => Some(line),
            Outbound::All { line } => Some(line),
            Outbound::AllExcept { peer: except, line } if *except != peer => Some(line),
            _ => None,
        }
    }
}

/// What the room needs to know that no client command carries.
#[derive(Clone, Debug)]
pub struct RoomConfig {
    /// The name of the player with host powers. The host's own client connects
    /// over loopback like any other, so this is the only thing that tells them
    /// apart.
    pub host: String,
    /// The address a joining engine dials, announced in `BATTLEOPENED`. The LAN
    /// address on a LAN, the mapped public one when a port has been forwarded.
    pub ip: String,
    /// Whether a join waits for the host to answer it.
    ///
    /// Approval is deliberately invisible on the wire. Sending the host
    /// `JOINBATTLEREQUEST` would be the protocol's way to ask, but our own client
    /// answers that with an automatic `JOINBATTLEACCEPT` (see `conn.rs`), which
    /// would approve every join before the host saw it. The plugin reads
    /// [`RoomState::pending_joins`] and answers for the host instead.
    pub approve_joins: bool,
}

/// A join the host has not answered yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingJoin {
    pub peer: PeerId,
    pub name: String,
    pub script_password: Option<String>,
}

/// One connection, logged in or not.
#[derive(Clone, Debug, Default)]
struct Peer {
    /// `None` until `LOGIN` is accepted. A peer with no name is not announced, is
    /// not broadcast to, and can do nothing but log in.
    name: Option<String>,
    agent: String,
    status: ClientStatus,
    /// `Some` while this peer is in the battle.
    member: Option<MemberStatus>,
}

/// The battle the host opened, of which a room has at most one.
#[derive(Clone, Debug)]
struct RoomBattle {
    id: u32,
    founder: String,
    channel: String,
    /// The room password, from the host's `OPENBATTLE` key slot.
    key: Option<String>,
    port: u16,
    max_players: u32,
    modhash: i32,
    maphash: i32,
    engine: String,
    version: String,
    map: String,
    title: String,
    modname: String,
    locked: bool,
    spectator_count: u32,
    script_tags: BTreeMap<String, String>,
    start_rects: BTreeMap<u8, StartRect>,
    bots: BTreeMap<String, Bot>,
}

/// The authoritative state of a host-run room.
#[derive(Clone, Debug)]
pub struct RoomState {
    config: RoomConfig,
    peers: BTreeMap<PeerId, Peer>,
    battle: Option<RoomBattle>,
    pending: Vec<PendingJoin>,
    /// Names the host has kicked. Blocked for the life of the room, which is what
    /// makes a kick worth anything when anyone can reconnect in a second.
    kicked: BTreeSet<String>,
    /// The seat each name held when their connection died under them, so a
    /// player who drops gets their team, ally and colour back rather than
    /// rebuilding them in front of everybody.
    ///
    /// Keyed by name and held outside the peer table on purpose. The plugin frees
    /// a name after 90 seconds of silence, so the socket a seat was left on is
    /// often long gone by the time its owner is back. Nothing about a seat
    /// depends on that socket, so the sweep and the reclaim cannot race: whether
    /// the returning player beats the sweep or arrives an hour later, the same
    /// seat is here for them.
    ///
    /// A deliberate `LEAVEBATTLE` leaves nothing behind. Somebody who chose to
    /// leave the battle is choosing their seat again when they come back, which
    /// is what a real server does too.
    seats: BTreeMap<String, MemberStatus>,
    next_battle_id: u32,
}

impl RoomState {
    /// A room with no peers and no battle.
    pub fn new(config: RoomConfig) -> Self {
        RoomState {
            config,
            peers: BTreeMap::new(),
            battle: None,
            pending: Vec::new(),
            kicked: BTreeSet::new(),
            seats: BTreeMap::new(),
            next_battle_id: 1,
        }
    }

    /// Register a fresh connection and greet it.
    ///
    /// The greeting is the half of the handshake the client cannot start without,
    /// and it has to have exactly four fields.
    pub fn connect(&mut self, peer: PeerId) -> Vec<Outbound> {
        self.peers.insert(peer, Peer::default());
        vec![Outbound::To {
            peer,
            line: line::tas_server(PROTOCOL_VERSION, "*", NAT_HELP_PORT, 0),
        }]
    }

    /// Forget a connection and tell the room, whether it left politely or the
    /// socket simply died.
    pub fn disconnect(&mut self, peer: PeerId) -> Vec<Outbound> {
        // Out of the battle first, while the peer is still in the room: leaving is
        // what closes the battle when it is the host who has gone.
        let name = self.name_of(peer);
        // A connection ending while it still holds a seat is not a decision to
        // give that seat up, so it is kept under the name that held it. This is
        // the only place that remembers one: a peer who sent `LEAVEBATTLE` has no
        // seat left by the time they get here, which is how choosing to leave
        // stays different from being cut off.
        if let (Some(name), Some(member)) = (
            name.clone(),
            self.peers.get(&peer).and_then(|p| p.member.clone()),
        ) {
            self.seats.insert(name, member);
        }
        let mut out = match &name {
            Some(name) => self.leave_battle(peer, name),
            None => vec![],
        };
        self.peers.remove(&peer);
        self.pending.retain(|p| p.peer != peer);
        if let Some(name) = name {
            out.push(Outbound::All {
                line: line::remove_user(&name),
            });
        }
        out
    }

    /// The joins waiting on the host, oldest first.
    pub fn pending_joins(&self) -> &[PendingJoin] {
        &self.pending
    }

    /// The connection the host is logged in on, if they are here yet.
    ///
    /// Approval never reaches the wire (see [`RoomConfig::approve_joins`]), so the
    /// answer to a queued join has to be applied as though the host had typed it.
    /// This is the peer to apply it as.
    pub fn host_peer(&self) -> Option<PeerId> {
        self.peer_named(&self.config.host)
    }

    /// The battle as the room believes it, in the shape a client folds it into.
    ///
    /// Script passwords are included: this is the room's own view, and the host is
    /// the only one it is ever shown to.
    pub fn battle_view(&self) -> Option<Battle> {
        let b = self.battle.as_ref()?;
        Some(Battle {
            id: b.id,
            host: b.founder.clone(),
            ip: self.config.ip.clone(),
            port: b.port.to_string(),
            nat_type: "0".to_string(),
            map: b.map.clone(),
            maphash: b.maphash.to_string(),
            modname: b.modname.clone(),
            engine: b.engine.clone(),
            version: b.version.clone(),
            max_players: b.max_players,
            passworded: b.key.is_some(),
            locked: b.locked,
            spectator_count: b.spectator_count,
            title: b.title.clone(),
            channel: Some(b.channel.clone()),
            members: self.members(),
            bots: b.bots.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            script_tags: b.script_tags.clone(),
            start_rects: b.start_rects.iter().map(|(k, v)| (*k, *v)).collect(),
            ..Default::default()
        })
    }

    /// Apply one client command, returning the lines it produces.
    pub fn apply(&mut self, peer: PeerId, cmd: ClientCommand) -> Vec<Outbound> {
        // Nothing at all is possible from a socket the room has not been told
        // about, and nothing but the handshake is possible before a login.
        if !self.peers.contains_key(&peer) {
            return vec![];
        }
        match cmd {
            ClientCommand::ListCompFlags => vec![Outbound::To {
                peer,
                line: line::comp_flags(&COMP_FLAGS),
            }],
            ClientCommand::Login {
                username, agent, ..
            } => self.login(peer, username, agent),
            ClientCommand::Ping { token } => vec![Outbound::To {
                peer,
                line: line::pong(token.as_deref()),
            }],
            ClientCommand::Exit { .. } => {
                let mut out = self.disconnect(peer);
                out.push(Outbound::Close { peer });
                out
            }
            // The two battle commands are answered rather than dropped, because
            // a client that sends one before its login has landed is left with a
            // room that has its socket, no battle, and nothing said about either
            // (issue #1587). Every other command is a client talking to itself
            // and costs nothing to ignore.
            ClientCommand::OpenBattle { .. } if self.name_of(peer).is_none() => {
                vec![Outbound::To {
                    peer,
                    line: line::open_battle_failed("you are not logged in yet"),
                }]
            }
            ClientCommand::JoinBattle { .. } if self.name_of(peer).is_none() => {
                vec![Outbound::To {
                    peer,
                    line: line::join_battle_failed("you are not logged in yet"),
                }]
            }
            _ if self.name_of(peer).is_none() => vec![],
            ClientCommand::OpenBattle {
                key,
                port,
                max_players,
                modhash,
                maphash,
                engine,
                version,
                map,
                title,
                modname,
                ..
            } => self.open_battle(
                peer,
                OpenedBy {
                    key,
                    port,
                    max_players,
                    modhash: modhash as i32,
                    maphash: maphash as i32,
                    engine,
                    version,
                    map,
                    title,
                    modname,
                },
            ),
            ClientCommand::JoinBattle {
                id,
                key,
                script_password,
            } => self.join_battle(peer, id, key, script_password),
            ClientCommand::LeaveBattle => {
                let name = self.name_of(peer).unwrap_or_default();
                self.leave_battle(peer, &name)
            }
            ClientCommand::JoinBattleAccept { username } => self.approve_join(peer, &username),
            ClientCommand::JoinBattleDeny { username, reason } => {
                self.refuse_join(peer, &username, reason)
            }
            ClientCommand::MyStatus { status } => self.my_status(peer, status),
            ClientCommand::MyBattleStatus {
                battle_status,
                team_color,
            } => self.my_battle_status(peer, battle_status, team_color),
            ClientCommand::UpdateBattleInfo {
                spectator_count,
                locked,
                maphash,
                map,
            } => self.update_battle_info(peer, spectator_count, locked, maphash as i32, map),
            ClientCommand::AddBot {
                name,
                battle_status,
                team_color,
                ai_dll,
            } => self.add_bot(peer, name, battle_status, team_color as u32, ai_dll),
            ClientCommand::UpdateBot {
                name,
                battle_status,
                team_color,
            } => self.update_bot(peer, name, battle_status, team_color as u32),
            ClientCommand::RemoveBot { name } => self.remove_bot(peer, name),
            ClientCommand::AddStartRect {
                ally,
                left,
                top,
                right,
                bottom,
            } => self.host_only(peer, |room| {
                let rect = StartRect {
                    left,
                    top,
                    right,
                    bottom,
                };
                room.battle.as_mut()?.start_rects.insert(ally, rect);
                Some(vec![Outbound::All {
                    line: line::add_start_rect(ally, left, top, right, bottom),
                }])
            }),
            ClientCommand::RemoveStartRect { ally } => self.host_only(peer, |room| {
                room.battle.as_mut()?.start_rects.remove(&ally);
                Some(vec![Outbound::All {
                    line: line::remove_start_rect(ally),
                }])
            }),
            ClientCommand::SetScriptTags { tags } => self.host_only(peer, |room| {
                let battle = room.battle.as_mut()?;
                let changed: BTreeMap<String, String> = tags.into_iter().collect();
                if changed.is_empty() {
                    return None;
                }
                battle.script_tags.extend(changed.clone());
                Some(vec![Outbound::All {
                    line: line::set_script_tags(&changed),
                }])
            }),
            ClientCommand::RemoveScriptTags { tags } => self.host_only(peer, |room| {
                let battle = room.battle.as_mut()?;
                if tags.is_empty() {
                    return None;
                }
                for k in &tags {
                    battle.script_tags.remove(k);
                }
                let refs: Vec<&str> = tags.iter().map(String::as_str).collect();
                Some(vec![Outbound::All {
                    line: line::remove_script_tags(&refs),
                }])
            }),
            ClientCommand::SayBattle { message } => self.say_battle(peer, &message, false),
            ClientCommand::SayBattleEx { message } => self.say_battle(peer, &message, true),
            ClientCommand::ForceTeamNo { username, team } => {
                self.force(peer, &username, |m| m.battle_status.team_id = team)
            }
            ClientCommand::ForceAllyNo { username, ally } => {
                self.force(peer, &username, |m| m.battle_status.ally = ally)
            }
            ClientCommand::ForceSpectatorMode { username } => {
                self.force(peer, &username, |m| m.battle_status.mode = false)
            }
            ClientCommand::ForceTeamColor {
                username,
                team_color,
            } => self.force(peer, &username, |m| m.team_color = team_color as u32),
            ClientCommand::KickFromBattle { username } => self.kick(peer, &username),
            // Everything else is a command a room has no answer for: the friend
            // and ignore lists our own client fires on login, the channel
            // directory, a registration attempt. Silence is the right answer.
            // `FAILED` would pop a toast on a client that did nothing wrong.
            _ => vec![],
        }
    }

    /// Accept or refuse a login, and on acceptance stream the room's state.
    ///
    /// A room has no accounts, so the name a client presents is the whole of its
    /// identity. Two peers under one name would have one member entry between
    /// them, so the second is refused. The refusal carries a name that is free, so
    /// the person reading it has something to do about it rather than a dead end.
    ///
    /// A name is never taken off a live connection. Letting a second login evict
    /// the first would hand anybody a way to throw anybody else out by typing
    /// their name. A player whose socket died instead of closing waits for the
    /// idle sweep, and their seat is waiting for them when they get back in: see
    /// [`RoomState::seats`].
    fn login(&mut self, peer: PeerId, username: String, agent: String) -> Vec<Outbound> {
        if self.name_of(peer).is_some() {
            return vec![];
        }
        // A space splits it across two fields of ADDUSER, a tab splits the
        // BATTLEOPENED sentence it hosts. Neither survives the trip.
        if username.is_empty() || username.chars().any(char::is_whitespace) {
            return self.deny(peer, "that name has whitespace in it");
        }
        if self.peer_named(&username).is_some() {
            let free = self.suggest_name(&username);
            return self.deny(
                peer,
                &format!("that name is already in this room, try {free}"),
            );
        }
        if self.kicked.contains(&username) {
            return self.deny(peer, "you were kicked from this room");
        }

        let entry = self.peers.get_mut(&peer).expect("peer checked by caller");
        entry.name = Some(username.clone());
        entry.agent = agent.clone();

        let mut out = vec![Outbound::To {
            peer,
            line: line::accepted(&username),
        }];
        // The whole roster, this peer included, then any status that is not the
        // default: somebody arriving after the host went ingame has to see that.
        for (id, p) in &self.peers {
            let Some(name) = &p.name else { continue };
            out.push(Outbound::To {
                peer,
                line: line::add_user(name, "??", &id.to_string(), &p.agent),
            });
            if p.status != ClientStatus::default() {
                out.push(Outbound::To {
                    peer,
                    line: line::client_status(name, p.status),
                });
            }
        }
        if let Some(b) = &self.battle {
            out.push(Outbound::To {
                peer,
                line: line::battle_opened(&self.announcement(b)),
            });
        }
        // Nothing else marks the client ready, and it has no timeout to fall back
        // on: omit this and the joiner hangs with no error.
        out.push(Outbound::To {
            peer,
            line: line::login_info_end(),
        });
        out.push(Outbound::AllExcept {
            peer,
            line: line::add_user(&username, "??", &peer.to_string(), &agent),
        });
        out
    }

    /// A free name near the one somebody asked for: the same name with a number
    /// on the end, counting up until one nobody holds.
    ///
    /// Trailing digits are stripped first, so a second attempt by `alice2` offers
    /// `alice3` rather than `alice22`. Kicked names are skipped, because
    /// suggesting one would send the reader straight into a second refusal.
    fn suggest_name(&self, taken: &str) -> String {
        let stem = taken.trim_end_matches(|c: char| c.is_ascii_digit());
        let stem = if stem.is_empty() { taken } else { stem };
        // Terminates: every step rules out one name, and the room holds a finite
        // number of them.
        let mut n = 2u32;
        loop {
            let candidate = format!("{stem}{n}");
            if self.peer_named(&candidate).is_none() && !self.kicked.contains(&candidate) {
                return candidate;
            }
            n += 1;
        }
    }

    fn deny(&mut self, peer: PeerId, reason: &str) -> Vec<Outbound> {
        vec![
            Outbound::To {
                peer,
                line: line::denied(reason),
            },
            Outbound::Close { peer },
        ]
    }

    /// Open the host's battle. One room, one battle, one founder.
    fn open_battle(&mut self, peer: PeerId, opened: OpenedBy) -> Vec<Outbound> {
        let name = self.name_of(peer).unwrap_or_default();
        if name != self.config.host {
            return vec![Outbound::To {
                peer,
                line: line::open_battle_failed("only the host can open a battle here"),
            }];
        }
        if self.battle.is_some() {
            return vec![Outbound::To {
                peer,
                line: line::open_battle_failed("this room already has a battle"),
            }];
        }
        let id = self.next_battle_id;
        self.next_battle_id += 1;
        let battle = RoomBattle {
            id,
            founder: name,
            channel: format!("__battle__{id}"),
            key: opened.key,
            port: opened.port,
            max_players: opened.max_players,
            modhash: opened.modhash,
            maphash: opened.maphash,
            engine: opened.engine,
            version: opened.version,
            map: opened.map,
            title: opened.title,
            modname: opened.modname,
            locked: false,
            spectator_count: 0,
            script_tags: BTreeMap::new(),
            start_rects: BTreeMap::new(),
            bots: BTreeMap::new(),
        };
        // A client seeds the founder as a member off BATTLEOPENED alone, so the
        // host is in their own battle without a JOINEDBATTLE.
        if let Some(p) = self.peers.get_mut(&peer) {
            p.member = Some(MemberStatus::default());
        }
        let announcement = self.announcement(&battle);
        let port = battle.port;
        self.battle = Some(battle);
        vec![
            // The battle has to exist on the client before its own acknowledgement
            // names it, so the broadcast goes first.
            Outbound::All {
                line: line::battle_opened(&announcement),
            },
            Outbound::To {
                peer,
                line: line::open_battle(id),
            },
            Outbound::To {
                peer,
                line: line::host_port(port),
            },
            Outbound::To {
                peer,
                line: line::request_battle_status(),
            },
        ]
    }

    /// Let a peer into the battle, or say why not.
    fn join_battle(
        &mut self,
        peer: PeerId,
        id: u32,
        key: Option<String>,
        script_password: Option<String>,
    ) -> Vec<Outbound> {
        let refuse = |reason: &str| {
            vec![Outbound::To {
                peer,
                line: line::join_battle_failed(reason),
            }]
        };
        let name = self.name_of(peer).unwrap_or_default();
        let seats = self.members().len() as u32;
        let Some(battle) = &self.battle else {
            return refuse("this room has no battle open");
        };
        if battle.id != id {
            return refuse("this room has no battle with that id");
        }
        if self.peers[&peer].member.is_some() {
            return refuse("you are already in this battle");
        }
        if self.kicked.contains(&name) {
            return refuse("you were kicked from this room");
        }
        // Two refusals rather than one, because they ask for different things: a
        // joiner who sent nothing has to be told there is a password at all, and
        // a joiner who sent one has to be told to try again. An open room takes
        // whatever it is handed, including a password nobody asked for.
        match (battle.key.as_deref(), key.as_deref()) {
            (Some(_), None) => return refuse("this room needs a password"),
            (Some(want), Some(got)) if want != got => return refuse("wrong room password"),
            _ => {}
        }
        if seats >= battle.max_players {
            return refuse("this room is full");
        }
        if self.config.approve_joins && name != battle.founder {
            self.pending.push(PendingJoin {
                peer,
                name,
                script_password,
            });
            return vec![];
        }
        self.admit(peer, script_password)
    }

    /// The host approves a queued join.
    fn approve_join(&mut self, peer: PeerId, username: &str) -> Vec<Outbound> {
        let Some(waiting) = self.take_pending(peer, username) else {
            return vec![];
        };
        self.admit(waiting.peer, waiting.script_password)
    }

    /// The host turns a queued join away, with a reason they see verbatim.
    fn refuse_join(
        &mut self,
        peer: PeerId,
        username: &str,
        reason: Option<String>,
    ) -> Vec<Outbound> {
        let Some(waiting) = self.take_pending(peer, username) else {
            return vec![];
        };
        vec![Outbound::To {
            peer: waiting.peer,
            line: line::join_battle_failed(
                &reason.unwrap_or_else(|| "the host turned you away".to_string()),
            ),
        }]
    }

    /// Pull a queued join off the list, if the asker is the host.
    fn take_pending(&mut self, peer: PeerId, username: &str) -> Option<PendingJoin> {
        if !self.is_host(peer) {
            return None;
        }
        let idx = self.pending.iter().position(|p| p.name == username)?;
        Some(self.pending.remove(idx))
    }

    /// Put a peer in the battle and bring them up to date.
    ///
    /// Every line after the first depends on the first: they either carry no
    /// battle id, or they name a member the joiner has not been told about yet.
    ///
    /// # Reclaiming a seat
    ///
    /// A name with a seat waiting for it (see [`RoomState::seats`]) gets that
    /// seat back, announced to the room, and is *not* asked for one. The two are
    /// alternatives, not a sequence.
    ///
    /// `REQUESTBATTLESTATUS` is answered by the client's connection task out of
    /// whatever it has folded so far, and a client that has just reconnected has
    /// folded nothing. Ask it before telling it and the answer is the spectator
    /// default, which comes back as a `MYBATTLESTATUS` that overwrites the seat we
    /// had just handed back. Ask it after and the answer happens to be right.
    /// Measured on the wire, both ways round. Not asking is the version that does
    /// not depend on which line the client reads first.
    fn admit(&mut self, peer: PeerId, script_password: Option<String>) -> Vec<Outbound> {
        let (Some(name), Some(battle)) = (self.name_of(peer), self.battle.as_ref()) else {
            return vec![];
        };
        let (id, channel, modhash) = (battle.id, battle.channel.clone(), battle.modhash);
        let existing = self.members();

        let mut out = vec![Outbound::To {
            peer,
            line: line::join_battle(id, modhash, Some(&channel)),
        }];
        // Who is already here. A status line naming somebody the joiner has never
        // been told about is filed under no battle at all and lost.
        for (member, status) in &existing {
            out.push(Outbound::To {
                peer,
                line: line::joined_battle(id, member, None),
            });
            out.push(Outbound::To {
                peer,
                line: line::client_battle_status(member, status.battle_status, status.team_color),
            });
        }
        let battle = self.battle.as_ref().expect("battle checked above");
        if !battle.script_tags.is_empty() {
            out.push(Outbound::To {
                peer,
                line: line::set_script_tags(&battle.script_tags),
            });
        }
        for (ally, rect) in &battle.start_rects {
            out.push(Outbound::To {
                peer,
                line: line::add_start_rect(*ally, rect.left, rect.top, rect.right, rect.bottom),
            });
        }
        for bot in battle.bots.values() {
            out.push(Outbound::To {
                peer,
                line: line::add_bot(
                    id,
                    &bot.name,
                    &bot.owner,
                    bot.battle_status,
                    bot.team_color,
                    &bot.ai_dll,
                ),
            });
        }
        out.push(Outbound::To {
            peer,
            line: line::update_battle_info(
                id,
                battle.spectator_count,
                battle.locked,
                battle.maphash,
                &battle.map,
            ),
        });

        // The script password is the one they arrived with, never the one they
        // left with: the client generates a fresh one when it cannot remember the
        // old, and the host's start script has to authenticate the new socket.
        let reclaimed = self.seats.remove(&name);
        let (battle_status, team_color) = match &reclaimed {
            Some(seat) => (seat.battle_status, seat.team_color),
            None => (BattleStatus::default(), 0),
        };
        self.peers.get_mut(&peer).expect("peer exists").member = Some(MemberStatus {
            battle_status,
            team_color,
            script_password: script_password.clone(),
        });

        // The room learns of the newcomer. Only the host is told their script
        // password, which is what the start script needs and nobody else does.
        let host = self.peer_named(&self.config.host);
        match (host, script_password) {
            (Some(host_peer), Some(sp)) => {
                out.push(Outbound::To {
                    peer: host_peer,
                    line: line::joined_battle(id, &name, Some(&sp)),
                });
                out.push(Outbound::AllExcept {
                    peer: host_peer,
                    line: line::joined_battle(id, &name, None),
                });
            }
            _ => out.push(Outbound::All {
                line: line::joined_battle(id, &name, None),
            }),
        }
        match reclaimed {
            // The seat they dropped with, given back and said out loud, so their
            // own room and everybody else's agree without anybody being asked.
            Some(_) => out.push(Outbound::All {
                line: line::client_battle_status(&name, battle_status, team_color),
            }),
            // Their team, ally and colour come back as MYBATTLESTATUS, which the
            // room then broadcasts. Without the prompt they sit at the default.
            None => out.push(Outbound::To {
                peer,
                line: line::request_battle_status(),
            }),
        }
        out
    }

    /// Take a peer out of the battle, closing it if they founded it.
    fn leave_battle(&mut self, peer: PeerId, name: &str) -> Vec<Outbound> {
        self.pending.retain(|p| p.peer != peer);
        let was_member = self
            .peers
            .get_mut(&peer)
            .is_some_and(|p| p.member.take().is_some());
        if !was_member {
            return vec![];
        }
        let Some(battle) = &self.battle else {
            return vec![];
        };
        let id = battle.id;
        if battle.founder == name {
            // The founder left, so the battle goes with them. A client clears its
            // current battle off BATTLECLOSED, so nobody needs a LEFTBATTLE too.
            self.battle = None;
            self.pending.clear();
            // Seats belong to a battle, not to the room. The next battle the host
            // opens has its own map and its own teams, so an old seat in it would
            // be a team nobody picked.
            self.seats.clear();
            for p in self.peers.values_mut() {
                p.member = None;
            }
            return vec![Outbound::All {
                line: line::battle_closed(id),
            }];
        }
        let owned: Vec<String> = battle
            .bots
            .values()
            .filter(|b| b.owner == name)
            .map(|b| b.name.clone())
            .collect();
        let battle = self.battle.as_mut().expect("battle checked above");
        for bot in &owned {
            battle.bots.remove(bot);
        }
        let mut out: Vec<Outbound> = owned
            .iter()
            .map(|bot| Outbound::All {
                line: line::remove_bot(id, bot),
            })
            .collect();
        out.push(Outbound::All {
            line: line::left_battle(id, name),
        });
        out
    }

    /// A client status push. The host's is how a match starts: every joiner's
    /// battle room launches the engine when the host's ingame bit goes up.
    fn my_status(&mut self, peer: PeerId, status: i32) -> Vec<Outbound> {
        let status = ClientStatus::from_int(status);
        let Some(p) = self.peers.get_mut(&peer) else {
            return vec![];
        };
        p.status = status;
        let Some(name) = p.name.clone() else {
            return vec![];
        };
        vec![Outbound::All {
            line: line::client_status(&name, status),
        }]
    }

    fn my_battle_status(&mut self, peer: PeerId, status: i32, color: i64) -> Vec<Outbound> {
        let status = BattleStatus::from_int(status);
        let color = color as u32;
        let Some(p) = self.peers.get_mut(&peer) else {
            return vec![];
        };
        let (Some(name), Some(member)) = (p.name.clone(), p.member.as_mut()) else {
            return vec![];
        };
        member.battle_status = status;
        member.team_color = color;
        vec![Outbound::All {
            line: line::client_battle_status(&name, status, color),
        }]
    }

    fn update_battle_info(
        &mut self,
        peer: PeerId,
        spectator_count: u32,
        locked: bool,
        maphash: i32,
        map: String,
    ) -> Vec<Outbound> {
        self.host_only(peer, |room| {
            let battle = room.battle.as_mut()?;
            battle.spectator_count = spectator_count;
            battle.locked = locked;
            battle.maphash = maphash;
            battle.map = map.clone();
            Some(vec![Outbound::All {
                line: line::update_battle_info(battle.id, spectator_count, locked, maphash, &map),
            }])
        })
    }

    fn add_bot(
        &mut self,
        peer: PeerId,
        name: String,
        battle_status: i32,
        team_color: u32,
        ai_dll: String,
    ) -> Vec<Outbound> {
        let Some(owner) = self.name_of(peer) else {
            return vec![];
        };
        if self.peers[&peer].member.is_none() || name.chars().any(char::is_whitespace) {
            return vec![];
        }
        let Some(battle) = self.battle.as_mut() else {
            return vec![];
        };
        if battle.bots.contains_key(&name) {
            return vec![];
        }
        let bot = Bot {
            name: name.clone(),
            owner,
            ai_dll,
            battle_status: BattleStatus::from_int(battle_status),
            team_color,
        };
        let line = line::add_bot(
            battle.id,
            &bot.name,
            &bot.owner,
            bot.battle_status,
            bot.team_color,
            &bot.ai_dll,
        );
        battle.bots.insert(name, bot);
        vec![Outbound::All { line }]
    }

    fn update_bot(
        &mut self,
        peer: PeerId,
        name: String,
        battle_status: i32,
        team_color: u32,
    ) -> Vec<Outbound> {
        let (Some(who), is_host) = (self.name_of(peer), self.is_host(peer)) else {
            return vec![];
        };
        let Some(battle) = self.battle.as_mut() else {
            return vec![];
        };
        let Some(bot) = battle.bots.get_mut(&name) else {
            return vec![];
        };
        if bot.owner != who && !is_host {
            return vec![];
        }
        bot.battle_status = BattleStatus::from_int(battle_status);
        bot.team_color = team_color;
        vec![Outbound::All {
            line: line::update_bot(battle.id, &name, bot.battle_status, bot.team_color),
        }]
    }

    fn remove_bot(&mut self, peer: PeerId, name: String) -> Vec<Outbound> {
        let (Some(who), is_host) = (self.name_of(peer), self.is_host(peer)) else {
            return vec![];
        };
        let Some(battle) = self.battle.as_mut() else {
            return vec![];
        };
        let Some(bot) = battle.bots.get(&name) else {
            return vec![];
        };
        if bot.owner != who && !is_host {
            return vec![];
        }
        battle.bots.remove(&name);
        vec![Outbound::All {
            line: line::remove_bot(battle.id, &name),
        }]
    }

    fn say_battle(&mut self, peer: PeerId, message: &str, action: bool) -> Vec<Outbound> {
        let Some(name) = self.name_of(peer) else {
            return vec![];
        };
        if self.peers[&peer].member.is_none() {
            return vec![];
        }
        let line = if action {
            line::said_battle_ex(&name, message)
        } else {
            line::said_battle(&name, message)
        };
        vec![Outbound::All { line }]
    }

    /// A host power over somebody else's seat: their team, ally, colour, or being
    /// put back in the stands.
    fn force(
        &mut self,
        peer: PeerId,
        username: &str,
        change: impl FnOnce(&mut MemberStatus),
    ) -> Vec<Outbound> {
        if !self.is_host(peer) {
            return vec![];
        }
        let Some(target) = self.peer_named(username) else {
            return vec![];
        };
        let Some(member) = self.peers.get_mut(&target).and_then(|p| p.member.as_mut()) else {
            return vec![];
        };
        change(member);
        let (status, color) = (member.battle_status, member.team_color);
        vec![Outbound::All {
            line: line::client_battle_status(username, status, color),
        }]
    }

    /// Throw somebody out of the battle and keep them out for the rest of the
    /// room's life. A kick anyone can undo by reconnecting is not a kick.
    fn kick(&mut self, peer: PeerId, username: &str) -> Vec<Outbound> {
        if !self.is_host(peer) || username == self.config.host {
            return vec![];
        }
        self.kicked.insert(username.to_string());
        let Some(target) = self.peer_named(username) else {
            return vec![];
        };
        let mut out = self.leave_battle(target, username);
        out.push(Outbound::Close { peer: target });
        out
    }

    /// Run a change only the host may make.
    fn host_only(
        &mut self,
        peer: PeerId,
        change: impl FnOnce(&mut Self) -> Option<Vec<Outbound>>,
    ) -> Vec<Outbound> {
        if !self.is_host(peer) {
            return vec![];
        }
        change(self).unwrap_or_default()
    }

    fn is_host(&self, peer: PeerId) -> bool {
        self.name_of(peer).as_deref() == Some(self.config.host.as_str())
    }

    fn name_of(&self, peer: PeerId) -> Option<String> {
        self.peers.get(&peer).and_then(|p| p.name.clone())
    }

    fn peer_named(&self, name: &str) -> Option<PeerId> {
        self.peers
            .iter()
            .find(|(_, p)| p.name.as_deref() == Some(name))
            .map(|(id, _)| *id)
    }

    /// The battle's members, by the name the roster shows them under.
    fn members(&self) -> HashMap<String, MemberStatus> {
        self.peers
            .values()
            .filter_map(|p| Some((p.name.clone()?, p.member.clone()?)))
            .collect()
    }

    fn announcement(&self, b: &RoomBattle) -> BattleOpened {
        BattleOpened {
            id: b.id,
            battle_type: 0,
            nat_type: 0,
            host: b.founder.clone(),
            ip: self.config.ip.clone(),
            port: b.port,
            max_players: b.max_players,
            passworded: b.key.is_some(),
            rank: 0,
            maphash: b.maphash,
            engine: b.engine.clone(),
            version: b.version.clone(),
            map: b.map.clone(),
            title: b.title.clone(),
            modname: b.modname.clone(),
            channel: Some(b.channel.clone()),
        }
    }
}

/// The parts of a host's `OPENBATTLE` the room keeps. A struct because ten
/// positional arguments is a field-order accident waiting to happen.
struct OpenedBy {
    key: Option<String>,
    port: u16,
    max_players: u32,
    modhash: i32,
    maphash: i32,
    engine: String,
    version: String,
    map: String,
    title: String,
    modname: String,
}

#[cfg(test)]
mod tests {
    use super::super::client::parse_client_line;
    use super::*;
    use crate::command;
    use crate::status::default_battle_status;

    const ALICE: PeerId = 1;
    const BOB: PeerId = 2;

    fn room(approve_joins: bool) -> RoomState {
        RoomState::new(RoomConfig {
            host: "alice".into(),
            ip: "192.168.0.5".into(),
            approve_joins,
        })
    }

    /// Feed one client line in, as the plugin would after reading a socket.
    fn send(room: &mut RoomState, peer: PeerId, line: &str) -> Vec<Outbound> {
        room.apply(peer, parse_client_line(line))
    }

    /// The lines one peer is due out of a batch.
    fn due(out: &[Outbound], peer: PeerId) -> Vec<&str> {
        out.iter().filter_map(|o| o.line_for(peer)).collect()
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

    /// Get a peer through the handshake.
    fn log_in(room: &mut RoomState, peer: PeerId, name: &str) -> Vec<Outbound> {
        room.connect(peer);
        send(room, peer, "LISTCOMPFLAGS");
        send(
            room,
            peer,
            &command::login(
                name,
                "aGFzaA==",
                "127.0.0.1",
                "Coilbox 0.1",
                "1",
                &["u", "sp"],
            ),
        )
    }

    /// A room with alice hosting a battle and bob in it.
    fn started(approve_joins: bool) -> RoomState {
        let mut room = room(approve_joins);
        log_in(&mut room, ALICE, "alice");
        send(&mut room, ALICE, &open_battle_line());
        log_in(&mut room, BOB, "bob");
        room
    }

    #[test]
    fn the_greeting_and_compflags_are_the_two_lines_a_client_hangs_without() {
        let mut room = room(false);
        let greeting = room.connect(ALICE);
        assert_eq!(due(&greeting, ALICE), ["TASSERVER 0.38 * 8452 0"]);
        let flags = send(&mut room, ALICE, "LISTCOMPFLAGS");
        assert_eq!(due(&flags, ALICE), ["COMPFLAGS u sp"]);
    }

    #[test]
    fn a_login_ends_with_logininfoend() {
        let mut room = room(false);
        let out = log_in(&mut room, ALICE, "alice");
        let lines = due(&out, ALICE);
        assert_eq!(lines.first(), Some(&"ACCEPTED alice"));
        assert_eq!(lines.last(), Some(&"LOGININFOEND"));
        assert!(lines.contains(&"ADDUSER alice ?? 1 Coilbox 0.1"));
    }

    /// A battle command that arrives before the login has landed is answered,
    /// not swallowed. Swallowed, it leaves a host with a room holding their
    /// socket, no battle in it, and nothing said about either (issue #1587).
    #[test]
    fn a_battle_command_before_the_login_is_told_why_it_did_nothing() {
        let mut room = room(false);
        room.connect(ALICE);

        let out = send(&mut room, ALICE, &open_battle_line());
        assert_eq!(
            due(&out, ALICE),
            ["OPENBATTLEFAILED you are not logged in yet"]
        );
        assert!(room.battle_view().is_none());

        let out = send(&mut room, ALICE, "JOINBATTLE 1 * s3cret");
        assert_eq!(
            due(&out, ALICE),
            ["JOINBATTLEFAILED you are not logged in yet"]
        );
    }

    /// Everything else a client fires unprompted is it talking to itself, and a
    /// refusal would pop an error at somebody who did nothing wrong.
    #[test]
    fn other_commands_before_the_login_stay_silent() {
        let mut room = room(false);
        room.connect(ALICE);
        assert!(send(&mut room, ALICE, "MYSTATUS 0").is_empty());
        assert!(send(&mut room, ALICE, "SAYBATTLE hello").is_empty());
    }

    /// The second peer is told about the first, and the first about the second.
    #[test]
    fn the_roster_reaches_both_ways() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        let out = log_in(&mut room, BOB, "bob");
        assert!(due(&out, BOB).contains(&"ADDUSER alice ?? 1 Coilbox 0.1"));
        assert_eq!(due(&out, ALICE), ["ADDUSER bob ?? 2 Coilbox 0.1"]);
    }

    /// Two peers under one name would share one member entry, so the room cannot
    /// let both in. The refusal carries a free name, because a room has no
    /// accounts and "pick another" with no suggestion is a dead end.
    #[test]
    fn a_name_already_in_the_room_is_refused_with_one_that_is_free() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        let out = log_in(&mut room, BOB, "alice");
        assert_eq!(
            due(&out, BOB),
            ["DENIED that name is already in this room, try alice2"]
        );
        assert!(out.contains(&Outbound::Close { peer: BOB }));
    }

    /// The suggestion has to be free itself, or the reader walks into a second
    /// refusal. Trailing digits are the counter, not part of the name.
    #[test]
    fn the_suggested_name_counts_past_everyone_already_here() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        log_in(&mut room, BOB, "alice2");
        log_in(&mut room, 3, "alice3");

        // Somebody typing the original name, and somebody typing a suggestion
        // that has since been taken, both land past the lot of them.
        for typed in ["alice", "alice2", "alice3"] {
            let out = log_in(&mut room, 4, typed);
            assert_eq!(
                due(&out, 4),
                ["DENIED that name is already in this room, try alice4"]
            );
        }

        // A kicked name is not a suggestion: it would be refused in turn.
        send(&mut room, ALICE, &open_battle_line());
        send(&mut room, ALICE, "KICKFROMBATTLE alice4");
        let out = log_in(&mut room, 5, "alice");
        assert_eq!(
            due(&out, 5),
            ["DENIED that name is already in this room, try alice5"]
        );
    }

    /// A space in a name is impossible to send, since the parser splits the login
    /// line on it. A tab is not: it survives parsing and then breaks the tab
    /// block of the BATTLEOPENED this player might go on to host.
    #[test]
    fn a_name_with_whitespace_in_it_is_refused() {
        let mut room = room(false);
        room.connect(ALICE);
        let out = send(
            &mut room,
            ALICE,
            "LOGIN two\twords aGFzaA== 0 127.0.0.1 Coilbox 0.1",
        );
        assert_eq!(due(&out, ALICE), ["DENIED that name has whitespace in it"]);
    }

    #[test]
    fn only_the_host_opens_the_battle() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        log_in(&mut room, BOB, "bob");

        let refused = send(&mut room, BOB, &open_battle_line());
        assert_eq!(
            due(&refused, BOB),
            ["OPENBATTLEFAILED only the host can open a battle here"]
        );
        assert!(room.battle_view().is_none());

        let out = send(&mut room, ALICE, &open_battle_line());
        assert_eq!(
            due(&out, ALICE),
            [
                "BATTLEOPENED 1 0 0 alice 192.168.0.5 8452 16 0 0 -1 spring\t105.1.1\tRed Comet\tTom's LAN game\tBeyond All Reason test-1234\t__battle__1",
                "OPENBATTLE 1",
                "HOSTPORT 8452",
                "REQUESTBATTLESTATUS",
            ]
        );
        // Everybody in the room hears about it, not just the host.
        assert_eq!(due(&out, BOB).len(), 1);

        let second = send(&mut room, ALICE, &open_battle_line());
        assert_eq!(
            due(&second, ALICE),
            ["OPENBATTLEFAILED this room already has a battle"]
        );
    }

    /// The ordering constraint, checked on the lines a joiner actually receives:
    /// the acknowledgement is what gives them a current battle, and everything
    /// that carries no battle id is dropped in silence without it.
    #[test]
    fn nothing_current_battle_scoped_precedes_the_join_ack() {
        let mut room = started(false);
        send(&mut room, ALICE, "SETSCRIPTTAGS game/startpostype=2");
        send(&mut room, ALICE, "ADDSTARTRECT 0 0 0 50 200");
        send(
            &mut room,
            ALICE,
            &command::add_bot("Barb", BattleStatus::default(), 255, "BARb"),
        );

        let out = send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let lines = due(&out, BOB);
        assert_eq!(lines[0], "JOINBATTLE 1 -1 __battle__1");
        for scoped in ["SETSCRIPTTAGS", "ADDSTARTRECT", "REMOVESTARTRECT"] {
            let first = lines.iter().position(|l| l.starts_with(scoped));
            assert!(
                first.is_none_or(|i| i > 0),
                "{scoped} arrived before the join ack: {lines:?}"
            );
        }
        // The joiner is caught up on what the room already holds, and asked for
        // the seat they arrived with.
        assert!(lines.contains(&"SETSCRIPTTAGS game/startpostype=2"));
        assert!(lines.contains(&"ADDSTARTRECT 0 0 0 50 200"));
        assert!(lines.contains(&"ADDBOT 1 Barb alice 0 255 BARb"));
        assert!(lines.contains(&"JOINEDBATTLE 1 alice"));
        assert_eq!(lines.last(), Some(&"REQUESTBATTLESTATUS"));
    }

    /// The script password is what the host's start script authenticates a joiner
    /// with. Everybody else gets the two-field form.
    #[test]
    fn only_the_host_is_told_a_script_password() {
        let mut room = started(false);
        let out = send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        assert!(due(&out, ALICE).contains(&"JOINEDBATTLE 1 bob s3cret"));
        assert!(due(&out, BOB).contains(&"JOINEDBATTLE 1 bob"));
        assert!(!due(&out, BOB).contains(&"JOINEDBATTLE 1 bob s3cret"));
        assert_eq!(
            room.battle_view().unwrap().members["bob"]
                .script_password
                .as_deref(),
            Some("s3cret")
        );
    }

    /// There is no start message in the protocol. The host going ingame is it.
    #[test]
    fn the_match_starts_when_the_host_goes_ingame() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");

        let ingame = ClientStatus {
            ingame: true,
            ..Default::default()
        };
        let out = send(&mut room, ALICE, &command::my_status(ingame));
        assert_eq!(
            out,
            vec![Outbound::All {
                line: "CLIENTSTATUS alice 1".to_string()
            }]
        );
        assert_eq!(due(&out, BOB), ["CLIENTSTATUS alice 1"]);
    }

    /// Somebody who connects after the match has started still has to see that it
    /// has, or their battle room sits waiting for a launch that already happened.
    #[test]
    fn a_late_arrival_is_told_the_host_is_ingame() {
        let mut room = started(false);
        let ingame = ClientStatus {
            ingame: true,
            ..Default::default()
        };
        send(&mut room, ALICE, &command::my_status(ingame));

        let out = log_in(&mut room, 3, "carol");
        assert!(due(&out, 3).contains(&"CLIENTSTATUS alice 1"));
    }

    /// The plugin has to answer a queued join as the host, and this is the only
    /// thing that tells it which socket that is.
    #[test]
    fn the_host_peer_is_named_once_the_host_has_logged_in() {
        let mut room = room(false);
        assert_eq!(room.host_peer(), None);
        log_in(&mut room, BOB, "bob");
        assert_eq!(room.host_peer(), None, "bob is not the host");
        log_in(&mut room, ALICE, "alice");
        assert_eq!(room.host_peer(), Some(ALICE));
        room.disconnect(ALICE);
        assert_eq!(room.host_peer(), None);
    }

    #[test]
    fn an_approved_join_waits_for_the_host() {
        let mut room = started(true);
        let queued = send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        assert!(queued.is_empty(), "nothing goes out until the host answers");
        assert_eq!(
            room.pending_joins(),
            [PendingJoin {
                peer: BOB,
                name: "bob".into(),
                script_password: Some("s3cret".into()),
            }]
        );

        let out = send(&mut room, ALICE, &command::join_battle_accept("bob"));
        assert_eq!(due(&out, BOB)[0], "JOINBATTLE 1 -1 __battle__1");
        assert!(room.pending_joins().is_empty());
    }

    #[test]
    fn a_refused_join_is_told_why() {
        let mut room = started(true);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let out = send(
            &mut room,
            ALICE,
            "JOINBATTLEDENY bob this is a private game",
        );
        assert_eq!(due(&out, BOB), ["JOINBATTLEFAILED this is a private game"]);
        assert!(room.pending_joins().is_empty());

        // A join nobody but the host can answer.
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        assert!(send(&mut room, BOB, "JOINBATTLEACCEPT bob").is_empty());
        assert_eq!(room.pending_joins().len(), 1);
    }

    /// The two ways a password goes wrong ask the joiner for different things:
    /// one to find a password at all, the other to check the one they typed.
    #[test]
    fn a_room_password_is_refused_in_the_words_that_fit_what_happened() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        let opened = command::open_battle(
            0,
            0,
            "letmein",
            8452,
            16,
            -1,
            0,
            -1,
            "spring",
            "105.1.1",
            "Red Comet",
            "Private",
            "BAR",
        );
        send(&mut room, ALICE, &opened);
        log_in(&mut room, BOB, "bob");

        let out = send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        assert_eq!(
            due(&out, BOB),
            ["JOINBATTLEFAILED this room needs a password"]
        );
        let out = send(&mut room, BOB, "JOINBATTLE 1 wrong s3cret");
        assert_eq!(due(&out, BOB), ["JOINBATTLEFAILED wrong room password"]);
        let out = send(&mut room, BOB, "JOINBATTLE 1 letmein s3cret");
        assert_eq!(due(&out, BOB)[0], "JOINBATTLE 1 -1 __battle__1");
        // And the joiner is told there is one to ask for before they try.
        assert!(room.battle_view().unwrap().passworded);
    }

    /// A room with no password takes anybody, including somebody who brought one.
    #[test]
    fn a_room_with_no_password_lets_anyone_in() {
        let mut room = started(false);
        let out = send(&mut room, BOB, "JOINBATTLE 1 unnecessary s3cret");
        assert_eq!(due(&out, BOB)[0], "JOINBATTLE 1 -1 __battle__1");
        assert!(!room.battle_view().unwrap().passworded);
    }

    /// A dropped player comes back to the seat they had, and is not asked to
    /// pick one: the client answers that question out of a state it rebuilt from
    /// nothing, so the answer would be the spectator default and would throw the
    /// seat away again.
    #[test]
    fn a_dropped_player_gets_their_seat_back_without_being_asked_for_it() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let seat = BattleStatus {
            mode: true,
            ally: 2,
            team_id: 3,
            ..default_battle_status()
        };
        send(&mut room, BOB, &command::my_battle_status(seat, 16_711_680));
        room.disconnect(BOB);

        log_in(&mut room, 3, "bob");
        let out = send(&mut room, 3, "JOINBATTLE 1 * fresh-sp");
        let lines = due(&out, 3);
        assert_eq!(
            lines.last(),
            Some(&format!("CLIENTBATTLESTATUS bob {} 16711680", seat.to_int()).as_str())
        );
        assert!(
            !lines.contains(&"REQUESTBATTLESTATUS"),
            "asking would get the default back and undo the reclaim: {lines:?}"
        );
        // The rest of the room hears it too, so nobody is left drawing bob in the
        // seat he had before he picked this one.
        assert!(due(&out, ALICE)
            .contains(&format!("CLIENTBATTLESTATUS bob {} 16711680", seat.to_int()).as_str()));

        let members = room.battle_view().unwrap().members;
        assert_eq!(members["bob"].battle_status, seat);
        assert_eq!(members["bob"].team_color, 16_711_680);
        // The script password is the new one: the host's start script has to
        // authenticate the socket that is here now, not the one that died.
        assert_eq!(members["bob"].script_password.as_deref(), Some("fresh-sp"));
    }

    /// Leaving the battle is a decision. Coming back after one starts fresh, the
    /// same as it would on a real server.
    #[test]
    fn leaving_the_battle_gives_the_seat_up() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let seat = BattleStatus {
            ally: 2,
            team_id: 3,
            ..default_battle_status()
        };
        send(&mut room, BOB, &command::my_battle_status(seat, 16_711_680));
        send(&mut room, BOB, "LEAVEBATTLE");

        let out = send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        assert_eq!(due(&out, BOB).last(), Some(&"REQUESTBATTLESTATUS"));
        let members = room.battle_view().unwrap().members;
        assert_eq!(members["bob"].battle_status, BattleStatus::default());
        assert_eq!(members["bob"].team_color, 0);
    }

    /// Seats belong to a battle. The next one the host opens has its own map and
    /// its own teams, so an old seat in it would be a team nobody picked.
    #[test]
    fn a_seat_does_not_outlive_the_battle_it_was_in() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let seat = BattleStatus {
            ally: 2,
            team_id: 3,
            ..default_battle_status()
        };
        send(&mut room, BOB, &command::my_battle_status(seat, 16_711_680));

        // The host leaves, which closes the battle, then opens another.
        send(&mut room, ALICE, "LEAVEBATTLE");
        send(&mut room, ALICE, &open_battle_line());

        let out = send(&mut room, BOB, "JOINBATTLE 2 * s3cret");
        assert_eq!(due(&out, BOB).last(), Some(&"REQUESTBATTLESTATUS"));
        assert_eq!(
            room.battle_view().unwrap().members["bob"].battle_status,
            BattleStatus::default()
        );
    }

    /// A kick that a reconnect undoes is not a kick, so the name stays out for the
    /// life of the room.
    #[test]
    fn a_kick_holds_across_a_reconnect() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");

        let out = send(&mut room, ALICE, "KICKFROMBATTLE bob");
        assert!(due(&out, ALICE).contains(&"LEFTBATTLE 1 bob"));
        assert!(out.contains(&Outbound::Close { peer: BOB }));
        room.disconnect(BOB);

        let out = log_in(&mut room, 3, "bob");
        assert_eq!(due(&out, 3), ["DENIED you were kicked from this room"]);
    }

    /// The host is the battle. When they go, it goes, and the joiners' clients
    /// clear their current battle off BATTLECLOSED alone.
    #[test]
    fn the_battle_closes_with_its_founder() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");

        let out = room.disconnect(ALICE);
        assert_eq!(due(&out, BOB), ["BATTLECLOSED 1", "REMOVEUSER alice"]);
        assert!(room.battle_view().is_none());
    }

    /// A member leaving takes their bots with them, which nothing else would
    /// clean up: a bot with no owner still gets a team in the start script.
    #[test]
    fn leaving_the_battle_takes_your_bots() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        send(
            &mut room,
            BOB,
            &command::add_bot("Barb", BattleStatus::default(), 255, "BARb"),
        );
        assert!(room.battle_view().unwrap().bots.contains_key("Barb"));

        let out = send(&mut room, BOB, "LEAVEBATTLE");
        assert_eq!(due(&out, ALICE), ["REMOVEBOT 1 Barb", "LEFTBATTLE 1 bob"]);
        assert!(room.battle_view().unwrap().bots.is_empty());
    }

    #[test]
    fn host_powers_are_the_hosts_alone() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");

        for line in [
            "SETSCRIPTTAGS game/startpostype=2",
            "ADDSTARTRECT 0 0 0 50 200",
            "REMOVESTARTRECT 0",
            "UPDATEBATTLEINFO 0 0 -1 Supreme Isthmus",
            "FORCEALLYNO alice 3",
            "KICKFROMBATTLE alice",
        ] {
            assert!(
                send(&mut room, BOB, line).is_empty(),
                "a joiner got away with: {line}"
            );
        }
        let view = room.battle_view().unwrap();
        assert!(view.script_tags.is_empty());
        assert!(view.start_rects.is_empty());
        assert_eq!(view.map, "Red Comet");

        // The host's own force lands, and reaches the whole room.
        let out = send(&mut room, ALICE, "FORCEALLYNO bob 3");
        let expected = BattleStatus {
            ally: 3,
            ..BattleStatus::default()
        };
        assert_eq!(
            due(&out, BOB),
            [format!("CLIENTBATTLESTATUS bob {} 0", expected.to_int())]
        );
    }

    /// A room with no battle, or a peer with no seat in it, has nothing to say
    /// back. None of it may take the connection down.
    #[test]
    fn commands_out_of_turn_are_ignored_rather_than_answered() {
        let mut room = room(false);
        // Before a login, only the handshake works. The two battle commands are
        // the exception and are refused out loud: see
        // `a_battle_command_before_the_login_is_told_why_it_did_nothing`.
        room.connect(ALICE);
        assert!(send(&mut room, ALICE, "SAYBATTLE hello").is_empty());
        // From a socket the room has never seen, nothing works at all.
        assert!(send(&mut room, 99, "LISTCOMPFLAGS").is_empty());

        log_in(&mut room, ALICE, "alice");
        for line in [
            "SAYBATTLE hello",
            "MYBATTLESTATUS 0 255",
            "LEAVEBATTLE",
            &command::add_bot("Barb", BattleStatus::default(), 255, "BARb"),
            "FRIENDLIST",
            "FROBNICATE the gizmo",
        ] {
            assert!(
                send(&mut room, ALICE, line).is_empty(),
                "should have been ignored: {line}"
            );
        }
    }

    #[test]
    fn a_ping_is_answered_and_an_exit_is_final() {
        let mut room = room(false);
        log_in(&mut room, ALICE, "alice");
        assert_eq!(due(&send(&mut room, ALICE, "PING 42"), ALICE), ["PONG 42"]);

        log_in(&mut room, BOB, "bob");
        let out = send(&mut room, BOB, "EXIT quitting");
        assert_eq!(due(&out, ALICE), ["REMOVEUSER bob"]);
        assert!(out.contains(&Outbound::Close { peer: BOB }));
        assert!(send(&mut room, BOB, "SAYBATTLE anyone there").is_empty());
    }

    /// Battle chat is echoed to its sender as well, which is how the client's own
    /// message reaches its own chat log.
    #[test]
    fn battle_chat_is_echoed_to_everyone_in_the_battle() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let out = send(&mut room, BOB, "SAYBATTLE hello   there");
        assert_eq!(due(&out, BOB), ["SAIDBATTLE bob hello   there"]);
        assert_eq!(due(&out, ALICE), ["SAIDBATTLE bob hello   there"]);
    }

    #[test]
    fn a_battle_status_push_is_kept_and_broadcast() {
        let mut room = started(false);
        send(&mut room, BOB, "JOINBATTLE 1 * s3cret");
        let seat = BattleStatus {
            mode: true,
            ally: 1,
            team_id: 1,
            ..default_battle_status()
        };
        let out = send(&mut room, BOB, &command::my_battle_status(seat, 16_711_680));
        assert_eq!(
            due(&out, ALICE),
            [format!("CLIENTBATTLESTATUS bob {} 16711680", seat.to_int())]
        );
        let members = room.battle_view().unwrap().members;
        assert_eq!(members["bob"].battle_status, seat);
        assert_eq!(members["bob"].team_color, 16_711_680);
    }
}
