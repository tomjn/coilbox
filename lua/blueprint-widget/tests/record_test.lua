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
	gameName = "Test Game",
	modName = "Test Game 1.0",
	gameShortName = "TEST",
	mapName = "Test Map v2",
})
RECORD.use(E)

local named
local entry, err = RECORD.selection({
	now = 5000,
	nameFor = function(defs)
		named = defs
		return "named by contents"
	end,
})
check("record returns an entry", entry ~= nil, err)
check("record keeps only buildings, in selection order", #entry.buildings == 3 and entry.buildings[1].def == "armllt" and entry.buildings[3].def == "armwin", show(entry.buildings))
check("record anchors at the lowest x and z, floored to the grid", same(entry.buildings[2], { def = "armsolar", offset = { x = 32, z = 0 }, facing = 0 }), show(entry.buildings[2]))
check("record keeps each building's facing", entry.buildings[1].facing == 1 and entry.buildings[3].facing == 3)
check("record names the entry from the buildings' defs, in selection order", entry.name == "named by contents" and #named == 3 and named[1] == LLT and named[2] == SOLAR and named[3] == WIN, entry.name)
check("record binds the game by its archive name, not modinfo's unversioned one", same(entry.game, { name = "Test Game 1.0", shortname = "TEST" }), show(entry.game))
check("record says which map it was drawn on, and when", entry.designedFor == "Test Map v2" and entry.recordedAt == 5000)
check("record is not ordered", entry.ordered == false)
check(
	"record writes footprints in build squares, keyed by lowercased def",
	same(entry.footprints, { armsolar = { x = 4, z = 4 }, armllt = { x = 3, z = 3 }, armwin = { x = 2, z = 3 } }),
	show(entry.footprints)
)

E.selected = { 202 }
local none, nerr = RECORD.selection({ nameFor = tostring, now = 0 })
check("a selection with no buildings is refused with a message", none == nil and type(nerr) == "string", nerr)

E.selected = {}
local empty, eerr = RECORD.selection({ nameFor = tostring, now = 0 })
check("an empty selection is refused", empty == nil and type(eerr) == "string", eerr)

--------------------------------------------------------------------------------
-- the ground (issue #4798)
--------------------------------------------------------------------------------

local GROUND = support.module("ground.lua")
local LOTUS = support.def(4, "turretlaser", { isBuilding = true, xsize = 4, zsize = 4 })
local G = support.engine({ SOLAR, LOTUS, CON }, {
	selected = { 300, 301 },
	units = {
		-- a Lotus on a wall, and a solar collector on the flat ground beside it
		[300] = { def = 4, x = 256, y = 112, z = 256, facing = 0 },
		[301] = { def = 1, x = 256, y = 0, z = 400, facing = 0 },
	},
	mapName = "Test Map v2",
})
G.Game.mapSizeX, G.Game.mapSizeZ = 1024, 1024
G.GROUND = GROUND
-- a wall raised by 112 along x, from 128 to 400, 32 elmos wide round z 256,
-- with its slope, and the ground under the solar levelled up by 2
local orig = function()
	return 50
end
local function change(x, z)
	local top = x >= 128 and x <= 400 and z >= 240 and z <= 272
	if top then
		return 112
	end
	local dx = math.max(128 - x, x - 400, 0)
	local dz = math.max(240 - z, z - 272, 0)
	local ring = math.max(dx, dz) / 8
	local rings = { 84, 56, 28, 4 }
	if ring >= 1 and ring <= 4 then
		return rings[ring]
	end
	if x >= 224 and x <= 288 and z >= 368 and z <= 432 then
		return 2
	end
	return 0
end
G.Spring.GetGroundOrigHeight = orig
G.Spring.GetGroundHeight = function(x, z)
	return orig(x, z) + change(x, z)
end
G.Spring.GetUnitsInRectangle = function(x0, z0, x1, z1)
	local out = {}
	for id, u in pairs(G.units) do
		if u.x >= x0 and u.x <= x1 and u.z >= z0 and u.z <= z1 then
			out[#out + 1] = id
		end
	end
	table.sort(out)
	return out
end
RECORD.use(G)

local walled, werr = RECORD.selection({ nameFor = function()
	return "Lotus, Solar"
end, now = 1 })
check("a selection on a wall records", walled ~= nil, werr)
-- the wall is longer than one of Zero-K's terraform blocks, so it is two
local raises = walled.terrain and #walled.terrain == 2
local xs = {}
for _, step in ipairs(walled.terrain or {}) do
	raises = raises and step.kind == "raise" and step.shape == "area" and step.height == 112
	for _, p in ipairs(step.points) do
		xs[#xs + 1] = p.x
	end
end
table.sort(xs)
check("the wall under the selection is raise steps of its height", raises, show(walled.terrain))
-- the anchor is the buildings' lowest x on the build grid, 256, so the wall
-- from 128 to 400 runs from -128, and its last cell starts at 384, 128
check("the steps follow the wall past the selection to both its ends", xs[1] == -128 and xs[#xs] == 128, show(xs))
check("the solar beside the wall comes first and the Lotus on it after", walled.buildings[1].def == "armsolar" and walled.buildings[2].def == "turretlaser", show(walled.buildings))
check("the step comes between them", walled.terrain and walled.terrain[1].before == 1)
check("an entry read from the ground says so", walled.fromGround == true)

G.selected = { 301 }
local plain = RECORD.selection({ nameFor = tostring, now = 1 })
check("a building on ground changed only under itself saves no step", plain and plain.terrain == nil and plain.fromGround == nil, show(plain and plain.terrain))

local cutout, cerr = RECORD.ground(320, 200, 480, 300, { now = 2 })
check("Save ground records the changes in a rectangle", cutout ~= nil, cerr)
check("Save ground keeps no buildings", cutout and #cutout.buildings == 0)
check("Save ground's step is the part of the wall inside the rectangle", cutout and #cutout.terrain == 1 and cutout.terrain[1].height == 112, show(cutout and cutout.terrain))
local box = {}
for _, p in ipairs(cutout and cutout.terrain[1].points or {}) do
	box.x0, box.x1 = math.min(box.x0 or p.x, p.x), math.max(box.x1 or p.x, p.x)
	box.z0, box.z1 = math.min(box.z0 or p.z, p.z), math.max(box.z1 or p.z, p.z)
end
-- from x 320 to the wall's end at 400, so cells 320 to 384, anchored at 320
check("Save ground's step is anchored at its own corner", box.x0 == 0 and box.z0 == 0 and box.x1 == 64 and box.z1 == 16, show(box))
check("Save ground's entry is named for what it holds", cutout and cutout.name == "Raised ground", cutout and cutout.name)
check("Save ground's entry is from the ground, on the map it was read from", cutout and cutout.fromGround == true and cutout.designedFor == "Test Map v2" and cutout.recordedAt == 2)

local none, nerr = RECORD.ground(600, 600, 700, 700, { now = 3 })
check("Save ground over unchanged ground is refused with a message", none == nil and nerr == "no ground has been changed there", nerr)
local off = RECORD.ground(2000, 2000, 2100, 2100, { now = 3 })
check("Save ground off the map is refused", off == nil)

check("names count raised and dug areas", RECORD.groundName({ { height = 5 }, { height = 9 }, { height = -3 } }) == "2 raised areas, dug ground", RECORD.groundName({ { height = 5 }, { height = 9 }, { height = -3 } }))
check("a single dug area is named so", RECORD.groundName({ { height = -3 } }) == "Dug ground")

support.report()
