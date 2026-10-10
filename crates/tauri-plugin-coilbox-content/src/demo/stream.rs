//! The walk over a replay's demo stream, which is every network packet the
//! game sent, recorded between the start script and the trailer.
//!
//! The engine frames each packet as `f32 modGameTime, u32 length, payload`
//! (`DemoStreamChunkHeader` in `rts/System/LoadSave/demofile.h`), and the
//! payload's first byte is the `NETMSG_*` id. So a message this walk does not
//! read is stepped over by its declared length, and the walk never has to
//! understand the whole protocol.
//!
//! The payload layouts are the ones `rts/Net/Protocol/BaseNetProtocol.cpp` and
//! `CSelectedUnitsHandler::SendCommandsToUnits` write, each checked against the
//! replays in `~/.spring/demos` from engines 2025.06.19 and 2026.07.01. They
//! are not the ones the comments in `NetMessageTypes.h` describe: a command
//! carries a timeout and a parameter count those comments leave out, and most
//! variable length messages carry their own size after the id.
//!
//! Two messages are in no real replay measured, so their layouts are from the
//! source alone: `NETMSG_AICOMMAND_TRACKED`, and a `NETMSG_AICOMMAND` sent by a
//! skirmish AI. Every `NETMSG_AICOMMAND` measured came from a Lua widget.
//!
//! A stream that breaks is not an error. The walk stops, reports where, and
//! keeps what it had, and the trailer is unaffected because
//! [`super::decode_trailer`] finds it from the header's sizes and never from
//! where a walk got to.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

use super::{
    open_maybe_gzip, read_all_maybe_gzip, DemoHeader, DEMO_VERSION, HEADER_V5_SIZE, MAGIC,
    MIN_HEADER,
};
use crate::model::{
    ChatDest, CommandOrigin, DemoStream, LeaveReason, Order, StreamEvent, StreamEventKind,
    StreamStop, TeamAction, TeamStartPosition, PREGAME_FRAME,
};

/// `DemoStreamChunkHeader`: `f32 modGameTime`, `u32 length`.
const CHUNK_HEADER_SIZE: usize = 8;

// The `NETMSG_*` ids this walk reads, from `rts/Net/Protocol/NetMessageTypes.h`.
const NETMSG_KEYFRAME: u8 = 1;
const NETMSG_NEWFRAME: u8 = 2;
const NETMSG_PLAYERNAME: u8 = 6;
const NETMSG_CHAT: u8 = 7;
const NETMSG_COMMAND: u8 = 11;
const NETMSG_SELECT: u8 = 12;
const NETMSG_PAUSE: u8 = 13;
const NETMSG_AICOMMAND: u8 = 14;
const NETMSG_AICOMMANDS: u8 = 15;
const NETMSG_GAMEOVER: u8 = 30;
const NETMSG_SYSTEMMSG: u8 = 35;
const NETMSG_STARTPOS: u8 = 36;
const NETMSG_PLAYERLEFT: u8 = 39;
const NETMSG_TEAM: u8 = 51;
const NETMSG_CREATE_NEWPLAYER: u8 = 75;
const NETMSG_AICOMMAND_TRACKED: u8 = 76;

/// `PLAYER_RDYSTATE_FAILED` in `rts/Game/Players/Player.h`.
const RDYSTATE_FAILED: u8 = 3;

// The `TEAMMSG_*` sub actions of `NETMSG_TEAM`.
const TEAMMSG_GIVEAWAY: u8 = 1;
const TEAMMSG_RESIGN: u8 = 2;
const TEAMMSG_JOIN_TEAM: u8 = 3;
const TEAMMSG_TEAM_DIED: u8 = 4;

/// `MAX_AIS` in `rts/Sim/Misc/GlobalConstants.h`. In the AI id field of a
/// command it means no AI at all: the order came from a Lua widget.
const NO_AI: u8 = 255;

// `ChatMessage::TO_*` in `rts/Game/ChatMessage.h`. Any other destination is a
// player number.
const CHAT_TO_ALLIES: u8 = 252;
const CHAT_TO_SPECTATORS: u8 = 253;
const CHAT_TO_EVERYONE: u8 = 254;

/// Walk a replay's demo stream and return what each player did.
///
/// The whole file is read, the same as [`super::read_trailer`]. An error means
/// the file is not a replay this decoder knows the shape of. A stream that is
/// damaged or cut short is not an error, see [`DemoStream::stopped`].
pub fn read_stream(demo: &Path) -> Result<DemoStream, String> {
    let (bytes, _) = read_all_maybe_gzip(demo)?;
    decode_stream(&bytes)
}

/// Where each team started, by `[teamN]` index, for the teams `is_team` accepts.
///
/// The walk stops at the first frame, because the engine sends every start
/// position before the game starts. A position sent after that arrives when
/// units have already spawned, so it is not where the team started.
///
/// The last pregame message per team counts. `CGame` applies each one in order
/// with `CTeam::SetStartPos`, and `CGameServer::StartGame` ends the pregame by
/// broadcasting one per team from the server's own record of it. That final
/// message is the position the game started with, for a team a player placed,
/// for an AI team and for a map with fixed positions alike.
///
/// A team the stream never mentions is absent. So is a team whose last message
/// says its player never readied and carries no position at all, which is the
/// server's zero vector for a position nobody sent.
pub fn read_start_positions(
    demo: &Path,
    is_team: impl Fn(i32) -> bool,
) -> Result<Vec<TeamStartPosition>, String> {
    let mut rdr = open_maybe_gzip(demo)?;
    let mut bytes = Vec::new();
    let mut want = FIRST_READ;
    loop {
        // Only as much of the file as the pregame takes, because a gzipped
        // replay is decompressed as it is read and the rest is most of it.
        let wanted = (want - bytes.len()) as u64;
        (&mut rdr)
            .take(wanted)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("read demo: {e}"))?;
        let all_read = bytes.len() < want;
        match decode_stream_until(&bytes, Until::GameStarts) {
            Ok(stream) if all_read || stream.last_frame != PREGAME_FRAME => {
                return Ok(start_positions(&stream, is_team));
            }
            Err(e) if all_read => return Err(e),
            // The prefix ends before the pregame does, or before the stream
            // starts. Read twice as much and walk again.
            _ => want = want.saturating_mul(2),
        }
    }
}

/// How much of a replay the first read takes, in bytes. A read size and not a
/// limit: a pregame longer than this is read in further doubling steps.
const FIRST_READ: usize = 256 * 1024;

/// The reduction behind [`read_start_positions`], over a walked stream.
fn start_positions(stream: &DemoStream, is_team: impl Fn(i32) -> bool) -> Vec<TeamStartPosition> {
    let mut by_team: BTreeMap<i32, TeamStartPosition> = BTreeMap::new();
    for e in &stream.events {
        let StreamEventKind::StartPos {
            team,
            ready,
            x,
            y,
            z,
            ..
        } = e.kind
        else {
            continue;
        };
        let team = i32::from(team);
        if e.frame != PREGAME_FRAME || !is_team(team) {
            continue;
        }
        if ready == RDYSTATE_FAILED && x == 0.0 && y == 0.0 && z == 0.0 {
            continue;
        }
        by_team.insert(team, TeamStartPosition { team, x, y, z });
    }
    by_team.into_values().collect()
}

/// How far a walk goes.
#[derive(Clone, Copy, PartialEq)]
enum Until {
    /// To the end of the stream.
    TheEnd,
    /// To the first frame, so the pregame events only.
    GameStarts,
}

/// Find the stream in a whole replay's bytes and walk it.
pub(super) fn decode_stream(bytes: &[u8]) -> Result<DemoStream, String> {
    decode_stream_until(bytes, Until::TheEnd)
}

fn decode_stream_until(bytes: &[u8], until: Until) -> Result<DemoStream, String> {
    if bytes.len() < MIN_HEADER || &bytes[..MAGIC.len()] != MAGIC {
        return Err("not a Spring demo file (bad magic)".into());
    }
    let h = DemoHeader::parse(bytes)?;
    // The same refusal the trailer makes, for the same reason: a different
    // version or header size moves the offsets, and a stream read from the
    // wrong offset still yields packets.
    if h.version != DEMO_VERSION {
        return Err(unknown_format("version", h.version, DEMO_VERSION));
    }
    if h.header_size != HEADER_V5_SIZE {
        return Err(unknown_format("headerSize", h.header_size, HEADER_V5_SIZE));
    }
    let end = h.trailer_start()?;
    let start = end - h.demo_stream_size;
    let have = bytes.get(start..end.min(bytes.len())).ok_or_else(|| {
        format!(
            "demo file is truncated: the demo stream starts at offset {start}, the file ends at {}",
            bytes.len()
        )
    })?;

    let mut stream = walk(have, until);
    if stream.stopped.is_none() && end > bytes.len() {
        stream.stopped = Some(StreamStop {
            offset: have.len(),
            reason: format!(
                "the file ends {} bytes before the demo stream does",
                end - bytes.len()
            ),
        });
    }
    Ok(stream)
}

fn unknown_format(
    field: &str,
    got: impl std::fmt::Display,
    want: impl std::fmt::Display,
) -> String {
    format!(
        "this replay's demo stream is in a format coilbox does not read: the header's {field} is {got}, not {want}. The map and the players still decode."
    )
}

/// Walk the packets in `stream`, which is the demo stream alone.
///
/// The frame clock is the engine's. `NETMSG_KEYFRAME` states a frame number and
/// `NETMSG_NEWFRAME` advances it by one, and on every real replay measured each
/// keyframe was exactly one past the frame before it.
///
/// With [`Until::GameStarts`] the walk ends at the first packet after the frame
/// clock leaves [`PREGAME_FRAME`], and says nothing about why in `stopped`.
fn walk(stream: &[u8], until: Until) -> DemoStream {
    let mut out = DemoStream {
        events: Vec::new(),
        last_frame: PREGAME_FRAME,
        packets: 0,
        undecoded: 0,
        stopped: None,
    };
    let mut at = 0;
    while at < stream.len() {
        if until == Until::GameStarts && out.last_frame != PREGAME_FRAME {
            break;
        }
        let Some(head) = stream.get(at..at + CHUNK_HEADER_SIZE) else {
            out.stopped = Some(StreamStop {
                offset: at,
                reason: format!(
                    "the stream ends {} bytes into a packet header",
                    stream.len() - at
                ),
            });
            break;
        };
        let time = f32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        let body = at + CHUNK_HEADER_SIZE;
        let Some(payload) = body.checked_add(len).and_then(|end| stream.get(body..end)) else {
            out.stopped = Some(StreamStop {
                offset: at,
                reason: format!(
                    "a packet claims {len} bytes and the stream has {} left",
                    stream.len() - body
                ),
            });
            break;
        };
        at = body + len;
        out.packets += 1;

        let decoded = match payload.first() {
            None => false,
            Some(&NETMSG_KEYFRAME) => match keyframe(payload) {
                Some(frame) => {
                    out.last_frame = frame;
                    true
                }
                None => false,
            },
            Some(&NETMSG_NEWFRAME) => {
                out.last_frame = out.last_frame.saturating_add(1);
                payload.len() == 1
            }
            Some(&id) => match decoder(id) {
                Some(decode) => match decode(payload) {
                    Some(kind) => {
                        out.events.push(StreamEvent {
                            frame: out.last_frame,
                            time,
                            kind,
                        });
                        true
                    }
                    None => false,
                },
                // A message this walk does not read. Skipped, not undecoded.
                None => true,
            },
        };
        if !decoded {
            out.undecoded += 1;
        }
    }
    out
}

/// Reads one packet, id byte included, into an event.
type Decode = fn(&[u8]) -> Option<StreamEventKind>;

/// The decoder for a message id, or `None` for a message the walk skips.
///
/// Each one refuses bytes that do not fit its layout exactly, a size field that
/// disagrees with the packet's length included. A refusal costs that one
/// packet, because the framing has already said where the next one starts.
fn decoder(id: u8) -> Option<Decode> {
    Some(match id {
        NETMSG_PLAYERNAME => player_name,
        NETMSG_CHAT => chat,
        NETMSG_COMMAND => command,
        NETMSG_SELECT => select,
        NETMSG_AICOMMAND | NETMSG_AICOMMAND_TRACKED => unit_command,
        NETMSG_AICOMMANDS => unit_commands,
        NETMSG_GAMEOVER => game_over,
        NETMSG_SYSTEMMSG => system_message,
        NETMSG_STARTPOS => start_pos,
        NETMSG_PAUSE => pause,
        NETMSG_PLAYERLEFT => player_left,
        NETMSG_TEAM => team,
        NETMSG_CREATE_NEWPLAYER => new_player,
        _ => return None,
    })
}

/// A cursor over one packet's bytes. Every read is `None` past the end.
struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    /// A fixed size packet, past its id.
    fn fixed(payload: &'a [u8], len: usize) -> Option<Self> {
        (payload.len() == len).then(|| Reader {
            bytes: &payload[1..],
        })
    }

    /// A packet whose second byte is its own length, past both.
    fn sized8(payload: &'a [u8]) -> Option<Self> {
        let size = *payload.get(1)? as usize;
        (size == payload.len()).then(|| Reader {
            bytes: &payload[2..],
        })
    }

    /// A packet whose second and third bytes are its own length, past all three.
    fn sized16(payload: &'a [u8]) -> Option<Self> {
        let size = u16::from_le_bytes([*payload.get(1)?, *payload.get(2)?]) as usize;
        (size == payload.len()).then(|| Reader {
            bytes: &payload[3..],
        })
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let (head, rest) = self.bytes.split_at_checked(n)?;
        self.bytes = rest;
        Some(head)
    }

    fn rest(&mut self) -> &'a [u8] {
        std::mem::take(&mut self.bytes)
    }

    fn done(&self) -> bool {
        self.bytes.is_empty()
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|b| b[0])
    }

    fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Option<u32> {
        self.take(4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn i32(&mut self) -> Option<i32> {
        self.u32().map(|v| v as i32)
    }

    fn f32(&mut self) -> Option<f32> {
        self.u32().map(f32::from_bits)
    }

    fn f32s(&mut self, n: usize) -> Option<Vec<f32>> {
        let raw = self.take(n.checked_mul(4)?)?;
        Some(
            raw.as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect(),
        )
    }

    fn u16s(&mut self, n: usize) -> Option<Vec<u16>> {
        let raw = self.take(n.checked_mul(2)?)?;
        Some(
            raw.as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes(*b))
                .collect(),
        )
    }

    /// The rest of the packet as the NUL terminated string the engine's
    /// `PackPacket` writes. The NUL has to be the last byte.
    fn cstr(&mut self) -> Option<String> {
        let (nul, text) = self.rest().split_last()?;
        (*nul == 0 && !text.contains(&0)).then(|| String::from_utf8_lossy(text).into_owned())
    }
}

/// `SendKeyFrame`: `i32 frameNum`.
fn keyframe(payload: &[u8]) -> Option<i32> {
    Reader::fixed(payload, 5)?.i32()
}

/// `SendPlayerName`: `u8 size, u8 player, string name`.
fn player_name(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized8(payload)?;
    Some(StreamEventKind::PlayerName {
        player: r.u8()?,
        name: r.cstr()?,
    })
}

/// `ChatMessage::Pack`: `u8 size, u8 from, u8 dest, string message`.
fn chat(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized8(payload)?;
    let from = r.u8()?;
    let dest = match r.u8()? {
        CHAT_TO_ALLIES => ChatDest::Allies,
        CHAT_TO_SPECTATORS => ChatDest::Spectators,
        CHAT_TO_EVERYONE => ChatDest::Everyone,
        player => ChatDest::Player { player },
    };
    Some(StreamEventKind::Chat {
        from,
        dest,
        text: r.cstr()?,
    })
}

/// `SendSystemMessage`: `u16 size, u8 player, string message`.
fn system_message(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized16(payload)?;
    Some(StreamEventKind::SystemMessage {
        player: r.u8()?,
        text: r.cstr()?,
    })
}

/// The part every single order shares: `i32 id, i32 timeout, u8 options,
/// u32 numParams`, then for a tracked AI command an `i32` the AI uses to match
/// the order to its own records, then the parameters.
///
/// The timeout is dropped. It is the frame an order expires at, and every order
/// in the replays measured carries `i32::MAX`, which is the engine's "never".
fn order(r: &mut Reader, tracked: bool) -> Option<Order> {
    let id = r.i32()?;
    let _timeout = r.i32()?;
    let options = r.u8()?;
    let num_params = r.u32()? as usize;
    if tracked {
        r.i32()?;
    }
    let params = r.f32s(num_params)?;
    Some(Order {
        id,
        options,
        params,
    })
}

/// `SendCommand`: `u16 size, u8 player`, then one order, for whatever that
/// player has selected.
fn command(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized16(payload)?;
    let player = r.u8()?;
    let order = order(&mut r, false)?;
    r.done().then_some(StreamEventKind::Command {
        player,
        origin: CommandOrigin::Selection,
        units: Vec::new(),
        pairwise: false,
        orders: vec![order],
    })
}

/// `SendAICommand`: `u16 size, u8 player, u8 ai, u8 team, i16 unit`, then one
/// order, for that one unit. It is sent by a skirmish AI and by a Lua widget's
/// `GiveOrderToUnit` alike, and the AI id says which.
fn unit_command(payload: &[u8]) -> Option<StreamEventKind> {
    let tracked = payload.first() == Some(&NETMSG_AICOMMAND_TRACKED);
    let mut r = Reader::sized16(payload)?;
    let player = r.u8()?;
    let ai = r.u8()?;
    let team = r.u8()?;
    let unit = r.u16()?;
    let order = order(&mut r, tracked)?;
    r.done().then_some(StreamEventKind::Command {
        player,
        origin: if ai == NO_AI {
            CommandOrigin::Lua
        } else {
            CommandOrigin::Ai { ai, team }
        },
        units: vec![unit],
        pairwise: false,
        orders: vec![order],
    })
}

/// `CSelectedUnitsHandler::SendCommandsToUnits`, which only Lua widgets reach:
///
/// ```text
/// u16 size, u8 player, u8 ai, u8 pairwise
/// u32 sameId, u8 sameOptions, u16 sameParamCount
/// u16 unitCount, then that many i16 unit ids
/// u16 commandCount, then per command:
///     u32 id          only when sameId is 0
///     u8 options      only when sameOptions is 0xFF
///     u16 paramCount  only when sameParamCount is 0xFFFF
///     the f32 parameters
/// ```
///
/// When every command in the packet shares an id, options or parameter count,
/// the engine writes that value once in the header and leaves it out of each
/// command.
fn unit_commands(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized16(payload)?;
    let player = r.u8()?;
    // The engine drops this packet from anything but a Lua widget.
    if r.u8()? != NO_AI {
        return None;
    }
    let pairwise = r.u8()? != 0;
    let same_id = r.u32()?;
    let same_options = r.u8()?;
    let same_param_count = r.u16()?;

    let unit_count = r.u16()? as usize;
    let units = r.u16s(unit_count)?;

    let command_count = r.u16()?;
    let mut orders = Vec::new();
    for _ in 0..command_count {
        let id = match same_id {
            0 => r.u32()?,
            id => id,
        } as i32;
        let options = match same_options {
            0xFF => r.u8()?,
            options => options,
        };
        let param_count = match same_param_count {
            0xFFFF => r.u16()?,
            n => n,
        } as usize;
        orders.push(Order {
            id,
            options,
            params: r.f32s(param_count)?,
        });
    }
    r.done().then_some(StreamEventKind::Command {
        player,
        origin: CommandOrigin::Lua,
        units,
        pairwise,
        orders,
    })
}

/// `SendSelect`: `u16 size, u8 player`, then `i16` unit ids to the end.
fn select(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized16(payload)?;
    let player = r.u8()?;
    let ids = r.rest();
    if ids.len() % 2 != 0 {
        return None;
    }
    Some(StreamEventKind::Select {
        player,
        units: Reader { bytes: ids }.u16s(ids.len() / 2)?,
    })
}

/// `SendGameOver`: `u8 size, u8 player`, then one byte per winning ally team.
fn game_over(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized8(payload)?;
    Some(StreamEventKind::GameOver {
        player: r.u8()?,
        winning_ally_teams: r.rest().to_vec(),
    })
}

/// `SendStartPos`: `u8 player, u8 team, u8 ready, f32 x, f32 y, f32 z`, with no
/// size field.
fn start_pos(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::fixed(payload, 16)?;
    Some(StreamEventKind::StartPos {
        player: r.u8()?,
        team: r.u8()?,
        ready: r.u8()?,
        x: r.f32()?,
        y: r.f32()?,
        z: r.f32()?,
    })
}

/// `SendPause`: `u8 player, u8 paused`, with no size field. Unconfirmed against a real replay, as none here holds a pause.
fn pause(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::fixed(payload, 3)?;
    Some(StreamEventKind::Pause {
        player: r.u8()?,
        paused: r.u8()? != 0,
    })
}

/// `SendPlayerLeft`: `u8 player, u8 bIntended`, with no size field.
fn player_left(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::fixed(payload, 3)?;
    Some(StreamEventKind::PlayerLeft {
        player: r.u8()?,
        reason: match r.u8()? {
            0 => LeaveReason::LostConnection,
            1 => LeaveReason::Left,
            2 => LeaveReason::Kicked,
            code => LeaveReason::Other { code },
        },
    })
}

/// The `SendGiveAwayEverything`, `SendResign`, `SendJoinTeam` and
/// `SendTeamDied` family: `u8 player, u8 action, u8 param1, u8 param2`, with no
/// size field. The two parameters are always on the wire and an action that
/// needs fewer sends zero for the rest.
fn team(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::fixed(payload, 5)?;
    let player = r.u8()?;
    let (action, param1, param2) = (r.u8()?, r.u8()?, r.u8()?);
    Some(StreamEventKind::Team {
        player,
        action: match action {
            TEAMMSG_GIVEAWAY => TeamAction::GiveAway {
                to_team: param1,
                from_team: param2,
            },
            TEAMMSG_RESIGN => TeamAction::Resign,
            TEAMMSG_JOIN_TEAM => TeamAction::JoinTeam { team: param1 },
            TEAMMSG_TEAM_DIED => TeamAction::TeamDied { team: param1 },
            action => TeamAction::Other {
                action,
                param1,
                param2,
            },
        },
    })
}

/// `SendCreateNewPlayer`: `u16 size, u8 player, u8 spectator, u8 team, string
/// name`.
fn new_player(payload: &[u8]) -> Option<StreamEventKind> {
    let mut r = Reader::sized16(payload)?;
    Some(StreamEventKind::NewPlayer {
        player: r.u8()?,
        spectator: r.u8()? != 0,
        team: r.u8()?,
        name: r.cstr()?,
    })
}

/// A synthetic demo stream, built byte by byte for the same reason
/// `DemoFixture` is: a layout read at the wrong offset returns values, not an
/// error, so only a stream whose every byte a test chose proves an offset.
#[cfg(test)]
pub(crate) mod fixture {
    use super::*;

    /// Packets in recording order. Each one's `modGameTime` is half a second
    /// after the one before, starting at zero, so a test can assert it.
    #[derive(Default)]
    pub(crate) struct Packets {
        bytes: Vec<u8>,
        count: u32,
    }

    impl Packets {
        pub(crate) fn bytes(&self) -> Vec<u8> {
            self.bytes.clone()
        }

        /// One chunk: `f32 modGameTime, u32 length`, then the payload as given.
        pub(crate) fn raw(mut self, payload: &[u8]) -> Self {
            let time = self.count as f32 * 0.5;
            self.bytes.extend_from_slice(&time.to_le_bytes());
            self.bytes
                .extend_from_slice(&(payload.len() as u32).to_le_bytes());
            self.bytes.extend_from_slice(payload);
            self.count += 1;
            self
        }

        /// `id, u8 size, body`.
        fn sized8(self, id: u8, body: &[u8]) -> Self {
            let mut p = vec![id, (body.len() + 2) as u8];
            p.extend_from_slice(body);
            self.raw(&p)
        }

        /// `id, u16 size, body`.
        fn sized16(self, id: u8, body: &[u8]) -> Self {
            let mut p = vec![id];
            p.extend_from_slice(&((body.len() + 3) as u16).to_le_bytes());
            p.extend_from_slice(body);
            self.raw(&p)
        }

        pub(crate) fn keyframe(self, frame: i32) -> Self {
            let mut p = vec![NETMSG_KEYFRAME];
            p.extend_from_slice(&frame.to_le_bytes());
            self.raw(&p)
        }

        pub(crate) fn newframes(mut self, n: usize) -> Self {
            for _ in 0..n {
                self = self.raw(&[NETMSG_NEWFRAME]);
            }
            self
        }

        pub(crate) fn player_name(self, player: u8, name: &str) -> Self {
            let mut b = vec![player];
            b.extend_from_slice(name.as_bytes());
            b.push(0);
            self.sized8(NETMSG_PLAYERNAME, &b)
        }

        pub(crate) fn chat(self, from: u8, dest: u8, text: &str) -> Self {
            let mut b = vec![from, dest];
            b.extend_from_slice(text.as_bytes());
            b.push(0);
            self.sized8(NETMSG_CHAT, &b)
        }

        pub(crate) fn system_message(self, player: u8, text: &str) -> Self {
            let mut b = vec![player];
            b.extend_from_slice(text.as_bytes());
            b.push(0);
            self.sized16(NETMSG_SYSTEMMSG, &b)
        }

        /// `i32 id, i32 timeout, u8 options, u32 numParams`, the tracking id
        /// when there is one, then the parameters.
        fn order_bytes(o: &Order, tracking_id: Option<i32>) -> Vec<u8> {
            let mut b = Vec::new();
            b.extend_from_slice(&o.id.to_le_bytes());
            b.extend_from_slice(&i32::MAX.to_le_bytes());
            b.push(o.options);
            b.extend_from_slice(&(o.params.len() as u32).to_le_bytes());
            if let Some(id) = tracking_id {
                b.extend_from_slice(&id.to_le_bytes());
            }
            for p in &o.params {
                b.extend_from_slice(&p.to_le_bytes());
            }
            b
        }

        pub(crate) fn command(self, player: u8, o: &Order) -> Self {
            let mut b = vec![player];
            b.extend(Self::order_bytes(o, None));
            self.sized16(NETMSG_COMMAND, &b)
        }

        /// `NETMSG_AICOMMAND`, or `NETMSG_AICOMMAND_TRACKED` when given a
        /// tracking id.
        pub(crate) fn unit_command(
            self,
            player: u8,
            ai: u8,
            team: u8,
            unit: u16,
            o: &Order,
            tracking_id: Option<i32>,
        ) -> Self {
            let mut b = vec![player, ai, team];
            b.extend_from_slice(&unit.to_le_bytes());
            b.extend(Self::order_bytes(o, tracking_id));
            let id = match tracking_id {
                Some(_) => NETMSG_AICOMMAND_TRACKED,
                None => NETMSG_AICOMMAND,
            };
            self.sized16(id, &b)
        }

        /// `NETMSG_AICOMMANDS`, folding a value every order shares into the
        /// header the way `SendCommandsToUnits` does.
        pub(crate) fn unit_commands(
            self,
            player: u8,
            pairwise: bool,
            units: &[u16],
            orders: &[Order],
        ) -> Self {
            let first = &orders[0];
            let mut same_id = first.id;
            let mut same_options = first.options;
            let mut same_params = first.params.len() as u16;
            for o in orders {
                if o.id != same_id {
                    same_id = 0;
                }
                if o.options != same_options {
                    same_options = 0xFF;
                }
                if o.params.len() as u16 != same_params {
                    same_params = 0xFFFF;
                }
            }
            let mut b = vec![player, NO_AI, pairwise as u8];
            b.extend_from_slice(&same_id.to_le_bytes());
            b.push(same_options);
            b.extend_from_slice(&same_params.to_le_bytes());
            b.extend_from_slice(&(units.len() as u16).to_le_bytes());
            for u in units {
                b.extend_from_slice(&u.to_le_bytes());
            }
            b.extend_from_slice(&(orders.len() as u16).to_le_bytes());
            for o in orders {
                if same_id == 0 {
                    b.extend_from_slice(&o.id.to_le_bytes());
                }
                if same_options == 0xFF {
                    b.push(o.options);
                }
                if same_params == 0xFFFF {
                    b.extend_from_slice(&(o.params.len() as u16).to_le_bytes());
                }
                for p in &o.params {
                    b.extend_from_slice(&p.to_le_bytes());
                }
            }
            self.sized16(NETMSG_AICOMMANDS, &b)
        }

        pub(crate) fn select(self, player: u8, units: &[u16]) -> Self {
            let mut b = vec![player];
            for u in units {
                b.extend_from_slice(&u.to_le_bytes());
            }
            self.sized16(NETMSG_SELECT, &b)
        }

        pub(crate) fn game_over(self, player: u8, winning_ally_teams: &[u8]) -> Self {
            let mut b = vec![player];
            b.extend_from_slice(winning_ally_teams);
            self.sized8(NETMSG_GAMEOVER, &b)
        }

        pub(crate) fn start_pos(self, player: u8, team: u8, ready: u8, pos: [f32; 3]) -> Self {
            let mut p = vec![NETMSG_STARTPOS, player, team, ready];
            for v in pos {
                p.extend_from_slice(&v.to_le_bytes());
            }
            self.raw(&p)
        }

        pub(crate) fn pause(self, player: u8, paused: u8) -> Self {
            self.raw(&[NETMSG_PAUSE, player, paused])
        }

        pub(crate) fn player_left(self, player: u8, intended: u8) -> Self {
            self.raw(&[NETMSG_PLAYERLEFT, player, intended])
        }

        pub(crate) fn team(self, player: u8, action: u8, param1: u8, param2: u8) -> Self {
            self.raw(&[NETMSG_TEAM, player, action, param1, param2])
        }

        pub(crate) fn new_player(self, player: u8, spectator: u8, team: u8, name: &str) -> Self {
            let mut b = vec![player, spectator, team];
            b.extend_from_slice(name.as_bytes());
            b.push(0);
            self.sized16(NETMSG_CREATE_NEWPLAYER, &b)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::Packets;
    use super::*;

    fn order(id: i32, options: u8, params: &[f32]) -> Order {
        Order {
            id,
            options,
            params: params.to_vec(),
        }
    }

    /// The kinds a walk produced, for a test that does not care about the clock.
    fn kinds(stream: &DemoStream) -> Vec<StreamEventKind> {
        stream.events.iter().map(|e| e.kind.clone()).collect()
    }

    fn walked(p: Packets) -> DemoStream {
        let s = walk(&p.bytes(), Until::TheEnd);
        assert_eq!(s.stopped, None);
        assert_eq!(s.undecoded, 0);
        s
    }

    #[test]
    fn an_empty_stream_is_a_match_that_never_started() {
        let s = walk(&[], Until::TheEnd);
        assert_eq!(s.events, vec![]);
        assert_eq!(s.last_frame, PREGAME_FRAME);
        assert_eq!(s.packets, 0);
        assert_eq!(s.stopped, None);
    }

    /// Before the first keyframe an event is pregame. A keyframe states the
    /// frame and each new frame is one more, which is how the engine counts.
    #[test]
    fn every_event_carries_the_frame_it_arrived_in() {
        let s = walked(
            Packets::default()
                .chat(1, 254, "gl hf")
                .keyframe(0)
                .chat(1, 254, "frame zero")
                .newframes(15)
                .chat(1, 254, "frame fifteen")
                .keyframe(16)
                .newframes(2)
                .chat(1, 254, "frame eighteen"),
        );
        let frames: Vec<i32> = s.events.iter().map(|e| e.frame).collect();
        assert_eq!(frames, vec![PREGAME_FRAME, 0, 15, 18]);
        assert_eq!(s.last_frame, 18);
        assert_eq!(s.packets, 23);
        // The fourth chat line is the 23rd packet, half a second apart.
        assert_eq!(s.events[3].time, 11.0);
    }

    #[test]
    fn a_player_name_is_read() {
        let s = walked(Packets::default().player_name(6, "RAM_SieHartmann"));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::PlayerName {
                player: 6,
                name: "RAM_SieHartmann".into()
            }]
        );
    }

    #[test]
    fn chat_is_read_with_who_it_was_for() {
        let s = walked(
            Packets::default()
                .chat(8, 252, "where do i go")
                .chat(3, 253, "specs only")
                .chat(4, 254, "gg")
                .chat(5, 9, "psst"),
        );
        let chat = |from, dest, text: &str| StreamEventKind::Chat {
            from,
            dest,
            text: text.into(),
        };
        assert_eq!(
            kinds(&s),
            vec![
                chat(8, ChatDest::Allies, "where do i go"),
                chat(3, ChatDest::Spectators, "specs only"),
                chat(4, ChatDest::Everyone, "gg"),
                chat(5, ChatDest::Player { player: 9 }, "psst"),
            ]
        );
    }

    #[test]
    fn a_system_message_is_read() {
        let s = walked(Packets::default().system_message(255, "Connection attempt from Eagles"));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::SystemMessage {
                player: 255,
                text: "Connection attempt from Eagles".into()
            }]
        );
    }

    /// A build order, as recorded in the Valles Marineris replay: a negative id
    /// with x, y, z and facing behind it. The timeout and the parameter count
    /// sit between the id and the parameters, and neither is in the layout
    /// `NetMessageTypes.h` describes, so the last parameter is the one asserted.
    #[test]
    fn a_command_keeps_its_id_options_and_every_parameter() {
        let build = order(-242, 32, &[1320.0, 378.45215, 5160.0, 1.0]);
        let s = walked(Packets::default().command(9, &build));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::Command {
                player: 9,
                origin: CommandOrigin::Selection,
                units: vec![],
                pairwise: false,
                orders: vec![build],
            }]
        );
    }

    #[test]
    fn a_command_with_no_parameters_is_read() {
        let stop = order(0, 0, &[]);
        let s = walked(Packets::default().command(0, &stop));
        let StreamEventKind::Command { orders, .. } = &s.events[0].kind else {
            panic!("not a command");
        };
        assert_eq!(orders, &vec![stop]);
    }

    /// A widget's `GiveOrderToUnit` and a skirmish AI's order are the same
    /// message. The AI id is what tells them apart.
    #[test]
    fn a_unit_command_says_whether_a_widget_or_an_ai_sent_it() {
        let build = order(-392, 32, &[6960.0, 376.39404, 4048.0, 0.0]);
        let fire = order(45, 0, &[2.0]);
        let s = walked(
            Packets::default()
                .unit_command(2, 255, 255, 21414, &build, None)
                .unit_command(0, 3, 5, 812, &fire, None),
        );
        assert_eq!(
            kinds(&s),
            vec![
                StreamEventKind::Command {
                    player: 2,
                    origin: CommandOrigin::Lua,
                    units: vec![21414],
                    pairwise: false,
                    orders: vec![build],
                },
                StreamEventKind::Command {
                    player: 0,
                    origin: CommandOrigin::Ai { ai: 3, team: 5 },
                    units: vec![812],
                    pairwise: false,
                    orders: vec![fire],
                },
            ]
        );
    }

    /// The tracked form carries four more bytes before its parameters. Read as
    /// the plain form, the tracking id lands in the first parameter and the
    /// packet's length no longer adds up.
    #[test]
    fn a_tracked_unit_command_does_not_read_its_tracking_id_as_a_parameter() {
        let guard = order(25, 16, &[2791.0, 7.5]);
        let s = walked(Packets::default().unit_command(0, 1, 4, 300, &guard, Some(0x4142_4344)));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::Command {
                player: 0,
                origin: CommandOrigin::Ai { ai: 1, team: 4 },
                units: vec![300],
                pairwise: false,
                orders: vec![guard],
            }]
        );
    }

    /// A formation move: one order per unit, all with the same id, options and
    /// parameter count, so the engine writes those three once in the header.
    #[test]
    fn widget_orders_that_share_a_shape_are_read_from_the_shared_header() {
        let orders = vec![
            order(10, 16, &[1884.9559, 378.99283, 5100.698]),
            order(10, 16, &[1620.7681, 386.04398, 4887.222]),
        ];
        let s = walked(Packets::default().unit_commands(9, true, &[25116, 21150], &orders));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::Command {
                player: 9,
                origin: CommandOrigin::Lua,
                units: vec![25116, 21150],
                pairwise: true,
                orders,
            }]
        );
    }

    /// Orders that differ carry their own id, options and parameter count, and
    /// the second order is the one that proves each was read at the right width.
    #[test]
    fn widget_orders_that_differ_each_carry_their_own_shape() {
        let orders = vec![
            order(-149, 32, &[2608.0, 283.1543, 3712.0, 1.0]),
            order(85, 0, &[1.0]),
            order(-74, 96, &[568.0, 171.5, 8136.0, 1.0]),
        ];
        let s = walked(Packets::default().unit_commands(4, false, &[11809, 7, 300], &orders));
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::Command {
                player: 4,
                origin: CommandOrigin::Lua,
                units: vec![11809, 7, 300],
                pairwise: false,
                orders,
            }]
        );
    }

    #[test]
    fn a_selection_lists_its_units_and_an_empty_one_is_an_answer() {
        let s = walked(
            Packets::default()
                .select(0, &[4056, 22405, 31999])
                .select(0, &[]),
        );
        assert_eq!(
            kinds(&s),
            vec![
                StreamEventKind::Select {
                    player: 0,
                    units: vec![4056, 22405, 31999]
                },
                StreamEventKind::Select {
                    player: 0,
                    units: vec![]
                },
            ]
        );
    }

    #[test]
    fn a_game_over_names_who_reported_it_and_who_won() {
        let s = walked(
            Packets::default()
                .game_over(3, &[0])
                .game_over(2, &[1, 4])
                .game_over(7, &[]),
        );
        let over = |player, winners: &[u8]| StreamEventKind::GameOver {
            player,
            winning_ally_teams: winners.to_vec(),
        };
        assert_eq!(
            kinds(&s),
            vec![over(3, &[0]), over(2, &[1, 4]), over(7, &[])]
        );
    }

    #[test]
    fn a_start_position_is_read_with_its_team_and_coordinates() {
        let s = walked(
            Packets::default()
                .start_pos(255, 1, 1, [5450.0, 0.0, 9450.0])
                .start_pos(9, 9, 0, [676.52515, 379.04028, 5293.1396]),
        );
        assert_eq!(
            kinds(&s),
            vec![
                StreamEventKind::StartPos {
                    player: 255,
                    team: 1,
                    ready: 1,
                    x: 5450.0,
                    y: 0.0,
                    z: 9450.0
                },
                StreamEventKind::StartPos {
                    player: 9,
                    team: 9,
                    ready: 0,
                    x: 676.52515,
                    y: 379.04028,
                    z: 5293.1396
                },
            ]
        );
    }

    fn every_team(_: i32) -> bool {
        true
    }

    fn at(team: i32, x: f32, y: f32, z: f32) -> TeamStartPosition {
        TeamStartPosition { team, x, y, z }
    }

    fn positions_of(p: Packets, is_team: impl Fn(i32) -> bool) -> Vec<TeamStartPosition> {
        let s = walk(&p.bytes(), Until::GameStarts);
        start_positions(&s, is_team)
    }

    #[test]
    fn the_last_pregame_message_for_a_team_is_where_it_started() {
        let got = positions_of(
            Packets::default()
                .start_pos(0, 0, 0, [100.0, 0.0, 200.0])
                .start_pos(1, 1, 1, [900.0, 5.0, 800.0])
                .start_pos(0, 0, 1, [300.0, 0.0, 400.0])
                // The server's closing broadcast, which carries the final one.
                .start_pos(0, 0, 1, [300.0, 0.0, 400.0])
                .start_pos(255, 2, 1, [50.0, 1.0, 60.0]),
            every_team,
        );
        assert_eq!(
            got,
            vec![
                at(0, 300.0, 0.0, 400.0),
                at(1, 900.0, 5.0, 800.0),
                at(2, 50.0, 1.0, 60.0)
            ]
        );
    }

    #[test]
    fn a_team_with_no_message_is_absent_and_a_corner_is_a_position() {
        let got = positions_of(
            Packets::default().start_pos(255, 3, 1, [0.0, 0.0, 0.0]),
            every_team,
        );
        assert_eq!(got, vec![at(3, 0.0, 0.0, 0.0)]);
        assert_eq!(positions_of(Packets::default(), every_team), vec![]);
    }

    #[test]
    fn a_player_who_never_readied_and_sent_nothing_has_no_position() {
        let got = positions_of(
            Packets::default()
                .start_pos(4, 0, 3, [0.0, 0.0, 0.0])
                .start_pos(5, 1, 3, [10.0, 0.0, 20.0]),
            every_team,
        );
        assert_eq!(got, vec![at(1, 10.0, 0.0, 20.0)]);
    }

    #[test]
    fn a_position_sent_after_the_game_started_does_not_move_a_team() {
        let got = positions_of(
            Packets::default()
                .start_pos(255, 0, 1, [1.0, 0.0, 2.0])
                .keyframe(0)
                .start_pos(0, 0, 0, [9.0, 9.0, 9.0]),
            every_team,
        );
        assert_eq!(got, vec![at(0, 1.0, 0.0, 2.0)]);
    }

    #[test]
    fn a_team_the_script_does_not_have_is_dropped() {
        let got = positions_of(
            Packets::default()
                .start_pos(0, 0, 1, [1.0, 0.0, 2.0])
                .start_pos(0, 7, 1, [3.0, 0.0, 4.0])
                .start_pos(0, 255, 1, [5.0, 0.0, 6.0]),
            |t| t < 2,
        );
        assert_eq!(got, vec![at(0, 1.0, 0.0, 2.0)]);
    }

    #[test]
    fn a_bounded_walk_stops_at_the_first_frame_and_a_full_one_does_not() {
        let p = Packets::default()
            .start_pos(255, 0, 1, [1.0, 0.0, 2.0])
            .newframes(3)
            .chat(0, 254, "gg");
        let bounded = walk(&p.bytes(), Until::GameStarts);
        assert_eq!(bounded.events.len(), 1);
        assert_eq!(bounded.stopped, None);
        assert_eq!(walk(&p.bytes(), Until::TheEnd).events.len(), 2);
    }

    #[test]
    fn a_stream_that_stopped_early_still_gives_the_positions_it_read() {
        let mut bytes = Packets::default()
            .start_pos(255, 0, 1, [1.0, 0.0, 2.0])
            .bytes();
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0x7FFF_FFFFu32.to_le_bytes());
        let s = walk(&bytes, Until::GameStarts);
        assert!(s.stopped.is_some());
        assert_eq!(start_positions(&s, every_team), vec![at(0, 1.0, 0.0, 2.0)]);
    }

    /// The reason the framing makes this safe: a message nobody here knows is
    /// stepped over by its length, and the one behind it reads correctly.
    #[test]
    fn a_message_the_walk_does_not_read_is_skipped_by_its_length() {
        let s = walked(
            Packets::default()
                // NETMSG_LUAMSG, the commonest packet in a real stream.
                .raw(&[50, 9, 0, 1, 2, 3, 4, 5, 6])
                // An id past NETMSG_LAST.
                .raw(&[200, 1, 2, 3])
                .chat(1, 254, "still here"),
        );
        assert_eq!(s.packets, 3);
        assert_eq!(
            kinds(&s),
            vec![StreamEventKind::Chat {
                from: 1,
                dest: ChatDest::Everyone,
                text: "still here".into()
            }]
        );
    }

    #[test]
    fn a_pause_says_who_and_which_way() {
        let s = walked(Packets::default().pause(4, 1).pause(4, 0));
        let pause = |paused| StreamEventKind::Pause { player: 4, paused };
        assert_eq!(kinds(&s), vec![pause(true), pause(false)]);
    }

    #[test]
    fn a_player_leaving_carries_why() {
        let s = walked(
            Packets::default()
                .player_left(3, 0)
                .player_left(5, 1)
                .player_left(7, 2)
                .player_left(8, 9),
        );
        let left = |player, reason| StreamEventKind::PlayerLeft { player, reason };
        assert_eq!(
            kinds(&s),
            vec![
                left(3, LeaveReason::LostConnection),
                left(5, LeaveReason::Left),
                left(7, LeaveReason::Kicked),
                left(8, LeaveReason::Other { code: 9 }),
            ]
        );
    }

    /// Each sub action puts its parameters in a different place, so every one
    /// uses distinct values and an unknown action keeps both of its.
    #[test]
    fn a_team_message_names_what_its_parameters_mean() {
        let s = walked(
            Packets::default()
                .team(2, 1, 6, 2)
                .team(2, 2, 0, 0)
                .team(9, 3, 4, 0)
                .team(9, 4, 5, 0)
                .team(1, 77, 8, 9),
        );
        let team = |player, action| StreamEventKind::Team { player, action };
        assert_eq!(
            kinds(&s),
            vec![
                team(
                    2,
                    TeamAction::GiveAway {
                        to_team: 6,
                        from_team: 2
                    }
                ),
                team(2, TeamAction::Resign),
                team(9, TeamAction::JoinTeam { team: 4 }),
                team(9, TeamAction::TeamDied { team: 5 }),
                team(
                    1,
                    TeamAction::Other {
                        action: 77,
                        param1: 8,
                        param2: 9
                    }
                ),
            ]
        );
    }

    #[test]
    fn a_late_joiner_is_read_with_their_name_and_seat() {
        let s = walked(
            Packets::default()
                .keyframe(900)
                .new_player(12, 1, 3, "Latecomer")
                .new_player(13, 0, 4, "Other"),
        );
        let joined = |player, spectator, team, name: &str| StreamEventKind::NewPlayer {
            player,
            spectator,
            team,
            name: name.into(),
        };
        assert_eq!(
            kinds(&s),
            vec![
                joined(12, true, 3, "Latecomer"),
                joined(13, false, 4, "Other")
            ]
        );
        assert_eq!(s.events[0].frame, 900);
    }

    /// The new events reach a frontend only through commands that filter, but
    /// their shape is still the contract the timeline will read.
    #[test]
    fn the_timeline_events_serialise_flat_with_a_kind_on_each_nested_value() {
        let s = walked(
            Packets::default()
                .pause(1, 1)
                .player_left(2, 2)
                .team(3, 1, 4, 5)
                .team(3, 2, 0, 0)
                .new_player(6, 1, 7, "n"),
        );
        let v = serde_json::to_value(&s.events).unwrap();
        let body = |i: usize| {
            let mut e = v[i].clone();
            let o = e.as_object_mut().unwrap();
            o.remove("frame");
            o.remove("time");
            e
        };
        assert_eq!(
            body(0),
            serde_json::json!({ "type": "pause", "player": 1, "paused": true })
        );
        assert_eq!(
            body(1),
            serde_json::json!({
                "type": "playerLeft", "player": 2, "reason": { "kind": "kicked" }
            })
        );
        assert_eq!(
            body(2),
            serde_json::json!({
                "type": "team", "player": 3,
                "action": { "kind": "giveAway", "toTeam": 4, "fromTeam": 5 }
            })
        );
        assert_eq!(
            body(3),
            serde_json::json!({
                "type": "team", "player": 3, "action": { "kind": "resign" }
            })
        );
        assert_eq!(
            body(4),
            serde_json::json!({
                "type": "newPlayer", "player": 6, "spectator": true, "team": 7, "name": "n"
            })
        );
    }

    /// A packet of a kind the walk reads, whose bytes do not fit that kind, is
    /// refused on its own. The framing still says where the next one starts.
    #[test]
    fn a_packet_that_does_not_fit_its_layout_is_counted_and_the_walk_goes_on() {
        let s = walk(
            &Packets::default()
                // A command whose size field says 30 in a 9 byte packet.
                .raw(&[NETMSG_COMMAND, 30, 0, 1, 2, 3, 4, 5, 6])
                // A command that claims two parameters and carries one.
                .raw(&{
                    let mut p = vec![NETMSG_COMMAND, 21, 0, 0];
                    p.extend_from_slice(&10i32.to_le_bytes());
                    p.extend_from_slice(&i32::MAX.to_le_bytes());
                    p.push(0);
                    p.extend_from_slice(&2u32.to_le_bytes());
                    p.extend_from_slice(&1.0f32.to_le_bytes());
                    p
                })
                // A start position one byte short.
                .raw(&[NETMSG_STARTPOS; 15])
                // A chat line with no terminator.
                .raw(&[NETMSG_CHAT, 6, 1, 254, b'h', b'i'])
                // A selection with half a unit id.
                .raw(&[NETMSG_SELECT, 5, 0, 0, 9])
                // A pause, a leave and a team message each a byte long.
                .raw(&[NETMSG_PAUSE, 1, 1, 0])
                .raw(&[NETMSG_PLAYERLEFT, 1])
                .raw(&[NETMSG_TEAM, 1, 1, 2, 3, 4])
                // A new player whose name has no terminator, and one whose size
                // field disagrees with the packet.
                .raw(&[NETMSG_CREATE_NEWPLAYER, 8, 0, 4, 0, 1, b'x', b'y'])
                .raw(&[NETMSG_CREATE_NEWPLAYER, 20, 0, 4, 0, 1, b'x', 0])
                // A keyframe with half a frame number.
                .raw(&[NETMSG_KEYFRAME, 1, 2])
                // A chunk with no payload at all.
                .raw(&[])
                .chat(1, 254, "still here")
                .bytes(),
            Until::TheEnd,
        );
        assert_eq!(s.undecoded, 12);
        assert_eq!(s.packets, 13);
        assert_eq!(s.stopped, None);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.last_frame, PREGAME_FRAME);
    }

    /// A packet length that runs past the end of the stream is a framing break.
    /// The walk stops there and keeps everything before it.
    #[test]
    fn a_length_that_overruns_the_stream_stops_the_walk_and_keeps_what_it_had() {
        let good = Packets::default().keyframe(0).chat(1, 254, "before");
        let mut bytes = good.bytes();
        let break_at = bytes.len();
        bytes.extend_from_slice(&3.0f32.to_le_bytes());
        bytes.extend_from_slice(&1_000_000u32.to_le_bytes());
        bytes.extend_from_slice(&[NETMSG_CHAT, 0, 0, 0]);

        let s = walk(&bytes, Until::TheEnd);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.packets, 2);
        let stop = s.stopped.expect("the walk should have stopped");
        assert_eq!(stop.offset, break_at);
        assert!(stop.reason.contains("1000000 bytes"), "{}", stop.reason);
    }

    #[test]
    fn a_stream_that_ends_inside_a_packet_header_stops_the_walk() {
        let good = Packets::default().keyframe(7);
        let mut bytes = good.bytes();
        let break_at = bytes.len();
        bytes.extend_from_slice(&[1, 2, 3]);

        let s = walk(&bytes, Until::TheEnd);
        assert_eq!(s.last_frame, 7);
        let stop = s.stopped.expect("the walk should have stopped");
        assert_eq!(stop.offset, break_at);
        assert!(stop.reason.contains("packet header"), "{}", stop.reason);
    }

    /// The model is the contract the issues built on this one read, so its JSON
    /// shape is pinned: one flat object per event, with the kind in `type`.
    #[test]
    fn an_event_serialises_flat_with_its_kind_in_type() {
        let s = walked(
            Packets::default()
                .keyframe(30)
                .unit_command(0, 3, 5, 812, &order(-7, 32, &[1.5]), None)
                .chat(1, 9, "hi"),
        );
        assert_eq!(
            serde_json::to_value(&s.events).unwrap(),
            serde_json::json!([
                {
                    "frame": 30,
                    "time": 0.5,
                    "type": "command",
                    "player": 0,
                    "origin": { "kind": "ai", "ai": 3, "team": 5 },
                    "units": [812],
                    "pairwise": false,
                    "orders": [{ "id": -7, "options": 32, "params": [1.5] }],
                },
                {
                    "frame": 30,
                    "time": 1.0,
                    "type": "chat",
                    "from": 1,
                    "dest": { "kind": "player", "player": 9 },
                    "text": "hi",
                },
            ])
        );
    }
}
