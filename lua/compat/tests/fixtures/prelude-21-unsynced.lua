-- Written by coilbox's compatibility mode from compat manifest 21, unsynced state.
-- Each fix below is a file in lua/compat/ in the coilbox repository.
-- license: MIT or GNU GPL, v2 or later

local compat = {}

local function failed(id, err)
	local message = "coilbox compat fix " .. id .. " failed: " .. tostring(err)
	if type(Spring) == "table" and type(Spring.Log) == "function" then
		Spring.Log("coilbox-compat", type(LOG) == "table" and LOG.ERROR or "error", message)
	elseif type(Spring) == "table" and type(Spring.Echo) == "function" then
		Spring.Echo(message)
	end
end

-- fix: compat-callin-hooks-v2
do
local ok, err = pcall(function(...)
-- id: compat-callin-hooks-v2
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The helpers every other fix in the prelude uses. It must come first in a
-- manifest.
--
-- This replaces compat-callin-hooks, which called rawget and rawset. A synced
-- Lua state has neither (rts/Lua/LuaHandleSynced.cpp, CSyncedLuaHandle::Init).
-- This version reads and writes the global table plainly, with its metatable
-- taken off for the moment, so it needs no function a synced state lacks.
--
-- compat.define(t, name, fn) puts fn at t[name] only when nothing is there, so
-- a function the engine still has is left alone.
--
-- compat.hook(name, fn, keep) runs fn in front of the call-in the game's
-- handler sets as the global `name`. fn is called as fn(nextFn, ...) and passes
-- the call on by calling nextFn. With keep set, the call-in stays registered
-- even when the game's handler has no function for it.
--
-- The engine reads a call-in with a raw lookup of the global table and learns
-- that one has changed from Script.UpdateCallIn (rts/Lua/LuaHandle.cpp,
-- HasCallIn and UpdateCallIn), so the hook's function has to be the global
-- itself and not something a metatable answers with. Every gadget and
-- widget handler sets the global and then calls Script.UpdateCallIn, so that
-- call is where the hook takes the handler's function and puts its own in
-- front. A call-in still in the global when the entry file finishes is
-- registered by the engine then (rts/System/EventHandler.cpp, AddClient).
--
-- The oldest games define call-ins as plain globals in main.lua and never call
-- Script.UpdateCallIn. A __newindex on the global table catches the first time
-- one is set. It cannot catch a plain global written over a call-in that is
-- already set, which is what a hook with keep set leaves in place, so such a
-- game skips those hooks.

local compat = ...

local type = type
local getmetatable, setmetatable = getmetatable, setmetatable

-- A raw read and a raw write of the global table: the metatable is taken off
-- around the access, so neither __index nor __newindex runs.
local function getGlobal(name)
	local meta = getmetatable(_G)
	if type(meta) ~= "table" then
		return _G[name]
	end
	setmetatable(_G, nil)
	local value = _G[name]
	setmetatable(_G, meta)
	return value
end

local function setGlobal(name, value)
	local meta = getmetatable(_G)
	if type(meta) ~= "table" then
		_G[name] = value
		return
	end
	setmetatable(_G, nil)
	_G[name] = value
	setmetatable(_G, meta)
end

function compat.define(t, name, fn)
	if type(t) ~= "table" or t[name] ~= nil then
		return false
	end
	t[name] = fn
	return true
end

local hooks = {}
local kept = {}
local handlers = {}
local composites = {}
local entries = {}

-- The chain for one call-in: each hook in the order its fix was loaded, then
-- whatever the game's handler last set.
local function build(name)
	local nextFn = function(...)
		local handler = handlers[name]
		if handler ~= nil then
			return handler(...)
		end
	end
	local list = hooks[name]
	for i = #list, 1, -1 do
		local fn, after = list[i], nextFn
		nextFn = function(...)
			return fn(after, ...)
		end
	end
	entries[name] = nextFn
end

-- Takes whatever the handler has put in the global, keeps it as the end of the
-- chain, and puts the chain's own function there instead.
local function refresh(name)
	local current = getGlobal(name)
	if current ~= composites[name] then
		handlers[name] = current
	end
	if handlers[name] ~= nil or kept[name] then
		setGlobal(name, composites[name])
	else
		setGlobal(name, nil)
	end
end

function compat.hook(name, fn, keep)
	if hooks[name] == nil then
		hooks[name] = {}
		composites[name] = function(...)
			return entries[name](...)
		end
	end
	local list = hooks[name]
	list[#list + 1] = fn
	if keep then
		kept[name] = true
	end
	build(name)
	refresh(name)
end

local meta = getmetatable(_G)
if meta == nil then
	meta = {}
	setmetatable(_G, meta)
end
if type(meta) == "table" and meta.__newindex == nil then
	meta.__newindex = function(t, name, value)
		setGlobal(name, value)
		if hooks[name] ~= nil then
			refresh(name)
		end
	end
end

if type(Script) == "table" and type(Script.UpdateCallIn) == "function" then
	local update = Script.UpdateCallIn
	Script.UpdateCallIn = function(name, ...)
		if hooks[name] ~= nil then
			refresh(name)
		end
		return update(name, ...)
	end
end
end, compat)
if not ok then failed("compat-callin-hooks-v2", err) end
end

-- fix: gl-smoothing
do
local ok, err = pcall(function(...)
-- id: gl-smoothing
-- catalogue: removed:gl.Smoothing
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- gl.Smoothing, which does nothing.
--
-- Changelog, 104.0: "remove gl.Smoothing". In 103.0.1 it turned OpenGL point,
-- line and polygon smoothing on or off (rts/Lua/LuaOpenGL.cpp) and returned
-- nothing. The engine no longer offers the switch, so a call changes nothing.

local compat = ...

if type(gl) == "table" then
	compat.define(gl, "Smoothing", function() end)
end
end, compat)
if not ok then failed("gl-smoothing", err) end
end

-- fix: spring-make-font
do
local ok, err = pcall(function(...)
-- id: spring-make-font
-- catalogue: removed:Spring.MakeFont
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.MakeFont, which makes no font and returns nil.
--
-- Last registered in 0.81.2.1, where it wrote a bitmap font from a TrueType
-- file (rts/Lua/LuaUnsyncedCtrl.cpp). Current Lua loads a font with
-- gl.LoadFont instead. Returning nil lets code that only made a font at start
-- carry on.

local compat = ...

if type(Spring) == "table" then
	compat.define(Spring, "MakeFont", function()
		return nil
	end)
end
end, compat)
if not ok then failed("spring-make-font", err) end
end

-- fix: spring-update-info-texture
do
local ok, err = pcall(function(...)
-- id: spring-update-info-texture
-- catalogue: removed:Spring.UpdateInfoTexture
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.UpdateInfoTexture, which updates nothing and returns false.
--
-- Changelog, 99.0: "remove Spring.UpdateInfoTexture". In 98.0.1 it updated one
-- of the ground info textures in the background and returned whether it did
-- (rts/Lua/LuaUnsyncedCtrl.cpp). false is what it returned when it could not.

local compat = ...

if type(Spring) == "table" then
	compat.define(Spring, "UpdateInfoTexture", function()
		return false
	end)
end
end, compat)
if not ok then failed("spring-update-info-texture", err) end
end

-- fix: spring-sun-parameters
do
local ok, err = pcall(function(...)
-- id: spring-sun-parameters
-- catalogue: removed:Spring.SetSunParameters, removed:Spring.SetSunManualControl
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetSunParameters and Spring.SetSunManualControl, which do nothing.
--
-- Changelog, 104.0: "remove Spring.SetSunParameters and
-- Spring.SetSunManualControl". In 103.0.1 both worked only on a map with a
-- dynamic sun and returned nothing (rts/Lua/LuaUnsyncedCtrl.cpp). The current
-- engine has no dynamic sun, so the sun stays where the map puts it.

local compat = ...

if type(Spring) == "table" then
	compat.define(Spring, "SetSunParameters", function() end)
	compat.define(Spring, "SetSunManualControl", function() end)
end
end, compat)
if not ok then failed("spring-sun-parameters", err) end
end

-- fix: game-version-104
do
local ok, err = pcall(function(...)
-- id: game-version-104
-- catalogue: renamed:Game.version, renamed:Game.versionFull, renamed:Game.versionPatchSet
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Game.version, Game.versionFull and Game.versionPatchSet, read from Engine.
--
-- Changelog, 104.0: "Game.{version,versionFull,versionPatchSet,buildFlags} now
-- reside in the Engine table". The engine still fills Engine's in every Lua
-- state (rts/Lua/LuaConstEngine.cpp), so this copies each into Game where Game
-- has nothing by that name. A game that reads Game.version, as Spring 1944's
-- unit_weaponToggle.lua does, gets the current engine's version string.

if type(Game) == "table" and type(Engine) == "table" then
	for _, key in ipairs({ "version", "versionFull", "versionPatchSet" }) do
		if Game[key] == nil then
			Game[key] = Engine[key]
		end
	end
end
end, compat)
if not ok then failed("game-version-104", err) end
end

-- fix: spring-ground-info-105
do
local ok, err = pcall(function(...)
-- id: spring-ground-info-105
-- catalogue: signature:Spring.GetGroundInfo@105.0
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetGroundInfo with the results in their 104 order.
--
-- Changelog, 105.0: "return the terrain-type index from Spring.GetGroundInfo
-- and Spring.GetTerrainTypeData. These functions now push [number index,
-- string name, ...] rather than [string name, ...]". In 103.0 it returned the
-- terrain type's name, the metal, hardness, the tank, kbot, hover and ship
-- speeds and receiveTracks (rts/Lua/LuaSyncedRead.cpp, PushTerrainTypeData).
-- The current engine returns the type's index in front of those, so a game
-- that reads the metal second, as Spring 1944's game_flagManager.lua does, gets
-- the name, a string.
--
-- This drops the index. It wraps only a GetGroundInfo whose first result is a
-- number, which the old order never gives, so running the prelude a second
-- time in one state leaves the order alone. A game whose Lua reads the new
-- order does not get this fix (see coilbox_compat::for_game).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetGroundInfo) ~= "function" then
	return
end

local getGroundInfo = Spring.GetGroundInfo
local ok, first = pcall(getGroundInfo, 0, 0)
if not ok or type(first) ~= "number" then
	return
end

local select = select

Spring.GetGroundInfo = function(x, z)
	return select(2, getGroundInfo(x, z))
end
end, compat)
if not ok then failed("spring-ground-info-105", err) end
end

-- fix: callin-unit-damaged-95
do
local ok, err = pcall(function(...)
-- id: callin-unit-damaged-95
-- catalogue: signature:UnitDamaged@95.0
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The UnitDamaged call-in with the arguments it had before 95.0.
--
-- Changelog, 95.0: "add missing projectileID argument to UnitDamaged".
--
-- Up to 94.1.1 the engine called UnitDamaged(unitID, unitDefID, unitTeam,
-- damage, paralyzer, weaponDefID, attackerID, attackerDefID, attackerTeam)
-- (rts/Lua/LuaHandle.cpp). Now projectileID comes after weaponDefID, so a
-- handler written for the old list reads the projectile as the attacker. This
-- drops projectileID before the game's handler sees the call.

local compat = ...

compat.hook("UnitDamaged", function(nextFn, unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, projectileID, attackerID, attackerDefID, attackerTeam)
	return nextFn(unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, attackerID, attackerDefID, attackerTeam)
end)
end, compat)
if not ok then failed("callin-unit-damaged-95", err) end
end

-- fix: game-identity
do
local ok, err = pcall(function(...)
-- id: game-identity
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Game.gameName and Game.gameVersion read as the base game's own.
--
-- The engine fills both from the first archive it loads, which in compatibility
-- mode is the mutator, so a game that shows or compares either gets the
-- mutator's name and its manifest number. The mutator's modinfo.lua carries the
-- base game's values as compatbasename and compatbaseversion, and this copies
-- them over. A modinfo.lua without them leaves Game as the engine made it.
--
-- Game.gameShortName is not touched. The mutator's modinfo.lua already declares
-- the base game's short name.

if type(Game) == "table" and type(VFS) == "table" and type(VFS.Include) == "function" then
	local info = VFS.Include("modinfo.lua", nil, VFS.MOD)
	if type(info) == "table" then
		if type(info.compatbasename) == "string" then
			Game.gameName = info.compatbasename
		end
		if type(info.compatbaseversion) == "string" then
			Game.gameVersion = info.compatbaseversion
		end
	end
end
end, compat)
if not ok then failed("game-identity", err) end
end

-- fix: snext-spairs-sipairs
do
local ok, err = pcall(function(...)
-- id: snext-spairs-sipairs
-- catalogue: removed:snext, removed:spairs, removed:sipairs
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- snext, spairs and sipairs, as next, pairs and ipairs.
--
-- Changelog, 2025.01.1: "removed `snext`, `spairs` and `sipairs`. These
-- functions can be replaced by the regular `next`, `pairs`, and `ipairs`
-- respectively with no change in behaviour." (commit d083766c74).
--
-- Before 97.0 they walked the old SYNCED proxy. From 97.0 a read of SYNCED
-- gives a copy, and LuaSyncedTable::PushEntries (rts/Lua/LuaSyncedTable.cpp)
-- set the three globals to the state's own next, pairs and ipairs. The engine
-- called it only in the unsynced half of LuaRules and LuaGaia, the same call
-- that sets SYNCED, so this defines them only where SYNCED is a table. LuaUI
-- never had them.
--
-- The engine's LuaGadgets/gadgets.lua gives each gadget a copy of the System
-- table its system.lua builds, not the globals, and that file listed the three
-- until the same commit. Old games load the engine's handler, so this also adds
-- them to System when it is first set.

local compat = ...

if type(SYNCED) ~= "table" then
	return
end

local type, getmetatable, setmetatable, rawset = type, getmetatable, setmetatable, rawset

local aliases = { snext = next, spairs = pairs, sipairs = ipairs }

local function fill(t)
	for name, fn in pairs(aliases) do
		compat.define(t, name, fn)
	end
end

fill(_G)

if type(System) == "table" then
	fill(System)
	return
end

local meta = getmetatable(_G)
if meta == nil then
	meta = {}
	setmetatable(_G, meta)
end
if type(meta) ~= "table" then
	return
end

-- The global table has no System yet, so its first assignment goes through
-- __newindex. Whatever handled that before still does.
local previous = meta.__newindex
meta.__newindex = function(t, name, value)
	if name == "System" and type(value) == "table" then
		fill(value)
	end
	if type(previous) == "function" then
		return previous(t, name, value)
	elseif type(previous) == "table" then
		previous[name] = value
	else
		rawset(t, name, value)
	end
end
end, compat)
if not ok then failed("snext-spairs-sipairs", err) end
end

-- fix: spring-get-team-info-105
do
local ok, err = pcall(function(...)
-- id: spring-get-team-info-105
-- catalogue: signature:Spring.GetTeamInfo@105.0
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetTeamInfo with its last two results in the order they had before
-- 105.0.
--
-- Changelog, 105.0: "Spring.GetTeamInfo: switched the last two return values
-- around (incomeMultiplier is now 7th, customKeys is now 8th)".
--
-- From 83.0 to 104.0.1 GetTeamInfo(teamID) returned teamID, leader, isDead,
-- hasAI, side, allyTeam, the table of the team's custom keys and then its
-- income multiplier, or nothing for a team that does not exist
-- (rts/Lua/LuaSyncedRead.cpp). A game written for that order reads the keys
-- 7th, and now gets a number there. This swaps the two back.
--
-- The engine since takes a second argument, and returns no keys and only
-- seven values when it is false. An old game never passes it, and those seven
-- are passed on as they are.
--
-- Coilbox leaves this fix out for a game whose own Lua already reads the new
-- order (crates/coilbox-compat, ADAPTERS).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetTeamInfo) ~= "function" then
	return
end

local select = select
local GetTeamInfo = Spring.GetTeamInfo

local function counted(...)
	return select("#", ...), ...
end

local function reorder(n, teamID, leader, isDead, hasAI, side, allyTeam, incomeMultiplier, customKeys)
	if n == 0 then
		return
	elseif n == 8 then
		return teamID, leader, isDead, hasAI, side, allyTeam, customKeys, incomeMultiplier
	end
	return teamID, leader, isDead, hasAI, side, allyTeam, incomeMultiplier
end

Spring.GetTeamInfo = function(...)
	return reorder(counted(GetTeamInfo(...)))
end
end, compat)
if not ok then failed("spring-get-team-info-105", err) end
end

-- fix: luaui-main-include
do
local ok, err = pcall(function(...)
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
end, compat)
if not ok then failed("luaui-main-include", err) end
end

-- fix: luaui-font-handler-104
do
local ok, err = pcall(function(...)
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
end, compat)
if not ok then failed("luaui-font-handler-104", err) end
end

-- fix: luaui-in-tweak-mode-104
do
local ok, err = pcall(function(...)
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
end, compat)
if not ok then failed("luaui-in-tweak-mode-104", err) end
end

-- fix: spring-selected-units-counts-n
do
local ok, err = pcall(function(...)
-- id: spring-selected-units-counts-n
-- catalogue: signature:Spring.GetSelectedUnitsCounts@BAR105 1544
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the table Spring.GetSelectedUnitsCounts returns.
--
-- The engine's doc/changelog.txt, under the breaking changes since 105.0,
-- says the tables Spring.GetSelectedUnitsSorted and
-- Spring.GetSelectedUnitsCounts return no longer have that key, and that the
-- number of unit defs is now their second result instead.
--
-- On 104.0 the table held the number of selected units of each unit def,
-- keyed by unit def ID, and n held how many unit defs it had, 0 when nothing
-- was selected (rts/Lua/LuaUnsyncedRead.cpp). Spring 1944 2.31's
-- gui_s44_selbuttons.lua reads n and does arithmetic on it. This counts the
-- table's keys into n when the engine has not set it.
--
-- 104.0 returned the table alone. The widget passes on every result of
-- Spring.GetSelectedUnitsCounts from a function whose second result it takes
-- as a transport's unit ID, so the count the engine now returns second is
-- dropped.
--
-- Coilbox leaves this fix out for a game whose own Lua already takes that
-- second result (crates/coilbox-compat, ADAPTERS).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetSelectedUnitsCounts) ~= "function" then
	return
end

local type, pairs = type, pairs
local GetSelectedUnitsCounts = Spring.GetSelectedUnitsCounts

local function withN(units)
	if type(units) == "table" and units.n == nil then
		local n = 0
		for _ in pairs(units) do
			n = n + 1
		end
		units.n = n
	end
	return units
end

Spring.GetSelectedUnitsCounts = function(...)
	return withN(GetSelectedUnitsCounts(...))
end
end, compat)
if not ok then failed("spring-selected-units-counts-n", err) end
end

-- fix: spring-selected-units-sorted-n
do
local ok, err = pcall(function(...)
-- id: spring-selected-units-sorted-n
-- catalogue: signature:Spring.GetSelectedUnitsSorted@BAR105 1544
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the table Spring.GetSelectedUnitsSorted returns.
--
-- The engine's doc/changelog.txt, under the breaking changes since 105.0,
-- says the tables Spring.GetSelectedUnitsSorted and
-- Spring.GetSelectedUnitsCounts return no longer have that key, and that the
-- number of unit defs is now their second result instead.
--
-- On 104.0 the table held an array of the selected units of each unit def,
-- keyed by unit def ID, and n held how many unit defs it had, 0 when nothing
-- was selected (rts/Lua/LuaUnsyncedRead.cpp). Spring 1944 2.31's
-- gui_s44_selbuttons.lua compares n with the count it keeps. This counts the
-- table's keys into n when the engine has not set it.
--
-- 104.0 returned the table alone, so the count the engine now returns second
-- is dropped, as spring-selected-units-counts-n does for
-- Spring.GetSelectedUnitsCounts.
--
-- Coilbox leaves this fix out for a game whose own Lua already takes that
-- second result (crates/coilbox-compat, ADAPTERS).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetSelectedUnitsSorted) ~= "function" then
	return
end

local type, pairs = type, pairs
local GetSelectedUnitsSorted = Spring.GetSelectedUnitsSorted

local function withN(units)
	if type(units) == "table" and units.n == nil then
		local n = 0
		for _ in pairs(units) do
			n = n + 1
		end
		units.n = n
	end
	return units
end

Spring.GetSelectedUnitsSorted = function(...)
	return withN(GetSelectedUnitsSorted(...))
end
end, compat)
if not ok then failed("spring-selected-units-sorted-n", err) end
end

-- fix: cmd-removed-ids
do
local ok, err = pcall(function(...)
-- id: cmd-removed-ids
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- CMD.AISELECT and CMD.SET_WANTED_MAX_SPEED, with their IDs 30 and 70.
--
-- Changelog, 105.0: "remove CMD_SET_WANTED_MAX_SPEED". Recoil 2025.01.1 then
-- removed CMD_AISELECT, which did nothing (commit d33c07aa26, "Get rid of
-- CMD_AISELECT"). Until then rts/Lua/LuaConstCMD.cpp put each in the CMD
-- table both ways, name to ID and ID to name, with the IDs
-- rts/Sim/Units/CommandAI/Command.h gave them.
--
-- Complete Annihilation stable-8405 uses both as table keys, and a nil key
-- stops ca_layout.lua, gui_chili_commandmenu.lua and gui_jumpjets.lua as they
-- load. No command a current engine has uses either ID. An order a game gives
-- with one is handed to the game's CommandFallback and then dropped, as any
-- command the engine does not know is (rts/Sim/Units/CommandAI/CommandAI.cpp),
-- so the order does nothing, as AISELECT already did.

local CMD = CMD
if type(CMD) ~= "table" then
	return
end

local function restore(name, id)
	if CMD[name] == nil and CMD[id] == nil then
		CMD[name] = id
		CMD[id] = name
	end
end

restore("AISELECT", 30)
restore("SET_WANTED_MAX_SPEED", 70)
end, compat)
if not ok then failed("cmd-removed-ids", err) end
end

-- fix: spring-array-n-83
do
local ok, err = pcall(function(...)
-- id: spring-array-n-83
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the arrays of IDs and names the functions below return.
--
-- Changelog, 83.0: "remove the "n" field from array-like tables returned by
-- API functions" (commits 1874b58f97 and 40c0a0af81). In 0.82.7.1 each of these
-- functions set n to how many entries its array had (rts/Lua/LuaSyncedRead.cpp
-- and LuaUnsyncedRead.cpp). Complete Annihilation stable-8405's gui_buildbar.lua
-- counts to Spring.GetTeamUnits(teamID).n, and on a current engine stops on a
-- nil loop limit.
--
-- n is given by a metatable whose __index answers #t for it, rather than set
-- on the table. pairs and next then see only the IDs, so a game written for 83.0
-- or later that walks one of these arrays with pairs is not given an extra key.
-- A table that already has a metatable is left alone. Every other result is
-- passed on as it is.
--
-- These are the flat arrays the change took n from that a current engine still
-- has. The keyed tables of Spring.GetTeamUnitsSorted and
-- Spring.GetTeamUnitsCounts kept their n, and the command queues, command
-- descriptions and key bindings are not covered.

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

local type, getmetatable, setmetatable = type, getmetatable, setmetatable

local counted = {
	__index = function(t, key)
		if key == "n" then
			return #t
		end
	end,
}

local function withN(t, ...)
	if type(t) == "table" and getmetatable(t) == nil then
		setmetatable(t, counted)
	end
	return t, ...
end

local function wrap(name)
	local original = Spring[name]
	if type(original) ~= "function" then
		return
	end
	Spring[name] = function(...)
		return withN(original(...))
	end
end

-- rts/Lua/LuaSyncedRead.cpp, in both states.
wrap("GetAllyTeamList")
wrap("GetTeamList")
wrap("GetPlayerList")
wrap("GetAllUnits")
wrap("GetTeamUnits")
wrap("GetTeamUnitsByDefs")
wrap("GetUnitsInRectangle")
wrap("GetUnitsInBox")
wrap("GetUnitsInCylinder")
wrap("GetUnitsInSphere")
wrap("GetUnitsInPlanes")
wrap("GetFeaturesInRectangle")
wrap("GetUnitIsTransporting")
wrap("GetAllFeatures")
wrap("GetUnitPieceList")

-- rts/Lua/LuaUnsyncedRead.cpp, in the unsynced state only.
wrap("GetSelectedUnits")
wrap("GetGroupUnits")
end, compat)
if not ok then failed("spring-array-n-83", err) end
end

-- fix: spring-get-has-lag
do
local ok, err = pcall(function(...)
-- id: spring-get-has-lag
-- catalogue: removed:Spring.GetHasLag
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetHasLag, removed in 105.0 (commit 13a636710e, "nuke
-- Spring.GetHasLag").
--
-- In 104.0.1 GetHasLag(maxLatency) returned whether the simulation was behind,
-- from CGame::IsLagging with maxLatency defaulting to 500 milliseconds
-- (rts/Lua/LuaUnsyncedRead.cpp). The same commit renamed that to
-- CGame::IsSimLagging, and a current engine returns its answer, for the same
-- argument and default, 4th from Spring.GetGameState. Complete Annihilation
-- stable-8405's dbg_dcicon.lua calls GetHasLag in DrawScreen.

local Spring = Spring
if type(Spring) ~= "table" or Spring.GetHasLag ~= nil or type(Spring.GetGameState) ~= "function" then
	return
end

local select = select
local GetGameState = Spring.GetGameState

Spring.GetHasLag = function(maxLatency)
	return select(4, GetGameState(maxLatency)) == true
end
end, compat)
if not ok then failed("spring-get-has-lag", err) end
end

-- fix: unit-defs-weapons-n-83
do
local ok, err = pcall(function(...)
-- id: unit-defs-weapons-n-83
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on UnitDefs[id].weapons in unsynced Lua.
--
-- Changelog, 83.0: "remove the "n" field from array-like tables returned by
-- API functions" (commit 1874b58f97). In 0.82.7.1 the weapons table of a unit
-- def had n set to how many weapons it held (rts/Lua/LuaUnitDefs.cpp,
-- WeaponsTable). Complete Annihilation stable-8405's unit_healthbars.lua,
-- gui_defenserange.lua and unit_customformations2.lua count to
-- ud.weapons.n, and on a current engine stop on a nil loop limit.
--
-- Each entry of UnitDefs is a proxy that builds a new weapons table on every
-- read, and whose __newindex refuses the name. So this reads it once per unit
-- def and writes it back with rawset, with a metatable whose __index answers
-- #t for n, as spring-array-n-83 does. Every later read then gets that same
-- table rather than a new one, so a widget that changes it changes it for
-- every widget. The synced state has no rawset (rts/Lua/LuaHandleSynced.cpp),
-- so it is not given this fix. buildOptions lost its n in the same change and
-- is not covered.

local UnitDefs = UnitDefs
if type(UnitDefs) ~= "table" or type(rawset) ~= "function" or type(rawget) ~= "function" then
	return
end

local type, pairs, rawget, rawset = type, pairs, rawget, rawset
local getmetatable, setmetatable = getmetatable, setmetatable

local counted = {
	__index = function(t, key)
		if key == "n" then
			return #t
		end
	end,
}

for _, ud in pairs(UnitDefs) do
	if type(ud) == "table" and rawget(ud, "weapons") == nil then
		local weapons = ud.weapons
		if type(weapons) == "table" and getmetatable(weapons) == nil then
			rawset(ud, "weapons", setmetatable(weapons, counted))
		end
	end
end
end, compat)
if not ok then failed("unit-defs-weapons-n-83", err) end
end

-- fix: weapon-defs-lua-consts-87-v2
do
local ok, err = pcall(function(...)
-- id: weapon-defs-lua-consts-87-v2
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- WeaponDefs[id].areaOfEffect, maxVelocity and onlyTargetCategories in every Lua
-- state. This takes over from weapon-defs-lua-consts-87, which ran unsynced only
-- and did not cover onlyTargetCategories.
--
-- Changelog, 87.0: "remove the following Lua consts: wdef[id].areaOfEffect,
-- wdef[id].maxVelocity & wdef[id].onlyTargetCategories". The engine still knows
-- the three names, so reading one logs "ERROR_TYPE for key" and gives nil
-- (rts/Lua/LuaWeaponDefs.cpp, ADD_DEPRECATED_LUADEF_KEY). Complete Annihilation
-- stable-8405's synced exp_no_air_nuke.lua and lups_shockwaves.lua compare
-- areaOfEffect with a number and stop.
--
-- In 86.0 (rts/Lua/LuaWeaponDefs.cpp and rts/Sim/Weapons/WeaponDefHandler.cpp)
-- areaOfEffect was damageAreaOfEffect, maxVelocity was projectilespeed times 30,
-- the game's frames per second, and onlyTargetCategories was every category,
-- since every weapon def set its bits to 0xffffffff. Game.springCategories has
-- every category name (rts/Lua/LuaConstGame.cpp).
--
-- The synced state has no rawset (rts/Lua/LuaHandleSynced.cpp), an entry's
-- __newindex refuses the three names, and its metatable is protected. WeaponDefs
-- itself is a plain table, so each entry is replaced by a table holding the old
-- values, which passes anything else to the engine's entry. A game takes its
-- entries from WeaponDefs after the prelude has run, so it never sees the old
-- ones.
--
-- The new table has pairs and next of its own. The engine's Next starts its walk
-- of the known names again when it reaches a raw key with a known name
-- (LuaUtils::Next), so it would never end on this table.

local WeaponDefs, Game = WeaponDefs, Game
if type(WeaponDefs) ~= "table" then
	return
end

local type, pairs, next = type, pairs, next
local getmetatable, setmetatable = getmetatable, setmetatable

local categories = {}
local names = type(Game) == "table" and Game.springCategories
if type(names) == "table" then
	for name in pairs(names) do
		categories[name] = true
	end
end

local function withOldValues(def)
	local old = { onlyTargetCategories = categories }
	local area, speed = def.damageAreaOfEffect, def.projectilespeed
	if type(area) == "number" then
		old.areaOfEffect = area
	end
	if type(speed) == "number" then
		old.maxVelocity = speed * 30
	end

	local entry
	local defNext = def.next
	local function entryNext(_, key)
		if key == nil or old[key] == nil then
			local nextKey, value = defNext(def, key)
			if nextKey ~= nil then
				return nextKey, value
			end
			key = nil
		end
		local nextKey = next(old, key)
		if nextKey ~= nil then
			return nextKey, entry[nextKey]
		end
	end

	entry = {
		pairs = function(self)
			return entryNext, self, nil
		end,
		next = entryNext,
	}
	for name, value in pairs(old) do
		entry[name] = value
	end
	return setmetatable(entry, {
		__index = def,
		__newindex = def,
		__metatable = getmetatable(def),
	})
end

for id, def in pairs(WeaponDefs) do
	if type(def) == "table" then
		WeaponDefs[id] = withOldValues(def)
	end
end
end, compat)
if not ok then failed("weapon-defs-lua-consts-87-v2", err) end
end

-- fix: system-log-88
do
local ok, err = pcall(function(...)
-- id: system-log-88
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- LOG is in the System table a game's own gadget handler makes.
--
-- A gadget handler copies System into every gadget's table and runs the gadget
-- with that as its environment, so a gadget sees only what System lists. The
-- engine's LuaGadgets/system.lua has listed LOG since 88.0. A handler copied
-- from before then has its own system.lua with no LOG, as Complete Annihilation
-- stable-8405 does. That did no harm until 89.0.1 changed the engine's
-- LuaGadgets/Gadgets/unit_script.lua to call Spring.Log(section, LOG.INFO, ...).
-- Such a game's unit_script gadget includes that file, reads LOG as nil in
-- gadget:Initialize, and stops the whole handler.
--
-- A game's system.lua runs after the prelude and sets System once, so this adds
-- LOG in the global table's __newindex that compat-callin-hooks-v2 put there. A
-- System that has its own LOG is left alone.

local LOG = LOG
local type = type
local meta = getmetatable(_G)

if type(LOG) == "table" and type(meta) == "table" and type(meta.__newindex) == "function" then
	local newindex = meta.__newindex
	meta.__newindex = function(t, name, value)
		if name == "System" and type(value) == "table" and value.LOG == nil then
			value.LOG = LOG
		end
		return newindex(t, name, value)
	end
end
end, compat)
if not ok then failed("system-log-88", err) end
end

-- fix: callin-game-frame-sync-action-97
do
local ok, err = pcall(function(...)
-- id: callin-game-frame-sync-action-97
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- A function an unsynced gadget gives to AddSyncAction as well as naming it
-- GameFrame does not also run as the GameFrame call-in.
--
-- Up to Spring 96.0 the engine looked for GameFrame only in the synced half of
-- LuaRules and LuaGaia. Since 97.0 each half has its own Lua state, and the
-- unsynced one gets the call-in too. An old gadget could name a function
-- GameFrame in its unsynced half and run it only when its synced half sent a
-- message. A gadget's environment is its own table, so that function is also
-- gadget.GameFrame, and the handler now calls it on every frame with the frame
-- number where the message's value belongs. Complete Annihilation's nano spray
-- gadget uses that number as a key from 0 to 29, and fails on every frame from
-- frame 30.
--
-- The two kinds of function take the same arguments, so what tells them apart
-- is the registration. A function that is a sync action gets (cmd, value), and
-- one that is a call-in gets (self, frame), so no gadget can mean to be both. A
-- gadget's own gadget:GameFrame, which is not a sync action, keeps the call-in.
--
-- Handlers keep their actions in a table they put in gadgetHandler.actionHandler
-- and read AddSyncAction from it on each call. A game's gadgets.lua runs after
-- the prelude and sets gadgetHandler once, so this wraps AddSyncAction in the
-- global table's __newindex that compat-callin-hooks-v2 put there. The gadget's
-- function stays in its table, because its own code may still call it.

local type = type
local meta = getmetatable(_G)

local function watch(handler)
	local actions = handler.actionHandler
	if type(actions) ~= "table" or type(actions.AddSyncAction) ~= "function" then
		return
	end
	local add = actions.AddSyncAction
	actions.AddSyncAction = function(gadget, cmd, func, help)
		if func ~= nil and gadget.GameFrame == func and type(handler.RemoveGadgetCallIn) == "function" then
			handler:RemoveGadgetCallIn("GameFrame", gadget)
		end
		return add(gadget, cmd, func, help)
	end
end

if type(meta) == "table" and type(meta.__newindex) == "function" then
	local newindex = meta.__newindex
	meta.__newindex = function(t, name, value)
		if name == "gadgetHandler" and type(value) == "table" then
			watch(value)
		end
		return newindex(t, name, value)
	end
end
end, compat)
if not ok then failed("callin-game-frame-sync-action-97", err) end
end

-- fix: spring-command-queue-count-105
do
local ok, err = pcall(function(...)
-- id: spring-command-queue-count-105
-- catalogue: signature:Spring.GetCommandQueue@105.0, signature:Spring.GetUnitCommands@105.0, signature:Spring.GetFactoryCommands@105.0
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetCommandQueue, Spring.GetUnitCommands and Spring.GetFactoryCommands
-- returning the whole queue when called with no count, as before 105.0.
--
-- Until then the second argument, how many commands to return, was optional
-- and defaulted to all of them (luaL_optint with -1). RecoilEngine commit
-- 1109bef03e, "make Spring.Get{Unit,Factory}Commands always expect a second
-- argument" (March 2019, first in 105.0), made it luaL_checkint, which raises
-- "number expected, got no value". Spring.GetCommandQueue calls
-- GetUnitCommands, so it fails the same way. Complete Annihilation
-- stable-8405's terraform gadget calls it with the unit alone, and 21 of its
-- gadgets and widgets do the same.
--
-- A call with no count, or a nil one, which luaL_optint also took as the
-- default, gets -1 here. A count the game gave goes through as it came, with
-- the optional third argument after it.
--
-- The prelude is the first line of each of the game's entry files, so no code
-- of the game's has kept the old function in a local by the time this runs. A
-- name the engine does not have is left out.

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

local type = type

for _, key in ipairs({ "GetCommandQueue", "GetUnitCommands", "GetFactoryCommands" }) do
	local get = Spring[key]
	if type(get) == "function" then
		Spring[key] = function(unitID, count, ...)
			if count == nil then
				count = -1
			end
			return get(unitID, count, ...)
		end
	end
end
end, compat)
if not ok then failed("spring-command-queue-count-105", err) end
end
