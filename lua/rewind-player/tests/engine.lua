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
-- Spring.SetUnitMaxHealth holds the maximum to at least 0.1 and health to the
-- maximum. `world.heal` is the engine's own healing, which a test runs between
-- the player's frame and its post frame, where the engine does it.
--
-- Spring.MoveCtrl.SetPosition and SetRotation do nothing for a unit that is not
-- under move control (ParseScriptMoveType).
--
-- Spring.SetHeightMap raises outside Spring.SetHeightMapFunc, and takes x and z
-- in elmos, which it divides by 8 and cuts to a whole number.
--
-- Spring.SpawnProjectile gives nothing for a weapon definition the engine does
-- not have and raises when its second argument is not a table. The calls that
-- set something on a projectile do nothing for an id that is not one. Setting
-- a place or a velocity does not need move control, which only stops the
-- engine moving the projectile itself. `world.simulate` is the engine's own
-- frame for them, from rts/Sim/Projectiles.
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
	-- A weapon definition is given as the engine's WeaponDefs has it: `type`,
	-- `selfExplode`, `soundTrigger`, `salvoSize`, `salvoDelay`, `range`,
	-- `intensity`, `waterWeapon` and `fireSound` as a list of `{ name, volume }`.
	local weaponDefs, weaponDefNames = {}, {}
	for id, def in ipairs(options.weaponDefs or {}) do
		local copy = { id = id }
		for key, value in pairs(def) do
			copy[key] = value
		end
		weaponDefs[id], weaponDefNames[def.name] = copy, copy
	end
	world.projectiles = {}
	world.explosions = {}
	world.sounds = {}
	world.soundCount = 0
	world.spawned = 0
	-- Calls that set something on a projectile the engine no longer has. The
	-- engine ignores them, and the id may by then be another projectile's.
	world.staleCalls = 0
	world.armorTypes = 3
	local lastProjectile = 9000
	--- The id the next projectile gets. A test replaces it to hand out an id
	-- again, as the engine does.
	function world.nextProjectile()
		lastProjectile = lastProjectile + 1
		return lastProjectile
	end
	--- The ground's height at a place. A test replaces it.
	function world.ground()
		return 0
	end
	local ZERO = { 0, 0, 0 }

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

	--- LuaSyncedCtrl::SetUnitMaxHealth: the maximum is at least 0.1, and health
	-- is held to it.
	function Spring.SetUnitMaxHealth(id, value)
		local found = unit(id)
		if not found then
			return
		end
		found.maxHealthSets = (found.maxHealthSets or 0) + 1
		found.maxHealth = math.max(0.1, value)
		found.health = math.min(found.maxHealth, found.health)
	end

	--- The engine's own healing of a unit, which CUnit::SlowUpdate does in the
	-- middle of a simulation frame: after the gadgets' GameFrame and before
	-- their GameFramePost, and only for a unit with health below its maximum
	-- that is not under construction (autoHeal and idleAutoHeal). A unit's
	-- repair by a builder stops on the same test, in CUnit::AddBuildPower.
	function world.heal(amount)
		for _, found in next, world.units do
			if not found.dead and not found.beingBuilt and found.health < found.maxHealth then
				found.health = math.min(found.maxHealth, found.health + amount)
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

	-- Projectiles.

	local function projectile(id)
		return world.projectiles[id]
	end

	function Spring.SpawnProjectile(def, params)
		local found = weaponDefs[def]
		if not found then
			return nil
		end
		if type(params) ~= "table" then
			error("[SpawnProjectile] argument 2 must be a table!", 2)
		end
		local at, speed, target = params.pos or ZERO, params.speed or ZERO, params["end"] or ZERO
		local id = world.nextProjectile()
		local damages = { craterMult = found.craterMult or 1, craterBoost = 0, impulseFactor = 1, impulseBoost = 0 }
		for armor = 0, world.armorTypes - 1 do
			damages[armor] = found.damage or 100
		end
		world.projectiles[id] = {
			id = id,
			def = found,
			x = at[1],
			y = at[2],
			z = at[3],
			vx = speed[1],
			vy = speed[2],
			vz = speed[3],
			-- The speed it was created with, which a laser keeps for its length.
			speedf = math.sqrt(speed[1] ^ 2 + speed[2] ^ 2 + speed[3] ^ 2),
			dx = 0,
			dy = 0,
			dz = 0,
			endX = target[1],
			endY = target[2],
			endZ = target[3],
			team = params.team or world.gaia,
			owner = params.owner or -1,
			ttl = math.floor(params.ttl or 0),
			startAlpha = params.startAlpha or 0,
			endAlpha = params.endAlpha or 1,
			moveCtrl = false,
			damages = damages,
			moves = 0,
		}
		local made = world.projectiles[id]
		if made.speedf > 0 then
			made.dx, made.dy, made.dz = speed[1] / made.speedf, speed[2] / made.speedf, speed[3] / made.speedf
		end
		world.spawned = world.spawned + 1
		event("spawn", id)
		return id
	end

	function Spring.DeleteProjectile(id)
		if projectile(id) then
			world.projectiles[id] = nil
			event("delete", id)
		end
	end

	function Spring.SetProjectileMoveControl(id, enable)
		local found = projectile(id)
		if found then
			found.moveCtrl = enable == true
		end
	end

	function Spring.SetProjectilePosition(id, x, y, z)
		local found = projectile(id)
		if not found then
			world.staleCalls = world.staleCalls + 1
			return
		end
		found.x, found.y, found.z = x, y, z
		found.moves = found.moves + 1
	end

	function Spring.SetProjectileVelocity(id, x, y, z)
		local found = projectile(id)
		if not found then
			world.staleCalls = world.staleCalls + 1
			return
		end
		found.vx, found.vy, found.vz = x, y, z
		local length = math.sqrt(x * x + y * y + z * z)
		if length > 0 then
			found.dx, found.dy, found.dz = x / length, y / length, z / length
		end
	end

	--- The way a projectile points, which follows its velocity and keeps the
	-- last one when that is nothing (CProjectile::SetVelocityAndSpeed).
	function Spring.GetProjectileDirection(id)
		local found = projectile(id)
		if found then
			return found.dx, found.dy, found.dz
		end
	end

	function Spring.SetProjectileTimeToLive(id, ttl)
		local found = projectile(id)
		if found then
			found.ttl = math.floor(ttl)
		end
	end

	function Spring.GetProjectileTimeToLive(id)
		local found = projectile(id)
		if found then
			return found.ttl
		end
	end

	--- The table form only takes string keys, and a string that reads as a
	-- number is an armour type (SetSingleDynDamagesKey).
	function Spring.SetProjectileDamages(id, _, values)
		local found = projectile(id)
		if not found then
			return
		end
		for key, value in pairs(values) do
			if type(key) == "string" then
				found.damages[tonumber(key) or key] = value
			end
		end
	end

	function Spring.GetGroundHeight(x, z)
		return world.ground(x, z)
	end

	function Spring.PlaySoundFile(name, volume, x, y, z, channel)
		local n = world.soundCount + 1
		world.soundCount = n
		world.sounds[n] = { name = name, volume = volume, x = x, y = y, z = z, channel = channel }
		return true
	end

	--- An explosion at a place, as CWeaponProjectile::Explode makes one.
	local function explode(found, x, y, z, why)
		local n = #world.explosions + 1
		local worst = 0
		for armor = 0, world.armorTypes - 1 do
			worst = math.max(worst, found.damages[armor])
		end
		world.explosions[n] = {
			id = found.id,
			def = found.def.name,
			x = x,
			y = y,
			z = z,
			why = why,
			damage = worst,
			crater = found.damages.craterMult > 0,
			impulse = found.damages.impulseFactor ~= 0 or found.damages.impulseBoost ~= 0,
		}
		if found.def.type == "LaserCannon" then
			-- CLaserProjectile::CollisionCommon: it stops and fades.
			found.vx, found.vy, found.vz, found.hit = 0, 0, 0, true
		else
			world.projectiles[found.id] = nil
		end
	end

	--- One frame of the engine's projectiles, after the gadgets' GameFrame:
	-- CProjectileHandler::CheckCollisions and then every projectile's Update,
	-- for the kinds the tests use. A hit is looked for from where a projectile
	-- is to where its speed takes it, and move control does not switch that
	-- off. The ground is a test of the place alone.
	function world.simulate()
		for id, found in next, world.projectiles do
			local kind = found.def.type
			local hitscan = kind == "BeamLaser" or kind == "LightningCannon"
			if not hitscan and not found.hit then
				if found.y < world.ground(found.x, found.z) then
					explode(found, found.x, world.ground(found.x, found.z), found.z, "ground")
				else
					local target = world.target
					if target then
						-- The nearest the path comes to the target's middle.
						local dx, dy, dz = target.x - found.x, target.y - found.y, target.z - found.z
						local along = 0
						local length = found.vx ^ 2 + found.vy ^ 2 + found.vz ^ 2
						if length > 0 then
							along = math.max(0, math.min(1, (dx * found.vx + dy * found.vy + dz * found.vz) / length))
						end
						local nx, ny, nz = found.x + found.vx * along, found.y + found.vy * along, found.z + found.vz * along
						if (target.x - nx) ^ 2 + (target.y - ny) ^ 2 + (target.z - nz) ^ 2 <= target.radius ^ 2 then
							explode(found, nx, ny, nz, "target")
						end
					end
				end
			end
			found = world.projectiles[id]
			-- A piece of debris has no time to live, and a test puts one in by hand.
			if found and found.ttl then
				if not found.moveCtrl and not hitscan then
					found.x, found.y, found.z = found.x + found.vx, found.y + found.vy, found.z + found.vz
				end
				found.ttl = found.ttl - 1
				if hitscan then
					if found.ttl <= 0 then
						world.projectiles[id] = nil
					end
				elseif kind == "Cannon" then
					if found.ttl == 0 then
						explode(found, found.x, found.y, found.z, "ttl")
					end
				elseif kind == "LaserCannon" then
					-- CLaserProjectile::Update, for a bolt with laserHardStop. It
					-- stops when its time to live had run out before this frame, grows
					-- by the speed it was created with while it moves, shrinks by it
					-- once stopped, and is gone when nothing is left of it.
					if found.ttl < 0 then
						found.vx, found.vy, found.vz = 0, 0, 0
					end
					if found.vx == 0 and found.vy == 0 and found.vz == 0 then
						found.length = math.max((found.length or 0) - found.speedf, 0)
						if found.length <= 0.01 then
							world.projectiles[id] = nil
						end
					else
						found.length = math.min((found.length or 0) + found.speedf, (found.def.duration or 0.1) * found.speedf * 30)
					end
				elseif kind == "MissileLauncher" then
					if found.ttl <= 0 and found.def.selfExplode then
						explode(found, found.x, found.y, found.z, "ttl")
					end
				end
			end
		end
	end

	--- How many projectiles the engine has.
	function world.projectileCount()
		local n = 0
		for _ in next, world.projectiles do
			n = n + 1
		end
		return n
	end

	--- The one projectile of a weapon definition name, or nil when there is none.
	function world.projectileNamed(name)
		for _, found in next, world.projectiles do
			if found.def.name == name then
				return found
			end
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
		WeaponDefNames = weaponDefNames,
		CMD = { ONOFF = 85 },
		Game = {
			gameSpeed = 30,
			squareSize = SQUARE,
			-- Names and numbers both ways, numbered from 0 (LuaConstGame.cpp).
			armorTypes = { [0] = "default", [1] = "tanks", [2] = "ships", default = 0, tanks = 1, ships = 2 },
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
