-- Coilbox rewind player: stops the base game killing a team or ending the match.
--
-- Playback has an empty team whenever the time is before the team's first unit
-- or after its last. A base game takes an empty team for a beaten one: Splinter
-- Faction's game_end.lua calls `Spring.KillTeam`, and a while later
-- `Spring.GameOver`. The engine creates nothing on a dead team again and no call
-- revives one (issue #3791), so one seek to the start of a match would empty
-- the playback for good.
--
-- This replaces the two calls as the file loads, for every gadget that looks
-- them up afterwards. A gadget's `Spring` is the one table all gadgets share,
-- so a replacement here is everybody's.
--
-- It has to load before the gadgets it guards against. game_end.lua copies both
-- calls into locals as it loads, and a copy made before the replacement is the
-- real call. Gadget files load in the order `VFS.DirList` gives them, which the
-- engine sorts by path (`CFileHandler::DirList` in
-- rts/System/FileSystem/FileHandler.cpp), and a game's handler loads them in
-- that order. The "!" this file's name starts with sorts before every letter,
-- digit and underscore, so it loads first in any game whose own gadgets are
-- named with those. Nothing can reach a copy made earlier than that.
-- luarules/gadgets/coilbox_rewind_player.lua logs a team that dies anyway.

function gadget:GetInfo()
	return {
		name = "Coilbox rewind guard",
		desc = "Keeps the base game from killing a team or ending the match during playback.",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

if not gadgetHandler:IsSyncedCode() then
	return false
end

local PREFIX = "COILBOX_REWIND_PLAYER "

local saidKill, saidOver = false, false

--- A line for the log. The player gadget writes it to the playback's own log
-- file with its own lines (issue #4032), and a game without the player gadget
-- has it on the engine's log.
local function say(text)
	if GG and GG.coilboxRewindLog then
		GG.coilboxRewindLog(text)
	else
		Spring.Echo(PREFIX .. text)
	end
end

Spring.KillTeam = function(teamID)
	if not saidKill then
		saidKill = true
		say("the base game asked to kill team " .. tostring(teamID) .. ", and was not let. Later asks are not logged")
	end
end

Spring.GameOver = function()
	if not saidOver then
		saidOver = true
		say("the base game asked to end the match, and was not let. Later asks are not logged")
	end
end
