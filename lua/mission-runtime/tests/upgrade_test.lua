-- Proves an actor is followed through an upgrade (issue #5297): a game that
-- replaces the actor's unit with a new one where it stands, then has a script
-- destroy the old one, leaves the actor alive as the new unit. Beyond All
-- Reason's evolving commanders destroy the old unit in the same frame, and
-- Splinter Faction's morphs on the next one. Run it with:
--
--   luajit lua/mission-runtime/tests/upgrade_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load = support.check, support.load
local missionFiles, compiled = support.missionFiles, support.compiled

-- A mex is a building four squares across, which a game snaps to the build grid.
local DEFS = {
	{ name = "com" },
	{ name = "comlvl2" },
	{ name = "mex", isBuilding = true, speed = 0, xsize = 4, zsize = 4 },
	{ name = "mexlvl2", isBuilding = true, speed = 0, xsize = 4, zsize = 4 },
}

--- A trigger that marks `id` each time it fires.
local function watching(id, conditions)
	return {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = conditions },
		actions = { { type = "probe", params = { mark = id } } },
	}
end

local MISSION = compiled({
	teams = {
		player = { team = 0, noCommander = true },
		enemy = { team = 1, noCommander = true },
	},
	actors = {
		{ id = "hero", unitDef = "com", team = "player", pos = { x = 1000, z = 1000 }, facing = 0,
			state = { invulnerable = true } },
		{ id = "post", unitDef = "mex", team = "player", pos = { x = 2000, z = 2000 }, facing = 0 },
		{ id = "rival", unitDef = "com", team = "enemy", pos = { x = 3000, z = 3000 }, facing = 0 },
	},
	triggers = {
		watching("heroDead", { { type = "unit_dead", params = { actor = "hero" } } }),
		watching("postDead", { { type = "unit_dead", params = { actor = "post" } } }),
		watching("rivalDead", { { type = "unit_dead", params = { actor = "rival" } } }),
		watching("wounded", { { type = "unit_health_below", params = { actor = "hero", fraction = 0.5 } } }),
	},
})

local function started()
	local options = { defList = DEFS }
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), options)
	engine.options = options
	engine.env:Initialize()
	engine.fired = {}
	engine.GG.CoilboxMission.triggers:addAction("probe", function(params)
		engine.fired[params.mark] = (engine.fired[params.mark] or 0) + 1
	end)
	engine.env:GameStart()
	options.frame = 1
	engine.env:GameFrame(1)
	return engine
end

local function frame(engine, f)
	engine.options.frame = f
	engine.env:GameFrame(f)
end

--- What a game's upgrade makes: a new unit where the old one stands, for its
-- team, by no builder. `dx` and `dz` move it off that spot.
local function successor(engine, old, def, dx, dz, team)
	local unit = engine.units[old]
	return engine.env.Spring.CreateUnit(def, unit.x + (dx or 0), unit.y, unit.z + (dz or 0), 0, team or unit.team)
end

local function destroy(engine, unitID)
	engine.env.Spring.DestroyUnit(unitID, false, true)
end

local function fired(engine, id)
	return (engine.fired[id] or 0) > 0
end

--------------------------------------------------------------------------------
-- Beyond All Reason: the new unit made and the old one destroyed in one frame.
--------------------------------------------------------------------------------

local engine = started()
local mission = engine.GG.CoilboxMission
local old = mission.units.hero
frame(engine, 10)
local new = successor(engine, old, "comlvl2")
destroy(engine, old)
check("an actor upgraded in one frame is the new unit", mission.units.hero == new,
	tostring(mission.units.hero) .. " wanted " .. tostring(new))
check("and is not dead to the mission", not fired(engine, "heroDead"))
check("the rules param a panel reads says so", engine.rulesParams.coilbox_mission_actor_hero == new,
	tostring(engine.rulesParams.coilbox_mission_actor_hero))
check("and the upgraded def is recorded for a reload",
	engine.rulesParams.coilbox_mission_upgraded_hero == "comlvl2",
	tostring(engine.rulesParams.coilbox_mission_upgraded_hero))
local told = false
for _, message in ipairs(engine.sent) do
	if message[1] == "coilbox_mission_actor" and message[2] == "hero" and message[3] == new then
		told = true
	end
end
check("the unsynced half is told which unit the actor became", told)
check("an invulnerable actor stays invulnerable", engine.env:UnitPreDamaged(new) == 0)

engine.units[new].health = 10
for f = 11, 40 do
	frame(engine, f)
end
check("unit_health_below reads the new unit", fired(engine, "wounded"))

-- Upgraded twice, the way a commander climbs its levels.
frame(engine, 100)
local third = successor(engine, new, "com")
destroy(engine, new)
check("and is followed again through a second upgrade", mission.units.hero == third)

destroy(engine, third)
check("an upgraded actor that dies with no successor is dead", mission.units.hero == nil
	and fired(engine, "heroDead"))

--------------------------------------------------------------------------------
-- Splinter Faction: the old unit destroyed on the next frame.
--------------------------------------------------------------------------------

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
frame(engine, 10)
new = successor(engine, old, "comlvl2")
check("while the old unit stands, the actor is still it", mission.units.hero == old)
frame(engine, 11)
destroy(engine, old)
check("an actor whose old unit goes on the next frame is the new unit", mission.units.hero == new)
check("and is not dead to the mission", not fired(engine, "heroDead"))

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
frame(engine, 10)
successor(engine, old, "comlvl2")
frame(engine, 12)
destroy(engine, old)
check("a unit made two frames before the actor went does not replace it",
	mission.units.hero == nil and fired(engine, "heroDead"))

--------------------------------------------------------------------------------
-- What is not an upgrade.
--------------------------------------------------------------------------------

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
successor(engine, old, "comlvl2", 1, 0)
destroy(engine, old)
check("a unit made beside a mobile actor does not replace it", mission.units.hero == nil)

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.rival
successor(engine, old, "comlvl2", 0, 0, 0)
destroy(engine, old)
check("a unit made for another team does not replace it", mission.units.rival == nil)

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
successor(engine, old, "comlvl2")
successor(engine, old, "com")
destroy(engine, old)
check("with two units that could replace it, the actor dies",
	mission.units.hero == nil and fired(engine, "heroDead"))

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
local built = engine.spawn("comlvl2", 0, 99, { engine.units[old].x, 0, engine.units[old].z, 0 })
destroy(engine, old)
check("a unit with a builder does not replace it", mission.units.hero == nil and built ~= nil)

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
successor(engine, old, "comlvl2")
engine.units[old].alive = false
engine.env:UnitDestroyed(old, engine.units[old].defID, 0, 7, 1, 1, 3)
check("an actor killed by a weapon dies, whatever stands on its spot",
	mission.units.hero == nil and fired(engine, "heroDead"))

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
successor(engine, old, "comlvl2")
engine.units[old].alive = false
-- Ground collision damage: no attacker, and a weapon id that is not a script's.
engine.env:UnitDestroyed(old, engine.units[old].defID, 0, nil, nil, nil, -2)
check("an actor that died with no attacker to something other than a script dies",
	mission.units.hero == nil and fired(engine, "heroDead"))

-- Balanced Annihilation's gadget handler passes UnitDestroyed six arguments.
engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.hero
new = successor(engine, old, "comlvl2")
engine.units[old].alive = false
engine.env:UnitDestroyed(old, engine.units[old].defID, 0, nil, nil, nil)
check("under a handler that passes no weapon id, the successor rule decides", mission.units.hero == new)

--------------------------------------------------------------------------------
-- A building, snapped to the build grid.
--------------------------------------------------------------------------------

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.post
new = successor(engine, old, "mexlvl2", 8, -8)
destroy(engine, old)
check("a building replaced half a build square off its spot is followed", mission.units.post == new)
check("and is not dead", not fired(engine, "postDead"))

engine = started()
mission = engine.GG.CoilboxMission
old = mission.units.post
successor(engine, old, "mexlvl2", 17, 0)
destroy(engine, old)
check("one more than a build square off is not", mission.units.post == nil and fired(engine, "postDead"))

--------------------------------------------------------------------------------
-- A reload after an upgrade.
--------------------------------------------------------------------------------

local before = started()
old = before.GG.CoilboxMission.units.hero
new = successor(before, old, "comlvl2")
destroy(before, old)
local after = load({ coilbox_mission = "demo" }, missionFiles(MISSION),
	{ defList = DEFS, frame = 40, survivors = before })
after.env:Initialize()
check("a reload keeps an actor that was upgraded", after.GG.CoilboxMission.units.hero == new,
	tostring(after.GG.CoilboxMission.units.hero) .. " wanted " .. tostring(new))

support.report()
