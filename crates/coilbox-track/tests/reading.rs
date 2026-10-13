//! What the reader touches, and what it does with a file it cannot trust.

mod common;

use coilbox_track::*;
use common::*;
use std::io::Cursor;

fn file(windows: u32) -> (Track, Vec<u8>) {
    let track = random_track(3, windows, 30, 12);
    let bytes = track.to_bytes().unwrap();
    (track, bytes)
}

fn overlaps(a: (u64, u64), b: (u64, u64)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

#[test]
fn reading_one_window_does_not_read_the_others() {
    let (_, bytes) = file(30);
    let total = bytes.len() as u64;
    let (source, reads) = Recording::new(Cursor::new(bytes));
    let mut reader = TrackReader::open(source).unwrap();

    // Opening reads the header and the index, and nothing else.
    let header_end = reader.header().header_size as u64;
    let index_end = header_end + 16 * reader.header().window_count as u64;
    let opened = reads.borrow().clone();
    assert!(!opened.is_empty());
    assert!(
        opened.iter().all(|r| r.1 <= index_end),
        "open read {opened:?}"
    );

    reads.borrow_mut().clear();
    reader.window(17).unwrap();
    let wanted = reader.window_entries()[17].main;
    let range = (
        wanted.block as u64 * 64,
        wanted.block as u64 * 64 + wanted.length as u64,
    );
    let read = reads.borrow().clone();
    assert!(!read.is_empty());
    assert!(
        read.iter().all(|r| r.0 >= range.0 && r.1 <= range.1),
        "window 17 is bytes {range:?} but the reader read {read:?}"
    );
    let touched: u64 = read.iter().map(|r| r.1 - r.0).sum();
    assert_eq!(touched, wanted.length as u64);

    // Every other window's bytes were left alone, so a seek stays small.
    for (i, entry) in reader.window_entries().iter().enumerate() {
        if i == 17 {
            continue;
        }
        let r = (
            entry.main.block as u64 * 64,
            entry.main.block as u64 * 64 + entry.main.length as u64,
        );
        assert!(!read.iter().any(|x| overlaps(*x, r)), "window {i} was read");
    }
    assert!(
        touched * 20 < total,
        "one window is {touched} of {total} bytes"
    );
}

#[test]
fn sampling_a_frame_reads_one_window_and_a_second_frame_in_it_reads_nothing() {
    let (track, bytes) = file(10);
    let (source, reads) = Recording::new(Cursor::new(bytes));
    let mut reader = TrackReader::open(source).unwrap();
    reads.borrow_mut().clear();
    let f = track.settings.first_frame + 95;
    reader.sample(f).unwrap();
    let after_first = reads.borrow().len();
    assert!(after_first > 0);
    reader.sample(f + 1).unwrap();
    assert_eq!(
        reads.borrow().len(),
        after_first,
        "the loaded window was read again"
    );
}

#[test]
fn an_unknown_version_is_refused_by_name() {
    let (_, mut bytes) = file(3);
    bytes[4..6].copy_from_slice(&2u16.to_le_bytes());
    let err = TrackReader::open(Cursor::new(bytes)).err().unwrap();
    match &err {
        TrackError::UnknownLayout {
            field,
            found,
            expected,
        } => {
            assert_eq!(*field, "version");
            assert_eq!(found, "2");
            assert_eq!(expected, "1");
        }
        other => panic!("{other:?}"),
    }
    let text = err.to_string();
    assert!(text.contains("version") && text.contains('2'), "{text}");
}

#[test]
fn a_wrong_magic_is_refused_by_name() {
    let (_, mut bytes) = file(3);
    bytes[..4].copy_from_slice(b"RIFF");
    let err = TrackReader::open(Cursor::new(bytes)).err().unwrap();
    assert!(
        matches!(err, TrackError::UnknownLayout { field: "magic", .. }),
        "{err}"
    );
    assert!(err.to_string().contains("RIFF"));
}

#[test]
fn a_file_too_short_for_its_header_is_an_error() {
    let (_, bytes) = file(3);
    let err = TrackReader::open(Cursor::new(bytes[..40].to_vec()))
        .err()
        .unwrap();
    assert!(matches!(err, TrackError::Corrupt { .. }), "{err}");
}

#[test]
fn a_corrupt_window_fails_alone() {
    let (_, mut bytes) = file(6);
    let reader = TrackReader::open(Cursor::new(bytes.clone())).unwrap();
    let hit = reader.window_entries()[2].main;
    // Flip a byte in the middle of window 2's compressed data.
    let at = hit.block as usize * 64 + hit.length as usize / 2;
    bytes[at] ^= 0xff;

    let mut reader = TrackReader::open(Cursor::new(bytes)).unwrap();
    let err = reader.window(2).err().unwrap();
    assert!(matches!(err, TrackError::Corrupt { .. }), "{err}");
    for k in [0, 1, 3, 4, 5] {
        reader
            .window(k)
            .unwrap_or_else(|e| panic!("window {k}: {e}"));
    }
    reader.info().unwrap();
    reader.features().unwrap();
}

#[test]
fn a_truncated_file_fails_for_the_windows_it_cut_and_no_others() {
    let (_, bytes) = file(6);
    let reader = TrackReader::open(Cursor::new(bytes.clone())).unwrap();
    let last = reader.window_entries()[5].main;
    let cut = last.block as usize * 64 + last.length as usize / 2;

    let mut reader = TrackReader::open(Cursor::new(bytes[..cut].to_vec())).unwrap();
    let err = reader.window(5).err().unwrap();
    assert!(matches!(err, TrackError::Corrupt { .. }), "{err}");
    for k in 0..5 {
        reader.window(k).unwrap();
    }
}

#[test]
fn a_window_that_does_not_exist_is_an_error() {
    let (_, bytes) = file(3);
    let mut reader = TrackReader::open(Cursor::new(bytes)).unwrap();
    assert!(reader.window(3).is_err());
}

#[test]
fn chunks_start_on_64_byte_blocks_with_zero_padding() {
    let (_, bytes) = file(5);
    let reader = TrackReader::open(Cursor::new(bytes.clone())).unwrap();
    let h = reader.header();
    let mut extents = vec![
        (h.info.block, h.info.length),
        (h.features.block, h.features.length),
    ];
    for e in reader.window_entries() {
        extents.push((e.main.block, e.main.length));
        if e.terrain.length > 0 {
            extents.push((e.terrain.block, e.terrain.length));
        }
    }
    let mut end = 96 + 16 * h.window_count as usize;
    for (block, length) in extents {
        let start = block as usize * 64;
        assert!(start >= end);
        assert!(
            bytes[end..start].iter().all(|b| *b == 0),
            "padding is not zero"
        );
        // Every chunk is a zlib stream, which starts with 0x78 at level 9.
        assert_eq!(bytes[start], 0x78);
        end = start + length as usize;
    }
}
