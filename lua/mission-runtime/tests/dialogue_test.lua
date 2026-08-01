-- Proves the synced end of what a mission says: that a dialogue action resolves
-- the line the trigger named and hands it out, that play_sound reaches the
-- engine, and that which unit an actor became is readable outside synced Lua so
-- the panel can put the actor's name over it. Run it with:
--
--   luajit lua/mission-runtime/tests/dialogue_test.lua
--
-- The gadget is loaded under the stub engine rather than the module on its own,
-- because both halves of the gadget are part of the claim: the synced one
-- decides a line was said, and the unsynced one is what carries it to LuaUI.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged, sent = support.check, support.load, support.logged, support.sent
local missionFiles, compiled = support.missionFiles, support.compiled

-- The names the unsynced half and the widget depend on. Hard-coded rather than
-- read off the runtime, because each one is a contract.
local ACTOR_PREFIX = "coilbox_mission_actor_"
local DIALOGUE_MESSAGE = "coilbox_mission_dialogue"
local SOUND_MESSAGE = "coilbox_mission_sound"
local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

local LINES = {
	{ id = "warn", speaker = "HQ", text = "Contact! Raiders inbound." },
	{ id = "cheer", speaker = "HQ", text = "Good work.", audio = "cheer.wav" },
}

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

local function say(line)
	return { type = "dialogue", params = { line = line } }
end

local function sound(name)
	return { type = "play_sound", params = { sound = name } }
end

local function playing(overrides, options)
	local mission = compiled(overrides)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), options)
	engine.env:Initialize()
	engine.env:GameStart()
	engine.env:GameFrame(1)
	return engine
end

--------------------------------------------------------------------------------
-- Saying a line.
--------------------------------------------------------------------------------

local engine = playing({
	dialogue = LINES,
	triggers = { once("ambush", { say("warn"), say("cheer") }) },
})
engine.env:GameFrame(15)

local said = sent(engine, DIALOGUE_MESSAGE)
check("a dialogue action says its line", #said == 2, #said .. " lines")
check("and says the lines in the order the trigger lists them",
	said[1] == "warn" and said[2] == "cheer", table.concat(said, ", "))
check("nothing about the line itself crosses: the id is the whole message",
	engine.sent[#engine.sent][3] == nil)

--------------------------------------------------------------------------------
-- A line the scenario never declared.
--
-- Unlike a var it cannot be invented: a line is its speaker and its text as much
-- as its id, and there is nothing to draw without them.
--------------------------------------------------------------------------------

engine = playing({ dialogue = LINES, triggers = { once("ghost", { say("nowhere") }) } })
engine.env:GameFrame(15)

check("a line the mission never declared says nothing", #sent(engine, DIALOGUE_MESSAGE) == 0)
check("and is reported", logged(engine, "no dialogue line named nowhere in this mission"))

--------------------------------------------------------------------------------
-- Playing a sound.
--------------------------------------------------------------------------------

engine = playing({ triggers = { once("alarm", { sound("alarm.wav") }) } })
engine.env:GameFrame(15)

local played = sent(engine, SOUND_MESSAGE)
check("play_sound hands the sound out", #played == 1 and played[1] == "alarm.wav",
	table.concat(played, ", "))

engine = playing({ triggers = { once("silence", { sound(nil) }) } })
engine.env:GameFrame(15)
check("play_sound with nothing to play plays nothing", #sent(engine, SOUND_MESSAGE) == 0)
check("and is reported", logged(engine, "play_sound was given no sound to play"))

--------------------------------------------------------------------------------
-- The published handle, which is how a game's own actions speak.
--------------------------------------------------------------------------------

engine = playing({ dialogue = LINES })
local dialogue = engine.GG.CoilboxMission.dialogue

check("the handle answers with the scenario's record for a line",
	dialogue.get("warn").speaker == "HQ")
check("and with nothing for one the scenario never declared", dialogue.get("nowhere") == nil)

check("saying a line through the handle says it", dialogue.say("warn") == true)
check("and it went out", #sent(engine, DIALOGUE_MESSAGE) == 1)
check("saying one the mission never declared says nothing", dialogue.say("nowhere") == false)
check("playing a sound through the handle plays it", dialogue.sound("alarm.wav") == true)

--------------------------------------------------------------------------------
-- Which unit an actor became, for the name the author gave it.
--
-- Nothing in the engine renames a unit, so the name is drawn over the unit
-- instead, and the panel that draws it reads which unit that is from here.
--------------------------------------------------------------------------------

local ACTORS = {
	{ id = "hero", unitDef = "armcom", team = "player", pos = { x = 10, z = 20 }, facing = 0,
		state = { name = "Warlord" } },
	{ id = "spare", unitDef = "armpw", team = "player", pos = { x = 30, z = 40 }, facing = 0 },
}

engine = load({ coilbox_mission = "demo" },
	missionFiles(compiled({ teams = { player = { team = 0 } }, actors = ACTORS })))
engine.env:Initialize()

local function mirrored(id)
	return engine.env.Spring.GetGameRulesParam(ACTOR_PREFIX .. id)
end

check("an actor is readable outside synced Lua before the first frame", mirrored("hero") == 0,
	tostring(mirrored("hero")))
check("and so is one the author did not name, because the mirror is about actors "
	.. "rather than about names", mirrored("spare") == 0, tostring(mirrored("spare")))
check("an actor the mission never declared has no mirror", mirrored("ghost") == nil)

engine.env:GameStart()
local hero = engine.GG.CoilboxMission.units.hero
check("a spawned actor mirrors the unit it became", mirrored("hero") == hero,
	tostring(mirrored("hero")) .. " for unit " .. tostring(hero))

engine.env.Spring.DestroyUnit(hero)
check("and reads as not on the map once it dies", mirrored("hero") == 0, tostring(mirrored("hero")))
check("while an actor still standing is untouched", mirrored("spare") > 0)

--------------------------------------------------------------------------------
-- The unsynced half, which is what carries a line to LuaUI.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" },
	missionFiles(compiled({ dialogue = LINES })), { synced = false })
unsynced.env:Initialize()

check("the unsynced half holds no dialogue of its own",
	unsynced.GG.CoilboxMission.dialogue == nil)

unsynced.env:RecvFromSynced(DIALOGUE_MESSAGE, "warn")
check("a line goes on to LuaUI, which is where the panel is",
	#unsynced.luaUI == 1 and unsynced.luaUI[1][1] == DIALOGUE_GLOBAL
	and unsynced.luaUI[1][2] == "warn")
check("and the unsynced half does not play its clip: the panel does, in step with "
	.. "the text", #unsynced.sounds == 0)

unsynced.env:RecvFromSynced(SOUND_MESSAGE, "alarm.wav")
check("a sound is played here, because it has no conversation to queue behind",
	#unsynced.sounds == 1 and unsynced.sounds[1][1] == "alarm.wav")
check("and does not go to LuaUI", #unsynced.luaUI == 1)

check("a message that is not ours is left alone",
	unsynced.env:RecvFromSynced("someone_elses_message", "warn") == nil)

--------------------------------------------------------------------------------
-- A sound the game has not got.
--------------------------------------------------------------------------------

unsynced = load({ coilbox_mission = "demo" }, missionFiles(compiled({})),
	{ synced = false, sounds = { ["real.wav"] = true } })
unsynced.env:Initialize()

unsynced.env:RecvFromSynced(SOUND_MESSAGE, "missing.wav")
unsynced.env:RecvFromSynced(SOUND_MESSAGE, "missing.wav")
check("a sound the game has not got is reported", logged(unsynced, "no sound called missing.wav"))

local reports = 0
for _, line in ipairs(unsynced.logs) do
	if line:find("missing.wav", 1, true) then
		reports = reports + 1
	end
end
check("once, however often the mission asks for it", reports == 1, reports .. " reports")

unsynced.env:RecvFromSynced(SOUND_MESSAGE, "real.wav")
check("a sound the game has got is not reported", not logged(unsynced, "no sound called real.wav"))

support.report()
