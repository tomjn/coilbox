fn main() {
    // tauri-build's default capabilities pattern ("./capabilities/**/*") is
    // recursive, so it always picks up capabilities/mcp-only/mcp.json. That
    // capability's only permission, "mcp:default", comes from the
    // tauri-plugin-mcp crate, which is compiled only under the `mcp` feature.
    // Reading the capability without the feature fails the build with
    // "Permission mcp:default not found", so pick a non-recursive pattern that
    // stops at the top level of capabilities/ when the feature is off.
    println!("cargo:rerun-if-changed=capabilities");
    let pattern = if cfg!(feature = "mcp") {
        "./capabilities/**/*"
    } else {
        "./capabilities/*.json"
    };
    tauri_build::try_build(tauri_build::Attributes::new().capabilities_path_pattern(pattern))
        .expect("failed to run tauri-build");
}
