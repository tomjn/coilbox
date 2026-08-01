-- The SplinterFaction extension probe (issue #776).
--
-- scripts/mission-sf-extension.sh copies this into a scratch mutator that
-- depends on the SplinterFaction working copy and carries nothing else.
-- Everything it reads comes out of that game: the runtime, the compiled mission,
-- the declaration, the handler, and the research ledger the handler drives.
--
-- What it settles is dispatch. A trigger names a type coilbox has never heard
-- of, and the game's own code runs, with the parameters the mission wrote and
-- the team resolved to an engine team number. The reading it quotes is Splinter
-- Faction's own researchPoints team rules param, which nothing in coilbox can
-- write.
--
-- Every check is one line of stdout, `HARNESS ok` or `HARNESS fail`, and every
-- reading the script quotes is `HARNESS note`.

function gadget:GetInfo()
	return {
		name = "Coilbox SF extension probe",
		desc = "Reads what a game's own condition and action types did",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime (1000) and behind the game's own gadgets, so every
		-- reading is of a frame everyone else has finished with.
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
		if message == "coilbox_sf_extension_done" then
			Spring.Quit()
		end
	end

	return
end

local PLAYER = 0

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

--- The game's own reading of a team's research points, through the rules param
-- its ledger mirrors the balance into. Read this way rather than through
-- GG.Research so the number quoted is the one the rest of the game sees.
local function research(team)
	return Spring.GetTeamRulesParam(team, "researchPoints")
end

local function rules(name)
	local value = Spring.GetGameRulesParam(name)
	return value
end

--- Whether the runtime registered a type, by name, from what it published.
local function registered(list, wanted)
	local state = GG.CoilboxMission
	for _, name in ipairs(state and state.extensions and state.extensions[list] or {}) do
		if name == wanted then
			return true
		end
	end
	return false
end

local ACTIVE, COMPLETE = 0, 1

--------------------------------------------------------------------------------
-- The plan.
--
-- The mission grants 500 research points two seconds in, on the runtime's own
-- time_elapsed, and completes its objective once the game's ledger reads above
-- 400. The ledger pays every team one point a second on its own, so frame 2 is
-- read before the grant can be confused with that drift.
--------------------------------------------------------------------------------

local GRANT_FRAME = 2 * 30
local DEADLINE = GRANT_FRAME + 150

local baseline

local steps = {
	{ frame = 2, run = function()
		local state = GG.CoilboxMission
		check("the vendored runtime published its mission", state ~= nil)
		check("and it is the mission the modoption named",
			state and state.id == MISSION_ID, state and state.id)

		check("the game's declared condition is registered",
			registered("conditions", "sf_research_above"))
		check("and its declared action", registered("actions", "sf_grant_research"))

		baseline = research(PLAYER)
		note("at frame 2 the player's research points read " .. tostring(baseline))
		check("the game's own research ledger is running", baseline ~= nil)
		check("the mission's objective starts active",
			rules("coilbox_mission_objective_funded") == ACTIVE,
			rules("coilbox_mission_objective_funded"))
	end },

	-- After the grant, and after the polled tick that follows it.
	{ frame = GRANT_FRAME + 30, run = function()
		local now = research(PLAYER)
		note("at frame " .. (GRANT_FRAME + 30) .. " they read " .. tostring(now))
		check("the mission's action reached the game's own ledger",
			now ~= nil and baseline ~= nil and now - baseline >= 500,
			tostring(baseline) .. " -> " .. tostring(now))
		check("and the game's own condition saw the balance it moved",
			rules("coilbox_mission_objective_funded") == COMPLETE,
			rules("coilbox_mission_objective_funded"))
	end },

	-- The boundary, read from the outside. missions/extensions.lua also declares
	-- time_elapsed, which the runtime owns, and the handler implements it as a
	-- condition that never holds and leaves a mark. So a run where the extension
	-- had won is a run where the grant never happened and the mark is set.
	{ frame = DEADLINE - 30, run = function()
		check("an extension may not redefine a type the runtime owns",
			rules("sf_extension_hijacked") == nil, rules("sf_extension_hijacked"))
		check("so the type it tried to take is not one it registered",
			not registered("conditions", "time_elapsed"))
		check("and the runtime's own version is what the mission ran",
			rules("coilbox_mission_objective_funded") == COMPLETE,
			rules("coilbox_mission_objective_funded"))
	end },
}

local done = false

function gadget:Initialize()
	if MISSION_ID ~= "extension" then
		say("fail the probe expects the extension mission, got " .. tostring(MISSION_ID))
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
		SendToUnsynced("coilbox_sf_extension_done")
	end
end
