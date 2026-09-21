//! BOS unit scripts to Lua unit scripts.
//!
//! The Lua it writes runs as it is. It keeps the BOS's comments, pulls in its
//! `#include`s, and does the arithmetic the COB interpreter does: whole numbers
//! in 65536ths of a turn and of an elmo, truncating division, zero as false.
//! Those are converted where the numbers meet the engine, so a `turn` reads as
//! a `Turn` in radians and a call-in that is handed radians gets them back in
//! the BOS's units.
//!
//! Three pieces, each in its own module: [`pp`] preprocesses, [`parse`] builds
//! a tree with the comments on it, and [`emit`] writes the Lua.

mod emit;
mod lex;
mod lint;
mod parse;
mod pp;

use std::collections::{HashMap, HashSet, VecDeque};

pub use lint::{lint, Diagnostic, LintOptions, Severity};

pub struct Conversion {
    pub lua: String,
    /// Anything the Lua may do differently from the BOS, and any include that
    /// could not be found. Empty for a script that converted exactly.
    pub warnings: Vec<String>,
    /// Whether the Lua keeps shared unit values as rules params. A game running
    /// it also wants [`COB_VARS_POLYFILL`] if its gadgets or widgets set or
    /// read them.
    pub shared_values: bool,
    /// The includes that could not be found, as the script names them. Each
    /// is also a warning. A caller with no way to supply them, such as a
    /// pasted script, can treat any as a failure.
    pub missing_includes: Vec<String>,
}

pub struct Options<'a> {
    /// The script's own path, such as `scripts/urccom2.bos`. Includes are
    /// looked for beside it.
    pub name: &'a str,
    /// Files the script may include, by path. Looked up regardless of case and
    /// of which way the slashes lean, as the BOS compilers look them up.
    pub includes: &'a HashMap<String, String>,
    /// The model's piece names, when known. BOS matches piece names regardless
    /// of case and Lua does not, so the Lua asks for each piece by the model's
    /// own spelling.
    pub pieces: Option<&'a [String]>,
    /// What `[1]` means in 65536ths of an elmo: [`MODERN_LINEAR`] or
    /// [`SCRIPTOR_LINEAR`]. The BOS alone cannot say, the `.cob` it was
    /// compiled to can: see [`linear_scale`].
    pub linear_scale: i64,
    /// How tightly each operator binds, which also depends on the compiler.
    /// The `.cob` can say: see [`precedence`].
    pub precedence: Precedence,
    /// Whether to leave out what nothing uses: a header's functions that are
    /// never called, and the constants, variables and pieces nothing names.
    /// A function in the script's own file always stays, because a gadget may
    /// call it by name. Off writes everything, to compare against.
    pub prune: bool,
}

/// Which compiler's operator precedence a script was written for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Precedence {
    /// Today's compilers, with C's levels: `a || b && c` is `a || (b && c)`.
    #[default]
    Modern,
    /// Scriptor's five levels, read left to right, so `a || b && c` is
    /// `(a || b) && c`. Balanced Annihilation's `armss.cob` was compiled so.
    Scriptor,
}

/// `[1]` as today's compilers write it, one elmo.
pub const MODERN_LINEAR: i64 = 65536;

/// `[1]` as Scriptor wrote it for Total Annihilation, two and a half elmos.
/// Older Spring games, Expand and Exterminate among them, were built with it.
pub const SCRIPTOR_LINEAR: i64 = 163840;

/// `lualibs/cob_vars.lua`, which lets a game's synced gadgets set, and its
/// gadgets and widgets read, the shared unit values a converted script keeps
/// as rules params. A game includes it from its own `LuaRules/main.lua`,
/// `LuaRules/draw.lua` and `luaui.lua`.
pub const COB_VARS_POLYFILL: &str = include_str!("cob_vars.lua");

/// Whether a Lua unit script keeps shared unit values the way a conversion
/// writes them, read from its text so a script edited after converting still
/// answers.
pub fn shares_values(lua: &str) -> bool {
    lua.contains("local cobAllied = { allied = true }")
}

/// Which of the two linear scales a `.cob` was compiled with, judged by which
/// one turns more of the BOS's `[x]` constants into numbers the `.cob` holds.
/// `None` when the BOS has no such constant or neither scale finds one.
pub fn linear_scale(source: &str, cob: &[u8]) -> Option<i64> {
    let tokens = lex::lex(source, 0);
    let mut brackets = Vec::new();
    for (i, t) in tokens.iter().enumerate() {
        if !t.is_sym("[") {
            continue;
        }
        let (negative, at) = match tokens.get(i + 1) {
            Some(n) if n.is_sym("-") => (true, i + 2),
            _ => (false, i + 1),
        };
        let value = tokens
            .get(at)
            .filter(|n| n.kind == lex::Kind::Number)
            .and_then(|n| pp::parse_number(&n.text));
        if let Some(v) = value.filter(|v| *v != 0.0) {
            if tokens.get(at + 1).is_some_and(|c| c.is_sym("]")) {
                brackets.push(if negative { -v } else { v });
            }
        }
    }
    let words: std::collections::HashSet<i32> = cob
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| i32::from_le_bytes(*w))
        .collect();
    let hits = |scale: i64| {
        brackets
            .iter()
            .filter(|v| words.contains(&(pp::scale_constant(false, **v, scale) as i32)))
            .count()
    };
    let (modern, scriptor) = (hits(MODERN_LINEAR), hits(SCRIPTOR_LINEAR));
    match modern.cmp(&scriptor) {
        std::cmp::Ordering::Greater => Some(MODERN_LINEAR),
        std::cmp::Ordering::Less => Some(SCRIPTOR_LINEAR),
        std::cmp::Ordering::Equal => None,
    }
}

/// Which operator precedence a `.cob` was compiled with, judged by the
/// expressions in the BOS that the two read differently, such as
/// `a || b && c`, and which order the `.cob` does their operators in. `None`
/// when the BOS has no such expression or the `.cob` shows neither order.
///
/// Only an expression of three plain names or numbers counts, with no operator
/// either side of it, so its opcodes sit together in the `.cob`: pushes, then
/// `&&` then `||` for [`Precedence::Modern`], or `||`, one more push and `&&`
/// for [`Precedence::Scriptor`].
pub fn precedence(source: &str, cob: &[u8]) -> Option<Precedence> {
    const PUSHES: [u32; 3] = [0x1002_1001, 0x1002_1002, 0x1002_1004];
    let tokens: Vec<lex::Token> = lex::lex(source, 0)
        .into_iter()
        .filter(|t| !t.is_comment())
        .collect();
    let words: Vec<u32> = cob
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_le_bytes(*w))
        .collect();
    let op = |t: &lex::Token| {
        matches!(t.kind, lex::Kind::Sym | lex::Kind::Ident)
            .then(|| pp::binding(&t.text, Precedence::Modern))
            .flatten()
    };
    let operand =
        |t: &lex::Token| matches!(t.kind, lex::Kind::Ident | lex::Kind::Number) && op(t).is_none();
    let (mut modern, mut scriptor) = (0, 0);
    for (i, w) in tokens.windows(5).enumerate() {
        let [a, op1, b, op2, c] = w else { continue };
        let before = i.checked_sub(1).and_then(|at| tokens.get(at));
        // A `(` after the last one would make it `get`'s arguments.
        let after = tokens.get(i + 5);
        if ![a, b, c].into_iter().all(operand)
            || before.is_some_and(|t| op(t).is_some())
            || after.is_some_and(|t| op(t).is_some() || t.is_sym("("))
        {
            continue;
        }
        let (Some(code1), Some(code2)) = (opcode(&op1.text), opcode(&op2.text)) else {
            continue;
        };
        let tighter = |p| pp::binding(&op2.text, p) > pp::binding(&op1.text, p);
        if !tighter(Precedence::Modern) || tighter(Precedence::Scriptor) {
            continue;
        }
        if words.windows(2).any(|w| w == [code2, code1]) {
            modern += 1;
        }
        if words
            .windows(4)
            .any(|w| w[0] == code1 && PUSHES.contains(&w[1]) && w[3] == code2)
        {
            scriptor += 1;
        }
    }
    match modern.cmp(&scriptor) {
        std::cmp::Ordering::Greater => Some(Precedence::Modern),
        std::cmp::Ordering::Less => Some(Precedence::Scriptor),
        std::cmp::Ordering::Equal => None,
    }
}

/// The opcode a binary operator compiles to.
fn opcode(op: &str) -> Option<u32> {
    Some(match op.to_ascii_lowercase().as_str() {
        "+" => 0x1003_1000,
        "-" => 0x1003_2000,
        "*" => 0x1003_3000,
        "/" => 0x1003_4000,
        "%" => 0x1003_4001,
        "&" => 0x1003_5000,
        "|" => 0x1003_6000,
        "^" => 0x1003_7000,
        "<" => 0x1005_1000,
        "<=" => 0x1005_2000,
        ">" => 0x1005_3000,
        ">=" => 0x1005_4000,
        "==" => 0x1005_5000,
        "!=" => 0x1005_6000,
        "&&" | "and" => 0x1005_7000,
        "||" | "or" => 0x1005_8000,
        "^^" | "xor" => 0x1005_9000,
        _ => return None,
    })
}

/// A script preprocessed and parsed, the common step [`convert`] and
/// [`lint::lint`] both start from.
struct Parsed {
    items: Vec<parse::Item>,
    pre: pp::Output,
}

/// Preprocesses and parses a script exactly as [`convert`] does: the same
/// include resolution, the same linear scale and precedence, and the same
/// wording when parsing fails.
fn preprocess_and_parse(
    source: &str,
    name: &str,
    includes: &HashMap<String, String>,
    linear_scale: i64,
    precedence: Precedence,
) -> Result<Parsed, String> {
    let includes: HashMap<String, (String, String)> = includes
        .iter()
        .map(|(path, text)| (normalise(path), (path.clone(), text.clone())))
        .collect();
    let resolve = |wanted: &str, from: &str| {
        candidates(wanted, from)
            .iter()
            .find_map(|candidate| includes.get(candidate).cloned())
    };
    let pre = pp::preprocess(source, name, &resolve, linear_scale, precedence);
    let items = parse::parse(&pre.tokens, linear_scale, precedence).map_err(|e| {
        // Often the reason: a macro defined in a header nobody supplied.
        match pre.missing.as_slice() {
            [] => format!("{name}: {e}"),
            missing => format!(
                "{name}: {e}. It includes {}, which could not be found, so anything defined there is missing.",
                missing.join(", ")
            ),
        }
    })?;
    Ok(Parsed { items, pre })
}

pub fn convert(source: &str, options: &Options) -> Result<Conversion, String> {
    let Parsed { items, pre } = preprocess_and_parse(
        source,
        options.name,
        options.includes,
        options.linear_scale,
        options.precedence,
    )?;
    emit::emit(&items, &pre, options)
}

/// Where `wanted` is looked for when the file at `from` includes it, in order:
/// beside that file, at the root, then under `scripts/`.
fn candidates(wanted: &str, from: &str) -> [String; 3] {
    let dir = normalise(from)
        .rsplit_once('/')
        .map(|(dir, _)| format!("{dir}/"))
        .unwrap_or_default();
    let wanted = normalise(wanted);
    [
        format!("{dir}{wanted}"),
        wanted.clone(),
        format!("scripts/{wanted}"),
    ]
}

/// How many levels of `#include` [`find_includes`] follows. A header including
/// a header is ordinary and a third level is rare. It also stops two files that
/// include each other, along with the seen set.
const INCLUDE_DEPTH: u32 = 4;

/// Most files [`find_includes`] reads for one script, so a script naming files
/// in a loop cannot pull in a whole game.
const MAX_INCLUDES: usize = 32;

/// A file a script includes, as [`find_includes`] found it.
pub struct Include {
    /// The name the script wrote.
    pub name: String,
    /// Where it was found, as `read` spelled it. This is its key in
    /// [`Options::includes`].
    pub path: String,
    pub text: String,
}

/// Every file `source` includes, and every file those include.
///
/// `name` is the script's own path, as [`convert`] is given it. `read` is handed
/// each path [`convert`] would look in, lower case with forward slashes, and
/// returns the file's own path and text when there is a file there. A game
/// archive and a folder on disk both find includes through here, so a script
/// that converts from one converts from the other.
///
/// Breadth first, so the files a script names itself are read before the ones
/// a header names. A name found nowhere is left out, and [`convert`] reports it.
pub fn find_includes(
    source: &str,
    name: &str,
    mut read: impl FnMut(&str) -> Option<(String, String)>,
) -> Vec<Include> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    let mut queue: VecDeque<(String, String, u32)> = include_names(source)
        .into_iter()
        .map(|wanted| (wanted, name.to_string(), 1))
        .collect();
    while let Some((wanted, from, depth)) = queue.pop_front() {
        if found.len() >= MAX_INCLUDES {
            break;
        }
        let Some((path, text)) = candidates(&wanted, &from).iter().find_map(|c| read(c)) else {
            continue;
        };
        if !seen.insert(normalise(&path)) {
            continue;
        }
        if depth < INCLUDE_DEPTH {
            queue.extend(
                include_names(&text)
                    .into_iter()
                    .map(|next| (next, path.clone(), depth + 1)),
            );
        }
        found.push(Include {
            name: wanted,
            path,
            text,
        });
    }
    found
}

/// The names a file asks for with `#include`, in order. Only a directive at
/// the start of a line counts, so one commented out with `//` is not read.
fn include_names(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let rest = line.trim_start().strip_prefix('#')?.trim_start();
            let rest = rest.strip_prefix("include")?.trim_start();
            let close = match rest.chars().next()? {
                '"' => '"',
                '<' => '>',
                _ => return None,
            };
            let (name, _) = rest[1..].split_once(close)?;
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

/// A path as the lookup compares it: lower case, forward slashes, no `./`,
/// and a `..` taken back out with the folder before it, since a game archive
/// has no `..` to follow.
fn normalise(path: &str) -> String {
    let lower = path.replace('\\', "/").to_lowercase();
    let mut parts: Vec<&str> = Vec::new();
    for part in lower.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}
