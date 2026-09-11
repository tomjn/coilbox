//! Opening one of the model formats the engine loads through Assimp.
//!
//! `.dae`, `.obj`, `.3ds`, `.lwo` and `.blend`, read by `coilbox-assimp` and
//! turned into the `.s3o` shape the rest of the importer already works in, the
//! way `coilbox-3do-convert` does for a `.3do`. Past that point nothing knows
//! which format a unit came in through.
//!
//! What makes these different from the other two is where the texture comes
//! from. An `.s3o` names one in its header and a `.3do` names a tile per face,
//! while a Collada file carries no Spring texture binding at all. The engine
//! reads a small Lua file sitting beside the model instead, and so does this.

use coilbox_springlua::SpringLua;
use std::path::{Path, PathBuf};

/// What a model's metafile names, under the engine's own two keys.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MetaTextures {
    pub tex1: String,
    pub tex2: String,
}

impl MetaTextures {
    /// The names worth putting beside the model before an import goes looking,
    /// which is the pair without the blanks.
    pub fn named(&self) -> Vec<String> {
        [&self.tex1, &self.tex2]
            .into_iter()
            .filter(|name| !name.trim().is_empty())
            .cloned()
            .collect()
    }
}

/// The metafile beside a model, by the engine's two spellings.
///
/// `<file>.lua` first, then the model's name with its extension replaced
/// (`AssParser.cpp:522-534`). A game may write either and flove writes one of
/// each, so neither can be dropped.
pub fn find_metafile(model: &Path) -> Option<PathBuf> {
    let mut appended = model.as_os_str().to_os_string();
    appended.push(".lua");
    let appended = PathBuf::from(appended);
    if appended.is_file() {
        return Some(appended);
    }
    let replaced = model.with_extension("lua");
    replaced.is_file().then_some(replaced)
}

/// Read the texture names out of a model's metafile.
///
/// Evaluated rather than scanned, because the file is Lua and a game is free to
/// work the name out rather than write it down. A model with no metafile names
/// nothing, which is not an error: only Collada always needs one, and the other
/// four formats can carry a texture in their own materials.
///
/// The keys are matched exactly as the engine matches them, which is to say
/// case-sensitively, so a file that writes `Tex1` names nothing here and nothing
/// in the game either.
pub fn metafile_textures(model: &Path) -> Result<MetaTextures, String> {
    let Some(meta) = find_metafile(model) else {
        return Ok(MetaTextures::default());
    };
    let dir = meta.parent().unwrap_or_else(|| Path::new("."));
    let name = meta
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{} has no file name", meta.display()))?;
    let lua = SpringLua::new(dir)
        .map_err(|e| format!("could not start Lua to read {}: {e}", meta.display()))?;
    let value = lua
        .include_value(&name)
        .map_err(|e| format!("could not read {}: {e}", meta.display()))?;
    Ok(MetaTextures {
        tex1: string_at(&value, "tex1"),
        tex2: string_at(&value, "tex2"),
    })
}

fn string_at(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Turn a model the Assimp reader produced into the `.s3o` shape the importer
/// works in.
///
/// Close to a copy, because the reader already hands back triangles with a
/// normal and a coordinate per vertex, and a piece tree carrying only
/// translations. The one real difference is that a node may hold several meshes
/// where an `.s3o` piece holds one vertex list, so a piece's meshes are
/// concatenated and each one's indices are moved along by the vertices before
/// it.
pub fn to_s3o(model: &coilbox_assimp::Model, tex1: &str, tex2: &str) -> coilbox_s3o::Model {
    coilbox_s3o::Model {
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        texture1: tex1.to_string(),
        texture2: tex2.to_string(),
        root: piece(&model.root),
    }
}

fn piece(from: &coilbox_assimp::Piece) -> coilbox_s3o::Piece {
    let mut vertices: Vec<coilbox_s3o::Vertex> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    for mesh in &from.meshes {
        let base = vertices.len() as u32;
        vertices.extend(mesh.vertices.iter().map(|v| coilbox_s3o::Vertex {
            pos: v.pos,
            normal: v.normal,
            uv: v.uv,
        }));
        indices.extend(mesh.indices.iter().map(|i| i + base));
    }
    coilbox_s3o::Piece {
        name: from.name.clone(),
        primitive_type: coilbox_s3o::PrimitiveType::Triangles,
        offset: from.offset,
        vertices,
        indices,
        children: from.children.iter().map(piece).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh(count: u32) -> coilbox_assimp::Mesh {
        coilbox_assimp::Mesh {
            vertices: (0..count)
                .map(|i| coilbox_assimp::Vertex {
                    pos: [i as f32, 0.0, 0.0],
                    normal: [0.0, 1.0, 0.0],
                    uv: [0.0, 0.0],
                })
                .collect(),
            indices: (0..count).collect(),
        }
    }

    /// The part most likely to go wrong: a second mesh's indices point into its
    /// own vertices, and after concatenating they have to point past the first
    /// mesh's.
    #[test]
    fn a_pieces_meshes_are_joined_with_their_indices_moved_along() {
        let from = coilbox_assimp::Piece {
            name: "base".into(),
            offset: [0.0; 3],
            meshes: vec![mesh(3), mesh(3)],
            children: vec![],
        };
        let out = piece(&from);
        assert_eq!(out.vertices.len(), 6);
        assert_eq!(out.indices, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn a_piece_tree_keeps_its_shape_and_offsets() {
        let from = coilbox_assimp::Piece {
            name: "trunk".into(),
            offset: [1.0, 2.0, 3.0],
            meshes: vec![],
            children: vec![coilbox_assimp::Piece {
                name: "branch".into(),
                offset: [4.0, 5.0, 6.0],
                meshes: vec![mesh(3)],
                children: vec![],
            }],
        };
        let out = piece(&from);
        assert_eq!(out.name, "trunk");
        assert_eq!(out.offset, [1.0, 2.0, 3.0]);
        assert_eq!(out.children.len(), 1);
        assert_eq!(out.children[0].name, "branch");
        assert_eq!(out.children[0].offset, [4.0, 5.0, 6.0]);
        assert_eq!(out.children[0].vertices.len(), 3);
    }

    #[test]
    fn a_model_with_no_metafile_names_no_textures() {
        let dir = std::env::temp_dir().join(format!("coilbox-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let model = dir.join("lonely.dae");
        std::fs::write(&model, b"not read here").expect("write");
        assert_eq!(
            metafile_textures(&model).expect("no metafile is not a failure"),
            MetaTextures::default()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_names_that_are_filled_in_are_worth_staging() {
        let textures = MetaTextures {
            tex1: "skin.png".into(),
            tex2: "  ".into(),
        };
        assert_eq!(textures.named(), vec!["skin.png".to_string()]);
    }
}
