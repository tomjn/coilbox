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

--- How many units are in a zone. `defs`, when given, is a set of unit def names
-- to count and nothing else.
local function countIn(zone, allegiance, defs)
	local units = unitsIn(zone, allegiance)
	if not defs then
		return #units
	end

	local count = 0
	for _, unitID in ipairs(units) do
		local def = UnitDefs[Spring.GetUnitDefID(unitID)]
		if def and defs[def.name] then
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
			return within(countIn(zone, allegiance, defSet(params.unitDefs)), min, max)
		end,
	})

	-- Zone id -> team id -> the frame that team's occupancy began, or nil while
	-- the zone holds nothing of theirs.
	local heldSince = {}

	-- The zone and team of every zone_held_for a mission asks, found once. The
	-- clock belongs to the world rather than to the trigger, so a hold is measured
	-- from when it started whether or not the trigger watching it was armed at the
	-- time, and two triggers watching the same zone read one clock.
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

		heldSince[zone.id] = heldSince[zone.id] or {}
		if heldSince[zone.id][params.team] == nil then
			-- Marked as watched by having a slot, which starts empty because a hold
			-- has not begun until a sampling says it has.
			heldSince[zone.id][params.team] = false
			watched[#watched + 1] = { zone = zone, team = params.team, allegiance = team }
		end
	end

	for _, trigger in ipairs((state.mission or {}).triggers or {}) do
		for _, condition in ipairs((trigger.conditions or {}).conditions or {}) do
			if condition.type == "zone_held_for" then
				watch(condition.params or {})
			end
		end
	end

	-- One reading of every watched zone per polled tick. A team that is there
	-- keeps the frame its stay began; a team that is not loses it, which is what
	-- makes leaving and coming back start again rather than carry on.
	engine:addTick(function(ctx)
		for _, entry in ipairs(watched) do
			local held = heldSince[entry.zone.id]
			if countIn(entry.zone, entry.allegiance, nil) > 0 then
				held[entry.team] = held[entry.team] or ctx.frame
			else
				held[entry.team] = false
			end
		end
	end)

	engine:addCondition("zone_held_for", {
		test = function(params, ctx)
			local since = (heldSince[params.zone] or {})[params.team]
			if not since then
				return false
			end
			return ctx.frame - since >= (tonumber(params.seconds) or 0) * ctx.gameSpeed
		end,
	})
end

return M
