//! The fixture the Lua reader in `lua/rewind-player` is tested against: a small
//! track, and the values this crate's reader gives for it.
//!
//! The track is built from a seed, and `expected.lua` is written from what
//! `TrackReader` reads back from the committed file. This test fails when the
//! committed track no longer holds what the seed builds, or when `expected.lua`
//! no longer says what the Rust reader gives, so the Lua suite cannot be
//! checking values that have drifted from this crate.
//!
//! To rewrite both files after a change to the writer or the reader:
//!
//! ```sh
//! COILBOX_UPDATE_LUA_FIXTURE=1 cargo test -p coilbox-track --test lua_fixture
//! ```

mod common;

use coilbox_track::*;
use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::io::Cursor;
use std::path::PathBuf;

const SEED: u64 = 3792;
/// Four windows of 600 frames, a little more than the 1,800 frames of a minute.
const WINDOWS: u32 = 4;
const WINDOW_LENGTH: u32 = 600;
const UNITS: usize = 5;
/// Frames between two sampled frames, away from the edges.
const STRIDE: u32 = 211;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lua/rewind-player/tests/fixtures")
}

fn built() -> Track {
    common::random_track(SEED, WINDOWS, WINDOW_LENGTH, UNITS)
}

fn num(v: f64) -> String {
    format!("{v:?}")
}

fn list(values: &[f64]) -> String {
    let parts: Vec<String> = values.iter().map(|v| num(*v)).collect();
    format!("{{{}}}", parts.join(", "))
}

fn strings(values: &[String]) -> String {
    let parts: Vec<String> = values.iter().map(|v| format!("{v:?}")).collect();
    format!("{{{}}}", parts.join(", "))
}

/// The frames to sample: a stride across the match, then the places a reader
/// could be wrong, which are the window edges and a unit or projectile
/// appearing or going.
fn frames_to_sample(reader: &mut TrackReader<Cursor<Vec<u8>>>) -> BTreeSet<u32> {
    let h = reader.header().clone();
    let mut frames = BTreeSet::new();
    let mut f = h.first_frame;
    while f <= h.last_frame {
        frames.insert(f);
        f += STRIDE;
    }
    frames.insert(h.last_frame);
    for k in 0..h.window_count {
        let (start, end) = h.window_bounds(k);
        let w = reader.window(k as usize).unwrap();
        // Each side of a window edge, and the frames a unit is first and last
        // there. A projectile's edges are the same rule and add little.
        let mut edges = vec![
            start.saturating_sub(1),
            start,
            start + 1,
            end - 1,
            end,
            end + 1,
        ];
        for u in &w.units {
            edges.push(u.unit.first_frame);
            edges.push(u.unit.last_frame + 1);
        }
        for p in w.projectiles.iter().take(2) {
            edges.push(p.projectile.first_frame);
            edges.push(p.projectile.last_frame);
        }
        for e in edges {
            if e >= h.first_frame && e <= h.last_frame {
                frames.insert(e);
            }
        }
    }
    frames
}

/// The lua index of what a target key refers to. A unit, a projectile or a
/// feature is counted from 1 there, and 0 stands for none.
fn lua_reference(kind: u8, reference: u32) -> u32 {
    match kind {
        1 | 2 | 4 | 16 | 17 | 18 | 19 | 20 => reference + 1,
        _ => 0,
    }
}

fn expected_lua(bytes: &[u8]) -> String {
    let mut reader = TrackReader::open(Cursor::new(bytes.to_vec())).unwrap();
    let h = reader.header().clone();
    let q = reader.quantiser().unwrap();
    let info = reader.info().unwrap();
    let features = reader.features().unwrap();
    let mut o = String::new();
    o.push_str("-- Written by crates/coilbox-track/tests/lua_fixture.rs from small.cbtrack.\n");
    o.push_str("-- Do not edit. The values are what the Rust reader gives.\n");
    o.push_str("return {\n");

    let id: String = h.game_id.iter().map(|b| format!("{b:02x}")).collect();
    writeln!(
        o,
        "\theader = {{ recorderVersion = {}, framesPerSecond = {}, firstFrame = {}, lastFrame = {}, windowLength = {}, windowCount = {}, tolerance = {}, positionShift = {}, velocityShift = {}, rotationBits = {}, sampleInterval = {}, unitCount = {}, projectileCount = {}, featureCount = {}, gameId = \"{id}\" }},",
        h.recorder_version,
        h.frames_per_second,
        h.first_frame,
        h.last_frame,
        h.window_length,
        h.window_count,
        num(h.tolerance as f64),
        h.position_shift,
        h.velocity_shift,
        h.rotation_bits,
        h.sample_interval,
        h.unit_count,
        h.projectile_count,
        h.feature_count,
    )
    .unwrap();

    writeln!(o, "\tinfo = {{").unwrap();
    writeln!(o, "\t\tengineVersion = {:?},", info.engine_version).unwrap();
    writeln!(o, "\t\tgame = {:?},", info.game).unwrap();
    writeln!(o, "\t\tmap = {:?},", info.map).unwrap();
    writeln!(o, "\t\twriter = {:?},", info.writer).unwrap();
    writeln!(o, "\t\tunitDefs = {},", strings(&info.unit_defs)).unwrap();
    let footprints: Vec<String> = info
        .unit_footprints
        .iter()
        .map(|f| format!("{{{}, {}}}", f[0], f[1]))
        .collect();
    writeln!(o, "\t\tunitFootprints = {{{}}},", footprints.join(", ")).unwrap();
    writeln!(o, "\t\tweaponDefs = {},", strings(&info.weapon_defs)).unwrap();
    writeln!(o, "\t\tfeatureDefs = {},", strings(&info.feature_defs)).unwrap();
    let posed: Vec<String> = info
        .posed_pieces
        .iter()
        .map(|p| {
            format!(
                "{{ unitDef = {}, pieces = {} }}",
                p.unit_def,
                strings(&p.pieces)
            )
        })
        .collect();
    writeln!(o, "\t\tposedPieces = {{{}}},", posed.join(", ")).unwrap();
    let teams: Vec<String> = info
        .teams
        .iter()
        .map(|t| {
            format!(
                "{{ id = {}, allyTeam = {}, flags = {}, colour = {{{}, {}, {}}}, side = {:?}, leader = {:?} }}",
                t.id, t.ally_team, t.flags, t.colour[0], t.colour[1], t.colour[2], t.side, t.leader
            )
        })
        .collect();
    writeln!(o, "\t\tteams = {{{}}},", teams.join(", ")).unwrap();
    writeln!(
        o,
        "\t\tmapSize = {{{}, {}}},",
        info.map_size[0], info.map_size[1]
    )
    .unwrap();
    writeln!(o, "\t}},").unwrap();

    writeln!(o, "\tfeatures = {{").unwrap();
    for f in &features {
        let p = f.position.map(|v| q.position_value(v));
        let r = q.rotation_value(&f.rotation);
        writeln!(
            o,
            "\t\t{{ engineId = {}, def = {}, team = {}, flags = {}, firstFrame = {}, lastFrame = {}, position = {}, rotation = {} }},",
            f.engine_id,
            f.feature_def,
            f.team,
            f.flags,
            f.first_frame,
            f.last_frame,
            list(&p),
            list(&r)
        )
        .unwrap();
    }
    writeln!(o, "\t}},").unwrap();

    // One list for each window, in heights as elmos.
    writeln!(o, "\tterrain = {{").unwrap();
    for k in 0..h.window_count as usize {
        let rows = reader.terrain(k).unwrap();
        writeln!(o, "\t\t{{").unwrap();
        for r in rows {
            writeln!(
                o,
                "\t\t\t{{ {}, {}, {}, {}, {} }},",
                r.frame,
                r.x,
                r.z,
                num(q.position_value(r.before)),
                num(q.position_value(r.after))
            )
            .unwrap();
        }
        writeln!(o, "\t\t}},").unwrap();
    }
    writeln!(o, "\t}},").unwrap();

    writeln!(o, "\tframes = {{").unwrap();
    for frame in frames_to_sample(&mut reader) {
        let window = h.window_of_frame(frame) + 1;
        let s = reader.sample(frame).unwrap();
        writeln!(o, "\t\t{{ frame = {frame}, window = {window},").unwrap();
        writeln!(o, "\t\t\tunits = {{").unwrap();
        for u in &s.units {
            let targets: Vec<String> = u
                .targets
                .iter()
                .map(|t| {
                    format!(
                        "{{ weapon = {}, kind = {}, reference = {}, power = {}, position = {} }}",
                        t.weapon,
                        t.kind,
                        lua_reference(t.kind, t.reference),
                        t.build_power,
                        list(&t.position)
                    )
                })
                .collect();
            let poses: Vec<String> = u
                .poses
                .iter()
                .map(|p| {
                    format!(
                        "{{ piece = {}, angles = {}, offsets = {} }}",
                        p.piece,
                        list(&p.angles),
                        list(&p.offsets)
                    )
                })
                .collect();
            let queue: Vec<String> = u
                .queue
                .iter()
                .map(|i| {
                    format!(
                        "{{{}, {}, {}, {}}}",
                        i.unit_def,
                        num(q.position_value(i.x)),
                        num(q.position_value(i.z)),
                        i.facing
                    )
                })
                .collect();
            writeln!(
                o,
                "\t\t\t\t{{ index = {}, serial = {}, engineId = {}, def = {}, team = {}, position = {}, rotation = {}, health = {}, build = {}, flags = {},\n\t\t\t\t\ttargets = {{{}}},\n\t\t\t\t\tposes = {{{}}},\n\t\t\t\t\tqueue = {{{}}} }},",
                u.index + 1,
                u.serial,
                u.engine_id,
                u.unit_def,
                u.team,
                list(&u.position),
                list(&u.rotation),
                num(u.health),
                num(u.build_progress),
                u.flags,
                targets.join(", "),
                poses.join(", "),
                queue.join(", ")
            )
            .unwrap();
        }
        writeln!(o, "\t\t\t}},").unwrap();
        writeln!(o, "\t\t\tprojectiles = {{").unwrap();
        for p in &s.projectiles {
            writeln!(
                o,
                "\t\t\t\t{{ index = {}, serial = {}, weapon = {}, team = {}, shooter = {}, position = {}, velocity = {} }},",
                p.index + 1,
                p.serial,
                p.weapon_def,
                p.team,
                p.shooter.map_or(0, |i| i + 1),
                list(&p.position),
                list(&p.velocity)
            )
            .unwrap();
        }
        writeln!(o, "\t\t\t}} }},").unwrap();
    }
    writeln!(o, "\t}},").unwrap();
    writeln!(o, "}}").unwrap();
    o
}

#[test]
fn the_fixture_holds_what_the_seed_builds_and_expected_lua_holds_what_the_reader_gives() {
    let track_path = dir().join("small.cbtrack");
    let expected_path = dir().join("expected.lua");
    let fresh = built().to_bytes().unwrap();

    if std::env::var_os("COILBOX_UPDATE_LUA_FIXTURE").is_some() {
        std::fs::create_dir_all(dir()).unwrap();
        std::fs::write(&track_path, &fresh).unwrap();
        std::fs::write(&expected_path, expected_lua(&fresh)).unwrap();
        return;
    }

    let committed = std::fs::read(&track_path).expect("small.cbtrack is committed");

    // The two files may differ in their compressed bytes, which depend on the
    // zlib the writer links, so compare what they read back as.
    let mut a = TrackReader::open(Cursor::new(committed.clone())).unwrap();
    let mut b = TrackReader::open(Cursor::new(fresh)).unwrap();
    // Where the info and features chunks are depends on their compressed size.
    let without_extents = |h: &Header| Header {
        info: Extent::default(),
        features: Extent::default(),
        ..h.clone()
    };
    assert_eq!(
        without_extents(a.header()),
        without_extents(b.header()),
        "the headers differ"
    );
    assert_eq!(a.info().unwrap(), b.info().unwrap(), "the info differs");
    assert_eq!(a.features().unwrap(), b.features().unwrap());
    for k in 0..a.header().window_count as usize {
        assert_eq!(a.window(k).unwrap(), b.window(k).unwrap(), "window {k}");
        assert_eq!(a.terrain(k).unwrap(), b.terrain(k).unwrap(), "terrain {k}");
    }

    let expected = std::fs::read_to_string(&expected_path).expect("expected.lua is committed");
    assert!(
        expected == expected_lua(&committed),
        "expected.lua no longer says what the Rust reader gives for small.cbtrack. \
         Run with COILBOX_UPDATE_LUA_FIXTURE=1 to rewrite both files."
    );
}

#[test]
fn the_fixture_spans_a_minute_over_more_than_one_window() {
    let h = built().to_bytes().unwrap();
    let r = TrackReader::open(Cursor::new(h)).unwrap();
    let h = r.header();
    assert!(h.last_frame - h.first_frame >= 30 * 60, "under a minute");
    assert!(h.window_count > 1);
}
