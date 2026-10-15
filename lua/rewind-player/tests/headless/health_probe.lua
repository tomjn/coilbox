-- Watches one unit's health between the engine and the player's correction
-- (issues #3986 and #3987).
--
-- The ignored Rust tests write this file into the playback game beside the
-- driver. It is not part of the game coilbox ships.
--
-- The player corrects health in its own GameFrame, at layer 0, and in its
-- GameFramePost. A reading taken after the game's own gadgets and before the
-- player is therefore what the engine and the base game left, which is what
-- this file looks at. Its layer is -50: after Splinter Faction's regeneration
-- gadget at -100, and before the player. The handler calls the lowest layer
-- first, in GameFrame and in GameFramePost alike.
--
-- Two readings a frame, each against the health the unit had when the watch
-- began:
--
-- - at the start of a GameFrame, which has the engine's own healing of the
--   frame before (it happens between GameFrame and GameFramePost) and the
--   regeneration gadget's
-- - at the start of a GameFramePost, which has the engine's own healing of this
--   frame
--
-- The driver starts and ends the watch through GG.

function gadget:GetInfo()
	return { name = "Coilbox rewind health probe", layer = -50, enabled = true }
end

if not gadgetHandler:IsSyncedCode() then
	return
end

local TAG = "REWIND_DRIVER "

local unitID, base, baseMax
local frames, atFrame, atPost, rise, fall, maxMoved = 0, 0, 0, 0, 0, 0

local function read()
	local health = Spring.GetUnitHealth(unitID)
	if health and health ~= base then
		local delta = health - base
		rise, fall = math.max(rise, delta), math.max(fall, -delta)
		return 1
	end
	return 0
end

function gadget:Initialize()
	GG.rewind_health_probe = {
		--- Watches `id` from now on, taking its health now as the one to keep.
		start = function(id)
			unitID = id
			base, baseMax = Spring.GetUnitHealth(id)
			frames, atFrame, atPost, rise, fall, maxMoved = 0, 0, 0, 0, 0, 0
		end,
		--- Says what was seen and stops.
		finish = function(label)
			if unitID then
				Spring.Echo(
					string.format(
						"%s%s unit=%d frames=%d start=%.3f frame_changes=%d post_changes=%d max_rise=%.3f max_fall=%.3f maximum_moved=%d end=%.3f auto_heal=%.3f idle_auto_heal=%.3f",
						TAG,
						label,
						unitID,
						frames,
						base,
						atFrame,
						atPost,
						rise,
						fall,
						maxMoved,
						Spring.GetUnitHealth(unitID) or -1,
						UnitDefs[Spring.GetUnitDefID(unitID)].autoHeal,
						UnitDefs[Spring.GetUnitDefID(unitID)].idleAutoHeal
					)
				)
			end
			unitID = nil
		end,
	}
end

function gadget:GameFrame()
	if unitID then
		frames = frames + 1
		atFrame = atFrame + read()
		-- The maximum is whole again at the start of every frame.
		local _, max = Spring.GetUnitHealth(unitID)
		if max and max ~= baseMax then
			maxMoved = maxMoved + 1
		end
	end
end

function gadget:GameFramePost()
	if unitID then
		atPost = atPost + read()
	end
end
