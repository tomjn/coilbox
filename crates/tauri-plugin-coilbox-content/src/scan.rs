//! Filesystem inspection of a candidate root: validation (is it a Spring data
//! root?), cheap content counts, and engine discovery. No binaries are executed
//! here — engine *version* identity is folder-derived; running the binary is a
//! separate explicit step (`engine.rs`).

use crate::model::{Engine, RootCounts, RootKind};
use std::path::{Path, PathBuf};

const ENGINE_BINARIES: &[&str] = &[
    "spring",
    "spring.exe",
    "spring-headless",
    "spring-headless.exe",
];

const MAP_GAME_EXTS: &[&str] = &[".sd7", ".sdz", ".sdd"];

/// First spring binary found directly inside `dir`, if any.
fn spring_binary_in(dir: &Path) -> Option<PathBuf> {
    ENGINE_BINARIES
        .iter()
        .map(|name| dir.join(name))
        .find(|p| p.is_file())
}

/// A basecontent marker indicating a portable/all-in-one install.
fn has_basecontent(dir: &Path) -> bool {
    dir.join("springsettings.cfg").is_file()
        || dir.join("base").is_dir()
        || [
            "libunitsync.dll",
            "unitsync.dll",
            "libunitsync.so",
            "unitsync.so",
        ]
        .iter()
        .any(|n| dir.join(n).is_file())
}

/// True if `engine/` holds at least one (one- or two-level) dir with a binary.
fn engine_dir_has_install(root: &Path) -> bool {
    let engine = root.join("engine");
    let Ok(rd) = std::fs::read_dir(&engine) else {
        return false;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        if spring_binary_in(&p).is_some() {
            return true;
        }
        if let Ok(inner) = std::fs::read_dir(&p) {
            for sub in inner.flatten() {
                let sp = sub.path();
                if sp.is_dir() && spring_binary_in(&sp).is_some() {
                    return true;
                }
            }
        }
    }
    false
}

/// Classify `path`. Returns `None` if it is not a recognizable Spring root.
/// Data-root signals take precedence over the portable shape.
pub fn classify(path: &Path) -> Option<RootKind> {
    if !path.is_dir() {
        return None;
    }
    let has_data_layout = engine_dir_has_install(path)
        || path.join("games").is_dir()
        || path.join("maps").is_dir()
        || (path.join("pool").is_dir() && path.join("packages").is_dir())
        || path.join("rapid").is_dir();
    if has_data_layout {
        return Some(RootKind::Data);
    }
    // Portable / isolation: a spring binary + basecontent in the folder itself.
    if spring_binary_in(path).is_some() && has_basecontent(path) {
        return Some(RootKind::Portable);
    }
    None
}

/// Count archives by extension in `dir`, by filename only (no per-entry stat).
fn count_with_ext(dir: &Path, exts: &[&str]) -> u32 {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    rd.flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            exts.iter().any(|ext| name.ends_with(ext))
        })
        .count() as u32
}

/// Content counts for a root. `pool/` is deliberately never enumerated (it holds
/// thousands of content-addressed `.gz` blobs — a perf trap and not user-facing).
pub fn counts(root: &Path, engines: u32) -> RootCounts {
    RootCounts {
        games: count_with_ext(&root.join("games"), MAP_GAME_EXTS),
        maps: count_with_ext(&root.join("maps"), MAP_GAME_EXTS),
        packages: count_with_ext(&root.join("packages"), &[".sdp"]),
        engines,
    }
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn make_engine(
    root: &Path,
    dir: &Path,
    bin: &Path,
    platform: Option<String>,
    version: String,
) -> Engine {
    Engine {
        id: crate::hash_id(&[
            root.to_string_lossy().as_ref(),
            dir.to_string_lossy().as_ref(),
        ]),
        root_path: crate::display_path(root),
        path: crate::display_path(dir),
        executable: crate::display_path(bin),
        platform,
        version,
        sync_version: None,
        verified_at: None,
    }
}

/// Discover engines under `root`: the `engine/<platform>/<version>/` (and the
/// flatter `engine/<version>/`) layout, plus a single-folder/portable install
/// where the binary sits directly in the root.
pub fn discover_engines(root: &Path) -> Vec<Engine> {
    let mut out = Vec::new();
    let engine = root.join("engine");
    if let Ok(rd) = std::fs::read_dir(&engine) {
        for entry in rd.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            if let Some(bin) = spring_binary_in(&p) {
                // engine/<version>/
                out.push(make_engine(root, &p, &bin, None, file_name(&p)));
                continue;
            }
            // engine/<platform>/<version>/
            let platform = file_name(&p);
            if let Ok(inner) = std::fs::read_dir(&p) {
                for sub in inner.flatten() {
                    let sp = sub.path();
                    if sp.is_dir() {
                        if let Some(bin) = spring_binary_in(&sp) {
                            out.push(make_engine(
                                root,
                                &sp,
                                &bin,
                                Some(platform.clone()),
                                file_name(&sp),
                            ));
                        }
                    }
                }
            }
        }
    }
    // Portable single-folder install: binary in the root itself.
    if let Some(bin) = spring_binary_in(root) {
        out.push(make_engine(root, root, &bin, None, file_name(root)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("content_scan_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn unrelated_folder_is_not_a_root() {
        let d = tmp("plain");
        fs::create_dir_all(d.join("random")).unwrap();
        assert!(classify(&d).is_none());
    }

    #[test]
    fn data_root_detected_via_maps() {
        let d = tmp("data");
        fs::create_dir_all(d.join("maps")).unwrap();
        fs::write(d.join("maps").join("a.sd7"), b"x").unwrap();
        fs::write(d.join("maps").join("b.sdz"), b"x").unwrap();
        fs::create_dir_all(d.join("packages")).unwrap();
        fs::write(d.join("packages").join("h.sdp"), b"x").unwrap();
        assert_eq!(classify(&d), Some(RootKind::Data));
        let c = counts(&d, 0);
        assert_eq!(c.maps, 2);
        assert_eq!(c.packages, 1);
    }

    #[test]
    fn portable_install_detected() {
        let d = tmp("portable");
        fs::write(d.join("spring"), b"#!/bin/true").unwrap();
        fs::write(d.join("springsettings.cfg"), b"").unwrap();
        assert_eq!(classify(&d), Some(RootKind::Portable));
        // and the binary in the root is discovered as an engine
        let engines = discover_engines(&d);
        assert_eq!(engines.len(), 1);
    }

    #[test]
    fn lone_binary_without_basecontent_is_not_a_root() {
        let d = tmp("lonebin");
        fs::write(d.join("spring"), b"x").unwrap();
        assert!(classify(&d).is_none());
    }

    #[test]
    fn engines_discovered_two_level_and_one_level() {
        let d = tmp("engines");
        // engine/<platform>/<version>/spring
        let two = d.join("engine").join("linux64").join("105.0");
        fs::create_dir_all(&two).unwrap();
        fs::write(two.join("spring"), b"x").unwrap();
        // engine/<version>/spring  (flatter)
        let one = d.join("engine").join("104.0");
        fs::create_dir_all(&one).unwrap();
        fs::write(one.join("spring-headless"), b"x").unwrap();
        let engines = discover_engines(&d);
        assert_eq!(engines.len(), 2);
        let two_level = engines.iter().find(|e| e.version == "105.0").unwrap();
        assert_eq!(two_level.platform.as_deref(), Some("linux64"));
        let one_level = engines.iter().find(|e| e.version == "104.0").unwrap();
        assert_eq!(one_level.platform, None);
        // engine/ presence makes it a valid data root
        assert_eq!(classify(&d), Some(RootKind::Data));
    }
}
