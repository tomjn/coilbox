-- The panel: what it holds and where everything goes.
--
-- Pure. The widget hands in the store's entries, the selection's capabilities
-- and a text measurer, and gets back the tabs and counts, then a layout of
-- rectangles, texts, build pictures and click targets in screen coordinates
-- with the origin at the bottom left, which is what DrawScreen and MousePress
-- both use. pack() turns the rectangles into the flat arrays the widget
-- uploads to a vertex buffer, so nothing here needs gl.

local M = {}

M.WIDTH = 280
M.PAD = 8
M.GAP = 4
M.ROW = 40
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
--- The sizes above are for a view this many pixels tall. The panel scales
-- with the view's height, so it covers the same share of any screen.
M.BASE_HEIGHT = 1080
--- Floats per vertex in pack(): position 3, uv 2, colour 4, shape 4.
M.STRIDE = 13

local C = {
	panel = { 0.15, 0.17, 0.20, 0.92 },
	card = { 0.20, 0.22, 0.26, 1 },
	cardActive = { 0.26, 0.28, 0.33, 1 },
	cardNever = { 0.17, 0.18, 0.21, 1 },
	pill = { 0.24, 0.26, 0.31, 1 },
	pillActive = { 0.27, 0.60, 0.68, 1 },
	button = { 0.24, 0.26, 0.31, 1 },
	scroll = { 0.35, 0.38, 0.45, 1 },
	gold = { 0.93, 0.76, 0.25, 1 },
	text = { 1, 1, 1, 1 },
	title = { 0.66, 0.68, 0.72, 1 },
	dim = { 0.72, 0.74, 0.78, 1 },
	faint = { 0.5, 0.5, 0.55, 1 },
	warn = { 1, 0.75, 0.4, 1 },
}
M.COLORS = C

local TITLE = "BLUEPRINTS"
local TABS_LIST = { "now", "partly", "all" }
local TAB_LABELS = { now = "Now", partly = "Partly", all = "All" }
local SOURCE_TAGS = { library = "coilbox", spool = "saved", bar = "BAR" }

--- A fresh, closed panel. scale nil follows the view's height, and pos nil
-- puts it at the right edge, vertically centred.
function M.new()
	return {
		open = false,
		tab = "now",
		scale = nil,
		pos = nil,
		scroll = 0,
		items = {},
		counts = { now = 0, partly = 0, all = 0 },
		hasBuilders = false,
		placing = nil,
		remainder = nil,
		message = nil,
		hover = nil,
		version = 0,
	}
end

--- One name per clickable thing, for remembering what the cursor is over.
function M.actionId(action)
	return action.kind .. ":" .. (action.key or action.tab or "")
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
function M.refresh(state, entries, place, game, can)
	local items = {}
	local counts = { now = 0, partly = 0, all = 0 }
	for _, entry in ipairs(entries) do
		if M.forGame(entry, game) then
			local resolved = place.resolve(entry)
			local tab = place.classify(resolved, can)
			items[#items + 1] = { entry = entry, resolved = resolved, tab = tab }
			counts.all = counts.all + 1
			if tab ~= "never" then
				counts[tab] = counts[tab] + 1
			end
		end
	end
	state.items = items
	state.counts = counts
	state.hasBuilders = #can.builders > 0
	M.scroll(state, 0)
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

--- Move the row window, clamped so the last row stays reachable. The window
-- is however many rows the last layout could fit, which the layout records.
function M.scroll(state, delta)
	local total = #M.visible(state)
	local most = math.max(0, total - (state.rowsShown or M.MAX_ROWS))
	local next = math.max(0, math.min(most, state.scroll + delta))
	if next ~= state.scroll then
		state.scroll = next
		M.touch(state)
	end
end

--- Switch tab and reset the scroll.
function M.setTab(state, tab)
	if TAB_LABELS[tab] and tab ~= state.tab then
		state.tab = tab
		state.scroll = 0
		M.touch(state)
	end
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
	local parts = { SOURCE_TAGS[item.entry.source] or item.entry.source }
	local n = #item.entry.buildings
	parts[#parts + 1] = n .. (n == 1 and " building" or " buildings")
	if item.entry.ordered then
		parts[#parts + 1] = "ordered"
	end
	if #item.resolved.missing > 0 then
		parts[#parts + 1] = "missing " .. table.concat(item.resolved.missing, ", ")
	end
	return table.concat(parts, " | ")
end

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
	x = math.max(0, math.min(view.w - w, x))
	y = math.max(0, math.min(view.h - h, y))
	return math.floor(x), math.floor(y)
end

--- Move the box by a drag. box is where it was when the drag began, and the
-- corner it hangs from stays the one it had then, so it does not jump.
function M.drag(state, box, right, dx, dy, view)
	local cx = (right and box.x + box.w or box.x) + dx
	state.pos = { x = cx / view.w, y = (box.y + box.h + dy) / view.h, right = right }
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
--   text, color }, each pic { x, y, w, h, radius, defID, row }, each hit
--   { x, y, w, h, action }. box is the pill or the panel, whichever is shown.
function M.layout(state, measure, view)
	local L = { rects = {}, texts = {}, pics = {}, hits = {} }
	local rects, texts, pics, hits = L.rects, L.texts, L.pics, L.hits
	local S = M.scaleFor(state, view)
	local PAD, GAP, W = M.PAD * S, M.GAP * S, M.WIDTH * S
	local ROW, HEADER, LINE, FOOTER = M.ROW * S, M.HEADER * S, M.LINE * S, M.FOOTER * S
	local PIC, FONT, SMALL = M.PIC * S, M.FONT * S, M.SMALL * S
	local PILL = SMALL + 8 * S

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
		rect(x, y, w, PILL, hovered(action) and lift(C.button) or C.button, "button", { radius = PILL / 2 })
		text(x + PAD, y + (PILL - SMALL) / 2, SMALL, label)
		hit(x, y, w, PILL, action)
	end

	local toggle = { kind = "toggle" }

	-- Closed, the panel is a pill that opens it and can be dragged.
	if not state.open then
		local w = measure(TITLE, SMALL) + 2 * PAD
		local x, y = placeBox(state, view, w, LINE, PAD)
		rect(x, y, w, LINE, hovered(toggle) and lift(C.panel) or C.panel, "opener", { radius = LINE / 2 })
		text(x + PAD, y + (LINE - SMALL) / 2, SMALL, TITLE, hovered(toggle) and C.text or C.title)
		hit(x, y, w, LINE, toggle)
		L.box = { x = x, y = y, w = w, h = LINE }
		return L
	end

	local visible = M.visible(state)

	-- The panel's fixed parts, and however many rows fit under them in the
	-- view. Without the clamp a tall library would push the panel off screen.
	local chrome = HEADER + FOOTER
	if state.placing then
		chrome = chrome + LINE
	end
	if state.remainder then
		chrome = chrome + LINE
	end
	if state.message then
		chrome = chrome + LINE
	end
	local fit = math.max(1, math.floor((view.h - 2 * PAD - chrome) / ROW))
	local maxRows = math.min(M.MAX_ROWS, fit)
	state.rowsShown = maxRows

	local first = state.scroll + 1
	local last = math.min(#visible, state.scroll + maxRows)
	local rowsShown = math.max(0, last - first + 1)
	-- The body is at least MIN_ROWS tall whatever it holds, so the panel
	-- keeps its shape as entries come and go.
	local bodyRows = math.min(fit, math.max(M.MIN_ROWS, rowsShown))
	local height = chrome + bodyRows * ROW

	local px, py = placeBox(state, view, W, height, PAD)
	local top = py + height
	local panel = rect(px, py, W, height, C.panel, "panel", { radius = M.RADIUS * S })
	L.box = { x = px, y = py, w = W, h = height }

	-- header: tab pills on the right, and left of them the title, which
	-- closes the panel on a click and moves it on a drag
	local y = top - HEADER
	local ty = y + (HEADER - PILL) / 2
	local tx = px + W - PAD
	for i = #TABS_LIST, 1, -1 do
		local tab = TABS_LIST[i]
		local active = tab == state.tab
		local base = active and C.pillActive or C.pill
		local tabAction = { kind = "tab", tab = tab }
		local label = TAB_LABELS[tab] .. " " .. state.counts[tab]
		local tw = measure(label, SMALL) + 2 * 6 * S
		tx = tx - tw
		rect(tx, ty, tw, PILL, hovered(tabAction) and lift(base) or base, "tab", { tab = tab, active = active, radius = PILL / 2 })
		text(tx + 6 * S, ty + (PILL - SMALL) / 2, SMALL, label, active and C.text or C.dim)
		hit(tx, ty, tw, PILL, tabAction)
		tx = tx - GAP
	end
	local handleW = tx - px
	text(px + PAD, y + (HEADER - FONT) / 2, FONT, M.truncate(TITLE, handleW - 2 * PAD, measure, FONT), hovered(toggle) and C.text or C.title)
	hit(px, y, handleW, HEADER, toggle)

	-- placing
	if state.placing then
		y = y - LINE
		local cancelW = buttonW("Cancel")
		local label = "Placing " .. state.placing.name .. ", turned " .. (state.placing.rotation * 90)
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, M.truncate(label, W - 3 * PAD - cancelW, measure, SMALL), C.warn)
		button(px + W - PAD - cancelW, y + (LINE - PILL) / 2, "Cancel", { kind = "cancel" })
	end

	-- remainder
	if state.remainder then
		y = y - LINE
		local n = state.remainder.count
		local dismissW, placeW = buttonW("Dismiss"), buttonW("Place")
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, n .. " left to build", C.warn)
		button(px + W - PAD - dismissW - GAP - placeW, y + (LINE - PILL) / 2, "Place", { kind = "remainder" })
		button(px + W - PAD - dismissW, y + (LINE - PILL) / 2, "Dismiss", { kind = "dismiss" })
	end

	-- rows, each a card with a gap above it
	if rowsShown == 0 then
		y = y - ROW
		text(px + PAD, y + (ROW - SMALL) / 2, SMALL, M.truncate(emptyText(state), W - 2 * PAD, measure, SMALL), C.dim)
	end
	local cardX, cardW, cardH = px + PAD, W - 2 * PAD, ROW - GAP
	local inset = 6 * S
	local picsW = M.PICS * (PIC + GAP)
	for i = first, last do
		local item = visible[i]
		y = y - ROW
		local active = state.placing ~= nil and state.placing.key == item.entry.key
		local rowAction = { kind = "place", key = item.entry.key }
		local color = C.card
		if active then
			color = C.cardActive
		elseif item.tab == "never" then
			color = C.cardNever
		end
		local radius = M.CARD_RADIUS * S
		rect(cardX, y, cardW, cardH, hovered(rowAction) and lift(color) or color, "row", { key = item.entry.key, active = active, radius = radius })
		if active then
			rect(cardX, y, cardW, cardH, C.gold, "outline", { radius = radius, border = 1.5 * S })
		end
		local nameColor = item.tab == "never" and C.faint or C.text
		local nameW = cardW - 2 * inset - picsW
		text(cardX + inset, y + cardH - inset - FONT, FONT, M.truncate(item.entry.name, nameW, measure, FONT), nameColor)
		text(cardX + inset, y + inset, SMALL, M.truncate(rowDetail(item), nameW, measure, SMALL), C.dim)
		local defIDs = rowPics(item)
		for p, defID in ipairs(defIDs) do
			pics[#pics + 1] = {
				x = cardX + cardW - inset + GAP - (#defIDs - p + 1) * (PIC + GAP),
				y = y + (cardH - PIC) / 2,
				w = PIC,
				h = PIC,
				radius = M.PIC_RADIUS * S,
				defID = defID,
				row = i,
			}
		end
		hit(cardX, y, cardW, cardH, rowAction)
	end

	-- scrollbar, in the margin right of the cards
	if #visible > rowsShown and rowsShown > 0 then
		local trackH = rowsShown * ROW
		local thumbH = math.max(12 * S, trackH * rowsShown / #visible)
		local thumbY = y + trackH - thumbH - (trackH - thumbH) * (state.scroll / (#visible - rowsShown))
		rect(px + W - PAD / 2 - 1.5 * S, thumbY, 3 * S, thumbH, C.scroll, "scroll", { radius = 1.5 * S })
	end

	-- message
	if state.message then
		y = y - LINE
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, M.truncate(state.message, W - 2 * PAD, measure, SMALL), C.warn)
	end

	-- footer
	y = py
	local by = y + (FOOTER - PILL) / 2
	local saveW = buttonW("Save selection")
	button(px + PAD, by, "Save selection", { kind = "save" })
	local hint = M.truncate("[ ] turn, right click cancels", W - 3 * PAD - saveW, measure, SMALL)
	text(px + W - PAD - measure(hint, SMALL), by + (PILL - SMALL) / 2, SMALL, hint, C.faint)

	panel.h = top - py
	return L
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
	local p = L.rects[1]
	if p and p.kind == "panel" and x >= p.x and x < p.x + p.w and y >= p.y and y < p.y + p.h then
		return { kind = "panel" }
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

--- Flatten rectangles for the vertex buffer.
-- @param rects table[] x, y, w, h, color, and radius and border if set
-- @return number[] vertices, STRIDE floats each (x, y, z, u, v, r, g, b, a,
--   then the shape w, h, radius, border the shader rounds the corners with),
--   four per rect, bottom left first, anticlockwise, z always 0
-- @return number[] indices, zero based, six per rect
function M.pack(rects)
	local verts, idx = {}, {}
	local v, n = 0, 0
	for i, r in ipairs(rects) do
		v, n = quad(verts, idx, v, n, {
			{ r.x, r.y, 0, 0, 0 },
			{ r.x + r.w, r.y, 0, 1, 0 },
			{ r.x + r.w, r.y + r.h, 0, 1, 1 },
			{ r.x, r.y + r.h, 0, 0, 1 },
		}, r.color, { r.w, r.h, r.radius or 0, r.border or 0 }, i)
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

--- Flatten footprint squares on the ground for the vertex buffer, in world
-- space: x and z span the footprint, y sits two elmos above the ground.
-- @param positions table[] from place.footprint
-- @param blockedColor number[] rgba for a blocked position
-- @param openColor number[] rgba for the rest
-- @return number[] vertices, number[] indices, as M.pack
function M.packGround(positions, blockedColor, openColor)
	local verts, idx = {}, {}
	local v, n = 0, 0
	for i, p in ipairs(positions) do
		local hw, hd = M.halfSpan(p.def, p.facing)
		local y = p.y + 2
		v, n = quad(verts, idx, v, n, {
			{ p.x - hw, y, p.z - hd, 0, 0 },
			{ p.x + hw, y, p.z - hd, 1, 0 },
			{ p.x + hw, y, p.z + hd, 1, 1 },
			{ p.x - hw, y, p.z + hd, 0, 1 },
		}, p.blocked and blockedColor or openColor, { 2 * hw, 2 * hd, 0, 0 }, i)
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
