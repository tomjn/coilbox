//! Write a track, read it back, and compare with the curves that went in.

mod common;

use coilbox_track::*;
use common::*;
use std::io::Cursor;

fn open(track: &Track) -> TrackReader<Cursor<Vec<u8>>> {
    TrackReader::open(Cursor::new(track.to_bytes().unwrap())).unwrap()
}

fn close(a: &[f64], b: &[f64], eps: f64, what: &str, frame: u32) {
    for (x, y) in a.iter().zip(b) {
        assert!(
            (x - y).abs() <= eps,
            "{what} at frame {frame}: {a:?} against {b:?}, allowed {eps}"
        );
    }
}

#[test]
fn a_curve_that_crosses_a_window_boundary_reads_the_same_either_side() {
    // Windows of 100 frames from 0: boundaries at 100 and 200. The curve has
    // keys at 50 and 250 only, so both boundaries fall inside one segment.
    let mut track = Track::new(settings(0, 300, 100));
    let q = track.quantiser().unwrap();
    let r = q.rotation([0.0, 0.0, 0.0, 1.0]);
    track.units.push(Unit {
        engine_id: 1,
        serial: 0,
        unit_def: 0,
        team: 0,
        first_frame: 0,
        last_frame: 300,
        transform: vec![
            TransformKey {
                frame: 50,
                position: [0, 0, 0],
                rotation: r,
            },
            TransformKey {
                frame: 250,
                position: [8000, 0, 800],
                rotation: r,
            },
        ],
        status: vec![
            StatusKey {
                frame: 0,
                health: 0,
                build_progress: 65535,
                flags: 0,
            },
            StatusKey {
                frame: 300,
                health: 65535,
                build_progress: 65535,
                flags: 0,
            },
        ],
        targets: vec![],
        poses: vec![],
        queue: vec![],
    });
    let mut reader = open(&track);
    let step = 1.0 / 8.0;

    // The segment is a straight line from (0,0,0) at 50 to (1000,0,100) elmos
    // at 250, so frame 150 is half way.
    for frame in [100u32, 150, 200] {
        let s = reader.sample(frame).unwrap();
        let x = 1000.0 * (frame as f64 - 50.0) / 200.0;
        close(
            &s.units[0].position,
            &[x, 0.0, x / 10.0],
            step,
            "position",
            frame,
        );
    }
    // Frame 100 is in windows 0 and 1, and both agree.
    let w0 = reader.window(0).unwrap().sample(100, &q).unwrap();
    let w1 = reader.window(1).unwrap().sample(100, &q).unwrap();
    assert_eq!(w0.units[0].position, w1.units[0].position);
    assert_eq!(w0.units[0].rotation, w1.units[0].rotation);
    // Window 1 holds no key of its own, so the two it has are the boundary keys.
    let inside = reader.window(1).unwrap();
    assert_eq!(
        inside.units[0]
            .unit
            .transform
            .iter()
            .map(|k| k.frame)
            .collect::<Vec<_>>(),
        [100, 200]
    );
    assert!(w0.units[0].health < 0.34 && w0.units[0].health > 0.33);
}

#[test]
fn every_value_matches_the_curve_within_the_quantisation_step() {
    for seed in 1..=4u64 {
        let track = random_track(seed, 5, 60, 8);
        let q = track.quantiser().unwrap();
        let mut reader = open(&track);
        let step = 1.0 / 8.0;
        let vstep = 1.0 / 2048.0;
        let rstep = std::f64::consts::FRAC_1_SQRT_2 / 2047.0;
        let s = &track.settings;
        for frame in s.first_frame..=s.last_frame {
            let state = reader.sample(frame).unwrap();
            for unit in &track.units {
                let alive = unit.first_frame <= frame && frame <= unit.last_frame;
                let got = state.units.iter().find(|u| u.serial == unit.serial);
                assert_eq!(
                    got.is_some(),
                    alive,
                    "seed {seed} unit {} frame {frame}",
                    unit.serial
                );
                let Some(got) = got else { continue };

                let (pos, rot) = transform_at(&unit.transform, &q, frame).unwrap();
                close(&got.position, &pos, step, "unit position", frame);
                close(&got.rotation, &rot, 4.0 * rstep, "unit rotation", frame);
                let (health, build, flags) = status_at(&unit.status, frame).unwrap();
                close(
                    &[got.health, got.build_progress],
                    &[health, build],
                    1.0 / 65535.0,
                    "status",
                    frame,
                );
                assert_eq!(got.flags, flags, "flags at frame {frame}");

                for track in &unit.poses {
                    let want = pose_at(&track.keys, &q, frame).unwrap();
                    let have = got.poses.iter().find(|p| p.piece == track.piece);
                    let (angles, offsets) = match have {
                        Some(p) => (p.angles, p.offsets),
                        None => ([0.0; 3], [0.0; 3]),
                    };
                    // A window may shift a track by whole turns, so compare
                    // the angle modulo a turn. It is the same drawing.
                    for a in 0..3 {
                        let d = (angles[a] - want.0[a]).rem_euclid(ANGLE_UNITS_PER_TURN as f64);
                        let d = d.min(ANGLE_UNITS_PER_TURN as f64 - d);
                        assert!(
                            d <= 1.0,
                            "angle {a} at frame {frame}: {angles:?} against {:?}",
                            want.0
                        );
                    }
                    close(&offsets, &want.1, step, "offset", frame);
                }
            }
            for p in &track.projectiles {
                let alive = p.first_frame <= frame && frame <= p.last_frame;
                let got = state.projectiles.iter().find(|x| x.serial == p.serial);
                assert_eq!(
                    got.is_some(),
                    alive,
                    "seed {seed} projectile {} frame {frame}",
                    p.serial
                );
                let Some(got) = got else { continue };
                let (pos, vel) = projectile_at(&p.keys, &q, frame).unwrap();
                close(
                    &got.position,
                    &pos,
                    2.0 * step,
                    "projectile position",
                    frame,
                );
                // The slope between a window edge key and the next key moves by
                // the rounding of both positions divided by the gap, which is
                // one frame at the least, as well as by the velocity step.
                close(
                    &got.velocity,
                    &vel,
                    2.0 * vstep + 3.0 * step,
                    "projectile velocity",
                    frame,
                );
            }
        }
    }
}

#[test]
fn the_info_and_features_round_trip() {
    let track = random_track(9, 3, 40, 4);
    let mut reader = open(&track);
    assert_eq!(reader.info().unwrap(), track.info);
    assert_eq!(reader.features().unwrap(), track.features);
    let h = reader.header();
    assert_eq!(h.unit_count, 4);
    assert_eq!(h.projectile_count, 8);
    assert_eq!(h.feature_count, 5);
    assert_eq!(h.window_count, 3);
    assert_eq!(h.window_length, 40);
    assert_eq!(h.tolerance, 0.5);
}

#[test]
fn terrain_rows_follow_the_height_the_writer_last_wrote() {
    let mut track = Track::new(settings(0, 200, 100));
    let row = |frame, before, after| TerrainRow {
        frame,
        x: 3,
        z: 4,
        before,
        after,
    };
    // The second row's `before` is wrong on purpose. Rule 3 says the writer
    // works it out. The third rounds to nothing once that is done.
    track.terrain = vec![row(10, 800, 900), row(150, 5, 1000), row(160, 777, 1000)];
    let mut reader = open(&track);
    let a = reader.terrain(0).unwrap();
    let b = reader.terrain(1).unwrap();
    assert_eq!(a, vec![row(10, 800, 900)]);
    assert_eq!(b, vec![row(150, 900, 1000)]);

    // Forwards then backwards lands on the heights it started with.
    let mut heights = std::collections::HashMap::new();
    heights.insert((3u16, 4u16), 800);
    let all: Vec<TerrainRow> = a.into_iter().chain(b).collect();
    apply_terrain(&all, 0, 200, |x, z, h| {
        heights.insert((x, z), h);
    });
    assert_eq!(heights[&(3, 4)], 1000);
    apply_terrain(&all, 200, 0, |x, z, h| {
        heights.insert((x, z), h);
    });
    assert_eq!(heights[&(3, 4)], 800);
}

#[test]
fn an_empty_track_round_trips() {
    let track = Track::new(settings(0, 0, 900));
    let mut reader = open(&track);
    let h = reader.header();
    assert_eq!(
        (h.window_count, h.unit_count, h.projectile_count),
        (1, 0, 0)
    );
    let w = reader.window(0).unwrap();
    assert!(w.units.is_empty() && w.projectiles.is_empty());
    assert!(reader.terrain(0).unwrap().is_empty());
    let s = reader.sample(0).unwrap();
    assert!(s.units.is_empty() && s.projectiles.is_empty());
    assert_eq!(reader.info().unwrap(), track.info);
}

#[test]
fn a_value_over_the_limit_is_refused() {
    let mut track = Track::new(settings(0, 10, 900));
    let q = track.quantiser().unwrap();
    let r = q.rotation([0.0, 0.0, 0.0, 1.0]);
    track.units.push(Unit {
        engine_id: 1,
        serial: 0,
        unit_def: 0,
        team: 0,
        first_frame: 0,
        last_frame: 10,
        transform: vec![TransformKey {
            frame: 0,
            position: [16_777_216, 0, 0],
            rotation: r,
        }],
        status: vec![StatusKey {
            frame: 0,
            health: 1,
            build_progress: 1,
            flags: 0,
        }],
        targets: vec![],
        poses: vec![],
        queue: vec![],
    });
    let err = track.to_bytes().unwrap_err();
    assert!(matches!(err, TrackError::OutOfRange { .. }), "{err}");

    // The largest value that fits is accepted.
    track.units[0].transform[0].position[0] = 16_777_215;
    track.to_bytes().unwrap();

    // The same limit applies when converting from elmos.
    let err = q.position(16_777_216.0 / 8.0).unwrap_err();
    assert!(matches!(err, TrackError::OutOfRange { .. }), "{err}");
    assert_eq!(q.position(16_777_215.0 / 8.0).unwrap(), 16_777_215);
}

#[test]
fn quantise_and_dequantise_agree_within_half_a_step() {
    let q = Quantiser::new(3, 11, 12).unwrap();
    for e in [0.0, 0.06, -0.06, 1.0, 724.0, -33.33, 5000.123] {
        let back = q.position_value(q.position(e).unwrap());
        assert!((back - e).abs() <= 0.0625 + 1e-12, "{e} -> {back}");
    }
    for v in [0.0, 1.0, -600.0, 0.00049] {
        let back = q.velocity_value(q.velocity(v).unwrap());
        assert!((back - v).abs() <= 0.5 / 2048.0 + 1e-12, "{v} -> {back}");
    }
    // The documented example: 1447 is the y component of a 60 degree turn.
    let r = q.rotation([0.0, 0.5, 0.0, 0.75f64.sqrt()]);
    assert_eq!(
        r,
        Rotation {
            dropped: 3,
            kept: [0, 1447, 0]
        }
    );
    // A negative largest component flips the whole quaternion.
    assert_eq!(q.rotation([0.0, -0.5, 0.0, -0.75f64.sqrt()]), r);
}

#[test]
fn a_rotation_from_front_and_up_matches_the_documented_formulas() {
    let q = Quantiser::new(3, 11, 16).unwrap();
    let front = [0.86603, 0.0, 0.5];
    let up = [0.0, 1.0, 0.0];
    let r = q.rotation_value(&q.rotation_from_front_up(front, up));
    let (x, y, z, w) = (r[0], r[1], r[2], r[3]);
    let f = [
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
    ];
    let u = [
        2.0 * (x * y - w * z),
        1.0 - 2.0 * (x * x + z * z),
        2.0 * (y * z + w * x),
    ];
    close(&f, &front, 1e-3, "front", 0);
    close(&u, &up, 1e-3, "up", 0);
}
