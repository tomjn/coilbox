//! Sandboxed evaluator for Spring/Recoil Lua config files.
//!
//! Spring config (`mapinfo.lua`, `modinfo.lua`, gamedata, ...) is *arbitrary
//! Lua* that executes inside the engine: it reads a `Spring` global and pulls
//! sibling files out of a `VFS` (the virtual filesystem over the map/game
//! archive). To read such a file robustly we therefore need a real Lua VM plus
//! a faithful-enough environment — not a regex scanner.
//!
//! This crate embeds [`mlua`] (Lua 5.1, Spring's dialect) and installs a
//! **sandbox**: only `table`/`string`/`math` stdlib, base-library exec hatches
//! (`load`/`dofile`/...) removed, an instruction cap against runaway loops, and
//! a [`VFS`](vfs) shim whose backend is the **loose working directory** the user
//! is editing (rooted at one dir, `..`-escapes rejected). That same `VFS` Lua
//! API is what the engine exposes over packaged archives, so config stays
//! portable between "editing loose" and "engine-loaded".
//!
//! The same VM serves a second job in [`unitscript`]: running a *unit* script,
//! which is Spring Lua too but is driven a frame at a time rather than
//! evaluated for a table. Separate sandbox, separate API, one vendored Lua.
//!
//! Scope: **read** loose files only. It is not unitsync — anything needing
//! engine-faithful values (archive contents, unit/mod lists, map options,
//! rendered minimaps, computed/required values resolved against a `.sd7`/`.sdz`)
//! is unitsync's job. Lua *write-back* (serialization) is also out of scope.

mod env;
pub mod unitscript;
mod vfs;

/// The path the engine would read for a VFS-relative one, spelled as the folder
/// on disk spells it. Public because installing into a game folder has to write
/// where the engine will look, which is the same question this crate's `VFS`
/// answers for a read.
pub use vfs::resolve_case;

use std::path::{Path, PathBuf};

use mlua::{Lua, LuaSerdeExt, Value};
use serde::de::DeserializeOwned;

/// Errors surface as [`mlua::Error`] — eval/syntax/sandbox failures come from
/// the VM directly, and VFS path-escapes / IO are mapped to
/// [`mlua::Error::RuntimeError`]. Callers treat any error as "couldn't eval,
/// fall back".
pub use mlua::Error;
pub type Result<T> = std::result::Result<T, Error>;

/// A Lua helper run over a value before it crosses into JSON, numbering the
/// keys of any table that is not a sequence as strings. See
/// [`SpringLua::eval_expr_value`] for why. Nothing here calls into the value
/// being walked: it only reads a table already built and calls `tostring` on
/// a number.
const STRING_KEYS: &str = r#"
local function __keys(value)
  if type(value) ~= "table" then return value end
  local count = 0
  for _ in pairs(value) do count = count + 1 end
  local sequence = count > 0 and #value == count
  local out = {}
  for key, item in pairs(value) do
    if not sequence and type(key) == "number" then key = tostring(key) end
    out[key] = __keys(item)
  end
  return out
end
"#;

/// A sandboxed Lua VM whose `VFS` resolves files under one root directory.
///
/// Construct once per file (or per file-tree, since `VFS.Include` chases
/// siblings within the same VM and shares the instruction budget). Cheap enough
/// to build per read.
pub struct SpringLua {
    lua: Lua,
    root: PathBuf,
}

impl SpringLua {
    /// Build a sandboxed VM whose `VFS` is rooted at `root` (the loose working
    /// directory). Installs `VFS`, a minimal `Spring` stub and the Spring
    /// `lowerkeys` helper; removes `os`/`io`/`package` and the base-library exec
    /// hatches; arms the instruction cap.
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        let lua = env::sandbox(&root)?;
        Ok(Self { lua, root })
    }

    /// The VFS root this VM resolves against.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Evaluate `src` (which must `return` a table, as Spring config does) and
    /// deserialize it into `T`. Keys are lowercased first via the engine's
    /// `lowerkeys` convention, so `T`'s fields are the canonical lowercase
    /// names (`minheight`, `voidwater`, `surfacecolor`, ...) regardless of the
    /// source file's casing. Unknown keys are ignored.
    pub fn eval_to<T: DeserializeOwned>(&self, src: &str, name: &str) -> Result<T> {
        let lowered = self.eval_lowered(src, name)?;
        self.lua.from_value(lowered)
    }

    /// Like [`eval_to`](Self::eval_to) but returns an untyped
    /// [`serde_json::Value`] for callers without a fixed schema. Prefer
    /// [`eval_to`](Self::eval_to) where a schema exists — typed deserialization
    /// drives array-vs-map decisions correctly; the untyped path must guess.
    pub fn eval_value(&self, src: &str, name: &str) -> Result<serde_json::Value> {
        let lowered = self.eval_lowered(src, name)?;
        self.lua.from_value(lowered)
    }

    /// Pull a file through `VFS.Include`, exactly as a gadget loads a data file,
    /// and return what it returned as [`serde_json::Value`].
    ///
    /// No `lowerkeys` here, deliberately. `VFS.Include` hands a gadget the table
    /// the file built, untouched, and a file whose keys are author data (a
    /// compiled mission's team ids and variable names) means something different
    /// once its keys are lowercased. Reading it any other way would check a file
    /// the engine will never see.
    pub fn include_value(&self, name: &str) -> Result<serde_json::Value> {
        let vfs: mlua::Table = self.lua.globals().get("VFS")?;
        let include: mlua::Function = vfs.get("Include")?;
        let value: Value = include.call(name)?;
        if value.is_nil() {
            return Err(Error::RuntimeError(format!(
                "{name}: file did not return a value"
            )));
        }
        self.lua.from_value(value)
    }

    /// Evaluate `src` and return what it returned as [`serde_json::Value`],
    /// with no `lowerkeys` pass. The same "author data, not engine config"
    /// contract as [`include_value`](Self::include_value), but for a chunk the
    /// caller already holds as a string rather than one loaded through
    /// `VFS.Include`. Use this over [`eval_value`](Self::eval_value) whenever
    /// the source did not come from an engine-config file whose casing the
    /// engine itself normalises.
    pub fn eval_value_raw(&self, src: &str, name: &str) -> Result<serde_json::Value> {
        let chunk: Value = self.lua.load(src).set_name(name).eval()?;
        if chunk.is_nil() {
            return Err(Error::RuntimeError(format!(
                "{name}: chunk did not return a value"
            )));
        }
        self.lua.from_value(chunk)
    }

    /// Evaluate a Lua *expression* and return it as [`serde_json::Value`],
    /// numbering any integer key as a string on the way across.
    ///
    /// The plain [`eval_value_raw`](Self::eval_value_raw) fails outright on a
    /// table that is neither a sequence nor string-keyed, because JSON has no
    /// integer keys at all. Real game data is full of them: a unit's second
    /// weapon patched without its first is `{ [2] = ... }`, and a commander's
    /// evolution stages skip numbers. Refusing those means refusing ordinary
    /// data over a detail of the format it is being read into.
    ///
    /// A table that really is a sequence keeps its integer keys and still
    /// crosses as a JSON array, so nothing that already reads one changes
    /// shape. Both of this project's writers turn a `"5"` key back into `[5]`,
    /// so the round trip holds.
    ///
    /// Takes an expression rather than a chunk because the normaliser has to
    /// be applied to the result: pass `{ ... }`, not `return { ... }`.
    pub fn eval_expr_value(&self, expr: &str, name: &str) -> Result<serde_json::Value> {
        let src = format!("{STRING_KEYS}\nreturn __keys({expr})\n");
        let chunk: Value = self.lua.load(&src).set_name(name).eval()?;
        if chunk.is_nil() {
            return Err(Error::RuntimeError(format!(
                "{name}: expression did not evaluate to a value"
            )));
        }
        self.lua.from_value(chunk)
    }

    /// Load + evaluate the chunk, require it to return a value, and apply
    /// `lowerkeys`. Shared by both eval entry points.
    fn eval_lowered(&self, src: &str, name: &str) -> Result<Value> {
        let chunk: Value = self.lua.load(src).set_name(name).eval()?;
        if chunk.is_nil() {
            return Err(Error::RuntimeError(format!(
                "{name}: chunk did not return a value"
            )));
        }
        let lowerkeys: mlua::Function = self.lua.globals().get("__lowerkeys")?;
        lowerkeys.call(chunk)
    }
}
