//! The shared store an imported unit's textures live in.
//!
//! A texture is an asset in its own right rather than something one unit owns:
//! two units can name the same file, and both want the same copy of it. So the
//! store is keyed by content, `<sha256>.<ext>`, and two units importing the
//! same 8192 DDS hold one copy of it where a per-project sidecar would hold
//! two.
//!
//! Content addressing is also what makes refreshing work. The webview caches a
//! texture behind its URL, so a file edited in Photoshop and read back under
//! the same name would go on drawing the old bytes. Changed bytes hash to a
//! different key, so the URL changes and there is nothing stale to serve.
//!
//! A `.bmp` or a `.tga` is re-encoded to PNG on the way in, because a webview
//! renders neither and they are most of what the legacy games ship. Everything
//! else is stored as it arrived, `.dds` above all: a shared 8192 square atlas
//! is 64 MiB packed and 256 MiB as RGBA, and the webview uploads it still
//! compressed.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Generous next to the largest unit texture in the games checked, an 8192
/// square DDS at 64 MiB, and small enough that a mistaken pick cannot fill the
/// disk.
const MAX_TEXTURE_BYTES: u64 = 128 * 1024 * 1024;

/// Where a `.s3o` names its textures, relative to the folder the game is in.
const TEXTURE_DIR: &str = "unittextures";

/// The extensions a texture name is tried with when the one it names is not
/// there, which happens when a game reskins a model from `.tga` to `.dds`
/// without rewriting its headers.
const TEXTURE_EXTS: &[&str] = &["dds", "png", "tga", "bmp", "jpg", "jpeg"];

/// A texture that has been put in the store.
pub struct Stored {
    /// The file in the store, which is what the document names.
    pub key: String,
    /// What the file was called where it came from, which is what the model
    /// header names and what an export writes it back out as.
    pub name: String,
    pub bytes: usize,
}

/// Read a texture off disk and put it in the store, or say why not.
///
/// Re-reading a file that has not changed writes nothing and gives back the
/// same key, because the key is the content. That is also what makes refreshing
/// an edited file cheap: only genuinely new bytes cost a write.
pub fn store(dir: &Path, source: &Path) -> Result<Stored, String> {
    let meta = std::fs::metadata(source)
        .map_err(|e| format!("could not read {}: {e}", source.display()))?;
    if meta.len() > MAX_TEXTURE_BYTES {
        return Err(format!(
            "{} is {} bytes, which is far larger than any unit texture",
            source.display(),
            meta.len()
        ));
    }
    let bytes =
        std::fs::read(source).map_err(|e| format!("could not read {}: {e}", source.display()))?;

    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} has no file name", source.display()))?
        .to_string();
    let ext = extension(source);
    let (ext, payload) = match to_webview_format(&ext, &bytes) {
        Some(png) => ("png".to_string(), png),
        None => (if ext.is_empty() { "bin".into() } else { ext }, bytes),
    };

    let key = format!("{}.{ext}", hex(&Sha256::digest(&payload)));
    let target = dir.join(&key);
    if !target.is_file() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("could not create the texture folder: {e}"))?;
        std::fs::write(&target, &payload)
            .map_err(|e| format!("could not store the texture: {e}"))?;
    }

    Ok(Stored {
        key,
        name,
        bytes: payload.len(),
    })
}

/// Lowercase hex, two digits a byte.
///
/// Spelled out because sha2 0.11's output type does not format itself. Its
/// predecessor's did, and `{:x}` over that produced exactly this, so a store
/// filled by an older build still answers to the keys a new one asks for.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The texture a model's header names, as a path on disk, if it can be found.
///
/// What the header says is not what resolves it: it names `Beacon_1.dds` and
/// the bytes are somewhere in the game folder the model came out of, normally
/// in `unittextures/` at the top of it. So the search walks up from the model
/// looking for that folder, then falls back to looking beside the model itself.
/// Case-insensitively, and trying the other extensions, because a game that
/// reskins a model does not always rewrite its headers.
///
/// Not finding it is not fatal. The model draws untextured and the import says
/// which file it wanted.
pub fn find_beside_model(model: &Path, name: &str) -> Option<PathBuf> {
    let want = name.trim().replace('\\', "/");
    let want = want.rsplit('/').next()?;
    if want.is_empty() {
        return None;
    }

    let mut dir = model.parent();
    while let Some(here) = dir {
        if let Some(textures) = child_dir(here, TEXTURE_DIR) {
            if let Some(hit) = find_in(&textures, want) {
                return Some(hit);
            }
        }
        dir = here.parent();
    }
    find_in(model.parent()?, want)
}

/// A subdirectory by name, matched case-insensitively because a game folder's
/// own case is the author's and Linux does not forgive it.
fn child_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let exact = dir.join(name);
    if exact.is_dir() {
        return Some(exact);
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        if entry.file_name().to_str()?.eq_ignore_ascii_case(name) && entry.path().is_dir() {
            return Some(entry.path());
        }
    }
    None
}

/// A file in `dir` called `name`, or the same stem under another extension.
fn find_in(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries: Vec<(String, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| Some((e.file_name().to_str()?.to_lowercase(), e.path())))
        .collect();
    let lower = name.to_lowercase();
    if let Some((_, path)) = entries.iter().find(|(have, _)| *have == lower) {
        return Some(path.clone());
    }
    let stem = lower.rsplit_once('.').map(|(s, _)| s).unwrap_or(&lower);
    for ext in TEXTURE_EXTS {
        let want = format!("{stem}.{ext}");
        if let Some((_, path)) = entries.iter().find(|(have, _)| *have == want) {
            return Some(path.clone());
        }
    }
    None
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

/// Re-encode a texture the webview cannot decode, or `None` to store the bytes
/// as they arrived.
///
/// The same rule the unit-model viewer applies (`to_webview_format` in
/// `crates/coilbox-unitsync-worker/src/unitmodel.rs`), for the same reason and
/// with the same limits. Alpha goes with the conversion: Spring's unit textures
/// use it as a team-colour or specular mask rather than as transparency, so
/// honouring it renders half a unit invisible.
fn to_webview_format(ext: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let format = match ext {
        "bmp" => image::ImageFormat::Bmp,
        "tga" => image::ImageFormat::Tga,
        _ => return None,
    };
    let img = image::load_from_memory_with_format(bytes, format).ok()?;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img.to_rgb8())
        .write_to(&mut png, image::ImageFormat::Png)
        .ok()?;
    Some(png.into_inner())
}

/// The longest side a texture is written at for the two Blender exports.
///
/// Measured rather than guessed: the store on this machine holds two 8192
/// square DDS files, 64 MiB each, because a game's units share one texture and
/// importing any of them stores it. That is 256 MiB as RGBA, and it does not
/// stop there. The `.glb`'s image crosses the IPC bridge as base64, goes through
/// a canvas in `GLTFExporter`, and comes back as a `.glb` the frontend hands
/// over one byte per array element. At 8192 that is gigabytes of webview heap
/// for a file nothing but Blender opens. At 2048 the whole chain is a few
/// megabytes, and the unit's real texture is still placed in `unittextures/` by
/// the `.s3o` export at full size.
const BLENDER_MAX: u32 = 2048;

/// A stored texture, decoded and re-encoded for a Blender export.
pub struct BlenderPng {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Whether it was scaled down to fit [`BLENDER_MAX`], which the export says
    /// out loud rather than quietly handing over a smaller image than the game
    /// has.
    pub scaled: bool,
}

/// Read a texture out of the store as a PNG Blender can open.
///
/// A `.dds` is decoded here because nothing downstream will: Blender's glTF
/// importer refuses one, and so does every `.mtl` reader. A stored PNG small
/// enough already is passed through untouched, since re-encoding it would only
/// spend time to produce the same picture.
///
/// The reason comes back as words rather than an empty result. Which texture it
/// was is the caller's to add: the store names files by content hash, so the
/// path in here means nothing to anybody.
pub fn blender_png(source: &Path) -> Result<BlenderPng, String> {
    let bytes = std::fs::read(source)
        .map_err(|e| format!("could not read it from coilbox's texture store: {e}"))?;
    let ext = extension(source);
    let img = coilbox_texture::decode(&ext, &bytes).ok_or_else(|| {
        format!("coilbox cannot decode this .{ext}. A .dds has to be uncompressed or DXT1/3/5: BC4 upwards and anything behind a DX10 header are not read.")
    })?;

    let (width, height) = (img.width(), img.height());
    if width.max(height) <= BLENDER_MAX {
        // Already a PNG at a size that needs nothing doing to it.
        if ext == "png" {
            return Ok(BlenderPng {
                bytes,
                width,
                height,
                scaled: false,
            });
        }
        let bytes = coilbox_texture::encode_png(&img)
            .ok_or_else(|| "could not re-encode it as a PNG".to_string())?;
        return Ok(BlenderPng {
            bytes,
            width,
            height,
            scaled: false,
        });
    }

    let small = image::DynamicImage::ImageRgba8(img)
        .thumbnail(BLENDER_MAX, BLENDER_MAX)
        .to_rgba8();
    let (width, height) = (small.width(), small.height());
    let bytes = coilbox_texture::encode_png(&small)
        .ok_or_else(|| "could not re-encode it as a PNG".to_string())?;
    Ok(BlenderPng {
        bytes,
        width,
        height,
        scaled: true,
    })
}

/// Delete every texture in the store that no saved unit names.
///
/// The store is content addressed, so editing a texture and refreshing leaves
/// the version before it behind. Without this an 8 MiB DDS refreshed through a
/// session's worth of edits is hundreds of megabytes of dead files.
///
/// `keep` comes from the frontend, which owns the document schema and is the
/// only thing that knows which keys are named. This crate stays out of the
/// JSON, exactly as it does for everything else.
pub fn prune(dir: &Path, keep: &[String]) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if keep.contains(&name) || !entry.path().is_file() {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbImage::from_pixel(width, height, image::Rgb([1, 2, 3]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode");
        out.into_inner()
    }

    #[test]
    fn the_same_bytes_land_on_one_copy_and_different_bytes_do_not() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store_dir = dir.path().join("textures");
        let one = dir.path().join("Beacon_1.png");
        let two = dir.path().join("copy.png");
        std::fs::write(&one, png_bytes(4, 4)).expect("write");
        std::fs::write(&two, png_bytes(4, 4)).expect("write");
        let other = dir.path().join("other.png");
        std::fs::write(&other, png_bytes(8, 8)).expect("write");

        let a = store(&store_dir, &one).expect("store");
        let b = store(&store_dir, &two).expect("store");
        let c = store(&store_dir, &other).expect("store");

        assert_eq!(a.key, b.key);
        assert_ne!(a.key, c.key);
        // The name follows the file it came from, not the key it landed on.
        assert_eq!(a.name, "Beacon_1.png");
        assert_eq!(b.name, "copy.png");
        assert_eq!(std::fs::read_dir(&store_dir).expect("read").count(), 2);
    }

    #[test]
    fn a_bmp_is_stored_as_a_png_because_a_webview_cannot_draw_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("skin.bmp");
        let img = image::RgbImage::from_pixel(2, 2, image::Rgb([9, 9, 9]));
        let mut bmp = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut bmp, image::ImageFormat::Bmp)
            .expect("encode");
        std::fs::write(&source, bmp.into_inner()).expect("write");

        let stored = store(&dir.path().join("textures"), &source).expect("store");

        assert!(stored.key.ends_with(".png"), "got: {}", stored.key);
        assert_eq!(stored.name, "skin.bmp");
    }

    #[test]
    fn a_dds_is_stored_untouched_however_little_sense_its_bytes_make() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("atlas.dds");
        std::fs::write(&source, b"DDS not really").expect("write");

        let stored = store(&dir.path().join("textures"), &source).expect("store");

        assert!(stored.key.ends_with(".dds"), "got: {}", stored.key);
        assert_eq!(stored.bytes, 14);
    }

    /// The expected value is `printf 'DDS not really' | shasum -a 256`, a tool
    /// with no idea this crate exists.
    ///
    /// Every other test here compares one key against another, so all of them
    /// pass just as happily if the key is spelled a new way, as long as it is
    /// spelled that way consistently. A store already on a user's disk is named
    /// in the old spelling and would be re-imported file by file, so the
    /// spelling is pinned to something outside the crate rather than to itself.
    /// The digest has bytes below 0x10 in it, which is what makes this catch a
    /// hex that stopped zero padding.
    #[test]
    fn the_store_key_is_the_sha256_an_outside_tool_gives() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("atlas.dds");
        std::fs::write(&source, b"DDS not really").expect("write");

        let stored = store(&dir.path().join("textures"), &source).expect("store");

        assert_eq!(
            stored.key,
            "0896cd97a069e9db8f09e053415171fd6faa06e08927c8e4e9ac87e44f88527b.dds"
        );
    }

    #[test]
    fn a_missing_file_says_so_rather_than_storing_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(store(&dir.path().join("textures"), &dir.path().join("gone.dds")).is_err());
    }

    #[test]
    fn a_texture_is_found_in_unittextures_above_the_model() {
        let root = tempfile::tempdir().expect("tempdir");
        let models = root.path().join("objects3d").join("Mech").join("Atlas");
        let textures = root.path().join("unittextures");
        std::fs::create_dir_all(&models).expect("mkdir");
        std::fs::create_dir_all(&textures).expect("mkdir");
        std::fs::write(textures.join("Beacon_1.dds"), b"x").expect("write");
        let model = models.join("unit.s3o");

        // Named exactly, and named in the other case, both resolve.
        assert_eq!(
            find_beside_model(&model, "Beacon_1.dds"),
            Some(textures.join("Beacon_1.dds"))
        );
        assert_eq!(
            find_beside_model(&model, "beacon_1.DDS"),
            Some(textures.join("Beacon_1.dds"))
        );
        // Named with the extension a reskin left behind.
        assert_eq!(
            find_beside_model(&model, "Beacon_1.tga"),
            Some(textures.join("Beacon_1.dds"))
        );
        assert_eq!(find_beside_model(&model, "Nothing.dds"), None);
        assert_eq!(find_beside_model(&model, ""), None);
    }

    #[test]
    fn a_texture_beside_the_model_is_found_when_there_is_no_unittextures() {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::write(root.path().join("skin.png"), b"x").expect("write");

        assert_eq!(
            find_beside_model(&root.path().join("unit.s3o"), "skin.png"),
            Some(root.path().join("skin.png"))
        );
    }

    /// A one-pixel uncompressed A8R8G8B8 `.dds`: the 128-byte legacy header,
    /// then the pixel, BGRA in memory order.
    fn one_pixel_dds(b: u8, g: u8, r: u8, a: u8) -> Vec<u8> {
        let mut out = b"DDS ".to_vec();
        let mut put = |v: u32| out.extend_from_slice(&v.to_le_bytes());
        put(124); // header size
        put(0x1007); // caps | height | width | pixelformat
        put(1); // height
        put(1); // width
        put(4); // pitch
        put(0); // depth
        put(1); // mip count
        for _ in 0..11 {
            put(0); // reserved
        }
        put(32); // pixel format size
        put(0x41); // rgb | alpha pixels
        put(0); // no fourcc: the masks below describe the pixels
        put(32); // bits a pixel
        put(0x00ff0000); // r
        put(0x0000ff00); // g
        put(0x000000ff); // b
        put(0xff000000); // a
        put(0x1000); // caps: texture
        for _ in 0..4 {
            put(0); // caps2..4, reserved2
        }
        out.extend_from_slice(&[b, g, r, a]);
        out
    }

    #[test]
    fn a_dds_comes_back_as_a_png_because_blender_reads_no_dds() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("Beacon_1.dds");
        std::fs::write(&source, one_pixel_dds(0x30, 0x20, 0x10, 0xff)).expect("write");

        let png = blender_png(&source).expect("should decode");

        assert_eq!(&png.bytes[1..4], b"PNG");
        assert_eq!((png.width, png.height), (1, 1));
        assert!(!png.scaled);
        let back = image::load_from_memory(&png.bytes)
            .expect("decode")
            .to_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [0x10, 0x20, 0x30, 0xff]);
    }

    #[test]
    fn a_stored_png_small_enough_is_passed_through_untouched() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("skin.png");
        let bytes = png_bytes(4, 4);
        std::fs::write(&source, &bytes).expect("write");

        let png = blender_png(&source).expect("should read");

        assert_eq!(png.bytes, bytes);
        assert_eq!((png.width, png.height), (4, 4));
        assert!(!png.scaled);
    }

    #[test]
    fn a_texture_over_the_cap_is_scaled_and_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("atlas.png");
        std::fs::write(&source, png_bytes(BLENDER_MAX * 2, BLENDER_MAX)).expect("write");

        let png = blender_png(&source).expect("should read");

        assert_eq!((png.width, png.height), (BLENDER_MAX, BLENDER_MAX / 2));
        assert!(png.scaled);
    }

    #[test]
    fn a_dds_the_decoder_cannot_read_gives_a_reason_rather_than_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = dir.path().join("atlas.dds");
        std::fs::write(&source, b"DDS not really").expect("write");

        let reason = blender_png(&source).err().expect("should refuse");

        assert!(reason.contains(".dds"), "got: {reason}");
    }

    #[test]
    fn a_texture_missing_from_the_store_says_so() {
        let dir = tempfile::tempdir().expect("tempdir");

        let reason = blender_png(&dir.path().join("gone.dds"))
            .err()
            .expect("should refuse");

        assert!(reason.contains("store"), "got: {reason}");
    }

    #[test]
    fn pruning_keeps_only_what_is_still_named() {
        let dir = tempfile::tempdir().expect("tempdir");
        for name in ["a.dds", "b.dds", "c.png"] {
            std::fs::write(dir.path().join(name), b"x").expect("write");
        }

        let removed = prune(dir.path(), &["b.dds".to_string()]);

        assert_eq!(removed, 2);
        assert!(dir.path().join("b.dds").is_file());
        assert!(!dir.path().join("a.dds").exists());
        // A store that was never written is nothing to prune, not an error.
        assert_eq!(prune(&dir.path().join("gone"), &[]), 0);
    }
}
