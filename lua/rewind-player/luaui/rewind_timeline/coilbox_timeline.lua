-- Coilbox rewind timeline: the bar, the buttons and the keys (issue #3798).
--
-- The player gadget publishes its time as game rules parameters and takes
-- messages. This reads the first and sends the second. It keeps nothing about
-- playback: what it draws is what the parameters say on that draw, and a click
-- or a key is one message. What it does keep is its own: where the panel is,
-- which keys do what, and whether the key list is open.
--
-- The keys are the replay page's (src/content/replayMapView/timelineKeys.ts),
-- so that the two behave the same way. A key held with Ctrl, Alt or Meta is
-- never taken.
--
-- It draws with gl.Color, gl.Rect, gl.BeginEnd, gl.Vertex and gl.Text, and
-- measures with gl.GetTextWidth and gl.GetTextHeight, in the engine's own
-- font. Its one other call is gl.Texture(false), to drop a texture an earlier
-- widget left bound. All of those are in the engine at 105.0 and at
-- 2026.07.04, and need no shader, texture or font from the game.
--
-- A draw allocates nothing. The shapes go through functions made once, and a
-- text is made when what it says changes.
--
-- The look follows Slate, the interface in luaui/slate of
-- Recoil-Game-Archive/xta-springrts: a dark translucent panel with a thin
-- light border, rounded corners, and buttons that are a faint wash of white.
-- The colours and proportions are Slate's and every line here was written for
-- coilbox.
--
-- The engine is handed in as a table, and nothing here reaches for a global of
-- it, so the tests run the same file on a stand-in.
--
-- Change this in the coilbox repository under lua/rewind-player/.

local M = {}

--- What a message for the player starts with.
M.PREFIX = "coilbox_rewind:"

--- The player's parameters, and one more. `note` is a short line the timeline
-- shows above itself whenever the parameter holds a string. The player sets it
-- to say what an older engine has switched off (issue #3802).
M.PARAMS = {
	frame = "coilbox_rewind_frame",
	playing = "coilbox_rewind_playing",
	direction = "coilbox_rewind_direction",
	speed = "coilbox_rewind_speed",
	first = "coilbox_rewind_first_frame",
	last = "coilbox_rewind_last_frame",
	fps = "coilbox_rewind_frames_per_second",
	note = "coilbox_rewind_note",
}

--- Where the playback game keeps its marks, when it has any: a Lua file that
-- returns a list of `{ frame = n }`. Nothing writes it yet (issue #3978).
M.MARKS_PATH = "coilbox_rewind/marks.lua"

--- What one arrow press moves, and what one with Shift held moves. The replay
-- page's own two numbers.
M.STEP_SECONDS = 1
M.LARGE_STEP_SECONDS = 10

--- Every action, in the order the key list shows them, with the keys of the
-- replay page's table. A key is the engine's name for it, the one
-- `Spring.GetKeyCode` takes. `shift` is whether Shift must be held, and absent
-- means it is not looked at.
M.ACTIONS = {
	{ id = "toggle", does = "Play or pause", keys = { { key = "space" } } },
	{ id = "reverse", does = "Play the other way", keys = { { key = "r" } } },
	{ id = "back", does = "Back 1 second", keys = { { key = "left", shift = false } } },
	{ id = "forward", does = "Forward 1 second", keys = { { key = "right", shift = false } } },
	{ id = "backLarge", does = "Back 10 seconds", keys = { { key = "left", shift = true } } },
	{ id = "forwardLarge", does = "Forward 10 seconds", keys = { { key = "right", shift = true } } },
	{ id = "frameBack", does = "Back one frame", keys = { { key = "," } } },
	{ id = "frameForward", does = "Forward one frame", keys = { { key = "." } } },
	{ id = "start", does = "Go to the start", keys = { { key = "home" } } },
	{ id = "finish", does = "Go to the end", keys = { { key = "end" } } },
	{ id = "markBack", does = "Go to the previous mark", keys = { { key = "[" } } },
	{ id = "markForward", does = "Go to the next mark", keys = { { key = "]" } } },
	{ id = "slower", does = "Slower", keys = { { key = "-" } } },
	{ id = "faster", does = "Faster", keys = { { key = "=" }, { key = "+" } } },
	-- Not the replay page's. It switches the ghosts of queued buildings, which
	-- are another widget's (issue #3804), through the switch that widget offers.
	{ id = "ghosts", does = "Show queued buildings", keys = { { key = "g" } } },
}

local ACTION = {}
for i = 1, #M.ACTIONS do
	ACTION[M.ACTIONS[i].id] = M.ACTIONS[i]
end

-- Key codes as the engine hands them to `KeyPress`, from
-- cont/LuaUI/Headers/keysym.h.lua. 300 to 313 are the lock keys and the left
-- and right Shift, Ctrl, Alt, Meta, Super and Alt Gr.
local ESCAPE = 27
local FIRST_MODIFIER, LAST_MODIFIER = 300, 313

-- Colours, as red, green, blue and alpha.
local LOOK = {
	panel = { 0.050, 0.055, 0.063, 0.82 },
	border = { 1, 1, 1, 0.14 },
	button = { 1, 1, 1, 0.07 },
	buttonBorder = { 1, 1, 1, 0.13 },
	buttonHover = { 1, 1, 1, 0.16 },
	buttonActive = { 1, 1, 1, 0.20 },
	track = { 1, 1, 1, 0.10 },
	accent = { 0.663, 0.741, 0.816, 1 },
	text = { 0.925, 0.933, 0.941, 1 },
	textDim = { 0.710, 0.729, 0.757, 1 },
	warn = { 0.949, 0.761, 0.188, 1 },
}

-- Sizes, in pixels of a view 1,080 high. They grow and shrink with the view's
-- height, and stop shrinking at MIN_SCALE so that the text of a small window
-- can still be read. All of these are design choices, not measurements.
local BASE_HEIGHT = 1080
local MIN_SCALE = 0.75
local MARGIN = 16
local PANEL_W = 640
local PAD = 12
local BAR_H = 20
local ROW_GAP = 8
local BUTTON_W = 36
local BUTTON_H = 32
local GAP = 6
local SPEED_W = 56
local RADIUS = 8
local BUTTON_RADIUS = 5
local TRACK_H = 6
local KNOB = 16
local TEXT = 14
local SMALL_TEXT = 12
local NOTE_H = 28
local HELP_W = 340
local HELP_ROW = 26
local RESET_H = 30
-- The width of a mark, and so of a column of the bar. Marks closer together
-- than this are one mark, as on the replay page.
local COLUMN = 8

local floor, max, min = math.floor, math.max, math.min

-- A quarter turn in ARC steps, for a rounded corner.
local ARC = 4
local COS, SIN = {}, {}
for i = 0, ARC do
	COS[i] = math.cos(i / ARC * math.pi / 2)
	SIN[i] = math.sin(i / ARC * math.pi / 2)
end

--- The outline of a rectangle with rounded corners, anticlockwise from the
-- left of the bottom left corner.
local function path(vertex, x1, y1, x2, y2, r)
	for i = 0, ARC do
		vertex(x1 + r - r * COS[i], y1 + r - r * SIN[i])
	end
	for i = 0, ARC do
		vertex(x2 - r + r * SIN[i], y1 + r - r * COS[i])
	end
	for i = 0, ARC do
		vertex(x2 - r + r * COS[i], y2 - r + r * SIN[i])
	end
	for i = 0, ARC do
		vertex(x1 + r - r * SIN[i], y2 - r + r * COS[i])
	end
end

local function triangle(vertex, ax, ay, bx, by, cx, cy)
	vertex(ax, ay)
	vertex(bx, by)
	vertex(cx, cy)
end

local function inside(rect, x, y)
	return x >= rect.x1 and x <= rect.x2 and y >= rect.y1 and y <= rect.y2
end

--- The same for a row of the key list. The rows touch, and a point on the edge
-- two of them share is in the lower one only.
local function insideRow(rect, x, y)
	return x >= rect.x1 and x <= rect.x2 and y > rect.y1 and y <= rect.y2
end

local function set(rect, x1, y1, x2, y2)
	rect.x1, rect.y1, rect.x2, rect.y2 = x1, y1, x2, y2
end

--- A time in whole seconds as the replay page writes one.
local function clock(seconds)
	local hours = floor(seconds / 3600)
	local minutes = floor(seconds / 60) % 60
	if hours > 0 then
		return string.format("%d:%02d:%02d", hours, minutes, seconds % 60)
	end
	return string.format("%d:%02d", minutes, seconds % 60)
end

-- Keys whose own character is too small a mark to read in a list.
local SPELLED = { [","] = "Comma", ["."] = "Full stop", ["-"] = "Minus" }

--- A key's name as the list shows it: "space" as "Space" and "r" as "R".
local function shown(key)
	return SPELLED[key] or (key:sub(1, 1):upper() .. key:sub(2))
end

--- The frames of the marks the game holds, in order. A game with no marks
-- file, or one that does not load, has none.
local function loadMarks(VFS)
	local frames = {}
	if not VFS or not VFS.FileExists(M.MARKS_PATH, VFS.ZIP) then
		return frames
	end
	-- The file is data, so it runs with no globals to reach for.
	local ok, list = pcall(VFS.Include, M.MARKS_PATH, {}, VFS.ZIP)
	if not ok or type(list) ~= "table" then
		return frames
	end
	for i = 1, #list do
		local frame = type(list[i]) == "table" and list[i].frame
		if type(frame) == "number" then
			frames[#frames + 1] = frame
		end
	end
	table.sort(frames)
	return frames
end

local function defaultKeys()
	local keys = {}
	for i = 1, #M.ACTIONS do
		local action = M.ACTIONS[i]
		local list = {}
		for k = 1, #action.keys do
			list[k] = { key = action.keys[k].key, shift = action.keys[k].shift }
		end
		keys[action.id] = list
	end
	return keys
end

local Timeline = {}
Timeline.__index = Timeline

--- A timeline. `engine` has the engine's `Spring`, `gl`, `GL` and `VFS`.
function M.new(engine)
	local self = setmetatable({
		Spring = engine.Spring,
		gl = engine.gl,
		GL = engine.GL,
		-- The widgets' shared table, where the ghosts widget offers its switch.
		WG = engine.WG,
		-- Whether the player is there, as of the last read.
		present = false,
		keys = defaultKeys(),
		customKeys = false,
		marks = loadMarks(engine.VFS),
		-- The marks as the bar draws them: the first frame of each column.
		groups = {},
		groupCount = 0,
		helpOpen = false,
		-- The action whose row in the key list is waiting for a key.
		listening = nil,
		rects = { panel = {}, bar = {}, time = {}, note = {}, helpPanel = {}, reset = {}, speed = {} },
		speedTexts = {},
		labels = {},
		tips = {},
	}, Timeline)
	for _, id in ipairs({ "reverse", "toggle", "slower", "faster", "help" }) do
		self.rects[id] = {}
	end
	for i = 1, #M.ACTIONS do
		self.rects["row:" .. M.ACTIONS[i].id] = {}
	end
	self:rebind()
	return self
end

--- Works out, from the bindings, which action a key code does and what the
-- key list and the tooltips say.
function Timeline:rebind()
	local Spring = self.Spring
	self.byCode = {}
	for i = 1, #M.ACTIONS do
		local action = M.ACTIONS[i]
		local names = {}
		for _, binding in ipairs(self.keys[action.id]) do
			local code = Spring.GetKeyCode(binding.key)
			if type(code) == "number" and code > 0 then
				local list = self.byCode[code] or {}
				self.byCode[code] = list
				list[#list + 1] = { shift = binding.shift, action = action.id }
			end
			names[#names + 1] = (binding.shift and "Shift+" or "") .. shown(binding.key)
		end
		local label = table.concat(names, " or ")
		self.labels[action.id] = label ~= "" and label or "No key"
		self.tips[action.id] = label ~= "" and (action.does .. " (" .. label .. ")") or action.does
	end
end

function Timeline:send(text)
	self.Spring.SendLuaRulesMsg(M.PREFIX .. text)
end

--- Reads the player's parameters. Gives false when there is no player, which
-- is a game with no track or a bad one, or an engine too old to play on. The
-- note is read all the same, since that engine is what it says.
function Timeline:read()
	local get = self.Spring.GetGameRulesParam
	local P = M.PARAMS
	local first = get(P.first)
	if type(first) ~= "number" then
		self.present = false
		local said = get(P.note)
		if type(said) ~= "string" or said == "" then
			said = nil
		end
		if said ~= self.note then
			self.note = said
			if self.scale then
				self:layout()
			end
		end
		return false
	end
	local last = get(P.last)
	local ranged = first ~= self.first or last ~= self.last
	self.first, self.last = first, last
	self.frame = get(P.frame)
	self.playing = get(P.playing) == 1
	self.direction = get(P.direction) == -1 and -1 or 1
	self.speed = get(P.speed)
	self.fps = get(P.fps)
	self.present = true

	local note = get(P.note)
	if type(note) ~= "string" or note == "" then
		note = nil
	end
	if self.scale then
		if note ~= self.note then
			self.note = note
			self:layout()
		elseif ranged then
			self:group()
		end
		self:refreshTime()
	else
		self.note = note
	end
	return true
end

--- Makes the time's text again when the second it shows has changed.
function Timeline:refreshTime()
	local now = floor(max(0, self.frame - self.first) / self.fps)
	local length = floor((self.last - self.first) / self.fps)
	if now == self.shownNow and length == self.shownLength then
		return
	end
	self.shownNow, self.shownLength = now, length
	self.timeText = clock(now) .. " / " .. clock(length)
	local time = self.rects.time
	time.x2 = time.x1 + self.gl.GetTextWidth(self.timeText) * self.textSize
end

--- Puts the marks into the columns of the bar. Each column that has any keeps
-- its first, which is where the bar draws a mark and where a mark key goes.
function Timeline:group()
	local bar, marks, groups = self.rects.bar, self.marks, self.groups
	local count = 0
	local span = self.last - self.first
	local columns = floor((bar.x2 - bar.x1) / self.column)
	local held
	for i = 1, #marks do
		local frame = marks[i]
		if frame >= self.first and frame <= self.last and columns > 0 then
			local column = span <= 0 and 0 or min(columns - 1, floor((frame - self.first) / span * columns))
			if column ~= held then
				held = column
				count = count + 1
				groups[count] = frame
			end
		end
	end
	self.groupCount = count
end

--- The view's size, from `widget:ViewResize`.
function Timeline:resize(vsx, vsy)
	self.vsx, self.vsy = vsx, vsy
	self:layout()
end

--- Finds room for a panel `height` high above what is stacked on the timeline,
-- or below it when there is none above. Gives the panel's bottom edge.
local function stack(self, height, gap)
	if self.stackTop + gap + height <= self.vsy then
		local y1 = self.stackTop + gap
		self.stackTop = y1 + height
		return y1
	end
	if self.stackBottom - gap - height >= 0 then
		self.stackBottom = self.stackBottom - gap - height
		return self.stackBottom
	end
	return max(0, self.vsy - height)
end

--- Works out where everything is. Called when the view changes size, when the
-- panel is moved and when the note or the key list comes or goes, and never by
-- a draw that changes none of those.
function Timeline:layout()
	local vsx, vsy, rects = self.vsx, self.vsy, self.rects
	local s = max(vsy / BASE_HEIGHT, MIN_SCALE)
	self.scale = s
	local function px(value)
		return floor(value * s + 0.5)
	end
	self.textSize, self.smallSize = px(TEXT), px(SMALL_TEXT)
	self.radius, self.buttonRadius = px(RADIUS), px(BUTTON_RADIUS)
	self.trackHalf, self.knobHalf = px(TRACK_H) / 2, px(KNOB) / 2
	self.column = max(1, px(COLUMN))
	self.unit = s
	-- Half the height of a capital, in multiples of the font size.
	self.capHalf = self.gl.GetTextHeight("X") / 2

	local margin, pad, gap = px(MARGIN), px(PAD), px(GAP)
	local w = min(px(PANEL_W), vsx - 2 * margin)
	if (vsx - w) % 2 == 1 then
		w = w - 1
	end
	local h = pad + px(BAR_H) + px(ROW_GAP) + px(BUTTON_H) + pad
	local x1 = self.x and floor(self.x * vsx - w / 2 + 0.5) or (vsx - w) / 2
	local y1 = self.y and floor(self.y * vsy + 0.5) or margin
	x1 = max(0, min(x1, vsx - w))
	y1 = max(0, min(y1, vsy - h))
	local x2, y2 = x1 + w, y1 + h
	set(rects.panel, x1, y1, x2, y2)

	-- The bottom row: the buttons, the speed between two of them, the time, and
	-- the help button at the far end.
	local by1 = y1 + pad
	local by2 = by1 + px(BUTTON_H)
	local bw = px(BUTTON_W)
	local x = x1 + pad
	set(rects.reverse, x, by1, x + bw, by2)
	x = x + bw + gap
	set(rects.toggle, x, by1, x + bw, by2)
	x = x + bw + 2 * gap
	set(rects.slower, x, by1, x + bw, by2)
	x = x + bw
	set(rects.speed, x, by1, x + px(SPEED_W), by2)
	x = x + px(SPEED_W)
	set(rects.faster, x, by1, x + bw, by2)
	x = x + bw + px(14)
	set(rects.time, x, by1, x, by2)
	set(rects.help, x2 - pad - (by2 - by1), by1, x2 - pad, by2)

	-- The bar above it. Its ends are where the knob's middle can go.
	local barY = by2 + px(ROW_GAP)
	set(rects.bar, x1 + pad + self.knobHalf, barY, x2 - pad - self.knobHalf, barY + px(BAR_H))

	self.stackTop, self.stackBottom = y2, y1
	if self.note then
		local nw = min(vsx, floor(self.gl.GetTextWidth(self.note) * self.smallSize) + 2 * pad)
		local nx = max(0, min(floor((x1 + x2 - nw) / 2), vsx - nw))
		local ny = stack(self, px(NOTE_H), gap)
		set(rects.note, nx, ny, nx + nw, ny + px(NOTE_H))
	end
	if self.helpOpen then
		local row = px(HELP_ROW)
		local hw = min(px(HELP_W), vsx)
		local hh = pad + row + #M.ACTIONS * row + gap + px(RESET_H) + pad
		local hx = max(0, min(x2 - hw, vsx - hw))
		local hy = stack(self, hh, margin)
		set(rects.helpPanel, hx, hy, hx + hw, hy + hh)
		set(rects.reset, hx + pad, hy + pad, hx + hw - pad, hy + pad + px(RESET_H))
		local top = hy + hh - pad - row
		for i = 1, #M.ACTIONS do
			set(rects["row:" .. M.ACTIONS[i].id], hx + pad, top - i * row, hx + hw - pad, top - (i - 1) * row)
		end
		self.helpTitleY = top + row / 2
	end

	if self.present then
		self:group()
		self.shownNow = nil
		self:refreshTime()
	end
end

--- The frame under `x` on the bar, held inside the track.
function Timeline:frameAt(x)
	local bar = self.rects.bar
	local frame = self.first + (x - bar.x1) / (bar.x2 - bar.x1) * (self.last - self.first)
	return floor(max(self.first, min(self.last, frame)) + 0.5)
end

--- Where the knob's middle is.
function Timeline:knobX()
	local bar = self.rects.bar
	local span = self.last - self.first
	if span <= 0 then
		return bar.x1
	end
	return bar.x1 + (self.frame - self.first) / span * (bar.x2 - bar.x1)
end

--- Seeks to the frame under `x`, unless the last seek of this drag was to it.
local function drag(self, x)
	local frame = self:frameAt(x)
	if frame ~= self.sought then
		self.sought = frame
		self:send(string.format("seek %d", frame))
	end
end

--- The mark after the frame, or the one before it, or nil.
local function markFrom(self, direction)
	local groups, frame = self.groups, self.frame
	if direction == 1 then
		for i = 1, self.groupCount do
			if groups[i] > frame then
				return groups[i]
			end
		end
	else
		for i = self.groupCount, 1, -1 do
			if groups[i] < frame then
				return groups[i]
			end
		end
	end
end

-- What each action sends. A held key repeats a move and not a switch.
local SWITCH = { toggle = "toggle", reverse = "reverse" }
local MOVE = { frameBack = "step -1", frameForward = "step 1", slower = "slower", faster = "faster" }
local SECONDS = {
	back = -M.STEP_SECONDS,
	forward = M.STEP_SECONDS,
	backLarge = -M.LARGE_STEP_SECONDS,
	forwardLarge = M.LARGE_STEP_SECONDS,
}

--- Does an action. Gives whether the key was the timeline's to take, which it
-- is not for a mark key in a game with no marks: there is nothing for it to
-- do, so it stays the game's.
local function perform(self, id, isRepeat)
	if SWITCH[id] then
		if not isRepeat then
			self:send(SWITCH[id])
		end
	elseif MOVE[id] then
		self:send(MOVE[id])
	elseif SECONDS[id] then
		self:send(string.format("step %d", SECONDS[id] * self.fps))
	elseif id == "start" then
		self:send(string.format("seek %d", self.first))
	elseif id == "finish" then
		self:send(string.format("seek %d", self.last))
	elseif id == "ghosts" then
		-- With no ghosts widget the key is the game's. A held key is taken and
		-- does not switch again.
		local ghosts = self.WG and self.WG.coilboxRewindGhosts
		if not ghosts then
			return false
		end
		if not isRepeat then
			ghosts.toggle()
		end
	else
		if self.groupCount == 0 then
			return false
		end
		local frame = markFrom(self, id == "markForward" and 1 or -1)
		if frame then
			self:send(string.format("seek %d", frame))
		end
	end
	return true
end

--- Gives `action` the key just pressed, and takes it from any action that had
-- it.
local function capture(self, key, mods)
	if key == ESCAPE then
		self.listening = nil
		return true
	end
	if key >= FIRST_MODIFIER and key <= LAST_MODIFIER then
		return true
	end
	local id = self.listening
	self.listening = nil
	local name = self.Spring.GetKeySymbol(key)
	-- A key the engine cannot name back to the same code could not be saved.
	if type(name) ~= "string" or self.Spring.GetKeyCode(name) ~= key then
		return true
	end
	local shift = mods.shift and true or false
	for _, list in pairs(self.keys) do
		for i = #list, 1, -1 do
			if list[i].key == name and (list[i].shift == nil or list[i].shift == shift) then
				table.remove(list, i)
			end
		end
	end
	self.keys[id] = { { key = name, shift = shift } }
	self.customKeys = true
	self:rebind()
	return true
end

--- A key press, from `widget:KeyPress`. Gives true for a key the timeline
-- took, which the widget hands back so that the key goes no further.
function Timeline:keyPress(key, mods, isRepeat)
	if not self:read() then
		return false
	end
	if mods.ctrl or mods.alt or mods.meta then
		return false
	end
	if self.listening then
		return capture(self, key, mods)
	end
	if self.helpOpen and key == ESCAPE then
		self.helpOpen = false
		self:layout()
		return true
	end
	local list = self.byCode[key]
	if not list then
		return false
	end
	local shift = mods.shift and true or false
	for i = 1, #list do
		if list[i].shift == nil or list[i].shift == shift then
			return perform(self, list[i].action, isRepeat)
		end
	end
	return false
end

function Timeline:isAbove(x, y)
	if not self.present or not self.scale then
		return false
	end
	return inside(self.rects.panel, x, y) or (self.helpOpen and inside(self.rects.helpPanel, x, y))
end

local BUTTONS = { "reverse", "toggle", "slower", "faster" }

--- What the pointer is over, for the engine's tooltip.
function Timeline:tooltip(x, y)
	for i = 1, #BUTTONS do
		if inside(self.rects[BUTTONS[i]], x, y) then
			return self.tips[BUTTONS[i]]
		end
	end
	if inside(self.rects.help, x, y) then
		return "Keys"
	end
	return ""
end

local function overBar(self, x, y)
	local bar = self.rects.bar
	return x >= bar.x1 - self.knobHalf and x <= bar.x2 + self.knobHalf and y >= bar.y1 and y <= bar.y2
end

--- A press, from `widget:MousePress`. Gives true for one on the timeline, and
-- the moves and the release that follow are then the timeline's.
function Timeline:mousePress(x, y, button)
	if not self:read() or not self.scale then
		return false
	end
	local rects = self.rects
	local waiting = self.listening
	self.listening = nil

	if self.helpOpen and inside(rects.helpPanel, x, y) then
		if button ~= 1 then
			return true
		end
		if inside(rects.reset, x, y) then
			self.keys = defaultKeys()
			self.customKeys = false
			self:rebind()
			return true
		end
		for i = 1, #M.ACTIONS do
			local id = M.ACTIONS[i].id
			if insideRow(rects["row:" .. id], x, y) and waiting ~= id then
				self.listening = id
			end
		end
		return true
	end
	if not inside(rects.panel, x, y) then
		return false
	end
	if button ~= 1 then
		return true
	end
	if overBar(self, x, y) then
		self.dragging = true
		self.sought = nil
		drag(self, x)
		return true
	end
	for i = 1, #BUTTONS do
		if inside(rects[BUTTONS[i]], x, y) then
			self:send(BUTTONS[i])
			return true
		end
	end
	if inside(rects.help, x, y) then
		self.helpOpen = not self.helpOpen
		self:layout()
		return true
	end
	-- Anywhere else on the panel takes hold of it, to move it.
	self.moving = true
	self.holdX, self.holdY = x - rects.panel.x1, y - rects.panel.y1
	return true
end

function Timeline:mouseMove(x, y)
	if self.dragging then
		drag(self, x)
	elseif self.moving then
		local panel = self.rects.panel
		local w, h = panel.x2 - panel.x1, panel.y2 - panel.y1
		local x1 = max(0, min(x - self.holdX, self.vsx - w))
		local y1 = max(0, min(y - self.holdY, self.vsy - h))
		-- Kept as a share of the view, so that the place holds in another size.
		self.x, self.y = (x1 + w / 2) / self.vsx, y1 / self.vsy
		self:layout()
	end
end

function Timeline:mouseRelease()
	self.dragging = false
	self.moving = false
end

--- What to remember for next time: where the panel was moved to, and the keys
-- when they are not the table's.
function Timeline:config()
	local data = {}
	if self.x then
		data.x, data.y = self.x, self.y
	end
	if self.customKeys then
		data.keys = {}
		for id, list in pairs(self.keys) do
			local out = {}
			for i = 1, #list do
				out[i] = { key = list[i].key, shift = list[i].shift }
			end
			data.keys[id] = out
		end
	end
	return data
end

--- A list of bindings out of saved data, or nil when it is not one.
local function bindings(saved)
	if type(saved) ~= "table" then
		return nil
	end
	local list = {}
	for i = 1, #saved do
		local binding = saved[i]
		if type(binding) ~= "table" or type(binding.key) ~= "string" then
			return nil
		end
		if binding.shift ~= nil and type(binding.shift) ~= "boolean" then
			return nil
		end
		list[i] = { key = binding.key, shift = binding.shift }
	end
	return list
end

--- Takes back what `config` gave. Anything in it that is not what `config`
-- writes is ignored, since the file it is kept in can be edited.
function Timeline:setConfig(data)
	if type(data) ~= "table" then
		return
	end
	if type(data.x) == "number" and type(data.y) == "number" then
		self.x, self.y = data.x, data.y
	else
		self.x, self.y = nil, nil
	end
	if type(data.keys) == "table" then
		for id, saved in pairs(data.keys) do
			local list = ACTION[id] and bindings(saved)
			if list then
				self.keys[id] = list
				self.customKeys = true
			end
		end
		self:rebind()
	end
	if self.vsx then
		self:layout()
	end
end

--------------------------------------------------------------------------------
-- Drawing.
--------------------------------------------------------------------------------

local function colour(gl, c)
	gl.Color(c[1], c[2], c[3], c[4])
end

local function fill(self, x1, y1, x2, y2, r, c)
	local gl = self.gl
	colour(gl, c)
	if r <= 0 then
		gl.Rect(x1, y1, x2, y2)
	else
		gl.BeginEnd(self.GL.TRIANGLE_FAN, path, gl.Vertex, x1, y1, x2, y2, r)
	end
end

local function outline(self, x1, y1, x2, y2, r, c)
	local gl = self.gl
	colour(gl, c)
	gl.BeginEnd(self.GL.LINE_LOOP, path, gl.Vertex, x1 + 0.5, y1 + 0.5, x2 - 0.5, y2 - 0.5, r)
end

local function panel(self, rect)
	fill(self, rect.x1, rect.y1, rect.x2, rect.y2, self.radius, LOOK.panel)
	outline(self, rect.x1, rect.y1, rect.x2, rect.y2, self.radius, LOOK.border)
end

--- A button's body: lit when it is `active`, and a little when the pointer is
-- over it.
local function button(self, rect, mx, my, active)
	local wash = active and LOOK.buttonActive or (inside(rect, mx, my) and LOOK.buttonHover or LOOK.button)
	fill(self, rect.x1, rect.y1, rect.x2, rect.y2, self.buttonRadius, wash)
	outline(self, rect.x1, rect.y1, rect.x2, rect.y2, self.buttonRadius, LOOK.buttonBorder)
end

--- A line of text with its middle at `y`. It is put on the baseline that
-- centres a capital there, and not centred on its own letters, so that a comma
-- sits low and a row of labels sits level whatever letters each has.
local function text(self, value, x, y, size, c, options)
	colour(self.gl, c)
	self.gl.Text(value, x, y - self.capHalf * size, size, options)
end

local function drawBar(self)
	local gl, bar = self.gl, self.rects.bar
	local mid = floor((bar.y1 + bar.y2) / 2)
	local half = self.trackHalf
	local knob = floor(self:knobX() + 0.5)
	fill(self, bar.x1, mid - half, bar.x2, mid + half, half, LOOK.track)
	if knob > bar.x1 then
		fill(self, bar.x1, mid - half, knob, mid + half, min(half, (knob - bar.x1) / 2), LOOK.accent)
	end
	colour(gl, LOOK.warn)
	local span = self.last - self.first
	local tick = max(1, floor(self.column / 4))
	for i = 1, span > 0 and self.groupCount or 0 do
		local x = floor(bar.x1 + (self.groups[i] - self.first) / span * (bar.x2 - bar.x1))
		gl.Rect(x, mid + half + tick, x + 2 * tick, bar.y2)
	end
	local k = self.knobHalf
	fill(self, knob - k, mid - k, knob + k, mid + k, k, LOOK.text)
end

local function drawButtons(self, mx, my)
	local gl, GL, rects, u = self.gl, self.GL, self.rects, self.unit
	local backward = self.direction == -1

	-- Reverse: a triangle pointing back.
	local r = rects.reverse
	button(self, r, mx, my, backward)
	local cx, cy = (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2
	colour(gl, backward and LOOK.accent or LOOK.text)
	gl.BeginEnd(GL.TRIANGLES, triangle, gl.Vertex, cx + 5 * u, cy - 7 * u, cx + 5 * u, cy + 7 * u, cx - 6 * u, cy)

	-- Play, or two bars while it plays.
	r = rects.toggle
	button(self, r, mx, my, false)
	cx, cy = (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2
	colour(gl, LOOK.text)
	if self.playing then
		gl.Rect(cx - 5 * u, cy - 7 * u, cx - 1.5 * u, cy + 7 * u)
		gl.Rect(cx + 1.5 * u, cy - 7 * u, cx + 5 * u, cy + 7 * u)
	else
		gl.BeginEnd(GL.TRIANGLES, triangle, gl.Vertex, cx - 5 * u, cy - 7 * u, cx + 6 * u, cy, cx - 5 * u, cy + 7 * u)
	end

	-- Slower and faster: a minus and a plus, with the speed between them.
	r = rects.slower
	button(self, r, mx, my, false)
	cx, cy = (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2
	colour(gl, LOOK.text)
	gl.Rect(cx - 6 * u, cy - u, cx + 6 * u, cy + u)

	r = rects.faster
	button(self, r, mx, my, false)
	cx, cy = (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2
	colour(gl, LOOK.text)
	gl.Rect(cx - 6 * u, cy - u, cx + 6 * u, cy + u)
	gl.Rect(cx - u, cy - 6 * u, cx + u, cy + 6 * u)

	local speed = self.speedTexts[self.speed]
	if not speed then
		speed = tostring(self.speed) .. "x"
		self.speedTexts[self.speed] = speed
	end
	r = rects.speed
	text(self, speed, (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, self.textSize, LOOK.text, "cx")

	r = rects.time
	text(self, self.timeText, r.x1, (r.y1 + r.y2) / 2, self.textSize, LOOK.textDim, "x")

	r = rects.help
	button(self, r, mx, my, self.helpOpen)
	text(self, "?", (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, self.textSize, LOOK.text, "cx")
end

local function drawHelp(self, mx, my)
	local rects = self.rects
	local help = rects.helpPanel
	panel(self, help)
	local first = rects["row:" .. M.ACTIONS[1].id]
	local inset = self.buttonRadius + 1
	text(self, "Keys", first.x1 + inset, self.helpTitleY, self.textSize, LOOK.accent, "x")
	text(self, "Click a key to change it", first.x2 - inset, self.helpTitleY, self.smallSize, LOOK.textDim, "rx")
	for i = 1, #M.ACTIONS do
		local action = M.ACTIONS[i]
		local row = rects["row:" .. action.id]
		local y = (row.y1 + row.y2) / 2
		local waiting = self.listening == action.id
		if waiting or insideRow(row, mx, my) then
			fill(self, row.x1, row.y1, row.x2, row.y2, self.buttonRadius, waiting and LOOK.buttonActive or LOOK.buttonHover)
		end
		text(self, action.does, row.x1 + inset, y, self.smallSize, LOOK.text, "x")
		if waiting then
			text(self, "Press a key", row.x2 - inset, y, self.smallSize, LOOK.warn, "rx")
		else
			text(self, self.labels[action.id], row.x2 - inset, y, self.smallSize, LOOK.accent, "rx")
		end
	end
	local reset = rects.reset
	button(self, reset, mx, my, false)
	text(self, "Reset keys", (reset.x1 + reset.x2) / 2, (reset.y1 + reset.y2) / 2, self.smallSize, LOOK.text, "cx")
end

--- Draws the timeline, from `widget:DrawScreen`. In a game with no player only
-- the note is drawn, when there is one.
function Timeline:draw()
	if not self.scale then
		return
	end
	local present = self:read()
	if not present and not self.note then
		return
	end
	local gl, rects = self.gl, self.rects
	local mx, my = self.Spring.GetMouseState()
	-- Whatever drew before may have left a texture bound.
	gl.Texture(false)

	if self.note then
		local note = rects.note
		panel(self, note)
		text(self, self.note, (note.x1 + note.x2) / 2, (note.y1 + note.y2) / 2, self.smallSize, LOOK.warn, "cx")
	end
	if not present then
		gl.Color(1, 1, 1, 1)
		return
	end
	panel(self, rects.panel)
	drawBar(self)
	drawButtons(self, mx, my)
	if self.helpOpen then
		drawHelp(self, mx, my)
	end
	gl.Color(1, 1, 1, 1)
end

return M
