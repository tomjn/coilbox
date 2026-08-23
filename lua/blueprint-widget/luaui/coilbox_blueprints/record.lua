-- Recording: the buildings the player has selected, as a spool entry.
--
-- The mirror of placing. Each building keeps its def name, its offset from an
-- anchor on the build grid and its facing. Footprints come from UnitDefs so
-- coilbox can draw the entry without running unitsync.

local M = {}

local BUILD_SQUARE = 16

local Spring, UnitDefs, Game

--- Hand over the engine tables. A test passes a stub.
-- @param engine table Spring, UnitDefs, Game
function M.use(engine)
	Spring = engine.Spring
	UnitDefs = engine.UnitDefs
	Game = engine.Game
end

--- The selected buildings as a spool entry.
-- @param opts table spoolCount (how many entries the spool already holds, for
--   the name), now (seconds, for recordedAt). designedFor is the map, the
--   same field the library uses for the map a layout was drawn on.
-- @return table? entry, or nil and a message when there is nothing to record
function M.selection(opts)
	local selected = Spring.GetSelectedUnits()
	if #selected == 0 then
		return nil, "nothing is selected"
	end
	local found = {}
	local minX, minZ
	for _, unitID in ipairs(selected) do
		local defID = Spring.GetUnitDefID(unitID)
		local def = defID and UnitDefs[defID]
		if def and def.isBuilding then
			local x, _, z = Spring.GetUnitPosition(unitID)
			if x then
				found[#found + 1] = { def = def, x = x, z = z, facing = Spring.GetUnitBuildFacing(unitID) or 0 }
				minX = math.min(minX or x, x)
				minZ = math.min(minZ or z, z)
			end
		end
	end
	if #found == 0 then
		return nil, "no buildings are selected"
	end
	local ax = math.floor(minX / BUILD_SQUARE) * BUILD_SQUARE
	local az = math.floor(minZ / BUILD_SQUARE) * BUILD_SQUARE
	local buildings, footprints = {}, {}
	for i, b in ipairs(found) do
		buildings[i] = { def = b.def.name, offset = { x = b.x - ax, z = b.z - az }, facing = b.facing % 4 }
		footprints[b.def.name:lower()] = { x = b.def.xsize / 2, z = b.def.zsize / 2 }
	end
	return {
		name = "Base on " .. Game.mapName .. " " .. (opts.spoolCount + 1),
		-- modName, not gameName: coilbox calls a game by its archive name, the
		-- versioned one unitsync reports, and gameName is modinfo's name with no
		-- version on it. Recording gameName gives an entry naming a game no
		-- installed archive is called, so nothing can be drawn with its models.
		game = { name = Game.modName, shortname = Game.gameShortName },
		designedFor = Game.mapName,
		recordedAt = opts.now,
		ordered = false,
		buildings = buildings,
		footprints = footprints,
	}
end

return M
