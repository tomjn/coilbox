//! Makes a track with a crowd in it, for timing how the rewind player settles
//! a seek that has to create hundreds of units at once (issue #3988).
//!
//! No real replay on a machine without Beyond All Reason has that many units
//! at once, so this builds one from a real track. It keeps the real track's
//! info (game, map, unit definitions, teams), its features and its terrain,
//! drops the projectiles and replaces the units. The new units use the real
//! unit definitions the match used, in turn, and stand still where real units
//! of the match stood, spread in rings round those places at the same height.
//! Half of them exist from 300 frames in to the last frame and half from the
//! middle of the match. None exists at the first frame, so a seek from the
//! start to the end creates all of them, the first time of each definition
//! included, and a seek back removes all of them.
//!
//! ```sh
//! COILBOX_CROWD_SOURCE=whole-match.cbtrack COILBOX_CROWD_OUT=crowd.cbtrack \
//!   COILBOX_CROWD_UNITS=400 \
//!   cargo test -p coilbox-track --test crowd -- --ignored --nocapture
//! ```

use coilbox_track::*;
use std::collections::BTreeSet;
use std::io::Cursor;

#[test]
#[ignore = "needs a real track in COILBOX_CROWD_SOURCE and writes COILBOX_CROWD_OUT"]
fn a_crowd_of_real_definitions_is_written() {
    let (Ok(source), Ok(out)) = (
        std::env::var("COILBOX_CROWD_SOURCE"),
        std::env::var("COILBOX_CROWD_OUT"),
    ) else {
        eprintln!("did nothing: set COILBOX_CROWD_SOURCE and COILBOX_CROWD_OUT");
        return;
    };
    let count: u32 = std::env::var("COILBOX_CROWD_UNITS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(400);

    let mut reader = TrackReader::open(Cursor::new(std::fs::read(source).unwrap())).unwrap();
    let h = reader.header().clone();
    let q = reader.quantiser().unwrap();
    let info = reader.info().unwrap();
    let features = reader.features().unwrap();

    // The places real units stood and the definitions and teams they had, from
    // a look at the match every 150 frames.
    let mut places: Vec<[f64; 3]> = vec![];
    let mut defs = BTreeSet::new();
    let mut teams = BTreeSet::new();
    let mut frame = h.first_frame;
    while frame <= h.last_frame {
        for unit in reader.sample(frame).unwrap().units {
            defs.insert(unit.unit_def);
            teams.insert(unit.team);
            if !places
                .iter()
                .any(|p| (p[0] - unit.position[0]).hypot(p[2] - unit.position[2]) < 200.0)
            {
                places.push(unit.position);
            }
        }
        frame += 150;
    }
    let defs: Vec<u16> = defs.into_iter().collect();
    let teams: Vec<u8> = teams.into_iter().collect();
    assert!(!places.is_empty() && !defs.is_empty(), "the source has no units");

    let mut track = Track::new(Settings {
        recorder_version: h.recorder_version,
        frames_per_second: h.frames_per_second,
        first_frame: h.first_frame,
        last_frame: h.last_frame,
        window_length: h.window_length,
        tolerance: h.tolerance,
        position_shift: h.position_shift,
        velocity_shift: h.velocity_shift,
        rotation_bits: h.rotation_bits,
        sample_interval: h.sample_interval,
        game_id: h.game_id,
    });
    track.info = info;
    track.info.writer = "coilbox-track tests crowd".into();
    track.features = features;
    for k in 0..h.window_count as usize {
        track.terrain.extend(reader.terrain(k).unwrap());
    }

    let middle = h.first_frame + (h.last_frame - h.first_frame) / 2;
    let rotation = q.rotation([0.0, 0.0, 0.0, 1.0]);
    for serial in 0..count {
        let n = serial as usize;
        let place = places[n % places.len()];
        // Rings of eight round each place, 40 elmos further out each time.
        let ring = (n / places.len()) / 8 + 1;
        let angle = ((n / places.len()) % 8) as f64 * std::f64::consts::FRAC_PI_4;
        let at = [
            place[0] + angle.cos() * 40.0 * ring as f64,
            place[1],
            place[2] + angle.sin() * 40.0 * ring as f64,
        ];
        let first = if serial % 2 == 0 {
            h.first_frame + 300
        } else {
            middle
        };
        let position = at.map(|v| q.position(v).unwrap());
        track.units.push(Unit {
            engine_id: serial as u16 + 1,
            serial,
            unit_def: defs[n % defs.len()],
            team: teams[n % teams.len()],
            first_frame: first,
            last_frame: h.last_frame,
            transform: vec![
                TransformKey {
                    frame: first,
                    position,
                    rotation,
                },
                TransformKey {
                    frame: h.last_frame,
                    position,
                    rotation,
                },
            ],
            status: vec![StatusKey {
                frame: first,
                health: 65535,
                build_progress: 65535,
                flags: 1,
            }],
            targets: vec![],
            poses: vec![],
            queue: vec![],
        });
    }
    let bytes = track.to_bytes().unwrap();
    std::fs::write(&out, &bytes).unwrap();
    eprintln!(
        "crowd: {count} units of {} definitions on {} teams, {} places, {} bytes",
        defs.len(),
        teams.len(),
        places.len(),
        bytes.len()
    );
}
