//! A unit that changes team during a match: given to an ally or captured
//! (issue #3948). Neither benchmark recording has a units given row, so the
//! dumps here are built by hand.

mod common;

use coilbox_track::TrackReader;
use coilbox_track_thin::{check_track, thin_dump, ThinError, ThinOptions};
use common::*;

/// A tank that stands for 2,000 frames, which is three windows of 900.
fn standing_tank() -> Scene {
    let mut scene = Scene::new(2000);
    scene.unit(7, 1, 0, 2000, |_| At::place(100.0, 50.0, 100.0));
    scene
}

/// The team a reader of the whole track gives unit 7 at each frame.
fn teams_at(track: &std::path::Path, frames: &[u32]) -> Vec<u8> {
    let mut reader = TrackReader::open(std::fs::File::open(track).unwrap()).unwrap();
    frames
        .iter()
        .map(|f| {
            let state = reader.sample(*f).unwrap();
            let unit = state.units.iter().find(|u| u.engine_id == 7).unwrap();
            unit.team
        })
        .collect()
}

#[test]
fn a_unit_given_to_another_team_has_the_first_team_before_and_the_second_after() {
    let mut scene = standing_tank();
    // Given to team 1 part way through window 1, and back to team 0 later in
    // the same window.
    scene.frame(1200).given.push([7.0, 1.0]);
    scene.frame(1650).given.push([7.0, 0.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();

    assert_eq!(
        teams_at(&track, &[0, 900, 1199, 1200, 1500, 1649, 1650, 1800, 2000]),
        [0, 0, 0, 1, 1, 1, 0, 0, 0]
    );

    let read = read_track(&track);
    let before = read.unit(0, 7);
    assert_eq!((before.team, before.teams.len()), (0, 0));
    let during = read.unit(1, 7);
    assert_eq!(during.team, 0);
    assert_eq!(frames(&during.teams), [1200, 1650]);
    assert_eq!(
        during.teams.iter().map(|k| k.team).collect::<Vec<_>>(),
        [1, 0]
    );
}

#[test]
fn a_window_that_starts_after_a_change_has_the_new_team_and_no_key() {
    let mut scene = standing_tank();
    scene.frame(600).given.push([7.0, 1.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();

    let read = read_track(&track);
    assert_eq!(frames(&read.unit(0, 7).teams), [600]);
    for k in [1, 2] {
        let unit = read.unit(k, 7);
        assert_eq!((unit.team, unit.teams.len()), (1, 0), "window {k}");
    }
    assert_eq!(teams_at(&track, &[599, 600, 2000]), [0, 1, 1]);
}

#[test]
fn a_unit_given_on_the_frame_it_is_made_is_on_the_new_team_from_its_first() {
    let mut scene = Scene::new(300);
    scene.unit(7, 1, 30, 300, |_| At::place(100.0, 50.0, 100.0));
    scene.frame(30).given.push([7.0, 1.0]);
    // A row that names the team the unit is already on changes nothing.
    scene.frame(90).given.push([7.0, 1.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();

    let read = read_track(&track);
    let unit = read.unit(0, 7);
    assert_eq!((unit.team, unit.teams.len()), (1, 0));
}

#[test]
fn a_given_row_for_a_unit_the_dump_does_not_know_is_ignored() {
    let mut scene = standing_tank();
    scene.frame(300).given.push([8.0, 1.0]);
    let dir = tempfile::tempdir().unwrap();
    let (dump, track) = scene.write(dir.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    assert_eq!(teams_at(&track, &[0, 2000]), [0, 0]);
}

#[test]
fn the_check_after_thinning_compares_the_team_at_every_sample() {
    // A track made from a dump with no change of team, checked against one
    // with a change part way through.
    let first = tempfile::tempdir().unwrap();
    let (dump, track) = standing_tank().write(first.path());
    thin_dump(&dump, &track, &ThinOptions::default()).unwrap();
    assert!(check_track(&dump, &track).is_ok());

    let mut given = standing_tank();
    given.frame(1200).given.push([7.0, 1.0]);
    let second = tempfile::tempdir().unwrap();
    let (given_dump, _) = given.write(second.path());
    match check_track(&given_dump, &track) {
        Err(ThinError::Mismatch(reason)) => {
            assert!(
                reason.contains("frame 1200")
                    && reason.contains("on team 0 in window 1 and on team 1 in the dump"),
                "{reason}"
            );
        }
        other => panic!("expected a mismatch, got {other:?}"),
    }
}
