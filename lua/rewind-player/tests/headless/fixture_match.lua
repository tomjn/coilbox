-- The match scripts/rewind-playback-headless.sh records and then plays back.
--
-- The recorder's own fixture (lua/rewind-recorder/tests/headless/) is 360 frames
-- of one unit walking. Playback needs more to show: a building that is built
-- over time, a unit that dies and leaves a wreck, a wreck that goes, ground that
-- changes, and more than one window of 900 frames. This plays on top of the
-- base game's own start, as that fixture does, and adds those.
--
-- Nothing here is asserted about. The script compares the engine during
-- playback with the track this match is recorded into.

function gadget:GetInfo()
	return {
		name = "Coilbox rewind playback fixture match",
		desc = "A short match with a construction, a death, a wreck and a change of ground",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		layer = 2000,
		enabled = true,
	}
end

local MOBILE = "fedak"
local OTHER = "lozscorpion"
local BUILDING = "smallstorage"

-- Frames. The match is longer than one 900 frame window of a track.
local CREATE_FRAME = 10
local ORDER_FRAME = 40
local BUILD_START = 100
local BUILD_END = 400
local SECOND_FRAME = 300
local DEATH_FRAME = 500
local GROUND_FRAME = 600
local WRECK_FRAME = 700
local QUIET_FRAME = 800
local END_FRAME = 1100
-- Elmos.
local DISTANCE = 320
local SPACING = 160
local RAISE = 40

if gadgetHandler:IsSyncedCode() then
	local centre = {}
	local walker, victim, building, second
	local died = {}

	local function create(name, dx, dz, team, nanoframe)
		local x, z = centre.x + dx, centre.z + dz
		local unitID = Spring.CreateUnit(name, x, Spring.GetGroundHeight(x, z), z, "east", team, nanoframe)
		if unitID then
			-- Hold fire, so that how the match goes does not depend on combat.
			Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { 0 }, 0)
		end
		return unitID
	end

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			-- The centre of the map, on the grid the engine builds on.
			centre.x = 16 * math.floor(Game.mapSizeX / 32)
			centre.z = 16 * math.floor(Game.mapSizeZ / 32)
			walker = create(MOBILE, 0, 0, 0)
			victim = create(OTHER, 0, SPACING, 1)
			-- A unit of the other team that lives to the end, so the base game
			-- never finds that team empty.
			create(OTHER, 0, 2 * SPACING, 1)
			Spring.Echo(string.format("PLAYBACK_FIXTURE created %s and %s", tostring(walker), tostring(victim)))
		elseif frame == ORDER_FRAME and walker then
			Spring.GiveOrderToUnit(walker, CMD.MOVE, { centre.x + DISTANCE, 0, centre.z }, 0)
		elseif frame == BUILD_START then
			building = create(BUILDING, -SPACING, -SPACING, 0, true)
			Spring.Echo("PLAYBACK_FIXTURE building " .. tostring(building))
		elseif frame == SECOND_FRAME then
			second = create(MOBILE, SPACING, -SPACING, 0)
		elseif frame == DEATH_FRAME and victim then
			died.x, died.y, died.z = Spring.GetUnitPosition(victim)
			Spring.DestroyUnit(victim, false, false)
		elseif frame == GROUND_FRAME then
			local x, z = centre.x - 2 * SPACING, centre.z + 2 * SPACING
			Spring.SetHeightMapFunc(function()
				for dx = 0, 16, 8 do
					for dz = 0, 16, 8 do
						Spring.SetHeightMap(x + dx, z + dz, Spring.GetGroundHeight(x + dx, z + dz) + RAISE)
					end
				end
			end)
		elseif frame == WRECK_FRAME and died.x then
			local wrecks = Spring.GetFeaturesInCylinder(died.x, died.z, SPACING / 2)
			for _, featureID in ipairs(wrecks) do
				Spring.DestroyFeature(featureID)
			end
			Spring.Echo("PLAYBACK_FIXTURE wrecks removed " .. #wrecks)
		elseif frame == QUIET_FRAME and second then
			Spring.DestroyUnit(second, false, true)
		end

		-- Nobody builds the building. Its progress is set, a little on every frame.
		if building and frame > BUILD_START and frame <= BUILD_END then
			local progress = (frame - BUILD_START) / (BUILD_END - BUILD_START)
			local _, maxHealth = Spring.GetUnitHealth(building)
			Spring.SetUnitHealth(building, { build = progress, health = maxHealth * progress })
		end

		if frame == END_FRAME then
			Spring.Echo("PLAYBACK_FIXTURE done " .. frame)
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
