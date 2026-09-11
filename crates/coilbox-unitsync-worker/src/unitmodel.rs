//! `--unit-model` mode: read one unit's model out of a game archive and flatten
//! it into something a webview can draw.
//!
//! The two reader crates deliberately do not share a model type, because a
//! `.3do` names a texture per face and carries no UVs while an `.s3o` binds one
//! texture for the whole model and stores UVs per vertex. The format branch is
//! taken here rather than in the viewer: both end up as a tree of pieces whose
//! geometry is a list of indexed triangle batches, one per texture. An `.s3o`
//! piece is always one batch, a `.3do` piece is one per distinct texture its
//! faces name, and the viewer then has a single code path.
//!
//! Textures are copied out of the archive as raw bytes into a cache dir the
//! asset protocol serves, and are never decoded here. Splinter Faction's shared
//! unit atlas is a DXT5 8192 by 8192 `.dds`: 64 MiB compressed and 256 MiB as
//! RGBA, so decoding it the way `factionlogo.rs` decodes a 16px sidepic would
//! cost a quarter of a gigabyte for one texture. The webview uploads it still
//! compressed instead.

use crate::ffi::Unitsync;
use crate::model::{ModelGroup, ModelPiece, ModelTexture, UnitModelOutput};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::Path;
use std::rc::Rc;

/// Salts the texture cache file names. Bump when the naming scheme changes so
/// stale files are never picked up under a new meaning.
///
/// 3: `.tif` is re-encoded to PNG rather than written through raw, and so is an
/// extension spelled in upper case (issue #1915). A cache filled before that
/// holds 276 files on this machine that were written through when they should
/// have been re-encoded, and their names are what a new build asks for.
///
/// Also the literal prefix [`cache_file_name`] gives every file, which is what
/// lets `tauri-plugin-coilbox-unitsync`'s startup sweep (`modelcache.rs`, issue
/// #1919) tell a live file from an orphan without opening an archive: bump this
/// and the sweep deletes everything written under the old number on its next
/// launch. That module keeps its own copy of this number, since there is no
/// library dependency between this sidecar and the plugin crate, so bump both
/// together.
pub(crate) const CACHE_VERSION: u32 = 3;

/// Models are a few megabytes at most: the largest in the games checked is a
/// 3.2 MiB `.s3o`. Bound the read anyway.
pub(crate) const MODEL_READ_CAP: usize = 64 * 1024 * 1024;

/// Textures go up to Splinter Faction's 64 MiB shared atlas. Anything past this
/// is not a unit texture.
pub(crate) const TEXTURE_READ_CAP: usize = 128 * 1024 * 1024;

/// How many bytes of texture a batch keeps between its models (issue #1676).
///
/// 256 MiB, which is four of Splinter Faction's atlas and comfortably the whole
/// working set of every game on this machine: the largest measured was Beyond
/// All Reason at 84 MiB over 564 units. The number is a ceiling rather than a
/// target, and it is here because a game nobody has looked at could ship a
/// gigabyte of distinct unit art. A batch over one of those keeps the last
/// quarter gigabyte and re-reads the rest, which is slower than holding it all
/// and is not an allocation failure.
const TEXTURE_CACHE_BUDGET: usize = 256 * 1024 * 1024;

/// Where the engine looks for a unitdef's `objectname`.
pub(crate) const MODEL_DIR: &str = "objects3d";

/// Model extensions tried for an `objectname` written without one, in the order
/// the engine registers their parsers (`RegisterModelFormats` in
/// `rts/Rendering/Models/IModelParser.cpp`). Order decides which file wins when
/// a game ships the same model twice.
///
/// The engine registers `gltf` and `glb` between `s3o` and the Assimp formats,
/// and they are missing here because it reads those with a parser of its own
/// rather than through Assimp. A game shipping one gets the same answer it got
/// before: no model.
const MODEL_EXTS: [&str; 7] = ["3do", "s3o", "3ds", "dae", "lwo", "obj", "blend"];

/// Whether a name already carries a model extension, rather than being a bare
/// `objectname` the engine would append one to.
fn is_model_file(lower: &str) -> bool {
    MODEL_EXTS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Where an `.s3o` header's texture name resolves against.
const S3O_TEXTURE_DIR: &str = "unittextures";

/// Where a `.3do` face's texture name resolves against, and where the list of
/// names that skip the `00` suffix lives.
pub(crate) const TATEX_DIR: &str = "unittextures/tatex";
const TEAMTEX_LIST: &str = "unittextures/tatex/teamtex.txt";

/// Where the Total Annihilation palette lives: 256 4-byte entries the engine
/// reads via `CTAPalette::Init` (`rts/Rendering/Textures/TAPalette.cpp`) and
/// looks up per `.3do` face that names no texture. See
/// [`coilbox_3do::read_palette`] for the exact byte layout.
const PALETTE_FILE: &str = "unittextures/tatex/palette.pal";

/// Comfortably more than the 1024 bytes a real palette is, so a slightly
/// oversized file still reads whole rather than truncating into
/// [`coilbox_3do::read_palette`] returning `None`.
const PALETTE_READ_CAP: usize = 8192;

/// Extensions probed for a texture named without one. Ordered by how often the
/// installed games use them for unit art.
const TEXTURE_EXTS: &[&str] = &["dds", "tga", "png", "bmp", "jpg", "jpeg"];

/// A `.3do` face is stretched over the whole of its texture, so its corners take
/// the corners of the texture rather than a stored UV. Faces with more than four
/// corners wrap, which is what the engine's own quad-oriented mapping does.
const CORNER_UV: [[f32; 2]; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];

/// Print a `UnitModelOutput` carrying only an error (used on panic/setup fail).
pub fn emit_error(msg: String) {
    let out = UnitModelOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Read `object_name`'s model out of `game_archive` and flatten it.
///
/// `object_name` is the unitdef field verbatim, so it may be any case and
/// usually has no extension. Textures are written into `cache_dir`, and are
/// simply left unresolved when there is no cache dir to write them to.
pub fn render(
    lib: &str,
    game_archive: &str,
    object_name: &str,
    cache_dir: Option<&Path>,
) -> UnitModelOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UnitModelOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut errors = us.drain_errors();

    if !us.add_all_archives(game_archive) {
        errors.push("this engine's libunitsync can't load game archives".into());
        us.uninit();
        return UnitModelOutput {
            errors,
            ..Default::default()
        };
    }
    errors.extend(us.drain_errors());

    let handle = crate::archive::resolve_open_path(&us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        errors.push(format!("could not open archive {game_archive}"));
        us.remove_all_archives();
        us.uninit();
        return UnitModelOutput {
            errors,
            ..Default::default()
        };
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();

    let teamtex = read_teamtex(&us, handle, &list);
    let palette = read_palette(&us);
    let key_base = cache_key_base(&us, game_archive);
    let cache = cache_dir.zip(key_base.as_deref());
    let mut out = read_model(
        &us,
        handle,
        &list,
        &teamtex,
        palette.as_ref(),
        cache,
        game_archive,
        object_name,
    );

    us.close_archive(handle);
    errors.extend(us.drain_errors());
    us.remove_all_archives();
    us.uninit();

    out.errors.splice(0..0, errors);
    out
}

/// Read and flatten one model against a session the caller has already mounted.
///
/// Everything the archive holds in common between models is a parameter rather
/// than something read here: the member listing, `teamtex.txt` and the cache key
/// are properties of the archive, not of a model, so a batch (issue #1684) pays
/// for them once. `game_archive` is only used to say which archive a model is
/// missing from.
#[allow(clippy::too_many_arguments)]
pub(crate) fn read_model(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    teamtex: &[String],
    palette: Option<&coilbox_3do::Palette>,
    cache: Option<(&Path, &str)>,
    game_archive: &str,
    object_name: &str,
) -> UnitModelOutput {
    let mut out = match find_model(list, object_name) {
        Some(path) => match us.read_archive_member(handle, &path, MODEL_READ_CAP) {
            Some((_, bytes)) => build(&path, &bytes, palette),
            None => UnitModelOutput {
                errors: vec![format!("could not read {path} out of {game_archive}")],
                ..Default::default()
            },
        },
        None => UnitModelOutput {
            errors: vec![format!(
                "{game_archive} has no model for {object_name:?} under {MODEL_DIR}/"
            )],
            ..Default::default()
        },
    };

    let format = out.format.clone();
    for tex in out.textures.iter_mut().chain(out.texture2.iter_mut()) {
        resolve_texture(us, handle, list, &format, teamtex, cache, tex);
    }
    rename_empty_textures(&mut out);
    out
}

/// Rewrite an empty `.3do` texture name to `coilbox_3do::EMPTY_TEXTURE_NAME`
/// once resolution has already run.
///
/// [`resolve_texture`] needs the true empty string to compute the engine's
/// `00` suffix (issue #2610), so this runs after it rather than before.
/// `ModelGroup::texture` and `ModelTexture::name` are the same key by
/// contract, so both are rewritten together: leaving one blank and the other
/// `"00"` would break the viewer's own lookup between them.
fn rename_empty_textures(out: &mut UnitModelOutput) {
    for tex in out.textures.iter_mut().chain(out.texture2.iter_mut()) {
        if tex.name.is_empty() {
            tex.name = coilbox_3do::EMPTY_TEXTURE_NAME.to_string();
        }
    }
    if let Some(root) = &mut out.root {
        rename_empty_group_textures(root);
    }
}

fn rename_empty_group_textures(piece: &mut ModelPiece) {
    for group in &mut piece.groups {
        if group.texture.as_deref() == Some("") {
            group.texture = Some(coilbox_3do::EMPTY_TEXTURE_NAME.to_string());
        }
    }
    for child in &mut piece.children {
        rename_empty_group_textures(child);
    }
}

/// What a render of `object_name` is taken of, as a digest, plus the archive
/// member the model came from (issue #1631).
///
/// Reads the same model and the same textures the viewer draws with, and hands
/// their archive bytes to [`crate::assetencode::model_source_digest`]. That is
/// the stable half of a render's `source_hash`: it moves when the game ships a
/// new model or a re-skin and stays put when coilbox changes how it draws one.
///
/// The bytes rather than the cached texture files, which are what the webview
/// loads: those go through a transcode for `.bmp` and `.tga`, so hashing them
/// would let a change to that transcoder move every unit's identity. Changes to
/// how coilbox draws a model belong to `RENDER_VERSION` instead.
///
/// Takes a session the caller has already mounted, so a render pays for one
/// archive mount rather than two.
pub(crate) fn source_digest(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    object_name: &str,
) -> Result<(String, String), String> {
    let teamtex = read_teamtex(us, handle, list);
    let palette = read_palette(us);
    // One model, so nothing is shared with a next one and the cache is thrown
    // away with the call.
    let mut cache = TextureCache::new(TEXTURE_CACHE_BUDGET);
    source_digest_with(
        us,
        handle,
        list,
        &teamtex,
        palette.as_ref(),
        &mut cache,
        object_name,
    )
}

/// Texture bytes held between the models of one batch, in least recently used
/// order, so a texture the previous model also drew with is not read again
/// (issue #1676).
///
/// **Keyed on the archive member path alone, and only ever alive inside one
/// [`digest_reader`].** That is what makes the bare path safe as a key: a reader
/// is handed a mount and an open handle and never outlives either, so every
/// entry in it came through the same `handle` and two archives that both hold a
/// `unittextures/arm01a00.tga` cannot meet in one cache. A process-wide cache
/// under the same key would be wrong, and it would be wrong quietly: the digests
/// it fed would be of one game's textures under another game's model. Nothing
/// here is keyed on the game or the archive because nothing here needs to be.
struct TextureCache {
    /// Least recently used first, so eviction takes from the front. A `Vec`
    /// rather than a map because a game's whole unit texture set is hundreds of
    /// members at most, and a scan of those costs nothing against the megabytes
    /// the entry holds.
    entries: Vec<(String, Rc<Vec<u8>>)>,
    bytes: usize,
    budget: usize,
}

impl TextureCache {
    fn new(budget: usize) -> Self {
        Self {
            entries: Vec::new(),
            bytes: 0,
            budget,
        }
    }

    /// The bytes of `member`, calling `read` only when they are not already held.
    ///
    /// `read` rather than the archive itself, so what the cache does can be
    /// counted in a test without a mounted game.
    ///
    /// `None` when the member does not read, which is what the caller then
    /// leaves out of the digest. A failed read is not remembered: it costs a
    /// lookup in the archive's own index rather than a decompression, and
    /// keeping it would hold "this is missing" against the budget for real
    /// bytes.
    fn get(&mut self, member: &str, read: impl FnOnce() -> Option<Vec<u8>>) -> Option<Rc<Vec<u8>>> {
        if let Some(at) = self.entries.iter().position(|(key, _)| key == member) {
            let entry = self.entries.remove(at);
            let bytes = Rc::clone(&entry.1);
            self.entries.push(entry);
            return Some(bytes);
        }
        let bytes = Rc::new(read()?);
        self.bytes += bytes.len();
        self.entries.push((member.to_string(), Rc::clone(&bytes)));
        // Never evicts what was just read, so a texture larger than the whole
        // budget is still returned rather than read and dropped. The caller
        // holds its own `Rc` to everything it asked for, so an eviction frees
        // the bytes at the end of the model rather than under it.
        while self.bytes > self.budget && self.entries.len() > 1 {
            let (_, evicted) = self.entries.remove(0);
            self.bytes -= evicted.len();
        }
        Some(bytes)
    }
}

/// A digest reader for a batch of models against one mounted archive.
///
/// A blueprint's worth of renders asks for many models out of one game (issue
/// #1666), and everything the archive holds in common between them is read here
/// once: the member listing is the caller's, and `teamtex.txt` is a property of
/// the archive rather than of a model, so reading it per unit would read the same
/// file hundreds of times.
///
/// Textures are the same argument one level down (issue #1676). A game that
/// draws its whole roster with one atlas is the case this exists for: Splinter
/// Faction's is a 64 MiB `.dds`, so 158 units used to decompress 10 GB to
/// produce 158 digests. Held across the batch it is decompressed once.
///
/// Takes the mount rather than making one, so a batch cannot mount per unit even
/// by mistake.
pub(crate) fn digest_reader<'a>(
    us: &'a Unitsync,
    handle: i32,
    list: &'a [(String, String)],
) -> impl Fn(&str) -> Result<(String, String), String> + 'a {
    let teamtex = read_teamtex(us, handle, list);
    let palette = read_palette(us);
    let cache = RefCell::new(TextureCache::new(TEXTURE_CACHE_BUDGET));
    move |object_name| {
        source_digest_with(
            us,
            handle,
            list,
            &teamtex,
            palette.as_ref(),
            &mut cache.borrow_mut(),
            object_name,
        )
    }
}

/// [`source_digest`] against a `teamtex.txt` and palette the caller has already
/// read, and a texture cache the caller decides the lifetime of.
#[allow(clippy::too_many_arguments)]
fn source_digest_with(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    teamtex: &[String],
    palette: Option<&coilbox_3do::Palette>,
    cache: &mut TextureCache,
    object_name: &str,
) -> Result<(String, String), String> {
    let path = find_model(list, object_name)
        .ok_or_else(|| format!("no model for {object_name:?} under {MODEL_DIR}/"))?;
    let (_, model_bytes) = us
        .read_archive_member(handle, &path, MODEL_READ_CAP)
        .ok_or_else(|| format!("could not read {path}"))?;

    let flattened = build(&path, &model_bytes, palette);
    let format = flattened.format.clone();

    // Ordered by member path so the digest does not depend on the order the
    // model file happened to name its textures, and deduped so a model naming
    // one texture twice does not hash it twice.
    let mut members: Vec<String> = flattened
        .textures
        .iter()
        .chain(flattened.texture2.iter())
        // A `.3do` team-colour region is a name the engine paints rather than a
        // file, and a resolved palette entry is a colour read out of the
        // archive's palette table rather than a texture member, so there is
        // nothing under either name to hash.
        .filter(|tex| {
            tex.palette_colour.is_none()
                && !(format == "3do" && teamtex.contains(&tex.name.trim().to_lowercase()))
        })
        .filter_map(|tex| locate_texture(list, &format, teamtex, &tex.name))
        .collect();
    members.sort();
    members.dedup();

    let textures: Vec<Rc<Vec<u8>>> = members
        .iter()
        .filter_map(|member| {
            cache.get(member, || {
                us.read_archive_member(handle, member, TEXTURE_READ_CAP)
                    .map(|(_, bytes)| bytes)
            })
        })
        .collect();
    let textures: Vec<&[u8]> = textures.iter().map(|bytes| bytes.as_slice()).collect();

    Ok((
        crate::assetencode::model_source_digest(&model_bytes, &textures),
        path,
    ))
}

/// Parse `bytes` by the extension of `path` and flatten the result.
///
/// The last arm matters as much as the others. An extension nothing here reads
/// used to fall through to the `.s3o` reader and fail as though the file were a
/// broken `.s3o`, which said nothing useful about a `.gltf` sitting in the
/// archive intact.
fn build(path: &str, bytes: &[u8], palette: Option<&coilbox_3do::Palette>) -> UnitModelOutput {
    let lower = path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    let read_error = |e: String| UnitModelOutput {
        errors: vec![format!("could not read {path}: {e}")],
        ..Default::default()
    };
    match ext {
        "3do" => match coilbox_3do::read(bytes) {
            Ok(m) => from_3do(path, &m, palette),
            Err(e) => read_error(e.to_string()),
        },
        "s3o" => match coilbox_s3o::read(bytes) {
            Ok(m) => from_s3o(path, &m),
            Err(e) => read_error(e.to_string()),
        },
        e if coilbox_assimp::EXTENSIONS.contains(&e) => match coilbox_assimp::read(bytes, e) {
            Ok(m) => from_assimp(path, &m, e),
            Err(e) => read_error(e),
        },
        _ => UnitModelOutput {
            errors: vec![format!(
                "{path} is in a model format coilbox cannot read, though the archive does hold it"
            )],
            ..Default::default()
        },
    }
}

// ---------------------------------------------------------------- s3o

/// Flatten an `.s3o`. One texture for the whole model, so every piece with
/// geometry gets a single batch naming it. `texture2` is named but not drawn:
/// the engine reads its red as self-illumination, its green as reflectivity and
/// its alpha as whether a pixel is drawn, none of which the viewer does. The
/// team-colour mask is the alpha of `texture1`.
fn from_s3o(path: &str, model: &coilbox_s3o::Model) -> UnitModelOutput {
    let texture = (!model.texture1.is_empty()).then(|| model.texture1.clone());
    let mask = (!model.texture2.is_empty()).then(|| ModelTexture {
        name: model.texture2.clone(),
        ..Default::default()
    });
    UnitModelOutput {
        format: "s3o".into(),
        path: path.to_string(),
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        root: Some(s3o_piece(&model.root, texture.as_deref())),
        textures: texture
            .map(|name| {
                vec![ModelTexture {
                    name,
                    ..Default::default()
                }]
            })
            .unwrap_or_default(),
        texture2: mask,
        palette_faces: 0,
        errors: Vec::new(),
    }
}

fn s3o_piece(piece: &coilbox_s3o::Piece, texture: Option<&str>) -> ModelPiece {
    let indices = piece.triangles();
    let mut groups = Vec::new();
    if !indices.is_empty() {
        let mut positions = Vec::with_capacity(piece.vertices.len() * 3);
        let mut normals = Vec::with_capacity(piece.vertices.len() * 3);
        let mut uvs = Vec::with_capacity(piece.vertices.len() * 2);
        for v in &piece.vertices {
            positions.extend_from_slice(&v.pos);
            normals.extend_from_slice(&v.normal);
            uvs.extend_from_slice(&v.uv);
        }
        groups.push(ModelGroup {
            texture: texture.map(str::to_string),
            positions,
            normals,
            uvs,
            indices,
        });
    }
    ModelPiece {
        name: piece.name.clone(),
        offset: piece.offset,
        groups,
        children: piece
            .children
            .iter()
            .map(|c| s3o_piece(c, texture))
            .collect(),
    }
}

// ---------------------------------------------------------------- assimp

/// Flatten one of the formats read through Assimp.
///
/// Closer to `.s3o` than to `.3do`: vertices carry their own UV, and one
/// texture covers the whole model. What differs is where that texture name
/// comes from. A `.dae` holds no Spring texture binding, and flove's models
/// name none in their materials either, so most of the time this arrives
/// empty and the Lua metafile beside the model is the only source. The caller
/// applies that, because reading it needs the archive.
///
/// `format` is the real extension rather than a word covering all five, so the
/// unit page can name the format and `locate_texture` keeps its one `.3do`
/// branch instead of gaining a list.
fn from_assimp(path: &str, model: &coilbox_assimp::Model, format: &str) -> UnitModelOutput {
    let texture = model
        .material_texture
        .clone()
        .filter(|name| !name.trim().is_empty());
    UnitModelOutput {
        format: format.to_string(),
        path: path.to_string(),
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        root: Some(assimp_piece(&model.root, texture.as_deref())),
        textures: texture
            .map(|name| {
                vec![ModelTexture {
                    name,
                    ..Default::default()
                }]
            })
            .unwrap_or_default(),
        texture2: None,
        palette_faces: 0,
        errors: Vec::new(),
    }
}

fn assimp_piece(piece: &coilbox_assimp::Piece, texture: Option<&str>) -> ModelPiece {
    let groups = piece
        .meshes
        .iter()
        .filter(|mesh| !mesh.indices.is_empty())
        .map(|mesh| {
            let mut positions = Vec::with_capacity(mesh.vertices.len() * 3);
            let mut normals = Vec::with_capacity(mesh.vertices.len() * 3);
            let mut uvs = Vec::with_capacity(mesh.vertices.len() * 2);
            for v in &mesh.vertices {
                positions.extend_from_slice(&v.pos);
                normals.extend_from_slice(&v.normal);
                uvs.extend_from_slice(&v.uv);
            }
            ModelGroup {
                texture: texture.map(str::to_string),
                positions,
                normals,
                uvs,
                indices: mesh.indices.clone(),
            }
        })
        .collect();
    ModelPiece {
        name: piece.name.clone(),
        offset: piece.offset,
        groups,
        children: piece
            .children
            .iter()
            .map(|c| assimp_piece(c, texture))
            .collect(),
    }
}

// ---------------------------------------------------------------- 3do

/// Flatten a `.3do`. A face names its own texture and has no UV, so a piece
/// becomes one batch per distinct texture, and each face's corners are expanded
/// rather than shared: two faces meeting at a corner have different normals for
/// it, and under different textures they cannot share a vertex at all.
fn from_3do(
    path: &str,
    model: &coilbox_3do::Model,
    palette: Option<&coilbox_3do::Palette>,
) -> UnitModelOutput {
    let mut names: Vec<String> = Vec::new();
    let mut palette_faces = 0u32;
    let mut palette_colours: BTreeMap<String, [u8; 3]> = BTreeMap::new();
    let root = do3_piece(
        &model.root,
        &mut names,
        &mut palette_faces,
        &mut palette_colours,
        palette,
    );
    UnitModelOutput {
        format: "3do".into(),
        path: path.to_string(),
        radius: model.radius,
        height: model.height,
        mid: model.mid,
        root: Some(root),
        textures: names
            .into_iter()
            .map(|name| {
                let palette_colour = palette_colours.get(&name).copied();
                ModelTexture {
                    name,
                    palette_colour,
                    ..Default::default()
                }
            })
            .collect(),
        // A `.3do` has no second texture: its team-colour regions are named
        // face by face, and `resolve_texture` flags them instead.
        texture2: None,
        palette_faces,
        errors: Vec::new(),
    }
}

fn do3_piece(
    piece: &coilbox_3do::Piece,
    names: &mut Vec<String>,
    palette_faces: &mut u32,
    palette_colours: &mut BTreeMap<String, [u8; 3]>,
    palette: Option<&coilbox_3do::Palette>,
) -> ModelPiece {
    // Ordered so a piece's batches come out in a stable order, and so the
    // untextured batch (the `None` key) is always first.
    let mut batches: BTreeMap<Option<String>, ModelGroup> = BTreeMap::new();

    for prim in &piece.primitives {
        let key = match &prim.texture {
            // Any name, empty included, resolves against `unittextures/tatex/`
            // the same way: the engine's `S3DOPiece::GetTexture`
            // (`rts/Rendering/Models/3DOParser.cpp`) appends `00` to whatever
            // the file gives and an empty name is not in `teamtex.txt` either,
            // so it becomes `"00"` and looks up real artwork rather than
            // drawing plain (issue #2610).
            coilbox_3do::Texture::Name(n) => {
                if !names.iter().any(|k| k == n) {
                    names.push(n.clone());
                }
                Some(n.clone())
            }
            // A palette entry that resolves gets its own synthetic name, one
            // per entry the model actually uses, so it draws in its real
            // colour rather than the plain grey an unresolved face falls back
            // to below.
            coilbox_3do::Texture::Palette(n) => match resolve_palette_entry(palette, *n) {
                Some(rgb) => {
                    let name = palette_tile_name(*n);
                    if !names.iter().any(|k| k == &name) {
                        names.push(name.clone());
                    }
                    palette_colours.insert(name.clone(), rgb);
                    Some(name)
                }
                None => {
                    *palette_faces += 1;
                    None
                }
            },
        };
        let group = batches.entry(key.clone()).or_insert_with(|| ModelGroup {
            texture: key,
            ..Default::default()
        });
        let base = (group.positions.len() / 3) as u32;
        for (corner, &vi) in prim.indices.iter().enumerate() {
            let pos = piece.vertices[vi as usize];
            let normal = prim
                .vertex_normals
                .get(corner)
                .copied()
                .unwrap_or(prim.normal);
            group.positions.extend_from_slice(&pos);
            group.normals.extend_from_slice(&normal);
            group.uvs.extend_from_slice(&CORNER_UV[corner % 4]);
        }
        // A face of any corner count is a fan around its first corner. The
        // reader has already dropped everything with fewer than three.
        //
        // Wound backwards, because the engine derives a `.3do` face normal as
        // the negative of the usual right-handed cross product. Winding the fan
        // forwards would make the side the normals point at the back face, and
        // every lit face would come out dark.
        for i in 1..prim.indices.len().saturating_sub(1) {
            group
                .indices
                .extend_from_slice(&[base, base + i as u32 + 1, base + i as u32]);
        }
    }

    ModelPiece {
        name: piece.name.clone(),
        offset: piece.offset,
        groups: batches.into_values().collect(),
        children: piece
            .children
            .iter()
            .map(|c| do3_piece(c, names, palette_faces, palette_colours, palette))
            .collect(),
    }
}

// ---------------------------------------------------------------- lookup

/// Find the archive member a unitdef's `objectname` refers to.
///
/// The field is written however the game's author felt like: `"ARMCOM"`,
/// `"arm_commander.s3o"`, or a path with a subfolder and Windows separators. A
/// name with no extension means the engine tries `.3do` first and `.s3o` after:
/// `CModelLoader::FindModelPath` in `rts/Rendering/Models/IModelParser.cpp`
/// walks `parsers` in registration order, and `RegisterModelFormats` registers
/// `3do` before `s3o`. That is the order tried here.
///
/// A caller that already holds a member path, the archive browser previewing the
/// file somebody clicked (issue #698), gets that member and not a namesake: a
/// whole-path match is taken first, and only for a name that is already a model
/// file. The suffix matching below would otherwise hand back whichever model
/// under `objects3d/` shares its file name.
fn find_model(list: &[(String, String)], object_name: &str) -> Option<String> {
    let want = object_name.trim().replace('\\', "/").to_lowercase();
    if want.is_empty() {
        return None;
    }
    if is_model_file(&want) {
        if let Some((_, real)) = list.iter().find(|(lower, _)| *lower == want) {
            return Some(real.clone());
        }
    }
    let candidates: Vec<String> = if is_model_file(&want) {
        vec![want]
    } else {
        MODEL_EXTS.iter().map(|ext| format!("{want}.{ext}")).collect()
    };
    // The declared folder first, then the same name anywhere, which catches the
    // games that put models under their own subfolders.
    for c in &candidates {
        if let Some(hit) = find_member(list, &format!("{MODEL_DIR}/{c}")) {
            return Some(hit);
        }
    }
    for c in &candidates {
        let base = c.rsplit('/').next().unwrap_or(c);
        if let Some(hit) = list
            .iter()
            .find(|(lower, _)| lower.starts_with(MODEL_DIR) && lower.ends_with(&format!("/{base}")))
        {
            return Some(hit.1.clone());
        }
    }
    None
}

/// Read `unittextures/tatex/teamtex.txt`: the names a `.3do` face can use.
///
/// A property of the archive rather than of a model, so a batch reads it once
/// for the whole list.
/// without the `00` suffix the engine otherwise appends. Lower cased, because
/// the file is written in the original mixed case and the models are not.
pub(crate) fn read_teamtex(us: &Unitsync, handle: i32, list: &[(String, String)]) -> Vec<String> {
    let Some(actual) = find_member(list, TEAMTEX_LIST) else {
        return Vec::new();
    };
    let Some((_, bytes)) = us.read_archive_member(handle, &actual, 64 * 1024) else {
        return Vec::new();
    };
    String::from_utf8_lossy(&bytes)
        .lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Read and parse `unittextures/tatex/palette.pal`: the colour a `.3do` face
/// takes when it names no texture at all, indexed by the entry the file gives.
///
/// Through [`Unitsync::read_vfs_file`] rather than [`Unitsync::read_archive_member`]
/// on the opened handle, because the file is not necessarily the game's own.
/// Balanced Annihilation, for one, ships its own `teamtex.txt` and its own full
/// `tatex` tile set but not `palette.pal`, and still draws it correctly because
/// the engine finds it in `springcontent.sdz`. The single-archive API this
/// module reads everything else through only sees one archive's own contents,
/// so a lookup through it would miss and every palette face would fall back to
/// grey.
///
/// A property of the archive rather than of a model, so a batch reads it once
/// for the whole list, the same as [`read_teamtex`]. `None` when nothing
/// answers to the name, or answers with fewer than the 256 entries the engine
/// expects: a face naming an entry is then drawn plain rather than guessed at.
pub(crate) fn read_palette(us: &Unitsync) -> Option<coilbox_3do::Palette> {
    let bytes = us.read_vfs_file(PALETTE_FILE, PALETTE_READ_CAP)?;
    coilbox_3do::read_palette(&bytes)
}

/// The colour a resolved [`coilbox_3do::Texture::Palette`] entry means, or
/// `None` when there is no palette table or the entry falls outside it.
fn resolve_palette_entry(palette: Option<&coilbox_3do::Palette>, entry: i32) -> Option<[u8; 3]> {
    let index = usize::try_from(entry).ok()?;
    palette?.get(index).copied()
}

/// The synthetic [`ModelTexture::name`] a resolved palette entry is filed
/// under. Distinct for every entry a model actually uses, so two different
/// colours never collapse onto one material, and safe from colliding with a
/// real `.3do` texture name, which the format stores with no path separator.
fn palette_tile_name(entry: i32) -> String {
    format!("/palette/{entry}")
}

/// Resolve one texture name to an archive member, and copy its bytes into the
/// cache dir under a name the asset protocol can serve. Leaves `tex.file` empty
/// when nothing matches, which the viewer reports rather than drawing a mesh
/// with no texture and no explanation.
fn resolve_texture(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    format: &str,
    teamtex: &[String],
    cache: Option<(&Path, &str)>,
    tex: &mut ModelTexture,
) {
    // A resolved palette entry was already given its colour when the model was
    // flattened, straight out of the archive's own palette table rather than
    // this lookup, so there is no archive member to find for it here.
    if tex.palette_colour.is_some() {
        return;
    }
    if format == "3do" && teamtex.contains(&tex.name.trim().to_lowercase()) {
        tex.team_colour = true;
        return;
    }
    let Some(actual) = locate_texture(list, format, teamtex, &tex.name) else {
        return;
    };
    tex.source = actual.clone();

    let Some((dir, base)) = cache else { return };
    let ext = actual.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let file = cache_file_name(base, &actual, ext);
    let dest = dir.join(&file);
    // Written once per archive and texture: the same atlas is shared by
    // hundreds of units, and it can be 64 MiB.
    if dest.is_file() {
        tex.file = file;
        return;
    }
    let Some((_, bytes)) = us.read_archive_member(handle, &actual, TEXTURE_READ_CAP) else {
        return;
    };
    let _ = std::fs::create_dir_all(dir);
    let payload = to_webview_format(ext, &bytes, format == "s3o");
    if std::fs::write(&dest, payload.as_deref().unwrap_or(&bytes)).is_ok() {
        tex.file = file;
    }
}

/// Re-encode a texture the webview cannot decode, or `None` to write the bytes
/// through untouched.
///
/// `.bmp` and `.tga` are most of what the legacy games ship, 358 and 192 files
/// respectively in Balanced Annihilation. `.tif` is rarer and matters more:
/// macOS's webview decodes one and Windows's and Linux's do not, so before this
/// covered them Basically OTA's `CORE_T1_BOT_Crasher` drew painted on one
/// platform and bare on the other two (issue #1915).
///
/// Which formats those are is [`coilbox_texture::needs_webview_transcode`], so the
/// unit builder's texture store answers the question the same way. `.pcx` is the
/// worker's own addition: no game ships a model texture in one, but the archive
/// preview reads build pics through here and every legacy game's are `.pcx`.
///
/// `keep_alpha` is whether the model is an `.s3o`, and it decides whether the
/// alpha channel survives. An `.s3o`'s first texture keeps the team-colour mask
/// there, so dropping it paints the whole unit in the player's colour. A `.3do`
/// keeps reflectivity there, which the engine moves into the second texture's
/// green and coilbox does not draw at all, so it goes.
///
/// Everything else passes through. `.dds` above all, because decoding a shared
/// 8192 square atlas would cost 256 MiB for one texture and the webview can
/// upload it compressed.
fn to_webview_format(ext: &str, bytes: &[u8], keep_alpha: bool) -> Option<Vec<u8>> {
    if !coilbox_texture::needs_webview_transcode(ext) && !ext.eq_ignore_ascii_case("pcx") {
        return None;
    }
    let img = crate::texture::decode_texture(ext, bytes)?;
    if keep_alpha {
        coilbox_texture::encode_png(&img)
    } else {
        coilbox_texture::encode_rgb_png(&image::DynamicImage::ImageRgba8(img).to_rgb8())
    }
}

/// The archive member a model's texture name means.
///
/// An `.s3o` names a file, extension included, under `unittextures/`. A `.3do`
/// names an entry in the atlas the engine packs out of `unittextures/tatex/`,
/// with no extension and with `00` appended unless the name is in `teamtex.txt`.
/// That suffix rule applies to an empty name too (issue #2610): the engine
/// does not treat it specially, so it becomes `"00"` and resolves to real
/// artwork, e.g. Balanced Annihilation's `unittextures/tatex/00.bmp`.
fn locate_texture(
    list: &[(String, String)],
    format: &str,
    teamtex: &[String],
    name: &str,
) -> Option<String> {
    let want = name.trim().replace('\\', "/").to_lowercase();
    if format == "3do" {
        // A name in `teamtex.txt` is a team-colour region, not artwork. The
        // file behind it is a flat magenta placeholder the engine paints over
        // with the player's colour, so there is nothing here worth reading.
        // `teamtex` never holds an empty entry (`read_teamtex` filters blank
        // lines), so an empty `want` always falls through to the suffix rule.
        if teamtex.contains(&want) {
            return None;
        }
        return find_with_ext(list, TATEX_DIR, &format!("{want}00"));
    }
    if want.is_empty() {
        return None;
    }
    // Named with its extension, which is the normal case.
    if let Some(hit) = find_member(list, &format!("{S3O_TEXTURE_DIR}/{want}")) {
        return Some(hit);
    }
    // Named with the wrong extension, which happens when a game reskins a model
    // from `.tga` to `.dds` without rewriting its headers.
    let stem = want.rsplit_once('.').map(|(s, _)| s).unwrap_or(&want);
    find_with_ext(list, S3O_TEXTURE_DIR, stem)
}

/// Find `<dir>/<stem>.<ext>` for the first extension that exists.
pub(crate) fn find_with_ext(list: &[(String, String)], dir: &str, stem: &str) -> Option<String> {
    TEXTURE_EXTS
        .iter()
        .find_map(|ext| find_member(list, &format!("{dir}/{stem}.{ext}")))
}

/// Find an archive member whose path equals or ends with `/<target_lc>`
/// (case-insensitive). Mirrors the build-pic and sidepic resolvers.
pub(crate) fn find_member(list: &[(String, String)], target_lc: &str) -> Option<String> {
    let suffix = format!("/{target_lc}");
    list.iter()
        .find(|(lower, _)| lower == target_lc || lower.ends_with(&suffix))
        .map(|(_, real)| real.clone())
}

// ---------------------------------------------------------------- cache

/// Cheap, stable per-game cache identity (path + size + mtime + version salt).
/// Mirrors `factionlogo::cache_key_base`.
pub(crate) fn cache_key_base(us: &Unitsync, archive_name: &str) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let dir = us.archive_path(archive_name)?;
    let path = Path::new(&dir).join(archive_name);
    let md = std::fs::metadata(&path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// The cache file for one archive member:
/// `v<CACHE_VERSION>-<gamekey>_<sanitised path>.<ext>`. One flat segment,
/// because the asset protocol's root for these serves a single folder. The
/// extension is the one the file is written in, which is not the source's when
/// it was transcoded, so the webview can pick a loader from it and the asset
/// protocol can put a content type on it.
///
/// Every extension [`to_webview_format`] re-encodes is listed here. A file
/// written as PNG under its source's name is served as an octet stream, and a
/// webview that sniffs it anyway is doing us a favour rather than being asked.
///
/// The extension the archive gives is the artist's own case, and 1086 of the
/// installed games' 1680 `.bmp` textures are spelled `.BMP`. Every one of those
/// was written through raw while its lower-case neighbour was re-encoded, so the
/// name is settled in lower case before anything is decided from it.
///
/// The `v<CACHE_VERSION>-` prefix is spelled out in the clear rather than left
/// folded into `base`'s hash, so the startup sweep (issue #1919) can tell a
/// current file from an orphan by string comparison alone, with no archive to
/// open and no hash to recompute.
pub(crate) fn cache_file_name(base: &str, member: &str, source_ext: &str) -> String {
    let lower = member.to_lowercase();
    let source_ext = source_ext.to_lowercase();
    // `source_ext` comes from `rsplit_once('.')` on the archive member's own
    // path, which can never hold a dot but can hold a `/`, `\` or `:`: a slash
    // sends the write to a directory that does not exist, and a colon fails
    // outright on Windows and picks an NTFS alternate data stream elsewhere.
    // Sanitised the same way `safe` below sanitises the stem.
    let ext = if !source_ext.is_empty() && source_ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        match source_ext.as_str() {
            "bmp" | "tga" | "tif" | "tiff" | "pcx" => "png".to_string(),
            other => other.to_string(),
        }
    } else {
        "bin".to_string()
    };
    let safe: String = lower
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("v{CACHE_VERSION}-{base}_{safe}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(paths: &[&str]) -> Vec<(String, String)> {
        paths
            .iter()
            .map(|p| (p.to_lowercase(), p.to_string()))
            .collect()
    }

    /// `CModelLoader::FindModelPath` (`rts/Rendering/Models/IModelParser.cpp`)
    /// walks `parsers` in registration order, and `RegisterModelFormats`
    /// registers `3do` before `s3o`, so a name that resolves to both is drawn
    /// by the engine as a `.3do`.
    #[test]
    fn objectname_without_extension_prefers_3do() {
        let list = listing(&["Objects3D/armcom.s3o", "Objects3D/armcom.3do"]);
        assert_eq!(
            find_model(&list, "ARMCOM").as_deref(),
            Some("Objects3D/armcom.3do")
        );
    }

    #[test]
    fn objectname_without_extension_falls_back_to_s3o() {
        let list = listing(&["Objects3D/ARMCOM.s3o"]);
        assert_eq!(
            find_model(&list, "ARMCOM").as_deref(),
            Some("Objects3D/ARMCOM.s3o")
        );
    }

    #[test]
    fn objectname_is_found_in_a_subfolder() {
        let list = listing(&["Objects3D/units/goldtree.s3o"]);
        assert_eq!(
            find_model(&list, "goldtree").as_deref(),
            Some("Objects3D/units/goldtree.s3o")
        );
    }

    #[test]
    fn objectname_with_a_windows_path_resolves() {
        let list = listing(&["Objects3D/units/goldtree.s3o"]);
        assert_eq!(
            find_model(&list, "units\\GoldTree.s3o").as_deref(),
            Some("Objects3D/units/goldtree.s3o")
        );
    }

    #[test]
    fn a_model_outside_objects3d_is_not_a_model() {
        let list = listing(&["scripts/armcom.s3o"]);
        assert_eq!(find_model(&list, "armcom"), None);
    }

    /// What the archive browser asks with: the member it is showing. The one it
    /// clicked, not the one of that name the suffix search would find first.
    #[test]
    fn a_whole_member_path_resolves_to_that_member() {
        let list = listing(&[
            "Objects3D/units/tree.s3o",
            "Objects3D/features/tree.s3o",
            "Objects3D/armcom.3do",
        ]);
        assert_eq!(
            find_model(&list, "Objects3D/features/tree.s3o").as_deref(),
            Some("Objects3D/features/tree.s3o")
        );
        assert_eq!(
            find_model(&list, "objects3d/armcom.3do").as_deref(),
            Some("Objects3D/armcom.3do")
        );
    }

    /// A model an archive keeps outside `objects3d/` is still a file somebody
    /// can click, so previewing it works even though no unitdef could name it.
    #[test]
    fn a_whole_member_path_resolves_outside_objects3d() {
        let list = listing(&["scripts/armcom.s3o"]);
        assert_eq!(
            find_model(&list, "scripts/armcom.s3o").as_deref(),
            Some("scripts/armcom.s3o")
        );
    }

    /// The whole-path match only ever fires for a name that is already a model
    /// file, so an `objectname` cannot reach a member of some other kind that
    /// happens to be spelled the same.
    #[test]
    fn a_whole_path_match_needs_a_model_extension() {
        let list = listing(&["Objects3D/armcom.s3o", "scripts/armcom"]);
        assert_eq!(
            find_model(&list, "scripts/armcom").as_deref(),
            Some("Objects3D/armcom.s3o")
        );
    }

    /// A `.3do` face's name gets `00` appended. A name `teamtex.txt` claims is
    /// a team-colour region, and its file is a magenta placeholder worth
    /// nothing, so it resolves to no texture at all.
    #[test]
    fn tatex_names_take_the_suffix_unless_teamtex_claims_them() {
        let list = listing(&[
            "unittextures/tatex/arm01a00.tga",
            "unittextures/tatex/arm32lt.bmp",
        ]);
        let teamtex = vec!["arm32lt".to_string()];
        assert_eq!(
            locate_texture(&list, "3do", &teamtex, "ARM01A").as_deref(),
            Some("unittextures/tatex/arm01a00.tga")
        );
        assert_eq!(locate_texture(&list, "3do", &teamtex, "Arm32Lt"), None);
    }

    #[test]
    fn an_s3o_texture_resolves_by_name_then_by_stem() {
        let list = listing(&[
            "unittextures/lego2skin_explorer.dds",
            "UnitTextures/armcom.dds",
        ]);
        assert_eq!(
            locate_texture(&list, "s3o", &[], "lego2skin_explorer.dds").as_deref(),
            Some("unittextures/lego2skin_explorer.dds")
        );
        // Header says `.tga`, archive ships `.dds`.
        assert_eq!(
            locate_texture(&list, "s3o", &[], "armcom.tga").as_deref(),
            Some("UnitTextures/armcom.dds")
        );
        assert_eq!(locate_texture(&list, "s3o", &[], "missing.dds"), None);
    }

    #[test]
    fn cache_file_name_is_one_flat_segment_keeping_the_extension() {
        let name = cache_file_name("abcd", "UnitTextures/Lego Skin.DDS", "DDS");
        assert_eq!(
            name,
            format!("v{CACHE_VERSION}-abcd_unittextures_lego_skin_dds.dds")
        );
        assert!(!name.contains('/'));
    }

    /// The sweep in `tauri-plugin-coilbox-unitsync/src/modelcache.rs` tells a
    /// current file from an orphan by this exact prefix, so it has to be at the
    /// front of the name and it has to spell the real constant.
    #[test]
    fn cache_file_name_starts_with_the_literal_cache_version() {
        let name = cache_file_name("abcd", "unittextures/skin.dds", "dds");
        assert!(
            name.starts_with(&format!("v{CACHE_VERSION}-")),
            "got: {name}"
        );
    }

    /// A transcoded texture is named for what it was written as, not what it
    /// came from, so the webview picks a loader that can read it and the asset
    /// protocol puts an image content type on it.
    #[test]
    fn a_transcoded_texture_is_named_png() {
        assert_eq!(
            cache_file_name("abcd", "unittextures/tatex/glow00.bmp", "bmp"),
            format!("v{CACHE_VERSION}-abcd_unittextures_tatex_glow00_bmp.png")
        );
        assert_eq!(
            cache_file_name("abcd", "unittextures/tatex/arm01a00.tga", "tga"),
            format!("v{CACHE_VERSION}-abcd_unittextures_tatex_arm01a00_tga.png")
        );
        // Every extension `to_webview_format` re-encodes belongs on the list, in
        // whichever case the artist happened to save it in.
        for ext in ["tif", "tiff", "pcx", "BMP", "TGA", "TIF"] {
            let name = cache_file_name("abcd", &format!("unittextures/skin.{ext}"), ext);
            assert!(name.ends_with(".png"), "got: {name}");
        }
    }

    /// The whole point of the cache (issue #1676): the second model to draw
    /// with an atlas does not read it again. Splinter Faction is 158 units on
    /// one 64 MiB `.dds`, so this is the difference between 64 MiB of reads and
    /// 10 GB of them.
    #[test]
    fn a_texture_a_second_model_draws_with_is_not_read_again() {
        let reads = RefCell::new(Vec::<String>::new());
        let mut cache = TextureCache::new(1024);
        let mut read = |member: &str| {
            cache.get(member, || {
                reads.borrow_mut().push(member.to_string());
                Some(vec![7u8; 16])
            })
        };

        assert_eq!(read("unittextures/atlas.dds").unwrap().len(), 16);
        assert_eq!(read("unittextures/atlas.dds").unwrap().len(), 16);
        assert_eq!(read("unittextures/other.dds").unwrap().len(), 16);
        assert_eq!(read("unittextures/atlas.dds").unwrap().len(), 16);
        assert_eq!(
            *reads.borrow(),
            vec!["unittextures/atlas.dds", "unittextures/other.dds"]
        );
    }

    /// The identity rests on the cache handing back the bytes the archive gave,
    /// so a hit and a miss are the same digest input. A cache that returned the
    /// wrong member's bytes would move every digest that touched it, and every
    /// render already uploaded would become unreachable.
    #[test]
    fn a_hit_returns_the_bytes_that_member_was_read_as() {
        let mut cache = TextureCache::new(1024);
        let read = |bytes: &'static [u8]| move || Some(bytes.to_vec());
        assert_eq!(*cache.get("a.dds", read(b"aaa")).unwrap(), b"aaa".to_vec());
        assert_eq!(*cache.get("b.dds", read(b"bb")).unwrap(), b"bb".to_vec());
        // Both again, with a reader that would give the wrong answer if it ran.
        assert_eq!(*cache.get("a.dds", read(b"xxx")).unwrap(), b"aaa".to_vec());
        assert_eq!(*cache.get("b.dds", read(b"yy")).unwrap(), b"bb".to_vec());
    }

    /// A texture that did not read is not remembered as missing, so a caller
    /// asking again pays a lookup rather than getting a stale "no".
    #[test]
    fn a_member_that_does_not_read_holds_nothing() {
        let mut cache = TextureCache::new(1024);
        assert!(cache.get("gone.dds", || None).is_none());
        assert_eq!(cache.entries.len(), 0);
        assert_eq!(cache.bytes, 0);
    }

    /// The bound on what a batch holds. Without it a game with hundreds of
    /// distinct unit textures would keep every one of them for the length of the
    /// run, which is a roster's worth of art resident to digest a roster.
    #[test]
    fn the_cache_evicts_the_least_recently_used_once_it_is_over_budget() {
        let mut cache = TextureCache::new(100);
        let read = |n: usize| move || Some(vec![0u8; n]);
        cache.get("a", read(40));
        cache.get("b", read(40));
        // Touching `a` makes `b` the least recently used one.
        cache.get("a", read(40));
        cache.get("c", read(40));
        assert_eq!(cache.bytes, 80);
        let held: Vec<&str> = cache.entries.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(held, vec!["a", "c"]);

        // A texture bigger than the whole budget is still handed back rather
        // than read and thrown away.
        assert_eq!(cache.get("huge", read(500)).unwrap().len(), 500);
        assert_eq!(cache.bytes, 500);
    }

    /// Only the formats a webview cannot read are re-encoded. A `.dds` above
    /// all must reach the GPU still compressed.
    #[test]
    fn only_the_legacy_formats_are_transcoded() {
        assert!(to_webview_format("dds", b"not really a dds", true).is_none());
        assert!(to_webview_format("png", b"not really a png", true).is_none());
        assert!(to_webview_format("jpg", b"not really a jpeg", true).is_none());
        // Undecodable bytes fall through to being written as they are, rather
        // than the texture going missing.
        assert!(to_webview_format("bmp", b"not really a bmp", true).is_none());
        assert!(to_webview_format("pcx", b"not really a pcx", true).is_none());
    }

    /// The archive spells an extension however the artist saved it, and 1086 of
    /// the installed games' 1680 `.bmp` textures are `.BMP`. Every one of those
    /// used to be written through raw (issue #1915).
    #[test]
    fn an_upper_case_extension_is_transcoded_like_any_other() {
        let png = to_webview_format("TGA", &tga_rgba(), true).expect("a .TGA is transcoded");
        assert_eq!(
            image::load_from_memory(&png)
                .expect("the output is a png")
                .color(),
            image::ColorType::Rgba8
        );
    }

    /// One 2 by 1 uncompressed 32-bit TGA: an opaque red pixel and a
    /// transparent green one. Written bottom-up, which is what the games ship.
    fn tga_rgba() -> Vec<u8> {
        let mut raw = vec![0u8; 18];
        raw[2] = 2; // uncompressed true colour
        raw[12] = 2; // width
        raw[14] = 1; // height
        raw[16] = 32; // bits a pixel
        raw[17] = 8; // eight alpha bits
        raw.extend_from_slice(&[0, 0, 0xff, 0xff]); // BGRA: opaque red
        raw.extend_from_slice(&[0, 0xff, 0, 0x00]); // BGRA: transparent green
        raw
    }

    /// The team-colour mask an `.s3o` keeps in its first texture's alpha, which
    /// is the whole reason a unit has markings rather than being painted in the
    /// player's colour from end to end.
    #[test]
    fn an_s3o_texture_keeps_its_alpha_through_the_transcode() {
        let png = to_webview_format("tga", &tga_rgba(), true).expect("a tga is transcoded");
        let img = image::load_from_memory(&png).expect("the output is a png");
        assert_eq!(img.color(), image::ColorType::Rgba8);
        let rgba = img.to_rgba8();
        assert_eq!(rgba.get_pixel(0, 0).0, [0xff, 0, 0, 0xff]);
        assert_eq!(rgba.get_pixel(1, 0).0, [0, 0xff, 0, 0x00]);
    }

    /// A `.3do` keeps reflectivity in the same channel, and coilbox draws no
    /// reflections, so the alpha is dead weight on every legacy game's atlas.
    #[test]
    fn a_3do_texture_drops_its_alpha() {
        let png = to_webview_format("tga", &tga_rgba(), false).expect("a tga is transcoded");
        let img = image::load_from_memory(&png).expect("the output is a png");
        assert_eq!(img.color(), image::ColorType::Rgb8);
    }

    /// A `.pcx` model texture is the third format of the legacy era, and a
    /// webview renders it no better than the other two.
    #[test]
    fn a_pcx_texture_is_re_encoded_as_png() {
        // One red pixel: a 128-byte header then three 8-bit planes. 0xff cannot
        // travel as a literal, so the red plane goes out as a run of one.
        let mut raw = vec![0u8; 128];
        raw[0] = 0x0a;
        raw[1] = 5;
        raw[2] = 1;
        raw[3] = 8;
        raw[65] = 3;
        raw[66] = 1;
        raw.extend_from_slice(&[0xc1, 0xff, 0x00, 0x00]);

        let png = to_webview_format("pcx", &raw, false).expect("a pcx is transcoded");
        let img = image::load_from_memory(&png).expect("the output is a png");
        assert_eq!(img.to_rgba8().get_pixel(0, 0).0, [0xff, 0, 0, 255]);
    }

    /// A `.tif` is the format that made this a platform bug rather than a bug:
    /// macOS's webview decodes one and the other two do not, so Basically OTA's
    /// `CORE_T1_BOT_Crasher` drew painted here and bare there (issue #1915).
    /// Alpha survives, because both its textures are `.tif` and the engine reads
    /// the second one's alpha as the unit's cut-out mask.
    #[test]
    fn a_tif_texture_is_re_encoded_as_png_with_its_alpha() {
        let mut src = image::RgbaImage::from_pixel(2, 1, image::Rgba([0xff, 0, 0, 0xff]));
        src.put_pixel(1, 0, image::Rgba([0, 0xff, 0, 0x00]));
        let mut tiff = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(src)
            .write_to(&mut tiff, image::ImageFormat::Tiff)
            .expect("encode a tiff");
        let tiff = tiff.into_inner();

        let png = to_webview_format("tif", &tiff, true).expect("a tif is transcoded");

        let img = image::load_from_memory(&png).expect("the output is a png");
        assert_eq!(img.color(), image::ColorType::Rgba8);
        let rgba = img.to_rgba8();
        assert_eq!(rgba.get_pixel(0, 0).0, [0xff, 0, 0, 0xff]);
        assert_eq!(rgba.get_pixel(1, 0).0[3], 0x00);
        // Both spellings, and undecodable bytes still fall through to being
        // written as they arrived rather than the texture going missing.
        assert!(to_webview_format("tiff", &tiff, true).is_some());
        assert!(to_webview_format("tif", b"II not really a tiff", true).is_none());
    }

    #[test]
    fn cache_file_name_passes_a_normal_extension_through_lower_cased() {
        let name = cache_file_name("abc123", "unittextures/skin.PNG", "PNG");
        assert!(name.ends_with(".png"), "got: {name}");
    }

    /// A zip entry named `unittextures/logo.png/x` gives `rsplit_once('.')` an
    /// extension of `png/x`. Written unchanged it would send the cache write to
    /// a directory that does not exist, so the file is never written and the
    /// texture never appears.
    #[test]
    fn cache_file_name_falls_back_to_bin_for_an_extension_with_a_slash() {
        let name = cache_file_name("abc123", "unittextures/logo.png/x", "png/x");
        assert!(name.ends_with(".bin"), "got: {name}");
        assert!(!name.contains('/'), "got: {name}");
    }

    /// A zip entry named `unittextures/skin.d:ds` gives an extension of `d:ds`.
    /// A colon fails outright on Windows, and on NTFS a colon in the middle of a
    /// name selects an alternate data stream rather than the file.
    #[test]
    fn cache_file_name_falls_back_to_bin_for_an_extension_with_a_colon() {
        let name = cache_file_name("abc123", "unittextures/skin.d:ds", "d:ds");
        assert!(name.ends_with(".bin"), "got: {name}");
        assert!(!name.contains(':'), "got: {name}");
    }

    // ------------------------------------------------------- palette

    fn a_palette() -> coilbox_3do::Palette {
        let mut palette = [[0u8; 3]; 256];
        palette[3] = [10, 20, 30];
        palette
    }

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

    fn a_piece(primitives: Vec<coilbox_3do::Primitive>) -> coilbox_3do::Piece {
        coilbox_3do::Piece {
            name: "body".into(),
            offset: [0.0, 0.0, 0.0],
            vertices: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 1.0]],
            primitives,
            children: Vec::new(),
        }
    }

    #[test]
    fn resolve_palette_entry_reads_the_table_by_index() {
        let palette = a_palette();
        assert_eq!(resolve_palette_entry(Some(&palette), 3), Some([10, 20, 30]));
    }

    #[test]
    fn resolve_palette_entry_refuses_a_negative_or_out_of_range_index() {
        let palette = a_palette();
        assert_eq!(resolve_palette_entry(Some(&palette), -1), None);
        assert_eq!(resolve_palette_entry(Some(&palette), 256), None);
    }

    #[test]
    fn resolve_palette_entry_refuses_with_no_table_at_all() {
        assert_eq!(resolve_palette_entry(None, 3), None);
    }

    /// The specimen this issue is about: a face naming a palette entry the
    /// table holds draws in that entry's colour, batched under its own
    /// synthetic texture rather than the grey placeholder.
    #[test]
    fn a_resolved_palette_face_is_drawn_in_its_own_colour_and_not_counted() {
        let palette = a_palette();
        let model = coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: a_piece(vec![palette_face(3)]),
        };

        let out = from_3do("objects3d/armcom.3do", &model, Some(&palette));

        assert_eq!(out.palette_faces, 0);
        let group = &out.root.expect("root").groups[0];
        assert_eq!(group.texture.as_deref(), Some("/palette/3"));
        let texture = out
            .textures
            .iter()
            .find(|t| t.name == "/palette/3")
            .expect("the resolved entry is in the texture list");
        assert_eq!(texture.palette_colour, Some([10, 20, 30]));
        assert!(texture.source.is_empty(), "nothing in the archive backs it");
    }

    /// An index the table does not have, either because there is no
    /// `palette.pal` in the archive or the file names an entry past 255, is
    /// still drawn plain and still counted, exactly as an untextured face
    /// always has been.
    #[test]
    fn an_unresolved_palette_face_falls_back_to_the_grey_placeholder_and_is_counted() {
        let model = coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: a_piece(vec![palette_face(9)]),
        };

        let out = from_3do("objects3d/armcom.3do", &model, None);

        assert_eq!(out.palette_faces, 1);
        let group = &out.root.expect("root").groups[0];
        assert_eq!(group.texture, None);
        assert!(out.textures.is_empty());
    }

    /// A face naming an empty string is not the same as one naming nothing at
    /// all (issue #2610): it gets its own texture entry and batch, same as a
    /// real name would, rather than falling into the untextured (`None`)
    /// group above.
    #[test]
    fn an_empty_named_face_gets_its_own_texture_entry() {
        let model = coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: a_piece(vec![named_face("")]),
        };

        let out = from_3do("objects3d/armcom.3do", &model, None);

        assert_eq!(out.palette_faces, 0);
        let group = &out.root.expect("root").groups[0];
        assert_eq!(group.texture.as_deref(), Some(""));
        assert_eq!(out.textures.len(), 1);
        assert_eq!(out.textures[0].name, "");
    }

    /// Once resolution has run, an empty name is reported as `"00"`, the name
    /// it actually resolves to, rather than the blank the file stores
    /// (issue #2610). `ModelGroup::texture` is rewritten alongside
    /// `ModelTexture::name` so the viewer's own lookup between the two still
    /// lines up.
    #[test]
    fn rename_empty_textures_turns_a_blank_name_into_00() {
        let model = coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: a_piece(vec![named_face(""), named_face("arm2")]),
        };
        let mut out = from_3do("objects3d/armcom.3do", &model, None);

        rename_empty_textures(&mut out);

        assert!(
            out.textures.iter().all(|t| !t.name.is_empty()),
            "no texture name should ever be reported blank"
        );
        assert!(out.textures.iter().any(|t| t.name == "00"));
        assert!(out.textures.iter().any(|t| t.name == "arm2"));
        let groups = &out.root.expect("root").groups;
        assert!(groups.iter().any(|g| g.texture.as_deref() == Some("00")));
        assert!(groups.iter().any(|g| g.texture.as_deref() == Some("arm2")));
    }

    /// Two faces naming the same entry share one material rather than one
    /// each, the same way two faces naming the same real texture do.
    #[test]
    fn two_faces_sharing_a_palette_entry_share_one_texture() {
        let palette = a_palette();
        let model = coilbox_3do::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            base_plate_faces: 0,
            root: a_piece(vec![palette_face(3), palette_face(3)]),
        };

        let out = from_3do("objects3d/armcom.3do", &model, Some(&palette));

        assert_eq!(out.textures.len(), 1);
        assert_eq!(out.root.expect("root").groups.len(), 1);
    }
}
