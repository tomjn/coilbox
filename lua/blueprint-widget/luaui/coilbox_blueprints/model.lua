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
M.TOP_GAP = 120

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

local TABS = { "now", "partly", "all" }
local TAB_LABELS = { now = "Now", partly = "Partly", all = "All" }
local SOURCE_TAGS = { library = "coilbox", spool = "saved", bar = "BAR" }

--- A fresh, closed panel.
function M.new()
	return {
		open = false,
		tab = "now",
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

--- Move the row window, clamped so the last row stays reachable.
function M.scroll(state, delta)
	local total = #M.visible(state)
	local most = math.max(0, total - M.MAX_ROWS)
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
	if not state.open then
		return L
	end
	local rects, texts, pics, hits = L.rects, L.texts, L.pics, L.hits
	local PAD, W = M.PAD, M.WIDTH

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
		local tw = measure(label, M.SMALL)
		text(x + (w - tw) / 2, y + (h - M.SMALL) / 2, M.SMALL, label)
		hit(x, y, w, h, action)
	end

	local visible = M.visible(state)
	local first = state.scroll + 1
	local last = math.min(#visible, state.scroll + M.MAX_ROWS)
	local rowsShown = math.max(0, last - first + 1)

	local height = M.HEADER + M.TABS + M.FOOTER + PAD
	if state.placing then
		height = height + M.LINE
	end
	if state.remainder then
		height = height + M.LINE
	end
	height = height + (rowsShown > 0 and rowsShown * M.ROW or M.ROW)
	if state.message then
		height = height + M.LINE
	end

	local px = view.w - W - M.MARGIN
	local top = view.h - M.TOP_GAP
	local py = math.max(PAD, top - height)
	top = py + height
	local panel = rect(px, py, W, height, C.panel, "panel")

	-- header
	local y = top - M.HEADER
	rect(px, y, W, M.HEADER, C.header, "header")
	text(px + PAD, y + (M.HEADER - M.FONT) / 2, M.FONT, "Blueprints")
	button(px + W - M.HEADER + 2, y + 2, M.HEADER - 4, M.HEADER - 4, "x", { kind = "close" })

	-- tabs
	y = y - M.TABS
	local tabW = W / #TABS
	for i, tab in ipairs(TABS) do
		local tx = px + (i - 1) * tabW
		local active = tab == state.tab
		rect(tx, y, tabW, M.TABS, active and C.tabActive or C.tab, "tab", { tab = tab, active = active })
		local label = TAB_LABELS[tab] .. " " .. state.counts[tab]
		text(tx + (tabW - measure(label, M.SMALL)) / 2, y + (M.TABS - M.SMALL) / 2, M.SMALL, label)
		hit(tx, y, tabW, M.TABS, { kind = "tab", tab = tab })
	end

	-- placing
	if state.placing then
		y = y - M.LINE
		local label = "Placing " .. state.placing.name .. ", turned " .. (state.placing.rotation * 90)
		text(px + PAD, y + (M.LINE - M.SMALL) / 2, M.SMALL, M.truncate(label, W - 2 * PAD - 70, measure, M.SMALL), C.warn)
		button(px + W - PAD - 60, y + 3, 60, M.LINE - 6, "Cancel", { kind = "cancel" })
	end

	-- remainder
	if state.remainder then
		y = y - M.LINE
		local n = state.remainder.count
		text(px + PAD, y + (M.LINE - M.SMALL) / 2, M.SMALL, n .. " left to build", C.warn)
		button(px + W - PAD - 130, y + 3, 60, M.LINE - 6, "Place", { kind = "remainder" })
		button(px + W - PAD - 64, y + 3, 64, M.LINE - 6, "Dismiss", { kind = "dismiss" })
	end

	-- rows
	if rowsShown == 0 then
		y = y - M.ROW
		text(px + PAD, y + (M.ROW - M.SMALL) / 2, M.SMALL, M.truncate(emptyText(state), W - 2 * PAD, measure, M.SMALL), C.dim)
	end
	local picsW = 5 * (M.PIC + 2)
	for i = first, last do
		local item = visible[i]
		y = y - M.ROW
		local active = state.placing ~= nil and state.placing.key == item.entry.key
		local color = C.row
		if active then
			color = C.rowActive
		elseif item.tab == "never" then
			color = C.rowNever
		elseif i % 2 == 0 then
			color = C.rowAlt
		end
		rect(px, y, W, M.ROW, color, "row", { key = item.entry.key, active = active })
		local nameColor = item.tab == "never" and C.faint or C.text
		local nameW = W - 2 * PAD - picsW - PAD
		text(px + PAD, y + M.ROW - PAD - M.FONT, M.FONT, M.truncate(item.entry.name, nameW, measure, M.FONT), nameColor)
		text(px + PAD, y + PAD - 2, M.SMALL, M.truncate(rowDetail(item), nameW, measure, M.SMALL), C.dim)
		local defIDs = rowPics(item)
		for p, defID in ipairs(defIDs) do
			pics[#pics + 1] = {
				x = px + W - PAD - (#defIDs - p + 1) * (M.PIC + 2),
				y = y + (M.ROW - M.PIC) / 2,
				w = M.PIC,
				h = M.PIC,
				defID = defID,
				row = i,
			}
		end
		hit(px, y, W, M.ROW, { kind = "place", key = item.entry.key })
	end

	-- scrollbar
	if #visible > rowsShown and rowsShown > 0 then
		local trackH = rowsShown * M.ROW
		local thumbH = math.max(12, trackH * rowsShown / #visible)
		local thumbY = y + trackH - thumbH - (trackH - thumbH) * (state.scroll / (#visible - rowsShown))
		rect(px + W - 4, thumbY, 3, thumbH, C.scroll, "scroll")
	end

	-- message
	if state.message then
		y = y - M.LINE
		text(px + PAD, y + (M.LINE - M.SMALL) / 2, M.SMALL, M.truncate(state.message, W - 2 * PAD, measure, M.SMALL), C.warn)
	end

	-- footer
	y = py
	button(px + PAD, y + PAD, 120, M.FOOTER - PAD, "Save selection", { kind = "save" })
	local hint = "[ ] turn, right click cancels"
	text(px + W - PAD - measure(hint, M.SMALL), y + (M.FOOTER - M.SMALL) / 2 + PAD / 2, M.SMALL, hint, C.faint)

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
	if p and x >= p.x and x < p.x + p.w and y >= p.y and y < p.y + p.h then
		return { kind = "panel" }
	end
	return nil
end

--- Flatten rectangles for the vertex buffer.
-- @param rects table[] x, y, w, h, color
-- @return number[] vertices, eight floats each (x, y, u, v, r, g, b, a), four
--   per rect, bottom left first, anticlockwise
-- @return number[] indices, zero based, six per rect
function M.pack(rects)
	local verts, idx = {}, {}
	local v, n = 0, 0
	for i, r in ipairs(rects) do
		local c = r.color
		local corners = {
			{ r.x, r.y, 0, 0 },
			{ r.x + r.w, r.y, 1, 0 },
			{ r.x + r.w, r.y + r.h, 1, 1 },
			{ r.x, r.y + r.h, 0, 1 },
		}
		for _, p in ipairs(corners) do
			verts[v + 1], verts[v + 2], verts[v + 3], verts[v + 4] = p[1], p[2], p[3], p[4]
			verts[v + 5], verts[v + 6], verts[v + 7], verts[v + 8] = c[1], c[2], c[3], c[4]
			v = v + 8
		end
		local base = (i - 1) * 4
		idx[n + 1], idx[n + 2], idx[n + 3] = base, base + 1, base + 2
		idx[n + 4], idx[n + 5], idx[n + 6] = base, base + 2, base + 3
		n = n + 6
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
