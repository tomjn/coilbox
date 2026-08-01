-- Coilbox mission runtime: the trigger conditions that read units.
--
-- These are the conditions the engine can answer on its own, without zones,
-- vars or groups: an actor's death, its health, what a team has built, what it
-- owns, and who took an actor off it. They are registered onto the trigger
-- engine the same way every other module registers its own, and the gadget
-- feeds the hooks this returns from its unit callins.
--
-- Read-only. It calls the engine to count and measure, and changes nothing.

local M = {}

--- Whether a count sits inside an optional min and max. A condition that states
-- neither is asking nothing and holds.
local function within(count, min, max)
	if min and count < min then
		return false
	end
	if max and count > max then
		return false
	end
	return true
end

--- Register the unit conditions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the hooks the gadget's unit callins feed
function M.register(engine, state)
	-- Trigger params name a participant, not an engine team. The mapping is
	-- fixed once the mission has started, so it is taken once.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	-- Engine team -> unit def name -> how many that team has finished building.
	-- A tally rather than a count of what is standing, because "has built two
	-- factories" stays true after one of them dies.
	local built = {}
	-- Actor id -> the engine team that last took it.
	local captured = {}

	--- The actor's unit, or nil when the actor is dead or never spawned.
	local function unitOf(params)
		return state.units[params.actor]
	end

	engine:addCondition("unit_dead", {
		events = { "unit_destroyed" },
		test = function(params)
			return unitOf(params) == nil
		end,
	})

	-- Polled: health slides rather than jumps, and the engine has no callin for
	-- crossing a threshold. A destroyed actor counts as below any threshold, so
	-- an actor killed in one hit still trips a "wounded" trigger.
	engine:addCondition("unit_health_below", {
		test = function(params)
			local fraction = tonumber(params.fraction) or 0
			local unitID = unitOf(params)
			if not unitID then
				return fraction > 0
			end

			local health, maxHealth = Spring.GetUnitHealth(unitID)
			if not health or not maxHealth or maxHealth <= 0 then
				return false
			end
			return health < maxHealth * fraction
		end,
	})

	engine:addCondition("unit_built", {
		events = { "unit_finished" },
		test = function(params)
			local team = engineTeam[params.team]
			local tally = team and built[team] and built[team][params.unitDef] or 0
			return tally >= (tonumber(params.count) or 1)
		end,
	})

	engine:addCondition("unit_captured", {
		events = { "unit_captured" },
		test = function(params)
			local taker = captured[params.actor]
			if not taker then
				return false
			end
			if params.team == nil then
				return true
			end
			return taker == engineTeam[params.team]
		end,
	})

	--- How many of a team's units are mission anchors rather than its own.
	--
	-- An anchor is there to keep the engine from deciding a team with nothing
	-- left has lost, and a mission asking "does the player have anything left"
	-- has to get the answer it would have got without one.
	local function anchors(team, defID)
		if not state.gameOver then
			return 0
		end
		return state.gameOver.anchorCount(team, defID)
	end

	-- Polled: a team's holdings change with every death and every build, and an
	-- aggregate nobody can see change is not worth a callin per unit.
	engine:addCondition("unit_count", {
		test = function(params)
			local team = engineTeam[params.team]
			if not team then
				return false
			end

			local count = 0
			local defs = params.unitDefs
			if defs and #defs > 0 then
				for _, name in ipairs(defs) do
					local def = UnitDefNames[name]
					if def then
						count = count + Spring.GetTeamUnitDefCount(team, def.id) - anchors(team, def.id)
					end
				end
			else
				count = (Spring.GetTeamUnitCount(team) or 0) - anchors(team)
			end

			return within(count, tonumber(params.min), tonumber(params.max))
		end,
	})

	local hooks = {}

	--- A unit finished building. Counted against the team that owns it, by def
	-- name, because that is what a scenario names.
	function hooks.finished(unitDefID, unitTeam)
		local def = UnitDefs[unitDefID]
		if not def then
			return
		end
		built[unitTeam] = built[unitTeam] or {}
		built[unitTeam][def.name] = (built[unitTeam][def.name] or 0) + 1
	end

	--- An actor changed hands. The engine tells Lua a unit was transferred but
	-- not why, so a mission gifting one of its own actors away reads as a
	-- capture. Missions that do both to the same actor are the price.
	function hooks.captured(actorId, newTeam)
		captured[actorId] = newTeam
	end

	return hooks
end

return M
