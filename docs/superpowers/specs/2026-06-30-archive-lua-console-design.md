# Archive Lua Console — Design

Date: 2026-06-30

## Goal

Provide a lightweight Lua input box, scoped to a content archive, that runs the
typed Lua through the real `libunitsync` Lua parser and shows the result. This is
a debugging aid, not a full REPL: each run is one-shot, the parser environment is
restricted (no `os`/`io`, limited globals), and many engine APIs are
unavailable. The value is running Lua in the actual engine's parser with a real
archive mounted in the VFS.

## Trigger and placement

- The console is reachable **only from the Archives detail page**
  (`content/archives/:name`). The archive is implicit from the route — the user
  has already chosen it by being on that screen. There is **no archive selector**.
- A button in the Archives detail page header/toolbar opens a right-side drawer
  via the frame's built-in `useDrawer()` (same mechanism uberstress's RunPage
  uses). No global topbar slot, no route-aware conditional rendering.
- Map and Game detail pages are also archive-backed and could gain the same
  button later (the command is archive-name-generic), but that is out of scope
  for this work.

## Result model

unitsync's Lua parser is a *read-a-config-table* C API, not a print-based REPL.
The only reliable output channel is the table the script returns, read back via
`lpRootTable` / `lpGet*`. To make any return value (table or scalar) surface
uniformly, the worker wraps the user's source:

```lua
return { result = (function()
  -- user source
end)() }
```

The worker then walks the root table's `result` entry and serializes it to JSON
for display. A script that returns nothing yields `result = nil`, shown as
`null`.

Caveat: wrapping shifts line numbers in any parser error messages by the number
of prepended lines. Acceptable for a debugging tool; the error panel shows the
raw `lpErrorLog()` text regardless.

## Components

### 1. Worker — `crates/coilbox-unitsync-worker`, new `--lua` mode

New CLI mode that takes `--lib`, `--datadir`, `--archive <name>`, and a
`--source-file <path>` (the Lua source is passed via a temp file, not a CLI arg,
to avoid argument-length limits).

Flow:
1. `dlopen` the user's `libunitsync.*`; set data dir (existing init path).
2. `AddAllArchives(archive)` — mount the archive and its dependencies into the
   global VFS so `VFS.Include(...)` resolves against the archive.
3. Read the source file, wrap it (see Result model).
4. `lpOpenSource(wrapped, accessModes)` → `lpExecute()`.
5. On success: `lpRootTable()`, then recursively walk via the key-listing,
   key-type, and value-getter functions; build a JSON value; emit the standard
   JSON envelope on stdout.
6. On failure: emit `lpErrorLog()` plus drained `GetNextError()` messages.

New FFI bindings (added to the existing `Option<fn>` pattern in `ffi.rs`), each
loaded with `opt(...)` and treated as a graceful "unsupported" error if absent in
older libs. **Exact export names to be confirmed against the engine's
`unitsync_api.h` during planning** before any are referenced in code:
`lpOpenSource`, `lpErrorLog`, `AddAllArchives`, and the `lpRootTable` /
`lpSubTable*` / `lpPopTable` / key-listing / key-type / value-getter set required
to walk an arbitrary nested table. (`lpOpenFile` and `lpExecute` are already
bound.)

One-shot per run: a crashing script kills only the throwaway worker process, not
the app.

### 2. Tauri plugin — `crates/tauri-plugin-coilbox-unitsync`, new command

`unitsync_lua_exec(engine_path, data_dir, archive, source)
  -> { ok: bool, result?: Json, error?: string, errors: string[] }`

Reuses the existing `CliResult` spawn/envelope pattern. Writes `source` to a
temp file and passes its path to the worker. Timeout ~30s, matching
`unitsync_minimap`.

### 3. Frontend — in the `content` plugin

- `LuaConsoleDrawer` component: a read-only label showing the bound archive, a
  `Textarea` (registry component) for Lua input, a **Run** button, a result panel
  (pretty-printed JSON, monospace, with a copy action), and a separate error
  panel for `lpErrorLog`/worker errors.
- A trigger button in the Archives detail page header/toolbar that calls
  `useDrawer().open({ title: "Lua Console", side: "right", width: "32rem",
  content: <LuaConsoleDrawer archive={name} enginePath=... dataDir=... /> })`.
  Engine path and data dir are resolved the same way `ArchivesPage` /
  `ArchiveDetailPage` already resolve them.
- New `unitsyncLuaExec` typed binding in `src/content/bindings.ts`, following the
  existing `unitsyncArchiveTree` / `unitsyncArchiveFile` binding style.

## Unhappy paths

- **No engine configured**: Run disabled, drawer shows a hint to configure an
  engine (same precondition the detail page already depends on).
- **Lua syntax/runtime error**: error panel shows the raw `lpErrorLog()` text.
- **Non-table / nil return**: shown as the scalar value / `null` under `result`.
- **Worker timeout or crash**: surfaced as an error in the error panel.
- **A required FFI export missing in the loaded lib**: command returns an error
  explaining the lib lacks Lua-parser support, consistent with how other optional
  functions degrade.

## Testing

- Worker: an integration test that runs `return {a=1}` and asserts the JSON
  output, gated on the presence of a real `libunitsync` via env var, matching the
  existing worker tests' gating (real-lib tests don't run in CI without the lib).
- Frontend: a smoke test that the drawer renders and the result/error panels
  behave (Run triggers the binding; error text renders).

## Out of scope

- A persistent REPL with state across runs.
- Capturing `print`/stdout (the parser env does not provide a usable channel).
- Lua write-back / serialization back into archives.
- The button on Map and Game detail pages (trivial later extension).
- A rich collapsible JSON tree viewer (start with monospace pretty-printed JSON).
