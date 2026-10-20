-- Run: luajit lua/blueprint-widget/tests/model_test.lua
--
-- The panel's state and layout: which entries show under which tab, where
-- every rectangle and line of text goes, what a click hits, and how the
-- rectangles pack into the vertex and index arrays the widget uploads.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local MODEL = support.module("model.lua")
local PLACE = support.module("place.lua")

local SOLAR = support.def(1, "armsolar", { isBuilding = true, xsize = 8, zsize = 8, humanName = "Solar Collector" })
local LLT = support.def(2, "armllt", { isBuilding = true, xsize = 6, zsize = 6 })
local LAB = support.def(4, "armlab", { isBuilding = true, xsize = 12, zsize = 12 })
local CON = support.def(10, "armck", { buildOptions = { 1, 2 } })
local E = support.engine({ SOLAR, LLT, LAB, CON }, {
	selected = { 100 },
	units = { [100] = { def = 10 } },
	gameName = "Test Game",
	modName = "Test Game 1.0",
	gameShortName = "TEST",
})
PLACE.use(E)
local CAN = PLACE.capabilities({ 100 })
local NOBODY = PLACE.capabilities({})

--------------------------------------------------------------------------------
-- the game filter
--------------------------------------------------------------------------------

local game = E.Game
check("no game binding is for every game", MODEL.forGame({ buildings = {} }, game))
check("matching shortname is for this game", MODEL.forGame({ game = { shortname = "TEST" } }, game))
check("another shortname is not", not MODEL.forGame({ game = { shortname = "BYAR" } }, game))
check("a name only binding matches the archive name", MODEL.forGame({ game = { name = "Test Game 1.0" } }, game))
check("a name only binding to another build is not", not MODEL.forGame({ game = { name = "Test Game 2.0" } }, game))
check("modinfo's unversioned name is not the archive name", not MODEL.forGame({ game = { name = "Test Game" } }, game))
check("shortname wins over name when both are there", not MODEL.forGame({ game = { name = "Test Game 1.0", shortname = "BYAR" } }, game))

--------------------------------------------------------------------------------
-- classification into tabs
--------------------------------------------------------------------------------

local function b(def, x, z)
	return { def = def, offset = { x = x or 0, z = z or 0 }, facing = 0 }
end
local ENTRIES = {
	{ key = "library:eco", name = "Eco", source = "library", ordered = true, buildings = { b("armsolar"), b("armsolar", 32) } },
	{ key = "library:mixed", name = "Mixed", source = "library", ordered = false, buildings = { b("armsolar"), b("armlab", 64) } },
	{ key = "library:lab", name = "Lab only", source = "library", ordered = false, buildings = { b("armlab") } },
	{ key = "library:other", name = "Other game", source = "library", ordered = false, game = { shortname = "BYAR" }, buildings = { b("armsolar") } },
	{ key = "library:missing", name = "Has corgant", source = "library", ordered = false, buildings = { b("armsolar"), b("corgant") } },
	{ key = "spool:1", name = "Base on Map 1", source = "spool", ordered = false, buildings = { b("armllt") } },
	{ key = "bar:1", name = "BAR one", source = "bar", ordered = true, buildings = { b("armsolar") } },
}

local state = MODEL.new()
check("a new panel is closed on the now tab", state.open == false and state.tab == "now")

MODEL.refresh(state, ENTRIES, PLACE, game, CAN)
check("refresh drops entries for another game", #state.items == 6, show(state.items))
check("counts per tab", same(state.counts, { now = 3, partly = 2, all = 6 }), show(state.counts))

local now = MODEL.visible(state)
check("now shows only fully buildable entries", #now == 3 and now[1].entry.key == "library:eco" and now[3].entry.key == "bar:1", show(now))

state.tab = "partly"
local partly = MODEL.visible(state)
check("partly shows entries with some buildable buildings", #partly == 2 and partly[1].entry.key == "library:mixed" and partly[2].entry.key == "library:missing", show(partly))

state.tab = "all"
local all = MODEL.visible(state)
check("all shows everything for this game in store order", #all == 6 and all[3].entry.key == "library:lab")
check("an item knows what the game is missing", same(all[4].resolved.missing, { "corgant" }))
check("an item carries its tab", all[3].tab == "never" and all[1].tab == "now")

MODEL.refresh(state, ENTRIES, PLACE, game, NOBODY)
check("with no builders nothing is now or partly", same(state.counts, { now = 0, partly = 0, all = 6 }), show(state.counts))
MODEL.refresh(state, ENTRIES, PLACE, game, CAN)

--------------------------------------------------------------------------------
-- layout
--------------------------------------------------------------------------------

local function measure(text, size)
	return #text * size * 0.5
end
local VIEW = { w = 1920, h = 1080 }

state.open = true
state.tab = "now"
local L = MODEL.layout(state, measure, VIEW)

check("layout has a background rect first", L.rects[1].kind == "panel", show(L.rects[1]))
check("the panel sits a margin in from the right edge, inside the view", L.rects[1].x + L.rects[1].w == VIEW.w - MODEL.PAD and L.rects[1].y >= 0 and L.rects[1].y + L.rects[1].h <= VIEW.h, show(L.rects[1]))
check("the panel has rounded corners", L.rects[1].radius == MODEL.RADIUS, show(L.rects[1]))
check("the layout reports the panel as the box to drag", same(L.box, { x = L.rects[1].x, y = L.rects[1].y, w = L.rects[1].w, h = L.rects[1].h }), show(L.box))

local function textsWith(layout, needle)
	local found = {}
	for _, t in ipairs(layout.texts) do
		if t.text:find(needle, 1, true) then
			found[#found + 1] = t
		end
	end
	return found
end
check("the title is drawn once, in capitals", #textsWith(L, "BLUEPRINTS") == 1, show(L.texts))
check("tabs show their counts", #textsWith(L, "Now 3") == 1 and #textsWith(L, "Partly 2") == 1 and #textsWith(L, "All 6") == 1, show(L.texts))
check("every visible row has its name", #textsWith(L, "Eco") == 1 and #textsWith(L, "BAR one") == 1)
check("a row says where it came from", #textsWith(L, "BAR") >= 1 and #textsWith(L, "saved") == 1, show(L.texts))
check("an ordered entry says so", #textsWith(L, "ordered") >= 1, show(textsWith(L, "ordered")))

local pics = L.pics
check("rows show build pictures by def id", #pics > 0 and pics[1].defID == 1, show(pics[1]))
check("a row shows at most PICS pictures", (function()
	local perRow = {}
	for _, p in ipairs(pics) do
		perRow[p.row] = (perRow[p.row] or 0) + 1
	end
	for _, n in pairs(perRow) do
		if n > MODEL.PICS then
			return false
		end
	end
	return true
end)())

local function hitsOf(layout, kind)
	local found = {}
	for _, h in ipairs(layout.hits) do
		if h.action.kind == kind then
			found[#found + 1] = h
		end
	end
	return found
end
check("each row is clickable to place", #hitsOf(L, "place") == 3 and hitsOf(L, "place")[1].action.key == "library:eco", show(hitsOf(L, "place")))
check("tabs are clickable", #hitsOf(L, "tab") == 3 and hitsOf(L, "tab")[2].action.tab == "partly")
check("there is a save button and no separate close button", #hitsOf(L, "save") == 1 and #hitsOf(L, "close") == 0)
check("the title is the toggle, across the header left of the tabs", (function()
	local t = hitsOf(L, "toggle")[1]
	local firstTab = hitsOf(L, "tab")[1]
	local p = L.rects[1]
	return #hitsOf(L, "toggle") == 1 and t.x == p.x and t.y + t.h == p.y + p.h and t.x + t.w < firstTab.x
end)(), show(hitsOf(L, "toggle")))
check("tabs and buttons are rectangles with rounded corners, not pills", (function()
	for _, r in ipairs(L.rects) do
		if (r.kind == "tab" or r.kind == "button") and r.radius ~= MODEL.BUTTON_RADIUS then
			return false
		end
	end
	return true
end)())
check("rows are rounded cards inset from the panel's sides", (function()
	local p = L.rects[1]
	for _, r in ipairs(L.rects) do
		if r.kind == "row" and (r.radius == nil or r.x ~= p.x + MODEL.PAD or r.x + r.w ~= p.x + p.w - MODEL.PAD) then
			return false
		end
	end
	return true
end)())
check("pictures have rounded corners", pics[1].radius == MODEL.PIC_RADIUS, show(pics[1]))

local rowHit = hitsOf(L, "place")[1]
local inside = MODEL.hit(L, rowHit.x + 1, rowHit.y + 1)
check("hit finds the action under a point", inside ~= nil and inside.kind == "place" and inside.key == "library:eco", show(inside))
check("hit outside the panel is nil", MODEL.hit(L, 1, 1) == nil)
check("a point inside the panel but on nothing is the panel itself", MODEL.hit(L, L.rects[1].x + 2, L.rects[1].y + 2) ~= nil and MODEL.hit(L, L.rects[1].x + 2, L.rects[1].y + 2).kind == "panel")

check("rows stack downward from the top", hitsOf(L, "place")[1].y > hitsOf(L, "place")[2].y)
check("every text lands inside the panel", (function()
	local p = L.rects[1]
	for _, t in ipairs(L.texts) do
		if t.x < p.x or t.x > p.x + p.w or t.y < p.y or t.y > p.y + p.h then
			return false
		end
	end
	return true
end)(), show(L.texts))

-- a long name is cut to fit
local longState = MODEL.new()
MODEL.refresh(longState, { { key = "library:long", name = string.rep("x", 200), source = "library", ordered = false, buildings = { b("armsolar") } } }, PLACE, game, CAN)
longState.open = true
local LL = MODEL.layout(longState, measure, VIEW)
local longText = textsWith(LL, "xxx")[1]
check("a long name is cut with an ellipsis", longText and #longText.text < 200 and longText.text:sub(-3) == "...", longText and longText.text)
check("one row still gets a three row panel", LL.rects[1].h == L.rects[1].h, LL.rects[1].h .. " vs " .. L.rects[1].h)

-- hover
check("an action names itself", MODEL.actionId({ kind = "place", key = "library:eco" }) == "place:library:eco" and MODEL.actionId({ kind = "tab", tab = "all" }) == "tab:all" and MODEL.actionId({ kind = "save" }) == "save:")
check("a hovered background lifts", (function()
	local saveHit = hitsOf(L, "save")[1]
	local function saveRect(layout)
		for _, r in ipairs(layout.rects) do
			if r.kind == "button" and r.x == saveHit.x and r.y == saveHit.y then
				return r
			end
		end
	end
	state.hover = MODEL.actionId({ kind = "save" })
	local LH = MODEL.layout(state, measure, VIEW)
	state.hover = nil
	local plain, hot = saveRect(L), saveRect(LH)
	return plain and hot and hot.color[1] > plain.color[1]
end)())
check("a hovered row lifts", (function()
	state.hover = MODEL.actionId({ kind = "place", key = "library:eco" })
	local LH = MODEL.layout(state, measure, VIEW)
	state.hover = nil
	local function rowColor(layout)
		for _, r in ipairs(layout.rects) do
			if r.kind == "row" and r.key == "library:eco" then
				return r.color
			end
		end
	end
	return rowColor(LH)[1] > rowColor(L)[1]
end)())
check("the opener lifts under the cursor", (function()
	local closed = MODEL.new()
	MODEL.refresh(closed, ENTRIES, PLACE, game, CAN)
	local plain = MODEL.layout(closed, measure, VIEW)
	closed.hover = MODEL.actionId({ kind = "toggle" })
	local hot = MODEL.layout(closed, measure, VIEW)
	return hot.rects[1].color[1] > plain.rects[1].color[1]
end)())

-- placing and the remainder are reported
state.placing = { key = "library:eco", name = "Eco", rotation = 1 }
state.remainder = { count = 3 }
state.message = "Saved Base on Map 2"
local LP = MODEL.layout(state, measure, VIEW)
check("the placing row names the blueprint and the rotation", #textsWith(LP, "Placing Eco") == 1 and #textsWith(LP, "90") == 1, show(LP.texts))
check("the placing row offers cancel", #hitsOf(LP, "cancel") == 1)
check("the remainder row has a count and two buttons", #textsWith(LP, "3 left") == 1 and #hitsOf(LP, "remainder") == 1 and #hitsOf(LP, "dismiss") == 1, show(LP.texts))
check("the message is shown", #textsWith(LP, "Saved Base on Map 2") == 1)
check("the active row is highlighted", (function()
	for _, r in ipairs(LP.rects) do
		if r.kind == "row" and r.key == "library:eco" and r.active then
			return true
		end
	end
	return false
end)())
check("the active row has a gold outline", (function()
	for _, r in ipairs(LP.rects) do
		if r.kind == "outline" then
			return r.border > 0 and same(r.color, MODEL.COLORS.gold)
		end
	end
	return false
end)())
state.placing, state.remainder, state.message = nil, nil, nil

-- empty tabs explain themselves
local emptyState = MODEL.new()
MODEL.refresh(emptyState, ENTRIES, PLACE, game, NOBODY)
emptyState.open = true
local LE = MODEL.layout(emptyState, measure, VIEW)
check("an empty now tab says to select a builder", #textsWith(LE, "Select a builder") == 1, show(LE.texts))
local nothing = MODEL.new()
MODEL.refresh(nothing, {}, PLACE, game, CAN)
nothing.open = true
nothing.tab = "all"
check("an empty library says where to get blueprints", #textsWith(MODEL.layout(nothing, measure, VIEW), "coilbox") >= 1)

-- a closed panel leaves a pill that opens it
state.open = false
local LC = MODEL.layout(state, measure, VIEW)
check("a closed panel shows only the opener", #LC.rects == 1 and LC.rects[1].kind == "opener", show(LC.rects))
check("the opener is a vertical tab with rounded corners", LC.rects[1].h > LC.rects[1].w and LC.rects[1].radius == MODEL.BUTTON_RADIUS, show(LC.rects[1]))
check("the opener's label reads downward", (function()
	for _, t in ipairs(LC.texts) do
		if t.text == "BLUEPRINTS" then
			return t.rotate == -90
		end
	end
	return false
end)(), show(LC.texts))
check("the opener sits a margin in from the right edge, vertically centred", (function()
	local r = LC.rects[1]
	local centred = math.abs((r.y - 0) - (VIEW.h - r.y - r.h)) <= 1
	return r.x + r.w == VIEW.w - MODEL.PAD and centred
end)(), show(LC.rects[1]))
check("the opener names the panel", #textsWith(LC, "BLUEPRINTS") == 1)
check("the opener is the box to drag", same(LC.box, { x = LC.rects[1].x, y = LC.rects[1].y, w = LC.rects[1].w, h = LC.rects[1].h }), show(LC.box))
check("clicking the opener toggles", #LC.hits == 1 and LC.hits[1].action.kind == "toggle")
check("hit finds the opener", MODEL.hit(LC, LC.rects[1].x + 2, LC.rects[1].y + 2) ~= nil and MODEL.hit(LC, LC.rects[1].x + 2, LC.rects[1].y + 2).kind == "toggle")
state.open = true

-- scale and placement
check("the default scale follows the view's height", state.scale == nil and MODEL.scaleFor(state, VIEW) == 1 and MODEL.scaleFor(state, { w = 3840, h = 2160 }) == 2)
check("the panel is vertically centred", (function()
	local p = L.rects[1]
	return math.abs(p.y - (VIEW.h - p.y - p.h)) <= 2
end)(), show(L.rects[1]))
local big = MODEL.new()
MODEL.refresh(big, ENTRIES, PLACE, game, CAN)
big.open = true
big.scale = 2
local LB = MODEL.layout(big, measure, VIEW)
check("scale multiplies the panel's sizes", LB.rects[1].w == L.rects[1].w * 2 and math.abs(LB.rects[1].h - L.rects[1].h * 2) <= 2, LB.rects[1].w .. " vs " .. L.rects[1].w)
check("text sizes scale with the panel", (function()
	for _, t in ipairs(LB.texts) do
		if t.size >= MODEL.FONT * 2 then
			return true
		end
	end
	return false
end)(), show(LB.texts[1]))

--------------------------------------------------------------------------------
-- dragging
--------------------------------------------------------------------------------

check("a saved position must be fractions of the view with a side", MODEL.validPos({ x = 0.5, y = 0.5, right = false }) and not MODEL.validPos({ x = 1.5, y = 0.5, right = true }) and not MODEL.validPos({ x = 0.5, y = 0.5 }) and not MODEL.validPos(nil))

local moved = MODEL.new()
MODEL.refresh(moved, ENTRIES, PLACE, game, CAN)
local before = MODEL.layout(moved, measure, VIEW).box
MODEL.drag(moved, before, true, -300, 100, VIEW)
local after = MODEL.layout(moved, measure, VIEW).box
check("a drag moves the pill by the mouse's travel", after.x == before.x - 300 and after.y == before.y + 100, show({ before, after }))

MODEL.drag(moved, before, true, -5000, 5000, VIEW)
local clamped = MODEL.layout(moved, measure, VIEW).box
check("a drag cannot take the pill off screen", clamped.x == 0 and clamped.y + clamped.h == VIEW.h, show(clamped))

MODEL.settle(moved, MODEL.layout(moved, measure, VIEW), VIEW)
check("dropped on the left half, the pill hangs from its left corner", moved.pos.right == false and moved.pos.x == 0 and moved.pos.y == 1, show(moved.pos))
local settled = MODEL.layout(moved, measure, VIEW).box
check("settling does not move the pill", same(settled, clamped), show({ settled, clamped }))
moved.open = true
local openLeft = MODEL.layout(moved, measure, VIEW)
check("opened there, the panel hangs from the same corner", openLeft.box.x == 0 and openLeft.box.y + openLeft.box.h == VIEW.h, show(openLeft.box))

MODEL.drag(moved, openLeft.box, false, 1500, -200, VIEW)
MODEL.settle(moved, MODEL.layout(moved, measure, VIEW), VIEW)
local openRight = MODEL.layout(moved, measure, VIEW).box
check("dropped on the right half, the panel hangs from its right corner", moved.pos.right == true and math.abs(moved.pos.x * VIEW.w - (openRight.x + openRight.w)) < 1e-6, show(moved.pos))
moved.open = false
local pillRight = MODEL.layout(moved, measure, VIEW).box
check("closing it there leaves the pill under the panel's right corner", pillRight.x + pillRight.w == openRight.x + openRight.w and pillRight.y + pillRight.h == openRight.y + openRight.h, show({ pillRight, openRight }))

--------------------------------------------------------------------------------
-- scrolling
--------------------------------------------------------------------------------

local many = {}
for i = 1, 30 do
	many[i] = { key = "library:" .. i, name = "Entry " .. i, source = "library", ordered = false, buildings = { b("armsolar") } }
end
local tall = MODEL.new()
MODEL.refresh(tall, many, PLACE, game, CAN)
tall.open = true
local LT = MODEL.layout(tall, measure, VIEW)
local shown = #hitsOf(LT, "place")
check("rows past the panel's height are not drawn", shown < 30 and shown >= 3, shown)
check("the shown rows fit the view", (function()
	local p = LT.rects[1]
	return p.y >= 0 and p.y + p.h <= VIEW.h
end)(), show(LT.rects[1]))
check("the first row is Entry 1 before scrolling", hitsOf(LT, "place")[1].action.key == "library:1")
MODEL.scroll(tall, 3)
check("scroll moves the window down", hitsOf(MODEL.layout(tall, measure, VIEW), "place")[1].action.key == "library:4")
MODEL.scroll(tall, -3)
MODEL.scroll(tall, -100)
check("scroll clamps at the top", tall.scroll == 0)
MODEL.scroll(tall, 1000)
check("scroll clamps so the last row stays visible", hitsOf(MODEL.layout(tall, measure, VIEW), "place")[shown].action.key == "library:30", tall.scroll)
check("a panel with few rows does not scroll", (function()
	MODEL.scroll(state, 5)
	return state.scroll == 0
end)())

--------------------------------------------------------------------------------
-- packing
--------------------------------------------------------------------------------

local verts, idx = MODEL.pack({
	{ x = 10, y = 20, w = 100, h = 50, color = { 1, 0, 0, 1 } },
	{ x = 0, y = 0, w = 1, h = 1, color = { 0, 0, 1, 0.5 } },
})
check("pack emits STRIDE floats per vertex, four vertices per rect", #verts == 2 * 4 * MODEL.STRIDE, #verts)
check("pack emits six indices per rect", #idx == 12, #idx)
check("the first vertex is the bottom left corner at depth zero with its colour", same({ verts[1], verts[2], verts[3], verts[6], verts[7], verts[8], verts[9] }, { 10, 20, 0, 1, 0, 0, 1 }), show(verts))
check("the third vertex is the top right corner", verts[27] == 110 and verts[28] == 70, verts[27] .. "," .. verts[28])
check("each vertex carries the rect's shape, no radius or border by default", same({ verts[10], verts[11], verts[12], verts[13] }, { 100, 50, 0, 0 }), show(verts))
local rv = MODEL.pack({ { x = 0, y = 0, w = 40, h = 20, radius = 6, border = 2, color = { 1, 1, 1, 1 } } })
check("a rect's radius and border reach every vertex", rv[12] == 6 and rv[13] == 2 and rv[51] == 6 and rv[52] == 2, show(rv))
check("indices are zero based and the second rect starts at four", same(idx, { 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7 }), show(idx))
check("uvs span the unit square", verts[4] == 0 and verts[5] == 0 and verts[30] == 1 and verts[31] == 1)

local none, noneIdx = MODEL.pack({})
check("packing nothing is empty", #none == 0 and #noneIdx == 0)

-- ground marks: a footprint square on the x, z plane at the building's height
local gv, gi = MODEL.packGround({
	{ x = 320, y = 10, z = 320, defID = 1, facing = 0, blocked = true, def = { xsize = 8, zsize = 4 } },
	{ x = 0, y = 0, z = 0, defID = 1, facing = 1, blocked = false, def = { xsize = 8, zsize = 4 } },
}, { 1, 0, 0, 0.4 }, { 0, 1, 0, 0.4 })
check("ground marks pack one quad per position", #gv == 2 * 4 * MODEL.STRIDE and #gi == 12)
check("a mark spans the footprint about the centre, half the size in elmos each way", gv[1] == 320 - 32 and gv[3] == 320 - 16 and gv[27] == 320 + 32 and gv[29] == 320 + 16, show({ gv[1], gv[3], gv[27], gv[29] }))
check("a mark floats just above the ground", gv[2] == 10 + 2)
check("an odd facing swaps the span", gv[53] == -16 and gv[55] == -32, show({ gv[53], gv[55] }))
check("a blocked mark takes the first colour and an open one the second", gv[6] == 1 and gv[59] == 1, show({ gv[6], gv[59] }))
check("a mark is a square cornered box its own size", same({ gv[10], gv[11], gv[12], gv[13] }, { 64, 32, 0, 0 }), show({ gv[10], gv[11], gv[12], gv[13] }))

--------------------------------------------------------------------------------
-- the orthographic matrix for the shader
--------------------------------------------------------------------------------

local m = MODEL.ortho(1920, 1080)
check("ortho is sixteen numbers", #m == 16)
-- column major: x maps to 2/w - 1, y to 2/h - 1
check("ortho maps the view to clip space", m[1] == 2 / 1920 and m[6] == 2 / 1080 and m[13] == -1 and m[14] == -1 and m[16] == 1, show(m))

support.report()
