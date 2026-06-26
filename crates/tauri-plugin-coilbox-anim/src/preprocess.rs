//! Builtin preprocessor — a port of `preprocess()` (bos2cob_py3.py L1317-1460).
//!
//! This is the `--nopcpp` parity target. It handles `#define`/`#undef`/`#ifdef`/
//! `#ifndef`/`#else`/`#endif`/`#include` plus macro expansion. It deliberately
//! does NOT handle `#if`: in the reference, `#if` hits a `"".join()` over
//! `(token, idx)` tuples and crashes (`TypeError`), so no `--nopcpp` script can
//! use it. We surface that as an error rather than silently inventing behaviour.
//!
//! Macro expansion in the reference yields *nested* `(token, idx)` tuples that
//! the `Pump` later unwraps to the innermost string; we just emit the expanded
//! string tokens directly, which is the same post-`Pump` result.

use crate::tokenizer::tokenize;
use std::collections::HashMap;
use std::path::Path;

/// Preprocess raw BOS source into the flattened token stream the parser consumes.
/// `include_dir` is the directory used to resolve `#include` targets that aren't
/// found relative to the process working directory (mirrors the reference).
pub fn preprocess(code: &str, include_dir: &Path) -> Result<Vec<String>, String> {
    let mut defs: HashMap<String, String> = HashMap::new();
    defs.insert("TRUE".to_string(), "1".to_string());
    defs.insert("FALSE".to_string(), "0".to_string());
    defs.insert("UNKNOWN_UNIT_VALUE".to_string(), String::new());
    let mut out = Vec::new();
    run(code, include_dir, &mut defs, 0, &mut out)?;
    Ok(out)
}

fn run(
    code: &str,
    include_dir: &Path,
    defs: &mut HashMap<String, String>,
    recursion: u32,
    out: &mut Vec<String>,
) -> Result<(), String> {
    if recursion > 10 {
        return Err("preprocessor recursion limit reached".to_string());
    }

    let toks = tokenize(code);
    let mut i = 0usize;
    // Consume and return the next token, or None at end of stream.
    macro_rules! next {
        () => {{
            let t = toks.get(i).cloned();
            if t.is_some() {
                i += 1;
            }
            t
        }};
    }

    let mut is_directive = false;
    let mut skip: i32 = 0;
    let mut ifs: i32 = 0;

    while let Some(token) = next!() {
        if token == "#" {
            is_directive = true;
            continue;
        }
        if token == "$" {
            continue;
        }

        if !is_directive {
            if skip > 0 {
                continue;
            }
            match defs.get(&token).cloned() {
                Some(body) => run(&body, include_dir, defs, recursion + 1, out)?,
                None => out.push(token),
            }
            continue;
        }

        is_directive = false;
        let directive = token.to_lowercase();
        match directive.as_str() {
            "include" => {
                if skip > 0 {
                    continue;
                }
                let included = next!()
                    .ok_or("preprocessor: #include missing filename")?
                    .trim_matches('"')
                    .to_string();
                let candidate = Path::new(&included);
                let path = if candidate.exists() {
                    candidate.to_path_buf()
                } else {
                    let alt = include_dir.join(&included);
                    if alt.exists() {
                        alt
                    } else {
                        return Err(format!("preprocessor: can't find include {included}"));
                    }
                };
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("preprocessor: couldn't read include {included}: {e}"))?;
                run(&content, include_dir, defs, recursion + 1, out)?;
            }
            "define" => {
                if skip > 0 {
                    continue;
                }
                let name = next!().ok_or("preprocessor: #define missing name")?;
                let mut body = String::new();
                loop {
                    match next!() {
                        Some(t) if t == "$" => break,
                        Some(t) => {
                            body.push(' ');
                            body.push_str(&t);
                        }
                        None => break,
                    }
                }
                defs.insert(name, body);
            }
            "undef" => {
                if skip > 0 {
                    continue;
                }
                let name = next!().ok_or("preprocessor: #undef missing name")?;
                defs.remove(&name);
            }
            "ifdef" => {
                ifs += 1;
                if skip > 0 {
                    skip += 1;
                    continue;
                }
                let name = next!().ok_or("preprocessor: #ifdef missing name")?;
                if !defs.contains_key(&name) {
                    skip += 1;
                }
            }
            "ifndef" => {
                ifs += 1;
                if skip > 0 {
                    skip += 1;
                    continue;
                }
                let name = next!().ok_or("preprocessor: #ifndef missing name")?;
                if defs.contains_key(&name) {
                    skip += 1;
                }
            }
            "else" => {
                if skip == 1 {
                    skip = 0;
                } else if skip == 0 {
                    skip = 1;
                }
            }
            "endif" => {
                if ifs == 0 {
                    return Err("preprocessor: extraneous #endif".to_string());
                }
                ifs -= 1;
                if skip > 0 {
                    skip -= 1;
                }
            }
            "if" => {
                return Err(
                    "preprocessor: #if is unsupported by the builtin preprocessor (crashes in the reference; use full pcpp)"
                        .to_string(),
                );
            }
            other => {
                return Err(format!("preprocessor: unhandled directive #{other}"));
            }
        }
    }

    if ifs > 0 {
        return Err("preprocessor: missing #endif".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn passes_through_plain_source_unchanged() {
        let src = include_str!("../tests/fixtures/min.bos");
        let toks = preprocess(src, Path::new(".")).unwrap();
        assert_eq!(toks, crate::tokenizer::tokenize(src));
    }

    /// `#define`/`#ifdef`/`#ifndef`/`#else`, macro expansion, and the built-in
    /// `UNKNOWN_UNIT_VALUE` → empty removal. Golden from the Python reference.
    #[test]
    fn handles_defines_conditionals_and_macro_expansion() {
        let src = "#define A 1\n#define B\n#ifdef A\npiece kept_a;\n#endif\n#ifndef B\npiece dropped;\n#else\npiece kept_b;\n#endif\nfoo = A + UNKNOWN_UNIT_VALUE 2;\n";
        let toks = preprocess(src, Path::new(".")).unwrap();
        let expected = [
            "piece", "kept_a", ";", "piece", "kept_b", ";", "foo", "=", "1", "+", "2", ";",
        ];
        assert_eq!(toks, expected);
    }

    #[test]
    fn if_directive_is_rejected() {
        let err = preprocess("#if 1\npiece p;\n#endif\n", Path::new(".")).unwrap_err();
        assert!(err.contains("#if"), "{err}");
    }
}
