-- Run: luajit lua/blueprint-widget/tests/store_test.lua
--
-- The store reads the library file coilbox writes, the spool the widget
-- writes, and BAR's own blueprints.json, and merges them into one list. It
-- never writes the first or the third.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local json = support.module("json.lua")
local STORE = support.module("store.lua")
STORE.use(json)

--------------------------------------------------------------------------------
-- parsing the library file
--------------------------------------------------------------------------------

local LIBRARY = json.encode({
	version = 1,
	blueprints = {
		{
			id = "one",
			name = "Eco",
			ordered = true,
			game = { name = "Test Game 1.0", shortname = "TEST" },
			buildings = {
				{ def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 },
				{ def = "armwin", offset = { x = 32, z = -16 }, facing = 3, originalName = "corwin" },
			},
			footprints = { armsolar = { x = 4, z = 4 } },
		},
		{ id = "two", name = "Anywhere", buildings = {} },
	},
})

local entries, err = STORE.parseLibrary(LIBRARY)
check("library parses", err == nil and #entries == 2, err or show(entries))
check("library entry keeps its id as the key", entries[1].key == "library:one", show(entries[1]))
check("library entry source", entries[1].source == "library")
check("library entry game", same(entries[1].game, { name = "Test Game 1.0", shortname = "TEST" }))
check("library entry ordered", entries[1].ordered == true and entries[2].ordered == false)
check(
	"library buildings keep def, offset and facing only",
	same(entries[1].buildings[2], { def = "armwin", offset = { x = 32, z = -16 }, facing = 3 }),
	show(entries[1].buildings[2])
)
check("library entry with no game has nil game", entries[2].game == nil)

local _, verr = STORE.parseLibrary(json.encode({ version = 2, blueprints = {} }))
check("library version 2 is refused", type(verr) == "string" and verr:find("version", 1, true) ~= nil, verr)

local _, jerr = STORE.parseLibrary("{ not json")
check("library bad json is refused", type(jerr) == "string", jerr)

local shapeless = STORE.parseLibrary(json.encode({ version = 1, blueprints = { { name = "no buildings" } } }))
check("library entry without buildings is skipped", #shapeless == 0, show(shapeless))

local badBuilding = STORE.parseLibrary(json.encode({
	version = 1,
	blueprints = { { id = "b", name = "Bad", buildings = { { def = "x" }, { def = "y", offset = { x = 1, z = 2 }, facing = 7 } } } },
}))
check("building without an offset is dropped, facing is wrapped", #badBuilding == 1 and #badBuilding[1].buildings == 1 and badBuilding[1].buildings[1].facing == 3, show(badBuilding))

--------------------------------------------------------------------------------
-- parsing the spool
--------------------------------------------------------------------------------

local SPOOL = json.encode({
	version = 1,
	blueprints = {
		{ name = "Base on Map 1", recordedAt = 100, designedFor = "Map", buildings = { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 0 } } },
		{ name = "Base on Map 2", recordedAt = 200, designedFor = "Map", buildings = {} },
	},
})
local spooled = STORE.parseSpool(SPOOL)
check("spool parses", #spooled == 2, show(spooled))
check("spool entries are keyed by position", spooled[1].key == "spool:1" and spooled[2].key == "spool:2")
check("spool entry source", spooled[1].source == "spool")

local emptySpool = STORE.parseSpool(nil)
check("missing spool is empty", same(emptySpool, {}))

--------------------------------------------------------------------------------
-- parsing BAR's blueprints.json
--------------------------------------------------------------------------------

local BAR = json.encode({
	savedBlueprints = {
		{
			name = "Turned",
			spacing = 0,
			facing = 1,
			ordered = true,
			units = {
				{ unitName = "armsolar", position = { 16, 50, 32 }, facing = 0 },
				{ unitName = "armwin", position = { -8.4, 50, 0 }, facing = 3 },
			},
		},
		{ name = "", spacing = 0, facing = 0, ordered = false, units = { { unitName = "armllt", position = { 0, 0, 0 }, facing = 0 } } },
	},
	other = "kept by coilbox, ignored here",
})
local bar = STORE.parseBar(BAR)
check("bar parses", #bar == 2, show(bar))
check("bar entry source and key", bar[1].source == "bar" and bar[1].key == "bar:1")
check("bar entries carry no game", bar[1].game == nil)
check(
	"bar blueprint facing turns positions and adds to facings",
	same(bar[1].buildings, {
		{ def = "armsolar", offset = { x = 32, z = -16 }, facing = 1 },
		{ def = "armwin", offset = { x = 0, z = 8 }, facing = 0 },
	}),
	show(bar[1].buildings)
)
check("bar nameless entry is numbered", bar[2].name == "#2", bar[2].name)

local barEmpty = STORE.parseBar(json.encode({ savedBlueprints = 0 }))
check("bar writes 0 for an empty list", same(barEmpty, {}), show(barEmpty))

--------------------------------------------------------------------------------
-- the store: reading through VFS, polling, appending to the spool
--------------------------------------------------------------------------------

local function fakeFiles(files)
	local written = {}
	local vfs = {
		RAW = "r",
		FileExists = function(path)
			return files[path] ~= nil
		end,
		LoadFile = function(path)
			return files[path]
		end,
	}
	local io = {
		open = function(path, mode)
			if mode == "w" then
				return {
					write = function(_, text)
						written[#written + 1] = { path = path, text = text }
						files[path] = text
					end,
					close = function() end,
				}
			end
			if files[path] == nil then
				return nil, "no such file"
			end
			return {
				read = function()
					return files[path]
				end,
				close = function() end,
			}
		end,
	}
	return vfs, io, written, files
end

local files = { [STORE.LIBRARY_PATH] = LIBRARY, [STORE.SPOOL_PATH] = SPOOL, [STORE.BAR_PATH] = BAR }
local vfs, io, written = fakeFiles(files)
local logs = {}
local store = STORE.new({
	vfs = vfs,
	io = io,
	log = function(msg)
		logs[#logs + 1] = msg
	end,
})

check("store starts empty before a refresh", #store:entries() == 0)
check("first refresh reports a change", store:refresh(0) == true)
check("store merges library, spool and bar in that order", #store:entries() == 6, show(store:entries()))
check("store order is library first", store:entries()[1].key == "library:one" and store:entries()[3].key == "spool:1" and store:entries()[5].key == "bar:1")
check("refresh within the interval does nothing", store:refresh(2) == false)
check("a forced refresh reads within the interval", store:refresh(1, true) == false and store.lastPoll == 1)
check("refresh after the interval with no change reports none", store:refresh(6) == false)

files[STORE.LIBRARY_PATH] = json.encode({ version = 1, blueprints = {} })
check("a changed file is not seen before the interval", store:refresh(9) == false and #store:entries() == 6)
check("a changed file is seen after the interval", store:refresh(12) == true and #store:entries() == 4)

files[STORE.LIBRARY_PATH] = "broken"
check("a file that turns unreadable keeps the last good read", store:refresh(20) == false and #store:entries() == 4)
check("an unreadable file is logged once", #logs == 1 and logs[1]:find("coilbox_blueprints.json", 1, true) ~= nil, show(logs))
store:refresh(30)
check("the same unreadable file is not logged again", #logs == 1, show(logs))

files[STORE.LIBRARY_PATH] = nil
check("a file that disappears empties its entries", store:refresh(40) == true and #store:entries() == 4 and store:entries()[1].source == "spool")

check("store:find returns an entry by key", store:find("bar:2") ~= nil and store:find("bar:2").name == "#2")
check("store:find of an unknown key is nil", store:find("library:one") == nil)

-- append
local entry = {
	name = "Base on Map 3",
	game = { name = "Test Game 1.0", shortname = "TEST" },
	designedFor = "Map",
	recordedAt = 1000,
	ordered = false,
	buildings = { { def = "armsolar", offset = { x = 0, z = 0 }, facing = 2 } },
	footprints = { armsolar = { x = 4, z = 4 } },
}
local ok, aerr = store:append(entry)
check("append succeeds", ok == true, aerr)
check("append writes the spool path", written[1].path == STORE.SPOOL_PATH, show(written))
local spoolNow = json.decode(written[1].text)
check("append keeps the existing entries and adds the new one last", #spoolNow.blueprints == 3 and spoolNow.blueprints[3].name == "Base on Map 3", show(spoolNow))
check("append writes version 1", spoolNow.version == 1)
check("append writes footprints", same(spoolNow.blueprints[3].footprints, { armsolar = { x = 4, z = 4 } }), show(spoolNow.blueprints[3]))
check("append shows the new entry at once", store:find("spool:3") ~= nil)

files[STORE.SPOOL_PATH] = "{ broken"
store:refresh(100)
local ok2, err2 = store:append(entry)
check("append refuses to overwrite an unreadable spool", ok2 == false and type(err2) == "string", err2)
check("refusal leaves the file alone", #written == 1)

files[STORE.SPOOL_PATH] = nil
store:refresh(200)
local ok3 = store:append(entry)
check("append creates the spool when missing", ok3 == true and json.decode(files[STORE.SPOOL_PATH]).blueprints[1].name == "Base on Map 3")

-- a store with no io cannot append
local readOnly = STORE.new({ vfs = vfs, io = nil, log = function() end })
local ok4, err4 = readOnly:append(entry)
check("append without io fails with a message", ok4 == false and type(err4) == "string", err4)

--------------------------------------------------------------------------------
-- terrain steps (issue #4790)
--------------------------------------------------------------------------------

local WALL = {
	kind = "raise",
	shape = "wall",
	points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 32 } },
	height = 24,
	before = 0,
}
local RAMP = { kind = "ramp", shape = "wall", points = { { x = -32, z = 0 }, { x = 32, z = 0 } }, heights = { 0, 40 }, width = 48, before = 1 }
local PAD = { kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 }, { x = 0, z = 64 } }, height = -8, before = 1 }
local SMOOTH = { kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 32, z = 0 }, { x = 32, z = 32 } }, before = 1 }

local withTerrain = STORE.parseLibrary(json.encode({
	version = 1,
	blueprints = {
		{
			id = "mixed",
			name = "Walls and a factory",
			buildings = { { def = "armlab", offset = { x = 0, z = 0 }, facing = 0 } },
			terrain = { WALL, RAMP, PAD, SMOOTH },
		},
		{ id = "only", name = "Only walls", buildings = {}, terrain = { WALL } },
		{ id = "none", name = "No terrain key", buildings = {} },
	},
}))
check("a library entry keeps every kind of terrain step", #withTerrain[1].terrain == 4, show(withTerrain[1].terrain))
check("a raise keeps its points, height and place in the build order", same(withTerrain[1].terrain[1], WALL), show(withTerrain[1].terrain[1]))
check("a ramp keeps its end heights and width", same(withTerrain[1].terrain[2], RAMP), show(withTerrain[1].terrain[2]))
check("a level keeps a negative height", withTerrain[1].terrain[3].height == -8)
check("a smooth step has no height", withTerrain[1].terrain[4].height == nil)
check("a layout with steps and no buildings is kept", #withTerrain == 3 and #withTerrain[2].buildings == 0 and #withTerrain[2].terrain == 1, show(withTerrain[2]))
check("a layout with no terrain key has an empty list", same(withTerrain[3].terrain, {}), show(withTerrain[3]))
check("a step placed past the last building is placed after it", withTerrain[2].terrain[1].before == 0)

local clamped = STORE.parseLibrary(json.encode({
	version = 1,
	blueprints = { { id = "c", name = "Clamped", buildings = {}, terrain = { { kind = "raise", shape = "wall", points = WALL.points, height = 8, before = 9 } } } },
}))
check("a step before a building the layout does not have comes after them all", clamped[1].terrain[1].before == 0, show(clamped))

local damaged = STORE.parseLibrary(json.encode({
	version = 1,
	blueprints = {
		{
			id = "d",
			name = "Damaged",
			buildings = {},
			terrain = {
				{ kind = "restore", shape = "area", points = PAD.points, before = 0 },
				{ kind = "raise", shape = "wall", points = { { x = 0, z = 0 } }, height = 8, before = 0 },
				{ kind = "raise", shape = "wall", points = WALL.points, before = 0 },
				{ kind = "ramp", shape = "wall", points = RAMP.points, heights = { 0 }, width = 8, before = 0 },
				WALL,
			},
		},
	},
}))
check("steps that are damaged or of an unknown kind are dropped and the rest read", #damaged[1].terrain == 1 and same(damaged[1].terrain[1], WALL), show(damaged))

local spooled2 = STORE.parseSpool(json.encode({ version = 1, blueprints = { { name = "Saved", buildings = {}, terrain = { WALL } } } }))
check("the spool reads terrain the same way", #spooled2[1].terrain == 1, show(spooled2))

-- only raise or only lower (issue #4804)
local function only(step, value)
	local copy = {}
	for k, v in pairs(step) do
		copy[k] = v
	end
	copy.only = value
	return copy
end
local choosing = STORE.parseLibrary(json.encode({
	version = 1,
	blueprints = {
		{
			id = "c",
			name = "Choosing",
			buildings = {},
			terrain = { only(PAD, "raise"), only(RAMP, "lower"), only(PAD, "both"), only(PAD, 2), only(WALL, "raise"), only(SMOOTH, "lower"), PAD },
		},
	},
}))
local chosen = choosing[1].terrain
check("a level keeps only raise and a ramp keeps only lower", chosen[1].only == "raise" and chosen[2].only == "lower", show(chosen))
check("a value that is not raise or lower reads as both ways", chosen[3].only == nil and chosen[4].only == nil)
check("a raise or smooth step carries no choice", chosen[5].only == nil and chosen[6].only == nil)
check("a step with no choice has none", chosen[7].only == nil and chosen[7].height == PAD.height)

local barOnly = STORE.parseBar(BAR)
check("BAR's file holds no terrain", same(barOnly[1].terrain, {}), show(barOnly[1]))

support.report()
