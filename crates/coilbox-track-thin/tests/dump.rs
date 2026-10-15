//! The dump reader, and the test helper that writes dumps, each against the
//! other and both against a piece of a real recording.
//!
//! `fixtures/splinter-faction-fragment.dump` is cut from a recording of a
//! Splinter Faction match made by the rewind recorder: its header, two of its
//! piece trees, the ten frame blocks that are the smallest to hold each kind
//! of section, and its end block. The frames are not consecutive, so it reads
//! as a dump but is not a match.

mod common;

use coilbox_track_thin::dump::{Block, DumpReader, Frame, UnitPose};
use common::*;

const FRAGMENT: &[u8] = include_bytes!("fixtures/splinter-faction-fragment.dump");

fn blocks(bytes: &[u8]) -> (Vec<Block>, bool) {
    let mut reader = DumpReader::open(bytes).unwrap();
    let mut out = Vec::new();
    while let Some(block) = reader.next_block().unwrap() {
        out.push(block);
    }
    (out, reader.truncated())
}

/// The payload of every frame block, found by walking the file's blocks by
/// kind and length with no help from the reader.
fn frame_payloads(bytes: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut at = 8;
    while at < bytes.len() {
        let word = |i: usize| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
        let (kind, length) = (word(at), word(at + 4));
        if kind == 3 {
            out.push(&bytes[at + 8..at + 8 + length]);
        }
        at += 8 + length;
    }
    out
}

fn pose(p: &UnitPose) -> [f32; 13] {
    let mut out = [0.0; 13];
    out[0..3].copy_from_slice(&p.position);
    out[3..6].copy_from_slice(&p.front);
    out[6..9].copy_from_slice(&p.up);
    out[9..13].copy_from_slice(&[p.health, p.max_health, p.build, p.flags]);
    out
}

fn joined<const N: usize>(head: &[f32], tail: &[f32]) -> [f32; N] {
    let mut out = [0.0; N];
    out[..head.len()].copy_from_slice(head);
    out[head.len()..].copy_from_slice(tail);
    out
}

/// A frame the reader has cut into rows, as the rows of numbers the helper
/// writes. Every field goes back where the README says it is.
fn spec(f: &Frame) -> FrameSpec {
    FrameSpec {
        created: f
            .created
            .iter()
            .map(|r| {
                joined(
                    &[r.unit as f32, r.def as f32, r.team as f32],
                    &pose(&r.pose),
                )
            })
            .collect(),
        samples: f
            .samples
            .iter()
            .map(|r| joined(&[r.unit as f32], &pose(&r.pose)))
            .collect(),
        destroyed: f
            .destroyed
            .iter()
            .map(|r| joined(&[r.unit as f32], &pose(&r.pose)))
            .collect(),
        given: f
            .given
            .iter()
            .map(|r| [r.unit as f32, r.team as f32])
            .collect(),
        targets: f
            .targets
            .iter()
            .map(|r| joined(&[r.unit as f32, r.weapon as f32, r.kind as f32], &r.value))
            .collect(),
        work: f
            .work
            .iter()
            .map(|r| {
                joined(
                    &[
                        r.unit as f32,
                        r.command as f32,
                        r.target as f32,
                        r.build_power,
                        r.has_place as u8 as f32,
                    ],
                    &r.place,
                )
            })
            .collect(),
        queues: f
            .queues
            .iter()
            .map(|q| {
                let mut row = vec![q.unit as f32, q.items.len() as f32];
                for i in &q.items {
                    row.extend([i.def as f32, i.x, i.z, i.facing as f32]);
                }
                row
            })
            .collect(),
        poses: f
            .poses
            .iter()
            .map(|r| joined(&[r.unit as f32, r.piece as f32], &r.matrix))
            .collect(),
        features_created: f
            .features_created
            .iter()
            .map(|r| {
                let mut row = [0.0; 12];
                row[0..3].copy_from_slice(&[r.feature as f32, r.def as f32, r.team as f32]);
                row[3..6].copy_from_slice(&r.position);
                row[6..9].copy_from_slice(&r.front);
                row[9..12].copy_from_slice(&r.up);
                row
            })
            .collect(),
        features_destroyed: f.features_destroyed.iter().map(|r| *r as f32).collect(),
        projectiles: f
            .projectiles
            .iter()
            .map(|r| {
                let mut row = [0.0; 10];
                row[0..4].copy_from_slice(&[
                    r.projectile as f32,
                    r.def as f32,
                    r.team as f32,
                    r.owner as f32,
                ]);
                row[4..7].copy_from_slice(&r.position);
                row[7..10].copy_from_slice(&r.velocity);
                row
            })
            .collect(),
        terrain: f
            .terrain
            .iter()
            .map(|r| [r.x as f32, r.z as f32, r.before, r.after])
            .collect(),
        team_held: f
            .team_held
            .iter()
            .map(|r| [r.team as f32, r.metal, r.energy])
            .collect(),
        team_economy: f
            .team_economy
            .iter()
            .map(|r| {
                let mut row = [0.0; 17];
                row[0] = r.team as f32;
                row[1..9].copy_from_slice(&r.metal);
                row[9..17].copy_from_slice(&r.energy);
                row
            })
            .collect(),
        team_params: f
            .params
            .iter()
            .filter_map(|r| Some([r.team? as f32, r.param as f32, r.value]))
            .collect(),
        game_params: f
            .params
            .iter()
            .filter(|r| r.team.is_none())
            .map(|r| [r.param as f32, r.value])
            .collect(),
    }
}

/// The four sections of issue #3982, written by the helper from the README's
/// layout and read back by the crate's reader.
#[test]
fn team_resources_and_rules_parameters_read_as_they_were_written() {
    let mut scene = Scene::new(2);
    scene.params = Some((vec!["supplyUsed".into()], vec!["wave".into(), "day".into()]));
    scene.held(1, 0, 1028.5, 400.0);
    scene.economy(
        1,
        1,
        [1100.0, 7.25, 9.125, 7.0, 0.99, 1.0, 2.0, 3.0],
        [2000.0, 23.125, 100.0, 23.0, 0.5, 4.0, 5.0, 6.0],
    );
    scene.frame(2).team_params.push([1.0, 1.0, 30.0]);
    scene.frame(2).game_params.push([2.0, 0.25]);
    let bytes = scene.bytes();
    let (blocks, _) = blocks(&bytes);

    let Block::Header(header) = &blocks[0] else {
        panic!("the first block is not the header");
    };
    assert_eq!(header.team_params, ["supplyUsed"]);
    assert_eq!(header.game_params, ["wave", "day"]);
    let frames: Vec<&Frame> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Frame(f) => Some(&**f),
            _ => None,
        })
        .collect();
    let held = &frames[1].team_held[0];
    assert_eq!((held.team, held.metal, held.energy), (0, 1028.5, 400.0));
    let economy = &frames[1].team_economy[0];
    assert_eq!(economy.team, 1);
    assert_eq!(
        economy.metal,
        [1100.0, 7.25, 9.125, 7.0, 0.99, 1.0, 2.0, 3.0]
    );
    assert_eq!(economy.energy[0], 2000.0);
    assert_eq!(economy.energy[7], 6.0);
    let params = &frames[2].params;
    assert_eq!(
        (params[0].team, params[0].param, params[0].value),
        (Some(1), 1, 30.0)
    );
    assert_eq!(
        (params[1].team, params[1].param, params[1].value),
        (None, 2, 0.25)
    );
    // And back to the rows they were written from.
    for f in &frames {
        assert_eq!(
            spec(f),
            scene.frames.get(&f.frame).cloned().unwrap_or_default(),
            "frame {}",
            f.frame
        );
    }
}

/// The real recording was made before the recorder wrote them, and has none.
#[test]
fn a_dump_from_before_team_resources_has_no_parameter_lists_and_no_rows() {
    let (blocks, _) = blocks(FRAGMENT);
    let Block::Header(header) = &blocks[0] else {
        panic!("the first block is not the header");
    };
    assert!(header.team_params.is_empty() && header.game_params.is_empty());
    for block in &blocks {
        if let Block::Frame(f) = block {
            assert!(f.team_held.is_empty() && f.team_economy.is_empty() && f.params.is_empty());
        }
    }
}

#[test]
fn a_piece_of_a_real_recording_reads() {
    let (blocks, truncated) = blocks(FRAGMENT);
    assert!(!truncated);
    let Block::Header(header) = &blocks[0] else {
        panic!("the first block is not the header");
    };
    assert_eq!(header.format, 1);
    assert_eq!(header.map, "All That Glitters v2.2.3");
    assert_eq!((header.unit_frames, header.max_units), (3, 32000));
    assert_eq!(header.unit_defs.len(), 154);
    assert_eq!(header.unit_radii.as_ref().unwrap().len(), 154);
    assert_eq!(header.teams.len(), 3);
    assert!(header.teams[2].gaia && header.teams[1].ai.is_some());

    let trees: Vec<_> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Pieces(tree) => Some(tree),
            _ => None,
        })
        .collect();
    assert_eq!(trees.len(), 2);
    // What the model says about each piece at rest, one entry a piece.
    let walker = trees[0];
    assert_eq!(walker.pieces.len(), 25);
    assert_eq!(walker.pieces[8], "turret");
    assert_eq!(walker.parents[8], 1);
    assert_eq!(walker.model_type.as_deref(), Some("s3o"));
    let offsets = walker.offsets.as_ref().unwrap();
    assert_eq!(offsets.len(), 25);
    assert_eq!(offsets[0], [0.0, 24.2, 0.0]);
    let bounds = walker.bounds.as_ref().unwrap();
    assert_eq!(bounds.len(), 25);
    // A piece with geometry has a box of six numbers and one without has
    // none. `firepoint1` is where the barrel fires from.
    assert_eq!(bounds[8].len(), 6);
    assert_eq!(walker.pieces[10], "firepoint1");
    assert!(bounds[10].is_empty());
    let frames: Vec<&Frame> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Frame(f) => Some(&**f),
            _ => None,
        })
        .collect();
    assert_eq!(
        frames.iter().map(|f| f.frame).collect::<Vec<_>>(),
        [1, 453, 504, 507, 888, 900, 9515, 20257, 20424, 23003]
    );
    let Some(Block::End(end)) = blocks.last() else {
        panic!("the last block is not the end");
    };
    assert_eq!(
        (end.reason.as_str(), end.frame, end.frames),
        ("game_over", 23091, 23092)
    );

    // Between them the frames hold every kind of section but units given,
    // which the recording has none of.
    let all = |count: fn(&Frame) -> usize| frames.iter().map(|f| count(f)).sum::<usize>();
    assert!(all(|f| f.created.len()) > 0);
    assert!(all(|f| f.destroyed.len()) > 0);
    assert!(all(|f| f.samples.len()) > 0);
    assert!(all(|f| f.targets.len()) > 0);
    assert!(all(|f| f.work.len()) > 0);
    assert!(all(|f| f.queues.len()) > 0);
    assert!(all(|f| f.poses.len()) > 0);
    assert!(all(|f| f.features_created.len()) > 0);
    assert!(all(|f| f.features_destroyed.len()) > 0);
    assert!(all(|f| f.projectiles.len()) > 0);
    assert!(all(|f| f.terrain.len()) > 0);
}

#[test]
fn the_helper_writes_the_bytes_the_recorder_wrote() {
    let (blocks, _) = blocks(FRAGMENT);
    let frames: Vec<&Frame> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Frame(f) => Some(&**f),
            _ => None,
        })
        .collect();
    let recorded = frame_payloads(FRAGMENT);
    assert_eq!(frames.len(), recorded.len());
    for (frame, recorded) in frames.iter().zip(recorded) {
        assert_eq!(
            frame_payload(frame.frame, &spec(frame)),
            recorded,
            "frame {}",
            frame.frame
        );
    }
}

#[test]
fn the_reader_reads_back_what_the_helper_writes() {
    let mut scene = Scene::new(6);
    scene.unit(7, 1, 0, 6, |f| At::place(f as f32, 2.0, 3.0));
    scene
        .frame(3)
        .targets
        .push([7.0, 1.0, 2.0, 10.0, 20.0, 30.0]);
    scene
        .frame(3)
        .queues
        .push(vec![7.0, 2.0, 2.0, 64.0, 128.0, 1.0, 1.0, 96.0, 160.0, 3.0]);
    scene.frame(3).queues.push(vec![8.0, 0.0]);
    scene.frame(4).given.push([7.0, 1.0]);
    let (blocks, truncated) = blocks(&scene.bytes());
    assert!(!truncated);
    // A header, two piece trees, seven frames and an end.
    assert_eq!(blocks.len(), 11);
    let Block::Frame(third) = &blocks[6] else {
        panic!("not a frame");
    };
    assert_eq!(third.frame, 3);
    assert_eq!(spec(third), scene.frames[&3]);
    assert_eq!(third.queues[0].items[1].facing, 3);
    assert!(third.queues[1].items.is_empty());
    let Block::Frame(fourth) = &blocks[7] else {
        panic!("not a frame");
    };
    assert_eq!((fourth.given[0].unit, fourth.given[0].team), (7, 1));
}

#[test]
fn a_dump_cut_short_reads_up_to_the_last_whole_block() {
    let (whole, _) = blocks(FRAGMENT);
    // Where the last frame block starts: the end block after it is the
    // file's last 8 bytes of head and its payload.
    let recorded = frame_payloads(FRAGMENT);
    let last = recorded.last().unwrap();
    let start = last.as_ptr() as usize - FRAGMENT.as_ptr() as usize - 8;
    // Part way through that block's payload, then part way through its head.
    for cut in [start + 8 + last.len() / 2, start + 4] {
        let (some, truncated) = blocks(&FRAGMENT[..cut]);
        assert!(truncated, "cut at {cut}");
        assert_eq!(some.len(), whole.len() - 2);
        assert!(matches!(some.last(), Some(Block::Frame(_))));
    }
    // Cut cleanly between two blocks, nothing says it was cut.
    let (some, truncated) = blocks(&FRAGMENT[..start]);
    assert!(!truncated);
    assert_eq!(some.len(), whole.len() - 2);
}

#[test]
fn a_block_or_a_section_the_reader_does_not_know_is_skipped() {
    let mut dump = DumpBuilder::new();
    dump.block(77, b"something from a later recorder");
    // Frame 5 with a section of code 30 and two numbers, then one unit given.
    let numbers = [5.0f32, 30.0, 2.0, 1.5, 2.5, 3.0, 2.0, 7.0, 1.0];
    let payload: Vec<u8> = numbers.iter().flat_map(|n| n.to_le_bytes()).collect();
    dump.block(3, &payload);
    let (blocks, _) = blocks(&dump.bytes());
    assert!(matches!(blocks[0], Block::Unknown(77)));
    let Block::Frame(frame) = &blocks[1] else {
        panic!("not a frame");
    };
    assert_eq!(frame.frame, 5);
    assert_eq!(frame.given.len(), 1);
}

#[test]
fn a_section_that_runs_past_its_frame_is_an_error() {
    let numbers = [5.0f32, 4.0, 28.0, 1.0];
    let payload: Vec<u8> = numbers.iter().flat_map(|n| n.to_le_bytes()).collect();
    let error = Frame::parse(&payload).unwrap_err();
    assert!(
        error.to_string().contains("runs past the end of frame 5"),
        "{error}"
    );

    // A whole section whose numbers are not a whole number of rows.
    let numbers = [5.0f32, 3.0, 3.0, 1.0, 2.0, 3.0];
    let payload: Vec<u8> = numbers.iter().flat_map(|n| n.to_le_bytes()).collect();
    let error = Frame::parse(&payload).unwrap_err();
    assert!(
        error.to_string().contains("not a whole number of rows"),
        "{error}"
    );
}

#[test]
fn a_file_that_is_not_a_dump_is_refused() {
    assert!(DumpReader::open(&b"CBTK\x01\0\0\0"[..]).is_err());
    assert!(DumpReader::open(&b"CBRD\x02\0\0\0"[..]).is_err());
    assert!(DumpReader::open(&b"CB"[..]).is_err());
}
