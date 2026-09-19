//! A `.bos` on disk, with the files it `#include`s and the `.cob` beside it, so
//! one loaded from a folder converts exactly as it does out of its game.
//!
//! The folder above the nearest `scripts/` stands in for the game archive's
//! root, and the includes are found by the same `find_includes` the game import
//! uses. Names match regardless of case, since Total Annihilation's scripts
//! name `EXPTYPE.H` for a file called `exptype.h`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The largest script or header read, matching the game import in the
/// unitsync worker.
const FILE_CAP: u64 = 1024 * 1024;

/// A script or header as text. BOS predates UTF-8, so anything else is
/// replaced rather than refused.
pub fn read_text(path: &Path) -> Result<String, String> {
    read_capped(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    let shown = path.display();
    let len = std::fs::metadata(path)
        .map_err(|e| format!("could not read {shown}: {e}"))?
        .len();
    if len > FILE_CAP {
        return Err(format!(
            "{shown} is {len} bytes, more than the {FILE_CAP} a unit script may be"
        ));
    }
    std::fs::read(path).map_err(|e| format!("could not read {shown}: {e}"))
}

/// The game folder a script on disk belongs to, and the script's path inside
/// it, which is its name in the game's archive: `scripts/carrier.bos`. The game
/// folder is the one holding the nearest `scripts/` above the script. A script
/// in no `scripts/` folder is taken as sitting at the root.
pub fn locate(bos: &Path) -> (PathBuf, String) {
    let file = bos
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = bos.parent().unwrap_or_else(|| Path::new("."));
    let root = dir
        .ancestors()
        .find(|d| {
            d.file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("scripts"))
        })
        .and_then(Path::parent);
    match root.and_then(|root| Some((root, bos.strip_prefix(root).ok()?))) {
        Some((root, rel)) => (root.to_path_buf(), slashed(rel)),
        None => (dir.to_path_buf(), file),
    }
}

/// The files `source`, the script at `name` under `root`, includes, keyed by
/// their paths under `root`. A name found nowhere is left out, and the
/// converter reports it as missing.
pub fn includes(source: &str, root: &Path, name: &str) -> HashMap<String, String> {
    coilbox_bos2lua::find_includes(source, name, |candidate| {
        let path = find(root, candidate)?;
        let text = read_text(&path).ok()?;
        Some((slashed(path.strip_prefix(root).ok()?), text))
    })
    .into_iter()
    .map(|found| (found.path, found.text))
    .collect()
}

fn slashed(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The compiled `.cob` beside a `.bos`, which settles how long `[1]` is.
pub fn cob_beside(bos: &Path) -> Option<Vec<u8>> {
    let dir = bos.parent()?;
    let stem = bos.file_stem()?.to_string_lossy();
    read_capped(&find(dir, &format!("{stem}.cob"))?).ok()
}

/// `rel`, a normalised path, under `base` as a file, matching each name
/// regardless of case.
fn find(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut at = base.to_path_buf();
    for name in rel.split('/') {
        let exact = at.join(name);
        at = if exact.exists() {
            exact
        } else {
            std::fs::read_dir(&at)
                .ok()?
                .flatten()
                .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name))?
                .path()
        };
    }
    at.is_file().then_some(at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn convert(
        source: &str,
        name: &str,
        includes: &HashMap<String, String>,
    ) -> coilbox_bos2lua::Conversion {
        coilbox_bos2lua::convert(
            source,
            &coilbox_bos2lua::Options {
                name,
                includes,
                pieces: None,
                linear_scale: coilbox_bos2lua::MODERN_LINEAR,
                precedence: coilbox_bos2lua::Precedence::Modern,
                prune: false,
            },
        )
        .unwrap()
    }

    /// The includes a script on disk gets, keyed in lower case so the test
    /// reads the same on a case sensitive disk and a case insensitive one.
    fn found(bos: &Path) -> (String, HashMap<String, String>) {
        let (root, name) = locate(bos);
        let source = read_text(bos).unwrap();
        let includes = includes(&source, &root, &name)
            .into_iter()
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect();
        (name, includes)
    }

    fn sorted_keys(map: &HashMap<String, String>) -> Vec<String> {
        let mut keys: Vec<_> = map.keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn reads_headers_beside_the_script_whatever_their_case() {
        let game = tempfile::tempdir().unwrap();
        write(
            game.path(),
            "scripts/THIS.h",
            "#include \"lib\\Smoke.h\"\n#define SPEED 1\n",
        );
        write(game.path(), "scripts/lib/smoke.h", "#define SMOKE 2\n");
        let source = "piece base;\n#include \"this.H\"\n// #include \"gone.h\"\nCreate() { turn base to x-axis SPEED speed SMOKE; }\n";
        write(game.path(), "scripts/carrier.bos", source);

        let (name, includes) = found(&game.path().join("scripts/carrier.bos"));
        assert_eq!(name, "scripts/carrier.bos");
        assert_eq!(
            sorted_keys(&includes),
            ["scripts/lib/smoke.h", "scripts/this.h"]
        );
        assert!(convert(source, &name, &includes)
            .missing_includes
            .is_empty());
    }

    #[test]
    fn reads_headers_from_the_scripts_folder_and_the_game_root() {
        let game = tempfile::tempdir().unwrap();
        write(game.path(), "scripts/exptype.h", "#define BOOM 1\n");
        write(game.path(), "shared.h", "#define SHARED 2\n");
        let source = "piece base;\n#include <EXPTYPE.H>\n#include \"shared.h\"\nKilled() { return BOOM + SHARED; }\n";
        write(game.path(), "scripts/units/tank.bos", source);

        let (name, includes) = found(&game.path().join("scripts/units/tank.bos"));
        assert_eq!(name, "scripts/units/tank.bos");
        assert_eq!(sorted_keys(&includes), ["scripts/exptype.h", "shared.h"]);
        assert!(convert(source, &name, &includes)
            .missing_includes
            .is_empty());
    }

    /// The game import looks the same names up in the archive's file list.
    /// The same files must come back from a folder as from an archive holding
    /// them, or a script could convert in one and fail in the other.
    #[test]
    fn a_folder_finds_the_same_includes_as_an_archive_holding_it() {
        let game = tempfile::tempdir().unwrap();
        let files = [
            ("scripts/THIS.h", "#include \"constants.h\"\n"),
            ("scripts/constants.h", "#define A 1\n"),
            ("scripts/lib/walk.h", "#include \"../exptype.h\"\n"),
            ("scripts/exptype.h", "#define B 2\n"),
            ("root.h", "#define C 3\n"),
        ];
        for (rel, text) in files {
            write(game.path(), rel, text);
        }
        let source = "#include \"THIS.h\"\n#include \"lib\\walk.h\"\n#include \"root.h\"\n#include \"absent.h\"\n";
        write(game.path(), "scripts/unit.bos", source);

        let (name, from_disk) = found(&game.path().join("scripts/unit.bos"));
        let from_archive: HashMap<String, String> =
            coilbox_bos2lua::find_includes(source, &name, |candidate| {
                files
                    .iter()
                    .find(|(rel, _)| rel.to_lowercase() == candidate)
                    .map(|(rel, text)| (rel.to_lowercase(), text.to_string()))
            })
            .into_iter()
            .map(|f| (f.path, f.text))
            .collect();
        assert_eq!(from_disk, from_archive);
        assert_eq!(from_disk.len(), 5);
    }

    #[test]
    fn a_script_in_no_scripts_folder_is_its_own_root() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "tank.bos",
            "#include \"nowhere.h\"\n#include \"here.h\"\n",
        );
        write(dir.path(), "here.h", "#define X 1\n");
        let (name, includes) = found(&dir.path().join("tank.bos"));
        assert_eq!(name, "tank.bos");
        assert_eq!(sorted_keys(&includes), ["here.h"]);
        let conversion = convert("piece base;\n#include \"nowhere.h\"\n", &name, &includes);
        assert_eq!(conversion.missing_includes, ["nowhere.h"]);
    }

    #[test]
    fn finds_the_cob_beside_the_bos_whatever_its_case() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "CARRIER.COB", "cob");
        assert_eq!(
            cob_beside(&root.path().join("carrier.bos")).as_deref(),
            Some(&b"cob"[..])
        );
        assert_eq!(cob_beside(&root.path().join("other.bos")), None);
    }
}
