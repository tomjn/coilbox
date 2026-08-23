-- The panel: what it holds and where everything goes.
--
-- Pure. The widget hands in the store's entries, the selection's capabilities
-- and a text measurer, and gets back the tabs and counts, then a layout of
-- rectangles, texts, build pictures and click targets in screen coordinates
-- with the origin at the bottom left, which is what DrawScreen and MousePress
-- both use. pack() turns the rectangles into the flat arrays the widget
-- uploads to a vertex buffer, so nothing here needs gl.

local M = {}

M.WIDTH = 360
M.PAD = 8
M.ROW = 44
M.HEADER = 30
M.TABS = 26
M.LINE = 26
M.FOOTER = 36
M.MAX_ROWS = 10
M.PIC = 28
M.FONT = 13
M.SMALL = 11
M.MARGIN = 16

--- How many times the base sizes the panel is drawn at. The engine hands
-- physical pixels, so 1 is small on any modern screen.
M.SCALE = 3

local C = {
	panel = { 0.06, 0.07, 0.09, 0.9 },
	header = { 0.12, 0.14, 0.18, 1 },
	tab = { 0.16, 0.18, 0.22, 1 },
	tabActive = { 0.22, 0.42, 0.72, 1 },
	row = { 0.10, 0.12, 0.15, 0.95 },
	rowAlt = { 0.13, 0.15, 0.19, 0.95 },
	rowActive = { 0.20, 0.36, 0.58, 1 },
	rowNever = { 0.09, 0.09, 0.10, 0.95 },
	button = { 0.24, 0.28, 0.34, 1 },
	buttonWarm = { 0.55, 0.30, 0.14, 1 },
	scroll = { 0.35, 0.38, 0.45, 1 },
	text = { 1, 1, 1, 1 },
	dim = { 0.72, 0.74, 0.78, 1 },
	faint = { 0.5, 0.5, 0.55, 1 },
	warn = { 1, 0.75, 0.4, 1 },
}
M.COLORS = C

local TABS_LIST = { "now", "partly", "all" }
local TAB_LABELS = { now = "Now", partly = "Partly", all = "All" }
local SOURCE_TAGS = { library = "coilbox", spool = "saved", bar = "BAR" }

--- A fresh, closed panel.
function M.new()
	return {
		open = false,
		tab = "now",
		scale = M.SCALE,
		scroll = 0,
		items = {},
		counts = { now = 0, partly = 0, all = 0 },
		hasBuilders = false,
		placing = nil,
		remainder = nil,
		message = nil,
		version = 0,
	}
end

--- Bump the version so the widget knows to lay out again.
function M.touch(state)
	state.version = state.version + 1
end

--- Whether an entry is for the game being played. No binding is for every
-- game. A shortname decides when there is one, otherwise the full name.
-- @param entry table a store entry
-- @param game table Game, or anything with gameName and gameShortName
function M.forGame(entry, game)
	local bound = entry.game
	if bound == nil then
		return true
	end
	if bound.shortname ~= nil then
		return bound.shortname == game.gameShortName
	end
	return bound.name == game.gameName
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

--- Up to five distinct def ids, in layout order.
local function rowPics(item)
	local out, seen = {}, {}
	for _, b in ipairs(item.resolved.buildings) do
		if not seen[b.defID] then
			seen[b.defID] = true
			out[#out + 1] = b.defID
			if #out == 5 then
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

--- Lay the panel out.
-- @param state table
-- @param measure function(text, size) -> width in pixels
-- @param view table w, h of the screen
-- @return table rects, texts, pics, hits. Each rect is { x, y, w, h, color,
--   kind, key?, active? }, each text { x, y, size, text, color }, each pic
--   { x, y, w, h, defID, row }, each hit { x, y, w, h, action }.
function M.layout(state, measure, view)
	local L = { rects = {}, texts = {}, pics = {}, hits = {} }
	local rects, texts, pics, hits = L.rects, L.texts, L.pics, L.hits
	local S = state.scale or M.SCALE
	local PAD, W = M.PAD * S, M.WIDTH * S
	local ROW, HEADER, TABS, LINE, FOOTER = M.ROW * S, M.HEADER * S, M.TABS * S, M.LINE * S, M.FOOTER * S
	local PIC, FONT, SMALL, MARGIN = M.PIC * S, M.FONT * S, M.SMALL * S, M.MARGIN * S

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
	local function button(x, y, w, h, label, action, color)
		rect(x, y, w, h, color or C.button, "button")
		local tw = measure(label, SMALL)
		text(x + (w - tw) / 2, y + (h - SMALL) / 2, SMALL, label)
		hit(x, y, w, h, action)
	end

	-- Closed, the panel is a tab on the edge saying where it went.
	if not state.open then
		local label = "Blueprints"
		local w = measure(label, SMALL) + 2 * PAD
		local h = LINE
		local x = view.w - w
		local y = math.floor((view.h - h) / 2)
		rect(x, y, w, h, C.header, "opener")
		text(x + PAD, y + (h - SMALL) / 2, SMALL, label)
		hit(x, y, w, h, { kind = "toggle" })
		return L
	end

	local visible = M.visible(state)

	-- The panel's fixed parts, and however many rows fit under them in the
	-- view. Without the clamp a tall library would push the panel off screen.
	local chrome = HEADER + TABS + FOOTER + PAD
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
	local height = chrome + (rowsShown > 0 and rowsShown * ROW or ROW)

	local px = view.w - W - MARGIN
	local py = math.max(PAD, math.floor((view.h - height) / 2))
	local top = py + height
	local panel = rect(px, py, W, height, C.panel, "panel")

	-- header
	local y = top - HEADER
	rect(px, y, W, HEADER, C.header, "header")
	text(px + PAD, y + (HEADER - FONT) / 2, FONT, "Blueprints")
	button(px + W - HEADER + 2 * S, y + 2 * S, HEADER - 4 * S, HEADER - 4 * S, "x", { kind = "close" })

	-- tabs
	y = y - TABS
	local tabW = W / #TABS_LIST
	for i, tab in ipairs(TABS_LIST) do
		local tx = px + (i - 1) * tabW
		local active = tab == state.tab
		rect(tx, y, tabW, TABS, active and C.tabActive or C.tab, "tab", { tab = tab, active = active })
		local label = TAB_LABELS[tab] .. " " .. state.counts[tab]
		text(tx + (tabW - measure(label, SMALL)) / 2, y + (TABS - SMALL) / 2, SMALL, label)
		hit(tx, y, tabW, TABS, { kind = "tab", tab = tab })
	end

	-- placing
	if state.placing then
		y = y - LINE
		local label = "Placing " .. state.placing.name .. ", turned " .. (state.placing.rotation * 90)
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, M.truncate(label, W - 2 * PAD - 70 * S, measure, SMALL), C.warn)
		button(px + W - PAD - 60 * S, y + 3 * S, 60 * S, LINE - 6 * S, "Cancel", { kind = "cancel" })
	end

	-- remainder
	if state.remainder then
		y = y - LINE
		local n = state.remainder.count
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, n .. " left to build", C.warn)
		button(px + W - PAD - 130 * S, y + 3 * S, 60 * S, LINE - 6 * S, "Place", { kind = "remainder" })
		button(px + W - PAD - 64 * S, y + 3 * S, 64 * S, LINE - 6 * S, "Dismiss", { kind = "dismiss" })
	end

	-- rows
	if rowsShown == 0 then
		y = y - ROW
		text(px + PAD, y + (ROW - SMALL) / 2, SMALL, M.truncate(emptyText(state), W - 2 * PAD, measure, SMALL), C.dim)
	end
	local picsW = 5 * (PIC + 2 * S)
	for i = first, last do
		local item = visible[i]
		y = y - ROW
		local active = state.placing ~= nil and state.placing.key == item.entry.key
		local color = C.row
		if active then
			color = C.rowActive
		elseif item.tab == "never" then
			color = C.rowNever
		elseif i % 2 == 0 then
			color = C.rowAlt
		end
		rect(px, y, W, ROW, color, "row", { key = item.entry.key, active = active })
		local nameColor = item.tab == "never" and C.faint or C.text
		local nameW = W - 2 * PAD - picsW - PAD
		text(px + PAD, y + ROW - PAD - FONT, FONT, M.truncate(item.entry.name, nameW, measure, FONT), nameColor)
		text(px + PAD, y + PAD - 2 * S, SMALL, M.truncate(rowDetail(item), nameW, measure, SMALL), C.dim)
		local defIDs = rowPics(item)
		for p, defID in ipairs(defIDs) do
			pics[#pics + 1] = {
				x = px + W - PAD - (#defIDs - p + 1) * (PIC + 2 * S),
				y = y + (ROW - PIC) / 2,
				w = PIC,
				h = PIC,
				defID = defID,
				row = i,
			}
		end
		hit(px, y, W, ROW, { kind = "place", key = item.entry.key })
	end

	-- scrollbar
	if #visible > rowsShown and rowsShown > 0 then
		local trackH = rowsShown * ROW
		local thumbH = math.max(12 * S, trackH * rowsShown / #visible)
		local thumbY = y + trackH - thumbH - (trackH - thumbH) * (state.scroll / (#visible - rowsShown))
		rect(px + W - 4 * S, thumbY, 3 * S, thumbH, C.scroll, "scroll")
	end

	-- message
	if state.message then
		y = y - LINE
		text(px + PAD, y + (LINE - SMALL) / 2, SMALL, M.truncate(state.message, W - 2 * PAD, measure, SMALL), C.warn)
	end

	-- footer
	y = py
	button(px + PAD, y + PAD, 120 * S, FOOTER - PAD, "Save selection", { kind = "save" })
	local hint = "[ ] turn, right click cancels"
	text(px + W - PAD - measure(hint, SMALL), y + (FOOTER - SMALL) / 2 + PAD / 2, SMALL, hint, C.faint)

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

local function quad(verts, idx, v, n, corners, c, i)
	for _, p in ipairs(corners) do
		verts[v + 1], verts[v + 2], verts[v + 3] = p[1], p[2], p[3]
		verts[v + 4], verts[v + 5] = p[4], p[5]
		verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
		v = v + 9
	end
	local base = (i - 1) * 4
	idx[n + 1], idx[n + 2], idx[n + 3] = base, base + 1, base + 2
	idx[n + 4], idx[n + 5], idx[n + 6] = base, base + 2, base + 3
	return v, n + 6
end

--- Flatten rectangles for the vertex buffer.
-- @param rects table[] x, y, w, h, color
-- @return number[] vertices, nine floats each (x, y, z, u, v, r, g, b, a),
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
		}, r.color, i)
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
		}, p.blocked and blockedColor or openColor, i)
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
