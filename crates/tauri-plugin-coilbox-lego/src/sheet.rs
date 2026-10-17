//! The pixels of a combined texture sheet, for a unit that mixes parts and
//! pieces lifted from a game (#3260).
//!
//! The layout is decided in the frontend, in `src/lego/textureSheet.ts`, which
//! also explains it. This copies what it was told to: each region is a crop of
//! one source in that source's own UVs, painted into a rectangle of the sheet.

use image::RgbaImage;

/// What the engine stands in for a second texture it cannot find: no glow, no
/// shine, fully visible. `S3OTextureHandler.cpp` allocates a single pixel of
/// `SColor(255 * (texNum == 0), 0, 0, 255)`, which for the second texture is
/// this. Every part is drawn with it today, because a unit of parts names no
/// second texture.
pub const NO_SHADING: [u8; 4] = [0, 0, 0, 255];

/// The first texture between regions: black, and no team colour.
pub const NO_COLOUR: [u8; 4] = [0, 0, 0, 0];

/// One region to paint.
pub struct Region<'a> {
    /// The picture, and whether the engine reads its v from the bottom row,
    /// which it does for a `.dds`. `None` fills the region instead.
    pub source: Option<(&'a RgbaImage, bool)>,
    /// What to copy, as `[u0, v0, u1, v1]` in the source's UVs. May reach past
    /// 0 and 1, where the source repeats as the engine's `GL_REPEAT` does.
    pub crop: [f64; 4],
    /// Where it goes, as `[x, y, width, height]` in sheet pixels.
    pub dest: [u32; 4],
    /// What a region with no source is filled with.
    pub fill: [u8; 4],
}

/// A parts atlas as the engine draws it: an atlas with no alpha channel has an
/// alpha of 0, which is no team colour anywhere, and one with an alpha keeps
/// it. The same rule `texture::engine_atlas` writes an atlas into a game by.
pub fn atlas_pixels(bytes: &[u8]) -> Result<RgbaImage, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("could not read the atlas as an image: {e}"))?;
    let has_alpha = img.color().has_alpha();
    let mut rgba = img.to_rgba8();
    if !has_alpha {
        for pixel in rgba.pixels_mut() {
            pixel[3] = 0;
        }
    }
    Ok(rgba)
}

/// The width and height a `.dds` header gives, without decoding it. A shared
/// 8192 square atlas is 256 MiB decoded, which is a lot to spend on its size.
pub fn dds_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.get(..4)? != b"DDS " {
        return None;
    }
    let field = |at: usize| -> Option<u32> {
        Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
    };
    // The header's height comes before its width.
    Some((field(16)?, field(12)?))
}

/// The texels whose centres fall in `[start, end)`, or the one under the middle
/// when a sheet pixel is smaller than a texel.
fn span(start: f64, end: f64) -> (i64, i64) {
    let first = (start - 0.5).ceil() as i64;
    let last = (end - 0.5).ceil() as i64;
    if last > first {
        (first, last)
    } else {
        let middle = ((start + end) / 2.0).floor() as i64;
        (middle, middle + 1)
    }
}

/// Paint one region onto the sheet.
///
/// Each sheet pixel is the average of the source texels its share of the crop
/// covers. At the source's own size that is one texel, copied exactly, and on a
/// sheet halved to fit it is a two by two block, and so on.
pub fn paint_region(sheet: &mut RgbaImage, region: &Region) -> Result<(), String> {
    let [x, y, width, height] = region.dest;
    if x.checked_add(width).is_none_or(|end| end > sheet.width())
        || y.checked_add(height).is_none_or(|end| end > sheet.height())
    {
        return Err("a sheet region reaches past the edge of the sheet".to_string());
    }
    let Some((image, flip_y)) = region.source else {
        for j in 0..height {
            for i in 0..width {
                sheet.put_pixel(x + i, y + j, image::Rgba(region.fill));
            }
        }
        return Ok(());
    };
    if image.width() == 0 || image.height() == 0 {
        return Err("a texture on the sheet is empty".to_string());
    }

    let (iw, ih) = (i64::from(image.width()), i64::from(image.height()));
    let [u0, v0, u1, v1] = region.crop;
    let at = |from: f64, to: f64, step: u32, steps: u32| {
        from + (to - from) * f64::from(step) / f64::from(steps)
    };
    for j in 0..height {
        let (ya, yb) = span(
            at(v0, v1, j, height) * ih as f64,
            at(v0, v1, j + 1, height) * ih as f64,
        );
        for i in 0..width {
            let (xa, xb) = span(
                at(u0, u1, i, width) * iw as f64,
                at(u0, u1, i + 1, width) * iw as f64,
            );
            let mut sum = [0u64; 4];
            let mut count = 0u64;
            for ty in ya..yb {
                let row = ty.rem_euclid(ih);
                let row = if flip_y { ih - 1 - row } else { row };
                for tx in xa..xb {
                    let pixel = image.get_pixel(tx.rem_euclid(iw) as u32, row as u32);
                    for (total, channel) in sum.iter_mut().zip(pixel.0) {
                        *total += u64::from(channel);
                    }
                    count += 1;
                }
            }
            let average = sum.map(|total| ((total + count / 2) / count) as u8);
            sheet.put_pixel(x + i, y + j, image::Rgba(average));
        }
    }
    Ok(())
}

/// A whole sheet: `background` everywhere no region covers, then each region.
pub fn compose(
    width: u32,
    height: u32,
    background: [u8; 4],
    regions: &[Region],
) -> Result<RgbaImage, String> {
    let mut sheet = RgbaImage::from_pixel(width, height, image::Rgba(background));
    for region in regions {
        paint_region(&mut sheet, region)?;
    }
    Ok(sheet)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4 by 2 picture whose every pixel says where it is: red is x, green is
    /// y, and alpha is a mask set on one pixel only.
    fn numbered() -> RgbaImage {
        RgbaImage::from_fn(4, 2, |x, y| {
            image::Rgba([x as u8, y as u8, 7, if (x, y) == (1, 0) { 255 } else { 0 }])
        })
    }

    #[test]
    fn a_crop_at_the_sources_own_size_copies_every_texel_exactly() {
        let source = numbered();
        let sheet = compose(
            8,
            4,
            NO_COLOUR,
            &[Region {
                source: Some((&source, false)),
                crop: [0.0, 0.0, 1.0, 1.0],
                dest: [2, 1, 4, 2],
                fill: NO_COLOUR,
            }],
        )
        .expect("sheet");
        for (x, y) in [(0, 0), (1, 0), (3, 1)] {
            assert_eq!(sheet.get_pixel(2 + x, 1 + y), source.get_pixel(x, y));
        }
        // The team colour mask is where the source had it, and nowhere else.
        assert_eq!(sheet.get_pixel(3, 1).0[3], 255);
        assert_eq!(sheet.get_pixel(2, 1).0[3], 0);
        assert_eq!(sheet.get_pixel(0, 0).0, NO_COLOUR);
    }

    #[test]
    fn a_crop_past_the_edge_takes_the_far_side_as_the_engine_repeats_it() {
        let source = numbered();
        let sheet = compose(
            6,
            2,
            NO_COLOUR,
            &[Region {
                source: Some((&source, false)),
                // One texel either side of the whole width.
                crop: [-0.25, 0.0, 1.25, 1.0],
                dest: [0, 0, 6, 2],
                fill: NO_COLOUR,
            }],
        )
        .expect("sheet");
        assert_eq!(sheet.get_pixel(0, 0).0[0], 3);
        assert_eq!(sheet.get_pixel(1, 0).0[0], 0);
        assert_eq!(sheet.get_pixel(5, 0).0[0], 0);
    }

    #[test]
    fn a_dds_has_its_v_counted_from_the_bottom_row() {
        let source = numbered();
        let sheet = compose(
            4,
            2,
            NO_COLOUR,
            &[Region {
                source: Some((&source, true)),
                crop: [0.0, 0.0, 1.0, 1.0],
                dest: [0, 0, 4, 2],
                fill: NO_COLOUR,
            }],
        )
        .expect("sheet");
        // v = 0 is the bottom row of the picture, which goes on the sheet's
        // top row, since the sheet is a PNG read top row first.
        assert_eq!(sheet.get_pixel(0, 0).0[1], 1);
        assert_eq!(sheet.get_pixel(0, 1).0[1], 0);
    }

    #[test]
    fn a_halved_region_averages_each_block_of_texels() {
        let source = RgbaImage::from_fn(2, 2, |x, y| {
            let level = if (x + y) % 2 == 0 { 200 } else { 100 };
            image::Rgba([level, level, level, level])
        });
        let sheet = compose(
            1,
            1,
            NO_COLOUR,
            &[Region {
                source: Some((&source, false)),
                crop: [0.0, 0.0, 1.0, 1.0],
                dest: [0, 0, 1, 1],
                fill: NO_COLOUR,
            }],
        )
        .expect("sheet");
        assert_eq!(sheet.get_pixel(0, 0).0, [150, 150, 150, 150]);
    }

    #[test]
    fn a_region_with_no_source_is_filled() {
        let sheet = compose(
            2,
            2,
            NO_COLOUR,
            &[Region {
                source: None,
                crop: [0.0, 0.0, 1.0, 1.0],
                dest: [1, 0, 1, 2],
                fill: NO_SHADING,
            }],
        )
        .expect("sheet");
        assert_eq!(sheet.get_pixel(1, 1).0, NO_SHADING);
        assert_eq!(sheet.get_pixel(0, 1).0, NO_COLOUR);
    }

    #[test]
    fn a_region_past_the_sheet_is_refused() {
        let source = numbered();
        let result = compose(
            2,
            2,
            NO_COLOUR,
            &[Region {
                source: Some((&source, false)),
                crop: [0.0, 0.0, 1.0, 1.0],
                dest: [1, 0, 4, 2],
                fill: NO_COLOUR,
            }],
        );
        assert!(result.is_err());
    }

    #[test]
    fn an_atlas_with_no_alpha_carries_no_team_colour_and_one_with_alpha_keeps_it() {
        let encode = |img: image::DynamicImage| {
            let mut out = std::io::Cursor::new(Vec::new());
            img.write_to(&mut out, image::ImageFormat::Png)
                .expect("encode");
            out.into_inner()
        };
        let opaque = encode(image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            2,
            1,
            image::Rgb([1, 2, 3]),
        )));
        assert!(atlas_pixels(&opaque)
            .expect("atlas")
            .pixels()
            .all(|pixel| pixel.0 == [1, 2, 3, 0]));

        let masked = encode(image::DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            2,
            1,
            image::Rgba([1, 2, 3, 200]),
        )));
        assert!(atlas_pixels(&masked)
            .expect("atlas")
            .pixels()
            .all(|pixel| pixel.0 == [1, 2, 3, 200]));
    }

    #[test]
    fn a_dds_size_is_read_off_its_header() {
        let mut header = vec![0u8; 128];
        header[..4].copy_from_slice(b"DDS ");
        header[12..16].copy_from_slice(&512u32.to_le_bytes());
        header[16..20].copy_from_slice(&1024u32.to_le_bytes());
        assert_eq!(dds_size(&header), Some((1024, 512)));
        assert_eq!(dds_size(b"not a dds at all, but long enough"), None);
    }
}
