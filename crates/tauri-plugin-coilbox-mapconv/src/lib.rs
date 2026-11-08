//! mapconv plugin (Rust half). Shells out to the bundled SpringMapConvNG
//! sidecars — `mapcompile` (build a `.smf`/`.smt` from source images) and
//! `mapdecompile` (extract source images from a `.smf`) — streaming the live log
//! over a Tauri [`Channel`]. Results are returned as a [`CliResult`] envelope,
//! matching every other picoframe plugin.

mod archive;
mod install;
mod luapatch;
mod mapinfo;
mod mapinfo_write;
mod sidecar;
mod smf;

use image::GenericImageView;
use picoframe_core::CliResult;
use serde_json::json;
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
    let mut cmd = coilbox_proc::command(&bin);
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

/// The directories searched for a map's `mapinfo.lua` near a chosen path: the
/// path's own directory (or itself when it's a directory) and its parent.
fn nearby_dirs(base: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![base.to_path_buf()];
    if let Some(parent) = base.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs
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
        let dirs = nearby_dirs(&base);

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

/// A skybox DDS is read up to this size (a 1024² DXT5 cube map with mips is
/// ~8 MiB; leave headroom for uncompressed or larger faces).
const SKYBOX_MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Normalise a `mapinfo` file reference to a safe relative path: forward slashes,
/// no leading `/`, and rejecting any `..` component so a reference can't escape the
/// map directory. `None` when it resolves to nothing usable.
fn sanitize_rel(reference: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in reference.replace('\\', "/").split('/') {
        match comp {
            "" | "." => continue,
            ".." => return None,
            other => out.push(other),
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// `mc_read_skybox` — read a map's `atmosphere.skyBox` DDS (a loose file next to
/// `mapinfo.lua`) and return it as a raw-bytes `data:` URL for the 3D preview's
/// sky. Locates `mapinfo.lua` near `path` (same search as `mc_read_mapinfo`), reads
/// its skybox reference, resolves the referenced file within the map directory, and
/// base64-wraps it. Returns `{ dataUrl }` — `dataUrl` is null when the map declares
/// no skybox or the file is missing/oversized, so the preview keeps its flat sky.
#[tauri::command]
async fn mc_read_skybox(path: String) -> CliResult {
    let result = tauri::async_runtime::spawn_blocking(move || -> Option<String> {
        let p = PathBuf::from(&path);
        let base = if p.is_dir() {
            p.clone()
        } else {
            p.parent().map(Path::to_path_buf).unwrap_or(p)
        };
        let dirs = nearby_dirs(&base);

        // Find mapinfo.lua and read its skyBox reference (eval first, then scanner).
        let mut reference = None;
        let mut mapinfo_dir = None;
        for d in &dirs {
            if let Ok(src) = std::fs::read_to_string(d.join("mapinfo.lua")) {
                let info = mapinfo::eval_appearance(d, &src)
                    .unwrap_or_else(|| mapinfo::parse_appearance(&src));
                reference = info.sky_box;
                mapinfo_dir = Some(d.clone());
                break;
            }
        }
        let rel = sanitize_rel(&reference?)?;

        // Resolve the referenced file relative to the mapinfo dir (then its
        // neighbours), read it, and wrap as a data URL.
        let mut search = Vec::new();
        if let Some(d) = mapinfo_dir {
            search.push(d);
        }
        search.extend(dirs.iter().cloned());
        for d in &search {
            let candidate = d.join(&rel);
            if let Ok(meta) = std::fs::metadata(&candidate) {
                if meta.is_file() && meta.len() <= SKYBOX_MAX_BYTES {
                    if let Ok(bytes) = std::fs::read(&candidate) {
                        return Some(format!(
                            "data:application/octet-stream;base64,{}",
                            base64_encode(&bytes)
                        ));
                    }
                }
            }
        }
        None
    })
    .await;
    match result {
        Ok(url) => CliResult::ok(json!({ "dataUrl": url })),
        Err(e) => CliResult::err(format!("skybox task failed: {e}")),
    }
}

/// Subdirectory of the app cache dir holding source-image thumbnails: the PNG
/// itself, and a JSON record of the source's true pixel size beside it.
const THUMB_CACHE_SUBDIR: &str = "mapconv-thumbs";

/// Where the thumbnails live, under the app cache dir. `None` when the platform
/// cannot resolve a cache dir, and thumbnails are then simply not cached. Public
/// because the asset protocol serves this folder as its `mapconvthumb` root.
pub fn thumb_cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    coilbox_portable::cache_dir(app)
        .ok()
        .map(|d| d.join(THUMB_CACHE_SUBDIR))
}

/// The source image's true pixel size, cached beside its thumbnail so a hit can
/// answer without decoding the source again. The picture itself is the PNG next
/// to this, not a `data:` URL in it (#1694).
#[derive(serde::Serialize, serde::Deserialize)]
struct ThumbEntry {
    width: u32,
    height: u32,
}

/// One source image's thumbnail pass: the source's true pixel size, and the
/// picture as either the cache file the webview fetches over
/// `coilbox://mapconvthumb/` or, when there was nowhere to write it, inline.
struct ThumbResult {
    width: u32,
    height: u32,
    file: Option<String>,
    data_url: Option<String>,
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

/// Decode `path` into (width, height, thumbnail PNG bytes).
fn generate_thumb(path: &str, max: u32) -> Result<(u32, u32, Vec<u8>), String> {
    let img = image::open(path).map_err(|e| format!("could not read image: {e}"))?;
    let (width, height) = img.dimensions();
    let thumb = img.thumbnail(max, max);
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("could not encode thumbnail: {e}"))?;
    Ok((width, height, buf.into_inner()))
}

/// One heightmap file's samples as the engine's own 16 bit words, decimated to
/// `max` on the longer edge (issue #1730).
///
/// The 3D preview displaced its terrain from a thumbnail, and a browser flattens
/// an image to eight bits a channel on the way in whatever the file holds. A
/// gentle slope then collapses into flat steps, and shading turns those steps
/// into contour rings across a surface the author is about to compile.
///
/// Decimated here rather than in the webview because nothing downstream can draw
/// past the preview mesh's vertex count, and a 4097 sample heightmap sent whole
/// is 33 MB over the asset protocol for detail no pixel shows. `thumbnail`
/// averages, so a peak between two kept columns lifts its neighbours instead of
/// vanishing, and it does not ring the way a windowed sinc does.
///
/// Little endian, which is what a `Uint16Array` over the bytes reads on every
/// platform coilbox ships on.
fn height_words(path: &str, max: u32) -> Result<(u32, u32, Vec<u8>), String> {
    let img = image::open(path).map_err(|e| format!("could not read image: {e}"))?;
    let scaled = img.thumbnail(max, max);
    let (width, height) = scaled.dimensions();
    let grey = scaled.to_luma16();
    let mut bytes = Vec::with_capacity(grey.as_raw().len() * 2);
    for word in grey.as_raw() {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    Ok((width, height, bytes))
}

/// Thumbnail with an on-disk cache under `cache_dir`, keyed on
/// path+mtime+size+max, so a cold start doesn't re-decode every source image.
///
/// Two files per key: `<key>.png` is the picture the webview loads over the
/// asset protocol, and `<key>.json` is the source's true pixel size, which a hit
/// needs and the PNG cannot answer. A hit needs both, so a cache clean that took
/// the picture re-decodes rather than answering with a name pointing at nothing.
/// Inlining is the fallback for no cache dir or a failed write.
fn image_info_cached(
    path: &str,
    max: u32,
    cache_dir: Option<&Path>,
) -> Result<ThumbResult, String> {
    let files = cache_dir.zip(thumb_cache_key(path, max)).map(|(dir, key)| {
        let name = format!("{key}.png");
        (dir.join(format!("{key}.json")), dir.join(&name), name)
    });

    if let Some((dims, png, name)) = &files {
        if let Some(entry) = std::fs::read(dims)
            .ok()
            .and_then(|raw| serde_json::from_slice::<ThumbEntry>(&raw).ok())
        {
            if png.is_file() {
                // Serving an entry is using it, which is what the sweep in the
                // shared cache reads recency off.
                coilbox_thumb_cache::touch(png);
                return Ok(ThumbResult {
                    width: entry.width,
                    height: entry.height,
                    file: Some(name.clone()),
                    data_url: None,
                });
            }
        }
    }

    let (width, height, bytes) = generate_thumb(path, max)?;
    if let Some((dims, png, name)) = &files {
        if let Some(dir) = png.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(png, &bytes).is_ok() {
            if let Ok(json) = serde_json::to_vec(&ThumbEntry { width, height }) {
                let _ = std::fs::write(dims, json);
            }
            return Ok(ThumbResult {
                width,
                height,
                file: Some(name.clone()),
                data_url: None,
            });
        }
    }
    Ok(ThumbResult {
        width,
        height,
        file: None,
        data_url: Some(format!("data:image/png;base64,{}", base64_encode(&bytes))),
    })
}

/// One heightmap's words, written to the cache and reported by file name.
///
/// No inline fallback, unlike the thumbnails beside it. These are half a
/// megabyte of raw samples and base64 on the bridge is no way to move that, so a
/// run with nowhere to write says so and the preview falls back to the picture.
///
/// Two files per key, for the reason the thumbnail path has two: `<key>-hf.bin`
/// is the words and `<key>-hf.json` is the grid they are on, which a hit needs
/// and the bytes cannot answer on their own.
fn height_words_cached(
    path: &str,
    max: u32,
    cache_dir: Option<&Path>,
) -> Result<(u32, u32, String), String> {
    let (dir, key) = cache_dir
        .zip(thumb_cache_key(path, max))
        .ok_or_else(|| "no cache directory to write the heights to".to_string())?;
    let name = format!("{key}-hf.bin");
    let grid = dir.join(&name);
    let dims = dir.join(format!("{key}-hf.json"));

    if let Some(entry) = std::fs::read(&dims)
        .ok()
        .and_then(|raw| serde_json::from_slice::<ThumbEntry>(&raw).ok())
    {
        if grid.is_file() {
            coilbox_thumb_cache::touch(&grid);
            return Ok((entry.width, entry.height, name));
        }
    }

    let (width, height, bytes) = height_words(path, max)?;
    let _ = std::fs::create_dir_all(dir);
    std::fs::write(&grid, &bytes).map_err(|e| format!("could not write the heights: {e}"))?;
    if let Ok(json) = serde_json::to_vec(&ThumbEntry { width, height }) {
        let _ = std::fs::write(&dims, json);
    }
    Ok((width, height, name))
}

/// `mc_height_field` decodes the heightmap at `path` and writes its samples out
/// as raw 16 bit words for the 3D preview to displace from, rather than the
/// eight bits a browser gets out of any picture (issue #1730).
///
/// `max` is the grid's longest edge, which the caller sets from the preview
/// mesh's own vertex count so the number lives in one place.
#[tauri::command]
async fn mc_height_field<R: Runtime>(app: AppHandle<R>, path: String, max: u32) -> CliResult {
    let max = max.max(1);
    let cache_dir = thumb_cache_dir(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        height_words_cached(&path, max, cache_dir.as_deref())
    })
    .await;
    match result {
        Ok(Ok((width, height, file))) => CliResult::ok(json!({
            "width": width,
            "height": height,
            "file": file,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("height task failed: {e}")),
    }
}

/// The compiled map's metal map in the cache under `<key>-smfm.bin`, by file
/// name. A cache file of the wrong length is a write that did not finish.
fn metal_cached(
    path: &str,
    metal: &smf::SmfMetal,
    dir: &Path,
    key: &str,
) -> Result<String, String> {
    let name = format!("{key}-smfm.bin");
    let file = dir.join(&name);
    if std::fs::metadata(&file).is_ok_and(|m| m.is_file() && m.len() == metal.len as u64) {
        coilbox_thumb_cache::touch(&file);
    } else {
        let bytes = smf::read_smf_metal(Path::new(path), metal)?;
        let _ = std::fs::create_dir_all(dir);
        std::fs::write(&file, &bytes).map_err(|e| format!("could not write the metal map: {e}"))?;
    }
    Ok(name)
}

/// A compiled map's height words and metal map, written to the cache under
/// `<key>-smf.bin` and `<key>-smfm.bin` and reported by file name with the grids
/// and range they are on. Keyed by the file's size and modification time, so a
/// new compile is read afresh.
///
/// `metalFile` is left out when the metal map does not lie inside the file or
/// could not be read, and `metalError` says why in the second case, so the panel
/// can say there is none to read.
fn smf_heights_cached(path: &str, cache_dir: Option<&Path>) -> Result<serde_json::Value, String> {
    // The header first, so a missing or broken map says so rather than
    // anything about the cache.
    let at = smf::locate_smf_heights(Path::new(path))?;
    let (dir, key) = cache_dir
        .zip(thumb_cache_key(path, 0))
        .ok_or_else(|| "no cache directory to write the heights to".to_string())?;
    let name = format!("{key}-smf.bin");
    let grid = dir.join(&name);
    // A cache file of the wrong length is a write that did not finish.
    let cached = std::fs::metadata(&grid).is_ok_and(|m| m.len() == at.len as u64);
    if cached {
        coilbox_thumb_cache::touch(&grid);
    } else {
        let bytes = smf::read_smf_heights(Path::new(path), &at)?;
        let _ = std::fs::create_dir_all(dir);
        std::fs::write(&grid, &bytes).map_err(|e| format!("could not write the heights: {e}"))?;
    }
    let mut out = json!({
        "file": name,
        "width": at.info.mapx + 1,
        "height": at.info.mapy + 1,
        "minHeight": at.info.min_height,
        "maxHeight": at.info.max_height,
    });
    if let Some(metal) = &at.metal {
        // The metal map is extra. A read or write that fails is reported beside
        // the heights, which are still good.
        match metal_cached(path, metal, dir, &key) {
            Ok(metal_name) => {
                out["metalFile"] = json!(metal_name);
                out["metalWidth"] = json!(metal.width);
                out["metalHeight"] = json!(metal.height);
            }
            Err(e) => out["metalError"] = json!(e),
        }
    }
    Ok(out)
}

/// `mc_smf_heights` reads the heights and the metal map out of a compiled
/// `.smf`, for the playability panel to measure the map the compile actually
/// wrote (issues #2169 and #5098).
#[tauri::command]
async fn mc_smf_heights<R: Runtime>(app: AppHandle<R>, path: String) -> CliResult {
    let cache_dir = thumb_cache_dir(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        smf_heights_cached(&path, cache_dir.as_deref())
    })
    .await;
    match result {
        Ok(Ok(v)) => CliResult::ok(v),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("height task failed: {e}")),
    }
}

/// `mc_image_info` decodes the image at `path` and returns its true pixel
/// dimensions plus a small downscaled PNG thumbnail. Lets the UI preview chosen
/// source assets and validate texture sizing (multiple of 1024) up front,
/// without an asset-protocol grant on the source itself. `max` is the
/// thumbnail's longest side, 320 by default, and the 3D preview asks for larger
/// so the heightmap displaces with enough detail. Results are cached on disk
/// (keyed by file mtime/size) so reopening a page, or relaunching the app,
/// doesn't re-decode large textures.
///
/// The thumbnail comes back as `thumbFile`, a name under
/// `coilbox://mapconvthumb/`, with `thumb` holding a `data:` URL only where
/// there was nowhere to cache it.
#[tauri::command]
async fn mc_image_info<R: Runtime>(app: AppHandle<R>, path: String, max: Option<u32>) -> CliResult {
    let max = max.unwrap_or(320).max(1);
    let cache_dir = thumb_cache_dir(&app);
    let result = tauri::async_runtime::spawn_blocking(move || {
        image_info_cached(&path, max, cache_dir.as_deref())
    })
    .await;
    match result {
        Ok(Ok(t)) => CliResult::ok(json!({
            "width": t.width,
            "height": t.height,
            "thumbFile": t.file,
            "thumb": t.data_url,
        })),
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
    if let Err(e) = coilbox_portable::refuse_read_only(&out_dir) {
        return Ok(CliResult::err(e));
    }
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

/// `mc_read_teams` — the start positions in `<outDir>/mapinfo.lua`, one slot per
/// team in team order (`null` for a team with none). Empty when there is no file
/// or it has no teams. Returns `{ teams }`.
#[tauri::command]
async fn mc_read_teams(out_dir: String) -> CliResult {
    match tauri::async_runtime::spawn_blocking(move || {
        mapinfo_write::read_teams(Path::new(&out_dir))
    })
    .await
    {
        Ok(Ok(teams)) => CliResult::ok(json!({
            "teams": teams
                .iter()
                .map(|t| t.map(|p| json!({ "x": p.x, "z": p.z })))
                .collect::<Vec<_>>(),
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("mapinfo task failed: {e}")),
    }
}

/// `mc_write_mapinfo` — write `<outDir>/mapinfo.lua` for a map `mc_compile` just
/// built. Creates the file, or patches the one already there so every field the
/// page does not own survives. Returns `{ path, created, changed }`.
#[tauri::command]
async fn mc_write_mapinfo(opts: mapinfo_write::WriteOpts) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&opts.out_dir)) {
        return CliResult::err(e);
    }
    match tauri::async_runtime::spawn_blocking(move || mapinfo_write::write(&opts)).await {
        Ok(Ok(w)) => CliResult::ok(json!({
            "path": w.path.to_string_lossy(),
            "created": w.created,
            "changed": w.changed,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("mapinfo task failed: {e}")),
    }
}

/// `mc_package_map` writes `<outDir>/<outSuffix>.sdz` from a finished compile and
/// the `mapinfo.lua` beside it. Returns `{ path, files }`.
#[tauri::command]
async fn mc_package_map(out_dir: String, out_suffix: String) -> CliResult {
    if let Err(e) = coilbox_portable::refuse_read_only(Path::new(&out_dir)) {
        return CliResult::err(e);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        archive::pack_map(Path::new(&out_dir), &out_suffix)
    })
    .await;
    match result {
        Ok(Ok(p)) => CliResult::ok(json!({
            "path": p.path.to_string_lossy(),
            "files": p.files,
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("package task failed: {e}")),
    }
}

/// `mc_install_map` copies a packed `.sdz` into `<rootPath>/maps/`. Returns
/// `{ installed, replaced, path }`. When an archive with that name is already
/// there and `replace` is not set, nothing is copied and `installed` is false.
#[tauri::command]
async fn mc_install_map(sdz_path: String, root_path: String, replace: bool) -> CliResult {
    let maps = Path::new(&root_path).join("maps");
    if let Err(e) = coilbox_portable::refuse_read_only(&maps) {
        return CliResult::err(e);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        install::install_map(Path::new(&sdz_path), Path::new(&root_path), replace)
    })
    .await;
    match result {
        Ok(Ok(install::Outcome::Installed { path, replaced })) => CliResult::ok(json!({
            "installed": true,
            "replaced": replaced,
            "path": path.to_string_lossy(),
        })),
        Ok(Ok(install::Outcome::Exists { path })) => CliResult::ok(json!({
            "installed": false,
            "replaced": false,
            "path": path.to_string_lossy(),
        })),
        Ok(Err(e)) => CliResult::err(e),
        Err(e) => CliResult::err(format!("install task failed: {e}")),
    }
}

/// Write `metalmap.png` in `directory` from the `.smf`'s own metal map, north
/// row first, which is the way round `mapcompile` reads it back. Up to at least
/// SpringMapConvNG 1.3.0, `mapdecompile` writes the metal map flipped north to
/// south while every other layer comes out the right way round, so compiling
/// what it wrote moved the metal (#5106).
fn write_metal_png(directory: &Path, mapfile: &str) -> Result<(), String> {
    let smf_path = directory.join(mapfile);
    let at = smf::locate_smf_heights(&smf_path)?;
    let metal = at.metal.ok_or("the SMF has no metal map inside it")?;
    let bytes = smf::read_smf_metal(&smf_path, &metal)?;
    image::GrayImage::from_raw(metal.width as u32, metal.height as u32, bytes)
        .ok_or("the metal map is the wrong size")?
        .save(directory.join("metalmap.png"))
        .map_err(|e| format!("could not write metalmap.png: {e}"))
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
            if let Err(e) = write_metal_png(&directory, &mapfile) {
                return Ok(CliResult::err(format!(
                    "could not write the metal map the right way round: {e}"
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
    // `cmd` is console-mode, so without CREATE_NO_WINDOW it flashes a prompt
    // while handing the url to the default browser.
    let spawned = coilbox_proc::command("cmd")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open").arg(&url).spawn();

    match spawned {
        Ok(_) => CliResult::ok(json!({ "opened": true })),
        Err(e) => CliResult::err(format!("could not open url: {e}")),
    }
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
            mc_read_skybox,
            mc_image_info,
            mc_height_field,
            mc_smf_heights,
            mc_compile,
            mc_read_teams,
            mc_write_mapinfo,
            mc_package_map,
            mc_install_map,
            mc_decompile,
            mc_cancel,
            mc_open_path,
            mc_open_url
        ])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coilbox-mapconv-thumb-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A 4 by 2 square map with a 2 by 1 metal map, as a compiled `.smf`.
    fn small_smf(dir: &Path) -> String {
        let mut b = vec![0u8; 80];
        b[..15].copy_from_slice(b"spring map file");
        b[24..28].copy_from_slice(&4i32.to_le_bytes());
        b[28..32].copy_from_slice(&2i32.to_le_bytes());
        b[32..36].copy_from_slice(&8i32.to_le_bytes());
        b[52..56].copy_from_slice(&82u32.to_le_bytes());
        b[68..72].copy_from_slice(&80u32.to_le_bytes());
        b.extend_from_slice(&[7, 200]);
        b.extend_from_slice(&[0u8; 30]);
        let path = dir.join("small.smf");
        std::fs::write(&path, &b).unwrap();
        path.to_string_lossy().into_owned()
    }

    /// The metal map is extra: when it cannot be cached the heights still come
    /// back, with the reason beside them and no metal file named.
    #[test]
    fn a_metal_map_that_cannot_be_cached_does_not_take_the_heights_with_it() {
        let dir = temp_dir("metal-fails");
        let path = small_smf(&dir);
        let cache = dir.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        let key = thumb_cache_key(&path, 0).unwrap();
        // A directory where the metal file belongs, so it is neither a hit
        // nor writable.
        std::fs::create_dir_all(cache.join(format!("{key}-smfm.bin"))).unwrap();

        let out = smf_heights_cached(&path, Some(&cache)).unwrap();
        assert_eq!(out["width"], 5);
        assert!(out["file"].is_string());
        assert!(out.get("metalFile").is_none());
        assert!(out["metalError"].as_str().unwrap().contains("metal map"));

        std::fs::remove_dir_all(cache.join(format!("{key}-smfm.bin"))).unwrap();
        let out = smf_heights_cached(&path, Some(&cache)).unwrap();
        assert_eq!(out["metalFile"], format!("{key}-smfm.bin"));
        assert_eq!(
            (out["metalWidth"].as_i64(), out["metalHeight"].as_i64()),
            (Some(2), Some(1))
        );
        assert_eq!(
            std::fs::read(cache.join(format!("{key}-smfm.bin"))).unwrap(),
            vec![7, 200]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A source image on disk, wider than it is tall so the thumbnail's own
    /// proportions cannot be mistaken for the source's reported size.
    fn source(dir: &Path) -> String {
        let path = dir.join("source.png");
        image::RgbaImage::from_pixel(64, 32, image::Rgba([10, 20, 30, 255]))
            .save(&path)
            .unwrap();
        path.to_string_lossy().into_owned()
    }

    /// The whole of #1694 for this cache: the picture is a file, and what comes
    /// back names it. The source's true size still comes back with it.
    #[test]
    fn a_thumbnail_is_written_as_a_file_and_named_rather_than_inlined() {
        let dir = temp_dir("write");
        let path = source(&dir);
        let cache = dir.join("cache");

        let out = image_info_cached(&path, 16, Some(&cache)).unwrap();
        assert_eq!((out.width, out.height), (64, 32));
        assert_eq!(out.data_url, None);
        let name = out.file.expect("the thumbnail is named");
        assert_eq!(&std::fs::read(cache.join(&name)).unwrap()[1..4], b"PNG");

        // And a second ask answers from disk without decoding the source again,
        // which is only visible as the same name over the same bytes.
        let again = image_info_cached(&path, 16, Some(&cache)).unwrap();
        assert_eq!(again.file.as_deref(), Some(name.as_str()));
        assert_eq!((again.width, again.height), (64, 32));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// With no cache dir there is no file to point at, so a preview still gets
    /// its picture, just inline.
    #[test]
    fn a_thumbnail_with_nowhere_to_go_falls_back_to_base64() {
        let dir = temp_dir("inline");
        let out = image_info_cached(&source(&dir), 16, None).unwrap();
        assert_eq!(out.file, None);
        assert!(out.data_url.unwrap().starts_with("data:image/png;base64,"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A cache clean takes the PNG and leaves the size record. Answering from
    /// that record would name a file that is not there.
    #[test]
    fn a_record_whose_thumbnail_file_is_gone_re_decodes() {
        let dir = temp_dir("gone");
        let path = source(&dir);
        let cache = dir.join("cache");

        let first = image_info_cached(&path, 16, Some(&cache)).unwrap();
        let name = first.file.unwrap();
        std::fs::remove_file(cache.join(&name)).unwrap();

        let again = image_info_cached(&path, 16, Some(&cache)).unwrap();
        assert_eq!(again.file.as_deref(), Some(name.as_str()));
        assert!(cache.join(&name).is_file(), "the picture is written again");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_source_is_an_error_rather_than_an_empty_thumbnail() {
        let dir = temp_dir("bad");
        let path = dir.join("not-an-image.png");
        std::fs::write(&path, b"nonsense").unwrap();
        assert!(image_info_cached(&path.to_string_lossy(), 16, None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A 4 by 4 square map whose 2 by 2 metal map reads 1, 2 on its north row
    /// and 3, 4 on its south row.
    fn square_smf(dir: &Path) -> String {
        let mut b = vec![0u8; 80];
        b[..15].copy_from_slice(b"spring map file");
        b[24..28].copy_from_slice(&4i32.to_le_bytes());
        b[28..32].copy_from_slice(&4i32.to_le_bytes());
        b[32..36].copy_from_slice(&8i32.to_le_bytes());
        b[52..56].copy_from_slice(&80u32.to_le_bytes());
        b[68..72].copy_from_slice(&130u32.to_le_bytes());
        b.extend_from_slice(&[0u8; 50]);
        b.extend_from_slice(&[1, 2, 3, 4]);
        let path = dir.join("square.smf");
        std::fs::write(&path, &b).unwrap();
        "square.smf".into()
    }

    /// #5106: the metal map mapdecompile wrote was upside down. Whatever it
    /// wrote, the decompiled folder ends up with the `.smf`'s own metal map,
    /// north row at the top of the picture.
    #[test]
    fn the_decompiled_metal_map_has_north_at_the_top() {
        let dir = temp_dir("metal-png");
        let mapfile = square_smf(&dir);
        // What mapdecompile 1.3.0 leaves behind: the same map flipped.
        image::GrayImage::from_raw(2, 2, vec![3, 4, 1, 2])
            .unwrap()
            .save(dir.join("metalmap.png"))
            .unwrap();

        write_metal_png(&dir, &mapfile).unwrap();

        let png = image::open(dir.join("metalmap.png")).unwrap().into_luma8();
        assert_eq!(png.dimensions(), (2, 2));
        assert_eq!(png.into_raw(), vec![1, 2, 3, 4]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_map_with_no_metal_map_inside_it_is_an_error() {
        let dir = temp_dir("metal-missing");
        let mapfile = square_smf(&dir);
        let mut b = std::fs::read(dir.join(&mapfile)).unwrap();
        b.truncate(131);
        std::fs::write(dir.join(&mapfile), &b).unwrap();
        assert!(write_metal_png(&dir, &mapfile)
            .unwrap_err()
            .contains("no metal map"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Byte layers of a compiled `.smf` read straight from its pointers: the
    /// heights, the type map, the metal map and the features as
    /// `(name, x, z, heading)`.
    struct Layers {
        heights: Vec<u8>,
        types: Vec<u8>,
        metal: Vec<u8>,
        features: Vec<(String, f32, f32, f32)>,
    }

    fn read_layers(path: &Path) -> Layers {
        let b = std::fs::read(path).unwrap();
        let int = |at: usize| i32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        let float = |at: usize| f32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        let (mapx, mapy) = (int(24) as usize, int(28) as usize);
        let cells = mapx / 2 * mapy / 2;
        let slice = |ptr: usize, len: usize| b[int(ptr) as usize..int(ptr) as usize + len].to_vec();
        let mut at = int(72) as usize;
        let (types, count) = (int(at), int(at + 4));
        at += 8;
        let mut names = Vec::new();
        for _ in 0..types {
            let end = at + b[at..].iter().position(|&c| c == 0).unwrap();
            names.push(String::from_utf8(b[at..end].to_vec()).unwrap());
            at = end + 1;
        }
        let features = (0..count as usize)
            .map(|i| {
                let f = at + 24 * i;
                (
                    names[int(f) as usize].clone(),
                    float(f + 4),
                    float(f + 12),
                    float(f + 16),
                )
            })
            .collect();
        Layers {
            heights: slice(52, (mapx + 1) * (mapy + 1) * 2),
            types: slice(56, cells),
            metal: slice(68, cells),
            features,
        }
    }

    /// Mean difference per channel between two pictures of one size, and
    /// between the first and the second turned upside down.
    fn difference_in_place_and_flipped(a: &image::RgbImage, b: &image::RgbImage) -> (f64, f64) {
        let flipped = image::imageops::flip_vertical(b);
        let mean = |other: &image::RgbImage| {
            let total: u64 = a
                .as_raw()
                .iter()
                .zip(other.as_raw())
                .map(|(x, y)| u64::from(x.abs_diff(*y)))
                .sum();
            total as f64 / a.as_raw().len() as f64
        };
        (mean(b), mean(&flipped))
    }

    fn run(bin: &Path, dir: &Path, args: &[&str]) {
        let out = std::process::Command::new(bin)
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{} failed: {}",
            bin.display(),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// #5106 end to end: compile a map from made-up sources, decompile it the
    /// way the Decompile page does, compile what that wrote, and check every
    /// layer of the second map is where it was in the first.
    #[test]
    #[ignore = "needs the SpringMapConvNG release folder holding mapcompile and mapdecompile in COILBOX_MAPCONV_DIR"]
    fn a_decompiled_map_compiles_back_with_every_layer_in_place() {
        let tools = PathBuf::from(std::env::var("COILBOX_MAPCONV_DIR").unwrap());
        let (compile, decompile) = (tools.join("mapcompile"), tools.join("mapdecompile"));
        let root = temp_dir("round-trip");
        let (src, first, second) = (root.join("src"), root.join("first"), root.join("second"));
        for d in [&src, &first, &second] {
            std::fs::create_dir_all(d).unwrap();
        }

        // A 128 by 128 square map. Every source differs from itself upside
        // down, so a flip in any layer shows.
        let texture = image::RgbImage::from_fn(1024, 1024, |x, y| {
            image::Rgb([(x / 4) as u8, (y / 4) as u8, 0])
        });
        texture.save(src.join("texture.png")).unwrap();
        texture.save(src.join("minimap.png")).unwrap();
        image::ImageBuffer::<image::Luma<u16>, _>::from_fn(129, 129, |x, y| {
            image::Luma([((y * 129 + x) * 3) as u16])
        })
        .save(src.join("heightmap.png"))
        .unwrap();
        // mapcompile turns grey 91, 182 and 203 into one less, so the metal
        // here keeps to the levels it reads back exactly.
        let metal: Vec<u8> = (0..64 * 64u32)
            .map(|i| match (i % 64 * 3 + i / 64) as u8 {
                v @ (91 | 182 | 203) => v + 1,
                v => v,
            })
            .collect();
        assert!(!metal.iter().any(|v| [91, 182, 203].contains(v)));
        image::GrayImage::from_raw(64, 64, metal.clone())
            .unwrap()
            .save(src.join("metalmap.png"))
            .unwrap();
        image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x + 2 * y) % 8) as u8]))
            .save(src.join("typemap.png"))
            .unwrap();
        std::fs::write(src.join("features.txt"), "rock1 100 50 900 90\n").unwrap();

        let compile_from = |from: &Path, out: &Path| {
            let file = |name: &str| from.join(name).to_string_lossy().into_owned();
            run(
                &compile,
                out,
                &[
                    "-t",
                    &file("texture.png"),
                    "-h",
                    &file("heightmap.png"),
                    "-m",
                    &file("metalmap.png"),
                    "-z",
                    &file("typemap.png"),
                    "-minimap",
                    &file("minimap.png"),
                    "-features",
                    &file("features.txt"),
                    "-minh",
                    "0",
                    "-maxh",
                    "100",
                    "-noclamp",
                    "-ct",
                    "1",
                    "-o",
                    "rt",
                ],
            );
        };
        compile_from(&src, &first);
        for name in ["rt.smf", "rt.smt"] {
            std::fs::copy(first.join(name), second.join(name)).unwrap();
        }
        run(
            &decompile,
            &second,
            &[
                "-directory",
                &second.to_string_lossy(),
                "-mapfile",
                "rt.smf",
            ],
        );
        write_metal_png(&second, "rt.smf").unwrap();
        let third = root.join("third");
        std::fs::create_dir_all(&third).unwrap();
        compile_from(&second, &third);

        let (a, b) = (
            read_layers(&first.join("rt.smf")),
            read_layers(&third.join("rt.smf")),
        );
        assert_eq!(a.metal, metal, "mapcompile reads the metal north row first");
        assert!(a.heights == b.heights, "the heights moved");
        assert!(a.types == b.types, "the type map moved");
        assert!(a.metal == b.metal, "the metal moved");
        assert_eq!(a.features.len(), 1);
        assert_eq!(b.features.len(), 1);
        let ((an, ax, az, ah), (bn, bx, bz, bh)) = (&a.features[0], &b.features[0]);
        assert_eq!((an, ax, az), (bn, bx, bz), "the feature moved");
        // The headings pass through features.txt as degrees printed with %f.
        assert!(
            (ah - bh).abs() < 1.0,
            "the feature turned from {ah} to {bh}"
        );

        // The texture and minimap are DXT1 compressed, so they come back close
        // rather than exact. Each must be closer the way round it went in.
        for name in ["texture.png", "minimap.png"] {
            let back = image::open(second.join(name)).unwrap().into_rgb8();
            let (in_place, flipped) = difference_in_place_and_flipped(&texture, &back);
            assert!(
                in_place < flipped,
                "{name} came back upside down: {in_place} against {flipped}"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
