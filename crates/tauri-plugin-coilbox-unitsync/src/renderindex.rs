//! An index over the renders coilbox has drawn, so it can find one again
//! (issue #1724).
//!
//! `unitrender.rs` in the worker encodes a top down render into
//! `coilbox-hub-assets` under a name that is the sha256 of its own bytes. That is
//! the right name for the hub, whose object path is the content hash, and it is
//! useless to anybody who has not got the bytes. So a render coilbox drew a
//! moment ago was unfindable, and a plan of somebody's base drew its buildings
//! out of the hub even on the machine that made the pictures.
//!
//! What this adds is one small JSON record per drawn render, in the same folder,
//! named after the thing a reader actually holds: the game, the unit and the
//! angle. The record says which file the pixels are in and what they were drawn
//! from.
//!
//! ## Kept whether or not the picture is sent
//!
//! The record is written when the render is encoded, not when it is uploaded.
//! Renders are only drawn today when picture uploads are switched on, so this
//! does not by itself give pictures to somebody who has never turned them on.
//! But the point of a local copy is working with no hub in the picture, and a
//! cache that only exists for people who opted into uploading has the wrong
//! shape for that. Gating the sending is the upload consent check's job and it
//! still does it.
//!
//! ## Staleness
//!
//! A render goes stale two ways, and the reader is told about both:
//!
//! - **The renderer moved.** `RENDER_VERSION` in `src/hub/assets/renderTop.ts`
//!   names the drawing code. [`look_up`] takes the caller's version and refuses
//!   a record that does not match it, so a bump misses every record ever written.
//!   Free for every reader, because a reader that can draw knows its own version.
//! - **The archive moved.** A game update replaces the model, which moves the
//!   model digest and therefore the `source_hash`. [`look_up`] refuses a record
//!   whose `source_archive` is not the caller's, when the caller names one.
//!
//! The archive check is optional because a reader may not know the archive. A
//! plan on a hub item page holds a modinfo shortname and a list of unit names and
//! nothing else, and the only route to the archive name from there is a unitsync
//! mount, which is not a thing to do on a page load. Such a reader gets the
//! renderer-version check and no more, and can therefore be handed a picture of a
//! model the game has since replaced. What bounds that is the record itself:
//! there is exactly one per (game, unit, variant), so the next draw replaces it
//! rather than adding to it.
//!
//! ## What bounds the folder
//!
//! Nothing did. `coilbox-hub-assets` was in neither the reclaim list in
//! `tauri-plugin-coilbox-content`'s `caches.rs` nor any byte-budget sweep, because
//! its only reader was the uploader and nobody thought of it as a cache. Now that
//! things are kept in order to be read again, it is one, so [`remember`] sweeps it
//! least recently used first on the shared budget in `coilbox-thumb-cache`, and it
//! is in the reclaim list beside the other caches. A record whose picture a sweep
//! took is a miss, the same way a build pic record without its PNG is.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Salts the record name, so a change to what a record holds orphans the old ones
/// rather than reading them as the new shape. Bump when a field a reader relies on
/// is added or changes meaning.
const INDEX_VERSION: u32 = 1;

/// What this folder may take up, least recently used first.
///
/// A render is a few kilobytes: the two on the machine this was written on are
/// 14 KB and 15 KB, and a record is about 330 bytes. So 64 MiB is thousands of
/// units, which is far more than a person opens blueprints for and small next to
/// the 512 MiB the map pictures already get.
const BUDGET: u64 = 64 * 1024 * 1024;

/// What the budget covers.
///
/// Everything in the folder, not only the renders. A backfill's build pics are
/// encoded in here too, waiting for the upload to read them, and a policy that
/// counted only renders would let those grow without bound instead.
///
/// A run's own output is what the budget is spent on first, because the sweep is
/// most recently used first and a run's files are the newest in the folder. So a
/// build pic extracted a second ago cannot be swept out from under the upload that
/// is about to send it, which is the one way this could have gone wrong.
const SUFFIXES: &[&str] = &[".webp", ".png", ".json"];

/// One drawn render, as the index holds it.
///
/// The fields are the encode's own, so a caller passes back what
/// `unitsync_unit_render` handed it rather than assembling anything.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenderRecord {
    /// The game's modinfo shortname, which is what the hub keys a unit picture on
    /// and what a plan asks by. Never an archive name.
    pub game: String,
    /// The unit's internal name, lower cased by the writer.
    pub unit: String,
    /// `render:<angle>`.
    pub variant: String,
    /// The file in this folder, named after the sha256 of its own bytes. Served to
    /// the webview over the `hubasset` root of the `coilbox://` scheme.
    pub file: String,
    pub mime: String,
    /// How the bytes were encoded, which the upload declares. Kept rather than
    /// reconstructed, because a record from a build that encoded renders
    /// differently is a record naming a different profile.
    pub encode_profile: String,
    /// The identity the hub's have check compares on, over the render's inputs.
    pub source_hash: String,
    /// sha256 over the model file and its textures.
    pub model_digest: String,
    /// The name the game archive declares for itself.
    pub source_archive: String,
    /// `RENDER_VERSION`, from the side that drew the pixels.
    pub renderer_version: u32,
    pub width: u32,
    pub height: u32,
}

/// A record and the picture it turned out to name.
///
/// `path` is not stored, because where the cache folder is depends on the machine
/// and on whether this is a portable install. It is filled in by whoever found the
/// record, for a caller that has to hand the bytes on rather than draw them: the
/// uploader takes a path.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundRender {
    #[serde(flatten)]
    pub record: RenderRecord,
    pub path: String,
}

/// The record file for one picture: `<16 hex>.json`, over the game, the unit and
/// the variant.
///
/// Hashed rather than spelled out because a unit's internal name is whatever its
/// game's author typed and a game's shortname is too, and neither is a file name.
/// The unit is lower cased first, because a layout carries whatever its author's
/// game wrote and the dataset the keys were minted from is lower case.
fn stem(game: &str, unit: &str, variant: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    INDEX_VERSION.hash(&mut h);
    game.trim().to_lowercase().hash(&mut h);
    unit.trim().to_lowercase().hash(&mut h);
    variant.hash(&mut h);
    format!("{:016x}.json", h.finish())
}

/// Write `record` into `dir`, replacing whatever was there for the same game,
/// unit and variant, and sweep the folder back inside its budget.
///
/// Best effort, like every other cache write in the app: a render that could not
/// be indexed is still a render that was drawn, encoded and offered to the hub.
/// Returns whether the record reached disk, which is what a test asserts on.
///
/// The picture and its record are both held out of the sweep, because they are the
/// thing that has just been made and the sweep is least recently used.
pub fn remember(dir: &Path, record: &RenderRecord) -> bool {
    remember_within(dir, record, BUDGET)
}

/// [`remember`] on a stated budget, so a test can drive the sweep without writing
/// 64 MiB of renders to find out what it does.
fn remember_within(dir: &Path, record: &RenderRecord, budget: u64) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let path = dir.join(stem(&record.game, &record.unit, &record.variant));
    let Ok(json) = serde_json::to_string(record) else {
        return false;
    };
    let written = std::fs::write(&path, json).is_ok();
    coilbox_thumb_cache::sweep(dir, SUFFIXES, budget, &[path, dir.join(&record.file)]);
    written
}

/// The records `dir` holds for `units`, dropping every one that is stale or whose
/// picture is gone.
///
/// A unit with nothing to answer with is absent from the map rather than null, so
/// a caller finds its answer by finding it.
///
/// Keyed on the lower cased name rather than on the spelling it was asked for. The
/// record is found case-insensitively, so answering in the caller's case would
/// have a caller that asked in one case and reads in another find nothing, which
/// looks exactly like a machine that has drawn nothing.
///
/// `source_archive` is the game's archive as the caller knows it, and `None` means
/// the caller does not know: see this module's note about what that costs.
pub fn look_up(
    dir: &Path,
    game: &str,
    variant: &str,
    renderer_version: u32,
    source_archive: Option<&str>,
    units: &[String],
) -> std::collections::BTreeMap<String, FoundRender> {
    let mut found = std::collections::BTreeMap::new();
    for unit in units {
        let Some(record) = read(dir, game, unit, variant) else {
            continue;
        };
        if record.renderer_version != renderer_version {
            continue;
        }
        if source_archive.is_some_and(|want| want != record.source_archive) {
            continue;
        }
        // A sweep takes the picture and can leave the record, the same way a
        // cleared build pic cache leaves its JSON. A record naming a file that is
        // not there is a miss.
        let picture = dir.join(&record.file);
        if !picture.is_file() {
            continue;
        }
        coilbox_thumb_cache::touch(&picture);
        coilbox_thumb_cache::touch(&record_path(dir, game, unit, variant));
        found.insert(
            unit.trim().to_lowercase(),
            FoundRender {
                record,
                path: picture.to_string_lossy().into_owned(),
            },
        );
    }
    found
}

fn record_path(dir: &Path, game: &str, unit: &str, variant: &str) -> PathBuf {
    dir.join(stem(game, unit, variant))
}

/// One record, or `None` for a miss. A file that is no longer this shape is a miss
/// rather than an error, which is what makes [`INDEX_VERSION`] a salt and not a
/// migration.
fn read(dir: &Path, game: &str, unit: &str, variant: &str) -> Option<RenderRecord> {
    let raw = std::fs::read_to_string(record_path(dir, game, unit, variant)).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARCHIVE: &str = "Beyond All Reason test-30922-8064a43";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-renderindex-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A record with its picture beside it, which is the only state a reader is
    /// meant to find.
    fn drawn(dir: &Path, unit: &str, version: u32, archive: &str) -> RenderRecord {
        let file = format!("{unit}-{version}.webp");
        std::fs::write(dir.join(&file), vec![0u8; 2600]).unwrap();
        RenderRecord {
            game: "bar".into(),
            unit: unit.into(),
            variant: "render:top".into(),
            file,
            mime: "image/webp".into(),
            encode_profile: "webp-q80-256".into(),
            source_hash: format!("hash-of-{unit}"),
            model_digest: format!("digest-of-{unit}"),
            source_archive: archive.into(),
            renderer_version: version,
            width: 255,
            height: 204,
        }
    }

    fn units(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| (*n).to_string()).collect()
    }

    /// The whole point, in one assertion: a render coilbox drew is found again by
    /// the thing a reader actually holds, which is the game and the unit's name.
    #[test]
    fn a_render_that_was_drawn_is_found_again_by_game_and_unit() {
        let dir = temp_dir("roundtrip");
        let record = drawn(&dir, "armsolar", 1, ARCHIVE);
        assert!(remember(&dir, &record));

        let found = look_up(
            &dir,
            "bar",
            "render:top",
            1,
            Some(ARCHIVE),
            &units(&["armsolar"]),
        );
        let hit = found.get("armsolar").expect("the render was found again");
        assert_eq!(hit.record, record);
        // And where the bytes are now, for a caller that has to hand them on
        // rather than draw them.
        assert_eq!(hit.path, dir.join(&record.file).to_string_lossy());
    }

    /// The name is over what the reader has, so the case a layout happens to carry
    /// cannot decide whether the picture is found.
    #[test]
    fn the_case_a_layout_carries_does_not_decide_whether_it_is_found() {
        let dir = temp_dir("case");
        remember(&dir, &drawn(&dir, "armsolar", 1, ARCHIVE));
        for asked in ["ARMSOLAR", "ArmSolar", " armsolar "] {
            let found = look_up(&dir, "BAR", "render:top", 1, None, &units(&[asked]));
            // And answered under the lower cased name whatever was asked for, or
            // a caller that asked in one case and reads in another finds nothing,
            // which looks exactly like a machine that has drawn nothing.
            assert!(
                found.contains_key("armsolar"),
                "{asked:?} answered {found:?}"
            );
            assert_eq!(found.len(), 1, "{asked:?} answered {found:?}");
        }
    }

    /// Invalidation, half one. A stale render looks exactly like a fresh one, so
    /// this is the check that has to be real: a bumped `RENDER_VERSION` misses
    /// every record ever written, and nothing has to go and find that out.
    #[test]
    fn a_bumped_renderer_version_misses_every_record() {
        let dir = temp_dir("version");
        remember(&dir, &drawn(&dir, "armsolar", 1, ARCHIVE));
        let ask = |version| {
            look_up(
                &dir,
                "bar",
                "render:top",
                version,
                None,
                &units(&["armsolar"]),
            )
        };

        assert_eq!(ask(1).len(), 1);
        assert!(ask(2).is_empty(), "a version 1 render answered version 2");

        // And the version 2 render written afterwards replaces it rather than
        // sitting beside it, so the folder holds one picture per unit.
        remember(&dir, &drawn(&dir, "armsolar", 2, ARCHIVE));
        assert!(ask(1).is_empty(), "the replaced record still answers");
        assert_eq!(ask(2).len(), 1);
    }

    /// Invalidation, half two. A game update moves the archive, which moves the
    /// model, so a caller that knows which archive it is looking at is not handed
    /// a picture of the last one.
    #[test]
    fn a_render_of_a_different_archive_is_refused_to_a_caller_that_names_one() {
        let dir = temp_dir("archive");
        remember(&dir, &drawn(&dir, "armsolar", 1, ARCHIVE));
        let ask = |archive| look_up(&dir, "bar", "render:top", 1, archive, &units(&["armsolar"]));

        assert_eq!(ask(Some(ARCHIVE)).len(), 1);
        assert!(ask(Some("Beyond All Reason test-31000-deadbee")).is_empty());
        // And a caller with no archive to name still gets it, which is the
        // deliberate hole this module's note describes.
        assert_eq!(ask(None).len(), 1);
    }

    /// A sweep takes the picture and leaves the record, the same way clearing the
    /// build pic cache does. A record with nothing behind it is a miss, not a
    /// broken image.
    #[test]
    fn a_record_whose_picture_a_sweep_took_is_a_miss() {
        let dir = temp_dir("swept");
        let record = drawn(&dir, "armsolar", 1, ARCHIVE);
        remember(&dir, &record);
        std::fs::remove_file(dir.join(&record.file)).unwrap();

        let found = look_up(&dir, "bar", "render:top", 1, None, &units(&["armsolar"]));
        assert!(found.is_empty());
    }

    /// Two games can name a unit the same thing, and two angles of one unit are
    /// two pictures. Neither may answer for the other.
    #[test]
    fn a_record_only_answers_for_its_own_game_and_angle() {
        let dir = temp_dir("keys");
        remember(&dir, &drawn(&dir, "armsolar", 1, ARCHIVE));

        assert!(look_up(&dir, "sf", "render:top", 1, None, &units(&["armsolar"])).is_empty());
        assert!(look_up(&dir, "bar", "render:side", 1, None, &units(&["armsolar"])).is_empty());
        assert!(look_up(&dir, "bar", "render:top", 1, None, &units(&["armllt"])).is_empty());
    }

    /// A batch answers only for what it holds, so a layout of twelve buildings on
    /// a machine that has drawn three gets three pictures and nine squares.
    #[test]
    fn a_batch_answers_for_what_it_holds_and_says_nothing_about_the_rest() {
        let dir = temp_dir("batch");
        for unit in ["armsolar", "armllt", "armwin"] {
            remember(&dir, &drawn(&dir, unit, 1, ARCHIVE));
        }
        let found = look_up(
            &dir,
            "bar",
            "render:top",
            1,
            Some(ARCHIVE),
            &units(&["armsolar", "armllt", "armwin", "armmex", "armlab"]),
        );
        assert_eq!(found.len(), 3);
        assert!(!found.contains_key("armmex"));
    }

    /// The bound on the folder, driven rather than described.
    ///
    /// The one way this could have gone wrong is the build pics: a backfill
    /// encodes those into this same folder and the upload reads them a moment
    /// later, so a sweep that took one would break a run that was working. It
    /// cannot, because the sweep is most recently used first and a run's own
    /// output is the newest thing in the folder.
    #[test]
    fn a_sweep_spends_the_budget_on_what_the_run_just_made() {
        let dir = temp_dir("sweep");
        // An old corpus: renders and build pics from runs long finished.
        let old: Vec<PathBuf> = (0..4)
            .map(|at| {
                let file = dir.join(format!("old{at}.webp"));
                std::fs::write(&file, vec![0u8; 4000]).unwrap();
                std::fs::File::options()
                    .write(true)
                    .open(&file)
                    .unwrap()
                    .set_modified(
                        std::time::SystemTime::now() - std::time::Duration::from_secs(9000),
                    )
                    .unwrap();
                file
            })
            .collect();
        // And this run: a build pic extracted a moment ago, then a render drawn.
        let pic = dir.join("this-run-buildpic.webp");
        std::fs::write(&pic, vec![0u8; 4000]).unwrap();
        let record = drawn(&dir, "armsolar", 1, ARCHIVE);

        // Room for about two files, so most of the folder has to go.
        assert!(remember_within(&dir, &record, 9000));

        assert!(dir.join(&record.file).is_file(), "the render just drawn");
        assert!(pic.is_file(), "the build pic the upload is about to read");
        assert!(
            look_up(&dir, "bar", "render:top", 1, None, &units(&["armsolar"])).len() == 1,
            "the record just written"
        );
        assert!(
            old.iter().any(|f| !f.exists()),
            "nothing was swept, so the budget is not doing anything"
        );
    }

    /// Nothing at all is a miss rather than a failure. A machine that has never
    /// drawn anything is the ordinary case.
    #[test]
    fn a_folder_that_is_not_there_answers_nothing() {
        let dir = std::env::temp_dir().join("coilbox-renderindex-never-written");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(look_up(&dir, "bar", "render:top", 1, None, &units(&["armsolar"])).is_empty());
    }

    /// A file that is no longer this shape is a miss, which is what makes
    /// `INDEX_VERSION` a salt rather than a migration.
    #[test]
    fn a_record_that_is_not_json_is_a_miss() {
        let dir = temp_dir("garbage");
        let record = drawn(&dir, "armsolar", 1, ARCHIVE);
        remember(&dir, &record);
        std::fs::write(
            dir.join(stem(&record.game, &record.unit, &record.variant)),
            "not json",
        )
        .unwrap();
        assert!(look_up(&dir, "bar", "render:top", 1, None, &units(&["armsolar"])).is_empty());
    }
}
