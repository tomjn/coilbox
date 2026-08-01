-- The probe that plays "Silence the Jericho" (issue #773).
--
-- scripts/mission-sf-jericho.sh copies this into a scratch mutator that depends
-- on the SplinterFaction working copy and carries nothing else, exactly as
-- scripts/sf-proof/probe.lua does for the adoption proof. The difference is what
-- it is proving. The adoption proof asks whether a real game can host the
-- runtime at all. This one asks whether a mission an author built in the
-- Scenario Builder, on that game, actually plays and is won.
--
-- Nobody is at the keyboard in a headless run, so the probe is the player. It
-- walks a unit onto the ridge, walks it into the outpost, holds the battery yard
-- and destroys the two structures the mission is about, and reads back what the
-- mission did in between. Every reading is one line of stdout: `HARNESS ok`,
-- `HARNESS fail` or `HARNESS note`.

function gadget:GetInfo()
	return {
		name = "Coilbox Jericho mission probe",
		desc = "Plays Silence the Jericho on SplinterFaction and reads the result",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime (1000) and behind SplinterFaction's own gadgets, so
		-- every reading is of a frame everyone else has finished with.
		layer = 3000,
		enabled = true,
	}
end

local MISSION_ID = Spring.GetModOptions().coilbox_mission

if not gadgetHandler:IsSyncedCode() then
	-- A headless run is paced by the local server at the speed a player would
	-- watch it. The checks are about frames, so ask for the fastest it will give.
	function gadget:Initialize()
		Spring.SendCommands("setspeed 20")
	end

	-- The runtime hands its radio messages, camera moves and map markers to the
	-- unsynced half, where its own widget would draw them. A headless run has no
	-- LuaUI, so this is the only place their firing can be seen at all: whether
	-- the panel then draws anything is issue #850 and cannot be settled here.
	function gadget:RecvFromSynced(message, a, b, c)
		if message == "coilbox_mission_dialogue" then
			Spring.Echo("HARNESS said " .. tostring(a))
		elseif message == "coilbox_mission_marker" then
			Spring.Echo("HARNESS marked " .. tostring(a) .. "," .. tostring(b)
				.. " " .. tostring(c))
		elseif message == "coilbox_jericho_probe_done" then
			Spring.Quit()
		end
	end

	return
end

local PLAYER, ENEMY = 0, 1

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

local function note(line)
	say("note " .. line)
end

--- How many units of a def a team owns. -1 for a def this game does not have,
-- which is a mission naming a unit that is not there rather than a count of nil.
local function owns(team, defName)
	local def = UnitDefNames[defName]
	if not def then
		return -1
	end
	return Spring.GetTeamUnitDefCount(team, def.id)
end

local function rules(name)
	local value = Spring.GetGameRulesParam(name)
	return value
end

--- Every unit a team owns, by def name, sorted, as a readable line.
local function inventory(team)
	local counts, names = {}, {}
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		local defID = Spring.GetUnitDefID(unitID)
		local name = (defID and UnitDefs[defID] and UnitDefs[defID].name) or "?"
		if not counts[name] then
			names[#names + 1] = name
		end
		counts[name] = (counts[name] or 0) + 1
	end
	table.sort(names)
	local parts = {}
	for _, name in ipairs(names) do
		parts[#parts + 1] = name .. "=" .. counts[name]
	end
	return #parts > 0 and table.concat(parts, " ") or "nothing"
end

--- The unit an actor currently is, through the rules param the runtime writes.
-- 0 or nil is an actor that has died or never spawned.
local function actorUnit(id)
	local unitID = rules("coilbox_mission_actor_" .. id)
	if not unitID or unitID == 0 then
		return nil
	end
	return unitID
end

local function objective(id)
	return rules("coilbox_mission_objective_" .. id)
end

local ACTIVE, COMPLETE = 0, 1

--------------------------------------------------------------------------------
-- The scenario, by the names the author gave it.
--
-- The zone centres are the compiled mission's own numbers. They are written out
-- rather than read back from GG.CoilboxMission so that a mission edited under
-- this script fails loudly here rather than quietly walking the unit nowhere.
--------------------------------------------------------------------------------

local JERICHO = "6e0f3ff8-b197-4c06-8e4d-4fb2af72b0d6"
local EXTRACTOR = "cb5fea04-61a1-4d06-a33b-5bdc1964498a"

local RIDGE = { x = 2862, z = 3184 } -- centre of the Ridge box
local YARD = { x = 4706, z = 1714 } -- centre of the Battery yard circle,
-- which is also inside the Perimeter box, so one move trips both.

--- One of the player's A.K.s, the unit the probe walks about.
local scout = nil

local function findScout()
	local def = UnitDefNames["fedak"]
	if not def then
		return nil
	end
	for _, unitID in ipairs(Spring.GetTeamUnits(PLAYER) or {}) do
		if Spring.GetUnitDefID(unitID) == def.id then
			return unitID
		end
	end
	return nil
end

--- Put the scout on a point. A headless run has nobody to give move orders, so
-- the probe stands in for the player's hand rather than for their pathfinding.
local function moveScout(to, what)
	if not scout or not Spring.ValidUnitID(scout) then
		scout = findScout()
	end
	if not scout then
		say("fail the player has no A.K. left to walk into " .. what)
		return false
	end
	local y = Spring.GetGroundHeight(to.x, to.z)
	Spring.SetUnitPosition(scout, to.x, y, to.z)
	note("walked an A.K. into the " .. what)
	return true
end

--- Keep the scout standing. The outpost shoots back, and the mission asks the
-- player to hold the yard for ten seconds, which is a thing a player does by
-- bringing enough units rather than one the probe can simulate with one.
local function holdScout()
	if not scout or not Spring.ValidUnitID(scout) then
		return
	end
	local _, maxHealth = Spring.GetUnitHealth(scout)
	if maxHealth then
		Spring.SetUnitHealth(scout, maxHealth)
	end
	local y = Spring.GetGroundHeight(YARD.x, YARD.z)
	Spring.SetUnitPosition(scout, YARD.x, y, YARD.z)
end

--- Whether a group is running orders rather than standing on hold position.
local function hasOrders(team, defName)
	local def = UnitDefNames[defName]
	if not def then
		return false
	end
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		if Spring.GetUnitDefID(unitID) == def.id then
			local queue = Spring.GetUnitCommands(unitID, 8) or {}
			return #queue > 0
		end
	end
	return false
end

local HOLD_FROM, HOLD_TO = 150, 480

local steps = {
	{ frame = 2, run = function()
		local state = GG.CoilboxMission
		check("the vendored runtime published the mission", state ~= nil)
		check("and it is the mission the modoption named",
			state and state.id == MISSION_ID, state and state.id)

		note("at frame 2, player [" .. inventory(PLAYER) .. "]")
		note("at frame 2, enemy [" .. inventory(ENEMY) .. "]")

		-- The limited start force, as a group rather than as startUnits, because
		-- the editor has no way to write a scenario's `teams` block (issue #899).
		check("the mission placed the player's strike team, three A.K.s",
			owns(PLAYER, "fedak") == 3, owns(PLAYER, "fedak"))
		check("and its one Lifter", owns(PLAYER, "fedengineer") == 1,
			owns(PLAYER, "fedengineer"))

		-- The prefab enemy base.
		check("the prefab put down the outpost's factory",
			owns(ENEMY, "f2landfac") == 1, owns(ENEMY, "f2landfac"))
		check("its power", owns(ENEMY, "fusionpowerplant") == 1,
			owns(ENEMY, "fusionpowerplant"))
		check("its storage", owns(ENEMY, "mediumstorage") == 1,
			owns(ENEMY, "mediumstorage"))
		check("and both its Razors", owns(ENEMY, "lozrazor") == 2,
			owns(ENEMY, "lozrazor"))

		-- The two structures the mission is about, as named actors.
		check("the Jericho battery is on the map", actorUnit(JERICHO) ~= nil)
		check("and the outpost extractor", actorUnit(EXTRACTOR) ~= nil)

		-- Contract item 3, read from the game's side. A scenario the editor
		-- cannot give a `teams` block declares no team, so the mission owns no
		-- start and SplinterFaction runs its own pre-game phases over it.
		note("at frame 2, the game's phase is " .. tostring(rules("phase"))
			.. " and it loaded " .. tostring(rules("spotCount")) .. " start spots")

		check("all three objectives start active",
			objective("silence-battery") == ACTIVE
				and objective("scout-ridge") == ACTIVE
				and objective("cut-supply") == ACTIVE)
		check("the alerted var starts at zero",
			rules("coilbox_mission_var_alerted") == 0,
			rules("coilbox_mission_var_alerted"))
		check("and the mission has not ended", rules("coilbox_mission_over") == 0,
			rules("coilbox_mission_over"))
	end },

	-- The `deploy` trigger has no conditions, so it fires on the trigger
	-- engine's first pass. That is how a scenario says "at the start", because
	-- the format has no other hook for it (issue #901), and it is the only way
	-- to get a patrol standing on the map asleep rather than either walking its
	-- route from frame 0 or not being there at all (issue #900).
	{ frame = 45, run = function()
		note("after deploy, enemy [" .. inventory(ENEMY) .. "]")
		check("deploy spawned the ridge patrol", owns(ENEMY, "lozflea") == 2,
			owns(ENEMY, "lozflea"))
		check("and the yard patrol", owns(ENEMY, "lozscorpion") == 2,
			owns(ENEMY, "lozscorpion"))
		check("the reserve is still dormant", owns(ENEMY, "lozroach") == 0,
			owns(ENEMY, "lozroach"))
		check("the ridge patrol is standing rather than patrolling",
			not hasOrders(ENEMY, "lozflea"))
	end },

	{ frame = 60, run = function()
		moveScout(RIDGE, "Ridge zone")
	end },

	{ frame = 120, run = function()
		check("the Ridge zone completed the scouting objective",
			objective("scout-ridge") == COMPLETE, objective("scout-ridge"))
		check("and woke the dormant ridge patrol",
			hasOrders(ENEMY, "lozflea"))
		check("the alarm has not gone off yet",
			rules("coilbox_mission_var_alerted") == 0,
			rules("coilbox_mission_var_alerted"))
	end },

	{ frame = HOLD_FROM, run = function()
		moveScout(YARD, "outpost's Battery yard")
	end },

	{ frame = 210, run = function()
		check("the Perimeter zone raised the alarm",
			rules("coilbox_mission_var_alerted") == 1,
			rules("coilbox_mission_var_alerted"))
		check("and woke the dormant yard patrol",
			hasOrders(ENEMY, "lozscorpion"))
		check("the reserve has not been scrambled yet",
			owns(ENEMY, "lozroach") == 0, owns(ENEMY, "lozroach"))
	end },

	-- The `scramble-reserve` trigger wants the player in the Battery yard for
	-- ten seconds, so this is HOLD_FROM plus 300 frames plus the tick.
	{ frame = 470, run = function()
		note("after the ten-second hold, enemy [" .. inventory(ENEMY) .. "]")
		check("holding the Battery yard scrambled the reserve",
			owns(ENEMY, "lozroach") == 3, owns(ENEMY, "lozroach"))
		check("and the reserve is running its fight orders",
			hasOrders(ENEMY, "lozroach"))
	end },

	{ frame = 500, run = function()
		local unitID = actorUnit(EXTRACTOR)
		check("the extractor is still standing before the strike", unitID ~= nil)
		if unitID then
			Spring.DestroyUnit(unitID, false, true)
			note("destroyed the outpost extractor at frame 500")
		end
	end },

	{ frame = 530, run = function()
		check("killing the extractor completed the supply objective",
			objective("cut-supply") == COMPLETE, objective("cut-supply"))
		check("but the mission is not over, because the battery still stands",
			rules("coilbox_mission_over") == 0, rules("coilbox_mission_over"))
		check("and the primary objective is still active",
			objective("silence-battery") == ACTIVE, objective("silence-battery"))
	end },

	{ frame = 560, run = function()
		local unitID = actorUnit(JERICHO)
		check("the Jericho battery is still standing before the strike",
			unitID ~= nil)
		if unitID then
			Spring.DestroyUnit(unitID, false, true)
			note("destroyed the Jericho battery at frame 560")
		end
	end },

	{ frame = 600, run = function()
		note("at the end, player [" .. inventory(PLAYER) .. "]")
		note("at the end, enemy [" .. inventory(ENEMY) .. "]")
		check("the structure kill completed the primary objective",
			objective("silence-battery") == COMPLETE,
			objective("silence-battery"))
		check("and ended the mission", rules("coilbox_mission_over") == 1,
			rules("coilbox_mission_over"))
		-- `coilbox_mission_winner_<allyTeam>` is a flag per winning ally team, so
		-- ally team 0, the one the player is on, is the only one set.
		check("with the player's ally team the only winner",
			rules("coilbox_mission_winners") == 1
				and rules("coilbox_mission_winner_0") == 1
				and rules("coilbox_mission_winner_1") == nil,
			tostring(rules("coilbox_mission_winners")) .. " winners, ally0="
				.. tostring(rules("coilbox_mission_winner_0")) .. " ally1="
				.. tostring(rules("coilbox_mission_winner_1")))
		check("the mission was not lost as well as won",
			objective("cut-supply") == COMPLETE
				and objective("scout-ridge") == COMPLETE)
	end },
}

local DEADLINE = 630
local done = false

function gadget:Initialize()
	if MISSION_ID ~= "98794cb1-b697-4b7e-a739-f565a5008b85" then
		say("fail the probe expects the Jericho mission, got " .. tostring(MISSION_ID))
	end
end

function gadget:GameFrame(frame)
	if done then
		return
	end

	if frame >= HOLD_FROM and frame <= HOLD_TO then
		holdScout()
	end

	for _, step in ipairs(steps) do
		if step.frame == frame then
			-- A raising check should not take the rest of the run with it. An
			-- engine that never quits is a hung harness rather than a failed one.
			local ok, err = pcall(step.run)
			if not ok then
				say("fail step at frame " .. frame .. ": " .. tostring(err))
			end
		end
	end

	if frame >= DEADLINE then
		done = true
		say("done")
		SendToUnsynced("coilbox_jericho_probe_done")
	end
end
