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

/// Broad coverage: brackets/angular constants, ties-to-even rounding, the
/// division-skip fold (`1/2` stays a runtime DIV, `4/2` folds), if/else and
/// while jump back-patching, spin/turn/move with speed/now, signal/set-mask,
/// emit-sfx, wait-for-turn, inc/dec, get/set, rand, unary not, explode, sleep,
/// and call-script/start-script operand order.
#[test]
fn features_bos() {
    assert_golden("features");
}

/// Folding/rounding hazards: ties-to-even rounding (0.5->0, 2.5->2, 3.5->4,
/// -1.5->-2), division-skip (`1/2` unfolded, `4/2`/`7/2` folded), modulo,
/// bitwise folds, parenthesis collapse, the left-only fold quirk
/// (`4 + 2 * 3` vs `2 * 3 + 4`), bracket/angular scaling, negative brackets,
/// and a hex literal (not folded).
#[test]
fn folds_bos() {
    assert_golden("folds");
}

/// Remaining animation keywords: spin+accelerate, stop-spin+decelerate, scale,
/// wait-for-move/scale, cache/dont-cache/dont-shade/dont-shadow, attach-unit
/// (with its dummy push), drop-unit, comparison/logical/unary operators.
#[test]
fn anims_bos() {
    assert_golden("anims");
}

/// Pathological input must surface a clean error, never abort the process via a
/// stack overflow (regression for the app-crash report).
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
    let err = tauri_plugin_coilbox_anim::compile_bos("piece p; F(){ a = 1; }", &fixtures())
        .unwrap_err();
    assert!(err.contains("Var not found"), "unexpected error: {err}");
}
