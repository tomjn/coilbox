//! `--unit-icons` mode: the icon type each unit draws on the map, and each
//! icon type's picture and size.
//!
//! The engine defines map icons in two places. A unit names its type in the
//! `iconType` field of its definition, and the game's `gamedata/icontypes.lua`
//! returns a table of types, each with a `bitmap` and a `size`. A game builds
//! that table with Lua code, so it has to be run, and games often set `iconType`
//! while post-processing their unit definitions, so the unit files cannot be read
//! as text either. This runs `gamedata/defs.lua`, the route `--unit-defs` takes,
//! with the game's archives mounted, and reads the finished definitions.
//!
//! The pictures are written as PNG files to the build icon cache directory, so
//! the webview fetches them over `coilbox://unitsyncbuildpic/` as it does build
//! pictures, and a record beside them names every file. A second call for the
//! same game is answered from that record.

use crate::ffi::Unitsync;
use coilbox_unitsync_worker::cached::{read_unit_icons, unit_icons_record_name};
use coilbox_unitsync_worker::cachekey;
use coilbox_unitsync_worker::model::{IconPictureSkip, IconType, UnitIconsOutput};
use std::collections::BTreeMap;
use std::path::Path;

/// VFS modes for the parser: the same set the other def reads use, so
/// `VFS.Include` reaches the game's own files and the base `springcontent` ones.
const VFS_ALL_MODES: &str = "rmMbe";

/// The most bytes read of one icon picture. They are small PNGs and DDS files,
/// and this is a safety bound.
const PICTURE_READ_CAP: usize = 8 * 1024 * 1024;

/// What the engine draws for the type `default` when the game's table does not
/// define one (`CIconHandler`, `rts/Rendering/IconHandler.cpp`). It is in the
/// engine's base content, which every game mounts.
const DEFAULT_BITMAP: &str = "bitmaps/defaultradardot.png";

/// The type a unit has when it names none, or names one the game does not define.
const DEFAULT_TYPE: &str = "default";

/// The Lua that reads the unit and icon type tables, with
/// [`crate::lua::CHUNKED_RESULT`] and [`crate::lua::DEFS_ENV_SHIM`] prepended.
///
/// It hands back tab separated lines, one record each:
///
///  - `U`, the unit's lowercase name and its `iconType` (empty when it has none)
///  - `T`, an icon type's name, `bitmap`, `size`, and `1` when the type draws a
///    part of its picture (`u0`, `v0`, `u1`, `v1` other than the whole) or `0`
///  - `N`, a note: something that failed, in words
///
/// A unit's `iconType` is matched whatever the case of the key. The engine reads
/// the type's own keys exactly as written, so those are too.
const ICONS_SCRIPT: &str = r#"
local function clean(v)
  return (string.gsub(tostring(v), '[\t\r\n]', ' '))
end
local lines = {}
local function note(message)
  lines[#lines + 1] = 'N\t' .. clean(message)
end

local ok, defs = pcall(VFS.Include, 'gamedata/defs.lua')
if not ok then
  note('could not read gamedata/defs.lua: ' .. tostring(defs))
else
  local units = (type(defs) == 'table') and defs.unitdefs or nil
  if type(units) ~= 'table' then
    note('gamedata/defs.lua produced no unitdefs table')
  else
    for name, def in pairs(units) do
      if type(name) == 'string' and type(def) == 'table' then
        local icon = ''
        for field, value in pairs(def) do
          if type(field) == 'string' and string.lower(field) == 'icontype' and type(value) == 'string' then
            icon = value
          end
        end
        lines[#lines + 1] = 'U\t' .. clean(string.lower(name)) .. '\t' .. clean(icon)
      end
    end
  end
end

local typesOk, types = pcall(VFS.Include, 'gamedata/icontypes.lua')
if not typesOk then
  note('could not read gamedata/icontypes.lua: ' .. tostring(types))
elseif type(types) == 'table' then
  for name, def in pairs(types) do
    if type(name) == 'string' and type(def) == 'table' then
      local function moved(key, whole)
        local value = tonumber(def[key])
        return value ~= nil and value ~= whole
      end
      local part = (moved('u0', 0) or moved('v0', 0) or moved('u1', 1) or moved('v1', 1)) and 1 or 0
      local bitmap = type(def.bitmap) == 'string' and def.bitmap or ''
      lines[#lines + 1] = 'T\t' .. clean(name) .. '\t' .. clean(bitmap) .. '\t' .. clean(tonumber(def.size) or 1) .. '\t' .. part
    end
  end
end

return __cb_chunk(table.concat(lines, '\n'))
"#;

/// One icon type as the game's table defines it.
struct TypeDef {
    bitmap: String,
    size: f32,
    sub_image: bool,
}

/// What [`ICONS_SCRIPT`] read: the type each unit names (empty when it names
/// none), the game's types, and what went wrong.
#[derive(Default)]
struct IconDefs {
    unit_types: BTreeMap<String, String>,
    types: BTreeMap<String, TypeDef>,
    notes: Vec<String>,
}

fn icons_script() -> String {
    format!(
        "{}{}{ICONS_SCRIPT}",
        crate::lua::CHUNKED_RESULT,
        crate::lua::DEFS_ENV_SHIM
    )
}

/// Parse the lines [`ICONS_SCRIPT`] returns. A line it does not know is dropped.
fn parse_icon_lines(raw: &str) -> IconDefs {
    let mut defs = IconDefs::default();
    for line in raw.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        match fields.as_slice() {
            ["U", unit, named] => {
                defs.unit_types
                    .insert((*unit).to_string(), (*named).to_string());
            }
            ["T", name, bitmap, size, part] => {
                let size = size.parse::<f32>().ok().filter(|s| s.is_finite());
                defs.types.insert(
                    (*name).to_string(),
                    TypeDef {
                        bitmap: (*bitmap).to_string(),
                        size: size.unwrap_or(1.0),
                        sub_image: *part == "1",
                    },
                );
            }
            ["N", note] => defs.notes.push((*note).to_string()),
            _ => {}
        }
    }
    defs
}

/// The PNG file an icon type's picture is written to: the game's key, then a hash
/// of the type's name, since a name can hold characters a file name cannot and
/// two names that differ only in those must not share a file.
fn picture_file_name(base: &str, type_name: &str) -> String {
    let hash = crate::assetencode::sha256_hex(type_name.as_bytes());
    format!("{base}_icontype_{}.png", &hash[..16])
}

/// Turn what the Lua read into the answer, writing each type's picture into
/// `dir`. `read` gives the bytes of a file in the game's file system.
fn build(
    defs: IconDefs,
    base: &str,
    dir: &Path,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> UnitIconsOutput {
    let mut type_defs = defs.types;
    // The engine adds this type itself when the game defines none.
    type_defs
        .entry(DEFAULT_TYPE.to_string())
        .or_insert_with(|| TypeDef {
            bitmap: DEFAULT_BITMAP.to_string(),
            size: 1.0,
            sub_image: false,
        });

    let unit_types = defs
        .unit_types
        .into_iter()
        .map(|(unit, named)| {
            let resolved = if type_defs.contains_key(&named) {
                named
            } else {
                DEFAULT_TYPE.to_string()
            };
            (unit, resolved)
        })
        .collect();

    let types = type_defs
        .iter()
        .map(|(name, def)| (name.clone(), picture(name, def, base, dir, read)))
        .collect();

    UnitIconsOutput {
        unit_types,
        types,
        errors: Vec::new(),
    }
}

/// One type's picture as a PNG file in `dir`, or the reason there is none.
fn picture(
    name: &str,
    def: &TypeDef,
    base: &str,
    dir: &Path,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> IconType {
    let skipped = |why| IconType {
        file: None,
        size: def.size,
        skipped: Some(why),
    };
    if def.sub_image {
        return skipped(IconPictureSkip::SubImage);
    }
    let bitmap = def.bitmap.trim();
    let Some(raw) = (!bitmap.is_empty()).then(|| read(bitmap)).flatten() else {
        return skipped(IconPictureSkip::NoSource);
    };
    let ext = bitmap.rsplit('.').next().unwrap_or("");
    let Some(decoded) = crate::texture::decode_texture(ext, &raw) else {
        return skipped(IconPictureSkip::Undecodable);
    };
    let Some(png) = crate::texture::encode_icon_png(decoded) else {
        return skipped(IconPictureSkip::EncodeFailed);
    };
    let file = picture_file_name(base, name);
    if std::fs::create_dir_all(dir).is_err() || std::fs::write(dir.join(&file), &png).is_err() {
        return skipped(IconPictureSkip::NotWritten);
    }
    IconType {
        file: Some(file),
        size: def.size,
        skipped: None,
    }
}

/// Load `game_archive` and resolve its unit icon types.
pub fn render(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> UnitIconsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitIconsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init_game(game_archive);
    let out = resolve(&us, game_archive, cache_dir);
    us.uninit();
    out
}

/// Resolve a game's unit icon types in a session the caller has already
/// initialised. A cache hit returns before the archive set is mounted, and
/// otherwise the archive set is mounted for the read and unmounted before this
/// returns.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    cache_dir: Option<&Path>,
) -> UnitIconsOutput {
    let mut errors = us.drain_errors();
    let failed = |errors: Vec<String>| UnitIconsOutput {
        errors,
        ..Default::default()
    };

    let Some(dir) = cache_dir else {
        errors.push("no cache directory, so there is nowhere to write the icon pictures".into());
        return failed(errors);
    };
    let Some(stamp) = crate::infocache::archive_stamp(us, game_archive) else {
        errors.push(format!("could not find the archive {game_archive}"));
        return failed(errors);
    };
    let base = cachekey::unit_icons_key(&stamp);
    if let Some(hit) = read_unit_icons(dir, &base) {
        return hit;
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        return failed(errors);
    }
    errors.extend(us.drain_errors());

    let defs = match us.run_lua_source(&icons_script(), VFS_ALL_MODES) {
        Ok(raw) => parse_icon_lines(&raw),
        Err(e) => {
            errors.push(format!("could not read this game's icon types: {e}"));
            IconDefs::default()
        }
    };
    let notes = defs.notes.clone();
    errors.extend(notes.iter().cloned());

    let mut out = build(defs, &base, dir, &|path| {
        us.read_vfs_file(path, PICTURE_READ_CAP)
    });
    errors.extend(us.drain_errors());
    us.remove_all_archives();

    // A read that found no units or that raised is not an answer: the key stays
    // the same across retries, so remembering it would make the failure last.
    if !out.unit_types.is_empty() && notes.is_empty() {
        write_record(dir, &base, &out);
    }
    out.errors = errors;
    out
}

/// Best-effort write of the record that answers the next call. The pictures it
/// names are already on disk, and the record carries no errors.
fn write_record(dir: &Path, base: &str, out: &UnitIconsOutput) {
    let record = UnitIconsOutput {
        unit_types: out.unit_types.clone(),
        types: out.types.clone(),
        errors: Vec::new(),
    };
    if let Ok(json) = serde_json::to_string(&record) {
        let _ = std::fs::write(dir.join(unit_icons_record_name(base)), json);
    }
}

/// Print a unit-icons error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = UnitIconsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fixture game on disk: the files its icon types name, and a
    /// `gamedata/icontypes.lua` that builds its table with code, as real games do.
    ///
    /// Two icon types with a unit each (`commander`, `kbot`), a unit that names no
    /// type, a unit that names one the game does not define, and a type whose
    /// picture is not in the game (`ghost`). The game defines no `default`, so it
    /// is the engine's, whose picture is in the base content.
    fn fixture(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("coilbox-uniticons-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("gamedata")).unwrap();
        std::fs::create_dir_all(root.join("icons")).unwrap();
        std::fs::create_dir_all(root.join("bitmaps")).unwrap();

        let png = |shade: u8, side: u32| {
            coilbox_texture::encode_png(&image::RgbaImage::from_pixel(
                side,
                side,
                image::Rgba([shade, shade, shade, 255]),
            ))
            .unwrap()
        };
        std::fs::write(root.join("icons/commander.png"), png(250, 32)).unwrap();
        std::fs::write(root.join("icons/kbot.png"), png(128, 16)).unwrap();
        std::fs::write(root.join("bitmaps/defaultradardot.png"), png(10, 4)).unwrap();
        std::fs::write(
            root.join("gamedata/icontypes.lua"),
            "local types = {}\n\
             for _, name in ipairs({ 'commander', 'kbot' }) do\n\
               types[name] = { bitmap = 'icons/' .. name .. '.png', size = 1.5 }\n\
             end\n\
             types.ghost = { bitmap = 'icons/ghost.png', size = 2 }\n\
             return types\n",
        )
        .unwrap();
        root
    }

    /// Run [`ICONS_SCRIPT`] in a plain Lua 5.1 with `gamedata/defs.lua` stubbed
    /// to a handful of finished definitions and every other file read from
    /// `root`, so what reaches Rust is what the Lua wrote.
    fn run_script(root: &Path) -> String {
        let lua = mlua::Lua::new();
        lua.globals().set("root", root.to_string_lossy()).unwrap();
        lua.load(
            r#"
            Spring = { Echo = function() end, Log = function() end }
            Engine = { gameSpeed = 30 }
            VFS = { Include = function(name)
              if name == 'gamedata/defs.lua' then
                return { unitdefs = {
                  ARMCOM = { name = 'Commander', iconType = 'commander' },
                  armpw = { name = 'Peewee', icontype = 'kbot' },
                  armsolar = { name = 'Solar' },
                  armmystery = { name = 'Mystery', iconType = 'not_in_the_game' },
                  armghost = { name = 'Ghost', iconType = 'ghost' },
                } }
              end
              return assert(loadfile(root .. '/' .. name))()
            end }
            "#,
        )
        .exec()
        .unwrap();
        let out: mlua::Table = lua.load(icons_script()).eval().unwrap();
        out.get::<String>("result1").unwrap()
    }

    fn read_from(root: &Path) -> impl Fn(&str) -> Option<Vec<u8>> + '_ {
        move |path| std::fs::read(root.join(path)).ok()
    }

    #[test]
    fn a_fixture_game_gives_each_unit_a_type_and_each_type_a_picture_and_size() {
        let root = fixture("fixture");
        let cache = root.join("cache");
        let defs = parse_icon_lines(&run_script(&root));
        assert!(defs.notes.is_empty(), "notes: {:?}", defs.notes);

        let out = build(defs, "abc", &cache, &read_from(&root));

        // A unit has the type it names, whatever the case of the key, under its
        // lowercase name. One that names none or an unknown one is `default`.
        let of = |unit: &str| out.unit_types[unit].as_str();
        assert_eq!(of("armcom"), "commander");
        assert_eq!(of("armpw"), "kbot");
        assert_eq!(of("armsolar"), "default");
        assert_eq!(of("armmystery"), "default");
        assert_eq!(of("armghost"), "ghost");

        // Each type has its picture, written untinted, and its size.
        let commander = &out.types["commander"];
        assert_eq!(commander.size, 1.5);
        let png = std::fs::read(cache.join(commander.file.as_ref().unwrap())).unwrap();
        let pixels = crate::texture::decode_texture("png", &png).unwrap();
        assert_eq!(pixels.get_pixel(0, 0).0, [250, 250, 250, 255]);
        assert_ne!(commander.file, out.types["kbot"].file);

        // The engine's own `default` is there because the game defines none.
        assert!(out.types["default"].file.is_some());
        assert_eq!(out.types["default"].size, 1.0);

        // A type whose picture is missing says so and costs nothing else.
        let ghost = &out.types["ghost"];
        assert_eq!(ghost.file, None);
        assert_eq!(ghost.skipped, Some(IconPictureSkip::NoSource));
        assert_eq!(ghost.size, 2.0);

        // Every type a unit names is in the answer.
        for named in out.unit_types.values() {
            assert!(out.types.contains_key(named), "{named} has no entry");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_game_with_its_own_default_type_keeps_it() {
        let defs = parse_icon_lines("U\tarmcom\t\nT\tdefault\ticons/mine.png\t3\t0\n");
        let root = fixture("owndefault");
        std::fs::write(
            root.join("icons/mine.png"),
            coilbox_texture::encode_png(&image::RgbaImage::from_pixel(
                8,
                8,
                image::Rgba([1, 2, 3, 255]),
            ))
            .unwrap(),
        )
        .unwrap();
        let out = build(defs, "abc", &root.join("cache"), &read_from(&root));
        assert_eq!(out.unit_types["armcom"], "default");
        assert_eq!(out.types["default"].size, 3.0);
        assert!(out.types["default"].file.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_picture_that_cannot_be_read_is_reported_apart_from_a_missing_one() {
        let root = fixture("undecodable");
        std::fs::write(root.join("icons/ghost.png"), b"not a png").unwrap();
        let defs = parse_icon_lines("T\tghost\ticons/ghost.png\t1\t0\nT\tnone\t\t1\t0\n");
        let out = build(defs, "abc", &root.join("cache"), &read_from(&root));
        assert_eq!(
            out.types["ghost"].skipped,
            Some(IconPictureSkip::Undecodable)
        );
        assert_eq!(out.types["none"].skipped, Some(IconPictureSkip::NoSource));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_type_that_draws_part_of_a_picture_is_left_without_one() {
        let root = fixture("subimage");
        let defs = parse_icon_lines("T\tcommander\ticons/commander.png\t1\t1\n");
        let out = build(defs, "abc", &root.join("cache"), &read_from(&root));
        assert_eq!(out.types["commander"].file, None);
        assert_eq!(
            out.types["commander"].skipped,
            Some(IconPictureSkip::SubImage)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn types_with_awkward_names_get_their_own_files() {
        assert_ne!(
            picture_file_name("abc", "a/b"),
            picture_file_name("abc", "a_b")
        );
        assert_eq!(
            picture_file_name("abc", "a/b"),
            picture_file_name("abc", "a/b")
        );
        assert!(picture_file_name("abc", "kbot").starts_with("abc_icontype_"));
    }

    #[test]
    fn lines_the_script_did_not_write_are_dropped() {
        let defs = parse_icon_lines("U\tarmcom\tcommander\nnonsense\nT\tx\ty\n\nN\tit broke\n");
        assert_eq!(defs.unit_types.len(), 1);
        assert!(defs.types.is_empty());
        assert_eq!(defs.notes, ["it broke"]);
    }

    #[test]
    fn a_size_that_is_not_a_number_reads_as_the_engine_default() {
        let defs = parse_icon_lines("T\ta\tx.png\tinf\t0\nT\tb\tx.png\tnonsense\t0\n");
        assert_eq!(defs.types["a"].size, 1.0);
        assert_eq!(defs.types["b"].size, 1.0);
    }

    /// The record the first call writes is what the second is answered from, and
    /// a cache clean that takes a picture turns the answer into a miss.
    #[test]
    fn the_record_answers_the_next_call_until_a_picture_is_cleaned() {
        let root = fixture("record");
        let cache = root.join("cache");
        let defs = parse_icon_lines(&run_script(&root));
        let out = build(defs, "abc", &cache, &read_from(&root));
        write_record(&cache, "abc", &out);

        let again = read_unit_icons(&cache, "abc").expect("a hit");
        assert_eq!(again.unit_types, out.unit_types);
        assert_eq!(again.types, out.types);

        let commander = out.types["commander"].file.clone().unwrap();
        std::fs::remove_file(cache.join(commander)).unwrap();
        assert!(read_unit_icons(&cache, "abc").is_none());
        assert!(read_unit_icons(&cache, "another").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The plugin answers from the record given only the game archive's path.
    #[test]
    fn the_plugin_finds_the_record_by_the_game_archive_alone() {
        let root = fixture("plugin");
        let cache = root.join("cache");
        let archive = root.join("game.sdz");
        std::fs::write(&archive, b"a game").unwrap();
        let base = cachekey::unit_icons_key(&cachekey::ArchiveStamp::of(&archive).unwrap());
        let defs = parse_icon_lines(&run_script(&root));
        write_record(
            &cache,
            &base,
            &build(defs, &base, &cache, &read_from(&root)),
        );

        let answered = coilbox_unitsync_worker::cached::unit_icons(&cache, &archive).expect("hit");
        assert_eq!(answered.unit_types["armcom"], "commander");

        // A changed archive is a different game as far as the cache can tell.
        std::fs::write(&archive, b"a longer game archive").unwrap();
        assert!(coilbox_unitsync_worker::cached::unit_icons(&cache, &archive).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
