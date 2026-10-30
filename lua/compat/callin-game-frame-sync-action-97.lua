-- id: callin-game-frame-sync-action-97
-- catalogue:
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- A function an unsynced gadget gives to AddSyncAction as well as naming it
-- GameFrame does not also run as the GameFrame call-in.
--
-- Up to Spring 96.0 the engine looked for GameFrame only in the synced half of
-- LuaRules and LuaGaia. Since 97.0 each half has its own Lua state, and the
-- unsynced one gets the call-in too. An old gadget could name a function
-- GameFrame in its unsynced half and run it only when its synced half sent a
-- message. A gadget's environment is its own table, so that function is also
-- gadget.GameFrame, and the handler now calls it on every frame with the frame
-- number where the message's value belongs. Complete Annihilation's nano spray
-- gadget uses that number as a key from 0 to 29, and fails on every frame from
-- frame 30.
--
-- The two kinds of function take the same arguments, so what tells them apart
-- is the registration. A function that is a sync action gets (cmd, value), and
-- one that is a call-in gets (self, frame), so no gadget can mean to be both. A
-- gadget's own gadget:GameFrame, which is not a sync action, keeps the call-in.
--
-- Handlers keep their actions in a table they put in gadgetHandler.actionHandler
-- and read AddSyncAction from it on each call. A game's gadgets.lua runs after
-- the prelude and sets gadgetHandler once, so this wraps AddSyncAction in the
-- global table's __newindex that compat-callin-hooks-v2 put there. The gadget's
-- function stays in its table, because its own code may still call it.

local type = type
local meta = getmetatable(_G)

local function watch(handler)
	local actions = handler.actionHandler
	if type(actions) ~= "table" or type(actions.AddSyncAction) ~= "function" then
		return
	end
	local add = actions.AddSyncAction
	actions.AddSyncAction = function(gadget, cmd, func, help)
		if func ~= nil and gadget.GameFrame == func and type(handler.RemoveGadgetCallIn) == "function" then
			handler:RemoveGadgetCallIn("GameFrame", gadget)
		end
		return add(gadget, cmd, func, help)
	end
end

if type(meta) == "table" and type(meta.__newindex) == "function" then
	local newindex = meta.__newindex
	meta.__newindex = function(t, name, value)
		if name == "gadgetHandler" and type(value) == "table" then
			watch(value)
		end
		return newindex(t, name, value)
	end
end
