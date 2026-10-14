-- The two gadgets coilbox puts in the playback game, loaded the way the engine
-- loads one: the player (issue #3794) and the guard that keeps the base game
-- from killing a team.

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Unsynced = dofile(here .. "/unsynced.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local GADGETS = t.root() .. "/luarules/gadgets/"
local TRACK = "coilbox_rewind/track.cbtrack"

local function world()
	return Engine.new({
		unitDefs = { { name = "armcom" }, { name = "armpw" }, { name = "armsolar" } },
		featureDefs = { { name = "rock" } },
		weaponDefs = { { name = "laser", type = "LaserCannon" }, { name = "missile", type = "MissileLauncher" } },
	})
end

--- A gadget file run as the synced half of a gadget of `w`. Gives the gadget
-- and what the file returned.
local function synced(file, w, files, without)
	local env = Engine.env(t, w, files)
	if without then
		-- A global the engine lacks is nil here, where the environment raises.
		local meta = getmetatable(env)
		local base = meta.__index
		meta.__index = function(e, key)
			if key == without then
				return nil
			end
			return base(e, key)
		end
		rawset(env, without, nil)
	end
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

--- The same as the unsynced half, on the stand-in of unsynced.lua. `clock` is a
-- table whose `now` is the time in milliseconds that the timers read. With
-- `micros` set the engine has `Spring.GetTimerMicros`, and the timers read
-- microseconds. The messages the gadget sends are collected in
-- `clock.messages`, and the view's in `clock.views`. The third value is the
-- stand-in.
local function unsynced(file, lines, clock)
	local env = t.unsyncedEnv()
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return false
		end,
	}
	env.Game = { gameSpeed = 30 }
	env.VFS.Include = function(path)
		return t.load(assert(path:match("^luarules/rewind_player/(.+)$"), path), env)
	end
	local e = Unsynced.new(clock)
	e.lines = lines
	env.Spring, env.gl, env.GL = e.Spring, e.gl, e.GL
	local chunk = assert(loadfile(GADGETS .. file))
	setfenv(chunk, env)
	local returned = chunk()
	-- The line about a timer an older engine lacks is checked in engine_test.lua.
	for i = #lines, 1, -1 do
		if lines[i]:find("this engine has no Spring.GetTimerMicros", 1, true) then
			table.remove(lines, i)
		end
	end
	return env.gadget, returned, e
end

local PLAYER = "coilbox_rewind_player.lua"
local GUARD = "!coilbox_rewind_guard.lua"

--- Runs the gadget's frames from `frame` until the player says the world is
-- settled, and gives the number of the last. The gadget starts with a budget of
-- one unit a frame, until its unsynced half has timed some work (issue #3988).
local function settle(gadget, w, frame)
	for _ = 1, 50 do
		gadget:GameFrame(frame)
		if w.params.coilbox_rewind_settled == 1 then
			return frame
		end
		frame = frame + 1
	end
	error("the gadget never settled")
end

-- The player opens the track and says so.

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = gadget
	t.same("it names itself", gadget:GetInfo().name, "Coilbox rewind player")
	gadget:Initialize()
	t.same("it logs the adapter, the rules parameters nobody names and the track", #w.lines, 3)
	t.same("a game with no adapter file says it loaded none", w.lines[1], "COILBOX_REWIND_PLAYER adapter loaded: none")
	t.same(
		"the rules parameters the fixture has are left to a game with no adapter",
		w.lines[2],
		"COILBOX_REWIND_PLAYER the track has rules parameters the game's adapter does not name, so they are left to the game: supplyUsed, researchPoints, wave"
	)
	local h, info = expected.header, expected.info
	local line = w.lines[3]
	t.check("the line is the player's", line:find("^COILBOX_REWIND_PLAYER ") ~= nil, line)
	t.check("the line has the frame range", line:find("track frames " .. h.firstFrame .. " to " .. h.lastFrame .. ",", 1, true) ~= nil, line)
	t.check("the line has the window count", line:find("windows " .. h.windowCount .. ",", 1, true) ~= nil, line)
	t.check("the line has the feature count", line:find("features " .. #expected.features .. ",", 1, true) ~= nil, line)
	t.check("the line has the team count", line:find("teams " .. #info.teams .. ",", 1, true) ~= nil, line)
	t.check("the line names the map", line:find("map " .. info.map, 1, true) ~= nil, line)

	t.same("nothing is created before the first frame", w.unitCount(), 0)
	gadget:GameFrame(1)
	t.same("the first frame makes one unit, the budget the gadget starts with", w.unitCount(), 1)
	t.same("and all of the features", #w.Spring.GetAllFeatures(), 5)
	t.same("the unsynced half is told when the work starts and ends", w.sent, 2)
	t.same("by the name it listens for", w.sentName, "coilbox_rewind_work")
	t.same("with how many units the frame made", w.sentMade, 1)
	t.same("and removed", w.sentRemoved, 0)
	t.same("the frame is published", w.params.coilbox_rewind_frame, h.firstFrame)
	t.same("the world is not settled yet", w.params.coilbox_rewind_settled, 0)
	local frame = settle(gadget, w, 2)
	t.same("a few frames later it makes the track's first frame", w.unitCount(), 3)
	t.same("and is settled", w.params.coilbox_rewind_settled, 1)
	t.same("the last of them made one", w.sentMade, 1)

	t.same("a message for the player is taken", gadget:RecvLuaMsg("coilbox_rewind:seek 800", 0), true)
	t.same("a message for something else is not", gadget:RecvLuaMsg("somebody:else", 0), false)
	t.same("the budget message is the player's", gadget:RecvLuaMsg("coilbox_rewind_budget:50 50", 0), true)
	frame = settle(gadget, w, frame + 1)
	t.same("the seek is where the next frame is", w.params.coilbox_rewind_frame, 800)
	t.same("with the units of that frame", w.unitCount(), 4)

	local damage, impulse = gadget:UnitPreDamaged(100, 1, 0, 500)
	t.same("a hit does no damage", damage, 0)
	t.same("and gives no push", impulse, 0)
	local featureDamage, featureImpulse = gadget:FeaturePreDamaged(1, 0, -1, 80)
	t.same("a death's explosion does no damage to a feature", featureDamage, 0)
	t.same("and gives it no push", featureImpulse, 0)
	t.same("the gadget takes the end of a simulation frame", pcall(gadget.GameFramePost, gadget, 1), true)
	t.same("the engine is refused a wreck", gadget:AllowFeatureCreation(1, 0, 0, 0, 0), false)

	-- The engine calls UnitDamaged with the unit, its definition, its team and
	-- the damage done, for a hit that did none too (issue #4020).
	local hit = w.Spring.GetAllUnits()[1]
	local function damagedLines()
		local n = 0
		for _, line in ipairs(w.lines) do
			if line:find("a unit of the track was damaged", 1, true) then
				n = n + 1
			end
		end
		return n
	end
	gadget:UnitDamaged(hit, 1, 0, 0, 0)
	t.same("a shot that lands for no damage is not logged as damage", damagedLines(), 0)
	gadget:UnitDamaged(hit, 1, 0, 25, 0)
	t.same("a hit that did some damage is", damagedLines(), 1)

	w.Spring.CreateUnit("armpw", 0, 0, 0, 0, 0, false, false)
	gadget:GameFrame(frame + 1)
	t.same("a unit the base game creates is gone on the next frame", w.unitCount(), 4)
	w.Spring.KillTeam(1)
	t.check("a team that dies is logged", w.lines[#w.lines]:find("team 1 died", 1, true) ~= nil, w.lines[#w.lines])
end

-- The gadget wraps the call a game's script framework hands a Lua unit
-- script's call-ins to the engine with, as its file loads (issue #3797). The
-- engine still gets them, and a unit that goes is forgotten.

do
	local w = Engine.new({
		unitDefs = { { name = "armcom", script = "lua", callins = { StartMoving = function() end } }, { name = "armpw" }, { name = "armsolar" } },
		featureDefs = { { name = "rock" } },
	})
	local engines = w.Spring.UnitScript.CreateScript
	local gadget = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = gadget
	t.check("the call is wrapped as the file loads", w.Spring.UnitScript.CreateScript ~= engines)
	local unitID = w.Spring.CreateUnit("armcom", 0, 0, 0, 0, 0, false, false)
	t.same("the engine still gets a Lua script's call-ins through the wrap", type(w.units[unitID].luaScript.StartMoving), "function")
	gadget:Initialize()
	t.same("a unit that is destroyed raises nothing", pcall(w.Spring.DestroyUnit, unitID, false, true), true)

	-- An engine with no such call has no Lua unit scripts, and the gadget loads.
	local bare = world()
	bare.Spring.UnitScript.CreateScript = nil
	local ok, why = pcall(synced, PLAYER, bare, { [TRACK] = bytes })
	t.check("without the call the gadget's file still loads", ok, why)
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
	settle(gadget, w, 1)
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
	settle(gadget, w, 1)
	t.same("and the match still plays", w.unitCount(), 3)
end

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes, ["coilbox_rewind/adapter.lua"] = "error('broken')" })
	gadget:Initialize()
	t.check("an adapter file that raises is logged", w.lines[1]:find("adapter loaded: none. the adapter file raised", 1, true) ~= nil, w.lines[1])
	settle(gadget, w, 1)
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
	t.same("and a feature's too", gadget:FeaturePreDamaged(1, 0, -1, 80), nil)
	t.same("and does nothing at the end of a frame", pcall(gadget.GameFramePost, gadget, 1), true)
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

-- The work at the end of a frame, which the aim stage poses in (issue #3796),
-- is the same frame's work.

do
	local lines, clock = {}, { now = 0 }
	local gadget = unsynced(PLAYER, lines, clock)
	local function part(phase, frame, milliseconds)
		gadget:RecvFromSynced("coilbox_rewind_work", phase, frame)
		clock.now = clock.now + milliseconds
		gadget:RecvFromSynced("coilbox_rewind_work", phase + 1, frame, 0, 0)
	end
	part(0, 1, 20)
	part(2, 1, 10)
	t.same("a frame and its post frame that fit in a frame together are not logged", #lines, 0)
	part(0, 2, 20)
	part(2, 2, 20)
	t.same("a frame and its post frame that do not are", #lines, 1)
	t.check("with the two added up", lines[1]:find("the work of frame 2 took 40.0 ms", 1, true) ~= nil, lines[1])
	part(0, 40, 50)
	part(2, 40, 5)
	t.same("a frame that was slow before its end is logged", #lines, 2)
	t.check("and counted once", lines[2]:find("1 slow since the last line", 1, true) ~= nil, lines[2])
end

-- The unsynced half reads microseconds when the engine has them.

do
	local lines, clock = {}, { now = 0, micros = true }
	local gadget = unsynced(PLAYER, lines, clock)
	gadget:RecvFromSynced("coilbox_rewind_work", 0, 1)
	clock.now = clock.now + 34.5
	gadget:RecvFromSynced("coilbox_rewind_work", 1, 1, 0)
	t.same("a frame is timed in microseconds when the engine can", #lines, 1)
	t.check("to a fraction of a millisecond", lines[1]:find("took 34.5 ms", 1, true) ~= nil, lines[1])
end

-- The unsynced half works out how many units a frame may make and how many it
-- may remove (issue #3988). It is sent back as a message to the synced half,
-- which has no clock. Half a simulation frame is 16.7 ms.

do
	local lines, clock = {}, { now = 0 }
	local gadget = unsynced(PLAYER, lines, clock)
	local frame = 0
	local function work(milliseconds, made, removed)
		frame = frame + 1
		gadget:RecvFromSynced("coilbox_rewind_work", 0, frame)
		clock.now = clock.now + milliseconds
		gadget:RecvFromSynced("coilbox_rewind_work", 1, frame, made, removed or 0)
	end
	local function said()
		return table.concat(clock.messages, " | ")
	end
	local function last()
		return clock.messages[#clock.messages]
	end
	work(5, 0)
	t.same("a frame that made and removed nothing says nothing", #clock.messages, 0)
	work(1, 1)
	t.same("a unit a millisecond fits 16 in half a frame, but the budget at most doubles from one", last(), "coilbox_rewind_budget:2 1")
	work(2, 2)
	work(4, 4)
	work(8, 8)
	t.same("each frame of a seek doubles it", said(), "coilbox_rewind_budget:2 1 | coilbox_rewind_budget:4 1 | coilbox_rewind_budget:8 1 | coilbox_rewind_budget:16 1")
	work(16, 16)
	t.same("a budget that does not change is not sent again", #clock.messages, 4)
	work(48, 16)
	t.same("a frame that took 3 ms a unit cuts it to 5", last(), "coilbox_rewind_budget:5 1")
	t.same("and the slow frame is logged as before", #lines, 1)
	work(0.5, 5)
	t.same("a cheap frame of a few units cannot more than double it", last(), "coilbox_rewind_budget:10 1")
	work(0, 10)
	t.same("a frame the timer read as no time at all does not divide by nothing", last(), "coilbox_rewind_budget:20 1")
	work(60, 2)
	t.same("a budget is never below one", last(), "coilbox_rewind_budget:1 1")
	work(8, 40)
	t.same("a budget is never more than twice what the last frame made", last(), "coilbox_rewind_budget:80 1")
	local sent = #clock.messages
	work(0.3, 3)
	t.same("the few cheap units that end a seek leave it", #clock.messages, sent)
	work(3, 3)
	t.same("so do a few dear ones that still fit in half a frame", #clock.messages, sent)
	work(20, 3)
	t.same("a few that took longer than half a frame cut it, even when they did not use it all", last(), "coilbox_rewind_budget:2 1")

	work(2, 0, 4)
	t.same("a frame of removals sets the removal budget and leaves the other", last(), "coilbox_rewind_budget:2 8")
	sent = #clock.messages
	work(5, 5, 5)
	t.same("a frame that did both says what neither costs, so changes neither", #clock.messages, sent)
	work(0.4, 0, 8)
	t.same("a removal budget moves on removals alone", last(), "coilbox_rewind_budget:2 16")
	work(1, 0, 0)
	t.same("a frame with nothing to do sends both back to one, since what a unit costs moves with how many there are", last(), "coilbox_rewind_budget:1 1")
	sent = #clock.messages
	work(1, 0, 0)
	t.same("and says so once", #clock.messages, sent)
end

-- When a budget cannot be worked out (issue #3988): what the engine lacks, and
-- what the player does about it.

do
	-- No timer: nothing here can time a frame, so the player is told once that
	-- no budget will come, and a seek is shown in one frame as it was before.
	local lines, clock = {}, { now = 0, without = { GetTimer = true } }
	local gadget = unsynced(PLAYER, lines, clock)
	gadget:RecvFromSynced("coilbox_rewind_work", 0, 1)
	gadget:RecvFromSynced("coilbox_rewind_work", 1, 1, 5, 0)
	gadget:RecvFromSynced("coilbox_rewind_work", 0, 2)
	gadget:RecvFromSynced("coilbox_rewind_work", 1, 2, 5, 0)
	t.same("with no timer the player is told there is no budget, once", table.concat(clock.messages, "|"), "coilbox_rewind_budget:none")

	local w = world()
	local synced1 = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = synced1
	synced1:Initialize()
	synced1:GameFrame(1)
	t.same("the player starts with a budget of one unit", w.unitCount(), 1)
	synced1:RecvLuaMsg("coilbox_rewind_budget:none", 0)
	synced1:RecvLuaMsg("coilbox_rewind:seek 800", 0)
	synced1:GameFrame(2)
	t.same("and without a budget shows the seek in one frame", w.unitCount(), 4)
	t.same("settled", w.params.coilbox_rewind_settled, 1)
end

do
	-- No message: nothing can be sent, the budget stays at one unit made and one
	-- removed in a frame, and a seek still shows correctly, one unit a frame.
	local lines, clock = {}, { now = 0, without = { SendLuaRulesMsg = true } }
	local gadget = unsynced(PLAYER, lines, clock)
	local ok = pcall(function()
		for frame = 1, 5 do
			gadget:RecvFromSynced("coilbox_rewind_work", 0, frame)
			clock.now = clock.now + 1
			gadget:RecvFromSynced("coilbox_rewind_work", 1, frame, frame, 0)
		end
	end)
	t.same("with no way to send a message the unsynced half raises nothing", ok, true)
	t.same("and says so once, with no slow frame line since the frames were quick", #lines, 1)
	t.check("naming the call", lines[1]:find("this engine has no Spring.SendLuaRulesMsg", 1, true) ~= nil, lines[1])

	local w = world()
	local plain = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = plain
	plain:Initialize()
	plain:GameFrame(1)
	local frames = 1
	while w.params.coilbox_rewind_settled ~= 1 and frames < 50 do
		frames = frames + 1
		plain:GameFrame(frames)
	end
	t.same("a seek of three units settles at one unit a frame", frames, 3)
	t.same("with all three there", w.unitCount(), 3)
end

do
	-- No SendToUnsynced: nothing times the work, so there is no budget at all.
	local w = world()
	local plain = synced(PLAYER, w, { [TRACK] = bytes }, "SendToUnsynced")
	w.gadget = plain
	plain:Initialize()
	plain:GameFrame(1)
	t.same("without SendToUnsynced a seek is shown in one frame", w.unitCount(), 3)
	t.same("and settled", w.params.coilbox_rewind_settled, 1)
end

-- The synced half asks its unsynced half for an arrival effect (issue #4009),
-- and the unsynced half draws it.

--- The arrival effects the synced half asked for, which the stand-in keeps
-- among the world's events.
local function arrived(w)
	local list = {}
	for _, event in ipairs(w.events) do
		if event:find("^arrive ") then
			list[#list + 1] = event
		end
	end
	return list
end

do
	local w = world()
	local gadget = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = gadget
	gadget:Initialize()
	gadget:GameFrame(1)
	t.same("the frame that shows a seek asks for no effect", #arrived(w), 0)
	settle(gadget, w, 2)
	local asked = arrived(w)
	t.same("the two units made in the frames after it are asked for", #asked, 2)
	local id, x, y, z, team = asked[1]:match("^arrive (%S+) (%S+) (%S+) (%S+) (%S+)$")
	local unit = w.units[tonumber(id)]
	t.check("each with its id, a place and its team", unit ~= nil and tonumber(x) and tonumber(y) and tonumber(z) and tonumber(team) == unit.team, asked[1])
	t.same("and they do not count as timing a frame", w.sentName, "coilbox_rewind_work")
end

do
	local w = world()
	local plain = synced(PLAYER, w, { [TRACK] = bytes }, "SendToUnsynced")
	w.gadget = plain
	plain:Initialize()
	local ok, err = pcall(function()
		for frame = 1, 5 do
			plain:GameFrame(frame)
		end
	end)
	t.check("without SendToUnsynced no effect can be asked for, and nothing raises", ok and #arrived(w) == 0, err)
end

do
	local lines, clock = {}, { now = 0 }
	local gadget, _, e = unsynced(PLAYER, lines, clock)
	e.radius[104] = 25
	e.colours[1] = { 0, 1, 0 }
	t.same("the unsynced half has a world draw", type(gadget.DrawWorld), "function")
	gadget:DrawWorld()
	t.same("which draws nothing while no unit arrives", e.vertices, 0)
	t.same("the unsynced half takes an arrival", gadget:RecvFromSynced("coilbox_rewind_arrive", 104, 500, 10, 700, 1), true)
	clock.now = clock.now + 100
	gadget:DrawWorld()
	t.check("and draws its effect", e.vertices > 0, e.vertices)
	t.check("round the unit", e.box.x1 < 500 and e.box.x2 > 500 and e.box.z1 < 700 and e.box.z2 > 700)
	local sum = e.colourSum
	t.check("in the team's colour", sum[2] > sum[1] and sum[2] > sum[3], table.concat(sum, " "))
	e.clear()
	clock.now = clock.now + 5000
	gadget:DrawWorld()
	t.same("five seconds on it is gone", e.vertices, 0)
	t.same("and nothing was logged", #lines, 0)
end

-- The unsynced half tells the player where the camera looks (issue #4008).

do
	local lines, clock = {}, { now = 0 }
	local gadget, _, e = unsynced(PLAYER, lines, clock)
	local frame = 0
	local function work()
		frame = frame + 1
		gadget:RecvFromSynced("coilbox_rewind_work", 0, frame)
		gadget:RecvFromSynced("coilbox_rewind_work", 1, frame, 0, 0)
	end
	t.same("nothing is sent before a frame", #clock.views, 0)
	work()
	t.same("the first frame sends the view", #clock.views, 1)
	t.check("as the message the player takes", clock.views[1]:find("^coilbox_rewind_view:4000 3000 ") ~= nil, clock.views[1])
	work()
	t.same("a camera that stands still sends it once", #clock.views, 1)
	e.camera.x = 6000
	work()
	t.same("a camera that moves sends it again", #clock.views, 2)
	t.same("a frame looks at the camera once", e.traces, 15)
	t.same("and the budget's messages are as before", #clock.messages, 0)

	-- The player takes it.
	local w = world()
	local synced1 = synced(PLAYER, w, { [TRACK] = bytes })
	w.gadget = synced1
	synced1:Initialize()
	local logged = #w.lines
	t.same("the synced half takes the view", synced1:RecvLuaMsg(clock.views[2], 0), true)
	t.same("with nothing logged about it", #w.lines, logged)
end

do
	-- With no way to send a message there is no view to send.
	local lines, clock = {}, { now = 0, without = { SendLuaRulesMsg = true } }
	local gadget, _, e = unsynced(PLAYER, lines, clock)
	gadget:RecvFromSynced("coilbox_rewind_work", 0, 1)
	gadget:RecvFromSynced("coilbox_rewind_work", 1, 1, 0, 0)
	t.same("without Spring.SendLuaRulesMsg the camera is not looked at", e.traces, 0)

	-- With no timer the effect has no clock.
	local lines2, clock2 = {}, { now = 0, without = { GetTimer = true } }
	local blind, _, e2 = unsynced(PLAYER, lines2, clock2)
	e2.radius[104] = 25
	t.same("without a timer an arrival is still taken", blind:RecvFromSynced("coilbox_rewind_arrive", 104, 500, 10, 700, 1), true)
	t.same("and there is no world draw", blind.DrawWorld, nil)
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
