-- Written by coilbox's compatibility mode from compat manifest 6, unsynced state.
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

-- fix: compat-callin-hooks
do
local ok, err = pcall(function(...)
-- id: compat-callin-hooks
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- The helpers every other fix in the prelude uses. It must come first in a
-- manifest.
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

local rawget, rawset, type = rawget, rawset, type
local getmetatable, setmetatable = getmetatable, setmetatable

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
	local current = rawget(_G, name)
	if current ~= composites[name] then
		handlers[name] = current
	end
	if handlers[name] ~= nil or kept[name] then
		rawset(_G, name, composites[name])
	else
		rawset(_G, name, nil)
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
		rawset(t, name, value)
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
if not ok then failed("compat-callin-hooks", err) end
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
