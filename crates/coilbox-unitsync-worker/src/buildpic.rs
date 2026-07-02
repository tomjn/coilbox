//! `--unit-buildpics` mode: resolve each requested start unit's build icon.
//!
//! In one `AddAllArchives` session: run the Lua parser once to read each unit's
//! `buildpic` field (games that override the default), then read the texture from
//! `unitpics/` in the primary archive (mirroring `archive::game_headers`), decode
//! it (via `crate::texture`, which adds DDS), and PNG-encode a small `data:` URL.
//! Disk-cached per (game-identity, unit), keyed on cheap file identity like the
//! header cache.

use crate::ffi::Unitsync;
use crate::model::UnitBuildpicsOutput;
use std::path::Path;

/// Salts the buildpic cache key, independent of the header cache so this cache can
/// be invalidated on its own. Bump when the icon encoding changes.
const BUILDPIC_CACHE_VERSION: u32 = 1;

/// Read up to this many bytes of a candidate texture before decoding (build pics
/// are tiny; this is a generous safety bound).
const BUILDPIC_READ_CAP: usize = 8 * 1024 * 1024;

/// Extensions tried under `unitpics/`, in the engine's resolution order.
const BUILDPIC_EXTS: &[&str] = &["dds", "png", "tga", "bmp"];

/// Build the Lua script run through the parser. It reads each requested unit's
/// `buildpic` field from `units/<name>.lua` (keyed by unit name inside the file),
/// and returns a flat `name\tbuildpic` string in the `result` field that
/// `run_lua_source` reads back. Empty buildpic => fall back to the name convention.
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
  local ok, def = pcall(VFS.Include, 'units/'..name..'.lua')
  if ok and type(def) == 'table' then
    local ud = def[name]
    if type(ud) ~= 'table' then
      for k, v in pairs(def) do
        if type(v) == 'table' and string.lower(k) == name then ud = v break end
      end
    end
    if type(ud) == 'table' and type(ud.buildpic) == 'string' then bp = ud.buildpic end
  end
  parts[#parts + 1] = name .. '\t' .. bp
end
return {{ result = table.concat(parts, '\n') }}
"#
    )
}

/// Parse the `name\tbuildpic` lines the Lua script returns into a map.
fn parse_buildpic_result(raw: &str) -> std::collections::HashMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let (name, bp) = line.split_once('\t')?;
            Some((name.to_string(), bp.to_string()))
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
    let mut buildpics = std::collections::BTreeMap::new();
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
            match read_cache(dir, base, unit) {
                Some(Some(url)) => {
                    buildpics.insert(unit.clone(), url);
                    continue;
                }
                Some(None) => continue, // negative cache: no icon
                None => {}
            }
        }
        misses.push(unit.clone());
    }

    if misses.is_empty() {
        us.uninit();
        return UnitBuildpicsOutput { buildpics, errors };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return UnitBuildpicsOutput { buildpics, errors };
    }
    errors.extend(us.drain_errors());

    // One Lua pass reads the explicit `buildpic` fields for the miss units.
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
                let bp = fields
                    .get(&unit.to_lowercase())
                    .cloned()
                    .unwrap_or_default();
                let url = candidate_members(unit, &bp).into_iter().find_map(|cand| {
                    let actual = list
                        .iter()
                        .find(|(lower, _)| *lower == cand.to_lowercase())
                        .map(|(_, real)| real.clone())?;
                    read_and_encode(&us, handle, &actual)
                });
                if let Some((dir, base)) = cache {
                    write_cache(dir, base, unit, url.as_deref());
                }
                if let Some(url) = url {
                    buildpics.insert(unit.clone(), url);
                }
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

    UnitBuildpicsOutput { buildpics, errors }
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

/// Per-unit cache file stem: `<gamekey>_<sanitized-unit>`.
fn unit_stem(base: &str, unit: &str) -> String {
    let safe: String = unit
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{base}_{safe}")
}

/// `Some(Some(url))` = cached icon; `Some(None)` = negative cache; `None` = miss.
fn read_cache(dir: &Path, base: &str, unit: &str) -> Option<Option<String>> {
    let stem = unit_stem(base, unit);
    if let Ok(url) = std::fs::read_to_string(dir.join(format!("{stem}.dataurl"))) {
        return Some(Some(url));
    }
    if dir.join(format!("{stem}.none")).exists() {
        return Some(None);
    }
    None
}

/// Best-effort cache write: `.dataurl` for a hit, `.none` marker for no icon.
fn write_cache(dir: &Path, base: &str, unit: &str, url: Option<&str>) {
    let _ = std::fs::create_dir_all(dir);
    let stem = unit_stem(base, unit);
    match url {
        Some(u) => {
            let _ = std::fs::write(dir.join(format!("{stem}.dataurl")), u);
        }
        None => {
            let _ = std::fs::write(dir.join(format!("{stem}.none")), b"");
        }
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
        let got = parse_buildpic_result("armcom\tunitpics/armcom.dds\ncorcom\t\n");
        assert_eq!(
            got.get("armcom").map(String::as_str),
            Some("unitpics/armcom.dds")
        );
        assert_eq!(got.get("corcom").map(String::as_str), Some(""));
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
