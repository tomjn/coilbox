-- The timeline (issue #3798): the keys, the knob, the buttons, what it shows,
-- where it sits and what it remembers. The engine here is a stand-in, so this
-- shows the logic and the arithmetic and nothing about how the bar looks.

-- The engine runs plain Lua 5.1, which has no tracing compiler. LuaJIT's builds
-- traces as a loop gets hot, and those are memory the count of what a draw
-- allocates would show.
if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")

local MODULE = t.root() .. "/luaui/rewind_timeline/coilbox_timeline.lua"
local WIDGET = t.root() .. "/luaui/widgets/coilbox_rewind_timeline.lua"

-- Key codes as `widget:KeyPress` is given them, from
-- cont/LuaUI/Headers/keysym.h.lua in RecoilEngine. A printable key's code is
-- its character's.
local CODES = { space = 32, left = 276, right = 275, home = 278, ["end"] = 279, escape = 27, shift = 304 }
for _, char in ipairs({ "r", "p", "a", ",", ".", "[", "]", "-", "=", "+" }) do
	CODES[char] = char:byte()
end
local NAMES = {}
for name, code in pairs(CODES) do
	NAMES[code] = name
end

local NONE = { alt = false, ctrl = false, meta = false, shift = false }
local SHIFT = { alt = false, ctrl = false, meta = false, shift = true }

--- A track of 3,000 frames at 30 a second, which is 100 seconds, starting at
-- frame 600 as a recording that began 20 seconds into a match would.
local function params()
	return {
		coilbox_rewind_frame = 600,
		coilbox_rewind_playing = 1,
		coilbox_rewind_direction = 1,
		coilbox_rewind_speed = 1,
		coilbox_rewind_first_frame = 600,
		coilbox_rewind_last_frame = 3600,
		coilbox_rewind_frames_per_second = 30,
	}
end

--- The slice of the engine the timeline uses. `e.sent` is every message, and
-- `e.box` is the rectangle that holds everything drawn since `e.clear()`.
local function engine(values, files)
	local e = { params = values, sent = {}, mouseX = 0, mouseY = 0, texts = {}, box = {} }
	function e.clear()
		e.texts = {}
		e.box.x1, e.box.y1, e.box.x2, e.box.y2 = math.huge, math.huge, -math.huge, -math.huge
		e.shapes = 0
	end
	e.clear()
	local box = e.box
	local function cover(x, y)
		if x < box.x1 then
			box.x1 = x
		end
		if x > box.x2 then
			box.x2 = x
		end
		if y < box.y1 then
			box.y1 = y
		end
		if y > box.y2 then
			box.y2 = y
		end
	end
	e.Spring = {
		GetGameRulesParam = function(name)
			return e.params[name]
		end,
		SendLuaRulesMsg = function(message)
			e.sent[#e.sent + 1] = message
		end,
		GetMouseState = function()
			return e.mouseX, e.mouseY, false, false, false
		end,
		GetKeyCode = function(name)
			return CODES[name] or -1
		end,
		GetKeySymbol = function(code)
			return NAMES[code] or string.format("0x%x", code)
		end,
	}
	e.gl = {
		Color = function() end,
		Texture = function() end,
		Rect = function(x1, y1, x2, y2)
			e.shapes = e.shapes + 1
			cover(x1, y1)
			cover(x2, y2)
		end,
		Vertex = cover,
		BeginEnd = function(_, emit, ...)
			e.shapes = e.shapes + 1
			emit(...)
		end,
		-- A width in multiples of the font size, as the engine gives it.
		GetTextWidth = function(text)
			return #text * 0.5
		end,
		-- The height of the text and how far it hangs below the baseline, in
		-- multiples of the font size. A capital of the stand-in font is 0.7.
		GetTextHeight = function()
			return 0.7, 0, 1
		end,
		Text = function(text, x, y, size, options)
			-- Where the text's baseline was put, which `x` says `y` is.
			e.texts[text] = options:find("x", 1, true) and y or true
			local width = #text * 0.5 * size
			local left = x
			if options:find("c", 1, true) then
				left = x - width / 2
			elseif options:find("r", 1, true) then
				left = x - width
			end
			cover(left, y - 0.2 * size)
			cover(left + width, y + 0.8 * size)
		end,
	}
	e.GL = { TRIANGLE_FAN = 6, LINE_LOOP = 2, TRIANGLES = 4 }
	e.VFS = {
		ZIP = "z",
		FileExists = function(path)
			return files ~= nil and files[path] ~= nil
		end,
		Include = function(path)
			return files[path]()
		end,
	}
	return e
end

local Timeline
do
	local chunk = assert(loadfile(MODULE))
	setfenv(chunk, t.unsyncedEnv())
	Timeline = chunk()
end

--- A timeline in a view of `vsx` by `vsy`, having read the parameters.
local function timeline(e, vsx, vsy)
	local tl = Timeline.new({ Spring = e.Spring, gl = e.gl, GL = e.GL, VFS = e.VFS })
	tl:resize(vsx or 1920, vsy or 1080)
	tl:read()
	return tl
end

local function middle(rect)
	return (rect.x1 + rect.x2) / 2, (rect.y1 + rect.y2) / 2
end

local function click(tl, rect)
	local x, y = middle(rect)
	local taken = tl:mousePress(x, y, 1)
	tl:mouseRelease(x, y, 1)
	return taken
end

-- Every key of the replay page's table sends the player its message.

do
	local rows = {
		{ "Space", "space", NONE, "toggle" },
		{ "R", "r", NONE, "reverse" },
		{ "Left", "left", NONE, "step -30" },
		{ "Right", "right", NONE, "step 30" },
		{ "Shift and Left", "left", SHIFT, "step -300" },
		{ "Shift and Right", "right", SHIFT, "step 300" },
		{ "Comma", ",", NONE, "step -1" },
		{ "Full stop", ".", NONE, "step 1" },
		{ "Home", "home", NONE, "seek 600" },
		{ "End", "end", NONE, "seek 3600" },
		{ "Minus", "-", NONE, "slower" },
		{ "Equals", "=", NONE, "faster" },
		{ "Plus", "+", NONE, "faster" },
		{ "Shift and equals, which types a plus", "=", SHIFT, "faster" },
		{ "Shift and R", "r", SHIFT, "reverse" },
	}
	for _, row in ipairs(rows) do
		local e = engine(params())
		local tl = timeline(e)
		t.same(row[1] .. " is taken", tl:keyPress(CODES[row[2]], row[3], false), true)
		t.same(row[1] .. " sends one message", #e.sent, 1)
		t.same(row[1] .. " sends " .. row[4], e.sent[1], "coilbox_rewind:" .. row[4])
	end
end

-- A key held with Ctrl, Alt or Meta is somebody else's, and so is a key the
-- table does not have.

do
	local e = engine(params())
	local tl = timeline(e)
	for _, held in ipairs({ "ctrl", "alt", "meta" }) do
		local mods = { alt = false, ctrl = false, meta = false, shift = false }
		mods[held] = true
		t.same("Space with " .. held .. " is left alone", tl:keyPress(CODES.space, mods, false), false)
		t.same("Left with " .. held .. " is left alone", tl:keyPress(CODES.left, mods, false), false)
	end
	t.same("a key the table does not have is left alone", tl:keyPress(CODES.a, NONE, false), false)
	t.same("and none of them sent anything", #e.sent, 0)
end

-- A held key repeats a step and does not repeat a toggle, and is taken either
-- way so that the game's binding does not get the repeats.

do
	local e = engine(params())
	local tl = timeline(e)
	t.same("a repeat of Space is taken", tl:keyPress(CODES.space, NONE, true), true)
	t.same("a repeat of R is taken", tl:keyPress(CODES.r, NONE, true), true)
	t.same("and neither toggles again", #e.sent, 0)
	t.same("a repeat of Right is taken", tl:keyPress(CODES.right, NONE, true), true)
	t.same("and steps again", e.sent[1], "coilbox_rewind:step 30")
end

-- A game with no player has no timeline.

do
	local e = engine({})
	local tl = timeline(e)
	t.same("with no player, the read says so", tl:read(), false)
	t.same("a key is left alone", tl:keyPress(CODES.space, NONE, false), false)
	t.same("the pointer is over nothing", tl:isAbove(960, 40), false)
	t.same("a press is left alone", tl:mousePress(960, 40, 1), false)
	tl:draw()
	t.same("and nothing is drawn", e.shapes, 0)
	t.same("nothing is sent", #e.sent, 0)
end

-- Dragging the knob seeks: both ends, the middle, and past either end.

do
	local e = engine(params())
	local tl = timeline(e)
	local bar = tl.rects.bar
	local y = (bar.y1 + bar.y2) / 2
	t.same("a press on the bar is taken", tl:mousePress(bar.x1, y, 1), true)
	t.same("the player is told a drag has begun before the first seek of it (issue #4009)", e.sent[#e.sent - 1], "coilbox_rewind:drag 1")
	t.same("the left end is the first frame", e.sent[#e.sent], "coilbox_rewind:seek 600")
	tl:mouseMove(bar.x2, y)
	t.same("the right end is the last frame", e.sent[#e.sent], "coilbox_rewind:seek 3600")
	tl:mouseMove((bar.x1 + bar.x2) / 2, y)
	t.same("the middle is the middle frame", e.sent[#e.sent], "coilbox_rewind:seek 2100")
	tl:mouseMove(bar.x1 + (bar.x2 - bar.x1) / 4, y + 400)
	t.same("a quarter along is a quarter in, wherever the pointer is up and down", e.sent[#e.sent], "coilbox_rewind:seek 1350")
	tl:mouseMove(bar.x1 - 500, y)
	t.same("left of the bar is held at the first frame", e.sent[#e.sent], "coilbox_rewind:seek 600")
	tl:mouseMove(bar.x2 + 500, y)
	t.same("right of the bar is held at the last frame", e.sent[#e.sent], "coilbox_rewind:seek 3600")
	local before = #e.sent
	tl:mouseMove(bar.x2 + 600, y)
	t.same("a move that lands on the same frame sends nothing", #e.sent, before)
	tl:mouseRelease(bar.x2, y, 1)
	t.same("letting go tells the player the drag has ended", e.sent[#e.sent], "coilbox_rewind:drag 0")
	t.same("and that is all it sends", #e.sent, before + 1)
	before = #e.sent
	tl:mouseMove(bar.x1, y)
	t.same("a move after the release seeks nothing", #e.sent, before)
	t.same("a right click on the bar does not seek", tl:mousePress(bar.x1, y, 3) and #e.sent, before)
	tl:mouseRelease(bar.x1, y, 3)
	t.same("and a release with no drag says nothing of one", #e.sent, before)

	local drags = 0
	for _, text in ipairs(e.sent) do
		if text == "coilbox_rewind:drag 1" then
			drags = drags + 1
		end
	end
	t.same("a drag begins once, however far the knob goes", drags, 1)
end

-- Moving the panel is not a drag of the knob.

do
	local e = engine(params())
	local tl = timeline(e)
	local panel = tl.rects.panel
	tl:mousePress(panel.x1 + 2, panel.y1 + 2, 1)
	tl:mouseMove(panel.x1 + 40, panel.y1 + 40)
	tl:mouseRelease(panel.x1 + 40, panel.y1 + 40, 1)
	t.same("moving the panel sends the player nothing", #e.sent, 0)
end

-- The knob is where the frame is.

do
	local e = engine(params())
	local tl = timeline(e)
	local bar = tl.rects.bar
	t.same("at the first frame the knob is at the left end", tl:knobX(), bar.x1)
	e.params.coilbox_rewind_frame = 3600
	tl:read()
	t.same("at the last frame it is at the right end", tl:knobX(), bar.x2)
	e.params.coilbox_rewind_frame = 2100
	tl:read()
	t.same("half way it is in the middle", tl:knobX(), (bar.x1 + bar.x2) / 2)

	local one = params()
	one.coilbox_rewind_last_frame = 600
	local single = timeline(engine(one))
	t.same("a track of one frame puts the knob at the left end", single:knobX(), single.rects.bar.x1)
end

-- The buttons.

do
	local e = engine(params())
	local tl = timeline(e)
	for _, row in ipairs({ { "toggle", "toggle" }, { "reverse", "reverse" }, { "slower", "slower" }, { "faster", "faster" } }) do
		t.same("the " .. row[1] .. " button takes the click", click(tl, tl.rects[row[1]]), true)
		t.same("and sends " .. row[2], e.sent[#e.sent], "coilbox_rewind:" .. row[2])
	end
	t.same("four clicks, four messages", #e.sent, 4)
	local x, y = middle(tl.rects.toggle)
	t.same("the pointer is over the panel", tl:isAbove(x, y), true)
	t.same("and not over the middle of the view", tl:isAbove(960, 540), false)
	t.same("a press away from the panel is left alone", tl:mousePress(960, 540, 1), false)
	t.check("a button says what it does and its key", tl:tooltip(x, y) == "Play or pause (Space)", tl:tooltip(x, y))
end

-- What it shows follows the parameters.

do
	local e = engine(params())
	local tl = timeline(e)
	tl:draw()
	t.check("the time starts at nothing, of the match's length", e.texts["0:00 / 1:40"], next(e.texts))
	t.check("the speed is shown", e.texts["1x"])
	e.params.coilbox_rewind_frame = 2715.5
	e.params.coilbox_rewind_speed = 0.5
	e.clear()
	tl:draw()
	t.check("the time is the frame's, in whole seconds", e.texts["1:10 / 1:40"], next(e.texts))
	t.check("half speed is shown", e.texts["0.5x"])
	e.params.coilbox_rewind_speed = 32
	e.params.coilbox_rewind_last_frame = 600 + 30 * 3725
	e.params.coilbox_rewind_frame = 600 + 30 * 3600
	e.clear()
	tl:draw()
	t.check("past an hour it shows hours", e.texts["1:00:00 / 1:02:05"], next(e.texts))
	t.check("the top speed is shown", e.texts["32x"])
	t.same("the timeline holds no playing state: it is the parameter", tl.playing, true)
	e.params.coilbox_rewind_playing = 0
	e.params.coilbox_rewind_direction = -1
	tl:draw()
	t.same("paused is read", tl.playing, false)
	t.same("backward is read", tl.direction, -1)
end

-- The note of issue #3802 is a parameter, and is drawn when the player sets it.

do
	local e = engine(params())
	local tl = timeline(e)
	tl:draw()
	local without = e.shapes
	e.params.coilbox_rewind_note = "Aiming is off on this engine"
	e.clear()
	tl:draw()
	t.check("a note is drawn", e.texts["Aiming is off on this engine"])
	t.check("in a panel of its own", e.shapes > without, e.shapes .. " against " .. without)
end

-- When playback refuses to start there is no player, and the note is all there
-- is to show (issue #3802).

do
	local note = "Playback needs engine 105.0 or later: no Spring.CreateUnit"
	local e = engine(params())
	e.params.coilbox_rewind_first_frame = nil
	e.params.coilbox_rewind_note = note
	local tl = timeline(e)
	tl:draw()
	t.check("with no player the note is drawn", e.texts[note])
	t.check("and nothing else is", e.texts["1x"] == nil and e.texts["?"] == nil)
	t.check("inside the view", e.box.x1 >= 0 and e.box.x2 <= 1920 and e.box.y1 >= 0 and e.box.y2 <= 1080)
	t.same("the timeline takes no press", tl:mousePress(960, 40, 1), false)
	t.same("and is not above anything", tl:isAbove(960, 40), false)
	e.params.coilbox_rewind_note = ""
	e.clear()
	tl:draw()
	t.same("an empty note takes it away, and nothing is drawn", next(e.texts), nil)
	e.params.coilbox_rewind_first_frame = 600
	tl:draw()
	t.check("the timeline comes back with a player", e.texts["1x"])
end

-- Where it sits: bottom centre, and inside the view at any size.

do
	for _, size in ipairs({ { 640, 480 }, { 1280, 720 }, { 1920, 1080 }, { 3840, 2160 }, { 1080, 1920 } }) do
		local vsx, vsy = size[1], size[2]
		local what = vsx .. " by " .. vsy
		local e = engine(params())
		e.params.coilbox_rewind_note = "Aiming is off on this engine"
		e.params.coilbox_rewind_last_frame = 600 + 30 * 36000
		local tl = timeline(e, vsx, vsy)
		local panel = tl.rects.panel
		t.same("at " .. what .. " the panel is centred", (panel.x1 + panel.x2) / 2, vsx / 2)
		t.check("at " .. what .. " it is near the bottom", panel.y1 > 0 and panel.y2 < vsy / 4, panel.y1 .. " to " .. panel.y2)
		tl:draw()
		local box = e.box
		t.check(
			"at " .. what .. " everything drawn is inside the view",
			box.x1 >= 0 and box.y1 >= 0 and box.x2 <= vsx and box.y2 <= vsy,
			string.format("%g, %g to %g, %g", box.x1, box.y1, box.x2, box.y2)
		)
		for _, id in ipairs({ "reverse", "toggle", "slower", "faster", "help", "bar" }) do
			local r = tl.rects[id]
			t.check(
				"at " .. what .. " " .. id .. " is inside the panel",
				r.x1 >= panel.x1 and r.x2 <= panel.x2 and r.y1 >= panel.y1 and r.y2 <= panel.y2 and r.x2 > r.x1 and r.y2 > r.y1
			)
		end
		local time = tl.rects.time
		t.check("at " .. what .. " the time does not run into the help button", time.x2 <= tl.rects.help.x1, time.x2 .. " against " .. tl.rects.help.x1)

		click(tl, tl.rects.help)
		e.clear()
		tl:draw()
		t.check(
			"at " .. what .. " the key list is inside the view too",
			box.x1 >= 0 and box.y1 >= 0 and box.x2 <= vsx and box.y2 <= vsy,
			string.format("%g, %g to %g, %g", box.x1, box.y1, box.x2, box.y2)
		)
	end
end

-- It can be moved, and remembers where to.

do
	local e = engine(params())
	local tl = timeline(e)
	local panel = tl.rects.panel
	t.same("a fresh timeline has nothing to remember about its place", tl:config().x, nil)
	-- The gap between the time and the help button is empty panel.
	local gx, gy = (tl.rects.time.x2 + tl.rects.help.x1) / 2, (tl.rects.help.y1 + tl.rects.help.y2) / 2
	local x1, y1 = panel.x1, panel.y1
	t.same("a press on the panel itself is taken", tl:mousePress(gx, gy, 1), true)
	tl:mouseMove(gx + 300, gy + 500)
	tl:mouseRelease(gx + 300, gy + 500, 1)
	t.same("the panel moves across with the pointer", panel.x1, x1 + 300)
	t.same("and up with it", panel.y1, y1 + 500)
	t.same("moving it sends the player nothing", #e.sent, 0)

	local kept = tl:config()
	local again = timeline(engine(params()))
	again:setConfig(kept)
	t.same("the place is remembered across", again.rects.panel.x1, x1 + 300)
	t.same("and up", again.rects.panel.y1, y1 + 500)

	again:resize(800, 600)
	local small = again.rects.panel
	t.check("in a smaller view it is still inside", small.x1 >= 0 and small.y1 >= 0 and small.x2 <= 800 and small.y2 <= 600)

	tl:mousePress(gx + 300, gy + 500, 1)
	tl:mouseMove(gx + 5000, gy + 5000)
	tl:mouseRelease(gx + 5000, gy + 5000, 1)
	t.check("it cannot be dragged out of the view", panel.x2 <= 1920 and panel.y2 <= 1080, panel.x2 .. ", " .. panel.y2)

	again:setConfig({ x = "left", y = {} })
	t.same("a remembered place that is not a number is ignored", (again.rects.panel.x1 + again.rects.panel.x2) / 2, 400)
end

-- The keys can be changed.

do
	local e = engine(params())
	local tl = timeline(e)
	tl:setConfig({ keys = { toggle = { { key = "p" } }, back = { { key = "a", shift = true } } } })
	t.same("a key from the saved bindings is taken", tl:keyPress(CODES.p, NONE, false), true)
	t.same("and does its action", e.sent[1], "coilbox_rewind:toggle")
	t.same("the key it replaced is left alone", tl:keyPress(CODES.space, NONE, false), false)
	t.same("a binding that wants Shift is not taken without it", tl:keyPress(CODES.a, NONE, false), false)
	t.same("and is with it", tl:keyPress(CODES.a, SHIFT, false), true)
	t.same("an action the saved bindings do not name keeps its key", tl:keyPress(CODES.r, NONE, false), true)
	t.same("the saved bindings come back out", tl:config().keys.toggle[1].key, "p")

	local fresh = timeline(engine(params()))
	fresh:setConfig({ keys = { toggle = "space", reverse = { { key = 7 } }, nonsense = { { key = "p" } } } })
	t.same("saved bindings that are not bindings are ignored", fresh:keyPress(CODES.space, NONE, false), true)
	t.same("for each action", fresh:keyPress(CODES.r, NONE, false), true)
	t.same("and an action that does not exist binds nothing", fresh:keyPress(CODES.p, NONE, false), false)
end

-- Changing a key from the list: open it, click the row, press the key.

do
	local e = engine(params())
	local tl = timeline(e)
	t.same("the key list is closed to start with", tl.helpOpen, false)
	click(tl, tl.rects.help)
	t.same("the help button opens it", tl.helpOpen, true)
	tl:draw()
	t.check("it lists what a key does", e.texts["Play or pause"])
	t.check("and the key", e.texts["Space"])
	t.check("with both keys of an action that has two", e.texts["= or +"])
	t.check("and Shift where it is needed", e.texts["Shift+Left"])
	t.check("a key whose character is a speck is spelled out", e.texts["Comma"] and e.texts["Full stop"] and e.texts["Minus"])

	-- Every label of a row is on one baseline, half a capital below the row's
	-- middle, whatever letters it has. Centring each on its own letters put a
	-- comma where an apostrophe goes.
	local row = tl.rects["row:back"]
	local baseline = (row.y1 + row.y2) / 2 - 0.35 * tl.smallSize
	t.same("what a key does is on the row's baseline", e.texts["Back 1 second"], baseline)
	t.same("and so is the key", e.texts["Left"], baseline)

	-- Two rows share an edge, and a point on it is in one of them.
	local upper, lower = tl.rects["row:toggle"], tl.rects["row:reverse"]
	t.same("the rows of the list touch", upper.y1, lower.y2)
	tl:mousePress((upper.x1 + upper.x2) / 2, upper.y1, 1)
	t.same("a press on the edge two rows share is the lower row's", tl.listening, "reverse")
	tl:mousePress((upper.x1 + upper.x2) / 2, upper.y1, 1)
	t.same("and a second press there stops the wait", tl.listening, nil)

	click(tl, tl.rects["row:toggle"])
	t.same("a click on a row waits for a key", tl.listening, "toggle")
	t.same("Shift alone is not the key", tl:keyPress(CODES.shift, SHIFT, false), true)
	t.same("and it goes on waiting", tl.listening, "toggle")
	t.same("the next key is taken", tl:keyPress(CODES.p, NONE, false), true)
	t.same("without doing anything", #e.sent, 0)
	t.same("and it stops waiting", tl.listening, nil)
	tl:keyPress(CODES.p, NONE, false)
	t.same("the new key does the action", e.sent[1], "coilbox_rewind:toggle")
	t.same("the old key is left alone", tl:keyPress(CODES.space, NONE, false), false)
	e.clear()
	tl:draw()
	t.check("the list shows the new key", e.texts["P"])

	-- A key that another action has is taken from it.
	click(tl, tl.rects["row:reverse"])
	tl:keyPress(CODES.p, NONE, false)
	local sent = #e.sent
	tl:keyPress(CODES.p, NONE, false)
	t.same("a key given to a second action does only that one", e.sent[sent + 1], "coilbox_rewind:reverse")
	t.same("and nothing else", #e.sent, sent + 1)
	t.same("the first action is left with no key", #tl:config().keys.toggle, 0)

	click(tl, tl.rects["row:slower"])
	t.same("Escape is taken while waiting", tl:keyPress(CODES.escape, NONE, false), true)
	t.same("and stops the wait", tl.listening, nil)
	t.same("leaving the key as it was", tl:config().keys.slower[1].key, "-")

	click(tl, tl.rects.reset)
	t.same("the reset puts Space back", tl:keyPress(CODES.space, NONE, false), true)
	t.same("on play and pause", e.sent[#e.sent], "coilbox_rewind:toggle")
	t.same("and a timeline with the table's keys has none to remember", tl:config().keys, nil)

	t.same("Escape closes the list", tl:keyPress(CODES.escape, NONE, false), true)
	t.same("which is then closed", tl.helpOpen, false)
	t.same("and with the list closed Escape is the game's", tl:keyPress(CODES.escape, NONE, false), false)
end

-- Marks: the playback game can hold a list of them, and the keys go between.

do
	local files = {
		["coilbox_rewind/marks.lua"] = function()
			return { { frame = 2400 }, { frame = 900 }, { frame = 905 }, { frame = 3000 }, { frame = 99999 }, { frame = "x" }, 7 }
		end,
	}
	local e = engine(params(), files)
	local tl = timeline(e)
	e.params.coilbox_rewind_frame = 1000
	t.same("] is taken", tl:keyPress(CODES["]"], NONE, false), true)
	t.same("and seeks to the next mark", e.sent[#e.sent], "coilbox_rewind:seek 2400")
	t.same("[ is taken", tl:keyPress(CODES["["], NONE, false), true)
	t.same("and seeks to the mark before, which is the first of two that share a place on the bar", e.sent[#e.sent], "coilbox_rewind:seek 900")
	e.params.coilbox_rewind_frame = 3000
	local sent = #e.sent
	t.same("] at the last mark is taken", tl:keyPress(CODES["]"], NONE, false), true)
	t.same("and goes nowhere, since a mark past the track is not one", #e.sent, sent)
end

do
	local e = engine(params())
	local tl = timeline(e)
	t.same("with no marks ] is left alone", tl:keyPress(CODES["]"], NONE, false), false)
	t.same("and so is [", tl:keyPress(CODES["["], NONE, false), false)
	t.same("neither seeks", #e.sent, 0)

	local broken = timeline(engine(params(), {
		["coilbox_rewind/marks.lua"] = function()
			error("not Lua")
		end,
	}))
	t.same("a marks file that fails to load is no marks", broken:keyPress(CODES["]"], NONE, false), false)
end

-- Drawing allocates nothing once what it shows has been seen.

do
	local e = engine(params())
	e.params.coilbox_rewind_note = "Aiming is off on this engine"
	local tl = timeline(e)
	click(tl, tl.rects.help)
	local bar = tl.rects.bar
	e.mouseX, e.mouseY = middle(tl.rects.toggle)
	local frames = 300
	local function play()
		for frame = 1, frames do
			-- Every frame of one second of the match, over and over, with the
			-- pointer moving across the bar. The time's text is made when the
			-- second it shows changes, which is not on a frame of these.
			e.params.coilbox_rewind_frame = 600 + frame % 30
			e.mouseX = bar.x1 + frame
			tl:draw()
		end
	end
	play()
	collectgarbage("collect")
	collectgarbage("stop")
	local before = collectgarbage("count")
	play()
	local grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 draws inside one shown second allocate nothing, in kilobytes", grew, 0)
end

-- The widget file, loaded the way a widget handler loads one.

do
	local e = engine(params())
	local env = t.unsyncedEnv()
	env.widget = {}
	env.Spring = e.Spring
	env.Spring.GetViewGeometry = function()
		return 1920, 1080
	end
	env.Spring.Echo = function(line)
		e.line = line
	end
	env.gl, env.GL = e.gl, e.GL
	env.VFS = {
		ZIP = "z",
		FileExists = e.VFS.FileExists,
		Include = function(path, _, mode)
			assert(mode == "z", "the widget reads its module from somewhere other than the game")
			local chunk = assert(loadfile(t.root() .. "/" .. path))
			setfenv(chunk, env)
			return chunk()
		end,
	}
	local chunk = assert(loadfile(WIDGET))
	setfenv(chunk, env)
	chunk()
	local widget = env.widget
	local info = widget:GetInfo()
	t.same("the widget names itself", info.name, "Coilbox rewind timeline")
	t.same("it is on unless the player turns it off", info.enabled, true)
	t.same("it offers MIT or GPL", info.license, "MIT or GNU GPL, v2 or later")

	t.same("before it starts a key is left alone", widget:KeyPress(CODES.space, NONE, false), false)
	widget:SetConfigData({ keys = { toggle = { { key = "p" } } } })
	widget:Initialize()
	t.same("a key reaches the timeline and is taken", widget:KeyPress(CODES.p, NONE, false), true)
	t.same("its message goes to the player", e.sent[1], "coilbox_rewind:toggle")
	t.same("the bindings set before it started are kept", widget:KeyPress(CODES.space, NONE, false), false)
	t.same("and are handed back to be saved", widget:GetConfigData().keys.toggle[1].key, "p")
	widget:DrawScreen()
	t.check("it draws", e.shapes > 0)
	t.same("the pointer over the bottom centre is over it", widget:IsAbove(960, 40), true)
	t.same("a press there is taken", widget:MousePress(960, 40, 1), true)
	widget:MouseMove(960, 300, 0, 260, 1)
	widget:MouseRelease(960, 300, 1)
	widget:ViewResize(1280, 720)
	widget:DrawScreen()
	local saved = widget:GetConfigData()
	t.check("its place is handed back to be saved", type(saved.x) == "number" and type(saved.y) == "number")
	widget:ViewResize()
	t.same("a resize that names no size asks the engine", widget:IsAbove(5, 5), false)

	-- From the top of the panel down, the first press that begins a drag is on
	-- the bar.
	local began = false
	for y = 1080, 1, -1 do
		local n = #e.sent
		widget:MousePress(960, y, 1)
		if e.sent[n + 1] == "coilbox_rewind:drag 1" then
			began = true
			break
		end
		widget:MouseRelease(960, y, 1)
	end
	t.same("a press on the bar begins a drag", began, true)
	widget:Shutdown()
	t.same("a widget switched off in the middle of a drag ends it", e.sent[#e.sent], "coilbox_rewind:drag 0")
end

-- What the widget needs from the engine (issue #3802). The table is the
-- widget's own, since the synced gadget cannot look at `gl` or the unsynced
-- `Spring`. The tests are made from it as the gadget's are.

do
	local Scan = dofile(here .. "/scan.lua")
	local PREFIX = "COILBOX_REWIND_TIMELINE "
	local ENGINE = t.root() .. "/luaui/rewind_timeline/coilbox_timeline_engine.lua"
	local chunk = assert(loadfile(ENGINE))
	setfenv(chunk, t.unsyncedEnv())
	local Table = chunk()

	local ids = {}
	for _, row in ipairs(Table.ROWS) do
		local label = "widget row " .. tostring(row.id)
		t.check(label .. " has an id nobody else has", type(row.id) == "string" and not ids[row.id])
		ids[row.id] = true
		t.check(label .. " names its calls", type(row.calls) == "table" and #row.calls > 0)
		t.check(label .. " says how it is checked", row.how == "presence" or row.how == "behaviour")
		t.check(label .. " says whether it is required", type(row.required) == "boolean")
		t.check(label .. " says what it is for, what happens without it and where", row.feature and row.without and row.used and true)
		t.check(label .. " names the engine that has it", type(row.since) == "string")
	end

	-- Every engine name the widget uses has a row, and every row is used.
	local allowed = Scan.setOf(Scan.callsOf(Table.ROWS), Table.ASSUMED)
	local used = {}
	local files = Scan.filesUnder(t.root() .. "/luaui")
	t.check("the scan found the widget's files", #files >= 2, #files)
	for _, path in ipairs(files) do
		for name in pairs(Scan.usedBy(path)) do
			used[name] = true
			t.check(path:match("[^/]+$") .. " uses " .. name .. ", which has a row", allowed[name], "add " .. name .. " to coilbox_timeline_engine.lua")
		end
	end
	for _, call in ipairs(Scan.callsOf(Table.ROWS)) do
		t.check(call .. " has a row and the widget uses it", used[call])
	end

	local function removeFrom(env, name)
		local parts = {}
		for part in name:gmatch("[^.]+") do
			parts[#parts + 1] = part
		end
		local holder = rawget(env, parts[1])
		for i = 2, #parts - 1 do
			holder = holder[parts[i]]
		end
		holder[parts[#parts]] = nil
	end

	--- The widget file, loaded as a handler loads it, on an engine without
	-- `removed`. Gives the widget, the stand-in engine and the lines logged.
	local MARKS = { ["coilbox_rewind/marks.lua"] = function()
		return { { frame = 1000 } }
	end }
	local function widgetScene(removed)
		local e = engine(params(), MARKS)
		local lines = {}
		local env = t.unsyncedEnv()
		env.widget = {}
		env.Spring = e.Spring
		env.Spring.GetViewGeometry = function()
			return 1920, 1080
		end
		env.Spring.Echo = function(line)
			lines[#lines + 1] = line
		end
		env.gl, env.GL = e.gl, e.GL
		env.VFS = {
			ZIP = "z",
			FileExists = e.VFS.FileExists,
			Include = function(path, _, mode)
				assert(mode == env.VFS.ZIP, "the widget reads its module from somewhere other than the game")
				if MARKS[path] then
					return MARKS[path]()
				end
				local module = assert(loadfile(t.root() .. "/" .. path))
				setfenv(module, env)
				return module()
			end,
		}
		if removed then
			removeFrom(env, removed)
		end
		local file = assert(loadfile(WIDGET))
		setfenv(file, env)
		file()
		return env.widget, e, lines
	end

	do
		local widget, e, lines = widgetScene()
		widget:Initialize()
		widget:DrawScreen()
		t.same("with every call there the widget logs nothing", #lines, 0)
		t.check("and draws", e.shapes > 0)
		t.same("and marks are on", widget:KeyPress(CODES["]"], NONE, false), true)
		t.same("so the mark key seeks to the mark", e.sent[1], "coilbox_rewind:seek 1000")
	end

	for _, row in ipairs(Table.ROWS) do
		for _, call in ipairs(row.calls) do
			local label = "widget without " .. call
			local widget, e, lines = widgetScene(call)
			local ok, err = pcall(function()
				widget:Initialize()
				widget:DrawScreen()
				widget:ViewResize(1280, 720)
				widget:DrawScreen()
				widget:KeyPress(CODES.space, NONE, false)
				widget:IsAbove(960, 40)
				widget:MousePress(960, 40, 1)
				widget:MouseRelease()
			end)
			t.check(label .. " raises nothing", ok, err)
			local line = lines[1]
			t.same(label .. " logs one line", #lines, 1)
			t.check(label .. " starting with the widget's prefix", line ~= nil and line:sub(1, #PREFIX) == PREFIX, line)
			t.check(label .. " naming the call", line ~= nil and line:find("this engine has no " .. call, 1, true) ~= nil, line)
			t.check(label .. " and the engine that has it", line ~= nil and line:find("Engine " .. row.since .. " and later have it", 1, true) ~= nil, line)
			if row.required then
				t.check(label .. " the line says it cannot start", line ~= nil and line:find("cannot start", 1, true) ~= nil, line)
				t.same(label .. " nothing is drawn", e.shapes, 0)
				t.same(label .. " a key is left to the game", widget:KeyPress(CODES.space, NONE, false), false)
				t.same(label .. " the pointer is not over it", widget:IsAbove(960, 40), false)
				t.same(label .. " nothing is sent to the player", #e.sent, 0)
			else
				t.check(label .. " the line says " .. row.feature .. " is switched off", line ~= nil and line:find("Switched off: " .. row.feature .. ".", 1, true) ~= nil, line)
				t.check(label .. " the timeline still draws", e.shapes > 0)
				if row.id == "marks" then
					t.same(label .. " the mark key is left to the game", widget:KeyPress(CODES["]"], NONE, false), false)
				end
			end
		end
	end
end

t.report()
