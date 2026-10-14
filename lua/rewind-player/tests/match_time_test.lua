-- The match's time for the widgets a game's adapter names (issue #4013). The
-- engine counts its frames from when the playback opened, and a widget that
-- prints the time or works the sky out from it shows the playback's and not
-- the match's. The adapter names such widgets, and the widget file here wraps
-- the `Spring` every widget shares, as its file loads, so that those widgets
-- are told the match's frame and every other widget the engine's.
--
-- The engine here is a stand-in, so this shows the logic. That the engine's
-- Lua finds the caller the same way is shown by a run in the engine.

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")

local MODULE = t.root() .. "/luaui/rewind_match_time/coilbox_match_time.lua"
local WIDGET = t.root() .. "/luaui/widgets/!coilbox_rewind_match_time.lua"
local ENGINE = t.root() .. "/luaui/rewind_match_time/coilbox_match_time_engine.lua"
local PREFIX = "COILBOX_REWIND_MATCH_TIME "

local MatchTime
do
	local chunk = assert(loadfile(MODULE))
	local env = t.unsyncedEnv()
	-- Every handler read gives a widget getfenv (cont/LuaUI/system.lua and
	-- Beyond All Reason's luaui/system.lua).
	env.getfenv = getfenv
	setfenv(chunk, env)
	MatchTime = chunk()
end

-- A day of frames at 30 a second. The engine gives the frame as what is left
-- of a day, and the days, as a second number.
local DAY = 30 * 24 * 60 * 60

--- The slice of the engine the wrap uses. The engine's own frame is 50.
local function engine()
	local e = { params = {}, frame = 50 }
	e.Spring = {
		GetGameFrame = function()
			return e.frame % DAY, math.floor(e.frame / DAY)
		end,
		GetGameSeconds = function()
			return e.frame / 30
		end,
		GetGameRulesParam = function(name)
			return e.params[name]
		end,
	}
	return e
end

--- A widget's environment as a handler makes it: its own table, which gets its
-- `whInfo` once its file has run. `file` is the path the handler listed it by.
local function widgetEnv(Spring, file)
	local env = { Spring = Spring, math = math }
	env.finish = function()
		env.whInfo = setmetatable({}, {
			__index = { filename = file, basename = file:match("[^/]+$") },
			__newindex = function()
				error("whInfo tables are read-only")
			end,
			__metatable = "protected",
		})
	end
	return env
end

--- Runs `source` as a widget's file in `env` and gives what it defined.
local function widgetFile(env, source)
	local chunk = assert(loadstring(source))
	setfenv(chunk, env)
	chunk()
	return env
end

local NAMES = { "gui_static_playerslist.lua", "gfx_timecyclesweathereffects_weather.lua" }

local function wrapped(names)
	local e = engine()
	local done = MatchTime.wrap({ Spring = e.Spring, names = names or NAMES, gameSpeed = 30 })
	return e, done
end

-- What a named widget and another widget are told.

do
	local e, done = wrapped()
	t.same("the wrap is made for a game whose adapter names widgets", done, true)
	-- Each keeps the call in a local as its file loads, as both of Splinter
	-- Faction's do, after the wrap is in place.
	local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
	widgetFile(list, "local get, secs = Spring.GetGameFrame, Spring.GetGameSeconds function time() local f = get() return f end function seconds() local s = secs() return s end function both() local f, d = get() return f, d end")
	list.finish()
	local other = widgetEnv(e.Spring, "LuaUI/Widgets/gfx_light_effects.lua")
	widgetFile(other, "local get = Spring.GetGameFrame function time() local f = get() return f end")
	other.finish()

	t.same("before the player says its time a named widget is told the engine's frame", list.time(), 50)
	e.params.coilbox_rewind_frame = 18000
	t.same("a named widget is told the match's frame", list.time(), 18000)
	t.same("and the match's seconds", list.seconds(), 600)
	t.same("another widget is told the engine's frame", other.time(), 50)
	t.same("and a call from outside any widget gets the engine's", e.Spring.GetGameFrame(), 50)
	e.params.coilbox_rewind_frame = 18000.5
	t.same("a time between two frames is the frame it is in, a whole number as the engine gives", list.time(), 18000)
	e.params.coilbox_rewind_frame = 1200
	t.same("a seek backward is told too", list.time(), 1200)
	e.params.coilbox_rewind_frame = DAY + 7
	local f, d = list.both()
	t.same("a frame past a day is what is left of the day", f, 7)
	t.same("with the days as the second number, as the engine gives them", d, 1)
	e.params.coilbox_rewind_frame = "not a number"
	t.same("a parameter that is not a number leaves the engine's", list.time(), 50)
end

do
	local e = wrapped({ "GUI_Static_PlayersList.lua", "sub/clock.lua" })
	e.params.coilbox_rewind_frame = 900
	local list = widgetEnv(e.Spring, "luaui/widgets/gui_static_playerslist.lua")
	widgetFile(list, "function time() local f = Spring.GetGameFrame() return f end")
	list.finish()
	t.same("names are compared without regard to case, as the engine's file names are", list.time(), 900)
	local deep = widgetEnv(e.Spring, "LuaUI/Widgets/sub/clock.lua")
	widgetFile(deep, "function time() local f = Spring.GetGameFrame() return f end")
	deep.finish()
	t.same("a widget in a folder is named by its path inside luaui/widgets/", deep.time(), 900)
	local same = widgetEnv(e.Spring, "LuaUI/Widgets/clock.lua")
	widgetFile(same, "function time() local f = Spring.GetGameFrame() return f end")
	same.finish()
	t.same("and a file of the same name in another folder is not that widget", same.time(), 50)
end

do
	local e = wrapped()
	e.params.coilbox_rewind_frame = 900
	local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
	-- Some widgets ask as their file runs, before the handler has told them
	-- which file they are.
	widgetFile(list, "loading = Spring.GetGameFrame() function time() local f = Spring.GetGameFrame() return f end")
	t.same("a widget asking as its file runs is told the engine's frame, since it is not yet known", list.loading, 50)
	list.finish()
	t.same("and the match's once the handler has finished it", list.time(), 900)
end

do
	local e = wrapped()
	e.params.coilbox_rewind_frame = 900
	local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
	-- A tail call leaves no frame to find the widget by. Lua 5.1 says so and
	-- LuaJIT gives the frame above, and both are not the widget.
	widgetFile(list, "function time() return Spring.GetGameFrame() end")
	list.finish()
	local ok, got = pcall(list.time)
	t.check("a call made as a tail call raises nothing", ok, got)
	t.same("and is told the engine's frame", got, 50)
end

do
	local e = engine()
	local before = e.Spring.GetGameFrame
	t.same("a game whose adapter names no widget is left alone", MatchTime.wrap({ Spring = e.Spring, names = {}, gameSpeed = 30 }), false)
	t.same("and its call is the engine's own", e.Spring.GetGameFrame, before)
	t.same("nor with no list at all", MatchTime.wrap({ Spring = e.Spring, gameSpeed = 30 }), false)
end

-- A frame of a widget that asks many times allocates nothing.

do
	local e = wrapped()
	e.params.coilbox_rewind_frame = 900
	local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
	widgetFile(list, "local get = Spring.GetGameFrame function time() local f = get() return f end")
	list.finish()
	local other = widgetEnv(e.Spring, "LuaUI/Widgets/gfx_light_effects.lua")
	widgetFile(other, "local get = Spring.GetGameFrame function time() local f = get() return f end")
	other.finish()
	list.time()
	other.time()
	if jit then
		jit.off()
	end
	collectgarbage("collect")
	collectgarbage("stop")
	local before = collectgarbage("count")
	for _ = 1, 300 do
		list.time()
		other.time()
	end
	local grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.check("600 asks, half of them by a named widget, allocate nothing", grew == 0, grew)
end

-- The widget file, run the way a handler runs one.

--- A handler's world for the widget file. `adapter` is what the playback game's
-- adapter file gives, or nil for none.
local function widgetScene(options)
	options = options or {}
	local e = engine()
	local lines = {}
	local env = t.unsyncedEnv()
	env.widget = {}
	env.WG = {}
	env.Spring = e.Spring
	env.Spring.Echo = function(line)
		lines[#lines + 1] = line
	end
	env.Game = { gameSpeed = 30 }
	env.getfenv = getfenv
	env.io = {
		open = function()
			return {
				write = function(_, line)
					lines[#lines + 1] = line
				end,
				flush = function() end,
				close = function() end,
			}
		end,
	}
	local files = {}
	if options.adapter ~= nil then
		files["coilbox_rewind/adapter.lua"] = function()
			if type(options.adapter) == "function" then
				return options.adapter()
			end
			return options.adapter
		end
	end
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
	local returned = file()
	return returned, e, lines
end

do
	local returned, e, lines = widgetScene({ adapter = { name = "Splinter Faction", matchTimeWidgets = NAMES } })
	t.same("the file asks its handler not to load it as a widget, so it has nothing to switch off or call", returned, false)
	local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
	widgetFile(list, "local get = Spring.GetGameFrame function time() local f = get() return f end")
	list.finish()
	e.params.coilbox_rewind_frame = 4321
	t.same("a widget whose file runs after it is told the match's frame", list.time(), 4321)
	t.same("it logs one line", #lines, 1)
	t.check("naming the widgets", lines[1] and lines[1]:find("gui_static_playerslist.lua, gfx_timecyclesweathereffects_weather.lua", 1, true), lines[1])
	t.check("starting with its prefix", lines[1] and lines[1]:sub(1, #PREFIX) == PREFIX, lines[1])
end

do
	local _, e, lines = widgetScene({ adapter = { name = "Beyond All Reason" } })
	local before = engine().Spring.GetGameFrame
	t.same("an adapter that names no widget leaves the call alone", debug.getinfo(e.Spring.GetGameFrame, "S").source, debug.getinfo(before, "S").source)
	t.same("and says nothing", #lines, 0)
end

do
	local returned, e, lines = widgetScene({ adapter = false })
	t.same("a game with no adapter is left alone", debug.getinfo(e.Spring.GetGameFrame, "S").source, debug.getinfo(engine().Spring.GetGameFrame, "S").source)
	t.same("and the file still asks not to be loaded", returned, false)
	t.same("and says nothing", #lines, 0)
end

do
	local returned, e, lines = widgetScene({
		adapter = function()
			error("not Lua")
		end,
	})
	t.same("an adapter that raises when read leaves the call alone", debug.getinfo(e.Spring.GetGameFrame, "S").source, debug.getinfo(engine().Spring.GetGameFrame, "S").source)
	t.check("and says why", #lines == 1 and lines[1]:find("not Lua", 1, true), lines[1])
	t.same("and the file still asks not to be loaded", returned, false)
end

do
	local _, _, lines = widgetScene({ adapter = { matchTimeWidgets = { "!aaa.lua", "gui_x.lua" } } })
	t.check("a named widget whose file comes before this one in the folder is said to keep the engine's count", lines[2] and lines[2]:find("!aaa.lua", 1, true) and not lines[2]:find("gui_x", 1, true), lines[2])
end

-- The file's name comes before every widget Splinter Faction's adapter names,
-- and before any name that starts with a letter, a digit or an underscore,
-- since a handler lists the folder in the order of the names.

do
	local name = WIDGET:match("[^/]+$"):lower()
	local chunk = assert(loadfile(t.root() .. "/adapters/splinter_faction.lua"))
	local adapter = chunk()
	t.check("Splinter Faction's adapter names widgets", #(adapter.matchTimeWidgets or {}) > 0)
	for _, widget in ipairs(adapter.matchTimeWidgets or {}) do
		t.check("this file comes before " .. widget, name < widget:lower())
	end
	t.check("and before any widget whose name starts with a letter, a digit or an underscore", name < "0" and name < "_" and name < "a")
end

-- What the file needs from the engine. The table is its own, and the tests are
-- made from it as the timeline's and the ghosts' are.

do
	local Scan = dofile(here .. "/scan.lua")
	local chunk = assert(loadfile(ENGINE))
	setfenv(chunk, t.unsyncedEnv())
	local Table = chunk()
	t.same("its lines start with the file's prefix", Table.PREFIX, PREFIX)

	local ids = {}
	for _, row in ipairs(Table.ROWS) do
		local label = "match time row " .. tostring(row.id)
		t.check(label .. " has an id nobody else has", type(row.id) == "string" and not ids[row.id])
		ids[row.id] = true
		t.check(label .. " names its calls", type(row.calls) == "table" and #row.calls > 0)
		t.check(label .. " says how it is checked", row.how == "presence" or row.how == "behaviour")
		t.check(label .. " says whether it is required", type(row.required) == "boolean")
		t.check(label .. " says what it is for, what happens without it and where", row.feature and row.without and row.used and true)
		t.check(label .. " names the engine that has it", type(row.since) == "string")
	end

	local allowed = Scan.setOf(Scan.callsOf(Table.ROWS), Table.ASSUMED)
	local used = {}
	local files = Scan.filesUnder(t.root() .. "/luaui/rewind_match_time")
	files[#files + 1] = WIDGET
	t.check("the scan found the file's modules", #files >= 3, #files)
	for _, path in ipairs(files) do
		for name in pairs(Scan.usedBy(path)) do
			used[name] = true
			t.check(path:match("[^/]+$") .. " uses " .. name .. ", which has a row", allowed[name], "add " .. name .. " to coilbox_match_time_engine.lua")
		end
	end
	for _, call in ipairs(Scan.callsOf(Table.ROWS)) do
		t.check(call .. " has a row and the file uses it", used[call])
	end

	for _, row in ipairs(Table.ROWS) do
		for _, call in ipairs(row.calls) do
			local label = "match time without " .. call
			local ok, returned, e, lines = pcall(widgetScene, { adapter = { matchTimeWidgets = NAMES }, remove = call })
			t.check(label .. " raises nothing", ok, returned)
			if ok then
				local line = lines[1]
				t.same(label .. " still asks not to be loaded", returned, false)
				t.check(label .. " logs a line starting with the file's prefix", line ~= nil and line:sub(1, #PREFIX) == PREFIX, line)
				t.check(label .. " naming the call", line ~= nil and line:find("this engine has no " .. call, 1, true) ~= nil, line)
				t.check(label .. " and the engine that has it", line ~= nil and line:find("Engine " .. row.since .. " and later have it", 1, true) ~= nil, line)
				if row.required then
					t.check(label .. " the line says it cannot start", line ~= nil and line:find("cannot start", 1, true) ~= nil, line)
					local list = widgetEnv(e.Spring, "LuaUI/Widgets/gui_static_playerslist.lua")
					e.params.coilbox_rewind_frame = 900
					widgetFile(list, "function time() local f = Spring.GetGameFrame and Spring.GetGameFrame() return f end")
					list.finish()
					t.check(label .. " nothing is wrapped", list.time() ~= 900, list.time())
				end
			end
		end
	end
end

t.report()
