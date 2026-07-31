-- Shared scaffolding for the mission runtime's tests.
--
-- The gadget is loaded the way Spring's gadget handler loads it, as a chunk
-- whose environment is the gadget table, and the chunk's return value decides
-- whether the handler keeps it. So a stub environment is enough to run the
-- runtime outside the engine, which is what this builds.
--
-- The stub is not a simulation. It records what the runtime asked the engine to
-- do and plays back only the parts the runtime reacts to: a created unit fires
-- UnitCreated, a destroyed one fires UnitDestroyed. That is what makes claims
-- like "the game's commander is removed and the mission's is not" provable here.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

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

function M.root()
	return arg[0]:match("^(.*)/tests/[^/]+$") or "."
end

function M.logged(engine, needle)
	for _, line in ipairs(engine.logs) do
		if line:find(needle, 1, true) then
			return true
		end
	end
	return false
end

--- Load a runtime module the way the gadget does, in the environment it hands
-- VFS.Include. A module that reads the engine sees the stub, not the real _G.
local function module(path)
	return function(env)
		local chunk = assert(loadfile(M.root() .. "/" .. path))
		setfenv(chunk, env)
		return chunk()
	end
end

--- A compiled mission read out of the scenario fixtures, at the path the runtime
-- expects. They are the same files coilbox emits, so a test that runs one is
-- running the real emitted shape.
function M.fixture(id)
	return dofile(M.root() .. "/../../src/scenario/fixtures/missions/" .. id .. "/mission.lua")
end

--- The files a working mission needs in the archive.
function M.missionFiles(mission)
	return {
		["missions/runtime.lua"] = module("missions/runtime.lua"),
		["luarules/mission_runtime/coilbox_start.lua"] = module("luarules/mission_runtime/coilbox_start.lua"),
		["luarules/mission_runtime/coilbox_triggers.lua"] = module("luarules/mission_runtime/coilbox_triggers.lua"),
		["luarules/mission_runtime/coilbox_unit_conditions.lua"] = module(
			"luarules/mission_runtime/coilbox_unit_conditions.lua"),
		["missions/demo/mission.lua"] = function()
			return mission
		end,
	}
end

--- A compiled mission with the fields every one carries, plus overrides.
function M.compiled(overrides)
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

--- A stand-in for the slice of the engine the gadget touches.
--
-- `options.synced` picks which half of the gadget is being loaded, `options.defs`
-- limits which unit defs exist so a scenario naming a missing one can be tested,
-- and `options.startPositions` is keyed by engine team number.
function M.newEngine(modOptions, files, options)
	options = options or {}

	local engine = {
		logs = {},
		reads = 0,
		GG = {},
		-- unitID -> { def, defID, team, x, y, z, facing, health, maxHealth, alive }
		units = {},
		order = {},
		nextUnitID = 1,
		nextDefID = 1,
		-- Engine team number -> { m = , e = }.
		resources = {},
		income = {},
		noSelect = {},
		-- Every SendToUnsynced call, as its argument list.
		sent = {},
	}

	--- The def id the engine would have given this name, invented on first use.
	local function unitDef(name)
		local def = engine.env.UnitDefNames[name]
		if not def then
			def = { id = engine.nextDefID, name = name }
			engine.nextDefID = engine.nextDefID + 1
			engine.env.UnitDefNames[name] = def
			engine.env.UnitDefs[def.id] = def
		end
		return def
	end

	local function fire(callin, ...)
		local handler = engine.env[callin]
		if handler then
			handler(engine.env, ...)
		end
	end

	--- Tell the runtime a unit has finished building.
	function engine.finish(unitID)
		local unit = engine.units[unitID]
		fire("UnitFinished", unitID, unit.defID, unit.team)
	end

	--- Create a unit the way the engine does, including the callins the runtime
	-- watches. `builderID` stands for a unit that something is building, which
	-- is the case that does not finish here.
	function engine.spawn(def, team, builderID)
		if options.defs and not options.defs[def] then
			error("bad unitDef name: " .. tostring(def), 0)
		end

		local unitID = engine.nextUnitID
		engine.nextUnitID = unitID + 1

		local unit = {
			def = def,
			defID = unitDef(def).id,
			team = team,
			health = 100,
			maxHealth = 100,
			alive = true,
		}
		engine.units[unitID] = unit
		engine.order[#engine.order + 1] = unitID

		fire("UnitCreated", unitID, unit.defID, unit.team, builderID)
		-- A unit created outright is finished inside CreateUnit itself. One with
		-- a builder finishes when its builder is done, so the test says when.
		if not builderID then
			engine.finish(unitID)
		end
		return unitID
	end

	--- Transfer a unit to another team, captured or gifted: the engine tells Lua
	-- the same thing either way.
	function engine.give(unitID, newTeam)
		local unit = engine.units[unitID]
		local oldTeam = unit.team
		unit.team = newTeam
		fire("UnitGiven", unitID, unit.defID, newTeam, oldTeam)
	end

	--- Units still alive, in creation order.
	function engine.alive()
		local alive = {}
		for _, unitID in ipairs(engine.order) do
			if engine.units[unitID].alive then
				alive[#alive + 1] = engine.units[unitID]
			end
		end
		return alive
	end

	local function bank(team)
		engine.resources[team] = engine.resources[team] or { m = 0, e = 0 }
		return engine.resources[team]
	end

	local function drip(team)
		engine.income[team] = engine.income[team] or { m = 0, e = 0 }
		return engine.income[team]
	end

	local env = {
		Spring = {
			GetModOptions = function()
				return modOptions
			end,
			Log = function(_, level, message)
				table.insert(engine.logs, level .. ": " .. message)
			end,
			GetGroundHeight = function(x, z)
				return (options.ground or function()
					return 0
				end)(x, z)
			end,
			GetTeamStartPosition = function(team)
				local pos = (options.startPositions or {})[team]
				if not pos then
					return 0, 0, 0, false
				end
				return pos.x, 0, pos.z, true
			end,
			CreateUnit = function(def, x, y, z, facing, team)
				local unitID = engine.spawn(def, team, nil)
				local unit = engine.units[unitID]
				unit.x, unit.y, unit.z, unit.facing = x, y, z, facing
				return unitID
			end,
			DestroyUnit = function(unitID)
				local unit = engine.units[unitID]
				if not unit or not unit.alive then
					return
				end
				unit.alive = false
				fire("UnitDestroyed", unitID, unit.defID, unit.team)
			end,
			GetTeamUnitCount = function(team)
				local count = 0
				for _, unit in ipairs(engine.alive()) do
					if unit.team == team then
						count = count + 1
					end
				end
				return count
			end,
			GetTeamUnitDefCount = function(team, defID)
				local count = 0
				for _, unit in ipairs(engine.alive()) do
					if unit.team == team and unit.defID == defID then
						count = count + 1
					end
				end
				return count
			end,
			GetUnitHealth = function(unitID)
				local unit = engine.units[unitID]
				return unit.health, unit.maxHealth
			end,
			SetUnitHealth = function(unitID, health)
				engine.units[unitID].health = health
			end,
			SetUnitNoSelect = function(unitID, flag)
				engine.noSelect[unitID] = flag
			end,
			SetTeamResource = function(team, kind, amount)
				bank(team)[kind] = amount
			end,
			AddTeamResource = function(team, kind, amount)
				drip(team)[kind] = drip(team)[kind] + amount
			end,
		},
		Game = { mapName = "Test Map", gameSpeed = 30 },
		-- Filled in as defs are used, so a test names units and never ids.
		UnitDefs = {},
		UnitDefNames = {},
		VFS = {
			ZIP = 1,
			FileExists = function(path)
				engine.reads = engine.reads + 1
				return files[path] ~= nil
			end,
			Include = function(path, env)
				engine.reads = engine.reads + 1
				-- The gadget passes an empty environment for data and none for
				-- code, so code lands in the gadget's own environment here too.
				return files[path](env or engine.env)
			end,
		},
		gadgetHandler = {
			IsSyncedCode = function()
				return options.synced ~= false
			end,
		},
		GG = engine.GG,
		SendToUnsynced = function(...)
			table.insert(engine.sent, { ... })
		end,
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
function M.load(modOptions, files, options)
	local engine = M.newEngine(modOptions, files or {}, options)
	local chunk = assert(loadfile(M.root() .. "/luarules/gadgets/coilbox_mission_runtime.lua"))
	setfenv(chunk, engine.env)
	local ok, result = pcall(chunk)
	assert(ok, result)
	return engine, result
end

return M
