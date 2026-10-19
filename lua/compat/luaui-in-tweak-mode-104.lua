-- id: luaui-in-tweak-mode-104
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- widgetHandler:InTweakMode() for widgets that the engine's LuaHandler addon
-- handler runs, as that handler never had it.
--
-- On 104.0 the engine's basic widget handler, cont/LuaUI/widgets.lua, gave each
-- widget a widgetHandler whose InTweakMode said whether the player had the
-- tweak mode on, in which widgets are moved about the screen. Spring 1944 2.31
-- starts LuaHandler/handler.lua and then ran the basic handler on top, which
-- compat manifest 15 skips (luaui-main-include). Its gui_buildbar.lua,
-- gui_plane_autoselect.lua and gui_s44_selbuttons.lua still call
-- widgetHandler:InTweakMode(). LuaHandler has no tweak mode to turn on, so
-- here it always says false, which is what 104.0 said with it off.
--
-- LuaHandler makes a widget's environment in handler:NewAddon. A revision 1
-- widget gets a widgetHandler table of its own there, and every other widget
-- gets the handler itself. handler.lua defines NewAddon and then includes the
-- game's config.lua before it loads any widget, so that include is where
-- NewAddon is wrapped. A widgetHandler that already has InTweakMode keeps it.

local compat = ...

local type = type

local function inTweakMode()
	return false
end

local function give(widgetHandler)
	if type(widgetHandler) == "table" and widgetHandler.InTweakMode == nil then
		widgetHandler.InTweakMode = inTweakMode
	end
end

local wrapped

local function wrap()
	local h = handler
	if h == wrapped or type(h) ~= "table" or h.name ~= "widgetHandler" or type(h.NewAddon) ~= "function" then
		return
	end
	wrapped = h
	give(h)
	local NewAddon = h.NewAddon
	h.NewAddon = function(...)
		local addon = NewAddon(...)
		if type(addon) == "table" then
			give(addon.widgetHandler)
		end
		return addon
	end
end

if type(compat.hook) == "function"
	and type(Script) == "table" and type(Script.GetName) == "function" and Script.GetName() == "LuaUI"
then
	compat.hook("include", function(nextFn, ...)
		wrap()
		return nextFn(...)
	end)
end
