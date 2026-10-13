//! What a track holds, as whole numbers in the file's own units.
//!
//! Positions, offsets and heights are position steps. Velocities are velocity
//! steps. Angles are 65,536ths of a turn. Health and build progress are
//! 0 to 65,535. A [`crate::Quantiser`] converts to and from real values.
//!
//! Every key has an absolute frame. The file stores offsets from a window's
//! first frame, and the reader adds the window's start back.
//!
//! A reference to another unit or projectile is a serial number in a
//! [`crate::Track`] that is being written. In a [`crate::Window`] that has
//! been read it is an index in the window's own list, because that is what the
//! file stores. [`crate::Window::units`] and [`crate::Window::projectiles`]
//! give the serial for an index.

/// A unit's rotation in the smallest three form.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rotation {
    /// Which component of `(x, y, z, w)` is dropped, 0 to 3.
    pub dropped: u8,
    /// The other three, in order, as signed whole numbers.
    pub kept: [i16; 3],
}

/// Anything with a frame.
pub trait Keyed {
    fn frame(&self) -> u32;
    fn set_frame(&mut self, frame: u32);
}

macro_rules! keyed {
    ($($t:ty),*) => {$(
        impl Keyed for $t {
            fn frame(&self) -> u32 { self.frame }
            fn set_frame(&mut self, frame: u32) { self.frame = frame; }
        }
    )*};
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformKey {
    pub frame: u32,
    pub position: [i32; 3],
    pub rotation: Rotation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusKey {
    pub frame: u32,
    /// As a fraction of the unit's maximum at that frame, 65,535 for full.
    pub health: u16,
    /// 65,535 for complete.
    pub build_progress: u16,
    /// Bit 0: the unit is switched on.
    pub flags: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetKey {
    pub frame: u32,
    /// 0 nothing, 1 a unit, 2 a feature, 4 a projectile, 16 building or
    /// repairing a unit, 17 reclaiming a unit, 18 reclaiming a feature,
    /// 19 resurrecting a feature, 20 capturing a unit, 128 a position,
    /// 129 terraforming at a position.
    pub kind: u8,
    /// A unit, projectile or feature, by the numbering in the module note.
    /// Features are always an index in the features list. 0 when the kind has
    /// none.
    pub reference: u32,
    /// For builder work, the build power in use, 255 for full. 0 for a weapon.
    pub build_power: u8,
    /// Used when `kind` is 128 or more, otherwise 0.
    pub position: [i32; 3],
}

/// One weapon's target over time, or the builder work when `weapon` is 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetTrack {
    /// The weapon number from 1, or 0 for builder work.
    pub weapon: u8,
    pub keys: Vec<TargetKey>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoseKey {
    pub frame: u32,
    /// Turn about x, y and z in 65,536ths of a turn. Not reduced to one turn.
    /// In a written track a window shifts them by whole turns.
    pub angles: [i32; 3],
    /// Offset from the piece's rest position, in position steps.
    pub offsets: [i32; 3],
}

/// One aiming piece of one unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoseTrack {
    /// An index into the posed piece names of the unit's definition.
    pub piece: u16,
    pub keys: Vec<PoseKey>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueItem {
    pub unit_def: u16,
    pub x: i32,
    pub z: i32,
    /// 0 to 3.
    pub facing: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueKey {
    pub frame: u32,
    pub items: Vec<QueueItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectileKey {
    pub frame: u32,
    pub position: [i32; 3],
    pub velocity: [i32; 3],
}

keyed!(
    TransformKey,
    StatusKey,
    TargetKey,
    PoseKey,
    QueueKey,
    ProjectileKey
);

/// One unit, over the whole match when written and over one window when read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    /// The engine's unit id. The engine reuses these, so `serial` is what
    /// tells two units apart.
    pub engine_id: u16,
    /// Counts from 0 in order of first appearance in the match. A track
    /// being written must give each unit its own.
    pub serial: u32,
    pub unit_def: u16,
    pub team: u8,
    /// The first and last frame at which the unit exists.
    pub first_frame: u32,
    pub last_frame: u32,
    /// At least one key.
    pub transform: Vec<TransformKey>,
    /// At least one key.
    pub status: Vec<StatusKey>,
    pub targets: Vec<TargetTrack>,
    pub poses: Vec<PoseTrack>,
    pub queue: Vec<QueueKey>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projectile {
    /// Counts from 0 in order of first appearance in the match.
    pub serial: u32,
    /// 65,535 for a projectile with no weapon, which is debris.
    pub weapon_def: u16,
    pub team: u8,
    /// The unit that fired it.
    pub shooter: Option<u32>,
    pub first_frame: u32,
    pub last_frame: u32,
    /// At least one key.
    pub keys: Vec<ProjectileKey>,
}

/// A feature, listed once for the whole match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Feature {
    pub engine_id: u16,
    pub feature_def: u16,
    /// 255 for none.
    pub team: u8,
    /// Bit 0: it was there before the first frame. Bit 1: it was still there
    /// after the last frame.
    pub flags: u8,
    pub first_frame: u32,
    pub last_frame: u32,
    pub position: [i32; 3],
    pub rotation: Rotation,
}

impl Feature {
    /// A feature exists at frame `f` when `first <= f <= last`.
    pub fn exists_at(&self, frame: u32) -> bool {
        self.first_frame <= frame && frame <= self.last_frame
    }
}

/// One change to one heightmap corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerrainRow {
    pub frame: u32,
    /// Heightmap corners, which are 8 elmos apart.
    pub x: u16,
    pub z: u16,
    /// In position steps.
    pub before: i32,
    pub after: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Team {
    pub id: u8,
    pub ally_team: u8,
    /// Bit 0 is set for an AI team.
    pub flags: u8,
    pub colour: [u8; 3],
    pub side: String,
    pub leader: String,
}

/// The posed pieces of one unit definition, by name.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PosedPieces {
    /// An index in `unit_defs`.
    pub unit_def: u16,
    pub pieces: Vec<String>,
}

/// Names, teams and the map. Every other part of the file refers to a
/// definition by its index in these lists, counting from 0.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Info {
    pub engine_version: String,
    /// The game's name and version.
    pub game: String,
    pub map: String,
    /// The name and version of the program that wrote the file.
    pub writer: String,
    pub unit_defs: Vec<String>,
    /// Each unit definition's footprint in elmos, in the order of `unit_defs`:
    /// its size across the unit, then along the way it faces. Empty in a track
    /// written before recorder version 3, which has none.
    pub unit_footprints: Vec<[u16; 2]>,
    pub weapon_defs: Vec<String>,
    pub feature_defs: Vec<String>,
    pub posed_pieces: Vec<PosedPieces>,
    pub teams: Vec<Team>,
    /// The map's size along x and z in elmos.
    pub map_size: [u32; 2],
}
