-- Coilbox mission runtime: the many-clients probe (issue #953).
--
-- scripts/mission-clients.sh copies this into a scratch game beside the runtime
-- and plays one ambush with three real spring-headless clients at once: the
-- player the scenario's camera move and first marker name, a second player on
-- the other team, and a spectator watching as the first.
--
-- What only this can settle is the half of `camera_pan` and `map_marker` that
-- lives on a client. The synced half resolves a participant into an engine team
-- and sends it along, and every client is handed the same message. Which of them
-- acts on it is decided in the runtime's own unsynced half, against
-- `Spring.GetMyTeamID()`. A one-client run cannot watch anybody drop anything,
-- so lua/mission-runtime/tests/headless/probe.lua reads what arrived and says so.
--
-- Every check is one line of stdout, `HARNESS ok` or `HARNESS fail`, in the log
-- of the client that made it. Each client checks only its own claim, because
-- what is being measured is the three of them disagreeing.
--
-- Not part of what a game vendors, and not something a mission ever ships with.

function gadget:GetInfo()
	return {
		name = "Coilbox mission clients probe",
		desc = "Watches three clients decide what a mission aimed at one of them",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Behind the runtime, which is at 1000, so the wrappers below are in place
		-- before it is asked to do anything and its calls are the ones counted.
		layer = 2000,
		enabled = true,
	}
end

-- The frames the plan runs on. The ambush's trigger watches a zone, so the
-- mission only ever fires because a unit is walked into it.
local SPRING_FRAME = 30
local DONE_FRAME = 200

-- The engine teams the ambush fixture's two participants resolve to, which is
-- also what the start script gives the two players. The camera move and the
-- first marker name the first participant.
local AIMED_TEAM = 0

--- Where the mission aims its camera and its first marker, from the fixture.
-- Read back off the call the runtime made, so an action that fired for the wrong
-- place is not a check that passed.
local AIMED_X = 2000

--- The marker the mission aims at nobody, which every client gets.
local EVERYONE_TEXT = "They came."

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

if not gadgetHandler:IsSyncedCode() then
	-- What this client's runtime actually did, rather than what it was told.
	--
	-- The two engine calls the runtime's unsynced half makes are replaced with
	-- ones that count and pass through. They are replaced on the shared Spring
	-- table, which is the table the runtime looks the call up in every time it
	-- makes one, and this gadget is behind the runtime so they are in place before
	-- the first frame. Nothing else can settle the claim: a marker put down
	-- locally has no Lua to read it back, and the camera in a headless client
	-- drifts on its own, so the position tells you nothing.
	local panned, marked = {}, {}

	-- What arrived, which every client is handed identically. Read so that a run
	-- where the three disagree about the message rather than about what to do
	-- with it fails here rather than reading as a drop.
	local arrived = { camera = {}, marker = {} }

	local function role()
		return (Spring.GetPlayerInfo(Spring.GetMyPlayerID()))
	end

	function gadget:Initialize()
		local pan, mark = Spring.SetCameraTarget, Spring.MarkerAddPoint
		Spring.SetCameraTarget = function(x, ...)
			panned[#panned + 1] = x
			return pan(x, ...)
		end
		Spring.MarkerAddPoint = function(x, y, z, text, ...)
			marked[#marked + 1] = text
			return mark(x, y, z, text, ...)
		end
		-- Paced by the host's server at the speed a player would watch. The checks
		-- are about frames, so ask for the fastest it will give.
		Spring.SendCommands("setspeed 20")
		say("note " .. tostring(role()) .. " is on team " .. tostring(Spring.GetMyTeamID())
			.. ", spectating " .. tostring(Spring.GetSpectatingState()))
	end

	--- The claims this client makes, which depend on which client it is.
	local function report()
		local mine = Spring.GetMyTeamID()
		local name = tostring(role())

		-- First, that all three were told the same thing. The runtime resolves the
		-- participant once, in synced Lua, so a client that saw a different team
		-- would mean the resolution rather than the filter was what differed.
		check(name .. " was told the camera move is for team " .. AIMED_TEAM,
			#arrived.camera == 1 and arrived.camera[1] == AIMED_TEAM,
			table.concat(arrived.camera, ","))
		check(name .. " was told one marker is for team " .. AIMED_TEAM .. " and one for everyone",
			#arrived.marker == 2 and arrived.marker[1] == AIMED_TEAM and arrived.marker[2] == -1,
			table.concat(arrived.marker, ","))

		if mine == AIMED_TEAM then
			check(name .. " is watching the team the mission named, so its camera moved",
				#panned == 1 and panned[1] == AIMED_X, table.concat(panned, ","))
			check(name .. " got both markers, the one for its team and the one for everyone",
				#marked == 2 and marked[2] == EVERYONE_TEXT, table.concat(marked, " / "))
		else
			check(name .. " is watching another team, so its camera never moved",
				#panned == 0, table.concat(panned, ","))
			check(name .. " got only the marker aimed at everyone",
				#marked == 1 and marked[1] == EVERYONE_TEXT, table.concat(marked, " / "))
		end
		say("done")
	end

	function gadget:RecvFromSynced(message, ...)
		if message == "coilbox_mission_camera" then
			local _, _, _, team = ...
			arrived.camera[#arrived.camera + 1] = team
		elseif message == "coilbox_mission_marker" then
			local _, _, _, team = ...
			arrived.marker[#arrived.marker + 1] = team
		elseif message == "coilbox_clients_done" then
			report()
			Spring.Quit()
		end
	end

	return
end

--------------------------------------------------------------------------------
-- The synced half, which runs the same on every client. All it does is spring
-- the ambush, because a headless run has nobody at the keyboard.
--------------------------------------------------------------------------------

local done = false

function gadget:GameFrame(frame)
	if done then
		return
	end
	if frame == SPRING_FRAME then
		-- Inside the pass the ambush watches, and a long way from everything the
		-- mission places there.
		Spring.CreateUnit("armpw", 1900, Spring.GetGroundHeight(1900, 1900), 1900, 0, AIMED_TEAM)
	end
	if frame >= DONE_FRAME then
		done = true
		SendToUnsynced("coilbox_clients_done")
	end
end
