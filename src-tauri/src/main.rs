// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Work around a WebKitGTK + AppImage failure on Linux: the AppImage bundles its
// own (Ubuntu-built) libwayland-client and GPU stack, which shadow the host's
// and break EGL display creation on modern Wayland systems
// ("Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...",
// leaving a blank window or an outright abort). See release notes / issue
// history for the diagnosis.
//
// Two fixes, applied only when running from an AppImage so native .deb/.rpm
// installs and `tauri dev` are untouched:
//   1. Prefer the safer WebKit render paths via env vars (read at webview init).
//   2. On Wayland, re-exec once with the host's libwayland-client.so.0 in
//      LD_PRELOAD. The library is resolved by the dynamic linker before main()
//      runs, so setting an env var in-process can't help — only a fresh exec
//      with LD_PRELOAD set can force the host copy to win over the bundled one.
#[cfg(target_os = "linux")]
fn linux_appimage_webview_workaround() {
    use std::env;

    // Only inside an AppImage bundle (the runtime sets APPIMAGE to its path).
    if env::var_os("APPIMAGE").is_none() {
        return;
    }

    // Respect any value the user already set; otherwise pick the safe paths.
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    // The libwayland-client shadowing only bites on Wayland sessions.
    let on_wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE")
            .map(|v| v == "wayland")
            .unwrap_or(false);
    if !on_wayland {
        return;
    }
    // Don't loop forever, and don't clobber a user-provided preload.
    if env::var_os("COILBOX_WAYLAND_REEXEC").is_some() || env::var_os("LD_PRELOAD").is_some() {
        return;
    }

    // Find the host's 64-bit libwayland-client. lib64 first so 64-bit Fedora
    // doesn't pick the 32-bit /usr/lib copy; then the Debian multiarch path;
    // then Arch's /usr/lib.
    const CANDIDATES: &[&str] = &[
        "/usr/lib64/libwayland-client.so.0",
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
        "/usr/lib/libwayland-client.so.0",
    ];
    let Some(host_lib) = CANDIDATES.iter().find(|p| std::path::Path::new(p).exists()) else {
        return; // no host copy to preload; run as-is rather than risk a worse state
    };

    let Ok(exe) = env::current_exe() else {
        return;
    };

    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new(exe)
        .args(env::args_os().skip(1))
        .env("LD_PRELOAD", host_lib)
        .env("COILBOX_WAYLAND_REEXEC", "1")
        .exec();
    // exec() only returns on failure; fall through and try to run anyway.
    eprintln!("coilbox: libwayland re-exec failed, continuing without it: {err}");
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_appimage_webview_workaround();

    let mut builder = tauri::Builder::default()
        .plugin(picoframe_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    // picoframe:plugins-start
    builder = builder.plugin(tauri_plugin_coilbox_downloads::init());
    builder = builder.plugin(tauri_plugin_coilbox_uberstress::init());
    builder = builder.plugin(tauri_plugin_coilbox_mapconv::init());
    builder = builder.plugin(tauri_plugin_coilbox_anim::init());
    builder = builder.plugin(tauri_plugin_coilbox_content::init());
    builder = builder.plugin(tauri_plugin_coilbox_unitsync::init());
    // picoframe:plugins-end

    // Dev-only: expose an MCP socket server so AI agents can drive the app
    // (screenshots, DOM, input). The `tauri-mcp` server in .mcp.json connects
    // over this socket. Never registered in release builds.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp::init_with_config(
            tauri_plugin_mcp::PluginConfig::new("Coilbox".to_string())
                .start_socket_server(true)
                .socket_path("/tmp/tauri-mcp.sock".into()),
        ));
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running coilbox");
}
