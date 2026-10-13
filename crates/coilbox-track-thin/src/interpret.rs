//! Turns the dump's frame blocks into what a track is made of: units and
//! projectiles with serial numbers, samples in real values, and targets that
//! name a serial and not an engine id.
//!
//! Thinning and the check that follows it each run a dump through this, and
//! get the same serials and the same values, because nothing here depends on
//! who is listening.

use crate::dump::{BuilderWork, DumpHeader, Frame, PieceTree, UnitPose, WeaponTarget};
use crate::error::{Result, ThinError};
use crate::pose::{self, ModelSample, PieceSample};
use coilbox_track::{
    quaternion_from_front_up, Feature, Info, PosedPieces, Quantiser, Team, TerrainRow,
};
use std::collections::{HashMap, HashSet};

/// A unit on one frame.
#[derive(Debug, Clone, Copy)]
pub(crate) struct UnitPoint {
    pub frame: u32,
    pub position: [f64; 3],
    /// `(x, y, z, w)`.
    pub rotation: [f64; 4],
    /// Fractions from 0 to 1.
    pub health: f64,
    pub build: f64,
    pub flags: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct UnitStart {
    pub serial: u32,
    pub engine_id: u16,
    /// An index in the track's unit definition names.
    pub def: u16,
    pub def_name: String,
    pub team: u8,
    pub frame: u32,
    /// In elmos.
    pub radius: f64,
}

/// What a weapon aims at or a builder works on, in the track's own kinds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TargetValue {
    pub kind: u8,
    /// A unit's or projectile's serial, or an index in the features list.
    pub reference: u32,
    pub build_power: u8,
    /// In elmos, for a kind of 128 or more.
    pub position: [f64; 3],
}

impl TargetValue {
    pub const NOTHING: Self = Self {
        kind: 0,
        reference: 0,
        build_power: 0,
        position: [0.0; 3],
    };

    fn names_unit(&self, serial: u32) -> bool {
        matches!(self.kind, 1 | 16 | 17 | 20) && self.reference == serial
    }

    fn names_projectile(&self, serial: u32) -> bool {
        self.kind == 4 && self.reference == serial
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct QueueEntry {
    pub def: u16,
    pub x: f64,
    pub z: f64,
    pub facing: u8,
}

#[derive(Debug, Clone)]
pub(crate) struct ProjectileStart {
    pub serial: u32,
    /// An index in the track's weapon definition names, or 65,535 for debris.
    pub weapon_def: u16,
    pub team: u8,
    /// The serial of the unit that fired it.
    pub shooter: Option<u32>,
    pub frame: u32,
}

/// Who hears what the dump says. Calls for one unit or projectile come in
/// rising frame order, and a unit's targets, queue and pieces for a frame come
/// before its point for that frame.
pub(crate) trait Sink {
    fn unit_start(&mut self, unit: &UnitStart) -> Result<()>;
    fn unit_point(&mut self, serial: u32, point: &UnitPoint) -> Result<()>;
    /// `weapon` is the weapon number from 1, or 0 for builder work.
    fn target(&mut self, serial: u32, frame: u32, weapon: u8, target: &TargetValue) -> Result<()>;
    fn queue(&mut self, serial: u32, frame: u32, items: &[QueueEntry]) -> Result<()>;
    /// `piece` is an index in the posed pieces of the unit's definition, and
    /// the sample is the piece relative to its parent.
    fn piece(&mut self, serial: u32, frame: u32, piece: u16, sample: &PieceSample) -> Result<()>;
    fn unit_end(&mut self, serial: u32, last_frame: u32) -> Result<()>;
    fn projectile_start(&mut self, projectile: &ProjectileStart) -> Result<()>;
    fn projectile_point(
        &mut self,
        serial: u32,
        frame: u32,
        position: [f64; 3],
        velocity: [f64; 3],
    ) -> Result<()>;
    fn projectile_end(&mut self, serial: u32, last_frame: u32) -> Result<()>;
}

/// The names a track lists, in the order they were first used, and the index
/// each of the dump's ids has in that list.
#[derive(Default)]
struct Names {
    index: HashMap<u32, u16>,
    names: Vec<String>,
}

impl Names {
    /// `first` is the id of the first name in `all`.
    fn get(&mut self, id: u32, all: &[String], first: u32, what: &str) -> Result<u16> {
        if let Some(found) = self.index.get(&id) {
            return Ok(*found);
        }
        let name = id
            .checked_sub(first)
            .and_then(|i| all.get(i as usize))
            .ok_or_else(|| {
                ThinError::Dump(format!(
                    "the dump uses {what} {id}, which its header does not name"
                ))
            })?;
        // 65,535 stands for no definition.
        let index = u16::try_from(self.names.len())
            .ok()
            .filter(|i| *i != u16::MAX)
            .ok_or_else(|| ThinError::Dump(format!("the dump uses too many {what}s")))?;
        self.names.push(name.clone());
        self.index.insert(id, index);
        Ok(index)
    }
}

/// What a unit definition's model says about its pieces before a script
/// moves them. Entry `n`, counting from 0, is piece number `n + 1`.
struct Rig {
    names: Vec<String>,
    /// Each piece's parent as a piece number, and 0 for the root.
    parents: Vec<u32>,
    /// Each piece's rest offset from its parent, in elmos.
    offsets: Vec<[f64; 3]>,
    /// See [`pose::reaches`].
    reaches: Vec<Option<f64>>,
    /// Whether the model's format can give a piece a rest rotation, which
    /// the dump does not have.
    bakes: bool,
}

struct LiveUnit {
    serial: u32,
    def_id: u32,
    first_frame: u32,
    /// In elmos.
    radius: f64,
    /// Each posed piece in the unit's model space, as last written, by piece
    /// number.
    pieces: Vec<(u32, ModelSample)>,
    /// The last point passed on, to hold if the unit ends with no pose.
    last: UnitPoint,
    /// What each weapon aims at, and weapon 0 for builder work.
    targets: Vec<(u8, TargetValue)>,
}

struct LiveProjectile {
    serial: u32,
    def: i32,
    team: i32,
    owner: i32,
    last_frame: u32,
}

/// A feature in real values, before the track's steps are known.
struct FeatureSeen {
    engine_id: u16,
    def: u16,
    team: u8,
    flags: u8,
    first_frame: u32,
    last_frame: u32,
    position: [f64; 3],
    front: [f64; 3],
    up: [f64; 3],
}

/// What is left when every frame has been heard: everything in a track that
/// is not a curve.
pub(crate) struct Rest {
    pub first_frame: u32,
    pub last_frame: u32,
    pub info: Info,
    pub features: Vec<Feature>,
    pub terrain: Vec<TerrainRow>,
    pub units: u32,
    pub projectiles: u32,
    /// The unit definitions with posed pieces whose model format can give a
    /// piece a rest rotation. Their angles hold that rotation as well as the
    /// script's, because the dump cannot say what it is.
    pub unread_rest_rotations: Vec<String>,
}

pub(crate) struct Interpreter {
    header: DumpHeader,
    radii: Vec<f32>,
    /// Each of the dump's unit definitions' footprint in elmos.
    footprints: Vec<[u16; 2]>,
    q: Quantiser,
    rigs: HashMap<u32, Rig>,
    unit_defs: Names,
    weapon_defs: Names,
    feature_defs: Names,
    /// For each of the dump's unit definitions, the piece numbers that have
    /// been posed, in the order they first were.
    posed: HashMap<u32, Vec<u32>>,
    units: HashMap<u32, LiveUnit>,
    projectiles: HashMap<u32, LiveProjectile>,
    /// How many targets name a projectile, so that the common case of none
    /// does not look through every unit when a projectile ends.
    projectile_targets: usize,
    live_features: HashMap<u32, usize>,
    features: Vec<FeatureSeen>,
    terrain: Vec<TerrainRow>,
    next_unit: u32,
    next_projectile: u32,
    first_frame: Option<u32>,
    last_frame: u32,
}

fn f3(v: [f32; 3]) -> [f64; 3] {
    v.map(|n| n as f64)
}

/// A team as the track stores it: 255 for none.
fn team(team: i32) -> u8 {
    u8::try_from(team).unwrap_or(u8::MAX)
}

fn fraction(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn point(frame: u32, pose: &UnitPose) -> UnitPoint {
    UnitPoint {
        frame,
        position: f3(pose.position),
        rotation: quaternion_from_front_up(f3(pose.front), f3(pose.up)),
        // Health can be above the maximum and below zero for a frame, and
        // the track stores it as a fraction of the maximum.
        health: fraction(pose.health as f64 / pose.max_health as f64),
        build: fraction(pose.build as f64),
        flags: (pose.flags != 0.0) as u8,
    }
}

impl Interpreter {
    /// `q` rounds what is not a curve: features and terrain heights.
    pub fn new(header: DumpHeader, q: Quantiser) -> Result<Self> {
        let radii = header.unit_radii.clone().ok_or_else(|| {
            ThinError::Dump(
                "the dump's header has no unitRadii, so it was recorded before the recorder \
                 wrote them (issue #3782). Record the replay again"
                    .into(),
            )
        })?;
        if radii.len() != header.unit_defs.len() {
            return Err(ThinError::Dump(format!(
                "the dump's header names {} unit definitions and gives {} radii",
                header.unit_defs.len(),
                radii.len()
            )));
        }
        let squares = header.unit_footprints.clone().ok_or_else(|| {
            ThinError::Dump(
                "the dump's header has no unitFootprints, so it was recorded before the recorder \
                 wrote them (issue #3807). Record the replay again"
                    .into(),
            )
        })?;
        if squares.len() != header.unit_defs.len() {
            return Err(ThinError::Dump(format!(
                "the dump's header names {} unit definitions and gives {} footprints",
                header.unit_defs.len(),
                squares.len()
            )));
        }
        let elmos = |squares: u32| {
            squares
                .checked_mul(header.square_size)
                .and_then(|e| u16::try_from(e).ok())
                .ok_or_else(|| {
                    ThinError::Dump(format!(
                        "the dump gives a footprint of {squares} squares of {} elmos, which is \
                         more than the {} elmos a track holds",
                        header.square_size,
                        u16::MAX
                    ))
                })
        };
        let footprints = squares
            .iter()
            .map(|f| Ok([elmos(f[0])?, elmos(f[1])?]))
            .collect::<Result<Vec<_>>>()?;
        Ok(Self {
            header,
            radii,
            footprints,
            q,
            rigs: HashMap::new(),
            unit_defs: Names::default(),
            weapon_defs: Names::default(),
            feature_defs: Names::default(),
            posed: HashMap::new(),
            units: HashMap::new(),
            projectiles: HashMap::new(),
            projectile_targets: 0,
            live_features: HashMap::new(),
            features: Vec::new(),
            terrain: Vec::new(),
            next_unit: 0,
            next_projectile: 0,
            first_frame: None,
            last_frame: 0,
        })
    }

    pub fn pieces(&mut self, tree: PieceTree) -> Result<()> {
        let def = tree.def;
        let (Some(offsets), Some(bounds)) = (&tree.offsets, &tree.bounds) else {
            return Err(ThinError::Dump(format!(
                "the dump's piece tree for unit definition {def} has no offsets or no bounds, so \
                 it was recorded before the recorder wrote them (issue #3783). Record the replay \
                 again"
            )));
        };
        let count = tree.pieces.len();
        if tree.parents.len() != count
            || offsets.len() != count
            || bounds.len() != count
            || bounds.iter().any(|b| !b.is_empty() && b.len() != 6)
        {
            return Err(ThinError::Dump(format!(
                "the dump's piece tree for unit definition {def} does not give a parent, an \
                 offset and bounds for each of its {count} pieces"
            )));
        }
        let rig = Rig {
            reaches: pose::reaches(&tree, offsets, bounds),
            offsets: offsets.iter().map(|o| f3(*o)).collect(),
            bakes: !matches!(tree.model_type.as_deref(), Some("3do" | "s3o")),
            parents: tree.parents,
            names: tree.pieces,
        };
        self.rigs.insert(def, rig);
        Ok(())
    }

    /// The radius of one of the dump's unit definitions, in elmos.
    pub fn radius(header: &DumpHeader, def: u32) -> Option<f32> {
        header
            .unit_radii
            .as_ref()?
            .get((def as usize).checked_sub(1)?)
            .copied()
    }

    fn end_unit(
        &mut self,
        sink: &mut dyn Sink,
        id: u32,
        frame: u32,
        pose: Option<&UnitPose>,
    ) -> Result<Option<u32>> {
        let Some(unit) = self.units.remove(&id) else {
            return Ok(None);
        };
        // A unit that is written off in block `frame` was last alive on the
        // frame before.
        let last = frame.saturating_sub(1).max(unit.first_frame);
        if let Some(pose) = pose {
            if unit.last.frame < last {
                sink.unit_point(unit.serial, &point(last, pose))?;
            }
        }
        self.projectile_targets -= unit.targets.iter().filter(|(_, t)| t.kind == 4).count();
        sink.unit_end(unit.serial, last)?;
        Ok(Some(unit.serial))
    }

    /// Lets go of every target that `gone` picks out, on `frame`.
    fn release(
        &mut self,
        sink: &mut dyn Sink,
        frame: u32,
        gone: impl Fn(&TargetValue) -> bool,
    ) -> Result<()> {
        for unit in self.units.values_mut() {
            for (weapon, target) in &mut unit.targets {
                if gone(target) {
                    if target.kind == 4 {
                        self.projectile_targets -= 1;
                    }
                    *target = TargetValue::NOTHING;
                    sink.target(unit.serial, frame, *weapon, target)?;
                }
            }
        }
        Ok(())
    }

    fn set_target(
        &mut self,
        sink: &mut dyn Sink,
        frame: u32,
        id: u32,
        weapon: u8,
        value: TargetValue,
    ) -> Result<()> {
        let Some(unit) = self.units.get_mut(&id) else {
            // A row for a unit the dump has not said exists.
            return Ok(());
        };
        let slot = match unit.targets.iter_mut().find(|(w, _)| *w == weapon) {
            Some((_, slot)) => slot,
            None => {
                unit.targets.push((weapon, TargetValue::NOTHING));
                &mut unit.targets.last_mut().expect("just pushed").1
            }
        };
        self.projectile_targets -= (slot.kind == 4) as usize;
        self.projectile_targets += (value.kind == 4) as usize;
        *slot = value;
        sink.target(unit.serial, frame, weapon, &value)
    }

    /// A weapon's target in the track's kinds. A target the dump has not said
    /// exists, or has said is gone, is no target.
    fn weapon_target(&self, row: &WeaponTarget) -> TargetValue {
        let named = row.value[0];
        let id = (named >= 0.0 && named.fract() == 0.0).then_some(named as u32);
        match row.kind {
            1 => id.and_then(|id| self.units.get(&id)).map(|u| TargetValue {
                kind: 1,
                reference: u.serial,
                ..TargetValue::NOTHING
            }),
            2 => Some(TargetValue {
                kind: 128,
                position: f3(row.value),
                ..TargetValue::NOTHING
            }),
            3 => id
                .and_then(|id| self.projectiles.get(&id))
                .map(|p| TargetValue {
                    kind: 4,
                    reference: p.serial,
                    ..TargetValue::NOTHING
                }),
            _ => None,
        }
        .unwrap_or(TargetValue::NOTHING)
    }

    /// A builder's work in the track's kinds, by the table in the recorder's
    /// README.
    fn builder_work(&self, row: &BuilderWork) -> TargetValue {
        // The engine reports build power as a count out of 15, and the track
        // stores that count times 17.
        let build_power = ((row.build_power as f64 * 15.0).round().clamp(0.0, 15.0) * 17.0) as u8;
        let max_units = self.header.max_units as i64;
        let target = row.target as i64;
        let unit = |kind: u8| {
            u32::try_from(target)
                .ok()
                .filter(|_| target < max_units)
                .and_then(|id| self.units.get(&id))
                .map(|u| (kind, u.serial))
        };
        let feature = |kind: u8| {
            u32::try_from(target - max_units)
                .ok()
                .and_then(|id| self.live_features.get(&id))
                .map(|index| (kind, *index as u32))
        };
        let found = match row.command {
            c if c < 0 => unit(16),
            40 => unit(16),
            90 if target < max_units => unit(17),
            90 => feature(18),
            125 => feature(19),
            130 => unit(20),
            110 if row.has_place => {
                return TargetValue {
                    kind: 129,
                    reference: 0,
                    build_power,
                    position: f3(row.place),
                }
            }
            _ => None,
        };
        match found {
            Some((kind, reference)) => TargetValue {
                kind,
                reference,
                build_power,
                position: [0.0; 3],
            },
            None => TargetValue::NOTHING,
        }
    }

    pub fn frame(&mut self, sink: &mut dyn Sink, block: &Frame) -> Result<()> {
        let frame = block.frame;
        match self.first_frame {
            None => self.first_frame = Some(frame),
            Some(_) if frame == self.last_frame + 1 => {}
            Some(_) => {
                return Err(ThinError::Dump(format!(
                "the dump's frame {frame} follows frame {}, and every frame should have a block",
                self.last_frame
            )))
            }
        }
        self.last_frame = frame;
        let first_block = self.first_frame == Some(frame);

        // Units the dump now says exist. An id that is still in use is a new
        // unit all the same, since the engine reuses ids.
        let sampled: HashSet<u32> = block.samples.iter().map(|s| s.unit).collect();
        // The serials of what ends in this block. Targets that name one are
        // let go of once every unit's last point is out, since a unit that
        // dies in this block was still aiming on the frame before.
        let mut gone_units: Vec<u32> = Vec::new();
        let mut gone_projectiles: Vec<u32> = Vec::new();
        for row in &block.created {
            gone_units.extend(self.end_unit(sink, row.unit, frame, None)?);
            let def = self
                .unit_defs
                .get(row.def, &self.header.unit_defs, 1, "unit definition")?;
            let serial = self.next_unit;
            self.next_unit += 1;
            let engine_id = u16::try_from(row.unit).map_err(|_| {
                ThinError::Dump(format!("unit id {} does not fit the track", row.unit))
            })?;
            let radius = self.radii[row.def as usize - 1] as f64;
            sink.unit_start(&UnitStart {
                serial,
                engine_id,
                def,
                def_name: self.header.unit_defs[row.def as usize - 1].clone(),
                team: team(row.team),
                frame,
                radius,
            })?;
            let at = point(frame, &row.pose);
            // A unit that is also sampled in this block gets its point from
            // the sample, which was read later.
            if !sampled.contains(&row.unit) {
                sink.unit_point(serial, &at)?;
            }
            self.units.insert(
                row.unit,
                LiveUnit {
                    serial,
                    def_id: row.def,
                    first_frame: frame,
                    radius,
                    pieces: Vec::new(),
                    last: at,
                    targets: Vec::new(),
                },
            );
        }

        // Projectiles. The engine says nothing when one is made and reuses
        // ids, so one is new when its id was not in the block before, or when
        // its definition, team or firing unit is not what that id had.
        for row in &block.projectiles {
            let same = self.projectiles.get(&row.projectile).is_some_and(|p| {
                p.last_frame + 1 == frame
                    && (p.def, p.team, p.owner) == (row.def, row.team, row.owner)
            });
            if !same {
                if let Some(old) = self.projectiles.remove(&row.projectile) {
                    sink.projectile_end(old.serial, old.last_frame)?;
                    gone_projectiles.push(old.serial);
                }
                let weapon_def = match u32::try_from(row.def) {
                    Ok(def) => self.weapon_defs.get(
                        def,
                        &self.header.weapon_defs,
                        0,
                        "weapon definition",
                    )?,
                    Err(_) => u16::MAX,
                };
                let serial = self.next_projectile;
                self.next_projectile += 1;
                sink.projectile_start(&ProjectileStart {
                    serial,
                    weapon_def,
                    team: team(row.team),
                    shooter: u32::try_from(row.owner)
                        .ok()
                        .and_then(|id| self.units.get(&id))
                        .map(|u| u.serial),
                    frame,
                })?;
                self.projectiles.insert(
                    row.projectile,
                    LiveProjectile {
                        serial,
                        def: row.def,
                        team: row.team,
                        owner: row.owner,
                        last_frame: frame,
                    },
                );
            }
            let live = self
                .projectiles
                .get_mut(&row.projectile)
                .expect("found or just put in");
            live.last_frame = frame;
            sink.projectile_point(live.serial, frame, f3(row.position), f3(row.velocity))?;
        }
        let mut gone: Vec<(u32, u32)> = self
            .projectiles
            .iter()
            .filter(|(_, p)| p.last_frame != frame)
            .map(|(id, p)| (*id, p.serial))
            .collect();
        gone.sort_by_key(|(_, serial)| *serial);
        for (id, serial) in gone {
            let old = self.projectiles.remove(&id).expect("listed above");
            sink.projectile_end(serial, old.last_frame)?;
            gone_projectiles.push(serial);
        }

        // Units the dump says are gone, and with them every target that named
        // one. The engine goes on answering with a dead unit's id until the
        // weapon picks again, and the recorder writes a target only when that
        // answer changes, so nothing else in the dump says the target is no
        // longer there.
        for row in &block.destroyed {
            gone_units.extend(self.end_unit(sink, row.unit, frame, Some(&row.pose))?);
        }
        if !gone_units.is_empty() || (self.projectile_targets > 0 && !gone_projectiles.is_empty()) {
            self.release(sink, frame, |t| {
                gone_units.iter().any(|serial| t.names_unit(*serial))
                    || gone_projectiles
                        .iter()
                        .any(|serial| t.names_projectile(*serial))
            })?;
        }

        // Features, before builder work that may name one.
        for row in &block.features_created {
            let def = self.feature_defs.get(
                row.def,
                &self.header.feature_defs,
                1,
                "feature definition",
            )?;
            if let Some(old) = self.live_features.remove(&row.feature) {
                self.features[old].last_frame =
                    frame.saturating_sub(1).max(self.features[old].first_frame);
            }
            self.live_features.insert(row.feature, self.features.len());
            self.features.push(FeatureSeen {
                engine_id: u16::try_from(row.feature).map_err(|_| {
                    ThinError::Dump(format!("feature id {} does not fit the track", row.feature))
                })?,
                def,
                team: team(row.team),
                // Bit 0: it was there before the first frame.
                flags: first_block as u8,
                first_frame: frame,
                last_frame: frame,
                position: f3(row.position),
                front: f3(row.front),
                up: f3(row.up),
            });
        }

        for row in &block.targets {
            let weapon = u8::try_from(row.weapon)
                .ok()
                .filter(|w| *w != 0)
                .ok_or_else(|| {
                    ThinError::Dump(format!(
                        "frame {frame} has weapon number {}, which does not fit the track",
                        row.weapon
                    ))
                })?;
            let value = self.weapon_target(row);
            self.set_target(sink, frame, row.unit, weapon, value)?;
        }
        for row in &block.work {
            let value = self.builder_work(row);
            self.set_target(sink, frame, row.unit, 0, value)?;
        }

        for row in &block.features_destroyed {
            if let Some(index) = self.live_features.remove(row) {
                let seen = &mut self.features[index];
                seen.last_frame = frame.saturating_sub(1).max(seen.first_frame);
            }
        }

        for row in &block.queues {
            let Some(serial) = self.units.get(&row.unit).map(|u| u.serial) else {
                continue;
            };
            let mut items = Vec::with_capacity(row.items.len());
            for item in &row.items {
                items.push(QueueEntry {
                    def: self.unit_defs.get(
                        item.def,
                        &self.header.unit_defs,
                        1,
                        "unit definition",
                    )?,
                    x: item.x as f64,
                    z: item.z as f64,
                    facing: item.facing as u8,
                });
            }
            sink.queue(serial, frame, &items)?;
        }

        // Piece rows. A row is a piece in the unit's model space, written
        // when that changes, and a key holds the piece relative to its parent.
        // The recorder writes a piece before its parents, so every row of the
        // block is taken in before any piece is worked out.
        let mut moved: Vec<(u32, Vec<u32>)> = Vec::new();
        let mut moved_at: HashMap<u32, usize> = HashMap::new();
        for row in &block.poses {
            let Some(unit) = self.units.get_mut(&row.unit) else {
                continue;
            };
            let sample = ModelSample::from_row(&row.matrix);
            match unit.pieces.iter_mut().find(|(p, _)| *p == row.piece) {
                Some((_, held)) => *held = sample,
                None => unit.pieces.push((row.piece, sample)),
            }
            let at = *moved_at.entry(row.unit).or_insert_with(|| {
                moved.push((row.unit, Vec::new()));
                moved.len() - 1
            });
            moved[at].1.push(row.piece);
        }
        for (id, written) in &moved {
            let unit = &self.units[id];
            let def = unit.def_id;
            let rig = self.rigs.get(&def).ok_or_else(|| {
                ThinError::Dump(format!(
                    "the dump poses pieces of unit definition {def} and has no piece tree for it"
                ))
            })?;
            let posed = self.posed.entry(def).or_default();
            for (piece, model) in &unit.pieces {
                let at = (*piece as usize)
                    .checked_sub(1)
                    .filter(|at| *at < rig.names.len())
                    .ok_or_else(|| {
                        ThinError::Dump(format!(
                            "the dump poses piece {piece} of unit definition {def}, which has {}",
                            rig.names.len()
                        ))
                    })?;
                // A piece whose parent moved is somewhere else relative to
                // it, whether or not the piece has a row of its own.
                let parent = rig.parents[at];
                if !written.contains(piece) && !written.contains(&parent) {
                    continue;
                }
                let above = match parent {
                    0 => None,
                    parent => Some(
                        unit.pieces
                            .iter()
                            .find(|(p, _)| *p == parent)
                            .map(|(_, held)| held)
                            .ok_or_else(|| {
                                ThinError::Dump(format!(
                                    "frame {frame} poses piece {piece} of unit {id} and the dump \
                                     has not posed piece {parent}, its parent"
                                ))
                            })?,
                    ),
                };
                let (rotation, translation) = pose::relative(above, model, rig.offsets[at]);
                let index = match posed.iter().position(|p| p == piece) {
                    Some(index) => index,
                    None => {
                        posed.push(*piece);
                        posed.len() - 1
                    }
                };
                let index = u16::try_from(index).map_err(|_| {
                    ThinError::Dump("a unit definition has too many posed pieces".into())
                })?;
                sink.piece(
                    unit.serial,
                    frame,
                    index,
                    &PieceSample {
                        rotation,
                        translation,
                        // A piece with no geometry on it or below it has no
                        // size of its own to go by, so its turn is weighted
                        // as the unit's is.
                        reach: rig.reaches[at].unwrap_or(unit.radius),
                    },
                )?;
            }
        }

        for row in &block.samples {
            let Some(unit) = self.units.get_mut(&row.unit) else {
                continue;
            };
            unit.last = point(frame, &row.pose);
            sink.unit_point(unit.serial, &unit.last)?;
        }

        // The track has one team for a unit, so a unit that is given away
        // keeps the team it was made on. Issue #3948.
        let _ = &block.given;

        for row in &block.terrain {
            let corner = |v: u32| {
                u16::try_from(v).map_err(|_| {
                    ThinError::Dump(format!("heightmap corner {v} does not fit the track"))
                })
            };
            self.terrain.push(TerrainRow {
                frame,
                x: corner(row.x)?,
                z: corner(row.z)?,
                before: self.q.position(row.before as f64)?,
                after: self.q.position(row.after as f64)?,
            });
        }
        Ok(())
    }

    /// Ends everything that is still there on the last frame.
    pub fn finish(mut self, sink: &mut dyn Sink) -> Result<Rest> {
        let first_frame = self
            .first_frame
            .ok_or_else(|| ThinError::Dump("the dump has no frames".into()))?;
        let last_frame = self.last_frame;
        let mut units: Vec<(u32, u32)> = self
            .units
            .values()
            .map(|u| (u.serial, u.first_frame))
            .collect();
        units.sort_unstable();
        for (serial, _) in units {
            sink.unit_end(serial, last_frame)?;
        }
        let mut projectiles: Vec<(u32, u32)> = self
            .projectiles
            .values()
            .map(|p| (p.serial, p.last_frame))
            .collect();
        projectiles.sort_unstable();
        for (serial, last) in projectiles {
            sink.projectile_end(serial, last)?;
        }
        for index in self.live_features.values() {
            let seen = &mut self.features[*index];
            seen.last_frame = last_frame;
            // Bit 1: it was still there after the last frame.
            seen.flags |= 2;
        }

        let q = self.q;
        let mut features = Vec::with_capacity(self.features.len());
        for f in &self.features {
            features.push(Feature {
                engine_id: f.engine_id,
                feature_def: f.def,
                team: f.team,
                flags: f.flags,
                first_frame: f.first_frame,
                last_frame: f.last_frame,
                position: [
                    q.position(f.position[0])?,
                    q.position(f.position[1])?,
                    q.position(f.position[2])?,
                ],
                rotation: q.rotation_from_front_up(f.front, f.up),
            });
        }

        let mut posed_pieces = Vec::new();
        let mut unread_rest_rotations = Vec::new();
        for (def_id, pieces) in &self.posed {
            // Every definition in here had a unit and a piece tree, or its
            // rows would not have been taken.
            let (Some(unit_def), Some(rig)) =
                (self.unit_defs.index.get(def_id), self.rigs.get(def_id))
            else {
                continue;
            };
            if rig.bakes {
                unread_rest_rotations.push(self.header.unit_defs[*def_id as usize - 1].clone());
            }
            posed_pieces.push(PosedPieces {
                unit_def: *unit_def,
                pieces: pieces
                    .iter()
                    .map(|piece| rig.names[*piece as usize - 1].clone())
                    .collect(),
            });
        }
        unread_rest_rotations.sort();
        posed_pieces.sort_by_key(|p| p.unit_def);

        // In the order of the track's names, which is the order the dump
        // first used each definition in.
        let mut unit_footprints = vec![[0u16; 2]; self.unit_defs.names.len()];
        for (def_id, index) in &self.unit_defs.index {
            // `Names::get` took the name at this place, so the place exists.
            unit_footprints[*index as usize] = self.footprints[*def_id as usize - 1];
        }

        let h = &self.header;
        let info = Info {
            engine_version: h.engine.clone(),
            game: format!("{} {}", h.game, h.game_version),
            map: h.map.clone(),
            writer: format!("coilbox-track-thin {}", env!("CARGO_PKG_VERSION")),
            unit_defs: self.unit_defs.names,
            unit_footprints,
            weapon_defs: self.weapon_defs.names,
            feature_defs: self.feature_defs.names,
            posed_pieces,
            teams: h
                .teams
                .iter()
                .map(|t| Team {
                    id: t.team,
                    ally_team: team(t.ally_team),
                    // Bit 0 is set for an AI team.
                    flags: t.ai.is_some() as u8,
                    colour: t.color,
                    side: t.side.clone(),
                    leader: t.leader.clone(),
                })
                .collect(),
            map_size: [h.map_size_x, h.map_size_z],
        };
        Ok(Rest {
            first_frame,
            last_frame,
            info,
            features,
            terrain: self.terrain,
            units: self.next_unit,
            projectiles: self.next_projectile,
            unread_rest_rotations,
        })
    }
}
