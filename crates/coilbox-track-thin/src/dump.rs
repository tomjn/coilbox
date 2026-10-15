//! A reader for the rewind recorder's raw dump, a block at a time.
//!
//! The byte layout is in `lua/rewind-recorder/README.md`. Nothing here holds
//! more than one block, so a dump of any size reads in the memory of its
//! largest frame.

use crate::error::{Result, ThinError};
use serde::Deserialize;
use std::io::Read;

pub const MAGIC: [u8; 4] = *b"CBRD";
pub const VERSION: u32 = 1;

const BLOCK_HEADER: u32 = 1;
const BLOCK_PIECES: u32 = 2;
const BLOCK_FRAME: u32 = 3;
const BLOCK_END: u32 = 4;

/// The header block.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpHeader {
    pub format: u32,
    pub engine: String,
    pub game: String,
    pub game_version: String,
    pub map: String,
    pub map_size_x: u32,
    pub map_size_z: u32,
    pub square_size: u32,
    pub game_speed: u32,
    /// The engine's unit id limit. Builder work names a feature as its id
    /// plus this.
    pub max_units: u32,
    /// Frames between two samples of every unit.
    pub unit_frames: u32,
    pub last_frame: Option<u32>,
    pub terrain: bool,
    pub teams: Vec<DumpTeam>,
    /// Entry `n`, counting from 1, is definition id `n`.
    pub unit_defs: Vec<String>,
    /// Each unit definition's radius in elmos, in the order of `unit_defs`.
    /// A dump made before issue #3782 has none.
    pub unit_radii: Option<Vec<f32>>,
    /// Each unit definition's footprint, in the order of `unit_defs`: the
    /// engine's `xsize` and `zsize`, which count heightmap squares of
    /// `square_size` elmos. A dump made before issue #3807 has none.
    pub unit_footprints: Option<Vec<[u32; 2]>>,
    /// Entry `n`, counting from 1, is definition id `n`.
    pub feature_defs: Vec<String>,
    /// Entry `n`, counting from 0, is definition id `n`.
    pub weapon_defs: Vec<String>,
    /// The team rules parameters the recorder was asked to keep. Entry `n`,
    /// counting from 1, is parameter number `n`. A dump made before issue
    /// #3982 has none.
    #[serde(default)]
    pub team_params: Vec<String>,
    /// The game rules parameters the recorder was asked to keep.
    #[serde(default)]
    pub game_params: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpTeam {
    pub team: u8,
    pub ally_team: i32,
    pub side: String,
    pub leader: String,
    pub color: [u8; 3],
    /// The AI's name, for an AI team.
    pub ai: Option<String>,
    #[serde(default)]
    pub gaia: bool,
}

/// The piece tree of one unit definition.
#[derive(Debug, Clone, Deserialize)]
pub struct PieceTree {
    pub def: u32,
    /// A piece number in a frame block is a position in this list counting
    /// from 1.
    pub pieces: Vec<String>,
    /// Each piece's parent as a piece number, and 0 for the root.
    pub parents: Vec<u32>,
    /// The extension of the model's file in lower case, and empty for a
    /// definition that names none. A `3do` or `s3o` piece has no rest
    /// rotation. For any other format the engine may give it one that the
    /// dump does not have.
    #[serde(rename = "modelType")]
    pub model_type: Option<String>,
    /// Each piece's rest offset from its parent, in elmos. A dump made before
    /// issue #3783 has none.
    pub offsets: Option<Vec<[f32; 3]>>,
    /// The box round each piece's own geometry, in the piece's own space: the
    /// least x, y and z, then the greatest. Empty for a piece with none.
    pub bounds: Option<Vec<Vec<f32>>>,
}

/// The end block. A dump without one is a run that was stopped.
#[derive(Debug, Clone, Deserialize)]
pub struct DumpEnd {
    pub reason: String,
    pub frame: u32,
    pub frames: u32,
    pub winners: Vec<i32>,
}

/// A unit's thirteen pose numbers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnitPose {
    pub position: [f32; 3],
    pub front: [f32; 3],
    pub up: [f32; 3],
    /// As the engine has them. Health can be above the maximum and below zero.
    pub health: f32,
    pub max_health: f32,
    /// From 0 to 1.
    pub build: f32,
    /// Bit 0 is set when the unit is switched on.
    pub flags: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnitCreated {
    pub unit: u32,
    pub def: u32,
    pub team: i32,
    pub pose: UnitPose,
}

/// A unit and a pose: a sample, or a destroyed unit with the pose it was last
/// read in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnitRow {
    pub unit: u32,
    pub pose: UnitPose,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UnitGiven {
    pub unit: u32,
    pub team: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponTarget {
    pub unit: u32,
    /// From 1.
    pub weapon: u32,
    /// The engine's code: 0 none, 1 a unit, 2 a position, 3 a projectile.
    pub kind: u32,
    /// A unit id or a projectile id in the first, or a position in all three.
    pub value: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BuilderWork {
    pub unit: u32,
    /// What `Spring.GetUnitWorkerTask` answers. Below 0 is building.
    pub command: i32,
    /// A unit id, a feature id plus the unit id limit, or -1.
    pub target: i32,
    /// From 0 to 1 in steps of one fifteenth.
    pub build_power: f32,
    pub has_place: bool,
    pub place: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QueuedBuilding {
    pub def: u32,
    pub x: f32,
    pub z: f32,
    pub facing: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BuildQueue {
    pub unit: u32,
    pub items: Vec<QueuedBuilding>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PiecePose {
    pub unit: u32,
    /// From 1, a position in the unit definition's piece tree.
    pub piece: u32,
    /// The piece's model space matrix less its fourth row: the x axis, the y
    /// axis, the z axis, then the translation.
    pub matrix: [f32; 12],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FeatureCreated {
    pub feature: u32,
    pub def: u32,
    pub team: i32,
    pub position: [f32; 3],
    pub front: [f32; 3],
    pub up: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProjectileRow {
    pub projectile: u32,
    /// -1 for a piece of debris.
    pub def: i32,
    pub team: i32,
    /// The unit that fired it, or -1.
    pub owner: i32,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TerrainChange {
    /// Heightmap corners, which are 8 elmos apart.
    pub x: u32,
    pub z: u32,
    pub before: f32,
    pub after: f32,
}

/// What a team holds, written when either number changes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TeamHeld {
    pub team: u32,
    pub metal: f32,
    pub energy: f32,
}

/// The rest of what the engine keeps for a team, written when any of it
/// changes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TeamEconomy {
    pub team: u32,
    /// Storage, pull, income, expense, share level, sent, received and excess.
    pub metal: [f32; 8],
    pub energy: [f32; 8],
}

/// A rules parameter that changed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParamRow {
    /// `None` for a game rules parameter.
    pub team: Option<u32>,
    /// From 1, a position in the header's list of names.
    pub param: u32,
    pub value: f32,
}

/// One frame block, cut into its sections.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Frame {
    pub frame: u32,
    pub created: Vec<UnitCreated>,
    pub destroyed: Vec<UnitRow>,
    pub given: Vec<UnitGiven>,
    pub samples: Vec<UnitRow>,
    pub targets: Vec<WeaponTarget>,
    pub work: Vec<BuilderWork>,
    pub queues: Vec<BuildQueue>,
    pub poses: Vec<PiecePose>,
    pub features_created: Vec<FeatureCreated>,
    pub features_destroyed: Vec<u32>,
    pub projectiles: Vec<ProjectileRow>,
    pub terrain: Vec<TerrainChange>,
    pub team_held: Vec<TeamHeld>,
    pub team_economy: Vec<TeamEconomy>,
    /// Team rules parameters, then game rules parameters.
    pub params: Vec<ParamRow>,
}

#[derive(Debug, Clone)]
pub enum Block {
    Header(Box<DumpHeader>),
    Pieces(PieceTree),
    Frame(Box<Frame>),
    End(DumpEnd),
    /// A kind this reader does not know, skipped by its length.
    Unknown(u32),
}

fn bad(reason: impl Into<String>) -> ThinError {
    ThinError::Dump(reason.into())
}

/// A whole number that the recorder wrote as a float.
fn whole(value: f32, what: &str, frame: u32) -> Result<i64> {
    if value.fract() != 0.0 || !value.is_finite() {
        return Err(bad(format!(
            "frame {frame} has {value} where {what} should be a whole number"
        )));
    }
    Ok(value as i64)
}

fn id(value: f32, what: &str, frame: u32) -> Result<u32> {
    u32::try_from(whole(value, what, frame)?)
        .map_err(|_| bad(format!("frame {frame} has {value} for {what}")))
}

fn signed(value: f32, what: &str, frame: u32) -> Result<i32> {
    Ok(whole(value, what, frame)? as i32)
}

fn three(v: &[f32]) -> [f32; 3] {
    [v[0], v[1], v[2]]
}

fn pose(v: &[f32]) -> UnitPose {
    UnitPose {
        position: three(&v[0..3]),
        front: three(&v[3..6]),
        up: three(&v[6..9]),
        health: v[9],
        max_health: v[10],
        build: v[11],
        flags: v[12],
    }
}

/// Cuts a section into rows of `width` numbers.
fn rows<'a>(
    values: &'a [f32],
    width: usize,
    code: u32,
    frame: u32,
) -> Result<std::slice::ChunksExact<'a, f32>> {
    if !values.len().is_multiple_of(width) {
        return Err(bad(format!(
            "section {code} of frame {frame} holds {} numbers, which is not a whole number of rows of {width}",
            values.len()
        )));
    }
    Ok(values.chunks_exact(width))
}

impl Frame {
    /// Reads a frame block's payload.
    pub fn parse(payload: &[u8]) -> Result<Self> {
        if !payload.len().is_multiple_of(4) || payload.len() < 4 {
            return Err(bad(format!(
                "a frame block of {} bytes is not a list of floats",
                payload.len()
            )));
        }
        let values: Vec<f32> = payload
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        let frame = id(values[0], "the frame number", 0)?;
        let mut out = Frame {
            frame,
            ..Frame::default()
        };
        let mut seen = 0u32;
        let mut at = 1;
        while at < values.len() {
            let code = id(values[at], "a section code", frame)?;
            let count = values
                .get(at + 1)
                .map(|c| id(*c, "a section's count", frame))
                .transpose()?
                .map(|c| c as usize)
                .filter(|c| at + 2 + c <= values.len())
                .ok_or_else(|| bad(format!("section {code} runs past the end of frame {frame}")))?;
            let v = &values[at + 2..at + 2 + count];
            at += 2 + count;
            if code < 32 {
                if seen & (1 << code) != 0 {
                    return Err(bad(format!(
                        "section {code} appears twice in frame {frame}"
                    )));
                }
                seen |= 1 << code;
            }
            match code {
                1 => {
                    for r in rows(v, 16, code, frame)? {
                        out.created.push(UnitCreated {
                            unit: id(r[0], "a unit id", frame)?,
                            def: id(r[1], "a unit definition", frame)?,
                            team: signed(r[2], "a team", frame)?,
                            pose: pose(&r[3..]),
                        });
                    }
                }
                2 | 4 => {
                    let into = if code == 2 {
                        &mut out.destroyed
                    } else {
                        &mut out.samples
                    };
                    for r in rows(v, 14, code, frame)? {
                        into.push(UnitRow {
                            unit: id(r[0], "a unit id", frame)?,
                            pose: pose(&r[1..]),
                        });
                    }
                }
                3 => {
                    for r in rows(v, 2, code, frame)? {
                        out.given.push(UnitGiven {
                            unit: id(r[0], "a unit id", frame)?,
                            team: signed(r[1], "a team", frame)?,
                        });
                    }
                }
                5 => {
                    for r in rows(v, 6, code, frame)? {
                        out.targets.push(WeaponTarget {
                            unit: id(r[0], "a unit id", frame)?,
                            weapon: id(r[1], "a weapon number", frame)?,
                            kind: id(r[2], "a target kind", frame)?,
                            value: three(&r[3..6]),
                        });
                    }
                }
                6 => {
                    for r in rows(v, 8, code, frame)? {
                        out.work.push(BuilderWork {
                            unit: id(r[0], "a unit id", frame)?,
                            command: signed(r[1], "a builder's command", frame)?,
                            target: signed(r[2], "a builder's target", frame)?,
                            build_power: r[3],
                            has_place: r[4] != 0.0,
                            place: three(&r[5..8]),
                        });
                    }
                }
                7 => {
                    let mut i = 0;
                    while i < v.len() {
                        let items = v
                            .get(i + 1)
                            .map(|n| id(*n, "a build queue's length", frame))
                            .transpose()?
                            .map(|n| n as usize)
                            .filter(|n| i + 2 + n * 4 <= v.len())
                            .ok_or_else(|| {
                                bad(format!("the build queues of frame {frame} do not add up"))
                            })?;
                        let mut queue = BuildQueue {
                            unit: id(v[i], "a unit id", frame)?,
                            items: Vec::with_capacity(items),
                        };
                        for r in v[i + 2..i + 2 + items * 4].as_chunks::<4>().0 {
                            queue.items.push(QueuedBuilding {
                                def: id(r[0], "a unit definition", frame)?,
                                x: r[1],
                                z: r[2],
                                facing: id(r[3], "a facing", frame)?,
                            });
                        }
                        out.queues.push(queue);
                        i += 2 + items * 4;
                    }
                }
                8 => {
                    for r in rows(v, 14, code, frame)? {
                        let mut matrix = [0.0; 12];
                        matrix.copy_from_slice(&r[2..14]);
                        out.poses.push(PiecePose {
                            unit: id(r[0], "a unit id", frame)?,
                            piece: id(r[1], "a piece number", frame)?,
                            matrix,
                        });
                    }
                }
                9 => {
                    for r in rows(v, 12, code, frame)? {
                        out.features_created.push(FeatureCreated {
                            feature: id(r[0], "a feature id", frame)?,
                            def: id(r[1], "a feature definition", frame)?,
                            team: signed(r[2], "a team", frame)?,
                            position: three(&r[3..6]),
                            front: three(&r[6..9]),
                            up: three(&r[9..12]),
                        });
                    }
                }
                10 => {
                    for r in v {
                        out.features_destroyed.push(id(*r, "a feature id", frame)?);
                    }
                }
                11 => {
                    for r in rows(v, 10, code, frame)? {
                        out.projectiles.push(ProjectileRow {
                            projectile: id(r[0], "a projectile id", frame)?,
                            def: signed(r[1], "a weapon definition", frame)?,
                            team: signed(r[2], "a team", frame)?,
                            owner: signed(r[3], "a projectile's owner", frame)?,
                            position: three(&r[4..7]),
                            velocity: three(&r[7..10]),
                        });
                    }
                }
                12 => {
                    for r in rows(v, 4, code, frame)? {
                        out.terrain.push(TerrainChange {
                            x: id(r[0], "a heightmap x", frame)?,
                            z: id(r[1], "a heightmap z", frame)?,
                            before: r[2],
                            after: r[3],
                        });
                    }
                }
                13 => {
                    for r in rows(v, 3, code, frame)? {
                        out.team_held.push(TeamHeld {
                            team: id(r[0], "a team", frame)?,
                            metal: r[1],
                            energy: r[2],
                        });
                    }
                }
                14 => {
                    for r in rows(v, 17, code, frame)? {
                        let (mut metal, mut energy) = ([0.0; 8], [0.0; 8]);
                        metal.copy_from_slice(&r[1..9]);
                        energy.copy_from_slice(&r[9..17]);
                        out.team_economy.push(TeamEconomy {
                            team: id(r[0], "a team", frame)?,
                            metal,
                            energy,
                        });
                    }
                }
                15 => {
                    for r in rows(v, 3, code, frame)? {
                        out.params.push(ParamRow {
                            team: Some(id(r[0], "a team", frame)?),
                            param: id(r[1], "a team parameter's number", frame)?,
                            value: r[2],
                        });
                    }
                }
                16 => {
                    for r in rows(v, 2, code, frame)? {
                        out.params.push(ParamRow {
                            team: None,
                            param: id(r[0], "a game parameter's number", frame)?,
                            value: r[1],
                        });
                    }
                }
                // A section this reader does not know is skipped by its count.
                _ => {}
            }
        }
        Ok(out)
    }
}

/// Reads a dump a block at a time.
pub struct DumpReader<R> {
    source: R,
    truncated: bool,
    payload: Vec<u8>,
}

/// Fills `buf` as far as the source goes, and says how far that was.
fn read_up_to(source: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match source.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

impl<R: Read> DumpReader<R> {
    /// Checks the magic and the version and stops before the first block.
    pub fn open(mut source: R) -> Result<Self> {
        let mut head = [0u8; 8];
        if read_up_to(&mut source, &mut head)? < 8 || head[0..4] != MAGIC {
            return Err(bad("this is not a rewind dump: it does not start CBRD"));
        }
        let version = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);
        if version != VERSION {
            return Err(bad(format!(
                "the dump is version {version}, and this reader knows {VERSION}"
            )));
        }
        Ok(Self {
            source,
            truncated: false,
            payload: Vec::new(),
        })
    }

    /// Whether the file stopped part way through a block, which is how a
    /// cancelled run can end. Everything read before that is good.
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    /// The next block's kind and payload, or `None` at the end of the file.
    fn next_raw(&mut self) -> Result<Option<u32>> {
        let mut head = [0u8; 8];
        let got = read_up_to(&mut self.source, &mut head)?;
        if got < 8 {
            self.truncated = got != 0;
            return Ok(None);
        }
        let kind = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let length = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        self.payload.resize(length, 0);
        if read_up_to(&mut self.source, &mut self.payload)? < length {
            self.truncated = true;
            return Ok(None);
        }
        Ok(Some(kind))
    }

    /// The next block, or `None` at the end of the file.
    pub fn next_block(&mut self) -> Result<Option<Block>> {
        let Some(kind) = self.next_raw()? else {
            return Ok(None);
        };
        let json = |what: &str, e: serde_json::Error| bad(format!("the dump's {what}: {e}"));
        Ok(Some(match kind {
            BLOCK_HEADER => Block::Header(Box::new(
                serde_json::from_slice(&self.payload).map_err(|e| json("header block", e))?,
            )),
            BLOCK_PIECES => Block::Pieces(
                serde_json::from_slice(&self.payload).map_err(|e| json("piece tree block", e))?,
            ),
            BLOCK_FRAME => Block::Frame(Box::new(Frame::parse(&self.payload)?)),
            BLOCK_END => {
                Block::End(serde_json::from_slice(&self.payload).map_err(|e| json("end block", e))?)
            }
            other => Block::Unknown(other),
        }))
    }
}
