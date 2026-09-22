//! Constant folder, a port of `Node.fold_node`, `fold_expression`,
//! `constant_value`, `term_constant_value`, `island_starts_safe`,
//! `island_ends_safe`, `evaluate_island` and `collect_piece_names`
//! (bos2cob_py3.py, "Rewrite constant folding" and "Add compile-time-constant
//! folding to emit-sfx"). Post-order, single pass: children are folded before
//! their parent, so nested parentheses and chained operators resolve in one
//! tree walk with no fixpoint loop.
//!
//! Byte-exactness notes (PORTING.md, byte-exactness hazards):
//! - folding only ever combines a run of terms (an "island") where the
//!   operator just before the island and the operator just after it cannot
//!   change meaning from the grouping, checked by `island_starts_safe` and
//!   `island_ends_safe` against real operator precedence.
//! - all folded values are plain 32-bit integers. `/` truncates toward zero
//!   and `%` takes the sign of the left operand (C semantics), not Python's
//!   floor semantics.
//! - a fold that would divide/mod by zero or overflow `i32` is skipped,
//!   leaving the runtime opcode in place.
//! - a piece name is a compile-time constant too (its index in the piece
//!   list), so `base + 1` folds the same way a literal would.

use crate::compiler::precedence;
use crate::parser::Node;
use std::collections::HashMap;

pub const LINEAR_SCALE: i64 = 65536;
pub const ANGULAR_SCALE: i64 = 182;

const INT32_MIN: i64 = -2147483648;
const INT32_MAX: i64 = 2147483647;

/// `FOLDABLE_OPS`, operators `fold_expression` will combine.
const FOLDABLE_OPS: [&str; 8] = ["+", "-", "*", "/", "%", "&", "|", "^"];
/// `ASSOCIATIVE_OPS`, operators that may start an island at an equal-precedence
/// boundary, because repeating the same associative operator can't change
/// which operand belongs to which side.
const ASSOCIATIVE_OPS: [&str; 5] = ["+", "*", "&", "|", "^"];

/// Fold the tree in a single post-order pass, using piece names collected from
/// the whole tree as compile-time constants (their index in the piece list).
pub fn fold_tree(root: &mut Node) {
    let piece_map = build_piece_map(root);
    fold_node(root, &piece_map);
}

fn build_piece_map(root: &Node) -> HashMap<String, i64> {
    let mut names = Vec::new();
    collect_piece_names(root, &mut names);
    names
        .into_iter()
        .enumerate()
        .map(|(i, name)| (name.to_lowercase(), i as i64))
        .collect()
}

/// `collect_piece_names`, walk the whole tree gathering every `pieceDec`'s
/// names, in declared order (so the index matches the piece list the
/// compiler builds later).
fn collect_piece_names(node: &Node, names: &mut Vec<String>) {
    if node.ntype == "pieceDec" {
        names.push(node.children[1].get_text());
        for child in &node.children[2..] {
            if child.ntype == "commaPiece" {
                names.push(child.children[1].get_text());
            }
        }
    }
    for child in &node.children {
        collect_piece_names(child, names);
    }
}

fn fold_node(node: &mut Node, piece_map: &HashMap<String, i64>) -> i64 {
    let mut count = 0;
    for child in &mut node.children {
        count += fold_node(child, piece_map);
    }

    if node.ntype == "term" && node.children.len() == 3 {
        count += paren_collapse(node, piece_map);
    } else if node.ntype == "expression" {
        count += fold_expression(node, piece_map);
    }
    count
}

/// `( expression )` where the expression is a single compile-time-constant
/// term collapses to that term's child directly (a `constant` node, or a
/// `varName` node when a piece name folded via `piece_map`).
fn paren_collapse(node: &mut Node, piece_map: &HashMap<String, i64>) -> i64 {
    let is_paren = node.children[0].ntype == "symbol"
        && node.children[2].ntype == "symbol"
        && node.children[0].get_text() == "("
        && node.children[2].get_text() == ")"
        && node.children[1].ntype == "expression"
        && node.children[1].children.len() == 1;
    if !is_paren {
        return 0;
    }
    if term_constant_value(&node.children[1].children[0], piece_map).is_none() {
        return 0;
    }
    let inner = node.children[1].children[0].children[0].clone();
    node.children = vec![inner];
    1
}

/// `constant_value`, the compile-time value of a `constant` node: `int(scale
/// * float(raw))`, where `raw` is the whole node's text (so both the plain
/// `signedFloatConstant`/`signedIntegerConstant` form and a folded
/// `integerConstant` leaf work the same way) and `scale` is `LINEAR_SCALE`
/// for `[X]`, `ANGULAR_SCALE` for `<X>`, or `1` for a plain number.
pub(crate) fn constant_value(node: &Node) -> Option<i64> {
    if node.ntype != "constant" {
        return None;
    }
    let (scale, raw) = match node.children.len() {
        3 => {
            let scale = match (
                node.children[0].get_text().as_str(),
                node.children[2].get_text().as_str(),
            ) {
                ("[", "]") => LINEAR_SCALE,
                ("<", ">") => ANGULAR_SCALE,
                _ => return None,
            };
            (scale, node.children[1].get_text())
        }
        1 => (1, node.children[0].get_text()),
        _ => return None,
    };
    let raw: f64 = raw.parse().ok()?;
    Some((scale as f64 * raw) as i64)
}

/// `term_constant_value`, the compile-time value of a bare `term`: a piece
/// name looked up in `piece_map` (its index), or `constant_value` of the
/// term's single child.
fn term_constant_value(term: &Node, piece_map: &HashMap<String, i64>) -> Option<i64> {
    if term.ntype != "term" || term.children.len() != 1 {
        return None;
    }
    let child = &term.children[0];
    if child.ntype == "varName" {
        return piece_map.get(&child.get_text().to_lowercase()).copied();
    }
    constant_value(child)
}

/// `island_starts_safe`, an island may open at position `k` (`k == 0`
/// always may) only if the operator right before it doesn't bind tighter than
/// the island's own first operator, or ties with it via a repeated
/// associative operator.
fn island_starts_safe(children: &[Node], k: usize) -> bool {
    if k == 0 {
        return true;
    }
    let left_op = children[k].children[0].get_text();
    let first_op = children[k + 1].children[0].get_text();
    let (lp, fp) = (precedence(&left_op), precedence(&first_op));
    if fp < lp {
        return true;
    }
    fp == lp && left_op == first_op && ASSOCIATIVE_OPS.contains(&first_op.as_str())
}

/// `island_ends_safe`, an island may close at position `m` (end-of-expression
/// always may) only if its own last operator doesn't bind looser than the
/// operator right after it.
fn island_ends_safe(children: &[Node], m: usize) -> bool {
    if m + 1 >= children.len() {
        return true;
    }
    let last_op = children[m].children[0].get_text();
    let boundary_op = children[m + 1].children[0].get_text();
    precedence(&last_op) <= precedence(&boundary_op)
}

enum Token {
    Value(i64),
    Op(String),
}

/// A fold that can't be done: divide/mod by zero, or a partial or final
/// result outside `i32`. Either way the island is left unfolded.
struct FoldError;

fn apply_fold_op(left: i64, op: &str, right: i64) -> Result<i64, FoldError> {
    let result = match op {
        "+" => left + right,
        "-" => left - right,
        "*" => left * right,
        "/" => {
            if right == 0 {
                return Err(FoldError);
            }
            let quotient = left.abs() / right.abs();
            if (left < 0) == (right < 0) {
                quotient
            } else {
                -quotient
            }
        }
        "%" => {
            if right == 0 {
                return Err(FoldError);
            }
            let remainder = left.abs() % right.abs();
            if left >= 0 {
                remainder
            } else {
                -remainder
            }
        }
        "&" => left & right,
        "|" => left | right,
        "^" => left ^ right,
        _ => unreachable!("non-foldable op reached apply_fold_op: {op}"),
    };
    if !(INT32_MIN..=INT32_MAX).contains(&result) {
        return Err(FoldError);
    }
    Ok(result)
}

/// `evaluate_island`, reduce a flat `[value, op, value, op, value, ...]` run
/// with a small shunting-yard, so a mixed-precedence island (e.g. `2 + 1 * 2`)
/// evaluates the same way the real expression would.
fn evaluate_island(tokens: &[Token]) -> Result<i64, FoldError> {
    let mut values: Vec<i64> = Vec::new();
    let mut pending: Vec<&str> = Vec::new();
    for token in tokens {
        match token {
            Token::Op(op) => {
                while let Some(top) = pending.last() {
                    if precedence(top) <= precedence(op) {
                        let top = pending.pop().unwrap();
                        let right = values.pop().unwrap();
                        let left = values.pop().unwrap();
                        values.push(apply_fold_op(left, top, right)?);
                    } else {
                        break;
                    }
                }
                pending.push(op);
            }
            Token::Value(v) => {
                if !(INT32_MIN..=INT32_MAX).contains(v) {
                    return Err(FoldError);
                }
                values.push(*v);
            }
        }
    }
    while let Some(op) = pending.pop() {
        let right = values.pop().unwrap();
        let left = values.pop().unwrap();
        values.push(apply_fold_op(left, op, right)?);
    }
    Ok(values[0])
}

/// `fold_expression`, scan every possible island start `k`, extend it while
/// the following operators are foldable and their operands are compile-time
/// constants, then fold the whole island in one shot if both boundaries are
/// safe. Replaces the folded span with a single `term -> constant ->
/// integerConstant` node.
fn fold_expression(node: &mut Node, piece_map: &HashMap<String, i64>) -> i64 {
    let mut count = 0;
    let mut k = 0usize;
    while k < node.children.len() {
        let term_value = if k == 0 {
            term_constant_value(&node.children[0], piece_map)
        } else {
            term_constant_value(&node.children[k].children[1], piece_map)
        };
        let Some(value) = term_value else {
            k += 1;
            continue;
        };
        if k + 1 >= node.children.len() || !island_starts_safe(&node.children, k) {
            k += 1;
            continue;
        }

        let mut tokens = vec![Token::Value(value)];
        let mut m = k;
        while m + 1 < node.children.len() {
            let op = node.children[m + 1].children[0].get_text();
            if !FOLDABLE_OPS.contains(&op.as_str()) {
                break;
            }
            let Some(right) = term_constant_value(&node.children[m + 1].children[1], piece_map)
            else {
                break;
            };
            tokens.push(Token::Op(op));
            tokens.push(Token::Value(right));
            m += 1;
        }

        if m == k || !island_ends_safe(&node.children, m) {
            k = if m > k { m + 1 } else { k + 1 };
            continue;
        }

        match evaluate_island(&tokens) {
            Ok(result) => {
                let mut constant = Node::new("constant");
                let mut leaf = Node::new("integerConstant");
                leaf.text = Some(result.to_string());
                constant.children.push(leaf);
                let mut new_term = Node::new("term");
                new_term.children.push(constant);

                if k == 0 {
                    node.children.splice(0..=m, [new_term]);
                } else {
                    node.children[k].children[1] = new_term;
                    node.children.drain(k + 1..=m);
                }
                count += 1;
                k += 1;
            }
            Err(FoldError) => {
                // Matches the reference: leave the runtime opcodes in place
                // rather than folding a divide-by-zero or an
                // out-of-i32-range result.
                k = m + 1;
            }
        }
    }
    count
}
