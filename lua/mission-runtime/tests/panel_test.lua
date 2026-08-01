-- Proves what the mission panels decide before they draw anything: which
-- objectives are visible and in what order, which name goes over which unit, how
-- long a line of dialogue holds the panel, where a line of text breaks, and
-- whether the player won. Run it with:
--
--   luajit lua/mission-runtime/tests/panel_test.lua
--
-- The widget itself is not tested here and cannot be: every claim about it is a
-- claim about OpenGL. What can be proved outside the engine is everything the
-- widget decides before it draws, which is why that lives in a module of its own
-- and this file is the reason it does.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local MODEL = dofile(support.root() .. "/luaui/mission_ui/coilbox_panel_model.lua")

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

--- A stand-in for the game rules params the synced half writes.
local function reader(params)
	return function(name)
		return params[name]
	end
end

local function objectiveParams(states)
	local params = {}
	for id, value in pairs(states) do
		params[MODEL.OBJECTIVE_PREFIX .. id] = value
	end
	return params
end

local function ids(entries)
	local list = {}
	for _, entry in ipairs(entries) do
		list[#list + 1] = entry.id
	end
	return table.concat(list, ",")
end

--- One character per unit of width, so a wrap test says what it means.
local function letters(value)
	return #value
end

--------------------------------------------------------------------------------
-- The mirrors, spelled out.
--
-- Every one is a name the synced half writes and this side reads, so a test that
-- read the name off the model would be asking the code whether it agrees with
-- itself. Renaming one of these is a runtime change and has to break something.
--------------------------------------------------------------------------------

check("the objective mirror is named what the runtime writes",
	MODEL.OBJECTIVE_PREFIX == "coilbox_mission_objective_", MODEL.OBJECTIVE_PREFIX)
check("and so is the actor mirror", MODEL.ACTOR_PREFIX == "coilbox_mission_actor_",
	MODEL.ACTOR_PREFIX)
check("and so is the one that says the mission is over",
	MODEL.OVER_PARAM == "coilbox_mission_over", MODEL.OVER_PARAM)
check("and the one that says how many won",
	MODEL.WINNERS_PARAM == "coilbox_mission_winners", MODEL.WINNERS_PARAM)
check("and the one that names each of them",
	MODEL.WINNER_PREFIX == "coilbox_mission_winner_", MODEL.WINNER_PREFIX)

--------------------------------------------------------------------------------
-- The mission id, which is the gate and part of a VFS path.
--------------------------------------------------------------------------------

check("a plain name is a mission id", MODEL.missionId("ambush") == "ambush")
check("and is trimmed", MODEL.missionId("  ambush  ") == "ambush")
check("a normal game has no mission id", MODEL.missionId(nil) == nil)
check("nor has an empty one", MODEL.missionId("   ") == nil)
check("a path is refused rather than followed", MODEL.missionId("../../etc") == nil)
check("and so is a name that is nothing but dots", MODEL.missionId("..") == nil)
check("and so is anything that is not a string", MODEL.missionId(7) == nil)

--------------------------------------------------------------------------------
-- Objectives.
--------------------------------------------------------------------------------

local MISSION = {
	objectives = {
		{ id = "keep", kind = "primary", text = "Take the keep.", hidden = false },
		{ id = "scout", kind = "secondary", text = "Scout the pass.", hidden = false },
		{ id = "bridge", kind = "primary", text = "Hold the bridge.", hidden = false },
		{ id = "twist", kind = "primary", text = "Kill the warlord.", hidden = true },
	},
}

local read = reader(objectiveParams({ keep = 1, bridge = -1 }))
local entries = MODEL.objectives(MISSION, read)

check("primaries come before secondaries, each in the order the scenario lists them",
	ids(entries) == "keep,bridge,scout", ids(entries))
check("a completed objective says so", entries[1].state == "complete", entries[1].state)
check("a failed one says so", entries[2].state == "failed", entries[2].state)
check("one nothing has touched is still active", entries[3].state == "active", entries[3].state)
check("a hidden objective is left out while it is active", #entries == 3, #entries .. " entries")
check("an objective carries the text the scenario gave it",
	entries[1].text == "Take the keep.")

entries = MODEL.objectives(MISSION, reader(objectiveParams({ twist = 1 })))
check("settling a hidden objective is what reveals it", ids(entries) == "keep,bridge,twist,scout",
	ids(entries))

check("an objective with no mirror at all reads as active, because a reader that "
	.. "knows about one the runtime does not should say the honest thing",
	MODEL.objectiveState("keep", reader({})) == "active")

check("a mission with no objectives draws none", #MODEL.objectives({}, reader({})) == 0)
check("and nor does no mission at all", #MODEL.objectives(nil, reader({})) == 0)

--------------------------------------------------------------------------------
-- Names over named actors.
--------------------------------------------------------------------------------

local NAMED = {
	actors = {
		{ id = "hero", state = { name = "Warlord" } },
		{ id = "spare" },
		{ id = "blank", state = { name = "" } },
		{ id = "dead", state = { name = "Ghost" } },
	},
}

local labels = MODEL.labels(NAMED, reader({
	[MODEL.ACTOR_PREFIX .. "hero"] = 12,
	[MODEL.ACTOR_PREFIX .. "spare"] = 13,
	[MODEL.ACTOR_PREFIX .. "blank"] = 14,
	[MODEL.ACTOR_PREFIX .. "dead"] = 0,
}))

check("an actor the author named is labelled", #labels == 1, #labels .. " labels")
check("with its name over the unit it became",
	labels[1].name == "Warlord" and labels[1].unitID == 12)
check("an actor with no name is not labelled, nor is one named nothing", #labels == 1)
check("and one that is not on the map is not labelled either", #labels == 1)

--------------------------------------------------------------------------------
-- The dialogue queue.
--------------------------------------------------------------------------------

local LINES = {
	warn = { id = "warn", speaker = "HQ", text = "Contact!" },
	long = { id = "long", speaker = "HQ", text = string.rep("a", 400) },
	cheer = { id = "cheer", speaker = "HQ", text = "Good work.", audio = "cheer.wav" },
}

local function newQueue(overrides)
	local options = { lines = LINES, gameSpeed = 30 }
	for key, value in pairs(overrides or {}) do
		options[key] = value
	end
	return MODEL.newQueue(options)
end

local queue = newQueue()
check("nothing is on the panel to begin with", queue.current() == nil)
check("and advancing an empty queue starts nothing", queue.update(0) == nil)

queue.push("warn")
check("a pushed line is not on the panel until the queue advances", queue.current() == nil)
local started = queue.update(0)
check("advancing puts it there", started ~= nil and started.id == "warn")
check("and it stays there", queue.current().id == "warn")
check("advancing again while it holds starts nothing new", queue.update(1) == nil)

-- A short line holds for the minimum, which is three seconds at 30 frames.
check("a short line holds for the minimum", queue.update(89) == nil and queue.current() ~= nil)
check("and then clears", queue.update(90) == nil and queue.current() == nil)

queue = newQueue()
queue.push("long")
queue.update(0)
check("a long line is capped rather than holding the panel all mission",
	queue.update(12 * 30 - 1) == nil and queue.current() ~= nil)
check("and clears at the cap", queue.update(12 * 30) == nil and queue.current() == nil)

queue = newQueue()
queue.push("warn")
queue.push("cheer")
queue.update(0)
check("a second line waits its turn rather than interrupting", queue.current().id == "warn")
check("and is counted as waiting", queue.pending() == 1, queue.pending() .. " waiting")
started = queue.update(90)
check("and takes the panel when the first is done", started ~= nil and started.id == "cheer")
check("the line that takes the panel is handed back, so its clip starts with its text",
	started.audio == "cheer.wav")

queue = newQueue({ maxQueued = 2 })
queue.push("warn")
queue.push("long")
queue.push("cheer")
check("a backlog is capped", queue.pending() == 2, queue.pending() .. " waiting")
check("and it is the oldest line that goes, because a player behind the mission "
	.. "wants the ones nearest to now", queue.update(0).id == "long")

queue = newQueue()
check("a line the mission never declared is dropped", queue.push("nowhere") == nil)
check("and nothing is waiting because of it", queue.pending() == 0)

queue = newQueue()
queue.push("warn")
queue.push("cheer")
queue.update(0)
queue.clear()
check("clearing empties the panel", queue.current() == nil)
check("and everything behind it", queue.pending() == 0)

--------------------------------------------------------------------------------
-- Wrapping.
--------------------------------------------------------------------------------

check("text that fits is one line", #MODEL.wrap("abc def", 20, letters) == 1)

local rows = MODEL.wrap("aaa bbb ccc", 7, letters)
check("text that does not fit breaks on a space", #rows == 2, #rows .. " rows")
check("and breaks at the last word that fitted", rows[1] == "aaa bbb" and rows[2] == "ccc",
	table.concat(rows, " | "))

rows = MODEL.wrap("aaaaaaaaaa bb", 5, letters)
check("a word wider than the line is left whole and overflows", rows[1] == "aaaaaaaaaa",
	table.concat(rows, " | "))
check("and the rest still wraps after it", rows[2] == "bb")

rows = MODEL.wrap("one\ntwo", 80, letters)
check("a newline the author typed breaks the line", #rows == 2 and rows[1] == "one",
	table.concat(rows, " | "))

check("empty text is one empty line rather than nothing at all",
	#MODEL.wrap("", 80, letters) == 1)

--------------------------------------------------------------------------------
-- The debrief.
--------------------------------------------------------------------------------

local function outcome(params, myAllyTeam)
	local debrief = MODEL.debrief(MISSION, reader(params), myAllyTeam)
	return debrief and debrief.outcome
end

check("there is no debrief while the mission is still running", outcome({}, 0) == nil)
check("nor while the mission has said it is not over",
	outcome({ [MODEL.OVER_PARAM] = 0 }, 0) == nil)

check("the player's ally team in the winning list is a victory", outcome({
	[MODEL.OVER_PARAM] = 1,
	[MODEL.WINNERS_PARAM] = 1,
	[MODEL.WINNER_PREFIX .. "0"] = 1,
}, 0) == "victory")

check("a winning list without them is a defeat", outcome({
	[MODEL.OVER_PARAM] = 1,
	[MODEL.WINNERS_PARAM] = 1,
	[MODEL.WINNER_PREFIX .. "1"] = 1,
}, 0) == "defeat")

check("nobody winning is undecided rather than a defeat", outcome({
	[MODEL.OVER_PARAM] = 1,
	[MODEL.WINNERS_PARAM] = 0,
}, 0) == "undecided")

local debrief = MODEL.debrief(MISSION, reader({
	[MODEL.OVER_PARAM] = 1,
	[MODEL.WINNERS_PARAM] = 1,
	[MODEL.WINNER_PREFIX .. "0"] = 1,
	[MODEL.OBJECTIVE_PREFIX .. "keep"] = 1,
}), 0)
check("the debrief lists the objectives the way the panel does",
	ids(debrief.objectives) == "keep,bridge,scout", ids(debrief.objectives))
check("with how each one ended", debrief.objectives[1].state == "complete")

support.report()
