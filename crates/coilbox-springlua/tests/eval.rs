//! Integration tests over the public `SpringLua` API, driven by checked-in
//! fixtures under `tests/fixtures/`.

use std::path::PathBuf;

use coilbox_springlua::SpringLua;
use serde::Deserialize;

fn fixture(sub: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(sub)
}

fn read(sub: &str, file: &str) -> String {
    std::fs::read_to_string(fixture(sub).join(file)).expect("fixture readable")
}

// Mirrors the lowercase, nested shape Spring config deserializes into.
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct Info {
    name: Option<String>,
    version: Option<String>,
    voidwater: Option<bool>,
    smf: Smf,
    water: Water,
    atmosphere: Atmosphere,
    lighting: Lighting,
}

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct Smf {
    minheight: Option<f64>,
    maxheight: Option<f64>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct Water {
    surfacecolor: Option<[f32; 3]>,
    surfacealpha: Option<f32>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct Atmosphere {
    skycolor: Option<[f32; 3]>,
    fogcolor: Option<[f32; 3]>,
    suncolor: Option<[f32; 3]>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct Lighting {
    sundir: Option<[f32; 3]>,
}

#[test]
fn self_contained_mapinfo() {
    let dir = fixture("selfcontained");
    let lua = SpringLua::new(&dir).unwrap();
    let info: Info = lua.eval_to(&read("selfcontained", "mapinfo.lua"), "mapinfo.lua").unwrap();

    // Mixed-case source keys come through lowercased.
    assert_eq!(info.name.as_deref(), Some("Self Contained"));
    assert_eq!(info.version.as_deref(), Some("2.1"));
    assert_eq!(info.voidwater, Some(true));
    assert_eq!(info.smf.minheight, Some(-300.0));
    assert_eq!(info.smf.maxheight, Some(1150.0));
    // {r,g,b} colour survives as a 3-element array.
    assert_eq!(info.water.surfacecolor, Some([0.75, 0.8, 0.85]));
    assert_eq!(info.water.surfacealpha, Some(0.55));
    assert_eq!(info.atmosphere.skycolor, Some([0.64, 0.55, 0.43]));
    assert_eq!(info.atmosphere.fogcolor, Some([0.07, 0.06, 0.05]));
    assert_eq!(info.lighting.sundir, Some([-0.5, 0.53, -0.79]));
}

#[test]
fn mapinfo_via_vfs_include() {
    // The height range lives in a sibling file reached through VFS.Include —
    // the case the literal scanner fundamentally could not resolve.
    let dir = fixture("withinclude");
    let lua = SpringLua::new(&dir).unwrap();
    let info: Info = lua.eval_to(&read("withinclude", "mapinfo.lua"), "mapinfo.lua").unwrap();

    assert_eq!(info.name.as_deref(), Some("With Include"));
    assert_eq!(info.voidwater, Some(false));
    assert_eq!(info.smf.minheight, Some(100.0));
    assert_eq!(info.smf.maxheight, Some(800.0));
}

#[test]
fn modinfo_generalises() {
    #[derive(Deserialize, Debug)]
    struct Mod {
        name: String,
        version: String,
        modtype: i64,
    }
    let dir = fixture("modinfo");
    let lua = SpringLua::new(&dir).unwrap();
    let m: Mod = lua.eval_to(&read("modinfo", "modinfo.lua"), "modinfo.lua").unwrap();
    assert_eq!(m.name, "Test Game");
    assert_eq!(m.version, "1.0");
    assert_eq!(m.modtype, 1);
}

#[test]
fn dangerous_stdlib_is_absent() {
    let dir = fixture("selfcontained");
    let lua = SpringLua::new(&dir).unwrap();
    #[derive(Deserialize, Debug)]
    struct Probe {
        os: bool,
        io: bool,
        package: bool,
        load: bool,
        dofile: bool,
    }
    let probe: Probe = lua
        .eval_to(
            r#"return {
                os = os ~= nil,
                io = io ~= nil,
                package = package ~= nil,
                load = load ~= nil,
                dofile = dofile ~= nil,
            }"#,
            "probe",
        )
        .unwrap();
    assert!(!probe.os, "os must be absent");
    assert!(!probe.io, "io must be absent");
    assert!(!probe.package, "package must be absent");
    assert!(!probe.load, "load must be absent");
    assert!(!probe.dofile, "dofile must be absent");
}

#[test]
fn vfs_cannot_escape_root() {
    // LoadFile of an escaping path resolves to nil (no read), and Include errors.
    let dir = fixture("withinclude").join("sub"); // root one level deep
    let lua = SpringLua::new(&dir).unwrap();

    #[derive(Deserialize, Debug)]
    struct R {
        escaped: bool,
    }
    let r: R = lua
        .eval_to(
            r#"return { escaped = VFS.LoadFile("../mapinfo.lua") ~= nil }"#,
            "escape-probe",
        )
        .unwrap();
    assert!(!r.escaped, "../ traversal must not read outside root");

    let err = lua.eval_value(r#"return VFS.Include("../mapinfo.lua")"#, "escape-include");
    assert!(err.is_err(), "Include must reject ../ traversal");
}

#[test]
fn infinite_loop_is_aborted() {
    let dir = fixture("selfcontained");
    let lua = SpringLua::new(&dir).unwrap();
    let res = lua.eval_value("while true do end return 1", "loop");
    assert!(res.is_err(), "runaway loop must hit the instruction cap");
}

#[test]
fn non_returning_chunk_errors() {
    let dir = fixture("selfcontained");
    let lua = SpringLua::new(&dir).unwrap();
    let res: coilbox_springlua::Result<Info> = lua.eval_to("local x = 1", "noreturn");
    assert!(res.is_err(), "a chunk that returns nothing is an error (caller falls back)");
}
