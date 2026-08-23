-- Run: luajit lua/blueprint-widget/tests/record_test.lua
--
-- Recording: the buildings in the selection become a spool entry coilbox can
-- import, with offsets from a grid anchor and footprints from the unit defs.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local RECORD = support.module("record.lua")

local SOLAR = support.def(1, "armsolar", { isBuilding = true, xsize = 8, zsize = 8 })
local LLT = support.def(2, "armllt", { isBuilding = true, xsize = 6, zsize = 6 })
local WIN = support.def(3, "armwin", { isBuilding = true, xsize = 4, zsize = 6 })
local CON = support.def(10, "armck", { buildOptions = { 1, 2, 3 } })

local E = support.engine({ SOLAR, LLT, WIN, CON }, {
	selected = { 200, 201, 202, 203, 204 },
	units = {
		[200] = { def = 2, x = 392, y = 20, z = 328, facing = 1 },
		[201] = { def = 1, x = 320, y = 20, z = 320, facing = 0 },
		[202] = { def = 10, x = 300, y = 20, z = 300, facing = 0 },
		[203] = { def = 3, x = 296, y = 20, z = 360, facing = 3 },
		-- a unit that is gone by the time it is read
		[204] = nil,
	},
	gameName = "Test Game 1.0",
	gameShortName = "TEST",
	mapName = "Test Map v2",
})
RECORD.use(E)

local entry, err = RECORD.selection({ spoolCount = 2, now = 5000 })
check("record returns an entry", entry ~= nil, err)
check("record keeps only buildings, in selection order", #entry.buildings == 3 and entry.buildings[1].def == "armllt" and entry.buildings[3].def == "armwin", show(entry.buildings))
check("record anchors at the lowest x and z, floored to the grid", same(entry.buildings[2], { def = "armsolar", offset = { x = 32, z = 0 }, facing = 0 }), show(entry.buildings[2]))
check("record keeps each building's facing", entry.buildings[1].facing == 1 and entry.buildings[3].facing == 3)
check("record names the base after the map and the spool count", entry.name == "Base on Test Map v2 3", entry.name)
check("record binds the game", same(entry.game, { name = "Test Game 1.0", shortname = "TEST" }), show(entry.game))
check("record stamps the map and the time", entry.map == "Test Map v2" and entry.recordedAt == 5000)
check("record is not ordered", entry.ordered == false)
check(
	"record writes footprints in build squares, keyed by lowercased def",
	same(entry.footprints, { armsolar = { x = 4, z = 4 }, armllt = { x = 3, z = 3 }, armwin = { x = 2, z = 3 } }),
	show(entry.footprints)
)

E.selected = { 202 }
local none, nerr = RECORD.selection({ spoolCount = 0, now = 0 })
check("a selection with no buildings is refused with a message", none == nil and type(nerr) == "string", nerr)

E.selected = {}
local empty, eerr = RECORD.selection({ spoolCount = 0, now = 0 })
check("an empty selection is refused", empty == nil and type(eerr) == "string", eerr)

support.report()
