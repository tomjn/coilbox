-- Coilbox mission runtime: what the mission panels show.
--
-- Everything the objectives panel, the dialogue panel and the debrief decide
-- before they draw anything: which objectives are visible and in what order,
-- which line of dialogue is on screen and for how long, how a line of text
-- breaks across a width, and whether the player won.
--
-- Pure. No engine calls, no globals beyond the Lua standard library, no drawing.
-- Reading the world arrives as a `read(name)` function answering a game rules
-- param, and measuring text arrives as a `measure(text)` function. That is what
-- makes a widget's decisions provable with plain luajit and no engine, which
-- matters more here than in a gadget: nothing else about a widget is.
--
-- That now includes where every pixel goes. layout() turns a scene into
-- rectangles and texts in screen coordinates, sceneKey() says when the scene
-- has changed, and pack() flattens the rectangles into the arrays the widget
-- uploads to a vertex buffer, so the widget itself only uploads and draws.

local M = {}

-- The mirrors the synced half writes, all four of them contracts: the gadget's
-- objectives module owns the first, the gadget itself the second, and its game
-- over module the rest.
M.OBJECTIVE_PREFIX = "coilbox_mission_objective_"
M.ACTOR_PREFIX = "coilbox_mission_actor_"
M.OVER_PARAM = "coilbox_mission_over"
M.WINNERS_PARAM = "coilbox_mission_winners"
M.WINNER_PREFIX = "coilbox_mission_winner_"

-- An objective's state, as the numbers the mirror carries.
M.ACTIVE = 0
M.COMPLETE = 1
M.FAILED = -1

local STATE = {
	[M.COMPLETE] = "complete",
	[M.FAILED] = "failed",
}

-- How long a line of dialogue holds the panel. Long enough to read, and capped
-- so a mission that fires a paragraph does not stop saying anything else.
M.MIN_SECONDS = 3
M.MAX_SECONDS = 12
M.SECONDS_PER_CHARACTER = 0.06

-- Lines waiting behind the one on screen. A repeating trigger firing dialogue
-- would otherwise build a backlog the player is still hearing minutes later.
M.MAX_QUEUED = 6

local DEFAULT_GAME_SPEED = 30

--- The scenario id from the modoption, or nothing.
--
-- The id becomes part of a VFS path, so anything that is not a plain name is
-- refused rather than followed. The gadget keeps its own copy of this rule
-- because a gadget cannot read anything under luaui/.
function M.missionId(raw)
	if type(raw) ~= "string" then
		return nil
	end
	local id = raw:match("^%s*(.-)%s*$")
	if id == "" or not id:match("^[%w._%-]+$") or id:match("^%.+$") then
		return nil
	end
	return id
end

--- One objective's state, as a word.
--
-- Every declared objective is mirrored before the first frame, so a missing
-- param means an objective this reader knows about and the runtime does not:
-- still open is the honest answer for one.
function M.objectiveState(id, read)
	return STATE[read(M.OBJECTIVE_PREFIX .. id)] or "active"
end

--- The objectives to draw, in the order to draw them.
--
-- Primaries first and secondaries after, each in the order the scenario lists
-- them, because that is how a player reads a list of what they must do and then
-- what they might.
--
-- A hidden objective is left out while it is still active. Being hidden is not
-- being secret forever: an author hides the twist, and completing or failing it
-- is what reveals it.
function M.objectives(mission, read)
	local primary, secondary = {}, {}
	for _, objective in ipairs((mission or {}).objectives or {}) do
		local state = M.objectiveState(objective.id, read)
		if not (objective.hidden and state == "active") then
			local entry = {
				id = objective.id,
				kind = objective.kind,
				text = objective.text,
				state = state,
			}
			if objective.kind == "secondary" then
				secondary[#secondary + 1] = entry
			else
				primary[#primary + 1] = entry
			end
		end
	end

	for _, entry in ipairs(secondary) do
		primary[#primary + 1] = entry
	end
	return primary
end

--- The name labels to draw over units, as { unitID =, name = }.
--
-- An actor's display name is the one piece of actor state that has no synced
-- engine call behind it: nothing renames a unit. So the name is drawn over the
-- unit instead, which means LuaUI needs to know which unit the actor became.
-- That arrives as the same kind of mirror an objective does.
--
-- An actor that is not on the map mirrors as 0, so it drops out here.
function M.labels(mission, read)
	local labels = {}
	for _, actor in ipairs((mission or {}).actors or {}) do
		local name = (actor.state or {}).name
		if name and name ~= "" then
			local unitID = read(M.ACTOR_PREFIX .. actor.id)
			if unitID and unitID > 0 then
				labels[#labels + 1] = { unitID = unitID, name = name }
			end
		end
	end
	return labels
end

--- How long a line of dialogue stays on screen, in frames.
--
-- Reading time from the length of the text. A voice clip's own length would be
-- better and there is no engine call that answers it, so a mission whose clip
-- runs longer than its text has the panel clear while the clip plays on.
local function duration(line, options)
	local seconds = #tostring(line.text or "") * options.secondsPerCharacter
	if seconds < options.minSeconds then
		seconds = options.minSeconds
	end
	if seconds > options.maxSeconds then
		seconds = options.maxSeconds
	end
	return math.floor(seconds * options.gameSpeed)
end

--- A dialogue queue.
--
-- One line at a time, in the order the mission fired them. Lines queue rather
-- than interrupt, because a trigger with two lines in it is an author writing an
-- exchange, and showing only the second would lose half of it.
--
-- `options.lines` is the scenario's dialogue by id. Everything else has a
-- default: `gameSpeed`, `minSeconds`, `maxSeconds`, `secondsPerCharacter` and
-- `maxQueued`.
function M.newQueue(options)
	options = options or {}
	options.gameSpeed = tonumber(options.gameSpeed) or DEFAULT_GAME_SPEED
	options.minSeconds = tonumber(options.minSeconds) or M.MIN_SECONDS
	options.maxSeconds = tonumber(options.maxSeconds) or M.MAX_SECONDS
	options.secondsPerCharacter = tonumber(options.secondsPerCharacter) or M.SECONDS_PER_CHARACTER
	options.maxQueued = tonumber(options.maxQueued) or M.MAX_QUEUED

	local lines = options.lines or {}
	local waiting = {}
	local showing = nil
	local untilFrame = 0

	local queue = {}

	--- Take a line the mission just fired. An id nothing declared is dropped
	-- here as well as in the synced half, because a widget reading a mission the
	-- gadget refused should still not draw a blank box.
	function queue.push(id)
		local line = lines[id]
		if not line then
			return nil
		end
		waiting[#waiting + 1] = line
		-- Oldest first. A backlog means the player is behind the mission, and the
		-- line worth keeping is the one nearest to now.
		while #waiting > options.maxQueued do
			table.remove(waiting, 1)
		end
		return line
	end

	--- Advance to this frame. Returns the line that has just taken the panel, so
	-- the caller knows when to start its clip, and nothing on a frame where the
	-- panel did not change.
	function queue.update(frame)
		if showing and frame >= untilFrame then
			showing = nil
		end
		if not showing and #waiting > 0 then
			showing = table.remove(waiting, 1)
			untilFrame = frame + duration(showing, options)
			return showing
		end
		return nil
	end

	--- The line on the panel now, or nothing.
	function queue.current()
		return showing
	end

	--- How many lines are waiting their turn.
	function queue.pending()
		return #waiting
	end

	--- Drop everything. The mission is over and the rest of the conversation is
	-- about a game that has already finished.
	function queue.clear()
		waiting = {}
		showing = nil
	end

	return queue
end

--- Break text across `maxWidth`, measured with `measure(text)`.
--
-- Greedy, on spaces, and on the newlines the author typed. A single word wider
-- than the line is left whole and overflows: breaking a unit name in half reads
-- worse than a line that runs long.
function M.wrap(text, maxWidth, measure)
	local rows = {}
	for paragraph in (tostring(text) .. "\n"):gmatch("(.-)\n") do
		local line = nil
		for word in paragraph:gmatch("%S+") do
			local candidate = line and (line .. " " .. word) or word
			if line and measure(candidate) > maxWidth then
				rows[#rows + 1] = line
				line = word
			else
				line = candidate
			end
		end
		rows[#rows + 1] = line or ""
	end
	return rows
end

--- What the debrief says, or nothing while the mission is still running.
--
-- The mission ends with Spring.GameOver and a list of winning ally teams, and a
-- player won if their own ally team is in it. The engine hands that list to the
-- GameOver callin, and the widget handler drops the argument on the way through,
-- so the list is read from the mirror instead of from the callin.
--
-- No winners at all is the engine's "undecided", which a mission reaches when
-- the only ally team there was is the one that lost. Calling that a defeat would
-- be right by accident, and calling a host dropping out a defeat would not.
function M.debrief(mission, read, myAllyTeam)
	if read(M.OVER_PARAM) ~= 1 then
		return nil
	end

	local outcome = "defeat"
	if (read(M.WINNERS_PARAM) or 0) == 0 then
		outcome = "undecided"
	elseif read(M.WINNER_PREFIX .. myAllyTeam) == 1 then
		outcome = "victory"
	end

	return {
		outcome = outcome,
		objectives = M.objectives(mission, read),
	}
end

--------------------------------------------------------------------------------
-- The look. Every number the panels are drawn with, in one place.
--------------------------------------------------------------------------------

M.PAD = 10
M.BACKDROP = { 0, 0, 0, 0.55 }

M.TITLE_SIZE = 14
M.TEXT_SIZE = 13
M.LINE_HEIGHT = 17
-- How far the text of an objective sits from its marker.
M.MARKER_WIDTH = 12

M.OBJECTIVES_WIDTH = 300
M.OBJECTIVES_TOP = 0.72
M.OBJECTIVES_LEFT = 16

M.DIALOGUE_WIDTH = 760
M.DIALOGUE_BOTTOM = 0.14
M.PORTRAIT_SIZE = 84

M.DEBRIEF_WIDTH = 640

M.LABEL_SIZE = 14
-- How far above a unit its name floats, in elmos.
M.LABEL_HEIGHT = 30

M.COLOUR = {
	active = { 0.88, 0.88, 0.88 },
	complete = { 0.45, 0.9, 0.5 },
	failed = { 0.95, 0.45, 0.45 },
	title = { 1, 0.85, 0.4 },
	-- The title colour at three quarters, because an inline colour code has no
	-- alpha and this is what the old translucent heading looked like over the
	-- backdrop.
	heading = { 0.75, 0.64, 0.3 },
	label = { 1, 0.9, 0.6 },
	victory = { 0.5, 0.95, 0.55 },
	defeat = { 0.95, 0.45, 0.45 },
	undecided = { 0.85, 0.85, 0.85 },
}

M.MARKER = {
	active = "-",
	complete = "+",
	failed = "x",
}

M.HEADLINE = {
	victory = "Mission accomplished",
	defeat = "Mission failed",
	undecided = "Mission ended",
}

--------------------------------------------------------------------------------
-- Layout.
--------------------------------------------------------------------------------

--- Lay a list of objectives out as drawable rows: a heading before the
-- secondaries, and one row per wrapped line with the marker on the first.
local function objectiveRows(entries, wrapWidth, measure)
	local rows = {}
	local secondaries = false
	for _, entry in ipairs(entries) do
		if entry.kind == "secondary" and not secondaries then
			secondaries = true
			rows[#rows + 1] = { heading = "Secondary" }
		end
		for index, line in ipairs(M.wrap(entry.text, wrapWidth / M.TEXT_SIZE, measure)) do
			rows[#rows + 1] = {
				state = entry.state,
				marker = index == 1 and M.MARKER[entry.state] or "",
				text = line,
			}
		end
	end
	return rows
end

--- Turn laid-out rows into texts, downwards from a baseline. Answers the y the
-- last row was drawn on.
local function rowTexts(texts, rows, x, y)
	for _, row in ipairs(rows) do
		y = y - M.LINE_HEIGHT
		if row.heading then
			texts[#texts + 1] = { x = x, y = y, size = M.TEXT_SIZE, text = row.heading,
				color = M.COLOUR.heading, options = "o" }
		else
			local colour = M.COLOUR[row.state]
			texts[#texts + 1] = { x = x, y = y, size = M.TEXT_SIZE, text = row.marker,
				color = colour, options = "o" }
			texts[#texts + 1] = { x = x + M.MARKER_WIDTH, y = y, size = M.TEXT_SIZE,
				text = row.text, color = colour, options = "o" }
		end
	end
	return y
end

local function objectivesPanel(L, entries, measure, view)
	if #entries == 0 then
		return
	end

	local width = math.min(M.OBJECTIVES_WIDTH, view.w * 0.25)
	local rows = objectiveRows(entries, width - (M.PAD * 2) - M.MARKER_WIDTH, measure)

	local x0 = M.OBJECTIVES_LEFT
	local top = view.h * M.OBJECTIVES_TOP
	local height = (M.PAD * 2) + M.LINE_HEIGHT + (#rows * M.LINE_HEIGHT)

	L.rects[#L.rects + 1] = { x = x0, y = top - height, w = width, h = height,
		color = M.BACKDROP, kind = "objectives" }

	local y = top - M.PAD - M.TITLE_SIZE
	L.texts[#L.texts + 1] = { x = x0 + M.PAD, y = y, size = M.TITLE_SIZE,
		text = "Objectives", color = M.COLOUR.title, options = "o" }
	rowTexts(L.texts, rows, x0 + M.PAD, y)
end

local function dialoguePanel(L, scene, measure, view)
	local line = scene.line
	if not line then
		return
	end

	local width = math.min(M.DIALOGUE_WIDTH, view.w * 0.62)
	local x0 = (view.w - width) * 0.5
	local y0 = view.h * M.DIALOGUE_BOTTOM

	local portrait = line.portrait and not scene.portraitBad
	local textLeft = x0 + M.PAD + (portrait and (M.PORTRAIT_SIZE + M.PAD) or 0)
	local wrapWidth = (x0 + width - M.PAD) - textLeft

	local rows = M.wrap(line.text, wrapWidth / M.TEXT_SIZE, measure)
	local body = (M.PAD * 2) + M.LINE_HEIGHT + (#rows * M.LINE_HEIGHT)
	local height = math.max(body, M.PORTRAIT_SIZE + (M.PAD * 2))

	L.rects[#L.rects + 1] = { x = x0, y = y0, w = width, h = height,
		color = M.BACKDROP, kind = "dialogue" }

	if portrait then
		L.portrait = {
			x = x0 + M.PAD,
			y = y0 + ((height - M.PORTRAIT_SIZE) * 0.5),
			w = M.PORTRAIT_SIZE,
			h = M.PORTRAIT_SIZE,
			file = line.portrait,
		}
	end

	local y = y0 + height - M.PAD - M.TITLE_SIZE
	L.texts[#L.texts + 1] = { x = textLeft, y = y, size = M.TITLE_SIZE,
		text = tostring(line.speaker or ""), color = M.COLOUR.title, options = "o" }
	for _, row in ipairs(rows) do
		y = y - M.LINE_HEIGHT
		L.texts[#L.texts + 1] = { x = textLeft, y = y, size = M.TEXT_SIZE,
			text = row, color = M.COLOUR.active, options = "o" }
	end
end

local function debriefPanel(L, debrief, measure, view)
	if not debrief then
		return
	end

	local width = math.min(M.DEBRIEF_WIDTH, view.w * 0.6)
	local rows = objectiveRows(debrief.objectives, width - (M.PAD * 2) - M.MARKER_WIDTH, measure)
	local height = (M.PAD * 3) + (M.TITLE_SIZE * 2) + (#rows * M.LINE_HEIGHT)
	local x0 = (view.w - width) * 0.5
	local y0 = (view.h - height) * 0.5
	local x1, y1 = x0 + width, y0 + height

	L.rects[#L.rects + 1] = { x = x0, y = y0, w = width, h = height,
		color = M.BACKDROP, kind = "debrief" }
	L.debriefBox = { x0, y0, x1, y1 }

	local y = y1 - M.PAD - (M.TITLE_SIZE * 2)
	L.texts[#L.texts + 1] = { x = (x0 + x1) * 0.5, y = y, size = M.TITLE_SIZE * 2,
		text = M.HEADLINE[debrief.outcome], color = M.COLOUR[debrief.outcome], options = "co" }
	rowTexts(L.texts, rows, x0 + M.PAD, y - M.PAD)
end

--- Lay a scene out: every rectangle and every line of text the widget draws,
-- in screen coordinates with the origin at the bottom left.
-- @param scene table objectives (from M.objectives), line (from the queue),
--   portraitBad (the line's portrait would not load), debrief (from M.debrief)
-- @param measure function(text) -> width in multiples of the font size
-- @param view table w, h of the screen
-- @return table rects { x, y, w, h, color, kind }, texts { x, y, size, text,
--   color, options }, portrait { x, y, w, h, file } or nil, and debriefBox
--   { x0, y0, x1, y1 } or nil, which is what a dismissing click is tested
--   against.
function M.layout(scene, measure, view)
	local L = { rects = {}, texts = {} }
	objectivesPanel(L, scene.objectives or {}, measure, view)
	dialoguePanel(L, scene, measure, view)
	debriefPanel(L, scene.debrief, measure, view)
	return L
end

--- One string per distinct scene, so the widget re-lays out and re-uploads
-- only when something on screen has actually changed. The line is keyed by id
-- because a mission's lines are declared once each, and the debrief by outcome
-- because its objectives are frozen when it is built.
function M.sceneKey(scene)
	local parts = {}
	for _, entry in ipairs(scene.objectives or {}) do
		parts[#parts + 1] = entry.id .. "=" .. entry.state
	end
	parts[#parts + 1] = scene.line and tostring(scene.line.id) or ""
	parts[#parts + 1] = scene.portraitBad and "bad" or ""
	parts[#parts + 1] = scene.debrief and scene.debrief.outcome or ""
	return table.concat(parts, "|")
end

--------------------------------------------------------------------------------
-- Packing, for the vertex buffer.
--------------------------------------------------------------------------------

local function quad(verts, idx, v, n, corners, c, i)
	for _, p in ipairs(corners) do
		verts[v + 1], verts[v + 2], verts[v + 3] = p[1], p[2], p[3]
		verts[v + 4], verts[v + 5] = p[4], p[5]
		verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
		v = v + 9
	end
	local base = (i - 1) * 4
	idx[n + 1], idx[n + 2], idx[n + 3] = base, base + 1, base + 2
	idx[n + 4], idx[n + 5], idx[n + 6] = base, base + 2, base + 3
	return v, n + 6
end

--- Flatten rectangles for the vertex buffer.
-- @param rects table[] x, y, w, h, color
-- @return number[] vertices, nine floats each (x, y, z, u, v, r, g, b, a),
--   four per rect, bottom left first, anticlockwise, z always 0
-- @return number[] indices, zero based, six per rect
function M.pack(rects)
	local verts, idx = {}, {}
	local v, n = 0, 0
	for i, r in ipairs(rects) do
		v, n = quad(verts, idx, v, n, {
			{ r.x, r.y, 0, 0, 0 },
			{ r.x + r.w, r.y, 0, 1, 0 },
			{ r.x + r.w, r.y + r.h, 0, 1, 1 },
			{ r.x, r.y + r.h, 0, 0, 1 },
		}, r.color, i)
	end
	return verts, idx
end

--- A column major orthographic matrix mapping screen pixels to clip space.
function M.ortho(w, h)
	return {
		2 / w, 0, 0, 0,
		0, 2 / h, 0, 0,
		0, 0, -1, 0,
		-1, -1, 0, 1,
	}
end

return M
