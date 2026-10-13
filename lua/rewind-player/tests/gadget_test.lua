-- The two gadgets coilbox puts in the playback game, loaded the way the engine
-- loads one: the player (issue #3794) and the guard that keeps the base game
-- from killing a team.

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local GADGETS = t.root() .. "/luarules/gadgets/"
local TRACK = "coilbox_rewind/track.cbtrack"

local function world()
	return Engine.new({
		unitDefs = { { name = "armcom" }, { name = "armpw" }, { name = "armsolar" } },
		featureDefs = { { name = "rock" } },
	})
end

--- A gadget file run as the synced half of a gadget of `w`. Gives the gadget
-- and what the file returned.
local function synced(file, w, files)
	local env = Engine.env(t, w, files)
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return true
		end,
	}
	local chunk = assert(loadfile(GADGETS .. file))
	setfenv(chunk, env)
	local returned = chunk()
	return env.gadget, returned
end

--- The same as the unsynced half. `clock` is a table whose `now` is the time
-- in milliseconds that the timers read.
local function unsynced(file, lines, clock)
	local env = t.unsyncedEnv()
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return false
		end,
	}
	env.Game = { gameSpeed = 30 }
	env.Spring = {
		Echo = function(line)
			lines[#lines + 1] = line
		end,
		GetTimer = function()
			return clock.now
		end,
		DiffTimers = function(a, b, milliseconds)
			assert(milliseconds == true, "the gadget did not ask for milliseconds")
			return a - b
		end,
	}
	local chunk = assert(loadfile(GADGETS .. file))
	setfenv(chunk, env)
	local returned = chunk()
	return env.gadget, returned
end

local PLAYER = "coilbox_rewind_player.lua"
local GUARD = "!coilbox_rewind_guard.lua"

-- The player opens the track and says so.

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = gadget
	t.same("it names itself", gadget:GetInfo().name, "Coilbox rewind player")
	gadget:Initialize()
	t.same("it logs the adapter and the track", #w.lines, 2)
	t.same("a game with no adapter file says it loaded none", w.lines[1], "COILBOX_REWIND_PLAYER adapter loaded: none")
	local h, info = expected.header, expected.info
	local line = w.lines[2]
	t.check("the line is the player's", line:find("^COILBOX_REWIND_PLAYER ") ~= nil, line)
	t.check("the line has the frame range", line:find("track frames " .. h.firstFrame .. " to " .. h.lastFrame .. ",", 1, true) ~= nil, line)
	t.check("the line has the window count", line:find("windows " .. h.windowCount .. ",", 1, true) ~= nil, line)
	t.check("the line has the feature count", line:find("features " .. #expected.features .. ",", 1, true) ~= nil, line)
	t.check("the line has the team count", line:find("teams " .. #info.teams .. ",", 1, true) ~= nil, line)
	t.check("the line names the map", line:find("map " .. info.map, 1, true) ~= nil, line)

	t.same("nothing is created before the first frame", w.unitCount(), 0)
	gadget:GameFrame(1)
	t.same("the first frame makes the track's first frame", w.unitCount(), 3)
	t.same("with its features", #w.Spring.GetAllFeatures(), 5)
	t.same("the unsynced half is told when the work starts and ends", w.sent, 2)
	t.same("by the name it listens for", w.sentName, "coilbox_rewind_work")
	t.same("the frame is published", w.params.coilbox_rewind_frame, h.firstFrame)

	t.same("a message for the player is taken", gadget:RecvLuaMsg("coilbox_rewind:seek 800", 0), true)
	t.same("a message for something else is not", gadget:RecvLuaMsg("somebody:else", 0), false)
	gadget:GameFrame(2)
	t.same("the seek is where the next frame is", w.params.coilbox_rewind_frame, 800)
	t.same("with the units of that frame", w.unitCount(), 4)

	local damage, impulse = gadget:UnitPreDamaged(100, 1, 0, 500)
	t.same("a hit does no damage", damage, 0)
	t.same("and gives no push", impulse, 0)
	t.same("the engine is refused a wreck", gadget:AllowFeatureCreation(1, 0, 0, 0, 0), false)

	w.Spring.CreateUnit("armpw", 0, 0, 0, 0, 0, false, false)
	gadget:GameFrame(3)
	t.same("a unit the base game creates is gone on the next frame", w.unitCount(), 4)
	w.Spring.KillTeam(1)
	t.check("a team that dies is logged", w.lines[#w.lines]:find("team 1 died", 1, true) ~= nil, w.lines[#w.lines])
end

-- The player reads the adapter the playback game holds (issue #3799).

do
	local w = world()
	local gadget = synced(PLAYER, w, {
		[TRACK] = bytes,
		["coilbox_rewind/adapter.lua"] = "return { name = 'Test game', units = { 'armpw' }, features = { 'rock' },"
			.. " hooks = { afterFrame = function() Spring.Echo('hook ran') end } }",
	})
	w.gadget = gadget
	gadget:Initialize()
	t.check("the adapter is named in the log", w.lines[1]:find("COILBOX_REWIND_PLAYER adapter loaded: Test game.", 1, true) == 1, w.lines[1])
	gadget:GameFrame(1)
	t.same("a hidden definition is not created", w.unitNamed("armpw"), nil)
	t.same("the others are", w.unitCount(), 2)
	t.same("a skipped feature is not created", #w.Spring.GetAllFeatures(), 0)
	t.same("the hook ran with the gadget's environment", w.lines[#w.lines], "hook ran")
end

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes, ["coilbox_rewind/adapter.lua"] = "return { problem = 'it was not for this game' }" })
	gadget:Initialize()
	t.same(
		"an adapter coilbox could not use is logged with its reason",
		w.lines[1],
		"COILBOX_REWIND_PLAYER adapter loaded: none. it was not for this game"
	)
	gadget:GameFrame(1)
	t.same("and the match still plays", w.unitCount(), 3)
end

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes, ["coilbox_rewind/adapter.lua"] = "error('broken')" })
	gadget:Initialize()
	t.check("an adapter file that raises is logged", w.lines[1]:find("adapter loaded: none. the adapter file raised", 1, true) ~= nil, w.lines[1])
	gadget:GameFrame(1)
	t.same("and the match still plays", w.unitCount(), 3)
end

-- A game with no track, or a bad one.

do
	local w = world()
	local gadget = synced(PLAYER, w, {})
	gadget:Initialize()
	t.same("a game with no track logs one line", #w.lines, 1)
	t.check("the line says what is missing", w.lines[1]:find("failed: the game holds no file at coilbox_rewind/track.cbtrack", 1, true) ~= nil, w.lines[1])
	gadget:GameFrame(1)
	t.same("and the gadget then does nothing on a frame", w.sent, 0)
	t.same("leaves damage alone", gadget:UnitPreDamaged(100, 1, 0, 500), nil)
	t.same("lets the engine leave wrecks", gadget:AllowFeatureCreation(1, 0, 0, 0, 0), true)
	t.same("and takes no message", gadget:RecvLuaMsg("coilbox_rewind:play", 0), false)
end

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = "not a track" })
	gadget:Initialize()
	t.same("a file that is not a track logs one line", #w.lines, 1)
	t.check("the line is a failure", w.lines[1]:find("COILBOX_REWIND_PLAYER failed: ", 1, true) == 1, w.lines[1])
end

-- The unsynced half times a frame's work.

do
	local lines, clock = {}, { now = 0 }
	local gadget = unsynced(PLAYER, lines, clock)
	local frame = 0
	local function work(milliseconds)
		frame = frame + 1
		gadget:RecvFromSynced("coilbox_rewind_work", 0, frame)
		clock.now = clock.now + milliseconds
		return gadget:RecvFromSynced("coilbox_rewind_work", 1, frame)
	end
	t.same("the unsynced half takes the synced half's message", work(5), true)
	t.same("a frame's work that fits in a frame is not logged", #lines, 0)
	work(33)
	t.same("work as long as 33 ms is not logged, since a frame lasts 33.3", #lines, 0)
	work(34)
	t.same("work longer than a simulation frame is logged", #lines, 1)
	t.check("the line is the player's and says how long", lines[1]:find("^COILBOX_REWIND_PLAYER slow frame: the work of frame 3 took 34.0 ms") ~= nil, lines[1])
	t.check("and how long a frame lasts", lines[1]:find("lasts 33.3 ms", 1, true) ~= nil, lines[1])
	for _ = 1, 29 do
		work(50)
	end
	t.same("the slow frames of the next second are counted, not logged", #lines, 1)
	work(80)
	t.same("the first slow frame after it is logged", #lines, 2)
	t.check("with how many there were and the slowest", lines[2]:find("30 slow since the last line, the slowest 80.0 ms", 1, true) ~= nil, lines[2])
	t.same("a message that is somebody else's is left", gadget:RecvFromSynced("other", 1, 9), false)
end

-- The guard.

do
	local w = world()
	local Spring = w.Spring
	local kept = Spring.KillTeam
	local gadget, returned = synced(GUARD, w)
	t.same("the guard names itself", gadget:GetInfo().name, "Coilbox rewind guard")
	t.check("the guard stays loaded", returned ~= false)
	Spring.KillTeam(1)
	Spring.KillTeam(0)
	t.same("a team the base game asks to kill is alive", w.teams[1].dead, false)
	t.same("the first ask is logged and the rest are not", #w.lines, 1)
	t.check("the line says which team", w.lines[1]:find("kill team 1", 1, true) ~= nil, w.lines[1])
	Spring.GameOver({ 0 })
	Spring.GameOver({ 0 })
	t.same("the match is not ended", w.gameOver, nil)
	t.same("the first ask to end it is logged", #w.lines, 2)
	t.same("the team can still hold a unit", Spring.CreateUnit("armpw", 0, 0, 0, 0, 1, false, false) ~= nil, true)

	-- Why the guard has to load first: a copy made before it is the real call.
	kept(0)
	t.same("a copy of the call made before the guard loaded still kills", w.teams[0].dead, true)

	local _, unsyncedReturn = unsynced(GUARD, {}, { now = 0 })
	t.same("the unsynced half does not load the guard", unsyncedReturn, false)
end

-- The guard's file name sorts before any gadget a game names with letters,
-- digits or an underscore, which is the order gadget files load in.
do
	local names = { "game_end.lua", "0_first.lua", "_first.lua", "API_first.lua", "a.lua", GUARD }
	table.sort(names)
	t.same("the guard's file sorts first", names[1], GUARD)
end

t.report()
