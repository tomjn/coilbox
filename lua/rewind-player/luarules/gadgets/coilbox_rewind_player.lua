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
-- `GameFramePost` does not reach every gadget (issue #4002). An engine before
-- 105.1.1-2590 does not make the call, and a game's gadget handler may not
-- pass it on. The player finds out by whether the call came, and this file
-- installs the call-in when it did not. coilbox_player.lua has the rest.
--
-- A frame's work is timed. Synced Lua has no clock, so the synced half tells
-- the unsynced half when the work starts and ends (`SendToUnsynced` is a call
-- and not a message, so it costs no frame), and the unsynced half logs a line
-- when it took longer than one simulation frame lasts. A frame's work is what
-- the player does in `GameFrame` and in `GameFramePost` together.
--
-- The same timing sets how much a seek may do in one frame (issue #3988). A
-- seek can need hundreds of units made or removed, at a cost for each that only
-- the engine knows. The synced half says how many it made and how many it
-- removed in the frame, the unsynced half works out how many of each fit in half
-- a simulation frame and sends that back as a Lua message, and the player does
-- no more than that in a frame until it hears another. The player starts at one
-- of each. The message reaches the synced half about two frames later.
--
-- The unsynced half is also the one that can see the camera and draw. It
-- tells the player where the viewer looks, as another Lua message, so that a
-- seek makes the units in view first (issue #4008,
-- coilbox_player_view.lua). And it draws a short effect where a unit that a
-- slow seek made appears, when the synced half asks for one (issue #4009,
-- coilbox_player_arrival.lua).
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

--- What the synced half sends the unsynced one for a unit that wants an
-- arrival effect: the unit's id, its x, y and z and its team.
local ARRIVE = "coilbox_rewind_arrive"

--- What the synced half sends the unsynced one for a line of the log, which
-- the unsynced half writes to the playback's log file (issue #4032,
-- coilbox_log.lua). The lines are for whoever works on the player, and a viewer
-- would read them as errors, so none goes to the engine's log, which the
-- console shows.
local LOG = "coilbox_rewind_log"

if gadgetHandler:IsSyncedCode() then
	local player
	-- What the engine has, from coilbox_player_engine.lua.
	local engine

	-- The unsynced half loads after every synced gadget has, so a line sent
	-- before the first frame would reach nobody. Those lines wait for it.
	local waiting = {}
	local function log(text)
		local line = PREFIX .. text
		if type(SendToUnsynced) ~= "function" then
			Spring.Echo(line)
		elseif waiting then
			waiting[#waiting + 1] = line
		else
			SendToUnsynced(LOG, line)
		end
	end
	-- The guard gadget's lines come this way too.
	if GG then
		GG.coilboxRewindLog = log
	end

	--- Makes the engine's call at the end of a frame reach this gadget in a game
	-- whose gadget handler does not pass it on (issue #4002). A handler hands a
	-- gadget its own global table as `_G`, and the engine calls a call-in when
	-- that table has a function of its name and it has been told to look
	-- (CLuaHandle::UpdateCallIn). True when it did both. The player asks for this
	-- after a frame that ended without the call, and finds out by the next frame
	-- whether it helped. A handler that rebuilds its call-ins takes the global
	-- away again, and the player then asks again.
	local function installFramePost()
		local globals = _G
		if type(globals) ~= "table" then
			return false
		end
		local g = gadget
		globals.GameFramePost = function(frame)
			g:GameFramePost(frame)
		end
		Script.UpdateCallIn("GameFramePost")
		return true
	end

	function gadget:Initialize()
		-- What the engine has comes first: the modules below take calls from it as
		-- they load, and a missing one would stop them with an error.
		local Engine = VFS.Include("luarules/rewind_player/coilbox_player_engine.lua")
		engine = Engine.check({ Spring = Spring, VFS = VFS, Game = Game, CMD = CMD, SendToUnsynced = SendToUnsynced, Script = Script }, Engine.SYNCED)
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

		-- Playback that does not start says why on the timeline too, since a
		-- viewer sees nothing of the log.
		local function failed(why)
			log("failed: " .. tostring(why))
			if not engine.note and Spring.SetGameRulesParam then
				Spring.SetGameRulesParam(Engine.NOTE_PARAM, "Playback did not start: " .. tostring(why))
			end
		end
		local fetch, why = Fetch.fromVFS()
		if not fetch then
			failed(why)
			return
		end
		local track, openWhy = Track.open(fetch)
		if not track then
			failed(openWhy)
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
			-- Without SendToUnsynced nothing times the work, so nothing sets a budget
			-- and a seek is shown in one frame, as before issue #3988.
			budget = engine.on.workTiming and FIRST_BUDGET or nil,
			installFramePost = engine.on.frameEnd and installFramePost or nil,
			-- The unsynced half draws the effect, so without SendToUnsynced none
			-- is asked for.
			arrive = engine.on.workTiming and function(unitID, x, y, z, team)
				SendToUnsynced(ARRIVE, unitID, x, y, z, team)
			end or nil,
			log = log,
			adapter = adapter,
			adapterWhy = adapterWhy,
		})
		if not made then
			failed(madeWhy)
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
		if waiting then
			local lines = waiting
			waiting = nil
			for i = 1, #lines do
				SendToUnsynced(LOG, lines[i])
			end
		end
		if not player then
			return
		end
		if engine.on.workTiming then
			SendToUnsynced(WORK, 0, frame)
		end
		player:frame()
		if engine.on.workTiming then
			SendToUnsynced(WORK, 1, frame, player:worked())
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

	function gadget:FeaturePreDamaged()
		if player then
			return 0, 0
		end
	end

	-- The work at the end of a frame is timed as well, with phases 2 and 3, and
	-- the unsynced half adds it to the frame's.
	function gadget:GameFramePost(frame)
		if not player then
			return
		end
		if engine.on.workTiming then
			SendToUnsynced(WORK, 2, frame)
		end
		player:framePost()
		if engine.on.workTiming then
			SendToUnsynced(WORK, 3, frame)
		end
	end

	function gadget:Shutdown()
		if player then
			player:shutdown()
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
	local engine = Engine.check({ Spring = Spring, Game = Game, gl = gl, GL = GL }, Engine.UNSYNCED)
	-- The playback's log file, emptied as this half loads, which is before any
	-- widget writes to it.
	local write = VFS.Include("luarules/rewind_player/coilbox_log.lua").new(io, Spring.Echo, true)
	for _, line in ipairs(engine.lines) do
		write(PREFIX .. line)
	end

	-- How long one simulation frame lasts, in milliseconds. Work that takes
	-- longer than this cannot keep up with the match's own speed.
	local LIMIT = Game.gameSpeed and 1000 / Game.gameSpeed

	-- After a line, slow frames are counted and not logged for a second of
	-- frames, so a run of them does not make itself slower.
	local QUIET_FRAMES = Game.gameSpeed

	-- Half a frame is what a seek's work aims at. The rest of the frame is the
	-- engine's own simulation and drawing, and the slow frame line is what says
	-- whether that left enough.
	local TARGET = LIMIT and LIMIT / 2

	-- Microseconds where the engine has them, which it does from 2025.01.6. The
	-- other timer gives whole milliseconds.
	local micros = engine.on.microTimer
	local clock = micros and Spring.GetTimerMicros or Spring.GetTimer
	-- Whether the player has been told there is no budget to wait for.
	local toldNone = false

	-- Where the viewer looks, sent to the player as a message. Without a way to
	-- send one there is nothing to look for.
	local view
	if engine.on.view and engine.on.budgetMessage then
		view = VFS.Include("luarules/rewind_player/coilbox_player_view.lua").new(Spring)
	end

	-- The effect where a unit arrives. Its clock is the frame timer's.
	local arrival
	if engine.on.arrivalEffect and engine.on.workTimingLine then
		local epoch = clock()
		arrival = VFS.Include("luarules/rewind_player/coilbox_player_arrival.lua").new({
			Spring = Spring,
			gl = gl,
			GL = GL,
			seconds = function()
				return Spring.DiffTimers(clock(), epoch, true, micros) / 1000
			end,
		})
		-- Defined only when there is an effect to draw, so that a gadget
		-- handler does not call it for nothing.
		function gadget:DrawWorld()
			arrival:draw()
		end
	end

	-- The engine's own pause and speed (issue #4033). The player's pause is its
	-- own, and the world only moves on simulation frames, so a paused engine
	-- would hold a seek too, and a faster one would play faster than the timeline
	-- says. A game can do either with a key or a chat command, as Beyond All
	-- Reason's pause key does. So the engine is given back its speed and the ask
	-- goes to the player as the timeline's own: a pause plays or pauses, and a
	-- speed up or down is the next speed up or down. The engine stays paused, or
	-- at its new speed, until the server answers, over several drawn frames, so
	-- each is handed on once.
	if engine.on.enginePace then
		-- Whether a pause has been handed on, and the speed last handed on.
		local unpausing, handled = false, 1
		local function tell(command)
			if engine.on.budgetMessage then
				Spring.SendLuaRulesMsg("coilbox_rewind:" .. command)
			end
		end
		function gadget:Update()
			local wanted, _, paused = Spring.GetGameSpeed()
			if paused and not unpausing then
				unpausing = true
				Spring.SendCommands("pause 0")
				tell("toggle")
			elseif not paused then
				unpausing = false
			end
			if wanted ~= 1 and wanted ~= handled then
				Spring.SendCommands("setspeed 1")
				tell(wanted > handled and "faster" or "slower")
			end
			handled = wanted
		end
	end

	local started
	-- How long the work of the frame's GameFrame took, for its GameFramePost to
	-- add to.
	local framed = 0
	local lastLine
	local slow, worst = 0, 0
	-- How many units a frame may make and remove, and how many corners of the
	-- ground it may set for a seek (issue #4025), as last sent.
	local makeBudget, removeBudget, groundBudget = FIRST_BUDGET, FIRST_BUDGET, FIRST_BUDGET

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

	--- A frame made `made` units, removed `removed` and set `ground` corners of a
	-- seek's ground in `took` milliseconds. Each costs the engine something of
	-- its own, so only a frame that did one of them says what that one costs. A
	-- frame that did none ends a seek, and the unit budgets go back to one. What
	-- a unit costs moves with how many there are, from 0.28 to 0.5 ms to make and
	-- from 0.13 to 0.37 ms to remove in a headless run of issue #3988 as the count
	-- went from none to 400 and from 400 to none, so what one seek ended on is not
	-- safe for the start of the next. Each starts from one and doubles each frame
	-- while the cost allows. The ground budget is kept from one seek to the next,
	-- since what a corner costs is the engine's work round it and does not move
	-- with what else is in the world (lua/rewind-player/README.md has the
	-- measurements). A frame that took too long still cuts it.
	local function retune(took, made, removed, ground)
		local make, remove, earth = makeBudget, removeBudget, groundBudget
		if made + removed + ground == 0 then
			make, remove = FIRST_BUDGET, FIRST_BUDGET
		elseif ground > 0 and made + removed == 0 then
			earth = fit(took, ground, groundBudget)
		elseif made > 0 and removed + ground == 0 then
			make = fit(took, made, makeBudget)
		elseif removed > 0 and made + ground == 0 then
			remove = fit(took, removed, removeBudget)
		end
		if make ~= makeBudget or remove ~= removeBudget or earth ~= groundBudget then
			makeBudget, removeBudget, groundBudget = make, remove, earth
			Spring.SendLuaRulesMsg(BUDGET .. make .. " " .. remove .. " " .. earth)
		end
	end

	function gadget:RecvFromSynced(name, phase, frame, made, removed, ground)
		if name == LOG then
			write(phase)
			return true
		end
		if name == ARRIVE then
			-- A unit's id, its place and its team, where the work's arguments are.
			if arrival then
				arrival:add(phase, frame, made, removed, ground)
			end
			return true
		end
		if name ~= WORK then
			return false
		end
		-- Before the work is timed, so that looking at the camera is not counted
		-- as the player's.
		if phase == 0 and view then
			local text = view:poll()
			if text then
				Spring.SendLuaRulesMsg(text)
			end
		end
		if not engine.on.workTimingLine then
			-- Nothing here can time a frame, so no budget will come. The player is
			-- told once to stop waiting for one.
			if not toldNone and engine.on.budgetMessage then
				toldNone = true
				Spring.SendLuaRulesMsg(BUDGET .. "none")
			end
			return true
		end
		if phase == 0 or phase == 2 then
			started = clock()
			return true
		end
		if not started then
			return true
		end
		local took = Spring.DiffTimers(clock(), started, true, micros)
		started = nil
		if phase == 3 then
			-- The end of the frame, which the aim stage poses in. It is the same
			-- frame's work, so the two are judged together, and a frame that was
			-- slow before its end has been counted already.
			if framed > LIMIT then
				return true
			end
			took = framed + took
		else
			framed = took
			if made and removed and engine.on.budgetMessage then
				retune(took, made, removed, ground or 0)
			end
		end
		if took <= LIMIT then
			return true
		end
		slow = slow + 1
		if took > worst then
			worst = took
		end
		if not lastLine or frame - lastLine >= QUIET_FRAMES then
			write(
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
