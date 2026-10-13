//! Builds a track's units and projectiles from what the dump says, keeping
//! only the keys thinning leaves.
//!
//! What is held for a unit that is still alive is its keys so far and the
//! samples since each curve's last key. Nothing is held of a sample once the
//! stretch it is in has been thinned.

use crate::curves::*;
use crate::error::Result;
use crate::interpret::{ProjectileStart, QueueEntry, Sink, TargetValue, UnitPoint, UnitStart};
use crate::pose::{self, PieceSample};
use crate::thin::{Rules, Stretch};
use crate::SampleCounts;
use coilbox_track::{
    Keyed, PoseTrack, Projectile, QueueItem, QueueKey, TargetKey, TargetTrack, Unit,
};
use std::collections::HashMap;

/// One piece's curve while its unit is alive.
struct Posing {
    curve: PoseCurve,
    stretch: Stretch<PoseCurve>,
    /// The piece as last recorded. The recorder writes a piece only when its
    /// matrix changes, so this is where it is until the next row.
    last: PoseSample,
}

struct Building {
    unit: Unit,
    transform_curve: TransformCurve,
    transform: Stretch<TransformCurve>,
    status: Stretch<StatusCurve>,
    /// One for each of `unit.poses`, in the same order.
    posing: Vec<Posing>,
    /// The frame of the unit's last sample.
    last_point: Option<u32>,
}

struct Flying {
    projectile: Projectile,
    stretch: Stretch<ProjectileCurve>,
}

pub(crate) struct Thinner {
    rules: Rules,
    building: HashMap<u32, Building>,
    flying: HashMap<u32, Flying>,
    pub units: Vec<Unit>,
    pub projectiles: Vec<Projectile>,
    pub samples: SampleCounts,
}

/// Adds a key to a curve that holds its value until the next key: nothing
/// when the value has not changed, and in place of a key on the same frame.
fn step<K: Keyed + Clone + PartialEq>(keys: &mut Vec<K>, key: K, nothing: impl Fn(&K) -> bool) {
    let same = |a: &K, b: &K| {
        let mut a = a.clone();
        a.set_frame(b.frame());
        &a == b
    };
    if keys.last().is_some_and(|last| last.frame() == key.frame()) {
        keys.pop();
    }
    match keys.last() {
        Some(last) if same(last, &key) => {}
        // A curve with no keys is nothing for the whole match.
        None if nothing(&key) => {}
        _ => keys.push(key),
    }
}

impl Thinner {
    pub fn new(rules: Rules) -> Self {
        Self {
            rules,
            building: HashMap::new(),
            flying: HashMap::new(),
            units: Vec::new(),
            projectiles: Vec::new(),
            samples: SampleCounts::default(),
        }
    }

    fn unit(&mut self, serial: u32) -> &mut Building {
        self.building
            .get_mut(&serial)
            .expect("the interpreter starts a unit before anything else about it")
    }

    /// The units and projectiles in order of serial.
    pub fn finish(mut self) -> (Vec<Unit>, Vec<Projectile>, SampleCounts) {
        self.units.sort_by_key(|u| u.serial);
        self.projectiles.sort_by_key(|p| p.serial);
        (self.units, self.projectiles, self.samples)
    }
}

impl Sink for Thinner {
    fn unit_start(&mut self, start: &UnitStart) -> Result<()> {
        self.building.insert(
            start.serial,
            Building {
                unit: Unit {
                    engine_id: start.engine_id,
                    serial: start.serial,
                    unit_def: start.def,
                    team: start.team,
                    first_frame: start.frame,
                    last_frame: start.frame,
                    transform: vec![],
                    status: vec![],
                    targets: vec![],
                    poses: vec![],
                    queue: vec![],
                },
                transform_curve: TransformCurve {
                    radius: start.radius,
                },
                transform: Stretch::default(),
                status: Stretch::default(),
                posing: vec![],
                last_point: None,
            },
        );
        Ok(())
    }

    fn unit_point(&mut self, serial: u32, point: &UnitPoint) -> Result<()> {
        self.samples.units += 1;
        let rules = self.rules;
        let b = self.unit(serial);
        b.transform.push(
            &b.transform_curve,
            &rules,
            TransformSample {
                frame: point.frame,
                position: point.position,
                rotation: point.rotation,
            },
            &mut b.unit.transform,
        )?;
        b.status.push(
            &StatusCurve,
            &rules,
            StatusSample {
                frame: point.frame,
                health: point.health,
                build: point.build,
                flags: point.flags,
            },
            &mut b.unit.status,
        )?;
        b.last_point = Some(point.frame);
        Ok(())
    }

    fn target(&mut self, serial: u32, frame: u32, weapon: u8, target: &TargetValue) -> Result<()> {
        let q = self.rules.q;
        let key = TargetKey {
            frame,
            kind: target.kind,
            reference: target.reference,
            build_power: target.build_power,
            position: if target.kind >= 128 {
                [
                    q.position(target.position[0])?,
                    q.position(target.position[1])?,
                    q.position(target.position[2])?,
                ]
            } else {
                [0; 3]
            },
        };
        let unit = &mut self.unit(serial).unit;
        let at = match unit.targets.iter().position(|t| t.weapon == weapon) {
            Some(at) => at,
            None => {
                unit.targets.push(TargetTrack {
                    weapon,
                    keys: vec![],
                });
                unit.targets.len() - 1
            }
        };
        step(&mut unit.targets[at].keys, key, |k| k.kind == 0);
        Ok(())
    }

    fn queue(&mut self, serial: u32, frame: u32, items: &[QueueEntry]) -> Result<()> {
        let q = self.rules.q;
        let mut key = QueueKey {
            frame,
            items: Vec::with_capacity(items.len()),
        };
        for item in items {
            key.items.push(QueueItem {
                unit_def: item.def,
                x: q.position(item.x)?,
                z: q.position(item.z)?,
                facing: item.facing,
            });
        }
        step(&mut self.unit(serial).unit.queue, key, |k| {
            k.items.is_empty()
        });
        Ok(())
    }

    fn piece(&mut self, serial: u32, frame: u32, piece: u16, sample: &PieceSample) -> Result<()> {
        self.samples.poses += 1;
        let rules = self.rules;
        let b = self.unit(serial);
        let at = match b.unit.poses.iter().position(|p| p.piece == piece) {
            Some(at) => at,
            None => {
                b.unit.poses.push(PoseTrack {
                    piece,
                    keys: vec![],
                });
                b.posing.push(Posing {
                    curve: PoseCurve {
                        reach: sample.reach,
                    },
                    stretch: Stretch::default(),
                    last: PoseSample {
                        frame,
                        piece: *sample,
                        angles: pose::angles(&sample.rotation, None),
                    },
                });
                b.unit.poses.len() - 1
            }
        };
        let posing = &mut b.posing[at];
        let keys = &mut b.unit.poses[at].keys;
        // The piece stayed where it was last written up to the unit's last
        // sample. Without a sample there, the turn that starts now would be
        // spread back over the whole time it stood still.
        if let (Some(held_to), Some(last)) = (b.last_point, posing.stretch.last_frame()) {
            if last < held_to {
                let held = PoseSample {
                    frame: held_to,
                    ..posing.last
                };
                posing.stretch.push(&posing.curve, &rules, held, keys)?;
            }
        }
        let next = PoseSample {
            frame,
            piece: *sample,
            angles: pose::angles(&sample.rotation, Some(posing.last.angles)),
        };
        posing.last = next;
        posing.stretch.push(&posing.curve, &rules, next, keys)
    }

    fn unit_end(&mut self, serial: u32, last_frame: u32) -> Result<()> {
        let rules = self.rules;
        let mut b = self
            .building
            .remove(&serial)
            .expect("the interpreter ends a unit it started");
        b.transform
            .finish(&b.transform_curve, &rules, &mut b.unit.transform)?;
        b.status.finish(&StatusCurve, &rules, &mut b.unit.status)?;
        for (posing, track) in b.posing.iter_mut().zip(&mut b.unit.poses) {
            posing
                .stretch
                .finish(&posing.curve, &rules, &mut track.keys)?;
        }
        let mut unit = b.unit;
        unit.last_frame = last_frame;
        // A target let go of on the frame after the unit's last has nowhere
        // to be written.
        for track in &mut unit.targets {
            track.keys.retain(|k| k.frame <= last_frame);
        }
        unit.queue.retain(|k| k.frame <= last_frame);
        unit.targets.retain(|t| !t.keys.is_empty());
        // A piece with no track is at rest, so a track that never leaves rest
        // says nothing. Most watched pieces are like that: the pieces between
        // a muzzle and the root that no script moves.
        unit.poses.retain(|p| {
            p.keys
                .iter()
                .any(|k| (k.angles, k.offsets) != ([0; 3], [0; 3]))
        });
        unit.targets.sort_by_key(|t| t.weapon);
        unit.poses.sort_by_key(|p| p.piece);
        // The keys stay in memory until the track is written, and a list that
        // grew a key at a time has room for up to as many again.
        unit.transform.shrink_to_fit();
        unit.status.shrink_to_fit();
        unit.poses.iter_mut().for_each(|p| p.keys.shrink_to_fit());
        self.units.push(unit);
        Ok(())
    }

    fn projectile_start(&mut self, start: &ProjectileStart) -> Result<()> {
        self.flying.insert(
            start.serial,
            Flying {
                projectile: Projectile {
                    serial: start.serial,
                    weapon_def: start.weapon_def,
                    team: start.team,
                    shooter: start.shooter,
                    first_frame: start.frame,
                    last_frame: start.frame,
                    keys: vec![],
                },
                stretch: Stretch::default(),
            },
        );
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
        let rules = self.rules;
        let f = self
            .flying
            .get_mut(&serial)
            .expect("the interpreter starts a projectile before its first point");
        f.stretch.push(
            &ProjectileCurve,
            &rules,
            ProjectileSample {
                frame,
                position,
                velocity,
            },
            &mut f.projectile.keys,
        )
    }

    fn projectile_end(&mut self, serial: u32, last_frame: u32) -> Result<()> {
        let rules = self.rules;
        let mut f = self
            .flying
            .remove(&serial)
            .expect("the interpreter ends a projectile it started");
        f.stretch
            .finish(&ProjectileCurve, &rules, &mut f.projectile.keys)?;
        f.projectile.last_frame = last_frame;
        f.projectile.keys.shrink_to_fit();
        self.projectiles.push(f.projectile);
        Ok(())
    }
}
