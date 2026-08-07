-- Coilbox mission runtime: zones, and the two conditions that read them.
--
-- A zone is a named area of the map: a box with a min and a max corner, or a
-- circle with a centre and a radius. Both are flat. A scenario carries no height
-- anywhere, because everything in one sits on terrain, so a zone is a footprint
-- and a unit is in it or is not whatever its altitude.
--
-- `units_in_zone` asks what is in a zone now. `zone_held_for` asks how long a
-- team has been in one without leaving, which no single reading can answer, so
-- this module samples occupancy on the engine's polled tick and the condition
-- reads what the sampler wrote.
--
-- A hold is presence by default: a team standing in a zone holds it whether or
-- not anyone else is standing there too. `uncontested` makes it control instead
-- (issue #802), and then anyone the holding team is not allied with breaks the
-- hold for as long as they are in the zone. Composing that out of
-- `units_in_zone` with `max = 0` does not work, because that reads the moment
-- the timer runs out rather than the whole minute leading up to it.
--
-- Read-only. It counts and measures and changes nothing.

local M = {}

--- Whether a count sits inside an optional min and max.
local function within(count, min, max)
	if min and count < min then
		return false
	end
	if max and count > max then
		return false
	end
	return true
end

--- The zones a mission declares, by id, with box corners put the right way
-- round. A zone dragged up and to the left in the editor arrives with its min
-- above its max, and a box nothing can ever be inside is a silent mission.
--
-- A zone whose shape is not one this runtime knows is dropped and named. The
-- compile step refuses to emit one, so the likely cause is a mission built for a
-- newer runtime, and the conditions naming it then report it themselves.
local function index(mission, report)
	local zones = {}
	for _, zone in ipairs((mission or {}).zones or {}) do
		if zone.shape == "box" and zone.min and zone.max then
			zones[zone.id] = {
				id = zone.id,
				shape = "box",
				xmin = math.min(zone.min.x, zone.max.x),
				zmin = math.min(zone.min.z, zone.max.z),
				xmax = math.max(zone.min.x, zone.max.x),
				zmax = math.max(zone.min.z, zone.max.z),
			}
		elseif zone.shape == "circle" and zone.center and zone.radius then
			zones[zone.id] = {
				id = zone.id,
				shape = "circle",
				x = zone.center.x,
				z = zone.center.z,
				radius = zone.radius,
			}
		else
			report("zone-shape:" .. tostring(zone.id), "warning",
				"zone " .. tostring(zone.id) .. " has no shape this runtime can read, ignoring it")
		end
	end
	return zones
end

--- The units inside a zone, from the team `allegiance` names or from every team
-- when it is nil.
--
-- The engine's own spatial queries decide membership, so a zone contains what
-- everything else in the game would say it contains: a unit's mid position, and
-- a boundary that counts as inside. A synced gadget reads every team, so nothing
-- is hidden from the query by line of sight and every machine counts the same
-- units.
local function unitsIn(zone, allegiance)
	if zone.shape == "circle" then
		return Spring.GetUnitsInCylinder(zone.x, zone.z, zone.radius, allegiance)
	end
	return Spring.GetUnitsInRectangle(zone.xmin, zone.zmin, zone.xmax, zone.zmax, allegiance)
end

--- Whether a unit in a zone is one the condition asked about. `defs`, when
-- given, is a set of unit def names to count and nothing else.
local function counted(unitID, defs)
	if not defs then
		return true
	end
	local def = UnitDefs[Spring.GetUnitDefID(unitID)]
	return def ~= nil and defs[def.name] == true
end

--- How many units are in a zone. `skip` answers for a unit the mission does not
-- count as being anywhere.
local function countIn(zone, allegiance, defs, skip)
	local count = 0
	for _, unitID in ipairs(unitsIn(zone, allegiance)) do
		if not skip(unitID) and counted(unitID, defs) then
			count = count + 1
		end
	end
	return count
end

--- A list of unit def names as a set, or nil when the condition names none and
-- every unit counts.
local function defSet(list)
	if not list or #list == 0 then
		return nil
	end
	local set = {}
	for _, name in ipairs(list) do
		set[name] = true
	end
	return set
end

--- Register the zone conditions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the zones by id, with their corners the right way round, so anything
--   else that has to work out where a zone is reads the same geometry these
--   conditions do rather than parsing the shapes again
function M.register(engine, state)
	local function report(key, level, message)
		engine:report(key, level, message)
	end

	local zones = index(state.mission, report)

	-- Trigger params name a participant, not an engine team, and the mapping is
	-- fixed once the mission has started.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	--- Whether a unit is one the runtime put on the map for its own reasons: an
	-- anchor, which keeps its team's unit count above nothing, or a spotter, which
	-- lights a revealed area. Neither is in any zone as far as the mission is
	-- concerned, and a spotter stands in the middle of a zone by definition.
	--
	-- Read through `state` rather than taken once, because both are registered
	-- after this module and the answer is only ever needed on a later frame.
	local function placed(unitID)
		return (state.gameOver ~= nil and state.gameOver.isAnchor(unitID))
			or (state.reveal ~= nil and state.reveal.isSpotter(unitID))
	end

	--- The zone a condition names, or nil once it has said so.
	local function zoneOf(params)
		local zone = zones[params.zone]
		if not zone then
			report("zone:" .. tostring(params.zone), "warning",
				"no zone named " .. tostring(params.zone) .. ", treating it as empty")
		end
		return zone
	end

	-- Polled: occupancy changes with every step a unit takes, and the engine has
	-- no callin for crossing a line on the ground.
	--
	-- A condition that states neither a minimum nor a maximum means at least one,
	-- because "units in the zone" with no number is asking whether anything is
	-- there. Stating only a maximum keeps its own meaning, so `max = 0` is how a
	-- mission asks whether a zone is clear.
	engine:addCondition("units_in_zone", {
		test = function(params)
			local zone = zoneOf(params)
			if not zone then
				return false
			end

			local allegiance
			if params.team ~= nil then
				allegiance = engineTeam[params.team]
				if not allegiance then
					report("zone-team:" .. tostring(params.team), "warning",
						"no team named " .. tostring(params.team) .. " in this mission")
					return false
				end
			end

			local min, max = tonumber(params.min), tonumber(params.max)
			if not min and not max then
				min = 1
			end
			return within(countIn(zone, allegiance, defSet(params.unitDefs), placed), min, max)
		end,
	})

	--- Whether anyone the holding team is not allied with is standing in a zone.
	--
	-- Gaia is not anyone. It owns the map's own furniture: critters, and in some
	-- games the units a map places. None of that belongs to a side or fights for
	-- one, so a Gaia unit wandering through a keep is scenery rather than an enemy
	-- holding it, and a mission that told the player to clear the keep would be
	-- asking them to hunt down a deer. The runtime's own anchors and spotters are
	-- left out for the same reason every other count here leaves them out.
	--
	-- An ally does not contest either. A co-op partner standing in the zone with
	-- you is not someone you have to clear out.
	local function contested(zone, holder)
		local gaia = Spring.GetGaiaTeamID()
		for _, unitID in ipairs(unitsIn(zone, nil)) do
			local team = Spring.GetUnitTeam(unitID)
			if team ~= nil and team ~= gaia and not placed(unitID)
				and not Spring.AreTeamsAllied(team, holder) then
				return true
			end
		end
		return false
	end

	--- The clock one zone_held_for reads. A zone, a team, and whether the hold
	-- has to be uncontested, because a hold that breaks when an enemy walks in is
	-- a different clock from one that does not and two triggers asking different
	-- questions of the same zone must not share an answer.
	local function holdKey(params)
		return tostring(params.zone) .. "/" .. tostring(params.team)
			.. (params.uncontested == true and "/uncontested" or "")
	end

	-- Hold key -> the frame that hold began, or false while it is not held.
	local heldSince = {}

	-- Every zone_held_for a mission asks, found once. The clock belongs to the
	-- world rather than to the trigger, so a hold is measured from when it started
	-- whether or not the trigger watching it was armed at the time, and two
	-- triggers asking the same question of the same zone read one clock.
	local watched = {}
	local function watch(params)
		local zone = zoneOf(params)
		local team = engineTeam[params.team]
		if not zone then
			return
		end
		if not team then
			report("zone-team:" .. tostring(params.team), "warning",
				"no team named " .. tostring(params.team) .. " in this mission")
			return
		end

		local key = holdKey(params)
		if heldSince[key] == nil then
			-- Marked as watched by having a slot, which starts empty because a hold
			-- has not begun until a sampling says it has.
			heldSince[key] = false
			watched[#watched + 1] = {
				key = key,
				zone = zone,
				allegiance = team,
				uncontested = params.uncontested == true,
			}
		end
	end

	for _, trigger in ipairs((state.mission or {}).triggers or {}) do
		for _, condition in ipairs((trigger.conditions or {}).conditions or {}) do
			if condition.type == "zone_held_for" then
				watch(condition.params or {})
			end
		end
	end

	-- One reading of every watched hold per polled tick. A hold that is standing
	-- keeps the frame it began. One that is not loses it, which is what makes
	-- leaving and coming back start again rather than carry on, and what makes an
	-- enemy walking into an uncontested hold reset it rather than pause it.
	engine:addTick(function(ctx)
		for _, entry in ipairs(watched) do
			local holding = countIn(entry.zone, entry.allegiance, nil, placed) > 0
			if holding and entry.uncontested and contested(entry.zone, entry.allegiance) then
				holding = false
			end
			heldSince[entry.key] = holding and (heldSince[entry.key] or ctx.frame) or false
		end
	end)

	engine:addCondition("zone_held_for", {
		test = function(params, ctx)
			local since = heldSince[holdKey(params)]
			if not since then
				return false
			end
			return ctx.frame - since >= (tonumber(params.seconds) or 0) * ctx.gameSpeed
		end,
	})

	return zones
end

return M
