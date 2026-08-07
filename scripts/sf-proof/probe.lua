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
--
-- `@RUNTIME_VERSION@` is filled in by the script, so this file is not valid Lua
-- until it has been copied.

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
-- The version the script installed, substituted in on the way past. Written as a
-- literal here it went stale the first time the runtime's version was bumped,
-- and the check passed anyway because the game was still holding the old runtime
-- (issue #934).
local RUNTIME_VERSION = @RUNTIME_VERSION@

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

--- A unit of a def a team owns, or nil.
local function unitOf(team, defName)
	local def = UnitDefNames[defName]
	for _, unitID in ipairs(Spring.GetTeamUnits(team) or {}) do
		if def and Spring.GetUnitDefID(unitID) == def.id then
			return unitID
		end
	end
end

--- Whether one def's icon is greyed on a unit, or nil when the unit has no icon
-- for that def at all. Nil rather than false on purpose: a check that wanted a
-- greyed icon and found no icon is not a check that passed.
--
-- Read through Spring.GetUnitCmdDescs, which is what the engine's own build menu
-- is drawn from, so this is the list a player would be looking at.
local function iconGreyed(unitID, defName)
	local def = UnitDefNames[defName]
	if not def then
		return nil
	end
	for _, desc in ipairs(Spring.GetUnitCmdDescs(unitID) or {}) do
		if desc.id == -def.id then
			return desc.disabled == true
		end
	end
end

--- A unit's build menu, one entry per build command, with a `!` on any the
-- player would see greyed. For a failed check to print.
local function buildMenu(unitID)
	local entries = {}
	for _, desc in ipairs(Spring.GetUnitCmdDescs(unitID) or {}) do
		if desc.id < 0 and UnitDefs[-desc.id] then
			entries[#entries + 1] = UnitDefs[-desc.id].name .. (desc.disabled and "!" or "")
		end
	end
	return table.concat(entries, ",")
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
-- The runtime places the player's one `fedengineer_up1` and the enemy's one
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
--
-- Both phases are also read here, through the game's own "phase" rules param,
-- which is what its faction picker and its spot picker draw off. A mission owns
-- the faction and the start position, so the game skips both (issue #888).
--------------------------------------------------------------------------------

local VICTORY_FRAME = 90 * 30 -- the mission's time_elapsed trigger, in frames
local DEADLINE = VICTORY_FRAME + 150

-- The four defs the build icon steps read (issue #955). Every one of them is in
-- the build menu the scenario's engineer carries, and every one of them is
-- tech-gated: Splinter Faction gates its whole build tree, so there is no icon
-- in this menu the game never writes.
--
-- Two pairs, one per tech the run grants. Each pair is a def the mission forbids
-- and a def beside it that the mission allows, on the same tech. Granting the
-- tech frees both as far as the game is concerned, so the allowed one is what
-- says the game really did repaint and the forbidden one is the claim.
--
-- The player has no commander, so no tech is provided and the game starts with
-- the whole menu greyed. That is why the claims are read after a grant rather
-- than before one: before it, a greyed icon says nothing about who greyed it.
local FIRST_TECH, FIRST_DENIED, FIRST_ALLOWED = "tech0", "supplydepot", "fissionpowerplant"
local SECOND_TECH, SECOND_DENIED, SECOND_ALLOWED = "tech1", "f1landfac", "researchcenter"

local steps = {
	{ frame = 2, run = function()
		local state = GG.CoilboxMission
		check("the vendored runtime published its mission", state ~= nil)
		check("and it is the mission the modoption named",
			state and state.id == MISSION_ID, state and state.id)
		check("the runtime read its own version marker out of the game",
			state and state.runtime and state.runtime.version == RUNTIME_VERSION,
			state and state.runtime and state.runtime.version)

		check("the runtime placed the player's startUnits",
			owns(PLAYER, "fedengineer_up1") == 1, owns(PLAYER, "fedengineer_up1"))
		check("and the scenario's actor for the enemy",
			owns(ENEMY, "lozengineer") == 1, owns(ENEMY, "lozengineer"))

		-- The adoption contract's third item, read from the game's side. Splinter
		-- Faction's game_spawn.lua asks this where it would call Spring.CreateUnit
		-- and spawns nothing when the answer is true.
		check("the runtime tells the game the mission owns the player's start",
			state and state.suppressesStart and state.suppressesStart(PLAYER) == true)
		check("and the enemy's", state and state.suppressesStart
			and state.suppressesStart(ENEMY) == true)
		check("and that it owns every start in the game",
			state and state.suppressesEveryStart and state.suppressesEveryStart() == true)

		-- The game's own phase machine, read through the param its pickers draw
		-- off. Skipped outright rather than run behind the mission (issue #888).
		note("at frame 2, the game's phase is " .. tostring(rules("phase"))
			.. " and it loaded " .. tostring(rules("spotCount")) .. " start spots")
		check("the game skipped its faction phase", rules("phase") == "done",
			rules("phase"))
		check("and never loaded the spots its placement phase would pick from",
			rules("spotCount") == nil, rules("spotCount"))

		note("at frame 2, " .. armies())
		check("inside the suppression window the player owns only what the scenario placed",
			unplaced(PLAYER, "fedengineer_up1") == 0, unplaced(PLAYER, "fedengineer_up1"))
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

	-- The build icons, against a game that greys its own (issue #955).
	--
	-- Nothing arbitrates between the two. The runtime greys what the scenario
	-- forbids on the callins a unit arrives on, and SplinterFaction's
	-- game_sticky_tech_progression.lua greys what a team has not teched to, on the
	-- same callins and again on its own nineteen-frame recheck after any tech
	-- changes. So the question a real game settles and a stub cannot is what a
	-- forbidden icon looks like once the game has repainted the menu underneath.
	{ frame = 3, run = function()
		local state = GG.CoilboxMission
		-- Everything below is about a mission that forbids something. A fixture
		-- that stopped would leave every check here passing on nothing.
		local buildable = (state.mission.restrictions or {}).buildable
		check("the scenario forbids a def on each of the two techs this run grants",
			buildable ~= nil and buildable.units[1] == FIRST_DENIED
				and buildable.units[2] == SECOND_DENIED)
		local builder = unitOf(PLAYER, "fedengineer_up1")
		check("the builder the scenario placed has a build menu to grey",
			builder ~= nil and buildMenu(builder) ~= "", tostring(builder))
		note("the builder's menu at frame 3 is " .. buildMenu(builder or 0))
		check("the game exposes the tech grant this run drives it through",
			type(GG.TechGrant) == "function", type(GG.TechGrant))
	end },

	-- With a quantity. The gadget's default is math.huge, and it writes what it
	-- is given straight into a team rules param, which the engine refuses.
	{ frame = 20, run = function()
		GG.TechGrant(FIRST_TECH, PLAYER, 1)
		note("granted " .. FIRST_TECH .. " to the player at frame 20")
	end },

	-- Past the game's own recheck, which runs on the first frame after a grant
	-- with frame % 19 == 17, and past the runtime's repaint on the first with
	-- frame % 15 == 0.
	{ frame = 50, run = function()
		local builder = unitOf(PLAYER, "fedengineer_up1")
		note("the builder's menu at frame 50 is " .. buildMenu(builder or 0))
		-- The check that stops the one below passing on a grant that did nothing.
		-- This def needs the same tech and the mission says nothing about it, so
		-- the game repainting the menu is the whole of why it is free.
		check("the tech grant repainted the menu, so a def only the game gated is free",
			iconGreyed(builder, FIRST_ALLOWED) == false,
			tostring(iconGreyed(builder, FIRST_ALLOWED)))
		check("while the def the mission forbids on that tech is greyed again",
			iconGreyed(builder, FIRST_DENIED) == true,
			tostring(iconGreyed(builder, FIRST_DENIED)))
		-- The other side of the same interaction. Nothing has granted the second
		-- tech yet, so both of its defs are the game's to grey and neither is the
		-- runtime's to lift.
		check("and the game's own lock on the next tech is untouched",
			iconGreyed(builder, SECOND_ALLOWED) == true,
			tostring(iconGreyed(builder, SECOND_ALLOWED)))
	end },

	{ frame = 60, run = function()
		GG.TechGrant(SECOND_TECH, PLAYER, 1)
		note("granted " .. SECOND_TECH .. " to the player at frame 60")
	end },

	{ frame = 90, run = function()
		local builder = unitOf(PLAYER, "fedengineer_up1")
		note("the builder's menu at frame 90 is " .. buildMenu(builder or 0))
		check("the second grant repainted the menu too",
			iconGreyed(builder, SECOND_ALLOWED) == false,
			tostring(iconGreyed(builder, SECOND_ALLOWED)))
		check("and the def the mission forbids on that tech is greyed again",
			iconGreyed(builder, SECOND_DENIED) == true,
			tostring(iconGreyed(builder, SECOND_DENIED)))
		check("with the first one still greyed after a second repaint",
			iconGreyed(builder, FIRST_DENIED) == true,
			tostring(iconGreyed(builder, FIRST_DENIED)))
	end },

	-- After SplinterFaction's faction-choice deadline.
	{ frame = 1000, run = function()
		note("at frame 1000, past the game's 900-frame faction deadline, " .. armies())
		check("the faction deadline came and went without a phase to advance",
			rules("phase") == "done", rules("phase"))
	end },

	-- After its placement deadline, which is the frame it creates start units on.
	{ frame = 1900, run = function()
		note("at frame 1900, past the game's placement deadline, " .. armies())
		check("and the placement deadline the same way",
			rules("phase") == "done", rules("phase"))
		check("the game's own start is still suppressed for the player",
			unplaced(PLAYER, "fedengineer_up1") == 0, unplaced(PLAYER, "fedengineer_up1"))
		check("and for the enemy",
			unplaced(ENEMY, "lozengineer") == 0, unplaced(ENEMY, "lozengineer"))
		-- Suppressed and intact are two claims, and the gap between them is what
		-- undoing a start costs where skipping it costs nothing. Splinter Faction's
		-- game_team_com_ends.lua answers an ally team's last commander dying with
		-- Spring.KillTeam, so a run that let the commander arrive and then destroyed
		-- it read as perfectly suppressed with the player's own units gone too
		-- (issue #884).
		check("and the player still holds what the scenario placed",
			owns(PLAYER, "fedengineer_up1") == 1, owns(PLAYER, "fedengineer_up1"))
		check("and so does the enemy",
			owns(ENEMY, "lozengineer") == 1, owns(ENEMY, "lozengineer"))
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
			unplaced(PLAYER, "fedengineer_up1") == 0, unplaced(PLAYER, "fedengineer_up1"))
		check("the game's own start stayed suppressed for the whole mission, enemy",
			unplaced(ENEMY, "lozengineer") == 0, unplaced(ENEMY, "lozengineer"))
		check("and the player is still playing rather than a spectator with no units",
			owns(PLAYER, "fedengineer_up1") == 1, owns(PLAYER, "fedengineer_up1"))

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
