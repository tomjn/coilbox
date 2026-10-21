-- Run: luajit lua/blueprint-widget/tests/place_test.lua
--
-- Placing: turning a layout, snapping each building to the build grid,
-- marking what is blocked, and turning the result into build orders for the
-- builders that can take them.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local PLACE = support.module("place.lua")

-- xsize and zsize are in half squares, the engine's unit. A 4 by 4 footprint
-- (solar) is an even span, a 3 by 3 (llt) an odd one.
local SOLAR = support.def(1, "armsolar", { isBuilding = true, xsize = 8, zsize = 8 })
local LLT = support.def(2, "armllt", { isBuilding = true, xsize = 6, zsize = 6 })
local WIN = support.def(3, "armwin", { isBuilding = true, xsize = 4, zsize = 6 })
local LAB = support.def(4, "armlab", { isBuilding = true, xsize = 12, zsize = 12 })
local CON = support.def(10, "armck", { buildOptions = { 1, 2, 3 } })
local COM = support.def(11, "armcom", { buildOptions = { 1, 4 } })
local TANK = support.def(12, "armflash", {})

local E = support.engine({ SOLAR, LLT, WIN, LAB, CON, COM, TANK }, {
	selected = { 100, 101, 102 },
	units = {
		[100] = { def = 10 },
		[101] = { def = 11 },
		[102] = { def = 12 },
	},
	ground = function(x, z)
		return 10
	end,
	blocked = function(defID, x, z)
		if x >= 1000 then
			return 0
		end
		return 2
	end,
})
PLACE.use(E)

--------------------------------------------------------------------------------
-- rotation and snapping
--------------------------------------------------------------------------------

local function turns(name, x, z, n, wx, wz)
	local gx, gz = PLACE.turned(x, z, n)
	check(name, gx == wx and gz == wz, gx .. "," .. gz)
end
turns("no turn", 32, -16, 0, 32, -16)
turns("one turn sends x,z to z,-x", 32, -16, 1, -16, -32)
turns("two turns negate", 32, -16, 2, -32, 16)
turns("three turns", 32, -16, 3, 16, 32)
turns("turns wrap", 32, -16, 5, -16, -32)

local ax, az = PLACE.snapAnchor(100, -9)
check("anchor snaps down to the 16 grid", ax == 96 and az == -16, ax .. "," .. az)

--------------------------------------------------------------------------------
-- resolving an entry against the game's defs
--------------------------------------------------------------------------------

local entry = {
	key = "library:eco",
	name = "Eco",
	ordered = true,
	buildings = {
		{ def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 },
		{ def = "armllt", offset = { x = 64, z = 0 }, facing = 1 },
		{ def = "ARMWIN", offset = { x = 0, z = 48 }, facing = 3 },
		{ def = "armlab", offset = { x = -96, z = 0 }, facing = 0 },
	},
}
local resolved = PLACE.resolve(entry)
check("resolve finds every def, case blind", #resolved.buildings == 4 and #resolved.missing == 0, show(resolved.missing))
check("resolve keeps the def id on each building", resolved.buildings[3].defID == 3, show(resolved.buildings[3]))

local partial = PLACE.resolve({ buildings = { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 }, { def = "corgant", offset = { x = 0, z = 0 }, facing = 0 } } })
check("resolve lists defs the game does not have", same(partial.missing, { "corgant" }) and #partial.buildings == 1, show(partial))

--------------------------------------------------------------------------------
-- a footprint on the ground
--------------------------------------------------------------------------------

local foot = PLACE.footprint(resolved, 0, 320, 320)
check("footprint has one position per building", #foot == 4, show(foot))
check(
	"even span snaps to a corner, odd span to a centre",
	foot[1].x == 320 and foot[1].z == 320 and foot[2].x == 392 and foot[2].z == 328,
	show({ foot[1], foot[2] })
)
check("footprint carries the ground height", foot[1].y == 10)
check("footprint keeps def ids and facings", foot[2].defID == 2 and foot[2].facing == 1 and foot[3].facing == 3)
check("open ground is not blocked", foot[1].blocked == false)

local turnedFoot = PLACE.footprint(resolved, 1, 320, 320)
check(
	"rotation turns offsets and adds to facings",
	turnedFoot[2].x == 328 and turnedFoot[2].z == 256 + 8 and turnedFoot[2].facing == 2 and turnedFoot[3].facing == 0,
	show(turnedFoot[2])
)

local flipX = PLACE.footprint(resolved, 0, 320, 320, { x = true })
check(
	"flipping side to side mirrors x offsets and swaps east and west facings",
	flipX[2].x == 264 and flipX[2].z == foot[2].z and flipX[2].facing == 3 and flipX[3].facing == 1 and flipX[1].facing == 0,
	show(flipX[2])
)
local flipZ = PLACE.footprint(resolved, 0, 320, 320, { z = true })
check(
	"flipping top to bottom mirrors z offsets and swaps south and north facings",
	flipZ[3].z == 320 - 48 and flipZ[3].x == foot[3].x and flipZ[1].facing == 2 and flipZ[2].facing == 1,
	show(flipZ[3])
)
local turnedFlip = PLACE.footprint(resolved, 1, 320, 320, { x = true })
check("a flip applies after the turn, along the map's x", turnedFlip[2].z == turnedFoot[2].z and turnedFlip[2].facing == 2, show(turnedFlip[2]))
check("flipping both ways is a half turn", (function()
	local both = PLACE.footprint(resolved, 0, 320, 320, { x = true, z = true })
	local half = PLACE.footprint(resolved, 2, 320, 320)
	for i = 1, #both do
		if both[i].x ~= half[i].x or both[i].z ~= half[i].z or both[i].facing ~= half[i].facing then
			return false
		end
	end
	return true
end)())

local square = PLACE.resolve({ buildings = { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 }, { def = "armsolar", offset = { x = 64, z = 0 }, facing = 0 } } })
local minX, maxX, minZ, maxZ = PLACE.extent(square, 0)
check("extent runs edge to edge", minX == -32 and maxX == 96 and minZ == -32 and maxZ == 32, minX .. " " .. maxX .. " " .. minZ .. " " .. maxZ)
local tminX, tmaxX, tminZ, tmaxZ = PLACE.extent(square, 1)
check("extent follows the turn", tminX == -32 and tmaxX == 32 and tminZ == -96 and tmaxZ == 32, tminX .. " " .. tmaxX .. " " .. tminZ .. " " .. tmaxZ)
local fminX, fmaxX = PLACE.extent(square, 0, { x = true })
check("extent follows the flip", fminX == -96 and fmaxX == 32)
local pivotLayout = PLACE.resolve({
	buildings = {
		{ def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 },
		{ def = "armllt", offset = { x = 72, z = 8 }, facing = 1 },
		{ def = "armsolar", offset = { x = 160, z = 0 }, facing = 0 },
	},
})
check("the pivot is the building nearest the middle of the layout", PLACE.pivot(pivotLayout) == 2, tostring(PLACE.pivot(pivotLayout)))
check("an empty layout has no pivot", PLACE.pivot({ buildings = {} }) == nil)
check("a geothermal and an extractor only build on spots", PLACE.spotKind({ needGeo = true }) == "geo" and PLACE.spotKind({ extractsMetal = 0.002 }) == "metal" and PLACE.spotKind({ customParams = { metal_extractor = "1" } }) == "metal" and PLACE.spotKind({}) == nil)
local MEX = support.def(5, "armmex", { isBuilding = true, xsize = 4, zsize = 4, extractsMetal = 0.001 })
E.UnitDefs[5], E.UnitDefNames.armmex = MEX, MEX
local spotLayout = PLACE.resolve({
	buildings = {
		{ def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 },
		{ def = "armsolar", offset = { x = 64, z = 0 }, facing = 0 },
		{ def = "armmex", offset = { x = 128, z = 0 }, facing = 0 },
	},
})
check("a layout with an extractor is held by the extractor, so it can snap to a spot", PLACE.pivot(spotLayout) == 3, tostring(PLACE.pivot(spotLayout)))
local spots = { { x = 100, z = 100 }, { x = 400, z = 400 }, { x = 160, z = 100 } }
check("the nearest spot within reach is found", PLACE.nearestSpot(spots, 150, 110, PLACE.SPOT_SNAP) == spots[3])
check("a spot out of reach is not", PLACE.nearestSpot(spots, 700, 700, PLACE.SPOT_SNAP) == nil and PLACE.nearestSpot(nil, 0, 0, 90) == nil)

-- a 10 by 8 metal map: a two square spot, a lone square, and a strip too
-- wide for one extractor
local metal = {}
metal[2 * 10 + 1], metal[2 * 10 + 2] = 1, 3
metal[6 * 10 + 8] = 2
for x = 0, 9 do
	metal[4 * 10 + x] = 1
end
local function amount(x, z)
	return metal[z * 10 + x] or 0
end
local found = PLACE.metalSpots(PLACE.newMetalScan(10, 8, amount, 16), 48)
check("each patch of metal no wider than an extractor reaches is a spot", #found == 2, show(found))
check("a spot sits at its patch's middle, weighted by metal", found[1].x == (1.75 + 0.5) * 16 and found[1].z == 2.5 * 16, show(found[1]))
check("a lone square is a spot at its own middle", found[2].x == 8.5 * 16 and found[2].z == 6.5 * 16, show(found[2]))
local stepped = PLACE.newMetalScan(10, 8, amount, 16)
local steps = 0
while not PLACE.stepMetalScan(stepped, 3) do
	steps = steps + 1
end
check("a scan run a few squares at a time, pausing inside patches, finds the same spots", steps > 10 and same(PLACE.metalSpots(stepped, 48), found), steps .. " " .. show(PLACE.metalSpots(stepped, 48)))
local partial = PLACE.newMetalScan(10, 8, amount, 16)
PLACE.stepMetalScan(partial, 25)
check("asking for spots part way through finishes the scan at once", not partial.done and same(PLACE.metalSpots(partial, 48), found) and partial.done)
check("a wider extractor counts a wider patch as a spot", #PLACE.metalSpots(stepped, 160) == 3)
check("an empty metal map is done before it starts", PLACE.newMetalScan(0, 0, amount, 16).done)

local px, pz = PLACE.pivotAt(pivotLayout, 2, 0, nil, 500, 500)
check("the pivot lands on the grid the engine snaps it to", px == 504 and pz == 504, px .. "," .. pz)
local pivotOrigin = pivotLayout.buildings[2].offset
for _, case in ipairs({ { 0 }, { 1 }, { 2 }, { 3 }, { 1, { x = true } }, { 0, { z = true } } }) do
	local foot = PLACE.footprint(pivotLayout, case[1], px, pz, case[2], pivotOrigin)
	check("turned " .. case[1] .. (case[2] and " and flipped" or "") .. ", the pivot stays under the cursor", foot[2].x == px and foot[2].z == pz, show(foot[2]))
end
local spun = PLACE.footprint(pivotLayout, 2, px, pz, nil, pivotOrigin)
check("the rest of the layout turns about the pivot", spun[1].x == px + 72 and spun[3].x == px - 88, spun[1].x .. " " .. spun[3].x)

local line = PLACE.line(0, 0, 400, 30, minX, maxX, minZ, maxZ)
check("a line runs along the axis it covers most, each copy touching the last", #line == 4 and line[2].x == 128 and line[2].z == 0 and line[4].x == 384, show(line))
local back = PLACE.line(0, 0, 10, -300, minX, maxX, minZ, maxZ)
check("a line runs backward too, along z", #back == 6 and back[2].z == -64 and back[2].x == 0, show(back))
check("a line with no length is one copy", #PLACE.line(16, 16, 16, 16, minX, maxX, minZ, maxZ) == 1)

local blockedFoot = PLACE.footprint(resolved, 0, 1024, 0)
check("a blocked square is marked", blockedFoot[1].blocked == true and blockedFoot[4].blocked == false, show(blockedFoot))

--------------------------------------------------------------------------------
-- who can build what
--------------------------------------------------------------------------------

local can = PLACE.capabilities({ 100, 101, 102 })
check("capabilities unions the selected builders", same(can.union, { [1] = true, [2] = true, [3] = true, [4] = true }), show(can.union))
check("capabilities keeps each builder's own set", same(can.byUnit[101], { [1] = true, [4] = true }) and can.byUnit[102] == nil, show(can.byUnit))
check("capabilities lists builders in selection order", same(can.builders, { 100, 101 }), show(can.builders))

local none = PLACE.capabilities({ 102 })
check("no builders selected is an empty union", same(none.union, {}) and #none.builders == 0)

local function classify(name, bs, want)
	local got = PLACE.classify(PLACE.resolve({ buildings = bs }), can)
	check(name, got == want, got)
end
classify("all buildable is now", { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 } }, "now")
classify("some buildable is partly", { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 }, { def = "corgant", offset = { x = 0, z = 0 }, facing = 0 } }, "partly")
classify("none buildable is never", { { def = "corgant", offset = { x = 0, z = 0 }, facing = 0 } }, "never")
classify("empty is never", {}, "never")

--------------------------------------------------------------------------------
-- orders
--------------------------------------------------------------------------------

local plan = PLACE.plan(foot, can, false)
check("plan gives every builder the buildings it can build, in layout order", #plan.orders == 2, show(plan.orders))
local conOrders = plan.orders[1]
check("the first builder is the constructor", conOrders.unitID == 100)
check(
	"build commands are the negative def id with position and facing",
	same(conOrders.cmds[1], { -1, { 320, 10, 320, 0 }, {} }),
	show(conOrders.cmds[1])
)
check("the first command replaces the queue and the rest append", same(conOrders.cmds[2][3], { "shift" }) and same(conOrders.cmds[3][3], { "shift" }), show(conOrders.cmds))
check("a builder skips what it cannot build", #conOrders.cmds == 3 and conOrders.cmds[3][1] == -3)
check("the commander gets the lab and the solar", #plan.orders[2].cmds == 2 and plan.orders[2].cmds[2][1] == -4, show(plan.orders[2].cmds))
check("nothing is left over when the union covers the layout", #plan.remainder == 0)

local shifted = PLACE.plan(foot, can, true)
check("with shift held every command appends", same(shifted.orders[1].cmds[1][3], { "shift" }))

local conOnly = PLACE.capabilities({ 100 })
local partialPlan = PLACE.plan(foot, conOnly, false)
check("what no builder can build is the remainder", #partialPlan.remainder == 1 and partialPlan.remainder[1].defID == 4, show(partialPlan.remainder))
check("the remainder keeps its world position", partialPlan.remainder[1].x == foot[4].x and partialPlan.remainder[1].z == foot[4].z)

local blockedPlan = PLACE.plan(blockedFoot, can, false)
check("blocked positions are not ordered and not remaindered", #blockedPlan.orders == 1 and #blockedPlan.orders[1].cmds == 1 and #blockedPlan.remainder == 0, show(blockedPlan))
check("a builder with nothing to do gets no order array", blockedPlan.orders[1].unitID == 101)
check("skipped positions are counted", blockedPlan.blocked == 3)

local emptyPlan = PLACE.plan(foot, none, false)
check("no builders means no orders and everything left over", #emptyPlan.orders == 0 and #emptyPlan.remainder == 4)

-- splitting the work
local SPLIT_SOLAR = support.def(20, "splitsolar", { isBuilding = true, xsize = 4, zsize = 4, buildTime = 100, metalCost = 10, energyCost = 0 })
local SPLIT_CON = support.def(21, "splitcon", { buildOptions = { 20 }, buildSpeed = 10, speed = 50 })
local SPLIT_LAB = support.def(22, "splitlab", { isBuilding = true, xsize = 8, zsize = 8, buildTime = 400, metalCost = 200, energyCost = 1000 })
local splitE = support.engine({ SPLIT_SOLAR, SPLIT_CON, SPLIT_LAB }, {
	units = {
		[300] = { def = 21, x = 0, z = 0 },
		[301] = { def = 21, x = 1000, z = 0 },
	},
})
PLACE.use(splitE)
local row = {}
for i, x in ipairs({ 0, 32, 64, 936, 968, 1000 }) do
	row[i] = { defID = 20, def = SPLIT_SOLAR, x = x, y = 0, z = 0, facing = 0, blocked = false }
end
local twoCons = PLACE.capabilities({ 300, 301 })
check("capabilities records each builder's build speed", twoCons.speed[300] == 10 and twoCons.speed[301] == 10)
local helped = PLACE.plan(row, twoCons, false)
check("helping gives both builders every building", #helped.orders == 2 and #helped.orders[1].cmds == 6 and #helped.orders[2].cmds == 6)
local splitPlan = PLACE.plan(row, twoCons, false, "split")
local function xs(order)
	local out = {}
	for i, cmd in ipairs(order.cmds) do
		out[i] = cmd[2][1]
	end
	return out
end
check("splitting gives each building to one builder, the nearest", same(xs(splitPlan.orders[1]), { 0, 32, 64 }) and same(xs(splitPlan.orders[2]), { 936, 968, 1000 }), show(splitPlan.orders))
check("split orders still replace the queue first and then append", same(splitPlan.orders[2].cmds[1][3], {}) and same(splitPlan.orders[2].cmds[2][3], { "shift" }))
local clustered = {}
for i = 1, 4 do
	clustered[i] = { defID = 20, def = SPLIT_SOLAR, x = 16 * i, y = 0, z = 0, facing = 0, blocked = false }
end
local shared = PLACE.plan(clustered, twoCons, false, "split")
check("when it is all near one builder, the other still takes a share", #shared.orders == 2 and #shared.orders[1].cmds + #shared.orders[2].cmds == 4, show(shared.orders))
row[2].blocked = true
local splitBlocked = PLACE.plan(row, twoCons, false, "split")
check("splitting skips and counts blocked positions", #splitBlocked.orders[1].cmds == 2 and splitBlocked.blocked == 1 and #splitBlocked.remainder == 0)

local m, en, secs = PLACE.cost({ buildings = { { defID = 20, def = SPLIT_SOLAR }, { defID = 22, def = SPLIT_LAB } } }, twoCons)
check("cost adds every building's metal and energy", m == 210 and en == 1000, m .. " " .. en)
check("build time counts only what the builders can build, at their speed together", secs == 100 / 20, tostring(secs))
local _, _, noTime = PLACE.cost({ buildings = { { defID = 20, def = SPLIT_SOLAR } } }, PLACE.capabilities({}))
check("with no builder there is no build time", noTime == nil)
PLACE.use(E)

-- sides and morphs
local FED_COM = support.def(30, "fedcom", { buildOptions = { 31 } })
local FED_LAB = support.def(31, "fedlab", { isBuilding = true, buildOptions = { 32 } })
local FED_CON = support.def(32, "fedcon", { buildOptions = { 33 } })
local FED_SOLAR = support.def(33, "fedsolar", { isBuilding = true })
local FED_COM2 = support.def(34, "fedcom_up1", { buildOptions = { 35 } })
local FED_FUSION = support.def(35, "fedfusion", { isBuilding = true })
local LOZ_LAB = support.def(36, "lozlab", { isBuilding = true, customParams = { morphto = "lozlab2" } })
local LOZ_LAB2 = support.def(37, "lozlab2", { isBuilding = true })
local sides = support.engine({ FED_COM, FED_LAB, FED_CON, FED_SOLAR, FED_COM2, FED_FUSION, LOZ_LAB, LOZ_LAB2 })
PLACE.use(sides)
local morphs = PLACE.morphTargets({ { fedcom = { { into = "fedcom_up1" } } }, { notaunit = { into = "fedcom" } }, "not a table" })
check("morph targets come from config tables and custom params", same(morphs[30], { 34 }) and same(morphs[36], { 37 }) and morphs[99] == nil, show(morphs))
local reach = PLACE.reach({ 30 }, morphs)
check("a team reaches what it builds, what that builds, and what it morphs into", reach[31] and reach[32] and reach[33] and reach[34] and reach[35], show(reach))
check("a team does not reach another side's buildings", not reach[36] and not reach[37])
local mixed = { buildings = { { defID = 33 }, { defID = 36 }, { defID = 37 } } }
check("foreign counts the buildings the team can never build", PLACE.foreign(mixed, reach) == 2)
check("with no reach known nothing is foreign", PLACE.foreign(mixed, nil) == 0)

local F1 = support.def(40, "f1landfac", { isBuilding = true, xsize = 12, zsize = 12 })
local F2 = support.def(41, "f2landfac", { isBuilding = true, xsize = 12, zsize = 12 })
local F3 = support.def(42, "f3landfac", { isBuilding = true, xsize = 12, zsize = 12 })
local BUILDER = support.def(43, "builder", { buildOptions = { 40 } })
local tiers = support.engine({ F1, F2, F3, BUILDER })
PLACE.use(tiers)
local tierMorphs = PLACE.morphTargets({ { f1landfac = { into = "f2landfac" }, f2landfac = { { into = "f3landfac" } } } })
local tierReach = PLACE.reach({ 43 }, tierMorphs)
local stand = PLACE.standIns(tierReach, tierMorphs)
check("a def reached only by morphing stands in as the first buildable def back along the chain", stand[41] == 40 and stand[42] == 40, show(stand))
check("a buildable def has no stand-in", stand[40] == nil and stand[43] == nil)
local tierLayout = PLACE.resolve({ buildings = { { def = "f2landfac", offset = { x = 0, z = 0 }, facing = 1 }, { def = "f1landfac", offset = { x = 200, z = 0 }, facing = 0 } } })
local swapped, n = PLACE.substitute(tierLayout, stand)
check("substitute swaps in the stand-in and keeps the place and facing", n == 1 and swapped.buildings[1].defID == 40 and swapped.buildings[1].facing == 1 and swapped.buildings[1].offset.x == 0, show(swapped.buildings[1]))
check("a swapped building remembers what it becomes", swapped.buildings[1].upgradesTo == F2 and swapped.buildings[2].upgradesTo == nil)
check("with no stand-ins nothing is swapped", select(2, PLACE.substitute(tierLayout, nil)) == 0)

-- the map's edge
local edged = support.engine({ SOLAR })
edged.Game.mapSizeX, edged.Game.mapSizeZ = 512, 512
PLACE.use(edged)
local edgeLayout = PLACE.resolve({ buildings = { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 }, { def = "armsolar", offset = { x = 64, z = 0 }, facing = 0 } } })
local edgeFoot = PLACE.footprint(edgeLayout, 0, 480, 256)
check("a building reaching past the map's edge is refused", edgeFoot[1].blocked == false and edgeFoot[2].blocked == true, show(edgeFoot))
check("a building past the low edge is refused too", PLACE.footprint(edgeLayout, 0, 16, 16)[1].blocked == true)
PLACE.use(E)

E.orders = {}
local issued = PLACE.issue(plan)
check("issue sends one array per builder", issued == 2 and #E.orders == 2, show(E.orders))
check("issue addresses each builder alone", same(E.orders[1].units, { 100 }) and same(E.orders[2].units, { 101 }))
check("issue passes the commands through", same(E.orders[1].cmds, conOrders.cmds))

E.orders = {}
check("issuing an empty plan sends nothing", PLACE.issue(emptyPlan) == 0 and #E.orders == 0)

support.report()
