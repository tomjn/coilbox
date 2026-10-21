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

local Spring, UnitDefs, UnitDefNames

--- Hand over the engine tables. A test passes a stub.
-- @param engine table Spring, UnitDefs, UnitDefNames
function M.use(engine)
	Spring = engine.Spring
	UnitDefs = engine.UnitDefs
	UnitDefNames = engine.UnitDefNames
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
-- @return table { buildings = { { defID, def, offset, facing } }, missing = { name } }
function M.resolve(entry)
	local out = { buildings = {}, missing = {} }
	for _, b in ipairs(entry.buildings) do
		local def = defByName(b.def)
		if def then
			out.buildings[#out.buildings + 1] = { defID = def.id, def = def, offset = b.offset, facing = b.facing }
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
-- @return table[] { defID, def, x, y, z, facing, blocked }
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
		out[i] = { defID = b.defID, def = b.def, x = x, y = y, z = z, facing = facing, blocked = status == 0 }
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
	if minX == math.huge then
		return 0, 0, 0, 0
	end
	return minX, maxX, minZ, maxZ
end

--- The building a layout is held by while it is placed: the one nearest
-- the middle of the layout, the first in layout order on a tie. The cursor
-- holds it, and the layout turns and flips about it.
-- @return integer? its index in resolved.buildings, nil for an empty layout
function M.pivot(resolved)
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
-- flipped. The layout's other buildings keep their place around it.
-- @return number x, number z
function M.pivotAt(resolved, pivot, rotation, flip, x, z)
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

--- What the selected units can build, and how fast.
-- @param unitIDs integer[]
-- @return table { union = { defID = true }, byUnit = { unitID = { defID = true } },
--   builders = unitID[], speed = { unitID = build speed } }
function M.capabilities(unitIDs)
	local out = { union = {}, byUnit = {}, builders = {}, speed = {} }
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
		end
	end
	return out
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

--- Turn a footprint into orders.
-- @param foot table[] from M.footprint
-- @param can table from M.capabilities
-- @param shift boolean whether the player holds shift, which appends everything
-- @param mode string? "help", the default, gives every builder every building
--   it can build, so they help each other with each one in turn. "split"
--   gives each building to one builder, for games that stop builders helping.
-- @return table { orders = { { unitID, cmds } }, remainder = foot entries nobody
--   can build, blocked = count of positions skipped because the ground refused }
function M.plan(foot, can, shift, mode)
	local out = { orders = {}, remainder = {}, blocked = 0 }
	local who = mode == "split" and split(foot, can) or nil
	local taken = {}
	for _, unitID in ipairs(can.builders) do
		local own = can.byUnit[unitID]
		local cmds = {}
		for i, p in ipairs(foot) do
			if own[p.defID] then
				taken[i] = true
				if not p.blocked and (not who or who[i] == unitID) then
					local opts = (shift or #cmds > 0) and { "shift" } or {}
					cmds[#cmds + 1] = { -p.defID, { p.x, p.y, p.z, p.facing }, opts }
				end
			end
		end
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
-- @return number metal, number energy, number? seconds, nil with no builder
--   for any of it
function M.cost(resolved, can)
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
	if work == 0 or speed <= 0 then
		return metal, energy, nil
	end
	return metal, energy, work / speed
end

--- Send a plan's orders to the engine.
-- @return integer how many builders were given an array
function M.issue(plan)
	local sent = 0
	for _, order in ipairs(plan.orders) do
		if Spring.GiveOrderArrayToUnitArray({ order.unitID }, order.cmds) then
			sent = sent + 1
		end
	end
	return sent
end

return M
