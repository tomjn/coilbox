-- Proves the mission's objectives: what one starts as, what completing and
-- failing do to it, that the first outcome is the one that sticks, and that
-- every change is readable outside synced Lua. The gadget is loaded under the
-- stub engine rather than the module on its own, because the mirror into a game
-- rules param is the only way the panel that draws these reads them. Run it
-- with:
--
--   luajit lua/mission-runtime/tests/objective_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- What a mirrored objective is called. Hard-coded rather than read off the
-- module, because this name is the contract a LuaUI panel depends on.
local PREFIX = "coilbox_mission_objective_"

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

local function objective(id, overrides)
	local record = { id = id, kind = "primary", text = "Do the thing.", hidden = false }
	for key, value in pairs(overrides or {}) do
		record[key] = value
	end
	return record
end

--- A fire-once trigger that runs `actions` on the first polled tick.
local function once(id, actions)
	return {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = actions,
	}
end

local function complete(id)
	return { type = "complete_objective", params = { objective = id } }
end

local function fail(id)
	return { type = "fail_objective", params = { objective = id } }
end

local function playing(objectives, triggers)
	local mission = compiled({ objectives = objectives, triggers = triggers })
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission))
	engine.env:Initialize()
	engine.env:GameStart()
	engine.env:GameFrame(1)
	return engine
end

--- What anything outside synced Lua reads an objective as.
local function mirrored(engine, id)
	return engine.env.Spring.GetGameRulesParam(PREFIX .. id)
end

local function stateOf(engine, id)
	return engine.GG.CoilboxMission.objectives.get(id)
end

--------------------------------------------------------------------------------
-- What an objective starts as.
--------------------------------------------------------------------------------

local engine = playing({ objective("take-keep"), objective("scout", { hidden = true }) }, {})

check("an objective starts active", stateOf(engine, "take-keep") == "active",
	tostring(stateOf(engine, "take-keep")))
check("and is readable outside synced Lua before the first frame",
	mirrored(engine, "take-keep") == 0, tostring(mirrored(engine, "take-keep")))
check("a hidden objective has a state to read too, which is what says to hide it",
	mirrored(engine, "scout") == 0, tostring(mirrored(engine, "scout")))
check("an objective the mission never declared has no state", stateOf(engine, "ghost") == nil)

--------------------------------------------------------------------------------
-- Completing and failing.
--------------------------------------------------------------------------------

engine = playing({ objective("take-keep"), objective("hold-bridge"), objective("spare") }, {
	once("won", { complete("take-keep") }),
	once("lost", { fail("hold-bridge") }),
})
engine.env:GameFrame(15)

check("completing an objective settles it", stateOf(engine, "take-keep") == "complete",
	tostring(stateOf(engine, "take-keep")))
check("and says so outside synced Lua", mirrored(engine, "take-keep") == 1,
	tostring(mirrored(engine, "take-keep")))
check("failing an objective settles it the other way", stateOf(engine, "hold-bridge") == "failed",
	tostring(stateOf(engine, "hold-bridge")))
check("and says that outside synced Lua too", mirrored(engine, "hold-bridge") == -1,
	tostring(mirrored(engine, "hold-bridge")))
check("an objective in the same mission that nothing touched is still active",
	stateOf(engine, "spare") == "active", tostring(stateOf(engine, "spare")))

--------------------------------------------------------------------------------
-- The first outcome is the one that sticks.
--
-- A repeating trigger that goes on failing an objective the player has already
-- completed would otherwise rewrite the debrief on every tick.
--------------------------------------------------------------------------------

engine = playing({ objective("take-keep") }, {
	once("won", { complete("take-keep") }),
	once("then-lost", { fail("take-keep") }),
})
engine.env:GameFrame(15)

check("an objective already settled is not settled again", stateOf(engine, "take-keep") == "complete",
	tostring(stateOf(engine, "take-keep")))
check("and the mirror keeps the first outcome", mirrored(engine, "take-keep") == 1,
	tostring(mirrored(engine, "take-keep")))
check("and the second outcome is reported", logged(engine, "objective take-keep is already complete"))

engine = playing({ objective("take-keep") }, {
	once("lost", { fail("take-keep") }),
	once("then-won", { complete("take-keep") }),
})
engine.env:GameFrame(15)
check("which way round it happened does not matter", stateOf(engine, "take-keep") == "failed",
	tostring(stateOf(engine, "take-keep")))

--------------------------------------------------------------------------------
-- An objective the mission never declared.
--
-- Unlike a var, an objective cannot be invented: its text and its kind are the
-- scenario's, and a panel has nothing to draw without them.
--------------------------------------------------------------------------------

engine = playing({ objective("take-keep") }, { once("ghost", { complete("ghost") }) })
engine.env:GameFrame(15)

check("completing an objective the mission never declared creates nothing",
	stateOf(engine, "ghost") == nil)
check("and writes no mirror", mirrored(engine, "ghost") == nil)
check("and is reported", logged(engine, "no objective named ghost in this mission"))

--------------------------------------------------------------------------------
-- The published handle, which is how a game's own actions settle an objective.
--------------------------------------------------------------------------------

engine = playing({ objective("take-keep"), objective("hold-bridge") }, {})
local objectives = engine.GG.CoilboxMission.objectives

objectives.complete("take-keep")
check("completing through the published handle settles it", stateOf(engine, "take-keep") == "complete")
check("and mirrors it", mirrored(engine, "take-keep") == 1, tostring(mirrored(engine, "take-keep")))

objectives.fail("hold-bridge")
check("failing through the published handle settles it", stateOf(engine, "hold-bridge") == "failed")
check("and mirrors it", mirrored(engine, "hold-bridge") == -1, tostring(mirrored(engine, "hold-bridge")))

--------------------------------------------------------------------------------
-- Objectives are synced only, like the triggers that settle them. The unsynced
-- half has the rules params to read instead.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" },
	missionFiles(compiled({ objectives = { objective("take-keep") } })), { synced = false })
unsynced.env:Initialize()
check("the unsynced half holds no objectives of its own",
	unsynced.GG.CoilboxMission.objectives == nil)
check("and writes no rules params either", next(unsynced.rulesParams) == nil)

support.report()
