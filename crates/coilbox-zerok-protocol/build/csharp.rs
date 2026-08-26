//! Just enough C# to read Zero-K's protocol definitions.
//!
//! Not a C# parser. It reads declarations and steps over every body, because
//! nothing inside one reaches the wire. What it cannot account for is a panic
//! rather than a shrug, so a refresh that changes the shape of the source fails
//! the build instead of quietly dropping a field.

use std::collections::BTreeMap;

/// A C# token. Comments are dropped as they are read, except `///` doc comments,
/// which are kept because upstream's are worth carrying into the Rust types.
#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    /// One `///` line, its leading slashes and space trimmed.
    Doc(String),
    /// The text between `[` and its matching `]`, when that was an attribute
    /// rather than an array marker.
    Attr(String),
    Ident(String),
    /// A string, character or numeric literal, kept as written.
    Lit(String),
    Punct(char),
}

/// Which side of the connection may send a command, from `[Message(Origin...)]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Server,
    Client,
    Both,
}

/// A member that reaches the wire: a public instance field, or an auto-property.
#[derive(Clone, Debug)]
pub struct Member {
    /// The name as C# spells it, which is also the JSON key.
    pub name: String,
    pub docs: Vec<String>,
    pub ty: CsType,
}

/// A member's declared type.
#[derive(Clone, Debug, PartialEq)]
pub enum CsType {
    /// A named type, qualified as it was written. `nullable` is the C# `?`.
    Named {
        path: Vec<String>,
        nullable: bool,
    },
    List(Box<CsType>),
    Array(Box<CsType>),
    Dict(Box<CsType>, Box<CsType>),
    /// C# `object`, which Json.NET writes as whatever it holds.
    Object,
    /// A generic this reader has no mapping for, kept as written so a member
    /// that turns out to use one names it in the failure.
    Unsupported(String),
}

#[derive(Clone, Debug)]
pub struct ClassDef {
    /// The enclosing types then this one, so a nested class keeps its context.
    pub path: Vec<String>,
    pub docs: Vec<String>,
    /// Set when the class carries `[Message(...)]`, which is what makes it a
    /// command rather than a payload type.
    pub message: Option<Direction>,
    pub members: Vec<Member>,
    /// The vendored file it was read from, for the generated doc comment.
    pub source: String,
}

/// One value of a C# enum, with the number it goes over the wire as.
#[derive(Clone, Debug)]
pub struct EnumValue {
    pub name: String,
    pub number: i32,
    /// Doc comments, plus the text of any `[Description("...")]`, which is the
    /// only human wording some values have.
    pub docs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct EnumDef {
    pub path: Vec<String>,
    pub docs: Vec<String>,
    pub values: Vec<EnumValue>,
    /// Set by `[Flags]`, where the wire number can be values combined.
    pub flags: bool,
    pub source: String,
}

#[derive(Clone, Debug)]
pub enum TypeDef {
    Class(ClassDef),
    Enum(EnumDef),
}

impl TypeDef {
    pub fn path(&self) -> &[String] {
        match self {
            TypeDef::Class(c) => &c.path,
            TypeDef::Enum(e) => &e.path,
        }
    }
}

/// Every type read from the vendored sources, in declaration order.
#[derive(Default)]
pub struct Model {
    pub types: Vec<TypeDef>,
    /// Path to index in `types`, so a reference resolves without a scan.
    index: BTreeMap<Vec<String>, usize>,
}

impl Model {
    /// Read one vendored file into the model. `source` is the repo-relative
    /// path, which ends up in the generated doc comments.
    pub fn read(&mut self, source: &str, text: &str) {
        // Visual Studio writes some of these files with a byte order mark.
        let toks = tokenize(text.trim_start_matches('\u{feff}'));
        let mut parser = Parser {
            toks: &toks,
            at: 0,
            source: source.to_string(),
            out: Vec::new(),
        };
        let stray = parser.items(&[]);
        assert!(
            stray.is_empty(),
            "{source} declares members outside any type, which cannot be right"
        );
        for def in parser.out {
            let path = def.path().to_vec();
            if let Some(previous) = self.index.insert(path.clone(), self.types.len()) {
                let first = match &self.types[previous] {
                    TypeDef::Class(c) => &c.source,
                    TypeDef::Enum(e) => &e.source,
                };
                panic!(
                    "{source} declares {} a second time, the first being in {first}. Two types \
                     with one path cannot both be generated.",
                    path.join(".")
                );
            }
            self.types.push(def);
        }
    }

    /// The type a written reference names, read from `from`'s scope outwards the
    /// way C# resolves it. `None` means it is declared somewhere this crate does
    /// not vendor.
    pub fn resolve(&self, reference: &[String], from: &[String]) -> Option<&TypeDef> {
        for depth in (0..=from.len()).rev() {
            let mut candidate = from[..depth].to_vec();
            candidate.extend_from_slice(reference);
            if let Some(&at) = self.index.get(&candidate) {
                return Some(&self.types[at]);
            }
        }
        // A reference that qualifies itself by its enclosing type, the way
        // `BattlePoll.PollOption` is written from a sibling class.
        let mut found = self
            .types
            .iter()
            .filter(|def| def.path().ends_with(reference));
        let first = found.next()?;
        assert!(
            found.next().is_none(),
            "{} could mean more than one type, so it cannot be resolved by name alone",
            reference.join(".")
        );
        Some(first)
    }
}

// ---------------------------------------------------------------------------
// Tokenizer.
// ---------------------------------------------------------------------------

fn tokenize(text: &str) -> Vec<Tok> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut at = 0;
    while at < chars.len() {
        let c = chars[at];
        if c.is_whitespace() {
            at += 1;
        } else if c == '/' && chars.get(at + 1) == Some(&'/') {
            let doc = chars.get(at + 2) == Some(&'/');
            let start = at + if doc { 3 } else { 2 };
            let end = line_end(&chars, start);
            if doc {
                let line: String = chars[start..end].iter().collect();
                out.push(Tok::Doc(line.trim().to_string()));
            }
            at = end;
        } else if c == '/' && chars.get(at + 1) == Some(&'*') {
            at = find(&chars, at + 2, "*/").map_or(chars.len(), |end| end + 2);
        } else if c == '#' {
            // A `#region` or `#endregion`, which carries nothing.
            at = line_end(&chars, at);
        } else if c == '"' || (c == '@' && chars.get(at + 1) == Some(&'"')) {
            let (lit, next) = read_string(&chars, at);
            out.push(Tok::Lit(lit));
            at = next;
        } else if c == '\'' {
            let (lit, next) = read_char(&chars, at);
            out.push(Tok::Lit(lit));
            at = next;
        } else if c.is_ascii_digit() {
            let start = at;
            while at < chars.len()
                && (chars[at].is_ascii_alphanumeric() || chars[at] == '.' || chars[at] == '_')
            {
                at += 1;
            }
            out.push(Tok::Lit(chars[start..at].iter().collect()));
        } else if c.is_alphabetic() || c == '_' {
            let start = at;
            while at < chars.len() && (chars[at].is_alphanumeric() || chars[at] == '_') {
                at += 1;
            }
            out.push(Tok::Ident(chars[start..at].iter().collect()));
        } else if c == '[' {
            // `[]` is an array marker. Anything else opening a bracket is an
            // attribute, or an index inside a body nobody reads.
            let mut next = at + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if chars.get(next) == Some(&']') {
                out.push(Tok::Punct('['));
                out.push(Tok::Punct(']'));
                at = next + 1;
            } else {
                let (inner, after) = read_bracketed(&chars, at);
                out.push(Tok::Attr(inner));
                at = after;
            }
        } else {
            out.push(Tok::Punct(c));
            at += 1;
        }
    }
    out
}

fn line_end(chars: &[char], from: usize) -> usize {
    let mut at = from;
    while at < chars.len() && chars[at] != '\n' {
        at += 1;
    }
    at
}

fn find(chars: &[char], from: usize, needle: &str) -> Option<usize> {
    let needle: Vec<char> = needle.chars().collect();
    (from..chars.len().saturating_sub(needle.len() - 1))
        .find(|&at| chars[at..].starts_with(&needle))
}

/// Reads a `"..."` or `@"..."` literal, answering the text and where it ends.
fn read_string(chars: &[char], from: usize) -> (String, usize) {
    let verbatim = chars[from] == '@';
    let mut at = from + if verbatim { 2 } else { 1 };
    let start = at;
    while at < chars.len() {
        if verbatim {
            if chars[at] == '"' {
                if chars.get(at + 1) == Some(&'"') {
                    at += 2;
                    continue;
                }
                break;
            }
            at += 1;
        } else {
            match chars[at] {
                '\\' => at += 2,
                '"' => break,
                _ => at += 1,
            }
        }
    }
    (chars[start..at.min(chars.len())].iter().collect(), at + 1)
}

fn read_char(chars: &[char], from: usize) -> (String, usize) {
    let mut at = from + 1;
    while at < chars.len() && chars[at] != '\'' {
        at += if chars[at] == '\\' { 2 } else { 1 };
    }
    (
        chars[from + 1..at.min(chars.len())].iter().collect(),
        at + 1,
    )
}

/// Reads from a `[` to its matching `]`, answering the text between and where it
/// ends. Nested brackets are counted so a generic attribute argument survives.
fn read_bracketed(chars: &[char], from: usize) -> (String, usize) {
    let mut depth = 0;
    let mut at = from;
    while at < chars.len() {
        match chars[at] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return (chars[from + 1..at].iter().collect(), at + 1);
                }
            }
            '"' => at = read_string(chars, at).1 - 1,
            _ => {}
        }
        at += 1;
    }
    panic!("a `[` in the source is never closed");
}

// ---------------------------------------------------------------------------
// Parser.
// ---------------------------------------------------------------------------

/// Modifiers that can precede a declaration and say nothing about its type.
const MODIFIERS: &[&str] = &[
    "public",
    "private",
    "protected",
    "internal",
    "static",
    "abstract",
    "sealed",
    "virtual",
    "override",
    "readonly",
    "const",
    "partial",
    "new",
    "extern",
    "unsafe",
    "async",
    "volatile",
    "event",
];

struct Parser<'a> {
    toks: &'a [Tok],
    at: usize,
    source: String,
    out: Vec<TypeDef>,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.at)
    }

    fn is_punct(&self, c: char) -> bool {
        self.peek() == Some(&Tok::Punct(c))
    }

    fn ident(&self) -> Option<&str> {
        match self.peek() {
            Some(Tok::Ident(name)) => Some(name),
            _ => None,
        }
    }

    fn expect(&mut self, c: char) {
        assert!(
            self.is_punct(c),
            "{}: expected `{c}` but found {:?}",
            self.source,
            self.peek()
        );
        self.at += 1;
    }

    /// Steps from an opening delimiter to its match, counting nesting.
    fn skip_balanced(&mut self, open: char, close: char) {
        self.expect(open);
        let mut depth = 1;
        while depth > 0 {
            match self.peek() {
                Some(Tok::Punct(c)) if *c == open => depth += 1,
                Some(Tok::Punct(c)) if *c == close => depth -= 1,
                None => panic!("{}: a `{open}` is never closed", self.source),
                _ => {}
            }
            self.at += 1;
        }
    }

    /// Steps to the end of a statement, over any nested body, so an initialiser
    /// holding braces does not end it early.
    fn skip_statement(&mut self) {
        loop {
            match self.peek() {
                Some(Tok::Punct(';')) => {
                    self.at += 1;
                    return;
                }
                Some(Tok::Punct('{')) => self.skip_balanced('{', '}'),
                Some(Tok::Punct('(')) => self.skip_balanced('(', ')'),
                None => panic!("{}: a statement is never terminated", self.source),
                _ => self.at += 1,
            }
        }
    }

    /// Steps over whatever follows a method or constructor signature: a base
    /// call, a `where` clause, then either a body in braces or a bare end of
    /// statement.
    fn skip_tail(&mut self) {
        loop {
            match self.peek() {
                Some(Tok::Punct('{')) => {
                    self.skip_balanced('{', '}');
                    return;
                }
                Some(Tok::Punct(';')) => {
                    self.at += 1;
                    return;
                }
                Some(Tok::Punct('(')) => self.skip_balanced('(', ')'),
                None => return,
                _ => self.at += 1,
            }
        }
    }

    /// Parses declarations until the enclosing `}` or the end of the file,
    /// pushing every type it finds onto `out` and answering the members declared
    /// directly in this body.
    fn items(&mut self, enclosing: &[String]) -> Vec<Member> {
        let mut members = Vec::new();
        loop {
            let mut docs = Vec::new();
            let mut attrs = Vec::new();
            loop {
                match self.peek() {
                    Some(Tok::Doc(line)) => {
                        docs.push(line.clone());
                        self.at += 1;
                    }
                    Some(Tok::Attr(text)) => {
                        attrs.push(text.clone());
                        self.at += 1;
                    }
                    _ => break,
                }
            }
            match self.peek() {
                None | Some(Tok::Punct('}')) => return members,
                // A stray end of statement after a class body, which C# allows.
                Some(Tok::Punct(';')) => {
                    self.at += 1;
                    continue;
                }
                _ => {}
            }

            if matches!(self.ident(), Some("using") | Some("namespace")) {
                let keyword = self.ident().unwrap_or_default().to_string();
                self.at += 1;
                while !self.is_punct(';') && !self.is_punct('{') && self.peek().is_some() {
                    self.at += 1;
                }
                if keyword == "namespace" {
                    self.expect('{');
                    // A namespace does not qualify a type here. Zero-K's own
                    // serialiser keys on the short class name, so that is the
                    // only name this crate ever needs.
                    self.items(enclosing);
                    self.expect('}');
                } else {
                    self.expect(';');
                }
                continue;
            }

            let mut modifiers = Vec::new();
            while let Some(name) = self.ident() {
                if MODIFIERS.contains(&name) {
                    modifiers.push(name.to_string());
                    self.at += 1;
                } else {
                    break;
                }
            }

            match self.ident() {
                Some("class") | Some("struct") | Some("interface") => {
                    let interface = self.ident() == Some("interface");
                    self.at += 1;
                    self.type_decl(enclosing, docs, &attrs, &modifiers, interface);
                }
                Some("enum") => {
                    self.at += 1;
                    self.enum_decl(enclosing, docs, &attrs);
                }
                Some("delegate") => self.skip_statement(),
                _ => {
                    if let Some(member) = self.member_decl(enclosing, docs, &attrs, &modifiers) {
                        members.push(member);
                    }
                }
            }
        }
    }

    fn type_decl(
        &mut self,
        enclosing: &[String],
        docs: Vec<String>,
        attrs: &[String],
        modifiers: &[String],
        interface: bool,
    ) {
        let name = self
            .ident()
            .unwrap_or_else(|| panic!("{}: a type has no name", self.source))
            .to_string();
        self.at += 1;
        // Generic parameters, a base list, then `where` clauses. None of them
        // say anything about the wire.
        while !self.is_punct('{') {
            match self.peek() {
                None => panic!("{}: {name} has no body", self.source),
                // A declaration with no body, which has nothing to read.
                Some(Tok::Punct(';')) => {
                    self.at += 1;
                    return;
                }
                _ => self.at += 1,
            }
        }

        let mut path = enclosing.to_vec();
        path.push(name.clone());

        let message = attrs.iter().find_map(|attr| direction(attr));
        // Nested types land in `out` during the recursion, so the class itself
        // is inserted in front of them and the generated file reads outside in.
        let start = self.out.len();
        self.expect('{');
        let members = self.items(&path);
        self.expect('}');

        // An interface is never a payload, an abstract class is only ever a base
        // for one, and the class that declares `[Message]` is the attribute
        // itself rather than anything on the wire.
        if interface || modifiers.iter().any(|m| m == "abstract") || name.ends_with("Attribute") {
            return;
        }

        self.out.insert(
            start,
            TypeDef::Class(ClassDef {
                path,
                docs: clean_docs(docs),
                message,
                members,
                source: self.source.clone(),
            }),
        );
    }

    /// Reads one member, answering it when it reaches the wire.
    ///
    /// Skipped: anything not public, anything static, const or an event because
    /// Json.NET writes none of them, anything marked `[JsonIgnore]`, every
    /// method, constructor and operator, and every computed property. A computed
    /// property is derived from members that are on the wire already, so
    /// recomputing it costs nothing and carrying it would invent a field the
    /// server cannot read back.
    fn member_decl(
        &mut self,
        path: &[String],
        docs: Vec<String>,
        attrs: &[String],
        modifiers: &[String],
    ) -> Option<Member> {
        let public = modifiers.iter().any(|m| m == "public");
        let stored = !modifiers
            .iter()
            .any(|m| m == "static" || m == "const" || m == "event");
        let ignored = attrs.iter().any(|attr| attr.trim() == "JsonIgnore");

        // A constructor is a name with no type in front of it, so reading a type
        // and finding `(` straight after is how one is recognised.
        let before = self.at;
        let ty = self.read_type(path);

        if self.is_punct('(') {
            self.skip_balanced('(', ')');
            self.skip_tail();
            return None;
        }
        if matches!(self.ident(), Some("operator") | Some("this")) {
            self.at = before;
            self.skip_tail();
            return None;
        }

        let name = match self.ident() {
            Some(name) => name.to_string(),
            None => panic!(
                "{}: cannot read a member of {} near {:?}",
                self.source,
                path.join("."),
                &self.toks[before..(before + 8).min(self.toks.len())]
            ),
        };
        self.at += 1;

        // A generic method names its parameters after itself.
        if self.is_punct('<') {
            self.skip_balanced('<', '>');
        }
        // A method: parameters, then a body or a bare end of statement.
        if self.is_punct('(') {
            self.skip_balanced('(', ')');
            self.skip_tail();
            return None;
        }

        let auto;
        if self.is_punct('{') {
            // A property. Auto when no accessor has a body of its own, which is
            // the only shape Json.NET can write and read back.
            let accessors = self.at;
            self.skip_balanced('{', '}');
            auto = !self.toks[accessors + 1..self.at - 1].contains(&Tok::Punct('{'));
            if self.is_punct('=') {
                self.skip_statement();
            }
        } else if self.is_punct('=') {
            // `=>` is an expression-bodied property, which is computed. A plain
            // `=` is a field with an initial value.
            auto = self.toks.get(self.at + 1) != Some(&Tok::Punct('>'));
            self.skip_statement();
        } else if self.is_punct(';') {
            self.at += 1;
            auto = true;
        } else {
            panic!(
                "{}: cannot read {}.{name}, which is neither a field, a property nor a method",
                self.source,
                path.join(".")
            );
        }

        (public && stored && !ignored && auto).then_some(Member {
            name,
            docs: clean_docs(docs),
            ty,
        })
    }

    /// Reads a type: a name, possibly qualified, possibly generic, possibly an
    /// array, possibly nullable.
    fn read_type(&mut self, path: &[String]) -> CsType {
        let mut segments = Vec::new();
        loop {
            match self.ident() {
                Some(name) => {
                    segments.push(name.to_string());
                    self.at += 1;
                }
                None => panic!(
                    "{}: expected a type in {} but found {:?}",
                    self.source,
                    path.join("."),
                    self.peek()
                ),
            }
            if self.is_punct('.') {
                self.at += 1;
            } else {
                break;
            }
        }

        let mut arguments = Vec::new();
        if self.is_punct('<') {
            self.at += 1;
            loop {
                arguments.push(self.read_type(path));
                if self.is_punct(',') {
                    self.at += 1;
                } else {
                    break;
                }
            }
            self.expect('>');
        }

        let mut ty = match (segments.last().map(String::as_str), arguments.len()) {
            (Some("List" | "IList" | "IEnumerable"), 1) => {
                CsType::List(Box::new(arguments.remove(0)))
            }
            (Some("Dictionary" | "IDictionary"), 2) => {
                let value = arguments.remove(1);
                let key = arguments.remove(0);
                CsType::Dict(Box::new(key), Box::new(value))
            }
            (Some("object"), 0) => CsType::Object,
            (_, 0) => CsType::Named {
                path: segments,
                nullable: false,
            },
            // A generic with no mapping. Nearly always a method's return type,
            // which is thrown away, so this only fails the build if a member
            // turns out to use one. See `rust_type` in the emitter.
            (_, _) => CsType::Unsupported(segments.join(".")),
        };

        while self.is_punct('[') {
            self.at += 1;
            self.expect(']');
            ty = CsType::Array(Box::new(ty));
        }
        if self.is_punct('?') {
            self.at += 1;
            if let CsType::Named { path, .. } = ty {
                ty = CsType::Named {
                    path,
                    nullable: true,
                };
            }
        }
        ty
    }

    fn enum_decl(&mut self, enclosing: &[String], docs: Vec<String>, attrs: &[String]) {
        let name = self
            .ident()
            .unwrap_or_else(|| panic!("{}: an enum has no name", self.source))
            .to_string();
        self.at += 1;
        if self.is_punct(':') {
            self.at += 1;
            let base = self.ident().unwrap_or_default().to_string();
            assert!(
                base == "int",
                "{}: {name} counts in {base} rather than int, and the generated Rust enum only \
                 knows how to convert an i32",
                self.source
            );
            self.at += 1;
        }
        self.expect('{');

        let mut values: Vec<EnumValue> = Vec::new();
        let mut next = 0i32;
        loop {
            let mut value_docs = Vec::new();
            loop {
                match self.peek() {
                    Some(Tok::Doc(line)) => {
                        value_docs.push(line.clone());
                        self.at += 1;
                    }
                    Some(Tok::Attr(text)) => {
                        if let Some(text) = description(text) {
                            value_docs.push(text);
                        }
                        self.at += 1;
                    }
                    _ => break,
                }
            }
            if self.is_punct('}') {
                break;
            }
            let value_name = match self.ident() {
                Some(value_name) => value_name.to_string(),
                None => panic!(
                    "{}: expected a value of {name} but found {:?}",
                    self.source,
                    self.peek()
                ),
            };
            self.at += 1;
            if self.is_punct('=') {
                self.at += 1;
                let negative = self.is_punct('-');
                if negative {
                    self.at += 1;
                }
                let literal = match self.peek() {
                    Some(Tok::Lit(text)) => text.clone(),
                    other => panic!(
                        "{}: {name}.{value_name} is set to {other:?}, which is not a number this \
                         reader can read",
                        self.source
                    ),
                };
                self.at += 1;
                let parsed: i32 = literal.parse().unwrap_or_else(|_| {
                    panic!(
                        "{}: {name}.{value_name} is {literal}, which is not an i32",
                        self.source
                    )
                });
                next = if negative { -parsed } else { parsed };
            }
            values.push(EnumValue {
                name: value_name,
                number: next,
                docs: clean_docs(value_docs),
            });
            next += 1;
            if self.is_punct(',') {
                self.at += 1;
            }
        }
        self.expect('}');

        let mut path = enclosing.to_vec();
        path.push(name);
        self.out.push(TypeDef::Enum(EnumDef {
            path,
            docs: clean_docs(docs),
            values,
            flags: attrs.iter().any(|attr| attr.trim() == "Flags"),
            source: self.source.clone(),
        }));
    }
}

/// The direction a `[Message(...)]` attribute declares, or `None` when the
/// attribute is something else.
fn direction(attr: &str) -> Option<Direction> {
    let inside = attr.trim().strip_prefix("Message")?;
    let inside = inside.trim().strip_prefix('(')?.strip_suffix(')')?;
    match (
        inside.contains("Origin.Server"),
        inside.contains("Origin.Client"),
    ) {
        (true, true) => Some(Direction::Both),
        (true, false) => Some(Direction::Server),
        (false, true) => Some(Direction::Client),
        (false, false) => panic!("a [Message({inside})] names neither side of the connection"),
    }
}

/// The text of a `[Description("...")]`.
fn description(attr: &str) -> Option<String> {
    let inside = attr.trim().strip_prefix("Description")?;
    let inside = inside.trim().strip_prefix("(\"")?.strip_suffix("\")")?;
    Some(inside.to_string())
}

/// Turns C# XML doc comments into plain lines: the `<summary>` wrapper goes, a
/// `<see cref="X"/>` becomes a backticked `X`, and every other tag is dropped
/// rather than passed through to confuse rustdoc.
pub fn clean_docs(docs: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in docs {
        let line = replace_see(&line);
        let line = strip_tags(&line);
        let line = line.trim().to_string();
        if line.is_empty() && out.last().map(String::is_empty).unwrap_or(true) {
            continue;
        }
        out.push(line);
    }
    while out.last().is_some_and(String::is_empty) {
        out.pop();
    }
    out
}

/// Rewrites every `<see cref="X"/>` as `` `X` ``, keeping the name upstream
/// pointed at without the tag rustdoc would render as raw HTML.
fn replace_see(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(start) = rest.find("<see cref=\"") {
        out.push_str(&rest[..start]);
        let after = &rest[start + "<see cref=\"".len()..];
        let Some(quote) = after.find('"') else {
            out.push_str(rest);
            return out;
        };
        let name = after[..quote].rsplit('.').next().unwrap_or_default();
        out.push('`');
        out.push_str(name);
        out.push('`');
        rest = after[quote..]
            .find('>')
            .map_or("", |end| &after[quote + end + 1..]);
    }
    out.push_str(rest);
    out
}

/// Drops every remaining XML tag, keeping the text between.
fn strip_tags(line: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in line.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}
