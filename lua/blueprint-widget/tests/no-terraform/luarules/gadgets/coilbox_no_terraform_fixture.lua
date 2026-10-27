-- The no-terraform fixture match (issue #4797).
--
-- It plays in a game with no terraform gadget, such as Metal Factions. The
-- gadget picks a builder and a turret that builder can build, from the game's
-- own unit defs, creates the builder, gives a blueprint of a raised wall and
-- that turret to the blueprint widget's own place.lua with the rule the widget
-- uses for whether terraform is available (a selected builder has Zero-K's
-- level command), and reports what happens as FIXTURE and PROBE lines in the
-- engine's log: what the placing code did, the turret being created and
-- finishing, and the ground where the wall would have gone.
--
-- It is a gadget rather than a widget because Metal Factions' own LuaUI does
-- not start in a headless match, and place.lua only needs the engine functions
-- the synced side has.

function gadget:GetInfo()
	return {
		name = "Coilbox no-terraform fixture",
		desc = "Creates a builder for the probe widget and reports what it builds",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local CREATE_FRAME = 30
local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_end_frame) or 3000
local TEAM = 0

if gadgetHandler:IsSyncedCode() then
	local turretDefID, builderID
	local spot = {}
	local ORDER_FRAME = 75
	local PLACE = VFS.Include("LuaUI/coilbox_blueprints/place.lua", nil, VFS.RAW_FIRST)

	--- Give the blueprint to the placing code, as the widget does after a click.
	local function place(turretName, cx, cz)
		PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game, WG = nil })
		local entry = {
			buildings = { { def = turretName, offset = { x = 0, z = 0 }, facing = 0 } },
			terrain = { { kind = "raise", shape = "wall", points = { { x = -48, z = 0 }, { x = 0, z = 0 }, { x = 48, z = 0 } }, height = 112, before = 0 } },
		}
		local resolved = PLACE.resolve(entry)
		local pivot = PLACE.pivot(resolved)
		local ax, az = PLACE.pivotAt(resolved, pivot, 0, nil, cx, cz)
		local origin = pivot and resolved.buildings[pivot].offset or nil
		local foot = PLACE.footprint(resolved, 0, ax, az, nil, origin)
		for i, p in ipairs(foot) do
			p.seq = i
		end
		local steps = PLACE.laySteps(resolved, 0, nil, origin, { { x = ax, z = az } }, foot)
		local can = PLACE.capabilities({ builderID })
		local available = #can.terraformers > 0
		Spring.Echo(string.format("PROBE capabilities builders=%d terraformers=%d turret=%s", #can.builders, #can.terraformers, turretName))
		local plan = PLACE.plan(foot, can, false, "help", { steps = steps, on = available, why = not available and "terraforming is not available here" or "Terrain is off" })
		local sent = PLACE.issue(plan)
		Spring.Echo(string.format("PROBE blueprint sent=%d terraform=%d skipped=%d why=%s offMap=%d remainder=%d blocked=%d", sent, #plan.terraform, plan.skipped, (tostring(plan.skippedWhy):gsub(" ", "_")), plan.offMap, #plan.remainder, plan.blocked))
		local commands = Spring.GetUnitCommands(builderID, -1) or {}
		local ids = {}
		for i = 1, #commands do
			ids[#ids + 1] = tostring(commands[i].id)
		end
		Spring.Echo("PROBE queue " .. table.concat(ids, ","))
	end

	--- A mobile builder that can build a turret, and the cheapest turret it can
	-- build, found by name order so every run picks the same pair.
	local function pick()
		local names = {}
		for name in pairs(UnitDefNames) do
			names[#names + 1] = name
		end
		table.sort(names)
		for _, name in ipairs(names) do
			local def = UnitDefNames[name]
			if def.canMove and def.buildSpeed and def.buildSpeed > 0 and def.buildOptions and #def.buildOptions > 0 then
				local best
				for _, optionID in ipairs(def.buildOptions) do
					local option = UnitDefs[optionID]
					if option.isBuilding and option.weapons and #option.weapons > 0 and (not best or option.metalCost < UnitDefs[best].metalCost) then
						best = optionID
					end
				end
				if best then
					return def, UnitDefs[best]
				end
			end
		end
	end

	function gadget:UnitCreated(unitID, unitDefID)
		if unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE created frame=%d unit=%s id=%d x=%.1f z=%.1f", Spring.GetGameFrame(), UnitDefs[unitDefID].name, unitID, x, z))
		end
	end

	function gadget:UnitFinished(unitID, unitDefID)
		if unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE finished frame=%d unit=%s id=%d x=%.1f y=%.1f z=%.1f ground=%.1f orig=%.1f", Spring.GetGameFrame(), UnitDefs[unitDefID].name, unitID, x, y, z, Spring.GetGroundHeight(x, z), Spring.GetGroundOrigHeight(x, z)))
		end
	end

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			local builder, turret = pick()
			if not builder then
				Spring.Echo("FIXTURE no builder with a turret to build")
			else
				turretDefID = turret.id
				local cx = 16 * math.floor(Game.mapSizeX / 32)
				local cz = 16 * math.floor(Game.mapSizeZ / 32)
				spot = { x = cx, z = cz }
				builderID = Spring.CreateUnit(builder.name, cx - 192, Spring.GetGroundHeight(cx - 192, cz), cz, "east", TEAM)
				Spring.SetUnitRulesParam(builderID, "coilbox_turret", turret.name)
				Spring.SetUnitRulesParam(builderID, "coilbox_lane_x", cx)
				Spring.SetUnitRulesParam(builderID, "coilbox_lane_z", cz)
				Spring.Echo(string.format("FIXTURE builder unit=%s id=%s turret=%s lane=%d,%d", builder.name, tostring(builderID), turret.name, cx, cz))
			end
		end
		if frame == ORDER_FRAME and builderID then
			place(UnitDefs[turretDefID].name, spot.x, spot.z)
		end
		if frame % 30 == 0 then
			Spring.SetTeamResource(TEAM, "ms", 100000)
			Spring.SetTeamResource(TEAM, "es", 100000)
			Spring.SetTeamResource(TEAM, "m", 100000)
			Spring.SetTeamResource(TEAM, "e", 100000)
		end
		if frame == END_FRAME then
			-- across where the wall would have been, south from its centre line
			if spot.x then
				local parts = {}
				for dz = 0, 64, 8 do
					parts[#parts + 1] = string.format("%d:%.1f", dz, Spring.GetGroundHeight(spot.x - 40, spot.z + dz) - Spring.GetGroundOrigHeight(spot.x - 40, spot.z + dz))
				end
				Spring.Echo(string.format("FIXTURE profile-z frame=%d %s", frame, table.concat(parts, " ")))
			end
			Spring.Echo("FIXTURE done " .. frame)
			Spring.GameOver({ 0 })
		end
	end
else
	local started = Spring.GetTimer()

	function gadget:Update()
		if Spring.GetGameFrame() >= END_FRAME + 45 or Spring.DiffTimers(Spring.GetTimer(), started) > 900 then
			Spring.SendCommands("quitforce")
		end
	end
end
