//! One map's facts, assembled into the shape the hub takes (issue #1732).
//!
//! The type lives here rather than in the extractor because two crates need it
//! and neither can depend on the other: the unitsync worker builds an entry from
//! a mounted archive, and `tauri-plugin-coilbox-hub` puts it on the wire. A copy
//! in each would drift, and the drift would surface as a refused submission on
//! somebody's machine rather than as a compile error here.
//!
//! The field names are the hub's, snake case, because this struct *is* the
//! payload of `POST /api/v1/maps` rather than a coilbox shape that gets
//! translated on the way out. Everything else the worker emits is camelCase, and
//! the exception is deliberate: a translation step is a second place for a name
//! to be spelled, and `parseMapSubmitBody` refuses a field it does not know
//! rather than ignoring it, so a client that sent `sourceHash` would write a row
//! that dedupes against nothing and resubmit its whole corpus every run.
//!
//! What an entry carries is measurements. It carries no slug, no author split,
//! no facts digest and no tags, because the hub works all four out and would not
//! believe a client that sent them. Two coilbox releases with different ideas
//! about what makes a map a water map would otherwise produce two vocabularies
//! for one map, and the hub would have no way to tell which was current.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Everything coilbox can say about one map, as `POST /api/v1/maps` takes it.
///
/// An absent optional field is left out of the JSON rather than sent as null.
/// The hub reads the two the same way, and a batch is capped on bytes as well as
/// on maps, so the shorter body is the one that fits more maps in a request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapCatalogEntry {
    /// The full canonical name unitsync reports, version string and all, which
    /// is the whole of a map's identity to the hub. Never split.
    pub map_name: String,
    /// `name` out of `mapinfo.lua`, which is the name without the version where
    /// [`Self::map_name`] carries both.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_version: Option<String>,
    /// The whole credit string as the map wrote it. Splitting it into people is
    /// the hub's job, and a client that split it would file the map under
    /// whichever author it fancied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// The archive's real file name on disk, which is what a mirror template
    /// needs to build a download link.
    ///
    /// Not [`Self::source_archive`], which is the name the archive declares for
    /// itself and is provenance. The two are different strings for most maps:
    /// `Isis 1.3` is declared, `isis_v1.3.sd7` is the file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_filename: Option<String>,
    /// The name the archive declares for itself, which is the same string on
    /// every honest install of a build (issue #1678).
    pub source_archive: String,
    /// sha256 of the archive's bytes, hex. The hub compares on it to tell a
    /// version rollover from a corrupt install: a different hash under the same
    /// name is a different archive, and no comparison of extraction versions
    /// applies across two archives.
    pub source_hash: String,
    /// Which extraction produced this, from [`crate::catalog_version`]. The hub
    /// takes a higher version as an improvement and ignores a lower one, so this
    /// is never a number the client aims at: it names the code that read the
    /// archive.
    pub catalog_version: u32,
    /// The map's extent in elmos, which is the space every coordinate in
    /// [`Self::points`] is in.
    pub width_elmos: u32,
    pub height_elmos: u32,
    /// World height at height sample 0 and at 65535. Below zero is under the sea
    /// plane, which is what makes [`Self::water_coverage`] countable.
    pub world_height_min: f32,
    pub world_height_max: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_wind: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_wind: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tidal_strength: Option<f32>,
    /// The map hides its water plane, so terrain below the sea plane shows the
    /// skybox. A space map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub void_water: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub void_ground: Option<bool>,
    /// The share of the map under water, between 0 and 1.
    ///
    /// Absent on a map that sets [`Self::void_water`], which has no water to
    /// report a share of, and which the hub refuses an entry for. Nothing
    /// downstream can derive this: the height range says a map reaches below
    /// zero somewhere and not how much of it does, and only the extractor
    /// holding the grid can count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_coverage: Option<f64>,
    /// The water, sky and sun colours out of `mapinfo.lua`, as the map declared
    /// them. A blob the 3D preview reads and nothing queries, which is why it is
    /// one column rather than forty.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub appearance: BTreeMap<String, AppearanceValue>,
    /// Where things are on the map. Start positions come off `mapinfo.lua`,
    /// metal spots are issue #1734 and geothermal vents are #1733.
    #[serde(default, skip_serializing_if = "MapPoints::is_empty")]
    pub points: MapPoints,
}

/// One appearance value, as `mapinfo.lua` declared it.
///
/// Three shapes and no more, so the values stay the engine's own 32 bit floats
/// all the way to the wire. Holding them as JSON numbers instead would widen
/// every one of them, and a water colour would reach the hub as
/// `0.30000001192092896` where the map wrote `0.3`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AppearanceValue {
    Flag(bool),
    Number(f32),
    /// An `{r, g, b}` triple in 0..1.
    Colour([f32; 3]),
}

/// The three kinds of point the hub stores, each in its own array, matching
/// `map_point.kind`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MapPoints {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub start: Vec<MapPoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub metal: Vec<MapPoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub geo: Vec<MapPoint>,
}

impl MapPoints {
    pub fn is_empty(&self) -> bool {
        self.start.is_empty() && self.metal.is_empty() && self.geo.is_empty()
    }
}

/// One point on the map, in elmos.
///
/// `x` and `z` are the engine's own names for the two ground axes and `y` is the
/// vertical one. Calling the second ground axis `y` would put every consumer one
/// silent axis swap away from drawing the map wrongly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MapPoint {
    pub x: f32,
    pub z: f32,
    /// The height, when the thing that read the point knew it. A start position
    /// out of `mapinfo.lua` carries only the two ground axes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
    /// What this kind of point carries beyond its coordinates, as
    /// [`crate::point_kind`] lists it. Empty for a start position.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub meta: BTreeMap<String, serde_json::Value>,
}

impl MapPoint {
    /// A point that is only a coordinate, which is every start position.
    pub fn at(x: f32, z: f32) -> Self {
        Self {
            x,
            z,
            y: None,
            meta: BTreeMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, catalog_version, fact};
    use serde_json::json;

    /// Every field, so a serialisation covers the whole shape rather than the
    /// half a real map happens to fill in.
    fn full_entry() -> MapCatalogEntry {
        MapCatalogEntry {
            map_name: "Isis 1.3".into(),
            display_name: Some("Isis".into()),
            description: Some("A desert map".into()),
            map_version: Some("1.3".into()),
            author: Some("Someone, Somebody".into()),
            archive_filename: Some("isis_v1.3.sd7".into()),
            source_archive: "Isis 1.3".into(),
            source_hash: "abc123".into(),
            catalog_version: catalog_version(),
            width_elmos: 8192,
            height_elmos: 4096,
            world_height_min: -80.0,
            world_height_max: 420.5,
            min_wind: Some(5.0),
            max_wind: Some(25.0),
            tidal_strength: Some(18.0),
            void_water: Some(false),
            void_ground: Some(false),
            water_coverage: Some(0.25),
            appearance: BTreeMap::from([(
                "waterColor".into(),
                AppearanceValue::Colour([0.1, 0.2, 0.3]),
            )]),
            points: MapPoints {
                start: vec![MapPoint::at(512.0, 1024.0)],
                metal: vec![MapPoint {
                    x: 100.0,
                    z: 200.0,
                    y: Some(30.0),
                    meta: BTreeMap::from([
                        ("amount".into(), json!(2.0)),
                        ("radius".into(), json!(48.0)),
                    ]),
                }],
                geo: vec![MapPoint {
                    x: 300.0,
                    z: 400.0,
                    y: None,
                    meta: BTreeMap::from([("feature".into(), json!("geovent"))]),
                }],
            },
        }
    }

    fn keys_of(value: &serde_json::Value) -> Vec<String> {
        value
            .as_object()
            .expect("an object")
            .keys()
            .cloned()
            .collect()
    }

    /// The test that keeps this struct and `shared/map-catalog.json` one thing.
    /// A field added here without being agreed in the shared document is a field
    /// the hub refuses, and it fails here instead.
    #[test]
    fn every_field_it_sends_is_a_fact_both_sides_agreed_on() {
        let sent = serde_json::to_value(full_entry()).unwrap();
        for key in keys_of(&sent) {
            if key == "points" {
                continue;
            }
            assert!(fact(&key).is_some(), "{key} is not in the shared catalog");
        }
    }

    /// And the other direction: nothing the document calls a fact is missing
    /// from a fully populated entry.
    #[test]
    fn a_full_entry_carries_every_fact_the_document_names() {
        let sent = serde_json::to_value(full_entry()).unwrap();
        for name in catalog().facts.keys() {
            assert!(sent.get(name).is_some(), "{name} is not sent");
        }
    }

    /// The required ones survive an entry that fills in nothing else, which is
    /// what a map with a bare `mapinfo.lua` produces.
    #[test]
    fn the_required_facts_are_sent_by_an_otherwise_empty_entry() {
        let bare = MapCatalogEntry {
            display_name: None,
            description: None,
            map_version: None,
            author: None,
            archive_filename: None,
            min_wind: None,
            max_wind: None,
            tidal_strength: None,
            void_water: None,
            void_ground: None,
            water_coverage: None,
            appearance: BTreeMap::new(),
            points: MapPoints::default(),
            ..full_entry()
        };
        let sent = serde_json::to_value(&bare).unwrap();
        let required: Vec<&String> = catalog()
            .facts
            .iter()
            .filter(|(_, field)| field.required)
            .map(|(name, _)| name)
            .collect();
        for name in required {
            assert!(sent.get(name).is_some(), "{name} is not sent");
        }
        // And nothing else is, so an absent measurement is absent rather than
        // being sent as a zero the hub would store as a fact.
        assert_eq!(
            keys_of(&sent),
            [
                "catalog_version",
                "height_elmos",
                "map_name",
                "source_archive",
                "source_hash",
                "width_elmos",
                "world_height_max",
                "world_height_min",
            ]
        );
    }

    /// The names the hub's `parseMapSubmitBody` reads, spelled out rather than
    /// derived, because a rename on either side has to be a decision on both.
    #[test]
    fn the_wire_names_are_the_hubs_own() {
        let sent = serde_json::to_value(full_entry()).unwrap();
        assert_eq!(sent["map_name"], json!("Isis 1.3"));
        assert_eq!(sent["source_hash"], json!("abc123"));
        assert_eq!(sent["width_elmos"], json!(8192));
        assert_eq!(sent["world_height_min"], json!(-80.0));
        assert_eq!(sent["water_coverage"], json!(0.25));
        assert_eq!(
            sent["points"]["start"][0],
            json!({ "x": 512.0, "z": 1024.0 })
        );
        assert_eq!(
            sent["points"]["metal"][0],
            json!({ "x": 100.0, "z": 200.0, "y": 30.0, "meta": { "amount": 2.0, "radius": 48.0 } })
        );
    }

    /// The hub derives all five, and refuses an entry that names any of them,
    /// so nothing here may grow a field with one of these names.
    #[test]
    fn it_sends_nothing_the_hub_works_out_for_itself() {
        let sent = serde_json::to_value(full_entry()).unwrap();
        for name in ["slug", "tags", "curated_tags", "facts_digest", "authors"] {
            assert!(sent.get(name).is_none(), "{name} is sent");
        }
    }

    /// A point kind the hub does not store cannot be sent, because there is
    /// nowhere to put one.
    #[test]
    fn points_are_the_three_kinds_the_hub_stores() {
        let sent = serde_json::to_value(full_entry()).unwrap();
        let mut kinds = keys_of(&sent["points"]);
        kinds.sort();
        assert_eq!(kinds, ["geo", "metal", "start"]);
        for kind in kinds {
            assert!(catalog().point_kinds.contains_key(&kind), "{kind}");
        }
    }

    /// The worker writes an entry to stdout and the hub plugin reads it back, so
    /// a round trip has to give the same entry rather than a similar one.
    #[test]
    fn an_entry_survives_being_written_and_read_back() {
        let entry = full_entry();
        let text = serde_json::to_string(&entry).unwrap();
        let read: MapCatalogEntry = serde_json::from_str(&text).unwrap();
        assert_eq!(read, entry);
    }

    /// Two runs producing two orderings would give the hub two facts digests for
    /// one map, so the blob is ordered rather than insertion ordered.
    #[test]
    fn the_appearance_blob_is_written_in_a_stable_order() {
        let mut entry = full_entry();
        entry.appearance = BTreeMap::from([
            ("skyColor".into(), AppearanceValue::Colour([1.0, 1.0, 1.0])),
            ("waterAlpha".into(), AppearanceValue::Number(0.5)),
            ("fogColor".into(), AppearanceValue::Colour([0.0, 0.0, 0.0])),
        ]);
        let text = serde_json::to_string(&entry).unwrap();
        assert!(
            text.contains(
                r#""appearance":{"fogColor":[0.0,0.0,0.0],"skyColor":[1.0,1.0,1.0],"waterAlpha":0.5}"#
            ),
            "{text}"
        );
    }
}
