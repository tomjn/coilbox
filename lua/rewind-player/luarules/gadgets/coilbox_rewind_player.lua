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
-- of each. The message reaches the synced half from one frame later in a
-- headless engine to more than ten in a window, so the synced half says with
-- each frame which budget it worked to (issues #4015 and #4016).
--
-- The unsynced half is also the one that can see the camera and draw. It
-- tells the player where the viewer looks, as another Lua message, so that a
-- seek makes the units in view first (issue #4008,
-- coilbox_player_view.lua). And it draws a short effect where a unit that a
-- slow seek made appears, when the synced half asks for one (issue #4009,
-- coilbox_player_arrival.lua).
--
-- It draws a builder's stream of build particles too (issue #4029,
-- coilbox_player_stream.lua). The engine draws its own only while a builder
-- really builds, and no unit of a playback does. A game whose own build effect
-- asks the engine what a builder is doing, as Beyond All Reason's does, is
-- answered from the recording: this half wraps the two calls it asks with in
-- the table every gadget's unsynced half shares, as its file loads.
--
-- A unit's own script is told when its unit moves and when a builder works
-- (issue #3797, coilbox_player_animation.lua). A Lua script's functions are not
-- something the engine hands out, so this file wraps the call a game's script
-- framework gives them to the engine with, as it loads, and keeps them.
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

--- What the synced half sends the unsynced one when a builder's work changes,
-- for the stream of build particles (issue #4029): the builder's id, the
-- command, target and power of its work, where the work is, the frame of the
-- track and 1 after a seek.
local BUILD = "coilbox_rewind_build"

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

	-- The call-ins of each Lua unit script, by unit id. A game's script
	-- framework hands them to the engine with Spring.UnitScript.CreateScript
	-- when a unit is created, and the engine keeps them where Lua cannot reach.
	-- The engine's own framework looks the call up in the table every gadget
	-- shares each time it uses it
	-- (cont/base/springcontent/LuaGadgets/Gadgets/unit_script.lua), so a wrap
	-- put there as this file loads sees every script. A framework that copied
	-- the call into a local in a file that loads before this one is not seen,
	-- and its units are told nothing.
	local scriptCallIns = {}
	do
		local UnitScript = Spring.UnitScript
		local create = UnitScript and UnitScript.CreateScript
		if create then
			UnitScript.CreateScript = function(unitID, callIns, ...)
				scriptCallIns[unitID] = callIns
				return create(unitID, callIns, ...)
			end
		end
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
			-- The unsynced half draws the stream too.
			work = engine.on.workTiming and function(unitID, command, target, power, x, y, z, frame, jumped)
				SendToUnsynced(BUILD, unitID, command, target, power, x, y, z, frame, jumped)
			end or nil,
			log = log,
			adapter = adapter,
			adapterWhy = adapterWhy,
			scriptCallIns = scriptCallIns,
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
			local made, removed, ground = player:worked()
			local make, remove, earth = player:budgets()
			SendToUnsynced(WORK, 1, frame, made, removed, ground, make, remove, earth, player:firstUnits(), player:started() and 1 or 0)
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

	function gadget:UnitDamaged(unitID, _, _, damage)
		if player then
			player:unitDamaged(unitID, damage)
		end
	end

	function gadget:UnitCreated(unitID)
		if player then
			player:unitCreated(unitID)
		end
	end

	function gadget:UnitDestroyed(unitID)
		scriptCallIns[unitID] = nil
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
	local engine = Engine.check({ Spring = Spring, Game = Game, gl = gl, GL = GL, CMD = CMD }, Engine.UNSYNCED)
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
	end

	-- A builder's stream of build particles, through the game's own particle
	-- texture, which its gamedata/resources.lua names. A game whose file does
	-- not run gets the particles with no texture.
	local stream
	-- It draws with the arrival effect's calls as well as its own.
	if engine.on.buildStream and engine.on.arrivalEffect then
		local Stream = VFS.Include("luarules/rewind_player/coilbox_player_stream.lua")
		local ok, resources = pcall(VFS.Include, "gamedata/resources.lua")
		stream = Stream.new({
			Spring = Spring,
			gl = gl,
			GL = GL,
			UnitDefs = UnitDefs,
			CMD = CMD,
			maxUnits = Game.maxUnits,
			texture = ok and Stream.textureOf(resources) or nil,
		})
	end

	-- A game's own build effect asks the engine what a builder is doing and how
	-- hard, and in a playback the engine would say nothing, since no unit
	-- builds. Beyond All Reason's asks Spring.GetUnitWorkerTask and
	-- Spring.GetUnitCurrentBuildPower in the unsynced half of a gadget, and
	-- copies both as its file loads. Every gadget's unsynced half shares this
	-- `Spring` (a handler's NewGadget), and the files load in the order of
	-- their names, so the calls are wrapped here, as this file loads, and a
	-- builder at work is answered from the recording. The synced half is left
	-- alone, since a game's synced gadgets act on what they read.
	if stream and engine.on.workerAnswer then
		local task, power = Spring.GetUnitWorkerTask, Spring.GetUnitCurrentBuildPower
		Spring.GetUnitWorkerTask = function(unitID, ...)
			local command, target = stream:task(unitID)
			if command then
				return command, target
			end
			return task(unitID, ...)
		end
		Spring.GetUnitCurrentBuildPower = function(unitID, ...)
			local given = stream:power(unitID)
			if given then
				return given
			end
			return power(unitID, ...)
		end
	end

	-- Defined only when there is something to draw, so that a gadget handler
	-- does not call it for nothing.
	if arrival or stream then
		function gadget:DrawWorld()
			if arrival then
				arrival:draw()
			end
			if stream then
				stream:draw()
			end
		end
	end

	if stream then
		function gadget:UnitDestroyed(unitID)
			stream:drop(unitID)
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

	-- The least a frame can have taken when the timer read `took`. A timer of
	-- whole milliseconds reads less than one as none.
	local TICK = micros and 0.001 or 1

	--- One of the three budgets of a seek: units made, units removed and corners
	-- of the ground set in a frame (issue #4025). `budget` is what it should be
	-- and `sent` what was last sent, after frame `sentAt`. `waiting` is whether
	-- the synced half has yet to work to it, and `delay` how many frames the last
	-- one took to arrive. `done` is how many the seek has done. The rest are the
	-- sums for a straight line through what one cost against `done`, over the
	-- `frames` of the seek that used their whole budget, each weighted by how
	-- many it did, the first of them at `from` and the last at `to`.
	local function newBudget()
		return { budget = FIRST_BUDGET, sent = FIRST_BUDGET, sentAt = 0, waiting = false, delay = 1, done = 0, frames = 0, from = 0, to = 0, sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0 }
	end

	--- How much more each one costs than the one before, from the line through
	-- the seek's frames so far, and never less than nothing. A frame of a few is
	-- dear beside a frame of many for the rest of its work, and weighs little.
	local function riseOf(b)
		local d = b.sw * b.sxx - b.sx * b.sx
		if b.frames < 2 or d <= 0 then
			return 0
		end
		return math.max(0, (b.sw * b.sxy - b.sx * b.sy) / d)
	end
	local makes, removes, grounds = newBudget(), newBudget(), newBudget()
	local budgets = { makes, removes, grounds }

	--- The most that fit in `TARGET` when the first costs `per` more than `rise`
	-- times `ahead`, and each after it `rise` more again. Each is taken to cost
	-- what the last of them does, so it errs low. A rise read over `span` is
	-- taken no further than that, so the dearest is `per` and `rise` times
	-- `span`.
	local function fits(per, rise, ahead, span)
		local b = TARGET / (per + rise * math.min(ahead, span))
		if rise > 0 and ahead < span then
			local first = per + rise * ahead
			local quadratic = (math.sqrt(first * first + 4 * rise * TARGET) - first) / (2 * rise)
			if ahead + quadratic <= span then
				b = quadratic
			else
				b = TARGET / (per + rise * span)
			end
		end
		return math.max(1, math.floor(b))
	end

	--- A frame did `count` of a budget's work in `took` milliseconds, working to
	-- a budget of `had`. Each took that long with the rest of the frame's work
	-- counted in, which only makes it more, so what fits errs low.
	--
	-- A frame that used its whole budget sets it to what fits, however many more
	-- that is (issue #4016). A message reaches the synced half some frames after
	-- it is sent, so a budget that could only double would take as many trips as
	-- doublings. What a unit costs grows as a seek fills the world, because a
	-- game's own gadgets do more for each unit created when there are more
	-- (issue #4015). So the rise in cost over the seek so far is taken to go on,
	-- through the units made at the old budget while the new one is on its way,
	-- as many frames as the last one took to arrive, and through the new budget's
	-- own, but no further than the units it was read over, since the timer's
	-- noise on a frame of one unit is not a trend. `firsts` of the frame's units
	-- were the first of their definition in the run, which cost more once and say
	-- nothing of a rise, so such a frame is left out of it.
	--
	-- A frame that used less of its budget, which the last frame of a seek does,
	-- leaves it alone unless it took longer than `TARGET`, and then cuts it.
	local function judge(b, frame, took, count, had, firsts)
		local per = (took + TICK) / count
		b.done = b.done + count
		local full = count >= had
		if not full and took <= TARGET then
			return
		end
		if full and firsts == 0 then
			local x = b.done
			if b.frames == 0 then
				b.from = x
			end
			b.frames, b.to = b.frames + 1, x
			b.sw, b.sx, b.sy = b.sw + count, b.sx + count * x, b.sy + count * per
			b.sxx, b.sxy = b.sxx + count * x * x, b.sxy + count * x * per
		end
		local rise = full and riseOf(b) or 0
		local delay = b.delay
		if b.waiting then
			delay = math.max(delay, frame - b.sentAt)
		end
		local wanted = fits(per, rise, delay * had, b.to - b.from)
		if not full then
			wanted = math.min(wanted, had)
		end
		b.budget = wanted
	end

	--- Whether the budget the synced half worked to is the last one sent, and how
	-- many frames that took.
	local function arrived(b, frame, had)
		if b.waiting and had == b.sent then
			b.waiting = false
			b.delay = math.max(1, frame - b.sentAt)
		end
	end

	--- A frame made `made` units, removed `removed` and set `ground` corners of a
	-- seek's ground in `took` milliseconds, working to the budgets `hadMake`,
	-- `hadRemove` and `hadGround`. Each costs the engine something of its own, so
	-- only a frame that did one of them says what that one costs. A frame that
	-- did none ends a seek, and the unit budgets go back to one. What a unit
	-- costs moves with how many there are, so what one seek ended on is not safe
	-- for the start of the next. The ground budget is kept from one seek to the
	-- next, since what a corner costs is the engine's work round it and does not
	-- move with what else is in the world (lua/rewind-player/README.md has the
	-- measurements).
	local function retune(frame, took, made, removed, ground, hadMake, hadRemove, hadGround, firsts, start)
		arrived(makes, frame, hadMake)
		arrived(removes, frame, hadRemove)
		arrived(grounds, frame, hadGround)
		-- The first frame of a seek into another window only read the window
		-- (issue #4037). It does not end a seek and says nothing of what a unit
		-- or a corner costs.
		if start == 1 then
			return
		end
		if made + removed + ground == 0 then
			makes.budget, removes.budget = FIRST_BUDGET, FIRST_BUDGET
			for _, b in ipairs(budgets) do
				b.done, b.frames, b.sw, b.sx, b.sy, b.sxx, b.sxy = 0, 0, 0, 0, 0, 0, 0
			end
		elseif ground > 0 and made + removed == 0 then
			judge(grounds, frame, took, ground, hadGround, 0)
		elseif made > 0 and removed + ground == 0 then
			judge(makes, frame, took, made, hadMake, firsts)
		elseif removed > 0 and made + ground == 0 then
			judge(removes, frame, took, removed, hadRemove, 0)
		end
		if makes.budget ~= makes.sent or removes.budget ~= removes.sent or grounds.budget ~= grounds.sent then
			for _, b in ipairs(budgets) do
				if b.budget ~= b.sent then
					b.sent, b.sentAt, b.waiting = b.budget, frame, true
				end
			end
			Spring.SendLuaRulesMsg(BUDGET .. makes.budget .. " " .. removes.budget .. " " .. grounds.budget)
		end
	end

	function gadget:RecvFromSynced(name, phase, frame, made, removed, ground, hadMake, hadRemove, hadGround, firsts, start)
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
		if name == BUILD then
			-- A builder's work, where the frame's work's arguments are.
			if stream then
				stream:work(phase, frame, made, removed, ground, hadMake, hadRemove, hadGround, firsts)
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
				retune(frame, took, made, removed, ground or 0, hadMake, hadRemove, hadGround or 0, firsts or 0, start)
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
