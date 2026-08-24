-- Coilbox mission runtime: the mission's panels.
--
-- Vendored into a game by coilbox. Change it in the coilbox repository under
-- lua/mission-runtime/ and install again, or the next runtime update will
-- overwrite the edit.
--
-- Three things the player sees, and nothing else:
--
-- - the objectives panel, a standing list of what the mission is asking for;
-- - the dialogue panel, one radio message at a time with its speaker, portrait
--   and voice clip;
-- - the debrief, once the mission is over, with how each objective ended.
--
-- Plus the name over a named actor, because nothing in the engine renames a unit
-- and a character the author called "Warlord" has to say so somewhere.
--
-- What to draw, and where every pixel of it goes, is decided in
-- luaui/mission_ui/coilbox_panel_model.lua, which is pure and tested outside
-- the engine. This file is the engine half: reading the world, uploading
-- geometry and drawing.
--
-- No immediate mode: the panels are one vertex buffer drawn with one call,
-- re-uploaded only when the scene changes, with the portrait a textured quad
-- through the same shader. Text goes through the engine's own batched path.
-- An engine without those buffers, which spring-headless is, keeps the widget
-- with the backdrops disabled rather than losing it: the dialogue, its audio
-- and the debrief still run, and the text still draws.
--
-- The widget reads the mission's state out of game rules params, which every Lua
-- handle can read, and hears about a line of dialogue through a global the
-- gadget's unsynced half calls. It never talks back: nothing on one player's
-- screen may reach the game.

local WIDGET_NAME = "Coilbox mission UI"
local LOG_SECTION = "coilbox-mission"

-- The global the gadget's unsynced half calls to say a line. Registered on the
-- widget handler in Initialize and taken back down in Shutdown.
local DIALOGUE_GLOBAL = "CoilboxMissionDialogue"

function widget:GetInfo()
	return {
		name = WIDGET_NAME,
		desc = "Objectives, dialogue and debrief for a coilbox scenario",
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
-- State. The look itself lives in the model, beside the layout it drives.
--------------------------------------------------------------------------------

-- Nothing is drawn and no callin does any work until Initialize has the mission
-- and the model in hand. A widget that has removed itself should never draw, and
-- one that draws from a half-loaded mission is a stack trace every frame.
local ready = false
local registered = false

local MODEL
local MISSION
local MISSION_DIR

local queue
local debrief
local myAllyTeam = 0
local vsx, vsy = 1024, 768

-- Portraits that would not load, so a missing file is one warning rather than
-- one per frame.
local badTexture = {}

-- What the panels are showing, and the version that says it changed. The scene
-- is rebuilt on game frames because the mirrors it reads only change on them,
-- and the layout is rebuilt, packed and uploaded only when the version moves.
local scene = { objectives = {} }
local sceneVersion = 0
local sceneKey = nil

local function read(name)
	return Spring.GetGameRulesParam(name)
end

--- The width of a string, in multiples of the font size, which is what
-- gl.GetTextWidth answers and what the model wraps against.
local function measure(value)
	return gl.GetTextWidth(value)
end

--------------------------------------------------------------------------------
-- Loading.
--------------------------------------------------------------------------------

--- Read a Lua table out of the game archive. `env` is an empty table for the
-- compiled mission, which is data and may not reach for a global, and nil for
-- the model, which is code and runs in the widget's own environment.
local function includeTable(path, env)
	if not VFS.FileExists(path, VFS.ZIP) then
		return nil, path .. " is missing"
	end
	local ok, value = pcall(VFS.Include, path, env, VFS.ZIP)
	if not ok then
		return nil, path .. " failed to load: " .. tostring(value)
	end
	if type(value) ~= "table" then
		return nil, path .. " did not return a table"
	end
	return value
end

--------------------------------------------------------------------------------
-- GL objects.
--------------------------------------------------------------------------------

-- Whether the engine gave us buffers and a shader. When it did not, which is
-- what spring-headless answers, the widget carries on with text alone.
local canDraw = false

local shader
local locProj, locView, locRect, locUseTex
-- One quad, for the portrait: the rect uniform moves it where the layout says.
local quadVAO, quadVBO, quadIBO
-- The panels' buffer, grown as needed by upload().
local panelSet = { capacity = 0 }
local panelIndices = 0

local layout = nil
local layoutVersion = -1
local layoutW, layoutH = 0, 0

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
	if not gl.CreateShader or not gl.GetVBO or not gl.GetVAO then
		return false
	end
	shader = gl.CreateShader({
		vertex = VERTEX_SHADER,
		fragment = FRAGMENT_SHADER,
		uniformInt = { tex = 0, useTex = 0 },
	})
	if not shader then
		log("warning", "shader failed: " .. tostring(gl.GetShaderLog()))
		return false
	end
	locProj = gl.GetUniformLocation(shader, "proj")
	locView = gl.GetUniformLocation(shader, "view")
	locRect = gl.GetUniformLocation(shader, "rect")
	locUseTex = gl.GetUniformLocation(shader, "useTex")

	quadVBO, quadIBO, quadVAO = makeBuffers(1)
	if not quadVAO then
		return false
	end
	local verts, idx = MODEL.pack({ { x = 0, y = 0, w = 1, h = 1, color = { 1, 1, 1, 1 } } })
	quadVBO:Upload(verts)
	quadIBO:Upload(idx)
	return true
end

local function dropGL()
	dropBuffers(panelSet.vbo, panelSet.ibo, panelSet.vao)
	panelSet.vbo, panelSet.ibo, panelSet.vao, panelSet.capacity = nil, nil, nil, 0
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
		local capacity = math.max(quads, set.capacity * 2, 8)
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

--- The inline code that colours a run of text, so a pass of gl.Text calls
-- needs no gl.Color between them.
local function colourCode(c)
	return string.char(255, math.floor(c[1] * 254) + 1, math.floor(c[2] * 254) + 1, math.floor(c[3] * 254) + 1)
end

--------------------------------------------------------------------------------
-- The scene, and its layout.
--------------------------------------------------------------------------------

--- Read what the panels should be showing, and move the version on when it is
-- not what they were showing before.
local function rebuildScene()
	scene.objectives = MODEL.objectives(MISSION, read)
	scene.line = queue.current()
	scene.portraitBad = (scene.line and scene.line.portrait and badTexture[scene.line.portrait]) == true
	scene.debrief = debrief
	local key = MODEL.sceneKey(scene)
	if key ~= sceneKey then
		sceneKey = key
		sceneVersion = sceneVersion + 1
	end
end

--- Where a dialogue clip or portrait lives. The launch path copies a scenario's
-- media in beside the compiled mission, so the bare file name the scenario
-- carries is resolved against the mission's own folder.
local function mediaPath(file)
	return MISSION_DIR .. file
end

--- Lay the scene out and re-upload its geometry, when either has changed.
local function relayout()
	if layoutVersion == sceneVersion and layoutW == vsx and layoutH == vsy then
		return
	end
	layout = MODEL.layout(scene, measure, { w = vsx, h = vsy })
	layoutVersion, layoutW, layoutH = sceneVersion, vsx, vsy
	local verts, idx = MODEL.pack(layout.rects)
	panelIndices = upload(panelSet, verts, idx)
end

--- The portrait, as a textured quad through the same shader. A file that will
-- not load is remembered and the scene rebuilt without it, so a missing
-- portrait is one warning rather than one per frame.
local function drawPortrait(portrait)
	if not gl.Texture(0, mediaPath(portrait.file)) then
		badTexture[portrait.file] = true
		log("warning", "could not load dialogue portrait " .. mediaPath(portrait.file))
		rebuildScene()
		return
	end
	gl.UniformInt(locUseTex, 1)
	gl.Uniform(locRect, portrait.x, portrait.y, portrait.w, portrait.h)
	quadVAO:DrawElements(GL.TRIANGLES, 6, 0)
	gl.Texture(0, false)
	gl.UniformInt(locUseTex, 0)
end

--------------------------------------------------------------------------------
-- The debrief.
--------------------------------------------------------------------------------

--- Build the debrief from the mirrored outcome, once, whichever of the GameOver
-- callin and the mirror notices first. Where it goes and how it wraps is the
-- layout's business, so a resize after the mission ends re-wraps it too.
local function buildDebrief()
	if debrief then
		return
	end

	local built = MODEL.debrief(MISSION, read, myAllyTeam)
	if not built then
		return
	end

	debrief = built
	queue.clear()
	rebuildScene()
end

--------------------------------------------------------------------------------
-- Names over named actors.
--------------------------------------------------------------------------------

--- An actor the author named, drawn over its unit.
--
-- GetUnitViewPosition answers nothing for a unit this player cannot see, so a
-- name never gives away where a hidden character is standing.
local function drawLabels()
	local code = colourCode(MODEL.COLOUR.label)
	for _, label in ipairs(MODEL.labels(MISSION, read)) do
		local x, y, z = Spring.GetUnitViewPosition(label.unitID)
		if x then
			local sx, sy, sz = Spring.WorldToScreenCoords(x, y + MODEL.LABEL_HEIGHT, z)
			-- Past the far plane is behind the camera, where the projection puts the
			-- point back on screen mirrored through the middle.
			if sz and sz <= 1 then
				gl.Text(code .. label.name, sx, sy, MODEL.LABEL_SIZE, "co")
			end
		end
	end
end

--------------------------------------------------------------------------------
-- Callins.
--------------------------------------------------------------------------------

function widget:Initialize()
	local model, modelError = includeTable("luaui/mission_ui/coilbox_panel_model.lua")
	if not model then
		log("error", modelError)
		widgetHandler:RemoveWidget()
		return
	end
	MODEL = model

	local id = MODEL.missionId(Spring.GetModOptions().coilbox_mission)
	if not id then
		-- A normal game. A widget that stays loaded to draw nothing is a widget in
		-- every game's list for no reason.
		widgetHandler:RemoveWidget()
		return
	end

	MISSION_DIR = "missions/" .. id .. "/"
	local mission, missionError = includeTable(MISSION_DIR .. "mission.lua", {})
	if not mission then
		log("error", missionError)
		widgetHandler:RemoveWidget()
		return
	end
	MISSION = mission

	local lines = {}
	for _, line in ipairs(MISSION.dialogue or {}) do
		lines[line.id] = line
	end
	queue = MODEL.newQueue({ lines = lines, gameSpeed = Game.gameSpeed })

	myAllyTeam = Spring.GetMyAllyTeamID()
	vsx, vsy = Spring.GetViewGeometry()

	registered = widgetHandler:RegisterGlobal(DIALOGUE_GLOBAL, function(lineId)
		queue.push(lineId)
	end)
	if not registered then
		log("error", DIALOGUE_GLOBAL .. " is already taken, so this mission will say nothing")
	end

	canDraw = makeGL()
	if not canDraw then
		dropGL()
		log("warning", "vertex buffers are not available, so the panels are text alone")
	end

	rebuildScene()
	ready = true
end

function widget:Shutdown()
	if registered then
		widgetHandler:DeregisterGlobal(DIALOGUE_GLOBAL)
		registered = false
	end
	ready = false
	dropGL()
end

function widget:ViewResize(x, y)
	vsx, vsy = x, y
end

--- Dialogue runs on game time rather than on wall time, so a paused game does
-- not run through a conversation while nobody is watching.
function widget:GameFrame(frame)
	if not ready then
		return
	end
	local started = queue.update(frame)
	if started and started.audio then
		Spring.PlaySoundFile(mediaPath(started.audio), 1)
	end
	if not debrief and read(MODEL.OVER_PARAM) == 1 then
		buildDebrief()
	end
	rebuildScene()
end

--- The engine hands the winning ally teams to this callin and the stock widget
-- handler drops them on the way, so the outcome is read from the mirror instead
-- and the argument is deliberately not taken.
function widget:GameOver()
	if ready then
		buildDebrief()
	end
end

--- Click the debrief away. It covers the middle of the screen, and a player who
-- wants to look at the map they just fought over should be able to.
function widget:MousePress(x, y)
	if not ready or not debrief then
		return false
	end
	local box = layout and layout.debriefBox
	if not box or x < box[1] or x > box[3] or y < box[2] or y > box[4] then
		return false
	end
	debrief = nil
	rebuildScene()
	return true
end

function widget:DrawScreen()
	if not ready then
		return
	end
	relayout()
	if canDraw and (panelIndices > 0 or layout.portrait) then
		gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
		gl.UseShader(shader)
		gl.UniformMatrix(locProj, unpack(MODEL.ortho(vsx, vsy)))
		gl.UniformMatrix(locView, unpack(IDENTITY))
		gl.Uniform(locRect, unpack(UNIT_RECT))
		gl.UniformInt(locUseTex, 0)
		if panelIndices > 0 and panelSet.vao then
			panelSet.vao:DrawElements(GL.TRIANGLES, panelIndices, 0)
		end
		if layout.portrait then
			drawPortrait(layout.portrait)
		end
		gl.UseShader(0)
	end
	for _, t in ipairs(layout.texts) do
		gl.Text(colourCode(t.color) .. t.text, t.x, t.y, t.size, t.options)
	end
	drawLabels()
end
