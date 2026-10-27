-- Recording: the buildings the player has selected, and the ground changed
-- under and round them, as a spool entry. Or the ground changed in a
-- rectangle on its own.
--
-- The mirror of placing. Each building keeps its def name, its offset from an
-- anchor on the build grid and its facing. Footprints come from UnitDefs so
-- coilbox can draw the entry without running unitsync. Ground changes become
-- raise steps by ground.lua, and an entry holding any is marked fromGround,
-- since they were worked back out of the ground rather than drawn.

local M = {}

local BUILD_SQUARE = 16
local SQUARE = 8

local Spring, UnitDefs, Game, GROUND

--- Hand over the engine tables and ground.lua. A test passes a stub.
-- @param engine table Spring, UnitDefs, Game, GROUND
function M.use(engine)
	Spring = engine.Spring
	UnitDefs = engine.UnitDefs
	Game = engine.Game
	GROUND = engine.GROUND
end

--- A building's footprint on the map, in elmos.
local function footprintOf(def, x, z, facing)
	local xs, zs = def.xsize, def.zsize
	if facing % 2 == 1 then
		xs, zs = zs, xs
	end
	return { x0 = x - xs * 4, z0 = z - zs * 4, x1 = x + xs * 4, z1 = z + zs * 4 }
end

--- The change in height at a corner, read once.
local function deltaReader()
	local seen = {}
	return function(x, z)
		local k = x .. ":" .. z
		local d = seen[k]
		if d == nil then
			d = Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z)
			seen[k] = d
		end
		return d
	end
end

local function down8(v)
	return math.floor(v / SQUARE) * SQUARE
end

local function up8(v)
	return math.ceil(v / SQUARE) * SQUARE
end

--- The corners from x0, z0 to x1, z1, kept on the map, as a grid for
-- ground.lua, with the footprints of the buildings standing on it.
-- @return table grid, table[] footprints, table units (footprint index -> unitID)
local function readGrid(x0, z0, x1, z1, deltaAt)
	x0, z0 = math.max(0, up8(x0)), math.max(0, up8(z0))
	x1, z1 = math.min(Game.mapSizeX, down8(x1)), math.min(Game.mapSizeZ, down8(z1))
	local grid = { x = x0, z = z0, w = (x1 - x0) / SQUARE + 1, h = (z1 - z0) / SQUARE + 1, delta = {} }
	if grid.w < 1 or grid.h < 1 then
		grid.w, grid.h = 0, 0
		return grid, {}, {}
	end
	local n = 0
	for z = z0, z1, SQUARE do
		for x = x0, x1, SQUARE do
			n = n + 1
			grid.delta[n] = deltaAt(x, z)
		end
	end
	local footprints, units = {}, {}
	for _, unitID in ipairs(Spring.GetUnitsInRectangle(x0, z0, x1, z1) or {}) do
		local defID = Spring.GetUnitDefID(unitID)
		local def = defID and UnitDefs[defID]
		if def and def.isBuilding then
			local x, _, z = Spring.GetUnitPosition(unitID)
			if x then
				footprints[#footprints + 1] = footprintOf(def, x, z, Spring.GetUnitBuildFacing(unitID) or 0)
				units[#footprints] = unitID
			end
		end
	end
	return grid, footprints, units
end

--- Grow a rectangle while ground on any of its edges is changed, so it holds
-- the whole of every change that reaches into it, up to the map's edge.
local function grow(x0, z0, x1, z1, deltaAt)
	x0, z0 = math.max(0, down8(x0)), math.max(0, down8(z0))
	x1, z1 = math.min(Game.mapSizeX, up8(x1)), math.min(Game.mapSizeZ, up8(z1))
	local function changed(ax, az, bx, bz)
		for x = ax, bx, SQUARE do
			for z = az, bz, SQUARE do
				if GROUND.changed(deltaAt(x, z)) then
					return true
				end
			end
		end
		return false
	end
	local moved = true
	while moved do
		moved = false
		if x0 > 0 and changed(x0, z0, x0, z1) then
			x0, moved = x0 - SQUARE, true
		end
		if x1 < Game.mapSizeX and changed(x1, z0, x1, z1) then
			x1, moved = x1 + SQUARE, true
		end
		if z0 > 0 and changed(x0, z0, x1, z0) then
			z0, moved = z0 - SQUARE, true
		end
		if z1 < Game.mapSizeZ and changed(x0, z1, x1, z1) then
			z1, moved = z1 + SQUARE, true
		end
	end
	return x0, z0, x1, z1
end

--- Regions as steps, offset from an anchor. Every step comes before
-- `before` buildings.
local function stepsOf(regions, ax, az, before)
	local terrain = {}
	for i, r in ipairs(regions) do
		local points = {}
		for j, p in ipairs(r.points) do
			points[j] = { x = p.x - ax, z = p.z - az }
		end
		terrain[i] = { kind = "raise", shape = "area", points = points, height = r.height, before = before }
	end
	return terrain
end

--- A name for ground changes on their own: how many were raised and dug.
function M.groundName(regions)
	local raised, dug = 0, 0
	for _, r in ipairs(regions) do
		if r.height < 0 then
			dug = dug + 1
		else
			raised = raised + 1
		end
	end
	local parts = {}
	if raised > 0 then
		parts[#parts + 1] = raised == 1 and "Raised ground" or (raised .. " raised areas")
	end
	if dug > 0 then
		parts[#parts + 1] = dug == 1 and "dug ground" or (dug .. " dug areas")
	end
	local name = table.concat(parts, ", ")
	return name:sub(1, 1):upper() .. name:sub(2)
end

local function gameOf()
	-- modName, not gameName: coilbox calls a game by its archive name, the
	-- versioned one unitsync reports, and gameName is modinfo's name with no
	-- version on it. Recording gameName gives an entry naming a game no
	-- installed archive is called, so nothing can be drawn with its models.
	return { name = Game.modName, shortname = Game.gameShortName }
end

--- The selected buildings as a spool entry.
-- @param opts table nameFor (function(defs) -> a name saying what they are),
--   now (seconds, for recordedAt). designedFor is the map, the same field the
--   library uses for the map a layout was drawn on.
-- @return table? entry, or nil and a message when there is nothing to record
function M.selection(opts)
	local selected = Spring.GetSelectedUnits()
	if #selected == 0 then
		return nil, "nothing is selected"
	end
	local found = {}
	local minX, minZ
	local box
	for _, unitID in ipairs(selected) do
		local defID = Spring.GetUnitDefID(unitID)
		local def = defID and UnitDefs[defID]
		if def and def.isBuilding then
			local x, _, z = Spring.GetUnitPosition(unitID)
			if x then
				local facing = Spring.GetUnitBuildFacing(unitID) or 0
				found[#found + 1] = { unitID = unitID, def = def, x = x, z = z, facing = facing }
				minX = math.min(minX or x, x)
				minZ = math.min(minZ or z, z)
				local f = footprintOf(def, x, z, facing)
				box = box or { x0 = f.x0, z0 = f.z0, x1 = f.x1, z1 = f.z1 }
				box.x0, box.z0 = math.min(box.x0, f.x0), math.min(box.z0, f.z0)
				box.x1, box.z1 = math.max(box.x1, f.x1), math.max(box.z1, f.z1)
			end
		end
	end
	if #found == 0 then
		return nil, "no buildings are selected"
	end

	-- The ground under the buildings, and any change that reaches into it
	-- followed to its end.
	local regions, standing = {}, {}
	if GROUND then
		local deltaAt = deltaReader()
		local x0, z0, x1, z1 = grow(box.x0, box.z0, box.x1, box.z1, deltaAt)
		local grid, footprints, units = readGrid(x0, z0, x1, z1, deltaAt)
		local on
		regions, on = GROUND.find(grid, { footprints = footprints })
		for fi in pairs(on) do
			standing[units[fi]] = true
		end
	end
	-- Buildings beside the ground changes come first and the ones standing
	-- on them after, so the steps go between: Zero-K's slopes stop short of
	-- what is already built, and what stands on a step needs it finished.
	local order = {}
	for _, b in ipairs(found) do
		if not standing[b.unitID] then
			order[#order + 1] = b
		end
	end
	local before = #order
	for _, b in ipairs(found) do
		if standing[b.unitID] then
			order[#order + 1] = b
		end
	end

	local ax = math.floor(minX / BUILD_SQUARE) * BUILD_SQUARE
	local az = math.floor(minZ / BUILD_SQUARE) * BUILD_SQUARE
	local buildings, footprints, defs = {}, {}, {}
	for i, b in ipairs(found) do
		defs[i] = b.def
	end
	for i, b in ipairs(order) do
		buildings[i] = { def = b.def.name, offset = { x = b.x - ax, z = b.z - az }, facing = b.facing % 4 }
		footprints[b.def.name:lower()] = { x = b.def.xsize / 2, z = b.def.zsize / 2 }
	end
	local entry = {
		name = opts.nameFor(defs),
		game = gameOf(),
		designedFor = Game.mapName,
		recordedAt = opts.now,
		ordered = false,
		buildings = buildings,
		footprints = footprints,
	}
	if #regions > 0 then
		entry.terrain = stepsOf(regions, ax, az, before)
		entry.fromGround = true
	end
	return entry
end

--- The ground changed in a rectangle, on its own, as a spool entry. Only
-- the changes inside the rectangle are kept.
-- @param x0 number, z0, x1, z1 the rectangle's corners, in elmos, either way round
-- @param opts table now (seconds, for recordedAt)
-- @return table? entry, or nil and a message when there is nothing to record
function M.ground(x0, z0, x1, z1, opts)
	x0, x1 = math.min(x0, x1), math.max(x0, x1)
	z0, z1 = math.min(z0, z1), math.max(z0, z1)
	local grid, footprints = readGrid(x0, z0, x1, z1, deltaReader())
	if grid.w == 0 then
		return nil, "the area is off the map"
	end
	local regions = GROUND.find(grid, { footprints = footprints })
	if #regions == 0 then
		return nil, "no ground has been changed there"
	end
	local ax, az
	for _, r in ipairs(regions) do
		for _, p in ipairs(r.points) do
			ax, az = math.min(ax or p.x, p.x), math.min(az or p.z, p.z)
		end
	end
	return {
		name = M.groundName(regions),
		game = gameOf(),
		designedFor = Game.mapName,
		recordedAt = opts.now,
		ordered = false,
		buildings = {},
		footprints = {},
		terrain = stepsOf(regions, ax, az, 0),
		fromGround = true,
	}
end

return M
