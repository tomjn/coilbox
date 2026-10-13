-- Shared scaffolding for the rewind recorder's tests: a stand-in for the slice
-- of the engine the recorder reads, and a file that keeps the bytes written to
-- it.
--
-- The Spring table is strict. It holds the calls the recorder is known to make
-- and nothing else, so reaching for another raises and names it. Every one of
-- them reads, but for SendCommands, Log and Echo, which talk to the engine and
-- not to the simulation.
--
-- The packing calls are real: VFS.PackF32 and VFS.PackU32 here write the same
-- bytes the engine's do, and stop at the first value that is not a number the
-- way the engine's do. So a dump written here is read by tests/dump.lua the way
-- a real one is.
--
-- This directory is not part of what coilbox puts in the analysis game. Only
-- luarules/ is.

local ffi = require("ffi")

local M = {}

M.failures = 0

function M.check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		M.failures = M.failures + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

--- Check two values are the same, and say both when they are not.
function M.same(name, got, wanted)
	M.check(name, got == wanted, "got " .. tostring(got) .. ", wanted " .. tostring(wanted))
end

function M.report()
	if M.failures > 0 then
		print(M.failures .. " failed")
		os.exit(1)
	end
	print("all passed")
end

--- lua/rewind-recorder, derived from the test file's own path.
function M.root()
	return arg[0]:match("^(.*)/tests/[^/]+$") or "."
end

M.GADGET = "luarules/gadgets/coilbox_rewind_recorder.lua"
M.REQUEST = "luarules/configs/coilbox_rewind_request.lua"

M.dump = dofile(M.root() .. "/tests/dump.lua")

--- A JSON decoder that is not the recorder's own encoder: the blueprint
-- widget's.
M.json = dofile(M.root() .. "/../blueprint-widget/luaui/coilbox_blueprints/json.lua")

--- A number as the 32 bit float the dump holds it as.
function M.float(value)
	local one = ffi.new("float[1]", value)
	return tonumber(one[0])
end

local function pack(ctype, size)
	return function(...)
		local values = { ... }
		if type(values[1]) == "table" then
			values = values[1]
		end
		local count = 0
		while type(rawget(values, count + 1)) == "number" do
			count = count + 1
		end
		if count == 0 then
			return nil
		end
		local buffer = ffi.new(ctype .. "[?]", count)
		for index = 1, count do
			buffer[index - 1] = values[index]
		end
		return ffi.string(buffer, count * size)
	end
end

local function strict(what, allowed)
	return setmetatable(allowed, {
		__index = function(_, name)
			error(what .. "." .. tostring(name) .. " is not a call the recorder is known to make", 2)
		end,
	})
end

--- The identity matrix as the sixteen numbers the engine returns, moved to
-- x, y, z.
function M.matrix(x, y, z)
	return { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x or 0, y or 0, z or 0, 1 }
end

--- A stand-in engine.
--
-- `options.request` is the request file's table, or false for a game that has
-- none. `options.noFile` makes the write directory refuse the file.
-- `options.unitDefs`, `featureDefs` and `weaponDefs` are the definition lists.
-- `options.models` is keyed by unit definition and holds `{ pieces = { names },
-- parents = { parent name for each } }`. `options.handlerCallIn` puts a
-- function of the gadget handler's own at the heightmap call-in before the
-- recorder loads. `options.frontOnly` makes the direction calls answer the
-- front and nothing else, as an older engine does.
function M.newEngine(options)
	options = options or {}

	local engine = {
		frame = -1,
		units = {},
		unitOrder = {},
		features = {},
		featureOrder = {},
		projectiles = {},
		projectileOrder = {},
		-- corner index -> height, for corners that are not at the map's own.
		ground = {},
		groundDrawn = {},
		bytes = "",
		flushes = 0,
		closed = false,
		opened = {},
		commands = {},
		logs = {},
		echoes = {},
		removed = false,
		callInUpdates = {},
		handlerRects = {},
		-- Whether the spectator sees everything, and each change of that.
		fullView = options.fullView ~= false,
		views = {},
		nextID = 1,
	}

	local game = {
		gameName = "Test Game",
		gameVersion = "1.0",
		mapName = "Test Map",
		mapSizeX = 64,
		mapSizeZ = 32,
		squareSize = 8,
		gameSpeed = 30,
		maxUnits = 32000,
	}
	for key, value in pairs(options.game or {}) do
		game[key] = value
	end
	-- Corners along x, the far edge included.
	local cornersX = game.mapSizeX / game.squareSize + 1

	local file = {}
	function file:write(...)
		for _, part in ipairs({ ... }) do
			assert(type(part) == "string", "the recorder wrote something that is not a string")
			engine.bytes = engine.bytes .. part
		end
	end
	function file:flush()
		engine.flushes = engine.flushes + 1
	end
	function file:close()
		engine.closed = true
	end

	local function unit(unitID)
		return engine.units[unitID]
	end

	--- The map's own height at a corner: a slope, so no two corners match.
	local function original(x, z)
		return x / game.squareSize + z / game.squareSize * 100
	end

	local function corner(x, z)
		return (z / game.squareSize) * cornersX + x / game.squareSize
	end

	local spring = strict("Spring", {
		GetGameFrame = function()
			return engine.frame
		end,
		GetGaiaTeamID = function()
			return options.gaiaTeam or 2
		end,
		GetTeamList = function()
			return options.teams or { 0, 1, 2 }
		end,
		-- teamID, leader, isDead, hasAI, side, allyTeam, in the engine's order.
		GetTeamInfo = function(teamID)
			return teamID, teamID == 1 and 0 or teamID, false, teamID == 1, teamID == 0 and "arm" or "core", teamID
		end,
		GetTeamColor = function(teamID)
			return teamID == 0 and 1 or 0, 0.5, 0.2, 1
		end,
		GetPlayerInfo = function(playerID)
			return playerID == 0 and 'Some "One"' or nil
		end,
		GetAIInfo = function()
			return 0, "TestAI"
		end,
		GetAllUnits = function()
			local all = {}
			for _, unitID in ipairs(engine.unitOrder) do
				if engine.units[unitID] then
					all[#all + 1] = unitID
				end
			end
			return all
		end,
		GetUnitIsDead = function(unitID)
			return unit(unitID) and unit(unitID).dead or false
		end,
		GetUnitDefID = function(unitID)
			return unit(unitID) and unit(unitID).def
		end,
		GetUnitTeam = function(unitID)
			return unit(unitID) and unit(unitID).team
		end,
		GetUnitPosition = function(unitID)
			local u = unit(unitID)
			if not u then
				return nil
			end
			return u.x, u.y, u.z
		end,
		-- front, right, up.
		GetUnitDirection = function(unitID)
			local u = unit(unitID)
			if not u then
				return nil
			end
			if options.frontOnly then
				return u.front[1], u.front[2], u.front[3]
			end
			return u.front[1], u.front[2], u.front[3], 9, 9, 9, u.up[1], u.up[2], u.up[3]
		end,
		-- front, up, right, each a table.
		GetUnitVectors = function(unitID)
			local u = unit(unitID)
			if not u then
				return nil
			end
			return { u.front[1], u.front[2], u.front[3] }, { u.up[1], u.up[2], u.up[3] }, { 9, 9, 9 }
		end,
		-- health, maxHealth, paralyzeDamage, captureProgress, buildProgress.
		GetUnitHealth = function(unitID)
			local u = unit(unitID)
			if not u then
				return nil
			end
			return u.health, u.maxHealth, 0, 0, u.build
		end,
		GetUnitIsActive = function(unitID)
			return unit(unitID) and unit(unitID).active
		end,
		-- The engine's own answers: the type alone for no target, then
		-- isUserTarget and a unit id, a position table or a projectile id.
		GetUnitWeaponTarget = function(unitID, weapon)
			local u = unit(unitID)
			local target = u and u.targets[weapon]
			if not u or weapon > u.weapons then
				return nil
			end
			if not target then
				return 0
			end
			return target[1], false, target[2]
		end,
		GetUnitWeaponVectors = function(unitID, weapon)
			local u = unit(unitID)
			local muzzle = u and u.muzzles[weapon]
			if not muzzle then
				return nil
			end
			return u.x + muzzle[1], u.y + muzzle[2], u.z + muzzle[3], 0, 0, 1
		end,
		GetUnitPieceList = function(unitID)
			local model = unit(unitID) and options.models and options.models[unit(unitID).def]
			return model and model.pieces or {}
		end,
		GetUnitPieceInfo = function(unitID, piece)
			local model = options.models[unit(unitID).def]
			return { name = model.pieces[piece], parent = model.parents[piece] or "[null]" }
		end,
		GetUnitPiecePosDir = function(unitID, piece)
			local u = unit(unitID)
			local matrix = u and u.pieces[piece]
			if not matrix then
				return nil
			end
			engine.positionReads = (engine.positionReads or 0) + 1
			return u.x + matrix[13], u.y + matrix[14], u.z + matrix[15], 0, 0, 1
		end,
		GetUnitPieceMatrix = function(unitID, piece)
			local u = unit(unitID)
			local matrix = u and u.pieces[piece]
			if not matrix then
				return nil
			end
			engine.matrixReads = (engine.matrixReads or 0) + 1
			return unpack(matrix)
		end,
		GetUnitWorkerTask = function(unitID)
			local u = unit(unitID)
			if not (u and u.task) then
				return nil
			end
			return u.task[1], u.task[2]
		end,
		GetUnitCurrentBuildPower = function(unitID)
			return unit(unitID) and unit(unitID).power
		end,
		GetUnitCommandCount = function(unitID)
			return unit(unitID) and #unit(unitID).commands
		end,
		-- cmdID, options, tag, then the parameters.
		GetUnitCurrentCommand = function(unitID, index)
			local u = unit(unitID)
			local command = u and u.commands[index or 1]
			if not command then
				return nil
			end
			return command[1], 0, 7, unpack(command, 2)
		end,
		GetAllFeatures = function()
			local all = {}
			for _, featureID in ipairs(engine.featureOrder) do
				if engine.features[featureID] then
					all[#all + 1] = featureID
				end
			end
			return all
		end,
		GetFeatureDefID = function(featureID)
			return engine.features[featureID] and engine.features[featureID].def
		end,
		GetFeatureTeam = function(featureID)
			return engine.features[featureID] and engine.features[featureID].team
		end,
		GetFeaturePosition = function(featureID)
			local f = engine.features[featureID]
			if not f then
				return nil
			end
			return f.x, f.y, f.z
		end,
		GetFeatureDirection = function(featureID)
			local f = engine.features[featureID]
			if not f then
				return nil
			end
			if options.frontOnly then
				return f.front[1], f.front[2], f.front[3]
			end
			return f.front[1], f.front[2], f.front[3], 9, 9, 9, f.up[1], f.up[2], f.up[3]
		end,
		GetAllProjectiles = function()
			local all = {}
			for _, id in ipairs(engine.projectileOrder) do
				if engine.projectiles[id] then
					all[#all + 1] = id
				end
			end
			return all
		end,
		GetProjectilePosition = function(id)
			local p = engine.projectiles[id]
			if not p then
				return nil
			end
			return p.x, p.y, p.z
		end,
		GetProjectileVelocity = function(id)
			local p = engine.projectiles[id]
			if not p then
				return nil
			end
			return p.vx, p.vy, p.vz
		end,
		GetProjectileDefID = function(id)
			return engine.projectiles[id] and engine.projectiles[id].def
		end,
		GetProjectileTeamID = function(id)
			return engine.projectiles[id] and engine.projectiles[id].team
		end,
		GetProjectileOwnerID = function(id)
			return engine.projectiles[id] and engine.projectiles[id].owner
		end,
		-- What the last draw copied, which is what unsynced Lua is shown.
		GetGroundHeight = function(x, z)
			engine.heightReads = (engine.heightReads or 0) + 1
			return engine.groundDrawn[corner(x, z)] or original(x, z)
		end,
		GetGroundOrigHeight = function(x, z)
			return original(x, z)
		end,
		-- spectating, fullView, fullSelect.
		GetSpectatingState = function()
			return true, engine.fullView, true
		end,
		-- Commands run before the call returns, as the engine's do. Changes
		-- of the spectator's view are kept apart from the rest.
		SendCommands = function(...)
			for _, command in ipairs({ ... }) do
				local view = command:match("^specfullview (%d)$")
				if view then
					engine.views[#engine.views + 1] = command
					local was = engine.fullView
					engine.fullView = tonumber(view) % 2 == 1
					if engine.fullView and not was then
						engine.copyGround()
					end
				else
					engine.commands[#engine.commands + 1] = command
				end
			end
		end,
		Log = function(_, level, message)
			engine.logs[#engine.logs + 1] = level .. ": " .. message
		end,
		Echo = function(message)
			engine.echoes[#engine.echoes + 1] = message
		end,
	})
	if options.noAllProjectiles then
		rawset(spring, "GetAllProjectiles", false)
		rawset(spring, "GetProjectilesInRectangle", function(x1, z1, x2, z2)
			engine.rectangle = { x1, z1, x2, z2 }
			local all = {}
			for _, id in ipairs(engine.projectileOrder) do
				if engine.projectiles[id] then
					all[#all + 1] = id
				end
			end
			return all
		end)
	end

	-- The engine's global table, which a gadget handler hands every gadget.
	local globals = {}
	if options.handlerCallIn then
		globals.UnsyncedHeightMapUpdate = function(x1, z1, x2, z2)
			engine.handlerRects[#engine.handlerRects + 1] = { x1, z1, x2, z2 }
		end
	end
	engine.globals = globals

	local function environment(synced)
		local env = {
			Game = game,
			Engine = { version = "2026.01.0", versionFull = "2026.01.0 test" },
			UnitDefs = options.unitDefs or {},
			FeatureDefs = options.featureDefs or {},
			WeaponDefs = options.weaponDefs or {},
			CMD = { REPAIR = 40, RECLAIM = 90, RESTORE = 110, RESURRECT = 125, CAPTURE = 130 },
			_G = globals,
			Script = {
				UpdateCallIn = function(name)
					engine.callInUpdates[#engine.callInUpdates + 1] = name
				end,
			},
			VFS = {
				FileExists = function(path)
					return path == M.REQUEST and options.request ~= false
				end,
				Include = function(path)
					assert(path == M.REQUEST, "the recorder included " .. tostring(path))
					return options.request == nil and { lastFrame = 1000 } or options.request
				end,
				PackF32 = pack("float", 4),
				PackU32 = pack("uint32_t", 4),
			},
			gadgetHandler = {
				IsSyncedCode = function()
					return synced
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
		}
		env.gadget = env
		-- The synced half is given a Spring table that refuses every call, so
		-- that it making one fails the test.
		env.Spring = synced and strict("the synced half's Spring", {}) or spring
		return setmetatable(env, { __index = _G })
	end

	local function load(synced)
		local env = environment(synced)
		local chunk = assert(loadfile(M.root() .. "/" .. M.GADGET))
		setfenv(chunk, env)
		chunk()
		return env
	end

	engine.synced = load(true)
	engine.recorder = load(false)
	engine.recorder:Initialize()

	local function newID()
		local id = engine.nextID
		engine.nextID = id + 1
		return id
	end

	--- Make a unit and tell the recorder, as the engine does. `fields` overrides
	-- anything about it.
	function engine.create(def, team, x, y, z, fields)
		local unitID = newID()
		local model = options.models and options.models[def]
		local made = {
			def = def, team = team, x = x, y = y, z = z,
			front = { 0, 0, 1 }, up = { 0, 1, 0 },
			health = 100, maxHealth = 100, build = 1, active = true,
			weapons = 0, targets = {}, muzzles = {}, pieces = {},
			commands = {}, power = nil, task = nil,
		}
		for piece = 1, model and #model.pieces or 0 do
			made.pieces[piece] = M.matrix(0, piece, 0)
		end
		for key, value in pairs(fields or {}) do
			made[key] = value
		end
		engine.units[unitID] = made
		engine.unitOrder[#engine.unitOrder + 1] = unitID
		if not (fields and fields.unannounced) then
			engine.recorder:UnitCreated(unitID, def, team, nil)
		end
		return unitID
	end

	--- Destroy a unit. With `dying`, the engine goes on listing it and
	-- answering for it, as it does while a death animation plays.
	function engine.destroy(unitID, dying)
		local u = engine.units[unitID]
		engine.recorder:UnitDestroyed(unitID, u.def, u.team)
		if dying then
			u.dead = true
		else
			engine.units[unitID] = nil
		end
	end

	--- Take a unit off the map with no call-in, as when another gadget's error
	-- has stopped the call from reaching the recorder. With `dying`, the engine
	-- goes on listing it.
	function engine.lose(unitID, dying)
		if dying then
			engine.units[unitID].dead = true
		else
			engine.units[unitID] = nil
		end
	end

	--- Put a feature on the map. With `quietly`, no call-in is made, as for one
	-- that was there before the gadget loaded.
	function engine.feature(def, team, x, y, z, quietly)
		local featureID = newID()
		engine.features[featureID] = {
			def = def, team = team, x = x, y = y, z = z, front = { 1, 0, 0 }, up = { 0, 0.6, 0.8 },
		}
		engine.featureOrder[#engine.featureOrder + 1] = featureID
		if not quietly then
			engine.recorder:FeatureCreated(featureID, 0)
		end
		return featureID
	end

	function engine.removeFeature(featureID)
		engine.recorder:FeatureDestroyed(featureID, 0)
		engine.features[featureID] = nil
	end

	function engine.projectile(fields)
		local id = newID()
		engine.projectiles[id] = fields
		engine.projectileOrder[#engine.projectileOrder + 1] = id
		return id
	end

	--- Change the height the simulation holds at a heightmap corner. Unsynced
	-- Lua sees nothing until the next draw.
	function engine.dig(x, z, height)
		engine.ground[z * cornersX + x] = height
		engine.pending = engine.pending or {}
		engine.pending[#engine.pending + 1] = { x, z, x, z }
	end

	--- Draw: copy the changed heights across and report each rectangle to
	-- whatever function is at the call-in, as CReadMap::UpdateDraw does.
	function engine.draw()
		for _, rect in ipairs(engine.pending or {}) do
			for z = rect[2], rect[4] do
				for x = rect[1], rect[3] do
					engine.groundDrawn[z * cornersX + x] = engine.ground[z * cornersX + x]
				end
			end
			if globals.UnsyncedHeightMapUpdate then
				globals.UnsyncedHeightMapUpdate(rect[1], rect[2], rect[3], rect[4])
			end
		end
		engine.pending = nil
	end

	--- What the engine does when a spectator's full view is turned on: copy
	-- every height across and report the whole map as one rectangle.
	function engine.copyGround()
		for index, height in pairs(engine.ground) do
			engine.groundDrawn[index] = height
		end
		engine.pending = nil
		if globals.UnsyncedHeightMapUpdate then
			globals.UnsyncedHeightMapUpdate(0, 0, game.mapSizeX / game.squareSize, game.mapSizeZ / game.squareSize)
		end
	end

	--- Simulate one frame: the recorder is called as the frame starts.
	function engine.step()
		engine.frame = engine.frame + 1
		engine.recorder:GameFrame(engine.frame)
	end

	function engine.runTo(frame)
		while engine.frame < frame do
			engine.step()
		end
	end

	function engine.gameOver(winners)
		engine.recorder:GameOver(winners)
	end

	--- The dump so far, read back.
	function engine.read()
		return M.dump.read(engine.bytes, M.json.decode)
	end

	--- The frame blocks of the dump so far, by frame number.
	function engine.frames()
		local frames = {}
		for _, block in ipairs(engine.read().blocks) do
			if block.kind == M.dump.BLOCK_FRAME then
				frames[block.frame.frame] = block.frame
			end
		end
		return frames
	end

	--- The rows of one section of one frame, or an empty list.
	function engine.rows(frame, code)
		local found = engine.frames()[frame]
		return found and found.sections[code] or {}
	end

	--- The text blocks of one kind, decoded.
	function engine.texts(kind)
		local found = {}
		for _, block in ipairs(engine.read().blocks) do
			if block.kind == kind then
				found[#found + 1] = block.json
			end
		end
		return found
	end

	return engine
end

return M
