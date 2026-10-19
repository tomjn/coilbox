-- id: spring-get-has-lag
-- catalogue: removed:Spring.GetHasLag
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.GetHasLag, removed in 105.0 (commit 13a636710e, "nuke
-- Spring.GetHasLag").
--
-- In 104.0.1 GetHasLag(maxLatency) returned whether the simulation was behind,
-- from CGame::IsLagging with maxLatency defaulting to 500 milliseconds
-- (rts/Lua/LuaUnsyncedRead.cpp). The same commit renamed that to
-- CGame::IsSimLagging, and a current engine returns its answer, for the same
-- argument and default, 4th from Spring.GetGameState. Complete Annihilation
-- stable-8405's dbg_dcicon.lua calls GetHasLag in DrawScreen.

local Spring = Spring
if type(Spring) ~= "table" or Spring.GetHasLag ~= nil or type(Spring.GetGameState) ~= "function" then
	return
end

local select = select
local GetGameState = Spring.GetGameState

Spring.GetHasLag = function(maxLatency)
	return select(4, GetGameState(maxLatency)) == true
end
