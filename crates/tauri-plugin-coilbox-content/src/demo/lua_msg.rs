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

use std::io::Read;

use flate2::read::ZlibDecoder;

use super::def_sets::{usable_text, MAX_NAME_BYTES, MAX_UNITS};
use crate::model::StreamEventKind;

/// One `NETMSG_LUAMSG`, borrowed from the stream.
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "no decoder reads `mode` yet")
)]
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
pub(super) struct LuaDecoder {
    /// What the walk counts this decoder's messages under. Unique in the list.
    pub name: &'static str,
    /// The event a message makes, or `None` for a message that is not this
    /// decoder's. A decoder claims its own by their first bytes, and one that
    /// only knows one game's messages checks [`LuaMsg::game`] too.
    pub decode: fn(&LuaMsg) -> Option<StreamEventKind>,
}

/// Every decoder the walk tries, in order. The first to claim a message has it.
pub(super) const DECODERS: &[LuaDecoder] = &[LuaDecoder {
    name: "barUnitDefNames",
    decode: bar_unit_def_names,
}];

/// `LUA_HANDLE_ORDER_RULES` in `rts/Lua/LuaHandle.h`.
const HANDLE_LUARULES: u16 = 100;

/// The most the compressed list may inflate to: [`MAX_UNITS`] names of
/// [`MAX_NAME_BYTES`], each with two quotes and a comma.
const MAX_UNIT_NAMES_JSON: u64 = (MAX_UNITS * (MAX_NAME_BYTES + 3)) as u64;

/// Every unit's key in definition id order, which Beyond All Reason's widget
/// `luaui/Widgets/log_unitdefids.lua` sends once from each player's game:
/// `unitdefs:` and then a zlib compressed JSON array. The widget fills it with
/// `ipairs(UnitDefs)`, so the first name is definition 1.
fn bar_unit_def_names(msg: &LuaMsg) -> Option<StreamEventKind> {
    if msg.handle != HANDLE_LUARULES || !msg.game.starts_with("Beyond All Reason") {
        return None;
    }
    let compressed = msg.data.strip_prefix(b"unitdefs:")?;
    let mut json = Vec::new();
    ZlibDecoder::new(compressed)
        .take(MAX_UNIT_NAMES_JSON)
        .read_to_end(&mut json)
        .ok()?;
    let names: Vec<String> = serde_json::from_slice(&json).ok()?;
    let usable = !names.is_empty()
        && names.len() <= MAX_UNITS
        && names.iter().all(|n| !n.is_empty() && usable_text(n));
    usable.then_some(StreamEventKind::UnitDefNames {
        player: msg.player,
        names,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One whole message out of a real replay, from engine 2026.06.24 and
    /// `Beyond All Reason test-32071-e1cbffe` with `experimentallegionfaction`
    /// and `experimentalextraunits` on: the bytes the game's Lua sent.
    const REAL: &[u8] = include_bytes!("fixtures/bar-unitdefs.bin");

    fn msg<'a>(game: &'a str, handle: u16, data: &'a [u8]) -> LuaMsg<'a> {
        LuaMsg {
            game,
            player: 5,
            handle,
            mode: 0,
            data,
        }
    }

    const BAR: &str = "Beyond All Reason test-32071-e1cbffe";

    fn names(data: &[u8]) -> Option<Vec<String>> {
        match bar_unit_def_names(&msg(BAR, HANDLE_LUARULES, data))? {
            StreamEventKind::UnitDefNames { names, .. } => Some(names),
            other => panic!("made {other:?}"),
        }
    }

    fn packed(json: &str) -> Vec<u8> {
        let mut out = b"unitdefs:".to_vec();
        let mut zlib = flate2::write::ZlibEncoder::new(&mut out, Default::default());
        std::io::Write::write_all(&mut zlib, json.as_bytes()).unwrap();
        zlib.finish().unwrap();
        out
    }

    #[test]
    fn a_real_unit_list_decodes_whole() {
        let names = names(REAL).unwrap();

        assert_eq!(names.len(), 1235);
        assert_eq!(names[0], "arm_hat_halloween_witch");
        assert_eq!(names[1234], "xmasball2_6");
        // The engine numbers definitions in the sorted order of their keys.
        assert!(names.is_sorted());
    }

    #[test]
    fn a_unit_list_cut_short_is_not_read_in_part() {
        assert_eq!(names(&REAL[..REAL.len() / 2]), None);
    }

    #[test]
    fn only_beyond_all_reasons_message_to_luarules_is_claimed() {
        let data = packed(r#"["armcom"]"#);
        assert_eq!(names(&data), Some(vec!["armcom".to_string()]));

        assert!(bar_unit_def_names(&msg("Other Game 1", HANDLE_LUARULES, &data)).is_none());
        assert!(bar_unit_def_names(&msg(BAR, 2000, &data)).is_none());
        assert!(bar_unit_def_names(&msg(BAR, HANDLE_LUARULES, &data[1..])).is_none());
    }

    #[test]
    fn a_message_that_is_not_a_list_of_names_is_not_claimed() {
        assert_eq!(names(b"unitdefs:not zlib"), None);
        for json in [r#"{"1":"armcom"}"#, "[]", r#"[""]"#, r#"["a\nb"]"#, "[1]"] {
            assert_eq!(names(&packed(json)), None, "claimed {json}");
        }
    }
}
