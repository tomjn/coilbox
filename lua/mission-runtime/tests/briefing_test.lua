-- Proves what runtime 9 added, driven by the `briefing` scenario fixture so the
-- shapes under test are the ones coilbox actually emits. Run it with:
--
--   luajit lua/mission-runtime/tests/briefing_test.lua
--
-- What is covered here:
--
--   pause_game, unpause_game   the request reaches the client, a client that may
--                              not pause sends nothing, and a game with two
--                              players is left alone
--   a held line                the flag crosses to LuaUI, the panel keeps the
--                              line until it is dismissed, and a game with no
--                              panel dismisses it for the player
--   dialogue_dismissed         the dismissal is read without being trusted, and
--                              wakes event and polled triggers with no game
--                              frame in between, which is what a paused game is
--
-- The stub has no server and no clock. Not sending a game frame is how a test
-- here says the game is paused.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged, sent = support.check, support.load, support.logged, support.sent
local missionFiles, fixture = support.missionFiles, support.fixture

local MODEL = dofile(support.root() .. "/luaui/mission_ui/coilbox_panel_model.lua")

-- Hard-coded rather than read off the runtime, because each one is a contract.
local DIALOGUE_MESSAGE = "coilbox_mission_dialogue"
local PAUSE_MESSAGE = "coilbox_mission_pause"
local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"
local DISMISSED = "coilbox_mission_dismissed:"

local BRIEFING = fixture("briefing")

-- Player 0 is the human and player 5 is watching.
local ALONE = { [0] = { team = 0 }, [5] = { team = 0, spectator = true } }

local function playing(players)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(BRIEFING), {
		startPositions = { [0] = { x = 500, z = 500 }, [1] = { x = 100, z = 100 } },
		players = players or ALONE,
		aiTeams = { [1] = true },
	})
	engine.env:Initialize()
	engine.env:GameStart()
	for frame = 1, 30 do
		engine.env:GameFrame(frame)
	end
	return engine, engine.GG.CoilboxMission
end

local function client(options)
	options = options or {}
	options.synced = false
	local engine = load({ coilbox_mission = "demo" }, missionFiles(BRIEFING), options)
	engine.env:Initialize()
	return engine
end

--- Every message of one kind the synced half sent, as its whole argument list.
local function messages(engine, kind)
	local found = {}
	for _, entry in ipairs(engine.sent) do
		if entry[1] == kind then
			found[#found + 1] = entry
		end
	end
	return found
end

--------------------------------------------------------------------------------
-- The opening: a pause and a held line.
--------------------------------------------------------------------------------

local game, state = playing()
local objective = state.objectives.get

local pauses = sent(game, PAUSE_MESSAGE)
check("pause_game asks the unsynced half for a pause", #pauses == 1 and pauses[1] == true,
	#pauses .. " requests")

local lines = messages(game, DIALOGUE_MESSAGE)
check("a held line goes out with its hold beside it",
	#lines == 1 and lines[1][2] == "welcome" and lines[1][3] == true)

--------------------------------------------------------------------------------
-- The dismissal, with no game frame from here on.
--------------------------------------------------------------------------------

check("a message that is not a dismissal is left for whoever it is for",
	game.env:RecvLuaMsg("another_gadget:welcome", 0) == nil)

check("a dismissal is ours, whoever sent it", game.env:RecvLuaMsg(DISMISSED .. "welcome", 5) == true)
check("but a spectator's dismisses nothing", objective("read") == "active", objective("read"))

game.env:RecvLuaMsg(DISMISSED .. "orders", 0)
check("nor does one for a line the mission is not holding",
	objective("ready") == "active", objective("ready"))

game.env:RecvLuaMsg(DISMISSED .. "welcome", 0)
check("the player's dismissal fires a polled trigger with no frame to poll on",
	objective("read") == "complete", objective("read"))

lines = messages(game, DIALOGUE_MESSAGE)
check("which holds the next line", #lines == 2 and lines[2][2] == "orders" and lines[2][3] == true)
check("and leaves the game paused", #sent(game, PAUSE_MESSAGE) == 1)

game.env:RecvLuaMsg(DISMISSED .. "welcome", 0)
check("a line already dismissed cannot be dismissed again",
	#messages(game, DIALOGUE_MESSAGE) == 2)

game.env:RecvLuaMsg(DISMISSED .. "orders", 0)
check("dismissing the second line fires the trigger its event wakes",
	objective("ready") == "complete", objective("ready"))

pauses = sent(game, PAUSE_MESSAGE)
check("whose unpause_game asks for the game back", #pauses == 2 and pauses[2] == false)

lines = messages(game, DIALOGUE_MESSAGE)
check("and a line that is not held goes out as its id and nothing else",
	#lines == 3 and lines[3][2] == "thanks" and lines[3][3] == nil)

--------------------------------------------------------------------------------
-- More than one player.
--------------------------------------------------------------------------------

game = playing({ [0] = { team = 0 }, [1] = { team = 1 } })
check("with two players in the game pause_game asks for nothing",
	#sent(game, PAUSE_MESSAGE) == 0, #sent(game, PAUSE_MESSAGE) .. " requests")
check("and says why", logged(game, "only work in single player"))
check("while the held line is still said", #messages(game, DIALOGUE_MESSAGE) == 1)

--------------------------------------------------------------------------------
-- The unsynced half: who asks the server for a pause.
--------------------------------------------------------------------------------

local player = client()
player.env:RecvFromSynced(PAUSE_MESSAGE, true)
player.env:RecvFromSynced(PAUSE_MESSAGE, false)
check("the player's client asks for the pause and then the unpause, each by name",
	#player.commands == 2 and player.commands[1] == "pause 1" and player.commands[2] == "pause 0",
	table.concat(player.commands, ", "))

local watcher = client({ spectating = true })
watcher.env:RecvFromSynced(PAUSE_MESSAGE, true)
check("a spectator's client asks for nothing", #watcher.commands == 0)

local replay = client({ replay = true })
replay.env:RecvFromSynced(PAUSE_MESSAGE, true)
check("nor does a client watching a replay, where a pause request toggles the playback",
	#replay.commands == 0)

--------------------------------------------------------------------------------
-- The unsynced half: where a held line goes.
--------------------------------------------------------------------------------

player.env:RecvFromSynced(DIALOGUE_MESSAGE, "welcome", true)
check("a held line goes on to LuaUI with its hold",
	#player.luaUI == 1 and player.luaUI[1][1] == DIALOGUE_GLOBAL
	and player.luaUI[1][2] == "welcome" and player.luaUI[1][3] == true)
check("and is not dismissed for the player, who has a panel to do it on",
	#player.luaRulesMsgs == 0)

local bare = client({ noLuaUI = true })
bare.env:RecvFromSynced(DIALOGUE_MESSAGE, "welcome", true)
check("with no panel to show it on, a held line is dismissed for the player",
	#bare.luaRulesMsgs == 1 and bare.luaRulesMsgs[1] == DISMISSED .. "welcome",
	tostring(bare.luaRulesMsgs[1]))
bare.env:RecvFromSynced(DIALOGUE_MESSAGE, "thanks")
check("while a line that is not held sends nothing", #bare.luaRulesMsgs == 1)

local bareWatcher = client({ noLuaUI = true, spectating = true })
bareWatcher.env:RecvFromSynced(DIALOGUE_MESSAGE, "welcome", true)
check("and a spectator dismisses nothing for anybody", #bareWatcher.luaRulesMsgs == 0)

check("the two halves agree on what a dismissal message starts with",
	MODEL.DISMISSED_MESSAGE == DISMISSED)

--------------------------------------------------------------------------------
-- The panel's queue.
--------------------------------------------------------------------------------

local LINES = {
	a = { id = "a", speaker = "HQ", text = "First." },
	b = { id = "b", speaker = "HQ", text = "Second." },
	c = { id = "c", speaker = "HQ", text = "Third." },
}

local function newQueue(maxQueued)
	return MODEL.newQueue({ lines = LINES, gameSpeed = 30, maxQueued = maxQueued })
end

local queue = newQueue()
queue.push("a", true)
queue.update(0)
check("a held line takes the panel", queue.current() == LINES.a and queue.holding() == true)
queue.update(100000)
check("and is still there long after a timed line would have gone", queue.current() == LINES.a)
queue.push("b")
queue.update(100001)
check("with the next line waiting behind it", queue.current() == LINES.a and queue.pending() == 1)
check("dismissing it answers with the line", queue.dismiss() == LINES.a)
check("and clears the panel", queue.current() == nil and queue.holding() == false)
check("a second dismissal dismisses nothing", queue.dismiss() == nil)
queue.update(100001)
check("the next line follows on the same clock", queue.current() == LINES.b)
check("which is a timed line, and not one to dismiss",
	queue.holding() == false and queue.dismiss() == nil and queue.current() == LINES.b)

queue = newQueue()
queue.push("a")
queue.update(0)
check("a timed line with nothing held behind it does not need the clock run for it",
	queue.blocked() == false)
queue.push("b", true)
check("one with a held line behind it does", queue.blocked() == true)
queue.update(90)
check("and once it has gone the held line is on the panel and nothing is blocked",
	queue.current() == LINES.b and queue.blocked() == false)

queue = newQueue(1)
queue.push("a")
queue.update(0)
queue.push("b", true)
queue.push("c")
check("a full queue drops a timed line", queue.pending() == 1)
queue.update(90)
check("and never the held one, which the mission may be waiting on",
	queue.current() == LINES.b and queue.holding() == true)

--------------------------------------------------------------------------------
-- The panel's layout.
--------------------------------------------------------------------------------

local function measure(text)
	return #text * 0.5
end

local function hasText(layout, text)
	for _, entry in ipairs(layout.texts) do
		if entry.text == text then
			return true
		end
	end
	return false
end

local VIEW = { w = 1920, h = 1080 }
local timed = MODEL.layout({ line = LINES.a }, measure, VIEW)
local held = MODEL.layout({ line = LINES.a, hold = true }, measure, VIEW)

check("a held line says how to dismiss it", hasText(held, MODEL.HOLD_HINT))
check("and a timed line does not", not hasText(timed, MODEL.HOLD_HINT))
check("a held line has a box for the click to land in",
	held.dialogueBox ~= nil and held.dialogueBox[3] > held.dialogueBox[1]
	and held.dialogueBox[4] > held.dialogueBox[2])
check("and a timed line has none, so a click on it goes through to the game",
	timed.dialogueBox == nil)
check("holding a line is a change to the scene",
	MODEL.sceneKey({ line = LINES.a }) ~= MODEL.sceneKey({ line = LINES.a, hold = true }))

support.report()
