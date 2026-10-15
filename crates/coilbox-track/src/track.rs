//! The writer: a whole match in, a windowed file out.

use crate::chunk::compress;
use crate::curve::Linear;
use crate::error::{Result, TrackError};
use crate::header::*;
use crate::keys::*;
use crate::meta;
use crate::quant::{check_limit, Quantiser, ANGLE_UNITS_PER_TURN};
use crate::terrain;
use crate::window::{Window, WindowProjectile, WindowUnit};
use std::collections::{HashMap, HashSet};
use std::io::Write;

/// Everything in a match, keyed by entity. [`Track::write_to`] cuts it into
/// windows.
///
/// Keys carry absolute frames and are in rising order, with every key of an
/// entity between its first and last frame. References in target keys and
/// shooters are serial numbers. The writer adds the keys a window needs at its
/// edges, so a caller gives each curve once and in full, and does not think
/// about windows.
#[derive(Debug, Clone)]
pub struct Track {
    pub settings: Settings,
    pub info: Info,
    pub features: Vec<Feature>,
    pub units: Vec<Unit>,
    pub projectiles: Vec<Projectile>,
    /// The recorder's rows for the whole match, in any order. The writer
    /// sorts them and applies the three rules for terrain.
    pub terrain: Vec<TerrainRow>,
    /// The numbers of the teams and of the game over the whole match: what
    /// each team holds, the rest of its economy, and rules parameters. One
    /// track for a team and a code. A resource with no track is 0 for the
    /// whole match.
    pub values: Vec<ValueTrack>,
}

impl Track {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings,
            info: Info::default(),
            features: vec![],
            units: vec![],
            projectiles: vec![],
            terrain: vec![],
            values: vec![],
        }
    }

    pub fn quantiser(&self) -> Result<Quantiser> {
        self.settings.quantiser()
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        self.write_to(&mut out)?;
        Ok(out)
    }

    /// Writes the file and gives back the header it wrote.
    pub fn write_to<W: Write>(&self, out: &mut W) -> Result<Header> {
        self.settings.check()?;
        let q = self.quantiser()?;
        self.validate()?;

        let s = &self.settings;
        let count = s.window_count();
        let terrain_rows = terrain::prepare(&self.terrain);
        for r in &terrain_rows {
            if r.frame < s.first_frame || r.frame > s.last_frame {
                return Err(TrackError::invalid(format!(
                    "a terrain row is at frame {}, outside {} to {}",
                    r.frame, s.first_frame, s.last_frame
                )));
            }
        }

        let info = compress(&meta::encode_info(&self.info)?.encode()?)?;
        let features = compress(&meta::encode_features(&self.features).encode()?)?;
        let mut main = Vec::with_capacity(count as usize);
        let mut terr = Vec::with_capacity(count as usize);
        for k in 0..count {
            let w = self.window(&q, k as usize)?;
            main.push(compress(&w.to_chunk()?.encode()?)?);
            let (start, end) = s.window_bounds(k);
            let lo = if k == 0 { start } else { start + 1 };
            let rows: Vec<TerrainRow> = terrain_rows
                .iter()
                .filter(|r| r.frame >= lo && r.frame <= end)
                .copied()
                .collect();
            terr.push(if rows.is_empty() {
                None
            } else {
                Some(compress(&terrain::encode(&rows, start)?.encode()?)?)
            });
        }

        // Lay the chunks out, each on a 64 byte block.
        let mut cursor = (HEADER_SIZE + INDEX_ENTRY_SIZE * count as usize) as u64;
        let mut place = |len: usize| -> Result<Extent> {
            cursor = cursor.div_ceil(BLOCK_SIZE) * BLOCK_SIZE;
            let block = cursor / BLOCK_SIZE;
            check_limit(|| "a chunk's block number".into(), block as i64)?;
            check_limit(|| "a chunk's length".into(), len as i64)?;
            cursor += len as u64;
            Ok(Extent {
                block: block as u32,
                length: len as u32,
            })
        };
        let info_at = place(info.len())?;
        let features_at = place(features.len())?;
        let mut entries = Vec::with_capacity(count as usize);
        for k in 0..count as usize {
            let main_at = place(main[k].len())?;
            let terrain_at = match &terr[k] {
                Some(t) => place(t.len())?,
                None => Extent::default(),
            };
            entries.push(WindowEntry {
                main: main_at,
                terrain: terrain_at,
            });
        }

        let header = Header {
            header_size: HEADER_SIZE as u16,
            recorder_version: s.recorder_version,
            frames_per_second: s.frames_per_second,
            first_frame: s.first_frame,
            last_frame: s.last_frame,
            window_length: s.window_length,
            window_count: count,
            tolerance: s.tolerance,
            value_tolerance: s.value_tolerance,
            value_fraction: s.value_fraction,
            position_shift: s.position_shift,
            velocity_shift: s.velocity_shift,
            rotation_bits: s.rotation_bits,
            sample_interval: s.sample_interval,
            info: info_at,
            features: features_at,
            unit_count: self.units.len() as u32,
            projectile_count: self.projectiles.len() as u32,
            feature_count: self.features.len() as u32,
            game_id: s.game_id,
        };
        check_limit(|| "the unit count".into(), self.units.len() as i64)?;
        check_limit(
            || "the projectile count".into(),
            self.projectiles.len() as i64,
        )?;
        check_limit(|| "the feature count".into(), self.features.len() as i64)?;
        let header_bytes = header.encode();

        let mut parts: Vec<(u64, &[u8])> = vec![(0, &header_bytes[..])];
        let entry_bytes: Vec<[u8; INDEX_ENTRY_SIZE]> =
            entries.iter().map(WindowEntry::encode).collect();
        for (i, e) in entry_bytes.iter().enumerate() {
            parts.push(((HEADER_SIZE + INDEX_ENTRY_SIZE * i) as u64, &e[..]));
        }
        parts.push((info_at.offset(), &info));
        parts.push((features_at.offset(), &features));
        for k in 0..count as usize {
            parts.push((entries[k].main.offset(), &main[k]));
            if let Some(t) = &terr[k] {
                parts.push((entries[k].terrain.offset(), t));
            }
        }
        // Chunks are laid out in order, so each part starts at or after the end of the last.
        let mut written = 0u64;
        for (at, bytes) in parts {
            out.write_all(&vec![0u8; (at - written) as usize])?;
            out.write_all(bytes)?;
            written = at + bytes.len() as u64;
        }
        Ok(header)
    }

    fn validate(&self) -> Result<()> {
        let s = &self.settings;
        let inside = |what: &str, first: u32, last: u32| -> Result<()> {
            if first > last || first < s.first_frame || last > s.last_frame {
                return Err(TrackError::invalid(format!(
                    "{what} exists from frame {first} to {last}, which is not inside {} to {}",
                    s.first_frame, s.last_frame
                )));
            }
            Ok(())
        };
        fn rising<K: Keyed>(what: &str, keys: &[K], first: u32, last: u32) -> Result<()> {
            let mut previous: Option<u32> = None;
            for k in keys {
                let f = k.frame();
                if f < first || f > last {
                    return Err(TrackError::invalid(format!(
                        "{what} has a key at frame {f}, outside its life from {first} to {last}"
                    )));
                }
                if previous.is_some_and(|p| p >= f) {
                    return Err(TrackError::invalid(format!(
                        "{what} has keys that do not rise in frame, at {f}"
                    )));
                }
                previous = Some(f);
            }
            Ok(())
        }
        let mut serials = HashSet::new();
        for u in &self.units {
            let what = format!("unit {}", u.serial);
            if !serials.insert(u.serial) {
                return Err(TrackError::invalid(format!(
                    "two units have serial {}",
                    u.serial
                )));
            }
            inside(&what, u.first_frame, u.last_frame)?;
            if u.transform.is_empty() || u.status.is_empty() {
                return Err(TrackError::invalid(format!(
                    "{what} needs at least one transform key and one status key"
                )));
            }
            rising(&what, &u.transform, u.first_frame, u.last_frame)?;
            rising(&what, &u.status, u.first_frame, u.last_frame)?;
            rising(&what, &u.queue, u.first_frame, u.last_frame)?;
            for t in &u.targets {
                rising(&what, &t.keys, u.first_frame, u.last_frame)?;
            }
            for p in &u.poses {
                rising(&what, &p.keys, u.first_frame, u.last_frame)?;
            }
        }
        let mut serials = HashSet::new();
        for p in &self.projectiles {
            let what = format!("projectile {}", p.serial);
            if !serials.insert(p.serial) {
                return Err(TrackError::invalid(format!(
                    "two projectiles have serial {}",
                    p.serial
                )));
            }
            inside(&what, p.first_frame, p.last_frame)?;
            if p.keys.is_empty() {
                return Err(TrackError::invalid(format!(
                    "{what} needs at least one key"
                )));
            }
            rising(&what, &p.keys, p.first_frame, p.last_frame)?;
        }
        for f in &self.features {
            if f.first_frame > f.last_frame {
                return Err(TrackError::invalid(
                    "a feature's first frame is after its last".to_string(),
                ));
            }
        }
        let mut seen = HashSet::new();
        for v in &self.values {
            let what = format!("value {} of team {}", v.code, v.team);
            if !seen.insert((v.team, v.code)) {
                return Err(TrackError::invalid(format!("{what} has two tracks")));
            }
            rising(&what, &v.keys, s.first_frame, s.last_frame)?;
            if let Some(k) = v.keys.iter().find(|k| !k.value().is_finite()) {
                return Err(TrackError::invalid(format!(
                    "{what} is {} at frame {}, which is not a number a reader can draw",
                    k.value(),
                    k.frame
                )));
            }
            let names = if v.team == NO_TEAM {
                &self.info.game_params
            } else {
                &self.info.team_params
            };
            if v.is_parameter() && (v.code - value_code::PARAMETER) as usize >= names.len() {
                return Err(TrackError::invalid(format!(
                    "{what} is a rules parameter the info does not name"
                )));
            }
        }
        Ok(())
    }

    /// What window `k` holds: the entities that exist at some frame of it,
    /// their keys cut to it, and the keys added at its edges.
    pub fn window(&self, q: &Quantiser, k: usize) -> Result<Window> {
        let (start, end) = self.settings.window_bounds(k as u32);
        let live_units: Vec<&Unit> = self
            .units
            .iter()
            .filter(|u| u.first_frame <= end && u.last_frame >= start)
            .collect();
        let live_projectiles: Vec<&Projectile> = self
            .projectiles
            .iter()
            .filter(|p| p.first_frame <= end && p.last_frame >= start)
            .collect();
        let unit_index: HashMap<u32, u32> = live_units
            .iter()
            .enumerate()
            .map(|(i, u)| (u.serial, i as u32))
            .collect();
        let projectile_index: HashMap<u32, u32> = live_projectiles
            .iter()
            .enumerate()
            .map(|(i, p)| (p.serial, i as u32))
            .collect();
        let resolve = Resolver {
            units: &unit_index,
            projectiles: &projectile_index,
            features: self.features.len(),
        };

        let mut units = Vec::new();
        for u in live_units {
            let (first, last) = (u.first_frame.max(start), u.last_frame.min(end));
            let mut targets = Vec::new();
            for t in &u.targets {
                let normal: Vec<TargetKey> = t.keys.iter().map(canonical).collect();
                let mut keys = slice_stepped(
                    &normal,
                    first,
                    last,
                    |frame| TargetKey {
                        frame,
                        kind: 0,
                        reference: 0,
                        build_power: 0,
                        position: [0; 3],
                    },
                    |k| k.kind != 0,
                );
                for key in &mut keys {
                    key.reference = resolve.target(u.serial, key)?;
                }
                if !keys.is_empty() {
                    targets.push(TargetTrack {
                        weapon: t.weapon,
                        keys,
                    });
                }
            }
            let mut poses = Vec::new();
            for p in &u.poses {
                let mut keys = slice_linear(&p.keys, first, last, false, q)?;
                unwrap_angles(&mut keys)?;
                if keys
                    .iter()
                    .any(|k| k.angles != [0; 3] || k.offsets != [0; 3])
                {
                    poses.push(PoseTrack {
                        piece: p.piece,
                        keys,
                    });
                }
            }
            units.push(WindowUnit {
                unit: Unit {
                    engine_id: u.engine_id,
                    serial: u.serial,
                    unit_def: u.unit_def,
                    team: u.team,
                    first_frame: first,
                    last_frame: last,
                    transform: slice_linear(&u.transform, first, last, false, q)?,
                    status: slice_linear(&u.status, first, last, false, q)?,
                    targets,
                    poses,
                    queue: slice_stepped(
                        &u.queue,
                        first,
                        last,
                        |frame| QueueKey {
                            frame,
                            items: vec![],
                        },
                        |k| !k.items.is_empty(),
                    ),
                },
                continues_before: u.first_frame < start,
                continues_after: u.last_frame > end,
            });
        }

        let mut projectiles = Vec::new();
        for p in live_projectiles {
            let (first, last) = (p.first_frame.max(start), p.last_frame.min(end));
            projectiles.push(WindowProjectile {
                projectile: Projectile {
                    serial: p.serial,
                    weapon_def: p.weapon_def,
                    team: p.team,
                    shooter: p.shooter.and_then(|s| unit_index.get(&s).copied()),
                    first_frame: first,
                    last_frame: last,
                    keys: slice_linear(&p.keys, first, last, true, q)?,
                },
                continues_before: p.first_frame < start,
                continues_after: p.last_frame > end,
            });
        }
        let mut values = Vec::new();
        for v in &self.values {
            // A track that starts after the window says nothing about it. A
            // key added at the window's first frame would give a rules
            // parameter a value before the game had set it.
            if v.keys.first().is_none_or(|key| key.frame > end) {
                continue;
            }
            let mut keys = slice_linear(&v.keys, start, end, false, q)?;
            // A resource with no track is 0 for the whole window.
            if !v.is_parameter() && keys.iter().all(|key| key.value() == 0.0) {
                continue;
            }
            // A rules parameter has no value before its first key in a window,
            // so one that was set before the window has a key on the window's
            // first frame, even where the next key would say the same.
            if v.is_parameter()
                && v.keys[0].frame < start
                && keys.first().is_some_and(|key| key.frame > start)
            {
                keys.insert(0, ValueKey::at(&v.keys, q, start)?);
            }
            values.push(ValueTrack {
                team: v.team,
                code: v.code,
                keys,
            });
        }
        values.sort_by_key(|v| (v.team, v.code));
        Ok(Window {
            index: k,
            start_frame: start,
            end_frame: end,
            units,
            projectiles,
            values,
        })
    }
}

/// Turns the serial a target key names into the index the file stores.
struct Resolver<'a> {
    units: &'a HashMap<u32, u32>,
    projectiles: &'a HashMap<u32, u32>,
    features: usize,
}

impl Resolver<'_> {
    fn target(&self, owner: u32, key: &TargetKey) -> Result<u32> {
        let missing = |what: &str| {
            TrackError::invalid(format!(
                "unit {owner} targets {what} {} at frame {}, which is not in that window",
                key.reference, key.frame
            ))
        };
        match key.kind {
            1 | 16 | 17 | 20 => self
                .units
                .get(&key.reference)
                .copied()
                .ok_or_else(|| missing("unit")),
            4 => self
                .projectiles
                .get(&key.reference)
                .copied()
                .ok_or_else(|| missing("projectile")),
            2 | 18 | 19 if (key.reference as usize) < self.features => Ok(key.reference),
            2 | 18 | 19 => Err(TrackError::invalid(format!(
                "unit {owner} targets feature {}, but the track lists {}",
                key.reference, self.features
            ))),
            _ => Ok(key.reference),
        }
    }
}

/// A target key with the fields its kind does not use set to 0, so two keys
/// that mean the same compare equal.
fn canonical(k: &TargetKey) -> TargetKey {
    let mut k = k.clone();
    if k.kind < 128 {
        k.position = [0; 3];
    }
    if matches!(k.kind, 0 | 128 | 129) {
        k.reference = 0;
    }
    k
}

/// The keys of a curve that fall in `first..=last`, with a key added at each
/// end where the window needs one. The value at an end is worked out from the
/// whole curve, then rounded to the file's steps. It is left out when the
/// nearest key already rounds to the same value, since a curve holds its first
/// key's value before it and its last key's value after.
///
/// A curve that must always have a key at both ends, a projectile, never
/// leaves one out.
fn slice_linear<K: Linear>(
    keys: &[K],
    first: u32,
    last: u32,
    always_ends: bool,
    q: &Quantiser,
) -> Result<Vec<K>> {
    let lo = keys.partition_point(|k| k.frame() < first);
    let hi = keys.partition_point(|k| k.frame() <= last);
    let mut out = keys[lo..hi].to_vec();
    let same = |candidate: &K, key: &K| {
        let mut c = candidate.clone();
        c.set_frame(key.frame());
        &c == key
    };
    if out.first().map(Keyed::frame) != Some(first) {
        let candidate = K::at(keys, q, first)?;
        if always_ends || !out.first().is_some_and(|key| same(&candidate, key)) {
            out.insert(0, candidate);
        }
    }
    if out.last().map(Keyed::frame) != Some(last) {
        let candidate = K::at(keys, q, last)?;
        if always_ends || !out.last().is_some_and(|key| same(&candidate, key)) {
            out.push(candidate);
        }
    }
    Ok(out)
}

/// The keys of a curve that holds its value until the next key. Its value at
/// `first` is the last key at or before it. Empty when nothing in the window
/// is `present`, which is how a target track or a build queue that is missing
/// for the whole window is written.
fn slice_stepped<K: Keyed + Clone + PartialEq>(
    keys: &[K],
    first: u32,
    last: u32,
    nothing: impl Fn(u32) -> K,
    present: impl Fn(&K) -> bool,
) -> Vec<K> {
    let lo = keys.partition_point(|k| k.frame() < first);
    let hi = keys.partition_point(|k| k.frame() <= last);
    let mut out = keys[lo..hi].to_vec();
    if out.first().map(Keyed::frame) != Some(first) {
        let upto = keys.partition_point(|k| k.frame() <= first);
        let mut candidate = if upto == 0 {
            nothing(first)
        } else {
            keys[upto - 1].clone()
        };
        candidate.set_frame(first);
        let mut as_first = candidate.clone();
        if let Some(key) = out.first() {
            as_first.set_frame(key.frame());
            if &as_first == key {
                return finish_stepped(out, present);
            }
        }
        out.insert(0, candidate);
    }
    finish_stepped(out, present)
}

fn finish_stepped<K>(out: Vec<K>, present: impl Fn(&K) -> bool) -> Vec<K> {
    if out.iter().any(present) {
        out
    } else {
        vec![]
    }
}

/// Shifts every key of each angle by the same whole number of turns, so the
/// first key is between -32,768 and 32,767. A reader never compares an angle
/// in one window with an angle in another, so the drawing does not change.
fn unwrap_angles(keys: &mut [PoseKey]) -> Result<()> {
    let Some(first) = keys.first().map(|k| k.angles) else {
        return Ok(());
    };
    let turn = ANGLE_UNITS_PER_TURN as i64;
    for (a, first) in first.into_iter().enumerate() {
        let turns = (first as i64 + turn / 2).div_euclid(turn);
        for k in keys.iter_mut() {
            let shifted = k.angles[a] as i64 - turns * turn;
            k.angles[a] = i32::try_from(shifted).map_err(|_| TrackError::OutOfRange {
                what: "a pose angle".into(),
                value: shifted,
                limit: i32::MAX as i64,
            })?;
        }
    }
    Ok(())
}
