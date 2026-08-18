//! What coilbox and the hub have to agree on before a map's facts can move
//! between them (issue #1735).
//!
//! The catalog is the twin of the asset vocabulary and not part of it. That file
//! says how a picture is encoded and how large it may be, and the hub's upload
//! validator reads every entry in it. Nothing here is about bytes. They also
//! must not share a digest: tying them would tell a client its asset vocabulary
//! had moved every time a clustering parameter changed, and the client's correct
//! response to that is to stop uploading pictures.
//!
//! So the values live in `shared/map-catalog.json`, which the hub vendors byte
//! for byte through `bun run sync:vendor` and serves the digest of on
//! `/api/v1/auth` beside `asset_vocabulary` (coilbox-hub#185). This crate is the
//! Rust half, mirroring `coilbox-assets`: the parsed document, the caps and a
//! digest.
//!
//! One number a reader might expect is deliberately absent. The metal density
//! grid is 16 elmos a sample, and that lives in `mapExtent` in the asset
//! vocabulary, where the overlay that draws the same grid already reads it.
//! Repeating it here would be two sources for one measurement.
//!
//! The written half is `docs/superpowers/specs/2026-08-18-map-catalog-design.md`
//! in the hub repository, which carries the reasoning this crate only records the
//! outcome of.

mod entry;

pub use entry::{AppearanceValue, MapCatalogEntry, MapPoint, MapPoints};

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The shared document, embedded rather than read from disk: the sidecar binary
/// that extracts a map is started from a directory that has nothing to do with
/// the repo.
const CATALOG_JSON: &str = include_str!("../../../shared/map-catalog.json");

/// What a fact is carried as on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactType {
    String,
    Integer,
    Number,
    Boolean,
    /// Only `appearance`, which is the blob the 3D preview reads and nothing
    /// queries.
    Object,
}

/// What a number means, which is the half of a fact that a type cannot carry.
///
/// A closed list rather than free text, so a unit spelled differently on the two
/// sides fails to parse here instead of being stored as a different quantity
/// there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Unit {
    /// The engine's world unit. Every length and every coordinate is one of
    /// these, including the height range, so nothing has to know what a map
    /// square is to read a fact.
    #[serde(rename = "elmos")]
    Elmos,
    /// Wind and tidal, which are what a generator standing in them produces.
    /// Comparable to a solar collector's 20, which is the comparison the hub's
    /// `windy` and `tidal` tags make.
    #[serde(rename = "strength")]
    Strength,
    /// A fraction of a whole, between zero and one. `water_coverage` is the
    /// share of height samples below zero, so a fifth of a map under water is
    /// 0.2 rather than 20.
    #[serde(rename = "share")]
    Share,
    /// What an extractor covering the whole spot pulls out of it, which is the
    /// map's own `maxMetal` applied to the density under it.
    #[serde(rename = "metal per second")]
    MetalPerSecond,
}

/// One field of a catalog entry.
#[derive(Debug, Clone, Deserialize)]
pub struct Field {
    #[serde(rename = "type")]
    pub value_type: FactType,
    /// The quantity, or `None` for a name, a hash or a flag.
    pub unit: Option<Unit>,
    /// Whether an entry without it is malformed rather than incomplete. A map
    /// with no author in its `mapinfo.lua` still has facts worth holding, so
    /// most of the descriptive half is optional.
    pub required: bool,
}

/// One kind of point on a map, matching `map_point.kind` on the hub.
#[derive(Debug, Clone, Deserialize)]
pub struct PointKind {
    /// What that kind carries beyond its coordinates. A start position carries
    /// nothing, so this is empty for `start`.
    pub meta: BTreeMap<String, Field>,
}

/// What counts as one metal spot.
///
/// Every other catalog fact is read from a value in the archive, so two clients
/// cannot disagree about it. A clustering pass is a choice, and the hub's
/// conflict rule only holds while that choice is versioned: a release that
/// changed what a spot is without bumping [`MapCatalog::catalog_version`] would
/// make every honest client look like it was reporting different facts, and the
/// symptom would be a flood of conflicts rather than an obvious bug
/// (issue #1734).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetalClustering {
    /// The share of full scale a density sample has to reach to be metal at all.
    /// A map with a flat trace of density everywhere produces no spots rather
    /// than one covering the map.
    pub min_density_share: f64,
    /// How far apart two spot centres have to be, in elmos, to be two spots.
    pub min_separation_elmos: f64,
    /// The least a spot may be worth, in the same metal per second its `amount`
    /// is reported in. Below it the cluster is noise rather than a spot.
    pub min_spot_metal: f64,
}

/// How much of the catalog fits in one request, matching what the hub's routes
/// refuse with a 413.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    /// Keys on one `POST /api/v1/maps/have` (coilbox-hub#186).
    pub have_keys: usize,
    /// Maps on one `POST /api/v1/maps` (coilbox-hub#187).
    pub submit_maps: usize,
    /// The body cap on that same route, which a batch of large descriptions can
    /// reach before it reaches [`Caps::submit_maps`], so a client batching on
    /// the count alone still has to weigh what it has assembled.
    pub submit_bytes: usize,
    /// Names on one `POST /api/v1/maps/lookup` (coilbox-hub#188).
    pub lookup_names: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCatalog {
    /// Which extraction produced an entry, bumped whenever extraction changes
    /// what it produces for the same archive, a bug fix that makes a field more
    /// accurate included.
    ///
    /// The hub takes a higher version as an improvement and replaces the stored
    /// row, and ignores a lower one, so an old build cannot talk the catalog
    /// backwards. That only works while the bump happens: leaving it alone after
    /// a change means every client reporting the corrected value is refused as a
    /// conflict.
    pub catalog_version: u32,
    /// The fields of an entry besides its points, keyed on the name they go over
    /// the wire under.
    pub facts: BTreeMap<String, Field>,
    /// The three kinds of point an entry carries, keyed as the hub's
    /// `map_point.kind` check spells them.
    pub point_kinds: BTreeMap<String, PointKind>,
    pub metal_clustering: MetalClustering,
    pub caps: Caps,
}

/// The agreed catalog vocabulary.
///
/// Panics if the shared document does not parse, which it cannot do at runtime
/// without having failed the tests below at build time first.
pub fn catalog() -> &'static MapCatalog {
    static PARSED: OnceLock<MapCatalog> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(CATALOG_JSON)
            .expect("shared/map-catalog.json is not the shape coilbox-map-catalog reads")
    })
}

/// This build's name for the document above: `sha256:` and the lowercase hex
/// digest of its bytes.
///
/// Over the bytes rather than over anything parsed out of them, so neither side
/// has to agree about key order, indentation or how a number is spelled. The hub
/// vendors this exact file and digests it the same way, so two builds holding
/// the same document produce the same string and two that do not, do not.
///
/// Separate from `coilbox_assets::vocabulary_digest` on purpose. A client told
/// its asset vocabulary has moved should stop uploading pictures, and a
/// clustering parameter is no reason for that.
///
/// The bytes are pinned to LF by `.gitattributes`. Without that a Windows
/// checkout would embed CRLF, and every Windows build would call itself out of
/// date against a hub that had never changed.
pub fn catalog_digest() -> &'static str {
    static DIGEST: OnceLock<String> = OnceLock::new();
    DIGEST.get_or_init(|| {
        let digest = Sha256::digest(CATALOG_JSON.as_bytes());
        format!("sha256:{digest:x}")
    })
}

/// What goes in `catalog_version` on every entry this build submits.
pub fn catalog_version() -> u32 {
    catalog().catalog_version
}

/// The request caps, so a batch is built to the numbers the hub refuses at
/// rather than to a constant that can drift from them.
pub fn caps() -> &'static Caps {
    &catalog().caps
}

/// One fact's type and unit, or `None` for a name the entry does not carry.
pub fn fact(name: &str) -> Option<&'static Field> {
    catalog().facts.get(name)
}

/// One kind of point, or `None` for a kind the hub's check would refuse.
pub fn point_kind(kind: &str) -> Option<&'static PointKind> {
    catalog().point_kinds.get(kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `shared/map-catalog.json` is embedded at build time and vendored by the
    // hub, so a bad edit to it cannot reach a user's machine without failing
    // here first. Every expected value is written out by hand, so changing the
    // JSON and changing the test stay two separate decisions.

    /// Version 2 reads a map's geothermal vents out of its feature block, which
    /// version 1 did not (issue #1733). The bump is what makes the hub take a
    /// re-read of an archive it already holds as an improvement rather than
    /// refusing it as a conflict.
    #[test]
    fn names_the_extraction_that_produced_an_entry() {
        assert_eq!(catalog_version(), 2);
    }

    /// The expected value comes from `shasum -a 256 shared/map-catalog.json`, a
    /// tool with no idea this crate exists, so this asserts the digest is over
    /// the file on disk rather than over whatever the code happened to feed it.
    ///
    /// It fails whenever the catalog changes, on purpose. A changed catalog is
    /// the moment the hub has to vendor the new one, and a test that quietly
    /// followed the file would let that pass unnoticed.
    #[test]
    fn digests_the_shared_document_as_an_outside_tool_does() {
        assert_eq!(
            catalog_digest(),
            "sha256:6fecb01361f857e828b00f267c8c3291d209445ceda41fe0747a9100773f3c7c"
        );
    }

    /// The `sha256:` prefix is part of the value, because the hub serves it that
    /// way and a comparison that has to strip something is a comparison that can
    /// strip it differently on the two sides.
    #[test]
    fn the_digest_names_its_own_algorithm() {
        let digest = catalog_digest();
        let hex = digest.strip_prefix("sha256:").expect("prefixed");
        assert_eq!(hex.len(), 64);
        assert!(hex
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
    }

    /// The two documents are digested apart, which is the whole reason this is a
    /// second file.
    #[test]
    fn does_not_share_a_digest_with_the_asset_vocabulary() {
        assert_ne!(
            catalog_digest(),
            "sha256:66f986361a51d8486b619b2f5a541f4e207ad4309e0a8a0ae2597b859daf84bd"
        );
    }

    /// The point of digesting the bytes: an edit anywhere in the document is a
    /// different name for it, so a client and a hub holding different copies
    /// cannot agree by accident.
    #[test]
    fn a_changed_document_is_a_changed_digest() {
        let edited = CATALOG_JSON.replace("\"catalogVersion\": 2", "\"catalogVersion\": 3");
        assert_ne!(edited, CATALOG_JSON, "the replacement matched nothing");
        let edited_digest = format!("sha256:{:x}", Sha256::digest(edited.as_bytes()));
        assert_ne!(catalog_digest(), edited_digest);
    }

    #[test]
    fn holds_the_caps_the_hub_refuses_at() {
        let caps = caps();
        assert_eq!(caps.have_keys, 500);
        assert_eq!(caps.submit_maps, 50);
        assert_eq!(caps.submit_bytes, 1024 * 1024);
        assert_eq!(caps.lookup_names, 500);
    }

    /// A cap restated as a constant is a cap that drifts from the route it
    /// describes, so this reads an edited document back to prove the number
    /// comes from the file.
    #[test]
    fn the_caps_come_from_the_document_rather_than_from_a_constant() {
        let edited = CATALOG_JSON.replace("\"submitMaps\": 50", "\"submitMaps\": 7");
        assert_ne!(edited, CATALOG_JSON, "the replacement matched nothing");
        let parsed: MapCatalog = serde_json::from_str(&edited).expect("parses");
        assert_eq!(parsed.caps.submit_maps, 7);
        assert_eq!(caps().submit_maps, 50);
    }

    /// A map is keyed on its full canonical name and hashed on its bytes, and
    /// nothing downstream of extraction can recover its size or its height
    /// range, so those are the fields an entry is malformed without.
    #[test]
    fn requires_the_facts_nothing_else_could_supply() {
        let required: Vec<&str> = catalog()
            .facts
            .iter()
            .filter(|(_, field)| field.required)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            required,
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

    /// What a mapper wrote is missing often enough that an entry without it is
    /// still worth holding.
    #[test]
    fn asks_for_no_field_a_mapinfo_may_leave_out() {
        for name in [
            "display_name",
            "description",
            "map_version",
            "author",
            "min_wind",
            "max_wind",
            "tidal_strength",
            "void_water",
            "void_ground",
        ] {
            assert!(!fact(name).expect(name).required, "{name}");
        }
    }

    #[test]
    fn measures_every_length_in_elmos() {
        for name in [
            "width_elmos",
            "height_elmos",
            "world_height_min",
            "world_height_max",
        ] {
            assert_eq!(fact(name).expect(name).unit, Some(Unit::Elmos), "{name}");
        }
    }

    /// The size a player says out loud is the elmos over 512, and the height
    /// range is elmos too, which is what stops a reader treating one as squares
    /// and the other as samples.
    #[test]
    fn the_two_extents_are_integers_and_the_height_range_is_not() {
        assert_eq!(fact("width_elmos").unwrap().value_type, FactType::Integer);
        assert_eq!(fact("height_elmos").unwrap().value_type, FactType::Integer);
        assert_eq!(
            fact("world_height_min").unwrap().value_type,
            FactType::Number
        );
        assert_eq!(
            fact("world_height_max").unwrap().value_type,
            FactType::Number
        );
    }

    /// Wind and tidal are what a generator standing in them produces, which is
    /// the number the hub compares against a solar collector's 20.
    #[test]
    fn wind_and_tidal_are_strengths() {
        for name in ["min_wind", "max_wind", "tidal_strength"] {
            assert_eq!(fact(name).expect(name).unit, Some(Unit::Strength), "{name}");
        }
    }

    /// A fifth of a map under water is 0.2 here. Reporting it as 20 would tag
    /// every map with a puddle as a water map.
    #[test]
    fn water_coverage_is_a_share_rather_than_a_percentage() {
        let field = fact("water_coverage").unwrap();
        assert_eq!(field.unit, Some(Unit::Share));
        assert_eq!(field.value_type, FactType::Number);
        assert!(!field.required);
    }

    /// Only the appearance blob, and only because sixteen float triples nothing
    /// will ever query are worse as forty columns.
    #[test]
    fn one_field_is_a_blob_and_it_is_the_one_only_the_preview_reads() {
        let blobs: Vec<&str> = catalog()
            .facts
            .iter()
            .filter(|(_, field)| field.value_type == FactType::Object)
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(blobs, ["appearance"]);
    }

    /// A name, a hash or a flag has no unit, and nothing carries a unit the two
    /// sides have not agreed on.
    #[test]
    fn the_fields_without_a_quantity_declare_no_unit() {
        for name in [
            "map_name",
            "display_name",
            "description",
            "map_version",
            "author",
            "archive_filename",
            "source_archive",
            "source_hash",
            "catalog_version",
            "void_water",
            "void_ground",
            "appearance",
        ] {
            assert_eq!(fact(name).expect(name).unit, None, "{name}");
        }
    }

    /// The hub derives the slug, splits the credits and works out the tags, so
    /// an entry carries no conclusion for it to believe.
    #[test]
    fn carries_no_field_the_hub_derives_for_itself() {
        for name in ["slug", "tags", "curated_tags", "facts_digest", "authors"] {
            assert!(fact(name).is_none(), "{name}");
        }
    }

    #[test]
    fn names_the_three_kinds_of_point_the_hub_stores() {
        let kinds: Vec<&str> = catalog()
            .point_kinds
            .keys()
            .map(|kind| kind.as_str())
            .collect();
        assert_eq!(kinds, ["geo", "metal", "start"]);
        assert!(point_kind("mex").is_none());
    }

    /// A start position is a coordinate and nothing else. A spot is worth an
    /// amount over an area, and a vent is worth the feature that marks it.
    #[test]
    fn each_kind_carries_what_a_coordinate_does_not_say() {
        assert!(point_kind("start").unwrap().meta.is_empty());

        let metal = &point_kind("metal").unwrap().meta;
        assert_eq!(metal["amount"].unit, Some(Unit::MetalPerSecond));
        assert_eq!(metal["radius"].unit, Some(Unit::Elmos));
        assert!(metal.values().all(|field| field.required));

        let geo = &point_kind("geo").unwrap().meta;
        assert_eq!(geo["feature"].value_type, FactType::String);
        assert_eq!(geo["feature"].unit, None);
    }

    /// The parameters exist so that changing one is a change to the file and to
    /// [`MapCatalog::catalog_version`], rather than a release quietly deciding
    /// what a spot is.
    #[test]
    fn holds_every_parameter_a_spot_depends_on() {
        let clustering = catalog().metal_clustering;
        assert_eq!(clustering.min_density_share, 0.02);
        assert_eq!(clustering.min_separation_elmos, 96.0);
        assert_eq!(clustering.min_spot_metal, 0.5);
    }

    /// A share of full scale, so a threshold that was really a raw sample value
    /// would show here rather than as an empty catalog.
    #[test]
    fn the_density_threshold_is_a_share_of_full_scale() {
        let share = catalog().metal_clustering.min_density_share;
        assert!(share > 0.0 && share < 1.0, "{share}");
    }
}
