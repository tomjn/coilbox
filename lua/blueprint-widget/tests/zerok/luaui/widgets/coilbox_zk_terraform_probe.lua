-- The unsynced half of the Zero-K terraform fixture match: the orders a widget
-- such as the coilbox blueprint widget would give. One case per builder the
-- fixture gadget creates, each raising a wall and putting a Lotus on top of
-- it, with a different sequence of orders. Everything it does is reported as
-- PROBE lines in the engine's log.

function widget:GetInfo()
	return {
		name = "Coilbox Zero-K terraform probe",
		desc = "Orders a raised wall and a turret on it in several ways",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local CMD_TERRAFORM_INTERNAL = 39801
local CMD_LEVEL = 39736
local CMD_RAISE = 39737
local CMD_INSERT = CMD.INSERT
local OPT_SHIFT = CMD.OPT_SHIFT
local OPT_ALT = CMD.OPT_ALT

local modOptions = Spring.GetModOptions() or {}
local WALL_HEIGHT = tonumber(modOptions.coilbox_wall_height) or 112
-- Tags from a counter of the probe's own rather than Zero-K's widget.
local OWN_TAGS = modOptions.coilbox_own_tags == "1"
local PRIOR_FRAME = 60
local ORDER_FRAME = 75
-- With coilbox_shots=1, for a windowed run, it looks down on one case's lane,
-- coilbox_shot_case, and takes a screenshot every SHOT_EVERY frames. It moves
-- the camera only, never the mouse.
local SHOTS = modOptions.coilbox_shots == "1"
local SHOT_CASE = tonumber(modOptions.coilbox_shot_case) or 21
local SHOT_EVERY = 150
-- The first case with a ring of wall.
local FIRST_RING_CASE = 21

local turretDefID = UnitDefNames.turretlaser.id
local solarDefID = UnitDefNames.energysolar.id

local ownTag = 100000
local function nextTag()
	if WG.Terraform_GetNextTag and not OWN_TAGS then
		return WG.Terraform_GetNextTag(), "WG"
	end
	ownTag = ownTag + 1
	return ownTag, "own"
end

-- A wall along x through the lane's centre, this far each way.
local function wallAt(cx, cz, reach)
	return { { cx - reach, cz }, { cx, cz }, { cx + reach, cz } }
end

-- The terraform order, built the way gui_lasso_terraform.lua builds it, for
-- every builder in the list.
local function terraform(builders, cx, cz, tag, reach)
	local points = wallAt(cx, cz, reach or 48)
	local params = { 2, Spring.GetMyTeamID(), cx, cz, tag, 0, WALL_HEIGHT, #points, #builders, 0 }
	for i = 1, #points do
		params[#params + 1] = points[i][1]
		params[#params + 1] = points[i][2]
	end
	for i = 1, #builders do
		params[#params + 1] = builders[i]
	end
	Spring.GiveOrderToUnit(builders[1], CMD_TERRAFORM_INTERNAL, params, 0)
end

local function stepParams(cx, cz, tag)
	return { cx, Spring.GetGroundHeight(cx, cz), cz, tag }
end

local function turretParams(cx, cz)
	return { cx, Spring.GetGroundHeight(cx, cz), cz, 0 }
end

-- The blueprint widget's own placing code (lua/blueprint-widget/luaui/
-- coilbox_blueprints/place.lua, copied in beside this widget by the script),
-- given a blueprint with a raised wall and a Lotus on top, the way the widget
-- gives it after a click. The widget itself needs gl, which spring-headless
-- does not have.
local PLACE = VFS.Include("LuaUI/coilbox_blueprints/place.lua", nil, VFS.RAW_FIRST)
-- and the module that holds each terraform order until a builder nears its step
local LATER = VFS.Include("LuaUI/coilbox_blueprints/pending_terraform.lua", nil, VFS.RAW_FIRST)
LATER.use({ Spring = Spring })
-- and the model of the ground each step changes, which placing sends the
-- builders clear of (#4816). The orders go before any ground has changed, so
-- the widget's copy of the heightmap is still the map's.
local TERRAFORM = VFS.Include("LuaUI/coilbox_blueprints/terraform.lua", nil, VFS.RAW_FIRST)
-- and the module that keeps each builder clear while it works on a step
local CLEAR = VFS.Include("LuaUI/coilbox_blueprints/step_clear.lua", nil, VFS.RAW_FIRST)
CLEAR.use({ Spring = Spring, UnitDefs = UnitDefs })

-- The widget's model of the ground a blueprint leaves (issue #4797) is run by
-- the fixture gadget, which can read the real heightmap. A widget in a headless
-- match reads an unsynced copy that is not kept up to date. The probe gives the
-- gadget the laid steps and the buildings of each blueprint it orders, as the
-- widget's own placing code laid them, and the gadget works out what the model
-- expects and compares it with the ground the game then leaves.
local function serialise(value)
	if type(value) == "table" then
		local parts = {}
		for k, v in pairs(value) do
			if type(v) ~= "function" and type(v) ~= "userdata" and k ~= "def" then
				parts[#parts + 1] = "[" .. (type(k) == "string" and string.format("%q", k) or tostring(k)) .. "]=" .. serialise(v)
			end
		end
		return "{" .. table.concat(parts, ",") .. "}"
	elseif type(value) == "string" then
		return string.format("%q", value)
	end
	return tostring(value)
end

local function model(case, steps, foot)
	local plain = {}
	for i, p in ipairs(foot or {}) do
		plain[i] = { x = p.x, z = p.z, xsize = p.def and p.def.xsize, zsize = p.def and p.def.zsize, facing = p.facing, seq = p.seq }
	end
	Spring.SendLuaRulesMsg("coilbox_model " .. case .. " " .. serialise({ steps = steps, foot = plain }))
end

--- The middle of some builders, which the widget sweeps the work towards.
local function middleOf(units)
	local sx, sz, n = 0, 0, 0
	for _, unitID in ipairs(units) do
		local x, _, z = Spring.GetUnitPosition(unitID)
		if x then
			sx, sz, n = sx + x, sz + z, n + 1
		end
	end
	return n > 0 and { x = sx / n, z = sz / n } or nil
end

-- The case being ordered, for the log.
local ordering = 0

-- @param ahead table[]? buildings ahead of the wall in the blueprint's order
local function blueprint(builders, cx, cz, shift, mode, withTurret, case, terrain, ahead)
	PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game, WG = WG })
	local buildings = {}
	for _, b in ipairs(ahead or {}) do
		buildings[#buildings + 1] = b
	end
	if withTurret then
		buildings[#buildings + 1] = { def = "turretlaser", offset = { x = 0, z = 0 }, facing = 0 }
	end
	local entry = {
		buildings = buildings,
		terrain = terrain or { { kind = "raise", shape = "wall", points = { { x = -48, z = 0 }, { x = 0, z = 0 }, { x = 48, z = 0 } }, height = WALL_HEIGHT, before = #(ahead or {}) } },
	}
	local resolved = PLACE.resolve(entry)
	local pivot = PLACE.pivot(resolved)
	local ax, az = PLACE.pivotAt(resolved, pivot, 0, nil, cx, cz)
	local origin = pivot and resolved.buildings[pivot].offset or nil
	local foot = PLACE.footprint(resolved, 0, ax, az, nil, origin)
	for i, p in ipairs(foot) do
		p.seq = i
	end
	local steps = PLACE.laySteps(resolved, 0, nil, origin, { { x = ax, z = az } }, foot, middleOf(builders))
	if case then
		model(case, steps, foot)
	end
	local ground = TERRAFORM.session({ heightAt = Spring.GetGroundHeight, corners = { x = Game.mapSizeX / 8 + 1, z = Game.mapSizeZ / 8 + 1 }, structures = {} }).apply(steps, foot)
	local plan = PLACE.plan(foot, PLACE.capabilities(builders), shift, mode, { steps = steps, on = true, ground = ground })
	local sent = PLACE.issue(plan, LATER, CLEAR)
	Spring.Echo(string.format("PROBE blueprint sent=%d terraform=%d skipped=%d offMap=%d remainder=%d blocked=%d", sent, #plan.terraform, plan.skipped, plan.offMap, #plan.remainder, plan.blocked))
	-- each builder's orders, and where each move sends it
	for _, order in ipairs(plan.orders) do
		local parts = {}
		for _, c in ipairs(order.cmds) do
			if c[1] == PLACE.CMD_MOVE then
				parts[#parts + 1] = string.format("move@%d,%d", c[2][1] - cx, c[2][3] - cz)
			else
				parts[#parts + 1] = tostring(c[1])
			end
		end
		Spring.Echo(string.format("PROBE orders case=%d unit=%d %s", ordering, order.unitID, table.concat(parts, ",")))
	end
end

-- The walled outpost example (docs/reports/m93-examples): a turret on each
-- corner of a ring of wall, and a solar collector inside it. The example's wall
-- is 112 high, and these follow the match's wall height.
local OUTPOST = {
	{ def = "turretlaser", offset = { x = 0, z = 0 }, facing = 0 },
	{ def = "turretlaser", offset = { x = 320, z = 0 }, facing = 0 },
	{ def = "turretlaser", offset = { x = 320, z = 320 }, facing = 0 },
	{ def = "turretlaser", offset = { x = 0, z = 320 }, facing = 0 },
	{ def = "energysolar", offset = { x = 160, z = 160 }, facing = 0 },
}
local function ring(x0, z0, x1, z1)
	return { { x = x0, z = z0 }, { x = x1, z = z0 }, { x = x1, z = z1 }, { x = x0, z = z1 }, { x = x0, z = z0 } }
end
local OUTPOST_RING = { { kind = "raise", shape = "wall", points = ring(0, 0, 320, 320), height = WALL_HEIGHT, before = 0 } }
-- The wall ring, terrain only example, centred on the lane: its blueprint has
-- no building to hold it by.
local WALL_RING = { { kind = "raise", shape = "wall", points = ring(-192, -192, 192, 192), height = WALL_HEIGHT, before = 0 } }

local LONG_AHEAD = {
	{ def = "turretheavylaser", offset = { x = -160, z = 64 }, facing = 0 },
	{ def = "turretheavylaser", offset = { x = 160, z = 64 }, facing = 0 },
	{ def = "turretheavylaser", offset = { x = -160, z = -64 }, facing = 0 },
}

-- Four turrets at the corners of a pad, round the one at its centre.
local PAD_TURRETS = {
	{ def = "turretlaser", offset = { x = -32, z = -32 }, facing = 0 },
	{ def = "turretlaser", offset = { x = 32, z = -32 }, facing = 0 },
	{ def = "turretlaser", offset = { x = -32, z = 32 }, facing = 0 },
	{ def = "turretlaser", offset = { x = 32, z = 32 }, facing = 0 },
}

-- Open walls longer than two of Zero-K's 224 elmo blocks (#4833), terrain only,
-- one straight and one with a corner. The widget cuts each into a terraform
-- order for each block. The layout is held by the middle of its steps, so the
-- points are round that.
local LONG_WALL = { { kind = "raise", shape = "wall", points = { { x = -400, z = 0 }, { x = 400, z = 0 } }, height = WALL_HEIGHT, before = 0 } }
local BENT_WALL = { { kind = "raise", shape = "wall", points = { { x = -200, z = 150 }, { x = 200, z = 150 }, { x = 200, z = -150 } }, height = WALL_HEIGHT, before = 0 } }

-- What each case does after the terraform order.
local CASES = {
	{ name = "level then turret, no shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_LEVEL, stepParams(cx, cz, tag), 0)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	{ name = "level then turret, shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_LEVEL, stepParams(cx, cz, tag), OPT_SHIFT)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	{ name = "Hel-K inserts at the end", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		local s = stepParams(cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_INSERT, { -1, CMD_LEVEL, OPT_SHIFT, s[1], s[2], s[3], s[4] }, OPT_ALT + OPT_SHIFT)
		local t = turretParams(cx, cz)
		Spring.GiveOrderToUnitArray(b, CMD_INSERT, { -1, -turretDefID, OPT_SHIFT, t[1], t[2], t[3], t[4] }, OPT_ALT + OPT_SHIFT)
	end },
	{ name = "inserts at the front", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		local s = stepParams(cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_INSERT, { 0, CMD_LEVEL, 0, s[1], s[2], s[3], s[4] }, OPT_ALT)
		local t = turretParams(cx, cz)
		Spring.GiveOrderToUnitArray(b, CMD_INSERT, { 1, -turretDefID, 0, t[1], t[2], t[3], t[4] }, OPT_ALT)
	end },
	{ name = "turret with no level step, no shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), 0)
	end },
	{ name = "turret with no level step, shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	{ name = "raise then turret, no shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_RAISE, stepParams(cx, cz, tag), 0)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	{ name = "terraform order alone", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
	end },
	{ name = "long wall, level then turret, no shift", run = function(b, cx, cz, tag)
		model(9, { { kind = "raise", shape = "wall", points = { { x = cx - 176, z = cz }, { x = cx, z = cz }, { x = cx + 176, z = cz } }, height = WALL_HEIGHT, after = 0, base = Spring.GetGroundHeight(cx, cz) } })
		terraform(b, cx, cz, tag, 176)
		Spring.GiveOrderToUnitArray(b, CMD_LEVEL, stepParams(cx, cz, tag), 0)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	{ name = "two builders, level then turret, shift", run = function(b, cx, cz, tag)
		terraform(b, cx, cz, tag)
		Spring.GiveOrderToUnitArray(b, CMD_LEVEL, stepParams(cx, cz, tag), OPT_SHIFT)
		Spring.GiveOrderToUnitArray(b, -turretDefID, turretParams(cx, cz), OPT_SHIFT)
	end },
	-- The blueprint widget's placing code. They order the terraform themselves.
	{ name = "blueprint with a wall and a turret, no shift", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", true, 11)
	end },
	{ name = "blueprint with a wall and a turret, shift", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, true, "help", true)
	end },
	{ name = "blueprint with a wall and a turret, two builders split up", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "split", true)
	end },
	{ name = "blueprint with a wall only", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 14)
	end },
	-- The cost and the ground the model gave, against the game's, for the other
	-- kinds of step. Each is a blueprint of terrain alone.
	{ name = "blueprint with a pad levelled 40 above the pivot", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 15, { { kind = "level", shape = "area", points = { { x = -64, z = -64 }, { x = 64, z = -64 }, { x = 64, z = 64 }, { x = -64, z = 64 } }, height = 40, before = 0 } })
	end },
	{ name = "blueprint with a ramp from the ground to 64 above it", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 16, { { kind = "ramp", shape = "wall", points = { { x = -128, z = 0 }, { x = 128, z = 0 } }, heights = { 0, 64 }, width = 64, before = 0 } })
	end },
	{ name = "blueprint with a trench 50 deep", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 17, { { kind = "raise", shape = "wall", points = { { x = -96, z = 0 }, { x = 96, z = 0 } }, height = -50, before = 0 } })
	end },
	-- Three Stingers ahead of the wall, 90 seconds each for one Conjurer, more
	-- than the two minutes Zero-K keeps a terraform nobody works on (#4803).
	{ name = "blueprint with three minutes of work ahead of the wall", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", true, nil, nil, LONG_AHEAD)
	end },
	-- The same, for a builder that Zero-K's gadget stops checking once two other
	-- constructors die (the fixture kills them, see its spare builders).
	{ name = "long blueprint for a builder the gadget no longer checks", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", true, nil, nil, LONG_AHEAD)
	end },
	-- Split up with three builders on a raised pad with five turrets standing on
	-- it. Every builder has to wait for the ground, or the turrets that go up
	-- first leave notches in it (#4817). The pad says before = 2, which an older
	-- blueprint could, and which placing treats as 0.
	{ name = "blueprint with a raised pad and five turrets, three builders split up", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "split", true, 20, { { kind = "level", shape = "area", points = { { x = -64, z = -64 }, { x = 64, z = -64 }, { x = 64, z = 64 }, { x = -64, z = 64 } }, height = 40, before = 2 } }, PAD_TURRETS)
	end },
	-- Walking builders that have to step clear of what they raise (#4816). The
	-- builders start on the west side of the ring's slope.
	{ name = "the walled outpost, two builders together", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, nil, OUTPOST_RING, OUTPOST)
	end },
	{ name = "the walled outpost, two builders split up", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "split", false, nil, OUTPOST_RING, OUTPOST)
	end },
	{ name = "a ring of wall alone, two builders together", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 23, WALL_RING)
	end },
	{ name = "a straight wall of three and a half blocks, two builders together", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 24, LONG_WALL)
	end },
	{ name = "a wall with a corner of three blocks and a bit, two builders together", own = true, run = function(b, cx, cz)
		blueprint(b, cx, cz, false, "help", false, 25, BENT_WALL)
	end },
}

local builders = {}

local function findBuilders()
	for _, unitID in ipairs(Spring.GetTeamUnits(Spring.GetMyTeamID()) or {}) do
		local case = Spring.GetUnitRulesParam(unitID, "coilbox_case")
		if case then
			builders[case] = builders[case] or {}
			table.insert(builders[case], unitID)
		end
	end
end

local function lane(unitID)
	return Spring.GetUnitRulesParam(unitID, "coilbox_lane_x"), Spring.GetUnitRulesParam(unitID, "coilbox_lane_z")
end

function widget:Initialize()
	-- the save ground matches have a probe of their own
	if ((Spring.GetModOptions() or {}).coilbox_mode or ""):sub(1, 6) == "ground" then
		widgetHandler:RemoveWidget(self)
		return
	end
	Spring.Echo(string.format("PROBE loaded GetNextTag=%s lassoInitialised=%s",
		type(WG.Terraform_GetNextTag), type(WG.Terraform_SetPlacingRectangle)))
	-- Zero-K ends a match at its first frame when the other allyteam has no
	-- player or AI in it, unless cheats are on (game_over.lua, ProcessLastAlly).
	-- a windowed run goes slower, so it draws the frames it takes shots of
	local speed = SHOTS and "10" or "100"
	Spring.SendCommands("cheat 1", "setmaxspeed " .. speed, "setminspeed " .. speed)
end

local function shots(frame)
	local list = builders[SHOT_CASE]
	if not (list and list[1]) or frame < ORDER_FRAME then
		return
	end
	-- the camera is set again before each shot, since the game's own camera
	-- can move it after the match starts
	if frame % SHOT_EVERY == SHOT_EVERY - 20 then
		local cx, cz = lane(list[1])
		local state = Spring.GetCameraState()
		state.px, state.py, state.pz = cx, Spring.GetGroundHeight(cx, cz), cz
		state.dist, state.height = 800, 800
		Spring.SetCameraState(state, 0)
		-- which Zero-K's camera does not always take, so point it there as well
		Spring.SetCameraTarget(cx, Spring.GetGroundHeight(cx, cz), cz, 0)
	elseif frame % SHOT_EVERY == 0 then
		Spring.SendCommands("screenshot png")
	end
end

function widget:GameFrame(frame)
	LATER.update(frame)
	CLEAR.update(frame)
	if SHOTS then
		shots(frame)
	end
	if frame == PRIOR_FRAME then
		findBuilders()
		-- Something already in every queue, so shift has a job to do. Not for
		-- the ring cases, which never use shift, and whose solar collector would
		-- stand on the ring.
		for case, list in pairs(builders) do
			for _, unitID in ipairs(case < FIRST_RING_CASE and list or {}) do
				local bx, _, bz = Spring.GetUnitPosition(unitID)
				Spring.GiveOrderToUnit(unitID, -solarDefID, { bx, Spring.GetGroundHeight(bx, bz + 128), bz + 128, 0 }, 0)
			end
		end
	elseif frame == ORDER_FRAME then
		Spring.Echo(string.format("PROBE at-orders GetNextTag=%s lassoInitialised=%s height=%d ownTags=%s",
			type(WG.Terraform_GetNextTag), type(WG.Terraform_SetPlacingRectangle), WALL_HEIGHT, tostring(OWN_TAGS)))
		local first = builders[1] and builders[1][1]
		local index = first and Spring.FindUnitCmdDesc(first, CMD_LEVEL)
		local desc = index and Spring.GetUnitCmdDescs(first, index, index)[1]
		Spring.Echo(string.format("PROBE level-desc index=%s action=%s name=%s",
			tostring(index), desc and tostring(desc.action) or "-", desc and tostring(desc.name) or "-"))
		for i, case in ipairs(CASES) do
			local list = builders[i]
			if list then
				local cx, cz = lane(list[1])
				local tag, source = nextTag()
				if case.own then
					tag, source = 0, "blueprint"
				end
				ordering = i
				case.run(list, cx, cz, tag)
				Spring.Echo(string.format("PROBE ordered case=%d tag=%d source=%s builders=%d lane=%d,%d name=%s",
					i, tag, source, #list, cx, cz, case.name))
			else
				Spring.Echo("PROBE missing builder case=" .. i)
			end
		end
	end
end
