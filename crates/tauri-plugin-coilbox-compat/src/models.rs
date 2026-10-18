//! The base game's `.3do` models, converted into the compat mutator, and the
//! file that points its units, features and weapons at them (issue #4557).
//!
//! The worker's batch converter (`--convert-3do`) writes `objects3d/**.s3o`
//! and one sheet per model folder under `unittextures/3do/`, into a staging
//! folder. Those files are copied into the mutator as they are.
//!
//! The base game's `.3do` files are still there under the mutator, and the
//! engine tries `.3do` before `.s3o` for a model named with no extension
//! (`CModelLoader::FindModelPath`, `rts/Rendering/Models/IModelParser.cpp`).
//! So every def whose model was converted has to name the `.s3o`, not only
//! those that spell `.3do`.
//!
//! That is done in `gamedata/defs_post.lua`, not in `unitdefs_post.lua`. A
//! mutator's file covers up the base game's file of the same name, and the
//! definition parser has no way to reach the one covered up. XTA 9.65 ships a
//! `unitdefs_post.lua` that reads the mod options and trims build menus, and
//! Balanced Annihilation ships both post files. No game checked ships a
//! `defs_post.lua`. The engine's own `gamedata/defs.lua` loads it after every
//! def table is built, and the engine's own copy of it, which drops unused move
//! classes, is still reachable through `VFS.BASE` because it lives in the base
//! content rather than in a game.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri_plugin_coilbox_workshop::{lua_string, CompiledFile};

/// The file the converted models are named in.
pub const DEFS_POST: &str = "gamedata/defs_post.lua";

/// The folder the converter writes models under, matching
/// `coilbox_unitsync_worker::unitmodel::MODEL_DIR`.
const MODEL_DIR: &str = "objects3d";

/// What the converter said about one game.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversion {
    /// Every `.3do` under the game's `objects3d/`.
    pub models_found: usize,
    /// How many became an `.s3o`.
    pub models_written: usize,
    /// Models the reader refused, by archive member, with what it said.
    pub unreadable: BTreeMap<String, String>,
    /// Models left unconverted because a tile they name did not fit on a sheet.
    pub did_not_fit: Vec<String>,
    pub errors: Vec<String>,
}

/// The converter's result line, as `Convert3doOutput` in the worker spells it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Answer {
    #[serde(default)]
    models_found: usize,
    #[serde(default)]
    models_written: usize,
    #[serde(default)]
    unreadable: BTreeMap<String, String>,
    #[serde(default)]
    groups: Vec<Group>,
    #[serde(default)]
    errors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    #[serde(default)]
    did_not_fit: Vec<String>,
}

/// One game's converted models, ready to copy into its mutator.
#[derive(Debug, Default)]
pub struct Models {
    /// Where the converter wrote them, or `None` when nothing was converted.
    pub dir: Option<PathBuf>,
    pub conversion: Conversion,
    /// Why the models are not used, when they cannot be. Empty is the ordinary
    /// case.
    pub notes: Vec<String>,
}

/// Why `gamedata/defs_post.lua` in the mutator could not point the game's defs
/// at converted models, from the base game's own `gamedata/defs.lua` and
/// `gamedata/defs_post.lua`, or `None` when it can.
pub fn hook_problem(defs: Option<&str>, defs_post: Option<&str>) -> Option<String> {
    if defs_post.is_some() {
        return Some(format!(
            "The game ships its own {DEFS_POST}, which the mutator's would cover up, so its models are not converted."
        ));
    }
    if defs.is_some_and(|text| !text.to_ascii_lowercase().contains("defs_post")) {
        return Some(format!(
            "The game's own gamedata/defs.lua never loads {DEFS_POST}, so its models are not converted."
        ));
    }
    None
}

/// Convert the `.3do` models in `archive` into `staging`, through the worker.
///
/// Reads the base game's two def entry points first, and converts nothing when
/// [`hook_problem`] says the converted models could not be used.
pub fn convert(
    engine_path: &str,
    data_dir: &str,
    archive: &str,
    staging: &Path,
) -> Result<Models, String> {
    convert_reading(
        |file| {
            tauri_plugin_coilbox_unitsync::archive_text_blocking(
                engine_path,
                data_dir,
                archive,
                file,
            )
        },
        || {
            tauri_plugin_coilbox_unitsync::convert_3do_blocking(
                engine_path,
                data_dir,
                archive,
                &staging.to_string_lossy(),
            )
        },
        staging,
    )
}

/// [`convert`], with `read` returning a file of the base game by path and
/// `run` converting its models into `staging` and answering with the
/// converter's result line.
pub fn convert_reading(
    read: impl Fn(&str) -> Result<Option<String>, String>,
    run: impl FnOnce() -> Result<String, String>,
    staging: &Path,
) -> Result<Models, String> {
    let defs = read("gamedata/defs.lua")?;
    let defs_post = read(DEFS_POST)?;
    if let Some(why) = hook_problem(defs.as_deref(), defs_post.as_deref()) {
        return Ok(Models {
            notes: vec![why],
            ..Models::default()
        });
    }
    let conversion = parse_conversion(&run()?)?;
    Ok(Models {
        dir: Some(staging.to_path_buf()),
        conversion,
        notes: Vec::new(),
    })
}

/// The converter's result line, or an error when it converted nothing and said
/// why.
pub fn parse_conversion(line: &str) -> Result<Conversion, String> {
    let a: Answer = serde_json::from_str(line)
        .map_err(|e| format!("could not read the 3do converter's answer: {e}"))?;
    if a.models_written == 0 && !a.errors.is_empty() {
        return Err(format!(
            "the 3do converter wrote nothing: {}",
            a.errors.join("; ")
        ));
    }
    let mut did_not_fit: Vec<String> = a.groups.into_iter().flat_map(|g| g.did_not_fit).collect();
    did_not_fit.sort();
    Ok(Conversion {
        models_found: a.models_found,
        models_written: a.models_written,
        unreadable: a.unreadable,
        did_not_fit,
        errors: a.errors,
    })
}

/// Every file under `dir`, relative to it with forward slashes, sorted.
pub fn list(dir: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    walk(dir, dir, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk(root: &Path, at: &Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries =
        std::fs::read_dir(at).map_err(|e| format!("could not read {}: {e}", at.display()))?;
    for entry in entries {
        let path = entry
            .map_err(|e| format!("could not read {}: {e}", at.display()))?
            .path();
        if path.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
        let parts = parts.ok_or_else(|| format!("{} is not a UTF-8 path", path.display()))?;
        out.push(parts.join("/"));
    }
    Ok(())
}

/// Each converted model in `files`, as the key [`defs_post`] looks it up by:
/// the path below `objects3d/`, lowercased, without its extension.
pub fn model_keys(files: &[String]) -> BTreeSet<String> {
    files
        .iter()
        .filter_map(|path| {
            let lower = path.to_lowercase();
            let rest = lower.strip_prefix(MODEL_DIR)?.strip_prefix('/')?;
            rest.strip_suffix(".s3o").map(str::to_string)
        })
        .collect()
}

/// `gamedata/defs_post.lua`, pointing every unit, feature and weapon whose
/// model is in `models` at the converted `.s3o`, or `None` when nothing was
/// converted. `n` is the manifest it was built from.
pub fn defs_post(models: &BTreeSet<String>, n: u32) -> Option<CompiledFile> {
    if models.is_empty() {
        return None;
    }
    let table: String = models
        .iter()
        .map(|key| format!("  [{}] = true,\n", lua_string(key)))
        .collect();
    let contents = format!(
        "-- Written by coilbox's compatibility mode. Rebuilt from compat manifest {n}, so do not edit it.\n\
         -- license: {license}\n\
         --\n\
         -- Points every def whose model was converted at the .s3o. The base game's\n\
         -- .3do is still there, and the engine tries .3do first for a name with no\n\
         -- extension.\n\
         \n\
         local converted = {{\n{table}}}\n\
         \n\
         local function s3o(name)\n\
         \x20 if type(name) ~= \"string\" then return nil end\n\
         \x20 local path = name:gsub(\"\\\\\", \"/\")\n\
         \x20 local ext = path:lower():match(\"%.([^./]*)$\")\n\
         \x20 if ext == \"3do\" then\n\
         \x20   path = path:sub(1, -5)\n\
         \x20 elseif ext ~= nil and ext ~= \"\" then\n\
         \x20   return nil\n\
         \x20 end\n\
         \x20 local key = path:lower():gsub(\"^objects3d/\", \"\")\n\
         \x20 if converted[key] then\n\
         \x20   return path .. \".s3o\"\n\
         \x20 end\n\
         \x20 return nil\n\
         end\n\
         \n\
         -- The keys are not lowercased yet, so a def may spell objectName.\n\
         local function repoint(defs, field)\n\
         \x20 if type(defs) ~= \"table\" then return end\n\
         \x20 for _, def in pairs(defs) do\n\
         \x20   if type(def) == \"table\" then\n\
         \x20     for key, value in pairs(def) do\n\
         \x20       if type(key) == \"string\" and key:lower() == field then\n\
         \x20         local model = s3o(value)\n\
         \x20         if model then\n\
         \x20           def[key] = model\n\
         \x20         end\n\
         \x20       end\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         end\n\
         \n\
         repoint(DEFS.unitDefs, \"objectname\")\n\
         repoint(DEFS.featureDefs, \"object\")\n\
         repoint(DEFS.weaponDefs, \"model\")\n\
         \n\
         -- The engine's own copy of this file, which this one covers up. Not a\n\
         -- tail call: VFS.Include reads its caller's environment, which a tail\n\
         -- call has already dropped.\n\
         local base = VFS.BASE or \"b\"\n\
         if VFS.FileExists({path}, base) then\n\
         \x20 local engine_defs_post = VFS.Include({path}, nil, base)\n\
         \x20 return engine_defs_post\n\
         end\n\
         return {{}}\n",
        license = coilbox_compat::LICENSE,
        path = lua_string(DEFS_POST),
    );
    Some(CompiledFile {
        path: DEFS_POST.into(),
        contents,
    })
}

/// Copy `files`, relative to `from`, into `to`.
pub fn copy(from: &Path, files: &[String], to: &Path) -> Result<(), String> {
    for file in files {
        let (src, dst) = (from.join(file), to.join(file));
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::copy(&src, &dst).map_err(|e| format!("could not copy {file}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(paths: &[&str]) -> BTreeSet<String> {
        model_keys(&paths.iter().map(|p| p.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn a_model_is_keyed_by_its_path_below_objects3d() {
        assert_eq!(
            keys(&[
                "Objects3D/ARMCOM.s3o",
                "objects3d/arm/Mech.S3O",
                "unittextures/3do/objects3d.png",
                "objects3d/readme.txt",
            ]),
            BTreeSet::from(["armcom".to_string(), "arm/mech".to_string()])
        );
    }

    #[test]
    fn nothing_converted_writes_no_file() {
        assert!(defs_post(&BTreeSet::new(), 1).is_none());
    }

    /// Runs the written file over a `DEFS` like the engine's `defs.lua` builds,
    /// with a stand in for the engine's own `defs_post.lua`, and answers with
    /// the `DEFS` it left and what it returned.
    fn run(defs: &str) -> (serde_json::Value, serde_json::Value) {
        let post = defs_post(
            &keys(&["objects3d/armcom.s3o", "objects3d/arm/mech.s3o"]),
            1,
        )
        .expect("a file");
        let root = tempfile::tempdir().unwrap();
        let base = BTreeMap::from([(
            root.path().join(DEFS_POST),
            "return { base = true }\n".to_string(),
        )]);
        let lua = coilbox_springlua::SpringLua::with_files(root.path(), base).unwrap();
        lua.eval_value(&format!("DEFS = {defs}\nreturn {{}}"), "setup")
            .unwrap();
        let returned = lua.eval_value_raw(&post.contents, DEFS_POST).unwrap();
        let after = lua
            .eval_value_raw("return { defs = DEFS }", "check")
            .unwrap();
        (after, returned)
    }

    #[test]
    fn a_3do_name_is_pointed_at_the_s3o() {
        let (after, _) = run(r#"{ unitDefs = { armdrag = { objectname = "ARMCOM.3do" } } }"#);
        assert_eq!(
            after["defs"]["unitDefs"]["armdrag"]["objectname"],
            "ARMCOM.s3o"
        );
    }

    /// The engine tries `.3do` first for a name with no extension, and the
    /// base game's `.3do` is still there.
    #[test]
    fn a_name_with_no_extension_is_pointed_at_the_s3o() {
        let (after, _) = run(
            r#"{ unitDefs = { a = { objectName = "objects3d\\arm\\MECH" } },
                 featureDefs = { b = { object = "ArmCom" } },
                 weaponDefs = { c = { model = "arm/mech.3DO" } } }"#,
        );
        let defs = &after["defs"];
        assert_eq!(
            defs["unitDefs"]["a"]["objectName"],
            "objects3d/arm/MECH.s3o"
        );
        assert!(defs["unitDefs"]["a"].get("objectname").is_none());
        assert_eq!(defs["featureDefs"]["b"]["object"], "ArmCom.s3o");
        assert_eq!(defs["weaponDefs"]["c"]["model"], "arm/mech.s3o");
    }

    #[test]
    fn an_s3o_name_or_a_model_not_converted_is_left_alone() {
        let (after, _) = run(r#"{ unitDefs = { a = { objectname = "armcom.s3o" },
                              b = { objectname = "corcom.3do" },
                              c = { objectname = "corcom" },
                              d = { objectname = "armcom.glb" } } }"#);
        let units = &after["defs"]["unitDefs"];
        assert_eq!(units["a"]["objectname"], "armcom.s3o");
        assert_eq!(units["b"]["objectname"], "corcom.3do");
        assert_eq!(units["c"]["objectname"], "corcom");
        assert_eq!(units["d"]["objectname"], "armcom.glb");
    }

    #[test]
    fn the_engine_s_own_defs_post_still_runs() {
        let (_, returned) = run("{ unitDefs = {} }");
        assert_eq!(returned["base"], true);
    }

    #[test]
    fn the_file_has_lf_endings_and_the_same_bytes_each_time() {
        let models = keys(&["objects3d/b.s3o", "objects3d/a.s3o"]);
        let a = defs_post(&models, 1).unwrap().contents;
        assert_eq!(a, defs_post(&models, 1).unwrap().contents);
        assert!(!a.contains('\r'));
        assert!(a.find("[\"a\"]").unwrap() < a.find("[\"b\"]").unwrap());
    }

    #[test]
    fn a_game_with_its_own_defs_post_or_a_defs_that_skips_it_is_not_converted() {
        assert_eq!(hook_problem(None, None), None);
        assert_eq!(
            hook_problem(Some("LoadDefs('defs_post')"), None),
            None,
            "the engine's own defs.lua loads it"
        );
        assert!(hook_problem(None, Some("return {}")).is_some());
        assert!(hook_problem(Some("LoadDefs('unitDefs')"), None).is_some());
    }

    #[test]
    fn a_conversion_that_wrote_nothing_and_said_why_is_an_error() {
        assert!(parse_conversion(r#"{"errors":["could not open archive x"]}"#).is_err());
        let c = parse_conversion(
            r#"{"modelsFound":3,"modelsWritten":2,"groups":[{"didNotFit":["b (needs t)"]},{"didNotFit":["a (needs t)"]}],"errors":[]}"#,
        )
        .unwrap();
        assert_eq!(c.did_not_fit, ["a (needs t)", "b (needs t)"]);
        let none = parse_conversion(r#"{"modelsFound":0,"modelsWritten":0}"#).unwrap();
        assert_eq!(none.models_found, 0);
    }

    #[test]
    fn every_converted_file_is_listed_and_copied() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        for f in ["objects3d/arm/mech.s3o", "unittextures/3do/objects3d.png"] {
            let p = from.path().join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, f).unwrap();
        }
        let files = list(from.path()).unwrap();
        assert_eq!(
            files,
            ["objects3d/arm/mech.s3o", "unittextures/3do/objects3d.png"]
        );
        copy(from.path(), &files, to.path()).unwrap();
        assert_eq!(list(to.path()).unwrap(), files);
    }
}
