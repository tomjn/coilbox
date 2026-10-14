-- The queued building ghosts (issue #3804): which buildings a builder has queued
-- at a time, as the time moves forward, backward and in jumps, what is left out,
-- what is drawn and how, what the widget remembers and what it needs from the
-- engine. The engine here is a stand-in, so this shows the logic and the
-- arithmetic and nothing about how a ghost looks.

-- The engine runs plain Lua 5.1, which has no tracing compiler. LuaJIT's builds
-- traces as a loop gets hot, and those are memory the count of what a draw
-- allocates would show.
if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local FakeTrack = dofile(here .. "/fake_track.lua")

local MODULE = t.root() .. "/luaui/rewind_ghosts/coilbox_ghosts.lua"
local WIDGET = t.root() .. "/luaui/widgets/coilbox_rewind_ghosts.lua"

local Ghosts
do
	local chunk = assert(loadfile(MODULE))
	setfenv(chunk, t.unsyncedEnv())
	Ghosts = chunk()
end

-- The game's definitions. The track also names armwall, which this game lacks.
local GAME_DEFS = { armcom = 10, armmex = 11, armsolar = 12 }
local TRACK_DEFS = { "armcom", "armmex", "armsolar", "armwall" }
local COM, MEX, SOLAR, WALL = 0, 1, 2, 3

local function gameDefs()
	local names, defs = {}, {}
	for name, id in pairs(GAME_DEFS) do
		names[name] = { id = id }
		defs[id] = { name = name, floatOnWater = false }
	end
	return names, defs
end

--- The slice of the engine the ghosts use. `e.shapes` counts what was drawn and
-- `e.calls` is what the draw did in order, when `e.record` is set.
local function engine()
	local e = { params = {}, lines = {}, calls = {}, shapes = 0, pushes = 0 }
	local names, defs = gameDefs()
	e.UnitDefNames, e.UnitDefs = names, defs
	function e.height(x, z)
		return 100 + x / 100 - z / 1000
	end
	e.Spring = {
		GetGameRulesParam = function(name)
			return e.params[name]
		end,
		GetGroundHeight = function(x, z)
			return e.height(x, z)
		end,
		Echo = function(line)
			e.lines[#e.lines + 1] = line
		end,
	}
	local function note(...)
		if e.record then
			e.calls[#e.calls + 1] = table.concat({ ... }, " ")
		end
	end
	e.gl = {
		PushMatrix = function()
			e.pushes = e.pushes + 1
			note("push")
		end,
		PopMatrix = function()
			e.pushes = e.pushes - 1
			note("pop")
		end,
		Translate = function(x, y, z)
			if e.record then
				note("translate", x, y, z)
			end
		end,
		Rotate = function(degrees, x, y, z)
			if e.record then
				note("rotate", degrees, x, y, z)
			end
		end,
		UnitShape = function(def, team, rawState, toScreen, opaque)
			e.shapes = e.shapes + 1
			if e.record then
				note("shape", def, team, tostring(rawState), tostring(toScreen), tostring(opaque))
			end
		end,
	}
	return e
end

-- The track. Three builders' worth of queues, a mex that gets built where the
-- first one was queued, a solar panel that is built where the second was, a
-- wall the game does not have, and a mex far from anything queued.
local MEX_ITEM = { def = MEX, x = 480, z = 8128, facing = 0 }
local SOLAR_ITEM = { def = SOLAR, x = 600, z = 700, facing = 2 }
local WALL_ITEM = { def = WALL, x = 40, z = 40, facing = 1 }
local MEX_TWO = { def = MEX, x = 900, z = 900, facing = 3 }

local function spec()
	return {
		first = 0,
		last = 3000,
		windowLength = 900,
		teams = { 0, 1, 2 },
		unitDefs = TRACK_DEFS,
		units = {
			{
				def = COM,
				team = 1,
				first = 0,
				last = 3000,
				queue = {
					{ frame = 100, items = { MEX_ITEM } },
					{ frame = 300, items = { MEX_ITEM, SOLAR_ITEM } },
					{ frame = 1000, items = { SOLAR_ITEM, WALL_ITEM } },
					{ frame = 1500, items = {} },
					{ frame = 2000, items = { MEX_TWO } },
				},
			},
			{
				def = COM,
				team = 2,
				first = 500,
				last = 2500,
				queue = {
					{ frame = 500, items = { SOLAR_ITEM } },
					{ frame = 1800, items = {} },
				},
			},
			-- Stands within a grid square of the first mex's place, as a mex built
			-- there does (the real one was queued at 480,8128 and stood at 488,8136).
			{ def = MEX, team = 1, first = 150, last = 1200, at = { 488, 50, 8136 } },
			{ def = SOLAR, team = 1, first = 1100, last = 3000, at = { 600, 50, 700 } },
			{ def = MEX, team = 1, first = 2100, last = 2600, at = { 900, 50, 900 } },
			-- A mex that is not where anything is queued.
			{ def = MEX, team = 1, first = 0, last = 3000, at = { 5000, 50, 5000 } },
			-- One 9 elmos from the second mex's place, which is not that mex.
			{ def = MEX, team = 1, first = 2000, last = 3000, at = { 909, 50, 900 } },
		},
	}
end

--- What the track should show at `frame`, worked out from the table the track
-- was made from and not from anything the ghosts keep. One string for each
-- ghost, in no order.
local function expected(source, frame)
	local seen, list = {}, {}
	for _, unit in ipairs(source.units) do
		if unit.queue and frame >= unit.first and frame <= unit.last then
			local held
			for _, key in ipairs(unit.queue) do
				if key.frame <= frame then
					held = key
				end
			end
			for _, item in ipairs(held and held.items or {}) do
				local id = item.def .. ":" .. item.x .. ":" .. item.z
				if not seen[id] then
					seen[id] = true
					local built = false
					for _, other in ipairs(source.units) do
						if other.def == item.def and other.at and frame >= other.first and frame <= other.last then
							if math.abs(other.at[1] - item.x) <= 8 and math.abs(other.at[3] - item.z) <= 8 then
								built = true
							end
						end
					end
					local game = GAME_DEFS[TRACK_DEFS[item.def + 1]]
					if game and not built then
						list[#list + 1] = string.format("%d:%d:%s:%s:%d", unit.team, game, item.x, item.z, item.facing)
					end
				end
			end
		end
	end
	table.sort(list)
	return list
end

--- What the ghosts hold, in the same form.
local function held(g)
	local list = {}
	for k = 1, g.count do
		list[k] = string.format("%d:%d:%s:%s:%d", g.teams[k], g.defs[k], g.xs[k], g.zs[k], g.facings[k])
	end
	table.sort(list)
	return list
end

local function joined(list)
	return #list == 0 and "none" or table.concat(list, " ")
end

--- Ghosts over a fresh track, at `frame`.
local function ghosts(e, source, extra)
	local track = FakeTrack.new(source or spec())
	local engineTable = { Spring = e.Spring, gl = e.gl, UnitDefNames = e.UnitDefNames, UnitDefs = e.UnitDefs }
	for key, value in pairs(extra or {}) do
		engineTable[key] = value
	end
	local g = Ghosts.new(engineTable, track)
	return g, track
end

local function at(e, g, frame)
	e.params.coilbox_rewind_frame = frame
	g:update()
end

-- The queue at a time.

do
	local e = engine()
	local g = ghosts(e)
	at(e, g, 0)
	t.same("before any builder has queued anything, nothing is drawn", g.count, 0)
	at(e, g, 100)
	t.same("a queued building is a ghost", joined(held(g)), "1:11:480:8128:0")
	at(e, g, 149)
	t.same("until a unit stands where it would", g.count, 1)
	at(e, g, 150)
	t.same("a unit of that building standing within the build grid hides it", g.count, 0)
	at(e, g, 300)
	t.same("a second item shows beside the first that is under way", joined(held(g)), "1:12:600:700:2")
	at(e, g, 520)
	t.same("a second builder queuing the same building makes one ghost", g.count, 1)
	at(e, g, 1000)
	t.same("an item of a definition the game lacks is left out", joined(held(g)), "1:12:600:700:2")
	t.check("with one line to say the definition is missing", #e.lines == 1 and e.lines[1]:find("1 of the track's 4 unit definitions", 1, true), e.lines[1])
	t.check("starting with the widget's prefix", e.lines[1]:sub(1, #Ghosts.PREFIX) == Ghosts.PREFIX)
	at(e, g, 1099)
	t.same("a solar panel waiting to be built is a ghost", g.count, 1)
	at(e, g, 1100)
	t.same("and is not once one stands there", g.count, 0)
	at(e, g, 1600)
	t.same("a builder with an empty queue shows nothing", g.count, 0)
	at(e, g, 2000)
	t.same("a unit 9 elmos off is not the queued building", joined(held(g)), "1:11:900:900:3")
	at(e, g, 2100)
	t.same("a unit 0 elmos off is", g.count, 0)
	at(e, g, 2700)
	t.same("a building that has gone while it is still queued is a ghost again", joined(held(g)), "1:11:900:900:3")
	t.same("the missing definition was reported once", #e.lines, 1)
end

-- The queue as the time moves.

do
	local source = spec()
	local e = engine()
	local g = ghosts(e, source)
	local worst
	local function compare(frame)
		at(e, g, frame)
		local got, wanted = joined(held(g)), joined(expected(source, frame))
		if got ~= wanted and not worst then
			worst = string.format("frame %d: got %s, wanted %s", frame, got, wanted)
		end
	end
	for frame = 0, 3000 do
		compare(frame)
	end
	t.check("forward over the whole track, one frame at a time, the ghosts are the table's", worst == nil, worst)
	worst = nil
	for frame = 3000, 0, -1 do
		compare(frame)
	end
	t.check("backward, the same", worst == nil, worst)
	worst = nil
	local jumps = { 2900, 10, 1700, 150, 1099, 2050, 899, 900, 901, 1800, 1799, 0, 3000, 1100, 1099, 2600, 2601, 1200, 1199 }
	for _, frame in ipairs(jumps) do
		compare(frame)
	end
	t.check("after a seek to any of 19 frames, across the windows and their edges, the same", worst == nil, worst)
	worst = nil
	for frame = 1000, 1010, 0.25 do
		compare(frame)
	end
	t.check("a time between two frames is read as it is", worst == nil, worst)
end

-- The time is the player's, and the player may not be there.

do
	local e = engine()
	local g = ghosts(e)
	g:update()
	t.same("with no player there is nothing", g.count, 0)
	at(e, g, 300)
	t.same("with one there are ghosts", g.count, 1)
	e.params.coilbox_rewind_frame = nil
	g:update()
	t.same("and when it goes there are none", g.count, 0)
	g:draw()
	t.same("a draw then draws nothing", e.shapes, 0)
end

-- A window that cannot be read.

do
	local source = spec()
	source.broken = { [1] = true }
	local e = engine()
	local g = ghosts(e, source)
	at(e, g, 1200)
	t.same("a window that does not read shows nothing", g.count, 0)
	t.check("and says so once", #e.lines == 2 and e.lines[2]:find("window 1 of the track could not be read", 1, true), e.lines[2])
	at(e, g, 1201)
	t.same("and not again", #e.lines, 2)
	at(e, g, 300)
	t.same("the others still read", g.count, 1)
end

-- Drawing.

do
	local e = engine()
	e.record = true
	local g = ghosts(e)
	at(e, g, 300)
	g:draw()
	local x, z = 600, 700
	local y = e.height(x, z)
	t.same(
		"a ghost is the engine's own shape of the definition, in its team's colour, translucent, at the ground",
		table.concat(e.calls, "|"),
		table.concat({
			"push",
			"translate " .. x .. " " .. y .. " " .. z,
			"rotate 180 0 1 0",
			"shape 12 1 false false false",
			"pop",
		}, "|")
	)
	t.same("every matrix it pushed it popped", e.pushes, 0)

	for facing, degrees in pairs({ [0] = 0, [1] = 90, [2] = 180, [3] = 270 }) do
		local f = engine()
		f.record = true
		local one = spec()
		one.units[1].queue = { { frame = 0, items = { { def = SOLAR, x = 10, z = 20, facing = facing } } } }
		local h = ghosts(f, one)
		at(f, h, 10)
		h:draw()
		t.same("facing " .. facing .. " turns the shape " .. degrees .. " degrees", f.calls[3], "rotate " .. degrees .. " 0 1 0")
	end

	local sea = engine()
	sea.UnitDefs[GAME_DEFS.armsolar].floatOnWater = true
	sea.height = function()
		return -40
	end
	sea.record = true
	local floater = ghosts(sea)
	at(sea, floater, 300)
	floater:draw()
	t.same("a floating building sits on the water and not under it", sea.calls[2], "translate 600 0 700")

	local deep = engine()
	deep.height = function()
		return -40
	end
	deep.record = true
	local sunk = ghosts(deep)
	at(deep, sunk, 300)
	sunk:draw()
	t.same("one that does not float is on the sea bed", deep.calls[2], "translate 600 -40 700")
end

-- The switch.

do
	local e = engine()
	local g = ghosts(e)
	e.params.coilbox_rewind_frame = 300
	g:draw()
	t.same("they are drawn", e.shapes, 1)
	t.same("the switch turns them off", g:toggle(), false)
	g:draw()
	t.same("and a draw draws nothing", e.shapes, 1)
	t.same("the switch turns them on again", g:toggle(), true)
	g:draw()
	t.same("and they are back", e.shapes, 2)
	t.same("a text command turns them off", g:textCommand("rewindghosts off") and g.enabled, false)
	t.same("on", g:textCommand("rewindghosts on") and g.enabled, true)
	t.same("and over", g:textCommand("rewindghosts") and g.enabled, false)
	t.same("another command is not its", g:textCommand("rewind"), false)
	t.same("and one that only starts the same is not either", g:textCommand("rewindghostsx"), false)

	t.same("the choice is handed back to be saved", g:config().show, false)
	local other = ghosts(engine())
	other:setConfig(g:config())
	t.same("and is taken back", other.enabled, false)
	other:setConfig({ show = true })
	t.same("a saved on", other.enabled, true)
	other:setConfig({ show = "yes" })
	other:setConfig("not a table")
	other:setConfig(nil)
	t.same("anything that is not what config writes is ignored", other.enabled, true)

	-- Turned off and on across a seek, they are right at the new time.
	local f = engine()
	local h = ghosts(f)
	at(f, h, 300)
	h:setEnabled(false)
	at(f, h, 100)
	h:setEnabled(true)
	h:draw()
	t.same("turned back on they show the time the player is at", joined(held(h)), "1:11:480:8128:0")
end

-- An adapter that draws in the game's way.

do
	local e = engine()
	e.record = true
	local seen
	local hook = function(def, team, x, y, z, facing)
		seen = string.format("%d %d %s %s %s %d", def, team, x, y, z, facing)
	end
	local g = ghosts(e, nil, { adapter = { hooks = { drawQueuedBuilding = hook } } })
	at(e, g, 300)
	g:draw()
	t.same("the adapter's hook gets the definition, the team, the place and the facing", seen, string.format("12 1 600 %s 700 2", e.height(600, 700)))
	t.same("and the engine's shape is not drawn", e.shapes, 0)
	t.same("with a matrix of its own to leave as it found it", table.concat(e.calls, "|"), "push|pop")

	local f = engine()
	local bad = function()
		error("no such helper")
	end
	local h = ghosts(f, nil, { adapter = { hooks = { drawQueuedBuilding = bad } } })
	at(f, h, 300)
	h:draw()
	h:draw()
	t.same("a hook that raises is switched off and the engine's shape takes over at once", f.shapes, 2)
	t.same("with the matrix put right", f.pushes, 0)
	local said = 0
	for _, line in ipairs(f.lines) do
		if line:find("drawQueuedBuilding hook raised", 1, true) then
			said = said + 1
		end
	end
	t.same("and one line to say so", said, 1)

	local plain = ghosts(engine(), nil, { adapter = { hooks = { afterFrame = hook } } })
	t.same("an adapter with other hooks leaves the drawing alone", plain.hook, nil)
	local none = ghosts(engine(), nil, { adapter = false })
	t.same("no adapter is no hook", none.hook, nil)
end

-- Allocation.

do
	local e = engine()
	local g = ghosts(e)
	local source = spec()
	-- One window of play with changes in it: a mex goes up at 1200, and the
	-- second builder's queue and the first's change at 1000.
	local function play(from, to)
		for frame = from, to, from <= to and 1 or -1 do
			e.params.coilbox_rewind_frame = frame
			g:draw()
		end
	end
	play(950, 1250)
	play(1250, 950)
	collectgarbage("collect")
	collectgarbage("stop")
	local before = collectgarbage("count")
	play(950, 1250)
	local grew = collectgarbage("count") - before
	t.same("300 frames of play with queue changes and units appearing allocate nothing, in kilobytes", grew, 0)

	collectgarbage("restart")
	collectgarbage("collect")
	collectgarbage("stop")
	before = collectgarbage("count")
	for _ = 1, 300 do
		e.params.coilbox_rewind_frame = 1050
		g:draw()
	end
	grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 draws of an unchanged queue allocate nothing, in kilobytes", grew, 0)
	t.check("and they drew the ghost each time", e.shapes > 300)

	-- Backward play and a seek in the same window.
	collectgarbage("collect")
	collectgarbage("stop")
	before = collectgarbage("count")
	play(1250, 950)
	e.params.coilbox_rewind_frame = 1100
	g:draw()
	e.params.coilbox_rewind_frame = 1250
	g:draw()
	grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("backward play and seeks inside a window allocate nothing either", grew, 0)

	-- A track that is read is the work of the window only: the queue is read for
	-- the builders and nothing more.
	local track = FakeTrack.new(source)
	local h = Ghosts.new({ Spring = e.Spring, gl = e.gl, UnitDefNames = e.UnitDefNames, UnitDefs = e.UnitDefs }, track)
	e.params.coilbox_rewind_frame = 1050
	h:update()
	local looks = track.queueLooks
	h:update()
	t.same("a time that has not moved asks the track nothing", track.queueLooks, looks)
	e.params.coilbox_rewind_frame = 1051
	h:update()
	t.same("one that has moved asks about each builder's queue once", track.queueLooks - looks, 2)
end

-- The real reader, on the fixture a Rust writer made. The fixture's units have
-- queues, so what the ghosts hold is the queues of expected.lua less the items
-- a unit of that definition stands at.

do
	local expectedFile = dofile(t.FIXTURES .. "expected.lua")
	local bytes = t.read(t.FIXTURES .. "small.cbtrack")
	local env = t.unsyncedEnv()
	local Track = t.load("coilbox_track.lua", env)
	local Fetch = t.load("coilbox_track_fetch.lua", env)
	local track = assert(Track.open(Fetch.fromString(bytes)))
	local e = engine()
	e.UnitDefNames, e.UnitDefs = {}, {}
	for i, name in ipairs(expectedFile.info.unitDefs) do
		e.UnitDefNames[name] = { id = 100 + i }
		e.UnitDefs[100 + i] = { name = name }
	end
	local g = Ghosts.new({ Spring = e.Spring, gl = e.gl, UnitDefNames = e.UnitDefNames, UnitDefs = e.UnitDefs }, track)
	local frames, items = 0, 0
	local worst
	for _, ef in ipairs(expectedFile.frames) do
		local wanted, seen = {}, {}
		for _, unit in ipairs(ef.units) do
			for _, item in ipairs(unit.queue) do
				local id = item[1] .. ":" .. item[2] .. ":" .. item[3]
				if not seen[id] then
					seen[id] = true
					local built = false
					for _, other in ipairs(ef.units) do
						if other.def == item[1] and math.abs(other.position[1] - item[2]) <= 8 and math.abs(other.position[3] - item[3]) <= 8 then
							built = true
						end
					end
					if not built then
						wanted[#wanted + 1] = string.format("%d:%d:%s:%s:%d", unit.team, 101 + item[1], item[2], item[3], item[4])
					end
				end
			end
		end
		table.sort(wanted)
		at(e, g, ef.frame)
		local got, want = joined(held(g)), joined(wanted)
		frames = frames + 1
		items = items + #wanted
		if got ~= want and not worst then
			worst = string.format("frame %d: got %s, wanted %s", ef.frame, got, want)
		end
	end
	t.check("on the Rust writer's track the ghosts are what the Rust reader's queues say", worst == nil, worst)
	t.check("over the " .. frames .. " frames the fixture has, with queued buildings in them", frames > 0 and items > 0, items)
end

-- The widget file, loaded the way a widget handler loads one.

local function track()
	return FakeTrack.new(spec())
end

--- A widget's world: its globals, a table of files the game holds, and the lines
-- it logged. `files` maps a path to a function that gives what Include returns.
local function widgetScene(options)
	options = options or {}
	local e = engine()
	local env = t.unsyncedEnv()
	env.widget = {}
	env.WG = {}
	env.Spring = e.Spring
	env.gl = e.gl
	env.UnitDefs = e.UnitDefs
	-- A handler whose LuaUI does not set the table has no such global, and a
	-- widget asks for it as for any global that may not be there.
	env.UnitDefNames = (not options.noNames) and e.UnitDefNames or false
	env.table = table
	local opened = options.track or track()
	local files = {}
	env.VFS = t.vfs()
	env.VFS.ZIP = "z"
	env.VFS.FileExists = function(path, mode)
		assert(mode == env.VFS.ZIP, "the widget looks for " .. path .. " somewhere other than the game")
		return files[path] ~= nil
	end
	env.VFS.Include = function(path, _, mode)
		assert(mode == env.VFS.ZIP, "the widget reads " .. path .. " from somewhere other than the game")
		if files[path] then
			return files[path]()
		end
		local chunk = assert(loadfile(t.root() .. "/" .. path))
		setfenv(chunk, env)
		return chunk()
	end
	-- The reader is the real one in other tests. Here a track is handed over.
	files["luarules/rewind_player/coilbox_track.lua"] = function()
		return {
			open = function()
				return opened
			end,
		}
	end
	files["luarules/rewind_player/coilbox_track_fetch.lua"] = function()
		return {
			PATH = "coilbox_rewind/track.cbtrack",
			fromVFS = function()
				if options.noTrack then
					return nil, "the game has no track"
				end
				return function() end
			end,
		}
	end
	for path, fn in pairs(options.files or {}) do
		files[path] = fn
	end
	if options.remove then
		local parts = {}
		for part in options.remove:gmatch("[^.]+") do
			parts[#parts + 1] = part
		end
		local holder = rawget(env, parts[1])
		for i = 2, #parts - 1 do
			holder = holder[parts[i]]
		end
		holder[parts[#parts]] = nil
	end
	local file = assert(loadfile(WIDGET))
	setfenv(file, env)
	file()
	return env.widget, e, env, files
end

do
	local widget, e, env = widgetScene()
	local info = widget:GetInfo()
	t.same("the widget names itself", info.name, "Coilbox rewind ghosts")
	t.same("it is on unless the player turns it off", info.enabled, true)
	t.same("it offers MIT or GPL", info.license, "MIT or GNU GPL, v2 or later")
	t.check("it has a layer", type(info.layer) == "number")

	widget:DrawWorld()
	t.same("before it starts it draws nothing", e.shapes, 0)
	widget:SetConfigData({ show = false })
	widget:Initialize()
	t.same("it starts, and says only that the game lacks a definition the track names", #e.lines, 1)
	e.params.coilbox_rewind_frame = 300
	widget:DrawWorld()
	t.same("what it was told to remember before it started is kept", e.shapes, 0)
	t.same("and handed back to be saved", widget:GetConfigData().show, false)
	t.same("the timeline's switch is offered in WG", type(env.WG.coilboxRewindGhosts.toggle), "function")
	t.same("it turns them on", env.WG.coilboxRewindGhosts.toggle(), true)
	widget:DrawWorld()
	t.same("and they are drawn", e.shapes, 1)
	t.same("it says what it is", env.WG.coilboxRewindGhosts.isOn(), true)
	t.same("a text command is taken", widget:TextCommand("rewindghosts off"), true)
	t.same("and changes it", env.WG.coilboxRewindGhosts.isOn(), false)
	t.same("another is left", widget:TextCommand("luarules reload"), false)
	widget:Shutdown()
	t.same("when it goes its switch goes", env.WG.coilboxRewindGhosts, nil)
	widget:DrawWorld()
	t.same("and it draws nothing", e.shapes, 1)
end

do
	local widget, e = widgetScene({ noTrack = true })
	widget:Initialize()
	widget:DrawWorld()
	t.check("a game with no track logs a line and draws nothing", #e.lines == 1 and e.lines[1]:find("the game has no track", 1, true) and e.shapes == 0, e.lines[1])
end

do
	local widget, e = widgetScene({ noNames = true })
	widget:Initialize()
	e.params.coilbox_rewind_frame = 300
	widget:DrawWorld()
	t.same("a handler that gives no UnitDefNames is no matter, the names are worked out", e.shapes, 1)
end

do
	local widget, e = widgetScene({
		files = {
			["coilbox_rewind/adapter.lua"] = function()
				return {
					hooks = {
						drawQueuedBuilding = function() end,
					},
				}
			end,
		},
	})
	widget:Initialize()
	e.params.coilbox_rewind_frame = 300
	widget:DrawWorld()
	t.same("an adapter in the game replaces the drawing", e.shapes, 0)
end

do
	local widget, e = widgetScene({
		files = {
			["coilbox_rewind/adapter.lua"] = function()
				return false
			end,
		},
	})
	widget:Initialize()
	e.params.coilbox_rewind_frame = 300
	widget:DrawWorld()
	t.same("one that says there is no adapter leaves the engine's shape", e.shapes, 1)
end

do
	local widget, e = widgetScene({
		files = {
			["coilbox_rewind/adapter.lua"] = function()
				error("not Lua")
			end,
		},
	})
	widget:Initialize()
	e.params.coilbox_rewind_frame = 300
	widget:DrawWorld()
	t.same("an adapter that raises when read leaves the engine's shape", e.shapes, 1)
	t.check("and says why", #e.lines == 2 and e.lines[1]:find("not Lua", 1, true), e.lines[1])
end

-- What the widget needs from the engine. The table is the widget's own, and the
-- tests are made from it as the timeline's are.

do
	local Scan = dofile(here .. "/scan.lua")
	local PREFIX = "COILBOX_REWIND_GHOSTS "
	local ENGINE = t.root() .. "/luaui/rewind_ghosts/coilbox_ghosts_engine.lua"
	local chunk = assert(loadfile(ENGINE))
	setfenv(chunk, t.unsyncedEnv())
	local Table = chunk()
	t.same("its lines start with the widget's prefix", Table.PREFIX, PREFIX)

	local ids = {}
	for _, row in ipairs(Table.ROWS) do
		local label = "ghost row " .. tostring(row.id)
		t.check(label .. " has an id nobody else has", type(row.id) == "string" and not ids[row.id])
		ids[row.id] = true
		t.check(label .. " names its calls", type(row.calls) == "table" and #row.calls > 0)
		t.check(label .. " says how it is checked", row.how == "presence" or row.how == "behaviour")
		t.check(label .. " says whether it is required", type(row.required) == "boolean")
		t.check(label .. " says what it is for, what happens without it and where", row.feature and row.without and row.used and true)
		t.check(label .. " names the engine that has it", type(row.since) == "string")
	end

	-- Every engine name the widget uses has a row, and every row is used. The
	-- widget reads the track in its own Lua state, so the reader's two files count
	-- as the widget's.
	local allowed = Scan.setOf(Scan.callsOf(Table.ROWS), Table.ASSUMED)
	local used = {}
	local files = Scan.filesUnder(t.root() .. "/luaui/rewind_ghosts")
	files[#files + 1] = WIDGET
	files[#files + 1] = t.root() .. "/luarules/rewind_player/coilbox_track.lua"
	files[#files + 1] = t.root() .. "/luarules/rewind_player/coilbox_track_fetch.lua"
	t.check("the scan found the widget's files", #files >= 5, #files)
	for _, path in ipairs(files) do
		for name in pairs(Scan.usedBy(path)) do
			used[name] = true
			t.check(path:match("[^/]+$") .. " uses " .. name .. ", which has a row", allowed[name], "add " .. name .. " to coilbox_ghosts_engine.lua")
		end
	end
	for _, call in ipairs(Scan.callsOf(Table.ROWS)) do
		t.check(call .. " has a row and the widget uses it", used[call])
	end

	for _, row in ipairs(Table.ROWS) do
		for _, call in ipairs(row.calls) do
			local label = "ghosts without " .. call
			local widget, e = widgetScene({ remove = call })
			local ok, err = pcall(function()
				widget:Initialize()
				e.params.coilbox_rewind_frame = 300
				widget:DrawWorld()
				widget:DrawWorld()
				widget:TextCommand("rewindghosts off")
			end)
			t.check(label .. " raises nothing", ok, err)
			local line = e.lines[1]
			t.check(label .. " logs a line starting with the widget's prefix", line ~= nil and line:sub(1, #PREFIX) == PREFIX, line)
			t.check(label .. " naming the call", line ~= nil and line:find("this engine has no " .. call, 1, true) ~= nil, line)
			t.check(label .. " and the engine that has it", line ~= nil and line:find("Engine " .. row.since .. " and later have it", 1, true) ~= nil, line)
			if row.required then
				t.check(label .. " the line says it cannot start", line ~= nil and line:find("cannot start", 1, true) ~= nil, line)
				t.same(label .. " nothing is drawn", e.shapes, 0)
			else
				t.check(label .. " the line says " .. row.feature .. " is switched off", line ~= nil and line:find("Switched off: " .. row.feature .. ".", 1, true) ~= nil, line)
			end
		end
	end
end

t.report()
