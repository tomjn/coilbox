//! Builtin preprocessor, a port of `preprocess()` (bos2cob_py3.py L1317-1460
//! in the version this was first ported from). The reference has since dropped
//! `--nopcpp` and always runs the real C preprocessor, pcpp, so this module is
//! now the parity target for the reference's *default* mode where it comes to
//! macros and `#if`: `#define`/`#undef`/`#ifdef`/`#ifndef`/`#else`/`#endif`/
//! `#include`, object-like and function-like macro expansion, and `#if`/`#elif`
//! over integer constant expressions plus `defined(X)`/`defined X`.
//!
//! Macro expansion yields tokens directly, with no intermediate `(token, idx)`
//! tuples the way the Python reference's does. The observable result is the
//! same flattened stream.
//!
//! The tokenizer (`tokenizer::tokenize`) drops whitespace, so the token stream
//! alone cannot tell `#define NAME(a)` (function-like) apart from `#define
//! NAME (a)` (object-like, body `(a)`, as real scripts do write for a
//! parenthesised expression). `defines_as_function_like` below checks the raw
//! source text for that one decision instead.

use crate::tokenizer::tokenize;
use std::collections::HashMap;
use std::path::Path;

/// Recursion/expansion depth guard, shared by macro-body expansion and `#if`
/// macro expansion, so a self-referential define surfaces as an error instead
/// of a stack overflow.
const MAX_RECURSION: u32 = 10;

/// A `#define`d name: either object-like (its body, pre-joined the way the
/// original body-collection loop always has, ready to feed straight back
/// through `run`) or function-like (raw parameter names and body tokens,
/// substituted per call).
#[derive(Clone)]
enum Macro {
    Object(String),
    Function {
        params: Vec<String>,
        body: Vec<String>,
    },
}

/// One level of `#if`/`#ifdef`/`#ifndef` nesting.
struct Cond {
    /// Whether the enclosing scope is itself active, so a branch nested inside
    /// an already-skipped block never becomes active no matter what its own
    /// condition says.
    parent_active: bool,
    /// Whether THIS branch's content should be emitted.
    taking: bool,
    /// Whether some branch of this `#if`/`#elif`/`#else` chain has already
    /// been taken, so a later `#elif`/`#else` cannot also take.
    done: bool,
}

/// Preprocess raw BOS source into the flattened token stream the parser consumes.
/// `include_dir` is the directory used to resolve `#include` targets that aren't
/// found relative to the process working directory (mirrors the reference).
pub fn preprocess(code: &str, include_dir: &Path) -> Result<Vec<String>, String> {
    let mut defs: HashMap<String, Macro> = HashMap::new();
    defs.insert("TRUE".to_string(), Macro::Object("1".to_string()));
    defs.insert("FALSE".to_string(), Macro::Object("0".to_string()));
    defs.insert(
        "UNKNOWN_UNIT_VALUE".to_string(),
        Macro::Object(String::new()),
    );
    let mut out = Vec::new();
    run(code, include_dir, &mut defs, 0, &mut out)?;
    Ok(out)
}

fn active(conds: &[Cond]) -> bool {
    conds.last().is_none_or(|c| c.parent_active && c.taking)
}

fn run(
    code: &str,
    include_dir: &Path,
    defs: &mut HashMap<String, Macro>,
    recursion: u32,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if recursion > MAX_RECURSION {
        return Err("preprocessor recursion limit reached".to_string());
    }

    let toks = tokenize(code);
    let mut i = 0usize;
    // Consume and return the next token, or None at end of stream.
    macro_rules! next {
        () => {{
            let t = toks.get(i).cloned();
            if t.is_some() {
                i += 1;
            }
            t
        }};
    }

    let mut is_directive = false;
    let mut conds: Vec<Cond> = Vec::new();

    while let Some(token) = next!() {
        if token == "#" {
            is_directive = true;
            continue;
        }
        if token == "$" {
            continue;
        }

        if !is_directive {
            if !active(&conds) {
                continue;
            }
            match defs.get(&token).cloned() {
                Some(Macro::Object(body)) => run(&body, include_dir, defs, recursion + 1, out)?,
                Some(Macro::Function { params, body }) => {
                    if toks.get(i).map(String::as_str) == Some("(") {
                        i += 1;
                        let args = read_call_arguments(&toks, &mut i)?;
                        let args = normalise_empty_call(&params, args);
                        if args.len() != params.len() {
                            return Err(format!(
                                "preprocessor: {token} takes {} arguments and was given {}",
                                params.len(),
                                args.len()
                            ));
                        }
                        let substituted = substitute_body(&body, &params, &args);
                        run(&substituted, include_dir, defs, recursion + 1, out)?;
                    } else {
                        // As in C, a function-like macro's bare name, with no
                        // call following it, is just a name.
                        out.push(token);
                    }
                }
                None => out.push(token),
            }
            continue;
        }

        is_directive = false;
        let directive = token.to_lowercase();
        match directive.as_str() {
            "include" => {
                if !active(&conds) {
                    continue;
                }
                let included = next!()
                    .ok_or("preprocessor: #include missing filename")?
                    .trim_matches('"')
                    .to_string();
                let candidate = Path::new(&included);
                let path = if candidate.exists() {
                    candidate.to_path_buf()
                } else {
                    let alt = include_dir.join(&included);
                    if alt.exists() {
                        alt
                    } else {
                        return Err(format!("preprocessor: can't find include {included}"));
                    }
                };
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("preprocessor: couldn't read include {included}: {e}"))?;
                run(&content, include_dir, defs, recursion + 1, out)?;
            }
            "define" => {
                if !active(&conds) {
                    continue;
                }
                let name = next!().ok_or("preprocessor: #define missing name")?;
                // A `(` immediately after the name, with no whitespace between
                // them, makes this a function-like macro. The tokenizer has
                // already dropped that whitespace, so check the raw source
                // rather than the token that follows in `toks`.
                let params = if toks.get(i).map(String::as_str) == Some("(")
                    && defines_as_function_like(code, &name)
                {
                    i += 1;
                    Some(read_parameter_list(&toks, &mut i)?)
                } else {
                    None
                };
                let mut body_tokens = Vec::new();
                loop {
                    match next!() {
                        Some(t) if t == "$" => break,
                        Some(t) => body_tokens.push(t),
                        None => break,
                    }
                }
                match params {
                    None => {
                        let mut body = String::new();
                        for t in &body_tokens {
                            body.push(' ');
                            body.push_str(t);
                        }
                        defs.insert(name, Macro::Object(body));
                    }
                    Some(params) => {
                        defs.insert(
                            name,
                            Macro::Function {
                                params,
                                body: body_tokens,
                            },
                        );
                    }
                }
            }
            "undef" => {
                if !active(&conds) {
                    continue;
                }
                let name = next!().ok_or("preprocessor: #undef missing name")?;
                defs.remove(&name);
            }
            "ifdef" => {
                if !active(&conds) {
                    conds.push(Cond {
                        parent_active: false,
                        taking: false,
                        done: false,
                    });
                    continue;
                }
                let name = next!().ok_or("preprocessor: #ifdef missing name")?;
                let taking = defs.contains_key(&name);
                conds.push(Cond {
                    parent_active: true,
                    taking,
                    done: taking,
                });
            }
            "ifndef" => {
                if !active(&conds) {
                    conds.push(Cond {
                        parent_active: false,
                        taking: false,
                        done: false,
                    });
                    continue;
                }
                let name = next!().ok_or("preprocessor: #ifndef missing name")?;
                let taking = !defs.contains_key(&name);
                conds.push(Cond {
                    parent_active: true,
                    taking,
                    done: taking,
                });
            }
            "if" => {
                let parent = active(&conds);
                let cond_tokens = read_directive_line(&toks, &mut i);
                let taking = parent && eval_if(&cond_tokens, defs)?;
                conds.push(Cond {
                    parent_active: parent,
                    taking,
                    done: taking,
                });
            }
            "elif" => {
                let cond_tokens = read_directive_line(&toks, &mut i);
                let Some(c) = conds.last_mut() else {
                    return Err("preprocessor: #elif with no matching #if".to_string());
                };
                let decided = c.parent_active && !c.done;
                let taking = decided && eval_if(&cond_tokens, defs)?;
                c.taking = taking;
                c.done |= taking;
            }
            "else" => {
                if let Some(c) = conds.last_mut() {
                    c.taking = c.parent_active && !c.done;
                    c.done = true;
                }
            }
            "endif" => {
                if conds.pop().is_none() {
                    return Err("preprocessor: extraneous #endif".to_string());
                }
            }
            other => {
                return Err(format!("preprocessor: unhandled directive #{other}"));
            }
        }
    }

    if !conds.is_empty() {
        return Err("preprocessor: missing #endif".to_string());
    }
    Ok(())
}

/// Whether `code` writes `#define NAME(` with no space between the name and
/// the opening parenthesis, which is what makes a `#define` function-like in
/// C (and in pcpp). The tokenizer has already thrown the whitespace away by
/// the time `run` sees a token stream, so this checks the raw source text
/// instead: a direct scan for the literal `#define`, then for `NAME(`
/// immediately after any whitespace that follows it.
fn defines_as_function_like(code: &str, name: &str) -> bool {
    let needle = format!("{name}(");
    let mut from = 0usize;
    while let Some(rel) = code[from..].find("#define") {
        let after_keyword = from + rel + "#define".len();
        let rest = code[after_keyword..].trim_start();
        if rest.starts_with(&needle) {
            return true;
        }
        from = after_keyword;
    }
    false
}

/// Consume tokens up to (and including) the directive-ending `$` sentinel,
/// returning everything before it. Used for `#if`/`#elif`, whose condition can
/// run to any length, unlike the single-token name `#ifdef`/`#ifndef` read.
fn read_directive_line(toks: &[String], i: &mut usize) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(t) = toks.get(*i).cloned() {
        *i += 1;
        if t == "$" {
            break;
        }
        out.push(t);
    }
    out
}

/// The names between the parentheses of `#define NAME(a, b)`, having already
/// consumed the opening `(`. Returns the parameter names.
fn read_parameter_list(toks: &[String], i: &mut usize) -> Result<Vec<String>, String> {
    if toks.get(*i).map(String::as_str) == Some(")") {
        *i += 1;
        return Ok(Vec::new());
    }
    let mut params = Vec::new();
    loop {
        let name = toks
            .get(*i)
            .cloned()
            .ok_or("preprocessor: unterminated macro parameter list")?;
        *i += 1;
        params.push(name);
        match toks.get(*i).map(String::as_str) {
            Some(",") => {
                *i += 1;
            }
            Some(")") => {
                *i += 1;
                return Ok(params);
            }
            _ => return Err("preprocessor: malformed macro parameter list".to_string()),
        }
    }
}

/// The arguments of a macro call, having already consumed the name and the
/// opening `(`. Splits on top-level commas, where nested parens don't count.
/// `i` is left just past the closing `)`.
fn read_call_arguments(toks: &[String], i: &mut usize) -> Result<Vec<Vec<String>>, String> {
    let mut args: Vec<Vec<String>> = vec![Vec::new()];
    let mut depth = 0i32;
    loop {
        let t = toks
            .get(*i)
            .cloned()
            .ok_or("preprocessor: unterminated macro call")?;
        *i += 1;
        if t == "(" {
            depth += 1;
            args.last_mut().unwrap().push(t);
        } else if t == ")" {
            if depth == 0 {
                return Ok(args);
            }
            depth -= 1;
            args.last_mut().unwrap().push(t);
        } else if t == "," && depth == 0 {
            args.push(Vec::new());
        } else {
            args.last_mut().unwrap().push(t);
        }
    }
}

/// `F()` is a call with one empty argument, which for a zero-parameter macro
/// means no arguments at all, as in C.
fn normalise_empty_call(params: &[String], mut args: Vec<Vec<String>>) -> Vec<Vec<String>> {
    if params.is_empty() && args.len() == 1 && args[0].is_empty() {
        args.clear();
    }
    args
}

/// A function-like macro's body with each parameter replaced by its argument's
/// tokens, joined the same way an object-like body is (leading space per
/// token) so it can be fed straight back through `run`.
fn substitute_body(body: &[String], params: &[String], args: &[Vec<String>]) -> String {
    let mut out = String::new();
    for t in body {
        match params.iter().position(|p| p == t) {
            Some(pos) => {
                for a in &args[pos] {
                    out.push(' ');
                    out.push_str(a);
                }
            }
            None => {
                out.push(' ');
                out.push_str(t);
            }
        }
    }
    out
}

/// Evaluate an `#if`/`#elif` condition. Substitute `defined(...)`, macro-expand
/// what's left, reassemble the multi-char operators the tokenizer split apart,
/// then evaluate as a C integer constant expression.
fn eval_if(tokens: &[String], defs: &HashMap<String, Macro>) -> Result<bool, String> {
    let substituted = substitute_defined(tokens, defs);
    let expanded = expand_condition(&substituted, defs, 0)?;
    let combined = reassemble_operators(&expanded);
    if combined.is_empty() {
        return Err("preprocessor: empty #if expression".to_string());
    }
    Ok(CondEval::parse(&combined)? != 0)
}

/// Replace `defined(NAME)`/`defined NAME` with a literal `1`/`0`, before any
/// macro expansion touches the name being asked about.
fn substitute_defined(tokens: &[String], defs: &HashMap<String, Macro>) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        if tokens[i] == "defined" {
            let paren = tokens.get(i + 1).map(String::as_str) == Some("(");
            let name_at = if paren { i + 2 } else { i + 1 };
            if let Some(name) = tokens.get(name_at) {
                out.push(if defs.contains_key(name) { "1" } else { "0" }.to_string());
                i = name_at + if paren { 2 } else { 1 };
                continue;
            }
        }
        out.push(tokens[i].clone());
        i += 1;
    }
    out
}

/// Fully macro-expand a condition's tokens, after `defined(...)` has already
/// been resolved. A name nothing defines is `0`, matching the reference
/// preprocessor's `#if` semantics.
fn expand_condition(
    tokens: &[String],
    defs: &HashMap<String, Macro>,
    depth: u32,
) -> Result<Vec<String>, String> {
    if depth > MAX_RECURSION {
        return Err("preprocessor: #if macro expansion recursion limit reached".to_string());
    }
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        let t = &tokens[i];
        i += 1;
        match defs.get(t) {
            Some(Macro::Object(body)) => {
                let sub = tokenize(body);
                out.extend(expand_condition(&sub, defs, depth + 1)?);
            }
            Some(Macro::Function { params, body }) => {
                if tokens.get(i).map(String::as_str) == Some("(") {
                    i += 1;
                    let args = read_call_arguments(tokens, &mut i)?;
                    let args = normalise_empty_call(params, args);
                    if args.len() != params.len() {
                        return Err(format!(
                            "preprocessor: {t} takes {} arguments and was given {} in #if",
                            params.len(),
                            args.len()
                        ));
                    }
                    let mut substituted = Vec::new();
                    for bt in body {
                        match params.iter().position(|p| p == bt) {
                            Some(pos) => substituted.extend(args[pos].iter().cloned()),
                            None => substituted.push(bt.clone()),
                        }
                    }
                    out.extend(expand_condition(&substituted, defs, depth + 1)?);
                } else {
                    out.push("0".to_string());
                }
            }
            None => {
                let is_name = t
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
                out.push(if is_name { "0".to_string() } else { t.clone() });
            }
        }
    }
    Ok(out)
}

/// Recombine the adjacent single-char tokens the tokenizer split multi-char
/// operators into (mirrors the grammar's own `_op` rule, `grammar.rs`).
fn reassemble_operators(tokens: &[String]) -> Vec<String> {
    const PAIRS: &[(&str, &str, &str)] = &[
        ("=", "=", "=="),
        ("!", "=", "!="),
        ("<", "=", "<="),
        (">", "=", ">="),
        ("&", "&", "&&"),
        ("|", "|", "||"),
    ];
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < tokens.len() {
        if i + 1 < tokens.len() {
            if let Some(&(_, _, combined)) = PAIRS
                .iter()
                .find(|(a, b, _)| *a == tokens[i] && *b == tokens[i + 1])
            {
                out.push(combined.to_string());
                i += 2;
                continue;
            }
        }
        out.push(tokens[i].clone());
        i += 1;
    }
    out
}

/// Binding power for a `#if` operator. Higher binds tighter, matching C.
fn binding(op: &str) -> Option<u8> {
    Some(match op {
        "*" | "/" | "%" => 10,
        "+" | "-" => 9,
        "<" | ">" | "<=" | ">=" => 8,
        "==" | "!=" => 7,
        "&" => 6,
        "^" => 5,
        "|" => 4,
        "&&" => 3,
        "||" => 2,
        _ => return None,
    })
}

fn apply_op(op: &str, a: i64, b: i64) -> Result<i64, String> {
    Ok(match op {
        "+" => a.wrapping_add(b),
        "-" => a.wrapping_sub(b),
        "*" => a.wrapping_mul(b),
        "/" => a
            .checked_div(b)
            .ok_or("preprocessor: division by zero in #if")?,
        "%" => a
            .checked_rem(b)
            .ok_or("preprocessor: modulo by zero in #if")?,
        "&" => a & b,
        "|" => a | b,
        "^" => a ^ b,
        "<" => (a < b) as i64,
        ">" => (a > b) as i64,
        "<=" => (a <= b) as i64,
        ">=" => (a >= b) as i64,
        "==" => (a == b) as i64,
        "!=" => (a != b) as i64,
        "&&" => ((a != 0) && (b != 0)) as i64,
        "||" => ((a != 0) || (b != 0)) as i64,
        other => return Err(format!("preprocessor: unknown operator {other} in #if")),
    })
}

fn parse_int_token(t: &str) -> Option<i64> {
    if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
        i64::from_str_radix(hex, 16).ok()
    } else {
        t.parse().ok()
    }
}

/// A small precedence-climbing evaluator for a `#if` condition's tokens.
struct CondEval<'t> {
    toks: &'t [String],
    pos: usize,
}

impl<'t> CondEval<'t> {
    fn parse(tokens: &'t [String]) -> Result<i64, String> {
        let mut e = CondEval {
            toks: tokens,
            pos: 0,
        };
        let v = e.expr(0)?;
        if e.pos != e.toks.len() {
            return Err(format!(
                "preprocessor: malformed #if expression near {}",
                e.toks[e.pos]
            ));
        }
        Ok(v)
    }

    fn peek(&self) -> Option<&str> {
        self.toks.get(self.pos).map(String::as_str)
    }

    fn expr(&mut self, min: u8) -> Result<i64, String> {
        let mut left = self.term()?;
        while let Some(op) = self.peek() {
            let Some(power) = binding(op) else { break };
            if power <= min {
                break;
            }
            let op = op.to_string();
            self.pos += 1;
            let right = self.expr(power)?;
            left = apply_op(&op, left, right)?;
        }
        Ok(left)
    }

    fn term(&mut self) -> Result<i64, String> {
        let t = self
            .peek()
            .ok_or("preprocessor: unexpected end of #if expression")?
            .to_string();
        self.pos += 1;
        if t == "(" {
            let v = self.expr(0)?;
            if self.peek() != Some(")") {
                return Err("preprocessor: expected ) in #if expression".to_string());
            }
            self.pos += 1;
            return Ok(v);
        }
        if t == "!" {
            return Ok((self.term()? == 0) as i64);
        }
        if t == "-" {
            return Ok(-self.term()?);
        }
        parse_int_token(&t)
            .ok_or_else(|| format!("preprocessor: expected a number in #if, found {t}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn passes_through_plain_source_unchanged() {
        let src = include_str!("../tests/fixtures/min.bos");
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, crate::tokenizer::tokenize(src));
    }

    /// `#define`/`#ifdef`/`#ifndef`/`#else`, macro expansion, and the built-in
    /// `UNKNOWN_UNIT_VALUE` → empty removal. Golden from the Python reference.
    #[test]
    fn handles_defines_conditionals_and_macro_expansion() {
        let src = "#define A 1\n#define B\n#ifdef A\npiece kept_a;\n#endif\n#ifndef B\npiece dropped;\n#else\npiece kept_b;\n#endif\nfoo = A + UNKNOWN_UNIT_VALUE 2;\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        let expected = [
            "piece", "kept_a", ";", "piece", "kept_b", ";", "foo", "=", "1", "+", "2", ";",
        ];
        assert_eq!(toks, expected);
    }

    #[test]
    fn if_evaluates_integer_conditions_over_defines() {
        let src = "#define A 1\n#if A == 1\npiece kept;\n#else\npiece dropped;\n#endif\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, ["piece", "kept", ";"]);
    }

    #[test]
    fn elif_chain_picks_the_first_true_branch() {
        let src = "#define NUM 3\n#if NUM > 1\na;\n#if NUM >= 4\nb;\n#elif defined(NUM)\nc;\n#endif\n#else\nd;\n#endif";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, ["a", ";", "c", ";"]);
    }

    #[test]
    fn defined_checks_definedness_without_expanding() {
        let src =
            "#define A 1\n#if defined(A)\nfoo;\n#endif\n#if defined B\nbar;\n#else\nbaz;\n#endif\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, ["foo", ";", "baz", ";"]);
    }

    #[test]
    fn a_macro_with_arguments_pastes_them_in() {
        let src = "#define TRAIL(p,rate) call-script add(p,rate);\nTRAIL(base,1)\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(
            toks,
            ["call", "-", "script", "add", "(", "base", ",", "1", ")", ";"]
        );
    }

    #[test]
    fn a_macro_with_arguments_named_without_a_call_is_left_alone() {
        let src = "#define F(a) a\nx = F;\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, ["x", "=", "F", ";"]);
    }

    #[test]
    fn a_multiline_macro_expands_with_nested_and_parenthesised_arguments() {
        let src = "#define TRAIL(p,w) MoveRate0() {\\\ncall-script f(p, get GET_PIECE(p,w) + (1,2));\\\n}\nTRAIL(base,1)\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(
            toks,
            [
                "MoveRate0",
                "(",
                ")",
                "{",
                "call",
                "-",
                "script",
                "f",
                "(",
                "base",
                ",",
                "get",
                "GET_PIECE",
                "(",
                "base",
                ",",
                "1",
                ")",
                "+",
                "(",
                "1",
                ",",
                "2",
                ")",
                ")",
                ";",
                "}"
            ]
        );
    }

    #[test]
    fn if_directive_leaves_dead_branches_unevaluated() {
        // A malformed condition inside a branch that's never taken must not error.
        let src = "#ifdef NOPE\n#if this is not an expression\n#endif\n#endif\npiece p;\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, ["piece", "p", ";"]);
    }
}
