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

return M
