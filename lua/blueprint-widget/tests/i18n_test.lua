-- Run: luajit lua/blueprint-widget/tests/i18n_test.lua
--
-- Proves the blueprint panel draws in the language it is handed (issue
-- #5045): from a fixture table, English where a table lacks a key, and in the
-- pseudo-locale with no text past the button or the panel that holds it.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, show = support.check, support.show
local MODEL = support.module("model.lua")
local I18N = support.module("coilbox_i18n.lua")
local TABLES = support.module("strings.lua")

local VIEW = { w = 1920, h = 1080 }

--- Width in pixels with a letter 0.55 of the size across, counted by
-- character and not by byte, since the pseudo-locale's letters are two bytes.
local function measure(str, size)
	local _, characters = str:gsub("[^\128-\191]", "")
	return characters * size * 0.55
end

local function hasText(layout, wanted)
	for _, entry in ipairs(layout.texts) do
		if entry.text == wanted then
			return true
		end
	end
	return false
end

local function hasTextMatching(layout, pattern)
	for _, entry in ipairs(layout.texts) do
		if entry.text:find(pattern) then
			return true
		end
	end
	return false
end

local STEP = { kind = "raise", shape = "area", points = { { x = 0, z = 0 }, { x = 16, z = 0 }, { x = 0, z = 32 } }, height = 4 }

--- A panel holding everything that says something: a row with every fact, a
-- row of terrain changes alone, a count of what is left to build, a message,
-- and the placing panel with its Terrain row.
local function fullPanel()
	local state = MODEL.new()
	state.open = true
	state.items = {
		{
			entry = { key = "spool:1", name = "Eco", source = "spool", ordered = true, buildings = { {}, {} } },
			resolved = { buildings = {}, missing = { "corgant", "armsolar" } },
			tab = "now",
			foreign = 2,
			upgrades = 1,
			name = "Eco",
		},
		{
			entry = { key = "library:2", name = "Walls", source = "library", ordered = false, buildings = {}, terrain = { STEP } },
			resolved = { buildings = {}, missing = {} },
			tab = "never",
			stop = "stopTerrainOff",
			name = "Walls",
		},
	}
	state.counts = { now = 1, partly = 0, all = 2 }
	state.remainder = { count = 3 }
	state.message = "A message"
	state.placing = { key = "spool:1", name = "Eco", rotation = 0, flip = { x = false, z = false }, terrain = true, cost = { metal = 100, energy = 50, seconds = 75 } }
	return state
end

--------------------------------------------------------------------------------
-- A fixture table.
--------------------------------------------------------------------------------

local function tables()
	local loaded = support.module("strings.lua")
	loaded.fr = {
		tabNow = "Maintenant",
		saveSelection = "Enregistrer la sélection",
		remainderLeft = "%d restants à construire",
		emptyTab = "Rien sous cet onglet.",
		cancel = "Annuler",
		trayTurn = "Tourner",
		buildings_other = "%d bâtiments",
		costWithTime = "%d métal, %d énergie, %s",
	}
	return loaded
end

local FRENCH = I18N.pick(tables(), { coilbox_lang = "fr" })
local L = MODEL.layout(fullPanel(), measure, VIEW, FRENCH)
check("with coilbox_lang=fr a tab is named in French", hasText(L, "Maintenant 1"))
check("and not in English", not hasText(L, "Now 1"))
check("a button is in French", hasText(L, "Enregistrer la sélection"))
check("the count of what is left is a French format string", hasText(L, "3 restants à construire"))
check("the placing panel is in French", hasText(L, "Annuler") and hasText(L, "Tourner"))
check("the cost line is in French", hasText(L, "100 métal, 50 énergie, 1:15"))
check("a key the French table lacks is drawn in English", hasText(L, "Partly 0") and hasText(L, "Dismiss") and hasText(L, "Save ground"))
local ROW = MODEL.rowDetail(fullPanel().items[1], FRENCH)
check("a count with its own French form uses it", ROW:find("2 bâtiments", 1, true) ~= nil, ROW)
check("a row fact French lacks reads English's", ROW:find("2 from another side", 1, true) ~= nil and ROW:find("1 to upgrade", 1, true) ~= nil, ROW)
check("a count whose French form is missing reads English's", MODEL.plural(FRENCH, "terrainChanges", 1) == "1 terrain change")

local empty = MODEL.new()
empty.open = true
empty.counts = { now = 0, partly = 0, all = 0 }
check("an empty library says so in English where French lacks the line", hasTextMatching(MODEL.layout(empty, measure, VIEW, FRENCH), "^No blueprints for this game"))
empty.items = { {} }
empty.hasBuilders = true
check("the line for an empty tab is French", hasText(MODEL.layout(empty, measure, VIEW, FRENCH), "Rien sous cet onglet."))

local closed = MODEL.new()
closed.counts = { now = 0, partly = 0, all = 0 }
check("the closed panel's tab says BLUEPRINTS in English", hasText(MODEL.layout(closed, measure, VIEW, I18N.pick(TABLES, {})), "BLUEPRINTS"))

--------------------------------------------------------------------------------
-- The wording that sits in a format string.
--------------------------------------------------------------------------------

local ENGLISH = I18N.pick(TABLES, {})
check("one building reads in the singular", MODEL.plural(ENGLISH, "buildings", 1) == "1 building")
check("any other count reads in the plural", MODEL.plural(ENGLISH, "buildings", 0) == "0 buildings" and MODEL.plural(ENGLISH, "buildings", 2) == "2 buildings")
check("a reason fills the second place", MODEL.plural(ENGLISH, "skipped", 2, "why") == "2 terrain changes skipped (why)")
check("the cost line with no builder has no time", MODEL.costLine({ metal = 10, energy = 0 }, ENGLISH) == "10 metal, 0 energy")
check("and with one it has", MODEL.costLine({ metal = 10, energy = 0, seconds = 5 }, ENGLISH) == "10 metal, 0 energy, 0:05 to build")

--------------------------------------------------------------------------------
-- The pseudo-locale: nothing left in English, and nothing past its box.
--------------------------------------------------------------------------------

local PSEUDO = I18N.pick(TABLES, { coilbox_lang = "en-XA" })

--- Every key of English's table the layout draws, which is every key but the
-- ones the widget says outside the panel.
local WIDGET_ONLY = {
	help = true, onlyGround = true, foreignBuildings = true, nothingExists = true, placeResult = true,
	planned = true, cannotBuild = true, planRemoved = true, savedEntry = true, dragToSave = true,
	saveGroundCancelled = true, saveGroundNeedsDrag = true, sentTo_one = true, sentTo_other = true,
	blocked = true, skipped_one = true, skipped_other = true, offMap_one = true, offMap_other = true,
	leftForAnother = true, leftPlanned = true, nothingPlaced = true, whyNoTerraform = true,
	-- the panel draws one of each pair or the other
	buildings_one = true, buildings_other = true, terrainChanges_one = true, terrainChanges_other = true,
	stopNoTerraform = true, emptyNoBuilder = true, keyLeft = true, keyRight = true, keyAcross = true, keyDown = true,
	-- put into other strings
	tabNow = true, tabPartly = true, tabAll = true, noBuildings = true, buildingsAndTerrain = true,
	costNoTime = true, sourceSaved = true,
}

local function lettersOf(str)
	return str:gsub("%%.", ""):gsub("[^A-Za-z]", "")
end

local PL = MODEL.layout(fullPanel(), measure, VIEW, PSEUDO)
local unmoved = {}
for key, english in pairs(TABLES.en) do
	if not WIDGET_ONLY[key] and type(english) == "string" and #lettersOf(english) > 0 then
		-- the string, with each placeholder as any digits or letters
		local plain = english:gsub("[%^%$%(%)%.%[%]%*%+%-%?]", "%%%0"):gsub("%%%%[ds]", ".*")
		for _, entry in ipairs(PL.texts) do
			if not entry.text:find("[^%z\1-\127]") and entry.text:find("^" .. plain .. "$") then
				unmoved[#unmoved + 1] = key
			end
		end
	end
end
check("no text the panel draws is left as English in the pseudo-locale", #unmoved == 0, show(unmoved))
-- a tab is its name inside the tab format, each pseudo, so the brackets nest
check("the tab names are pseudo", hasTextMatching(PL, "^%[~%[~") and not hasTextMatching(PL, "^Now"))
check("the Terrain row's buttons are pseudo", not hasText(PL, "On") and not hasText(PL, "Off"))

--- A button holds its label, and nothing goes past the panel or tray it is in.
local function overruns(layout)
	local found = {}
	local boxes = { layout.box, layout.tray }
	local function inBox(x, y)
		for _, box in ipairs(boxes) do
			if x >= box.x - 0.001 and x <= box.x + box.w + 0.001 and y >= box.y - 0.001 and y <= box.y + box.h + 0.001 then
				return box
			end
		end
		return nil
	end
	for _, entry in ipairs(layout.texts) do
		if not entry.rotate then
			local box = inBox(entry.x, entry.y)
			local right = entry.x + measure(entry.text, entry.size)
			if not box then
				found[#found + 1] = "outside: " .. entry.text
			elseif right > box.x + box.w + 0.001 then
				found[#found + 1] = "past the box: " .. entry.text
			end
			for _, rect in ipairs(layout.rects) do
				local isButton = rect.kind == "button" or rect.kind == "tab"
				if isButton and entry.x >= rect.x - 0.001 and entry.x < rect.x + rect.w and math.abs(entry.y - (rect.y + rect.h / 2)) < 0.001 then
					if right > rect.x + rect.w + 0.001 then
						found[#found + 1] = "past its button: " .. entry.text
					end
				end
			end
		end
	end
	-- buttons in one row never overlap, and none is cut off by the box
	for i, a in ipairs(layout.rects) do
		if a.kind == "button" or a.kind == "tab" then
			local box = inBox(a.x + a.w / 2, a.y + a.h / 2)
			if not box or a.x < box.x - 0.001 or a.x + a.w > box.x + box.w + 0.001 then
				found[#found + 1] = "button outside its box at " .. a.x
			end
			for j = i + 1, #layout.rects do
				local b = layout.rects[j]
				if (b.kind == "button" or b.kind == "tab") and math.abs(a.y - b.y) < 0.001 and a.x < b.x + b.w - 0.001 and b.x < a.x + a.w - 0.001 then
					found[#found + 1] = "buttons overlap at " .. a.x .. " and " .. b.x
				end
			end
		end
	end
	return found
end

check("the pseudo-locale puts no text past its button or box", #overruns(PL) == 0, show(overruns(PL)))
check("the layout test can see an overrun", #overruns({
	box = { x = 0, y = 0, w = 10, h = 10 },
	texts = { { x = 0, y = 5, size = 10, text = "long text" } },
	rects = {},
}) == 1)

-- The pseudo-locale is 30 percent longer than English. A language can be
-- longer still, so every string with no placeholder is doubled to be sure
-- it is not that length that fits.
local DOUBLED = setmetatable({}, {
	__index = function(_, key)
		local value = PSEUDO[key]
		if type(value) == "string" and not value:find("%%") then
			return value .. value
		end
		return value
	end,
})
local doubled = overruns(MODEL.layout(fullPanel(), measure, VIEW, DOUBLED))
check("strings twice as long still stay in their boxes", #doubled == 0, show(doubled))

support.report()
