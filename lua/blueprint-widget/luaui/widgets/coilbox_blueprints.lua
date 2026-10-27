-- Coilbox blueprints: place a base layout from your library, or save one.
--
-- Installed into the content root by coilbox when the player asks. Change it
-- in the coilbox repository under lua/blueprint-widget/ and install again, or
-- the next update will overwrite the edit.
--
-- The panel lists the blueprints coilbox holds for this game, plus whatever
-- BAR's own blueprints.json has. Pick one and it follows the cursor as ghosts,
-- turned with [ and ], flipped with F and G, placed with a click as build
-- orders to the selected builders. Save selection writes the selected buildings, and the ground
-- changed under and round them, to a spool file that coilbox collects into the library. Save ground
-- writes the ground changed in a rectangle dragged on the map.
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
local ACTION_SAVE_GROUND = "coilbox_blueprints_save_ground"
local ACTION_LEFT = "coilbox_blueprints_rotate_left"
local ACTION_RIGHT = "coilbox_blueprints_rotate_right"
local ACTION_NEXT = "coilbox_blueprints_next"
local ACTION_PREV = "coilbox_blueprints_prev"
local ACTION_FLIP_X = "coilbox_blueprints_flip_x"
local ACTION_FLIP_Z = "coilbox_blueprints_flip_z"

-- Keys bound when the widget loads, each only if the player has bound
-- nothing to its action. The engine binds [ and ] to buildfacing and F and G
-- to fight and guard. LuaUI is offered a key before the engine runs its
-- actions, and these only take the key while a layout is being placed, so
-- the rest of the time it does its usual job. F and G flip, as in Factorio
-- before 2.0. Not H and V as in 2.0: Splinter Faction's share menu unbinds
-- everything on H when it loads and answers H itself.
local DEFAULT_KEYS = {
	{ ACTION_LEFT, "[" },
	{ ACTION_RIGHT, "]" },
	{ ACTION_PREV, "Shift+[" },
	{ ACTION_NEXT, "Shift+]" },
	{ ACTION_FLIP_X, "f" },
	{ ACTION_FLIP_Z, "g" },
}
-- The defaults this widget bound, to unbind on shutdown.
local boundKeys = {}

--- Bind each default key whose action has no key at all. Run when the
-- widget loads and again whenever placing starts, because a game widget that
-- loads later can clear a key: Splinter Faction's game_resetHotkeys.lua runs
-- unbindkeyset g. Binding adds to a key, so the game's own action on it
-- stays.
local function bindDefaults()
	for _, default in ipairs(DEFAULT_KEYS) do
		local action, key = default[1], default[2]
		local current = Spring.GetActionHotKeys(action)
		if not current or #current == 0 then
			Spring.SendCommands("bind " .. key .. " " .. action)
			local known = false
			for _, bound in ipairs(boundKeys) do
				known = known or bound == default
			end
			if not known then
				boundKeys[#boundKeys + 1] = default
			end
		end
	end
end
-- Each of the widget's actions by name, filled in by Initialize. See KeyPress.
local keyActions = {}
-- This widget, for the handler calls that name it.
local me = nil

-- Asking for the handler itself (handler = true in GetInfo) means the
-- usual stand-in's AddAction is not there. Every LuaUI handler keeps its
-- actions in widgetHandler.actionHandler, so go through that, and through
-- the stand-in for a handler that gave one anyway.
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
		desc = "Place a base blueprint from your coilbox library, or save one",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		-- Ahead of game widgets that answer a key outright: Splinter
		-- Faction's share menu takes H at layer -500. The widget only takes a
		-- key while a layout is being placed. Behind -1000, the Chili
		-- framework's, so a text box still gets its keys first.
		layer = -600,
		enabled = true,
		-- the handler itself rather than the usual stand-in, to ask other
		-- widgets whether they are drawn where the panel is
		handler = true,
	}
end

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

--------------------------------------------------------------------------------
-- Modules
--------------------------------------------------------------------------------

local JSON, STORE, MODEL, PLACE, GROUND, RECORD, TERRAIN, TERRAFORM, LATER

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
local relayout
local layoutVersion = -1
local layoutW, layoutH = 0, 0

-- What is being placed: the item, the rotation, and where it would land now.
local placing = nil
-- Ghosts left after a partial placement, already in world space.
-- Planned layouts nobody has built yet: placed with no builder that could
-- build them, or left over when the builders could build only part. Each is
-- { positions } in world space, kept until it is built or dismissed.
local plans = {}
-- Counts every change to the plans, so their ground marks are rebuilt even
-- when they hold as many positions as before.
local plansSerial = 0
-- The plan under the cursor: which marks to outline or cross out, by
-- position, and a key that changes when they do.
local hover = { marks = {}, key = "" }
local messageUntil = 0
-- A press on the pill or the panel's title, which is a click if the mouse
-- comes up where it went down and a drag once it moves further than the
-- engine's own threshold for starting a selection box.
local drag = nil
-- What the widget handler stored for us last time. The handler hands it over
-- when the widget loads, before Initialize runs.
local saved = nil
-- Save ground waiting for a drag on the map: from and to are where the drag
-- started and where it is now, on the ground.
local picking = nil

--------------------------------------------------------------------------------
-- GL objects
--------------------------------------------------------------------------------

local shader
local locProj, locView, locRect, locUseTex, locPicRadius, locGround, locBlocked
local quadVAO, quadVBO, quadIBO
-- The panel's and the ground marks' buffers, grown as needed by upload().
local panelSet = { capacity = 0 }
local groundSet = { capacity = 0 }
-- The volumes of the terrain steps being shown, with their wire and grids
local terrainSet = { capacity = 0 }
local terrainMesh = nil
local panelIndices, groundIndices = 0, 0
local groundKey = nil
-- What each terrain step being shown does, over the middle of it, in world
-- space. Refilled with the ground marks and drawn by DrawScreen.
local stepLabels = {}

local IDENTITY = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }
local UNIT_RECT = { 0, 0, 1, 1 }

local VERTEX_LAYOUT = {
	{ id = 0, name = "pos", size = 3 },
	{ id = 1, name = "uv", size = 2 },
	{ id = 2, name = "color", size = 4 },
	{ id = 3, name = "shape", size = 4 },
}

local VERTEX_SHADER = [[
#version 130
#extension GL_ARB_explicit_attrib_location : require
layout(location = 0) in vec3 pos;
layout(location = 1) in vec2 uv;
layout(location = 2) in vec4 color;
layout(location = 3) in vec4 shape;
uniform mat4 proj;
uniform mat4 view;
uniform vec4 rect;
uniform float picRadius;
out vec2 vUv;
out vec4 vColor;
out vec4 vShape;
void main() {
	vec3 p = vec3(pos.xy * rect.zw + rect.xy, pos.z);
	gl_Position = proj * view * vec4(p, 1.0);
	vUv = uv;
	vColor = color;
	// The unit quad's shape is 1 by 1, so a picture takes its size from rect.
	vShape = vec4(shape.xy * rect.zw, shape.z + picRadius, shape.w);
}
]]

local FRAGMENT_SHADER = [[
#version 130
uniform sampler2D tex;
uniform int useTex;
uniform int ground;
uniform vec4 blocked;
in vec2 vUv;
in vec4 vColor;
in vec4 vShape;
out vec4 fragColor;
void main() {
	if (ground == 2) {
		// the volumes and lines of a terrain preview: the vertex's colour as it is
		fragColor = vColor;
		return;
	}
	vec4 c = vColor;
	if (useTex == 1) {
		c *= texture(tex, vUv);
	}
	// Distance to the edge of a rounded box, in the box's own units. Half a
	// unit either side of the edge fades out, and a border keeps only a ring.
	vec2 halfSize = vShape.xy * 0.5;
	float r = min(vShape.z, min(halfSize.x, halfSize.y));
	vec2 q = abs((vUv - 0.5) * vShape.xy) - halfSize + r;
	float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
	float a = clamp(0.5 - d, 0.0, 1.0);
	if (ground == 1) {
		// On the ground the units are elmos, and the shape's last field holds
		// flags: 1 refused, striped with a red dashed rim, 2 hovered, with a
		// white rim, 4 nobody selected can build it, crossed out. Every mark
		// has a firmer rim.
		vec2 p = vUv * vShape.xy;
		int flags = int(vShape.w + 0.5);
		bool refused = (flags & 1) != 0;
		if (refused && fract((p.x + p.y) / 16.0) < 0.5) {
			c = vec4(0.05, 0.05, 0.05, 0.7);
		}
		if (refused && d > -3.0) {
			c = fract((p.x + p.y) / 12.0) < 0.6 ? blocked : vec4(0.0);
		} else if (d > -2.0) {
			c = vec4(vColor.rgb, min(1.0, vColor.a * 2.5));
		}
		if ((flags & 4) != 0 && d < -4.0) {
			float side = min(vShape.x, vShape.y);
			float cross = min(abs(vUv.x - vUv.y), abs(vUv.x + vUv.y - 1.0)) * side;
			if (cross < 3.0) {
				c = vec4(blocked.rgb, 0.9);
			}
		}
		if ((flags & 2) != 0 && d > -3.0) {
			c = vec4(1.0, 1.0, 1.0, 1.0);
		}
	} else if (vShape.w > 0.0) {
		a *= clamp(0.5 + d + vShape.w, 0.0, 1.0);
	}
	c.a *= a;
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
		uniformInt = { tex = 0, useTex = 0, ground = 0 },
		uniformFloat = { picRadius = 0 },
	})
	if not shader then
		log(LOG.ERROR, "shader failed: " .. tostring(gl.GetShaderLog()))
		return false
	end
	locProj = gl.GetUniformLocation(shader, "proj")
	locView = gl.GetUniformLocation(shader, "view")
	locRect = gl.GetUniformLocation(shader, "rect")
	locUseTex = gl.GetUniformLocation(shader, "useTex")
	locPicRadius = gl.GetUniformLocation(shader, "picRadius")
	locGround = gl.GetUniformLocation(shader, "ground")
	locBlocked = gl.GetUniformLocation(shader, "blocked")

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
	dropSet(terrainSet)
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

--- Upload a mesh of triangles and lines, which need fewer vertices for their
-- indices than the quads upload() is sized for.
-- @return integer how many indices
local function uploadMesh(set, verts, idx)
	if #idx == 0 then
		return 0
	end
	local quads = math.max(math.ceil(#verts / 13 / 4), math.ceil(#idx / 6))
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

-- The height of a capital at size 1. The model puts a text's y at the middle
-- of its capitals, and drawing from the baseline half this below keeps every
-- label in a button centred whatever letters it has.
local capHeight = nil

--- Whether any builder the team has can terraform, for when none is selected.
local function teamCanTerraform()
	for _, unitID in ipairs(Spring.GetTeamUnits(Spring.GetMyTeamID()) or {}) do
		local defID = Spring.GetUnitDefID(unitID)
		local def = defID and UnitDefs[defID]
		if def and def.buildOptions and #def.buildOptions > 0 and PLACE.canTerraform(unitID) then
			return true
		end
	end
	return false
end

--- Read what the selected units can do. Whether this match has terraform is
-- the selected builders' say when there are any, since a mission can lock it,
-- and otherwise the team's.
local function readCan(selected)
	can = PLACE.capabilities(selected)
	if #can.builders > 0 then
		can.terraformAvailable = #can.terraformers > 0
	else
		can.terraformAvailable = teamCanTerraform()
	end
end

local function readSelection()
	local selected = Spring.GetSelectedUnits()
	local key = #selected .. ":" .. table.concat(selected, ",")
	if key == selectionKey then
		return false
	end
	selectionKey = key
	readCan(selected)
	return true
end

local readCost
local syncTerrain

-- What morphs into what, read once, and what the team can ever build, read
-- again when the kinds of unit it has change.
local morphs = nil
local side, reachKey = nil, nil

local function readReach()
	if Spring.GetSpectatingState() then
		side, reachKey = nil, nil
		return
	end
	if not morphs then
		local configs = {}
		for _, path in ipairs({ "gamedata/morph_defs.lua", "LuaRules/Configs/morph_defs.lua" }) do
			if VFS.FileExists(path) then
				local ok, value = pcall(VFS.Include, path)
				if ok then
					configs[#configs + 1] = value
				end
			end
		end
		morphs = PLACE.morphTargets(configs)
	end
	local ids = {}
	for defID in pairs(Spring.GetTeamUnitsCounts(Spring.GetMyTeamID()) or {}) do
		if type(defID) == "number" then
			ids[#ids + 1] = defID
		end
	end
	table.sort(ids)
	local key = table.concat(ids, ",")
	if key ~= reachKey then
		reachKey = key
		-- before the team has a unit there is nothing to tell sides apart by
		side = nil
		if #ids > 0 then
			local reach = PLACE.reach(ids, morphs)
			side = { reach = reach, standIns = PLACE.standIns(reach, morphs) }
		end
	end
end

local function refreshPanel()
	readReach()
	MODEL.refresh(panel, store:entries(), PLACE, Game, can, side)
	readCost()
	syncTerrain()
	MODEL.touch(panel)
end

--------------------------------------------------------------------------------
-- Placing
--------------------------------------------------------------------------------

--- Read which keys are bound to the actions the hints name.
local function readKeys()
	panel.keys = {
		left = Spring.GetActionHotKeys(ACTION_LEFT) or {},
		right = Spring.GetActionHotKeys(ACTION_RIGHT) or {},
		flipX = Spring.GetActionHotKeys(ACTION_FLIP_X) or {},
		flipZ = Spring.GetActionHotKeys(ACTION_FLIP_Z) or {},
	}
	MODEL.touch(panel)
end

--- What the layout being placed costs, and how long the selection takes.
function readCost()
	if not placing then
		return
	end
	local metal, energy, seconds = PLACE.cost(placing.item.resolved, can, placing.terra)
	panel.placing.cost = { metal = metal, energy = energy, seconds = seconds }
	MODEL.touch(panel)
end

--- The spots a spot-bound building can go on. Geothermal spots are the
-- map's geothermal features, which every game has. Metal spots are whichever
-- list the game's own widgets publish: BAR and Zero-K style games keep
-- WG.metalSpots or WG.resource_spot_finder.metalSpotsList, Splinter Faction
-- WG.metalMakerSpots and WG.mapmetalspots. For any other game they come
-- from the scan of the map's metal, which runs a row's worth of squares a
-- frame from when the widget loads and finishes at once if it is needed
-- first.
local metalScan = nil
local function spotsFor(kind, def)
	if kind == "geo" then
		local out = {}
		for _, featureID in ipairs(Spring.GetAllFeatures() or {}) do
			local def = FeatureDefs[Spring.GetFeatureDefID(featureID)]
			if def and def.geoThermal then
				local x, _, z = Spring.GetFeaturePosition(featureID)
				out[#out + 1] = { x = x, z = z }
			end
		end
		return out
	end
	local finder = WG.resource_spot_finder
	for _, list in ipairs({ WG.metalSpots, finder and finder.metalSpotsList, WG.metalMakerSpots, WG.mapmetalspots }) do
		if type(list) == "table" and #list > 0 then
			return list
		end
	end
	-- what one extractor covers: twice its reach, or its own footprint
	local span = 2 * (def.extractRange or 0)
	if span <= 0 then
		span = math.max(def.xsize, def.zsize) * 8
	end
	if not metalScan then
		return {}
	end
	return PLACE.metalSpots(metalScan, span)
end

--- Whether the Terrain choice shows: the match can terraform and the
-- blueprint being placed has terrain changes.
function syncTerrain()
	if placing then
		panel.placing.terrain = can.terraformAvailable and #(placing.item.entry.terrain or {}) > 0 or nil
	end
end

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
	if not item.placeable then
		if item.stop then
			say(item.name .. " only changes the ground: " .. item.stop)
		elseif item.foreign > 0 then
			say(item.name .. " has buildings your side cannot build")
		else
			say("Nothing in " .. item.name .. " exists in this game")
		end
		return
	end
	bindDefaults()
	readKeys()
	placing = { item = item, rotation = 0, flip = { x = false, z = false }, pivot = PLACE.pivot(item.resolved), foot = nil }
	-- a layout of terrain steps alone has no building to hold it by or to snap
	-- to a spot, so the middle of its steps is held
	placing.hold = PLACE.holdPoint(item.resolved, placing.pivot)
	local held = placing.pivot and item.resolved.buildings[placing.pivot].def
	local kind = held and PLACE.spotKind(held)
	placing.spots = kind and spotsFor(kind, held) or nil
	panel.placing = { key = key, name = item.name, rotation = 0, flip = placing.flip }
	readCost()
	syncTerrain()
end

--- Turn the layout being placed. Returns whether it did, so a key bound to
-- this and to something else only turns when there is something to turn.
local function rotate(turns)
	if not placing then
		return false
	end
	-- One flip mirrors the turn too, so turn the other way to keep a key
	-- turning the same way on screen.
	if placing.flip.x ~= placing.flip.z then
		turns = -turns
	end
	placing.rotation = (placing.rotation + turns) % 4
	placing.foot, placing.extent = nil, nil
	panel.placing.rotation = placing.rotation
	MODEL.touch(panel)
	return true
end

--- Flip the layout being placed side to side ("x") or top to bottom ("z").
-- Returns whether it did, as rotate does.
local function flip(axis)
	if not placing or (axis ~= "x" and axis ~= "z") then
		return false
	end
	placing.flip[axis] = not placing.flip[axis]
	placing.foot, placing.extent = nil, nil
	MODEL.touch(panel)
	return true
end

--- Pick up the next or the previous blueprint under the current tab. Only
-- while the panel is open or something is being placed, so the key does its
-- usual job the rest of the time.
local function step(direction)
	if not (panel.open or placing) then
		return false
	end
	local key = MODEL.step(panel, direction)
	if key then
		startPlacing(key)
		MODEL.reveal(panel, key)
	end
	return true
end

--- Where the layout would land under the cursor now, or nil off the map.
-- The cursor holds the pivot, the building nearest the layout's middle, and
-- the layout turns and flips about it. During a shift drag it is copies in a
-- line from where the drag began.
-- Counts every placement the cursor has made, across blueprints, so the ground
-- preview's key never repeats when another blueprint is picked up. A count per
-- blueprint started again at 1 and a new one could show the last one's preview.
local placingSerial = 0

local function trackCursor()
	local kind, pos
	if placing.at then
		-- placed by another widget, at a point, not by the cursor
		kind, pos = "ground", { placing.at.x, 0, placing.at.z }
	else
		local mx, my = Spring.GetMouseState()
		kind, pos = Spring.TraceScreenRay(mx, my, true)
	end
	if kind ~= "ground" or not pos then
		placing.foot = nil
		return
	end
	local resolved = placing.item.resolved
	if not placing.extent then
		placing.extent = { PLACE.extent(resolved, placing.rotation, placing.flip) }
	end
	-- a layout held by an extractor or a geothermal jumps onto the nearest
	-- spot for it, read once per pick up
	local cx, cz = pos[1], pos[3]
	if placing.spots then
		local spot = PLACE.nearestSpot(placing.spots, cx, cz, PLACE.SPOT_SNAP)
		if spot then
			cx, cz = spot.x, spot.z
		end
	end
	local ax, az = PLACE.pivotAt(resolved, placing.pivot, placing.rotation, placing.flip, cx, cz)
	if placing.foot and placing.ax == ax and placing.az == az then
		return
	end
	placing.ax, placing.az = ax, az
	local anchors = { { x = ax, z = az } }
	if placing.line then
		anchors = PLACE.line(placing.line.x, placing.line.z, ax, az, unpack(placing.extent))
	end
	local foot = {}
	local origin = placing.hold
	for _, at in ipairs(anchors) do
		for _, p in ipairs(PLACE.footprint(resolved, placing.rotation, at.x, at.z, placing.flip, origin)) do
			p.seq = #foot + 1
			foot[#foot + 1] = p
		end
	end
	placing.foot, placing.anchors, placing.origin = foot, anchors, origin
	-- the steps, for their outlines on the ground. They are laid again with the
	-- ground as it is when the player clicks.
	placing.steps = PLACE.laySteps(resolved, placing.rotation, placing.flip, origin, anchors, foot)
	placingSerial = placingSerial + 1
	placing.serial = placingSerial
end

local function plansChanged()
	plansSerial = plansSerial + 1
	local count = 0
	for _, plan in ipairs(plans) do
		count = count + #plan.positions + #plan.steps
	end
	panel.remainder = count > 0 and { count = count } or nil
	MODEL.touch(panel)
end

local function addPlan(positions, steps)
	if #positions > 0 or #steps > 0 then
		plans[#plans + 1] = { positions = positions, steps = steps }
		plansChanged()
	end
end

local function terrainChanges(n)
	return n .. (n == 1 and " terrain change" or " terrain changes")
end

local function describe(plan, sent)
	local parts = {}
	if sent > 0 then
		parts[#parts + 1] = "ordered to " .. sent .. (sent == 1 and " builder" or " builders")
	end
	if plan.blocked > 0 then
		parts[#parts + 1] = plan.blocked .. " blocked"
	end
	if (plan.skipped or 0) > 0 then
		parts[#parts + 1] = terrainChanges(plan.skipped) .. " skipped (" .. (plan.skippedWhy or "") .. ")"
	end
	if (plan.offMap or 0) > 0 then
		parts[#parts + 1] = terrainChanges(plan.offMap) .. " off the map"
	end
	local left = #plan.remainder + #(plan.stepRemainder or {})
	if left > 0 then
		local what = sent > 0 and " left for another builder" or " planned, right click it with builders to build"
		parts[#parts + 1] = left .. what
	end
	if #parts == 0 then
		return "nothing could be placed"
	end
	return table.concat(parts, ", ")
end

-- Set while another widget places a blueprint with placeAt, to say whether
-- shift counts as held.
local shiftOverride = nil

local function shiftHeld()
	if shiftOverride ~= nil then
		return shiftOverride
	end
	local _, _, _, shift = Spring.GetModKeyState()
	return shift == true
end

--- The terrain argument of PLACE.plan for some laid steps: ordered when the
-- match can terraform and the player has Terrain on.
local function terrainArg(steps)
	local available = can.terraformAvailable == true
	return {
		steps = steps,
		on = available and panel.terrain,
		why = not available and "terraforming is not available here" or "Terrain is off",
	}
end

local function placeNow()
	if not placing or not placing.foot then
		return
	end
	readSelection()
	-- the ground under the pivot is read now, as the player clicks
	local steps = PLACE.laySteps(placing.item.resolved, placing.rotation, placing.flip, placing.origin, placing.anchors, placing.foot)
	local plan = PLACE.plan(placing.foot, can, shiftHeld(), panel.assist, terrainArg(steps))
	local sent = PLACE.issue(plan, LATER)
	say(placing.item.name .. ": " .. describe(plan, sent))
	addPlan(plan.remainder, plan.stepRemainder)
	placing.line = nil
	-- Holding shift keeps the blueprint on the cursor for another copy.
	if not shiftHeld() then
		stopPlacing()
	else
		placing.foot = nil
	end
end

--- Hand a plan, or one building of it, to the selected builders. What
-- they cannot build stays planned.
-- @param index integer the plan
-- @param only integer? one position in the plan, the whole plan if nil
local function buildPlan(index, only)
	local positions = plans[index].positions
	-- Re-test the ground, since things have been built since.
	local foot = {}
	for i, p in ipairs(positions) do
		if not only or i == only then
			local status = Spring.TestBuildOrder(p.defID, p.x, p.y, p.z, p.facing)
			foot[#foot + 1] = { defID = p.defID, def = p.def, x = p.x, y = p.y, z = p.z, facing = p.facing, blocked = status == 0, seq = p.seq }
		end
	end
	-- One building takes the steps that come ahead of it, the whole plan takes
	-- them all.
	local steps, later = {}, {}
	for _, step in ipairs(plans[index].steps) do
		if not only or (positions[only].seq and step.after < positions[only].seq) then
			steps[#steps + 1] = step
		else
			later[#later + 1] = step
		end
	end
	local plan = PLACE.plan(foot, can, shiftHeld(), panel.assist, terrainArg(steps))
	local sent = PLACE.issue(plan, LATER)
	plans[index].steps = later
	for _, step in ipairs(plan.stepRemainder) do
		table.insert(plans[index].steps, step)
	end
	if only then
		-- the one building leaves the plan once it is ordered or the ground
		-- refuses it, and stays when nobody selected can build it
		if #plan.remainder == 0 then
			table.remove(positions, only)
		end
	else
		plans[index].positions = plan.remainder
	end
	return plan, sent
end

local function dropEmptyPlans()
	for i = #plans, 1, -1 do
		if #plans[i].positions == 0 and #plans[i].steps == 0 then
			table.remove(plans, i)
		end
	end
	plansChanged()
end

--- Build every plan with the selection, from the panel's Place button.
local function placeRemainder()
	readSelection()
	local total = { blocked = 0, remainder = {}, stepRemainder = {}, skipped = 0, offMap = 0 }
	local sent = 0
	for i = 1, #plans do
		local plan, n = buildPlan(i)
		total.blocked = total.blocked + plan.blocked
		total.skipped = total.skipped + plan.skipped
		total.offMap = total.offMap + plan.offMap
		total.skippedWhy = plan.skippedWhy or total.skippedWhy
		for _, p in ipairs(plan.remainder) do
			total.remainder[#total.remainder + 1] = p
		end
		for _, step in ipairs(plan.stepRemainder) do
			total.stepRemainder[#total.stepRemainder + 1] = step
		end
		sent = math.max(sent, n)
	end
	dropEmptyPlans()
	say("Planned: " .. describe(total, sent))
end

--- The plan with a building under a point on the ground, if any.
-- @return integer? the plan, integer? the building's position in it
local function planAt(x, z)
	for i = #plans, 1, -1 do
		for j, p in ipairs(plans[i].positions) do
			local hw, hd = PLACE.halfSpan(p.def, p.facing)
			if math.abs(x - p.x) <= hw and math.abs(z - p.z) <= hd then
				return i, j
			end
		end
	end
	return nil
end

--- A right click on a building in a plan has the selected builders build
-- that building. With shift held they build the whole plan, after what they
-- are already doing. With nothing selected the click removes the plan, and
-- with other units selected the click is theirs.
local function clickPlan(mx, my)
	if #plans == 0 then
		return false
	end
	local kind, pos = Spring.TraceScreenRay(mx, my, true)
	if kind ~= "ground" or not pos then
		return false
	end
	local index, position = planAt(pos[1], pos[3])
	if not index then
		return false
	end
	readSelection()
	if #can.builders > 0 then
		local whole = shiftHeld()
		local name = plans[index].positions[position].def
		local plan, sent = buildPlan(index, not whole and position or nil)
		if not whole and sent == 0 and plan.blocked == 0 then
			say("The selected builders cannot build " .. (name.translatedHumanName or name.humanName or name.name))
		else
			say("Planned: " .. describe(plan, sent))
		end
		dropEmptyPlans()
		return true
	end
	if #Spring.GetSelectedUnits() == 0 then
		table.remove(plans, index)
		plansChanged()
		say("Plan removed")
		return true
	end
	return false
end

--- What a right click would do where the cursor is: outline the building
-- under it, or the whole plan with shift held or nothing selected, cross out
-- what the selection cannot build, and show the build cursor for it.
local function trackHover()
	local marks, key, cursor = {}, "", nil
	if not placing and #plans > 0 then
		local mx, my = Spring.GetMouseState()
		local kind, pos = Spring.TraceScreenRay(mx, my, true)
		local index, position
		if kind == "ground" and pos then
			index, position = planAt(pos[1], pos[3])
		end
		local selected = #Spring.GetSelectedUnits()
		if index and (#can.builders > 0 or selected == 0) then
			local whole = shiftHeld() or selected == 0
			local any = false
			for j, p in ipairs(plans[index].positions) do
				if whole or j == position then
					local flags = MODEL.MARK_HOVERED
					if selected > 0 then
						if can.union[p.defID] then
							any = true
						else
							flags = flags + MODEL.MARK_CANNOT
						end
					end
					marks[p] = flags
					key = key .. j .. ":" .. flags .. ","
				end
			end
			key = index .. "|" .. key
			if selected > 0 then
				cursor = any and "BuildGood" or "BuildBad"
			end
		end
	end
	if key ~= hover.key then
		hover.marks, hover.key = marks, key
	end
	if cursor then
		Spring.SetMouseCursor(cursor)
	end
end

--------------------------------------------------------------------------------
-- Saving
--------------------------------------------------------------------------------

--- Put a recorded entry in the spool, or say why there is none.
local function keep(entry, err)
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

local function saveSelection()
	return keep(RECORD.selection({ nameFor = MODEL.contentName, now = os.time() }))
end

--- Save the ground changed between two corners of a rectangle, in elmos.
local function saveGround(x0, z0, x1, z1)
	return keep(RECORD.ground(x0, z0, x1, z1, { now = os.time() }))
end

--- Wait for a drag on the map, and save the ground in it.
local function pickGround()
	picking = {}
	say("Drag over the ground to save")
end

local function groundUnder(mx, my)
	local kind, pos = Spring.TraceScreenRay(mx, my, true)
	if kind == "ground" and pos then
		return { x = pos[1], z = pos[3] }
	end
	return nil
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

--- Place the blueprint being held at a point on the map, as a click there
-- would, for a game's own interface or a test driving the widget.
-- @param x number elmos
-- @param z number elmos
-- @param shift boolean? whether to place it as if shift were held
-- @return boolean whether anything was held
local function placeAt(x, z, shift)
	if not placing then
		return false
	end
	local held = placing.at
	placing.at, placing.foot = { x = x, z = z }, nil
	shiftOverride = shift == true
	trackCursor()
	placeNow()
	shiftOverride = nil
	if placing then
		placing.at = held
		placing.foot = nil
	end
	return true
end

--- Hold the blueprint being placed at a point on the map, as though the cursor
-- were there, until it is put down or this is called with no point.
-- @param x number? elmos
-- @param z number? elmos
-- @return boolean whether anything was held
local function holdAt(x, z)
	if not placing then
		return false
	end
	placing.at = x and { x = x, z = z } or nil
	placing.foot = nil
	return true
end

--- Turn the placing of terrain changes on or off. A blueprint of terrain
-- changes alone cannot be placed with it off, so one being placed is put down.
local function setTerrain(on)
	MODEL.setTerrain(panel, on)
	refreshPanel()
	if placing then
		for _, item in ipairs(panel.items) do
			if item.entry.key == placing.item.entry.key then
				placing.item = item
				if not item.placeable then
					say(item.name .. " only changes the ground: " .. (item.stop or ""))
					stopPlacing()
				end
				break
			end
		end
	end
end

local function act(action)
	local kind = action.kind
	if kind == "toggle" then
		toggle()
	elseif kind == "close" then
		close()
	elseif kind == "tab" then
		MODEL.setTab(panel, action.tab)
	elseif kind == "view" then
		MODEL.setView(panel, action.view)
	elseif kind == "page" then
		MODEL.turnPage(panel, action.delta)
	elseif kind == "turn" then
		rotate(action.delta)
	elseif kind == "flip" then
		flip(action.axis)
	elseif kind == "assist" then
		MODEL.setAssist(panel, action.mode)
	elseif kind == "terrain" then
		setTerrain(action.mode == "on")
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
		plans = {}
		plansChanged()
	elseif kind == "save" then
		saveSelection()
	elseif kind == "saveGround" then
		pickGround()
	end
end

--------------------------------------------------------------------------------
-- Callins
--------------------------------------------------------------------------------

function widget:SetConfigData(data)
	saved = data
end

-- Whether builders help each other or split the work, and whether terrain
-- changes are placed, by game, since both depend on the game's rules.
local function gameKey()
	return Game.gameShortName or Game.gameName or ""
end

function widget:GetConfigData()
	local assist = {}
	for k, v in pairs(type(saved and saved.assist) == "table" and saved.assist or {}) do
		assist[k] = v
	end
	if panel then
		assist[gameKey()] = panel.assist
	end
	local terrain = {}
	for k, v in pairs(type(saved and saved.terrain) == "table" and saved.terrain or {}) do
		terrain[k] = v
	end
	if panel then
		terrain[gameKey()] = panel.terrain
	end
	return { seen = true, pos = panel and panel.pos, view = panel and panel.view, assist = assist, terrain = terrain }
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
		GROUND, err = include("ground.lua")
	end
	if GROUND then
		RECORD, err = include("record.lua")
	end
	if RECORD then
		TERRAIN, err = include("terrain.lua")
	end
	if TERRAIN then
		TERRAFORM, err = include("terraform.lua")
	end
	if TERRAFORM then
		LATER, err = include("pending_terraform.lua")
	end
	if not LATER then
		log(LOG.ERROR, err)
		widgetHandler:RemoveWidget(self)
		return
	end

	STORE.use(JSON)
	PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game, WG = WG })
	RECORD.use({ Spring = Spring, UnitDefs = UnitDefs, Game = Game, GROUND = GROUND })
	LATER.use({ Spring = Spring })

	store = STORE.new({
		vfs = VFS,
		io = io,
		log = function(message)
			log(LOG.WARNING, message)
		end,
	})
	panel = MODEL.new()
	if saved and MODEL.validPos(saved.pos) then
		panel.pos = saved.pos
	end
	if saved then
		MODEL.setView(panel, saved.view)
		if type(saved.assist) == "table" then
			MODEL.setAssist(panel, saved.assist[gameKey()])
		end
		if type(saved.terrain) == "table" then
			MODEL.setTerrain(panel, saved.terrain[gameKey()])
		end
	end
	readCan({})

	if not makeGL() then
		widgetHandler:RemoveWidget(self)
		return
	end

	vsx, vsy = Spring.GetViewGeometry()
	capHeight = gl.GetTextHeight("H")

	-- start finding metal spots now if anything in the game is an extractor
	for _, def in pairs(UnitDefs) do
		if PLACE.spotKind(def) == "metal" then
			local sizeX, sizeZ = Spring.GetMetalMapSize()
			metalScan = PLACE.newMetalScan(sizeX, sizeZ, Spring.GetMetalAmount, Game.metalMapSquareSize)
			break
		end
	end

	-- "t" reaches the console and "p" a key bound in uikeys.txt. Without the
	-- second, bind x coilbox_blueprints would do nothing.
	keyActions = {
		[ACTION_TOGGLE] = function()
			toggle()
			return true
		end,
		[ACTION_SAVE] = function()
			saveSelection()
			return true
		end,
		[ACTION_SAVE_GROUND] = function()
			pickGround()
			return true
		end,
		[ACTION_LEFT] = function()
			return rotate(-1)
		end,
		[ACTION_RIGHT] = function()
			return rotate(1)
		end,
		[ACTION_PREV] = function()
			return step(-1)
		end,
		[ACTION_NEXT] = function()
			return step(1)
		end,
		[ACTION_FLIP_X] = function()
			return flip("x")
		end,
		[ACTION_FLIP_Z] = function()
			return flip("z")
		end,
	}
	me = self
	for action, run in pairs(keyActions) do
		addAction(action, run)
	end
	bindDefaults()

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
		saveGround = saveGround,
		rotate = rotate,
		flip = flip,
		step = step,
		assist = function(mode)
			MODEL.setAssist(panel, mode)
		end,
		placeAt = placeAt,
		holdAt = holdAt,
		-- what the layout being placed costs, as the panel says it: metal, energy
		-- and seconds, with the terraform counted
		cost = function()
			return panel.placing and panel.placing.cost or nil
		end,
		terrain = function(on)
			setTerrain(on == true or on == "on")
		end,
	}

	-- A widget that loads and then draws nothing looks like one that did not
	-- load. Say how to reach it, and the very first time it ever runs, open
	-- the panel so there is something to see.
	Spring.Echo("Coilbox blueprints: /coilbox_blueprints toggles the panel. Bind keys to " .. ACTION_LEFT .. ", " .. ACTION_RIGHT .. ", " .. ACTION_FLIP_X .. ", " .. ACTION_FLIP_Z .. ", " .. ACTION_PREV .. " and " .. ACTION_NEXT .. " to turn, flip and pick layouts.")
	if not (saved and saved.seen) then
		open()
	end
end

function widget:Shutdown()
	if LATER then
		LATER.flush()
	end
	for action in pairs(keyActions) do
		removeAction(action)
	end
	for _, default in ipairs(boundKeys) do
		Spring.SendCommands("unbind " .. default[2] .. " " .. default[1])
	end
	boundKeys = {}
	WG.CoilboxBlueprints = nil
	dropGL()
end

-- Zero-K's terraform orders held until a builder nears their level step.
function widget:GameFrame(frame)
	LATER.update(frame)
end

function widget:ViewResize(x, y)
	vsx, vsy = x, y
	layoutVersion = -1
end

-- Whether the panel has looked for other panels in its way yet. It looks
-- once, when the game's own panels are up: the first time a unit is
-- selected, since Splinter Faction only shows its build menu then, or a few
-- seconds after the team's first unit appears.
local avoided = false
local spawnedAt = nil
local AVOID_AFTER = 5

-- Elements RmlUi reports where a document draws nothing: the root of a
-- context and a document's own body, which often spans the screen.
local RML_BACKGROUND = { ["#root"] = true, body = true, html = true }

--- Whether an RmlUi document draws something at a point. LuaUI measures y
-- up from the bottom of the screen and RmlUi down from the top.
local function rmlAt(x, y)
	if not (RmlUi and RmlUi.contexts and RmlUi.Vector2f) then
		return false
	end
	local ok, hit = pcall(function()
		local point = RmlUi.Vector2f.new(x, vsy - y)
		-- a function in Recoil 2026.09.01 that returns the list
		local contexts = RmlUi.contexts
		if type(contexts) == "function" then
			contexts = contexts()
		end
		for _, context in ipairs(contexts) do
			local element = context:GetElementAtPoint(point)
			if element and not RML_BACKGROUND[element.tag_name] then
				return true
			end
		end
		return false
	end)
	return ok and hit
end

--- Move the panel up or down its edge out of the way of the game's other
-- panels: RmlUi documents, and widgets that answer IsAbove at points over
-- the panel. Panels the engine draws itself answer to neither and are not
-- avoided.
local function avoidOthers()
	local list = type(widgetHandler.IsAboveList) == "table" and widgetHandler.IsAboveList or {}
	if drag or not layout then
		return
	end
	local seen = {}
	local function covered(x, y)
		local k = math.floor(x) .. ":" .. math.floor(y)
		if seen[k] == nil then
			seen[k] = rmlAt(x, y)
			for _, w in ipairs(list) do
				if seen[k] then
					break
				end
				if w ~= me and w.IsAbove then
					local ok, above = pcall(w.IsAbove, w, x, y)
					seen[k] = ok and above == true
				end
			end
		end
		return seen[k]
	end
	local b = layout.box
	local base = { x = b.x, y = b.y - panel.nudge, w = b.w, h = b.h }
	local step = math.max(8, math.floor(24 * MODEL.scaleFor(panel, { w = vsx, h = vsy })))
	local dy = MODEL.clearOffset(base, vsy, covered, step)
	if dy ~= panel.nudge then
		panel.nudge = dy
		MODEL.touch(panel)
	end
end

function widget:Update(dt)
	clock = clock + dt
	if metalScan and not metalScan.done then
		PLACE.stepMetalScan(metalScan, metalScan.sizeX)
	end
	if not avoided and layout then
		if not spawnedAt and #(Spring.GetTeamUnits(Spring.GetMyTeamID()) or {}) > 0 then
			spawnedAt = clock
		end
		if spawnedAt and (#Spring.GetSelectedUnits() > 0 or clock - spawnedAt > AVOID_AFTER) then
			avoided = true
			avoidOthers()
		end
	end
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
	if not panel.open and not placing and #plans == 0 then
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
	trackHover()
end

function widget:IsAbove(x, y)
	return layout ~= nil and MODEL.hit(layout, x, y) ~= nil
end

function widget:MousePress(x, y, button)
	if layout then
		local action = MODEL.hit(layout, x, y)
		if action then
			if button == 1 then
				if action.kind == "toggle" then
					local right = panel.pos == nil or panel.pos.right
					drag = { x = x, y = y, box = layout.box, right = right, moved = false }
				else
					act(action)
				end
			end
			return true
		end
	end
	if picking then
		if button == 1 then
			picking.from = groundUnder(x, y)
			picking.to = picking.from
		else
			picking = nil
			say("Save ground cancelled")
		end
		return true
	end
	if placing then
		if button == 1 then
			-- A press starts a line of copies that a drag lengthens, and the
			-- release places it. A click without a drag places one.
			if placing.foot then
				placing.line = { x = placing.ax, z = placing.az }
				placing.foot = nil
			end
			return true
		elseif button == 3 then
			stopPlacing()
			return true
		end
		return false
	end
	if button == 3 then
		return clickPlan(x, y)
	end
	return false
end

function widget:MouseMove(x, y)
	if picking and picking.from then
		picking.to = groundUnder(x, y) or picking.to
		return
	end
	if not drag then
		return
	end
	local dx, dy = x - drag.x, y - drag.y
	if not drag.moved then
		-- 4 is the engine's own default, in rts/Game/UI/MouseHandler.cpp.
		local slop = Spring.GetConfigInt("MouseDragSelectionThreshold", 4)
		if dx * dx + dy * dy <= slop * slop then
			return
		end
		drag.moved = true
		-- the drag starts from where the panel is drawn, which takes the
		-- place of the offset that moved it there
		panel.nudge = 0
	end
	MODEL.drag(panel, drag.box, drag.right, dx, dy, { w = vsx, h = vsy })
end

function widget:MouseRelease()
	if picking then
		local from, to = picking.from, picking.to
		picking = nil
		if from and to then
			saveGround(from.x, from.z, to.x, to.z)
		else
			say("Save ground needs a drag on the map")
		end
		return true
	end
	if placing and placing.line then
		trackCursor()
		placeNow()
		return true
	end
	if not drag then
		return false
	end
	local moved = drag.moved
	drag = nil
	if moved then
		relayout()
		MODEL.settle(panel, layout, { w = vsx, h = vsy })
	else
		toggle()
	end
	return true
end

function widget:MouseWheel(up, value)
	if not (layout and panel.open) then
		return false
	end
	local mx, my = Spring.GetMouseState()
	if not MODEL.hit(layout, mx, my) then
		return false
	end
	MODEL.turnPage(panel, up and -1 or 1)
	return true
end

local KEY_ESCAPE = 27

-- The widget's own actions run from KeyPress when the widget handler has
-- not run them. Splinter Faction's handler calls actionHandler:KeyAction without the
-- key's bound actions, so no key bound to a widget action reaches it, and
-- the engine runs the key's first engine action instead. A handler that does
-- route a key has run the action already and stopped the key there.
--- The engine's name for a key press with its modifiers, as a bind uses it.
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
	if picking and key == KEY_ESCAPE then
		picking = nil
		say("Save ground cancelled")
		return true
	end
	if placing and key == KEY_ESCAPE then
		stopPlacing()
		return true
	end
	local set = keySet(key, mods)
	if not set then
		return false
	end
	for _, action in ipairs(Spring.GetKeyBindings(set) or {}) do
		local run = keyActions[action.command]
		if run and (not isRepeat or action.command == ACTION_LEFT or action.command == ACTION_RIGHT) and run() then
			return true
		end
	end
	return false
end

--------------------------------------------------------------------------------
-- Drawing
--------------------------------------------------------------------------------

local function colourCode(c)
	return string.char(255, math.floor(c[1] * 254) + 1, math.floor(c[2] * 254) + 1, math.floor(c[3] * 254) + 1)
end

function relayout()
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
			gl.Uniform(locPicRadius, pic.radius)
			quadVAO:DrawElements(GL.TRIANGLES, 6, 0)
		end
		gl.Uniform(locPicRadius, 0)
		gl.Texture(0, false)
		gl.UniformInt(locUseTex, 0)
	end
	gl.UseShader(0)
	for _, t in ipairs(layout.texts) do
		local drop = capHeight * t.size / 2
		if t.rotate then
			gl.PushMatrix()
			gl.Translate(t.x, t.y, 0)
			gl.Rotate(t.rotate, 0, 0, 1)
			gl.Text(colourCode(t.color) .. t.text, 0, -drop, t.size, "x")
			gl.PopMatrix()
		else
			gl.Text(colourCode(t.color) .. t.text, t.x, t.y - drop, t.size, "x")
		end
	end
	-- each terrain step's change in elmos, small and white with a dark outline,
	-- over the middle of its top
	local size = MODEL.SMALL * MODEL.scaleFor(panel, { w = vsx, h = vsy })
	local color = colourCode({ 1, 1, 1 })
	for _, label in ipairs(stepLabels) do
		local sx, sy = Spring.WorldToScreenCoords(label.x, label.y, label.z)
		if sx and sx >= 0 and sx <= vsx and sy >= 0 and sy <= vsy then
			gl.Text(color .. label.text, sx, sy, size, "xco")
		end
	end
end

--- How a mark on the ground looks: the colour of what the building does, as
-- in the panel's layout maps, striped when the ground refuses it, and
-- outlined or crossed out while the cursor is over its plan.
local markColors = {}
local function markStyle(p)
	if p.color then
		return p.color, 0
	end
	local c = markColors[p.defID]
	if not c then
		local base = MODEL.categoryColor(p.def)
		c = { base[1], base[2], base[3], 0.3 }
		markColors[p.defID] = c
	end
	return c, ((p.blocked or p.onSlope) and MODEL.MARK_REFUSED or 0) + (hover.marks[p] or 0)
end

--- One translucent model. It comes out in the team's colour whatever gl.Color
-- says, because the model shader takes its tint from the team handler, so the
-- mark on the ground under it is what says what it is and whether it fits.
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

-- How far from its position the footprint of the biggest building that stays
-- put reaches, so a rectangle search finds every building whose footprint is
-- in it. Read once.
local structureHalf = nil

--- The buildings standing in a rectangle, as Zero-K's terraform gadget counts
-- them: every unit that cannot move, unless it is a building that moves.
-- Slopes stop short of these. Only the units the player can see are listed.
local function standingStructures(minX, minZ, maxX, maxZ)
	if not structureHalf then
		structureHalf = 0
		for _, def in pairs(UnitDefs) do
			if def.isImmobile then
				structureHalf = math.max(structureHalf, math.max(def.xsize, def.zsize) * 4)
			end
		end
	end
	local out = {}
	for _, unitID in ipairs(Spring.GetUnitsInRectangle(minX - structureHalf, minZ - structureHalf, maxX + structureHalf, maxZ + structureHalf) or {}) do
		local def = UnitDefs[Spring.GetUnitDefID(unitID) or -1]
		if def and def.isImmobile and not (def.customParams and def.customParams.mobilebuilding) then
			local x, _, z = Spring.GetUnitPosition(unitID)
			out[#out + 1] = { x = x, z = z, xsize = def.xsize, zsize = def.zsize, facing = Spring.GetUnitBuildFacing(unitID) or 0 }
		end
	end
	return out
end

--- What the ground model reads: the heightmap, the size of the map, the
-- buildings standing now, and the game's terraform cost multiplier.
local function groundEnv()
	return {
		heightAt = Spring.GetGroundHeight,
		corners = { x = Game.mapSizeX / 8 + 1, z = Game.mapSizeZ / 8 + 1 },
		structures = standingStructures,
		costMult = tonumber((Spring.GetModOptions() or {}).terracostmult) or 1,
	}
end

--- Refill the ground buffer when the marked positions change.
local function groundMarks(foot, key)
	if groundKey ~= key then
		groundKey = key
		local verts, idx = MODEL.packGround(foot, markStyle, Spring.GetGroundHeight)
		groundIndices = upload(groundSet, verts, idx)
	end
end

-- The colour of the rectangle Save ground is dragging.
local PICK_COLOR = { 1, 1, 1, 0.15 }

function widget:DrawWorld()
	local foot = placing and placing.foot
	-- the rectangle being dragged, as one mark spanning it
	local pick
	if picking and picking.from and picking.to then
		local a, b = picking.from, picking.to
		local w, h = math.max(8, math.abs(b.x - a.x)), math.max(8, math.abs(b.z - a.z))
		pick = { x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, facing = 0, def = { xsize = w / 4, zsize = h / 4 }, color = PICK_COLOR }
	end
	if not foot and #plans == 0 and not pick then
		stepLabels, terrainMesh = {}, nil
		return
	end
	local teamID = Spring.GetMyTeamID()
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)

	-- the plans' marks and the cursor's in one buffer, rebuilt when either
	-- changes
	-- the cursor's terrain steps are outlined only when they would be ordered
	local showSteps = foot and can.terraformAvailable == true and panel.terrain
	local key = "plans:" .. plansSerial .. ":hover:" .. hover.key .. (foot and (":cursor:" .. placing.serial .. (showSteps and ":steps" or "")) or "")
		.. (pick and (":pick:" .. pick.x .. ":" .. pick.z .. ":" .. pick.def.xsize .. ":" .. pick.def.zsize) or "")
	if groundKey ~= key then
		local marks = {}
		for _, plan in ipairs(plans) do
			for _, p in ipairs(plan.positions) do
				marks[#marks + 1] = p
			end
		end
		for _, p in ipairs(foot or {}) do
			marks[#marks + 1] = p
		end
		-- the ground every plan and the cursor leave, one after the other
		local groups = {}
		for _, plan in ipairs(plans) do
			groups[#groups + 1] = { steps = plan.steps, foot = plan.positions }
		end
		if showSteps then
			groups[#groups + 1] = { steps = placing.steps or {}, foot = foot, cursor = true }
		end
		local steps = {}
		local session = TERRAFORM.session(groundEnv())
		local cursor = nil
		for _, group in ipairs(groups) do
			local before, workBefore = session.metal, session.work
			local results = group.steps[1] and session.apply(group.steps, group.foot) or {}
			if group.cursor then
				cursor = { metal = session.metal - before, work = session.work - workBefore }
			end
			for _, step in ipairs(group.steps) do
				steps[#steps + 1] = step
			end
			-- a building that would stand on a slope is marked like one the
			-- ground refuses
			local on = TERRAFORM.onSlope(results, group.foot)
			for i, p in ipairs(group.foot) do
				p.onSlope = on[i]
			end
		end
		if not showSteps then
			for _, p in ipairs(foot or {}) do
				p.onSlope = nil
			end
		end
		marks[#marks + 1] = pick
		groundMarks(marks, key)
		terrainMesh = TERRAIN.mesh(session.changed(), Spring.GetGroundHeight)
		terrainMesh.indices = uploadMesh(terrainSet, terrainMesh.verts, terrainMesh.idx)
		stepLabels = PLACE.labels(steps)
		-- the panel's cost counts the terraform being placed
		if placing then
			local was = placing.terra
			if (was and was.metal or 0) ~= (cursor and cursor.metal or 0) or (was and was.work or 0) ~= (cursor and cursor.work or 0) then
				placing.terra = cursor
				readCost()
			end
		end
	end
	-- The marks follow the heightmap, but the terrain the engine draws is
	-- simplified with distance, so a depth test would still let it cut them.
	gl.DepthTest(false)
	if groundIndices > 0 and groundSet.vao then
		gl.UseShader(shader)
		gl.UniformMatrix(locProj, "projection")
		gl.UniformMatrix(locView, "view")
		gl.Uniform(locRect, unpack(UNIT_RECT))
		gl.UniformInt(locUseTex, 0)
		gl.UniformInt(locGround, 1)
		gl.Uniform(locBlocked, unpack(MODEL.COLORS.blocked))
		groundSet.vao:DrawElements(GL.TRIANGLES, groundIndices, 0)
		gl.UniformInt(locGround, 0)
		gl.UseShader(0)
	end

	-- The terrain steps: a grid on the ground, then the volumes. Raised ground
	-- is drawn with the depth test and no depth writes, so it is seen only where
	-- nothing stands in front of it and never hides a unit. Dug ground is under
	-- the terrain, so it is drawn through it.
	if terrainMesh and terrainMesh.indices and terrainMesh.indices > 0 and terrainSet.vao then
		local m = terrainMesh
		local vao = terrainSet.vao
		local downFaces = m.faces + m.wire
		local grid = downFaces + m.downFaces + m.downWire
		gl.UseShader(shader)
		gl.UniformMatrix(locProj, "projection")
		gl.UniformMatrix(locView, "view")
		gl.Uniform(locRect, unpack(UNIT_RECT))
		gl.UniformInt(locUseTex, 0)
		gl.UniformInt(locGround, 2)
		gl.LineWidth(1)
		if m.grid > 0 then
			vao:DrawElements(GL.LINES, m.grid, grid)
		end
		gl.DepthTest(true)
		gl.DepthMask(false)
		if m.faces > 0 then
			vao:DrawElements(GL.TRIANGLES, m.faces, 0)
		end
		if m.wire > 0 then
			vao:DrawElements(GL.LINES, m.wire, m.faces)
		end
		gl.DepthTest(false)
		if m.downFaces > 0 then
			vao:DrawElements(GL.TRIANGLES, m.downFaces, downFaces)
		end
		if m.downWire > 0 then
			vao:DrawElements(GL.LINES, m.downWire, downFaces + m.downFaces)
		end
		gl.DepthMask(true)
		gl.UniformInt(locGround, 0)
		gl.UseShader(0)
	end

	gl.DepthTest(true)

	if foot then
		for _, p in ipairs(foot) do
			ghost(p, teamID)
		end
	end
	for _, plan in ipairs(plans) do
		for _, p in ipairs(plan.positions) do
			ghost(p, teamID)
		end
	end
	gl.DepthTest(false)
end
