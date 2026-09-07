//! The record of a packed sheet, written beside it as JSON.
//!
//! A sheet is only useful twice if something can say where its tiles are. The
//! first conversion packs the tiles, draws the sheet and knows every rectangle.
//! A later one has the picture and nothing else, and repacking it would move
//! every tile. That matters more than it sounds: an `.s3o` stores coordinates,
//! not tile names, so a repack silently invalidates every model already
//! converted against the old sheet. They keep pointing at where their tile used
//! to be, and the units come out painted in each other's colours.
//!
//! So the rectangles are written down. [`Sheet::read`] hands them back, and
//! [`crate::Rect::for_tile`] turns each one into the coordinates a face takes,
//! which is the same call the packer makes. Neither side has its own reading of
//! where half a texel is or which way up a row is counted.
//!
//! Pixels rather than coordinates, because pixels are what a person checking
//! the file against the picture can measure, and because a rectangle means the
//! same thing whatever the sheet is later resized to. `x` and `y` are the top
//! left of the tile's own pixels: the one pixel border drawn around it (see
//! [`crate::BORDER`]) sits outside them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::atlas::{Packed, Placement, Rect};

/// Where a sheet and its record are written inside `unittextures/`, so both the
/// batch conversion (`coilbox-unitsync-worker`'s `--convert-3do`, issue #2573)
/// and a single model import (issue #2623) agree on the one place to look.
/// `unittextures/<SHEET_DIR>/<stem>.png` and its `.json` record beside it, a
/// folder of its own rather than loose in `unittextures/` so an overlay
/// dropped over a real game cannot land a sheet on top of one of the game's
/// own textures.
pub const SHEET_DIR: &str = "3do";

/// What the file says it is, so a JSON file that is not one of these is refused
/// by name rather than by a missing field.
pub const SHEET_KIND: &str = "coilbox-3do-atlas";

/// Bump when a reader could be misled by a file an older writer produced.
/// Adding a field nothing has to read is not that.
pub const SHEET_VERSION: u32 = 1;

/// One tile's rectangle on the sheet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SheetTile {
    /// The `.3do` texture name, as the model spells it, or the synthetic name a
    /// flat palette colour is filed under (see [`crate::palette_tile_name`]).
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// A packed sheet's contents, as written beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sheet {
    /// Always [`SHEET_KIND`].
    pub kind: String,
    pub version: u32,
    /// The picture this describes, as a file name beside this one.
    pub image: String,
    /// The sheet is square, so one number covers both sides.
    pub side: u32,
    /// Pixels of edge-copy around each tile. Recorded rather than assumed so a
    /// reader can tell the border apart from the tile if it ever changes.
    pub border: u32,
    /// Sorted by name, so two runs over the same tiles produce the same bytes.
    pub tiles: Vec<SheetTile>,
}

impl Sheet {
    /// The record of `packed`, drawn as `image`.
    pub fn of(packed: &Packed, image: &str) -> Self {
        Self {
            kind: SHEET_KIND.to_string(),
            version: SHEET_VERSION,
            image: image.to_string(),
            side: packed.image.width(),
            border: crate::atlas::BORDER,
            // A `BTreeMap` iterates in name order, which is what makes this
            // deterministic without a sort of its own.
            tiles: packed
                .placements
                .iter()
                .map(|(name, at)| SheetTile {
                    name: name.clone(),
                    x: at.left,
                    y: at.top,
                    width: at.width,
                    height: at.height,
                })
                .collect(),
        }
    }

    /// Parse one back.
    ///
    /// Refuses a file that does not say it is one of these, or that a reader
    /// this old cannot be trusted with, rather than reading whatever fields
    /// happen to match and handing back rectangles from somewhere else.
    pub fn read(bytes: &[u8]) -> Result<Self, String> {
        let sheet: Self = serde_json::from_slice(bytes)
            .map_err(|e| format!("this is not an atlas record: {e}"))?;
        if sheet.kind != SHEET_KIND {
            return Err(format!(
                "this JSON says it is {:?}, not {SHEET_KIND:?}",
                sheet.kind
            ));
        }
        if sheet.version > SHEET_VERSION {
            return Err(format!(
                "this atlas record is version {}, and this build reads up to {SHEET_VERSION}",
                sheet.version
            ));
        }
        if sheet.side == 0 {
            return Err("this atlas record gives the sheet no size".into());
        }
        Ok(sheet)
    }

    pub fn write(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(self)
            .map_err(|e| format!("could not write the atlas record: {e}"))
    }

    /// The coordinates each tile hands a face, which is what a conversion needs
    /// and the only reason the rectangles were kept.
    pub fn rects(&self) -> BTreeMap<String, Rect> {
        self.tiles
            .iter()
            .map(|tile| {
                (
                    tile.name.clone(),
                    Rect::for_tile(tile.x, tile.y, tile.width, tile.height, self.side),
                )
            })
            .collect()
    }

    /// The same rectangles in pixels, for a caller drawing onto the sheet
    /// rather than sampling from it.
    pub fn placements(&self) -> BTreeMap<String, Placement> {
        self.tiles
            .iter()
            .map(|tile| {
                (
                    tile.name.clone(),
                    Placement {
                        left: tile.x,
                        top: tile.y,
                        width: tile.width,
                        height: tile.height,
                    },
                )
            })
            .collect()
    }

    /// Whether this sheet already holds every tile in `wanted`.
    ///
    /// What decides whether a second run can share the first run's sheet. A
    /// sheet holding more than is asked for is fine, and is the normal case
    /// once one model of a folder is converted on its own.
    pub fn covers<'a>(&self, wanted: impl IntoIterator<Item = &'a str>) -> bool {
        let held: std::collections::BTreeSet<&str> =
            self.tiles.iter().map(|t| t.name.as_str()).collect();
        wanted.into_iter().all(|name| held.contains(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::{pack, Tile};
    use image::RgbaImage;

    fn tile(name: &str, side: u32) -> Tile {
        Tile {
            name: name.to_string(),
            image: RgbaImage::from_pixel(side, side, image::Rgba([9, 9, 9, 255])),
        }
    }

    /// The whole point of the file: what is read back is what was packed, tile
    /// for tile and coordinate for coordinate. A drift of half a texel here
    /// paints every unit converted against a shared sheet with its neighbour's
    /// colours, and nothing about the picture would look wrong.
    #[test]
    fn a_sheet_read_back_gives_the_coordinates_the_pack_handed_out() {
        let packed =
            pack(&[tile("arm01a", 64), tile("core3", 32), tile("/palette/7", 8)]).expect("pack");

        let written = Sheet::of(&packed, "objects3d.png").write().expect("write");
        let back = Sheet::read(&written).expect("read");

        assert_eq!(back.rects(), packed.rects);
        assert_eq!(back.placements(), packed.placements);
        assert_eq!(back.side, packed.image.width());
        assert_eq!(back.image, "objects3d.png");
    }

    /// Two runs over the same tiles write the same bytes, so a re-run that
    /// changed nothing shows up as no change.
    #[test]
    fn writing_the_same_sheet_twice_gives_the_same_bytes() {
        let packed = pack(&[tile("b", 32), tile("a", 32)]).expect("pack");
        let sheet = Sheet::of(&packed, "x.png");

        assert_eq!(sheet.write().unwrap(), sheet.write().unwrap());
        assert_eq!(
            sheet.tiles.iter().map(|t| &t.name).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn a_json_file_that_is_not_one_of_these_is_refused() {
        assert!(Sheet::read(b"{\"hello\":1}").is_err());
        assert!(Sheet::read(b"not json at all").is_err());
        let wrong = br#"{"kind":"something-else","version":1,"image":"a.png","side":64,"border":1,"tiles":[]}"#;
        assert!(Sheet::read(wrong).is_err());
    }

    /// A file from a future writer is refused rather than read for the fields
    /// that happen to still parse.
    #[test]
    fn a_record_from_a_newer_writer_is_refused() {
        let mut sheet = Sheet::of(&pack(&[tile("a", 32)]).unwrap(), "a.png");
        sheet.version = SHEET_VERSION + 1;
        let bytes = sheet.write().unwrap();

        assert!(Sheet::read(&bytes).is_err());
    }

    /// What decides whether a second run shares the first run's sheet.
    #[test]
    fn a_sheet_covers_a_subset_of_its_own_tiles_and_not_a_stranger() {
        let packed = pack(&[tile("a", 32), tile("b", 32)]).unwrap();
        let sheet = Sheet::of(&packed, "a.png");

        assert!(sheet.covers(["a"]));
        assert!(sheet.covers(["a", "b"]));
        assert!(!sheet.covers(["a", "c"]));
    }
}
