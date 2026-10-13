//! What thinning keeps, on small matches written as dumps by the test helper.

mod common;

use coilbox_track::{projectile_at, transform_at, Quantiser, TrackReader};
use coilbox_track_thin::{
    check_track, thin_dump, thin_dump_cancellable, ThinError, ThinOptions, ThinReport,
};
use common::*;

/// Thins a scene and reads the track back.
fn thin(scene: &Scene) -> (ThinReport, Read) {
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let report = thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    assert_eq!(report.bytes, std::fs::metadata(&track).unwrap().len());
    (report, read_track(&track))
}

fn quantiser(read: &Read) -> Quantiser {
    read.header.quantiser().unwrap()
}

#[test]
fn a_straight_line_with_one_corner_keeps_exactly_three_keys() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |f| {
        if f <= 150 {
            At::place(100.0 + f as f32, 50.0, 100.0)
        } else {
            At::place(250.0, 50.0, 100.0 + (f - 150) as f32)
        }
    });
    let (report, read) = thin(&scene);
    let unit = read.unit(0, 7);
    assert_eq!(frames(&unit.transform), [0, 150, 300]);
    assert_eq!(report.kept.transform, 3);
    assert_eq!(report.samples.units, 101);
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
}

#[test]
fn a_unit_that_idles_and_then_moves_keeps_the_moment_it_starts() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |f| {
        At::place(100.0 + f.saturating_sub(150) as f32, 50.0, 100.0)
    });
    let (_, read) = thin(&scene);
    let unit = read.unit(0, 7);
    assert_eq!(frames(&unit.transform), [0, 150, 300]);
    // The key at frame 150 is where it stood, so a reader holds it there
    // until then and does not start it off early.
    let q = quantiser(&read);
    let (at, _) = transform_at(&unit.transform, &q, 150).unwrap();
    assert_eq!(at, [100.0, 50.0, 100.0]);
    let (at, _) = transform_at(&unit.transform, &q, 75).unwrap();
    assert_eq!(at, [100.0, 50.0, 100.0]);
}

#[test]
fn a_unit_that_never_moves_keeps_one_key_in_every_window() {
    let mut scene = Scene::new(2000);
    scene.unit(7, 1, 0, 2000, |_| At::place(100.0, 50.0, 100.0));
    let (report, read) = thin(&scene);
    assert_eq!(read.windows.len(), 3);
    for k in 0..3 {
        assert_eq!(read.unit(k, 7).transform.len(), 1, "window {k}");
        assert_eq!(read.unit(k, 7).status.len(), 1, "window {k}");
    }
    assert_eq!(report.kept.transform, 1);
    assert_eq!(report.written.transform, 3);
}

#[test]
fn a_weapon_target_is_kept_only_when_it_changes() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(2, 1, 0, 300, |_| At::place(300.0, 0.0, 100.0));
    // Unit 1's first weapon takes unit 2 as its target, the recorder says so
    // again, and then it has none.
    scene.frame(30).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    scene.frame(60).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    scene.frame(90).targets.push([1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
    // Its second weapon aims at a place.
    scene
        .frame(45)
        .targets
        .push([1.0, 2.0, 2.0, 310.0, 5.5, 120.0]);
    let (report, read) = thin(&scene);
    let unit = read.unit(0, 1);
    assert_eq!(unit.targets.len(), 2);
    let first = &unit.targets[0];
    assert_eq!(first.weapon, 1);
    // The key at frame 0 is the one a window starts a track with: no target.
    assert_eq!(frames(&first.keys), [0, 30, 90]);
    assert_eq!(
        first.keys.iter().map(|k| k.kind).collect::<Vec<_>>(),
        [0, 1, 0]
    );
    let target = first.keys[1].reference as usize;
    assert_eq!(read.windows[0].units[target].unit.engine_id, 2);
    let second = &unit.targets[1];
    assert_eq!(second.weapon, 2);
    assert_eq!(second.keys[1].kind, 128);
    assert_eq!(second.keys[1].position, [2480, 44, 960]);
    assert_eq!(report.kept.target, 3);
}

#[test]
fn two_weapons_aimed_at_different_targets_each_have_a_target_curve() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(2, 1, 0, 300, |_| At::place(300.0, 0.0, 100.0));
    scene.unit(3, 1, 0, 300, |_| At::place(500.0, 0.0, 100.0));
    scene.projectile(9, 1, 2, 40, 60, |f| {
        ([300.0 + f as f32, 40.0, 100.0], [1.0, 0.0, 0.0])
    });
    // Weapon 1 takes unit 2 and lets go of it on frame 120.
    scene.frame(30).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    scene
        .frame(120)
        .targets
        .push([1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
    // Weapon 2 takes unit 3, then the projectile, which is gone after frame
    // 60, then a place.
    scene.frame(35).targets.push([1.0, 2.0, 1.0, 3.0, 0.0, 0.0]);
    scene.frame(45).targets.push([1.0, 2.0, 3.0, 9.0, 0.0, 0.0]);
    scene
        .frame(90)
        .targets
        .push([1.0, 2.0, 2.0, 700.0, 12.0, 160.0]);

    let dir = tempfile::tempdir().unwrap();
    let (dump, path) = scene.write(dir.path());
    let report = thin_dump(&dump, &path, &ThinOptions::default()).unwrap();
    let read = read_track(&path);
    let unit = read.unit(0, 1);

    assert_eq!(unit.targets.len(), 2);
    assert_eq!(report.kept.target_tracks, 2);
    let (first, second) = (&unit.targets[0], &unit.targets[1]);
    assert_eq!((first.weapon, second.weapon), (1, 2));
    // Each track starts with the key a window starts with, no target.
    assert_eq!(frames(&first.keys), [0, 30, 120]);
    assert_eq!(
        first.keys.iter().map(|k| k.kind).collect::<Vec<_>>(),
        [0, 1, 0]
    );
    assert_eq!(frames(&second.keys), [0, 35, 45, 61, 90]);
    assert_eq!(
        second.keys.iter().map(|k| k.kind).collect::<Vec<_>>(),
        [0, 1, 4, 0, 128]
    );
    // Neither track's keys name what the other's do.
    let engine_id = |key: &coilbox_track::TargetKey| {
        read.windows[0].units[key.reference as usize].unit.engine_id
    };
    assert_eq!(engine_id(&first.keys[1]), 2);
    assert_eq!(engine_id(&second.keys[1]), 3);
    let projectile = &read.windows[0].projectiles[second.keys[2].reference as usize];
    assert_eq!(projectile.projectile.first_frame, 40);
    // A weapon aimed at a place keeps the place.
    assert_eq!(second.keys[4].position, [5600, 96, 1280]);

    // A reader that asks for frame 50 gets both weapons' targets, and for
    // frame 100 the first weapon's unit and the second weapon's place.
    let mut reader = TrackReader::open(std::fs::File::open(&path).unwrap()).unwrap();
    let held_by = |frame: u32, reader: &mut TrackReader<std::fs::File>| {
        let state = reader.sample(frame).unwrap();
        let unit = state.units.iter().find(|u| u.engine_id == 1).unwrap();
        unit.targets
            .iter()
            .map(|t| (t.weapon, t.kind))
            .collect::<Vec<_>>()
    };
    assert_eq!(held_by(50, &mut reader), [(1, 1), (2, 4)]);
    assert_eq!(held_by(100, &mut reader), [(1, 1), (2, 128)]);
    assert_eq!(held_by(150, &mut reader), [(1, 0), (2, 128)]);
}

#[test]
fn a_unit_with_one_weapon_costs_one_target_track_and_a_weapon_without_a_target_none() {
    let aimed = |scene: &mut Scene| {
        scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
        scene.unit(2, 1, 0, 300, |_| At::place(300.0, 0.0, 100.0));
        scene.frame(30).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    };
    // Unit 1 has the one weapon. Unit 3 has a second weapon that the
    // recorder has said has no target.
    let mut with = Scene::new(300);
    aimed(&mut with);
    with.unit(3, 1, 0, 300, |_| At::place(500.0, 0.0, 100.0));
    with.frame(10).targets.push([3.0, 2.0, 0.0, 0.0, 0.0, 0.0]);
    let mut without = Scene::new(300);
    aimed(&mut without);
    without.unit(3, 1, 0, 300, |_| At::place(500.0, 0.0, 100.0));

    let (report, read) = thin(&with);
    assert_eq!(read.unit(0, 1).targets.len(), 1);
    assert_eq!(read.unit(0, 1).targets[0].weapon, 1);
    assert!(read.unit(0, 3).targets.is_empty());
    assert_eq!(report.kept.target_tracks, 1);
    assert_eq!(report.written.target_tracks, 1);

    // The second weapon adds nothing to the file.
    let (bare, _) = thin(&without);
    assert_eq!(report.bytes, bare.bytes);
}

#[test]
fn switching_a_unit_off_keeps_a_status_key_where_it_changes() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |f| {
        let mut at = At::place(100.0, 0.0, 100.0);
        at.on = f < 60;
        at
    });
    let (_, read) = thin(&scene);
    let status = &read.unit(0, 1).status;
    assert_eq!(frames(status), [0, 60]);
    assert_eq!(status.iter().map(|k| k.flags).collect::<Vec<_>>(), [1, 0]);
}

#[test]
fn health_that_falls_at_an_even_rate_keeps_its_two_ends() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |f| {
        let mut at = At::place(100.0, 0.0, 100.0);
        at.health = 100.0 - f.min(150) as f32 * 0.5;
        at
    });
    let (_, read) = thin(&scene);
    let status = &read.unit(0, 1).status;
    assert_eq!(frames(status), [0, 150]);
    assert_eq!(status[1].health, 16384);
}

#[test]
fn a_reused_unit_id_is_a_new_unit() {
    let mut scene = Scene::new(300);
    scene.unit(5, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(5, 2, 60, 300, |_| At::place(900.0, 0.0, 900.0));
    let (report, read) = thin(&scene);
    assert_eq!(report.header.unit_count, 2);
    let units = &read.windows[0].units;
    assert_eq!(units.len(), 2);
    assert_eq!(
        units
            .iter()
            .map(|u| (
                u.unit.engine_id,
                u.unit.serial,
                u.unit.first_frame,
                u.unit.last_frame
            ))
            .collect::<Vec<_>>(),
        [(5, 0, 0, 30), (5, 1, 60, 300)]
    );
    assert_eq!(read.info.unit_defs, ["tank", "tower"]);
    assert_eq!(units[1].unit.unit_def, 1);
}

#[test]
fn a_unit_that_dies_between_two_samples_ends_where_it_died() {
    let mut scene = Scene::new(300);
    // Last alive on frame 31, which is not a sample frame, so the destroyed
    // row's pose is the only record of where it was then.
    scene.unit(5, 1, 0, 31, |f| At::place(100.0 + f as f32, 0.0, 100.0));
    let (_, read) = thin(&scene);
    let unit = read.unit(0, 5);
    assert_eq!((unit.first_frame, unit.last_frame), (0, 31));
    let q = quantiser(&read);
    let (at, _) = transform_at(&unit.transform, &q, 31).unwrap();
    assert_eq!(at, [131.0, 0.0, 100.0]);
}

#[test]
fn a_projectile_id_is_a_new_projectile_when_it_was_gone_or_is_not_the_same() {
    let mut scene = Scene::new(100);
    scene.unit(1, 1, 0, 100, |_| At::place(100.0, 0.0, 100.0));
    let flight = |f: u32| ([f as f32 * 4.0, 50.0, 10.0], [4.0, 0.0, 0.0]);
    // The same id on consecutive frames, but a different weapon definition.
    scene.projectile(9, 1, 1, 10, 20, flight);
    scene.projectile(9, 2, 1, 21, 30, flight);
    // The same id and definition again after frames without it.
    scene.projectile(9, 2, 1, 40, 45, flight);
    // The same id and definition on the next frame, fired by nobody.
    scene.projectile(9, 2, -1, 46, 50, flight);
    let (report, read) = thin(&scene);
    assert_eq!(report.header.projectile_count, 4);
    let lives: Vec<_> = read.windows[0]
        .projectiles
        .iter()
        .map(|p| {
            (
                p.projectile.first_frame,
                p.projectile.last_frame,
                p.projectile.weapon_def,
                p.projectile.shooter,
            )
        })
        .collect();
    assert_eq!(
        lives,
        [
            (10, 20, 0, Some(0)),
            (21, 30, 1, Some(0)),
            (40, 45, 1, Some(0)),
            (46, 50, 1, None)
        ]
    );
    assert_eq!(read.info.weapon_defs, ["cannon", "laser"]);
    // A straight flight at an even speed needs its two ends and no more.
    for p in &read.windows[0].projectiles {
        assert_eq!(p.projectile.keys.len(), 2);
    }
}

#[test]
fn a_shell_under_constant_gravity_keeps_two_keys_and_is_within_tolerance_everywhere() {
    let mut scene = Scene::new(200);
    scene.unit(1, 1, 0, 200, |_| At::place(100.0, 0.0, 100.0));
    // Fired forward at 8 elmos a frame along x and up at 6, with its upward
    // speed falling by 0.2 elmos a frame every frame, for 90 frames.
    let (from, to, gravity) = (10u32, 100u32, -0.2f32);
    let flight = |f: u32| {
        let t = (f - from) as f32;
        (
            [
                100.0 + 8.0 * t,
                5.0 + 6.0 * t + 0.5 * gravity * t * t,
                100.0,
            ],
            [8.0, 6.0 + gravity * t, 0.0],
        )
    };
    scene.projectile(9, 1, 1, from, to, flight);
    let (report, read) = thin(&scene);

    let projectiles = &read.windows[0].projectiles;
    assert_eq!(projectiles.len(), 1);
    let keys = &projectiles[0].projectile.keys;
    assert_eq!(frames(keys), [from, to]);
    assert_eq!(report.kept.projectile, 2);

    // Every recorded frame, not only the ones thinning dropped.
    let q = quantiser(&read);
    let mut worst = 0.0f64;
    for f in from..=to {
        let (p, _) = projectile_at(keys, &q, f).unwrap();
        let (recorded, _) = flight(f);
        let off = (0..3)
            .map(|i| (p[i] - recorded[i] as f64).powi(2))
            .sum::<f64>()
            .sqrt();
        worst = worst.max(off);
    }
    assert!(
        worst <= 0.5,
        "furthest recorded frame is {worst} elmos away"
    );
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
}

#[test]
fn a_missile_that_changes_direction_keeps_a_key_at_the_turn() {
    let mut scene = Scene::new(200);
    scene.unit(1, 1, 0, 200, |_| At::place(100.0, 0.0, 100.0));
    // Flies along x at 6 elmos a frame, and on frame 60 is flying along z at
    // 6 elmos a frame, with nothing in between.
    let turn = 60u32;
    let flight = |f: u32| {
        if f <= turn {
            ([100.0 + 6.0 * f as f32, 50.0, 100.0], [6.0, 0.0, 0.0])
        } else {
            (
                [
                    100.0 + 6.0 * turn as f32,
                    50.0,
                    100.0 + 6.0 * (f - turn) as f32,
                ],
                [0.0, 0.0, 6.0],
            )
        }
    };
    scene.projectile(9, 1, 1, 20, 100, flight);
    let (report, read) = thin(&scene);

    let keys = &read.windows[0].projectiles[0].projectile.keys;
    // Without a key at the turn, one cubic from the first frame to the last
    // cuts the corner by tens of elmos. The velocity changes between frame 60
    // and frame 61, so the curve needs a key on each side of the change.
    let kept = frames(keys);
    assert!(kept.contains(&turn), "{kept:?}");
    assert!(kept.contains(&(turn + 1)), "{kept:?}");
    let q = quantiser(&read);
    let (at, _) = projectile_at(keys, &q, turn).unwrap();
    assert_eq!(at, [460.0, 50.0, 100.0]);
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
}

#[test]
fn a_velocity_the_position_does_not_follow_is_reported_and_does_not_fail_the_track() {
    let mut scene = Scene::new(100);
    scene.unit(1, 1, 0, 100, |_| At::place(100.0, 0.0, 100.0));
    // A beam, as the benchmark recordings have them: it stays where it was
    // fired from, and the engine gives it a velocity along the beam.
    scene.projectile(9, 1, 1, 10, 16, |_| {
        ([100.0, 50.0, 100.0], [0.0, 0.0, 600.0])
    });
    // A shell that moves as fast as its velocity says.
    scene.projectile(10, 1, 1, 10, 16, |f| {
        (
            [100.0, 50.0, 100.0 + 6.0 * (f - 10) as f32],
            [0.0, 0.0, 6.0],
        )
    });
    let (report, read) = thin(&scene);
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());

    let velocity = report.worst.projectile_velocity.as_ref().unwrap();
    // Two keys with the same position and velocity, two frames apart, hold
    // the position half way between them. The slope there is -0.5 of the
    // velocity at the keys, so the recorded 600 is 900 away from it.
    assert!((velocity.error - 900.0).abs() < 0.01, "{velocity}");
    assert_eq!(velocity.what, "projectile 0");
    // The shell's velocity is followed by its two keys and does not count.
    let shell = &read.windows[0].projectiles[1].projectile;
    assert_eq!(frames(&shell.keys), [10, 16]);
}

#[test]
fn a_target_that_dies_becomes_no_target() {
    let mut scene = Scene::new(1000);
    scene.unit(1, 1, 0, 1000, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(2, 1, 0, 60, |_| At::place(300.0, 0.0, 100.0));
    // The recorder writes a target row only when the engine's answer changes,
    // and here it never says the weapon let go.
    scene.frame(30).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    let (_, read) = thin(&scene);
    let keys = &read.unit(0, 1).targets[0].keys;
    assert_eq!(frames(keys), [0, 30, 61]);
    assert_eq!(keys.iter().map(|k| k.kind).collect::<Vec<_>>(), [0, 1, 0]);
    // The second window does not hold unit 2, and the track still wrote:
    // nothing in it points at a unit that is not there.
    assert_eq!(read.windows[1].units.len(), 1);
    assert!(read.unit(1, 1).targets.is_empty());
}

#[test]
fn two_units_that_die_together_keep_their_targets_to_the_end() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 61, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(2, 1, 0, 61, |_| At::place(300.0, 0.0, 100.0));
    scene.frame(30).targets.push([1.0, 1.0, 1.0, 2.0, 0.0, 0.0]);
    scene.frame(30).targets.push([2.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    let (_, read) = thin(&scene);
    // Both are last alive on frame 61, and each still aims at the other then.
    for id in [1, 2] {
        let keys = &read.unit(0, id).targets[0].keys;
        assert_eq!(frames(keys), [0, 30]);
        assert_eq!(keys[1].kind, 1);
    }
}

#[test]
fn a_builder_stops_naming_a_unit_it_was_repairing_when_that_unit_dies() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    scene.unit(2, 1, 0, 60, |_| At::place(300.0, 0.0, 100.0));
    // Repairing unit 2 at two thirds of full build power.
    scene
        .frame(30)
        .work
        .push([1.0, 40.0, 2.0, 10.0 / 15.0, 0.0, 0.0, 0.0, 0.0]);
    let (_, read) = thin(&scene);
    let work = &read.unit(0, 1).targets[0];
    assert_eq!(work.weapon, 0);
    assert_eq!(frames(&work.keys), [0, 30, 61]);
    assert_eq!(
        work.keys
            .iter()
            .map(|k| (k.kind, k.build_power))
            .collect::<Vec<_>>(),
        [(0, 0), (16, 170), (0, 0)]
    );
}

#[test]
fn a_track_over_its_own_tolerance_is_refused_and_names_the_worst_offender() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |f| {
        At::place(100.0 + f as f32, 0.0, 100.0 + 3.0 * (f as f32 / 20.0).sin())
    });
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let loose = ThinOptions {
        tolerance: 4.0,
        ..ThinOptions::default()
    };
    let report = thin_dump(&dump, &track, &loose).unwrap();
    assert!(report.worst_error() > 0.5 && report.worst_error() <= 4.0);
    assert!(check_track(&dump, &track).is_ok());

    // The same track with a tolerance in its header that it does not keep.
    let mut bytes = std::fs::read(&track).unwrap();
    bytes[28..32].copy_from_slice(&0.5f32.to_le_bytes());
    std::fs::write(&track, bytes).unwrap();
    match check_track(&dump, &track) {
        Err(ThinError::OverTolerance { tolerance, worst }) => {
            assert_eq!(tolerance, 0.5);
            assert!(worst.error > 0.5);
            assert!(
                worst.what.contains("tank") && worst.what.contains("engine id 7"),
                "{}",
                worst.what
            );
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_game_named_in_the_options_is_the_game_the_track_says() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());

    // The dump says "Test Game 1.0", which is the game the recorder ran in. In
    // the app that is a generated game, not the one the replay was played on.
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    assert_eq!(read_track(&track).info.game, "Test Game 1.0");

    let named = ThinOptions {
        game: Some("Splinter Faction 0.1.86".into()),
        ..ThinOptions::default()
    };
    thin_dump(&dump, &track, &named).unwrap();
    assert_eq!(read_track(&track).info.game, "Splinter Faction 0.1.86");
}

#[test]
fn thinning_that_is_cancelled_stops_and_writes_no_track() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());

    let result = thin_dump_cancellable(&dump, &track, &ThinOptions::default(), &|| true);

    assert!(matches!(result, Err(ThinError::Cancelled)), "{result:?}");
    assert!(!track.exists());

    // Cancelled part way: the check is made as the dump is read, not once.
    let reads = std::cell::Cell::new(0);
    let result = thin_dump_cancellable(&dump, &track, &ThinOptions::default(), &|| {
        reads.set(reads.get() + 1);
        reads.get() > 100
    });
    assert!(matches!(result, Err(ThinError::Cancelled)), "{result:?}");
    assert!(!track.exists());
}

#[test]
fn thinning_that_is_not_cancelled_asks_and_finishes() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());

    let asked = std::cell::Cell::new(0);
    thin_dump_cancellable(&dump, &track, &ThinOptions::default(), &|| {
        asked.set(asked.get() + 1);
        false
    })
    .unwrap();

    assert!(asked.get() > 0);
    assert!(track.exists());
}

#[test]
fn a_turn_is_weighted_by_the_unit_radius() {
    let mut scene = Scene::new(300);
    scene.unit_defs[1].1 = 80.0;
    let turning = |f: u32| At::place(100.0, 0.0, 100.0).facing(0.3 * (f as f32 / 40.0).sin());
    scene.unit(1, 1, 0, 300, turning);
    scene.unit(2, 2, 0, 300, turning);
    let (report, read) = thin(&scene);
    // A point 10 elmos out moves 3 elmos over the whole swing, so the small
    // unit needs keys. A point 80 elmos out moves 24, and needs more.
    let small = read.unit(0, 1).transform.len();
    let large = read.unit(0, 2).transform.len();
    assert!(small >= 3, "{small}");
    assert!(large > small, "{large} against {small}");
    assert!(report.worst_error() <= 0.5);
    assert_eq!(report.weighting_length, 80.0);
    assert_eq!(report.header.rotation_bits, 12);
}

#[test]
fn the_rotation_width_follows_the_largest_radius_in_the_match() {
    let mut scene = Scene::new(30);
    scene.unit_defs[1].1 = 130.0;
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    let (report, _) = thin(&scene);
    // The tower is in the header and not in the match.
    assert_eq!(report.weighting_length, 10.0);
    assert_eq!(report.header.rotation_bits, 9);

    scene.unit(2, 2, 0, 30, |_| At::place(300.0, 0.0, 100.0));
    let (report, _) = thin(&scene);
    assert_eq!(report.weighting_length, 130.0);
    assert_eq!(report.header.rotation_bits, 13);
}

#[test]
fn a_unit_crossing_a_window_edge_reads_the_same_from_both_windows() {
    let mut scene = Scene::new(1800);
    scene.unit(7, 2, 0, 1800, |f| {
        let t = f as f32 / 60.0;
        At::place(1000.0 + 300.0 * t.sin(), 0.0, 1000.0 + 300.0 * t.cos()).facing(t)
    });
    let (report, read) = thin(&scene);
    assert_eq!(read.windows.len(), 2);
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
    let q = quantiser(&read);
    let before = transform_at(&read.unit(0, 7).transform, &q, 900).unwrap();
    let after = transform_at(&read.unit(1, 7).transform, &q, 900).unwrap();
    assert_eq!(before, after);
}

/// A sixteenth of a turn in the track's angle steps is 4,096.
const TURN: f64 = 65_536.0;

fn steps(radians: f32) -> f64 {
    radians as f64 / std::f64::consts::TAU * TURN
}

/// The pose track of the piece with this name, if the unit has one.
fn pose_track<'a>(
    read: &'a Read,
    unit: &'a coilbox_track::Unit,
    name: &str,
) -> Option<&'a coilbox_track::PoseTrack> {
    let names = &read
        .info
        .posed_pieces
        .iter()
        .find(|p| p.unit_def == unit.unit_def)?
        .pieces;
    unit.poses.iter().find(|p| names[p.piece as usize] == name)
}

#[test]
fn a_piece_that_holds_and_then_turns_keeps_the_moment_it_starts() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    // The recorder writes a piece when its matrix changes, so the turret and
    // the base above it have a row on the first frame, and the turret has
    // none after that until it starts to turn.
    let rows = |angle: f32| piece_rows(1, &[Set::default(), Set::turn(0.0, angle, 0.0)]);
    scene.frame(0).poses.extend(rows(0.0));
    for f in (153..=300).step_by(3) {
        scene.frame(f).poses.push(rows((f - 150) as f32 * 0.01)[0]);
    }
    let (report, read) = thin(&scene);
    let unit = read.unit(0, 1);
    // The base never left its rest pose, so it has no track.
    assert_eq!(unit.poses.len(), 1);
    assert_eq!(read.info.posed_pieces[0].pieces, ["turret", "base"]);
    let turret = pose_track(&read, unit, "turret").unwrap();
    assert_eq!(frames(&turret.keys), [0, 150, 300]);
    // The turret sits 5 elmos up in the model, which is where it rests.
    assert_eq!(turret.keys[1].offsets, [0, 0, 0]);
    assert_eq!(turret.keys[1].angles, [0, 0, 0]);
    let end = turret.keys[2].angles;
    assert_eq!((end[0], end[2]), (0, 0));
    assert!((end[1] as f64 - steps(1.5)).abs() <= 1.0, "{end:?}");
    assert_eq!(report.samples.poses, 52);
    assert_eq!(report.kept.pose, 3);
}

#[test]
fn a_barrel_that_stays_put_on_a_turning_turret_has_no_keys() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    // The turret swings. The barrel and the flare ride on it, so each has a
    // new matrix in the unit's model space on every sample.
    let rows = |f: u32| {
        let swing = 1.2 * (f as f32 / 25.0).sin();
        piece_rows(
            1,
            &[
                Set::default(),
                Set::turn(0.0, swing, 0.0),
                Set::default(),
                Set::default(),
            ],
        )
    };
    scene.frame(0).poses.extend(rows(0));
    for f in (3..=300).step_by(3) {
        // Every piece but the base, which did not move.
        scene.frame(f).poses.extend(&rows(f)[..3]);
    }
    let (report, read) = thin(&scene);
    let unit = read.unit(0, 1);
    assert!(pose_track(&read, unit, "turret").unwrap().keys.len() > 3);
    assert!(pose_track(&read, unit, "barrel").is_none());
    assert!(pose_track(&read, unit, "flare").is_none());
    assert_eq!(unit.poses.len(), 1);
    assert_eq!(report.kept.pose_tracks, 1);
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
}

#[test]
fn a_barrel_that_recoils_on_a_turned_turret_is_keyed_by_its_own_move() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    // The turret is turned and stays there. The barrel slides 2 elmos back
    // along its own length between frames 30 and 60, and is tipped up a
    // little all the while.
    let rows = |f: u32| {
        let back = -2.0 * (f.clamp(30, 60) - 30) as f32 / 30.0;
        piece_rows(
            1,
            &[
                Set::default(),
                Set::turn(0.0, 0.7, 0.0),
                Set {
                    turn: [-0.2, 0.0, 0.0],
                    moved: [0.0, 0.0, back],
                },
            ],
        )
    };
    scene.frame(0).poses.extend(rows(0));
    for f in (33..=60).step_by(3) {
        scene.frame(f).poses.push(rows(f)[0]);
    }
    let (_, read) = thin(&scene);
    let unit = read.unit(0, 1);
    let barrel = pose_track(&read, unit, "barrel").unwrap();
    assert_eq!(frames(&barrel.keys), [0, 30, 60]);
    // An eighth of an elmo to a step, so 2 elmos back is 16 steps.
    assert_eq!(
        barrel.keys.iter().map(|k| k.offsets).collect::<Vec<_>>(),
        [[0, 0, 0], [0, 0, 0], [0, 0, -16]]
    );
    for key in &barrel.keys {
        assert_eq!((key.angles[1], key.angles[2]), (0, 0));
        assert!((key.angles[0] as f64 - steps(-0.2)).abs() <= 1.0);
    }
    let turret = pose_track(&read, unit, "turret").unwrap();
    assert_eq!(frames(&turret.keys), [0]);
    assert_eq!(turret.keys[0].offsets, [0, 0, 0]);
}

#[test]
fn a_piece_that_spins_keeps_its_whole_turns() {
    let mut scene = Scene::new(300);
    scene.unit(1, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    // Two and a half turns at an even rate, a fortieth of a turn a sample.
    let rows = |f: u32| {
        let angle = std::f32::consts::TAU * f as f32 / 120.0;
        piece_rows(1, &[Set::default(), Set::turn(0.0, angle, 0.0)])
    };
    scene.frame(0).poses.extend(rows(0));
    for f in (3..=300).step_by(3) {
        scene.frame(f).poses.push(rows(f)[0]);
    }
    let (_, read) = thin(&scene);
    let unit = read.unit(0, 1);
    let turret = pose_track(&read, unit, "turret").unwrap();
    let last = turret.keys.last().unwrap();
    assert_eq!(last.frame, 300);
    assert!(
        (last.angles[1] as f64 - 2.5 * TURN).abs() <= 2.0,
        "{last:?}"
    );
    // Half way through it has made a turn and a quarter, and is not back
    // where it began.
    let q = quantiser(&read);
    let (angles, _) = coilbox_track::pose_at(&turret.keys, &q, 150).unwrap();
    assert!((angles[1] - 1.25 * TURN).abs() <= 2.0, "{angles:?}");
}

#[test]
fn a_piece_with_no_geometry_is_weighted_by_its_units_radius() {
    let mut scene = Scene::new(300);
    scene.unit_defs[1].1 = 85.0;
    for (unit, def) in [(1, 1), (2, 2)] {
        scene.unit(unit, def, 0, 300, |_| {
            At::place(100.0 * unit as f32, 0.0, 100.0)
        });
        // The flare swings on its own, with nothing below it to move.
        let rows = |f: u32| {
            let swing = 0.3 * (f as f32 / 40.0).sin();
            let mut set = [Set::default(); 4];
            set[3] = Set::turn(0.0, swing, 0.0);
            piece_rows(unit, &set)
        };
        scene.frame(0).poses.extend(rows(0));
        for f in (3..=300).step_by(3) {
            scene.frame(f).poses.push(rows(f)[0]);
        }
    }
    let (report, read) = thin(&scene);
    let keys = |id| {
        let unit = read.unit(0, id);
        pose_track(&read, unit, "flare").unwrap().keys.len()
    };
    // The tank's radius is 10 elmos and the tower's is 85.
    assert!(keys(1) >= 3, "{}", keys(1));
    assert!(keys(2) > keys(1), "{} against {}", keys(2), keys(1));
    assert!(report.worst_error() <= 0.5, "{}", report.worst_error());
}

#[test]
fn a_model_format_that_can_bake_a_rest_rotation_is_named() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    scene
        .frame(0)
        .poses
        .extend(piece_rows(1, &[Set::default(), Set::turn(0.0, 0.5, 0.0)]));
    let (report, _) = thin(&scene);
    assert!(report.unread_rest_rotations.is_empty());

    scene.model_type = "dae".into();
    let (report, _) = thin(&scene);
    // The tower has the same model and no posed piece.
    assert_eq!(report.unread_rest_rotations, ["tank"]);
}

#[test]
fn a_piece_posed_before_its_parent_is_refused() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    let rows = piece_rows(1, &[Set::default(), Set::default()]);
    // The turret alone, with no row for the base.
    scene.frame(0).poses.push(rows[0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let error = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(error.to_string().contains("its parent"), "{error}");
}

#[test]
fn terrain_rows_are_not_thinned() {
    let mut scene = Scene::new(1000);
    scene.unit(1, 1, 0, 1000, |_| At::place(100.0, 0.0, 100.0));
    scene.frame(5).terrain.push([3.0, 4.0, 10.0, 12.5]);
    scene.frame(6).terrain.push([3.0, 4.0, 12.5, 13.0]);
    scene.frame(905).terrain.push([3.0, 4.0, 13.0, 9.0]);
    scene.frame(905).terrain.push([7.0, 4.0, 20.0, 21.0]);
    let (report, read) = thin(&scene);
    assert_eq!(report.written.terrain_rows, 4);
    let rows: Vec<_> = read
        .terrain
        .iter()
        .flatten()
        .map(|r| (r.frame, r.x, r.z, r.before, r.after))
        .collect();
    assert_eq!(
        rows,
        [
            (5, 3, 4, 80, 100),
            (6, 3, 4, 100, 104),
            (905, 3, 4, 104, 72),
            (905, 7, 4, 160, 168)
        ]
    );
}

#[test]
fn features_are_listed_once_with_the_frames_they_exist_on() {
    let mut scene = Scene::new(100);
    scene.unit(1, 1, 0, 100, |_| At::place(100.0, 0.0, 100.0));
    let tree = [
        40.0, 1.0, -1.0, 10.0, 2.0, 30.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0,
    ];
    let wreck = [
        41.0, 2.0, 1.0, 50.0, 2.0, 60.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0,
    ];
    scene.frame(0).features_created.push(tree);
    scene.frame(20).features_created.push(wreck);
    scene.frame(51).features_destroyed.push(41.0);
    let (_, read) = thin(&scene);
    let listed: Vec<_> = read
        .features
        .iter()
        .map(|f| (f.engine_id, f.team, f.flags, f.first_frame, f.last_frame))
        .collect();
    assert_eq!(listed, [(40, 255, 3, 0, 100), (41, 1, 0, 20, 50)]);
    assert_eq!(read.info.feature_defs, ["tree", "wreck"]);
    assert_eq!(read.features[0].position, [80, 16, 240]);
}

#[test]
fn the_track_carries_what_the_dump_says_about_the_match() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    let (report, read) = thin(&scene);
    assert_eq!(read.info.engine_version, "2026.01.0 test");
    assert_eq!(read.info.game, "Test Game 1.0");
    assert_eq!(read.info.map, "Test Map");
    assert_eq!(read.info.map_size, [4096, 4096]);
    assert_eq!(read.info.teams.len(), 3);
    assert_eq!(read.info.teams[1].flags, 1);
    assert_eq!(read.info.teams[0].leader, "Ada");
    assert_eq!(read.header.sample_interval, 3);
    assert_eq!(read.header.frames_per_second, 30);
    assert_eq!((read.header.first_frame, read.header.last_frame), (0, 30));
    assert_eq!(read.header.tolerance, 0.5);
    assert_eq!(read.header.position_shift, 3);
    assert_eq!(read.header.velocity_shift, 11);
    assert_eq!(report.header, read.header);
}

#[test]
fn a_dump_with_no_end_block_is_refused() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    scene.ended = false;
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let error = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(error.to_string().contains("no end block"), "{error}");
    assert!(!track.exists());
}

#[test]
fn a_dump_with_no_unit_radii_is_refused() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    scene.radii = false;
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let error = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(error.to_string().contains("unitRadii"), "{error}");
}

#[test]
fn a_dump_whose_piece_trees_have_no_rest_offsets_is_refused() {
    let mut scene = Scene::new(30);
    scene.unit(1, 1, 0, 30, |_| At::place(100.0, 0.0, 100.0));
    scene.rest = false;
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let error = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(error.to_string().contains("offsets"), "{error}");
    assert!(!track.exists());
}
