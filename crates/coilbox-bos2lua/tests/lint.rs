//! One script that fires each rule and one near miss that does not, plus a
//! sweep of the fixture corpus reporting how often each rule fires there.

use coilbox_bos2lua::{lint, Diagnostic, LintOptions, Precedence, Severity, MODERN_LINEAR};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn lint_src(source: &str) -> Vec<Diagnostic> {
    lint_with(source, &HashMap::new(), None)
}

fn lint_with(
    source: &str,
    includes: &HashMap<String, String>,
    pieces: Option<&[String]>,
) -> Vec<Diagnostic> {
    lint(
        source,
        &LintOptions {
            name: "test.bos",
            includes,
            pieces,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
        },
    )
    .unwrap()
}

fn fires(source: &str, rule: &str) -> bool {
    lint_src(source).iter().any(|d| d.rule == rule)
}

#[test]
fn unused_piece_flags_a_piece_nothing_names() {
    assert!(fires(
        "piece used, unused;\nF() { turn used to x-axis <90> speed <10>; }",
        "unused-piece"
    ));
    assert!(!fires("piece flare;\nF() { hide flare; }", "unused-piece"));
}

#[test]
fn unused_piece_is_info_severity() {
    let diags = lint_src("piece unused;\nF() { }");
    let d = diags.iter().find(|d| d.rule == "unused-piece").unwrap();
    assert_eq!(d.severity, Severity::Info);
}

#[test]
fn unused_static_flags_a_write_with_no_read() {
    assert!(fires(
        "static-var dead;\nF() { dead = 1; }",
        "unused-static"
    ));
    assert!(!fires(
        "static-var live;\nF() { call-script G(live); }\nG(v) { }",
        "unused-static"
    ));
}

#[test]
fn unused_local_flags_a_var_never_read() {
    assert!(fires("F() { var dead; dead = 1; }", "unused-local"));
    assert!(!fires(
        "F() { var live; live = 1; return (live); }",
        "unused-local"
    ));
}

#[test]
fn invalid_call_flags_a_name_the_script_never_defines() {
    assert!(fires("F() { call-script Ghost(); }", "invalid-call"));
    assert!(!fires("F() { call-script G(); }\nG() { }", "invalid-call"));
}

#[test]
fn invalid_call_is_an_error() {
    let diags = lint_src("F() { call-script Ghost(); }");
    let d = diags.iter().find(|d| d.rule == "invalid-call").unwrap();
    assert_eq!(d.severity, Severity::Error);
}

#[test]
fn recursive_call_flags_a_cycle_of_call_script() {
    assert!(fires(
        "A() { call-script B(); }\nB() { call-script A(); }",
        "recursive-call"
    ));
    // start-script begins a new thread, which is a legitimate loop, not a cycle.
    assert!(!fires(
        "A() { start-script B(); }\nB() { start-script A(); }",
        "recursive-call"
    ));
}

#[test]
fn speed_zero_flags_a_turn_or_move_that_never_arrives() {
    assert!(fires(
        "F() { turn p to x-axis <90> speed <0>; }",
        "speed-zero"
    ));
    assert!(!fires(
        "F() { turn p to x-axis <90> speed <10>; }",
        "speed-zero"
    ));
    // spin at speed 0 is how a script stops one, not a mistake.
    assert!(!fires(
        "F() { spin p around x-axis speed <0>; }",
        "speed-zero"
    ));
}

#[test]
fn dead_code_flags_a_condition_that_is_always_false() {
    assert!(fires("F() { if (0) { sleep 1; } }", "dead-code"));
    assert!(!fires("F() { if (1) { sleep 1; } }", "dead-code"));
}

#[test]
fn always_true_flags_an_if_but_not_the_standard_loop() {
    assert!(fires("F() { if (1) { sleep 1; } }", "always-true"));
    // while (TRUE) is the standard animation loop idiom.
    assert!(!fires("F() { while (1) { sleep 1; } }", "always-true"));
}

#[test]
fn duplicate_animation_flags_a_repeated_command() {
    assert!(fires(
        "F() { turn p to x-axis <90> speed <10>; turn p to x-axis <90> speed <10>; }",
        "duplicate-animation"
    ));
    assert!(!fires(
        "F() { turn p to x-axis <90> speed <10>; turn p to y-axis <90> speed <10>; }",
        "duplicate-animation"
    ));
}

#[test]
fn duplicate_if_flags_a_repeated_condition() {
    assert!(fires(
        "F() { if (a) { sleep 1; } if (a) { sleep 2; } }",
        "duplicate-if"
    ));
    assert!(!fires(
        "F() { if (a) { sleep 1; } if (b) { sleep 2; } }",
        "duplicate-if"
    ));
}

#[test]
fn sleep_only_guard_flags_an_if_with_only_a_sleep() {
    assert!(fires("F() { if (a) { sleep 100; } }", "sleep-only-guard"));
    assert!(!fires(
        "F() { if (a) { sleep 100; } else { turn p to x-axis <0> speed <10>; } }",
        "sleep-only-guard"
    ));
}

#[test]
fn empty_function_flags_an_empty_body_except_a_callin() {
    assert!(fires("Empty() { }", "empty-function"));
    // Create is a real call-in, and an empty one is a deliberate stub.
    assert!(!fires("Create() { }", "empty-function"));
}

#[test]
fn raw_signal_flags_a_bare_number() {
    assert!(fires("F() { signal 4; }", "raw-signal"));
    assert!(!fires(
        "#define SIG_MOVE 4\nF() { signal SIG_MOVE; }",
        "raw-signal"
    ));
}

#[test]
fn signal_never_signalled_flags_a_mask_nothing_sets() {
    assert!(fires(
        "#define SIG_A 1\n#define SIG_B 2\nF() { set-signal-mask SIG_B; }\nG() { signal SIG_A; }",
        "signal-never-signalled"
    ));
    assert!(!fires(
        "#define SIG_A 1\n#define SIG_B 2\nF() { set-signal-mask SIG_B; }\nG() { signal SIG_B; }",
        "signal-never-signalled"
    ));
}

#[test]
fn signal_never_signalled_skips_entirely_when_a_signal_argument_is_not_constant() {
    // x is not a `#define`, so no signal argument here can be evaluated, and
    // the rule must not guess.
    assert!(!fires(
        "#define SIG_B 2\nF() { set-signal-mask SIG_B; }\nG(x) { signal x; }",
        "signal-never-signalled"
    ));
}

#[test]
fn callin_name_flags_a_near_miss_but_not_the_real_thing() {
    assert!(fires("Aimweapon1(heading, pitch) { }", "callin-name"));
    assert!(!fires(
        "AimWeapon1(heading, pitch) { return (1); }",
        "callin-name"
    ));
}

#[test]
fn callin_name_flags_a_weapon_number_past_the_engines_range() {
    assert!(fires("AimWeapon40(heading, pitch) { }", "callin-name"));
}

#[test]
fn missing_piece_flags_a_piece_the_model_does_not_have() {
    let model = vec!["base".to_string()];
    assert!(fires_with_pieces(
        "piece ghost;\nF() { hide ghost; }",
        &model,
        "missing-piece"
    ));
    let model = vec!["ghost".to_string()];
    assert!(!fires_with_pieces(
        "piece ghost;\nF() { hide ghost; }",
        &model,
        "missing-piece"
    ));
}

fn fires_with_pieces(source: &str, pieces: &[String], rule: &str) -> bool {
    lint_with(source, &HashMap::new(), Some(pieces))
        .iter()
        .any(|d| d.rule == rule)
}

#[test]
fn weapon_without_aim_flags_a_query_with_no_aim() {
    assert!(fires(
        "QueryWeapon1(piecenum) { piecenum = flare; }",
        "weapon-without-aim"
    ));
    assert!(!fires(
        "QueryWeapon1(piecenum) { piecenum = flare; }\nAimWeapon1(heading, pitch) { return (1); }",
        "weapon-without-aim"
    ));
}

#[test]
fn a_parse_failure_is_reported_the_same_way_convert_reports_it() {
    let err = lint(
        "F( {",
        &LintOptions {
            name: "broken.bos",
            includes: &HashMap::new(),
            pieces: None,
            linear_scale: MODERN_LINEAR,
            precedence: Precedence::Modern,
        },
    )
    .unwrap_err();
    assert!(err.starts_with("broken.bos:"), "{err}");
}

#[test]
fn diagnostics_are_sorted_by_line() {
    let diags = lint_src("F() {\n\tcall-script Ghost();\n\tif (0) { sleep 1; }\n}\n");
    let lines: Vec<u32> = diags.iter().map(|d| d.line).collect();
    let mut sorted = lines.clone();
    sorted.sort();
    assert_eq!(lines, sorted);
}

/// Every file under `dir`, at any depth.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// Lints every `.bos` in the fixture corpus and prints how often each rule
/// fires, so a rule that is noisy on real scripts shows up here rather than
/// only in a single crafted example.
#[test]
fn corpus_noise_report() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut all = Vec::new();
    collect_files(&dir, &mut all);
    let rel = |p: &Path| {
        p.strip_prefix(&dir)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/")
    };
    let includes: HashMap<String, String> = all
        .iter()
        .map(|p| (rel(p), std::fs::read_to_string(p).unwrap()))
        .collect();
    let scripts: Vec<&PathBuf> = all
        .iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("bos")))
        .collect();

    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    for path in &scripts {
        let name = rel(path);
        let source = std::fs::read_to_string(path).unwrap();
        let diags = lint(
            &source,
            &LintOptions {
                name: &name,
                includes: &includes,
                pieces: None,
                linear_scale: MODERN_LINEAR,
                precedence: Precedence::Modern,
            },
        )
        .unwrap_or_else(|e| panic!("{name} failed to lint: {e}"));
        for d in diags {
            *counts.entry(d.rule).or_default() += 1;
        }
    }
    eprintln!(
        "lint corpus noise report over {} script(s): {counts:?}",
        scripts.len()
    );
}
