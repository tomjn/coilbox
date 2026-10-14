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
//! `COILBOX_CROWD_DEFS` is a list of unit definition names, with commas between
//! them, to give the definitions the crowd uses instead of the match's own, in
//! turn. That makes a crowd for another game than the one the match was played
//! on, whose units the match's names do not exist in (issue #4009).
//!
//! `COILBOX_CROWD_POSES` gives the crowd aim poses, which it has none of
//! without it (issue #3796). `track` poses the pieces the source track names
//! for each definition. Anything else is a list for another game, of a
//! definition name, a colon and its piece names with `+` between them, with
//! commas between the definitions: `armpw:torso,armstump:turret+sleeve`. Every
//! posed piece of every unit turns about its y axis, a quarter turn to either
//! side of where it started, with a key every 30 frames, so a frame between two
//! keys is a blend of them as it is in a recorded match.
//!
//! `COILBOX_CROWD_WOUNDED` is a number `n`. Every `n`th unit then has half its
//! health, where without it every unit is whole (issue #4002).
//!
//! `COILBOX_CROWD_WALK` is a distance in elmos. Every unit then walks that far
//! out from its place, away from the place its ring is round, over 90 frames,
//! stands for 90, walks back over 90 facing the same way, and stands for 90,
//! for the whole match (issue #3797). Walking back it moves against the way it
//! faces, which the engine calls reversing.
//!
//! `COILBOX_CROWD_BUILD` is a unit definition name. Every unit of that
//! definition then builds the unit two after it in the crowd for 120 frames
//! and does nothing for 120, for the whole match (issue #3797). The two exist
//! over the same frames, so the one it builds is always there.
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
    assert!(
        !places.is_empty() && !defs.is_empty(),
        "the source has no units"
    );

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
        // The crowd has no team's numbers, and keeps what the source says of
        // how close they would be.
        value_tolerance: h.value_tolerance,
        value_fraction: h.value_fraction,
    });
    track.info = info;
    track.info.writer = "coilbox-track tests crowd".into();
    if let Ok(names) = std::env::var("COILBOX_CROWD_DEFS") {
        let names: Vec<&str> = names.split(',').filter(|n| !n.is_empty()).collect();
        assert!(!names.is_empty(), "COILBOX_CROWD_DEFS names no definition");
        for (n, def) in defs.iter().enumerate() {
            track.info.unit_defs[*def as usize] = names[n % names.len()].to_string();
        }
    }
    // How many posed pieces each definition of the crowd has.
    let posed = std::env::var("COILBOX_CROWD_POSES").unwrap_or_default();
    if posed.is_empty() {
        track.info.posed_pieces.clear();
    } else if posed != "track" {
        track.info.posed_pieces.clear();
        for entry in posed.split(',').filter(|e| !e.is_empty()) {
            let (name, pieces) = entry
                .split_once(':')
                .expect("COILBOX_CROWD_POSES is name:piece+piece,name:piece");
            // `COILBOX_CROWD_DEFS` can give several definitions one name.
            let named: Vec<usize> = (0..track.info.unit_defs.len())
                .filter(|d| track.info.unit_defs[*d] == name)
                .collect();
            assert!(
                !named.is_empty(),
                "the crowd has no definition called {name}"
            );
            for unit_def in named {
                track.info.posed_pieces.push(PosedPieces {
                    unit_def: unit_def as u16,
                    pieces: pieces.split('+').map(str::to_string).collect(),
                });
            }
        }
    }
    let pieces_of = |def: u16| {
        track
            .info
            .posed_pieces
            .iter()
            .find(|p| p.unit_def == def)
            .map_or(0, |p| p.pieces.len())
    };
    let wounded: u32 = std::env::var("COILBOX_CROWD_WOUNDED")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let walk: f64 = std::env::var("COILBOX_CROWD_WALK")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    let builder = std::env::var("COILBOX_CROWD_BUILD").unwrap_or_default();
    let builds = |def: u16| !builder.is_empty() && track.info.unit_defs[def as usize] == builder;
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
        // Out along the line from the place to the ring, and back.
        let away = [
            at[0] + angle.cos() * walk,
            at[1],
            at[2] + angle.sin() * walk,
        ]
        .map(|v| q.position(v).unwrap());
        let mut transform = vec![TransformKey {
            frame: first,
            position,
            rotation,
        }];
        if walk > 0.0 {
            let mut frame = first;
            while frame + 360 <= h.last_frame {
                for (after, at) in [(90, away), (180, away), (270, position), (360, position)] {
                    transform.push(TransformKey {
                        frame: frame + after,
                        position: at,
                        rotation,
                    });
                }
                frame += 360;
            }
        }
        if transform.last().unwrap().frame < h.last_frame {
            let last = transform.last().unwrap().position;
            transform.push(TransformKey {
                frame: h.last_frame,
                position: last,
                rotation,
            });
        }
        let unit_def = defs[n % defs.len()];
        let mut targets = vec![];
        if builds(unit_def) && serial + 2 < count {
            let keys = (first..h.last_frame)
                .step_by(120)
                .enumerate()
                .map(|(k, frame)| TargetKey {
                    frame,
                    kind: if k % 2 == 0 { 16 } else { 0 },
                    reference: if k % 2 == 0 { serial + 2 } else { 0 },
                    build_power: if k % 2 == 0 { 255 } else { 0 },
                    position: [0, 0, 0],
                })
                .collect();
            targets.push(TargetTrack { weapon: 0, keys });
        }
        // Each piece swings a quarter turn to either side of an angle of the
        // unit's own, over 240 frames, so no two units point the same way.
        let quarter = ANGLE_UNITS_PER_TURN / 4;
        let poses = (0..pieces_of(unit_def))
            .map(|piece| PoseTrack {
                piece: piece as u16,
                keys: (first..=h.last_frame)
                    .step_by(30)
                    .map(|frame| {
                        let step = ((frame - first) / 30 + serial + piece as u32) % 8;
                        let swing = [0, 1, 2, 1, 0, -1, -2, -1][step as usize] * quarter / 2;
                        PoseKey {
                            frame,
                            angles: [0, (serial as i32 * 4099) % ANGLE_UNITS_PER_TURN + swing, 0],
                            offsets: [0, 0, 0],
                        }
                    })
                    .collect(),
            })
            .collect();
        let health = if wounded > 0 && serial % wounded == 0 {
            32768
        } else {
            65535
        };
        track.units.push(Unit {
            engine_id: serial as u16 + 1,
            serial,
            unit_def,
            team: teams[n % teams.len()],
            first_frame: first,
            last_frame: h.last_frame,
            transform,
            status: vec![StatusKey {
                frame: first,
                health,
                build_progress: 65535,
                flags: 1,
            }],
            targets,
            poses,
            queue: vec![],
        });
    }
    if std::env::var("COILBOX_CROWD_SHARING").is_ok() {
        add_sharing(&mut track, h.first_frame, h.last_frame);
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

/// Gives every team of the track storage, what it holds and a share level, and
/// has the teams send metal and energy round in a ring, each to the next, with
/// a different amount before and after the middle of the match. What each
/// team received is what the one before it sent, as in a real match. A real
/// replay without sharing in it cannot show the sent and received of a team in
/// an engine (issue #4011), and a team that both sends and receives is the
/// hard case.
fn add_sharing(track: &mut Track, first: u32, last: u32) {
    let teams: Vec<u8> = track.info.teams.iter().map(|t| t.id).collect();
    assert!(teams.len() >= 2, "sharing needs two teams");
    let middle = first + (last - first) / 2;
    let energy = value_code::ENERGY;
    let mut put = |team: u8, code: u16, early: f32, late: f32| {
        track.values.retain(|v| !(v.team == team && v.code == code));
        track.values.push(ValueTrack {
            team,
            code,
            keys: vec![
                ValueKey::new(first, early),
                ValueKey::new(middle, early),
                ValueKey::new(middle + 1, late),
                ValueKey::new(last, late),
            ],
        });
    };
    for (n, team) in teams.iter().enumerate() {
        let b = ((n + teams.len() - 1) % teams.len()) as f32;
        let n = n as f32;
        for (base, scale) in [(0, 1.0), (energy, 10.0)] {
            put(*team, base + value_code::STORAGE, 5000.0, 5000.0);
            put(*team, base + value_code::HELD, 2000.0, 1500.0);
            put(*team, base + value_code::SHARE, 0.9, 0.9);
            put(
                *team,
                base + value_code::SENT,
                scale * (20.0 + 5.0 * n),
                scale * (8.0 + 2.0 * n),
            );
            put(
                *team,
                base + value_code::RECEIVED,
                scale * (20.0 + 5.0 * b),
                scale * (8.0 + 2.0 * b),
            );
        }
    }
    eprintln!("sharing: {} teams send round in a ring", teams.len());
}
