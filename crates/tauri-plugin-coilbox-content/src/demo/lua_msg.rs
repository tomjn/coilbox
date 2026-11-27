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
use super::faction_picks;
use crate::model::{RecordedAward, RecordedAwardId, RecordedPlace, StreamEventKind};

/// One `NETMSG_LUAMSG`, borrowed from the stream.
#[cfg_attr(not(test), expect(dead_code, reason = "no decoder reads `mode` yet"))]
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
pub(super) const DECODERS: &[LuaDecoder] = &[
    LuaDecoder {
        name: "barAwards",
        decode: bar_awards,
    },
    LuaDecoder {
        name: "barUnitDefNames",
        decode: bar_unit_def_names,
    },
    LuaDecoder {
        name: "barFactionPick",
        decode: faction_picks::bar_pick,
    },
    LuaDecoder {
        name: "byteFactionPick",
        decode: faction_picks::byte_pick,
    },
    LuaDecoder {
        name: "metalFactionsPick",
        decode: faction_picks::metal_factions_pick,
    },
];

/// LuaRules, as [`LuaMsg::handle`] numbers it.
pub(super) const LUA_RULES: u16 = 100;

/// Beyond All Reason's awards, sent once at game over. The message is a run of
/// fields, each a marker byte and then ASCII `team:score`, or the team alone for
/// the golden cow. A team is one more than its id, so 0 is nobody.
fn bar_awards(msg: &LuaMsg) -> Option<StreamEventKind> {
    if !msg.game.starts_with("Beyond All Reason ")
        || msg.handle != LUA_RULES
        || msg.data.first() != Some(&0xA1)
    {
        return None;
    }
    let mut awards: Vec<RecordedAward> = Vec::new();
    let mut rest = msg.data;
    while let Some((&marker, tail)) = rest.split_first() {
        let id = match marker {
            0xA1 => RecordedAwardId::EconomyKilled,
            0xA2 => RecordedAwardId::FightingKilled,
            0xA3 => RecordedAwardId::Efficiency,
            0xA4 => RecordedAwardId::Everything,
            0xA5 => RecordedAwardId::Produced,
            0xA6 => RecordedAwardId::DamageTaken,
            0xA7 => RecordedAwardId::NoKill,
            _ => return None,
        };
        let end = tail.iter().position(|b| !b.is_ascii());
        let (field, next) = tail.split_at(end.unwrap_or(tail.len()));
        rest = next;
        let field = std::str::from_utf8(field).ok()?;
        let (team, score) = if id == RecordedAwardId::Everything {
            (field, None)
        } else {
            let (team, score) = field.split_once(':')?;
            let score = score.parse::<f64>().ok().filter(|s| s.is_finite())?;
            (team, Some(score))
        };
        let Some(team) = team.parse::<u32>().ok()?.checked_sub(1) else {
            continue;
        };
        if awards.last().is_none_or(|a| a.id != id) {
            awards.push(RecordedAward {
                id,
                places: Vec::new(),
            });
        }
        let places = &mut awards.last_mut()?.places;
        let place = places.len() as u32 + 1;
        places.push(RecordedPlace { place, team, score });
    }
    Some(StreamEventKind::MatchAwards { awards })
}

/// The most the compressed list may inflate to: [`MAX_UNITS`] names of
/// [`MAX_NAME_BYTES`], each with two quotes and a comma.
const MAX_UNIT_NAMES_JSON: u64 = (MAX_UNITS * (MAX_NAME_BYTES + 3)) as u64;

/// Every unit's key in definition id order, which Beyond All Reason's widget
/// `luaui/Widgets/log_unitdefids.lua` sends once from each player's game:
/// `unitdefs:` and then a zlib compressed JSON array. The widget fills it with
/// `ipairs(UnitDefs)`, so the first name is definition 1.
fn bar_unit_def_names(msg: &LuaMsg) -> Option<StreamEventKind> {
    if msg.handle != LUA_RULES || !msg.game.starts_with("Beyond All Reason ") {
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
    const UNIT_NAMES: &[u8] = include_bytes!("fixtures/bar-unitdefs.bin");

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
        match bar_unit_def_names(&msg(BAR, LUA_RULES, data))? {
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
        let names = names(UNIT_NAMES).unwrap();

        assert_eq!(names.len(), 1235);
        assert_eq!(names[0], "arm_hat_halloween_witch");
        assert_eq!(names[1234], "xmasball2_6");
        // The engine numbers definitions in the sorted order of their keys.
        assert!(names.is_sorted());
    }

    #[test]
    fn a_unit_list_cut_short_is_not_read_in_part() {
        assert_eq!(names(&UNIT_NAMES[..UNIT_NAMES.len() / 2]), None);
    }

    #[test]
    fn only_beyond_all_reasons_message_to_luarules_is_claimed() {
        let data = packed(r#"["armcom"]"#);
        assert_eq!(names(&data), Some(vec!["armcom".to_string()]));

        assert!(bar_unit_def_names(&msg("Other Game 1", LUA_RULES, &data)).is_none());
        assert!(bar_unit_def_names(&msg(BAR, 2000, &data)).is_none());
        assert!(bar_unit_def_names(&msg(BAR, LUA_RULES, &data[1..])).is_none());
    }

    #[test]
    fn a_message_that_is_not_a_list_of_names_is_not_claimed() {
        assert_eq!(names(b"unitdefs:not zlib"), None);
        for json in [r#"{"1":"armcom"}"#, "[]", r#"[""]"#, r#"["a\nb"]"#, "[1]"] {
            assert_eq!(names(&packed(json)), None, "claimed {json}");
        }
    }

    /// The message of a real replay, whose awards api.bar-rts.com gives as the
    /// same teams, one lower, with the same scores.
    const REAL: &[u8] = b"\xa12:97270\xa11:29110\xa10:0\xa22:573190\xa21:538820\xa20:0\xa31:0.03360242\xa30:0\xa30:0\xa40\xa52:1567704.13\xa62:49397.7266\xa70:0";

    fn decode(game: &str, handle: u16, data: &[u8]) -> Option<StreamEventKind> {
        bar_awards(&LuaMsg {
            game,
            player: 1,
            handle,
            mode: 0,
            data,
        })
    }

    fn awards(data: &[u8]) -> Vec<RecordedAward> {
        match decode("Beyond All Reason test-32071-e1cbffe", LUA_RULES, data) {
            Some(StreamEventKind::MatchAwards { awards }) => awards,
            other => panic!("not awards: {other:?}"),
        }
    }

    fn award(id: RecordedAwardId, places: &[(u32, f64)]) -> RecordedAward {
        RecordedAward {
            id,
            places: places
                .iter()
                .zip(1..)
                .map(|(&(team, score), place)| RecordedPlace {
                    place,
                    team,
                    score: Some(score),
                })
                .collect(),
        }
    }

    #[test]
    fn a_real_message_gives_the_places_and_scores_bars_api_gives() {
        use RecordedAwardId::*;
        assert_eq!(
            awards(REAL),
            vec![
                award(EconomyKilled, &[(1, 97270.0), (0, 29110.0)]),
                award(FightingKilled, &[(1, 573190.0), (0, 538820.0)]),
                award(Efficiency, &[(0, 0.03360242)]),
                award(Produced, &[(1, 1567704.13)]),
                award(DamageTaken, &[(1, 49397.7266)]),
            ]
        );
    }

    #[test]
    fn the_golden_cow_is_a_team_with_no_score() {
        assert_eq!(
            awards(b"\xa10:0\xa43\xa78:3119.86694"),
            vec![
                RecordedAward {
                    id: RecordedAwardId::Everything,
                    places: vec![RecordedPlace {
                        place: 1,
                        team: 2,
                        score: None,
                    }],
                },
                award(RecordedAwardId::NoKill, &[(7, 3119.86694)]),
            ]
        );
    }

    #[test]
    fn only_beyond_all_reasons_luarules_message_is_claimed() {
        let bar = "Beyond All Reason test-32071-e1cbffe";
        assert_eq!(decode("Zero-K v1.12", LUA_RULES, REAL), None);
        assert_eq!(decode(bar, 2000, REAL), None);
        for data in [
            &b""[..],
            b"\xa22:5",
            b"\xa12",
            b"\xa1x:5",
            b"\xa12:nan",
            b"\xa12:5\xa8",
            b"\xa12:5\xff1:1",
        ] {
            assert_eq!(decode(bar, LUA_RULES, data), None, "{data:?}");
        }
    }
}
