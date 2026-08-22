//! Pack the tiles a `.3do` names into one sheet.
//!
//! An `.s3o` names a single texture and every face samples it, which is what a
//! lego unit is: one model, one texture, one export. A `.3do` is not built that
//! way. Each face names its own tile in `unittextures/tatex/` and stretches
//! over the whole of it, so a unit is drawn from dozens of small tiles and
//! carries no texture coordinates at all.
//!
//! Opening one is therefore a conversion rather than a read, and this is the
//! part that converts: the tiles go into one sheet and every face gets real
//! coordinates onto it. After this a `.3do` unit is an ordinary unit, and an
//! export writes it as an `.s3o` with nothing special about it.
//!
//! Two details that would otherwise show up as visible faults.
//!
//! Every tile is drawn with a one pixel border of its own edge pixels, and the
//! coordinates handed back sit half a texel inside that. A face stretched over
//! a whole tile samples right up to the edge, so without the border the filter
//! blends in whichever tile was packed next to it and every face is fringed
//! with the wrong colour.
//!
//! Faces the format gives a flat palette colour rather than a texture get a
//! tile of their own. The Total Annihilation palette is embedded in the engine
//! rather than shipped in the archive, so there is no colour to look up, and
//! the honest answer is one plain tile and a count of the faces that took it.

use std::collections::BTreeMap;

use image::RgbaImage;

/// Pixels of edge-copy around every tile. One is enough: a bilinear filter
/// reaches half a texel past the edge, and the coordinates are inset by that.
const BORDER: u32 = 1;

/// The smallest sheet worth making, and the largest.
///
/// A unit with four tiles does not need a 2048 sheet, and no unit needs more
/// than the largest: Balanced Annihilation's heaviest model names 25 tiles, and
/// TA tiles are 32 or 64 pixels square.
const MIN_SIDE: u32 = 64;
const MAX_SIDE: u32 = 2048;

/// What the flat-colour tile is drawn in.
///
/// Mid grey rather than a guess at the palette. A face drawn in a colour
/// coilbox does not have is better plainly wrong than confidently wrong, and
/// the count says how many took it.
const PALETTE_GREY: [u8; 4] = [128, 128, 128, 255];

/// The name the flat-colour tile is filed under, which no `.3do` texture name
/// can collide with: the format stores names without a path separator.
pub const PALETTE_TILE: &str = "/palette";

/// Where one tile sits on the sheet, as texture coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
}

impl Rect {
    /// The point a face's corner lands on, given where that corner sits on the
    /// tile. A `.3do` face takes the tile's own corners, so this is a plain
    /// interpolation.
    pub fn at(&self, u: f32, v: f32) -> [f32; 2] {
        [
            self.u0 + (self.u1 - self.u0) * u,
            self.v0 + (self.v1 - self.v0) * v,
        ]
    }
}

/// One tile to pack: its name and its pixels.
pub struct Tile {
    pub name: String,
    pub image: RgbaImage,
}

pub struct Packed {
    pub image: RgbaImage,
    /// Where each tile ended up, by name.
    pub rects: BTreeMap<String, Rect>,
}

/// Pack `tiles` into one square sheet.
///
/// Always square and always a power of two, because that is what every game's
/// unit textures are and what the oldest hardware a Spring game runs on wants.
/// The sheet grows by doubling until everything fits, so a small unit gets a
/// small sheet.
///
/// A flat-colour tile is added whenever `palette` is set, so a model with faces
/// the format gives a colour rather than a texture has somewhere for them to
/// sample from.
pub fn pack(mut tiles: Vec<Tile>, palette: bool) -> Result<Packed, String> {
    if palette {
        let mut tile = RgbaImage::new(8, 8);
        for pixel in tile.pixels_mut() {
            *pixel = image::Rgba(PALETTE_GREY);
        }
        tiles.push(Tile {
            name: PALETTE_TILE.to_string(),
            image: tile,
        });
    }
    if tiles.is_empty() {
        return Err("this model names no textures at all".into());
    }

    // Tallest first, which is what makes a shelf packer tight rather than
    // leaving a band of dead space above every short tile on a shelf.
    tiles.sort_by(|a, b| {
        b.image
            .height()
            .cmp(&a.image.height())
            .then_with(|| a.name.cmp(&b.name))
    });

    let mut side = MIN_SIDE;
    loop {
        if let Some(placed) = try_pack(&tiles, side) {
            return Ok(draw(&tiles, &placed, side));
        }
        if side >= MAX_SIDE {
            return Err(format!(
                "this model's {} textures do not fit on a {MAX_SIDE} pixel sheet",
                tiles.len()
            ));
        }
        side *= 2;
    }
}

/// Where each tile goes on a sheet of this size, or nothing if they do not fit.
///
/// A shelf packer: fill a row left to right, and start a new row below when the
/// next tile does not fit. Tiles are near enough all one size in a `.3do`, so
/// the cleverer packers buy nothing here.
fn try_pack(tiles: &[Tile], side: u32) -> Option<Vec<(u32, u32)>> {
    let mut placed = Vec::with_capacity(tiles.len());
    let (mut x, mut y, mut shelf) = (0u32, 0u32, 0u32);
    for tile in tiles {
        let width = tile.image.width() + BORDER * 2;
        let height = tile.image.height() + BORDER * 2;
        if width > side || height > side {
            return None;
        }
        if x + width > side {
            x = 0;
            y += shelf;
            shelf = 0;
        }
        if y + height > side {
            return None;
        }
        placed.push((x + BORDER, y + BORDER));
        x += width;
        shelf = shelf.max(height);
    }
    Some(placed)
}

/// Draw the tiles onto the sheet, each with its border, and work out the
/// coordinates each one hands to a face.
fn draw(tiles: &[Tile], placed: &[(u32, u32)], side: u32) -> Packed {
    let mut sheet = RgbaImage::new(side, side);
    let mut rects = BTreeMap::new();
    let scale = side as f32;

    for (tile, &(left, top)) in tiles.iter().zip(placed) {
        let (width, height) = (tile.image.width(), tile.image.height());
        // The tile, then its border, taken from the edge pixels so a filter
        // reaching past the edge finds the tile's own colour rather than its
        // neighbour's.
        for y in 0..height + BORDER * 2 {
            for x in 0..width + BORDER * 2 {
                let from_x = x.saturating_sub(BORDER).min(width - 1);
                let from_y = y.saturating_sub(BORDER).min(height - 1);
                let pixel = *tile.image.get_pixel(from_x, from_y);
                sheet.put_pixel(left - BORDER + x, top - BORDER + y, pixel);
            }
        }
        // Half a texel in from each edge, which is where a filter samples the
        // outermost pixel's centre rather than the boundary between two.
        rects.insert(
            tile.name.clone(),
            Rect {
                u0: (left as f32 + 0.5) / scale,
                v0: (top as f32 + 0.5) / scale,
                u1: (left as f32 + width as f32 - 0.5) / scale,
                v1: (top as f32 + height as f32 - 0.5) / scale,
            },
        );
    }

    Packed {
        image: sheet,
        rects,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(name: &str, side: u32, shade: u8) -> Tile {
        let mut image = RgbaImage::new(side, side);
        for pixel in image.pixels_mut() {
            *pixel = image::Rgba([shade, shade, shade, 255]);
        }
        Tile {
            name: name.to_string(),
            image,
        }
    }

    #[test]
    fn puts_every_tile_somewhere() {
        let packed = pack(vec![tile("a", 32, 10), tile("b", 32, 20)], false).unwrap();

        assert!(packed.rects.contains_key("a"));
        assert!(packed.rects.contains_key("b"));
    }

    /// A sheet is square and a power of two, which is what every game's unit
    /// textures are.
    #[test]
    fn makes_a_square_power_of_two_sheet() {
        let packed = pack(vec![tile("a", 32, 10)], false).unwrap();

        assert_eq!(packed.image.width(), packed.image.height());
        assert!(packed.image.width().is_power_of_two());
    }

    #[test]
    fn grows_the_sheet_until_the_tiles_fit() {
        let many: Vec<Tile> = (0..20)
            .map(|i| tile(&format!("t{i}"), 64, i as u8))
            .collect();
        let packed = pack(many, false).unwrap();

        assert!(packed.image.width() >= 256, "{}", packed.image.width());
        assert_eq!(packed.rects.len(), 20);
    }

    /// Two tiles overlapping would draw one unit's face with another's paint.
    #[test]
    fn never_overlaps_two_tiles() {
        let packed = pack(
            vec![tile("a", 32, 10), tile("b", 16, 20), tile("c", 32, 30)],
            false,
        )
        .unwrap();

        let side = packed.image.width() as f32;
        let boxes: Vec<[f32; 4]> = packed
            .rects
            .values()
            .map(|r| [r.u0 * side, r.v0 * side, r.u1 * side, r.v1 * side])
            .collect();
        for (i, a) in boxes.iter().enumerate() {
            for b in &boxes[i + 1..] {
                let apart = a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
                assert!(apart, "{a:?} overlaps {b:?}");
            }
        }
    }

    /// Without the border a face stretched over a whole tile samples its
    /// neighbour, and every face comes out fringed with the wrong colour.
    #[test]
    fn surrounds_each_tile_with_its_own_edge_pixels() {
        let packed = pack(vec![tile("a", 8, 10), tile("b", 8, 200)], false).unwrap();

        let side = packed.image.width() as f32;
        let a = packed.rects["a"];
        // Just outside the tile's own coordinates, which is where a filter
        // reaches and where the border has to be.
        let x = (a.u0 * side - 1.0).round().max(0.0) as u32;
        let y = (a.v0 * side).round() as u32;
        assert_eq!(packed.image.get_pixel(x, y).0, [10, 10, 10, 255]);
    }

    #[test]
    fn adds_a_tile_for_faces_drawn_in_a_flat_colour() {
        let packed = pack(vec![tile("a", 32, 10)], true).unwrap();

        assert!(packed.rects.contains_key(PALETTE_TILE));
    }

    #[test]
    fn refuses_a_model_that_names_no_textures() {
        assert!(pack(Vec::new(), false).is_err());
    }

    /// A face takes the tile's own corners, so the coordinates it gets have to
    /// stay inside the tile.
    #[test]
    fn maps_a_face_corner_inside_its_own_tile() {
        let packed = pack(vec![tile("a", 32, 10), tile("b", 32, 20)], false).unwrap();
        let a = packed.rects["a"];

        for (u, v) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] {
            let [su, sv] = a.at(u, v);
            assert!((a.u0..=a.u1).contains(&su), "{su} outside {a:?}");
            assert!((a.v0..=a.v1).contains(&sv), "{sv} outside {a:?}");
        }
    }
}
