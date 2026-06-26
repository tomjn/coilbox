//! Tokenizer — a faithful port of `token_generator` (bos2cob_py3.py L1198-1314).
//!
//! A hand-written character scanner (not a regex lexer). Notable behaviours that
//! the rest of the pipeline depends on:
//! - Multi-character operators (`==`, `<=`, `&&`, …) are emitted as *separate*
//!   single-char tokens; the grammar rule `_op` reassembles them later.
//! - It is entwined with the preprocessor: it emits a literal `#` token when a
//!   directive starts and a `$` sentinel when one ends. `preprocess()` consumes
//!   these; the final parser never sees them.
//! - Quoted strings are emitted whole, *including* the surrounding quotes.

/// Tokenize raw BOS source into the same token stream Python's `token_generator`
/// yields (we drop the source-index half of each `(token, idx)` pair — only the
/// preprocessor used it, and only for error messages).
pub fn tokenize(code: &str) -> Vec<String> {
    let chars: Vec<char> = code.chars().collect();
    let n = chars.len();
    const DELIMS: &[char] = &[
        '{', '}', '[', ']', '(', ')', ' ', '&', '|', '^', '+', '-', '*', '/', '%', ',', ';', '<',
        '>', '=', '!', '#', '\t', '\r', '\n', '\\',
    ];

    let mut out: Vec<String> = Vec::new();
    let mut is_line_comment = false;
    let mut is_multi_line_comment = false;
    let mut is_in_quotation = false;
    let mut is_preprocessor = false;
    let mut skip = false;

    let mut idx = 0usize;
    let mut prev_idx = 0usize;

    // `code[a:b]` with Python's forgiving bounds.
    let slice = |a: usize, b: usize| -> String {
        let a = a.min(n);
        let b = b.min(n).max(a);
        chars[a..b].iter().collect()
    };
    // Next up-to-two chars as a string (for "//", "/*", "*/" lookahead).
    let two = |i: usize| -> String { slice(i, i + 2) };
    // Python `s.strip().strip('\\')`.
    let strip = |s: &str| -> String { s.trim().trim_matches('\\').to_string() };

    while idx < n {
        let c = chars[idx];

        if !is_line_comment && !is_multi_line_comment && !is_in_quotation && c == '"' {
            is_in_quotation = true;
            prev_idx = idx;
            idx += 1;
            continue;
        }

        if !is_line_comment && !is_multi_line_comment && is_in_quotation && c == '"' {
            is_in_quotation = false;
            idx += 1;
            out.push(slice(prev_idx, idx)); // includes both quotes
            prev_idx = idx;
            continue;
        }

        if !is_line_comment && !is_multi_line_comment && !is_in_quotation && two(idx) == "//" {
            is_line_comment = true;
            let s = slice(prev_idx, idx).trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            if is_preprocessor {
                is_preprocessor = false;
                out.push("$".to_string());
            }
            idx += 2;
            prev_idx = idx;
            continue;
        }

        if !is_line_comment && !is_multi_line_comment && !is_in_quotation && two(idx) == "/*" {
            is_multi_line_comment = true;
            let s = slice(prev_idx, idx).trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            idx += 2;
            prev_idx = idx;
            continue;
        }

        if !is_line_comment
            && !is_multi_line_comment
            && !is_in_quotation
            && !is_preprocessor
            && c == '#'
        {
            is_preprocessor = true;
            let s = slice(prev_idx, idx).trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            out.push("#".to_string());
            idx += 1;
            prev_idx = idx;
            continue;
        }

        // A bare newline ends a preprocessor directive unless the line is
        // continued (`\` or `\` + CR before the newline).
        if !is_line_comment && !is_multi_line_comment && !is_in_quotation && is_preprocessor && c == '\n'
        {
            let prev1_not_backslash = idx < 1 || chars[idx - 1] != '\\';
            let prev2 = if idx >= 2 {
                format!("{}{}", chars[idx - 2], chars[idx - 1])
            } else {
                String::new()
            };
            if prev1_not_backslash && prev2 != "\\\r" {
                is_preprocessor = false;
                let s = slice(prev_idx, idx).trim().to_string();
                if !s.is_empty() {
                    out.push(s);
                }
                out.push("$".to_string()); // mark end of preprocessor directive
                idx += 1;
                prev_idx = idx;
                continue;
            }
        }

        if is_line_comment && slice(idx, idx + 1) == "\n" {
            is_line_comment = false;
            idx += 1;
            prev_idx = idx;
            continue;
        }

        if is_multi_line_comment && two(idx) == "*/" {
            is_multi_line_comment = false;
            idx += 2;
            prev_idx = idx;
            continue;
        }

        skip = is_multi_line_comment || is_line_comment || is_in_quotation;
        if !skip && DELIMS.contains(&c) {
            let token = strip(&slice(prev_idx, idx));
            if !token.is_empty() {
                out.push(token);
            }
            let symbol_token = strip(&slice(idx, idx + 1));
            if !symbol_token.is_empty() {
                out.push(symbol_token);
            }
            idx += 1;
            prev_idx = idx;
            continue;
        }

        idx += 1;
    }

    if !skip && idx == n {
        let token = slice(prev_idx, idx).trim().to_string();
        if !token.is_empty() {
            out.push(token);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden token stream for `tests/fixtures/min.bos`, captured from the Python
    /// reference `token_generator`.
    #[test]
    fn tokenizes_min_bos_like_reference() {
        let src = include_str!("../tests/fixtures/min.bos");
        let expected = [
            "piece", "base", ",", "turret", ";", "static", "-", "var", "foo", ";", "Create", "(",
            ")", "{", "foo", "=", "1", "+", "2", ";", "hide", "turret", ";", "show", "base", ";",
            "}", "Killed", "(", "severity", ",", "corpsetype", ")", "{", "if", "(", "severity",
            "<", "50", ")", "{", "explode", "base", "type", "1", ";", "}", "return", "(", "0", ")",
            ";", "}",
        ];
        assert_eq!(tokenize(src), expected);
    }

    /// Comments, multi-char operators (split into single chars), quoted strings
    /// (kept whole, with quotes), and the `#`/`$` preprocessor sentinels.
    #[test]
    fn tokenizes_comments_operators_strings_and_directives() {
        let src = "#define SPEED 30\n// line comment\n/* block\ncomment */\npiece p1;\nfoo = a <= b && c == \"hi\";\n";
        let expected = [
            "#", "define", "SPEED", "30", "$", "piece", "p1", ";", "foo", "=", "a", "<", "=", "b",
            "&", "&", "c", "=", "=", "\"hi\"", ";",
        ];
        assert_eq!(tokenize(src), expected);
    }
}
