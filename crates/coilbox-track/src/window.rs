//! One window's main chunk: the units and projectiles that exist at some
//! frame of it, with their keys.
//!
//! A window stands alone. Everything a reader needs for any frame inside it is
//! here, so a seek reads one window and never the whole match.

use crate::chunk::Chunk;
use crate::curve::{self, held};
use crate::error::{Result, TrackError};
use crate::keys::*;
use crate::quant::{check_limit, Quantiser, VALUE_LIMIT};

/// A narrow value that stands for "the next wide value".
const ESCAPE: i16 = i16::MIN;
/// A shooter that is not in the window, or a projectile that has none.
const NO_INDEX: u16 = 65_535;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowUnit {
    /// `first_frame` and `last_frame` are the first and last frame of the
    /// window at which the unit exists. References in target keys are indices
    /// in [`Window::units`] and [`Window::projectiles`].
    pub unit: Unit,
    pub continues_before: bool,
    pub continues_after: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowProjectile {
    /// `shooter` is an index in [`Window::units`].
    pub projectile: Projectile,
    pub continues_before: bool,
    pub continues_after: bool,
}

/// The contents of one window's main chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub index: usize,
    /// The window's first and last frame. A frame on the boundary between two
    /// windows is in both.
    pub start_frame: u32,
    pub end_frame: u32,
    pub units: Vec<WindowUnit>,
    pub projectiles: Vec<WindowProjectile>,
}

fn corrupt(reason: impl Into<String>) -> TrackError {
    TrackError::corrupt("main chunk", reason)
}

// Encoding.

#[derive(Default)]
struct Escaped {
    narrow: Vec<i16>,
    wide: Vec<i32>,
}

impl Escaped {
    /// Adds one key's value. The first key of a curve is always an escape.
    fn push(&mut self, running: &mut Option<i32>, value: i32, what: &str) -> Result<()> {
        check_limit(|| what.to_string(), value as i64)?;
        let diff = running.map(|r| value as i64 - r as i64);
        match diff {
            Some(d) if d > ESCAPE as i64 && d <= i16::MAX as i64 => self.narrow.push(d as i16),
            _ => {
                self.narrow.push(ESCAPE);
                self.wide.push(value);
            }
        }
        *running = Some(value);
        Ok(())
    }
}

fn offset(frame: u32, previous: u32, what: &str) -> Result<u16> {
    let gap = frame.checked_sub(previous).ok_or_else(|| {
        TrackError::invalid(format!(
            "{what} has a key at frame {frame}, before frame {previous}"
        ))
    })?;
    u16::try_from(gap).map_err(|_| TrackError::OutOfRange {
        what: format!("the frames between two keys of {what}"),
        value: gap as i64,
        limit: u16::MAX as i64,
    })
}

/// Time column values for one curve. A curve's keys must rise in frame, and
/// the first is counted from the window's first frame.
fn push_times(
    out: &mut Vec<u16>,
    keys: impl Iterator<Item = u32>,
    start: u32,
    what: &str,
) -> Result<()> {
    let mut previous = start;
    for (i, frame) in keys.enumerate() {
        let gap = offset(frame, previous, what)?;
        if i > 0 && gap == 0 {
            return Err(TrackError::invalid(format!(
                "{what} has two keys at frame {frame}"
            )));
        }
        out.push(gap);
        previous = frame;
    }
    Ok(())
}

fn count16(n: usize, what: &str) -> Result<u16> {
    u16::try_from(n).map_err(|_| TrackError::OutOfRange {
        what: what.to_string(),
        value: n as i64,
        limit: u16::MAX as i64,
    })
}

/// Wrapping difference. `running` starts at 0 for each curve.
fn wrap(running: &mut u16, value: u16) -> u16 {
    let d = value.wrapping_sub(*running);
    *running = value;
    d
}

fn flags(before: bool, after: bool) -> u8 {
    before as u8 | (after as u8) << 1
}

impl Window {
    /// The main chunk as columns.
    pub fn to_chunk(&self) -> Result<Chunk> {
        let start = self.start_frame;
        let mut c = Chunk::new();

        let mut unit_cols = (
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        let mut transform_time = Vec::new();
        let mut xyz: [Escaped; 3] = Default::default();
        let mut dropped = Vec::new();
        let mut kept: [Vec<u16>; 3] = Default::default();
        let mut status_time = Vec::new();
        let (mut health, mut build, mut status_flags) = (Vec::new(), Vec::new(), Vec::new());
        let mut track_weapon = Vec::new();
        let mut track_keys = Vec::new();
        let mut target_time = Vec::new();
        let (mut kind, mut reference, mut power) = (Vec::new(), Vec::new(), Vec::new());
        let mut target_pos: [Vec<i32>; 3] = Default::default();
        let mut piece = Vec::new();
        let mut pose_keys = Vec::new();
        let mut pose_time = Vec::new();
        let mut angles: [Escaped; 3] = Default::default();
        let mut offsets: [Escaped; 3] = Default::default();
        let mut queue_time = Vec::new();
        let mut queue_len = Vec::new();
        let (mut item_def, mut item_x, mut item_z, mut item_facing) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());

        for wu in &self.units {
            let u = &wu.unit;
            let what = format!("unit {}", u.serial);
            unit_cols.0.push(u.engine_id);
            unit_cols.1.push(u.serial);
            unit_cols.2.push(u.unit_def);
            unit_cols.3.push(u.team);
            unit_cols
                .4
                .push(flags(wu.continues_before, wu.continues_after));
            unit_cols.5.push(offset(u.first_frame, start, &what)?);
            unit_cols.6.push(offset(u.last_frame, start, &what)?);
            unit_cols.7.push(count16(
                u.transform.len(),
                &format!("the transform keys of {what}"),
            )?);
            unit_cols.8.push(count16(
                u.status.len(),
                &format!("the status keys of {what}"),
            )?);
            unit_cols.9.push(u8::try_from(u.targets.len()).map_err(|_| {
                TrackError::OutOfRange {
                    what: format!("the target tracks of {what}"),
                    value: u.targets.len() as i64,
                    limit: u8::MAX as i64,
                }
            })?);
            unit_cols.10.push(count16(
                u.poses.len(),
                &format!("the pose tracks of {what}"),
            )?);
            unit_cols.11.push(count16(
                u.queue.len(),
                &format!("the build queue keys of {what}"),
            )?);

            push_times(
                &mut transform_time,
                u.transform.iter().map(|k| k.frame),
                start,
                &what,
            )?;
            let mut running = [None; 3];
            let mut wrapped = [0u16; 3];
            for k in &u.transform {
                for a in 0..3 {
                    xyz[a].push(
                        &mut running[a],
                        k.position[a],
                        &format!("a position of {what}"),
                    )?;
                }
                dropped.push(k.rotation.dropped);
                for a in 0..3 {
                    kept[a].push(wrap(&mut wrapped[a], k.rotation.kept[a] as u16));
                }
            }

            push_times(
                &mut status_time,
                u.status.iter().map(|k| k.frame),
                start,
                &what,
            )?;
            let (mut h, mut b) = (0u16, 0u16);
            for k in &u.status {
                health.push(wrap(&mut h, k.health));
                build.push(wrap(&mut b, k.build_progress));
                status_flags.push(k.flags);
            }

            for t in &u.targets {
                let what = format!("a target track of {what}");
                track_weapon.push(t.weapon);
                track_keys.push(count16(t.keys.len(), &what)?);
                push_times(
                    &mut target_time,
                    t.keys.iter().map(|k| k.frame),
                    start,
                    &what,
                )?;
                for k in &t.keys {
                    kind.push(k.kind);
                    reference.push(k.reference);
                    power.push(k.build_power);
                    if k.kind >= 128 {
                        for (col, v) in target_pos.iter_mut().zip(k.position) {
                            col.push(v);
                        }
                    }
                }
            }

            for p in &u.poses {
                let what = format!("a pose track of {what}");
                piece.push(p.piece);
                pose_keys.push(count16(p.keys.len(), &what)?);
                push_times(&mut pose_time, p.keys.iter().map(|k| k.frame), start, &what)?;
                let mut ra = [None; 3];
                let mut ro = [None; 3];
                for k in &p.keys {
                    for a in 0..3 {
                        angles[a].push(&mut ra[a], k.angles[a], &format!("an angle of {what}"))?;
                        offsets[a].push(
                            &mut ro[a],
                            k.offsets[a],
                            &format!("an offset of {what}"),
                        )?;
                    }
                }
            }

            push_times(
                &mut queue_time,
                u.queue.iter().map(|k| k.frame),
                start,
                &format!("the build queue of {what}"),
            )?;
            for k in &u.queue {
                queue_len.push(u8::try_from(k.items.len()).map_err(|_| {
                    TrackError::OutOfRange {
                        what: format!("the items in a build queue of {what}"),
                        value: k.items.len() as i64,
                        limit: u8::MAX as i64,
                    }
                })?);
                for i in &k.items {
                    item_def.push(i.unit_def);
                    item_x.push(i.x);
                    item_z.push(i.z);
                    item_facing.push(i.facing);
                }
            }
        }

        c.set_u16(1, unit_cols.0);
        c.set_u32(2, unit_cols.1);
        c.set_u16(3, unit_cols.2);
        c.set_u8(4, unit_cols.3);
        c.set_u8(5, unit_cols.4);
        c.set_u16(6, unit_cols.5);
        c.set_u16(7, unit_cols.6);
        c.set_u16(8, unit_cols.7);
        c.set_u16(9, unit_cols.8);
        // A column that is not listed is 0 for every unit.
        if unit_cols.9.iter().any(|n| *n != 0) {
            c.set_u8(10, unit_cols.9);
        }
        if unit_cols.10.iter().any(|n| *n != 0) {
            c.set_u16(11, unit_cols.10);
        }
        if unit_cols.11.iter().any(|n| *n != 0) {
            c.set_u16(12, unit_cols.11);
        }
        c.set_u16(16, transform_time);
        let [x, y, z] = xyz;
        for (i, e) in [x, y, z].into_iter().enumerate() {
            c.set_s16(17 + i as u16, e.narrow);
            c.set_s32(20 + i as u16, e.wide);
        }
        c.set_u8(23, dropped);
        let [k0, k1, k2] = kept;
        c.set_u16(24, k0);
        c.set_u16(25, k1);
        c.set_u16(26, k2);
        c.set_u16(32, status_time);
        c.set_u16(33, health);
        c.set_u16(34, build);
        c.set_u8(35, status_flags);
        c.set_u8(40, track_weapon);
        c.set_u16(41, track_keys);
        c.set_u16(42, target_time);
        c.set_u8(43, kind);
        c.set_u32(44, reference);
        c.set_u8(45, power);
        let [tx, ty, tz] = target_pos;
        c.set_s32(46, tx);
        c.set_s32(47, ty);
        c.set_s32(48, tz);
        c.set_u16(56, piece);
        c.set_u16(57, pose_keys);
        c.set_u16(58, pose_time);
        for (i, e) in angles.into_iter().enumerate() {
            c.set_s16(59 + i as u16, e.narrow);
            c.set_s32(62 + i as u16, e.wide);
        }
        for (i, e) in offsets.into_iter().enumerate() {
            c.set_s16(65 + i as u16, e.narrow);
            c.set_s32(68 + i as u16, e.wide);
        }
        c.set_u16(72, queue_time);
        c.set_u8(73, queue_len);
        c.set_u16(74, item_def);
        c.set_s32(75, item_x);
        c.set_s32(76, item_z);
        c.set_u8(77, item_facing);

        self.projectiles_to_chunk(&mut c)?;
        Ok(c)
    }

    fn projectiles_to_chunk(&self, c: &mut Chunk) -> Result<()> {
        let start = self.start_frame;
        let (mut serial, mut weapon, mut team, mut fl) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let (mut shooter, mut first, mut last, mut count) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let mut time = Vec::new();
        let mut pos: [Escaped; 3] = Default::default();
        let mut vel: [Escaped; 3] = Default::default();
        for wp in &self.projectiles {
            let p = &wp.projectile;
            let what = format!("projectile {}", p.serial);
            serial.push(p.serial);
            weapon.push(p.weapon_def);
            team.push(p.team);
            fl.push(flags(wp.continues_before, wp.continues_after));
            shooter.push(match p.shooter {
                None => NO_INDEX,
                Some(i) => u16::try_from(i)
                    .ok()
                    .filter(|i| *i != NO_INDEX)
                    .ok_or_else(|| TrackError::OutOfRange {
                        what: format!("the shooter index of {what}"),
                        value: i as i64,
                        limit: NO_INDEX as i64 - 1,
                    })?,
            });
            first.push(offset(p.first_frame, start, &what)?);
            last.push(offset(p.last_frame, start, &what)?);
            count.push(count16(p.keys.len(), &format!("the keys of {what}"))?);
            push_times(&mut time, p.keys.iter().map(|k| k.frame), start, &what)?;
            let mut rp = [None; 3];
            let mut rv = [None; 3];
            for k in &p.keys {
                for a in 0..3 {
                    pos[a].push(&mut rp[a], k.position[a], &format!("a position of {what}"))?;
                    vel[a].push(&mut rv[a], k.velocity[a], &format!("a velocity of {what}"))?;
                }
            }
        }
        c.set_u32(80, serial);
        c.set_u16(81, weapon);
        c.set_u8(82, team);
        c.set_u8(83, fl);
        c.set_u16(84, shooter);
        c.set_u16(85, first);
        c.set_u16(86, last);
        c.set_u16(87, count);
        c.set_u16(88, time);
        for (i, e) in pos.into_iter().enumerate() {
            c.set_s16(89 + i as u16, e.narrow);
            c.set_s32(92 + i as u16, e.wide);
        }
        for (i, e) in vel.into_iter().enumerate() {
            c.set_s16(95 + i as u16, e.narrow);
            c.set_s32(98 + i as u16, e.wide);
        }
        Ok(())
    }
}

// Decoding.

/// The next `n` values of a column, or an error if it has fewer.
fn take<'a, T>(col: &'a [T], pos: &mut usize, n: usize, id: u16) -> Result<&'a [T]> {
    let end = pos
        .checked_add(n)
        .filter(|e| *e <= col.len())
        .ok_or_else(|| {
            corrupt(format!(
                "column {id} has {} values and the units need more",
                col.len()
            ))
        })?;
    let out = &col[*pos..end];
    *pos = end;
    Ok(out)
}

/// A column that must have exactly `n` values.
fn exactly<T>(col: &[T], n: usize, id: u16) -> Result<&[T]> {
    if col.len() != n {
        return Err(corrupt(format!(
            "column {id} has {} values, not {n}",
            col.len()
        )));
    }
    Ok(col)
}

/// A count column that is left out when it is 0 for every unit.
fn counts<T: Copy + Into<usize>>(col: &[T], n: usize, id: u16) -> Result<Vec<usize>> {
    if col.is_empty() {
        return Ok(vec![0; n]);
    }
    Ok(exactly(col, n, id)?.iter().map(|c| (*c).into()).collect())
}

fn frames(raw: &[u16], start: u32, what: &str) -> Result<Vec<u32>> {
    let mut out = Vec::with_capacity(raw.len());
    let mut at = start;
    for (i, gap) in raw.iter().enumerate() {
        if i > 0 && *gap == 0 {
            return Err(corrupt(format!("{what} has two keys at frame {at}")));
        }
        at += *gap as u32;
        out.push(at);
    }
    Ok(out)
}

/// A wide column and how far into it the curves have read.
struct Wide<'a> {
    id: u16,
    values: &'a [i32],
    pos: usize,
}

impl Wide<'_> {
    /// The values of one curve from its narrow values.
    fn curve(&mut self, narrow: &[i16]) -> Result<Vec<i32>> {
        let mut out = Vec::with_capacity(narrow.len());
        let mut running: Option<i64> = None;
        for d in narrow {
            let value = if *d == ESCAPE {
                let v = *self.values.get(self.pos).ok_or_else(|| {
                    corrupt(format!("column {} runs out of wide values", self.id))
                })?;
                self.pos += 1;
                v as i64
            } else {
                match running {
                    Some(r) => r + *d as i64,
                    None => return Err(corrupt("a curve's first key is not an escape")),
                }
            };
            if value.abs() > VALUE_LIMIT {
                return Err(corrupt(format!("a value of {value} is over {VALUE_LIMIT}")));
            }
            running = Some(value);
            out.push(value as i32);
        }
        Ok(out)
    }

    fn finished(&self) -> Result<()> {
        if self.pos != self.values.len() {
            return Err(corrupt(format!(
                "column {} has {} values and the curves use {}",
                self.id,
                self.values.len(),
                self.pos
            )));
        }
        Ok(())
    }
}

fn wide3<'a>(c: &'a Chunk, ids: [u16; 3]) -> Result<[Wide<'a>; 3]> {
    Ok([
        Wide {
            id: ids[0],
            values: c.s32s(ids[0])?,
            pos: 0,
        },
        Wide {
            id: ids[1],
            values: c.s32s(ids[1])?,
            pos: 0,
        },
        Wide {
            id: ids[2],
            values: c.s32s(ids[2])?,
            pos: 0,
        },
    ])
}

fn narrow3(c: &Chunk, ids: [u16; 3]) -> Result<[&[i16]; 3]> {
    Ok([c.s16s(ids[0])?, c.s16s(ids[1])?, c.s16s(ids[2])?])
}

/// The values of one curve on three axes.
fn curve3(
    narrow: &[&[i16]; 3],
    pos: usize,
    n: usize,
    ids: [u16; 3],
    wide: &mut [Wide; 3],
) -> Result<[Vec<i32>; 3]> {
    let mut one = |a: usize| -> Result<Vec<i32>> {
        let mut p = pos;
        wide[a].curve(take(narrow[a], &mut p, n, ids[a])?)
    };
    Ok([one(0)?, one(1)?, one(2)?])
}

impl Window {
    /// Reads a main chunk. `index`, `start_frame` and `end_frame` say which
    /// window it is, since the chunk itself holds only offsets.
    pub fn from_chunk(c: &Chunk, index: usize, start_frame: u32, end_frame: u32) -> Result<Self> {
        let engine_ids = c.u16s(1)?;
        let n = engine_ids.len();
        let serials = exactly(c.u32s(2)?, n, 2)?;
        let defs = exactly(c.u16s(3)?, n, 3)?;
        let teams = exactly(c.u8s(4)?, n, 4)?;
        let unit_flags = exactly(c.u8s(5)?, n, 5)?;
        let firsts = exactly(c.u16s(6)?, n, 6)?;
        let lasts = exactly(c.u16s(7)?, n, 7)?;
        let n_transform = counts(c.u16s(8)?, n, 8)?;
        let n_status = counts(c.u16s(9)?, n, 9)?;
        let n_targets = counts(c.u8s(10)?, n, 10)?;
        let n_poses = counts(c.u16s(11)?, n, 11)?;
        let n_queue = counts(c.u16s(12)?, n, 12)?;

        let mut units: Vec<WindowUnit> = (0..n)
            .map(|i| WindowUnit {
                unit: Unit {
                    engine_id: engine_ids[i],
                    serial: serials[i],
                    unit_def: defs[i],
                    team: teams[i],
                    first_frame: start_frame + firsts[i] as u32,
                    last_frame: start_frame + lasts[i] as u32,
                    transform: vec![],
                    status: vec![],
                    targets: vec![],
                    poses: vec![],
                    queue: vec![],
                },
                continues_before: unit_flags[i] & 1 != 0,
                continues_after: unit_flags[i] & 2 != 0,
            })
            .collect();

        decode_transform(c, &mut units, &n_transform, start_frame)?;
        decode_status(c, &mut units, &n_status, start_frame)?;
        decode_targets(c, &mut units, &n_targets, start_frame)?;
        decode_poses(c, &mut units, &n_poses, start_frame)?;
        decode_queue(c, &mut units, &n_queue, start_frame)?;
        let projectiles = decode_projectiles(c, start_frame)?;

        Ok(Window {
            index,
            start_frame,
            end_frame,
            units,
            projectiles,
        })
    }
}

fn decode_transform(
    c: &Chunk,
    units: &mut [WindowUnit],
    counts: &[usize],
    start: u32,
) -> Result<()> {
    let total: usize = counts.iter().sum();
    let times = exactly(c.u16s(16)?, total, 16)?;
    let narrow = narrow3(c, [17, 18, 19])?;
    let mut wide = wide3(c, [20, 21, 22])?;
    let dropped = exactly(c.u8s(23)?, total, 23)?;
    let kept = [
        exactly(c.u16s(24)?, total, 24)?,
        exactly(c.u16s(25)?, total, 25)?,
        exactly(c.u16s(26)?, total, 26)?,
    ];
    for (a, col) in narrow.iter().enumerate() {
        exactly(col, total, 17 + a as u16)?;
    }
    let mut pos = 0;
    for (u, k) in units.iter_mut().zip(counts) {
        let what = format!("the transform keys of unit {}", u.unit.serial);
        let at = frames(&times[pos..pos + k], start, &what)?;
        let p = curve3(&narrow, pos, *k, [17, 18, 19], &mut wide)?;
        let mut running = [0u16; 3];
        for i in 0..*k {
            let mut rot = Rotation {
                dropped: dropped[pos + i],
                kept: [0; 3],
            };
            if rot.dropped > 3 {
                return Err(corrupt(format!("{what} drop component {}", rot.dropped)));
            }
            for a in 0..3 {
                running[a] = running[a].wrapping_add(kept[a][pos + i]);
                rot.kept[a] = running[a] as i16;
            }
            u.unit.transform.push(TransformKey {
                frame: at[i],
                position: [p[0][i], p[1][i], p[2][i]],
                rotation: rot,
            });
        }
        pos += k;
    }
    wide.iter().try_for_each(Wide::finished)
}

fn decode_status(c: &Chunk, units: &mut [WindowUnit], counts: &[usize], start: u32) -> Result<()> {
    let total: usize = counts.iter().sum();
    let times = exactly(c.u16s(32)?, total, 32)?;
    let health = exactly(c.u16s(33)?, total, 33)?;
    let build = exactly(c.u16s(34)?, total, 34)?;
    let flags = exactly(c.u8s(35)?, total, 35)?;
    let mut pos = 0;
    for (u, k) in units.iter_mut().zip(counts) {
        let what = format!("the status keys of unit {}", u.unit.serial);
        let at = frames(&times[pos..pos + k], start, &what)?;
        let (mut h, mut b) = (0u16, 0u16);
        for i in 0..*k {
            h = h.wrapping_add(health[pos + i]);
            b = b.wrapping_add(build[pos + i]);
            u.unit.status.push(StatusKey {
                frame: at[i],
                health: h,
                build_progress: b,
                flags: flags[pos + i],
            });
        }
        pos += k;
    }
    Ok(())
}

fn decode_targets(c: &Chunk, units: &mut [WindowUnit], counts: &[usize], start: u32) -> Result<()> {
    let tracks: usize = counts.iter().sum();
    let weapons = exactly(c.u8s(40)?, tracks, 40)?;
    let n_keys: Vec<usize> = exactly(c.u16s(41)?, tracks, 41)?
        .iter()
        .map(|n| *n as usize)
        .collect();
    let total: usize = n_keys.iter().sum();
    let times = exactly(c.u16s(42)?, total, 42)?;
    let kinds = exactly(c.u8s(43)?, total, 43)?;
    let refs = exactly(c.u32s(44)?, total, 44)?;
    let power = exactly(c.u8s(45)?, total, 45)?;
    let with_position = kinds.iter().filter(|k| **k >= 128).count();
    let positions = [
        exactly(c.s32s(46)?, with_position, 46)?,
        exactly(c.s32s(47)?, with_position, 47)?,
        exactly(c.s32s(48)?, with_position, 48)?,
    ];
    let (mut track, mut key, mut pos_used) = (0, 0, 0);
    for (u, tracks_here) in units.iter_mut().zip(counts) {
        for _ in 0..*tracks_here {
            let k = n_keys[track];
            let what = format!("a target track of unit {}", u.unit.serial);
            let at = frames(&times[key..key + k], start, &what)?;
            let mut keys = Vec::with_capacity(k);
            for i in 0..k {
                let kind = kinds[key + i];
                let mut position = [0; 3];
                if kind >= 128 {
                    for a in 0..3 {
                        position[a] = positions[a][pos_used];
                    }
                    pos_used += 1;
                }
                keys.push(TargetKey {
                    frame: at[i],
                    kind,
                    reference: refs[key + i],
                    build_power: power[key + i],
                    position,
                });
            }
            u.unit.targets.push(TargetTrack {
                weapon: weapons[track],
                keys,
            });
            track += 1;
            key += k;
        }
    }
    Ok(())
}

fn decode_poses(c: &Chunk, units: &mut [WindowUnit], counts: &[usize], start: u32) -> Result<()> {
    let tracks: usize = counts.iter().sum();
    let pieces = exactly(c.u16s(56)?, tracks, 56)?;
    let n_keys: Vec<usize> = exactly(c.u16s(57)?, tracks, 57)?
        .iter()
        .map(|n| *n as usize)
        .collect();
    let total: usize = n_keys.iter().sum();
    let times = exactly(c.u16s(58)?, total, 58)?;
    let na = narrow3(c, [59, 60, 61])?;
    let no = narrow3(c, [65, 66, 67])?;
    for a in 0..3 {
        exactly(na[a], total, 59 + a as u16)?;
        exactly(no[a], total, 65 + a as u16)?;
    }
    let mut wa = wide3(c, [62, 63, 64])?;
    let mut wo = wide3(c, [68, 69, 70])?;
    let (mut track, mut key) = (0, 0);
    for (u, tracks_here) in units.iter_mut().zip(counts) {
        for _ in 0..*tracks_here {
            let k = n_keys[track];
            let what = format!("a pose track of unit {}", u.unit.serial);
            let at = frames(&times[key..key + k], start, &what)?;
            let a = curve3(&na, key, k, [59, 60, 61], &mut wa)?;
            let o = curve3(&no, key, k, [65, 66, 67], &mut wo)?;
            let keys = (0..k)
                .map(|i| PoseKey {
                    frame: at[i],
                    angles: [a[0][i], a[1][i], a[2][i]],
                    offsets: [o[0][i], o[1][i], o[2][i]],
                })
                .collect();
            u.unit.poses.push(PoseTrack {
                piece: pieces[track],
                keys,
            });
            track += 1;
            key += k;
        }
    }
    wa.iter().chain(wo.iter()).try_for_each(Wide::finished)
}

fn decode_queue(c: &Chunk, units: &mut [WindowUnit], counts: &[usize], start: u32) -> Result<()> {
    let total: usize = counts.iter().sum();
    let times = exactly(c.u16s(72)?, total, 72)?;
    let lens = exactly(c.u8s(73)?, total, 73)?;
    let items: usize = lens.iter().map(|n| *n as usize).sum();
    let defs = exactly(c.u16s(74)?, items, 74)?;
    let xs = exactly(c.s32s(75)?, items, 75)?;
    let zs = exactly(c.s32s(76)?, items, 76)?;
    let facing = exactly(c.u8s(77)?, items, 77)?;
    let (mut key, mut item) = (0, 0);
    for (u, k) in units.iter_mut().zip(counts) {
        let what = format!("the build queue of unit {}", u.unit.serial);
        let at = frames(&times[key..key + k], start, &what)?;
        for i in 0..*k {
            let n = lens[key + i] as usize;
            u.unit.queue.push(QueueKey {
                frame: at[i],
                items: (item..item + n)
                    .map(|j| QueueItem {
                        unit_def: defs[j],
                        x: xs[j],
                        z: zs[j],
                        facing: facing[j],
                    })
                    .collect(),
            });
            item += n;
        }
        key += k;
    }
    Ok(())
}

fn decode_projectiles(c: &Chunk, start: u32) -> Result<Vec<WindowProjectile>> {
    let serials = c.u32s(80)?;
    let n = serials.len();
    let weapons = exactly(c.u16s(81)?, n, 81)?;
    let teams = exactly(c.u8s(82)?, n, 82)?;
    let fl = exactly(c.u8s(83)?, n, 83)?;
    let shooters = exactly(c.u16s(84)?, n, 84)?;
    let firsts = exactly(c.u16s(85)?, n, 85)?;
    let lasts = exactly(c.u16s(86)?, n, 86)?;
    let counts: Vec<usize> = exactly(c.u16s(87)?, n, 87)?
        .iter()
        .map(|n| *n as usize)
        .collect();
    let total: usize = counts.iter().sum();
    let times = exactly(c.u16s(88)?, total, 88)?;
    let np = narrow3(c, [89, 90, 91])?;
    let nv = narrow3(c, [95, 96, 97])?;
    for a in 0..3 {
        exactly(np[a], total, 89 + a as u16)?;
        exactly(nv[a], total, 95 + a as u16)?;
    }
    let mut wp = wide3(c, [92, 93, 94])?;
    let mut wv = wide3(c, [98, 99, 100])?;
    let mut out = Vec::with_capacity(n);
    let mut key = 0;
    for i in 0..n {
        let k = counts[i];
        let what = format!("the keys of projectile {}", serials[i]);
        let at = frames(&times[key..key + k], start, &what)?;
        let p = curve3(&np, key, k, [89, 90, 91], &mut wp)?;
        let v = curve3(&nv, key, k, [95, 96, 97], &mut wv)?;
        let keys = (0..k)
            .map(|j| ProjectileKey {
                frame: at[j],
                position: [p[0][j], p[1][j], p[2][j]],
                velocity: [v[0][j], v[1][j], v[2][j]],
            })
            .collect();
        out.push(WindowProjectile {
            projectile: Projectile {
                serial: serials[i],
                weapon_def: weapons[i],
                team: teams[i],
                shooter: (shooters[i] != NO_INDEX).then_some(shooters[i] as u32),
                first_frame: start + firsts[i] as u32,
                last_frame: start + lasts[i] as u32,
                keys,
            },
            continues_before: fl[i] & 1 != 0,
            continues_after: fl[i] & 2 != 0,
        });
        key += k;
    }
    wp.iter().chain(wv.iter()).try_for_each(Wide::finished)?;
    Ok(out)
}

// Sampling.

/// A unit's target on one weapon at one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct TargetState {
    pub weapon: u8,
    pub kind: u8,
    /// An index in the window's units or projectiles, or in the features
    /// list, as the kind says.
    pub reference: u32,
    pub build_power: u8,
    /// In elmos. Only set when `kind` is 128 or more.
    pub position: [f64; 3],
}

/// One piece of a unit at one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct PoseState {
    pub piece: u16,
    /// Turns about x, y and z in 65,536ths of a turn, not reduced to one
    /// turn and not comparable with an angle from another window.
    pub angles: [f64; 3],
    /// Offsets from the piece's rest position, in elmos.
    pub offsets: [f64; 3],
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnitState {
    /// Index in [`Window::units`].
    pub index: usize,
    pub serial: u32,
    pub engine_id: u16,
    pub unit_def: u16,
    pub team: u8,
    /// In elmos.
    pub position: [f64; 3],
    /// `(x, y, z, w)`.
    pub rotation: [f64; 4],
    /// A fraction of the unit's maximum.
    pub health: f64,
    /// 1 for complete.
    pub build_progress: f64,
    /// Bit 0: the unit is switched on.
    pub flags: u8,
    /// A weapon with no track has no target.
    pub targets: Vec<TargetState>,
    /// A piece with no track is at rest.
    pub poses: Vec<PoseState>,
    pub queue: Vec<QueueItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectileState {
    /// Index in [`Window::projectiles`].
    pub index: usize,
    pub serial: u32,
    pub weapon_def: u16,
    pub team: u8,
    /// An index in [`Window::units`].
    pub shooter: Option<u32>,
    /// In elmos.
    pub position: [f64; 3],
    /// In elmos per frame.
    pub velocity: [f64; 3],
}

/// Everything that exists at one frame of one window.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameState {
    pub frame: u32,
    pub units: Vec<UnitState>,
    pub projectiles: Vec<ProjectileState>,
}

impl Window {
    /// Every unit and projectile that exists at `frame`, with its value there.
    /// Terrain and features are not part of a window's main chunk.
    pub fn sample(&self, frame: u32, q: &Quantiser) -> Result<FrameState> {
        if frame < self.start_frame || frame > self.end_frame {
            return Err(TrackError::invalid(format!(
                "frame {frame} is outside window {}, which runs from {} to {}",
                self.index, self.start_frame, self.end_frame
            )));
        }
        let mut units = Vec::new();
        for (index, wu) in self.units.iter().enumerate() {
            let u = &wu.unit;
            if frame < u.first_frame || frame > u.last_frame {
                continue;
            }
            let (position, rotation) = curve::transform_at(&u.transform, q, frame)
                .ok_or_else(|| corrupt(format!("unit {} has no transform keys", u.serial)))?;
            let (health, build_progress, flags) = curve::status_at(&u.status, frame)
                .ok_or_else(|| corrupt(format!("unit {} has no status keys", u.serial)))?;
            let targets = u
                .targets
                .iter()
                .filter_map(|t| {
                    let k = held(&t.keys, frame)?;
                    Some(TargetState {
                        weapon: t.weapon,
                        kind: k.kind,
                        reference: k.reference,
                        build_power: k.build_power,
                        position: k.position.map(|p| q.position_value(p)),
                    })
                })
                .collect();
            let poses = u
                .poses
                .iter()
                .filter_map(|p| {
                    let (angles, offsets) = curve::pose_at(&p.keys, q, frame)?;
                    Some(PoseState {
                        piece: p.piece,
                        angles,
                        offsets,
                    })
                })
                .collect();
            let queue = held(&u.queue, frame)
                .map(|k| k.items.clone())
                .unwrap_or_default();
            units.push(UnitState {
                index,
                serial: u.serial,
                engine_id: u.engine_id,
                unit_def: u.unit_def,
                team: u.team,
                position,
                rotation,
                health,
                build_progress,
                flags,
                targets,
                poses,
                queue,
            });
        }
        let mut projectiles = Vec::new();
        for (index, wp) in self.projectiles.iter().enumerate() {
            let p = &wp.projectile;
            if frame < p.first_frame || frame > p.last_frame {
                continue;
            }
            let (position, velocity) = curve::projectile_at(&p.keys, q, frame)
                .ok_or_else(|| corrupt(format!("projectile {} has no keys", p.serial)))?;
            projectiles.push(ProjectileState {
                index,
                serial: p.serial,
                weapon_def: p.weapon_def,
                team: p.team,
                shooter: p.shooter,
                position,
                velocity,
            });
        }
        Ok(FrameState {
            frame,
            units,
            projectiles,
        })
    }
}
