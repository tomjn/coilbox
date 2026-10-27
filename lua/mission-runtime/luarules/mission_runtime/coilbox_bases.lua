-- Coilbox mission runtime: a base's ground, and a base a trigger places.
--
-- A base may carry terrain steps: walls raised, pads levelled, trenches dug
-- (issue #4799). A player's widget asks builders to make them. The runtime is
-- synced Lua, so it sets the ground itself with Spring.SetHeightMapFunc, which
-- every game has. The ground a step leaves is coilbox_terraform.lua's, a copy
-- of the blueprint widget's port of Zero-K's terraform rules, so a wall stands
-- in a mission exactly as builders would have raised it.
--
-- Every step comes before every building (issue #4817), so a base's ground is
-- set before any of its buildings are created, and they stand on it.
--
-- A base the scenario calls `dormant` is not placed at the start. `spawn_base`
-- places it, ground first, once. A second spawn is reported and does nothing:
-- a raise step is measured from the ground it finds, so setting a base's
-- ground twice would raise its walls twice.

local M = {}

-- Set once a dormant base has been placed, so a runtime reloaded into a running
-- mission does not place it again.
M.RULES_PREFIX = "coilbox_mission_base_"

-- The size of the engine's heightmap squares, in elmos.
local SQUARE = 8

--- A base's steps laid on the map: each point moved from the base's origin to
-- where it stands, every step ahead of every building, and each measured from
-- the ground under the origin. Pure.
-- @param prefab one entry of the compiled mission's `prefabs`
-- @param pivot number the ground height under the origin
-- @return table[] steps the way coilbox_terraform.lua's session takes them
function M.laidSteps(prefab, pivot)
	local origin = prefab.origin
	local laid = {}
	for _, step in ipairs(prefab.terrain or {}) do
		local points = {}
		for i, p in ipairs(step.points or {}) do
			points[i] = { x = origin.x + p.x, z = origin.z + p.z }
		end
		laid[#laid + 1] = {
			kind = step.kind,
			shape = step.shape,
			points = points,
			height = step.height,
			heights = step.heights,
			width = step.width,
			after = 0,
			base = pivot,
		}
	end
	return laid
end

--- Whether a unit of this def stands in a slope's way. Zero-K stops a slope
-- short of anything immobile rather than burying it.
local function blocksSlope(defID)
	local def = UnitDefs[defID]
	return def ~= nil and (def.isBuilding == true or def.isImmobile == true)
end

--- Work out a base's ground and set it on the map.
--
-- One Spring.SetHeightMapFunc call per base. The engine's work after the call
-- grows with the rectangle round every corner it set, and a base's corners
-- are close together, so one call covers them at the least cost.
--
-- @param terraform the coilbox_terraform.lua module
-- @param prefab one entry of the compiled mission's `prefabs`
-- @return number corners set, number steps the rules refused or cancelled
function M.setGround(terraform, prefab)
	if not prefab.terrain or #prefab.terrain == 0 then
		return 0, 0
	end
	local origin = prefab.origin
	local steps = M.laidSteps(prefab, Spring.GetGroundHeight(origin.x, origin.z))

	local session = terraform.session({
		heightAt = Spring.GetGroundHeight,
		corners = { x = Game.mapSizeX / SQUARE + 1, z = Game.mapSizeZ / SQUARE + 1 },
		-- What already stands near the steps: another base, an actor's building.
		structures = function(minX, minZ, maxX, maxZ)
			local found = {}
			for _, unitID in ipairs(Spring.GetUnitsInRectangle(minX, minZ, maxX, maxZ) or {}) do
				local defID = Spring.GetUnitDefID(unitID)
				if defID and blocksSlope(defID) then
					local x, _, z = Spring.GetUnitPosition(unitID)
					found[#found + 1] = {
						x = x,
						z = z,
						def = UnitDefs[defID],
						facing = Spring.GetUnitBuildFacing(unitID) or 0,
					}
				end
			end
			return found
		end,
	})
	local refused = 0
	for _, result in ipairs(session.apply(steps, {})) do
		if result.outcome ~= "built" then
			refused = refused + 1
		end
	end

	local changed = session.changed()
	if #changed > 0 then
		Spring.SetHeightMapFunc(function()
			for _, corner in ipairs(changed) do
				Spring.SetHeightMap(corner.x, corner.z, corner.h)
			end
		end)
	end
	return #changed, refused
end

--- Register `spawn_base` on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `place(prefab)` sets a base's ground and creates its buildings,
--   and answers how many it created. The gadget owns it, because creating a
--   unit and recording an actor are the gadget's.
-- @return the bases handle
function M.register(engine, state, hooks)
	local prefabs = {}
	local excluded = {}
	local gate = state.difficultyGate
	for _, prefab in ipairs((state.mission or {}).prefabs or {}) do
		prefabs[prefab.id] = prefab
		if gate and not gate(prefab.difficulty) then
			excluded[prefab.id] = true
		end
	end

	local handle = {}

	--- Whether a base is on the map: every base that is not dormant from the
	-- start, and a dormant one once it has been placed.
	function handle.placed(id)
		local prefab = prefabs[id]
		if not prefab then
			return false
		end
		if prefab.dormant ~= true then
			return not excluded[id]
		end
		return Spring.GetGameRulesParam(M.RULES_PREFIX .. id) == 1
	end

	--- Place a dormant base, ground first. Answers whether it was placed.
	function handle.spawn(id)
		local prefab = prefabs[id]
		if not prefab then
			engine:report("base:" .. tostring(id), "error",
				"no base named " .. tostring(id) .. ", ignoring it")
			return false
		end
		if excluded[id] then
			engine:report("base-difficulty:" .. tostring(id), "notice", string.format(
				"base %s is not part of this mission at difficulty %s, so nothing was placed",
				tostring(id), tostring(state.difficulty)))
			return false
		end
		if handle.placed(id) then
			engine:report("base-again:" .. tostring(id), "warning", string.format(
				"base %s is already on the map, so it was not placed again", tostring(id)))
			return false
		end
		Spring.SetGameRulesParam(M.RULES_PREFIX .. id, 1)
		hooks.place(prefab)
		return true
	end

	engine:addAction("spawn_base", function(params)
		handle.spawn(params.base)
	end)

	return handle
end

return M
