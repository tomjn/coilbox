-- Run: luajit lua/blueprint-widget/tests/step_clear_test.lua
--
-- Sending each builder clear of a step's ground before it works on it (issue
-- #4816): the spot is outside the step and its slopes, within build range of
-- the step, on the builder's side, on ground it can stand on, and outside a
-- closed ring of wall, with what is inside the ring built first.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, show = support.check, support.show
local PLACE = support.module("place.lua")
local TERRAFORM = support.module("terraform.lua")

local LEVEL = { id = 39736, action = "levelground", name = "Level" }
local TURRET = support.def(1, "turret", { isBuilding = true, xsize = 4, zsize = 4 })
local SOLAR = support.def(2, "solar", { isBuilding = true, xsize = 10, zsize = 10 })
-- a Conjurer: 128 elmos of build range and a footprint 2 half squares wide
local CON = support.def(10, "con", { buildOptions = { 1, 2 }, buildDistance = 128, xsize = 2, zsize = 2 })

local RANGE = 128
local CLEARANCE = 2 * 4 + PLACE.MOVE_STOP

local function engine(units, stand)
	local E = support.engine({ TURRET, SOLAR, CON }, { units = units, mapSizeX = 4096, mapSizeZ = 4096 })
	E.Spring.TestMoveOrder = stand
	PLACE.use(E)
	return E
end
engine({})

--- The model's results for some laid steps on flat ground.
local function model(steps, foot)
	local session = TERRAFORM.session({ heightAt = function()
		return 100
	end, corners = { x = 513, z = 513 } })
	return session.apply(steps, foot)
end

local function laid(step)
	step.after, step.base = step.after or 0, 100
	return step
end

-- A wall raised by 112 along x at z = 1024, from x = 960 to 1088.
local function wall()
	return laid({ kind = "raise", shape = "wall", points = { { x = 960, z = 1024 }, { x = 1024, z = 1024 }, { x = 1088, z = 1024 } }, height = 112 })
end

--- How close a spot comes to any corner in off, the step's ground.
local function nearestOff(off, x, z)
	local best = math.huge
	for iz, row in pairs(off.corners) do
		for ix in pairs(row) do
			best = math.min(best, math.max(math.abs(ix * 8 - x), math.abs(iz * 8 - z)))
		end
	end
	return best
end

local function nearestShape(shape, x, z)
	local best = math.huge
	for _, c in ipairs(shape) do
		best = math.min(best, math.sqrt((c.x - x) ^ 2 + (c.z - z) ^ 2))
	end
	return best
end

--------------------------------------------------------------------------------
-- the spot for one step
--------------------------------------------------------------------------------

local w = wall()
local results = model({ w })
local off = PLACE.keepOff(results, { w })
local shape = results[1].shape
local spots = PLACE.clearSpots(shape, off, RANGE, CLEARANCE)
check("there are spots round a wall", #spots > 0)

local south = PLACE.clearSpot(spots, shape, 1024, 1200)
check("a spot is found for a builder south of the wall", south ~= nil)
check("the spot is outside the wall and its slope, by the builder's half width and a move's goal radius", nearestOff(off, south.x, south.z) > CLEARANCE, show(south) .. " " .. nearestOff(off, south.x, south.z))
check("the slope reaches past the wall's top, so the spot is further out than the top", math.abs(south.z - 1024) > 16 + 4 * 8, show(south))
check("the spot is within build range of the step", nearestShape(shape, south.x, south.z) <= RANGE, tostring(nearestShape(shape, south.x, south.z)))
check("the spot is on the builder's side: south of the wall", south.z > 1024, show(south))
check("and on the build grid", south.x % PLACE.CLEAR_GRID == 0 and south.z % PLACE.CLEAR_GRID == 0)

local north = PLACE.clearSpot(spots, shape, 1024, 800)
check("a builder north of the wall steps clear to the north", north and north.z < 1024, show(north))

check("a builder is not sent round to the far side when its own side has nowhere to stand", PLACE.clearSpot(spots, shape, 1024, 800, function(_, z)
	return z > 1024
end) == nil)

local onTop = PLACE.clearSpot(spots, shape, 1024, 1024)
check("a builder standing on the wall's line is sent off it", onTop and nearestOff(off, onTop.x, onTop.z) > CLEARANCE, show(onTop))

-- the builder's side of a long wall seen from past one end
local west = PLACE.clearSpot(spots, shape, 600, 1024)
check("a builder past the west end steps clear on the west half", west and west.x < 1024, show(west))

-- a short wall all within reach: every spot within range reaches all of it, so
-- the nearest wins
local nearest = PLACE.clearSpot(spots, shape, 1024, 1400)
check("the spot that reaches the whole step and is nearest the builder wins", nearest and nearest.x == 1024, show(nearest))

-- a spot reaching all of a long wall beats a nearer one that reaches only its end
local long = laid({ kind = "raise", shape = "wall", points = { { x = 800, z = 1024 }, { x = 1248, z = 1024 } }, height = 112 })
local longResults = model({ long })
local longOff = PLACE.keepOff(longResults, { long })
local longSpots = PLACE.clearSpots(longResults[1].shape, longOff, RANGE, CLEARANCE)
local mid = PLACE.clearSpot(longSpots, longResults[1].shape, 820, 1300)
check("on a long wall the builder goes where it reaches the most of it", mid and mid.x > 900 and mid.x < 1150, show(mid))

-- ground the builder cannot stand on
local refused = {}
local picky = PLACE.clearSpot(spots, shape, 1024, 1200, function(x, z)
	if x == south.x and z == south.z then
		refused[#refused + 1] = { x = x, z = z }
		return false
	end
	return true
end)
check("a spot the builder cannot stand on is passed over for the next best", #refused == 1 and picky and (picky.x ~= south.x or picky.z ~= south.z), show(picky))
check("with nowhere to stand there is no spot", PLACE.clearSpot(spots, shape, 1024, 1200, function()
	return false
end) == nil)
check("a step with no ground has no spots", #PLACE.clearSpots({}, off, RANGE, CLEARANCE) == 0)

-- the layout's buildings are kept off too
local turretFoot = { { def = TURRET, x = south.x, z = south.z, facing = 0 } }
local offWithTurret = PLACE.keepOff(results, { w }, turretFoot)
local besideTurret = PLACE.clearSpot(PLACE.clearSpots(shape, offWithTurret, RANGE, CLEARANCE), shape, 1024, 1200)
check("a builder does not step onto where one of the layout's buildings goes", besideTurret and math.max(math.abs(besideTurret.x - south.x), math.abs(besideTurret.z - south.z)) > 16 + CLEARANCE - 8, show(besideTurret))

--------------------------------------------------------------------------------
-- a closed ring of wall
--------------------------------------------------------------------------------

local function ring(x0, z0, x1, z1)
	return laid({ kind = "raise", shape = "wall", points = { { x = x0, z = z0 }, { x = x1, z = z0 }, { x = x1, z = z1 }, { x = x0, z = z1 }, { x = x0, z = z0 } }, height = 112 })
end

local r = ring(1024, 1024, 1344, 1344)
check("a wall whose last point is its first is a closed ring", PLACE.closedRing(r))
check("an open wall is not", not PLACE.closedRing(wall()))
check("an area is not a ring", not PLACE.closedRing({ shape = "area", points = r.points }))
check("a point in the middle is inside the ring", PLACE.inside(r.points, 1184, 1184) and not PLACE.inside(r.points, 900, 1184))

local ringResults = model({ r })
local ringOff = PLACE.keepOff(ringResults, { r })
local ringShape = ringResults[1].shape
local ringSpots = PLACE.clearSpots(ringShape, ringOff, RANGE, CLEARANCE)
local outsideAll = true
for _, s in ipairs(ringSpots) do
	if PLACE.inside(r.points, s.x, s.z) then
		outsideAll = false
	end
end
check("no spot is inside a closed ring, though its middle is clear ground", #ringSpots > 0 and outsideAll)
local fromInside = PLACE.clearSpot(ringSpots, ringShape, 1184, 1184)
check("a builder inside the ring steps out of it", fromInside and not PLACE.inside(r.points, fromInside.x, fromInside.z) and nearestOff(ringOff, fromInside.x, fromInside.z) > CLEARANCE, show(fromInside))
local fromEast = PLACE.clearSpot(ringSpots, ringShape, 1700, 1184)
check("a builder east of the ring stays east of it", fromEast and fromEast.x > 1344, show(fromEast))

--------------------------------------------------------------------------------
-- placing: the move goes ahead of each step's level command
--------------------------------------------------------------------------------

local function units()
	return {
		[200] = { def = 10, x = 1024, z = 1300, cmdDescs = { LEVEL } },
		[201] = { def = 10, x = 1024, z = 700, cmdDescs = { LEVEL } },
	}
end
local E = engine(units(), function()
	return true
end)

local function ids(cmds)
	local out = {}
	for i, c in ipairs(cmds) do
		out[i] = c[1]
	end
	return table.concat(out, ",")
end

local function byUnit(plan)
	local out = {}
	for _, o in ipairs(plan.orders) do
		out[o.unitID] = o.cmds
	end
	return out
end

local turretOnWall = { { defID = 1, def = TURRET, x = 1024, y = 212, z = 1024, facing = 0, blocked = false, seq = 1 } }
local steps = { wall() }
local plan = PLACE.plan(turretOnWall, PLACE.capabilities({ 200 }), false, nil, { steps = steps, on = true, ground = model(steps, turretOnWall) })
local cmds = plan.orders[1].cmds
check("a move to the spot comes before the level command, then the building", ids(cmds) == "10,39736,-1", ids(cmds))
check("the move has no options and replaces the queue, the rest append", #cmds[1][3] == 0 and cmds[2][3][1] == "shift", show(cmds))
check("the move's spot is clear of the wall on the builder's side", cmds[1][2][3] > 1024 and nearestOff(off, cmds[1][2][1], cmds[1][2][3]) > CLEARANCE, show(cmds[1][2]))
check("the level command's place in the queue counts the move", plan.terraform[1].levelAt[1].index == 2, show(plan.terraform[1].levelAt))

local shifted = PLACE.plan(turretOnWall, PLACE.capabilities({ 200 }), true, nil, { steps = steps, on = true, ground = model(steps, turretOnWall) })
check("with shift the move appends too", shifted.orders[1].cmds[1][1] == 10 and shifted.orders[1].cmds[1][3][1] == "shift")

local noModel = PLACE.plan(turretOnWall, PLACE.capabilities({ 200 }), false, nil, { steps = steps, on = true })
check("without the model's ground there is no move", ids(noModel.orders[1].cmds) == "39736,-1")

for _, mode in ipairs({ "help", "split" }) do
	local both = byUnit(PLACE.plan(turretOnWall, PLACE.capabilities({ 200, 201 }), false, mode, { steps = steps, on = true, ground = model(steps, turretOnWall) }))
	check(mode .. ": each builder gets a move ahead of the step, then waits for the other", both[200] and both[201] and ids(both[200]):find("10,5,39736,-1", 1, true) == 1 and ids(both[201]):find("10,5,39736", 1, true) == 1, show(both))
	-- Zero-K pulls the step's terraform units to one builder at a time, so one
	-- on the far side of the wall would be walked on to it (#4834)
	check(mode .. ": both on the side of the first, within a build range of each other", both[200][1][2][3] > 1024 and both[201][1][2][3] > 1024 and math.sqrt((both[200][1][2][1] - both[201][1][2][1]) ^ 2 + (both[200][1][2][3] - both[201][1][2][3]) ^ 2) <= RANGE - PLACE.MOVE_STOP, show({ both[200][1][2], both[201][1][2] }))
end

-- two builders on the same side get spots of their own
engine({
	[200] = { def = 10, x = 1024, z = 1300, cmdDescs = { LEVEL } },
	[201] = { def = 10, x = 1040, z = 1300, cmdDescs = { LEVEL } },
}, function()
	return true
end)
local sameSide = byUnit(PLACE.plan(turretOnWall, PLACE.capabilities({ 200, 201 }), false, nil, { steps = steps, on = true, ground = model(steps, turretOnWall) }))
check("two builders on the same side are sent to spots a footprint apart", (function()
	local a, b = sameSide[200][1][2], sameSide[201][1][2]
	return math.sqrt((a[1] - b[1]) ^ 2 + (a[3] - b[3]) ^ 2) >= 2 * 8 and a[3] > 1024 and b[3] > 1024
end)(), show({ sameSide[200][1][2], sameSide[201][1][2] }))

-- a builder that cannot stand anywhere near is left as it was
engine(units(), function()
	return false
end)
local nowhere = PLACE.plan(turretOnWall, PLACE.capabilities({ 200 }), false, nil, { steps = steps, on = true, ground = model(steps, turretOnWall) })
check("with nowhere to stand the level command goes without a move", ids(nowhere.orders[1].cmds) == "39736,-1")
E = engine(units(), function()
	return true
end)

-- a plan kept for later gets its moves when it is built
local kept = PLACE.plan(turretOnWall, PLACE.capabilities({}), false, nil, { steps = steps, on = true, ground = model(steps, turretOnWall) })
check("a plan with no builders orders nothing and keeps its steps", #kept.orders == 0 and #kept.stepRemainder == 1)
local built = PLACE.plan(kept.remainder, PLACE.capabilities({ 200 }), false, nil, { steps = kept.stepRemainder, on = true, ground = model(kept.stepRemainder, kept.remainder) })
check("building it later sends the builder clear first", ids(built.orders[1].cmds) == "10,39736,-1", ids(built.orders[1].cmds))

-- two steps: the second step's side is taken from where the first left it
local two = { wall(), laid({ kind = "raise", shape = "wall", points = { { x = 960, z = 1600 }, { x = 1088, z = 1600 } }, height = 112 }) }
local twoPlan = PLACE.plan({}, PLACE.capabilities({ 200 }), false, nil, { steps = two, on = true, ground = model(two) })
local twoCmds = twoPlan.orders[1].cmds
check("each step gets its own move", ids(twoCmds) == "10,39736,10,39736", ids(twoCmds))
check("each move is clear of both steps", (function()
	local both = PLACE.keepOff(model(two), two)
	return nearestOff(both, twoCmds[1][2][1], twoCmds[1][2][3]) > CLEARANCE and nearestOff(both, twoCmds[3][2][1], twoCmds[3][2][3]) > CLEARANCE
end)(), show({ twoCmds[1][2], twoCmds[3][2] }))
check("the second step's spot is on the side the first spot left the builder, between the walls", twoCmds[3][2][3] < 1600 and twoCmds[3][2][3] > 1024, show(twoCmds[3][2]))

--------------------------------------------------------------------------------
-- the walled outpost: inside the ring first, then the ring, then the wall's
-- turrets
--------------------------------------------------------------------------------

local outpost = PLACE.resolve({
	buildings = {
		{ def = "turret", offset = { x = 0, z = 0 }, facing = 0 },
		{ def = "turret", offset = { x = 320, z = 0 }, facing = 0 },
		{ def = "turret", offset = { x = 320, z = 320 }, facing = 0 },
		{ def = "turret", offset = { x = 0, z = 320 }, facing = 0 },
		{ def = "solar", offset = { x = 160, z = 160 }, facing = 0 },
	},
	terrain = { { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 320, z = 0 }, { x = 320, z = 320 }, { x = 0, z = 320 }, { x = 0, z = 0 } }, height = 112, before = 0 } },
})
local foot = PLACE.footprint(outpost, 0, 1024, 1024, nil, { x = 0, z = 0 })
for i, p in ipairs(foot) do
	p.seq = i
end
local laidRing = PLACE.laySteps(outpost, 0, nil, { x = 0, z = 0 }, { { x = 1024, z = 1024 } }, foot)
check("the building inside the ring moves to the front", foot[1].def == SOLAR and foot[1].insideRing == true and foot[1].seq == 1, show({ foot[1].def.name, foot[1].seq }))
check("the turrets on the wall keep their order behind it and are not inside", foot[2].def == TURRET and foot[2].x == 1024 and foot[2].z == 1024 and not foot[2].insideRing and foot[5].seq == 5, show(foot[2]))
check("the ring comes after the buildings inside it", laidRing[1].after == 1, tostring(laidRing[1].after))
local again = PLACE.laySteps(outpost, 0, nil, { x = 0, z = 0 }, { { x = 1024, z = 1024 } }, foot)
check("laying it again leaves the order as it is", foot[1].def == SOLAR and foot[2].x == 1024 and again[1].after == 1)

-- the ring is ordered side by side, each side's terraform units pulled out
check("a closed ring is laid as one step for each side", #laidRing == 4 and #laidRing[1].points == 2, show(#laidRing))
check("each side keeps the ring's outline", laidRing[1].ring and #laidRing[1].ring == 5 and laidRing[4].ring == laidRing[1].ring)
local bx, bz = laidRing[1].bias.x, laidRing[1].bias.z
check("the first side's units are pulled a leash's length out from its middle", bx == 1184 and bz == 1024 - PLACE.TERRAUNIT_LEASH, show(laidRing[1].bias) .. " " .. show(laidRing[1].points))
check("every side's pull is outside the ring", (function()
	for _, side in ipairs(laidRing) do
		if PLACE.inside(side.ring, side.bias.x, side.bias.z) then
			return false
		end
	end
	return true
end)())
local sideParams = PLACE.terraformParams(laidRing[1], { 200, 201 }, 9, 3)
check("a side's order names no builders and has its pull as its centre", sideParams[3] == bx and sideParams[4] == bz and sideParams[9] == 0 and #sideParams == 10 + 4, show(sideParams))
check("a ring has one label, over its middle", (function()
	local labels = PLACE.labels(laidRing)
	return #labels == 1 and labels[1].x == 1184 and labels[1].z == 1184
end)(), show(PLACE.labels(laidRing)))
local sidePlan = PLACE.plan(foot, PLACE.capabilities({ 200 }), false, nil, { steps = laidRing, on = true, ground = model(laidRing, foot) })
check("the sides' orders are tied together", #sidePlan.terraform == 4 and sidePlan.terraform[1].group == laidRing[1].ring and sidePlan.terraform[4].group == laidRing[1].ring)

E = engine({
	[200] = { def = 10, x = 1184, z = 1600, cmdDescs = { LEVEL } },
	[201] = { def = 10, x = 1184, z = 700, cmdDescs = { LEVEL } },
}, function()
	return true
end)
for _, mode in ipairs({ "help", "split" }) do
	local o = byUnit(PLACE.plan(foot, PLACE.capabilities({ 200, 201 }), false, mode, { steps = laidRing, on = true, ground = model(laidRing, foot) }))
	for _, unitID in ipairs({ 200, 201 }) do
		local q = o[unitID] or {}
		check(mode .. ": builder " .. unitID .. " builds the solar inside, steps out of the ring, waits for the other, then raises it side by side", ids(q):find("-2,10,5,39736,10,5,39736,10,5,39736,10,5,39736,", 1, true) == 1, ids(q))
		check(mode .. ": builder " .. unitID .. "'s spot is outside the ring", q[2] and not PLACE.inside(laidRing[1].ring, q[2][2][1], q[2][2][3]), show(q[2]))
	end
end

--------------------------------------------------------------------------------
-- the sweep: work farthest from the builders first, the ring closed last on
-- their side
--------------------------------------------------------------------------------

local swept = PLACE.footprint(outpost, 0, 1024, 1024, nil, { x = 0, z = 0 })
for i, p in ipairs(swept) do
	p.seq = i
end
-- the builders are south of the outpost, which spans 1024 to 1344 each way
local exit = { x = 1184, z = 1800 }
local sweptSteps = PLACE.laySteps(outpost, 0, nil, { x = 0, z = 0 }, { { x = 1024, z = 1024 } }, swept, exit)
check("the solar inside the ring still comes first", swept[1].def == SOLAR and swept[1].insideRing)
check("the ring's sides go farthest from the builders first: the north side first", sweptSteps[1].points[1].z == 1024 and sweptSteps[1].points[2].z == 1024, show(sweptSteps[1].points))
check("and the side on the builders' side last, closing the ring behind them", sweptSteps[4].points[1].z == 1344 and sweptSteps[4].points[2].z == 1344, show(sweptSteps[4].points))
check("the turrets go farthest first too: the north ones before the south ones", swept[2].z == 1024 and swept[3].z == 1024 and swept[4].z == 1344 and swept[5].z == 1344, show({ swept[2].z, swept[3].z, swept[4].z, swept[5].z }))
check("and are numbered in their new order", swept[2].seq == 2 and swept[5].seq == 5)

E = engine({
	[200] = { def = 10, x = 1150, z = 1800, cmdDescs = { LEVEL } },
	[201] = { def = 10, x = 1220, z = 1800, cmdDescs = { LEVEL } },
}, function()
	return true
end)
local sweptPlan = PLACE.plan(swept, PLACE.capabilities({ 200, 201 }), false, nil, { steps = sweptSteps, on = true, ground = model(sweptSteps, swept) })
local closing = sweptPlan.terraform[4].tag
check("before the side that closes the ring, both builders wait for each other", sweptPlan.gathers[closing] and #sweptPlan.gathers[closing] == 2, show(sweptPlan.gathers))
check("their spots for the closing side are outside the ring, on their side", (function()
	for _, o in ipairs(sweptPlan.orders) do
		local seen = 0
		for i, c in ipairs(o.cmds) do
			if c[1] == 39736 and c[2][4] == closing then
				local move = o.cmds[i - 2]
				return move[1] == 10 and move[2][3] > 1344 and not PLACE.inside(sweptSteps[4].ring, move[2][1], move[2][3])
			end
		end
	end
	return false
end)(), show(sweptPlan.orders[1].cmds))

for _, mode in ipairs({ "help", "split" }) do
	local modePlan = PLACE.plan(swept, PLACE.capabilities({ 200, 201 }), false, mode, { steps = sweptSteps, on = true, ground = model(sweptSteps, swept) })
	local q = byUnit(modePlan)
	local closesWith = modePlan.terraform[4].tag
	for _, unitID in ipairs({ 200, 201 }) do
		local cmds = q[unitID] or {}
		local closingAt
		for i, c in ipairs(cmds) do
			if c[1] == 39736 and c[2][4] == closesWith then
				closingAt = i
			end
		end
		check(mode .. ": builder " .. unitID .. " builds the solar inside first, then moves outside and waits", ids(cmds):find("-2,10,5,", 1, true) == 1 and not PLACE.inside(sweptSteps[1].ring, cmds[2][2][1], cmds[2][2][3]), ids(cmds))
		check(mode .. ": builder " .. unitID .. " gets the ring's closing order only after moving outside and waiting", closingAt and cmds[closingAt - 1][1] == 5 and cmds[closingAt - 2][1] == 10 and not PLACE.inside(sweptSteps[1].ring, cmds[closingAt - 2][2][1], cmds[closingAt - 2][2][3]), ids(cmds))
	end
end

local ordered = PLACE.resolve({ ordered = true, buildings = {
	{ def = "turret", offset = { x = 0, z = 0 }, facing = 0 },
	{ def = "turret", offset = { x = 0, z = 320 }, facing = 0 },
}, terrain = {} })
local orderedFoot = PLACE.footprint(ordered, 0, 1024, 1024, nil, { x = 0, z = 0 })
PLACE.laySteps(ordered, 0, nil, { x = 0, z = 0 }, { { x = 1024, z = 1024 } }, orderedFoot, { x = 1024, z = 100 })
check("a blueprint whose order is its build order keeps it", orderedFoot[1].z == 1024 and orderedFoot[2].z == 1344, show({ orderedFoot[1].z, orderedFoot[2].z }))

-- a wall line, swept from its far end
local line = PLACE.resolve({ buildings = {}, terrain = { { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 896, z = 0 } }, height = 112, before = 0 } } })
local pieces = PLACE.laySteps(line, 0, nil, { x = 0, z = 0 }, { { x = 1024, z = 1024 } }, {}, { x = 2400, z = 1024 })
check("a wall longer than one of Zero-K's blocks is laid block by block", #pieces == 4, show(#pieces))
check("each block is at most a block long, cut on the 16 elmo grid", (function()
	for _, piece in ipairs(pieces) do
		local a, b = piece.points[1], piece.points[#piece.points]
		if math.abs(b.x - a.x) > PLACE.WALL_BLOCK or a.x % 16 ~= 0 or b.x % 16 ~= 0 or piece.wall ~= pieces[1].wall then
			return false
		end
	end
	return true
end)(), show(pieces))
check("the block farthest from the builders goes first, the nearest last", pieces[1].points[1].x == 1024 and pieces[4].points[#pieces[4].points].x == 1024 + 896, show({ pieces[1].points, pieces[4].points }))
check("the blocks cover the wall end to end", (function()
	local covered = {}
	for _, piece in ipairs(pieces) do
		covered[#covered + 1] = { piece.points[1].x, piece.points[#piece.points].x }
	end
	table.sort(covered, function(a, b)
		return a[1] < b[1]
	end)
	for i = 2, #covered do
		if covered[i][1] ~= covered[i - 1][2] then
			return false
		end
	end
	return covered[1][1] == 1024 and covered[#covered][2] == 1920
end)())
local linePlan = PLACE.plan({}, PLACE.capabilities({ 200 }), false, nil, { steps = pieces, on = true })
check("a wall's blocks are ordered together", #linePlan.terraform == 4 and linePlan.terraform[1].group == pieces[1].wall and linePlan.terraform[4].group == pieces[1].wall)
-- two builders standing in line with the wall's end, one a little off its line:
-- each block's spots for both are on one side of the wall and within a build
-- range of each other, or Zero-K pulls a block's units to one and walks the
-- other on to the wall (#4834)
engine({
	[200] = { def = 10, x = 800, z = 1024, cmdDescs = { LEVEL } },
	[201] = { def = 10, x = 800, z = 1072, cmdDescs = { LEVEL } },
}, function()
	return true
end)
local longPlan = byUnit(PLACE.plan({}, PLACE.capabilities({ 200, 201 }), false, "help", { steps = pieces, on = true, ground = model(pieces, {}) }))
check("each block's spots for two builders are on one side of the wall, within a build range of each other", (function()
	local a, b = {}, {}
	for _, c in ipairs(longPlan[200]) do
		if c[1] == 10 then
			a[#a + 1] = c[2]
		end
	end
	for _, c in ipairs(longPlan[201]) do
		if c[1] == 10 then
			b[#b + 1] = c[2]
		end
	end
	if #a ~= 4 or #b ~= 4 then
		return false
	end
	for i = 1, 4 do
		local sameSide = (a[i][3] - 1024) * (b[i][3] - 1024) > 0
		if not sameSide or math.sqrt((a[i][1] - b[i][1]) ^ 2 + (a[i][3] - b[i][3]) ^ 2) > RANGE - PLACE.MOVE_STOP then
			return false
		end
	end
	return true
end)(), show(longPlan))
check("a wall of one block is left whole",#PLACE.wallPieces({ kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 224, z = 0 } } }) == 1)

-- the engine takes a second order of one kind given with shift within 17
-- elmos of a first as cancelling it, wait and all
local function apartEnough(cmds, id)
	for i = 1, #cmds do
		for j = i + 1, #cmds do
			local a, b = cmds[i], cmds[j]
			if a[1] == id and b[1] == id and (a[2][1] - b[2][1]) ^ 2 + (a[2][3] - b[2][3]) ^ 2 < PLACE.COMMAND_CANCEL_DIST ^ 2 then
				return false
			end
		end
	end
	return true
end
check("no two of a builder's moves are near enough for the engine to cancel one", (function()
	for _, o in ipairs(sweptPlan.orders) do
		if not apartEnough(o.cmds, 10) then
			return false
		end
	end
	return true
end)())
local concentric = { laid({ kind = "level", shape = "area", points = { { x = 960, z = 960 }, { x = 1088, z = 960 }, { x = 1088, z = 1088 }, { x = 960, z = 1088 } }, height = 40 }), wall() }
concentric[2].points = { { x = 960, z = 1024 }, { x = 1088, z = 1024 } }
local both = PLACE.plan({}, PLACE.capabilities({ 200 }), false, nil, { steps = concentric, on = true })
check("two steps with the same middle get level commands far enough apart not to cancel", #both.orders[1].cmds == 2 and apartEnough(both.orders[1].cmds, 39736), show(both.orders[1].cmds))

--------------------------------------------------------------------------------
-- standing, as far as the player can see
--------------------------------------------------------------------------------

local seen = engine({}, function()
	return false
end)
seen.Spring.IsPosInLos = function(x)
	return x < 1000
end
check("ground in sight is asked of the engine", PLACE.canStand(10, 500, 0) == false)
check("ground out of sight, which the engine will not answer for, is taken to be fine", PLACE.canStand(10, 1500, 0) == true)

support.report()
