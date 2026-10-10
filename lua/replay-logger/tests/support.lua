-- Shared scaffolding for the replay logger's tests.
--
-- The gadget is one file with a synced half and an unsynced half, and the gadget
-- handler loads it once for each. So does this: two stub environments, with the
-- synced one's SendToUnsynced wired to the unsynced one's RecvFromSynced, which
-- is the only way a line reaches the file in an engine too.
--
-- The synced stub is strict on purpose. The gadget's whole promise is that it
-- reads the simulation and never writes to it, so the synced Spring table holds
-- the read functions the gadget is allowed and nothing else. Reaching for any
-- other name raises, and so does drawing a random number.
--
-- This directory is not part of what coilbox puts in the analysis game. Only
-- luarules/ is.

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

--- lua/replay-logger, derived from the test file's own path.
function M.root()
	return arg[0]:match("^(.*)/tests/[^/]+$") or "."
end

M.GADGET = "luarules/gadgets/coilbox_replay_logger.lua"

--- A JSON decoder that is not the logger's own encoder: the blueprint widget's.
M.json = dofile(M.root() .. "/../blueprint-widget/luaui/coilbox_blueprints/json.lua")

--- Every line the run wrote, decoded.
function M.decoded(engine)
	local lines = {}
	for index, line in ipairs(engine.lines) do
		lines[index] = M.json.decode(line)
	end
	return lines
end

--- The decoded lines of one kind, in the order they were written.
function M.ofKind(engine, kind)
	local found = {}
	for _, line in ipairs(M.decoded(engine)) do
		if line.kind == kind then
			found[#found + 1] = line
		end
	end
	return found
end

--- A table that raises when anything not in it is read, naming what was asked
-- for. `what` says whose table it is.
local function strict(what, allowed)
	return setmetatable(allowed, {
		__index = function(_, name)
			error(what .. "." .. tostring(name) .. " is not something the synced half may touch", 2)
		end,
	})
end

--- A stand-in for the slice of the engine the logger touches.
--
-- `options.game` overrides fields of the Game table, `options.teams` is the team
-- list, `options.gaiaTeam` the Gaia team, and `options.stats` is keyed by team
-- and holds that team's statistics samples, oldest first. `options.noFile` makes
-- the write directory refuse the file.
function M.newEngine(options)
	options = options or {}

	local engine = {
		frame = 0,
		-- unitID -> { defID, team, x, y, z }
		units = {},
		-- team -> how many units the engine has counted it capturing.
		captured = {},
		nextUnitID = 1,
		-- What the unsynced half wrote, one entry per line, and how many times it
		-- flushed.
		lines = {},
		flushes = 0,
		closed = false,
		opened = {},
		-- Every console command sent through Spring.SendCommands.
		commands = {},
		logs = {},
		removed = false,
	}

	local game = {
		gameName = "Test Game",
		gameVersion = "1.0",
		gameShortName = "TG",
		mapName = "Test Map",
		mapSizeX = 4096,
		mapSizeZ = 2048,
		version = "105",
	}
	for key, value in pairs(options.game or {}) do
		game[key] = value
	end

	local file = {}
	function file:write(...)
		local text = table.concat({ ... })
		-- One write call is one line, newline included.
		engine.lines[#engine.lines + 1] = (text:gsub("\n$", ""))
		engine.raw = (engine.raw or "") .. text
	end
	function file:flush()
		engine.flushes = engine.flushes + 1
	end
	function file:close()
		engine.closed = true
	end

	local function common(env)
		env.Game = game
		env.Engine = { version = "2026.01.0", versionFull = "2026.01.0 test" }
		env.gadget = env
		return env
	end

	--- What the synced half may read. Nothing here changes anything.
	local syncedSpring = strict("Spring", {
		GetGameFrame = function()
			return engine.frame
		end,
		GetUnitPosition = function(unitID)
			local unit = engine.units[unitID]
			if not unit then
				return nil
			end
			return unit.x, unit.y, unit.z
		end,
		GetGaiaTeamID = function()
			return options.gaiaTeam
		end,
		GetTeamList = function()
			return options.teams or { 0, 1 }
		end,
		-- killed, died, capturedBy, capturedFrom, received, sent, in the engine's
		-- order. Only the captures are kept here.
		GetTeamUnitStats = function(teamID)
			return 0, 0, engine.captured[teamID] or 0, 0, 0, 0
		end,
		-- One argument answers how many samples a team has, two answer the
		-- sample at that index in a list, the way the engine's own does. The
		-- newest sample reports the current frame, as the engine's does.
		GetTeamStatsHistory = function(teamID, index)
			local samples = (options.stats or {})[teamID]
			if not samples then
				return nil
			end
			if index == nil then
				return #samples
			end
			local copy = {}
			for key, value in pairs(samples[index]) do
				copy[key] = value
			end
			if index == #samples then
				copy.frame = engine.frame
			end
			return { copy }
		end,
	})

	local unsynced

	local syncedEnv = common({
		Spring = syncedSpring,
		gadgetHandler = {
			IsSyncedCode = function()
				return true
			end,
		},
		SendToUnsynced = function(...)
			if unsynced and unsynced.RecvFromSynced then
				unsynced.RecvFromSynced(unsynced, ...)
			end
		end,
		-- A random draw in synced code moves the engine's own generator on, so
		-- the gadget may not make one.
		math = setmetatable({}, {
			__index = function(_, name)
				if name == "random" or name == "randomseed" then
					error("the synced half drew a random number", 2)
				end
				return math[name]
			end,
		}),
	})
	setmetatable(syncedEnv, { __index = _G })

	local unsyncedEnv = common({
		Spring = {
			GetGaiaTeamID = function()
				return options.gaiaTeam
			end,
			SendCommands = function(...)
				for _, command in ipairs({ ... }) do
					engine.commands[#engine.commands + 1] = command
				end
			end,
			Log = function(_, level, message)
				engine.logs[#engine.logs + 1] = level .. ": " .. message
			end,
		},
		gadgetHandler = {
			IsSyncedCode = function()
				return false
			end,
			RemoveGadget = function()
				engine.removed = true
			end,
		},
		io = {
			open = function(path, mode)
				engine.opened[#engine.opened + 1] = { path, mode }
				if options.noFile then
					return nil, "permission denied"
				end
				return file
			end,
		},
	})
	setmetatable(unsyncedEnv, { __index = _G })

	local function loadHalf(env)
		local chunk = assert(loadfile(M.root() .. "/" .. M.GADGET))
		setfenv(chunk, env)
		chunk()
		return env
	end

	-- Synced first, then unsynced, which is the order the engine loads them in.
	engine.synced = loadHalf(syncedEnv)
	unsynced = loadHalf(unsyncedEnv)
	engine.unsynced = unsynced
	unsynced:Initialize()

	--- Create a unit where the test says it is, and tell the logger.
	function engine.create(defID, team, x, y, z, builderID)
		local unitID = engine.nextUnitID
		engine.nextUnitID = unitID + 1
		engine.units[unitID] = { defID = defID, team = team, x = x, y = y, z = z }
		engine.synced:UnitCreated(unitID, defID, team, builderID)
		return unitID
	end

	function engine.finish(unitID)
		local unit = engine.units[unitID]
		engine.synced:UnitFinished(unitID, unit.defID, unit.team)
	end

	function engine.move(unitID, x, y, z)
		local unit = engine.units[unitID]
		unit.x, unit.y, unit.z = x, y, z
	end

	--- Hand a unit to another team, as a gift or, with `captured`, a capture. The
	-- engine raises the new team's counter before it calls UnitGiven, and calls
	-- UnitTaken first while the unit is still the old team's.
	function engine.give(unitID, newTeam, captured)
		local unit = engine.units[unitID]
		local oldTeam = unit.team
		if engine.synced.UnitTaken then
			engine.synced:UnitTaken(unitID, unit.defID, oldTeam, newTeam)
		end
		unit.team = newTeam
		if captured then
			engine.captured[newTeam] = (engine.captured[newTeam] or 0) + 1
		end
		engine.synced:UnitGiven(unitID, unit.defID, newTeam, oldTeam)
	end

	--- Simulate every frame up to and including `frame`.
	function engine.runTo(frame)
		while engine.frame < frame do
			engine.frame = engine.frame + 1
			engine.synced:GameFrame(engine.frame)
		end
	end

	--- Destroy a unit. `attackerID` is nothing for a unit that died of something
	-- other than an attack, which is how the engine reports a self destruct.
	function engine.destroy(unitID, attackerID, weaponDefID)
		local unit = engine.units[unitID]
		local attacker = attackerID and engine.units[attackerID]
		engine.synced:UnitDestroyed(unitID, unit.defID, unit.team, attackerID,
			attacker and attacker.defID, attacker and attacker.team, weaponDefID)
		engine.units[unitID] = nil
	end

	return engine
end

return M
