-- Proves what the def fixes do to an old game's defs: each changes only the
-- defs that set the tag it is for, the way the engine read that tag before it
-- dropped it. Run it with:
--
--   luajit lua/compat/tests/defs_test.lua
--
-- Each test runs defs-helpers and then one fix the way the mutator's def files
-- do: each file as a function given the same `compat` table, in an environment
-- holding the DEFS table the engine's defs.lua builds and, for a fix that runs
-- in weapondefs_post.lua, the WeaponDefs table weapondefs.lua makes global.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local DEFS_DIR = support.root() .. "/defs/"

--- Runs the helpers and then each fix in `fixes` over `units` and `weapons`.
--- Answers with the shared compat table.
local function run(fixes, units, weapons, opts)
	opts = opts or {}
	local env = setmetatable({}, { __index = _G })
	env._G = env
	env.DEFS = { unitDefs = units or {}, weaponDefs = weapons or {} }
	if opts.weaponDefsGlobal then
		env.WeaponDefs = env.DEFS.weaponDefs
	end
	local compat = {}
	for _, id in ipairs({ "defs-helpers", unpack(fixes) }) do
		local chunk = assert(loadfile(DEFS_DIR .. id .. ".lua"))
		setfenv(chunk, env)
		chunk(compat)
	end
	return compat
end

local function count(t)
	local n = 0
	for _ in pairs(t) do
		n = n + 1
	end
	return n
end

--------------------------------------------------------------------------------
-- Every def fix
--------------------------------------------------------------------------------

for _, id in ipairs({
	"defs-helpers",
	"defs-commander-85",
	"defs-model-center-offset-89",
	"defs-weapon-consts-87",
	"defs-manual-bomb-settings-92",
}) do
	local source = assert(io.open(DEFS_DIR .. id .. ".lua")):read("*a")
	check(id .. ": its header names the file", source:match("^%-%- id: ([%w-]+)\n") == id)
	check(id .. ": its header names its def files", source:match("\n%-%- defs: [%w_, ]+\n") ~= nil)
end

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

do
	local compat = run({})
	check("helpers: a key is found by its lower case", compat.key({ ObjectName = 1 }, "objectname") == "ObjectName")
	check("helpers: of two spellings the first in byte order wins", compat.key({ abc = 1, ABC = 2, Abc = 3 }, "abc") == "abc")
	check("helpers: without the exact name the first in byte order wins", compat.key({ aBC = 1, ABC = 2, Abc = 3 }, "abc") == "ABC")
	check("helpers: a missing key is nil", compat.key({}, "x") == nil and compat.get({}, "x") == nil)
	local bools = {
		{ true, true }, { false, false }, { 1, true }, { 0, false }, { "1", true }, { "0", false },
		{ "2.5", true }, { "TRUE", true }, { "false", false }, { "yes", false }, { {}, false },
	}
	for _, case in ipairs(bools) do
		check("helpers: bool " .. tostring(case[1]), compat.bool(case[1]) == case[2])
	end
	local x, y, z = compat.float3("0 -5 2.5")
	check("helpers: three numbers in a string", x == 0 and y == -5 and z == 2.5)
	x, y, z = compat.float3({ 1, "2", 3 })
	check("helpers: three numbers in a table", x == 1 and y == 2 and z == 3)
	check("helpers: two numbers are not three", compat.float3("1 2") == nil)
	check("helpers: a word is not a number", compat.float3("1 2 x") == nil)
end

do
	local compat = run({})
	local def = { customParams = { Keep = "a" } }
	compat.param(def, "keep", "b")
	check("helpers: a parameter the def has is kept", def.customParams.Keep == "a" and def.customParams.keep == nil)
	check("helpers: keeping a parameter changes nothing", next(compat.changed) == nil)
	compat.param(def, "new", "c")
	check("helpers: a new parameter goes in the def's own table", def.customParams.new == "c")
	check("helpers: a def given a parameter is changed", compat.changed[def] == true)
	local bare = {}
	compat.param(bare, "new", "c")
	check("helpers: a def with no customparams gets the table", bare.customparams.new == "c")
end

do
	local shared = { a = {}, b = {} }
	local inner = { c = {} }
	local units = { u = { weaponDefs = { c = inner.c, a = shared.a } } }
	local compat = run({}, units, shared, { weaponDefsGlobal = true })
	check("helpers: each weapon def is listed once", #compat.weapons() == 3)
	check("helpers: every unit def is listed", #compat.units() == 1)
end

--------------------------------------------------------------------------------
-- Commander
--------------------------------------------------------------------------------

do
	local units = {
		armcom = { commander = 1, canmanualfire = 1 },
		corcom = { Commander = "true", customparams = { iscommander = "0" } },
		armpw = { canmanualfire = 1 },
		armflea = { commander = 0 },
	}
	local compat = run({ "defs-commander-85" }, units)
	check("commander: a unit with the tag gets customparams.iscommander", units.armcom.customparams.iscommander == "1")
	check("commander: canManualFire is left as the game set it", units.armcom.canmanualfire == 1)
	check("commander: a unit's own iscommander is kept", units.corcom.customparams.iscommander == "0")
	check("commander: a unit without the tag is unchanged", units.armpw.customparams == nil)
	check("commander: a unit whose tag is false is unchanged", units.armflea.customparams == nil)
	check("commander: one unit changed", count(compat.changed) == 1 and compat.changed[units.armcom])
end

--------------------------------------------------------------------------------
-- modelCenterOffset
--------------------------------------------------------------------------------

do
	local units = {
		a = { modelcenteroffset = "0 -5 2.5" },
		b = { modelCenterOffset = { 1, 2, 3 } },
		c = { modelcenteroffset = "1 2" },
		d = {},
	}
	local compat = run({ "defs-model-center-offset-89" }, units)
	check("offset: a string is copied as three numbers", units.a.customparams.modelcenteroffset == "0 -5 2.5")
	check("offset: a table is copied as three numbers", units.b.customparams.modelcenteroffset == "1 2 3")
	check("offset: an offset the engine could not read is not copied", units.c.customparams == nil)
	check("offset: a unit without the tag is unchanged", units.d.customparams == nil)
	check("offset: two units changed", count(compat.changed) == 2)
end

--------------------------------------------------------------------------------
-- Weapon consts
--------------------------------------------------------------------------------

do
	local weapons = {
		cannon = { areaofeffect = 64, weaponvelocity = "300" },
		slow = { weaponVelocity = 0.1 },
		kept = { areaofeffect = 10, customparams = { areaofeffect = "x" } },
		plain = { range = 100 },
	}
	local compat = run({ "defs-weapon-consts-87" }, {}, weapons)
	check("consts: areaofeffect is half the tag, as damageAreaOfEffect", weapons.cannon.customparams.areaofeffect == "32")
	check("consts: maxvelocity is weaponVelocity", weapons.cannon.customparams.maxvelocity == "300")
	check("consts: maxvelocity is at least 0.3", weapons.slow.customparams.maxvelocity == "0.3")
	check("consts: a def without areaofeffect gets none", weapons.slow.customparams.areaofeffect == nil)
	check("consts: a def's own parameter is kept", weapons.kept.customparams.areaofeffect == "x")
	check("consts: a def that sets neither tag is unchanged", weapons.plain.customparams == nil)
	check("consts: two defs changed", count(compat.changed) == 2)
end

--------------------------------------------------------------------------------
-- manualBombSettings
--------------------------------------------------------------------------------

do
	local weapons = {
		manual = { dropped = 1, manualBombSettings = 1, reloadtime = 9, burst = 4, burstrate = 0.1 },
		auto = { dropped = "1", reloadtime = 0.1, burst = 4, burstrate = 0.1 },
		slow = { weapontype = "AircraftBomb", reloadtime = 3 },
		off = { dropped = 1, manualbombsettings = 0, reloadtime = 0.3 },
		cannon = { weapontype = "Cannon", reloadtime = 0.1, manualbombsettings = 1 },
		laser = { reloadtime = 0.1 },
		stuck = { dropped = 1, reloadtime = 0 },
		seventh = { dropped = 1, reloadtime = "0.142857142857" },
	}
	local compat = run({ "defs-manual-bomb-settings-92" }, {}, weapons, { weaponDefsGlobal = true })
	local m = weapons.manual
	check("bomb: a manual bomb keeps its burst", m.burst == 4 and m.burstrate == 0.1 and m.reloadtime == 9)
	check("bomb: the tag comes off, so the engine's copy leaves it alone", m.manualBombSettings == nil)
	local a = weapons.auto
	check("bomb: a fast bomb reloads in 5", a.reloadtime == 5)
	check("bomb: its rate is the reload time, in 32 bits", math.abs(a.burstrate - 0.1) < 1e-7 and a.burstrate ~= 0.1)
	check("bomb: 0.1 gives a burst of 11", a.burst == 11, tostring(a.burst))
	local s = weapons.slow
	check("bomb: a slow bomb drops 2 at 0.4", s.burst == 2 and math.abs(s.burstrate - 0.4) < 1e-7 and s.reloadtime == 3)
	local o = weapons.off
	check("bomb: a tag set false works the burst out", o.manualbombsettings == nil and o.reloadtime == 5)
	check("bomb: 0.2 gives a burst of 6", o.burst == 6, tostring(o.burst))
	check("bomb: a weapon that is not a bomb is unchanged", weapons.cannon.manualbombsettings == 1 and weapons.cannon.burst == nil)
	check("bomb: a weapon with no type that is not dropped is unchanged", weapons.laser.burst == nil)
	check("bomb: a reload of 0 is left as it is", weapons.stuck.burst == nil and weapons.stuck.reloadtime == 0)
	check("bomb: 0.142857 gives a burst of 7, as 32 bit floats did", weapons.seventh.burst == 7, tostring(weapons.seventh.burst))
	check("bomb: five defs changed", count(compat.changed) == 5)
end

do
	local inner = { dropped = 1, reloadtime = 2 }
	local units = { armthud = { weapondefs = { bomb = inner } } }
	run({ "defs-manual-bomb-settings-92" }, units, {}, { weaponDefsGlobal = true })
	check("bomb: a bomb the unit declares inside itself is worked out too", inner.burst == 2)
end

support.report()
