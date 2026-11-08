//! Extract Spring map archives — `.sdz` (zip) and `.sd7` (7-zip) — so the
//! decompiler can work from a packaged map, not just a loose `.smf`. A map
//! archive holds `maps/<name>.smf` plus the matching `.smt`, which mapdecompile
//! needs side-by-side; we extract the whole tree and locate the inner `.smf`.

//!
//! [`pack_map`] goes the other way and writes a compiled map's `.sdz`.

use std::path::{Path, PathBuf};

use crate::luapatch::{apply, string_literals, Key, Mode, Val};

/// What [`pack_map`] wrote.
#[derive(Debug)]
pub struct Packed {
    pub path: PathBuf,
    /// Every entry in the archive, by its path inside it.
    pub files: Vec<String>,
}

/// Extract `archive` into `dest`, dispatching on the file extension.
pub fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("could not create extract dir: {e}"))?;
    let ext = archive
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "sdz" | "zip" => {
            let file =
                std::fs::File::open(archive).map_err(|e| format!("could not open archive: {e}"))?;
            let mut zip =
                zip::ZipArchive::new(file).map_err(|e| format!("invalid zip/sdz: {e}"))?;
            // `extract` resolves each entry via enclosed_name, guarding against
            // path-traversal ("zip slip").
            zip.extract(dest)
                .map_err(|e| format!("failed to extract sdz: {e}"))
        }
        "sd7" | "7z" => sevenz_rust2::decompress_file(archive, dest)
            .map_err(|e| format!("failed to extract sd7: {e}")),
        other => Err(format!("unsupported archive type: .{other}")),
    }
}

/// A file [`pack_map`] adds because a Lua file names it: where it is on disk and
/// the forward slash path it goes in at.
struct Referenced {
    archive_path: String,
    source: PathBuf,
}

/// The folder the archive is built from. A compile into a decompiled map's own
/// `maps/` folder sits inside that map's folder, and the map's other files
/// (`mapconfig/`, a sky, Lua it includes) are beside `maps/`, so the archive root
/// is the folder above. Any other output folder is the root itself.
fn archive_root(dir: &Path) -> &Path {
    let is_maps = dir
        .file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("maps"));
    match dir.parent() {
        Some(parent) if is_maps && !parent.as_os_str().is_empty() => parent,
        _ => dir,
    }
}

/// Where a file that `literal` names is on disk, and the path it goes in at.
///
/// The engine reads `skyBox` only from `maps/<ref>`, and the other textures from
/// `<ref>` or else `maps/<ref>` (`ISky.cpp`, `FIND_MAP_TEXTURE`). A file under
/// `maps/` is therefore the one to pack. `VFS.Include` reads from the archive
/// root. In the compile folder a `maps/` folder is the compile folder itself
/// (see [`archive_root`]), and anything else is found from the root.
fn locate(dir: &Path, root: &Path, literal: &str) -> Option<(String, PathBuf, String)> {
    let rel = crate::sanitize_rel(literal)?;
    let rel_text = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    let nested = root != dir;
    let mut candidates = vec![(format!("maps/{rel_text}"), dir.join("maps").join(&rel))];
    if nested {
        // `dir` is the archive's `maps/` folder.
        candidates.push((format!("maps/{rel_text}"), dir.join(&rel)));
        candidates.push((rel_text.clone(), root.join(&rel)));
    } else {
        candidates.push((rel_text.clone(), dir.join(&rel)));
    }
    let (archive_path, source) = candidates.into_iter().find(|(_, p)| p.is_file())?;
    Some((archive_path, source, rel_text))
}

/// The files that the string literals in `src` name, and that those files, if
/// they are Lua, name in turn (a `VFS.Include` of a file that includes another).
/// The map's own `.smf`, `.smt` and `mapinfo.lua` are not listed, because
/// [`pack_map`] places those itself.
fn referenced_files(dir: &Path, src: &str, name: &str) -> Result<Vec<Referenced>, String> {
    let root = archive_root(dir);
    // Named as the archive holds them and as a `mapinfo.lua` writes them.
    let own = [
        "mapinfo.lua".to_string(),
        format!("maps/{name}.smf"),
        format!("maps/{name}.smt"),
        format!("{name}.smf"),
        format!("{name}.smt"),
    ];
    let mut out: Vec<Referenced> = Vec::new();
    let mut pending = string_literals(src)?;
    let mut next = 0;
    while next < pending.len() {
        let literal = pending[next].clone();
        next += 1;
        let Some((archive_path, source, named)) = locate(dir, root, &literal) else {
            continue;
        };
        if [&archive_path, &named]
            .iter()
            .any(|p| own.iter().any(|o| o.eq_ignore_ascii_case(p)))
            || out.iter().any(|r| r.archive_path == archive_path)
        {
            continue;
        }
        if archive_path.to_ascii_lowercase().ends_with(".lua") {
            let text = std::fs::read_to_string(&source)
                .map_err(|e| format!("could not read {}: {e}", source.display()))?;
            pending.extend(
                string_literals(&text)
                    .map_err(|e| format!("could not read {}: {e}", source.display()))?,
            );
        }
        out.push(Referenced {
            archive_path,
            source,
        });
    }
    Ok(out)
}

/// Write `<dir>/<name>.sdz` from the files a compile left in `dir`.
///
/// The archive holds `mapinfo.lua` at the root, the `.smf` and `.smt` under
/// `maps/`, and any file the `mapinfo.lua` refers to at the path the engine looks
/// for it, along with the files those Lua files refer to. When `dir` is a
/// decompiled map's `maps/` folder, the files beside it are packed too. The
/// `.smt` is stored, since the compiler already compressed it. In the archive's
/// copy of `mapinfo.lua`, `mapfile` is `maps/<name>.smf`, because the engine
/// reads that key as a path inside the archive. The loose file beside the
/// compile is not touched. `smtFileName0` needs no change, because the engine
/// looks for the tile file in the folder of the `.smf`.
pub fn pack_map(dir: &Path, name: &str) -> Result<Packed, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err(format!("\"{name}\" is not a usable map name"));
    }
    let mapinfo_path = dir.join("mapinfo.lua");
    let src = std::fs::read_to_string(&mapinfo_path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!(
            "{} is not there. Write mapinfo.lua first, because an archive without it cannot be loaded.",
            mapinfo_path.display()
        ),
        _ => format!("could not read {}: {e}", mapinfo_path.display()),
    })?;
    let smf = dir.join(format!("{name}.smf"));
    let smt = dir.join(format!("{name}.smt"));
    for f in [&smf, &smt] {
        if !f.is_file() {
            return Err(format!(
                "{} is not there. Compile the map first.",
                f.display()
            ));
        }
    }

    let archive_info = apply(
        &src,
        &[Key::Name("mapfile".into())],
        &Val::Str(format!("maps/{name}.smf")),
        Mode::Set,
    )?;
    let refs = referenced_files(dir, &archive_info, name)?;

    let sdz = dir.join(format!("{name}.sdz"));
    let tmp = dir.join(format!("{name}.sdz.tmp"));
    let mut files = Vec::new();
    let built = write_zip(&tmp, &mut files, &archive_info, dir, name, &refs);
    if let Err(e) = built {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &sdz).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("could not replace {}: {e}", sdz.display())
    })?;
    Ok(Packed { path: sdz, files })
}

fn write_zip(
    tmp: &Path,
    files: &mut Vec<String>,
    mapinfo_text: &str,
    dir: &Path,
    name: &str,
    refs: &[Referenced],
) -> Result<(), String> {
    use zip::write::SimpleFileOptions;
    let file = std::fs::File::create(tmp)
        .map_err(|e| format!("could not create {}: {e}", tmp.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let deflated =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    // Files are copied through rather than read whole: a large map's `.smt` is
    // hundreds of megabytes.
    let mut add = |entry: String,
                   mut from: &mut dyn std::io::Read,
                   opts: SimpleFileOptions|
     -> Result<(), String> {
        zip.start_file(entry.as_str(), opts)
            .map_err(|e| format!("could not add {entry}: {e}"))?;
        std::io::copy(&mut from, &mut zip).map_err(|e| format!("could not add {entry}: {e}"))?;
        files.push(entry);
        Ok(())
    };
    let open = |p: &Path| {
        std::fs::File::open(p).map_err(|e| format!("could not read {}: {e}", p.display()))
    };

    add("mapinfo.lua".into(), &mut mapinfo_text.as_bytes(), deflated)?;
    add(
        format!("maps/{name}.smf"),
        &mut open(&dir.join(format!("{name}.smf")))?,
        deflated,
    )?;
    add(
        format!("maps/{name}.smt"),
        &mut open(&dir.join(format!("{name}.smt")))?,
        stored,
    )?;
    for r in refs {
        add(r.archive_path.clone(), &mut open(&r.source)?, deflated)?;
    }
    zip.finish()
        .map_err(|e| format!("could not finish {}: {e}", tmp.display()))?;
    Ok(())
}

/// Find the map `.smf` within an extracted tree. Prefers one under a `maps/`
/// directory (the Spring convention), else the first `.smf` found.
pub fn find_smf(root: &Path) -> Option<PathBuf> {
    let mut all = Vec::new();
    walk_smf(root, &mut all);
    all.iter()
        .find(|p| {
            p.components()
                .any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case("maps"))
        })
        .cloned()
        .or_else(|| all.into_iter().next())
}

fn walk_smf(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_smf(&p, out);
        } else if p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("smf"))
            .unwrap_or(false)
        {
            out.push(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Round-trip a real .sdz (zip): write one, extract it, and confirm find_smf
    /// locates the entry under maps/ — exercising the zip crate path for real.
    #[test]
    fn extracts_sdz_and_finds_smf() {
        let base = std::env::temp_dir().join("mapconv_sdz_test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let sdz = base.join("MyMap.sdz");

        let file = std::fs::File::create(&sdz).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.add_directory("maps/", opts).unwrap();
        zip.start_file("maps/MyMap.smf", opts).unwrap();
        zip.write_all(b"spring map file\0dummy").unwrap();
        zip.start_file("maps/MyMap.smt", opts).unwrap();
        zip.write_all(b"spring tilefile\0").unwrap();
        zip.finish().unwrap();

        let dest = base.join("out");
        extract_archive(&sdz, &dest).unwrap();
        let smf = find_smf(&dest).expect("should find the extracted .smf");
        assert!(smf.ends_with("maps/MyMap.smf"), "found {smf:?}");
        assert!(
            dest.join("maps/MyMap.smt").exists(),
            "the .smt should extract too"
        );
    }

    const LOOSE_INFO: &str = "-- a mapper's file\nlocal mapinfo = {\n  name = \"MyMap\",\n  mapfile = \"MyMap.smf\",\n  smf = { smtFileName0 = \"MyMap.smt\" },\n  atmosphere = { skyBox = \"maps/sky.dds\" },\n  note = \"nothing.png\",\n}\nreturn mapinfo\n";

    fn compiled_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mapconv_pack_{}_{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("maps")).unwrap();
        std::fs::write(dir.join("MyMap.smf"), b"spring map file\0dummy").unwrap();
        std::fs::write(dir.join("MyMap.smt"), b"spring tilefile\0".repeat(64)).unwrap();
        std::fs::write(dir.join("maps/sky.dds"), b"DDS sky").unwrap();
        std::fs::write(dir.join("heightmap.png"), b"not in the archive").unwrap();
        std::fs::write(dir.join("mapinfo.lua"), LOOSE_INFO).unwrap();
        dir
    }

    /// The archive the engine loads: mapinfo.lua at the root pointing at the
    /// .smf inside it, the .smf and .smt under maps/, the .smt stored, and the
    /// file mapinfo.lua names. A file it does not name stays out, and the
    /// mapper's loose mapinfo.lua is as they left it.
    #[test]
    fn packs_a_compiled_map_the_engine_can_load() {
        let dir = compiled_dir("ok");
        let packed = pack_map(&dir, "MyMap").unwrap();
        assert_eq!(packed.path, dir.join("MyMap.sdz"));
        assert_eq!(
            packed.files,
            [
                "mapinfo.lua",
                "maps/MyMap.smf",
                "maps/MyMap.smt",
                "maps/sky.dds"
            ]
        );

        let mut zip = zip::ZipArchive::new(std::fs::File::open(&packed.path).unwrap()).unwrap();
        let mut info = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("mapinfo.lua").unwrap(), &mut info).unwrap();
        assert!(info.contains("mapfile = \"maps/MyMap.smf\""), "{info}");
        assert!(info.contains("-- a mapper's file"), "comments survive");
        assert!(info.contains("smtFileName0 = \"MyMap.smt\""), "{info}");
        assert_eq!(
            zip.by_name("maps/MyMap.smt").unwrap().compression(),
            zip::CompressionMethod::Stored
        );
        assert!(zip.by_name("heightmap.png").is_err());
        assert!(!dir.join("MyMap.sdz.tmp").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("mapinfo.lua")).unwrap(),
            LOOSE_INFO,
            "the loose file keeps its own mapfile"
        );

        // And it reads back the way the decompiler reads archives.
        let out = dir.join("out");
        extract_archive(&packed.path, &out).unwrap();
        assert!(find_smf(&out).unwrap().ends_with("maps/MyMap.smf"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The engine reads `skyBox` from `maps/<skyBox>`, so a sky named as
    /// `skybox.jpg` and written to `maps/` goes in under `maps/`.
    #[test]
    fn a_reference_found_only_under_maps_is_packed_there() {
        let dir = compiled_dir("in-maps");
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return { mapfile = \"MyMap.smf\", atmosphere = { skyBox = \"skybox.jpg\" } }",
        )
        .unwrap();
        std::fs::write(dir.join("maps/skybox.jpg"), b"sky").unwrap();
        let packed = pack_map(&dir, "MyMap").unwrap();
        assert_eq!(
            packed.files,
            [
                "mapinfo.lua",
                "maps/MyMap.smf",
                "maps/MyMap.smt",
                "maps/skybox.jpg"
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A recompiled map is compiled into the decompiled map's `maps/` folder, so
    /// the archive root is the folder above it. A `skyBox` there goes in under
    /// `maps/`, where the engine reads it, and the files the `mapinfo.lua`
    /// includes from beside `maps/` go in at their own paths, with the files they
    /// include in turn.
    #[test]
    fn a_recompiled_map_packs_its_sky_and_includes_at_the_engine_paths() {
        let root = std::env::temp_dir().join(format!("mapconv_pack_{}_sdd", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let maps = root.join("maps");
        std::fs::create_dir_all(&maps).unwrap();
        std::fs::create_dir_all(root.join("mapconfig/lua")).unwrap();
        std::fs::write(maps.join("MyMap.smf"), b"spring map file\0dummy").unwrap();
        std::fs::write(maps.join("MyMap.smt"), b"spring tilefile\0".repeat(64)).unwrap();
        std::fs::write(maps.join("sky.dds"), b"DDS sky").unwrap();
        std::fs::write(maps.join("heightmap.png"), b"not in the archive").unwrap();
        std::fs::write(root.join("mapinfo.lua"), b"the decompiled map's own").unwrap();
        std::fs::write(
            root.join("mapconfig/lua/a.lua"),
            "return VFS.Include(\"mapconfig/b.lua\")",
        )
        .unwrap();
        std::fs::write(root.join("mapconfig/b.lua"), "return {}").unwrap();
        std::fs::write(root.join("mapconfig/unused.lua"), "return {}").unwrap();
        std::fs::write(
            maps.join("mapinfo.lua"),
            "local a = VFS.Include(\"mapconfig/lua/a.lua\")\nreturn { mapfile = \"MyMap.smf\", smf = { smtFileName0 = \"MyMap.smt\" }, atmosphere = { skyBox = \"sky.dds\" } }",
        )
        .unwrap();

        let packed = pack_map(&maps, "MyMap").unwrap();
        assert_eq!(
            packed.files,
            [
                "mapinfo.lua",
                "maps/MyMap.smf",
                "maps/MyMap.smt",
                "mapconfig/lua/a.lua",
                "maps/sky.dds",
                "mapconfig/b.lua"
            ]
        );
        assert_eq!(packed.path, maps.join("MyMap.sdz"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A reference is found however it is written: a name with `--` in it, a long
    /// bracket string, and not one that only a comment mentions.
    #[test]
    fn finds_references_written_with_dashes_or_long_brackets() {
        let dir = compiled_dir("refs");
        std::fs::write(dir.join("maps/my--sky.dds"), b"a").unwrap();
        std::fs::write(dir.join("maps/long.dds"), b"b").unwrap();
        std::fs::write(dir.join("maps/commented.dds"), b"c").unwrap();
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return {\n  mapfile = \"MyMap.smf\", a = \"maps/my--sky.dds\", b = [[maps/long.dds]],\n  -- c = \"maps/commented.dds\"\n}\n",
        )
        .unwrap();
        let packed = pack_map(&dir, "MyMap").unwrap();
        assert_eq!(
            packed.files,
            [
                "mapinfo.lua",
                "maps/MyMap.smf",
                "maps/MyMap.smt",
                "maps/my--sky.dds",
                "maps/long.dds"
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_long_bracket_reference_on_its_own_line_may_end_in_crlf() {
        let dir = compiled_dir("crlf");
        std::fs::write(
            dir.join("mapinfo.lua"),
            "return {\r\n  mapfile = \"MyMap.smf\",\r\n  a = [[\r\nmaps/sky.dds]],\r\n}\r\n",
        )
        .unwrap();
        let packed = pack_map(&dir, "MyMap").unwrap();
        assert!(packed.files.contains(&"maps/sky.dds".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn packing_without_a_mapinfo_names_what_to_do() {
        let dir = compiled_dir("nomi");
        std::fs::remove_file(dir.join("mapinfo.lua")).unwrap();
        let err = pack_map(&dir, "MyMap").unwrap_err();
        assert!(err.contains("Write mapinfo.lua first"), "{err}");
        assert!(!dir.join("MyMap.sdz").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn packing_before_a_compile_or_with_a_path_for_a_name_is_refused() {
        let dir = compiled_dir("nocompile");
        std::fs::remove_file(dir.join("MyMap.smt")).unwrap();
        assert!(pack_map(&dir, "MyMap").unwrap_err().contains("Compile"));
        assert!(pack_map(&dir, "../MyMap").is_err());
        assert!(pack_map(&dir, " ").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Round-trip a real .sd7 (7-zip): compress a maps/ tree, extract it, and
    /// confirm find_smf locates the entry — exercising the sevenz-rust2 path.
    #[test]
    fn extracts_sd7_and_finds_smf() {
        let base = std::env::temp_dir().join("mapconv_sd7_test");
        let _ = std::fs::remove_dir_all(&base);
        let maps = base.join("src/maps");
        std::fs::create_dir_all(&maps).unwrap();
        std::fs::write(maps.join("MyMap.smf"), b"spring map file\0dummy").unwrap();
        std::fs::write(maps.join("MyMap.smt"), b"spring tilefile\0").unwrap();

        let sd7 = base.join("MyMap.sd7");
        sevenz_rust2::compress_to_path(base.join("src"), &sd7).unwrap();

        let dest = base.join("out");
        extract_archive(&sd7, &dest).unwrap();
        let smf = find_smf(&dest).expect("should find the extracted .smf");
        assert!(
            smf.to_string_lossy()
                .to_lowercase()
                .ends_with("maps/mymap.smf"),
            "found {smf:?}"
        );
    }
}
