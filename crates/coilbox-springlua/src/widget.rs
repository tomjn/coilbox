//! Reading what a LuaUI widget file says about itself (issue #1284).
//!
//! A widget declares its name, author and the rest in a `GetInfo()` function.
//! The only reliable way to get at that table is to run the file the way a
//! widget handler does: in an environment of its own whose `widget` global is
//! that environment, then call `GetInfo` from it.
//!
//! Top level code in a widget often reads engine globals, such as
//! `local vsx, vsy = Spring.GetViewGeometry()`. Here every engine global is a
//! stand-in that can be indexed, called and used in arithmetic, and a call
//! returns nothing. Lua's own libraries are the sandbox's real ones.
//!
//! When the file stops with an error after it has defined `GetInfo`, which is
//! where most widgets define it, the info is still read. The game has the real
//! engine behind those globals, so a stand-in failing is not the widget failing.

use mlua::{Function, Table, Value};
use serde::Serialize;

use crate::{Error, Result, SpringLua};

/// What a widget's `GetInfo()` returned, the fields every handler reads. A
/// field the widget left out, or gave a value of the wrong type, is `None`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetInfo {
    pub name: Option<String>,
    pub desc: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    /// A number is turned into text, because widgets write `version = 2` as
    /// often as `version = "2.1"`.
    pub version: Option<String>,
    pub license: Option<String>,
    pub layer: Option<f64>,
    pub enabled: Option<bool>,
}

/// Builds the widget's environment. A function rather than one table, so each
/// read starts from an empty environment.
const WIDGET_ENV: &str = r#"
local G = _G
local rawget, setmetatable, ipairs = rawget, setmetatable, ipairs
local standin
local meta = {
  __index = function() return standin end,
  __newindex = function() end,
  __call = function() end,
}
for _, op in ipairs({ "__add", "__sub", "__mul", "__div", "__mod", "__pow", "__unm", "__concat" }) do
  meta[op] = function() return standin end
end
standin = setmetatable({}, meta)
-- Globals the sandbox defines for config files that a widget must not get:
-- an empty Spring table makes every Spring.X() call an error, and the VFS
-- would read the player's folder for files that live in the game archive.
local engine = { Spring = true, VFS = true, Game = true }
return function()
  local env = {}
  env.widget = env
  -- Its own _G too, or `_G.VFS` would reach past the stand-ins.
  env._G = env
  setmetatable(env, {
    __index = function(_, key)
      if not engine[key] then
        local value = rawget(G, key)
        if value ~= nil then return value end
      end
      return standin
    end,
  })
  return env
end
"#;

/// The error's own message, without the stack traceback mlua appends.
fn message(error: &Error) -> String {
    let text = error.to_string();
    match text.find("\nstack traceback:") {
        Some(cut) => text[..cut].to_string(),
        None => text,
    }
    .trim()
    .to_string()
}

fn text(table: &Table, key: &str) -> Option<String> {
    match table.raw_get::<Value>(key).ok()? {
        Value::String(s) => Some(s.to_string_lossy()),
        Value::Integer(n) => Some(n.to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl SpringLua {
    /// Run widget source `src` and return what its `GetInfo()` returned.
    /// `None` when the file ran without an error and defines no `GetInfo`,
    /// which is what a helper file a widget includes looks like. `name` labels
    /// the chunk in error messages. An error is the message to show beside the
    /// file, one line, with no traceback.
    pub fn widget_info(
        &self,
        src: &str,
        name: &str,
    ) -> std::result::Result<Option<WidgetInfo>, String> {
        self.read_widget(src, name).map_err(|e| message(&e))
    }

    fn read_widget(&self, src: &str, name: &str) -> Result<Option<WidgetInfo>> {
        let make_env: Function = self
            .lua
            .load(WIDGET_ENV)
            .set_name("springlua:widget")
            .eval()?;
        let env: Table = make_env.call(())?;
        let chunk = self
            .lua
            .load(src)
            .set_name(name)
            .set_environment(env.clone())
            .into_function()?;
        let ran = chunk.call::<()>(());
        let Value::Function(get_info) = env.raw_get::<Value>("GetInfo")? else {
            return ran.map(|()| None);
        };
        let info = match get_info.call::<Value>(env) {
            Ok(info) => info,
            Err(e) => return Err(ran.err().unwrap_or(e)),
        };
        let Value::Table(info) = info else {
            return Err(ran
                .err()
                .unwrap_or_else(|| Error::RuntimeError("GetInfo did not return a table".into())));
        };
        Ok(Some(WidgetInfo {
            name: text(&info, "name"),
            desc: text(&info, "desc"),
            author: text(&info, "author"),
            date: text(&info, "date"),
            version: text(&info, "version"),
            license: text(&info, "license"),
            layer: match info.raw_get::<Value>("layer")? {
                Value::Integer(n) => Some(n as f64),
                Value::Number(n) => Some(n),
                _ => None,
            },
            enabled: match info.raw_get::<Value>("enabled")? {
                Value::Boolean(b) => Some(b),
                _ => None,
            },
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_raw(src: &str) -> std::result::Result<Option<WidgetInfo>, String> {
        let dir = std::env::temp_dir();
        SpringLua::new(dir).unwrap().widget_info(src, "test.lua")
    }

    fn read(src: &str) -> std::result::Result<WidgetInfo, String> {
        read_raw(src)?.ok_or_else(|| "no GetInfo".to_string())
    }

    #[test]
    fn reads_a_method_style_get_info() {
        let info = read(
            r#"
            function widget:GetInfo()
              return { name = "Build Watch", desc = "Watches builds", author = "someone",
                       version = 2, license = "GPLv2", layer = -5, enabled = true }
            end
            "#,
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("Build Watch"));
        assert_eq!(info.desc.as_deref(), Some("Watches builds"));
        assert_eq!(info.author.as_deref(), Some("someone"));
        assert_eq!(info.version.as_deref(), Some("2"));
        assert_eq!(info.license.as_deref(), Some("GPLv2"));
        assert_eq!(info.layer, Some(-5.0));
        assert_eq!(info.enabled, Some(true));
    }

    #[test]
    fn reads_a_global_get_info() {
        let info = read(r#"function GetInfo() return { name = "Old" } end"#).unwrap();
        assert_eq!(info.name.as_deref(), Some("Old"));
        assert_eq!(info.desc, None);
    }

    #[test]
    fn engine_globals_are_stand_ins() {
        let info = read(
            r#"
            local spGetUnitPosition = Spring.GetUnitPosition
            local vsx, vsy = Spring.GetViewGeometry()
            local key = KEYSYMS.F11
            local n = GL.TRIANGLES + 1
            include("keysym.h.lua")
            WG.foo = 1
            local path = LUAUI_DIRNAME .. "Widgets/"
            function widget:GetInfo() return { name = "Uses engine", layer = n } end
            "#,
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("Uses engine"));
        assert_eq!(info.layer, None);
    }

    #[test]
    fn get_info_defined_before_a_top_level_error_is_still_read() {
        let info = read(
            r#"
            function widget:GetInfo() return { name = "Early" } end
            local vsx = Spring.GetViewGeometry()
            local half = vsx / 2 + nil
            "#,
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("Early"));
    }

    #[test]
    fn a_file_that_fails_before_get_info_reports_the_error() {
        let err = read(
            r#"
            local x = nil + 1
            function widget:GetInfo() return { name = "Late" } end
            "#,
        )
        .unwrap_err();
        assert!(err.contains("arithmetic"), "{err}");
        assert!(!err.contains("stack traceback"), "{err}");
    }

    #[test]
    fn a_syntax_error_is_reported() {
        let err = read("function widget:GetInfo( return {} end").unwrap_err();
        assert!(err.contains("test.lua"), "{err}");
    }

    #[test]
    fn a_file_that_runs_and_defines_no_get_info_is_not_a_widget() {
        assert_eq!(read_raw("local x = 1"), Ok(None));
    }

    #[test]
    fn a_file_that_fails_and_defines_no_get_info_reports_the_error() {
        let err = read_raw("local x = nil + 1").unwrap_err();
        assert!(err.contains("arithmetic"), "{err}");
    }

    #[test]
    fn underscore_g_is_the_widget_environment() {
        let info = read(
            r#"
            local loaded = _G.VFS.LoadFile("anything.lua")
            function widget:GetInfo() return { name = type(loaded), desc = tostring(_G == widget) } end
            "#,
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("nil"));
        assert_eq!(info.desc.as_deref(), Some("true"));
    }

    #[test]
    fn get_info_returning_nothing_says_so() {
        let err = read("function widget:GetInfo() end").unwrap_err();
        assert!(err.contains("did not return a table"), "{err}");
    }

    #[test]
    fn exec_hatches_stay_closed() {
        // `loadstring` is a stand-in here, so the call returns nothing rather
        // than compiling code outside the environment.
        let info = read(
            r#"
            local f = loadstring("return 1")
            function widget:GetInfo() return { name = tostring(f), desc = type(os) } end
            "#,
        )
        .unwrap();
        assert_eq!(info.name.as_deref(), Some("nil"));
        assert_eq!(info.desc.as_deref(), Some("table"));
    }
}
