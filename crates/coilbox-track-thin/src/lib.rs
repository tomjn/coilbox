//! Turns the rewind recorder's raw dump into a replay track.
//!
//! The recorder (`lua/rewind-recorder`) writes every unit several times a
//! second and every projectile on every frame. Most of those samples are
//! predictable: a unit driving in a straight line needs two points, not two
//! hundred. [`thin_dump`] drops the samples that add nothing, checks every
//! sample of the dump against the track it has made, and writes the track
//! through `coilbox-track`.
//!
//! The dump is read as a stream, three times over, and never held:
//!
//! 1. A scan for which frames it has and how large its units are, which the
//!    track's steps depend on.
//! 2. Thinning. What is held is each curve's keys so far and its samples
//!    since the last window edge. See [`thin`](crate::thin) for the method.
//! 3. The check. Each sample is measured against what a reader gets from the
//!    windows of the finished file. A track that is further from a sample
//!    than its own tolerance is an error, and no file is written.
//!
//! `coilbox-track` knows nothing of the dump, and this crate knows nothing of
//! the track's bytes.

mod build;
mod curves;
pub mod dump;
mod error;
mod interpret;
mod pose;
mod settings;
mod thin;
mod verify;

pub use error::{Result, ThinError, Worst};
pub use verify::WorstErrors;

use coilbox_track::{Header, Quantiser, Settings, Track, TrackReader, Window};
use dump::{Block, DumpHeader, DumpReader};
use interpret::{Interpreter, Rest, Sink};
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek};
use std::path::Path;

/// What a caller chooses about the track.
#[derive(Debug, Clone, PartialEq)]
pub struct ThinOptions {
    /// In elmos. No recorded sample is further than this from the track.
    pub tolerance: f32,
    /// Frames in a window of the track.
    pub window_length: u32,
    /// Goes in the track's header. It changes when the recorder would produce
    /// different keys from the same replay.
    pub recorder_version: u16,
    /// The replay's game id, for the track's header. The dump does not have
    /// it.
    pub game_id: [u8; 16],
    /// The rotation width, 8 to 16 bits. `None` follows the format's rule,
    /// which takes it from the tolerance and the largest unit. A caller sets
    /// it to measure what rotation rounding costs.
    pub rotation_bits: Option<u8>,
}

impl Default for ThinOptions {
    /// The tolerance and window length `docs/reference/replay-track-format.md`
    /// was measured at: half an elmo, and 900 frames.
    fn default() -> Self {
        Self {
            tolerance: 0.5,
            window_length: 900,
            recorder_version: 1,
            game_id: [0; 16],
            rotation_bits: None,
        }
    }
}

/// How many samples a dump holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SampleCounts {
    /// Unit samples, with each unit's created row and its destroyed row where
    /// those give a pose no sample does.
    pub units: u64,
    /// Piece pose rows.
    pub poses: u64,
    /// Projectile rows.
    pub projectiles: u64,
}

/// How many keys of each kind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct KeyCounts {
    /// Units, or unit entries when counted over a file's windows.
    pub units: u64,
    pub transform: u64,
    pub status: u64,
    pub target_tracks: u64,
    pub target: u64,
    pub pose_tracks: u64,
    pub pose: u64,
    pub queue: u64,
    pub queue_items: u64,
    /// Projectiles, or projectile entries when counted over a file's windows.
    pub projectiles: u64,
    pub projectile: u64,
    pub features: u64,
    pub terrain_rows: u64,
}

impl KeyCounts {
    fn add_unit(&mut self, u: &coilbox_track::Unit) {
        self.units += 1;
        self.transform += u.transform.len() as u64;
        self.status += u.status.len() as u64;
        self.target_tracks += u.targets.len() as u64;
        self.target += u.targets.iter().map(|t| t.keys.len() as u64).sum::<u64>();
        self.pose_tracks += u.poses.len() as u64;
        self.pose += u.poses.iter().map(|p| p.keys.len() as u64).sum::<u64>();
        self.queue += u.queue.len() as u64;
        self.queue_items += u.queue.iter().map(|k| k.items.len() as u64).sum::<u64>();
    }

    fn add_projectile(&mut self, p: &coilbox_track::Projectile) {
        self.projectiles += 1;
        self.projectile += p.keys.len() as u64;
    }

    fn add_window(&mut self, w: &Window) {
        for u in &w.units {
            self.add_unit(&u.unit);
        }
        for p in &w.projectiles {
            self.add_projectile(&p.projectile);
        }
    }
}

/// What checking a track against its dump found.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckReport {
    pub header: Header,
    /// The largest radius of any unit in the match, in elmos. A unit's turn
    /// is multiplied by its own radius, and the track's rotation width follows
    /// from this, the largest.
    pub weighting_length: f32,
    pub samples: SampleCounts,
    /// The keys in the file, counted over its windows. A key added at a
    /// window's edge counts, and so does a unit in each window it is in.
    pub written: KeyCounts,
    pub worst: WorstErrors,
}

impl CheckReport {
    /// The furthest any recorded sample is from the track, in elmos.
    pub fn worst_error(&self) -> f64 {
        self.worst.elmos().map_or(0.0, |w| w.error)
    }
}

/// What [`thin_dump`] made.
#[derive(Debug, Clone, PartialEq)]
pub struct ThinReport {
    pub header: Header,
    /// The size of the track file.
    pub bytes: u64,
    /// See [`CheckReport::weighting_length`].
    pub weighting_length: f32,
    pub samples: SampleCounts,
    /// The keys thinning kept, over the whole match.
    pub kept: KeyCounts,
    /// See [`CheckReport::written`].
    pub written: KeyCounts,
    pub worst: WorstErrors,
}

impl ThinReport {
    /// The furthest any recorded sample is from the track, in elmos.
    pub fn worst_error(&self) -> f64 {
        self.worst.elmos().map_or(0.0, |w| w.error)
    }
}

fn open(path: &Path) -> Result<DumpReader<BufReader<File>>> {
    DumpReader::open(BufReader::with_capacity(1 << 20, File::open(path)?))
}

/// What the first read of a dump finds.
struct Scan {
    header: DumpHeader,
    first_frame: u32,
    last_frame: u32,
    /// The largest radius of a unit in the match, in elmos.
    largest_radius: f32,
}

fn scan(path: &Path) -> Result<Scan> {
    let mut reader = open(path)?;
    let mut header = None;
    let mut frames: Option<(u32, u32)> = None;
    let mut largest_radius = 0f32;
    let mut ended = false;
    while let Some(block) = reader.next_block()? {
        match block {
            Block::Header(h) => header = Some(*h),
            Block::Frame(f) => {
                frames = Some((frames.map_or(f.frame, |(first, _)| first), f.frame));
                if let Some(h) = &header {
                    for row in &f.created {
                        largest_radius =
                            largest_radius.max(Interpreter::radius(h, row.def).unwrap_or(0.0));
                    }
                }
            }
            Block::End(_) => ended = true,
            Block::Pieces(_) | Block::Unknown(_) => {}
        }
    }
    if !ended {
        return Err(ThinError::Dump(
            "the dump has no end block, so the run that made it was stopped part way".into(),
        ));
    }
    let header = header.ok_or_else(|| ThinError::Dump("the dump has no header block".into()))?;
    let (first_frame, last_frame) =
        frames.ok_or_else(|| ThinError::Dump("the dump has no frames".into()))?;
    Ok(Scan {
        header,
        first_frame,
        last_frame,
        largest_radius,
    })
}

/// Reads a dump from the start and passes what it says to `sink`.
fn replay(path: &Path, q: Quantiser, sink: &mut dyn Sink) -> Result<Rest> {
    let mut reader = open(path)?;
    let mut interpreter = None;
    while let Some(block) = reader.next_block()? {
        match (block, &mut interpreter) {
            (Block::Header(h), _) => interpreter = Some(Interpreter::new(*h, q)?),
            (Block::Pieces(tree), Some(i)) => i.pieces(tree),
            (Block::Frame(frame), Some(i)) => i.frame(sink, &frame)?,
            (Block::Frame(_) | Block::Pieces(_), None) => {
                return Err(ThinError::Dump(
                    "the dump's first block is not its header".into(),
                ))
            }
            (Block::End(_) | Block::Unknown(_), _) => {}
        }
    }
    interpreter
        .ok_or_else(|| ThinError::Dump("the dump has no header block".into()))?
        .finish(sink)
}

/// Measures every sample of a dump against a track, and fails if the track is
/// further from one than `tolerance`.
fn check<R: Read + Seek>(dump: &Path, track: R, weighting_length: f32) -> Result<CheckReport> {
    let reader = TrackReader::open(track)?;
    let header = reader.header().clone();
    let q = reader.quantiser()?;
    let mut verifier = verify::Verifier::new(reader)?;
    let rest = replay(dump, q, &mut verifier)?;
    let (worst, samples, written) = verifier.finish(&rest)?;

    let tolerance = header.tolerance as f64;
    if let Some(w) = worst.elmos().filter(|w| w.error > tolerance) {
        return Err(ThinError::OverTolerance {
            tolerance,
            worst: w.clone(),
        });
    }
    if let Some(w) = worst
        .status
        .as_ref()
        .filter(|w| w.error > curves::STATUS_TOLERANCE)
    {
        return Err(ThinError::OverTolerance {
            tolerance: curves::STATUS_TOLERANCE,
            worst: w.clone(),
        });
    }
    Ok(CheckReport {
        header,
        weighting_length,
        samples,
        written,
        worst,
    })
}

/// Checks a track that is already written against the dump it was made from:
/// every recorded sample against what a reader gets from the file, to the
/// tolerance in the track's own header.
pub fn check_track(dump: &Path, track: &Path) -> Result<CheckReport> {
    let scan = scan(dump)?;
    check(
        dump,
        BufReader::new(File::open(track)?),
        scan.largest_radius,
    )
}

/// Thins the dump at `dump` and writes it as a track at `track`.
///
/// Gives back what it wrote, with the furthest any recorded sample is from
/// the track. Fails, and writes no file, when the dump is not a whole
/// recording or when the track it made does not keep its own tolerance.
pub fn thin_dump(dump: &Path, track: &Path, options: &ThinOptions) -> Result<ThinReport> {
    let tolerance = options.tolerance as f64;
    if !(tolerance > 0.0 && tolerance.is_finite()) {
        return Err(ThinError::Dump(format!(
            "the tolerance must be more than 0 elmos, not {tolerance}"
        )));
    }
    let scan = scan(dump)?;
    let settings = Settings {
        recorder_version: options.recorder_version,
        frames_per_second: scan.header.game_speed as u16,
        first_frame: scan.first_frame,
        last_frame: scan.last_frame,
        window_length: options.window_length,
        tolerance: options.tolerance,
        position_shift: settings::position_shift(tolerance),
        velocity_shift: settings::velocity_shift(tolerance, options.window_length),
        rotation_bits: options
            .rotation_bits
            .unwrap_or_else(|| settings::rotation_bits(tolerance, scan.largest_radius as f64)),
        sample_interval: scan.header.unit_frames as u8,
        game_id: options.game_id,
    };
    let q = settings.quantiser()?;

    let mut thinner = build::Thinner::new(thin::Rules {
        q,
        tolerance,
        first_frame: scan.first_frame,
        window_length: options.window_length,
    });
    let rest = replay(dump, q, &mut thinner)?;
    let (units, projectiles, _) = thinner.finish();

    let mut kept = KeyCounts {
        features: rest.features.len() as u64,
        terrain_rows: rest.terrain.len() as u64,
        ..KeyCounts::default()
    };
    units.iter().for_each(|u| kept.add_unit(u));
    projectiles.iter().for_each(|p| kept.add_projectile(p));

    let bytes = Track {
        settings,
        info: rest.info,
        features: rest.features,
        units,
        projectiles,
        terrain: rest.terrain,
    }
    .to_bytes()?;

    // Checked before it is written, so a track that fails leaves no file.
    let checked = check(dump, Cursor::new(&bytes), scan.largest_radius)?;
    std::fs::write(track, &bytes)?;
    Ok(ThinReport {
        header: checked.header,
        bytes: bytes.len() as u64,
        weighting_length: checked.weighting_length,
        samples: checked.samples,
        kept,
        written: checked.written,
        worst: checked.worst,
    })
}
