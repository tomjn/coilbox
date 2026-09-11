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
//!
//! # Transforms are baked
//!
//! A node in these formats carries a full transform, and a Spring piece carries
//! a position and nothing else. So each node's rotation and scale are applied to
//! its own vertices here, leaving every [`Piece::offset`] a plain translation.
//! Without that, a model whose pieces are rotated draws with every one of them
//! straight: 24 of flove's 27 models turned out to carry a rotation, so this is
//! the common case rather than an exotic one.

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
    /// Translation from the parent piece.
    ///
    /// Only a translation, because that is all a Spring piece can hold. The
    /// node's rotation and scale live in this piece's vertices instead, and the
    /// parent's are already applied to this offset.
    pub offset: [f32; 3],
    pub meshes: Vec<Mesh>,
    pub children: Vec<Piece>,
}

/// What reading had to change or leave behind.
///
/// Each of these is a difference between what these formats can hold and what a
/// Spring model can. They are counted rather than papered over, so whatever
/// opens the model can say what happened instead of the difference showing up
/// later as the reader having lost something.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Notes {
    /// Nodes carrying a rotation or a scale, which a Spring piece cannot, so
    /// theirs was baked into their own vertices.
    pub transformed: usize,
    /// Faces dropped for not being triangles. After `Triangulate` and
    /// `SortByPrimitiveType` the only things left to drop are points and lines,
    /// which a Spring model has no way to hold.
    pub dropped_faces: usize,
    /// Distinct materials the file's meshes paint with. A Spring unit has one
    /// texture, so anything above one means only the first can be used.
    pub materials: usize,
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
    pub notes: Notes,
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

    let mut notes = Notes {
        materials: distinct_materials(&scene),
        ..Notes::default()
    };
    let mut piece = walk(root, &IDENTITY, [0.0; 3], &scene.meshes, &mut notes);
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
        notes,
        root: piece,
    })
}

/// How many materials the file's meshes paint with between them.
///
/// Counted off the meshes rather than off `scene.materials`, because a file can
/// declare a material nothing uses and that is not a difference worth reporting.
fn distinct_materials(scene: &Scene) -> usize {
    let mut used: Vec<u32> = scene.meshes.iter().map(|m| m.material_index).collect();
    used.sort_unstable();
    used.dedup();
    used.len()
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

/// A transform as Assimp hands it over: row major, translation in the fourth
/// column. Kept in that layout rather than converted, so the field names in
/// Assimp's own documentation still describe it.
type Mat4 = [[f32; 4]; 4];

const IDENTITY: Mat4 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
];

/// The 3x3 identity, row major, as [`linear_part`] returns one.
const IDENTITY_LINEAR: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

fn mat4_of(m: &russimp::Matrix4x4) -> Mat4 {
    [
        [m.a1, m.a2, m.a3, m.a4],
        [m.b1, m.b2, m.b3, m.b4],
        [m.c1, m.c2, m.c3, m.c4],
        [m.d1, m.d2, m.d3, m.d4],
    ]
}

fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [[0.0f32; 4]; 4];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

/// A transform's rotation and scale without its translation, row major.
fn linear_part(m: &Mat4) -> [f32; 9] {
    [
        m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2],
    ]
}

fn apply(m: &[f32; 9], v: [f32; 3]) -> [f32; 3] {
    [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]
}

fn determinant(m: &[f32; 9]) -> f32 {
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6])
}

/// The matrix a normal goes through, which is the inverse transpose of the one
/// a position goes through, because a non-uniform scale skews a normal if the
/// position's matrix is applied to it directly.
///
/// This is the cofactor matrix over the determinant, which is the inverse
/// transpose in one step. A node scaled flat to nothing has no inverse, and its
/// normals are left alone rather than turned into infinities.
fn inverse_transpose(m: &[f32; 9]) -> [f32; 9] {
    let det = determinant(m);
    if det.abs() < f32::EPSILON {
        return *m;
    }
    let inv = 1.0 / det;
    [
        (m[4] * m[8] - m[5] * m[7]) * inv,
        -(m[3] * m[8] - m[5] * m[6]) * inv,
        (m[3] * m[7] - m[4] * m[6]) * inv,
        -(m[1] * m[8] - m[2] * m[7]) * inv,
        (m[0] * m[8] - m[2] * m[6]) * inv,
        -(m[0] * m[7] - m[1] * m[6]) * inv,
        (m[1] * m[5] - m[2] * m[4]) * inv,
        -(m[0] * m[5] - m[2] * m[3]) * inv,
        (m[0] * m[4] - m[1] * m[3]) * inv,
    ]
}

fn normalise(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if length > 0.0 {
        [v[0] / length, v[1] / length, v[2] / length]
    } else {
        v
    }
}

fn mesh_of(m: &russimp::mesh::Mesh, linear: &[f32; 9], notes: &mut Notes) -> Mesh {
    let uvs = m.texture_coords.first().and_then(|c| c.as_ref());
    let normal_matrix = inverse_transpose(linear);
    // An untransformed node's vertices are copied rather than recomputed, so a
    // normal that is not quite unit length is left as the file wrote it instead
    // of being changed for no reason.
    let plain = *linear == IDENTITY_LINEAR;
    let vertices = m
        .vertices
        .iter()
        .enumerate()
        .map(|(i, v)| Vertex {
            pos: if plain {
                [v.x, v.y, v.z]
            } else {
                apply(linear, [v.x, v.y, v.z])
            },
            // `GenerateSmoothNormals` fills these in when the file has none, so
            // a missing normal here means the mesh had no vertex at all to
            // generate one from. Straight up matches the engine's own fallback.
            normal: {
                let n = m
                    .normals
                    .get(i)
                    .map(|n| [n.x, n.y, n.z])
                    .unwrap_or([0.0, 1.0, 0.0]);
                if plain {
                    n
                } else {
                    normalise(apply(&normal_matrix, n))
                }
            },
            uv: uvs
                .and_then(|c| c.get(i))
                .map(|t| [t.x, t.y])
                .unwrap_or([0.0, 0.0]),
        })
        .collect();
    // Faces that are not triangles are dropped rather than repaired, which is
    // what the engine does. `Triangulate` and `SortByPrimitiveType` mean the
    // only things left to drop are lines and points, and they are counted so
    // whatever opens the model can say that some of it was left out.
    notes.dropped_faces += m.faces.iter().filter(|f| f.0.len() != 3).count();
    // A mirroring transform turns every triangle inside out, so the winding is
    // reversed to match. Without it the piece draws back to front, and is lit
    // from inside.
    let mirrored = determinant(linear) < 0.0;
    let indices = m
        .faces
        .iter()
        .filter(|f| f.0.len() == 3)
        .flat_map(|f| {
            if mirrored {
                [f.0[0], f.0[2], f.0[1]]
            } else {
                [f.0[0], f.0[1], f.0[2]]
            }
        })
        .collect();
    Mesh { vertices, indices }
}

/// Flatten one node and everything under it.
///
/// `parent_world` carries every transform above this node, so the rotation and
/// scale baked into a mesh here are the ones it is actually drawn with rather
/// than only its own. A mesh named by two nodes is built twice for that reason,
/// once per node, since each may sit under a different transform.
fn walk(
    node: &Rc<Node>,
    parent_world: &Mat4,
    parent_translation: [f32; 3],
    scene_meshes: &[russimp::mesh::Mesh],
    notes: &mut Notes,
) -> Piece {
    let world = multiply(parent_world, &mat4_of(&node.transformation));
    // Row major, so the translation is the fourth column.
    let translation = [world[0][3], world[1][3], world[2][3]];
    let linear = linear_part(&world);
    if linear != IDENTITY_LINEAR {
        notes.transformed += 1;
    }

    // Built as statements rather than inside the struct below, so that the
    // meshes and then the children each take their turn with `notes` instead of
    // two closures reaching for it at once.
    let mut meshes = Vec::new();
    for index in &node.meshes {
        if let Some(mesh) = scene_meshes.get(*index as usize) {
            meshes.push(mesh_of(mesh, &linear, notes));
        }
    }
    let mut children = Vec::new();
    for child in node.children.borrow().iter() {
        children.push(walk(child, &world, translation, scene_meshes, notes));
    }

    Piece {
        name: node.name.clone(),
        // Both translations are in model space, so their difference is where
        // this piece sits relative to its parent, with the parent's own
        // rotation already accounted for.
        offset: [
            translation[0] - parent_translation[0],
            translation[1] - parent_translation[1],
            translation[2] - parent_translation[2],
        ],
        meshes,
        children,
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
