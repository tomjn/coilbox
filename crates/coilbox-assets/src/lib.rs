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
use sha2::{Digest, Sha256};

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
    /// through to [`AssetVocabulary::max_object_bytes`], because they are the two
    /// classes stored at whatever grid the map has.
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

/// This build's name for the document above: `sha256:` and the lowercase hex
/// digest of its bytes (issue #1708).
///
/// Over the bytes rather than over anything parsed out of them, so neither side
/// has to agree about key order, indentation or how a number is spelled. The hub
/// vendors this exact file and digests it the same way, so two builds that hold
/// the same document produce the same string and two that do not, do not.
///
/// The bytes are pinned to LF by `.gitattributes`. Without that a Windows
/// checkout would embed CRLF, and every Windows build would call itself out of
/// date against a hub that had never changed.
pub fn vocabulary_digest() -> &'static str {
    static DIGEST: OnceLock<String> = OnceLock::new();
    DIGEST.get_or_init(|| {
        let digest = Sha256::digest(VOCABULARY_JSON.as_bytes());
        format!("sha256:{}", hex(&digest))
    })
}

/// Lowercase hex, two digits a byte.
///
/// Spelled out because sha2 0.11's output type does not format itself. Its
/// predecessor's did, and `{:x}` over that produced exactly this, which the
/// pinned digest below is the check on.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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

/// The frame one unit's top down render is taken in, from its footprint.
///
/// The Rust twin of `RenderFrame` in `src/hub/assets/vocabulary.ts`. The render
/// itself runs in the webview, so the TS side is what places the camera. This
/// side exists so the encoder can refuse a picture that is not the shape the
/// footprint says it should be. That check is the only one anywhere: the hub
/// does not hold footprints, so a mis-framed render is caught here or nowhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RenderFraming {
    /// The framed extent, footprint plus the bleed on both sides.
    pub squares_x: u32,
    pub squares_z: u32,
    /// The same extent in elmos, which is what the orthographic camera is set to.
    pub width_elmos: u32,
    pub height_elmos: u32,
    /// The encoded image, at the class cap or under it, in the footprint's aspect.
    pub width_px: u32,
    pub height_px: u32,
    /// Whole pixels per build square, so the aspect is exact rather than rounded.
    pub pixels_per_square: u32,
}

/// The frame for a top down render of a unit with this footprint (issue #1631).
///
/// The footprint sets the aspect. A 3 by 2 building renders 3 by 2 and never
/// square, because the picture exists to tile into a base layout and a square one
/// does not.
///
/// `footprint_x` and `footprint_z` are the unitdef's `footprintx` and
/// `footprintz` in build squares, as `--unit-dataset` reports them, and the
/// engine floors both at 1.
///
/// Pixels come out as a whole number per square so the encoded aspect is exactly
/// the framed aspect rather than a rounding of it, and the longest edge lands at
/// or under the class cap without a separate check.
pub fn render_frame(footprint_x: u32, footprint_z: u32) -> RenderFraming {
    let vocab = vocabulary();
    let bleed = 2 * vocab.render_frame.bleed_squares;
    let squares_x = footprint_x.max(1) + bleed;
    let squares_z = footprint_z.max(1) + bleed;

    let cap = vocab
        .classes
        .get(RENDER_CLASS)
        .and_then(|c| c.max_edge_px)
        .unwrap_or(0);
    let pixels_per_square = (cap / squares_x.max(squares_z)).max(1);
    let per = vocab.render_frame.elmos_per_build_square;

    RenderFraming {
        squares_x,
        squares_z,
        width_elmos: squares_x * per,
        height_elmos: squares_z * per,
        width_px: squares_x * pixels_per_square,
        height_px: squares_z * pixels_per_square,
        pixels_per_square,
    }
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
        assert_eq!(profile("overlay:height"), "webp-lossless-512");
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
        // 512 is where the terrain mesh stops being able to show more detail,
        // which is what issue #1730 caps the height picture on.
        assert_eq!(
            class_for_variant("overlay:height").unwrap().max_edge_px,
            Some(512)
        );
    }

    #[test]
    fn leaves_the_sample_overlays_at_the_resolution_the_map_grid_has() {
        for variant in ["overlay:metal", "overlay:type"] {
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

    /// Every class is WebP now that the height overlay is (issue #1730). It is
    /// grey pixels, but nothing may say so: WebP has no grayscale mode, so the
    /// bytes are RGB with the three channels equal and the hub's header reader
    /// cannot tell that from any other picture.
    #[test]
    fn every_class_is_webp_and_none_of_them_declares_a_depth_or_a_channel_count() {
        for (name, class) in &vocabulary().classes {
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

    /// The expected value comes from `shasum -a 256 shared/asset-vocabulary.json`,
    /// a tool with no idea this crate exists, so this asserts the digest is over
    /// the file on disk rather than over whatever the code happened to feed it.
    ///
    /// It fails whenever the vocabulary changes, on purpose. A changed vocabulary
    /// is the moment the hub has to vendor the new one, and a test that quietly
    /// followed the file would let that pass unnoticed.
    #[test]
    fn digests_the_shared_document_as_an_outside_tool_does() {
        assert_eq!(
            vocabulary_digest(),
            "sha256:66f986361a51d8486b619b2f5a541f4e207ad4309e0a8a0ae2597b859daf84bd"
        );
    }

    /// The `sha256:` prefix is part of the value, because the hub serves it that
    /// way and a comparison that has to strip something is a comparison that can
    /// strip it differently on the two sides.
    #[test]
    fn the_digest_names_its_own_algorithm() {
        let digest = vocabulary_digest();
        let hex = digest.strip_prefix("sha256:").expect("prefixed");
        assert_eq!(hex.len(), 64);
        assert!(hex
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
    }

    #[test]
    fn a_variant_the_hub_would_refuse_has_no_class() {
        assert!(class_for_variant("overlay:wind").is_none());
        assert!(class_for_variant("buildpics").is_none());
    }

    #[test]
    fn a_metal_sample_is_two_map_squares() {
        // The metal infomap is half the map's square grid on each axis, and the
        // engine refuses to load a map whose square is not eight elmos.
        assert_eq!(vocabulary().map_extent.elmos_per_metal_sample, 16);
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

    /// The whole of #1631, and the one rule nothing downstream can check: a 3 by
    /// 2 building comes out 3 by 2. The numbers are worked by hand rather than
    /// from the function, so a change to the framing is a change to this test.
    #[test]
    fn a_footprint_that_is_not_square_frames_a_picture_that_is_not_square() {
        // 3 by 2 plus a square of bleed each side is 5 by 4 squares. The longest
        // edge takes floor(256 / 5) = 51 pixels a square, so 255 by 204.
        let frame = render_frame(3, 2);
        assert_eq!((frame.squares_x, frame.squares_z), (5, 4));
        assert_eq!((frame.width_px, frame.height_px), (255, 204));
        assert_eq!(frame.pixels_per_square, 51);

        // And the aspect really is the footprint's, not the frame's, once the
        // bleed is taken back off: 3 squares of 51 by 2 squares of 51.
        let inset_w = frame.width_px - 2 * frame.pixels_per_square;
        let inset_h = frame.height_px - 2 * frame.pixels_per_square;
        assert_eq!((inset_w, inset_h), (153, 102));
        assert_eq!(inset_w * 2, inset_h * 3);
    }

    /// A transposed footprint transposes the picture. The failure this catches is
    /// an implementation that takes the larger of the two and squares up.
    #[test]
    fn transposing_the_footprint_transposes_the_frame() {
        let wide = render_frame(3, 2);
        let tall = render_frame(2, 3);
        assert_eq!(
            (wide.width_px, wide.height_px),
            (tall.height_px, tall.width_px)
        );
        assert_ne!(wide.width_px, wide.height_px);
    }

    #[test]
    fn the_frame_carries_a_whole_build_square_of_bleed_on_every_side() {
        for (fx, fz) in [(1, 1), (3, 2), (8, 8), (12, 5)] {
            let frame = render_frame(fx, fz);
            assert_eq!(frame.squares_x, fx + 2, "{fx}x{fz}");
            assert_eq!(frame.squares_z, fz + 2, "{fx}x{fz}");
            // The consumer adds it back by insetting one square on each side, so
            // the bleed has to be a whole number of pixels.
            assert_eq!(frame.width_px % frame.squares_x, 0, "{fx}x{fz}");
            assert_eq!(frame.height_px % frame.squares_z, 0, "{fx}x{fz}");
        }
    }

    /// Whole pixels a square is what makes the encoded aspect exactly the framed
    /// aspect rather than a rounding of it, so it is asserted over the range of
    /// footprints games actually ship rather than at one size.
    #[test]
    fn every_footprint_gets_a_whole_number_of_pixels_a_square() {
        for fx in 1..=20u32 {
            for fz in 1..=20u32 {
                let frame = render_frame(fx, fz);
                assert!(frame.pixels_per_square >= 1, "{fx}x{fz}");
                assert_eq!(
                    frame.width_px,
                    frame.squares_x * frame.pixels_per_square,
                    "{fx}x{fz}"
                );
                assert_eq!(
                    frame.height_px,
                    frame.squares_z * frame.pixels_per_square,
                    "{fx}x{fz}"
                );
            }
        }
    }

    /// The longest edge lands at or under the class cap without a separate check,
    /// which is why the pixels a square are floored rather than rounded.
    #[test]
    fn no_footprint_frames_a_picture_over_the_class_cap() {
        let cap = class_for_variant("render:top")
            .unwrap()
            .max_edge_px
            .unwrap();
        for fx in 1..=64u32 {
            for fz in 1..=64u32 {
                let frame = render_frame(fx, fz);
                assert!(frame.width_px <= cap, "{fx}x{fz}");
                assert!(frame.height_px <= cap, "{fx}x{fz}");
            }
        }
    }

    /// The engine floors a footprint at one square, so a def that declares none
    /// frames the same picture as a def that declares one.
    #[test]
    fn a_footprint_of_zero_frames_as_one_square() {
        assert_eq!(render_frame(0, 0), render_frame(1, 1));
        // 1 by 1 is 3 by 3 squares at 85 pixels each, one short of the cap.
        assert_eq!(render_frame(1, 1).width_px, 255);
    }

    /// The camera extent is the framed squares in elmos, so a 3 by 2 building is
    /// looked at across 80 by 64 elmos rather than across its own 48 by 32.
    #[test]
    fn the_camera_sees_the_footprint_plus_the_bleed_in_elmos() {
        let frame = render_frame(3, 2);
        assert_eq!((frame.width_elmos, frame.height_elmos), (80, 64));
        assert_eq!(frame.width_elmos, frame.squares_x * 16);
    }
}
