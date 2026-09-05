//! mapconv plugin (Rust half). Shells out to the bundled SpringMapConvNG
//! sidecars — `mapcompile` (build a `.smf`/`.smt` from source images) and
//! `mapdecompile` (extract source images from a `.smf`) — streaming the live log
//! over a Tauri [`Channel`]. Results are returned as a [`CliResult`] envelope,
//! matching every other picoframe plugin.

mod archive;
mod mapinfo;
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
            mc_compile,
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
}
