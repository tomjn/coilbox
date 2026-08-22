//! The worker's texture decoding: `.pcx`, plus everything `coilbox-texture`
//! already reads.
//!
//! The decode itself moved to `coilbox-texture` when the unit builder's Blender
//! exports needed the same `.dds` support (issue #715). What stays here is the
//! part only this crate has: `.pcx`, which no game ships anything but a build
//! pic in, and the icon-sized PNG the caches hold.

pub use coilbox_texture::png_data_url;

/// Icons are downscaled to fit within this box (build pics are ~128px squares).
const ICON_MAX: u32 = 128;

/// Decode a texture by file extension into an `RgbaImage`, or `None` if the
/// format isn't supported or the bytes don't decode.
pub fn decode_texture(ext: &str, bytes: &[u8]) -> Option<image::RgbaImage> {
    if ext.eq_ignore_ascii_case("pcx") {
        return crate::pcx::decode(bytes);
    }
    coilbox_texture::decode(ext, bytes)
}

/// Downscale to fit `ICON_MAX` (preserving aspect, never upscaling) and encode
/// PNG bytes. PNG (not JPEG) preserves the transparent backgrounds build pics
/// usually have.
pub fn encode_icon_png(img: image::RgbaImage) -> Option<Vec<u8>> {
    let dynimg = image::DynamicImage::ImageRgba8(img);
    let scaled = if dynimg.width() > ICON_MAX || dynimg.height() > ICON_MAX {
        dynimg.thumbnail(ICON_MAX, ICON_MAX)
    } else {
        dynimg
    };
    coilbox_texture::encode_png(&scaled.to_rgba8())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `.pcx` reaches the PCX decoder, which is the wire a build pic travels
    /// down. One green pixel: a 128-byte header then three 8-bit planes.
    #[test]
    fn routes_pcx_to_its_own_decoder() {
        let mut raw = vec![0u8; 128];
        raw[0] = 0x0a;
        raw[1] = 5;
        raw[2] = 1;
        raw[3] = 8;
        raw[65] = 3;
        raw[66] = 1;
        raw.extend_from_slice(&[0x00, 0x40, 0x00]);
        let img = decode_texture("PCX", &raw).expect("pcx should decode");
        assert_eq!(img.get_pixel(0, 0).0, [0x00, 0x40, 0x00, 255]);
    }

    /// Everything else goes to the shared crate, which reads the `.dds` a build
    /// pic is usually in.
    #[test]
    fn routes_everything_else_to_the_shared_decoder() {
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        let png = coilbox_texture::encode_png(&img).expect("encode");
        let out = decode_texture("png", &png).expect("png should decode");
        assert_eq!((out.width(), out.height()), (2, 2));
        assert!(decode_texture("xyz", &[0, 1, 2]).is_none());
    }

    /// Encoding a small RgbaImage yields PNG bytes, which are what the cache
    /// writes as a file and only base64s when it has nowhere to put them.
    #[test]
    fn encodes_png_bytes() {
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 128]));
        let png = encode_icon_png(img).expect("should encode");
        assert_eq!(&png[1..4], b"PNG");
        assert!(png_data_url(&png).starts_with("data:image/png;base64,"));
    }

    /// A build pic larger than the icon box comes back at the box size.
    #[test]
    fn a_large_icon_is_downscaled() {
        let img = image::RgbaImage::from_pixel(512, 256, image::Rgba([1, 2, 3, 255]));
        let png = encode_icon_png(img).expect("should encode");
        let out = decode_texture("png", &png).expect("decode");
        assert_eq!((out.width(), out.height()), (ICON_MAX, ICON_MAX / 2));
    }
}
