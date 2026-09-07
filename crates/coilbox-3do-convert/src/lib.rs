//! Converting Total Annihilation's `.3do` models into Spring's `.s3o`.
//!
//! Opening a `.3do` is a conversion rather than a read, and this crate is the
//! conversion. An `.s3o` binds one texture and stores coordinates into it. A
//! `.3do` names a small tile per face out of `unittextures/tatex/`, stores no
//! coordinates at all, and stretches each face over the whole of its tile. So
//! the tiles go onto one sheet ([`pack`]) and every face gets real coordinates
//! onto it ([`to_s3o`]).
//!
//! One sheet can serve one model or a folder of them, which is the difference
//! between opening a unit in the builder and converting a whole game. A game
//! wants the folder: the engine then binds one texture for the faction rather
//! than one per unit. [`Sheet`] is what makes that survive a second run, by
//! writing down where every tile landed so a later conversion shares the sheet
//! instead of repacking it and moving every tile out from under the models
//! already written against it.
//!
//! Nothing here touches the filesystem or an archive. Tiles arrive decoded and
//! the finished sheet leaves as pixels, so the same code serves a model on disk
//! and a model inside a packed game.

mod atlas;
mod convert;
mod sheet;

pub use atlas::{
    pack, palette_tile_name, Packed, Placement, Rect, Tile, BORDER, MAX_SIDE, PALETTE_GREY,
    PALETTE_TILE, PALETTE_TILE_SIDE,
};
pub use convert::{is_dead_duplicate, to_s3o, Converted, Rects};
pub use sheet::{Sheet, SheetTile, SHEET_KIND, SHEET_VERSION};

/// The tiles a model's flat-colour faces need: a fallback grey always, plus one
/// small tile per distinct palette entry the model names that `palette`
/// resolves.
///
/// The fallback is unconditional, matching [`to_s3o`]'s indexing into it: a
/// model with no palette faces at all still gets one, unused, which costs eight
/// by eight pixels of sheet space and is simpler than threading "does this
/// model even have any" through both.
///
/// Alpha zero on every tile here, resolved or not, the same as an ordinary
/// tile's team-colour mask gets: on an `.s3o` the first texture's alpha is that
/// mask, and a palette face is not a region the player's colour belongs on
/// (`C3DOTextureHandler::LoadTexFiles`,
/// `rts/Rendering/Textures/3DOTextureHandler.cpp`, forces the same channel to
/// zero for its own `ta_color<N>` dummy textures).
pub fn palette_tiles(
    model: &coilbox_3do::Model,
    palette: Option<&coilbox_3do::Palette>,
) -> Vec<Tile> {
    let side = PALETTE_TILE_SIDE;
    let mut tiles = vec![Tile {
        name: PALETTE_TILE.to_string(),
        image: image::RgbaImage::from_pixel(side, side, image::Rgba(PALETTE_GREY)),
    }];

    for entry in palette_entries(model) {
        let Some(rgb) = usize::try_from(entry)
            .ok()
            .and_then(|i| palette.and_then(|p| p.get(i)).copied())
        else {
            continue;
        };
        tiles.push(Tile {
            name: palette_tile_name(entry),
            image: image::RgbaImage::from_pixel(
                side,
                side,
                image::Rgba([rgb[0], rgb[1], rgb[2], 0]),
            ),
        });
    }
    tiles
}

/// Every distinct palette entry `model`'s faces name, in the order they first
/// appear.
pub fn palette_entries(model: &coilbox_3do::Model) -> Vec<i32> {
    let mut out: Vec<i32> = Vec::new();
    for piece in model.root.walk() {
        for prim in &piece.primitives {
            if let coilbox_3do::Texture::Palette(entry) = prim.texture {
                if !out.contains(&entry) {
                    out.push(entry);
                }
            }
        }
    }
    out
}

/// Every distinct tile name `model`'s faces ask for, in the order they first
/// appear. An empty name is still a name (issue #2610): the engine resolves it
/// exactly like any other, appending `00` and looking it up as real artwork, so
/// it is collected here the same way. The format's actual "no texture" case is
/// a `Texture::Palette` entry, a distinct field this function does not read at
/// all.
pub fn tile_names(model: &coilbox_3do::Model) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for piece in model.root.walk() {
        for prim in &piece.primitives {
            if let coilbox_3do::Texture::Name(name) = &prim.texture {
                if !out.iter().any(|held| held == name) {
                    out.push(name.clone());
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette_face(entry: i32) -> coilbox_3do::Primitive {
        coilbox_3do::Primitive {
            indices: vec![0, 1, 2],
            texture: coilbox_3do::Texture::Palette(entry),
            normal: [0.0, 1.0, 0.0],
            vertex_normals: vec![[0.0, 1.0, 0.0]; 3],
        }
    }

    fn named_face(name: &str) -> coilbox_3do::Primitive {
        coilbox_3do::Primitive {
            indices: vec![0, 1, 2],
            texture: coilbox_3do::Texture::Name(name.into()),
            normal: [0.0, 1.0, 0.0],
            vertex_normals: vec![[0.0, 1.0, 0.0]; 3],
        }
    }

    fn model_with(primitives: Vec<coilbox_3do::Primitive>) -> coilbox_3do::Model {
        coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: coilbox_3do::Piece {
                name: "body".into(),
                offset: [0.0; 3],
                vertices: vec![[0.0; 3], [1.0, 0.0, 0.0], [1.0, 0.0, 1.0]],
                primitives,
                children: Vec::new(),
            },
        }
    }

    fn a_palette() -> coilbox_3do::Palette {
        let mut palette = [[0u8; 3]; 256];
        palette[3] = [10, 20, 30];
        palette
    }

    /// The fallback is there whatever the model names, matching [`to_s3o`]'s
    /// unconditional indexing into it.
    #[test]
    fn there_is_always_a_fallback_tile() {
        let tiles = palette_tiles(&model_with(vec![named_face("arm2")]), None);

        assert_eq!(tiles.len(), 1);
        assert_eq!(tiles[0].name, PALETTE_TILE);
    }

    #[test]
    fn a_resolved_entry_gets_its_own_tile_in_its_own_colour() {
        let palette = a_palette();
        let tiles = palette_tiles(&model_with(vec![palette_face(3)]), Some(&palette));
        let tile = tiles
            .iter()
            .find(|t| t.name == palette_tile_name(3))
            .expect("the resolved entry has a tile");

        assert_eq!(tile.image.get_pixel(0, 0).0, [10, 20, 30, 0]);
    }

    /// Two faces naming the same entry get one tile, not two.
    #[test]
    fn one_tile_per_distinct_entry_a_model_uses() {
        let palette = a_palette();
        let tiles = palette_tiles(
            &model_with(vec![palette_face(3), palette_face(3)]),
            Some(&palette),
        );

        assert_eq!(tiles.len(), 2);
    }

    #[test]
    fn an_entry_outside_the_table_gets_no_tile_of_its_own() {
        let palette = a_palette();
        let tiles = palette_tiles(&model_with(vec![palette_face(300)]), Some(&palette));

        assert!(!tiles.iter().any(|t| t.name == palette_tile_name(300)));
    }

    /// The whole road, end to end, because every step of it has a way of being
    /// quietly wrong. Tiles are packed, a model is converted against the
    /// rectangles, the result is written as an `.s3o`, and then the file and
    /// the sidecar are read back and checked against each other.
    ///
    /// The check that matters is the last one: every coordinate in the written
    /// file has to land inside a tile the sidecar names. A coordinate that
    /// lands in the dead space between tiles draws that face in transparent
    /// black, which is invisible in a viewport that never opened the file and
    /// glaring in the game.
    #[test]
    fn a_written_s3o_reads_back_with_every_corner_on_a_tile_the_sidecar_names() {
        let mut tiles = vec![
            Tile {
                name: "arm2".into(),
                image: image::RgbaImage::from_pixel(64, 64, image::Rgba([1, 2, 3, 0])),
            },
            Tile {
                name: "arm3".into(),
                image: image::RgbaImage::from_pixel(32, 32, image::Rgba([4, 5, 6, 0])),
            },
        ];
        let palette = a_palette();
        let model = model_with(vec![
            named_face("arm2"),
            named_face("arm3"),
            palette_face(3),
        ]);
        tiles.extend(palette_tiles(&model, Some(&palette)));

        let packed = pack(&tiles).expect("pack");
        let sheet = Sheet::of(&packed, "objects3d.png");
        let converted = to_s3o(&model, &packed.rects, "3do/objects3d.png").expect("convert");
        let bytes = coilbox_s3o::write(&converted.model).expect("write");

        // From here on, only what is on disk: the file's own bytes and the
        // sidecar's own JSON, read back through the record rather than through
        // the values the pack handed out.
        let back = coilbox_s3o::read(&bytes).expect("read");
        let record = Sheet::read(&sheet.write().expect("write the record")).expect("read it back");
        let rects = record.rects();
        assert_eq!(back.texture1, "3do/objects3d.png");
        assert_eq!(back.texture2, "");

        let mut landed = std::collections::BTreeSet::new();
        let mut corners = 0;
        for piece in back.root.walk() {
            for vertex in &piece.vertices {
                corners += 1;
                let [u, v] = vertex.uv;
                let on = rects.iter().find(|(_, r)| {
                    (r.u0 - 1e-6..=r.u1 + 1e-6).contains(&u)
                        && (r.v1.min(r.v0) - 1e-6..=r.v0.max(r.v1) + 1e-6).contains(&v)
                });
                let (name, _) = on.unwrap_or_else(|| panic!("{u},{v} is on no tile"));
                landed.insert(name.clone());
            }
        }

        assert_eq!(corners, 9, "three faces of three corners each");
        assert_eq!(
            landed.into_iter().collect::<Vec<_>>(),
            vec!["/palette/3", "arm2", "arm3"],
            "each face landed on the tile it named"
        );
    }

    #[test]
    fn names_every_tile_once_in_the_order_it_first_appears() {
        let model = model_with(vec![
            named_face("arm2"),
            named_face("arm1"),
            named_face("arm2"),
        ]);

        assert_eq!(tile_names(&model), vec!["arm2", "arm1"]);
    }

    /// An empty name is a name the engine resolves to `"00"`, not the format's
    /// "no texture" case, so it is collected the same as any other (issue
    /// #2610).
    #[test]
    fn an_empty_name_is_still_a_name() {
        let model = model_with(vec![named_face("arm2"), named_face("")]);

        assert_eq!(tile_names(&model), vec!["arm2".to_string(), String::new()]);
    }
}
