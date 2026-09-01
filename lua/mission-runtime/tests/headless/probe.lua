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
-- script counts, and `HARNESS skip` for a claim this run cannot reach at all.
-- The probe drives the mission from GameFrame rather than waiting for anything,
-- because a headless run has nobody at the keyboard: walking a unit into a zone
-- is the only way most missions ever fire.
--
-- The synced half checks the runtime and the unsynced half checks the widget,
-- because only one of them can see LuaUI.

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

--------------------------------------------------------------------------------
-- Reporting. Above the split, because both halves have checks to make: the
-- runtime is the synced half's and the widget is the unsynced half's.
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
-- The unsynced half: the orders a player would give, and the widget.
--
-- The widget runs in another Lua state, and the one thing about it visible from
-- a gadget is the global it registers. `Script.LuaUI(name)` answers whether the
-- LuaUI state has a function of that name, which is what
-- `widgetHandler:RegisterGlobal` writes and what `Script.LuaUI[name](...)`
-- reaches. So the global is both the claim and the way to read it, and it is
-- there for exactly as long as the widget is: a handler that throws a widget out
-- over an error in any of its callins takes that widget's globals down with it.
--
-- `Script` is unsynced only, which is why the widget is checked from here.
--------------------------------------------------------------------------------

if not gadgetHandler:IsSyncedCode() then
	local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"

	-- The runtime's own message for a line of dialogue. Every unsynced gadget is
	-- handed it, and it is the frame the runtime passes that line to LuaUI.
	local DIALOGUE_MESSAGE = "coilbox_mission_dialogue"

	-- And the two that point the player at a place. Both carry the engine team
	-- they are for, or -1 for everyone (issue #827), and reading them here is the
	-- only way a run can see what the synced half resolved a participant into.
	local CAMERA_MESSAGE = "coilbox_mission_camera"
	local MARKER_MESSAGE = "coilbox_mission_marker"

	-- The team each camera move and marker was aimed at, in order.
	local aimedAt = { camera = {}, marker = {} }

	--- Whether LuaUI is running at all. `Script.LuaUI` answers nothing when it is
	-- not, which is what a game whose own LuaUI died at its entry point looks like
	-- from here.
	local function luaUI()
		return Script.LuaUI() == true
	end

	local function widgetLoaded()
		return Script.LuaUI(DIALOGUE_GLOBAL) == true
	end

	-- Whether the widget is being checked at all, decided on the first frame
	-- because LuaUI is loaded after the gadgets are. A run with no LuaUI says so
	-- once rather than failing every widget check with the same missing state.
	local proving

	-- A mission says its opening line more than once when the trigger repeats, and
	-- the claim is about the first.
	local heardLine = false

	-- Nothing in a headless run paces the simulation but the local server, and it
	-- paces it at the speed a player would watch. The checks are about frames,
	-- not seconds, so the run is asked for the fastest speed it will give.
	function gadget:Initialize()
		Spring.SendCommands("setspeed 20")
		-- God mode, for one reason only: without it the unsynced half cannot give
		-- an order at all. The engine lets a Lua handle put an order on the wire
		-- only when the local player controls the handle's ctrl team, and a
		-- gadget's is every team at once, which is nobody's. God mode is what
		-- registers that as a team the player controls. It changes who may order
		-- what, and nothing about how an order is carried or judged.
		Spring.SendCommands("cheat", "godmode 3")
	end

	--- Give a unit an order the way a player's click does.
	--
	-- The unsynced Spring.GiveOrderToUnit puts the order on the wire as the local
	-- player's, and it comes back into the simulation with fromLua false, the
	-- same as a click. Everything the synced half gives is fromLua, and the
	-- runtime lets all of that through on purpose, so this is the only order a
	-- headless run has that a withheld command can be proved against.
	local function playerOrder(unitID, cmdID, ...)
		if not Spring.GiveOrderToUnit(unitID, cmdID, { ... }, 0) then
			Spring.Echo("HARNESS fail the unsynced half was refused an order for unit " .. tostring(unitID))
		end
	end

	--- The widget half, on the first frame the run reaches.
	function gadget:GameFrame()
		if proving ~= nil then
			return
		end
		proving = luaUI()
		if not proving then
			say("skip this run has no LuaUI, so nothing in it reaches the mission widget")
		elseif MISSION_ID then
			check("the game's own widget handler loads the mission widget out of luaui/widgets",
				widgetLoaded())
		else
			check("a game with no mission is left with no mission widget", not widgetLoaded())
		end
	end

	--- What the ambush's camera moves and markers were aimed at.
	--
	-- Which client acts on one is decided inside the runtime's own unsynced half,
	-- and this run has one client, so it cannot watch anybody drop a message that
	-- is not theirs. What it can settle is the half only a real engine has: that a
	-- participant id in the document arrives here as this client's engine team
	-- number, and that an action naming no participant arrives as everyone. The
	-- drop itself is watched by scripts/mission-clients.sh, which plays the same
	-- fixture across three clients at once (issue #953).
	local function checkAimed()
		local mine = Spring.GetMyTeamID()
		check("a camera move the scenario aimed at a participant carries that team",
			#aimedAt.camera == 1 and aimedAt.camera[1] == mine,
			table.concat(aimedAt.camera, ",") .. " wanted " .. tostring(mine))
		check("and its markers carry one aimed at that team and one aimed at everyone",
			#aimedAt.marker == 2 and aimedAt.marker[1] == mine and aimedAt.marker[2] == -1,
			table.concat(aimedAt.marker, ","))
	end

	function gadget:RecvFromSynced(message, ...)
		if message == "coilbox_harness_done" then
			-- Last of all, because a widget the handler threw out over an error in
			-- any callin between the first frame and this one is a widget whose
			-- global has gone with it.
			if proving and MISSION_ID then
				check("and it is still loaded at the end of the mission", widgetLoaded())
			end
			if MISSION_ID == "ambush" then
				checkAimed()
			end
			Spring.Quit()
		elseif message == "coilbox_harness_player_order" then
			playerOrder(...)
		elseif message == CAMERA_MESSAGE then
			local _, _, _, team = ...
			aimedAt.camera[#aimedAt.camera + 1] = team
		elseif message == MARKER_MESSAGE then
			local _, _, _, team = ...
			aimedAt.marker[#aimedAt.marker + 1] = team
		elseif message == DIALOGUE_MESSAGE and proving and not heardLine then
			heardLine = true
			check("a line the mission says has the widget's global to arrive at", widgetLoaded())
		end
	end

	return
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

--- What a game rules param holds, or nil.
--
-- `Spring.GetGameRulesParam` returns no values at all for a param nothing has
-- set, not nil, so passing the call straight on hands the caller an empty
-- expression list and `tostring(rules(name))` raises. Bound to one value, so a
-- detail string can say "nil" rather than taking its step down with it.
local function rules(name)
	local value = Spring.GetGameRulesParam(name)
	return value
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

--- Put a unit on the map for a team, at the ground height, and make it proof
-- against anything the mission's own units do to it. A check about a zone being
-- held is about the runtime's clock, not about whether a scout survives three
-- raiders, nor about where they leave it.
--
-- Armour stops the damage and nothing else. The engine scales damage by the
-- armour multiple and impulse by nothing, and a ground unit answers impulse by
-- skidding, so an armoured unit under fire still slides. Two more calls take the
-- rest away: MoveCtrl gives it the scripted move type, which refuses impulse
-- outright and is never pushed, and dropping it out of solid-object collisions
-- keeps a unit that is itself skidding from shoving it on the way past. What is
-- left stands exactly where it was put for the whole run.
local function pinnedUnit(defName, team, x, z)
	local unitID = Spring.CreateUnit(defName, x, Spring.GetGroundHeight(x, z), z, 0, team)
	if unitID then
		Spring.SetUnitArmored(unitID, true, 0)
		Spring.MoveCtrl.Enable(unitID)
		Spring.SetUnitBlocking(unitID, false, false)
	end
	return unitID
end

--- The same, on the player's team, which is what most of the steps below want.
local function playerUnit(defName, x, z)
	return pinnedUnit(defName, 0, x, z)
end

--- A spot within `reach` of (x, z) that `defName` may be built on, or nil.
--
-- The harness runs on whatever map the machine has, and a site has to be flat,
-- dry and clear, so the sites are found by asking the engine rather than named.
-- An order at a site the engine will not take is refused before the runtime is
-- asked about it, which would leave a check about a restriction passing on
-- nothing.
local function buildSite(defName, x, z, reach)
	local def = UnitDefNames[defName]
	for dz = -reach, reach, 16 do
		for dx = -reach, reach, 16 do
			if dx * dx + dz * dz <= reach * reach then
				local bx, by, bz = Spring.Pos2BuildPos(def.id, x + dx,
					Spring.GetGroundHeight(x + dx, z + dz), z + dz, 0)
				-- 2 is the engine's answer for both an open square and one a
				-- feature can be reclaimed off, and a builder sent to the second
				-- reclaims before it builds. Only the open one will do here.
				local blocking, feature = Spring.TestBuildOrder(def.id, bx, by, bz, 0)
				if blocking == 2 and feature == nil then
					return bx, by, bz
				end
			end
		end
	end
end

--- Order a builder to put a def up at a spot, the way a player's click does.
local function buildOrder(unitID, defName, x, y, z)
	Spring.GiveOrderToUnit(unitID, -UnitDefNames[defName].id, { x, y, z, 0 }, 0)
end

--- A unit's build menu as the engine holds it, one entry per build command in
-- the engine's own order, with a `!` on any the player would see greyed. A build
-- command's id is the negative of the def it builds.
--
-- Read through Spring.GetUnitCmdDescs, which is what the engine's own build menu
-- is drawn from, so this is the same list a player would be looking at.
local function buildMenu(unitID)
	local entries = {}
	for _, desc in ipairs(Spring.GetUnitCmdDescs(unitID) or {}) do
		if desc.id < 0 and UnitDefs[-desc.id] then
			entries[#entries + 1] = UnitDefs[-desc.id].name .. (desc.disabled and "!" or "")
		end
	end
	return table.concat(entries, ",")
end

--- The same list with nothing said about what is greyed, which is what an icon
-- taken out and put back in the wrong place would change.
local function menuOrder(unitID)
	return (buildMenu(unitID):gsub("!", ""))
end

--- Whether one def's icon is greyed on a unit, or nil when the unit has no icon
-- for that def at all. Nil rather than false on purpose: a check that wanted a
-- greyed icon and found no icon is not a check that passed.
local function iconGreyed(unitID, defName)
	local id = -UnitDefNames[defName].id
	for _, desc in ipairs(Spring.GetUnitCmdDescs(unitID) or {}) do
		if desc.id == id then
			return desc.disabled == true
		end
	end
end

--- A unit of a def a team owns, or nil.
local function unitOf(team, defName)
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		if defOf(unitID) == defName then
			return unitID
		end
	end
end

--- A command queue as something a failed check can print. A negative command id
-- is a def id, which is what a build order is.
local function queueText(queue)
	local names = {}
	for i, command in ipairs(queue) do
		local id = command.id
		names[i] = (id < 0 and UnitDefs[-id] and UnitDefs[-id].name) or tostring(id)
	end
	return "[" .. table.concat(names, ", ") .. "]"
end

--------------------------------------------------------------------------------
-- Where the mission put things.
--
-- The claim the harness went without, and issue #868 is what that cost. Spring
-- measures a map from its north-west corner, so a negative coordinate is off the
-- map, and the engine answers one by clamping the unit onto the edge rather than
-- refusing it. Every check about placement here counted units, so a prefab base
-- that arrived as a heap on (0, 0) read as placed.
--
-- What follows works out where the mission document asks for each unit and reads
-- back where the engine has it. The block layout is derived here rather than
-- borrowed from the runtime, so a change to it has to be a deliberate one.
--------------------------------------------------------------------------------

-- coilbox_start.lua's START_UNIT_SPACING: the gap between units placed as a block.
local BLOCK_SPACING = 64

--- Offsets for `count` units packed into a square grid centred on the origin.
local function gridOffsets(count)
	local width = 1
	while width * width < count do
		width = width + 1
	end

	local offsets = {}
	for i = 0, count - 1 do
		local column = i % width
		local row = (i - column) / width
		offsets[i + 1] = {
			x = (column - (width - 1) / 2) * BLOCK_SPACING,
			z = (row - (width - 1) / 2) * BLOCK_SPACING,
		}
	end
	return offsets
end

--- Where a unit of `defName` asked for at (x, z) belongs. A building is snapped
-- to the build grid, because the runtime puts one through Pos2BuildPos so a base
-- can be rebuilt where it stood. Everything else lands where it was asked for.
local function wantedPos(defName, x, z, facing)
	local def = UnitDefNames[defName]
	if def and def.isBuilding then
		local bx, _, bz = Spring.Pos2BuildPos(def.id, x, 0, z, facing or 0)
		return bx, bz
	end
	return x, z
end

--- Half a unit's footprint on each axis, in elmos. An odd facing stands a
-- building a quarter turn round, which swaps the two.
local function halfFootprint(unitID)
	local def = UnitDefs[Spring.GetUnitDefID(unitID)]
	local xsize, zsize = def.xsize, def.zsize
	if (Spring.GetUnitBuildFacing(unitID) or 0) % 2 == 1 then
		xsize, zsize = zsize, xsize
	end
	return xsize * 4, zsize * 4
end

--- Every unit the mission places at the start, with the spot its document asks
-- for. Everything comes back from the runtime by name: an actor, a group's
-- units, and since issue #878 a prefab's buildings too. A building with no name
-- is one nothing records, so the fixture is checked for that rather than the
-- probe going back to finding a building by its unit def.
local function startPlacements()
	local mission = state().mission
	local wanted = {}
	-- What this run's difficulty leaves in. A mission that gates nothing has
	-- every range nil and the gate says yes to all of them, so this reads the
	-- same for every fixture written before difficulty existed (issue #2164).
	local applies = state().difficultyGate

	local function want(label, unitID, defName, x, z, facing)
		local wx, wz = wantedPos(defName, x, z, facing)
		wanted[#wanted + 1] = { label = label, unit = unitID, x = wx, z = wz }
	end

	for _, actor in ipairs(mission.actors or {}) do
		if applies(actor.difficulty) then
			want("actor " .. actor.id, state().units[actor.id], actor.unitDef,
				actor.pos.x, actor.pos.z, actor.facing)
		end
	end

	for _, group in ipairs(mission.groups or {}) do
		if group.dormant ~= true and applies(group.difficulty) then
			local units = state().groups.units(group.id)
			local defs = {}
			for _, entry in ipairs(group.units or {}) do
				for _ = 1, entry.count do
					defs[#defs + 1] = entry.def
				end
			end
			local offsets = gridOffsets(#defs)
			for i, defName in ipairs(defs) do
				want(string.format("group %s's %s %d", group.id, defName, i),
					units[i], defName,
					group.pos.x + offsets[i].x, group.pos.z + offsets[i].z, 0)
			end
		end
	end

	for _, prefab in ipairs(mission.prefabs or {}) do
		if applies(prefab.difficulty) then
			for index, building in ipairs(prefab.buildings or {}) do
				-- A building the fixture forgot to name would drop out of every check
				-- below with nothing said, so it is a failure in its own right.
				check(string.format("prefab %s's building %d is named", prefab.id, index),
					building.id ~= nil, building.def)
				want(string.format("prefab %s's %s", prefab.id, building.def),
					state().units[building.id], building.def,
					prefab.origin.x + building.offset.x,
					prefab.origin.z + building.offset.z,
					building.facing)
			end
		end
	end

	return wanted
end

--- Two claims about everything the mission places: each unit stands on the spot
-- the document asks for, and no two of them are inside each other. Called on the
-- frame the runtime places them, which is before the engine has moved anything,
-- so the first is exact rather than approximate.
local function checkPlacement()
	local wanted = startPlacements()
	local misplaced, stacked = {}, {}

	for _, entry in ipairs(wanted) do
		if not entry.unit then
			misplaced[#misplaced + 1] = entry.label .. " is not on the map"
		else
			local x, _, z = Spring.GetUnitPosition(entry.unit)
			entry.at = { x = x, z = z }
			if math.abs(x - entry.x) > 0.5 or math.abs(z - entry.z) > 0.5 then
				misplaced[#misplaced + 1] = string.format("%s at %d,%d wanted %d,%d",
					entry.label, x, z, entry.x, entry.z)
			end
		end
	end
	check("every unit the mission places stands where the mission says",
		#misplaced == 0, table.concat(misplaced, "; "))

	for i = 1, #wanted do
		for j = i + 1, #wanted do
			local a, b = wanted[i], wanted[j]
			if a.at and b.at then
				local ax, az = halfFootprint(a.unit)
				local bx, bz = halfFootprint(b.unit)
				if math.abs(a.at.x - b.at.x) < ax + bx
					and math.abs(a.at.z - b.at.z) < az + bz then
					stacked[#stacked + 1] = a.label .. " and " .. b.label
				end
			end
		end
	end
	check("and no two of them share ground", #stacked == 0, table.concat(stacked, "; "))
end

-- How far a group spawned into a running mission may be from where the scenario
-- puts it. A block is 32 elmos out from its own centre, and a group is woken as
-- it is spawned, so its units are already walking by the time anything can read
-- them: 30 frames of a Peewee is another 84. What is left over is the margin, and
-- it is still an order of magnitude short of the map corner a clamp would use.
local SPAWNED_BLOCK_SLACK = 192

--- A group the mission spawned mid-run is the block the scenario asks for,
-- within that slack.
local function checkSpawnedBlock(id)
	local group
	for _, entry in ipairs(state().mission.groups or {}) do
		if entry.id == id then
			group = entry
		end
	end

	local strays = {}
	for _, unitID in ipairs(state().groups.units(id)) do
		local x, _, z = Spring.GetUnitPosition(unitID)
		if math.abs(x - group.pos.x) > SPAWNED_BLOCK_SLACK
			or math.abs(z - group.pos.z) > SPAWNED_BLOCK_SLACK then
			strays[#strays + 1] = string.format("%d,%d", x, z)
		end
	end
	check("and put them where the scenario says, not where the engine could fit them",
		#strays == 0, string.format("%s from %d,%d",
			table.concat(strays, "; "), group.pos.x, group.pos.z))
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
		-- The frame the runtime places what the scenario asks for, and the last
		-- one on which nothing has moved yet.
		{ frame = 1, run = checkPlacement },
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
		-- Inside the pass, and a long way from both the scout in the middle of it
		-- and the raiders waiting behind him, so nothing the trigger spawns lands
		-- on top of the unit that sprang it.
		{ frame = 30, run = function()
			playerUnit("armpw", 1900, 1900)
		end },
		{ frame = 60, run = function()
			check("walking a unit into the zone fires the trigger", armed("spring-ambush") == false)
			local raiders = state().groups.units("raiders")
			check("its spawn_group put the whole group on the map", #raiders == 4, #raiders)
			check("the group's units are the def and team the scenario names",
				defOf(raiders[1]) == "armpw" and Spring.GetUnitTeam(raiders[1]) == 1)
			checkSpawnedBlock("raiders")
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
-- what a capture reveals. It is also the fixture that unlocks something, so it
-- is where the other end of a restriction is read.
--
-- The def the mission denies from the start and its `unlock` trigger frees for
-- the player. The same builder is told to put it up twice at the same site, once
-- before the trigger fires and once after: one order, two answers, and the only
-- thing between them is the unlock.
local UNLOCKED_BUILDING = "armestor"

-- Something the same builder builds that the mission says nothing about. Without
-- it a menu that is greyed all over reads as the restriction working.
local GARRISON_ALLOWED = "armsolar"

-- Where the probe builds. Well clear of the depot zone on (2000, 2000) and of
-- everything else the mission and the steps below put on the map. The site is a
-- search, so its reach is what keeps it out of them.
local GARRISON_X, GARRISON_Z, GARRISON_AREA = 1200, 1200, 400

local garrisonBuilder, garrisonX, garrisonY, garrisonZ

-- The builder's menu before anything unlocked anything, so the menu after the
-- unlock can be held against it icon for icon.
local garrisonMenu

-- The units the mission gifts away, read off the group before it lets go of
-- them, so the release below can be told from the group being wiped.
local garrisonGifted = {}

plans.garrison = {
	-- The reveal the capture starts runs for 30 seconds, so the fog cannot come
	-- back before frame 1050 or so.
	deadline = 1300,
	steps = {
		{ frame = 1, run = checkPlacement },
		{ frame = 5, run = function()
			check("a trigger the scenario disabled starts disabled", armed("unlock") == false)
			check("a var starts at the number its author gave it",
				rules("coilbox_mission_var_garrisonBuilt") == 0)
			-- The two vars the steps below read through rather than around. A
			-- fixture that stopped declaring them would leave every claim about
			-- issue #808 passing on a pair of zeroes.
			check("the vars a trigger reads its numbers out of are declared",
				rules("coilbox_mission_var_quota") == 1
					and rules("coilbox_mission_var_bonus") == 5,
				tostring(rules("coilbox_mission_var_quota")) .. "/"
					.. tostring(rules("coilbox_mission_var_bonus")))
			check("an objective starts active",
				rules("coilbox_mission_objective_defend-garrison") == ACTIVE)
			check("a building actor is on the map", defOf(state().units.outpost) == "armestor",
				defOf(state().units.outpost))
			check("a team's startUnits are on its start position", owns(1, "armck") == 1, owns(1, "armck"))
			check("what the runtime placed does not count as something the team built",
				armed("built-outpost") == true)
			-- Both unlock steps below claim something about a mission that forbids
			-- the def its unlock trigger frees. A fixture that stopped forbidding it
			-- would leave them passing on nothing.
			local buildable = (state().mission.restrictions or {}).buildable
			check("the scenario forbids the def its unlock trigger frees",
				buildable ~= nil and buildable.units[1] == UNLOCKED_BUILDING)
			-- The builder the scenario placed for the garrison itself, inside the
			-- start window. A restriction that only reached what a player built
			-- afterwards would leave this one's menu untouched.
			local theirs = unitOf(1, "armck")
			check("a builder the scenario placed itself has the locked icon greyed",
				theirs ~= nil and iconGreyed(theirs, UNLOCKED_BUILDING) == true,
				tostring(theirs) .. " " .. buildMenu(theirs or 0))
		end },
		-- The locked def, ordered before anything has unlocked it. The site is found
		-- rather than named, because the harness runs on whatever map the machine has
		-- and an order at a site the engine will not take is refused before the
		-- runtime is asked about it. The builder is put beside the site so the build
		-- starts where it stands rather than being walked to.
		{ frame = 6, run = function()
			-- The player's bank. The scenario says nothing about the player's team, so
			-- it opens on whatever the game gives it, and a builder that cannot afford
			-- what it was told to build waits at the site rather than starting, which
			-- is the answer these steps have to tell a refusal apart from.
			Spring.SetTeamResource(0, "metal", 1000)
			Spring.SetTeamResource(0, "energy", 1000)
			garrisonX, garrisonY, garrisonZ =
				buildSite(UNLOCKED_BUILDING, GARRISON_X, GARRISON_Z, GARRISON_AREA)
			check("the map has a site for the building the mission locks", garrisonX ~= nil)
			garrisonBuilder = Spring.CreateUnit("armck", garrisonX + 64,
				Spring.GetGroundHeight(garrisonX + 64, garrisonZ), garrisonZ, 0, 0)
			buildOrder(garrisonBuilder, UNLOCKED_BUILDING, garrisonX, garrisonY, garrisonZ)
			-- What issue #832 is about. The order above is dropped by
			-- AllowUnitCreation, which is the last possible moment and tells the
			-- player nothing. The icon is what tells them before they click.
			garrisonMenu = menuOrder(garrisonBuilder)
			check("the icon for a def the mission locks is greyed on a builder",
				iconGreyed(garrisonBuilder, UNLOCKED_BUILDING) == true,
				buildMenu(garrisonBuilder))
			check("while the icon for one it says nothing about is not",
				iconGreyed(garrisonBuilder, GARRISON_ALLOWED) == false,
				tostring(iconGreyed(garrisonBuilder, GARRISON_ALLOWED)))
		end },
		{ frame = 25, run = function()
			local orders = Spring.GetUnitCommands(garrisonBuilder, -1)
			check("a def the mission locks is refused before anything unlocks it",
				#orders == 0, queueText(orders))
			check("so nothing goes up on a site the engine had no objection to",
				owns(0, UNLOCKED_BUILDING) == 0, owns(0, UNLOCKED_BUILDING))
			-- Issue #808, the falsifying half. The wave's condition compares
			-- garrisonBuilt against the quota var, which is 1, and the trigger
			-- engine has polled by now. A runtime that read the var as no number at
			-- all would compare against 0, which garrisonBuilt already meets, and
			-- the wave would be standing on the map here.
			check("a var compared against another var is not met before the other var is",
				#state().groups.units("reinforcements") == 0,
				#state().groups.units("reinforcements"))
		end },
		-- Spread, because three units asked for on one spot is the pile-up the
		-- placement check above exists to refuse.
		{ frame = 30, run = function()
			for i = 1, 3 do
				local x = 300 + i * 64
				Spring.CreateUnit("armpw", x, Spring.GetGroundHeight(x, 300), 300, 0, 1)
			end
		end },
		{ frame = 60, run = function()
			check("a unit count reaching its minimum fires", armed("count-check") == false)
			check("its set_var wrote the var out where a panel can read it",
				rules("coilbox_mission_var_garrisonBuilt") == 1,
				rules("coilbox_mission_var_garrisonBuilt"))
			check("its enable_trigger armed another, which then fired and spent itself",
				armed("unlock") == false)
			-- The same var arms the wave, which is the mission's repeating trigger.
			check("the repeating trigger the var armed spawned the dormant group",
				#state().groups.units("reinforcements") == 2,
				#state().groups.units("reinforcements"))
			checkSpawnedBlock("reinforcements")
			check("and stayed armed, because it repeats",
				armed("reinforcement-wave") == true)
		end },
		-- The same order again, now that the trigger above has run its unlock_unit.
		-- Same builder, same site, same def: what is different is the unlock, so what
		-- the engine does with it next is what the unlock did.
		{ frame = 65, run = function()
			buildOrder(garrisonBuilder, UNLOCKED_BUILDING, garrisonX, garrisonY, garrisonZ)
		end },
		-- And the icon the unlock freed, on a builder that was already on the map
		-- when it fired. The whole menu is read back beside it: an icon taken out
		-- and put back in the wrong place would quietly reorder a player's build
		-- menu, which is its own kind of broken.
		{ frame = 66, run = function()
			check("unlock_unit ungreys the icon on a builder already on the map",
				iconGreyed(garrisonBuilder, UNLOCKED_BUILDING) == false,
				buildMenu(garrisonBuilder))
			check("and leaves the menu the same icons in the same order it had before",
				menuOrder(garrisonBuilder) == garrisonMenu,
				menuOrder(garrisonBuilder) .. " from " .. tostring(garrisonMenu))
			-- The unlock names the player, so the garrison's own builder is still
			-- looking at a locked icon.
			local theirs = unitOf(1, "armck")
			check("while the team the unlock did not name keeps its icon greyed",
				theirs ~= nil and iconGreyed(theirs, UNLOCKED_BUILDING) == true,
				tostring(theirs) .. " " .. buildMenu(theirs or 0))
		end },
		{ frame = 90, run = function()
			Spring.CreateUnit("armestor", 400, Spring.GetGroundHeight(400, 400), 400, 0, 1)
		end },
		{ frame = 120, run = function()
			check("a unit finished after the start window is one the team built",
				armed("built-outpost") == false)
			-- The add is `{ var = "bonus" }` rather than a number, so 1 plus 5
			-- rather than 1 plus 1 is what says the runtime read the var
			-- (issue #808). A runtime that read the table as no number would leave
			-- this at 1.
			check("its add_var added what another var holds",
				rules("coilbox_mission_var_garrisonBuilt") == 6,
				rules("coilbox_mission_var_garrisonBuilt"))
			check("its disable_trigger left the other one disarmed", armed("count-check") == false)
		end },
		-- Before the capture below hands the mission's own building to the player,
		-- which would make this a count of two.
		{ frame = 140, run = function()
			check("and unlock_unit lifts that, so the same order is kept and started",
				owns(0, UNLOCKED_BUILDING) == 1, owns(0, UNLOCKED_BUILDING))
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
			-- The trigger's other action is a gift_units, from the player's team to
			-- the garrison's, and the two are not allied. This game refuses a share
			-- between enemies, so whether the units moved is a claim only a real
			-- engine settles.
			local gifted = state().groups.units("reinforcements")
			check("gifting a group leaves it holding its units", #gifted == 2, #gifted)
			local moved = 0
			for _, unitID in ipairs(gifted) do
				if Spring.GetUnitTeam(unitID) == 1 then
					moved = moved + 1
				end
			end
			check("and gift_units moved every one of them across ally lines", moved == 2, moved)
			garrisonGifted = { gifted[1], gifted[2] }
		end },
		-- Issue #812. The mission gifted the squad at three seconds and releases
		-- it at eight, which is the handover the two actions are separate for: the
		-- units are the other team's, and now the mission has stopped ordering
		-- them.
		{ frame = 260, run = function()
			check("release_group leaves the mission holding none of the group's units",
				#state().groups.units("reinforcements") == 0,
				#state().groups.units("reinforcements"))
			local standing = 0
			for _, unitID in ipairs(garrisonGifted) do
				if Spring.GetUnitIsDead(unitID) == false and Spring.GetUnitTeam(unitID) == 1 then
					standing = standing + 1
				end
			end
			check("while the units it gave away are still on the map, on the team it gave them to",
				standing == 2, standing)
		end },
		{ frame = 1250, run = function()
			check("the reveal runs out and the spotter comes off the map",
				state().reveal.spotterCount(0) == 0, state().reveal.spotterCount(0))
		end },
	},
}

-- Siege: a prefab base, a standing group, and a zone the player has to hold for
-- a minute before the mission ends. It is also the fixture that restricts
-- something, so it is where the two callins only an engine can settle are read.
--
-- The unit doing the holding, and where it was put. A hold that never completes
-- has two possible causes, the runtime's clock and a unit that wandered off, and
-- reading the position back tells them apart.
local siegeUnit, siegeX, siegeZ

-- What the mission forbids and, beside each, something it says nothing about.
-- The keep's factory builds the first pair and a construction kbot the second.
-- The allowed one is the control: without it a queue that is empty because
-- nothing was ever built reads as the restriction working. Neither of them is a
-- def the mission places, so counting what a team owns counts only these.
local FORBIDDEN_UNIT, ALLOWED_UNIT = "corthud", "corstorm"
local FORBIDDEN_BUILDING, ALLOWED_BUILDING = "armllt", "armsolar"

-- Where the probe works, both well clear of the keep: nothing in the mission is
-- in range of either, and nothing put up here stands in the zone being held.
-- The build area is a search, so its reach is what keeps it out of the keep.
local BUILD_AREA_X, BUILD_AREA_Z, BUILD_AREA = 1200, 1200, 400
local ORDERED_X, ORDERED_Z = 1000, 1000

-- How far from the builder a site may be. Its build range is 130 elmos, and a
-- site outside that is one it walks to rather than one it starts.
local BUILD_REACH = 110

local siegeBuilder, siegeOrdered

-- The yard, the second zone the siege scenario carries, and the only thing in
-- the fixtures that asks for an uncontested hold (issue #802). Well east of the
-- keep, so nothing the mission places and nothing the steps above put down is
-- ever standing in it.
local YARD_X, YARD_Z = 2700, 1900

local yardUnit, yardIntruder

-- The keep's factory, by the name the scenario gave that building. Every step
-- below that talks to it goes through here, so what the runtime records about a
-- prefab building is what the whole fixture is driven by rather than a def scan
-- that would break the moment the base held two factories (issue #878).
local function keepLab()
	return state().units["keep-lab"]
end

plans.siege = {
	-- The hold is 60 seconds and the player's unit walks in at frame 30, so the
	-- mission cannot end before frame 1830. The deadline is the slack on top.
	deadline = 2100,
	steps = {
		{ frame = 1, run = checkPlacement },
		{ frame = 5, run = function()
			check("a group the scenario does not call dormant starts on the map",
				#state().groups.units("keep-guard") == 3, #state().groups.units("keep-guard"))
			local lab = keepLab()
			check("a prefab's factory is on the map under the name the scenario gave it",
				defOf(lab) == "corlab", defOf(lab))
			local queue = lab and Spring.GetFactoryCommands(lab, -1) or {}
			check("with the queue the prefab wrote, one order per unit", #queue == 3, #queue)
			local states = lab and Spring.GetUnitStates(lab) or {}
			check("and repeating, so the queue does not empty", states["repeat"] == true,
				tostring(states["repeat"]))
			check("a prefab's other buildings are addressable too",
				defOf(state().units["keep-mex"]) == "cormex", defOf(state().units["keep-mex"]))
			check("and its rules param names the unit it became",
				rules("coilbox_mission_actor_keep-lab") == lab, rules("coilbox_mission_actor_keep-lab"))
			check("the mission has not ended", rules("coilbox_mission_over") == 0)
			check("nor has its objective", rules("coilbox_mission_objective_take-keep") == ACTIVE)
			-- Everything the restriction steps below claim is about a mission
			-- that restricts something. A fixture that quietly stopped would
			-- leave them all passing on nothing.
			local restrictions = state().mission.restrictions or {}
			check("the scenario forbids a unit def and withholds a command",
				restrictions.buildable ~= nil and #(restrictions.commands or {}) > 0)
		end },
		-- The south-east of the keep, which is the far side of the zone from the
		-- base. Balanced Annihilation's Prevent Lab Hax gadget teleports any enemy
		-- ground unit standing within a factory's own footprint out to the edge of
		-- it, every six frames, and the keep's factory is 96 elmos across: far
		-- enough away and it never applies. An aircraft is belt and braces, since
		-- the gadget skips anything that flies and a zone is a flat footprint that
		-- counts a unit whatever its altitude. Pinned by playerUnit, so nothing in
		-- the sim moves it either way.
		{ frame = 30, run = function()
			siegeUnit = playerUnit("armpeep", 2100, 2100)
			local x, _, z = Spring.GetUnitPosition(siegeUnit)
			siegeX, siegeZ = x, z
		end },
		-- Restrictions. The mission denies two unit defs and withholds one
		-- command, and neither of the callins the runtime answers those with has
		-- ever been read anywhere but the engine's source.
		--
		-- A builder first. Its sites are found rather than named, because the
		-- harness runs on whatever map the machine has and an order at a site the
		-- engine will not take is refused before the runtime is asked about it. The
		-- builder is put beside the site it is allowed, so both are inside its build
		-- range and are started where it stands rather than walked to. The forbidden
		-- one is ordered first: a builder that stands at the site retrying rather
		-- than dropping the order never reaches the second.
		{ frame = 300, run = function()
			-- The player's bank, which the scenario says nothing about and the game's
			-- own start leaves nearly empty. A builder that cannot afford what it was
			-- told to build waits at the site rather than starting, which is the
			-- answer this step is trying to tell a refusal apart from.
			Spring.SetTeamResource(0, "metal", 1000)
			Spring.SetTeamResource(0, "energy", 1000)
			local ax, ay, az = buildSite(ALLOWED_BUILDING, BUILD_AREA_X, BUILD_AREA_Z, BUILD_AREA)
			check("the map has a site for the building the mission allows", ax ~= nil)
			siegeBuilder = Spring.CreateUnit("armck", ax + 64,
				Spring.GetGroundHeight(ax + 64, az), az, 0, 0)
			local fx, fy, fz = buildSite(FORBIDDEN_BUILDING, ax + 64, az, BUILD_REACH)
			check("and one in the builder's reach for the building it forbids", fx ~= nil)
			buildOrder(siegeBuilder, FORBIDDEN_BUILDING, fx, fy, fz)
			buildOrder(siegeBuilder, ALLOWED_BUILDING, ax, ay, az)
			-- And the sign in front of the refusal, on the same builder. The order
			-- above is what actually holds; the icon is what stops the player giving
			-- it in the first place (issue #832).
			check("the icon for a building the mission forbids is greyed on a builder",
				iconGreyed(siegeBuilder, FORBIDDEN_BUILDING) == true,
				buildMenu(siegeBuilder))
			check("and the one for the building beside it is not",
				iconGreyed(siegeBuilder, ALLOWED_BUILDING) == false,
				tostring(iconGreyed(siegeBuilder, ALLOWED_BUILDING)))
		end },
		{ frame = 400, run = function()
			local orders = Spring.GetUnitCommands(siegeBuilder, -1)
			check("a builder given an order for what the mission forbids does not keep it",
				#orders == 1 and orders[1].id == -UnitDefNames[ALLOWED_BUILDING].id, queueText(orders))
			check("and nothing forbidden goes up on a site the engine had no objection to",
				owns(0, FORBIDDEN_BUILDING) == 0, owns(0, FORBIDDEN_BUILDING))
			check("while the order behind it is started",
				owns(0, ALLOWED_BUILDING) == 1, owns(0, ALLOWED_BUILDING))
		end },
		-- Then the keep's own factory. It comes with the prefab's queue and a unit
		-- already on the pad, and both have to go before the probe's pair can be
		-- what it builds next: a queued build order comes off a factory by being
		-- right-clicked rather than stopped, and a factory with something under
		-- construction starts nothing else until that is gone.
		{ frame = 420, run = function()
			local lab = keepLab()
			Spring.GiveOrderToUnit(lab, CMD.REPEAT, { 0 }, 0)
			for _, defName in ipairs({ "corak", FORBIDDEN_UNIT }) do
				-- Ctrl is twenty of them and alt takes them off the front, which
				-- between them is the whole queue.
				Spring.GiveOrderToUnit(lab, -UnitDefNames[defName].id, {},
					{ "right", "ctrl", "alt" })
			end
			local onThePad = Spring.GetUnitIsBuilding(lab)
			if onThePad then
				Spring.DestroyUnit(onThePad, false, true)
			end
		end },
		{ frame = 450, run = function()
			local lab = keepLab()
			local queue = Spring.GetFactoryCommands(lab, -1)
			check("the probe emptied the keep factory's queue", #queue == 0, queueText(queue))
			-- The keep is the garrison's, not the player's, so this is also the one
			-- place a run reads a greyed icon on a team no human is playing.
			check("a factory's icon for a unit the mission forbids is greyed too",
				iconGreyed(lab, FORBIDDEN_UNIT) == true, buildMenu(lab))
			check("and the one beside it is not",
				iconGreyed(lab, ALLOWED_UNIT) == false,
				tostring(iconGreyed(lab, ALLOWED_UNIT)))
			-- The forbidden def first, and the queue read straight back: a factory
			-- keeps an order it may not build yet, so one it has dropped is gone by
			-- the time the order behind it is given.
			Spring.GiveOrderToUnit(lab, -UnitDefNames[FORBIDDEN_UNIT].id, {}, 0)
			Spring.GiveOrderToUnit(lab, -UnitDefNames[ALLOWED_UNIT].id, {}, 0)
			queue = Spring.GetFactoryCommands(lab, -1)
			check("a factory given an order for what the mission forbids does not keep it",
				#queue == 1 and queue[1].id == -UnitDefNames[ALLOWED_UNIT].id, queueText(queue))
		end },
		{ frame = 510, run = function()
			check("and builds the order behind it rather than jamming on it",
				owns(1, ALLOWED_UNIT) == 1, owns(1, ALLOWED_UNIT))
			check("while nothing forbidden reaches the map",
				owns(1, FORBIDDEN_UNIT) == 0, owns(1, FORBIDDEN_UNIT))
		end },
		{ frame = 600, run = function()
			siegeOrdered = playerUnit("armpw", ORDERED_X, ORDERED_Z)
			-- The engine refuses a player's attack on a unit that player cannot
			-- see, and a refusal there would look exactly like the restriction
			-- working. The mission's own attack below is not held to it, because
			-- a synced order counts as coming from inside the game.
			local seen = Spring.GetUnitLosState(state().units.warlord, 0) or {}
			check("the unit the player is about to be told to attack is one the player can see",
				seen.los == true, tostring(seen.los))
			-- Two orders down the one path a headless run has for an order that
			-- is not the runtime's own: the withheld one, then one the mission
			-- says nothing about.
			SendToUnsynced("coilbox_harness_player_order", siegeOrdered, CMD.ATTACK,
				state().units.warlord)
			SendToUnsynced("coilbox_harness_player_order", siegeOrdered, CMD.MOVE,
				ORDERED_X, Spring.GetGroundHeight(ORDERED_X, ORDERED_Z - 500), ORDERED_Z - 500)
		end },
		{ frame = 660, run = function()
			local orders = Spring.GetUnitCommands(siegeOrdered, -1)
			check("a command the mission withholds never reaches a unit the player orders",
				#orders == 1 and orders[1].id == CMD.MOVE, queueText(orders))
			Spring.GiveOrderToUnit(siegeOrdered, CMD.ATTACK, { state().units.warlord }, 0)
		end },
		{ frame = 665, run = function()
			local orders = Spring.GetUnitCommands(siegeOrdered, -1)
			check("and the same command from the runtime itself is let through",
				#orders == 1 and orders[1].id == CMD.ATTACK, queueText(orders))
		end },
		-- What issue #878 was about: a trigger that fires on a prefab building
		-- dying. The lab is done being the restriction fixture by now, and the
		-- trigger's set_var is what says the runtime knew which unit it was.
		{ frame = 700, run = function()
			check("nothing has fired the trigger watching the keep's factory",
				armed("lab-down") == true)
			check("and its var is still where the scenario set it",
				rules("coilbox_mission_var_labDown") == 0,
				rules("coilbox_mission_var_labDown"))
			Spring.DestroyUnit(keepLab(), false, true)
		end },
		{ frame = 705, run = function()
			check("killing a prefab building fires the trigger that names it",
				armed("lab-down") == false)
			check("and its set_var wrote the var out",
				rules("coilbox_mission_var_labDown") == 1,
				rules("coilbox_mission_var_labDown"))
			check("while the building it named is no longer on the map",
				keepLab() == nil, keepLab())
			check("and the other building in the base is untouched",
				defOf(state().units["keep-mex"]) == "cormex")
		end },
		-- Issue #802: the same zone clock, asked whether the team holding it is
		-- the only one there. The player's unit walks into the yard and an enemy
		-- walks in beside it, and the hold is ten seconds.
		{ frame = 750, run = function()
			check("nothing has held the yard yet", rules("coilbox_mission_var_yardHeld") == 0,
				rules("coilbox_mission_var_yardHeld"))
			yardUnit = playerUnit("armpeep", YARD_X, YARD_Z)
			yardIntruder = pinnedUnit("corak", 1, YARD_X + 40, YARD_Z + 40)
			check("both are standing in the yard",
				yardUnit ~= nil and yardIntruder ~= nil)
		end },
		{ frame = 1150, run = function()
			-- Four hundred frames in, on a ten second hold. A runtime that read
			-- past `uncontested` would have settled this at frame 1050.
			check("a hold an enemy is standing in is no hold at all",
				rules("coilbox_mission_var_yardHeld") == 0,
				rules("coilbox_mission_var_yardHeld"))
			check("and the unit doing the holding has not wandered off",
				Spring.GetUnitIsDead(yardUnit) == false)
			Spring.DestroyUnit(yardIntruder, false, true)
		end },
		{ frame = 1300, run = function()
			check("clearing them out does not hand the hold straight back",
				rules("coilbox_mission_var_yardHeld") == 0,
				rules("coilbox_mission_var_yardHeld"))
		end },
		{ frame = 1560, run = function()
			check("holding it alone for the whole ten seconds does",
				rules("coilbox_mission_var_yardHeld") == 1,
				rules("coilbox_mission_var_yardHeld"))
		end },
		{ frame = 1500, run = function()
			check("a hold short of the minute settles nothing",
				rules("coilbox_mission_objective_take-keep") == ACTIVE)
			check("and does not end the mission", rules("coilbox_mission_over") == 0)
		end },
		{ frame = 1980, run = function()
			local x, _, z = Spring.GetUnitPosition(siegeUnit)
			check("the unit the probe stood in the zone is still where it put it",
				x == siegeX and z == siegeZ,
				tostring(x) .. "," .. tostring(z) .. " from "
					.. tostring(siegeX) .. "," .. tostring(siegeZ))
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

-- Outbreak: the same scenario played at one difficulty or another (issue #2164).
--
-- Everything asserted here is asserted against the level this run was given
-- rather than against a fixed answer, so one plan covers all three and the
-- harness proves each of them by being run again with a different modoption.
--
-- The claim only a real engine can settle is that the level survives the trip:
-- coilbox writes a word into a start script, the engine parses that script, and
-- `Spring.GetModOptions()` hands the runtime whatever it made of it. Everything
-- after that is arithmetic the luajit suite already proves.
plans.outbreak = {
	deadline = 60,
	steps = {
		{ frame = 1, run = checkPlacement },
		{ frame = 5, run = function()
			local level = state().difficulty
			local asked = Spring.GetModOptions().coilbox_difficulty or "normal"
			check("the runtime plays at the difficulty the start script asked for",
				level == asked, tostring(level) .. " for " .. tostring(asked))

			local hard = level == "hard"
			check("a hard-only actor is on the map only on hard",
				(state().units.warlord ~= nil) == hard, tostring(defOf(state().units.warlord)))
			check("an up-to-normal base is there at every level below hard",
				(state().units["spare-gun"] ~= nil) == not hard)
			check("a base bounded at both ends is absent only outside them",
				(state().units["raider-gun"] ~= nil) == (level ~= "easy"))
			check("a hard-only trigger is armed only on hard",
				armed("second-wave-arrives") == hard)
			check("an easy-only trigger only on easy", armed("mercy") == (level == "easy"))
			check("a trigger with no range is armed either way", armed("first-wave") == true)
		end },
		-- Standing in for the trigger that would send the wave, because that one
		-- waits two minutes and this run is over in two seconds. A group the
		-- difficulty leaves out has to answer this with nothing on the map and
		-- without the runtime calling it an error, which is what the harness's own
		-- error count is checking at the same time.
		{ frame = 10, run = function()
			state().groups.spawn("second-wave")
		end },
		{ frame = 20, run = function()
			local wave = state().groups.units("second-wave")
			check("spawn_group puts a hard-only group on the map only on hard",
				#wave == (state().difficulty == "hard" and 4 or 0), #wave)
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
