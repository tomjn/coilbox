//! `config` mode — read a curated set of engine settings from the user's
//! `springsettings.cfg` via unitsync's `GetSpringConfig*` accessors.
//!
//! unitsync has no way to *enumerate* config keys, so we read a hand-picked
//! catalog of well-known ones. `GetSpringConfig{String,Int,Float}(name, default)`
//! returns the configured value when the key is set, otherwise the `default` we
//! pass — it does *not* fall back to the engine's own registered default — so each
//! catalog entry carries the engine default (verified against
//! `spring --list-config-vars`) to display an effective value. A key name that
//! isn't a real config var would fail silently (always returning our default), so
//! the catalog is maintained against the engine, not guessed.

use crate::ffi::Unitsync;
use crate::model::{EngineConfigOutput, EngineConfigSetting};
use std::path::Path;

/// A curated key's type plus the engine default returned when it isn't set.
enum Kind {
    Str(&'static str),
    Int(i32),
    Float(f32),
}

struct ConfigVar {
    key: &'static str,
    label: &'static str,
    category: &'static str,
    kind: Kind,
}

/// The curated catalog. Categories are emitted in first-seen order. Keys, types
/// and defaults verified against Recoil `spring --list-config-vars`.
const CATALOG: &[ConfigVar] = &[
    // Display
    cv("Fullscreen", "Fullscreen", "Display", Kind::Int(1)),
    cv(
        "WindowBorderless",
        "Borderless window",
        "Display",
        Kind::Int(0),
    ),
    cv("XResolution", "Resolution width", "Display", Kind::Int(0)),
    cv("YResolution", "Resolution height", "Display", Kind::Int(0)),
    cv(
        "XResolutionWindowed",
        "Windowed width",
        "Display",
        Kind::Int(0),
    ),
    cv(
        "YResolutionWindowed",
        "Windowed height",
        "Display",
        Kind::Int(0),
    ),
    cv("VSync", "VSync", "Display", Kind::Int(-1)),
    // Graphics
    cv("Shadows", "Shadows", "Graphics", Kind::Int(2)),
    cv(
        "ShadowMapSize",
        "Shadow map size",
        "Graphics",
        Kind::Int(2048),
    ),
    cv("GroundDetail", "Ground detail", "Graphics", Kind::Int(60)),
    cv(
        "MaxParticles",
        "Max particles",
        "Graphics",
        Kind::Int(10000),
    ),
    cv(
        "MaxNanoParticles",
        "Max nano particles",
        "Graphics",
        Kind::Int(2000),
    ),
    cv("Water", "Water rendering", "Graphics", Kind::Int(1)),
    cv("MSAALevel", "MSAA level", "Graphics", Kind::Int(0)),
    cv(
        "AdvMapShading",
        "Advanced map shading",
        "Graphics",
        Kind::Int(1),
    ),
    // Sound
    cv("snd_volmaster", "Master volume", "Sound", Kind::Int(60)),
    cv("snd_volgeneral", "General volume", "Sound", Kind::Int(100)),
    cv(
        "snd_volunitreply",
        "Unit reply volume",
        "Sound",
        Kind::Int(100),
    ),
    cv("snd_volbattle", "Battle volume", "Sound", Kind::Int(100)),
    cv("snd_volui", "UI volume", "Sound", Kind::Int(100)),
    cv("snd_volmusic", "Music volume", "Sound", Kind::Int(100)),
    cv(
        "MaxSounds",
        "Max simultaneous sounds",
        "Sound",
        Kind::Int(128),
    ),
    // Input & Camera
    cv("CamMode", "Camera mode", "Input & Camera", Kind::Int(2)),
    cv(
        "HardwareCursor",
        "Hardware cursor",
        "Input & Camera",
        Kind::Int(0),
    ),
    cv(
        "ScrollWheelSpeed",
        "Scroll wheel speed",
        "Input & Camera",
        Kind::Float(-25.0),
    ),
    cv(
        "EdgeMoveWidth",
        "Edge scroll width",
        "Input & Camera",
        Kind::Float(0.02),
    ),
    cv(
        "EdgeMoveDynamic",
        "Dynamic edge scroll",
        "Input & Camera",
        Kind::Int(1),
    ),
    cv(
        "FPSFOV",
        "FPS camera FOV",
        "Input & Camera",
        Kind::Float(45.0),
    ),
    cv(
        "DoubleClickTime",
        "Double-click time (ms)",
        "Input & Camera",
        Kind::Float(200.0),
    ),
    cv(
        "MiddleClickScrollSpeed",
        "Middle-click scroll speed",
        "Input & Camera",
        Kind::Float(0.01),
    ),
    // General
    cv("name", "Player name", "General", Kind::Str("UnnamedPlayer")),
    cv("TeamHighlight", "Team highlight", "General", Kind::Int(1)),
];

const fn cv(
    key: &'static str,
    label: &'static str,
    category: &'static str,
    kind: Kind,
) -> ConfigVar {
    ConfigVar {
        key,
        label,
        category,
        kind,
    }
}

/// Load unitsync, set up its config handler (no full `Init`/VFS scan), and read
/// every curated key. Errors are non-fatal diagnostics returned in the output.
pub fn render(lib: &str) -> EngineConfigOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(us) => us,
        Err(e) => {
            return EngineConfigOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };

    if !us.has_spring_config() {
        return EngineConfigOutput {
            errors: vec![
                "this engine's libunitsync does not expose GetSpringConfig* — \
                 cannot read engine settings"
                    .into(),
            ],
            ..Default::default()
        };
    }

    let mut errors = Vec::new();

    // Instantiate the config handler the cheap way. If this build lacks
    // SetSpringConfigFile, fall back to a full Init (which also sets it up).
    if !us.preinit_config() && us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); config may be unavailable".into());
    }

    let settings = CATALOG
        .iter()
        .filter_map(|v| {
            let value = match v.kind {
                Kind::Str(d) => us.spring_config_string(v.key, d),
                Kind::Int(d) => us.spring_config_int(v.key, d).map(|n| n.to_string()),
                Kind::Float(d) => us.spring_config_float(v.key, d).map(fmt_float),
            }?;
            Some(EngineConfigSetting {
                key: v.key.to_string(),
                label: v.label.to_string(),
                category: v.category.to_string(),
                value,
            })
        })
        .collect();

    let config_path = us.spring_config_file();
    errors.extend(us.drain_errors());

    EngineConfigOutput {
        settings,
        config_path,
        errors,
    }
}

/// Display a float without a trailing `.0` (e.g. `45`, `0.02`, `-25`).
fn fmt_float(f: f32) -> String {
    f.to_string()
}

/// Emit an [`EngineConfigOutput`] carrying a single fatal error.
pub fn emit_error(msg: String) {
    let out = EngineConfigOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}
