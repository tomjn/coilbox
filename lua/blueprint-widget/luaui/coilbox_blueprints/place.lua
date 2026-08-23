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

--- Where every building of a resolved entry lands, for a given anchor and
-- rotation, snapped and tested against the ground.
-- @param resolved table from M.resolve
-- @param rotation integer quarter turns
-- @param ax number anchor x, elmos
-- @param az number anchor z, elmos
-- @return table[] { defID, def, x, y, z, facing, blocked }
function M.footprint(resolved, rotation, ax, az)
	local out = {}
	for i, b in ipairs(resolved.buildings) do
		local ox, oz = M.turned(b.offset.x, b.offset.z, rotation)
		local facing = (b.facing + rotation) % 4
		local x, y, z = Spring.Pos2BuildPos(b.defID, ax + ox, 0, az + oz, facing)
		local status = Spring.TestBuildOrder(b.defID, x, y, z, facing)
		out[i] = { defID = b.defID, def = b.def, x = x, y = y, z = z, facing = facing, blocked = status == 0 }
	end
	return out
end

--- What the selected units can build.
-- @param unitIDs integer[]
-- @return table { union = { defID = true }, byUnit = { unitID = { defID = true } }, builders = unitID[] }
function M.capabilities(unitIDs)
	local out = { union = {}, byUnit = {}, builders = {} }
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

--- Turn a footprint into orders.
-- @param foot table[] from M.footprint
-- @param can table from M.capabilities
-- @param shift boolean whether the player holds shift, which appends everything
-- @return table { orders = { { unitID, cmds } }, remainder = foot entries nobody
--   can build, blocked = count of positions skipped because the ground refused }
function M.plan(foot, can, shift)
	local out = { orders = {}, remainder = {}, blocked = 0 }
	local taken = {}
	for _, unitID in ipairs(can.builders) do
		local own = can.byUnit[unitID]
		local cmds = {}
		for i, p in ipairs(foot) do
			if own[p.defID] then
				taken[i] = true
				if not p.blocked then
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
