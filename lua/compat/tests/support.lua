-- Shared scaffolding for the compat prelude's tests.
--
-- The tests load the preludes the coilbox-compat crate builds, which it keeps in
-- tests/fixtures/ and checks are current. Each test gets a fresh stand-in for
-- one Lua state of the engine: its own global table, a Spring table, and a
-- Script.UpdateCallIn that registers a call-in the way rts/Lua/LuaHandle.cpp
-- does, by looking the global up raw. The engine only calls a call-in that is
-- registered, and it registers every one still set when the entry file ends.
--
-- A small gadget handler stands in for a game's: it sets a global for each
-- call-in it handles and then calls Script.UpdateCallIn, as every handler does.

local M = {}

M.failures = 0

function M.check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		M.failures = M.failures + 1
		print("FAIL " .. name .. (detail and (": " .. detail) or ""))
	end
end

function M.report()
	if M.failures > 0 then
		print(M.failures .. " failed")
		os.exit(1)
	end
	print("all passed")
end

--- lua/compat, derived from the test file's own path.
function M.root()
	return (arg[0]:match("^(.*)/tests/[^/]+$") or ".")
end

--- Where the prelude `path` names is kept, for the preludes of manifest `n`.
local function preludes(n)
	return {
		["compat/prelude-synced.lua"] = "/tests/fixtures/prelude-" .. n .. "-synced.lua",
		["compat/prelude-unsynced.lua"] = "/tests/fixtures/prelude-" .. n .. "-unsynced.lua",
	}
end

--- What the engine removes from a Lua state before any game Lua runs, as
--- CSyncedLuaHandle::Init and CUnsyncedLuaHandle::Init do in
--- rts/Lua/LuaHandleSynced.cpp. loadstring is replaced rather than removed, so
--- it stays.
M.REMOVED_UNSYNCED = { "dofile", "loadfile", "loadlib", "require" }
M.REMOVED_SYNCED = {
	"dofile", "loadfile", "loadlib", "require",
	"rawequal", "rawget", "rawset", "newproxy", "gcinfo", "collectgarbage",
}

--- A global table holding a copy of the standard library minus what the
--- engine removes for that state. It has no metatable, as in the engine, so a
--- fix that calls a removed function fails here as it does there.
function M.sandbox(synced)
	local globals = {}
	for key, value in pairs(_G) do
		globals[key] = value
	end
	for _, name in ipairs(synced and M.REMOVED_SYNCED or M.REMOVED_UNSYNCED) do
		globals[name] = nil
	end
	globals._G = globals
	return globals
end

--- A fresh engine state. `synced` picks which prelude it loads and whether it
--- has gl. `spring` adds to or replaces entries of the Spring table.
--- `manifest` picks which manifest's prelude it loads, 9 by default. Only
--- manifests 9 and 11 have fixtures, because the synced preludes of manifests 2
--- to 8 need rawget, which the synced state lacks. `game`
--- is the Game table the engine builds, and `modinfo` is what the mutator's
--- modinfo.lua returns.
function M.newEngine(opts)
	opts = opts or {}
	local engine = { registered = {}, logs = {}, frame = 0, units = {} }
	local env = M.sandbox(opts.synced ~= false)
	engine.env = env

	local Spring = {
		Log = function(_, _, message)
			engine.logs[#engine.logs + 1] = message
		end,
		Echo = function(message)
			engine.logs[#engine.logs + 1] = message
		end,
		GetGameFrame = function()
			return engine.frame
		end,
		ValidUnitID = function(unitID)
			return engine.units[unitID] ~= nil
		end,
		GetUnitVelocity = function(unitID)
			local unit = engine.units[unitID]
			if unit == nil then
				return
			end
			return unit.speed, 0, 0, unit.speed
		end,
		GetUnitIsBeingBuilt = function(unitID)
			local unit = engine.units[unitID]
			if unit == nil then
				return
			end
			return unit.beingBuilt == true, unit.beingBuilt and 0.5 or 1
		end,
	}
	if opts.synced ~= false then
		-- The 105.0 stubs, as rts/Lua/LuaSyncedRead.cpp and LuaSyncedCtrl.cpp
		-- still register them.
		Spring.GetUnitTravel = function()
			return 0, 0
		end
		Spring.SetUnitTravel = function() end
	end
	for name, value in pairs(opts.spring or {}) do
		Spring[name] = value
	end
	if opts.springMeta then
		setmetatable(Spring, opts.springMeta)
	end
	env.Spring = Spring
	env.LOG = { ERROR = 1 }
	env.Script = {
		UpdateCallIn = function(name)
			engine.registered[name] = type(rawget(env, name)) == "function" or nil
		end,
	}
	if opts.synced == false then
		env.gl = opts.gl or {}
	end
	env.UnitDefs = opts.unitDefs or {}
	env.FeatureDefNames = opts.featureDefNames or {}
	env.Game = opts.game
	local files = preludes(opts.manifest or 9)
	env.VFS = {
		MOD = "M",
		Include = function(path)
			if path == "modinfo.lua" and opts.modinfo then
				return opts.modinfo
			end
			local file = files[path]
			assert(file, "no such file in the test VFS: " .. path)
			local chunk = assert(loadfile(M.root() .. file))
			setfenv(chunk, env)
			return chunk()
		end,
	}
	return engine
end

--- Runs Lua source as an entry file in the engine's state, then registers
--- every call-in left in the globals, as the engine does when one ends.
function M.load(engine, source, name)
	local chunk = assert(loadstring(source, name or "entry"))
	setfenv(chunk, engine.env)
	chunk()
	for key, value in pairs(engine.env) do
		if type(key) == "string" and type(value) == "function" and key:match("^%u") then
			engine.registered[key] = true
		end
	end
end

--- Loads the state's prelude the way a wrapped entry file does.
function M.prelude(engine)
	local path = engine.env.gl and "compat/prelude-unsynced.lua" or "compat/prelude-synced.lua"
	M.load(engine, 'VFS.Include("' .. path .. '")')
end

--- The engine calling a call-in: only one that is registered, and only what
--- the global holds now.
function M.call(engine, name, ...)
	if not engine.registered[name] then
		return
	end
	local fn = rawget(engine.env, name)
	if type(fn) ~= "function" then
		return
	end
	return fn(...)
end

--- A gadget handler that handles the call-ins in `handlers` by name, setting
--- each global and telling the engine, then lets `remove` take one away.
function M.handler(engine, handlers)
	local env = engine.env
	local h = {}
	function h.set(name, fn)
		rawset(env, name, nil)
		if fn ~= nil then
			env[name] = fn
		end
		env.Script.UpdateCallIn(name)
	end
	for name, fn in pairs(handlers) do
		h.set(name, fn)
	end
	return h
end

return M
