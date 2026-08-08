// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asset_protocol;
mod win_job;

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

// Keep GIO to the modules the AppImage shipped (issue #1012).
//
// The AppImage carries the GLib of its build base (2.72, from Ubuntu 22.04), but
// GIO scans the module directory it was compiled with, which on the user's
// machine is the host's. On any distribution newer than the build base those
// modules want a GLib we do not have, so every launch prints
//
//   libgvfscommon.so: undefined symbol: g_task_set_static_name
//   Failed to load module: .../libgvfsdbus.so
//
// and the app is left with no gvfs at all. GLib reads GIO_MODULE_DIR first and
// only falls back to the compiled-in path, so naming the bundled directory keeps
// the scan inside the AppImage, where the TLS module we do use already lives.
//
// Set before the Wayland re-exec below so it survives it.
#[cfg(target_os = "linux")]
fn pin_gio_modules_to_bundle() {
    use std::env;

    if env::var_os("APPIMAGE").is_none() || env::var_os("GIO_MODULE_DIR").is_some() {
        return;
    }
    // linuxdeploy's GTK hook points this at the bundled directory, so it already
    // carries the architecture triple in the path.
    let Some(bundled) = env::var_os("GIO_EXTRA_MODULES") else {
        return;
    };
    if std::path::Path::new(&bundled).is_dir() {
        env::set_var("GIO_MODULE_DIR", bundled);
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    pin_gio_modules_to_bundle();
    #[cfg(target_os = "linux")]
    linux_appimage_webview_workaround();

    // Windows: tie spawned sidecars to our lifetime so an NSIS update can overwrite
    // their .exe files instead of failing on a locked, orphaned process. No-op
    // elsewhere.
    win_job::confine_children_to_job();

    let mut builder = tauri::Builder::default();

    // Windows/Linux (issue #483): a second launch carrying a `coilbox://` link
    // (e.g. from clicking one in Discord) starts a brand new process rather than
    // the OS delivering the URL to the one already running, unlike macOS. This
    // plugin intercepts that second launch and kills it, and because the
    // `deep-link` feature is enabled it hands the launch's argv straight to
    // `tauri_plugin_deep_link::handle_cli_arguments`, which validates the URL
    // against the configured `coilbox` scheme and emits the same
    // `deep-link://new-url` event the frontend's `onOpenUrl` listener already
    // handles for macOS warm starts (see `DeepLinkHandler`, issue #388). The
    // callback below only covers the no-URL case: raise the existing window, the
    // ordinary single-instance behaviour. The plugin's docs require registering
    // it before any other plugin, and macOS already gets warm-start links from
    // the OS, so it is compiled out there to avoid double-handling.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(picoframe_core::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // `coilbox://` deep links (issue #388): a link in Discord or lobby chat
        // carries an action (join a battle, import a preset/challenge, open a
        // screen). The plugin captures the launch URL for cold start and emits
        // `deep-link://new-url` while running. The frontend confirms every link
        // before acting. Note the same `coilbox://` string also names the webview
        // asset protocol registered below. They live at different layers (OS URL
        // dispatch vs in-webview asset serving) and do not collide.
        .plugin(tauri_plugin_deep_link::init())
        // Serve local media (images/audio/video/fonts) from the portable `.coilbox`
        // folder and per-campaign app-data over `coilbox://`, with HTTP range support
        // so `<video>` can seek. Registered here rather than in a picoframe plugin so
        // it's shared and needs no command ACL. Blocking file IO runs off-thread.
        .register_asynchronous_uri_scheme_protocol("coilbox", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(asset_protocol::handle(&app, &request));
            });
        });
    // picoframe:plugins-start
    builder = builder.plugin(tauri_plugin_coilbox_downloads::init());
    builder = builder.plugin(tauri_plugin_coilbox_uberstress::init());
    builder = builder.plugin(tauri_plugin_coilbox_mapconv::init());
    builder = builder.plugin(tauri_plugin_coilbox_anim::init());
    builder = builder.plugin(tauri_plugin_coilbox_content::init());
    builder = builder.plugin(tauri_plugin_coilbox_unitsync::init());
    builder = builder.plugin(tauri_plugin_coilbox_play::init());
    builder = builder.plugin(tauri_plugin_coilbox_campaign::init());
    builder = builder.plugin(tauri_plugin_coilbox_scenario::init());
    builder = builder.plugin(tauri_plugin_coilbox_lego::init());
    builder = builder.plugin(tauri_plugin_coilbox_conquest::init());
    builder = builder.plugin(tauri_plugin_coilbox_runlite::init());
    builder = builder.plugin(tauri_plugin_coilbox_profile::init());
    builder = builder.plugin(tauri_plugin_coilbox_lobby_servers::init());
    builder = builder.plugin(tauri_plugin_coilbox_multiplayer::init());
    // picoframe:plugins-end

    // In a dev (non-bundled) build the OS has no record of the `coilbox://`
    // scheme, so on Windows and Linux register it at runtime so links dispatch
    // during development. macOS resolves the scheme from the bundled app's
    // Info.plist only, so runtime registration is neither available nor needed
    // there. A release build ships the scheme in its bundle, so this is dev-only.
    #[cfg(all(debug_assertions, any(target_os = "windows", target_os = "linux")))]
    {
        builder = builder.setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("coilbox: dev deep-link scheme registration failed: {e}");
            }
            Ok(())
        });
    }

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
