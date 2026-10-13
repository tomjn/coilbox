//! The numbers of the teams and of the game (issue #3982): what each team
//! holds, the rest of its economy and the rules parameters a game's adapter
//! names, through the writer and back through the reader.

mod common;

use coilbox_track::*;
use common::settings;
use std::io::Cursor;

/// A match of three windows of 100 frames, from frame 1000 to 1300.
fn track(values: Vec<ValueTrack>) -> Track {
    let mut track = Track::new(Settings {
        recorder_version: 4,
        value_tolerance: 0.5,
        value_fraction: 1.0 / 1024.0,
        ..settings(1000, 1300, 100)
    });
    track.info.team_params = vec!["supplyUsed".into(), "researchPoints".into()];
    track.info.game_params = vec!["wave".into()];
    track.values = values;
    track
}

fn keys(points: &[(u32, f32)]) -> Vec<ValueKey> {
    points.iter().map(|(f, v)| ValueKey::new(*f, *v)).collect()
}

fn read(track: &Track) -> TrackReader<Cursor<Vec<u8>>> {
    TrackReader::open(Cursor::new(track.to_bytes().unwrap())).unwrap()
}

/// The value of one number at a frame, as a reader gives it.
fn at(reader: &mut TrackReader<Cursor<Vec<u8>>>, frame: u32, team: u8, code: u16) -> Option<f64> {
    reader
        .sample(frame)
        .unwrap()
        .values
        .into_iter()
        .find(|v| v.team == team && v.code == code)
        .map(|v| v.value)
}

const METAL: u16 = value_code::HELD;
const ENERGY: u16 = value_code::ENERGY + value_code::HELD;

#[test]
fn a_float_column_is_its_values_bit_for_bit() {
    // What an engine can hold and a whole number column cannot: a fraction,
    // a number past 16,777,215 and a negative one.
    let values = [0.0f32, 1028.37, -4.5, 1.0e9, f32::MAX, 16_777_217.0];
    let mut chunk = Chunk::new();
    chunk.set_f32_bits(108, values.iter().map(|v| v.to_bits()).collect());
    chunk.set_u8(104, vec![7]);
    let bytes = chunk.encode().unwrap();

    // The directory entry of the second column: its id, type 6, and a count.
    assert_eq!(bytes[16..20], [108, 0, 6, 0]);
    assert_eq!(bytes[24..28], 6u32.to_le_bytes());
    let back = Chunk::decode(&bytes).unwrap();
    assert_eq!(back, chunk);
    let floats: Vec<f32> = back
        .f32_bits(108)
        .unwrap()
        .iter()
        .map(|b| f32::from_bits(*b))
        .collect();
    assert_eq!(floats, values);
    // A float column is not a whole number column, and the other way round.
    assert!(back.u32s(108).is_err());
    assert!(back.f32_bits(104).is_err());
    assert!(back.f32_bits(109).unwrap().is_empty());
}

#[test]
fn the_header_holds_the_resource_tolerance_and_fraction_in_bytes_that_were_reserved() {
    let bytes = track(vec![]).to_bytes().unwrap();
    assert_eq!(bytes[80..84], 0.5f32.to_le_bytes());
    assert_eq!(bytes[84..88], (1.0f32 / 1024.0).to_le_bytes());
    assert_eq!(bytes[88..96], [0; 8]);

    let reader = TrackReader::open(Cursor::new(bytes)).unwrap();
    let h = reader.header();
    assert_eq!((h.value_tolerance, h.value_fraction), (0.5, 1.0 / 1024.0));
    // A sample is allowed the tolerance, or the fraction of itself when that
    // is more.
    assert_eq!(h.value_allowance(100.0), 0.5);
    assert_eq!(h.value_allowance(-8192.0), 8.0);
}

/// A track from before recorder version 4: no columns, no names, and zero
/// bytes where the two numbers now are.
#[test]
fn a_track_with_no_team_resources_reads_with_none() {
    let mut old = Track::new(settings(1000, 1300, 100));
    old.info.unit_defs = vec!["armcom".into()];
    let mut reader = read(&old);

    assert_eq!(reader.header().value_tolerance, 0.0);
    assert_eq!(reader.header().value_fraction, 0.0);
    let info = reader.info().unwrap();
    assert!(info.team_params.is_empty() && info.game_params.is_empty());
    for k in 0..3 {
        assert!(reader.window(k).unwrap().values.is_empty());
        assert!(reader.window_chunk(k).unwrap().column(104).is_none());
    }
    assert!(reader.sample(1150).unwrap().values.is_empty());
}

#[test]
fn a_number_runs_in_a_straight_line_between_keys_and_each_window_stands_alone() {
    let whole = keys(&[(1000, 100.0), (1150, 400.0), (1300, 100.0)]);
    let track = track(vec![ValueTrack {
        team: 0,
        code: METAL,
        keys: whole.clone(),
    }]);
    let mut reader = read(&track);

    for frame in [
        1000u32, 1001, 1075, 1099, 1100, 1101, 1150, 1200, 1299, 1300,
    ] {
        assert_eq!(
            at(&mut reader, frame, 0, METAL),
            value_at(&whole, frame),
            "frame {frame}"
        );
    }
    // A window that no key falls in has one at each end, worked out from the
    // whole curve.
    let first = reader.window(0).unwrap();
    let frames: Vec<u32> = first.values[0].keys.iter().map(|k| k.frame).collect();
    assert_eq!(frames, [1000, 1100]);
    assert_eq!(first.values[0].keys[1].value(), 300.0);
    // The frame two windows share reads the same from both.
    let second = reader.window(1).unwrap();
    assert_eq!(second.values[0].keys[0], first.values[0].keys[1]);
}

#[test]
fn a_resource_that_is_nothing_for_a_whole_window_has_no_track_in_it() {
    let track = track(vec![
        ValueTrack {
            team: 0,
            code: METAL,
            keys: keys(&[(1000, 50.0)]),
        },
        // Nothing until the last window.
        ValueTrack {
            team: 0,
            code: value_code::EXCESS,
            keys: keys(&[(1000, 0.0), (1249, 0.0), (1250, 12.5)]),
        },
    ]);
    let mut reader = read(&track);

    let codes = |w: &Window| w.values.iter().map(|v| v.code).collect::<Vec<_>>();
    assert_eq!(codes(&reader.window(0).unwrap()), [METAL]);
    assert_eq!(codes(&reader.window(1).unwrap()), [METAL]);
    assert_eq!(
        codes(&reader.window(2).unwrap()),
        [METAL, value_code::EXCESS]
    );
    // A resource with no track is 0, so a reader lists none and means 0.
    assert_eq!(at(&mut reader, 1050, 0, value_code::EXCESS), None);
    assert_eq!(at(&mut reader, 1249, 0, value_code::EXCESS), Some(0.0));
    assert_eq!(at(&mut reader, 1250, 0, value_code::EXCESS), Some(12.5));
}

#[test]
fn a_rules_parameter_has_no_value_before_the_frame_it_was_first_set_on() {
    let supply = value_code::PARAMETER;
    let track = track(vec![
        // First set part way through the second window, and unchanged for the
        // whole of the third.
        ValueTrack {
            team: 1,
            code: supply,
            keys: keys(&[(1130, 3.0), (1159, 3.0), (1160, 4.0)]),
        },
        // The game's, first set on the edge between the first two windows.
        ValueTrack {
            team: NO_TEAM,
            code: supply,
            keys: keys(&[(1100, 7.0)]),
        },
        // One that is 0 is still set.
        ValueTrack {
            team: 1,
            code: supply + 1,
            keys: keys(&[(1000, 0.0)]),
        },
    ]);
    let mut reader = read(&track);

    assert_eq!(at(&mut reader, 1099, 1, supply), None);
    assert_eq!(at(&mut reader, 1129, 1, supply), None);
    assert_eq!(at(&mut reader, 1130, 1, supply), Some(3.0));
    assert_eq!(at(&mut reader, 1160, 1, supply), Some(4.0));
    assert_eq!(at(&mut reader, 1300, 1, supply), Some(4.0));
    // The third window's first key is on its first frame, though the value is
    // the one the window before ended on. Without it a reader would take the
    // parameter as not set until the window's first key.
    let third = reader.window(2).unwrap();
    let in_third = third
        .values
        .iter()
        .find(|v| v.team == 1 && v.code == supply)
        .unwrap();
    assert_eq!(in_third.keys[0], ValueKey::new(1200, 4.0));

    // A frame on an edge is in two windows, and both say the same.
    let first = reader.window(0).unwrap();
    let on_edge = first.values.iter().find(|v| v.team == NO_TEAM).unwrap();
    assert_eq!(on_edge.keys, keys(&[(1100, 7.0)]));
    assert_eq!(at(&mut reader, 1099, NO_TEAM, supply), None);
    assert_eq!(at(&mut reader, 1100, NO_TEAM, supply), Some(7.0));
    assert_eq!(at(&mut reader, 1000, 1, supply + 1), Some(0.0));
}

#[test]
fn the_tracks_of_a_window_are_in_order_of_team_and_code() {
    let one = |team: u8, code: u16| ValueTrack {
        team,
        code,
        keys: keys(&[(1000, 1.0)]),
    };
    let track = track(vec![
        one(NO_TEAM, value_code::PARAMETER),
        one(1, ENERGY),
        one(0, value_code::PARAMETER + 1),
        one(1, METAL),
        one(0, ENERGY),
    ]);
    let order: Vec<(u8, u16)> = read(&track)
        .window(0)
        .unwrap()
        .values
        .iter()
        .map(|v| (v.team, v.code))
        .collect();
    assert_eq!(
        order,
        [
            (0, ENERGY),
            (0, value_code::PARAMETER + 1),
            (1, METAL),
            (1, ENERGY),
            (NO_TEAM, value_code::PARAMETER)
        ]
    );
}

#[test]
fn a_writer_refuses_numbers_a_reader_could_not_use() {
    let refused = |values: Vec<ValueTrack>| track(values).to_bytes().unwrap_err().to_string();
    let one = |team: u8, code: u16, points: &[(u32, f32)]| ValueTrack {
        team,
        code,
        keys: keys(points),
    };

    let twice = refused(vec![
        one(0, METAL, &[(1000, 1.0)]),
        one(0, METAL, &[(1000, 2.0)]),
    ]);
    assert!(twice.contains("two tracks"), "{twice}");
    let outside = refused(vec![one(0, METAL, &[(999, 1.0)])]);
    assert!(outside.contains("frame 999"), "{outside}");
    let backwards = refused(vec![one(0, METAL, &[(1010, 1.0), (1005, 2.0)])]);
    assert!(backwards.contains("do not rise"), "{backwards}");
    let endless = refused(vec![one(0, METAL, &[(1000, f32::INFINITY)])]);
    assert!(endless.contains("not a number"), "{endless}");
    // The info names two team parameters and one of the game's.
    let unnamed = refused(vec![one(0, value_code::PARAMETER + 2, &[(1000, 1.0)])]);
    assert!(unnamed.contains("does not name"), "{unnamed}");
    let unnamed = refused(vec![one(
        NO_TEAM,
        value_code::PARAMETER + 1,
        &[(1000, 1.0)],
    )]);
    assert!(unnamed.contains("does not name"), "{unnamed}");
    assert!(
        track(vec![one(0, value_code::PARAMETER + 1, &[(1000, 1.0)])])
            .to_bytes()
            .is_ok()
    );
}

#[test]
fn the_info_chunk_names_the_rules_parameters() {
    let mut reader = read(&track(vec![]));
    let info = reader.info().unwrap();
    assert_eq!(info.team_params, ["supplyUsed", "researchPoints"]);
    assert_eq!(info.game_params, ["wave"]);
}
