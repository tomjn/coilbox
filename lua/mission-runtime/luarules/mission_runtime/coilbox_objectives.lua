-- Coilbox mission runtime: the mission's objectives.
--
-- An objective is a line of text the player is working towards: "hold the keep
-- for 60 seconds", "get the convoy off the map". The scenario declares them and
-- triggers settle them, with `complete_objective` and `fail_objective`.
--
-- The runtime owns only what an objective *is*: whether it is still open, and
-- how it ended. Drawing it is LuaUI's, and an objective does not end the mission
-- on its own -- `victory` and `defeat` do, because a mission with three
-- objectives and one ending is the common case and guessing at it would be
-- wrong half the time.
--
-- Every change is mirrored into a game rules param, the way a var is, because
-- the panel that draws these runs outside synced Lua and the engine answers
-- Spring.GetGameRulesParam for every handle. The text and the kind are not
-- mirrored: they never change, and a reader that wants them reads the compiled
-- mission it is already looking at.

local M = {}

--- What an objective is called once mirrored. Prefixed because a game's own
-- gadgets share that namespace.
M.RULES_PREFIX = "coilbox_mission_objective_"

-- The three states, as the numbers the mirror carries. A rules param is a float,
-- so a state has to be one: 0 is still open, and the two outcomes sit either
-- side of it.
M.ACTIVE = 0
M.COMPLETE = 1
M.FAILED = -1

local VALUE = {
	active = M.ACTIVE,
	complete = M.COMPLETE,
	failed = M.FAILED,
}

--- Register the objective actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the objectives themselves, so a game's own actions settle them the way
--   these do rather than around them
function M.register(engine, state)
	-- Objective id -> the scenario's objective.
	local declared = {}
	-- Objective id -> "active", "complete" or "failed".
	local status = {}

	local objectives = {}

	--- Read an objective's state. An id the scenario never declared reads as
	-- nothing, because an objective is its text and its kind as much as its
	-- state, and the runtime cannot invent either.
	function objectives.get(id)
		return status[id]
	end

	--- Settle an objective, once.
	--
	-- The first outcome sticks. A repeating trigger that goes on failing an
	-- objective the player has already completed would otherwise rewrite the
	-- debrief every tick, and an author who wants a second chance at something
	-- writes a second objective.
	local function settle(id, outcome)
		local objective = declared[id]
		if not objective then
			engine:report("objective:" .. tostring(id), "warning",
				"no objective named " .. tostring(id) .. " in this mission, ignoring it")
			return
		end
		if status[id] ~= "active" then
			engine:report("objective-settled:" .. tostring(id), "warning", string.format(
				"objective %s is already %s, leaving it there", tostring(id), status[id]))
			return
		end

		status[id] = outcome
		Spring.SetGameRulesParam(M.RULES_PREFIX .. id, VALUE[outcome])
	end

	function objectives.complete(id)
		settle(id, "complete")
	end

	function objectives.fail(id)
		settle(id, "failed")
	end

	-- Before the first frame, so every objective the mission declares has a state
	-- to read from the moment the game starts rather than once something has
	-- happened to it. A hidden objective is mirrored too: what makes it hidden is
	-- being active, so a reader needs the state to know not to draw it.
	for _, objective in ipairs((state.mission or {}).objectives or {}) do
		declared[objective.id] = objective
		status[objective.id] = "active"
		Spring.SetGameRulesParam(M.RULES_PREFIX .. objective.id, M.ACTIVE)
	end

	engine:addAction("complete_objective", function(params)
		objectives.complete(params.objective)
	end)

	engine:addAction("fail_objective", function(params)
		objectives.fail(params.objective)
	end)

	return objectives
end

return M
