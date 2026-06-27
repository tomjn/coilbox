//! Sandbox construction: which stdlib is present, what is removed, the
//! instruction cap, and the Lua-side bootstrap (`__lowerkeys`, missing-global
//! recording).

use std::path::Path;

use mlua::{HookTriggers, Lua, LuaOptions, StdLib, Value};

use crate::vfs;

/// Hard cap on instructions executed per VM (covers the whole `VFS.Include`
/// tree, since the hook counts cumulatively). A normal config finishes in a few
/// thousand instructions; this only catches runaway/infinite loops. Generous so
/// legitimate-but-heavy files still pass.
const INSTRUCTION_BUDGET: u32 = 50_000_000;

/// Base-library functions that exist even without `io`/`os`/`package` and can
/// execute arbitrary strings/files or escape the environment. Removed so the
/// only way to pull another file is through our root-confined `VFS`.
const EXEC_HATCHES: &[&str] = &[
    "dofile",
    "loadfile",
    "loadstring",
    "load",
    "getfenv",
    "setfenv",
];

/// Build a fresh sandboxed VM rooted at `root`.
pub fn sandbox(root: &Path) -> mlua::Result<Lua> {
    // Only the pure-data stdlib. `os`/`io`/`package`/`debug` are never loaded,
    // so those globals simply don't exist.
    let lua = Lua::new_with(
        StdLib::TABLE | StdLib::STRING | StdLib::MATH,
        LuaOptions::default(),
    )?;

    // Instruction cap: the hook first fires after BUDGET instructions; we abort
    // there. Files that finish sooner never trigger it.
    lua.set_hook(
        HookTriggers::new().every_nth_instruction(INSTRUCTION_BUDGET),
        |_lua, _debug| {
            Err(mlua::Error::RuntimeError(
                "springlua: instruction budget exceeded (possible infinite loop)".into(),
            ))
        },
    )?;

    let globals = lua.globals();
    for name in EXEC_HATCHES {
        globals.set(*name, Value::Nil)?;
    }

    vfs::install(&lua, root)?;
    install_spring_stub(&lua)?;
    bootstrap(&lua)?;
    Ok(lua)
}

/// Minimal `Spring` global. Real config occasionally reads engine constants;
/// stub the table so attribute access doesn't hard-error, and grow it as
/// fixtures reveal what files actually use. Unknown `Spring.*` keys read as nil.
fn install_spring_stub(lua: &Lua) -> mlua::Result<()> {
    let spring = lua.create_table()?;
    lua.globals().set("Spring", spring)?;
    Ok(())
}

/// Lua-side helpers installed into every VM:
/// - `__lowerkeys(t)`: recursively lowercases string keys, mirroring the
///   engine's normalization of `mapinfo.lua`/`modinfo.lua` so typed structs use
///   canonical lowercase field names. Integer keys (e.g. `{r,g,b}` colours) are
///   untouched, so colour arrays survive as sequences.
/// - a `_G` `__index` that records reads of undefined globals into
///   `__missing_globals` (diagnostics: shows what `Spring.*`/globals a file
///   wanted that we don't stub) while returning nil — graceful, not silent.
fn bootstrap(lua: &Lua) -> mlua::Result<()> {
    lua.load(
        r#"
        function __lowerkeys(t)
            if type(t) ~= 'table' then return t end
            local r = {}
            for k, v in pairs(t) do
                if type(k) == 'string' then k = string.lower(k) end
                r[k] = __lowerkeys(v)
            end
            return r
        end

        local _missing = {}
        __missing_globals = _missing
        setmetatable(_G, {
            __index = function(_, k)
                _missing[k] = true
                return nil
            end,
        })
        "#,
    )
    .set_name("springlua:bootstrap")
    .exec()
}
