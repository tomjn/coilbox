# Archive Lua Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lua input box, opened from the Archives detail page, that runs the typed Lua through the engine's real `libunitsync` Lua parser (with the current archive mounted) and shows the returned value.

**Architecture:** The one-shot `coilbox-unitsync-worker` gains a `--lua` mode: it `AddAllArchives(archive)` to mount the archive + deps into the VFS, wraps the user's source so it returns a single serialized string (a small Lua serializer is injected, so the parser's own restricted Lua does the pretty-printing — no Rust-side table walk), runs it via `lpOpenSource`/`lpExecute`, and reads that string back with `lpGetStrKeyStrVal`. The `tauri-plugin-coilbox-unitsync` plugin exposes `unitsync_lua_exec` (script passed via a temp file). The frontend hangs a "Lua Console" button off the Archives detail page header that opens a `useDrawer()` panel scoped to that archive.

**Tech Stack:** Rust (`libloading` dlopen FFI, `serde`/`serde_json`), Lua 5.1 (unitsync's `LuaParser`; `mlua` vendored only as a worker dev-dependency for serializer tests), Tauri command plugin, React + `@picoframe/frame` (`useDrawer`, `Button`, `Textarea`).

**Verified before writing (do not re-litigate):**
- `lpOpenSource(const char*, const char*) -> int`, `lpErrorLog() -> const char*`, `lpGetStrKeyStrVal(const char*, const char*) -> const char*`, and `AddAllArchives(const char*)` all exist in the Recoil/Spring `unitsync_api.h`.
- `AddAllArchives` is already bound (`crates/coilbox-unitsync-worker/src/ffi.rs:523`, method `add_all_archives`). `lpExecute`/`lpRootTable`/`lpClose` are already bound as `Option<fn>` fields (`ffi.rs:121-126`). Only `lpOpenSource`, `lpErrorLog`, `lpGetStrKeyStrVal` are new.
- unitsync's `LuaParser` env keeps `pairs`/`ipairs`/`type`/`tostring`/`tonumber` and opens `string`/`table`/`math`; only `dofile`/`loadfile`/`require`/etc. are removed. So a pure-Lua serializer using `pairs`/`type`/`tostring`/`string.format`/`table.concat`/`table.sort` is safe.

**Honesty note on testing:** The serializer + wrapper (the only genuinely new *logic*) is unit-tested with `mlua` (faithful stock Lua 5.1). The `unsafe` FFI sequence and the full worker/command/UI path require a real `libunitsync` and a running app, which CI lacks — those are verified manually in Task 13 via `bun tauri dev`. Do not fabricate tests that pretend to exercise a real `libunitsync`.

---

### Task 1: Worker output model

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/model.rs`

- [ ] **Step 1: Add the `LuaExecOutput` struct**

Append to `crates/coilbox-unitsync-worker/src/model.rs` (match the existing `#[derive(Serialize, Default)] #[serde(rename_all = "camelCase")]` + `skip_serializing_if` style already used by `MinimapOutput`/`ArchiveTreeOutput`):

```rust
/// `--lua` mode output. `result` is the pretty-printed value the script returned
/// (set on success); `error` is a compile/runtime error from the Lua parser (set
/// on failure). Exactly one of the two is normally set. `errors` carries
/// non-fatal unitsync diagnostics (e.g. archive-mount warnings).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LuaExecOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p coilbox-unitsync-worker`
Expected: compiles (warning about unused `LuaExecOutput` is fine until Task 4).

- [ ] **Step 3: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/model.rs
git commit -m "feat(unitsync-worker): add LuaExecOutput model for --lua mode"
```

---

### Task 2: Lua serializer + source wrapper (TDD)

**Files:**
- Create: `crates/coilbox-unitsync-worker/src/lua.rs`
- Modify: `crates/coilbox-unitsync-worker/Cargo.toml` (add `mlua` dev-dependency)
- Modify: `crates/coilbox-unitsync-worker/src/main.rs` (add `mod lua;`)

This task adds only the *pure* pieces: the injected Lua serializer (`SERIALIZER`) and `wrap_source`. The FFI-driven `run()`/`emit_error()` come in Task 4.

- [ ] **Step 1: Add `mlua` as a dev-dependency**

In `crates/coilbox-unitsync-worker/Cargo.toml`, after the `[dependencies]` block, add (version matches `crates/coilbox-springlua/Cargo.toml`):

```toml
[dev-dependencies]
# Stock Lua 5.1 used ONLY to unit-test the injected serializer + wrapper against a
# faithful interpreter (the real test target, unitsync's LuaParser, needs a live
# libunitsync and is exercised manually).
mlua = { version = "0.11", features = ["lua51", "vendored"] }
```

- [ ] **Step 2: Create `lua.rs` with the serializer, wrapper, and failing tests**

Create `crates/coilbox-unitsync-worker/src/lua.rs`:

```rust
//! `--lua` mode: run a user Lua snippet through unitsync's restricted `LuaParser`
//! with one archive mounted, and return the value it produces.
//!
//! unitsync's Lua parser has no usable stdout/`print`; the only readable output
//! is a table the chunk `return`s, queried via the `lpGet*` C API. Rather than
//! walk an arbitrary nested table from Rust, we inject a tiny Lua serializer and
//! wrap the user's code so the chunk returns `{ result = <string> }` (or
//! `{ __error = <string> }` if the user code raised). Rust then reads that one
//! string back with a single `lpGetStrKeyStrVal`.

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
```

- [ ] **Step 3: Register the module**

In `crates/coilbox-unitsync-worker/src/main.rs`, add `mod lua;` to the module list (after `mod game;`, keeping alphabetical-ish order with the others at the top):

```rust
mod archive;
mod config;
mod ffi;
mod game;
mod lua;
mod minimap;
mod model;
```

- [ ] **Step 4: Run the tests — expect them to pass**

Run: `cargo test -p coilbox-unitsync-worker lua::`
Expected: 4 tests pass (`dumps_a_returned_table`, `scalar_return_is_serialized`, `no_return_yields_nil`, `runtime_error_is_captured`).

(If `mlua` vendored build is slow on first compile, that's expected — it builds Lua from source once.)

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitsync-worker/Cargo.toml crates/coilbox-unitsync-worker/src/lua.rs crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): Lua result serializer + source wrapper with tests"
```

---

### Task 3: FFI bindings for the Lua parser source-exec path

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/ffi.rs`

- [ ] **Step 1: Add the new C signature typedef**

In `crates/coilbox-unitsync-worker/src/ffi.rs`, in the typedef block (near `LpOpenFn` at line 38), add:

```rust
type IntByStrStrFn = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int; // lpOpenSource(source, accessModes)
```

- [ ] **Step 2: Add the three struct fields**

In the `Unitsync` struct, in the Lua-parser group (after `lp_str_key_float_val_fn` at line 129), add:

```rust
    lp_open_source_fn: Option<IntByStrStrFn>,
    lp_error_log_fn: Option<StrFn>,
    lp_str_key_str_val_fn: Option<StrByStrStrFn>,
```

- [ ] **Step 3: Resolve the three symbols in `load`**

In `load()`, after `lp_str_key_float_val_fn: opt(&lib, b"lpGetStrKeyFloatVal\0"),` (line 214), add:

```rust
            lp_open_source_fn: opt(&lib, b"lpOpenSource\0"),
            lp_error_log_fn: opt(&lib, b"lpErrorLog\0"),
            lp_str_key_str_val_fn: opt(&lib, b"lpGetStrKeyStrVal\0"),
```

- [ ] **Step 4: Add the `run_lua_source` method**

Add this method inside `impl Unitsync` (place it right after `start_positions`, which ends at line 683, since it shares the Lua-parser idiom):

```rust
    /// Execute a Lua source string through unitsync's `LuaParser` with `modes`
    /// VFS access. The caller must wrap the user's code so the chunk returns a
    /// table with a string `result` field (and an optional `__error` field) —
    /// see [`crate::lua::wrap_source`]. Returns the `result` string on success,
    /// or `Err(message)` for a compile error (`lpOpenSource` failed), a chunk
    /// failure (`lpRootTable` empty), a captured runtime error (`__error` set),
    /// or a build that lacks the Lua-parser symbols.
    pub fn run_lua_source(&self, source: &str, modes: &str) -> Result<String, String> {
        let (Some(open), Some(execute), Some(close), Some(root), Some(get_str)) = (
            self.lp_open_source_fn,
            self.lp_execute_fn,
            self.lp_close_fn,
            self.lp_root_table_fn,
            self.lp_str_key_str_val_fn,
        ) else {
            return Err("this engine's libunitsync does not expose the Lua parser \
                        (lpOpenSource/lpGetStrKeyStrVal)"
                .into());
        };
        let (Ok(csrc), Ok(cmodes), Ok(result_key), Ok(err_key), Ok(empty)) = (
            CString::new(source),
            CString::new(modes),
            CString::new("result"),
            CString::new("__error"),
            CString::new(""),
        ) else {
            return Err("Lua source or arguments contained a NUL byte".into());
        };

        unsafe {
            if open(csrc.as_ptr(), cmodes.as_ptr()) == 0 {
                return Err(self
                    .lp_error_log()
                    .unwrap_or_else(|| "could not compile the script".into()));
            }
            execute();
            if root() == 0 {
                let log = self.lp_error_log();
                close();
                return Err(log.unwrap_or_else(|| {
                    "script did not produce a result table (lpRootTable failed)".into()
                }));
            }
            let runtime_err =
                cstr(get_str(err_key.as_ptr(), empty.as_ptr())).filter(|s| !s.is_empty());
            let result = cstr(get_str(result_key.as_ptr(), empty.as_ptr())).unwrap_or_default();
            close();
            match runtime_err {
                Some(e) => Err(e),
                None => Ok(result),
            }
        }
    }

    /// The Lua parser's accumulated error log, when non-empty.
    fn lp_error_log(&self) -> Option<String> {
        let f = self.lp_error_log_fn?;
        unsafe { cstr(f()) }.filter(|s| !s.is_empty())
    }
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check -p coilbox-unitsync-worker`
Expected: compiles (an unused-method warning for `run_lua_source` is fine until Task 4).

- [ ] **Step 6: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/ffi.rs
git commit -m "feat(unitsync-worker): bind lpOpenSource/lpErrorLog/lpGetStrKeyStrVal + run_lua_source"
```

---

### Task 4: Wire `lua::run` and `lua::emit_error`

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/lua.rs`

- [ ] **Step 1: Add the `run` and `emit_error` functions**

At the top of `crates/coilbox-unitsync-worker/src/lua.rs` (above `pub const SERIALIZER`), add imports and the two functions:

```rust
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
```

- [ ] **Step 2: Verify it compiles and existing tests still pass**

Run: `cargo test -p coilbox-unitsync-worker lua::`
Expected: the 4 serializer tests still pass; no unused warnings for `run`/`emit_error` once `main` calls them (Task 5) — a warning here is acceptable until then.

- [ ] **Step 3: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/lua.rs
git commit -m "feat(unitsync-worker): lua::run mounts archive and runs the script"
```

---

### Task 5: Worker CLI dispatch for `--lua`

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/main.rs`

- [ ] **Step 1: Add the two CLI fields to `Args`**

In `crates/coilbox-unitsync-worker/src/main.rs`, add to the `Args` struct (after `config: bool,` at line 39):

```rust
    /// `--lua`: run a Lua snippet through the parser against `--archive`, reading
    /// the script from `--source-file`.
    lua: bool,
    source_file: Option<String>,
```

- [ ] **Step 2: Parse the new flags**

In `parse_args`, add the locals next to the others (after `let mut config = false;`):

```rust
    let mut lua = false;
    let mut source_file = None;
```

Add the match arms (after `"--config" => config = true,`):

```rust
            "--lua" => lua = true,
            "--source-file" => source_file = it.next(),
```

Add the fields to the returned `Args { ... }` (after `config,`):

```rust
        lua,
        source_file,
```

- [ ] **Step 3: Dispatch `--lua` before the archive-browsing block**

In `run()`, insert this block immediately after the `cache_dir` line (line 68) and **before** the `if args.thumbnails` block — `--lua` also sets `--archive`, so it must be matched first:

```rust
    // Lua console: mount one archive and run a user snippet through the parser.
    if args.lua {
        let archive = args.archive.clone().unwrap_or_default();
        let source = args
            .source_file
            .as_deref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        return match std::panic::catch_unwind(|| lua::run(&args.lib, &archive, &source)) {
            Ok(out) => {
                println!("{}", serde_json::to_string(&out).unwrap_or_default());
                0
            }
            Err(_) => {
                lua::emit_error("worker panicked while executing Lua".into());
                1
            }
        };
    }

```

- [ ] **Step 4: Verify it compiles and the worker still builds**

Run: `cargo build -p coilbox-unitsync-worker`
Expected: builds with no warnings.

- [ ] **Step 5: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/main.rs
git commit -m "feat(unitsync-worker): add --lua/--source-file CLI dispatch"
```

---

### Task 6: Plugin sidecar arg builder (TDD)

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`

- [ ] **Step 1: Add a failing test for `build_lua_args`**

In the `#[cfg(test)] mod tests` block of `crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs`, add:

```rust
    #[test]
    fn build_lua_args_carry_archive_and_source_file() {
        let a = build_lua_args("/eng/libunitsync.so", "/data", "Map v1", "/tmp/x.lua");
        assert!(a.contains(&"--lua".to_string()));
        assert!(a.contains(&"--lib".to_string()) && a.contains(&"--datadir".to_string()));
        assert_eq!(
            &a[a.len() - 4..],
            &[
                "--archive".to_string(),
                "Map v1".to_string(),
                "--source-file".to_string(),
                "/tmp/x.lua".to_string(),
            ]
        );
    }
```

- [ ] **Step 2: Run it — expect a compile failure (function missing)**

Run: `cargo test -p tauri-plugin-coilbox-unitsync build_lua_args`
Expected: FAIL — `cannot find function build_lua_args`.

- [ ] **Step 3: Implement `build_lua_args`**

In `sidecar.rs`, after `build_archive_file_args` (line 128), add:

```rust
/// Build args for `--lua` mode: scan args plus the `--lua` flag, the archive to
/// mount, and the path of the temp file holding the user's Lua source.
pub fn build_lua_args(lib: &str, datadir: &str, archive: &str, source_file: &str) -> Vec<String> {
    let mut args = build_args(lib, datadir);
    args.push("--lua".into());
    args.push("--archive".into());
    args.push(archive.into());
    args.push("--source-file".into());
    args.push(source_file.into());
    args
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cargo test -p tauri-plugin-coilbox-unitsync build_lua_args`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/sidecar.rs
git commit -m "feat(unitsync-plugin): build_lua_args for the --lua worker mode"
```

---

### Task 7: Plugin `unitsync_lua_exec` command

**Files:**
- Modify: `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`

- [ ] **Step 1: Import `build_lua_args`**

In `crates/tauri-plugin-coilbox-unitsync/src/lib.rs`, add `build_lua_args,` to the `use sidecar::{ ... }` import list (alphabetical, before `build_minimap_args`).

- [ ] **Step 2: Add a temp-file helper**

After the `read_to_string` helper (line 150), add:

```rust
/// Write a Lua script to a uniquely-named temp file and return its path. Scripts
/// are passed to the worker by path (not as a CLI arg) because args have length
/// limits and a console script can be large. The caller removes the file after
/// the worker exits.
fn write_temp_script(source: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("coilbox-lua-{pid}-{nanos}.lua"));
    std::fs::write(&path, source).map_err(|e| format!("could not write temp Lua script: {e}"))?;
    Ok(path)
}
```

- [ ] **Step 3: Add the command**

After `unitsync_archive_file` (line 315), add:

```rust
/// `unitsync_lua_exec` — run a Lua snippet through the engine's Lua parser with
/// `archive` (and its dependencies) mounted in the VFS. `source` is the script;
/// it is handed to the worker via a temp file. Returns `{ result?, error?,
/// errors }`.
#[tauri::command]
async fn unitsync_lua_exec(
    engine_path: String,
    data_dir: String,
    archive: String,
    source: String,
) -> Result<CliResult, ()> {
    let (bin, libpath, engine_dir) = match prepare(&engine_path) {
        Ok(v) => v,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let script = match write_temp_script(&source) {
        Ok(p) => p,
        Err(e) => return Ok(CliResult::err(e)),
    };
    let args = build_lua_args(
        &libpath.to_string_lossy(),
        &data_dir,
        &archive,
        &script.to_string_lossy(),
    );
    let envs = loader_envs(&engine_dir, &data_dir);
    let result = run_worker(bin, args, envs, MINIMAP_TIMEOUT, "lua exec").await;
    let _ = std::fs::remove_file(&script);
    Ok(result)
}
```

- [ ] **Step 4: Register the command**

Add `unitsync_lua_exec` to the `generate_handler![ ... ]` list in `init()` (after `unitsync_archive_file`):

```rust
            unitsync_archive_file,
            unitsync_lua_exec
```

- [ ] **Step 5: Verify the plugin compiles**

Run: `cargo check -p tauri-plugin-coilbox-unitsync`
Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-unitsync/src/lib.rs
git commit -m "feat(unitsync-plugin): unitsync_lua_exec command (script via temp file)"
```

---

### Task 8: Frontend binding

**Files:**
- Modify: `src/content/bindings.ts`

- [ ] **Step 1: Add the result type and command**

Append to `src/content/bindings.ts` (after `unitsyncArchiveFile`, line 339):

```ts
export interface LuaExecResult {
  /** The pretty-printed value the script returned (set on success). */
  result?: string;
  /** A compile or runtime error from the Lua parser (set on failure). */
  error?: string;
  /** Non-fatal unitsync diagnostics (e.g. a missing dependency archive). */
  errors: string[];
}

/**
 * Run a Lua snippet through the engine's Lua parser with `archive` (and its
 * dependencies) mounted in the VFS, so `VFS.Include(...)` resolves against it.
 * Restricted, one-shot, no persistent state — a debugging aid, not a REPL. End
 * the script with `return …` to see a value.
 */
export const unitsyncLuaExec = defineCommand<
  { enginePath: string; dataDir: string; archive: string; source: string },
  LuaExecResult
>("coilbox-unitsync", "unitsync_lua_exec");
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/content/bindings.ts
git commit -m "feat(content): unitsyncLuaExec typed binding"
```

---

### Task 9: Frontend hook

**Files:**
- Modify: `src/content/config.ts`

- [ ] **Step 1: Extend the bindings import**

In `src/content/config.ts`, add `type LuaExecResult,` and `unitsyncLuaExec,` to the existing `import { ... } from "./bindings";` block (alphabetical within their groups).

- [ ] **Step 2: Add the imperative hook**

Append to `src/content/config.ts` (after `useUnitsyncMinimap`, the last hook):

```ts
/**
 * Run the Lua console for a target+archive. Unlike the other browser hooks this
 * is imperative (each Run re-executes; nothing is cached): call `run(source)` and
 * read `result` / `loading`. Backend/Lua errors surface in `result.error`.
 */
export function useUnitsyncLuaExec(
  enginePath?: string,
  dataDir?: string,
  archive?: string,
) {
  const [result, setResult] = useState<LuaExecResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (source: string) => {
      if (!enginePath || !dataDir || !archive) return;
      setLoading(true);
      try {
        setResult(await unitsyncLuaExec({ enginePath, dataDir, archive, source }));
      } catch (e) {
        setResult({
          error: e instanceof Error ? e.message : String(e),
          errors: [],
        });
      } finally {
        setLoading(false);
      }
    },
    [enginePath, dataDir, archive],
  );

  return { run, result, loading };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/content/config.ts
git commit -m "feat(content): useUnitsyncLuaExec hook"
```

---

### Task 10: Lua console drawer component

**Files:**
- Create: `src/content/pages/components/LuaConsoleDrawer.tsx`

- [ ] **Step 1: Create the component**

Create `src/content/pages/components/LuaConsoleDrawer.tsx`:

```tsx
import { Button } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useUnitsyncLuaExec } from "../../config";

const DEFAULT_SCRIPT = 'return { hello = "world" }';

/**
 * Drawer body for the Archives detail "Lua Console". Runs the typed Lua through
 * unitsync's restricted parser with the page's archive mounted, and shows the
 * returned value or the parser error. Scoped entirely by props — the archive is
 * fixed by whichever detail page opened the drawer.
 */
export function LuaConsoleDrawer({
  enginePath,
  dataDir,
  archive,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
}) {
  const [source, setSource] = useState(DEFAULT_SCRIPT);
  const { run, result, loading } = useUnitsyncLuaExec(
    enginePath,
    dataDir,
    archive,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Runs in unitsync's restricted Lua parser with{" "}
        <span className="font-mono">{archive}</span> mounted. End your script with{" "}
        <span className="font-mono">return …</span> to see a value. Many engine
        APIs are unavailable; there is no persistent state between runs.
      </p>

      <Textarea
        value={source}
        spellCheck={false}
        aria-label="Lua source"
        className="min-h-40 font-mono text-xs"
        onChange={(e) => setSource(e.target.value)}
      />

      <Button
        size="sm"
        className="gap-1.5 self-start"
        disabled={loading}
        onClick={() => run(source)}
      >
        <Play className="size-4" /> {loading ? "Running…" : "Run"}
      </Button>

      {result?.error != null && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
          {result.error}
        </pre>
      )}

      {result?.result != null && (
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-card p-3 font-mono text-xs">
          {result.result}
        </pre>
      )}

      {result?.errors != null && result.errors.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Diagnostics ({result.errors.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1 font-mono">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `bun run typecheck`
Then: `bunx biome check src/content/pages/components/LuaConsoleDrawer.tsx`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/content/pages/components/LuaConsoleDrawer.tsx
git commit -m "feat(content): LuaConsoleDrawer component"
```

---

### Task 11: Wire the button into the Archives detail page

**Files:**
- Modify: `src/content/pages/ArchiveDetailPage.tsx`

- [ ] **Step 1: Update imports**

In `src/content/pages/ArchiveDetailPage.tsx`:

- Change the frame import (line 1) to add `useDrawer`:

```tsx
import { Button, useDrawer } from "@picoframe/frame";
```

- Add `Terminal` to the lucide import (line 2):

```tsx
import { ArrowLeft, FolderOpen, Terminal } from "lucide-react";
```

- Add the drawer component import next to the other `./components/...` imports:

```tsx
import { LuaConsoleDrawer } from "./components/LuaConsoleDrawer";
```

- [ ] **Step 2: Get the drawer handle**

Inside `ArchiveDetailPage`, after `const navigate = useNavigate();` (line 27), add:

```tsx
  const drawer = useDrawer();
```

- [ ] **Step 3: Add the button to the header action row**

In the `<div className="ml-auto flex shrink-0 gap-2">` block (line 99), add this button as the **first** child (before the `linked` button), guarded on an available scan target:

```tsx
            {selected?.enginePath && selected?.rootPath && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  drawer.open({
                    title: "Lua Console",
                    description: `Run Lua through ${archive.name} via unitsync.`,
                    width: "40rem",
                    content: (
                      <LuaConsoleDrawer
                        enginePath={selected.enginePath}
                        dataDir={selected.rootPath}
                        archive={archive.name}
                      />
                    ),
                  })
                }
              >
                <Terminal className="size-4" /> Lua Console
              </Button>
            )}
```

(`selected` is already in scope from `useScanTargetSelection()` at line 28; `dataDir` uses `selected.rootPath`, the same value passed to `useArchives`/`useUnitsyncArchiveTree` on this page.)

- [ ] **Step 4: Typecheck + lint**

Run: `bun run typecheck`
Then: `bunx biome check src/content/pages/ArchiveDetailPage.tsx`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/pages/ArchiveDetailPage.tsx
git commit -m "feat(content): Lua Console button on the archive detail page"
```

---

### Task 12: Full lint + test suite (CI parity)

**Files:** none (verification only)

Run the **same** commands CI runs (per `CLAUDE.md`). The unitsync worker sidecar must exist for the app crate's clippy to compile.

- [ ] **Step 1: Build the unitsync worker sidecar**

Run: `bun run sidecar:unitsync`
Expected: builds the worker into `src-tauri/binaries` (so the app crate compiles).

- [ ] **Step 2: Rust format check**

Run: `cargo fmt --all --check`
Expected: no diff. If it fails, run `cargo fmt --all` and re-commit the formatting.

- [ ] **Step 3: Rust clippy (all crates, CI flags)**

Run: `cargo clippy --all-targets --all-features -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Rust tests**

Run: `cargo test -p coilbox-unitsync-worker -p tauri-plugin-coilbox-unitsync`
Expected: all pass (4 serializer tests + the sidecar arg tests).

- [ ] **Step 5: Frontend lint + types (CI commands)**

Run: `bunx biome ci .`
Then: `bun run typecheck`
Expected: both pass.

- [ ] **Step 6: Commit any formatting fixups**

```bash
# only if fmt/biome changed files
git add -u
git commit -m "style: lint fixups for archive Lua console"
```

---

### Task 13: Manual verification in the running app

**Files:** none (manual verification — required by `CLAUDE.md` before any PR)

The serializer/wrapper and arg builders are unit-tested, but the real `libunitsync` path and the UI can only be confirmed live. Do this before opening a PR.

- [ ] **Step 1: Launch the app**

Run: `bun tauri dev`
(Lets the user test; the unitsync worker is rebuilt by the dev flow.)

- [ ] **Step 2: Open an archive and the console**

Navigate to Content → Archives → pick any archive → click **Lua Console** in the header. Confirm the drawer opens on the right and names the archive.

- [ ] **Step 3: Run the default script**

With the default `return { hello = "world" }`, click **Run**. Expected: the result panel shows a serialized table containing `hello = "world"`.

- [ ] **Step 4: Exercise the three result paths**

  - VFS read (archive mounted): `return VFS.FileExists("modinfo.lua") or VFS.FileExists("mapinfo.lua")` → expect `true` for a game/map archive whose file is present.
  - Runtime error: `error("boom")` → expect the error panel to show a message containing `boom`.
  - Syntax error: `return {` → expect the error panel to show a parser/compile error.

- [ ] **Step 5: Capture a screenshot for the PR**

Use the Tauri MCP to screenshot the open drawer with a result (the PR touches the GUI, so `CLAUDE.md` requires screenshots). Save it for the PR description.

- [ ] **Step 6: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide on merge/PR. Include the screenshot and a note that real-`libunitsync` behavior was verified manually (CI cannot).

---

## Notes for the implementer

- **Don't add a Rust-side table walk.** The serializer-in-Lua approach is deliberate and keeps the new FFI surface to three symbols. If a script's output looks wrong, fix the Lua `SERIALIZER`, not the FFI.
- **`dataDir` is the content root** (`selected.rootPath`), not the engine dir. The engine dir is `selected.enginePath`. The page already follows this; keep it consistent.
- **VFS modes are `"rmMbe"`** (unitsync's `SPRING_VFS_ALL`), matching `start_positions`. This is what lets `VFS.Include`/`VFS.FileExists` see the mounted archive.
- **One-shot safety:** a script that hard-crashes `libunitsync` only kills the worker process; the command surfaces "worker produced no output". That's expected behavior, not a bug to fix.
