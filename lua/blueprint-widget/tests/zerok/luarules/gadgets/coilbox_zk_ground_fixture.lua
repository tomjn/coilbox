-- The synced half of the Zero-K save ground fixture match (issue #4798).
--
-- Runs only when the start script's coilbox_mode is ground_build or
-- ground_place. It creates three constructors 1040 west of the map's middle,
-- gunships, because a walker that stands on a step while it rises is stranded
-- on top of it, and which one it stands on depends on its path. It keeps the
-- team's storage full, reports turrets and solar collectors as they
-- finish, and ends the match at the end frame. The probe widget gives the
-- orders and saves the ground.

local MODE = (Spring.GetModOptions() or {}).coilbox_mode or ""

function gadget:GetInfo()
	return {
		name = "Coilbox Zero-K ground fixture",
		desc = "Creates builders for the save ground probe",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_end_frame) or 9000
local CREATE_FRAME = 30
local BUILDERS = 3
local TEAM = 0

function gadget:Initialize()
	if MODE:sub(1, 6) ~= "ground" then
		gadgetHandler:RemoveGadget(self)
	end
end

if gadgetHandler:IsSyncedCode() then
	local watched = {
		[UnitDefNames.turretlaser.id] = true,
		[UnitDefNames.energysolar.id] = true,
	}
	local terraunitDefID = UnitDefNames.terraunit.id

	function gadget:UnitFinished(unitID, unitDefID)
		if watched[unitDefID] then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("GROUND finished frame=%d unit=%s x=%.1f y=%.1f z=%.1f raised=%.1f",
				Spring.GetGameFrame(), UnitDefs[unitDefID].name, x, y, z, Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z)))
		end
	end

	function gadget:UnitCreated(unitID, unitDefID)
		if unitDefID == terraunitDefID then
			local x, _, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("GROUND terraunit-created frame=%d x=%.1f z=%.1f", Spring.GetGameFrame(), x, z))
		end
	end

	local builders = {}

	function gadget:UnitDestroyed(unitID, unitDefID)
		if unitDefID == terraunitDefID then
			Spring.Echo(string.format("GROUND terraunit-gone frame=%d health=%.3f",
				Spring.GetGameFrame(), select(5, Spring.GetUnitHealth(unitID)) or -1))
		end
	end

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			local cx = 16 * math.floor(Game.mapSizeX / 32)
			local cz = 16 * math.floor(Game.mapSizeZ / 32)
			for n = 1, BUILDERS do
				local bx, bz = cx - 1040, cz + (n - 2) * 32
				local unitID = Spring.CreateUnit("gunshipcon", bx, Spring.GetGroundHeight(bx, bz), bz, "east", TEAM)
				Spring.SetUnitRulesParam(unitID, "coilbox_ground_builder", n)
				builders[n] = unitID
				Spring.Echo(string.format("GROUND fixture-builder n=%d id=%s", n, tostring(unitID)))
			end
		end
		if frame % 30 == 0 then
			Spring.SetTeamResource(TEAM, "ms", 100000)
			Spring.SetTeamResource(TEAM, "es", 100000)
			Spring.SetTeamResource(TEAM, "m", 100000)
			Spring.SetTeamResource(TEAM, "e", 100000)
		end
		if builders[1] and (frame == 90 or frame % 300 == 0) and Spring.ValidUnitID(builders[1]) then
			local parts = {}
			for _, c in ipairs(Spring.GetUnitCommands(builders[1], -1) or {}) do
				parts[#parts + 1] = tostring(c.id)
			end
			local x, _, z = Spring.GetUnitPosition(builders[1])
			Spring.Echo(string.format("GROUND queue frame=%d at=%.0f,%.0f %s", frame, x, z, table.concat(parts, ",")))
		end
		if frame == END_FRAME then
			Spring.Echo("GROUND done " .. frame)
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
