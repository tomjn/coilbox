-- Written by coilbox's compatibility mode from compat manifest 12, synced state.
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

-- fix: spring-unit-lineage
do
local ok, err = pcall(function(...)
-- id: spring-unit-lineage
-- catalogue: removed:Spring.SetUnitLineage, removed:Spring.GetUnitLineage
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetUnitLineage and Spring.GetUnitLineage, kept in a table per unit.
--
-- Commit 4c3273c343 removed both, with the lineage tracker and the game end
-- conditions it served, so 0.82.7.1 is the last release with them.
--
-- In 0.82.7.1 a unit's lineage was the team it was made on, or the lineage of
-- the unit that built it, made it in a factory or resurrected it
-- (rts/Sim/Units/Unit.cpp, Builder.cpp and Factory.cpp). SetUnitLineage(unitID,
-- teamID, isRoot) set the unit's lineage to teamID, and with isRoot true made
-- the unit that team's lineage root (rts/Lua/LuaSyncedCtrl.cpp). A unit ID that
-- is not a number, or a team that does not exist, raised an error. A unit that
-- does not exist was ignored. GetUnitLineage(unitID) returned the lineage and
-- whether the unit was the root of its own current team, or nothing for a unit
-- that does not exist (rts/Lua/LuaSyncedRead.cpp).
--
-- The engine also killed a root's lineage when the root died, but only in the
-- lineage game mode, which went with the same commit, so this does not.
-- A captured unit took its captor's lineage, which no call-in shows, so here it
-- keeps its own. A destroyed unit stops being a root, so a new unit that gets
-- its ID is not one. Only the synced state keeps the table.

local compat = ...

local Spring = Spring
if type(Spring) ~= "table" or Spring.SetUnitLineage ~= nil or Spring.GetUnitLineage ~= nil then
	return
end

local type, error, tostring = type, error, tostring
local ValidUnitID = Spring.ValidUnitID
local GetUnitTeam = Spring.GetUnitTeam
local GetTeamInfo = Spring.GetTeamInfo

local lineages = {}
local roots = {}

local function lineageOf(unitID)
	local lineage = lineages[unitID]
	if lineage == nil then
		return GetUnitTeam(unitID)
	end
	return lineage
end

Spring.SetUnitLineage = function(unitID, teamID, isRoot)
	if type(unitID) ~= "number" then
		error("SetUnitLineage(): Bad unitID", 2)
	end
	if not ValidUnitID(unitID) then
		return
	end
	if type(teamID) ~= "number" then
		error("SetUnitLineage(): Bad teamID", 2)
	end
	if GetTeamInfo(teamID) == nil then
		error("SetUnitLineage(): Bad teamID: " .. tostring(teamID), 2)
	end
	lineages[unitID] = teamID
	if isRoot == true then
		roots[teamID] = unitID
	end
end

Spring.GetUnitLineage = function(unitID)
	if type(unitID) ~= "number" then
		error("Bad unitID parameter in GetUnitLineage()", 2)
	end
	if not ValidUnitID(unitID) then
		return
	end
	return lineageOf(unitID), roots[GetUnitTeam(unitID)] == unitID
end

compat.hook("UnitCreated", function(nextFn, unitID, unitDefID, unitTeam, builderID, ...)
	if builderID ~= nil and ValidUnitID(builderID) then
		lineages[unitID] = lineageOf(builderID)
	else
		lineages[unitID] = unitTeam
	end
	return nextFn(unitID, unitDefID, unitTeam, builderID, ...)
end, true)

compat.hook("UnitDestroyed", function(nextFn, unitID, ...)
	nextFn(unitID, ...)
	lineages[unitID] = nil
	for teamID, root in pairs(roots) do
		if root == unitID then
			roots[teamID] = nil
		end
	end
end, true)
end, compat)
if not ok then failed("spring-unit-lineage", err) end
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
