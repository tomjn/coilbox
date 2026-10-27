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

-- The engine's move command (CMD.MOVE). A builder is sent clear of a step's
-- ground with one, ahead of the step's level command (#4816).
M.CMD_MOVE = 10
-- The engine's wait (CMD.WAIT). With more than one builder on a step, each
-- waits at its spot until all are clear, and step_clear.lua lets them go
-- together (#4816).
M.CMD_WAIT = 5
-- How near two queued orders of one kind with a place may be before the
-- engine takes the second, given with shift, as cancelling the first, and
-- drops a wait behind it too (CCommandAI::GetCancelQueued, COMMAND_CANCEL_DIST).
M.COMMAND_CANCEL_DIST = 17
-- How far Zero-K's terraform gadget lets a terraform unit roam from its place
-- towards the constructor building it (unit_terraform.lua, terraUnitLeash), so
-- a builder reaches that much further than its build range.
M.TERRAUNIT_LEASH = 100
-- How far short of a move's goal a unit may stop. Zero-K turns a move into its
-- raw move, which stops a walker given a goal of its own within 16 elmos
-- (cmd_raw_move.lua, loneStopDist). The engine's own move stops within 8
-- (CMobileCAI::SetGoal).
M.MOVE_STOP = 16
-- The spacing of the spots tried for a builder to step clear to: a build square.
M.CLEAR_GRID = 16

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
	local out = { buildings = {}, missing = {}, terrain = entry.terrain or {}, ordered = entry.ordered == true }
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

--- Whether a step is a wall that closes on itself: its last point is its first.
function M.closedRing(step)
	local points = step.points
	if step.shape ~= "wall" or #points < 4 then
		return false
	end
	local a, b = points[1], points[#points]
	return math.abs(a.x - b.x) < 1 and math.abs(a.z - b.z) < 1
end

--- Whether a point is inside a closed outline, by the even-odd rule.
-- @param outline table[] { x, z }
function M.inside(outline, x, z)
	local hit = false
	local j = #outline
	for i = 1, #outline do
		local a, b = outline[i], outline[j]
		if (a.z > z) ~= (b.z > z) and x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x then
			hit = not hit
		end
		j = i
	end
	return hit
end

--- How far a point is from a line of points.
local function lineDistance(points, x, z)
	local best = math.huge
	for i = 1, #points - 1 do
		local a, b = points[i], points[i + 1]
		local dx, dz = b.x - a.x, b.z - a.z
		local len = dx * dx + dz * dz
		local t = len > 0 and math.max(0, math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len)) or 0
		best = math.min(best, math.sqrt((a.x + t * dx - x) ^ 2 + (a.z + t * dz - z) ^ 2))
	end
	return best
end

-- Half the width of the top of a Zero-K wall (unit_terraform.lua, TerraformWall,
-- measured as 32 wide in the Zero-K driver).
local WALL_HALF_WIDTH = 16

--- Put the buildings inside a closed ring of wall ahead of the rest of their
-- copy, and the ring after them, so nothing is built inside a ring once it has
-- risen (#4816). A building is inside when its middle is inside the ring and
-- its footprint is clear of the wall's top. The copy's slice of foot is
-- reordered in place and numbered again, and each building inside is marked
-- insideRing.
-- @param steps table[] the copy's laid steps, each with after = first
-- @param foot table[] every copy's footprint
-- @param first integer how many of foot come before this copy
-- @param n integer how many buildings the copy has
local function ringsFirst(steps, foot, first, n)
	local rings = {}
	for _, step in ipairs(steps) do
		if M.closedRing(step) then
			rings[#rings + 1] = step
		end
	end
	if #rings == 0 or n == 0 then
		return 0
	end
	local within, rest = {}, {}
	for i = first + 1, first + n do
		local p = foot[i]
		local hw, hd = M.halfSpan(p.def, p.facing)
		local enclosed = false
		for _, ring in ipairs(rings) do
			if M.inside(ring.points, p.x, p.z) and lineDistance(ring.points, p.x, p.z) > math.max(hw, hd) + WALL_HALF_WIDTH then
				enclosed = true
			end
		end
		p.insideRing = enclosed or nil
		if enclosed then
			within[#within + 1] = p
		else
			rest[#rest + 1] = p
		end
	end
	if #within == 0 then
		return 0
	end
	for j, p in ipairs(within) do
		foot[first + j] = p
	end
	for j, p in ipairs(rest) do
		foot[first + #within + j] = p
	end
	for i = first + 1, first + n do
		if foot[i].seq then
			foot[i].seq = i
		end
	end
	for _, ring in ipairs(rings) do
		ring.after = first + #within
	end
	return #within
end

--- A layout's terrain steps on the ground, for the copies of it being placed.
-- Each step comes out as M.terrain gives it, with where it falls among the
-- footprint, the ground height under the pivot at this moment, and whether any
-- point is off the map. A closed ring of wall comes after the buildings inside
-- it, which move to the front of their copy in foot (see ringsFirst), and is
-- laid side by side (M.ringSides). An open wall longer than one of Zero-K's
-- blocks is laid block by block (M.wallPieces).
--
-- With an exit, where the builders are, the work sweeps towards it, the way a
-- printer lays a print (#4816): the steps farthest from it first, so a ring
-- closes on the exit side last, and the buildings that do not have to wait
-- for a step farthest first too, unless the blueprint's order is its build
-- order. The builders finish on the exit side.
-- @param resolved table from M.resolve
-- @param anchors table[] { x, z } the pivot of each copy, one for a single copy
-- @param foot table[] the copies' footprints from M.footprint, one after the
--   other, each as long as resolved.buildings
-- @param exit table? { x, z } the middle of the builders that will do it
-- @return table[] steps with after = how many of foot's entries come ahead of
--   it, base = the ground height at the pivot, and blocked
local sweep, sweepFoot

function M.laySteps(resolved, rotation, flip, origin, anchors, foot, exit)
	local n = #resolved.buildings
	local out = {}
	for c, at in ipairs(anchors) do
		local first = (c - 1) * n
		local base = Spring.GetGroundHeight(at.x, at.z)
		local copy = M.terrain(resolved.terrain, rotation, at.x, at.z, flip, origin)
		for _, step in ipairs(copy) do
			-- Every step comes ahead of every building of its copy, whatever
			-- before an older blueprint gave it, because a building cannot be
			-- raised once it stands (#4817).
			step.after, step.base, step.blocked = first, base, false
			for _, point in ipairs(step.points) do
				if pointOffMap(point.x, point.z) then
					step.blocked = true
				end
			end
		end
		local within = 0
		if #foot >= first + n then
			within = ringsFirst(copy, foot, first, n)
		end
		local laid = {}
		for _, step in ipairs(copy) do
			local parts = { step }
			if M.closedRing(step) then
				parts = M.ringSides(step)
			elseif step.shape == "wall" and step.kind ~= "ramp" then
				parts = M.wallPieces(step)
			end
			for _, part in ipairs(parts) do
				laid[#laid + 1] = part
			end
		end
		if exit then
			sweep(laid, exit)
			-- the last side of each ring closes it, and its builders stand on the
			-- exit side for it
			local closed = {}
			for i = #laid, 1, -1 do
				local ring = laid[i].ring
				if ring and not closed[ring] then
					closed[ring] = true
					laid[i].exit = { x = exit.x, z = exit.z }
				end
			end
			if #foot >= first + n and not resolved.ordered then
				sweepFoot(foot, first + 1, first + within, exit)
				sweepFoot(foot, first + within + 1, first + n, exit)
			end
		end
		for _, step in ipairs(laid) do
			out[#out + 1] = step
		end
	end
	return out
end

local function middleOf(points)
	local sx, sz = 0, 0
	for _, p in ipairs(points) do
		sx, sz = sx + p.x, sz + p.z
	end
	return sx / #points, sz / #points
end

local function distance2(x, z, at)
	return (x - at.x) ^ 2 + (z - at.z) ^ 2
end

--- Steps farthest from the exit first, keeping the order of steps as far.
sweep = function(steps, exit)
	local keyed = {}
	for i, step in ipairs(steps) do
		local x, z = middleOf(step.points)
		keyed[i] = { step = step, d = distance2(x, z, exit), i = i }
	end
	table.sort(keyed, function(a, b)
		if a.d ~= b.d then
			return a.d > b.d
		end
		return a.i < b.i
	end)
	for i, k in ipairs(keyed) do
		steps[i] = k.step
	end
end

--- Buildings from one to another in foot farthest from the exit first,
-- numbered again.
sweepFoot = function(foot, from, to, exit)
	if to <= from then
		return
	end
	local keyed = {}
	for i = from, to do
		keyed[#keyed + 1] = { p = foot[i], d = distance2(foot[i].x, foot[i].z, exit), i = i }
	end
	table.sort(keyed, function(a, b)
		if a.d ~= b.d then
			return a.d > b.d
		end
		return a.i < b.i
	end)
	for j, k in ipairs(keyed) do
		local i = from + j - 1
		foot[i] = k.p
		if foot[i].seq then
			foot[i].seq = i
		end
	end
end

-- How long a block of wall Zero-K builds with one terraform unit is: 14 of
-- its path points, 16 elmos apart (unit_terraform.lua, wallSegmentLength).
M.WALL_BLOCK = 14 * 16

--- An open wall longer than one block as one step for each block, so the
-- builders can sweep along it (#4816). Each cut is on the 16 elmo grid the
-- gadget puts a wall's path on. The pieces keep the wall's points as wall,
-- which ties them together: a raise is measured from the ground when it is
-- ordered, and the pieces share the ends they meet at, so they are ordered
-- together.
-- @return table[] the pieces, or the step itself when it is one block or less
function M.wallPieces(step)
	local points = step.points
	local total = 0
	for i = 1, #points - 1 do
		total = total + math.sqrt((points[i + 1].x - points[i].x) ^ 2 + (points[i + 1].z - points[i].z) ^ 2)
	end
	if total <= M.WALL_BLOCK then
		return { step }
	end
	local function snap(v)
		return math.floor(v / 16 + 0.5) * 16
	end
	local pieces, current, run = {}, { { x = points[1].x, z = points[1].z } }, 0
	for i = 1, #points - 1 do
		local a, b = points[i], points[i + 1]
		local len = math.sqrt((b.x - a.x) ^ 2 + (b.z - a.z) ^ 2)
		local along = 0
		while len - along > M.WALL_BLOCK - run do
			along = along + M.WALL_BLOCK - run
			local cut = { x = snap(a.x + (b.x - a.x) * along / len), z = snap(a.z + (b.z - a.z) * along / len) }
			current[#current + 1] = cut
			pieces[#pieces + 1] = current
			current, run = { { x = cut.x, z = cut.z } }, 0
		end
		run = run + len - along
		current[#current + 1] = { x = b.x, z = b.z }
	end
	if #current > 1 and run > 0 then
		pieces[#pieces + 1] = current
	end
	local out = {}
	for _, piecePoints in ipairs(pieces) do
		local piece = {}
		for k, v in pairs(step) do
			piece[k] = v
		end
		piece.points = piecePoints
		piece.wall = points
		out[#out + 1] = piece
	end
	return out
end

--- A closed ring of wall as one step for each side, ordered together (#4816).
-- Zero-K puts each terraform unit up to 100 elmos from its place towards the
-- middle of the order's builders, and moves it towards the builder working on
-- it only once in a long while (unit_terraform.lua, GetTerraunitLeashedSpot and
-- checkLoopFrames). For one order round a whole ring, the units of the far
-- side end up inside the ring, where nobody outside can reach them. So each
-- side is its own order, and names no builders, which makes the gadget pull its
-- units towards the order's centre instead: bias, a leash's length out from the
-- middle of the side. Each side keeps the ring's outline as ring, which is also
-- what ties the sides together, since a raise is measured from the ground when
-- it is ordered and the sides share their corners.
-- @param step table a laid step that M.closedRing accepts
-- @return table[] the sides, each a wall of two points
function M.ringSides(step)
	local points = step.points
	local cx, cz = 0, 0
	for i = 1, #points - 1 do
		cx, cz = cx + points[i].x, cz + points[i].z
	end
	cx, cz = cx / (#points - 1), cz / (#points - 1)
	local out = {}
	for i = 1, #points - 1 do
		local a, b = points[i], points[i + 1]
		local dx, dz = b.x - a.x, b.z - a.z
		local len = math.sqrt(dx * dx + dz * dz)
		if len > 0 then
			local mx, mz = (a.x + b.x) / 2, (a.z + b.z) / 2
			local nx, nz = dz / len, -dx / len
			if nx * (mx - cx) + nz * (mz - cz) < 0 then
				nx, nz = -nx, -nz
			end
			local side = {}
			for k, v in pairs(step) do
				side[k] = v
			end
			side.points = { { x = a.x, z = a.z }, { x = b.x, z = b.z } }
			side.ring = points
			side.bias = { x = mx + nx * M.TERRAUNIT_LEASH, z = mz + nz * M.TERRAUNIT_LEASH }
			out[#out + 1] = side
		end
	end
	return out
end

--------------------------------------------------------------------------------
-- Stepping clear of a step (#4816)
--------------------------------------------------------------------------------

-- A set of 8 elmo heightmap corners, by their place in the grid.
local function mark(set, x, z)
	local iz, ix = math.floor(z / 8 + 0.5), math.floor(x / 8 + 0.5)
	local row = set[iz]
	if not row then
		row = {}
		set[iz] = row
	end
	row[ix] = true
end

local function marked(set, x, z)
	local row = set[math.floor(z / 8 + 0.5)]
	return row ~= nil and row[math.floor(x / 8 + 0.5)] == true
end

--- What a builder must not stand on while a layout's steps are built: every
-- corner a step changes, its slopes and their foot included, and every corner
-- under one of the layout's buildings. Also the closed rings of wall, which it
-- must not be shut inside.
-- @param results table[] from the terraform model's session.apply, each with
--   shape and slope lists of { x, z }
-- @param steps table[] the laid steps, for their rings
-- @param foot table[]? the layout's buildings
-- @return table { corners = set, rings = { outline } }
function M.keepOff(results, steps, foot)
	local corners = {}
	for _, r in ipairs(results or {}) do
		for _, c in ipairs(r.shape or {}) do
			mark(corners, c.x, c.z)
		end
		for _, c in ipairs(r.slope or {}) do
			mark(corners, c.x, c.z)
		end
	end
	for _, p in ipairs(foot or {}) do
		if p.def then
			local hw, hd = M.halfSpan(p.def, p.facing or 0)
			for x = p.x - hw, p.x + hw, 8 do
				for z = p.z - hd, p.z + hd, 8 do
					mark(corners, x, z)
				end
			end
		end
	end
	local rings, seen = {}, {}
	for _, step in ipairs(steps or {}) do
		local ring = step.ring or (M.closedRing(step) and step.points)
		if ring and not seen[ring] then
			seen[ring] = true
			rings[#rings + 1] = ring
		end
	end
	return { corners = corners, rings = rings }
end

--- The spots a builder could step clear to for one step, before the side it is
-- on is taken into account: on the build grid, clear of keepOff's corners by
-- clearance, outside every closed ring, on the map, and within range of the
-- nearest corner the step raises or lowers. Each spot counts the step's
-- corners it reaches with the terraform units' leash, so a spot that reaches
-- all of it is preferred and the builder need not walk on to the far side.
-- @param shape table[] the step's own corners, { x, z }, from the model
-- @param off table from M.keepOff
-- @param range number the builder's build range
-- @param clearance number how far round the spot must be clear
-- @return table[] { x, z, reach }
function M.clearSpots(shape, off, range, clearance)
	if #shape == 0 then
		return {}
	end
	-- the reach is counted over the step's corners on the 16 elmo grid, a
	-- quarter of them, to keep the work small
	local sample = {}
	local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
	for _, c in ipairs(shape) do
		minX, maxX = math.min(minX, c.x), math.max(maxX, c.x)
		minZ, maxZ = math.min(minZ, c.z), math.max(maxZ, c.z)
		if c.x % 16 == 0 and c.z % 16 == 0 then
			sample[#sample + 1] = c
		end
	end
	if #sample == 0 then
		sample = shape
	end
	local g = M.CLEAR_GRID
	local reach2 = (range + M.TERRAUNIT_LEASH) ^ 2
	local range2 = range * range
	local out = {}
	for x = math.floor((minX - range) / g) * g, maxX + range, g do
		for z = math.floor((minZ - range) / g) * g, maxZ + range, g do
			local ok = not pointOffMap(x, z)
			for cx = x - clearance, x + clearance, 8 do
				if not ok then
					break
				end
				for cz = z - clearance, z + clearance, 8 do
					if marked(off.corners, cx, cz) then
						ok = false
						break
					end
				end
			end
			for _, ring in ipairs(off.rings) do
				if ok and M.inside(ring, x, z) then
					ok = false
				end
			end
			if ok then
				local near, reach = false, 0
				for _, c in ipairs(shape) do
					if (c.x - x) ^ 2 + (c.z - z) ^ 2 <= range2 then
						near = true
						break
					end
				end
				if near then
					for _, c in ipairs(sample) do
						if (c.x - x) ^ 2 + (c.z - z) ^ 2 <= reach2 then
							reach = reach + 1
						end
					end
					out[#out + 1] = { x = x, z = z, reach = reach }
				end
			end
		end
	end
	return out
end

--- Whether a unit can stand at a point, as far as the player can tell. The
-- engine answers only where the player has line of sight
-- (LuaSyncedRead::TestMoveOrder), so a point out of sight is taken to be fine:
-- it is clear of the steps' ground, which is what matters most.
function M.canStand(defID, x, z)
	if not Spring.TestMoveOrder then
		return true
	end
	local y = Spring.GetGroundHeight(x, z)
	if Spring.IsPosInLos and not Spring.IsPosInLos(x, y, z) then
		return true
	end
	return Spring.TestMoveOrder(defID, x, y, z)
end

--- Where a builder steps to before it works on a step: of spots from
-- M.clearSpots, those on the builder's side of the step's middle, the one that
-- reaches most of the step, the nearest to the builder of those. A builder at
-- the middle of the step has no side.
-- @param spots table[] from M.clearSpots
-- @param shape table[] the step's corners, for its middle
-- @param fx number where the builder is, or will be when it gets to the step
-- @param fz number
-- @param stand function(x, z) -> boolean? whether the builder can stand there
-- @return table? { x, z }
function M.clearSpot(spots, shape, fx, fz, stand)
	if #spots == 0 then
		return nil
	end
	local mx, mz = 0, 0
	for _, c in ipairs(shape) do
		mx, mz = mx + c.x, mz + c.z
	end
	mx, mz = mx / #shape, mz / #shape
	local sx, sz = fx - mx, fz - mz
	local sided = sx * sx + sz * sz >= 1
	local list = {}
	for _, s in ipairs(spots) do
		if not sided or (s.x - mx) * sx + (s.z - mz) * sz > 0 then
			list[#list + 1] = { x = s.x, z = s.z, reach = s.reach, d = (s.x - fx) ^ 2 + (s.z - fz) ^ 2 }
		end
	end
	table.sort(list, function(a, b)
		if a.reach ~= b.reach then
			return a.reach > b.reach
		end
		if a.d ~= b.d then
			return a.d < b.d
		end
		if a.x ~= b.x then
			return a.x < b.x
		end
		return a.z < b.z
	end)
	for _, s in ipairs(list) do
		if not stand or stand(s.x, s.z) then
			return { x = s.x, z = s.z }
		end
	end
	return nil
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
	-- a side of a ring names no builders, so its units go towards its bias
	if step.bias then
		cx, cz, builders = step.bias.x, step.bias.z, {}
	end
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
	local out = { TERRAFORM_TYPE[step.kind], team, cx, cz, tag, step.shape == "area" and 1 or 0, height, #step.points, #builders, 0 }
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
	local labelled = {}
	for _, step in ipairs(steps or {}) do
		-- a ring ordered side by side has one label, over its middle, where its
		-- last point is its first
		local points, count = step.points, #step.points
		if step.ring then
			points, count = step.ring, #step.ring - 1
		end
		if not labelled[points] then
			labelled[points] = true
			local sx, sz = 0, 0
			for i = 1, count do
				sx, sz = sx + points[i].x, sz + points[i].z
			end
			out[#out + 1] = M.label(step, sx / count, sz / count)
		end
	end
	return out
end

--- One step's label, over a point.
function M.label(step, cx, cz)
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
	return { x = cx, y = top + M.LABEL_LIFT, z = cz, text = text }
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
--   Every builder that can terraform is given every step, ahead of its
--   first building, so none reaches a building before the ground is done.
-- @param terrain table? { steps = from M.laySteps, on = boolean, why = string,
--   ground = table[]? }. When on is false the steps are counted as skipped,
--   for the reason why. ground is the terraform model's results for steps,
--   from session.apply(steps, foot). With it, each builder is sent clear of a
--   step's ground with a move ahead of the step's level command (#4816).
-- @return table { orders = { { unitID, cmds } }, remainder = foot entries nobody
--   can build, blocked = count of positions skipped because the ground refused,
--   terraform = { { unitID, params, tag, levelAt = { { unitID, index } }, where
--   each builder's level step is in its orders } }, stepRemainder
--   = steps kept for when a builder is selected, skipped = steps not ordered
--   for skippedWhy, offMap = steps with a point off the map, clear = { {
--   unitID, tag, spots, range, stop, apart, defID } } for step_clear.lua to
--   keep each builder clear while it works on each step, gathers = { tag =
--   unitID[] } the builders that wait for each other before a step }
function M.plan(foot, can, shift, mode, terrain)
	local out = { orders = {}, remainder = {}, blocked = 0, terraform = {}, stepRemainder = {}, skipped = 0, offMap = 0, shift = shift, clear = {}, gathers = {} }
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
				local builders = can.terraformers
				local tag = M.nextTag()
				local team = Spring.GetUnitTeam(builders[1]) or Spring.GetMyTeamID()
				local at = {}
				for _, unitID in ipairs(builders) do
					at[unitID] = true
				end
				local t = { unitID = builders[1], params = M.terraformParams(u.step, builders, tag, team), tag = tag, levelAt = {}, group = u.step.ring or u.step.wall }
				steps[#steps + 1] = { step = u.step, tag = tag, at = at, t = t, i = u.i }
				out.terraform[#out.terraform + 1] = t
			end
			-- what each step changes, for the spot each builder steps clear to
			if terrain.ground then
				local byIndex = {}
				for _, r in ipairs(terrain.ground) do
					if r.index then
						byIndex[r.index] = r
					end
				end
				local off = M.keepOff(terrain.ground, given, foot)
				for _, s in ipairs(steps) do
					local r = byIndex[s.i]
					if r and r.shape and #r.shape > 0 then
						s.shape, s.off, s.spots, s.taken = r.shape, off, {}, {}
					end
				end
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
		-- whether an order of this kind is already queued this near a place,
		-- which the engine would take as cancelling it
		local function near(x, z, id)
			for _, c in ipairs(cmds) do
				if c[1] == id and (c[2][1] - x) ^ 2 + (c[2][3] - z) ^ 2 < M.COMMAND_CANCEL_DIST ^ 2 then
					return true
				end
			end
			return false
		end
		-- where the builder will be when it gets to the next step: where it is,
		-- then by the last building or spot it was sent to
		local wx, _, wz = Spring.GetUnitPosition(unitID)
		local def = UnitDefs[Spring.GetUnitDefID(unitID) or -1]
		local function stepClear(s)
			if not (s.spots and wx and def and def.buildDistance) then
				return
			end
			-- clear of the step by half the builder's footprint and the distance
			-- a move stops short of its goal
			local clearance = (def.xsize or 2) * 4 + M.MOVE_STOP
			local key = def.buildDistance .. ":" .. clearance
			s.spots[key] = s.spots[key] or M.clearSpots(s.shape, s.off, def.buildDistance, clearance)
			-- each builder gets a spot of its own, a footprint from the others',
			-- so none stops short of a spot another is standing on
			local apart = (def.xsize or 2) * 8
			-- the side that closes a ring is done from the exit side
			local fx, fz = wx, wz
			if s.step.exit then
				fx, fz = s.step.exit.x, s.step.exit.z
			end
			local spot = M.clearSpot(s.spots[key], s.shape, fx, fz, function(x, z)
				for _, t in ipairs(s.taken) do
					if (t.x - x) ^ 2 + (t.z - z) ^ 2 < apart * apart then
						return false
					end
				end
				if near(x, z, M.CMD_MOVE) then
					return false
				end
				return M.canStand(def.id, x, z)
			end)
			if spot then
				add(M.CMD_MOVE, { spot.x, Spring.GetGroundHeight(spot.x, spot.z), spot.z })
				s.taken[#s.taken + 1] = spot
				wx, wz = spot.x, spot.z
			end
			-- and kept clear while it works on the step (step_clear.lua)
			out.clear[#out.clear + 1] = { unitID = unitID, tag = s.tag, spots = s.spots[key], range = def.buildDistance, stop = M.MOVE_STOP, apart = apart, defID = def.id }
		end
		local next = 1
		local function stepsBefore(seq)
			while steps[next] and (seq == nil or steps[next].step.after < seq) do
				local s = steps[next]
				if s.at[unitID] then
					stepClear(s)
					-- nobody starts raising while another builder may still be on
					-- the ground, or inside the ring
					if s.spots and #can.terraformers > 1 then
						add(M.CMD_WAIT, {})
						out.gathers[s.tag] = out.gathers[s.tag] or {}
						table.insert(out.gathers[s.tag], unitID)
					end
					local step = s.step
					local sx, sz = 0, 0
					for _, p in ipairs(step.points) do
						sx, sz = sx + p.x, sz + p.z
					end
					sx, sz = sx / #step.points, sz / #step.points
					-- the gadget goes by the tag, not the place, so a level command
					-- is moved along until no other is near enough to cancel it
					while near(sx, sz, M.CMD_LEVEL) do
						sx = sx + M.COMMAND_CANCEL_DIST + 1
					end
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
				-- a building inside a ring of wall goes to every builder, so none
				-- starts the ring while another is still inside it
				if not p.blocked and (not who or who[i] == unitID or p.insideRing) then
					add(-p.defID, { p.x, p.y, p.z, p.facing })
					wx, wz = p.x, p.z
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
-- @param clear table? the step_clear module, which keeps each builder clear of
--   a step's ground while it works on it
-- @return integer how many builders were given an array
function M.issue(plan, later, clear)
	local sent = 0
	-- a terraform order whose level step is at or next to the front goes
	-- first, so the level step finds its units
	-- the sides of a ring go together, when any of them is near
	local nearGroup = {}
	for _, t in ipairs(plan.terraform or {}) do
		if t.group and later.near(t, plan.shift) then
			nearGroup[t.group] = true
		end
	end
	local held = {}
	for _, t in ipairs(plan.terraform or {}) do
		if (t.group and nearGroup[t.group]) or (not t.group and later.near(t, plan.shift)) then
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
	for tag, units in pairs(clear and plan.gathers or {}) do
		clear.gather(tag, units)
	end
	for _, c in ipairs(clear and plan.clear or {}) do
		clear.watch(c.unitID, c.tag, { spots = c.spots, range = c.range, stop = c.stop, apart = c.apart, defID = c.defID, stand = M.canStand })
	end
	return sent
end

return M
