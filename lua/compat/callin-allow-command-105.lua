-- id: callin-allow-command-105
-- catalogue: signature:AllowCommand@105.0
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- The AllowCommand call-in with the arguments it had before 105.0.
--
-- Changelog, 105.0: "change {Allow,Unit}Command callin parameters
-- AllowCommand(..., cmdTag, fromSynced) --> AllowCommand(..., cmdTag, playerID,
-- fromSynced, fromLua)".
--
-- Up to 104.0.1 the eighth argument was fromSynced (rts/Lua/LuaHandleSynced.cpp).
-- Now it is playerID, which a handler written for the old list reads as
-- fromSynced, and a number is always true. This drops playerID and fromLua
-- before the game's handler sees the call, and passes its answer back.
--
-- UnitCommand changed in the same release, but only by gaining arguments at
-- the end, which an old handler never reads.

local compat = ...

compat.hook("AllowCommand", function(nextFn, unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOptions, cmdTag, playerID, fromSynced, fromLua)
	return nextFn(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOptions, cmdTag, fromSynced)
end)
