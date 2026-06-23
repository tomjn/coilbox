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
            Some(Repo { name: name.to_string(), url: url.to_string() })
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
            let _md5 = parts.next();
            let _depends = parts.next();
            let name = parts.next().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(tag);
            Some(Version { tag: tag.to_string(), name: name.to_string() })
        })
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
        assert_eq!(repos[1], Repo { name: "bar".into(), url: "https://repos.springrts.com/bar".into() });
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
}
