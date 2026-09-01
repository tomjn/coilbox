-- Proves difficulty (issue #2164): the ladder itself, what the modoption is read
-- as, which of a scenario's placements reach the map at each level, which of its
-- triggers are armed, and that a mission that names no difficulty plays the same
-- at every one of them. Run it with:
--
--   luajit lua/mission-runtime/tests/difficulty_test.lua
--
-- The gadget is loaded under the stub engine rather than the modules on their
-- own, because "the boss is only on hard" is a unit on a map and only the gadget
-- puts one there.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

local DIFFICULTY = dofile(support.root() .. "/luarules/mission_runtime/coilbox_difficulty.lua")

--------------------------------------------------------------------------------
-- The ladder on its own. Pure arithmetic, so it is checked without an engine at
-- all before anything is asked of the runtime.
--------------------------------------------------------------------------------

--- The levels a range applies at, as one string, which is the whole meaning of
-- a range in a form a failure can print.
local function applyingAt(range)
	local at = {}
	for _, level in ipairs(DIFFICULTY.LEVELS) do
		if DIFFICULTY.applies(range, level) then
			at[#at + 1] = level
		end
	end
	return table.concat(at, ",")
end

check("a range that says nothing is everywhere", applyingAt(nil) == "easy,normal,hard", applyingAt(nil))
check("and so is an empty one", applyingAt({}) == "easy,normal,hard", applyingAt({}))
check("atLeast is this level and up",
	applyingAt({ atLeast = "normal" }) == "normal,hard", applyingAt({ atLeast = "normal" }))
check("atMost is this level and down",
	applyingAt({ atMost = "normal" }) == "easy,normal", applyingAt({ atMost = "normal" }))
check("both ends together pin one level",
	applyingAt({ atLeast = "normal", atMost = "normal" }) == "normal")
check("a range that crosses itself applies nowhere",
	applyingAt({ atLeast = "hard", atMost = "easy" }) == "")
-- A mission built against a longer ladder than this runtime has. The bound is
-- dropped rather than read as excluding, so the thing is placed: a mission with
-- an extra unit in it is a better failure than one missing the unit the author
-- meant to be there at every level this runtime does know.
check("a bound this runtime cannot rank is ignored",
	applyingAt({ atLeast = "nightmare" }) == "easy,normal,hard",
	applyingAt({ atLeast = "nightmare" }))

local function parsed(value)
	local level, problem = DIFFICULTY.parse(value)
	return level .. "/" .. tostring(problem ~= nil)
end

check("no modoption is the default", parsed(nil) == "normal/false", parsed(nil))
check("and so is an empty one", parsed("  ") == "normal/false", parsed("  "))
check("a level is read whatever case and spacing it arrived in",
	parsed(" Hard ") == "hard/false", parsed(" Hard "))
-- Not guessed at. Reading an unknown word as the nearest end of the ladder is
-- how somebody who asked for easy gets hard.
check("a word this runtime cannot rank falls back and says so",
	parsed("nightmare") == "normal/true", parsed("nightmare"))
check("and so does a modoption that is not a name", parsed(7) == "normal/true", parsed(7))

--------------------------------------------------------------------------------
-- A scenario that gates one of everything.
--------------------------------------------------------------------------------

--- A trigger that runs `actions` once `seconds` have passed. `difficulty` is the
-- range it carries, and `armed` is false for one that waits for enable_trigger.
local function at(id, seconds, difficulty, armed, actions)
	return {
		id = id,
		enabled = armed,
		["repeat"] = false,
		difficulty = difficulty,
		conditions = {
			op = "all",
			conditions = { { type = "time_elapsed", params = { seconds = seconds } } },
		},
		actions = actions,
	}
end

local function bump(amount)
	return { { type = "add_var", params = { name = "rounds", value = amount } } }
end

local MISSION = compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	actors = {
		{ id = "scout", unitDef = "armpw", team = "enemy", pos = { x = 100, z = 100 }, facing = 0 },
		{
			id = "boss",
			unitDef = "corcom",
			team = "enemy",
			pos = { x = 200, z = 200 },
			facing = 0,
			difficulty = { atLeast = "hard" },
		},
		{
			id = "handout",
			unitDef = "armpw",
			team = "player",
			pos = { x = 300, z = 300 },
			facing = 0,
			difficulty = { atMost = "easy" },
		},
	},
	groups = {
		{
			id = "patrol",
			team = "enemy",
			pos = { x = 400, z = 400 },
			units = { { def = "armpw", count = 1 } },
			orders = {},
			dormant = false,
		},
		{
			id = "second-wave",
			team = "enemy",
			pos = { x = 500, z = 500 },
			units = { { def = "armpw", count = 2 } },
			orders = {},
			dormant = false,
			difficulty = { atLeast = "hard" },
		},
		{
			id = "reserve",
			team = "enemy",
			pos = { x = 600, z = 600 },
			units = { { def = "armpw", count = 1 } },
			orders = {},
			dormant = true,
			difficulty = { atLeast = "hard" },
		},
	},
	prefabs = {
		{
			id = "outpost",
			team = "enemy",
			origin = { x = 700, z = 700 },
			buildings = { { id = "solar", def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 } },
		},
		{
			id = "extra-turret",
			team = "enemy",
			origin = { x = 800, z = 800 },
			difficulty = { atLeast = "hard" },
			buildings = { { id = "turret", def = "armllt", offset = { x = 0, z = 0 }, facing = 0 } },
		},
	},
	vars = { rounds = 0 },
	triggers = {
		at("always", 1, nil, true, bump(1)),
		at("easy-only", 1, { atMost = "easy" }, true, bump(100)),
		-- Disarmed at the start, so the only way it ever fires is the opener
		-- below. That is what makes the enable_trigger refusal provable rather
		-- than inferred from a trigger that would have fired anyway.
		at("hard-only", 1, { atLeast = "hard" }, false, bump(10)),
		at("opener", 2, nil, true, { { type = "enable_trigger", params = { trigger = "hard-only" } } }),
		-- The wave is only there on hard, so at every other level this is an
		-- action aimed at a group with nothing on the map, which is the case the
		-- runtime shouts about (issue #2165) and must not shout about here.
		at("call-reserve", 3, nil, true, { { type = "wake_group", params = { group = "reserve" } } }),
	},
})

--- Play a mission at a difficulty, up to the frame everything above has fired.
--
-- 150 frames is five seconds at the stub's game speed, and the last trigger
-- waits three.
local function play(mission, difficulty)
	local modOptions = { coilbox_mission = "demo" }
	if difficulty then
		modOptions.coilbox_difficulty = difficulty
	end

	local engine = load(modOptions, missionFiles(mission), {
		buildings = { armsolar = true, armllt = true },
		defs = { armpw = true, corcom = true, armsolar = true, armllt = true },
	})
	engine.env:Initialize()
	engine.env:GameStart()
	for frame = 1, 150 do
		engine.env:GameFrame(frame)
	end
	return engine, engine.GG.CoilboxMission
end

--- What reached the map and what fired, as one string per difficulty.
local function outcome(state)
	local present = {}
	for _, name in ipairs({ "scout", "boss", "handout", "solar", "turret" }) do
		if state.units[name] then
			present[#present + 1] = name
		end
	end
	return string.format("%s patrol=%d wave=%d reserve=%d rounds=%d",
		table.concat(present, ","),
		#state.groups.units("patrol"),
		#state.groups.units("second-wave"),
		#state.groups.units("reserve"),
		state.vars.get("rounds"))
end

local easyEngine, easy = play(MISSION, "easy")
local normalEngine, normal = play(MISSION, "normal")
local hardEngine, hard = play(MISSION, "hard")

check("the level is published for a game's own Lua to read",
	easy.difficulty == "easy" and hard.difficulty == "hard", tostring(hard.difficulty))

check("easy places what it always places plus its own, and fires its own trigger",
	outcome(easy) == "scout,handout,solar patrol=1 wave=0 reserve=0 rounds=101", outcome(easy))
check("normal drops both ends and fires neither",
	outcome(normal) == "scout,solar patrol=1 wave=0 reserve=0 rounds=1", outcome(normal))
check("hard places the boss, the turret and the second wave",
	outcome(hard) == "scout,boss,solar,turret patrol=1 wave=2 reserve=1 rounds=11", outcome(hard))

-- The refusal that matters most. A mission that turns its own triggers on and
-- off must not be able to switch a gated one back on, or the range is a default
-- rather than a rule.
check("a trigger the difficulty leaves out cannot be enabled by another",
	normal.triggers:isEnabled("hard-only") == false)
check("and one it leaves in is enabled by the same action",
	hard.triggers:isEnabled("hard-only") == false and hard.vars.get("rounds") == 11)

--------------------------------------------------------------------------------
-- What a skip is not. Issue #2208 made a spawn the engine refused an error,
-- because a mission that placed nothing and a mission whose units did not arrive
-- look the same from outside. A placement the author gated out is neither: it is
-- the mission doing what it was told, and logging it would put a line in the
-- test drawer's problem list for every difficulty-aware mission there is.
--------------------------------------------------------------------------------

local function said(engine, level, needle)
	return logged(engine, level .. ": " .. needle)
end

for _, run in ipairs({ { easyEngine, "easy" }, { normalEngine, "normal" } }) do
	local engine, level = run[1], run[2]
	check("nothing at " .. level .. " is logged as an error", not logged(engine, "error: "))
	check("and no warning names a thing the difficulty left out at " .. level,
		not said(engine, "warning", "second-wave") and not said(engine, "warning", "reserve"))
end

-- Not silence either. A group an action was aimed at and that is not in this
-- mission is worth one line, at the level that says "this is not a fault".
check("waking a group the difficulty left out says so once, at notice",
	said(normalEngine, "notice", "group reserve is not part of this mission at difficulty normal"))
check("and so does trying to enable a trigger it left out",
	said(normalEngine, "notice", "trigger hard-only is not part of this mission at difficulty normal"))

--------------------------------------------------------------------------------
-- The additive claim, in the runtime rather than in the compiler: a mission that
-- names no difficulty anywhere plays identically at every setting, and at none.
--------------------------------------------------------------------------------

local PLAIN = compiled({
	teams = { player = { team = 0 }, enemy = { team = 1 } },
	actors = {
		{ id = "scout", unitDef = "armpw", team = "enemy", pos = { x = 100, z = 100 }, facing = 0 },
	},
	groups = {
		{
			id = "patrol",
			team = "enemy",
			pos = { x = 400, z = 400 },
			units = { { def = "armpw", count = 2 } },
			orders = {},
			dormant = false,
		},
	},
	prefabs = {
		{
			id = "outpost",
			team = "enemy",
			origin = { x = 700, z = 700 },
			buildings = { { id = "solar", def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 } },
		},
	},
	vars = { rounds = 0 },
	triggers = { at("always", 1, nil, true, bump(1)) },
})

local _, unset = play(PLAIN, nil)
local plain = outcome(unset)
for _, level in ipairs(DIFFICULTY.LEVELS) do
	local _, state = play(PLAIN, level)
	check("a mission that names no difficulty plays the same at " .. level,
		outcome(state) == plain, outcome(state) .. " vs " .. plain)
end

-- The other half of "no modoption": the runtime picks the middle of the ladder
-- rather than the end, so a mission gated for hard is not handed to somebody a
-- launcher never asked.
local _, unstated = play(MISSION, nil)
check("a launch that names no difficulty plays the mission at the default",
	outcome(unstated) == outcome(normal), outcome(unstated))

local badEngine, bad = play(MISSION, "nightmare")
check("a difficulty this runtime has never heard of falls back to the default",
	outcome(bad) == outcome(normal), outcome(bad))
check("and says which word it could not read",
	said(badEngine, "warning", "this runtime has no difficulty called nightmare"))

support.report()
