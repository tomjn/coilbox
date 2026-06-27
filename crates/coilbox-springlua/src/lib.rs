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
//! Scope: **read** loose files only. It is not unitsync — anything needing
//! engine-faithful values (archive contents, unit/mod lists, map options,
//! rendered minimaps, computed/required values resolved against a `.sd7`/`.sdz`)
//! is unitsync's job. Lua *write-back* (serialization) is also out of scope.

mod env;
mod vfs;

use std::path::{Path, PathBuf};

use mlua::{Lua, LuaSerdeExt, Value};
use serde::de::DeserializeOwned;

/// Errors surface as [`mlua::Error`] — eval/syntax/sandbox failures come from
/// the VM directly, and VFS path-escapes / IO are mapped to
/// [`mlua::Error::RuntimeError`]. Callers treat any error as "couldn't eval,
/// fall back".
pub use mlua::Error;
pub type Result<T> = std::result::Result<T, Error>;

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
