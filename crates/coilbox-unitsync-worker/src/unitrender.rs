//! `--unit-render` mode: turn pixels the webview drew into the hub's
//! `render:<angle>` asset (issue #1631).
//!
//! This mode does not draw anything. The render runs in the webview, where the
//! s3o and 3do readers already have a three.js scene to put a model in, and the
//! pixels arrive here as a raw RGBA buffer in a file. What this side owns is
//! everything the picture has to be checked and named against:
//!
//! - **The framing.** A plan's aspect has to be its footprint's and a picture of
//!   a unit has to be square, and the hub can check neither because it does not
//!   hold footprints. So the shape is recomputed here from the angle and the
//!   footprint through `coilbox_assets::render_pixels`, and the pixels are
//!   refused if they are not it. A mis-framed render is caught here or nowhere.
//! - **The encoding.** `assetencode::encode_variant` is the corpus's one
//!   encoder. A canvas can write WebP itself, and the easy path would be to let
//!   it. Measured on one real render, the Armada Vehicle Plant at 250x200:
//!   `canvas.toBlob('image/webp', 0.8)` produces 3192 bytes and the `webp`
//!   crate at quality 80 produces 2720, from the same pixels. Both keep the
//!   alpha exactly, so the picture is the same picture, but the bytes are not
//!   the same bytes, and `webp-q80-256` would then name two different things
//!   depending on which machine encoded a row. That is the drift `encode_profile`
//!   exists to make legible, so the pixels take the long way round and the
//!   corpus keeps one encoder.
//! - **The identity.** `source_hash` is over the render's inputs, not its
//!   pixels, so the model and its textures are read out of the archive here,
//!   unless the caller already holds them (see [`RenderSource`]).
//!
//! Reading the archive is the only reason this mode needs unitsync at all.

use std::path::Path;

use base64::Engine;

use crate::assetencode::RENDERED_ORIGIN;
use crate::ffi::Unitsync;
use crate::model::{RenderSkip, UnitRenderAsset, UnitRenderOutput};

/// Four channels a pixel, straight alpha, top row first. The webview flips the
/// framebuffer and un-premultiplies before it gets here, so this is exactly what
/// the encoder should see.
const CHANNELS: usize = 4;

/// What the render was drawn from, when the caller already knows (issue #1720).
///
/// These are the three fields `--unit-render-keys` hands back for the same unit
/// at the same footprint, and reading them again costs a mount of the game's
/// archive set: a second or more on a game like Beyond All Reason, paid once per
/// unit a blueprint draws.
///
/// Handing them in moves the check that a picture is named after what it is from
/// this mode to the caller. That is a narrower loss than it reads as, because
/// both callers are ours and both derive the key from `--unit-render-keys`. The
/// framing check does not move: a caller can say what the pixels were drawn from
/// but not what shape they are.
#[derive(Clone, Copy)]
pub struct RenderSource<'a> {
    /// sha256 over the model file and its textures, from the key.
    pub model_digest: &'a str,
    /// The archive member the model was read from, from the key.
    pub source_member: &'a str,
    /// The name the game archive declares for itself, which is what the hub row
    /// holds. See [`crate::archive::archive_name_for_game`].
    pub source_archive: &'a str,
}

/// What the caller drew and wants encoded.
pub struct RenderRequest<'a> {
    pub game_archive: &'a str,
    /// The unitdef's `objectname` verbatim, the same string `--unit-model` takes.
    pub object_name: &'a str,
    /// The angle, without the `render:` prefix. Checked against the vocabulary's
    /// list rather than accepted, so a typo cannot mint an identity the hub has
    /// no reader for.
    pub angle: &'a str,
    pub footprint_x: u32,
    pub footprint_z: u32,
    /// Which renderer drew the pixels, from `RENDER_VERSION` in
    /// `src/hub/assets/renderTop.ts`.
    pub renderer_version: u32,
    /// A file holding `width * height * 4` bytes of RGBA. A file rather than an
    /// argument because a 256 square render is a quarter of a megabyte, which is
    /// past what a command line takes.
    pub pixels: &'a Path,
    pub width: u32,
    pub height: u32,
    pub asset_dir: &'a Path,
    /// The identity of what was drawn, when the caller already has it. `None`
    /// reads it out of the archive, which is what happens for a caller that has
    /// no key to hand down.
    pub source: Option<RenderSource<'a>>,
}

/// Encode one unit's render, mounting `game_archive` to read what it was drawn
/// from unless `req.source` says.
pub fn render(lib: &str, req: &RenderRequest<'_>) -> UnitRenderOutput {
    // The checks that need nothing but the request come first, so a mis-framed
    // render costs no archive mount.
    let variant = match variant_for(req.angle) {
        Some(v) => v,
        None => return skipped(RenderSkip::UnknownAngle, Vec::new()),
    };
    let (width_px, height_px) =
        coilbox_assets::render_pixels(req.angle, req.footprint_x, req.footprint_z);
    if (req.width, req.height) != (width_px, height_px) {
        return skipped(
            RenderSkip::MisFramed,
            vec![format!(
                "a {}x{} footprint frames a {:?} render to {}x{} pixels, and the render is {}x{}",
                req.footprint_x,
                req.footprint_z,
                req.angle,
                width_px,
                height_px,
                req.width,
                req.height
            )],
        );
    }
    let pixels = match read_pixels(req.pixels, req.width, req.height) {
        Ok(p) => p,
        Err(why) => return skipped(RenderSkip::NoPixels, vec![why]),
    };

    // The caller holding the key is the whole of issue #1720: unitsync is not
    // loaded at all on this path, so a blueprint's twenty encodes cost no mounts.
    let (model_digest, source_member, source_archive, errors) = match req.source {
        Some(source) => (
            source.model_digest.to_string(),
            source.source_member.to_string(),
            source.source_archive.to_string(),
            Vec::new(),
        ),
        None => {
            let us = match unsafe { Unitsync::load(Path::new(lib)) } {
                Ok(u) => u,
                Err(e) => return skipped(RenderSkip::NoModel, vec![e]),
            };
            us.init(false, 0);
            let mut errors = us.drain_errors();

            let digest = read_source_digest(&us, req, &mut errors);
            // Read inside the session, since the archive list goes with unitsync.
            let source_archive = crate::archive::archive_name_for_game(&us, req.game_archive);
            us.uninit();

            match digest {
                Ok((model_digest, source_member)) => {
                    (model_digest, source_member, source_archive, errors)
                }
                Err(why) => {
                    errors.push(why);
                    return skipped(RenderSkip::NoModel, errors);
                }
            }
        }
    };

    let source_hash = crate::assetencode::render_source_hash(
        &variant,
        req.renderer_version,
        req.footprint_x,
        req.footprint_z,
        width_px,
        height_px,
        &model_digest,
    );

    match encode_asset(
        req,
        &variant,
        pixels,
        &model_digest,
        &source_member,
        source_hash,
        &source_archive,
    ) {
        Ok((asset, data_url)) => UnitRenderOutput {
            asset: Some(asset),
            data_url: Some(data_url),
            errors,
            ..Default::default()
        },
        Err(why) => UnitRenderOutput {
            asset_skipped: Some(why),
            errors,
            ..Default::default()
        },
    }
}

/// The full variant for `angle`, or `None` when the vocabulary does not list it.
fn variant_for(angle: &str) -> Option<String> {
    coilbox_assets::vocabulary()
        .unit
        .render_angles
        .iter()
        .any(|a| a == angle)
        .then(|| coilbox_assets::render_variant(angle))
}

/// Mount the game's archives, read what the render was taken of, and unmount.
fn read_source_digest(
    us: &Unitsync,
    req: &RenderRequest<'_>,
    errors: &mut Vec<String>,
) -> Result<(String, String), String> {
    if !us.add_all_archives(req.game_archive) {
        return Err("this engine's libunitsync can't load game archives".into());
    }
    errors.extend(us.drain_errors());

    let handle = crate::archive::resolve_open_path(us, req.game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        us.remove_all_archives();
        return Err(format!("could not open archive {}", req.game_archive));
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();
    let digest = crate::unitmodel::source_digest(us, handle, &list, req.object_name);

    us.close_archive(handle);
    errors.extend(us.drain_errors());
    us.remove_all_archives();
    digest
}

/// The RGBA buffer, or why it is not one.
fn read_pixels(path: &Path, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let expected = width as usize * height as usize * CHANNELS;
    if bytes.len() != expected {
        return Err(format!(
            "{} holds {} bytes, and a {width}x{height} RGBA render is {expected}",
            path.display(),
            bytes.len()
        ));
    }
    Ok(bytes)
}

/// Encode the pixels to the render class's profile and write them into the asset
/// directory, named after the hash of their own bytes like the hub's object path.
fn encode_asset(
    req: &RenderRequest<'_>,
    variant: &str,
    pixels: Vec<u8>,
    model_digest: &str,
    source_member: &str,
    source_hash: String,
    source_archive: &str,
) -> Result<(UnitRenderAsset, String), RenderSkip> {
    use crate::assetencode::{encode_variant, ext_for_mime, sha256_hex, EncodeError};

    let buffer =
        image::RgbaImage::from_raw(req.width, req.height, pixels).ok_or(RenderSkip::NoPixels)?;
    let encoded =
        encode_variant(variant, &image::DynamicImage::ImageRgba8(buffer)).map_err(|e| match e {
            EncodeError::TooLarge { .. } => RenderSkip::TooLarge,
            _ => RenderSkip::EncodeFailed,
        })?;

    let hash = sha256_hex(&encoded.bytes);
    let path = req
        .asset_dir
        .join(format!("{hash}.{}", ext_for_mime(&encoded.mime)));
    std::fs::create_dir_all(req.asset_dir).map_err(|_| RenderSkip::NotWritten)?;
    // Same content, same name, so a file already there is already this asset.
    if !path.exists() {
        std::fs::write(&path, &encoded.bytes).map_err(|_| RenderSkip::NotWritten)?;
    }

    let data_url = format!(
        "data:{};base64,{}",
        encoded.mime,
        base64::engine::general_purpose::STANDARD.encode(&encoded.bytes)
    );
    Ok((
        UnitRenderAsset {
            variant: variant.to_string(),
            origin: RENDERED_ORIGIN.to_string(),
            source_archive: source_archive.to_string(),
            path: path.to_string_lossy().into_owned(),
            hash,
            source_hash,
            source_member: source_member.to_string(),
            model_digest: model_digest.to_string(),
            renderer_version: req.renderer_version,
            footprint_x: req.footprint_x,
            footprint_z: req.footprint_z,
            encode_profile: encoded.encode_profile,
            mime: encoded.mime,
            width: encoded.width,
            height: encoded.height,
            bytes: encoded.bytes.len() as u64,
        },
        data_url,
    ))
}

fn skipped(why: RenderSkip, errors: Vec<String>) -> UnitRenderOutput {
    UnitRenderOutput {
        asset_skipped: Some(why),
        errors,
        ..Default::default()
    }
}

/// Print a render error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = UnitRenderOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A game archive's own versioned name, which is what `render` resolves and
    /// hands the encoder rather than the file name it was called with.
    const ARCHIVE: &str = "Beyond All Reason test-30922-8064a43";

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-unitrender-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A render-shaped buffer: an opaque blob off centre on a transparent field,
    /// so alpha and orientation both have something to lose.
    fn pixels(width: u32, height: u32) -> Vec<u8> {
        let mut out = vec![0u8; width as usize * height as usize * CHANNELS];
        for y in 0..height {
            for x in 0..width {
                let inside = x > width / 4 && x < width / 2 && y > height / 4 && y < height / 2;
                if inside {
                    let at = (y as usize * width as usize + x as usize) * CHANNELS;
                    out[at..at + CHANNELS].copy_from_slice(&[200, 60, 40, 255]);
                }
            }
        }
        out
    }

    fn request<'a>(
        dir: &'a Path,
        pixel_file: &'a Path,
        footprint_x: u32,
        footprint_z: u32,
        width: u32,
        height: u32,
    ) -> RenderRequest<'a> {
        RenderRequest {
            game_archive: "Nothing.sdd",
            object_name: "armcom",
            angle: "top",
            footprint_x,
            footprint_z,
            renderer_version: 1,
            pixels: pixel_file,
            width,
            height,
            asset_dir: dir,
            source: None,
        }
    }

    /// The key a caller holds, in the shape `--unit-render-keys` hands back.
    const KEY: RenderSource<'static> = RenderSource {
        model_digest: "d5f0f5b0f3e196176dde8795a43caeed8f76f29ab33c6677791ee886163f0a45",
        source_member: "objects3d/units/armaak.s3o",
        source_archive: ARCHIVE,
    };

    /// The framing check, which is the whole reason this mode recomputes the
    /// frame rather than trusting the caller. A 3 by 2 footprint frames to
    /// 255x204 and nothing else is that unit's render.
    #[test]
    fn refuses_a_render_that_is_not_the_shape_its_footprint_frames_to() {
        let dir = temp_dir("misframed");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(256, 256)).unwrap();

        // Square, which is exactly the mistake the rule exists to catch.
        let out = render("nolib", &request(&dir, &file, 3, 2, 256, 256));
        assert_eq!(out.asset_skipped, Some(RenderSkip::MisFramed));
        assert!(out.errors[0].contains("255x204"), "{:?}", out.errors);

        // Transposed, which reads as a plausible picture and is the other unit's.
        let out = render("nolib", &request(&dir, &file, 3, 2, 204, 255));
        assert_eq!(out.asset_skipped, Some(RenderSkip::MisFramed));
    }

    #[test]
    fn refuses_a_buffer_that_is_not_the_size_it_says_it_is() {
        let dir = temp_dir("shortbuffer");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(255, 204)).unwrap();
        // The right shape, so the frame check passes and the length check is what
        // has to catch it.
        std::fs::write(&file, &pixels(255, 204)[..1000]).unwrap();
        let out = render("nolib", &request(&dir, &file, 3, 2, 255, 204));
        assert_eq!(out.asset_skipped, Some(RenderSkip::NoPixels));

        let missing = dir.join("not-here.bin");
        let out = render("nolib", &request(&dir, &missing, 3, 2, 255, 204));
        assert_eq!(out.asset_skipped, Some(RenderSkip::NoPixels));
    }

    /// The mount, counted the only way a unit test can count it: `"nolib"` is not
    /// a unitsync, so a path that loads one cannot get past it. Today's caller
    /// gets `NoModel` and a caller holding the key gets its picture.
    ///
    /// This is issue #1720 in one assertion. Twenty units in a blueprint were
    /// twenty mounts of the game's archive set, and the fields each mount worked
    /// out are the ones `--unit-render-keys` handed the caller a moment earlier.
    #[test]
    fn a_caller_holding_the_key_encodes_without_loading_unitsync() {
        let dir = temp_dir("passdown");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(255, 204)).unwrap();

        let mut req = request(&dir, &file, 3, 2, 255, 204);
        assert_eq!(
            render("nolib", &req).asset_skipped,
            Some(RenderSkip::NoModel),
            "without a key the mount is the only route to the identity"
        );

        req.source = Some(KEY);
        let out = render("nolib", &req);
        let asset = out.asset.expect("encoded without an archive to mount");
        assert_eq!(asset.model_digest, KEY.model_digest);
        assert_eq!(asset.source_member, KEY.source_member);
        assert_eq!(asset.source_archive, KEY.source_archive);
        assert!(out.errors.is_empty(), "{:?}", out.errors);
    }

    /// The identity handed in is the identity that comes out, hashed the way the
    /// key path hashes it. If these two ever part, the have check reports every
    /// render as missing and the corpus is uploaded twice.
    #[test]
    fn the_handed_in_digest_produces_the_key_the_have_check_asked_about() {
        let dir = temp_dir("passdown-hash");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(255, 204)).unwrap();
        let mut req = request(&dir, &file, 3, 2, 255, 204);
        req.source = Some(KEY);

        let frame = coilbox_assets::render_frame(3, 2);
        let asset = render("nolib", &req).asset.expect("encoded");
        assert_eq!(
            asset.source_hash,
            crate::assetencode::render_source_hash(
                "render:top",
                1,
                3,
                2,
                frame.width_px,
                frame.height_px,
                KEY.model_digest,
            )
        );
    }

    /// The guard that does not move. A caller can say what the pixels were drawn
    /// from, and still cannot say what shape they are.
    #[test]
    fn a_handed_in_key_does_not_buy_a_mis_framed_render() {
        let dir = temp_dir("passdown-misframed");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(256, 256)).unwrap();
        let mut req = request(&dir, &file, 3, 2, 256, 256);
        req.source = Some(KEY);
        assert_eq!(
            render("nolib", &req).asset_skipped,
            Some(RenderSkip::MisFramed)
        );
    }

    /// An angle nobody agreed on would be a row the hub has no reader for, so it
    /// is refused before anything is drawn or encoded.
    #[test]
    fn refuses_an_angle_the_vocabulary_does_not_list() {
        let dir = temp_dir("angle");
        let file = dir.join("pixels.bin");
        std::fs::write(&file, pixels(255, 204)).unwrap();
        let mut req = request(&dir, &file, 3, 2, 255, 204);
        req.angle = "isometric";
        assert_eq!(
            render("nolib", &req).asset_skipped,
            Some(RenderSkip::UnknownAngle)
        );
        assert_eq!(variant_for("top").as_deref(), Some("render:top"));
    }

    /// The encode half on its own, without an archive to mount. The frame check
    /// and the model read are separate concerns and this is the one that turns
    /// pixels into a file.
    #[test]
    fn writes_the_render_as_a_file_named_after_its_own_bytes() {
        let dir = temp_dir("write");
        let file = dir.join("pixels.bin");
        let req = request(&dir, &file, 3, 2, 255, 204);
        let (asset, data_url) = encode_asset(
            &req,
            "render:top",
            pixels(255, 204),
            "a-model-digest",
            "objects3d/armcom.s3o",
            "a-source-hash".into(),
            ARCHIVE,
        )
        .unwrap();

        let on_disk = std::fs::read(&asset.path).expect("asset file written");
        assert_eq!(
            asset.path,
            dir.join(format!("{}.webp", asset.hash)).to_string_lossy()
        );
        assert_eq!(asset.hash, crate::assetencode::sha256_hex(&on_disk));
        assert_eq!(asset.bytes, on_disk.len() as u64);
        assert_eq!((asset.width, asset.height), (255, 204));
        assert_eq!(asset.encode_profile, "webp-q80-256");
        assert_eq!(asset.mime, "image/webp");
        assert_eq!(asset.variant, "render:top");
        assert_eq!(asset.origin, "rendered");
        assert_eq!(asset.source_archive, ARCHIVE);
        assert_eq!((asset.footprint_x, asset.footprint_z), (3, 2));
        assert!(data_url.starts_with("data:image/webp;base64,"));
    }

    /// A render is a model on nothing, so the transparency has to survive the
    /// encoder. It does, and this decodes the stored file to prove it rather than
    /// trusting the class's `lossless` flag, which for a render is false.
    #[test]
    fn the_transparent_field_around_the_model_is_still_transparent_in_the_file() {
        let dir = temp_dir("alpha");
        let file = dir.join("pixels.bin");
        let req = request(&dir, &file, 3, 2, 255, 204);
        let (asset, _) = encode_asset(
            &req,
            "render:top",
            pixels(255, 204),
            "digest",
            "objects3d/armcom.s3o",
            "source".into(),
            ARCHIVE,
        )
        .unwrap();

        let bytes = std::fs::read(&asset.path).unwrap();
        let decoded = webp::Decoder::new(&bytes).decode().unwrap();
        assert!(decoded.is_alpha(), "the render lost its alpha channel");
        assert_eq!((decoded.width(), decoded.height()), (255, 204));
        let rgba: &[u8] = &decoded;
        let alpha_at = |x: u32, y: u32| rgba[((y * 255 + x) * 4 + 3) as usize];

        // Every corner, because a background composited in would fill all four.
        for (x, y) in [(0, 0), (254, 0), (0, 203), (254, 203)] {
            assert_eq!(alpha_at(x, y), 0, "corner {x},{y} is not clear");
        }
        // And the model is still opaque, so this is not a blank picture.
        assert_eq!(alpha_at(100, 70), 255);
    }

    /// The same pixels from the same unit produce the same identity, and one
    /// input moved moves it. The inputs are what a render's `source_hash` is over,
    /// which is why an encoder change leaves it alone.
    #[test]
    fn the_identity_comes_from_the_inputs_rather_than_the_encoder() {
        let frame = coilbox_assets::render_frame(3, 2);
        let hash = |version: u32, digest: &str| {
            crate::assetencode::render_source_hash(
                "render:top",
                version,
                3,
                2,
                frame.width_px,
                frame.height_px,
                digest,
            )
        };
        assert_eq!(hash(1, "abc"), hash(1, "abc"));
        assert_ne!(hash(1, "abc"), hash(2, "abc"));
        assert_ne!(hash(1, "abc"), hash(1, "abd"));
    }
}
