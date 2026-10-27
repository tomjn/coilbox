-- Proves a base's terrain changes (issue #4799): the ground is set before the
-- base's buildings are placed on it, at the start and for a base a trigger
-- places later. Run it with:
--
--   luajit lua/mission-runtime/tests/terrain_test.lua

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

--------------------------------------------------------------------------------
-- The ground model is the blueprint widget's, byte for byte.
--------------------------------------------------------------------------------

-- A gadget cannot include a LuaUI file, so the runtime carries a copy of the
-- widget's port. The widget's terraform_test.lua runs the cases from
-- src/blueprint/terraform.test.ts against its file, so a copy with the same
-- bytes passes the same cases. This is what stops the two drifting apart.
local function read(path)
	local file = assert(io.open(path, "rb"))
	local text = file:read("*a")
	file:close()
	return text
end
local root = support.root()
check("the runtime's terraform.lua is the blueprint widget's, byte for byte",
	read(root .. "/luarules/mission_runtime/coilbox_terraform.lua")
		== read(root .. "/../blueprint-widget/luaui/coilbox_blueprints/terraform.lua"),
	"copy lua/blueprint-widget/luaui/coilbox_blueprints/terraform.lua over coilbox_terraform.lua")

--------------------------------------------------------------------------------
-- Laying a base's steps on the map.
--------------------------------------------------------------------------------

local BASES = dofile(root .. "/luarules/mission_runtime/coilbox_bases.lua")
local laid = BASES.laidSteps({
	origin = { x = 1000, z = 2000 },
	terrain = {
		{ kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 96, z = 0 } }, heights = { 0, 40 }, width = 64 },
	},
}, 17)
check("a step's points are moved to the base's origin",
	laid[1].points[1].x == 1000 and laid[1].points[2].x == 1096 and laid[1].points[2].z == 2000)
check("every step comes before every building", laid[1].after == 0)
check("a step is measured from the ground under the origin", laid[1].base == 17)
check("a ramp keeps its ends and its width", laid[1].heights[2] == 40 and laid[1].width == 64)

--------------------------------------------------------------------------------
-- A walled base at the start, and one a trigger places.
--------------------------------------------------------------------------------

local WALL = {
	kind = "raise",
	shape = "wall",
	points = { { x = -128, z = 0 }, { x = 128, z = 0 } },
	height = 40,
}
-- A pad levelled 24 above the origin's ground, with the factory standing on it.
local PAD = {
	kind = "level",
	shape = "area",
	points = { { x = -64, z = 136 }, { x = 64, z = 136 }, { x = 64, z = 264 }, { x = -64, z = 264 } },
	height = 24,
}

local function base(id, origin, fields)
	local prefab = {
		id = id,
		team = "enemy",
		origin = origin,
		buildings = { { def = "corlab", offset = { x = 0, z = 200 }, facing = 0 } },
		terrain = { WALL, PAD },
	}
	for key, value in pairs(fields or {}) do
		prefab[key] = value
	end
	return prefab
end

local MISSION = compiled({
	runtimeVersion = 10,
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	prefabs = {
		base("keep", { x = 1024, z = 1024 }),
		base("outpost", { x = 3072, z = 1024 }, { dormant = true }),
		base("hardonly", { x = 1024, z = 3072 }, { difficulty = { atLeast = "hard" } }),
	},
	actors = {
		{ id = "scout", unitDef = "armflea", team = "player", pos = { x = 1024, z = 1024 }, facing = 0 },
	},
	triggers = {
		{
			id = "arrive",
			enabled = true,
			["repeat"] = false,
			conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 1 } } } },
			actions = {
				{ type = "spawn_base", params = { base = "outpost" } },
				{ type = "spawn_base", params = { base = "outpost" } },
				{ type = "spawn_base", params = { base = "hardonly" } },
				{ type = "spawn_base", params = { base = "nowhere" } },
			},
		},
	},
})

local OPTIONS = { buildings = { corlab = true } }

local function started(options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), options or OPTIONS)
	engine.env:Initialize()
	engine.env:GameStart()
	return engine
end

local engine = started()
local ground = engine.env.Spring.GetGroundHeight

local function kinds(events)
	local out = {}
	for _, event in ipairs(events) do
		out[#out + 1] = event[1] == "unit" and event[2] or event[1]
	end
	return table.concat(out, " ")
end

check("the base's ground is set once, before anything is placed",
	kinds(engine.events) == "ground armflea corlab", kinds(engine.events))
check("the wall stands at the start", ground(1024, 1024) == 40, tostring(ground(1024, 1024)))
check("the wall is raised along its length", ground(1024 - 128, 1024) == 40 and ground(1024 + 128, 1024) == 40)
check("the wall has a slope rather than a cliff",
	ground(1024, 1024 - 24) == 12 and ground(1024, 1024 - 32) == 4, tostring(ground(1024, 1024 - 24)))
check("a building stands on the ground its base's steps leave",
	engine.events[3][3] == 24, tostring(engine.events[3][3]))
check("an actor stands on the changed ground too", engine.events[2][3] == 40, tostring(engine.events[2][3]))
check("a dormant base is not placed at the start, and its ground is left alone",
	ground(3072, 1024) == 0 and #engine.alive() == 2, #engine.alive() .. " units")
check("a base the difficulty leaves out changes no ground", ground(1024, 3072) == 0)

for frame = 1, 31 do
	engine.env:GameFrame(frame)
end

local after = {}
for i = 4, #engine.events do
	after[#after + 1] = engine.events[i]
end
check("spawn_base sets the dormant base's ground, then places its buildings",
	kinds(after) == "ground corlab", kinds(after))
check("the dormant base's wall stands once it is placed", ground(3072, 1024) == 40, tostring(ground(3072, 1024)))
check("the dormant base's building stands on its pad", after[2] and after[2][3] == 24)
check("a second spawn_base is reported and raises nothing twice",
	logged(engine, "base outpost is already on the map") and ground(3072, 1024) == 40)
check("spawn_base on a base the difficulty leaves out places nothing",
	logged(engine, "base hardonly is not part of this mission") and ground(1024, 3072) == 0)
check("spawn_base naming no base is reported", logged(engine, "no base named nowhere"))
check("a placed dormant base is recorded for a reload",
	engine.rulesParams[BASES.RULES_PREFIX .. "outpost"] == 1)

--------------------------------------------------------------------------------
-- A reload does not place a dormant base a second time.
--------------------------------------------------------------------------------

local reloaded = load({ coilbox_mission = "demo" }, missionFiles(MISSION), {
	buildings = { corlab = true },
	frame = 40,
	survivors = engine,
})
reloaded.env:Initialize()
check("a reloaded runtime knows the dormant base is on the map",
	reloaded.GG.CoilboxMission.bases.placed("outpost") == true)
check("and will not place it again", reloaded.GG.CoilboxMission.bases.spawn("outpost") == false)

--------------------------------------------------------------------------------
-- The emitted shape: src/scenario/fixtures/stronghold.json, as coilbox compiles
-- it.
--------------------------------------------------------------------------------

local stronghold = load({ coilbox_mission = "demo" }, missionFiles(support.fixture("stronghold")), {
	buildings = { corlab = true, corllt = true },
})
stronghold.env:Initialize()
stronghold.env:GameStart()
local strongGround = stronghold.env.Spring.GetGroundHeight
check("the compound's ground is set before its buildings",
	kinds(stronghold.events) == "ground corlab corllt", kinds(stronghold.events))
check("the compound's wall ring stands at the start",
	strongGround(2400 - 192, 2400) == 48 and strongGround(2400, 2400 + 192) == 48,
	tostring(strongGround(2400 - 192, 2400)))
check("the outpost's hill is not there until the trigger places it", strongGround(1600, 2400) == 0)
for frame = 1, 60 * 30 + 1 do
	stronghold.env:GameFrame(frame)
end
check("the trigger raises the outpost's hill, then places its turret",
	strongGround(1600, 2400) == 32 and kinds(stronghold.events) == "ground corlab corllt ground corllt",
	kinds(stronghold.events))

--------------------------------------------------------------------------------
-- An engine with no SetHeightMapFunc.
--------------------------------------------------------------------------------

local flat = started({ buildings = { corlab = true }, noHeightMap = true })
check("with no SetHeightMapFunc the base is still placed", #flat.alive() == 2, #flat.alive() .. " units")
check("and the missing call is said once",
	logged(flat, "no Spring.SetHeightMapFunc") and flat.env.Spring.GetGroundHeight(1024, 1024) == 0)

support.report()
