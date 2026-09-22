//! Constant-folding parity tests, ported from upstream's
//! `tests/test_constant_folding.py` ("Rewrite constant folding" and "Add
//! compile-time-constant folding to emit-sfx") plus the piece-name-uniqueness
//! cases bundled into the latter's `tests/test_errors.py` changes. Expected
//! bytes and error text were captured by compiling the same snippets with the
//! pinned reference (`bos2cob_py3.py` at `9a2a84d`) and reading the `.cob`
//! with `cob_decompiler.py`, not guessed from the Python source.

use std::path::Path;

fn dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

const PUSH_CONSTANT: u32 = 0x10021001;
const ADD: u32 = 0x10031000;
const SUB: u32 = 0x10032000;
const MUL: u32 = 0x10033000;
const DIV: u32 = 0x10034000;
const MOD: u32 = 0x10034001;
const BITWISE_AND: u32 = 0x10035000;
const BITWISE_OR: u32 = 0x10036000;
const SET_LESS: u32 = 0x10051000;
const EMIT_SFX: u32 = 0x1000F000;

/// `PUSH_CONSTANT` followed by the little-endian encoding of `value` (signed
/// if negative, matching `get_signed_num`/`get_num`).
fn pushed_value(value: i64) -> Vec<u8> {
    let mut bytes = PUSH_CONSTANT.to_le_bytes().to_vec();
    if value < 0 {
        bytes.extend_from_slice(&(value as i32).to_le_bytes());
    } else {
        bytes.extend_from_slice(&(value as u32).to_le_bytes());
    }
    bytes
}

/// The 4-byte opcode alone (as a standalone-argument opcode like `ADD`/`DIV`
/// would be emitted).
fn op(opcode: u32) -> Vec<u8> {
    opcode.to_le_bytes().to_vec()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// `move arm to x-axis <expr> now` in a one-piece script, the smallest
/// wrapper that puts a foldable expression somewhere the compiler emits code
/// for it (mirrors upstream's own `compile_bos` test helper).
fn compile_expr(expr: &str) -> Vec<u8> {
    let src = format!("piece arm;\nCreate()\n{{\n\tmove arm to x-axis {expr} now;\n}}\n");
    tauri_plugin_coilbox_anim::compile_bos(&src, &dir())
        .unwrap_or_else(|e| panic!("compile `{expr}`: {e}"))
}

/// Same, but with a `static-var x` declared so `x` is available as a
/// non-constant operand.
fn compile_expr_with_static_x(expr: &str) -> Vec<u8> {
    let src =
        format!("piece arm;\nstatic-var x;\nCreate()\n{{\n\tmove arm to x-axis {expr} now;\n}}\n");
    tauri_plugin_coilbox_anim::compile_bos(&src, &dir())
        .unwrap_or_else(|e| panic!("compile `{expr}`: {e}"))
}

#[test]
fn division_uses_truncating_integer_division() {
    let cob = compile_expr("7 / 2");
    assert!(contains(&cob, &pushed_value(3)), "{cob:x?}");
    assert!(!contains(&cob, &op(DIV)), "{cob:x?}");
}

#[test]
fn negative_division_truncates_toward_zero() {
    let cob = compile_expr("-7 / 2");
    assert!(contains(&cob, &pushed_value(-3)), "{cob:x?}");
    assert!(!contains(&cob, &op(DIV)), "{cob:x?}");
}

#[test]
fn modulo_uses_c_sign() {
    let cob = compile_expr("-7 % 3");
    assert!(contains(&cob, &pushed_value(-1)), "{cob:x?}");
    assert!(!contains(&cob, &op(MOD)), "{cob:x?}");
}

#[test]
fn bitwise_precedence_and_binds_tighter_than_or() {
    let cob = compile_expr("4 & 2 | 1");
    assert!(contains(&cob, &pushed_value(1)), "{cob:x?}");
    assert!(!contains(&cob, &op(BITWISE_AND)), "{cob:x?}");
    assert!(!contains(&cob, &op(BITWISE_OR)), "{cob:x?}");
}

#[test]
fn scaled_constant_folded_matches_unfolded() {
    let solo = compile_expr("[0.1]");
    let folded = compile_expr("1 + [0.1]");
    assert!(contains(&solo, &pushed_value(6553)), "{solo:x?}");
    assert!(contains(&folded, &pushed_value(6554)), "{folded:x?}");
    assert!(!contains(&folded, &op(ADD)), "{folded:x?}");
}

#[test]
fn hex_constant_folds() {
    let cob = compile_expr("0x10 + 5");
    assert!(contains(&cob, &pushed_value(21)), "{cob:x?}");
    assert!(!contains(&cob, &op(ADD)), "{cob:x?}");
}

#[test]
fn division_by_zero_is_not_folded() {
    let cob = compile_expr("5 / 0");
    assert!(contains(&cob, &op(DIV)), "{cob:x?}");
}

#[test]
fn overflow_is_not_folded() {
    let cob = compile_expr("[1000] * 50");
    assert!(contains(&cob, &op(MUL)), "{cob:x?}");
}

#[test]
fn island_after_variable_folds() {
    let cob = compile_expr_with_static_x("x + 2 + 3");
    assert!(contains(&cob, &op(ADD)), "{cob:x?}");
    assert!(contains(&cob, &pushed_value(5)), "{cob:x?}");
    assert!(!contains(&cob, &pushed_value(2)), "{cob:x?}");
    assert!(!contains(&cob, &pushed_value(3)), "{cob:x?}");
}

#[test]
fn left_boundary_operand_not_stolen() {
    let cob = compile_expr_with_static_x("x * 3 + 2");
    assert!(contains(&cob, &op(MUL)), "{cob:x?}");
    assert!(contains(&cob, &op(ADD)), "{cob:x?}");
    assert!(contains(&cob, &pushed_value(3)), "{cob:x?}");
    assert!(contains(&cob, &pushed_value(2)), "{cob:x?}");
    assert!(!contains(&cob, &pushed_value(5)), "{cob:x?}");
}

#[test]
fn right_boundary_operand_not_stolen() {
    let cob = compile_expr("4 | 2 < 3");
    assert!(contains(&cob, &op(BITWISE_OR)), "{cob:x?}");
    assert!(contains(&cob, &op(SET_LESS)), "{cob:x?}");
    assert!(!contains(&cob, &pushed_value(6)), "{cob:x?}");
}

/// The example the fold rewrite exists to fix: the old algorithm's
/// left-operand quirk folded `2 + 1 * 2` to `(2 + 1) * 2 = 6`, ignoring
/// precedence. The rewrite folds `1 * 2` first, giving the correct `4`.
#[test]
fn precedence_respecting_fold_of_two_plus_one_times_two() {
    let cob = compile_expr("2 + 1 * 2");
    assert!(contains(&cob, &pushed_value(4)), "{cob:x?}");
    assert!(!contains(&cob, &pushed_value(6)), "{cob:x?}");
    assert!(!contains(&cob, &op(ADD)), "{cob:x?}");
    assert!(!contains(&cob, &op(MUL)), "{cob:x?}");
}

fn compile_emit_sfx(from_expr: &str) -> Result<Vec<u8>, String> {
    let src =
        format!("piece base, fire1, fire2;\nCreate()\n{{\n\temit-sfx 1024 from {from_expr};\n}}\n");
    tauri_plugin_coilbox_anim::compile_bos(&src, &dir())
}

#[test]
fn emit_sfx_piece_expression_folds() {
    let cob = compile_emit_sfx("base + 1").unwrap();
    let mut expect_emit = op(EMIT_SFX);
    expect_emit.extend_from_slice(&1u32.to_le_bytes());
    assert!(contains(&cob, &expect_emit), "{cob:x?}");
    assert!(!contains(&cob, &op(ADD)), "{cob:x?}");
}

#[test]
fn emit_sfx_piece_subtract_folds() {
    let cob = compile_emit_sfx("fire2 - base").unwrap();
    let mut expect_emit = op(EMIT_SFX);
    expect_emit.extend_from_slice(&2u32.to_le_bytes());
    assert!(contains(&cob, &expect_emit), "{cob:x?}");
    assert!(!contains(&cob, &op(SUB)), "{cob:x?}");
}

#[test]
fn emit_sfx_bare_piece_name_still_works() {
    let cob = compile_emit_sfx("base").unwrap();
    let mut expect_emit = op(EMIT_SFX);
    expect_emit.extend_from_slice(&0u32.to_le_bytes());
    assert!(contains(&cob, &expect_emit), "{cob:x?}");
}

#[test]
fn emit_sfx_out_of_range_piece_is_a_clean_error() {
    let err = compile_emit_sfx("base + 99").unwrap_err();
    assert!(err.contains("out of range"), "{err}");
}

#[test]
fn emit_sfx_unknown_piece_is_a_clean_error() {
    let err = compile_emit_sfx("nose").unwrap_err();
    assert!(err.contains("Piece not found"), "{err}");
}

#[test]
fn emit_sfx_non_constant_expression_is_a_clean_error() {
    let err = compile_emit_sfx("base + x").unwrap_err();
    assert!(err.contains("compile-time constant"), "{err}");
}

fn compile(src: &str) -> Result<Vec<u8>, String> {
    tauri_plugin_coilbox_anim::compile_bos(src, &dir())
}

#[test]
fn piece_name_cannot_be_reused_as_a_static_var() {
    let err = compile("piece base;\nstatic-var base;\nCreate()\n{\n}\n").unwrap_err();
    assert!(err.contains("Piece names must be unique"), "{err}");
}

#[test]
fn piece_name_cannot_be_reused_as_a_local_var() {
    let err = compile("piece base;\nCreate()\n{\n\tvar base;\n}\n").unwrap_err();
    assert!(err.contains("Piece names must be unique"), "{err}");
}

#[test]
fn piece_name_cannot_be_reused_as_a_function_argument() {
    let err = compile("piece base;\nCreate(base)\n{\n}\n").unwrap_err();
    assert!(err.contains("Piece names must be unique"), "{err}");
}

#[test]
fn piece_name_uniqueness_is_checked_regardless_of_declaration_order() {
    let err = compile("Create(base)\n{\n}\npiece base;\n").unwrap_err();
    assert!(err.contains("Piece names must be unique"), "{err}");
}

#[test]
fn piece_name_uniqueness_check_is_case_insensitive() {
    let err = compile("piece base;\nCreate(BASE)\n{\n}\n").unwrap_err();
    assert!(err.contains("Piece names must be unique"), "{err}");
}
