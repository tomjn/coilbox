//! Extract Spring map archives — `.sdz` (zip) and `.sd7` (7-zip) — so the
//! decompiler can work from a packaged map, not just a loose `.smf`. A map
//! archive holds `maps/<name>.smf` plus the matching `.smt`, which mapdecompile
//! needs side-by-side; we extract the whole tree and locate the inner `.smf`.

use std::path::{Path, PathBuf};

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
