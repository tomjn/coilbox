//! Prints what the projectile and target sections of a track cost, and what
//! the track would cost if a unit's weapons after the first had no target
//! tracks.
//!
//! ```sh
//! cargo run --release -p coilbox-track-thin --example section_bytes -- <track>
//! ```
//!
//! A section's columns are put in a chunk of their own and compressed at level
//! 9, window by window, and the sizes are added up. That is how the figures in
//! `docs/reference/replay-track-format.md` for one section were made. The
//! "without" figures drop every target track whose weapon number is 2 or
//! more from each window, write the window again and compress it. Builder
//! work, which is weapon 0, stays.

use coilbox_track::{compress, Chunk, Column, TrackReader, Window};
use std::fs::File;

/// Column 10 says how many target tracks each unit has. 40 to 48 are the
/// tracks themselves.
const TARGETS: [u16; 10] = [10, 40, 41, 42, 43, 44, 45, 46, 47, 48];
/// 80 to 100 are the projectiles: their entries, times, positions and
/// velocities.
const PROJECTILES: std::ops::RangeInclusive<u16> = 80..=100;

fn only(chunk: &Chunk, ids: impl Iterator<Item = u16>) -> Chunk {
    let mut out = Chunk::new();
    for id in ids {
        match chunk.column(id) {
            None => {}
            Some(Column::U8(v)) => out.set_u8(id, v.clone()),
            Some(Column::U16(v)) => out.set_u16(id, v.clone()),
            Some(Column::S16(v)) => out.set_s16(id, v.clone()),
            Some(Column::U32(v)) => out.set_u32(id, v.clone()),
            Some(Column::S32(v)) => out.set_s32(id, v.clone()),
        }
    }
    out
}

/// Bytes before compression and after, of a chunk.
fn size(chunk: &Chunk) -> (u64, u64) {
    let plain = chunk.encode().expect("a chunk that was read encodes");
    let packed = compress(&plain).expect("compresses");
    (plain.len() as u64, packed.len() as u64)
}

#[derive(Default)]
struct Sum {
    plain: u64,
    packed: u64,
}

impl Sum {
    fn add(&mut self, (plain, packed): (u64, u64)) {
        self.plain += plain;
        self.packed += packed;
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("a track to read");
    let mut reader = TrackReader::open(File::open(&path).expect("opens")).expect("is a track");
    let windows = reader.header().window_count as usize;

    let mut whole_in_file = 0u64;
    let mut whole = Sum::default();
    let mut whole_first_only = Sum::default();
    let mut projectiles = Sum::default();
    let mut targets = Sum::default();
    let mut targets_first_only = Sum::default();
    let (mut tracks, mut keys) = (0u64, 0u64);
    let (mut tracks_after_first, mut keys_after_first) = (0u64, 0u64);

    for k in 0..windows {
        whole_in_file += reader.window_entries()[k].main.length as u64;
        let chunk = reader.window_chunk(k).expect("reads");
        projectiles.add(size(&only(&chunk, PROJECTILES)));
        targets.add(size(&only(&chunk, TARGETS.into_iter())));

        let mut window: Window = reader.window(k).expect("reads");
        whole.add(size(&window.to_chunk().expect("writes again")));
        for unit in &mut window.units {
            for track in &unit.unit.targets {
                tracks += 1;
                keys += track.keys.len() as u64;
                if track.weapon >= 2 {
                    tracks_after_first += 1;
                    keys_after_first += track.keys.len() as u64;
                }
            }
            unit.unit.targets.retain(|t| t.weapon < 2);
        }
        let first_only = window.to_chunk().expect("writes again");
        whole_first_only.add(size(&first_only));
        targets_first_only.add(size(&only(&first_only, TARGETS.into_iter())));
    }

    println!("{path}");
    println!("  {windows} windows");
    println!(
        "  main chunks in the file                    {whole_in_file} bytes compressed ({} read and written again)",
        whole.packed
    );
    println!(
        "  projectile columns                         {} bytes before compression, {} compressed on their own",
        projectiles.plain, projectiles.packed
    );
    println!(
        "  target columns                             {} bytes before compression, {} compressed on their own",
        targets.plain, targets.packed
    );
    println!("  target tracks, keys, over every window     {tracks}, {keys}");
    println!(
        "  of them for a weapon after the first       {tracks_after_first}, {keys_after_first}"
    );
    println!(
        "  target columns with the first weapon only  {} bytes before compression, {} compressed on their own",
        targets_first_only.plain, targets_first_only.packed
    );
    println!(
        "  main chunks with the first weapon only     {} bytes compressed",
        whole_first_only.packed
    );
}
