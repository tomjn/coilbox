-- Run: luajit lua/blueprint-widget/tests/terrain_orders_test.lua
--
-- Placing a blueprint's terrain changes (issue #4796): which selected builders
-- can terraform, the Zero-K terraform order for each step, and the order the
-- steps and the buildings are given in.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local PLACE = support.module("place.lua")
local LATER = support.module("pending_terraform.lua")

local TURRET = support.def(1, "turret", { isBuilding = true, xsize = 4, zsize = 4 })
local SOLAR = support.def(2, "solar", { isBuilding = true, xsize = 4, zsize = 4 })
local CON = support.def(10, "con", { buildOptions = { 1, 2 } })
local PLAIN = support.def(11, "plain", { buildOptions = { 1, 2 } })

local LEVEL = { id = 39736, action = "levelground", name = "Level" }
local OTHER_GAME_LEVEL = { id = 39736, action = "somethingelse", name = "Level" }

local function engine(units, extra)
	local opts = { units = units, selected = {}, ground = extra and extra.ground or function()
		return 100
	end, mapSizeX = 4096, mapSizeZ = 4096, team = 3 }
	opts.WG = extra and extra.WG
	local E = support.engine({ TURRET, SOLAR, CON, PLAIN }, opts)
	PLACE.use(E)
	LATER.use(E)
	return E
end

local function units()
	return {
		[200] = { def = 10, x = 0, z = 0, cmdDescs = { { id = 40 }, LEVEL } },
		[201] = { def = 10, x = 2000, z = 0, cmdDescs = { LEVEL } },
		[202] = { def = 11, x = 100, z = 0, cmdDescs = { { id = 40 } } },
		[203] = { def = 11, x = 100, z = 0, cmdDescs = { OTHER_GAME_LEVEL } },
		[204] = { def = 11, x = 100, z = 0 },
	}
end
local E = engine(units())

--------------------------------------------------------------------------------
-- which builders can terraform
--------------------------------------------------------------------------------

check("a unit with the level command can terraform", PLACE.canTerraform(200) == true)
check("a unit without it cannot", PLACE.canTerraform(202) == false and PLACE.canTerraform(204) == false)
check("the command's action name has to be levelground, not just its number", PLACE.canTerraform(203) == false)

local can = PLACE.capabilities({ 200, 201, 202, 203 })
check("capabilities lists the builders that can terraform, in selection order", same(can.terraformers, { 200, 201 }), show(can.terraformers))
check("capabilities counts a builder that cannot terraform as a builder", #can.builders == 4)
check("capabilities with no terraformer lists none", #PLACE.capabilities({ 202 }).terraformers == 0)

--------------------------------------------------------------------------------
-- tags
--------------------------------------------------------------------------------

local own1, own2 = PLACE.nextTag(), PLACE.nextTag()
check("without Zero-K's counter, tags come from the widget's own, well above Zero-K's", own1 >= PLACE.TAG_BASE and own2 == own1 + 1, own1 .. " " .. own2)
local counter = 7
engine({}, { WG = { Terraform_GetNextTag = function()
	counter = counter + 1
	return counter
end } })
check("with Zero-K's counter, tags come from it", PLACE.nextTag() == 8 and PLACE.nextTag() == 9)
engine({}, { WG = { Terraform_GetNextTag = "not a function" } })
check("a counter that is not a function is not used", PLACE.nextTag() >= PLACE.TAG_BASE)

E = engine(units())

--------------------------------------------------------------------------------
-- laying steps on the ground
--------------------------------------------------------------------------------

local layout = PLACE.resolve({
	buildings = {
		{ def = "turret", offset = { x = 0, z = 0 }, facing = 0 },
		{ def = "nothere", offset = { x = 64, z = 0 }, facing = 0 },
		{ def = "solar", offset = { x = 128, z = 0 }, facing = 0 },
	},
	terrain = {
		{ kind = "raise", shape = "wall", points = { { x = -32, z = 0 }, { x = 32, z = 0 } }, height = 40, before = 0 },
		{ kind = "level", shape = "wall", points = { { x = 0, z = 16 }, { x = 64, z = 16 } }, height = 8, before = 2 },
		{ kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 32, z = 0 }, { x = 32, z = 32 } }, before = 3 },
	},
})
check("resolve remembers where each building was in the entry, past one that is missing", layout.buildings[1].index == 1 and layout.buildings[2].index == 3, show(layout.buildings))

local foot = PLACE.footprint(layout, 0, 512, 512)
check("a footprint entry keeps that place too", foot[1].index == 1 and foot[2].index == 3)

local laid = PLACE.laySteps(layout, 0, nil, nil, { { x = 512, z = 512 } }, foot)
check("every step is laid", #laid == 3)
check("every step comes ahead of every building, whatever its before says (#4817)", laid[1].after == 0 and laid[2].after == 0 and laid[3].after == 0, show({ laid[1].after, laid[2].after, laid[3].after }))
check("a step's points are on the map", same(laid[1].points, { { x = 480, z = 512 }, { x = 544, z = 512 } }), show(laid[1].points))
check("a step takes the ground height under the pivot as its base", laid[1].base == 100 and laid[2].base == 100)

local tall = engine({}, { ground = function(x, z)
	return x == 512 and z == 512 and 77 or 5
end })
local laidTall = PLACE.laySteps(layout, 0, nil, nil, { { x = 512, z = 512 } }, PLACE.footprint(layout, 0, 512, 512))
check("the base is the ground at the anchor, not elsewhere", laidTall[1].base == 77, tostring(laidTall[1].base))
E = engine(units())

local pivot = PLACE.laySteps(layout, 1, nil, { x = 0, z = 0 }, { { x = 512, z = 512 } }, PLACE.footprint(layout, 1, 512, 512))
local tx, tz = PLACE.turned(-32, 0, 1)
check("a turn moves the points as it moves a building", pivot[1].points[1].x == 512 + tx and pivot[1].points[1].z == 512 + tz, show(pivot[1].points))

local two = PLACE.laySteps(layout, 0, nil, nil, { { x = 512, z = 512 }, { x = 1024, z = 512 } }, (function()
	local both = PLACE.footprint(layout, 0, 512, 512)
	for _, p in ipairs(PLACE.footprint(layout, 0, 1024, 512)) do
		both[#both + 1] = p
	end
	return both
end)())
check("each copy of a line lays its own steps ahead of its own buildings, after the copy before", #two == 6 and two[1].after == 0 and two[4].after == 2 and two[5].after == 2 and two[6].after == 2, show({ two[1].after, two[4].after, two[5].after, two[6].after }))
check("each copy's steps are at that copy", two[4].points[1].x == 992)

local edge = PLACE.laySteps(layout, 0, nil, nil, { { x = 16, z = 512 } }, PLACE.footprint(layout, 0, 16, 512))
check("a step with a point off the map is marked", edge[1].blocked == true and edge[2].blocked == false, show({ edge[1].blocked, edge[2].blocked }))
local far = PLACE.laySteps(layout, 0, nil, nil, { { x = 4090, z = 512 } }, PLACE.footprint(layout, 0, 4090, 512))
check("the far edge counts too", far[1].blocked == true)

local onlySteps = PLACE.resolve({ buildings = {}, terrain = layout.terrain })
local bare = PLACE.laySteps(onlySteps, 0, nil, nil, { { x = 512, z = 512 } }, {})
check("a layout of steps alone lays out, each after nothing", #bare == 3 and bare[1].after == 0 and bare[3].after == 0)

check("a layout with no pivot is held by its origin, snapped to the heightmap grid", (function()
	local x, z = PLACE.pivotAt(onlySteps, nil, 0, nil, 517, 523)
	return x == 520 and z == 520
end)())
check("an empty layout of steps has no pivot", PLACE.pivot(onlySteps) == nil)
local minX, maxX, minZ, maxZ = PLACE.extent(onlySteps, 0)
check("extent reaches the steps' points when there are no buildings", minX == -32 and maxX == 64 and minZ == 0 and maxZ == 32, minX .. " " .. maxX .. " " .. minZ .. " " .. maxZ)

-- what holds a layout of steps alone: the middle of its steps
local hold = PLACE.holdPoint(onlySteps, nil)
check("a layout of steps alone is held by the middle of its steps, on the heightmap grid", hold and hold.x == 16 and hold.z == 16, show(hold))
check("a layout with buildings is held by its pivot building", PLACE.holdPoint(layout, 1) == layout.buildings[1].offset)
check("a layout with nothing to hold has no hold point", PLACE.holdPoint(PLACE.resolve({ buildings = {} }), nil) == nil)
local heldBare = PLACE.laySteps(onlySteps, 0, nil, hold, { { x = 520, z = 520 } }, {})
check("the middle of the steps lands on the anchor", heldBare[1].points[1].x == 520 - 48 and heldBare[1].points[1].z == 520 - 16, show(heldBare[1].points))
local heldTurned = PLACE.laySteps(onlySteps, 1, nil, hold, { { x = 520, z = 520 } }, {})
local hx, hz = PLACE.turned(-32 - 16, 0 - 16, 1)
check("a turn is about the middle of the steps", heldTurned[1].points[1].x == 520 + hx and heldTurned[1].points[1].z == 520 + hz, show(heldTurned[1].points))

--------------------------------------------------------------------------------
-- labels
--------------------------------------------------------------------------------

local function labelled(step)
	return PLACE.labels({ step })[1]
end
local raised = labelled({ kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, height = 112, base = 100 })
check("a raise says how far, with its sign", raised.text == "+112", show(raised))
check("a dig says so", labelled({ kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, height = -40, base = 100 }).text == "-40")
check("a level says what it is from the ground under the pivot", labelled({ kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 } }, height = 24, base = 100 }).text == "level +24")
check("a level at the pivot's own height has no sign", labelled({ kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 } }, height = 0, base = 100 }).text == "level 0")
check("a ramp says both ends", labelled({ kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, heights = { 0, 80 }, width = 32, base = 100 }).text == "ramp 0 to +80")
check("a smooth step is just called smooth", labelled({ kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 } }, base = 100 }).text == "smooth")
check("a fraction is rounded", labelled({ kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, height = 12.6, base = 100 }).text == "+13")
check("a label is above the middle of its step, over the finished height", raised.x == 32 and raised.z == 0 and raised.y == 100 + 112 + PLACE.LABEL_LIFT, show(raised))
check("a label over a level is at the level's height", labelled({ kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 } }, height = 24, base = 100 }).y == 124 + PLACE.LABEL_LIFT)
check("one label for each step", #PLACE.labels({ { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 8, z = 0 } }, height = 1, base = 0 }, { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 8, z = 0 } }, height = 2, base = 0 } }) == 2 and #PLACE.labels(nil) == 0)

--------------------------------------------------------------------------------
-- the terraform order
--------------------------------------------------------------------------------

local function laidStep(step)
	local s = { kind = step.kind, shape = step.shape, points = step.points, height = step.height, heights = step.heights, width = step.width, only = step.only, base = step.base or 100, after = step.after or 0 }
	return s
end

local wall = laidStep({ kind = "raise", shape = "wall", points = { { x = 400, z = 600 }, { x = 448, z = 600 }, { x = 496, z = 600 } }, height = 112 })
local params = PLACE.terraformParams(wall, { 200, 201 }, 55, 3)
check(
	"a raised wall is the order Zero-K's lasso gives: type, team, centre, tag, loop, height, counts, volume, points, builders",
	same(params, { 2, 3, 448, 600, 55, 0, 112, 3, 2, 0, 400, 600, 448, 600, 496, 600, 200, 201 }),
	show(params)
)
local level = laidStep({ kind = "level", shape = "wall", points = { { x = 400, z = 600 }, { x = 448, z = 600 } }, height = -12, base = 130 })
check("a level step is its height added to the ground under the pivot", PLACE.terraformParams(level, { 200 }, 1, 3)[7] == 118 and PLACE.terraformParams(level, { 200 }, 1, 3)[1] == 1)
check("a raise adds to the ground under each point, so its height is not changed", PLACE.terraformParams(wall, { 200 }, 1, 3)[7] == 112)
local area = laidStep({ kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 96, z = 0 }, { x = 96, z = 96 }, { x = 0, z = 96 } }, height = 0, base = 50 })
local areaParams = PLACE.terraformParams(area, { 200 }, 1, 3)
check("an area is a loop and its centre is the average of its points", areaParams[6] == 1 and areaParams[3] == 48 and areaParams[4] == 48 and areaParams[8] == 4 and areaParams[7] == 50, show(areaParams))
local smooth = laidStep({ kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 96, z = 0 }, { x = 96, z = 96 } } })
check("a smooth step is type 3 and carries no height", PLACE.terraformParams(smooth, { 200 }, 1, 3)[1] == 3 and PLACE.terraformParams(smooth, { 200 }, 1, 3)[7] == 0)
local ramp = laidStep({ kind = "ramp", shape = "wall", points = { { x = 100, z = 200 }, { x = 100, z = 300 } }, heights = { 0, 24 }, width = 64, base = 100 })
check(
	"a ramp has half its width, which the gadget doubles, then each end as x, absolute y, z",
	same(PLACE.terraformParams(ramp, { 200 }, 9, 3), { 4, 3, 100, 250, 9, 0, 32, 2, 1, 0, 100, 100, 200, 100, 124, 300, 200 }),
	show(PLACE.terraformParams(ramp, { 200 }, 9, 3))
)

-- the volume selection, the order's tenth parameter (issue #4804)
local function volumeOf(step)
	return PLACE.terraformParams(laidStep(step), { 200 }, 1, 3)[10]
end
local padPoints = { { x = 0, z = 0 }, { x = 96, z = 0 }, { x = 96, z = 96 } }
check("a level or ramp with no choice changes ground both ways, volume 0", volumeOf({ kind = "level", shape = "area", points = padPoints, height = 5 }) == 0 and volumeOf(ramp) == 0)
check("only raise is volume 1 and only lower is 2, on a level", volumeOf({ kind = "level", shape = "area", points = padPoints, height = 5, only = "raise" }) == 1 and volumeOf({ kind = "level", shape = "area", points = padPoints, height = 5, only = "lower" }) == 2)
check("and on a ramp", volumeOf({ kind = "ramp", shape = "wall", points = ramp.points, heights = ramp.heights, width = 64, only = "raise" }) == 1 and volumeOf({ kind = "ramp", shape = "wall", points = ramp.points, heights = ramp.heights, width = 64, only = "lower" }) == 2)
check("a raise or smooth step ignores a choice it should not carry", volumeOf({ kind = "raise", shape = "wall", points = wall.points, height = 8, only = "raise" }) == 0 and volumeOf({ kind = "smooth", shape = "area", points = padPoints, only = "lower" }) == 0)
check("the rest of the order is the same with a choice", same(PLACE.terraformParams(laidStep({ kind = "level", shape = "wall", points = level.points, height = -12, base = 130, only = "raise" }), { 200 }, 1, 3), (function()
	local plain = PLACE.terraformParams(level, { 200 }, 1, 3)
	plain[10] = 1
	return plain
end)()))
local carried = PLACE.laySteps(PLACE.resolve({
	buildings = {},
	terrain = {
		{ kind = "level", shape = "area", points = padPoints, height = 5, before = 0, only = "raise" },
		{ kind = "level", shape = "area", points = padPoints, height = 5, before = 0 },
	},
}), 0, nil, nil, { { x = 512, z = 512 } }, {})
check("a laid step keeps its choice", carried[1].only == "raise" and carried[2].only == nil, show(carried))

--------------------------------------------------------------------------------
-- plans with steps
--------------------------------------------------------------------------------

local function bld(defID, x, seq)
	return { defID = defID, def = E.UnitDefs[defID], x = x, y = 100, z = 600, facing = 0, blocked = false, seq = seq }
end
local foot2 = { bld(1, 448, 1), bld(2, 480, 2) }
local function step(after, extra)
	local s = laidStep({ kind = "raise", shape = "wall", points = { { x = 400, z = 600 }, { x = 448, z = 600 } }, height = 112 })
	s.after = after
	for k, v in pairs(extra or {}) do
		s[k] = v
	end
	return s
end

local canAll = PLACE.capabilities({ 200 })
local p = PLACE.plan(foot2, canAll, false, nil, { steps = { step(0) }, on = true })
local cmds = p.orders[1].cmds
check("a step ahead of the buildings leads the queue: a level step with no options, then the buildings with shift", #cmds == 3 and cmds[1][1] == 39736 and same(cmds[1][3], {}) and cmds[2][1] == -1 and same(cmds[2][3], { "shift" }) and same(cmds[3][3], { "shift" }), show(cmds))
check("the level step carries the centre, the ground there and the tag", cmds[1][2][1] == 424 and cmds[1][2][2] == 100 and cmds[1][2][3] == 600 and cmds[1][2][4] == p.terraform[1].params[5], show(cmds[1]))
check("the terraform order itself is not queued: it is kept to send at once", #p.terraform == 1 and p.terraform[1].unitID == 200 and p.terraform[1].params[1] == 2, show(p.terraform))

local shifted = PLACE.plan(foot2, canAll, true, nil, { steps = { step(0) }, on = true })
check("with shift the level step appends too", same(shifted.orders[1].cmds[1][3], { "shift" }) and same(shifted.orders[1].cmds[2][3], { "shift" }))

local mid = PLACE.plan(foot2, canAll, false, nil, { steps = { step(1) }, on = true }).orders[1].cmds
check("a step after the first building sits between the buildings", mid[1][1] == -1 and mid[2][1] == 39736 and mid[3][1] == -2 and same(mid[1][3], {}) and same(mid[2][3], { "shift" }), show(mid))
local last = PLACE.plan(foot2, canAll, false, nil, { steps = { step(2) }, on = true }).orders[1].cmds
check("a step after every building comes last", last[3][1] == 39736)
local stacked = PLACE.plan(foot2, canAll, false, nil, { steps = { step(1, { height = 1 }), step(1, { height = 2 }) }, on = true })
check("steps with the same place keep their order", stacked.terraform[1].params[7] == 1 and stacked.terraform[2].params[7] == 2 and stacked.orders[1].cmds[2][2][4] == stacked.terraform[1].params[5] and stacked.orders[1].cmds[3][2][4] == stacked.terraform[2].params[5])
check("each step has a tag of its own", stacked.terraform[1].params[5] ~= stacked.terraform[2].params[5])

local noOrder = PLACE.plan(foot2, canAll, false, nil, nil)
check("with no steps given a plan is what it was", #noOrder.orders[1].cmds == 2 and #noOrder.terraform == 0 and noOrder.skipped == 0 and noOrder.offMap == 0 and #noOrder.stepRemainder == 0)

-- the buildings left when a building is blocked or not buildable do not shift the steps
local blockedFoot = { bld(1, 448, 1), bld(2, 480, 2), bld(1, 512, 3) }
blockedFoot[1].blocked = true
local skipFirst = PLACE.plan(blockedFoot, canAll, false, nil, { steps = { step(1) }, on = true }).orders[1].cmds
check("a blocked building is dropped and the step keeps its place among the rest", skipFirst[1][1] == 39736 and skipFirst[2][1] == -2 and same(skipFirst[1][3], {}), show(skipFirst))

-- who gets a step
local together = PLACE.plan(foot2, PLACE.capabilities({ 200, 201, 202 }), false, nil, { steps = { step(1) }, on = true })
local byUnit = {}
for _, o in ipairs(together.orders) do
	byUnit[o.unitID] = o.cmds
end
check("Together gives the step to every builder that can terraform", byUnit[200][2][1] == 39736 and byUnit[201][2][1] == 39736, show(together.orders))
check("a builder that cannot terraform is given the buildings only", byUnit[202] and #byUnit[202] == 2 and byUnit[202][1][1] == -1 and byUnit[202][2][1] == -2, show(byUnit[202]))
check("Together makes one terraform order, naming every builder that will work on it", #together.terraform == 1 and same({ together.terraform[1].params[15], together.terraform[1].params[16] }, { 200, 201 }) and together.terraform[1].params[9] == 2, show(together.terraform[1].params))
check("every builder is given the same tag", byUnit[200][2][2][4] == byUnit[201][2][2][4] and byUnit[200][2][2][4] == together.terraform[1].params[5])

local splitCan = PLACE.capabilities({ 200, 201 })
local nearFar = step(0)
nearFar.points = { { x = 1900, z = 600 }, { x = 2000, z = 600 } }
local split = PLACE.plan(foot2, splitCan, false, "split", { steps = { step(0), nearFar }, on = true })
local splitBy = {}
for _, o in ipairs(split.orders) do
	splitBy[o.unitID] = o.cmds
end
local function ids(list)
	local out = {}
	for i, c in ipairs(list or {}) do
		out[i] = c[1]
	end
	return out
end
check("Split up gives every builder every step's level step, ahead of its first building (#4817)", (function()
	for _, unitID in ipairs({ 200, 201 }) do
		local cmds = splitBy[unitID] or {}
		if #cmds < 2 or cmds[1][1] ~= 39736 or cmds[2][1] ~= 39736 or cmds[1][2][4] == cmds[2][2][4] then
			return false
		end
	end
	return #split.terraform == 2
end)(), show(split.orders))
check("Split up still shares the buildings out, one builder each", (function()
	local count = 0
	for _, unitID in ipairs({ 200, 201 }) do
		for _, c in ipairs(splitBy[unitID] or {}) do
			if c[1] < 0 then
				count = count + 1
			end
		end
	end
	return count == 2
end)(), show(split.orders))
check("each split step's level step is recorded for every builder, as Together does", #split.terraform[1].levelAt == 2 and #split.terraform[2].levelAt == 2, show(split.terraform[2].levelAt))
check("Together records the level step for every builder", #together.terraform[1].levelAt == 2)
check("each split step's terraform order names every builder", split.terraform[1].params[9] == 2 and split.terraform[2].params[9] == 2, show(split.terraform))

-- every step ahead of every building, in both modes
for _, mode in ipairs({ "help", "split" }) do
	local both = PLACE.plan(foot2, PLACE.capabilities({ 200, 201 }), false, mode, { steps = { step(0), nearFar }, on = true })
	local ok = #both.orders == 2
	for _, order in ipairs(both.orders) do
		local levels, firstBuilding = 0, nil
		for i, c in ipairs(order.cmds) do
			if c[1] == 39736 then
				levels = levels + 1
			elseif not firstBuilding then
				firstBuilding = i
			end
		end
		ok = ok and levels == 2 and (firstBuilding == nil or firstBuilding == 3)
	end
	check("in " .. mode .. " every builder has every step's level step before its first building", ok, show(both.orders))
end

-- steps that are not ordered
local off = PLACE.plan(foot2, canAll, false, nil, { steps = { step(0, { blocked = true }), step(1) }, on = true })
check("a step off the map is counted and not ordered", off.offMap == 1 and #off.terraform == 1 and off.skipped == 0)
check("the steps that are on the map still go in order", off.orders[1].cmds[1][1] == -1 and off.orders[1].cmds[2][1] == 39736)

local switchedOff = PLACE.plan(foot2, canAll, false, nil, { steps = { step(0), step(1) }, on = false, why = "Terrain is off" })
check("with terrain off the buildings are ordered and the steps are counted as skipped", switchedOff.skipped == 2 and #switchedOff.terraform == 0 and #switchedOff.orders[1].cmds == 2 and switchedOff.skippedWhy == "Terrain is off", show(switchedOff))
check("skipped steps are not kept for later", #switchedOff.stepRemainder == 0)

local noTerraformer = PLACE.plan(foot2, PLACE.capabilities({ 202 }), false, nil, { steps = { step(0) }, on = true })
check("a builder that cannot terraform leaves the steps unordered and the buildings ordered", #noTerraformer.orders[1].cmds == 2 and #noTerraformer.terraform == 0, show(noTerraformer))
check("with builders selected and none able to terraform the steps are skipped, not kept", noTerraformer.skipped == 1 and #noTerraformer.stepRemainder == 0)

local nobody = PLACE.plan(foot2, PLACE.capabilities({}), false, nil, { steps = { step(0), step(1) }, on = true })
check("with no builders selected, nothing is ordered and the steps are kept with the buildings", #nobody.orders == 0 and #nobody.stepRemainder == 2 and #nobody.remainder == 2 and nobody.skipped == 0 and #nobody.terraform == 0, show(nobody))

-- building that plan later, with a builder, gives the order it had
local later = PLACE.plan(nobody.remainder, canAll, false, nil, { steps = nobody.stepRemainder, on = true }).orders[1].cmds
check("building a kept plan sends the steps in their places among the buildings", ids(later)[1] == 39736 and later[2][1] == -1 and later[3][1] == 39736 and later[4][1] == -2, show(ids(later)))

local partialLater = PLACE.plan({ nobody.remainder[2] }, canAll, false, nil, { steps = nobody.stepRemainder, on = true }).orders[1].cmds
check("building one building of a kept plan keeps the steps ahead of it in front", partialLater[1][1] == 39736 and partialLater[2][1] == 39736 and partialLater[3][1] == -2, show(ids(partialLater)))

-- a blueprint of steps alone
local only = PLACE.plan({}, canAll, false, nil, { steps = { step(0) }, on = true })
check("steps with no buildings are ordered: a level step with no options", #only.orders == 1 and #only.orders[1].cmds == 1 and only.orders[1].cmds[1][1] == 39736 and same(only.orders[1].cmds[1][3], {}), show(only))
local onlyShift = PLACE.plan({}, canAll, true, nil, { steps = { step(0) }, on = true })
check("and with shift it appends", same(onlyShift.orders[1].cmds[1][3], { "shift" }))
local onlyTwo = PLACE.plan({}, PLACE.capabilities({ 200, 201 }), false, "split", { steps = { step(0), nearFar }, on = true })
check("split steps with no buildings go to the nearest builder each", #onlyTwo.orders == 2)

--------------------------------------------------------------------------------
-- issuing
--------------------------------------------------------------------------------

E.orders, E.single = {}, {}
local sent = PLACE.issue(p, LATER)
check("issue sends the terraform order to the builder first", #E.single == 1 and E.single[1].cmdID == 39801 and E.single[1].unitID == 200 and E.single[1].options == 0, show(E.single))
check("then the queue", #E.orders == 1 and sent == 1 and E.orders[1].cmds[1][1] == 39736)

E.orders, E.single = {}, {}
PLACE.issue(PLACE.plan({}, canAll, false, nil, { steps = { step(0) }, on = true }), LATER)
check("a plan of steps alone issues its terraform order and its level step", #E.single == 1 and #E.orders == 1)

support.report()
