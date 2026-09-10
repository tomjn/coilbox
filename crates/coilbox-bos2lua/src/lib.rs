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
mod parse;
mod pp;

use std::collections::HashMap;

pub struct Conversion {
    pub lua: String,
    /// Anything the Lua may do differently from the BOS, and any include that
    /// could not be found. Empty for a script that converted exactly.
    pub warnings: Vec<String>,
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
}

/// `[1]` as today's compilers write it, one elmo.
pub const MODERN_LINEAR: i64 = 65536;

/// `[1]` as Scriptor wrote it for Total Annihilation, two and a half elmos.
/// Older Spring games, Expand and Exterminate among them, were built with it.
pub const SCRIPTOR_LINEAR: i64 = 163840;

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

pub fn convert(source: &str, options: &Options) -> Result<Conversion, String> {
    let includes: HashMap<String, (String, String)> = options
        .includes
        .iter()
        .map(|(path, text)| (normalise(path), (path.clone(), text.clone())))
        .collect();
    let resolve = |wanted: &str, from: &str| {
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
        .iter()
        .find_map(|candidate| includes.get(candidate).cloned())
    };
    let pre = pp::preprocess(source, options.name, &resolve, options.linear_scale);
    let items = parse::parse(&pre.tokens, options.linear_scale)
        .map_err(|e| format!("{}: {e}", options.name))?;
    emit::emit(&items, &pre, options)
}

/// A path as the lookup compares it: lower case, forward slashes, no `./`.
fn normalise(path: &str) -> String {
    let lower = path.replace('\\', "/").to_lowercase();
    lower
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}
