-- id: system-log-88
-- catalogue:
-- states: synced, unsynced
-- license: MIT or GNU GPL, v2 or later

-- LOG is in the System table a game's own gadget handler makes.
--
-- A gadget handler copies System into every gadget's table and runs the gadget
-- with that as its environment, so a gadget sees only what System lists. The
-- engine's LuaGadgets/system.lua has listed LOG since 88.0. A handler copied
-- from before then has its own system.lua with no LOG, as Complete Annihilation
-- stable-8405 does. That did no harm until 89.0.1 changed the engine's
-- LuaGadgets/Gadgets/unit_script.lua to call Spring.Log(section, LOG.INFO, ...).
-- Such a game's unit_script gadget includes that file, reads LOG as nil in
-- gadget:Initialize, and stops the whole handler.
--
-- A game's system.lua runs after the prelude and sets System once, so this adds
-- LOG in the global table's __newindex that compat-callin-hooks-v2 put there. A
-- System that has its own LOG is left alone.

local LOG = LOG
local type = type
local meta = getmetatable(_G)

if type(LOG) == "table" and type(meta) == "table" and type(meta.__newindex) == "function" then
	local newindex = meta.__newindex
	meta.__newindex = function(t, name, value)
		if name == "System" and type(value) == "table" and value.LOG == nil then
			value.LOG = LOG
		end
		return newindex(t, name, value)
	end
end
