//! `--lua` mode: run a user Lua snippet through unitsync's restricted `LuaParser`
//! with one archive mounted, and return the value it produces.
//!
//! unitsync's Lua parser has no usable stdout/`print`; the only readable output
//! is a table the chunk `return`s, queried via the `lpGet*` C API. Rather than
//! walk an arbitrary nested table from Rust, we inject a tiny Lua serializer and
//! wrap the user's code so the chunk returns the serialized value (or the error
//! message, if the user code raised) as a string. Rust reads that string back
//! with `lpGetStrKeyStrVal`, in [`CHUNKED_RESULT`] pieces so no value is capped
//! by unitsync's string buffer.

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

/// Every string unitsync hands back, including each `lpGetStrKeyStrVal` value,
/// comes through one fixed 100,000 byte buffer. A longer value is replaced by
/// unitsync's own "Increase STRBUF_SIZE (needs N bytes)" complaint, which reads
/// back as perfectly ordinary data, so a game whose unit list outgrew the buffer
/// silently became one unit with a nonsense name.
///
/// This is the writing half of the fix: `__cb_chunk(s)` splits a value of any
/// size into buffer-sized pieces under `result1`..`resultN`, with the count in
/// `resultChunks`, and [`crate::ffi::Unitsync::run_lua_source`] reads them back
/// and joins them. Splitting is by byte offset, not by line, so the pieces
/// concatenate with no separator.
///
/// `prefix` names the field it writes, so one script can chunk several values.
/// The REPL wrapper chunks its result, its `print` output and its error message
/// into one shared table, passed as `extra`.
pub const CHUNKED_RESULT: &str = r#"
local function __cb_chunk(s, extra, prefix)
  local out = extra or {}
  prefix = prefix or 'result'
  s = (type(s) == 'string') and s or ''
  local size = 60000
  local n = 0
  local i = 1
  while i <= #s do
    n = n + 1
    out[prefix .. n] = string.sub(s, i, i + size - 1)
    i = i + size
  end
  out[prefix .. 'Chunks'] = tostring(n)
  return out
end
"#;

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
/// `return X` in the user source returns `X` from the inner function. The result
/// goes back in [`CHUNKED_RESULT`] pieces, so a value bigger than unitsync's
/// string buffer survives.
pub fn wrap_source(user: &str) -> String {
    format!(
        "{SERIALIZER}{CHUNKED_RESULT}\nlocal __cb_ok, __cb_val = pcall(function()\n{user}\nend)\n\
         return __cb_chunk(__cb_ok and __cb_dump(__cb_val) or nil, \
         {{ __error = (not __cb_ok) and tostring(__cb_val) or nil }})\n"
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
/// chunk under `pcall`, resets `__cb_buf` right before the final chunk so only
/// its prints survive, and stops at the first error, tagging `__diverged` when
/// that error came from a replayed (non-final) chunk.
///
/// The result, the prints and the error message each go back in
/// [`CHUNKED_RESULT`] pieces. All three are user-sized: a console session can
/// dump a whole unitdef table, print thousands of lines, or raise an error built
/// from either, and any of them can outgrow unitsync's string buffer.
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
local __cb_out = __cb_chunk(__cb_result, nil, 'result')
__cb_chunk(table.concat(__cb_buf, "\n"), __cb_out, 'prints')
__cb_chunk(__cb_err, __cb_out, 'error')
__cb_out.__diverged = __cb_diverged
return __cb_out
"#;

/// Wrap a session's `chunks` into one script: serializer + `print` shim + each
/// chunk as its own function in `__cb_chunks`, followed by the driver loop. Each
/// chunk is a separate function body so globals persist across chunks while a
/// bare `return` only exits its own chunk (concatenation would abort the rest).
pub fn wrap_chunks(chunks: &[String]) -> String {
    let mut s = String::with_capacity(SERIALIZER.len() + PRINT_SHIM.len() + DRIVER.len() + 256);
    s.push_str(SERIALIZER);
    s.push_str(CHUNKED_RESULT);
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

    /// Rejoin one chunked field of a wrapped script's table, the way the FFI
    /// reader does. `None` when the field is empty.
    fn field(t: &mlua::Table, prefix: &str) -> Option<String> {
        let n: usize = t
            .get::<String>(format!("{prefix}Chunks"))
            .unwrap_or_else(|_| panic!("{prefix} has no chunk count"))
            .parse()
            .unwrap();
        let joined: String = (1..=n)
            .map(|i| t.get::<String>(format!("{prefix}{i}")).unwrap())
            .collect();
        Some(joined).filter(|s| !s.is_empty())
    }

    /// Evaluate a wrapped script in stock Lua 5.1 and return its `(result,
    /// __error)` fields, exactly what the worker reads back from unitsync.
    fn eval(user: &str) -> (Option<String>, Option<String>) {
        let lua = Lua::new();
        let t: mlua::Table = lua.load(wrap_source(user)).eval().unwrap();
        let result = field(&t, "result");
        (result, t.get("__error").ok())
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
    /// four fields, rejoining the chunked ones. Empty strings are normalized to
    /// `None` to match the FFI reader, which drops empty values.
    fn eval_chunks(chunks: &[&str]) -> Repl {
        let owned: Vec<String> = chunks.iter().map(|s| s.to_string()).collect();
        let lua = Lua::new();
        let t: mlua::Table = lua.load(wrap_chunks(&owned)).eval().unwrap();
        Repl {
            result: field(&t, "result"),
            error: field(&t, "error"),
            diverged: t
                .get::<Option<String>>("__diverged")
                .ok()
                .flatten()
                .filter(|s| !s.is_empty()),
            prints: field(&t, "prints"),
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

    /// Run `__cb_chunk(<expr>)` in stock Lua 5.1 and return the pieces it made,
    /// in the order the FFI reader reads them.
    fn chunked(expr: &str) -> Vec<String> {
        let lua = Lua::new();
        let t: mlua::Table = lua
            .load(format!("{CHUNKED_RESULT}\nreturn __cb_chunk({expr})"))
            .eval()
            .unwrap();
        let n: usize = t.get::<String>("resultChunks").unwrap().parse().unwrap();
        (1..=n)
            .map(|i| t.get::<String>(format!("result{i}")).unwrap())
            .collect()
    }

    #[test]
    fn a_short_result_is_one_chunk() {
        let pieces = chunked("'armcom\\tArmada Commander'");
        assert_eq!(pieces, vec!["armcom\tArmada Commander"]);
    }

    #[test]
    fn an_empty_result_is_no_chunks() {
        assert!(chunked("''").is_empty());
    }

    #[test]
    fn a_result_past_the_string_buffer_survives_the_round_trip() {
        // XTA's unit list needed 132,890 bytes and came back as unitsync's
        // complaint about its own 100,000 byte buffer. Every piece has to stay
        // under that, and joining them has to give the list back unchanged.
        let line = "unit\tUnit Name\n";
        let pieces = chunked("string.rep('unit\\tUnit Name\\n', 12000)");
        assert!(pieces.len() > 1, "a 180,000 byte result must be split");
        for (i, piece) in pieces.iter().enumerate() {
            assert!(piece.len() < 100_000, "piece {i} is {} bytes", piece.len());
        }
        assert_eq!(pieces.concat(), line.repeat(12_000));
    }

    #[test]
    fn extra_fields_ride_along_with_the_chunks() {
        let lua = Lua::new();
        let t: mlua::Table = lua
            .load(format!(
                "{CHUNKED_RESULT}\nreturn __cb_chunk('x', {{ __error = 'boom' }})"
            ))
            .eval()
            .unwrap();
        assert_eq!(t.get::<String>("__error").unwrap(), "boom");
        assert_eq!(t.get::<String>("result1").unwrap(), "x");
    }

    /// The console is the easiest way to outgrow the buffer: dump a unitdef
    /// table and print a few thousand lines while you are at it. Both come back
    /// through the same 100,000 byte buffer, so both have to be split.
    #[test]
    fn a_big_repl_result_and_its_prints_both_survive() {
        let owned = vec![
            "for i = 1, 3000 do print(string.rep('y', 50)) end\nreturn string.rep('x', 120000)"
                .to_string(),
        ];
        let lua = Lua::new();
        let t: mlua::Table = lua.load(wrap_chunks(&owned)).eval().unwrap();
        for prefix in ["result", "prints"] {
            let n: usize = t
                .get::<String>(format!("{prefix}Chunks"))
                .unwrap()
                .parse()
                .unwrap();
            assert!(n > 1, "{prefix} was not split");
            for i in 1..=n {
                let piece = t.get::<String>(format!("{prefix}{i}")).unwrap();
                assert!(
                    piece.len() < 100_000,
                    "{prefix}{i} is {} bytes",
                    piece.len()
                );
            }
        }
        // The serializer quotes the string, so the result is the 120,000 x's
        // plus a pair of quotes.
        assert_eq!(field(&t, "result").unwrap().len(), 120_002);
        assert_eq!(field(&t, "prints").unwrap().len(), 3000 * 51 - 1);
    }

    #[test]
    fn a_big_repl_error_survives() {
        let r = eval_chunks(&["error(string.rep('z', 120000))"]);
        assert!(r.result.is_none());
        let err = r.error.expect("the chunk raised");
        assert!(err.len() >= 120_000, "error is {} bytes", err.len());
    }

    #[test]
    fn single_chunk_matches_old_semantics() {
        let r = eval_chunks(&["return 1 + 1"]);
        assert_eq!(r.result.as_deref(), Some("2"));
        assert!(r.error.is_none());
        assert!(r.prints.is_none());
    }
}
