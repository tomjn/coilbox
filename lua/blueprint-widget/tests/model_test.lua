-- Run: luajit lua/blueprint-widget/tests/model_test.lua
--
-- The panel's state and layout: which entries show under which tab, where
-- every rectangle and line of text goes, what a click hits, and how the
-- rectangles pack into the vertex and index arrays the widget uploads.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local MODEL = support.module("model.lua")
local PLACE = support.module("place.lua")

local SOLAR = support.def(1, "armsolar", { isBuilding = true, xsize = 8, zsize = 8, humanName = "Solar Collector", energyUpkeep = -20 })
local LLT = support.def(2, "armllt", { isBuilding = true, xsize = 6, zsize = 6, humanName = "Light Laser Tower", weapons = { { weaponDef = 1 } } })
local LAB = support.def(4, "armlab", { isBuilding = true, xsize = 12, zsize = 12, buildOptions = { 10 } })
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
check("there is a save button and a collapse button", #hitsOf(L, "save") == 1 and #hitsOf(L, "close") == 1)
check("the collapse button is the last thing in the header, right of the tabs", (function()
	local c, tabs, p = hitsOf(L, "close")[1], hitsOf(L, "tab"), L.rects[1]
	return c.x > tabs[3].x + tabs[3].w and c.x + c.w == p.x + p.w - MODEL.PAD and c.y == tabs[3].y
end)(), show(hitsOf(L, "close")))
check("labels sit on the middle of their buttons", (function()
	local saveHit = hitsOf(L, "save")[1]
	for _, t in ipairs(L.texts) do
		if t.text == "Save selection" then
			return t.y == saveHit.y + saveHit.h / 2
		end
	end
	return false
end)())
check("the footer switches between the list and the grid", #hitsOf(L, "view") == 2 and hitsOf(L, "view")[1].action.view == "grid" and hitsOf(L, "view")[2].action.view == "list")
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
state.keys = { left = { "[" }, right = { "]" } }
state.remainder = { count = 3 }
state.message = "Saved Base on Map 2"
local LP = MODEL.layout(state, measure, VIEW)
check("the placing line says how to turn and drop it, not the name again", #textsWith(LP, "[ ] turn") == 1 and #textsWith(LP, "Placing") == 0 and #textsWith(LP, "Eco") == 1, show(LP.texts))
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
state.placing, state.remainder, state.message, state.keys = nil, nil, nil, {}

check("the hint names the keys bound to turning", MODEL.placingHint({ left = { "q", "[" }, right = { "e" } }) == "q e turn, right click cancels", MODEL.placingHint({ left = { "q" }, right = { "e" } }))
check("with nothing bound to turning the hint leaves it out", MODEL.placingHint({}) == "right click cancels" and MODEL.placingHint({ left = {}, right = {} }) == "right click cancels")

-- stepping through the blueprints with a key
local stepping = MODEL.new()
MODEL.refresh(stepping, ENTRIES, PLACE, game, CAN)
check("a step forward with nothing placed picks the first", MODEL.step(stepping, 1) == "library:eco", MODEL.step(stepping, 1))
check("a step back with nothing placed picks the last", MODEL.step(stepping, -1) == "bar:1", MODEL.step(stepping, -1))
stepping.placing = { key = "library:eco" }
check("a step forward goes to the next", MODEL.step(stepping, 1) == "spool:1", MODEL.step(stepping, 1))
check("a step back from the first wraps to the last", MODEL.step(stepping, -1) == "bar:1", MODEL.step(stepping, -1))
stepping.placing = { key = "bar:1" }
check("a step forward from the last wraps to the first", MODEL.step(stepping, 1) == "library:eco")
MODEL.setTab(stepping, "all")
stepping.placing = { key = "library:mixed" }
check("a step skips entries with nothing in this game", MODEL.step(MODEL.new(), 1) == nil and (function()
	local only = MODEL.new()
	MODEL.refresh(only, { { key = "library:gone", name = "Gone", source = "library", ordered = false, buildings = { b("corgant") } } }, PLACE, game, CAN)
	only.tab = "all"
	return MODEL.step(only, 1) == nil
end)())
check("a step follows the current tab", MODEL.step(stepping, 1) == "library:lab", MODEL.step(stepping, 1))

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
check("a drag past the edges stops flush with them", clamped.x == 0 and clamped.y + clamped.h == VIEW.h, show(clamped))

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

local snapping = MODEL.new()
local start = MODEL.layout(snapping, measure, VIEW).box
MODEL.drag(snapping, start, true, -(start.x - 20), 0, VIEW)
check("dropped near the left edge, the box snaps flush to it", MODEL.layout(snapping, measure, VIEW).box.x == 0, show(MODEL.layout(snapping, measure, VIEW).box))
MODEL.drag(snapping, start, true, -(start.x - 20 - MODEL.SNAP), 0, VIEW)
check("further out than the snap distance, it stays where it was dropped", MODEL.layout(snapping, measure, VIEW).box.x == 20 + MODEL.SNAP, show(MODEL.layout(snapping, measure, VIEW).box))
MODEL.drag(snapping, start, true, 0, VIEW.h - start.y - start.h - 10, VIEW)
local nearTop = MODEL.layout(snapping, measure, VIEW).box
check("dropped near the top, the box snaps flush to it", nearTop.y + nearTop.h == VIEW.h, show(nearTop))

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
MODEL.scroll(tall, -100)
MODEL.reveal(tall, "library:20")
local revealed = hitsOf(MODEL.layout(tall, measure, VIEW), "place")
check("revealing an entry below the window scrolls it to the bottom line", revealed[#revealed].action.key == "library:20", tall.scroll)
MODEL.reveal(tall, "library:2")
check("revealing an entry above the window scrolls it to the top line", hitsOf(MODEL.layout(tall, measure, VIEW), "place")[1].action.key == "library:2", tall.scroll)
local before = tall.scroll
MODEL.reveal(tall, "library:3")
check("revealing an entry already shown does not scroll", tall.scroll == before)
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

-- ground marks: a grid over each footprint that follows the ground
local function slope(x, z)
	return x * 0.5 + z * 0.25
end
local function style(p)
	if p.blocked then
		return { 1, 0, 0, 0.4 }, true
	end
	return { 0, 1, 0, 0.4 }, false
end
local gv, gi = MODEL.packGround({
	{ x = 320, y = 10, z = 320, defID = 1, facing = 0, blocked = true, def = { xsize = 4, zsize = 2 } },
	{ x = 96, y = 0, z = 96, defID = 1, facing = 1, blocked = false, def = { xsize = 4, zsize = 2 } },
}, style, slope)
local K = MODEL.STRIDE
local function vert(i)
	local o = (i - 1) * K
	return { x = gv[o + 1], y = gv[o + 2], z = gv[o + 3], u = gv[o + 4], v = gv[o + 5], r = gv[o + 6], g = gv[o + 7], w = gv[o + 10], h = gv[o + 11], radius = gv[o + 12], stripe = gv[o + 13] }
end
-- the first mark is 32 by 16 elmos: 5 by 3 grid points, 4 by 2 squares
check("a mark has a vertex on every heightmap point inside it", #gv == (5 * 3 + 3 * 5) * K, #gv / K)
check("a mark has two triangles per heightmap square", #gi == (4 * 2 + 2 * 4) * 6, #gi)
check("a mark spans the footprint about the centre", vert(1).x == 320 - 16 and vert(1).z == 320 - 8 and vert(15).x == 320 + 16 and vert(15).z == 320 + 8, show({ vert(1), vert(15) }))
check("every vertex sits on the ground", (function()
	for i = 1, #gv / K do
		local p = vert(i)
		if p.y ~= slope(p.x, p.z) then
			return false
		end
	end
	return true
end)())
check("squares split along the engine's diagonal, top right to bottom left", gi[1] == 0 and gi[2] == 1 and gi[3] == 5 and gi[4] == 1 and gi[5] == 6 and gi[6] == 5, show({ gi[1], gi[2], gi[3], gi[4], gi[5], gi[6] }))
check("uvs span each whole mark", vert(1).u == 0 and vert(1).v == 0 and vert(15).u == 1 and vert(15).v == 1 and vert(3).u == 0.5)
check("each vertex carries the mark's size", vert(1).w == 32 and vert(1).h == 16)
check("the second mark's indices start after the first's vertices", gi[8 * 6 + 1] == 15, gi[8 * 6 + 1])
check("an odd facing swaps the span", vert(16).x == 96 - 8 and vert(16).z == 96 - 16, show(vert(16)))
check("each mark takes the colour its style gives", vert(1).r == 1 and vert(16).g == 1)
check("a mark's corners are rounded as the layout map's buildings are", vert(1).radius == 4 and vert(16).radius == 4, show(vert(1)))
check("a mark the style stripes says so, and an open one does not", vert(1).stripe == 1 and vert(16).stripe == 0)
local _, offGrid = MODEL.packGround({ { x = 4, y = 0, z = 4, defID = 1, facing = 0, def = { xsize = 2, zsize = 2 } } }, style, slope)
-- 16 elmos about x = 4 runs from -4 to 12, so it crosses the lines at 0 and 8
check("a mark off the heightmap grid still meets every line inside it", #offGrid == 3 * 3 * 6, #offGrid)

-- the layout map in each row
local cross = {
	buildings = {
		{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 0, z = -32 } },
		{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = -32, z = 0 } },
		{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 32, z = 0 } },
		{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 0, z = 32 } },
	},
}
local map = MODEL.layoutMap(cross, 30)
check("a cross of four comes out as a cross", (function()
	local north, west, east, south = map[1], map[2], map[3], map[4]
	return north.x == south.x and west.y == east.y and west.x < north.x and east.x > north.x and north.y > west.y and south.y < west.y
end)(), show(map))
check("the map fills the box along the longer side", (function()
	local minX, maxX = math.huge, -math.huge
	for _, r in ipairs(map) do
		minX, maxX = math.min(minX, r.x), math.max(maxX, r.x + r.w)
	end
	return minX == 0 and maxX == 30
end)(), show(map))
local wide = MODEL.layoutMap({ buildings = {
	{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 0, z = 0 } },
	{ def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 64, z = 0 } },
} }, 30)
check("a wide layout is centred top to bottom", math.abs(wide[1].y - (30 - wide[1].y - wide[1].h)) < 1e-9, show(wide))
check("an empty layout maps to nothing", #MODEL.layoutMap({ buildings = {} }, 30) == 0)
check("each row draws its layout map", (function()
	local maps, buildings = 0, 0
	for _, r in ipairs(L.rects) do
		if r.kind == "map" then
			maps = maps + 1
		elseif r.kind == "building" then
			buildings = buildings + 1
		end
	end
	return maps == #hitsOf(L, "place") and buildings > 0
end)())

--------------------------------------------------------------------------------
-- what a building does, and naming a layout by what it holds
--------------------------------------------------------------------------------

check("a building that builds is a builder", MODEL.category(LAB) == "builder" and MODEL.category({ isBuilder = true }) == "builder")
check("an armed building is a weapon", MODEL.category(LLT) == "weapon")
check("a building that makes energy is energy", MODEL.category(SOLAR) == "energy" and MODEL.category({ windGenerator = 25 }) == "energy" and MODEL.category({ tidalGenerator = 20 }) == "energy" and MODEL.category({ energyMake = 1 }) == "energy")
check("anything else is other", MODEL.category({ name = "armmstor" }) == "other")
check("energy is yellow, builders green and weapons red", same(MODEL.categoryColor(SOLAR), MODEL.COLORS.energy) and same(MODEL.categoryColor(LAB), MODEL.COLORS.builder) and same(MODEL.categoryColor(LLT), MODEL.COLORS.weapon) and same(MODEL.categoryColor({}), MODEL.COLORS.building))
check("each building in a layout map takes its category's colour", (function()
	for _, r in ipairs(L.rects) do
		if r.kind == "building" and same(r.color, MODEL.COLORS.energy) then
			return true
		end
	end
	return false
end)())

check("a content name counts each kind, most common first", MODEL.contentName({ LLT, SOLAR, SOLAR, { name = "corgant" } }) == "2 Solar Collector, Light Laser Tower, corgant", MODEL.contentName({ LLT, SOLAR, SOLAR, { name = "corgant" } }))
check("a translated name wins over the def's own", MODEL.contentName({ { humanName = "Solar", translatedHumanName = "Solaire" } }) == "Solaire")
local function itemNamed(name)
	for _, item in ipairs(state.items) do
		if item.entry.name == name then
			return item
		end
	end
end
check("a made up map name shows what the layout holds", itemNamed("Base on Map 1").name == "Light Laser Tower", itemNamed("Base on Map 1").name)
check("a name somebody chose is kept", itemNamed("Eco").name == "Eco")
check("an unnamed BAR layout shows what it holds", MODEL.displayName({ entry = { name = "#3" }, resolved = { buildings = { { def = SOLAR } }, missing = {} } }) == "Solar Collector")

--------------------------------------------------------------------------------
-- the grid view
--------------------------------------------------------------------------------

local plenty = {}
for i = 1, 80 do
	plenty[i] = { key = "library:" .. i, name = "Entry " .. i, source = "library", ordered = false, buildings = { b("armsolar") } }
end
local tiles = MODEL.new()
MODEL.refresh(tiles, plenty, PLACE, game, CAN)
tiles.open = true
MODEL.setView(tiles, "grid")
local LG = MODEL.layout(tiles, measure, VIEW)
local function rectsOf(layout, kind)
	local found = {}
	for _, r in ipairs(layout.rects) do
		if r.kind == kind then
			found[#found + 1] = r
		end
	end
	return found
end
local shownTiles = rectsOf(LG, "tile")
check("the grid lays tiles out in rows of GRID_COLUMNS", #shownTiles % MODEL.GRID_COLUMNS == 0 and #shownTiles > MODEL.GRID_COLUMNS and shownTiles[1].y == shownTiles[MODEL.GRID_COLUMNS].y and shownTiles[MODEL.GRID_COLUMNS + 1].y < shownTiles[1].y, #shownTiles)
check("tiles are square and fill the width between the margins", (function()
	local p, first, last = LG.rects[1], shownTiles[1], shownTiles[MODEL.GRID_COLUMNS]
	return first.w == first.h and first.x == p.x + MODEL.PAD and math.abs(last.x + last.w - (p.x + p.w - MODEL.PAD)) < 1e-9
end)(), show(shownTiles[1]))
check("each tile is clickable to place and draws its layout map", #hitsOf(LG, "place") == #shownTiles and #rectsOf(LG, "map") == #shownTiles)
check("with nothing hovered the strip under the tiles is empty", #rectsOf(LG, "info") == 1 and #rectsOf(LG, "row") == 0)
tiles.hover = MODEL.actionId({ kind = "place", key = "library:2" })
local LGH = MODEL.layout(tiles, measure, VIEW)
check("hovering a tile shows it in the strip as a list row", #rectsOf(LGH, "row") == 1 and rectsOf(LGH, "row")[1].key == "library:2" and #textsWith(LGH, "Entry 2") == 1, show(rectsOf(LGH, "row")))
tiles.hover = nil
tiles.placing = { key = "library:3", name = "Entry 3", rotation = 0 }
local LGP = MODEL.layout(tiles, measure, VIEW)
check("with nothing hovered the strip shows the one being placed, outlined only in the grid", #textsWith(LGP, "Entry 3") == 1 and #rectsOf(LGP, "outline") == 1)
tiles.placing = nil
MODEL.scroll(tiles, 1)
check("the grid scrolls a row of tiles at a time", hitsOf(MODEL.layout(tiles, measure, VIEW), "place")[1].action.key == "library:" .. (MODEL.GRID_COLUMNS + 1))
MODEL.setView(tiles, "list")
check("switching view goes back to the top", tiles.scroll == 0 and tiles.view == "list")
MODEL.setView(tiles, "sideways")
check("an unknown view is ignored", tiles.view == "list")
check("the active view's button is lit", (function()
	for _, r in ipairs(LG.rects) do
		if r.kind == "button" and r.x == hitsOf(LG, "view")[1].x and r.y == hitsOf(LG, "view")[1].y then
			return same(r.color, MODEL.COLORS.pillActive)
		end
	end
	return false
end)())

--------------------------------------------------------------------------------
-- the orthographic matrix for the shader
--------------------------------------------------------------------------------

local m = MODEL.ortho(1920, 1080)
check("ortho is sixteen numbers", #m == 16)
-- column major: x maps to 2/w - 1, y to 2/h - 1
check("ortho maps the view to clip space", m[1] == 2 / 1920 and m[6] == 2 / 1080 and m[13] == -1 and m[14] == -1 and m[16] == 1, show(m))

support.report()
