//! HTTP content sources for the Maps/Games browse screens: the springfiles
//! catalog API and Beyond All Reason's maps-metadata list. Both return JSON we
//! reshape into lean records for the frontend.

use serde::{Deserialize, Serialize};

/// One entry from the springfiles `json.php` catalog. Field names match the
/// springfiles JSON (all lowercase) and pass straight through to the frontend.
/// Unknown fields (md5, timestamp, metadata, ...) are ignored.
/// Map metadata from springfiles' `metadata=1` query. Source keys are
/// capitalised (`Author`, `Width`, `Height`); accepted via serde aliases and
/// re-emitted as lowercase for the frontend. Empty/zero for non-map entries.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SpringFileMetadata {
    #[serde(alias = "Author")]
    pub author: String,
    #[serde(alias = "Width")]
    pub width: f64,
    #[serde(alias = "Height")]
    pub height: f64,
}

/// springfiles returns `""` (an empty string) instead of an empty array when a
/// list field has no value. Accept the real array or fall back to empty.
fn de_string_vec<'de, D>(d: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Array(_) => serde_json::from_value(v).map_err(serde::de::Error::custom),
        _ => Ok(Vec::new()),
    }
}

/// Likewise, `metadata` is `""` (not `{}`) when a map has none. Accept the object
/// or fall back to default metadata.
fn de_metadata<'de, D>(d: D) -> Result<SpringFileMetadata, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Object(_) => serde_json::from_value(v).map_err(serde::de::Error::custom),
        _ => Ok(SpringFileMetadata::default()),
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SpringFile {
    pub springname: String,
    pub name: String,
    pub filename: String,
    pub category: String,
    /// Version string — populated for engines (e.g. `2025.01.6`), empty for maps.
    pub version: String,
    pub size: u64,
    #[serde(deserialize_with = "de_string_vec")]
    pub mirrors: Vec<String>,
    /// Thumbnail/preview image URLs (present when queried with `images=on`).
    #[serde(deserialize_with = "de_string_vec")]
    pub mapimages: Vec<String>,
    /// Map metadata (author + dimensions) when queried with `metadata=1`.
    #[serde(deserialize_with = "de_metadata")]
    pub metadata: SpringFileMetadata,
}

/// A platform-matched springfiles engine, deduped to one entry per version.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringfilesEngine {
    /// Engine name (generically `spring` on springfiles).
    pub name: String,
    pub version: String,
    pub filename: String,
    pub size: u64,
}

/// The springfiles engine `category` for the current platform, e.g.
/// `engine_linux64`. This has to be the category pr-downloader itself will
/// search, because `--download-engine` resolves the build from springfiles by
/// its own OS *and architecture*, so listing a category it will not look in
/// offers a download that can only fail. Mirrors `getPlatformEngineCat` in
/// pr-downloader's `src/pr-downloader.cpp`. macOS is arm64 only because that is
/// the only Apple platform pr-downloader builds for.
pub fn springfiles_engine_category() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "aarch64") => "engine_windows_arm64",
        ("windows", _) => "engine_windows64",
        ("macos", _) => "engine_macosx_arm64",
        (_, "aarch64") => "engine_linux_arm64",
        _ => "engine_linux64",
    }
}

/// Filter springfiles engine results to `category` and dedupe to one per version
/// (newest first). `--download-engine` takes only the version, so the per-file
/// variants (minimal/full) collapse to a single row. The match is exact, because
/// `engine_macosx` and `engine_macosx_arm64` are different builds for different
/// machines and only one of them is the one pr-downloader will fetch.
pub fn engines_for_platform(all: Vec<SpringFile>, category: &str) -> Vec<SpringfilesEngine> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<SpringfilesEngine> = all
        .into_iter()
        .filter(|f| f.category == category && !f.version.is_empty())
        .filter(|f| seen.insert(f.version.clone()))
        .map(|f| SpringfilesEngine {
            name: f.name,
            version: f.version,
            filename: f.filename,
            size: f.size,
        })
        .collect();
    out.sort_by(|a, b| b.version.cmp(&a.version));
    out
}

/// Preview images for a BAR map; `preview` is a full HTTPS thumbnail URL.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct BarMapImages {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// One BAR map from maps-metadata `lobby_maps.validated.json`. BAR uses camelCase
/// keys; we deserialize and re-serialize as camelCase for the frontend.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BarMap {
    pub spring_name: String,
    pub display_name: String,
    pub author: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count_min: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count_max: Option<u32>,
    /// Preview thumbnail (full HTTPS URL) when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<BarMapImages>,
}

/// The full Beyond All Reason validated maps list.
pub const BAR_MAPS_URL: &str =
    "https://maps-metadata.beyondallreason.dev/latest/lobby_maps.validated.json";

/// Build the springfiles catalog list URL for a category (`map`, `game`).
/// `springname=**` matches every entry; the wildcard category tolerates the
/// site's `*map*`-style matching. `images=on`+`metadata=1` enrich the rows.
pub fn springfiles_list_url(category: &str) -> String {
    let cat = category.trim();
    format!(
        "https://springfiles.springrts.com/json.php?springname=**&category=*{cat}*&limit=10000&latestOnly=0&images=on&metadata=1"
    )
}

/// The hakora.xyz maps mirror — an Apache `mod_autoindex` directory listing of
/// `.sd7`/`.sdz` archives (HTTP only). Trailing slash so `{url}{href}` joins
/// cleanly to a file URL.
pub const HAKORA_MAPS_URL: &str = "http://hakora.xyz/files/springrts/maps/";

/// One map archive from the hakora autoindex. Unlike springfiles/BAR there's no
/// springname or metadata — just the file, fetched directly via `dl_download_file`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HakoraMap {
    /// On-disk archive name (also the autoindex href; used for installed-detection).
    pub filename: String,
    /// Full download URL (`HAKORA_MAPS_URL` + href).
    pub url: String,
    /// Apache's human-readable size string (e.g. `6.9M`); empty if not parsed.
    pub size: String,
}

/// Slice of `s` between the first `start` and the next `end` after it.
fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let i = s.find(start)? + start.len();
    let j = s[i..].find(end)? + i;
    Some(&s[i..j])
}

/// Parse an Apache `mod_autoindex` page into map entries. Each file is one `<tr>`
/// row: `<a href="name.sd7">name.sd7</a> … <td align="right">SIZE</td>`. We split
/// on row boundaries and keep only `.sd7`/`.sdz` hrefs — which excludes the
/// parent-dir link, the `?C=…` sort-header links, and any `.png`/folder rows.
/// The hakora listing serves full, unencoded ASCII filenames, so the href is the
/// on-disk name verbatim. Size is the last right-aligned cell (date is the first).
pub fn parse_hakora_index(html: &str) -> Vec<HakoraMap> {
    let mut out = Vec::new();
    for row in html.split("<tr") {
        let Some(href) = between(row, "href=\"", "\"") else {
            continue;
        };
        let lower = href.to_ascii_lowercase();
        if !(lower.ends_with(".sd7") || lower.ends_with(".sdz")) {
            continue;
        }
        // The size cell is the last right-aligned column in the row.
        let size = row
            .rmatch_indices("align=\"right\">")
            .next()
            .and_then(|(i, m)| between(&row[i + m.len()..], "", "</td>"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        out.push(HakoraMap {
            url: format!("{HAKORA_MAPS_URL}{href}"),
            filename: href.to_string(),
            size,
        });
    }
    out
}

/// A GitHub release (subset) from the releases API. `name`/`body` are `Option`
/// because GitHub sends them as JSON `null` (not absent) for an unnamed release
/// or an empty changelog, which `#[serde(default)]` alone wouldn't tolerate.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct GithubRelease {
    pub tag_name: String,
    pub prerelease: bool,
    pub name: Option<String>,
    pub body: Option<String>,
    pub assets: Vec<GithubAsset>,
}

/// A downloadable asset within a GitHub release.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

/// A platform-matched Recoil engine release, surfaced to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineRelease {
    pub version: String,
    pub asset_url: String,
    pub size: u64,
    pub prerelease: bool,
}

pub const RECOIL_RELEASES_URL: &str =
    "https://api.github.com/repos/beyond-all-reason/RecoilEngine/releases?per_page=40";

/// A GitHub release reshaped for the game-updates screen: the tag, display name,
/// markdown changelog, and downloadable assets. A distribution profile names an
/// `owner/name` repo whose latest release ships a game archive (and optionally an
/// updated `profile.json`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub tag: String,
    pub name: String,
    pub body: String,
    pub assets: Vec<ReleaseAsset>,
}

/// A single downloadable asset within a [`ReleaseInfo`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

impl From<GithubRelease> for ReleaseInfo {
    fn from(r: GithubRelease) -> Self {
        ReleaseInfo {
            tag: r.tag_name,
            name: r.name.unwrap_or_default(),
            body: r.body.unwrap_or_default(),
            assets: r
                .assets
                .into_iter()
                .map(|a| ReleaseAsset {
                    name: a.name,
                    url: a.browser_download_url,
                    size: a.size,
                })
                .collect(),
        }
    }
}

/// Build the GitHub "latest release" API URL for an `owner/name` repo.
pub fn latest_release_url(repo: &str) -> String {
    format!("https://api.github.com/repos/{repo}/releases/latest")
}

/// Build the GitHub "recent releases" API URL for an `owner/name` repo. The
/// curated map/game repos ship their content as a release asset; we scan recent
/// releases (not `/latest`, which skips the prereleases some of these repos use)
/// and collect every content archive across them.
pub fn releases_url(repo: &str) -> String {
    format!("https://api.github.com/repos/{repo}/releases?per_page=30")
}

/// A Spring content archive (`.sd7`/`.sdz`) pulled from a GitHub release, for the
/// curated map/game browse sources. Like the hakora mirror it has no springname —
/// `url` is fetched directly via `dl_download_file`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseArchive {
    /// On-disk archive name (also used for installed-detection and the React key).
    pub filename: String,
    /// Full download URL (the asset's `browser_download_url`).
    pub url: String,
    pub size: u64,
    /// The release tag the archive came from (shown as a subtitle).
    pub tag: String,
}

/// Collect the `.sd7`/`.sdz` assets across `releases` (GitHub returns them newest
/// first), deduped by filename so an archive re-uploaded across versions appears
/// once (keeping the newest release's copy).
pub fn release_archives(releases: Vec<GithubRelease>) -> Vec<ReleaseArchive> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for rel in releases {
        for a in rel.assets {
            let lower = a.name.to_ascii_lowercase();
            if !(lower.ends_with(".sd7") || lower.ends_with(".sdz")) {
                continue;
            }
            if !seen.insert(lower) {
                continue;
            }
            out.push(ReleaseArchive {
                filename: a.name,
                url: a.browser_download_url,
                size: a.size,
                tag: rel.tag_name.clone(),
            });
        }
    }
    out
}

/// Validate an `owner/name` GitHub repo slug: exactly one `/`, both segments
/// non-empty, no whitespace or `..` path-traversal. Returns the trimmed slug so
/// it can be interpolated straight into the API URL.
pub fn validate_repo(repo: &str) -> Result<String, String> {
    let repo = repo.trim();
    if repo.is_empty() {
        return Err("repo is required".into());
    }
    if repo.contains(char::is_whitespace) || repo.contains("..") {
        return Err("repo must be a plain \"owner/name\" slug".into());
    }
    let mut parts = repo.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(name), None) if !owner.is_empty() && !name.is_empty() => {
            Ok(repo.to_string())
        }
        _ => Err("repo must be \"owner/name\"".into()),
    }
}

/// The Recoil 7z asset suffix for the current platform, e.g. `amd64-linux.7z`.
/// `None` on platforms with no official build (macOS).
pub fn recoil_asset_suffix() -> Option<&'static str> {
    match std::env::consts::OS {
        "linux" => Some("amd64-linux.7z"),
        "windows" => Some("amd64-windows.7z"),
        _ => None,
    }
}

/// Pick the platform engine asset from a release. Matching on the exact `<arch>-<os>.7z`
/// suffix naturally excludes the `-tracy.7z` and `-dbgsym.tar.zst` variants.
pub fn match_engine_release(rel: &GithubRelease, suffix: &str) -> Option<EngineRelease> {
    let asset = rel.assets.iter().find(|a| a.name.ends_with(suffix))?;
    Some(EngineRelease {
        version: rel.tag_name.clone(),
        asset_url: asset.browser_download_url.clone(),
        size: asset.size,
        prerelease: rel.prerelease,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn springfiles_url_includes_category_and_limit() {
        let u = springfiles_list_url("map");
        assert!(u.contains("category=*map*"));
        assert!(u.contains("springname=**"));
        assert!(u.contains("limit=10000"));
        assert!(!u.contains("callback")); // raw JSON, not JSONP
    }

    #[test]
    fn springfile_ignores_unknown_fields() {
        let json = r#"[{"fid":1,"springname":"Comet","name":"Comet","filename":"comet.sd7","category":"map","size":123,"md5":"x","mirrors":["http://m/comet.sd7"],"mapimages":["http://m/c.jpg"],"metadata":{"Width":12}}]"#;
        let v: Vec<SpringFile> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].springname, "Comet");
        assert_eq!(v[0].mirrors, vec!["http://m/comet.sd7"]);
        assert_eq!(v[0].mapimages.len(), 1);
    }

    #[test]
    fn springfile_tolerates_empty_string_fields() {
        // springfiles uses "" instead of []/{} for empty list/metadata fields.
        let json = r#"[{"springname":"X","name":"X","filename":"x.sd7","category":"map","size":1,"mirrors":"","mapimages":"","metadata":""}]"#;
        let v: Vec<SpringFile> = serde_json::from_str(json).unwrap();
        assert!(v[0].mirrors.is_empty());
        assert!(v[0].mapimages.is_empty());
        assert_eq!(v[0].metadata.author, "");
    }

    #[test]
    fn springfile_captures_map_metadata() {
        let json = r#"[{"springname":"Comet","name":"Comet","filename":"comet.sd7","category":"map","size":1,"metadata":{"Author":"raaar","Width":12.0,"Height":20.0}}]"#;
        let v: Vec<SpringFile> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].metadata.author, "raaar");
        assert_eq!(v[0].metadata.width, 12.0);
        assert_eq!(v[0].metadata.height, 20.0);
        // Re-serialised as lowercase for the frontend.
        let out = serde_json::to_string(&v[0]).unwrap();
        assert!(out.contains("\"author\":\"raaar\""));
    }

    #[test]
    fn engines_for_platform_filters_and_dedupes() {
        let json = r#"[
            {"name":"spring","filename":"a_linux.7z","category":"engine_linux64","version":"2025.01.6","size":10},
            {"name":"spring","filename":"a_linux_full.7z","category":"engine_linux64","version":"2025.01.6","size":20},
            {"name":"spring","filename":"a_win.7z","category":"engine_windows64","version":"2025.01.6","size":15},
            {"name":"spring","filename":"b_linux.7z","category":"engine_linux64","version":"2024.12.1","size":12}
        ]"#;
        let all: Vec<SpringFile> = serde_json::from_str(json).unwrap();
        let engines = engines_for_platform(all, "engine_linux64");
        // One per version, windows excluded, newest first.
        assert_eq!(engines.len(), 2);
        assert_eq!(engines[0].version, "2025.01.6");
        assert_eq!(engines[1].version, "2024.12.1");
    }

    /// springfiles' only macOS engines are 2013 Intel builds under
    /// `engine_macosx`. pr-downloader on an Apple Silicon machine searches
    /// `engine_macosx_arm64` and nothing else, so offering the Intel ones would
    /// be offering a download that cannot resolve.
    #[test]
    fn an_arm64_platform_does_not_pick_up_the_x86_category() {
        let json = r#"[
            {"name":"spring","filename":"spring_95.0_MacOSX.zip","category":"engine_macosx","version":"95.0","size":10},
            {"name":"spring","filename":"a_linux.7z","category":"engine_linux64","version":"2025.01.6","size":10}
        ]"#;
        let all: Vec<SpringFile> = serde_json::from_str(json).unwrap();
        assert!(engines_for_platform(all.clone(), "engine_macosx_arm64").is_empty());
        assert!(engines_for_platform(all, "engine_linux_arm64").is_empty());
    }

    /// The category has to be one pr-downloader's own platform switch produces,
    /// or the list and the download disagree about which build is wanted.
    #[test]
    fn the_category_is_one_pr_downloader_searches() {
        assert!([
            "engine_windows64",
            "engine_windows_arm64",
            "engine_linux64",
            "engine_linux_arm64",
            "engine_macosx_arm64",
        ]
        .contains(&springfiles_engine_category()));
    }

    #[test]
    fn match_engine_release_picks_plain_asset() {
        let json = r#"{"tag_name":"2025.06.21","prerelease":false,"assets":[
            {"name":"recoil_2025.06.21_amd64-linux-tracy.7z","browser_download_url":"http://x/tracy","size":1},
            {"name":"recoil_2025.06.21_amd64-linux-dbgsym.tar.zst","browser_download_url":"http://x/dbg","size":2},
            {"name":"recoil_2025.06.21_amd64-linux.7z","browser_download_url":"http://x/plain","size":3}
        ]}"#;
        let rel: GithubRelease = serde_json::from_str(json).unwrap();
        let m = match_engine_release(&rel, "amd64-linux.7z").unwrap();
        assert_eq!(m.version, "2025.06.21");
        assert_eq!(m.asset_url, "http://x/plain");
        assert_eq!(m.size, 3);
        // No windows asset -> no match.
        assert!(match_engine_release(&rel, "amd64-windows.7z").is_none());
    }

    #[test]
    fn parse_hakora_index_keeps_only_map_archives() {
        // Apache mod_autoindex rows: parent dir, two maps (.sd7/.sdz), an image.
        let html = r#"<table>
<tr><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=S;O=A">Size</a></th></tr>
<tr><td><img></td><td><a href="/files/springrts/">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td></tr>
<tr><td><img></td><td><a href="2lakes.sd7">2lakes.sd7</a></td><td align="right">2024-05-02 03:56  </td><td align="right">6.9M</td><td>&nbsp;</td></tr>
<tr><td><img></td><td><a href="some_map.sdz">some_map.sdz</a></td><td align="right">2024-01-01 00:00  </td><td align="right"> 12M</td><td>&nbsp;</td></tr>
<tr><td><img></td><td><a href="chobbybtop.png">chobbybtop.png</a></td><td align="right">2026-01-13 13:25  </td><td align="right">2.8M</td><td>&nbsp;</td></tr>
</table>"#;
        let maps = parse_hakora_index(html);
        assert_eq!(maps.len(), 2); // sd7 + sdz only; parent dir, headers, png excluded
        assert_eq!(maps[0].filename, "2lakes.sd7");
        assert_eq!(
            maps[0].url,
            "http://hakora.xyz/files/springrts/maps/2lakes.sd7"
        );
        assert_eq!(maps[0].size, "6.9M");
        assert_eq!(maps[1].filename, "some_map.sdz");
        assert_eq!(maps[1].size, "12M"); // right-aligned cell, trimmed
    }

    #[test]
    fn validate_repo_accepts_owner_name_and_rejects_junk() {
        assert_eq!(validate_repo("  owner/name  ").unwrap(), "owner/name");
        assert!(validate_repo("").is_err());
        assert!(validate_repo("noslash").is_err());
        assert!(validate_repo("a/b/c").is_err());
        assert!(validate_repo("owner/").is_err());
        assert!(validate_repo("/name").is_err());
        assert!(validate_repo("own er/name").is_err());
        assert!(validate_repo("../../etc/passwd").is_err());
    }

    #[test]
    fn release_info_maps_from_github_release() {
        // `name`/`body` arrive as JSON null; the mapping must not blow up.
        let json = r#"{"tag_name":"v1.3","prerelease":false,"name":null,"body":null,"assets":[
            {"name":"splinter_v1.3.sdz","browser_download_url":"http://x/g","size":42},
            {"name":"profile.json","browser_download_url":"http://x/p","size":7}
        ]}"#;
        let rel: GithubRelease = serde_json::from_str(json).unwrap();
        let info = ReleaseInfo::from(rel);
        assert_eq!(info.tag, "v1.3");
        assert_eq!(info.name, "");
        assert_eq!(info.body, "");
        assert_eq!(info.assets.len(), 2);
        assert_eq!(info.assets[0].name, "splinter_v1.3.sdz");
        assert_eq!(info.assets[0].url, "http://x/g");
        assert_eq!(info.assets[0].size, 42);
        // camelCase for the frontend (`browserDownloadUrl` -> `url`).
        let out = serde_json::to_string(&info).unwrap();
        assert!(out.contains("\"url\":\"http://x/g\""));
    }

    #[test]
    fn latest_release_url_targets_the_latest_endpoint() {
        assert_eq!(
            latest_release_url("owner/name"),
            "https://api.github.com/repos/owner/name/releases/latest"
        );
    }

    #[test]
    fn releases_url_targets_recent_releases() {
        assert_eq!(
            releases_url("owner/name"),
            "https://api.github.com/repos/owner/name/releases?per_page=30"
        );
    }

    #[test]
    fn release_archives_keeps_content_archives_and_dedupes() {
        // Two releases, newest first. Non-archive assets are dropped; the archive
        // re-uploaded in both releases collapses to the newest copy.
        let json = r#"[
            {"tag_name":"v2","prerelease":false,"assets":[
                {"name":"game_v2.sdz","browser_download_url":"http://x/2","size":20},
                {"name":"changelog.txt","browser_download_url":"http://x/c","size":1}
            ]},
            {"tag_name":"v1","prerelease":true,"assets":[
                {"name":"game_v2.sdz","browser_download_url":"http://x/2old","size":19},
                {"name":"game_v1.sd7","browser_download_url":"http://x/1","size":10}
            ]}
        ]"#;
        let rels: Vec<GithubRelease> = serde_json::from_str(json).unwrap();
        let archives = release_archives(rels);
        assert_eq!(archives.len(), 2); // .txt excluded, sdz deduped, sd7 kept
        assert_eq!(archives[0].filename, "game_v2.sdz");
        assert_eq!(archives[0].url, "http://x/2"); // newest copy wins
        assert_eq!(archives[0].tag, "v2");
        assert_eq!(archives[1].filename, "game_v1.sd7");
        assert_eq!(archives[1].tag, "v1");
        // camelCase for the frontend.
        let out = serde_json::to_string(&archives[0]).unwrap();
        assert!(out.contains("\"url\":\"http://x/2\""));
    }

    #[test]
    fn bar_map_camelcase_roundtrip() {
        let json = r#"[{"springName":"AcidicQuarry 5.17","displayName":"Acidic Quarry","author":"BasiC","filename":"acidicquarry_5.17.sd7","playerCountMax":4}]"#;
        let v: Vec<BarMap> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].spring_name, "AcidicQuarry 5.17");
        assert_eq!(v[0].player_count_max, Some(4));
        let out = serde_json::to_string(&v[0]).unwrap();
        assert!(out.contains("\"springName\":\"AcidicQuarry 5.17\""));
    }
}
