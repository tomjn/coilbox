-- Coilbox replay logger: records what happened in a replay as it plays back.
--
-- Coilbox generates a game that depends on the game a replay was recorded on,
-- puts this one file in it, points a scratch copy of the replay at that game and
-- plays it headless. Change it in the coilbox repository under
-- lua/replay-logger/. Nothing installs it into a game anybody plays.
--
-- The one rule: this gadget never changes the simulation. A replay is a stream
-- of orders, so the match is simulated again, and anything that perturbs it
-- produces a record of a game nobody played. The synced half calls only
-- functions that read, draws no random numbers, and hands each finished line to
-- the unsynced half, which is the only half allowed to open a file. Coilbox
-- compares the game over line with the replay's own trailer after every run and
-- throws the run away when they disagree.
--
-- The output is one JSON object per line, flushed as it is written, so a run
-- that is interrupted leaves a file that reads up to the line where it stopped.
-- Every line has a "kind". A reader skips a kind it does not know and ignores a
-- field it does not know, which is what lets a later version add both.
--
--   header          format, game, gameVersion, gameShortName, map, engine,
--                   mapSizeX, mapSizeZ, gaiaTeam
--   game_start      frame
--   unit_created    frame, unit, def, team, x, y, z, builder
--   unit_finished   frame, unit, def, team, x, y, z
--   unit_destroyed  frame, unit, def, team, x, y, z, attacker, attackerDef,
--                   attackerTeam, weapon
--   game_over       frame, winners, teams
--
-- The game over line is the last one. The engine is told to quit as soon as it
-- is on disk.
--
-- "def" is a unit def id as this run's engine numbered them. "builder" and the
-- four attacker fields are left out when the engine names none. Each entry of
-- "teams" is that team's last statistics sample as Spring.GetTeamStatsHistory
-- reports it, plus "samples", the number of samples the team has.

-- Raised when a line gains or loses a field a reader depends on. Adding a kind
-- or an optional field does not raise it.
local FORMAT_VERSION = 1

local MESSAGE = "coilbox_replay_log"

-- Relative to the engine's write directory, which is the only place Lua may
-- open a file for writing.
local LOG_FILE = "coilbox-replay-events.jsonl"

local LOG_SECTION = "coilbox-replay-logger"

function gadget:GetInfo()
	return {
		name = "Coilbox replay logger",
		desc = "Records unit events and the final totals of a replay to a file",
		author = "coilbox",
		license = "MIT",
		-- Late, so a position is read after the game's own gadgets have had
		-- their turn at the same event.
		layer = 2000,
		enabled = true,
	}
end

--------------------------------------------------------------------------------
-- JSON, for the handful of shapes a line has.
--------------------------------------------------------------------------------

local ESCAPES = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function quote(text)
	local escaped = tostring(text):gsub('[%c"\\]', function(char)
		return ESCAPES[char] or string.format("\\u%04x", char:byte())
	end)
	return '"' .. escaped .. '"'
end

-- The engine's totals are 32 bit floats and coilbox compares them with the
-- replay's own for equality, so a number has to read back as the same float.
-- The engine's string.format is its own and writes a fixed number of decimals
-- whatever letter it is given, fifteen at most. Fifteen decimals read back
-- exactly for any float larger than a few hundred millionths, and a total is
-- either nothing or far larger than that.
local function number(value)
	if value ~= value or value == math.huge or value == -math.huge then
		return "null"
	end
	if value == math.floor(value) and value > -1e15 and value < 1e15 then
		return string.format("%.0f", value)
	end
	return string.format("%.15f", value)
end

-- A tenth of an elmo is far finer than anything drawn on a map, and it keeps a
-- line short.
local function coordinate(value)
	return string.format("%.1f", value)
end

if gadgetHandler:IsSyncedCode() then
	----------------------------------------------------------------------------
	-- Synced: reads the simulation and never writes to it.
	----------------------------------------------------------------------------

	local GetGameFrame = Spring.GetGameFrame
	local GetUnitPosition = Spring.GetUnitPosition

	local function send(line)
		SendToUnsynced(MESSAGE, line)
	end

	local function unitLine(kind, unitID, unitDefID, unitTeam)
		local x, y, z = GetUnitPosition(unitID)
		return '{"kind":"' .. kind .. '","frame":' .. number(GetGameFrame())
			.. ',"unit":' .. number(unitID)
			.. ',"def":' .. number(unitDefID)
			.. ',"team":' .. number(unitTeam)
			.. ',"x":' .. coordinate(x or 0)
			.. ',"y":' .. coordinate(y or 0)
			.. ',"z":' .. coordinate(z or 0)
	end

	function gadget:GameStart()
		send('{"kind":"game_start","frame":' .. number(GetGameFrame()) .. "}")
	end

	function gadget:UnitCreated(unitID, unitDefID, unitTeam, builderID)
		local line = unitLine("unit_created", unitID, unitDefID, unitTeam)
		if builderID then
			line = line .. ',"builder":' .. number(builderID)
		end
		send(line .. "}")
	end

	function gadget:UnitFinished(unitID, unitDefID, unitTeam)
		send(unitLine("unit_finished", unitID, unitDefID, unitTeam) .. "}")
	end

	function gadget:UnitDestroyed(unitID, unitDefID, unitTeam, attackerID, attackerDefID, attackerTeam, weaponDefID)
		local line = unitLine("unit_destroyed", unitID, unitDefID, unitTeam)
		if attackerID then
			line = line .. ',"attacker":' .. number(attackerID)
		end
		if attackerDefID then
			line = line .. ',"attackerDef":' .. number(attackerDefID)
		end
		if attackerTeam then
			line = line .. ',"attackerTeam":' .. number(attackerTeam)
		end
		if weaponDefID then
			line = line .. ',"weapon":' .. number(weaponDefID)
		end
		send(line .. "}")
	end

	-- The engine's own field names, in the order its TeamStatistics declares
	-- them. A fixed list rather than a walk over the table, so the line is the
	-- same from run to run.
	local STAT_FIELDS = {
		"frame",
		"metalUsed", "energyUsed",
		"metalProduced", "energyProduced",
		"metalExcess", "energyExcess",
		"metalReceived", "energyReceived",
		"metalSent", "energySent",
		"damageDealt", "damageReceived",
		"unitsProduced", "unitsDied",
		"unitsReceived", "unitsSent",
		"unitsCaptured", "unitsOutCaptured",
		"unitsKilled",
	}

	local function teamLine(teamID)
		local samples = Spring.GetTeamStatsHistory(teamID)
		local parts = { '"team":' .. number(teamID), '"samples":' .. number(samples or 0) }
		local history = samples and samples > 0 and Spring.GetTeamStatsHistory(teamID, samples)
		local last = history and history[1]
		if last then
			for _, field in ipairs(STAT_FIELDS) do
				if last[field] ~= nil then
					parts[#parts + 1] = '"' .. field .. '":' .. number(last[field])
				end
			end
		end
		return "{" .. table.concat(parts, ",") .. "}"
	end

	function gadget:GameOver(winningAllyTeams)
		local winners = {}
		for index, allyTeam in ipairs(winningAllyTeams or {}) do
			winners[index] = number(allyTeam)
		end

		local gaia = Spring.GetGaiaTeamID()
		local teams = {}
		for _, teamID in ipairs(Spring.GetTeamList()) do
			if teamID ~= gaia then
				teams[#teams + 1] = teamLine(teamID)
			end
		end

		-- The second argument tells the unsynced half this was the last line.
		SendToUnsynced(MESSAGE, '{"kind":"game_over","frame":' .. number(GetGameFrame())
			.. ',"winners":[' .. table.concat(winners, ",") .. "]"
			.. ',"teams":[' .. table.concat(teams, ",") .. "]}", true)
	end
else
	----------------------------------------------------------------------------
	-- Unsynced: owns the file, and asks the server to play as fast as it can.
	----------------------------------------------------------------------------

	local file

	local function write(line)
		if not file then
			return
		end
		file:write(line, "\n")
		-- Every line, so a run that is killed leaves everything up to its last
		-- event on disk.
		file:flush()
	end

	local function header()
		local engine = (Engine and Engine.versionFull) or (Engine and Engine.version) or Game.version
		return '{"kind":"header","format":' .. number(FORMAT_VERSION)
			.. ',"game":' .. quote(Game.gameName or "")
			.. ',"gameVersion":' .. quote(Game.gameVersion or "")
			.. ',"gameShortName":' .. quote(Game.gameShortName or "")
			.. ',"map":' .. quote(Game.mapName or "")
			.. ',"engine":' .. quote(engine or "")
			.. ',"mapSizeX":' .. number(Game.mapSizeX or 0)
			.. ',"mapSizeZ":' .. number(Game.mapSizeZ or 0)
			.. ',"gaiaTeam":' .. number(Spring.GetGaiaTeamID() or -1)
			.. "}"
	end

	-- How fast to ask the server to play, as a multiple of real time. The server
	-- holds a replay to between its minimum and maximum speed and both are its
	-- own pacing, never part of the simulation: it takes the two commands from
	-- the local player and broadcasts neither. It slows itself down again when
	-- this machine cannot keep up, so the figure is a ceiling and not a target.
	-- Measured on a 769 second Splinter Faction match: about thirteen and a
	-- half minutes at the server's own speed, and thirteen seconds with this,
	-- which is sixty times real time and well under the ceiling.
	local SPEED = 100

	local function playFast()
		-- Maximum first: the server clamps a minimum to the maximum it has.
		Spring.SendCommands("setmaxspeed " .. SPEED, "setminspeed " .. SPEED)
	end

	function gadget:Initialize()
		local opened, reason = io.open(LOG_FILE, "w")
		if not opened then
			Spring.Log(LOG_SECTION, "error", "could not open " .. LOG_FILE .. ": " .. tostring(reason))
			gadgetHandler:RemoveGadget(self)
			return
		end
		file = opened
		write(header())
		playFast()
	end

	-- Asked again once the game is running, because a server still loading may
	-- not have been listening the first time.
	function gadget:GameStart()
		playFast()
	end

	function gadget:RecvFromSynced(message, line, last)
		if message ~= MESSAGE then
			return false
		end
		write(line)
		if last then
			-- The totals the replay's trailer holds were taken at this moment, so
			-- there is nothing after it to check a run against. A headless
			-- engine does not stop at the end of a replay on its own.
			file:close()
			file = nil
			Spring.SendCommands("quitforce")
		end
		return true
	end

	function gadget:Shutdown()
		if file then
			file:close()
			file = nil
		end
	end
end
