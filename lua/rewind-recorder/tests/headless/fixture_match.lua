-- The fixture match for scripts/rewind-headless.sh.
--
-- It plays on top of the base game's own start, so the two commanders and the
-- map's features are whatever the game and the map make of them. On top of that
-- it creates one unit of its own at a fixed place, orders it to a fixed place,
-- destroys a second one of its own, and ends the match at a fixed frame. Every
-- number the script asserts about the first unit comes from the engine's own
-- report in this file, and none from the track under test.
--
-- The unit reports its position as `FIXTURE unit` lines, one for every 30th
-- frame. The script reads them back out of the engine's log.

function gadget:GetInfo()
	return {
		name = "Coilbox rewind fixture match",
		desc = "Creates one moving unit and ends the match at a fixed frame",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local UNIT = "fedak"
local TEAM = 0
local VICTIM_TEAM = 1
-- How far south of the moving unit the other team's unit starts, in elmos.
local VICTIM_OFFSET = 160
-- Frames. The order is given long after every start gadget has finished, and
-- the unit has stopped moving well before the match ends.
local CREATE_FRAME = 10
local ORDER_FRAME = 40
local DESTROY_FRAME = 300
local END_FRAME = 360
local REPORT_EVERY = 30
-- How far east of the map's centre the unit is sent, in elmos.
local DISTANCE = 320

if gadgetHandler:IsSyncedCode() then
	local unitID, victimID
	local start = {}

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			-- The centre of the map, on the grid the engine builds on.
			start.x = 16 * math.floor(Game.mapSizeX / 32)
			start.z = 16 * math.floor(Game.mapSizeZ / 32)
			start.y = Spring.GetGroundHeight(start.x, start.z)
			unitID = Spring.CreateUnit(UNIT, start.x, start.y, start.z, "east", TEAM)
			-- A unit of the other team, to be destroyed. The replay analysis
			-- run expects a match in which something dies.
			victimID = Spring.CreateUnit(UNIT, start.x, start.y, start.z + VICTIM_OFFSET, "east", VICTIM_TEAM)
			-- Hold fire, so that how the match goes does not depend on combat.
			Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { 0 }, 0)
			Spring.GiveOrderToUnit(victimID, CMD.FIRE_STATE, { 0 }, 0)
			Spring.Echo(string.format("FIXTURE created %s as %s and %s", UNIT, tostring(unitID), tostring(victimID)))
		elseif frame == ORDER_FRAME and unitID then
			Spring.GiveOrderToUnit(unitID, CMD.MOVE, { start.x + DISTANCE, start.y, start.z }, 0)
		end

		if frame == DESTROY_FRAME and victimID then
			Spring.DestroyUnit(victimID, false, false)
			Spring.Echo("FIXTURE destroyed " .. tostring(victimID) .. " at frame " .. frame)
		end

		if unitID and Spring.ValidUnitID(unitID) and frame % REPORT_EVERY == 0 then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE unit %d %s %d %.3f %.3f %.3f", frame, UNIT, TEAM, x, y, z))
		end

		if frame == END_FRAME then
			Spring.Echo("FIXTURE done " .. frame)
			Spring.GameOver({ 0 })
		end
	end
else
	local started = Spring.GetTimer()

	-- Ends the engine a little after the match so that it writes its replay. A
	-- match that never starts is ended by the clock instead, so a broken game
	-- cannot hang the script.
	function gadget:Update()
		if Spring.GetGameFrame() >= END_FRAME + 45 or Spring.DiffTimers(Spring.GetTimer(), started) > 300 then
			Spring.SendCommands("quitforce")
		end
	end
end
