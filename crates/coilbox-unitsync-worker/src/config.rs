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
use crate::model::{EngineConfigOutput, EngineConfigSetting, EngineConfigWriteOutput};
use std::path::Path;

/// A curated key's type plus the engine default returned when it isn't set.
enum Kind {
    Str(&'static str),
    /// A genuine on/off toggle stored as an engine int (`0`/`1`).
    Bool(bool),
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
    cv("Fullscreen", "Fullscreen", "Display", Kind::Bool(true)),
    cv(
        "WindowBorderless",
        "Borderless window",
        "Display",
        Kind::Bool(false),
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
        Kind::Bool(true),
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
        Kind::Bool(false),
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
        Kind::Bool(true),
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
                Kind::Bool(d) => us.spring_config_int(v.key, d as i32).map(|n| n.to_string()),
                Kind::Int(d) => us.spring_config_int(v.key, d).map(|n| n.to_string()),
                Kind::Float(d) => us.spring_config_float(v.key, d).map(fmt_float),
            }?;
            let value_type = match v.kind {
                Kind::Str(_) => "string",
                Kind::Bool(_) => "bool",
                Kind::Int(_) | Kind::Float(_) => "number",
            };
            Some(EngineConfigSetting {
                key: v.key.to_string(),
                label: v.label.to_string(),
                category: v.category.to_string(),
                value_type,
                value,
                default: default_string(&v.kind),
            })
        })
        .collect();

    let config_path = us.spring_config_file();
    let writable = us.has_spring_config_set();
    errors.extend(us.drain_errors());

    EngineConfigOutput {
        settings,
        config_path,
        writable,
        errors,
    }
}

/// Write one curated engine setting back to `springsettings.cfg` via unitsync's
/// `SetSpringConfig*`. The `key` must be a catalog key (its `Kind` decides which
/// setter and how the string is parsed); `data_dir`/`SPRING_DATADIR` selects the
/// config source, exactly as the read path does. Errors are non-fatal diagnostics.
pub fn apply(lib: &str, key: &str, value: &str) -> EngineConfigWriteOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(us) => us,
        Err(e) => {
            return EngineConfigWriteOutput {
                ok: false,
                errors: vec![e],
            }
        }
    };

    if !us.has_spring_config_set() {
        return EngineConfigWriteOutput {
            ok: false,
            errors: vec![
                "this engine's libunitsync does not expose SetSpringConfig* — \
                 cannot write engine settings"
                    .into(),
            ],
        };
    }

    let Some(var) = CATALOG.iter().find(|v| v.key == key) else {
        return EngineConfigWriteOutput {
            ok: false,
            errors: vec![format!("unknown engine config key: {key}")],
        };
    };

    let parsed = match parse_value(&var.kind, value) {
        Ok(p) => p,
        Err(e) => {
            return EngineConfigWriteOutput {
                ok: false,
                errors: vec![e],
            }
        }
    };

    let mut errors = Vec::new();
    if !us.preinit_config() && us.init(false, 0) == 0 {
        errors.push("unitsync Init returned 0 (failure); config may be unavailable".into());
    }

    let ok = match parsed {
        SetValue::Str(s) => us.set_spring_config_string(key, &s),
        SetValue::Int(n) => us.set_spring_config_int(key, n),
        SetValue::Float(f) => us.set_spring_config_float(key, f),
    };
    if !ok {
        errors.push(format!("unitsync rejected the write for {key}"));
    }

    errors.extend(us.drain_errors());
    EngineConfigWriteOutput { ok, errors }
}

/// The typed value to hand to a `SetSpringConfig*` setter.
enum SetValue {
    Str(String),
    Int(i32),
    Float(f32),
}

/// Coerce a user-supplied string into the typed value a catalog key expects,
/// returning a human-readable error on malformed input. Pure (FFI-free) so it
/// can be unit-tested. Booleans map to the engine's `0`/`1` ints.
fn parse_value(kind: &Kind, raw: &str) -> Result<SetValue, String> {
    match kind {
        Kind::Str(_) => Ok(SetValue::Str(raw.to_string())),
        Kind::Bool(_) => match raw.trim() {
            "1" | "true" | "True" | "on" => Ok(SetValue::Int(1)),
            "0" | "false" | "False" | "off" | "" => Ok(SetValue::Int(0)),
            other => Err(format!(
                "expected a boolean (0/1/true/false), got {other:?}"
            )),
        },
        Kind::Int(_) => raw
            .trim()
            .parse::<i32>()
            .map(SetValue::Int)
            .map_err(|e| format!("expected an integer, got {:?}: {e}", raw.trim())),
        Kind::Float(_) => raw
            .trim()
            .parse::<f32>()
            .map(SetValue::Float)
            .map_err(|e| format!("expected a number, got {:?}: {e}", raw.trim())),
    }
}

/// The engine default for a key, stringified the same way its read value is.
fn default_string(kind: &Kind) -> String {
    match kind {
        Kind::Str(d) => d.to_string(),
        Kind::Bool(d) => (*d as i32).to_string(),
        Kind::Int(d) => d.to_string(),
        Kind::Float(d) => fmt_float(*d),
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

/// Emit an [`EngineConfigWriteOutput`] carrying a single fatal error.
pub fn emit_write_error(msg: String) {
    let out = EngineConfigWriteOutput {
        ok: false,
        errors: vec![msg],
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bool_accepts_common_forms() {
        for (raw, want) in [
            ("1", 1),
            ("true", 1),
            ("on", 1),
            ("0", 0),
            ("false", 0),
            ("", 0),
        ] {
            match parse_value(&Kind::Bool(false), raw) {
                Ok(SetValue::Int(n)) => assert_eq!(n, want, "raw {raw:?}"),
                _ => panic!("bool {raw:?} did not parse to an int"),
            }
        }
        assert!(parse_value(&Kind::Bool(false), "maybe").is_err());
    }

    #[test]
    fn parse_int_and_float() {
        assert!(matches!(
            parse_value(&Kind::Int(0), " 60 "),
            Ok(SetValue::Int(60))
        ));
        assert!(parse_value(&Kind::Int(0), "6.5").is_err());
        match parse_value(&Kind::Float(0.0), "-25") {
            Ok(SetValue::Float(f)) => assert_eq!(f, -25.0),
            _ => panic!("expected float"),
        }
        assert!(parse_value(&Kind::Float(0.0), "nope").is_err());
    }

    #[test]
    fn parse_str_passthrough() {
        match parse_value(&Kind::Str(""), "Some Name") {
            Ok(SetValue::Str(s)) => assert_eq!(s, "Some Name"),
            _ => panic!("expected string"),
        }
    }

    #[test]
    fn default_string_matches_kind() {
        assert_eq!(default_string(&Kind::Bool(true)), "1");
        assert_eq!(default_string(&Kind::Int(60)), "60");
        assert_eq!(default_string(&Kind::Float(0.02)), "0.02");
        assert_eq!(default_string(&Kind::Str("UnnamedPlayer")), "UnnamedPlayer");
    }
}
