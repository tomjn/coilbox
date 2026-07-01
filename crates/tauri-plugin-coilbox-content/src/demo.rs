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
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

use flate2::read::GzDecoder;

use crate::model::{AllyTeamInfo, DemoInfo, PlayerInfo, ReplayFile, StartBox};

/// Folders under a data root that hold client demos. The engine writes to
/// `demos/` (`DemoRecorder.cpp`); some lobbies/users use `replays/`.
const DEMO_DIRS: &[&str] = &["demos", "replays"];
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
/// We only need the header up to (and including) the wallclock field; the v5
/// header is 352 bytes but reading this prefix is enough to locate the script.
const MIN_HEADER: usize = OFF_WALLCLOCK + 4;

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
            });
        }
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.modified_ms));
    out
}

// ---- decoding --------------------------------------------------------------

/// Decode one replay: native header + start-script, plus demotool's winners.
pub fn demo_info(engine_dir: &Path, demo: &Path) -> Result<DemoInfo, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let winners = demotool_winners(engine_dir, demo);
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

/// Run `demotool --teamstats <demo>` and parse its trailing `Winning Allyteams:`
/// line. Returns `None` when demotool is absent or fails — the caller treats
/// that as "winner unknown" rather than an error (everything else is native).
fn demotool_winners(engine_dir: &Path, demo: &Path) -> Option<Vec<u32>> {
    let bin = resolve_demotool(engine_dir)?;
    let out = run_demotool(&bin, demo, DEMOTOOL_TIMEOUT).ok()?;
    parse_winners(&out)
}

/// Spawn demotool with a bounded timeout (kills the child on overrun), modeled on
/// `engine::read_version`. Returns captured stdout.
fn run_demotool(bin: &Path, demo: &Path, timeout: Duration) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.arg("--teamstats")
        .arg(demo)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to run demotool: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("demotool timed out".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("error waiting for demotool: {e}")),
        }
    }
    let mut out = String::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_string(&mut out);
    }
    Ok(out)
}

/// Extract the winning ally-team numbers from demotool's `Winning Allyteams: N N`
/// line. An empty list (no game-over recorded) still returns `Some(vec![])`.
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
    fn build_demo(script: &str, gzip: bool) -> Vec<u8> {
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
        h.extend_from_slice(script.as_bytes());
        if !gzip {
            return h;
        }
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(&h).unwrap();
        enc.finish().unwrap()
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
}
