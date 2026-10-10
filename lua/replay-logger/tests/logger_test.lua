-- Proves what the replay logger writes: a header, one line per unit event with
-- the position the unit was at, and a game over line carrying the totals coilbox
-- compares with the replay's own. And what it must never do, which is change the
-- simulation. Run it with:
--
--   luajit lua/replay-logger/tests/logger_test.lua
--
-- The counts are asserted, never the absence of errors: a logger that failed to
-- load writes nothing and raises nothing.
--
-- tests/fixtures/match.jsonl is what the fixture match below writes, byte for
-- byte. The Rust parser reads the same file in its own tests, so a change to the
-- logger's output fails here and a change to the parser fails there. After a
-- deliberate change to the format, write the file again with:
--
--   COILBOX_WRITE_FIXTURE=1 luajit lua/replay-logger/tests/logger_test.lua

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, newEngine, ofKind, decoded = support.check, support.newEngine, support.ofKind, support.decoded

--------------------------------------------------------------------------------
-- The fixture match: two players and Gaia, seven units made, four destroyed, one
-- handed over and captured back.
--------------------------------------------------------------------------------

-- 0.3 and 1234.5677 as the 32 bit floats the engine holds them as. Lua here
-- keeps doubles, so these are those floats widened, digit for digit.
local FLOAT_0_3 = 0.30000001192092896
local FLOAT_1234_5677 = 1234.5677490234375

local STATS = {
	[0] = {
		{ frame = 0, metalUsed = 0, unitsProduced = 0 },
		{ frame = 480, metalUsed = 400, unitsProduced = 2 },
		{
			frame = 960,
			metalUsed = FLOAT_1234_5677, energyUsed = 5000,
			metalProduced = 1500, energyProduced = 9000.5,
			metalExcess = FLOAT_0_3, energyExcess = 0,
			metalReceived = 0, energyReceived = 0,
			metalSent = 0, energySent = 0,
			damageDealt = 4100, damageReceived = 0,
			unitsProduced = 4, unitsDied = 1,
			unitsReceived = 0, unitsSent = 1,
			unitsCaptured = 1, unitsOutCaptured = 0,
			unitsKilled = 2,
		},
	},
	[1] = {
		{ frame = 0, metalUsed = 0, unitsProduced = 0 },
		{
			frame = 480,
			metalUsed = 300, energyUsed = 2000,
			metalProduced = 900, energyProduced = 4000,
			metalExcess = 0, energyExcess = 0,
			metalReceived = 0, energyReceived = 0,
			metalSent = 0, energySent = 0,
			damageDealt = 0, damageReceived = 4100,
			unitsProduced = 2, unitsDied = 2,
			unitsReceived = 1, unitsSent = 0,
			unitsCaptured = 0, unitsOutCaptured = 1,
			unitsKilled = 0,
		},
	},
}

local function fixtureMatch(options)
	options = options or {}
	options.teams = { 0, 1, 2 }
	options.gaiaTeam = 2
	options.stats = STATS
	local engine = newEngine(options)

	engine.frame = 0
	engine.synced:GameStart()
	engine.unsynced:GameStart()
	local commander0 = engine.create(12, 0, 100, 5.26, 200)
	engine.finish(commander0)
	local commander1 = engine.create(31, 1, 3900.5, 10, 1800)
	engine.finish(commander1)

	engine.runTo(90)
	local tank = engine.create(40, 0, 160, 5, 260, commander0)
	-- Walks off, and is somewhere new by the next position at frame 120.
	engine.move(commander0, 130, 5, 215.04)
	engine.runTo(300)
	engine.finish(tank)

	-- Started and never finished: cancelled, which the engine reports as a
	-- death with no attacker.
	engine.runTo(450)
	local cancelled = engine.create(41, 0, 220, 5, 260, commander0)
	engine.runTo(500)
	engine.destroy(cancelled)

	engine.runTo(600)
	local scout = engine.create(50, 1, 3800, 10, 1750, commander1)
	engine.move(commander1, 3850, 10, 1790)
	engine.runTo(700)
	engine.finish(scout)
	engine.move(scout, 2000, 7.5, 1000.04)
	engine.runTo(900)
	engine.destroy(scout, tank, 7)

	-- Built by one player, given to the other, and captured back.
	engine.runTo(1000)
	local tower = engine.create(52, 0, 300, 5, 300, commander0)
	engine.finish(tower)
	engine.runTo(1050)
	engine.give(tower, 1)
	engine.runTo(1100)
	engine.give(tower, 0, true)

	engine.runTo(1200)
	local critter = engine.create(60, 2, 2048, 0, 1024)
	engine.finish(critter)
	engine.destroy(critter, tank, 7)

	engine.runTo(1500)
	engine.destroy(commander1, tank, 7)
	engine.runTo(1501)
	engine.synced:GameOver({ 0 })

	engine.ids = {
		commander0 = commander0, commander1 = commander1, tank = tank, scout = scout, tower = tower,
	}
	return engine
end

--------------------------------------------------------------------------------
-- The counts.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local lines = decoded(engine)

	check("the file is the one name coilbox reads, opened for writing",
		#engine.opened == 1 and engine.opened[1][1] == "coilbox-replay-events.jsonl" and engine.opened[1][2] == "w")
	check("the header is the first line", lines[1].kind == "header")
	check("there is exactly one header", #ofKind(engine, "header") == 1)
	check("every unit made is one unit_created line", #ofKind(engine, "unit_created") == 7,
		tostring(#ofKind(engine, "unit_created")))
	check("every unit finished is one unit_finished line", #ofKind(engine, "unit_finished") == 6,
		tostring(#ofKind(engine, "unit_finished")))
	check("every change of team is one unit_given line", #ofKind(engine, "unit_given") == 2,
		tostring(#ofKind(engine, "unit_given")))
	check("each start unit that moved has one position, and one that stood still has none",
		#ofKind(engine, "start_unit_position") == 2, tostring(#ofKind(engine, "start_unit_position")))
	check("every unit destroyed is one unit_destroyed line", #ofKind(engine, "unit_destroyed") == 4,
		tostring(#ofKind(engine, "unit_destroyed")))
	check("there is exactly one game_start and one game_over",
		#ofKind(engine, "game_start") == 1 and #ofKind(engine, "game_over") == 1)
	check("the game over line is the last one", lines[#lines].kind == "game_over")
	check("nothing else was written", #lines == 1 + 1 + 7 + 6 + 4 + 2 + 2 + 1, tostring(#lines))
end

--------------------------------------------------------------------------------
-- The header.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local header = ofKind(engine, "header")[1]

	check("the header carries the format version", header.format == 1)
	check("the header names the game as the gadget sees it",
		header.game == "Test Game" and header.gameVersion == "1.0" and header.gameShortName == "TG")
	check("the header names the map and its size",
		header.map == "Test Map" and header.mapSizeX == 4096 and header.mapSizeZ == 2048)
	check("the header names the engine", header.engine == "2026.01.0 test")
	check("the header names the Gaia team", header.gaiaTeam == 2)
	check("the header says how many frames lie between two positions", header.positionFrames == 60)
	check("the header says the engine had no unit definitions to list", header.unitDefs == 0)
	check("the header says how many frames one damage line adds up", header.damageFrames == 450)
	check("the header gives the grid damage is added up on, 256 cells on the longer side",
		header.gridWidth == 256 and header.gridHeight == 128)
end

do
	local engine = newEngine({ game = { gameName = 'Quote "this"\\now', mapName = "Tab\there" } })
	local header = ofKind(engine, "header")[1]

	check("a name with a quote and a backslash in it survives", header.game == 'Quote "this"\\now', header.game)
	check("a name with a control character in it survives", header.map == "Tab\there")
end

--------------------------------------------------------------------------------
-- Where a unit was.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local created = ofKind(engine, "unit_created")
	local destroyed = ofKind(engine, "unit_destroyed")
	local finished = ofKind(engine, "unit_finished")

	local first = created[1]
	check("a created unit is where the engine put it, in world coordinates",
		first.x == 100 and first.y == 5.3 and first.z == 200,
		first.x .. "," .. first.y .. "," .. first.z)
	check("a created unit carries its id, its def, its team and the frame",
		first.unit == engine.ids.commander0 and first.def == 12 and first.team == 0 and first.frame == 0)
	check("a unit nothing built has no builder", first.builder == nil)
	check("a unit something built names its builder", created[3].builder == engine.ids.commander0)
	check("a finished unit carries the frame it finished on",
		finished[3].unit == engine.ids.tank and finished[3].frame == 300)

	local scout = destroyed[2]
	check("a destroyed unit is where it died, which is not where it was made",
		scout.unit == engine.ids.scout and scout.x == 2000 and scout.y == 7.5 and scout.z == 1000,
		scout.x .. "," .. scout.y .. "," .. scout.z)
	check("a destroyed unit names what killed it",
		scout.attacker == engine.ids.tank and scout.attackerDef == 40 and scout.attackerTeam == 0 and scout.weapon == 7)
	check("a destroyed unit carries its own def, team and frame",
		scout.def == 50 and scout.team == 1 and scout.frame == 900)

	local cancelled = destroyed[1]
	check("a unit that died of no attack names no attacker",
		cancelled.attacker == nil and cancelled.attackerDef == nil and cancelled.attackerTeam == nil
			and cancelled.weapon == nil)
end

--------------------------------------------------------------------------------
-- The units a team started with.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local created = ofKind(engine, "unit_created")
	local finished = ofKind(engine, "unit_finished")
	local destroyed = ofKind(engine, "unit_destroyed")

	check("a unit a team started with says so on every line about it",
		created[1].startUnit == true and created[2].startUnit == true and finished[1].startUnit == true
			and destroyed[4].unit == engine.ids.commander1 and destroyed[4].startUnit == true)

	local flagged = 0
	for _, line in ipairs(decoded(engine)) do
		if line.startUnit and line.kind == "unit_created" then
			flagged = flagged + 1
		end
	end
	check("one start unit for each of the two players and none for Gaia", flagged == 2, tostring(flagged))
	check("a unit something built is not a start unit", created[3].startUnit == nil)
	check("a unit made later by no builder is not one either", created[7].team == 2 and created[7].startUnit == nil)
	check("the flag is left out, not written as false",
		not engine.raw:find('"startUnit":false', 1, true))
end

do
	-- A game that spawns its start units some way into the match, after a team
	-- has picked a side, which is what Splinter Faction does.
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	engine.runTo(450)
	local late = engine.create(12, 0, 10, 0, 10)
	local also = engine.create(13, 0, 20, 0, 20)
	engine.runTo(451)
	local next = engine.create(14, 0, 30, 0, 30)
	local created = ofKind(engine, "unit_created")

	check("a start unit is one made on the frame its team's first unit was, whenever that is",
		created[1].unit == late and created[1].startUnit == true)
	check("every unit a team is given on that frame is one", created[2].unit == also and created[2].startUnit == true)
	check("a unit made a frame later is not", created[3].unit == next and created[3].startUnit == nil)
end

do
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	local mine = engine.create(12, 0, 10, 0, 10)
	engine.give(mine, 1)
	local made = engine.create(13, 1, 20, 0, 20)
	local created = ofKind(engine, "unit_created")

	check("a team whose first unit was given to it has no start unit",
		created[2].unit == made and created[2].startUnit == nil)
end

do
	local engine = newEngine({ teams = { 0, 1, 2 }, gaiaTeam = 2 })
	engine.create(60, 2, 10, 0, 10)
	check("Gaia has no start unit", ofKind(engine, "unit_created")[1].startUnit == nil)
end

--------------------------------------------------------------------------------
-- A unit that changed team.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local given = ofKind(engine, "unit_given")

	check("a gift names the unit, its def, the frame and where it was",
		given[1].unit == engine.ids.tower and given[1].def == 52 and given[1].frame == 1050
			and given[1].x == 300 and given[1].z == 300)
	check("a gift names the team it went to and the team it left", given[1].team == 1 and given[1].from == 0)
	check("a gift is not a capture", given[1].captured == nil)
	check("a capture says so", given[2].team == 0 and given[2].from == 1 and given[2].captured == true)
end

do
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	local a = engine.create(12, 0, 10, 0, 10)
	local b = engine.create(31, 1, 20, 0, 20)
	local c = engine.create(40, 1, 30, 0, 30, b)
	engine.give(c, 0, true)
	engine.give(b, 0)
	engine.give(a, 1, true)
	local given = ofKind(engine, "unit_given")

	check("a gift after a capture to the same team is still a gift",
		given[1].captured == true and given[2].captured == nil and given[3].captured == true)
	check("one line for each change of team, and none for the engine's UnitTaken", #given == 3)
end

--------------------------------------------------------------------------------
-- Where a start unit went.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local positions = ofKind(engine, "start_unit_position")

	check("a position is written on the first sampled frame after the unit moved",
		positions[1].unit == engine.ids.commander0 and positions[1].frame == 120
			and positions[1].x == 130 and positions[1].z == 215,
		positions[1].frame .. " " .. positions[1].x .. "," .. positions[1].z)
	check("a position names the team and carries no height or def",
		positions[1].team == 0 and positions[1].y == nil and positions[1].def == nil)
	check("the other player's is written the same way",
		positions[2].unit == engine.ids.commander1 and positions[2].frame == 660 and positions[2].team == 1)
end

do
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	local start = engine.create(12, 0, 10, 0, 10)
	local other = engine.create(40, 0, 50, 0, 50, start)
	engine.runTo(600)
	check("a start unit that never moved writes no position", #ofKind(engine, "start_unit_position") == 0)

	engine.move(other, 500, 0, 500)
	engine.runTo(720)
	check("a unit that is not a start unit never has one", #ofKind(engine, "start_unit_position") == 0)

	engine.move(start, 11, 0, 10)
	engine.runTo(779)
	check("nothing is written between two sampled frames", #ofKind(engine, "start_unit_position") == 0)
	engine.runTo(840)
	check("and one position on the next", #ofKind(engine, "start_unit_position") == 1)
	engine.runTo(1200)
	check("standing still again writes nothing more", #ofKind(engine, "start_unit_position") == 1)

	engine.move(start, 11.04, 0, 10.04)
	engine.runTo(1260)
	check("a move too small to change what is written is not a move", #ofKind(engine, "start_unit_position") == 1)

	engine.give(start, 1)
	engine.move(start, 40, 0, 40)
	engine.runTo(1320)
	local positions = ofKind(engine, "start_unit_position")
	check("a start unit that changed team is still one, under its new team",
		#positions == 2 and positions[2].team == 1 and ofKind(engine, "unit_given")[1].startUnit == true)

	engine.destroy(start)
	engine.runTo(1500)
	check("a destroyed start unit has no more positions", #ofKind(engine, "start_unit_position") == 2)
end

--------------------------------------------------------------------------------
-- The game over line, which is what coilbox checks the run against.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()
	local over = ofKind(engine, "game_over")[1]

	check("the game over line carries the frame the game ended on", over.frame == 1501)
	check("the game over line names the winning ally teams", #over.winners == 1 and over.winners[1] == 0)
	check("Gaia has no totals, because the replay's trailer has none for it either",
		#over.teams == 2 and over.teams[1].team == 0 and over.teams[2].team == 1)

	local team0, team1 = over.teams[1], over.teams[2]
	check("a team's totals are its newest sample", team0.samples == 3 and team1.samples == 2)
	check("the newest sample reports the frame the game ended on", team0.frame == 1501)
	check("whole totals come through whole",
		team0.metalProduced == 1500 and team0.unitsProduced == 4 and team0.unitsDied == 1
			and team0.unitsKilled == 2 and team1.damageReceived == 4100)
	check("a fractional total comes through", team0.energyProduced == 9000.5)

	-- The digits, not the decoded number: fifteen decimals is what makes a 32
	-- bit float read back as itself.
	check("a 32 bit float is written with the digits that round trip it",
		engine.lines[#engine.lines]:find('"metalUsed":1234.567749023437500,', 1, true) ~= nil
			and engine.lines[#engine.lines]:find('"metalExcess":0.300000011920929,', 1, true) ~= nil,
		engine.lines[#engine.lines])
end

do
	local engine = fixtureMatch()

	check("the engine is told to quit once the game over line is on disk",
		engine.commands[#engine.commands] == "quitforce" and engine.closed,
		tostring(engine.commands[#engine.commands]))

	local quits = 0
	for _, command in ipairs(engine.commands) do
		if command == "quitforce" then
			quits = quits + 1
		end
	end
	check("and told once", quits == 1)
end

do
	local engine = newEngine()
	engine.create(12, 0, 1, 2, 3)

	local quit = false
	for _, command in ipairs(engine.commands) do
		quit = quit or command == "quitforce"
	end
	check("a unit event does not end the run", not quit)
end

do
	local engine = newEngine({ teams = { 0 }, stats = {} })
	engine.frame = 30
	engine.synced:GameOver({})
	local over = ofKind(engine, "game_over")[1]

	check("a game nobody won has an empty list of winners", #over.winners == 0)
	check("a team the engine has no statistics for reports no samples",
		#over.teams == 1 and over.teams[1].samples == 0 and over.teams[1].metalUsed == nil)
	check("an empty list of winners is still a list",
		engine.lines[#engine.lines]:find('"winners":[]', 1, true) ~= nil)
end

--------------------------------------------------------------------------------
-- An interrupted run.
--------------------------------------------------------------------------------

do
	local engine = fixtureMatch()

	check("every line is flushed as it is written", engine.flushes == #engine.lines,
		engine.flushes .. " flushes for " .. #engine.lines .. " lines")
	check("every line ends in a newline, so a file cut short ends on a whole line",
		select(2, engine.raw:gsub("\n", "")) == #engine.lines)

	local whole = true
	for _, line in ipairs(engine.lines) do
		local ok, value = pcall(support.json.decode, line)
		whole = whole and ok and type(value) == "table" and value.kind ~= nil
	end
	check("every line is a whole JSON object on its own", whole)

	engine.unsynced:Shutdown()
	check("the file is closed when the gadget shuts down", engine.closed)
end

--------------------------------------------------------------------------------
-- What the logger must never do.
--------------------------------------------------------------------------------

do
	-- The synced stub raises on any Spring function outside the ones that read,
	-- and on a random draw, so the fixture match finishing at all is the proof.
	local ok, reason = pcall(fixtureMatch)
	check("the synced half reads the simulation and writes nothing to it", ok, tostring(reason))

	local source = assert(io.open(support.root() .. "/" .. support.GADGET)):read("*a")
	local synced = source:match("IsSyncedCode%(%) then(.-)\nelse\n")
	check("the synced half is found in the source", synced ~= nil)
	check("the synced half opens no file", not synced:find("io%."))
	check("the synced half sends no console command", not synced:find("SendCommands"))
	check("the synced half walks no table in an order the engine does not fix", not synced:find("[^i]pairs%("))
	-- Every Spring.SetX, Spring.AddX, Spring.CreateX and the rest change the
	-- simulation. The synced half is allowed exactly the reads listed here.
	local allowed = {
		GetGameFrame = true,
		GetUnitPosition = true,
		GetUnitHealth = true,
		GetTeamStatsHistory = true,
		GetGaiaTeamID = true,
		GetTeamList = true,
		GetTeamUnitStats = true,
	}
	local strangers = {}
	for name in synced:gmatch("Spring%.([%w_]+)") do
		if not allowed[name] then
			strangers[#strangers + 1] = name
		end
	end
	check("the synced half calls only the functions that read", #strangers == 0, table.concat(strangers, ", "))
end

--------------------------------------------------------------------------------
-- The unsynced half.
--------------------------------------------------------------------------------

do
	local engine = newEngine()

	check("the server is asked for its maximum speed before its minimum",
		engine.commands[1]:match("^setmaxspeed %d+$") ~= nil and engine.commands[2]:match("^setminspeed %d+$") ~= nil,
		table.concat(engine.commands, " | "))
	local before = #engine.commands
	engine.unsynced:GameStart()
	check("and asked again once the game is running", #engine.commands == before + 2)

	check("a message that is not the logger's is left for another gadget",
		engine.unsynced:RecvFromSynced("somebody_else", "{}") == false and #engine.lines == 1)
end

do
	local engine = newEngine({ noFile = true })
	engine.create(12, 0, 1, 2, 3)

	check("a write directory that refuses the file removes the gadget and says why",
		engine.removed and #engine.lines == 0 and engine.logs[1]:find("could not open", 1, true) ~= nil)
end

--------------------------------------------------------------------------------
-- The engine's unit definitions.
--------------------------------------------------------------------------------

-- Four definitions as the engine's UnitDefs table hands them over: every field
-- present, zero where the definition said nothing.
local UNIT_DEFS = {
	{
		name = "tgcom", humanName = "Commander", metalCost = 2500, energyCost = 25000.5, speed = 37.5,
		isBuilder = true, buildOptions = { 2, 3 }, weapons = { {} },
		transportCapacity = 0, metalMake = 1.5, energyMake = 25, metalStorage = 500, energyStorage = 0,
		radarDistance = 700,
	},
	{
		name = "tgmex", humanName = "Metal Extractor", metalCost = 50, energyCost = 500, speed = 0,
		isBuilder = false, buildOptions = {}, weapons = {},
		extractsMetal = 0.0010000000474974513, energyUpkeep = 3,
	},
	{
		name = "tgwind", humanName = "", metalCost = 35, energyCost = 0, speed = 0,
		isBuilder = false, buildOptions = {}, weapons = {},
		windGenerator = 25, energyUpkeep = -0.00001,
	},
	{
		name = 'tg"odd', humanName = 'tg"odd', metalCost = 0, energyCost = 0, speed = 90,
		isBuilder = false, buildOptions = {}, weapons = { {}, {} }, transportCapacity = 8,
	},
}

do
	local engine = newEngine({ unitDefs = UNIT_DEFS })
	local lines = decoded(engine)
	local defs = ofKind(engine, "unit_def")

	check("every unit definition is one unit_def line", #defs == 4, tostring(#defs))
	check("the header says how many definitions follow", lines[1].unitDefs == 4)
	check("the definitions follow the header and nothing comes between",
		lines[1].kind == "header" and lines[2].kind == "unit_def" and lines[5].kind == "unit_def" and #lines == 5)
	check("the ids count up from 1 in the engine's order",
		defs[1].id == 1 and defs[2].id == 2 and defs[3].id == 3 and defs[4].id == 4)
	check("a definition carries its key, its name and both costs",
		defs[1].name == "tgcom" and defs[1].humanName == "Commander" and defs[1].metalCost == 2500
			and defs[1].energyCost == 25000.5)
	check("a unit that moves, builds, has a build menu and a weapon says so",
		defs[1].mobile == true and defs[1].builder == true and defs[1].builds == true and defs[1].armed == true)
	check("a building says none of them, and the flags are left out, not written as false",
		defs[2].mobile == nil and defs[2].builder == nil and defs[2].builds == nil and defs[2].armed == nil
			and not engine.raw:find(":false", 1, true))
	check("what a unit makes, stores and senses comes through under the engine's names",
		defs[1].metalMake == 1.5 and defs[1].energyMake == 25 and defs[1].metalStorage == 500
			and defs[1].radarDistance == 700 and defs[2].energyUpkeep == 3 and defs[3].windGenerator == 25
			and defs[4].transportCapacity == 8)
	check("a number that is zero is left out", defs[1].energyStorage == nil and defs[1].transportCapacity == nil)
	check("a cost of nothing is still written, because free is a price",
		defs[4].metalCost == 0 and defs[4].energyCost == 0)
	check("a 32 bit float is written to four places, without the noise",
		engine.lines[3]:find('"extractsMetal":0.001,', 1, true) ~= nil, engine.lines[3])
	check("a number too small to write is left out, never written as minus zero", defs[3].energyUpkeep == nil)
	check("an empty name, and one that repeats the key, are left out",
		defs[3].humanName == nil and defs[4].humanName == nil)
	check("a key with a quote in it survives", defs[4].name == 'tg"odd')
	check("every definition line is flushed like any other", engine.flushes == #engine.lines)

	local path = support.root() .. "/tests/fixtures/unit_defs.jsonl"
	if os.getenv("COILBOX_WRITE_FIXTURE") then
		local out = assert(io.open(path, "w"))
		out:write(engine.raw)
		out:close()
		print("wrote " .. path)
	end
	local fixture = io.open(path)
	local recorded = fixture and fixture:read("*a")
	if fixture then
		fixture:close()
	end
	check("the unit definition fixture is what these definitions write, byte for byte", recorded == engine.raw)
end

do
	local engine = newEngine()
	check("an engine with no unit definitions writes none", #ofKind(engine, "unit_def") == 0 and #engine.lines == 1)
end

--------------------------------------------------------------------------------
-- A start unit a game swaps for another.
--------------------------------------------------------------------------------

local KILLED_BY_SCRIPT = -21

-- Two teams, each with one start unit, 400 frames in.
local function twoStartUnits()
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	local mine = engine.create(12, 0, 100, 5, 200)
	local theirs = engine.create(31, 1, 3900, 10, 1800)
	engine.runTo(400)
	return engine, mine, theirs
end

do
	-- The new unit first and the old one destroyed in the same call, which is
	-- what Metal Factions does.
	local engine, mine = twoStartUnits()
	engine.move(mine, 150.5, 5, 260.3)
	local upgraded = engine.create(13, 0, 150.5, 5, 260.3)
	engine.finish(upgraded)
	engine.destroy(mine, nil, KILLED_BY_SCRIPT)
	local replaced = ofKind(engine, "start_unit_replaced")

	check("a start unit a script swaps for a unit made in its place is one replaced line", #replaced == 1,
		tostring(#replaced))
	check("the line names the old unit, the new one, the team, the frame and the place",
		replaced[1].unit == mine and replaced[1].by == upgraded and replaced[1].team == 0
			and replaced[1].frame == 400 and replaced[1].x == 150.5 and replaced[1].z == 260.3)
	local lines = decoded(engine)
	check("the replaced line comes before the old unit's destroyed line",
		lines[#lines - 1].kind == "start_unit_replaced" and lines[#lines].kind == "unit_destroyed"
			and lines[#lines].unit == mine and lines[#lines].startUnit == true)

	engine.move(upgraded, 400, 5, 400)
	engine.runTo(420)
	local positions = ofKind(engine, "start_unit_position")
	check("the new unit's positions are written from then on",
		positions[#positions].unit == upgraded and positions[#positions].frame == 420
			and positions[#positions].team == 0)
	engine.destroy(upgraded, mine, 7)
	local destroyed = ofKind(engine, "unit_destroyed")
	check("and its later lines say it is a start unit", destroyed[#destroyed].startUnit == true)
end

do
	-- The old unit destroyed a frame after the new one is made, which is what
	-- Splinter Faction does. Both may have moved by then.
	local engine, mine = twoStartUnits()
	local upgraded = engine.create(13, 0, 100, 5, 200)
	engine.runTo(401)
	engine.move(mine, 101, 5, 200)
	engine.move(upgraded, 99, 5, 200)
	engine.destroy(mine, nil, KILLED_BY_SCRIPT)
	local replaced = ofKind(engine, "start_unit_replaced")

	check("an old unit destroyed on the next frame is still replaced",
		#replaced == 1 and replaced[1].unit == mine and replaced[1].by == upgraded and replaced[1].frame == 401)
end

do
	-- A game that destroys the old unit before it makes the new one.
	local engine, mine = twoStartUnits()
	engine.destroy(mine, nil, KILLED_BY_SCRIPT)
	local upgraded = engine.create(13, 0, 100, 5, 200)
	local replaced = ofKind(engine, "start_unit_replaced")
	local created = ofKind(engine, "unit_created")

	check("an old unit destroyed first is replaced by a unit made in its place on that frame",
		#replaced == 1 and replaced[1].unit == mine and replaced[1].by == upgraded)
	check("and the new unit's created line already says it is a start unit",
		created[#created].unit == upgraded and created[#created].startUnit == true)

	local second = engine.create(14, 0, 100, 5, 200)
	check("a second unit made in the same place replaces nothing",
		#ofKind(engine, "start_unit_replaced") == 1 and second ~= nil)
end

do
	local engine, mine = twoStartUnits()
	engine.destroy(mine, nil, KILLED_BY_SCRIPT)
	engine.runTo(401)
	engine.create(13, 0, 100, 5, 200)
	check("a unit made in a destroyed start unit's place a frame later replaces nothing",
		#ofKind(engine, "start_unit_replaced") == 0)
end

do
	-- Everything that looks like an upgrade and is not one.
	local function links(scene)
		local engine, mine, theirs = twoStartUnits()
		scene(engine, mine, theirs)
		return #ofKind(engine, "start_unit_replaced")
	end

	check("a start unit an attacker killed is not replaced, whatever was made in its place", links(function(e, mine, theirs)
		e.create(13, 0, 100, 5, 200)
		e.destroy(mine, theirs, 7)
	end) == 0)
	check("a start unit that died of something other than a script is not replaced", links(function(e, mine)
		e.create(13, 0, 100, 5, 200)
		e.destroy(mine)
	end) == 0)
	check("a script that names an attacker did not swap the unit", links(function(e, mine, theirs)
		e.create(13, 0, 100, 5, 200)
		e.destroy(mine, theirs, KILLED_BY_SCRIPT)
	end) == 0)
	check("a unit made a tenth of an elmo away is not in its place", links(function(e, mine)
		e.create(13, 0, 100.1, 5, 200)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("a unit made in its place for another team is not its successor", links(function(e, mine)
		e.create(13, 1, 100, 5, 200)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("a unit something built in its place is not its successor", links(function(e, mine)
		e.create(13, 0, 100, 5, 200, mine)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("a unit made in its place two frames before it was destroyed is not its successor", links(function(e, mine)
		e.create(13, 0, 100, 5, 200)
		e.runTo(402)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("with two units that could each be the successor, neither is", links(function(e, mine)
		e.create(13, 0, 100, 5, 200)
		e.create(14, 0, 100, 5, 200)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("a successor that died before the old unit is not one", links(function(e, mine, theirs)
		local upgraded = e.create(13, 0, 100, 5, 200)
		e.destroy(upgraded, theirs, 7)
		e.destroy(mine, nil, KILLED_BY_SCRIPT)
	end) == 0)
	check("a unit that is not a start unit is never replaced", links(function(e, mine)
		local tank = e.create(40, 0, 500, 5, 500, mine)
		e.create(41, 0, 500, 5, 500)
		e.destroy(tank, nil, KILLED_BY_SCRIPT)
	end) == 0)
end

do
	-- An upgrade of an upgrade.
	local engine, mine = twoStartUnits()
	local second = engine.create(13, 0, 100, 5, 200)
	engine.destroy(mine, nil, KILLED_BY_SCRIPT)
	engine.runTo(900)
	local third = engine.create(14, 0, 100, 5, 200)
	engine.destroy(second, nil, KILLED_BY_SCRIPT)
	local replaced = ofKind(engine, "start_unit_replaced")

	check("a successor is replaced in its turn",
		#replaced == 2 and replaced[2].unit == second and replaced[2].by == third and replaced[2].frame == 900)
end

--------------------------------------------------------------------------------
-- Damage.
--------------------------------------------------------------------------------

-- The stub's map is 4096 by 2048, so the grid is 256 by 128 and a cell is 16
-- elmos a side.
local function cellAt(x, z)
	return math.floor(z / 16) * 256 + math.floor(x / 16)
end

local function damageMatch()
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2 })
	local a = engine.create(12, 0, 100, 5, 200)
	local b = engine.create(31, 1, 3900, 10, 1800)
	return engine, a, b
end

do
	local engine, a, b = damageMatch()
	engine.runTo(10)
	engine.damage(b, 10, a)
	engine.damage(b, 2.5, a)
	engine.runTo(20)
	engine.damage(a, 7, b)
	check("nothing is written while a stretch is still being added up", #ofKind(engine, "damage") == 0)

	engine.runTo(449)
	engine.damage(b, 1, a)
	engine.runTo(450)
	check("nor on the first frame of the next, until something is hit", #ofKind(engine, "damage") == 0)
	engine.damage(b, 4, a)
	local damage = ofKind(engine, "damage")

	check("a stretch is written once a hit lands in the next: one line for each pair of teams", #damage == 2,
		tostring(#damage))
	check("a line names the stretch's first frame, the attacker's team and the target's",
		damage[1].frame == 0 and damage[1].team == 0 and damage[1].target == 1
			and damage[2].team == 1 and damage[2].target == 0)
	check("hits on one cell are added up, where the unit hit stood",
		#damage[1].at == 2 and damage[1].at[1] == cellAt(3900, 1800) and damage[1].at[2] == 13.5,
		table.concat(damage[1].at, ","))
	check("and again where the attacker stood",
		#damage[1].origin == 2 and damage[1].origin[1] == cellAt(100, 200) and damage[1].origin[2] == 13.5)
	check("a whole number of damage is written whole", engine.lines[#engine.lines]:find('"at":[3078,7]', 1, true) ~= nil,
		engine.lines[#engine.lines])

	engine.frame = 451
	engine.synced:GameOver({ 0 })
	damage = ofKind(engine, "damage")
	local lines = decoded(engine)
	check("the stretch the game ended in is written before the game over line",
		#damage == 3 and damage[3].frame == 450 and damage[3].at[2] == 4
			and lines[#lines].kind == "game_over" and lines[#lines - 1].kind == "damage")
end

do
	local engine, a, b = damageMatch()
	engine.damage(b, 10, a)
	engine.move(b, 2000, 10, 1000)
	engine.move(a, 500, 5, 600)
	engine.damage(b, 20, a)
	engine.runTo(450)
	engine.synced:GameOver({})
	local line = ofKind(engine, "damage")[1]

	check("a unit hit in two places is in two cells, in the order it was hit",
		#line.at == 4 and line.at[1] == cellAt(3900, 1800) and line.at[2] == 10
			and line.at[3] == cellAt(2000, 1000) and line.at[4] == 20)
	check("and so is an attacker that moved",
		line.origin[1] == cellAt(100, 200) and line.origin[3] == cellAt(500, 600) and line.origin[4] == 20)
end

do
	local engine, a, b = damageMatch()
	-- Every unit in the stub has 100 health.
	engine.damage(b, 60, a)
	engine.damage(b, 5000, a)
	engine.runTo(450)
	engine.synced:GameOver({})
	local line = ofKind(engine, "damage")[1]

	check("a hit far larger than its target counts for what the target had left", line.at[2] == 100,
		tostring(line.at[2]))
end

do
	local engine, a, b = damageMatch()
	engine.damage(b, 30, a, true)
	engine.damage(b, -10, a)
	engine.damage(b, 0, a)
	engine.runTo(450)
	engine.synced:GameOver({})

	check("paralysis, healing and a hit that did nothing are not damage", #ofKind(engine, "damage") == 0)
end

do
	local engine, a, b = damageMatch()
	engine.damage(b, 12)
	engine.damage(a, 3, a)
	engine.move(b, -50, 10, 1800)
	engine.damage(b, 6, a)
	engine.runTo(450)
	engine.synced:GameOver({})
	local damage = ofKind(engine, "damage")

	check("damage with no attacker has no team and no origin",
		damage[1].team == nil and damage[1].origin == nil and damage[1].target == 1 and damage[1].at[2] == 12)
	check("a unit that hit itself is a line with its team on both sides",
		damage[2].team == 0 and damage[2].target == 0 and damage[2].at[2] == 3 and damage[2].origin[2] == 3)
	check("damage to a unit off the map is counted apart, and its attacker's place is still kept",
		damage[3].off == 6 and #damage[3].at == 0 and damage[3].origin[2] == 6)
	check("an empty list is still a list", engine.raw:find('"at":[],', 1, true) ~= nil)
	check("off is left out when nothing was off the map", damage[1].off == nil)
end

do
	local engine = newEngine({ teams = { 0, 1 }, gaiaTeam = 2, game = { mapSizeX = 2048, mapSizeZ = 6144 } })
	local header = ofKind(engine, "header")[1]
	local a = engine.create(12, 0, 2048, 5, 6144)
	engine.damage(a, 5)
	engine.runTo(450)
	engine.synced:GameOver({})
	local line = ofKind(engine, "damage")[1]

	check("a tall map has its 256 cells north to south", header.gridWidth == 85 and header.gridHeight == 256)
	check("a unit on the map's far edge is in the last cell", line.at[1] == 255 * 85 + 84, tostring(line.at[1]))
end

--------------------------------------------------------------------------------
-- The fixture files the Rust parser reads.
--------------------------------------------------------------------------------

-- A short match with an upgrade by replacement and some fighting in it, for
-- the readers of the two kinds that fixtureMatch has none of.
local function upgradeMatch()
	local engine = newEngine({ teams = { 0, 1, 2 }, gaiaTeam = 2, stats = STATS })
	engine.synced:GameStart()
	local commander0 = engine.create(12, 0, 100, 5, 200)
	engine.finish(commander0)
	local commander1 = engine.create(31, 1, 3900, 10, 1800)
	engine.finish(commander1)
	engine.move(commander0, 400, 5, 300)
	engine.runTo(120)

	-- Team 0 upgrades at frame 300, the new unit first.
	engine.runTo(300)
	local upgraded = engine.create(13, 0, 400, 5, 300)
	engine.finish(upgraded)
	engine.destroy(commander0, nil, KILLED_BY_SCRIPT)
	engine.move(upgraded, 900, 5, 700)
	engine.runTo(360)

	-- A fight across two stretches.
	engine.runTo(400)
	engine.damage(commander1, 20, upgraded)
	engine.damage(upgraded, 5.5, commander1)
	engine.runTo(500)
	engine.damage(commander1, 30, upgraded)
	engine.damage(commander1, 4)

	-- Team 1's start unit dies to an attacker with a unit made in its place,
	-- which is a death and no upgrade.
	engine.runTo(600)
	engine.create(50, 1, 3900, 10, 1800)
	engine.damage(commander1, 500, upgraded)
	engine.destroy(commander1, upgraded, 7)
	engine.runTo(601)
	engine.synced:GameOver({ 0 })
	return engine
end

do
	local engine = upgradeMatch()
	check("the upgrade match holds one replacement and four damage lines",
		#ofKind(engine, "start_unit_replaced") == 1 and #ofKind(engine, "damage") == 4,
		#ofKind(engine, "start_unit_replaced") .. " and " .. #ofKind(engine, "damage"))

	local path = support.root() .. "/tests/fixtures/upgrade.jsonl"
	if os.getenv("COILBOX_WRITE_FIXTURE") then
		local out = assert(io.open(path, "w"))
		out:write(engine.raw)
		out:close()
		print("wrote " .. path)
	end
	local fixture = io.open(path)
	local recorded = fixture and fixture:read("*a")
	if fixture then
		fixture:close()
	end
	check("the upgrade fixture is what the upgrade match writes, byte for byte", recorded == engine.raw)
end

do
	local engine = fixtureMatch()
	local path = support.root() .. "/tests/fixtures/match.jsonl"

	if os.getenv("COILBOX_WRITE_FIXTURE") then
		local out = assert(io.open(path, "w"))
		out:write(engine.raw)
		out:close()
		print("wrote " .. path)
	end

	local fixture = io.open(path)
	local recorded = fixture and fixture:read("*a")
	if fixture then
		fixture:close()
	end
	check("the fixture file is what the fixture match writes, byte for byte", recorded == engine.raw)
end

support.report()
