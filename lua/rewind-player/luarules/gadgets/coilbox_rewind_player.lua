-- Coilbox rewind player: plays a replay's track back (issue #3794).
--
-- Coilbox generates a game that depends on the game a replay was recorded on
-- and puts the replay's track in it at coilbox_rewind/track.cbtrack. This
-- gadget opens the track and, on every simulation frame, makes the world the
-- track at the time the player holds: units, features, terrain and the shots
-- in the air (issue #3795). Nothing is simulated, so the time can jump and run
-- backwards.
--
-- The work is in luarules/rewind_player/coilbox_player.lua and the stages it
-- lists. This file is the engine's side of it: the call-ins, and the two
-- things only a gadget can do.
--
-- Nothing takes damage. `UnitPreDamaged` and `FeaturePreDamaged` give every hit
-- no damage and no push, and the track owns health and what stands. A unit that
-- dies while the match is watched explodes with the game's own effect, and that
-- explosion reaches features (issue #3987). The shots the player creates do not
-- rest on that: each is created with no damage to do.
--
-- Nothing heals either (issue #3986). The engine heals in the middle of a
-- simulation frame, so `GameFramePost` gives the player the end of it, where it
-- gives back what it held. coilbox_player_units.lua has how.
--
-- A frame's work is timed. Synced Lua has no clock, so the synced half tells
-- the unsynced half when the work starts and ends (`SendToUnsynced` is a call
-- and not a message, so it costs no frame), and the unsynced half logs a line
-- when it took longer than one simulation frame lasts.
--
-- The same timing sets how much a seek may do in one frame (issue #3988). A
-- seek can need hundreds of units made or removed, at a cost for each that only
-- the engine knows. The synced half says how many it made and how many it
-- removed in the frame, the unsynced half works out how many of each fit in half
-- a simulation frame and sends that back as a Lua message, and the player does
-- no more than that in a frame until it hears another. The player starts at one
-- of each. The message reaches the synced half about two frames later.
--
-- The base game's own gadgets still run, except those the game's adapter
-- switches off (issue #3799). !coilbox_rewind_guard.lua stops the rest killing a
-- team or ending the match.
--
-- Change this in the coilbox repository under lua/rewind-player/.

function gadget:GetInfo()
	return {
		name = "Coilbox rewind player",
		desc = "Plays a replay track back: units, features, terrain and shots at any time, in either direction.",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local PREFIX = "COILBOX_REWIND_PLAYER "

--- What the synced half sends the unsynced one around a frame's work.
local WORK = "coilbox_rewind_work"

--- What the player does in a frame until the unsynced half has timed some work:
-- the least that makes progress.
local FIRST_BUDGET = 1

--- The Lua message that sets the player's budget, which is
-- `Player.BUDGET` in coilbox_player.lua.
local BUDGET = "coilbox_rewind_budget:"

if gadgetHandler:IsSyncedCode() then
	local player

	local function log(text)
		Spring.Echo(PREFIX .. text)
	end

	function gadget:Initialize()
		local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
		local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")
		local Player = VFS.Include("luarules/rewind_player/coilbox_player.lua")
		local Adapter = VFS.Include("luarules/rewind_player/coilbox_player_adapter.lua")

		local fetch, why = Fetch.fromVFS()
		if not fetch then
			log("failed: " .. tostring(why))
			return
		end
		local track, openWhy = Track.open(fetch)
		if not track then
			log("failed: " .. tostring(openWhy))
			return
		end
		-- The game's adapter, which coilbox wrote into the playback game. Its
		-- gadgets and widgets were switched off before the engine started.
		local adapter, adapterWhy = Adapter.load(VFS)
		local made, madeWhy = Player.new(track, {
			modOptions = Spring.GetModOptions(),
			budget = FIRST_BUDGET,
			log = log,
			adapter = adapter,
			adapterWhy = adapterWhy,
		})
		if not made then
			log("failed: " .. tostring(madeWhy))
			return
		end
		player = made

		local h, info = track.header, track:info()
		log(
			string.format(
				"track frames %d to %d, windows %d, window length %d, unit defs %d, teams %d, features %d, game %s, map %s",
				h.firstFrame,
				h.lastFrame,
				h.windowCount,
				h.windowLength,
				#info.unitDefs,
				#info.teams,
				#track:features(),
				info.game,
				info.map
			)
		)
	end

	function gadget:GameFrame(frame)
		if not player then
			return
		end
		SendToUnsynced(WORK, 0, frame)
		player:frame()
		SendToUnsynced(WORK, 1, frame, player:worked())
	end

	function gadget:RecvLuaMsg(message)
		return player ~= nil and player:message(message)
	end

	function gadget:UnitPreDamaged()
		if player then
			return 0, 0
		end
	end

	function gadget:FeaturePreDamaged()
		if player then
			return 0, 0
		end
	end

	function gadget:GameFramePost()
		if player then
			player:framePost()
		end
	end

	function gadget:UnitDamaged(unitID)
		if player then
			player:unitDamaged(unitID)
		end
	end

	function gadget:UnitCreated(unitID)
		if player then
			player:unitCreated(unitID)
		end
	end

	function gadget:UnitDestroyed(unitID)
		if player then
			player:unitDestroyed(unitID)
		end
	end

	function gadget:FeatureCreated(featureID)
		if player then
			player:featureCreated(featureID)
		end
	end

	function gadget:FeatureDestroyed(featureID)
		if player then
			player:featureDestroyed(featureID)
		end
	end

	function gadget:AllowFeatureCreation()
		if player then
			return player:allowFeatureCreation()
		end
		return true
	end

	function gadget:TeamDied(teamID)
		if player then
			player:teamDied(teamID)
		end
	end
else
	-- How long one simulation frame lasts, in milliseconds. Work that takes
	-- longer than this cannot keep up with the match's own speed.
	local LIMIT = 1000 / Game.gameSpeed

	-- After a line, slow frames are counted and not logged for a second of
	-- frames, so a run of them does not make itself slower.
	local QUIET_FRAMES = Game.gameSpeed

	-- Half a frame is what a seek's work aims at. The rest of the frame is the
	-- engine's own simulation and drawing, and the slow frame line is what says
	-- whether that left enough.
	local TARGET = LIMIT / 2

	-- Microseconds where the engine has them, which it does from 2025.01.1. The
	-- other timer gives whole milliseconds.
	local micros = Spring.GetTimerMicros ~= nil
	local clock = Spring.GetTimerMicros or Spring.GetTimer

	local started
	local lastLine
	local slow, worst = 0, 0
	-- How many units a frame may make and remove, as last sent.
	local makeBudget, removeBudget = FIRST_BUDGET, FIRST_BUDGET

	--- The budget after a frame in which `count` units took `took` milliseconds,
	-- for a budget that was `budget`. Each took that long with the rest of the
	-- frame's work counted in, which only makes it more, so what fits in `TARGET`
	-- errs low. A frame that used the whole budget sets it to what fits, at least
	-- one and at most twice what the frame did. The cost of a few units says
	-- little about the next many. A frame that used less of the budget leaves it
	-- alone unless it took longer than `TARGET`, and then cuts it. The last frame
	-- of a seek has few units and a rest of the frame that is dear beside them,
	-- and says little.
	local function fit(took, count, budget)
		local wanted = math.floor(TARGET / math.max(took / count, 0.001))
		if count >= budget then
			return math.max(1, math.min(wanted, 2 * count))
		elseif took > TARGET then
			return math.max(1, math.min(wanted, budget))
		end
		return budget
	end

	--- A frame made `made` units and removed `removed` in `took` milliseconds.
	-- Making costs the engine something other than removing, so only a frame that
	-- did one of them says what that one costs. A frame that did neither ends a
	-- seek, and the budgets go back to one. What a unit costs moves with how many
	-- there are, from 0.28 to 0.5 ms to make in the runs of issue #3988 as the
	-- count went from none to 400, and from 0.12 to 0.33 ms to remove, so what
	-- one seek ended on is not safe for the start of the next. Each starts from
	-- one and doubles each frame while the cost allows.
	local function retune(took, made, removed)
		local make, remove = makeBudget, removeBudget
		if made + removed == 0 then
			make, remove = FIRST_BUDGET, FIRST_BUDGET
		elseif made > 0 and removed == 0 then
			make = fit(took, made, makeBudget)
		elseif removed > 0 and made == 0 then
			remove = fit(took, removed, removeBudget)
		end
		if make ~= makeBudget or remove ~= removeBudget then
			makeBudget, removeBudget = make, remove
			Spring.SendLuaRulesMsg(BUDGET .. make .. " " .. remove)
		end
	end

	function gadget:RecvFromSynced(name, phase, frame, made, removed)
		if name ~= WORK then
			return false
		end
		if phase == 0 then
			started = clock()
			return true
		end
		if not started then
			return true
		end
		local took = Spring.DiffTimers(clock(), started, true, micros)
		started = nil
		if made and removed then
			retune(took, made, removed)
		end
		if took <= LIMIT then
			return true
		end
		slow = slow + 1
		if took > worst then
			worst = took
		end
		if not lastLine or frame - lastLine >= QUIET_FRAMES then
			Spring.Echo(
				string.format(
					"%sslow frame: the work of frame %d took %.1f ms, and a simulation frame lasts %.1f ms. %d slow since the last line, the slowest %.1f ms",
					PREFIX,
					frame,
					took,
					LIMIT,
					slow,
					worst
				)
			)
			lastLine = frame
			slow, worst = 0, 0
		end
		return true
	end
end
