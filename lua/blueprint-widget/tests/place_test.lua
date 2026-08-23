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

E.orders = {}
local issued = PLACE.issue(plan)
check("issue sends one array per builder", issued == 2 and #E.orders == 2, show(E.orders))
check("issue addresses each builder alone", same(E.orders[1].units, { 100 }) and same(E.orders[2].units, { 101 }))
check("issue passes the commands through", same(E.orders[1].cmds, conOrders.cmds))

E.orders = {}
check("issuing an empty plan sends nothing", PLACE.issue(emptyPlan) == 0 and #E.orders == 0)

support.report()
