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
check("Save ground sits right of Save selection on the same line (issue #4798)", (function()
	local save, ground = hitsOf(L, "save")[1], hitsOf(L, "saveGround")[1]
	return #hitsOf(L, "saveGround") == 1 and ground.x > save.x + save.w and ground.y == save.y and #textsWith(L, "Save ground") == 1
end)(), show(hitsOf(L, "saveGround")))
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
state.placing = { key = "library:eco", name = "Eco", rotation = 1, flip = { x = true }, cost = { metal = 450.4, energy = 1200, seconds = 75 } }
state.keys = { left = { "[" }, right = { "]" }, flipX = { "f" }, flipZ = {} }
state.remainder = { count = 3 }
state.message = "Saved Base on Map 2"
local LP = MODEL.layout(state, measure, VIEW)
local function trayHits(L, kind)
	local out = {}
	for _, h in ipairs(hitsOf(L, kind)) do
		if h.x >= L.tray.x and h.x < L.tray.x + L.tray.w then
			out[#out + 1] = h
		end
	end
	return out
end
local function trayTexts(L, needle)
	local out = {}
	for _, t in ipairs(L.texts) do
		if t.text == needle and t.x >= L.tray.x and t.x < L.tray.x + L.tray.w then
			out[#out + 1] = t
		end
	end
	return out
end
local function trayTextsWith(L, needle)
	local out = {}
	for _, t in ipairs(textsWith(L, needle)) do
		if t.x >= L.tray.x and t.x < L.tray.x + L.tray.w then
			out[#out + 1] = t
		end
	end
	return out
end
check("placing opens a panel beside the main one", LP.tray ~= nil and (LP.tray.x + LP.tray.w <= LP.box.x or LP.tray.x >= LP.box.x + LP.box.w), show(LP.tray))
check("the placing panel opens toward the middle of the screen", LP.tray.x < LP.box.x)
check("the placing panel's top lines up with the main panel's", LP.tray.y + LP.tray.h == LP.box.y + LP.box.h)
check("the placing panel names the layout and offers Cancel", #trayTexts(LP, "Eco") == 1 and #trayHits(LP, "cancel") == 1, show(LP.texts))
check("the main panel no longer has a placing line", #hitsOf(LP, "cancel") == 1 and #textsWith(LP, "turn,") == 0)
check("the cost line gives metal, energy and the build time", #trayTextsWith(LP, "450 metal, 1200 energy, 1:15 to build") == 1, show(LP.texts))
check("each key is a button labelled with the key bound to it", #trayTexts(LP, "[") == 1 and #trayTexts(LP, "]") == 1 and #trayTexts(LP, "F") == 1)
check("a key with nothing bound gets a word instead", #trayTexts(LP, "Down") == 1)
check("the turn buttons turn each way", #trayHits(LP, "turn") == 2 and trayHits(LP, "turn")[1].action.delta == -1)
check("the flip buttons flip each axis", #trayHits(LP, "flip") == 2 and trayHits(LP, "flip")[1].action.axis == "x" and trayHits(LP, "flip")[2].action.axis == "z")
check("the builders choice has both modes", #trayHits(LP, "assist") == 2)
check("the tray's background counts as the panel, so a click there is not a placement", (function()
	local a = MODEL.hit(LP, LP.tray.x + 2, LP.tray.y + 2)
	return a ~= nil and a.kind == "panel"
end)())
check("every control in the placing panel sits inside it", (function()
	for _, h in ipairs(LP.hits) do
		if h.x >= LP.tray.x and h.x < LP.tray.x + LP.tray.w then
			if h.x + h.w > LP.tray.x + LP.tray.w or h.y < LP.tray.y or h.y + h.h > LP.tray.y + LP.tray.h then
				return false
			end
		end
	end
	return true
end)())
check("controls in a row of the placing panel do not overlap its label", (function()
	for _, t in ipairs(LP.texts) do
		if t.text == "Builders" then
			for _, h in ipairs(trayHits(LP, "assist")) do
				if h.x < t.x + measure(t.text, t.size) then
					return false
				end
			end
			return true
		end
	end
end)())
local lifted = (function()
	local active
	for _, r in ipairs(LP.rects) do
		if r.kind == "button" and same(r.color, MODEL.COLORS.pillActive) and r.x >= LP.tray.x and r.x < LP.tray.x + LP.tray.w then
			active = (active or 0) + 1
		end
	end
	return active
end)()
check("the flip that is on and the builders mode in use are lit", lifted == 2, tostring(lifted))
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
check("nothing placing, no placing panel", MODEL.layout(state, measure, VIEW).tray == nil)

local leftSide = MODEL.new()
leftSide.open = true
leftSide.pos = { x = 0, y = 0.9, right = false }
leftSide.placing = { key = "x", name = "X", rotation = 0 }
local LL = MODEL.layout(leftSide, measure, VIEW)
check("with the panel on the left the placing panel opens to its right", LL.tray.x >= LL.box.x + LL.box.w, show(LL.tray))
leftSide.open = false
local LC = MODEL.layout(leftSide, measure, VIEW)
check("with the panel closed the placing panel sits beside its tab", LC.tray ~= nil and LC.tray.x >= LC.box.x + LC.box.w)

check("a key label puts a letter in capitals", MODEL.keyLabel({ "g" }, "Down") == "G" and MODEL.keyLabel({ "Shift+[" }, "x") == "Shift+[" and MODEL.keyLabel({}, "Down") == "Down")
check("the cost line leaves out the time with no builder", MODEL.costLine({ metal = 10, energy = 0 }) == "10 metal, 0 energy")
check("times read as minutes and seconds", MODEL.clockTime(5) == "0:05" and MODEL.clockTime(3599.6) == "60:00")
local assisting = MODEL.new()
check("builders help each other unless told otherwise", assisting.assist == "help")
MODEL.setAssist(assisting, "split")
MODEL.setAssist(assisting, "sideways")
check("the builders mode switches, and an unknown one is ignored", assisting.assist == "split")

-- a layout with another side's buildings
local sided = MODEL.new()
local reachNone = {}
MODEL.refresh(sided, ENTRIES, PLACE, game, CAN, { reach = reachNone })
check("with a reach given, a layout outside it goes under no tab but All", sided.counts.now == 0 and sided.counts.partly == 0 and sided.counts.all > 0, show(sided.counts))
sided.tab = "all"
sided.open = true
check("a row says how many buildings are from another side", #textsWith(MODEL.layout(sided, measure, VIEW), "from another side") > 0)
check("stepping skips layouts from another side", MODEL.step(sided, 1) == nil)

local upgrading = MODEL.new()
MODEL.refresh(upgrading, ENTRIES, PLACE, game, CAN, { standIns = { [1] = 2 } })
upgrading.tab, upgrading.open = "all", true
check("a row says how many buildings start a tier lower, to upgrade", #textsWith(MODEL.layout(upgrading, measure, VIEW), "to upgrade") > 0)

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
-- pages
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
check("the first row is Entry 1 on the first page", hitsOf(LT, "place")[1].action.key == "library:1")
local pagerOf = function(L)
	local out = {}
	for _, h in ipairs(L.hits) do
		if h.action.kind == "page" then
			out[h.action.delta] = h
		end
	end
	return out
end
check("on the first page only the next page button can be clicked", pagerOf(LT)[1] ~= nil and pagerOf(LT)[-1] == nil)
check("the pager says which page of how many", #textsWith(LT, "1 / " .. math.ceil(30 / shown)) == 1)
MODEL.turnPage(tall, 1)
local page2 = MODEL.layout(tall, measure, VIEW)
check("the next page starts after the last row of the first", hitsOf(page2, "place")[1].action.key == "library:" .. (shown + 1))
check("the pager sits right of Save selection", (function()
	for _, h in ipairs(page2.hits) do
		if h.action.kind == "save" then
			return pagerOf(page2)[-1].x > h.x + h.w
		end
	end
end)())
check("the pager sits right of Save ground", pagerOf(page2)[-1].x > hitsOf(page2, "saveGround")[1].x + hitsOf(page2, "saveGround")[1].w)
check("every page is as tall as a full one", page2.box.h == LT.box.h, page2.box.h .. " vs " .. LT.box.h)
do
	-- so many pages that "10 / 40" would run into Save ground
	local lots = {}
	for i = 1, 40 * shown do
		lots[i] = { key = "library:" .. i, name = "Entry " .. i, source = "library", ordered = false, buildings = { b("armsolar") } }
	end
	local long = MODEL.new()
	MODEL.refresh(long, lots, PLACE, game, CAN)
	long.open = true
	MODEL.layout(long, measure, VIEW)
	MODEL.turnPage(long, 9)
	local LL = MODEL.layout(long, measure, VIEW)
	local ground = hitsOf(LL, "saveGround")[1]
	check("a pager label too long for the footer is left out rather than drawn over Save ground", pagerOf(LL)[-1].x > ground.x + ground.w and #textsWith(LL, "10 / 40") == 0, show(pagerOf(LL)[-1]))
end
MODEL.turnPage(tall, -100)
check("turning back stops at the first page", tall.page == 0)
MODEL.turnPage(tall, 1000)
local last = MODEL.layout(tall, measure, VIEW)
local lastHits = hitsOf(last, "place")
check("turning on stops at the last page, which ends with the last entry", lastHits[#lastHits].action.key == "library:30" and pagerOf(last)[1] == nil and pagerOf(last)[-1] ~= nil, tall.page)
check("a short last page keeps the panel's height", last.box.h == LT.box.h)
MODEL.reveal(tall, "library:2")
check("revealing an entry turns to its page", tall.page == 0)
MODEL.reveal(tall, "library:" .. (shown + 2))
check("revealing an entry on another page turns to that page", tall.page == 1)
check("a panel with one page has no pager and does not turn", (function()
	MODEL.turnPage(state, 5)
	local L = MODEL.layout(state, measure, VIEW)
	return state.page == 0 and next(pagerOf(L)) == nil
end)())

-- moving out of another panel's way
local other = { x = 1500, y = 300, w = 420, h = 200 }
local function coveredBy(rects)
	return function(x, y)
		for _, r in ipairs(rects) do
			if x >= r.x and x < r.x + r.w and y >= r.y and y < r.y + r.h then
				return true
			end
		end
		return false
	end
end
local base = { x = 1600, y = 400, w = 300, h = 300 }
local dy = MODEL.clearOffset(base, VIEW.h, coveredBy({ other }), 24)
check("a covered box moves just clear of the other panel", base.y + dy >= other.y + other.h and base.y + dy - 24 < other.y + other.h, tostring(dy))
check("a clear box stays put", MODEL.clearOffset(base, VIEW.h, coveredBy({}), 24) == 0)
local down = MODEL.clearOffset({ x = 1600, y = 150, w = 300, h = 300 }, VIEW.h, coveredBy({ { x = 1500, y = 300, w = 420, h = 700 } }), 24)
check("it moves down, flush to the screen's edge when that is what clears it", down == -150, tostring(down))
check("with nowhere clear it stays put", MODEL.clearOffset(base, VIEW.h, coveredBy({ { x = 0, y = 0, w = VIEW.w, h = VIEW.h } }), 24) == 0)
local nudged = MODEL.new()
nudged.open = true
local before = MODEL.layout(nudged, measure, VIEW).box.y
nudged.nudge = 50
check("the layout applies the nudge", MODEL.layout(nudged, measure, VIEW).box.y == before + 50)

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
		return { 1, 0, 0, 0.4 }, MODEL.MARK_REFUSED + MODEL.MARK_HOVERED
	end
	return { 0, 1, 0, 0.4 }, 0
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
check("a mark carries the flags its style gives", vert(1).stripe == MODEL.MARK_REFUSED + MODEL.MARK_HOVERED and vert(16).stripe == 0)
check("the mark flags are separate bits", MODEL.MARK_REFUSED == 1 and MODEL.MARK_HOVERED == 2 and MODEL.MARK_CANNOT == 4)
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
check("an empty layout with no steps has no marks", #select(2, MODEL.layoutMap({ buildings = {} }, 30, {})) == 0)

-- terrain steps in the layout map (issue #4795)
local function near(a, b)
	return math.abs(a - b) < 1e-6
end
local wallStep = { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 160, z = 0 } }, height = 16, before = 0 }
local wallBoxes, wallMarks = MODEL.layoutMap({ buildings = {} }, 30, { wallStep })
check("a layout of one wall has a mark and no building boxes", #wallBoxes == 0 and #wallMarks == 1, show(wallMarks))
local wallMark = wallMarks[1]
check("a wall is drawn 9.6 elmos thick, scaled with the map", near(wallMark.thickness, 9.6 * 30 / 169.6), show(wallMark))
check("a layout with no buildings fills the box along its longer side, wall ends included", (function()
	local lo = math.min(wallMark.points[1].x, wallMark.points[2].x) - wallMark.thickness / 2
	local hi = math.max(wallMark.points[1].x, wallMark.points[2].x) + wallMark.thickness / 2
	return near(lo, 0) and near(hi, 30)
end)(), show(wallMark))
check("a wall alone is centred top to bottom", near(wallMark.points[1].y, 15) and near(wallMark.points[2].y, 15), show(wallMark))
check("a wall of raised ground is up", wallMark.tone == "up" and wallMark.band == nil and wallMark.arrow == nil)

local padStep = {
	kind = "level",
	shape = "area",
	points = { { x = -80, z = -80 }, { x = 80, z = -80 }, { x = 80, z = 80 }, { x = -80, z = 80 } },
	height = 0,
	before = 0,
}
local padBoxes, padMarks = MODEL.layoutMap(
	{ buildings = { { def = { xsize = 4, zsize = 4 }, facing = 0, offset = { x = 0, z = 0 } } } },
	30,
	{ padStep }
)
check("the frame covers a pad round a factory, so the building is in the middle", near(padBoxes[1].x + padBoxes[1].w / 2, 15) and near(padBoxes[1].y + padBoxes[1].h / 2, 15), show(padBoxes))
check("a pad fills the whole box", (function()
	local lo, hi = math.huge, -math.huge
	for _, p in ipairs(padMarks[1].points) do
		lo, hi = math.min(lo, p.x), math.max(hi, p.x)
	end
	return near(lo, 0) and near(hi, 30)
end)(), show(padMarks))
check("a level of height 0 moves the ground neither way", padMarks[1].tone == "even")
check("an area is flipped as the buildings are, z down the screen", (function()
	local _, marks = MODEL.layoutMap({ buildings = {} }, 30, { { kind = "raise", shape = "area", points = { { x = 0, z = 0 }, { x = 16, z = 0 }, { x = 0, z = 32 } }, height = 4, before = 0 } })
	local top, bottom = marks[1].points[3], marks[1].points[1]
	return top.y < bottom.y
end)())
local _, dugMarks = MODEL.layoutMap({ buildings = {} }, 30, {
	{ kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 16, z = 0 } }, height = -8, before = 0 },
	{ kind = "smooth", shape = "wall", points = { { x = 0, z = 0 }, { x = 16, z = 0 } }, before = 0 },
})
check("dug ground is down and a smooth is even", dugMarks[1].tone == "down" and dugMarks[2].tone == "even", show(dugMarks))

local function ramp(low, high)
	local _, marks = MODEL.layoutMap({ buildings = {} }, 30, { { kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 80, z = 0 } }, heights = { low, high }, width = 32, before = 0 } })
	return marks[1]
end
local upRamp, downRamp = ramp(0, 20), ramp(20, 0)
check("a ramp is a band of four corners", #upRamp.band == 4, show(upRamp))
check("a ramp's band is its full width across, in map units", (function()
	local lo, hi = math.huge, -math.huge
	for _, p in ipairs(upRamp.band) do
		lo, hi = math.min(lo, p.y), math.max(hi, p.y)
	end
	return near(hi - lo, 30 * 32 / 80)
end)(), show(upRamp.band))
check("the arrow of a ramp rising to the right points right", upRamp.arrow ~= nil and upRamp.arrow[2].x > upRamp.arrow[1].x, show(upRamp.arrow))
check("the arrow of a ramp falling to the right points left", downRamp.arrow ~= nil and downRamp.arrow[2].x < downRamp.arrow[1].x, show(downRamp.arrow))
check("a ramp between equal heights has no arrow", ramp(5, 5).arrow == nil)
check("a ramp takes its tone from the mean of its two heights", ramp(-30, 10).tone == "down" and ramp(0, 20).tone == "up" and ramp(-5, 5).tone == "even")
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
check("with nothing hovered the strip shows the one being placed, outlined only in the grid", (function()
	local inPanel = 0
	for _, t in ipairs(textsWith(LGP, "Entry 3")) do
		if t.x >= LGP.box.x and t.x < LGP.box.x + LGP.box.w then
			inPanel = inPanel + 1
		end
	end
	return inPanel == 1 and #rectsOf(LGP, "outline") == 1
end)())
tiles.placing = nil
MODEL.turnPage(tiles, 1)
check("a grid page is whole rows of tiles", hitsOf(MODEL.layout(tiles, measure, VIEW), "place")[1].action.key == "library:" .. (#shownTiles + 1) and #shownTiles % MODEL.GRID_COLUMNS == 0)
MODEL.setView(tiles, "list")
check("switching view goes back to the first page", tiles.page == 0 and tiles.view == "list")
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

--------------------------------------------------------------------------------
-- the count line counts terrain changes (issue #4790)
--------------------------------------------------------------------------------

local terrainStep = { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 32, z = 0 } }, height = 8, before = 0 }
local TERRAIN_ENTRIES = {
	{ key = "library:walls", name = "Walls", source = "library", ordered = false, buildings = {}, terrain = { terrainStep, terrainStep, terrainStep } },
	{ key = "library:both", name = "Both", source = "library", ordered = false, buildings = { b("armsolar") }, terrain = { terrainStep } },
	{ key = "library:plain", name = "Plain", source = "library", ordered = false, buildings = { b("armsolar") } },
}
local terrainState = MODEL.new()
MODEL.refresh(terrainState, TERRAIN_ENTRIES, PLACE, game, CAN)
terrainState.open = true
terrainState.tab = "all"
local LT2 = MODEL.layout(terrainState, measure, VIEW)
check("a layout of walls only is in the list", #terrainState.items == 3 and terrainState.counts.all == 3, show(terrainState.counts))
local function detailOf(key)
	for _, item in ipairs(terrainState.items) do
		if item.entry.key == key then
			return MODEL.rowDetail(item)
		end
	end
end
check("a layout with no buildings and steps says why it cannot be picked up when nothing can terraform", detailOf("library:walls") == "no terraforming here | coilbox | No buildings, 3 terrain changes", detailOf("library:walls"))
check("a layout with both counts both", detailOf("library:both") == "coilbox | 1 building, 1 terrain change", detailOf("library:both"))
check("a layout with no steps counts buildings only", detailOf("library:plain") == "coilbox | 1 building", detailOf("library:plain"))
check("a layout of walls only is not offered to step through when nothing can terraform", MODEL.step(terrainState, 1) == "library:both" and MODEL.step(terrainState, -1) == "library:plain", tostring(MODEL.step(terrainState, 1)))
check("it is under no tab but All", terrainState.items[1].tab == "never" and terrainState.items[1].placeable == false and terrainState.items[2].placeable == true)

-- filling an area (issue #4795)
local function trianglesArea(tris)
	local total = 0
	for _, t in ipairs(tris) do
		local a, b, c = t[1], t[2], t[3]
		local twice = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
		if twice < 0 then
			return nil
		end
		total = total + twice / 2
	end
	return total
end
local square = { { x = 0, y = 0 }, { x = 4, y = 0 }, { x = 4, y = 4 }, { x = 0, y = 4 } }
local ell = { { x = 0, y = 0 }, { x = 4, y = 0 }, { x = 4, y = 2 }, { x = 2, y = 2 }, { x = 2, y = 4 }, { x = 0, y = 4 } }
local function reversed(points)
	local out = {}
	for i = #points, 1, -1 do
		out[#out + 1] = points[i]
	end
	return out
end
check("a square is two triangles that cover it", #MODEL.triangulate(square) == 2 and trianglesArea(MODEL.triangulate(square)) == 16)
check("a concave outline is cut to cover exactly its own area", trianglesArea(MODEL.triangulate(ell)) == 12, tostring(trianglesArea(MODEL.triangulate(ell))))
check("an outline drawn the other way round covers the same area", trianglesArea(MODEL.triangulate(reversed(ell))) == 12)
check("fewer than three points is nothing to fill", #MODEL.triangulate({ { x = 0, y = 0 }, { x = 1, y = 1 } }) == 0)

-- a row draws its steps under its buildings (issue #4795)
local function kindsOf(L, kind)
	local out = {}
	for i, r in ipairs(L.rects) do
		if r.kind == kind then
			out[#out + 1] = i
		end
	end
	return out
end
check("a layout of walls only draws terrain in its map and no building", (function()
	local wallsOnly = MODEL.new()
	MODEL.refresh(wallsOnly, { TERRAIN_ENTRIES[1] }, PLACE, game, CAN)
	wallsOnly.open, wallsOnly.tab = true, "all"
	local L = MODEL.layout(wallsOnly, measure, VIEW)
	return #kindsOf(L, "map") == 1 and #kindsOf(L, "terrain") > 0 and #kindsOf(L, "building") == 0
end)())
check("steps are drawn after the map and before the buildings", (function()
	local both = MODEL.new()
	MODEL.refresh(both, { TERRAIN_ENTRIES[2] }, PLACE, game, CAN)
	both.open, both.tab = true, "all"
	local L = MODEL.layout(both, measure, VIEW)
	local map, terrain, building = kindsOf(L, "map")[1], kindsOf(L, "terrain"), kindsOf(L, "building")
	return #terrain > 0 and #building == 1 and map < terrain[1] and terrain[#terrain] < building[1]
end)())
check("every terrain rect has a bounding box and four corners", (function()
	for _, i in ipairs(kindsOf(LT2, "terrain")) do
		local r = LT2.rects[i]
		if not (r.corners and #r.corners == 4 and r.w and r.h and r.color) then
			return false
		end
	end
	return true
end)())
check("a rect with corners packs at its corners, not its box", (function()
	local verts, idx = MODEL.pack({ { x = 0, y = 0, w = 10, h = 10, color = { 1, 0, 0, 1 }, kind = "terrain", corners = { { 0, 5 }, { 5, 0 }, { 10, 5 }, { 5, 10 } } } })
	local S = MODEL.STRIDE
	return #verts == 4 * S and #idx == 6 and verts[1] == 0 and verts[2] == 5 and verts[S + 1] == 5 and verts[S + 2] == 0 and verts[3 * S + 1] == 5 and verts[3 * S + 2] == 10
end)())
check("a rect without corners still packs at its box", (function()
	local verts = MODEL.pack({ { x = 1, y = 2, w = 3, h = 4, color = { 1, 1, 1, 1 }, kind = "building" } })
	local S = MODEL.STRIDE
	return verts[1] == 1 and verts[2] == 2 and verts[2 * S + 1] == 4 and verts[2 * S + 2] == 6
end)())

-- a builder that can terraform
local TERRAFORMER = support.def(12, "zkcon", { buildOptions = { 1, 2 } })
local TE = support.engine({ SOLAR, LLT, LAB, CON, TERRAFORMER }, {
	units = { [100] = { def = 10 }, [101] = { def = 12, cmdDescs = { { id = 39736, action = "levelground" } } } },
	gameShortName = "TEST",
})
PLACE.use(TE)
local CAN_TF = PLACE.capabilities({ 101 })
local tf = MODEL.new()
check("terrain is on unless the player turns it off", tf.terrain == true)
MODEL.refresh(tf, TERRAIN_ENTRIES, PLACE, game, CAN_TF)
tf.open, tf.tab = true, "all"
check("with a builder that can terraform, a layout of walls only is now", tf.items[1].tab == "now" and tf.items[1].placeable == true and tf.items[1].stop == nil and tf.counts.now == 3, show(tf.counts))
check("its row has no reason", MODEL.rowDetail(tf.items[1]) == "coilbox | No buildings, 3 terrain changes", MODEL.rowDetail(tf.items[1]))
check("it can be stepped to", MODEL.step(tf, 1) == "library:walls")
MODEL.setTerrain(tf, false)
MODEL.setTerrain(tf, "sideways")
check("the terrain choice switches off, and a value that is not a boolean is ignored", tf.terrain == false)
MODEL.refresh(tf, TERRAIN_ENTRIES, PLACE, game, CAN_TF)
check("with terrain off a layout of walls only cannot be picked up, and its row says so", tf.items[1].placeable == false and tf.items[1].tab == "never" and MODEL.rowDetail(tf.items[1]) == "Terrain is off | coilbox | No buildings, 3 terrain changes", MODEL.rowDetail(tf.items[1]))
check("a layout with buildings can still be picked up with terrain off", tf.items[2].placeable == true and tf.items[2].stop == nil)
check("a layout with nothing in this game is not placeable", (function()
	local gone = MODEL.new()
	MODEL.refresh(gone, { { key = "k", name = "k", source = "library", ordered = false, buildings = { b("corgant") } } }, PLACE, game, CAN_TF)
	return gone.items[1].placeable == false
end)())

-- with no builder selected the widget says whether the match has terraform
local watching = PLACE.capabilities({})
watching.terraformAvailable = true
local planning = MODEL.new()
MODEL.refresh(planning, TERRAIN_ENTRIES, PLACE, game, watching)
check("with no builder selected, a match known to have terraform lets walls be picked up", planning.items[1].placeable == true and planning.items[1].tab == "now")
local locked = PLACE.capabilities({ 100 })
locked.terraformAvailable = false
MODEL.refresh(planning, TERRAIN_ENTRIES, PLACE, game, locked)
check("a match without it does not", planning.items[1].placeable == false)

-- the Terrain choice in the placing panel
local function terrainHits(L)
	local out = {}
	for _, h in ipairs(L.hits) do
		if h.action.kind == "terrain" then
			out[#out + 1] = h
		end
	end
	return out
end
local tray = MODEL.new()
tray.open = true
tray.placing = { key = "x", name = "X", rotation = 0, flip = { x = false, z = false } }
local plain = MODEL.layout(tray, measure, VIEW)
check("the placing panel has no Terrain choice unless the blueprint has steps and terraform is there", #terrainHits(plain) == 0 and #textsWith(plain, "Terrain") == 0)
tray.placing.terrain = true
local withTerrain = MODEL.layout(tray, measure, VIEW)
check("with them it has On and Off", #terrainHits(withTerrain) == 2)
check("the row is labelled Terrain", #textsWith(withTerrain, "Terrain") == 1)
check("the tray grows by the row and its controls stay inside it", withTerrain.tray.h > plain.tray.h and (function()
	for _, h in ipairs(terrainHits(withTerrain)) do
		if h.y < withTerrain.tray.y or h.y + h.h > withTerrain.tray.y + withTerrain.tray.h or h.x + h.w > withTerrain.tray.x + withTerrain.tray.w then
			return false
		end
	end
	return true
end)())
check("On is lit while terrain is on", (function()
	for _, h in ipairs(terrainHits(withTerrain)) do
		if h.action.mode == "on" then
			for _, r in ipairs(withTerrain.rects) do
				if r.kind == "button" and r.x == h.x and r.y == h.y then
					return same(r.color, MODEL.COLORS.pillActive)
				end
			end
		end
	end
	return false
end)())
check("the two choices have different ids for the hover", MODEL.actionId(terrainHits(withTerrain)[1].action) ~= MODEL.actionId(terrainHits(withTerrain)[2].action))

--------------------------------------------------------------------------------
-- the drawings are big enough to read in a real match (issue #4819)
--------------------------------------------------------------------------------

-- The five example blueprints from the milestone, with Zero-K's footprints:
-- a Lotus is 2 squares across and a solar collector 5. The layout maps in a
-- row or a tile are under 40 pixels across, so a wall 0.6 of a square thick
-- in a layout of 20 squares is under a pixel, and a Lotus two. The tests of
-- layoutMap above passed while a real match drew the first as a dot, the
-- trench as a hairline and the ring as an empty square.
do
	local LOTUS = support.def(21, "turretlaser", { isBuilding = true, xsize = 4, zsize = 4, weapons = { { weaponDef = 1 } } })
	local SOLAR_ZK = support.def(22, "energysolar", { isBuilding = true, xsize = 10, zsize = 10, energyMake = 2 })
	local CON_ZK = support.def(23, "cloakcon", { buildOptions = { 21, 22 } })
	local ZK = support.engine({ LOTUS, SOLAR_ZK, CON_ZK }, {
		selected = { 200 },
		units = { [200] = { def = 23 } },
		gameName = "Zero-K",
		modName = "Zero-K v1.14.10.3",
		gameShortName = "ZK",
	})
	PLACE.use(ZK)
	local zkCan = PLACE.capabilities({ 200 })
	local function p(x, z)
		return { x = x, z = z }
	end
	local EXAMPLES = {
		{
			key = "library:outpost",
			name = "Example: walled outpost",
			buildings = { b("turretlaser", 0, 0), b("turretlaser", 320, 0), b("turretlaser", 320, 320), b("turretlaser", 0, 320), b("energysolar", 160, 160) },
			terrain = { { kind = "raise", shape = "wall", points = { p(0, 0), p(320, 0), p(320, 320), p(0, 320), p(0, 0) }, height = 112, before = 0 } },
		},
		{
			key = "library:plaza",
			name = "Example: raised plaza",
			buildings = { b("energysolar", 64, 64), b("energysolar", 192, 64), b("energysolar", 64, 192), b("energysolar", 192, 192) },
			terrain = { { kind = "level", shape = "area", points = { p(0, 0), p(256, 0), p(256, 256), p(0, 256) }, height = 40, before = 0 } },
		},
		{
			key = "library:ramp",
			name = "Example: ramp up to a platform",
			buildings = { b("turretlaser", 96, 96) },
			terrain = {
				{ kind = "level", shape = "area", points = { p(0, 0), p(192, 0), p(192, 192), p(0, 192) }, height = 80, before = 0 },
				{ kind = "ramp", shape = "wall", points = { p(96, 448), p(96, 192) }, heights = { 0, 80 }, width = 64, before = 0 },
			},
		},
		{
			key = "library:trench",
			name = "Example: trench line",
			buildings = { b("turretlaser", 120, -64), b("turretlaser", 360, -64) },
			terrain = { { kind = "raise", shape = "wall", points = { p(0, 0), p(480, 0) }, height = -40, before = 0 } },
		},
		{
			key = "library:ring",
			name = "Example: wall ring, terrain only",
			buildings = {},
			terrain = { { kind = "raise", shape = "wall", points = { p(0, 0), p(384, 0), p(384, 384), p(0, 384), p(0, 0) }, height = 112, before = 0 } },
		},
	}
	for _, view in ipairs({ "list", "grid" }) do
		local panel = MODEL.new()
		MODEL.refresh(panel, EXAMPLES, PLACE, ZK.Game, zkCan)
		panel.open, panel.tab = true, "all"
		MODEL.setView(panel, view)
		local drawn = MODEL.layout(panel, measure, VIEW)
		local S = MODEL.scaleFor(panel, VIEW)
		local maps = {}
		for _, r in ipairs(drawn.rects) do
			if r.kind == "map" then
				maps[#maps + 1] = { map = r, marks = {}, buildings = {} }
			elseif r.kind == "terrain" and #maps > 0 then
				table.insert(maps[#maps].marks, r)
			elseif r.kind == "building" and #maps > 0 then
				table.insert(maps[#maps].buildings, r)
			end
		end
		check(view .. ": all five examples are drawn", #maps == #EXAMPLES, #maps)
		for n, m in ipairs(maps) do
			local name = EXAMPLES[n] and EXAMPLES[n].name or tostring(n)
			local want = #EXAMPLES[n].buildings
			check(view .. ": " .. name .. " draws every building", #m.buildings == want, #m.buildings)
			check(view .. ": " .. name .. " draws its terrain", #m.marks > 0)
			local least = math.huge
			for _, r in ipairs(m.buildings) do
				least = math.min(least, r.w, r.h)
			end
			check(view .. ": " .. name .. " draws no building under 3 pixels a side", least >= 3 * S - 1e-6, least)
			-- a line is a quad from its first corner to its second along it, and from
			-- its second to its third across it, which is its thickness. A triangle of a
			-- fill repeats its last corner and has no thickness to speak of.
			local thin = math.huge
			for _, r in ipairs(m.marks) do
				local c = r.corners
				local function dist(a, b)
					return math.sqrt((a[1] - b[1]) ^ 2 + (a[2] - b[2]) ^ 2)
				end
				if not (c[3][1] == c[4][1] and c[3][2] == c[4][2]) then
					thin = math.min(thin, dist(c[2], c[3]))
				end
			end
			check(view .. ": " .. name .. " draws no line thinner than a pixel and a fifth", thin >= 1.2 * S - 1e-6, thin)
			-- what is drawn fills the map along its longer side, inside the map
			local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
			for _, r in ipairs(m.marks) do
				for _, c in ipairs(r.corners) do
					x0, y0, x1, y1 = math.min(x0, c[1]), math.min(y0, c[2]), math.max(x1, c[1]), math.max(y1, c[2])
				end
			end
			for _, r in ipairs(m.buildings) do
				x0, y0, x1, y1 = math.min(x0, r.x), math.min(y0, r.y), math.max(x1, r.x + r.w), math.max(y1, r.y + r.h)
			end
			check(view .. ": " .. name .. " fills most of its map", math.max(x1 - x0, y1 - y0) >= 0.8 * m.map.w, show({ x1 - x0, y1 - y0, m.map.w }))
			check(view .. ": " .. name .. " stays inside its map", x0 >= m.map.x - 1e-6 and y0 >= m.map.y - 1e-6 and x1 <= m.map.x + m.map.w + 1e-6 and y1 <= m.map.y + m.map.h + 1e-6, show({ x0, y0, x1, y1, m.map.x, m.map.y, m.map.w }))
		end
	end
	PLACE.use(E)
end

support.report()
