//! A linter over the same tree [`crate::convert`] builds, so it sees exactly
//! what a conversion would: the script, every `#include` it pulls in, and the
//! constants those define.
//!
//! Every rule analyses the whole tree, included headers and all, but only
//! ever reports a diagnostic whose own line sits in the main script (file
//! `0`). A shared header is usually somebody else's file, included by many
//! scripts, and its own unused declarations or odd shapes are not this
//! script's problem to flag.
//!
//! Deliberately not implemented: a long-function or high-complexity rule,
//! because any length or branching count this crate picked would be an
//! arbitrary threshold with no basis in the engine, and would be noisy on the
//! real scripts games ship. Also not implemented: an unnamed-global rule,
//! because that only ever arises from a decompiled script, and coilbox has no
//! decompiler.
//!
//! Also removed after a sweep of 891 real scripts, once each had shown itself
//! to be noise rather than a real problem:
//!
//! - `weapon-without-aim`, because `AimWeapon1` is a convention of the Lua
//!   unit script framework, not the engine's COB runtime, which calls each
//!   weapon's call-ins directly. It stays as a conversion warning in
//!   `emit.rs`.
//! - `sleep-only-guard`, because guarding a `sleep delay` call with
//!   `if (delay > 0)` is ordinary and correct.
//! - `duplicate-if`, because it fired in 263 of the 891 scripts, on gait
//!   phases that deliberately re-check the same flag.
//! - `unused-piece`, because it fired in 617 of the 891 scripts, and pieces
//!   usually exist to fill out the model hierarchy rather than to be named
//!   anywhere.

use crate::emit::{exprs_in, names_in};
use crate::parse::{Expr, Func, ItemKind, Stmt, StmtKind};
use crate::pp;
use crate::Precedence;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Severity {
    /// The engine's name for it, lower case. The crate has no `serde`
    /// dependency to derive a serialisation from, so a caller that wants JSON
    /// builds it from this.
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Info => "info",
        }
    }
}

#[derive(Debug)]
pub struct Diagnostic {
    pub rule: &'static str,
    pub severity: Severity,
    pub line: u32,
    pub message: String,
}

pub struct LintOptions<'a> {
    /// The script's own path, as [`crate::Options::name`] is.
    pub name: &'a str,
    /// Files the script may include, by path, as [`crate::Options::includes`].
    pub includes: &'a HashMap<String, String>,
    /// The model's piece names, when known. Turns on `missing-piece`.
    pub pieces: Option<&'a [String]>,
    pub linear_scale: i64,
    pub precedence: Precedence,
}

pub fn lint(source: &str, options: &LintOptions) -> Result<Vec<Diagnostic>, String> {
    let crate::Parsed { items, pre } = crate::preprocess_and_parse(
        source,
        options.name,
        options.includes,
        options.linear_scale,
        options.precedence,
    )?;
    let funcs: Vec<&Func> = items
        .iter()
        .filter_map(|item| match &item.kind {
            ItemKind::Func(f) => Some(f),
            _ => None,
        })
        .collect();
    let main_funcs: Vec<&Func> = funcs.iter().filter(|f| f.file == 0).copied().collect();
    let (pieces, statics) = declared_names(&pre.tokens);
    let mut out = Vec::new();

    unused_names_rule(&statics, &funcs, &mut out);
    for f in &main_funcs {
        unused_local_rule(f, &mut out);
        speed_zero_rule(f, &pre.constants, &mut out);
        dead_code_rule(f, &pre.constants, &mut out);
        always_true_rule(f, &pre.constants, &mut out);
        raw_signal_rule(f, &mut out);
        empty_function_rule(f, &mut out);
        callin_name_rule(f, &mut out);
    }
    // A missing header means the linter cannot see what it defines, so a
    // call into it would misread as a call to nothing. Say that once per
    // missing name instead, rather than every call it happens to cover.
    if pre.missing.is_empty() {
        invalid_call_rule(&funcs, &mut out);
    } else {
        missing_include_rule(&pre.missing, &mut out);
    }
    recursive_call_rule(&funcs, &mut out);
    signal_never_signalled_rule(&funcs, &pre.constants, &mut out);
    let mut blocks: Vec<&[Stmt]> = Vec::new();
    for f in &funcs {
        collect_blocks(&f.body, &mut blocks);
    }
    duplicate_animation_rule(&blocks, &mut out);
    if let Some(model) = options.pieces {
        missing_piece_rule(&pieces, model, &mut out);
    }

    out.sort_by_key(|d| d.line);
    Ok(out)
}

/// Every name a `piece` or `static-var` item declares, each with the line and
/// file of its own name token. Read straight from the token stream rather
/// than the parsed tree, because `Item` keeps no line, only `Stmt` and `Func`
/// do.
#[allow(clippy::type_complexity)]
fn declared_names(
    tokens: &[crate::lex::Token],
) -> (Vec<(String, u32, usize)>, Vec<(String, u32, usize)>) {
    let code: Vec<&crate::lex::Token> = tokens.iter().filter(|t| !t.is_comment()).collect();
    let mut pieces = Vec::new();
    let mut statics = Vec::new();
    let mut i = 0;
    while i < code.len() {
        if code[i].is_word("piece") {
            i = read_declared_names(&code, i + 1, &mut pieces);
        } else if code[i].is_word("static")
            && code.get(i + 1).is_some_and(|t| t.is_sym("-"))
            && code.get(i + 2).is_some_and(|t| t.is_word("var"))
        {
            i = read_declared_names(&code, i + 3, &mut statics);
        } else {
            i += 1;
        }
    }
    (pieces, statics)
}

/// The comma-separated names starting at `at`, up to and including the `;`
/// that ends them.
fn read_declared_names(
    code: &[&crate::lex::Token],
    mut i: usize,
    out: &mut Vec<(String, u32, usize)>,
) -> usize {
    loop {
        match code.get(i) {
            Some(t) if t.kind == crate::lex::Kind::Ident => {
                out.push((t.text.clone(), t.line, t.file))
            }
            _ => return i,
        }
        i += 1;
        match code.get(i) {
            Some(t) if t.is_sym(",") => i += 1,
            Some(t) if t.is_sym(";") => return i + 1,
            _ => return i,
        }
    }
}

/// The name a piece-carrying statement names, not counting a plain
/// assignment, increment or decrement: those write a variable, and only
/// naming a piece by one of these counts as using it.
fn piece_target(k: &StmtKind) -> Option<&str> {
    match k {
        StmtKind::Spin { piece: n, .. }
        | StmtKind::StopSpin { piece: n, .. }
        | StmtKind::Turn { piece: n, .. }
        | StmtKind::Move { piece: n, .. }
        | StmtKind::Scale { piece: n, .. }
        | StmtKind::WaitTurn(n, _)
        | StmtKind::WaitMove(n, _)
        | StmtKind::WaitScale(n)
        | StmtKind::EmitSfx(_, n)
        | StmtKind::Hide(n)
        | StmtKind::Show(n)
        | StmtKind::Explode(n, _) => Some(n),
        _ => None,
    }
}

/// Every name read anywhere in the tree, lower-cased: every piece-carrying
/// statement's piece, and every `Expr::Name` any statement's expressions
/// mention. A plain assignment's own target is not in here, since writing a
/// name is not reading it, which is exactly what `unused-static` needs.
fn mentioned_names(funcs: &[&Func]) -> HashSet<String> {
    let mut used = HashSet::new();
    let mut consts = HashSet::new();
    for f in funcs {
        each_stmt(&f.body, &mut |s| {
            if let Some(n) = piece_target(&s.kind) {
                used.insert(n.to_lowercase());
            }
            for e in exprs_in(&s.kind) {
                names_in(e, &mut used, &mut consts);
            }
        });
    }
    used
}

fn unused_names_rule(
    declared: &[(String, u32, usize)],
    funcs: &[&Func],
    out: &mut Vec<Diagnostic>,
) {
    let used = mentioned_names(funcs);
    let mut seen = HashSet::new();
    for (name, line, file) in declared {
        if *file != 0 || !seen.insert(name.to_lowercase()) {
            continue;
        }
        if !used.contains(&name.to_lowercase()) {
            out.push(Diagnostic {
                rule: "unused-static",
                severity: Severity::Info,
                line: *line,
                message: format!(
                    "`{name}` is declared with `static-var` but never read, so writing to it has no \
                     effect anywhere else in the script."
                ),
            });
        }
    }
}

/// Every statement in a body, at any depth, including a `for`'s own `init`
/// and `step` clauses. Unlike `emit`'s `walk`, this keeps the whole `Stmt`,
/// since a diagnostic needs the line it carries.
fn each_stmt<'s>(body: &'s [Stmt], f: &mut impl FnMut(&'s Stmt)) {
    for s in body {
        f(s);
        match &s.kind {
            StmtKind::If { then, els, .. } => {
                each_stmt(then, f);
                if let Some((els, _)) = els {
                    each_stmt(els, f);
                }
            }
            StmtKind::While { body, .. } | StmtKind::Block(body, _) => each_stmt(body, f),
            StmtKind::For {
                init, step, body, ..
            } => {
                for clause in [init, step].into_iter().flatten() {
                    f(clause);
                }
                each_stmt(body, f);
            }
            _ => {}
        }
    }
}

/// Every block of sibling statements in the tree: a function's own body, each
/// arm of an `if`, and a loop's or a bare `{ }`'s body. `duplicate-animation`
/// and `duplicate-if` compare consecutive statements within one of these,
/// never across the boundary into a different block.
fn collect_blocks<'s>(body: &'s [Stmt], out: &mut Vec<&'s [Stmt]>) {
    out.push(body);
    for s in body {
        match &s.kind {
            StmtKind::If { then, els, .. } => {
                collect_blocks(then, out);
                if let Some((els, _)) = els {
                    collect_blocks(els, out);
                }
            }
            StmtKind::While { body, .. }
            | StmtKind::Block(body, _)
            | StmtKind::For { body, .. } => collect_blocks(body, out),
            _ => {}
        }
    }
}

fn unused_local_rule(f: &Func, out: &mut Vec<Diagnostic>) {
    let mut declared: Vec<(String, u32)> = Vec::new();
    let mut read = HashSet::new();
    let mut consts = HashSet::new();
    each_stmt(&f.body, &mut |s| {
        if let StmtKind::Var(names) = &s.kind {
            declared.extend(names.iter().map(|n| (n.clone(), s.line)));
        }
        for e in exprs_in(&s.kind) {
            names_in(e, &mut read, &mut consts);
        }
    });
    for (name, line) in declared {
        if !read.contains(&name.to_lowercase()) {
            out.push(Diagnostic {
                rule: "unused-local",
                severity: Severity::Warning,
                line,
                message: format!("`{name}` is declared with `var` but never read, so it can never affect anything."),
            });
        }
    }
}

fn invalid_call_rule(funcs: &[&Func], out: &mut Vec<Diagnostic>) {
    let known: HashSet<String> = funcs.iter().map(|f| f.name.to_lowercase()).collect();
    for f in funcs {
        each_stmt(&f.body, &mut |s| {
            if s.file != 0 {
                return;
            }
            let (word, name) = match &s.kind {
                StmtKind::Call(name, _) => ("call-script", name),
                StmtKind::Start(name, _) => ("start-script", name),
                _ => return,
            };
            if !known.contains(&name.to_lowercase()) {
                out.push(Diagnostic {
                    rule: "invalid-call",
                    severity: Severity::Error,
                    line: s.line,
                    message: format!(
                        "`{word}` names `{name}`, which the script never defines, so nothing happens when this runs."
                    ),
                });
            }
        });
    }
}

/// One `missing-include` per name the preprocessor could not find, in place
/// of `invalid-call`: with a header missing, a call into it cannot be told
/// from a genuine typo, so guessing which is worse than saying neither.
fn missing_include_rule(missing: &[String], out: &mut Vec<Diagnostic>) {
    let mut seen = HashSet::new();
    for name in missing {
        if seen.insert(name.clone()) {
            out.push(Diagnostic {
                rule: "missing-include",
                severity: Severity::Info,
                line: 1,
                message: format!(
                    "`{name}` could not be found, so the linter cannot see what it defines, and calls into it are not checked."
                ),
            });
        }
    }
}

/// The functions nothing calls, and the ones that only call each other,
/// carry no cycle the linter cares about, so this walks the call graph made
/// only of `call-script` edges (never `start-script`, which begins a new
/// thread and is how a script loops on purpose) and reports the edge that
/// closes each cycle it finds, once.
fn recursive_call_rule(funcs: &[&Func], out: &mut Vec<Diagnostic>) {
    let mut edges: HashMap<String, Vec<(String, u32, usize)>> = HashMap::new();
    for f in funcs {
        let entry = edges.entry(f.name.to_lowercase()).or_default();
        each_stmt(&f.body, &mut |s| {
            if let StmtKind::Call(name, _) = &s.kind {
                entry.push((name.to_lowercase(), s.line, s.file));
            }
        });
    }
    enum Mark {
        Visiting,
        Done,
    }
    fn visit(
        node: &str,
        edges: &HashMap<String, Vec<(String, u32, usize)>>,
        marks: &mut HashMap<String, Mark>,
        out: &mut Vec<Diagnostic>,
    ) {
        marks.insert(node.to_string(), Mark::Visiting);
        if let Some(callees) = edges.get(node) {
            for (callee, line, file) in callees {
                match marks.get(callee) {
                    Some(Mark::Visiting) => {
                        if *file == 0 {
                            out.push(Diagnostic {
                                rule: "recursive-call",
                                severity: Severity::Warning,
                                line: *line,
                                message: format!(
                                    "`call-script {callee}` closes a cycle of calls, so the calling thread never returns and anything waiting on it waits forever."
                                ),
                            });
                        }
                    }
                    Some(Mark::Done) => {}
                    None => visit(callee, edges, marks, out),
                }
            }
        }
        marks.insert(node.to_string(), Mark::Done);
    }
    let mut marks: HashMap<String, Mark> = HashMap::new();
    for f in funcs {
        let name = f.name.to_lowercase();
        if !marks.contains_key(&name) {
            visit(&name, &edges, &mut marks, out);
        }
    }
}

/// A value straight off a literal or a resolved `#define`, without folding an
/// expression, so `1 - 1` does not count as a constant zero: only what the
/// BOS itself would have written as a bare zero.
fn literal_value(e: &Expr, constants: &HashMap<String, pp::Constant>) -> Option<i64> {
    match e {
        Expr::Num(n) => Some(*n),
        Expr::Angle(_, v) | Expr::Linear(_, v) => Some(*v),
        Expr::Const(name) => constants.get(name).map(|c| c.value),
        _ => None,
    }
}

fn speed_zero_rule(f: &Func, constants: &HashMap<String, pp::Constant>, out: &mut Vec<Diagnostic>) {
    each_stmt(&f.body, &mut |s| {
        if s.file != 0 {
            return;
        }
        let (verb, speed) = match &s.kind {
            StmtKind::Turn { speed: Some(e), .. } => ("turn", e),
            StmtKind::Move { speed: Some(e), .. } => ("move", e),
            _ => return,
        };
        if literal_value(speed, constants) == Some(0) {
            out.push(Diagnostic {
                rule: "speed-zero",
                severity: Severity::Warning,
                line: s.line,
                message: format!(
                    "`{verb}` at speed 0 never finishes, so anything waiting for it waits forever."
                ),
            });
        }
    });
}

fn dead_code_rule(f: &Func, constants: &HashMap<String, pp::Constant>, out: &mut Vec<Diagnostic>) {
    each_stmt(&f.body, &mut |s| {
        if s.file != 0 {
            return;
        }
        let (kind, cond) = match &s.kind {
            StmtKind::If { cond, .. } => ("if", cond),
            StmtKind::While { cond, .. } => ("while", cond),
            _ => return,
        };
        if literal_value(cond, constants) == Some(0) {
            out.push(Diagnostic {
                rule: "dead-code",
                severity: Severity::Warning,
                line: s.line,
                message: format!("this `{kind}` always tests false, so its body never runs."),
            });
        }
    });
}

fn always_true_rule(
    f: &Func,
    constants: &HashMap<String, pp::Constant>,
    out: &mut Vec<Diagnostic>,
) {
    each_stmt(&f.body, &mut |s| {
        if s.file != 0 {
            return;
        }
        let StmtKind::If { cond, .. } = &s.kind else {
            return;
        };
        if literal_value(cond, constants).is_some_and(|v| v != 0) {
            out.push(Diagnostic {
                rule: "always-true",
                severity: Severity::Info,
                line: s.line,
                message: "this `if` always tests true, so the condition adds nothing here.".into(),
            });
        }
    });
}

fn raw_signal_rule(f: &Func, out: &mut Vec<Diagnostic>) {
    each_stmt(&f.body, &mut |s| {
        if s.file != 0 {
            return;
        }
        let (verb, e) = match &s.kind {
            StmtKind::Signal(e) => ("signal", e),
            StmtKind::SetSignalMask(e) => ("set-signal-mask", e),
            _ => return,
        };
        if let Expr::Num(n) = e {
            if *n != 0 {
                out.push(Diagnostic {
                    rule: "raw-signal",
                    severity: Severity::Info,
                    line: s.line,
                    message: format!(
                        "`{verb} {n}` writes a bare number rather than a `#define`d name, which is easy to misread against another signal."
                    ),
                });
            }
        }
    });
}

const CALLINS: &[&str] = &[
    "Create",
    "Destroy",
    "StartMoving",
    "StopMoving",
    "Activate",
    "Killed",
    "Deactivate",
    "SetDirection",
    "SetSpeed",
    "RockUnit",
    "HitByWeapon",
    "setSFXoccupy",
    "HitByWeaponId",
    "QueryLandingPadCount",
    "QueryLandingPad",
    "Falling",
    "Landed",
    "BeginTransport",
    "QueryTransport",
    "TransportPickup",
    "StartUnload",
    "EndTransport",
    "TransportDrop",
    "SetMaxReloadTime",
    "StartBuilding",
    "StopBuilding",
    "QueryNanoPiece",
    "QueryBuildInfo",
    "Go",
    "QueryPrimary",
    "QuerySecondary",
    "QueryTertiary",
    "AimPrimary",
    "AimSecondary",
    "AimTertiary",
    "AimFromPrimary",
    "AimFromSecondary",
    "AimFromTertiary",
    "FirePrimary",
    "FireSecondary",
    "FireTertiary",
];

/// The prefix of every call-in numbered 1 to 32, exactly as the engine spells
/// it (`CobScriptNames.cpp`).
const WEAPON_PREFIXES: &[&str] = &[
    "QueryWeapon",
    "AimWeapon",
    "AimFromWeapon",
    "FireWeapon",
    "EndBurst",
    "Shot",
    "BlockShot",
    "TargetWeight",
];

/// Whether the engine dispatches to `name` by that exact spelling
/// (`CCobFile::GetFunctionId`, CobFile.cpp:212, matches by exact string, so a
/// case or a leading zero is enough to miss it).
fn is_callin(name: &str) -> bool {
    if CALLINS.contains(&name) {
        return true;
    }
    for prefix in WEAPON_PREFIXES {
        if let Some(digits) = name.strip_prefix(prefix) {
            if !digits.is_empty() && !digits.starts_with('0') {
                if let Ok(n) = digits.parse::<u32>() {
                    if (1..=32).contains(&n) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

enum NearMiss {
    /// The name the engine actually calls.
    Rename(String),
    /// A numbered weapon call-in past the engine's own range.
    OutOfRange(String),
}

/// What `name` is close enough to that it was almost certainly meant to be a
/// call-in, if it is not one already. `None` when it matches nothing close
/// enough to be worth a warning, since a game may call any function in the
/// script by any name from Lua.
fn near_callin(name: &str) -> Option<NearMiss> {
    if is_callin(name) {
        return None;
    }
    for prefix in WEAPON_PREFIXES {
        if name.len() <= prefix.len() || !name[..prefix.len()].eq_ignore_ascii_case(prefix) {
            continue;
        }
        let digits = &name[prefix.len()..];
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let Ok(n) = digits.parse::<u32>() else {
            continue;
        };
        if n > 32 {
            return Some(NearMiss::OutOfRange(format!("{prefix}{n}")));
        }
        if n >= 1 {
            let canonical = format!("{prefix}{n}");
            if canonical != name {
                return Some(NearMiss::Rename(canonical));
            }
        }
    }
    for &fixed in CALLINS {
        if fixed.eq_ignore_ascii_case(name) && fixed != name {
            return Some(NearMiss::Rename(fixed.to_string()));
        }
    }
    None
}

fn callin_name_rule(f: &Func, out: &mut Vec<Diagnostic>) {
    let message = match near_callin(&f.name) {
        Some(NearMiss::Rename(canonical)) => format!(
            "The engine calls `{canonical}`, not `{}`, so this function never runs.",
            f.name
        ),
        Some(NearMiss::OutOfRange(wanted)) => {
            format!("The engine only numbers weapon call-ins 1 to 32, so `{wanted}` never runs.")
        }
        None => return,
    };
    out.push(Diagnostic {
        rule: "callin-name",
        severity: Severity::Warning,
        line: f.line,
        message,
    });
}

fn is_empty_body(body: &[Stmt]) -> bool {
    match body {
        [] => true,
        [only] => matches!(
            &only.kind,
            StmtKind::Return(None) | StmtKind::Return(Some(Expr::Num(0)))
        ),
        _ => false,
    }
}

fn empty_function_rule(f: &Func, out: &mut Vec<Diagnostic>) {
    if is_callin(&f.name) {
        return;
    }
    if f.name.to_lowercase().starts_with("lua_") {
        return;
    }
    if is_empty_body(&f.body) {
        out.push(Diagnostic {
            rule: "empty-function",
            severity: Severity::Info,
            line: f.line,
            message: format!(
                "`{}` has an empty body, so calling it does nothing.",
                f.name
            ),
        });
    }
}

/// A value folded the way the engine's COB interpreter would, following
/// `#define`d names through [`pp::Constant`]. Used only where a full
/// evaluation is needed, unlike [`literal_value`], because
/// `signal-never-signalled` must see through `SIG_A | SIG_B`.
fn const_value(e: &Expr, constants: &HashMap<String, pp::Constant>) -> Option<i64> {
    match e {
        Expr::Num(n) => Some(*n),
        Expr::Angle(_, v) | Expr::Linear(_, v) => Some(*v),
        Expr::Const(name) => constants.get(name).map(|c| c.value),
        Expr::Neg(inner) => const_value(inner, constants).map(|v| -v),
        Expr::Not(inner) => const_value(inner, constants).map(|v| i64::from(v == 0)),
        Expr::Bin(op, a, b) => {
            pp::apply(op, const_value(a, constants)?, const_value(b, constants)?)
        }
        Expr::Rand(..) | Expr::Get(..) | Expr::Name(_) => None,
    }
}

fn signal_never_signalled_rule(
    funcs: &[&Func],
    constants: &HashMap<String, pp::Constant>,
    out: &mut Vec<Diagnostic>,
) {
    let mut signalled: Vec<i64> = Vec::new();
    let mut unknown = false;
    for f in funcs {
        each_stmt(&f.body, &mut |s| {
            if let StmtKind::Signal(e) = &s.kind {
                match const_value(e, constants) {
                    Some(v) => signalled.push(v),
                    None => unknown = true,
                }
            }
        });
    }
    // A `signal` this cannot work out might set any bit, so nothing can be
    // said to be never signalled.
    if unknown {
        return;
    }
    for f in funcs {
        each_stmt(&f.body, &mut |s| {
            if s.file != 0 {
                return;
            }
            let StmtKind::SetSignalMask(e) = &s.kind else {
                return;
            };
            let Some(mask) = const_value(e, constants) else {
                return;
            };
            if mask == 0 || signalled.iter().any(|s| s & mask != 0) {
                return;
            }
            out.push(Diagnostic {
                rule: "signal-never-signalled",
                severity: Severity::Warning,
                line: s.line,
                message: "nothing anywhere in the script signals a bit this mask covers, so whatever waits on this mask being cut short waits forever.".into(),
            });
        });
    }
}

fn is_animation(k: &StmtKind) -> bool {
    matches!(
        k,
        StmtKind::Spin { .. }
            | StmtKind::StopSpin { .. }
            | StmtKind::Turn { .. }
            | StmtKind::Move { .. }
            | StmtKind::Scale { .. }
    )
}

fn duplicate_animation_rule(blocks: &[&[Stmt]], out: &mut Vec<Diagnostic>) {
    for block in blocks {
        for pair in block.windows(2) {
            let [a, b] = pair else { continue };
            if b.file != 0 || !is_animation(&a.kind) || !is_animation(&b.kind) {
                continue;
            }
            if format!("{:?}", a.kind) == format!("{:?}", b.kind) {
                out.push(Diagnostic {
                    rule: "duplicate-animation",
                    severity: Severity::Warning,
                    line: b.line,
                    message: "this repeats the animation right before it with nothing in between, so the first one has no visible effect.".into(),
                });
            }
        }
    }
}

fn missing_piece_rule(
    declared: &[(String, u32, usize)],
    model: &[String],
    out: &mut Vec<Diagnostic>,
) {
    let mut seen = HashSet::new();
    for (name, line, file) in declared {
        if *file != 0 || !seen.insert(name.to_lowercase()) {
            continue;
        }
        if !model.iter().any(|m| m.eq_ignore_ascii_case(name)) {
            out.push(Diagnostic {
                rule: "missing-piece",
                severity: Severity::Warning,
                line: *line,
                message: format!(
                    "`{name}` matches no piece in the model. The engine cannot find it, so every animation of it does nothing."
                ),
            });
        }
    }
}
