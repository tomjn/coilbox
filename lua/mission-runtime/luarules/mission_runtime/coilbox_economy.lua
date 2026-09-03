-- Coilbox mission runtime: a team's bank, what it is paid, and how much it can
-- hold.
--
-- Three actions and the per-frame payment behind one of them (issue #2422):
--
-- - `give_resources` moves a bank once. Positive is a gift, negative a drain.
-- - `set_income` says what a team is paid per second from now on, replacing
--   whatever the scenario or an earlier trigger set. Negative is a continuous
--   drain, which is the other half of what an author asking to bleed a team
--   wants: "take 1000 energy" and "take 5 energy a second" are two different
--   missions and neither is the other written smaller.
-- - `give_storage` moves how much a team can hold, which is the ceiling every
--   gift is clamped to.
--
-- The income the scenario itself stated is paid here too, rather than in the
-- gadget, because a mission that changes a team's income mid-way has to change
-- the thing that is actually being paid out. Two copies of that number is a
-- `set_income` that appears to do nothing.
--
-- This module calls the engine, so it lives under luarules/ with the rest of
-- the code.

local M = {}

-- What the engine calls each resource when reading a team's bank, when writing
-- it, and when writing what the team can hold. Three spellings of two
-- resources, all of them Spring's.
local READ = { metal = "metal", energy = "energy" }
local BANK = { metal = "m", energy = "e" }
local STORE = { metal = "ms", energy = "es" }

-- The order the two are worked through, so a log line and a test read the same
-- way twice. `pairs` over a two-key table is not ordered.
local KINDS = { "metal", "energy" }

--- Register the economy actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the handle, so a game's own actions move a bank the way these do
function M.register(engine, state)
	-- Trigger params name a participant, not an engine team.
	local engineTeam = {}
	-- Engine team -> what it is paid per second now, seeded from the scenario's
	-- own income. This is the table the payment reads, so `set_income` changes
	-- what actually arrives rather than a second copy of the number.
	local income = {}

	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
		income[team.team] = {
			metal = tonumber(team.metalIncome) or 0,
			energy = tonumber(team.energyIncome) or 0,
		}
	end

	local gameSpeed = tonumber(engine.ctx and engine.ctx.gameSpeed) or 30

	--- The number a parameter holds: the number itself, or the value of the var
	-- it names (issue #808). Every field of these three actions is an amount, so
	-- "give them the bonus" is a var rather than a number the author has to fix
	-- when they write the trigger.
	--
	-- `state.vars` is registered before this module, so it is there. The fallback
	-- is for a host that registers in another order rather than a case anything
	-- here reaches.
	local function amount(value)
		if state.vars and state.vars.amount then
			return state.vars.amount(value)
		end
		return tonumber(value) or 0
	end

	--- The engine team a participant id names, or nil once it has said so.
	local function teamOf(name, what)
		local team = engineTeam[name]
		if not team then
			engine:report("economy-team:" .. tostring(what) .. ":" .. tostring(name), "warning",
				"no team named " .. tostring(name) .. " in this mission, so " .. what .. " did nothing")
		end
		return team
	end

	--- Move a team's bank by `delta`: positive is a gift, negative a drain.
	--
	-- A gift goes through Spring.AddTeamResource, which is what a resource
	-- arriving looks like to the engine and to the post-game graph. A drain
	-- cannot: that call clamps its amount at zero, so it can only ever hand
	-- resources out.
	--
	-- So a drain reads the bank back and writes it down. Not
	-- Spring.UseTeamResource, which refuses outright when there is less there
	-- than was asked for: a mission taking 1000 energy off a team holding 400
	-- means take what they have, not leave them the 400.
	--
	-- Neither counts as anything a unit spent, which is the price of a drain the
	-- mission decides on rather than one the game earned.
	local function move(team, kind, delta)
		if delta == 0 then
			return
		end
		if delta > 0 then
			Spring.AddTeamResource(team, BANK[kind], delta)
			return
		end
		-- Parenthesised: Spring.GetTeamResources answers with nine values and
		-- tonumber would read the second of them as a base.
		local held = tonumber((Spring.GetTeamResources(team, READ[kind]))) or 0
		local left = held + delta
		Spring.SetTeamResource(team, BANK[kind], left > 0 and left or 0)
	end

	local handle = {}

	--- Move a team's bank once. This is `give_resources`.
	function handle.give(name, amounts)
		local team = teamOf(name, "give_resources")
		if not team then
			return
		end
		for _, kind in ipairs(KINDS) do
			if amounts[kind] ~= nil then
				move(team, kind, amount(amounts[kind]))
			end
		end
	end

	--- Say what a team is paid per second from now on. This is `set_income`.
	--
	-- A resource the action does not name is left where it was, so "bleed their
	-- energy" is one field rather than an author having to restate the metal
	-- they never meant to touch.
	function handle.setIncome(name, amounts)
		local team = teamOf(name, "set_income")
		if not team then
			return
		end
		income[team] = income[team] or { metal = 0, energy = 0 }
		for _, kind in ipairs(KINDS) do
			if amounts[kind] ~= nil then
				income[team][kind] = amount(amounts[kind])
			end
		end
	end

	--- What a team is paid per second now, for anything that has to read it back.
	function handle.income(name)
		local team = engineTeam[name]
		local rates = team and income[team]
		return rates and { metal = rates.metal, energy = rates.energy } or nil
	end

	--- Move how much a team can hold. This is `give_storage`.
	--
	-- Read and written rather than set outright, because the action is a gift of
	-- storage rather than a statement of it: a mission that hands the player a
	-- bigger tank should not also decide what the rest of their tanks were worth.
	-- The engine clamps what is held down to the new ceiling itself, so shrinking
	-- storage spills the excess the way losing a storage building does.
	function handle.giveStorage(name, amounts)
		local team = teamOf(name, "give_storage")
		if not team then
			return
		end
		for _, kind in ipairs(KINDS) do
			local delta = amounts[kind] ~= nil and amount(amounts[kind]) or 0
			if delta ~= 0 then
				local _, most = Spring.GetTeamResources(team, READ[kind])
				local ceiling = (tonumber(most) or 0) + delta
				Spring.SetTeamResource(team, STORE[kind], ceiling > 0 and ceiling or 0)
			end
		end
	end

	--- Pay every team its income, spread over the second it is quoted per. The
	-- gadget calls this once a frame, from the frame the game starts playing.
	function handle.pay()
		for _, team in ipairs(state.teams or {}) do
			local rates = income[team.team]
			if rates then
				for _, kind in ipairs(KINDS) do
					move(team.team, kind, rates[kind] / gameSpeed)
				end
			end
		end
	end

	engine:addAction("give_resources", function(params)
		handle.give(params.team, params)
	end)

	engine:addAction("set_income", function(params)
		handle.setIncome(params.team, params)
	end)

	engine:addAction("give_storage", function(params)
		handle.giveStorage(params.team, params)
	end)

	return handle
end

return M
