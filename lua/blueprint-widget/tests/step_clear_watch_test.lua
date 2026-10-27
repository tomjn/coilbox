-- Run: luajit lua/blueprint-widget/tests/step_clear_watch_test.lua
--
-- Keeping a builder clear of a step while it works on it (issue #4816): when
-- Zero-K has it repair a terraform unit out of its range, a move to a clear
-- spot within range of that unit goes in front, instead of the builder walking
-- onto the step.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, show = support.check, support.show
local CLEAR = support.module("step_clear.lua")

local CON = support.def(10, "con", { buildDistance = 128 })
local TERRAUNIT = support.def(20, "terraunit")
local OTHER = support.def(21, "solar", { isBuilding = true })

local TAG = 1000001
local function level(tag)
	return { 39736, { 0, 0, 0, tag or TAG } }
end

local function engine(units, stand)
	local E = support.engine({ CON, TERRAUNIT, OTHER }, { units = units })
	E.Spring.TestMoveOrder = stand
	CLEAR.use(E)
	CLEAR.reset()
	return E
end

-- clear spots along x = -200 at every 16 elmos, and some further out
local SPOTS = {}
for z = -256, 256, 16 do
	SPOTS[#SPOTS + 1] = { x = -200, z = z, reach = 0 }
	SPOTS[#SPOTS + 1] = { x = -400, z = z, reach = 0 }
end
local function w()
	return { spots = SPOTS, range = 128, stop = 16, apart = 16, defID = 10 }
end

-- a builder at -200, 0, told to repair a terraform unit at 0, 200: 283 away
local E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level() } },
	[50] = { def = 20, x = -100, z = 200 },
})
CLEAR.watch(1, TAG, w())
CLEAR.update(1)
local sent = E.single[1]
check("a builder about to walk to a terraform unit out of range is sent to a spot first", sent and sent.cmdID == 1 and sent.params[1] == 0 and sent.params[2] == 10 and sent.options == 128, show(E.single))
check("the spot is within range of the terraform unit, less how far short a move stops", sent and math.sqrt((sent.params[4] + 100) ^ 2 + (sent.params[6] - 200) ^ 2) <= 128 - 16, show(sent and sent.params))
-- the nearest spot at x = -200 within 112 of (-100, 200) is z = 160
check("of those, the one nearest the builder", sent and sent.params[4] == -200 and sent.params[6] == 160, show(sent and sent.params))

CLEAR.update(2)
check("the move goes in once for a terraform unit, not every frame", #E.single == 1)

-- in range
E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level() } },
	[50] = { def = 20, x = -100, z = 0 },
})
CLEAR.watch(1, TAG, w())
CLEAR.update(1)
check("a builder in range of the terraform unit is left alone", #E.single == 0)

-- not a terraform unit, or not this step
E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = { { 40, { 51 } }, level() } },
	[2] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level(TAG + 1) } },
	[50] = { def = 20, x = 300, z = 0 },
	[51] = { def = 21, x = 300, z = 0 },
})
CLEAR.watch(1, TAG, w())
CLEAR.watch(2, TAG, w())
CLEAR.update(1)
check("a repair of anything but a terraform unit, or for another step's level command, is left alone", #E.single == 0, show(E.single))

-- nowhere to stand
E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level() } },
	[50] = { def = 20, x = -100, z = 200 },
}, function()
	return false
end)
CLEAR.watch(1, TAG, w())
CLEAR.update(1)
check("with nowhere to stand the builder walks as it would have", #E.single == 0)

-- two builders do not share a spot
E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level() } },
	[2] = { def = 10, x = -200, z = 0, queue = { { 40, { 50 } }, level() } },
	[50] = { def = 20, x = -100, z = 200 },
})
CLEAR.watch(1, TAG, w())
CLEAR.watch(2, TAG, w())
CLEAR.update(1)
check("two builders going for one terraform unit get spots apart", #E.single == 2 and (E.single[1].params[4] ~= E.single[2].params[4] or math.abs(E.single[1].params[6] - E.single[2].params[6]) >= 16), show(E.single))

-- when the step is done
E = engine({
	[1] = { def = 10, x = -200, z = 0, queue = {} },
})
CLEAR.watch(1, TAG, w())
CLEAR.update(30)
check("a step whose level command has not reached the queue yet is kept", CLEAR.count() == 1)
E.units[1].queue = { level() }
CLEAR.update(60)
E.units[1].queue = {}
CLEAR.update(90)
check("once the level command has come and gone the builder is no longer watched", CLEAR.count() == 0)
CLEAR.watch(1, TAG, w())
E.units[1] = nil
CLEAR.update(120)
check("a builder that is gone is no longer watched", CLEAR.count() == 0)

support.report()
