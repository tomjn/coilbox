-- Coilbox mission runtime: the headless probe.
--
-- A gadget that stands in for the player and then checks what the runtime did
-- about it. scripts/mission-headless.sh copies it into a scratch game beside the
-- runtime and runs the pair in spring-headless, so everything here is measured
-- in a real engine: real unit defs, a real build grid, a real gadget handler.
--
-- Not part of what a game vendors, and not something a mission ever ships with.
--
-- Every check is one line of stdout, `HARNESS ok` or `HARNESS fail`, which the
-- script counts. The probe drives the mission from GameFrame rather than waiting
-- for anything, because a headless run has nobody at the keyboard: walking a
-- unit into a zone is the only way most missions ever fire.

function gadget:GetInfo()
	return {
		name = "Coilbox mission headless probe",
		desc = "Drives a fixture mission and checks the runtime in a real engine",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime, which is itself behind the game, so every check
		-- reads the frame after everyone else has finished with it.
		layer = 2000,
		enabled = true,
	}
end

local MISSION_ID = Spring.GetModOptions().coilbox_mission

if not gadgetHandler:IsSyncedCode() then
	-- Nothing in a headless run paces the simulation but the local server, and it
	-- paces it at the speed a player would watch. The checks are about frames,
	-- not seconds, so the run is asked for the fastest speed it will give.
	function gadget:Initialize()
		Spring.SendCommands("setspeed 20")
	end

	function gadget:RecvFromSynced(message)
		if message == "coilbox_harness_done" then
			Spring.Quit()
		end
	end

	return
end

--------------------------------------------------------------------------------
-- Reporting.
--------------------------------------------------------------------------------

local function say(line)
	Spring.Echo("HARNESS " .. line)
end

local function check(name, ok, detail)
	if ok then
		say("ok " .. name)
	else
		say("fail " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

--------------------------------------------------------------------------------
-- Reading the world.
--------------------------------------------------------------------------------

local ACTIVE, COMPLETE = 0, 1

local function state()
	return GG.CoilboxMission
end

local function armed(id)
	return state().triggers:isEnabled(id)
end

local function rules(name)
	return Spring.GetGameRulesParam(name)
end

local function defOf(unitID)
	local defID = unitID and Spring.GetUnitDefID(unitID)
	return defID and UnitDefs[defID] and UnitDefs[defID].name
end

--- How many units of a def a team owns.
local function owns(team, defName)
	local def = UnitDefNames[defName]
	if not def then
		return -1
	end
	return Spring.GetTeamUnitDefCount(team, def.id)
end

--- The first unit a team owns of a def, or nil.
local function find(team, defName)
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		if defOf(unitID) == defName then
			return unitID
		end
	end
end

--- Put a unit on the map for the player, at the ground height, and make it
-- proof against anything the mission's own units do to it. A check about a zone
-- being held is about the runtime's clock, not about whether a scout survives
-- three raiders.
local function playerUnit(defName, x, z)
	local unitID = Spring.CreateUnit(defName, x, Spring.GetGroundHeight(x, z), z, 0, 0)
	if unitID then
		Spring.SetUnitArmored(unitID, true, 0)
	end
	return unitID
end

--------------------------------------------------------------------------------
-- The plans. One per fixture mission: a deadline and a list of steps, each a
-- frame and what to do or check on it.
--------------------------------------------------------------------------------

local plans = {}

-- Ambush: the player walks into a box zone and a dormant group springs on them.
plans.ambush = {
	deadline = 150,
	steps = {
		{ frame = 5, run = function()
			check("the mission is published", state() ~= nil and state().id == "ambush")
			check("the actor the scenario placed is on the map",
				defOf(state().units.scout) == "armpw", defOf(state().units.scout))
			check("the rules param names the unit the actor became",
				rules("coilbox_mission_actor_scout") == state().units.scout)
			check("a team the scenario spawns for itself is given no commander by the game",
				#Spring.GetTeamUnits(1) == 1, #Spring.GetTeamUnits(1))
			check("the scenario's bank is what the team starts on, not the game's",
				Spring.GetTeamResources(1, "metal") == 500, Spring.GetTeamResources(1, "metal"))
			check("a dormant group is not on the map", #state().groups.units("raiders") == 0)
			check("the trigger watching the zone is armed", armed("spring-ambush") == true)
		end },
		{ frame = 30, run = function()
			playerUnit("armpw", 100, 100)
		end },
		{ frame = 60, run = function()
			check("walking a unit into the zone fires the trigger", armed("spring-ambush") == false)
			local raiders = state().groups.units("raiders")
			check("its spawn_group put the whole group on the map", #raiders == 4, #raiders)
			check("the group's units are the def and team the scenario names",
				defOf(raiders[1]) == "armpw" and Spring.GetUnitTeam(raiders[1]) == 1)
			check("wake_group left it running its orders", state().groups.isAwake("raiders") == true)
		end },
		{ frame = 90, run = function()
			Spring.DestroyUnit(state().units.scout, false, true)
		end },
		{ frame = 95, run = function()
			check("an actor's death fires the trigger watching it", armed("scout-down") == false)
			check("and its rules param goes back to nothing",
				rules("coilbox_mission_actor_scout") == 0)
			check("a mission nothing has ended is not over", rules("coilbox_mission_over") == 0)
		end },
	},
}

-- Garrison: counting what a team owns, what it has built since the start, and
-- what a capture reveals.
plans.garrison = {
	-- The reveal the capture starts runs for 30 seconds, so the fog cannot come
	-- back before frame 1050 or so.
	deadline = 1300,
	steps = {
		{ frame = 5, run = function()
			check("a trigger the scenario disabled starts disabled", armed("unlock") == false)
			check("a var starts at the number its author gave it",
				rules("coilbox_mission_var_garrisonBuilt") == 0)
			check("an objective starts active",
				rules("coilbox_mission_objective_defend-garrison") == ACTIVE)
			check("a building actor is on the map", defOf(state().units.outpost) == "armestor",
				defOf(state().units.outpost))
			check("a team's startUnits are on its start position", owns(1, "armck") == 1, owns(1, "armck"))
			check("what the runtime placed does not count as something the team built",
				armed("built-outpost") == true)
		end },
		{ frame = 30, run = function()
			for _ = 1, 3 do
				Spring.CreateUnit("armpw", 300, Spring.GetGroundHeight(300, 300), 300, 0, 1)
			end
		end },
		{ frame = 60, run = function()
			check("a unit count reaching its minimum fires", armed("count-check") == false)
			check("its set_var wrote the var out where a panel can read it",
				rules("coilbox_mission_var_garrisonBuilt") == 1,
				rules("coilbox_mission_var_garrisonBuilt"))
			check("its enable_trigger armed another, which then fired and spent itself",
				armed("unlock") == false)
		end },
		{ frame = 90, run = function()
			Spring.CreateUnit("armestor", 400, Spring.GetGroundHeight(400, 400), 400, 0, 1)
		end },
		{ frame = 120, run = function()
			check("a unit finished after the start window is one the team built",
				armed("built-outpost") == false)
			check("its add_var added to the var",
				rules("coilbox_mission_var_garrisonBuilt") == 2,
				rules("coilbox_mission_var_garrisonBuilt"))
			check("its disable_trigger left the other one disarmed", armed("count-check") == false)
		end },
		{ frame = 150, run = function()
			Spring.TransferUnit(state().units.outpost, 0, false)
		end },
		{ frame = 180, run = function()
			check("an actor changing hands fires the trigger watching it",
				armed("outpost-captured") == false)
			check("its reveal_area lit the zone with one spotter",
				state().reveal.spotterCount(0) == 1, state().reveal.spotterCount(0))
			local spotter
			for _, unitID in ipairs(Spring.GetTeamUnits(0) or {}) do
				if state().reveal.isSpotter(unitID) then
					spotter = unitID
				end
			end
			-- The claim the runtime makes about a spotter standing in someone
			-- else's base. Nothing that is not the reveal's own ally team may see
			-- it, or an enemy army spends the mission shooting an invulnerable box.
			local seen = spotter and Spring.GetUnitLosState(spotter, 1) or {}
			check("and no other ally team can see it", not seen.los and not seen.radar,
				tostring(seen.los) .. "/" .. tostring(seen.radar))
			check("the spotter is not counted as a unit its team owns",
				state().reveal.spotterCount(0, Spring.GetUnitDefID(spotter)) == 1)
		end },
		{ frame = 1250, run = function()
			check("the reveal runs out and the spotter comes off the map",
				state().reveal.spotterCount(0) == 0, state().reveal.spotterCount(0))
		end },
	},
}

-- Siege: a prefab base, a standing group, and a zone the player has to hold for
-- a minute before the mission ends.
plans.siege = {
	-- The hold is 60 seconds and the player's unit walks in at frame 30, so the
	-- mission cannot end before frame 1830. The deadline is the slack on top.
	deadline = 2100,
	steps = {
		{ frame = 5, run = function()
			check("a group the scenario does not call dormant starts on the map",
				#state().groups.units("keep-guard") == 3, #state().groups.units("keep-guard"))
			local lab = find(1, "corlab")
			check("a prefab's factory is on the map", lab ~= nil)
			local queue = lab and Spring.GetFactoryCommands(lab, -1) or {}
			check("with the queue the prefab wrote, one order per unit", #queue == 3, #queue)
			local states = lab and Spring.GetUnitStates(lab) or {}
			check("and repeating, so the queue does not empty", states["repeat"] == true,
				tostring(states["repeat"]))
			check("a prefab's other buildings are placed too", owns(1, "cormex") == 1, owns(1, "cormex"))
			check("the mission has not ended", rules("coilbox_mission_over") == 0)
			check("nor has its objective", rules("coilbox_mission_objective_take-keep") == ACTIVE)
		end },
		{ frame = 30, run = function()
			playerUnit("armpw", 20, 20)
		end },
		{ frame = 1500, run = function()
			check("a hold short of the minute settles nothing",
				rules("coilbox_mission_objective_take-keep") == ACTIVE)
			check("and does not end the mission", rules("coilbox_mission_over") == 0)
		end },
		{ frame = 1980, run = function()
			check("holding the zone for the minute completes the objective",
				rules("coilbox_mission_objective_take-keep") == COMPLETE,
				rules("coilbox_mission_objective_take-keep"))
			check("and ends the mission", rules("coilbox_mission_over") == 1,
				rules("coilbox_mission_over"))
			check("with the player's ally team the only winner",
				rules("coilbox_mission_winners") == 1 and rules("coilbox_mission_winner_0") == 1,
				tostring(rules("coilbox_mission_winners")) .. "/"
					.. tostring(rules("coilbox_mission_winner_0")))
		end },
	},
}

-- No mission at all: the modoption gate. The runtime is a file in the game
-- whatever happens, so what has to be proved is that a normal game never gets a
-- gadget out of it.
local GATE = {
	deadline = 30,
	steps = {
		{ frame = 5, run = function()
			check("without the modoption the runtime publishes nothing", GG.CoilboxMission == nil)
		end },
	},
}

--------------------------------------------------------------------------------
-- Running one.
--------------------------------------------------------------------------------

local plan = MISSION_ID and plans[MISSION_ID] or (not MISSION_ID and GATE)
local done = false

function gadget:Initialize()
	if not plan then
		say("fail the probe has no plan for mission " .. tostring(MISSION_ID))
	end
end

function gadget:GameFrame(frame)
	if done then
		return
	end
	if not plan then
		done = true
		say("done")
		SendToUnsynced("coilbox_harness_done")
		return
	end

	for _, step in ipairs(plan.steps) do
		if step.frame == frame then
			-- A check that raises should not take the rest of the run with it: the
			-- other steps still have something to say, and an engine that never
			-- quits is a hung harness rather than a failed one.
			local ok, err = pcall(step.run)
			if not ok then
				say("fail step at frame " .. frame .. ": " .. tostring(err))
			end
		end
	end

	if frame >= plan.deadline then
		done = true
		say("done")
		SendToUnsynced("coilbox_harness_done")
	end
end
