-- A start unit that is a building, replaced by buildings of another footprint.
-- scripts/replay-logger-headless.sh plays this in a real engine and
-- check_fixture.lua reads what the logger made of it. Needs a game that spawns
-- nothing before SWAP_FRAME, because a team's first unit is its start unit.
-- Splinter Faction spawns nothing in the first 900 frames.
--
-- The swaps copy what unit_morph.lua does in Splinter Faction and Metal Factions:
-- the new unit goes on the build grid, and the old one is removed with
-- Spring.DestroyUnit(unitID, false, true).
--
-- Team 0 is followed twice. Its first swap destroys the old unit in the same
-- call, as Metal Factions does, and its second on the next frame, as Splinter
-- Faction does. Team 1 gets a building one elmo further than a build square from
-- its start unit, which is not a successor.

function gadget:GetInfo()
	return {
		name = "Coilbox logger fixture, building",
		desc = "Replaces a start building with buildings of other footprints",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local CREATE_FRAME = 10
local SWAP_FRAME = 120
local SECOND_SWAP_FRAME = 240
local END_FRAME = 360

-- The start building stands this far past a corner of the build grid, so a snap
-- has to move its replacement.
local OFF_GRID_X = 13
local OFF_GRID_Z = 11
local BUILD_SQUARE = 16
-- Footprints in the engine's squares. The fixture needs one even and one odd
-- number of build squares across, because the snap treats them differently.
local EVEN_FOOTPRINT = 4
local ODD_FOOTPRINT = 6
local OUTSIDE = BUILD_SQUARE + 1

if gadgetHandler:IsSyncedCode() then
	local evenDef, oddDef
	local units = {}
	local pending

	-- The first building of a square footprint, in id order, so a run does not
	-- depend on which units a version of the game has.
	local function buildingOf(size)
		local id = 1
		while UnitDefs[id] do
			local def = UnitDefs[id]
			if def.isBuilding and def.xsize == size and def.zsize == size then
				return def.name
			end
			id = id + 1
		end
	end

	local function create(name, x, z, team)
		local unitID = Spring.CreateUnit(name, x, Spring.GetGroundHeight(x, z), z, "south", team)
		-- So how the match goes does not depend on combat.
		Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { 0 }, 0)
		return unitID
	end

	local function snapped(position, size)
		local cell = math.floor(position / BUILD_SQUARE) * BUILD_SQUARE
		if size / 4 ~= math.floor(size / 4) then
			return cell + BUILD_SQUARE / 2
		end
		return cell
	end

	local function swapped(old, name, size, team)
		local x, y, z = Spring.GetUnitBasePosition(old)
		Spring.SetUnitBlocking(old, false)
		local nx, nz = snapped(x, size), snapped(z, size)
		local new = create(name, nx, nz, team)
		Spring.SetUnitPosition(new, nx, y, nz)
		return new
	end

	function gadget:GameFrame(frame)
		if frame == CREATE_FRAME then
			evenDef, oddDef = buildingOf(EVEN_FOOTPRINT), buildingOf(ODD_FOOTPRINT)
			if not (evenDef and oddDef) then
				Spring.Echo("FIXTURE no building has a footprint of " .. EVEN_FOOTPRINT .. " or " .. ODD_FOOTPRINT)
				return
			end
			for team = 0, 1 do
				-- Corners of the grid a quarter of the map in from each side.
				local share = team == 0 and 1 or 3
				local x = BUILD_SQUARE * math.floor(Game.mapSizeX * share / (4 * BUILD_SQUARE)) + OFF_GRID_X
				local z = BUILD_SQUARE * math.floor(Game.mapSizeZ * share / (4 * BUILD_SQUARE)) + OFF_GRID_Z
				units[team] = create(oddDef, x, z, team)
			end
			Spring.Echo("FIXTURE created " .. oddDef .. ", to become " .. evenDef)
		elseif frame == SWAP_FRAME and units[0] then
			local new = swapped(units[0], evenDef, EVEN_FOOTPRINT, 0)
			Spring.DestroyUnit(units[0], false, true)
			units[0] = new

			local x, _, z = Spring.GetUnitBasePosition(units[1])
			create(evenDef, x + OUTSIDE, z, 1)
			Spring.DestroyUnit(units[1], false, true)
		elseif frame == SECOND_SWAP_FRAME and units[0] then
			pending = units[0]
			units[0] = swapped(pending, oddDef, ODD_FOOTPRINT, 0)
		elseif pending and frame == SECOND_SWAP_FRAME + 1 then
			Spring.DestroyUnit(pending, false, true)
			pending = nil
		end

		if frame == END_FRAME then
			Spring.Echo("FIXTURE done " .. frame)
			Spring.GameOver({ 0 })
		end
	end
else
	local started = Spring.GetTimer()

	-- Ends the engine a little after the match so that it writes its replay. A
	-- match that never starts is ended by the clock instead.
	function gadget:Update()
		if Spring.GetGameFrame() >= END_FRAME + 45 or Spring.DiffTimers(Spring.GetTimer(), started) > 300 then
			Spring.SendCommands("quitforce")
		end
	end
end
