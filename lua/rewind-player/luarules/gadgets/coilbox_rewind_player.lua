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
-- Nothing takes damage. `UnitPreDamaged` gives every hit no damage and no
-- push, and the track owns health. The shots the player creates do not rest
-- on that: each is created with no damage to do.
--
-- A frame's work is timed. Synced Lua has no clock, so the synced half tells
-- the unsynced half when the work starts and ends (`SendToUnsynced` is a call
-- and not a message, so it costs no frame), and the unsynced half logs a line
-- when it took longer than one simulation frame lasts.
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

if gadgetHandler:IsSyncedCode() then
	local player
	-- What the engine has, from coilbox_player_engine.lua.
	local engine

	local function log(text)
		Spring.Echo(PREFIX .. text)
	end

	function gadget:Initialize()
		-- What the engine has comes first: the modules below take calls from it as
		-- they load, and a missing one would stop them with an error.
		local Engine = VFS.Include("luarules/rewind_player/coilbox_player_engine.lua")
		engine = Engine.check({ Spring = Spring, VFS = VFS, Game = Game, CMD = CMD, SendToUnsynced = SendToUnsynced }, Engine.SYNCED)
		for _, line in ipairs(engine.lines) do
			log(line)
		end
		if engine.note and Spring.SetGameRulesParam then
			Spring.SetGameRulesParam(Engine.NOTE_PARAM, engine.note)
		end
		if engine.refused then
			return
		end

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
		local adapter, adapterWhy
		if engine.on.adapter then
			adapter, adapterWhy = Adapter.load(VFS)
		else
			adapterWhy = "the engine has no VFS.FileExists"
		end
		local made, madeWhy = Player.new(track, {
			engine = engine,
			modOptions = Spring.GetModOptions(),
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
		if engine.on.workTiming then
			SendToUnsynced(WORK, 0, frame)
		end
		player:frame()
		if engine.on.workTiming then
			SendToUnsynced(WORK, 1, frame)
		end
	end

	function gadget:RecvLuaMsg(message)
		return player ~= nil and player:message(message)
	end

	function gadget:UnitPreDamaged()
		if player then
			return 0, 0
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
	-- What this half needs from the engine, from coilbox_player_engine.lua.
	local Engine = VFS.Include("luarules/rewind_player/coilbox_player_engine.lua")
	local engine = Engine.check({ Spring = Spring, Game = Game }, Engine.UNSYNCED)
	for _, line in ipairs(engine.lines) do
		Spring.Echo(PREFIX .. line)
	end

	-- How long one simulation frame lasts, in milliseconds. Work that takes
	-- longer than this cannot keep up with the match's own speed.
	local LIMIT = Game.gameSpeed and 1000 / Game.gameSpeed

	-- After a line, slow frames are counted and not logged for a second of
	-- frames, so a run of them does not make itself slower.
	local QUIET_FRAMES = Game.gameSpeed

	local started
	local lastLine
	local slow, worst = 0, 0

	function gadget:RecvFromSynced(name, phase, frame)
		if name ~= WORK then
			return false
		end
		if not engine.on.workTimingLine then
			return true
		end
		if phase == 0 then
			started = Spring.GetTimer()
			return true
		end
		if not started then
			return true
		end
		local took = Spring.DiffTimers(Spring.GetTimer(), started, true)
		started = nil
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
