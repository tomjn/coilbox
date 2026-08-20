//! Finding Steam's library folders, so the Zero-K probe can look in all of them.
//!
//! Steam puts a game in `<library>/steamapps/common/<name>`. Only one library is
//! the Steam install folder itself. The user can add more on any drive, and Steam
//! lists them all in `libraryfolders.vdf`, which it keeps under both `steamapps/`
//! and `config/`. On Windows even the install folder is a user choice, recorded in
//! the registry at `HKCU\Software\Valve\Steam\SteamPath`, so the Program Files
//! (x86) default is only a guess (issue #1695).
//!
//! Everything here except [`library_dirs`] is pure, so `paths::candidate_roots`
//! stays a pure function: the command layer does the reading and hands the result
//! back in `BaseDirs::steam_libraries`.

use crate::paths::{BaseDirs, Os};
use std::path::PathBuf;

/// The Steam install folders we can name from the environment alone. These are
/// where Steam's own installer puts it by default.
pub fn default_install_dirs(os: Os, b: &BaseDirs) -> Vec<PathBuf> {
    match os {
        Os::Windows => b
            .program_files_x86
            .iter()
            .map(|p| p.join("Steam"))
            .collect(),
        Os::Mac => b
            .home
            .iter()
            .map(|h| h.join("Library").join("Application Support").join("Steam"))
            .collect(),
        Os::Linux => b
            .home
            .iter()
            .flat_map(|h| {
                [
                    h.join(".steam").join("steam"),
                    h.join(".local").join("share").join("Steam"),
                ]
            })
            .collect(),
    }
}

/// Every Steam library folder on this machine: each install folder we can find,
/// plus every entry in its `libraryfolders.vdf`. Reads the filesystem, and on
/// Windows asks the registry where Steam is.
pub fn library_dirs(os: Os, b: &BaseDirs) -> Vec<PathBuf> {
    let mut installs: Vec<PathBuf> = Vec::new();
    if os == Os::Windows {
        if let Some(dir) = registered_install_dir() {
            push_unique(&mut installs, dir);
        }
    }
    for dir in default_install_dirs(os, b) {
        push_unique(&mut installs, dir);
    }

    let mut out: Vec<PathBuf> = Vec::new();
    for install in installs {
        if !install.is_dir() {
            continue;
        }
        push_unique(&mut out, install.clone());
        // Steam writes the same list in both places and rewrites the `steamapps`
        // copy from the `config` one on startup, so read both and merge.
        for dir in ["steamapps", "config"] {
            let Ok(text) = std::fs::read_to_string(install.join(dir).join("libraryfolders.vdf"))
            else {
                continue;
            };
            for lib in parse_library_folders(&text) {
                push_unique(&mut out, lib);
            }
        }
    }
    out
}

/// The library folder paths in a `libraryfolders.vdf` body.
///
/// Both shapes Steam has shipped are read: the current one, where each numbered
/// entry is a block with a `path` key, and the pre-2021 one, where the numbered
/// key holds the path itself. That is the only value anything here needs, so this
/// is a line scanner rather than a VDF parser: a line is `"key" "value"`, and a
/// numbered key only counts when its value looks like a path (the current format's
/// `apps` block is numbered too, but maps app ids to sizes).
pub fn parse_library_folders(text: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for line in text.lines() {
        let Some((key, value)) = key_value(line) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let numbered = !key.is_empty() && key.chars().all(|c| c.is_ascii_digit());
        if key.eq_ignore_ascii_case("path") || (numbered && looks_like_path(&value)) {
            push_unique(&mut out, PathBuf::from(value));
        }
    }
    out
}

/// Steam's own record of where it is installed, from the registry. The installer
/// lets you put Steam anywhere, and plenty of people move it off the C: drive.
#[cfg(windows)]
fn registered_install_dir() -> Option<PathBuf> {
    // Full path rather than a PATH lookup, and through `coilbox_proc` so the
    // console window this would otherwise flash up is suppressed.
    let reg = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("reg.exe"))
        .unwrap_or_else(|| PathBuf::from("reg.exe"));
    let out = coilbox_proc::command(reg)
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;
    parse_reg_sz(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(windows))]
fn registered_install_dir() -> Option<PathBuf> {
    None
}

/// The string value in `reg query` output, which prints one indented
/// `name  REG_SZ  value` line per value and an error to stderr when there is none.
/// The value can hold spaces, so it is everything after the type.
#[cfg(any(windows, test))]
fn parse_reg_sz(out: &str) -> Option<PathBuf> {
    out.lines()
        .find_map(|line| line.split_once("REG_SZ"))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// The first two quoted strings on a VDF line, as key and value.
fn key_value(line: &str) -> Option<(String, String)> {
    let mut quoted = quoted_strings(line).into_iter();
    Some((quoted.next()?, quoted.next()?))
}

/// The quoted strings on a line, with backslash escapes resolved. Windows paths
/// are stored with each separator doubled.
fn quoted_strings(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut inside = false;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' if inside => {
                if let Some(escaped) = chars.next() {
                    buf.push(escaped);
                }
            }
            '"' if inside => {
                out.push(std::mem::take(&mut buf));
                inside = false;
            }
            '"' => inside = true,
            _ if inside => buf.push(c),
            _ => {}
        }
    }
    out
}

fn looks_like_path(value: &str) -> bool {
    value.contains('/') || value.contains('\\') || value.contains(':')
}

fn push_unique(out: &mut Vec<PathBuf>, path: PathBuf) {
    if !out.contains(&path) {
        out.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape Steam writes today, with a second library on another drive. The
    /// `apps` block is included because its numbered keys must not be read as
    /// paths.
    const MODERN: &str = r#"
"libraryfolders"
{
	"contentstatsid"		"-1234567890123456789"
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
		"contentid"		"1234567890123456789"
		"totalsize"		"0"
		"apps"
		{
			"228980"		"345678901"
			"334920"		"2345678901"
		}
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
		"label"		"games"
		"totalsize"		"1000202039296"
		"apps"
		{
			"334920"		"2345678901"
		}
	}
}
"#;

    /// The pre-2021 shape, where the numbered key is the path.
    const LEGACY: &str = r#"
"LibraryFolders"
{
	"TimeNextStatsReport"		"1600000000"
	"ContentStatsID"		"-1234567890123456789"
	"1"		"D:\\SteamLibrary"
	"2"		"E:\\Games\\Steam"
}
"#;

    #[test]
    fn modern_vdf_gives_every_library() {
        assert_eq!(
            parse_library_folders(MODERN),
            vec![
                PathBuf::from(r"C:\Program Files (x86)\Steam"),
                PathBuf::from(r"D:\SteamLibrary"),
            ]
        );
    }

    #[test]
    fn legacy_vdf_gives_every_library() {
        assert_eq!(
            parse_library_folders(LEGACY),
            vec![
                PathBuf::from(r"D:\SteamLibrary"),
                PathBuf::from(r"E:\Games\Steam"),
            ]
        );
    }

    #[test]
    fn a_linux_library_path_survives() {
        let text = "\t\t\t\"path\"\t\t\"/mnt/games/SteamLibrary\"\n";
        assert_eq!(
            parse_library_folders(text),
            vec![PathBuf::from("/mnt/games/SteamLibrary")]
        );
    }

    #[test]
    fn the_same_library_is_only_listed_once() {
        let text = "\"path\"\t\"D:\\\\SteamLibrary\"\n\"path\"\t\"D:\\\\SteamLibrary\"\n";
        assert_eq!(parse_library_folders(text).len(), 1);
    }

    #[test]
    fn reg_query_output_gives_the_steam_path() {
        // reg.exe writes a blank line, the key, then the indented value.
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    d:/games/steam\r\n\r\n";
        assert_eq!(parse_reg_sz(out), Some(PathBuf::from("d:/games/steam")));
    }

    #[test]
    fn a_steam_path_with_spaces_is_kept_whole() {
        let out = "    SteamPath    REG_SZ    C:\\Program Files (x86)\\Steam\r\n";
        assert_eq!(
            parse_reg_sz(out),
            Some(PathBuf::from(r"C:\Program Files (x86)\Steam"))
        );
    }

    #[test]
    fn no_such_value_is_no_path() {
        // The error goes to stderr, so stdout is empty.
        assert_eq!(parse_reg_sz(""), None);
    }

    #[test]
    fn libraries_come_from_the_install_folder_and_its_vdf() {
        let tmp = std::env::temp_dir().join("content_steam_test_libraries");
        let _ = std::fs::remove_dir_all(&tmp);
        let steam = tmp
            .join("Library")
            .join("Application Support")
            .join("Steam");
        std::fs::create_dir_all(steam.join("config")).unwrap();
        std::fs::write(
            steam.join("config").join("libraryfolders.vdf"),
            "\t\"path\"\t\"/mnt/games/SteamLibrary\"\n",
        )
        .unwrap();
        let b = BaseDirs {
            home: Some(tmp.clone()),
            ..BaseDirs::default()
        };
        assert_eq!(
            library_dirs(Os::Mac, &b),
            vec![steam, PathBuf::from("/mnt/games/SteamLibrary")]
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_machine_without_steam_has_no_libraries() {
        let b = BaseDirs {
            home: Some(std::env::temp_dir().join("content_steam_test_absent")),
            ..BaseDirs::default()
        };
        assert!(library_dirs(Os::Mac, &b).is_empty());
    }
}
