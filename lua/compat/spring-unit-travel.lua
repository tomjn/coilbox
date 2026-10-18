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
