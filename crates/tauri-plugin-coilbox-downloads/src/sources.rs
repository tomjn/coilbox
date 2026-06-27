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
    fn bar_map_camelcase_roundtrip() {
        let json = r#"[{"springName":"AcidicQuarry 5.17","displayName":"Acidic Quarry","author":"BasiC","filename":"acidicquarry_5.17.sd7","playerCountMax":4}]"#;
        let v: Vec<BarMap> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].spring_name, "AcidicQuarry 5.17");
        assert_eq!(v[0].player_count_max, Some(4));
        let out = serde_json::to_string(&v[0]).unwrap();
        assert!(out.contains("\"springName\":\"AcidicQuarry 5.17\""));
    }
}
