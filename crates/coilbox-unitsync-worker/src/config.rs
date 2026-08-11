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
use crate::model::{
    EngineConfigOption, EngineConfigOutput, EngineConfigSetting, EngineConfigWriteOutput,
};
use std::path::Path;

/// A curated key's type plus the engine default returned when it isn't set.
///
/// The bounds and the enum meanings come from `spring --list-config-vars`, the
/// same place the defaults do. They are here so the frontend can offer the
/// control the value deserves: a value with three meanings is a choice, a value
/// with both ends known is a slider, and neither is a free text box.
enum Kind {
    Str(&'static str),
    /// A genuine on/off toggle stored as an engine int (`0`/`1`).
    Bool(bool),
    Int {
        default: i32,
        min: Option<i32>,
        max: Option<i32>,
    },
    Float {
        default: f32,
        min: Option<f32>,
        max: Option<f32>,
    },
    /// An int whose values the engine documents as a fixed set of meanings.
    ///
    /// The engine's own range is usually wider than the meanings it names, so a
    /// stored value outside `options` is kept and shown as itself rather than
    /// being rewritten to something we do have a word for.
    Enum {
        default: i32,
        options: &'static [(i32, &'static str)],
    },
    /// An int with both ends known, worth dragging rather than typing.
    Range {
        default: i32,
        min: i32,
        max: i32,
    },
}

struct ConfigVar {
    key: &'static str,
    label: &'static str,
    category: &'static str,
    kind: Kind,
    /// A line under the label, for a key whose name does not explain itself.
    /// Ours to write, unlike the labels and bounds, which are the engine's.
    hint: Option<&'static str>,
}

/// A resolution field. `0` means "whatever the desktop is", which is worth
/// saying out loud on all four of them.
const AUTO_RESOLUTION: Kind = Kind::Int {
    default: 0,
    min: Some(0),
    max: None,
};

/// A sound channel. Every one of them runs 0 to 200, not 0 to 100.
const fn volume(default: i32) -> Kind {
    Kind::Range {
        default,
        min: 0,
        max: 200,
    }
}

/// The curated catalog. Categories are emitted in first-seen order. Keys, types,
/// defaults, bounds and enum meanings verified against Recoil
/// `spring --list-config-vars`.
const CATALOG: &[ConfigVar] = &[
    // Display
    cv(
        "Fullscreen",
        "Fullscreen",
        "Display",
        Kind::Bool(true),
        Some("For borderless fullscreen, turn this off and Borderless window on."),
    ),
    cv(
        "WindowBorderless",
        "Borderless window",
        "Display",
        Kind::Bool(false),
        None,
    ),
    cv(
        "XResolution",
        "Resolution width",
        "Display",
        AUTO_RESOLUTION,
        Some("0 uses your desktop resolution."),
    ),
    cv(
        "YResolution",
        "Resolution height",
        "Display",
        AUTO_RESOLUTION,
        None,
    ),
    cv(
        "XResolutionWindowed",
        "Windowed width",
        "Display",
        AUTO_RESOLUTION,
        None,
    ),
    cv(
        "YResolutionWindowed",
        "Windowed height",
        "Display",
        AUTO_RESOLUTION,
        None,
    ),
    cv(
        "VSync",
        "VSync",
        "Display",
        Kind::Enum {
            default: -1,
            options: &[(0, "Off"), (1, "On"), (-1, "Adaptive")],
        },
        Some("Syncs frames to your monitor. Adaptive drops the sync when the frame rate falls below it."),
    ),
    // Graphics
    cv(
        "Shadows",
        "Shadows",
        "Graphics",
        Kind::Enum {
            default: 2,
            options: &[
                (-1, "Off, and not loaded"),
                (0, "Off"),
                (1, "Full"),
                (2, "Fast, skipping terrain"),
            ],
        },
        None,
    ),
    // The engine takes any size from 32 up, but the sizes anybody picks are the
    // powers of two, which is what every in-game options panel offers. A size
    // outside the list is kept and shown as itself.
    cv(
        "ShadowMapSize",
        "Shadow detail",
        "Graphics",
        Kind::Enum {
            default: 2048,
            options: &[
                (1024, "Low (1024)"),
                (2048, "Medium (2048)"),
                (4096, "High (4096)"),
                (8192, "Very high (8192)"),
            ],
        },
        Some("Higher is sharper and slower."),
    ),
    cv(
        "GroundDetail",
        "Ground detail",
        "Graphics",
        Kind::Int {
            default: 60,
            min: Some(4),
            max: Some(200),
        },
        Some("Low values make cliffs look jagged."),
    ),
    cv(
        "MaxParticles",
        "Max particles",
        "Graphics",
        Kind::Int {
            default: 10000,
            min: Some(0),
            max: None,
        },
        None,
    ),
    cv(
        "MaxNanoParticles",
        "Max nano particles",
        "Graphics",
        Kind::Int {
            default: 2000,
            min: Some(0),
            max: None,
        },
        None,
    ),
    cv(
        "Water",
        "Water rendering",
        "Graphics",
        Kind::Enum {
            default: 1,
            options: &[
                (0, "Basic"),
                (1, "Reflective"),
                (2, "Reflective and refractive"),
                (3, "Dynamic"),
                (4, "Bumpmapped"),
            ],
        },
        Some("Can also be changed during a game."),
    ),
    // Any sample count up to 32 is legal, but hardware offers powers of two and
    // in-game panels offer the same five. A count outside the list is kept.
    cv(
        "MSAALevel",
        "Anti-aliasing",
        "Graphics",
        Kind::Enum {
            default: 0,
            options: &[
                (0, "Off"),
                (2, "2 samples"),
                (4, "4 samples"),
                (8, "8 samples"),
                (16, "16 samples"),
            ],
        },
        Some("Smooths jagged edges. Costly at high sample counts."),
    ),
    cv(
        "AdvMapShading",
        "Advanced map shading",
        "Graphics",
        Kind::Bool(true),
        None,
    ),
    // Sound
    cv("snd_volmaster", "Master volume", "Sound", volume(60), None),
    cv(
        "snd_volgeneral",
        "General volume",
        "Sound",
        volume(100),
        None,
    ),
    cv(
        "snd_volunitreply",
        "Unit reply volume",
        "Sound",
        volume(100),
        None,
    ),
    cv("snd_volbattle", "Battle volume", "Sound", volume(100), None),
    cv("snd_volui", "UI volume", "Sound", volume(100), None),
    cv("snd_volmusic", "Music volume", "Sound", volume(100), None),
    cv(
        "MaxSounds",
        "Max simultaneous sounds",
        "Sound",
        Kind::Int {
            default: 128,
            min: Some(1),
            max: None,
        },
        None,
    ),
    // Input & Camera
    cv(
        "CamMode",
        "Camera mode",
        "Input & Camera",
        Kind::Enum {
            default: 2,
            options: &[
                (0, "FPS"),
                (1, "Overhead"),
                (2, "Spring"),
                (3, "Rotatable overhead"),
                (4, "Free"),
                (5, "Overview"),
            ],
        },
        None,
    ),
    cv(
        "HardwareCursor",
        "Hardware cursor",
        "Input & Camera",
        Kind::Bool(false),
        Some("Draws the cursor outside the game, so it stays responsive at a low frame rate. Some drivers do not support it in fullscreen."),
    ),
    cv(
        "ScrollWheelSpeed",
        "Scroll wheel speed",
        "Input & Camera",
        Kind::Float {
            default: -25.0,
            min: Some(-255.0),
            max: Some(255.0),
        },
        Some("Negative values scroll the other way."),
    ),
    cv(
        "EdgeMoveWidth",
        "Edge scroll width",
        "Input & Camera",
        Kind::Float {
            default: 0.02,
            min: Some(0.0),
            max: None,
        },
        Some("How much of the screen edge scrolls the camera, as a share of the screen."),
    ),
    cv(
        "EdgeMoveDynamic",
        "Dynamic edge scroll",
        "Input & Camera",
        Kind::Bool(true),
        Some("Scroll faster the closer the pointer is to the edge."),
    ),
    cv(
        "FPSFOV",
        "FPS camera FOV",
        "Input & Camera",
        Kind::Float {
            default: 45.0,
            min: None,
            max: None,
        },
        None,
    ),
    cv(
        "DoubleClickTime",
        "Double-click time",
        "Input & Camera",
        Kind::Float {
            default: 200.0,
            min: None,
            max: None,
        },
        Some("In milliseconds."),
    ),
    cv(
        "MiddleClickScrollSpeed",
        "Middle-click scroll speed",
        "Input & Camera",
        Kind::Float {
            default: 0.01,
            min: None,
            max: None,
        },
        None,
    ),
    // General
    cv(
        "name",
        "Player name",
        "General",
        Kind::Str("UnnamedPlayer"),
        Some("Lobbies replace this with your lobby name, so it shows up in replays and when the engine is started on its own."),
    ),
    // The engine documents no meanings for TeamHighlight's three values, only
    // its range, so it stays a number rather than gaining invented labels.
    cv(
        "TeamHighlight",
        "Team highlight",
        "General",
        Kind::Int {
            default: 1,
            min: Some(0),
            max: Some(2),
        },
        None,
    ),
];

const fn cv(
    key: &'static str,
    label: &'static str,
    category: &'static str,
    kind: Kind,
    hint: Option<&'static str>,
) -> ConfigVar {
    ConfigVar {
        key,
        label,
        category,
        kind,
        hint,
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
                Kind::Int { default, .. }
                | Kind::Enum { default, .. }
                | Kind::Range { default, .. } => {
                    us.spring_config_int(v.key, default).map(|n| n.to_string())
                }
                Kind::Float { default, .. } => {
                    us.spring_config_float(v.key, default).map(fmt_float)
                }
            }?;
            let value_type = match v.kind {
                Kind::Str(_) => "string",
                Kind::Bool(_) => "bool",
                Kind::Int { .. } | Kind::Float { .. } => "number",
                Kind::Enum { .. } => "enum",
                Kind::Range { .. } => "range",
            };
            let (min, max) = bounds(&v.kind);
            Some(EngineConfigSetting {
                key: v.key.to_string(),
                label: v.label.to_string(),
                category: v.category.to_string(),
                value_type,
                value,
                default: default_string(&v.kind),
                hint: v.hint,
                min,
                max,
                options: options(&v.kind),
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
#[derive(Debug)]
enum SetValue {
    Str(String),
    Int(i32),
    Float(f32),
}

/// Coerce a user-supplied string into the typed value a catalog key expects,
/// returning a human-readable error on malformed input. Pure (FFI-free) so it
/// can be unit-tested. Booleans map to the engine's `0`/`1` ints.
///
/// A value outside the key's bounds is refused rather than passed on. The engine
/// would clamp it silently, leaving the reader looking at a number they did not
/// choose with nothing to say why.
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
        Kind::Int { min, max, .. } => parse_int(raw, *min, *max),
        Kind::Range { min, max, .. } => parse_int(raw, Some(*min), Some(*max)),
        // Deliberately unbounded: the engine's range is wider than the meanings
        // it names, and a value it accepts is not ours to refuse.
        Kind::Enum { .. } => parse_int(raw, None, None),
        Kind::Float { min, max, .. } => {
            let n = raw
                .trim()
                .parse::<f32>()
                .map_err(|e| format!("expected a number, got {:?}: {e}", raw.trim()))?;
            if min.is_some_and(|m| n < m) || max.is_some_and(|m| n > m) {
                return Err(out_of_range(
                    &fmt_float(n),
                    min.map(fmt_float),
                    max.map(fmt_float),
                ));
            }
            Ok(SetValue::Float(n))
        }
    }
}

fn parse_int(raw: &str, min: Option<i32>, max: Option<i32>) -> Result<SetValue, String> {
    let n = raw
        .trim()
        .parse::<i32>()
        .map_err(|e| format!("expected an integer, got {:?}: {e}", raw.trim()))?;
    if min.is_some_and(|m| n < m) || max.is_some_and(|m| n > m) {
        return Err(out_of_range(
            &n.to_string(),
            min.map(|m| m.to_string()),
            max.map(|m| m.to_string()),
        ));
    }
    Ok(SetValue::Int(n))
}

fn out_of_range(got: &str, min: Option<String>, max: Option<String>) -> String {
    match (min, max) {
        (Some(min), Some(max)) => format!("{got} is outside the engine's range, {min} to {max}"),
        (Some(min), None) => format!("{got} is below the engine's minimum of {min}"),
        (None, Some(max)) => format!("{got} is above the engine's maximum of {max}"),
        (None, None) => format!("{got} is out of range"),
    }
}

/// The engine default for a key, stringified the same way its read value is.
fn default_string(kind: &Kind) -> String {
    match kind {
        Kind::Str(d) => d.to_string(),
        Kind::Bool(d) => (*d as i32).to_string(),
        Kind::Int { default, .. } | Kind::Enum { default, .. } | Kind::Range { default, .. } => {
            default.to_string()
        }
        Kind::Float { default, .. } => fmt_float(*default),
    }
}

/// The key's bounds, as numbers the frontend can hand to an input or a slider.
fn bounds(kind: &Kind) -> (Option<f64>, Option<f64>) {
    match kind {
        Kind::Int { min, max, .. } => (min.map(f64::from), max.map(f64::from)),
        Kind::Range { min, max, .. } => (Some(f64::from(*min)), Some(f64::from(*max))),
        Kind::Float { min, max, .. } => (min.map(f64::from), max.map(f64::from)),
        Kind::Str(_) | Kind::Bool(_) | Kind::Enum { .. } => (None, None),
    }
}

/// The named choices for an enum key, in the order the catalog lists them.
fn options(kind: &Kind) -> Vec<EngineConfigOption> {
    match kind {
        Kind::Enum { options, .. } => options
            .iter()
            .map(|(value, label)| EngineConfigOption {
                value: value.to_string(),
                label,
            })
            .collect(),
        _ => Vec::new(),
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

    fn var(key: &str) -> &'static ConfigVar {
        CATALOG
            .iter()
            .find(|v| v.key == key)
            .unwrap_or_else(|| panic!("{key} is not in the catalog"))
    }

    fn int_of(kind: &Kind, raw: &str) -> Result<i32, String> {
        match parse_value(kind, raw)? {
            SetValue::Int(n) => Ok(n),
            other => panic!(
                "expected an int, got {}",
                match other {
                    SetValue::Str(s) => format!("string {s:?}"),
                    SetValue::Float(f) => format!("float {f}"),
                    SetValue::Int(_) => unreachable!(),
                }
            ),
        }
    }

    /// Every catalog key has to be reachable by the write path, which looks
    /// itself up by key. A typo here is silent until somebody edits that field.
    #[test]
    fn every_catalog_key_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for v in CATALOG {
            assert!(seen.insert(v.key), "{} is in the catalog twice", v.key);
        }
    }

    /// An enum's default has to be one of the meanings it names, or the page
    /// opens showing a value the reader cannot choose again.
    #[test]
    fn every_enum_default_is_one_of_its_options() {
        for v in CATALOG {
            if let Kind::Enum { default, options } = v.kind {
                assert!(
                    options.iter().any(|(value, _)| *value == default),
                    "{}'s default {default} is not among its options",
                    v.key
                );
            }
        }
    }

    #[test]
    fn a_range_carries_both_ends_for_the_slider() {
        let (min, max) = bounds(&var("snd_volmaster").kind);
        assert_eq!((min, max), (Some(0.0), Some(200.0)));
        assert_eq!(default_string(&var("snd_volmaster").kind), "60");
    }

    #[test]
    fn a_volume_outside_the_engines_range_is_refused_rather_than_clamped() {
        let kind = &var("snd_volmaster").kind;
        assert_eq!(int_of(kind, "200").unwrap(), 200);
        let err = int_of(kind, "201").unwrap_err();
        assert!(err.contains("0 to 200"), "{err}");
        assert!(int_of(kind, "-1").is_err());
    }

    #[test]
    fn ground_detail_holds_the_engines_own_bounds() {
        let kind = &var("GroundDetail").kind;
        assert_eq!(int_of(kind, "4").unwrap(), 4);
        assert_eq!(int_of(kind, "200").unwrap(), 200);
        assert!(int_of(kind, "3").unwrap_err().contains("4 to 200"));
        assert!(int_of(kind, "201").is_err());
    }

    #[test]
    fn vsync_offers_its_three_meanings_and_still_takes_the_others() {
        let kind = &var("VSync").kind;
        let named = options(kind);
        assert_eq!(
            named.iter().map(|o| o.value.as_str()).collect::<Vec<_>>(),
            ["0", "1", "-1"]
        );
        assert_eq!(named[2].label, "Adaptive");
        // -3 is a legal adaptive interval the catalog has no word for. The
        // engine takes it, so the write path does too.
        assert_eq!(int_of(kind, "-3").unwrap(), -3);
    }

    #[test]
    fn a_scroll_speed_beyond_the_engines_range_is_refused() {
        let kind = &var("ScrollWheelSpeed").kind;
        match parse_value(kind, "-25.5").unwrap() {
            SetValue::Float(f) => assert!((f + 25.5).abs() < f32::EPSILON),
            _ => panic!("expected a float"),
        }
        assert!(parse_value(kind, "256").unwrap_err().contains("255"));
    }

    #[test]
    fn a_bounded_key_still_refuses_what_is_not_a_number() {
        assert!(int_of(&var("GroundDetail").kind, "lots").is_err());
        assert!(parse_value(&var("ScrollWheelSpeed").kind, "fast").is_err());
    }

    #[test]
    fn booleans_still_map_to_the_engines_ints() {
        let kind = &var("Fullscreen").kind;
        assert_eq!(int_of(kind, "true").unwrap(), 1);
        assert_eq!(int_of(kind, "0").unwrap(), 0);
        assert!(int_of(kind, "yes").is_err());
    }

    #[test]
    fn only_enums_carry_options() {
        for v in CATALOG {
            let named = options(&v.kind);
            match v.kind {
                Kind::Enum { .. } => assert!(!named.is_empty(), "{} has none", v.key),
                _ => assert!(named.is_empty(), "{} should have none", v.key),
            }
        }
    }

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
        let unbounded_int = Kind::Int {
            default: 0,
            min: None,
            max: None,
        };
        let unbounded_float = Kind::Float {
            default: 0.0,
            min: None,
            max: None,
        };
        assert!(matches!(
            parse_value(&unbounded_int, " 60 "),
            Ok(SetValue::Int(60))
        ));
        assert!(parse_value(&unbounded_int, "6.5").is_err());
        match parse_value(&unbounded_float, "-25") {
            Ok(SetValue::Float(f)) => assert_eq!(f, -25.0),
            _ => panic!("expected float"),
        }
        assert!(parse_value(&unbounded_float, "nope").is_err());
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
        assert_eq!(default_string(&var("GroundDetail").kind), "60");
        assert_eq!(default_string(&var("EdgeMoveWidth").kind), "0.02");
        assert_eq!(default_string(&Kind::Str("UnnamedPlayer")), "UnnamedPlayer");
        assert_eq!(default_string(&var("VSync").kind), "-1");
    }
}
