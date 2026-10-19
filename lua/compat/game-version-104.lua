-- id: game-version-104
-- catalogue: renamed:Game.version, renamed:Game.versionFull, renamed:Game.versionPatchSet
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Game.version, Game.versionFull and Game.versionPatchSet, read from Engine.
--
-- Changelog, 104.0: "Game.{version,versionFull,versionPatchSet,buildFlags} now
-- reside in the Engine table". The engine still fills Engine's in every Lua
-- state (rts/Lua/LuaConstEngine.cpp), so this copies each into Game where Game
-- has nothing by that name. A game that reads Game.version, as Spring 1944's
-- unit_weaponToggle.lua does, gets the current engine's version string.

if type(Game) == "table" and type(Engine) == "table" then
	for _, key in ipairs({ "version", "versionFull", "versionPatchSet" }) do
		if Game[key] == nil then
			Game[key] = Engine[key]
		end
	end
end
