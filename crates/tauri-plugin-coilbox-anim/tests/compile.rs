//! Byte-exact end-to-end golden tests: compile a `.bos` with the Rust crate and
//! assert the bytes equal the `.cob` the Python reference produces (`--nopcpp`,
//! folding on, COB v4). Fixtures live in `tests/fixtures/`.

use std::path::Path;

fn fixtures() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// Compile `<name>.bos` and assert it equals the committed `<name>.cob`.
fn assert_golden(name: &str) {
    let dir = fixtures();
    let src = std::fs::read_to_string(dir.join(format!("{name}.bos"))).expect("read bos");
    let expected = std::fs::read(dir.join(format!("{name}.cob"))).expect("read cob");
    let got = tauri_plugin_coilbox_anim::compile_bos(&src, &dir)
        .unwrap_or_else(|e| panic!("compile {name}: {e}"));
    assert_eq!(
        got.len(),
        expected.len(),
        "{name}: length mismatch ({} vs {})",
        got.len(),
        expected.len()
    );
    assert!(
        got == expected,
        "{name}: byte mismatch\n got: {}\nwant: {}",
        hex(&got),
        hex(&expected)
    );
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[test]
fn min_bos() {
    assert_golden("min");
}

/// Broad coverage: brackets/angular constants, truncating-integer folds
/// (`gun + 1 * 2` and `1 / 2` both fold now that folding respects
/// precedence), if/else and while jump back-patching, spin/turn/move with
/// speed/now, signal/set-mask, emit-sfx, wait-for-turn, inc/dec, get/set,
/// rand, unary not, explode, sleep, and call-script/start-script operand
/// order.
#[test]
fn features_bos() {
    assert_golden("features");
}

/// Folding hazards: truncating-toward-zero constants (0.5->0, 1.5->1,
/// 2.5->2, 3.5->3, -1.5->-1, -2.5->-2), truncating integer division that now
/// always folds (`1/2`->0, `7/2`->3), modulo, bitwise folds, parenthesis
/// collapse, precedence-respecting folds regardless of source order
/// (`4 + 2 * 3` and `2 * 3 + 4` both fold to 10), bracket/angular scaling,
/// negative brackets, and a hex literal (not folded on its own).
#[test]
fn folds_bos() {
    assert_golden("folds");
}

/// Remaining animation keywords: spin+accelerate, stop-spin+decelerate,
/// wait-for-move, cache/dont-cache/dont-shade/dont-shadow, attach-unit
/// (with its dummy push), drop-unit, comparison/logical/unary operators.
#[test]
fn anims_bos() {
    assert_golden("anims");
}

/// Pathological input must surface a clean error, never abort the process via a
/// stack overflow (regression for the app-crash report).
/// A scale statement writes a piece and no axis, which is what the engine
/// reads (`CobThread.cpp`). BARScriptCompiler writes the axis too, where the
/// engine reads it as the next instruction and the script stops, so this is
/// the one place the port deliberately differs from the reference. The axis
/// stays in the syntax, since that is how scripts are written, and the
/// compiler says it went unused.
#[test]
fn scale_writes_no_axis_and_says_so() {
    let src = "piece base;\nCreate()\n{\n\tscale base to x-axis [2] speed [1];\n}\n";
    let (bytes, warnings) =
        tauri_plugin_coilbox_anim::compile_bos_with_warnings(src, &fixtures()).expect("compile");
    let words: Vec<u32> = bytes[44..]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_le_bytes(*w))
        .collect();
    // PUSH speed, PUSH destination, SCALE base, then the appended return.
    assert_eq!(
        &words[..7],
        &[0x10021001, 65536, 0x10021001, 131072, 0x100A0000, 0, 0x10021001],
        "{words:?}"
    );
    assert!(
        warnings.iter().any(|w| w.contains("ignores the axis")),
        "{warnings:?}"
    );
}

#[test]
fn deeply_nested_input_errors_gracefully() {
    let src = format!(
        "piece p; static-var a; F(){{ a = {}1{}; }}",
        "(".repeat(5000),
        ")".repeat(5000)
    );
    let err = tauri_plugin_coilbox_anim::compile_bos(&src, &fixtures()).unwrap_err();
    assert!(err.contains("too deep"), "unexpected error: {err}");
}

/// A simple author mistake (undefined variable) is a normal, surfaced error.
#[test]
fn unknown_variable_is_a_clean_error() {
    let err =
        tauri_plugin_coilbox_anim::compile_bos("piece p; F(){ a = 1; }", &fixtures()).unwrap_err();
    assert!(err.contains("Var not found"), "unexpected error: {err}");
}

/// A third carrier.bos-adjacent bug found while verifying the fix: THIS.h uses
/// the lowercase word operator `not` (`if (not isMoving) ...`), which the
/// grammar already accepts case-insensitively, but `compiler.rs`'s codegen
/// only recognised `"NOT"`/`"!"`. Same opcode either way, so this can't be a
/// golden-fixture regression.
#[test]
fn a_lowercase_not_compiles_the_same_as_uppercase() {
    let lower =
        tauri_plugin_coilbox_anim::compile_bos("piece p; F(){ if (not p) {} }", &fixtures())
            .unwrap_or_else(|e| panic!("compile: {e}"));
    let upper =
        tauri_plugin_coilbox_anim::compile_bos("piece p; F(){ if (NOT p) {} }", &fixtures())
            .unwrap_or_else(|e| panic!("compile: {e}"));
    assert_eq!(lower, upper);
}

/// An object-like macro whose body is a parenthesised expression, written
/// with a space before the `(` (carrier.bos's own `#define MUZZLE (1028 +
/// get PERK_BETTER_KINETICS)`), must not be mistaken for a function-like
/// macro just because a `(` follows the name.
#[test]
fn a_space_before_the_paren_keeps_a_define_object_like() {
    let bytes = tauri_plugin_coilbox_anim::compile_bos(
        "piece p; static-var v;\n#define MUZZLE (1 + 2)\nF(){ v = MUZZLE; }\n",
        &fixtures(),
    )
    .unwrap_or_else(|e| panic!("compile: {e}"));
    assert!(!bytes.is_empty());
}

/// The carrier.bos bug: THIS.h has a bare assignment at file scope (which
/// Scriptor accepted and compiled to nothing) and a function-like macro used
/// as a statement. Both must compile, and the stray assignment must surface a
/// warning rather than a silent drop or a syntax error.
#[test]
fn compiles_a_file_scope_assignment_and_a_function_like_macro() {
    let src = "\
piece base;
static-var fireStealthTime;
static-var permaStealth;

fireStealthTime = 1000;
permaStealth = 0;

#define TRAIL(p,rate) static-var EngineEnabled;\\
MoveRate0() {\\
call-script f(p,rate);\\
}
TRAIL(base,1)

f(p,rate) {
}

Create() {
}
";
    let (bytes, warnings) = tauri_plugin_coilbox_anim::compile_bos_with_warnings(src, &fixtures())
        .unwrap_or_else(|e| panic!("compile: {e}"));
    assert!(!bytes.is_empty());
    assert_eq!(
        warnings,
        [
            "`fireStealthTime = 1000;` is outside any function, where the compiler drops it.",
            "`permaStealth = 0;` is outside any function, where the compiler drops it.",
        ]
    );
}
