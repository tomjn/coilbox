//! Tokens for Lua 5.1.
//!
//! Comments are dropped and strings are kept as one token whose text is the
//! body, so a name inside either can never look like code. Long strings and
//! long comments (`[[...]]`, `[==[...]==]`, `--[[ ]]`) are read to their
//! matching close, because old game Lua uses them to switch code off.
//!
//! Nothing here fails. A string or comment that never closes runs to the end
//! of its line (strings) or of the file (long forms), as the scan of an
//! unfinished file should still report what came before.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Ident,
    Number,
    /// A quoted or long string, without its delimiters.
    Str,
    Sym,
}

#[derive(Clone, Debug)]
pub struct Token {
    pub kind: Kind,
    pub text: String,
    /// 1-based line the token starts on.
    pub line: u32,
    /// 1-based column, counted in characters, of the token's first character.
    pub column: u32,
}

impl Token {
    pub fn is_sym(&self, s: &str) -> bool {
        self.kind == Kind::Sym && self.text == s
    }

    pub fn is_ident(&self, s: &str) -> bool {
        self.kind == Kind::Ident && self.text == s
    }
}

pub fn lex(src: &str) -> Vec<Token> {
    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0;
    let mut line = 1u32;
    // Index of the first character of the current line, for columns.
    let mut line_start = 0usize;

    while i < n {
        let c = chars[i];
        if c == '\n' {
            line += 1;
            i += 1;
            line_start = i;
            continue;
        }
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let tok_line = line;
        let tok_col = (i - line_start + 1) as u32;
        let mut push = |kind: Kind, text: String| {
            out.push(Token {
                kind,
                text,
                line: tok_line,
                column: tok_col,
            })
        };

        // Comments: `--`, then a long bracket makes it a long comment.
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            if let Some(level) = long_open(&chars, i + 2) {
                let (end, newlines, last_line_start) = skip_long(&chars, i + 2, level);
                line += newlines;
                if newlines > 0 {
                    line_start = last_line_start;
                }
                i = end;
            } else {
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
            }
            continue;
        }

        if c == '[' {
            if let Some(level) = long_open(&chars, i) {
                let (end, newlines, last_line_start) = skip_long(&chars, i, level);
                let body_start = i + level + 2;
                let body_end = end.saturating_sub(level + 2).max(body_start.min(n));
                let body: String = chars[body_start.min(n)..body_end.min(n)].iter().collect();
                push(Kind::Str, body);
                line += newlines;
                if newlines > 0 {
                    line_start = last_line_start;
                }
                i = end;
                continue;
            }
        }

        if c == '"' || c == '\'' {
            let mut j = i + 1;
            let mut body = String::new();
            while j < n && chars[j] != c && chars[j] != '\n' {
                if chars[j] == '\\' && j + 1 < n {
                    body.push(chars[j]);
                    j += 1;
                    // An escaped newline continues the string on the next line.
                    if chars[j] == '\n' {
                        line += 1;
                        line_start = j + 1;
                    }
                }
                body.push(chars[j]);
                j += 1;
            }
            // Step over the closing quote. An unfinished string stops at the
            // newline and leaves it for the loop to count.
            if j < n && chars[j] == c {
                j += 1;
            }
            push(Kind::Str, body);
            i = j;
            continue;
        }

        if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()))
        {
            let mut j = i;
            while j < n {
                let d = chars[j];
                if d.is_ascii_alphanumeric() || d == '_' {
                    // An exponent sign belongs to the number: `1e-3`.
                    if (d == 'e' || d == 'E')
                        && matches!(chars.get(j + 1), Some('+') | Some('-'))
                        && !is_hex(&chars[i..j])
                    {
                        j += 1;
                    }
                    j += 1;
                } else if d == '.' && chars.get(j + 1) != Some(&'.') {
                    j += 1;
                } else {
                    break;
                }
            }
            push(Kind::Number, chars[i..j].iter().collect());
            i = j;
            continue;
        }

        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < n && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            push(Kind::Ident, chars[i..j].iter().collect());
            i = j;
            continue;
        }

        let three: String = chars[i..(i + 3).min(n)].iter().collect();
        if three == "..." {
            push(Kind::Sym, three);
            i += 3;
            continue;
        }
        let two: String = chars[i..(i + 2).min(n)].iter().collect();
        if matches!(two.as_str(), ".." | "==" | "~=" | "<=" | ">=") {
            push(Kind::Sym, two);
            i += 2;
            continue;
        }
        push(Kind::Sym, c.to_string());
        i += 1;
    }
    out
}

fn is_hex(prefix: &[char]) -> bool {
    prefix.len() >= 2 && prefix[0] == '0' && (prefix[1] == 'x' || prefix[1] == 'X')
}

/// The level of a long bracket opening at `at` (`[[` is 0, `[==[` is 2), or
/// `None` when `at` does not open one.
fn long_open(chars: &[char], at: usize) -> Option<usize> {
    if chars.get(at) != Some(&'[') {
        return None;
    }
    let mut level = 0;
    while chars.get(at + 1 + level) == Some(&'=') {
        level += 1;
    }
    (chars.get(at + 1 + level) == Some(&'[')).then_some(level)
}

/// Read a long bracket that opens at `at` with `level` equals signs. Returns
/// the index just past its close (or the end of the file when it never
/// closes), the newlines inside it, and the index the last line started at.
fn skip_long(chars: &[char], at: usize, level: usize) -> (usize, u32, usize) {
    let n = chars.len();
    let mut i = at + level + 2;
    let mut newlines = 0;
    let mut last_line_start = 0;
    while i < n {
        if chars[i] == '\n' {
            newlines += 1;
            last_line_start = i + 1;
        } else if chars[i] == ']'
            && (0..level).all(|k| chars.get(i + 1 + k) == Some(&'='))
            && chars.get(i + 1 + level) == Some(&']')
        {
            return (i + level + 2, newlines, last_line_start);
        }
        i += 1;
    }
    (n, newlines, last_line_start)
}
