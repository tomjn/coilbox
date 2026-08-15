//! The names and numbers coilbox and the hub have to agree on before either side
//! can move a picture (issue #1622).
//!
//! Every value here is a hard failure rather than a cosmetic drift. The hub reads
//! the pixel dimensions off the bytes rather than trusting what a client
//! declares, and it refuses a variant it does not recognise, so a name spelled
//! differently in the two repos shows up as a rejected upload on somebody's
//! machine rather than as a compile error here.
//!
//! That is why the values live in `shared/asset-vocabulary.json` and not in this
//! file. `src/hub/assets/vocabulary.ts` imports the same document, so the encoder
//! in the unitsync worker and the upload client in the hub plugin cannot disagree
//! with the renderer in the webview. Both sides embed it at build time, so the
//! tests below and `vocabulary.test.ts` are what stand between a bad edit and a
//! shipped build.
//!
//! The written half is section 14 of
//! `docs/superpowers/specs/2026-08-14-asset-pipeline-design.md`, which carries
//! the reasoning this crate only records the outcome of.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;

/// The shared document, embedded rather than read from disk: a sidecar binary and
/// the app are started from directories that have nothing to do with the repo.
const VOCABULARY_JSON: &str = include_str!("../../../shared/asset-vocabulary.json");

/// The class key every `render:<angle>` shares, since the angle is part of the
/// identity and changes nothing about what the picture may be.
pub const RENDER_CLASS: &str = "render";

/// Which of the hub's two key shapes addresses this class of picture. They are
/// different shapes on purpose and are not unified.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyedOn {
    Unit,
    Map,
}

/// What one class of picture may be, checked against the encoded bytes by the hub
/// at `lib/assets/caps.ts` (coilbox-hub#105). Coilbox holds the same numbers so it
/// can encode to them rather than discover them from a 413.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetClass {
    pub keyed_on: KeyedOn,
    /// The one type this class may be declared and encoded as.
    pub mime: String,
    /// What produced the bytes, recorded on the row so a later re-encode pass can
    /// target only what needs redoing. It names the codec, the quality and the
    /// size cap, because the job of the field is telling last year's output from
    /// this year's.
    pub encode_profile: String,
    /// Whether the encoding has to preserve every sample.
    pub lossless: bool,
    /// The WebP quality for a lossy class, and `None` for a lossless one.
    pub quality: Option<u8>,
    /// The largest either edge may be, or `None` when the source decides.
    pub max_edge_px: Option<u32>,
    /// The largest the encoded object may be, or `None` when the class has no
    /// number of its own.
    ///
    /// Derived rather than chosen: it is the uncompressed size of the largest
    /// image `max_edge_px` permits, four bytes a pixel, so no encoding of a
    /// picture this class allows can reach it and anything that does is carrying
    /// something other than the picture. `overlay:metal` and `overlay:type` fall
    /// through to [`AssetVocabulary::max_object_bytes`], and `overlay:height`
    /// gets a per-upload number out of the map's own size, which is
    /// [`height_overlay_max_bytes`].
    pub max_bytes: Option<u64>,
    pub square: bool,
    /// Bits per channel the samples must carry, or `None` for no requirement.
    pub min_bit_depth: Option<u8>,
    pub grayscale: bool,
}

/// The two variant shapes a unit has.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitVariants {
    /// The only variant a unit has besides a render.
    pub buildpic_variant: String,
    /// A unit's other variants are `render:<angle>`. The angle is part of the
    /// key, so two renders of one unit from different angles are two assets.
    pub render_variant_prefix: String,
    /// The angles worth rendering, which is one. `render:top` exists for the
    /// hub's blueprint preview and nothing else asks for another. Renders are the
    /// only class in the corpus that scales without a natural bound, so an angle
    /// added on spec is a real cost rather than a spare column.
    pub render_angles: Vec<String>,
}

/// How a top down render is framed. The rule itself is in the spec and in
/// `renderFrame` in `src/hub/assets/vocabulary.ts`, which is where the render
/// runs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFrame {
    /// The bleed a render carries on each side, in whole build squares. Models
    /// overhang their footprints, so a render framed exactly on the footprint
    /// clips them, and the consumer adds the bleed back because it knows the
    /// footprint too.
    pub bleed_squares: u32,
    /// Two of the engine's `SQUARE_SIZE`, the same 16 that `src/lego/unitDef.ts`
    /// uses.
    pub elmos_per_build_square: u32,
}

/// What turns a height overlay's declared map size into a byte cap.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeightOverlay {
    /// How many elmos one heightmap sample spans, the engine's `squareSize`.
    pub elmos_per_sample: u32,
    /// What one 16 bit grayscale sample takes before compression.
    pub bytes_per_sample: u64,
}

/// What turns a map's scanned proportions into its size in elmos.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapExtent {
    /// How many elmos one metal infomap sample spans.
    ///
    /// The metal infomap is `(mapx / 2, mapy / 2)` samples
    /// (`rts/Map/SMF/SMFMapFile.cpp:199`) and a map square is the engine's
    /// `SQUARE_SIZE` of 8 elmos, which `CSMFMapFile` refuses to load a map
    /// without, so one sample is exactly 16 elmos on every map that loads.
    pub elmos_per_metal_sample: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetVocabulary {
    pub unit: UnitVariants,
    /// A closed list, unlike the unit side. None of the four is open ended the way
    /// a render angle is, so a typo mints an identity nothing ever asks for.
    pub map_variants: Vec<String>,
    /// How the bytes were produced, not how they arrived.
    pub origins: Vec<String>,
    /// The caps, keyed on class rather than on variant, so [`RENDER_CLASS`]
    /// covers every angle.
    pub classes: BTreeMap<String, AssetClass>,
    /// The backstop for a class with no `max_bytes` of its own, matching the
    /// hub's `ASSET_MAX_OBJECT_BYTES`.
    pub max_object_bytes: u64,
    pub render_frame: RenderFrame,
    pub height_overlay: HeightOverlay,
    pub map_extent: MapExtent,
}

/// The agreed vocabulary.
///
/// Panics if the shared document does not parse, which it cannot do at runtime
/// without having failed the tests below at build time first.
pub fn vocabulary() -> &'static AssetVocabulary {
    static PARSED: OnceLock<AssetVocabulary> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(VOCABULARY_JSON)
            .expect("shared/asset-vocabulary.json is not the shape coilbox-assets reads")
    })
}

/// The caps for one variant, or `None` when it is not a variant the hub stores
/// pictures for. Mirrors the hub's `capForVariant`, including the render prefix
/// rule.
pub fn class_for_variant(variant: &str) -> Option<&'static AssetClass> {
    let vocab = vocabulary();
    if variant.starts_with(&vocab.unit.render_variant_prefix) {
        return vocab.classes.get(RENDER_CLASS);
    }
    vocab.classes.get(variant)
}

/// The full variant string for one render angle.
pub fn render_variant(angle: &str) -> String {
    format!("{}{angle}", vocabulary().unit.render_variant_prefix)
}

/// How many samples a height overlay carries along an edge that many elmos long.
/// One per heightmap vertex, so there is a fencepost more than there are squares:
/// a 16384 elmo edge is 2048 squares and 2049 samples.
pub fn height_overlay_samples(elmos: u32) -> u32 {
    elmos / vocabulary().height_overlay.elmos_per_sample + 1
}

/// The largest a height overlay for a map this size may be (coilbox-hub#142), and
/// `None` for every other class. Two bytes a sample, because the layer is 16 bit
/// grayscale rather than the four bytes a colour image takes.
pub fn height_overlay_max_bytes(variant: &str, width_elmos: u32, height_elmos: u32) -> Option<u64> {
    if variant != "overlay:height" {
        return None;
    }
    let samples = u64::from(height_overlay_samples(width_elmos))
        * u64::from(height_overlay_samples(height_elmos));
    Some(samples * vocabulary().height_overlay.bytes_per_sample)
}

/// A map's size in elmos, from the metal infomap's sample counts (issue #1629).
///
/// This is the number the hub's `map_width` and `map_height` hold, and the one
/// an overlay is lined up against. Three other counts describe the same map and
/// none of them is this:
///
/// - the metal infomap's own samples, which is what goes in, `MapItem.width`
/// - the height infomap's `(mapx + 1, mapy + 1)` vertices, a fencepost wider
///   than the squares they bound
/// - the "8 x 8" the community says, which is these elmos over 512 and a display
///   convention rather than a length. Beyond All Reason's `BarMap::map_width`
///   holds that one, so a 12 there is 6144 here.
pub fn map_extent_elmos(metal_samples_x: u32, metal_samples_z: u32) -> (u32, u32) {
    let per = vocabulary().map_extent.elmos_per_metal_sample;
    (metal_samples_x * per, metal_samples_z * per)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `shared/asset-vocabulary.json` is embedded at build time on both sides, so a
    // bad edit to it cannot reach a user's machine without failing here first.
    // That makes these assertions the guard rather than a restatement of the file:
    // every expected value is written out by hand, so changing the JSON and
    // changing the test are two separate decisions.
    //
    // `src/hub/assets/vocabulary.test.ts` asserts the same values from the
    // frontend.

    #[test]
    fn names_the_two_variants_a_unit_has() {
        let unit = &vocabulary().unit;
        assert_eq!(unit.buildpic_variant, "buildpic");
        assert_eq!(unit.render_variant_prefix, "render:");
        assert_eq!(render_variant("top"), "render:top");
    }

    #[test]
    fn renders_one_angle_because_one_has_a_use_case() {
        assert_eq!(vocabulary().unit.render_angles, ["top"]);
    }

    #[test]
    fn closes_the_map_variant_list_at_four() {
        assert_eq!(
            vocabulary().map_variants,
            ["minimap", "overlay:metal", "overlay:type", "overlay:height"]
        );
    }

    #[test]
    fn names_how_the_bytes_were_produced() {
        assert_eq!(vocabulary().origins, ["extracted", "rendered", "uploaded"]);
    }

    #[test]
    fn every_profile_names_the_codec_the_quality_and_the_cap() {
        let profile = |variant: &str| class_for_variant(variant).unwrap().encode_profile.clone();
        assert_eq!(profile("buildpic"), "webp-lossless-256");
        assert_eq!(profile("render:top"), "webp-q80-256");
        assert_eq!(profile("minimap"), "webp-q80-512");
        assert_eq!(profile("overlay:metal"), "webp-lossless-source");
        assert_eq!(profile("overlay:type"), "webp-lossless-source");
        assert_eq!(profile("overlay:height"), "png16-lossless-source");
    }

    #[test]
    fn every_profile_fits_the_column_the_hub_stores_it_in() {
        for class in vocabulary().classes.values() {
            assert!(class.encode_profile.len() <= 64, "{}", class.encode_profile);
        }
    }

    #[test]
    fn a_quality_belongs_to_exactly_the_lossy_classes() {
        for class in vocabulary().classes.values() {
            assert_eq!(
                class.quality.is_none(),
                class.lossless,
                "{}",
                class.encode_profile
            );
        }
    }

    #[test]
    fn caps_a_unit_image_at_256_and_a_minimap_at_512() {
        assert_eq!(
            class_for_variant("buildpic").unwrap().max_edge_px,
            Some(256)
        );
        assert_eq!(
            class_for_variant("render:top").unwrap().max_edge_px,
            Some(256)
        );
        assert_eq!(class_for_variant("minimap").unwrap().max_edge_px, Some(512));
    }

    #[test]
    fn leaves_the_overlays_at_the_resolution_the_map_grid_has() {
        for variant in ["overlay:metal", "overlay:type", "overlay:height"] {
            let class = class_for_variant(variant).unwrap();
            assert_eq!(class.max_edge_px, None, "{variant}");
            assert_eq!(class.max_bytes, None, "{variant}");
        }
    }

    #[test]
    fn square_is_a_build_pic_property_and_extends_to_nothing_else() {
        for (name, class) in &vocabulary().classes {
            assert_eq!(class.square, name == "buildpic", "{name}");
        }
    }

    #[test]
    fn max_bytes_is_derived_from_max_edge_at_four_bytes_a_pixel() {
        for class in vocabulary().classes.values() {
            let Some(edge) = class.max_edge_px else {
                continue;
            };
            assert_eq!(class.max_bytes, Some(u64::from(edge) * u64::from(edge) * 4));
        }
    }

    #[test]
    fn holds_the_same_two_megabyte_backstop_the_hub_does() {
        assert_eq!(vocabulary().max_object_bytes, 2 * 1024 * 1024);
    }

    #[test]
    fn height_is_16_bit_grayscale_png_and_everything_else_is_webp() {
        let height = class_for_variant("overlay:height").unwrap();
        assert_eq!(height.mime, "image/png");
        assert_eq!(height.min_bit_depth, Some(16));
        assert!(height.grayscale);

        for (name, class) in &vocabulary().classes {
            if name == "overlay:height" {
                continue;
            }
            assert_eq!(class.mime, "image/webp", "{name}");
            assert_eq!(class.min_bit_depth, None, "{name}");
            assert!(!class.grayscale, "{name}");
        }
    }

    #[test]
    fn lossless_is_required_of_every_class_carrying_data_rather_than_a_picture() {
        for variant in [
            "buildpic",
            "overlay:metal",
            "overlay:type",
            "overlay:height",
        ] {
            assert!(class_for_variant(variant).unwrap().lossless, "{variant}");
        }
        assert!(!class_for_variant("render:top").unwrap().lossless);
        assert!(!class_for_variant("minimap").unwrap().lossless);
    }

    #[test]
    fn units_key_on_the_unit_and_maps_key_on_the_map() {
        assert_eq!(
            class_for_variant("buildpic").unwrap().keyed_on,
            KeyedOn::Unit
        );
        assert_eq!(
            class_for_variant("render:top").unwrap().keyed_on,
            KeyedOn::Unit
        );
        for variant in &vocabulary().map_variants {
            assert_eq!(
                class_for_variant(variant).unwrap().keyed_on,
                KeyedOn::Map,
                "{variant}"
            );
        }
    }

    #[test]
    fn every_angle_shares_the_render_class() {
        assert!(std::ptr::eq(
            class_for_variant("render:top").unwrap(),
            class_for_variant("render:front").unwrap()
        ));
    }

    #[test]
    fn a_variant_the_hub_would_refuse_has_no_class() {
        assert!(class_for_variant("overlay:wind").is_none());
        assert!(class_for_variant("buildpics").is_none());
    }

    #[test]
    fn a_height_overlay_gets_one_sample_per_vertex_at_two_bytes_each() {
        assert_eq!(
            height_overlay_max_bytes("overlay:height", 16384, 16384),
            Some(2049 * 2049 * 2)
        );
        assert_eq!(
            height_overlay_max_bytes("overlay:metal", 16384, 16384),
            None
        );
        assert_eq!(height_overlay_max_bytes("minimap", 16384, 16384), None);
    }

    #[test]
    fn a_metal_sample_is_two_map_squares_of_eight_elmos() {
        let per = vocabulary().map_extent.elmos_per_metal_sample;
        assert_eq!(per, 16);
        // The metal infomap is half the map's square grid on each axis, and the
        // engine refuses to load a map whose square is not the eight elmos the
        // height overlay is sampled at.
        assert_eq!(per, 2 * vocabulary().height_overlay.elmos_per_sample);
    }

    /// Real numbers, read off this machine's map library with
    /// `--thumbnails`, and checked against the sizes Beyond All Reason
    /// publishes for the same maps in `lobby_maps.validated.json`. A factor
    /// that was out by two would still look like a map size, so the check that
    /// matters is against a second source rather than against arithmetic.
    #[test]
    fn turns_real_maps_metal_samples_into_their_size_in_elmos() {
        // Altored Divide Bar Remake 1.6.2, which BAR calls 16 by 16.
        assert_eq!(map_extent_elmos(512, 512), (8192, 8192));
        // Comet Catcher Remake 1.8, 16 by 12.
        assert_eq!(map_extent_elmos(512, 384), (8192, 6144));
        // Ancient Bastion Remake 0.5, 32 by 16 and the widest installed here.
        assert_eq!(map_extent_elmos(1024, 512), (16384, 8192));
        // All That Glitters Extended v1.0.2, 30 by 20, whose axes are both odd
        // multiples so a transposed conversion would show.
        assert_eq!(map_extent_elmos(960, 640), (15360, 10240));
    }

    /// The size a player says out loud, and what Beyond All Reason's own
    /// `BarMap::map_width` holds, is these elmos over 512. Keeping the two
    /// straight is the whole point of the field being named for elmos.
    #[test]
    fn the_size_a_player_says_is_this_over_512() {
        let (width, height) = map_extent_elmos(512, 384);
        assert_eq!((width / 512, height / 512), (16, 12));
    }

    #[test]
    fn a_render_frame_bleeds_one_build_square_of_sixteen_elmos() {
        let frame = &vocabulary().render_frame;
        assert_eq!(frame.bleed_squares, 1);
        assert_eq!(frame.elmos_per_build_square, 16);
    }
}
