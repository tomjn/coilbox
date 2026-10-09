//! Batch `mapinfo` metadata for the whole map list, in one `Init` session.
//!
//! This is the third tier of the content scan. The list itself (names, file names,
//! archives) is free once `Init` has built the archive index, and minimaps carry
//! the map proportions, but `GetMapInfoEx` opens each map's archive and costs
//! about 86ms a map. Reading it here rather than during enumeration keeps the maps
//! grid from waiting on roughly six seconds of work per hundred maps.
//!
//! Results are disk cached per map, so only genuinely new or replaced archives do
//! any work on later launches. As with the other batch modes, one unreadable map
//! is recorded as an error and the rest of the list still comes back.
//!
//! A map that read cleanly and held nothing is saved as empty. The plugin answers
//! this call from disk only when every map has a saved record, so one map left
//! unsaved would send the whole call to a worker on every launch (issue #3736).
//! A read that raised errors is not saved, since that can be a failure that a
//! later run gets past.

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{MapMeta, MapMetaOutput};
use std::path::Path;

/// Read every map's `mapinfo` metadata in one `Init`, serving cache hits from
/// `cache_dir`.
pub fn read_all(lib: &str, cache_dir: Option<&Path>) -> MapMetaOutput {
    match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(us) => read_all_in(&us, cache_dir),
        Err(e) => MapMetaOutput {
            errors: vec![e],
            ..Default::default()
        },
    }
}

/// Whether a read is worth saving: it gave something, or it gave nothing and
/// raised nothing, which is a map that really has no metadata.
fn worth_saving(info_is_empty: bool, errors_raised: bool) -> bool {
    !info_is_empty || !errors_raised
}

/// [`read_all`] over a library that is already loaded.
fn read_all_in(us: &Unitsync, cache_dir: Option<&Path>) -> MapMetaOutput {
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let mut maps = Vec::new();
    for i in 0..us.map_count() {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        let key = infocache::map_meta_key(&us, &name);
        let cached = cache_dir
            .zip(key.as_deref())
            .and_then(|(dir, key)| infocache::read::<MapMeta>(dir, key));
        if let Some(hit) = cached {
            maps.push(hit);
            continue;
        }

        let info = us.map_info(i);
        // Drain after the accessor so diagnostics attach to this map.
        let raised = us.drain_errors();
        let errors_raised = !raised.is_empty();
        errors.extend(raised.into_iter().map(|e| format!("{name}: {e}")));
        let meta = MapMeta {
            name: name.clone(),
            info,
        };
        if worth_saving(meta.info.is_empty(), errors_raised) {
            if let Some((dir, key)) = cache_dir.zip(key.as_deref()) {
                infocache::write(dir, key, &meta);
            }
        }
        maps.push(meta);
    }

    us.uninit();
    MapMetaOutput { maps, errors }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::stub::{install, World};

    #[test]
    fn an_empty_read_is_saved_only_when_nothing_went_wrong() {
        assert!(worth_saving(false, false));
        assert!(worth_saving(false, true), "a read that gave something");
        assert!(worth_saving(true, false), "a map that really holds nothing");
        assert!(
            !worth_saving(true, true),
            "an empty read that raised errors"
        );
    }

    #[test]
    fn a_map_that_read_empty_is_saved_and_the_plugin_answers_from_it() {
        let dir = std::env::temp_dir().join(format!("coilbox-mapmeta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let cache = dir.join("cache");
        // The stand-in has no `GetMapInfoCount`, so every map reads empty, cleanly.
        let mut world = World::with_map(&dir.join("content"));
        world.archives.clear();
        install(world);
        let us = Unitsync::stub();

        let out = read_all_in(&us, Some(&cache));
        assert_eq!(out.maps.len(), 1);
        assert!(out.maps[0].info.is_empty() && out.errors.is_empty());

        let named = coilbox_unitsync_worker::cached::MapRef {
            name: World::MAP.into(),
            archive_path: None,
            file_name: Some("maps/stubmap.smf".into()),
        };
        let answered = coilbox_unitsync_worker::cached::map_metas(&cache, &[named])
            .expect("the saved empty record is an answer");
        assert_eq!(answered.maps[0].name, World::MAP);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
