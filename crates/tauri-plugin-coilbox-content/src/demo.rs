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

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, UNIX_EPOCH};

use flate2::read::GzDecoder;

use crate::model::{AllyTeamInfo, ChatLine, DemoChat, DemoInfo, PlayerInfo, ReplayFile, StartBox};

/// Folders under a data root that hold client demos. The engine writes to
/// `demos/` (`DemoRecorder.cpp`); some lobbies/users use `replays/`.
pub(crate) const DEMO_DIRS: &[&str] = &["demos", "replays"];
const DEMO_EXTS: &[&str] = &[".sdfz", ".sdf"];

/// `demotool` can decode the full 7 MB+ stream; keep a hard ceiling so a corrupt
/// file can't hang the worker (matches `engine::read_version`'s bounded run).
const DEMOTOOL_TIMEOUT: Duration = Duration::from_secs(30);

// DemoFileHeader field offsets (packed, little-endian). magic[16], i32 version,
// i32 headerSize, char versionString[256], u8 gameID[16], u64 unixTime,
// i32 scriptSize, i32 demoStreamSize, i32 gameTime, i32 wallclockTime, ...
const MAGIC: &[u8] = b"spring demofile";
const OFF_HEADER_SIZE: usize = 20;
const OFF_VERSION_STRING: usize = 24;
const OFF_GAME_ID: usize = 280;
const OFF_UNIX_TIME: usize = 296;
const OFF_SCRIPT_SIZE: usize = 304;
const OFF_GAME_TIME: usize = 312;
const OFF_WALLCLOCK: usize = 316;
/// `numTeams`, how many teams the end-of-game statistics block covers. Written
/// only when the game actually ended, see [`RawDemo::game_over`].
const OFF_NUM_TEAMS: usize = 332;
/// We only need the header up to (and including) the team-count field. The v5
/// header is 352 bytes but reading this prefix is enough to locate the script.
const MIN_HEADER: usize = OFF_NUM_TEAMS + 4;

// ---- listing ---------------------------------------------------------------

/// List replays under `<root>/demos` and `<root>/replays` (cheap fs metadata
/// only; demotool is never run here so the list stays fast), newest first.
pub fn list_replays(root: &Path) -> Vec<ReplayFile> {
    let mut out: Vec<ReplayFile> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for dir in DEMO_DIRS {
        let Ok(rd) = std::fs::read_dir(root.join(dir)) else {
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
            // Cheap native decode (header + start-script only, no demotool) so the
            // list can show map/players/duration; best-effort, ignored on failure.
            let summary = decode_native(&path).ok();
            let (skill_min, skill_avg, skill_max) = summary
                .as_ref()
                .map(|i| skill_stats(&i.players))
                .unwrap_or((None, None, None));
            out.push(ReplayFile {
                filename: name,
                path: path.to_string_lossy().into_owned(),
                size_bytes,
                modified_ms,
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
            });
        }
    }
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

/// Enumerate demo files under `<root>/demos` and `<root>/replays` with fs metadata
/// only (no decode, no demotool), deduped by path. A missing folder is skipped, so
/// a root without a demos dir simply yields nothing.
pub fn demo_file_entries(root: &Path) -> Vec<DemoFileEntry> {
    let mut out: Vec<DemoFileEntry> = Vec::new();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for dir in DEMO_DIRS {
        let Ok(rd) = std::fs::read_dir(root.join(dir)) else {
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

    /// Build a minimal v5 demo (352-byte header + script), optionally gzipped.
    /// The header carries the end-of-game statistics counts, so it reads as a
    /// game that ended. `build_unfinished_demo` is the one that did not.
    fn build_demo(script: &str, gzip: bool) -> Vec<u8> {
        let mut h = build_demo_bytes(script, 2);
        if !gzip {
            return h;
        }
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(&h).unwrap();
        h = enc.finish().unwrap();
        h
    }

    /// A demo of a game that never reached a game over: the engine leaves every
    /// end-of-game statistics count at zero, `numTeams` among them.
    fn build_unfinished_demo(script: &str) -> Vec<u8> {
        build_demo_bytes(script, 0)
    }

    fn build_demo_bytes(script: &str, num_teams: i32) -> Vec<u8> {
        let mut h = vec![0u8; 352];
        h[..MAGIC.len()].copy_from_slice(MAGIC);
        put_i32(&mut h, 16, 5); // version
        put_i32(&mut h, OFF_HEADER_SIZE, 352);
        let ver = b"105.1.2 TEST";
        h[OFF_VERSION_STRING..OFF_VERSION_STRING + ver.len()].copy_from_slice(ver);
        for (k, b) in (0..16).zip(0xA0u8..) {
            h[OFF_GAME_ID + k] = b;
        }
        put_u64(&mut h, OFF_UNIX_TIME, 1_777_320_845);
        put_i32(&mut h, OFF_SCRIPT_SIZE, script.len() as i32);
        put_i32(&mut h, OFF_GAME_TIME, 2356);
        put_i32(&mut h, OFF_WALLCLOCK, 2531);
        put_i32(&mut h, OFF_NUM_TEAMS, num_teams);
        h.extend_from_slice(script.as_bytes());
        h
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
        assert!(out.len() > 200_000, "expected a big dump, got {}", out.len());
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
        assert_eq!(&out[hs + ss..], tail); // stream tail byte-identical

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
