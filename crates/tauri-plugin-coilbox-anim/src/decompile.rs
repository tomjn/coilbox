//! COB to BOS decompiler. Runs the code generation in `compiler.rs` backwards,
//! so the BOS it writes compiles back into the same `.cob`.
//!
//! A symbolic stack turns pushes and operators back into expressions, and the
//! three jump shapes codegen emits (`if`, `if`/`else` and `while`) turn back
//! into blocks. A `.cob` keeps piece and script names but not variable names,
//! so locals and statics get generic ones.
//!
//! A script that does something BOS has no way to write is given as its
//! disassembly in a comment, followed by a line that does not compile. That way
//! it can never be recompiled into something that behaves differently.

use crate::cob;
use crate::compiler::precedence;
use crate::fold::{ANGULAR_SCALE, LINEAR_SCALE};
use crate::opcodes::mnemonic;
use coilbox_unitpose::unitvalue;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

pub struct Decompiled {
    pub source: String,
    /// One entry per script that could not be written as BOS.
    pub warnings: Vec<String>,
}

const AXES: [&str; 3] = ["x", "y", "z"];

struct Ins {
    /// Word offset inside the script.
    at: usize,
    op: &'static str,
    args: Vec<u32>,
}

/// How many operand words follow an opcode, as `compiler.rs` writes them.
fn operand_count(op: &str) -> usize {
    match op {
        "PUSH_CONSTANT" | "PUSH_LOCAL_VAR" | "PUSH_STATIC" | "POP_LOCAL_VAR" | "POP_STATIC"
        | "SHOW" | "HIDE" | "CACHE" | "DONT_CACHE" | "SHADE" | "DONT_SHADOW" | "EMIT_SFX"
        | "EXPLODE" | "PLAY_SOUND" | "JUMP" | "JUMP_NOT_EQUAL" | "SCALE" | "SCALE_NOW"
        | "WAIT_FOR_SCALE" => 1,
        "MOVE" | "TURN" | "SPIN" | "STOP_SPIN" | "MOVE_NOW" | "TURN_NOW" | "WAIT_FOR_TURN"
        | "WAIT_FOR_MOVE" | "START_SCRIPT" | "CALL_SCRIPT" | "REAL_CALL" | "LUA_CALL" => 2,
        _ => 0,
    }
}

/// The instructions in a script, and how many words after them are not code.
///
/// COBBLER stamps its own name and version into the stream after the first
/// script's last `RETURN`, so a word that is not an opcode is only an error
/// while the script can still be running.
fn instructions(code: &[u32]) -> Result<(Vec<Ins>, usize), String> {
    let mut out: Vec<Ins> = Vec::new();
    let mut i = 0;
    while i < code.len() {
        let op = match mnemonic(code[i]) {
            Some(op) => op,
            None if out.last().is_some_and(|last| last.op == "RETURN") => {
                return Ok((out, code.len() - i))
            }
            None => return Err(format!("word {} at {i:04} is not an instruction", code[i])),
        };
        let mut count = operand_count(op);
        // The engine reads only a piece for the scale opcodes, but
        // `compiler.rs` writes an axis after it too. Take the axis when there
        // is one, which an opcode never looks like.
        if matches!(op, "SCALE" | "SCALE_NOW" | "WAIT_FOR_SCALE")
            && code.get(i + 2).is_some_and(|w| mnemonic(*w).is_none())
        {
            count = 2;
        }
        if i + 1 + count > code.len() {
            return Err(format!("{op} at {i:04} runs past the end of the script"));
        }
        out.push(Ins {
            at: i,
            op,
            args: code[i + 1..i + 1 + count].to_vec(),
        });
        i += 1 + count;
    }
    Ok((out, 0))
}

#[derive(Clone, Copy, PartialEq)]
enum Var {
    Local(usize),
    Static(usize),
}

#[derive(Clone, PartialEq)]
enum Expr {
    Const(i32),
    Var(Var),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Rand(Box<Expr>, Box<Expr>),
    /// A unit value. No arguments is `get X`, which is `GET_UNIT_VALUE`.
    Get(Box<Expr>, Vec<Expr>),
}

enum Stmt {
    Declare(usize),
    Assign(Var, Expr),
    Step(Var, &'static str),
    /// `turn`, `move` or `scale`. No speed means `now`.
    Motion {
        keyword: &'static str,
        piece: u32,
        axis: u32,
        target: Expr,
        speed: Option<Expr>,
    },
    Spin {
        piece: u32,
        axis: u32,
        speed: Expr,
        accel: Expr,
    },
    StopSpin {
        piece: u32,
        axis: u32,
        decel: Expr,
    },
    Wait {
        keyword: &'static str,
        piece: u32,
        axis: u32,
    },
    Piece {
        keyword: &'static str,
        piece: u32,
    },
    EmitSfx {
        kind: Expr,
        piece: u32,
    },
    Explode {
        piece: u32,
        kind: Expr,
    },
    /// `sleep`, `signal`, `set-signal-mask`, `drop-unit` or `return`.
    Unary {
        keyword: &'static str,
        value: Expr,
    },
    Set {
        id: Expr,
        value: Expr,
    },
    Attach {
        unit: Expr,
        to: Expr,
    },
    Get(Expr),
    Call {
        keyword: &'static str,
        function: usize,
        args: Vec<Expr>,
    },
    If {
        cond: Expr,
        then: Vec<Stmt>,
        otherwise: Option<Vec<Stmt>>,
    },
    While {
        cond: Expr,
        body: Vec<Stmt>,
    },
}

fn binary_symbol(op: &str) -> Option<&'static str> {
    Some(match op {
        "ADD" => "+",
        "SUB" => "-",
        "MUL" => "*",
        "DIV" => "/",
        "MOD" => "%",
        "BITWISE_AND" => "&",
        "BITWISE_OR" => "|",
        "BITWISE_XOR" => "^",
        "SET_LESS" => "<",
        "SET_LESS_OR_EQUAL" => "<=",
        "SET_GREATER" => ">",
        "SET_GREATER_OR_EQUAL" => ">=",
        "SET_EQUAL" => "==",
        "SET_NOT_EQUAL" => "!=",
        "LOGICAL_AND" => "&&",
        "LOGICAL_OR" => "||",
        "LOGICAL_XOR" => "^^",
        _ => return None,
    })
}

/// What one script's body is decoded against.
struct Body<'a> {
    ins: &'a [Ins],
    /// Instruction index for each word offset that starts one.
    index: HashMap<usize, usize>,
    /// Where the script starts in the whole code stream, which jumps count in.
    start: usize,
    len: usize,
    pieces: usize,
    statics: usize,
    functions: usize,
    /// Locals declared so far, in the order `CREATE_LOCAL_VAR` made them.
    locals: usize,
}

impl Body<'_> {
    /// The instruction index a jump operand lands on. The end of the script
    /// counts, and is one past the last instruction.
    fn target(&self, word: u32) -> Result<usize, String> {
        let local = (word as usize)
            .checked_sub(self.start)
            .filter(|at| *at <= self.len)
            .ok_or_else(|| format!("a jump to {word} leaves the script"))?;
        if local == self.len {
            return Ok(self.ins.len());
        }
        self.index
            .get(&local)
            .copied()
            .ok_or_else(|| format!("a jump to {word} lands inside an instruction"))
    }

    fn piece(&self, index: u32) -> Result<u32, String> {
        if (index as usize) < self.pieces {
            Ok(index)
        } else {
            Err(format!("piece {index} is not in the file"))
        }
    }

    fn axis(&self, axis: u32) -> Result<u32, String> {
        if axis < 3 {
            Ok(axis)
        } else {
            Err(format!("axis {axis} is not x, y or z"))
        }
    }

    fn block(&mut self, lo: usize, hi: usize) -> Result<Vec<Stmt>, String> {
        let mut out = Vec::new();
        let mut stack: Vec<Expr> = Vec::new();
        // Where the stack was last empty, which is where a `while` condition
        // starts and so where its closing `JUMP` goes back to.
        let mut stmt_start = lo;
        let mut k = lo;
        fn pop(stack: &mut Vec<Expr>, op: &str) -> Result<Expr, String> {
            stack
                .pop()
                .ok_or_else(|| format!("{op} takes a value the stack does not have"))
        }
        let all = self.ins;
        while k < hi {
            let ins = &all[k];
            let op = ins.op;
            let arg = |n: usize| ins.args.get(n).copied().unwrap_or(0);
            let mut next = k + 1;
            let stmt = match op {
                "PUSH_CONSTANT" => {
                    stack.push(Expr::Const(arg(0) as i32));
                    None
                }
                "PUSH_LOCAL_VAR" => {
                    let slot = arg(0) as usize;
                    if slot >= self.locals {
                        return Err(format!("local {slot} is read before it exists"));
                    }
                    stack.push(Expr::Var(Var::Local(slot)));
                    None
                }
                "PUSH_STATIC" => {
                    let slot = arg(0) as usize;
                    if slot >= self.statics {
                        return Err(format!("static {slot} is not in the file"));
                    }
                    stack.push(Expr::Var(Var::Static(slot)));
                    None
                }
                "LOGICAL_NOT" => {
                    let value = pop(&mut stack, op)?;
                    stack.push(Expr::Not(Box::new(value)));
                    None
                }
                "RAND" => {
                    let high = pop(&mut stack, op)?;
                    let low = pop(&mut stack, op)?;
                    stack.push(Expr::Rand(Box::new(low), Box::new(high)));
                    None
                }
                "GET_UNIT_VALUE" => {
                    let id = pop(&mut stack, op)?;
                    stack.push(Expr::Get(Box::new(id), Vec::new()));
                    None
                }
                "GET" => {
                    if stack.len() < 5 {
                        return Err("GET takes five values the stack does not have".into());
                    }
                    let mut args = stack.split_off(stack.len() - 4);
                    let id = pop(&mut stack, op)?;
                    // Trailing zeros are what an omitted argument compiles to.
                    while args.len() > 1 && args.last() == Some(&Expr::Const(0)) {
                        args.pop();
                    }
                    stack.push(Expr::Get(Box::new(id), args));
                    None
                }
                "POP_LOCAL_VAR" | "POP_STATIC" => {
                    let slot = arg(0) as usize;
                    let var = if op == "POP_LOCAL_VAR" {
                        if slot >= self.locals {
                            return Err(format!("local {slot} is written before it exists"));
                        }
                        Var::Local(slot)
                    } else {
                        if slot >= self.statics {
                            return Err(format!("static {slot} is not in the file"));
                        }
                        Var::Static(slot)
                    };
                    let value = pop(&mut stack, op)?;
                    Some(match value {
                        Expr::Binary(sym @ ("+" | "-"), left, right)
                            if *left == Expr::Var(var) && *right == Expr::Const(1) =>
                        {
                            Stmt::Step(var, if sym == "+" { "++" } else { "--" })
                        }
                        value => Stmt::Assign(var, value),
                    })
                }
                "POP_STACK" => match pop(&mut stack, op)? {
                    value @ Expr::Get(..) => Some(Stmt::Get(value)),
                    _ => return Err("a value is thrown away that is not a get".into()),
                },
                "CREATE_LOCAL_VAR" => {
                    self.locals += 1;
                    Some(Stmt::Declare(self.locals - 1))
                }
                "TURN" | "MOVE" | "SCALE" | "TURN_NOW" | "MOVE_NOW" | "SCALE_NOW" => {
                    let target = pop(&mut stack, op)?;
                    let speed = if op.ends_with("_NOW") {
                        None
                    } else {
                        Some(pop(&mut stack, op)?)
                    };
                    Some(Stmt::Motion {
                        keyword: match op {
                            "TURN" | "TURN_NOW" => "turn",
                            "MOVE" | "MOVE_NOW" => "move",
                            _ => "scale",
                        },
                        piece: self.piece(arg(0))?,
                        // A scale opcode has no axis. The statement needs one
                        // written, so it gets the one the file happens to
                        // carry, or x when the file is the engine's shape.
                        axis: self.axis(ins.args.get(1).copied().unwrap_or(0))?,
                        target,
                        speed,
                    })
                }
                "SPIN" => {
                    let speed = pop(&mut stack, op)?;
                    let accel = pop(&mut stack, op)?;
                    Some(Stmt::Spin {
                        piece: self.piece(arg(0))?,
                        axis: self.axis(arg(1))?,
                        speed,
                        accel,
                    })
                }
                "STOP_SPIN" => Some(Stmt::StopSpin {
                    decel: pop(&mut stack, op)?,
                    piece: self.piece(arg(0))?,
                    axis: self.axis(arg(1))?,
                }),
                "WAIT_FOR_TURN" | "WAIT_FOR_MOVE" | "WAIT_FOR_SCALE" => Some(Stmt::Wait {
                    keyword: match op {
                        "WAIT_FOR_TURN" => "turn",
                        "WAIT_FOR_MOVE" => "move",
                        _ => "scale",
                    },
                    piece: self.piece(arg(0))?,
                    axis: self.axis(ins.args.get(1).copied().unwrap_or(0))?,
                }),
                "SHOW" | "HIDE" | "CACHE" | "DONT_CACHE" | "DONT_SHADOW" => Some(Stmt::Piece {
                    keyword: match op {
                        "SHOW" => "show",
                        "HIDE" => "hide",
                        "CACHE" => "cache",
                        "DONT_CACHE" => "dont-cache",
                        _ => "dont-shadow",
                    },
                    piece: self.piece(arg(0))?,
                }),
                "EMIT_SFX" => Some(Stmt::EmitSfx {
                    kind: pop(&mut stack, op)?,
                    piece: self.piece(arg(0))?,
                }),
                "EXPLODE" => Some(Stmt::Explode {
                    kind: pop(&mut stack, op)?,
                    piece: self.piece(arg(0))?,
                }),
                "SLEEP" | "SIGNAL" | "SET_SIGNAL_MASK" | "DROP_UNIT" | "RETURN" => {
                    // Other compilers write a bare `RETURN`, where the engine
                    // pops an empty stack and gets zero.
                    let value = match (op, stack.pop()) {
                        (_, Some(value)) => value,
                        ("RETURN", None) => Expr::Const(0),
                        _ => return Err(format!("{op} takes a value the stack does not have")),
                    };
                    Some(Stmt::Unary {
                        keyword: match op {
                            "SLEEP" => "sleep",
                            "SIGNAL" => "signal",
                            "SET_SIGNAL_MASK" => "set-signal-mask",
                            "DROP_UNIT" => "drop-unit",
                            _ => "return",
                        },
                        value,
                    })
                }
                "SET" => {
                    let value = pop(&mut stack, op)?;
                    let id = pop(&mut stack, op)?;
                    Some(Stmt::Set { id, value })
                }
                "ATTACH_UNIT" => {
                    // `compiler.rs` always pushes a zero last, and BOS has no
                    // way to say anything else there.
                    if pop(&mut stack, op)? != Expr::Const(0) {
                        return Err("attach-unit has a third value BOS cannot write".into());
                    }
                    let to = pop(&mut stack, op)?;
                    let unit = pop(&mut stack, op)?;
                    Some(Stmt::Attach { unit, to })
                }
                "CALL_SCRIPT" | "REAL_CALL" | "LUA_CALL" | "START_SCRIPT" => {
                    let function = arg(0) as usize;
                    if function >= self.functions {
                        return Err(format!("script {function} is not in the file"));
                    }
                    let count = arg(1) as usize;
                    if stack.len() < count {
                        return Err(format!("{op} takes {count} values the stack does not have"));
                    }
                    let args = stack.split_off(stack.len() - count);
                    Some(Stmt::Call {
                        keyword: if op == "START_SCRIPT" {
                            "start-script"
                        } else {
                            "call-script"
                        },
                        function,
                        args,
                    })
                }
                "JUMP_NOT_EQUAL" => {
                    let cond = pop(&mut stack, op)?;
                    if !stack.is_empty() {
                        return Err("a condition leaves values on the stack".into());
                    }
                    let end = self.target(arg(0))?;
                    if end <= k || end > hi {
                        return Err("a condition jumps somewhere no block ends".into());
                    }
                    let (stmt, after) = self.conditional(cond, k + 1, end, hi, stmt_start)?;
                    next = after;
                    Some(stmt)
                }
                other => {
                    if let Some(sym) = binary_symbol(other) {
                        let right = pop(&mut stack, op)?;
                        let left = pop(&mut stack, op)?;
                        stack.push(Expr::Binary(sym, Box::new(left), Box::new(right)));
                        None
                    } else if other == "PLAY_SOUND" {
                        // The operand indexes a table of sound names that only
                        // a TA Kingdoms COB carries, and `compiler.rs` writes
                        // neither the table nor the operand.
                        return Err("PLAY_SOUND names a sound in a table BOS cannot write".into());
                    } else {
                        return Err(format!("{other} has no BOS statement"));
                    }
                }
            };
            if let Some(stmt) = stmt {
                if !stack.is_empty() {
                    return Err(format!("{op} leaves values on the stack"));
                }
                out.push(stmt);
                stmt_start = next;
            }
            k = next;
        }
        if !stack.is_empty() {
            return Err("a block ends with values still on the stack".into());
        }
        Ok(out)
    }

    /// The block a condition guards, from `lo` to `end`, where its jump goes.
    /// Returns the statement and the instruction after it.
    fn conditional(
        &mut self,
        cond: Expr,
        lo: usize,
        end: usize,
        hi: usize,
        cond_start: usize,
    ) -> Result<(Stmt, usize), String> {
        if end > lo && self.ins[end - 1].op == "JUMP" {
            let back = self.target(self.ins[end - 1].args[0])?;
            // A `while` ends by jumping back to its own condition.
            if back == cond_start {
                let body = self.block(lo, end - 1)?;
                return Ok((Stmt::While { cond, body }, end));
            }
            // An `if` with an `else` ends its first block by jumping past the
            // second. An `if` whose block ends in an `if` with an empty `else`
            // looks the same, so fall back to a plain `if` when this fails.
            if back >= end && back <= hi {
                let locals = self.locals;
                let both = self
                    .block(lo, end - 1)
                    .and_then(|then| Ok((then, self.block(end, back)?)));
                if let Ok((then, otherwise)) = both {
                    let stmt = Stmt::If {
                        cond,
                        then,
                        otherwise: Some(otherwise),
                    };
                    return Ok((stmt, back));
                }
                self.locals = locals;
            }
        }
        let then = self.block(lo, end)?;
        Ok((
            Stmt::If {
                cond,
                then,
                otherwise: None,
            },
            end,
        ))
    }
}

/// A constant as `<degrees>` or `[distance]` when some short decimal compiles
/// back to exactly the same integer, which `compiler.rs` gets by truncating.
fn scaled(n: i32, scale: i64, max_decimals: usize) -> Option<String> {
    let exact = n as f64 / scale as f64;
    for decimals in 0..=max_decimals {
        let step = 10f64.powi(-(decimals as i32));
        let rounded = (exact / step).round() * step;
        for candidate in [rounded, rounded + step, rounded - step] {
            let mut text = format!("{candidate:.decimals$}");
            if text.contains('.') {
                text = text.trim_end_matches('0').trim_end_matches('.').to_string();
            }
            if text == "-0" {
                continue;
            }
            let value: f64 = text.parse().ok()?;
            if (scale as f64 * value) as i64 == i64::from(n) {
                return Some(text);
            }
        }
    }
    None
}

/// Ids a script can `get` that the engine's Lua `COB` table leaves out, since
/// only compiled code reaches them. `CobDefines.h` and `CobThread.cpp`.
const COMPILED_ONLY_VALUES: &[(&str, i32)] = &[
    ("LUA0", 110),
    ("LUA1", 111),
    ("LUA2", 112),
    ("LUA3", 113),
    ("LUA4", 114),
    ("LUA5", 115),
    ("LUA6", 116),
    ("LUA7", 117),
    ("LUA8", 118),
    ("LUA9", 119),
    ("KSIN", 135),
    ("KCOS", 136),
    ("KTAN", 137),
    ("SQRT", 138),
];

/// The engine's name for what `get` or `set` is asking about. Anything in the
/// shared-value range is numbered rather than named, because the number is all
/// the two scripts sharing it ever agreed on.
fn unit_value_name(id: i32) -> Option<String> {
    let engine = unitvalue::NAMES
        .iter()
        .chain(COMPILED_ONLY_VALUES)
        .find(|(_, value)| *value == id)
        .map(|(name, _)| (*name).to_string());
    engine.or_else(|| (1024..=5119).contains(&id).then(|| format!("SHARED_{id}")))
}

#[derive(Clone, Copy)]
enum Unit {
    Plain,
    Angle,
    Distance,
    /// What `get` and `set` name, which the file stores as a number.
    Value,
}

/// Names used when printing one script.
struct Printer<'a> {
    pieces: &'a [String],
    statics: &'a [String],
    functions: &'a [String],
    locals: Vec<String>,
    /// Locals that hold a piece, whose constants print as piece names.
    piece_locals: HashSet<usize>,
    /// Every unit value named so far, which the file defines at the top.
    named_values: &'a RefCell<BTreeMap<i32, String>>,
}

impl Printer<'_> {
    fn var(&self, var: Var) -> &str {
        match var {
            Var::Local(i) => &self.locals[i],
            Var::Static(i) => &self.statics[i],
        }
    }

    fn constant(&self, n: i32, unit: Unit) -> String {
        if let Unit::Value = unit {
            if let Some(name) = unit_value_name(n) {
                self.named_values.borrow_mut().insert(n, name.clone());
                return name;
            }
        }
        if n == 0 {
            return "0".into();
        }
        let text = match unit {
            Unit::Plain | Unit::Value => None,
            Unit::Angle => scaled(n, ANGULAR_SCALE, 3).map(|t| format!("<{t}>")),
            Unit::Distance => scaled(n, LINEAR_SCALE, 5).map(|t| format!("[{t}]")),
        };
        text.unwrap_or_else(|| n.to_string())
    }

    fn expr(&self, e: &Expr, unit: Unit) -> String {
        match e {
            Expr::Const(n) => self.constant(*n, unit),
            Expr::Var(v) => self.var(*v).to_string(),
            Expr::Binary(op, left, right) => {
                let p = precedence(op);
                let side = |e: &Expr, wrap: fn(u8, u8) -> bool| match e {
                    Expr::Binary(inner, ..) if wrap(precedence(inner), p) => {
                        format!("({})", self.expr(e, Unit::Plain))
                    }
                    _ => self.expr(e, Unit::Plain),
                };
                // Codegen is left associative, so only a right hand side of
                // equal precedence needs brackets.
                let l = side(left, |inner, outer| inner > outer);
                let r = side(right, |inner, outer| inner >= outer);
                format!("{l} {op} {r}")
            }
            Expr::Not(inner) => format!("!{}", self.term(inner, Unit::Plain)),
            Expr::Rand(low, high) => format!(
                "rand({}, {})",
                self.expr(low, Unit::Plain),
                self.expr(high, Unit::Plain)
            ),
            Expr::Get(id, args) if args.is_empty() => {
                format!("get {}", self.term(id, Unit::Value))
            }
            Expr::Get(id, args) => format!(
                "get {}({})",
                self.term(id, Unit::Value),
                args.iter()
                    .map(|a| self.expr(a, Unit::Plain))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }

    /// An expression where the grammar wants a single term.
    fn term(&self, e: &Expr, unit: Unit) -> String {
        match e {
            Expr::Binary(..) => format!("({})", self.expr(e, Unit::Plain)),
            _ => self.expr(e, unit),
        }
    }

    fn block(&self, stmts: &[Stmt], depth: usize, out: &mut String) {
        for stmt in stmts {
            self.stmt(stmt, depth, out);
        }
    }

    fn stmt(&self, stmt: &Stmt, depth: usize, out: &mut String) {
        let pad = "\t".repeat(depth);
        let piece = |i: &u32| &self.pieces[*i as usize];
        let axis = |i: &u32| AXES[*i as usize];
        let plain = |e: &Expr| self.expr(e, Unit::Plain);
        let line = match stmt {
            Stmt::Declare(i) => format!("var {}", self.locals[*i]),
            Stmt::Assign(var, value) => {
                let value = match (var, value) {
                    (Var::Local(i), Expr::Const(n))
                        if self.piece_locals.contains(i) && (*n as usize) < self.pieces.len() =>
                    {
                        self.pieces[*n as usize].clone()
                    }
                    _ => plain(value),
                };
                format!("{} = {value}", self.var(*var))
            }
            Stmt::Step(var, op) => format!("{op}{}", self.var(*var)),
            Stmt::Motion {
                keyword,
                piece: p,
                axis: a,
                target,
                speed,
            } => {
                let unit = if *keyword == "turn" {
                    Unit::Angle
                } else {
                    Unit::Distance
                };
                let speed = match speed {
                    Some(s) => format!("speed {}", self.expr(s, unit)),
                    None => "now".into(),
                };
                format!(
                    "{keyword} {} to {}-axis {} {speed}",
                    piece(p),
                    axis(a),
                    self.expr(target, unit)
                )
            }
            Stmt::Spin {
                piece: p,
                axis: a,
                speed,
                accel,
            } => {
                let mut text = format!(
                    "spin {} around {}-axis speed {}",
                    piece(p),
                    axis(a),
                    self.expr(speed, Unit::Angle)
                );
                if *accel != Expr::Const(0) {
                    let _ = write!(text, " accelerate {}", self.expr(accel, Unit::Angle));
                }
                text
            }
            Stmt::StopSpin {
                piece: p,
                axis: a,
                decel,
            } => {
                let mut text = format!("stop-spin {} around {}-axis", piece(p), axis(a));
                if *decel != Expr::Const(0) {
                    let _ = write!(text, " decelerate {}", self.expr(decel, Unit::Angle));
                }
                text
            }
            Stmt::Wait {
                keyword,
                piece: p,
                axis: a,
            } => {
                let preposition = if *keyword == "turn" {
                    "around"
                } else {
                    "along"
                };
                format!(
                    "wait-for-{keyword} {} {preposition} {}-axis",
                    piece(p),
                    axis(a)
                )
            }
            Stmt::Piece { keyword, piece: p } => format!("{keyword} {}", piece(p)),
            Stmt::EmitSfx { kind, piece: p } => {
                format!("emit-sfx {} from {}", plain(kind), piece(p))
            }
            Stmt::Explode { piece: p, kind } => {
                format!("explode {} type {}", piece(p), plain(kind))
            }
            Stmt::Unary {
                keyword: "return",
                value,
            } => format!("return ({})", plain(value)),
            Stmt::Unary { keyword, value } => format!("{keyword} {}", plain(value)),
            Stmt::Set { id, value } => {
                format!("set {} to {}", self.expr(id, Unit::Value), plain(value))
            }
            Stmt::Attach { unit, to } => format!("attach-unit {} to {}", plain(unit), plain(to)),
            Stmt::Get(value) => plain(value),
            Stmt::Call {
                keyword,
                function,
                args,
            } => format!(
                "{keyword} {}({})",
                self.functions[*function],
                args.iter().map(plain).collect::<Vec<_>>().join(", ")
            ),
            Stmt::If {
                cond,
                then,
                otherwise,
            } => {
                let _ = writeln!(out, "{pad}if ({})", plain(cond));
                self.braced(then, depth, out);
                if let Some(otherwise) = otherwise {
                    let _ = writeln!(out, "{pad}else");
                    self.braced(otherwise, depth, out);
                }
                return;
            }
            Stmt::While { cond, body } => {
                let _ = writeln!(out, "{pad}while ({})", plain(cond));
                self.braced(body, depth, out);
                return;
            }
        };
        let _ = writeln!(out, "{pad}{line};");
    }

    fn braced(&self, stmts: &[Stmt], depth: usize, out: &mut String) {
        let pad = "\t".repeat(depth);
        let _ = writeln!(out, "{pad}{{");
        self.block(stmts, depth + 1, out);
        let _ = writeln!(out, "{pad}}}");
    }
}

/// Every local a block assigns a constant to, with the constants.
fn constants_assigned(stmts: &[Stmt], found: &mut HashMap<usize, HashSet<i32>>) {
    for stmt in stmts {
        match stmt {
            Stmt::Assign(Var::Local(i), Expr::Const(n)) => {
                found.entry(*i).or_default().insert(*n);
            }
            Stmt::If {
                then, otherwise, ..
            } => {
                constants_assigned(then, found);
                if let Some(otherwise) = otherwise {
                    constants_assigned(otherwise, found);
                }
            }
            Stmt::While { body, .. } => constants_assigned(body, found),
            _ => {}
        }
    }
}

/// Engine callins whose arguments are a piece the script hands back, such as
/// `QueryWeapon1`, which sets its one argument to the piece to fire from.
fn returns_pieces(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("query") || name.starts_with("aimfrom") || name == "sweetspot"
}

/// The names the engine's own callins conventionally give their arguments.
fn callin_args(name: &str) -> &'static [&'static str] {
    let name = name.to_lowercase();
    if name.starts_with("aimweapon")
        || matches!(
            name.as_str(),
            "aimprimary" | "aimsecondary" | "aimtertiary" | "startbuilding"
        )
    {
        &["heading", "pitch"]
    } else if name == "killed" {
        &["severity", "corpsetype"]
    } else if name == "hitbyweapon" || name == "rockunit" {
        &["anglex", "anglez"]
    } else {
        &[]
    }
}

/// `base`, then `base_2`, `base_3` and so on until one is free.
fn unique(base: &str, taken: &mut HashSet<String>) -> String {
    let mut name = base.to_string();
    let mut n = 2;
    while taken.contains(&name.to_lowercase()) {
        name = format!("{base}_{n}");
        n += 1;
    }
    taken.insert(name.to_lowercase());
    name
}

fn listing(code: &[u32], ins: Option<&[Ins]>) -> Vec<String> {
    match ins {
        Some(ins) => ins
            .iter()
            .map(|i| {
                let args: Vec<String> = i.args.iter().map(u32::to_string).collect();
                format!("{:04}  {} {}", i.at, i.op, args.join(", "))
                    .trim_end()
                    .to_string()
            })
            .collect(),
        None => code
            .iter()
            .enumerate()
            .map(|(i, w)| match mnemonic(*w) {
                Some(op) => format!("{i:04}  {op}"),
                None => format!("{i:04}  .word {w}"),
            })
            .collect(),
    }
}

/// Names for one script's locals, and which of them hold a piece.
///
/// The first `arg_count` are its arguments. A callin the engine hands a piece
/// back through gets its argument named after that piece, and the callins whose
/// arguments the engine fills in get the names those arguments have always had.
fn local_names(
    script: &str,
    arg_count: usize,
    total: usize,
    stmts: &[Stmt],
    pieces: &[String],
    taken: &HashSet<String>,
) -> (Vec<String>, HashSet<usize>) {
    let holds_pieces = returns_pieces(script);
    let mut assigned = HashMap::new();
    if holds_pieces {
        constants_assigned(stmts, &mut assigned);
    }
    let known = callin_args(script);
    let mut taken = taken.clone();
    let mut piece_locals = HashSet::new();
    let mut names = Vec::new();
    let mut declared = 0;
    for i in 0..total {
        let base = if i >= arg_count {
            declared += 1;
            format!("local{}", declared - 1)
        } else {
            if holds_pieces {
                piece_locals.insert(i);
            }
            let only_piece = assigned
                .get(&i)
                .filter(|values| values.len() == 1)
                .and_then(|values| values.iter().next())
                .and_then(|n| pieces.get(*n as usize));
            match (only_piece, known.get(i)) {
                (Some(piece), _) => format!("{piece}_piece"),
                (None, _) if holds_pieces => "piecenum".to_string(),
                (None, Some(known)) => (*known).to_string(),
                (None, None) => format!("arg{i}"),
            }
        };
        names.push(unique(&base, &mut taken));
    }
    (names, piece_locals)
}

pub fn decompile(buf: &[u8]) -> Result<Decompiled, String> {
    let decoded = cob::decode(buf)?;
    let pieces = &decoded.pieces;
    let functions: Vec<String> = decoded.scripts.iter().map(|(n, _)| n.clone()).collect();

    let mut taken: HashSet<String> = pieces.iter().map(|p| p.to_lowercase()).collect();
    let statics: Vec<String> = (0..decoded.header.num_static_vars)
        .map(|i| unique(&format!("static{i}"), &mut taken))
        .collect();

    let decoded_ins: Vec<Result<(Vec<Ins>, usize), String>> = decoded
        .scripts
        .iter()
        .map(|(_, code)| instructions(code))
        .collect();

    // How many arguments each script is called with inside the file.
    let mut called_with: HashMap<usize, usize> = HashMap::new();
    for ins in decoded_ins.iter().flatten().flat_map(|(ins, _)| ins) {
        if matches!(
            ins.op,
            "CALL_SCRIPT" | "REAL_CALL" | "LUA_CALL" | "START_SCRIPT"
        ) {
            let entry = called_with.entry(ins.args[0] as usize).or_default();
            *entry = (*entry).max(ins.args[1] as usize);
        }
    }

    // The scripts are written into `scripts` first, because the names they ask
    // the engine about are only known once they have all been through the
    // printer, and they are defined above everything.
    let mut scripts = String::new();
    let mut warnings = Vec::new();
    let named_values: RefCell<BTreeMap<i32, String>> = RefCell::new(BTreeMap::new());

    for (index, (name, code)) in decoded.scripts.iter().enumerate() {
        let _ = writeln!(scripts);
        let (ins, trailing) = match &decoded_ins[index] {
            Ok((ins, trailing)) => (ins, *trailing),
            Err(e) => {
                write_failed(&mut scripts, &mut warnings, name, e, &listing(code, None));
                continue;
            }
        };

        // Arguments are the locals made before anything else runs. A script
        // called inside the file takes as many as its callers pass.
        let leading = ins
            .iter()
            .take_while(|i| i.op == "CREATE_LOCAL_VAR")
            .count();
        let arg_count = called_with
            .get(&index)
            .map_or(leading, |n| (*n).min(leading));

        let mut body = Body {
            ins,
            index: ins.iter().enumerate().map(|(k, i)| (i.at, k)).collect(),
            start: decoded.offsets[index],
            // Where the code ends, which is before any data after it.
            len: code.len() - trailing,
            pieces: pieces.len(),
            statics: statics.len(),
            functions: functions.len(),
            locals: arg_count,
        };
        let stmts = match body.block(arg_count, ins.len()) {
            Ok(stmts) => stmts,
            Err(e) => {
                write_failed(
                    &mut scripts,
                    &mut warnings,
                    name,
                    &e,
                    &listing(code, Some(ins)),
                );
                continue;
            }
        };

        let (locals, piece_locals) =
            local_names(name, arg_count, body.locals, &stmts, pieces, &taken);

        let printer = Printer {
            pieces,
            statics: &statics,
            functions: &functions,
            locals,
            piece_locals,
            named_values: &named_values,
        };
        let _ = writeln!(
            scripts,
            "{name}({})\n{{",
            printer.locals[..arg_count].join(", ")
        );
        if trailing > 0 {
            warnings.push(format!(
                "{name} is followed by {trailing} words that are not code, which are left out."
            ));
            let _ = writeln!(
                scripts,
                "\t// {trailing} words after this script are not code, and are left out. A\n\t// compiler stamping its own name into the file looks like this."
            );
        }
        printer.block(&stmts, 1, &mut scripts);
        let _ = writeln!(scripts, "}}");
    }

    let mut out = String::new();
    let _ = writeln!(
        out,
        "// Decompiled by coilbox from a COB v{} file. A COB does not keep variable",
        decoded.header.version
    );
    let _ = writeln!(out, "// names, so the ones below are made up.");
    let named_values = named_values.into_inner();
    if !named_values.is_empty() {
        let _ = writeln!(
            out,
            "\n// What this script asks the engine about, by the engine's own names."
        );
        for (id, name) in &named_values {
            let _ = writeln!(out, "#define {name} {id}");
        }
    }
    if !pieces.is_empty() {
        let _ = writeln!(out, "\npiece {};", pieces.join(", "));
    }
    if !statics.is_empty() {
        let _ = writeln!(out, "\nstatic-var {};", statics.join(", "));
    }
    out.push_str(&scripts);

    Ok(Decompiled {
        source: out,
        warnings,
    })
}

fn write_failed(
    out: &mut String,
    warnings: &mut Vec<String>,
    name: &str,
    reason: &str,
    listing: &[String],
) {
    warnings.push(format!("{name} could not be written as BOS: {reason}."));
    let _ = writeln!(out, "{name}()\n{{");
    let _ = writeln!(
        out,
        "\t// coilbox could not write this script as BOS: {reason}. Its disassembly:"
    );
    for line in listing {
        let _ = writeln!(out, "\t// {line}");
    }
    let _ = writeln!(out, "\tdecompile_failed;\n}}");
}
