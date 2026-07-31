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

--- The files a working mission needs in the archive.
function M.missionFiles(mission)
	local root = M.root()
	return {
		["missions/runtime.lua"] = function()
			return dofile(root .. "/missions/runtime.lua")
		end,
		["luarules/mission_runtime/coilbox_start.lua"] = function()
			return dofile(root .. "/luarules/mission_runtime/coilbox_start.lua")
		end,
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
		-- unitID -> { def, team, x, y, z, facing, health, maxHealth, alive }
		units = {},
		order = {},
		nextUnitID = 1,
		-- Engine team number -> { m = , e = }.
		resources = {},
		income = {},
		noSelect = {},
		-- Every SendToUnsynced call, as its argument list.
		sent = {},
	}

	local function fireUnitCreated(unitID, unit, builderID)
		local created = engine.env.UnitCreated
		if created then
			created(engine.env, unitID, 1, unit.team, builderID)
		end
	end

	--- Create a unit the way the engine does, including the callin the runtime
	-- watches. `builderID` stands for a unit that something is building.
	function engine.spawn(def, team, builderID)
		if options.defs and not options.defs[def] then
			error("bad unitDef name: " .. tostring(def), 0)
		end

		local unitID = engine.nextUnitID
		engine.nextUnitID = unitID + 1

		local unit = { def = def, team = team, health = 100, maxHealth = 100, alive = true }
		engine.units[unitID] = unit
		engine.order[#engine.order + 1] = unitID
		fireUnitCreated(unitID, unit, builderID)
		return unitID
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
				local destroyed = engine.env.UnitDestroyed
				if destroyed then
					destroyed(engine.env, unitID, 1, unit.team)
				end
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
