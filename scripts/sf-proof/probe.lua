-- The SplinterFaction adoption probe (issue #772).
--
-- scripts/mission-sf-proof.sh copies this into a scratch mutator that depends on
-- the SplinterFaction working copy and carries nothing else. Everything it reads
-- -- the runtime, the compiled mission, the game's own start gadget -- comes out
-- of SplinterFaction itself, so what passes here is the vendored install rather
-- than a copy the harness laid down.
--
-- That is the difference from lua/mission-runtime/tests/headless/probe.lua, which
-- proves the runtime against Balanced Annihilation out of a scratch game the
-- harness builds. This one proves the adoption contract on a real game.
--
-- Every check is one line of stdout, `HARNESS ok` or `HARNESS fail`, and every
-- reading the script quotes is `HARNESS note`.

function gadget:GetInfo()
	return {
		name = "Coilbox SF adoption probe",
		desc = "Reads what the vendored runtime did to a real game's start",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime (1000), which is itself behind SplinterFaction's own
		-- gadgets, so every reading is of a frame everyone else has finished with.
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

	function gadget:RecvFromSynced(message)
		if message == "coilbox_sf_probe_done" then
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

--- What a game rules param holds, or nil. `Spring.GetGameRulesParam` returns no
-- values at all for one nothing has set, so it is bound to a single value here.
local function rules(name)
	local value = Spring.GetGameRulesParam(name)
	return value
end

--- Every unit a team owns, by def name, sorted, as a readable line.
--
-- Read as an inventory rather than as counts of named defs, because a game's
-- start unit is not the def the scenario or the side data names. SplinterFaction
-- resolves the side's `fedcommander` to `fedcommander_up1` before it creates
-- one, and the faction a team ends up with is random when nobody chose. A check
-- naming a def would pass for the wrong reason on either.
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

--- How many units a team owns that the scenario did not put there.
--
-- The runtime places the player's one `fedengineer` and the enemy's one
-- `lozengineer`, and an anchor for each mission team a human plays. Anything
-- else is the game's own start arriving despite `noCommander`.
local function unplaced(team, placed)
	local extra = 0
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		local defID = Spring.GetUnitDefID(unitID)
		local name = defID and UnitDefs[defID] and UnitDefs[defID].name
		local gameOver = GG.CoilboxMission and GG.CoilboxMission.gameOver
		if name ~= placed and not (gameOver and gameOver.isAnchor(unitID)) then
			extra = extra + 1
		end
	end
	return extra
end

local function armies()
	return "player [" .. inventory(PLAYER) .. "] enemy [" .. inventory(ENEMY) .. "]"
end

local ACTIVE, COMPLETE = 0, 1

--------------------------------------------------------------------------------
-- The plan.
--
-- SplinterFaction's own game_spawn.lua does not spawn at GameStart. It runs a
-- faction-choice phase with a 900-frame deadline and then, when the map has
-- start spots, a placement phase with another 900, and only then calls
-- Spring.CreateUnit. So the frames below straddle both deadlines: frame 2 is
-- inside the window the runtime documents its suppression over, and 1000 and
-- 1900 are after each of the game's.
--------------------------------------------------------------------------------

local VICTORY_FRAME = 90 * 30 -- the mission's time_elapsed trigger, in frames
local DEADLINE = VICTORY_FRAME + 150

local steps = {
	{ frame = 2, run = function()
		local state = GG.CoilboxMission
		check("the vendored runtime published its mission", state ~= nil)
		check("and it is the mission the modoption named",
			state and state.id == MISSION_ID, state and state.id)
		check("the runtime read its own version marker out of the game",
			state and state.runtime and state.runtime.version == 1,
			state and state.runtime and state.runtime.version)

		check("the runtime placed the player's startUnits",
			owns(PLAYER, "fedengineer") == 1, owns(PLAYER, "fedengineer"))
		check("and the scenario's actor for the enemy",
			owns(ENEMY, "lozengineer") == 1, owns(ENEMY, "lozengineer"))

		note("at frame 2, " .. armies())
		check("inside the suppression window the player owns only what the scenario placed",
			unplaced(PLAYER, "fedengineer") == 0, unplaced(PLAYER, "fedengineer"))
		check("and so does the enemy",
			unplaced(ENEMY, "lozengineer") == 0, unplaced(ENEMY, "lozengineer"))

		check("the mission's objective starts active",
			rules("coilbox_mission_objective_hold-out") == ACTIVE,
			rules("coilbox_mission_objective_hold-out"))
		check("and the mission has not ended", rules("coilbox_mission_over") == 0,
			rules("coilbox_mission_over"))
	end },

	-- The bank is read on the frame after the runtime sets it. SplinterFaction's
	-- own SetStartResources hands out 1000 of each at GameStart, so the number
	-- here is the scenario's only because the runtime overwrote it. Later frames
	-- would be reading whatever the team has since earned.
	{ frame = 2, run = function()
		local metal = Spring.GetTeamResources(PLAYER, "metal")
		local energy = Spring.GetTeamResources(PLAYER, "energy")
		note("the player's bank is metal=" .. tostring(metal) .. " energy=" .. tostring(energy))
		check("the player's bank is the scenario's number rather than the game's 1000",
			metal ~= nil and metal >= 750 and metal < 760, metal)
	end },

	-- After SplinterFaction's faction-choice deadline.
	{ frame = 1000, run = function()
		note("at frame 1000, past the game's 900-frame faction deadline, " .. armies())
	end },

	-- After its placement deadline, which is the frame it creates start units on.
	{ frame = 1900, run = function()
		note("at frame 1900, past the game's placement deadline, " .. armies())
		check("the game's own start is still suppressed for the player",
			unplaced(PLAYER, "fedengineer") == 0, unplaced(PLAYER, "fedengineer"))
		check("and for the enemy",
			unplaced(ENEMY, "lozengineer") == 0, unplaced(ENEMY, "lozengineer"))
	end },

	-- The other half of the adoption contract. SplinterFaction's game_end.lua
	-- hands the win to the last ally team standing, and a mission where the
	-- player wipes the enemy out before its own ending is the ordinary case. So
	-- the enemy is wiped out here, 700 frames before the mission's timer, and the
	-- two frames below ask who got to decide the mission was over.
	{ frame = 2000, run = function()
		local wiped = 0
		for _, unitID in ipairs(Spring.GetTeamUnits(ENEMY) or {}) do
			Spring.DestroyUnit(unitID, false, true)
			wiped = wiped + 1
		end
		note("wiped the enemy out at frame 2000, " .. wiped .. " units")
	end },

	{ frame = VICTORY_FRAME - 30, run = function()
		note("before the mission's own ending, Spring.IsGameOver()="
			.. tostring(Spring.IsGameOver()) .. " coilbox_mission_over="
			.. tostring(rules("coilbox_mission_over")))
		-- This is the guard, read from the outside. Without one in
		-- LuaRules/Gadgets/game_end.lua the game has already called
		-- Spring.GameOver by now and the mission never reaches its own ending.
		check("the game's own game_end left the ending to the mission",
			not Spring.IsGameOver(), "Spring.IsGameOver() is true")
		check("a mission short of its timer has not ended",
			rules("coilbox_mission_over") == 0, rules("coilbox_mission_over"))
	end },

	{ frame = VICTORY_FRAME + 60, run = function()
		note("at the end, " .. armies())
		check("the game's own start stayed suppressed for the whole mission, player",
			unplaced(PLAYER, "fedengineer") == 0, unplaced(PLAYER, "fedengineer"))
		check("the game's own start stayed suppressed for the whole mission, enemy",
			unplaced(ENEMY, "lozengineer") == 0, unplaced(ENEMY, "lozengineer"))

		check("the timer completed the mission's objective",
			rules("coilbox_mission_objective_hold-out") == COMPLETE,
			rules("coilbox_mission_objective_hold-out"))
		check("and ended the mission", rules("coilbox_mission_over") == 1,
			rules("coilbox_mission_over"))
		check("with the player's ally team the only winner",
			rules("coilbox_mission_winners") == 1 and rules("coilbox_mission_winner_0") == 1,
			tostring(rules("coilbox_mission_winners")) .. "/"
				.. tostring(rules("coilbox_mission_winner_0")))
	end },
}

local done = false

function gadget:Initialize()
	if MISSION_ID ~= "splinter" then
		say("fail the probe expects the splinter mission, got " .. tostring(MISSION_ID))
	end
end

function gadget:GameFrame(frame)
	if done then
		return
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
		SendToUnsynced("coilbox_sf_probe_done")
	end
end
