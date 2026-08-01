-- Coilbox mission runtime: what a scenario asks for at game start.
--
-- Pure. No engine calls, no state, no globals beyond the Lua standard library.
-- The gadget reads the engine, asks this module what the mission wants, and
-- carries the answer out. That seam is why the start is provable with plain
-- luajit and no engine.

local M = {}

-- Spring's four facings, and the one a unit gets when the scenario does not say.
local DEFAULT_FACING = 0

-- Gap between units the runtime places as a block, in elmos. Two medium units
-- placed this far apart do not spawn inside each other.
local START_UNIT_SPACING = 64

local function sortedKeys(map)
	local keys = {}
	for key in pairs(map) do
		keys[#keys + 1] = key
	end
	table.sort(keys)
	return keys
end

--- The per-team setup, one entry per participant, in participant id order.
--
-- A participant with no engine team number is a spectator or an id that no
-- longer names anything. It is reported and dropped, because nothing can be
-- spawned for a team the engine does not have.
--
-- The bank defaults to nothing rather than to whatever the skirmish would have
-- handed out. A mission's economy is authored, so it has to play the same
-- wherever it was launched from. `resources` is how a scenario asks for more.
--
-- @param mission the compiled mission table
-- @return array of team plans, array of problems to log
function M.teamPlan(mission)
	local teams = mission.teams or {}
	local plan, problems = {}, {}

	for _, id in ipairs(sortedKeys(teams)) do
		local team = teams[id]
		if type(team.team) ~= "number" then
			problems[#problems + 1] = "team " .. id .. " has no engine team number, ignoring it"
		else
			local resources = team.resources or {}
			local income = team.income or {}
			plan[#plan + 1] = {
				id = id,
				team = team.team,
				startUnits = team.startUnits or {},
				metal = resources.metal or 0,
				energy = resources.energy or 0,
				metalIncome = income.metal or 0,
				energyIncome = income.energy or 0,
				noCommander = team.noCommander == true,
			}
		end
	end

	return plan, problems
end

--- Offsets for `count` units packed into a square grid centred on the origin.
--
-- A grid rather than a ring because it needs no trigonometry. Synced Lua asking
-- libm for a sine is how two machines end up with two different battlefields.
function M.gridOffsets(count, spacing)
	local width = 1
	while width * width < count do
		width = width + 1
	end

	local offsets = {}
	for i = 0, count - 1 do
		local column = i % width
		local row = (i - column) / width
		offsets[i + 1] = {
			x = (column - (width - 1) / 2) * spacing,
			z = (row - (width - 1) / 2) * spacing,
		}
	end
	return offsets
end

--- Every unit the mission places at game start: the actors it named, then each
-- team's start units around that team's start position.
--
-- Start positions come in from the caller, keyed by engine team number, because
-- reading them is an engine call and this module does not make any. A team with
-- start units and no start position keeps them unplaced: a mission missing a
-- squad is easier to diagnose than one whose squad turned up in a map corner.
--
-- @param mission the compiled mission table
-- @param plan the result of teamPlan
-- @param startPositions map of engine team number to `{ x = , z = }`
-- @return array of placements, array of problems to log
function M.placements(mission, plan, startPositions)
	local teamById = {}
	for _, team in ipairs(plan) do
		teamById[team.id] = team
	end

	local placements, problems = {}, {}

	for _, actor in ipairs(mission.actors or {}) do
		local team = teamById[actor.team]
		if not team then
			problems[#problems + 1] = string.format(
				"actor %s belongs to team %s, which the mission has no engine team for",
				tostring(actor.id), tostring(actor.team))
		else
			placements[#placements + 1] = {
				actor = actor.id,
				unitDef = actor.unitDef,
				team = team.team,
				x = actor.pos.x,
				z = actor.pos.z,
				facing = actor.facing or DEFAULT_FACING,
				state = actor.state,
			}
		end
	end

	for _, team in ipairs(plan) do
		local count = #team.startUnits
		local origin = startPositions[team.team]
		if count > 0 and not origin then
			problems[#problems + 1] = string.format(
				"team %s has %d start units and no start position, leaving them unplaced", team.id, count)
		elseif count > 0 then
			local offsets = M.gridOffsets(count, START_UNIT_SPACING)
			for i, unitDef in ipairs(team.startUnits) do
				placements[#placements + 1] = {
					unitDef = unitDef,
					team = team.team,
					x = origin.x + offsets[i].x,
					z = origin.z + offsets[i].z,
					facing = DEFAULT_FACING,
				}
			end
		end
	end

	return placements, problems
end

--- The units one group puts on the map, in a grid on the group's own position.
--
-- A group's `units` are counts by def, because that is what the editor draws.
-- The runtime wants one placement each, so they are expanded in the order the
-- scenario lists them and the same group spawns the same block every time.
--
-- @param group one entry from the mission's `groups`
-- @param team the engine team number the group belongs to
-- @return array of placements
function M.groupPlacements(group, team)
	local defs = {}
	for _, entry in ipairs(group.units or {}) do
		local count = math.floor(tonumber(entry.count) or 0)
		for _ = 1, count do
			defs[#defs + 1] = entry.def
		end
	end

	local offsets = M.gridOffsets(#defs, START_UNIT_SPACING)
	local placements = {}
	for i, unitDef in ipairs(defs) do
		placements[i] = {
			group = group.id,
			unitDef = unitDef,
			team = team,
			x = group.pos.x + offsets[i].x,
			z = group.pos.z + offsets[i].z,
			facing = DEFAULT_FACING,
		}
	end
	return placements
end

--- Every prefab's buildings, as placements in map coordinates.
--
-- A prefab is a base the author drags around as one piece, so its buildings are
-- stored as offsets from an origin and resolved against it here. A factory's
-- `queue` and its `repeat` flag ride along on the placement, because only the
-- caller can talk to a factory once it exists.
--
-- @param mission the compiled mission table
-- @param plan the result of teamPlan
-- @return array of placements, array of problems to log
function M.prefabPlacements(mission, plan)
	local teamById = {}
	for _, team in ipairs(plan) do
		teamById[team.id] = team
	end

	local placements, problems = {}, {}

	for _, prefab in ipairs((mission or {}).prefabs or {}) do
		local team = teamById[prefab.team]
		if not team then
			problems[#problems + 1] = string.format(
				"prefab %s belongs to team %s, which the mission has no engine team for",
				tostring(prefab.id), tostring(prefab.team))
		else
			for _, building in ipairs(prefab.buildings or {}) do
				placements[#placements + 1] = {
					prefab = prefab.id,
					unitDef = building.def,
					team = team.team,
					x = prefab.origin.x + building.offset.x,
					z = prefab.origin.z + building.offset.z,
					facing = building.facing or DEFAULT_FACING,
					queue = building.queue,
					-- `repeat` is a Lua keyword, so the compiled mission quotes it.
					repeatQueue = building["repeat"] == true,
				}
			end
		end
	end

	return placements, problems
end

return M
