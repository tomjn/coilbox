//! Tokens for the converter.
//!
//! The compiler's tokenizer throws comments away, which is right for a compiler
//! and wrong here: the Lua keeps every comment the BOS had. So this one keeps
//! them, with the line each token started on and whether a comment had a line
//! to itself or trailed code.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Ident,
    Number,
    /// A quoted string, without its quotes.
    Str,
    Sym,
    /// `text` is the body without the `//`, `/*` or `*/`.
    Comment {
        block: bool,
        own_line: bool,
    },
    /// Everything after a `#`, continuation lines joined.
    Directive,
    /// The preprocessor's marks, never made by `lex`: a `#define` of `text`,
    /// and the start and end of an included file.
    Define,
    /// A use of a `#define` the Lua keeps as a named local rather than
    /// pasting its value in.
    Const,
    IncludeStart,
    IncludeEnd,
}

#[derive(Clone, Debug)]
pub struct Token {
    pub kind: Kind,
    pub text: String,
    pub line: u32,
    /// Which file, as an index the preprocessor hands out. 0 is the script.
    pub file: usize,
}

impl Token {
    pub fn is_sym(&self, s: &str) -> bool {
        self.kind == Kind::Sym && self.text == s
    }

    /// Keywords are matched regardless of case, as the compiler matches them.
    pub fn is_word(&self, w: &str) -> bool {
        self.kind == Kind::Ident && self.text.eq_ignore_ascii_case(w)
    }

    pub fn is_comment(&self) -> bool {
        matches!(self.kind, Kind::Comment { .. })
    }
}

const PAIRS: [&str; 9] = ["==", "!=", "<=", ">=", "&&", "||", "^^", "++", "--"];

pub fn lex(src: &str, file: usize) -> Vec<Token> {
    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0;
    let mut line = 1u32;
    // Whether anything but whitespace has been seen on the current line.
    let mut line_used = false;

    let push = |out: &mut Vec<Token>, kind: Kind, text: String, line: u32| {
        out.push(Token {
            kind,
            text,
            line,
            file,
        })
    };

    while i < n {
        let c = chars[i];
        if c == '\n' {
            line += 1;
            line_used = false;
            i += 1;
            continue;
        }
        // A stray quote mark is skipped, as Scriptor skipped it: Expand and
        // Exterminate ships `#define reactionalien5 1024+0'` compiled.
        if c.is_whitespace() || c == '\\' || c == '\'' || c == '`' {
            i += 1;
            continue;
        }

        if c == '/' && chars.get(i + 1) == Some(&'/') {
            let start = i + 2;
            let mut j = start;
            while j < n && chars[j] != '\n' {
                j += 1;
            }
            let text: String = chars[start..j].iter().collect();
            push(
                &mut out,
                Kind::Comment {
                    block: false,
                    own_line: !line_used,
                },
                text.trim_end().to_string(),
                line,
            );
            i = j;
            continue;
        }

        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let (text, end, lines) = block_comment(&chars, i);
            push(
                &mut out,
                Kind::Comment {
                    block: true,
                    own_line: !line_used,
                },
                text,
                line,
            );
            line += lines;
            line_used = true;
            i = end;
            continue;
        }

        if c == '#' && !line_used {
            // A directive runs to the end of the line, and on past it when the
            // line ends in a backslash. A comment on it is its own token, after
            // the directive, so a `#define` keeps its explanation.
            let start_line = line;
            let mut text = String::new();
            let mut comments = Vec::new();
            let mut j = i + 1;
            while j < n {
                let d = chars[j];
                if d == '\n' {
                    let continued = text.trim_end().ends_with('\\');
                    if continued {
                        let trimmed = text.trim_end().trim_end_matches('\\').to_string();
                        text = trimmed;
                        text.push(' ');
                        line += 1;
                        j += 1;
                        continue;
                    }
                    break;
                }
                if d == '/' && chars.get(j + 1) == Some(&'/') {
                    let mut k = j + 2;
                    while k < n && chars[k] != '\n' {
                        k += 1;
                    }
                    let body: String = chars[j + 2..k].iter().collect();
                    comments.push((false, body.trim_end().to_string(), line));
                    j = k;
                    continue;
                }
                if d == '/' && chars.get(j + 1) == Some(&'*') {
                    let (body, end, lines) = block_comment(&chars, j);
                    comments.push((true, body, line));
                    line += lines;
                    j = end;
                    continue;
                }
                if d != '\r' {
                    text.push(d);
                }
                j += 1;
            }
            push(
                &mut out,
                Kind::Directive,
                text.trim().to_string(),
                start_line,
            );
            for (block, body, at) in comments {
                push(
                    &mut out,
                    Kind::Comment {
                        block,
                        own_line: false,
                    },
                    body,
                    at,
                );
            }
            line_used = true;
            i = j;
            continue;
        }

        line_used = true;

        if c == '"' {
            let mut j = i + 1;
            while j < n && chars[j] != '"' && chars[j] != '\n' {
                j += 1;
            }
            push(
                &mut out,
                Kind::Str,
                chars[i + 1..j.min(n)].iter().collect(),
                line,
            );
            i = (j + 1).min(n);
            continue;
        }

        if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()))
        {
            let mut j = i;
            if c == '0' && matches!(chars.get(i + 1), Some('x') | Some('X')) {
                j += 2;
                while j < n && chars[j].is_ascii_hexdigit() {
                    j += 1;
                }
            } else {
                while j < n && (chars[j].is_ascii_digit() || chars[j] == '.') {
                    j += 1;
                }
            }
            push(&mut out, Kind::Number, chars[i..j].iter().collect(), line);
            i = j;
            continue;
        }

        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < n && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            push(&mut out, Kind::Ident, chars[i..j].iter().collect(), line);
            i = j;
            continue;
        }

        let pair: String = chars[i..(i + 2).min(n)].iter().collect();
        if PAIRS.contains(&pair.as_str()) {
            push(&mut out, Kind::Sym, pair, line);
            i += 2;
            continue;
        }
        push(&mut out, Kind::Sym, c.to_string(), line);
        i += 1;
    }
    out
}

/// A `/* */` comment starting at `start`: its body, the index after it, and how
/// many newlines it spanned. An unclosed one runs to the end of the file.
fn block_comment(chars: &[char], start: usize) -> (String, usize, u32) {
    let mut j = start + 2;
    let mut lines = 0;
    while j < chars.len() && !(chars[j] == '*' && chars.get(j + 1) == Some(&'/')) {
        if chars[j] == '\n' {
            lines += 1;
        }
        j += 1;
    }
    let body: String = chars[start + 2..j.min(chars.len())]
        .iter()
        .filter(|c| **c != '\r')
        .collect();
    (body, (j + 2).min(chars.len()), lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<(Kind, String)> {
        lex(src, 0).into_iter().map(|t| (t.kind, t.text)).collect()
    }

    #[test]
    fn keeps_comments_and_says_where_they_sat() {
        let toks = kinds("// head\npiece base; // trailing\n/* block\n two */");
        assert_eq!(
            toks[0],
            (
                Kind::Comment {
                    block: false,
                    own_line: true
                },
                " head".into()
            )
        );
        assert_eq!(
            toks[4],
            (
                Kind::Comment {
                    block: false,
                    own_line: false
                },
                " trailing".into()
            )
        );
        assert_eq!(
            toks[5],
            (
                Kind::Comment {
                    block: true,
                    own_line: true
                },
                " block\n two ".into()
            )
        );
    }

    #[test]
    fn a_directive_is_one_token_and_its_comment_another() {
        let toks = kinds("#define TA\t\t\t// This is a TA script\r\n#include \"sfxtype.h\"\r\n");
        assert_eq!(toks[0], (Kind::Directive, "define TA".into()));
        assert_eq!(
            toks[1],
            (
                Kind::Comment {
                    block: false,
                    own_line: false
                },
                " This is a TA script".into()
            )
        );
        assert_eq!(toks[2], (Kind::Directive, "include \"sfxtype.h\"".into()));
    }

    #[test]
    fn joins_continued_directives() {
        let toks = kinds("#define A 1 + \\\n 2\npiece p;");
        assert_eq!(toks[0], (Kind::Directive, "define A 1 +   2".into()));
        assert_eq!(lex("#define A 1 + \\\n 2\npiece p;", 0)[1].line, 3);
    }

    #[test]
    fn pairs_operators_and_keeps_angle_brackets_apart() {
        let toks: Vec<String> = kinds("a <= b && c; turn x to y-axis <-25.0> now;")
            .into_iter()
            .map(|(_, t)| t)
            .collect();
        assert_eq!(
            toks,
            [
                "a", "<=", "b", "&&", "c", ";", "turn", "x", "to", "y", "-", "axis", "<", "-",
                "25.0", ">", "now", ";"
            ]
        );
    }
}
