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
use crate::model::LuaExecOutput;
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
}
