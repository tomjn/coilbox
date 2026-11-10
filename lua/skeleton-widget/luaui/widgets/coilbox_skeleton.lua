-- Coilbox skeleton: see the bones of the selected units (issue #5179).
--
-- Installed into the content root by coilbox when the player asks. Change it
-- in the coilbox repository under lua/skeleton-widget/ and install again, or
-- the next update will overwrite the edit.
--
-- For every selected unit it draws, through the model, a dot at each piece's
-- origin, a dim line from it to its parent's origin and a bright bone to the
-- far end of the piece's geometry. Everything comes from the engine: the
-- piece tree, each piece's box and its live matrix. Nothing is set up in
-- coilbox.
--
-- When coilbox has written a body plan for the unit (issue #5181), in
-- LuaUI/Config/coilbox_skeletons/<Game.gameShortName>.json, the pieces in the
-- plan are drawn in full with their role label beside them, and the others
-- dimmed, or hidden with the Others button. A plan read off a model rather
-- than made by coilbox is drawn dashed. A game with no such file, or a unit
-- with no entry in it, gets the engine's skeleton alone, and nothing is logged.
--
-- LuaUI/coilbox_skeleton/skeleton.lua holds the rules and is tested there,
-- as is plan.lua, which reads the file. This file reads the engine, uploads
-- and draws.
--
-- No immediate mode: one vertex buffer, refilled each frame, drawn as lines
-- and as dots through one shader. Text is gl.Text, which the engine batches.

local WIDGET_NAME = "Coilbox skeleton"
local LOG_SECTION = "coilbox-skeleton"
local MODULE_DIR = "LuaUI/coilbox_skeleton/"

local ACTION_TOGGLE = "coilbox_skeleton"
local ACTION_NAMES = "coilbox_skeleton_names"
local ACTION_OTHERS = "coilbox_skeleton_others"

local keyActions = {}
local me = nil

-- As the blueprint widget does: go through the handler's actionHandler when
-- there is one, and through the stand-in otherwise.
local function addAction(action, run)
	if widgetHandler.actionHandler then
		widgetHandler.actionHandler:AddAction(me, action, run, nil, "tp")
	else
		widgetHandler:AddAction(action, run, nil, "tp")
	end
end

local function removeAction(action)
	if widgetHandler.actionHandler then
		widgetHandler.actionHandler:RemoveAction(me, action)
	else
		widgetHandler:RemoveAction(action)
	end
end

function widget:GetInfo()
	return {
		name = WIDGET_NAME,
		desc = "Draw the bones of the selected units from the engine's piece data",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
		handler = true,
	}
end

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

local function include(name)
	local path = MODULE_DIR .. name
	if not VFS.FileExists(path, VFS.RAW_FIRST) then
		return nil, path .. " is missing"
	end
	local ok, value = pcall(VFS.Include, path, nil, VFS.RAW_FIRST)
	if not ok then
		return nil, path .. " failed to load: " .. tostring(value)
	end
	if type(value) ~= "table" then
		return nil, path .. " did not return a table"
	end
	return value
end

local SKELETON, PLAN, JSON, I18N, STRINGS
local TEXT = nil

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

-- Whether the skeleton is shown, whether every piece is named, and whether the
-- pieces outside a unit's plan are drawn. Kept in the widget's config.
local showing = false
local naming = false
local others = true
local saved = nil

-- Each unit's bones from coilbox's file, by lowercase unit definition name
local plans = {}

local tracker
-- The poses drawn last, in the world, for the names DrawScreen writes.
local drawn = {}
-- Each unit def's piece tree, read from the first unit of it selected.
local skeletons = {}

local vsx, vsy = 0, 0
local capHeight = 1
-- The buttons as last laid out: { x, y, w, h, label, run, on }
local buttons = {}

--------------------------------------------------------------------------------
-- GL objects
--------------------------------------------------------------------------------

local VERTEX_LAYOUT = {
	{ id = 0, name = "pos", size = 3 },
	{ id = 1, name = "color", size = 4 },
	{ id = 2, name = "corner", size = 2 },
	{ id = 3, name = "other", size = 4 },
	{ id = 4, name = "dash", size = 1 },
}

local VERTEX_SHADER = [[
#version 130
#extension GL_ARB_explicit_attrib_location : require
layout(location = 0) in vec3 pos;
layout(location = 1) in vec4 color;
layout(location = 2) in vec2 corner;
layout(location = 3) in vec4 other;
layout(location = 4) in float dash;
uniform mat4 proj;
uniform mat4 view;
uniform vec2 viewport;
uniform float dotRadius;
uniform float pxScale;
out vec4 vColor;
out vec2 vCorner;
out float vLine;
out float vDash;
// how far along a line the vertex is, in pixels, on screen
noperspective out float vAlong;
void main() {
	vec4 p = proj * view * vec4(pos, 1.0);
	vLine = other.w > 0.0 ? 1.0 : 0.0;
	vDash = dash;
	vAlong = 0.0;
	if (other.w > 0.0) {
		// a line: moved across itself on screen, by its half width in pixels
		vec4 q = proj * view * vec4(other.xyz, 1.0);
		vec2 d = (q.xy / q.w - p.xy / p.w) * viewport;
		float len = length(d);
		vec2 across = len > 0.0 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
		// at the far end the other end is behind, so the direction turns round
		if (corner.y > 0.5) {
			across = -across;
		}
		p.xy += across * corner.x * other.w * pxScale * 2.0 / viewport * p.w;
		// d spans the view's width as 2, so half of it is in pixels
		vAlong = corner.y * len * 0.5;
	} else {
		// a dot's corner moves it a fixed number of pixels, however far away
		p.xy += corner * dotRadius * 2.0 / viewport * p.w;
	}
	gl_Position = p;
	vColor = color;
	vCorner = corner;
}
]]

local FRAGMENT_SHADER = [[
#version 130
in vec4 vColor;
in vec2 vCorner;
in float vLine;
in float vDash;
noperspective in float vAlong;
uniform float pxScale;
out vec4 fragColor;
void main() {
	// a line's x runs from side to side, a dot's corner from its middle
	float d = vLine > 0.5 ? abs(vCorner.x) : length(vCorner);
	if (d > 1.0) {
		discard;
	}
	if (vDash > 0.5) {
		// a dashed line is drawn for the first half of each period
		float period = 16.0 * pxScale;
		if (mod(vAlong, period) > period * 0.5) {
			discard;
		}
	}
	vec4 c = vColor;
	if (vLine > 0.5) {
		// a line fades out over its outer edges rather than stopping hard
		c.a *= 1.0 - smoothstep(0.5, 1.0, d);
	} else if (d > 0.7) {
		// a dot gets a darker rim, so it reads against the lines
		c.rgb *= 0.45;
	}
	fragColor = c;
}
]]

local shader, locProj, locView, locViewport, locDotRadius, locPxScale
local set = { capacity = 0 }
local glReady = false

local function dropSet()
	if set.vao then
		set.vao:Delete()
	end
	if set.vbo then
		set.vbo:Delete()
	end
	set.vao, set.vbo, set.capacity = nil, nil, 0
end

--- Grow the buffer to hold `count` vertices. False when the engine gives
-- no buffer, as spring-headless does.
local function reserve(count)
	if set.capacity >= count then
		return true
	end
	dropSet()
	local capacity = math.max(count, 256)
	local vbo = gl.GetVBO(GL.ARRAY_BUFFER, true)
	if not vbo then
		return false
	end
	vbo:Define(capacity, VERTEX_LAYOUT)
	local vao = gl.GetVAO()
	if not vao then
		vbo:Delete()
		return false
	end
	vao:AttachVertexBuffer(vbo)
	set.vbo, set.vao, set.capacity = vbo, vao, capacity
	return true
end

local function makeGL()
	if not (gl and gl.CreateShader and gl.GetVBO and gl.GetVAO) then
		return false
	end
	shader = gl.CreateShader({ vertex = VERTEX_SHADER, fragment = FRAGMENT_SHADER })
	if not shader then
		log(LOG.WARNING, "shader failed: " .. tostring(gl.GetShaderLog()))
		return false
	end
	locProj = gl.GetUniformLocation(shader, "proj")
	locView = gl.GetUniformLocation(shader, "view")
	locViewport = gl.GetUniformLocation(shader, "viewport")
	locDotRadius = gl.GetUniformLocation(shader, "dotRadius")
	locPxScale = gl.GetUniformLocation(shader, "pxScale")
	return reserve(256)
end

local function dropGL()
	dropSet()
	if shader then
		gl.DeleteShader(shader)
		shader = nil
	end
end

--------------------------------------------------------------------------------
-- Reading the engine
--------------------------------------------------------------------------------

local function pack16(...)
	if select("#", ...) < 16 then
		return nil
	end
	return { ... }
end

local function readSkeleton(unitID)
	local defID = Spring.GetUnitDefID(unitID)
	if not defID then
		return nil
	end
	if skeletons[defID] then
		return skeletons[defID]
	end
	local names = Spring.GetUnitPieceList(unitID)
	if type(names) ~= "table" or #names == 0 then
		return nil
	end
	local def = UnitDefs[defID]
	local pieces = SKELETON.build(names, function(i)
		return Spring.GetUnitPieceInfo(unitID, i)
	end, def and plans[def.name:lower()])
	skeletons[defID] = pieces
	return pieces
end

--------------------------------------------------------------------------------
-- Actions and buttons
--------------------------------------------------------------------------------

local function toggle()
	showing = not showing
	if not showing then
		tracker.update({}, -1)
		drawn = {}
	end
	return true
end

local function toggleNames()
	naming = not naming
	return true
end

local function toggleOthers()
	others = not others
	return true
end

-- Sizes for a view 1080 pixels tall, scaled with its height, as the
-- blueprint widget's panel is.
local BUTTON_H = 26
local BUTTON_PAD = 10
local BUTTON_GAP = 6
local BUTTON_FONT = 14
local NAME_FONT = 13
local DOT_RADIUS = 4
local MARGIN = 8

-- Off, and on in a darker shade of the skeleton's colour.
local BUTTON_OFF = { 0.16, 0.18, 0.22, 0.92 }
local BUTTON_ON = { 0.52, 0.27, 0.56, 0.96 }

local function scale()
	return vsy / 1080
end

--- The Bones button against the right edge of the view, a little above the
-- middle, and the Names and Others buttons to its left while the skeleton shows.
local function layoutButtons()
	local s = scale()
	local h = BUTTON_H * s
	local font = BUTTON_FONT * s
	local y = vsy * 0.68
	local x = vsx - MARGIN * s
	local list = {
		{ label = TEXT.bones, run = toggle, on = showing },
	}
	if showing then
		list[2] = { label = TEXT.names, run = toggleNames, on = naming }
		list[3] = { label = TEXT.others, run = toggleOthers, on = others }
	end
	buttons = {}
	for _, b in ipairs(list) do
		local w = gl.GetTextWidth(b.label) * font + 2 * BUTTON_PAD * s
		x = x - w
		b.x, b.y, b.w, b.h, b.font = x, y, w, h, font
		buttons[#buttons + 1] = b
		x = x - BUTTON_GAP * s
	end
end

local function buttonAt(x, y)
	for _, b in ipairs(buttons) do
		if x >= b.x and x <= b.x + b.w and y >= b.y and y <= b.y + b.h then
			return b
		end
	end
	return nil
end

--------------------------------------------------------------------------------
-- Callins
--------------------------------------------------------------------------------

function widget:SetConfigData(data)
	saved = data
end

function widget:GetConfigData()
	return { showing = showing, naming = naming, others = others }
end

function widget:Initialize()
	local err
	SKELETON, err = include("skeleton.lua")
	if SKELETON then
		PLAN, err = include("plan.lua")
	end
	if PLAN then
		JSON, err = include("json.lua")
	end
	if JSON then
		I18N, err = include("coilbox_i18n.lua")
	end
	if I18N then
		STRINGS, err = include("strings.lua")
	end
	if not STRINGS then
		log(LOG.ERROR, err)
		widgetHandler:RemoveWidget(self)
		return
	end
	TEXT = I18N.pick(STRINGS, Spring.GetModOptions(), I18N.config(Spring))

	if type(saved) == "table" then
		showing = saved.showing == true
		naming = saved.naming == true
		others = saved.others ~= false
	end

	-- A game coilbox has written nothing for has no file, which is not worth a
	-- line. One that is there and will not read is.
	local read, problem = PLAN.read({
		exists = function(path)
			return VFS.FileExists(path, VFS.RAW)
		end,
		load = function(path)
			return VFS.LoadFile(path, VFS.RAW)
		end,
	}, JSON.decode, Game.gameShortName)
	plans = read
	if problem then
		log(LOG.WARNING, problem)
	end

	tracker = SKELETON.tracker({
		skeleton = readSkeleton,
		matrix = function(unitID, i)
			return pack16(Spring.GetUnitPieceMatrix(unitID, i))
		end,
		unitMatrix = function(unitID)
			return pack16(Spring.GetUnitTransformMatrix(unitID))
		end,
	})

	-- spring-headless gives no buffers. The widget stays loaded and draws
	-- nothing, so a headless match runs it without an error.
	glReady = makeGL()
	if not glReady then
		dropGL()
		log(LOG.INFO, "no vertex buffers here, so nothing is drawn")
	end

	vsx, vsy = Spring.GetViewGeometry()
	if gl and gl.GetTextHeight then
		capHeight = gl.GetTextHeight("H")
	end

	keyActions = {
		[ACTION_TOGGLE] = toggle,
		[ACTION_NAMES] = toggleNames,
		[ACTION_OTHERS] = toggleOthers,
	}
	me = self
	for action, run in pairs(keyActions) do
		addAction(action, run)
	end

	-- for a game's own interface, and for a test match to drive
	WG.CoilboxSkeleton = {
		toggle = toggle,
		toggleNames = toggleNames,
		toggleOthers = toggleOthers,
		showing = function()
			return showing
		end,
		others = function()
			return others
		end,
	}

	Spring.Echo(string.format(TEXT.help, ACTION_TOGGLE, ACTION_NAMES))
end

function widget:Shutdown()
	for action in pairs(keyActions) do
		removeAction(action)
	end
	WG.CoilboxSkeleton = nil
	dropGL()
end

function widget:ViewResize(x, y)
	vsx, vsy = x, y
end

function widget:IsAbove(x, y)
	return glReady and buttonAt(x, y) ~= nil
end

function widget:MousePress(x, y, button)
	local b = glReady and buttonAt(x, y)
	if not b then
		return false
	end
	if button == 1 then
		b.run()
	end
	return true
end

-- Splinter Faction's handler never runs a widget action from a key, so a key
-- bound to one is looked up here, as the blueprint widget does.
local function keySet(key, mods)
	local name = Spring.GetKeySymbol(key)
	if not name then
		return nil
	end
	local prefix = ""
	if mods then
		prefix = (mods.alt and "Alt+" or "") .. (mods.ctrl and "Ctrl+" or "") .. (mods.meta and "Meta+" or "") .. (mods.shift and "Shift+" or "")
	end
	return prefix .. name
end

function widget:KeyPress(key, mods, isRepeat)
	if isRepeat then
		return false
	end
	local name = keySet(key, mods)
	if not name then
		return false
	end
	for _, action in ipairs(Spring.GetKeyBindings(name) or {}) do
		local run = keyActions[action.command]
		if run then
			return run()
		end
	end
	return false
end

--------------------------------------------------------------------------------
-- Drawing
--------------------------------------------------------------------------------

local IDENTITY = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }

local function ortho(w, h)
	return { 2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, -1, 0, -1, -1, 0, 1 }
end

function widget:DrawWorld()
	if not (glReady and showing) then
		return
	end
	tracker.update(Spring.GetSelectedUnits(), Spring.GetGameFrame())
	drawn = tracker.world(Spring.GetFrameTimeOffset())
	local verts, lines, dots = SKELETON.pack(drawn, others)
	if lines + dots == 0 or not reserve(lines + dots) then
		return
	end
	set.vbo:Upload(verts)

	-- through the model: the bones are what is wanted, and they sit inside it
	gl.DepthTest(false)
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.UseShader(shader)
	gl.UniformMatrix(locProj, "projection")
	gl.UniformMatrix(locView, "view")
	gl.Uniform(locViewport, vsx, vsy)
	gl.Uniform(locDotRadius, DOT_RADIUS * scale())
	gl.Uniform(locPxScale, scale())
	set.vao:DrawArrays(GL.TRIANGLES, lines + dots, 0)
	gl.UseShader(0)
	gl.DepthTest(true)
end

local function colourCode(c)
	return string.char(255, math.floor(c[1] * 254) + 1, math.floor(c[2] * 254) + 1, math.floor(c[3] * 254) + 1)
end

--- The names to write: a planned piece's role label always, and the others'
-- names as SKELETON.names says.
local function names()
	local marks = {}
	for _, pose in ipairs(drawn) do
		for i, piece in ipairs(pose.pieces) do
			local o = pose.origins[i]
			if o then
				local sx, sy, sz = Spring.WorldToScreenCoords(o[1], o[2], o[3])
				if sx and sz and sz < 1 then
					marks[#marks + 1] = {
						x = sx,
						y = sy,
						text = piece.planned and piece.planned.label or piece.name,
						planned = piece.planned ~= nil,
						drawn = SKELETON.style(pose.pieces, i, others) ~= nil,
					}
				end
			end
		end
	end
	local mx, my = Spring.GetMouseState()
	return SKELETON.names(marks, naming, mx, my, 3 * DOT_RADIUS * scale())
end

local function quad(out, x, y, w, h, c)
	local corners = { { x, y }, { x + w, y }, { x + w, y + h }, { x, y }, { x + w, y + h }, { x, y + h } }
	for _, p in ipairs(corners) do
		local n = #out
		out[n + 1], out[n + 2], out[n + 3] = p[1], p[2], 0
		out[n + 4], out[n + 5], out[n + 6], out[n + 7] = c[1], c[2], c[3], c[4]
		out[n + 8], out[n + 9] = 0, 0
		out[n + 10], out[n + 11], out[n + 12], out[n + 13] = 0, 0, 0, 0
		out[n + 14] = 0
	end
end

function widget:DrawScreen()
	if not glReady then
		return
	end
	layoutButtons()
	local verts = {}
	for _, b in ipairs(buttons) do
		quad(verts, b.x, b.y, b.w, b.h, b.on and BUTTON_ON or BUTTON_OFF)
	end
	local count = #verts / SKELETON.STRIDE
	-- DrawWorld has drawn from the buffer already this frame, so it can be
	-- refilled with the buttons
	if count > 0 and reserve(count) then
		set.vbo:Upload(verts)
		gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
		gl.UseShader(shader)
		gl.UniformMatrix(locProj, unpack(ortho(vsx, vsy)))
		gl.UniformMatrix(locView, unpack(IDENTITY))
		gl.Uniform(locViewport, vsx, vsy)
		gl.Uniform(locDotRadius, 0)
		gl.Uniform(locPxScale, 0)
		set.vao:DrawArrays(GL.TRIANGLES, count, 0)
		gl.UseShader(0)
	end
	local white = colourCode({ 1, 1, 1 })
	for _, b in ipairs(buttons) do
		gl.Text(white .. b.label, b.x + b.w / 2, b.y + b.h / 2 - capHeight * b.font / 2, b.font, "cx")
	end
	if showing then
		local size = NAME_FONT * scale()
		local colour = colourCode(SKELETON.COLOR)
		for _, mark in ipairs(names()) do
			gl.Text(colour .. mark.text, mark.x + DOT_RADIUS * scale() * 2, mark.y, size, "o")
		end
	end
end
