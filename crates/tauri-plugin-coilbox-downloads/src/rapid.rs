//! Pure parsers for the Spring/Recoil "rapid" content index.
//!
//! Rapid is a flat, gzip-CSV protocol. Two file kinds matter here:
//!
//! - The master `repos.gz` lists repositories, one per line: `name,url,,`
//!   (trailing fields are unused). Example: `bar,https://repos.springrts.com/bar,,`
//! - A repository's `versions.gz` lists downloadable tags, one per line:
//!   `tag,md5,depends,longname`. Example:
//!   `bar:test,5c77...,,Balanced Annihilation Reloaded test-5429-ea66104`
//!
//! These functions parse the already-inflated text; fetching + gunzip lives in
//! `lib.rs` so the parsing stays pure and unit-testable.

use serde::Serialize;

/// A rapid repository discovered from the master index.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Repo {
    /// Short name, e.g. `bar`.
    pub name: String,
    /// Base URL whose `versions.gz` lists this repo's tags.
    pub url: String,
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
            let _depends = parts.next();
            let name = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(tag);
            Some(Version {
                tag: tag.to_string(),
                md5: md5.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
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
        .filter(|v| !v.tag.contains(":git:") && !v.md5.is_empty())
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
}
