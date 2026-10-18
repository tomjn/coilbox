-- Written by coilbox's compatibility mode from compat manifest 2, synced state.
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

-- fix: spring-unit-travel
do
local ok, err = pcall(function(...)
-- id: spring-unit-travel
-- catalogue: removed:Spring.GetUnitTravel, removed:Spring.SetUnitTravel
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetUnitTravel and Spring.GetUnitTravel, kept in a table per unit.
--
-- Changelog, 105.0: "remove Spring.{Set,Get}UnitTravel". The engine still
-- registers both, but GetUnitTravel returns 0, 0 for any argument and
-- SetUnitTravel does nothing (rts/Lua/LuaSyncedRead.cpp and LuaSyncedCtrl.cpp).
--
-- In 104.0.1 SetUnitTravel(unitID, travel, period) stored either number, and on
-- every frame a unit that was neither being built nor dead had its speed added
-- to travel, wrapped by period, while period was not 0 (rts/Sim/Units/Unit.cpp,
-- CUnit::Update). GetUnitTravel(unitID) returned travel and period, or nothing
-- for a unit that does not exist.
--
-- This adds the distance when it is read rather than on every frame, using the
-- unit's speed at the time of reading. A unit that speeds up or slows down
-- between two reads is credited at the later speed. Only the synced state keeps
-- a table, so unsynced code keeps the engine's 0, 0.

local compat = ...

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

-- True when the function is gone or is the engine's 105.0 stub. The stub
-- answers 0, 0 for an ID no unit can have, and a working GetUnitTravel answers
-- nothing for it.
local function stubbed(get)
	if get == nil then
		return true
	end
	local ok, travel = pcall(get, -1)
	return ok and travel ~= nil
end

if not stubbed(Spring.GetUnitTravel) then
	return
end

local fmod, tonumber = math.fmod, tonumber
local ValidUnitID = Spring.ValidUnitID
local GetGameFrame = Spring.GetGameFrame
local GetUnitVelocity = Spring.GetUnitVelocity
local GetUnitIsBeingBuilt = Spring.GetUnitIsBeingBuilt

local units = {}

-- Brings a unit's travel up to the current frame.
local function advance(unitID, state)
	local frame = GetGameFrame()
	local frames = frame - state.frame
	state.frame = frame
	if state.period == 0 or frames <= 0 then
		return
	end
	if GetUnitIsBeingBuilt and GetUnitIsBeingBuilt(unitID) then
		return
	end
	local speed = select(4, GetUnitVelocity(unitID)) or 0
	state.travel = fmod(state.travel + speed * frames, state.period)
end

Spring.SetUnitTravel = function(unitID, travel, period)
	if not ValidUnitID(unitID) then
		return
	end
	local state = units[unitID]
	if state == nil then
		state = { travel = 0, period = 0, frame = GetGameFrame() }
		units[unitID] = state
	else
		advance(unitID, state)
	end
	travel, period = tonumber(travel), tonumber(period)
	if travel ~= nil then
		state.travel = travel
	end
	if period ~= nil then
		state.period = period
	end
end

Spring.GetUnitTravel = function(unitID)
	if not ValidUnitID(unitID) then
		return
	end
	local state = units[unitID]
	if state == nil then
		return 0, 0
	end
	advance(unitID, state)
	return state.travel, state.period
end

-- A destroyed unit's ID can be given to a new unit, which starts at 0, 0. The
-- game's own UnitDestroyed still reads the old values.
compat.hook("UnitDestroyed", function(nextFn, unitID, ...)
	nextFn(unitID, ...)
	units[unitID] = nil
end, true)
end, compat)
if not ok then failed("spring-unit-travel", err) end
end

-- fix: spring-set-unit-to-feature
do
local ok, err = pcall(function(...)
-- id: spring-set-unit-to-feature
-- catalogue: removed:Spring.SetUnitToFeature
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetUnitToFeature, through the AllowFeatureCreation call-in.
--
-- Changelog, 105.0: "remove Spring.SetUnitToFeature (use the AllowFeatureCreation
-- callin to block features from being spawned)".
--
-- In 104.0.1 SetUnitToFeature(bool) set one switch for the whole game, true at
-- the start (rts/Sim/Units/Unit.cpp, CUnit::spawnFeature). A unit whose def has
-- isFeature turns into its wreck feature when it is finished. With the switch
-- off it was left as a unit instead. The argument had to be a boolean.
--
-- The current engine makes that wreck in CUnit::FinishedBuilding straight after
-- the UnitFinished call-in, and leaves the unit alone when AllowFeatureCreation
-- refuses it. So with the switch off, UnitFinished notes an isFeature unit's
-- wreck and the next AllowFeatureCreation for that wreck on that frame refuses.

local compat = ...

local Spring = Spring
if type(Spring) ~= "table" or Spring.SetUnitToFeature ~= nil then
	return
end

local spawn = true
local pending = nil

Spring.SetUnitToFeature = function(value)
	if type(value) ~= "boolean" then
		error("bad argument #1 to 'SetUnitToFeature' (boolean expected, got " .. type(value) .. ")", 2)
	end
	spawn = value
end

-- The FeatureDef ID of a unit def's wreck, as CUnit::PreInit looks it up.
local function wreckOf(unitDefID)
	local def = UnitDefs and UnitDefs[unitDefID]
	if def == nil or not def.isFeature or type(def.wreckName) ~= "string" then
		return nil
	end
	local feature = FeatureDefNames and FeatureDefNames[def.wreckName:lower()]
	return feature and feature.id
end

compat.hook("UnitFinished", function(nextFn, unitID, unitDefID, ...)
	pending = nil
	local result = nextFn(unitID, unitDefID, ...)
	if not spawn then
		local featureDefID = wreckOf(unitDefID)
		if featureDefID ~= nil then
			pending = { featureDefID = featureDefID, frame = Spring.GetGameFrame() }
		end
	end
	return result
end, true)

compat.hook("AllowFeatureCreation", function(nextFn, featureDefID, ...)
	local wreck = pending
	pending = nil
	if wreck ~= nil and wreck.featureDefID == featureDefID and wreck.frame == Spring.GetGameFrame() then
		return false
	end
	return nextFn(featureDefID, ...)
end, true)
end, compat)
if not ok then failed("spring-set-unit-to-feature", err) end
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

-- fix: callin-allow-command-105
do
local ok, err = pcall(function(...)
-- id: callin-allow-command-105
-- catalogue: signature:AllowCommand@105.0
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- The AllowCommand call-in with the arguments it had before 105.0.
--
-- Changelog, 105.0: "change {Allow,Unit}Command callin parameters
-- AllowCommand(..., cmdTag, fromSynced) --> AllowCommand(..., cmdTag, playerID,
-- fromSynced, fromLua)".
--
-- Up to 104.0.1 the eighth argument was fromSynced (rts/Lua/LuaHandleSynced.cpp).
-- Now it is playerID, which a handler written for the old list reads as
-- fromSynced, and a number is always true. This drops playerID and fromLua
-- before the game's handler sees the call, and passes its answer back.
--
-- UnitCommand changed in the same release, but only by gaining arguments at
-- the end, which an old handler never reads.

local compat = ...

compat.hook("AllowCommand", function(nextFn, unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOptions, cmdTag, playerID, fromSynced, fromLua)
	return nextFn(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOptions, cmdTag, fromSynced)
end)
end, compat)
if not ok then failed("callin-allow-command-105", err) end
end
