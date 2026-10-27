-- The unsynced half of the Zero-K save ground fixture match (issue #4798).
--
-- Runs only when the start script's coilbox_mode is ground_build or
-- ground_place, and reports everything as GROUND lines in the engine's log.
--
-- ground_build terraforms west to east across the middle of the map: a wall
-- raised by 112 with two Lotus on it, a pad levelled 40 above the ground with
-- a solar collector on it, and a trench dug 48 deep, then a solar collector on
-- the untouched ground west of them all, where the builders start. A builder
-- that stands on a step while it rises is stranded on top, so everything is
-- reached from the west and the wall is far enough from the pad that a
-- builder in range of the pad is off the wall. Near the end it saves the team's buildings
-- the way Save selection does and the pad and trench the way Save ground
-- does, with the coilbox widget's own record.lua and ground.lua.
--
-- ground_place reads the saved selection from LuaUI/coilbox_ground_steps.lua,
-- which the driver writes from the first match's log, and orders it again at
-- the same place on fresh ground: the buildings beside the steps, the steps,
-- then the buildings on them. Then it saves again.
--
-- ground_only (issue #4804) levels two plazas 5 above the ground, each with a
-- rock 60 high standing in it, which the fixture gadget raises. One is ordered
-- Only raise and the other both ways, through the blueprint widget's own
-- place.lua, and the probe reports the ground at the rock and on the plaza.
--
-- All of them dump the change in height over the whole area, a row a line.
--
-- With coilbox_shots=1, for a windowed run, it also frames the work from
-- above and takes screenshots, and saves through the coilbox widget when
-- that is loaded too, so its panel shows the result. It moves the camera
-- only, never the mouse.

local MODE = (Spring.GetModOptions() or {}).coilbox_mode or ""

function widget:GetInfo()
	return {
		name = "Coilbox Zero-K ground probe",
		desc = "Terraforms and saves the ground for the save ground fixture",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local CMD_TERRAFORM_INTERNAL = 39801
local CMD_LEVEL = 39736
local OPT_SHIFT = CMD.OPT_SHIFT
local TYPE_LEVEL, TYPE_RAISE = 1, 2

local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_end_frame) or 9000
local ORDER_FRAME = 75
local SAVE_FRAME = END_FRAME - 60
local SHOTS = (Spring.GetModOptions() or {}).coilbox_shots == "1"

local cx = 16 * math.floor(Game.mapSizeX / 32)
local cz = 16 * math.floor(Game.mapSizeZ / 32)

local JSON, GROUND, RECORD, PLACE
local builders = {}
local tag = 200000
local shift = 0

local function say(fmt, ...)
	Spring.Echo("GROUND " .. string.format(fmt, ...))
end

local function centre(points)
	local x, z = 0, 0
	for _, p in ipairs(points) do
		x, z = x + p.x, z + p.z
	end
	return x / #points, z / #points
end

--- A terraform order and its level step, the way Zero-K's lasso widget gives
-- them, after whatever the builders already hold.
local function terraform(kind, loop, height, points)
	tag = tag + 1
	local px, pz = centre(points)
	local params = { kind, Spring.GetMyTeamID(), px, pz, tag, loop, height, #points, #builders, 0 }
	for _, p in ipairs(points) do
		params[#params + 1] = p.x
		params[#params + 1] = p.z
	end
	for _, b in ipairs(builders) do
		params[#params + 1] = b
	end
	Spring.GiveOrderToUnit(builders[1], CMD_TERRAFORM_INTERNAL, params, 0)
	Spring.GiveOrderToUnitArray(builders, CMD_LEVEL, { px, Spring.GetGroundHeight(px, pz), pz, tag }, shift)
	shift = OPT_SHIFT
end

local function build(defName, x, z, facing)
	local def = UnitDefNames[defName]
	Spring.GiveOrderToUnitArray(builders, -def.id, { x, Spring.GetGroundHeight(x, z), z, facing or 0 }, shift)
	shift = OPT_SHIFT
end

local function orderBuild()
	terraform(TYPE_RAISE, 0, 112, {
		{ x = cx - 720, z = cz }, { x = cx - 672, z = cz }, { x = cx - 624, z = cz }, { x = cx - 576, z = cz }, { x = cx - 528, z = cz },
	})
	terraform(TYPE_LEVEL, 1, Spring.GetGroundOrigHeight(cx, cz) + 40, {
		{ x = cx - 64, z = cz - 48 }, { x = cx + 48, z = cz - 48 }, { x = cx + 48, z = cz + 32 }, { x = cx - 64, z = cz + 32 },
	})
	terraform(TYPE_RAISE, 1, -48, {
		{ x = cx + 208, z = cz - 16 }, { x = cx + 352, z = cz - 16 }, { x = cx + 352, z = cz }, { x = cx + 208, z = cz },
	})
	build("turretlaser", cx - 672, cz)
	build("turretlaser", cx - 576, cz)
	build("energysolar", cx, cz)
	build("energysolar", cx - 960, cz)
end

--- The two plazas of ground_only: where each is centred, and the order's
-- choice. The rock is 32 to 80 elmos east and south of the centre.
local PLAZAS = {
	{ name = "raise", x = cx - 400, only = "raise" },
	{ name = "both", x = cx + 200 },
}

--- A level step ordered the way the blueprint widget orders one: the order
-- place.lua builds, then the level step that follows it.
local function orderPlaza(plaza)
	tag = tag + 1
	local half = 96
	local step = {
		kind = "level",
		shape = "area",
		points = {
			{ x = plaza.x - half, z = cz - half },
			{ x = plaza.x + half, z = cz - half },
			{ x = plaza.x + half, z = cz + half },
			{ x = plaza.x - half, z = cz + half },
		},
		height = 5,
		base = Spring.GetGroundHeight(plaza.x, cz),
		only = plaza.only,
	}
	local params = PLACE.terraformParams(step, builders, tag, Spring.GetMyTeamID())
	say("plaza-order name=%s volume=%d base=%.3f", plaza.name, params[10], step.base)
	Spring.GiveOrderToUnit(builders[1], CMD_TERRAFORM_INTERNAL, params, 0)
	Spring.GiveOrderToUnitArray(builders, CMD_LEVEL, { plaza.x, step.base, cz, tag }, shift)
	shift = OPT_SHIFT
end

--- The ground at a rock's middle and in a plaza's, with the map's own.
local function sample(label)
	for _, plaza in ipairs(PLAZAS) do
		local rx, rz = plaza.x + 56, cz + 56
		say(
			"plaza-sample at=%s name=%s rock=%.3f rock-orig=%.3f plain=%.3f plain-orig=%.3f",
			label,
			plaza.name,
			Spring.GetGroundHeight(rx, rz),
			Spring.GetGroundOrigHeight(rx, rz),
			Spring.GetGroundHeight(plaza.x, cz),
			Spring.GetGroundOrigHeight(plaza.x, cz)
		)
	end
end

local function orderPlace()
	local ok, saved = pcall(VFS.Include, "LuaUI/coilbox_ground_steps.lua")
	if not ok or type(saved) ~= "table" then
		say("place-failed reason=%s", tostring(saved))
		return
	end
	local entry, ax, az = saved.entry, saved.anchor.x, saved.anchor.z
	local steps = entry.terrain or {}
	for i = 0, #entry.buildings do
		for _, s in ipairs(steps) do
			if s.before == i then
				local points = {}
				for j, p in ipairs(s.points) do
					points[j] = { x = ax + p.x, z = az + p.z }
				end
				terraform(TYPE_RAISE, s.shape == "area" and 1 or 0, s.height, points)
			end
		end
		local b = entry.buildings[i + 1]
		if b then
			build(b.def, ax + b.offset.x, az + b.offset.z, b.facing)
		end
	end
	say("placed steps=%d buildings=%d", #steps, #entry.buildings)
end

--- The change in height over the whole area, a row a line.
local function dumpGrid()
	local x0, x1, z0, z1 = cx - 1040, cx + 480, cz - 160, cz + 160
	say("grid-box x0=%d z0=%d x1=%d z1=%d", x0, z0, x1, z1)
	for z = z0, z1, 8 do
		local row = {}
		for x = x0, x1, 8 do
			row[#row + 1] = string.format("%.3f", Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z))
		end
		say("grid-row z=%d %s", z, table.concat(row, ","))
	end
end

local function save()
	local mine = {}
	for _, unitID in ipairs(Spring.GetTeamUnits(Spring.GetMyTeamID()) or {}) do
		local def = UnitDefs[Spring.GetUnitDefID(unitID)]
		if def and def.isBuilding and not Spring.GetUnitIsBeingBuilt(unitID) then
			mine[#mine + 1] = unitID
		end
	end
	Spring.SelectUnitArray(mine)
	local minX
	for _, unitID in ipairs(mine) do
		local x = Spring.GetUnitPosition(unitID)
		minX = math.min(minX or x, x)
	end
	local minZ
	for _, unitID in ipairs(mine) do
		local _, _, z = Spring.GetUnitPosition(unitID)
		minZ = math.min(minZ or z, z)
	end
	local entry, err = RECORD.selection({ nameFor = function()
		return "fixture"
	end, now = 0 })
	if not entry then
		say("save-selection-failed reason=%s", tostring(err))
	else
		-- the anchor record.lua measured the offsets from
		local anchor = { x = math.floor(minX / 16) * 16, z = math.floor(minZ / 16) * 16 }
		say("save-selection buildings=%d %s", #mine, JSON.encode({ anchor = anchor, entry = entry }))
	end
	local ground, gerr = RECORD.ground(cx - 120, cz - 100, cx + 420, cz + 100, { now = 0 })
	if not ground then
		say("save-ground-failed reason=%s", tostring(gerr))
	else
		say("save-ground %s", JSON.encode(ground))
	end
end

function widget:Initialize()
	if MODE ~= "ground_build" and MODE ~= "ground_place" and MODE ~= "ground_only" then
		widgetHandler:RemoveWidget(self)
		return
	end
	if MODE == "ground_only" then
		PLACE = VFS.Include("LuaUI/coilbox_blueprints/place.lua", nil, VFS.RAW_FIRST)
		PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game, WG = WG })
	end
	JSON = VFS.Include("LuaUI/coilbox_blueprints/json.lua")
	GROUND = VFS.Include("LuaUI/coilbox_blueprints/ground.lua")
	RECORD = VFS.Include("LuaUI/coilbox_blueprints/record.lua")
	RECORD.use({ Spring = Spring, UnitDefs = UnitDefs, Game = Game, GROUND = GROUND })
	say("loaded mode=%s tolerance=%s centre=%d,%d", MODE, tostring(GROUND.TOLERANCE), cx, cz)
	-- Zero-K ends a match at its first frame when the other allyteam has no
	-- player or AI in it, unless cheats are on (game_over.lua, ProcessLastAlly).
	-- a windowed run goes slower, so it draws the frames it takes shots of
	local speed = SHOTS and "10" or "100"
	Spring.SendCommands("cheat 1", "setmaxspeed " .. speed, "setminspeed " .. speed)
end

--- Look at a point from this far away, in whatever camera the game uses:
-- its own state with the point and the distance changed.
local function look(x, z, distance)
	local state = Spring.GetCameraState()
	state.px, state.py, state.pz = x, Spring.GetGroundHeight(x, z), z
	state.dist, state.height = distance, distance
	Spring.SetCameraState(state, 0)
end

local function shot()
	Spring.SendCommands("screenshot png")
end

-- What the windowed run looks at, and when: frames before the save.
local SHOT_PLAN = {
	{ before = 600, x = cx - 400, distance = 1300 },
	{ before = 540, x = cx - 620, distance = 600, take = true },
	{ before = 480, x = cx + 120, distance = 700, take = true },
	{ before = 420, x = cx - 400, distance = 1300, take = true },
}

-- ground_only looks at each plaza before the orders and again once the
-- builders are done: the Only raise one, then the both ways one.
local ONLY_SHOTS = {
	{ at = 60, plaza = 1 },
	{ at = 100, plaza = 2 },
	{ at = END_FRAME - 140, plaza = 1 },
	{ at = END_FRAME - 100, plaza = 2 },
}

local function shots(frame)
	if MODE == "ground_only" then
		for _, s in ipairs(ONLY_SHOTS) do
			if frame == s.at then
				look(PLAZAS[s.plaza].x + 20, cz + 20, 560)
			elseif frame == s.at + 20 then
				shot()
			end
		end
		return
	end
	for _, s in ipairs(SHOT_PLAN) do
		if frame == SAVE_FRAME - s.before then
			look(s.x, cz, s.distance)
		elseif s.take and frame == SAVE_FRAME - s.before + 20 then
			shot()
		end
	end
	local api = WG.CoilboxBlueprints
	if frame == SAVE_FRAME - 200 and api then
		api.open()
		if MODE == "ground_build" then
			api.saveGround(cx - 120, cz - 100, cx + 420, cz + 100)
		end
	elseif frame == SAVE_FRAME - 170 then
		shot()
	end
end

function widget:GameFrame(frame)
	if SHOTS then
		shots(frame)
	end
	if frame == ORDER_FRAME then
		for _, unitID in ipairs(Spring.GetTeamUnits(Spring.GetMyTeamID()) or {}) do
			if Spring.GetUnitRulesParam(unitID, "coilbox_ground_builder") then
				builders[#builders + 1] = unitID
			end
		end
		say("builders count=%d", #builders)
		if #builders == 0 then
			return
		end
		if MODE == "ground_only" then
			sample("start")
			for _, plaza in ipairs(PLAZAS) do
				orderPlaza(plaza)
			end
		elseif MODE == "ground_build" then
			orderBuild()
		else
			orderPlace()
		end
	elseif frame == SAVE_FRAME then
		if MODE == "ground_only" then
			sample("end")
		else
			save()
		end
		dumpGrid()
	end
end
