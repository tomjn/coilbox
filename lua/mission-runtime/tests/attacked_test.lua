-- Proves when unit_attacked holds (issue #5298): a hit on a named actor, a named
-- base building or a group's unit, narrowed by who did it, counted from when the
-- trigger was armed or last fired. Run it with:
--
--   luajit lua/mission-runtime/tests/attacked_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

--- A trigger that marks `id` each time it fires.
local function watching(id, conditions, options)
	local trigger = {
		id = id,
		enabled = true,
		["repeat"] = true,
		conditions = { op = "all", conditions = conditions },
		actions = { { type = "probe", params = { mark = id } } },
	}
	for key, value in pairs(options or {}) do
		trigger[key] = value
	end
	return trigger
end

local function attacked(params)
	return { type = "unit_attacked", params = params }
end

local OPEN = { type = "var", params = { name = "open", op = "eq", value = 1 } }

local function actor(id, team, state)
	return { id = id, unitDef = "armsolar", team = team, pos = { x = 100, z = 100 }, facing = 0, state = state }
end

local function squad(id, extra)
	local group = {
		id = id,
		team = "player",
		pos = { x = 500, z = 500 },
		units = { { def = "armpw", count = 2 } },
		orders = {},
	}
	for key, value in pairs(extra or {}) do
		group[key] = value
	end
	return group
end

local function started(mission, options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), options or {})
	engine.env:Initialize()
	engine.fired = {}
	engine.GG.CoilboxMission.triggers:addAction("probe", function(params)
		engine.fired[params.mark] = (engine.fired[params.mark] or 0) + 1
	end)
	engine.env:GameStart()
	engine.env:GameFrame(1)
	return engine
end

local function times(engine, id)
	return engine.fired[id] or 0
end

--------------------------------------------------------------------------------
-- A mission that asks nothing defines nothing.
--------------------------------------------------------------------------------

local quiet = started(compiled({
	teams = { player = { team = 0 } },
	actors = { actor("outpost", "player") },
	triggers = { watching("dead", { { type = "unit_dead", params = { actor = "outpost" } } }) },
}))
check("a mission with no unit_attacked condition defines no UnitDamaged", quiet.env.UnitDamaged == nil)

--------------------------------------------------------------------------------
-- Who was hit, and by whom.
--------------------------------------------------------------------------------

local engine = started(compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	actors = {
		actor("outpost", "player"),
		actor("depot", "player"),
		actor("statue", "player", { invulnerable = true }),
	},
	prefabs = {
		{
			id = "keep",
			team = "player",
			origin = { x = 900, z = 900 },
			buildings = { { id = "factory", def = "armlab", offset = { x = 0, z = 0 } } },
		},
	},
	groups = { squad("convoy"), squad("wave", { dormant = true }) },
	triggers = {
		watching("any", { attacked({ actor = "outpost" }) }),
		watching("by-enemy", { attacked({ actor = "outpost", attackerTeam = "enemy" }) }),
		watching("by-player", { attacked({ actor = "outpost", attackerTeam = "player" }) }),
		watching("by-nobody-known", { attacked({ actor = "outpost", attackerTeam = "ghost" }) }),
		watching("by-llt", { attacked({ actor = "outpost", attackerDefs = { "armllt" } }) }),
		watching("by-pw", { attacked({ actor = "outpost", attackerDefs = { "armpw" } }) }),
		watching("by-either", { attacked({ actor = "outpost", attackerDefs = { "armpw", "armllt" } }) }),
		watching("empty-defs", { attacked({ actor = "outpost", attackerDefs = {} }) }),
		watching("enemy-pw", {
			attacked({ actor = "outpost", attackerTeam = "enemy", attackerDefs = { "armpw" } }),
		}),
		watching("statue", { attacked({ actor = "statue" }) }),
		watching("factory", { attacked({ actor = "factory" }) }),
		watching("convoy", { attacked({ group = "convoy" }) }),
		watching("wave", { attacked({ group = "wave" }) }),
		watching("group-over-actor", { attacked({ group = "convoy", actor = "depot" }) }),
		watching("no-group", { attacked({ group = "nosuchgroup" }) }),
	},
}))
check("a mission with a unit_attacked condition defines UnitDamaged", engine.env.UnitDamaged ~= nil)

local units = engine.GG.CoilboxMission.units
local llt = engine.spawn("armllt", 1)
local own = engine.spawn("armllt", 0)

local function reset()
	engine.fired = {}
end

engine.damage(units.outpost, 10, nil)
check("damage with no attacker does not count", times(engine, "any") == 0, times(engine, "any"))

engine.damage(units.outpost, 0, llt)
engine.damage(units.outpost, -10, llt)
check("nor does a hit that does no damage, or one that heals", times(engine, "any") == 0, times(engine, "any"))

engine.damage(units.outpost, 10, llt)
check("a hit fires on the frame it lands", times(engine, "any") == 1, times(engine, "any"))
check("attackerTeam counts that team's hits", times(engine, "by-enemy") == 1)
check("and nobody else's", times(engine, "by-player") == 0)
check("an attackerTeam the mission has no engine team for never holds", times(engine, "by-nobody-known") == 0)
check("attackerDefs counts those unit types", times(engine, "by-llt") == 1 and times(engine, "by-either") == 1)
check("and no others", times(engine, "by-pw") == 0)
check("an empty attackerDefs counts every type", times(engine, "empty-defs") == 1)
check("a hit on one unit says nothing about another",
	times(engine, "statue") == 0 and times(engine, "factory") == 0 and times(engine, "convoy") == 0)

engine.env:GameFrame(15)
check("the hit is used up by the firing", times(engine, "any") == 1, times(engine, "any"))

engine.damage(units.outpost, 10, llt)
check("a repeating trigger fires again on the next hit", times(engine, "any") == 2, times(engine, "any"))

reset()
engine.damage(units.outpost, 10, own)
check("friendly fire counts when no attackerTeam is named", times(engine, "any") == 1)
check("and not for another team's attackerTeam",
	times(engine, "by-enemy") == 0 and times(engine, "by-player") == 1)

reset()
local raider = engine.spawn("armpw", 0)
engine.damage(units.outpost, 10, raider)
check("both filters have to match the same hit", times(engine, "enemy-pw") == 0 and times(engine, "by-pw") == 1,
	times(engine, "enemy-pw") .. "/" .. times(engine, "by-pw"))

reset()
engine.damage(units.outpost, 10, llt, true)
check("a paralysing hit counts", times(engine, "any") == 1)

reset()
engine.damage(units.statue, 10, llt)
check("an invulnerable actor takes no damage, so it is never attacked", times(engine, "statue") == 0)

engine.damage(units.factory, 10, llt)
check("a named base building is a target", times(engine, "factory") == 1)

local convoy = engine.GG.CoilboxMission.groups.units("convoy")
local first, second = convoy[1], convoy[2]
engine.damage(first, 10, llt)
engine.damage(second, 10, llt)
check("a hit on any unit of a group counts", times(engine, "convoy") == 2, times(engine, "convoy"))
check("and not for another group", times(engine, "wave") == 0)

reset()
engine.damage(units.depot, 10, llt)
check("a group takes the place of an actor", times(engine, "group-over-actor") == 0)

reset()
engine.GG.CoilboxMission.groups.gift("convoy", "enemy")
engine.damage(first, 10, llt)
engine.GG.CoilboxMission.groups.release("convoy")
engine.damage(second, 10, llt)
check("a gifted and a released unit are still the group's", times(engine, "convoy") == 2, times(engine, "convoy"))

engine.GG.CoilboxMission.groups.spawn("wave")
engine.damage(engine.GG.CoilboxMission.groups.units("wave")[1], 10, llt)
check("a group spawned mid-mission is heard", times(engine, "wave") == 1)

check("a group the scenario does not have is reported",
	times(engine, "no-group") == 0 and logged(engine, "no group named nosuchgroup"))

--------------------------------------------------------------------------------
-- When a hit counts: from arming, and spent by firing.
--------------------------------------------------------------------------------

local timing = started(compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	vars = { open = 0 },
	actors = { actor("outpost", "player") },
	triggers = {
		watching("once", { attacked({ actor = "outpost" }) }, { ["repeat"] = false }),
		watching("armed-later", { attacked({ actor = "outpost" }) }, { enabled = false }),
		watching("waits", { attacked({ actor = "outpost" }), OPEN }, { ["repeat"] = false }),
		watching("on-becoming", { attacked({ actor = "outpost" }) }, { onBecomingTrue = true }),
		watching("cooling", { attacked({ actor = "outpost" }) }, { cooldown = 2 }),
		watching("never-hit", { { type = "unit_attacked", negate = true, params = { actor = "outpost" } } }, {
			["repeat"] = false,
			enabled = false,
		}),
	},
}))
local mission = timing.GG.CoilboxMission
local gun = timing.spawn("armllt", 1)

timing.damage(mission.units.outpost, 10, gun)
timing.damage(mission.units.outpost, 10, gun)
check("a fire-once trigger fires on the first hit only", times(timing, "once") == 1, times(timing, "once"))
check("onBecomingTrue fires on each hit, with no poll between",
	times(timing, "on-becoming") == 2, times(timing, "on-becoming"))
check("a cooldown holds off the second", times(timing, "cooling") == 1, times(timing, "cooling"))

mission.triggers:setEnabled("armed-later", true)
mission.triggers:setEnabled("never-hit", true)
timing.env:GameFrame(15)
check("a hit from before the trigger was armed does not count", times(timing, "armed-later") == 0)
check("so negated, it holds until the next one", times(timing, "never-hit") == 1)

timing.env:GameFrame(75)
check("a cooldown ending queues nothing", times(timing, "cooling") == 1, times(timing, "cooling"))

check("a hit alone does not fire a trigger waiting on more", times(timing, "waits") == 0)
mission.vars.set("open", 1)
timing.env:GameFrame(90)
check("and is remembered until the rest holds", times(timing, "waits") == 1, times(timing, "waits"))

timing.damage(mission.units.outpost, 10, gun)
check("the next hit reaches a trigger armed since", times(timing, "armed-later") == 1)

--------------------------------------------------------------------------------
-- The blow that kills.
--------------------------------------------------------------------------------

local last = started(compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	actors = { actor("outpost", "player") },
	triggers = {
		watching("killed-by", {
			attacked({ actor = "outpost" }),
			{ type = "unit_dead", params = { actor = "outpost" } },
		}, { ["repeat"] = false }),
	},
}))
local killer = last.spawn("armllt", 1)
local doomed = last.GG.CoilboxMission.units.outpost
last.damage(doomed, 1000, killer)
check("the actor is still alive while it is being hit", times(last, "killed-by") == 0)
last.env.Spring.DestroyUnit(doomed)
check("and the killing blow still counts once it is dead", times(last, "killed-by") == 1)

support.report()
