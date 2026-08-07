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
--
-- AllowUnitCreation is also the last possible moment to say no. It is what
-- actually holds, and it stays: a player can reach a build order by other means
-- than the menu. But on its own it leaves the icon in the menu, so the player
-- clicks it, the builder walks to the site, and nothing happens. `paint` is the
-- sign on the door in front of that: it greys the build icons for the defs a
-- team may not build, on every builder that team owns.

local M = {}

-- How often the greyed icons are put back, in frames.
--
-- Nothing arbitrates between this module and a game's own build gating, and both
-- write the same flag on the same icons. Splinter Faction's tech tree decides
-- each icon from its tech alone and rewrites the lot whenever a team's tech
-- changes, so a tech grant lifts the grey on a def the mission forbids and the
-- player is left with an icon they may click and an AllowUnitCreation that
-- refuses it (issue #955).
--
-- Half a second, which is the longest that can last. The gadget is at layer
-- 1000, behind a game's own gadgets, so the repaint on a frame is the last word
-- on that frame. Only a mission that forbids something pays for it, and a unit
-- with no build menu costs one table lookup.
local REPAINT_INTERVAL = 15

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

	-- The def ids that have a build menu at all, worked out once. Reading
	-- UnitDefs[id].buildOptions builds a fresh table every time it is asked, so
	-- asking per unit created would allocate one per unit for an answer that never
	-- changes. A mission with nothing to grey out asks nothing.
	local hasBuildMenu = {}
	if buildable then
		for id, def in pairs(UnitDefs) do
			if #def.buildOptions > 0 then
				hasBuildMenu[id] = true
			end
		end
	end

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

	-- Unit -> the build commands this module greyed out on it. Only what is in
	-- here is ever ungreyed again, so an icon the game itself had already greyed
	-- for its own reasons is left exactly as the game left it.
	local greyed = {}

	--- Bring one unit's build menu into line with what its team may build.
	--
	-- The icons are edited rather than removed and put back. A removed one has to
	-- be reinserted at the index it came from or the player's menu quietly
	-- reorders itself, and `disabled` is what the engine draws greyed anyway, so
	-- editing says the same thing without ever moving anything. It is also what a
	-- game's own build gating uses: Splinter Faction's tech tree greys a locked
	-- build icon exactly this way.
	--
	-- Called for every unit that arrives on a team and for every unit of a team
	-- an `unlock_unit` just freed a def for, so the cost is paid once per unit
	-- rather than once per order. A def that builds nothing pays one table lookup
	-- and stops.
	function handle.paint(unitID, unitDefID, team)
		if not hasBuildMenu[unitDefID] then
			return
		end

		local mine = greyed[unitID]
		-- The index is read fresh every time. It is a position in the unit's own
		-- list, and anything that removes a command description shifts every index
		-- behind it, so one held from an earlier frame points at the wrong icon.
		for index, desc in ipairs(Spring.GetUnitCmdDescs(unitID) or {}) do
			-- A build command's id is the negative of the unit def it builds, which
			-- is the whole of what makes one a build command.
			local id = desc.id
			if id < 0 then
				if handle.allowsBuild(-id, team) then
					if mine and mine[id] then
						Spring.EditUnitCmdDesc(unitID, index, { disabled = false })
						mine[id] = nil
					end
				elseif not desc.disabled then
					Spring.EditUnitCmdDesc(unitID, index, { disabled = true })
					mine = mine or {}
					mine[id] = true
					greyed[unitID] = mine
				end
			end
		end
	end

	--- Every unit a team owns, brought into line at once. What an unlock is for.
	local function repaint(team)
		for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
			handle.paint(unitID, Spring.GetUnitDefID(unitID), team)
		end
	end

	--- A unit has left the game, so what was greyed on it is nobody's business.
	function handle.removed(unitID)
		greyed[unitID] = nil
	end

	--- Put back what a game's own build gating painted over, on a cadence.
	--
	-- Called every frame from the gadget. A mission with nothing to grey returns
	-- on the first line and never reads a build menu at all.
	function handle.refresh(frame)
		if not buildable or frame % REPAINT_INTERVAL ~= 0 then
			return
		end
		for team in pairs(missionTeam) do
			repaint(team)
		end
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
		-- The reward is not the def alone, it is the def and the icon for it. A
		-- team that has just been handed something it could not build before has
		-- to be able to see that, so every builder it owns is repainted here.
		repaint(team)
		return true
	end

	engine:addAction("unlock_unit", function(params)
		handle.unlock(params.unitDef, params.team)
	end)

	return handle
end

return M
