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

--- The payload of every message of one kind the synced half sent its unsynced
-- half, in the order it sent them.
function M.sent(engine, message)
	local payloads = {}
	for _, entry in ipairs(engine.sent) do
		if entry[1] == message then
			payloads[#payloads + 1] = entry[2]
		end
	end
	return payloads
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
		["luarules/mission_runtime/coilbox_zones.lua"] = module("luarules/mission_runtime/coilbox_zones.lua"),
		["luarules/mission_runtime/coilbox_vars.lua"] = module("luarules/mission_runtime/coilbox_vars.lua"),
		["luarules/mission_runtime/coilbox_groups.lua"] = module("luarules/mission_runtime/coilbox_groups.lua"),
		["luarules/mission_runtime/coilbox_objectives.lua"] = module(
			"luarules/mission_runtime/coilbox_objectives.lua"),
		["luarules/mission_runtime/coilbox_gameover.lua"] = module(
			"luarules/mission_runtime/coilbox_gameover.lua"),
		["luarules/mission_runtime/coilbox_dialogue.lua"] = module(
			"luarules/mission_runtime/coilbox_dialogue.lua"),
		["luarules/mission_runtime/coilbox_view.lua"] = module("luarules/mission_runtime/coilbox_view.lua"),
		["luarules/mission_runtime/coilbox_reveal.lua"] = module("luarules/mission_runtime/coilbox_reveal.lua"),
		["luarules/mission_runtime/coilbox_restrictions.lua"] = module(
			"luarules/mission_runtime/coilbox_restrictions.lua"),
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
--
-- `options.defList` is an array of `{ name = , <def fields> }` created in that
-- order before anything else, for a test that cares which def id came first or
-- what a def does. Every other def moves and shoots, which is what nearly every
-- def in a game does.
--
-- `options.players` is keyed by player id and says which team each one is on,
-- `options.allyTeams` is keyed by engine team number, and `options.allyTeamList`
-- is every ally team the game has.
--
-- `options.allowTransfer(unitID, newTeam, given)` is the game's own
-- `AllowUnitTransfer`, and a test that says nothing about it has a game that
-- allows every transfer.
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
		-- Game rules params by name. The engine keeps one static table for every
		-- Lua handle, which is what makes them readable outside synced code.
		rulesParams = {},
		-- Every SendToUnsynced call, as its argument list.
		sent = {},
		-- Every GiveOrderToUnit call, as { unitID, cmd, params, opts }. Orders are
		-- the whole of what the runtime does to a group, so they are recorded
		-- rather than acted on.
		orders = {},
		-- Every unit def a Pos2BuildPos call named, so a test can say which
		-- placements went through the build grid.
		snapped = {},
		-- Every Spring.GameOver call, as its list of winning ally teams.
		gameOver = {},
		-- What has been done to a unit to take it out of the game: the anchor is
		-- the only thing the runtime does this to.
		blocking = {},
		stealth = {},
		sonarStealth = {},
		sensors = {},
		resourcing = {},
		losMask = {},
		losState = {},
		noDraw = {},
		noMinimap = {},
		-- Every Spring.PlaySoundFile call, as { name, volume }.
		sounds = {},
		-- Every Spring.SetCameraTarget call, and every Spring.MarkerAddPoint one.
		camera = {},
		markers = {},
		-- Every call the unsynced half made into LuaUI, as { name, ... }.
		luaUI = {},
	}

	--- Engine team -> ally team. A team nothing says otherwise about is in an ally
	-- team of its own number, which is what a mission of one participant a side
	-- has.
	local function allyTeamOf(team)
		return (options.allyTeams or {})[team] or team
	end

	--- The def id the engine would have given this name, invented on first use.
	-- `options.buildings` is the set of def names that occupy the build grid, and
	-- `fields` overrides what the def does.
	local function unitDef(name, fields)
		local def = engine.env.UnitDefNames[name]
		if not def then
			-- A def moves and shoots unless the test says otherwise, because that
			-- is what nearly every def in a game does and what the runtime has to
			-- sift through to find something inert enough to anchor with.
			def = {
				id = engine.nextDefID,
				name = name,
				isBuilding = (options.buildings or {})[name] == true,
				speed = 30,
				weapons = { { weaponDef = 1 } },
				buildSpeed = 0,
				metalMake = 0,
				energyMake = 0,
				metalUpkeep = 0,
				energyUpkeep = 0,
				windGenerator = 0,
				tidalGenerator = 0,
				extractsMetal = 0,
			}
			for key, value in pairs(fields or {}) do
				if key ~= "name" then
					def[key] = value
				end
			end
			engine.nextDefID = engine.nextDefID + 1
			engine.env.UnitDefNames[name] = def
			engine.env.UnitDefs[def.id] = def
		end
		return def
	end

	--- Every order a unit was given, in the order it was given them.
	function engine.ordersFor(unitID)
		local given = {}
		for _, order in ipairs(engine.orders) do
			if order[1] == unitID then
				given[#given + 1] = order
			end
		end
		return given
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
			-- What the engine gives a unit whose def asks for nothing else.
			movestate = 1,
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

	--- Put a unit somewhere. A unit the stub spawned has no position until a test
	-- gives it one, because a test that cares where a unit stands says so.
	function engine.move(unitID, x, z)
		local unit = engine.units[unitID]
		unit.x, unit.z = x, z
	end

	--- What a spatial query returns: units that are alive, placed, on the team the
	-- allegiance names, and inside the region.
	--
	-- Matches the engine on the three things a zone depends on. The boundary
	-- counts as inside, the allegiance is a team number or nothing at all, and a
	-- synced query sees every team however the map is lit. A unit no test has
	-- placed is in no region, so an unplaced unit never lands in a zone by
	-- accident.
	function engine.query(allegiance, inside)
		local found = {}
		for _, unitID in ipairs(engine.order) do
			local unit = engine.units[unitID]
			local mine = allegiance == nil or allegiance < 0 or unit.team == allegiance
			if unit.alive and unit.x and mine and inside(unit) then
				found[#found + 1] = unitID
			end
		end
		return found
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
			GetUnitsInRectangle = function(xmin, zmin, xmax, zmax, allegiance)
				return engine.query(allegiance, function(unit)
					return unit.x >= xmin and unit.x <= xmax and unit.z >= zmin and unit.z <= zmax
				end)
			end,
			GetUnitsInCylinder = function(x, z, radius, allegiance)
				return engine.query(allegiance, function(unit)
					local dx, dz = unit.x - x, unit.z - z
					return dx * dx + dz * dz <= radius * radius
				end)
			end,
			GetUnitDefID = function(unitID)
				return engine.units[unitID].defID
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
			GetUnitStates = function(unitID)
				return { movestate = engine.units[unitID].movestate }
			end,
			-- Recorded rather than acted on: what the runtime asks a unit to do is
			-- the whole of what a group does, and a stub that pretended to carry an
			-- order out would be proving its own behaviour instead.
			--
			-- The one exception is the move state, which the runtime reads back
			-- when it puts a group to sleep, so the stub has to keep it.
			GiveOrderToUnit = function(unitID, cmd, params, opts)
				table.insert(engine.orders, { unitID, cmd, params, opts })
				if cmd == engine.env.CMD.MOVE_STATE then
					engine.units[unitID].movestate = params[1]
				end
				return true
			end,
			-- A game gets the last word on a transfer, through `AllowUnitTransfer`,
			-- and answers false when it takes it. `options.allowTransfer` is that
			-- word. A stub that always agreed is why a gift a real engine refused
			-- went unnoticed for as long as it did.
			TransferUnit = function(unitID, newTeam, given)
				local allow = options.allowTransfer
				if allow and not allow(unitID, newTeam, given ~= false) then
					return false
				end
				engine.give(unitID, newTeam)
				return true
			end,
			-- The engine snaps to a 16-elmo grid with an offset that depends on the
			-- footprint. This keeps only the part a test can assert: the placement
			-- moved, and it moved for a building and not for anything else.
			Pos2BuildPos = function(defID, x, _, z)
				table.insert(engine.snapped, defID)
				local function snap(value)
					return math.floor(value / 16) * 16
				end
				return snap(x), 0, snap(z)
			end,
			SetTeamResource = function(team, kind, amount)
				bank(team)[kind] = amount
			end,
			AddTeamResource = function(team, kind, amount)
				drip(team)[kind] = drip(team)[kind] + amount
			end,
			SetGameRulesParam = function(name, value)
				-- A nil value erases the param, the way the engine's own does.
				engine.rulesParams[name] = value
			end,
			-- Game rules params carry a line-of-sight flag that the engine then
			-- ignores for them: it reads them with the mask that lets everything
			-- through, so one is readable from every handle including LuaUI.
			GetGameRulesParam = function(name)
				return engine.rulesParams[name]
			end,
			-- Declaring the game over. Recorded rather than acted on: what the
			-- runtime passes here is the whole of what a replay says about who won.
			GameOver = function(winners)
				table.insert(engine.gameOver, winners)
				return #winners
			end,
			GetTeamInfo = function(team)
				return team, 0, false, false, "", allyTeamOf(team), 1, {}
			end,
			GetAllyTeamList = function()
				-- Two sides unless a test says otherwise, which is what a mission
				-- with one participant a side has.
				return options.allyTeamList or { 0, 1 }
			end,
			GetTeamList = function()
				-- Two teams unless a test says otherwise, matching the two sides.
				return options.teamList or { 0, 1 }
			end,
			-- Nothing, the way the engine answers when the game has no Gaia team.
			GetGaiaTeamID = function()
				return options.gaiaTeam
			end,
			GetPlayerList = function()
				local ids = {}
				for id in pairs(options.players or {}) do
					ids[#ids + 1] = id
				end
				table.sort(ids)
				return ids
			end,
			GetPlayerInfo = function(playerID)
				local player = (options.players or {})[playerID] or {}
				return "player" .. playerID, true, player.spectator == true, player.team,
					allyTeamOf(player.team)
			end,
			SetUnitBlocking = function(unitID, isBlocking)
				engine.blocking[unitID] = isBlocking
				return isBlocking
			end,
			SetUnitStealth = function(unitID, stealth)
				engine.stealth[unitID] = stealth
			end,
			SetUnitSonarStealth = function(unitID, stealth)
				engine.sonarStealth[unitID] = stealth
			end,
			SetUnitSensorRadius = function(unitID, sensor, radius)
				engine.sensors[unitID] = engine.sensors[unitID] or {}
				engine.sensors[unitID][sensor] = radius
				return radius
			end,
			SetUnitResourcing = function(unitID, resources)
				engine.resourcing[unitID] = resources
			end,
			-- Which ally teams the engine has stopped updating a unit's visibility
			-- for, and what it was left at. Recorded rather than acted on: whether
			-- an ally team can see a unit is the engine's, and pinning it is the
			-- whole of what the runtime does about it.
			SetUnitLosMask = function(unitID, allyTeam, bits)
				engine.losMask[unitID] = engine.losMask[unitID] or {}
				engine.losMask[unitID][allyTeam] = bits
			end,
			SetUnitLosState = function(unitID, allyTeam, bits)
				engine.losState[unitID] = engine.losState[unitID] or {}
				engine.losState[unitID][allyTeam] = bits
			end,
			SetUnitNoDraw = function(unitID, flag)
				engine.noDraw[unitID] = flag
			end,
			SetUnitNoMinimap = function(unitID, flag)
				engine.noMinimap[unitID] = flag
			end,
			-- Answers false for a name the game has no sound for, the way the
			-- engine's own does when the lookup falls through sounds.lua and the
			-- VFS both. `options.sounds` is the set of names that exist; a test
			-- that says nothing about them has every sound.
			PlaySoundFile = function(name, volume)
				table.insert(engine.sounds, { name, volume })
				return options.sounds == nil or options.sounds[name] == true
			end,
			-- Where the camera was sent, as { x, y, z, seconds }.
			SetCameraTarget = function(x, y, z, seconds)
				table.insert(engine.camera, { x, y, z, seconds })
			end,
			-- Every marker put on the map, as { x, y, z, text, localOnly }.
			MarkerAddPoint = function(x, y, z, text, localOnly)
				table.insert(engine.markers, { x, y, z, text, localOnly })
			end,
		},
		Game = { mapName = "Test Map", gameSpeed = 30 },
		-- The engine's own command constants, at the numbers it uses.
		CMD = {
			OPT_SHIFT = 32,
			MOVE = 10,
			PATROL = 15,
			FIGHT = 16,
			ATTACK = 20,
			GUARD = 25,
			FIRE_STATE = 45,
			MOVE_STATE = 50,
			SELFD = 65,
			RECLAIM = 90,
			REPEAT = 115,
			MOVESTATE_HOLDPOS = 0,
			MOVESTATE_MANEUVER = 1,
			MOVESTATE_ROAM = 2,
		},
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
		-- Calling into another Lua handle. The engine answers any name with a
		-- callable and does nothing at all when the other handle has no such
		-- global, so the stub records the call and never refuses one.
		Script = {
			LuaUI = setmetatable({}, {
				__index = function(_, name)
					return function(...)
						table.insert(engine.luaUI, { name, ... })
					end
				end,
			}),
		},
	}
	-- The handler points the gadget table at itself so `function gadget:Foo()`
	-- inside the chunk lands on the gadget.
	env.gadget = env
	setmetatable(env, { __index = _G })

	engine.env = env

	-- The engine has every unit def loaded before a gadget runs. The stub invents
	-- them as they are used, which is enough until something reads a def before it
	-- has spawned one, so the names a test declares are made up front.
	-- Listed defs first and in order, so a test that cares which def id came first
	-- gets the ids it asked for rather than whatever pairs() walked into.
	for _, entry in ipairs(options.defList or {}) do
		unitDef(entry.name, entry)
	end
	for _, set in ipairs({ options.buildings or {}, options.defs or {} }) do
		for name in pairs(set) do
			unitDef(name)
		end
	end

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
