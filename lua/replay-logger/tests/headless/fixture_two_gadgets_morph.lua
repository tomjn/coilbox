-- Half of the two candidate fixture: the gadget that upgrades a start unit. The
-- other half, fixture_two_gadgets_spawner.lua, makes a unit on the same spot from
-- a gadget of its own on the frames an upgrade happens. See
-- scripts/replay-logger-headless.sh for how a real engine runs them.
--
-- Team 0 is upgraded twice. The first swap destroys the old unit in the same
-- call, as Metal Factions does, and the second on the next frame, as Splinter
-- Faction does. Team 1's upgrade makes two units itself, and the logger cannot
-- choose between those.
--
-- A team's first unit is its start unit, so this uses one the game already made
-- and otherwise makes one.

function gadget:GetInfo()
	return {
		name = "Coilbox logger fixture, two gadgets, morph",
		desc = "Replaces a start unit with another on the same spot",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		-- After the spawner, so its unit is made first on a frame they share.
		layer = 0,
		enabled = true,
	}
end

local CREATE_FRAME = 10
local SWAP_FRAME = 120
local SECOND_SWAP_FRAME = 240
local END_FRAME = 360

if gadgetHandler:IsSyncedCode() then
	local pending

	-- The first two units that walk, in id order.
	local function walkers()
		local found = {}
		local id = 1
		while UnitDefs[id] and #found < 2 do
			local def = UnitDefs[id]
			if def.speed > 0 and not def.canFly then
				found[#found + 1] = def.name
			end
			id = id + 1
		end
		return found[1], found[2]
	end

	local function create(name, x, y, z, team)
		local unitID = Spring.CreateUnit(name, x, y, z, "south", team)
		-- So how the match goes does not depend on combat.
		Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { 0 }, 0)
		return unitID
	end

	local function successor(old, name, team)
		local x, y, z = Spring.GetUnitBasePosition(old)
		Spring.SetUnitBlocking(old, false)
		local new = create(name, x, y, z, team)
		Spring.SetUnitPosition(new, x, y, z)
		return new
	end

	function gadget:GameFrame(frame)
		local shared = GG.coilboxLoggerFixture
		if frame == CREATE_FRAME then
			local first, second = walkers()
			shared = { first = first, second = second, units = {} }
			GG.coilboxLoggerFixture = shared
			for team = 0, 1 do
				local held = Spring.GetTeamUnits(team)
				if held and held[1] then
					shared.units[team] = held[1]
				else
					local share = team == 0 and 1 or 3
					local x, z = Game.mapSizeX * share / 4, Game.mapSizeZ * share / 4
					shared.units[team] = create(first, x, Spring.GetGroundHeight(x, z), z, team)
				end
			end
			Spring.Echo("FIXTURE created start units, to become " .. first .. " and " .. second)
		elseif frame == SWAP_FRAME and shared then
			local new = successor(shared.units[0], shared.first, 0)
			Spring.DestroyUnit(shared.units[0], false, true)
			shared.units[0] = new

			successor(shared.units[1], shared.first, 1)
			successor(shared.units[1], shared.second, 1)
			Spring.DestroyUnit(shared.units[1], false, true)
		elseif frame == SECOND_SWAP_FRAME and shared then
			pending = shared.units[0]
			shared.pending = pending
			shared.units[0] = successor(pending, shared.first, 0)
		elseif pending and frame == SECOND_SWAP_FRAME + 1 then
			Spring.DestroyUnit(pending, false, true)
			pending = nil
			shared.pending = nil
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
