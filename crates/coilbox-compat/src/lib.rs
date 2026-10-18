//! The compatibility fixes, and the manifests that say which of them make up
//! each compat version (issue #4555).
//!
//! Two players must build the same mutator or they desync, so a fix is
//! immutable once a manifest lists it. A change is a new fix with a new id and a
//! new manifest. `hashes.txt` beside the manifests records the SHA-256 of every
//! listed fix, and [`hash_problems`] reports any that no longer match.
//!
//! Every file is embedded with `include_str!`, so a build reads nothing at run
//! time. Adding a manifest or a fix means adding it to [`MANIFESTS`] or
//! [`FIXES`] below. A test fails if a file in `lua/compat/` is missing from them.
//!
//! A fix file starts with a header of `-- key: value` lines:
//!
//! ```lua
//! -- id: spring-set-unit-to-feature
//! -- catalogue: entry-id-one, entry-id-two
//! -- license: MIT or GNU GPL, v2 or later
//! ```
//!
//! `id` is the file name without `.lua`. `catalogue` lists the ids of the
//! `engineLuaCompat.json` entries the fix addresses.

use std::collections::BTreeMap;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The `license` every fix carries, as in `lua/LICENSE.md`.
pub const LICENSE: &str = "MIT or GNU GPL, v2 or later";

/// Every manifest, by version number.
const MANIFESTS: &[(u32, &str)] = &[(1, include_str!("../../../lua/compat/manifests/1.json"))];

/// Every fix file, by id. Empty until a fix is written.
const FIXES: &[(&str, &str)] = &[];

/// The recorded SHA-256 of every fix a manifest lists.
const HASHES: &str = include_str!("../../../lua/compat/manifests/hashes.txt");

/// The converter a compat version was built with.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Converter {
    #[serde(rename = "crate")]
    pub name: String,
    pub version: String,
}

/// One compat version: the fixes that make it up and the converter it pins.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub fixes: Vec<String>,
    pub converter: Converter,
}

/// The manifest for compat version `n`, or `None` if there is no such version.
///
/// Panics if an embedded manifest is not valid. The tests parse every one.
pub fn manifest(n: u32) -> Option<Manifest> {
    let (_, json) = MANIFESTS.iter().find(|(v, _)| *v == n)?;
    Some(parse_manifest(json))
}

/// The highest compat version, which is the one coilbox builds by default.
pub fn latest() -> u32 {
    latest_of(MANIFESTS)
}

/// The source of the fix with this id, or `None` if there is no such fix.
pub fn fix_source(id: &str) -> Option<&'static str> {
    FIXES.iter().find(|(i, _)| *i == id).map(|(_, src)| *src)
}

fn parse_manifest(json: &str) -> Manifest {
    serde_json::from_str(json).expect("an embedded compat manifest is valid JSON")
}

fn latest_of(manifests: &[(u32, &str)]) -> u32 {
    manifests
        .iter()
        .map(|(v, _)| *v)
        .max()
        .expect("there is at least one compat manifest")
}

/// Lowercase hex, two digits a byte. sha2 0.11's output does not format itself.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The SHA-256 of a fix's source, as lowercase hex.
pub fn fix_hash(source: &str) -> String {
    hex(&Sha256::digest(source.as_bytes()))
}

/// Reads `<hash>  <id>` lines, skipping blanks and `#` comments.
fn parse_hashes(text: &str) -> BTreeMap<&str, &str> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once(char::is_whitespace))
        .map(|(hash, id)| (id.trim(), hash))
        .collect()
}

/// What is wrong with the fixes a set of manifests lists. Empty means fine.
///
/// A listed fix with no source, no recorded hash, or a source that no longer
/// hashes to the recorded value is a problem. `source` looks a fix up by id.
pub fn hash_problems<'a>(
    manifests: &[Manifest],
    recorded: &str,
    source: impl Fn(&str) -> Option<&'a str>,
) -> Vec<String> {
    let recorded = parse_hashes(recorded);
    let mut problems = Vec::new();
    for fix in manifests.iter().flat_map(|m| &m.fixes) {
        let Some(src) = source(fix) else {
            problems.push(format!("{fix}: no such fix file"));
            continue;
        };
        match recorded.get(fix.as_str()) {
            None => problems.push(format!("{fix}: no recorded hash")),
            Some(want) if *want != fix_hash(src) => problems.push(format!(
                "{fix}: changed after it was listed. Add a new fix with a new id instead"
            )),
            Some(_) => {}
        }
    }
    problems
}

/// [`hash_problems`] over every embedded manifest, fix and recorded hash.
pub fn embedded_problems() -> Vec<String> {
    let manifests: Vec<Manifest> = MANIFESTS.iter().map(|(_, j)| parse_manifest(j)).collect();
    hash_problems(&manifests, HASHES, fix_source)
}

/// The header of a fix file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub id: String,
    pub catalogue: Vec<String>,
    pub license: String,
}

/// Reads the `-- key: value` lines at the top of a fix file.
///
/// Returns `None` if `id` or `license` is missing. `catalogue` may be empty.
pub fn parse_header(source: &str) -> Option<Header> {
    let (mut id, mut catalogue, mut license) = (None, Vec::new(), None);
    for line in source.lines() {
        let Some(rest) = line.strip_prefix("--") else {
            break;
        };
        let Some((key, value)) = rest.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "id" => id = Some(value.to_string()),
            "catalogue" => {
                catalogue = value
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect()
            }
            "license" => license = Some(value.to_string()),
            _ => {}
        }
    }
    Some(Header {
        id: id?,
        catalogue,
        license: license?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    fn compat_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lua/compat")
    }

    fn manifest_of(fixes: &[&str]) -> Manifest {
        Manifest {
            version: 9,
            fixes: fixes.iter().map(|s| s.to_string()).collect(),
            converter: Converter {
                name: "coilbox-3do-convert".into(),
                version: "0.0.0".into(),
            },
        }
    }

    fn all_manifests() -> Vec<Manifest> {
        MANIFESTS.iter().map(|(_, j)| parse_manifest(j)).collect()
    }

    #[test]
    fn latest_is_the_highest_number_whatever_the_order() {
        let json = "{}";
        assert_eq!(latest_of(&[(2, json), (10, json), (3, json)]), 10);
        assert_eq!(latest_of(&[(1, json)]), 1);
    }

    #[test]
    fn latest_is_a_version_that_has_a_manifest() {
        assert!(manifest(latest()).is_some());
        assert!(manifest(latest() + 1).is_none());
    }

    #[test]
    fn first_manifest_is_empty_apart_from_the_converter_pin() {
        let m = manifest(1).unwrap();
        assert_eq!(m.version, 1);
        assert!(m.fixes.is_empty());
        assert_eq!(m.converter.name, "coilbox-3do-convert");
    }

    #[test]
    fn every_manifest_says_the_version_its_file_is_named_for() {
        for (n, json) in MANIFESTS {
            assert_eq!(parse_manifest(json).version, *n);
        }
    }

    #[test]
    fn every_manifest_file_is_embedded() {
        let dir = compat_dir().join("manifests");
        let embedded: BTreeSet<String> =
            MANIFESTS.iter().map(|(n, _)| format!("{n}.json")).collect();
        let on_disk: BTreeSet<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".json"))
            .collect();
        assert_eq!(on_disk, embedded);
    }

    #[test]
    fn every_fix_file_is_embedded_and_its_header_agrees() {
        let on_disk: BTreeSet<String> = fs::read_dir(compat_dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter_map(|n| n.strip_suffix(".lua").map(String::from))
            .collect();
        let embedded: BTreeSet<String> = FIXES.iter().map(|(id, _)| id.to_string()).collect();
        assert_eq!(on_disk, embedded);
        for (id, src) in FIXES {
            let header = parse_header(src).unwrap_or_else(|| panic!("{id}: header incomplete"));
            assert_eq!(&header.id, id, "{id}: header id differs from the file name");
            assert_eq!(header.license, LICENSE, "{id}: wrong licence");
        }
    }

    #[test]
    fn every_fix_a_manifest_names_exists() {
        for m in all_manifests() {
            for fix in &m.fixes {
                assert!(
                    fix_source(fix).is_some(),
                    "manifest {}: no fix {fix}",
                    m.version
                );
            }
        }
        let problems = hash_problems(&[manifest_of(&["missing"])], "", |_| None);
        assert_eq!(problems, ["missing: no such fix file"]);
    }

    #[test]
    fn recorded_hashes_match_the_embedded_fixes() {
        assert_eq!(embedded_problems(), Vec::<String>::new());
    }

    #[test]
    fn the_hash_guard_rejects_a_changed_fix() {
        let original = "-- id: a\nreturn 1\n";
        let recorded = format!("{}  a\n", fix_hash(original));
        let m = [manifest_of(&["a"])];
        assert!(hash_problems(&m, &recorded, |_| Some(original)).is_empty());

        let problems = hash_problems(&m, &recorded, |_| Some("-- id: a\nreturn 2\n"));
        assert_eq!(problems.len(), 1);
        assert!(problems[0].starts_with("a: changed"));
    }

    #[test]
    fn the_hash_guard_rejects_a_listed_fix_with_no_recorded_hash() {
        let problems = hash_problems(&[manifest_of(&["a"])], "# nothing\n", |_| Some("x"));
        assert_eq!(problems, ["a: no recorded hash"]);
    }

    #[test]
    fn fix_hash_is_sha256_hex() {
        assert_eq!(
            fix_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_header_is_read_from_the_leading_comment_lines() {
        let src = "-- id: spring-set-unit-to-feature\n-- catalogue: one, two\n-- license: MIT or GNU GPL, v2 or later\nlocal x = 1 -- id: not-this\n";
        let h = parse_header(src).unwrap();
        assert_eq!(h.id, "spring-set-unit-to-feature");
        assert_eq!(h.catalogue, ["one", "two"]);
        assert_eq!(h.license, LICENSE);
        assert!(parse_header("-- id: a\n").is_none());
    }
}
