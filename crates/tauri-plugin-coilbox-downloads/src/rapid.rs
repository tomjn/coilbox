//! Pure parsers for the Spring/Recoil "rapid" content index.
//!
//! Rapid is a flat, gzip-CSV protocol. Two file kinds matter here:
//!
//! - The master `repos.gz` lists repositories, one per line: `name,url,,`
//!   (trailing fields are unused). Example: `bar,https://repos.springrts.com/bar,,`
//! - A repository's `versions.gz` lists downloadable tags, one per line:
//!   `tag,md5,depends,longname`, where `depends` separates entries with `|`. Example:
//!   `bar:test,5c77...,,Balanced Annihilation Reloaded test-5429-ea66104`
//!
//! These functions parse the already-inflated text; fetching + gunzip lives in
//! `lib.rs` so the parsing stays pure and unit-testable.

use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

/// A rapid repository discovered from the master index.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Repo {
    /// Short name, e.g. `bar`.
    pub name: String,
    /// Base URL whose `versions.gz` lists this repo's tags.
    pub url: String,
}

/// Whether a tag names a public release or a per-commit snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionKind {
    Release,
    Snapshot,
}

/// A rapid tag containing `:git:` is a per-commit snapshot, such as
/// `byar:git:03b45b8`. Every other tag is a named release.
pub fn kind_of_tag(tag: &str) -> VersionKind {
    if tag.contains(":git:") {
        VersionKind::Snapshot
    } else {
        VersionKind::Release
    }
}

/// A downloadable content version within a repository.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Version {
    /// Rapid tag passed to `pr-downloader --download-game`, e.g. `bar:test`.
    pub tag: String,
    /// The package's md5, which is also what the pool names its `.sdp` after.
    pub md5: String,
    /// Human-readable long name, e.g. `Beyond all Reason test-11407-03b45b8`.
    pub name: String,
    /// What the package pulls in: tags or package names, e.g. `Spring Features v1.9`.
    pub depends: Vec<String>,
    /// Release or commit snapshot, read from the tag.
    pub kind: VersionKind,
    /// True when the pool holds a `.sdp` named after `md5`. Set by
    /// [`mark_installed`], and false straight out of the parser.
    pub installed: bool,
}

/// Parse a master `repos.gz` body (`name,url,,` per line). Skips blank lines and
/// lines missing a URL.
pub fn parse_repos(body: &str) -> Vec<Repo> {
    body.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut it = line.split(',');
            let name = it.next()?.trim();
            let url = it.next()?.trim();
            if name.is_empty() || url.is_empty() {
                return None;
            }
            Some(Repo {
                name: name.to_string(),
                url: url.to_string(),
            })
        })
        .collect()
}

/// Parse a repository `versions.gz` body (`tag,md5,depends,longname` per line).
/// `longname` is taken as everything after the third comma so embedded commas in
/// the name survive; it falls back to the tag when absent.
pub fn parse_versions(body: &str) -> Vec<Version> {
    body.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            // tag, md5, depends, longname — split into at most 4 so the name keeps any commas.
            let mut parts = line.splitn(4, ',');
            let tag = parts.next()?.trim();
            if tag.is_empty() {
                return None;
            }
            let md5 = parts.next().map(str::trim).unwrap_or_default();
            let depends = parse_depends(parts.next().unwrap_or_default());
            let name = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(tag);
            Some(Version {
                tag: tag.to_string(),
                md5: md5.to_string(),
                name: name.to_string(),
                depends,
                kind: kind_of_tag(tag),
                installed: false,
            })
        })
        .collect()
}

/// Split the `depends` field, where entries are separated by `|`. A
/// `rapid://` prefix is dropped so an entry reads as the tag it names.
fn parse_depends(field: &str) -> Vec<String> {
    field
        .split('|')
        .map(|d| d.trim().trim_start_matches("rapid://"))
        .filter(|d| !d.is_empty())
        .map(str::to_string)
        .collect()
}

/// The md5s of every package in the pool, read from the `<md5>.sdp` files in
/// `<dataDir>/packages`. Names are lowercased. A missing folder is an empty pool.
pub fn pool_md5s(data_dir: &Path) -> HashSet<String> {
    let Ok(entries) = std::fs::read_dir(data_dir.join("packages")) else {
        return HashSet::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "sdp" {
                return None;
            }
            Some(path.file_stem()?.to_str()?.to_ascii_lowercase())
        })
        .collect()
}

/// Mark each version whose md5 is in the pool.
pub fn mark_installed(versions: &mut [Version], pool: &HashSet<String>) {
    for v in versions {
        v.installed = !v.md5.is_empty() && pool.contains(&v.md5.to_ascii_lowercase());
    }
}

/// The md5s a *named* tag points at, which is what tells a public release from a
/// private build.
///
/// Rapid publishes a tag per commit as `<repo>:git:<sha>` alongside the named
/// ones like `ba:stable`. A package only a commit tag reaches is a snapshot
/// somebody happened to download, and it is not what a game is.
///
/// Deliberately reads the tag rather than the name: `ba:test` currently points
/// at the released V15.9.8 while the build named `test-7183-001edc3` is a
/// snapshot, so matching on the word would get both backwards.
pub fn release_md5s(body: &str) -> Vec<String> {
    parse_versions(body)
        .into_iter()
        .filter(|v| v.kind == VersionKind::Release && !v.md5.is_empty())
        .map(|v| v.md5)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_master_repos() {
        let body = "aa,https://repos.springrts.com/aa,,\n\
                    bar,https://repos.springrts.com/bar,,\n\
                    \n\
                    dev-game,https://repos.springrts.com/dev-game,,\n";
        let repos = parse_repos(body);
        assert_eq!(repos.len(), 3);
        assert_eq!(
            repos[1],
            Repo {
                name: "bar".into(),
                url: "https://repos.springrts.com/bar".into()
            }
        );
    }

    #[test]
    fn repos_skips_malformed_lines() {
        // No URL field -> skipped; whitespace-only -> skipped.
        assert!(parse_repos("justname\n   \n").is_empty());
    }

    #[test]
    fn parses_versions_with_longname() {
        let body = "bar:git:03b45b8,0891909679eafbf6cf70324a66e98ac3,,Beyond all Reason test-11407-03b45b8\n\
                    bar:test,5c77b08854b3a5caf6c79ca1fff87dff,,Balanced Annihilation Reloaded test-5429-ea66104\n";
        let vs = parse_versions(body);
        assert_eq!(vs.len(), 2);
        assert_eq!(vs[0].tag, "bar:git:03b45b8");
        assert_eq!(vs[0].name, "Beyond all Reason test-11407-03b45b8");
        assert_eq!(vs[1].tag, "bar:test");
    }

    #[test]
    fn version_name_falls_back_to_tag() {
        let vs = parse_versions("only:tag,md5hash,,\n");
        assert_eq!(vs.len(), 1);
        assert_eq!(vs[0].name, "only:tag");
    }

    #[test]
    fn version_name_keeps_embedded_commas() {
        let vs = parse_versions("t:1,md5,,Some Game, Special Edition\n");
        assert_eq!(vs[0].name, "Some Game, Special Edition");
    }

    /// The md5 is the join back to an installed `<md5>.sdp`, so a parser that
    /// drops it cannot tell a release from a commit snapshot.
    #[test]
    fn versions_keep_the_md5_the_pool_names_its_archives_after() {
        let vs = parse_versions(
            "ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Balanced Annihilation V15.9.8\n",
        );
        assert_eq!(vs[0].md5, "1df3ea4654d1f1f381e3534bfb1cbdb3");
    }

    /// `ba:test` points at the released V15.9.8 while the build *named*
    /// test-7183 is a commit snapshot, which is why this reads the tag and
    /// never the name.
    #[test]
    fn only_named_tags_name_a_release() {
        let body = "ba:git:001edc3f,cc956b0843d10d3689e2558281587c83,,Balanced Annihilation test-7183-001edc3\n\
                    ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Balanced Annihilation V15.9.8\n\
                    ba:test,dd57d8bc4e04ce8edee09a9cf84bbc04,,Balanced Annihilation V15.9.8\n";
        assert_eq!(
            release_md5s(body),
            vec![
                "1df3ea4654d1f1f381e3534bfb1cbdb3".to_string(),
                "dd57d8bc4e04ce8edee09a9cf84bbc04".to_string(),
            ]
        );
    }

    #[test]
    fn a_repo_of_nothing_but_commits_names_no_release() {
        let body = "ba:git:aaa,1111,,One\nba:git:bbb,2222,,Two\n";
        assert!(release_md5s(body).is_empty());
    }

    #[test]
    fn a_line_with_no_md5_names_no_release() {
        assert!(release_md5s("ba:stable,,,Balanced Annihilation\n").is_empty());
    }

    #[test]
    fn parses_a_line_with_a_dependency() {
        let vs = parse_versions(
            "ba:git:0193520,aa4f4a0c646d6b6c2ed6b8e04fc89492,Spring Features v1.9,Balanced Annihilation test-6094-0193520\n",
        );
        assert_eq!(vs[0].tag, "ba:git:0193520");
        assert_eq!(vs[0].md5, "aa4f4a0c646d6b6c2ed6b8e04fc89492");
        assert_eq!(vs[0].name, "Balanced Annihilation test-6094-0193520");
        assert_eq!(vs[0].depends, vec!["Spring Features v1.9".to_string()]);
    }

    #[test]
    fn depends_split_on_pipes_and_drop_the_rapid_prefix() {
        let vs = parse_versions(
            "a:test,m1,Spring Features v1.9|Evolution RTS Music Addon v1,A\n\
             chobby:git:1,m2,rapid://chobby:test,B\n\
             plain:tag,m3,,C\n",
        );
        assert_eq!(
            vs[0].depends,
            vec![
                "Spring Features v1.9".to_string(),
                "Evolution RTS Music Addon v1".to_string()
            ]
        );
        assert_eq!(vs[1].depends, vec!["chobby:test".to_string()]);
        assert!(vs[2].depends.is_empty());
    }

    #[test]
    fn a_git_tag_is_a_snapshot_and_a_named_tag_is_a_release() {
        let vs = parse_versions("ba:git:001edc3f,1,,One\nba:stable,2,,Two\n");
        assert_eq!(vs[0].kind, VersionKind::Snapshot);
        assert_eq!(vs[1].kind, VersionKind::Release);
    }

    #[test]
    fn installed_check_finds_an_md5_in_the_pool_and_misses_one_that_is_not() {
        let tmp = tempfile::tempdir().unwrap();
        let packages = tmp.path().join("packages");
        std::fs::create_dir_all(&packages).unwrap();
        std::fs::write(packages.join("1DF3EA4654D1F1F381E3534BFB1CBDB3.sdp"), b"").unwrap();
        std::fs::write(packages.join("notes.txt"), b"").unwrap();

        let mut vs = parse_versions(
            "ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Installed\n\
             ba:test,dd57d8bc4e04ce8edee09a9cf84bbc04,,Absent\n\
             ba:blank,,,No md5\n",
        );
        mark_installed(&mut vs, &pool_md5s(tmp.path()));
        assert!(vs[0].installed);
        assert!(!vs[1].installed);
        assert!(!vs[2].installed);
    }

    #[test]
    fn a_data_dir_with_no_packages_folder_has_an_empty_pool() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(pool_md5s(tmp.path()).is_empty());
    }
}
