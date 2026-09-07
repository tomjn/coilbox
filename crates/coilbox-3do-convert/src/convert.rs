//! Turning a read `.3do` into a model an `.s3o` writer takes.
//!
//! The whole difference between the two formats lands here. An `.s3o` binds one
//! texture for the model and every vertex carries coordinates into it. A `.3do`
//! names a tile per face, stores no coordinates at all, and stretches each face
//! over the whole of the tile it names. So the caller packs the tiles into one
//! sheet (see [`crate::pack`]) and this gives every face corner a real
//! coordinate onto it.
//!
//! Nothing here reads a file or knows where a tile came from. It is handed the
//! rectangles and hands back a model, which is what lets one sheet serve one
//! unit or a whole folder of them without this knowing the difference.

use std::collections::{BTreeMap, BTreeSet};

use crate::atlas::{self, Rect};

/// Where each of a `.3do`'s tiles ended up on the packed sheet.
pub type Rects = BTreeMap<String, Rect>;

/// One converted model, and what the conversion could not do properly.
pub struct Converted {
    pub model: coilbox_s3o::Model,
    /// Faces the format gives a flat palette colour that nothing resolved to a
    /// real colour, so they are drawn in the plain fallback grey. A face whose
    /// entry did resolve is drawn in its own colour and is not counted, and
    /// neither is one whose named tile was found. Named textures that went
    /// missing are counted here as well, since their faces come out the same
    /// way, and [`Converted::missing_textures`] says which.
    pub palette_faces: usize,
    /// How many of [`Converted::palette_faces`] came out plain because the tile
    /// they named was not on the sheet, rather than because their palette entry
    /// resolved to nothing.
    ///
    /// The two are counted together above because they are the same thing to
    /// look at, a face drawn in flat grey, and separately here because they are
    /// not the same thing to fix. One means a texture is missing from the game
    /// or from the sheet. The other means the palette itself did not resolve.
    pub missing_texture_faces: usize,
    /// Tile names the model asks for that the sheet does not hold. Their faces
    /// are drawn plain, and saying which ones is the only way anybody works out
    /// what is missing.
    pub missing_textures: Vec<String>,
    /// Child pieces dropped as dead duplicates of an earlier sibling. See
    /// [`is_dead_duplicate`] for the exact rule.
    pub dropped_pieces: usize,
    /// Vertices and triangles written, for a caller reporting what it did.
    pub vertices: usize,
    pub triangles: usize,
}

/// Convert `model`, painting it with the sheet `rects` describes, bound as
/// `texture1`.
///
/// `texture1` is the name the engine resolves against `unittextures/`, so it is
/// the sheet's path inside the game rather than a path on disk.
///
/// The second texture is left empty, and that is a decision rather than an
/// omission. The engine reads its red as self-illumination, its green as
/// reflectivity and its alpha as whether a pixel is drawn at all. A `.3do`
/// carries none of the three, so there is nothing to put there. Writing a
/// one pixel stand-in, which is what the techannihilation fork of Upspring
/// does, does not add the information back: it fixes glow and shine at whatever
/// that one pixel says for every model converted, forever, and it looks
/// deliberate. An empty name is the engine's own "this model has no second
/// texture", and it is the truth.
pub fn to_s3o(
    model: &coilbox_3do::Model,
    rects: &Rects,
    texture1: &str,
) -> Result<Converted, String> {
    // Indexed unconditionally by every face that resolves to nothing, so its
    // absence is a caller mistake worth naming rather than a panic four frames
    // down inside a batch of hundreds.
    if !rects.contains_key(atlas::PALETTE_TILE) {
        return Err(format!(
            "this sheet has no {} tile, so a face with no texture has nothing to be drawn in",
            atlas::PALETTE_TILE
        ));
    }

    let mut state = Walk {
        rects,
        palette_faces: 0,
        missing_texture_faces: 0,
        missing: BTreeSet::new(),
        dropped_pieces: 0,
        vertices: 0,
        triangles: 0,
    };
    let root = piece(&model.root, &mut state);

    Ok(Converted {
        model: coilbox_s3o::Model {
            radius: model.radius,
            height: model.height,
            mid: model.mid,
            texture1: texture1.to_string(),
            texture2: String::new(),
            root,
        },
        palette_faces: state.palette_faces,
        missing_texture_faces: state.missing_texture_faces,
        missing_textures: state.missing.into_iter().collect(),
        dropped_pieces: state.dropped_pieces,
        vertices: state.vertices,
        triangles: state.triangles,
    })
}

/// The corners a `.3do` face takes on its tile.
///
/// The format stores no texture coordinates at all: a face is stretched over
/// the whole of the tile it names. Faces with more than four corners wrap,
/// which is what the engine's own quad-oriented mapping does.
const CORNER_UV: [[f32; 2]; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];

struct Walk<'a> {
    rects: &'a Rects,
    palette_faces: usize,
    missing_texture_faces: usize,
    missing: BTreeSet<String>,
    dropped_pieces: usize,
    vertices: usize,
    triangles: usize,
}

/// Convert one piece, and everything under it.
///
/// Every corner of every face becomes its own vertex. It has to: the format
/// shares a vertex between faces that name different tiles, and a shared vertex
/// can only carry one texture coordinate.
fn piece(source: &coilbox_3do::Piece, state: &mut Walk) -> coilbox_s3o::Piece {
    let mut vertices: Vec<coilbox_s3o::Vertex> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    for prim in &source.primitives {
        let rect = rect_for(prim, state);
        let base = vertices.len() as u32;
        // The reader refuses a file whose face names a vertex it does not have,
        // so this cannot come up short in practice. Checked anyway, because
        // dropping a corner while still fanning over the original corner count
        // would write indices past the end of the piece, and the writer would
        // then refuse the whole model.
        let Some(corners) = corners_of(source, prim) else {
            continue;
        };
        for (corner, pos) in corners.iter().enumerate() {
            let normal = prim
                .vertex_normals
                .get(corner)
                .copied()
                .unwrap_or(prim.normal);
            let [u, v] = CORNER_UV[corner % 4];
            vertices.push(coilbox_s3o::Vertex {
                pos: *pos,
                normal,
                uv: rect.at(u, v),
            });
        }
        // A face of any corner count is a fan around its first corner. The
        // reader has already dropped everything with fewer than three.
        //
        // Wound backwards, because the engine derives a `.3do` face normal as
        // the negative of the usual right-handed cross product. Winding the fan
        // forwards would make the side the normals point at the back face, and
        // every lit face would come out dark.
        for i in 1..corners.len() - 1 {
            indices.extend_from_slice(&[base, base + i as u32 + 1, base + i as u32]);
        }
    }

    state.vertices += vertices.len();
    state.triangles += indices.len() / 3;

    coilbox_s3o::Piece {
        name: source.name.clone(),
        // Always triangles: the fan above has already made them, and the engine
        // converts anything else on load anyway.
        primitive_type: coilbox_s3o::PrimitiveType::Triangles,
        offset: source.offset,
        vertices,
        indices,
        children: source
            .children
            .iter()
            .enumerate()
            .filter_map(|(i, child)| {
                if is_dead_duplicate(child, &source.children[..i]) {
                    state.dropped_pieces += 1;
                    None
                } else {
                    Some(piece(child, state))
                }
            })
            .collect(),
    }
}

/// A face's corner positions, or nothing if it names a vertex the piece does
/// not have.
fn corners_of(source: &coilbox_3do::Piece, prim: &coilbox_3do::Primitive) -> Option<Vec<[f32; 3]>> {
    if prim.indices.len() < 3 {
        return None;
    }
    prim.indices
        .iter()
        .map(|&index| source.vertices.get(index as usize).copied())
        .collect()
}

/// The rectangle a face is drawn from, counting whatever could not be resolved.
fn rect_for(prim: &coilbox_3do::Primitive, state: &mut Walk) -> Rect {
    let fallback = state.rects[atlas::PALETTE_TILE];
    match &prim.texture {
        // Any name, empty included, is looked up the same way. The engine's
        // `S3DOPiece::GetTexture` (`rts/Rendering/Models/3DOParser.cpp`)
        // appends `00` to whatever the file gives before resolving it, and an
        // empty name is not in `teamtex.txt` either, so it becomes `"00"`
        // exactly like any other name (issue #2610). The sheet the caller
        // packed is keyed by this same raw name, empty string included, so
        // the lookup below stays on the raw name. Only what gets reported
        // back as missing is renamed, once resolution is done with it.
        coilbox_3do::Texture::Name(name) => match state.rects.get(name.as_str()) {
            Some(rect) => *rect,
            None => {
                let reported = if name.is_empty() {
                    coilbox_3do::EMPTY_TEXTURE_NAME
                } else {
                    name.as_str()
                };
                state.missing.insert(reported.to_string());
                state.palette_faces += 1;
                state.missing_texture_faces += 1;
                fallback
            }
        },
        // A resolved entry got its own tile, coloured from `palette.pal`, under
        // this same name, before packing. One nothing could resolve, because
        // there was no palette to read or the entry named is outside the 256 it
        // holds, falls back to the plain tile.
        coilbox_3do::Texture::Palette(entry) => {
            match state.rects.get(&atlas::palette_tile_name(*entry)) {
                Some(rect) => *rect,
                None => {
                    state.palette_faces += 1;
                    fallback
                }
            }
        }
    }
}

/// Whether `candidate` is an inert duplicate of one of the sibling pieces
/// that came before it in the file.
///
/// The comparison is the piece's name, not its position or vertex data. Real
/// `.3do`s reuse identical geometry deliberately: a unit's script shows one of
/// two same-shaped pieces at a time to fake a flicker (BA's `cortitan` and
/// `corhurc` both carry a `thrusta1`/`thrusta2` pair this way), or gives one
/// point two jobs under two names (`armatl`'s `flare`/`bubbles` share a
/// position because the same point serves as both a muzzle flash and an
/// underwater trail origin). Both are exact copies of a sibling by position
/// and vertices, and both are pieces the model still needs. Dropping either
/// would be exactly the "removing real geometry" mistake this pass exists to
/// avoid.
///
/// A repeated *name* is different: `S3DModel::FindPiece` in the engine's
/// `3DModel.cpp` resolves a piece name to the first match in file order, so a
/// later sibling sharing an earlier one's name can never be the one a unit
/// script or weapon definition reaches by that name. Nothing that depends on
/// addressing it by name could ever have worked, so removing it changes
/// nothing the engine could have shown anybody.
///
/// That is also why the candidate must draw nothing (`primitives` empty) and
/// root nothing (`children` empty) before it is dropped: a same-named piece
/// that has faces of its own still renders them, because rendering walks the
/// tree rather than looking pieces up by name, and a same-named piece with
/// children would take its whole subtree with it. `.3do` piece names are
/// lower-cased on read, so the comparison needs no further normalising.
///
/// Measured against the `.3do`s in Balanced Annihilation v15.9.8, Basically
/// OTA 1.7 beta 10.1 and XTA 9.65 (2,042 files, 12,306 pieces): 14 sibling
/// pairs share identical position and vertex data, and every one of them is a
/// legitimate reuse like the two above, not junk. Exactly 2 pieces, in
/// `ARM_T1_HOV_Constructor.3do` and its XTA equivalent, share a name with an
/// empty, childless earlier sibling (both called `beam`, under `nanogun`) and
/// are caught by this rule.
pub fn is_dead_duplicate(
    candidate: &coilbox_3do::Piece,
    earlier_siblings: &[coilbox_3do::Piece],
) -> bool {
    candidate.children.is_empty()
        && candidate.primitives.is_empty()
        && earlier_siblings
            .iter()
            .any(|sibling| sibling.name == candidate.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rects() -> Rects {
        let mut out = Rects::new();
        out.insert(
            "arm2".into(),
            Rect {
                u0: 0.0,
                v0: 0.0,
                u1: 0.5,
                v1: 0.5,
            },
        );
        out.insert(
            atlas::PALETTE_TILE.into(),
            Rect {
                u0: 0.5,
                v0: 0.5,
                u1: 1.0,
                v1: 1.0,
            },
        );
        out
    }

    fn face(indices: Vec<u32>, texture: coilbox_3do::Texture) -> coilbox_3do::Primitive {
        let normals = vec![[0.0, 1.0, 0.0]; indices.len()];
        coilbox_3do::Primitive {
            indices,
            texture,
            normal: [0.0, 1.0, 0.0],
            vertex_normals: normals,
        }
    }

    fn textured(indices: Vec<u32>) -> coilbox_3do::Primitive {
        face(indices, coilbox_3do::Texture::Name("arm2".into()))
    }

    fn piece3(name: &str, primitives: Vec<coilbox_3do::Primitive>) -> coilbox_3do::Piece {
        coilbox_3do::Piece {
            name: name.to_string(),
            offset: [1.0, 2.0, 3.0],
            vertices: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
            ],
            primitives,
            children: Vec::new(),
        }
    }

    fn model3(root: coilbox_3do::Piece) -> coilbox_3do::Model {
        coilbox_3do::Model {
            radius: 1.5,
            height: 2.0,
            mid: [0.0, 1.0, 0.0],
            root,
        }
    }

    fn convert(root: coilbox_3do::Piece) -> Converted {
        to_s3o(&model3(root), &rects(), "3do/objects3d.png").expect("convert")
    }

    #[test]
    fn turns_a_face_into_triangles() {
        let out = convert(piece3("body", vec![textured(vec![0, 1, 2])]));

        assert_eq!(out.triangles, 1);
        assert_eq!(out.vertices, 3);
        assert_eq!(out.model.root.indices, vec![0, 2, 1]);
    }

    /// A quad is a fan around its first corner, the same as any other face.
    #[test]
    fn turns_a_four_cornered_face_into_two_triangles() {
        let out = convert(piece3("body", vec![textured(vec![0, 1, 2, 3])]));

        assert_eq!(out.triangles, 2);
    }

    /// The format shares a vertex between faces naming different tiles, and a
    /// shared vertex can only carry one texture coordinate. So every corner
    /// becomes its own vertex, even where the positions repeat.
    #[test]
    fn gives_every_corner_its_own_vertex() {
        let out = convert(piece3(
            "body",
            vec![textured(vec![0, 1, 2]), textured(vec![0, 2, 3])],
        ));

        assert_eq!(out.vertices, 6);
        assert_eq!(out.model.root.vertices.len(), 6);
    }

    /// The whole point of the conversion: a face stretched over a tile comes out
    /// with real coordinates onto the packed sheet.
    #[test]
    fn maps_a_faces_corners_onto_its_tile() {
        let out = convert(piece3("body", vec![textured(vec![0, 1, 2, 3])]));

        let uvs: Vec<[f32; 2]> = out.model.root.vertices.iter().map(|v| v.uv).collect();
        assert_eq!(uvs, vec![[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]);
    }

    /// The header the engine reads for the collision sphere comes from the
    /// `.3do`, which is the engine's own figure for the same model.
    #[test]
    fn keeps_the_models_own_bounds_and_names_the_sheet() {
        let out = convert(piece3("body", vec![textured(vec![0, 1, 2])]));

        assert_eq!(out.model.radius, 1.5);
        assert_eq!(out.model.height, 2.0);
        assert_eq!(out.model.mid, [0.0, 1.0, 0.0]);
        assert_eq!(out.model.texture1, "3do/objects3d.png");
    }

    /// A `.3do` carries no glow, no shine and no cut-out, so there is nothing
    /// to write into the second texture and it is left empty rather than filled
    /// with a stand-in that would fix all three at one value forever.
    #[test]
    fn leaves_the_second_texture_empty() {
        let out = convert(piece3("body", vec![textured(vec![0, 1, 2])]));

        assert_eq!(out.model.texture2, "");
    }

    #[test]
    fn draws_an_unresolved_palette_face_plain_and_counts_it() {
        let out = convert(piece3(
            "body",
            vec![face(vec![0, 1, 2], coilbox_3do::Texture::Palette(3))],
        ));

        assert_eq!(out.palette_faces, 1);
        // Nothing was missing from the sheet, and the face did name a palette
        // entry: that entry is what did not resolve.
        assert_eq!(out.missing_texture_faces, 0);
        assert_eq!(out.triangles, 1);
    }

    /// A `.3do` face can name an empty string rather than naming nothing at
    /// all (issue #2610). `S3DOPiece::GetTexture`
    /// (`rts/Rendering/Models/3DOParser.cpp`) does not special-case that: an
    /// empty name is not in `teamtex.txt` either, so it becomes `"00"` and
    /// resolves to real artwork exactly like `"arm2"` does above. So a sheet
    /// that holds a tile for the empty name draws it, plain, not the flat grey
    /// fallback.
    #[test]
    fn an_empty_name_resolves_to_its_tile_when_the_sheet_has_one() {
        let mut rects = rects();
        rects.insert(
            String::new(),
            Rect {
                u0: 0.5,
                v0: 0.0,
                u1: 1.0,
                v1: 0.5,
            },
        );
        let out = to_s3o(
            &model3(piece3(
                "body",
                vec![face(
                    vec![0, 1, 2, 3],
                    coilbox_3do::Texture::Name(String::new()),
                )],
            )),
            &rects,
            "a.png",
        )
        .expect("convert");

        assert_eq!(out.palette_faces, 0);
        let uvs: Vec<[f32; 2]> = out.model.root.vertices.iter().map(|v| v.uv).collect();
        assert_eq!(uvs, vec![[0.5, 0.0], [1.0, 0.0], [1.0, 0.5], [0.5, 0.5]]);
    }

    /// The same empty name, but the sheet has no tile for it (the game the
    /// model came from has no `unittextures/tatex/00.bmp`): it is a missing
    /// texture like any other missing name, not the format's own way of
    /// saying "no texture".
    #[test]
    fn an_empty_name_missing_from_the_sheet_counts_as_a_missing_texture() {
        let out = convert(piece3(
            "body",
            vec![face(
                vec![0, 1, 2],
                coilbox_3do::Texture::Name(String::new()),
            )],
        ));

        assert_eq!(out.palette_faces, 1);
        assert_eq!(out.missing_texture_faces, 1);
        // Reported as the name it resolves to, not the blank the file stores
        // (issue #2610): a caller listing missing textures should never print
        // an empty string.
        assert_eq!(
            out.missing_textures,
            vec![coilbox_3do::EMPTY_TEXTURE_NAME.to_string()]
        );
    }

    /// A palette entry the caller did resolve to a colour gets its own tile,
    /// drawn like any other texture and not counted as a face that came out
    /// plain.
    #[test]
    fn draws_a_resolved_palette_face_in_its_own_tile() {
        let mut rects = rects();
        rects.insert(
            atlas::palette_tile_name(3),
            Rect {
                u0: 0.25,
                v0: 0.25,
                u1: 0.75,
                v1: 0.75,
            },
        );
        let out = to_s3o(
            &model3(piece3(
                "body",
                vec![face(vec![0, 1, 2, 3], coilbox_3do::Texture::Palette(3))],
            )),
            &rects,
            "a.png",
        )
        .expect("convert");

        assert_eq!(out.palette_faces, 0);
        assert_eq!(out.model.root.vertices[1].uv, [0.75, 0.25]);
    }

    /// Naming which tile is missing is the only way anybody works out what went
    /// wrong, and the rest of the unit still converts.
    #[test]
    fn names_a_tile_the_sheet_does_not_hold() {
        let out = convert(piece3(
            "body",
            vec![face(
                vec![0, 1, 2],
                coilbox_3do::Texture::Name("nosuchtile".into()),
            )],
        ));

        assert_eq!(out.missing_textures, vec!["nosuchtile".to_string()]);
        assert_eq!(out.palette_faces, 1);
        assert_eq!(out.missing_texture_faces, 1);
        assert_eq!(out.triangles, 1);
    }

    /// A sheet with no fallback tile is a caller mistake, and it is named
    /// rather than left to panic partway through a batch of hundreds.
    #[test]
    fn refuses_a_sheet_with_no_fallback_tile() {
        let mut rects = rects();
        rects.remove(atlas::PALETTE_TILE);

        let out = to_s3o(&model3(piece3("body", Vec::new())), &rects, "a.png");
        assert!(out.is_err(), "{:?}", out.map(|c| c.model.texture1));
    }

    /// A piece with one or two vertices and no faces is a flare or an aim
    /// point, and the format carries all of them this way.
    #[test]
    fn leaves_a_piece_with_no_faces_without_geometry() {
        let mut root = piece3("base", Vec::new());
        root.children
            .push(piece3("body", vec![textured(vec![0, 1, 2])]));
        let out = convert(root);

        assert!(out.model.root.vertices.is_empty());
        assert_eq!(out.model.root.children[0].vertices.len(), 3);
    }

    /// The real specimen this rule was written for: `ARM_T1_HOV_Constructor`
    /// (Basically OTA) and its XTA equivalent both carry a `nanogun` piece with
    /// two empty children both called `beam`. The engine can only ever reach the
    /// first by that name, so the second is inert clutter.
    #[test]
    fn drops_a_later_sibling_that_shares_an_earlier_ones_name() {
        let mut root = piece3("nanogun", Vec::new());
        root.children.push(piece3("beam", Vec::new()));
        root.children.push(piece3("beam", Vec::new()));
        let out = convert(root);

        assert_eq!(out.model.root.children.len(), 1);
        assert_eq!(out.dropped_pieces, 1);
    }

    #[test]
    fn keeps_a_same_named_sibling_that_has_faces() {
        let mut root = piece3("base", Vec::new());
        root.children
            .push(piece3("flare", vec![textured(vec![0, 1, 2])]));
        root.children
            .push(piece3("flare", vec![textured(vec![0, 1, 2])]));
        let out = convert(root);

        assert_eq!(out.model.root.children.len(), 2);
        assert_eq!(out.dropped_pieces, 0);
    }

    /// What the writer would refuse: a face naming a vertex the piece does not
    /// have. The reader never produces one, and if it ever did, dropping the
    /// corner while still fanning over the original count would write indices
    /// past the end of the piece and cost the whole model rather than the face.
    #[test]
    fn drops_a_face_naming_a_vertex_the_piece_does_not_have() {
        let out = convert(piece3(
            "body",
            vec![textured(vec![0, 1, 9]), textured(vec![0, 1, 2])],
        ));

        assert_eq!(out.vertices, 3);
        assert_eq!(out.triangles, 1);
        assert!(coilbox_s3o::write(&out.model).is_ok());
    }

    /// The end of the road for every conversion: what comes out is bytes the
    /// `.s3o` writer accepts and its own reader gives back.
    #[test]
    fn what_comes_out_is_an_s3o_that_reads_back() {
        let mut root = piece3("base", Vec::new());
        root.children
            .push(piece3("body", vec![textured(vec![0, 1, 2, 3])]));
        let out = convert(root);

        let bytes = coilbox_s3o::write(&out.model).expect("write");
        let back = coilbox_s3o::read(&bytes).expect("read");

        assert_eq!(back, out.model);
        assert_eq!(back.texture1, "3do/objects3d.png");
        assert_eq!(back.texture2, "");
        assert_eq!(back.root.children[0].vertices.len(), 4);
        assert_eq!(back.root.children[0].indices.len(), 6);
    }
}
