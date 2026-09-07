//! `--convert-3do` mode: turn every `.3do` in a game into an `.s3o`, in one
//! mount, with one shared texture per model folder (issue #2573).
//!
//! Coilbox could already convert one model at a time, and gave that model a
//! sheet of its own. A Total Annihilation era game is hundreds of models, and
//! nobody is going to open them one at a time. A per model sheet is also the
//! wrong shape for a game even if they did: the engine binds one texture per
//! model, so 720 models with 720 sheets is 720 texture binds where one would
//! do.
//!
//! So the unit of work here is a folder rather than a model. Every `.3do`
//! directly or indirectly under one subfolder of `objects3d/` shares one sheet,
//! and the models at the top level share one more. That is how these games
//! group a faction, and the grouping is the whole point: one atlas per faction
//! is what the engine wants.
//!
//! ## What it writes
//!
//! An overlay shaped like a game, so the output can be dropped over one or into
//! an `.sdd` and simply work:
//!
//! ```text
//! objects3d/armcom.s3o            each model under its source name
//! objects3d/arm/somemech.s3o
//! unittextures/3do/objects3d.png  the sheet the top level models share
//! unittextures/3do/objects3d.json where every tile on it landed
//! unittextures/3do/objects3d-arm.png
//! unittextures/3do/objects3d-arm.json
//! ```
//!
//! The sheet goes under `unittextures/` rather than beside the models because
//! that is the only place an `.s3o`'s texture name resolves: `S3OParser`
//! prepends `unittextures/` and nothing else. A sheet written beside the models
//! would be a sheet no engine could find.
//!
//! ## Running it twice
//!
//! An `.s3o` stores coordinates, not tile names, so repacking a sheet moves
//! every tile out from under every model already written against it. A second
//! run therefore reads the sidecar the first one wrote and reuses those
//! rectangles whenever the sheet already holds every tile this run needs. Only
//! a run that needs a tile the old sheet has not got repacks, and then it
//! rewrites every model in the group.
//!
//! ## What it does not do
//!
//! No second texture. The engine reads that one's red as self illumination, its
//! green as reflectivity and its alpha as whether a pixel is drawn at all, and
//! a `.3do` carries none of the three. See `coilbox_3do_convert::to_s3o`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::ffi::Unitsync;
use crate::unitmodel::{
    find_with_ext, read_palette, read_teamtex, MODEL_DIR, MODEL_READ_CAP, TATEX_DIR,
    TEXTURE_READ_CAP,
};

/// Where the sheets go inside the output, under `unittextures/` so an `.s3o`'s
/// texture name resolves to them. A folder of their own rather than loose in
/// `unittextures/`, so an overlay dropped over a real game cannot land a sheet
/// on top of one of the game's own textures.
const SHEET_DIR: &str = "3do";

/// One converted game.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Convert3doOutput {
    /// Where everything was written.
    pub out_dir: String,
    /// One per model folder, in the order they were converted.
    pub groups: Vec<Group>,
    /// Models the reader refused, by archive member, with what it said. Kept
    /// apart from the models that did not fit on a sheet, because they are not
    /// the same problem: this one is a file coilbox cannot read, and that one is
    /// a file it read fine and had nowhere to paint.
    pub unreadable: BTreeMap<String, String>,
    /// Every `.3do` found under `objects3d/`.
    pub models_found: usize,
    /// How many became an `.s3o`.
    pub models_written: usize,
    pub errors: Vec<String>,
}

/// One model folder: its sheet and what happened to the models sharing it.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// The archive folder these came out of, as the archive spells it.
    pub folder: String,
    /// The sheet, as a path inside the output folder.
    pub atlas: String,
    /// And as the name the models' `texture1` gives, which is what the engine
    /// resolves against `unittextures/`.
    pub texture1: String,
    pub atlas_side: u32,
    /// Whether the sheet was the one an earlier run left, kept so the models it
    /// already painted stay correct.
    pub reused_atlas: bool,
    pub tiles_packed: usize,
    /// Tiles that would not fit on a sheet the size cap allows, least used
    /// first. Every model naming one of these is in `did_not_fit`.
    pub tiles_that_did_not_fit: Vec<String>,
    /// Tile names nothing in the archive matched, and how many models wanted
    /// each. Their faces come out flat grey.
    pub missing_textures: BTreeMap<String, usize>,
    /// Tile names the archive does hold and coilbox could not decode, with the
    /// archive member it found and how many models wanted it. Apart from the
    /// list above because they are opposite problems: one is a texture the game
    /// does not ship, and this is a texture it ships in a form coilbox cannot
    /// read. Reporting the second as the first sends somebody looking for a
    /// file that is right there.
    pub undecodable_textures: BTreeMap<String, Undecodable>,
    pub models_written: usize,
    /// Models left unconverted because a tile they name did not fit on the
    /// sheet. Named rather than counted: a run that quietly drops five units is
    /// far worse than one that says which five.
    pub did_not_fit: Vec<String>,
    /// Faces drawn in flat grey because their Total Annihilation palette entry
    /// resolved to nothing, which means either the game ships no `palette.pal`
    /// this could reach or the face names an entry past the 256 it holds. A face
    /// whose entry did resolve is drawn in its real colour and is not counted.
    pub palette_faces: usize,
    /// The models those faces are in.
    pub palette_models: Vec<String>,
    /// Faces drawn in the same flat grey for the second reason: the tile they
    /// named is not on the sheet. `missing_textures` says which tiles.
    pub missing_texture_faces: usize,
    pub vertices: usize,
    pub triangles: usize,
    /// Child pieces dropped as inert same-named duplicates. See
    /// `coilbox_3do_convert::is_dead_duplicate`.
    pub dropped_pieces: usize,
}

/// A tile the archive holds that would not decode.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Undecodable {
    pub member: String,
    pub wanted_by: usize,
}

/// A line printed as the run goes, so a conversion of hundreds of models is not
/// four silent minutes. The plugin reads these off the worker's stdout and
/// forwards them to the webview.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    /// `scan`, `atlas` or `model`.
    phase: &'a str,
    done: usize,
    total: usize,
    folder: &'a str,
    /// The archive member being worked on, empty for a phase that is not about
    /// one model.
    member: &'a str,
}

/// Print one progress line. A whole JSON object per line, so the reader can
/// tell a progress line from the final result by the key it carries and neither
/// needs a sentinel prefix.
fn report(progress: Progress<'_>) {
    if let Ok(line) = serde_json::to_string(&serde_json::json!({ "progress": progress })) {
        println!("{line}");
    }
}

/// Print a `Convert3doOutput` carrying only an error, on the panic path.
pub fn emit_error(msg: String) {
    let out = Convert3doOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// Convert every `.3do` in `game_archive` into `out_dir`.
pub fn render(lib: &str, game_archive: &str, out_dir: &Path) -> Convert3doOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return Convert3doOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let mut out = convert(&us, game_archive, out_dir);
    out.out_dir = out_dir.display().to_string();
    us.uninit();
    out
}

/// The run itself, against a session the caller has initialised.
fn convert(us: &Unitsync, game_archive: &str, out_dir: &Path) -> Convert3doOutput {
    let mut out = Convert3doOutput {
        errors: us.drain_errors(),
        ..Default::default()
    };

    if !us.add_all_archives(game_archive) {
        out.errors
            .push("this engine's libunitsync can't load game archives".into());
        return out;
    }
    out.errors.extend(us.drain_errors());

    let handle = crate::archive::resolve_open_path(us, game_archive)
        .as_deref()
        .and_then(|p| us.open_archive(p));
    let Some(handle) = handle else {
        us.remove_all_archives();
        out.errors
            .push(format!("could not open archive {game_archive}"));
        return out;
    };

    let list: Vec<(String, String)> = us
        .list_archive_files(handle)
        .into_iter()
        .map(|(path, _)| (path.to_lowercase(), path))
        .collect();
    let teamtex = read_teamtex(us, handle, &list);
    let palette = read_palette(us);

    let groups = plan(&list);
    out.models_found = groups.iter().map(|g| g.members.len()).sum();
    report(Progress {
        phase: "scan",
        done: 0,
        total: out.models_found,
        folder: "",
        member: "",
    });

    let mut done = 0usize;
    for group in &groups {
        match convert_group(
            us,
            handle,
            &list,
            &teamtex,
            palette.as_ref(),
            &group.folder,
            &group.stem,
            &group.members,
            out_dir,
            &mut done,
            out.models_found,
            &mut out.unreadable,
        ) {
            Ok(group) => {
                out.models_written += group.models_written;
                out.groups.push(group);
            }
            Err(e) => out.errors.push(e),
        }
    }

    us.close_archive(handle);
    out.errors.extend(us.drain_errors());
    us.remove_all_archives();
    out
}

/// One folder of models and the sheet they will share.
struct Planned {
    /// The first path segment below `objects3d/`, empty for the top level.
    folder: String,
    /// What the sheet is filed under, unique across the run.
    stem: String,
    members: Vec<String>,
}

/// What the run is about to do: every folder of models, and the name its sheet
/// goes under.
///
/// The naming happens here rather than inside the loop because telling two
/// folders apart is a question about the whole set of them, and a folder
/// considered on its own has nothing to be told apart from.
fn plan(list: &[(String, String)]) -> Vec<Planned> {
    let groups = group_models(list);
    let mut names = sheet_names(groups.keys().cloned());
    groups
        .into_iter()
        .map(|(folder, members)| Planned {
            stem: names.remove(&folder).unwrap_or_else(|| sheet_stem(&folder)),
            folder,
            members,
        })
        .collect()
}

/// Every `.3do` under `objects3d/`, keyed by the folder whose models share a
/// sheet.
///
/// The key is the first path segment below `objects3d/`, or the empty string for
/// a model sitting at the top level. A model deeper than one level down shares
/// its top folder's sheet and keeps its own path on the way out, because "one
/// atlas per subfolder" is about how a game groups a faction and a game that
/// nests further has not made a second faction by doing so.
fn group_models(list: &[(String, String)]) -> BTreeMap<String, Vec<String>> {
    let prefix = format!("{MODEL_DIR}/");
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (lower, real) in list {
        let Some(rest) = lower.strip_prefix(&prefix) else {
            continue;
        };
        if !rest.ends_with(".3do") {
            continue;
        }
        let folder = match rest.split_once('/') {
            Some((first, _)) => first.to_string(),
            None => String::new(),
        };
        groups.entry(folder).or_default().push(real.clone());
    }
    for members in groups.values_mut() {
        members.sort();
    }
    groups
}

/// The file name a folder's sheet is written under, without an extension.
///
/// `objects3d` for the models at the top level, `objects3d-<folder>` for a
/// subfolder. Injective, because prefixing every subfolder's name means no
/// subfolder can produce the top level's name and no two produce each other's.
/// Then sanitised, which is not injective, so the caller dedupes what comes back
/// (see [`sheet_names`]).
fn sheet_stem(folder: &str) -> String {
    let raw = if folder.is_empty() {
        MODEL_DIR.to_string()
    } else {
        format!("{MODEL_DIR}-{folder}")
    };
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// A sheet name per folder, with any two that sanitise to the same string told
/// apart by a number.
///
/// Two folders called `a b` and `a-b` both sanitise to `a-b`, and a sheet
/// written twice under one name would leave half the models painted with the
/// other half's tiles.
fn sheet_names(folders: impl IntoIterator<Item = String>) -> BTreeMap<String, String> {
    let mut taken: BTreeSet<String> = BTreeSet::new();
    let mut out = BTreeMap::new();
    for folder in folders {
        let stem = sheet_stem(&folder);
        let mut name = stem.clone();
        let mut n = 2;
        while !taken.insert(name.clone()) {
            name = format!("{stem}-{n}");
            n += 1;
        }
        out.insert(folder, name);
    }
    out
}

/// Convert one folder's models against one sheet.
#[allow(clippy::too_many_arguments)]
fn convert_group(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    teamtex: &[String],
    palette: Option<&coilbox_3do::Palette>,
    folder: &str,
    stem: &str,
    members: &[String],
    out_dir: &Path,
    done: &mut usize,
    total: usize,
    unreadable: &mut BTreeMap<String, String>,
) -> Result<Group, String> {
    let mut group = Group {
        folder: if folder.is_empty() {
            MODEL_DIR.to_string()
        } else {
            format!("{MODEL_DIR}/{folder}")
        },
        atlas: format!("unittextures/{SHEET_DIR}/{stem}.png"),
        texture1: format!("{SHEET_DIR}/{stem}.png"),
        ..Default::default()
    };

    // Pass one: what does this folder ask for? Reading every model twice costs
    // a parse rather than the memory of holding a whole game's geometry at
    // once, which on Metal Factions is 1532 models.
    let mut wanted: BTreeMap<String, usize> = BTreeMap::new();
    let mut entries: BTreeSet<i32> = BTreeSet::new();
    let mut readable: Vec<String> = Vec::new();
    for member in members {
        let Some(model) = read_3do(us, handle, member, unreadable) else {
            *done += 1;
            continue;
        };
        for name in coilbox_3do_convert::tile_names(&model) {
            *wanted.entry(name).or_default() += 1;
        }
        entries.extend(coilbox_3do_convert::palette_entries(&model));
        readable.push(member.clone());
    }

    report(Progress {
        phase: "atlas",
        done: *done,
        total,
        folder: &group.folder,
        member: "",
    });

    // Every tile name the folder asks for, and where it is in the archive.
    // `wanted` stays keyed by the raw name (`load_tile` needs it unchanged to
    // compute the engine's `00` suffix), but a name reported below is renamed
    // first: an empty one is not a texture nobody names, it is "00" (issue
    // #2610), and the report should never print a blank.
    let mut tiles: Vec<coilbox_3do_convert::Tile> = Vec::new();
    for (name, uses) in &wanted {
        let reported = if name.is_empty() {
            coilbox_3do::EMPTY_TEXTURE_NAME
        } else {
            name.as_str()
        };
        match load_tile(us, handle, list, teamtex, name) {
            Ok(tile) => tiles.push(tile),
            Err(None) => {
                group.missing_textures.insert(reported.to_string(), *uses);
            }
            Err(Some(member)) => {
                group.undecodable_textures.insert(
                    reported.to_string(),
                    Undecodable {
                        member,
                        wanted_by: *uses,
                    },
                );
            }
        }
    }
    tiles.extend(palette_tiles(&entries, palette));

    let sheet_path = out_dir.join(&group.atlas);
    let record_path = sheet_path.with_extension("json");
    let held: Vec<&str> = tiles.iter().map(|t| t.name.as_str()).collect();

    // A sheet an earlier run left, if it still holds everything this one needs.
    // Reusing it is what keeps the models that run already wrote correct.
    let reused = std::fs::read(&record_path)
        .ok()
        .and_then(|bytes| coilbox_3do_convert::Sheet::read(&bytes).ok())
        .filter(|sheet| sheet.covers(held.iter().copied()) && sheet_path.is_file());

    let (rects, side) = match reused {
        Some(sheet) => {
            group.reused_atlas = true;
            group.tiles_packed = sheet.tiles.len();
            let side = sheet.side;
            (sheet.rects(), side)
        }
        None => {
            let (packed, dropped) = pack_what_fits(tiles, &wanted);
            let packed =
                packed.map_err(|e| format!("could not build a sheet for {folder}: {e}"))?;
            group.tiles_packed = packed.rects.len();
            group.tiles_that_did_not_fit = dropped;
            let side = packed.image.width();
            let png = coilbox_texture::encode_png(&packed.image)
                .ok_or_else(|| format!("could not encode the sheet for {folder}"))?;
            let record = coilbox_3do_convert::Sheet::of(
                &packed,
                sheet_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default(),
            )
            .write()?;
            write_file(&sheet_path, &png)?;
            write_file(&record_path, &record)?;
            (packed.rects, side)
        }
    };
    group.atlas_side = side;

    // Pass two: convert.
    for member in &readable {
        *done += 1;
        report(Progress {
            phase: "model",
            done: *done,
            total,
            folder: &group.folder,
            member,
        });
        let Some(model) = read_3do(us, handle, member, unreadable) else {
            continue;
        };
        let short = member.rsplit('/').next().unwrap_or(member).to_string();
        if let Some(missing) = coilbox_3do_convert::tile_names(&model)
            .into_iter()
            .find(|name| group.tiles_that_did_not_fit.contains(name))
        {
            // `tiles_that_did_not_fit` stays raw-keyed above, for the match
            // against `tile_names`'s own raw output. Renamed here, since this
            // is the point it turns into a message somebody reads.
            let missing = if missing.is_empty() {
                coilbox_3do::EMPTY_TEXTURE_NAME
            } else {
                missing.as_str()
            };
            group
                .did_not_fit
                .push(format!("{short} (needs {missing}, which did not fit)"));
            continue;
        }

        let converted = match coilbox_3do_convert::to_s3o(&model, &rects, &group.texture1) {
            Ok(converted) => converted,
            Err(e) => {
                unreadable.insert(member.clone(), e);
                continue;
            }
        };
        let bytes = match coilbox_s3o::write(&converted.model) {
            Ok(bytes) => bytes,
            Err(e) => {
                unreadable.insert(member.clone(), e.to_string());
                continue;
            }
        };
        write_file(&out_dir.join(out_member(member)), &bytes)?;

        group.models_written += 1;
        group.vertices += converted.vertices;
        group.triangles += converted.triangles;
        group.dropped_pieces += converted.dropped_pieces;
        group.missing_texture_faces += converted.missing_texture_faces;
        let unresolved = converted.palette_faces - converted.missing_texture_faces;
        if unresolved > 0 {
            group.palette_faces += unresolved;
            group.palette_models.push(short);
        }
    }

    Ok(group)
}

/// Where a converted model goes inside the output: the member's own path with
/// its extension changed, so `objects3d/arm/x.3do` lands at
/// `objects3d/arm/x.s3o` and a unitdef naming `arm/x` still finds it.
fn out_member(member: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for segment in member.split('/') {
        path.push(segment);
    }
    path.set_extension("s3o");
    path
}

/// Read and parse one model, recording why not if it will not.
fn read_3do(
    us: &Unitsync,
    handle: i32,
    member: &str,
    unreadable: &mut BTreeMap<String, String>,
) -> Option<coilbox_3do::Model> {
    let Some((_, bytes)) = us.read_archive_member(handle, member, MODEL_READ_CAP) else {
        unreadable.insert(
            member.to_string(),
            "could not be read out of the archive".into(),
        );
        return None;
    };
    match coilbox_3do::read(&bytes) {
        Ok(model) => Some(model),
        Err(e) => {
            unreadable.insert(member.to_string(), e.to_string());
            None
        }
    }
}

/// One tile, decoded and with its alpha set to what an `.s3o` reads there.
///
/// Both engine model shaders read `mix(texColor1.rgb, teamCol.rgb,
/// texColor1.a)`, so alpha of one is entirely the player's colour and alpha of
/// zero is entirely the texture. A `.3do` tile is opaque and keeps
/// reflectivity in its alpha, so copying that through would paint the whole
/// unit flat in the player's colour. The alpha is therefore written rather than
/// copied: zero for an ordinary tile, one for a team colour region.
///
/// A name `teamtex.txt` claims is exactly a team colour region. The file behind
/// one is a flat magenta marker the engine never draws, so it is not read at
/// all: the tile is drawn as a plain mid grey with the mask full on, which is
/// what the region means.
/// `Err(None)` when the archive holds nothing under the name, `Err(Some(member))`
/// when it holds it and the bytes would not decode. The two are different
/// problems and the report keeps them apart.
fn load_tile(
    us: &Unitsync,
    handle: i32,
    list: &[(String, String)],
    teamtex: &[String],
    name: &str,
) -> Result<coilbox_3do_convert::Tile, Option<String>> {
    let want = name.trim().replace('\\', "/").to_lowercase();
    // `teamtex` never holds an empty entry (`read_teamtex` filters blank
    // lines), so an empty `want` always falls through to the suffix rule
    // below, the same as the engine (issue #2610).
    if teamtex.contains(&want) {
        return Ok(coilbox_3do_convert::Tile {
            name: name.to_string(),
            image: image::RgbaImage::from_pixel(8, 8, image::Rgba([128, 128, 128, 255])),
        });
    }
    // The engine appends `00` to a name that is not a team colour region. A
    // game that ships the bare name anyway is met halfway rather than told its
    // texture is missing.
    let member = find_with_ext(list, TATEX_DIR, &format!("{want}00"))
        .or_else(|| find_with_ext(list, TATEX_DIR, &want))
        .ok_or(None)?;
    let (_, bytes) = us
        .read_archive_member(handle, &member, TEXTURE_READ_CAP)
        .ok_or_else(|| Some(member.clone()))?;
    let ext = member.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let mut image = crate::texture::decode_texture(&ext.to_lowercase(), &bytes)
        .ok_or_else(|| Some(member.clone()))?;
    for pixel in image.pixels_mut() {
        pixel.0[3] = 0;
    }
    Ok(coilbox_3do_convert::Tile {
        name: name.to_string(),
        image,
    })
}

/// The flat colour tiles a folder needs: the fallback always, plus one per
/// palette entry any of its models names that the table resolves.
///
/// The same tiles `coilbox_3do_convert::palette_tiles` builds for a single
/// model, over the union of a folder's entries rather than one model's.
fn palette_tiles(
    entries: &BTreeSet<i32>,
    palette: Option<&coilbox_3do::Palette>,
) -> Vec<coilbox_3do_convert::Tile> {
    let side = coilbox_3do_convert::PALETTE_TILE_SIDE;
    let mut tiles = vec![coilbox_3do_convert::Tile {
        name: coilbox_3do_convert::PALETTE_TILE.to_string(),
        image: image::RgbaImage::from_pixel(
            side,
            side,
            image::Rgba(coilbox_3do_convert::PALETTE_GREY),
        ),
    }];
    for &entry in entries {
        let Some(rgb) = usize::try_from(entry)
            .ok()
            .and_then(|i| palette.and_then(|p| p.get(i)).copied())
        else {
            continue;
        };
        tiles.push(coilbox_3do_convert::Tile {
            name: coilbox_3do_convert::palette_tile_name(entry),
            image: image::RgbaImage::from_pixel(
                side,
                side,
                image::Rgba([rgb[0], rgb[1], rgb[2], 0]),
            ),
        });
    }
    tiles
}

/// Pack as many tiles as the size cap allows, and say which were left off.
///
/// The cap stays. A sheet that grows without bound is a sheet the oldest
/// hardware a Spring game runs on cannot hold, and a game whose textures do not
/// fit is a fact worth reporting rather than one worth papering over.
///
/// What goes first when they do not all fit is the tile the fewest models use,
/// then the largest of those, then whichever sorts last, so the choice does not
/// depend on the order the archive happened to list its members. The fallback
/// tile is never dropped: every face that resolves to nothing is drawn from it,
/// so a sheet without it converts nothing.
fn pack_what_fits(
    mut tiles: Vec<coilbox_3do_convert::Tile>,
    uses: &BTreeMap<String, usize>,
) -> (Result<coilbox_3do_convert::Packed, String>, Vec<String>) {
    let mut dropped = Vec::new();
    loop {
        match coilbox_3do_convert::pack(&tiles) {
            Ok(packed) => {
                dropped.sort();
                return (Ok(packed), dropped);
            }
            Err(why) => {
                let Some(at) = least_wanted(&tiles, uses) else {
                    return (Err(why), dropped);
                };
                dropped.push(tiles.remove(at).name);
            }
        }
    }
}

/// Which tile to give up on: fewest models, then largest, then last by name.
fn least_wanted(
    tiles: &[coilbox_3do_convert::Tile],
    uses: &BTreeMap<String, usize>,
) -> Option<usize> {
    tiles
        .iter()
        .enumerate()
        .filter(|(_, tile)| tile.name != coilbox_3do_convert::PALETTE_TILE)
        .min_by_key(|(_, tile)| {
            (
                uses.get(&tile.name).copied().unwrap_or(0),
                std::cmp::Reverse(tile.image.width() * tile.image.height()),
                std::cmp::Reverse(tile.name.clone()),
            )
        })
        .map(|(at, _)| at)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))
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

    /// The grouping the whole mode is built around: a subfolder is a faction
    /// and shares one sheet, and the models at the top level share one more.
    #[test]
    fn groups_by_the_first_folder_below_objects3d() {
        let groups = group_models(&listing(&[
            "Objects3D/armcom.3do",
            "objects3d/corcom.3do",
            "objects3d/arm/mech.3do",
            "objects3d/arm/deep/deeper.3do",
            "objects3d/core/tank.3do",
            "objects3d/armcom.s3o",
            "scripts/armcom.3do",
        ]));

        assert_eq!(
            groups.keys().collect::<Vec<_>>(),
            vec!["", "arm", "core"],
            "{groups:?}"
        );
        assert_eq!(
            groups[""],
            vec!["Objects3D/armcom.3do", "objects3d/corcom.3do"]
        );
        // A model nested deeper shares its top folder's sheet rather than
        // getting one of its own.
        assert_eq!(
            groups["arm"],
            vec!["objects3d/arm/deep/deeper.3do", "objects3d/arm/mech.3do"]
        );
    }

    /// An `.s3o` is already converted and a `.3do` outside `objects3d/` is not
    /// a unit model, so neither is picked up.
    #[test]
    fn takes_only_the_3do_files_under_objects3d() {
        let groups = group_models(&listing(&["objects3d/a.s3o", "features/b.3do"]));

        assert!(groups.is_empty(), "{groups:?}");
    }

    #[test]
    fn names_the_top_levels_sheet_after_the_folder_itself() {
        assert_eq!(sheet_stem(""), "objects3d");
        assert_eq!(sheet_stem("arm"), "objects3d-arm");
        assert_eq!(sheet_stem("Blender Files"), "objects3d-blender_files");
    }

    /// Two folders that sanitise to one name would write one sheet twice, and
    /// half the models would be painted with the other half's tiles.
    ///
    /// Against the plan the run actually uses rather than against the naming
    /// helper on its own. A helper that dedupes correctly and a caller that
    /// asks it about one folder at a time is exactly how this goes wrong
    /// without anything failing.
    #[test]
    fn gives_two_folders_different_sheets_when_their_names_sanitise_the_same() {
        let planned = plan(&listing(&[
            "objects3d/a b/one.3do",
            "objects3d/a_b/two.3do",
            "objects3d/top.3do",
        ]));

        let stems: Vec<&str> = planned.iter().map(|g| g.stem.as_str()).collect();
        assert_eq!(stems.len(), 3);
        let unique: BTreeSet<&str> = stems.iter().copied().collect();
        assert_eq!(unique.len(), 3, "{stems:?}");
        assert!(stems.contains(&"objects3d"), "{stems:?}");
    }

    /// Every model in the archive is in exactly one folder's plan, so nothing
    /// is converted twice and nothing is dropped before the run starts.
    #[test]
    fn the_plan_covers_every_model_once() {
        let planned = plan(&listing(&[
            "objects3d/top.3do",
            "objects3d/arm/one.3do",
            "objects3d/arm/two.3do",
        ]));

        let all: Vec<&String> = planned.iter().flat_map(|g| g.members.iter()).collect();
        assert_eq!(all.len(), 3);
        assert_eq!(all.iter().collect::<BTreeSet<_>>().len(), 3);
    }

    #[test]
    fn a_converted_model_keeps_its_path_and_changes_its_extension() {
        assert_eq!(
            out_member("Objects3D/arm/mech.3do"),
            PathBuf::from("Objects3D/arm/mech.s3o")
        );
        assert_eq!(
            out_member("objects3d/armcom.3do"),
            PathBuf::from("objects3d/armcom.s3o")
        );
    }

    fn tile(name: &str, side: u32) -> coilbox_3do_convert::Tile {
        coilbox_3do_convert::Tile {
            name: name.to_string(),
            image: image::RgbaImage::from_pixel(side, side, image::Rgba([1, 2, 3, 255])),
        }
    }

    #[test]
    fn packs_everything_when_everything_fits() {
        let (packed, dropped) = pack_what_fits(
            vec![tile(coilbox_3do_convert::PALETTE_TILE, 8), tile("a", 64)],
            &BTreeMap::from([("a".to_string(), 3)]),
        );

        assert!(dropped.is_empty());
        assert_eq!(packed.expect("packed").rects.len(), 2);
    }

    /// The cap is kept and the overflow is named. What goes is the tile the
    /// fewest models wanted, so the reported casualties are as few as the
    /// packer can make them.
    #[test]
    fn drops_the_least_wanted_tile_rather_than_growing_past_the_cap() {
        let cap = coilbox_3do_convert::MAX_SIDE;
        let mut tiles = vec![tile(coilbox_3do_convert::PALETTE_TILE, 8)];
        // Four tiles that each take a whole half of the biggest allowed sheet,
        // so exactly one has to go.
        for name in ["a", "b", "c", "d"] {
            tiles.push(tile(name, cap / 2 - 2));
        }
        let uses = BTreeMap::from([
            ("a".to_string(), 9),
            ("b".to_string(), 9),
            ("c".to_string(), 9),
            ("d".to_string(), 1),
        ]);

        let (packed, dropped) = pack_what_fits(tiles, &uses);

        assert_eq!(dropped, vec!["d".to_string()]);
        let packed = packed.expect("the rest still packs");
        assert_eq!(packed.image.width(), cap);
        assert!(packed.rects.contains_key(coilbox_3do_convert::PALETTE_TILE));
    }

    /// Without the fallback tile nothing converts at all, so it is never the
    /// one given up.
    #[test]
    fn never_drops_the_fallback_tile() {
        let cap = coilbox_3do_convert::MAX_SIDE;
        let tiles = vec![
            tile(coilbox_3do_convert::PALETTE_TILE, 8),
            tile("huge", cap),
        ];

        let (packed, dropped) = pack_what_fits(tiles, &BTreeMap::new());

        assert_eq!(dropped, vec!["huge".to_string()]);
        assert!(packed
            .expect("the fallback still packs")
            .rects
            .contains_key(coilbox_3do_convert::PALETTE_TILE));
    }
}
