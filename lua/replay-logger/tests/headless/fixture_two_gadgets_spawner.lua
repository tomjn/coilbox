-- The other half of the two candidate fixture: a gadget with nothing to do with
-- the upgrade, which makes a unit on the upgraded unit's spot on the frames of an
-- upgrade. Being a gadget of its own is the point of it, because the logger tells
-- candidates apart by the gadget on the Lua stack. On the frame the old unit goes
-- in team 0's second upgrade it makes one more, after the new unit and before the
-- old one is destroyed.

function gadget:GetInfo()
	return {
		name = "Coilbox logger fixture, two gadgets, spawner",
		desc = "Makes a unit on a start unit's spot on the frame it is upgraded",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		-- Before the morph gadget, so its unit is made first on a frame they share.
		layer = -1,
		enabled = true,
	}
end

local FRAMES = { [120] = true, [240] = true, [241] = true }

if gadgetHandler:IsSyncedCode() then
	function gadget:GameFrame(frame)
		local shared = GG.coilboxLoggerFixture
		if not (shared and FRAMES[frame]) then
			return
		end
		-- Where the old unit is now, on the frame it goes as on the others. Units
		-- made on one spot push each other apart, so that may not be where the new
		-- one stands.
		local x, y, z = Spring.GetUnitBasePosition(shared.pending or shared.units[0])
		local unitID = Spring.CreateUnit(shared.second, x, y, z, "south", 0)
		Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { 0 }, 0)
	end
end
