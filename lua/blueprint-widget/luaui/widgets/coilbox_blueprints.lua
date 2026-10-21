-- Coilbox blueprints: place a base layout from your library, or save one.
--
-- Installed into the content root by coilbox when the player asks. Change it
-- in the coilbox repository under lua/blueprint-widget/ and install again, or
-- the next update will overwrite the edit.
--
-- The panel lists the blueprints coilbox holds for this game, plus whatever
-- BAR's own blueprints.json has. Pick one and it follows the cursor as ghosts,
-- turned with [ and ], flipped with H and V, placed with a click as build
-- orders to the selected builders. Save selection writes the selected buildings to a spool file that
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
local ACTION_NEXT = "coilbox_blueprints_next"
local ACTION_PREV = "coilbox_blueprints_prev"
local ACTION_FLIP_X = "coilbox_blueprints_flip_x"
local ACTION_FLIP_Z = "coilbox_blueprints_flip_z"

-- Keys bound when the widget loads, each only if the player has bound
-- nothing to its action. The engine binds [ and ] to buildfacing. LuaUI is
-- offered a key's actions before the engine runs them, and these only take
-- the key while a layout is being placed, so the rest of the time it does
-- its usual job. H and V flip, as in Factorio.
local DEFAULT_KEYS = {
	{ ACTION_LEFT, "[" },
	{ ACTION_RIGHT, "]" },
	{ ACTION_PREV, "Shift+[" },
	{ ACTION_NEXT, "Shift+]" },
	{ ACTION_FLIP_X, "h" },
	{ ACTION_FLIP_Z, "v" },
}
-- The defaults this widget bound, to unbind on shutdown.
local boundKeys = {}
-- Each of the widget's actions by name, filled in by Initialize. See KeyPress.
local keyActions = {}

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

--------------------------------------------------------------------------------
-- GL objects
--------------------------------------------------------------------------------

local shader
local locProj, locView, locRect, locUseTex, locPicRadius, locGround, locBlocked
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

-- The height of a capital at size 1. The model puts a text's y at the middle
-- of its capitals, and drawing from the baseline half this below keeps every
-- label in a button centred whatever letters it has.
local capHeight = nil

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

local readCost

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
	local metal, energy, seconds = PLACE.cost(placing.item.resolved, can)
	panel.placing.cost = { metal = metal, energy = energy, seconds = seconds }
	MODEL.touch(panel)
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
	if #item.resolved.buildings == 0 then
		say("Nothing in " .. item.name .. " exists in this game")
		return
	end
	if item.foreign > 0 then
		say(item.name .. " has buildings your side cannot build")
		return
	end
	readKeys()
	placing = { item = item, rotation = 0, flip = { x = false, z = false }, pivot = PLACE.pivot(item.resolved), foot = nil }
	panel.placing = { key = key, name = item.name, rotation = 0, flip = placing.flip }
	readCost()
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
local function trackCursor()
	local mx, my = Spring.GetMouseState()
	local kind, pos = Spring.TraceScreenRay(mx, my, true)
	if kind ~= "ground" or not pos then
		placing.foot = nil
		return
	end
	local resolved = placing.item.resolved
	if not placing.extent then
		placing.extent = { PLACE.extent(resolved, placing.rotation, placing.flip) }
	end
	local ax, az = PLACE.pivotAt(resolved, placing.pivot, placing.rotation, placing.flip, pos[1], pos[3])
	if placing.foot and placing.ax == ax and placing.az == az then
		return
	end
	placing.ax, placing.az = ax, az
	local anchors = { { x = ax, z = az } }
	if placing.line then
		anchors = PLACE.line(placing.line.x, placing.line.z, ax, az, unpack(placing.extent))
	end
	local foot = {}
	for _, at in ipairs(anchors) do
		for _, p in ipairs(PLACE.footprint(resolved, placing.rotation, at.x, at.z, placing.flip, resolved.buildings[placing.pivot].offset)) do
			foot[#foot + 1] = p
		end
	end
	placing.foot = foot
	placing.serial = (placing.serial or 0) + 1
end

local function plansChanged()
	plansSerial = plansSerial + 1
	local count = 0
	for _, plan in ipairs(plans) do
		count = count + #plan.positions
	end
	panel.remainder = count > 0 and { count = count } or nil
	MODEL.touch(panel)
end

local function addPlan(positions)
	if #positions > 0 then
		plans[#plans + 1] = { positions = positions }
		plansChanged()
	end
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
		local what = sent > 0 and " left for another builder" or " planned, right click it with builders to build"
		parts[#parts + 1] = #plan.remainder .. what
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
	local plan = PLACE.plan(placing.foot, can, shiftHeld(), panel.assist)
	local sent = PLACE.issue(plan)
	say(placing.item.name .. ": " .. describe(plan, sent))
	addPlan(plan.remainder)
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
			foot[#foot + 1] = { defID = p.defID, def = p.def, x = p.x, y = p.y, z = p.z, facing = p.facing, blocked = status == 0 }
		end
	end
	local plan = PLACE.plan(foot, can, shiftHeld(), panel.assist)
	local sent = PLACE.issue(plan)
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
		if #plans[i].positions == 0 then
			table.remove(plans, i)
		end
	end
	plansChanged()
end

--- Build every plan with the selection, from the panel's Place button.
local function placeRemainder()
	readSelection()
	local total = { blocked = 0, remainder = {} }
	local sent = 0
	for i = 1, #plans do
		local plan, n = buildPlan(i)
		total.blocked = total.blocked + plan.blocked
		for _, p in ipairs(plan.remainder) do
			total.remainder[#total.remainder + 1] = p
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

local function saveSelection()
	local entry, err = RECORD.selection({ nameFor = MODEL.contentName, now = os.time() })
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
	end
end

--------------------------------------------------------------------------------
-- Callins
--------------------------------------------------------------------------------

function widget:SetConfigData(data)
	saved = data
end

-- Whether builders help each other or split the work, by game, since that
-- depends on the game's rules.
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
	return { seen = true, pos = panel and panel.pos, view = panel and panel.view, assist = assist }
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
	PLACE.use({ Spring = Spring, UnitDefs = UnitDefs, UnitDefNames = UnitDefNames, Game = Game })
	RECORD.use({ Spring = Spring, UnitDefs = UnitDefs, Game = Game })

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
	end
	can = PLACE.capabilities({})

	if not makeGL() then
		widgetHandler:RemoveWidget(self)
		return
	end

	vsx, vsy = Spring.GetViewGeometry()
	capHeight = gl.GetTextHeight("H")

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
	for action, run in pairs(keyActions) do
		widgetHandler:AddAction(action, run, nil, "tp")
	end
	for _, default in ipairs(DEFAULT_KEYS) do
		local action, key = default[1], default[2]
		local current = Spring.GetActionHotKeys(action)
		if not current or #current == 0 then
			Spring.SendCommands("bind " .. key .. " " .. action)
			boundKeys[#boundKeys + 1] = default
		end
	end

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
		flip = flip,
		step = step,
		assist = function(mode)
			MODEL.setAssist(panel, mode)
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
	widgetHandler:RemoveAction(ACTION_TOGGLE)
	widgetHandler:RemoveAction(ACTION_SAVE)
	widgetHandler:RemoveAction(ACTION_LEFT)
	widgetHandler:RemoveAction(ACTION_RIGHT)
	widgetHandler:RemoveAction(ACTION_NEXT)
	widgetHandler:RemoveAction(ACTION_PREV)
	widgetHandler:RemoveAction(ACTION_FLIP_X)
	widgetHandler:RemoveAction(ACTION_FLIP_Z)
	for _, default in ipairs(boundKeys) do
		Spring.SendCommands("unbind " .. default[2] .. " " .. default[1])
	end
	boundKeys = {}
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
	end
	MODEL.drag(panel, drag.box, drag.right, dx, dy, { w = vsx, h = vsy })
end

function widget:MouseRelease()
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
end

--- How a mark on the ground looks: the colour of what the building does, as
-- in the panel's layout maps, striped when the ground refuses it, and
-- outlined or crossed out while the cursor is over its plan.
local markColors = {}
local function markStyle(p)
	local c = markColors[p.defID]
	if not c then
		local base = MODEL.categoryColor(p.def)
		c = { base[1], base[2], base[3], 0.3 }
		markColors[p.defID] = c
	end
	return c, (p.blocked and MODEL.MARK_REFUSED or 0) + (hover.marks[p] or 0)
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

--- Refill the ground buffer when the marked positions change.
local function groundMarks(foot, key)
	if groundKey ~= key then
		groundKey = key
		local verts, idx = MODEL.packGround(foot, markStyle, Spring.GetGroundHeight)
		groundIndices = upload(groundSet, verts, idx)
	end
end

function widget:DrawWorld()
	local foot = placing and placing.foot
	if not foot and #plans == 0 then
		return
	end
	local teamID = Spring.GetMyTeamID()
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)

	-- the plans' marks and the cursor's in one buffer, rebuilt when either
	-- changes
	local key = "plans:" .. plansSerial .. ":hover:" .. hover.key .. (foot and (":cursor:" .. placing.serial) or "")
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
		groundMarks(marks, key)
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
