-- Coilbox mission runtime: revealing an area.
--
-- `reveal_area` lifts the fog over a zone for a participant, so a mission can
-- show the player the base it is about to send them at.
--
-- There is no engine call for it. Nothing in LuaSyncedCtrl grants sight over a
-- region: Spring.SetGlobalLos is the whole map and per ally team,
-- Spring.SetUnitLosState forces one unit's visibility and lifts no fog at all,
-- and a feature emits no sight. The only thing in the engine that lights part of
-- a map is a unit's own sight radius. So a reveal is a unit: one that does
-- nothing, sees the zone, and is taken off the map when the reveal ends.
--
-- That unit is a spotter. It is the anchor's twin -- same inert def, invulnerable,
-- non-blocking, earning nothing, drawn nowhere -- and it differs in the two ways
-- that matter for standing in someone else's base rather than in an empty
-- corner: it has sight, and every other ally team is pinned to never seeing it,
-- so an enemy army does not spend the mission shooting at an invulnerable box.
--
-- Two things follow from sight being a unit's, and neither is hidden:
--
-- - It is a circle. A box zone is covered by the circle around it, so a reveal
--   spills past the corners of a box. Under-revealing would leave the thing the
--   author drew the box around in the dark.
-- - Terrain occludes it. Sight is a raycast from the spotter, so a ridge inside
--   the zone shadows its far side, exactly as it would for a scout standing
--   there. Air sight is granted at the same radius and is not occluded, so
--   aircraft over the zone are seen wherever the ground is.

local M = {}

-- The smallest sight radius worth asking for. The engine keeps the sight map at
-- a fraction of the heightmap's resolution, so a radius under a few squares
-- lights nothing at all, and a reveal that reveals nothing is the failure this
-- action exists to avoid.
M.MIN_RADIUS = 64

--- Where a spotter stands to cover a zone, and how far it has to see.
--
-- A circle is its own answer. A box is covered by the circle around its corners,
-- which is the smallest circle that contains all of it.
local function coverage(zone)
	if zone.shape == "circle" then
		return zone.x, zone.z, zone.radius
	end

	local x = (zone.xmin + zone.xmax) / 2
	local z = (zone.zmin + zone.zmax) / 2
	local dx, dz = zone.xmax - x, zone.zmax - z
	return x, z, math.sqrt(dx * dx + dz * dz)
end

--- Register the reveal action on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `spawn(placement)` puts one unit on the map and returns its unit
--   id and `remove(unitID)` takes one off, both the gadget's, because a unit the
--   runtime places is not a unit a team built and nothing about one should reach
--   the triggers. `def()` answers with the def to build a spotter from, which is
--   the anchor's and belongs to whichever part of the runtime owns both.
-- @return the handle, so a game's own actions reveal an area the way this does
function M.register(engine, state, hooks)
	-- Trigger params name a participant, not an engine team.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	-- unitID -> { team = engine team, defID = , key = , expires = frame or nil }.
	local spotters = {}
	-- zone and team -> the spotter already lighting it, so a repeating trigger
	-- lights a zone once rather than filling it with units.
	local standing = {}
	-- The last frame the trigger engine told this module about. A reveal's
	-- deadline is counted from it, so a game's own action that reveals an area
	-- outside a pass is a tick behind at worst.
	local now = 0

	local handle = {}

	--- Take everything off a spotter that would otherwise reach the mission, and
	-- give it the one thing it is there for.
	--
	-- Being invulnerable and undrawn is the gadget's, because it owns both.
	local function neuter(unitID, team, radius)
		Spring.SetUnitBlocking(unitID, false, false, false, false, false, false, false)
		Spring.SetUnitStealth(unitID, true)
		Spring.SetUnitSonarStealth(unitID, true)
		Spring.SetUnitSensorRadius(unitID, "los", radius)
		-- Air sight as well: the sight that finds aircraft is a separate map, and
		-- a revealed area with an enemy gunship still invisible over it is not
		-- revealed.
		Spring.SetUnitSensorRadius(unitID, "airLos", radius)
		for _, sensor in ipairs({ "radar", "sonar", "seismic" }) do
			Spring.SetUnitSensorRadius(unitID, sensor, 0)
		end
		Spring.SetUnitResourcing(unitID, {
			uum = 0, uue = 0, umm = 0, ume = 0,
			cum = 0, cue = 0, cmm = 0, cme = 0,
		})

		-- Unseen by everyone else, for good. The mask stops the engine updating
		-- this unit's visibility for that ally team, and clearing the state after
		-- it leaves the unit permanently out of their sight and off their radar.
		-- Without it a spotter is a unit standing in the enemy's base that they can
		-- see, shoot at, and never kill.
		local _, _, _, _, _, own = Spring.GetTeamInfo(team, false)
		for _, allyTeam in ipairs(Spring.GetAllyTeamList() or {}) do
			if allyTeam ~= own then
				Spring.SetUnitLosMask(unitID, allyTeam,
					{ los = true, radar = true, prevLos = true, contRadar = true })
				Spring.SetUnitLosState(unitID, allyTeam, 0)
			end
		end
	end

	--- Take a spotter off the map, which ends the reveal it was lighting. The fog
	-- closes over what it saw, and the ground it explored stays explored, the same
	-- as when any other unit walks away.
	local function retire(unitID)
		local spotter = spotters[unitID]
		if not spotter then
			return
		end
		spotters[unitID] = nil
		if standing[spotter.key] == unitID then
			standing[spotter.key] = nil
		end
		hooks.remove(unitID)
	end

	--- Light a zone for a participant.
	--
	-- `seconds` is how long for, and no seconds is the rest of the mission. A zone
	-- already lit for that participant keeps the one spotter it has and takes the
	-- new deadline, so the last reveal decides when the fog comes back.
	--
	-- @return true when the zone is lit afterwards
	function handle.reveal(zoneId, participant, seconds)
		local zone = (state.zones or {})[zoneId]
		if not zone then
			engine:report("reveal-zone:" .. tostring(zoneId), "warning",
				"no zone named " .. tostring(zoneId) .. " to reveal, ignoring it")
			return false
		end

		local id = participant
		if id == nil and state.gameOver then
			id = state.gameOver.playerTeam()
		end
		local team = engineTeam[id]
		if not team then
			engine:report("reveal-team:" .. tostring(id), "warning",
				"no team named " .. tostring(id) .. " in this mission, ignoring reveal_area")
			return false
		end

		local duration = tonumber(seconds)
		local expires = nil
		if duration and duration > 0 then
			expires = now + duration * Game.gameSpeed
		end

		local key = tostring(zoneId) .. "/" .. tostring(team)
		local already = standing[key]
		if already then
			spotters[already].expires = expires
			return true
		end

		local def = hooks.def()
		if not def then
			engine:report("reveal-def", "warning",
				"no unit def in this game can be a mission spotter, so reveal_area reveals nothing")
			return false
		end

		local x, z, radius = coverage(zone)
		local unitID = hooks.spawn({
			unitDef = def.name,
			team = team,
			x = x,
			z = z,
			facing = 0,
		})
		if not unitID then
			return false
		end

		neuter(unitID, team, math.max(radius, M.MIN_RADIUS))
		spotters[unitID] = { team = team, defID = def.id, key = key, expires = expires }
		standing[key] = unitID
		return true
	end

	--- Put the fog back over a zone before its time is up.
	function handle.hide(zoneId, participant)
		local id = participant
		if id == nil and state.gameOver then
			id = state.gameOver.playerTeam()
		end
		local team = engineTeam[id]
		local unitID = team and standing[tostring(zoneId) .. "/" .. tostring(team)]
		if not unitID then
			return false
		end
		retire(unitID)
		return true
	end

	--- Whether a unit is a spotter, which is how the conditions that read a zone
	-- leave one out of what they see. A spotter stands in the middle of a zone by
	-- definition, so this one matters more than the anchor's.
	function handle.isSpotter(unitID)
		return spotters[unitID] ~= nil
	end

	--- How many of a team's units are spotters, of one def or of any. The
	-- conditions that count a team's units take this off.
	function handle.spotterCount(team, defID)
		local count = 0
		for _, spotter in pairs(spotters) do
			if spotter.team == team and (defID == nil or spotter.defID == defID) then
				count = count + 1
			end
		end
		return count
	end

	--- A unit is gone. Fed from the gadget's UnitDestroyed, so a spotter that died
	-- despite being invulnerable is forgotten rather than counted forever.
	function handle.removed(unitID)
		local spotter = spotters[unitID]
		if not spotter then
			return
		end
		spotters[unitID] = nil
		if standing[spotter.key] == unitID then
			standing[spotter.key] = nil
		end
	end

	-- Polled, because a reveal running out is an aggregate like every other clock
	-- in the runtime, and half a second either way is not something an author can
	-- see. Removing the current key inside pairs is what Lua allows.
	engine:addTick(function(ctx)
		now = ctx.frame
		for unitID, spotter in pairs(spotters) do
			if spotter.expires and now >= spotter.expires then
				retire(unitID)
			end
		end
	end)

	engine:addAction("reveal_area", function(params, ctx)
		now = ctx.frame
		handle.reveal(params.zone, params.team, params.seconds)
	end)

	return handle
end

return M
