//! Edits one value inside a Lua table constructor and leaves every other byte
//! of the file as it was.
//!
//! `mapinfo.lua` is a file a mapper edits by hand: comments, layout, computed
//! values and `VFS.Include` calls all have to survive a re-compile. Evaluating
//! the file and writing the result back would flatten all of that, so this
//! module finds the span of the one value to change and splices new text in.
//!
//! It lexes the file (strings, long brackets and comments are skipped as
//! tokens, so a `--` or `{` inside a string never confuses it) and parses only
//! table constructors: each field's key and the byte span of its value. A value
//! that is not a table constructor is skipped as an opaque expression. It is
//! not a Lua parser and does not check the file is valid Lua.
//!
//! The root table is the one the file returns: `return { ... }`, or
//! `return name` where `name = { ... }` is a top level assignment.

/// One step of a path into nested tables.
#[derive(Debug, Clone, PartialEq)]
pub enum Key {
    /// A string key, matched ignoring case because the engine lowercases every
    /// key of `mapinfo.lua` when it loads the file.
    Name(String),
    /// An integer key, as in `teams = { [0] = ... }`.
    Index(i64),
}

impl Key {
    fn matches(&self, other: &Key) -> bool {
        match (self, other) {
            (Key::Name(a), Key::Name(b)) => a.eq_ignore_ascii_case(b),
            (Key::Index(a), Key::Index(b)) => a == b,
            _ => false,
        }
    }

    fn render(&self) -> String {
        match self {
            Key::Name(n) if is_identifier(n) => n.clone(),
            Key::Name(n) => format!("[{}]", quote(n)),
            Key::Index(i) => format!("[{i}]"),
        }
    }

    fn describe(&self) -> String {
        match self {
            Key::Name(n) => n.clone(),
            Key::Index(i) => format!("[{i}]"),
        }
    }
}

/// A value to write.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Num(f64),
    Str(String),
    Bool(bool),
    /// A list of numbers, written on one line: `{0.1, 0.2, 0.3}`.
    Array(Vec<f64>),
    Table(Vec<(Key, Val)>),
}

/// What to do when the key is already in the file.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    /// Replace the existing value.
    Set,
    /// Leave the existing value, and add the key only when it is missing.
    Default,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Name,
    Number,
    Str,
    Sym,
}

#[derive(Clone, Copy, Debug)]
struct Tok {
    kind: Kind,
    start: usize,
    end: usize,
}

struct Field {
    key: Option<Key>,
    /// First byte of the field (its key, or its value when it has none).
    start: usize,
    v_start: usize,
    v_end: usize,
    /// End of the field including a `,` or `;` that directly follows it.
    end: usize,
    /// The value, when it is a table constructor on its own.
    table: Option<Table>,
}

struct Table {
    open: usize,
    close: usize,
    fields: Vec<Field>,
}

fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !matches!(
            s,
            "and"
                | "break"
                | "do"
                | "else"
                | "elseif"
                | "end"
                | "false"
                | "for"
                | "function"
                | "goto"
                | "if"
                | "in"
                | "local"
                | "nil"
                | "not"
                | "or"
                | "repeat"
                | "return"
                | "then"
                | "true"
                | "until"
                | "while"
        )
}

/// A Lua string literal for `s`.
pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\{:03}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

// ---- lexer -----------------------------------------------------------------

/// The `=` count of a long bracket opening at `b[i]` (`[[` is 0, `[==[` is 2).
fn long_bracket_level(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while b.get(j) == Some(&b'=') {
        j += 1;
    }
    (b.get(j) == Some(&b'[')).then(|| j - i - 1)
}

/// Index just past the long bracket that opens at `b[i]` with `level` `=` signs.
fn skip_long(b: &[u8], i: usize, level: usize) -> Result<usize, String> {
    let mut close = vec![b']'];
    close.extend(std::iter::repeat_n(b'=', level));
    close.push(b']');
    let from = i + level + 2;
    b.get(from..)
        .and_then(|rest| {
            rest.windows(close.len())
                .position(|w| w == close.as_slice())
        })
        .map(|p| from + p + close.len())
        .ok_or_else(|| "unterminated long bracket in mapinfo.lua".to_string())
}

/// The value of every string literal in `src`, in file order: quoted strings
/// with a backslash taking the next character as it is, and long bracket
/// strings without their brackets. Comments are skipped. Escapes beyond that
/// (`\n`, `\065`) are not interpreted, which is enough for the file names this
/// is used to find.
pub fn string_literals(src: &str) -> Result<Vec<String>, String> {
    Ok(lex(src)?
        .into_iter()
        .filter(|t| t.kind == Kind::Str)
        .map(|t| {
            let raw = &src[t.start..t.end];
            if let Some(after) = raw.strip_prefix('[') {
                let level = after.bytes().take_while(|&c| c == b'=').count();
                let body = &raw[level + 2..raw.len() - level - 2];
                body.strip_prefix('\n').unwrap_or(body).to_string()
            } else {
                let mut out = String::new();
                let mut chars = raw[1..raw.len() - 1].chars();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => out.extend(chars.next()),
                        c => out.push(c),
                    }
                }
                out
            }
        })
        .collect())
}

fn lex(src: &str) -> Result<Vec<Tok>, String> {
    let b = src.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if c == b'-' && b.get(i + 1) == Some(&b'-') {
            if b.get(i + 2) == Some(&b'[') {
                if let Some(level) = long_bracket_level(b, i + 2) {
                    i = skip_long(b, i + 2, level)?;
                    continue;
                }
            }
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        let start = i;
        if c == b'"' || c == b'\'' {
            i += 1;
            loop {
                match b.get(i) {
                    None | Some(b'\n') => return Err("unterminated string in mapinfo.lua".into()),
                    Some(b'\\') => i += 2,
                    Some(&q) if q == c => {
                        i += 1;
                        break;
                    }
                    Some(_) => i += 1,
                }
            }
            out.push(Tok {
                kind: Kind::Str,
                start,
                end: i,
            });
            continue;
        }
        if c == b'[' {
            if let Some(level) = long_bracket_level(b, i) {
                i = skip_long(b, i, level)?;
                out.push(Tok {
                    kind: Kind::Str,
                    start,
                    end: i,
                });
                continue;
            }
        }
        if c.is_ascii_digit() || (c == b'.' && b.get(i + 1).is_some_and(u8::is_ascii_digit)) {
            let hex = c == b'0' && matches!(b.get(i + 1), Some(b'x' | b'X'));
            if hex {
                i += 2;
            }
            while let Some(&d) = b.get(i) {
                let exponent_sign = (d == b'+' || d == b'-')
                    && i > start
                    && if hex {
                        matches!(b[i - 1], b'p' | b'P')
                    } else {
                        matches!(b[i - 1], b'e' | b'E')
                    };
                if d.is_ascii_alphanumeric() || d == b'.' || d == b'_' || exponent_sign {
                    i += 1;
                } else {
                    break;
                }
            }
            out.push(Tok {
                kind: Kind::Number,
                start,
                end: i,
            });
            continue;
        }
        if c.is_ascii_alphabetic() || c == b'_' {
            while b
                .get(i)
                .is_some_and(|d| d.is_ascii_alphanumeric() || *d == b'_')
            {
                i += 1;
            }
            out.push(Tok {
                kind: Kind::Name,
                start,
                end: i,
            });
            continue;
        }
        if c >= 0x80 {
            return Err("unexpected non ASCII character outside a string in mapinfo.lua".into());
        }
        let three = b.get(i..i + 3) == Some(b"...");
        let two = matches!(
            b.get(i..i + 2),
            Some(b"==" | b"~=" | b"<=" | b">=" | b".." | b"::" | b"//" | b"<<" | b">>")
        );
        i += if three {
            3
        } else if two {
            2
        } else {
            1
        };
        out.push(Tok {
            kind: Kind::Sym,
            start,
            end: i,
        });
    }
    Ok(out)
}

/// How many `(`, `{`, `[`, `function`, `if`, `do` and `repeat` are open before
/// each token. A separator or closing brace that ends a field sits at the same
/// level as the field's first token, whatever the field's value contains.
fn levels(src: &str, toks: &[Tok]) -> Vec<usize> {
    let mut depth = 0usize;
    let mut out = Vec::with_capacity(toks.len());
    for t in toks {
        out.push(depth);
        match (t.kind, &src[t.start..t.end]) {
            (Kind::Sym, "(" | "{" | "[") => depth += 1,
            (Kind::Sym, ")" | "}" | "]") => depth = depth.saturating_sub(1),
            (Kind::Name, "function" | "if" | "do" | "repeat") => depth += 1,
            (Kind::Name, "end" | "until") => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    out
}

// ---- parser ----------------------------------------------------------------

struct Ctx<'a> {
    src: &'a str,
    toks: Vec<Tok>,
    lv: Vec<usize>,
}

impl Ctx<'_> {
    fn text(&self, i: usize) -> &str {
        let t = self.toks[i];
        &self.src[t.start..t.end]
    }

    fn is_sym(&self, i: usize, s: &str) -> bool {
        self.toks
            .get(i)
            .is_some_and(|t| t.kind == Kind::Sym && &self.src[t.start..t.end] == s)
    }

    fn is_name(&self, i: usize, s: &str) -> bool {
        self.toks
            .get(i)
            .is_some_and(|t| t.kind == Kind::Name && &self.src[t.start..t.end] == s)
    }

    /// The key that begins at token `j`, and the token its value starts at.
    fn key_at(&self, j: usize) -> Result<(Option<Key>, usize), String> {
        let t = self.toks[j];
        if t.kind == Kind::Name && self.is_sym(j + 1, "=") {
            return Ok((Some(Key::Name(self.text(j).to_string())), j + 2));
        }
        if self.is_sym(j, "[") {
            let close = (j + 1..self.toks.len())
                .find(|&k| self.lv[k] == self.lv[j] + 1 && self.is_sym(k, "]"))
                .ok_or("unterminated `[` key in mapinfo.lua")?;
            if !self.is_sym(close + 1, "=") {
                return Err("expected `=` after a `[key]` in mapinfo.lua".into());
            }
            let key = if close == j + 2 {
                let inner = self.text(j + 1);
                match self.toks[j + 1].kind {
                    Kind::Number => inner
                        .parse::<f64>()
                        .ok()
                        .filter(|n| n.fract() == 0.0)
                        .map(|n| Key::Index(n as i64)),
                    Kind::Str => {
                        let body = &inner[1..inner.len() - 1];
                        (!body.contains('\\')
                            && (inner.starts_with('"') || inner.starts_with('\'')))
                        .then(|| Key::Name(body.to_string()))
                    }
                    _ => None,
                }
            } else {
                None
            };
            return Ok((key, close + 2));
        }
        Ok((None, j))
    }

    /// Index of the first token at or after `from` that ends a field: a `,`,
    /// `;` or the closing `}`, at table level `base`.
    fn expr_end(&self, from: usize, base: usize) -> Result<usize, String> {
        (from..self.toks.len())
            .find(|&k| {
                self.lv[k] == base
                    && self.toks[k].kind == Kind::Sym
                    && matches!(self.text(k), "," | ";" | "}")
            })
            .ok_or_else(|| "unterminated table in mapinfo.lua".to_string())
    }

    /// Parse the table constructor whose `{` is token `t`. Returns it with the
    /// index of the token after its closing `}`.
    fn table(&self, t: usize) -> Result<(Table, usize), String> {
        let base = self.lv[t] + 1;
        let mut j = t + 1;
        let mut fields = Vec::new();
        loop {
            let tok = *self
                .toks
                .get(j)
                .ok_or("unterminated table in mapinfo.lua")?;
            if self.lv[j] == base && self.is_sym(j, "}") {
                let table = Table {
                    open: self.toks[t].start,
                    close: tok.start,
                    fields,
                };
                return Ok((table, j + 1));
            }
            if self.lv[j] == base && (self.is_sym(j, ",") || self.is_sym(j, ";")) {
                j += 1;
                continue;
            }
            let (key, vi) = self.key_at(j)?;
            let ve = self.expr_end(vi, base)?;
            if ve == vi {
                return Err("a field in mapinfo.lua has no value".into());
            }
            let table = if self.is_sym(vi, "{") {
                let (tbl, after) = self.table(vi)?;
                (after == ve).then_some(tbl)
            } else {
                None
            };
            let v_start = self.toks[vi].start;
            let v_end = self.toks[ve - 1].end;
            let (end, next) = if self.is_sym(ve, ",") || self.is_sym(ve, ";") {
                (self.toks[ve].end, ve + 1)
            } else {
                (v_end, ve)
            };
            fields.push(Field {
                key,
                start: tok.start,
                v_start,
                v_end,
                end,
                table,
            });
            j = next;
        }
    }

    /// The table the file returns.
    fn root(&self) -> Result<Table, String> {
        const NO_ROOT: &str =
            "mapinfo.lua does not return a table written out in the file, so it cannot be edited";
        let ret = (0..self.toks.len())
            .rev()
            .find(|&i| self.lv[i] == 0 && self.is_name(i, "return"))
            .ok_or(NO_ROOT)?;
        if self.is_sym(ret + 1, "{") {
            return self.table(ret + 1).map(|(t, _)| t);
        }
        let named = self.toks.get(ret + 1).is_some_and(|t| t.kind == Kind::Name)
            && self
                .toks
                .get(ret + 2)
                .is_none_or(|_| self.is_sym(ret + 2, ";"));
        if !named {
            return Err(NO_ROOT.into());
        }
        let name = self.text(ret + 1);
        let at = (0..ret)
            .find(|&i| {
                self.lv[i] == 0
                    && self.is_name(i, name)
                    && self.is_sym(i + 1, "=")
                    && self.is_sym(i + 2, "{")
            })
            .ok_or(NO_ROOT)?;
        self.table(at + 2).map(|(t, _)| t)
    }
}

// ---- rendering -------------------------------------------------------------

struct Style<'a> {
    indent: &'a str,
    unit: &'a str,
    nl: &'a str,
    multiline: bool,
}

fn render_value(v: &Val, s: &Style) -> String {
    match v {
        Val::Num(n) => number(*n),
        Val::Str(t) => quote(t),
        Val::Bool(b) => b.to_string(),
        Val::Array(a) => format!(
            "{{{}}}",
            a.iter().map(|n| number(*n)).collect::<Vec<_>>().join(", ")
        ),
        Val::Table(entries) if entries.is_empty() => "{}".into(),
        Val::Table(entries) if s.multiline => {
            let inner = format!("{}{}", s.indent, s.unit);
            let inner_style = Style {
                indent: &inner,
                ..*s
            };
            let mut out = format!("{{{}", s.nl);
            for (k, val) in entries {
                out.push_str(&format!(
                    "{inner}{} = {},{}",
                    k.render(),
                    render_value(val, &inner_style),
                    s.nl
                ));
            }
            out.push_str(s.indent);
            out.push('}');
            out
        }
        Val::Table(entries) => format!(
            "{{ {} }}",
            entries
                .iter()
                .map(|(k, val)| format!("{} = {}", k.render(), render_value(val, s)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

fn line_start(src: &str, pos: usize) -> usize {
    src[..pos].rfind('\n').map_or(0, |i| i + 1)
}

fn leading_ws(src: &str, pos: usize) -> &str {
    let ls = line_start(src, pos);
    let rest = &src[ls..];
    let n = rest.len() - rest.trim_start_matches([' ', '\t']).len();
    &rest[..n]
}

fn splice(src: &str, at: usize, remove: usize, with: &str) -> String {
    format!("{}{}{}", &src[..at], with, &src[at + remove..])
}

fn find_field<'a>(t: &'a Table, key: &Key) -> Option<&'a Field> {
    t.fields
        .iter()
        .rev()
        .find(|f| f.key.as_ref().is_some_and(|k| k.matches(key)))
}

fn replace_value(src: &str, f: &Field, val: &Val) -> String {
    let current = &src[f.v_start..f.v_end];
    let style = Style {
        indent: "",
        unit: "",
        nl: "\n",
        multiline: false,
    };
    let new = render_value(val, &style);
    let same_number = match val {
        Val::Num(n) => current.parse::<f64>().is_ok_and(|c| c == *n),
        _ => false,
    };
    if current == new || same_number {
        return src.to_string();
    }
    splice(src, f.v_start, f.v_end - f.v_start, &new)
}

/// Add `key = val` as the last field of `table`, in the layout the table
/// already uses.
fn insert_field(src: &str, table: &Table, key: &Key, val: &Val) -> String {
    let nl = if src.contains("\r\n") { "\r\n" } else { "\n" };
    let close_ls = line_start(src, table.close);
    let close_indent = &src[close_ls..table.close];
    let multiline = close_indent.trim_matches([' ', '\t']).is_empty();

    if multiline {
        let (indent, unit) = match table.fields.last() {
            Some(last) => {
                let indent = leading_ws(src, last.start);
                let unit = indent
                    .strip_prefix(close_indent)
                    .filter(|u| !u.is_empty())
                    .unwrap_or("    ");
                (indent.to_string(), unit.to_string())
            }
            None => (format!("{close_indent}    "), "    ".to_string()),
        };
        let style = Style {
            indent: &indent,
            unit: &unit,
            nl,
            multiline: true,
        };
        let text = format!("{indent}{} = {},", key.render(), render_value(val, &style));
        let Some(last) = table.fields.last() else {
            return splice(src, close_ls, 0, &format!("{text}{nl}"));
        };
        let mut eol = src[last.end..]
            .find('\n')
            .map_or(table.close, |p| last.end + p);
        if eol > last.end && src.as_bytes()[eol - 1] == b'\r' {
            eol -= 1;
        }
        let with_row = splice(src, eol, 0, &format!("{nl}{text}"));
        return if last.end == last.v_end {
            splice(&with_row, last.v_end, 0, ",")
        } else {
            with_row
        };
    }

    let style = Style {
        indent: "",
        unit: "",
        nl,
        multiline: false,
    };
    let text = format!("{} = {}", key.render(), render_value(val, &style));
    match table.fields.last() {
        Some(last) if last.end > last.v_end => splice(src, last.end, 0, &format!(" {text},")),
        Some(last) => splice(src, last.v_end, 0, &format!(", {text}")),
        None => splice(
            src,
            table.open + 1,
            table.close - table.open - 1,
            &format!(" {text} "),
        ),
    }
}

/// Set `val` at `path` in the table `src` returns.
///
/// Tables along the path that are missing are created. With [`Mode::Default`]
/// an existing value is kept; with [`Mode::Set`] it is replaced. A table along
/// the path that exists but is not a table constructor (`smf = loadSmf()`)
/// cannot be edited: that is an error for `Set` and a no-op for `Default`.
pub fn apply(src: &str, path: &[Key], val: &Val, mode: Mode) -> Result<String, String> {
    let toks = lex(src)?;
    let lv = levels(src, &toks);
    let cx = Ctx { src, toks, lv };
    let root = cx.root()?;
    let mut table = &root;
    for (depth, key) in path.iter().enumerate() {
        let last = depth + 1 == path.len();
        match find_field(table, key) {
            Some(f) if last => {
                return Ok(match mode {
                    Mode::Default => src.to_string(),
                    Mode::Set => replace_value(src, f, val),
                });
            }
            Some(f) => match &f.table {
                Some(inner) => table = inner,
                None if mode == Mode::Default => return Ok(src.to_string()),
                None => {
                    return Err(format!(
                        "`{}` in mapinfo.lua is not a table written out in the file, so `{}` cannot be set inside it",
                        key.describe(),
                        path.iter().map(Key::describe).collect::<Vec<_>>().join(".")
                    ))
                }
            },
            None => {
                let nested = path[depth + 1..]
                    .iter()
                    .rev()
                    .fold(val.clone(), |v, k| Val::Table(vec![(k.clone(), v)]));
                return Ok(insert_field(src, table, key, &nested));
            }
        }
    }
    Ok(src.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(s: &str) -> Key {
        Key::Name(s.into())
    }

    fn set(src: &str, path: &[Key], v: Val) -> String {
        apply(src, path, &v, Mode::Set).unwrap()
    }

    #[test]
    fn replaces_only_the_value() {
        let src = "local mapinfo = {\n    name = \"Old\", -- the name\n    smf = { minheight = -300, maxheight = 1150 },\n}\nreturn mapinfo\n";
        let out = set(src, &[n("smf"), n("maxheight")], Val::Num(900.0));
        assert_eq!(out, src.replace("1150", "900"));
    }

    #[test]
    fn matches_keys_ignoring_case_and_keeps_the_spelling() {
        let src = "return { SMF = { MaxHeight = 5 } }";
        let out = set(src, &[n("smf"), n("maxheight")], Val::Num(6.0));
        assert_eq!(out, "return { SMF = { MaxHeight = 6 } }");
    }

    #[test]
    fn leaves_an_equal_number_in_its_own_spelling() {
        let src = "return { a = 1.50, b = 2 }";
        assert_eq!(set(src, &[n("a")], Val::Num(1.5)), src);
        assert_eq!(set(src, &[n("b")], Val::Num(2.0)), src);
    }

    #[test]
    fn default_keeps_an_existing_value() {
        let src = "return { a = 1 }";
        let out = apply(src, &[n("a")], &Val::Num(2.0), Mode::Default).unwrap();
        assert_eq!(out, src);
    }

    #[test]
    fn inserts_into_a_multiline_table_after_the_last_field_and_its_comment() {
        let src = "return {\n    a = 1, -- one\n    b = 2 -- two\n}\n";
        let out = set(src, &[n("c")], Val::Num(3.0));
        assert_eq!(
            out,
            "return {\n    a = 1, -- one\n    b = 2, -- two\n    c = 3,\n}\n"
        );
    }

    #[test]
    fn inserts_into_a_single_line_table() {
        assert_eq!(
            set("return { a = 1 }", &[n("b")], Val::Num(2.0)),
            "return { a = 1, b = 2 }"
        );
        assert_eq!(
            set("return { a = 1, }", &[n("b")], Val::Num(2.0)),
            "return { a = 1, b = 2, }"
        );
        assert_eq!(
            set("return {}", &[n("b")], Val::Num(2.0)),
            "return { b = 2 }"
        );
    }

    #[test]
    fn inserts_into_an_empty_multiline_table() {
        let out = set("return {\n}\n", &[n("b")], Val::Num(2.0));
        assert_eq!(out, "return {\n    b = 2,\n}\n");
    }

    #[test]
    fn creates_missing_tables_along_the_path() {
        let out = set(
            "return {\n    a = 1,\n}\n",
            &[n("teams"), Key::Index(0), n("startPos"), n("x")],
            Val::Num(512.0),
        );
        assert_eq!(
            out,
            "return {\n    a = 1,\n    teams = {\n        [0] = {\n            startPos = {\n                x = 512,\n            },\n        },\n    },\n}\n"
        );
    }

    #[test]
    fn follows_an_integer_key() {
        let src = "return { teams = { [0] = { startPos = { x = 1, z = 2 } }, [1] = { startPos = { x = 3, z = 4 } } } }";
        let out = set(
            src,
            &[n("teams"), Key::Index(1), n("startpos"), n("z")],
            Val::Num(9.0),
        );
        assert_eq!(out, src.replace("z = 4", "z = 9"));
    }

    #[test]
    fn is_not_confused_by_strings_comments_and_calls() {
        let src = "-- return { fake = 1 }\n--[[ return { fake = 2 } ]]\nlocal s = \"} , {\"\nlocal mapinfo = {\n    description = \"a, b } -- c\",\n    computed = math.max(1, 2),\n    f = function() return 1, 2 end,\n    long = [[ } ]],\n    smf = { minheight = 1 },\n}\nreturn mapinfo\n";
        let out = set(src, &[n("smf"), n("minheight")], Val::Num(7.0));
        assert_eq!(out, src.replace("minheight = 1", "minheight = 7"));
    }

    #[test]
    fn writes_a_string_with_escapes() {
        let out = set(
            "return { a = \"x\" }",
            &[n("a")],
            Val::Str("it's \"q\"\n".into()),
        );
        assert_eq!(out, "return { a = \"it's \\\"q\\\"\\n\" }");
    }

    #[test]
    fn refuses_to_edit_inside_a_computed_table() {
        let src = "return { smf = loadSmf() }";
        let err = apply(src, &[n("smf"), n("minheight")], &Val::Num(1.0), Mode::Set).unwrap_err();
        assert!(err.contains("smf"), "{err}");
        let out = apply(
            src,
            &[n("smf"), n("minheight")],
            &Val::Num(1.0),
            Mode::Default,
        )
        .unwrap();
        assert_eq!(out, src);
    }

    #[test]
    fn refuses_a_file_that_does_not_return_a_table() {
        assert!(apply("return load()", &[n("a")], &Val::Num(1.0), Mode::Set).is_err());
        assert!(apply("x = 1", &[n("a")], &Val::Num(1.0), Mode::Set).is_err());
    }

    #[test]
    fn keeps_crlf_line_endings() {
        let out = set("return {\r\n    a = 1,\r\n}\r\n", &[n("b")], Val::Num(2.0));
        assert_eq!(out, "return {\r\n    a = 1,\r\n    b = 2,\r\n}\r\n");
    }

    #[test]
    fn reads_bracketed_string_keys() {
        let src = "return { [\"Name\"] = \"a\" }";
        assert_eq!(
            set(src, &[n("name")], Val::Str("b".into())),
            "return { [\"Name\"] = \"b\" }"
        );
    }
}
