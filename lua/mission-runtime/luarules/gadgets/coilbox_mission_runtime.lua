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

local OBJECTIVES, objectivesError = includeTable("luarules/mission_runtime/coilbox_objectives.lua")
if not OBJECTIVES then
	log("error", objectivesError)
	return false
end

local GAMEOVER, gameOverError = includeTable("luarules/mission_runtime/coilbox_gameover.lua")
if not GAMEOVER then
	log("error", gameOverError)
	return false
end

local DIALOGUE, dialogueError = includeTable("luarules/mission_runtime/coilbox_dialogue.lua")
if not DIALOGUE then
	log("error", dialogueError)
	return false
end

local VIEW, viewError = includeTable("luarules/mission_runtime/coilbox_view.lua")
if not VIEW then
	log("error", viewError)
	return false
end

local REVEAL, revealError = includeTable("luarules/mission_runtime/coilbox_reveal.lua")
if not REVEAL then
	log("error", revealError)
	return false
end

local RESTRICTIONS, restrictionsError =
	includeTable("luarules/mission_runtime/coilbox_restrictions.lua")
if not RESTRICTIONS then
	log("error", restrictionsError)
	return false
end

local EXTENSIONS, extensionsError = includeTable("luarules/mission_runtime/coilbox_extensions.lua")
if not EXTENSIONS then
	log("error", extensionsError)
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
-- And the one that says a unit is the runtime's own -- an anchor or a spotter --
-- which the unsynced half takes off this player's screen.
local HIDDEN_MESSAGE = "coilbox_mission_hidden"
-- And the four that reach the player rather than the game: a line of dialogue,
-- which the widget draws, and a sound, a camera move and a map marker, which the
-- unsynced half does outright.
local DIALOGUE_MESSAGE = "coilbox_mission_dialogue"
local SOUND_MESSAGE = "coilbox_mission_sound"
local CAMERA_MESSAGE = "coilbox_mission_camera"
local MARKER_MESSAGE = "coilbox_mission_marker"

-- The global the widget registers on the widget handler to hear a line. A
-- missing one is a no-op in the engine, so a game with no LuaUI, or a player who
-- has switched the widget off, costs nothing here.
local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"

-- Which unit an actor became, mirrored for LuaUI. An actor's display name has no
-- synced engine call behind it -- nothing renames a unit -- so the name is drawn
-- over the unit instead, and the panel that draws it needs to know which unit
-- that is. 0 means the actor is not on the map.
local ACTOR_RULES_PREFIX = "coilbox_mission_actor_"

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

	-- The prefab buildings the author named. A base is placed as one piece, so a
	-- building only gets an id when the scenario wants to talk about that
	-- building, and the ones that have one are addressable exactly as actors are.
	local buildings = {}
	for _, prefab in ipairs(MISSION.prefabs or {}) do
		for _, building in ipairs(prefab.buildings or {}) do
			if building.id then
				buildings[building.id] = building
			end
		end
	end

	local noCommander = {}
	for _, team in ipairs(teams) do
		if team.noCommander then
			noCommander[team.team] = true
		end
	end

	GG.CoilboxMission = {
		id = MISSION_ID,
		mission = MISSION,
		runtime = RUNTIME,
		-- Per-participant setup with the engine team number resolved.
		teams = teams,
		--- Whether the mission places this engine team's opening units itself, and
		-- the game must not.
		--
		-- The adoption contract's question, asked by a game's own start gadget
		-- where it would spawn. Answering it is the only reliable way to keep a
		-- game's start out of a mission: the engine has no veto on
		-- Spring.CreateUnit, so all the runtime can do on its own is destroy what
		-- the game just made, and a game that ends a team when its commander dies
		-- reads that as the team dying (issue #884).
		suppressesStart = function(teamID)
			return noCommander[teamID] == true
		end,
		--- The same question asked about the game rather than about one team.
		--
		-- A game whose start is a sequence rather than a call asks this one. A
		-- faction choice and a start position picker decide nothing a mission has
		-- already decided, so a game skips the whole sequence when this is true
		-- and runs it when some team still needs a start out of it (issue #888).
		--
		-- Read against the engine's team list rather than the scenario's, because
		-- a team the mission says nothing about still wants the start the game
		-- would have given it, and the sequence is what decides that start.
		suppressesEveryStart = function()
			local gaia = Spring.GetGaiaTeamID()
			for _, teamID in ipairs(Spring.GetTeamList() or {}) do
				if teamID ~= gaia and not noCommander[teamID] then
					return false
				end
			end
			return true
		end,
		-- Actor records by id, and the named prefab buildings by theirs. `units`
		-- holds the unit each one currently is, in one name space, so a trigger
		-- naming either gets a unit back. A name with no entry in `units` is one
		-- that has died or never spawned.
		actors = actors,
		buildings = buildings,
		units = {},
		-- The synced half adds `triggers`, the trigger engine, `vars`, the
		-- mission's variables, `groups`, the scenario's groups, `objectives`,
		-- its objectives, and `gameOver`, which ends it. Registering a condition
		-- or action type on the engine is how the rest of the runtime joins in,
		-- and `extensions` is the same seam offered to a game's own Lua through
		-- missions/extensions.lua; going through the handles is how they read
		-- and drive what those own.
	}
	return GG.CoilboxMission, problems
end

if gadgetHandler:IsSyncedCode() then
	-- The frame the runtime stops counting what arrives as part of the start.
	-- Everything the mission itself places lands in GameStart, so by here the
	-- scenario's own units are down and the bank can be set to the scenario's
	-- number over whatever the game opened on.
	local START_FRAME = 1

	local teams = {}
	local units = {}
	-- Whether the scenario places a given engine team's opening units itself. The
	-- published one, so a game asking the contract question and the undo below are
	-- reading the same answer.
	local suppressesStart
	local suppressing = false
	-- True only inside the runtime's own Spring.CreateUnit, so the suppression
	-- does not eat what the runtime just placed.
	local spawning = false
	-- True while the runtime is putting one of its own units on the map after the
	-- start, or taking one off. A spotter is not something a team built and not
	-- something it lost, so nothing about one reaches the triggers. The start
	-- window is the same idea for everything the runtime places at game start.
	local placing = false
	local invulnerable = {}
	local actorOfUnit = {}
	-- The trigger engine, and the hooks its unit conditions want fed. Both are
	-- synced only: triggers decide what happens in the game, so they run where
	-- every machine runs them.
	local triggers
	local unitHooks
	-- The scenario's groups, once registered.
	local groups
	-- What ends the mission, and what stops anything else ending it.
	local gameOver
	-- The reveals that are lit, and the spotters lighting them.
	local reveal
	-- What the mission's teams may build and do.
	local restrictions

	--- Tell the triggers something happened.
	--
	-- Nothing is raised while the start window is open. The mission's own spawns
	-- and the game's suppressed ones all land in there, and a mission counting
	-- what a team has built should not be counting the units it was handed.
	--
	-- Nothing is raised after the mission has ended either. The result is already
	-- in the replay, and a trigger that spawns a wave into a finished mission is
	-- a mission that looks broken.
	local function raise(name, payload)
		if suppressing or placing or not triggers or gameOver.isOver() then
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
					-- And LuaUI cannot be told at all, so it reads the same fact
					-- out of a rules param.
					Spring.SetGameRulesParam(ACTOR_RULES_PREFIX .. placement.actor, unitID)
				end
			end
		end

		-- After the actors, so a standing group ordered to guard one of them has
		-- something to guard.
		local grouped = groups.start()
		-- Last, and inside the start window like everything else the runtime
		-- places, so no trigger ever sees an anchor being created.
		local anchored = gameOver.place()

		log("notice", string.format(
			"mission %s spawned %d of %d units, %d in groups and %d anchors",
			MISSION_ID, spawned, #placements, grouped, anchored))
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
		suppressesStart = published.suppressesStart

		for _, problem in ipairs(problems) do
			log("warning", problem)
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
		-- The zone geometry is published as well as read, so anything else that has
		-- to work out where a zone is reads the same corners the conditions do.
		published.zones = ZONES.register(triggers, published)
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
		-- Before the first frame, so every objective has a state a panel can read
		-- from the moment the mission starts.
		published.objectives = OBJECTIVES.register(triggers, published)
		-- The anchors are units, so they go through the gadget's own creation the
		-- way a group's do.
		gameOver = GAMEOVER.register(triggers, published, {
			spawn = function(placement)
				local unitID = create(placement)
				if unitID then
					-- Invulnerable through the same path an actor is, and hidden by
					-- the unsynced half, which owns what this player's screen shows.
					applyState(unitID, { invulnerable = true })
					SendToUnsynced(HIDDEN_MESSAGE, unitID)
				end
				return unitID
			end,
		})
		published.gameOver = gameOver
		-- A revealed area is lit by a unit, because the engine has no call that
		-- lights part of a map. It goes on and comes off mid-mission, so both ends
		-- are wrapped in `placing`: a spotter is not a unit the team built and not
		-- one it lost. After the game over, which is where the team it belongs to
		-- and the def it is built from both come from.
		reveal = REVEAL.register(triggers, published, {
			spawn = function(placement)
				placing = true
				local unitID = create(placement)
				if unitID then
					applyState(unitID, { invulnerable = true })
					SendToUnsynced(HIDDEN_MESSAGE, unitID)
				end
				placing = false
				return unitID
			end,
			remove = function(unitID)
				placing = true
				Spring.DestroyUnit(unitID, false, true)
				placing = false
			end,
			def = GAMEOVER.inertDef,
		})
		published.reveal = reveal
		-- After the game over, which is where "the team a human is playing" comes
		-- from, because that is the team an unlock_unit naming none is about.
		restrictions = RESTRICTIONS.register(triggers, published)
		published.restrictions = restrictions
		-- Saying a line and playing a sound are things the player sees and hears
		-- rather than things that happen in the game, so synced Lua decides only
		-- that they happened and the unsynced half takes it from there.
		published.dialogue = DIALOGUE.register(triggers, published, {
			say = function(lineId)
				SendToUnsynced(DIALOGUE_MESSAGE, lineId)
			end,
			sound = function(name)
				SendToUnsynced(SOUND_MESSAGE, name)
			end,
		})
		-- Pointing the camera and putting a label on the map are the same kind of
		-- thing: the player's screen rather than the game.
		-- The engine team each one is for rides along, because every client runs
		-- the unsynced half and only a client knows which team it is watching.
		published.view = VIEW.register(triggers, published, {
			pan = function(x, z, seconds, team)
				SendToUnsynced(CAMERA_MESSAGE, x, z, seconds, team)
			end,
			mark = function(x, z, text, team)
				SendToUnsynced(MARKER_MESSAGE, x, z, text, team)
			end,
		})
		published.triggers = triggers

		-- Last, so every type the runtime itself implements is registered before a
		-- game's own are read. What the game may add is checked against the version
		-- marker rather than against what happens to be registered, but registering
		-- after the runtime is what makes the two the same list.
		published.extensions = EXTENSIONS.register(triggers, published, {
			has = function(path)
				return VFS.FileExists(path, VFS.ZIP)
			end,
			load = includeTable,
			-- What a game's own handler runs in. A table of its own that falls
			-- through to this gadget's environment: the handler is code, so it has
			-- to reach the engine and GG, and a global it sets should land in its
			-- own table rather than in the runtime's.
			--
			-- Named rather than left to VFS.Include's default, because the default
			-- is not this environment. A handler included with no environment at all
			-- cannot see GG, which is where a game keeps everything an extension is
			-- likely to want (issue #776).
			env = function()
				return setmetatable({}, { __index = getfenv(1) })
			end,
			log = log,
		})

		-- Before the first frame, so a panel reading which unit an actor is finds
		-- "not on the map" rather than nothing at all. Named prefab buildings
		-- too, because they answer to the same table and the same param.
		for id in pairs(published.actors) do
			Spring.SetGameRulesParam(ACTOR_RULES_PREFIX .. id, 0)
		end
		for id in pairs(published.buildings) do
			Spring.SetGameRulesParam(ACTOR_RULES_PREFIX .. id, 0)
		end

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
		-- The engine owns how often it actually evaluates. A mission that has
		-- ended evaluates nothing: the result is already in the replay.
		if not gameOver.isOver() then
			triggers:frame(frame)
		end
	end

	-- What the mission's teams may build and do.
	--
	-- Both callins are defined only when the mission asks for one, because both
	-- are hot: AllowCommand is consulted for every order anyone gives for the
	-- length of the game. A mission that restricts nothing pays nothing, which is
	-- the bargain the modoption gate makes for a normal game.
	--
	-- Explicit booleans on the way out. A gadget handler reads a nil return as a
	-- refusal, so "no opinion" is not something to leave unsaid here.
	local RESTRICTED = MISSION.restrictions or {}

	if RESTRICTED.buildable then
		--- Refuse a build the mission forbids this team. The team is the builder's,
		-- which is the team the unit would have been built on.
		--
		-- The second return is what the engine does with the order that asked.
		-- Dropping it is what stops a factory queue jamming on a unit it will never
		-- be allowed to build, and a builder standing at the site retrying forever.
		function gadget:AllowUnitCreation(unitDefID, _, builderTeam)
			if restrictions.allowsBuild(unitDefID, builderTeam) then
				return true
			end
			return false, true
		end
	end

	if RESTRICTED.commands and #RESTRICTED.commands > 0 then
		--- Withhold a command the mission took away.
		--
		-- A command synced Lua gave is let through. A restriction is what the
		-- player may not do, and the runtime ordering its own groups about is the
		-- mission itself: a mission that withheld `attack` and then could not order
		-- its raiders to attack would be restricting its author.
		function gadget:AllowCommand(_, _, unitTeam, cmdID, _, _, _, _, _, fromLua)
			if fromLua then
				return true
			end
			return restrictions.allowsCommand(cmdID, unitTeam)
		end
	end

	--- Undo the start the game would have given a team the scenario spawns for
	-- itself.
	--
	-- The fallback rather than the mechanism. What a game is asked to do is not
	-- spawn in the first place, through suppressesStart. This catches a game that
	-- has not been asked to, which is every game that has adopted the runtime and
	-- not that part of the contract.
	--
	-- Undone rather than prevented, because the engine offers no veto:
	-- AllowUnitCreation is consulted for builders and factories only, never for
	-- Spring.CreateUnit, which is what a game's start gadget uses. Killing a unit
	-- inside UnitCreated is a case the engine handles.
	--
	-- It reaches only as far as the start window, and it is not safe to widen. A
	-- game that counts commanders counts this one, and Splinter Faction's
	-- game_team_com_ends.lua answers an ally team's last commander dying with
	-- Spring.KillTeam, which is the whole team's units and the player's seat in the
	-- game. A start undone the frame it arrives is ahead of that bookkeeping. One
	-- undone 1800 frames later is not, and the mission ends up worse off than the
	-- unwanted commander it was undoing (issue #884).
	--
	-- Narrow on purpose. Only a team the scenario marked noCommander, only while
	-- the start window is open, only a unit with no builder, so nothing anyone
	-- has begun building is ever touched.
	function gadget:UnitCreated(unitID, unitDefID, unitTeam, builderID)
		if suppressing then
			if not spawning and not builderID and suppressesStart(unitTeam) then
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
		if suppressing or placing then
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

	--- A team died, which is the game taking its players out of the mission and
	-- putting them in the stands. The anchor is what should have stopped that, so
	-- the game over is told and says whether the anchor was there when it happened.
	function gadget:TeamDied(teamID)
		gameOver.teamDied(teamID)
	end

	function gadget:UnitDestroyed(unitID, unitDefID, unitTeam)
		invulnerable[unitID] = nil
		groups.removed(unitID)
		gameOver.removed(unitID)
		reveal.removed(unitID)
		local actor = actorOfUnit[unitID]
		if actor then
			actorOfUnit[unitID] = nil
			units[actor] = nil
			Spring.SetGameRulesParam(ACTOR_RULES_PREFIX .. actor, 0)
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

	--- Which unit an actor became. Anything about an actor that is local to this
	-- player's screen is applied here, because the engine has no synced call for
	-- it.
	local function actorBecame(actorId, unitID)
		published.units[actorId] = unitID

		local actor = published.actors[actorId]
		if actor and actor.state and actor.state.unselectable then
			Spring.SetUnitNoSelect(unitID, true)
		end
	end

	--- Take one of the runtime's own units off this player's screen. An anchor is
	-- there to keep a team's unit count above nothing and a spotter to light a
	-- revealed area, and neither is anything the player should see, so both are
	-- drawn nowhere, on no minimap, and cannot be selected -- not even by a
	-- select-all.
	local function hide(unitID)
		Spring.SetUnitNoDraw(unitID, true)
		Spring.SetUnitNoMinimap(unitID, true)
		Spring.SetUnitNoSelect(unitID, true)
	end

	-- Sounds that would not play, so a name the game has no sound for is one
	-- warning rather than one every time the trigger fires.
	local badSound = {}

	--- Play a sound the mission asked for. The name goes to the engine as the
	-- author wrote it, so it is either an item in the game's own sounds.lua or a
	-- path to a file in the game.
	local function playSound(name)
		if not Spring.PlaySoundFile(name, 1) and not badSound[name] then
			badSound[name] = true
			log("warning", "this game has no sound called " .. tostring(name))
		end
	end

	--- Whether an action the mission aimed at one team is this client's to do.
	--
	-- Every client runs this half, so a camera move or a marker for one
	-- participant has to be dropped by everyone else (issue #827). The engine
	-- team this client is on is its answer, which for a spectator is the team
	-- the engine has them watching as.
	local function forMe(team)
		return VIEW.isFor(team, Spring.GetMyTeamID())
	end

	--- Move the camera to a place on the map, over `seconds`.
	--
	-- A scenario carries no height, so the ground is read here, the way it is for
	-- everything else the runtime puts somewhere.
	local function panCamera(x, z, seconds, team)
		if not forMe(team) then
			return
		end
		Spring.SetCameraTarget(x, Spring.GetGroundHeight(x, z), z, seconds)
	end

	--- Put a labelled point on the map.
	--
	-- Local on purpose. Every client runs this half, so a marker sent the way a
	-- player's own click sends one would be broadcast once per player and land on
	-- the map that many times over.
	local function addMarker(x, z, text, team)
		if not forMe(team) then
			return
		end
		Spring.MarkerAddPoint(x, Spring.GetGroundHeight(x, z), z, text, true)
	end

	--- Returns nothing: a true return would stop the message reaching the gadgets
	-- behind this one, and their messages are not ours to swallow.
	function gadget:RecvFromSynced(message, first, second, third, fourth)
		if message == ACTOR_MESSAGE then
			actorBecame(first, second)
		elseif message == HIDDEN_MESSAGE then
			hide(first)
		elseif message == CAMERA_MESSAGE then
			panCamera(first, second, third, fourth)
		elseif message == MARKER_MESSAGE then
			addMarker(first, second, third, fourth)
		elseif message == DIALOGUE_MESSAGE then
			-- The panel is a widget, so the line goes on to LuaUI, which draws it
			-- and plays its clip in step with the text. A game with no LuaUI, or a
			-- player who has switched the widget off, gets no dialogue: there is
			-- nowhere for it to appear.
			Script.LuaUI[DIALOGUE_GLOBAL](first)
		elseif message == SOUND_MESSAGE then
			-- Played here rather than in the widget, because a sound is not part of
			-- the conversation and has nothing to queue behind.
			playSound(first)
		end
	end
end
