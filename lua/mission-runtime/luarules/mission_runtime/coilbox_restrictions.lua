-- Coilbox mission runtime: what a mission's teams may build and do.
--
-- A scenario carries `restrictions.buildable`, an allow or deny list of unit
-- defs, and `restrictions.commands`, engine command names withheld. Both are the
-- runtime's rather than the engine's own [RESTRICT] block, because [RESTRICT] is
-- global and permanent: it cannot be lifted mid-mission, which is exactly what
-- `unlock_unit` does.
--
-- A restriction binds every team the scenario declares, the same reach
-- [RESTRICT] has. The format names no team, so scoping one to the human player
-- would be a rule the mission never stated, and it would leave an author with no
-- way to restrict an enemy at all. `unlock_unit` is the other end: it lifts one
-- def for one participant, so an author who wants a rule for the player only
-- writes the restriction and unlocks the def for everyone else.
--
-- Nothing here restricts a team the scenario says nothing about, Gaia included.
--
-- The runtime's own spawns are untouched. AllowUnitCreation is consulted for
-- builders and factories only, never for Spring.CreateUnit, so a mission may
-- place a unit its teams are forbidden to build.

local M = {}

--- Register the restrictions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the handle, which the gadget's AllowUnitCreation and AllowCommand ask
--   and a game's own actions unlock through
function M.register(engine, state)
	local restrictions = (state.mission or {}).restrictions or {}
	local buildable = restrictions.buildable

	-- The teams a restriction reaches, and the participant ids `unlock_unit`
	-- names them by.
	local missionTeam = {}
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		missionTeam[team.team] = true
		engineTeam[team.id] = team.team
	end

	-- The def ids the scenario listed: the only ones buildable under `allow`, and
	-- the only ones not under `deny`.
	local listed = {}
	if buildable then
		for _, name in ipairs(buildable.units or {}) do
			local def = UnitDefNames[name]
			if def then
				listed[def.id] = true
			else
				engine:report("restrict-def:" .. tostring(name), "warning", string.format(
					"the mission restricts %s, which this game has no unit def for",
					tostring(name)))
			end
		end
	end

	-- The command ids withheld. The engine's CMD table is keyed by the upper case
	-- name, so that is what an author's `selfd` resolves through.
	local withheld = {}
	for _, name in ipairs(restrictions.commands or {}) do
		local id = CMD[tostring(name):upper()]
		if type(id) == "number" then
			withheld[id] = true
		else
			engine:report("restrict-command:" .. tostring(name), "warning", string.format(
				"the mission withholds %s, which is not an engine command", tostring(name)))
		end
	end

	-- Engine team -> def id -> true, for the defs `unlock_unit` has freed.
	local unlocked = {}

	local handle = {}

	--- Whether the scenario's own list forbids this def to this team, before any
	-- unlock. A team the mission does not declare is never restricted.
	local function listRefuses(defID, team)
		if not buildable or not missionTeam[team] then
			return false
		end
		if buildable.mode == "allow" then
			return not listed[defID]
		end
		return listed[defID] == true
	end

	--- Whether a team may build this def. Asked from the gadget's
	-- AllowUnitCreation, so it is asked once per build attempt and answers with
	-- two table lookups.
	function handle.allowsBuild(defID, team)
		if not listRefuses(defID, team) then
			return true
		end
		return (unlocked[team] or {})[defID] == true
	end

	--- Whether a team may be given this command.
	function handle.allowsCommand(cmdID, team)
		return not (withheld[cmdID] and missionTeam[team])
	end

	--- Lift the buildable restriction on one def for one participant. No
	-- participant named means the team a human is playing, the same team a
	-- `victory` that names none is about.
	--
	-- Unlocking a def nothing was restricting is reported: it is an author's
	-- mid-mission reward that the player already had.
	--
	-- @return true when it lifted something
	function handle.unlock(unitDef, participant)
		local def = UnitDefNames[unitDef]
		if not def then
			engine:report("unlock-def:" .. tostring(unitDef), "warning", string.format(
				"unlock_unit names %s, which this game has no unit def for", tostring(unitDef)))
			return false
		end

		local id = participant
		if id == nil and state.gameOver then
			id = state.gameOver.playerTeam()
		end
		local team = engineTeam[id]
		if not team then
			engine:report("unlock-team:" .. tostring(id), "warning", string.format(
				"no team named %s in this mission, ignoring unlock_unit", tostring(id)))
			return false
		end

		if not listRefuses(def.id, team) then
			engine:report("unlock-free:" .. tostring(unitDef) .. "/" .. tostring(id), "warning",
				string.format("nothing restricts %s for %s, so unlock_unit does nothing",
					tostring(unitDef), tostring(id)))
			return false
		end

		unlocked[team] = unlocked[team] or {}
		unlocked[team][def.id] = true
		return true
	end

	engine:addAction("unlock_unit", function(params)
		handle.unlock(params.unitDef, params.team)
	end)

	return handle
end

return M
