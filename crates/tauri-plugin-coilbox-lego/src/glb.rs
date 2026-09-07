//! Reading a binary glTF (`.glb`) back into a piece tree and its meshes.
//!
//! The other end of `src/lego/exportGlb.ts`. That writes a unit as a `.glb` so
//! it can be finished in Blender, and until this existed the trip was one way:
//! whatever came back out of Blender still needed Upspring to become an `.s3o`.
//!
//! `.glb` rather than `.obj` because a `.obj` has no hierarchy. Every piece in
//! one flattens into a single object list and the tree would have to be built
//! again by hand, and the tree is the thing a unit script addresses and the
//! engine animates. A glTF node graph is the piece tree, near enough one to one.
//!
//! # What this reads, and what it refuses
//!
//! Hand written rather than a glTF library, because the reader only has to open
//! what Blender's exporter and three.js's `GLTFExporter` write at their default
//! settings, and both write the plain core of the format. So this handles the
//! `.glb` container, the node graph with either a matrix or a
//! translation/rotation/scale, meshes of any number of primitives, accessors
//! interleaved or not, indices of all three widths, and an image either embedded
//! in the container or sitting next to it as a file.
//!
//! It refuses, by name and out loud, what it cannot read: Draco compressed
//! geometry, quantised attributes, sparse accessors, and any other required
//! extension it does not know. Refusing beats opening a model with half its
//! vertices at the origin. A `.gltf`, the JSON-and-sidecar spelling of the same
//! format, is refused too: Blender's exporter writes `.glb` by default and the
//! extra file to chase adds nothing.
//!
//! # Axes
//!
//! None are negated, and nothing is scaled. `exportGlb.ts` writes the baked
//! `.s3o` vertices into the `.glb` unchanged, on the grounds that three.js and
//! glTF share the s3o writer's convention of right handed, Y up, front faces
//! wound counter-clockwise. The inverse of that is itself, so this reads them
//! back unchanged as well. Blender converts glTF's Y up to its own Z up on
//! import and back again on export, so a model that goes through it with the
//! importer's and exporter's own "+Y Up" defaults left alone comes home in the
//! axes it left in.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// `glTF` as a little-endian `u32`, the first four bytes of every `.glb`.
const GLB_MAGIC: u32 = 0x4654_6C67;
/// `JSON`, the chunk holding the glTF document itself.
const CHUNK_JSON: u32 = 0x4E4F_534A;
/// `BIN\0`, the chunk holding every buffer the document does not spell out.
const CHUNK_BIN: u32 = 0x004E_4942;

/// The extensions this reader knows are harmless to ignore when a file requires
/// them. Both only say how a material is lit, and this reads geometry and one
/// image. `KHR_texture_transform` is deliberately not here: it moves texture
/// coordinates, so ignoring it would give a unit whose texture is offset with
/// nothing to say why.
const HARMLESS_EXTENSIONS: &[&str] = &["KHR_materials_unlit", "KHR_materials_emissive_strength"];

/// One node of the file's graph: what it is called, where it sits, and what it
/// draws. The Spring piece tree, in all but name.
#[derive(Debug)]
pub struct Node {
    pub name: String,
    /// The node's own transform, relative to its parent, column-major the way
    /// glTF itself stores a matrix.
    pub matrix: [f32; 16],
    /// `None` for a node that draws nothing, which is how both formats carry a
    /// hierarchy node, a flare or an aim point.
    pub mesh: Option<Mesh>,
    pub children: Vec<Node>,
}

/// One node's geometry, with every primitive of its glTF mesh merged into one.
///
/// Merged because an `.s3o` piece draws a single triangle list. glTF splits a
/// mesh into a primitive per material, and a Spring model has one texture for
/// the whole unit, so the split carries nothing this can keep.
#[derive(Debug)]
pub struct Mesh {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
}

/// The picture a file's materials paint with, once it has been found.
#[derive(Debug)]
pub struct Image {
    /// The image's own bytes, in whatever format the file holds them.
    pub bytes: Vec<u8>,
    /// A name to store it under, taken from the file where it names one.
    pub name: String,
}

/// A whole file, read.
#[derive(Debug)]
pub struct Model {
    pub root: Node,
    /// The base colour image, when the file carries one this could read.
    pub image: Option<Image>,
    /// The name of an image the file points at but this could not read, for
    /// saying which file is missing rather than opening an untextured unit with
    /// no explanation.
    pub missing_image: Option<String>,
    /// Primitives skipped because they draw points or lines, which a Spring
    /// model has no way to hold.
    pub skipped: usize,
    /// Primitives that were a triangle strip or fan and were turned into a
    /// plain triangle list, which is what the engine does on load anyway.
    pub converted: usize,
    /// Meshes the file gave no normals, whose normals were worked out from the
    /// faces. glTF says a reader must do this, and it is worth saying it did.
    pub flat_shaded: usize,
    /// How many distinct base colour images the file's materials name. An
    /// `.s3o` has one texture, so anything above one is a choice this made.
    pub images_used: usize,
    /// Whether the file's scene had several root nodes and one was invented to
    /// hold them, since a Spring model has exactly one root piece.
    pub invented_root: bool,
    /// Objects carrying a rotation or a scale, as against a plain position. An
    /// `.s3o` piece holds a position and nothing else, so these are the ones
    /// whose transform gets baked into their vertices, and counting them is
    /// what lets the import say so only when it happened.
    pub transformed: usize,
    /// Doubled pieces folded back into one, left by every `.glb` coilbox
    /// 1.12.0 or earlier wrote. See [`fold_doubled_meshes`].
    pub folded: usize,
}

/// Read a `.glb`, or say what is wrong with it.
///
/// `path` is only used to resolve an image the file names as a neighbouring
/// file rather than embedding, and to name an invented root.
pub fn read(bytes: &[u8], path: &Path) -> Result<Model, String> {
    let (json, bin) = split_chunks(bytes)?;
    let doc: Gltf = serde_json::from_slice(json)
        .map_err(|e| format!("this .glb's glTF document could not be read: {e}"))?;
    refuse_unknown_extensions(&doc)?;

    let roots = scene_roots(&doc)?;
    let mut state = Read {
        doc: &doc,
        bin,
        skipped: 0,
        converted: 0,
        flat_shaded: 0,
        transformed: 0,
        materials: BTreeSet::new(),
    };

    let (mut root, invented_root) = if let [only] = roots.as_slice() {
        (state.node(*only, &mut Vec::new())?, false)
    } else {
        let mut children = Vec::with_capacity(roots.len());
        let mut seen = Vec::new();
        for index in &roots {
            children.push(state.node(*index, &mut seen)?);
        }
        (
            Node {
                name: stem(path),
                matrix: IDENTITY,
                mesh: None,
                children,
            },
            true,
        )
    };
    let folded = fold_doubled_meshes(&mut root);

    let materials = state.materials.clone();
    let (image, missing_image, images_used) = base_colour(&doc, bin, path, &materials);
    Ok(Model {
        root,
        image,
        missing_image,
        skipped: state.skipped,
        converted: state.converted,
        flat_shaded: state.flat_shaded,
        images_used,
        invented_root,
        transformed: state.transformed,
        folded,
    })
}

/// Fold back the doubling every `.glb` coilbox 1.12.0 or earlier wrote.
/// `buildGlbScene` in `src/lego/exportGlb.ts` used to give a piece with
/// geometry a `THREE.Group` holding a same-named `THREE.Mesh`, rather than
/// the single node it is now (#2576), so `GLTFExporter` wrote it as two glTF
/// nodes and a five piece unit came back in as nine (#2619). This walks the
/// tree bottom up and, wherever it finds that exact shape, folds the pair
/// back into the one piece it was, returning how many it folded so the import
/// can say so.
///
/// The rule is deliberately narrow, because a hand-authored model can share
/// part of the shape by chance and this must never cost a real piece:
///
/// - the parent itself draws nothing. A piece the buggy exporter wrapped
///   never did either. A node that already has its own mesh is left alone
///   regardless of what its children look like.
/// - exactly one of the parent's children carries a mesh, has no children of
///   its own, and its local transform is exactly the identity: not close to
///   it, exactly, because the buggy exporter never set a position, rotation
///   or scale on the inner mesh at all. A second candidate, or one that
///   moved even slightly, is not this bug's shape.
/// - that child's name is the parent's own name, either exactly, which is
///   what a file read straight out of coilbox carries, or with a Blender
///   `.001`-style dedup suffix, which is what the same pair turns into after
///   an old file has been round-tripped through Blender: Blender's object
///   namespace collides on any two objects sharing a name regardless of
///   their type, so the empty and the mesh coilbox wrote under one name
///   import as two objects, the second renamed on the way in, and stay that
///   way on the way back out.
///
/// A parent with real sibling pieces alongside the doubled mesh still folds:
/// the buggy exporter added a piece's own mesh before its children, so a
/// piece with both geometry and sub-pieces carried the same doubling, just
/// not as the parent's only child.
fn fold_doubled_meshes(node: &mut Node) -> usize {
    let mut folded = 0;
    for child in &mut node.children {
        folded += fold_doubled_meshes(child);
    }

    if node.mesh.is_some() {
        return folded;
    }
    let mut candidates = node
        .children
        .iter()
        .enumerate()
        .filter(|(_, child)| is_doubled_mesh_child(&node.name, child));
    let only = candidates.next().map(|(i, _)| i);
    if only.is_none() || candidates.next().is_some() {
        return folded;
    }
    let doubled = node.children.remove(only.unwrap());
    node.mesh = doubled.mesh;
    folded + 1
}

/// Whether `child` is the doubled mesh the exporter bug would have left under
/// `parent_name`. See [`fold_doubled_meshes`] for the reasoning behind each
/// part of the check.
fn is_doubled_mesh_child(parent_name: &str, child: &Node) -> bool {
    child.mesh.is_some()
        && child.children.is_empty()
        && child.matrix == IDENTITY
        && names_match_after_blender(parent_name, &child.name)
}

/// Whether `child_name` is `parent_name`, either exactly or with the
/// `.NNN` dedup suffix Blender appends to the second object it imports under
/// a name already taken.
fn names_match_after_blender(parent_name: &str, child_name: &str) -> bool {
    if parent_name == child_name {
        return true;
    }
    let Some(suffix) = child_name.strip_prefix(parent_name) else {
        return false;
    };
    let Some(digits) = suffix.strip_prefix('.') else {
        return false;
    };
    digits.len() == 3 && digits.bytes().all(|b| b.is_ascii_digit())
}

/// The file's own name without its extension, for naming a root it does not
/// have one of.
fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("model")
        .to_string()
}

// ------------------------------------------------------------------ container

/// Split a `.glb` into its glTF document and its binary chunk.
///
/// The chunk after the JSON is optional: a file whose buffers are all external
/// or spelled out as data URIs has none. A file whose accessors then reach for
/// it fails where the accessor is read, naming the buffer, rather than here.
fn split_chunks(bytes: &[u8]) -> Result<(&[u8], &[u8]), String> {
    if bytes.len() < 12 {
        return Err("this file is too short to be a .glb".to_string());
    }
    if u32_at(bytes, 0) != GLB_MAGIC {
        // The commonest wrong file by far, and worth naming rather than
        // reporting a magic number nobody recognises.
        if bytes.starts_with(b"{") || bytes.starts_with(b"\xef\xbb\xbf{") {
            return Err(
                "this is a .gltf, the spelling of glTF that keeps its buffers and textures in \
                 separate files beside it. Coilbox reads the .glb spelling, which is one file \
                 with everything in it. Blender's exporter writes that by default: pick \
                 \"glTF Binary (.glb)\" as the format."
                    .to_string(),
            );
        }
        return Err(
            "this file does not start with glTF's own magic, so it is not a .glb".to_string(),
        );
    }
    let version = u32_at(bytes, 4);
    if version != 2 {
        return Err(format!(
            "this .glb is glTF version {version}, and coilbox reads version 2"
        ));
    }

    let mut json: Option<&[u8]> = None;
    let mut bin: &[u8] = &[];
    let mut at = 12usize;
    while at + 8 <= bytes.len() {
        let length = u32_at(bytes, at) as usize;
        let kind = u32_at(bytes, at + 4);
        let from = at + 8;
        let to = from
            .checked_add(length)
            .filter(|to| *to <= bytes.len())
            .ok_or_else(|| "this .glb is truncated part way through a chunk".to_string())?;
        match kind {
            CHUNK_JSON if json.is_none() => json = Some(&bytes[from..to]),
            CHUNK_BIN if bin.is_empty() => bin = &bytes[from..to],
            // Every other chunk type is reserved for a future version, and the
            // format says to skip what you do not know.
            _ => {}
        }
        // Chunks are padded to a four byte boundary.
        at = to + (4 - to % 4) % 4;
    }
    let json = json.ok_or_else(|| "this .glb holds no glTF document".to_string())?;
    Ok((json, bin))
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Refuse a file that requires something this cannot do, naming it.
///
/// `extensionsRequired` is the file saying it cannot be read correctly without
/// them. Draco and quantisation both change how vertices are stored, so
/// ignoring either gives a model made of noise, and that is exactly the failure
/// worth refusing rather than showing.
fn refuse_unknown_extensions(doc: &Gltf) -> Result<(), String> {
    let unknown: Vec<&str> = doc
        .extensions_required
        .iter()
        .map(String::as_str)
        .filter(|name| !HARMLESS_EXTENSIONS.contains(name))
        .collect();
    if unknown.is_empty() {
        return Ok(());
    }
    let advice = if unknown.contains(&"KHR_draco_mesh_compression") {
        " Blender writes that when Compression is ticked under Data, Mesh in its glTF exporter. \
         Export it again with that off."
    } else if unknown.contains(&"KHR_mesh_quantization") {
        " Blender writes that when Quantization is ticked under Data, Mesh in its glTF exporter. \
         Export it again with that off."
    } else {
        ""
    };
    Err(format!(
        "this .glb needs {}, which coilbox does not read.{advice}",
        unknown.join(", ")
    ))
}

// ---------------------------------------------------------------------- nodes

/// Which nodes the file's scene hangs off.
fn scene_roots(doc: &Gltf) -> Result<Vec<usize>, String> {
    let scene = doc
        .scene
        .filter(|index| *index < doc.scenes.len())
        .or(if doc.scenes.is_empty() { None } else { Some(0) });
    let roots: Vec<usize> = match scene {
        Some(index) => doc.scenes[index].nodes.clone(),
        // A file with no scene at all is legal and means "a library of nodes",
        // which Blender does not write. Every node nothing else parents is a
        // root, which is the same answer for the file that does have one.
        None => {
            let mut parented = vec![false; doc.nodes.len()];
            for node in &doc.nodes {
                for child in &node.children {
                    if let Some(flag) = parented.get_mut(*child) {
                        *flag = true;
                    }
                }
            }
            (0..doc.nodes.len()).filter(|i| !parented[*i]).collect()
        }
    };
    let roots: Vec<usize> = roots.into_iter().filter(|i| *i < doc.nodes.len()).collect();
    if roots.is_empty() {
        return Err("this .glb holds no objects".to_string());
    }
    Ok(roots)
}

struct Read<'a> {
    doc: &'a Gltf,
    bin: &'a [u8],
    skipped: usize,
    converted: usize,
    flat_shaded: usize,
    transformed: usize,
    /// Every material any mesh in the tree draws with, for finding the picture.
    materials: BTreeSet<usize>,
}

impl Read<'_> {
    /// One node and everything under it.
    ///
    /// `seen` is the path from the root, which is what catches a file whose
    /// nodes parent each other in a circle. glTF forbids that, and a reader
    /// that trusts it recurses until the stack runs out.
    fn node(&mut self, index: usize, seen: &mut Vec<usize>) -> Result<Node, String> {
        if seen.contains(&index) {
            return Err("this .glb's objects are parented in a circle".to_string());
        }
        seen.push(index);
        let node = &self.doc.nodes[index];

        let mesh = match node.mesh {
            Some(mesh) if mesh < self.doc.meshes.len() => self.mesh(mesh)?,
            _ => None,
        };
        let mut children = Vec::new();
        for child in &node.children {
            if *child < self.doc.nodes.len() {
                children.push(self.node(*child, seen)?);
            }
        }
        seen.pop();

        let matrix = node_matrix(node);
        // The linear part only. A plain position is exactly what an `.s3o`
        // piece already holds, so it is not something that had to be baked.
        if [
            matrix[0], matrix[1], matrix[2], matrix[4], matrix[5], matrix[6], matrix[8], matrix[9],
            matrix[10],
        ] != [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        {
            self.transformed += 1;
        }

        Ok(Node {
            // An unnamed node is legal. The document normalises and uniques
            // every name anyway, so an empty one becomes `piece` there.
            name: node.name.clone().unwrap_or_default(),
            matrix,
            mesh,
            children,
        })
    }

    /// One glTF mesh, with all its primitives merged into one triangle list.
    fn mesh(&mut self, index: usize) -> Result<Option<Mesh>, String> {
        let mut out = Mesh {
            positions: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            indices: Vec::new(),
        };
        for prim in &self.doc.meshes[index].primitives {
            let mode = prim.mode.unwrap_or(4);
            if !(4..=6).contains(&mode) {
                // Points and lines. A Spring model draws triangles and nothing
                // else, so there is nowhere for these to go.
                self.skipped += 1;
                continue;
            }
            let Some(position) = prim.attributes.get("POSITION") else {
                self.skipped += 1;
                continue;
            };
            if let Some(material) = prim.material {
                self.materials.insert(material);
            }

            let positions = vec3s(self.read_floats(*position, 3)?);
            let count = positions.len();
            let indices = match prim.indices {
                Some(accessor) => self.read_indices(accessor, count)?,
                // No index list means the vertices are the triangles, in order.
                None => (0..count as u32).collect(),
            };
            let mut indices = match mode {
                5 => {
                    self.converted += 1;
                    from_strip(&indices)
                }
                6 => {
                    self.converted += 1;
                    from_fan(&indices)
                }
                _ => indices,
            };
            // A triangle list whose length is not a multiple of three has a
            // face the file never finished. Everything downstream reads this in
            // threes, so the tail goes here rather than off the end of a mesh.
            indices.truncate(indices.len() - indices.len() % 3);

            let normals = match prim.attributes.get("NORMAL") {
                Some(accessor) => vec3s(self.read_floats(*accessor, 3)?),
                None => {
                    // glTF says a primitive with no normals is flat shaded and
                    // the reader works them out from the faces.
                    self.flat_shaded += 1;
                    face_normals(&positions, &indices)
                }
            };
            let uvs = match prim.attributes.get("TEXCOORD_0") {
                Some(accessor) => vec2s(self.read_floats(*accessor, 2)?),
                None => vec![[0.0, 0.0]; count],
            };
            if normals.len() != count || uvs.len() != count {
                return Err(
                    "this .glb has a mesh whose normals or texture coordinates do not match its \
                     vertices"
                        .to_string(),
                );
            }

            let base = out.positions.len() as u32;
            out.positions.extend(positions);
            out.normals.extend(normals);
            out.uvs.extend(uvs);
            out.indices.extend(indices.into_iter().map(|i| i + base));
        }

        if out.positions.is_empty() || out.indices.is_empty() {
            return Ok(None);
        }
        Ok(Some(out))
    }

    /// One accessor as floats, `components` of them per element.
    fn read_floats(&self, index: usize, components: usize) -> Result<Vec<f32>, String> {
        let accessor = self
            .doc
            .accessors
            .get(index)
            .ok_or_else(|| "this .glb names a vertex list it does not hold".to_string())?;
        if accessor.sparse.is_some() {
            return Err(
                "this .glb stores a mesh as a sparse accessor, which coilbox does not read"
                    .to_string(),
            );
        }
        if kind_components(&accessor.kind) != Some(components) {
            return Err(format!(
                "this .glb has a vertex list of {} where coilbox expected {components} numbers \
                 each",
                accessor.kind
            ));
        }
        // A normalised integer is glTF's own way of storing texture coordinates
        // small, and it is spelled out in the accessor rather than behind an
        // extension, so it costs nothing to read.
        let scale = match (accessor.component_type, accessor.normalized) {
            (5126, _) => None,
            (5121, true) => Some(255.0),
            (5123, true) => Some(65535.0),
            (other, _) => {
                return Err(format!(
                    "this .glb stores a vertex list as component type {other}, which coilbox \
                     reads only as 32-bit floats"
                ))
            }
        };
        let size = if scale.is_some() && accessor.component_type == 5121 {
            1
        } else if scale.is_some() {
            2
        } else {
            4
        };

        let bytes = self.view(accessor, size * components)?;
        let stride = bytes.stride;
        let mut out = Vec::with_capacity(accessor.count * components);
        for element in 0..accessor.count {
            for component in 0..components {
                let at = element * stride + component * size;
                let value = match scale {
                    None => f32::from_le_bytes([
                        bytes.data[at],
                        bytes.data[at + 1],
                        bytes.data[at + 2],
                        bytes.data[at + 3],
                    ]),
                    Some(max) if size == 1 => f32::from(bytes.data[at]) / max,
                    Some(max) => {
                        f32::from(u16::from_le_bytes([bytes.data[at], bytes.data[at + 1]])) / max
                    }
                };
                out.push(value);
            }
        }
        Ok(out)
    }

    /// One accessor as triangle indices, checked against the vertex count.
    fn read_indices(&self, index: usize, vertices: usize) -> Result<Vec<u32>, String> {
        let accessor = self
            .doc
            .accessors
            .get(index)
            .ok_or_else(|| "this .glb names an index list it does not hold".to_string())?;
        if accessor.sparse.is_some() {
            return Err(
                "this .glb stores an index list as a sparse accessor, which coilbox does not read"
                    .to_string(),
            );
        }
        let size = match accessor.component_type {
            5121 => 1usize,
            5123 => 2,
            5125 => 4,
            other => {
                return Err(format!(
                    "this .glb stores an index list as component type {other}, which is not one of \
                     glTF's three index widths"
                ))
            }
        };
        let bytes = self.view(accessor, size)?;
        let mut out = Vec::with_capacity(accessor.count);
        for element in 0..accessor.count {
            let at = element * bytes.stride;
            let value = match size {
                1 => u32::from(bytes.data[at]),
                2 => u32::from(u16::from_le_bytes([bytes.data[at], bytes.data[at + 1]])),
                _ => u32_at(bytes.data, at),
            };
            if value as usize >= vertices {
                return Err(
                    "this .glb has a face pointing at a vertex the mesh does not have".to_string(),
                );
            }
            out.push(value);
        }
        Ok(out)
    }

    /// The bytes an accessor addresses, and how far apart its elements are.
    fn view(&self, accessor: &Accessor, element: usize) -> Result<Window<'_>, String> {
        let index = accessor
            .buffer_view
            .ok_or_else(|| "this .glb has a vertex list with no data behind it".to_string())?;
        let view = self
            .doc
            .buffer_views
            .get(index)
            .ok_or_else(|| "this .glb names a block of data it does not hold".to_string())?;
        let buffer = self
            .doc
            .buffers
            .get(view.buffer)
            .ok_or_else(|| "this .glb names a buffer it does not hold".to_string())?;
        if buffer.uri.is_some() {
            return Err(
                "this .glb keeps its vertices in a separate file beside it rather than inside \
                 itself, which coilbox does not follow. Export it again as a self-contained .glb."
                    .to_string(),
            );
        }
        let stride = view.byte_stride.unwrap_or(element).max(element);
        let from = view.byte_offset + accessor.byte_offset;
        // The last element needs `element` bytes, not a whole stride, which is
        // how a tightly packed view ends exactly on its own length.
        let needed = accessor.count.saturating_sub(1) * stride + element;
        let to = from
            .checked_add(needed)
            .filter(|to| *to <= self.bin.len() && *to <= view.byte_offset + view.byte_length)
            .ok_or_else(|| {
                "this .glb is truncated: a mesh runs past the end of its data".to_string()
            })?;
        Ok(Window {
            data: &self.bin[from..to],
            stride,
        })
    }
}

/// A run of bytes an accessor reads, and the gap between its elements.
struct Window<'a> {
    data: &'a [u8],
    stride: usize,
}

/// A node's own transform, from either spelling glTF allows.
fn node_matrix(node: &GNode) -> [f32; 16] {
    if let Some(matrix) = node.matrix {
        return matrix;
    }
    let t = node.translation.unwrap_or([0.0; 3]);
    let r = node.rotation.unwrap_or([0.0, 0.0, 0.0, 1.0]);
    let s = node.scale.unwrap_or([1.0; 3]);
    compose(t, r, s)
}

/// Translation, rotation as a quaternion and scale, as one column-major matrix.
fn compose(t: [f32; 3], r: [f32; 4], s: [f32; 3]) -> [f32; 16] {
    let [x, y, z, w] = r;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        (1.0 - (yy + zz)) * s[0],
        (xy + wz) * s[0],
        (xz - wy) * s[0],
        0.0,
        (xy - wz) * s[1],
        (1.0 - (xx + zz)) * s[1],
        (yz + wx) * s[1],
        0.0,
        (xz + wy) * s[2],
        (yz - wx) * s[2],
        (1.0 - (xx + yy)) * s[2],
        0.0,
        t[0],
        t[1],
        t[2],
        1.0,
    ]
}

/// The 4x4 identity, column-major.
pub const IDENTITY: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// `a` then `b`, the way a child's transform sits inside its parent's.
pub fn multiply(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0f32; 16];
    for column in 0..4 {
        for row in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k * 4 + row] * b[column * 4 + k];
            }
            out[column * 4 + row] = sum;
        }
    }
    out
}

/// Flat normals for a mesh that came without any, one per face, shared by the
/// vertices that face touches and renormalised at the end.
fn face_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let mut out = vec![[0.0f32; 3]; positions.len()];
    for face in indices.as_chunks::<3>().0 {
        let (a, b, c) = (
            positions[face[0] as usize],
            positions[face[1] as usize],
            positions[face[2] as usize],
        );
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        for corner in face {
            for axis in 0..3 {
                out[*corner as usize][axis] += n[axis];
            }
        }
    }
    for normal in &mut out {
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > 0.0 {
            for axis in normal.iter_mut() {
                *axis /= length;
            }
        } else {
            // A vertex no face touches, or one whose faces cancel out. Up is
            // as good an answer as any and beats a zero-length normal, which
            // renders as a black facet.
            *normal = [0.0, 1.0, 0.0];
        }
    }
    out
}

/// A triangle strip as a plain triangle list, alternating the winding the way
/// the format says to so every face still points the way it did.
fn from_strip(indices: &[u32]) -> Vec<u32> {
    let mut out = Vec::new();
    for (i, window) in indices.windows(3).enumerate() {
        if i % 2 == 0 {
            out.extend_from_slice(&[window[0], window[1], window[2]]);
        } else {
            out.extend_from_slice(&[window[0], window[2], window[1]]);
        }
    }
    out
}

/// A triangle fan as a plain triangle list, around its first vertex.
fn from_fan(indices: &[u32]) -> Vec<u32> {
    let mut out = Vec::new();
    for window in indices[1..].windows(2) {
        out.extend_from_slice(&[indices[0], window[0], window[1]]);
    }
    out
}

fn vec3s(flat: Vec<f32>) -> Vec<[f32; 3]> {
    flat.as_chunks::<3>().0.to_vec()
}

fn vec2s(flat: Vec<f32>) -> Vec<[f32; 2]> {
    flat.as_chunks::<2>().0.to_vec()
}

fn kind_components(kind: &str) -> Option<usize> {
    match kind {
        "SCALAR" => Some(1),
        "VEC2" => Some(2),
        "VEC3" => Some(3),
        "VEC4" => Some(4),
        _ => None,
    }
}

// -------------------------------------------------------------------- picture

/// The picture the model is painted with, out of whichever materials its meshes
/// actually draw with.
///
/// The first base colour image wins, and how many the file names comes back
/// separately, because an `.s3o` paints the whole unit with one texture and a
/// model split across several is a choice somebody has to be told about.
fn base_colour(
    doc: &Gltf,
    bin: &[u8],
    path: &Path,
    materials: &BTreeSet<usize>,
) -> (Option<Image>, Option<String>, usize) {
    let mut wanted: Vec<usize> = Vec::new();
    for material in materials {
        let Some(index) = doc
            .materials
            .get(*material)
            .and_then(|m| m.pbr_metallic_roughness.as_ref())
            .and_then(|pbr| pbr.base_color_texture.as_ref())
            .and_then(|info| doc.textures.get(info.index))
            .and_then(|texture| texture.source)
        else {
            continue;
        };
        if index < doc.images.len() && !wanted.contains(&index) {
            wanted.push(index);
        }
    }
    let Some(first) = wanted.first().copied() else {
        return (None, None, 0);
    };

    let image = &doc.images[first];
    let name = image_name(image, first, path);
    match image_bytes(doc, bin, path, image) {
        Some(bytes) => (Some(Image { bytes, name }), None, wanted.len()),
        None => (None, Some(name), wanted.len()),
    }
}

/// What to call an image, which is what the exported `.s3o` will name and what
/// has to be put in `unittextures` for that name to resolve.
///
/// Taken from whatever the file offers, in the order the file is likeliest to
/// have got right: its own name for the image, then the file it points at, then
/// the model's own name. Always ending `.png`, because the store re-encodes it
/// and an extension that lies about the bytes is worse than none.
fn image_name(image: &GImage, index: usize, path: &Path) -> String {
    let from_file = image
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .or_else(|| image.uri.as_deref().filter(|uri| !uri.starts_with("data:")))
        .map(|name| {
            name.trim()
                .replace('\\', "/")
                .rsplit('/')
                .next()
                .unwrap_or("")
                .to_string()
        })
        .filter(|name| !name.is_empty());

    let base = match from_file {
        Some(name) => name,
        None if index == 0 => stem(path),
        None => format!("{}{index}", stem(path)),
    };
    let stem = base.rsplit_once('.').map_or(base.as_str(), |(s, _)| s);
    // A name that is nothing but an extension, `.png`, leaves no stem at all.
    let stem = if stem.is_empty() { "texture" } else { stem };
    format!("{stem}.png")
}

/// An image's bytes, from inside the container or from beside it.
fn image_bytes(doc: &Gltf, bin: &[u8], path: &Path, image: &GImage) -> Option<Vec<u8>> {
    if let Some(index) = image.buffer_view {
        let view = doc.buffer_views.get(index)?;
        if doc.buffers.get(view.buffer)?.uri.is_some() {
            return None;
        }
        let to = view.byte_offset.checked_add(view.byte_length)?;
        return bin.get(view.byte_offset..to).map(<[u8]>::to_vec);
    }
    let uri = image.uri.as_deref()?;
    if let Some(encoded) = uri.split_once(";base64,").map(|(_, rest)| rest) {
        use base64::Engine;
        return base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .ok();
    }
    if uri.starts_with("data:") {
        return None;
    }
    std::fs::read(beside(path, uri)?).ok()
}

/// A file a `.glb` points at, resolved next to the `.glb` itself.
///
/// Only ever a file in the same folder or below it. A relative URI that climbs
/// out with `..`, or an absolute path, is a file the user did not choose by
/// choosing the model, so it is not read.
fn beside(path: &Path, uri: &str) -> Option<PathBuf> {
    let decoded = percent_decode(uri);
    if decoded.contains("://") || decoded.starts_with('/') || decoded.contains(':') {
        return None;
    }
    let mut out = path.parent()?.to_path_buf();
    for part in decoded.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

/// `%20` and its friends, which is how a URI carries a space in a file name.
fn percent_decode(uri: &str) -> String {
    let bytes = uri.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() {
            // Over the bytes rather than the `&str`: slicing a string by byte
            // range panics part way through a multi-byte character, and this
            // does not know what follows the `%`.
            if let Ok(byte) = std::str::from_utf8(&bytes[at + 1..at + 3])
                .ok()
                .ok_or(())
                .and_then(|digits| u8::from_str_radix(digits, 16).map_err(|_| ()))
            {
                out.push(byte);
                at += 3;
                continue;
            }
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ------------------------------------------------------------------- document

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Gltf {
    #[serde(default)]
    scene: Option<usize>,
    #[serde(default)]
    scenes: Vec<Scene>,
    #[serde(default)]
    nodes: Vec<GNode>,
    #[serde(default)]
    meshes: Vec<GMesh>,
    #[serde(default)]
    accessors: Vec<Accessor>,
    #[serde(default)]
    buffer_views: Vec<BufferView>,
    #[serde(default)]
    buffers: Vec<Buffer>,
    #[serde(default)]
    materials: Vec<Material>,
    #[serde(default)]
    textures: Vec<GTexture>,
    #[serde(default)]
    images: Vec<GImage>,
    #[serde(default)]
    extensions_required: Vec<String>,
}

#[derive(Deserialize)]
struct Scene {
    #[serde(default)]
    nodes: Vec<usize>,
}

#[derive(Deserialize)]
struct GNode {
    name: Option<String>,
    #[serde(default)]
    children: Vec<usize>,
    mesh: Option<usize>,
    matrix: Option<[f32; 16]>,
    translation: Option<[f32; 3]>,
    rotation: Option<[f32; 4]>,
    scale: Option<[f32; 3]>,
}

#[derive(Deserialize)]
struct GMesh {
    #[serde(default)]
    primitives: Vec<Primitive>,
}

#[derive(Deserialize)]
struct Primitive {
    #[serde(default)]
    attributes: std::collections::BTreeMap<String, usize>,
    indices: Option<usize>,
    material: Option<usize>,
    mode: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Accessor {
    buffer_view: Option<usize>,
    #[serde(default)]
    byte_offset: usize,
    component_type: u32,
    #[serde(default)]
    normalized: bool,
    count: usize,
    #[serde(rename = "type")]
    kind: String,
    sparse: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BufferView {
    buffer: usize,
    #[serde(default)]
    byte_offset: usize,
    byte_length: usize,
    byte_stride: Option<usize>,
}

#[derive(Deserialize)]
struct Buffer {
    uri: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Material {
    pbr_metallic_roughness: Option<Pbr>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pbr {
    base_color_texture: Option<TextureInfo>,
}

#[derive(Deserialize)]
struct TextureInfo {
    index: usize,
}

#[derive(Deserialize)]
struct GTexture {
    source: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GImage {
    name: Option<String>,
    uri: Option<String>,
    buffer_view: Option<usize>,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    /// A `.glb` container around a document and its binary chunk.
    pub(crate) fn container(doc: &serde_json::Value, bin: &[u8]) -> Vec<u8> {
        let mut json = serde_json::to_vec(doc).expect("document");
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut padded = bin.to_vec();
        while !padded.len().is_multiple_of(4) {
            padded.push(0);
        }

        let mut out = Vec::new();
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        let length = 12
            + 8
            + json.len()
            + if padded.is_empty() {
                0
            } else {
                8 + padded.len()
            };
        out.extend_from_slice(&(length as u32).to_le_bytes());
        out.extend_from_slice(&(json.len() as u32).to_le_bytes());
        out.extend_from_slice(&CHUNK_JSON.to_le_bytes());
        out.extend_from_slice(&json);
        if !padded.is_empty() {
            out.extend_from_slice(&(padded.len() as u32).to_le_bytes());
            out.extend_from_slice(&CHUNK_BIN.to_le_bytes());
            out.extend_from_slice(&padded);
        }
        out
    }

    fn floats(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    /// One unit triangle in the XY plane, its three vertices and one index run,
    /// as the binary chunk plus the accessors and views that address it.
    fn triangle() -> (Vec<u8>, serde_json::Value, serde_json::Value) {
        let mut bin = floats(&[
            0.0, 0.0, 0.0, // position
            1.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, //
            0.0, 0.0, 1.0, // normal
            0.0, 0.0, 1.0, //
            0.0, 0.0, 1.0, //
            0.0, 0.0, // uv
            1.0, 0.0, //
            0.0, 1.0, //
        ]);
        let indices_at = bin.len();
        for index in [0u16, 1, 2] {
            bin.extend_from_slice(&index.to_le_bytes());
        }

        let views = json!([
            { "buffer": 0, "byteOffset": 0, "byteLength": 36 },
            { "buffer": 0, "byteOffset": 36, "byteLength": 36 },
            { "buffer": 0, "byteOffset": 72, "byteLength": 24 },
            { "buffer": 0, "byteOffset": indices_at, "byteLength": 6 },
        ]);
        let accessors = json!([
            { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
            { "bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3" },
            { "bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC2" },
            { "bufferView": 3, "componentType": 5123, "count": 3, "type": "SCALAR" },
        ]);
        (bin, views, accessors)
    }

    /// A whole file: one root node called `base` with a child called `body`
    /// that draws the triangle above.
    pub(crate) fn two_pieces() -> Vec<u8> {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "base", "children": [1] },
                { "name": "body", "mesh": 0, "translation": [1.0, 2.0, 3.0] },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        container(&doc, &bin)
    }

    fn read_bytes(bytes: &[u8]) -> Result<Model, String> {
        read(bytes, Path::new("/tmp/unit.glb"))
    }

    #[test]
    fn keeps_the_tree_and_each_nodes_own_offset() {
        let model = read_bytes(&two_pieces()).expect("read");

        assert_eq!(model.root.name, "base");
        assert!(model.root.mesh.is_none());
        assert!(!model.invented_root);
        let body = &model.root.children[0];
        assert_eq!(body.name, "body");
        assert_eq!(
            [body.matrix[12], body.matrix[13], body.matrix[14]],
            [1.0, 2.0, 3.0]
        );
        let mesh = body.mesh.as_ref().expect("mesh");
        assert_eq!(mesh.positions.len(), 3);
        assert_eq!(mesh.indices, vec![0, 1, 2]);
        assert_eq!(mesh.uvs[1], [1.0, 0.0]);
    }

    /// The commonest wrong file to be handed, and the message has to say which
    /// export setting produces the right one.
    #[test]
    fn refuses_a_gltf_and_says_which_format_to_export() {
        let problem = read_bytes(b"{\"asset\":{\"version\":\"2.0\"}}").expect_err("refused");
        assert!(problem.contains("glTF Binary (.glb)"), "got: {problem}");
    }

    /// Draco rewrites how vertices are stored, so ignoring it would open a
    /// model made of noise rather than fail.
    #[test]
    fn refuses_draco_and_names_the_export_setting() {
        let doc = json!({
            "asset": { "version": "2.0" },
            "extensionsRequired": ["KHR_draco_mesh_compression"],
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "base" }],
        });
        let problem = read_bytes(&container(&doc, &[])).expect_err("refused");
        assert!(
            problem.contains("KHR_draco_mesh_compression"),
            "got: {problem}"
        );
        assert!(problem.contains("Compression"), "got: {problem}");
    }

    /// An extension that only changes how a material is lit says nothing about
    /// the geometry, so requiring it is not a reason to refuse.
    #[test]
    fn opens_a_file_requiring_only_a_material_extension() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "extensionsRequired": ["KHR_materials_unlit"],
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "body", "mesh": 0 }],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        assert!(read_bytes(&container(&doc, &bin)).is_ok());
    }

    /// Interleaved attributes are ordinary glTF and three.js writes them, so a
    /// reader that assumed a tight packing would read one file in two as junk.
    #[test]
    fn reads_interleaved_attributes() {
        // Two vertices of position and uv, one after the other, 20 bytes apart.
        let bin = floats(&[
            1.0, 2.0, 3.0, 0.25, 0.5, //
            4.0, 5.0, 6.0, 0.75, 1.0, //
        ]);
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "body", "mesh": 0 }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0, "TEXCOORD_0": 1 } }] }],
            "accessors": [
                { "bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": 2, "type": "VEC3" },
                { "bufferView": 0, "byteOffset": 12, "componentType": 5126, "count": 2, "type": "VEC2" },
            ],
            "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 40, "byteStride": 20 }],
            "buffers": [{ "byteLength": bin.len() }],
        });
        // Three corners are needed for a face, so this one has none and the
        // mesh is dropped. What is under test is that the numbers came out.
        let model = read_bytes(&container(&doc, &bin)).expect("read");
        assert!(model.root.mesh.is_none());
    }

    /// glTF says a primitive with no normals is flat shaded and the reader
    /// works them out. A unit that arrived with none would render black.
    #[test]
    fn works_out_normals_a_file_does_not_carry() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "body", "mesh": 0 }],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.flat_shaded, 1);
        let mesh = model.root.mesh.as_ref().expect("mesh");
        // The triangle lies in the XY plane wound counter-clockwise, so every
        // normal points along positive z.
        for normal in &mesh.normals {
            assert_eq!(*normal, [0.0, 0.0, 1.0]);
        }
    }

    /// A Spring model has exactly one root piece. A Blender scene need not.
    #[test]
    fn invents_a_root_when_the_scene_has_several() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0, 1] }],
            "nodes": [
                { "name": "left", "mesh": 0 },
                { "name": "right", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert!(model.invented_root);
        assert_eq!(model.root.name, "unit");
        assert_eq!(model.root.children.len(), 2);
    }

    /// A node may carry a matrix instead of a translation, rotation and scale,
    /// and both spellings mean the same thing.
    #[test]
    fn reads_a_node_that_carries_a_matrix() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [{
                "name": "body",
                "mesh": 0,
                "matrix": [2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 4.0, 5.0, 6.0, 1.0],
            }],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.root.matrix[0], 2.0);
        assert_eq!([model.root.matrix[12], model.root.matrix[13]], [4.0, 5.0]);
    }

    /// glTF forbids a cycle, and a reader that trusts it recurses until the
    /// stack runs out.
    #[test]
    fn refuses_nodes_parented_in_a_circle() {
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "a", "children": [1] },
                { "name": "b", "children": [0] },
            ],
        });
        let problem = read_bytes(&container(&doc, &[])).expect_err("refused");
        assert!(problem.contains("circle"), "got: {problem}");
    }

    /// The round trip's own case: coilbox's `.glb` export embeds the picture in
    /// the binary chunk, and it has to come back out under a usable name.
    #[test]
    fn finds_a_picture_embedded_in_the_container() {
        let (mut bin, mut views, accessors) = triangle();
        let png_at = bin.len();
        let png = b"\x89PNG\r\n\x1a\nnot really a png".to_vec();
        bin.extend_from_slice(&png);
        views.as_array_mut().expect("views").push(json!({
            "buffer": 0, "byteOffset": png_at, "byteLength": png.len(),
        }));

        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "body", "mesh": 0 }],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
                "material": 0,
            }] }],
            "materials": [{ "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } }],
            "textures": [{ "source": 0 }],
            "images": [{ "name": "armanac.dds", "bufferView": 4, "mimeType": "image/png" }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        let image = model.image.as_ref().expect("image");
        assert_eq!(image.bytes, png);
        // Under a `.png` name, because the store re-encodes it and an extension
        // that lies about the bytes is worse than none.
        assert_eq!(image.name, "armanac.png");
        assert_eq!(model.images_used, 1);
    }

    /// A file naming a picture that is not there still opens, and says which
    /// file it wanted, the same call the `.s3o` import makes.
    #[test]
    fn names_a_picture_it_could_not_find() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "name": "body", "mesh": 0 }],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
                "material": 0,
            }] }],
            "materials": [{ "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } } }],
            "textures": [{ "source": 0 }],
            "images": [{ "uri": "nosuchfile.png" }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert!(model.image.is_none());
        assert_eq!(model.missing_image.as_deref(), Some("nosuchfile.png"));
    }

    /// A URI climbing out of the model's own folder is a file the user did not
    /// choose by choosing the model.
    #[test]
    fn will_not_follow_a_picture_out_of_the_models_folder() {
        assert_eq!(beside(Path::new("/a/b/unit.glb"), "../secret.png"), None);
        assert_eq!(beside(Path::new("/a/b/unit.glb"), "/etc/passwd"), None);
        assert_eq!(
            beside(Path::new("/a/b/unit.glb"), "tex%20tures/skin.png"),
            Some(PathBuf::from("/a/b/tex tures/skin.png")),
        );
    }

    /// The whole point of the feature, and the one thing neither half's own
    /// tests could say on their own: coilbox reads what coilbox writes.
    ///
    /// `tests/exported.glb` is real `GLTFExporter` output, written by
    /// `src/lego/exportGlb.dom.test.ts` every time the frontend suite runs. If
    /// that exporter changes shape, this is what notices.
    #[test]
    fn opens_the_file_coilboxs_own_exporter_writes() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/exported.glb");
        let bytes = std::fs::read(&path).expect("the fixture, written by exportGlb.dom.test.ts");
        let model = read(&bytes, &path).expect("read");

        // One node per piece, which is why `buildGlbScene` makes a piece with
        // geometry a mesh rather than a group holding one. Wrapped, every such
        // piece arrived twice under the same name.
        assert!(!model.invented_root);
        assert_eq!(model.root.name, "base");
        assert!(model.root.mesh.is_none());

        let hull = &model.root.children[0];
        assert_eq!(hull.name, "hull");
        assert_eq!(
            [hull.matrix[12], hull.matrix[13], hull.matrix[14]],
            [1.0, 2.0, 3.0]
        );
        assert_eq!(hull.mesh.as_ref().expect("hull mesh").indices.len(), 3);

        let gun = &hull.children[0];
        assert_eq!(gun.name, "gun");
        assert_eq!(
            [gun.matrix[12], gun.matrix[13], gun.matrix[14]],
            [0.0, 4.0, 0.0]
        );
        assert!(gun.children.is_empty());

        // Axes and winding are untouched on the way out, so they come back
        // untouched: these are the pack part's own third vertex and first
        // normal, in the order `exportGlb.dom.test.ts` writes them.
        let hull_mesh = hull.mesh.as_ref().expect("hull mesh");
        assert_eq!(hull_mesh.positions[2], [0.0, 0.0, 1.0]);
        assert_eq!(hull_mesh.normals[0], [0.0, 1.0, 0.0]);
        assert_eq!(hull_mesh.uvs[2], [0.0, 1.0]);
    }

    /// A strip is wound alternately, so converting one without flipping every
    /// other face leaves half the piece lit from inside.
    #[test]
    fn converts_a_triangle_strip_keeping_every_faces_winding() {
        assert_eq!(from_strip(&[0, 1, 2, 3]), vec![0, 1, 2, 1, 3, 2]);
        assert_eq!(from_fan(&[0, 1, 2, 3]), vec![0, 1, 2, 0, 2, 3]);
    }

    // ------------------------------------------------------- doubled meshes

    /// A document shaped exactly the way `buildGlbScene` wrote one before
    /// #2576: `base` holding `hull`, an empty at [1,2,3] whose only child is
    /// another node also called `hull`, at the identity transform, carrying
    /// the mesh. `hull` in turn holds `gun` the same way, at [0,4,0]. Built by
    /// hand rather than exported, because the exporter that wrote this shape
    /// is gone: this is what `git show 1ccfac9f^:src/lego/exportGlb.ts`
    /// produced, transcribed directly rather than run.
    fn doubled_two_pieces() -> Vec<u8> {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "base", "children": [1] },
                { "name": "hull", "translation": [1.0, 2.0, 3.0], "children": [2, 3] },
                { "name": "hull", "mesh": 0 },
                { "name": "gun", "translation": [0.0, 4.0, 0.0], "children": [4] },
                { "name": "gun", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        container(&doc, &bin)
    }

    /// The whole point of #2619: a file shaped exactly like every `.glb`
    /// coilbox 1.12.0 or earlier wrote gives back the five-node, two-piece
    /// tree it was exported from, not the nine-node doubled one the file
    /// actually holds.
    #[test]
    fn folds_the_doubling_a_pre_1_12_1_export_left() {
        let model = read_bytes(&doubled_two_pieces()).expect("read");

        assert_eq!(model.folded, 2);
        assert_eq!(model.root.name, "base");
        assert!(model.root.mesh.is_none());

        let hull = &model.root.children[0];
        assert_eq!(hull.name, "hull");
        assert_eq!(
            [hull.matrix[12], hull.matrix[13], hull.matrix[14]],
            [1.0, 2.0, 3.0]
        );
        assert_eq!(hull.mesh.as_ref().expect("hull mesh").indices.len(), 3);
        // The doubled mesh node is gone from the tree entirely, not left
        // behind as an empty sibling.
        assert_eq!(hull.children.len(), 1);

        let gun = &hull.children[0];
        assert_eq!(gun.name, "gun");
        assert_eq!(
            [gun.matrix[12], gun.matrix[13], gun.matrix[14]],
            [0.0, 4.0, 0.0]
        );
        assert!(gun.mesh.is_some());
        assert!(gun.children.is_empty());
    }

    /// The same file, after a trip through Blender: Blender's object
    /// namespace collides on name regardless of type, so the second object
    /// under each doubled name, always the mesh, comes back renamed to
    /// `.001`. The parent empty keeps the bare name. A rule that only matched
    /// identical names would never fire here, which is the case #2619 itself
    /// says matters most.
    #[test]
    fn folds_the_doubling_after_a_blender_round_trip_renamed_it() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "hull", "translation": [1.0, 2.0, 3.0], "children": [1] },
                { "name": "hull.001", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 1);
        assert_eq!(model.root.name, "hull");
        assert!(model.root.mesh.is_some());
        assert!(model.root.children.is_empty());
    }

    /// A hand authored empty-plus-mesh pair under two unrelated names must
    /// never fold: the child's name is the one thing a unit script might
    /// still address, and there is no exporter bug to blame for it looking
    /// like this.
    #[test]
    fn does_not_fold_an_identity_child_with_a_different_name() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "root", "children": [1] },
                { "name": "detail", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 0);
        assert!(model.root.mesh.is_none());
        assert_eq!(model.root.children.len(), 1);
        assert_eq!(model.root.children[0].name, "detail");
    }

    /// A same-named child that has moved even slightly is not the exporter
    /// bug's shape: the buggy exporter never set a position, rotation or
    /// scale on the inner mesh at all.
    #[test]
    fn does_not_fold_a_same_named_child_that_is_not_at_the_identity() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "hull", "children": [1] },
                { "name": "hull", "mesh": 0, "translation": [0.1, 0.0, 0.0] },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 0);
        assert!(model.root.mesh.is_none());
        assert_eq!(model.root.children.len(), 1);
    }

    /// A same-named identity child that itself has children is not a doubled
    /// mesh: folding it would take a real subtree along for the ride.
    #[test]
    fn does_not_fold_a_same_named_child_that_has_children_of_its_own() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "hull", "children": [1] },
                { "name": "hull", "mesh": 0, "children": [2] },
                { "name": "detail" },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 0);
        assert!(model.root.mesh.is_none());
        assert_eq!(model.root.children.len(), 1);
        assert_eq!(model.root.children[0].name, "hull");
        assert!(model.root.children[0].mesh.is_some());
    }

    /// Two identity, leaf, same-named candidates under one parent is
    /// ambiguous rather than a doubled mesh: the exporter bug only ever left
    /// one, so a second candidate means this is not that shape.
    #[test]
    fn does_not_fold_when_more_than_one_candidate_matches() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "hull", "children": [1, 2] },
                { "name": "hull", "mesh": 0 },
                { "name": "hull", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 0);
        assert!(model.root.mesh.is_none());
        assert_eq!(model.root.children.len(), 2);
    }

    /// A node that already draws its own mesh is left alone regardless of
    /// what its children look like: the exporter bug always left the parent
    /// empty.
    #[test]
    fn does_not_fold_into_a_parent_that_already_has_a_mesh() {
        let (bin, views, accessors) = triangle();
        let doc = json!({
            "asset": { "version": "2.0" },
            "scenes": [{ "nodes": [0] }],
            "nodes": [
                { "name": "hull", "mesh": 0, "children": [1] },
                { "name": "hull", "mesh": 0 },
            ],
            "meshes": [{ "primitives": [{
                "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 },
                "indices": 3,
            }] }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "byteLength": bin.len() }],
        });
        let model = read_bytes(&container(&doc, &bin)).expect("read");

        assert_eq!(model.folded, 0);
        assert!(model.root.mesh.is_some());
        assert_eq!(model.root.children.len(), 1);
    }
}
