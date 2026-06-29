//! Minimap rendering: turn unitsync's RGB565 minimap buffers into PNG `data:`
//! URLs. Used two ways — a single map's larger preview (`render`) and a batch of
//! small thumbnails for the whole map list (`render_all`), each in one `Init`.

use crate::ffi::Unitsync;
use crate::model::{MinimapOutput, Thumbnail, ThumbnailsOutput};
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbImage};
use std::io::Cursor;
use std::path::Path;

/// Render `map_name`'s minimap at `mip` to a PNG data URL (standalone session).
pub fn render(lib: &str, map_name: &str, mip: i32) -> MinimapOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return MinimapOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();
    let result = render_one(&us, map_name, mip);
    let errors = us.drain_errors();
    us.uninit();

    match result {
        Ok((data_url, side)) => MinimapOutput {
            data_url: Some(data_url),
            side: Some(side),
            errors,
        },
        Err(e) => MinimapOutput {
            errors: std::iter::once(e).chain(errors).collect(),
            ..Default::default()
        },
    }
}

/// Render a small thumbnail for every map in one `Init` session.
pub fn render_all(lib: &str, mip: i32) -> ThumbnailsOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return ThumbnailsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    let mut thumbnails = Vec::new();
    for i in 0..us.map_count() {
        let Some(name) = us.map_name(i) else {
            continue;
        };
        match render_one(&us, &name, mip) {
            Ok((data_url, _)) => thumbnails.push(Thumbnail { name, data_url }),
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    errors.extend(us.drain_errors());
    us.uninit();

    ThumbnailsOutput { thumbnails, errors }
}

/// Render one map's minimap to `(data_url, side)` using an already-initialised
/// session. The caller owns the `Init`/`UnInit` lifecycle.
fn render_one(us: &Unitsync, map_name: &str, mip: i32) -> Result<(String, u32), String> {
    let pixels = us
        .minimap(map_name, mip)
        .ok_or_else(|| "no minimap available".to_string())?;
    let side = 1024u32 >> mip.clamp(0, 10) as u32;
    if pixels.len() != (side * side) as usize {
        return Err(format!(
            "unexpected minimap size: got {} px, expected {}",
            pixels.len(),
            side * side
        ));
    }
    Ok((pixels_to_data_url(&pixels, side)?, side))
}

/// Convert an RGB565 square buffer to a base64 PNG data URL.
fn pixels_to_data_url(pixels: &[u16], side: u32) -> Result<String, String> {
    let mut rgb = Vec::with_capacity(pixels.len() * 3);
    for &p in pixels {
        rgb.push((((p >> 11) & 0x1f) << 3) as u8);
        rgb.push((((p >> 5) & 0x3f) << 2) as u8);
        rgb.push(((p & 0x1f) << 3) as u8);
    }
    let img = RgbImage::from_raw(side, side, rgb).ok_or("failed to build minimap image")?;
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(img)
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| format!("failed to encode minimap PNG: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Print a minimap error envelope to stdout (used on panic).
pub fn emit_error(msg: String) {
    let out = MinimapOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
