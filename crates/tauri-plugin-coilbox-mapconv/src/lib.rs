//! mapconv plugin (Rust half). Shells out to the bundled SpringMapConvNG
//! sidecars — `mapcompile` (build a `.smf`/`.smt` from source images) and
//! `mapdecompile` (extract source images from a `.smf`) — streaming the live log
//! over a Tauri [`Channel`]. Results are returned as a [`CliResult`] envelope,
//! matching every other picoframe plugin.

mod archive;
mod mapinfo;
mod settings;
mod sidecar;
mod smf;

use image::GenericImageView;
use picoframe_core::CliResult;
use serde_json::json;
use settings::{load_settings, save_settings, Settings};
use sidecar::{
    build_compile_args, build_decompile_args, match_sources, resolve_sidecar, CompileOpts,
    DecompileOpts, LogLine,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State,
};

/// Running children keyed by frontend-supplied run id, so `mc_cancel` can kill a
/// run in flight. A run removes its own entry when it finishes reaping.
type SharedRegistry = Arc<Mutex<HashMap<String, Child>>>;

/// Human-readable "sidecar missing" message naming the dev env override.
fn missing(name: &str) -> String {
    format!(
        "{name} sidecar not found. Bundle it via tauri.conf.json `externalBin` or set MAPCONV_{}_SIDECAR.",
        name.to_uppercase()
    )
}

/// Resolve a bundled sidecar via the app's resource dir (or the dev env override).
fn sidecar_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Option<PathBuf> {
    let base = app.path().resource_dir().ok();
    resolve_sidecar(base.as_deref(), name)
}

/// The plugin's settings-file path under app-data.
fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?
        .join("mapconv");
    Ok(base.join("settings.json"))
}

/// Standard base64 (no line breaks), for embedding the extracted minimap as a
/// `data:` URL the webview can render without an asset-protocol grant.
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(ALPHABET[(n >> 18 & 63) as usize] as char);
        out.push(ALPHABET[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Read one pipe line-by-line, forwarding each line to the frontend channel.
fn stream_pipe<Rd: std::io::Read>(rd: Rd, stream: &str, log: Channel<LogLine>) {
    use std::io::BufRead;
    for line in std::io::BufReader::new(rd).lines() {
        match line {
            Ok(l) => {
                let _ = log.send(LogLine {
                    stream: stream.into(),
                    line: l,
                });
            }
            Err(_) => break,
        }
    }
}

/// Synchronous run body (called on a blocking thread). Spawns a sidecar in
/// `cwd` (if given), streams stdout/stderr to `on_log`, then reaps it. Returns
/// the exit status, or an error if the run was cancelled mid-flight.
fn run_blocking(
    bin: PathBuf,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    run_id: String,
    reg: SharedRegistry,
    on_log: Channel<LogLine>,
) -> Result<std::process::ExitStatus, String> {
    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = &cwd {
        cmd.current_dir(d);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", bin.display()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    reg.lock().unwrap().insert(run_id.clone(), child);

    let out_log = on_log.clone();
    let out_handle = stdout.map(|s| std::thread::spawn(move || stream_pipe(s, "out", out_log)));
    let err_handle = stderr.map(|s| std::thread::spawn(move || stream_pipe(s, "err", on_log)));
    if let Some(h) = out_handle {
        let _ = h.join();
    }
    if let Some(h) = err_handle {
        let _ = h.join();
    }

    // Reap. If the entry is gone, mc_cancel killed it.
    match reg.lock().unwrap().remove(&run_id) {
        Some(mut c) => c.wait().map_err(|e| e.to_string()),
        None => Err("run was cancelled".into()),
    }
}

/// `mc_probe` — report which sidecars are bundled, without spawning anything
/// (these getopt binaries have no clean `--version`). Lets the UI warn up front.
#[tauri::command]
async fn mc_probe<R: Runtime>(app: AppHandle<R>) -> CliResult {
    let compile = sidecar_path(&app, "mapcompile").is_some();
    let decompile = sidecar_path(&app, "mapdecompile").is_some();
    CliResult::ok(
        json!({ "available": compile && decompile, "compile": compile, "decompile": decompile }),
    )
}

/// `mc_suggest_sources` — given a chosen main texture, scan its folder for
/// conventional sibling source files (heightmap.png, metalmap.png, …) and return
/// the matches as absolute paths so the UI can prefill empty fields.
#[tauri::command]
async fn mc_suggest_sources(texture_path: String) -> CliResult {
    let p = PathBuf::from(&texture_path);
    let dir = match p.parent() {
        Some(d) => d.to_path_buf(),
        None => return CliResult::ok(json!({})),
    };
    let mut files = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if let Some(name) = e.file_name().to_str() {
                files.push(name.to_string());
            }
        }
    }
    let s = match_sources(&files);
    let abs = |o: Option<String>| o.map(|f| dir.join(f).to_string_lossy().to_string());
    CliResult::ok(json!({
        "heightmap": abs(s.heightmap),
        "metalmap": abs(s.metalmap),
        "typemap": abs(s.typemap),
        "minimap": abs(s.minimap),
        "vegmap": abs(s.vegmap),
        "features": abs(s.features),
    }))
}

/// First `.smf` found directly inside any of `dirs` (the height fallback for
/// maps without a `mapinfo.lua`).
fn find_smf_near(dirs: &[PathBuf]) -> Option<PathBuf> {
    for d in dirs {
        if let Ok(rd) = std::fs::read_dir(d) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension()
                    .and_then(|x| x.to_str())
                    .is_some_and(|x| x.eq_ignore_ascii_case("smf"))
                {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// `mc_read_mapinfo` — best-effort read of a map's `mapinfo.lua` near `path` (a
/// chosen texture file, or a decompiled directory). Searches that location and
/// its parent for `mapinfo.lua` and pulls metadata + height + appearance hints.
/// If the height range is missing (old maps with no `mapinfo.lua`), it falls
/// back to a sibling `.smf` header. All fields are optional; callers prefill /
/// decorate with whatever is present.
#[tauri::command]
async fn mc_read_mapinfo(path: String) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        let base = if p.is_dir() {
            p.clone()
        } else {
            p.parent().map(Path::to_path_buf).unwrap_or(p)
        };
        let mut dirs = vec![base.clone()];
        if let Some(parent) = base.parent() {
            dirs.push(parent.to_path_buf());
        }

        let mut info = mapinfo::MapAppearance::default();
        for d in &dirs {
            if let Ok(src) = std::fs::read_to_string(d.join("mapinfo.lua")) {
                // Evaluate first (handles computed values + VFS.Include);
                // fall back to the literal scanner if evaluation fails.
                info = mapinfo::eval_appearance(d, &src)
                    .unwrap_or_else(|| mapinfo::parse_appearance(&src));
                break;
            }
        }
        if info.min_height.is_none() || info.max_height.is_none() {
            if let Some(smf) = find_smf_near(&dirs) {
                if let Ok(h) = std::fs::read(&smf)
                    .map_err(|e| e.to_string())
                    .and_then(|b| smf::parse_smf_header(&b))
                {
                    info.min_height.get_or_insert(h.min_height as f64);
                    info.max_height.get_or_insert(h.max_height as f64);
                }
            }
        }
        info
    })
    .await;
    match result {
        Ok(info) => CliResult::ok(serde_json::to_value(info).unwrap_or_else(|_| json!({}))),
        Err(e) => CliResult::err(format!("mapinfo task failed: {e}")),
    }
}

/// A cached thumbnail: the command's full result, stored as one JSON file per
/// cache key so a restart can return it without re-decoding the source.
#[derive(serde::Serialize, serde::Deserialize)]
struct ThumbEntry {
    width: u32,
    height: u32,
    thumb: String,
}

/// Cache key for a thumbnail — stable across runs, but invalidated when the
/// source file's mtime or size changes (so an edited/recompiled image refreshes).
/// `None` when the file can't be stat'd, which simply disables caching for it.
fn thumb_cache_key(path: &str, max: u32) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    max.hash(&mut h);
    mtime.hash(&mut h);
    meta.len().hash(&mut h);
    Some(format!("{:016x}", h.finish()))
}

/// Decode `path` into (width, height, thumbnail-as-data-URL).
fn generate_thumb(path: &str, max: u32) -> Result<(u32, u32, String), String> {
    let img = image::open(path).map_err(|e| format!("could not read image: {e}"))?;
    let (width, height) = img.dimensions();
    let thumb = img.thumbnail(max, max);
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("could not encode thumbnail: {e}"))?;
    let data_url = format!("data:image/png;base64,{}", base64_encode(&buf.into_inner()));
    Ok((width, height, data_url))
}

/// Thumbnail with an on-disk cache (one JSON file per path+mtime+size+max) under
/// `cache_dir`, so a cold start doesn't re-decode every source image. Any cache
/// miss or failure falls back to a plain decode, then best-effort writes the
/// result back.
fn image_info_cached(
    path: &str,
    max: u32,
    cache_dir: Option<&Path>,
) -> Result<(u32, u32, String), String> {
    let cache_file = cache_dir
        .zip(thumb_cache_key(path, max))
        .map(|(dir, key)| dir.join(format!("{key}.json")));

    // The cache stores the whole `ThumbEntry` as JSON bytes (we need width/height
    // back, not just the image), so serialize on a miss and deserialize the result.
    let bytes = coilbox_thumb_cache::cached(cache_file, || {
        let (width, height, thumb) = generate_thumb(path, max)?;
        serde_json::to_vec(&ThumbEntry {
            width,
            height,
            thumb,
        })
        .map_err(|e| format!("could not encode thumbnail cache entry: {e}"))
    })?;
    let e: ThumbEntry = serde_json::from_slice(&bytes)
        .map_err(|e| format!("could not decode thumbnail cache entry: {e}"))?;
    Ok((e.width, e.height, e.thumb))
}

/// `mc_image_info` — decode the image at `path` and return its true pixel
/// dimensions plus a small downscaled PNG thumbnail as a `data:` URL. Lets the UI
/// preview chosen source assets and validate texture sizing (multiple of 1024)
/// up front, without an asset-protocol grant. `max` is the thumbnail's longest
/// side (default 320; the 3D preview asks for larger so the heightmap displaces
/// with enough detail). Results are cached on disk (keyed by file mtime/size) so
/// reopening a page — or relaunching the app — doesn't re-decode large textures.
#[tauri::command]
async fn mc_image_info<R: Runtime>(app: AppHandle<R>, path: String, max: Option<u32>) -> CliResult {
    let max = max.unwrap_or(320).max(1);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("mapconv-thumbs"));
    let result = tauri::async_runtime::spawn_blocking(move || {
        image_info_cached(&path, max, cache_dir.as_deref())
    })
    .await;
    match result {
        Ok(Ok((width, height, thumb))) => {
            CliResult::ok(json!({ "width": width, "height": height, "thumb": thumb }))
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("image task failed: {e}")),
    }
}

/// `mc_compile` — run `mapcompile` in `out_dir`, streaming output. Success means
/// exit 0 AND `<out_dir>/<outSuffix>.smf` exists.
#[tauri::command]
async fn mc_compile<R: Runtime>(
    app: AppHandle<R>,
    reg: State<'_, SharedRegistry>,
    opts: CompileOpts,
    out_dir: String,
    run_id: String,
    on_log: Channel<LogLine>,
) -> Result<CliResult, ()> {
    let bin = match sidecar_path(&app, "mapcompile") {
        Some(b) => b,
        None => return Ok(CliResult::err(missing("mapcompile"))),
    };
    let out_dir = PathBuf::from(&out_dir);
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return Ok(CliResult::err(format!("could not create output dir: {e}")));
    }
    let suffix = opts.out_suffix.clone();
    let args = build_compile_args(&opts);
    let reg = reg.inner().clone();
    let cwd = out_dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_blocking(bin, args, Some(cwd), run_id, reg, on_log)
    })
    .await;

    Ok(match result {
        Ok(Ok(status)) => {
            let smf = out_dir.join(format!("{suffix}.smf"));
            if status.success() && smf.exists() {
                CliResult::ok(json!({ "smfPath": smf.to_string_lossy(), "outSuffix": suffix }))
            } else if status.success() {
                CliResult::err(format!(
                    "mapcompile finished but {} was not written",
                    smf.display()
                ))
            } else {
                CliResult::err(match status.code() {
                    Some(c) => format!("mapcompile exited with code {c}"),
                    None => "mapcompile was terminated".into(),
                })
            }
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("compile task failed: {e}")),
    })
}

/// Resolve the decompile target into a `(directory, mapfile)` pair, extracting a
/// `.sdz`/`.sd7` archive next to itself first. Runs on the blocking thread.
fn prepare_decompile(input: &Path, on_log: &Channel<LogLine>) -> Result<(PathBuf, String), String> {
    // A directory input (e.g. a `.sdd` directory archive, or any extracted map
    // tree) is used in place — no extraction, just locate the inner `.smf`.
    if input.is_dir() {
        let smf = archive::find_smf(input).ok_or("no .smf found inside the directory")?;
        let _ = on_log.send(LogLine {
            stream: "out".into(),
            line: format!("Found map {}", smf.display()),
        });
        let dir = smf
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or("map file has no parent directory")?;
        let name = smf
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("invalid map filename")?
            .to_string();
        return Ok((dir, name));
    }

    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let smf = match ext.as_str() {
        "smf" => input.to_path_buf(),
        "sdz" | "sd7" => {
            let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("map");
            let dest = input
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(format!("{stem}.sdd"));
            let _ = on_log.send(LogLine {
                stream: "out".into(),
                line: format!("Extracting {}…", input.display()),
            });
            archive::extract_archive(input, &dest)?;
            let smf = archive::find_smf(&dest).ok_or("no .smf found inside the archive")?;
            let _ = on_log.send(LogLine {
                stream: "out".into(),
                line: format!("Found map {}", smf.display()),
            });
            smf
        }
        other => {
            return Err(format!(
                "unsupported input: .{other} (expected .smf, .sdz, .sd7 or a .sdd directory)"
            ))
        }
    };
    let dir = smf
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or("map file has no parent directory")?;
    let name = smf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid map filename")?
        .to_string();
    Ok((dir, name))
}

/// `mc_decompile` — extract source images from a `.smf`, or from a `.sdz`/`.sd7`
/// archive (extracted first). mapdecompile chdir's into the map's directory and
/// writes the images there. Resolves with the output directory, the parsed SMF
/// header, and the extracted minimap as a data URL.
#[tauri::command]
async fn mc_decompile<R: Runtime>(
    app: AppHandle<R>,
    reg: State<'_, SharedRegistry>,
    input_path: String,
    run_id: String,
    on_log: Channel<LogLine>,
) -> Result<CliResult, ()> {
    let bin = match sidecar_path(&app, "mapdecompile") {
        Some(b) => b,
        None => return Ok(CliResult::err(missing("mapdecompile"))),
    };
    let reg = reg.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (directory, mapfile) = prepare_decompile(Path::new(&input_path), &on_log)?;
        let opts = DecompileOpts {
            directory: directory.to_string_lossy().to_string(),
            mapfile: mapfile.clone(),
        };
        let status = run_blocking(bin, build_decompile_args(&opts), None, run_id, reg, on_log)?;
        Ok::<_, String>((directory, mapfile, status))
    })
    .await;

    Ok(match result {
        Ok(Ok((directory, mapfile, status))) => {
            let code = status.code().unwrap_or(-1);
            if !status.success() {
                return Ok(CliResult::err(format!(
                    "mapdecompile exited with code {code}"
                )));
            }
            let map_info = std::fs::read(directory.join(&mapfile))
                .ok()
                .and_then(|b| smf::parse_smf_header(&b).ok());
            let minimap = std::fs::read(directory.join("minimap.png"))
                .ok()
                .map(|b| format!("data:image/png;base64,{}", base64_encode(&b)));
            CliResult::ok(json!({
                "directory": directory.to_string_lossy(),
                "exitCode": code,
                "mapInfo": map_info,
                "minimap": minimap,
            }))
        }
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("decompile task failed: {e}")),
    })
}

/// `mc_cancel` — kill an in-flight run by id.
#[tauri::command]
async fn mc_cancel(reg: State<'_, SharedRegistry>, run_id: String) -> Result<CliResult, ()> {
    let child = reg.lock().unwrap().remove(&run_id);
    Ok(match child {
        Some(mut c) => {
            let _ = c.kill();
            let _ = c.wait();
            CliResult::ok(json!({ "cancelled": true }))
        }
        None => CliResult::ok(json!({ "cancelled": false })),
    })
}

/// `mc_open_path` — open a folder (or file's location) in the OS file manager,
/// so the user can get at the decompiled/compiled output.
#[tauri::command]
async fn mc_open_path(path: String) -> CliResult {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return CliResult::err(format!("path does not exist: {path}"));
    }
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(&p).spawn();
    #[cfg(target_os = "windows")]
    let spawned = Command::new("explorer").arg(&p).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(&p).spawn();

    match spawned {
        Ok(_) => CliResult::ok(json!({ "opened": true })),
        Err(e) => CliResult::err(format!("could not open path: {e}")),
    }
}

/// `mc_open_url` — open an external http(s) URL (e.g. a mapping wiki help page)
/// in the OS default browser. Unlike `mc_open_path` it does no filesystem check;
/// the scheme is restricted to http/https so we never hand an arbitrary scheme
/// to the shell opener.
#[tauri::command]
async fn mc_open_url(url: String) -> CliResult {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return CliResult::err(format!("refusing to open non-http url: {url}"));
    }
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let spawned = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(&url).spawn();

    match spawned {
        Ok(_) => CliResult::ok(json!({ "opened": true })),
        Err(e) => CliResult::err(format!("could not open url: {e}")),
    }
}

/// `mc_settings_load` — read the whole settings map, backing the frame's
/// `SettingsStorage` adapter at app boot.
#[tauri::command]
async fn mc_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<CliResult, ()> {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match load_settings(&path) {
        Ok(entries) => CliResult::ok(json!({ "entries": entries })),
        Err(e) => CliResult::err(e),
    })
}

/// `mc_settings_save` — persist the whole settings map (atomic overwrite).
#[tauri::command]
async fn mc_settings_save<R: Runtime>(
    app: AppHandle<R>,
    entries: Settings,
) -> Result<CliResult, ()> {
    let path = match settings_path(&app) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    Ok(match save_settings(&path, &entries) {
        Ok(()) => CliResult::ok(json!({})),
        Err(e) => CliResult::err(e),
    })
}

/// Build the plugin. Registered as `"coilbox-mapconv"` (crate name minus the
/// `tauri-plugin-` prefix); the frontend invokes `plugin:coilbox-mapconv|<cmd>`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("coilbox-mapconv")
        .setup(|app, _api| {
            app.manage(SharedRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            mc_probe,
            mc_suggest_sources,
            mc_read_mapinfo,
            mc_image_info,
            mc_compile,
            mc_decompile,
            mc_cancel,
            mc_open_path,
            mc_open_url,
            mc_settings_load,
            mc_settings_save
        ])
        .build()
}
