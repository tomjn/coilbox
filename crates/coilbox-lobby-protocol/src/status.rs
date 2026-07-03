//! Status bitfields for the TASServer/Recoil lobby protocol.
//!
//! Two integer-packed bitfields cross the wire:
//! - [`ClientStatus`] — the 7-bit `MYSTATUS`/`CLIENTSTATUS` field.
//! - [`BattleStatus`] — the 32-bit `MYBATTLESTATUS`/`CLIENTBATTLESTATUS` field.
//!
//! The bit layouts here are copied from the uberserver reference server
//! (`protocol/Protocol.py::_calc_status` and `protocol/Battle.py::calc_battlestatus`)
//! and are covered by round-trip unit tests with known vectors.

use serde::Serialize;

/// The 7-bit client status bitfield (`MYSTATUS` / `CLIENTSTATUS`).
///
/// Bit layout (bit 0 = least significant):
/// - bit 0: `ingame`
/// - bit 1: `away`
/// - bits 2-4: `rank` (0-7)
/// - bit 5: `access` (moderator)
/// - bit 6: `bot`
///
/// Only `away` and `ingame` are client-set; the rest are server-authoritative
/// but are still decoded so the client mirrors the full picture.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    pub ingame: bool,
    pub away: bool,
    pub rank: u8,
    pub access: bool,
    pub bot: bool,
}

impl ClientStatus {
    /// Decode a client status integer. Tolerates negatives by treating the
    /// value as its `u32` bit pattern.
    pub fn from_int(i: i32) -> Self {
        let v = i as u32;
        ClientStatus {
            ingame: v & 0b1 != 0,
            away: v & 0b10 != 0,
            rank: ((v >> 2) & 0b111) as u8,
            access: v & (1 << 5) != 0,
            bot: v & (1 << 6) != 0,
        }
    }

    /// Encode back to the wire integer.
    pub fn to_int(&self) -> i32 {
        let mut v: u32 = 0;
        v |= self.ingame as u32;
        v |= (self.away as u32) << 1;
        v |= ((self.rank as u32) & 0b111) << 2;
        v |= (self.access as u32) << 5;
        v |= (self.bot as u32) << 6;
        v as i32
    }
}

/// The 32-bit battle status bitfield (`MYBATTLESTATUS` / `CLIENTBATTLESTATUS`).
///
/// Bit layout (bit 0 = least significant):
/// - bit 0: unused
/// - bit 1: `ready`
/// - bits 2-5: `team_id` (0-15)
/// - bits 6-9: `ally` (0-15)
/// - bit 10: `mode` (1 = player, 0 = spectator)
/// - bits 11-17: `handicap` (0-100)
/// - bits 18-21: unused
/// - bits 22-23: `sync` (0 unknown / 1 synced / 2 unsynced)
/// - bits 24-27: `side` (0-15)
/// - bits 28-31: unused
///
/// This reproduces uberserver's `calc_battlestatus` pack string
/// `'0000%s%s0000%s%s%s%s%s0'` (MSB-first: side, sync, handicap, mode, ally,
/// id, ready).
///
/// The team color is transmitted as a separate decimal integer and is NOT
/// packed into this struct.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleStatus {
    pub ready: bool,
    pub team_id: u8,
    pub ally: u8,
    pub mode: bool,
    pub handicap: u8,
    pub sync: u8,
    pub side: u8,
}

impl BattleStatus {
    /// Decode a battle status integer. Tolerates negatives by treating the
    /// value as its `u32` bit pattern (uberserver adds 2^31 to negatives).
    pub fn from_int(i: i32) -> Self {
        let v = i as u32;
        BattleStatus {
            ready: v & (1 << 1) != 0,
            team_id: ((v >> 2) & 0b1111) as u8,
            ally: ((v >> 6) & 0b1111) as u8,
            mode: v & (1 << 10) != 0,
            handicap: ((v >> 11) & 0b111_1111) as u8,
            sync: ((v >> 22) & 0b11) as u8,
            side: ((v >> 24) & 0b1111) as u8,
        }
    }

    /// Encode back to the wire integer.
    pub fn to_int(&self) -> i32 {
        let mut v: u32 = 0;
        v |= (self.ready as u32) << 1;
        v |= ((self.team_id as u32) & 0b1111) << 2;
        v |= ((self.ally as u32) & 0b1111) << 6;
        v |= (self.mode as u32) << 10;
        v |= ((self.handicap as u32) & 0b111_1111) << 11;
        v |= ((self.sync as u32) & 0b11) << 22;
        v |= ((self.side as u32) & 0b1111) << 24;
        v as i32
    }
}

/// The default battle status a client sends on first join: not spectating in the
/// sense of "unready but present", ready, ally 0, team 0, side 0, sync unsynced.
pub fn default_battle_status() -> BattleStatus {
    BattleStatus {
        ready: true,
        team_id: 0,
        ally: 0,
        mode: false,
        handicap: 0,
        sync: 2,
        side: 0,
    }
}

/// Split a `0xBBGGRR` team color integer into `(red, green, blue)`.
pub fn team_color_rgb(color: u32) -> (u8, u8, u8) {
    let r = (color & 0xFF) as u8;
    let g = ((color >> 8) & 0xFF) as u8;
    let b = ((color >> 16) & 0xFF) as u8;
    (r, g, b)
}

/// Join `(red, green, blue)` into a `0xBBGGRR` team color integer.
pub fn team_color_from_rgb(r: u8, g: u8, b: u8) -> u32 {
    (r as u32) | ((g as u32) << 8) | ((b as u32) << 16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_status_round_trip() {
        for i in 0..0x80i32 {
            let s = ClientStatus::from_int(i);
            assert_eq!(s.to_int(), i, "round-trip failed for {i}");
        }
    }

    #[test]
    fn client_status_known_vector() {
        // ingame + away + rank 5 + bot: 1 | 2 | (5<<2) | (1<<6) = 1+2+20+64 = 87
        let s = ClientStatus {
            ingame: true,
            away: true,
            rank: 5,
            access: false,
            bot: true,
        };
        assert_eq!(s.to_int(), 87);
        assert_eq!(ClientStatus::from_int(87), s);
    }

    #[test]
    fn client_status_moderator() {
        let s = ClientStatus::from_int(1 << 5);
        assert!(s.access);
        assert!(!s.bot);
    }

    #[test]
    fn battle_status_round_trip_known_fields() {
        let s = BattleStatus {
            ready: true,
            team_id: 3,
            ally: 5,
            mode: true,
            handicap: 100,
            sync: 1,
            side: 2,
        };
        assert_eq!(BattleStatus::from_int(s.to_int()), s);
    }

    #[test]
    fn battle_status_matches_pack_string() {
        // Reproduce uberserver calc_battlestatus MSB-first string:
        // '0000{side}{sync}0000{handicap}{mode}{ally}{id}{ready}0'
        let s = BattleStatus {
            ready: true,
            team_id: 3,   // id
            ally: 5,      // ally
            mode: true,   // mode
            handicap: 42, // handicap
            sync: 1,      // sync
            side: 2,      // side
        };
        let bits = format!(
            "0000{:04b}{:02b}0000{:07b}{}{:04b}{:04b}{}0",
            s.side, s.sync, s.handicap, s.mode as u8, s.ally, s.team_id, s.ready as u8
        );
        let expected = i32::from_str_radix(&bits, 2).unwrap();
        assert_eq!(s.to_int(), expected, "bits={bits}");
    }

    #[test]
    fn battle_status_negative_tolerated() {
        // Our fields never reach the sign bit (bits 28-31 are unused), but some
        // clients set an unused high bit and send a negative i32. from_int must
        // still decode the meaningful bits (uberserver treats it as u32).
        let s = BattleStatus {
            ready: true,
            team_id: 5,
            ally: 2,
            mode: true,
            handicap: 30,
            sync: 1,
            side: 3,
        };
        let negative = s.to_int() | (1 << 31); // set the unused sign bit
        assert!(negative < 0);
        assert_eq!(BattleStatus::from_int(negative), s);
    }

    #[test]
    fn default_battle_status_vector() {
        let s = default_battle_status();
        // ready(1<<1) + sync 2 (0b10 << 22)
        let expected = (1 << 1) | (0b10 << 22);
        assert_eq!(s.to_int(), expected);
    }

    #[test]
    fn team_color_split_join() {
        let c = team_color_from_rgb(0x11, 0x22, 0x33);
        assert_eq!(c, 0x33_22_11);
        assert_eq!(team_color_rgb(c), (0x11, 0x22, 0x33));
    }
}
