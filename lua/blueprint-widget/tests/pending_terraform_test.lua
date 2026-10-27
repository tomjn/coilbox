-- Run: luajit lua/blueprint-widget/tests/pending_terraform_test.lua
--
-- Holding each Zero-K terraform order until a builder nears its level step
-- (issue #4803), so the gadget's two minutes start then and not when the
-- blueprint is placed.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local LATER = support.module("pending_terraform.lua")
local PLACE = support.module("place.lua")

local LEVEL, REPAIR, RAISE = 39736, 40, 39737
local TURRET = support.def(1, "turret", { isBuilding = true, xsize = 4, zsize = 4 })
local CON = support.def(10, "con", { buildOptions = { 1 } })
local LEVEL_DESC = { id = LEVEL, action = "levelground", name = "Level" }

local E
local function engine(units)
	E = support.engine({ TURRET, CON }, { units = units, ground = function()
		return 100
	end, mapSizeX = 4096, mapSizeZ = 4096, team = 3 })
	LATER.use(E)
	PLACE.use(E)
	LATER.reset()
	return E
end

local function build()
	return { -1, { 10, 100, 10, 0 } }
end
local function level(tag)
	return { LEVEL, { 10, 100, 10, tag } }
end

-- a plan's terraform entry for a step with this tag, at these places in the builders' orders
local function entry(tag, levelAt)
	return { unitID = levelAt[1].unitID, params = { 2, 3, 10, 10, tag }, tag = tag, levelAt = levelAt }
end

local function sentTags()
	local out = {}
	for _, o in ipairs(E.single) do
		out[#out + 1] = o.unitID .. ":" .. o.params[5]
	end
	return out
end

--------------------------------------------------------------------------------
-- which orders go at once
--------------------------------------------------------------------------------

engine({ [200] = { def = 10, queue = {} }, [201] = { def = 10, queue = { build(), build() } } })
check("a level step first in the orders is near", LATER.near(entry(5, { { unitID = 200, index = 1 } }), false))
check("a level step after one building is near", LATER.near(entry(5, { { unitID = 200, index = 2 } }), false))
check("a level step after two buildings is not", not LATER.near(entry(5, { { unitID = 200, index = 3 } }), false))
check("with shift, what the builder has queued counts as ahead", not LATER.near(entry(5, { { unitID = 201, index = 1 } }), true))
check("with shift and an empty queue, the first step is near", LATER.near(entry(5, { { unitID = 200, index = 1 } }), true))
check("with several builders, one near is enough", LATER.near(entry(5, { { unitID = 201, index = 1 }, { unitID = 200, index = 2 } }), true))

--------------------------------------------------------------------------------
-- a held order goes when a builder is one building away from its step
--------------------------------------------------------------------------------

engine({ [200] = { def = 10, queue = { build(), build(), level(7), build() } } })
LATER.add(entry(7, { { unitID = 200, index = 3 } }))
LATER.update(1)
check("an order with two buildings ahead of its step is held", #E.single == 0 and LATER.count() == 1)
table.remove(E.units[200].queue, 1)
LATER.update(2)
check("it goes once one building is left ahead, to the builder, with the plan's parameters", same(sentTags(), { "200:7" }) and E.single[1].cmdID == 39801 and E.single[1].options == 0 and same(E.single[1].params, { 2, 3, 10, 10, 7 }), show(E.single))
LATER.update(3)
check("and only once", #E.single == 1 and LATER.count() == 0)

engine({ [200] = { def = 10, queue = { { REPAIR, { 99 } }, level(3), { RAISE, { 1, 2, 3, 4 } }, build(), level(8) } } })
LATER.add(entry(8, { { unitID = 200, index = 5 } }))
LATER.update(1)
check("terraform work ahead does not count as a building: repair, other steps", same(sentTags(), { "200:8" }), show(sentTags()))

engine({ [200] = { def = 10, queue = { build(), level(4), build(), level(9) } } })
LATER.add(entry(4, { { unitID = 200, index = 2 } }))
LATER.add(entry(9, { { unitID = 200, index = 4 } }))
LATER.update(1)
check("of two steps, only the one near the front goes", same(sentTags(), { "200:4" }) and LATER.count() == 1, show(sentTags()))

--------------------------------------------------------------------------------
-- Together and Split up
--------------------------------------------------------------------------------

engine({
	[201] = { def = 10, queue = { build(), level(6) } },
})
LATER.add(entry(6, { { unitID = 200, index = 2 }, { unitID = 201, index = 2 } }))
LATER.update(1)
check("when the builder the plan named has died, the order goes to the one nearly there", same(sentTags(), { "201:6" }), show(sentTags()))

engine({
	[200] = { def = 10, queue = { build(), build(), level(6) } },
	[201] = { def = 10, queue = { build(), level(6) } },
})
LATER.add(entry(6, { { unitID = 200, index = 3 }, { unitID = 201, index = 2 } }))
LATER.update(1)
LATER.update(2)
check("Together sends the order once, for whichever builder is first near it", same(sentTags(), { "201:6" }), show(sentTags()))

--------------------------------------------------------------------------------
-- orders that never reach a queue, and queues that are cancelled
--------------------------------------------------------------------------------

engine({ [200] = { def = 10, queue = {} } })
LATER.add(entry(11, { { unitID = 200, index = 3 } }))
LATER.update(LATER.SWEEP_EVERY)
check("an order is kept while the plan's orders have not arrived yet", LATER.count() == 1)
E.units[200].queue = { build(), build(), level(11) }
LATER.update(LATER.SWEEP_EVERY * 2)
check("still held once they arrive with two buildings ahead", LATER.count() == 1 and #E.single == 0)
E.units[200].queue = {}
LATER.update(LATER.SWEEP_EVERY * 2 + 1)
check("a cancelled queue is only noticed on a sweep frame", LATER.count() == 1)
LATER.update(LATER.SWEEP_EVERY * 3)
check("then the order is dropped, not sent", LATER.count() == 0 and #E.single == 0)
E.units[200].queue = { level(11) }
LATER.update(LATER.SWEEP_EVERY * 3 + 1)
check("and nothing is sent later", #E.single == 0)

engine({ [200] = { def = 10, queue = {} } })
LATER.add(entry(12, { { unitID = 200, index = 3 } }))
E.units[200] = nil
LATER.update(LATER.SWEEP_EVERY)
check("an order whose builders have all died is dropped", LATER.count() == 0 and #E.single == 0)

engine({
	[200] = { def = 10, queue = { build(), build(), level(13) } },
	[201] = { def = 10, queue = {} },
})
LATER.add(entry(13, { { unitID = 200, index = 3 }, { unitID = 201, index = 3 } }))
LATER.update(LATER.SWEEP_EVERY)
E.units[200] = nil
LATER.update(LATER.SWEEP_EVERY * 2)
check("once seen, an order is dropped when no living builder still has the step", LATER.count() == 0 and #E.single == 0)

--------------------------------------------------------------------------------
-- when the widget stops
--------------------------------------------------------------------------------

engine({
	[200] = { def = 10, queue = { build(), build(), level(14) } },
	[201] = { def = 10, queue = { build() } },
})
LATER.add(entry(14, { { unitID = 200, index = 3 } }))
LATER.add(entry(15, { { unitID = 201, index = 3 } }))
LATER.flush()
check("flush sends the orders whose step is still queued, and forgets the rest", same(sentTags(), { "200:14" }) and LATER.count() == 0, show(sentTags()))

--------------------------------------------------------------------------------
-- placing a blueprint
--------------------------------------------------------------------------------

local function bld(x, seq)
	return { defID = 1, def = TURRET, x = x, y = 100, z = 600, facing = 0, blocked = false, seq = seq }
end
local function wall(after)
	return { kind = "raise", shape = "wall", points = { { x = 400, z = 600 }, { x = 448, z = 600 } }, height = 112, base = 100, after = after }
end
local foot = { bld(448, 1), bld(512, 2), bld(576, 3) }

engine({ [200] = { def = 10, x = 0, z = 0, cmdDescs = { LEVEL_DESC }, queue = {} } })
local can = PLACE.capabilities({ 200 })
local plan = PLACE.plan(foot, can, false, nil, { steps = { wall(1), wall(3) }, on = true })
check("a plan records where each builder's level step is in its orders", plan.terraform[1].levelAt[1].unitID == 200 and plan.terraform[1].levelAt[1].index == 2 and plan.terraform[2].levelAt[1].index == 5, show(plan.terraform[1].levelAt))
check("and the tag", plan.terraform[1].tag == plan.terraform[1].params[5])
PLACE.issue(plan, LATER)
check("issue sends the order for a step after one building at once, and holds the one after three", #E.single == 1 and E.single[1].params[5] == plan.terraform[1].tag and LATER.count() == 1, show(E.single))
check("the held order is not sent before the builder's orders", #E.orders == 1)

engine({ [200] = { def = 10, x = 0, z = 0, cmdDescs = { LEVEL_DESC }, queue = { build(), build() } } })
local shifted = PLACE.plan(foot, PLACE.capabilities({ 200 }), true, nil, { steps = { wall(0) }, on = true })
PLACE.issue(shifted, LATER)
check("with shift behind two queued buildings even a first step is held", #E.single == 0 and LATER.count() == 1)

support.report()
