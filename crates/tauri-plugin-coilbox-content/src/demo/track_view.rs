//! A recorded track, read for the replay page (issue #3806).
//!
//! Two commands. [`content_replay_track_header`] answers what the whole track
//! says about itself, as JSON. [`content_replay_track_window`] sends one time
//! window of keys as raw bytes, which the frontend views as typed arrays.
//!
//! # Why bytes on a channel
//!
//! A window is hundreds of kilobytes of numbers. As JSON it would be larger and
//! the frontend would build every number as an object. A command that returns
//! bytes has no place for an error, and the plugin's commands all answer with a
//! `CliResult`. So the bytes go down a `Channel<InvokeResponseBody>`, which
//! Tauri delivers as an `ArrayBuffer`, and the command answers with the usual
//! envelope. Nothing is sent when the window cannot be read.
//!
//! # Faults
//!
//! A fault is data in a successful envelope: `{ ok: false, fault: { kind, ... } }`.
//! The envelope's own error is a bare string, which the UI could not tell apart.
//! See [`Fault`] for the kinds. A window that is corrupt is a fault for that
//! window only, and the header and every other window still read.
//!
//! # Watching
//!
//! Reading the header is watching the track: it sets the file's modified time
//! with `track_store::mark_watched`, so a disk budget removes it last. The file
//! is opened afresh by every call and closed before the call returns, so
//! nothing here keeps a track from being deleted or replaced, which Windows
//! would refuse for an open file. Reading the index again costs the header's
//! 96 bytes and 16 bytes a window, and the real BAR track measures it in the
//! ignored test below.
//!
//! The budget's `in_use` set is not fed from here. It would need a command to
//! say a view has closed, and a track that is watched is the last the budget
//! removes. A track removed under a view answers [`Fault::Missing`] on the next
//! window.
//!
//! # The window payload
//!
//! All numbers are little endian and every array starts on a multiple of 4
//! bytes, so the frontend can view each one in place. The arrays follow a
//! header of ten `u32`, in the order below. `F` is a frame number, always
//! absolute.
//!
//! ```text
//! header   layout version (1), window index, start F, end F,
//!          units U, transform keys T, status keys S,
//!          projectiles P, projectile keys K, 0
//! units    serial u32[U], first F u32[U], last F u32[U],
//!          transform start u32[U+1], status start u32[U+1],
//!          definition u16[U], team u8[U]
//! transform keys   F u32[T], x f32[T], z f32[T],
//!                  kept components i16[T] three times, dropped component u8[T]
//! status keys      F u32[S], health u16[S], build progress u16[S]
//! projectiles      serial u32[P], first F u32[P], last F u32[P],
//!                  key start u32[P+1], weapon u16[P], team u8[P]
//! projectile keys  F u32[K], x f32[K], z f32[K], velocity x f32[K], velocity z f32[K]
//! ```
//!
//! Units are in order of first frame, so "every unit alive at `f`" is the
//! prefix with `first <= f`, kept to those with `last >= f`, and never reads a
//! key. A unit's keys are `start[i]..start[i+1]` of each key array, in time
//! order. Positions and velocities are in elmos and elmos per frame. The file
//! stores them as whole steps of a power of two, and a step count under 2 to
//! the power 24 is exact as an `f32`, so dequantising here loses nothing. A
//! rotation is sent as the file stores it, because the dropped component comes
//! back through a square root that the frontend does in the same `f64`
//! arithmetic as `coilbox-track`. Height is not sent: the map view is top down.
//! A pose, a target and a build queue are not sent either.

use std::io::{Read, Seek};
use std::path::Path;

use coilbox_track::{Quantiser, TrackError, TrackReader, Window, FORMAT_VERSION};
use coilbox_track_thin::RECORDER_VERSION;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Runtime};

use super::track_store;

/// The first word of a window payload. Changes with the layout above.
pub const LAYOUT_VERSION: u32 = 1;

/// Why a track or a window could not be read. Each kind is one the replay page
/// shows differently.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Fault {
    /// There is no track for this replay.
    Missing,
    /// The track was made by another version of the recorder. It is offered for
    /// recording again and not played.
    Stale { recorder_version: u16, current: u16 },
    /// The file in this replay's place names another game.
    OtherGame,
    /// The file is in a layout this build does not read. `field` is the header
    /// field and `found` the value in it.
    UnknownFormat {
        field: String,
        found: String,
        expected: String,
    },
    /// The header, the window index or the info and features chunks cannot be
    /// read.
    Unreadable { message: String },
    /// One window cannot be read. Every other window still can.
    CorruptWindow { window: usize, message: String },
    /// The track has no such window.
    NoSuchWindow { window: usize, window_count: u32 },
    /// The file could not be opened or read.
    Io { message: String },
}

impl std::fmt::Display for Fault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => f.write_str("this replay has no recorded track"),
            Self::Stale {
                recorder_version,
                current,
            } => write!(
                f,
                "the track was made by recorder version {recorder_version} and this is {current}"
            ),
            Self::OtherGame => f.write_str("the track in this replay's place is for another game"),
            Self::UnknownFormat {
                field,
                found,
                expected,
            } => write!(
                f,
                "the track's {field} is {found}, and this build reads {expected}"
            ),
            Self::Unreadable { message } => write!(f, "the track cannot be read: {message}"),
            Self::CorruptWindow { window, message } => {
                write!(f, "window {window} cannot be read: {message}")
            }
            Self::NoSuchWindow {
                window,
                window_count,
            } => write!(
                f,
                "there is no window {window}, the track has {window_count}"
            ),
            Self::Io { message } => write!(f, "the track file failed: {message}"),
        }
    }
}

/// A team, as the info chunk holds it.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamView {
    pub id: u8,
    pub ally_team: u8,
    pub is_ai: bool,
    pub colour: [u8; 3],
    pub side: String,
    pub leader: String,
}

/// The features chunk, one array for each field. A feature exists at frame `f`
/// when `first <= f <= last`. `team` is 255 for none. `x` and `z` are elmos.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeatureColumns {
    pub def: Vec<u16>,
    pub team: Vec<u8>,
    pub x: Vec<f64>,
    pub z: Vec<f64>,
    pub first: Vec<u32>,
    pub last: Vec<u32>,
}

/// What the whole track says about itself.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderView {
    pub game_id: String,
    pub format_version: u16,
    pub recorder_version: u16,
    pub frames_per_second: u16,
    pub first_frame: u32,
    pub last_frame: u32,
    /// `last_frame - first_frame`.
    pub length_frames: u32,
    pub window_length: u32,
    pub window_count: u32,
    /// In elmos.
    pub tolerance: f64,
    pub position_shift: u8,
    pub velocity_shift: u8,
    pub rotation_bits: u8,
    pub unit_count: u32,
    pub projectile_count: u32,
    pub feature_count: u32,
    pub engine_version: String,
    pub game: String,
    pub map: String,
    pub writer: String,
    /// Along x and z, in elmos.
    pub map_size: [u32; 2],
    pub unit_defs: Vec<String>,
    /// Each unit definition's footprint in elmos, in the order of `unit_defs`:
    /// across the unit, then along the way it faces.
    pub unit_footprints: Vec<[u16; 2]>,
    pub weapon_defs: Vec<String>,
    pub feature_defs: Vec<String>,
    pub teams: Vec<TeamView>,
    pub features: FeatureColumns,
}

fn fault_of(e: TrackError) -> Fault {
    match e {
        TrackError::UnknownLayout {
            field,
            found,
            expected,
        } => Fault::UnknownFormat {
            field: field.to_string(),
            found,
            expected,
        },
        TrackError::Io(e) => Fault::Io {
            message: e.to_string(),
        },
        other => Fault::Unreadable {
            message: other.to_string(),
        },
    }
}

/// Opens a track and checks that it is a current one for `game_id`. Reads the
/// header and the window index and nothing else.
pub fn open_checked<R: Read + Seek>(source: R, game_id: &str) -> Result<TrackReader<R>, Fault> {
    let reader = TrackReader::open(source).map_err(fault_of)?;
    let header = reader.header();
    if Some(header.game_id) != track_store::id_bytes(game_id) {
        return Err(Fault::OtherGame);
    }
    if header.recorder_version != RECORDER_VERSION {
        return Err(Fault::Stale {
            recorder_version: header.recorder_version,
            current: RECORDER_VERSION,
        });
    }
    Ok(reader)
}

/// The header answer, from a track opened with [`open_checked`].
pub fn header_view<R: Read + Seek>(
    reader: &mut TrackReader<R>,
    game_id: &str,
) -> Result<HeaderView, Fault> {
    let info = reader.info().map_err(fault_of)?;
    let features = reader.features().map_err(fault_of)?;
    let q = reader.quantiser().map_err(fault_of)?;
    // The thinner writes a footprint for every definition from recorder
    // version 3, so a current track without them came from somewhere else. The
    // map view sizes its marks from them and has nothing to fall back on.
    if info.unit_footprints.len() != info.unit_defs.len() {
        return Err(Fault::Unreadable {
            message: format!(
                "it has {} footprints for {} unit definitions",
                info.unit_footprints.len(),
                info.unit_defs.len()
            ),
        });
    }
    let h = reader.header();
    let mut columns = FeatureColumns::default();
    for f in &features {
        columns.def.push(f.feature_def);
        columns.team.push(f.team);
        columns.x.push(q.position_value(f.position[0]));
        columns.z.push(q.position_value(f.position[2]));
        columns.first.push(f.first_frame);
        columns.last.push(f.last_frame);
    }
    Ok(HeaderView {
        game_id: game_id.to_string(),
        format_version: FORMAT_VERSION,
        recorder_version: h.recorder_version,
        frames_per_second: h.frames_per_second,
        first_frame: h.first_frame,
        last_frame: h.last_frame,
        length_frames: h.last_frame - h.first_frame,
        window_length: h.window_length,
        window_count: h.window_count,
        tolerance: h.tolerance as f64,
        position_shift: h.position_shift,
        velocity_shift: h.velocity_shift,
        rotation_bits: h.rotation_bits,
        unit_count: h.unit_count,
        projectile_count: h.projectile_count,
        feature_count: h.feature_count,
        engine_version: info.engine_version,
        game: info.game,
        map: info.map,
        writer: info.writer,
        map_size: info.map_size,
        unit_defs: info.unit_defs,
        unit_footprints: info.unit_footprints,
        weapon_defs: info.weapon_defs,
        feature_defs: info.feature_defs,
        teams: info
            .teams
            .iter()
            .map(|t| TeamView {
                id: t.id,
                ally_team: t.ally_team,
                is_ai: t.flags & 1 != 0,
                colour: t.colour,
                side: t.side.clone(),
                leader: t.leader.clone(),
            })
            .collect(),
        features: columns,
    })
}

/// Appends arrays, each padded to a multiple of 4 bytes.
struct Out(Vec<u8>);

impl Out {
    fn pad(&mut self) {
        while !self.0.len().is_multiple_of(4) {
            self.0.push(0);
        }
    }

    fn u32s(&mut self, values: impl IntoIterator<Item = u32>) {
        for v in values {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
    }

    fn f32s(&mut self, values: impl IntoIterator<Item = f32>) {
        for v in values {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
    }

    fn u16s(&mut self, values: impl IntoIterator<Item = u16>) {
        for v in values {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        self.pad();
    }

    fn i16s(&mut self, values: impl IntoIterator<Item = i16>) {
        for v in values {
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        self.pad();
    }

    fn u8s(&mut self, values: impl IntoIterator<Item = u8>) {
        self.0.extend(values);
        self.pad();
    }
}

/// Running totals for a `start` array: `U + 1` entries, the first 0.
fn starts(counts: impl Iterator<Item = usize>) -> Vec<u32> {
    let mut out = vec![0u32];
    for n in counts {
        out.push(out.last().copied().unwrap_or(0) + n as u32);
    }
    out
}

/// A window as the payload the module note describes.
pub fn encode_window(window: &Window, q: &Quantiser) -> Vec<u8> {
    let mut units: Vec<_> = window.units.iter().map(|u| &u.unit).collect();
    units.sort_by_key(|u| (u.first_frame, u.serial));
    let mut projectiles: Vec<_> = window.projectiles.iter().map(|p| &p.projectile).collect();
    projectiles.sort_by_key(|p| (p.first_frame, p.serial));

    let transforms = units.iter().flat_map(|u| u.transform.iter());
    let statuses = units.iter().flat_map(|u| u.status.iter());
    let shots = projectiles.iter().flat_map(|p| p.keys.iter());
    let (t, s, k) = (
        transforms.clone().count(),
        statuses.clone().count(),
        shots.clone().count(),
    );

    let mut out = Out(Vec::new());
    out.u32s([
        LAYOUT_VERSION,
        window.index as u32,
        window.start_frame,
        window.end_frame,
        units.len() as u32,
        t as u32,
        s as u32,
        projectiles.len() as u32,
        k as u32,
        0,
    ]);

    out.u32s(units.iter().map(|u| u.serial));
    out.u32s(units.iter().map(|u| u.first_frame));
    out.u32s(units.iter().map(|u| u.last_frame));
    out.u32s(starts(units.iter().map(|u| u.transform.len())));
    out.u32s(starts(units.iter().map(|u| u.status.len())));
    out.u16s(units.iter().map(|u| u.unit_def));
    out.u8s(units.iter().map(|u| u.team));

    out.u32s(transforms.clone().map(|key| key.frame));
    out.f32s(
        transforms
            .clone()
            .map(|key| q.position_value(key.position[0]) as f32),
    );
    out.f32s(
        transforms
            .clone()
            .map(|key| q.position_value(key.position[2]) as f32),
    );
    for axis in 0..3 {
        out.i16s(transforms.clone().map(|key| key.rotation.kept[axis]));
    }
    out.u8s(transforms.map(|key| key.rotation.dropped));

    out.u32s(statuses.clone().map(|key| key.frame));
    out.u16s(statuses.clone().map(|key| key.health));
    out.u16s(statuses.map(|key| key.build_progress));

    out.u32s(projectiles.iter().map(|p| p.serial));
    out.u32s(projectiles.iter().map(|p| p.first_frame));
    out.u32s(projectiles.iter().map(|p| p.last_frame));
    out.u32s(starts(projectiles.iter().map(|p| p.keys.len())));
    out.u16s(projectiles.iter().map(|p| p.weapon_def));
    out.u8s(projectiles.iter().map(|p| p.team));

    out.u32s(shots.clone().map(|key| key.frame));
    out.f32s(
        shots
            .clone()
            .map(|key| q.position_value(key.position[0]) as f32),
    );
    out.f32s(
        shots
            .clone()
            .map(|key| q.position_value(key.position[2]) as f32),
    );
    out.f32s(
        shots
            .clone()
            .map(|key| q.velocity_value(key.velocity[0]) as f32),
    );
    out.f32s(shots.map(|key| q.velocity_value(key.velocity[2]) as f32));
    out.0
}

/// Window `k` of an open track as its payload and its frame bounds.
pub fn read_window<R: Read + Seek>(
    source: R,
    game_id: &str,
    k: usize,
) -> Result<(Vec<u8>, u32, u32), Fault> {
    let mut reader = open_checked(source, game_id)?;
    let window_count = reader.header().window_count;
    if k >= window_count as usize {
        return Err(Fault::NoSuchWindow {
            window: k,
            window_count,
        });
    }
    let q = reader.quantiser().map_err(fault_of)?;
    let window = reader.window(k).map_err(|e| match e {
        TrackError::Io(e) => Fault::Io {
            message: e.to_string(),
        },
        other => Fault::CorruptWindow {
            window: k,
            message: other.to_string(),
        },
    })?;
    Ok((
        encode_window(&window, &q),
        window.start_frame,
        window.end_frame,
    ))
}

fn open_file(dir: &Path, game_id: &str) -> Result<std::fs::File, Result<Fault, String>> {
    let path = track_store::track_path(dir, game_id).map_err(Err)?;
    std::fs::File::open(path).map_err(|e| {
        Ok(if e.kind() == std::io::ErrorKind::NotFound {
            Fault::Missing
        } else {
            Fault::Io {
                message: e.to_string(),
            }
        })
    })
}

fn answer(result: Result<Value, Result<Fault, String>>) -> picoframe_core::CliResult {
    match result {
        Ok(mut body) => {
            body["ok"] = json!(true);
            picoframe_core::CliResult::ok(body)
        }
        Err(Ok(fault)) => picoframe_core::CliResult::ok(json!({ "ok": false, "fault": fault })),
        Err(Err(message)) => picoframe_core::CliResult::err(message),
    }
}

/// The header answer for a replay's track, and mark the track watched.
pub fn view_header(dir: &Path, game_id: &str) -> picoframe_core::CliResult {
    answer((|| {
        let file = open_file(dir, game_id)?;
        let mut reader = open_checked(file, game_id).map_err(Ok)?;
        let header = header_view(&mut reader, game_id).map_err(Ok)?;
        // A track that was read is a track that was watched. Failing to say so
        // costs only its place in the budget's order.
        let _ = track_store::mark_watched(dir, game_id);
        Ok(json!({ "header": header }))
    })())
}

/// Window `k` of a replay's track: the payload goes down `channel` and the
/// answer says what was sent.
pub fn view_window(
    dir: &Path,
    game_id: &str,
    k: usize,
    channel: &Channel<InvokeResponseBody>,
) -> picoframe_core::CliResult {
    answer((|| {
        let file = open_file(dir, game_id)?;
        let (payload, start_frame, end_frame) = read_window(file, game_id, k).map_err(Ok)?;
        let byte_length = payload.len();
        channel
            .send(InvokeResponseBody::Raw(payload))
            .map_err(|e| Err(format!("could not send the window: {e}")))?;
        Ok(json!({
            "window": k,
            "startFrame": start_frame,
            "endFrame": end_frame,
            "byteLength": byte_length,
        }))
    })())
}

/// `content_replay_track_header`: what the whole track says about itself, as
/// `{ ok: true, header }`, or `{ ok: false, fault }` for a [`Fault`]. Reading it
/// marks the track watched.
#[tauri::command]
pub(crate) async fn content_replay_track_header<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
) -> picoframe_core::CliResult {
    let dir = match track_store::app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return picoframe_core::CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || view_header(&dir, &game_id)).await {
        Ok(result) => result,
        Err(e) => picoframe_core::CliResult::err(format!("reading the track failed: {e}")),
    }
}

/// `content_replay_track_window`: one window of keys. The bytes arrive on
/// `on_window` as one `ArrayBuffer` laid out as the module note says, and the
/// command answers `{ ok: true, window, startFrame, endFrame, byteLength }` or
/// `{ ok: false, fault }`. Nothing is sent for a fault. Give each call its own
/// channel.
#[tauri::command]
pub(crate) async fn content_replay_track_window<R: Runtime>(
    app: AppHandle<R>,
    game_id: String,
    window: usize,
    on_window: Channel<InvokeResponseBody>,
) -> picoframe_core::CliResult {
    let dir = match track_store::app_store_dir(&app) {
        Ok(dir) => dir,
        Err(e) => return picoframe_core::CliResult::err(e),
    };
    match tauri::async_runtime::spawn_blocking(move || {
        view_window(&dir, &game_id, window, &on_window)
    })
    .await
    {
        Ok(result) => result,
        Err(e) => picoframe_core::CliResult::err(format!("reading the window failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use coilbox_track::{
        projectile_at, status_at, transform_at, Feature, Info, Projectile, ProjectileKey, Settings,
        StatusKey, Team, Track, TransformKey, Unit,
    };
    use std::cell::RefCell;
    use std::io::{Cursor, SeekFrom};
    use std::rc::Rc;
    use std::sync::{Arc, Mutex};

    const ID: &str = "00112233445566778899aabbccddeeff";
    const OTHER: &str = "ffeeddccbbaa99887766554433221100";
    /// Where the TypeScript tests read what these tests wrote.
    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../src/content/fixtures/replay-track-window.json"
    );

    fn id_bytes(id: &str) -> [u8; 16] {
        track_store::id_bytes(id).unwrap()
    }

    /// Three windows of 60 frames over frames 0 to 150. The windows are
    /// 0 to 60, 60 to 120 and 120 to 150, so frame 60 is in two of them.
    fn track(id: &str, recorder_version: u16) -> Track {
        let mut track = Track::new(Settings {
            recorder_version,
            game_id: id_bytes(id),
            first_frame: 0,
            last_frame: 150,
            window_length: 60,
            ..Settings::default()
        });
        let q = track.quantiser().unwrap();
        track.info = Info {
            engine_version: "2025.04.8".into(),
            game: "Test Game 1".into(),
            map: "Test Map".into(),
            writer: "track_view tests".into(),
            unit_defs: vec!["armcom".into(), "armpw".into()],
            unit_footprints: vec![[32, 48], [16, 16]],
            weapon_defs: vec!["laser".into()],
            feature_defs: vec!["armmex_dead".into()],
            teams: vec![
                Team {
                    id: 0,
                    ally_team: 0,
                    flags: 0,
                    colour: [255, 0, 10],
                    side: "arm".into(),
                    leader: "Ann".into(),
                },
                Team {
                    id: 1,
                    ally_team: 1,
                    flags: 1,
                    colour: [0, 128, 255],
                    side: "core".into(),
                    leader: "Bot".into(),
                },
            ],
            map_size: [8192, 6144],
            ..Info::default()
        };
        track.features = vec![
            Feature {
                engine_id: 5,
                feature_def: 0,
                team: 1,
                flags: 0,
                first_frame: 40,
                last_frame: 150,
                position: [q.position(1200.5).unwrap(), 30, q.position(300.25).unwrap()],
                rotation: q.rotation([0.0, 0.0, 0.0, 1.0]),
            },
            Feature {
                engine_id: 6,
                feature_def: 0,
                team: 255,
                flags: 1,
                first_frame: 0,
                last_frame: 150,
                position: [0, 0, 0],
                rotation: q.rotation([0.0, 0.0, 0.0, 1.0]),
            },
        ];
        let transform = |frame, x: f64, z: f64, rot: [f64; 4]| TransformKey {
            frame,
            position: [q.position(x).unwrap(), 20, q.position(z).unwrap()],
            rotation: q.rotation(rot),
        };
        let status = |frame, health: f64, build: f64| StatusKey {
            frame,
            health: q.fraction(health),
            build_progress: q.fraction(build),
            flags: 1,
        };
        let unit = |serial, unit_def, team, first, last, transform, status| Unit {
            engine_id: 7000 + serial as u16,
            serial,
            unit_def,
            team,
            first_frame: first,
            last_frame: last,
            transform,
            status,
            targets: vec![],
            poses: vec![],
            queue: vec![],
        };
        track.units = vec![
            unit(
                0,
                0,
                0,
                0,
                150,
                vec![
                    transform(0, 100.0, 200.0, [0.0, 0.0, 0.0, 1.0]),
                    transform(45, 160.5, 260.25, [0.0, 0.2, 0.0, 0.98]),
                    transform(61, 175.0, 262.0, [0.0, 0.5, 0.0, 0.87]),
                    transform(100, 400.0, 100.0, [0.0, 0.7, 0.0, 0.71]),
                    transform(150, 410.0, 90.0, [0.0, 0.7, 0.0, 0.71]),
                ],
                vec![
                    status(0, 1.0, 0.0),
                    status(40, 0.9, 1.0),
                    status(130, 0.25, 1.0),
                ],
            ),
            // Dies in the middle of window 1. The second rotation is across
            // the blend's sign flip: its dot product with the first is negative.
            unit(
                1,
                1,
                1,
                30,
                89,
                vec![
                    transform(30, 3000.0, 2000.0, [0.0, 0.0, 0.0, 1.0]),
                    transform(70, 3100.0, 2050.0, [0.1, 0.99, 0.0, -0.05]),
                    transform(89, 3300.0, 2200.0, [0.1, 0.99, 0.0, -0.05]),
                ],
                vec![status(30, 0.5, 0.5), status(89, 0.0, 1.0)],
            ),
            // Appears in window 1 and carries on into window 2.
            unit(
                2,
                0,
                1,
                100,
                149,
                vec![
                    transform(100, 50.0, 50.0, [0.0, 0.0, 0.0, 1.0]),
                    transform(149, 60.0, 5000.0, [0.0, 0.1, 0.0, 0.99]),
                ],
                vec![status(100, 1.0, 1.0)],
            ),
        ];
        let shot = |frame, p: [f64; 3], v: [f64; 3]| ProjectileKey {
            frame,
            position: p.map(|c| q.position(c).unwrap()),
            velocity: v.map(|c| q.velocity(c).unwrap()),
        };
        track.projectiles = vec![
            Projectile {
                serial: 0,
                weapon_def: 0,
                team: 0,
                shooter: Some(0),
                first_frame: 10,
                last_frame: 50,
                keys: vec![
                    shot(10, [100.0, 40.0, 200.0], [10.0, 0.5, 5.0]),
                    shot(30, [300.0, 50.0, 300.0], [10.0, -0.5, 5.0]),
                    shot(50, [500.0, 40.0, 400.0], [10.0, -1.0, 5.0]),
                ],
            },
            // Crosses the boundary at frame 60.
            Projectile {
                serial: 1,
                weapon_def: 0,
                team: 1,
                shooter: None,
                first_frame: 50,
                last_frame: 75,
                keys: vec![
                    shot(50, [900.0, 10.0, 900.0], [-3.0, 2.0, 0.0]),
                    shot(75, [825.0, 10.0, 900.0], [-3.0, -2.0, 0.0]),
                ],
            },
            // Debris, with no weapon.
            Projectile {
                serial: 2,
                weapon_def: 65_535,
                team: 255,
                shooter: None,
                first_frame: 90,
                last_frame: 100,
                keys: vec![
                    shot(90, [10.0, 5.0, 10.0], [1.0, 1.0, 1.0]),
                    shot(100, [20.0, 5.0, 20.0], [1.0, -1.0, 1.0]),
                ],
            },
        ];
        track
    }

    fn bytes() -> Vec<u8> {
        track(ID, RECORDER_VERSION).to_bytes().unwrap()
    }

    fn put(dir: &Path, id: &str, bytes: &[u8]) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(track_store::track_path(dir, id).unwrap(), bytes).unwrap();
    }

    /// The byte ranges a reader has handed out, as start and end.
    struct Recording<R> {
        inner: R,
        reads: Rc<RefCell<Vec<(u64, u64)>>>,
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

    /// The fields of a payload, read by the layout in the module note.
    struct Payload<'a>(&'a [u8]);

    impl Payload<'_> {
        fn word(&self, i: usize) -> u32 {
            u32::from_le_bytes(self.0[i * 4..i * 4 + 4].try_into().unwrap())
        }

        /// The `u32` array that starts `after` words in, `n` long.
        fn u32s(&self, after: usize, n: usize) -> Vec<u32> {
            (after..after + n).map(|i| self.word(i)).collect()
        }
    }

    fn json_of(result: &picoframe_core::CliResult) -> Value {
        assert!(result.success, "{:?}", result.error);
        result.data.clone().unwrap()
    }

    #[test]
    fn the_header_holds_what_the_map_view_needs() {
        let mut reader = open_checked(Cursor::new(bytes()), ID).unwrap();
        let h = header_view(&mut reader, ID).unwrap();
        assert_eq!(h.game_id, ID);
        assert_eq!(h.frames_per_second, 30);
        assert_eq!(
            (h.first_frame, h.last_frame, h.length_frames),
            (0, 150, 150)
        );
        assert_eq!((h.window_length, h.window_count), (60, 3));
        assert_eq!(h.recorder_version, RECORDER_VERSION);
        assert_eq!(
            (h.position_shift, h.velocity_shift, h.rotation_bits),
            (3, 11, 12)
        );
        assert_eq!(
            (h.unit_count, h.projectile_count, h.feature_count),
            (3, 3, 2)
        );
        assert_eq!(h.map, "Test Map");
        assert_eq!(h.game, "Test Game 1");
        assert_eq!(h.map_size, [8192, 6144]);
        assert_eq!(h.unit_defs, ["armcom", "armpw"]);
        assert_eq!(h.unit_footprints, [[32, 48], [16, 16]]);
        assert_eq!(h.weapon_defs, ["laser"]);
        assert_eq!(h.feature_defs, ["armmex_dead"]);
        assert_eq!(h.teams.len(), 2);
        assert_eq!(h.teams[0].colour, [255, 0, 10]);
        assert!(!h.teams[0].is_ai);
        assert!(h.teams[1].is_ai);
        assert_eq!(h.teams[1].leader, "Bot");
        assert_eq!(h.features.def, [0, 0]);
        assert_eq!(h.features.team, [1, 255]);
        assert_eq!(h.features.x, [1200.5, 0.0]);
        assert_eq!(h.features.z, [300.25, 0.0]);
        assert_eq!(h.features.first, [40, 0]);
        assert_eq!(h.features.last, [150, 150]);
    }

    #[test]
    fn a_track_with_no_footprints_is_not_drawn_with_guessed_sizes() {
        let mut track = track(ID, RECORDER_VERSION);
        track.info.unit_footprints.clear();
        let mut reader = open_checked(Cursor::new(track.to_bytes().unwrap()), ID).unwrap();
        let Err(Fault::Unreadable { message }) = header_view(&mut reader, ID) else {
            panic!("a track with no footprints gave a header");
        };
        assert!(message.contains("footprint"), "{message}");
    }

    #[test]
    fn a_window_has_its_units_in_order_of_first_frame_with_their_key_ranges() {
        let (payload, start, end) = read_window(Cursor::new(bytes()), ID, 1).unwrap();
        assert_eq!((start, end), (60, 120));
        let p = Payload(&payload);
        assert_eq!(p.word(0), LAYOUT_VERSION);
        assert_eq!((p.word(1), p.word(2), p.word(3)), (1, 60, 120));
        let (units, transforms, statuses) = (p.word(4) as usize, p.word(5), p.word(6));
        // Units 0, 1 and 2 all exist somewhere in window 1.
        assert_eq!(units, 3);
        let serial = p.u32s(10, units);
        let first = p.u32s(10 + units, units);
        let last = p.u32s(10 + 2 * units, units);
        // Window 1 holds frames 60 to 120. The unit that existed before it
        // starts at its first frame, and one that appears later at its own.
        assert_eq!(serial, [0, 1, 2]);
        assert_eq!(first, [60, 60, 100]);
        assert_eq!(last, [120, 89, 120]);
        let t_start = p.u32s(10 + 3 * units, units + 1);
        let s_start = p.u32s(10 + 4 * units + 1, units + 1);
        assert_eq!(t_start[0], 0);
        assert_eq!(*t_start.last().unwrap(), transforms);
        assert_eq!(s_start[0], 0);
        assert_eq!(*s_start.last().unwrap(), statuses);
        assert!(t_start.windows(2).all(|w| w[0] < w[1]), "{t_start:?}");
    }

    #[test]
    fn reading_a_window_reads_that_windows_bytes_and_no_others() {
        let file = bytes();
        let total = file.len() as u64;
        let reads = Rc::new(RefCell::new(Vec::new()));
        let source = Recording {
            inner: Cursor::new(file.clone()),
            reads: reads.clone(),
        };
        read_window(source, ID, 1).unwrap();

        let reader = TrackReader::open(Cursor::new(file)).unwrap();
        let entries = reader.window_entries().to_vec();
        let index_end =
            reader.header().header_size as u64 + 16 * reader.header().window_count as u64;
        let range = |i: usize| {
            let e = entries[i].main;
            (e.offset(), e.offset() + e.length as u64)
        };
        let read = reads.borrow().clone();
        let (lo, hi) = range(1);
        assert!(!read.is_empty());
        for r in &read {
            let in_index = r.1 <= index_end;
            let in_window = r.0 >= lo && r.1 <= hi;
            assert!(in_index || in_window, "read {r:?}, window 1 is {lo}..{hi}");
        }
        let in_window: u64 = read.iter().filter(|r| r.0 >= lo).map(|r| r.1 - r.0).sum();
        assert_eq!(in_window, hi - lo, "the whole of window 1 and no more");
        for other in [0, 2] {
            let (a, b) = range(other);
            assert!(
                !read.iter().any(|r| r.0 < b && a < r.1),
                "window {other} was read"
            );
        }
        assert!(in_window < total);
    }

    #[test]
    fn a_missing_track_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let result = view_header(dir.path(), ID);
        assert_eq!(
            json_of(&result),
            json!({ "ok": false, "fault": { "kind": "missing" } })
        );
    }

    #[test]
    fn a_track_from_another_recorder_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            ID,
            &track(ID, RECORDER_VERSION + 1).to_bytes().unwrap(),
        );
        assert_eq!(
            json_of(&view_header(dir.path(), ID)),
            json!({ "ok": false, "fault": {
                "kind": "stale",
                "recorderVersion": RECORDER_VERSION + 1,
                "current": RECORDER_VERSION
            } })
        );
    }

    #[test]
    fn a_track_for_another_game_is_refused_for_the_header_and_every_window() {
        let dir = tempfile::tempdir().unwrap();
        put(
            dir.path(),
            ID,
            &track(OTHER, RECORDER_VERSION).to_bytes().unwrap(),
        );
        let other = json!({ "ok": false, "fault": { "kind": "otherGame" } });
        assert_eq!(json_of(&view_header(dir.path(), ID)), other);
        let channel = Channel::new(|_| Ok(()));
        assert_eq!(json_of(&view_window(dir.path(), ID, 0, &channel)), other);
    }

    #[test]
    fn an_unknown_format_version_names_the_field_and_value() {
        let mut file = bytes();
        file[4..6].copy_from_slice(&2u16.to_le_bytes());
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &file);
        assert_eq!(
            json_of(&view_header(dir.path(), ID)),
            json!({ "ok": false, "fault": {
                "kind": "unknownFormat", "field": "version", "found": "2", "expected": "1"
            } })
        );
    }

    #[test]
    fn a_file_cut_short_is_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &bytes()[..40]);
        let answer = json_of(&view_header(dir.path(), ID));
        assert_eq!(answer["ok"], false);
        assert_eq!(answer["fault"]["kind"], "unreadable");
    }

    #[test]
    fn a_window_that_is_not_there_says_how_many_are() {
        assert_eq!(
            read_window(Cursor::new(bytes()), ID, 3).unwrap_err(),
            Fault::NoSuchWindow {
                window: 3,
                window_count: 3
            }
        );
    }

    #[test]
    fn one_corrupt_window_is_an_error_for_that_window_only() {
        let mut file = bytes();
        let reader = TrackReader::open(Cursor::new(file.clone())).unwrap();
        let bad = reader.window_entries()[1].main;
        // Past the two byte zlib header, into the compressed data.
        let at = bad.offset() as usize + 8;
        for b in &mut file[at..at + 6] {
            *b ^= 0xff;
        }
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &file);

        let sent: Arc<Mutex<Vec<usize>>> = Default::default();
        let log = sent.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(b) = body {
                log.lock().unwrap().push(b.len());
            }
            Ok(())
        });
        let broken = json_of(&view_window(dir.path(), ID, 1, &channel));
        assert_eq!(broken["ok"], false);
        assert_eq!(broken["fault"]["kind"], "corruptWindow");
        assert_eq!(broken["fault"]["window"], 1);
        assert!(
            sent.lock().unwrap().is_empty(),
            "nothing is sent for a fault"
        );

        for k in [0, 2] {
            assert_eq!(
                json_of(&view_window(dir.path(), ID, k, &channel))["ok"],
                true
            );
        }
        assert_eq!(sent.lock().unwrap().len(), 2);
        assert_eq!(json_of(&view_header(dir.path(), ID))["ok"], true);
    }

    #[test]
    fn a_window_is_sent_once_as_raw_bytes_and_described_by_the_answer() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &bytes());
        let sent: Arc<Mutex<Vec<Vec<u8>>>> = Default::default();
        let log = sent.clone();
        let channel = Channel::new(move |body| {
            match body {
                InvokeResponseBody::Raw(b) => log.lock().unwrap().push(b),
                InvokeResponseBody::Json(_) => panic!("a window must go as raw bytes"),
            }
            Ok(())
        });
        let answer = json_of(&view_window(dir.path(), ID, 2, &channel));
        let sent = sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(answer["ok"], true);
        assert_eq!(answer["window"], 2);
        assert_eq!(answer["startFrame"], 120);
        assert_eq!(answer["endFrame"], 150);
        assert_eq!(answer["byteLength"], sent[0].len());
        assert_eq!(sent[0].len() % 4, 0);
    }

    #[test]
    fn reading_the_header_marks_the_track_watched_and_reading_a_window_does_not() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &bytes());
        let path = track_store::track_path(dir.path(), ID).unwrap();
        let old =
            filetime::FileTime::from_unix_time(filetime::FileTime::now().seconds() - 86_400, 0);
        filetime::set_file_mtime(&path, old).unwrap();
        let mtime =
            || filetime::FileTime::from_last_modification_time(&std::fs::metadata(&path).unwrap());

        view_window(dir.path(), ID, 0, &Channel::new(|_| Ok(())));
        assert_eq!(mtime(), old);
        view_header(dir.path(), ID);
        assert!(mtime() > old);
    }

    #[test]
    fn a_track_is_not_held_open_between_calls() {
        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), ID, &bytes());
        view_header(dir.path(), ID);
        view_window(dir.path(), ID, 0, &Channel::new(|_| Ok(())));
        // The track can be replaced and removed straight after, which an open
        // handle would stop on Windows.
        put(dir.path(), ID, &bytes());
        assert!(track_store::remove(dir.path(), ID).unwrap());
    }

    /// The values the Rust reader gives, for the TypeScript curves to match.
    ///
    /// Run with `COILBOX_WRITE_FIXTURES=1` to write the file. Otherwise this
    /// checks the file on disk is what the reader gives now, so the two cannot
    /// drift: change the reader or the layout and this fails until the file is
    /// written again and the TypeScript tests pass against it.
    #[test]
    fn the_typescript_fixture_is_what_the_reader_gives() {
        use base64::Engine;
        let file = bytes();
        let mut reader = open_checked(Cursor::new(file), ID).unwrap();
        let q = reader.quantiser().unwrap();
        let frames = [
            0, 1, 7, 30, 44, 45, 52, 59, 60, 61, 75, 89, 90, 100, 120, 121, 149, 150,
        ];

        let mut windows = vec![];
        let (mut transform, mut status, mut projectile) = (vec![], vec![], vec![]);
        for k in 0..3usize {
            let window = reader.window(k).unwrap();
            windows.push(json!({
                "index": k,
                "payload": base64::engine::general_purpose::STANDARD.encode(encode_window(&window, &q)),
            }));
            for wu in &window.units {
                let u = &wu.unit;
                for f in frames
                    .iter()
                    .copied()
                    .filter(|f| (u.first_frame..=u.last_frame).contains(f))
                {
                    let (p, r) = transform_at(&u.transform, &q, f).unwrap();
                    transform.push(json!({
                        "window": k, "serial": u.serial, "frame": f,
                        "x": p[0], "z": p[2], "q": r,
                    }));
                    let (health, build, _) = status_at(&u.status, f).unwrap();
                    status.push(json!({
                        "window": k, "serial": u.serial, "frame": f,
                        "health": health, "build": build,
                    }));
                }
            }
            for wp in &window.projectiles {
                let p = &wp.projectile;
                for f in frames
                    .iter()
                    .copied()
                    .filter(|f| (p.first_frame..=p.last_frame).contains(f))
                {
                    let (pos, vel) = projectile_at(&p.keys, &q, f).unwrap();
                    projectile.push(json!({
                        "window": k, "serial": p.serial, "frame": f,
                        "x": pos[0], "z": pos[2], "vx": vel[0], "vz": vel[2],
                    }));
                }
            }
        }
        let window_of: Vec<Value> = [0u32, 1, 59, 60, 61, 119, 120, 121, 149, 150, 151, 900]
            .into_iter()
            .map(|f| json!({ "frame": f, "window": reader.header().window_of_frame(f) }))
            .collect();
        // How many units and projectiles are alive at each frame, counted from
        // the window that holds it, for the map view's tests (issue #3807).
        let mut alive = vec![];
        for f in frames {
            let window = reader
                .window(reader.header().window_of_frame(f) as usize)
                .unwrap();
            let units = window
                .units
                .iter()
                .filter(|u| (u.unit.first_frame..=u.unit.last_frame).contains(&f))
                .count();
            let projectiles = window
                .projectiles
                .iter()
                .filter(|p| (p.projectile.first_frame..=p.projectile.last_frame).contains(&f))
                .count();
            alive.push(json!({ "frame": f, "units": units, "projectiles": projectiles }));
        }
        let header = header_view(&mut reader, ID).unwrap();
        let fixture = json!({
            "header": header,
            "alive": alive,
            "layoutVersion": LAYOUT_VERSION,
            "rotationBits": q.rotation_bits(),
            "geometry": {
                "firstFrame": reader.header().first_frame,
                "windowLength": reader.header().window_length,
                "windowCount": reader.header().window_count,
            },
            "windowOfFrame": window_of,
            "windows": windows,
            "transform": transform,
            "status": status,
            "projectile": projectile,
        });
        let text = serde_json::to_string_pretty(&fixture).unwrap() + "\n";
        if std::env::var_os("COILBOX_WRITE_FIXTURES").is_some() {
            std::fs::write(FIXTURE, &text).unwrap();
        }
        let on_disk = std::fs::read_to_string(FIXTURE).unwrap_or_default();
        assert!(
            on_disk == text,
            "{FIXTURE} is not what the reader gives. Run this test with COILBOX_WRITE_FIXTURES=1"
        );
    }

    /// Measures the real BAR track. Run with
    /// `COILBOX_REWIND_BAR_TRACK=<path to bar-4.cbtrack> cargo test -p
    /// tauri-plugin-coilbox-content track_view -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs COILBOX_REWIND_BAR_TRACK, the path of a BAR track recorded by a past run"]
    fn measure_the_real_bar_track() {
        use std::time::Instant;
        let path = std::env::var("COILBOX_REWIND_BAR_TRACK").expect("the track's path");
        let mut file_bytes = std::fs::read(&path).unwrap();
        // The bench tracks were made from a dump with no game id, which the
        // store refuses as a name. The id is in the uncompressed header, so
        // this copy gets one and nothing else changes.
        if file_bytes[64..80] == [0; 16] {
            file_bytes[64..80].copy_from_slice(&id_bytes(ID));
        }
        let reader = TrackReader::open(Cursor::new(&file_bytes)).unwrap();
        let game_id: String = reader
            .header()
            .game_id
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let recorder = reader.header().recorder_version;
        println!("recorder version {recorder}, this build {RECORDER_VERSION}");

        let dir = tempfile::tempdir().unwrap();
        put(dir.path(), &game_id, &file_bytes);
        let times = |f: &mut dyn FnMut()| {
            let mut runs: Vec<_> = (0..20)
                .map(|_| {
                    let t = Instant::now();
                    f();
                    t.elapsed()
                })
                .collect();
            runs.sort();
            (runs[0], runs[runs.len() / 2], runs[runs.len() - 1])
        };

        let mut open_only = || {
            let f = std::fs::File::open(track_store::track_path(dir.path(), &game_id).unwrap())
                .unwrap();
            let _ = TrackReader::open(f).unwrap();
        };
        println!(
            "open (header and index), min/median/max of 20: {:?}",
            times(&mut open_only)
        );

        let mut header = || {
            let r = view_header(dir.path(), &game_id);
            assert!(r.success && r.data.as_ref().unwrap()["ok"] == true, "{r:?}");
        };
        println!(
            "header command, min/median/max of 20: {:?}",
            times(&mut header)
        );
        let json_len = serde_json::to_string(&view_header(dir.path(), &game_id).data)
            .unwrap()
            .len();
        println!("header JSON: {json_len} bytes");

        // The window with the most decompressed bytes.
        let mut r = TrackReader::open(Cursor::new(&file_bytes)).unwrap();
        let n = r.header().window_count as usize;
        let mut sizes: Vec<(usize, usize)> = (0..n)
            .map(|k| {
                (
                    r.window_chunk(k)
                        .map(|c| c.encode().unwrap().len())
                        .unwrap_or(0),
                    k,
                )
            })
            .collect();
        sizes.sort();
        let (largest_bytes, k) = *sizes.last().unwrap();
        println!("largest window is {k}: {largest_bytes} bytes decompressed");

        let mut payload_len = 0;
        let mut window = || {
            let f = std::fs::File::open(track_store::track_path(dir.path(), &game_id).unwrap())
                .unwrap();
            payload_len = read_window(f, &game_id, k).unwrap().0.len();
        };
        println!(
            "read and encode window {k}, min/median/max of 20: {:?}",
            times(&mut window)
        );
        println!("window {k} payload: {payload_len} bytes");

        let sent = Arc::new(Mutex::new(0usize));
        let seen = sent.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(b) = body {
                *seen.lock().unwrap() += b.len();
            }
            Ok(())
        });
        let mut through_command = || {
            let a = view_window(dir.path(), &game_id, k, &channel);
            assert!(a.success && a.data.as_ref().unwrap()["ok"] == true);
        };
        println!(
            "window command up to the channel send, min/median/max of 20: {:?}",
            times(&mut through_command)
        );
    }
}
