//! Constant folder — a port of `Node.fold_node` (bos2cob_py3.py L361-469) plus
//! the fixpoint driver in `main()`. Post-order, one transform per node per pass;
//! the driver re-runs until no fold occurs.
//!
//! Byte-exactness hazards (PORTING.md §7):
//! - division folds that yield `abs(result) < 1` with a nonzero numerator are
//!   SKIPPED (left for the runtime `DIV`);
//! - arithmetic uses Python `eval` typing: `int op int -> int`, anything with a
//!   float -> float, `/` is always float; bitwise `& | ^` require ints (folding
//!   is skipped — like Python's `TypeError` — when an operand is a float);
//! - `str(result)` distinguishes int from float text, which decides whether a
//!   later pass can re-fold the value.

use crate::parser::Node;

pub const LINEAR_SCALE: i64 = 65536;
pub const ANGULAR_SCALE: i64 = 182;

/// `OPS_PYEVAL_PRECEDENCE` (L254) — the order folds are attempted in.
const OPS_PYEVAL_PRECEDENCE: [&str; 8] = ["%", "*", "/", "+", "-", "|", "&", "^"];

/// Fold the tree to a fixpoint (mirrors the `while folds > 0` loop in `main`).
pub fn fold_tree(root: &mut Node) {
    let mut folds = fold_node(root);
    while folds > 0 {
        folds = fold_node(root);
    }
}

fn fold_node(node: &mut Node) -> i64 {
    let mut foldcount = 0;
    for child in &mut node.children {
        foldcount += fold_node(child);
    }

    match node.ntype.as_str() {
        "signedFloatConstant" => negative_collapse(node),
        "constant" => bracket_scale(node),
        "expression" => foldcount += fold_expression(node),
        "term" => foldcount += paren_collapse(node),
        _ => {}
    }
    foldcount
}

/// `signedFloatConstant [-, X]` -> single `floatConstant` with text `-X`.
fn negative_collapse(node: &mut Node) {
    if node.children.len() == 2 && node.children[0].text.as_deref() == Some("-") {
        node.children.remove(0);
        if let Some(t) = node.children[0].text.as_mut() {
            *t = format!("-{t}");
        }
    }
}

/// `[X]` -> `X*65536`, `<X>` -> `X*182`; pops the bracket symbols.
fn bracket_scale(node: &mut Node) {
    if node.children.len() != 3 {
        return;
    }
    let sym1 = node.children[0].text.clone();
    let sym2 = node.children[2].text.clone();
    let scale = match (sym1.as_deref(), sym2.as_deref()) {
        (Some("["), Some("]")) => LINEAR_SCALE,
        (Some("<"), Some(">")) => ANGULAR_SCALE,
        _ => return,
    };
    node.children.remove(2);
    node.children.remove(0);
    // children[0] is now the signedFloatConstant; its floatConstant child holds
    // the value text.
    if let Some(float_node) = node.children[0].children.get_mut(0) {
        if let Some(t) = float_node.text.as_ref() {
            if let Ok(v) = t.parse::<f64>() {
                float_node.text = Some(py_float_str(v * scale as f64));
            }
        }
    }
}

/// `( signedFloatConstant )` term -> the inner constant.
fn paren_collapse(node: &mut Node) -> i64 {
    if node.children.len() != 3 {
        return 0;
    }
    if node.children[0].ntype != "symbol"
        || node.children[2].ntype != "symbol"
        || node.children[1].children.len() != 1
    {
        return 0;
    }
    let inner_term = &node.children[1].children[0];
    if term_float_node(inner_term).is_none() {
        return 0;
    }
    let constant = node.children[1].children[0].children[0].clone();
    node.children = vec![constant];
    1
}

/// Fold adjacent constant pairs in an expression (`L392-441`).
///
/// Reference quirk: the left operand (`term1`) can ONLY be the child at index
/// `i` when that child is itself a bare constant `term`. The Python branch that
/// would let `term1` come from an `opterm`'s right term is dead code: it ANDs in
/// the result of `term_is_a_signedFloatConstant()`, which is a `floatConstant`
/// Node whose `__len__()` is 0 and therefore falsy. Since expression children
/// are `[term, opterm, opterm, …]`, this means folding only ever chains from the
/// leading term — e.g. `y + 1 * 2` folds nothing, but `1 * 2 + y` folds `1*2`.
fn fold_expression(node: &mut Node) -> i64 {
    let mut foldcount = 0;
    for pyop in OPS_PYEVAL_PRECEDENCE {
        let mut i = 0usize;
        while i + 1 < node.children.len() {
            let Some(t1) = term_float_node(&node.children[i]).map(|f| f.get_text()) else {
                i += 1;
                continue;
            };

            let opterm = &node.children[i + 1];
            if opterm.ntype != "opterm"
                || opterm.children.len() < 2
                || opterm.children[0].ntype != "op"
            {
                i += 1;
                continue;
            }
            let Some(t2) = term_float_node(&opterm.children[1]).map(|f| f.get_text()) else {
                i += 1;
                continue;
            };
            let op = opterm.children[0].get_text();
            if op != pyop {
                i += 1;
                continue;
            }

            match eval_binop(&t1, &op, &t2) {
                Some(result) => {
                    if let Some(float_node) = term_float_node_mut(&mut node.children[i]) {
                        float_node.text = Some(result);
                    }
                    node.children.remove(i + 1);
                    foldcount += 1;
                    // do not advance i: keep folding into the same left term
                }
                None => i += 1,
            }
        }
    }
    foldcount
}

/// `term_is_a_signedFloatConstant` (L350-359): the `floatConstant` leaf of a
/// `term -> constant -> signedFloatConstant -> floatConstant` chain, or `None`.
fn term_float_node(term: &Node) -> Option<&Node> {
    if term.ntype != "term" || term.children.len() != 1 {
        return None;
    }
    let constant = &term.children[0];
    if constant.ntype != "constant" || constant.children.len() != 1 {
        return None;
    }
    let sfc = &constant.children[0];
    if sfc.ntype != "signedFloatConstant" || sfc.children.len() != 1 {
        return None;
    }
    let float = &sfc.children[0];
    if float.ntype != "floatConstant" || !float.children.is_empty() {
        return None;
    }
    Some(float)
}

fn term_float_node_mut(term: &mut Node) -> Option<&mut Node> {
    if term.ntype != "term" || term.children.len() != 1 {
        return None;
    }
    let constant = &mut term.children[0];
    if constant.ntype != "constant" || constant.children.len() != 1 {
        return None;
    }
    let sfc = &mut constant.children[0];
    if sfc.ntype != "signedFloatConstant" || sfc.children.len() != 1 {
        return None;
    }
    let float = &mut sfc.children[0];
    if float.ntype != "floatConstant" || !float.children.is_empty() {
        return None;
    }
    Some(float)
}

/// A folded numeric value, tracking int-vs-float like Python's `eval`.
#[derive(Clone, Copy)]
enum Num {
    Int(i64),
    Float(f64),
}

impl Num {
    fn as_f64(self) -> f64 {
        match self {
            Num::Int(i) => i as f64,
            Num::Float(f) => f,
        }
    }
    fn as_int(self) -> Option<i64> {
        match self {
            Num::Int(i) => Some(i),
            Num::Float(_) => None, // bitwise on a float is a TypeError in Python
        }
    }
    fn to_py_str(self) -> String {
        match self {
            Num::Int(i) => i.to_string(),
            Num::Float(f) => py_float_str(f),
        }
    }
}

fn parse_num(s: &str) -> Option<Num> {
    let s = s.trim();
    let looks_float = s.contains('.')
        || s.contains('e')
        || s.contains('E')
        || s.contains("inf")
        || s.contains("nan");
    if looks_float {
        s.parse::<f64>().ok().map(Num::Float)
    } else {
        s.parse::<i64>()
            .ok()
            .map(Num::Int)
            .or_else(|| s.parse::<f64>().ok().map(Num::Float))
    }
}

/// Evaluate `a op b` with Python semantics; `None` means "don't fold" (the
/// reference's `except` path: division-below-one or a bitwise type error).
fn eval_binop(a: &str, op: &str, b: &str) -> Option<String> {
    let a = parse_num(a)?;
    let b = parse_num(b)?;
    let result = match op {
        "+" => arith(a, b, |x, y| x + y, |x, y| x + y),
        "-" => arith(a, b, |x, y| x - y, |x, y| x - y),
        "*" => arith(a, b, |x, y| x * y, |x, y| x * y),
        "/" => {
            // Python 3 `/` is always float.
            let r = a.as_f64() / b.as_f64();
            if r.abs() < 1.0 && a.as_f64() != 0.0 {
                return None; // skip: leave as runtime DIV
            }
            Num::Float(r)
        }
        "%" => arith(a, b, py_mod_i, py_mod_f),
        "&" | "|" | "^" => {
            let (ia, ib) = (a.as_int()?, b.as_int()?);
            Num::Int(match op {
                "&" => ia & ib,
                "|" => ia | ib,
                "^" => ia ^ ib,
                _ => unreachable!(),
            })
        }
        _ => return None,
    };
    Some(result.to_py_str())
}

fn arith(a: Num, b: Num, fi: fn(i64, i64) -> i64, ff: fn(f64, f64) -> f64) -> Num {
    match (a, b) {
        (Num::Int(x), Num::Int(y)) => Num::Int(fi(x, y)),
        _ => Num::Float(ff(a.as_f64(), b.as_f64())),
    }
}

/// Python floored modulo (sign follows the divisor).
fn py_mod_i(a: i64, b: i64) -> i64 {
    let r = a % b;
    if r != 0 && (r < 0) != (b < 0) {
        r + b
    } else {
        r
    }
}

fn py_mod_f(a: f64, b: f64) -> f64 {
    let r = a % b;
    if r != 0.0 && (r < 0.0) != (b < 0.0) {
        r + b
    } else {
        r
    }
}

/// Approximate Python `str(float)`: always carries a decimal point (or exponent)
/// so a later fold pass treats the value as a float, like the reference.
fn py_float_str(f: f64) -> String {
    if !f.is_finite() {
        return format!("{f}");
    }
    if f == f.trunc() && f.abs() < 1e16 {
        return format!("{}.0", f as i64);
    }
    let s = format!("{f}");
    if s.contains('.') || s.contains('e') {
        s
    } else {
        format!("{s}.0")
    }
}
