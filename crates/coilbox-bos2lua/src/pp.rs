//! The preprocessor.
//!
//! It does what the compiler's does, `#include`, `#define`, `#undef` and the
//! conditionals, plus `#if` and `#elif`, which Total Annihilation's own headers
//! use. The difference is what happens to a `#define`. A name standing for a
//! number, such as `#define SIG_AIM 2`, is kept as a name so the Lua can declare
//! it once and read the same way the BOS did. Anything else, such as
//! `#define ANIM_VARIABLE Moving`, is pasted in where it is used, because that
//! is the only thing it can mean. So is a macro with arguments, such as THIS's
//! `#define TRAIL(p,width,ttl,rate)`, with each use's arguments put in place
//! of its parameters.
//!
//! A name defined twice with different values cannot be one Lua local, so every
//! use of it is pasted in instead. Knowing that takes a first pass over the
//! whole script before the real one.

use crate::lex::{lex, Kind, Token};
use crate::Precedence;
use std::collections::{HashMap, HashSet};

/// Finds an included file: `(name as written, the including file's name)` to
/// `(the found file's name, its text)`.
pub type Resolver<'a> = dyn Fn(&str, &str) -> Option<(String, String)> + 'a;

/// A `#define` the Lua declares by name.
#[derive(Clone, Debug)]
pub struct Constant {
    pub body: Vec<Token>,
    /// In the BOS's own units, which is what every use of it means.
    pub value: i64,
}

pub struct Output {
    pub tokens: Vec<Token>,
    /// Every `#define` that became a named constant, used or not.
    pub constants: HashMap<String, Constant>,
    /// The ones something actually used.
    pub used: HashSet<String>,
    pub warnings: Vec<String>,
    /// The name of each file a token's `file` index stands for.
    pub files: Vec<String>,
    /// The includes that could not be found, as the script names them.
    pub missing: Vec<String>,
}

const MAX_INCLUDE_DEPTH: usize = 16;
const MAX_EXPANSION_DEPTH: usize = 32;

/// What the compiler's preprocessor defines before the script starts.
const BUILTINS: [(&str, &str); 3] = [("TRUE", "1"), ("FALSE", "0"), ("UNKNOWN_UNIT_VALUE", "")];

pub fn preprocess(
    source: &str,
    name: &str,
    resolve: &Resolver,
    linear: i64,
    precedence: Precedence,
) -> Output {
    let mut first = Pre::new(resolve, None, linear, precedence);
    first.run(source, name, 0);
    let stable = first
        .bodies
        .into_iter()
        .filter(|(_, bodies)| bodies.len() == 1)
        .map(|(name, _)| name)
        .collect();

    let mut second = Pre::new(resolve, Some(stable), linear, precedence);
    second.run(source, name, 0);
    Output {
        tokens: second.out,
        constants: second.constants,
        used: second.used,
        warnings: second.warnings,
        files: second.files,
        missing: second.missing,
    }
}

struct Macro {
    body: Vec<Token>,
    /// The parameter names of a macro with arguments, `None` for one without.
    params: Option<Vec<String>>,
    builtin: bool,
}

struct Cond {
    parent: bool,
    taking: bool,
    done: bool,
}

struct Pre<'r, 'a> {
    resolve: &'r Resolver<'a>,
    /// `None` on the first pass, which pastes everything in.
    stable: Option<HashSet<String>>,
    /// What `[1]` is in 65536ths of an elmo.
    linear: i64,
    precedence: Precedence,
    defs: HashMap<String, Macro>,
    bodies: HashMap<String, HashSet<String>>,
    conds: Vec<Cond>,
    out: Vec<Token>,
    files: Vec<String>,
    constants: HashMap<String, Constant>,
    used: HashSet<String>,
    warnings: Vec<String>,
    missing: Vec<String>,
}

impl<'r, 'a> Pre<'r, 'a> {
    fn new(
        resolve: &'r Resolver<'a>,
        stable: Option<HashSet<String>>,
        linear: i64,
        precedence: Precedence,
    ) -> Self {
        let defs = BUILTINS
            .iter()
            .map(|(name, body)| {
                (
                    name.to_string(),
                    Macro {
                        body: lex(body, 0),
                        params: None,
                        builtin: true,
                    },
                )
            })
            .collect();
        Pre {
            resolve,
            stable,
            linear,
            precedence,
            defs,
            bodies: HashMap::new(),
            conds: Vec::new(),
            out: Vec::new(),
            files: Vec::new(),
            constants: HashMap::new(),
            used: HashSet::new(),
            warnings: Vec::new(),
            missing: Vec::new(),
        }
    }

    fn active(&self) -> bool {
        self.conds.last().is_none_or(|c| c.parent && c.taking)
    }

    fn run(&mut self, source: &str, name: &str, depth: usize) {
        let file = self.files.len();
        self.files.push(name.to_string());
        let open = self.conds.len();
        let tokens = lex(source, file);
        let mut i = 0;
        while i < tokens.len() {
            let token = tokens[i].clone();
            i += 1;
            match token.kind {
                Kind::Directive => self.directive(&token, name, depth),
                _ if !self.active() => {}
                Kind::Ident => i += self.expand(token, &tokens[i..], &mut Vec::new()),
                _ => self.out.push(token),
            }
        }
        if self.conds.len() > open {
            self.warnings
                .push(format!("{name} leaves an #if open at its end."));
            self.conds.truncate(open);
        }
    }

    fn directive(&mut self, token: &Token, file_name: &str, depth: usize) {
        let words = lex(&token.text, token.file);
        let Some(head) = words.first() else { return };
        let what = head.text.to_ascii_lowercase();
        let rest = &words[1..];
        match what.as_str() {
            "ifdef" | "ifndef" | "if" => {
                let parent = self.active();
                let taking = parent
                    && match what.as_str() {
                        "ifdef" => rest
                            .first()
                            .is_some_and(|t| self.defs.contains_key(&t.text)),
                        "ifndef" => !rest
                            .first()
                            .is_some_and(|t| self.defs.contains_key(&t.text)),
                        _ => self.condition(rest, file_name, token.line),
                    };
                self.conds.push(Cond {
                    parent,
                    taking,
                    done: taking,
                });
            }
            "elif" => {
                let decided = match self.conds.last() {
                    Some(c) => c.parent && !c.done,
                    None => false,
                };
                let taking = decided && self.condition(rest, file_name, token.line);
                if let Some(c) = self.conds.last_mut() {
                    c.taking = taking;
                    c.done |= taking;
                }
            }
            "else" => {
                if let Some(c) = self.conds.last_mut() {
                    c.taking = c.parent && !c.done;
                    c.done = true;
                }
            }
            "endif" => {
                if self.conds.pop().is_none() {
                    self.warnings.push(format!(
                        "{file_name} line {}: #endif with no #if.",
                        token.line
                    ));
                }
            }
            _ if !self.active() => {}
            "define" => self.define(token, rest, file_name),
            "undef" => {
                if let Some(t) = rest.first() {
                    self.defs.remove(&t.text);
                }
            }
            "include" => self.include(token, rest, file_name, depth),
            other => self.warnings.push(format!(
                "{file_name} line {}: #{other} means nothing to the converter and was skipped.",
                token.line
            )),
        }
    }

    fn define(&mut self, token: &Token, rest: &[Token], file_name: &str) {
        let Some(name) = rest.first() else { return };
        if name.kind != Kind::Ident {
            return;
        }
        // Looked for after the word `define`, which a name such as `fine` is in.
        let from = token.text.find(char::is_whitespace).unwrap_or(0);
        let after_name = token.text[from..]
            .find(&name.text)
            .and_then(|at| token.text[from + at + name.text.len()..].chars().next());
        // As in C, a parenthesis straight after the name, with no space, starts
        // the parameters. With a space it is the start of the body.
        let (params, body_at) = if after_name == Some('(') {
            match parameters(&rest[1..]) {
                Some((params, read)) => (Some(params), 1 + read),
                None => {
                    self.warnings.push(format!(
                        "{file_name} line {}: could not read the arguments {} takes, so it was skipped.",
                        token.line, name.text
                    ));
                    return;
                }
            }
        } else {
            (None, 1)
        };
        let body: Vec<Token> = rest[body_at..]
            .iter()
            .map(|t| Token {
                line: token.line,
                ..t.clone()
            })
            .collect();
        let mut text = body
            .iter()
            .map(|t| t.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if let Some(params) = &params {
            text = format!("({}) {text}", params.join(","));
        }
        self.bodies
            .entry(name.text.clone())
            .or_default()
            .insert(text);
        self.defs.insert(
            name.text.clone(),
            Macro {
                body,
                params,
                builtin: false,
            },
        );
        if let Some(value) = self.constant(&name.text, &mut Vec::new()) {
            let body = self.defs[&name.text].body.clone();
            self.constants
                .entry(name.text.clone())
                .or_insert(Constant { body, value });
        }
        self.out.push(Token {
            kind: Kind::Define,
            text: name.text.clone(),
            line: token.line,
            file: token.file,
        });
    }

    fn include(&mut self, token: &Token, rest: &[Token], file_name: &str, depth: usize) {
        let wanted = match rest.first() {
            Some(t) if t.kind == Kind::Str => t.text.clone(),
            Some(t) if t.is_sym("<") => rest[1..]
                .iter()
                .take_while(|t| !t.is_sym(">"))
                .map(|t| t.text.as_str())
                .collect(),
            _ => {
                self.warnings.push(format!(
                    "{file_name} line {}: #include names no file.",
                    token.line
                ));
                return;
            }
        };
        if depth >= MAX_INCLUDE_DEPTH {
            self.warnings.push(format!(
                "{file_name} line {}: includes nest deeper than {MAX_INCLUDE_DEPTH}, so {wanted} was not read.",
                token.line
            ));
            return;
        }
        let Some((found, text)) = (self.resolve)(&wanted, file_name) else {
            self.warnings.push(format!(
                "{file_name} line {}: could not find {wanted}, so anything it defines is missing.",
                token.line
            ));
            self.missing.push(wanted);
            return;
        };
        // The marks carry the included file's index rather than the
        // includer's, so whoever reads them knows which file they bracket.
        let target = self.files.len();
        let mark = |kind| Token {
            kind,
            text: wanted.clone(),
            line: token.line,
            file: target,
        };
        self.out.push(mark(Kind::IncludeStart));
        self.run(&text, &found, depth + 1);
        self.out.push(mark(Kind::IncludeEnd));
    }

    /// Paste in a macro, or keep it as a name if it is a constant.
    ///
    /// `after` is what follows the name, which is where a macro with arguments
    /// finds them. Returns how many of those tokens it read.
    fn expand(&mut self, token: Token, after: &[Token], stack: &mut Vec<String>) -> usize {
        let Some(m) = self.defs.get(&token.text) else {
            self.out.push(token);
            return 0;
        };
        if stack.contains(&token.text) || stack.len() > MAX_EXPANSION_DEPTH {
            self.out.push(token);
            return 0;
        }
        // A constant inside `[ ]` or `< >` is pasted, since only a number may
        // stand there, as it does once the compiler's preprocessor has run.
        if !m.builtin
            && !self.in_brackets()
            && self.constant(&token.text, &mut Vec::new()).is_some()
        {
            self.mark_used(&token.text);
            self.out.push(Token {
                kind: Kind::Const,
                ..token
            });
            return 0;
        }
        let (body, read) = match m.params.clone() {
            None => (m.body.clone(), 0),
            // As in C, the name alone, with no arguments after it, is just a name.
            Some(params) => {
                let Some((mut args, read)) = arguments(after) else {
                    self.out.push(token);
                    return 0;
                };
                // `F()` is one empty argument, or none for a macro taking none.
                if params.is_empty() && args.len() == 1 && args[0].is_empty() {
                    args.clear();
                }
                if args.len() != params.len() {
                    self.warnings.push(format!(
                        "{} line {}: {} takes {} arguments and was given {}, so it was left as written.",
                        self.files[token.file],
                        token.line,
                        token.text,
                        params.len(),
                        args.len()
                    ));
                    self.out.push(token);
                    return 0;
                }
                (substitute(&m.body, &params, &args), read)
            }
        };
        let body: Vec<Token> = body
            .into_iter()
            .map(|t| Token {
                line: token.line,
                file: token.file,
                ..t
            })
            .collect();
        stack.push(token.text.clone());
        let mut i = 0;
        while i < body.len() {
            let t = body[i].clone();
            i += 1;
            if t.kind == Kind::Ident {
                i += self.expand(t, &body[i..], stack);
            } else {
                self.out.push(t);
            }
        }
        stack.pop();
        read
    }

    /// Whether the next token lands inside a `[x]` or `<x>` constant, after
    /// its opening bracket and any minus sign.
    fn in_brackets(&self) -> bool {
        let mut code = self.out.iter().rev().filter(|t| !t.is_comment());
        match code.next() {
            Some(t) if t.is_sym("[") || t.is_sym("<") => true,
            Some(t) if t.is_sym("-") => code.next().is_some_and(|t| t.is_sym("[") || t.is_sym("<")),
            _ => false,
        }
    }

    fn mark_used(&mut self, name: &str) {
        if !self.used.insert(name.to_string()) {
            return;
        }
        let inner: Vec<String> = self.defs[name]
            .body
            .iter()
            .filter(|t| t.kind == Kind::Ident && self.defs.get(&t.text).is_some_and(|m| !m.builtin))
            .map(|t| t.text.clone())
            .collect();
        for name in inner {
            self.mark_used(&name);
        }
    }

    /// The value of a macro the Lua can keep as a named constant, if it is one:
    /// defined once, one term, and made only of numbers and other such
    /// constants. A body of more than one term, such as `1+2`, is pasted,
    /// because pasted beside a `*` it is not the value it adds up to.
    fn constant(&self, name: &str, seen: &mut Vec<String>) -> Option<i64> {
        let stable = self.stable.as_ref()?;
        if !stable.contains(name) || seen.iter().any(|s| s == name) {
            return None;
        }
        let m = self.defs.get(name)?;
        if m.builtin || m.params.is_some() || !one_term(&m.body) {
            return None;
        }
        seen.push(name.to_string());
        let value = Eval {
            tokens: &m.body,
            at: 0,
            ident: &mut |n: &str| {
                let builtin = self.defs.get(n).filter(|m| m.builtin);
                match builtin {
                    Some(m) => m.body.first().and_then(|t| t.text.parse().ok()),
                    None => self.constant(n, seen),
                }
            },
            brackets: Some(self.linear),
            precedence: self.precedence,
        }
        .all();
        value
    }

    /// An `#if` condition. Names are pasted in fully, a name nothing defines is
    /// 0, and `defined(X)` asks whether X is defined, as in C.
    fn condition(&mut self, tokens: &[Token], file_name: &str, line: u32) -> bool {
        let mut flat = Vec::new();
        let mut i = 0;
        while i < tokens.len() {
            let t = &tokens[i];
            if t.is_word("defined") {
                let paren = tokens.get(i + 1).is_some_and(|t| t.is_sym("("));
                let name_at = if paren { i + 2 } else { i + 1 };
                let defined = tokens
                    .get(name_at)
                    .is_some_and(|t| self.defs.contains_key(&t.text));
                flat.push(number(if defined { "1" } else { "0" }));
                i = name_at + if paren { 2 } else { 1 };
                continue;
            }
            if t.kind == Kind::Ident {
                self.paste(t, &mut flat, &mut Vec::new());
            } else {
                flat.push(t.clone());
            }
            i += 1;
        }
        let value = Eval {
            tokens: &flat,
            at: 0,
            ident: &mut |_| Some(0),
            brackets: None,
            // The preprocessor's own arithmetic, which is C's.
            precedence: Precedence::Modern,
        }
        .all();
        match value {
            Some(v) => v != 0,
            None => {
                self.warnings.push(format!(
                    "{file_name} line {line}: could not work out an #if, so it counts as false."
                ));
                false
            }
        }
    }

    fn paste(&self, token: &Token, out: &mut Vec<Token>, stack: &mut Vec<String>) {
        match self.defs.get(&token.text) {
            Some(m) if m.params.is_none() && !stack.contains(&token.text) => {
                stack.push(token.text.clone());
                for t in &m.body {
                    if t.kind == Kind::Ident {
                        self.paste(t, out, stack);
                    } else {
                        out.push(t.clone());
                    }
                }
                stack.pop();
            }
            _ => out.push(token.clone()),
        }
    }
}

/// The names between the parentheses of `#define NAME(a, b)`, starting at the
/// opening one, and how many tokens that took.
fn parameters(tokens: &[Token]) -> Option<(Vec<String>, usize)> {
    if !tokens.first()?.is_sym("(") {
        return None;
    }
    if tokens.get(1)?.is_sym(")") {
        return Some((Vec::new(), 2));
    }
    let mut params = Vec::new();
    let mut i = 1;
    loop {
        let name = tokens.get(i).filter(|t| t.kind == Kind::Ident)?;
        params.push(name.text.clone());
        let next = tokens.get(i + 1)?;
        i += 2;
        if next.is_sym(")") {
            return Some((params, i));
        }
        if !next.is_sym(",") {
            return None;
        }
    }
}

/// The arguments of a use of a macro with arguments: the tokens between the
/// parentheses that follow its name, split at the commas outside any inner
/// parentheses, and how many tokens that took. `None` when no parenthesis
/// follows, or one is never closed. Comments among them are dropped.
fn arguments(tokens: &[Token]) -> Option<(Vec<Vec<Token>>, usize)> {
    let mut i = 0;
    while tokens.get(i)?.is_comment() {
        i += 1;
    }
    if !tokens[i].is_sym("(") {
        return None;
    }
    i += 1;
    let mut args = vec![Vec::new()];
    let mut depth = 0;
    loop {
        let t = tokens.get(i)?;
        i += 1;
        match t.kind {
            Kind::Directive => return None,
            Kind::Comment { .. } => continue,
            _ => {}
        }
        if t.is_sym(")") && depth == 0 {
            return Some((args, i));
        }
        if t.is_sym(",") && depth == 0 {
            args.push(Vec::new());
            continue;
        }
        if t.is_sym("(") {
            depth += 1;
        } else if t.is_sym(")") {
            depth -= 1;
        }
        args.last_mut()?.push(t.clone());
    }
}

/// A macro's body with each parameter replaced by its argument.
fn substitute(body: &[Token], params: &[String], args: &[Vec<Token>]) -> Vec<Token> {
    body.iter()
        .flat_map(|t| {
            let at = (t.kind == Kind::Ident)
                .then(|| params.iter().position(|p| *p == t.text))
                .flatten();
            match at {
                Some(at) => args[at].clone(),
                None => vec![t.clone()],
            }
        })
        .collect()
}

/// Whether a macro body is one term: a number, a name, a `[x]` or `<x>`
/// constant, or something in parentheses, any of them after a minus sign.
fn one_term(body: &[Token]) -> bool {
    let code: Vec<&Token> = body.iter().filter(|t| !t.is_comment()).collect();
    let code = match code.split_first() {
        Some((first, rest)) if first.is_sym("-") => rest,
        _ => &code[..],
    };
    match code {
        [t] => matches!(t.kind, Kind::Number | Kind::Ident),
        [open, .., close] if open.is_sym("[") => close.is_sym("]") && code.len() <= 4,
        [open, .., close] if open.is_sym("<") => close.is_sym(">") && code.len() <= 4,
        [open, inner @ .., close] if open.is_sym("(") && close.is_sym(")") => {
            let mut depth = 0i32;
            inner.iter().all(|t| {
                if t.is_sym("(") {
                    depth += 1;
                } else if t.is_sym(")") {
                    depth -= 1;
                }
                depth >= 0
            })
        }
        _ => false,
    }
}

fn number(text: &str) -> Token {
    Token {
        kind: Kind::Number,
        text: text.to_string(),
        line: 0,
        file: 0,
    }
}

/// Arithmetic over tokens, with the compiler's precedence. Used for `#if` and
/// for deciding whether a `#define` is a number.
pub struct Eval<'t, 'f> {
    pub tokens: &'t [Token],
    pub at: usize,
    /// The value of a bare name, if it has one.
    pub ident: &'f mut dyn FnMut(&str) -> Option<i64>,
    /// Whether `<x>` and `[x]` are the BOS angle and distance constants, and
    /// if so what `[1]` is.
    pub brackets: Option<i64>,
    pub precedence: Precedence,
}

/// Binding power by operator. Higher binds tighter, and operators that bind
/// the same are read left to right.
///
/// [`Precedence::Modern`] is the compiler's table (compiler.rs `precedence`),
/// turned upside down. [`Precedence::Scriptor`] is the five levels of
/// Scriptor's `Compiler.cfg`: `*` and `/`, then `+` and `-`, then every
/// comparison, then `&` and `|`, then `&&` and `||`. It has no `%`, `^` or
/// `^^`, which sit with their nearest neighbours.
pub fn binding(op: &str, precedence: Precedence) -> Option<u8> {
    let op = op.to_ascii_lowercase();
    if precedence == Precedence::Scriptor {
        return Some(match op.as_str() {
            "*" | "/" | "%" => 10,
            "+" | "-" => 9,
            "<" | ">" | "<=" | ">=" | "==" | "!=" => 8,
            "&" | "^" | "|" => 6,
            "&&" | "and" | "||" | "or" | "^^" | "xor" => 3,
            _ => return None,
        });
    }
    Some(match op.as_str() {
        "*" | "/" | "%" => 10,
        "+" | "-" => 9,
        "<" | ">" | "<=" | ">=" => 8,
        "==" | "!=" => 7,
        "&" => 6,
        "^" => 5,
        "|" => 4,
        "&&" | "and" => 3,
        "||" | "or" => 2,
        "^^" | "xor" => 1,
        _ => return None,
    })
}

impl Eval<'_, '_> {
    fn all(mut self) -> Option<i64> {
        let v = self.expr(0)?;
        (self.at == self.tokens.len()).then_some(v)
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn expr(&mut self, min: u8) -> Option<i64> {
        let mut left = self.term()?;
        while let Some(t) = self.peek() {
            let Some(power) = (matches!(t.kind, Kind::Sym | Kind::Ident))
                .then(|| binding(&t.text, self.precedence))
                .flatten()
            else {
                break;
            };
            if power <= min {
                break;
            }
            let op = t.text.to_ascii_lowercase();
            self.at += 1;
            let right = self.expr(power)?;
            left = apply(&op, left, right)?;
        }
        Some(left)
    }

    fn term(&mut self) -> Option<i64> {
        let t = self.peek()?.clone();
        self.at += 1;
        match t.kind {
            Kind::Number => parse_number(&t.text).map(round_constant),
            Kind::Ident | Kind::Const if t.is_word("not") => Some((self.term()? == 0) as i64),
            Kind::Ident | Kind::Const => (self.ident)(&t.text),
            Kind::Sym => match t.text.as_str() {
                "(" => {
                    let v = self.expr(0)?;
                    self.peek()?.is_sym(")").then_some(())?;
                    self.at += 1;
                    Some(v)
                }
                "-" => Some(-self.term()?),
                "!" => Some((self.term()? == 0) as i64),
                "<" | "[" if self.brackets.is_some() => {
                    let close = if t.text == "<" { ">" } else { "]" };
                    let negative = self.peek()?.is_sym("-");
                    if negative {
                        self.at += 1;
                    }
                    let n = parse_number(&self.peek()?.text)?;
                    self.at += 1;
                    self.peek()?.is_sym(close).then_some(())?;
                    self.at += 1;
                    let n = if negative { -n } else { n };
                    Some(scale_constant(
                        close == ">",
                        n,
                        self.brackets.unwrap_or(65536),
                    ))
                }
                _ => None,
            },
            _ => None,
        }
    }
}

/// A plain number in BOS is rounded to a whole one, ties to even, as the
/// compiler rounds it.
pub fn round_constant(v: f64) -> i64 {
    v.round_ties_even() as i64
}

/// `<x>` and `[x]` in the BOS's own units, truncated as the compiler truncates.
/// `linear` is what `[1]` is, which depends on the compiler: see
/// [`crate::linear_scale`].
pub fn scale_constant(angle: bool, v: f64, linear: i64) -> i64 {
    let scale = if angle { 182.0 } else { linear as f64 };
    (v * scale) as i64
}

pub fn parse_number(text: &str) -> Option<f64> {
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        return i64::from_str_radix(hex, 16).ok().map(|v| v as f64);
    }
    text.parse().ok()
}

/// One BOS operator over whole numbers, as the engine's COB interpreter does
/// it: division and remainder truncate, and the logical operators give 0 or 1.
pub fn apply(op: &str, a: i64, b: i64) -> Option<i64> {
    let bool = |v: bool| v as i64;
    Some(match op {
        "+" => a.wrapping_add(b),
        "-" => a.wrapping_sub(b),
        "*" => a.wrapping_mul(b),
        "/" => a.checked_div(b)?,
        "%" => a.checked_rem(b)?,
        "&" => a & b,
        "|" => a | b,
        "^" => a ^ b,
        "<" => bool(a < b),
        ">" => bool(a > b),
        "<=" => bool(a <= b),
        ">=" => bool(a >= b),
        "==" => bool(a == b),
        "!=" => bool(a != b),
        "&&" | "and" => bool(a != 0 && b != 0),
        "||" | "or" => bool(a != 0 || b != 0),
        "^^" | "xor" => bool((a != 0) != (b != 0)),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(src: &str, files: &[(&str, &str)]) -> Output {
        let files: HashMap<String, String> = files
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        preprocess(
            src,
            "main.bos",
            &|name, _| files.get(name).map(|text| (name.to_string(), text.clone())),
            65536,
            Precedence::Modern,
        )
    }

    fn code(out: &Output) -> Vec<String> {
        out.tokens
            .iter()
            .filter(|t| matches!(t.kind, Kind::Ident | Kind::Number | Kind::Sym | Kind::Const))
            .map(|t| t.text.clone())
            .collect()
    }

    #[test]
    fn keeps_number_defines_as_names_and_pastes_the_rest() {
        let out = run(
            "#define SIG_AIM 2\n#define ANIM_VARIABLE Moving\nsignal SIG_AIM; x = ANIM_VARIABLE;",
            &[],
        );
        assert_eq!(
            code(&out),
            ["signal", "SIG_AIM", ";", "x", "=", "Moving", ";"]
        );
        assert_eq!(out.constants["SIG_AIM"].value, 2);
        assert!(out.used.contains("SIG_AIM"));
        assert!(!out.constants.contains_key("ANIM_VARIABLE"));
    }

    #[test]
    fn a_name_defined_two_ways_is_pasted_every_time() {
        let out = run(
            "#define SPEED 1\na = SPEED;\n#undef SPEED\n#define SPEED 2\nb = SPEED;",
            &[],
        );
        assert_eq!(code(&out), ["a", "=", "1", ";", "b", "=", "2", ";"]);
    }

    #[test]
    fn reads_includes_and_marks_where_they_start_and_end() {
        let out = run(
            "#include \"exptype.h\"\nexplode base type SHATTER | BITMAP1;",
            &[(
                "exptype.h",
                "#define SHATTER 1 // flies apart\n#define BITMAP1 256\n",
            )],
        );
        assert_eq!(out.tokens[0].kind, Kind::IncludeStart);
        assert_eq!(out.constants["BITMAP1"].value, 256);
        assert_eq!(
            code(&out),
            ["explode", "base", "type", "SHATTER", "|", "BITMAP1", ";"]
        );
    }

    #[test]
    fn evaluates_if_and_elif_like_ta_s_headers() {
        let out = run(
            "#define NUM 3\n#if NUM > 1\na;\n#if NUM >= 4\nb;\n#elif defined(NUM)\nc;\n#endif\n#else\nd;\n#endif",
            &[],
        );
        assert_eq!(code(&out), ["a", ";", "c", ";"]);
    }

    #[test]
    fn angle_and_distance_defines_are_in_bos_units() {
        let out = run(
            "#define TURN <90>\n#define STEP [1.5]\nx = TURN + STEP;",
            &[],
        );
        assert_eq!(out.constants["TURN"].value, 16380);
        assert_eq!(out.constants["STEP"].value, 98304);
    }

    #[test]
    fn a_missing_include_is_a_warning_not_a_failure() {
        let out = run("#include \"nowhere.h\"\npiece p;", &[]);
        assert!(out.warnings[0].contains("nowhere.h"), "{:?}", out.warnings);
        assert_eq!(code(&out), ["piece", "p", ";"]);
    }

    #[test]
    fn a_macro_with_arguments_pastes_them_in() {
        let out = run(
            "#define TRAIL(p,rate) call-script add(p,rate);\nTRAIL(base, get PIECE_XZ(1, 2) + 3)",
            &[],
        );
        assert_eq!(
            code(&out),
            [
                "call", "-", "script", "add", "(", "base", ",", "get", "PIECE_XZ", "(", "1", ",",
                "2", ")", "+", "3", ")", ";"
            ]
        );
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    }

    #[test]
    fn a_macro_with_arguments_named_without_them_is_left_alone() {
        let out = run("#define F(a) a\nx = F;", &[]);
        assert_eq!(code(&out), ["x", "=", "F", ";"]);
    }

    #[test]
    fn arguments_and_bodies_can_use_other_macros() {
        let out = run(
            "#define SIG 2\n#define A(x) x + 1\n#define B(y) signal A(y) * SIG;\nB(SIG)",
            &[],
        );
        assert_eq!(code(&out), ["signal", "SIG", "+", "1", "*", "SIG", ";"]);
        assert!(out.used.contains("SIG"));
    }

    #[test]
    fn a_macro_with_arguments_is_never_a_named_constant() {
        let out = run("#define TWICE(a) 2\nx = TWICE(1);", &[]);
        assert!(!out.constants.contains_key("TWICE"));
        assert_eq!(code(&out), ["x", "=", "2", ";"]);
    }
}
