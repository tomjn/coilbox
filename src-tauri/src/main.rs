// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(picoframe_core::init());
    // picoframe:plugins-start
    builder = builder.plugin(tauri_plugin_coilbox_prdownloader::init());
    // picoframe:plugins-end
    builder
        .run(tauri::generate_context!())
        .expect("error while running coilbox");
}
