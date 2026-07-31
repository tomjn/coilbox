-- Coilbox mission runtime: the gadget that runs a scenario.
--
-- Vendored into a game by coilbox. Change it in the coilbox repository under
-- lua/mission-runtime/ and install again, or the next runtime update will
-- overwrite the edit.
--
-- The gadget exists for missions and nothing else. Without the coilbox_mission
-- modoption the chunk returns false, the gadget handler drops it, and a normal
-- game pays only the cost of reading this file.

local LOG_SECTION = "coilbox-mission"

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

-- The scenario id coilbox wrote into the start script, or nil for a normal
-- game. The id becomes part of a VFS path, so anything that is not a plain name
-- is refused rather than followed.
local function readMissionId()
	local raw = Spring.GetModOptions().coilbox_mission
	if type(raw) ~= "string" then
		return nil
	end

	local id = raw:match("^%s*(.-)%s*$")
	if id == "" then
		return nil
	end
	if not id:match("^[%w._%-]+$") or id:match("^%.+$") then
		log("error", "ignoring coilbox_mission: " .. id .. " is not a mission id")
		return nil
	end
	return id
end

local MISSION_ID = readMissionId()
if not MISSION_ID then
	return false
end

-- Read a Lua table out of an archive.
--
-- Data files under missions/ are given an empty environment: a mission that
-- reaches for a global fails here instead of reaching into the gadget. Runtime
-- modules are code and pass nil, which runs them in the gadget's environment.
local function includeTable(path, env)
	if not VFS.FileExists(path, VFS.ZIP) then
		return nil, path .. " is missing"
	end

	local ok, value = pcall(VFS.Include, path, env, VFS.ZIP)
	if not ok then
		return nil, path .. " failed to load: " .. tostring(value)
	end
	if type(value) ~= "table" then
		return nil, path .. " did not return a table"
	end
	return value
end

local RUNTIME, runtimeError = includeTable("missions/runtime.lua", {})
if not RUNTIME then
	log("error", runtimeError)
	return false
end

local MISSION, missionError = includeTable("missions/" .. MISSION_ID .. "/mission.lua", {})
if not MISSION then
	log("error", missionError)
	return false
end

local START, startError = includeTable("luarules/mission_runtime/coilbox_start.lua")
if not START then
	log("error", startError)
	return false
end

local TRIGGERS, triggersError = includeTable("luarules/mission_runtime/coilbox_triggers.lua")
if not TRIGGERS then
	log("error", triggersError)
	return false
end

local UNIT_CONDITIONS, unitConditionsError =
	includeTable("luarules/mission_runtime/coilbox_unit_conditions.lua")
if not UNIT_CONDITIONS then
	log("error", unitConditionsError)
	return false
end

local ZONES, zonesError = includeTable("luarules/mission_runtime/coilbox_zones.lua")
if not ZONES then
	log("error", zonesError)
	return false
end

local VARS, varsError = includeTable("luarules/mission_runtime/coilbox_vars.lua")
if not VARS then
	log("error", varsError)
	return false
end

local GROUPS, groupsError = includeTable("luarules/mission_runtime/coilbox_groups.lua")
if not GROUPS then
	log("error", groupsError)
	return false
end

-- Refuse a mission built for a newer runtime than the game vendored. Running it
-- anyway would quietly drop whatever this version cannot read, and a mission
-- that half works is harder to diagnose than one that refuses to start.
local function needsNewerRuntime(field, have)
	local needs = tonumber(MISSION[field]) or 0
	if needs <= (tonumber(have) or 0) then
		return false
	end
	log("error", string.format(
		"mission %s needs %s %d, this runtime is at %s: update the runtime in this game",
		MISSION_ID, field, needs, tostring(have)))
	return true
end

if needsNewerRuntime("runtimeVersion", RUNTIME.version)
	or needsNewerRuntime("schemaVersion", RUNTIME.schemaVersion) then
	return false
end

-- Not fatal. The mission will spawn its units at coordinates that mean nothing
-- on this map, but saying so beats a silent sea of drowned commanders.
if MISSION.map and MISSION.map ~= Game.mapName then
	log("warning", string.format(
		"mission %s was built for map %s and is running on %s",
		MISSION_ID, MISSION.map, tostring(Game.mapName)))
end

function gadget:GetInfo()
	return {
		name = "Coilbox mission runtime",
		desc = "Runs a coilbox scenario as a mission",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the game's own gadgets. The runtime overrides the start the
		-- game would otherwise give the player, so it needs the last word:
		-- gadgetHandler runs low layers first, and whoever runs last is the one
		-- whose starting resources and damage modifiers stick.
		layer = 1000,
		enabled = true,
	}
end

-- Names the message the synced half sends its unsynced half when an actor has
-- become a unit.
local ACTOR_MESSAGE = "coilbox_mission_actor"

-- The rest of the runtime reads the mission through GG, in both halves. Both
-- compute the team plan, because it is derived from the mission and deriving it
-- twice is cheaper than a channel between the halves.
--
-- `mission` is the compiled scenario exactly as coilbox emitted it, so a mission
-- that misbehaves can be diagnosed by reading missions/<id>/mission.lua.
local function publish()
	local teams, problems = START.teamPlan(MISSION)

	local actors = {}
	for _, actor in ipairs(MISSION.actors or {}) do
		actors[actor.id] = actor
	end

	GG.CoilboxMission = {
		id = MISSION_ID,
		mission = MISSION,
		runtime = RUNTIME,
		-- Per-participant setup with the engine team number resolved.
		teams = teams,
		-- Actor records by id, and the unit each one currently is. An actor
		-- with no entry in `units` is one that has died or never spawned.
		actors = actors,
		units = {},
		-- The synced half adds `triggers`, the trigger engine, `vars`, the
		-- mission's variables, and `groups`, the scenario's groups. Registering
		-- a condition or action type on the engine is how the rest of the
		-- runtime, and a game's own extensions, join in; going through `vars`
		-- and `groups` is how they read and drive those.
	}
	return GG.CoilboxMission, problems
end

if gadgetHandler:IsSyncedCode() then
	-- The frame the runtime takes the last word on the start. GamePreload,
	-- GameStart and frame 0 have all run by now, so a game's own start pass has
	-- happened and cannot clobber what the scenario asked for.
	local START_FRAME = 1

	local teams = {}
	local units = {}
	-- Engine teams whose scenario entry says the game must not spawn for them.
	local suppressedTeams = {}
	local suppressing = false
	-- True only inside the runtime's own Spring.CreateUnit, so the suppression
	-- does not eat what the runtime just placed.
	local spawning = false
	local invulnerable = {}
	local actorOfUnit = {}
	-- The trigger engine, and the hooks its unit conditions want fed. Both are
	-- synced only: triggers decide what happens in the game, so they run where
	-- every machine runs them.
	local triggers
	local unitHooks
	-- The scenario's groups, once registered.
	local groups

	--- Tell the triggers something happened.
	--
	-- Nothing is raised while the start window is open. The mission's own spawns
	-- and the game's suppressed ones all land in there, and a mission counting
	-- what a team has built should not be counting the units it was handed.
	local function raise(name, payload)
		if suppressing or not triggers then
			return
		end
		triggers:event(name, payload)
	end

	--- Where a placement actually lands.
	--
	-- A scenario carries no height, because everything in one sits on terrain, so
	-- the ground is read here. A building is put through the engine's build grid
	-- as well: Spring.CreateUnit does not snap, and a base a few elmos off the
	-- grid cannot be rebuilt where it stood and sits at the wrong height on a
	-- slope. Pos2BuildPos answers with the height a builder would have used, so
	-- the ground read is its job for those.
	local function groundAt(placement)
		local def = UnitDefNames[placement.unitDef]
		if def and def.isBuilding then
			return Spring.Pos2BuildPos(def.id, placement.x, 0, placement.z, placement.facing)
		end
		return placement.x, Spring.GetGroundHeight(placement.x, placement.z), placement.z
	end

	--- Put one planned unit on the map.
	--
	-- Spring.CreateUnit raises on a unit def the game does not have. A scenario
	-- built against a different version of the game is the likely cause, and one
	-- missing unit should not take the whole mission down with it.
	local function create(placement)
		local x, y, z = groundAt(placement)
		spawning = true
		local ok, unitID = pcall(Spring.CreateUnit,
			placement.unitDef, x, y, z, placement.facing, placement.team)
		spawning = false

		if not ok then
			log("error", string.format(
				"could not spawn %s: %s", tostring(placement.unitDef), tostring(unitID)))
			return nil
		end
		return unitID
	end

	--- The author's overrides on a placed unit.
	--
	-- Health is a fraction of the unit's own maximum, so a scenario can say "half
	-- dead" without knowing the def's hit points. Invulnerability is held here
	-- and applied in UnitPreDamaged rather than through the unit's armoured
	-- state, which its own script owns and would flip back.
	local function applyState(unitID, state)
		if state.hp then
			local _, maxHealth = Spring.GetUnitHealth(unitID)
			if maxHealth then
				Spring.SetUnitHealth(unitID, maxHealth * state.hp)
			end
		end
		if state.invulnerable then
			invulnerable[unitID] = true
		end
	end

	--- Fill a prefab factory's build queue.
	--
	-- A build order is the negative of the unit def id, and the engine reads the
	-- shift and control keys on one as "five of these" and "twenty of these", so
	-- each is given with no options at all and appends exactly one unit. Build
	-- orders always append, so nothing here clears the queue either.
	--
	-- `repeat` goes last, and needs its 0-or-1 parameter: the engine refuses the
	-- command without one, and refuses it outright for a factory whose def cannot
	-- repeat, which is the game's decision rather than the mission's.
	local function applyQueue(unitID, queue, repeatQueue)
		for _, name in ipairs(queue) do
			local def = UnitDefNames[name]
			if def then
				Spring.GiveOrderToUnit(unitID, -def.id, {}, 0)
			else
				log("warning", string.format(
					"a prefab factory's queue names %s, which this game has no unit def for",
					tostring(name)))
			end
		end
		if repeatQueue then
			Spring.GiveOrderToUnit(unitID, CMD.REPEAT, { 1 }, 0)
		end
	end

	local function spawn()
		local startPositions = {}
		for _, team in ipairs(teams) do
			local x, _, z, valid = Spring.GetTeamStartPosition(team.team)
			if valid then
				startPositions[team.team] = { x = x, z = z }
			end
		end

		local placements, problems = START.placements(MISSION, teams, startPositions)
		local prefabs, prefabProblems = START.prefabPlacements(MISSION, teams)
		for _, placement in ipairs(prefabs) do
			placements[#placements + 1] = placement
		end
		for _, problem in ipairs(prefabProblems) do
			problems[#problems + 1] = problem
		end
		for _, problem in ipairs(problems) do
			log("warning", problem)
		end

		local spawned = 0
		for _, placement in ipairs(placements) do
			local unitID = create(placement)
			if unitID then
				spawned = spawned + 1
				if placement.state then
					applyState(unitID, placement.state)
				end
				if placement.queue then
					applyQueue(unitID, placement.queue, placement.repeatQueue)
				end
				if placement.actor then
					units[placement.actor] = unitID
					actorOfUnit[unitID] = placement.actor
					-- The unsynced half handles what is local to this player's
					-- screen. It cannot read a synced table, so it is told which
					-- unit each actor became.
					SendToUnsynced(ACTOR_MESSAGE, placement.actor, unitID)
				end
			end
		end

		-- After the actors, so a standing group ordered to guard one of them has
		-- something to guard.
		local grouped = groups.start()

		log("notice", string.format(
			"mission %s spawned %d of %d units and %d in groups",
			MISSION_ID, spawned, #placements, grouped))
	end

	--- Set every mission team's bank to what the scenario asked for. Teams the
	-- scenario says nothing about land on nothing, which is how the normal
	-- starting resources are suppressed.
	local function applyResources()
		for _, team in ipairs(teams) do
			Spring.SetTeamResource(team.team, "m", team.metal)
			Spring.SetTeamResource(team.team, "e", team.energy)
		end
	end

	--- Free income, spread over the second it is quoted per.
	local function addIncome()
		for _, team in ipairs(teams) do
			if team.metalIncome ~= 0 then
				Spring.AddTeamResource(team.team, "m", team.metalIncome / Game.gameSpeed)
			end
			if team.energyIncome ~= 0 then
				Spring.AddTeamResource(team.team, "e", team.energyIncome / Game.gameSpeed)
			end
		end
	end

	function gadget:Initialize()
		local published, problems = publish()
		teams = published.teams
		units = published.units

		for _, problem in ipairs(problems) do
			log("warning", problem)
		end
		for _, team in ipairs(teams) do
			if team.noCommander then
				suppressedTeams[team.team] = true
			end
		end

		-- Open from here rather than from GameStart, so a game that spawns in
		-- GamePreload is covered too.
		suppressing = true

		-- The trigger engine knows nothing about any condition or action until
		-- one is registered on it. Every module that implements some registers
		-- here, before the first frame, so the engine's index of which trigger
		-- watches which event is built once and stays right.
		triggers = TRIGGERS.new(MISSION, {
			state = published,
			gameSpeed = Game.gameSpeed,
			log = log,
		})
		unitHooks = UNIT_CONDITIONS.register(triggers, published)
		ZONES.register(triggers, published)
		-- Before the first frame, so a var is at the number its author gave it
		-- from the first trigger that reads it.
		published.vars = VARS.register(triggers, published)
		-- Creating a unit has to happen inside the start suppression and at the
		-- ground height, both of which are this file's, so the groups get the one
		-- hook and keep the lifecycle.
		groups = GROUPS.register(triggers, published, {
			spawn = function(group, team)
				local created = {}
				for _, placement in ipairs(START.groupPlacements(group, team)) do
					local unitID = create(placement)
					if unitID then
						created[#created + 1] = unitID
					end
				end
				return created
			end,
		})
		published.groups = groups
		published.triggers = triggers

		log("notice", string.format(
			"mission %s loaded, runtime version %s", MISSION_ID, tostring(RUNTIME.version)))
	end

	function gadget:GameStart()
		spawn()
	end

	function gadget:GameFrame(frame)
		if frame < START_FRAME then
			return
		end
		if frame == START_FRAME then
			applyResources()
			suppressing = false
		end
		addIncome()
		-- Last, so the world a trigger reads on this frame is the finished one.
		-- The engine owns how often it actually evaluates.
		triggers:frame(frame)
	end

	--- Undo the start the game would have given a team the scenario spawns for
	-- itself.
	--
	-- Undone rather than prevented, because the engine offers no veto:
	-- AllowUnitCreation is consulted for builders and factories only, never for
	-- Spring.CreateUnit, which is what a game's start gadget uses. Killing a unit
	-- inside UnitCreated is a case the engine handles.
	--
	-- Narrow on purpose. Only a team the scenario marked noCommander, only while
	-- the start window is open, only a unit with no builder, so nothing anyone
	-- has begun building is ever touched.
	function gadget:UnitCreated(unitID, unitDefID, unitTeam, builderID)
		if suppressing then
			if not spawning and not builderID and suppressedTeams[unitTeam] then
				Spring.DestroyUnit(unitID, false, true)
			end
			return
		end
		raise("unit_created", { unitID = unitID, unitDefID = unitDefID, team = unitTeam })
	end

	--- A unit finished building. The mission's own spawns finish inside
	-- Spring.CreateUnit, while the start window is open, which is what keeps a
	-- team's placed units out of what that team has built.
	function gadget:UnitFinished(unitID, unitDefID, unitTeam)
		if suppressing then
			return
		end
		unitHooks.finished(unitDefID, unitTeam)
		raise("unit_finished", { unitID = unitID, unitDefID = unitDefID, team = unitTeam })
	end

	--- A unit changed hands. UnitGiven rather than UnitTaken, because only by
	-- then is the unit on the team that took it.
	function gadget:UnitGiven(unitID, unitDefID, newTeam, oldTeam)
		local actor = actorOfUnit[unitID]
		if actor then
			unitHooks.captured(actor, newTeam)
		end
		raise("unit_captured", {
			unitID = unitID,
			unitDefID = unitDefID,
			actor = actor,
			team = newTeam,
			oldTeam = oldTeam,
		})
	end

	function gadget:UnitPreDamaged(unitID)
		if invulnerable[unitID] then
			return 0, 0
		end
	end

	function gadget:UnitDestroyed(unitID, unitDefID, unitTeam)
		invulnerable[unitID] = nil
		groups.removed(unitID)
		local actor = actorOfUnit[unitID]
		if actor then
			actorOfUnit[unitID] = nil
			units[actor] = nil
		end
		-- After the bookkeeping, so a trigger asking whether an actor is dead
		-- reads the answer this death just wrote.
		raise("unit_destroyed", {
			unitID = unitID,
			unitDefID = unitDefID,
			actor = actor,
			team = unitTeam,
		})
	end
else
	local published

	function gadget:Initialize()
		published = publish()
	end

	--- Told which unit an actor became. Anything about an actor that is local to
	-- this player's screen is applied here, because the engine has no synced call
	-- for it.
	--
	-- Returns nothing: a true return would stop the message reaching the gadgets
	-- behind this one, and their messages are not ours to swallow.
	function gadget:RecvFromSynced(message, actorId, unitID)
		if message ~= ACTOR_MESSAGE then
			return
		end

		published.units[actorId] = unitID

		local actor = published.actors[actorId]
		if actor and actor.state and actor.state.unselectable then
			Spring.SetUnitNoSelect(unitID, true)
		end
	end
end
