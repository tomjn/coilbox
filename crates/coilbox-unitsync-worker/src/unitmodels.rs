//! `--unit-models` mode: read a batch of units' models out of one game archive
//! in one mount (issue #1684).
//!
//! `--unit-model` reads one model and mounts the game's archive set to do it. A
//! blueprint names ten or twenty buildings, and on a game like Beyond All Reason
//! a mount is a second or more, so a layout the hub has no renders for spent
//! twenty of them drawing itself. Here the mount, the member listing, the
//! `teamtex.txt` read and the texture cache are all paid once for the list, the
//! shape `--unit-render-keys` already uses.
//!
//! Only the units the have check came back wanting are ever asked for, so this is
//! not what opening a seeded game costs. It is what opening a game nobody has
//! uploaded before costs, which is the case worth being good at.
//!
//! ## Why this hands back file names rather than models
//!
//! A flattened model is positions, normals and UVs as JSON numbers, which is
//! megabytes for one unit. Handing twenty back inline would put the whole batch
//! through the IPC bridge at once, which is the thing `--unit-render-keys`
//! deliberately avoided by answering with digests instead of bytes. So each model
//! is written into the model-texture cache dir, beside the textures it names, and
//! the webview reads it back over the same asset protocol root it already loads
//! those from.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::ffi::Unitsync;
use crate::model::{UnitModelFile, UnitModelsOutput};

/// Read every model in `objects` out of `game_archive`, writing each into
/// `cache_dir`.
///
/// `objects` are unitdef `objectname` fields verbatim, so they are any case and
/// usually carry no extension. The cache directory is required: the files are the
/// output, and there is nothing to report without somewhere to put them.
pub fn render(
    lib: &str,
    game_archive: &str,
    objects: &[String],
    cache_dir: &Path,
) -> UnitModelsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitModelsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let out = resolve(&us, game_archive, objects, cache_dir);
    us.uninit();
    out
}

/// Read the models in a session the caller has already initialised, mounting the
/// game's archive set once for the whole batch and unmounting before it returns.
///
/// Split out the way the other batch modes are, so a walk over several games can
/// cover them all in one `Init`.
pub(crate) fn resolve(
    us: &Unitsync,
    game_archive: &str,
    objects: &[String],
    cache_dir: &Path,
) -> UnitModelsOutput {
    let mut errors = us.drain_errors();
    if objects.is_empty() {
        return UnitModelsOutput {
            errors,
            ..Default::default()
        };
    }

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        return UnitModelsOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    let handle = crate::archive::resolve_open_path(us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        us.remove_all_archives();
        errors.push(format!("could not open archive {game_archive}"));
        return UnitModelsOutput {
            errors,
            ..Default::default()
        };
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();

    let teamtex = crate::unitmodel::read_teamtex(us, handle, &list);
    let key_base = crate::unitmodel::cache_key_base(us, game_archive);
    let mut models = BTreeMap::new();
    let mut skipped = BTreeMap::new();

    match key_base {
        Some(base) => {
            let cache = Some((cache_dir, base.as_str()));
            // One read per distinct model, since a game's hats, wrecks and
            // re-skins all name the same `.s3o`, and re-reading a shared 64 MiB
            // texture atlas per unit would be the whole cost of the batch.
            let mut read: BTreeMap<String, Result<UnitModelFile, String>> = BTreeMap::new();
            let mut written: BTreeSet<String> = BTreeSet::new();
            for object in objects {
                let answer = read
                    .entry(object.trim().to_lowercase())
                    .or_insert_with(|| {
                        let model = crate::unitmodel::read_model(
                            us,
                            handle,
                            &list,
                            &teamtex,
                            cache,
                            game_archive,
                            object,
                        );
                        write_model(cache_dir, &base, model, &mut written)
                    })
                    .clone();
                match answer {
                    Ok(file) => {
                        models.insert(object.clone(), file);
                    }
                    Err(why) => {
                        skipped.insert(object.clone(), why);
                    }
                }
            }
        }
        None => errors.push(format!(
            "could not work out a cache key for {game_archive}, so there is nowhere to keep its models"
        )),
    }

    us.close_archive(handle);
    errors.extend(us.drain_errors());
    us.remove_all_archives();

    UnitModelsOutput {
        models,
        skipped,
        errors,
    }
}

/// Write one flattened model into the cache dir, named after the archive member
/// it came from, and say where it went.
///
/// Named after the member rather than the `objectname` so two units naming one
/// model write one file, and so a name the archive does not hold cannot collide
/// with one it does. `written` is what stops the second of those two units
/// re-serialising megabytes of JSON over the first.
fn write_model(
    cache_dir: &Path,
    base: &str,
    model: crate::model::UnitModelOutput,
    written: &mut BTreeSet<String>,
) -> Result<UnitModelFile, String> {
    if model.root.is_none() {
        return Err(if model.errors.is_empty() {
            "no model".to_string()
        } else {
            model.errors.join("; ")
        });
    }
    let file = crate::unitmodel::cache_file_name(base, &model.path, "json");
    let out = UnitModelFile {
        file: file.clone(),
        path: model.path.clone(),
        format: model.format.clone(),
    };
    if !written.insert(file.clone()) {
        return Ok(out);
    }
    let json = serde_json::to_vec(&model).map_err(|e| format!("could not write {file}: {e}"))?;
    std::fs::create_dir_all(cache_dir)
        .and_then(|()| std::fs::write(cache_dir.join(&file), &json))
        .map_err(|e| format!("could not write {file}: {e}"))?;
    Ok(out)
}

/// Print a unit-models error envelope to stdout (used on the panic path in main).
pub fn emit_error(msg: String) {
    let out = UnitModelsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ModelPiece, UnitModelOutput};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-unitmodels-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn model(path: &str) -> UnitModelOutput {
        UnitModelOutput {
            format: "s3o".into(),
            path: path.into(),
            root: Some(ModelPiece::default()),
            ..Default::default()
        }
    }

    /// The file is named after the member, so it lands beside the textures it
    /// names and the webview can read it over the same protocol root.
    #[test]
    fn a_model_is_written_as_json_named_after_its_archive_member() {
        let dir = temp_dir("write");
        let mut written = BTreeSet::new();
        let out = write_model(&dir, "abcd", model("Objects3D/armcom.s3o"), &mut written).unwrap();

        assert_eq!(out.file, "abcd_objects3d_armcom_s3o.json");
        assert_eq!(out.path, "Objects3D/armcom.s3o");
        assert_eq!(out.format, "s3o");
        let raw = std::fs::read_to_string(dir.join(&out.file)).expect("the model file was written");
        let back: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(back["path"], "Objects3D/armcom.s3o");
        assert!(back["root"].is_object(), "{back}");
    }

    /// Two units on one model are one file, and the second does not re-serialise
    /// megabytes of JSON over the first.
    #[test]
    fn one_model_is_written_once_however_many_units_name_it() {
        let dir = temp_dir("shared");
        let mut written = BTreeSet::new();
        let first = write_model(&dir, "abcd", model("objects3d/wreck.s3o"), &mut written).unwrap();
        std::fs::write(dir.join(&first.file), b"the first write").unwrap();
        let second = write_model(&dir, "abcd", model("objects3d/wreck.s3o"), &mut written).unwrap();

        assert_eq!(first.file, second.file);
        assert_eq!(
            std::fs::read_to_string(dir.join(&second.file)).unwrap(),
            "the first write"
        );
    }

    /// A unit whose model the archive does not hold is skipped and says so,
    /// rather than naming a file with nothing in it.
    #[test]
    fn a_model_that_did_not_read_is_skipped_with_its_reason() {
        let dir = temp_dir("missing");
        let mut written = BTreeSet::new();
        let out = write_model(
            &dir,
            "abcd",
            UnitModelOutput {
                errors: vec!["BA.sdz has no model for \"hats/missing\"".into()],
                ..Default::default()
            },
            &mut written,
        );
        assert_eq!(out.unwrap_err(), "BA.sdz has no model for \"hats/missing\"");
        assert!(written.is_empty());
    }

    /// The shape the caller reads: the field names the binding expects.
    #[test]
    fn the_output_names_its_fields_the_way_the_caller_reads_them() {
        let json = serde_json::to_string(&UnitModelsOutput {
            models: BTreeMap::from([(
                "ARMCOM".to_string(),
                UnitModelFile {
                    file: "abcd_objects3d_armcom_s3o.json".into(),
                    path: "Objects3D/armcom.s3o".into(),
                    format: "s3o".into(),
                },
            )]),
            skipped: BTreeMap::from([("hats/missing".to_string(), "no model".to_string())]),
            errors: Vec::new(),
        })
        .unwrap();
        assert!(json.contains("\"models\""), "{json}");
        assert!(json.contains("\"ARMCOM\""), "{json}");
        assert!(json.contains("\"file\""), "{json}");
        assert!(json.contains("\"skipped\""), "{json}");
    }

    /// Nothing asked for is nothing mounted, which is the case a run with every
    /// render already on the hub takes.
    #[test]
    fn an_empty_list_reads_nothing() {
        let dir = temp_dir("empty");
        let out = render("nolib", "Nothing.sdd", &[], &dir);
        assert!(out.models.is_empty());
        assert!(out.skipped.is_empty());
    }
}
