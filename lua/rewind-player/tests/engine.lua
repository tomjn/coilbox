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
-- in elmos, which it divides by 8 and cuts to a whole number. Its fourth
-- argument scales the change, so 0 touches a corner and leaves its height.
--
-- Spring.SpawnProjectile gives nothing for a weapon definition the engine does
-- not have and raises when its second argument is not a table. The calls that
-- set something on a projectile do nothing for an id that is not one. Setting
-- a place or a velocity does not need move control, which only stops the
-- engine moving the projectile itself. `world.simulate` is the engine's own
-- frame for them, from rts/Sim/Projectiles.
--
-- A team's resources follow rts/Sim/Misc/Team.cpp. What a team makes and uses
-- adds up over 30 frames, and on a frame that divides by 30 the sums become the
-- numbers Spring.GetTeamResources gives and start again from nothing. That
-- happens after the gadgets' GameFrame and before their GameFramePost, and
-- `world.step` runs a frame in that order. No call sets income, expense or pull.
--
-- Script.UpdateCallIn follows CLuaHandle::UpdateCallIn in rts/Lua/LuaHandle.cpp:
-- the engine calls a call-in when the handler's global table has a function of
-- that name at the time of the call, and stops calling it when it has none. A
-- gadget sees that table as `_G` (a handler's NewGadget). `world.gameFrame` is a
-- frame for a gadget in a game whose handler does or does not pass GameFramePost
-- on, on an engine that does or does not have it (issue #4002).
--
-- A unit's script (issue #3797) follows rts/Sim/Units/Scripts and
-- rts/Lua/LuaSyncedCtrl.cpp. A definition's `script` is "cob", "lua" or nothing,
-- and its `callins` are what the script does when one of its functions is run,
-- each given the world, the unit and the arguments. Spring.GetCOBScriptID gives
-- the number of a function of a unit with a COB script, and nothing for a
-- function it lacks and for a unit with any other script. Spring.CallCOBScript
-- raises for a unit that has no COB script and takes whole numbers only. A Lua
-- script is the game's own doing: its script framework runs when a unit is
-- created and hands the call-ins to the engine with
-- Spring.UnitScript.CreateScript, which it looks up in the table every gadget
-- shares at that moment (cont/base/springcontent/LuaGadgets/Gadgets/unit_script.lua).
-- `world.frameworkCopied` is a framework that copied the call into a local as
-- its file loaded. The engine itself never tells the script of a unit under
-- move control that it moves (CScriptMoveType calls no script function).
--
-- Spring.MoveCtrl.SetVelocity sets the velocity the engine moves a unit by on
-- every frame while it extrapolates, which it does until
-- Spring.MoveCtrl.SetExtrapolate says otherwise (CScriptMoveType::Update).
-- `world.moveUnits` is that update, and `world.step` runs it between the
-- gadget's two call-ins.
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
		local copy = {
			id = id,
			name = def.name,
			health = def.health or 1000,
			buildTime = def.buildTime or 100,
			onoffable = def.onoffable or false,
			pieces = def.pieces or { "base" },
			script = def.script,
			callins = def.callins or {},
			isFactory = def.isFactory or false,
			isBuilder = def.isBuilder or false,
			isImmobile = def.isImmobile or false,
			-- How far above its place the middle of the unit is.
			midHeight = def.midHeight or 0,
		}
		-- The numbers of a COB script's functions, in the order of their names.
		copy.cobNames = {}
		for name in pairs(copy.callins) do
			copy.cobNames[#copy.cobNames + 1] = name
		end
		table.sort(copy.cobNames)
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
	--- The map's own height at a corner, before anything changed it, in corners.
	-- A test replaces it. The engine always gives a number, and this gives nil
	-- so that a test that does not care sees the track's own heights.
	function world.origin()
		return nil
	end
	local ZERO = { 0, 0, 0 }

	local teamList = options.teams or { { id = 0, allyTeam = 0 }, { id = 1, allyTeam = 1 }, { id = 2, allyTeam = 2 } }
	-- One resource of a team, as CTeam holds it: what it has, the numbers of the
	-- stretch of 30 frames that is running, and those of the one before, which
	-- are the ones Spring.GetTeamResources gives.
	local function pool(storage, share)
		return {
			held = 0,
			storage = storage,
			share = share,
			pull = 0,
			income = 0,
			expense = 0,
			sent = 0,
			received = 0,
			delayed = 0,
			prevPull = 0,
			prevIncome = 0,
			prevExpense = 0,
			prevSent = 0,
			prevReceived = 0,
			prevExcess = 0,
		}
	end
	world.teamOrder = {}
	for i, team in ipairs(teamList) do
		world.teams[team.id] = {
			id = team.id,
			allyTeam = team.allyTeam,
			dead = false,
			limit = team.limit or 1000,
			count = 0,
			multiplier = team.incomeMultiplier or 1,
			-- CTeam's constructor: a share level of 0.99 for metal and 0.95 for energy.
			metal = pool(team.storage or 1000, 0.99),
			energy = pool(team.storage or 1000, 0.95),
			params = {},
		}
		world.teamOrder[i] = world.teams[team.id]
		world.gaia = team.id
	end
	-- The simulation frame, which a test moves with `world.step`.
	world.frame = 0
	-- modInfo.nativeExcessSharing, which is on unless a game switches it off.
	world.nativeExcessSharing = true
	-- How often the calls that set a team's numbers were made.
	world.resourceSets, world.shareSets, world.resourceFeeds, world.excessAdds, world.teamParamSets = 0, 0, 0, 0, 0

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

	-- `world.lines` has the lines logged either way: on the engine's log, which
	-- the console shows, and in the playback's log file, which the unsynced half
	-- writes what the synced half sends it to. `world.echoed` counts the first.
	world.echoed = 0
	function Spring.Echo(line)
		world.echoed = world.echoed + 1
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
		return teamID, 0, team.dead, false, "", team.allyTeam, team.multiplier
	end

	-- Team resources, from rts/Sim/Misc/Team.cpp and TeamHandler.cpp.

	function Spring.GetGameFrame()
		return world.frame
	end

	--- The pool a resource name means. The calls below read its first letter
	-- only, as the engine's do.
	local function poolOf(teamID, name)
		local team = world.teams[teamID]
		if not team then
			return nil
		end
		local letter = name:byte(1)
		if letter == 109 then
			return team.metal, team
		elseif letter == 101 then
			return team.energy, team
		end
	end

	--- CTeam::AddMetal. What does not fit in storage waits for the next slow
	-- update (CTeamHandler::HandleFrameExcess, with no gadget taking the excess).
	local function add(found, amount)
		found.held = found.held + amount
		found.income = found.income + amount
		if found.held > found.storage then
			found.delayed = found.delayed + (found.held - found.storage)
			found.held = found.storage
		end
	end

	--- LuaSyncedCtrl::UseTeamResource: the pull counts whether or not the team
	-- has the amount.
	local function use(found, amount)
		found.pull = found.pull + amount
		if found.held < amount then
			return false
		end
		found.held = found.held - amount
		found.expense = found.expense + amount
		return true
	end

	function Spring.GetTeamResources(teamID, name)
		local found = poolOf(teamID, name)
		if not found then
			return
		end
		return found.held, found.storage, found.prevPull, found.prevIncome, found.prevExpense, found.share, found.prevSent, found.prevReceived, found.prevExcess
	end

	--- LuaSyncedCtrl::SetTeamResource, which takes these eight names and no
	-- others. What a team holds is cut to its storage, both ways round.
	function Spring.SetTeamResource(teamID, name, value)
		local team = world.teams[teamID]
		if not team then
			return
		end
		world.resourceSets = world.resourceSets + 1
		value = math.max(0, value)
		if name == "m" or name == "metal" then
			team.metal.held = math.min(team.metal.storage, value)
		elseif name == "e" or name == "energy" then
			team.energy.held = math.min(team.energy.storage, value)
		elseif name == "ms" or name == "metalStorage" then
			team.metal.storage = value
			team.metal.held = math.min(team.metal.held, value)
		elseif name == "es" or name == "energyStorage" then
			team.energy.storage = value
			team.energy.held = math.min(team.energy.held, value)
		end
	end

	function Spring.SetTeamShareLevel(teamID, name, level)
		local found = poolOf(teamID, name)
		if found then
			world.shareSets = world.shareSets + 1
			found.share = math.max(0, math.min(1, level))
		end
	end

	function Spring.AddTeamResource(teamID, name, amount)
		local found, team = poolOf(teamID, name)
		if found then
			world.resourceFeeds = world.resourceFeeds + 1
			add(found, math.max(0, amount) * team.multiplier)
		end
	end

	function Spring.UseTeamResource(teamID, name, amount)
		assert(type(name) == "string", "the table form of UseTeamResource is not the stand-in's")
		local found = poolOf(teamID, name)
		if found then
			world.resourceFeeds = world.resourceFeeds + 1
			return use(found, math.max(0, amount))
		end
	end

	--- Registered from 2026.07.01 only. It adds to the excess of the stretch
	-- before, which is the number Spring.GetTeamResources gives.
	function Spring.AddTeamResourceExcessStats(teamID, name, amount)
		local found = poolOf(teamID, name)
		if found then
			world.excessAdds = world.excessAdds + 1
			found.prevExcess = found.prevExcess + math.max(0, amount)
		end
	end

	function Spring.SetTeamRulesParam(teamID, name, value)
		local team = world.teams[teamID]
		if team then
			world.teamParamSets = world.teamParamSets + 1
			team.params[name] = value
		end
	end

	function Spring.GetTeamRulesParam(teamID, name)
		local team = world.teams[teamID]
		return team and team.params[name]
	end

	--- What the engine's own units and a game's gadgets make and use in the
	-- middle of a frame: `world.produce(team, "metal", 2)` and `world.consume`.
	function world.produce(teamID, name, amount)
		local found, team = poolOf(teamID, name)
		add(found, amount * team.multiplier)
	end

	function world.consume(teamID, name, amount)
		return use(poolOf(teamID, name), amount)
	end

	--- CTeam::SlowUpdate for one resource of one team.
	local function slowUpdate(team, key)
		local found = team[key]
		-- What the allied teams can take.
		local room = 0
		for _, other in ipairs(world.teamOrder) do
			if other ~= team and other.allyTeam == team.allyTeam and not other.dead then
				room = room + math.max(0, other[key].storage * 0.99 - other[key].held)
			end
		end
		found.held = found.held + found.delayed
		found.delayed = 0
		local excess = math.max(0, found.held - found.storage * found.share)
		local part = room > 0 and math.min(1, excess / room) or 0
		if world.nativeExcessSharing then
			for _, other in ipairs(world.teamOrder) do
				if other ~= team and other.allyTeam == team.allyTeam and not other.dead then
					local theirs = other[key]
					local given = math.max(0, math.min(found.held, (theirs.storage * 0.99 - theirs.held) * part))
					found.held, theirs.held = found.held - given, theirs.held + given
					found.sent, theirs.received = found.sent + given, theirs.received + given
				end
			end
		end
		if found.held > found.storage then
			found.prevExcess = found.held - found.storage
			found.held = found.storage
		else
			found.prevExcess = 0
		end
	end

	--- CTeamHandler::GameFrame, which the engine runs after the gadgets'
	-- GameFrame and its own units, and before the gadgets' GameFramePost. On a
	-- frame that divides by 30 every team's running numbers become the ones it
	-- reports, and then every team has its slow update.
	function world.teamUpdate()
		if world.frame % 30 ~= 0 then
			return
		end
		for _, team in ipairs(world.teamOrder) do
			local found = team.metal
			for _ = 1, 2 do
				found.prevPull, found.pull = found.pull, 0
				found.prevIncome, found.income = found.income, 0
				found.prevExpense, found.expense = found.expense, 0
				found.prevSent, found.sent = found.sent, 0
				found.prevReceived, found.received = found.received, 0
				found = team.energy
			end
		end
		for _, team in ipairs(world.teamOrder) do
			slowUpdate(team, "metal")
			slowUpdate(team, "energy")
		end
	end

	--- One simulation frame in the engine's order (CGame::SimFrame): the
	-- gadgets' GameFrame, the engine's own move of each unit under move control
	-- (`world.moveUnits`), the engine's own economy, which a test gives as
	-- `world.economy`, the teams, and the gadgets' GameFramePost. `frame` and
	-- `post` are what stands in for the gadget's two call-ins, and an engine
	-- with no GameFramePost is a step with no `post`.
	function world.step(frame, post)
		world.frame = world.frame + 1
		frame(world.frame)
		-- The engine's own update of the units comes after the gadgets' GameFrame.
		world.moveUnits()
		if world.economy then
			world.economy(world.frame)
		end
		world.teamUpdate()
		if post then
			post(world.frame)
		end
	end

	-- The gadget handler's global table, and the call-ins the engine was told it
	-- has a function for.
	world.handlerGlobals = {}
	world.callIns = {}
	world.callInUpdates = 0
	local Script = {}

	function Script.UpdateCallIn(name)
		world.callInUpdates = world.callInUpdates + 1
		world.callIns[name] = type(world.handlerGlobals[name]) == "function"
	end

	--- One frame for `gadget` in a game. `how.engine == false` is an engine that
	-- makes no GameFramePost call. `how.handler == false` is a gadget handler that
	-- does not pass the call on, so the gadget only hears it through a global the
	-- engine was told of.
	function world.gameFrame(gadget, how)
		world.step(function(n)
			gadget:GameFrame(n)
		end, function(n)
			if how and how.engine == false then
				return
			end
			if not (how and how.handler == false) then
				gadget:GameFramePost(n)
			elseif world.callIns.GameFramePost and world.handlerGlobals.GameFramePost then
				world.handlerGlobals.GameFramePost(n)
			end
		end)
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
			-- Each script piece's turn and offset, as its script left them.
			rot = {},
			pos = {},
			-- The turns and moves its script has running, by piece and axis.
			anim = {},
			vx = 0,
			vy = 0,
			vz = 0,
			extrapolate = true,
			params = {},
		}
		for number = 1, #found.pieces do
			world.units[id].rot[number] = { 0, 0, 0 }
			world.units[id].pos[number] = { 0, 0, 0 }
		end
		event("create", id)
		call("UnitCreated", id, found.id, teamID)
		world.framework(world.units[id])
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

	-- Unit scripts, from rts/Sim/Units/Scripts/LuaUnitScript.cpp and
	-- UnitScript.cpp. A definition's `pieces` are its script's piece names in
	-- order. Spring.GetUnitScriptNames numbers them from 0 and every call below
	-- from 1. `world.poseSets` counts the turns and moves that reached a piece.

	world.poseSets = 0
	world.scriptNameLooks = 0
	world.scriptErrors = 0
	local TURN = 2 * math.pi
	-- The unit a script call acts on (CLuaUnitScript's activeUnit).
	local active

	function Spring.GetUnitScriptNames(id)
		local found = unit(id)
		if not found then
			return
		end
		world.scriptNameLooks = world.scriptNameLooks + 1
		local names = {}
		for number, name in ipairs(found.def.pieces) do
			names[name] = number - 1
		end
		return names
	end

	Spring.UnitScript = {}

	--- CallAsUnit raises for an id the engine has no unit for, and calls `fn`
	-- with that unit as the one every script call acts on.
	function Spring.UnitScript.CallAsUnit(id, fn, ...)
		local found = world.units[id]
		if not found or found.dead then
			error("CallAsUnit(): Bad unitID: " .. tostring(id), 2)
		end
		assert(type(fn) == "function", "Incorrect arguments to CallAsUnit()")
		local before = active
		active = found
		local ok, a, b, c = pcall(fn, ...)
		active = before
		if not ok then
			error(a, 0)
		end
		return a, b, c
	end

	local function axisOf(axis, caller)
		if type(axis) ~= "number" or axis < 1 or axis > 3 then
			error(caller .. "(): Bad axis", 3)
		end
		return axis
	end

	--- Turn and Move with no speed set the piece at once (CUnitScript::TurnNow
	-- and MoveNow). A piece the script does not have is logged by the engine and
	-- nothing is raised. An angle is kept between 0 and one turn (ClampRad). The
	-- player poses at once, so a speed is refused here.
	function Spring.UnitScript.Turn(piece, axis, angle, speed)
		if not active then
			return
		end
		axis = axisOf(axis, "Turn")
		assert(speed == nil or speed == 0, "the player turned a piece at a speed")
		local rot = active.rot[piece]
		if not rot then
			world.scriptErrors = world.scriptErrors + 1
			return
		end
		world.poseSets = world.poseSets + 1
		rot[axis] = angle % TURN
	end

	function Spring.UnitScript.Move(piece, axis, distance, speed)
		if not active then
			return
		end
		axis = axisOf(axis, "Move")
		assert(speed == nil or speed == 0, "the player moved a piece at a speed")
		local pos = active.pos[piece]
		if not pos then
			world.scriptErrors = world.scriptErrors + 1
			return
		end
		world.poseSets = world.poseSets + 1
		pos[axis] = distance
	end

	--- These two raise for a piece the script does not have.
	function Spring.UnitScript.GetPieceRotation(piece)
		if not active then
			return
		end
		local rot = active.rot[piece]
		if not rot then
			error("GetPieceRotation(): Invalid piecenumber", 2)
		end
		return rot[1], rot[2], rot[3]
	end

	function Spring.UnitScript.GetPieceTranslation(piece)
		if not active then
			return
		end
		local pos = active.pos[piece]
		if not pos then
			error("GetPieceTranslation(): Invalid piecenumber", 2)
		end
		return pos[1], pos[2], pos[3]
	end

	--- A unit's own script moving a piece, which the engine runs between the
	-- gadgets' GameFrame and their GameFramePost. `piece` is a name.
	function world.scriptTurn(found, piece, x, y, z)
		for number, name in ipairs(found.def.pieces) do
			if name == piece then
				local rot = found.rot[number]
				rot[1], rot[2], rot[3] = x % TURN, y % TURN, z % TURN
			end
		end
	end

	--- The rotation and the offset of a unit's piece, by name.
	function world.pieceOf(found, piece)
		for number, name in ipairs(found.def.pieces) do
			if name == piece then
				local rot, pos = found.rot[number], found.pos[number]
				return rot[1], rot[2], rot[3], pos[1], pos[2], pos[3]
			end
		end
	end

	-- A unit's script being told something (issue #3797).

	world.scriptCalls = {}
	world.unitParamSets = 0
	world.velocitySets = 0
	world.frameworkCopied = false

	--- A script function of a unit ran: which, with what, and on which frame.
	local function told(found, name, how, a, b)
		world.scriptCalls[#world.scriptCalls + 1] = { unit = found.id, def = found.def.name, name = name, how = how, a = a, b = b, frame = world.frame }
		local does = found.def.callins[name]
		if does then
			return does(world, found, a, b)
		end
	end

	--- The script calls a test asks about: of a unit, by name.
	function world.callsTo(found, name)
		local list = {}
		for _, one in ipairs(world.scriptCalls) do
			if one.unit == found.id and (not name or one.name == name) then
				list[#list + 1] = one
			end
		end
		return list
	end

	--- A unit's script starts a turn or a move of a piece at a speed, which runs
	-- until the piece is there (CUnitScript::AddAnim). `kind` is "turn" or "move".
	function world.animate(found, piece, axis, kind)
		for number, name in ipairs(found.def.pieces) do
			if name == piece then
				found.anim[(kind or "turn") .. " " .. number .. " " .. axis] = true
			end
		end
	end

	function Spring.GetCOBScriptID(id, name)
		assert(type(id) == "number" and type(name) == "string", "[GetCOBScriptID] incorrect arguments")
		local found = unit(id)
		if not found or found.def.script ~= "cob" then
			return
		end
		for number, known in ipairs(found.def.cobNames) do
			if known == name then
				return number - 1
			end
		end
	end

	function Spring.CallCOBScript(id, func, returned, ...)
		local count = select("#", ...)
		assert(type(id) == "number", "[CallCOBScript] unitID not a number")
		assert(type(returned) == "number", "[CallCOBScript] retval-count not a number")
		local found = unit(id)
		if not found then
			return
		end
		if found.def.script ~= "cob" then
			error("[CallCOBScript] unit is not running a COB script", 2)
		end
		local a, b = ...
		for n = 1, count do
			local value = select(n, ...)
			assert(type(value) == "number" and value == math.floor(value), "a COB script was given something that is not a whole number")
		end
		local name = func
		if type(func) == "number" then
			name = found.def.cobNames[func + 1]
			assert(name, "[CallCOBScript] bad function id")
		end
		-- A function hands back what it put in its first argument, which is what
		-- the engine gives after the code when one value is asked for.
		local given = told(found, name, "cob", a, b)
		if returned >= 1 and count >= 1 then
			if given == nil then
				given = a
			end
			return 0, given
		end
		return 0
	end

	-- A builder's nano pieces (NanoPieceCache in rts/Sim/Misc, read and set in
	-- rts/Lua/LuaSyncedRead.cpp and LuaSyncedCtrl.cpp). Only a builder or a
	-- factory has them. Spring.SetUnitNanoPieces takes the model's piece numbers,
	-- counted from 1, and raises for a piece the model does not have.
	-- Spring.GetUnitNanoPieces gives a new list, and nothing while there are
	-- none. `world.nanoSets` counts the sets.
	world.nanoSets = 0
	function Spring.SetUnitNanoPieces(id, pieces)
		local found = unit(id)
		if not found or not (found.def.isBuilder or found.def.isFactory) then
			return
		end
		assert(type(pieces) == "table", "[SetUnitNanoPieces] a table of pieces")
		world.nanoSets = world.nanoSets + 1
		local list = {}
		for _, piece in ipairs(pieces) do
			if piece < 1 or piece > #found.def.pieces then
				error("[SetUnitNanoPieces] incorrect model-piece number " .. (piece - 1), 2)
			end
			list[#list + 1] = piece
		end
		found.nanoPieces = list
	end

	function Spring.GetUnitNanoPieces(id)
		local found = unit(id)
		if not found or not found.nanoPieces or #found.nanoPieces == 0 then
			return
		end
		local list = {}
		for k, piece in ipairs(found.nanoPieces) do
			list[k] = piece
		end
		return list
	end

	--- The model's piece of a script's piece, counted from 1, as
	-- LuaSyncedRead::GetUnitScriptPiece gives it. A script here numbers its
	-- pieces as the model does, from 0.
	function Spring.GetUnitScriptPiece(id, scriptPiece)
		local found = unit(id)
		if not found or type(scriptPiece) ~= "number" then
			return
		end
		if scriptPiece < 0 or scriptPiece >= #found.def.pieces then
			return
		end
		return scriptPiece + 1
	end

	--- The engine's own call, which keeps the functions of the table it is given.
	local function createScript(id, callins)
		local found = unit(id)
		if not found then
			error("CreateScript(): Bad unitID: " .. tostring(id), 2)
		end
		found.luaScript = {}
		for name, fn in pairs(callins) do
			found.luaScript[name] = fn
		end
	end
	Spring.UnitScript.CreateScript = createScript

	--- The game's script framework, for a unit that has just been created.
	function world.framework(found)
		if found.def.script ~= "lua" then
			return
		end
		local callins = {}
		for name in pairs(found.def.callins) do
			callins[name] = function(a, b)
				return told(found, name, "lua", a, b)
			end
		end
		local create = world.frameworkCopied and createScript or Spring.UnitScript.CreateScript
		if create then
			create(found.id, callins)
		end
	end

	function Spring.UnitScript.IsInTurn(piece, axis)
		if not active then
			return
		end
		return active.anim["turn " .. piece .. " " .. axisOf(axis, "IsInTurn")] == true
	end

	function Spring.UnitScript.IsInMove(piece, axis)
		if not active then
			return
		end
		return active.anim["move " .. piece .. " " .. axisOf(axis, "IsInMove")] == true
	end

	--- A unit's place and, when asked, its middle (LuaSyncedRead::GetUnitPosition).
	function Spring.GetUnitPosition(id, middle)
		local found = unit(id)
		if not found then
			return
		end
		if middle then
			return found.x, found.y, found.z, found.x, found.y + found.def.midHeight, found.z
		end
		return found.x, found.y, found.z
	end

	function Spring.SetUnitRulesParam(id, name, value)
		local found = unit(id)
		if found then
			world.unitParamSets = world.unitParamSets + 1
			found.params[name] = value
		end
	end

	Spring.MoveCtrl = {}

	function Spring.MoveCtrl.SetExtrapolate(id, extrapolate)
		local found = unit(id)
		if found and found.moveCtrl then
			assert(type(extrapolate) == "boolean", "SetExtrapolate takes a boolean")
			found.extrapolate = extrapolate
		end
	end

	function Spring.MoveCtrl.SetVelocity(id, x, y, z)
		local found = unit(id)
		if found and found.moveCtrl then
			world.velocitySets = world.velocitySets + 1
			found.vx, found.vy, found.vz = x, y, z
		end
	end

	--- CScriptMoveType::Update for every unit: one that extrapolates is moved by
	-- its velocity.
	function world.moveUnits()
		for _, found in next, world.units do
			if not found.dead and found.moveCtrl and found.extrapolate then
				found.x, found.y, found.z = found.x + found.vx, found.y + found.vy, found.z + found.vz
			end
		end
	end

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
			world.ttlSets = (world.ttlSets or 0) + 1
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

	function Spring.GetGroundOrigHeight(x, z)
		return world.origin(math.floor(x / SQUARE), math.floor(z / SQUARE))
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

	-- The rectangle of corners the calls inside one SetHeightMapFunc touched,
	-- which is what the engine works out again afterwards (CBasicMapDamage::
	-- RecalcArea in rts/Map/BasicMapDamage.cpp). It skips a rectangle of no
	-- area, so corners set along one line are never worked out again.
	-- `world.heightMapRects` has one `{ x1, x2, z1, z2, changed }` for each call
	-- that touched a corner, `changed` being how many corners it moved, while
	-- `world.recordRects` is true. Recording allocates, so it is off for a test
	-- that counts allocations.
	world.heightMapRects = {}
	local rect

	function Spring.SetHeightMapFunc(fn, ...)
		assert(not world.inHeightMap, "SetHeightMapFunc() recursion is not permitted")
		world.heightMapCalls = (world.heightMapCalls or 0) + 1
		world.inHeightMap = true
		rect = nil
		fn(...)
		world.inHeightMap = false
		if rect and world.recordRects then
			world.heightMapRects[#world.heightMapRects + 1] = rect
		end
	end

	--- `terraform` scales the change, as the engine's fourth argument does: the
	-- corner moves that share of the way to `height`.
	function Spring.SetHeightMap(x, z, height, terraform)
		if not world.inHeightMap then
			error("SetHeightMap() can only be called in SetHeightMapFunc()", 2)
		end
		local cx, cz = math.floor(x / SQUARE), math.floor(z / SQUARE)
		local key = cz * 65536 + cx
		local old = world.heights[key]
		if terraform then
			if old then
				height = old + (height - old) * terraform
			else
				height = nil
			end
		end
		world.heights[key] = height
		if not world.recordRects then
			return
		end
		if not rect then
			rect = { cx, cx, cz, cz, 0 }
		end
		rect[1], rect[2] = math.min(rect[1], cx), math.max(rect[2], cx)
		rect[3], rect[4] = math.min(rect[3], cz), math.max(rect[4], cz)
		if height ~= old then
			rect[5] = rect[5] + 1
		end
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
		CMD = { ONOFF = 85, REPAIR = 40, RECLAIM = 90, RESTORE = 110, RESURRECT = 125, CAPTURE = 130 },
		Script = Script,
		_G = world.handlerGlobals,
		Game = {
			gameSpeed = 30,
			squareSize = SQUARE,
			maxUnits = 32000,
			-- Names and numbers both ways, numbered from 0 (LuaConstGame.cpp).
			armorTypes = { [0] = "default", [1] = "tanks", [2] = "ships", default = 0, tanks = 1, ships = 2 },
			constructionDecay = options.constructionDecay == true,
			constructionDecaySpeed = 0.03,
		},
		-- What every synced gadget shares.
		GG = {},
		SendToUnsynced = function(name, phase, a, made, removed, team, ...)
			if name == "coilbox_rewind_log" then
				-- A line for the playback's log file, which the unsynced half writes.
				world.lines[#world.lines + 1] = phase
				return
			end
			if name == "coilbox_rewind_arrive" then
				-- A unit that wants an arrival effect: its id, where it is, its team.
				-- It is one of the world's events, as a creation is.
				world.events[#world.events + 1] = table.concat({ "arrive", phase, a, made, removed, team }, " ")
				return
			end
			world.sent = world.sent + 1
			world.sentName, world.sentPhase, world.sentMade, world.sentRemoved = name, phase, made, removed
			-- The end of a frame's work also says the budgets the frame worked to,
			-- and how many of its units were the first of their definition.
			if phase == 1 then
				local make, remove, earth, firsts, started = ...
				world.sentBudgets = { make, remove, earth }
				world.sentFirsts = firsts
				world.sentStarted = started
			end
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
