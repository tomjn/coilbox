//! Shared by the integration tests: a small deterministic generator of tracks
//! and a reader wrapper that records which byte ranges were read.

#![allow(dead_code)]

use coilbox_track::*;
use std::cell::RefCell;
use std::io::{Read, Seek, SeekFrom};
use std::rc::Rc;

/// xorshift64*. Deterministic, so a failing case can be replayed from its seed.
pub struct Rng(pub u64);

impl Rng {
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// A number in `0..n`.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    /// A number in `lo..=hi`.
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as u64) as i64
    }

    /// A number in `0.0..1.0`.
    pub fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// The byte ranges a reader has handed out, as start and end.
pub type ReadLog = Rc<RefCell<Vec<(u64, u64)>>>;

/// Wraps a reader and records every byte range it hands out.
pub struct Recording<R> {
    inner: R,
    pub reads: ReadLog,
}

impl<R: Read + Seek> Recording<R> {
    pub fn new(inner: R) -> (Self, ReadLog) {
        let reads = Rc::new(RefCell::new(Vec::new()));
        (
            Self {
                inner,
                reads: reads.clone(),
            },
            reads,
        )
    }
}

impl<R: Read + Seek> Read for Recording<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let at = self.inner.stream_position()?;
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.reads.borrow_mut().push((at, at + n as u64));
        }
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for Recording<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

pub fn settings(first: u32, last: u32, window_length: u32) -> Settings {
    Settings {
        first_frame: first,
        last_frame: last,
        window_length,
        ..Settings::default()
    }
}

fn walk(rng: &mut Rng, v: i32, spread: i64) -> i32 {
    (v as i64 + rng.range(-spread, spread)) as i32
}

fn random_rotation(rng: &mut Rng, q: &Quantiser) -> Rotation {
    let v = [
        rng.unit() - 0.5,
        rng.unit() - 0.5,
        rng.unit() - 0.5,
        rng.unit() - 0.5,
    ];
    q.rotation(v)
}

/// A rotation a little way from `from`. Thinned keys sit within a tolerance of
/// each other, so real turns between keys are small. A blend that restarts at
/// a window edge only matches the whole curve to within rounding for small
/// turns.
fn nearby_rotation(rng: &mut Rng, q: &Quantiser, from: &Rotation) -> Rotation {
    let mut v = q.rotation_value(from);
    for c in &mut v {
        *c += (rng.unit() - 0.5) * 0.06;
    }
    q.rotation(v)
}

/// Strictly increasing frames inside `first..=last`, a random gap apart.
fn frames(rng: &mut Rng, first: u32, last: u32, max_gap: u32) -> Vec<u32> {
    let mut out = vec![first];
    let mut f = first;
    loop {
        f += 1 + rng.below(max_gap as u64) as u32;
        if f > last {
            break;
        }
        out.push(f);
    }
    out
}

/// A track with a few units that live for the whole match (the anchors, which
/// everything else may target), units that come and go, projectiles, and
/// terrain. `windows` is the number of windows and `window_length` their
/// length. The last window is cut short so the partial window is covered.
pub fn random_track(seed: u64, windows: u32, window_length: u32, units: usize) -> Track {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let first = 100;
    let last = first + (windows - 1) * window_length + window_length / 3 + 1;
    let settings = settings(first, last, window_length);
    let q = Quantiser::new(
        settings.position_shift,
        settings.velocity_shift,
        settings.rotation_bits,
    )
    .unwrap();
    let mut track = Track::new(settings);
    track.info.engine_version = "test engine".into();
    track.info.game = "test game 1".into();
    track.info.map = "test map".into();
    track.info.writer = "coilbox-track tests".into();
    track.info.unit_defs = vec!["armcom".into(), "armpw".into(), "armsolar".into()];
    track.info.unit_footprints = vec![[32, 32], [32, 48], [80, 64]];
    track.info.weapon_defs = vec!["laser".into(), "missile".into()];
    track.info.feature_defs = vec!["rock".into()];
    track.info.posed_pieces = vec![PosedPieces {
        unit_def: 1,
        pieces: vec!["turret".into(), "barrel".into(), "arm".into()],
    }];
    track.info.teams = vec![Team {
        id: 0,
        ally_team: 0,
        flags: 0,
        colour: [255, 0, 0],
        side: "arm".into(),
        leader: "Leader".into(),
    }];
    track.info.map_size = [4096, 4096];

    for i in 0..5 {
        track.features.push(Feature {
            engine_id: i,
            feature_def: 0,
            team: if i == 0 { 255 } else { 0 },
            flags: 0,
            first_frame: first,
            last_frame: last,
            position: [i as i32 * 800, 100, 400],
            rotation: random_rotation(&mut rng, &q),
        });
    }

    // Serials 0 to 2 are the anchors. Targets only ever name an anchor, so a
    // reference never points at a unit that is missing from the window.
    for serial in 0..units as u32 {
        let (f0, f1) = if serial < 3 {
            (first, last)
        } else {
            let a = first + rng.below((last - first) as u64) as u32;
            let b = a + rng.below((last - a) as u64 + 1) as u32;
            (a, b)
        };
        let mut unit = Unit {
            engine_id: serial as u16 + 7000,
            serial,
            unit_def: (serial % 3) as u16,
            team: 0,
            first_frame: f0,
            last_frame: f1,
            transform: vec![],
            status: vec![],
            targets: vec![],
            poses: vec![],
            queue: vec![],
        };
        let mut pos = [
            rng.range(0, 30000) as i32,
            rng.range(0, 3000) as i32,
            rng.range(0, 30000) as i32,
        ];
        let mut rotation = random_rotation(&mut rng, &q);
        for f in frames(&mut rng, f0, f1, 60) {
            rotation = nearby_rotation(&mut rng, &q, &rotation);
            // Mostly small moves, now and then a jump too big for 16 bits.
            let spread = if rng.below(20) == 0 { 90_000 } else { 400 };
            for p in &mut pos {
                *p = walk(&mut rng, *p, spread).clamp(-1_000_000, 1_000_000);
            }
            unit.transform.push(TransformKey {
                frame: f,
                position: pos,
                rotation,
            });
        }
        let mut health = 40_000u16;
        for f in frames(&mut rng, f0, f1, 120) {
            health = (health as i64 + rng.range(-9000, 9000)).clamp(0, 65535) as u16;
            unit.status.push(StatusKey {
                frame: f,
                health,
                build_progress: rng.range(0, 65535) as u16,
                flags: rng.below(2) as u8,
            });
        }
        for weapon in 0..=2u8 {
            if rng.below(3) == 0 {
                continue;
            }
            let mut keys = vec![];
            for f in frames(&mut rng, f0, f1, 200) {
                let kind = [0u8, 1, 2, 4, 16, 128, 129][rng.below(7) as usize];
                let reference = match kind {
                    1 | 16 => rng.below(3) as u32,
                    2 => rng.below(5) as u32,
                    4 => 0,
                    _ => 0,
                };
                keys.push(TargetKey {
                    frame: f,
                    kind,
                    reference,
                    build_power: if weapon == 0 { rng.below(256) as u8 } else { 0 },
                    position: if kind >= 128 {
                        [
                            rng.range(0, 30000) as i32,
                            rng.range(0, 3000) as i32,
                            rng.range(0, 30000) as i32,
                        ]
                    } else {
                        [0; 3]
                    },
                });
            }
            unit.targets.push(TargetTrack { weapon, keys });
        }
        if unit.unit_def == 1 {
            for piece in 0..3u16 {
                let mut keys = vec![];
                let mut angles = [0i32; 3];
                let mut offsets = [0i32; 3];
                let spin = rng.below(2) == 0;
                for f in frames(&mut rng, f0, f1, 20) {
                    for a in &mut angles {
                        // A spinning piece gains many turns over the match.
                        *a += if spin {
                            rng.range(1000, 40_000) as i32
                        } else {
                            rng.range(-2000, 2000) as i32
                        };
                    }
                    for o in &mut offsets {
                        *o = walk(&mut rng, *o, 30);
                    }
                    keys.push(PoseKey {
                        frame: f,
                        angles,
                        offsets,
                    });
                }
                unit.poses.push(PoseTrack { piece, keys });
            }
        }
        for f in frames(&mut rng, f0, f1, 300) {
            let n = rng.below(3) as usize;
            unit.queue.push(QueueKey {
                frame: f,
                items: (0..n)
                    .map(|_| QueueItem {
                        unit_def: rng.below(3) as u16,
                        x: rng.range(0, 30000) as i32,
                        z: rng.range(0, 30000) as i32,
                        facing: rng.below(4) as u8,
                    })
                    .collect(),
            });
        }
        track.units.push(unit);
    }

    for serial in 0..(units as u32 * 2) {
        let (f0, f1) = if serial == 0 {
            (first, last)
        } else {
            let a = first + rng.below((last - first) as u64) as u32;
            (a, a + rng.below(((last - a) as u64).min(90) + 1) as u32)
        };
        let mut pos = [
            rng.range(0, 30000) as i32,
            rng.range(0, 3000) as i32,
            rng.range(0, 30000) as i32,
        ];
        let mut keys = vec![];
        let mut fs = frames(&mut rng, f0, f1, 25);
        if *fs.last().unwrap() != f1 {
            fs.push(f1);
        }
        for f in fs {
            let vel = [
                rng.range(-5000, 5000) as i32,
                rng.range(-5000, 5000) as i32,
                rng.range(-5000, 5000) as i32,
            ];
            for p in &mut pos {
                *p = walk(&mut rng, *p, 900);
            }
            keys.push(ProjectileKey {
                frame: f,
                position: pos,
                velocity: vel,
            });
        }
        track.projectiles.push(Projectile {
            serial,
            weapon_def: if serial % 4 == 3 {
                65535
            } else {
                (serial % 2) as u16
            },
            team: 0,
            shooter: if serial % 3 == 0 {
                Some(serial % units as u32)
            } else {
                None
            },
            first_frame: f0,
            last_frame: f1,
            keys,
        });
    }

    // A few points that change several times, so rule 3 has work to do.
    let span = last - first;
    for _ in 0..200u32 {
        let x = rng.below(6) as u16;
        let z = rng.below(6) as u16;
        track.terrain.push(TerrainRow {
            frame: first + rng.below(span as u64 + 1) as u32,
            x,
            z,
            before: 800 + (x as i32 + z as i32) * 8,
            after: 800 + rng.range(-600, 600) as i32,
        });
    }
    track
}
