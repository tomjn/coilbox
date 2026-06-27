//! HTTP content sources for the Maps/Games browse screens: the springfiles
//! catalog API and Beyond All Reason's maps-metadata list. Both return JSON we
//! reshape into lean records for the frontend.

use serde::{Deserialize, Serialize};

/// One entry from the springfiles `json.php` catalog. Field names match the
/// springfiles JSON (all lowercase) and pass straight through to the frontend.
/// Unknown fields (md5, timestamp, metadata, ...) are ignored.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SpringFile {
    pub springname: String,
    pub name: String,
    pub filename: String,
    pub category: String,
    pub size: u64,
    pub mirrors: Vec<String>,
    /// Thumbnail/preview image URLs (present when queried with `images=on`).
    pub mapimages: Vec<String>,
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

/// A GitHub release (subset) from the RecoilEngine repo's releases API.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct GithubRelease {
    pub tag_name: String,
    pub prerelease: bool,
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
    fn bar_map_camelcase_roundtrip() {
        let json = r#"[{"springName":"AcidicQuarry 5.17","displayName":"Acidic Quarry","author":"BasiC","filename":"acidicquarry_5.17.sd7","playerCountMax":4}]"#;
        let v: Vec<BarMap> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].spring_name, "AcidicQuarry 5.17");
        assert_eq!(v[0].player_count_max, Some(4));
        let out = serde_json::to_string(&v[0]).unwrap();
        assert!(out.contains("\"springName\":\"AcidicQuarry 5.17\""));
    }
}
