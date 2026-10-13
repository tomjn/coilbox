-- Proves what the rewind recorder writes: a block for every frame holding
-- every unit, weapon target, aiming piece, feature, projectile and terrain
-- change, in the layout lua/rewind-recorder/README.md describes. And what it
-- must never do, which is run in the synced half. Run it with:
--
--   luajit lua/rewind-recorder/tests/recorder_test.lua
--
-- Counts and values are asserted, never the absence of errors: a recorder that
-- failed to load writes nothing and raises nothing.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, newEngine, dump, float = support.check, support.same, support.newEngine, support.dump, support.float

--- Whether a row holds exactly these numbers, as the floats a dump stores.
local function rowIs(row, wanted)
	if not row or #row ~= #wanted then
		return false
	end
	for index = 1, #wanted do
		if row[index] ~= float(wanted[index]) then
			return false
		end
	end
	return true
end

local function show(row)
	return row and table.concat(row, " ") or "no row"
end

--------------------------------------------------------------------------------
-- A run that did not ask for a recording.
--------------------------------------------------------------------------------

do
	local engine = newEngine({ request = false })
	same("with no request no file is opened", #engine.opened, 0)
	check("with no request the gadget takes itself out", engine.removed)
	engine.create(1, 0, 10, 0, 10)
	engine.runTo(5)
	same("with no request nothing is written", engine.bytes, "")
	same("with no request nothing is said", #engine.logs + #engine.echoes + #engine.commands, 0)
end

--------------------------------------------------------------------------------
-- A write directory that refuses the file.
--------------------------------------------------------------------------------

do
	local engine = newEngine({ noFile = true })
	same("a refused file is asked for once, in binary", engine.opened[1][1] .. " " .. engine.opened[1][2],
		"coilbox-rewind.dump wb")
	check("a refused file is reported", #engine.logs == 1 and engine.logs[1]:find("permission denied", 1, true) ~= nil,
		engine.logs[1])
	check("a refused file takes the gadget out", engine.removed)
	-- The call-ins are still there until the handler removes the gadget, and
	-- they must not raise: the replay logger shares the run.
	engine.create(1, 0, 10, 0, 10)
	engine.runTo(3)
	engine.gameOver({ 0 })
	same("a refused file writes nothing", engine.bytes, "")
	same("a refused file does not stop the engine", #engine.commands, 0)
end

--------------------------------------------------------------------------------
-- The synced half.
--------------------------------------------------------------------------------

do
	local engine = newEngine()
	local callIns = {}
	for name, value in pairs(engine.synced) do
		if type(value) == "function" and name ~= "GetInfo" then
			callIns[#callIns + 1] = name
		end
	end
	same("the synced half has no call-ins", table.concat(callIns, " "), "")
	same("the synced half is named", engine.synced:GetInfo().name, "Coilbox rewind recorder")
end

--------------------------------------------------------------------------------
-- The start of the file.
--------------------------------------------------------------------------------

local DEFS = {
	unitDefs = {
		{ name = "tank", weapons = { {}, {} }, radius = 21.5 },
		{ name = "builder", weapons = {}, isBuilder = true, isMobileBuilder = true, radius = 12 },
		{ name = "factory", weapons = {}, isBuilder = true, radius = 48 },
		{ name = "wall", weapons = {} },
	},
	featureDefs = { { name = "tree" }, { name = "wreck" } },
	weaponDefs = { [0] = { name = "nothing" }, { name = "cannon" }, { name = "laser" } },
	models = {
		[1] = {
			pieces = { "base", "turret", "sleeve", "barrel", "flare", "leg" },
			parents = { nil, "base", "turret", "sleeve", "barrel", "base" },
		},
		[2] = { pieces = { "body" }, parents = {} },
		[3] = { pieces = { "pad" }, parents = {} },
		[4] = { pieces = {}, parents = {} },
	},
}

local function with(extra)
	local options = {}
	for key, value in pairs(DEFS) do
		options[key] = value
	end
	for key, value in pairs(extra or {}) do
		options[key] = value
	end
	return options
end

do
	local engine = newEngine(with({ request = { lastFrame = 4321 } }))
	same("the file starts with its magic", engine.bytes:sub(1, 4), "CBRD")
	same("then its version, as a 32 bit word", engine.bytes:sub(5, 8), "\1\0\0\0")
	local read = engine.read()
	same("the header is the first block", read.blocks[1].kind, dump.BLOCK_HEADER)
	local header = read.blocks[1].json
	same("the header gives the format", header.format, 1)
	same("the header gives the engine", header.engine, "2026.01.0 test")
	same("the header gives the game", header.game .. " " .. header.gameVersion, "Test Game 1.0")
	same("the header gives the map", header.map .. " " .. header.mapSizeX .. " " .. header.mapSizeZ, "Test Map 64 32")
	same("the header gives the last frame", header.lastFrame, 4321)
	same("the header gives the frames between unit samples", header.unitFrames, 3)
	same("the header gives the unit id limit features are offset by", header.maxUnits, 32000)
	same("the header says terrain is recorded", header.terrain, true)
	same("unit definitions are listed from id 1", table.concat(header.unitDefs, " "), "tank builder factory wall")
	same("each unit definition's radius is listed beside its name, and 0 for one that has none",
		table.concat(header.unitRadii, " "), "21.5 12 48 0")
	same("feature definitions are listed from id 1", table.concat(header.featureDefs, " "), "tree wreck")
	same("weapon definitions are listed from id 0", table.concat(header.weaponDefs, " "), "nothing cannon laser")
	same("every team is listed", #header.teams, 3)
	local first, second, third = header.teams[1], header.teams[2], header.teams[3]
	same("a team has its ally team and side", first.team .. " " .. first.allyTeam .. " " .. first.side, "0 0 arm")
	same("a team has its leader, quoted safely", first.leader, 'Some "One"')
	same("a team has its colour as bytes", table.concat(first.color, " "), "255 128 51")
	same("an AI team is named", second.ai, "TestAI")
	same("a team of players has no AI name", first.ai, nil)
	same("Gaia is marked", tostring(third.gaia) .. " " .. tostring(first.gaia), "true nil")
	same("the header is on disk before the match starts", engine.flushes, 1)
end

--------------------------------------------------------------------------------
-- Units: created, sampled, handed over, destroyed.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	engine.step() -- frame 0
	local wall = engine.create(4, 1, 100, 5, 200, { front = { 0.6, 0, 0.8 }, health = 40, maxHealth = 80, build = 0.5 })
	engine.step() -- frame 1
	local made = engine.rows(1, dump.UNITS_CREATED)
	same("a unit made during a frame is in the next block", #made, 1)
	check("a created unit has its definition, team and pose",
		rowIs(made[1], { wall, 4, 1, 100, 5, 200, 0.6, 0, 0.8, 0, 1, 0, 40, 80, 0.5, 1 }), show(made[1]))
	same("frame 1 is not a sample frame", #engine.rows(1, dump.UNIT_SAMPLES), 0)

	engine.units[wall].x = 110
	engine.units[wall].active = false
	engine.runTo(3)
	same("frame 2 is not a sample frame", #engine.rows(2, dump.UNIT_SAMPLES), 0)
	local sampled = engine.rows(3, dump.UNIT_SAMPLES)
	same("every unit is sampled every third frame", #sampled, 1)
	check("a sample is the unit's pose at that frame",
		rowIs(sampled[1], { wall, 110, 5, 200, 0.6, 0, 0.8, 0, 1, 0, 40, 80, 0.5, 0 }), show(sampled[1]))
	same("a unit is created once", #engine.rows(3, dump.UNITS_CREATED), 0)

	-- Health the engine reports outside its own range goes in as it is.
	engine.units[wall].health = 95
	engine.runTo(6)
	same("health above the maximum is written as it is", engine.rows(6, dump.UNIT_SAMPLES)[1][11], 95)
	engine.units[wall].health = -12.5
	engine.runTo(9)
	same("health below zero is written as it is", engine.rows(9, dump.UNIT_SAMPLES)[1][11], -12.5)

	engine.units[wall].team = 0
	engine.runTo(12)
	check("a unit handed over is written with its new team at the next sample",
		rowIs(engine.rows(12, dump.UNITS_GIVEN)[1], { wall, 0 }))
	engine.runTo(15)
	same("and once", #engine.rows(15, dump.UNITS_GIVEN), 0)

	engine.units[wall].x = 120
	engine.destroy(wall)
	engine.step() -- frame 16
	local gone = engine.rows(16, dump.UNITS_DESTROYED)
	same("a destroyed unit is written once", #gone, 1)
	check("a destroyed unit has the pose it died in",
		rowIs(gone[1], { wall, 120, 5, 200, 0.6, 0, 0.8, 0, 1, 0, -12.5, 80, 0.5, 0 }), show(gone[1]))
	engine.runTo(18)
	same("a destroyed unit is sampled no more", #engine.rows(18, dump.UNIT_SAMPLES), 0)

	-- A unit made and destroyed inside one frame was never there at the start
	-- of any frame, and is still counted.
	local brief = engine.create(4, 0, 1, 2, 3)
	engine.destroy(brief)
	engine.step() -- frame 19
	same("a unit that lived inside one frame is created", engine.rows(19, dump.UNITS_CREATED)[1][1], brief)
	same("and destroyed in the same block", engine.rows(19, dump.UNITS_DESTROYED)[1][1], brief)
end

-- Another gadget that raises in a call-in stops the call from reaching the
-- recorder, so every unit and feature has to be found without one.
do
	local engine = newEngine(with())
	engine.runTo(3)
	local wall = engine.create(4, 1, 7, 8, 9, { unannounced = true })
	local tree = engine.feature(1, -1, 4, 5, 6, true)
	engine.step() -- frame 4
	same("a unit no call-in announced waits for the next sample", #engine.rows(4, dump.UNITS_CREATED), 0)
	same("and so does a feature", #engine.rows(4, dump.FEATURES_CREATED), 0)
	engine.runTo(6)
	local made = engine.rows(6, dump.UNITS_CREATED)
	check("a unit no call-in announced is found by the next sample",
		#made == 1 and made[1][1] == wall and made[1][2] == 4 and made[1][3] == 1, show(made[1]))
	same("and so is a feature", engine.rows(6, dump.FEATURES_CREATED)[1][1], tree)
	same("a unit found that way is sampled like any other", engine.rows(6, dump.UNIT_SAMPLES)[1][1], wall)

	-- Destroyed with a death animation: the engine still lists it.
	engine.units[wall].x = 70
	engine.lose(wall, true)
	engine.runTo(8)
	same("a dying unit is not written off before the next sample", #engine.rows(8, dump.UNITS_DESTROYED), 0)
	engine.step() -- frame 9
	local gone = engine.rows(9, dump.UNITS_DESTROYED)
	check("a unit destroyed with no call-in is written off by the next sample, where it is",
		#gone == 1 and gone[1][1] == wall and gone[1][2] == 70, show(gone[1]))
	same("and is not sampled", #engine.rows(9, dump.UNIT_SAMPLES), 0)
	engine.runTo(12)
	same("and is not found again while the engine still lists it", #engine.rows(12, dump.UNITS_CREATED), 0)

	-- Removed outright between two samples: nothing is left to read.
	local second = engine.create(4, 0, 30, 0, 30, { unannounced = true })
	engine.runTo(15)
	engine.units[second].x = 31
	engine.runTo(16)
	engine.lose(second)
	engine.features[tree] = nil
	engine.runTo(18)
	gone = engine.rows(18, dump.UNITS_DESTROYED)
	check("a unit that is simply gone is written off by the next sample, where it was last sampled",
		#gone == 1 and gone[1][1] == second and gone[1][2] == 30, show(gone[1]))
	check("a feature that is simply gone is written off by the next sample",
		rowIs(engine.rows(18, dump.FEATURES_DESTROYED)[1], { tree }))
	engine.runTo(21)
	same("and once", #engine.rows(21, dump.FEATURES_DESTROYED), 0)
end

-- A unit the engine never announced.
do
	local engine = newEngine(with())
	local quiet = engine.create(4, 1, 7, 8, 9, { unannounced = true })
	engine.step() -- frame 0
	local made = engine.rows(0, dump.UNITS_CREATED)
	check("a unit no call-in announced is found by the first sample",
		#made == 1 and made[1][1] == quiet and made[1][2] == 4 and made[1][3] == 1, show(made[1]))
	same("and sampled in the same block", engine.rows(0, dump.UNIT_SAMPLES)[1][1], quiet)
end

-- The engine lists a destroyed unit until its death animation is over.
do
	local engine = newEngine(with())
	engine.create(4, 1, 7, 8, 9, { unannounced = true, dead = true })
	local wall = engine.create(4, 0, 1, 2, 3)
	engine.step() -- frame 0
	same("a unit already dying when the recording starts is not created", #engine.rows(0, dump.UNITS_CREATED), 1)
	engine.destroy(wall, true)
	engine.runTo(6)
	local created, sampled = 0, 0
	for frame = 1, 6 do
		created = created + #engine.rows(frame, dump.UNITS_CREATED)
		sampled = sampled + #engine.rows(frame, dump.UNIT_SAMPLES)
	end
	same("a destroyed unit the engine still lists is not created a second time", created, 0)
	same("or sampled", sampled, 0)
	same("and is destroyed once", #engine.rows(1, dump.UNITS_DESTROYED), 1)
end

-- The first frame is a sample frame whatever its number.
do
	local engine = newEngine(with())
	engine.frame = 6
	engine.create(4, 0, 1, 2, 3)
	engine.step() -- frame 7
	same("the first block samples units whatever its frame", #engine.rows(7, dump.UNIT_SAMPLES), 1)
	engine.step()
	same("the next follows the usual rule", #engine.rows(8, dump.UNIT_SAMPLES), 0)
end

-- An engine that answers only the front from the direction calls.
do
	local engine = newEngine(with({ frontOnly = true }))
	engine.create(4, 0, 1, 2, 3, { front = { 1, 0, 0 }, up = { 0, 0.8, 0.6 } })
	engine.feature(1, -1, 4, 5, 6)
	engine.step()
	local sample = engine.rows(0, dump.UNIT_SAMPLES)[1]
	check("with only a front from the engine, a unit's up comes from its vectors",
		rowIs({ sample[5], sample[6], sample[7], sample[8], sample[9], sample[10] }, { 1, 0, 0, 0, 0.8, 0.6 }),
		show(sample))
	local feature = engine.rows(0, dump.FEATURES_CREATED)[1]
	check("and a feature is written upright",
		rowIs({ feature[10], feature[11], feature[12] }, { 0, 1, 0 }), show(feature))
end

--------------------------------------------------------------------------------
-- Piece trees.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	engine.create(1, 0, 0, 0, 0, { weapons = 2 })
	engine.create(1, 0, 50, 0, 0, { weapons = 2 })
	engine.create(4, 0, 90, 0, 0)
	engine.step()
	local trees = engine.texts(dump.BLOCK_PIECES)
	same("a piece tree is written once for each definition seen", #trees, 2)
	same("a tree names its definition", trees[1].def, 1)
	same("a tree lists its pieces in the engine's order", table.concat(trees[1].pieces, " "),
		"base turret sleeve barrel flare leg")
	same("a tree gives each piece's parent, 0 for the root", table.concat(trees[1].parents, " "), "0 1 2 3 4 1")
	same("a model with no pieces has an empty tree", #trees[2].pieces, 0)
	local read = engine.read()
	check("a tree comes before the frame that first uses it",
		read.blocks[2].kind == dump.BLOCK_PIECES and read.blocks[#read.blocks].kind == dump.BLOCK_FRAME)
end

--------------------------------------------------------------------------------
-- Weapon targets: every weapon, when it changes (issue #3790).
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local tank = engine.create(1, 0, 0, 0, 0, { weapons = 2 })
	local prey = engine.create(4, 1, 500, 0, 0)
	local other = engine.create(4, 1, 0, 0, 500)
	engine.step() -- frame 0
	same("a weapon with no target before its first is not written", #engine.rows(0, dump.WEAPON_TARGETS), 0)

	engine.units[tank].targets[1] = { 1, prey }
	engine.units[tank].targets[2] = { 1, other }
	engine.runTo(3)
	local rows = engine.rows(3, dump.WEAPON_TARGETS)
	same("two weapons aimed at two targets are two rows", #rows, 2)
	check("the first weapon has its own target", rowIs(rows[1], { tank, 1, 1, prey, 0, 0 }), show(rows[1]))
	check("the second weapon has its own target", rowIs(rows[2], { tank, 2, 1, other, 0, 0 }), show(rows[2]))

	engine.runTo(6)
	same("a target that has not changed is not written again", #engine.rows(6, dump.WEAPON_TARGETS), 0)

	-- The second weapon moves to a spot on the ground, the first keeps its unit.
	engine.units[tank].targets[2] = { 2, { 10.5, 20, 30.25 } }
	engine.runTo(9)
	rows = engine.rows(9, dump.WEAPON_TARGETS)
	same("only the weapon that changed is written", #rows, 1)
	check("a position target has its place", rowIs(rows[1], { tank, 2, 2, 10.5, 20, 30.25 }), show(rows[1]))

	-- A shell to shoot down, then nothing.
	engine.units[tank].targets[1] = { 3, 777 }
	engine.units[tank].targets[2] = nil
	engine.runTo(12)
	rows = engine.rows(12, dump.WEAPON_TARGETS)
	check("a projectile target has its id", rowIs(rows[1], { tank, 1, 3, 777, 0, 0 }), show(rows[1]))
	check("losing a target is written", rowIs(rows[2], { tank, 2, 0, 0, 0, 0 }), show(rows[2]))
end

--------------------------------------------------------------------------------
-- Aiming pieces: the muzzle and its parents, when they move.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local tank = engine.create(1, 0, 1000, 0, 2000, { weapons = 2 })
	local unit = engine.units[tank]
	-- base 1, turret 2, sleeve 3, barrel 4, flare 5, leg 6. The flare sits on
	-- the end of the barrel, at the same spot.
	unit.pieces[4] = support.matrix(0, 10, 20)
	unit.pieces[5] = support.matrix(0, 10, 20)
	unit.muzzles[1] = { 0, 10, 20 }
	unit.muzzles[2] = { 0, 6, 0 }
	unit.build = 0.5
	engine.step() -- frame 0
	same("a unit still being built has no muzzle to find", #engine.rows(0, dump.PIECE_POSES), 0)

	unit.build = 1
	engine.runTo(3)
	local rows = engine.rows(3, dump.PIECE_POSES)
	local pieces = {}
	for index, row in ipairs(rows) do
		pieces[index] = row[2]
	end
	-- The first weapon's flare, barrel, sleeve, turret and base, then the
	-- second weapon's muzzle, which is nearest the leg.
	same("each weapon's muzzle is written with every parent to the root, the deeper of two pieces on one spot",
		table.concat(pieces, " "), "5 4 3 2 1 6")
	check("a pose is three rows of the piece's model space matrix",
		rowIs(rows[1], { tank, 5, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 20 }), show(rows[1]))

	engine.runTo(6)
	same("pieces that have not moved are not written again", #engine.rows(6, dump.PIECE_POSES), 0)

	-- The turret turns. Nothing else has a new matrix.
	unit.pieces[2] = { 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 2, 0, 1 }
	engine.runTo(9)
	rows = engine.rows(9, dump.PIECE_POSES)
	same("only the piece that moved is written", #rows, 1)
	check("with its new matrix", rowIs(rows[1], { tank, 2, 0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 2, 0 }), show(rows[1]))

	-- With no target, a muzzle that has moved off its piece is not looked for
	-- again: nothing is aiming.
	unit.muzzles[1] = { 0, 3, 0 }
	local looked = engine.positionReads
	engine.runTo(12)
	same("a weapon with no target is not looked at again", engine.positionReads - looked, 0)

	-- With a target it is. The script has switched the first weapon to fire
	-- from the sleeve, which is already watched.
	unit.targets[1] = { 1, 99 }
	local before = engine.matrixReads
	engine.runTo(15)
	same("a muzzle that moves to a piece already watched adds no rows", #engine.rows(15, dump.PIECE_POSES), 0)
	-- One read of where the old piece is, then one of each of the six.
	same("a muzzle that has moved is looked for among every piece", engine.positionReads - looked, 7)
	same("six pieces are watched, one matrix read each a sample", engine.matrixReads - before, 6)
	looked = engine.positionReads
	engine.runTo(18)
	same("a muzzle that is where it was found costs one read", engine.positionReads - looked, 1)

	engine.destroy(tank)
	engine.runTo(21)
	same("a destroyed unit's pieces are written no more", #engine.rows(21, dump.PIECE_POSES), 0)
end

--------------------------------------------------------------------------------
-- Builder work: what kind it is, what on, and how much build power.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local builder = engine.create(2, 0, 0, 0, 0, { power = 0 })
	local wall = engine.create(4, 0, 9, 0, 9)
	engine.step() -- frame 0
	same("a builder doing nothing is not written", #engine.rows(0, dump.BUILDER_WORK), 0)
	same("a unit that cannot build is never asked", #engine.rows(0, dump.BUILDER_WORK), 0)

	local frame = 0
	local function workAfter(task, power, commands)
		local unit = engine.units[builder]
		unit.task, unit.power, unit.commands = task, power, commands or {}
		frame = frame + 3
		engine.runTo(frame)
		return engine.rows(frame, dump.BUILDER_WORK)
	end

	local rows = workAfter({ -4, wall }, 1)
	check("building is the negative of the definition being built",
		rowIs(rows[1], { builder, -4, wall, 1, 0, 0, 0, 0 }), show(rows[1]))
	same("work that has not changed is not written again", #workAfter({ -4, wall }, 1), 0)
	rows = workAfter({ -4, wall }, 7 / 15)
	check("a change of build power alone is written", rowIs(rows[1], { builder, -4, wall, 7 / 15, 0, 0, 0, 0 }),
		show(rows[1]))
	rows = workAfter({ 40, wall }, 1)
	check("repair is the engine's repair command", rowIs(rows[1], { builder, 40, wall, 1, 0, 0, 0, 0 }), show(rows[1]))
	rows = workAfter({ 90, wall }, 1)
	check("reclaiming a unit names the unit", rowIs(rows[1], { builder, 90, wall, 1, 0, 0, 0, 0 }), show(rows[1]))
	rows = workAfter({ 90, 32000 + 12 }, 1)
	check("reclaiming a feature names it past the unit id limit",
		rowIs(rows[1], { builder, 90, 32012, 1, 0, 0, 0, 0 }), show(rows[1]))
	rows = workAfter({ 125, 32000 + 12 }, 1)
	check("resurrecting names the feature", rowIs(rows[1], { builder, 125, 32012, 1, 0, 0, 0, 0 }), show(rows[1]))
	rows = workAfter({ 130, wall }, 1)
	check("capturing names the unit", rowIs(rows[1], { builder, 130, wall, 1, 0, 0, 0, 0 }), show(rows[1]))

	-- Terraforming has no target. Its place is the front order's, when that
	-- order is to restore ground or to build.
	rows = workAfter({ 110 }, 1, { { 110, 300, 12, 400, 64 } })
	check("restoring ground has the place of the order", rowIs(rows[1], { builder, 110, -1, 1, 1, 300, 12, 400 }),
		show(rows[1]))
	rows = workAfter({ 110 }, 1, { { -4, 500, 13, 600, 2 } })
	check("levelling ground for a building has the place of the building",
		rowIs(rows[1], { builder, 110, -1, 1, 1, 500, 13, 600 }), show(rows[1]))
	rows = workAfter({ 110 }, 1, { { 25, wall } })
	check("helping another builder terraform has no place to give",
		rowIs(rows[1], { builder, 110, -1, 1, 0, 0, 0, 0 }), show(rows[1]))
	rows = workAfter(nil, 0)
	check("stopping is written", rowIs(rows[1], { builder, 0, -1, 0, 0, 0, 0, 0 }), show(rows[1]))
end

--------------------------------------------------------------------------------
-- Build queues.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local builder = engine.create(2, 0, 0, 0, 0)
	local factory = engine.create(3, 0, 50, 0, 0, { commands = { { -1 }, { -1 } } })
	engine.step() -- frame 0
	same("an empty queue is not written", #engine.rows(0, dump.BUILD_QUEUES), 0)

	-- A move, two buildings and a repair. Only the buildings are the queue.
	engine.units[builder].commands = {
		{ 10, 5, 0, 5 },
		{ -4, 100, 3, 200, 1 },
		{ -3, 300, 3, 400 },
		{ 40, 77 },
	}
	engine.runTo(3)
	local rows = engine.rows(3, dump.BUILD_QUEUES)
	same("a queue that changed is one row", #rows, 1)
	same("it names the builder", rows[1].unit, builder)
	same("it holds the buildings and nothing else", #rows[1].items, 2)
	local a, b = rows[1].items[1], rows[1].items[2]
	same("an item is a definition, a place and a facing", a.def .. " " .. a.x .. " " .. a.z .. " " .. a.facing,
		"4 100 200 1")
	same("an order with no facing faces 0", b.def .. " " .. b.x .. " " .. b.z .. " " .. b.facing, "3 300 400 0")
	same("a factory's orders are not a build queue", rows[1].unit ~= factory, true)

	engine.runTo(6)
	same("a queue that has not changed is not written again", #engine.rows(6, dump.BUILD_QUEUES), 0)

	-- The first building is done. Same length as nothing, different contents.
	engine.units[builder].commands = { { -3, 300, 3, 400 } }
	engine.runTo(9)
	rows = engine.rows(9, dump.BUILD_QUEUES)
	same("a shorter queue is written", #rows[1].items, 1)
	engine.units[builder].commands = { { -3, 300, 3, 408 } }
	engine.runTo(12)
	same("a queue of the same length with a moved item is written", engine.rows(12, dump.BUILD_QUEUES)[1].items[1].z, 408)
	engine.units[builder].commands = {}
	engine.runTo(15)
	rows = engine.rows(15, dump.BUILD_QUEUES)
	check("an emptied queue is written with no items", #rows == 1 and #rows[1].items == 0)
end

--------------------------------------------------------------------------------
-- Features.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local tree = engine.feature(1, -1, 10, 1, 20, true)
	engine.step() -- frame 0
	local rows = engine.rows(0, dump.FEATURES_CREATED)
	same("a feature that was there before the gadget loaded is in the first block", #rows, 1)
	check("a feature has its definition, team, place, front and up",
		rowIs(rows[1], { tree, 1, -1, 10, 1, 20, 1, 0, 0, 0, 0.6, 0.8 }), show(rows[1]))

	local wreck = engine.feature(2, 1, 30, 2, 40)
	engine.step() -- frame 1
	rows = engine.rows(1, dump.FEATURES_CREATED)
	check("a feature that appears is written with its team", #rows == 1 and rows[1][1] == wreck and rows[1][3] == 1,
		show(rows[1]))
	engine.runTo(4)
	same("a feature is written once", #engine.rows(3, dump.FEATURES_CREATED), 0)

	engine.removeFeature(tree)
	engine.step() -- frame 5
	check("a feature that goes is written", rowIs(engine.rows(5, dump.FEATURES_DESTROYED)[1], { tree }))
end

--------------------------------------------------------------------------------
-- Projectiles: every one on every frame.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	engine.step() -- frame 0
	same("a frame with no projectiles has no section for them", engine.frames()[0].sections[dump.PROJECTILES], nil)
	local shell = engine.projectile({ def = 1, team = 0, owner = 5, x = 1, y = 2, z = 3, vx = 0.5, vy = -1, vz = 4 })
	-- Flying debris: no weapon definition, no team, no owner.
	local debris = engine.projectile({ x = 7, y = 8, z = 9, vx = 0, vy = -0.25, vz = 0 })
	engine.step() -- frame 1
	local rows = engine.rows(1, dump.PROJECTILES)
	same("every projectile is written", #rows, 2)
	check("a shell has its definition, team, owner, place and velocity",
		rowIs(rows[1], { shell, 1, 0, 5, 1, 2, 3, 0.5, -1, 4 }), show(rows[1]))
	check("a projectile with no weapon definition is written, with -1 for each thing it lacks",
		rowIs(rows[2], { debris, -1, -1, -1, 7, 8, 9, 0, -0.25, 0 }), show(rows[2]))
	engine.projectiles[shell].x = 1.5
	engine.step() -- frame 2
	rows = engine.rows(2, dump.PROJECTILES)
	same("projectiles are written on a frame that samples no units", #rows, 2)
	same("with where they are now", rows[1][5], 1.5)
	engine.projectiles[shell] = nil
	engine.step() -- frame 3
	same("a projectile that is gone is written no more", #engine.rows(3, dump.PROJECTILES), 1)
end

do
	local engine = newEngine(with({ noAllProjectiles = true }))
	engine.projectile({ def = 1, team = 0, owner = 5, x = 1, y = 2, z = 3, vx = 0, vy = 0, vz = 0 })
	engine.step()
	same("an engine without GetAllProjectiles is asked for a rectangle instead", #engine.rows(0, dump.PROJECTILES), 1)
	check("and the rectangle reaches far past the map",
		engine.rectangle[1] < -1e6 and engine.rectangle[2] < -1e6 and engine.rectangle[3] > 1e6 and engine.rectangle[4] > 1e6)
end

--------------------------------------------------------------------------------
-- Terrain.
--------------------------------------------------------------------------------

-- The stand-in map is 64 by 32 elmos, so 8 by 4 squares. Its own height at
-- corner x, z is x + 100 z.
do
	local engine = newEngine(with({ handlerCallIn = true }))
	engine.step() -- frame 0
	same("the recorder registers the heightmap call-in itself", table.concat(engine.callInUpdates, " "),
		"UnsyncedHeightMapUpdate")
	same("an unchanged map writes no terrain", engine.frames()[0].sections[dump.TERRAIN], nil)
	-- 8 by 4 corners, the far edges left out.
	same("the whole map is looked at once, when listening starts", engine.heightReads, 32)

	engine.dig(2, 1, 90)
	engine.step() -- frame 1
	same("a change the engine has not reported is not seen", engine.frames()[1].sections[dump.TERRAIN], nil)
	local heard = #engine.handlerRects
	engine.draw()
	same("the handler's own function is still called", #engine.handlerRects, heard + 1)
	engine.step() -- frame 2
	local rows = engine.rows(2, dump.TERRAIN)
	same("a reported change is one row for each corner that changed", #rows, 1)
	check("the row is the corner, the map's own height before, and the height now",
		rowIs(rows[1], { 2, 1, 102, 90 }), show(rows[1]))
	engine.step() -- frame 3
	same("a change is written once", engine.frames()[3].sections[dump.TERRAIN], nil)

	engine.dig(2, 1, 85.5)
	engine.dig(3, 1, 103)
	engine.draw()
	engine.step() -- frame 4
	rows = engine.rows(4, dump.TERRAIN)
	same("a corner reported with its height unchanged is not written", #rows, 1)
	check("a second change starts from the height the first one left", rowIs(rows[1], { 2, 1, 90, 85.5 }), show(rows[1]))

	-- The far edges cannot be read exactly from Lua, so they are left out.
	engine.dig(8, 1, 50)
	engine.dig(1, 4, 50)
	engine.draw()
	engine.step() -- frame 5
	same("corners on the far edges are not written", engine.frames()[5].sections[dump.TERRAIN], nil)

	-- A gadget handler rebuilding its call-ins takes the function away.
	engine.globals.UnsyncedHeightMapUpdate = nil
	engine.dig(5, 2, 10)
	engine.draw()
	engine.step() -- frame 6
	rows = engine.rows(6, dump.TERRAIN)
	check("a change reported while nothing was listening is found by looking at the whole map again",
		#rows == 1 and rowIs(rows[1], { 5, 2, 205, 10 }), show(rows[1]))
	same("and the call-in is registered again", #engine.callInUpdates, 2)
end

-- A gadget handler with no function of its own at the call-in.
do
	local engine = newEngine(with())
	engine.step()
	engine.dig(0, 0, -5)
	engine.draw()
	engine.step()
	check("terrain is heard under a handler that does not pass the call-in on",
		rowIs(engine.rows(1, dump.TERRAIN)[1], { 0, 0, 0, -5 }))
end

-- Heights a game changed while it loaded, which the engine has not drawn.
do
	local engine = newEngine(with())
	engine.dig(1, 1, 55)
	engine.step()
	check("a height changed before the first frame is in the first block, drawn or not",
		rowIs(engine.rows(0, dump.TERRAIN)[1], { 1, 1, 101, 55 }), show(engine.rows(0, dump.TERRAIN)[1]))
	same("the engine is made to copy its heights by turning the full view off and on",
		table.concat(engine.views, "|"), "specfullview 0|specfullview 3")
	same("the whole map is still looked at once", engine.heightReads, 32)

	engine.dig(2, 2, 7)
	engine.runTo(5)
	same("between windows the recorder waits to be told", #engine.views, 2)

	-- The game ends with a change the engine never got round to reporting.
	engine.gameOver({ 0 })
	check("a change not yet reported when the game ends is in the last block",
		rowIs(engine.rows(6, dump.TERRAIN)[1], { 2, 2, 202, 7 }), show(engine.rows(6, dump.TERRAIN)[1]))
	same("because the heights are copied again as the recording ends", #engine.views, 4)
end

do
	local engine = newEngine(with({ request = { lastFrame = 4 } }))
	engine.runTo(3)
	engine.dig(3, 0, 1)
	engine.step() -- frame 4, the last
	check("a recording that ends at the replay's last frame ends with the simulation's heights too",
		rowIs(engine.rows(4, dump.TERRAIN)[1], { 3, 0, 3, 1 }), show(engine.rows(4, dump.TERRAIN)[1]))
end

-- The engine does not report every change it makes.
do
	local engine = newEngine(with({ request = { lastFrame = 5000 } }))
	engine.runTo(10)
	engine.dig(4, 1, 33)
	engine.runTo(899)
	local rows = 0
	for frame = 11, 899 do
		rows = rows + #engine.rows(frame, dump.TERRAIN)
	end
	same("a change the engine never reports is not seen inside the window", rows, 0)
	engine.step() -- frame 900
	check("and is written when the window ends, by reading the whole map",
		rowIs(engine.rows(900, dump.TERRAIN)[1], { 4, 1, 104, 33 }), show(engine.rows(900, dump.TERRAIN)[1]))
	-- Frames 0 and 900.
	same("the heights are copied once a window", #engine.views, 4)
	engine.runTo(1800)
	same("a window in which nothing changed writes no terrain", engine.frames()[1800].sections[dump.TERRAIN], nil)
end

-- A spectator following one team is shown only what that team sees, and has
-- no full view to turn off and on.
do
	local engine = newEngine(with({ fullView = false }))
	engine.dig(1, 1, 55)
	engine.runTo(2)
	engine.gameOver({})
	same("without a full view the spectator's view is left alone", #engine.views, 0)
end

--------------------------------------------------------------------------------
-- Frames, progress and the end.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with({ request = { lastFrame = 1802 } }))
	engine.runTo(1802)
	local read = engine.read()
	local frames, last, inOrder = 0, nil, true
	for _, block in ipairs(read.blocks) do
		if block.kind == dump.BLOCK_FRAME then
			frames = frames + 1
			inOrder = inOrder and (last == nil or block.frame.frame == last + 1)
			last = block.frame.frame
		end
	end
	check("frames are written in order", inOrder)
	same("every frame has a block, the empty ones too", frames, 1803)
	-- The header, each frame, and the end.
	same("the file is flushed after every block", engine.flushes, 1 + 1803 + 1)
	same("progress is said once a window", table.concat(engine.echoes, "|"),
		"coilbox-rewind-recorder: frame 0 of 1802|coilbox-rewind-recorder: frame 900 of 1802"
			.. "|coilbox-rewind-recorder: frame 1800 of 1802")

	local final = read.blocks[#read.blocks]
	same("a replay with no game over ends at its last frame", final.kind, dump.BLOCK_END)
	same("the end says why", final.json.reason, "last_frame")
	same("the end gives the last frame", final.json.frame, 1802)
	same("the end counts the frame blocks", final.json.frames, 1803)
	check("the file is closed", engine.closed)
	same("the engine is left running until the frame after", #engine.commands, 0)

	local size = #engine.bytes
	engine.step() -- frame 1803
	same("a headless engine plays on past a replay, so it is told to quit", table.concat(engine.commands, " "),
		"quitforce")
	same("nothing is written after the end", #engine.bytes, size)
end

do
	local engine = newEngine(with())
	local wall = engine.create(4, 0, 1, 2, 3)
	engine.runTo(7)
	-- The unit dies in the frame the game ends in.
	engine.destroy(wall)
	engine.gameOver({ 1 })
	local read = engine.read()
	local final = read.blocks[#read.blocks]
	same("game over ends the dump", final.json.reason, "game_over")
	same("with the frame the game ended in", final.json.frame, 7)
	same("and the winning ally teams", table.concat(final.json.winners, " "), "1")
	same("what happened in the last frame gets a block of its own", engine.rows(8, dump.UNITS_DESTROYED)[1][1], wall)
	same("which is counted", final.json.frames, 9)
	check("the file is closed at game over", engine.closed)
	same("the replay logger is the one that quits at game over", #engine.commands, 0)

	local size = #engine.bytes
	engine.step()
	engine.gameOver({ 1 })
	same("nothing is written after game over", #engine.bytes, size)
	same("and the engine is not told to quit twice over", #engine.commands, 0)
end

-- A game ended by a gadget ends inside a frame, before the recorder has been
-- called for it.
do
	local engine = newEngine(with())
	local wall = engine.create(4, 0, 1, 2, 3)
	engine.runTo(7)
	engine.destroy(wall)
	engine.frame = 8
	engine.gameOver({ 0 })
	local read = engine.read()
	local final = read.blocks[#read.blocks]
	same("a game that ends inside a frame ends at that frame", final.json.frame, 8)
	same("with a block for every frame up to it and none missing", final.json.frames, 9)
	same("the last of which holds what happened since the one before",
		engine.rows(8, dump.UNITS_DESTROYED)[1][1], wall)
end

do
	local engine = newEngine(with())
	engine.gameOver({})
	local read = engine.read()
	same("a game that ends before its first frame still ends the dump", read.blocks[#read.blocks].json.reason, "game_over")
	same("with no winners", #read.blocks[#read.blocks].json.winners, 0)
end

--------------------------------------------------------------------------------
-- A run that is stopped.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	engine.create(4, 0, 1, 2, 3)
	engine.runTo(5)
	local whole = engine.read()
	check("a run stopped between frames reads to its last frame",
		not whole.truncated and whole.blocks[#whole.blocks].frame.frame == 5)
	same("and has no end block", whole.blocks[#whole.blocks].kind, dump.BLOCK_FRAME)

	-- Killed part way through writing a block.
	local cut = dump.read(engine.bytes:sub(1, #engine.bytes - 3), support.json.decode)
	check("a file cut inside a block reads up to the block before",
		cut.truncated and cut.blocks[#cut.blocks].frame.frame == 4)
	local short = dump.read(engine.bytes:sub(1, #engine.bytes - 9), support.json.decode)
	check("a file cut inside a block's first eight bytes reads up to the block before",
		short.truncated and short.blocks[#short.blocks].frame.frame == 4)

	local size = #engine.bytes
	engine.recorder:Shutdown()
	check("the engine shutting down closes the file", engine.closed)
	same("and writes no end block", #engine.bytes, size)
	same("a shutdown takes the heightmap function back out", engine.globals.UnsyncedHeightMapUpdate, nil)
end

--------------------------------------------------------------------------------
-- A unit that vanishes between being listed and being read.
--------------------------------------------------------------------------------

do
	local engine = newEngine(with())
	local kept = engine.create(4, 0, 1, 2, 3)
	local lost = engine.create(4, 0, 4, 5, 6)
	engine.step() -- frame 0
	-- Still listed, and every call about it answers nothing.
	engine.units[lost] = nil
	engine.unitOrder[#engine.unitOrder + 1] = lost
	local listed = engine.recorder.Spring.GetAllUnits
	rawset(engine.recorder.Spring, "GetAllUnits", function()
		return { kept, lost }
	end)
	engine.runTo(3)
	rawset(engine.recorder.Spring, "GetAllUnits", listed)
	local rows = engine.rows(3, dump.UNIT_SAMPLES)
	check("a unit the engine no longer answers for is left out, and the block still reads",
		#rows == 1 and rows[1][1] == kept, #rows)
	same("and the recording goes on", #engine.logs, 0)
end

--------------------------------------------------------------------------------
-- The same match twice.
--------------------------------------------------------------------------------

do
	local function play()
		local engine = newEngine(with({ request = { lastFrame = 30 } }))
		local tank = engine.create(1, 0, 10, 0, 10, { weapons = 2 })
		local builder = engine.create(2, 1, 40, 0, 40, { power = 0 })
		engine.feature(1, -1, 5, 0, 5, true)
		engine.runTo(4)
		engine.units[tank].targets[1] = { 1, builder }
		engine.units[tank].muzzles[1] = { 0, 5, 0 }
		engine.units[builder].commands = { { -4, 16, 0, 16, 0 } }
		engine.projectile({ def = 1, team = 0, owner = tank, x = 1, y = 2, z = 3, vx = 1, vy = 1, vz = 1 })
		engine.dig(1, 1, 3)
		engine.draw()
		engine.runTo(30)
		return engine.bytes
	end
	local first, second = play(), play()
	check("the same match played twice writes the same bytes", first == second and #first > 2000, #first)
end

support.report()
