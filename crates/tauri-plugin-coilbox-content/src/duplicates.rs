//! A read only report of content stored twice (issue #399).
//!
//! Two kinds of duplicate are reported:
//!
//! - `sameName`: a file with the same name in the `maps/` or `games/` folder of
//!   two or more content folders. These are the same lists `dl_installed_content`
//!   reads, so a player sees the same names the download screens match against.
//! - `mapInRapid`: a map that is a loose `maps/*.sd7` or `maps/*.sdz` in one
//!   folder and also inside a rapid package. A package is a map when its manifest
//!   lists a `maps/*.smf` file, and the two are the same map when that map file's
//!   name matches one inside the loose archive.
//!
//! Nothing here deletes. Removing a copy needs to know what depends on it, such as
//! replays and saves, so that stays a manual, confirmed step.
//!
//! Cost on a large library: the name check reads one directory listing and one
//! `stat` per file. The same size test needs no more than that. File contents are
//! never read or hashed, so a same size pair is reported as a match on the name
//! and the size alone. The map in a rapid package check parses each `.sdp`
//! manifest, which is a few kilobytes of gzip. Loose map archives have their
//! member list read (the archive index, not the data) only when at least one
//! rapid package holds a map.

use picoframe_core::CliResult;
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::rapid_pool::parse_sdp_entries;

/// The folders under a content folder whose files are compared by name.
const NAMED_DIRS: &[&str] = &["maps", "games"];

/// One place a duplicated item is stored.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCopy {
    pub path: String,
    /// The content folder this copy is in.
    pub root: String,
    /// What the copy occupies. For a rapid package, the pool files it lists that
    /// are on disk, which another package in the same pool may also use.
    pub bytes: u64,
    /// `file` for a loose archive, `rapid` for a rapid package.
    pub source: &'static str,
}

/// Two or more copies of one item.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// `sameName` or `mapInRapid`.
    pub kind: &'static str,
    /// `maps` or `games`.
    pub category: &'static str,
    /// The file name, or for a rapid map the map file's name without its extension.
    pub name: String,
    pub copies: Vec<DuplicateCopy>,
    /// For `sameName`, whether every copy has the same size. Different sizes mean
    /// different contents. Null for `mapInRapid`, where the two formats never
    /// match in size.
    pub sizes_match: Option<bool>,
    /// What deleting every copy but the largest would free. Zero for a `sameName`
    /// group whose sizes differ, because those are different versions rather
    /// than copies of one.
    pub wasted_bytes: u64,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReport {
    pub groups: Vec<DuplicateGroup>,
    pub wasted_bytes: u64,
}

/// A loose file in one content folder's `maps/` or `games/`.
struct Loose {
    category: &'static str,
    /// The name as it is on disk.
    name: String,
    path: PathBuf,
    root: String,
    bytes: u64,
}

/// A rapid package that holds a map.
struct RapidMap {
    /// The map file's name without its extension, lowercased.
    stem: String,
    copy: DuplicateCopy,
}

/// Build the report for the given content folders. A folder named twice, or
/// reached through a link, counts once.
pub fn report(roots: &[PathBuf]) -> DuplicateReport {
    let mut seen_roots = HashSet::new();
    let roots: Vec<PathBuf> = roots
        .iter()
        .filter(|r| r.is_dir())
        .filter(|r| seen_roots.insert(crate::canonical(r)))
        .cloned()
        .collect();

    let loose = loose_files(&roots);
    let mut groups = same_name_groups(&loose);
    groups.extend(map_in_rapid_groups(&roots, &loose));
    groups.sort_by(|a, b| {
        b.wasted_bytes
            .cmp(&a.wasted_bytes)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.kind.cmp(b.kind))
    });
    let wasted_bytes = groups.iter().map(|g| g.wasted_bytes).sum();
    DuplicateReport {
        groups,
        wasted_bytes,
    }
}

/// Every regular file directly in each root's `maps/` and `games/`. A file
/// reached twice, through a linked folder, is kept once.
fn loose_files(roots: &[PathBuf]) -> Vec<Loose> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for root in roots {
        for category in NAMED_DIRS {
            let Ok(rd) = std::fs::read_dir(root.join(category)) else {
                continue;
            };
            for entry in rd.flatten() {
                let path = entry.path();
                let Ok(md) = std::fs::metadata(&path) else {
                    continue;
                };
                if !md.is_file() || !seen.insert(crate::canonical(&path)) {
                    continue;
                }
                let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                out.push(Loose {
                    category,
                    name,
                    path,
                    root: crate::display_path(root),
                    bytes: md.len(),
                });
            }
        }
    }
    out
}

fn loose_copy(l: &Loose) -> DuplicateCopy {
    DuplicateCopy {
        path: crate::display_path(&l.path),
        root: l.root.clone(),
        bytes: l.bytes,
        source: "file",
    }
}

/// Group loose files that share a category and a case insensitive name. A name
/// in two folders is a group, and a name once is not.
fn same_name_groups(loose: &[Loose]) -> Vec<DuplicateGroup> {
    let mut by_name: BTreeMap<(&'static str, String), Vec<&Loose>> = BTreeMap::new();
    for l in loose {
        by_name
            .entry((l.category, l.name.to_lowercase()))
            .or_default()
            .push(l);
    }
    by_name
        .into_iter()
        .filter(|(_, files)| files.len() > 1)
        .map(|((category, _), files)| {
            let sizes_match = files.iter().all(|f| f.bytes == files[0].bytes);
            let total: u64 = files.iter().map(|f| f.bytes).sum();
            let largest = files.iter().map(|f| f.bytes).max().unwrap_or(0);
            DuplicateGroup {
                kind: "sameName",
                category,
                name: files[0].name.clone(),
                copies: files.iter().map(|f| loose_copy(f)).collect(),
                sizes_match: Some(sizes_match),
                wasted_bytes: if sizes_match { total - largest } else { 0 },
            }
        })
        .collect()
}

/// A rapid package's map file stems, or none when it holds no map.
fn map_stems(entries: &[(String, [u8; 16])]) -> Vec<String> {
    let mut stems: Vec<String> = entries
        .iter()
        .filter_map(|(name, _)| map_stem(name))
        .collect();
    stems.sort();
    stems.dedup();
    stems
}

/// `maps/Name.smf` as `name`. Anything else is none.
fn map_stem(member: &str) -> Option<String> {
    let lower = member.replace('\\', "/").to_lowercase();
    let file = lower.strip_prefix("maps/")?;
    if file.contains('/') {
        return None;
    }
    file.strip_suffix(".smf").map(str::to_string)
}

fn hex(md5: &[u8; 16]) -> String {
    md5.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every rapid package across the roots that holds a map.
fn rapid_maps(roots: &[PathBuf]) -> Vec<RapidMap> {
    let mut out = Vec::new();
    for root in roots {
        let Ok(rd) = std::fs::read_dir(root.join("packages")) else {
            continue;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("sdp") {
                continue;
            }
            let Ok(entries) = parse_sdp_entries(&path) else {
                continue;
            };
            // A package holds one map. Naming it by its first map file keeps a
            // package from landing in two groups.
            let Some(stem) = map_stems(&entries).into_iter().next() else {
                continue;
            };
            let bytes = entries
                .iter()
                .filter_map(|(_, md5)| {
                    let h = hex(md5);
                    std::fs::metadata(
                        root.join("pool")
                            .join(&h[..2])
                            .join(format!("{}.gz", &h[2..])),
                    )
                    .ok()
                })
                .map(|m| m.len())
                .sum();
            out.push(RapidMap {
                stem,
                copy: DuplicateCopy {
                    path: crate::display_path(&path),
                    root: crate::display_path(root),
                    bytes,
                    source: "rapid",
                },
            });
        }
    }
    out
}

/// The map file stems inside a loose `.sd7` or `.sdz`. An archive that cannot be
/// read has none, so it is never matched.
fn loose_map_stems(path: &Path) -> HashSet<String> {
    let packaged = matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("sd7" | "sdz")
    );
    if !packaged {
        return HashSet::new();
    }
    tauri_plugin_coilbox_scenario::member_names(path)
        .map(|names| names.iter().filter_map(|n| map_stem(n)).collect())
        .unwrap_or_default()
}

/// Maps that are both a loose archive and inside a rapid package.
fn map_in_rapid_groups(roots: &[PathBuf], loose: &[Loose]) -> Vec<DuplicateGroup> {
    let rapid = rapid_maps(roots);
    if rapid.is_empty() {
        return Vec::new();
    }
    let mut by_stem: BTreeMap<String, Vec<&RapidMap>> = BTreeMap::new();
    for r in &rapid {
        by_stem.entry(r.stem.clone()).or_default().push(r);
    }
    let loose_maps: Vec<(&Loose, HashSet<String>)> = loose
        .iter()
        .filter(|l| l.category == "maps")
        .map(|l| (l, loose_map_stems(&l.path)))
        .collect();

    let mut groups = Vec::new();
    for (stem, packages) in by_stem {
        let files: Vec<&Loose> = loose_maps
            .iter()
            .filter(|(_, stems)| stems.contains(&stem))
            .map(|(l, _)| *l)
            .collect();
        if files.is_empty() {
            continue;
        }
        let mut copies: Vec<DuplicateCopy> = files.iter().map(|f| loose_copy(f)).collect();
        copies.extend(packages.iter().map(|p| p.copy.clone()));

        // A file kept in two folders is a `sameName` duplicate already, and its
        // saving is counted there. Here it counts once, at its largest.
        let mut by_file: HashMap<String, u64> = HashMap::new();
        for f in &files {
            let size = by_file.entry(f.name.to_lowercase()).or_default();
            *size = (*size).max(f.bytes);
        }
        let counted: Vec<u64> = by_file
            .into_values()
            .chain(packages.iter().map(|p| p.copy.bytes))
            .collect();
        let total: u64 = counted.iter().sum();
        let largest = counted.iter().copied().max().unwrap_or(0);

        groups.push(DuplicateGroup {
            kind: "mapInRapid",
            category: "maps",
            name: stem,
            copies,
            sizes_match: None,
            wasted_bytes: total - largest,
        });
    }
    groups
}

/// `content_duplicate_report`: content stored twice across the given content
/// folders, read only (issue #399). See the module docs for what counts.
#[tauri::command]
pub(crate) async fn content_duplicate_report(roots: Vec<String>) -> CliResult {
    let paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    match tauri::async_runtime::spawn_blocking(move || report(&paths)).await {
        Ok(report) => CliResult::ok(json!({ "report": report })),
        Err(e) => CliResult::err(format!("duplicate report task failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;

    fn write(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    /// A rapid package listing `members`, each backed by a pool file of `blob`
    /// bytes, so the package occupies `members.len() * blob.len()`.
    fn write_package(root: &Path, id: &str, members: &[&str], blob: &[u8]) {
        let mut raw = Vec::new();
        for (i, name) in members.iter().enumerate() {
            let mut md5 = [0u8; 16];
            md5[0] = id.as_bytes()[0];
            md5[1] = i as u8;
            raw.push(name.len() as u8);
            raw.extend_from_slice(name.as_bytes());
            raw.extend_from_slice(&md5);
            raw.extend_from_slice(&[0u8; 8]);
            write(
                &root
                    .join("pool")
                    .join(&hex(&md5)[..2])
                    .join(format!("{}.gz", &hex(&md5)[2..])),
                blob,
            );
        }
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&raw).unwrap();
        write(
            &root.join("packages").join(format!("{id}.sdp")),
            &enc.finish().unwrap(),
        );
    }

    /// A `.sdz` holding the named files.
    fn write_sdz(path: &Path, members: &[&str]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for m in members {
            zip.start_file(*m, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"data").unwrap();
        }
        zip.finish().unwrap();
    }

    fn roots(dirs: &[&tempfile::TempDir]) -> Vec<PathBuf> {
        dirs.iter().map(|d| d.path().to_path_buf()).collect()
    }

    #[test]
    fn the_same_archive_in_two_roots_is_a_group() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/Tabula.sd7"), b"12345");
        write(&b.path().join("maps/tabula.sd7"), b"12345");
        write(&a.path().join("maps/only_here.sd7"), b"1");

        let r = report(&roots(&[&a, &b]));

        assert_eq!(r.groups.len(), 1);
        let g = &r.groups[0];
        assert_eq!(g.kind, "sameName");
        assert_eq!(g.category, "maps");
        assert_eq!(g.copies.len(), 2);
        assert_eq!(g.sizes_match, Some(true));
        assert_eq!(g.wasted_bytes, 5, "one copy of two is the waste");
        assert_eq!(r.wasted_bytes, 5);
    }

    #[test]
    fn a_game_in_three_roots_wastes_two_copies() {
        let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
        for d in &dirs {
            write(&d.path().join("games/g.sdz"), b"1234");
        }
        let r = report(&roots(&dirs.iter().collect::<Vec<_>>()));
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].category, "games");
        assert_eq!(r.groups[0].wasted_bytes, 8);
    }

    #[test]
    fn a_map_and_a_game_with_one_name_are_not_a_group() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/x.sdz"), b"1");
        write(&b.path().join("games/x.sdz"), b"1");
        assert!(report(&roots(&[&a, &b])).groups.is_empty());
    }

    #[test]
    fn no_duplicates_gives_an_empty_report() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/one.sd7"), b"1");
        write(&b.path().join("maps/two.sd7"), b"2");
        write(&b.path().join("games/g.sdz"), b"3");
        let r = report(&roots(&[&a, &b]));
        assert!(r.groups.is_empty());
        assert_eq!(r.wasted_bytes, 0);
    }

    #[test]
    fn a_folder_listed_twice_is_not_a_duplicate_of_itself() {
        let a = tempfile::tempdir().unwrap();
        write(&a.path().join("maps/m.sd7"), b"12");
        let r = report(&roots(&[&a, &a]));
        assert!(r.groups.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_is_not_a_second_copy() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/m.sd7"), b"12");
        std::os::unix::fs::symlink(a.path().join("maps"), b.path().join("maps")).unwrap();
        assert!(report(&roots(&[&a, &b])).groups.is_empty());
    }

    #[test]
    fn the_same_name_with_different_sizes_is_flagged_and_not_counted() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/m.sd7"), b"12");
        write(&b.path().join("maps/m.sd7"), b"123456");
        let r = report(&roots(&[&a, &b]));
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].sizes_match, Some(false));
        assert_eq!(r.groups[0].wasted_bytes, 0);
        assert_eq!(r.groups[0].copies.len(), 2, "both are still listed");
    }

    #[test]
    fn a_missing_root_is_ignored() {
        let a = tempfile::tempdir().unwrap();
        write(&a.path().join("maps/m.sd7"), b"12");
        let gone = a.path().join("nope");
        assert!(report(&[a.path().to_path_buf(), gone]).groups.is_empty());
    }

    #[test]
    fn a_map_loose_and_in_a_rapid_package_is_a_group() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write_sdz(
            &a.path().join("maps/Tabula-v4.sdz"),
            &["maps/Tabula-v4.smf", "maps/Tabula-v4.smt", "mapinfo.lua"],
        );
        let loose = fs::metadata(a.path().join("maps/Tabula-v4.sdz"))
            .unwrap()
            .len();
        write_package(
            b.path(),
            "a",
            &["maps/tabula-v4.smf", "maps/tabula-v4.smt"],
            b"0123456789",
        );

        let r = report(&roots(&[&a, &b]));

        assert_eq!(r.groups.len(), 1);
        let g = &r.groups[0];
        assert_eq!(g.kind, "mapInRapid");
        assert_eq!(g.name, "tabula-v4");
        assert_eq!(g.sizes_match, None);
        let sources: Vec<_> = g.copies.iter().map(|c| c.source).collect();
        assert_eq!(sources, ["file", "rapid"]);
        assert_eq!(g.copies[1].bytes, 20, "two pool files of ten bytes");
        assert_eq!(g.wasted_bytes, loose.min(20));
    }

    #[test]
    fn a_rapid_map_with_no_loose_copy_is_not_a_group() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write_sdz(&a.path().join("maps/other.sdz"), &["maps/other.smf"]);
        write_package(b.path(), "a", &["maps/tabula.smf"], b"1");
        assert!(report(&roots(&[&a, &b])).groups.is_empty());
    }

    #[test]
    fn a_game_package_is_not_a_map() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write_sdz(&a.path().join("maps/tabula.sdz"), &["maps/tabula.smf"]);
        write_package(b.path(), "a", &["units/armcom.lua", "gamedata/x.lua"], b"1");
        assert!(report(&roots(&[&a, &b])).groups.is_empty());
    }

    #[test]
    fn a_map_in_one_root_loose_and_in_the_same_roots_package_is_a_group() {
        let a = tempfile::tempdir().unwrap();
        write_sdz(&a.path().join("maps/t.sdz"), &["maps/t.smf"]);
        write_package(a.path(), "a", &["maps/t.smf"], b"1");
        let r = report(&roots(&[&a]));
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].kind, "mapInRapid");
    }

    #[test]
    fn a_loose_file_kept_in_two_roots_and_in_a_package_counts_its_space_once_per_kind() {
        let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
        write_sdz(&dirs[0].path().join("maps/t.sdz"), &["maps/t.smf"]);
        fs::create_dir_all(dirs[1].path().join("maps")).unwrap();
        fs::copy(
            dirs[0].path().join("maps/t.sdz"),
            dirs[1].path().join("maps/t.sdz"),
        )
        .unwrap();
        let loose = fs::metadata(dirs[0].path().join("maps/t.sdz"))
            .unwrap()
            .len();
        write_package(dirs[2].path(), "a", &["maps/t.smf"], &[0u8; 3]);

        let r = report(&roots(&dirs.iter().collect::<Vec<_>>()));

        assert_eq!(r.groups.len(), 2);
        // Two loose copies, one rapid copy: all but the largest is freed.
        // sameName holds the second loose copy and mapInRapid the smaller of
        // the loose and rapid copy, which add up to that.
        let rapid = 3;
        assert_eq!(r.wasted_bytes, loose + loose.min(rapid));
    }

    #[test]
    fn a_corrupt_package_and_an_unreadable_archive_are_skipped() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/bad.sd7"), b"not an archive");
        write(&b.path().join("packages/zz.sdp"), b"");
        write_package(b.path(), "a", &["maps/bad.smf"], b"1");
        assert!(report(&roots(&[&a, &b])).groups.is_empty());
    }

    #[test]
    fn groups_are_ordered_by_space_wasted() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        write(&a.path().join("maps/small.sd7"), b"1");
        write(&b.path().join("maps/small.sd7"), b"1");
        write(&a.path().join("maps/big.sd7"), &[0u8; 50]);
        write(&b.path().join("maps/big.sd7"), &[0u8; 50]);
        let r = report(&roots(&[&a, &b]));
        let names: Vec<_> = r.groups.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["big.sd7", "small.sd7"]);
    }
}
