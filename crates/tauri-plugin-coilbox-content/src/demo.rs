//! Replay (`.sdfz`/`.sdf`) discovery + decoding for the Replays screen.
//!
//! A Spring/Recoil demo is a gzip-compressed (`.sdfz`) or raw (`.sdf`) file laid
//! out (see the engine's `rts/System/LoadSave/demofile.h`) as a fixed
//! `DemoFileHeader`, then a plaintext TDF **start-script** (the full
//! `[game]{...}` setup), then the demo stream and player/team stats. The data the
//! Replays screen wants — map, game, players, sides/factions, ally-teams — lives
//! only in that start-script, which `demotool` never prints. So we read the
//! header + script natively (a small gunzip of the file's prefix), and shell out
//! to `demotool` for the one thing the prefix can't cheaply reach: the **winning
//! ally-teams**, recorded at the very end of the demo stream.
//!
//! Behind the stream sits the **trailer**: the winning ally-teams and a
//! statistics sample per team every `teamStatPeriod` seconds, which is the graph
//! the engine drew at the end of the match. [`read_trailer`] decodes it natively
//! from a seek and a struct read.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, UNIX_EPOCH};

use flate2::read::GzDecoder;

use crate::model::{
    AllyTeamInfo, ChatLine, DemoChat, DemoInfo, DemoTrailer, PlayerInfo, ReplayFile, StartBox,
    TeamStatSample, TeamStatSeries,
};

/// Folders under a write dir that hold client demos. The engine writes to
/// `demos/` (`DemoRecorder.cpp`), and some lobbies/users use `replays/`.
pub(crate) const DEMO_DIRS: &[&str] = &["demos", "replays"];
const DEMO_EXTS: &[&str] = &[".sdfz", ".sdf"];

/// `demotool` can decode the full 7 MB+ stream; keep a hard ceiling so a corrupt
/// file can't hang the worker (matches `engine::read_version`'s bounded run).
const DEMOTOOL_TIMEOUT: Duration = Duration::from_secs(30);

// DemoFileHeader field offsets (packed, little-endian). magic[16], i32 version,
// i32 headerSize, char versionString[256], u8 gameID[16], u64 unixTime,
// i32 scriptSize, i32 demoStreamSize, i32 gameTime, i32 wallclockTime, ...
const MAGIC: &[u8] = b"spring demofile";
const OFF_VERSION: usize = 16;
const OFF_HEADER_SIZE: usize = 20;
const OFF_VERSION_STRING: usize = 24;
const OFF_GAME_ID: usize = 280;
const OFF_UNIX_TIME: usize = 296;
const OFF_SCRIPT_SIZE: usize = 304;
const OFF_DEMO_STREAM_SIZE: usize = 308;
const OFF_GAME_TIME: usize = 312;
const OFF_WALLCLOCK: usize = 316;
const OFF_NUM_PLAYERS: usize = 320;
const OFF_PLAYER_STAT_SIZE: usize = 324;
const OFF_PLAYER_STAT_ELEM_SIZE: usize = 328;
/// `numTeams`, how many teams the end-of-game statistics block covers. Written
/// only when the game actually ended, see [`RawDemo::game_over`].
const OFF_NUM_TEAMS: usize = 332;
const OFF_TEAM_STAT_SIZE: usize = 336;
const OFF_TEAM_STAT_ELEM_SIZE: usize = 340;
const OFF_TEAM_STAT_PERIOD: usize = 344;
const OFF_WINNING_ALLY_TEAMS_SIZE: usize = 348;
/// We only need the header up to (and including) the team-count field. The v5
/// header is 352 bytes but reading this prefix is enough to locate the script.
const MIN_HEADER: usize = OFF_NUM_TEAMS + 4;

/// The only `DemoFileHeader` version this decoder knows the shape of.
const DEMO_VERSION: i32 = 5;
/// That version's header size, and so the position of everything behind it.
const HEADER_V5_SIZE: usize = 352;
/// `TeamStatistics`: 20 fields, `i32 frame` + 12 `f32` + 7 `i32`.
const TEAM_STAT_ELEM_SIZE: usize = 80;
/// `PlayerStatistics`: 5 `i32`. Nothing here decodes them yet (issue #1130), but
/// a different size means a different format.
const PLAYER_STAT_ELEM_SIZE: usize = 20;

// ---- listing ---------------------------------------------------------------

/// List a root's replays (cheap fs metadata only, demotool is never run here so
/// the list stays fast), newest first.
pub fn list_replays(root: &Path) -> Vec<ReplayFile> {
    let mut out: Vec<ReplayFile> = demo_file_entries(root)
        .into_iter()
        .map(|e| {
            // Cheap native decode (header + start-script only, no demotool) so the
            // list can show map/players/duration. Best-effort, ignored on failure.
            let summary = decode_native(&e.path).ok();
            let (skill_min, skill_avg, skill_max) = summary
                .as_ref()
                .map(|i| skill_stats(&i.players))
                .unwrap_or((None, None, None));
            ReplayFile {
                filename: e.filename,
                path: e.path.to_string_lossy().into_owned(),
                size_bytes: e.size_bytes,
                modified_ms: e.modified_ms,
                map_name: summary
                    .as_ref()
                    .map(|i| i.map_name.clone())
                    .filter(|s| !s.is_empty()),
                game_type: summary
                    .as_ref()
                    .map(|i| i.game_type.clone())
                    .filter(|s| !s.is_empty()),
                duration_sec: summary.as_ref().map(|i| i.duration_sec),
                player_count: summary
                    .as_ref()
                    .map(|i| i.players.iter().filter(|p| !p.spectator).count() as u32),
                start_time_ms: summary.as_ref().map(|i| i.start_time_ms),
                skill_min,
                skill_avg,
                skill_max,
                remixed: summary.as_ref().map(|i| i.remixed).unwrap_or(false),
            }
        })
        .collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.modified_ms));
    out
}

/// A demo file's identity from cheap fs metadata only (no header/script decode) —
/// what the stats ingest needs to decide whether a file is new or changed before
/// paying for a full decode. `(size_bytes, modified_ms)` is the change signature.
pub struct DemoFileEntry {
    pub filename: String,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// Every directory a root's replays can be written to: the root itself, then each
/// installed engine directory under it.
///
/// The engine writes `demos/` relative to its write dir, and which directory that
/// is depends on how the engine got installed. A Recoil release extracted whole
/// into `engine/<version>/` satisfies Recoil's Portable Mode test, so that engine
/// writes its replays inside its own folder. A springfiles install is not Portable
/// Mode (pr-downloader deletes the `springsettings.cfg` the test looks for), so
/// that engine writes to the shared root. Both are searched, so a player gets one
/// list of their games whichever engine recorded them, including the ones an
/// engine they have since upgraded past left behind.
pub fn demo_search_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    for (dir, _) in crate::scan::engine_dirs(root) {
        if !out.contains(&dir) {
            out.push(dir);
        }
    }
    out
}

/// Enumerate demo files under every [`demo_search_dirs`] entry's `demos`/`replays`
/// folder with fs metadata only (no decode, no demotool), deduped by path. A
/// missing folder is skipped, so a root without a demos dir simply yields nothing.
pub fn demo_file_entries(root: &Path) -> Vec<DemoFileEntry> {
    let mut out: Vec<DemoFileEntry> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for (base, dir) in demo_search_dirs(root)
        .iter()
        .flat_map(|b| DEMO_DIRS.iter().map(move |d| (b, d)))
    {
        let Ok(rd) = std::fs::read_dir(base.join(dir)) else {
            continue;
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if !DEMO_EXTS.iter().any(|ext| lower.ends_with(ext)) {
                continue;
            }
            let path = e.path();
            if !seen.insert(path.clone()) {
                continue;
            }
            let md = e.metadata().ok();
            let size_bytes = md.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_ms = md
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(DemoFileEntry {
                filename: name,
                path,
                size_bytes,
                modified_ms,
            });
        }
    }
    out
}

// ---- deleting ---------------------------------------------------------------

/// Whether `path` names a replay file. Both delete commands guard on this, so
/// neither can be pointed at anything but a `.sdfz`/`.sdf`.
pub fn is_replay_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("sdfz") || e.eq_ignore_ascii_case("sdf"))
        .unwrap_or(false)
}

/// What a bulk delete removed, or would remove.
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSummary {
    /// Whether the files were actually deleted (`false` for a dry run).
    pub applied: bool,
    pub deleted: u64,
    pub bytes: u64,
    /// One sentence per path left alone, saying why.
    pub skipped: Vec<String>,
}

/// Delete a batch of replays, returning how many went and what they freed.
///
/// A path that is not a replay, is already gone, or that the filesystem refuses
/// to remove is skipped with a reason rather than aborting the batch: a player
/// clearing 200 files should not lose the other 199 to one bad path.
///
/// `apply` false sizes the batch without deleting, so the caller can show what
/// would go before it goes.
pub fn delete_replays(paths: &[PathBuf], apply: bool) -> DeleteSummary {
    let mut out = DeleteSummary {
        applied: apply,
        ..Default::default()
    };
    for path in paths {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        if !is_replay_path(path) {
            out.skipped.push(format!("{name}: not a replay file"));
            continue;
        }
        let Ok(md) = std::fs::metadata(path) else {
            out.skipped.push(format!("{name}: not found"));
            continue;
        };
        if apply {
            if let Err(e) = std::fs::remove_file(path) {
                out.skipped.push(format!("{name}: {e}"));
                continue;
            }
        }
        out.deleted += 1;
        out.bytes += md.len();
    }
    out
}

// ---- gathering -------------------------------------------------------------

/// Where a gather puts everything: the root's own `demos/`, which is where an
/// engine that is not in Portable Mode already writes.
const GATHER_DIR: &str = "demos";

/// How recently a replay may have been written and still be left alone.
///
/// The engine appends to a demo for the whole match and there is no portable way
/// to ask whether a file is still open, so recency stands in for it. A minute is
/// long enough that a game running right now is never touched and short enough
/// that nothing a player finished and came to tidy is held back.
const GATHER_GRACE_MS: u64 = 60_000;

/// What a gather moved, or would move.
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatherSummary {
    /// Whether these were actually moved (`false` for a dry run).
    pub applied: bool,
    /// The file names moved into the root's `demos/`, or that would be.
    pub moved: Vec<String>,
    /// Total size of everything in `moved`.
    pub bytes: u64,
    /// One sentence per replay left where it was, saying why.
    pub skipped: Vec<String>,
}

/// Move each engine directory's replays into the root's `demos/`, so deleting an
/// old engine folder does not take a player's game history with it (issue #971).
///
/// A coilbox-installed Recoil release satisfies the engine's Portable Mode test,
/// so that engine writes `demos/` inside its own version folder. Nothing in
/// coilbox deletes an engine, so the folder is cleared in Finder by someone
/// making space, which is exactly when losing replays would be a surprise.
///
/// Three things are left where they are rather than moved, because moving a
/// player's files is only defensible when it cannot lose one:
///
/// - a replay written in the last [`GATHER_GRACE_MS`], which may be a match still
///   recording,
/// - one whose name is already taken in the destination, since two files of one
///   name are one game recorded once and renaming either is worse than leaving
///   both,
/// - one the filesystem refuses to move, reported with the error.
///
/// `apply` false counts without moving, so the caller can show what would go
/// before it goes. Mirrors `scenario_media_sweep`. `now_ms` is the wall clock the
/// grace window is measured against, passed in so a test can set it.
pub fn gather_replays(root: &Path, apply: bool, now_ms: u64) -> GatherSummary {
    let mut out = GatherSummary {
        applied: apply,
        ..Default::default()
    };
    let dest = root.join(GATHER_DIR);
    let mut taken: std::collections::HashSet<String> = std::fs::read_dir(&dest)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_lowercase())
        .collect();

    for (engine, _) in crate::scan::engine_dirs(root) {
        if engine == root {
            continue;
        }
        for entry in demo_files_in(&engine) {
            let name = entry.filename;
            if now_ms.saturating_sub(entry.modified_ms) < GATHER_GRACE_MS {
                out.skipped.push(format!(
                    "{name}: written just now, so it may still be recording"
                ));
                continue;
            }
            if !taken.insert(name.to_lowercase()) {
                out.skipped
                    .push(format!("{name}: a replay of that name is already in demos"));
                continue;
            }
            if !apply {
                out.moved.push(name);
                out.bytes += entry.size_bytes;
                continue;
            }
            if let Err(e) = std::fs::create_dir_all(&dest) {
                out.skipped.push(format!("{name}: {e}"));
                continue;
            }
            match std::fs::rename(&entry.path, dest.join(&name)) {
                Ok(()) => {
                    out.moved.push(name);
                    out.bytes += entry.size_bytes;
                }
                Err(e) => out.skipped.push(format!("{name}: {e}")),
            }
        }
    }
    out.moved.sort();
    out.skipped.sort();
    out
}

/// The demo files directly under one write dir's `demos`/`replays` folders.
fn demo_files_in(base: &Path) -> Vec<DemoFileEntry> {
    let mut out = Vec::new();
    for dir in DEMO_DIRS {
        let Ok(rd) = std::fs::read_dir(base.join(dir)) else {
            continue;
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !DEMO_EXTS
                .iter()
                .any(|ext| name.to_lowercase().ends_with(ext))
            {
                continue;
            }
            let md = e.metadata().ok();
            out.push(DemoFileEntry {
                filename: name,
                path: e.path(),
                size_bytes: md.as_ref().map(|m| m.len()).unwrap_or(0),
                modified_ms: md
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            });
        }
    }
    out
}

// ---- decoding --------------------------------------------------------------

/// Decode one replay: native header + start-script, plus demotool's winners.
pub fn demo_info(engine_dir: &Path, demo: &Path) -> Result<DemoInfo, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    // A replay of a game nobody ended has no winners to read, and demotool says
    // the same thing for that as it does for a game over with nobody winning. So
    // the header decides whether there is an answer, and demotool only says what
    // it is.
    let winners = raw
        .game_over
        .then(|| demotool_winners(engine_dir, demo))
        .flatten();
    Ok(build_demo_info(raw, &game, winners))
}

/// Native-only decode (header + start-script, no demotool/winner) used for the
/// cheap list summary.
fn decode_native(demo: &Path) -> Result<DemoInfo, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    Ok(build_demo_info(raw, &game, None))
}

struct RawDemo {
    engine_version: String,
    game_id: String,
    unix_time: u64,
    game_time: u32,
    wallclock: u32,
    /// Whether the recorded game reached a game over.
    ///
    /// The engine writes the player and team statistics chunks, and the header
    /// counts that describe them, from `CGame::GameEnd` and nowhere else, so a
    /// non-zero `numTeams` means a game over was recorded. A game the player
    /// quit part way through leaves every one of those fields at zero.
    ///
    /// This matters because `demotool` prints an empty `Winning Allyteams:` line
    /// both for a game that never ended and for one that ended with
    /// `Spring.GameOver({})`, which the mission runtime's `defeat` action
    /// produces in a mission with one non-Gaia ally team. Without this flag the
    /// first case reads as a loss for everyone.
    game_over: bool,
    script: String,
}

/// Read the fixed header + the plaintext start-script that immediately follows
/// it, decompressing `.sdfz` (gzip) transparently. Only the file's prefix is
/// read; the demo stream is never touched.
fn read_header_and_script(demo: &Path) -> Result<RawDemo, String> {
    let mut rdr = open_maybe_gzip(demo)?;
    let mut buf: Vec<u8> = Vec::new();
    read_at_least(&mut rdr, &mut buf, MIN_HEADER)?;
    if buf.len() < MAGIC.len() || &buf[..MAGIC.len()] != MAGIC {
        return Err("not a Spring demo file (bad magic)".into());
    }
    let header_size = i32_at(&buf, OFF_HEADER_SIZE)?.max(0) as usize;
    let script_size = i32_at(&buf, OFF_SCRIPT_SIZE)?.max(0) as usize;
    let need = header_size
        .checked_add(script_size)
        .ok_or("demo header reports an invalid script size")?;
    read_at_least(&mut rdr, &mut buf, need)?;
    Ok(RawDemo {
        engine_version: cstr_at(&buf, OFF_VERSION_STRING, 256),
        game_id: hex_at(&buf, OFF_GAME_ID, 16),
        unix_time: u64_at(&buf, OFF_UNIX_TIME)?,
        game_time: i32_at(&buf, OFF_GAME_TIME)?.max(0) as u32,
        wallclock: i32_at(&buf, OFF_WALLCLOCK)?.max(0) as u32,
        game_over: i32_at(&buf, OFF_NUM_TEAMS)? > 0,
        script: String::from_utf8_lossy(&buf[header_size..need]).into_owned(),
    })
}

/// Open `demo`, wrapping it in a gzip decoder when the file starts with the gzip
/// magic (`1f 8b`) — `.sdfz` is gzip, `.sdf` is raw, but we sniff rather than
/// trust the extension.
fn open_maybe_gzip(demo: &Path) -> Result<Box<dyn Read>, String> {
    let mut probe = std::fs::File::open(demo).map_err(|e| format!("open demo: {e}"))?;
    let mut magic = [0u8; 2];
    let n = probe
        .read(&mut magic)
        .map_err(|e| format!("read demo: {e}"))?;
    let gzip = n == 2 && magic == [0x1f, 0x8b];
    let file = std::fs::File::open(demo).map_err(|e| format!("open demo: {e}"))?;
    Ok(if gzip {
        Box::new(GzDecoder::new(file))
    } else {
        Box::new(file)
    })
}

/// Read from `rdr` until `buf` holds at least `n` bytes (or the stream ends,
/// which for a valid demo means truncation).
fn read_at_least(rdr: &mut dyn Read, buf: &mut Vec<u8>, n: usize) -> Result<(), String> {
    let mut chunk = [0u8; 8192];
    while buf.len() < n {
        let got = rdr
            .read(&mut chunk)
            .map_err(|e| format!("read demo: {e}"))?;
        if got == 0 {
            return Err(format!(
                "demo file is truncated (have {} bytes, need {n})",
                buf.len()
            ));
        }
        buf.extend_from_slice(&chunk[..got]);
    }
    Ok(())
}

fn i32_at(buf: &[u8], off: usize) -> Result<i32, String> {
    buf.get(off..off + 4)
        .map(|b| i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| "demo header truncated".into())
}

fn u64_at(buf: &[u8], off: usize) -> Result<u64, String> {
    buf.get(off..off + 8)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
        .ok_or_else(|| "demo header truncated".into())
}

/// A fixed-width, NUL-terminated C string field.
fn cstr_at(buf: &[u8], off: usize, len: usize) -> String {
    let end = (off + len).min(buf.len());
    let slice = &buf[off.min(buf.len())..end];
    let trimmed = slice.split(|&b| b == 0).next().unwrap_or(&[]);
    String::from_utf8_lossy(trimmed).into_owned()
}

/// A fixed-width byte field rendered as lowercase hex (the gameID).
fn hex_at(buf: &[u8], off: usize, len: usize) -> String {
    let end = (off + len).min(buf.len());
    buf[off.min(buf.len())..end]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ---- trailer (winners + per-team statistics) -------------------------------

/// The `DemoFileHeader`'s size and count fields, which is everything needed to
/// seek to the records the engine wrote after the demo stream.
struct DemoHeader {
    version: i32,
    header_size: usize,
    script_size: usize,
    demo_stream_size: usize,
    num_players: usize,
    player_stat_size: usize,
    player_stat_elem_size: usize,
    num_teams: usize,
    team_stat_size: usize,
    team_stat_elem_size: usize,
    team_stat_period: i32,
    winning_ally_teams_size: usize,
}

impl DemoHeader {
    fn parse(buf: &[u8]) -> Result<Self, String> {
        Ok(DemoHeader {
            version: i32_at(buf, OFF_VERSION)?,
            header_size: size_at(buf, OFF_HEADER_SIZE, "header size")?,
            script_size: size_at(buf, OFF_SCRIPT_SIZE, "start-script size")?,
            demo_stream_size: size_at(buf, OFF_DEMO_STREAM_SIZE, "demo stream size")?,
            num_players: size_at(buf, OFF_NUM_PLAYERS, "player count")?,
            player_stat_size: size_at(buf, OFF_PLAYER_STAT_SIZE, "player statistics size")?,
            player_stat_elem_size: size_at(
                buf,
                OFF_PLAYER_STAT_ELEM_SIZE,
                "player statistics element size",
            )?,
            num_teams: size_at(buf, OFF_NUM_TEAMS, "team count")?,
            team_stat_size: size_at(buf, OFF_TEAM_STAT_SIZE, "team statistics size")?,
            team_stat_elem_size: size_at(
                buf,
                OFF_TEAM_STAT_ELEM_SIZE,
                "team statistics element size",
            )?,
            team_stat_period: i32_at(buf, OFF_TEAM_STAT_PERIOD)?,
            winning_ally_teams_size: size_at(
                buf,
                OFF_WINNING_ALLY_TEAMS_SIZE,
                "winning ally-teams size",
            )?,
        })
    }

    /// Refuse a trailer whose shape this decoder does not know, naming the field
    /// that disagreed.
    ///
    /// A packed-struct file read at the wrong offset does not fail. It returns
    /// numbers, they look exactly like the right ones, and a chart of them is the
    /// worst outcome available here. So the header is made to state its own shape
    /// before any offset behind it is trusted.
    ///
    /// `version` and `headerSize` are the format's identity and have to match
    /// exactly, because a different one moves the offsets themselves. The two
    /// element sizes are minimums: a struct that grew at the end still decodes
    /// for the fields we understand, as long as the read strides by the declared
    /// size (see [`decode_team_stats`]). One that shrank does not, because our
    /// read would run into whatever follows it.
    ///
    /// This is the trailer's problem alone. The header and the start script keep
    /// decoding either way, so a future engine's replay still lists its players.
    fn require_known_layout(&self) -> Result<(), String> {
        if self.version != DEMO_VERSION {
            return Err(unknown_layout("version", self.version, DEMO_VERSION));
        }
        if self.header_size != HEADER_V5_SIZE {
            return Err(unknown_layout(
                "headerSize",
                self.header_size,
                HEADER_V5_SIZE,
            ));
        }
        if self.team_stat_elem_size < TEAM_STAT_ELEM_SIZE {
            return Err(unknown_layout(
                "teamStatElemSize",
                self.team_stat_elem_size,
                TEAM_STAT_ELEM_SIZE,
            ));
        }
        if self.player_stat_elem_size < PLAYER_STAT_ELEM_SIZE {
            return Err(unknown_layout(
                "playerStatElemSize",
                self.player_stat_elem_size,
                PLAYER_STAT_ELEM_SIZE,
            ));
        }
        Ok(())
    }

    /// The offset the trailer starts at: past the header, the start script and
    /// the demo stream.
    fn trailer_start(&self) -> Result<usize, String> {
        self.header_size
            .checked_add(self.script_size)
            .and_then(|n| n.checked_add(self.demo_stream_size))
            .ok_or_else(|| "demo header reports an impossible file layout".into())
    }
}

/// The one sentence every layout refusal says, so the reader learns which field
/// disagreed and that the rest of the replay is unaffected.
fn unknown_layout(
    field: &str,
    got: impl std::fmt::Display,
    want: impl std::fmt::Display,
) -> String {
    format!(
        "this replay's statistics are in a format coilbox does not read: the header's {field} is {got}, not {want}. The map and the players still decode."
    )
}

/// A header count/size field. It is an `i32` on disk and can never sensibly be
/// negative, so a negative one is a refusal rather than a cast.
fn size_at(buf: &[u8], off: usize, what: &str) -> Result<usize, String> {
    let v = i32_at(buf, off)?;
    usize::try_from(v).map_err(|_| format!("demo header reports a negative {what} ({v})"))
}

/// Read a replay's trailer: the winning ally-teams and every team's statistics
/// samples, with no engine folder and no subprocess.
///
/// The whole file is read because the trailer is at the end of it. That is the
/// cost of the data, and it is paid on demand for one replay rather than during
/// listing.
pub fn read_trailer(demo: &Path) -> Result<DemoTrailer, String> {
    let (bytes, _) = read_all_maybe_gzip(demo)?;
    decode_trailer(&bytes)
}

/// The trailer's layout, verified by hand-decoding the replays in `~/.spring/demos`
/// rather than read off a header file:
///
/// ```text
/// [winningAllyTeamsSize bytes]      one byte per winning ally-team
/// [playerStatSize bytes]            numPlayers * playerStatElemSize
/// [numTeams * i32]                  every team's sample count, all of them first
/// [the samples]                     team by team, teamStatElemSize each
/// ```
///
/// The sample counts come as one run *before* any samples, not interleaved with
/// them. Read interleaved, they either overrun the file or stop short of it on
/// every real replay measured, and put the next team's count where the first
/// sample's frame belongs.
///
/// `teamStatSize` covers the counts and the samples together, so on a 3 team 490
/// second game it is `12 + 3*34*80 = 8172`, which matched to the byte.
fn decode_trailer(bytes: &[u8]) -> Result<DemoTrailer, String> {
    if bytes.len() < MIN_HEADER || &bytes[..MAGIC.len()] != MAGIC {
        return Err("not a Spring demo file (bad magic)".into());
    }
    let h = DemoHeader::parse(bytes)?;
    h.require_known_layout()?;
    let mut at = h.trailer_start()?;

    let winning_ally_teams = take(
        bytes,
        &mut at,
        h.winning_ally_teams_size,
        "winning ally-teams",
    )?
    .iter()
    .map(|&b| b as u32)
    .collect();

    // Player statistics are stepped over rather than decoded (issue #1130), but
    // the block's declared size has to agree with its own element size or the
    // team statistics behind it are not where we think they are.
    let players_expect = h
        .num_players
        .checked_mul(h.player_stat_elem_size)
        .ok_or("demo header reports an impossible player statistics size")?;
    if h.player_stat_size != players_expect {
        return Err(format!(
            "demo header disagrees with itself: playerStatSize is {} but {} players of {} bytes is {players_expect}",
            h.player_stat_size, h.num_players, h.player_stat_elem_size
        ));
    }
    take(bytes, &mut at, h.player_stat_size, "player statistics")?;

    let block = take(bytes, &mut at, h.team_stat_size, "team statistics")?;
    let teams = decode_team_stats(block, h.num_teams, h.team_stat_elem_size)?;

    Ok(DemoTrailer {
        winning_ally_teams,
        team_stat_period_sec: h.team_stat_period.max(0) as u32,
        teams,
    })
}

/// Advance `at` past `n` bytes and hand them back, or refuse naming what ran out.
/// A trailer shorter than the header says is the one thing a packed-struct read
/// cannot recover from, because every later field would then be read from
/// whatever happens to be there.
fn take<'a>(bytes: &'a [u8], at: &mut usize, n: usize, what: &str) -> Result<&'a [u8], String> {
    let end = at
        .checked_add(n)
        .ok_or_else(|| format!("demo header reports an impossible {what} size"))?;
    let slice = bytes.get(*at..end).ok_or_else(|| {
        format!(
            "demo file is truncated: {what} needs {n} bytes at offset {at}, the file ends at {}",
            bytes.len()
        )
    })?;
    *at = end;
    Ok(slice)
}

/// Split the team statistics block into one series per team.
///
/// `elem` is the header's declared element size and is what the read strides by,
/// which is not necessarily the 80 bytes we know how to read: a struct that grew
/// at the end still decodes correctly for the fields we understand. It may not be
/// *smaller* than that, because then our own read would run into the next sample.
fn decode_team_stats(
    block: &[u8],
    num_teams: usize,
    elem: usize,
) -> Result<Vec<TeamStatSeries>, String> {
    if elem < TEAM_STAT_ELEM_SIZE {
        return Err(unknown_layout(
            "teamStatElemSize",
            elem,
            TEAM_STAT_ELEM_SIZE,
        ));
    }
    let counts_len = num_teams
        .checked_mul(4)
        .ok_or("demo header reports an impossible team count")?;
    let counts = block
        .get(..counts_len)
        .ok_or("demo file is truncated: the team statistics block has no room for its counts")?;

    let mut at = counts_len;
    let mut teams = Vec::with_capacity(num_teams);
    for team in 0..num_teams {
        let n = size_at(counts, team * 4, "team sample count")?;
        // Sized before it is allocated, so a count the file does not back cannot
        // ask for the memory first and fail afterwards.
        let need = n
            .checked_mul(elem)
            .ok_or("demo header reports an impossible sample count")?;
        let raw = block.get(at..at + need).ok_or_else(|| {
            format!(
                "demo file is truncated: team {team} claims {n} statistics samples, the file holds {}",
                (block.len() - at) / elem
            )
        })?;
        at += need;
        teams.push(TeamStatSeries {
            team: team as i32,
            samples: raw.chunks_exact(elem).map(read_team_stat_sample).collect(),
        });
    }
    if at != block.len() {
        return Err(format!(
            "demo header disagrees with itself: teamStatSize is {} but its counts add up to {at}",
            block.len()
        ));
    }
    Ok(teams)
}

/// One `TeamStatistics` sample from the first 80 bytes of `raw` (which may be
/// longer, see [`decode_team_stats`]): `i32 frame`, 12 `f32`, 7 `i32`.
fn read_team_stat_sample(raw: &[u8]) -> TeamStatSample {
    let word = |n: usize| [raw[n * 4], raw[n * 4 + 1], raw[n * 4 + 2], raw[n * 4 + 3]];
    let i = |n: usize| i32::from_le_bytes(word(n));
    let f = |n: usize| f32::from_le_bytes(word(n));
    TeamStatSample {
        frame: i(0),
        metal_used: f(1),
        energy_used: f(2),
        metal_produced: f(3),
        energy_produced: f(4),
        metal_excess: f(5),
        energy_excess: f(6),
        metal_received: f(7),
        energy_received: f(8),
        metal_sent: f(9),
        energy_sent: f(10),
        damage_dealt: f(11),
        damage_received: f(12),
        units_produced: i(13),
        units_died: i(14),
        units_received: i(15),
        units_sent: i(16),
        units_captured: i(17),
        units_out_captured: i(18),
        units_killed: i(19),
    }
}

// ---- rewrite ("remix" onto a different game build) -------------------------

/// Rewrite a **copy** of `src` so its embedded start-script `gametype` becomes
/// `new_gametype` (and, when given, the header engine `versionString` becomes
/// `new_engine_version`), returning the path of the new file.
///
/// The engine binds a replay to a game purely by the `gametype` name string (no
/// archive checksum lives in the header — the game is resolved by name at
/// playback), so swapping that string redirects the replay onto whatever local
/// archive carries the new name. The demo stream is copied verbatim; only the
/// `scriptSize` header field (and optionally `versionString`) changes.
///
/// **The source is never modified or overwritten.** The destination is derived
/// here — callers cannot supply it — is guaranteed to be a different, not-yet-
/// existing path, and is written atomically (temp file + rename) so a failed
/// write cannot clobber anything.
pub fn rewrite_demo(
    src: &Path,
    new_gametype: &str,
    new_engine_version: Option<&str>,
) -> Result<PathBuf, String> {
    let (bytes, gzip) = read_all_maybe_gzip(src)?;
    if bytes.len() < MIN_HEADER || &bytes[..MAGIC.len()] != MAGIC {
        return Err("not a Spring demo file (bad magic)".into());
    }
    let header_size = i32_at(&bytes, OFF_HEADER_SIZE)?.max(0) as usize;
    let script_size = i32_at(&bytes, OFF_SCRIPT_SIZE)?.max(0) as usize;
    // Our header edits (scriptSize @304, versionString @24) must land inside the
    // copied header, not spill into the script.
    if header_size < MIN_HEADER {
        return Err("demo header is too small".into());
    }
    let script_end = header_size
        .checked_add(script_size)
        .filter(|&e| e <= bytes.len())
        .ok_or("demo header reports an invalid script size")?;

    let script = String::from_utf8_lossy(&bytes[header_size..script_end]).into_owned();
    let game_sec = find_game(&parse_tdf(&script));
    // Don't remix a remix: the marker chain (and the "back to original" link) only
    // make sense one level deep — point people at the original instead.
    if read_remix_marker(&game_sec).remixed {
        return Err("this replay is already a remix — remix the original instead".into());
    }
    // Record the gametype the replay was recorded on and the source filename, so the
    // remix can show what it came from and link back, then swap + stamp the marker.
    let source_gametype = game_sec.get("gametype").unwrap_or("").to_string();
    let origin = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let swapped = replace_gametype(&script, new_gametype)?;
    let new_script = inject_remix_marker(&swapped, &source_gametype, &origin).into_bytes();

    // Rebuild: header | new script | demo stream (unchanged tail).
    let mut out = Vec::with_capacity(header_size + new_script.len() + (bytes.len() - script_end));
    out.extend_from_slice(&bytes[..header_size]);
    out.extend_from_slice(&new_script);
    out.extend_from_slice(&bytes[script_end..]);

    // Only scriptSize changes; every other header field is a size/count that the
    // shifted tail preserves.
    let new_size =
        i32::try_from(new_script.len()).map_err(|_| "rewritten start-script too large")?;
    put_i32_at(&mut out, OFF_SCRIPT_SIZE, new_size);
    if let Some(ver) = new_engine_version {
        put_cstr_at(&mut out, OFF_VERSION_STRING, 256, ver);
    }

    let payload = if gzip {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&out).map_err(|e| format!("gzip demo: {e}"))?;
        enc.finish().map_err(|e| format!("gzip demo: {e}"))?
    } else {
        out
    };

    let dst = derive_remix_path(src, gzip)?;
    if same_path(src, &dst) {
        return Err("refusing to write over the source demo".into());
    }
    atomic_write(&dst, &payload)?;
    Ok(dst)
}

/// The marker section coilbox stamps into a remixed replay's start-script. The
/// engine ignores unknown sections at playback, so it's inert there; the Replays
/// UI reads it to flag the file as a coilbox remix (not an engine-recorded demo).
const REMIX_SECTION: &str = "coilbox";

/// Inject (replacing any prior copy) a `[coilbox]` marker as the first child of
/// `[game]`, recording that this is a remix, the gametype it came from, and the
/// original replay's filename.
fn inject_remix_marker(script: &str, source_gametype: &str, origin_filename: &str) -> String {
    let script = strip_remix_marker(script);
    let block = format!(
        "[{REMIX_SECTION}]\n{{\nremix=1;\nsource={source_gametype};\norigin={origin_filename};\n}}\n"
    );
    match script.find('{') {
        // Right after `[game]`'s opening brace, so it sits alongside [modoptions] etc.
        Some(brace) => {
            let at = brace + 1;
            let mut out = String::with_capacity(script.len() + block.len() + 1);
            out.push_str(&script[..at]);
            out.push('\n');
            out.push_str(&block);
            out.push_str(&script[at..]);
            out
        }
        None => format!("{block}{script}"),
    }
}

/// Remove an existing `[coilbox]{...}` marker block, so re-remixing doesn't stack
/// duplicates. The block has no nested braces, so the first `}` closes it.
fn strip_remix_marker(script: &str) -> String {
    let lower = script.to_ascii_lowercase();
    let needle = format!("[{REMIX_SECTION}]");
    let Some(start) = lower.find(&needle) else {
        return script.to_string();
    };
    let after = &script[start..];
    let (Some(open), Some(close)) = (after.find('{'), after.find('}')) else {
        return script.to_string();
    };
    if close < open {
        return script.to_string();
    }
    let mut end = start + close + 1;
    if script[end..].starts_with('\n') {
        end += 1;
    }
    let mut out = String::with_capacity(script.len());
    out.push_str(&script[..start]);
    out.push_str(&script[end..]);
    out
}

/// The `[coilbox]` remix marker read back from a start-script.
#[derive(Default, PartialEq, Debug)]
struct RemixMarker {
    remixed: bool,
    /// The gametype the replay was originally recorded on.
    source: Option<String>,
    /// The original replay's filename.
    origin: Option<String>,
}

/// Read the `[coilbox]` remix marker from a parsed `[game]` section.
fn read_remix_marker(game: &Section) -> RemixMarker {
    let Some(marker) = game.child(REMIX_SECTION) else {
        return RemixMarker::default();
    };
    let non_empty = |k: &str| marker.get(k).filter(|s| !s.is_empty()).map(str::to_string);
    RemixMarker {
        remixed: marker.get("remix") == Some("1"),
        source: non_empty("source"),
        origin: non_empty("origin"),
    }
}

/// Read the whole demo into memory, gunzipping when it starts with the gzip magic
/// (`1f 8b`). Returns the decompressed bytes and whether the source was gzipped
/// (so the rewrite re-emits the same container).
fn read_all_maybe_gzip(demo: &Path) -> Result<(Vec<u8>, bool), String> {
    let raw = std::fs::read(demo).map_err(|e| format!("read demo: {e}"))?;
    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut out = Vec::new();
        GzDecoder::new(&raw[..])
            .read_to_end(&mut out)
            .map_err(|e| format!("gunzip demo: {e}"))?;
        Ok((out, true))
    } else {
        Ok((raw, false))
    }
}

fn put_i32_at(buf: &mut [u8], off: usize, v: i32) {
    buf[off..off + 4].copy_from_slice(&v.to_le_bytes());
}

/// Overwrite a fixed-width, NUL-terminated C-string field in place (truncating to
/// keep a terminator; no length shift, so no header offsets move).
fn put_cstr_at(buf: &mut [u8], off: usize, len: usize, s: &str) {
    let field = &mut buf[off..off + len];
    field.fill(0);
    let src = s.as_bytes();
    let n = src.len().min(len - 1);
    field[..n].copy_from_slice(&src[..n]);
}

/// Replace the value of the (case-insensitive) `gametype` key in a start-script,
/// keeping everything else byte-for-byte. Errors if no `gametype` key is present.
fn replace_gametype(script: &str, new_value: &str) -> Result<String, String> {
    let lower = script.to_ascii_lowercase();
    let bytes = script.as_bytes();
    let mut from = 0usize;
    while let Some(rel) = lower[from..].find("gametype") {
        let k = from + rel;
        // Only a real key: the previous non-space char is a separator (or start).
        let at_key_start = script[..k]
            .rfind(|c: char| !c.is_whitespace())
            .map(|p| matches!(bytes[p], b';' | b'{' | b'}'))
            .unwrap_or(true);
        let mut j = k + "gametype".len();
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if at_key_start && j < bytes.len() && bytes[j] == b'=' {
            let val_start = j + 1;
            let val_end = script[val_start..]
                .find(';')
                .map(|p| val_start + p)
                .unwrap_or(script.len());
            let mut out = String::with_capacity(script.len() + new_value.len());
            out.push_str(&script[..val_start]);
            out.push_str(new_value);
            out.push_str(&script[val_end..]);
            return Ok(out);
        }
        from = k + "gametype".len();
    }
    Err("start-script has no gametype key to rewrite".into())
}

/// A fresh sibling path for the rewritten demo that does not yet exist, keeping
/// the source's container extension (`.sdfz` gzip / `.sdf` raw).
fn derive_remix_path(src: &Path, gzip: bool) -> Result<PathBuf, String> {
    let dir = src.parent().unwrap_or_else(|| Path::new("."));
    let stem = src
        .file_name()
        .and_then(|n| n.to_str())
        .map(strip_demo_ext)
        .ok_or("source demo has no filename")?;
    let ext = if gzip { "sdfz" } else { "sdf" };
    for n in 1..1000 {
        let name = if n == 1 {
            format!("{stem}.remix.{ext}")
        } else {
            format!("{stem}.remix-{n}.{ext}")
        };
        let cand = dir.join(name);
        if !cand.exists() {
            return Ok(cand);
        }
    }
    Err("too many existing remix copies".into())
}

/// Strip a trailing `.sdfz`/`.sdf` (case-insensitive) from a filename.
fn strip_demo_ext(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    for ext in DEMO_EXTS {
        if lower.ends_with(ext) {
            return name[..name.len() - ext.len()].to_string();
        }
    }
    name.to_string()
}

/// Whether two paths refer to the same file, preferring canonical comparison (so
/// symlinks / `..` spellings can't slip past) and falling back to raw equality
/// when a path doesn't yet exist.
fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

/// Write `bytes` to `dst` atomically: a temp file in the same directory, then a
/// rename over the (non-existent) destination.
fn atomic_write(dst: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = dst.parent().unwrap_or_else(|| Path::new("."));
    let fname = dst.file_name().and_then(|n| n.to_str()).unwrap_or("demo");
    let tmp = dir.join(format!(".{fname}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| format!("write demo: {e}"))?;
    std::fs::rename(&tmp, dst).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("finalize demo: {e}")
    })
}

// ---- TDF start-script parsing ----------------------------------------------

/// A TDF section: scalar `key=value;` pairs plus nested `[name]{...}` children.
#[derive(Default)]
struct Section {
    keys: HashMap<String, String>,
    children: Vec<(String, Section)>,
}

impl Section {
    fn get(&self, key: &str) -> Option<&str> {
        self.keys.get(key).map(String::as_str)
    }
    fn child(&self, name: &str) -> Option<&Section> {
        self.children
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, s)| s)
    }
}

/// Parse a Spring start-script (TDF). Section names are lowercased; keys are
/// lowercased, values kept verbatim.
fn parse_tdf(src: &str) -> Section {
    let bytes = src.as_bytes();
    let mut i = 0usize;
    parse_body(bytes, &mut i)
}

fn parse_body(bytes: &[u8], i: &mut usize) -> Section {
    let mut sec = Section::default();
    loop {
        skip_ws(bytes, i);
        if *i >= bytes.len() {
            break;
        }
        match bytes[*i] {
            b'}' => {
                *i += 1;
                break;
            }
            b'[' => {
                *i += 1;
                let name = read_until(bytes, i, b"]").trim().to_lowercase();
                if *i < bytes.len() && bytes[*i] == b']' {
                    *i += 1;
                }
                skip_ws(bytes, i);
                if *i < bytes.len() && bytes[*i] == b'{' {
                    *i += 1;
                    let child = parse_body(bytes, i);
                    sec.children.push((name, child));
                }
            }
            _ => {
                let key = read_until(bytes, i, b"=;\n{}").trim().to_lowercase();
                if *i < bytes.len() && bytes[*i] == b'=' {
                    *i += 1;
                    let val = read_until(bytes, i, b";\n}").trim().to_string();
                    if *i < bytes.len() && bytes[*i] == b';' {
                        *i += 1;
                    }
                    if !key.is_empty() {
                        sec.keys.insert(key, val);
                    }
                } else if *i < bytes.len() {
                    // Stray token (e.g. a `;` after a `}`); advance to avoid a stall.
                    *i += 1;
                }
            }
        }
    }
    sec
}

/// Skip whitespace and `//` line comments.
fn skip_ws(bytes: &[u8], i: &mut usize) {
    loop {
        while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
            *i += 1;
        }
        if *i + 1 < bytes.len() && bytes[*i] == b'/' && bytes[*i + 1] == b'/' {
            while *i < bytes.len() && bytes[*i] != b'\n' {
                *i += 1;
            }
        } else {
            break;
        }
    }
}

fn read_until(bytes: &[u8], i: &mut usize, stops: &[u8]) -> String {
    let start = *i;
    while *i < bytes.len() && !stops.contains(&bytes[*i]) {
        *i += 1;
    }
    String::from_utf8_lossy(&bytes[start..*i]).into_owned()
}

/// The top-level start-script wraps everything in `[game]{...}`; return it (or a
/// degenerate empty section if the script is unparseable).
/// Extract `(mapName, gameType)` from a start-script's `[GAME]` block — shared by
/// the replay decode and the savegame reader (saves embed the same start-script).
/// Empty fields become `None`.
pub(crate) fn script_map_and_game(script: &str) -> (Option<String>, Option<String>) {
    let game = find_game(&parse_tdf(script));
    let non_empty = |s: &str| (!s.is_empty()).then(|| s.to_string());
    (
        game.get("mapname").and_then(non_empty),
        game.get("gametype").and_then(non_empty),
    )
}

fn find_game(root: &Section) -> Section {
    // Reparse path is awkward with borrows; just clone the child's contents we
    // need by returning the root when no [game] wrapper is present (some scripts
    // are emitted without it).
    if root.child("game").is_some() {
        // Move the matching child out.
        // (children is small; linear find is fine.)
        for (name, sec) in &root.children {
            if name == "game" {
                return clone_section(sec);
            }
        }
    }
    clone_section(root)
}

fn clone_section(s: &Section) -> Section {
    Section {
        keys: s.keys.clone(),
        children: s
            .children
            .iter()
            .map(|(n, c)| (n.clone(), clone_section(c)))
            .collect(),
    }
}

/// Index suffix of a section name like `player10` / `team6` / `allyteam1`.
fn index_suffix(name: &str, prefix: &str) -> Option<i32> {
    name.strip_prefix(prefix)?.parse::<i32>().ok()
}

fn build_demo_info(raw: RawDemo, game: &Section, winners: Option<Vec<u32>>) -> DemoInfo {
    // teamN -> its [team] section, by index, so a player can resolve its side /
    // ally-team / colour.
    let mut teams: HashMap<i32, &Section> = HashMap::new();
    let mut num_ally_teams = 0u32;
    for (name, sec) in &game.children {
        if let Some(idx) = index_suffix(name, "team") {
            teams.insert(idx, sec);
        } else if index_suffix(name, "allyteam").is_some() {
            num_ally_teams += 1;
        }
    }

    // Ally teams: start boxes (normalized 0..1) + a representative team colour.
    let mut ally_teams: Vec<AllyTeamInfo> = Vec::new();
    for (name, sec) in &game.children {
        let Some(id) = index_suffix(name, "allyteam") else {
            continue;
        };
        let color = game.children.iter().find_map(|(tn, ts)| {
            index_suffix(tn, "team")?;
            let a: i32 = ts.get("allyteam")?.parse().ok()?;
            (a == id)
                .then(|| ts.get("rgbcolor").and_then(parse_rgb))
                .flatten()
        });
        ally_teams.push(AllyTeamInfo {
            id,
            start_box: parse_start_box(sec),
            color,
        });
    }
    ally_teams.sort_by_key(|a| a.id);

    let winners_known = winners.is_some();
    let winning = winners.unwrap_or_default();

    let mut players: Vec<PlayerInfo> = Vec::new();
    for (name, p) in &game.children {
        if index_suffix(name, "player").is_none() {
            continue;
        }
        let spectator = p.get("spectator") == Some("1");
        let team = p.get("team").and_then(|v| v.parse::<i32>().ok());
        let team_sec = team.and_then(|t| teams.get(&t).copied());
        let ally_team = team_sec.and_then(|t| t.get("allyteam").and_then(|v| v.parse().ok()));
        let side = team_sec
            .and_then(|t| t.get("side"))
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let rgb_color = team_sec.and_then(|t| t.get("rgbcolor")).and_then(parse_rgb);
        let won = if spectator {
            None
        } else if winners_known {
            ally_team.map(|a| winning.contains(&(a as u32)))
        } else {
            None
        };
        players.push(PlayerInfo {
            name: p.get("name").unwrap_or("").to_string(),
            team,
            ally_team,
            side,
            rgb_color,
            spectator,
            won,
            skill: p.get("skill").map(str::to_string),
            country_code: p.get("countrycode").map(str::to_string),
        });
    }

    let marker = read_remix_marker(game);

    let mod_options = game
        .child("modoptions")
        .map(|s| s.keys.clone())
        .unwrap_or_default();

    DemoInfo {
        engine_version: raw.engine_version,
        game_id: (!raw.game_id.is_empty()).then_some(raw.game_id),
        start_time_ms: raw.unix_time.saturating_mul(1000),
        duration_sec: raw.game_time,
        wallclock_sec: raw.wallclock,
        map_name: game.get("mapname").unwrap_or("").to_string(),
        game_type: game.get("gametype").unwrap_or("").to_string(),
        start_pos_type: game.get("startpostype").and_then(|v| v.parse().ok()),
        winning_ally_teams: winning,
        winners_known,
        num_ally_teams,
        ally_teams,
        players,
        remixed: marker.remixed,
        source_gametype: marker.source,
        origin_filename: marker.origin,
        mod_options,
    }
}

/// Parse an ally team's `startrect*` keys into a normalized box, or `None` when
/// absent or degenerate (zero-area, e.g. fixed-position games).
fn parse_start_box(sec: &Section) -> Option<StartBox> {
    let g = |k: &str| sec.get(k).and_then(|v| v.parse::<f32>().ok());
    let (left, top, right, bottom) = (
        g("startrectleft")?,
        g("startrecttop")?,
        g("startrectright")?,
        g("startrectbottom")?,
    );
    (right > left && bottom > top).then_some(StartBox {
        left,
        top,
        right,
        bottom,
    })
}

/// Parse an `rgbcolor` value (`"0.56 0.54 0.91"`) into normalized RGB.
fn parse_rgb(s: &str) -> Option<[f32; 3]> {
    let mut it = s.split_whitespace().filter_map(|t| t.parse::<f32>().ok());
    Some([it.next()?, it.next()?, it.next()?])
}

// ---- demotool (winners only) -----------------------------------------------

/// Resolve the `demotool` binary that ships in the engine folder (sibling of the
/// `spring`/`libunitsync` files). `DEMOTOOL_BIN` overrides for dev.
fn resolve_demotool(engine_dir: &Path) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("DEMOTOOL_BIN") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    let candidate = engine_dir.join(format!("demotool{}", std::env::consts::EXE_SUFFIX));
    candidate.exists().then_some(candidate)
}

/// Parse a start-script `skill` value (e.g. `[25.0]`, `(30.5)`, `[µ=25.0, σ=8.3]`)
/// to its leading number. The various lobby encodings all lead with the rating, so
/// the first numeric run is taken.
fn parse_skill(s: &str) -> Option<f32> {
    let mut num = String::new();
    let mut started = false;
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' || (c == '-' && num.is_empty()) {
            num.push(c);
            started = true;
        } else if started {
            break;
        }
    }
    num.parse().ok()
}

/// Min/avg/max of the non-spectator players' parsed skill, or all-`None` when none
/// has a parseable skill.
fn skill_stats(players: &[PlayerInfo]) -> (Option<f32>, Option<f32>, Option<f32>) {
    let skills: Vec<f32> = players
        .iter()
        .filter(|p| !p.spectator)
        .filter_map(|p| p.skill.as_deref().and_then(parse_skill))
        .collect();
    if skills.is_empty() {
        return (None, None, None);
    }
    let min = skills.iter().copied().fold(f32::INFINITY, f32::min);
    let max = skills.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let avg = skills.iter().sum::<f32>() / skills.len() as f32;
    (Some(min), Some(avg), Some(max))
}

/// Extract a demo's chat log: run `demotool --dump` and parse its `CHAT`/`SYSTEMMSG`
/// lines, resolving player numbers to names via the start-script.
pub fn demo_chat(engine_dir: &Path, demo: &Path) -> Result<DemoChat, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let names = player_names(&game);
    let bin = resolve_demotool(engine_dir).ok_or("demotool not found in engine folder")?;
    let out = run_demotool(&bin, demo, "--dump", DEMOTOOL_TIMEOUT)?;
    Ok(DemoChat {
        messages: parse_chat(&out, &names),
    })
}

/// Map player number -> name from the start-script's `[playerN]` sections.
fn player_names(game: &Section) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    for (name, sec) in &game.children {
        if let Some(num) = name
            .strip_prefix("player")
            .and_then(|n| n.parse::<u32>().ok())
        {
            if let Some(pname) = sec.get("name") {
                out.insert(num, pname.to_string());
            }
        }
    }
    out
}

/// Parse demotool `--dump` output for chat + system lines. Each is one line:
/// `CHAT: Player: N Msg: <text>` / `SYSTEMMSG: Player: N Msg: <text>`.
fn parse_chat(out: &str, names: &HashMap<u32, String>) -> Vec<ChatLine> {
    let mut msgs = Vec::new();
    for line in out.lines() {
        let (system, rest) = if let Some(r) = line.strip_prefix("CHAT: Player: ") {
            (false, r)
        } else if let Some(r) = line.strip_prefix("SYSTEMMSG: Player: ") {
            (true, r)
        } else {
            continue;
        };
        let Some((num_str, text)) = rest.split_once(" Msg: ") else {
            continue;
        };
        let player = num_str.trim().parse::<u32>().ok();
        let player_name = player.and_then(|n| names.get(&n).cloned());
        msgs.push(ChatLine {
            player,
            player_name,
            text: text.to_string(),
            system,
        });
    }
    msgs
}

/// Run `demotool --teamstats <demo>` and parse its trailing `Winning Allyteams:`
/// line. Returns `None` when demotool is absent or fails — the caller treats
/// that as "winner unknown" rather than an error (everything else is native).
fn demotool_winners(engine_dir: &Path, demo: &Path) -> Option<Vec<u32>> {
    let bin = resolve_demotool(engine_dir)?;
    let out = run_demotool(&bin, demo, "--teamstats", DEMOTOOL_TIMEOUT).ok()?;
    parse_winners(&out)
}

/// Spawn demotool with `flag` and a bounded timeout (kills the child on overrun),
/// modeled on `engine::read_version`. Returns captured stdout.
///
/// The pipe is drained on its own thread while we wait. `--teamstats` on a long
/// game prints more than the OS pipe buffer (64 KB on macOS), and demotool blocks
/// on the write until someone reads it, so waiting for the exit first and reading
/// afterwards would never let the child finish.
fn run_demotool(bin: &Path, demo: &Path, flag: &str, timeout: Duration) -> Result<String, String> {
    let mut cmd = coilbox_proc::command(bin);
    cmd.arg(flag)
        .arg(demo)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to run demotool: {e}"))?;
    let stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        if let Some(mut s) = stdout {
            let _ = s.read_to_string(&mut out);
        }
        out
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    // Killing the child closes the pipe, so the reader thread ends
                    // by itself. Its partial output is no use here, so leave it
                    // rather than joining.
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("demotool timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for demotool: {e}")),
        }
    }
    reader
        .join()
        .map_err(|_| "demotool output could not be read".to_string())
}

/// Extract the winning ally-team numbers from demotool's `Winning Allyteams: N N`
/// line. An empty list still returns `Some(vec![])`, because a game over with
/// nobody winning is a real outcome. Callers must already have established that
/// the game ended, see [`RawDemo::game_over`].
fn parse_winners(out: &str) -> Option<Vec<u32>> {
    let idx = out.find("Winning Allyteams:")?;
    let rest = &out[idx + "Winning Allyteams:".len()..];
    let line = rest.lines().next().unwrap_or(rest);
    Some(
        line.split_whitespace()
            .filter_map(|t| t.parse().ok())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const SCRIPT: &str = "[game]\n{\n\
        mapname=Valles Marineris 2.6.1;\n\
        gametype=Beyond All Reason test-30018;\n\
        startpostype=2;\n\
        [player0]\n{\nname=Alice;\nteam=0;\nspectator=0;\ncountrycode=GB;\nskill=[25.0];\n}\n\
        [player1]\n{\nname=Bob;\nteam=1;\nspectator=0;\n}\n\
        [player2]\n{\nname=Specs;\nspectator=1;\n}\n\
        [team0]\n{\nallyteam=0;\nteamleader=0;\nside=Armada;\nrgbcolor=0.1 0.2 0.3;\n}\n\
        [team1]\n{\nallyteam=1;\nteamleader=1;\nside=Cortex;\nrgbcolor=0.5 0.6 0.7;\n}\n\
        [allyteam0]\n{\nstartrectleft=0;\nstartrecttop=0;\nstartrectright=0.3;\nstartrectbottom=1;\nnumallies=0;\n}\n\
        [allyteam1]\n{\nstartrectleft=0.7;\nstartrecttop=0;\nstartrectright=1;\nstartrectbottom=1;\nnumallies=0;\n}\n\
        [modoptions]\n{\nzombies=disabled;\nemptyval=;\n}\n}\n";

    fn put_i32(b: &mut [u8], off: usize, v: i32) {
        b[off..off + 4].copy_from_slice(&v.to_le_bytes());
    }
    fn put_u64(b: &mut [u8], off: usize, v: u64) {
        b[off..off + 8].copy_from_slice(&v.to_le_bytes());
    }

    /// A synthetic replay, built byte by byte.
    ///
    /// A packed-struct file read at the wrong offset does not fail. It returns
    /// numbers, and they look exactly like the right ones, so the only thing that
    /// proves an offset is a file whose every byte a test chose. A real replay
    /// proves one engine version and hides which byte mattered.
    ///
    /// The default is the smallest valid v5 file: a header, a start script, and
    /// an empty trailer, which is what the engine leaves behind when a recording
    /// is aborted. Every other case sets one field and changes nothing else.
    struct DemoFixture {
        version: i32,
        /// Also where the start script begins, so a header that grew moves every
        /// offset behind it.
        header_size: usize,
        engine_version: String,
        script: String,
        /// Stands in for the recorded packet stream, which nothing here decodes.
        stream: Vec<u8>,
        /// One ally-team id per byte.
        winning_ally_teams: Vec<u8>,
        /// Per player, the five `i32` in their true on-disk order: `numCommands`,
        /// `unitCommands`, `mousePixels`, `mouseClicks`, `keyPresses`.
        /// `PlayerStatistics` derives from `TeamControllerStatistics`, so the base
        /// members come first and this is not the order the header file declares.
        player_stats: Vec<[i32; 5]>,
        player_stat_elem_size: usize,
        /// Per team, its samples in recording order.
        team_samples: Vec<Vec<TeamStatSample>>,
        team_stat_elem_size: usize,
        team_stat_period: i32,
        game_time: i32,
        wallclock: i32,
        /// Bytes chopped off the end once everything is written, for a file that
        /// stops before the trailer the header promised.
        truncate_by: usize,
    }

    impl Default for DemoFixture {
        fn default() -> Self {
            DemoFixture {
                version: 5,
                header_size: 352,
                engine_version: "105.1.2 TEST".into(),
                script: SCRIPT.into(),
                stream: Vec::new(),
                winning_ally_teams: Vec::new(),
                player_stats: Vec::new(),
                player_stat_elem_size: 20,
                team_samples: Vec::new(),
                team_stat_elem_size: 80,
                team_stat_period: 15,
                game_time: 2356,
                wallclock: 2531,
                truncate_by: 0,
            }
        }
    }

    /// Filler written into the part of a sample past the 80 bytes we know how to
    /// read, so a decoder that strides by its own idea of the size reads this
    /// rather than the next sample and is caught rather than plausible.
    const SAMPLE_PADDING: u8 = 0xEE;

    impl DemoFixture {
        fn bytes(&self) -> Vec<u8> {
            let mut h = vec![0u8; self.header_size];
            h[..MAGIC.len()].copy_from_slice(MAGIC);
            put_i32(&mut h, 16, self.version);
            put_i32(&mut h, OFF_HEADER_SIZE, self.header_size as i32);
            let ver = self.engine_version.as_bytes();
            h[OFF_VERSION_STRING..OFF_VERSION_STRING + ver.len()].copy_from_slice(ver);
            for (k, b) in (0..16).zip(0xA0u8..) {
                h[OFF_GAME_ID + k] = b;
            }
            put_u64(&mut h, OFF_UNIX_TIME, 1_777_320_845);
            put_i32(&mut h, OFF_SCRIPT_SIZE, self.script.len() as i32);
            put_i32(&mut h, OFF_DEMO_STREAM_SIZE, self.stream.len() as i32);
            put_i32(&mut h, OFF_GAME_TIME, self.game_time);
            put_i32(&mut h, OFF_WALLCLOCK, self.wallclock);
            put_i32(&mut h, OFF_NUM_PLAYERS, self.player_stats.len() as i32);
            put_i32(
                &mut h,
                OFF_PLAYER_STAT_SIZE,
                (self.player_stats.len() * self.player_stat_elem_size) as i32,
            );
            put_i32(
                &mut h,
                OFF_PLAYER_STAT_ELEM_SIZE,
                self.player_stat_elem_size as i32,
            );
            put_i32(&mut h, OFF_NUM_TEAMS, self.team_samples.len() as i32);
            let total: usize = self.team_samples.iter().map(Vec::len).sum();
            put_i32(
                &mut h,
                OFF_TEAM_STAT_SIZE,
                (self.team_samples.len() * 4 + total * self.team_stat_elem_size) as i32,
            );
            put_i32(
                &mut h,
                OFF_TEAM_STAT_ELEM_SIZE,
                self.team_stat_elem_size as i32,
            );
            put_i32(&mut h, OFF_TEAM_STAT_PERIOD, self.team_stat_period);
            put_i32(
                &mut h,
                OFF_WINNING_ALLY_TEAMS_SIZE,
                self.winning_ally_teams.len() as i32,
            );

            h.extend_from_slice(self.script.as_bytes());
            h.extend_from_slice(&self.stream);
            h.extend_from_slice(&self.winning_ally_teams);
            for p in &self.player_stats {
                // As with a sample, a field past the declared size is dropped
                // rather than written, so a shrunk element is a struct with its
                // tail missing.
                let mut elem = vec![0u8; self.player_stat_elem_size];
                for (k, v) in p.iter().enumerate() {
                    if k * 4 + 4 <= self.player_stat_elem_size {
                        put_i32(&mut elem, k * 4, *v);
                    }
                }
                h.extend_from_slice(&elem);
            }
            // Every team's sample count first, as one run, then every team's
            // samples behind them. Measured on real replays, not inferred.
            for team in &self.team_samples {
                let mut n = [0u8; 4];
                put_i32(&mut n, 0, team.len() as i32);
                h.extend_from_slice(&n);
            }
            for team in &self.team_samples {
                for s in team {
                    h.extend_from_slice(&self.sample_bytes(s));
                }
            }
            h.truncate(h.len() - self.truncate_by.min(h.len()));
            h
        }

        /// One sample: `i32 frame`, 12 `f32`, 7 `i32`, then padding out to the
        /// declared element size.
        ///
        /// A field past the declared size is dropped rather than written, so an
        /// element smaller than 80 bytes is a struct with its tail missing, which
        /// is what a shrunk `TeamStatistics` would look like.
        fn sample_bytes(&self, s: &TeamStatSample) -> Vec<u8> {
            let mut b = vec![SAMPLE_PADDING; self.team_stat_elem_size];
            let fits = |n: usize| n * 4 + 4 <= self.team_stat_elem_size;
            let ints = [
                (0, s.frame),
                (13, s.units_produced),
                (14, s.units_died),
                (15, s.units_received),
                (16, s.units_sent),
                (17, s.units_captured),
                (18, s.units_out_captured),
                (19, s.units_killed),
            ];
            for (n, v) in ints.into_iter().filter(|(n, _)| fits(*n)) {
                put_i32(&mut b, n * 4, v);
            }
            let floats = [
                (1, s.metal_used),
                (2, s.energy_used),
                (3, s.metal_produced),
                (4, s.energy_produced),
                (5, s.metal_excess),
                (6, s.energy_excess),
                (7, s.metal_received),
                (8, s.energy_received),
                (9, s.metal_sent),
                (10, s.energy_sent),
                (11, s.damage_dealt),
                (12, s.damage_received),
            ];
            for (n, v) in floats.into_iter().filter(|(n, _)| fits(*n)) {
                b[n * 4..n * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
            b
        }

        fn gzipped(&self) -> Vec<u8> {
            let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            enc.write_all(&self.bytes()).unwrap();
            enc.finish().unwrap()
        }
    }

    /// Build a minimal v5 demo (352-byte header + script), optionally gzipped.
    /// The header carries the end-of-game statistics counts, so it reads as a
    /// game that ended. `build_unfinished_demo` is the one that did not.
    fn build_demo(script: &str, gzip: bool) -> Vec<u8> {
        let f = DemoFixture {
            script: script.into(),
            team_samples: vec![Vec::new(), Vec::new()],
            ..Default::default()
        };
        if gzip {
            f.gzipped()
        } else {
            f.bytes()
        }
    }

    /// A demo of a game that never reached a game over: the engine leaves every
    /// end-of-game statistics count at zero, `numTeams` among them.
    fn build_unfinished_demo(script: &str) -> Vec<u8> {
        DemoFixture {
            script: script.into(),
            ..Default::default()
        }
        .bytes()
    }

    fn write_tmp(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join("coilbox_demo_test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn reads_header_and_script_from_gzip() {
        let p = write_tmp("g.sdfz", &build_demo(SCRIPT, true));
        let raw = read_header_and_script(&p).unwrap();
        assert_eq!(raw.engine_version, "105.1.2 TEST");
        assert_eq!(raw.unix_time, 1_777_320_845);
        assert_eq!(raw.game_time, 2356);
        assert_eq!(raw.wallclock, 2531);
        assert!(raw.script.contains("mapname=Valles Marineris 2.6.1"));
        assert_eq!(raw.game_id.len(), 32); // 16 bytes hex
    }

    #[test]
    fn reads_uncompressed_demo_too() {
        let p = write_tmp("r.sdf", &build_demo(SCRIPT, false));
        let raw = read_header_and_script(&p).unwrap();
        assert_eq!(raw.engine_version, "105.1.2 TEST");
    }

    #[test]
    fn rejects_non_demo() {
        let p = write_tmp(
            "bad.sdf",
            b"not a demo at all, just text padding padding padding padding",
        );
        assert!(read_header_and_script(&p).is_err());
    }

    #[test]
    fn parses_players_teams_sides_and_winner() {
        let raw = read_header_and_script(&write_tmp("w.sdfz", &build_demo(SCRIPT, true))).unwrap();
        let game = find_game(&parse_tdf(&raw.script));
        // Winner = allyteam 1 (Bob's side). Pass winners explicitly (no demotool).
        let info = build_demo_info(raw, &game, Some(vec![1]));

        assert_eq!(info.map_name, "Valles Marineris 2.6.1");
        assert_eq!(info.game_type, "Beyond All Reason test-30018");
        assert_eq!(info.start_pos_type, Some(2));
        assert_eq!(info.num_ally_teams, 2);
        assert_eq!(info.ally_teams.len(), 2);
        let at0 = info.ally_teams.iter().find(|a| a.id == 0).unwrap();
        let box0 = at0.start_box.as_ref().expect("ally 0 has a start box");
        assert_eq!((box0.left, box0.right, box0.bottom), (0.0, 0.3, 1.0));
        assert_eq!(at0.color, Some([0.1, 0.2, 0.3])); // team0's colour (Armada)
        assert_eq!(info.start_time_ms, 1_777_320_845_000);
        assert!(info.winners_known);
        assert_eq!(info.winning_ally_teams, vec![1]);
        assert_eq!(info.players.len(), 3);

        let alice = info.players.iter().find(|p| p.name == "Alice").unwrap();
        assert_eq!(alice.side.as_deref(), Some("Armada"));
        assert_eq!(alice.ally_team, Some(0));
        assert_eq!(alice.rgb_color, Some([0.1, 0.2, 0.3]));
        assert_eq!(alice.won, Some(false));
        assert!(!alice.spectator);

        let bob = info.players.iter().find(|p| p.name == "Bob").unwrap();
        assert_eq!(bob.side.as_deref(), Some("Cortex"));
        assert_eq!(bob.won, Some(true));

        let specs = info.players.iter().find(|p| p.name == "Specs").unwrap();
        assert!(specs.spectator);
        assert_eq!(specs.team, None);
        assert_eq!(specs.won, None); // spectators never "win"
    }

    #[test]
    fn winner_unknown_when_demotool_absent() {
        let raw = read_header_and_script(&write_tmp("u.sdfz", &build_demo(SCRIPT, true))).unwrap();
        let game = find_game(&parse_tdf(&raw.script));
        let info = build_demo_info(raw, &game, None);
        assert!(!info.winners_known);
        assert!(info.winning_ally_teams.is_empty());
        assert!(info.players.iter().all(|p| p.won.is_none()));
    }

    /// The header tells a game that ended with nobody winning from one that
    /// never ended, which demotool's output alone cannot: it prints an empty
    /// `Winning Allyteams:` line for both.
    ///
    /// Measured on three replays recorded by spring-headless
    /// (2026.07.01-18-g30201dc macos, map AcidicQuarry 5.17, one player on ally
    /// team 0) from a gadget that ended the game three different ways:
    ///
    /// | ending                | numTeams | GAMEOVER packet | demotool  |
    /// |-----------------------|----------|-----------------|-----------|
    /// | never ended           | 0        | absent          | empty     |
    /// | `GameOver({})`        | 2        | `1e 03 00`      | empty     |
    /// | `GameOver({0})`       | 2        | `1e 04 00 00`   | `0`       |
    #[test]
    fn a_game_that_never_ended_has_no_winners() {
        let p = write_tmp("unfinished.sdf", &build_unfinished_demo(SCRIPT));
        let raw = read_header_and_script(&p).unwrap();
        assert!(!raw.game_over);

        // A finished game reads the other way, so the flag is about the ending
        // and not about this synthetic header.
        let q = write_tmp("finished.sdf", &build_demo(SCRIPT, false));
        assert!(read_header_and_script(&q).unwrap().game_over);
    }

    #[test]
    fn a_game_over_with_nobody_winning_is_still_a_result() {
        // `Spring.GameOver({})`, which the mission runtime's `defeat` action
        // produces in a mission with one non-Gaia ally team. Everyone lost, and
        // that is an answer rather than a missing one.
        let raw = read_header_and_script(&write_tmp("n.sdf", &build_demo(SCRIPT, false))).unwrap();
        let game = find_game(&parse_tdf(&raw.script));
        let info = build_demo_info(raw, &game, Some(vec![]));
        assert!(info.winners_known);
        let alice = info.players.iter().find(|p| p.name == "Alice").unwrap();
        assert_eq!(alice.won, Some(false));
    }

    // ---- trailer -----------------------------------------------------------

    /// A sample whose every field is a different, index-derived number, so a
    /// decoder that reads the right bytes in the wrong order, or strides by the
    /// wrong amount, produces a value no assertion here accepts.
    ///
    /// Values grow with `i` because the engine's figures are running totals.
    fn sample(i: i32) -> TeamStatSample {
        let n = i as f32;
        TeamStatSample {
            frame: i * 450,
            metal_used: 100.0 * n,
            energy_used: 200.0 * n,
            metal_produced: 300.0 * n,
            energy_produced: 400.0 * n,
            metal_excess: 500.0 * n,
            energy_excess: 600.0 * n,
            metal_received: 700.0 * n,
            energy_received: 800.0 * n,
            metal_sent: 900.0 * n,
            energy_sent: 1000.0 * n,
            damage_dealt: 1100.0 * n,
            damage_received: 1200.0 * n,
            units_produced: 13 * i,
            units_died: 14 * i,
            units_received: 15 * i,
            units_sent: 16 * i,
            units_captured: 17 * i,
            units_out_captured: 18 * i,
            units_killed: 19 * i,
        }
    }

    fn series(n: i32) -> Vec<TeamStatSample> {
        (0..n).map(sample).collect()
    }

    /// A finished two-sided match, which is the case every chart in this
    /// milestone is drawn from.
    #[test]
    fn a_finished_match_decodes_its_winners_and_every_sample() {
        let f = DemoFixture {
            stream: vec![0x77; 1024],
            winning_ally_teams: vec![1],
            player_stats: vec![[163, 163, 416_476, 493, 277], [194, 230, 227_928, 364, 462]],
            team_samples: vec![series(5), series(5)],
            ..Default::default()
        };
        let t = decode_trailer(&f.bytes()).unwrap();

        assert_eq!(t.winning_ally_teams, vec![1]);
        assert_eq!(t.team_stat_period_sec, 15);
        assert_eq!(t.teams.len(), 2);
        for (i, team) in t.teams.iter().enumerate() {
            assert_eq!(team.team, i as i32);
            assert_eq!(team.samples, series(5), "team {i}");
        }
        // Spelled out for the one sample a wrong stride lands on first: sample 0
        // reads correctly under any stride, sample 1 does not.
        let s1 = &t.teams[0].samples[1];
        assert_eq!(s1.frame, 450);
        assert_eq!(s1.metal_produced, 300.0);
        assert_eq!(s1.damage_dealt, 1100.0);
        assert_eq!(s1.units_produced, 13);
        assert_eq!(s1.units_killed, 19);
    }

    /// The counts are one run in front of the samples, not one before each
    /// team's. Read interleaved, team 0's second sample would be team 1's count.
    #[test]
    fn every_teams_sample_count_comes_before_any_samples() {
        let f = DemoFixture {
            team_samples: vec![series(3), series(3), series(3)],
            ..Default::default()
        };
        let bytes = f.bytes();
        let at = 352 + SCRIPT.len();
        assert_eq!(
            &bytes[at..at + 12],
            &[3, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0],
            "three counts, back to back, then the samples"
        );
        // And the whole block is the size the header claims.
        let team_stat_size = i32::from_le_bytes(
            bytes[OFF_TEAM_STAT_SIZE..OFF_TEAM_STAT_SIZE + 4]
                .try_into()
                .unwrap(),
        );
        assert_eq!(team_stat_size, 12 + 9 * 80);
        assert_eq!(bytes.len(), at + team_stat_size as usize);
    }

    /// A team that never scored is a flat line, not missing data. Every sample is
    /// present and every figure is zero.
    #[test]
    fn an_ally_side_that_never_scored_is_zeroes_rather_than_nothing() {
        let f = DemoFixture {
            winning_ally_teams: vec![0],
            team_samples: vec![series(4), vec![TeamStatSample::default(); 4]],
            ..Default::default()
        };
        let t = decode_trailer(&f.bytes()).unwrap();
        assert_eq!(t.teams[1].samples.len(), 4);
        assert!(t.teams[1]
            .samples
            .iter()
            .all(|s| *s == TeamStatSample::default()));
        assert_eq!(t.teams[0].samples.len(), 4);
    }

    /// A recording the engine never got to finish: a valid header, zeroed counts,
    /// no samples. That is "no statistics", not an error and not a match everyone
    /// lost. Both of the small replays in `~/.spring/demos` are this file.
    #[test]
    fn an_aborted_recording_reads_as_no_statistics() {
        let t = decode_trailer(&DemoFixture::default().bytes()).unwrap();
        assert!(t.winning_ally_teams.is_empty());
        assert!(t.teams.is_empty());
    }

    /// The other zero case, which four of the nine real replays are: the trailer
    /// is fully formed, names a winner, and holds nine teams with no samples
    /// between them.
    #[test]
    fn a_finished_match_with_no_samples_is_still_a_winner() {
        let f = DemoFixture {
            winning_ally_teams: vec![1],
            player_stats: vec![[0; 5]; 14],
            team_samples: vec![Vec::new(); 9],
            ..Default::default()
        };
        let t = decode_trailer(&f.bytes()).unwrap();
        assert_eq!(t.winning_ally_teams, vec![1]);
        assert_eq!(t.teams.len(), 9);
        assert!(t.teams.iter().all(|s| s.samples.is_empty()));
    }

    /// A file that stops before the trailer the header promised is refused, and
    /// the header and roster keep decoding, so the replay still lists its players.
    #[test]
    fn a_truncated_trailer_is_refused_and_the_roster_survives() {
        let f = DemoFixture {
            winning_ally_teams: vec![0],
            team_samples: vec![series(6), series(6)],
            truncate_by: 200,
            ..Default::default()
        };
        let p = write_tmp("truncated.sdf", &f.bytes());

        let err = read_trailer(&p).unwrap_err();
        assert!(err.contains("truncated"), "got: {err}");

        let raw = read_header_and_script(&p).unwrap();
        let info = build_demo_info(raw, &find_game(&parse_tdf(SCRIPT)), None);
        assert_eq!(info.map_name, "Valles Marineris 2.6.1");
        assert_eq!(info.players.len(), 3);
    }

    /// A team statistics element that grew is strided by its declared size, so a
    /// struct with fields appended still decodes for the fields we understand.
    /// Striding by our own 80 would read the padding as the second sample.
    #[test]
    fn a_grown_sample_is_strided_by_the_size_the_header_declares() {
        let f = DemoFixture {
            team_stat_elem_size: 88,
            team_samples: vec![series(4)],
            ..Default::default()
        };
        let t = decode_trailer(&f.bytes()).unwrap();
        assert_eq!(t.teams[0].samples, series(4));
    }

    /// The reverse: an element too small to hold what we read is refused, because
    /// our own read would run into the next sample.
    #[test]
    fn a_sample_smaller_than_we_read_is_refused() {
        let f = DemoFixture {
            team_stat_elem_size: 72,
            team_samples: vec![series(2)],
            ..Default::default()
        };
        let err = decode_trailer(&f.bytes()).unwrap_err();
        assert!(err.contains("teamStatElemSize is 72"), "got: {err}");
    }

    /// Every field the header states its own shape with, and what a replay from a
    /// format we have not read looks like when it disagrees.
    ///
    /// Each case says which field disagreed, because "could not read the
    /// statistics" is not something anyone can act on.
    #[test]
    fn a_header_from_a_format_we_do_not_know_is_refused_by_name() {
        for (field, f) in [
            (
                "version",
                DemoFixture {
                    version: 6,
                    team_samples: vec![series(3), series(3)],
                    ..Default::default()
                },
            ),
            (
                "headerSize",
                DemoFixture {
                    header_size: 360,
                    team_samples: vec![series(3), series(3)],
                    ..Default::default()
                },
            ),
            (
                "teamStatElemSize",
                DemoFixture {
                    team_stat_elem_size: 64,
                    team_samples: vec![series(3), series(3)],
                    ..Default::default()
                },
            ),
            (
                "playerStatElemSize",
                DemoFixture {
                    player_stat_elem_size: 16,
                    player_stats: vec![[1, 2, 3, 4, 0]; 2],
                    team_samples: vec![series(3), series(3)],
                    ..Default::default()
                },
            ),
        ] {
            let err = decode_trailer(&f.bytes())
                .expect_err("{field} should refuse")
                .to_string();
            assert!(err.contains(field), "expected {field} named, got: {err}");
        }
    }

    /// Refusing the statistics leaves the rest of the replay alone, so a future
    /// engine's replay still lists its map, its players and their factions.
    #[test]
    fn a_refused_trailer_still_lists_the_map_and_the_roster() {
        let f = DemoFixture {
            version: 6,
            winning_ally_teams: vec![1],
            team_samples: vec![series(4), series(4)],
            ..Default::default()
        };
        let p = write_tmp("v6.sdfz", &f.gzipped());
        assert!(read_trailer(&p).is_err());

        let raw = read_header_and_script(&p).unwrap();
        assert_eq!(raw.engine_version, "105.1.2 TEST");
        let info = build_demo_info(raw, &find_game(&parse_tdf(SCRIPT)), None);
        assert_eq!(info.map_name, "Valles Marineris 2.6.1");
        assert_eq!(info.players.len(), 3);
        assert_eq!(
            info.players
                .iter()
                .find(|p| p.name == "Alice")
                .unwrap()
                .side
                .as_deref(),
            Some("Armada")
        );
    }

    /// A header that grew both element sizes, but is still version 5 at 352
    /// bytes, is a struct with fields appended. Striding by the declared sizes
    /// decodes every sample we understand rather than throwing the match away.
    #[test]
    fn elements_that_grew_are_read_rather_than_refused() {
        let f = DemoFixture {
            player_stat_elem_size: 24,
            player_stats: vec![[7, 8, 9, 10, 11]; 3],
            team_stat_elem_size: 96,
            winning_ally_teams: vec![0],
            team_samples: vec![series(6), series(6)],
            ..Default::default()
        };
        let t = decode_trailer(&f.bytes()).unwrap();
        assert_eq!(t.winning_ally_teams, vec![0]);
        assert_eq!(t.teams[0].samples, series(6));
        assert_eq!(t.teams[1].samples, series(6));
    }

    /// The whole trailer round-trips through gzip, which is what a `.sdfz` is,
    /// and through the command's own entry point.
    #[test]
    fn a_gzipped_replay_decodes_its_trailer() {
        let f = DemoFixture {
            stream: vec![0x11; 4096],
            winning_ally_teams: vec![0, 2],
            player_stats: vec![[1, 2, 3, 4, 5]],
            team_samples: vec![series(3), series(3)],
            ..Default::default()
        };
        let p = write_tmp("trailer.sdfz", &f.gzipped());
        let t = read_trailer(&p).unwrap();
        assert_eq!(t.winning_ally_teams, vec![0, 2]);
        assert_eq!(t.teams.len(), 2);
        assert_eq!(t.teams[1].samples, series(3));

        // The frontend reads camelCase keys off this.
        let js = serde_json::to_string(&t).unwrap();
        assert!(js.contains("\"winningAllyTeams\":[0,2]"), "{js}");
        assert!(js.contains("\"teamStatPeriodSec\":15"), "{js}");
        assert!(js.contains("\"metalProduced\""), "{js}");
    }

    /// A header whose own numbers contradict each other is refused rather than
    /// read from wherever the arithmetic lands.
    #[test]
    fn a_header_that_disagrees_with_itself_is_refused() {
        let mut bytes = DemoFixture {
            player_stats: vec![[1, 2, 3, 4, 5]; 2],
            team_samples: vec![series(2)],
            ..Default::default()
        }
        .bytes();
        // Claim three players' worth of statistics in a block sized for two.
        put_i32(&mut bytes, OFF_NUM_PLAYERS, 3);
        let err = decode_trailer(&bytes).unwrap_err();
        assert!(err.contains("playerStatSize"), "got: {err}");
    }

    /// A negative count is a corrupt file, not a huge unsigned one.
    #[test]
    fn a_negative_count_is_refused_rather_than_cast() {
        let mut bytes = DemoFixture {
            team_samples: vec![series(2)],
            ..Default::default()
        }
        .bytes();
        put_i32(&mut bytes, OFF_NUM_TEAMS, -1);
        let err = decode_trailer(&bytes).unwrap_err();
        assert!(err.contains("negative team count"), "got: {err}");
    }

    /// The bytes of a fixture's trailer, which start straight after the script
    /// when the fixture has no demo stream.
    fn trailer_bytes(f: &DemoFixture) -> Vec<u8> {
        f.bytes()[f.header_size + f.script.len()..].to_vec()
    }

    /// Why every assertion above names a sample other than the first.
    ///
    /// Read with the wrong stride, sample 0 comes out perfect, because it starts
    /// where the block does. Sample 1 is the first one the stride has had a
    /// chance to get wrong. A fixture asserted only on its first sample proves
    /// nothing at all, which is the failure this milestone exists to prevent.
    #[test]
    fn a_wrong_stride_is_caught_by_the_second_sample_not_the_first() {
        let f = DemoFixture {
            team_stat_elem_size: 88,
            team_samples: vec![series(5)],
            ..Default::default()
        };
        let block = trailer_bytes(&f);
        let samples = &block[4..]; // past the one sample count

        // Striding by the 80 bytes we know how to read, rather than the 88 the
        // header declares.
        assert_eq!(read_team_stat_sample(&samples[0..]), sample(0));
        assert_ne!(read_team_stat_sample(&samples[80..]), sample(1));

        // Striding by the declared size gets every one of them.
        for i in 0..5usize {
            assert_eq!(read_team_stat_sample(&samples[i * 88..]), sample(i as i32));
        }
    }

    /// The synthetic files are only worth anything if they are shaped like a file
    /// the engine wrote, so this pins them to one that was measured by hand:
    /// `2026-07-20_02-27-48-248_Greenhaven BAR v1.2_2025.06.21.sdfz`, a 490 second
    /// 3 team game with 2 players, one winning ally-team, and 34 samples a team.
    ///
    /// Its trailer is 8213 bytes: 1 winner, 40 of player statistics, and a
    /// `teamStatSize` of 8172, which is `3*4 + 3*34*80`. Both figures matched the
    /// real file to the byte.
    #[test]
    fn a_fixture_is_shaped_like_the_file_the_engine_wrote() {
        let f = DemoFixture {
            winning_ally_teams: vec![0],
            player_stats: vec![[163, 163, 416_476, 493, 277], [194, 230, 227_928, 364, 462]],
            team_samples: vec![series(34), series(34), series(34)],
            game_time: 490,
            ..Default::default()
        };
        let bytes = f.bytes();
        let read = |off: usize| i32::from_le_bytes(bytes[off..off + 4].try_into().unwrap());
        assert_eq!(read(OFF_NUM_PLAYERS), 2);
        assert_eq!(read(OFF_PLAYER_STAT_SIZE), 40);
        assert_eq!(read(OFF_NUM_TEAMS), 3);
        assert_eq!(read(OFF_TEAM_STAT_SIZE), 8172);
        assert_eq!(read(OFF_WINNING_ALLY_TEAMS_SIZE), 1);
        assert_eq!(trailer_bytes(&f).len(), 8213);

        // And a player's first int32 is their command count, not their mouse
        // travel. `PlayerStatistics` derives from `TeamControllerStatistics`, so
        // the base members come first and this is not the order the header file
        // declares. Reading it as declared reports 416476 commands over 8 minutes.
        let players_at = f.header_size + f.script.len() + 1;
        assert_eq!(read(players_at), 163, "numCommands");
        assert_eq!(read(players_at + 8), 416_476, "mousePixels");
    }

    /// [`decode_team_stats`] checks the element size again on its own account,
    /// because it is the thing that would index past the end of a sample, and a
    /// panic is a worse answer than a refusal. Reached directly, since
    /// [`DemoHeader::require_known_layout`] gets there first on a whole file.
    #[test]
    fn splitting_samples_refuses_an_element_too_small_to_hold_one() {
        let err = decode_team_stats(&[0u8; 44], 1, 40).unwrap_err();
        assert!(err.contains("teamStatElemSize is 40"), "got: {err}");
    }

    /// A file that stops inside the player statistics, with no team statistics
    /// behind them, is the truncation that reads as an answer: every later block
    /// is empty either way, so nothing downstream notices. It has to be refused
    /// where it is found.
    #[test]
    fn a_file_that_stops_inside_the_player_statistics_is_refused() {
        let f = DemoFixture {
            winning_ally_teams: vec![0],
            player_stats: vec![[1, 2, 3, 4, 5]; 3],
            truncate_by: 20,
            ..Default::default()
        };
        let err = decode_trailer(&f.bytes()).unwrap_err();
        assert!(err.contains("player statistics"), "got: {err}");
        assert!(err.contains("truncated"), "got: {err}");
    }

    /// A `teamStatSize` bigger than its own sample counts account for means the
    /// counts and the block disagree, so one of them is not what we think.
    #[test]
    fn a_team_statistics_block_bigger_than_its_counts_is_refused() {
        let f = DemoFixture {
            team_samples: vec![series(3), series(3)],
            ..Default::default()
        };
        let mut bytes = f.bytes();
        let declared = i32::from_le_bytes(
            bytes[OFF_TEAM_STAT_SIZE..OFF_TEAM_STAT_SIZE + 4]
                .try_into()
                .unwrap(),
        );
        put_i32(&mut bytes, OFF_TEAM_STAT_SIZE, declared + 80);
        bytes.extend_from_slice(&[0u8; 80]);

        let err = decode_trailer(&bytes).unwrap_err();
        assert!(err.contains("teamStatSize"), "got: {err}");
    }

    /// End-to-end over the real replays in `~/.spring/demos`, which is the check a
    /// synthetic fixture cannot make: that the fixtures agree with a file the
    /// engine wrote. Ignored by default, it needs replays on disk.
    ///
    ///   COILBOX_REAL_DEMO_DIR=~/.spring/demos \
    ///   cargo test -p tauri-plugin-coilbox-content real_demo_trailers -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_demo_trailers() {
        let dir = std::env::var("COILBOX_REAL_DEMO_DIR").expect("set COILBOX_REAL_DEMO_DIR");
        let mut seen = 0;
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = e.path();
            if !is_replay_path(&path) {
                continue;
            }
            seen += 1;
            let t = read_trailer(&path).unwrap_or_else(|err| {
                panic!("{}: {err}", path.display());
            });
            let total: usize = t.teams.iter().map(|s| s.samples.len()).sum();
            eprintln!(
                "{}: winners={:?} teams={} samples={total}",
                path.file_name().unwrap().to_string_lossy(),
                t.winning_ally_teams,
                t.teams.len(),
            );
            for s in &t.teams {
                // Samples are one every teamStatPeriod seconds at 30 frames a
                // second, and every figure is a running total.
                let step = (t.team_stat_period_sec * 30) as i32;
                for w in s.samples.windows(2) {
                    assert_eq!(w[1].frame - w[0].frame, step, "{}", path.display());
                    assert!(w[1].metal_produced >= w[0].metal_produced);
                    assert!(w[1].damage_dealt >= w[0].damage_dealt);
                    assert!(w[1].units_produced >= w[0].units_produced);
                }
            }
        }
        assert!(seen > 0, "no replays in {dir}");
    }

    #[test]
    fn parses_winner_line() {
        assert_eq!(
            parse_winners("noise\nWinning Allyteams: 0 2"),
            Some(vec![0, 2])
        );
        assert_eq!(parse_winners("Winning Allyteams:"), Some(vec![]));
        assert_eq!(parse_winners("no such line"), None);
    }

    /// End-to-end check against a real replay + engine (with demotool present).
    /// Ignored by default; run with the paths supplied, e.g.:
    ///   COILBOX_ENGINE_DIR=~/.spring \
    ///   COILBOX_REAL_DEMO=~/.spring/demos/<file>.sdfz \
    ///   cargo test -p tauri-plugin-coilbox-content real_demo -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_demo() {
        let demo = std::env::var("COILBOX_REAL_DEMO").expect("set COILBOX_REAL_DEMO");
        let engine = std::env::var("COILBOX_ENGINE_DIR").expect("set COILBOX_ENGINE_DIR");
        let info = demo_info(Path::new(&engine), Path::new(&demo)).unwrap();
        eprintln!(
            "engine={} map={} game={} dur={}s players={} allyteams={} winnersKnown={} winners={:?}",
            info.engine_version,
            info.map_name,
            info.game_type,
            info.duration_sec,
            info.players.len(),
            info.num_ally_teams,
            info.winners_known,
            info.winning_ally_teams,
        );
        for p in &info.players {
            eprintln!(
                "  {} team={:?} ally={:?} side={:?} spec={} won={:?}",
                p.name, p.team, p.ally_team, p.side, p.spectator, p.won
            );
        }
        assert!(!info.map_name.is_empty(), "map name should parse");
        assert!(
            !info.engine_version.is_empty(),
            "engine version should parse"
        );
    }

    #[test]
    fn list_replays_scans_demos_and_replays() {
        let root = std::env::temp_dir().join("coilbox_list_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("demos")).unwrap();
        std::fs::create_dir_all(root.join("replays")).unwrap();
        std::fs::write(root.join("demos").join("a.sdfz"), b"x").unwrap();
        std::fs::write(root.join("replays").join("b.sdf"), b"x").unwrap();
        std::fs::write(root.join("demos").join("notademo.txt"), b"x").unwrap();
        let list = list_replays(&root);
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|r| r.filename == "a.sdfz"));
        assert!(list.iter().any(|r| r.filename == "b.sdf"));
    }

    /// The engine writes `demos/` relative to its write dir, and a Recoil release
    /// extracted into `engine/<version>/` is Portable Mode, so that is its own
    /// folder. Measured on a real headless match run out of a staged
    /// `engine/1.0/` (issue #966), which wrote
    /// `engine/1.0/demos/2026-08-07_..._AcidicQuarry 5.17_....sdfz`.
    ///
    /// The fixtures here are real demo files, so a replay only counts when its
    /// header and start-script actually decode out of the engine directory.
    #[test]
    fn a_replay_an_engine_wrote_into_its_own_directory_is_listed() {
        let root = std::env::temp_dir().join("coilbox_engine_demos_test");
        let _ = std::fs::remove_dir_all(&root);
        let demo = build_demo(SCRIPT, true);

        // engine/<version>/, a Recoil install.
        let flat = root.join("engine").join("1.0");
        std::fs::create_dir_all(flat.join("demos")).unwrap();
        std::fs::write(flat.join("spring"), b"x").unwrap();
        std::fs::write(flat.join("demos").join("flat.sdfz"), &demo).unwrap();

        // engine/<platform>/<version>/, the springfiles layout.
        let nested = root.join("engine").join("macos_arm64").join("2.0");
        std::fs::create_dir_all(nested.join("demos")).unwrap();
        std::fs::write(nested.join("spring-headless"), b"x").unwrap();
        std::fs::write(nested.join("demos").join("nested.sdfz"), &demo).unwrap();

        // And the shared root, where a non-Portable-Mode engine writes.
        std::fs::create_dir_all(root.join("demos")).unwrap();
        std::fs::write(root.join("demos").join("shared.sdfz"), &demo).unwrap();

        let list = list_replays(&root);
        let names: Vec<&str> = list.iter().map(|r| r.filename.as_str()).collect();
        assert_eq!(list.len(), 3, "got {names:?}");
        for want in ["flat.sdfz", "nested.sdfz", "shared.sdfz"] {
            let r = list
                .iter()
                .find(|r| r.filename == want)
                .unwrap_or_else(|| panic!("{want} missing from {names:?}"));
            assert_eq!(r.map_name.as_deref(), Some("Valles Marineris 2.6.1"));
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Only a directory that actually holds an engine is a write dir, so a stray
    /// folder under `engine/` is not searched.
    #[test]
    fn a_folder_under_engine_with_no_engine_in_it_is_not_searched() {
        let root = std::env::temp_dir().join("coilbox_engine_demos_stray_test");
        let _ = std::fs::remove_dir_all(&root);
        let stray = root.join("engine").join("leftovers");
        std::fs::create_dir_all(stray.join("demos")).unwrap();
        std::fs::write(stray.join("demos").join("x.sdfz"), build_demo(SCRIPT, true)).unwrap();

        assert_eq!(demo_search_dirs(&root), vec![root.clone()]);
        assert!(list_replays(&root).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A single-folder portable install is both the root and its own engine
    /// directory, so it must not be searched twice.
    #[test]
    fn a_single_folder_install_is_searched_once() {
        let root = std::env::temp_dir().join("coilbox_engine_demos_portable_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("demos")).unwrap();
        std::fs::write(root.join("spring"), b"x").unwrap();
        std::fs::write(
            root.join("demos").join("only.sdfz"),
            build_demo(SCRIPT, true),
        )
        .unwrap();

        assert_eq!(demo_search_dirs(&root), vec![root.clone()]);
        assert_eq!(list_replays(&root).len(), 1);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A bulk delete preview sizes the batch and removes nothing.
    #[test]
    fn a_bulk_delete_preview_removes_nothing() {
        let dir = std::env::temp_dir().join("coilbox_bulk_delete_preview_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.sdfz");
        let b = dir.join("b.sdf");
        std::fs::write(&a, b"1234").unwrap();
        std::fs::write(&b, b"123").unwrap();

        let summary = delete_replays(&[a.clone(), b.clone()], false);
        assert!(!summary.applied);
        assert_eq!(summary.deleted, 2);
        assert_eq!(summary.bytes, 7);
        assert!(a.is_file() && b.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// One bad path is skipped with a reason, and the rest of the batch still goes.
    #[test]
    fn a_bulk_delete_skips_what_it_cannot_take() {
        let dir = std::env::temp_dir().join("coilbox_bulk_delete_apply_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let replay = dir.join("keep-me-not.sdfz");
        let other = dir.join("springsettings.cfg");
        std::fs::write(&replay, b"12345").unwrap();
        std::fs::write(&other, b"config").unwrap();

        let summary = delete_replays(&[replay.clone(), other.clone(), dir.join("gone.sdf")], true);
        assert!(summary.applied);
        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.bytes, 5);
        assert_eq!(summary.skipped.len(), 2, "{:?}", summary.skipped);
        assert!(summary.skipped[0].contains("not a replay file"));
        assert!(summary.skipped[1].contains("not found"));
        assert!(!replay.exists());
        assert!(other.is_file(), "a non-replay must survive");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A root with two engines that both recorded, plus one replay of the root's
    /// own. Names are distinct unless a caller plants a clash.
    fn gather_fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&root);
        for (dir, file) in [
            ("engine/1.0", "old.sdfz"),
            ("engine/macos_arm64/2.0", "new.sdfz"),
        ] {
            let engine = root.join(dir);
            std::fs::create_dir_all(engine.join("demos")).unwrap();
            std::fs::write(engine.join("spring"), b"x").unwrap();
            std::fs::write(engine.join("demos").join(file), b"replay").unwrap();
        }
        std::fs::create_dir_all(root.join("demos")).unwrap();
        std::fs::write(root.join("demos").join("already.sdfz"), b"replay").unwrap();
        root
    }

    /// A clock far enough ahead of the fixture's files that nothing is inside
    /// the grace window.
    fn later() -> u64 {
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + GATHER_GRACE_MS * 10
    }

    /// A dry run says what would move and moves nothing (issue #971).
    #[test]
    fn a_preview_moves_nothing() {
        let root = gather_fixture("coilbox_gather_preview_test");
        let summary = gather_replays(&root, false, later());
        assert!(!summary.applied);
        assert_eq!(summary.moved, vec!["new.sdfz", "old.sdfz"]);
        assert!(summary.skipped.is_empty(), "{:?}", summary.skipped);
        assert_eq!(summary.bytes, 12);
        assert!(root.join("engine/1.0/demos/old.sdfz").is_file());
        assert!(!root.join("demos/old.sdfz").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Applying moves each engine's replays into the root, leaving the engine
    /// folders with nothing to lose.
    #[test]
    fn applying_moves_each_engines_replays_into_the_root() {
        let root = gather_fixture("coilbox_gather_apply_test");
        let summary = gather_replays(&root, true, later());
        assert!(summary.applied);
        assert_eq!(summary.moved, vec!["new.sdfz", "old.sdfz"]);
        assert!(root.join("demos/old.sdfz").is_file());
        assert!(root.join("demos/new.sdfz").is_file());
        assert!(!root.join("engine/1.0/demos/old.sdfz").exists());
        // The root's own replay is untouched, and every replay is still listed.
        assert!(root.join("demos/already.sdfz").is_file());
        assert_eq!(list_replays(&root).len(), 3);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A name already taken in the destination is left alone rather than
    /// overwritten, and the same name in two engines only moves once.
    #[test]
    fn a_name_already_taken_is_left_where_it_is() {
        let root = gather_fixture("coilbox_gather_clash_test");
        std::fs::write(root.join("demos").join("old.sdfz"), b"the original").unwrap();
        std::fs::write(
            root.join("engine/macos_arm64/2.0/demos/new.sdfz"),
            b"replay",
        )
        .unwrap();
        std::fs::write(root.join("engine/1.0/demos/new.sdfz"), b"replay").unwrap();

        let summary = gather_replays(&root, true, later());
        assert_eq!(summary.moved, vec!["new.sdfz"]);
        assert_eq!(summary.skipped.len(), 2, "{:?}", summary.skipped);
        assert!(summary
            .skipped
            .iter()
            .all(|s| s.contains("already in demos")));
        // Neither the original nor the one that could not move was lost.
        assert_eq!(
            std::fs::read(root.join("demos/old.sdfz")).unwrap(),
            b"the original"
        );
        assert!(root.join("engine/1.0/demos/old.sdfz").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A replay written moments ago may be a match still recording, so it stays.
    #[test]
    fn a_replay_written_just_now_is_left_alone() {
        let root = gather_fixture("coilbox_gather_recent_test");
        let now = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let summary = gather_replays(&root, true, now);
        assert!(summary.moved.is_empty(), "{:?}", summary.moved);
        assert_eq!(summary.skipped.len(), 2);
        assert!(summary
            .skipped
            .iter()
            .all(|s| s.contains("may still be recording")));
        assert!(root.join("engine/1.0/demos/old.sdfz").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A single-folder portable install is its own root, so there is nothing to
    /// gather out of it and nothing to move onto itself.
    #[test]
    fn a_single_folder_install_gathers_nothing() {
        let root = std::env::temp_dir().join("coilbox_gather_portable_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("demos")).unwrap();
        std::fs::write(root.join("spring"), b"x").unwrap();
        std::fs::write(root.join("demos").join("only.sdfz"), b"replay").unwrap();

        let summary = gather_replays(&root, true, later());
        assert!(summary.moved.is_empty());
        assert!(summary.skipped.is_empty());
        assert!(root.join("demos/only.sdfz").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Write an executable `/bin/sh` script standing in for demotool.
    #[cfg(unix)]
    fn fake_demotool(name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join("coilbox_demotool_test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// A real `--teamstats` run on a 40 minute game prints past the 64 KB pipe
    /// buffer, and the winners are on the last line. Reading only after the child
    /// exits deadlocks, because the child cannot exit until someone reads.
    #[test]
    #[cfg(unix)]
    fn run_demotool_reads_more_than_the_pipe_buffer() {
        let bin = fake_demotool(
            "chatty",
            "i=0\n\
             while [ $i -lt 4000 ]; do\n\
             echo 'Team 0 stat line padded out to look like a teamstats block'\n\
             i=$((i+1))\n\
             done\n\
             echo 'Winning Allyteams: 1'\n",
        );
        let out = run_demotool(
            &bin,
            Path::new("unused.sdfz"),
            "--teamstats",
            Duration::from_secs(10),
        )
        .expect("demotool should finish");
        assert!(
            out.len() > 200_000,
            "expected a big dump, got {}",
            out.len()
        );
        assert_eq!(parse_winners(&out), Some(vec![1]));
    }

    /// A demotool that never exits is still given up on.
    #[test]
    #[cfg(unix)]
    fn run_demotool_times_out_on_a_hanging_child() {
        let bin = fake_demotool("hangs", "sleep 30\n");
        let start = Instant::now();
        let err = run_demotool(
            &bin,
            Path::new("unused.sdfz"),
            "--teamstats",
            Duration::from_millis(200),
        )
        .expect_err("a hanging demotool should time out");
        assert!(err.contains("timed out"), "unexpected error: {err}");
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn parse_skill_reads_leading_number() {
        assert_eq!(parse_skill("[25.0]"), Some(25.0));
        assert_eq!(parse_skill("(30.5)"), Some(30.5));
        assert_eq!(parse_skill("[µ=12.3, σ=8.3]"), Some(12.3));
        assert_eq!(parse_skill(""), None);
        assert_eq!(parse_skill("n/a"), None);
    }

    #[test]
    fn skill_stats_over_nonspectators() {
        let game = find_game(&parse_tdf(SCRIPT));
        let info = build_demo_info(
            RawDemo {
                engine_version: String::new(),
                game_id: String::new(),
                unix_time: 0,
                game_time: 0,
                wallclock: 0,
                game_over: true,
                script: SCRIPT.to_string(),
            },
            &game,
            None,
        );
        // Only Alice has a skill ([25.0]); Bob has none, Specs is a spectator.
        let (min, avg, max) = skill_stats(&info.players);
        assert_eq!(min, Some(25.0));
        assert_eq!(avg, Some(25.0));
        assert_eq!(max, Some(25.0));
    }

    #[test]
    fn build_demo_info_reads_modoptions() {
        let game = find_game(&parse_tdf(SCRIPT));
        let info = build_demo_info(
            RawDemo {
                engine_version: String::new(),
                game_id: String::new(),
                unix_time: 0,
                game_time: 0,
                wallclock: 0,
                game_over: true,
                script: SCRIPT.to_string(),
            },
            &game,
            None,
        );
        assert_eq!(
            info.mod_options.get("zombies").map(String::as_str),
            Some("disabled")
        );
        assert_eq!(
            info.mod_options.get("emptyval").map(String::as_str),
            Some("")
        );
        assert_eq!(info.mod_options.len(), 2);
    }

    #[test]
    fn replace_gametype_swaps_only_the_value() {
        let s = "[game]\n{\ngametype=Old Name-123;\nmapname=Foo;\n}\n";
        let out = replace_gametype(s, "New Build").unwrap();
        assert!(out.contains("gametype=New Build;"));
        assert!(out.contains("mapname=Foo;"));
        assert!(!out.contains("Old Name-123"));
        // Also handle the generated-script capitalisation (`GameType`).
        assert!(replace_gametype("[GAME]{GameType=x;}", "y")
            .unwrap()
            .contains("GameType=y;"));
        // No key -> error, not a silent no-op.
        assert!(replace_gametype("[game]{mapname=x;}", "y").is_err());
    }

    #[test]
    fn rewrite_redirects_gametype_and_never_touches_source() {
        // header + script + a fake demo-stream tail we expect to survive verbatim.
        let mut demo = build_demo(SCRIPT, false);
        let tail: &[u8] = b"\x00\x01\x02DEMO-STREAM-TAIL\xff\xfe";
        demo.extend_from_slice(tail);
        // Everything past the start script is copied byte for byte: this
        // fixture's empty team-statistics counts, then the tail.
        let verbatim = demo[352 + SCRIPT.len()..].to_vec();
        let src = write_tmp("jb_src.sdf", &demo);
        let before = std::fs::read(&src).unwrap();

        let dst = rewrite_demo(&src, "Beyond All Reason LOCAL-GIT", None).unwrap();
        assert_ne!(dst, src);
        // Source is byte-for-byte untouched.
        assert_eq!(std::fs::read(&src).unwrap(), before);

        let out = std::fs::read(&dst).unwrap(); // raw .sdf, no gzip
        let hs = i32::from_le_bytes(
            out[OFF_HEADER_SIZE..OFF_HEADER_SIZE + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let ss = i32::from_le_bytes(
            out[OFF_SCRIPT_SIZE..OFF_SCRIPT_SIZE + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let script = std::str::from_utf8(&out[hs..hs + ss]).unwrap();
        assert!(script.contains("gametype=Beyond All Reason LOCAL-GIT;"));
        // The gametype line itself no longer names the original build...
        let gt_line = script.lines().find(|l| l.starts_with("gametype=")).unwrap();
        assert!(!gt_line.contains("test-30018"));
        // ...but the remix marker records where it came from + its origin file.
        assert!(script.contains("[coilbox]"));
        assert!(script.contains("source=Beyond All Reason test-30018;"));
        assert!(script.contains("origin=jb_src.sdf;"));
        assert!(script.contains("mapname=Valles Marineris 2.6.1")); // map untouched
        assert_eq!(&out[hs + ss..], &verbatim[..]); // stream tail byte-identical

        // Re-reading detects the remix, its source gametype, and its origin file.
        let game = find_game(&parse_tdf(script));
        let m = read_remix_marker(&game);
        assert!(m.remixed);
        assert_eq!(m.source.as_deref(), Some("Beyond All Reason test-30018"));
        assert_eq!(m.origin.as_deref(), Some("jb_src.sdf"));

        // End-to-end: the decoded DemoInfo carries the fields the UI reads, and they
        // serialize with the camelCase keys the frontend expects.
        let raw = read_header_and_script(&dst).unwrap();
        let info = build_demo_info(raw, &game, None);
        assert!(info.remixed);
        assert_eq!(info.origin_filename.as_deref(), Some("jb_src.sdf"));
        let js = serde_json::to_string(&info).unwrap();
        assert!(js.contains("\"remixed\":true"), "{js}");
        assert!(js.contains("\"originFilename\":\"jb_src.sdf\""), "{js}");

        let _ = std::fs::remove_file(&dst);
    }

    #[test]
    fn remix_marker_is_not_duplicated_on_re_stamp() {
        let s = "[game]\n{\ngametype=A;\nmapname=M;\n}\n";
        let once = inject_remix_marker(s, "A", "one.sdfz");
        let twice = inject_remix_marker(&once, "B", "two.sdfz");
        assert_eq!(twice.matches("[coilbox]").count(), 1);
        let m = read_remix_marker(&find_game(&parse_tdf(&twice)));
        assert!(m.remixed);
        assert_eq!(m.source.as_deref(), Some("B"));
        assert_eq!(m.origin.as_deref(), Some("two.sdfz"));
        // Non-remixed scripts read as not-remixed.
        assert_eq!(
            read_remix_marker(&find_game(&parse_tdf(s))),
            RemixMarker::default()
        );
    }

    #[test]
    fn rewrite_refuses_to_remix_a_remix() {
        // A demo whose script already carries the remix marker.
        let script = inject_remix_marker(SCRIPT, "Beyond All Reason test-30018", "orig.sdfz");
        let src = write_tmp("already.remix.sdf", &build_demo(&script, false));
        let err = rewrite_demo(&src, "Some Other Build", None).unwrap_err();
        assert!(err.contains("already a remix"), "got: {err}");
    }

    #[test]
    fn rewrite_stamps_engine_version_and_round_trips_gzip() {
        let src = write_tmp("jb_ver.sdfz", &build_demo(SCRIPT, true));
        let dst = rewrite_demo(&src, "Some Game 1.0", Some("2025.06.19")).unwrap();
        // dst is gzip (.sdfz) and re-reads cleanly with the new fields.
        let raw = read_header_and_script(&dst).unwrap();
        assert_eq!(raw.engine_version, "2025.06.19");
        assert!(raw.script.contains("gametype=Some Game 1.0;"));
        let _ = std::fs::remove_file(&dst);
    }

    #[test]
    fn parse_chat_reads_chat_and_system_lines() {
        let mut names = HashMap::new();
        names.insert(0u32, "Alice".to_string());
        let out = "HEADER\n\
            CHAT: Player: 0 Msg: gg wp\n\
            SYSTEMMSG: Player: 1 Msg: Bob paused\n\
            KEYFRAME: 1\n\
            CHAT: Player: 9 Msg: unknown speaker\n";
        let msgs = parse_chat(out, &names);
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].player, Some(0));
        assert_eq!(msgs[0].player_name.as_deref(), Some("Alice"));
        assert_eq!(msgs[0].text, "gg wp");
        assert!(!msgs[0].system);
        assert!(msgs[1].system);
        assert_eq!(msgs[2].player_name, None);
    }
}
