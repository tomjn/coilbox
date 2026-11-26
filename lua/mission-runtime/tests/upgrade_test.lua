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

--------------------------------------------------------------------------------
-- A group's unit (issue #5475).
--------------------------------------------------------------------------------

local SQUADS = compiled({
	teams = {
		player = { team = 0, noCommander = true },
		enemy = { team = 1, noCommander = true },
	},
	groups = {
		{ id = "squad", team = "player", pos = { x = 1000, z = 1000 }, units = { { def = "com", count = 2 } } },
		{ id = "guards", team = "player", pos = { x = 3000, z = 3000 }, units = { { def = "com", count = 1 } },
			startsAsleep = true },
	},
	triggers = {
		watching("squadDead", { { type = "group_dead", params = { group = "squad" } } }),
		{ id = "both", enabled = true, ["repeat"] = true,
			conditions = { op = "all", conditions = { { type = "unit_count", params = { group = "squad", min = 2 } } } },
			actions = { { type = "probe", params = { mark = "both" } } } },
		watching("hit", { { type = "unit_attacked", params = { group = "squad" } } }),
	},
})

local function grouped()
	local options = { defList = DEFS }
	local run = load({ coilbox_mission = "demo" }, missionFiles(SQUADS), options)
	run.options = options
	run.env:Initialize()
	run.fired = {}
	run.GG.CoilboxMission.triggers:addAction("probe", function(params)
		run.fired[params.mark] = (run.fired[params.mark] or 0) + 1
	end)
	run.env:GameStart()
	frame(run, 1)
	return run, run.GG.CoilboxMission.groups
end

local function listed(units, wanted)
	return table.concat(units, ",") == table.concat(wanted, ","),
		table.concat(units, ",") .. " wanted " .. table.concat(wanted, ",")
end

local function orderedTo(run, unitID, cmd)
	for _, order in ipairs(run.orders) do
		if order[1] == unitID and order[2] == cmd then
			return order
		end
	end
end

local run, groups = grouped()
local first, second = unpack(groups.living("squad"))
frame(run, 10)
local firstNew = successor(run, first, "comlvl2")
destroy(run, first)
check("a group's unit upgraded in one frame is in the roster, in its old place",
	listed(groups.living("squad"), { firstNew, second }))
check("and is that group's", groups.of(firstNew) == "squad" and groups.of(first) == nil)
local secondNew = successor(run, second, "comlvl2")
frame(run, 11)
destroy(run, second)
check("and one whose old unit goes on the next frame is too",
	listed(groups.living("squad"), { firstNew, secondNew }))
run.fired.both = nil
for f = 12, 60 do
	frame(run, f)
end
check("a group upgraded whole is not dead", not fired(run, "squadDead"))
check("unit_count counts the new units", fired(run, "both"))
run.env:UnitDamaged(firstNew, run.units[firstNew].defID, 0, 5, 1, 1, 1, 99, run.units[firstNew].defID, 1)
frame(run, 90)
check("unit_attacked hears a hit on the new unit", fired(run, "hit"))
run.orders = {}
groups.orders("squad", { { kind = "move", waypoints = { { x = 10, z = 10 } } } })
check("an order to the group reaches the new units",
	orderedTo(run, firstNew, run.env.CMD.MOVE) and orderedTo(run, secondNew, run.env.CMD.MOVE))
destroy(run, firstNew)
destroy(run, secondNew)
for f = 91, 120 do
	frame(run, f)
end
check("upgraded units that die with nothing in their place leave the group dead",
	#groups.living("squad") == 0 and fired(run, "squadDead"))

run, groups = grouped()
local guard = groups.living("guards")[1]
run.units[guard].movestate = nil
frame(run, 10)
local fresh = successor(run, guard, "comlvl2")
run.orders = {}
destroy(run, guard)
local held = orderedTo(run, fresh, run.env.CMD.MOVE_STATE)
check("a sleeping group's new unit is told to hold position",
	held and held[3][1] == run.env.CMD.MOVESTATE_HOLDPOS)
run.orders = {}
groups.wake("guards")
local woken = orderedTo(run, fresh, run.env.CMD.MOVE_STATE)
check("and waking gives it the move state the old unit came with",
	woken and woken[3][1] == run.env.CMD.MOVESTATE_MANEUVER, woken and tostring(woken[3][1]))

run, groups = grouped()
first, second = unpack(groups.living("squad"))
groups.release("squad")
frame(run, 10)
firstNew = successor(run, first, "comlvl2")
run.orders = {}
destroy(run, first)
check("a released group keeps its upgraded unit", listed(groups.living("squad"), { firstNew, second }))
check("and still does not command it", #groups.units("squad") == 0 and #run.orders == 0)

run, groups = grouped()
first, second = unpack(groups.living("squad"))
groups.gift("squad", "enemy")
frame(run, 10)
firstNew = successor(run, first, "comlvl2")
destroy(run, first)
check("a gifted group's unit is followed on the team that has it now",
	listed(groups.living("squad", 1), { firstNew, second }))

run, groups = grouped()
first, second = unpack(groups.living("squad"))
successor(run, first, "comlvl2")
successor(run, first, "com")
destroy(run, first)
check("with two units that could replace it, a group's unit just leaves",
	listed(groups.living("squad"), { second }))

support.report()
