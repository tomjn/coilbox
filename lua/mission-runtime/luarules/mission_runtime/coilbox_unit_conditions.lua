-- Coilbox mission runtime: the trigger conditions that read units.
--
-- These are the conditions the engine can answer without zones or vars: an
-- actor's death and its health, who has hit an actor or a group, what a team has
-- built, what it owns, and who took an actor off it. They are registered onto
-- the trigger engine the same way every other module registers its own, and the
-- gadget feeds the hooks this returns from its unit callins.
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

	-- Who has hit each actor and each group a unit_attacked condition names, as
	-- id -> attacking engine team -> attacking def name -> the stamp of the last
	-- such hit. Only those named are kept, because every hit in the game comes
	-- past here.
	local actorHits, groupHits = {}, {}
	for _, trigger in ipairs((state.mission or {}).triggers or {}) do
		for _, condition in ipairs((trigger.conditions or {}).conditions or {}) do
			if condition.type == "unit_attacked" then
				local params = condition.params or {}
				if params.group ~= nil then
					groupHits[params.group] = {}
				elseif params.actor ~= nil then
					actorHits[params.actor] = {}
				end
			end
		end
	end

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

	--- How many of a team's units the runtime put there rather than the mission:
	-- anchors, which keep the engine from deciding a team with nothing left has
	-- lost, and spotters, which light a revealed area.
	--
	-- A mission asking "does the player have anything left" has to get the answer
	-- it would have got without either.
	local function placed(team, defID)
		local count = 0
		if state.gameOver then
			count = count + state.gameOver.anchorCount(team, defID)
		end
		if state.reveal then
			count = count + state.reveal.spotterCount(team, defID)
		end
		return count
	end

	--- A list of def names as a set.
	local function setOf(names)
		local set = {}
		for _, name in ipairs(names or {}) do
			set[name] = true
		end
		return set
	end

	--- How many of a group's living units match the condition (issue #5292).
	-- `team`, when given, keeps the units that team owns now, so a group the
	-- mission handed the player can be counted from either side. Read through
	-- `state` because groups are registered after this module.
	local function groupCount(params, team)
		local living = state.groups and state.groups.living(params.group, team)
		if not living then
			return nil
		end

		local wanted = params.unitDefs and #params.unitDefs > 0 and setOf(params.unitDefs)
		-- The types `exceptDefs` leaves out of a count (issue #5293).
		local except = setOf(params.exceptDefs)
		local count = 0
		for _, unitID in ipairs(living) do
			local def = UnitDefs[Spring.GetUnitDefID(unitID)]
			if (not wanted or (def and wanted[def.name])) and not (def and except[def.name]) then
				count = count + 1
			end
		end
		return count
	end

	-- Polled: a team's holdings change with every death and every build, and an
	-- aggregate nobody can see change is not worth a callin per unit.
	--
	-- With a `group` it counts that group's living units instead of a team's, and
	-- `team` becomes optional: absent, the group is counted whoever owns it now.
	engine:addCondition("unit_count", {
		test = function(params)
			local team = engineTeam[params.team]
			if params.group ~= nil then
				if params.team ~= nil and not team then
					return false
				end
				local count = groupCount(params, team)
				return count ~= nil and within(count, tonumber(params.min), tonumber(params.max))
			end

			if not team then
				if params.team == nil then
					engine:report("unit-count-team", "warning",
						"unit_count names neither a team nor a group, treating it as empty")
				end
				return false
			end

			--- How many units of one type the mission would say the team has.
			local function ofType(name)
				local def = UnitDefNames[name]
				if not def then
					return 0
				end
				return Spring.GetTeamUnitDefCount(team, def.id) - placed(team, def.id)
			end

			local count = 0
			local except = setOf(params.exceptDefs)
			local defs = params.unitDefs
			if defs and #defs > 0 then
				for _, name in ipairs(defs) do
					if not except[name] then
						count = count + ofType(name)
					end
				end
			else
				count = (Spring.GetTeamUnitCount(team) or 0) - placed(team)
				for name in pairs(except) do
					count = count - ofType(name)
				end
			end

			return within(count, tonumber(params.min), tonumber(params.max))
		end,
	})

	--- Whether some hit in `byTeam`, from the team and the types asked for, is
	-- later than `since`.
	local function hitSince(byTeam, team, wanted, since)
		for attackerTeam, byDef in pairs(byTeam) do
			if team == nil or attackerTeam == team then
				for name, stamp in pairs(byDef) do
					if stamp > since and (not wanted or wanted[name]) then
						return true
					end
				end
			end
		end
		return false
	end

	-- Holds once the actor, or a unit of the group, has been hit since the
	-- trigger was armed, or since it last fired (issue #5298). A hit is a moment
	-- rather than a state, so it is counted the way an order given is. A `group`
	-- takes the place of the actor.
	engine:addCondition("unit_attacked", {
		events = { "unit_attacked" },
		test = function(params, ctx)
			local hits
			if params.group ~= nil then
				-- Reports a group the scenario does not have.
				if not (state.groups and state.groups.living(params.group)) then
					return false
				end
				hits = groupHits[params.group]
			else
				hits = actorHits[params.actor]
			end

			local team
			if params.attackerTeam ~= nil then
				team = engineTeam[params.attackerTeam]
				if not team then
					return false
				end
			end
			local wanted = params.attackerDefs and #params.attackerDefs > 0 and setOf(params.attackerDefs)

			return hits ~= nil and hitSince(hits, team, wanted, ctx.armedAt or 0)
		end,
	})

	local hooks = {}

	--- A unit took damage from another. Returns whether a unit_attacked condition
	-- names it, which is whether there is anything for a trigger to hear about.
	function hooks.damaged(unitID, actorId, attackerDefID, attackerTeam)
		local def = UnitDefs[attackerDefID]
		local name = def and def.name or ""
		local stamp

		local function record(byTeam)
			if not byTeam then
				return
			end
			stamp = stamp or engine:stamp()
			byTeam[attackerTeam] = byTeam[attackerTeam] or {}
			byTeam[attackerTeam][name] = stamp
		end

		if actorId then
			record(actorHits[actorId])
		end
		local group = state.groups and state.groups.of(unitID)
		if group then
			record(groupHits[group])
		end
		return stamp ~= nil
	end

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
