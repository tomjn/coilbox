//! The messages a game's Lua sends between players, which the engine records
//! as `NETMSG_LUAMSG`, and the decoders that read the ones a replay page needs.
//!
//! Most of them are live broadcasts nothing wants later, and they are most of a
//! stream: 346,587 of the 540,126 packets in one 52 minute Beyond All Reason
//! replay. So the walk keeps nothing from a message no decoder claims, and only
//! counts it.
//!
//! To read a new message, add a [`StreamEventKind`] variant for it and a
//! [`LuaDecoder`] to [`DECODERS`].

use crate::model::StreamEventKind;

/// One `NETMSG_LUAMSG`, borrowed from the stream.
#[cfg_attr(not(test), expect(dead_code, reason = "no decoder reads these yet"))]
pub(super) struct LuaMsg<'a> {
    /// The game the replay was recorded on, as the start script's `gametype`
    /// names it, version included. For a remix it is the game before the remix,
    /// which is the one that sent the messages. Empty when the script names none.
    pub game: &'a str,
    /// The player who sent it, numbered as the start script's `[playerN]`
    /// sections are.
    pub player: u8,
    /// The `LUA_HANDLE_ORDER_*` it was sent to, from `rts/Lua/LuaHandle.h`: 100
    /// is LuaRules, 300 is LuaGaia and 2000 is LuaUI.
    pub handle: u16,
    /// 0 for LuaRules and LuaGaia. LuaUI also takes `a` for allies and `s` for
    /// spectators.
    pub mode: u8,
    /// The string the game's Lua sent. It can hold any bytes, NUL included.
    pub data: &'a [u8],
}

/// Reads one kind of message.
#[cfg_attr(not(test), expect(dead_code, reason = "DECODERS is empty"))]
pub(super) struct LuaDecoder {
    /// What the walk counts this decoder's messages under. Unique in the list.
    pub name: &'static str,
    /// The event a message makes, or `None` for a message that is not this
    /// decoder's. A decoder claims its own by their first bytes, and one that
    /// only knows one game's messages checks [`LuaMsg::game`] too.
    pub decode: fn(&LuaMsg) -> Option<StreamEventKind>,
}

/// Every decoder the walk tries, in order. The first to claim a message has it.
pub(super) const DECODERS: &[LuaDecoder] = &[];
