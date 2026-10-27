-- The panel: what it holds and where everything goes.
--
-- Pure. The widget hands in the store's entries, the selection's capabilities
-- and a text measurer, and gets back the tabs and counts, then a layout of
-- rectangles, texts, build pictures and click targets in screen coordinates
-- with the origin at the bottom left, which is what DrawScreen and MousePress
-- both use. pack() turns the rectangles into the flat arrays the widget
-- uploads to a vertex buffer, so nothing here needs gl.

local M = {}

M.WIDTH = 300
M.PAD = 8
M.GAP = 4
M.ROW = 50
M.HEADER = 30
M.LINE = 24
M.FOOTER = 32
M.MAX_ROWS = 10
--- The panel never shrinks below this many rows, so one entry does not make
-- a sliver and an empty tab has room to explain itself.
M.MIN_ROWS = 3
M.PIC = 26
M.PICS = 3
M.FONT = 12
M.SMALL = 10
M.RADIUS = 8
M.CARD_RADIUS = 5
M.PIC_RADIUS = 4
M.BUTTON_RADIUS = 4
--- Tiles across the grid view.
M.GRID_COLUMNS = 4
-- The panel that opens beside the main one while a blueprint is placed.
M.TRAY_WIDTH = 210
--- A dragged box closer than this to an edge of the view snaps flush to it.
M.SNAP = 24
--- The sizes above are for a view this many pixels tall. The panel scales
-- with the view's height, so it covers the same share of any screen.
M.BASE_HEIGHT = 1080
--- One heightmap square in elmos, SQUARE_SIZE in the engine.
M.HEIGHT_SQUARE = 8
--- Floats per vertex in pack(): position 3, uv 2, colour 4, shape 4.
M.STRIDE = 13

local C = {
	panel = { 0.07, 0.08, 0.10, 0.94 },
	card = { 0.12, 0.13, 0.16, 1 },
	cardActive = { 0.18, 0.19, 0.23, 1 },
	cardNever = { 0.09, 0.10, 0.12, 1 },
	pill = { 0.16, 0.18, 0.22, 1 },
	pillActive = { 0.22, 0.52, 0.60, 1 },
	button = { 0.16, 0.18, 0.22, 1 },
	gold = { 0.93, 0.76, 0.25, 1 },
	map = { 0.05, 0.06, 0.07, 1 },
	building = { 0.45, 0.66, 0.74, 1 },
	-- raised and dug ground in a layout's map, the blue and neutral grey the
	-- plan in coilbox and on the website draw them in
	raised = { 0.23, 0.51, 0.96, 1 },
	dug = { 0.64, 0.64, 0.64, 1 },
	energy = { 0.95, 0.80, 0.25, 1 },
	builder = { 0.40, 0.80, 0.40, 1 },
	weapon = { 0.90, 0.33, 0.28, 1 },
	-- a purer red than weapon's, for the dashed rim of a mark the ground refuses
	blocked = { 1.0, 0.05, 0.10, 1 },
	text = { 1, 1, 1, 1 },
	title = { 0.66, 0.68, 0.72, 1 },
	dim = { 0.72, 0.74, 0.78, 1 },
	faint = { 0.5, 0.5, 0.55, 1 },
	warn = { 1, 0.75, 0.4, 1 },
}
M.COLORS = C
-- How much colour a terrain step's fill, outline and arrow take, as the plan
-- in coilbox draws them.
M.TERRAIN_FILL = 0.3
M.TERRAIN_OUTLINE = 0.62
M.TERRAIN_START = 0.85

local TITLE = "BLUEPRINTS"
local TABS_LIST = { "now", "partly", "all" }
local TAB_LABELS = { now = "Now", partly = "Partly", all = "All" }
local SOURCE_TAGS = { library = "coilbox", spool = "saved", bar = "BAR" }
-- Arrows for the pager, as steps of bars in a unit square, pointing right and
-- left.
local ARROW_NEXT = { { 0.36, 0.28, 0.1, 0.44 }, { 0.46, 0.36, 0.1, 0.28 }, { 0.56, 0.44, 0.1, 0.12 } }
local ARROW_PREV = { { 0.54, 0.28, 0.1, 0.44 }, { 0.44, 0.36, 0.1, 0.28 }, { 0.34, 0.44, 0.1, 0.12 } }

--- A fresh, closed panel. scale nil follows the view's height, and pos nil
-- puts it at the right edge, vertically centred.
function M.new()
	return {
		open = false,
		tab = "now",
		view = "list",
		-- the keys bound to the widget's actions, by action, for the hints
		keys = {},
		scale = nil,
		pos = nil,
		page = 0,
		items = {},
		counts = { now = 0, partly = 0, all = 0 },
		hasBuilders = false,
		-- "help": every builder takes every building and they help each other.
		-- "split": each building goes to one builder, for games that stop
		-- builders helping
		assist = "help",
		-- whether a blueprint's terrain changes are placed with its buildings.
		-- Only matters in a match that has terraform.
		terrain = true,
		placing = nil,
		remainder = nil,
		message = nil,
		hover = nil,
		version = 0,
		-- pixels up or down the panel has moved out of another panel's way
		nudge = 0,
	}
end

--- One name per clickable thing, for remembering what the cursor is over.
function M.actionId(action)
	return action.kind .. ":" .. (action.key or action.tab or action.view or action.delta or action.axis or action.mode or "")
end

--- Bump the version so the widget knows to lay out again.
function M.touch(state)
	state.version = state.version + 1
end

--- Whether an entry is for the game being played. No binding is for every
-- game. A shortname decides when there is one, otherwise the full name.
-- @param entry table a store entry
-- @param game table Game, or anything with modName and gameShortName
function M.forGame(entry, game)
	local bound = entry.game
	if bound == nil then
		return true
	end
	if bound.shortname ~= nil then
		return bound.shortname == game.gameShortName
	end
	-- modName, the archive, because that is the name an entry carries. See
	-- record.lua.
	return bound.name == game.modName
end

--- Take a new list of entries and classify them against what the selection
-- can build.
-- @param state table
-- @param entries table[] from the store
-- @param place table the place module, for resolve and classify
-- @param game table Game
-- @param can table from place.capabilities
-- @param side table? { reach, standIns }: what the team can ever build,
--   from place.reach, and what to build in place of what it only gets by
--   morphing, from place.standIns. A layout with anything outside reach is
--   for another side and goes under no tab but All.
function M.refresh(state, entries, place, game, can, side)
	local reach, standIns = side and side.reach, side and side.standIns
	-- whether this match can terraform: what the widget found when nothing is
	-- selected, otherwise whether a selected builder can
	local available = can.terraformAvailable
	if available == nil then
		available = #(can.terraformers or {}) > 0
	end
	local items = {}
	local counts = { now = 0, partly = 0, all = 0 }
	for _, entry in ipairs(entries) do
		if M.forGame(entry, game) then
			local resolved = place.resolve(entry)
			local foreign = place.foreign(resolved, reach)
			local upgrades
			resolved, upgrades = place.substitute(resolved, standIns)
			local tab = foreign > 0 and "never" or place.classify(resolved, can)
			local steps = #(entry.terrain or {})
			-- a layout of steps alone can only be placed when they will be ordered
			local stop
			if steps > 0 and #resolved.buildings == 0 and #resolved.missing == 0 and foreign == 0 then
				if not available then
					stop = "no terraforming here"
				elseif not state.terrain then
					stop = "Terrain is off"
				end
				tab = stop and "never" or "now"
			end
			local placeable = foreign == 0 and (#resolved.buildings > 0 or (steps > 0 and stop == nil and #resolved.missing == 0))
			local item = { entry = entry, resolved = resolved, tab = tab, foreign = foreign, upgrades = upgrades, stop = stop, placeable = placeable }
			item.name = M.displayName(item)
			items[#items + 1] = item
			counts.all = counts.all + 1
			if tab ~= "never" then
				counts[tab] = counts[tab] + 1
			end
		end
	end
	state.items = items
	state.counts = counts
	state.hasBuilders = #can.builders > 0
	M.turnPage(state, 0)
	M.touch(state)
end

--- The items under the current tab, in store order.
function M.visible(state)
	local out = {}
	for _, item in ipairs(state.items) do
		if state.tab == "all" or item.tab == state.tab then
			out[#out + 1] = item
		end
	end
	return out
end

--- How many pages the current tab fills. A page is however many entries
-- the last layout could fit, which the layout records.
function M.pages(state)
	return math.max(1, math.ceil(#M.visible(state) / (state.perPage or M.MAX_ROWS)))
end

--- Turn the page, clamped to the first and last.
function M.turnPage(state, delta)
	local next = math.max(0, math.min(M.pages(state) - 1, state.page + delta))
	if next ~= state.page then
		state.page = next
		M.touch(state)
	end
end

--- Turn to the page holding an entry.
function M.reveal(state, key)
	for i, item in ipairs(M.visible(state)) do
		if item.entry.key == key then
			M.turnPage(state, math.floor((i - 1) / (state.perPage or M.MAX_ROWS)) - state.page)
			return
		end
	end
end

--- The entry a step away from the one being placed, among those under the
-- current tab that have something to place, wrapping at either end. With
-- nothing being placed, a step forward is the first and back the last.
-- @param step integer 1 or -1
-- @return string? the entry's key, nil when there is nothing to step to
function M.step(state, step)
	local keys = {}
	for _, item in ipairs(M.visible(state)) do
		if item.placeable then
			keys[#keys + 1] = item.entry.key
		end
	end
	if #keys == 0 then
		return nil
	end
	local at = step > 0 and 0 or #keys + 1
	for i, key in ipairs(keys) do
		if state.placing and state.placing.key == key then
			at = i
		end
	end
	return keys[(at + step - 1) % #keys + 1]
end

--- How a key reads on a button: a single letter in capitals, anything else
-- as the engine names it, or the fallback when nothing is bound.
function M.keyLabel(list, fallback)
	local key = list and list[1]
	if not key then
		return fallback
	end
	if #key == 1 then
		return key:upper()
	end
	return key
end

--- A time in seconds as minutes and seconds.
function M.clockTime(seconds)
	local whole = math.floor(seconds + 0.5)
	return string.format("%d:%02d", math.floor(whole / 60), whole % 60)
end

--- What placing a layout costs, as the placing panel says it.
-- @param cost table? { metal, energy, seconds }, seconds nil with no builder
function M.costLine(cost)
	if not cost then
		return ""
	end
	local parts = { string.format("%d metal", math.floor(cost.metal + 0.5)), string.format("%d energy", math.floor(cost.energy + 0.5)) }
	if cost.seconds then
		parts[#parts + 1] = M.clockTime(cost.seconds) .. " to build"
	end
	return table.concat(parts, ", ")
end

--- Switch between builders helping each other and splitting the work.
function M.setAssist(state, mode)
	if (mode == "help" or mode == "split") and mode ~= state.assist then
		state.assist = mode
		M.touch(state)
	end
end

--- Turn the placing of terrain changes on or off.
function M.setTerrain(state, on)
	if type(on) == "boolean" and on ~= state.terrain then
		state.terrain = on
		M.touch(state)
	end
end

--- Switch tab and go back to the first page.
function M.setTab(state, tab)
	if TAB_LABELS[tab] and tab ~= state.tab then
		state.tab = tab
		state.page = 0
		M.touch(state)
	end
end

--- Switch between the list and the grid of tiles, and go back to the first
-- page.
function M.setView(state, view)
	if (view == "list" or view == "grid") and view ~= state.view then
		state.view = view
		state.page = 0
		M.touch(state)
	end
end

--- What a building does, for its colour: "builder" for anything that builds
-- or assists, "weapon" for anything armed, "energy" for anything that makes
-- energy, otherwise "other". The first that fits wins.
function M.category(def)
	if def.isBuilder or (def.buildOptions and #def.buildOptions > 0) then
		return "builder"
	end
	if def.weapons and #def.weapons > 0 then
		return "weapon"
	end
	if (def.energyMake or 0) > 0 or (def.windGenerator or 0) > 0 or (def.tidalGenerator or 0) > 0 or (def.energyUpkeep or 0) < 0 then
		return "energy"
	end
	return "other"
end

--- The colour for a building's category.
function M.categoryColor(def)
	local category = M.category(def)
	return category == "other" and C.building or C[category]
end

--- A name that says what a layout holds: each kind of building, most common
-- first, with a count when there is more than one.
-- @param defs table[] unit defs, or anything with a name
function M.contentName(defs)
	local counts, order = {}, {}
	for _, def in ipairs(defs) do
		local label = def.translatedHumanName or def.humanName or def.name
		if not counts[label] then
			order[#order + 1] = label
			counts[label] = 0
		end
		counts[label] = counts[label] + 1
	end
	local rank = {}
	for i, label in ipairs(order) do
		rank[label] = i
	end
	table.sort(order, function(a, b)
		if counts[a] ~= counts[b] then
			return counts[a] > counts[b]
		end
		return rank[a] < rank[b]
	end)
	local parts = {}
	for i, label in ipairs(order) do
		parts[i] = counts[label] > 1 and (counts[label] .. " " .. label) or label
	end
	return table.concat(parts, ", ")
end

--- The name a row shows. Names the widget used to make up, "Base on" a map
-- and a number, and the store's "#" and a number for an unnamed BAR layout,
-- say nothing about the layout, so those show what it holds instead.
function M.displayName(item)
	local name = item.entry.name
	if not (name:match("^Base on .+ %d+$") or name:match("^#%d+$")) then
		return name
	end
	local defs = {}
	for _, b in ipairs(item.resolved.buildings) do
		defs[#defs + 1] = b.def
	end
	for _, missing in ipairs(item.resolved.missing) do
		defs[#defs + 1] = { name = missing }
	end
	return #defs > 0 and M.contentName(defs) or name
end

--- Cut text to fit a width, with an ellipsis.
function M.truncate(text, width, measure, size)
	if measure(text, size) <= width then
		return text
	end
	local lo, hi = 0, #text
	while lo < hi do
		local mid = math.ceil((lo + hi) / 2)
		if measure(text:sub(1, mid) .. "...", size) <= width then
			lo = mid
		else
			hi = mid - 1
		end
	end
	return text:sub(1, lo) .. "..."
end

--- The one line that says what a row is.
local function rowDetail(item)
	local parts = {}
	-- what stops or changes placing goes first, so a narrow row never cuts
	-- it off
	if (item.foreign or 0) > 0 then
		parts[1] = item.foreign .. " from another side"
	elseif item.stop then
		parts[1] = item.stop
	end
	if (item.upgrades or 0) > 0 then
		parts[#parts + 1] = item.upgrades .. " to upgrade"
	end
	parts[#parts + 1] = SOURCE_TAGS[item.entry.source] or item.entry.source
	local n = #item.entry.buildings
	local steps = #(item.entry.terrain or {})
	local count = (n == 0 and steps > 0) and "No buildings" or (n .. (n == 1 and " building" or " buildings"))
	if steps > 0 then
		count = count .. ", " .. steps .. (steps == 1 and " terrain change" or " terrain changes")
	end
	parts[#parts + 1] = count
	if item.entry.ordered then
		parts[#parts + 1] = "ordered"
	end
	if #item.resolved.missing > 0 then
		parts[#parts + 1] = "missing " .. table.concat(item.resolved.missing, ", ")
	end
	return table.concat(parts, " | ")
end

M.rowDetail = rowDetail

--- Up to PICS distinct def ids, in layout order.
local function rowPics(item)
	local out, seen = {}, {}
	for _, b in ipairs(item.resolved.buildings) do
		if not seen[b.defID] then
			seen[b.defID] = true
			out[#out + 1] = b.defID
			if #out == M.PICS then
				break
			end
		end
	end
	return out
end

--- A polygon as triangles by ear clipping, each { a, b, c } going anticlockwise
-- in a y up map. The outline may go either way round and may be concave. An
-- outline that crosses itself has no ears to find, and what is left of it is
-- cut as a fan rather than dropped.
-- @param points table[] { x, y }
function M.triangulate(points)
	local n = #points
	local out = {}
	if n < 3 then
		return out
	end
	local area = 0
	for i = 1, n do
		local a, b = points[i], points[i % n + 1]
		area = area + a.x * b.y - b.x * a.y
	end
	local ring = {}
	for i = 1, n do
		ring[i] = area >= 0 and points[i] or points[n - i + 1]
	end
	local function cross(a, b, c)
		return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
	end
	local function inside(p, a, b, c)
		return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0
	end
	while #ring > 3 do
		local cut = nil
		local m = #ring
		for i = 1, m do
			local a, b, c = ring[(i - 2) % m + 1], ring[i], ring[i % m + 1]
			if cross(a, b, c) > 0 then
				local clear = true
				for j = 1, m do
					local p = ring[j]
					if p ~= a and p ~= b and p ~= c and inside(p, a, b, c) then
						clear = false
						break
					end
				end
				if clear then
					cut = i
					break
				end
			end
		end
		if not cut then
			break
		end
		local m2 = #ring
		out[#out + 1] = { ring[(cut - 2) % m2 + 1], ring[cut], ring[cut % m2 + 1] }
		table.remove(ring, cut)
	end
	for i = 2, #ring - 1 do
		out[#out + 1] = { ring[1], ring[i], ring[i + 1] }
	end
	return out
end

-- Elmos in one build square, and how thick a wall is drawn in them. A wall has
-- no width of its own, only a path, so this is 0.6 of a square, as coilbox and
-- the website draw it (src/hub/terrainDraw.ts).
local BUILD_SQUARE = 16
M.WALL_THICKNESS = 0.6 * BUILD_SQUARE
-- The size of an uphill arrow's head at most, in elmos.
local ARROW_HEAD = 0.8 * BUILD_SQUARE

--- Which way a step moves the ground, which is all the two shades say.
-- @return string "up" for raised ground, "down" for dug ground, "even" for a
--   step that moves it neither way: a smooth, or a level of height 0
local function toneOf(step)
	local height = step.height or 0
	if step.kind == "ramp" and step.heights then
		height = (step.heights[1] + step.heights[2]) / 2
	end
	return height > 0 and "up" or height < 0 and "down" or "even"
end

--- A terrain step as outlines in elmos from the layout's origin, x to the
-- right and z down the screen, before the map is scaled.
-- @return table kind, shape, tone, points, band, arrow and reach, the ground
--   the mark covers past its points
local function placeStep(step)
	local points = {}
	for i, p in ipairs(step.points) do
		points[i] = { x = p.x, y = p.z }
	end
	local mark = {
		kind = step.kind,
		shape = step.shape,
		tone = toneOf(step),
		points = points,
		reach = step.shape == "wall" and M.WALL_THICKNESS / 2 or 0,
	}
	if step.kind ~= "ramp" or #points < 2 or not step.heights then
		return mark
	end
	-- a ramp is a path of two points with a width on the ground, so the band is
	-- the line between them pushed out half the width either side
	local from, to = points[1], points[2]
	local half = (step.width or 0) / 2
	local length = math.sqrt((to.x - from.x) ^ 2 + (to.y - from.y) ^ 2)
	local ax, ay = 1, 0
	if length > 0 then
		ax, ay = (to.x - from.x) / length, (to.y - from.y) / length
	end
	local cx, cy = -ay, ax
	mark.band = {
		{ x = from.x + cx * half, y = from.y + cy * half },
		{ x = to.x + cx * half, y = to.y + cy * half },
		{ x = to.x - cx * half, y = to.y - cy * half },
		{ x = from.x - cx * half, y = from.y - cy * half },
	}
	mark.reach = 0
	local low, high = step.heights[1], step.heights[2]
	if low ~= high then
		-- along the middle of the band towards the higher end, starting and
		-- stopping a fifth of the way in so it stays inside the band
		local uphill = high > low and 1 or -1
		local start, finish = from, to
		if uphill < 0 then
			start, finish = to, from
		end
		local function at(t)
			return { x = start.x + (finish.x - start.x) * t, y = start.y + (finish.y - start.y) * t }
		end
		local tail, tip = at(0.2), at(0.8)
		local head = math.min(ARROW_HEAD, length * 0.3)
		local bx, by = tip.x - ax * uphill * head, tip.y - ay * uphill * head
		mark.arrow = {
			tail,
			tip,
			{ x = bx + cx * head * 0.6, y = by + cy * head * 0.6 },
			{ x = bx - cx * head * 0.6, y = by - cy * head * 0.6 },
		}
	end
	return mark
end

--- Where each building sits in a size by size map of the layout: its
-- footprint at its offset, x to the right and z down the screen, the way the
-- map is seen from above. The layout is scaled to fit and centred. The frame
-- covers the terrain steps as well as the buildings, so a layout of steps and
-- no buildings fills its map.
-- @param resolved table the layout's buildings
-- @param size number the map's side
-- @param terrain table[]? the layout's steps
-- @return table[] { x, y, w, h } per building from the map's bottom left corner
-- @return table[] per step the same outline as placeStep, scaled and flipped
--   the same way, with the thickness of a wall if it is one
function M.layoutMap(resolved, size, terrain)
	local boxes = {}
	local minX, minZ, maxX, maxZ = math.huge, math.huge, -math.huge, -math.huge
	for _, b in ipairs(resolved.buildings) do
		local hw, hd = M.halfSpan(b.def, b.facing)
		local box = { x0 = b.offset.x - hw, x1 = b.offset.x + hw, z0 = b.offset.z - hd, z1 = b.offset.z + hd }
		boxes[#boxes + 1] = box
		minX, maxX = math.min(minX, box.x0), math.max(maxX, box.x1)
		minZ, maxZ = math.min(minZ, box.z0), math.max(maxZ, box.z1)
	end
	local steps = {}
	for i, step in ipairs(terrain or {}) do
		local mark = placeStep(step)
		steps[i] = mark
		for _, p in ipairs(mark.band or mark.points) do
			minX, maxX = math.min(minX, p.x - mark.reach), math.max(maxX, p.x + mark.reach)
			minZ, maxZ = math.min(minZ, p.y - mark.reach), math.max(maxZ, p.y + mark.reach)
		end
	end
	local out, marks = {}, {}
	if #boxes == 0 and #steps == 0 then
		return out, marks
	end
	local spanX, spanZ = maxX - minX, maxZ - minZ
	local scale = size / math.max(spanX, spanZ)
	local ox, oz = (size - spanX * scale) / 2, (size - spanZ * scale) / 2
	for i, box in ipairs(boxes) do
		out[i] = {
			x = ox + (box.x0 - minX) * scale,
			y = size - oz - (box.z1 - minZ) * scale,
			w = (box.x1 - box.x0) * scale,
			h = (box.z1 - box.z0) * scale,
		}
	end
	local function mapped(list)
		if not list then
			return nil
		end
		local moved = {}
		for i, p in ipairs(list) do
			moved[i] = { x = ox + (p.x - minX) * scale, y = size - oz - (p.y - minZ) * scale }
		end
		return moved
	end
	for i, mark in ipairs(steps) do
		marks[i] = {
			kind = mark.kind,
			shape = mark.shape,
			tone = mark.tone,
			points = mapped(mark.points),
			band = mapped(mark.band),
			arrow = mapped(mark.arrow),
			thickness = mark.shape == "wall" and M.WALL_THICKNESS * scale or nil,
		}
	end
	return out, marks
end

local function emptyText(state)
	if #state.items == 0 then
		return "No blueprints for this game. Make one in coilbox, or save a selection."
	end
	if state.tab ~= "all" and not state.hasBuilders then
		return "Select a builder to see what it can build."
	end
	return "Nothing under this tab."
end

--- The scale the panel is drawn at for a view.
function M.scaleFor(state, view)
	return state.scale or view.h / M.BASE_HEIGHT
end

--- Whether a saved position is one the layout can use.
function M.validPos(pos)
	return type(pos) == "table"
		and type(pos.x) == "number"
		and type(pos.y) == "number"
		and pos.x >= 0
		and pos.x <= 1
		and pos.y >= 0
		and pos.y <= 1
		and type(pos.right) == "boolean"
end

--- Where a box of w by h goes. With no position it sits at the right edge,
-- vertically centred. Otherwise it hangs from a top corner kept as fractions
-- of the view, the right corner when pos.right is set. Either way it stays
-- inside the view.
local function placeBox(state, view, w, h, margin)
	local x, y
	local pos = state.pos
	if pos then
		x = pos.right and pos.x * view.w - w or pos.x * view.w
		y = pos.y * view.h - h
	else
		x = view.w - margin - w
		y = (view.h - h) / 2
	end
	-- moved up or down out of another panel's way, see M.clearOffset
	y = y + (state.nudge or 0)
	x = math.max(0, math.min(view.w - w, x))
	y = math.max(0, math.min(view.h - h, y))
	return math.floor(x), math.floor(y)
end

--- How far to move a box up or down so that no other panel covers it. Each
-- offset is tried nearest first, a step at a time, as far as the box stays
-- in the view. The box is sampled a step apart, inset from its edges, and
-- covered(x, y) says whether something else is drawn at a point. With no
-- clear place it keeps the offset that leaves least of it covered,
-- preferring to stay put.
-- @param box table x, y, w, h where the box is with no offset
-- @param viewH number the view's height
-- @param covered function(x, y) -> boolean
-- @param step number pixels between samples and between offsets
-- @return number the offset, 0 when it is clear where it is
function M.clearOffset(box, viewH, covered, step)
	local function hidden(dy)
		local n = 0
		local y0 = box.y + dy
		local cols = math.max(1, math.floor((box.w - 4) / step))
		local rows = math.max(1, math.floor((box.h - 4) / step))
		for i = 0, cols do
			for j = 0, rows do
				if covered(box.x + 2 + i * (box.w - 4) / cols, y0 + 2 + j * (box.h - 4) / rows) then
					n = n + 1
				end
			end
		end
		return n
	end
	local best, bestHidden = 0, hidden(0)
	if bestHidden == 0 then
		return 0
	end
	-- as far as the box can go each way, so the last try sits flush on
	-- the edge rather than a part step short of it
	local up, down = viewH - box.h - box.y, -box.y
	local k = 1
	while true do
		local tried = false
		for _, dy in ipairs({ math.min(k * step, up), math.max(-k * step, down) }) do
			if dy ~= 0 and (k == 1 or math.abs(dy) > (k - 1) * step) then
				tried = true
				local n = hidden(dy)
				if n == 0 then
					return dy
				elseif n < bestHidden then
					best, bestHidden = dy, n
				end
			end
		end
		if not tried then
			return best
		end
		k = k + 1
	end
end

--- Move the box by a drag. box is where it was when the drag began, and the
-- corner it hangs from stays the one it had then, so it does not jump. Near
-- an edge, or past it, the box snaps flush to the edge.
function M.drag(state, box, right, dx, dy, view)
	local snap = M.SNAP * M.scaleFor(state, view)
	local function snapped(lo, size, span)
		if lo < snap then
			return 0
		elseif lo + size > span - snap then
			return span - size
		end
		return lo
	end
	local x = snapped(box.x + dx, box.w, view.w)
	local y = snapped(box.y + dy, box.h, view.h)
	local cx = right and x + box.w or x
	state.pos = { x = cx / view.w, y = (y + box.h) / view.h, right = right }
	M.touch(state)
end

--- After a drag, hang the box from the top corner on its side of the screen,
-- so it opens toward the middle. The box itself does not move.
function M.settle(state, L, view)
	local b = L.box
	local right = b.x + b.w / 2 > view.w / 2
	state.pos = { x = (right and b.x + b.w or b.x) / view.w, y = (b.y + b.h) / view.h, right = right }
	M.touch(state)
end

--- Lay the panel out.
-- @param state table
-- @param measure function(text, size) -> width in pixels
-- @param view table w, h of the screen
-- @return table rects, texts, pics, hits and box. Each rect is { x, y, w, h,
--   color, kind, radius?, border?, key?, active? }, each text { x, y, size,
--   text, color, rotate? } with y the middle of its capitals, each pic { x, y,
--   w, h, radius, defID, row }, each hit { x, y, w, h, action }. box is the
--   opener or the panel, whichever is shown.
function M.layout(state, measure, view)
	local L = { rects = {}, texts = {}, pics = {}, hits = {} }
	local rects, texts, pics, hits = L.rects, L.texts, L.pics, L.hits
	local S = M.scaleFor(state, view)
	local PAD, GAP, W = M.PAD * S, M.GAP * S, M.WIDTH * S
	local ROW, HEADER, LINE, FOOTER = M.ROW * S, M.HEADER * S, M.LINE * S, M.FOOTER * S
	local PIC, FONT, SMALL = M.PIC * S, M.FONT * S, M.SMALL * S
	local PILL = SMALL + 8 * S
	local BR = M.BUTTON_RADIUS * S

	local function hovered(action)
		return state.hover ~= nil and state.hover == M.actionId(action)
	end
	local function lift(color)
		return { math.min(1, color[1] + 0.1), math.min(1, color[2] + 0.1), math.min(1, color[3] + 0.1), color[4] }
	end

	local function rect(x, y, w, h, color, kind, extra)
		local r = { x = x, y = y, w = w, h = h, color = color, kind = kind }
		if extra then
			for k, v in pairs(extra) do
				r[k] = v
			end
		end
		rects[#rects + 1] = r
		return r
	end
	-- y is the middle of the line the text sits on
	local function text(x, y, size, str, color)
		texts[#texts + 1] = { x = x, y = y, size = size, text = str, color = color or C.text }
	end
	local function hit(x, y, w, h, action)
		hits[#hits + 1] = { x = x, y = y, w = w, h = h, action = action }
	end
	local function buttonW(label)
		return measure(label, SMALL) + 2 * PAD
	end
	local function button(x, y, label, action)
		local w = buttonW(label)
		rect(x, y, w, PILL, hovered(action) and lift(C.button) or C.button, "button", { radius = BR })
		text(x + PAD, y + PILL / 2, SMALL, label)
		hit(x, y, w, PILL, action)
	end
	-- a square button holding a small drawing, given as rects inside a unit
	-- square. With no action it is drawn faint and cannot be clicked.
	local function iconButton(x, y, marks, action, active)
		local base = active and C.pillActive or C.button
		rect(x, y, PILL, PILL, action and hovered(action) and lift(base) or base, "button", { radius = BR })
		local ink = active and C.text or action and C.dim or C.faint
		for _, m in ipairs(marks) do
			rect(x + m[1] * PILL, y + m[2] * PILL, m[3] * PILL, m[4] * PILL, ink, "icon", { radius = S })
		end
		if action then
			hit(x, y, PILL, PILL, action)
		end
	end

	local toggle = { kind = "toggle" }

	-- Closed, the panel is a vertical tab that opens it and can be dragged.
	-- The widget turns a text with a rotate field, so the label reads downward.
	if not state.open then
		local w = LINE
		local h = measure(TITLE, SMALL) + 2 * PAD
		local x, y = placeBox(state, view, w, h, PAD)
		rect(x, y, w, h, hovered(toggle) and lift(C.panel) or C.panel, "opener", { radius = BR })
		texts[#texts + 1] = {
			x = x + w / 2,
			y = y + h - PAD,
			size = SMALL,
			text = TITLE,
			color = hovered(toggle) and C.text or C.title,
			rotate = -90,
		}
		hit(x, y, w, h, toggle)
		L.box = { x = x, y = y, w = w, h = h }
		M.layoutTray(state, L, measure, view)
		return L
	end

	local visible = M.visible(state)
	local grid = state.view == "grid"
	local inner = W - 2 * PAD
	local tile = (inner - (M.GRID_COLUMNS - 1) * GAP) / M.GRID_COLUMNS
	-- a line is a row in the list and a row of tiles in the grid
	local perLine = grid and M.GRID_COLUMNS or 1
	local lineH = grid and tile + GAP or ROW

	-- The panel's fixed parts, and however many lines fit under them in the
	-- view. Without the clamp a tall library would push the panel off screen.
	local chrome = HEADER + FOOTER
	if state.remainder then
		chrome = chrome + LINE
	end
	if state.message then
		chrome = chrome + LINE
	end
	if grid then
		-- the strip under the tiles that says what the hovered one holds
		chrome = chrome + ROW
	end
	local fit = math.max(1, math.floor((view.h - 2 * PAD - chrome) / lineH))
	local maxLines = math.min(math.floor(M.MAX_ROWS * ROW / lineH), fit)
	state.perPage = maxLines * perLine

	local lines = math.ceil(#visible / perLine)
	local paged = lines > maxLines
	-- a smaller view or a shorter list can leave the page past the end
	state.page = math.min(state.page, M.pages(state) - 1)
	local firstLine = state.page * maxLines + 1
	local lastLine = math.min(lines, firstLine + maxLines - 1)
	local linesShown = math.max(0, lastLine - firstLine + 1)
	-- The body is at least MIN_ROWS list rows tall whatever it holds, so the
	-- panel keeps its shape as entries come and go, and every page of a long
	-- list is as tall as a full one, so the pager does not move.
	local minLines = math.ceil(M.MIN_ROWS * ROW / lineH)
	local bodyLines = math.min(fit, math.max(minLines, paged and maxLines or linesShown))
	local height = chrome + bodyLines * lineH

	local px, py = placeBox(state, view, W, height, PAD)
	local top = py + height
	local panel = rect(px, py, W, height, C.panel, "panel", { radius = M.RADIUS * S })
	L.box = { x = px, y = py, w = W, h = height }
	local cardX, cardW = px + PAD, inner

	-- header: the collapse button at the right, the tabs left of it, and left
	-- of them the title, which closes the panel on a click and moves it on a
	-- drag
	local y = top - HEADER
	local ty = y + (HEADER - PILL) / 2
	local tx = px + W - PAD - PILL
	iconButton(tx, ty, { { 0.28, 0.44, 0.44, 0.12 } }, { kind = "close" })
	tx = tx - GAP
	for i = #TABS_LIST, 1, -1 do
		local tab = TABS_LIST[i]
		local active = tab == state.tab
		local base = active and C.pillActive or C.pill
		local tabAction = { kind = "tab", tab = tab }
		local label = TAB_LABELS[tab] .. " " .. state.counts[tab]
		local tw = measure(label, SMALL) + 2 * 6 * S
		tx = tx - tw
		rect(tx, ty, tw, PILL, hovered(tabAction) and lift(base) or base, "tab", { tab = tab, active = active, radius = BR })
		text(tx + 6 * S, ty + PILL / 2, SMALL, label, active and C.text or C.dim)
		hit(tx, ty, tw, PILL, tabAction)
		tx = tx - GAP
	end
	local handleW = tx - px
	text(px + PAD, y + HEADER / 2, FONT, M.truncate(TITLE, handleW - 2 * PAD, measure, FONT), hovered(toggle) and C.text or C.title)
	hit(px, y, handleW, HEADER, toggle)

	-- remainder
	if state.remainder then
		y = y - LINE
		local n = state.remainder.count
		local dismissW, placeW = buttonW("Dismiss"), buttonW("Place")
		text(px + PAD, y + LINE / 2, SMALL, n .. " left to build", C.warn)
		button(px + W - PAD - dismissW - GAP - placeW, y + (LINE - PILL) / 2, "Place", { kind = "remainder" })
		button(px + W - PAD - dismissW, y + (LINE - PILL) / 2, "Dismiss", { kind = "dismiss" })
	end

	local function isActive(item)
		return state.placing ~= nil and state.placing.key == item.entry.key
	end
	local function cardColor(item, action)
		local color = C.card
		if isActive(item) then
			color = C.cardActive
		elseif item.tab == "never" then
			color = C.cardNever
		end
		return action and hovered(action) and lift(color) or color
	end
	-- a filled shape of corners, given as { x, y } going round, with a box round
	-- it for anything that wants one
	local function shape(corners, color, kind)
		local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
		for _, c in ipairs(corners) do
			x0, y0, x1, y1 = math.min(x0, c[1]), math.min(y0, c[2]), math.max(x1, c[1]), math.max(y1, c[2])
		end
		rect(x0, y0, x1 - x0, y1 - y0, color, kind, { corners = corners })
	end
	-- a line from a to b of the given thickness, square at both ends and
	-- reaching `reach` past them
	local function line(a, b, thickness, reach, color, ox, oy)
		local dx, dy = b.x - a.x, b.y - a.y
		local length = math.sqrt(dx * dx + dy * dy)
		local ux, uy = 1, 0
		if length > 0 then
			ux, uy = dx / length, dy / length
		end
		local h = thickness / 2
		local px, py = -uy * h, ux * h
		local ax, ay = ox + a.x - ux * reach, oy + a.y - uy * reach
		local bx, by = ox + b.x + ux * reach, oy + b.y + uy * reach
		shape({ { ax - px, ay - py }, { bx - px, by - py }, { bx + px, by + py }, { ax + px, ay + py } }, color, "terrain")
	end
	local function outline(points, closed, thickness, color, ox, oy)
		local n = #points
		for i = 1, closed and n or n - 1 do
			line(points[i], points[i % n + 1], thickness, thickness / 2, color, ox, oy)
		end
	end
	local function filled(points, color, ox, oy)
		for _, tri in ipairs(M.triangulate(points)) do
			local a, b, c = tri[1], tri[2], tri[3]
			-- a triangle is a quad with its last corner twice
			shape({ { ox + a.x, oy + a.y }, { ox + b.x, oy + b.y }, { ox + c.x, oy + c.y }, { ox + c.x, oy + c.y } }, color, "terrain")
		end
	end
	local function faded(color, alpha, dim)
		local k = dim and 0.45 or 1
		return { color[1] * k, color[2] * k, color[3] * k, color[4] * alpha }
	end
	-- one terrain step, under the buildings. An area is a filled outline, a wall
	-- is a thick line and a ramp is a band with an arrow pointing uphill. Raised
	-- ground and dug ground are two shades, and a step that moves the ground
	-- neither way is the grey outline alone, as in coilbox and on the website.
	local function terrainMark(mark, ox, oy, dim)
		local base = mark.tone == "up" and C.raised or C.dug
		local moves = mark.tone ~= "even"
		local line1 = 1.25 * S
		if mark.band then
			if moves then
				filled(mark.band, faded(base, M.TERRAIN_FILL, dim), ox, oy)
			end
			outline(mark.band, true, line1, faded(base, M.TERRAIN_OUTLINE, dim), ox, oy)
			if mark.arrow then
				local arrow = faded(base, M.TERRAIN_START, dim)
				line(mark.arrow[1], mark.arrow[2], 1.5 * S, 0, arrow, ox, oy)
				line(mark.arrow[3], mark.arrow[2], 1.5 * S, 0, arrow, ox, oy)
				line(mark.arrow[4], mark.arrow[2], 1.5 * S, 0, arrow, ox, oy)
			end
		elseif mark.shape == "wall" then
			local alpha = moves and M.TERRAIN_OUTLINE * 0.75 or M.TERRAIN_FILL
			local color = faded(base, alpha, dim)
			if #mark.points == 1 then
				line(mark.points[1], mark.points[1], mark.thickness, mark.thickness / 2, color, ox, oy)
			else
				outline(mark.points, false, mark.thickness, color, ox, oy)
			end
		else
			if moves then
				filled(mark.points, faded(base, M.TERRAIN_FILL, dim), ox, oy)
			end
			outline(mark.points, true, line1, faded(base, M.TERRAIN_OUTLINE, dim), ox, oy)
		end
	end
	-- the layout from above, so its shape shows before it is placed, each
	-- building in the colour of what it does and the terrain steps under them
	local function layoutMap(item, x, y, size)
		rect(x, y, size, size, C.map, "map", { radius = M.PIC_RADIUS * S })
		local never = item.tab == "never"
		local edge = math.max(2 * S, size * 0.06)
		local boxes, marks = M.layoutMap(item.resolved, size - 2 * edge, item.entry.terrain)
		for _, mark in ipairs(marks) do
			terrainMark(mark, x + edge, y + edge, never)
		end
		-- a pixel's gap between neighbours, so touching buildings stay apart
		for n, box in ipairs(boxes) do
			local w, h = math.max(1, box.w - S), math.max(1, box.h - S)
			local fill = M.categoryColor(item.resolved.buildings[n].def)
			if never then
				fill = { fill[1] * 0.45, fill[2] * 0.45, fill[3] * 0.45, fill[4] }
			end
			rect(x + edge + box.x, y + edge + box.y, w, h, fill, "building", { radius = math.min(w, h) / 4 })
		end
	end
	-- a list row: the map, the name and what it holds, and build pictures
	local function card(item, i, x, y, w, h, action)
		local active = isActive(item)
		local radius = M.CARD_RADIUS * S
		rect(x, y, w, h, cardColor(item, action), "row", { key = item.entry.key, active = active, radius = radius })
		-- the strip under the grid shows a card it cannot click, with no outline
		if active and action then
			rect(x, y, w, h, C.gold, "outline", { radius = radius, border = 1.5 * S })
		end
		local inset = 6 * S
		local mapSize = h - 2 * inset
		layoutMap(item, x + inset, y + inset, mapSize)
		local picsW = M.PICS * (PIC + GAP)
		local textX = x + inset + mapSize + inset
		local nameW = x + w - inset - picsW - textX
		text(textX, y + h - inset - FONT / 2, FONT, M.truncate(item.name, nameW, measure, FONT), item.tab == "never" and C.faint or C.text)
		text(textX, y + inset + SMALL / 2, SMALL, M.truncate(rowDetail(item), nameW, measure, SMALL), C.dim)
		local defIDs = rowPics(item)
		for p, defID in ipairs(defIDs) do
			pics[#pics + 1] = {
				x = x + w - inset + GAP - (#defIDs - p + 1) * (PIC + GAP),
				y = y + (h - PIC) / 2,
				w = PIC,
				h = PIC,
				radius = M.PIC_RADIUS * S,
				defID = defID,
				row = i,
			}
		end
		if action then
			hit(x, y, w, h, action)
		end
	end

	local bodyTop = y
	if linesShown == 0 then
		text(px + PAD, bodyTop - ROW / 2, SMALL, M.truncate(emptyText(state), inner, measure, SMALL), C.dim)
	end
	for line = firstLine, lastLine do
		y = y - lineH
		for col = 1, perLine do
			local i = (line - 1) * perLine + col
			local item = visible[i]
			if not item then
				break
			end
			local action = { kind = "place", key = item.entry.key }
			if grid then
				local x = cardX + (col - 1) * (tile + GAP)
				local active = isActive(item)
				local radius = M.CARD_RADIUS * S
				rect(x, y, tile, tile, cardColor(item, action), "tile", { key = item.entry.key, active = active, radius = radius })
				local inset = 4 * S
				layoutMap(item, x + inset, y + inset, tile - 2 * inset)
				if active then
					rect(x, y, tile, tile, C.gold, "outline", { radius = radius, border = 1.5 * S })
				end
				hit(x, y, tile, tile, action)
			else
				card(item, i, cardX, y, cardW, ROW - GAP, action)
			end
		end
	end
	y = bodyTop - bodyLines * lineH

	-- in the grid, what the hovered or placing tile holds, as a list row
	if grid then
		y = y - ROW
		local shown
		for _, item in ipairs(visible) do
			if hovered({ kind = "place", key = item.entry.key }) then
				shown = item
			elseif isActive(item) and not shown then
				shown = item
			end
		end
		if shown then
			card(shown, 0, cardX, y, cardW, ROW - GAP, nil)
		else
			rect(cardX, y, cardW, ROW - GAP, C.cardNever, "info", { radius = M.CARD_RADIUS * S })
		end
	end

	-- message
	if state.message then
		y = y - LINE
		text(px + PAD, y + LINE / 2, SMALL, M.truncate(state.message, inner, measure, SMALL), C.warn)
	end

	-- footer: save on the left, the list and grid switch on the right
	local by = py + (FOOTER - PILL) / 2
	button(px + PAD, by, "Save selection", { kind = "save" })
	local gx = px + W - PAD - PILL
	iconButton(gx, by, {
		{ 0.25, 0.25, 0.22, 0.22 },
		{ 0.53, 0.25, 0.22, 0.22 },
		{ 0.25, 0.53, 0.22, 0.22 },
		{ 0.53, 0.53, 0.22, 0.22 },
	}, { kind = "view", view = "grid" }, grid)
	iconButton(gx - GAP - PILL, by, {
		{ 0.25, 0.26, 0.5, 0.1 },
		{ 0.25, 0.45, 0.5, 0.1 },
		{ 0.25, 0.64, 0.5, 0.1 },
	}, { kind = "view", view = "list" }, not grid)

	-- pager, left of the view switch, when the tab holds more than a page
	if paged then
		local pages = M.pages(state)
		local label = (state.page + 1) .. " / " .. pages
		local nx = gx - GAP - PILL - 2 * GAP - PILL
		local lw = measure(label, SMALL)
		local lx = nx - GAP - lw
		iconButton(nx, by, ARROW_NEXT, state.page < pages - 1 and { kind = "page", delta = 1 } or nil)
		text(lx, by + PILL / 2, SMALL, label, C.dim)
		iconButton(lx - GAP - PILL, by, ARROW_PREV, state.page > 0 and { kind = "page", delta = -1 } or nil)
	end

	panel.h = top - py
	M.layoutTray(state, L, measure, view)
	return L
end

--- The placing panel, beside the main panel or its tab on the side with more
-- room: the name and Cancel, the cost, the keys that turn, flip and switch
-- the layout, and whether builders help each other or split the work. Every
-- key is a button too, so it works with nothing bound.
function M.layoutTray(state, L, measure, view)
	local placing = state.placing
	if not placing then
		return
	end
	local rects, texts, hits = L.rects, L.texts, L.hits
	local S = M.scaleFor(state, view)
	local PAD, GAP, LINE, HEADER = M.PAD * S, M.GAP * S, M.LINE * S, M.HEADER * S
	local FONT, SMALL = M.FONT * S, M.SMALL * S
	local PILL = SMALL + 8 * S
	local BR = M.BUTTON_RADIUS * S
	local TW = M.TRAY_WIDTH * S
	local TH = HEADER + (placing.terrain and 5 or 4) * LINE + PAD

	local function hovered(action)
		return state.hover ~= nil and state.hover == M.actionId(action)
	end
	local function lift(color)
		return { math.min(1, color[1] + 0.1), math.min(1, color[2] + 0.1), math.min(1, color[3] + 0.1), color[4] }
	end
	local function text(x, y, size, str, color)
		texts[#texts + 1] = { x = x, y = y, size = size, text = str, color = color or C.text }
	end
	local function buttonW(label)
		return math.max(PILL, measure(label, SMALL) + 2 * 6 * S)
	end
	local function button(x, y, label, action, active)
		local w = buttonW(label)
		local base = active and C.pillActive or C.button
		rects[#rects + 1] = { x = x, y = y, w = w, h = PILL, color = hovered(action) and lift(base) or base, kind = "button", radius = BR }
		text(x + 6 * S, y + PILL / 2, SMALL, label, active and C.text or nil)
		hits[#hits + 1] = { x = x, y = y, w = w, h = PILL, action = action }
	end

	local box = L.box
	local right = box.x + box.w / 2 > view.w / 2
	local x = right and box.x - GAP - TW or box.x + box.w + GAP
	x = math.floor(math.max(0, math.min(view.w - TW, x)))
	local y = math.floor(math.max(0, math.min(view.h - TH, box.y + box.h - TH)))
	rects[#rects + 1] = { x = x, y = y, w = TW, h = TH, color = C.panel, kind = "tray", radius = M.RADIUS * S }
	L.tray = { x = x, y = y, w = TW, h = TH }
	local edge = x + TW - PAD

	-- name and Cancel
	local row = y + TH - HEADER
	local cancelX = edge - buttonW("Cancel")
	button(cancelX, row + (HEADER - PILL) / 2, "Cancel", { kind = "cancel" })
	text(x + PAD, row + HEADER / 2, FONT, M.truncate(placing.name or "", cancelX - GAP - x - PAD, measure, FONT))

	-- cost
	row = row - LINE
	text(x + PAD, row + LINE / 2, SMALL, M.truncate(M.costLine(placing.cost), TW - 2 * PAD, measure, SMALL), C.dim)

	-- one labelled row of buttons, lined up on the right
	local keys = state.keys or {}
	local function controls(label, buttons)
		row = row - LINE
		text(x + PAD, row + LINE / 2, SMALL, label, C.dim)
		local bx = edge + GAP
		for _, b in ipairs(buttons) do
			bx = bx - buttonW(b[1]) - GAP
		end
		for _, b in ipairs(buttons) do
			button(bx, row + (LINE - PILL) / 2, b[1], b[2], b[3])
			bx = bx + buttonW(b[1]) + GAP
		end
	end
	local flip = placing.flip or {}
	controls("Turn", {
		{ M.keyLabel(keys.left, "Left"), { kind = "turn", delta = -1 } },
		{ M.keyLabel(keys.right, "Right"), { kind = "turn", delta = 1 } },
	})
	controls("Flip", {
		{ M.keyLabel(keys.flipX, "Across"), { kind = "flip", axis = "x" }, flip.x },
		{ M.keyLabel(keys.flipZ, "Down"), { kind = "flip", axis = "z" }, flip.z },
	})
	controls("Builders", {
		{ "Together", { kind = "assist", mode = "help" }, state.assist ~= "split" },
		{ "Split up", { kind = "assist", mode = "split" }, state.assist == "split" },
	})
	if placing.terrain then
		controls("Terrain", {
			{ "On", { kind = "terrain", mode = "on" }, state.terrain },
			{ "Off", { kind = "terrain", mode = "off" }, not state.terrain },
		})
	end
end

--- What a point is over: the topmost hit, or the panel itself, or nil when
-- the point is outside.
function M.hit(L, x, y)
	for i = #L.hits, 1, -1 do
		local h = L.hits[i]
		if x >= h.x and x < h.x + h.w and y >= h.y and y < h.y + h.h then
			return h.action
		end
	end
	for _, p in ipairs({ L.rects[1], L.tray }) do
		if p and (p == L.tray or p.kind == "panel") and x >= p.x and x < p.x + p.w and y >= p.y and y < p.y + p.h then
			return { kind = "panel" }
		end
	end
	return nil
end

local function quad(verts, idx, v, n, corners, c, shape, i)
	for _, p in ipairs(corners) do
		verts[v + 1], verts[v + 2], verts[v + 3] = p[1], p[2], p[3]
		verts[v + 4], verts[v + 5] = p[4], p[5]
		verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
		verts[v + 10], verts[v + 11], verts[v + 12], verts[v + 13] = shape[1], shape[2], shape[3], shape[4]
		v = v + M.STRIDE
	end
	local base = (i - 1) * 4
	idx[n + 1], idx[n + 2], idx[n + 3] = base, base + 1, base + 2
	idx[n + 4], idx[n + 5], idx[n + 6] = base, base + 2, base + 3
	return v, n + 6
end

--- The shape size a rect with corners is packed with.
M.CORNERS_SHAPE = 100000

--- Flatten rectangles for the vertex buffer. A rect with `corners` (four
-- { x, y } going round) is drawn as that quad, filled, and its x, y, w, h are
-- only the box round it.
-- @param rects table[] x, y, w, h, color, and radius and border if set
-- @return number[] vertices, STRIDE floats each (x, y, z, u, v, r, g, b, a,
--   then the shape w, h, radius, border the shader rounds the corners with),
--   four per rect, bottom left first, anticlockwise, z always 0
-- @return number[] indices, zero based, six per rect
function M.pack(rects)
	local verts, idx = {}, {}
	local v, n = 0, 0
	for i, r in ipairs(rects) do
		local corners, shape
		if r.corners then
			-- a filled shape of four corners, any way round. The shader rounds a
			-- box of the shape's size, so a shape far larger than the quad
			-- leaves its whole area unrounded.
			local c = r.corners
			corners = {
				{ c[1][1], c[1][2], 0, 0, 0 },
				{ c[2][1], c[2][2], 0, 1, 0 },
				{ c[3][1], c[3][2], 0, 1, 1 },
				{ c[4][1], c[4][2], 0, 0, 1 },
			}
			shape = { M.CORNERS_SHAPE, M.CORNERS_SHAPE, 0, 0 }
		else
			corners = {
				{ r.x, r.y, 0, 0, 0 },
				{ r.x + r.w, r.y, 0, 1, 0 },
				{ r.x + r.w, r.y + r.h, 0, 1, 1 },
				{ r.x, r.y + r.h, 0, 0, 1 },
			}
			shape = { r.w, r.h, r.radius or 0, r.border or 0 }
		end
		v, n = quad(verts, idx, v, n, corners, r.color, shape, i)
	end
	return verts, idx
end

--- Elmos from a footprint's centre to its edge along x and z, for a facing.
-- xsize and zsize are in half build squares, so a footprint of xsize 8 is
-- four squares, 64 elmos, and reaches 32 either way.
function M.halfSpan(def, facing)
	local xs, zs = def.xsize, def.zsize
	if facing % 2 == 1 then
		xs, zs = zs, xs
	end
	return xs * 4, zs * 4
end

--- Grid lines across a span: both edges, and every heightmap line between.
local function gridLines(lo, hi)
	local out = { lo }
	local line = (math.floor(lo / M.HEIGHT_SQUARE) + 1) * M.HEIGHT_SQUARE
	while line < hi do
		out[#out + 1] = line
		line = line + M.HEIGHT_SQUARE
	end
	out[#out + 1] = hi
	return out
end

-- Flags a ground mark carries, added together. Refused is striped with a
-- dashed red rim, hovered has a white rim, and a cross says nobody selected
-- can build it.
M.MARK_REFUSED = 1
M.MARK_HOVERED = 2
M.MARK_CANNOT = 4

--- Flatten footprint marks on the ground for the vertex buffer, in world
-- space. Each mark is a grid with a vertex on every heightmap point inside
-- it, at the ground's height there, and each square is split along the
-- diagonal the engine uses (Map/Ground.cpp), so the mark lies on the ground
-- rather than cutting through a slope. The corners are rounded as the
-- buildings in a row's layout map are, and the widget's ground shader reads
-- the shape's last field as the mark's flags, M.MARK_REFUSED and the rest.
-- @param positions table[] from place.footprint
-- @param style function(p) -> rgba, and the mark's flags added together
-- @param heightAt function(x, z) -> the ground's height
-- @return number[] vertices, number[] indices, as M.pack, with uv spanning
--   each whole mark
function M.packGround(positions, style, heightAt)
	local verts, idx = {}, {}
	local v, n, base = 0, 0, 0
	for _, p in ipairs(positions) do
		local hw, hd = M.halfSpan(p.def, p.facing)
		local x0, z0 = p.x - hw, p.z - hd
		local xs, zs = gridLines(x0, p.x + hw), gridLines(z0, p.z + hd)
		local c, flags = style(p)
		local radius, stripe = math.min(hw, hd) / 2, flags or 0
		for _, z in ipairs(zs) do
			for _, x in ipairs(xs) do
				verts[v + 1], verts[v + 2], verts[v + 3] = x, heightAt(x, z), z
				verts[v + 4], verts[v + 5] = (x - x0) / (2 * hw), (z - z0) / (2 * hd)
				verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
				verts[v + 10], verts[v + 11], verts[v + 12], verts[v + 13] = 2 * hw, 2 * hd, radius, stripe
				v = v + M.STRIDE
			end
		end
		local row = #xs
		for j = 0, #zs - 2 do
			for i = 0, row - 2 do
				local a = base + j * row + i
				local b, cc, d = a + 1, a + row, a + row + 1
				idx[n + 1], idx[n + 2], idx[n + 3] = a, b, cc
				idx[n + 4], idx[n + 5], idx[n + 6] = b, d, cc
				n = n + 6
			end
		end
		base = base + row * #zs
	end
	return verts, idx
end

--- A column major orthographic matrix mapping screen pixels to clip space.
function M.ortho(w, h)
	return {
		2 / w, 0, 0, 0,
		0, 2 / h, 0, 0,
		0, 0, -1, 0,
		-1, -1, 0, 1,
	}
end

return M
