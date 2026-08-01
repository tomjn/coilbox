-- Coilbox mission runtime: how a mission ends, and what stops it ending early.
--
-- A mission ends by calling Spring.GameOver with the ally teams that won. That
-- is the same call a normal game ends with, so the result lands in the replay
-- and coilbox reads a scenario mission's outcome through the code path it
-- already reads a skirmish's through. No channel of our own, and nothing to keep
-- in step.
--
-- - `victory` names a participant, and its ally team is the only winner.
-- - `defeat` names a participant, and every other ally team wins. That is what
--   a losing player's replay has to say for the reader to call it a loss: the
--   reader asks whether the player's ally team is in the winning list.
-- - Either one ends the mission once. A repeating trigger cannot end it twice,
--   and nothing after the first end runs.
--
-- The anchor unit is the other half. A game ends itself when an ally team has
-- nothing left: the engine's own game_end gadget kills every team in it, which
-- demotes the players to spectators and declares the survivors the winners. A
-- mission where the player legitimately reaches zero units -- the convoy drives
-- off the map, the last commando is spent -- would end there, mid-mission, in a
-- loss. So each mission team a human is playing gets one unit that is not on the
-- map for any other purpose: hidden, invulnerable, blind, non-blocking, and
-- ignored by the runtime's own counting. The team is never empty, so nothing
-- else decides the mission is over.

local M = {}

-- The outcome, mirrored for the debrief. Spring.GameOver is what the replay
-- reads, and LuaUI cannot read it back: the engine hands the winning ally teams
-- to the GameOver callin, but the stock widget handler calls a widget's GameOver
-- with no arguments at all. So the mission's own ending is mirrored the way an
-- objective's state is, and the panel that draws the debrief reads it there.
M.OVER_PARAM = "coilbox_mission_over"
M.WINNERS_PARAM = "coilbox_mission_winners"
M.WINNER_PREFIX = "coilbox_mission_winner_"

-- Where an anchor stands. The engine clamps a creation into the map, so this is
-- the corner: the furthest a fixed point can be from anything a mission is
-- about. It is still a place a zone could cover, which is why the runtime's own
-- counting skips anchors rather than trusting the position.
M.ANCHOR_X = 0
M.ANCHOR_Z = 0

-- What an anchor must not do. It stands in a corner for the whole mission, so it
-- may not shoot, build, or pay into the economy the author balanced.
local function suitable(def)
	-- A missing field reads as zero rather than disqualifying the def. A runtime
	-- that finds no anchor at all is worse off than one that anchors with a
	-- solar collector and then zeroes what it makes.
	local function zero(value)
		return (tonumber(value) or 0) == 0
	end

	return zero(def.speed)
		and #(def.weapons or {}) == 0
		and not def.isFactory
		and zero(def.buildSpeed)
		and zero(def.metalMake) and zero(def.energyMake)
		and zero(def.metalUpkeep) and zero(def.energyUpkeep)
		and zero(def.windGenerator) and zero(def.tidalGenerator)
		and zero(def.extractsMetal)
end

--- Register the mission-ending actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `spawn(placement)` puts one unit on the map and returns its unit
--   id, the same hook the groups use, because creating a unit belongs to the
--   gadget's start suppression and ground read
-- @return the handle, so a game's own actions end a mission the way these do
function M.register(engine, state, hooks)
	-- Trigger params name a participant, not an engine team.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	-- unitID -> { team = engine team, defID = }, for the anchors that are standing.
	local anchors = {}
	local over = false

	--- The ally team a team belongs to, or nil for a team the engine does not
	-- have.
	local function allyTeamOf(team)
		local _, _, _, _, _, allyTeam = Spring.GetTeamInfo(team, false)
		return allyTeam
	end

	--- The engine teams a human is playing. A spectator plays none, and everything
	-- else in the game is a team the mission may empty without anyone minding.
	local function humanTeams()
		local human = {}
		for _, playerID in ipairs(Spring.GetPlayerList() or {}) do
			local _, _, spectator, team = Spring.GetPlayerInfo(playerID, false)
			if not spectator and team then
				human[team] = true
			end
		end
		return human
	end

	--- The participant a `victory` or `defeat` with no team means.
	--
	-- The one a human is playing, which is what the editor's "the player" means
	-- and the only team an author writing no name can be talking about.
	--
	-- Failing that, the lowest engine team number, said out loud. That is the
	-- first slot in the start script, which is where the player sits in a mission
	-- coilbox launched. A mission that ends for the wrong team is a bug, and one
	-- that never ends is a worse one.
	local function defaultTeam()
		local human = humanTeams()
		local fallback
		for _, team in ipairs(state.teams or {}) do
			if human[team.team] then
				return team.id
			end
			if not fallback or team.team < fallback.team then
				fallback = team
			end
		end

		if not fallback then
			return nil
		end
		engine:report("end-no-human", "warning", string.format(
			"no human is playing a mission team, ending for %s instead", tostring(fallback.id)))
		return fallback.id
	end

	local handle = {}

	--- Whether the mission has ended.
	function handle.isOver()
		return over
	end

	--- End the mission. `winners` is the list of ally teams to declare, already
	-- decided by the caller.
	local function finish(what, participant, winners)
		over = true
		Spring.GameOver(winners)
		Spring.SetGameRulesParam(M.OVER_PARAM, 1)
		-- How many won, because "nobody" is a real answer and a reader that only
		-- asks whether its own ally team is in the list cannot tell it from a loss.
		Spring.SetGameRulesParam(M.WINNERS_PARAM, #winners)
		for _, allyTeam in ipairs(winners) do
			Spring.SetGameRulesParam(M.WINNER_PREFIX .. allyTeam, 1)
		end
		engine:log("notice", string.format(
			"mission over: %s for %s, ally teams %s won",
			what, tostring(participant), table.concat(winners, ", ")))
	end

	--- The engine team a `victory` or `defeat` is about, or nil once it has said
	-- what was wrong.
	local function endingTeam(what, participant)
		if over then
			engine:report("end-twice", "warning",
				"the mission has already ended, ignoring " .. what)
			return nil
		end

		local id = participant
		if id == nil then
			id = defaultTeam()
		end

		local team = engineTeam[id]
		if not team then
			engine:report("end-team:" .. tostring(id), "warning", string.format(
				"no team named %s in this mission, ignoring %s", tostring(id), what))
			return nil
		end
		return team, id
	end

	--- The named participant's side wins.
	function handle.victory(participant)
		local team, id = endingTeam("victory", participant)
		if not team then
			return
		end

		local allyTeam = allyTeamOf(team)
		if not allyTeam then
			engine:report("end-ally:" .. tostring(id), "warning", string.format(
				"team %s has no ally team, ignoring victory", tostring(id)))
			return
		end
		finish("victory", id, { allyTeam })
	end

	--- The named participant's side loses, so everyone else wins.
	--
	-- Everyone else rather than nobody: a replay says who won, and a reader
	-- deciding whether the player lost asks whether the player's ally team is in
	-- that list. Gaia is left out because it is not playing.
	function handle.defeat(participant)
		local team, id = endingTeam("defeat", participant)
		if not team then
			return
		end

		local allyTeam = allyTeamOf(team)
		if not allyTeam then
			engine:report("end-ally:" .. tostring(id), "warning", string.format(
				"team %s has no ally team, ignoring defeat", tostring(id)))
			return
		end

		local gaia = Spring.GetGaiaTeamID()
		local gaiaAlly = gaia and allyTeamOf(gaia)

		local winners = {}
		for _, other in ipairs(Spring.GetAllyTeamList() or {}) do
			if other ~= allyTeam and other ~= gaiaAlly then
				winners[#winners + 1] = other
			end
		end
		finish("defeat", id, winners)
	end

	--------------------------------------------------------------------------------
	-- The anchor.
	--------------------------------------------------------------------------------

	--- The unit def every anchor is built from: the first one this game has that
	-- does nothing at all. Chosen by ascending def id, which every machine reads
	-- the same way, because a unit created on one machine and not another is a
	-- desync rather than a cosmetic difference.
	local function anchorDef()
		for id = 1, #UnitDefs do
			local def = UnitDefs[id]
			if def and suitable(def) then
				return def
			end
		end
		return nil
	end

	--- Take everything off an anchor that would otherwise reach the mission: what
	-- it collides with, what it sees, and what it earns. Being invulnerable and
	-- undrawn is the gadget's, because it owns both.
	local function neuter(unitID)
		Spring.SetUnitBlocking(unitID, false, false, false, false, false, false, false)
		Spring.SetUnitStealth(unitID, true)
		Spring.SetUnitSonarStealth(unitID, true)
		for _, sensor in ipairs({ "los", "airLos", "radar", "sonar", "seismic" }) do
			Spring.SetUnitSensorRadius(unitID, sensor, 0)
		end
		-- Belt and braces over the def: a def that hides what it makes behind a
		-- name this runtime does not read still makes nothing once it is an anchor.
		Spring.SetUnitResourcing(unitID, {
			uum = 0, uue = 0, umm = 0, ume = 0,
			cum = 0, cue = 0, cmm = 0, cme = 0,
		})
	end

	--- Put an anchor on every mission team a human is playing. Called from the
	-- gadget's start, and returns how many it placed.
	function handle.place()
		local human = humanTeams()
		local wanted = {}
		for _, team in ipairs(state.teams or {}) do
			if human[team.team] then
				wanted[#wanted + 1] = team
			end
		end
		if #wanted == 0 then
			return 0
		end

		local def = anchorDef()
		if not def then
			engine:report("anchor-def", "warning",
				"no unit def in this game can be a mission anchor, so a team that loses "
				.. "its last unit will end the mission")
			return 0
		end

		local placed = 0
		for _, team in ipairs(wanted) do
			local unitID = hooks.spawn({
				unitDef = def.name,
				team = team.team,
				x = M.ANCHOR_X,
				z = M.ANCHOR_Z,
				facing = 0,
			})
			if unitID then
				neuter(unitID)
				anchors[unitID] = { team = team.team, defID = def.id }
				placed = placed + 1
			end
		end

		engine:log("notice", string.format(
			"anchored %d mission team(s) with %s", placed, def.name))
		return placed
	end

	--- Whether a unit is an anchor, which is how the conditions that read a zone
	-- leave one out of what they see.
	function handle.isAnchor(unitID)
		return anchors[unitID] ~= nil
	end

	--- How many of a team's units are anchors, of one def or of any. The
	-- conditions that count a team's units take this off, so a mission asking
	-- whether the player has anything left gets the answer it would have got
	-- without an anchor at all.
	function handle.anchorCount(team, defID)
		local count = 0
		for _, anchor in pairs(anchors) do
			if anchor.team == team and (defID == nil or anchor.defID == defID) then
				count = count + 1
			end
		end
		return count
	end

	--- A unit is gone. Fed from the gadget's UnitDestroyed. An anchor should never
	-- be one of them, so it is worth saying when it is: the team it was holding up
	-- can now end the mission by running out.
	function handle.removed(unitID)
		if not anchors[unitID] then
			return
		end
		local team = anchors[unitID].team
		anchors[unitID] = nil
		engine:log("warning", string.format(
			"the mission anchor for team %s was destroyed", tostring(team)))
	end

	-- Before the first frame, so a panel reading the outcome finds "not yet"
	-- rather than nothing at all, the way it finds every objective already there.
	Spring.SetGameRulesParam(M.OVER_PARAM, 0)

	engine:addAction("victory", function(params)
		handle.victory(params.team)
	end)

	engine:addAction("defeat", function(params)
		handle.defeat(params.team)
	end)

	return handle
end

return M
