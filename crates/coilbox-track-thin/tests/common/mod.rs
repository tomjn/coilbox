//! Shared by the integration tests: a writer of rewind dumps, made from the
//! byte layout in `lua/rewind-recorder/README.md` and not from this crate's
//! reader, and a small scene builder on top of it.

#![allow(dead_code)]

use coilbox_track::{Feature, Header, Info, TrackReader, Window};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// One frame block as rows of numbers, in the README's column order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FrameSpec {
    pub created: Vec<[f32; 16]>,
    pub samples: Vec<[f32; 14]>,
    pub targets: Vec<[f32; 6]>,
    pub work: Vec<[f32; 8]>,
    /// Each queue is a unit, a count, then four numbers an item.
    pub queues: Vec<Vec<f32>>,
    pub poses: Vec<[f32; 14]>,
    pub destroyed: Vec<[f32; 14]>,
    pub given: Vec<[f32; 2]>,
    pub features_created: Vec<[f32; 12]>,
    pub features_destroyed: Vec<f32>,
    pub projectiles: Vec<[f32; 10]>,
    pub terrain: Vec<[f32; 4]>,
    /// A team, its metal and its energy.
    pub team_held: Vec<[f32; 3]>,
    /// A team, then storage, pull, income, expense, share, sent, received and
    /// excess, for metal and then energy.
    pub team_economy: Vec<[f32; 17]>,
    /// A team, a parameter's number from 1, and its value.
    pub team_params: Vec<[f32; 3]>,
    /// A parameter's number from 1, and its value.
    pub game_params: Vec<[f32; 2]>,
}

fn section(out: &mut Vec<f32>, code: u32, numbers: Vec<f32>) {
    // A section is left out when it has nothing in it.
    if numbers.is_empty() {
        return;
    }
    out.push(code as f32);
    out.push(numbers.len() as f32);
    out.extend(numbers);
}

fn flat<const N: usize>(rows: &[[f32; N]]) -> Vec<f32> {
    rows.iter().flatten().copied().collect()
}

/// A frame block's payload: the frame number, then each section as a code, a
/// count and that many numbers, in the order the recorder writes them.
pub fn frame_payload(frame: u32, f: &FrameSpec) -> Vec<u8> {
    let mut n = vec![frame as f32];
    section(&mut n, 1, flat(&f.created));
    section(&mut n, 4, flat(&f.samples));
    section(&mut n, 5, flat(&f.targets));
    section(&mut n, 6, flat(&f.work));
    section(&mut n, 7, f.queues.iter().flatten().copied().collect());
    section(&mut n, 8, flat(&f.poses));
    section(&mut n, 2, flat(&f.destroyed));
    section(&mut n, 3, flat(&f.given));
    section(&mut n, 9, flat(&f.features_created));
    section(&mut n, 10, f.features_destroyed.clone());
    section(&mut n, 11, flat(&f.projectiles));
    section(&mut n, 12, flat(&f.terrain));
    section(&mut n, 13, flat(&f.team_held));
    section(&mut n, 14, flat(&f.team_economy));
    section(&mut n, 15, flat(&f.team_params));
    section(&mut n, 16, flat(&f.game_params));
    n.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Writes a dump: `CBRD`, the version, then blocks of a kind, a length and a
/// payload.
pub struct DumpBuilder {
    bytes: Vec<u8>,
}

impl DumpBuilder {
    pub fn new() -> Self {
        let mut bytes = b"CBRD".to_vec();
        bytes.extend(1u32.to_le_bytes());
        Self { bytes }
    }

    pub fn block(&mut self, kind: u32, payload: &[u8]) -> &mut Self {
        self.bytes.extend(kind.to_le_bytes());
        self.bytes.extend((payload.len() as u32).to_le_bytes());
        self.bytes.extend(payload);
        self
    }

    pub fn header(&mut self, json: &str) -> &mut Self {
        self.block(1, json.as_bytes())
    }

    pub fn pieces(&mut self, json: &str) -> &mut Self {
        self.block(2, json.as_bytes())
    }

    pub fn frame(&mut self, frame: u32, spec: &FrameSpec) -> &mut Self {
        self.block(3, &frame_payload(frame, spec))
    }

    pub fn end(&mut self, json: &str) -> &mut Self {
        self.block(4, json.as_bytes())
    }

    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

/// Where a unit is on one frame.
#[derive(Debug, Clone, Copy)]
pub struct At {
    pub position: [f32; 3],
    /// Radians about the y axis. 0 faces along z.
    pub heading: f32,
    pub health: f32,
    pub max_health: f32,
    pub build: f32,
    pub on: bool,
}

impl At {
    pub fn place(x: f32, y: f32, z: f32) -> Self {
        Self {
            position: [x, y, z],
            heading: 0.0,
            health: 100.0,
            max_health: 100.0,
            build: 1.0,
            on: true,
        }
    }

    pub fn facing(mut self, heading: f32) -> Self {
        self.heading = heading;
        self
    }

    /// The thirteen numbers of a pose.
    pub fn pose(&self) -> [f32; 13] {
        let [x, y, z] = self.position;
        let (s, c) = self.heading.sin_cos();
        [
            x,
            y,
            z,
            s,
            0.0,
            c,
            0.0,
            1.0,
            0.0,
            self.health,
            self.max_health,
            self.build,
            if self.on { 1.0 } else { 0.0 },
        ]
    }
}

fn row<const N: usize>(head: &[f32], pose: &[f32; 13]) -> [f32; N] {
    let mut out = [0.0; N];
    out[..head.len()].copy_from_slice(head);
    out[head.len()..].copy_from_slice(pose);
    out
}

/// The frames between two unit samples, as the recorder has it.
pub const UNIT_FRAMES: u32 = 3;

/// A match to write as a dump. Unit definition 1 is `tank` with a radius of
/// 10 elmos and definition 2 is `tower`, whose radius a test may set. The
/// third value is the definition's footprint in heightmap squares.
pub struct Scene {
    pub last_frame: u32,
    pub unit_defs: Vec<(String, f32, [u32; 2])>,
    pub frames: BTreeMap<u32, FrameSpec>,
    /// Left out of the header when false, as a dump from before issue #3782.
    pub radii: bool,
    /// Left out of the header when false, as a dump from before issue #3807.
    pub footprints: bool,
    /// Left out when false, as a run that was stopped.
    pub ended: bool,
    /// Left out of the piece trees when false, as a dump from before issue
    /// #3783.
    pub rest: bool,
    /// The format of every model.
    pub model_type: String,
    /// The rules parameters the header names. `None` leaves both lists out of
    /// the header, as a dump from before issue #3982.
    pub params: Option<(Vec<String>, Vec<String>)>,
}

/// Every model: a base, a turret 5 elmos up from it, a barrel 2 up and 3
/// forward of the turret, and a flare with no geometry 12 along the barrel.
pub const PIECES: [&str; 4] = ["base", "turret", "barrel", "flare"];
pub const REST: [[f32; 3]; 4] = [
    [0.0, 0.0, 0.0],
    [0.0, 5.0, 0.0],
    [0.0, 2.0, 3.0],
    [0.0, 0.0, 12.0],
];
const BOUNDS: &str = "[[-8,0,-12,8,5,12],[-5,0,-5,5,4,5],[-0.5,-0.5,0,0.5,0.5,12],[]]";

impl Scene {
    pub fn new(last_frame: u32) -> Self {
        Self {
            last_frame,
            unit_defs: vec![
                ("tank".into(), 10.0, [4, 6]),
                ("tower".into(), 85.0, [12, 10]),
            ],
            frames: BTreeMap::new(),
            radii: true,
            footprints: true,
            ended: true,
            rest: true,
            model_type: "s3o".into(),
            params: None,
        }
    }

    /// What team `team` holds from block `frame` on.
    pub fn held(&mut self, frame: u32, team: u32, metal: f32, energy: f32) {
        self.frame(frame)
            .team_held
            .push([team as f32, metal, energy]);
    }

    /// The rest of team `team`'s economy from block `frame` on: storage, pull,
    /// income, expense, share, sent, received and excess.
    pub fn economy(&mut self, frame: u32, team: u32, metal: [f32; 8], energy: [f32; 8]) {
        let mut row = [0.0; 17];
        row[0] = team as f32;
        row[1..9].copy_from_slice(&metal);
        row[9..17].copy_from_slice(&energy);
        self.frame(frame).team_economy.push(row);
    }

    pub fn frame(&mut self, frame: u32) -> &mut FrameSpec {
        self.frames.entry(frame).or_default()
    }

    /// A unit that the recorder hears of in block `from` and that is last
    /// alive on frame `to`. It is sampled on every third frame, and written
    /// as destroyed in the block after `to` when the match goes on past it.
    pub fn unit(&mut self, id: u32, def: u32, from: u32, to: u32, at: impl Fn(u32) -> At) {
        self.frame(from)
            .created
            .push(row(&[id as f32, def as f32, 0.0], &at(from).pose()));
        for f in from..=to {
            if f % UNIT_FRAMES == 0 {
                self.frame(f).samples.push(row(&[id as f32], &at(f).pose()));
            }
        }
        if to < self.last_frame {
            self.frame(to + 1)
                .destroyed
                .push(row(&[id as f32], &at(to).pose()));
        }
    }

    /// A projectile with a row on every frame from `from` to `to`.
    pub fn projectile(
        &mut self,
        id: u32,
        def: i32,
        owner: i32,
        from: u32,
        to: u32,
        at: impl Fn(u32) -> ([f32; 3], [f32; 3]),
    ) {
        for f in from..=to {
            let (p, v) = at(f);
            self.frame(f).projectiles.push([
                id as f32,
                def as f32,
                0.0,
                owner as f32,
                p[0],
                p[1],
                p[2],
                v[0],
                v[1],
                v[2],
            ]);
        }
    }

    pub fn header_json(&self) -> String {
        let names: Vec<String> = self
            .unit_defs
            .iter()
            .map(|(n, _, _)| format!("\"{n}\""))
            .collect();
        let radii: Vec<String> = self
            .unit_defs
            .iter()
            .map(|(_, r, _)| r.to_string())
            .collect();
        let mut radii = if self.radii {
            format!(",\"unitRadii\":[{}]", radii.join(","))
        } else {
            String::new()
        };
        if self.footprints {
            let footprints: Vec<String> = self
                .unit_defs
                .iter()
                .map(|(_, _, f)| format!("[{},{}]", f[0], f[1]))
                .collect();
            radii += &format!(",\"unitFootprints\":[{}]", footprints.join(","));
        }
        if let Some((team, game)) = &self.params {
            radii += &format!(",\"teamParams\":{team:?},\"gameParams\":{game:?}");
        }
        format!(
            concat!(
                "{{\"format\":1,\"engine\":\"2026.01.0 test\",\"game\":\"Test Game\",",
                "\"gameVersion\":\"1.0\",\"map\":\"Test Map\",\"mapSizeX\":4096,\"mapSizeZ\":4096,",
                "\"squareSize\":8,\"gameSpeed\":30,\"maxUnits\":32000,\"unitFrames\":3,",
                "\"lastFrame\":{},\"terrain\":true,\"teams\":[",
                "{{\"team\":0,\"allyTeam\":0,\"side\":\"arm\",\"leader\":\"Ada\",\"color\":[10,20,30]}},",
                "{{\"team\":1,\"allyTeam\":1,\"side\":\"core\",\"leader\":\"\",\"color\":[200,0,0],\"ai\":\"NullAI\"}},",
                "{{\"team\":2,\"allyTeam\":2,\"side\":\"\",\"leader\":\"\",\"color\":[255,255,255],\"gaia\":true}}],",
                "\"unitDefs\":[{}]{},\"featureDefs\":[\"tree\",\"wreck\"],",
                "\"weaponDefs\":[\"nothing\",\"cannon\",\"laser\"]}}"
            ),
            self.last_frame,
            names.join(","),
            radii
        )
    }

    pub fn bytes(&self) -> Vec<u8> {
        let mut dump = DumpBuilder::new();
        dump.header(&self.header_json());
        for def in 1..=self.unit_defs.len() {
            let rest = if self.rest {
                format!(
                    ",\"modelType\":\"{}\",\"offsets\":{REST:?},\"bounds\":{BOUNDS}",
                    self.model_type
                )
            } else {
                String::new()
            };
            dump.pieces(&format!(
                "{{\"def\":{def},\"pieces\":{PIECES:?},\"parents\":[0,1,2,3]{rest}}}"
            ));
        }
        let empty = FrameSpec::default();
        for f in 0..=self.last_frame {
            dump.frame(f, self.frames.get(&f).unwrap_or(&empty));
        }
        if self.ended {
            dump.end(&format!(
                "{{\"reason\":\"game_over\",\"frame\":{},\"frames\":{},\"winners\":[0]}}",
                self.last_frame,
                self.last_frame + 1
            ));
        }
        dump.bytes()
    }

    /// Writes the dump into `dir` and gives its path and a path for a track.
    pub fn write(&self, dir: &Path) -> (PathBuf, PathBuf) {
        let dump = dir.join("match.dump");
        std::fs::write(&dump, self.bytes()).unwrap();
        (dump, dir.join("match.cbtrack"))
    }
}

/// What a script has set on one piece: turns about x, y and z in radians,
/// and a move from its rest position.
#[derive(Debug, Clone, Copy, Default)]
pub struct Set {
    pub turn: [f32; 3],
    pub moved: [f32; 3],
}

impl Set {
    pub fn turn(x: f32, y: f32, z: f32) -> Self {
        Self {
            turn: [x, y, z],
            moved: [0.0; 3],
        }
    }
}

type M3 = [[f64; 3]; 3];

fn times(a: &M3, b: &M3) -> M3 {
    let mut out = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            out[r][c] = (0..3).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    out
}

/// The rotation the engine makes of a piece's three turns: about z, then
/// about x, then about y (`CQuaternion::FromEulerYPR`).
fn turned(turn: [f32; 3]) -> M3 {
    let [(sx, cx), (sy, cy), (sz, cz)] = turn.map(|a| (a as f64).sin_cos());
    let about_x = [[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]];
    let about_y = [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]];
    let about_z = [[cz, -sz, 0.0], [sz, cz, 0.0], [0.0, 0.0, 1.0]];
    times(&times(&about_y, &about_x), &about_z)
}

/// The piece pose rows of one unit on one frame, as the engine would give
/// them: `set` is what a script has set on each piece from the base down, and
/// each row is the piece in the unit's model space. The rows come deepest
/// piece first, which is the order the recorder writes them in.
pub fn piece_rows(unit: u32, set: &[Set]) -> Vec<[f32; 14]> {
    let mut rotation: M3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let mut at = [0.0f64; 3];
    let mut rows = Vec::new();
    for (piece, set) in set.iter().enumerate() {
        // A piece sits at its rest offset and its move, in its parent's space.
        for r in 0..3 {
            at[r] += (0..3)
                .map(|c| rotation[r][c] * (REST[piece][c] + set.moved[c]) as f64)
                .sum::<f64>();
        }
        rotation = times(&rotation, &turned(set.turn));
        let mut row = [0.0f32; 14];
        row[0] = unit as f32;
        row[1] = (piece + 1) as f32;
        for c in 0..3 {
            for r in 0..3 {
                row[2 + c * 3 + r] = rotation[r][c] as f32;
            }
        }
        for r in 0..3 {
            row[11 + r] = at[r] as f32;
        }
        rows.push(row);
    }
    rows.reverse();
    rows
}

/// Everything in a written track.
pub struct Read {
    pub header: Header,
    pub info: Info,
    pub features: Vec<Feature>,
    pub windows: Vec<Window>,
    pub terrain: Vec<Vec<coilbox_track::TerrainRow>>,
}

pub fn read_track(path: &Path) -> Read {
    let mut reader = TrackReader::open(std::fs::File::open(path).unwrap()).unwrap();
    let header = reader.header().clone();
    let count = header.window_count as usize;
    Read {
        info: reader.info().unwrap(),
        features: reader.features().unwrap(),
        windows: (0..count).map(|k| reader.window(k).unwrap()).collect(),
        terrain: (0..count).map(|k| reader.terrain(k).unwrap()).collect(),
        header,
    }
}

impl Read {
    /// The one unit with this engine id in window `k`.
    pub fn unit(&self, k: usize, engine_id: u16) -> &coilbox_track::Unit {
        let found: Vec<_> = self.windows[k]
            .units
            .iter()
            .filter(|u| u.unit.engine_id == engine_id)
            .collect();
        assert_eq!(found.len(), 1, "units with engine id {engine_id}");
        &found[0].unit
    }
}

pub fn frames<K: coilbox_track::Keyed>(keys: &[K]) -> Vec<u32> {
    keys.iter().map(|k| k.frame()).collect()
}
