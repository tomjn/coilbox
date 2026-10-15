//! The worked example in docs/reference/replay-track-format.md: one window of
//! 420 bytes, written out in hex. The reader must decode it and the writer must
//! produce it.

mod common;

use coilbox_track::*;
use std::io::Cursor;

const EXAMPLE_HEX: &str = "
18 00 00 00 01 00 02 00 24 01 00 00 01 00 00 00
02 00 04 00 28 01 00 00 01 00 00 00 03 00 02 00
2c 01 00 00 01 00 00 00 04 00 01 00 30 01 00 00
01 00 00 00 05 00 01 00 34 01 00 00 01 00 00 00
06 00 02 00 38 01 00 00 01 00 00 00 07 00 02 00
3c 01 00 00 01 00 00 00 08 00 02 00 40 01 00 00
01 00 00 00 09 00 02 00 44 01 00 00 01 00 00 00
10 00 02 00 48 01 00 00 03 00 00 00 11 00 03 00
50 01 00 00 03 00 00 00 12 00 03 00 58 01 00 00
03 00 00 00 13 00 03 00 60 01 00 00 03 00 00 00
14 00 05 00 68 01 00 00 01 00 00 00 15 00 05 00
6c 01 00 00 01 00 00 00 16 00 05 00 70 01 00 00
01 00 00 00 17 00 01 00 74 01 00 00 03 00 00 00
18 00 02 00 78 01 00 00 03 00 00 00 19 00 02 00
80 01 00 00 03 00 00 00 1a 00 02 00 88 01 00 00
03 00 00 00 20 00 02 00 90 01 00 00 01 00 00 00
21 00 02 00 94 01 00 00 01 00 00 00 22 00 02 00
98 01 00 00 01 00 00 00 23 00 01 00 9c 01 00 00
01 00 00 00 2f 1f 00 00 00 00 00 00 00 00 00 00
00 00 00 00 02 00 00 00 00 00 00 00 84 03 00 00
03 00 00 00 01 00 00 00 00 00 2c 01 78 00 00 00
00 80 00 00 e0 01 00 00 00 80 00 00 06 00 00 00
00 80 00 00 00 00 00 00 a0 16 00 00 e4 06 00 00
00 19 00 00 03 03 03 00 00 00 00 00 00 00 00 00
00 00 00 00 a7 05 00 00 00 00 00 00 00 00 00 00
00 00 00 00 ff ff 00 00 ff ff 00 00 01 00 00 00
00 00 00 00
";

fn example_bytes() -> Vec<u8> {
    EXAMPLE_HEX
        .split_whitespace()
        .map(|b| u8::from_str_radix(b, 16).unwrap())
        .collect()
}

/// The track the example is the first window of: window length 900, position
/// shift 3, 12 rotation bits, and a unit that goes on after the window.
fn example_track() -> Track {
    let mut track = Track::new(Settings {
        first_frame: 0,
        last_frame: 1800,
        window_length: 900,
        position_shift: 3,
        rotation_bits: 12,
        ..Settings::default()
    });
    let q = track.quantiser().unwrap();
    let turned = q.rotation([0.0, 0.5, 0.0, 0.75f64.sqrt()]);
    let still = q.rotation([0.0, 0.0, 0.0, 1.0]);
    let pos = |x: f64, y: f64, z: f64| {
        [
            q.position(x).unwrap(),
            q.position(y).unwrap(),
            q.position(z).unwrap(),
        ]
    };
    track.units.push(Unit {
        engine_id: 7983,
        serial: 0,
        unit_def: 0,
        team: 0,
        first_frame: 0,
        last_frame: 1800,
        transform: vec![
            TransformKey {
                frame: 0,
                position: pos(724.0, 220.5, 800.0),
                rotation: still,
            },
            TransformKey {
                frame: 300,
                position: pos(724.0, 220.5, 800.0),
                rotation: still,
            },
            TransformKey {
                frame: 420,
                position: pos(784.0, 221.25, 800.0),
                rotation: turned,
            },
        ],
        status: vec![StatusKey {
            frame: 0,
            health: 65535,
            build_progress: 65535,
            flags: 1,
        }],
        targets: vec![],
        poses: vec![],
        queue: vec![],
    });
    track
}

#[test]
fn the_reader_decodes_the_worked_example() {
    let chunk = Chunk::decode(&example_bytes()).unwrap();
    let window = Window::from_chunk(&chunk, 0, 0, 900).unwrap();
    let q = Quantiser::new(3, 11, 12).unwrap();

    assert_eq!(window.units.len(), 1);
    let u = &window.units[0];
    assert_eq!(u.unit.engine_id, 7983);
    assert_eq!((u.unit.first_frame, u.unit.last_frame), (0, 900));
    assert!(!u.continues_before && u.continues_after);
    let t = &u.unit.transform;
    assert_eq!(t.iter().map(|k| k.frame).collect::<Vec<_>>(), [0, 300, 420]);
    assert_eq!(t[0].position, [5792, 1764, 6400]);
    assert_eq!(t[2].position, [6272, 1770, 6400]);
    assert_eq!(
        t[2].rotation,
        Rotation {
            dropped: 3,
            kept: [0, 1447, 0]
        }
    );
    assert_eq!(u.unit.status.len(), 1);
    assert_eq!(u.unit.status[0].flags, 1);

    // "At offset 360, half way between keys 1 and 2, x is 754 elmos."
    let mid = window.sample(360, &q).unwrap();
    assert_eq!(mid.units[0].position[0], 754.0);

    // Key 2: w comes back as 0.86611 and front as (0.86585, 0, 0.50031).
    let r = q.rotation_value(&t[2].rotation);
    assert!((r[3] - 0.86611).abs() < 1e-5, "{r:?}");
    let (x, y, z, w) = (r[0], r[1], r[2], r[3]);
    let front = [
        2.0 * (x * z + w * y),
        2.0 * (y * z - w * x),
        1.0 - 2.0 * (x * x + y * y),
    ];
    assert!((front[0] - 0.86585).abs() < 1e-5, "{front:?}");
    assert!((front[2] - 0.50031).abs() < 1e-5, "{front:?}");

    // From offset 420 to 900 the unit holds key 2.
    let end = window.sample(900, &q).unwrap();
    assert_eq!(end.units[0].position, [784.0, 221.25, 800.0]);
}

#[test]
fn the_example_decodes_and_encodes_to_the_same_bytes() {
    let bytes = example_bytes();
    assert_eq!(bytes.len(), 420);
    let chunk = Chunk::decode(&bytes).unwrap();
    let window = Window::from_chunk(&chunk, 0, 0, 900).unwrap();
    assert_eq!(window.to_chunk().unwrap().encode().unwrap(), bytes);
}

#[test]
fn the_writer_produces_the_worked_example() {
    let file = example_track().to_bytes().unwrap();
    let mut reader = TrackReader::open(Cursor::new(file)).unwrap();
    assert_eq!(reader.header().window_count, 2);
    let chunk = reader.window_chunk(0).unwrap();
    assert_eq!(chunk.encode().unwrap(), example_bytes());
}

#[test]
fn the_compressed_example_is_a_zlib_stream_with_the_documented_checksum() {
    let packed = compress(&example_bytes()).unwrap();
    // RFC 1950 header for level 9, which is what VFS.ZlibDecompress reads.
    assert_eq!(&packed[..2], &[0x78, 0xda]);
    // The Adler-32 of the 420 bytes, big endian at the end of the stream.
    assert_eq!(&packed[packed.len() - 4..], &[0x3f, 0x8d, 0x15, 0x33]);
    assert_eq!(decompress(&packed).unwrap(), example_bytes());
}
