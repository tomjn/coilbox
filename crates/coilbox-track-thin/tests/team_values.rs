//! What thinning keeps of each team's resources and of the rules parameters a
//! game's adapter names (issue #3982), on small matches written as dumps by the
//! test helper.

mod common;

use coilbox_track::{value_at, value_code, TrackReader, ValueTrack, NO_TEAM};
use coilbox_track_thin::{check_track, thin_dump, ThinError, ThinOptions, ThinReport};
use common::*;

fn thin(scene: &Scene) -> (ThinReport, Read) {
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let report = thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    (report, read_track(&track))
}

/// The track of one number in window `k`, if the window has it.
fn value(read: &Read, k: usize, team: u8, code: u16) -> Option<&ValueTrack> {
    read.windows[k]
        .values
        .iter()
        .find(|v| v.team == team && v.code == code)
}

fn at(read: &Read, k: usize, team: u8, code: u16, frame: u32) -> f64 {
    value_at(&value(read, k, team, code).expect("a track").keys, frame).unwrap()
}

const METAL: u16 = value_code::HELD;
const ENERGY: u16 = value_code::ENERGY + value_code::HELD;

#[test]
fn what_a_team_holds_that_rises_at_an_even_rate_keeps_its_two_ends() {
    let mut scene = Scene::new(300);
    for f in 0..=300 {
        scene.held(f, 0, 100.0 + f as f32, 500.0);
    }
    let (report, read) = thin(&scene);

    assert_eq!(frames(&value(&read, 0, 0, METAL).unwrap().keys), [0, 300]);
    // Energy never changed, and a curve holds its one key's value.
    assert_eq!(frames(&value(&read, 0, 0, ENERGY).unwrap().keys), [0]);
    assert_eq!(at(&read, 0, 0, METAL, 150), 250.0);
    assert_eq!(at(&read, 0, 0, ENERGY, 299), 500.0);
    // Two numbers for each of 301 frames for the team that has any, and all
    // eighteen for all three teams are measured, since nothing is still 0.
    assert_eq!(report.samples.values, 3 * 18 * 301);
    assert_eq!(report.kept.value_tracks, 2);
    assert_eq!(report.kept.value, 3);
    // A straight line through whole numbers, to within a float's rounding.
    assert!(report.worst.value.as_ref().unwrap().error < 1e-9);
    assert_eq!(read.header.value_tolerance, 0.5);
    assert_eq!(read.header.value_fraction, 1.0 / 1024.0);
}

/// A sample may be the resource tolerance from the track, or the resource
/// fraction of its own size when that is more, so a team with a great deal of
/// energy keeps fewer keys than one with a little that wobbles as much.
#[test]
fn a_large_amount_is_allowed_to_be_further_from_the_track_than_a_small_one() {
    let wobble = |f: u32| [0.0, 2.0, -2.0, 1.0][f as usize % 4];
    let mut scene = Scene::new(300);
    for f in 0..=300 {
        // Two units either way is under a 1,024th of 8,000 and well over half
        // a unit, which is all 100 is allowed.
        scene.held(f, 0, 100.0 + wobble(f), 8000.0 + wobble(f));
    }
    let (report, read) = thin(&scene);

    let small = value(&read, 0, 0, METAL).unwrap().keys.len();
    let large = value(&read, 0, 0, ENERGY).unwrap().keys.len();
    assert!(small > 200, "{small}");
    assert!(large <= 2, "{large}");
    let worst = report.worst.value.as_ref().unwrap();
    assert!(worst.error > 0.5 && worst.error <= report.worst.value_allowed);
    assert!(report.worst.value_allowed <= 8002.0 / 1024.0);
    for f in [0u32, 1, 2, 150, 299] {
        let got = at(&read, 0, 0, ENERGY, f);
        let recorded = 8000.0 + wobble(f) as f64;
        assert!(
            (got - recorded).abs() <= read.header.value_allowance(recorded),
            "frame {f}: {got} against {recorded}"
        );
    }
}

#[test]
fn a_team_that_never_has_anything_has_no_tracks() {
    let mut scene = Scene::new(300);
    scene.held(0, 0, 100.0, 0.0);
    let (_, read) = thin(&scene);

    let teams: Vec<(u8, u16)> = read.windows[0]
        .values
        .iter()
        .map(|v| (v.team, v.code))
        .collect();
    // Team 0's metal, and nothing of its energy or of teams 1 and 2.
    assert_eq!(teams, [(0, METAL)]);
}

#[test]
fn what_a_team_holds_is_within_the_resource_tolerance_on_every_frame() {
    // Income in lumps, as units make it: a step every 15 frames, and spending
    // on every frame from frame 200.
    let held = |f: u32| {
        let made = (f / 15) as f32 * 4.5;
        let spent = f.saturating_sub(200) as f32 * 0.35;
        1000.0 + made - spent
    };
    let mut scene = Scene::new(2000);
    for f in 0..=2000 {
        scene.held(f, 0, held(f), 0.0);
    }
    let (report, read) = thin(&scene);

    let worst = report.worst.value.as_ref().unwrap();
    assert!(worst.error <= report.worst.value_allowed, "{worst}");
    assert!(worst.error > 0.0, "nothing was thinned");
    for f in [0u32, 14, 15, 16, 200, 899, 900, 901, 1337, 2000] {
        let k = ((f / 900) as usize).min(read.windows.len() - 1);
        let got = at(&read, k, 0, METAL, f);
        let recorded = held(f) as f64;
        assert!(
            (got - recorded).abs() <= read.header.value_allowance(recorded),
            "frame {f}: {got} against {recorded}"
        );
    }
    // A frame on the edge between two windows reads the same from both.
    assert_eq!(at(&read, 0, 0, METAL, 900), at(&read, 1, 0, METAL, 900));
}

#[test]
fn a_drop_in_one_frame_keeps_the_frame_before_it() {
    let mut scene = Scene::new(300);
    scene.held(0, 0, 1028.0, 0.0);
    scene.held(150, 0, 87.0, 0.0);
    let (_, read) = thin(&scene);

    assert_eq!(
        frames(&value(&read, 0, 0, METAL).unwrap().keys),
        [0, 149, 150]
    );
    assert_eq!(at(&read, 0, 0, METAL, 149), 1028.0);
    assert_eq!(at(&read, 0, 0, METAL, 150), 87.0);
}

#[test]
fn storage_and_the_share_level_are_kept_exactly() {
    let mut scene = Scene::new(300);
    // Storage, pull, income, expense, share, sent, received, excess.
    scene.economy(
        0,
        0,
        [1000.0, 0.0, 0.0, 0.0, 0.99, 0.0, 0.0, 0.0],
        [2000.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0],
    );
    scene.economy(
        100,
        0,
        [1000.25, 0.0, 0.0, 0.0, 0.75, 0.0, 0.0, 0.0],
        [2000.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0],
    );
    let (report, read) = thin(&scene);

    // A quarter of a unit of storage and a quarter of the share level are both
    // under the resource tolerance, and both are kept.
    for (code, before, after) in [
        (value_code::STORAGE, 1000.0, 1000.25),
        (value_code::SHARE, 0.99f32 as f64, 0.75),
    ] {
        assert_eq!(at(&read, 0, 0, code, 99), before, "code {code}");
        assert_eq!(at(&read, 0, 0, code, 100), after, "code {code}");
    }
    assert_eq!(
        at(&read, 0, 0, value_code::ENERGY + value_code::SHARE, 300),
        0.5
    );
    // Exact numbers are checked for being exact and are not in the worst.
    assert!(report.worst.value.is_none() || report.worst.value.unwrap().error == 0.0);
}

#[test]
fn income_that_wanders_under_the_tolerance_from_one_second_to_the_next_is_not_keyed() {
    let mut scene = Scene::new(900);
    for period in 0..=30u32 {
        // Wind, say: a little more and a little less around 100.
        let income = 100.0 + [0.0, 0.2, -0.2, 0.1][period as usize % 4];
        scene.economy(
            period * 30,
            0,
            [0.0; 8],
            [5000.0, 0.0, income, 0.0, 0.0, 0.0, 0.0, 0.0],
        );
    }
    let (report, read) = thin(&scene);

    let income = value(&read, 0, 0, value_code::ENERGY + value_code::INCOME).unwrap();
    assert!(income.keys.len() <= 2, "{:?}", frames(&income.keys));
    assert!(report.worst.value.unwrap().error <= 0.5);
}

/// The frames and values of the real match that found a fault: Splinter
/// Faction's `supplyUsed` is first set part way through a window, and its value
/// at the next window's first frame is the same as the first key inside that
/// window.
#[test]
fn a_rules_parameter_is_kept_exactly_and_has_no_value_before_it_is_first_set() {
    let mut scene = Scene::new(7300);
    scene.params = Some((
        vec!["supplyUsed".into(), "researchPoints".into()],
        vec!["wave".into()],
    ));
    scene.frame(5507).team_params.push([0.0, 1.0, 0.0]);
    scene.frame(6160).team_params.push([0.0, 1.0, 1.0]);
    scene.frame(6488).team_params.push([0.0, 1.0, 2.0]);
    scene.frame(0).team_params.push([1.0, 2.0, 216.5]);
    scene.frame(7000).game_params.push([1.0, 4.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    let read = read_track(&track);

    assert_eq!(read.info.team_params, ["supplyUsed", "researchPoints"]);
    assert_eq!(read.info.game_params, ["wave"]);
    let supply = value_code::PARAMETER;
    // Windows are 900 frames, so frame 5507 is in window 6 and 6300 starts 7.
    assert!(value(&read, 5, 0, supply).is_none(), "not set yet");
    assert_eq!(value(&read, 6, 0, supply).unwrap().keys[0].frame, 5507);
    assert_eq!(value(&read, 7, 0, supply).unwrap().keys[0].frame, 6300);
    assert_eq!(at(&read, 7, 0, supply, 6300), 1.0);
    assert_eq!(at(&read, 7, 0, supply, 6487), 1.0);
    assert_eq!(at(&read, 7, 0, supply, 6488), 2.0);

    // What a reader gives at a frame: nothing before the first set.
    let mut reader = TrackReader::open(std::fs::File::open(&track).unwrap()).unwrap();
    let mut seen = |frame: u32, team: u8, code: u16| {
        reader
            .sample(frame)
            .unwrap()
            .values
            .into_iter()
            .find(|v| v.team == team && v.code == code)
            .map(|v| v.value)
    };
    assert_eq!(seen(5506, 0, supply), None);
    assert_eq!(seen(5507, 0, supply), Some(0.0));
    assert_eq!(seen(6160, 0, supply), Some(1.0));
    assert_eq!(seen(7300, 0, supply), Some(2.0));
    assert_eq!(seen(3000, 1, supply + 1), Some(216.5));
    assert_eq!(seen(6999, NO_TEAM, supply), None);
    assert_eq!(seen(7000, NO_TEAM, supply), Some(4.0));
}

#[test]
fn a_rules_parameter_the_dumps_header_does_not_name_is_refused() {
    let mut scene = Scene::new(300);
    scene.params = Some((vec!["supplyUsed".into()], vec![]));
    scene.frame(10).team_params.push([0.0, 2.0, 5.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());

    let err = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(err.to_string().contains("rules parameter 2"), "{err}");
    assert!(!track.exists());
}

#[test]
fn resources_of_a_team_the_dumps_header_does_not_list_are_refused() {
    let mut scene = Scene::new(300);
    scene.held(0, 9, 100.0, 0.0);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());

    let err = thin_dump(&dump, &track, &ThinOptions::default()).unwrap_err();
    assert!(err.to_string().contains("team 9"), "{err}");
}

#[test]
fn a_number_that_is_not_one_is_taken_as_nothing() {
    let mut scene = Scene::new(300);
    scene.held(0, 0, 100.0, 50.0);
    scene.held(100, 0, f32::INFINITY, f32::NAN);
    scene.held(200, 0, 100.0, 50.0);
    let (_, read) = thin(&scene);

    assert_eq!(at(&read, 0, 0, METAL, 150), 0.0);
    assert_eq!(at(&read, 0, 0, ENERGY, 150), 0.0);
    assert_eq!(at(&read, 0, 0, METAL, 250), 100.0);
}

/// A dump made before the recorder wrote team resources has no rows and no
/// lists of parameters. It thins as it did, into a track with none.
#[test]
fn a_dump_with_no_team_resources_makes_a_track_with_none() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 0, 300, |_| At::place(100.0, 0.0, 100.0));
    let (report, read) = thin(&scene);

    assert!(read.windows[0].values.is_empty());
    assert!(read.info.team_params.is_empty() && read.info.game_params.is_empty());
    assert_eq!(report.kept.value_tracks, 0);
    assert_eq!(report.written.value, 0);
}

#[test]
fn a_track_over_its_own_resource_tolerance_is_refused_and_names_the_number() {
    let mut scene = Scene::new(300);
    for f in 0..=300 {
        scene.held(f, 1, 100.0 + 3.0 * (f as f32 / 20.0).sin(), 0.0);
    }
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    let loose = ThinOptions {
        value_tolerance: 4.0,
        ..ThinOptions::default()
    };
    let report = thin_dump(&dump, &track, &loose).unwrap();
    let worst = report.worst.value.unwrap().error;
    assert!(worst > 0.5 && worst <= 4.0, "{worst}");
    assert!(check_track(&dump, &track).is_ok());

    // The same track with a resource tolerance in its header that it does not
    // keep. It is the float at byte 80.
    let mut bytes = std::fs::read(&track).unwrap();
    assert_eq!(bytes[80..84], 4.0f32.to_le_bytes());
    bytes[80..84].copy_from_slice(&0.5f32.to_le_bytes());
    std::fs::write(&track, bytes).unwrap();
    match check_track(&dump, &track) {
        Err(ThinError::OverTolerance { tolerance, worst }) => {
            assert_eq!(tolerance, 0.5);
            assert!(worst.what.contains("team 1"), "{}", worst.what);
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}
