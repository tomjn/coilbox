-- Coilbox blueprints: place a base layout from your library, or save one.
--
-- Installed into the content root by coilbox when the player asks. Change it
-- in the coilbox repository under lua/blueprint-widget/ and install again, or
-- the next update will overwrite the edit.
--
-- The panel lists the blueprints coilbox holds for this game, plus whatever
-- BAR's own blueprints.json has. Pick one and it follows the cursor as ghosts,
-- turned with [ and ], placed with a click as build orders to the selected
-- builders. Save selection writes the selected buildings to a spool file that
-- coilbox collects into the library.
--
-- Everything that can be decided without the engine lives under
-- LuaUI/coilbox_blueprints/ and is tested there. This file reads the engine,
-- uploads geometry and draws. No immediate mode: the panel is one vertex
-- buffer drawn with one call, re-uploaded only when the layout changes. Text
-- and build pictures go through the engine's own batched paths.
--
-- No network. The widget reads and writes local files and coilbox does the
-- rest.

local WIDGET_NAME = "Coilbox blueprints"
local LOG_SECTION = "coilbox-blueprints"
local MODULE_DIR = "LuaUI/coilbox_blueprints/"

local ACTION_TOGGLE = "coilbox_blueprints"
local ACTION_SAVE = "coilbox_blueprints_save"
local ACTION_LEFT = "coilbox_blueprints_rotate_left"
local ACTION_RIGHT = "coilbox_blueprints_rotate_right"

function widget:GetInfo()
	return {
		name = WIDGET_NAME,
		desc = "Place a base blueprint from your coilbox library, or save one",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		layer = 0,
		enabled = true,
	}
end

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

--------------------------------------------------------------------------------
-- Modules
--------------------------------------------------------------------------------

local JSON, STORE, MODEL, PLACE, RECORD

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

--------------------------------------------------------------------------------
-- State
--------------------------------------------------------------------------------

local store
local panel
local can
local clock = 0
local sinceSelection = 0
local selectionKey = ""
local vsx, vsy = 0, 0
local layout = nil
local layoutVersion = -1
local layoutW, layoutH = 0, 0

-- What is being placed: the item, the rotation, and where it would land now.
local placing = nil
-- Ghosts left after a partial placement, already in world space.
local remainder = nil
local messageUntil = 0
-- What the widget handler stored for us last time. The handler hands it over
-- when the widget loads, before Initialize runs.
local saved = nil

--------------------------------------------------------------------------------
-- GL objects
--------------------------------------------------------------------------------

local shader
local locProj, locView, locRect, locUseTex
local quadVAO, quadVBO, quadIBO
-- The panel's and the ground marks' buffers, grown as needed by upload().
local panelSet = { capacity = 0 }
local groundSet = { capacity = 0 }
local panelIndices, groundIndices = 0, 0
local groundKey = nil

local IDENTITY = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }
local UNIT_RECT = { 0, 0, 1, 1 }

local VERTEX_LAYOUT = {
	{ id = 0, name = "pos", size = 3 },
	{ id = 1, name = "uv", size = 2 },
	{ id = 2, name = "color", size = 4 },
}

local VERTEX_SHADER = [[
#version 130
#extension GL_ARB_explicit_attrib_location : require
layout(location = 0) in vec3 pos;
layout(location = 1) in vec2 uv;
layout(location = 2) in vec4 color;
uniform mat4 proj;
uniform mat4 view;
uniform vec4 rect;
out vec2 vUv;
out vec4 vColor;
void main() {
	vec3 p = vec3(pos.xy * rect.zw + rect.xy, pos.z);
	gl_Position = proj * view * vec4(p, 1.0);
	vUv = uv;
	vColor = color;
}
]]

local FRAGMENT_SHADER = [[
#version 130
uniform sampler2D tex;
uniform int useTex;
in vec2 vUv;
in vec4 vColor;
out vec4 fragColor;
void main() {
	vec4 c = vColor;
	if (useTex == 1) {
		c *= texture(tex, vUv);
	}
	fragColor = c;
}
]]

--- A vertex buffer, index buffer and array able to hold `rects` quads.
local function makeBuffers(rects)
	local vbo = gl.GetVBO(GL.ARRAY_BUFFER, true)
	local ibo = gl.GetVBO(GL.ELEMENT_ARRAY_BUFFER, true)
	if not vbo or not ibo then
		return nil
	end
	vbo:Define(rects * 4, VERTEX_LAYOUT)
	ibo:Define(rects * 6, GL.UNSIGNED_INT)
	local vao = gl.GetVAO()
	if not vao then
		vbo:Delete()
		ibo:Delete()
		return nil
	end
	vao:AttachVertexBuffer(vbo)
	vao:AttachIndexBuffer(ibo)
	return vbo, ibo, vao
end

local function dropBuffers(vbo, ibo, vao)
	if vao then
		vao:Delete()
	end
	if ibo then
		ibo:Delete()
	end
	if vbo then
		vbo:Delete()
	end
end

local function makeGL()
	shader = gl.CreateShader({
		vertex = VERTEX_SHADER,
		fragment = FRAGMENT_SHADER,
		uniformInt = { tex = 0, useTex = 0 },
	})
	if not shader then
		log(LOG.ERROR, "shader failed: " .. tostring(gl.GetShaderLog()))
		return false
	end
	locProj = gl.GetUniformLocation(shader, "proj")
	locView = gl.GetUniformLocation(shader, "view")
	locRect = gl.GetUniformLocation(shader, "rect")
	locUseTex = gl.GetUniformLocation(shader, "useTex")

	quadVBO, quadIBO, quadVAO = makeBuffers(1)
	if not quadVAO then
		log(LOG.ERROR, "vertex buffers are not available")
		return false
	end
	local verts, idx = MODEL.pack({ { x = 0, y = 0, w = 1, h = 1, color = { 1, 1, 1, 1 } } })
	quadVBO:Upload(verts)
	quadIBO:Upload(idx)
	return true
end

local function dropSet(set)
	dropBuffers(set.vbo, set.ibo, set.vao)
	set.vbo, set.ibo, set.vao, set.capacity = nil, nil, nil, 0
end

local function dropGL()
	dropSet(panelSet)
	dropSet(groundSet)
	dropBuffers(quadVBO, quadIBO, quadVAO)
	quadVBO, quadIBO, quadVAO = nil, nil, nil
	if shader then
		gl.DeleteShader(shader)
		shader = nil
	end
end

--- Upload quads into a buffer set, growing it when it is too small.
local function upload(set, verts, idx)
	local quads = #idx / 6
	if quads == 0 then
		return 0
	end
	if set.capacity < quads then
		dropBuffers(set.vbo, set.ibo, set.vao)
		local capacity = math.max(quads, set.capacity * 2, 64)
		set.vbo, set.ibo, set.vao = makeBuffers(capacity)
		set.capacity = set.vao and capacity or 0
		if not set.vao then
			return 0
		end
	end
	set.vbo:Upload(verts)
	set.ibo:Upload(idx)
	return #idx
end

--------------------------------------------------------------------------------
-- The panel's inputs
--------------------------------------------------------------------------------

local function say(message, seconds)
	panel.message = message
	messageUntil = clock + (seconds or 4)
	MODEL.touch(panel)
end

local function measure(text, size)
	return gl.GetTextWidth(text) * size
end

local function readSelection()
	local selected = Spring.GetSelectedUnits()
	local key = #selected .. ":" .. table.concat(selected, ",")
	if key == selectionKey then
		return false
	end
	selectionKey = key
	can = PLACE.capabilities(selected)
	return true
end

local function refreshPanel()
	MODEL.refresh(panel, store:entries(), PLACE, Game, can)
	panel.remainder = remainder and { count = #remainder } or nil
	MODEL.touch(panel)
end

local function spoolCount()
	local n = 0
	for _, entry in ipairs(store:entries()) do
		if entry.source == "spool" then
			n = n + 1
		end
	end
	return n
end

--------------------------------------------------------------------------------
-- Placing
--------------------------------------------------------------------------------

local function stopPlacing()
	if placing then
		placing = nil
		panel.placing = nil
		MODEL.touch(panel)
	end
end

local function startPlacing(key)
	local item
	for _, candidate in ipairs(panel.items) do
		if candidate.entry.key == key then
			item = candidate
			break
		end
	end
	if not item then
		return
	end
	if #item.resolved.buildings == 0 then
		say("Nothing in " .. item.entry.name .. " exists in this game")
		return
	end
	placing = { item = item, rotation = 0, foot = nil }
	panel.placing = { key = key, name = item.entry.name, rotation = 0 }
	MODEL.touch(panel)
end

local function rotate(turns)
	if not placing then
		return
	end
	placing.rotation = (placing.rotation + turns) % 4
	placing.foot = nil
	panel.placing.rotation = placing.rotation
	MODEL.touch(panel)
end

--- Where the layout would land under the cursor now, or nil off the map.
local function trackCursor()
	local mx, my = Spring.GetMouseState()
	local kind, pos = Spring.TraceScreenRay(mx, my, true)
	if kind ~= "ground" or not pos then
		placing.foot = nil
		return
	end
	local ax, az = PLACE.snapAnchor(pos[1], pos[3])
	if placing.foot and placing.ax == ax and placing.az == az then
		return
	end
	placing.ax, placing.az = ax, az
	placing.foot = PLACE.footprint(placing.item.resolved, placing.rotation, ax, az)
end

local function setRemainder(positions)
	remainder = (#positions > 0) and positions or nil
	panel.remainder = remainder and { count = #remainder } or nil
	MODEL.touch(panel)
end

local function describe(plan, sent)
	local parts = {}
	if sent > 0 then
		parts[#parts + 1] = "ordered to " .. sent .. (sent == 1 and " builder" or " builders")
	end
	if plan.blocked > 0 then
		parts[#parts + 1] = plan.blocked .. " blocked"
	end
	if #plan.remainder > 0 then
		parts[#parts + 1] = #plan.remainder .. " left for another builder"
	end
	if #parts == 0 then
		return "nothing could be placed"
	end
	return table.concat(parts, ", ")
end

local function shiftHeld()
	local _, _, _, shift = Spring.GetModKeyState()
	return shift == true
end

local function placeNow()
	if not placing or not placing.foot then
		return
	end
	readSelection()
	local plan = PLACE.plan(placing.foot, can, shiftHeld())
	local sent = PLACE.issue(plan)
	say(placing.item.entry.name .. ": " .. describe(plan, sent))
	setRemainder(plan.remainder)
	-- Holding shift keeps the blueprint on the cursor for another copy.
	if not shiftHeld() then
		stopPlacing()
	else
		placing.foot = nil
	end
end

local function placeRemainder()
	if not remainder then
		return
	end
	readSelection()
	-- Re-test the ground, since things have been built since.
	local foot = {}
	for i, p in ipairs(remainder) do
		local status = Spring.TestBuildOrder(p.defID, p.x, p.y, p.z, p.facing)
		foot[i] = { defID = p.defID, def = p.def, x = p.x, y = p.y, z = p.z, facing = p.facing, blocked = status == 0 }
	end
	local plan = PLACE.plan(foot, can, shiftHeld())
	local sent = PLACE.issue(plan)
	say("Remainder: " .. describe(plan, sent))
	setRemainder(plan.remainder)
end

--------------------------------------------------------------------------------
-- Saving
--------------------------------------------------------------------------------

local function saveSelection()
	local entry, err = RECORD.selection({ spoolCount = spoolCount(), now = os.time() })
	if not entry then
		say(err)
		return false
	end
	local ok, werr = store:append(entry)
	if not ok then
		say(werr)
		log(LOG.WARNING, werr)
		return false
	end
	say("Saved " .. entry.name .. ". Coilbox picks it up next time it runs.")
	refreshPanel()
	return true
end

--------------------------------------------------------------------------------
-- Opening and closing
--------------------------------------------------------------------------------

local function open()
	if panel.open then
		return
	end
	panel.open = true
	store:refresh(clock, true)
	readSelection()
	refreshPanel()
end

local function close()
	panel.open = false
	MODEL.touch(panel)
end

local function toggle()
	if panel.open then
		close()
	else
		open()
	end
end

--------------------------------------------------------------------------------
-- Actions the panel's buttons and rows raise
--------------------------------------------------------------------------------

local function act(action)
	local kind = action.kind
	if kind == "toggle" then
		toggle()
	elseif kind == "close" then
		close()
	elseif kind == "tab" then
		MODEL.setTab(panel, action.tab)
	elseif kind == "place" then
		if placing and placing.item.entry.key == action.key then
			stopPlacing()
		else
			startPlacing(action.key)
		end
	elseif kind == "cancel" then
		stopPlacing()
	elseif kind == "remainder" then
		placeRemainder()
	elseif kind == "dismiss" then
		setRemainder({})
	elseif kind == "save" then
		saveSelection()
	end
end

--------------------------------------------------------------------------------
-- Callins
--------------------------------------------------------------------------------

function widget:SetConfigData(data)
	saved = data
end

function widget:GetConfigData()
	return { seen = true }
end

function widget:Initialize()
	local err
	JSON, err = include("json.lua")
	if JSON then
		STORE, err = include("store.lua")
	end
	if STORE then
		MODEL, err = include("model.lua")
	end
	if MODEL then
		PLACE, err = include("place.lua")
	end
	if PLACE then
		RECORD, err = include("record.lua")
	end
	if not RECORD then
		log(LOG.ERROR, err)
		widgetHandler:RemoveWidget(self)
		return
	end

	STORE.use(JSON)
	PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames })
	RECORD.use({ Spring = Spring, UnitDefs = UnitDefs, Game = Game })

	store = STORE.new({
		vfs = VFS,
		io = io,
		log = function(message)
			log(LOG.WARNING, message)
		end,
	})
	panel = MODEL.new()
	can = PLACE.capabilities({})

	if not makeGL() then
		widgetHandler:RemoveWidget(self)
		return
	end

	vsx, vsy = Spring.GetViewGeometry()

	-- "t" reaches the console and "p" a key bound in uikeys.txt. Without the
	-- second, bind x coilbox_blueprints would do nothing.
	widgetHandler:AddAction(ACTION_TOGGLE, toggle, nil, "tp")
	widgetHandler:AddAction(ACTION_SAVE, saveSelection, nil, "tp")
	widgetHandler:AddAction(ACTION_LEFT, function()
		rotate(-1)
	end, nil, "tp")
	widgetHandler:AddAction(ACTION_RIGHT, function()
		rotate(1)
	end, nil, "tp")

	WG.CoilboxBlueprints = {
		open = open,
		close = close,
		toggle = toggle,
		list = function()
			store:refresh(clock)
			return store:entries()
		end,
		place = function(key)
			open()
			startPlacing(key)
		end,
		save = saveSelection,
		rotate = rotate,
	}

	-- A widget that loads and then draws nothing looks like one that did not
	-- load. Say how to reach it, and the very first time it ever runs, open
	-- the panel so there is something to see.
	Spring.Echo("Coilbox blueprints: /coilbox_blueprints toggles the panel, [ and ] turn a layout while placing.")
	if not (saved and saved.seen) then
		open()
	end
end

function widget:Shutdown()
	widgetHandler:RemoveAction(ACTION_TOGGLE)
	widgetHandler:RemoveAction(ACTION_SAVE)
	widgetHandler:RemoveAction(ACTION_LEFT)
	widgetHandler:RemoveAction(ACTION_RIGHT)
	WG.CoilboxBlueprints = nil
	dropGL()
end

function widget:ViewResize(x, y)
	vsx, vsy = x, y
	layoutVersion = -1
end

function widget:Update(dt)
	clock = clock + dt
	if panel.message and clock > messageUntil then
		panel.message = nil
		MODEL.touch(panel)
	end
	-- Hover follows the cursor over anything clickable, the opener included.
	if layout then
		local mx, my = Spring.GetMouseState()
		local action = MODEL.hit(layout, mx, my)
		local id = action and action.kind ~= "panel" and MODEL.actionId(action) or nil
		if id ~= panel.hover then
			panel.hover = id
			MODEL.touch(panel)
		end
	end
	if not panel.open and not placing then
		return
	end
	sinceSelection = sinceSelection + dt
	if sinceSelection > 0.25 then
		sinceSelection = 0
		if readSelection() then
			refreshPanel()
		end
	end
	if panel.open and store:refresh(clock) then
		refreshPanel()
	end
	if placing then
		trackCursor()
	end
end

function widget:IsAbove(x, y)
	return layout ~= nil and MODEL.hit(layout, x, y) ~= nil
end

function widget:MousePress(x, y, button)
	if layout then
		local action = MODEL.hit(layout, x, y)
		if action then
			if button == 1 then
				act(action)
			end
			return true
		end
	end
	if placing then
		if button == 1 then
			placeNow()
			return true
		elseif button == 3 then
			stopPlacing()
			return true
		end
	end
	return false
end

function widget:MouseWheel(up, value)
	if not (layout and panel.open) then
		return false
	end
	local mx, my = Spring.GetMouseState()
	if not MODEL.hit(layout, mx, my) then
		return false
	end
	MODEL.scroll(panel, up and -1 or 1)
	return true
end

local KEY_ESCAPE = 27
local KEY_LEFT_BRACKET = 91
local KEY_RIGHT_BRACKET = 93

function widget:KeyPress(key)
	if not placing then
		return false
	end
	if key == KEY_ESCAPE then
		stopPlacing()
		return true
	elseif key == KEY_LEFT_BRACKET then
		rotate(-1)
		return true
	elseif key == KEY_RIGHT_BRACKET then
		rotate(1)
		return true
	end
	return false
end

--------------------------------------------------------------------------------
-- Drawing
--------------------------------------------------------------------------------

local function colourCode(c)
	return string.char(255, math.floor(c[1] * 254) + 1, math.floor(c[2] * 254) + 1, math.floor(c[3] * 254) + 1)
end

local function relayout()
	if layoutVersion == panel.version and layoutW == vsx and layoutH == vsy then
		return
	end
	layout = MODEL.layout(panel, measure, { w = vsx, h = vsy })
	layoutVersion, layoutW, layoutH = panel.version, vsx, vsy
	local verts, idx = MODEL.pack(layout.rects)
	panelIndices = upload(panelSet, verts, idx)
end

function widget:DrawScreen()
	relayout()
	if not layout or #layout.rects == 0 then
		return
	end
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.UseShader(shader)
	gl.UniformMatrix(locProj, unpack(MODEL.ortho(vsx, vsy)))
	gl.UniformMatrix(locView, unpack(IDENTITY))
	gl.Uniform(locRect, unpack(UNIT_RECT))
	gl.UniformInt(locUseTex, 0)
	if panelIndices > 0 and panelSet.vao then
		panelSet.vao:DrawElements(GL.TRIANGLES, panelIndices, 0)
	end
	if #layout.pics > 0 then
		gl.UniformInt(locUseTex, 1)
		for _, pic in ipairs(layout.pics) do
			gl.Texture(0, "#" .. pic.defID)
			gl.Uniform(locRect, pic.x, pic.y, pic.w, pic.h)
			quadVAO:DrawElements(GL.TRIANGLES, 6, 0)
		end
		gl.Texture(0, false)
		gl.UniformInt(locUseTex, 0)
	end
	gl.UseShader(0)
	for _, t in ipairs(layout.texts) do
		if t.rotate then
			gl.PushMatrix()
			gl.Translate(t.x, t.y, 0)
			gl.Rotate(t.rotate, 0, 0, 1)
			gl.Text(colourCode(t.color) .. t.text, 0, 0, t.size, "")
			gl.PopMatrix()
		else
			gl.Text(colourCode(t.color) .. t.text, t.x, t.y, t.size, "")
		end
	end
end

local BLOCKED = { 0.9, 0.2, 0.15, 0.45 }
local OPEN = { 0.3, 0.9, 0.4, 0.3 }
local LEFT = { 0.95, 0.7, 0.2, 0.3 }

--- One translucent model. It comes out in the team's colour whatever gl.Color
-- says, because the model shader takes its tint from the team handler, so the
-- square on the ground under it is what says blocked, open or left over.
local function ghost(p, teamID)
	gl.PushMatrix()
	-- The stack holds the camera here, and UnitShape wants a pure model
	-- matrix, so without this the ghost lands nowhere visible.
	gl.LoadIdentity()
	gl.Translate(p.x, p.y, p.z)
	gl.Rotate(90 * p.facing, 0, 1, 0)
	gl.UnitShape(p.defID, teamID, false, false, false)
	gl.PopMatrix()
end

--- Refill the ground buffer when the marked positions change.
local function groundMarks(foot, key, blocked, open)
	if groundKey ~= key then
		groundKey = key
		local verts, idx = MODEL.packGround(foot, blocked, open)
		groundIndices = upload(groundSet, verts, idx)
	end
end

function widget:DrawWorld()
	local foot = placing and placing.foot
	if not foot and not remainder then
		return
	end
	local teamID = Spring.GetMyTeamID()
	gl.DepthTest(true)
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)

	local marks, key, blockedColor, openColor
	if foot then
		marks = foot
		key = "cursor:" .. placing.ax .. ":" .. placing.az .. ":" .. placing.rotation .. ":" .. placing.item.entry.key
		blockedColor, openColor = BLOCKED, OPEN
	else
		marks = remainder
		key = "remainder:" .. #remainder
		blockedColor, openColor = LEFT, LEFT
	end
	groundMarks(marks, key, blockedColor, openColor)
	if groundIndices > 0 and groundSet.vao then
		gl.UseShader(shader)
		gl.UniformMatrix(locProj, "projection")
		gl.UniformMatrix(locView, "view")
		gl.Uniform(locRect, unpack(UNIT_RECT))
		gl.UniformInt(locUseTex, 0)
		groundSet.vao:DrawElements(GL.TRIANGLES, groundIndices, 0)
		gl.UseShader(0)
	end

	if foot then
		for _, p in ipairs(foot) do
			ghost(p, teamID)
		end
	end
	if remainder then
		for _, p in ipairs(remainder) do
			ghost(p, teamID)
		end
	end
	gl.DepthTest(false)
end
