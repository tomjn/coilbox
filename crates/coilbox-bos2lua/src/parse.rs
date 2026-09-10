//! BOS into a tree, with each comment attached to the statement it sat beside.
//!
//! A hand-written descent parser rather than the compiler's grammar tables,
//! because the tables keep no comments and no line numbers. It accepts what the
//! compiler accepts, keywords in any case, plus the few things older scripts
//! compiled with Scriptor rely on: a statement left unterminated right before a
//! closing brace, a bare braced block, and `x++` alongside `++x`.

use crate::lex::{Kind, Token};

/// How deep blocks and expressions may nest. Real scripts nest a handful of
/// levels, and this stops a runaway from overflowing the stack.
const MAX_DEPTH: usize = 200;

#[derive(Clone, Debug, PartialEq)]
pub struct Comment {
    pub text: String,
    pub block: bool,
    /// The file it came from, so a header's comments can be left behind.
    pub file: usize,
}

#[derive(Debug)]
pub struct Item {
    pub kind: ItemKind,
    pub leading: Vec<Comment>,
    pub trailing: Option<Comment>,
    pub file: usize,
}

#[derive(Debug)]
pub enum ItemKind {
    Pieces(Vec<String>),
    Statics(Vec<String>),
    Func(Func),
    /// A `#define` of this name.
    Define(String),
    IncludeStart(String),
    IncludeEnd,
    /// Comments with nothing after them before the next item or the end.
    Comments,
}

#[derive(Debug)]
pub struct Func {
    pub name: String,
    pub params: Vec<String>,
    pub body: Vec<Stmt>,
    /// Comments after the last statement, before the closing brace.
    pub tail: Vec<Comment>,
}

#[derive(Debug)]
pub struct Stmt {
    pub kind: StmtKind,
    pub leading: Vec<Comment>,
    pub trailing: Option<Comment>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    X,
    Y,
    Z,
}

#[derive(Debug)]
pub enum StmtKind {
    Assign(String, Expr),
    Inc(String),
    Dec(String),
    If {
        cond: Expr,
        then: Vec<Stmt>,
        then_tail: Vec<Comment>,
        els: Option<(Vec<Stmt>, Vec<Comment>)>,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
        tail: Vec<Comment>,
    },
    Block(Vec<Stmt>, Vec<Comment>),
    Call(String, Vec<Expr>),
    Start(String, Vec<Expr>),
    Spin {
        piece: String,
        axis: Axis,
        speed: Expr,
        accel: Option<Expr>,
    },
    StopSpin {
        piece: String,
        axis: Axis,
        decel: Option<Expr>,
    },
    Turn {
        piece: String,
        axis: Axis,
        dest: Expr,
        speed: Option<Expr>,
    },
    Move {
        piece: String,
        axis: Axis,
        dest: Expr,
        speed: Option<Expr>,
    },
    WaitTurn(String, Axis),
    WaitMove(String, Axis),
    EmitSfx(Expr, String),
    Sleep(Expr),
    Hide(String),
    Show(String),
    Explode(String, Expr),
    Signal(Expr),
    SetSignalMask(Expr),
    Set(Expr, Expr),
    Get(Expr),
    AttachUnit(Expr, Expr),
    DropUnit(Expr),
    Return(Option<Expr>),
    PlaySound(String, Expr),
    Var(Vec<String>),
    /// `cache`, `dont-cache`, `dont-shade` and `dont-shadow`, which the engine
    /// ignores.
    Ignored,
    Define(String),
    Empty,
}

#[derive(Clone, Debug)]
pub enum Expr {
    /// A plain number, rounded as the compiler rounds it.
    Num(i64),
    /// `<x>`: the degrees as written, and the value in 65536ths of a turn.
    Angle(f64, i64),
    /// `[x]`: the elmos as written, and the value in 65536ths of an elmo.
    Linear(f64, i64),
    Name(String),
    /// A `#define` kept by name.
    Const(String),
    Get(Box<Expr>, Vec<Expr>),
    Rand(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Neg(Box<Expr>),
    Bin(String, Box<Expr>, Box<Expr>),
}

pub fn parse(tokens: &[Token], linear: i64) -> Result<Vec<Item>, String> {
    let mut p = Parser {
        tokens,
        linear,
        at: 0,
        pending: Vec::new(),
        last_line: 0,
        last_file: 0,
        depth: 0,
    };
    p.file()
}

struct Parser<'t> {
    tokens: &'t [Token],
    at: usize,
    pending: Vec<Comment>,
    last_line: u32,
    last_file: usize,
    depth: usize,
    /// What `[1]` is in 65536ths of an elmo.
    linear: i64,
}

fn comment_of(t: &Token) -> Comment {
    Comment {
        text: t.text.clone(),
        block: matches!(t.kind, Kind::Comment { block: true, .. }),
        file: t.file,
    }
}

/// One expression on its own, such as the body of a `#define`.
pub fn expression(tokens: &[Token], linear: i64) -> Result<Expr, String> {
    let mut p = Parser {
        tokens,
        linear,
        at: 0,
        pending: Vec::new(),
        last_line: 0,
        last_file: 0,
        depth: 0,
    };
    let e = p.expr(0)?;
    match p.peek() {
        None => Ok(e),
        Some(t) => Err(p.error(t, "the end of the expression")),
    }
}

impl<'t> Parser<'t> {
    /// Skip comments, keeping them for the next thing that wants them.
    fn skip_comments(&mut self) {
        while let Some(t) = self.tokens.get(self.at) {
            if !t.is_comment() {
                break;
            }
            self.pending.push(comment_of(t));
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<&'t Token> {
        self.skip_comments();
        self.tokens.get(self.at)
    }

    fn peek_at(&mut self, ahead: usize) -> Option<&'t Token> {
        self.skip_comments();
        self.tokens[self.at..]
            .iter()
            .filter(|t| !t.is_comment())
            .nth(ahead)
    }

    fn next(&mut self) -> Result<&'t Token, String> {
        self.skip_comments();
        let t = self.tokens.get(self.at).ok_or_else(|| {
            format!(
                "the script ends in the middle of something, after line {}",
                self.last_line
            )
        })?;
        self.at += 1;
        self.last_line = t.line;
        self.last_file = t.file;
        Ok(t)
    }

    fn error(&self, t: &Token, wanted: &str) -> String {
        format!("line {}: expected {wanted}, found `{}`", t.line, t.text)
    }

    fn deeper(&mut self) -> Result<(), String> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(format!(
                "line {}: nested more than {MAX_DEPTH} deep",
                self.last_line
            ));
        }
        Ok(())
    }

    fn sym(&mut self, s: &str) -> Result<(), String> {
        let t = self.next()?;
        if t.is_sym(s) {
            Ok(())
        } else {
            Err(self.error(t, &format!("`{s}`")))
        }
    }

    fn eat_sym(&mut self, s: &str) -> bool {
        if self.peek().is_some_and(|t| t.is_sym(s)) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn word(&mut self, w: &str) -> Result<(), String> {
        let t = self.next()?;
        if t.is_word(w) {
            Ok(())
        } else {
            Err(self.error(t, &format!("`{w}`")))
        }
    }

    fn eat_word(&mut self, w: &str) -> bool {
        if self.peek().is_some_and(|t| t.is_word(w)) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    /// A hyphenated keyword such as `wait-for-turn`, given as its parts.
    fn hyphenated(&mut self, parts: &[&str]) -> Result<(), String> {
        for (i, part) in parts.iter().enumerate() {
            if i > 0 {
                self.sym("-")?;
            }
            self.word(part)?;
        }
        Ok(())
    }

    fn looks_like(&mut self, parts: &[&str]) -> bool {
        parts.iter().enumerate().all(|(i, part)| {
            let at = i * 2;
            self.peek_at(at).is_some_and(|t| t.is_word(part))
                && (i == 0 || self.peek_at(at - 1).is_some_and(|t| t.is_sym("-")))
        })
    }

    fn ident(&mut self) -> Result<String, String> {
        let t = self.next()?;
        if t.kind == Kind::Ident {
            Ok(t.text.clone())
        } else {
            Err(self.error(t, "a name"))
        }
    }

    fn leading(&mut self) -> Vec<Comment> {
        self.skip_comments();
        std::mem::take(&mut self.pending)
    }

    /// A comment on the same line as the code just read.
    fn trailing(&mut self) -> Option<Comment> {
        let t = self.tokens.get(self.at)?;
        match t.kind {
            Kind::Comment {
                own_line: false, ..
            } if t.line == self.last_line => {
                self.at += 1;
                Some(comment_of(t))
            }
            _ => None,
        }
    }

    fn file(&mut self) -> Result<Vec<Item>, String> {
        let mut items = Vec::new();
        loop {
            let leading = self.leading();
            let Some(t) = self.tokens.get(self.at) else {
                if !leading.is_empty() {
                    items.push(Item {
                        kind: ItemKind::Comments,
                        leading,
                        trailing: None,
                        file: self.last_file,
                    });
                }
                return Ok(items);
            };
            let file = t.file;
            self.last_file = file;
            let kind = match t.kind {
                Kind::Define => {
                    self.at += 1;
                    self.last_line = t.line;
                    ItemKind::Define(t.text.clone())
                }
                Kind::IncludeStart => {
                    self.at += 1;
                    ItemKind::IncludeStart(t.text.clone())
                }
                Kind::IncludeEnd => {
                    self.at += 1;
                    ItemKind::IncludeEnd
                }
                _ if t.is_sym(";") => {
                    self.at += 1;
                    if !leading.is_empty() {
                        items.push(Item {
                            kind: ItemKind::Comments,
                            leading,
                            trailing: None,
                            file,
                        });
                    }
                    continue;
                }
                _ if t.is_word("piece") => {
                    self.at += 1;
                    ItemKind::Pieces(self.names(";")?)
                }
                _ if t.is_word("static") => {
                    self.at += 1;
                    self.sym("-")?;
                    self.word("var")?;
                    ItemKind::Statics(self.names(";")?)
                }
                Kind::Ident => ItemKind::Func(self.func()?),
                _ => return Err(self.error(t, "a piece, static-var or function")),
            };
            let trailing = self.trailing();
            items.push(Item {
                kind,
                leading,
                trailing,
                file,
            });
        }
    }

    /// Comma-separated names up to `end`, which is consumed.
    fn names(&mut self, end: &str) -> Result<Vec<String>, String> {
        let mut names = vec![self.ident()?];
        while self.eat_sym(",") {
            names.push(self.ident()?);
        }
        self.sym(end)?;
        Ok(names)
    }

    fn func(&mut self) -> Result<Func, String> {
        let name = self.ident()?;
        self.sym("(")?;
        let params = if self.eat_sym(")") {
            Vec::new()
        } else {
            self.names(")")?
        };
        let (body, tail) = self.braced()?;
        Ok(Func {
            name,
            params,
            body,
            tail,
        })
    }

    /// Statements between braces, with any comments before the closing one.
    fn braced(&mut self) -> Result<(Vec<Stmt>, Vec<Comment>), String> {
        self.sym("{")?;
        self.deeper()?;
        let mut body = Vec::new();
        loop {
            let leading = self.leading();
            match self.tokens.get(self.at) {
                Some(t) if t.is_sym("}") => {
                    self.at += 1;
                    self.last_line = t.line;
                    self.depth -= 1;
                    return Ok((body, leading));
                }
                None => {
                    return Err(format!(
                        "a brace is never closed, after line {}",
                        self.last_line
                    ))
                }
                _ => body.push(self.statement(leading)?),
            }
        }
    }

    /// The body of an `if`, `else` or `while`: a braced block or one statement.
    fn block(&mut self) -> Result<(Vec<Stmt>, Vec<Comment>), String> {
        if self.peek().is_some_and(|t| t.is_sym("{")) {
            self.braced()
        } else {
            let leading = self.leading();
            self.deeper()?;
            let stmt = self.statement(leading)?;
            self.depth -= 1;
            Ok((vec![stmt], Vec::new()))
        }
    }

    /// The end of a statement, which may be left out right before a closing
    /// brace.
    fn end(&mut self) -> Result<(), String> {
        if self.eat_sym(";") || self.peek().is_some_and(|t| t.is_sym("}")) {
            Ok(())
        } else {
            let t = self.next()?;
            Err(self.error(t, "the end of the statement"))
        }
    }

    fn statement(&mut self, leading: Vec<Comment>) -> Result<Stmt, String> {
        let kind = self.statement_kind()?;
        let trailing = self.trailing();
        Ok(Stmt {
            kind,
            leading,
            trailing,
        })
    }

    fn axis(&mut self) -> Result<Axis, String> {
        let t = self.next()?;
        let axis = match t.text.to_ascii_lowercase().as_str() {
            "x" => Axis::X,
            "y" => Axis::Y,
            "z" => Axis::Z,
            _ => return Err(self.error(t, "an axis")),
        };
        self.sym("-")?;
        self.word("axis")?;
        Ok(axis)
    }

    fn args(&mut self) -> Result<Vec<Expr>, String> {
        self.sym("(")?;
        let mut args = Vec::new();
        if self.eat_sym(")") {
            return Ok(args);
        }
        loop {
            args.push(self.expr(0)?);
            if self.eat_sym(")") {
                return Ok(args);
            }
            self.sym(",")?;
        }
    }

    fn statement_kind(&mut self) -> Result<StmtKind, String> {
        let Some(t) = self.peek() else {
            return Err("the script ends in the middle of a function".into());
        };
        if t.kind == Kind::Define {
            self.at += 1;
            return Ok(StmtKind::Define(t.text.clone()));
        }
        if matches!(t.kind, Kind::IncludeStart | Kind::IncludeEnd) {
            self.at += 1;
            return Ok(StmtKind::Empty);
        }
        if t.is_sym(";") {
            self.at += 1;
            return Ok(StmtKind::Empty);
        }
        if t.is_sym("{") {
            let (body, tail) = self.braced()?;
            return Ok(StmtKind::Block(body, tail));
        }
        if t.is_sym("++") || t.is_sym("--") {
            self.at += 1;
            let name = self.ident()?;
            self.end()?;
            return Ok(if t.text == "++" {
                StmtKind::Inc(name)
            } else {
                StmtKind::Dec(name)
            });
        }
        if t.kind != Kind::Ident {
            return Err(self.error(t, "a statement"));
        }

        let word = t.text.to_ascii_lowercase();
        let kind = match word.as_str() {
            "if" => {
                self.at += 1;
                self.sym("(")?;
                let cond = self.expr(0)?;
                self.sym(")")?;
                let (then, then_tail) = self.block()?;
                let els = if self.eat_word("else") {
                    Some(self.block()?)
                } else {
                    None
                };
                return Ok(StmtKind::If {
                    cond,
                    then,
                    then_tail,
                    els,
                });
            }
            "while" => {
                self.at += 1;
                self.sym("(")?;
                let cond = self.expr(0)?;
                self.sym(")")?;
                let (body, tail) = self.block()?;
                return Ok(StmtKind::While { cond, body, tail });
            }
            "return" => {
                self.at += 1;
                let value = if self.peek().is_some_and(|t| t.is_sym(";") || t.is_sym("}")) {
                    None
                } else {
                    Some(self.expr(0)?)
                };
                StmtKind::Return(value)
            }
            "call" | "start" if self.looks_like(&[&word, "script"]) => {
                self.hyphenated(&[&word, "script"])?;
                let name = self.ident()?;
                let args = self.args()?;
                if word == "call" {
                    StmtKind::Call(name, args)
                } else {
                    StmtKind::Start(name, args)
                }
            }
            "spin" => {
                self.at += 1;
                let piece = self.ident()?;
                self.word("around")?;
                let axis = self.axis()?;
                self.word("speed")?;
                let speed = self.expr(0)?;
                let accel = if self.eat_word("accelerate") {
                    Some(self.expr(0)?)
                } else {
                    None
                };
                StmtKind::Spin {
                    piece,
                    axis,
                    speed,
                    accel,
                }
            }
            "stop" if self.looks_like(&["stop", "spin"]) => {
                self.hyphenated(&["stop", "spin"])?;
                let piece = self.ident()?;
                self.word("around")?;
                let axis = self.axis()?;
                let decel = if self.eat_word("decelerate") {
                    Some(self.expr(0)?)
                } else {
                    None
                };
                StmtKind::StopSpin { piece, axis, decel }
            }
            "turn" | "move" => {
                self.at += 1;
                let piece = self.ident()?;
                self.word("to")?;
                let axis = self.axis()?;
                let dest = self.expr(0)?;
                let speed = if self.eat_word("now") {
                    None
                } else {
                    self.word("speed")?;
                    Some(self.expr(0)?)
                };
                if word == "turn" {
                    StmtKind::Turn {
                        piece,
                        axis,
                        dest,
                        speed,
                    }
                } else {
                    StmtKind::Move {
                        piece,
                        axis,
                        dest,
                        speed,
                    }
                }
            }
            "wait" if self.looks_like(&["wait", "for", "turn"]) => {
                self.hyphenated(&["wait", "for", "turn"])?;
                let piece = self.ident()?;
                self.word("around")?;
                StmtKind::WaitTurn(piece, self.axis()?)
            }
            "wait" if self.looks_like(&["wait", "for", "move"]) => {
                self.hyphenated(&["wait", "for", "move"])?;
                let piece = self.ident()?;
                self.word("along")?;
                StmtKind::WaitMove(piece, self.axis()?)
            }
            "emit" if self.looks_like(&["emit", "sfx"]) => {
                self.hyphenated(&["emit", "sfx"])?;
                let kind = self.expr(0)?;
                self.word("from")?;
                StmtKind::EmitSfx(kind, self.ident()?)
            }
            "sleep" => {
                self.at += 1;
                StmtKind::Sleep(self.expr(0)?)
            }
            "hide" | "show" => {
                self.at += 1;
                let piece = self.ident()?;
                if word == "hide" {
                    StmtKind::Hide(piece)
                } else {
                    StmtKind::Show(piece)
                }
            }
            "explode" => {
                self.at += 1;
                let piece = self.ident()?;
                self.word("type")?;
                StmtKind::Explode(piece, self.expr(0)?)
            }
            "signal" => {
                self.at += 1;
                StmtKind::Signal(self.expr(0)?)
            }
            "set" if self.looks_like(&["set", "signal", "mask"]) => {
                self.hyphenated(&["set", "signal", "mask"])?;
                StmtKind::SetSignalMask(self.expr(0)?)
            }
            "set" => {
                self.at += 1;
                let id = self.expr(0)?;
                self.word("to")?;
                StmtKind::Set(id, self.expr(0)?)
            }
            "get" => StmtKind::Get(self.expr(0)?),
            "attach" if self.looks_like(&["attach", "unit"]) => {
                self.hyphenated(&["attach", "unit"])?;
                let unit = self.expr(0)?;
                self.word("to")?;
                StmtKind::AttachUnit(unit, self.expr(0)?)
            }
            "drop" if self.looks_like(&["drop", "unit"]) => {
                self.hyphenated(&["drop", "unit"])?;
                StmtKind::DropUnit(self.expr(0)?)
            }
            "play" if self.looks_like(&["play", "sound"]) => {
                self.hyphenated(&["play", "sound"])?;
                self.sym("(")?;
                let t = self.next()?;
                if t.kind != Kind::Str {
                    return Err(self.error(t, "a sound name in quotes"));
                }
                let name = t.text.clone();
                self.sym(",")?;
                let volume = self.expr(0)?;
                self.sym(")")?;
                StmtKind::PlaySound(name, volume)
            }
            "cache" => {
                self.at += 1;
                self.ident()?;
                StmtKind::Ignored
            }
            "dont"
                if self.looks_like(&["dont", "cache"])
                    || self.looks_like(&["dont", "shade"])
                    || self.looks_like(&["dont", "shadow"]) =>
            {
                self.next()?;
                self.next()?;
                self.next()?;
                self.ident()?;
                StmtKind::Ignored
            }
            "var" => {
                self.at += 1;
                let mut names = vec![self.ident()?];
                while self.eat_sym(",") {
                    names.push(self.ident()?);
                }
                StmtKind::Var(names)
            }
            _ => {
                let name = self.ident()?;
                if self.eat_sym("++") {
                    StmtKind::Inc(name)
                } else if self.eat_sym("--") {
                    StmtKind::Dec(name)
                } else {
                    self.sym("=")?;
                    StmtKind::Assign(name, self.expr(0)?)
                }
            }
        };
        self.end()?;
        Ok(kind)
    }

    fn binary_op(&mut self) -> Option<(String, u8)> {
        let t = self.peek()?;
        if !matches!(t.kind, Kind::Sym | Kind::Ident) {
            return None;
        }
        let power = crate::pp::binding(&t.text)?;
        let op = match t.text.to_ascii_lowercase().as_str() {
            "and" => "&&".to_string(),
            "or" => "||".to_string(),
            "xor" => "^^".to_string(),
            other => other.to_string(),
        };
        Some((op, power))
    }

    fn expr(&mut self, min: u8) -> Result<Expr, String> {
        self.deeper()?;
        let mut left = self.term()?;
        while let Some((op, power)) = self.binary_op() {
            if power <= min {
                break;
            }
            self.at += 1;
            let right = self.expr(power)?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        self.depth -= 1;
        Ok(left)
    }

    fn number(&mut self) -> Result<f64, String> {
        let negative = self.eat_sym("-");
        let t = self.next()?;
        let value = match t.kind {
            Kind::Number => crate::pp::parse_number(&t.text),
            _ => None,
        }
        .ok_or_else(|| self.error(t, "a number"))?;
        Ok(if negative { -value } else { value })
    }

    fn term(&mut self) -> Result<Expr, String> {
        let t = self.next()?;
        match t.kind {
            Kind::Number => {
                let v =
                    crate::pp::parse_number(&t.text).ok_or_else(|| self.error(t, "a number"))?;
                Ok(Expr::Num(crate::pp::round_constant(v)))
            }
            Kind::Const => Ok(Expr::Const(t.text.clone())),
            Kind::Ident if t.is_word("not") => Ok(Expr::Not(Box::new(self.term()?))),
            Kind::Ident if t.is_word("rand") => {
                self.sym("(")?;
                let low = self.expr(0)?;
                self.sym(",")?;
                let high = self.expr(0)?;
                self.sym(")")?;
                Ok(Expr::Rand(Box::new(low), Box::new(high)))
            }
            Kind::Ident if t.is_word("get") => {
                let id = self.term()?;
                let args = if self.peek().is_some_and(|t| t.is_sym("(")) {
                    self.args()?
                } else {
                    Vec::new()
                };
                Ok(Expr::Get(Box::new(id), args))
            }
            Kind::Ident => Ok(Expr::Name(t.text.clone())),
            Kind::Sym => match t.text.as_str() {
                "(" => {
                    let inner = self.expr(0)?;
                    self.sym(")")?;
                    Ok(inner)
                }
                "-" => Ok(Expr::Neg(Box::new(self.term()?))),
                "!" => Ok(Expr::Not(Box::new(self.term()?))),
                "<" => {
                    let v = self.number()?;
                    self.sym(">")?;
                    Ok(Expr::Angle(
                        v,
                        crate::pp::scale_constant(true, v, self.linear),
                    ))
                }
                "[" => {
                    let v = self.number()?;
                    self.sym("]")?;
                    Ok(Expr::Linear(
                        v,
                        crate::pp::scale_constant(false, v, self.linear),
                    ))
                }
                _ => Err(self.error(t, "a value")),
            },
            _ => Err(self.error(t, "a value")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lex::lex;

    fn items(src: &str) -> Vec<Item> {
        parse(&lex(src, 0), 65536).unwrap()
    }

    fn body(src: &str) -> Vec<Stmt> {
        match items(src).pop().unwrap().kind {
            ItemKind::Func(f) => f.body,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn attaches_comments_to_the_statements_they_sit_by() {
        let b = body("F()\n{\n\t// before\n\tsleep 100; // after\n}");
        assert_eq!(b[0].leading[0].text, " before");
        assert_eq!(b[0].trailing.as_ref().unwrap().text, " after");
    }

    #[test]
    fn reads_keywords_in_any_case() {
        let b = body("F() { IF (a) { CALL-SCRIPT walk(); } else if (b) { Sleep 5; } }");
        let StmtKind::If {
            els: Some((els, _)),
            then,
            ..
        } = &b[0].kind
        else {
            panic!("{:?}", b[0].kind)
        };
        assert!(matches!(then[0].kind, StmtKind::Call(ref n, _) if n == "walk"));
        assert!(matches!(els[0].kind, StmtKind::If { .. }));
    }

    #[test]
    fn reads_every_motion_statement() {
        let b = body(
            "F() { turn a to z-axis <-25.0> speed <100>; move a to x-axis [1.5] now; spin a around y-axis speed <30> accelerate <5>; stop-spin a around y-axis; wait-for-turn a around x-axis; wait-for-move a along y-axis; }",
        );
        assert!(
            matches!(b[0].kind, StmtKind::Turn { axis: Axis::Z, dest: Expr::Angle(v, _), .. } if v == -25.0)
        );
        assert!(matches!(b[1].kind, StmtKind::Move { speed: None, .. }));
        assert!(matches!(b[2].kind, StmtKind::Spin { accel: Some(_), .. }));
        assert!(matches!(b[3].kind, StmtKind::StopSpin { decel: None, .. }));
        assert!(matches!(b[4].kind, StmtKind::WaitTurn(_, Axis::X)));
        assert!(matches!(b[5].kind, StmtKind::WaitMove(_, Axis::Y)));
    }

    #[test]
    fn binds_operators_as_the_compiler_does() {
        let b = body("F() { x = 1 + 2 * 3 == 7 && !y; }");
        let StmtKind::Assign(_, Expr::Bin(op, left, _)) = &b[0].kind else {
            panic!()
        };
        assert_eq!(op, "&&");
        assert!(matches!(**left, Expr::Bin(ref op, _, _) if op == "=="));
    }

    #[test]
    fn get_reads_its_arguments_only_when_they_follow_at_once() {
        let b = body("F() { x = get PIECE_XZ(base) - get HEALTH; }");
        let StmtKind::Assign(_, Expr::Bin(_, left, right)) = &b[0].kind else {
            panic!()
        };
        assert!(matches!(**left, Expr::Get(_, ref args) if args.len() == 1));
        assert!(matches!(**right, Expr::Get(_, ref args) if args.is_empty()));
    }

    #[test]
    fn an_unterminated_statement_before_a_brace_is_accepted() {
        assert_eq!(body("F() { sleep 1 }").len(), 1);
    }

    #[test]
    fn says_where_it_stopped_understanding() {
        let err = parse(&lex("F() {\n turn a;\n}", 0), 65536).unwrap_err();
        assert!(err.contains("line 2"), "{err}");
    }

    #[test]
    fn runaway_nesting_is_an_error_not_a_crash() {
        let src = format!("F() {{ x = {}1{}; }}", "(".repeat(5000), ")".repeat(5000));
        assert!(parse(&lex(&src, 0), 65536).unwrap_err().contains("nested"));
    }
}
