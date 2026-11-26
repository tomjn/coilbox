//! Engine builds the hub offers beside the official Recoil releases, such as
//! macOS test builds. The hub half is `app/Domain/Engines` in coilbox-hub, and
//! its design is `docs/superpowers/specs/2026-11-25-hub-engines-design.md`
//! there.
//!
//! An engine archive holds no version file, so its name is the only place the
//! version and platform come from: `recoil_<version>_<platform>.7z`, the same
//! shape as an official release asset.

use std::io::Read as _;
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::sources::GithubRelease;

/// The platforms the hub takes engines for, in the hub's words
/// (`EngineFilename::PLATFORMS`).
pub const PLATFORMS: [&str; 3] = ["amd64-linux", "amd64-windows", "arm64-macos"];

/// The longest version the hub accepts. The hub's choice, matched here so a
/// name it would refuse is refused before the file is hashed.
const VERSION_MAX: usize = 64;

/// This machine's platform in the hub's words, or `None` where neither the hub
/// nor Recoil has a build for it.
pub fn this_platform() -> Option<&'static str> {
    platform_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn platform_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some("amd64-linux"),
        ("windows", "x86_64") => Some("amd64-windows"),
        ("macos", "aarch64") => Some("arm64-macos"),
        _ => None,
    }
}

/// The version and platform an engine archive's name carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineName {
    pub version: String,
    pub platform: &'static str,
}

/// Read `recoil_<version>_<platform>.7z` the way the hub's `EngineFilename`
/// does, or `None` for any other name.
pub fn parse_filename(filename: &str) -> Option<EngineName> {
    let rest = filename.strip_prefix("recoil_")?.strip_suffix(".7z")?;
    let (version, platform) = rest.rsplit_once('_')?;
    let platform = PLATFORMS.into_iter().find(|p| *p == platform)?;
    valid_version(version).then(|| EngineName {
        version: version.to_owned(),
        platform,
    })
}

/// Whether the hub would accept this as an engine version. One that passes is
/// also a safe folder name, with no separators and no leading dot.
pub fn valid_version(version: &str) -> bool {
    let mut chars = version.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && version.len() <= VERSION_MAX
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
}

/// The program an engine for `platform` starts with.
pub fn binary_for(platform: &str) -> &'static str {
    if platform == "amd64-windows" {
        "spring.exe"
    } else {
        "spring"
    }
}

/// One official Recoil build, by version and platform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OfficialBuild {
    pub version: String,
    pub platform: &'static str,
}

/// Every build the Recoil releases publish, for every platform the hub knows.
/// A hub engine with the same version and platform as one of these is not
/// offered, and not uploaded.
pub fn official_builds(releases: &[GithubRelease]) -> Vec<OfficialBuild> {
    let mut out = Vec::new();
    for release in releases {
        for platform in PLATFORMS {
            let suffix = format!("{platform}.7z");
            if release.assets.iter().any(|a| a.name.ends_with(&suffix)) {
                out.push(OfficialBuild {
                    version: release.tag_name.clone(),
                    platform,
                });
            }
        }
    }
    out
}

/// What the hub's `POST /api/v1/uploads` takes for an engine, less the note,
/// which the person writes after these are read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineFacts {
    pub sha256: String,
    pub size: u64,
    pub filename: String,
    pub kind: &'static str,
    pub internal_name: &'static str,
    pub version: String,
    pub platform: &'static str,
}

/// Read an engine archive's facts: its name, its size and hash, and whether it
/// holds the program its platform starts. Blocking, because the whole file is
/// hashed.
pub fn upload_facts(path: &Path) -> Result<EngineFacts, String> {
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} has no file name.", path.display()))?;
    let name = parse_filename(filename).ok_or_else(|| {
        format!(
            "{filename} is not named like an engine build. Name it recoil_<version>_<platform>.7z, with a platform of {}.",
            PLATFORMS.join(", ")
        )
    })?;

    let binary = binary_for(name.platform);
    let listing = sevenz_rust2::Archive::open(path)
        .map_err(|e| format!("{filename} is not a 7z archive Coilbox can read: {e}"))?;
    let holds_binary = listing
        .files
        .iter()
        .any(|entry| !entry.is_directory && entry.name == binary);
    if !holds_binary {
        return Err(format!(
            "{filename} has no {binary} at the top of the archive, so it is not an {} engine.",
            name.platform
        ));
    }

    let (sha256, size) = hash_file(path)?;
    Ok(EngineFacts {
        sha256,
        size,
        filename: filename.to_owned(),
        kind: "engine",
        internal_name: "recoil",
        version: name.version,
        platform: name.platform,
    })
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let unreadable = |e: std::io::Error| format!("Could not read {}: {e}", path.display());
    let mut file = std::fs::File::open(path).map_err(unreadable)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(unreadable)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    let sha256 = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((sha256, size))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::GithubAsset;

    #[test]
    fn a_hub_name_gives_its_version_and_platform() {
        assert_eq!(
            parse_filename("recoil_2026.09.03_arm64-macos.7z"),
            Some(EngineName {
                version: "2026.09.03".into(),
                platform: "arm64-macos"
            })
        );
        assert_eq!(
            parse_filename("recoil_2025.04.10-rc1+mac_amd64-linux.7z").map(|n| n.version),
            Some("2025.04.10-rc1+mac".into())
        );
    }

    #[test]
    fn names_the_hub_would_refuse_are_refused() {
        for name in [
            "recoil_2026.09.03_arm64-linux.7z",
            "recoil_2026.09.03_arm64-macos.zip",
            "spring_2026.09.03_arm64-macos.7z",
            "recoil__arm64-macos.7z",
            "recoil_.1_arm64-macos.7z",
            "recoil_a_b_arm64-macos.7z",
            "recoil_2026.09.03_amd64-linux.7Z",
        ] {
            assert_eq!(parse_filename(name), None, "{name}");
        }
        let long = format!("recoil_{}_amd64-linux.7z", "1".repeat(VERSION_MAX + 1));
        assert_eq!(parse_filename(&long), None);
        let longest = format!("recoil_{}_amd64-linux.7z", "1".repeat(VERSION_MAX));
        assert!(parse_filename(&longest).is_some());
    }

    #[test]
    fn each_machine_has_the_hub_s_word_for_its_platform() {
        assert_eq!(platform_for("macos", "aarch64"), Some("arm64-macos"));
        assert_eq!(platform_for("macos", "x86_64"), None);
        assert_eq!(platform_for("linux", "x86_64"), Some("amd64-linux"));
        assert_eq!(platform_for("linux", "aarch64"), None);
        assert_eq!(platform_for("windows", "x86_64"), Some("amd64-windows"));
    }

    fn release(tag: &str, assets: &[&str]) -> GithubRelease {
        GithubRelease {
            tag_name: tag.into(),
            assets: assets
                .iter()
                .map(|name| GithubAsset {
                    name: (*name).into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn official_builds_cover_every_platform_a_release_publishes() {
        let builds = official_builds(&[release(
            "2026.09.03",
            &[
                "recoil_2026.09.03_amd64-linux.7z",
                "recoil_2026.09.03_amd64-windows.7z",
                "recoil_2026.09.03_amd64-linux-tracy.7z",
                "recoil_2026.09.03_amd64-linux-dbgsym.tar.zst",
            ],
        )]);
        assert_eq!(
            builds,
            vec![
                OfficialBuild {
                    version: "2026.09.03".into(),
                    platform: "amd64-linux"
                },
                OfficialBuild {
                    version: "2026.09.03".into(),
                    platform: "amd64-windows"
                },
            ]
        );
    }

    fn engine_archive(dir: &Path, filename: &str, entries: &[&str]) -> std::path::PathBuf {
        let path = dir.join(filename);
        let mut writer = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
        for name in entries {
            writer
                .push_archive_entry(
                    sevenz_rust2::ArchiveEntry::new_file(name),
                    Some(&b"content"[..]),
                )
                .unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn an_engine_archive_answers_its_facts() {
        let dir = tempfile::tempdir().unwrap();
        let path = engine_archive(
            dir.path(),
            "recoil_2026.09.03_arm64-macos.7z",
            &["spring", "spring-headless"],
        );
        let bytes = std::fs::read(&path).unwrap();
        let facts = upload_facts(&path).unwrap();
        assert_eq!(facts.size, bytes.len() as u64);
        let expected: String = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(facts.sha256, expected);
        assert_eq!(facts.version, "2026.09.03");
        assert_eq!(facts.platform, "arm64-macos");
        assert_eq!(facts.kind, "engine");
        assert_eq!(facts.internal_name, "recoil");
    }

    #[test]
    fn an_archive_without_its_platform_s_program_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = engine_archive(
            dir.path(),
            "recoil_2026.09.03_amd64-windows.7z",
            &["spring", "unitsync.dll"],
        );
        let said = upload_facts(&path).unwrap_err();
        assert!(said.contains("spring.exe"), "{said}");

        let nested = engine_archive(
            dir.path(),
            "recoil_2026.09.03_arm64-macos.7z",
            &["build/spring"],
        );
        assert!(upload_facts(&nested).is_err());
    }

    #[test]
    fn a_badly_named_archive_is_refused_before_it_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = engine_archive(dir.path(), "engine.7z", &["spring"]);
        let said = upload_facts(&path).unwrap_err();
        assert!(said.contains("recoil_<version>_<platform>.7z"), "{said}");
    }
}
