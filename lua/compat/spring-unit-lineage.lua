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
