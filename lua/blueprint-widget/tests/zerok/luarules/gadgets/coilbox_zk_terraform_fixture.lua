-- The synced half of the Zero-K terraform fixture match.
--
-- It creates one constructor for each case the probe widget tries, in a row of
-- lanes across the middle of the map, keeps the team's storage full so cost
-- never slows a case down, and reports what happens as FIXTURE lines in the
-- engine's log: terraform units appearing and finishing, the turret going up,
-- each builder's queue, and at the end the ground across each lane.

function gadget:GetInfo()
	return {
		name = "Coilbox Zero-K terraform fixture",
		desc = "Creates builders for the terraform probe and reports what they do",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local CASES = 10
-- Cases with more than one builder, which share the terraform and the turret.
local BUILDERS = { [10] = 2 }
-- Lanes run east to west along the middle of the map, side by side, this far
-- apart.
local LANE_GAP = 512
local BUILDER_OFFSET = -192
local CREATE_FRAME = 30
local REPORT_EVERY = 300
local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_end_frame) or 9000
local TEAM = 0

local function lane(index)
	local cx = 16 * math.floor(Game.mapSizeX / 32) + (index - (CASES + 1) / 2) * LANE_GAP
	local cz = 16 * math.floor(Game.mapSizeZ / 32)
	return 16 * math.floor(cx / 16), cz
end

-- The save ground matches have a fixture of their own.
function gadget:Initialize()
	if ((Spring.GetModOptions() or {}).coilbox_mode or ""):sub(1, 6) == "ground" then
		gadgetHandler:RemoveGadget(self)
	end
end

if gadgetHandler:IsSyncedCode() then
	local builders = {}
	local caseOfBuilder = {}
	local terraunitDefID = UnitDefNames.terraunit.id
	local turretDefID = UnitDefNames.turretlaser.id

	local function caseAt(x, z)
		local best, bestDistance
		for i = 1, CASES do
			local lx, lz = lane(i)
			local distance = math.abs(x - lx)
			if not bestDistance or distance < bestDistance then
				best, bestDistance = i, distance
			end
		end
		return best
	end

	local function queue(unitID)
		local commands = Spring.GetUnitCommands(unitID, -1) or {}
		local parts = {}
		for i = 1, #commands do
			parts[#parts + 1] = tostring(commands[i].id)
		end
		return table.concat(parts, ",")
	end

	function gadget:UnitCreated(unitID, unitDefID, teamID, builderID)
		if unitDefID == terraunitDefID or unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE created case=%d frame=%d unit=%s id=%d x=%.1f y=%.1f z=%.1f",
				caseAt(x, z), Spring.GetGameFrame(), UnitDefs[unitDefID].name, unitID, x, y, z))
		end
	end

	function gadget:UnitFinished(unitID, unitDefID)
		if unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE finished case=%d frame=%d unit=turretlaser id=%d x=%.1f y=%.1f z=%.1f ground=%.1f orig=%.1f",
				caseAt(x, z), Spring.GetGameFrame(), unitID, x, y, z,
				Spring.GetGroundHeight(x, z), Spring.GetGroundOrigHeight(x, z)))
		end
	end

	function gadget:UnitDestroyed(unitID, unitDefID)
		if unitDefID == terraunitDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE terraunit-gone case=%d frame=%d id=%d health=%.3f",
				caseAt(x, z), Spring.GetGameFrame(), unitID, select(5, Spring.GetUnitHealth(unitID)) or -1))
		end
	end

	local function profile(i)
		local cx, cz = lane(i)
		-- Across the wall, west of the turret so the turret's footprint does
		-- not count.
		local parts = {}
		for dz = -96, 96, 8 do
			local x, z = cx - 40, cz + dz
			parts[#parts + 1] = string.format("%d:%.1f", dz, Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z))
		end
		Spring.Echo(string.format("FIXTURE profile-z case=%d frame=%d %s", i, Spring.GetGameFrame(), table.concat(parts, " ")))
		parts = {}
		-- Along the wall and past its ends.
		for dx = -240, 240, 8 do
			local x, z = cx + dx, cz
			parts[#parts + 1] = string.format("%d:%.1f", dx, Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z))
		end
		Spring.Echo(string.format("FIXTURE profile-x case=%d frame=%d %s", i, Spring.GetGameFrame(), table.concat(parts, " ")))
	end

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			for i = 1, CASES do
				local cx, cz = lane(i)
				local lo, hi = math.huge, -math.huge
				for dx = -200, 200, 8 do
					for dz = -96, 96, 8 do
						local h = Spring.GetGroundOrigHeight(cx + dx, cz + dz)
						lo, hi = math.min(lo, h), math.max(hi, h)
					end
				end
				for n = 1, BUILDERS[i] or 1 do
					local bx, bz = cx + BUILDER_OFFSET, cz + (n - 1) * 48
					local unitID = Spring.CreateUnit("cloakcon", bx, Spring.GetGroundHeight(bx, bz), bz, "east", TEAM)
					builders[#builders + 1] = unitID
					caseOfBuilder[unitID] = i
					Spring.SetUnitRulesParam(unitID, "coilbox_case", i)
					Spring.SetUnitRulesParam(unitID, "coilbox_lane_x", cx)
					Spring.SetUnitRulesParam(unitID, "coilbox_lane_z", cz)
					Spring.Echo(string.format("FIXTURE builder case=%d id=%s lane=%d,%d ground=%.1f..%.1f",
						i, tostring(unitID), cx, cz, lo, hi))
				end
			end
		end
		if frame % 30 == 0 then
			Spring.SetTeamResource(TEAM, "ms", 100000)
			Spring.SetTeamResource(TEAM, "es", 100000)
			Spring.SetTeamResource(TEAM, "m", 100000)
			Spring.SetTeamResource(TEAM, "e", 100000)
		end
		if frame > CREATE_FRAME and (frame % REPORT_EVERY == 0 or frame == 90 or frame == 120) then
			for _, unitID in ipairs(builders) do
				if Spring.ValidUnitID(unitID) then
					Spring.Echo(string.format("FIXTURE queue case=%d frame=%d unit=%d %s", caseOfBuilder[unitID], frame, unitID, queue(unitID)))
				end
			end
		end
		if frame == END_FRAME then
			for i = 1, CASES do
				profile(i)
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
