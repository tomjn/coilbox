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
-- which the driver writes from the first match's log, and places it again at
-- the same place on fresh ground with the blueprint widget's own placing code:
-- the steps, each builder stepping clear of a step before it works on it, then
-- the buildings. Then it saves again.
--
-- Both dump the change in height over the whole area, a row a line.
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

local JSON, GROUND, RECORD, PLACE, TERRAFORM, LATER, CLEAR
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

local function orderPlace()
	local ok, saved = pcall(VFS.Include, "LuaUI/coilbox_ground_steps.lua")
	if not ok or type(saved) ~= "table" then
		say("place-failed reason=%s", tostring(saved))
		return
	end
	local entry, ax, az = saved.entry, saved.anchor.x, saved.anchor.z
	-- placed with the blueprint widget's own placing code, which sends each
	-- builder clear of a step's ground before it works on it (#4816)
	PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game, WG = WG })
	local resolved = PLACE.resolve(entry)
	local foot = PLACE.footprint(resolved, 0, ax, az)
	for i, p in ipairs(foot) do
		p.seq = i
	end
	local steps = PLACE.laySteps(resolved, 0, nil, nil, { { x = ax, z = az } }, foot)
	local ground = TERRAFORM.session({ heightAt = Spring.GetGroundHeight, corners = { x = Game.mapSizeX / 8 + 1, z = Game.mapSizeZ / 8 + 1 }, structures = {} }).apply(steps, foot)
	local plan = PLACE.plan(foot, PLACE.capabilities(builders), false, "help", { steps = steps, on = true, ground = ground })
	PLACE.issue(plan, LATER, CLEAR)
	for _, order in ipairs(plan.orders) do
		local parts = {}
		for _, c in ipairs(order.cmds) do
			parts[#parts + 1] = c[1] == PLACE.CMD_MOVE and string.format("move@%d,%d", c[2][1] - cx, c[2][3] - cz) or tostring(c[1])
		end
		say("orders unit=%d %s", order.unitID, table.concat(parts, ","))
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
	if MODE ~= "ground_build" and MODE ~= "ground_place" then
		widgetHandler:RemoveWidget(self)
		return
	end
	JSON = VFS.Include("LuaUI/coilbox_blueprints/json.lua")
	GROUND = VFS.Include("LuaUI/coilbox_blueprints/ground.lua")
	RECORD = VFS.Include("LuaUI/coilbox_blueprints/record.lua")
	RECORD.use({ Spring = Spring, UnitDefs = UnitDefs, Game = Game, GROUND = GROUND })
	PLACE = VFS.Include("LuaUI/coilbox_blueprints/place.lua", nil, VFS.RAW_FIRST)
	TERRAFORM = VFS.Include("LuaUI/coilbox_blueprints/terraform.lua", nil, VFS.RAW_FIRST)
	LATER = VFS.Include("LuaUI/coilbox_blueprints/pending_terraform.lua", nil, VFS.RAW_FIRST)
	LATER.use({ Spring = Spring })
	CLEAR = VFS.Include("LuaUI/coilbox_blueprints/step_clear.lua", nil, VFS.RAW_FIRST)
	CLEAR.use({ Spring = Spring, UnitDefs = UnitDefs })
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

local function shots(frame)
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
	LATER.update(frame)
	CLEAR.update(frame)
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
		if MODE == "ground_build" then
			orderBuild()
		else
			orderPlace()
		end
	elseif frame == SAVE_FRAME then
		save()
		dumpGrid()
	end
end
