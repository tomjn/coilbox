-- id: luaui-main-include
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- include "LuaUI/main.lua" does nothing in LuaUI when that file is its entry.
--
-- Spring 1944 2.31's LuaUI/main.lua starts its own addon handler and then
-- calls include "LuaUI/main.lua", the include function the engine's
-- LuaHandler/Utilities/utils.lua defines, which looks with VFS.RAW_FIRST. On
-- 104.0 that found the basic widget handler the engine installs as loose files
-- beside itself. Since Recoil 2025.01.1, which brought in RmlUi, the engine's
-- LuaUI/main.lua includes rml_setup.lua from an archive only, so as a loose
-- file it stops LuaUI. An engine with no loose LuaUI/ runs the game's own file
-- a second time instead, and that second handler stops on BlockAddon. With the
-- include skipped, the game's own handler runs alone.
--
-- This hooks the global include rather than VFS.Include. VFS.Include given no
-- environment runs the file in that of the function that called it
-- (LuaUtils::PushCurrentFuncEnv), so a Lua function in front of it would give
-- every widget's includes the global environment instead of the widget's own.
--
-- The engine starts LuaUI from luaui.lua when a game has one
-- (rts/Lua/LuaUI.cpp), and then LuaUI/main.lua is a file the game means to
-- include, so a game with luaui.lua is left alone.

local compat = ...

if type(compat.hook) == "function"
	and type(Script) == "table" and type(Script.GetName) == "function" and Script.GetName() == "LuaUI"
	and type(VFS) == "table" and type(VFS.FileExists) == "function"
	and not VFS.FileExists("luaui.lua", VFS.MOD)
then
	compat.hook("include", function(nextFn, filename, ...)
		if type(filename) == "string" and filename:gsub("\\", "/"):lower() == "luaui/main.lua" then
			return
		end
		return nextFn(filename, ...)
	end)
end
