//! Shared texture decoding: turn a supported image (incl. DXT/BCn `.dds`) into an
//! `image::RgbaImage`, and encode a small PNG `data:` URL preserving alpha. Used by
//! the unit-buildpic mode; deliberately decoupled so archive preview and header art
//! can adopt DDS support later.

use base64::Engine;
use image::ImageEncoder;

/// Icons are downscaled to fit within this box (build pics are ~128px squares).
const ICON_MAX: u32 = 128;

/// Decode a texture by file extension into an `RgbaImage`, or `None` if the format
/// isn't supported or the bytes don't decode. `.dds` is unpacked here (see
/// [`decode_dds`]), everything else goes through the `image` crate
/// (extension-driven because TGA has no magic bytes).
pub fn decode_texture(ext: &str, bytes: &[u8]) -> Option<image::RgbaImage> {
    match ext.to_lowercase().as_str() {
        "dds" => decode_dds(bytes),
        "png" => load_rgba(bytes, image::ImageFormat::Png),
        "jpg" | "jpeg" => load_rgba(bytes, image::ImageFormat::Jpeg),
        "tga" => load_rgba(bytes, image::ImageFormat::Tga),
        "bmp" => load_rgba(bytes, image::ImageFormat::Bmp),
        "gif" => load_rgba(bytes, image::ImageFormat::Gif),
        _ => None,
    }
}

fn load_rgba(bytes: &[u8], format: image::ImageFormat) -> Option<image::RgbaImage> {
    Some(
        image::load_from_memory_with_format(bytes, format)
            .ok()?
            .to_rgba8(),
    )
}

/// Decode a `.dds` into RGBA8: block-compressed BC1/2/3, or the older
/// uncompressed bitmask pixel formats. BC4/5/6/7 and anything behind a DX10
/// header return `None` (treated as unreadable by the caller).
fn decode_dds(bytes: &[u8]) -> Option<image::RgbaImage> {
    let dds = ddsfile::Dds::read(bytes).ok()?;
    let (w, h) = (dds.get_width(), dds.get_height());
    let data = dds.get_data(0).ok()?;
    if let Some(format) = bc_format(dds.get_d3d_format(), dds.get_dxgi_format()) {
        let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
        format.decompress(data, w as usize, h as usize, &mut rgba);
        return image::RgbaImage::from_raw(w, h, rgba);
    }
    decode_uncompressed(&dds.header.spf, w, h, data)
}

/// Decode the mip-0 image of an uncompressed `.dds`: a fixed number of bits per
/// pixel, with one bitmask per channel saying where that channel sits inside
/// them. This is how DDS stored pixels before DXT, and how XTA still ships its
/// build pics.
///
/// Any channel the file gives no mask for reads as 0, except alpha, which reads
/// as opaque. That is what `X8R8G8B8` and `R8G8B8` mean.
fn decode_uncompressed(
    spf: &ddsfile::PixelFormat,
    w: u32,
    h: u32,
    data: &[u8],
) -> Option<image::RgbaImage> {
    use ddsfile::PixelFormatFlags;
    if !spf.flags.contains(PixelFormatFlags::RGB) {
        return None;
    }
    let stride = match spf.rgb_bit_count? {
        16 => 2,
        24 => 3,
        32 => 4,
        _ => return None,
    };
    // Mip 0 is first in the layer, so its rows run from the start. An
    // uncompressed row is exactly this wide, with no padding to skip.
    let pitch = (w as usize) * stride;
    if data.len() < pitch * (h as usize) {
        return None;
    }
    let (r, g, b) = (
        channel(spf.r_bit_mask),
        channel(spf.g_bit_mask),
        channel(spf.b_bit_mask),
    );
    let a = if spf.flags.contains(PixelFormatFlags::ALPHA_PIXELS) {
        channel(spf.a_bit_mask)
    } else {
        None
    };
    let mut out = Vec::with_capacity((w as usize) * (h as usize) * 4);
    for row in data[..pitch * (h as usize)].chunks_exact(pitch) {
        for px in row.chunks_exact(stride) {
            let bits = px
                .iter()
                .enumerate()
                .fold(0u32, |acc, (i, byte)| acc | (u32::from(*byte) << (8 * i)));
            out.push(sample(bits, r));
            out.push(sample(bits, g));
            out.push(sample(bits, b));
            out.push(a.map_or(255, |c| sample(bits, Some(c))));
        }
    }
    image::RgbaImage::from_raw(w, h, out)
}

/// A channel's shift and full-scale value, from its bitmask. `None` when the
/// file stores no such channel.
fn channel(mask: Option<u32>) -> Option<(u32, u32)> {
    let mask = mask.filter(|m| *m != 0)?;
    let shift = mask.trailing_zeros();
    Some((shift, mask >> shift))
}

/// Pull one channel out of a pixel and rescale it to 0..255, so a 5-bit channel
/// spans the full range instead of coming out dark.
fn sample(bits: u32, ch: Option<(u32, u32)>) -> u8 {
    match ch {
        Some((shift, full)) => (((bits >> shift) & full) * 255 / full) as u8,
        None => 0,
    }
}

/// Map a DDS fourcc (`D3DFormat`) or modern `DxgiFormat` to the texpresso block
/// format. Prefers the legacy fourcc (what most Spring build pics carry).
fn bc_format(
    d3d: Option<ddsfile::D3DFormat>,
    dxgi: Option<ddsfile::DxgiFormat>,
) -> Option<texpresso::Format> {
    use ddsfile::{D3DFormat, DxgiFormat};
    use texpresso::Format;
    if let Some(f) = d3d {
        return match f {
            D3DFormat::DXT1 => Some(Format::Bc1),
            D3DFormat::DXT2 | D3DFormat::DXT3 => Some(Format::Bc2),
            D3DFormat::DXT4 | D3DFormat::DXT5 => Some(Format::Bc3),
            _ => None,
        };
    }
    match dxgi? {
        DxgiFormat::BC1_UNorm | DxgiFormat::BC1_UNorm_sRGB => Some(Format::Bc1),
        DxgiFormat::BC2_UNorm | DxgiFormat::BC2_UNorm_sRGB => Some(Format::Bc2),
        DxgiFormat::BC3_UNorm | DxgiFormat::BC3_UNorm_sRGB => Some(Format::Bc3),
        _ => None,
    }
}

/// Downscale to fit `ICON_MAX` (preserving aspect, never upscaling) and encode a
/// PNG `data:` URL. PNG (not JPEG) preserves the transparent backgrounds build pics
/// usually have.
pub fn encode_icon_png(img: image::RgbaImage) -> Option<String> {
    let dynimg = image::DynamicImage::ImageRgba8(img);
    let scaled = if dynimg.width() > ICON_MAX || dynimg.height() > ICON_MAX {
        dynimg.thumbnail(ICON_MAX, ICON_MAX)
    } else {
        dynimg
    };
    let rgba = scaled.to_rgba8();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 2x2 RGBA PNG built in-memory decodes back to a 2x2 RgbaImage.
    #[test]
    fn decodes_png_bytes() {
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(img.as_raw(), 2, 2, image::ExtendedColorType::Rgba8)
            .unwrap();
        let out = decode_texture("png", &png).expect("png should decode");
        assert_eq!((out.width(), out.height()), (2, 2));
    }

    #[test]
    fn unknown_extension_is_none() {
        assert!(decode_texture("xyz", &[0, 1, 2]).is_none());
    }

    /// DXT fourcc + BCn DXGI formats map to the right texpresso format.
    #[test]
    fn bc_format_mapping() {
        use ddsfile::{D3DFormat, DxgiFormat};
        use texpresso::Format;
        assert_eq!(bc_format(Some(D3DFormat::DXT1), None), Some(Format::Bc1));
        assert_eq!(bc_format(Some(D3DFormat::DXT3), None), Some(Format::Bc2));
        assert_eq!(bc_format(Some(D3DFormat::DXT5), None), Some(Format::Bc3));
        assert_eq!(
            bc_format(None, Some(DxgiFormat::BC1_UNorm)),
            Some(Format::Bc1)
        );
        assert_eq!(
            bc_format(None, Some(DxgiFormat::BC3_UNorm)),
            Some(Format::Bc3)
        );
        assert_eq!(bc_format(None, None), None);
    }

    /// Build an uncompressed `.dds`: the 128-byte legacy header, then `pixels`.
    /// `masks` are (r, g, b, a). A zero alpha mask means the file stores none.
    fn uncompressed_dds(
        w: u32,
        h: u32,
        bit_count: u32,
        masks: (u32, u32, u32, u32),
        pixels: &[u8],
    ) -> Vec<u8> {
        let mut out = b"DDS ".to_vec();
        let mut put = |v: u32| out.extend_from_slice(&v.to_le_bytes());
        put(124); // header size
        put(0x1007); // caps | height | width | pixelformat
        put(h);
        put(w);
        put(w * bit_count / 8); // pitch
        put(0); // depth
        put(1); // mip count
        for _ in 0..11 {
            put(0); // reserved
        }
        put(32); // pixel format size
        put(if masks.3 == 0 { 0x40 } else { 0x41 }); // rgb (| alpha pixels)
        put(0); // no fourcc: the masks below describe the pixels
        put(bit_count);
        put(masks.0);
        put(masks.1);
        put(masks.2);
        put(masks.3);
        put(0x1000); // caps: texture
        for _ in 0..4 {
            put(0); // caps2..4, reserved2
        }
        out.extend_from_slice(pixels);
        out
    }

    /// A8R8G8B8, which is what XTA's two unreadable build pics turned out to be:
    /// no fourcc, 32 bits a pixel, BGRA in memory order.
    #[test]
    fn decodes_an_uncompressed_bitmask_dds() {
        let px = [
            0x30, 0x20, 0x10, 0xff, // b, g, r, a
            0x00, 0x00, 0xff, 0x80,
        ];
        let dds = uncompressed_dds(
            2,
            1,
            32,
            (0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000),
            &px,
        );
        let img = decode_texture("dds", &dds).expect("uncompressed dds should decode");
        assert_eq!((img.width(), img.height()), (2, 1));
        assert_eq!(img.get_pixel(0, 0).0, [0x10, 0x20, 0x30, 0xff]);
        assert_eq!(img.get_pixel(1, 0).0, [0xff, 0x00, 0x00, 0x80]);
    }

    /// A file with no alpha mask is opaque, not invisible.
    #[test]
    fn an_uncompressed_dds_without_alpha_is_opaque() {
        let px = [0x30, 0x20, 0x10, 0x00];
        let dds = uncompressed_dds(1, 1, 32, (0x00ff0000, 0x0000ff00, 0x000000ff, 0), &px);
        let img = decode_texture("dds", &dds).expect("x8r8g8b8 should decode");
        assert_eq!(img.get_pixel(0, 0).0, [0x10, 0x20, 0x30, 0xff]);
    }

    /// A narrow channel is rescaled to the full byte range, so R5G6B5 white comes
    /// out white rather than nearly white.
    #[test]
    fn narrow_channels_scale_to_the_full_range() {
        let dds = uncompressed_dds(1, 1, 16, (0xf800, 0x07e0, 0x001f, 0), &[0xff, 0xff]);
        let img = decode_texture("dds", &dds).expect("r5g6b5 should decode");
        assert_eq!(img.get_pixel(0, 0).0, [255, 255, 255, 255]);
    }

    /// Truncated pixel data is refused rather than read past the end.
    #[test]
    fn an_uncompressed_dds_short_of_pixels_is_none() {
        let dds = uncompressed_dds(4, 4, 32, (0x00ff0000, 0x0000ff00, 0x000000ff, 0), &[0; 16]);
        assert!(decode_texture("dds", &dds).is_none());
    }

    /// Encoding a small RgbaImage yields a PNG data URL.
    #[test]
    fn encodes_png_data_url() {
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 128]));
        let url = encode_icon_png(img).expect("should encode");
        assert!(url.starts_with("data:image/png;base64,"), "got: {url}");
    }
}
