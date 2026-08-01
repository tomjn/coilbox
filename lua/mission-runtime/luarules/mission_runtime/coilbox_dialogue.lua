-- Coilbox mission runtime: dialogue and sound.
--
-- A dialogue line is a radio message: a speaker, a line of text, and optionally
-- a portrait and a voice clip. The scenario declares them and a trigger fires
-- one with the `dialogue` action. `play_sound` is the same idea without the
-- panel: a noise, named by the author, played where the player can hear it.
--
-- Both are things a player sees and hears rather than things that happen in the
-- game, so synced Lua decides *that* a line was said and nothing more. What
-- reaches the screen is the unsynced half's and the widget's. This module is the
-- synced end of that: it resolves the line the trigger named and hands it to the
-- host's `say` and `sound` hooks, which is where SendToUnsynced lives.
--
-- Pure. No engine calls and no globals beyond the Lua standard library.

local M = {}

--- Register the dialogue actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `say(lineId)` and `sound(name)`, both host-supplied
-- @return the dialogue itself, so a game's own actions speak through it
function M.register(engine, state, hooks)
	-- Dialogue id -> the scenario's line.
	local declared = {}
	for _, line in ipairs((state.mission or {}).dialogue or {}) do
		declared[line.id] = line
	end

	local dialogue = {}

	--- The scenario's record for a line, or nothing for a name it never declared.
	function dialogue.get(id)
		return declared[id]
	end

	--- Say a line. An id the scenario never declared says nothing: a line is its
	-- speaker and its text as much as its id, and the runtime cannot invent
	-- either. The compile step resolves every line a trigger names, so a stray
	-- name means a mission edited by hand.
	function dialogue.say(id)
		local line = declared[id]
		if not line then
			engine:report("dialogue:" .. tostring(id), "warning",
				"no dialogue line named " .. tostring(id) .. " in this mission, ignoring it")
			return false
		end
		hooks.say(line.id)
		return true
	end

	--- Play a sound the author named. The name goes to the engine as it stands,
	-- so it is whatever `Spring.PlaySoundFile` accepts: an item in the game's own
	-- sounds.lua, or a path to a file in the game. Unlike a dialogue clip it is
	-- not something coilbox ships beside the mission.
	function dialogue.sound(name)
		if type(name) ~= "string" or name == "" then
			engine:report("sound:" .. tostring(name), "warning",
				"play_sound was given no sound to play, ignoring it")
			return false
		end
		hooks.sound(name)
		return true
	end

	engine:addAction("dialogue", function(params)
		dialogue.say(params.line)
	end)

	engine:addAction("play_sound", function(params)
		dialogue.sound(params.sound)
	end)

	return dialogue
end

return M
