-- id: luaui-font-handler-104
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- A global fontHandler for widgets that the engine's LuaHandler addon handler
-- runs, as that handler never had one.
--
-- On 104.0 the engine's basic widget handler, cont/LuaUI/main.lua, set up a
-- global fontHandler that drew text with fonts of its own. Spring 1944 2.31
-- starts LuaHandler/handler.lua and then ran the basic handler on top, which
-- compat manifest 15 skips (luaui-main-include). Its gui_buildEta.lua and
-- gui_flagIncome.lua still call fontHandler.UseDefaultFont() and then draw with
-- gl.Text. On 104.0 that call only chose the font fontHandler's own drawing
-- functions use, and returned nothing, so here it does nothing.
--
-- LuaHandler/handler.lua copies the globals into each addon's environment
-- when it starts, so fontHandler is set as that file is included, and only
-- when nothing is there. A game that runs the basic handler never includes
-- that file, so the basic handler's fonts.lua still sets up its own.

local compat = ...

local function useDefaultFont()
end

if type(compat.hook) == "function" and type(compat.define) == "function"
	and type(Script) == "table" and type(Script.GetName) == "function" and Script.GetName() == "LuaUI"
then
	compat.hook("include", function(nextFn, filename, ...)
		if type(filename) == "string" and filename:gsub("\\", "/"):lower() == "luahandler/handler.lua" then
			compat.define(_G, "fontHandler", { UseDefaultFont = useDefaultFont })
		end
		return nextFn(filename, ...)
	end)
end
