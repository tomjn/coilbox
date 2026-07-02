//! `--unit-buildpics` mode: resolve each requested start unit's build icon.
//!
//! In one `AddAllArchives` session: run the Lua parser once to read each unit's
//! `buildpic` field (games that override the default), then read the texture from
//! `unitpics/` in the primary archive (mirroring `archive::game_headers`), decode
//! it (via `crate::texture`, which adds DDS), and PNG-encode a small `data:` URL.
//! Disk-cached per (game-identity, unit), keyed on cheap file identity like the
//! header cache.

use crate::ffi::Unitsync;
use crate::model::{UnitBuildpicsOutput, UnitDisplay};
use std::path::Path;

/// Salts the buildpic cache key, independent of the header cache so this cache can
/// be invalidated on its own. Bump when the icon encoding or cache format changes.
const BUILDPIC_CACHE_VERSION: u32 = 2;

/// Read up to this many bytes of a candidate texture before decoding (build pics
/// are tiny; this is a generous safety bound).
const BUILDPIC_READ_CAP: usize = 8 * 1024 * 1024;

/// Extensions tried under `unitpics/`, in the engine's resolution order.
const BUILDPIC_EXTS: &[&str] = &["dds", "png", "tga", "bmp"];

/// A unit's fields read from its unitdef: the `buildpic` filename (may be empty)
/// and the human-friendly `name` (may be empty).
#[derive(Default, Clone)]
struct UnitFields {
    buildpic: String,
    name: String,
}

/// Build the Lua script run through the parser. For each requested unit it reads
/// its unitdef from `units/<name>.lua` (keyed by unit name inside the file) and
/// pulls out the `buildpic` filename and the human-friendly `name`, returning a
/// flat `unit\tbuildpic\tname` string (one line per unit) in the `result` field
/// that `run_lua_source` reads back. Empty buildpic => fall back to the name
/// convention; empty name => fall back to the engine's start-unit name.
fn build_buildpic_script(units: &[String]) -> String {
    // Unit internal names are alnum/underscore, so a single-quoted key is safe.
    let want: String = units
        .iter()
        .map(|u| format!("['{}']=1,", u.to_lowercase()))
        .collect();
    format!(
        r#"
local want = {{ {want} }}
local parts = {{}}
for name in pairs(want) do
  local bp = ''
  local nm = ''
  local ok, def = pcall(VFS.Include, 'units/'..name..'.lua')
  if ok and type(def) == 'table' then
    local ud = def[name]
    if type(ud) ~= 'table' then
      for k, v in pairs(def) do
        if type(v) == 'table' and string.lower(k) == name then ud = v break end
      end
    end
    if type(ud) == 'table' then
      if type(ud.buildpic) == 'string' then bp = ud.buildpic end
      if type(ud.name) == 'string' then nm = ud.name end
    end
  end
  parts[#parts + 1] = name .. '\t' .. bp .. '\t' .. nm
end
return {{ result = table.concat(parts, '\n') }}
"#
    )
}

/// Parse the `unit\tbuildpic\tname` lines the Lua script returns into a map keyed
/// by unit name. A missing third field (older-style lines) parses as an empty name.
fn parse_buildpic_result(raw: &str) -> std::collections::HashMap<String, UnitFields> {
    raw.lines()
        .filter_map(|line| {
            let mut it = line.split('\t');
            let unit = it.next()?;
            let buildpic = it.next().unwrap_or("").to_string();
            let name = it.next().unwrap_or("").to_string();
            Some((unit.to_string(), UnitFields { buildpic, name }))
        })
        .collect()
}

/// Ordered, deduped candidate member paths under `unitpics/` for a unit. Explicit
/// buildpic (if it has a directory) is tried verbatim first, then its basename
/// across extensions, then the unit name across extensions.
fn candidate_members(unit_name: &str, buildpic: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bp = buildpic.trim();
    if !bp.is_empty() {
        if bp.contains('/') {
            push_unique(&mut out, bp.to_string());
        }
        let base = bp.rsplit('/').next().unwrap_or(bp);
        let base = base.rsplit_once('.').map(|(b, _)| b).unwrap_or(base);
        for ext in BUILDPIC_EXTS {
            push_unique(&mut out, format!("unitpics/{}.{ext}", base.to_lowercase()));
        }
    }
    for ext in BUILDPIC_EXTS {
        push_unique(
            &mut out,
            format!("unitpics/{}.{ext}", unit_name.to_lowercase()),
        );
    }
    out
}

/// Append `s` to `v` only if not already present (small N, so linear scan is fine).
fn push_unique(v: &mut Vec<String>, s: String) {
    if !v.contains(&s) {
        v.push(s);
    }
}

/// Resolve build icons for `units` in `game_archive`. Cache hits/negatives skip the
/// unitsync session entirely; otherwise mount the archive once and resolve the
/// misses. `cache_dir` `None` disables caching (always re-resolves).
pub fn render(
    lib: &str,
    game_archive: &str,
    units: &[String],
    cache_dir: Option<&Path>,
) -> UnitBuildpicsOutput {
    let mut resolved = std::collections::BTreeMap::new();
    let mut errors = Vec::new();

    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitBuildpicsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    errors.extend(us.drain_errors());

    let key_base = cache_key_base(&us, game_archive);
    let cache = cache_dir.zip(key_base.as_ref());

    // Partition into cache hits (done) and misses (need the archive mounted).
    let mut misses: Vec<String> = Vec::new();
    for unit in units {
        if let Some((dir, base)) = cache {
            if let Some(display) = read_cache(dir, base, unit) {
                collect_display(&mut resolved, unit, display);
                continue;
            }
        }
        misses.push(unit.clone());
    }

    if misses.is_empty() {
        us.uninit();
        return UnitBuildpicsOutput {
            units: resolved,
            errors,
        };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return UnitBuildpicsOutput {
            units: resolved,
            errors,
        };
    }
    errors.extend(us.drain_errors());

    // One Lua pass reads each miss unit's `buildpic` filename + human name.
    let script = build_buildpic_script(&misses);
    let fields = match us.run_lua_source(&script, "rmMbe") {
        Ok(raw) => parse_buildpic_result(&raw),
        Err(e) => {
            errors.push(format!("buildpic lua resolve failed: {e}"));
            std::collections::HashMap::new()
        }
    };
    let _ = us.drain_errors();

    // Read textures from the primary archive (like game_headers): list once,
    // case-insensitive match against each unit's candidate members.
    let opened = match crate::archive::resolve_open_path(&us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p))
    {
        Some(handle) => {
            let list: Vec<(String, String)> = us
                .list_archive_files(handle)
                .into_iter()
                .map(|(path, _)| (path.to_lowercase(), path))
                .collect();
            for unit in &misses {
                let uf = fields
                    .get(&unit.to_lowercase())
                    .cloned()
                    .unwrap_or_default();
                let icon = candidate_members(unit, &uf.buildpic)
                    .into_iter()
                    .find_map(|cand| {
                        let actual = list
                            .iter()
                            .find(|(lower, _)| *lower == cand.to_lowercase())
                            .map(|(_, real)| real.clone())?;
                        read_and_encode(&us, handle, &actual)
                    });
                let display = UnitDisplay {
                    name: Some(uf.name).filter(|s| !s.is_empty()),
                    icon,
                };
                if let Some((dir, base)) = cache {
                    write_cache(dir, base, unit, &display);
                }
                collect_display(&mut resolved, unit, display);
            }
            us.close_archive(handle);
            true
        }
        None => false,
    };
    if !opened {
        errors.push(format!("could not open archive {game_archive}"));
    }

    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    UnitBuildpicsOutput {
        units: resolved,
        errors,
    }
}

/// Read one member (capped) and decode+encode it as a build-icon PNG data URL.
fn read_and_encode(us: &Unitsync, handle: i32, member: &str) -> Option<String> {
    let ext = member.rsplit('.').next().unwrap_or("").to_lowercase();
    let (size, bytes) = us.read_archive_member(handle, member, BUILDPIC_READ_CAP)?;
    if size as usize > BUILDPIC_READ_CAP {
        return None;
    }
    let img = crate::texture::decode_texture(&ext, &bytes)?;
    crate::texture::encode_icon_png(img)
}

/// Cheap, stable per-game cache identity (path + size + mtime + version salt).
/// `None` disables caching for this game. Mirrors `archive::game_cache_key`.
fn cache_key_base(us: &Unitsync, archive_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let dir = us.archive_path(archive_name)?;
    let path = Path::new(&dir).join(archive_name);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    BUILDPIC_CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// Insert a resolved record into the output map, skipping fully-empty ones (the UI
/// falls back to the engine start-unit name for those).
fn collect_display(
    map: &mut std::collections::BTreeMap<String, UnitDisplay>,
    unit: &str,
    display: UnitDisplay,
) {
    if !display.is_empty() {
        map.insert(unit.to_string(), display);
    }
}

/// Per-unit cache file stem: `<gamekey>_<sanitized-unit>`.
fn unit_stem(base: &str, unit: &str) -> String {
    let safe: String = unit
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// Read a unit's cached record. `Some(display)` = resolved (the display may be
/// empty, i.e. "resolved to nothing" — still a hit that skips the mount); `None` =
/// cache miss. Present-but-unparseable files are treated as misses.
fn read_cache(dir: &Path, base: &str, unit: &str) -> Option<UnitDisplay> {
    let path = dir.join(format!("{}.json", unit_stem(base, unit)));
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Best-effort cache write of the resolved record as JSON. An empty record is
/// still written so a re-run doesn't re-mount the archive for a unit we already
/// know has nothing.
fn write_cache(dir: &Path, base: &str, unit: &str, display: &UnitDisplay) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(format!("{}.json", unit_stem(base, unit)));
    if let Ok(json) = serde_json::to_string(display) {
        let _ = std::fs::write(path, json);
    }
}

/// Print a buildpics error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = UnitBuildpicsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tab_separated_buildpic_result() {
        let got =
            parse_buildpic_result("armcom\tunitpics/armcom.dds\tArmada Commander\ncorcom\t\t\n");
        let arm = got.get("armcom").expect("armcom present");
        assert_eq!(arm.buildpic, "unitpics/armcom.dds");
        assert_eq!(arm.name, "Armada Commander");
        let cor = got.get("corcom").expect("corcom present");
        assert_eq!(cor.buildpic, "");
        assert_eq!(cor.name, "");
    }

    #[test]
    fn build_script_reads_buildpic_and_name_fields() {
        let s = build_buildpic_script(&["armcom".into()]);
        assert!(s.contains("ud.buildpic"));
        assert!(s.contains("ud.name"));
    }

    #[test]
    fn candidates_prefer_explicit_buildpic_then_unit_name() {
        let c = candidate_members("armcom", "unitpics/ArmCom_alt.png");
        assert_eq!(c[0], "unitpics/ArmCom_alt.png");
        assert!(c.contains(&"unitpics/armcom_alt.dds".to_string()));
        assert!(c.contains(&"unitpics/armcom.dds".to_string()));
    }

    #[test]
    fn candidates_with_no_buildpic_use_unit_name_only() {
        let c = candidate_members("armcom", "");
        assert_eq!(c[0], "unitpics/armcom.dds");
        assert!(c.contains(&"unitpics/armcom.png".to_string()));
    }

    #[test]
    fn lua_script_lists_requested_units() {
        let s = build_buildpic_script(&["armcom".into(), "corcom".into()]);
        assert!(s.contains("['armcom']") && s.contains("['corcom']"));
        assert!(s.contains("VFS.Include"));
        assert!(s.contains("result ="));
    }
}
