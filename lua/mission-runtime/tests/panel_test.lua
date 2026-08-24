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

--------------------------------------------------------------------------------
-- Layout: the rectangles and texts the widget uploads and draws.
--------------------------------------------------------------------------------

-- Half an em per character, the shape of what gl.GetTextWidth answers.
local function measure(text)
	return #text * 0.5
end

local VIEW = { w = 1000, h = 1000 }

local function textsWith(L, needle)
	local found = {}
	for _, t in ipairs(L.texts) do
		if t.text:find(needle, 1, true) then
			found[#found + 1] = t
		end
	end
	return found
end

local L = MODEL.layout({ objectives = {} }, measure, VIEW)
check("a scene with nothing to say lays out nothing",
	#L.rects == 0 and #L.texts == 0 and L.portrait == nil and L.debriefBox == nil)

-- The objectives panel.

L = MODEL.layout({ objectives = MODEL.objectives(MISSION, read) }, measure, VIEW)

check("objectives lay a backdrop first", L.rects[1] ~= nil and L.rects[1].kind == "objectives")
check("in the backdrop colour", L.rects[1].color == MODEL.BACKDROP)
check("sized for the title and a row per line, with the secondary heading its own row",
	L.rects[1].h == 2 * MODEL.PAD + MODEL.LINE_HEIGHT + 4 * MODEL.LINE_HEIGHT, L.rects[1].h)
check("the panel is titled", #textsWith(L, "Objectives") == 1)
check("the secondaries sit under their heading", #textsWith(L, "Secondary") == 1)
check("a completed objective carries its marker", textsWith(L, "+")[1] ~= nil)
check("and a failed one its own", textsWith(L, "x")[1] ~= nil)
check("in the state's colour", textsWith(L, "Take the keep.")[1].color == MODEL.COLOUR.complete)
check("an objective's text clears its marker",
	textsWith(L, "Take the keep.")[1].x == MODEL.OBJECTIVES_LEFT + MODEL.PAD + MODEL.MARKER_WIDTH)

local long = { objectives = { {
	id = "keep",
	kind = "primary",
	text = string.rep("word ", 12) .. "end",
	state = "active",
} } }
L = MODEL.layout(long, measure, VIEW)
check("a long objective wraps into more rows",
	L.rects[1].h > 2 * MODEL.PAD + 2 * MODEL.LINE_HEIGHT, L.rects[1].h)
check("with the marker on the first row only", #textsWith(L, "-") == 1)

-- The dialogue panel.

local LINE = { speaker = "HQ", text = "Contact!", portrait = "hq.png" }
L = MODEL.layout({ objectives = {}, line = LINE }, measure, VIEW)

check("dialogue lays a backdrop", L.rects[1] ~= nil and L.rects[1].kind == "dialogue")
check("tall enough for its portrait",
	L.rects[1].h == MODEL.PORTRAIT_SIZE + 2 * MODEL.PAD, L.rects[1].h)
check("the portrait is handed over for the widget to texture",
	L.portrait ~= nil and L.portrait.file == "hq.png" and L.portrait.w == MODEL.PORTRAIT_SIZE)
check("and the speaker starts past it",
	textsWith(L, "HQ")[1].x == L.rects[1].x + MODEL.PAD + MODEL.PORTRAIT_SIZE + MODEL.PAD)
check("with the line under the speaker", #textsWith(L, "Contact!") == 1)

L = MODEL.layout({ objectives = {}, line = LINE, portraitBad = true }, measure, VIEW)
check("a portrait that would not load is left out", L.portrait == nil)
check("and the text takes its room", textsWith(L, "HQ")[1].x == L.rects[1].x + MODEL.PAD)

-- The debrief.

local DEBRIEF = { outcome = "victory", objectives = MODEL.objectives(MISSION, read) }
L = MODEL.layout({ objectives = {}, debrief = DEBRIEF }, measure, VIEW)

check("the debrief lays a backdrop", L.rects[1] ~= nil and L.rects[1].kind == "debrief")
check("centred on the screen", L.debriefBox ~= nil
	and L.debriefBox[1] == (VIEW.w - math.min(MODEL.DEBRIEF_WIDTH, VIEW.w * 0.6)) / 2,
	L.debriefBox and L.debriefBox[1])
check("the box is the backdrop, which is what a dismissing click is tested against",
	L.debriefBox[1] == L.rects[1].x and L.debriefBox[3] == L.rects[1].x + L.rects[1].w)
local headline = textsWith(L, "Mission accomplished")[1]
check("the headline says how it went", headline ~= nil)
check("across the middle, at twice the title size",
	headline ~= nil and headline.options == "co" and headline.size == MODEL.TITLE_SIZE * 2)
check("in the outcome's colour", headline ~= nil and headline.color == MODEL.COLOUR.victory)
check("with the objectives listed under it", #textsWith(L, "Take the keep.") == 1)

-- The scene key, which is what decides a re-upload.

local function key(scene)
	return MODEL.sceneKey(scene)
end

local BASE = { objectives = MODEL.objectives(MISSION, read) }
check("the same scene keys the same", key(BASE) == key({ objectives = MODEL.objectives(MISSION, read) }))
check("an objective changing state changes the key",
	key(BASE) ~= key({ objectives = MODEL.objectives(MISSION, reader(objectiveParams({ keep = 1 }))) }))
check("a line taking the panel changes the key", key(BASE) ~= key({ objectives = BASE.objectives, line = LINE }))
check("a portrait going bad changes the key",
	key({ objectives = BASE.objectives, line = LINE })
		~= key({ objectives = BASE.objectives, line = LINE, portraitBad = true }))
check("the debrief appearing changes the key",
	key(BASE) ~= key({ objectives = BASE.objectives, debrief = DEBRIEF }))

--------------------------------------------------------------------------------
-- Packing, and the matrix that maps it to the screen.
--------------------------------------------------------------------------------

local verts, idx = MODEL.pack({
	{ x = 0, y = 0, w = 10, h = 10, color = { 1, 0, 0, 1 } },
	{ x = 20, y = 0, w = 10, h = 10, color = { 0, 1, 0, 1 } },
})
check("pack emits nine floats per vertex, four vertices per rect", #verts == 2 * 4 * 9, #verts)
check("pack emits six indices per rect", #idx == 12, #idx)
check("a vertex is position, uv, then colour",
	verts[1] == 0 and verts[2] == 0 and verts[3] == 0
		and verts[4] == 0 and verts[5] == 0
		and verts[6] == 1 and verts[7] == 0 and verts[8] == 0 and verts[9] == 1)
check("the second rect's indices carry on from the first", idx[7] == 4, idx[7])

local none, noneIdx = MODEL.pack({})
check("packing nothing is empty", #none == 0 and #noneIdx == 0)

local m = MODEL.ortho(1920, 1080)
check("ortho is sixteen numbers", #m == 16)
check("ortho maps the view to clip space",
	m[1] == 2 / 1920 and m[6] == 2 / 1080 and m[13] == -1 and m[14] == -1 and m[16] == 1)

support.report()
