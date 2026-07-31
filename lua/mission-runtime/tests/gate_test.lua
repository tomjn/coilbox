-- Proves the modoption gate: what the runtime gadget does before it is a
-- mission runtime at all.
--
-- The gadget is loaded the way Spring's gadget handler loads it, as a chunk
-- whose environment is the gadget table, and the chunk's return value decides
-- whether the handler keeps it. So the gate is testable outside the engine with
-- a stub environment, which is what this does. Run it with:
--
--   luajit lua/mission-runtime/tests/gate_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local ROOT = arg[0]:match("^(.*)/tests/[^/]+$") or "."
local GADGET = ROOT .. "/luarules/gadgets/coilbox_mission_runtime.lua"

local failures = 0

local function check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		failures = failures + 1
		print("FAIL " .. name .. (detail and (": " .. detail) or ""))
	end
end

--- A stand-in for the slice of the engine the gadget touches while loading.
-- Records what it was asked for, so a test can assert the gate did nothing.
local function newEngine(modOptions, files)
	local engine = { logs = {}, reads = 0, GG = {} }

	local env = {
		Spring = {
			GetModOptions = function()
				return modOptions
			end,
			Log = function(section, level, message)
				table.insert(engine.logs, level .. ": " .. message)
			end,
		},
		Game = { mapName = "Test Map" },
		VFS = {
			ZIP = 1,
			FileExists = function(path)
				engine.reads = engine.reads + 1
				return files[path] ~= nil
			end,
			Include = function(path)
				engine.reads = engine.reads + 1
				return files[path]()
			end,
		},
		gadgetHandler = {
			IsSyncedCode = function()
				return true
			end,
		},
		GG = engine.GG,
	}
	-- The handler points the gadget table at itself so `function gadget:Foo()`
	-- inside the chunk lands on the gadget.
	env.gadget = env
	setmetatable(env, { __index = _G })

	engine.env = env
	return engine
end

--- Load the gadget under a stub engine. Returns the engine and the chunk's
-- return value, which is false when the gadget asks the handler to drop it.
local function load(modOptions, files)
	local engine = newEngine(modOptions, files or {})
	local chunk = assert(loadfile(GADGET))
	setfenv(chunk, engine.env)
	local ok, result = pcall(chunk)
	assert(ok, result)
	return engine, result
end

local function logged(engine, needle)
	for _, line in ipairs(engine.logs) do
		if line:find(needle, 1, true) then
			return true
		end
	end
	return false
end

local function runtimeFile()
	return dofile(ROOT .. "/missions/runtime.lua")
end

--- The files a working mission needs in the archive.
local function missionFiles(mission)
	return {
		["missions/runtime.lua"] = runtimeFile,
		["missions/demo/mission.lua"] = function()
			return mission
		end,
	}
end

local function compiled(overrides)
	local mission = {
		schemaVersion = 1,
		runtimeVersion = 1,
		id = "demo",
		name = "Demo",
		map = "Test Map",
	}
	for key, value in pairs(overrides or {}) do
		mission[key] = value
	end
	return mission
end

-- A normal game: no modoption, so the gadget drops itself without reading a
-- single file.
local engine, result = load({})
check("no modoption drops the gadget", result == false)
check("no modoption reads nothing", engine.reads == 0, engine.reads .. " reads")
check("no modoption says nothing", #engine.logs == 0, table.concat(engine.logs, " / "))

engine, result = load({ coilbox_mission = "  " })
check("blank modoption drops the gadget", result == false)
check("blank modoption reads nothing", engine.reads == 0)

engine, result = load({ coilbox_mission = "../../evil" }, missionFiles(compiled()))
check("a path is not a mission id", result == false)
check("a path is reported", logged(engine, "not a mission id"))

engine, result = load({ coilbox_mission = "demo" }, { ["missions/runtime.lua"] = runtimeFile })
check("a missing mission drops the gadget", result == false)
check("a missing mission is reported", logged(engine, "missions/demo/mission.lua is missing"))

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled({ runtimeVersion = 99 })))
check("a mission from the future is refused", result == false)
check("a mission from the future is reported", logged(engine, "needs runtimeVersion 99"))

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled()))
check("a mission keeps the gadget", result ~= false, tostring(result))
check("a mission defines GetInfo", type(engine.env.GetInfo) == "function")
engine.env:Initialize()
check("a mission reaches the rest of the runtime", engine.GG.CoilboxMission ~= nil)
check("the mission id is the modoption", (engine.GG.CoilboxMission or {}).id == "demo")
check("the runtime version is the marker file", (engine.GG.CoilboxMission or {}).runtime.version == 1)

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled({ map = "Other Map" })))
check("the wrong map still runs", result ~= false)
check("the wrong map is reported", logged(engine, "built for map Other Map"))

if failures > 0 then
	print(failures .. " failed")
	os.exit(1)
end
print("all passed")
