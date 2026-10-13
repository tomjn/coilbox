//! Checks a written track against the dump it was made from.
//!
//! Every recorded sample is measured against what a reader gets from the
//! file: the window that holds the sample's frame is read back, keys added at
//! its edges included, and the sample is compared with the value
//! `coilbox-track`'s curve functions give from that window's keys. A frame on
//! the edge between two windows is checked in both.
//!
//! Positions and rotations have a tolerance. Everything else has none: a
//! target, a build queue, a flag, a team, and the frames a unit exists on are
//! right or wrong.

use crate::curves::*;
use crate::error::{Result, ThinError, Worst};
use crate::interpret::{
    ProjectileStart, QueueEntry, Rest, Sink, TargetValue, UnitPoint, UnitStart,
};
use crate::pose::PieceSample;
use crate::thin::Curve;
use crate::{KeyCounts, SampleCounts};
use coilbox_track::{held, Header, PoseKey, Quantiser, QueueItem, TargetKey, TrackReader, Window};
use std::collections::HashMap;
use std::io::{Read, Seek};

/// How many windows are kept read. Samples come in frame order but for a
/// unit's last, which is a frame behind, and a frame on an edge is in two
/// windows, so no more than three are in use at once.
const WINDOWS_HELD: usize = 3;

struct Loaded {
    index: usize,
    window: Window,
    units: HashMap<u32, usize>,
    projectiles: HashMap<u32, usize>,
}

struct Expected {
    start: UnitStart,
    targets: Vec<(u8, TargetValue)>,
    queue: Vec<QueueItem>,
    /// Each posed piece as it was last recorded.
    pieces: Vec<(u16, PieceSample)>,
}

/// The furthest sample of each kind.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WorstErrors {
    /// A unit's position and rotation, in elmos.
    pub transform: Option<Worst>,
    /// A piece, in elmos.
    pub pose: Option<Worst>,
    /// A projectile's position, in elmos.
    pub projectile: Option<Worst>,
    /// Health or build progress, as a fraction.
    pub status: Option<Worst>,
}

impl WorstErrors {
    /// The furthest any sample is from the track, in elmos.
    pub fn elmos(&self) -> Option<&Worst> {
        [&self.transform, &self.pose, &self.projectile]
            .into_iter()
            .flatten()
            .max_by(|a, b| a.error.total_cmp(&b.error))
    }
}

fn note(slot: &mut Option<Worst>, error: f64, frame: u32, what: impl FnOnce() -> String) {
    if slot.as_ref().is_none_or(|w| error > w.error) {
        *slot = Some(Worst {
            error,
            what: what(),
            frame,
        });
    }
}

fn mismatch(reason: String) -> ThinError {
    ThinError::Mismatch(reason)
}

pub(crate) struct Verifier<R> {
    reader: TrackReader<R>,
    header: Header,
    q: Quantiser,
    loaded: Vec<Loaded>,
    units: HashMap<u32, Expected>,
    projectiles: HashMap<u32, ProjectileStart>,
    pub worst: WorstErrors,
    pub samples: SampleCounts,
}

impl Expected {
    fn name(&self) -> String {
        format!(
            "unit {} ({}, engine id {})",
            self.start.serial, self.start.def_name, self.start.engine_id
        )
    }
}

impl<R: Read + Seek> Verifier<R> {
    pub fn new(reader: TrackReader<R>) -> Result<Self> {
        Ok(Self {
            header: reader.header().clone(),
            q: reader.quantiser()?,
            reader,
            loaded: Vec::new(),
            units: HashMap::new(),
            projectiles: HashMap::new(),
            worst: WorstErrors::default(),
            samples: SampleCounts::default(),
        })
    }

    /// The windows that hold `frame`: one, or two for a frame on an edge.
    fn windows_of(&self, frame: u32) -> Result<Vec<usize>> {
        let h = &self.header;
        if frame < h.first_frame || frame > h.last_frame {
            return Err(mismatch(format!(
                "the dump has frame {frame} and the track runs from {} to {}",
                h.first_frame, h.last_frame
            )));
        }
        let into = frame - h.first_frame;
        let k = (into / h.window_length) as usize;
        let count = h.window_count as usize;
        let mut out = Vec::with_capacity(2);
        if k >= 1 && into.is_multiple_of(h.window_length) {
            out.push(k - 1);
        }
        if k < count {
            out.push(k);
        }
        Ok(out)
    }

    fn load(&mut self, k: usize) -> Result<usize> {
        if let Some(at) = self.loaded.iter().position(|l| l.index == k) {
            return Ok(at);
        }
        let window = self.reader.window(k)?;
        let units = window
            .units
            .iter()
            .enumerate()
            .map(|(i, u)| (u.unit.serial, i))
            .collect();
        let projectiles = window
            .projectiles
            .iter()
            .enumerate()
            .map(|(i, p)| (p.projectile.serial, i))
            .collect();
        if self.loaded.len() == WINDOWS_HELD {
            self.loaded.remove(0);
        }
        self.loaded.push(Loaded {
            index: k,
            window,
            units,
            projectiles,
        });
        Ok(self.loaded.len() - 1)
    }

    /// Checks one end of a unit's or projectile's life against each window
    /// that holds the frame.
    fn check_end(&mut self, what: &str, serial: u32, frame: u32, first: bool) -> Result<()> {
        let is_unit = what == "unit";
        for k in self.windows_of(frame)? {
            let at = self.load(k)?;
            let l = &self.loaded[at];
            let found = if is_unit {
                l.units.get(&serial).map(|i| {
                    let u = &l.window.units[*i];
                    (u.unit.first_frame, u.unit.last_frame)
                })
            } else {
                l.projectiles.get(&serial).map(|i| {
                    let p = &l.window.projectiles[*i];
                    (p.projectile.first_frame, p.projectile.last_frame)
                })
            };
            let Some((from, to)) = found else {
                return Err(mismatch(format!(
                    "{what} {serial} exists on frame {frame} and is not in window {k}"
                )));
            };
            if (first && from != frame) || (!first && to != frame) {
                return Err(mismatch(format!(
                    "{what} {serial} {} on frame {frame}, and window {k} has it from {from} to {to}",
                    if first { "starts" } else { "ends" }
                )));
            }
        }
        Ok(())
    }

    fn target_key(&self, frame: u32, value: &TargetValue) -> Result<TargetKey> {
        Ok(TargetKey {
            frame,
            kind: value.kind,
            reference: value.reference,
            build_power: value.build_power,
            position: if value.kind >= 128 {
                [
                    self.q.position(value.position[0])?,
                    self.q.position(value.position[1])?,
                    self.q.position(value.position[2])?,
                ]
            } else {
                [0; 3]
            },
        })
    }

    /// The header and everything that is not a curve, then the keys the file
    /// holds, counted.
    pub fn finish(mut self, rest: &Rest) -> Result<(WorstErrors, SampleCounts, KeyCounts)> {
        let h = &self.header;
        let same = |what: &str, track: u64, dump: u64| {
            if track == dump {
                Ok(())
            } else {
                Err(mismatch(format!(
                    "the track's {what} is {track} and the dump's is {dump}"
                )))
            }
        };
        same("first frame", h.first_frame as u64, rest.first_frame as u64)?;
        same("last frame", h.last_frame as u64, rest.last_frame as u64)?;
        same("unit count", h.unit_count as u64, rest.units as u64)?;
        same(
            "projectile count",
            h.projectile_count as u64,
            rest.projectiles as u64,
        )?;
        if self.reader.info()? != rest.info {
            return Err(mismatch("the info chunk is not the dump's".into()));
        }
        if self.reader.features()? != rest.features {
            return Err(mismatch("the features are not the dump's".into()));
        }

        // Terrain is compared by the ground it ends with, since a writer
        // drops rows that change nothing.
        let mut expected: HashMap<(u16, u16), (i32, i32)> = HashMap::new();
        let mut rows = rest.terrain.clone();
        rows.sort_by_key(|r| r.frame);
        for r in &rows {
            expected
                .entry((r.x, r.z))
                .and_modify(|e| e.1 = r.after)
                .or_insert((r.before, r.after));
        }
        let mut written: HashMap<(u16, u16), i32> = HashMap::new();
        let mut keys = KeyCounts::default();
        for k in 0..h.window_count as usize {
            for r in self.reader.terrain(k)? {
                written.insert((r.x, r.z), r.after);
                keys.terrain_rows += 1;
            }
        }
        for (corner, (before, after)) in &expected {
            let ends = written.get(corner).copied().unwrap_or(*before);
            if ends != *after {
                return Err(mismatch(format!(
                    "heightmap corner {corner:?} ends at {ends} steps in the track and {after} in the dump"
                )));
            }
        }
        if let Some(corner) = written.keys().find(|c| !expected.contains_key(c)) {
            return Err(mismatch(format!(
                "the track changes heightmap corner {corner:?} and the dump does not"
            )));
        }

        keys.features = rest.features.len() as u64;
        for k in 0..h.window_count as usize {
            keys.add_window(&self.reader.window(k)?);
        }
        Ok((self.worst, self.samples, keys))
    }
}

impl<R: Read + Seek> Sink for Verifier<R> {
    fn unit_start(&mut self, start: &UnitStart) -> Result<()> {
        self.check_end("unit", start.serial, start.frame, true)?;
        self.units.insert(
            start.serial,
            Expected {
                start: start.clone(),
                targets: vec![],
                queue: vec![],
                pieces: vec![],
            },
        );
        Ok(())
    }

    fn unit_point(&mut self, serial: u32, point: &UnitPoint) -> Result<()> {
        self.samples.units += 1;
        let frame = point.frame;
        for k in self.windows_of(frame)? {
            let at = self.load(k)?;
            let l = &self.loaded[at];
            let e = &self.units[&serial];
            let wrong = |what: String| mismatch(format!("{} on frame {frame}: {what}", e.name()));
            let unit = match l.units.get(&serial) {
                Some(i) => &l.window.units[*i].unit,
                None => return Err(wrong(format!("it is not in window {k}"))),
            };
            if frame < unit.first_frame || frame > unit.last_frame {
                return Err(wrong(format!(
                    "window {k} has it from {} to {}",
                    unit.first_frame, unit.last_frame
                )));
            }
            if (unit.engine_id, unit.unit_def, unit.team)
                != (e.start.engine_id, e.start.def, e.start.team)
            {
                return Err(wrong("its id, definition or team is not the dump's".into()));
            }

            let radius = e.start.radius;
            let error = TransformCurve { radius }.error(
                &self.q,
                &unit.transform,
                &TransformSample {
                    frame,
                    position: point.position,
                    rotation: point.rotation,
                },
            );
            note(&mut self.worst.transform, error, frame, || e.name());

            let error = StatusCurve.error(
                &self.q,
                &unit.status,
                &StatusSample {
                    frame,
                    health: point.health,
                    build: point.build,
                    flags: point.flags,
                },
            );
            if error.is_infinite() {
                return Err(wrong("its flags are not the dump's".into()));
            }
            note(&mut self.worst.status, error, frame, || {
                format!("the health or build progress of {}", e.name())
            });

            // Every weapon the dump or the track has a target for.
            let mut weapons: Vec<u8> = e.targets.iter().map(|(w, _)| *w).collect();
            weapons.extend(unit.targets.iter().map(|t| t.weapon));
            weapons.sort_unstable();
            weapons.dedup();
            for weapon in weapons {
                let value = e
                    .targets
                    .iter()
                    .find(|(w, _)| *w == weapon)
                    .map_or(TargetValue::NOTHING, |(_, v)| *v);
                let want = self.target_key(frame, &value)?;
                let mut got = unit
                    .targets
                    .iter()
                    .find(|t| t.weapon == weapon)
                    .and_then(|t| held(&t.keys, frame))
                    .cloned()
                    .unwrap_or(TargetKey {
                        frame,
                        kind: 0,
                        reference: 0,
                        build_power: 0,
                        position: [0; 3],
                    });
                // A window names a unit or a projectile by its place in the
                // window's own list.
                got.frame = frame;
                got.reference = match got.kind {
                    1 | 16 | 17 | 20 => l
                        .window
                        .units
                        .get(got.reference as usize)
                        .map(|u| u.unit.serial)
                        .ok_or_else(|| {
                            wrong("a target names a unit past the window's end".into())
                        })?,
                    4 => l
                        .window
                        .projectiles
                        .get(got.reference as usize)
                        .map(|p| p.projectile.serial)
                        .ok_or_else(|| {
                            wrong("a target names a projectile past the window's end".into())
                        })?,
                    _ => got.reference,
                };
                if got != want {
                    return Err(wrong(format!(
                        "weapon {weapon} has {got:?} in window {k} and {want:?} in the dump"
                    )));
                }
            }

            let got = held(&unit.queue, frame).map_or(&[][..], |k| &k.items[..]);
            if got != &e.queue[..] {
                return Err(wrong(format!(
                    "its build queue in window {k} is not the dump's"
                )));
            }

            for (piece, sample) in &e.pieces {
                let curve = PoseCurve {
                    reach: sample.reach,
                };
                // A piece with no track in a window is at rest for all of it.
                let rest = [PoseKey {
                    frame,
                    angles: [0; 3],
                    offsets: [0; 3],
                }];
                let keys = unit
                    .poses
                    .iter()
                    .find(|p| p.piece == *piece)
                    .map_or(&rest[..], |p| &p.keys[..]);
                let error = curve.error(
                    &self.q,
                    keys,
                    &PoseSample {
                        frame,
                        piece: *sample,
                        angles: [0.0; 3],
                    },
                );
                note(&mut self.worst.pose, error, frame, || {
                    format!("posed piece {piece} of {}", e.name())
                });
            }
        }
        Ok(())
    }

    fn target(&mut self, serial: u32, _: u32, weapon: u8, target: &TargetValue) -> Result<()> {
        let e = self.units.get_mut(&serial).expect("started");
        match e.targets.iter_mut().find(|(w, _)| *w == weapon) {
            Some((_, slot)) => *slot = *target,
            None => e.targets.push((weapon, *target)),
        }
        Ok(())
    }

    fn queue(&mut self, serial: u32, _: u32, items: &[QueueEntry]) -> Result<()> {
        let mut queue = Vec::with_capacity(items.len());
        for item in items {
            queue.push(QueueItem {
                unit_def: item.def,
                x: self.q.position(item.x)?,
                z: self.q.position(item.z)?,
                facing: item.facing,
            });
        }
        self.units.get_mut(&serial).expect("started").queue = queue;
        Ok(())
    }

    fn piece(&mut self, serial: u32, _: u32, piece: u16, sample: &PieceSample) -> Result<()> {
        self.samples.poses += 1;
        let e = self.units.get_mut(&serial).expect("started");
        match e.pieces.iter_mut().find(|(p, _)| *p == piece) {
            Some((_, slot)) => *slot = *sample,
            None => e.pieces.push((piece, *sample)),
        }
        Ok(())
    }

    fn unit_end(&mut self, serial: u32, last_frame: u32) -> Result<()> {
        self.check_end("unit", serial, last_frame, false)?;
        self.units.remove(&serial);
        Ok(())
    }

    fn projectile_start(&mut self, start: &ProjectileStart) -> Result<()> {
        self.check_end("projectile", start.serial, start.frame, true)?;
        self.projectiles.insert(start.serial, start.clone());
        Ok(())
    }

    fn projectile_point(
        &mut self,
        serial: u32,
        frame: u32,
        position: [f64; 3],
        velocity: [f64; 3],
    ) -> Result<()> {
        self.samples.projectiles += 1;
        for k in self.windows_of(frame)? {
            let at = self.load(k)?;
            let l = &self.loaded[at];
            let e = &self.projectiles[&serial];
            let wrong =
                |what: String| mismatch(format!("projectile {serial} on frame {frame}: {what}"));
            let p = match l.projectiles.get(&serial) {
                Some(i) => &l.window.projectiles[*i].projectile,
                None => return Err(wrong(format!("it is not in window {k}"))),
            };
            if frame < p.first_frame || frame > p.last_frame {
                return Err(wrong(format!(
                    "window {k} has it from {} to {}",
                    p.first_frame, p.last_frame
                )));
            }
            // A shooter that is not in the window counts as none.
            let shooter = e.shooter.filter(|s| l.units.contains_key(s));
            let got = p
                .shooter
                .and_then(|i| l.window.units.get(i as usize))
                .map(|u| u.unit.serial);
            if (p.weapon_def, p.team, got) != (e.weapon_def, e.team, shooter) {
                return Err(wrong(
                    "its definition, team or firing unit is not the dump's".into(),
                ));
            }
            let error = ProjectileCurve.error(
                &self.q,
                &p.keys,
                &ProjectileSample {
                    frame,
                    position,
                    velocity,
                },
            );
            note(&mut self.worst.projectile, error, frame, || {
                format!("projectile {serial}")
            });
        }
        Ok(())
    }

    fn projectile_end(&mut self, serial: u32, last_frame: u32) -> Result<()> {
        self.check_end("projectile", serial, last_frame, false)?;
        self.projectiles.remove(&serial);
        Ok(())
    }
}
