//! Golden tests: status bitfield round-trips with known vectors.

use coilbox_lobby_protocol::{default_battle_status, BattleStatus, ClientStatus};

#[test]
fn client_status_full_round_trip() {
    for i in 0..0x80i32 {
        assert_eq!(ClientStatus::from_int(i).to_int(), i);
    }
}

#[test]
fn client_status_known_vector() {
    // ingame + away + rank 5 + bot => 1 + 2 + 20 + 64 = 87
    let s = ClientStatus::from_int(87);
    assert!(s.ingame);
    assert!(s.away);
    assert_eq!(s.rank, 5);
    assert!(!s.access);
    assert!(s.bot);
    assert_eq!(s.to_int(), 87);
}

#[test]
fn battle_status_known_vector_matches_pack_string() {
    let s = BattleStatus {
        ready: true,
        team_id: 7,
        ally: 3,
        mode: true,
        handicap: 50,
        sync: 1,
        side: 2,
    };
    // uberserver calc_battlestatus: '0000{side}{sync}0000{handicap}{mode}{ally}{id}{ready}0'
    let bits = format!(
        "0000{:04b}{:02b}0000{:07b}{}{:04b}{:04b}{}0",
        s.side, s.sync, s.handicap, s.mode as u8, s.ally, s.team_id, s.ready as u8
    );
    let expected = i32::from_str_radix(&bits, 2).unwrap();
    assert_eq!(s.to_int(), expected);
    assert_eq!(BattleStatus::from_int(expected), s);
}

#[test]
fn default_battle_status_vector() {
    let s = default_battle_status();
    assert!(s.ready);
    assert_eq!(s.sync, 2);
    assert_eq!(s.to_int(), (1 << 1) | (0b10 << 22));
}
