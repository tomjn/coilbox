-- A stand-in for the slice of the engine the player gadget uses: units,
-- features, the heightmap, teams, game rules parameters and messages.
--
-- Each call follows RecoilEngine at commit 212c369b4c, in rts/Lua/LuaSyncedCtrl.cpp,
-- LuaSyncedMoveCtrl.cpp and LuaSyncedRead.cpp, not what a manual says:
--
-- Spring.CreateUnit raises for a definition or a team the engine does not have.
-- It returns nothing, with no error, for a team that is dead or at its unit
-- limit (CUnitHandler::CanBuildUnit). It calls UnitCreated before it returns.
-- Asking for a unit id is refused here, because a destroyed id cannot be asked
-- for again at once (issue #3791) and the player must never do it.
--
-- Spring.DestroyUnit does nothing for an id that is not a live unit. It calls
-- UnitDestroyed before it returns. A unit destroyed with `reclaimed` false and
-- already built asks AllowFeatureCreation for its wreck, as
-- CFeatureHandler::CreateWreckage does. Spring.CreateFeature does not ask it.
--
-- Spring.SetUnitHealth takes a number or a table. `health` is held to the
-- maximum. `build` of 1 or more finishes the unit, and less turns it back into
-- a nanoframe, except on an engine from before 2025.03.9, where a finished unit
-- stays finished (`world.oldEngine`).
--
-- Spring.MoveCtrl.SetPosition and SetRotation do nothing for a unit that is not
-- under move control (ParseScriptMoveType).
--
-- Spring.SetHeightMap raises outside Spring.SetHeightMapFunc, and takes x and z
-- in elmos, which it divides by 8 and cuts to a whole number.
--
-- Nothing a gadget calls on every frame allocates here, so a test can count
-- what the gadget itself allocates.

local M = {}

local SQUARE = 8

--- A world. `options.unitDefs` and `options.featureDefs` are lists of
-- definitions with a `name`, `options.teams` a list of `{ id, allyTeam }` with
-- Gaia last, and `options.modOptions` what the start script carried.
function M.new(options)
	options = options or {}
	local world = {
		units = {},
		features = {},
		heights = {},
		params = {},
		los = {},
		lines = {},
		sent = 0,
		events = {},
		orders = 0,
		nextUnit = 100,
		nextFeature = 500,
		oldEngine = false,
		refusedWrecks = 0,
		inHeightMap = false,
		teams = {},
		gaia = nil,
		gadget = nil,
	}

	local unitDefs, unitDefNames = {}, {}
	for id, def in ipairs(options.unitDefs or {}) do
		local copy = { id = id, name = def.name, health = def.health or 1000, buildTime = def.buildTime or 100, onoffable = def.onoffable or false }
		unitDefs[id], unitDefNames[def.name] = copy, copy
	end
	local featureDefs, featureDefNames = {}, {}
	for id, def in ipairs(options.featureDefs or {}) do
		local copy = { id = id, name = def.name }
		featureDefs[id], featureDefNames[def.name] = copy, copy
	end
	local teamList = options.teams or { { id = 0, allyTeam = 0 }, { id = 1, allyTeam = 1 }, { id = 2, allyTeam = 2 } }
	for _, team in ipairs(teamList) do
		world.teams[team.id] = { id = team.id, allyTeam = team.allyTeam, dead = false, limit = team.limit or 1000, count = 0 }
		world.gaia = team.id
	end

	local function call(name, ...)
		local gadget = world.gadget
		if gadget and gadget[name] then
			return gadget[name](gadget, ...)
		end
	end
	world.call = call

	local function event(kind, id)
		world.events[#world.events + 1] = kind .. " " .. id
	end

	local Spring = {}

	function Spring.Echo(line)
		world.lines[#world.lines + 1] = tostring(line)
	end

	function Spring.GetModOptions()
		return options.modOptions or {}
	end

	function Spring.GetGaiaTeamID()
		return world.gaia
	end

	function Spring.GetTeamList()
		local list = {}
		for id in pairs(world.teams) do
			list[#list + 1] = id
		end
		table.sort(list)
		return list
	end

	function Spring.GetAllyTeamList()
		local seen, list = {}, {}
		for _, team in pairs(world.teams) do
			if not seen[team.allyTeam] then
				seen[team.allyTeam] = true
				list[#list + 1] = team.allyTeam
			end
		end
		table.sort(list)
		return list
	end

	function Spring.GetTeamInfo(teamID)
		local team = world.teams[teamID]
		if not team then
			return
		end
		return teamID, 0, team.dead, false, "", team.allyTeam
	end

	--- The engine's own call. The guard gadget replaces it in this table.
	function Spring.KillTeam(teamID)
		if world.teams[teamID].dead then
			return
		end
		world.teams[teamID].dead = true
		call("TeamDied", teamID)
	end

	function Spring.GameOver()
		world.gameOver = true
	end

	function Spring.SetGlobalLos(allyTeam, state)
		world.los[allyTeam] = state
	end

	function Spring.SetGameRulesParam(name, value)
		world.params[name] = value
	end

	function Spring.GetGameRulesParam(name)
		return world.params[name]
	end

	-- Units.

	local function unit(id)
		local found = world.units[id]
		if found and not found.dead then
			return found
		end
	end

	function Spring.CreateUnit(def, x, y, z, facing, teamID, beingBuilt, flattenGround, unitID)
		local found = type(def) == "number" and unitDefs[def] or unitDefNames[def]
		if not found then
			error("[CreateUnit()]: bad unitDef: " .. tostring(def), 2)
		end
		local team = world.teams[teamID]
		if not team then
			error("[CreateUnit()]: invalid team number (" .. tostring(teamID) .. ")", 2)
		end
		assert(unitID == nil, "the player asked for a unit id, which cannot be reused at once")
		assert(flattenGround == false, "the player let the engine flatten the ground under a unit")
		if team.dead or team.count >= team.limit then
			return nil
		end
		local id = world.nextUnit
		world.nextUnit = id + 1
		team.count = team.count + 1
		world.units[id] = {
			id = id,
			def = found,
			team = teamID,
			x = x,
			y = y,
			z = z,
			pitch = 0,
			yaw = 0,
			roll = 0,
			beingBuilt = beingBuilt == true,
			build = beingBuilt == true and 0 or 1,
			health = found.health,
			maxHealth = found.health,
			active = false,
			moveCtrl = false,
			useWeapons = true,
		}
		event("create", id)
		call("UnitCreated", id, found.id, teamID)
		return id
	end

	function Spring.DestroyUnit(id, selfDestruct, reclaimed)
		local found = unit(id)
		if not found then
			return
		end
		found.dead = true
		found.loud = not reclaimed and not found.beingBuilt
		world.teams[found.team].count = world.teams[found.team].count - 1
		event(found.loud and "explode" or "remove", id)
		call("UnitDestroyed", id, found.def.id, found.team)
		if found.loud then
			-- The engine asks before it leaves a wreck.
			if call("AllowFeatureCreation", 1, found.team, found.x, found.y, found.z) == false then
				world.refusedWrecks = world.refusedWrecks + 1
			else
				world.wrecks = (world.wrecks or 0) + 1
			end
		end
	end

	function Spring.ValidUnitID(id)
		return unit(id) ~= nil
	end

	function Spring.GetUnitIsDead(id)
		local found = world.units[id]
		if found then
			return found.dead == true
		end
	end

	function Spring.GetAllUnits()
		local list = {}
		for id, found in pairs(world.units) do
			if not found.dead then
				list[#list + 1] = id
			end
		end
		table.sort(list)
		return list
	end

	function Spring.GetUnitHealth(id)
		local found = unit(id)
		if found then
			return found.health, found.maxHealth, 0, 0, found.build
		end
	end

	function Spring.SetUnitHealth(id, value)
		local found = unit(id)
		if not found then
			return
		end
		found.healthSets = (found.healthSets or 0) + 1
		if type(value) == "number" then
			found.health = math.min(found.maxHealth, value)
			return
		end
		if value.health then
			found.health = math.min(found.maxHealth, value.health)
		end
		if value.build then
			found.build = value.build
			if value.build >= 1 then
				found.beingBuilt, found.build = false, 1
			elseif not world.oldEngine then
				found.beingBuilt = true
			end
		end
	end

	function Spring.GetUnitIsStunned(id)
		local found = unit(id)
		if found then
			return found.beingBuilt, false, found.beingBuilt
		end
	end

	function Spring.SetUnitUseWeapons(id, force, allow)
		local found = unit(id)
		if found then
			found.useWeapons = force or allow
		end
	end

	function Spring.GetUnitIsActive(id)
		local found = unit(id)
		if found then
			return found.active
		end
	end

	function Spring.GiveOrderToUnit(id, command, params)
		local found = unit(id)
		world.orders = world.orders + 1
		if found and command == 85 and found.def.onoffable then
			found.active = params[1] == 1
		end
	end

	Spring.MoveCtrl = {}

	function Spring.MoveCtrl.Enable(id)
		local found = unit(id)
		if found then
			found.moveCtrl = true
		end
	end

	function Spring.MoveCtrl.SetPosition(id, x, y, z)
		local found = unit(id)
		if found and found.moveCtrl then
			found.x, found.y, found.z = x, y, z
		end
	end

	function Spring.MoveCtrl.SetRotation(id, pitch, yaw, roll)
		local found = unit(id)
		if found and found.moveCtrl then
			found.pitch, found.yaw, found.roll = pitch, yaw, roll
		end
	end

	-- Features.

	function Spring.CreateFeature(def, x, y, z, heading, teamID)
		local found = type(def) == "number" and featureDefs[def] or featureDefNames[def]
		if not found then
			return nil
		end
		local id = world.nextFeature
		world.nextFeature = id + 1
		world.features[id] = { id = id, def = found, team = teamID, x = x, y = y, z = z, pitch = 0, yaw = 0, roll = 0 }
		event("feature", id)
		call("FeatureCreated", id, teamID)
		return id
	end

	function Spring.DestroyFeature(id)
		if not world.features[id] then
			return
		end
		world.features[id] = nil
		event("unfeature", id)
		call("FeatureDestroyed", id)
	end

	function Spring.ValidFeatureID(id)
		return world.features[id] ~= nil
	end

	function Spring.GetAllFeatures()
		local list = {}
		for id in pairs(world.features) do
			list[#list + 1] = id
		end
		table.sort(list)
		return list
	end

	function Spring.SetFeaturePosition(id, x, y, z)
		local found = world.features[id]
		if found then
			found.x, found.y, found.z = x, y, z
		end
	end

	function Spring.SetFeatureRotation(id, pitch, yaw, roll)
		local found = world.features[id]
		if found then
			found.pitch, found.yaw, found.roll = pitch, yaw, roll
		end
	end

	-- The heightmap.

	function Spring.SetHeightMapFunc(fn, ...)
		assert(not world.inHeightMap, "SetHeightMapFunc() recursion is not permitted")
		world.heightMapCalls = (world.heightMapCalls or 0) + 1
		world.inHeightMap = true
		fn(...)
		world.inHeightMap = false
	end

	function Spring.SetHeightMap(x, z, height)
		if not world.inHeightMap then
			error("SetHeightMap() can only be called in SetHeightMapFunc()", 2)
		end
		local cx, cz = math.floor(x / SQUARE), math.floor(z / SQUARE)
		world.heights[cz * 65536 + cx] = height
	end

	--- The height the test last saw set at a corner, or nil.
	function world.height(x, z)
		return world.heights[z * 65536 + x]
	end

	--- How many units are alive.
	function world.unitCount()
		return #Spring.GetAllUnits()
	end

	--- The one live unit of a definition name, or nil when there is none.
	function world.unitNamed(name)
		for _, id in ipairs(Spring.GetAllUnits()) do
			if world.units[id].def.name == name then
				return world.units[id]
			end
		end
	end

	world.Spring = Spring
	world.globals = {
		Spring = Spring,
		UnitDefNames = unitDefNames,
		UnitDefs = unitDefs,
		FeatureDefNames = featureDefNames,
		WeaponDefNames = {},
		CMD = { ONOFF = 85 },
		Game = {
			gameSpeed = 30,
			squareSize = SQUARE,
			constructionDecay = options.constructionDecay == true,
			constructionDecaySpeed = 0.03,
		},
		SendToUnsynced = function(name, phase)
			world.sent = world.sent + 1
			world.sentName, world.sentPhase = name, phase
		end,
		next = next,
	}
	return world
end

--- The environment a synced gadget of this world runs in: the reader's globals
-- from support.lua, the world's, and a `VFS.Include` that loads the player's
-- own modules into the same environment, as the engine's does when it is given
-- none. `files` are the files the game holds besides those modules, by path.
function M.env(t, world, files)
	local env = t.syncedEnv({ files = files })
	for name, value in pairs(world.globals) do
		env[name] = value
	end
	env.VFS.Include = function(path)
		local file = path:match("^luarules/rewind_player/(.+)$")
		if file then
			return t.load(file, env)
		end
		-- A file the test put in the game, run in the environment of its caller
		-- as the engine's is.
		local source = files and files[path]
		assert(source, "something included " .. path)
		local chunk = assert(loadstring(source, path))
		setfenv(chunk, env)
		return chunk()
	end
	env.VFS.FileExists = function(path)
		return files ~= nil and files[path] ~= nil
	end
	return env
end

return M
