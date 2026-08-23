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
	gameName = "Test Game 1.0",
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
check("a name only binding matches the full name", MODEL.forGame({ game = { name = "Test Game 1.0" } }, game))
check("a name only binding to another build is not", not MODEL.forGame({ game = { name = "Test Game 2.0" } }, game))
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
check("the panel sits inside the view on the right", L.rects[1].x + L.rects[1].w <= VIEW.w and L.rects[1].y >= 0 and L.rects[1].y + L.rects[1].h <= VIEW.h, show(L.rects[1]))

local function textsWith(layout, needle)
	local found = {}
	for _, t in ipairs(layout.texts) do
		if t.text:find(needle, 1, true) then
			found[#found + 1] = t
		end
	end
	return found
end
check("the title is drawn", #textsWith(L, "Blueprints") == 1)
check("tabs show their counts", #textsWith(L, "Now 3") == 1 and #textsWith(L, "Partly 2") == 1 and #textsWith(L, "All 6") == 1, show(L.texts))
check("every visible row has its name", #textsWith(L, "Eco") == 1 and #textsWith(L, "BAR one") == 1)
check("a row says where it came from", #textsWith(L, "BAR") >= 1 and #textsWith(L, "saved") == 1, show(L.texts))
check("an ordered entry says so", #textsWith(L, "ordered") == 2, show(textsWith(L, "ordered")))

local pics = L.pics
check("rows show build pictures by def id", #pics > 0 and pics[1].defID == 1, show(pics[1]))
check("a row shows at most five pictures", (function()
	local perRow = {}
	for _, p in ipairs(pics) do
		perRow[p.row] = (perRow[p.row] or 0) + 1
	end
	for _, n in pairs(perRow) do
		if n > 5 then
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
check("there is a save button and a close button", #hitsOf(L, "save") == 1 and #hitsOf(L, "close") == 1)

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

-- a closed panel draws nothing
state.open = false
local LC = MODEL.layout(state, measure, VIEW)
check("a closed panel has no rects, texts or hits", #LC.rects == 0 and #LC.texts == 0 and #LC.hits == 0)
state.open = true

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
check("rows past the panel's height are not drawn", shown < 30 and shown >= 8, shown)
check("the first row is Entry 1 before scrolling", hitsOf(LT, "place")[1].action.key == "library:1")
MODEL.scroll(tall, 3)
check("scroll moves the window down", hitsOf(MODEL.layout(tall, measure, VIEW), "place")[1].action.key == "library:4")
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
check("pack emits eight floats per vertex, four vertices per rect", #verts == 2 * 4 * 8, #verts)
check("pack emits six indices per rect", #idx == 12, #idx)
check("the first vertex is the bottom left corner with its colour", same({ verts[1], verts[2], verts[5], verts[6], verts[7], verts[8] }, { 10, 20, 1, 0, 0, 1 }), show(verts))
check("the third vertex is the top right corner", verts[17] == 110 and verts[18] == 70, verts[17] .. "," .. verts[18])
check("indices are zero based and the second rect starts at four", same(idx, { 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7 }), show(idx))
check("uvs span the unit square", verts[3] == 0 and verts[4] == 0 and verts[19] == 1 and verts[20] == 1)

local none, noneIdx = MODEL.pack({})
check("packing nothing is empty", #none == 0 and #noneIdx == 0)

--------------------------------------------------------------------------------
-- the orthographic matrix for the shader
--------------------------------------------------------------------------------

local m = MODEL.ortho(1920, 1080)
check("ortho is sixteen numbers", #m == 16)
-- column major: x maps to 2/w - 1, y to 2/h - 1
check("ortho maps the view to clip space", m[1] == 2 / 1920 and m[6] == 2 / 1080 and m[13] == -1 and m[14] == -1 and m[16] == 1, show(m))

support.report()
