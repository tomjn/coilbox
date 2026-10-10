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
    us.init_game(game_archive);
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

    // The key needs the archive's path and nothing mounted, so it is worked out
    // first and a unit already written under it is answered from disk (issue
    // #3724).
    let Some(base) = crate::unitmodel::cache_key_base(us, game_archive, Some(cache_dir)) else {
        errors.push(format!(
            "could not work out a cache key for {game_archive}, so there is nowhere to keep its models"
        ));
        return UnitModelsOutput {
            errors,
            ..Default::default()
        };
    };
    let mut models = BTreeMap::new();
    let mut skipped = BTreeMap::new();
    let mut wanted: Vec<&String> = Vec::new();
    for object in objects {
        match crate::unitmodel::read_entry(cache_dir, &base, object) {
            Some(entry) => {
                models.insert(
                    object.clone(),
                    UnitModelFile {
                        file: entry.file,
                        path: entry.path,
                        format: entry.format,
                    },
                );
            }
            None => wanted.push(object),
        }
    }
    if wanted.is_empty() {
        return UnitModelsOutput {
            models,
            skipped,
            errors,
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
    let palette = crate::unitmodel::read_palette(us);
    let fallbacks = crate::unitmodel::fallback_archives(us, game_archive);
    let cache = Some((cache_dir, base.as_str()));
    // One read per distinct model, since a game's hats, wrecks and re-skins all
    // name the same `.s3o`, and re-reading a shared 64 MiB texture atlas per unit
    // would be the whole cost of the batch.
    let mut read: BTreeMap<String, Result<UnitModelFile, String>> = BTreeMap::new();
    let mut written: BTreeSet<String> = BTreeSet::new();
    for object in wanted {
        let answer = read
            .entry(object.trim().to_lowercase())
            .or_insert_with(|| {
                let model = crate::unitmodel::read_model(
                    us,
                    handle,
                    &list,
                    &teamtex,
                    palette.as_ref(),
                    cache,
                    game_archive,
                    object,
                    &fallbacks,
                );
                write_model(cache_dir, &base, object, &model, &mut written)
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

    for archive in fallbacks {
        archive.close(us);
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
pub(crate) fn write_model(
    cache_dir: &Path,
    base: &str,
    object: &str,
    model: &crate::model::UnitModelOutput,
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
    if written.insert(file.clone()) {
        let json = serde_json::to_vec(model).map_err(|e| format!("could not write {file}: {e}"))?;
        let target = cache_dir.join(&file);
        let tmp = cache_dir.join(format!("{file}.{}.tmp", std::process::id()));
        std::fs::create_dir_all(cache_dir)
            .and_then(|()| std::fs::write(&tmp, &json))
            .and_then(|()| std::fs::rename(&tmp, &target))
            .map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                format!("could not write {file}: {e}")
            })?;
    }
    // Per unit, not per file: two units naming one model share the JSON and each
    // needs its own way to find it.
    crate::unitmodel::write_entry(cache_dir, base, object, model, &file);
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
        let out = write_model(
            &dir,
            "abcd",
            "armcom",
            &model("Objects3D/armcom.s3o"),
            &mut written,
        )
        .unwrap();

        assert_eq!(
            out.file,
            format!(
                "v{}-abcd_objects3d_armcom_s3o.json",
                crate::unitmodel::CACHE_VERSION
            )
        );
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
        let first = write_model(
            &dir,
            "abcd",
            "armcom",
            &model("objects3d/wreck.s3o"),
            &mut written,
        )
        .unwrap();
        std::fs::write(dir.join(&first.file), b"the first write").unwrap();
        let second = write_model(
            &dir,
            "abcd",
            "armcom",
            &model("objects3d/wreck.s3o"),
            &mut written,
        )
        .unwrap();

        assert_eq!(first.file, second.file);
        assert_eq!(
            std::fs::read_to_string(dir.join(&second.file)).unwrap(),
            "the first write"
        );
    }

    /// The write lands via a rename, so the final file holds the full content
    /// and no temp file is left behind for a reader to trip over.
    #[test]
    fn a_model_write_leaves_no_temp_file_behind() {
        let dir = temp_dir("atomic");
        let mut written = BTreeSet::new();
        let out = write_model(
            &dir,
            "abcd",
            "armcom",
            &model("objects3d/armcom.s3o"),
            &mut written,
        )
        .unwrap();

        let raw = std::fs::read_to_string(dir.join(&out.file)).expect("the model file was written");
        let back: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(back["path"], "objects3d/armcom.s3o");

        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
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
            "hats/missing",
            &UnitModelOutput {
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

    // ---- a cached batch mounts nothing (issue #3724)

    use crate::ffi::stub::{calls, install, World};

    fn stub_session(tag: &str) -> (Unitsync, std::path::PathBuf) {
        let dir = temp_dir(tag);
        install(World::with_game(&dir.join("games")));
        (Unitsync::stub(), dir.join("cache"))
    }

    #[test]
    fn models_already_written_are_named_without_mounting_the_game() {
        let (us, cache) = stub_session("hit");
        let objects = vec!["ArmCom".to_string(), "armcom".to_string()];
        let fresh = resolve(&us, World::GAME, &objects, &cache);
        assert_eq!(
            fresh.models.len(),
            2,
            "{:?} {:?}",
            fresh.skipped,
            fresh.errors
        );
        assert_eq!(calls("AddAllArchives"), 1, "a miss mounts the game");

        let cached = resolve(&us, World::GAME, &objects, &cache);
        assert_eq!(calls("AddAllArchives"), 1, "a hit mounted the game");
        assert_eq!(calls("OpenArchive"), 1, "a hit opened the archive");
        assert_eq!(
            serde_json::to_value(&fresh).unwrap(),
            serde_json::to_value(&cached).unwrap()
        );
    }

    /// A batch with one unit it has not seen mounts for that unit, and answers
    /// the others from what it wrote.
    #[test]
    fn only_a_model_not_yet_written_costs_a_mount() {
        let (us, cache) = stub_session("partial");
        resolve(&us, World::GAME, &["armcom".to_string()], &cache);
        let both = resolve(
            &us,
            World::GAME,
            &["armcom".to_string(), "missing".to_string()],
            &cache,
        );
        assert_eq!(calls("AddAllArchives"), 2);
        assert!(both.models.contains_key("armcom"));
        assert!(both.skipped.contains_key("missing"));
    }

    /// What a batch writes is what a single model read hits, because the two
    /// share one record per unit.
    #[test]
    fn a_batch_fills_what_a_single_read_hits() {
        let (us, cache) = stub_session("shared");
        resolve(&us, World::GAME, &["armcom".to_string()], &cache);
        let one = crate::unitmodel::render_with(&us, World::GAME, "armcom", Some(&cache));
        assert!(one.root.is_some(), "{:?}", one.errors);
        assert_eq!(
            calls("AddAllArchives"),
            1,
            "the single read mounted the game"
        );
    }

    #[test]
    fn a_changed_archive_is_read_again() {
        let (us, cache) = stub_session("changed");
        let objects = vec!["armcom".to_string()];
        resolve(&us, World::GAME, &objects, &cache);
        let archive = cache.parent().unwrap().join("games").join(World::GAME);
        std::fs::write(&archive, b"a game archive, now a different size").expect("rewrite");

        resolve(&us, World::GAME, &objects, &cache);
        assert_eq!(
            calls("AddAllArchives"),
            2,
            "a changed archive was served from cache"
        );
    }

    // ---- the plugin answers a cached batch itself (issue #3714)

    fn archive_of(cache: &std::path::Path) -> std::path::PathBuf {
        cache.parent().unwrap().join("games").join(World::GAME)
    }

    /// The records the worker wrote are the ones the plugin reads, from the
    /// archive's path alone, and the answer is the one the worker gave.
    #[test]
    fn the_plugin_names_the_models_the_worker_wrote_without_a_worker() {
        let (us, cache) = stub_session("plugin-hit");
        let objects = vec!["ArmCom".to_string(), "armcom".to_string()];
        let fresh = resolve(&us, World::GAME, &objects, &cache);
        assert_eq!(fresh.models.len(), 2, "{:?}", fresh.skipped);

        let answered =
            coilbox_unitsync_worker::cached::unit_models(&cache, &archive_of(&cache), &objects)
                .expect("a hit");
        assert_eq!(
            serde_json::to_value(&fresh).unwrap(),
            serde_json::to_value(&answered).unwrap()
        );
    }

    #[test]
    fn the_plugin_leaves_a_batch_with_an_unseen_unit_to_a_worker() {
        let (us, cache) = stub_session("plugin-partial");
        resolve(&us, World::GAME, &["armcom".to_string()], &cache);
        let asked = vec!["armcom".to_string(), "corcom".to_string()];
        assert!(
            coilbox_unitsync_worker::cached::unit_models(&cache, &archive_of(&cache), &asked)
                .is_none()
        );
    }

    #[test]
    fn the_plugin_leaves_a_changed_archive_to_a_worker() {
        let (us, cache) = stub_session("plugin-changed");
        let objects = vec!["armcom".to_string()];
        resolve(&us, World::GAME, &objects, &cache);
        let archive = archive_of(&cache);
        assert!(coilbox_unitsync_worker::cached::unit_models(&cache, &archive, &objects).is_some());

        std::fs::write(&archive, b"a game archive, now a different size").expect("rewrite");
        assert!(coilbox_unitsync_worker::cached::unit_models(&cache, &archive, &objects).is_none());
    }

    #[test]
    fn the_plugin_leaves_a_model_with_a_swept_texture_to_a_worker() {
        let (us, cache) = stub_session("plugin-texture");
        let objects = vec!["armcom".to_string()];
        resolve(&us, World::GAME, &objects, &cache);
        let texture = std::fs::read_dir(&cache)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .find(|p| p.to_string_lossy().ends_with(".png"))
            .expect("the read stored a texture");
        std::fs::remove_file(texture).unwrap();

        assert!(coilbox_unitsync_worker::cached::unit_models(
            &cache,
            &archive_of(&cache),
            &objects
        )
        .is_none());
    }

    #[test]
    fn a_record_from_an_older_version_is_read_again() {
        let (us, cache) = stub_session("version");
        let objects = vec!["armcom".to_string()];
        resolve(&us, World::GAME, &objects, &cache);
        let record = std::fs::read_dir(&cache)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .find(|p| p.to_string_lossy().ends_with(".entry"))
            .expect("the first read stored a record");
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&record).unwrap()).unwrap();
        value["version"] = serde_json::json!(0);
        std::fs::write(&record, value.to_string()).unwrap();

        resolve(&us, World::GAME, &objects, &cache);
        assert_eq!(calls("AddAllArchives"), 2, "an old record was served");
    }
}
