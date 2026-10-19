-- Ends a match of scripts/compat-proof.sh at a fixed frame.
--
-- It travels in the scratch map the script wraps around a real one, not in a
-- game, so the game under test keeps its own name and version in both runs.
-- Every fixture game's gadget handler lists LuaRules/Gadgets with VFS.ZIP_ONLY,
-- which reads the map's archives as well as the game's.
--
-- The synced half says when the match reaches END_FRAME, which is how the
-- script knows the run got there. The unsynced half quits a moment later. A
-- match that stops advancing is ended by the script's own time limit.

function gadget:GetInfo()
	return {
		name = "Coilbox compat proof end",
		desc = "Ends a compat proof match at a fixed frame",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_proof_frames) or 3000

if gadgetHandler:IsSyncedCode() then
	function gadget:GameFrame(frame)
		if frame == END_FRAME then
			Spring.Echo("COMPAT PROOF reached frame " .. frame)
		end
	end
else
	function gadget:Update()
		local frame = Spring.GetGameFrame()
		if frame >= END_FRAME + 5 then
			Spring.Echo("COMPAT PROOF quitting at frame " .. frame)
			Spring.SendCommands("quitforce")
		end
	end
end
