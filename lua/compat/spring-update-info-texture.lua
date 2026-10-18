-- id: spring-update-info-texture
-- catalogue: removed:Spring.UpdateInfoTexture
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.UpdateInfoTexture, which updates nothing and returns false.
--
-- Changelog, 99.0: "remove Spring.UpdateInfoTexture". In 98.0.1 it updated one
-- of the ground info textures in the background and returned whether it did
-- (rts/Lua/LuaUnsyncedCtrl.cpp). false is what it returned when it could not.

local compat = ...

if type(Spring) == "table" then
	compat.define(Spring, "UpdateInfoTexture", function()
		return false
	end)
end
