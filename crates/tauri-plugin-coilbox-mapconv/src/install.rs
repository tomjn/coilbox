//! Copies a packed map into a content root's `maps/` folder.
//!
//! The engine caches an archive by its name, so a changed map under a name that
//! is already installed confuses it. An archive with the same name is therefore
//! never replaced unless the caller says so.

use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// The archive is in `maps/`. `replaced` is true when it took the place of
    /// one with the same name.
    Installed { path: PathBuf, replaced: bool },
    /// An archive with this name is already installed and `replace` was not set.
    Exists { path: PathBuf },
}

/// Copy `sdz` into `<root>/maps/`.
pub fn install_map(sdz: &Path, root: &Path, replace: bool) -> Result<Outcome, String> {
    if !sdz.is_file() {
        return Err(format!(
            "{} is not there. Package the map first.",
            sdz.display()
        ));
    }
    let file_name = sdz
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| n.to_lowercase().ends_with(".sdz"))
        .ok_or_else(|| format!("{} is not an .sdz archive", sdz.display()))?;
    let stem = &file_name[..file_name.len() - ".sdz".len()];

    let maps = root.join("maps");
    std::fs::create_dir_all(&maps)
        .map_err(|e| format!("could not create {}: {e}", maps.display()))?;
    let dest = maps.join(file_name);

    // The engine reads three kinds of map archive, and any of them under this
    // name is the same archive to its cache.
    for other in [format!("{stem}.sd7"), format!("{stem}.sdd")] {
        let path = maps.join(&other);
        if path.exists() {
            return Err(format!(
                "{} is already installed as {other}. Remove it or package the map under another name.",
                maps.display()
            ));
        }
    }

    // The mapper's output folder can be the maps folder itself.
    if let (Ok(a), Ok(b)) = (sdz.canonicalize(), dest.canonicalize()) {
        if a == b {
            return Ok(Outcome::Installed {
                path: dest,
                replaced: false,
            });
        }
    }
    let exists = dest.exists();
    if exists && !replace {
        return Ok(Outcome::Exists { path: dest });
    }

    let tmp = maps.join(format!("{file_name}.tmp"));
    std::fs::copy(sdz, &tmp).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("could not copy to {}: {e}", tmp.display())
    })?;
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("could not install {}: {e}", dest.display())
    })?;
    Ok(Outcome::Installed {
        path: dest,
        replaced: exists,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coilbox-mapconv-install-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sdz(dir: &Path, bytes: &[u8]) -> PathBuf {
        let p = dir.join("mymap.sdz");
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn a_new_map_is_copied_into_maps() {
        let dir = temp_dir("new");
        let root = dir.join("root");
        let out = install_map(&sdz(&dir, b"one"), &root, false).unwrap();
        let dest = root.join("maps/mymap.sdz");
        assert_eq!(
            out,
            Outcome::Installed {
                path: dest.clone(),
                replaced: false
            }
        );
        assert_eq!(std::fs::read(dest).unwrap(), b"one");
        assert!(!root.join("maps/mymap.sdz.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_already_installed_is_left_alone_until_replace_is_set() {
        let dir = temp_dir("exists");
        let root = dir.join("root");
        install_map(&sdz(&dir, b"one"), &root, false).unwrap();

        let src = sdz(&dir, b"two");
        let out = install_map(&src, &root, false).unwrap();
        assert_eq!(
            out,
            Outcome::Exists {
                path: root.join("maps/mymap.sdz")
            }
        );
        assert_eq!(std::fs::read(root.join("maps/mymap.sdz")).unwrap(), b"one");

        let out = install_map(&src, &root, true).unwrap();
        assert_eq!(
            out,
            Outcome::Installed {
                path: root.join("maps/mymap.sdz"),
                replaced: true
            }
        );
        assert_eq!(std::fs::read(root.join("maps/mymap.sdz")).unwrap(), b"two");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_same_name_as_another_archive_kind_is_refused_even_with_replace() {
        let dir = temp_dir("kind");
        let root = dir.join("root");
        std::fs::create_dir_all(root.join("maps/mymap.sdd")).unwrap();
        let err = install_map(&sdz(&dir, b"one"), &root, true).unwrap_err();
        assert!(err.contains("mymap.sdd"), "{err}");
        assert!(!root.join("maps/mymap.sdz").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_archive_already_in_maps_is_not_copied_onto_itself() {
        let dir = temp_dir("self");
        let root = dir.join("root");
        std::fs::create_dir_all(root.join("maps")).unwrap();
        let src = sdz(&root.join("maps"), b"one");
        let out = install_map(&src, &root, false).unwrap();
        assert!(matches!(
            out,
            Outcome::Installed {
                replaced: false,
                ..
            }
        ));
        assert_eq!(std::fs::read(&src).unwrap(), b"one");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_archive_in_maps_beside_another_kind_of_the_same_name_is_refused() {
        let dir = temp_dir("selfkind");
        let root = dir.join("root");
        std::fs::create_dir_all(root.join("maps/mymap.sdd")).unwrap();
        let src = sdz(&root.join("maps"), b"one");
        assert!(install_map(&src, &root, false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_wrong_kind_of_file_is_an_error() {
        let dir = temp_dir("bad");
        let root = dir.join("root");
        assert!(install_map(&dir.join("none.sdz"), &root, false).is_err());
        let txt = dir.join("mymap.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert!(install_map(&txt, &root, false).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
