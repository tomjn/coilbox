//! Total Annihilation's key-value files, read the way the engine reads them
//! and edited one value at a time.
//!
//! Older games define units in `.fbi` files and other data in `.tdf` files.
//! Each is a list of `[SECTION] { ... }` blocks holding `key=value` pairs,
//! each pair ended by a semicolon, and sections nest.
//!
//! [`parse`] follows the engine's own parser, `gamedata/parse_tdf.lua` in
//! Recoil's base content, rule for rule: `//` and `/* */` comments, a key is
//! everything up to `=` or whitespace, a value runs to the next semicolon on
//! the same line unless it is quoted, and a later key of the same name
//! replaces an earlier one. Keys and section names are matched without regard
//! to case, as the engine lowercases them.
//!
//! [`set`] changes one value by splicing it over the old one, or adds a new
//! key after the last one in its section in the same style. Nothing else in
//! the file moves. It then parses the original and the changed text and
//! refuses the change unless exactly that one key differs.
//!
//! Every function here takes text. A caller reading a file that is not UTF-8,
//! as some old game files are, goes through [`decode`] and [`Encoding::encode`]
//! so the bytes it writes back are the ones it read.

use std::collections::BTreeMap;
use std::fmt;

/// One key and its value in a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pair {
    /// The key as the file spells it.
    pub key: String,
    /// The value as the engine reads it: the quotes taken off a quoted value,
    /// anything else kept as written, trailing spaces included.
    pub value: String,
    pub key_start: usize,
    pub key_end: usize,
    /// Where the value's text is in the file, quotes included.
    pub value_start: usize,
    pub value_end: usize,
    pub quoted: bool,
    /// Just past the semicolons that end the pair.
    pub end: usize,
}

/// One `[name] { ... }` in a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    /// The name as the file spells it, without the brackets.
    pub name: String,
    /// Where the `[` is.
    pub start: usize,
    /// Where the `{` is.
    pub open: usize,
    /// Where the `}` is.
    pub close: usize,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Pair(Pair),
    Section(Section),
}

impl Entry {
    /// The key or section name as the file spells it.
    pub fn key(&self) -> &str {
        match self {
            Entry::Pair(pair) => &pair.key,
            Entry::Section(section) => &section.name,
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Entry::Pair(pair) => pair.key_start,
            Entry::Section(section) => section.start,
        }
    }
}

/// A whole file, every entry with its place in the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub entries: Vec<Entry>,
}

/// A file the engine's parser would reject, with the reason it gives and the
/// byte it stopped at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub at: usize,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

/// What a file holds once the engine has read it: keys lowercased, a later
/// key of the same name in place of an earlier one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    Value(String),
    Table(BTreeMap<String, Node>),
}

/// Parse `text` as the engine's `parse_tdf.lua` does.
pub fn parse(text: &str) -> Result<Document, ParseError> {
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
    };
    let (entries, close) = parser.elements()?;
    if let Some(at) = close {
        return Err(ParseError {
            message: "A `}` closes a section that was never opened.".into(),
            at,
        });
    }
    Ok(Document { entries })
}

impl Document {
    /// The file as the engine reads it.
    pub fn tree(&self) -> BTreeMap<String, Node> {
        table(&self.entries)
    }

    /// The pair at `path`, section names first and the key last, or `None`
    /// when the section is there and the key is not.
    pub fn lookup(&self, path: &[&str]) -> Result<Option<&Pair>, SetError> {
        let Some((key, sections)) = path.split_last() else {
            return Err(SetError::InvalidValue("The path names no key.".into()));
        };
        let container = self.container(sections)?;
        find_pair(&container, key)
    }

    fn container(&self, sections: &[&str]) -> Result<Container<'_>, SetError> {
        let mut at = Container {
            entries: &self.entries,
            open: None,
            close: None,
        };
        for name in sections {
            let matching = matching(at.entries, name);
            match matching.last() {
                None => {
                    return Err(SetError::SectionMissing {
                        section: name.to_string(),
                    })
                }
                Some(Entry::Pair(pair)) => {
                    return Err(SetError::NotASection {
                        key: pair.key.clone(),
                        start: pair.key_start,
                        end: pair.end,
                    })
                }
                Some(Entry::Section(section)) => {
                    if matching.len() > 1 {
                        return Err(SetError::SectionAmbiguous {
                            section: section.name.clone(),
                            at: matching.iter().map(|e| e.start()).collect(),
                        });
                    }
                    at = Container {
                        entries: &section.entries,
                        open: Some(section.open),
                        close: Some(section.close),
                    };
                }
            }
        }
        Ok(at)
    }
}

fn table(entries: &[Entry]) -> BTreeMap<String, Node> {
    let mut out = BTreeMap::new();
    for entry in entries {
        let node = match entry {
            Entry::Pair(pair) => Node::Value(pair.value.clone()),
            Entry::Section(section) => Node::Table(table(&section.entries)),
        };
        out.insert(entry.key().to_ascii_lowercase(), node);
    }
    out
}

fn matching<'a>(entries: &'a [Entry], key: &str) -> Vec<&'a Entry> {
    entries
        .iter()
        .filter(|e| e.key().eq_ignore_ascii_case(key))
        .collect()
}

/// Lua's `%s`, which is C's `isspace`.
fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn is_blank(b: u8) -> bool {
    b == b' ' || b == b'\t'
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn rest(&self) -> &[u8] {
        &self.bytes[self.pos..]
    }

    fn fail<T>(&self, message: &str) -> Result<T, ParseError> {
        Err(ParseError {
            message: message.to_string(),
            at: self.pos,
        })
    }

    /// Whitespace and comments, as `EatWhite` skips them. An unclosed `/*` is
    /// not a comment, and is left for the key it then fails to be.
    fn eat_white(&mut self) {
        loop {
            let before = self.pos;
            if self.peek() != Some(b'/') {
                while self.peek().is_some_and(is_space) {
                    self.pos += 1;
                }
            } else {
                if self.rest().starts_with(b"//") {
                    while self.peek().is_some_and(|b| b != b'\n') {
                        self.pos += 1;
                    }
                }
                if self.rest().starts_with(b"/*") {
                    if let Some(end) = find(&self.bytes[self.pos + 2..], b"*/") {
                        self.pos += 2 + end + 2;
                    }
                }
            }
            if self.pos == before {
                break;
            }
        }
    }

    /// Entries up to the end of the text or a `}`, and where that `}` is.
    fn elements(&mut self) -> Result<(Vec<Entry>, Option<usize>), ParseError> {
        let mut entries = Vec::new();
        loop {
            self.eat_white();
            match self.peek() {
                None => return Ok((entries, None)),
                Some(b'}') => {
                    let close = self.pos;
                    self.pos += 1;
                    return Ok((entries, Some(close)));
                }
                Some(b'[') => entries.push(Entry::Section(self.section()?)),
                Some(_) => entries.push(Entry::Pair(self.pair()?)),
            }
        }
    }

    fn section(&mut self) -> Result<Section, ParseError> {
        let start = self.pos;
        let Some(len) = self.bytes[start + 1..].iter().position(|&b| b == b']') else {
            return self.fail("A section's name has no closing `]`.");
        };
        if len == 0 {
            return self.fail("A section has an empty name.");
        }
        let name = self.text[start + 1..start + 1 + len].to_string();
        self.pos = start + 1 + len + 1;
        self.eat_white();
        if self.peek() != Some(b'{') {
            return self.fail("A section's name is not followed by `{`.");
        }
        let open = self.pos;
        self.pos += 1;
        let (entries, close) = self.elements()?;
        let Some(close) = close else {
            return self.fail("A section is never closed with `}`.");
        };
        Ok(Section {
            name,
            start,
            open,
            close,
            entries,
        })
    }

    fn pair(&mut self) -> Result<Pair, ParseError> {
        let key_start = self.pos;
        while self.peek().is_some_and(|b| !is_space(b) && b != b'=') {
            self.pos += 1;
        }
        let key_end = self.pos;
        while self.peek().is_some_and(is_blank) {
            self.pos += 1;
        }
        if key_end == key_start || self.peek() != Some(b'=') {
            self.pos = key_start;
            return self.fail("A line here is neither a key and its value nor a section.");
        }
        self.pos += 1;
        while self.peek().is_some_and(is_blank) {
            self.pos += 1;
        }
        let key = self.text[key_start..key_end].to_string();
        let value_start = self.pos;

        // A quoted value first, which may hold a semicolon.
        if self.peek() == Some(b'"') {
            let inner = value_start + 1;
            let len = self.bytes[inner..]
                .iter()
                .position(|&b| b == b'"' || b == b'\n');
            if let Some(len) = len.filter(|&len| self.bytes[inner + len] == b'"') {
                let value_end = inner + len + 1;
                let mut at = value_end;
                while self.bytes.get(at).copied().is_some_and(is_blank) {
                    at += 1;
                }
                if self.bytes.get(at) == Some(&b';') {
                    self.pos = at;
                    let end = self.semicolons();
                    return Ok(Pair {
                        key,
                        value: self.text[inner..inner + len].to_string(),
                        key_start,
                        key_end,
                        value_start,
                        value_end,
                        quoted: true,
                        end,
                    });
                }
            }
        }

        let len = self.bytes[value_start..]
            .iter()
            .position(|&b| b == b'\n' || b == b';');
        match len {
            Some(len) if self.bytes[value_start + len] == b';' => {
                let value_end = value_start + len;
                self.pos = value_end;
                let end = self.semicolons();
                Ok(Pair {
                    key,
                    value: self.text[value_start..value_end].to_string(),
                    key_start,
                    key_end,
                    value_start,
                    value_end,
                    quoted: false,
                    end,
                })
            }
            _ => self.fail("A value has no semicolon after it on its line."),
        }
    }

    /// Past every semicolon in a row, as the engine's parser takes them.
    fn semicolons(&mut self) -> usize {
        while self.peek() == Some(b';') {
            self.pos += 1;
        }
        self.pos
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Why [`set`] would not make a change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetError {
    /// The file does not parse as it is.
    Syntax(ParseError),
    /// A section the path goes through is not in the file.
    SectionMissing { section: String },
    /// A section the path goes through is in the file more than once, at each
    /// of these places.
    SectionAmbiguous { section: String, at: Vec<usize> },
    /// The path goes through a key where it needs a section.
    NotASection {
        key: String,
        start: usize,
        end: usize,
    },
    /// The key is in its section more than once, at each of these values.
    KeyAmbiguous {
        key: String,
        at: Vec<(usize, usize)>,
    },
    /// The key is a section, so it has no single value to change.
    NotAValue { section: String, at: usize },
    /// The key or the value cannot be written in this format.
    InvalidValue(String),
    /// The changed file did not read back as exactly the change asked for.
    PostCheck(String),
}

impl fmt::Display for SetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SetError::Syntax(e) => write!(f, "The file does not parse: {e}"),
            SetError::SectionMissing { section } => {
                write!(f, "The file has no [{section}] section.")
            }
            SetError::SectionAmbiguous { section, .. } => write!(
                f,
                "The file has more than one [{section}] section, so it is not clear which one to change."
            ),
            SetError::NotASection { key, .. } => {
                write!(f, "{key} is a single value here, not a section.")
            }
            SetError::KeyAmbiguous { key, .. } => write!(
                f,
                "{key} is written more than once in its section, so it is not clear which one to change."
            ),
            SetError::NotAValue { section, .. } => {
                write!(f, "{section} is a section here, not a single value.")
            }
            SetError::InvalidValue(message) | SetError::PostCheck(message) => {
                f.write_str(message)
            }
        }
    }
}

impl std::error::Error for SetError {}

/// A change [`set`] made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    /// The whole changed text.
    pub text: String,
    /// False when the key already held the value. `text` is then the
    /// original.
    pub changed: bool,
    /// Where in the original the change went: the old value, or the point a
    /// new key went in, where `start` and `end` are the same.
    pub start: usize,
    pub end: usize,
}

/// Set the key at `path` to `value`. The path is section names first and the
/// key last, such as `["UNITINFO", "customParams", "cost"]`, each matched
/// without regard to case.
///
/// A key already in its section has its value replaced and keeps its quotes
/// if it had them. A new key goes after the last key in its section, on a line
/// of its own with that key's indentation, `=` spacing and line ending, and
/// spelled as `path` spells it. A section the path needs and the file lacks is
/// refused rather than added.
pub fn set(text: &str, path: &[&str], value: &str) -> Result<Change, SetError> {
    let doc = parse(text).map_err(SetError::Syntax)?;
    let Some((key, sections)) = path.split_last() else {
        return Err(SetError::InvalidValue("The path names no key.".into()));
    };
    check_key(key)?;
    let container = doc.container(sections)?;
    let (new, start, end) = match find_pair(&container, key)? {
        Some(pair) if pair.value == value => {
            return Ok(Change {
                text: text.to_string(),
                changed: false,
                start: pair.value_start,
                end: pair.value_end,
            })
        }
        Some(pair) => {
            let written = format_value(value, pair.quoted)?;
            let mut new = String::with_capacity(text.len() + written.len());
            new.push_str(&text[..pair.value_start]);
            new.push_str(&written);
            new.push_str(&text[pair.value_end..]);
            (new, pair.value_start, pair.value_end)
        }
        None => {
            let written = format_value(value, false)?;
            let (at, line) = insertion(text, &container, key, &written);
            let mut new = String::with_capacity(text.len() + line.len());
            new.push_str(&text[..at]);
            new.push_str(&line);
            new.push_str(&text[at..]);
            (new, at, at)
        }
    };
    post_check(&doc, &new, path, value)?;
    Ok(Change {
        text: new,
        changed: true,
        start,
        end,
    })
}

struct Container<'a> {
    entries: &'a [Entry],
    open: Option<usize>,
    close: Option<usize>,
}

fn find_pair<'a>(container: &Container<'a>, key: &str) -> Result<Option<&'a Pair>, SetError> {
    let matching = matching(container.entries, key);
    let pairs: Vec<&Pair> = matching
        .iter()
        .filter_map(|e| match e {
            Entry::Pair(pair) => Some(pair),
            Entry::Section(_) => None,
        })
        .collect();
    match matching.last() {
        None => Ok(None),
        Some(Entry::Section(section)) => Err(SetError::NotAValue {
            section: section.name.clone(),
            at: section.start,
        }),
        Some(Entry::Pair(pair)) if matching.len() == 1 => Ok(Some(pair)),
        Some(Entry::Pair(pair)) => Err(SetError::KeyAmbiguous {
            key: pair.key.clone(),
            at: pairs.iter().map(|p| (p.value_start, p.value_end)).collect(),
        }),
    }
}

/// A key the engine would read back as the same key.
fn check_key(key: &str) -> Result<(), SetError> {
    let bad = key.is_empty()
        || key.bytes().any(|b| is_space(b) || b == b'=' || b == b';')
        || key.starts_with(['[', '{', '}', '/']);
    if bad {
        return Err(SetError::InvalidValue(format!(
            "{key:?} cannot be a key in this file."
        )));
    }
    Ok(())
}

/// `value` as the file would spell it, quoted when it has to be or when the
/// value it replaces was.
fn format_value(value: &str, quoted: bool) -> Result<String, SetError> {
    if value.contains(['\n', '\r']) {
        return Err(SetError::InvalidValue(
            "A value in this file cannot run over more than one line.".into(),
        ));
    }
    let needs_quotes = value.contains(';') || value.starts_with(['"', ' ', '\t']);
    if value.contains('"') {
        if needs_quotes {
            return Err(SetError::InvalidValue(format!(
                "{value:?} cannot be written in this file: it needs quotes, and it holds a quote itself."
            )));
        }
        return Ok(value.to_string());
    }
    if needs_quotes || quoted {
        return Ok(format!("\"{value}\""));
    }
    Ok(value.to_string())
}

/// The file's line ending, taken from its first line.
fn eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(at) if at > 0 && text.as_bytes()[at - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

fn line_start(text: &str, at: usize) -> usize {
    text[..at].rfind('\n').map_or(0, |nl| nl + 1)
}

/// The spaces and tabs a line starts with.
fn indent_of(text: &str, at: usize) -> &str {
    let start = line_start(text, at);
    let len = text[start..].bytes().take_while(|&b| is_blank(b)).count();
    &text[start..start + len]
}

/// Where a new key and value go in `container`, and the text to put there.
fn insertion(text: &str, container: &Container, key: &str, value: &str) -> (usize, String) {
    let eol = eol(text);
    let last = container.entries.iter().rev().find_map(|e| match e {
        Entry::Pair(pair) => Some(pair),
        Entry::Section(_) => None,
    });
    if let Some(last) = last {
        let sep = &text[last.key_end..last.value_start];
        let line = format!("{key}{sep}{value};");
        // Anything after the last key on its line, other than a comment,
        // keeps the new key on the same line, so it cannot land in a section
        // that opens there or after the `}` that closes this one.
        let limit = container
            .entries
            .iter()
            .map(Entry::start)
            .find(|&start| start > last.key_start)
            .or(container.close)
            .unwrap_or(text.len());
        return match text[last.end..].find('\n').map(|at| last.end + at) {
            Some(nl) if nl < limit => (
                nl + 1,
                format!("{}{line}{eol}", indent_of(text, last.key_start)),
            ),
            _ => (last.end, format!(" {line}")),
        };
    }
    let line = format!("{key}={value};");
    if let Some(first) = container.entries.first() {
        let start = line_start(text, first.start());
        let own_line = text[start..first.start()].bytes().all(is_blank)
            && container.open.is_none_or(|open| start > open);
        return if own_line {
            (
                start,
                format!("{}{line}{eol}", indent_of(text, first.start())),
            )
        } else {
            (first.start(), format!("{line} "))
        };
    }
    match (container.open, container.close) {
        (Some(open), Some(close)) => match text[open..close].find('\n') {
            Some(at) => (
                open + at + 1,
                format!("{}\t{line}{eol}", indent_of(text, open)),
            ),
            None => (open + 1, format!(" {line} ")),
        },
        _ if text.is_empty() || text.ends_with('\n') => (text.len(), format!("{line}{eol}")),
        _ => (text.len(), format!("{eol}{line}{eol}")),
    }
}

/// Confirm `new` reads as `doc` with `path` set to `value` and nothing else
/// different.
fn post_check(doc: &Document, new: &str, path: &[&str], value: &str) -> Result<(), SetError> {
    let after = parse(new)
        .map_err(|e| SetError::PostCheck(format!("The changed file would not parse: {e}")))?
        .tree();
    let mut expected = doc.tree();
    let mut at = &mut expected;
    let (key, sections) = path.split_last().expect("checked by set");
    for section in sections {
        match at.get_mut(&section.to_ascii_lowercase()) {
            Some(Node::Table(table)) => at = table,
            _ => {
                return Err(SetError::PostCheck(format!(
                    "[{section}] did not read as a section."
                )))
            }
        }
    }
    at.insert(key.to_ascii_lowercase(), Node::Value(value.to_string()));
    let mut differ = Vec::new();
    differing(&expected, &after, &mut Vec::new(), &mut differ);
    if differ.is_empty() {
        return Ok(());
    }
    let shown: Vec<&str> = differ.iter().take(5).map(String::as_str).collect();
    Err(SetError::PostCheck(format!(
        "The changed file would read differently from the change asked for at {}, so it was not made.",
        shown.join(", ")
    )))
}

fn differing(
    a: &BTreeMap<String, Node>,
    b: &BTreeMap<String, Node>,
    path: &mut Vec<String>,
    out: &mut Vec<String>,
) {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
    keys.sort();
    keys.dedup();
    for key in keys {
        path.push(key.clone());
        match (a.get(key), b.get(key)) {
            (Some(Node::Table(x)), Some(Node::Table(y))) => differing(x, y, path, out),
            (x, y) if x != y => out.push(path.join(".")),
            _ => {}
        }
        path.pop();
    }
}

/// How a file's bytes became text, so they can go back the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    /// Each byte one character, U+0000 to U+00FF. Some files from the Total
    /// Annihilation era have a Windows-1252 `é` or `©` in a comment or a
    /// name, which is not UTF-8. Reading every byte as its own character and
    /// writing it back as that byte keeps the file exactly as it was.
    Latin1,
}

/// A file's bytes as text: UTF-8 when they are, one character per byte when
/// they are not.
pub fn decode(bytes: &[u8]) -> (String, Encoding) {
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), Encoding::Utf8),
        Err(_) => (
            bytes.iter().map(|&b| char::from(b)).collect(),
            Encoding::Latin1,
        ),
    }
}

impl Encoding {
    /// `text` as bytes to write back, or `None` when it holds a character the
    /// encoding has no byte for.
    pub fn encode(self, text: &str) -> Option<Vec<u8>> {
        match self {
            Encoding::Utf8 => Some(text.as_bytes().to_vec()),
            Encoding::Latin1 => text
                .chars()
                .map(|c| u8::try_from(u32::from(c)).ok())
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests;
