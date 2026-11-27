//! The faction a player picked in the match, which the start script's `side`
//! does not say.
//!
//! A game that lets players pick sends each pick to its own Lua after the lobby
//! has written the start script, as a message [`super::lua_msg`] offers to the
//! decoders here. [`counted_picks`] says which of them count.
//!
//! hub.coilbox.org checks a replay upload against the same rule
//! (`hub-php/docs/replay-uploads.md` in tomjn/coilbox-hub), so a change to
//! which picks count has to be made there too.

use std::collections::BTreeMap;

use super::lua_msg::{LuaMsg, LUA_RULES};
use crate::model::{DemoStream, PickedFaction, RecordedPick, StreamEventKind, PREGAME_FRAME};

/// The start of each `gametype` below, up to where the version begins.
const BAR: &str = "Beyond All Reason ";
const SPLINTER_FACTION: &str = "SplinterFaction ";
const TA_RECOIL: &str = "Total Annihilation: Recoil ";
const TAP: &str = "Total Atomic Power ";
const METAL_FACTIONS: &str = "Metal Factions ";

/// The games that send the byte 0x8A and then the start unit's def id.
const BYTE_GAMES: [&str; 3] = [SPLINTER_FACTION, TA_RECOIL, TAP];

/// The games whose faction phase stays open after the match starts.
const PHASE_GAMES: [&str; 2] = [SPLINTER_FACTION, TA_RECOIL];

/// The first frame a faction phase is closed at, whoever has picked.
const PHASE_END: i32 = 900;

/// How many frames after the last team's first pick the phase is closed at.
const PHASE_CLOSES_AFTER: i32 = 91;

/// Beyond All Reason's `changeStartUnit` and then the commander's def id.
pub(super) fn bar_pick(msg: &LuaMsg) -> Option<StreamEventKind> {
    if !msg.game.starts_with(BAR) {
        return None;
    }
    unit_pick(msg, b"changeStartUnit")
}

/// The byte 0x8A and then the commander's def id.
pub(super) fn byte_pick(msg: &LuaMsg) -> Option<StreamEventKind> {
    if !BYTE_GAMES.iter().any(|game| msg.game.starts_with(game)) {
        return None;
    }
    unit_pick(msg, b"\x8a")
}

/// Metal Factions' `PICKFACTION|` and then the faction's name.
pub(super) fn metal_factions_pick(msg: &LuaMsg) -> Option<StreamEventKind> {
    if !msg.game.starts_with(METAL_FACTIONS) || msg.handle != LUA_RULES {
        return None;
    }
    let name = std::str::from_utf8(msg.data.strip_prefix(b"PICKFACTION|")?).ok()?;
    (!name.is_empty()).then(|| StreamEventKind::FactionPick {
        player: msg.player,
        picked: PickedFaction::Name(name.to_string()),
    })
}

/// A pick sent to LuaRules as `prefix` and one to nine digits.
fn unit_pick(msg: &LuaMsg, prefix: &[u8]) -> Option<StreamEventKind> {
    if msg.handle != LUA_RULES {
        return None;
    }
    let digits = msg.data.strip_prefix(prefix)?;
    if digits.len() > 9 || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let id = std::str::from_utf8(digits).ok()?.parse().ok()?;
    Some(StreamEventKind::FactionPick {
        player: msg.player,
        picked: PickedFaction::UnitDefId(id),
    })
}

/// The frame a walk of a replay of `game` has to reach to hold every pick that
/// can count, or `None` for a game whose picks nothing here reads.
pub(super) fn picks_end(game: &str) -> Option<i32> {
    if PHASE_GAMES.iter().any(|g| game.starts_with(g)) {
        Some(PHASE_END)
    } else if [BAR, TAP, METAL_FACTIONS]
        .iter()
        .any(|g| game.starts_with(g))
    {
        Some(PREGAME_FRAME + 1)
    } else {
        None
    }
}

/// Each player's pick that counts, by player number: the last one they sent
/// while the game was taking picks.
///
/// `game` is the recorded game's `gametype`, and `teams` is the team of each
/// start script player who is not a spectator. A pick from anyone else is
/// dropped. Splinter Faction and TA Recoil take picks while their faction phase
/// is open: before frame 900, and before frame `n + 91` once every team in
/// `teams` has picked, where `n` is the frame of the pick by the last team to
/// make its first. Every other game takes them only before the first frame.
pub(super) fn counted_picks(
    game: &str,
    stream: &DemoStream,
    teams: &BTreeMap<u8, i32>,
) -> BTreeMap<u8, RecordedPick> {
    let sent: Vec<(i32, u8, i32, &PickedFaction)> = stream
        .events
        .iter()
        .filter_map(|e| match &e.kind {
            StreamEventKind::FactionPick { player, picked } => teams
                .get(player)
                .map(|&team| (e.frame, *player, team, picked)),
            _ => None,
        })
        .collect();
    let closed_at = if PHASE_GAMES.iter().any(|g| game.starts_with(g)) {
        let mut first: BTreeMap<i32, i32> = BTreeMap::new();
        for &(frame, _, team, _) in &sent {
            first.entry(team).or_insert(frame);
        }
        let every_team = teams.values().all(|team| first.contains_key(team));
        match first.values().max() {
            Some(&last) if every_team => PHASE_END.min(last.saturating_add(PHASE_CLOSES_AFTER)),
            _ => PHASE_END,
        }
    } else {
        PREGAME_FRAME + 1
    };
    // A later pick replaces an earlier one from the same player.
    sent.into_iter()
        .filter(|(frame, ..)| *frame < closed_at)
        .map(|(frame, player, _, picked)| {
            let picked = picked.clone();
            (player, RecordedPick { frame, picked })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::stream::fixture::Packets;

    // Whole packets out of real replays.

    /// Splinter Faction 0.1.97, player 0 picking unit def 19.
    const SF: &[u8] = b"\x32\x0a\x00\x00\x64\x00\x00\x8a19";
    /// Splinter Faction 0.1.93, players 2 and 1 each picking unit def 82.
    const SF_PLAYER_2: &[u8] = b"\x32\x0a\x00\x02\x64\x00\x00\x8a82";
    const SF_PLAYER_1: &[u8] = b"\x32\x0a\x00\x01\x64\x00\x00\x8a82";
    /// TA Recoil 1.0.0, player 0 picking unit def 1.
    const TAR: &[u8] = b"\x32\x09\x00\x00\x64\x00\x00\x8a1";
    /// Beyond All Reason test-32071, player 1 picking unit def 56 and then 308.
    const BAR_FIRST: &[u8] = b"\x32\x18\x00\x01\x64\x00\x00changeStartUnit56";
    const BAR_THEN: &[u8] = b"\x32\x19\x00\x01\x64\x00\x00changeStartUnit308";

    fn teams(players: &[(u8, i32)]) -> BTreeMap<u8, i32> {
        players.iter().copied().collect()
    }

    fn unit(frame: i32, id: u32) -> RecordedPick {
        RecordedPick {
            frame,
            picked: PickedFaction::UnitDefId(id),
        }
    }

    fn picks(game: &str, packets: Packets, players: &[(u8, i32)]) -> Vec<(u8, RecordedPick)> {
        counted_picks(game, &packets.walked_as(game), &teams(players))
            .into_iter()
            .collect()
    }

    #[test]
    fn a_splinter_faction_pick_after_the_first_frame_counts() {
        let s = Packets::default().keyframe(0).newframes(41).raw(SF);
        assert_eq!(
            picks("SplinterFaction 0.1.97", s, &[(0, 0)]),
            [(0, unit(41, 19))]
        );
    }

    #[test]
    fn a_ta_recoil_pick_is_read() {
        let s = Packets::default().keyframe(0).newframes(43).raw(TAR);
        assert_eq!(
            picks("Total Annihilation: Recoil 1.0.0", s, &[(0, 0)]),
            [(0, unit(43, 1))]
        );
    }

    /// No TAP replay was to hand, so this is the packet its
    /// `game_initial_spawn.lua` matches, `^\138(%d+)$`.
    #[test]
    fn a_tap_pick_counts_only_before_the_first_frame() {
        let game = "Total Atomic Power v4.0.7.2";
        let s = Packets::default()
            .lua_msg(0, 100, 0, b"\x8a12")
            .keyframe(0)
            .lua_msg(0, 100, 0, b"\x8a34");
        assert_eq!(picks(game, s, &[(0, 0)]), [(0, unit(PREGAME_FRAME, 12))]);
    }

    #[test]
    fn a_beyond_all_reason_player_who_changed_their_pick_has_the_last_one() {
        let s = Packets::default().raw(BAR_FIRST).raw(BAR_THEN);
        assert_eq!(
            picks("Beyond All Reason test-32071-e1cbffe", s, &[(1, 1)]),
            [(1, unit(PREGAME_FRAME, 308))]
        );
    }

    /// No replay with a pick was to hand, so this is the message the game's
    /// `gui_red_factionpicker.lua` sends.
    #[test]
    fn a_metal_factions_pick_is_the_name_as_sent() {
        let s = Packets::default()
            .lua_msg(0, 100, 0, b"PICKFACTION|gear")
            .lua_msg(0, 100, 0, b"PICKFACTION|aven")
            .keyframe(0)
            .lua_msg(0, 100, 0, b"PICKFACTION|claw");
        assert_eq!(
            picks("Metal Factions v2.58", s, &[(0, 0)]),
            [(
                0,
                RecordedPick {
                    frame: PREGAME_FRAME,
                    picked: PickedFaction::Name("aven".into()),
                }
            )]
        );
    }

    #[test]
    fn the_faction_phase_closes_at_frame_900() {
        // Team 1 never picks, so the phase runs its full length.
        let s = Packets::default()
            .keyframe(899)
            .lua_msg(0, 100, 0, b"\x8a20")
            .newframes(1)
            .lua_msg(0, 100, 0, b"\x8a21");
        assert_eq!(
            picks("SplinterFaction 0.1.95", s, &[(0, 0), (1, 1)]),
            [(0, unit(899, 20))]
        );
    }

    #[test]
    fn the_faction_phase_closes_91_frames_after_the_last_team_picks() {
        // Real picks at the frames of a real two player match, 308 and 581,
        // followed by a change of mind on each side of the close.
        let s = Packets::default()
            .keyframe(308)
            .raw(SF_PLAYER_2)
            .keyframe(581)
            .raw(SF_PLAYER_1)
            .keyframe(671)
            .lua_msg(2, 100, 0, b"\x8a20")
            .newframes(1)
            .lua_msg(1, 100, 0, b"\x8a21");
        assert_eq!(
            picks("SplinterFaction 0.1.93", s, &[(1, 1), (2, 2)]),
            [(1, unit(581, 82)), (2, unit(671, 20))]
        );
    }

    #[test]
    fn a_pick_from_someone_with_no_team_is_dropped() {
        let s = Packets::default().raw(BAR_FIRST);
        let counted = picks("Beyond All Reason test-32071-e1cbffe", s, &[(0, 0)]);
        assert!(counted.is_empty(), "{counted:?}");
    }

    #[test]
    fn only_each_games_own_luarules_message_is_claimed() {
        let claimed = |game: &str, handle: u16, data: &[u8]| {
            let s = Packets::default().lua_msg(0, handle, 0, data);
            !s.walked_as(game).events.is_empty()
        };
        let bar = "Beyond All Reason test-1";
        let sf = "SplinterFaction 0.1.97";
        assert!(claimed(bar, 100, b"changeStartUnit5"));
        assert!(!claimed(bar, 100, b"\x8a5"));
        assert!(!claimed(bar, 2000, b"changeStartUnit5"));
        assert!(!claimed(bar, 100, b"changeStartUnit"));
        assert!(!claimed(bar, 100, b"changeStartUnit5x"));
        assert!(!claimed(bar, 100, b"changeStartUnit1234567890"));
        assert!(!claimed(sf, 100, b"changeStartUnit5"));
        assert!(!claimed(sf, 100, b"\x8a\x13"));
        assert!(!claimed("Zero-K v1.12", 100, b"\x8a5"));
        assert!(!claimed(sf, 100, b"PICKFACTION|aven"));
        assert!(!claimed("Metal Factions v2.58", 100, b"PICKFACTION|"));
        assert!(!claimed("Metal Factions v2.58", 100, b"PICKFACTION|\xff"));
    }

    #[test]
    fn only_a_game_with_picks_is_walked_for_them() {
        assert_eq!(picks_end("SplinterFaction 0.1.97"), Some(900));
        assert_eq!(picks_end("Total Annihilation: Recoil 1.0.0"), Some(900));
        assert_eq!(picks_end("Beyond All Reason test-1"), Some(0));
        assert_eq!(picks_end("Total Atomic Power v4.0.7.2"), Some(0));
        assert_eq!(picks_end("Metal Factions v2.58"), Some(0));
        assert_eq!(picks_end("Zero-K v1.12"), None);
    }
}
