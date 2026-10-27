-- Placing a blueprint: turning its layout, snapping every building to the
-- build grid, marking what the ground refuses, and handing each selected
-- builder the orders it can take.
--
-- Positions come out of Spring.Pos2BuildPos, so the ghosts the player sees are
-- where the engine will put the building. Orders are one array per builder
-- through Spring.GiveOrderArrayToUnitArray, in layout order, with the first
-- command replacing the queue and the rest appending, which is what keeps an
-- ordered blueprint in sequence.

local M = {}

--- One build square in elmos.
M.BUILD_SQUARE = 16

local Spring, UnitDefs, UnitDefNames, Game, WG

--- Hand over the engine tables. A test passes a stub.
-- @param engine table Spring, UnitDefs, UnitDefNames, and Game for the map's
--   size. WG is optional, for Zero-K's terraform tag counter.
function M.use(engine)
	Spring = engine.Spring
	UnitDefs = engine.UnitDefs
	UnitDefNames = engine.UnitDefNames
	Game = engine.Game
	WG = engine.WG
end

-- Zero-K's terraform commands (LuaRules/Configs/customcmds.lua). The terraform
-- order is never queued: its gadget makes the terraform units and refuses the
-- order. A level command with the same tag in the builder's queue is what puts
-- the builder to work on them (issue #4789).
M.CMD_TERRAFORM_INTERNAL = 39801
M.CMD_LEVEL = 39736
-- The level command's description action, which tells Zero-K's command from
-- another game's command with the same number.
M.LEVEL_ACTION = "levelground"
-- Where the widget's own terraform tags start, for when Zero-K's counter
-- (which starts at 0) is not there. The gadget only matches a tag to its
-- terraform units within a team.
M.TAG_BASE = 1000000

local TERRAFORM_TYPE = { level = 1, raise = 2, smooth = 3, ramp = 4 }
local VOLUME = { raise = 1, lower = 2 }

--- Whether a footprint reaches past the edge of the map.
local function offMap(x, z, hw, hd)
	if not (Game and Game.mapSizeX) then
		return false
	end
	return x - hw < 0 or z - hd < 0 or x + hw > Game.mapSizeX or z + hd > Game.mapSizeZ
end

--- A point turned n quarter turns about the origin, facing 1 sending (x, z)
-- to (z, -x), the same turn the store applies to BAR's files.
function M.turned(x, z, n)
	n = n % 4
	if n == 1 then
		return z, -x
	elseif n == 2 then
		return -x, -z
	elseif n == 3 then
		return -z, x
	end
	return x, z
end

--- The layout anchor, snapped down to the build grid.
function M.snapAnchor(x, z)
	local s = M.BUILD_SQUARE
	return math.floor(x / s) * s, math.floor(z / s) * s
end

local lowerNames

local function defByName(name)
	local def = UnitDefNames[name]
	if def then
		return def
	end
	if not lowerNames then
		lowerNames = {}
		for defName, d in pairs(UnitDefNames) do
			lowerNames[defName:lower()] = d
		end
	end
	return lowerNames[name:lower()]
end

--- Resolve an entry's def names against the game.
-- @param entry table a store entry
-- @return table { buildings = { { defID, def, offset, facing, index } }, missing = { name },
--   terrain = the entry's terrain steps, untouched }
function M.resolve(entry)
	local out = { buildings = {}, missing = {}, terrain = entry.terrain or {} }
	for i, b in ipairs(entry.buildings) do
		local def = defByName(b.def)
		if def then
			-- index is the building's place in the entry, which a step's before
			-- counts, and which a missing def leaves a gap in
			out.buildings[#out.buildings + 1] = { defID = def.id, def = def, offset = b.offset, facing = b.facing, index = i }
		else
			out.missing[#out.missing + 1] = b.def
		end
	end
	return out
end

--- A facing flipped side to side (east and west swap) or top to bottom
-- (south and north swap). Facing 0 is south, 1 east, 2 north, 3 west.
function M.flippedFacing(facing, flipX, flipZ)
	if flipX and facing % 2 == 1 then
		facing = (facing + 2) % 4
	end
	if flipZ and facing % 2 == 0 then
		facing = (facing + 2) % 4
	end
	return facing
end

--- Where every building of a resolved entry lands, for a given anchor,
-- rotation and flip, snapped and tested against the ground. The flip comes
-- after the turn, so it is always along the map's own x or z. Both turn and
-- flip about the origin, a point in the layout that lands on the anchor.
-- @param resolved table from M.resolve
-- @param rotation integer quarter turns
-- @param ax number anchor x, elmos
-- @param az number anchor z, elmos
-- @param flip table? { x = boolean, z = boolean }
-- @param origin table? { x, z } in the layout's own offsets, 0, 0 if nil
-- @return table[] { defID, def, x, y, z, facing, blocked, index }
function M.footprint(resolved, rotation, ax, az, flip, origin)
	local flipX, flipZ = flip and flip.x, flip and flip.z
	local cx, cz = origin and origin.x or 0, origin and origin.z or 0
	local out = {}
	for i, b in ipairs(resolved.buildings) do
		local ox, oz = M.turned(b.offset.x - cx, b.offset.z - cz, rotation)
		if flipX then
			ox = -ox
		end
		if flipZ then
			oz = -oz
		end
		local facing = M.flippedFacing((b.facing + rotation) % 4, flipX, flipZ)
		local x, y, z = Spring.Pos2BuildPos(b.defID, ax + ox, 0, az + oz, facing)
		local status = Spring.TestBuildOrder(b.defID, x, y, z, facing)
		local hw, hd = M.halfSpan(b.def, facing)
		out[i] = { defID = b.defID, def = b.def, x = x, y = y, z = z, facing = facing, blocked = status == 0 or offMap(x, z, hw, hd), index = b.index or i }
	end
	return out
end

--- Where a layout's terrain steps land, for a given anchor, rotation and flip.
-- Turned and flipped exactly as M.footprint turns and flips a building: the
-- same quarter turn about the origin, then the flip along the map's own x or
-- z. Each point comes back in map elmos. Heights, width, kind, shape and the
-- step's place in the build order are the same after either, and a ramp keeps
-- the order of its ends so its first height still belongs to its first point.
-- @param steps table[]? the entry's terrain, from the store
-- @param rotation integer quarter turns
-- @param ax number anchor x, elmos
-- @param az number anchor z, elmos
-- @param flip table? { x = boolean, z = boolean }
-- @param origin table? { x, z } in the layout's own offsets, 0, 0 if nil
-- @return table[] steps, each with points = { { x, z } } on the map
function M.terrain(steps, rotation, ax, az, flip, origin)
	local flipX, flipZ = flip and flip.x, flip and flip.z
	local cx, cz = origin and origin.x or 0, origin and origin.z or 0
	local out = {}
	for i, step in ipairs(steps or {}) do
		local points = {}
		for j, p in ipairs(step.points) do
			local ox, oz = M.turned(p.x - cx, p.z - cz, rotation)
			if flipX then
				ox = -ox
			end
			if flipZ then
				oz = -oz
			end
			points[j] = { x = ax + ox, z = az + oz }
		end
		out[i] = {
			kind = step.kind,
			shape = step.shape,
			points = points,
			before = step.before,
			height = step.height,
			heights = step.heights and { step.heights[1], step.heights[2] } or nil,
			width = step.width,
			only = step.only,
		}
	end
	return out
end

--- Whether a point is past the edge of the map.
local function pointOffMap(x, z)
	if not (Game and Game.mapSizeX) then
		return false
	end
	return x < 0 or z < 0 or x > Game.mapSizeX or z > Game.mapSizeZ
end

--- A layout's terrain steps on the ground, for the copies of it being placed.
-- Each step comes out as M.terrain gives it, with where it falls among the
-- footprint, the ground height under the pivot at this moment, and whether any
-- point is off the map.
-- @param resolved table from M.resolve
-- @param anchors table[] { x, z } the pivot of each copy, one for a single copy
-- @param foot table[] the copies' footprints from M.footprint, one after the
--   other, each as long as resolved.buildings
-- @return table[] steps with after = how many of foot's entries come ahead of
--   it, base = the ground height at the pivot, and blocked
function M.laySteps(resolved, rotation, flip, origin, anchors, foot)
	local n = #resolved.buildings
	local out = {}
	for c, at in ipairs(anchors) do
		local first = (c - 1) * n
		local base = Spring.GetGroundHeight(at.x, at.z)
		for _, step in ipairs(M.terrain(resolved.terrain, rotation, at.x, at.z, flip, origin)) do
			local after = first
			for i = 1, n do
				local p = foot[first + i]
				if p and (p.index or i) <= step.before then
					after = first + i
				end
			end
			step.after, step.base, step.blocked = after, base, false
			for _, point in ipairs(step.points) do
				if pointOffMap(point.x, point.z) then
					step.blocked = true
				end
			end
			out[#out + 1] = step
		end
	end
	return out
end

--- The next terraform tag: Zero-K's own counter when its terraform widget
-- file is loaded, otherwise the widget's.
local ownTag = M.TAG_BASE - 1
function M.nextTag()
	if WG and type(WG.Terraform_GetNextTag) == "function" then
		return WG.Terraform_GetNextTag()
	end
	ownTag = ownTag + 1
	return ownTag
end

--- Whether a unit has Zero-K's level command. The action name is checked as
-- well as the number, since another game could use the same number. A mission
-- that has locked terraform takes the command away.
function M.canTerraform(unitID)
	local index = Spring.FindUnitCmdDesc(unitID, M.CMD_LEVEL)
	if not index then
		return false
	end
	local desc = Spring.GetUnitCmdDescs(unitID, index, index)[1]
	return desc ~= nil and desc.action == M.LEVEL_ACTION
end

--- The parameters of Zero-K's terraform order for a step, laid out the way its
-- lasso widget builds them (gui_lasso_terraform.lua, SendCommand).
-- @param step table from M.laySteps
-- @param builders integer[] the units that will work on it
-- @param tag number
-- @param team integer
function M.terraformParams(step, builders, tag, team)
	local sx, sz = 0, 0
	for _, p in ipairs(step.points) do
		sx, sz = sx + p.x, sz + p.z
	end
	local cx, cz = sx / #step.points, sz / #step.points
	local height = 0
	if step.kind == "level" then
		height = step.base + step.height
	elseif step.kind == "raise" then
		height = step.height
	elseif step.kind == "ramp" then
		-- the step's width is the full width on the ground. Zero-K's lasso
		-- sends half, and the gadget doubles it (unit_terraform.lua, AllowCommand)
		height = step.width / 2
	end
	-- the volume selection, as the lasso widget's: 0 both ways, 1 only raise, 2
	-- only lower. Only a level or a ramp has the choice.
	local volume = 0
	if step.kind == "level" or step.kind == "ramp" then
		volume = VOLUME[step.only] or 0
	end
	local out = { TERRAFORM_TYPE[step.kind], team, cx, cz, tag, step.shape == "area" and 1 or 0, height, #step.points, #builders, volume }
	for i, p in ipairs(step.points) do
		out[#out + 1] = p.x
		if step.kind == "ramp" then
			out[#out + 1] = step.base + step.heights[i]
		end
		out[#out + 1] = p.z
	end
	for _, unitID in ipairs(builders) do
		out[#out + 1] = unitID
	end
	return out
end

--- What a layout is held by while it is placed, as an offset in the layout:
-- the pivot building's, or for a layout of terrain steps alone the middle of
-- its steps, on the 8 elmo heightmap grid the steps' points are on.
-- @param resolved table from M.resolve
-- @param pivot integer? from M.pivot
-- @return table? { x, z }, nil for a layout with neither buildings nor steps
function M.holdPoint(resolved, pivot)
	if pivot then
		return resolved.buildings[pivot].offset
	end
	local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
	for _, step in ipairs(resolved.terrain or {}) do
		for _, p in ipairs(step.points) do
			minX, maxX = math.min(minX, p.x), math.max(maxX, p.x)
			minZ, maxZ = math.min(minZ, p.z), math.max(maxZ, p.z)
		end
	end
	if minX == math.huge then
		return nil
	end
	return { x = math.floor((minX + maxX) / 16 + 0.5) * 8, z = math.floor((minZ + maxZ) / 16 + 0.5) * 8 }
end

-- How far above a step's finished height its label floats, in elmos.
M.LABEL_LIFT = 24

--- A change in elmos as a label reads it: a sign, or a bare 0.
local function signed(n)
	n = math.floor(n + 0.5)
	if n == 0 then
		return "0"
	end
	return string.format("%+d", n)
end

--- One label for each laid step, saying what it does to the ground, placed
-- over the middle of the step at its finished height.
-- @param steps table[]? from M.laySteps
-- @return table[] { x, y, z, text } in world space
function M.labels(steps)
	local out = {}
	for _, step in ipairs(steps or {}) do
		local sx, sz = 0, 0
		for _, p in ipairs(step.points) do
			sx, sz = sx + p.x, sz + p.z
		end
		local cx, cz = sx / #step.points, sz / #step.points
		local top, text
		if step.kind == "raise" then
			top, text = Spring.GetGroundHeight(cx, cz) + step.height, signed(step.height)
		elseif step.kind == "level" then
			top, text = step.base + step.height, "level " .. signed(step.height)
		elseif step.kind == "ramp" then
			top = step.base + (step.heights[1] + step.heights[2]) / 2
			text = "ramp " .. signed(step.heights[1]) .. " to " .. signed(step.heights[2])
		else
			top, text = Spring.GetGroundHeight(cx, cz), "smooth"
		end
		out[#out + 1] = { x = cx, y = top + M.LABEL_LIFT, z = cz, text = text }
	end
	return out
end

--- Half a footprint's width and depth in elmos, for a facing. xsize and
-- zsize are in the engine's 8 elmo half squares.
function M.halfSpan(def, facing)
	local xs, zs = def.xsize, def.zsize
	if facing % 2 == 1 then
		xs, zs = zs, xs
	end
	return xs * 4, zs * 4
end

--- How far a layout reaches from its anchor once turned and flipped, edge to
-- edge.
-- @return number minX, maxX, minZ, maxZ in elmos, all 0 for an empty layout
function M.extent(resolved, rotation, flip)
	local flipX, flipZ = flip and flip.x, flip and flip.z
	local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
	for _, b in ipairs(resolved.buildings) do
		local ox, oz = M.turned(b.offset.x, b.offset.z, rotation)
		if flipX then
			ox = -ox
		end
		if flipZ then
			oz = -oz
		end
		local hw, hd = M.halfSpan(b.def, (b.facing + rotation) % 4)
		minX, maxX = math.min(minX, ox - hw), math.max(maxX, ox + hw)
		minZ, maxZ = math.min(minZ, oz - hd), math.max(maxZ, oz + hd)
	end
	-- the ground a layout changes reaches as far as a building does
	for _, step in ipairs(resolved.terrain or {}) do
		for _, p in ipairs(step.points) do
			local ox, oz = M.turned(p.x, p.z, rotation)
			if flipX then
				ox = -ox
			end
			if flipZ then
				oz = -oz
			end
			minX, maxX = math.min(minX, ox), math.max(maxX, ox)
			minZ, maxZ = math.min(minZ, oz), math.max(maxZ, oz)
		end
	end
	if minX == math.huge then
		return 0, 0, 0, 0
	end
	return minX, maxX, minZ, maxZ
end

-- How far from the cursor a spot pulls a spot-bound building onto it, in
-- elmos. The distance Splinter Faction's own extractor snapping uses.
M.SPOT_SNAP = 90

--- Whether a def only builds on a spot: "geo" for a geothermal, which the
-- engine only allows on a geothermal feature, "metal" for an extractor,
-- marked by the engine's extractsMetal or Splinter Faction's metal_extractor
-- custom param, and nil for anything else.
function M.spotKind(def)
	if def.needGeo then
		return "geo"
	end
	if (def.extractsMetal or 0) > 0 or (def.customParams and def.customParams.metal_extractor) then
		return "metal"
	end
	return nil
end

--- The spot nearest a point within reach, or nil.
-- @param spots table[] { x, z }
function M.nearestSpot(spots, x, z, reach)
	local best, bestD = nil, reach * reach
	for _, spot in ipairs(spots or {}) do
		local d = (spot.x - x) ^ 2 + (spot.z - z) ^ 2
		if d <= bestD then
			best, bestD = spot, d
		end
	end
	return best
end

--- A scan of the map's metal for patches of touching squares that hold
-- metal, for a game that publishes no list of metal spots. It runs a little
-- at a time with M.stepMetalScan, and pauses part way through a patch.
-- @param sizeX integer the metal map's width in squares
-- @param sizeZ integer and its depth
-- @param amountAt function(x, z) -> metal on a square
-- @param square number elmos per square
function M.newMetalScan(sizeX, sizeZ, amountAt, square)
	return { sizeX = sizeX, sizeZ = sizeZ, amountAt = amountAt, square = square, x = 0, z = 0, seen = {}, patches = {}, done = sizeX <= 0 or sizeZ <= 0 }
end

-- Take the next square of the patch being filled, adding its neighbours.
local function fillOne(scan)
	local f = scan.flood
	local x, z = f.queue[f.i][1], f.queue[f.i][2]
	f.i = f.i + 1
	local metal = scan.amountAt(x, z)
	f.sum, f.sx, f.sz = f.sum + metal, f.sx + metal * x, f.sz + metal * z
	f.minX, f.maxX = math.min(f.minX, x), math.max(f.maxX, x)
	f.minZ, f.maxZ = math.min(f.minZ, z), math.max(f.maxZ, z)
	for dz = -1, 1 do
		for dx = -1, 1 do
			local nx, nz = x + dx, z + dz
			local k = nz * scan.sizeX + nx
			if nx >= 0 and nz >= 0 and nx < scan.sizeX and nz < scan.sizeZ and not scan.seen[k] and scan.amountAt(nx, nz) > 0 then
				scan.seen[k] = true
				f.queue[#f.queue + 1] = { nx, nz }
			end
		end
	end
	if not f.queue[f.i] then
		local q = scan.square
		scan.patches[#scan.patches + 1] = {
			x = (f.sx / f.sum + 0.5) * q,
			z = (f.sz / f.sum + 0.5) * q,
			wide = math.max(f.maxX - f.minX + 1, f.maxZ - f.minZ + 1) * q,
		}
		scan.flood = nil
	end
end

--- Look at up to budget more squares, counting those a patch takes in.
-- @return boolean whether the scan is finished
function M.stepMetalScan(scan, budget)
	local n = 0
	while not scan.done and n < budget do
		n = n + 1
		if scan.flood then
			fillOne(scan)
		else
			local k = scan.z * scan.sizeX + scan.x
			if not scan.seen[k] and scan.amountAt(scan.x, scan.z) > 0 then
				scan.seen[k] = true
				scan.flood = { queue = { { scan.x, scan.z } }, i = 1, sum = 0, sx = 0, sz = 0, minX = scan.x, maxX = scan.x, minZ = scan.z, maxZ = scan.z }
			end
			scan.x = scan.x + 1
			if scan.x >= scan.sizeX then
				scan.x, scan.z = 0, scan.z + 1
			end
		end
		if scan.z >= scan.sizeZ and not scan.flood then
			scan.done = true
		end
	end
	return scan.done
end

--- The metal spots for an extractor: each patch no wider than one extractor
-- covers. A wider patch is open ground with metal everywhere, not a spot.
-- Finishes the scan first if it is not done.
-- @param span number elmos one extractor covers, edge to edge
-- @return table[] { x, z } at each patch's middle, weighted by its metal
function M.metalSpots(scan, span)
	M.stepMetalScan(scan, math.huge)
	local out = {}
	for _, patch in ipairs(scan.patches) do
		if patch.wide <= span then
			out[#out + 1] = { x = patch.x, z = patch.z }
		end
	end
	return out
end

--- The building a layout is held by while it is placed. The first that only
-- builds on a spot, so the layout can snap to one, otherwise the one nearest
-- the middle of the layout, the first in layout order on a tie. The cursor
-- holds it, and the layout turns and flips about it.
-- @return integer? its index in resolved.buildings, nil for an empty layout
function M.pivot(resolved)
	for i, b in ipairs(resolved.buildings) do
		if M.spotKind(b.def) then
			return i
		end
	end
	local minX, maxX, minZ, maxZ = M.extent(resolved, 0)
	local mx, mz = (minX + maxX) / 2, (minZ + maxZ) / 2
	local best, bestD
	for i, b in ipairs(resolved.buildings) do
		local d = (b.offset.x - mx) ^ 2 + (b.offset.z - mz) ^ 2
		if not best or d < bestD then
			best, bestD = i, d
		end
	end
	return best
end

--- Where the pivot lands for a point on the ground: snapped to the build
-- grid the way the engine snaps that building, at its facing once turned and
-- flipped. The layout's other buildings keep their place around it. A layout
-- of terrain steps alone has no building to hold it by, so it is held by its
-- origin, snapped to the 8 elmo heightmap grid the steps' points are on.
-- @return number x, number z
function M.pivotAt(resolved, pivot, rotation, flip, x, z)
	if not pivot then
		return math.floor(x / 8 + 0.5) * 8, math.floor(z / 8 + 0.5) * 8
	end
	local b = resolved.buildings[pivot]
	local facing = M.flippedFacing((b.facing + rotation) % 4, flip and flip.x, flip and flip.z)
	local px, _, pz = Spring.Pos2BuildPos(b.defID, x, 0, z, facing)
	return px, pz
end

--- Anchors for copies of a layout laid in a line from one anchor toward
-- another, along whichever of x and z the line runs further, each copy
-- touching the last.
-- @return table[] { x, z }, the first always the start
function M.line(sx, sz, ex, ez, minX, maxX, minZ, maxZ)
	local dx, dz = ex - sx, ez - sz
	local alongX = math.abs(dx) >= math.abs(dz)
	local span = alongX and (maxX - minX) or (maxZ - minZ)
	local step = math.max(M.BUILD_SQUARE, math.ceil(span / M.BUILD_SQUARE) * M.BUILD_SQUARE)
	local reach = alongX and dx or dz
	local sign = reach < 0 and -1 or 1
	local out = {}
	for i = 0, math.floor(math.abs(reach) / step + 0.5) do
		if alongX then
			out[#out + 1] = { x = sx + sign * i * step, z = sz }
		else
			out[#out + 1] = { x = sx, z = sz + sign * i * step }
		end
	end
	return out
end

--- What each unit def can turn into besides by building: morph and
-- evolution targets. Games keep these in different places, so this reads the
-- unit defs' custom params (Zero-K's morphto, BAR's evolution_target) and any
-- morph config tables the widget could load, keyed by unit name with a value
-- of { into = name } or a list of those (Splinter Faction, Metal Factions,
-- Spring 1944).
-- @param configs table[] loaded morph config tables
-- @return table defID -> defID[]
function M.morphTargets(configs)
	local out = {}
	local function add(fromName, intoName)
		local from, into = defByName(fromName), type(intoName) == "string" and defByName(intoName)
		if from and into then
			out[from.id] = out[from.id] or {}
			table.insert(out[from.id], into.id)
		end
	end
	for _, def in pairs(UnitDefs) do
		local params = def.customParams or {}
		for key, value in pairs(params) do
			if key == "morphto" or key:match("^morphto_%d+$") or key == "evolution_target" then
				add(def.name, value)
			end
		end
	end
	for _, config in ipairs(configs) do
		if type(config) == "table" then
			for fromName, value in pairs(config) do
				if type(fromName) == "string" and type(value) == "table" then
					if value.into then
						add(fromName, value.into)
					end
					for _, each in ipairs(value) do
						if type(each) == "table" then
							add(fromName, each.into)
						end
					end
				end
			end
		end
	end
	return out
end

--- Every def a team can reach from the units it has: what they build, what
-- that builds in turn, and what any of them morph into.
-- @param defIDs integer[] the def ids of the team's units
-- @param morphs table from M.morphTargets
-- @return table defID -> true
function M.reach(defIDs, morphs)
	local seen, queue = {}, {}
	for _, id in ipairs(defIDs) do
		if not seen[id] then
			seen[id] = true
			queue[#queue + 1] = id
		end
	end
	local i = 1
	while queue[i] do
		local def = UnitDefs[queue[i]]
		local next = {}
		for _, id in ipairs(def and def.buildOptions or {}) do
			next[#next + 1] = id
		end
		for _, id in ipairs(morphs[queue[i]] or {}) do
			next[#next + 1] = id
		end
		for _, id in ipairs(next) do
			if not seen[id] then
				seen[id] = true
				queue[#queue + 1] = id
			end
		end
		i = i + 1
	end
	return seen
end

--- What the selected units can build, and how fast.
-- @param unitIDs integer[]
-- @return table { union = { defID = true }, byUnit = { unitID = { defID = true } },
--   builders = unitID[], speed = { unitID = build speed }, terraformers = the
--   builders that have Zero-K's level command, unitID[] }
function M.capabilities(unitIDs)
	local out = { union = {}, byUnit = {}, builders = {}, speed = {}, terraformers = {} }
	for _, unitID in ipairs(unitIDs) do
		local defID = Spring.GetUnitDefID(unitID)
		local def = defID and UnitDefs[defID]
		local options = def and def.buildOptions
		if options and #options > 0 then
			local own = {}
			for _, buildable in ipairs(options) do
				own[buildable] = true
				out.union[buildable] = true
			end
			out.byUnit[unitID] = own
			out.builders[#out.builders + 1] = unitID
			out.speed[unitID] = def.buildSpeed or 0
			if M.canTerraform(unitID) then
				out.terraformers[#out.terraformers + 1] = unitID
			end
		end
	end
	return out
end

--- What to build in place of a def the team only gets by morphing, such as
-- a tech 2 factory that is a tech 1 factory upgraded: the first def back
-- along the morph chain that something the team has, or can build, builds.
-- @param reach table from M.reach
-- @param morphs table from M.morphTargets
-- @return table defID -> the defID to build instead
function M.standIns(reach, morphs)
	local buildable = {}
	for id in pairs(reach) do
		local def = UnitDefs[id]
		for _, option in ipairs(def and def.buildOptions or {}) do
			buildable[option] = true
		end
	end
	local from = {}
	for source, targets in pairs(morphs) do
		for _, target in ipairs(targets) do
			from[target] = from[target] or {}
			table.insert(from[target], source)
		end
	end
	local out = {}
	for id in pairs(reach) do
		if not buildable[id] and from[id] then
			local seen, queue, i = { [id] = true }, { id }, 1
			while queue[i] and not out[id] do
				for _, source in ipairs(from[queue[i]] or {}) do
					if buildable[source] then
						out[id] = source
						break
					elseif not seen[source] then
						seen[source] = true
						queue[#queue + 1] = source
					end
				end
				i = i + 1
			end
		end
	end
	return out
end

--- A resolved layout with each building the team only gets by morphing
-- swapped for its stand-in, which keeps the place and facing. Each swapped
-- building keeps the def it becomes as upgradesTo.
-- @return table resolved, integer how many were swapped
function M.substitute(resolved, standIns)
	if not standIns then
		return resolved, 0
	end
	local out, n = { buildings = {}, missing = resolved.missing, terrain = resolved.terrain }, 0
	for i, b in ipairs(resolved.buildings) do
		local source = standIns[b.defID]
		if source then
			n = n + 1
			out.buildings[i] = { defID = source, def = UnitDefs[source], offset = b.offset, facing = b.facing, upgradesTo = b.def, index = b.index }
		else
			out.buildings[i] = b
		end
	end
	return out, n
end

--- How many of a layout's buildings the team can never build, from
-- M.reach. Nil reach, as for a spectator or before the team has units,
-- counts none.
function M.foreign(resolved, reach)
	if not reach then
		return 0
	end
	local n = 0
	for _, b in ipairs(resolved.buildings) do
		if not reach[b.defID] then
			n = n + 1
		end
	end
	return n
end

--- Which tab a resolved entry belongs under for these capabilities.
-- @return string "now" when every building is buildable, "partly" when some
--   are, "never" otherwise
function M.classify(resolved, can)
	local buildable, total = 0, #resolved.buildings + #resolved.missing
	for _, b in ipairs(resolved.buildings) do
		if can.union[b.defID] then
			buildable = buildable + 1
		end
	end
	if total > 0 and buildable == total then
		return "now"
	elseif buildable > 0 then
		return "partly"
	end
	return "never"
end

--- Who builds each position when builders split the work. Each building
-- goes to the nearest builder able to build it, until that builder has its
-- fair share of the build time, its build speed's part of the whole. The
-- buildings that most clearly belong to one builder, by how much further the
-- next nearest is, are given out first.
-- @return table position index -> unitID
local function split(foot, can)
	local at, totalSpeed = {}, 0
	for _, unitID in ipairs(can.builders) do
		local x, _, z = Spring.GetUnitPosition(unitID)
		at[unitID] = x and { x = x, z = z } or { x = 0, z = 0 }
		totalSpeed = totalSpeed + (can.speed[unitID] or 0)
	end
	local jobs, work = {}, 0
	for i, p in ipairs(foot) do
		if not p.blocked then
			local options = {}
			for _, unitID in ipairs(can.builders) do
				if can.byUnit[unitID][p.defID] then
					local d = math.sqrt((p.x - at[unitID].x) ^ 2 + (p.z - at[unitID].z) ^ 2)
					options[#options + 1] = { unitID = unitID, d = d }
				end
			end
			if #options > 0 then
				table.sort(options, function(a, b)
					return a.d < b.d
				end)
				local regret = options[2] and options[2].d - options[1].d or math.huge
				jobs[#jobs + 1] = { i = i, options = options, regret = regret, time = p.def.buildTime or 0 }
				work = work + (p.def.buildTime or 0)
			end
		end
	end
	table.sort(jobs, function(a, b)
		if a.regret ~= b.regret then
			return a.regret > b.regret
		end
		return a.i < b.i
	end)
	-- a builder's fair share, in build time, before it stops taking more
	local share, load = {}, {}
	for _, unitID in ipairs(can.builders) do
		share[unitID] = totalSpeed > 0 and work * (can.speed[unitID] or 0) / totalSpeed or math.huge
		load[unitID] = 0
	end
	local who = {}
	for _, job in ipairs(jobs) do
		local pick = job.options[1].unitID
		for _, option in ipairs(job.options) do
			if load[option.unitID] < share[option.unitID] then
				pick = option.unitID
				break
			end
		end
		who[job.i] = pick
		load[pick] = load[pick] + job.time
	end
	return who
end

--- The builder nearest a step, from among those given.
local function nearestTo(unitIDs, step)
	local sx, sz = 0, 0
	for _, p in ipairs(step.points) do
		sx, sz = sx + p.x, sz + p.z
	end
	sx, sz = sx / #step.points, sz / #step.points
	local best, bestD
	for _, unitID in ipairs(unitIDs) do
		local x, _, z = Spring.GetUnitPosition(unitID)
		local d = x and (x - sx) ^ 2 + (z - sz) ^ 2 or math.huge
		if not best or d < bestD then
			best, bestD = unitID, d
		end
	end
	return best
end

--- Turn a footprint, and the terrain steps among it, into orders.
-- A terraform step becomes two things. Its terraform order is never queued,
-- so it is kept in plan.terraform for M.issue to send. A level
-- command with the order's tag goes into each working builder's queue at the
-- step's place among the buildings, and that is what sends the builder to
-- build the terraform. An entry of foot is placed by its seq, or its position
-- when it has none, and a step by its after, the seq it comes after, so a
-- plan left over from an earlier one keeps the order it had.
-- @param foot table[] from M.footprint
-- @param can table from M.capabilities
-- @param shift boolean whether the player holds shift, which appends everything
-- @param mode string? "help", the default, gives every builder every building
--   it can build, so they help each other with each one in turn. "split"
--   gives each building to one builder, for games that stop builders helping.
--   Each step goes to the nearest builder that can terraform.
-- @param terrain table? { steps = from M.laySteps, on = boolean, why = string }.
--   When on is false the steps are counted as skipped, for the reason why.
-- @return table { orders = { { unitID, cmds } }, remainder = foot entries nobody
--   can build, blocked = count of positions skipped because the ground refused,
--   terraform = { { unitID, params, tag, levelAt = { { unitID, index } }, where
--   each builder's level step is in its orders } }, stepRemainder
--   = steps kept for when a builder is selected, skipped = steps not ordered
--   for skippedWhy, offMap = steps with a point off the map }
function M.plan(foot, can, shift, mode, terrain)
	local out = { orders = {}, remainder = {}, blocked = 0, terraform = {}, stepRemainder = {}, skipped = 0, offMap = 0, shift = shift }
	local who = mode == "split" and split(foot, can) or nil

	-- which steps are ordered, and to whom
	local steps = {}
	local given = terrain and terrain.steps or {}
	if #given > 0 then
		local usable = {}
		for i, step in ipairs(given) do
			if not terrain.on then
				out.skipped = out.skipped + 1
				out.skippedWhy = terrain.why
			elseif step.blocked then
				out.offMap = out.offMap + 1
			else
				usable[#usable + 1] = { step = step, i = i }
			end
		end
		if #usable > 0 and #can.terraformers > 0 then
			table.sort(usable, function(a, b)
				if a.step.after ~= b.step.after then
					return a.step.after < b.step.after
				end
				return a.i < b.i
			end)
			for _, u in ipairs(usable) do
				local builders = mode == "split" and { nearestTo(can.terraformers, u.step) } or can.terraformers
				local tag = M.nextTag()
				local team = Spring.GetUnitTeam(builders[1]) or Spring.GetMyTeamID()
				local at = {}
				for _, unitID in ipairs(builders) do
					at[unitID] = true
				end
				local t = { unitID = builders[1], params = M.terraformParams(u.step, builders, tag, team), tag = tag, levelAt = {} }
				steps[#steps + 1] = { step = u.step, tag = tag, at = at, t = t }
				out.terraform[#out.terraform + 1] = t
			end
		elseif #usable > 0 and #can.builders == 0 then
			for _, u in ipairs(usable) do
				out.stepRemainder[#out.stepRemainder + 1] = u.step
			end
		elseif #usable > 0 then
			out.skipped = out.skipped + #usable
			out.skippedWhy = "no selected builder can terraform"
		end
	end

	local taken = {}
	for _, unitID in ipairs(can.builders) do
		local own = can.byUnit[unitID]
		local cmds = {}
		local function add(id, params)
			cmds[#cmds + 1] = { id, params, (shift or #cmds > 0) and { "shift" } or {} }
		end
		local next = 1
		local function stepsBefore(seq)
			while steps[next] and (seq == nil or steps[next].step.after < seq) do
				local s = steps[next]
				if s.at[unitID] then
					local step = s.step
					local sx, sz = 0, 0
					for _, p in ipairs(step.points) do
						sx, sz = sx + p.x, sz + p.z
					end
					sx, sz = sx / #step.points, sz / #step.points
					add(M.CMD_LEVEL, { sx, Spring.GetGroundHeight(sx, sz), sz, s.tag })
					s.t.levelAt[#s.t.levelAt + 1] = { unitID = unitID, index = #cmds }
				end
				next = next + 1
			end
		end
		for i, p in ipairs(foot) do
			stepsBefore(p.seq or i)
			if own[p.defID] then
				taken[i] = true
				if not p.blocked and (not who or who[i] == unitID) then
					add(-p.defID, { p.x, p.y, p.z, p.facing })
				end
			end
		end
		stepsBefore(nil)
		if #cmds > 0 then
			out.orders[#out.orders + 1] = { unitID = unitID, cmds = cmds }
		end
	end
	for i, p in ipairs(foot) do
		if not taken[i] then
			out.remainder[#out.remainder + 1] = p
		elseif p.blocked then
			out.blocked = out.blocked + 1
		end
	end
	return out
end

--- What a layout costs, and how long the selected builders take to build
-- the part they can, working together.
-- @param resolved table from M.resolve
-- @param can table from M.capabilities
-- @param terrain table? { metal, work } for the layout's terraform, from
--   terraform.lua's session: metal is the estimate the game shows and work what
--   the builders spend doing it. It adds to the metal, and its time is the work
--   over the build power of the selected builders that can terraform, in
--   Zero-K the same power that builds units.
-- @return number metal, number energy, number? seconds, nil with no builder
--   for any of it
function M.cost(resolved, can, terrain)
	local metal, energy, work, speed = 0, 0, 0, 0
	for _, b in ipairs(resolved.buildings) do
		metal = metal + (b.def.metalCost or 0)
		energy = energy + (b.def.energyCost or 0)
		if can.union[b.defID] then
			work = work + (b.def.buildTime or 0)
		end
	end
	for _, unitID in ipairs(can.builders) do
		speed = speed + (can.speed[unitID] or 0)
	end
	local seconds = nil
	if work > 0 and speed > 0 then
		seconds = work / speed
	end
	if terrain and terrain.metal and terrain.metal > 0 then
		metal = metal + terrain.metal
		local terraSpeed = 0
		for _, unitID in ipairs(can.terraformers or {}) do
			terraSpeed = terraSpeed + (can.speed[unitID] or 0)
		end
		if terraSpeed > 0 then
			seconds = (seconds or 0) + (terrain.work or terrain.metal) / terraSpeed
		end
	end
	return metal, energy, seconds
end

--- Send a plan's orders to the engine.
-- @param later table the pending_terraform module, which holds each terraform
--   order whose level step is further back until a builder nears it
-- @return integer how many builders were given an array
function M.issue(plan, later)
	local sent = 0
	-- a terraform order whose level step is at or next to the front goes
	-- first, so the level step finds its units
	local held = {}
	for _, t in ipairs(plan.terraform or {}) do
		if later.near(t, plan.shift) then
			Spring.GiveOrderToUnit(t.unitID, M.CMD_TERRAFORM_INTERNAL, t.params, 0)
		else
			held[#held + 1] = t
		end
	end
	for _, order in ipairs(plan.orders) do
		if Spring.GiveOrderArrayToUnitArray({ order.unitID }, order.cmds) then
			sent = sent + 1
		end
	end
	for _, t in ipairs(held) do
		later.add(t)
	end
	return sent
end

return M
