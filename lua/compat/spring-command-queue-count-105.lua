-- id: spring-command-queue-count-105
-- catalogue: signature:Spring.GetCommandQueue@105.0, signature:Spring.GetUnitCommands@105.0, signature:Spring.GetFactoryCommands@105.0
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetCommandQueue, Spring.GetUnitCommands and Spring.GetFactoryCommands
-- returning the whole queue when called with no count, as before 105.0.
--
-- Until then the second argument, how many commands to return, was optional
-- and defaulted to all of them (luaL_optint with -1). RecoilEngine commit
-- 1109bef03e, "make Spring.Get{Unit,Factory}Commands always expect a second
-- argument" (March 2019, first in 105.0), made it luaL_checkint, which raises
-- "number expected, got no value". Spring.GetCommandQueue calls
-- GetUnitCommands, so it fails the same way. Complete Annihilation
-- stable-8405's terraform gadget calls it with the unit alone, and 21 of its
-- gadgets and widgets do the same.
--
-- A call with no count, or a nil one, which luaL_optint also took as the
-- default, gets -1 here. A count the game gave goes through as it came, with
-- the optional third argument after it.
--
-- The prelude is the first line of each of the game's entry files, so no code
-- of the game's has kept the old function in a local by the time this runs. A
-- name the engine does not have is left out.

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

local type = type

for _, key in ipairs({ "GetCommandQueue", "GetUnitCommands", "GetFactoryCommands" }) do
	local get = Spring[key]
	if type(get) == "function" then
		Spring[key] = function(unitID, count, ...)
			if count == nil then
				count = -1
			end
			return get(unitID, count, ...)
		end
	end
end
