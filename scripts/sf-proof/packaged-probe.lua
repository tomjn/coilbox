-- The packaged-archive probe (issue #2160).
--
-- scripts/mission-sf-packaged.sh puts this inside the Splinter Faction copy it
-- packages, so it travels in the same .sd7 as the runtime and the mission. That
-- is the whole difference from scripts/sf-proof/probe.lua, which rides in a
-- scratch mutator: this run has no mutator at all, because a mutator is the
-- route the packaged game is supposed to have stopped needing.
--
-- It is deliberately smaller than probe.lua. The adoption contract is settled
-- there against a loose game, and repeating it here would prove the same thing
-- twice. What only this run can settle is that the runtime read
-- missions/<folder>/mission.lua out of a packaged archive and played it.
--
-- It also does the two jobs a headless run needs somebody to do: ask for the
-- fastest speed the local server will give, and quit when the plan is done.
--
-- Every check is one line of stdout, `HARNESS ok` or `HARNESS fail`, and every
-- reading the script quotes is `HARNESS note`.
--
-- `@MISSION_FOLDER@` is filled in by the script, so this file is not valid Lua
-- until it has been copied.

function gadget:GetInfo()
	return {
		name = "Coilbox packaged mission probe",
		desc = "Reads what a mission shipped inside a packaged game did",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime (1000), which is itself behind Splinter Faction's own
		-- gadgets, so every reading is of a frame everyone else has finished with.
		layer = 3000,
		enabled = true,
	}
end

local MISSION_FOLDER = "@MISSION_FOLDER@"

if not gadgetHandler:IsSyncedCode() then
	-- A headless run is paced by the local server at the speed a player would
	-- watch it. The checks are about frames, so ask for the fastest it will give.
	function gadget:Initialize()
		Spring.SendCommands("setspeed 20")
	end

	function gadget:RecvFromSynced(message)
		if message == "coilbox_packaged_probe_done" then
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

--- What a game rules param holds, or nil.
local function rules(name)
	local value = Spring.GetGameRulesParam(name)
	return value
end

--- How many units of a def a team owns. -1 for a def this game does not have.
local function owns(team, defName)
	local def = UnitDefNames[defName]
	if not def then
		return -1
	end
	return Spring.GetTeamUnitDefCount(team, def.id)
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

local ACTIVE, COMPLETE = 0, 1
local VICTORY_FRAME = 90 * 30 -- the mission's time_elapsed trigger, in frames
local DEADLINE = VICTORY_FRAME + 150

local steps = {
	-- The runtime only reaches GG.CoilboxMission once it has loaded the compiled
	-- mission, and the only copy of that file in this run is inside the .sd7. So
	-- this is the claim the whole script exists for.
	{ frame = 2, run = function()
		check("the runtime loaded a mission out of the packaged archive",
			GG.CoilboxMission ~= nil)
		note("armies at frame 2, player [" .. inventory(PLAYER) .. "] enemy ["
			.. inventory(ENEMY) .. "]")
	end },

	-- Content only the packaged mission.lua names. A runtime that loaded but read
	-- an empty mission would still have set GG.CoilboxMission above.
	{ frame = 60, run = function()
		check("the mission placed the player's squad",
			owns(PLAYER, "fedengineer_up1") == 1, owns(PLAYER, "fedengineer_up1"))
		check("and the enemy actor it names",
			owns(ENEMY, "lozengineer") == 1, owns(ENEMY, "lozengineer"))
		check("and declared its objective",
			rules("coilbox_mission_objective_hold-out") == ACTIVE,
			tostring(rules("coilbox_mission_objective_hold-out")))
	end },

	{ frame = VICTORY_FRAME - 30, run = function()
		check("the game's own game_end left the ending to the mission",
			not Spring.IsGameOver(), "Spring.IsGameOver() is true")
		check("a mission short of its timer has not ended",
			rules("coilbox_mission_over") == 0, rules("coilbox_mission_over"))
	end },

	{ frame = VICTORY_FRAME + 60, run = function()
		note("at the end, player [" .. inventory(PLAYER) .. "] enemy ["
			.. inventory(ENEMY) .. "]")
		check("the packaged mission's timer completed its objective",
			rules("coilbox_mission_objective_hold-out") == COMPLETE,
			tostring(rules("coilbox_mission_objective_hold-out")))
		check("and ended the mission", rules("coilbox_mission_over") == 1,
			tostring(rules("coilbox_mission_over")))
		check("with the player's ally team the only winner",
			rules("coilbox_mission_winners") == 1 and rules("coilbox_mission_winner_0") == 1,
			tostring(rules("coilbox_mission_winners")) .. "/"
				.. tostring(rules("coilbox_mission_winner_0")))
	end },
}

local done = false

function gadget:Initialize()
	local given = Spring.GetModOptions().coilbox_mission
	if given ~= MISSION_FOLDER then
		say("fail the probe expects the " .. MISSION_FOLDER .. " mission, got "
			.. tostring(given))
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
		SendToUnsynced("coilbox_packaged_probe_done")
	end
end
