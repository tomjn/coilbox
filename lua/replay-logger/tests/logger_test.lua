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
-- The fixture file the Rust parser reads.
--------------------------------------------------------------------------------

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
