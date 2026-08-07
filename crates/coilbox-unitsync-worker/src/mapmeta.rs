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

use crate::ffi::Unitsync;
use crate::infocache;
use crate::model::{MapMeta, MapMetaOutput};
use std::path::Path;

/// Read every map's `mapinfo` metadata in one `Init`, serving cache hits from
/// `cache_dir`.
pub fn read_all(lib: &str, cache_dir: Option<&Path>) -> MapMetaOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MapMetaOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
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
        errors.extend(
            us.drain_errors()
                .into_iter()
                .map(|e| format!("{name}: {e}")),
        );
        let meta = MapMeta {
            name: name.clone(),
            info,
        };
        // An empty read means the archive gave us nothing, so leave it uncached
        // and let a later run try again rather than pinning the gap.
        if !meta.info.is_empty() {
            if let Some((dir, key)) = cache_dir.zip(key.as_deref()) {
                infocache::write(dir, key, &meta);
            }
        }
        maps.push(meta);
    }

    us.uninit();
    MapMetaOutput { maps, errors }
}
