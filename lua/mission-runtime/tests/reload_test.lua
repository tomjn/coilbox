-- Proves what a mission keeps when `/luarules reload` loads the runtime again in
-- the middle of it (issue #4147): its actors, its invulnerable units, its
-- anchors, its variables and objectives, the triggers that had already fired,
-- how it ended, what its teams are paid and what it unlocked. Run it with:
--
--   luajit lua/mission-runtime/tests/reload_test.lua
--
-- A reload keeps what the engine holds, which is units, game rules params and
-- team resources, and drops everything the gadget held in its own variables. The
-- stub models that with `options.survivors`: the second engine is a new Lua
-- state with the first one's units and rules params. Every check below that a
-- piece of state survived would fail without the runtime writing it down.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- The first def does nothing, because that is what the runtime anchors a human's
-- team with. The builder is there so there is a def an unlock can free.
local DEFS = {
	{ name = "marker", speed = 0, weapons = {} },
	{ name = "grunt" },
	{ name = "nuke", speed = 0 },
}

local PLAYERS = { [0] = { team = 0 } }

local RELOAD_FRAME = 40

--- A trigger that runs `actions` once, on the first polled tick after `seconds`.
local function once(id, actions, extra)
	local trigger = {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = actions,
	}
	for key, value in pairs(extra or {}) do
		trigger[key] = value
	end
	return trigger
end

local MISSION = compiled({
	teams = {
		player = { team = 0 },
		enemy = { team = 1, noCommander = true },
	},
	actors = {
		{
			id = "hero",
			unitDef = "grunt",
			team = "enemy",
			pos = { x = 100, z = 100 },
			facing = 0,
			state = { invulnerable = true },
		},
		{
			id = "scout",
			unitDef = "grunt",
			team = "enemy",
			pos = { x = 200, z = 100 },
			facing = 0,
			state = { unselectable = true },
		},
	},
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	vars = { counter = 5, pulses = 0 },
	objectives = {
		{ id = "first", kind = "primary", text = "Happens once.", hidden = false },
		{ id = "second", kind = "primary", text = "Never happens.", hidden = false },
	},
	triggers = {
		once("tally", {
			{ type = "add_var", params = { name = "counter", value = 1 } },
			{ type = "complete_objective", params = { objective = "first" } },
			{ type = "enable_trigger", params = { trigger = "later" } },
			{ type = "set_income", params = { team = "player", metal = 9 } },
			{ type = "unlock_unit", params = { unitDef = "nuke", team = "player" } },
		}),
		-- Off until `tally` turns it on, and far from firing.
		once("later", {
			{ type = "add_var", params = { name = "counter", value = 100 } },
		}, {
			enabled = false,
			conditions = {
				op = "all",
				conditions = { { type = "time_elapsed", params = { seconds = 3600 } } },
			},
		}),
		-- Repeats, with a ten second cooldown that is still running at the reload.
		once("pulse", {
			{ type = "add_var", params = { name = "pulses", value = 1 } },
		}, { ["repeat"] = true, cooldown = 10 }),
	},
})

local OPTIONS = {
	defList = DEFS,
	players = PLAYERS,
	startPositions = { [0] = { x = 1000, z = 1000 } },
}

--- A mission played to the frame the reload lands on.
local function playedTo(frame)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), OPTIONS)
	engine.env:Initialize()
	engine.env:GameStart()
	for f = 1, frame do
		engine.env:GameFrame(f)
	end
	return engine
end

--- The same game with the gadget loaded again, as `/luarules reload` does it.
local function reloaded(before, mission)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission or MISSION), {
		defList = OPTIONS.defList,
		players = OPTIONS.players,
		startPositions = OPTIONS.startPositions,
		frame = RELOAD_FRAME,
		survivors = before,
	})
	engine.env:Initialize()
	return engine
end

--- Run on from the reload.
local function playOn(engine, frames)
	for f = RELOAD_FRAME + 1, RELOAD_FRAME + frames do
		engine.env:GameFrame(f)
	end
end

--- What the gadget does to the damage a unit is about to take: 0 for none, nil
-- for no opinion. Bound to one value, because the callin returns nothing at all
-- for a unit it has no opinion on.
local function damageTo(engine, unitID)
	local damage = engine.env:UnitPreDamaged(unitID)
	return damage
end

local function anchorOf(engine)
	local mission = engine.GG.CoilboxMission
	for unitID in pairs(engine.units) do
		if mission.gameOver.isAnchor(unitID) then
			return unitID
		end
	end
end

--------------------------------------------------------------------------------
-- Before the reload: what the second half of this file is held against.
--------------------------------------------------------------------------------

local before = playedTo(RELOAD_FRAME)
local first = before.GG.CoilboxMission
local hero, scout = first.units.hero, first.units.scout
local anchor = anchorOf(before)

check("the mission has run to the reload with its trigger fired",
	first.vars.get("counter") == 6 and first.triggers:isEnabled("tally") == false)
check("and an anchor, an actor and an invulnerable one on the map",
	anchor ~= nil and hero ~= nil and scout ~= nil)

--------------------------------------------------------------------------------
-- Actors.
--------------------------------------------------------------------------------

local after = reloaded(before)
local published = after.GG.CoilboxMission

check("an actor is still the unit it was after a reload",
	published.units.scout == scout and published.units.hero == hero,
	tostring(published.units.scout) .. "/" .. tostring(published.units.hero))
check("and the rules param a panel reads says so",
	after.rulesParams.coilbox_mission_actor_scout == scout
		and after.rulesParams.coilbox_mission_actor_hero == hero)
check("a reload spawns nothing", #after.alive() == #before.alive(), #after.alive())

after.env.Spring.DestroyUnit(scout)
check("an actor killed after a reload is dead to the mission",
	published.units.scout == nil and after.rulesParams.coilbox_mission_actor_scout == 0)

-- The unsynced half is loaded after the synced one, so nothing sent from
-- Initialize reaches it. It hears when the first frame runs.
after = reloaded(before)
check("nothing is sent to the unsynced half while the gadget is still loading",
	#after.sent == 0, #after.sent)
playOn(after, 1)
local told = {}
for _, message in ipairs(after.sent) do
	if message[1] == "coilbox_mission_actor" then
		told[message[2]] = message[3]
	end
end
check("the unsynced half is told which unit each actor is on the first frame",
	told.hero == hero and told.scout == scout)
local unsynced = load({ coilbox_mission = "demo" }, missionFiles(MISSION), { synced = false })
unsynced.env:Initialize()
for _, message in ipairs(after.sent) do
	unsynced.env:RecvFromSynced(unpack(message))
end
check("and an unselectable actor can be clicked no better than before",
	unsynced.noSelect[scout] == true)

-- An actor that was already dead stays dead, with nothing said about it.
local killed = playedTo(RELOAD_FRAME)
killed.env.Spring.DestroyUnit(killed.GG.CoilboxMission.units.scout)
after = reloaded(killed)
check("an actor that died before the reload is still dead",
	after.GG.CoilboxMission.units.scout == nil and after.rulesParams.coilbox_mission_actor_scout == 0)
check("and is not reported as lost", not logged(after, "scout"))

-- A unit id the engine has handed to something else since is not the actor.
local reused = playedTo(RELOAD_FRAME)
reused.rulesParams.coilbox_mission_actor_scout = reused.spawn("nuke", 0)
after = reloaded(reused)
check("a unit id that is now another kind of unit is not taken for the actor",
	after.GG.CoilboxMission.units.scout == nil and after.rulesParams.coilbox_mission_actor_scout == 0)
check("and the log names the actor it could not keep", logged(after, "warning: actor scout"))

--------------------------------------------------------------------------------
-- Invulnerable units.
--------------------------------------------------------------------------------

after = reloaded(before)
check("an invulnerable actor still takes no damage after a reload",
	damageTo(after, hero) == 0, tostring(damageTo(after, hero)))
check("and a unit that is not invulnerable still takes its damage",
	damageTo(after, scout) == nil)
after.env.Spring.DestroyUnit(hero)
check("an invulnerable actor's protection does not outlive it",
	damageTo(after, hero) == nil)

--------------------------------------------------------------------------------
-- Anchors.
--------------------------------------------------------------------------------

after = reloaded(before)
published = after.GG.CoilboxMission
check("the unit holding a team open is still an anchor after a reload",
	published.gameOver.isAnchor(anchor) == true)
check("so a count of the team's units still leaves it out",
	published.gameOver.anchorCount(0) == 1, published.gameOver.anchorCount(0))
check("and it still takes no damage", damageTo(after, anchor) == 0,
	tostring(damageTo(after, anchor)))
check("a reload does not place a second one", #after.alive() == #before.alive())

after.env:TeamDied(0)
check("the team dying under it is still reported as the anchor failing",
	logged(after, "team 0 died while the mission was still running"))
after.env.Spring.DestroyUnit(anchor)
check("and so is losing the anchor", logged(after, "the mission anchor for team 0 was destroyed"))

-- An anchor the engine no longer has is said, not rebuilt behind the scenes.
local lost = playedTo(RELOAD_FRAME)
lost.env.Spring.DestroyUnit(anchor)
after = reloaded(lost)
check("an anchor that is gone by the reload is not counted",
	after.GG.CoilboxMission.gameOver.anchorCount(0) == 0)

--------------------------------------------------------------------------------
-- Variables.
--------------------------------------------------------------------------------

after = reloaded(before)
published = after.GG.CoilboxMission
check("a variable keeps the number it had reached", published.vars.get("counter") == 6,
	tostring(published.vars.get("counter")))
check("and its mirror says the same", after.rulesParams.coilbox_mission_var_counter == 6)
published.vars.add("counter", 1)
check("and carries on from there", published.vars.get("counter") == 7)

--------------------------------------------------------------------------------
-- Objectives.
--------------------------------------------------------------------------------

after = reloaded(before)
published = after.GG.CoilboxMission
check("a settled objective stays settled", published.objectives.get("first") == "complete",
	tostring(published.objectives.get("first")))
check("and an open one stays open", published.objectives.get("second") == "active")
published.objectives.fail("first")
check("a settled objective still cannot be settled again",
	published.objectives.get("first") == "complete")
published.objectives.fail("second")
check("and an open one still can", published.objectives.get("second") == "failed")

--------------------------------------------------------------------------------
-- Triggers.
--------------------------------------------------------------------------------

after = reloaded(before)
published = after.GG.CoilboxMission
check("a trigger that had fired does not fire again",
	published.triggers:isEnabled("tally") == false)
check("a trigger another one switched on stays on", published.triggers:isEnabled("later") == true)
playOn(after, 30)
check("and the mission carries on without running the spent one again",
	published.vars.get("counter") == 6, tostring(published.vars.get("counter")))
check("a repeating trigger's cooldown survives too",
	published.triggers.byId.pulse.readyFrame == first.triggers.byId.pulse.readyFrame
		and first.triggers.byId.pulse.readyFrame > RELOAD_FRAME,
	tostring(published.triggers.byId.pulse.readyFrame) .. " wanted "
		.. tostring(first.triggers.byId.pulse.readyFrame))
check("and it did not fire in the meantime", published.vars.get("pulses") == 1,
	tostring(published.vars.get("pulses")))

--------------------------------------------------------------------------------
-- How the mission ended.
--------------------------------------------------------------------------------

local ENDING = compiled({
	teams = MISSION.teams,
	vars = { counter = 0 },
	triggers = {
		once("win", { { type = "victory", params = { team = "player" } } }),
		-- Armed the whole time, so a mission that forgot it had ended would run it.
		{
			id = "count",
			enabled = true,
			["repeat"] = true,
			cooldown = 0,
			conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
			actions = { { type = "add_var", params = { name = "counter", value = 1 } } },
		},
	},
})
local ended = load({ coilbox_mission = "demo" }, missionFiles(ENDING), OPTIONS)
ended.env:Initialize()
ended.env:GameStart()
for f = 1, 20 do
	ended.env:GameFrame(f)
end
after = reloaded(ended, ENDING)
published = after.GG.CoilboxMission
check("a mission that had ended is still over after a reload", published.gameOver.isOver() == true)
check("and its outcome is still where the debrief reads it",
	after.rulesParams.coilbox_mission_over == 1)
local counted = published.vars.get("counter")
playOn(after, 30)
check("and nothing in it runs again", published.vars.get("counter") == counted
	and #after.gameOver == 0)

--------------------------------------------------------------------------------
-- What a team is paid, and what it was allowed to build.
--------------------------------------------------------------------------------

after = reloaded(before)
published = after.GG.CoilboxMission
check("income a trigger set stays set", published.economy.income("player").metal == 9,
	tostring(published.economy.income("player").metal))
check("and so does one the scenario never mentioned", published.economy.income("enemy").energy == 0)
check("a def a trigger unlocked stays unlocked",
	published.restrictions.allowsBuild(after.env.UnitDefNames.nuke.id, 0) == true)
check("while the other team is still refused it",
	published.restrictions.allowsBuild(after.env.UnitDefNames.nuke.id, 1) == false)

--------------------------------------------------------------------------------
-- What cannot be kept is said.
--------------------------------------------------------------------------------

after = reloaded(before)
check("a reload says it happened, and at which frame",
	logged(after, "warning: mission demo was reloaded into a running game at frame " .. RELOAD_FRAME))
check("and names what the runtime could not keep", logged(after, "Not kept:")
	and logged(after, "which units are in a group")
	and logged(after, "how long a zone has been held"))

local fresh = playedTo(1)
check("a mission that is not reloaded says nothing of the kind",
	not logged(fresh, "reloaded into a running game"))

support.report()
