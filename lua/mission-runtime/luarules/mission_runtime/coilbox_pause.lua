-- Coilbox mission runtime: pausing the game.
--
-- `pause_game` stops the game clock and `unpause_game` starts it again. They are
-- what lets a lesson stop the world while the player reads an instruction.
--
-- Synced Lua cannot pause a game. The engine pauses when a player's client asks
-- the server to, so the synced half decides only that the mission wants a pause
-- and hands that to the host's `pause` hook, which is where SendToUnsynced
-- lives. The unsynced half of the one player's client then asks the way the
-- pause key does.
--
-- Single player only. A pause stops the game for everybody in it, and a mission
-- has no business doing that to a second player, so with more than one player
-- in the game both actions report themselves once and do nothing.
--
-- A paused game runs no frames, so nothing here can time a pause or end one. A
-- mission unpauses from a trigger the player wakes, which in practice is one
-- waiting on `dialogue_dismissed`. The player's own pause key works throughout.

local M = {}

--- How many players are playing rather than watching.
local function playing()
	local count = 0
	for _, playerID in ipairs(Spring.GetPlayerList() or {}) do
		local _, active, spectator = Spring.GetPlayerInfo(playerID, false)
		if active and not spectator then
			count = count + 1
		end
	end
	return count
end

--- Register the two pause actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param hooks `pause(paused)`, host-supplied
-- @return the pause itself, so a game's own actions pause through it
function M.register(engine, hooks)
	local pause = {}

	--- Ask for the game to be paused or unpaused. Returns whether it asked.
	function pause.set(paused)
		if playing() > 1 then
			engine:report("pause-multiplayer", "warning",
				"pause_game and unpause_game only work in single player, ignoring them in this game")
			return false
		end
		hooks.pause(paused == true)
		return true
	end

	engine:addAction("pause_game", function()
		pause.set(true)
	end)

	engine:addAction("unpause_game", function()
		pause.set(false)
	end)

	return pause
end

return M
