-- Proves the two conditions runtime 8 added, driven by the `drill` scenario
-- fixture so the shapes under test are the ones coilbox actually emits. Run it
-- with:
--
--   luajit lua/mission-runtime/tests/drill_test.lua
--
-- What is covered here:
--
--   unit_selected   any unit, a placed unit, a unit type, and whose selection
--   command_given   any order, one command, a build of one type, and the order
--                   that answered one trigger not answering the next
--   the route       a client's unsynced half reports its selection in a Lua
--                   message, and the synced half reads it without trusting it
--
-- Two stub engines stand for one machine's two halves. The unsynced one is the
-- player's client and the synced one is the game, and the test carries the
-- message between them the way the server does.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load = support.check, support.load
local missionFiles, fixture, compiled = support.missionFiles, support.fixture, support.compiled

local PREFIX = "coilbox_mission_selection:"

local DEFS = {
	{ name = "marker", speed = 0, weapons = {} },
	{ name = "armck" }, { name = "armpw" }, { name = "armsolar" }, { name = "armlab" },
}

-- Player 0 is the human on team 0, player 1 hosts the AI on team 1, and player
-- 5 is watching.
local PLAYERS = { [0] = { team = 0 }, [1] = { team = 1 }, [5] = { team = 0, spectator = true } }

--- The game: the synced half, loaded and started.
local function playing(mission)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), {
		startPositions = { [0] = { x = 500, z = 500 }, [1] = { x = 100, z = 100 } },
		defList = DEFS,
		players = PLAYERS,
		aiTeams = { [1] = true },
	})
	engine.env:Initialize()
	engine.env:GameStart()
	return engine, engine.GG.CoilboxMission
end

--- A client: the unsynced half, told which unit each actor became the way the
-- synced half tells it. The units are made in the order the game made them, so
-- both halves know them by the same ids.
local function client(mission, game, options)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), {
		synced = false,
		defList = DEFS,
		spectating = options and options.spectating,
	})
	engine.env:Initialize()
	for _, unitID in ipairs(game.order) do
		local unit = game.units[unitID]
		engine.spawn(unit.def, unit.team)
	end
	for _, entry in ipairs(game.sent) do
		engine.env:RecvFromSynced(entry[1], entry[2], entry[3], entry[4], entry[5])
	end
	return engine
end

--- Have the client's player select these units, and carry whatever it reports
-- to the game. Returns the report, or nil when the client sent none.
local function choose(player, game, unitIDs)
	local before = #player.luaRulesMsgs
	player.selected = unitIDs
	player.env:Update()
	local message = player.luaRulesMsgs[before + 1]
	if message then
		game.env:RecvLuaMsg(message, 0)
	end
	return message
end

--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(engine, from, frame)
	for at = from, frame do
		engine.env:GameFrame(at)
	end
	return frame
end

local DRILL = fixture("drill")

local game, state = playing(DRILL)
local player = client(DRILL, game)
local engineer, scout = state.units.engineer, state.units.scout
local objective = state.objectives.get

local at = playTo(game, 1, 20)
check("nothing is selected, so no selection objective has moved",
	objective("pick") == "active" and objective("engineer") == "active")
check("and a client with nothing selected has reported nothing",
	#player.luaRulesMsgs == 0, #player.luaRulesMsgs)

--------------------------------------------------------------------------------
-- unit_selected, and the message that carries it.
--------------------------------------------------------------------------------

local message = choose(player, game, { scout })
check("selecting a unit sends one report naming it",
	message == PREFIX .. scout, tostring(message))
check("which the any-unit condition hears at once, with no poll in between",
	objective("pick") == "complete", objective("pick"))
check("and the placed-unit condition does not, because that is another unit",
	objective("engineer") == "active", objective("engineer"))

player.env:Update()
check("a selection that has not changed is not reported again",
	#player.luaRulesMsgs == 1, #player.luaRulesMsgs)

check("a message that is not a selection report is left for whoever it is for",
	game.env:RecvLuaMsg("another_gadget:" .. engineer, 0) == nil)

game.env:RecvLuaMsg(PREFIX .. engineer, 5)
check("a spectator's report is dropped",
	objective("engineer") == "active", objective("engineer"))

game.env:RecvLuaMsg(PREFIX .. engineer, 1)
check("and so is a unit the sender does not own, whatever the report claims",
	objective("engineer") == "active", objective("engineer"))

-- The drill watches one unit type and one placed unit, so a report carries at
-- most three units. The engineer is the fourth here.
game.env:RecvLuaMsg(PREFIX .. table.concat({ scout, scout, scout, engineer }, ","), 0)
check("no more units are read out of a report than one can carry",
	objective("engineer") == "active", objective("engineer"))

--------------------------------------------------------------------------------
-- command_given, before the trigger that waits on it is armed.
--------------------------------------------------------------------------------

local CMD = game.env.CMD
local solar = game.env.UnitDefNames["armsolar"].id
local lab = game.env.UnitDefNames["armlab"].id

game.command(scout, CMD.MOVE, 0)
check("a move order given before its trigger is armed completes nothing",
	objective("move") == "active", objective("move"))

message = choose(player, game, { scout, engineer })
check("selecting the engineer as well reports both, lowest id first",
	message == PREFIX .. engineer .. "," .. scout, tostring(message))
check("and the placed-unit condition holds", objective("engineer") == "complete", objective("engineer"))
check("which armed the move lesson", state.triggers:isEnabled("order-move") == true)

at = playTo(game, at + 1, at + 30)
check("the move given before the lesson was armed still does not answer it",
	objective("move") == "active", objective("move"))

--------------------------------------------------------------------------------
-- command_given, armed.
--------------------------------------------------------------------------------

game.command(engineer, CMD.MOVE, 0, true)
check("an order synced Lua gave is not the player's",
	objective("move") == "active", objective("move"))

local rival = game.spawn("armpw", 1)
game.command(rival, CMD.MOVE, 1)
check("nor is an AI's, which the engine files under the player hosting it",
	objective("move") == "active", objective("move"))

game.command(engineer, CMD.PATROL, 0)
check("nor is a different command",
	objective("move") == "active", objective("move"))

game.command(engineer, CMD.MOVE, 0)
check("a move order from the player completes the lesson at once",
	objective("move") == "complete", objective("move"))
check("and arms the next one, which the same order does not answer",
	state.triggers:isEnabled("order-again") == true and objective("again") == "active",
	objective("again"))

at = playTo(game, at + 1, at + 30)
check("not on the polled beat either", objective("again") == "active", objective("again"))

game.command(engineer, CMD.MOVE, 0)
check("a second move order does", objective("again") == "complete", objective("again"))

--------------------------------------------------------------------------------
-- A build order, and the two conditions together.
--------------------------------------------------------------------------------

choose(player, game, {})
game.command(engineer, -solar, 0)
check("a build order is counted by the repeating trigger",
	state.vars.get("orders") == 1, tostring(state.vars.get("orders")))
check("with nothing selected, the trigger that also wants a builder selected waits",
	objective("solar") == "active", objective("solar"))

game.command(engineer, -lab, 0)
check("a second build order is counted again, each one once",
	state.vars.get("orders") == 2, tostring(state.vars.get("orders")))

choose(player, game, { engineer })
check("selecting a builder completes it, the order having been given since it was armed",
	objective("solar") == "complete", objective("solar"))

at = playTo(game, at + 1, 330)
check("an order was given, so the negated condition never held",
	objective("prompt") == "active", objective("prompt"))

--------------------------------------------------------------------------------
-- The same mission with the player sitting on their hands.
--------------------------------------------------------------------------------

game, state = playing(DRILL)
playTo(game, 1, 330)
check("with no order given in ten seconds, the negated condition holds",
	state.objectives.get("prompt") == "failed", state.objectives.get("prompt"))

--------------------------------------------------------------------------------
-- What a report carries, and who sends one.
--------------------------------------------------------------------------------

game, state = playing(DRILL)
playTo(game, 1, 5)
local second = game.spawn("armck", 0)
local third = game.spawn("armck", 0)
player = client(DRILL, game)
message = choose(player, game, { third, second, state.units.scout })
check("a report names one unit of a watched type and the first selected, not the whole selection",
	message == PREFIX .. third, tostring(message))

local watcher = client(DRILL, game, { spectating = true })
check("a spectating client sends nothing, which is what a replay viewer is",
	choose(watcher, game, { state.units.scout }) == nil)

--------------------------------------------------------------------------------
-- A unit already selected when the trigger that asks is armed.
--------------------------------------------------------------------------------

local LATE = compiled({
	runtimeVersion = 8,
	teams = { player = { team = 0 } },
	actors = {
		{ id = "engineer", unitDef = "armck", team = "player", pos = { x = 1000, z = 1000 }, facing = 0 },
	},
	triggers = {
		{
			id = "later",
			enabled = true,
			conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 2 } } } },
			actions = { { type = "enable_trigger", params = { trigger = "selected" } } },
		},
		{
			id = "selected",
			enabled = false,
			conditions = { op = "all", conditions = { { type = "unit_selected", params = {} } } },
			actions = {},
		},
	},
})

game, state = playing(LATE)
player = client(LATE, game)
at = playTo(game, 1, 10)
choose(player, game, { state.units.engineer })
at = playTo(game, at + 1, 60)
check("the trigger is armed two seconds in, with the unit selected all along",
	state.triggers:isEnabled("selected") == true)
playTo(game, at + 1, 75)
check("and fires on the next polled beat, with no new report to wake it",
	state.triggers:isEnabled("selected") == false)

--------------------------------------------------------------------------------
-- A mission that asks neither question pays for neither.
--------------------------------------------------------------------------------

local FOUNDRY = fixture("foundry")
game = playing(FOUNDRY)
check("a mission with no command_given defines no UnitCommand callin",
	rawget(game.env, "UnitCommand") == nil)
check("and one with no unit_selected defines no RecvLuaMsg",
	rawget(game.env, "RecvLuaMsg") == nil)
player = client(FOUNDRY, game)
check("nor an Update in the unsynced half",
	rawget(player.env, "Update") == nil)

support.report()
