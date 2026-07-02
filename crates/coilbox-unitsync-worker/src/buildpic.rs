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
/// be invalidated on its own. Bump when the icon encoding, cache format, or the
/// name/buildpic *resolution logic* changes so pre-change records are re-resolved.
/// v3: nested/scripted Lua defs + legacy `.fbi` name resolution.
const BUILDPIC_CACHE_VERSION: u32 = 3;

/// Read up to this many bytes of a candidate texture before decoding (build pics
/// are tiny; this is a generous safety bound).
const BUILDPIC_READ_CAP: usize = 8 * 1024 * 1024;

/// Extensions tried under `unitpics/`, in the engine's resolution order.
const BUILDPIC_EXTS: &[&str] = &["dds", "png", "tga", "bmp"];

/// Legacy `.fbi` unit files are small TDF text; cap the read generously.
const FBI_READ_CAP: usize = 256 * 1024;

/// A unit's fields read from its unitdef: the `buildpic` filename (may be empty)
/// and the human-friendly `name` (may be empty).
#[derive(Default, Clone)]
struct UnitFields {
    buildpic: String,
    name: String,
}

/// Lua run through the parser to read each requested unit's `buildpic` filename
/// and human-friendly `name` from its unitdef, returning a flat `unit\tbuildpic\tname`
/// string (one line per unit) in the `result` field that `run_lua_source` reads.
///
/// Games vary in how they ship unit defs, so this handles both shapes:
///  - a flat `units/<name>.lua` (self-contained tables, e.g. Balanced Annihilation),
///    tried first as a fast path; and
///  - defs nested under `units/<subfolder>/` that call gamedata helper globals
///    (`lowerkeys`, `Shared`) the game normally injects — we predefine those so the
///    files evaluate, then recurse to find each wanted unit.
///
/// `__WANT__` is replaced with the `['name']=true,` set to look for.
const BUILDPIC_SCRIPT: &str = r#"
-- Helpers some games' unit files expect; without them VFS.Include on those defs
-- raises and yields nothing. A benign auto-stub stands in for `Shared` etc.
function lowerkeys(t)
  if type(t) ~= 'table' then return t end
  local o = {}
  for k, v in pairs(t) do
    if type(k) == 'string' then k = string.lower(k) end
    o[k] = lowerkeys(v)
  end
  return o
end
local function stub()
  return setmetatable({}, { __index = function() return stub() end,
                            __call = function() return stub() end })
end
if Shared == nil then Shared = stub() end

local want = { __WANT__ }
local found = {}
local remaining = 0
for _ in pairs(want) do remaining = remaining + 1 end
local budget = 4000

-- Record any wanted unit defined in `def` (its internal name is a table key).
local function take(def)
  if type(def) ~= 'table' then return end
  for k, v in pairs(def) do
    if type(v) == 'table' then
      local key = string.lower(tostring(k))
      if want[key] and not found[key] then
        local bp = type(v.buildpic) == 'string' and v.buildpic or ''
        local nm = type(v.name) == 'string' and v.name or ''
        found[key] = bp .. '\t' .. nm
        remaining = remaining - 1
      end
    end
  end
end

-- Fast path: flat units/<name>.lua.
for name in pairs(want) do
  local ok, def = pcall(VFS.Include, 'units/' .. name .. '.lua')
  if ok then take(def) end
end

-- Recursive fallback: defs nested under units/<subfolder>/.
local function scan(dir, depth)
  if remaining <= 0 or budget <= 0 or depth > 6 then return end
  if VFS.DirList then
    for _, f in ipairs(VFS.DirList(dir, '*.lua')) do
      if remaining <= 0 or budget <= 0 then break end
      budget = budget - 1
      local ok, def = pcall(VFS.Include, f)
      if ok then take(def) end
    end
  end
  if remaining <= 0 or budget <= 0 then return end
  if VFS.SubDirs then
    for _, sd in ipairs(VFS.SubDirs(dir, '*')) do
      if remaining <= 0 or budget <= 0 then break end
      scan(sd, depth + 1)
    end
  end
end
if remaining > 0 then scan('units/', 0) end

local parts = {}
for name in pairs(want) do
  parts[#parts + 1] = name .. '\t' .. (found[name] or '\t')
end
return { result = table.concat(parts, '\n') }
"#;

fn build_buildpic_script(units: &[String]) -> String {
    // Unit internal names are alnum/underscore, so a single-quoted key is safe.
    let want: String = units
        .iter()
        .map(|u| format!("['{}']=true,", u.to_lowercase()))
        .collect();
    BUILDPIC_SCRIPT.replace("__WANT__", &want)
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

/// Find an archive member whose path equals or ends with `/<target_lc>`
/// (case-insensitive: `list` holds `(lowercased, actual)` pairs, `target_lc` is
/// already lowercase). Returns the actual stored path.
fn find_member(list: &[(String, String)], target_lc: &str) -> Option<String> {
    let suffix = format!("/{target_lc}");
    list.iter()
        .find(|(lower, _)| lower == target_lc || lower.ends_with(&suffix))
        .map(|(_, real)| real.clone())
}

/// Pull the friendly `name` and `buildpic` out of a legacy TDF unit file (`.fbi`).
/// TDF is `key=value;` with case-insensitive keys and `//` line comments; each unit
/// file describes one unit, so we take the first top-level `name=`/`buildpic=`.
fn parse_fbi_fields(text: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut buildpic = None;
    for line in text.lines() {
        let line = line
            .split("//")
            .next()
            .unwrap_or("")
            .trim()
            .trim_end_matches(';')
            .trim();
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let val = v.trim();
        if val.is_empty() {
            continue;
        }
        match k.trim().to_ascii_lowercase().as_str() {
            "name" if name.is_none() => name = Some(val.to_string()),
            "buildpic" if buildpic.is_none() => buildpic = Some(val.to_string()),
            _ => {}
        }
    }
    (name, buildpic)
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
                let mut name = uf.name;
                let mut buildpic = uf.buildpic;
                // Legacy TDF games (e.g. XTA) store units as `.fbi` text, which is
                // not Lua — unitsync can't process them and the Lua pass finds
                // nothing. Read name/buildpic straight from the unit's `.fbi`.
                if name.is_empty() || buildpic.is_empty() {
                    if let Some(actual) =
                        find_member(&list, &format!("{}.fbi", unit.to_lowercase()))
                    {
                        if let Some((_, bytes)) =
                            us.read_archive_member(handle, &actual, FBI_READ_CAP)
                        {
                            let (fnm, fbp) = parse_fbi_fields(&String::from_utf8_lossy(&bytes));
                            if name.is_empty() {
                                if let Some(x) = fnm {
                                    name = x;
                                }
                            }
                            if buildpic.is_empty() {
                                if let Some(x) = fbp {
                                    buildpic = x;
                                }
                            }
                        }
                    }
                }
                let icon = candidate_members(unit, &buildpic)
                    .into_iter()
                    .find_map(|cand| {
                        let actual = list
                            .iter()
                            .find(|(lower, _)| *lower == cand.to_lowercase())
                            .map(|(_, real)| real.clone())?;
                        read_and_encode(&us, handle, &actual)
                    });
                let display = UnitDisplay {
                    name: Some(name).filter(|s| !s.is_empty()),
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
    fn parses_fbi_name_and_buildpic() {
        let fbi = "[UNITINFO]\n{\n\tside=Arm;\n\tname=Commander;\n\t\
                   description=Commander;\n\tunitname=arm_commander;\n\t\
                   buildpic=arm_commander.DDS;\n\tmaxdamage=3000;\n}\n";
        let (name, buildpic) = parse_fbi_fields(fbi);
        assert_eq!(name.as_deref(), Some("Commander"));
        assert_eq!(buildpic.as_deref(), Some("arm_commander.DDS"));
    }

    #[test]
    fn fbi_ignores_comments_and_missing_fields() {
        let (name, buildpic) = parse_fbi_fields("// name=Nope;\nunitname=x;\n");
        assert_eq!(name, None);
        assert_eq!(buildpic, None);
    }

    #[test]
    fn find_member_matches_nested_case_insensitively() {
        let list = vec![
            (
                "units/tarm_commander.fbi".into(),
                "Units/Tarm_commander.fbi".into(),
            ),
            (
                "units/arm_commander.fbi".into(),
                "Units/arm_commander.fbi".into(),
            ),
        ];
        // Exact basename match wins; the `T`-prefixed sibling must not match.
        assert_eq!(
            find_member(&list, "arm_commander.fbi").as_deref(),
            Some("Units/arm_commander.fbi")
        );
    }

    #[test]
    fn build_script_covers_flat_and_nested_layouts() {
        let s = build_buildpic_script(&["armcom".into(), "corcom".into()]);
        assert!(s.contains("['armcom']=true") && s.contains("['corcom']=true"));
        assert!(s.contains("VFS.Include")); // flat fast path
        assert!(s.contains("VFS.SubDirs")); // recursive fallback
        assert!(s.contains("lowerkeys")); // gamedata helper shim
        assert!(s.contains(".buildpic") && s.contains(".name"));
        assert!(s.contains("result ="));
    }
}
