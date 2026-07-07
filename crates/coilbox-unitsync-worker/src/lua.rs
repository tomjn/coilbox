//! `--lua` mode: run a user Lua snippet through unitsync's restricted `LuaParser`
//! with one archive mounted, and return the value it produces.
//!
//! unitsync's Lua parser has no usable stdout/`print`; the only readable output
//! is a table the chunk `return`s, queried via the `lpGet*` C API. Rather than
//! walk an arbitrary nested table from Rust, we inject a tiny Lua serializer and
//! wrap the user's code so the chunk returns `{ result = <string> }` (or
//! `{ __error = <string> }` if the user code raised). Rust then reads that one
//! string back with a single `lpGetStrKeyStrVal`.

use crate::ffi::Unitsync;
use crate::model::{LuaExecOutput, LuaReplOutput};
use std::path::Path;

/// VFS modes for the parser: unitsync's `SPRING_VFS_ALL` (raw + map + mod + base),
/// so the script can `VFS.Include` files from the mounted archive — matching the
/// modes `start_positions` uses to read `mapinfo.lua` from an added archive.
const VFS_ALL: &str = "rmMbe";

/// Load libunitsync, mount `archive` (and its dependencies) into the VFS, then run
/// the user's `source` through the Lua parser and collect the result.
pub fn run(lib: &str, archive: &str, source: &str) -> LuaExecOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return LuaExecOutput {
                error: Some(e),
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    // Mount the archive + deps so VFS.Include resolves against it.
    us.add_all_archives(archive);

    let wrapped = wrap_source(source);
    let (result, error) = match us.run_lua_source(&wrapped, VFS_ALL) {
        Ok(r) => (Some(r), None),
        Err(e) => (None, Some(e)),
    };
    // Surface any unitsync diagnostics (e.g. a missing dependency archive) — useful
    // when debugging why a VFS.Include didn't resolve.
    let errors = us.drain_errors();
    us.uninit();

    LuaExecOutput {
        result,
        error,
        errors,
    }
}

/// Print a `--lua` error envelope to stdout (used on the panic path in `main`).
pub fn emit_error(msg: String) {
    let out = LuaExecOutput {
        error: Some(msg),
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// REPL mode: replay a whole session in one fresh `lua_State`. `chunks` is the
/// ordered list of previously-successful inputs plus the new one; they run
/// sequentially so globals persist across them (standard REPL semantics), but
/// each is its own function body, so a `return` in one chunk doesn't abort the
/// rest. Only the final chunk's value, error, and `print` output are reported;
/// an error in an earlier (replayed) chunk is flagged via `diverged_at`.
pub fn run_repl(lib: &str, archive: &str, chunks: &[String]) -> LuaReplOutput {
    let us = match unsafe { Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return LuaReplOutput {
                error: Some(e),
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    us.add_all_archives(archive);

    let wrapped = wrap_chunks(chunks);
    let (result, error, diverged_at, prints) = match us.run_lua_repl(&wrapped, VFS_ALL) {
        Ok(raw) => {
            let diverged_at = raw.diverged.as_deref().and_then(|s| s.parse::<u32>().ok());
            let error = match (raw.error, diverged_at) {
                (Some(msg), Some(n)) => {
                    Some(format!("session replay diverged at chunk {n}: {msg}"))
                }
                (Some(msg), None) => Some(msg),
                (None, _) => None,
            };
            (raw.result, error, diverged_at, raw.prints)
        }
        Err(e) => (None, Some(e), None, None),
    };
    let errors = us.drain_errors();
    us.uninit();

    LuaReplOutput {
        result,
        error,
        diverged_at,
        prints,
        errors,
    }
}

/// Print a `--lua --chunks-file` error envelope to stdout (panic/read-failure path).
pub fn emit_repl_error(msg: String) {
    let out = LuaReplOutput {
        error: Some(msg),
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

/// A pure-Lua pretty-printer, prepended to every script. Uses only primitives the
/// unitsync `LuaParser` env keeps (`pairs`/`type`/`tostring`/`string.format`/
/// `table.concat`/`table.sort`). Handles nil/number/boolean/string/table, sorts
/// map keys for stable output, tags cycles and other types, and caps depth.
pub const SERIALIZER: &str = r#"
local function __cb_dump(root)
  local seen = {}
  local function rec(v, indent, depth)
    local t = type(v)
    if t == "nil" then return "nil"
    elseif t == "number" or t == "boolean" then return tostring(v)
    elseif t == "string" then return string.format("%q", v)
    elseif t == "table" then
      if seen[v] then return "<cycle>" end
      if depth > 20 then return "<...>" end
      seen[v] = true
      local ni = indent .. "  "
      local pieces = {}
      local n = 0
      for _ in pairs(v) do n = n + 1 end
      if n == #v then
        for i = 1, #v do
          pieces[#pieces + 1] = ni .. rec(v[i], ni, depth + 1)
        end
      else
        local keys = {}
        for k in pairs(v) do keys[#keys + 1] = k end
        table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
        for _, k in ipairs(keys) do
          local ks = (type(k) == "string") and k or ("[" .. tostring(k) .. "]")
          pieces[#pieces + 1] = ni .. ks .. " = " .. rec(v[k], ni, depth + 1)
        end
      end
      seen[v] = nil
      if #pieces == 0 then return "{}" end
      return "{\n" .. table.concat(pieces, ",\n") .. "\n" .. indent .. "}"
    else
      return "<" .. t .. ">"
    end
  end
  return rec(root, "", 0)
end
"#;

/// Wrap the user's source: prepend the serializer, run the user code inside a
/// `pcall` (so a runtime error becomes data, not a chunk failure), and return a
/// table carrying either the serialized result or the error message. A bare
/// `return X` in the user source returns `X` from the inner function.
pub fn wrap_source(user: &str) -> String {
    format!(
        "{SERIALIZER}\nlocal __cb_ok, __cb_val = pcall(function()\n{user}\nend)\n\
         return {{ result = __cb_ok and __cb_dump(__cb_val) or nil, \
         __error = (not __cb_ok) and tostring(__cb_val) or nil }}\n"
    )
}

/// A `print` implementation for the REPL, prepended after the serializer. The
/// parser env has no native `print`, so this *defines* it: each call tab-joins
/// its `tostring`'d args into `__cb_buf`. Avoids `select` (not guaranteed in the
/// env) by using `{...}` + `#`; trailing `nil` args are dropped, which is fine
/// for a console. The buffer is a captured upvalue so the driver can reset it.
const PRINT_SHIM: &str = r#"
local __cb_buf = {}
print = function(...)
  local __cb_args = {...}
  local __cb_parts = {}
  for __cb_j = 1, #__cb_args do __cb_parts[#__cb_parts + 1] = tostring(__cb_args[__cb_j]) end
  __cb_buf[#__cb_buf + 1] = table.concat(__cb_parts, "\t")
end
"#;

/// The driver loop appended after the per-chunk function definitions. Runs each
/// chunk under `pcall`; resets `__cb_buf` right before the final chunk so only
/// its prints survive; stops at the first error, tagging `__diverged` when that
/// error came from a replayed (non-final) chunk.
const DRIVER: &str = r#"
local __cb_result, __cb_err, __cb_diverged
for __cb_i = 1, __cb_n do
  if __cb_i == __cb_n then __cb_buf = {} end
  local __cb_ok, __cb_val = pcall(__cb_chunks[__cb_i])
  if not __cb_ok then
    __cb_err = tostring(__cb_val)
    if __cb_i < __cb_n then __cb_diverged = tostring(__cb_i) end
    break
  end
  if __cb_i == __cb_n then __cb_result = __cb_dump(__cb_val) end
end
return { result = __cb_result, __error = __cb_err, __diverged = __cb_diverged, prints = table.concat(__cb_buf, "\n") }
"#;

/// Wrap a session's `chunks` into one script: serializer + `print` shim + each
/// chunk as its own function in `__cb_chunks`, followed by the driver loop. Each
/// chunk is a separate function body so globals persist across chunks while a
/// bare `return` only exits its own chunk (concatenation would abort the rest).
pub fn wrap_chunks(chunks: &[String]) -> String {
    let mut s = String::with_capacity(SERIALIZER.len() + PRINT_SHIM.len() + DRIVER.len() + 256);
    s.push_str(SERIALIZER);
    s.push_str(PRINT_SHIM);
    s.push_str("local __cb_chunks = {}\n");
    for (i, chunk) in chunks.iter().enumerate() {
        s.push_str(&format!(
            "__cb_chunks[{}] = function()\n{}\nend\n",
            i + 1,
            chunk
        ));
    }
    s.push_str(&format!("local __cb_n = {}\n", chunks.len()));
    s.push_str(DRIVER);
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlua::Lua;

    /// Evaluate a wrapped script in stock Lua 5.1 and return its `(result,
    /// __error)` fields — exactly what the worker reads back from unitsync.
    fn eval(user: &str) -> (Option<String>, Option<String>) {
        let lua = Lua::new();
        let t: mlua::Table = lua.load(wrap_source(user)).eval().unwrap();
        (t.get("result").ok(), t.get("__error").ok())
    }

    #[test]
    fn dumps_a_returned_table() {
        let (result, err) = eval(r#"return { a = 1, b = "x", t = { 10, 20 } }"#);
        let r = result.expect("expected a result string");
        assert!(err.is_none() || err.as_deref() == Some(""));
        assert!(r.contains("a = 1"), "got: {r}");
        assert!(r.contains(r#"b = "x""#), "got: {r}");
        assert!(r.contains("10") && r.contains("20"), "got: {r}");
    }

    #[test]
    fn scalar_return_is_serialized() {
        let (result, _) = eval("return 1 + 1");
        assert_eq!(result.as_deref(), Some("2"));
    }

    #[test]
    fn no_return_yields_nil() {
        let (result, _) = eval("local x = 5");
        assert_eq!(result.as_deref(), Some("nil"));
    }

    #[test]
    fn runtime_error_is_captured() {
        let (result, err) = eval(r#"error("boom")"#);
        assert!(result.is_none() || result.as_deref() == Some(""));
        assert!(err.unwrap().contains("boom"));
    }

    /// The four fields the worker reads back from a `wrap_chunks` script.
    struct Repl {
        result: Option<String>,
        error: Option<String>,
        diverged: Option<String>,
        prints: Option<String>,
    }

    /// Evaluate a wrapped multi-chunk session in stock Lua 5.1 and return its
    /// four fields. Empty strings are normalized to `None` to match the FFI
    /// reader, which drops empty `lpGetStrKeyStrVal` results.
    fn eval_chunks(chunks: &[&str]) -> Repl {
        let owned: Vec<String> = chunks.iter().map(|s| s.to_string()).collect();
        let lua = Lua::new();
        let t: mlua::Table = lua.load(wrap_chunks(&owned)).eval().unwrap();
        let get = |k: &str| {
            t.get::<Option<String>>(k)
                .ok()
                .flatten()
                .filter(|s| !s.is_empty())
        };
        Repl {
            result: get("result"),
            error: get("__error"),
            diverged: get("__diverged"),
            prints: get("prints"),
        }
    }

    #[test]
    fn globals_persist_across_chunks() {
        let r = eval_chunks(&["x = 41", "return x + 1"]);
        assert_eq!(r.result.as_deref(), Some("42"));
        assert!(r.error.is_none());
    }

    #[test]
    fn locals_do_not_leak_across_chunks() {
        // A local in chunk 1 is out of scope in chunk 2, so `y` reads as nil.
        let r = eval_chunks(&["local y = 5", "return y"]);
        assert_eq!(r.result.as_deref(), Some("nil"));
    }

    #[test]
    fn early_return_does_not_abort_later_chunks() {
        let r = eval_chunks(&["return 99", "return 7"]);
        assert_eq!(r.result.as_deref(), Some("7"));
    }

    #[test]
    fn only_final_chunk_prints_are_returned() {
        let r = eval_chunks(&[r#"print("from replay")"#, r#"print("from final")"#]);
        assert_eq!(r.prints.as_deref(), Some("from final"));
    }

    #[test]
    fn print_joins_multiple_typed_args_with_tabs() {
        let r = eval_chunks(&[r#"print("a", 1, true)"#]);
        assert_eq!(r.prints.as_deref(), Some("a\t1\ttrue"));
    }

    #[test]
    fn final_chunk_error_still_returns_prints() {
        let r = eval_chunks(&[r#"print("before"); error("boom")"#]);
        assert!(r.error.as_deref().unwrap().contains("boom"));
        assert_eq!(r.prints.as_deref(), Some("before"));
        assert!(
            r.diverged.is_none(),
            "final-chunk error is not a divergence"
        );
    }

    #[test]
    fn replayed_chunk_error_sets_diverged() {
        let r = eval_chunks(&[r#"error("stale")"#, "return 1"]);
        assert_eq!(r.diverged.as_deref(), Some("1"));
        assert!(r.error.as_deref().unwrap().contains("stale"));
        assert!(
            r.result.is_none(),
            "final chunk never runs after divergence"
        );
    }

    #[test]
    fn single_chunk_matches_old_semantics() {
        let r = eval_chunks(&["return 1 + 1"]);
        assert_eq!(r.result.as_deref(), Some("2"));
        assert!(r.error.is_none());
        assert!(r.prints.is_none());
    }
}
