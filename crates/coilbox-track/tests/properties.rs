//! The value at a key's own frame is that key's value.
//!
//! No property testing crate is in Cargo.lock, so this is a loop over cases
//! from the deterministic generator in `common`. A failure names its seed.

mod common;

use coilbox_track::*;
use common::*;
use std::io::Cursor;

fn same(a: &[f64], b: &[f64], what: &str, seed: u64, frame: u32) {
    for (x, y) in a.iter().zip(b) {
        assert!(
            (x - y).abs() < 1e-9,
            "seed {seed}, {what} at frame {frame}: got {a:?}, key says {b:?}"
        );
    }
}

fn units_serial(w: &Window, index: u32) -> u32 {
    w.units[index as usize].unit.serial
}

#[test]
fn the_value_at_a_keys_own_frame_is_that_keys_value() {
    let mut keys_checked = 0usize;
    for seed in 1..=12u64 {
        let track = random_track(seed, 4 + (seed % 3) as u32, 40 + seed as u32 * 7, 9);
        let q = track.quantiser().unwrap();
        let mut reader = TrackReader::open(Cursor::new(track.to_bytes().unwrap())).unwrap();
        let features = reader.features().unwrap();

        for k in 0..reader.header().window_count as usize {
            let window = reader.window(k).unwrap();
            let in_window = |f: u32| window.start_frame <= f && f <= window.end_frame;

            for unit in &track.units {
                let at = |f: u32| window.sample(f, &q).unwrap();
                for key in unit.transform.iter().filter(|key| in_window(key.frame)) {
                    let s = at(key.frame);
                    let u = s.units.iter().find(|u| u.serial == unit.serial).unwrap();
                    let want: Vec<f64> =
                        key.position.iter().map(|p| q.position_value(*p)).collect();
                    same(&u.position, &want, "position", seed, key.frame);
                    same(
                        &u.rotation,
                        &q.rotation_value(&key.rotation),
                        "rotation",
                        seed,
                        key.frame,
                    );
                    keys_checked += 1;
                }
                for key in unit.status.iter().filter(|key| in_window(key.frame)) {
                    let s = at(key.frame);
                    let u = s.units.iter().find(|u| u.serial == unit.serial).unwrap();
                    same(
                        &[u.health, u.build_progress],
                        &[
                            key.health as f64 / 65535.0,
                            key.build_progress as f64 / 65535.0,
                        ],
                        "status",
                        seed,
                        key.frame,
                    );
                    assert_eq!(u.flags, key.flags);
                    keys_checked += 1;
                }
                for track in &unit.targets {
                    for key in track.keys.iter().filter(|key| in_window(key.frame)) {
                        let s = at(key.frame);
                        let u = s.units.iter().find(|u| u.serial == unit.serial).unwrap();
                        let state = u.targets.iter().find(|t| t.weapon == track.weapon);
                        let Some(state) = state else {
                            // A track with nothing in it all window is left out.
                            assert_eq!(key.kind, 0, "seed {seed}, frame {}", key.frame);
                            continue;
                        };
                        assert_eq!(state.kind, key.kind, "seed {seed}, frame {}", key.frame);
                        assert_eq!(state.build_power, key.build_power);
                        match key.kind {
                            1 | 16 | 17 | 20 => {
                                assert_eq!(units_serial(&window, state.reference), key.reference)
                            }
                            4 => assert_eq!(
                                window.projectiles[state.reference as usize]
                                    .projectile
                                    .serial,
                                key.reference
                            ),
                            2 | 18 | 19 => assert_eq!(state.reference, key.reference),
                            _ => {}
                        }
                        if key.kind >= 128 {
                            let want: Vec<f64> =
                                key.position.iter().map(|p| q.position_value(*p)).collect();
                            same(&state.position, &want, "target position", seed, key.frame);
                        }
                        keys_checked += 1;
                    }
                }
                for track in &unit.poses {
                    for key in track.keys.iter().filter(|key| in_window(key.frame)) {
                        let s = at(key.frame);
                        let u = s.units.iter().find(|u| u.serial == unit.serial).unwrap();
                        let state = u.poses.iter().find(|p| p.piece == track.piece);
                        let (angles, offsets) = match state {
                            Some(p) => (p.angles, p.offsets),
                            None => ([0.0; 3], [0.0; 3]),
                        };
                        for (a, got) in angles.iter().enumerate() {
                            let turn = ANGLE_UNITS_PER_TURN as f64;
                            let d = (got - key.angles[a] as f64).rem_euclid(turn);
                            assert!(d == 0.0, "seed {seed}, angle {a} at frame {}", key.frame);
                        }
                        let want: Vec<f64> =
                            key.offsets.iter().map(|o| q.position_value(*o)).collect();
                        same(&offsets, &want, "offset", seed, key.frame);
                        keys_checked += 1;
                    }
                }
                for key in unit.queue.iter().filter(|key| in_window(key.frame)) {
                    let s = at(key.frame);
                    let u = s.units.iter().find(|u| u.serial == unit.serial).unwrap();
                    assert_eq!(u.queue, key.items, "seed {seed}, frame {}", key.frame);
                    keys_checked += 1;
                }
            }

            for p in &track.projectiles {
                for key in p.keys.iter().filter(|key| in_window(key.frame)) {
                    let s = window.sample(key.frame, &q).unwrap();
                    let got = s.projectiles.iter().find(|x| x.serial == p.serial).unwrap();
                    let pos: Vec<f64> = key.position.iter().map(|v| q.position_value(*v)).collect();
                    let vel: Vec<f64> = key.velocity.iter().map(|v| q.velocity_value(*v)).collect();
                    same(&got.position, &pos, "projectile position", seed, key.frame);
                    same(&got.velocity, &vel, "projectile velocity", seed, key.frame);
                    keys_checked += 1;
                }
            }
        }

        // A feature exists between its first and last frame.
        for f in &features {
            assert!(f.exists_at(f.first_frame) && f.exists_at(f.last_frame));
            assert!(!f.exists_at(f.last_frame + 1));
        }
    }
    // Guard against the loops above quietly checking nothing.
    assert!(keys_checked > 5000, "only {keys_checked} keys were checked");
}
