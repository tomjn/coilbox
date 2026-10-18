//! What the tests that need a real game share: finding the engine, the base
//! game and the worker.

use std::path::{Path, PathBuf};

const DEFAULT_GAME: &str = "xta-9.65.sd7";

/// The engine folder holding a `libunitsync`, and the base archive's name.
/// `COILBOX_COMPAT_GAME` names another archive in `~/.spring/games` to use.
pub fn setup() -> Result<(PathBuf, String), String> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("no HOME")?);
    let data = home.join(".spring");
    let game = std::env::var("COILBOX_COMPAT_GAME").unwrap_or_else(|_| DEFAULT_GAME.into());
    if !data.join("games").join(&game).exists() {
        return Err(format!("{game} is not installed"));
    }
    let lib = if cfg!(target_os = "macos") {
        "libunitsync.dylib"
    } else if cfg!(windows) {
        "unitsync.dll"
    } else {
        "libunitsync.so"
    };
    let engine = std::fs::read_dir(data.join("engine"))
        .map_err(|_| "no engine is installed".to_string())?
        .flatten()
        .flat_map(|platform| {
            std::fs::read_dir(platform.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|e| e.path())
        .find(|dir| dir.join(lib).is_file())
        .ok_or("no engine is installed")?;
    let worker = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(if cfg!(windows) {
            "coilbox-unitsync-worker.exe"
        } else {
            "coilbox-unitsync-worker"
        });
    if !worker.is_file() {
        return Err("the unitsync worker is not built".into());
    }
    std::env::set_var("UNITSYNC_WORKER", &worker);
    Ok((engine, game))
}
