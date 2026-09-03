-- Coilbox mission runtime: calling a function the game already has, by name
--.
--
-- A name and not a body. A compiled mission is data the runtime reads out of an
-- archive, and a function written into a scenario would be source arriving from
-- wherever that scenario came from and running in synced Lua on every machine
-- in the game. Naming one the game shipped keeps what runs the game's, which is
-- the same line `missions/extensions.lua` draws: an extension type is the
-- game's to implement, and so is this.
--
-- The name is dotted, because what a game has to offer lives on `GG` rather
-- than loose in a global: `GG.MyGame.StartTheStorm`. The walk is pure and lives
-- here, so it is provable with a table and no engine. Where it starts is the
-- gadget's, because only the gadget has an environment.

local M = {}

--- The value a dotted name points at, walked from `root`.
--
-- Nothing at all for a name that runs out part way through, or that passes
-- through something that is not a table. `GG.MyGame.Fire` on a game with no
-- `GG.MyGame` is a name this game does not have, and that is the same answer as
-- a name it has never heard of.
function M.lookup(root, path)
	local at = root
	for part in tostring(path):gmatch("[^.]+") do
		if type(at) ~= "table" then
			return nil
		end
		at = at[part]
	end
	return at
end

--- Register `call_lua` on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `root()` answers with the table a name is walked from, which is
--   the gadget's own environment, so `GG` and every global the game set are
--   reachable and nothing has to be listed here in advance.
-- @return the handle, so a game's own code can make the same call
function M.register(engine, state, hooks)
	local handle = {}

	--- Call the function `path` names, with the trigger's own params and the
	-- shared context. A name that points at nothing, or at something that is not
	-- a function, is reported once and does nothing.
	--
	-- Whatever the function itself raises is caught by the engine's own pcall
	-- around the action, so a game's mistake is a reported action rather than a
	-- callin that took the game with it.
	function handle.call(path, params, ctx)
		local name = tostring(path or "")
		if name == "" then
			engine:report("call-lua-unnamed", "error",
				"call_lua names no function, so nothing was called")
			return
		end

		local fn = M.lookup(hooks.root(), name)
		if type(fn) ~= "function" then
			engine:report("call-lua:" .. name, "error", string.format(
				"call_lua names %s, which this game has no function for", name))
			return
		end

		return fn(params, ctx)
	end

	engine:addAction("call_lua", function(params, ctx)
		handle.call(params.func, params, ctx)
	end)

	return handle
end

return M
