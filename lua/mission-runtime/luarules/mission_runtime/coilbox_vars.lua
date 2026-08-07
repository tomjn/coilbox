-- Coilbox mission runtime: mission variables, and the three types that use them.
--
-- A var is a named number belonging to one mission: a kill counter, a phase
-- number, a flag saying which branch the player took. Numbers and nothing else,
-- by design, so `add_var` always has something to add to and the `var` condition
-- is one comparison. The scenario's `vars` table is the name and the number each
-- one starts at.
--
-- Either side of a comparison or a sum may be a var rather than a written
-- number. The three types below take their `value` as an amount, which is a
-- number or `{ var = "quota" }`, so a mission can say "kills reached the quota"
-- without the author fixing the quota when they write the trigger (issue #808).
-- That is what runtime 3 added: a runtime behind it reads the table as no
-- number at all and falls back to zero.
--
-- Every write is mirrored into a game rules param, because a var nothing outside
-- synced Lua can read is no use to an objectives panel, a debrief or a debug
-- view. Reading the mirror needs no line of sight and no channel: the engine
-- answers Spring.GetGameRulesParam for every handle, LuaUI included.

local M = {}

--- What a var is called once mirrored. Prefixed because a game's own gadgets
-- share that namespace and a mission's var names are whatever its author typed.
M.RULES_PREFIX = "coilbox_mission_var_"

--- The comparisons a var condition can make, by the name the scenario uses.
local COMPARE = {
	eq = function(a, b)
		return a == b
	end,
	ne = function(a, b)
		return a ~= b
	end,
	lt = function(a, b)
		return a < b
	end,
	lte = function(a, b)
		return a <= b
	end,
	gt = function(a, b)
		return a > b
	end,
	gte = function(a, b)
		return a >= b
	end,
}

--- Register the var condition and the two var actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the vars themselves, so a game's own actions read and write them the
--   way these do rather than around them
function M.register(engine, state)
	-- Var name -> its number now.
	local values = {}
	-- The names the scenario declared. A name that is not one of these can only
	-- come from a mission built by a newer editor or edited by hand, because the
	-- compile step resolves every var a trigger names against this table.
	local declared = {}

	local vars = {}

	--- Say once that a mission is using a var it never declared. Not fatal: an
	-- unset number is zero, and refusing would turn one stray name into a mission
	-- that half runs.
	local function announce(name)
		if not declared[name] then
			engine:report("var:" .. tostring(name), "warning",
				"no var named " .. tostring(name) .. " in this mission, treating it as 0")
		end
	end

	--- Write a var.
	--
	-- The mirror is a copy for readers, not the var itself: the engine keeps a
	-- rules param as a float, so this table stays the one the mission runs on and
	-- the arithmetic stays in Lua's own numbers.
	function vars.set(name, value)
		announce(name)
		values[name] = value
		Spring.SetGameRulesParam(M.RULES_PREFIX .. name, value)
	end

	--- Read a var. One never declared and never written reads as zero.
	function vars.get(name)
		local value = values[name]
		if value == nil then
			announce(name)
			return 0
		end
		return value
	end

	--- Move a var by a delta, which is the whole of a counter.
	function vars.add(name, delta)
		vars.set(name, vars.get(name) + delta)
	end

	--- The number a parameter holds: the number itself, or the value of the var
	-- it names. Published so a game's own action reads an amount the way these do
	-- rather than inventing a second spelling of it.
	--
	-- Anything that is neither is zero, which is what an unset var reads as, so a
	-- mission written by a newer editor loses the parameter rather than the run.
	function vars.amount(value)
		if type(value) == "table" and value.var ~= nil then
			return vars.get(tostring(value.var))
		end
		return tonumber(value) or 0
	end

	for name, initial in pairs((state.mission or {}).vars or {}) do
		declared[name] = true
		vars.set(name, tonumber(initial) or 0)
	end

	-- Polled, not event-driven. A var changes only when an action changes it, so
	-- an event looks like the obvious fit, until a trigger reading a var nothing
	-- has changed yet -- a mission's opening branch, reading the number its author
	-- set -- is never asked at all and the mission stalls. A var condition is a
	-- reading, and readings are polled.
	engine:addCondition("var", {
		test = function(params)
			local compare = COMPARE[params.op]
			if not compare then
				engine:report("var-op:" .. tostring(params.op), "warning",
					"no comparison named " .. tostring(params.op) .. ", treating the condition as false")
				return false
			end
			return compare(vars.get(params.name), vars.amount(params.value))
		end,
	})

	engine:addAction("set_var", function(params)
		vars.set(params.name, vars.amount(params.value))
	end)

	engine:addAction("add_var", function(params)
		vars.add(params.name, vars.amount(params.value))
	end)

	return vars
end

return M
