-- Coilbox mission runtime: the mission's panels.
--
-- Vendored into a game by coilbox. Change it in the coilbox repository under
-- lua/mission-runtime/ and install again, or the next runtime update will
-- overwrite the edit.
--
-- Three things the player sees, and nothing else:
--
-- - the objectives panel, a standing list of what the mission is asking for;
-- - the dialogue panel, one radio message at a time with its speaker, portrait
--   and voice clip;
-- - the debrief, once the mission is over, with how each objective ended.
--
-- Plus the name over a named actor, because nothing in the engine renames a unit
-- and a character the author called "Warlord" has to say so somewhere.
--
-- What to draw is decided in luaui/mission_ui/coilbox_panel_model.lua, which is
-- pure and tested outside the engine. This file is the engine half: reading the
-- world, and putting pixels on the screen.
--
-- The widget reads the mission's state out of game rules params, which every Lua
-- handle can read, and hears about a line of dialogue through a global the
-- gadget's unsynced half calls. It never talks back: nothing on one player's
-- screen may reach the game.

local WIDGET_NAME = "Coilbox mission UI"
local LOG_SECTION = "coilbox-mission"

-- The global the gadget's unsynced half calls to say a line. Registered on the
-- widget handler in Initialize and taken back down in Shutdown.
local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"

function widget:GetInfo()
	return {
		name = WIDGET_NAME,
		desc = "Objectives, dialogue and debrief for a coilbox scenario",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		layer = 0,
		enabled = true,
	}
end

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

--------------------------------------------------------------------------------
-- Look. Every number the panels are drawn with, in one place.
--------------------------------------------------------------------------------

local PAD = 10
local BACKDROP = { 0, 0, 0, 0.55 }

local TITLE_SIZE = 14
local TEXT_SIZE = 13
local LINE_HEIGHT = 17
-- How far the text of an objective sits from its marker.
local MARKER_WIDTH = 12

local OBJECTIVES_WIDTH = 300
local OBJECTIVES_TOP = 0.72
local OBJECTIVES_LEFT = 16

local DIALOGUE_WIDTH = 760
local DIALOGUE_BOTTOM = 0.14
local PORTRAIT_SIZE = 84

local DEBRIEF_WIDTH = 640

local LABEL_SIZE = 14
-- How far above a unit its name floats, in elmos.
local LABEL_HEIGHT = 30

local COLOUR = {
	active = { 0.88, 0.88, 0.88 },
	complete = { 0.45, 0.9, 0.5 },
	failed = { 0.95, 0.45, 0.45 },
	title = { 1, 0.85, 0.4 },
	label = { 1, 0.9, 0.6 },
	victory = { 0.5, 0.95, 0.55 },
	defeat = { 0.95, 0.45, 0.45 },
	undecided = { 0.85, 0.85, 0.85 },
}

local MARKER = {
	active = "-",
	complete = "+",
	failed = "x",
}

local HEADLINE = {
	victory = "Mission accomplished",
	defeat = "Mission failed",
	undecided = "Mission ended",
}

--------------------------------------------------------------------------------
-- State.
--------------------------------------------------------------------------------

-- Nothing is drawn and no callin does any work until Initialize has the mission
-- and the model in hand. A widget that has removed itself should never draw, and
-- one that draws from a half-loaded mission is a stack trace every frame.
local ready = false
local registered = false

local MODEL
local MISSION
local MISSION_DIR

local queue
local debrief
local myAllyTeam = 0
local vsx, vsy = 1024, 768

-- Portraits that would not load, so a missing file is one warning rather than
-- one per frame.
local badTexture = {}

local function read(name)
	return Spring.GetGameRulesParam(name)
end

--- The width of a string, in multiples of the font size, which is what
-- gl.GetTextWidth answers and what the model wraps against.
local function measure(value)
	return gl.GetTextWidth(value)
end

--------------------------------------------------------------------------------
-- Loading.
--------------------------------------------------------------------------------

--- Read a Lua table out of the game archive. `env` is an empty table for the
-- compiled mission, which is data and may not reach for a global, and nil for
-- the model, which is code and runs in the widget's own environment.
local function includeTable(path, env)
	if not VFS.FileExists(path, VFS.ZIP) then
		return nil, path .. " is missing"
	end
	local ok, value = pcall(VFS.Include, path, env, VFS.ZIP)
	if not ok then
		return nil, path .. " failed to load: " .. tostring(value)
	end
	if type(value) ~= "table" then
		return nil, path .. " did not return a table"
	end
	return value
end

--------------------------------------------------------------------------------
-- Drawing helpers.
--------------------------------------------------------------------------------

local function colour(rgb, alpha)
	gl.Color(rgb[1], rgb[2], rgb[3], alpha or 1)
end

local function backdrop(x0, y0, x1, y1)
	gl.Color(BACKDROP[1], BACKDROP[2], BACKDROP[3], BACKDROP[4])
	gl.Rect(x0, y0, x1, y1)
end

--- One line of text, with the black outline that keeps it readable over whatever
-- the map happens to be underneath.
local function text(value, x, y, size, options)
	gl.Text(value, x, y, size or TEXT_SIZE, options or "o")
end

--- Lay a list of objectives out as drawable rows: a heading before the
-- secondaries, and one row per wrapped line with the marker on the first.
--
-- Laid out before anything is drawn, because a panel's backdrop has to know how
-- tall the panel turned out once every objective was wrapped.
local function objectiveRows(entries, wrapWidth)
	local rows = {}
	local secondaries = false
	for _, entry in ipairs(entries) do
		if entry.kind == "secondary" and not secondaries then
			secondaries = true
			rows[#rows + 1] = { heading = "Secondary" }
		end
		for index, line in ipairs(MODEL.wrap(entry.text, wrapWidth / TEXT_SIZE, measure)) do
			rows[#rows + 1] = {
				state = entry.state,
				marker = index == 1 and MARKER[entry.state] or "",
				text = line,
			}
		end
	end
	return rows
end

--- Draw laid-out rows downwards from a baseline.
local function drawRows(rows, x, y)
	for _, row in ipairs(rows) do
		y = y - LINE_HEIGHT
		if row.heading then
			colour(COLOUR.title, 0.75)
			text(row.heading, x, y)
		else
			colour(COLOUR[row.state])
			text(row.marker, x, y)
			text(row.text, x + MARKER_WIDTH, y)
		end
	end
end

--------------------------------------------------------------------------------
-- The objectives panel.
--------------------------------------------------------------------------------

local function drawObjectives()
	local entries = MODEL.objectives(MISSION, read)
	if #entries == 0 then
		return
	end

	local width = math.min(OBJECTIVES_WIDTH, vsx * 0.25)
	local rows = objectiveRows(entries, width - (PAD * 2) - MARKER_WIDTH)

	local x0 = OBJECTIVES_LEFT
	local top = vsy * OBJECTIVES_TOP
	local height = (PAD * 2) + LINE_HEIGHT + (#rows * LINE_HEIGHT)

	backdrop(x0, top - height, x0 + width, top)

	local y = top - PAD - TITLE_SIZE
	colour(COLOUR.title)
	text("Objectives", x0 + PAD, y, TITLE_SIZE)
	drawRows(rows, x0 + PAD, y)
end

--------------------------------------------------------------------------------
-- The dialogue panel.
--------------------------------------------------------------------------------

--- Where a dialogue clip or portrait lives. The launch path copies a scenario's
-- media in beside the compiled mission, so the bare file name the scenario
-- carries is resolved against the mission's own folder.
local function mediaPath(file)
	return MISSION_DIR .. file
end

local function drawDialogue()
	local line = queue.current()
	if not line then
		return
	end

	local width = math.min(DIALOGUE_WIDTH, vsx * 0.62)
	local x0 = (vsx - width) * 0.5
	local y0 = vsy * DIALOGUE_BOTTOM

	local portrait = line.portrait and not badTexture[line.portrait]
	local textLeft = x0 + PAD + (portrait and (PORTRAIT_SIZE + PAD) or 0)
	local wrapWidth = (x0 + width - PAD) - textLeft

	local rows = MODEL.wrap(line.text, wrapWidth / TEXT_SIZE, measure)
	local body = (PAD * 2) + LINE_HEIGHT + (#rows * LINE_HEIGHT)
	local height = math.max(body, PORTRAIT_SIZE + (PAD * 2))

	backdrop(x0, y0, x0 + width, y0 + height)

	if portrait then
		local py = y0 + ((height - PORTRAIT_SIZE) * 0.5)
		gl.Color(1, 1, 1, 1)
		if gl.Texture(mediaPath(line.portrait)) then
			gl.TexRect(x0 + PAD, py, x0 + PAD + PORTRAIT_SIZE, py + PORTRAIT_SIZE)
			gl.Texture(false)
		else
			badTexture[line.portrait] = true
			log("warning", "could not load dialogue portrait " .. mediaPath(line.portrait))
		end
	end

	local y = y0 + height - PAD - TITLE_SIZE
	colour(COLOUR.title)
	text(tostring(line.speaker or ""), textLeft, y, TITLE_SIZE)

	colour(COLOUR.active)
	for _, row in ipairs(rows) do
		y = y - LINE_HEIGHT
		text(row, textLeft, y)
	end
end

--------------------------------------------------------------------------------
-- The debrief.
--------------------------------------------------------------------------------

--- Build the debrief from the mirrored outcome, once, whichever of the GameOver
-- callin and the mirror notices first.
local function buildDebrief()
	if debrief then
		return
	end

	local built = MODEL.debrief(MISSION, read, myAllyTeam)
	if not built then
		return
	end

	built.rows = objectiveRows(
		built.objectives,
		math.min(DEBRIEF_WIDTH, vsx * 0.6) - (PAD * 2) - MARKER_WIDTH)
	debrief = built
	queue.clear()
end

local function debriefBox()
	local width = math.min(DEBRIEF_WIDTH, vsx * 0.6)
	local height = (PAD * 3) + (TITLE_SIZE * 2) + (#debrief.rows * LINE_HEIGHT)
	local x0 = (vsx - width) * 0.5
	local y0 = (vsy - height) * 0.5
	return x0, y0, x0 + width, y0 + height
end

local function drawDebrief()
	local x0, y0, x1, y1 = debriefBox()
	backdrop(x0, y0, x1, y1)

	local y = y1 - PAD - (TITLE_SIZE * 2)
	colour(COLOUR[debrief.outcome])
	text(HEADLINE[debrief.outcome], (x0 + x1) * 0.5, y, TITLE_SIZE * 2, "co")
	drawRows(debrief.rows, x0 + PAD, y - PAD)
end

--------------------------------------------------------------------------------
-- Names over named actors.
--------------------------------------------------------------------------------

--- An actor the author named, drawn over its unit.
--
-- GetUnitViewPosition answers nothing for a unit this player cannot see, so a
-- name never gives away where a hidden character is standing.
local function drawLabels()
	colour(COLOUR.label)
	for _, label in ipairs(MODEL.labels(MISSION, read)) do
		local x, y, z = Spring.GetUnitViewPosition(label.unitID)
		if x then
			local sx, sy, sz = Spring.WorldToScreenCoords(x, y + LABEL_HEIGHT, z)
			-- Past the far plane is behind the camera, where the projection puts the
			-- point back on screen mirrored through the middle.
			if sz and sz <= 1 then
				text(label.name, sx, sy, LABEL_SIZE, "co")
			end
		end
	end
end

--------------------------------------------------------------------------------
-- Callins.
--------------------------------------------------------------------------------

function widget:Initialize()
	local model, modelError = includeTable("luaui/mission_ui/coilbox_panel_model.lua")
	if not model then
		log("error", modelError)
		widgetHandler:RemoveWidget()
		return
	end
	MODEL = model

	local id = MODEL.missionId(Spring.GetModOptions().coilbox_mission)
	if not id then
		-- A normal game. A widget that stays loaded to draw nothing is a widget in
		-- every game's list for no reason.
		widgetHandler:RemoveWidget()
		return
	end

	MISSION_DIR = "missions/" .. id .. "/"
	local mission, missionError = includeTable(MISSION_DIR .. "mission.lua", {})
	if not mission then
		log("error", missionError)
		widgetHandler:RemoveWidget()
		return
	end
	MISSION = mission

	local lines = {}
	for _, line in ipairs(MISSION.dialogue or {}) do
		lines[line.id] = line
	end
	queue = MODEL.newQueue({ lines = lines, gameSpeed = Game.gameSpeed })

	myAllyTeam = Spring.GetMyAllyTeamID()
	vsx, vsy = Spring.GetViewGeometry()

	registered = widgetHandler:RegisterGlobal(DIALOGUE_GLOBAL, function(lineId)
		queue.push(lineId)
	end)
	if not registered then
		log("error", DIALOGUE_GLOBAL .. " is already taken, so this mission will say nothing")
	end

	ready = true
end

function widget:Shutdown()
	if registered then
		widgetHandler:DeregisterGlobal(DIALOGUE_GLOBAL)
		registered = false
	end
	ready = false
end

function widget:ViewResize(x, y)
	vsx, vsy = x, y
end

--- Dialogue runs on game time rather than on wall time, so a paused game does
-- not run through a conversation while nobody is watching.
function widget:GameFrame(frame)
	if not ready then
		return
	end
	local started = queue.update(frame)
	if started and started.audio then
		Spring.PlaySoundFile(mediaPath(started.audio), 1)
	end
	if not debrief and read(MODEL.OVER_PARAM) == 1 then
		buildDebrief()
	end
end

--- The engine hands the winning ally teams to this callin and the stock widget
-- handler drops them on the way, so the outcome is read from the mirror instead
-- and the argument is deliberately not taken.
function widget:GameOver()
	if ready then
		buildDebrief()
	end
end

--- Click the debrief away. It covers the middle of the screen, and a player who
-- wants to look at the map they just fought over should be able to.
function widget:MousePress(x, y)
	if not ready or not debrief then
		return false
	end
	local x0, y0, x1, y1 = debriefBox()
	if x < x0 or x > x1 or y < y0 or y > y1 then
		return false
	end
	debrief = nil
	return true
end

function widget:DrawScreen()
	if not ready then
		return
	end
	drawObjectives()
	drawDialogue()
	drawLabels()
	if debrief then
		drawDebrief()
	end
	gl.Color(1, 1, 1, 1)
end
