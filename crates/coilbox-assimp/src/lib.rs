//! Reader for the five model formats Spring/Recoil loads through Assimp:
//! `.dae`, `.obj`, `.3ds`, `.lwo` and `.blend`.
//!
//! Read only, like [`coilbox_3do`](https://docs.rs/coilbox-3do). The caller
//! passes bytes and an extension hint rather than a path, because a game's
//! models live inside a packed archive that only unitsync can open.
//!
//! The import flags mirror the engine's `ASS_POSTPROCESS_OPTIONS`
//! (`rts/Rendering/Models/AssParser.cpp`), so what comes back here is what the
//! engine draws. Where this deliberately differs from the engine, the reason is
//! written at the point it happens.

use russimp::material::{PropertyTypeInfo, TextureType};
use russimp::node::Node;
use russimp::property::PropertyStore;
use russimp::scene::{PostProcess, Scene};
use std::rc::Rc;

/// The extensions the engine hands to Assimp, from `CheckAssimpWhitelist` in
/// `rts/Rendering/Models/IModelParser.cpp`. Assimp itself reads many more and
/// the engine refuses every one of them, so a game cannot ship an `.fbx` and
/// expect it to load.
pub const EXTENSIONS: [&str; 5] = ["3ds", "dae", "lwo", "obj", "blend"];

/// What `RemoveComponent` throws away, matching the engine's
/// `ASS_IMPORTER_OPTIONS`: animations, textures, lights, cameras and materials.
/// The values are `aiComponent_*` from Assimp's `config.h`, which are the same
/// in the 4.0.1 the engine vendors and the 5.3.0 we build against.
///
/// Materials being in that list is not a mistake, and does not stop
/// [`material_texture`](Model::material_texture) working: the flag discards
/// embedded texture pixels and material objects, while the texture *name*
/// property this reads survives on the material Assimp hands back.
const REMOVE_COMPONENTS: i32 = 0x40 | 0x80 | 0x100 | 0x200 | 0x800;

/// One drawable batch: an indexed triangle list sharing a single texture.
///
/// A node can carry several of these. Assimp splits a mesh per material, and
/// `SortByPrimitiveType` splits it again per primitive type, so a piece that
/// looks like one object in a modelling tool arrives here as several.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mesh {
    pub vertices: Vec<Vertex>,
    /// Indices into this mesh's own `vertices`, three per triangle.
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vertex {
    /// Position relative to the piece origin.
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
}

/// One node of the model.
///
/// Every Assimp node becomes a piece, including the ones carrying no geometry,
/// because the engine does the same and unit scripts address pieces by name. A
/// piece with no meshes is a marker, such as an aim point.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Piece {
    pub name: String,
    /// Translation from the parent piece, taken from the node's own transform.
    pub offset: [f32; 3],
    pub meshes: Vec<Mesh>,
    pub children: Vec<Piece>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Model {
    /// Radius of the sphere around the whole model, measured from `mid`. None
    /// of these formats store one, so this is the engine's own figure: half the
    /// diagonal of the bounding box (`CalcDrawRadius` in `3DModel.hpp`).
    pub radius: f32,
    /// Height of the bounding box.
    pub height: f32,
    /// Middle of the bounding box, relative to the origin on the ground plane.
    pub mid: [f32; 3],
    /// The texture the file's own material names, if it names one.
    ///
    /// A `.dae` carries no Spring texture binding, so this is often the only
    /// clue in the file itself. It is the lowest priority of the three sources
    /// the engine consults, and the caller applies the other two: the Lua
    /// metafile beside the model, and a search by model name.
    pub material_texture: Option<String>,
    pub root: Piece,
}

/// Read a model from the bytes of an archive member.
///
/// `hint` is the file extension without a dot, such as `dae`. Assimp uses it to
/// pick an importer when it cannot tell from the content alone.
pub fn read(bytes: &[u8], hint: &str) -> Result<Model, String> {
    let mut props = PropertyStore::default();
    // Nul terminated because `set_integer` takes the raw bytes of a C string.
    // The key is `AI_CONFIG_PP_RVC_FLAGS` from Assimp's `config.h`.
    props.set_integer(b"PP_RVC_FLAGS\0", REMOVE_COMPONENTS);

    let scene = Scene::from_buffer_with_props(bytes, import_flags(), hint, &props)
        .map_err(|e| e.to_string())?;

    let root = scene
        .root
        .as_ref()
        .ok_or_else(|| "the file parsed but holds no nodes".to_string())?;

    let meshes: Vec<Mesh> = scene.meshes.iter().map(mesh_of).collect();
    let mut piece = piece_of(root, &meshes);
    // Assimp's own root node carries the file's overall transform. The engine
    // treats that node as the model root rather than shifting the model by it,
    // so its offset stays where it is and every child stays relative to it.
    piece.name = if piece.name.is_empty() {
        "$$root$$".to_string()
    } else {
        piece.name.clone()
    };

    let (mins, maxs) = bounds(&piece, [0.0; 3]);
    let span = [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]];
    Ok(Model {
        radius: (span[0] * span[0] + span[1] * span[1] + span[2] * span[2]).sqrt() * 0.5,
        height: span[1],
        mid: [
            (maxs[0] + mins[0]) * 0.5,
            (maxs[1] + mins[1]) * 0.5,
            (maxs[2] + mins[2]) * 0.5,
        ],
        material_texture: material_texture(&scene),
        root: piece,
    })
}

/// The engine's `ASS_POSTPROCESS_OPTIONS`, with two deliberate differences.
///
/// `ImproveCacheLocality` is left out because the engine leaves it out too,
/// where a comment records it tripping an assert in an older Assimp.
///
/// `SplitLargeMeshes` is left out because the engine bounds it with limits it
/// reads from the GPU at runtime (`GL_MAX_ELEMENTS_VERTICES`), and a headless
/// reader has no GPU to ask. Splitting exists to keep a single draw call within
/// what a driver accepts, which is a drawing concern rather than a reading one,
/// and picking a limit here would be inventing a number the engine never used.
fn import_flags() -> Vec<PostProcess> {
    vec![
        PostProcess::RemoveComponent,
        PostProcess::FixOrRemoveInvalidData,
        PostProcess::CalculateTangentSpace,
        PostProcess::GenerateSmoothNormals,
        PostProcess::Triangulate,
        PostProcess::GenerateUVCoords,
        PostProcess::SortByPrimitiveType,
        PostProcess::JoinIdenticalVertices,
        PostProcess::LimitBoneWeights,
    ]
}

fn mesh_of(m: &russimp::mesh::Mesh) -> Mesh {
    let uvs = m.texture_coords.first().and_then(|c| c.as_ref());
    let vertices = m
        .vertices
        .iter()
        .enumerate()
        .map(|(i, v)| Vertex {
            pos: [v.x, v.y, v.z],
            // `GenerateSmoothNormals` fills these in when the file has none, so
            // a missing normal here means the mesh had no vertex at all to
            // generate one from. Straight up matches the engine's own fallback.
            normal: m
                .normals
                .get(i)
                .map(|n| [n.x, n.y, n.z])
                .unwrap_or([0.0, 1.0, 0.0]),
            uv: uvs
                .and_then(|c| c.get(i))
                .map(|t| [t.x, t.y])
                .unwrap_or([0.0, 0.0]),
        })
        .collect();
    // Faces that are not triangles are dropped rather than repaired, which is
    // what the engine does. `Triangulate` and `SortByPrimitiveType` mean the
    // only things left to drop are lines and points.
    let indices = m
        .faces
        .iter()
        .filter(|f| f.0.len() == 3)
        .flat_map(|f| f.0.iter().copied())
        .collect();
    Mesh { vertices, indices }
}

fn piece_of(node: &Rc<Node>, meshes: &[Mesh]) -> Piece {
    let t = node.transformation;
    Piece {
        name: node.name.clone(),
        // Assimp's matrix is row major, so the translation is the fourth
        // column: a4, b4, c4.
        offset: [t.a4, t.b4, t.c4],
        meshes: node
            .meshes
            .iter()
            .filter_map(|i| meshes.get(*i as usize).cloned())
            .collect(),
        children: node
            .children
            .borrow()
            .iter()
            .map(|c| piece_of(c, meshes))
            .collect(),
    }
}

/// Model space bounds, accumulating each piece's offset down the tree the way
/// `ModelUtils::CalculateModelDimensions` does.
fn bounds(piece: &Piece, parent: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let at = [
        parent[0] + piece.offset[0],
        parent[1] + piece.offset[1],
        parent[2] + piece.offset[2],
    ];
    let mut mins = [f32::MAX; 3];
    let mut maxs = [f32::MIN; 3];
    for mesh in &piece.meshes {
        for v in &mesh.vertices {
            for axis in 0..3 {
                mins[axis] = mins[axis].min(at[axis] + v.pos[axis]);
                maxs[axis] = maxs[axis].max(at[axis] + v.pos[axis]);
            }
        }
    }
    for child in &piece.children {
        let (cmin, cmax) = bounds(child, at);
        for axis in 0..3 {
            mins[axis] = mins[axis].min(cmin[axis]);
            maxs[axis] = maxs[axis].max(cmax[axis]);
        }
    }
    // A model with no geometry anywhere leaves the sentinels untouched, and
    // handing those out would make the radius a vast number.
    if mins[0] > maxs[0] {
        return ([0.0; 3], [0.0; 3]);
    }
    (mins, maxs)
}

/// The texture the first material names, probing the same three slots the
/// engine probes in `FindTextures`, in the same order. Later wins, so diffuse
/// beats the other two, exactly as the engine's overwriting does.
fn material_texture(scene: &Scene) -> Option<String> {
    let material = scene.materials.first()?;
    let mut found = None;
    for want in [
        TextureType::Specular,
        TextureType::Unknown,
        TextureType::Diffuse,
    ] {
        for p in &material.properties {
            if p.semantic != want || p.key != "$tex.file" {
                continue;
            }
            if let PropertyTypeInfo::String(s) = &p.data {
                let cleaned = clean_texture_path(s);
                if !cleaned.is_empty() {
                    found = Some(cleaned);
                }
            }
        }
    }
    found
}

/// Blender writes a relative path as `//..`, which the engine strips before
/// looking the file up (`FindTexture` in `AssParser.cpp`).
fn clean_texture_path(raw: &str) -> String {
    raw.strip_prefix("//..").unwrap_or(raw).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_loses_blenders_marker() {
        assert_eq!(clean_texture_path("//../tex.png"), "/tex.png");
        assert_eq!(clean_texture_path("tex.png"), "tex.png");
    }

    #[test]
    fn a_model_with_no_geometry_has_no_size_rather_than_a_vast_one() {
        let empty = Piece {
            name: "root".into(),
            offset: [0.0; 3],
            meshes: vec![],
            children: vec![],
        };
        assert_eq!(bounds(&empty, [0.0; 3]), ([0.0; 3], [0.0; 3]));
    }

    #[test]
    fn bounds_accumulate_a_childs_offset_onto_its_parents() {
        let child = Piece {
            name: "child".into(),
            offset: [10.0, 0.0, 0.0],
            meshes: vec![Mesh {
                vertices: vec![Vertex {
                    pos: [1.0, 2.0, 3.0],
                    normal: [0.0, 1.0, 0.0],
                    uv: [0.0, 0.0],
                }],
                indices: vec![],
            }],
            children: vec![],
        };
        let root = Piece {
            name: "root".into(),
            offset: [100.0, 0.0, 0.0],
            meshes: vec![],
            children: vec![child],
        };
        let (mins, maxs) = bounds(&root, [0.0; 3]);
        assert_eq!(mins, [111.0, 2.0, 3.0]);
        assert_eq!(maxs, [111.0, 2.0, 3.0]);
    }
}
