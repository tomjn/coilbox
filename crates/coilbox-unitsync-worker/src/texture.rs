//! Shared texture decoding: turn a supported image (incl. DXT/BCn `.dds`) into an
//! `image::RgbaImage`, and encode a small PNG `data:` URL preserving alpha. Used by
//! the unit-buildpic mode; deliberately decoupled so archive preview and header art
//! can adopt DDS support later.

use base64::Engine;
use image::ImageEncoder;

/// Icons are downscaled to fit within this box (build pics are ~128px squares).
const ICON_MAX: u32 = 128;

/// Decode a texture by file extension into an `RgbaImage`, or `None` if the format
/// isn't supported or the bytes don't decode. `.dds` is DXT/BCn-decompressed;
/// everything else goes through the `image` crate (extension-driven because TGA has
/// no magic bytes).
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

/// Decode a DXT/BCn `.dds` (the common Spring/Recoil build-pic case) into RGBA8.
/// Only block-compressed BC1/2/3 are handled; uncompressed or BC4/5/6/7 DDS return
/// `None` (treated as unresolved by the caller).
fn decode_dds(bytes: &[u8]) -> Option<image::RgbaImage> {
    let dds = ddsfile::Dds::read(bytes).ok()?;
    let (w, h) = (dds.get_width(), dds.get_height());
    let format = bc_format(dds.get_d3d_format(), dds.get_dxgi_format())?;
    let data = dds.get_data(0).ok()?;
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
    format.decompress(data, w as usize, h as usize, &mut rgba);
    image::RgbaImage::from_raw(w, h, rgba)
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

    /// Encoding a small RgbaImage yields a PNG data URL.
    #[test]
    fn encodes_png_data_url() {
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 128]));
        let url = encode_icon_png(img).expect("should encode");
        assert!(url.starts_with("data:image/png;base64,"), "got: {url}");
    }
}
