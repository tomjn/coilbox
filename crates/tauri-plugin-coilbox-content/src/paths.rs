//! Per-OS resolution of standard Spring/Recoil data-root locations.
//!
//! `candidate_roots` is a pure function over [`BaseDirs`] + an explicit [`Os`]
//! (not `cfg!`) so the Windows/Linux/macOS branches are all unit-testable from
//! any host. The command layer (`lib.rs`) gathers the real `BaseDirs` from the
//! environment and tauri path APIs.
//!
//! Path families come from: pr-downloader (`~/.spring` | `My Documents\My Games\
//! Spring`), springlobby's slpaths.cpp (same download dir), skylobby
//! (`~/.skylobby/spring`), the spring(6) data-dir search order, and BAR/Zero-K
//! installer locations.

use crate::steam;
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Linux,
    Mac,
    Windows,
}

pub fn current_os() -> Os {
    if cfg!(target_os = "windows") {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Mac
    } else {
        Os::Linux
    }
}

/// Filesystem anchors used to build candidate roots. All optional: a missing
/// anchor simply drops the candidates that depend on it.
#[derive(Default, Clone)]
pub struct BaseDirs {
    /// `$HOME` (unix/mac) or `%USERPROFILE%` (windows).
    pub home: Option<PathBuf>,
    /// "My Documents" — from tauri `document_dir()` (handles Windows redirection).
    pub documents: Option<PathBuf>,
    /// `%LOCALAPPDATA%` (windows) via tauri `local_data_dir()`.
    pub local_data: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME` or `$HOME/.config` (unix).
    pub config: Option<PathBuf>,
    /// `%ProgramData%` (windows "All Users").
    pub program_data: Option<PathBuf>,
    /// `%ProgramFiles(x86)%` (windows, for Steam/Zero-K).
    pub program_files_x86: Option<PathBuf>,
    /// `$SPRING_WRITEDIR` if set.
    pub spring_writedir: Option<PathBuf>,
    /// `$SPRING_DATADIR` split on the OS path separator.
    pub spring_datadir: Vec<PathBuf>,
    /// Whether to probe Steam/Zero-K locations (off by default; a UI pref).
    pub include_zerok: bool,
    /// Steam library folders found on this machine, each holding a `steamapps`.
    /// Filled by the command layer (see [`crate::steam::library_dirs`]) when the
    /// Zero-K probe is on, because finding them means reading Steam's own config.
    pub steam_libraries: Vec<PathBuf>,
}

pub struct Candidate {
    pub path: PathBuf,
    pub origin: String,
}

fn push(out: &mut Vec<Candidate>, path: Option<PathBuf>, origin: &str) {
    if let Some(p) = path {
        out.push(Candidate {
            path: p,
            origin: origin.to_string(),
        });
    }
}

/// The single OS-standard content-root path to offer for quick-create: the
/// pr-downloader default write dir (Windows `Documents\My Games\Spring`,
/// otherwise `~/.spring`). Mirrors the `prd-default` candidate in `candidate_roots`.
pub fn standard_root_path(os: Os, b: &BaseDirs) -> Option<PathBuf> {
    candidate_roots(os, b)
        .into_iter()
        .find(|c| c.origin == "prd-default")
        .map(|c| c.path)
}

/// Compute all standard candidate roots for `os` given `b`. Results may contain
/// duplicate paths under different origins; the caller dedupes by canonical path.
pub fn candidate_roots(os: Os, b: &BaseDirs) -> Vec<Candidate> {
    let mut out = Vec::new();
    let home = b.home.clone();
    let docs = b.documents.clone();

    // pr-downloader default write path; springlobby uses the same dir.
    let prd_default = match os {
        Os::Windows => docs.as_ref().map(|d| d.join("My Games").join("Spring")),
        _ => home.as_ref().map(|h| h.join(".spring")),
    };
    push(&mut out, prd_default.clone(), "prd-default");
    push(&mut out, prd_default, "springlobby");

    // skylobby's default isolation dir.
    push(
        &mut out,
        home.as_ref().map(|h| h.join(".skylobby").join("spring")),
        "skylobby",
    );

    // spring(6) config/data dirs.
    match os {
        Os::Windows => {
            push(
                &mut out,
                docs.as_ref().map(|d| d.join("My Games").join("Spring")),
                "spring-config",
            );
            push(
                &mut out,
                docs.as_ref().map(|d| d.join("Spring")),
                "spring-config",
            );
            push(
                &mut out,
                b.program_data
                    .as_ref()
                    .map(|p| p.join("Applications").join("Spring")),
                "spring-config",
            );
        }
        _ => {
            push(
                &mut out,
                b.config.as_ref().map(|c| c.join("spring")),
                "spring-config",
            );
            push(
                &mut out,
                home.as_ref().map(|h| h.join(".spring")),
                "spring-config",
            );
        }
    }

    // Beyond All Reason installer locations.
    let bar = match os {
        Os::Windows => b
            .local_data
            .as_ref()
            .map(|l| l.join("Programs").join("Beyond-All-Reason").join("data")),
        Os::Linux => home
            .as_ref()
            .map(|h| h.join("Documents").join("Beyond All Reason")),
        Os::Mac => home.as_ref().map(|h| h.join(".spring")),
    };
    push(&mut out, bar, "bar");

    // Beyond All Reason / BAR-Lobby "assets" data dir (newer Electron launcher).
    // Layout: engine/<version>/, packages/, pool/, maps/, games/, rapid/ — already
    // recognised by `classify`/`discover_engines`. macOS is best-effort (BAR ships
    // no official macOS build yet).
    let bar_assets = match os {
        Os::Windows => b
            .local_data
            .as_ref()
            .map(|l| l.join("Programs").join("BeyondAllReason").join("assets")),
        Os::Linux => home.as_ref().map(|h| {
            h.join(".local")
                .join("share")
                .join("BeyondAllReason")
                .join("assets")
        }),
        Os::Mac => home.as_ref().map(|h| {
            h.join("Library")
                .join("Application Support")
                .join("BeyondAllReason")
                .join("assets")
        }),
    };
    push(&mut out, bar_assets, "bar-assets");

    // Zero-K via Steam (opt-in). Steam installs it at
    // `<library>/steamapps/common/Zero-K` and runs it in isolation mode, so that
    // folder is the whole data root. A machine can have libraries on any drive, so
    // probe every one the command layer found as well as the default install
    // folders (issue #1695).
    if b.include_zerok {
        let mut libraries = steam::default_install_dirs(os, b);
        for lib in &b.steam_libraries {
            if !libraries.contains(lib) {
                libraries.push(lib.clone());
            }
        }
        for lib in libraries {
            push(
                &mut out,
                Some(lib.join("steamapps").join("common").join("Zero-K")),
                "zerok",
            );
        }
    }

    // Engine-honored environment overrides.
    push(&mut out, b.spring_writedir.clone(), "SPRING_WRITEDIR");
    for d in &b.spring_datadir {
        push(&mut out, Some(d.clone()), "SPRING_DATADIR");
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn base() -> BaseDirs {
        BaseDirs {
            home: Some(PathBuf::from("/home/u")),
            documents: Some(PathBuf::from("C:\\Users\\u\\Documents")),
            local_data: Some(PathBuf::from("C:\\Users\\u\\AppData\\Local")),
            config: Some(PathBuf::from("/home/u/.config")),
            program_data: Some(PathBuf::from("C:\\ProgramData")),
            program_files_x86: Some(PathBuf::from("C:\\Program Files (x86)")),
            spring_writedir: None,
            spring_datadir: vec![],
            include_zerok: false,
            steam_libraries: vec![],
        }
    }

    fn origins_for(os: Os, b: &BaseDirs, path: &str) -> Vec<String> {
        candidate_roots(os, b)
            .into_iter()
            .filter(|c| c.path.as_path() == Path::new(path))
            .map(|c| c.origin)
            .collect()
    }

    #[test]
    fn linux_dotspring_has_multiple_origins() {
        let o = origins_for(Os::Linux, &base(), "/home/u/.spring");
        assert!(o.contains(&"prd-default".to_string()));
        assert!(o.contains(&"springlobby".to_string()));
        assert!(o.contains(&"spring-config".to_string()));
    }

    #[test]
    fn windows_uses_my_games_spring() {
        let cands = candidate_roots(Os::Windows, &base());
        // Build expected paths via the same `join` so separators match on any host.
        let my_games = PathBuf::from("C:\\Users\\u\\Documents")
            .join("My Games")
            .join("Spring");
        assert!(cands.iter().any(|c| c.path == my_games));
        // BAR installer dir under LocalAppData.
        let bar = PathBuf::from("C:\\Users\\u\\AppData\\Local")
            .join("Programs")
            .join("Beyond-All-Reason")
            .join("data");
        assert!(cands.iter().any(|c| c.path == bar));
    }

    #[test]
    fn mac_bar_is_dotspring() {
        let o = origins_for(Os::Mac, &base(), "/home/u/.spring");
        assert!(o.contains(&"bar".to_string()));
    }

    #[test]
    fn bar_assets_dir_per_os() {
        // Linux: ~/.local/share/BeyondAllReason/assets
        let linux = PathBuf::from("/home/u")
            .join(".local")
            .join("share")
            .join("BeyondAllReason")
            .join("assets");
        assert!(candidate_roots(Os::Linux, &base())
            .iter()
            .any(|c| c.origin == "bar-assets" && c.path == linux));
        // Windows: %LOCALAPPDATA%\Programs\BeyondAllReason\assets
        let win = PathBuf::from("C:\\Users\\u\\AppData\\Local")
            .join("Programs")
            .join("BeyondAllReason")
            .join("assets");
        assert!(candidate_roots(Os::Windows, &base())
            .iter()
            .any(|c| c.origin == "bar-assets" && c.path == win));
        // macOS: ~/Library/Application Support/BeyondAllReason/assets
        let mac = PathBuf::from("/home/u")
            .join("Library")
            .join("Application Support")
            .join("BeyondAllReason")
            .join("assets");
        assert!(candidate_roots(Os::Mac, &base())
            .iter()
            .any(|c| c.origin == "bar-assets" && c.path == mac));
    }

    #[test]
    fn zerok_only_when_opted_in() {
        let mut b = base();
        assert!(!candidate_roots(Os::Linux, &b)
            .iter()
            .any(|c| c.origin == "zerok"));
        b.include_zerok = true;
        assert!(candidate_roots(Os::Linux, &b)
            .iter()
            .any(|c| c.origin == "zerok"));
    }

    #[test]
    fn zerok_is_probed_in_every_steam_library() {
        // The common Windows case behind issue #1695: Steam is where the installer
        // put it, but the game is in a library on a second drive.
        let mut b = base();
        b.include_zerok = true;
        b.steam_libraries = vec![
            PathBuf::from("C:\\Program Files (x86)").join("Steam"),
            PathBuf::from("D:\\SteamLibrary"),
        ];
        let zerok: Vec<PathBuf> = candidate_roots(Os::Windows, &b)
            .into_iter()
            .filter(|c| c.origin == "zerok")
            .map(|c| c.path)
            .collect();
        let default = PathBuf::from("C:\\Program Files (x86)")
            .join("Steam")
            .join("steamapps")
            .join("common")
            .join("Zero-K");
        let second_drive = PathBuf::from("D:\\SteamLibrary")
            .join("steamapps")
            .join("common")
            .join("Zero-K");
        assert_eq!(zerok, vec![default, second_drive]);
    }

    #[test]
    fn standard_root_path_is_prd_default() {
        let b = BaseDirs {
            home: Some(PathBuf::from("/home/u")),
            documents: Some(PathBuf::from("/home/u/Documents")),
            ..BaseDirs::default()
        };
        assert_eq!(
            standard_root_path(Os::Windows, &b),
            Some(PathBuf::from("/home/u/Documents/My Games/Spring"))
        );
        assert_eq!(
            standard_root_path(Os::Linux, &b),
            Some(PathBuf::from("/home/u/.spring"))
        );
    }

    #[test]
    fn spring_env_overrides_included() {
        let mut b = base();
        b.spring_writedir = Some(PathBuf::from("/srv/spring"));
        b.spring_datadir = vec![PathBuf::from("/data/a"), PathBuf::from("/data/b")];
        let cands = candidate_roots(Os::Linux, &b);
        assert!(
            cands
                .iter()
                .any(|c| c.origin == "SPRING_WRITEDIR"
                    && c.path.as_path() == Path::new("/srv/spring"))
        );
        assert_eq!(
            cands
                .iter()
                .filter(|c| c.origin == "SPRING_DATADIR")
                .count(),
            2
        );
    }
}
