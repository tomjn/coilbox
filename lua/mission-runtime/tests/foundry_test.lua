-- Proves the five actions and the one format feature runtime 7 added
-- (issue #2422), driven by the `foundry` scenario fixture so the shapes under
-- test are the ones coilbox actually emits. Run it with:
--
--   luajit lua/mission-runtime/tests/foundry_test.lua
--
-- What is covered here:
--
--   give_resources   a gift, and a drain that takes what is there
--   set_income       what a team is paid from now on, including a bleed
--   give_storage     how much a team can hold
--   build_unit       an order at a site, and one queued into a factory
--   call_lua         a function the game has, and a name it does not
--   negate           a bonus objective for finishing without building something
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, fixture = support.missionFiles, support.fixture

--- The mission loaded and running, with the game's own function in place for
-- `call_lua` to find.
--
-- `applause` is what that function records, so a test can say the runtime found
-- it, called it, and handed it the trigger's own params.
local applause = {}

local function playing()
	local engine = load({ coilbox_mission = "demo" }, missionFiles(fixture("foundry")), {
		startPositions = { [0] = { x = 500, z = 500 }, [1] = { x = 100, z = 100 } },
		defList = {
			{ name = "marker", speed = 0, weapons = {} },
			{ name = "armck" }, { name = "armlab" }, { name = "armsolar" },
			{ name = "armpw" }, { name = "armfus" },
		},
	})
	-- What a game ships, reached by the dotted name the fixture's trigger writes.
	-- Set before Initialize, because that is when a real game's own gadget would
	-- have put it there.
	engine.env.GG.TestGame = {
		Applaud = function(params)
			applause[#applause + 1] = tostring(params.func)
		end,
	}
	engine.env:Initialize()
	engine.env:GameStart()
	return engine, engine.GG.CoilboxMission
end

--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(engine, from, frame)
	for at = from, frame do
		engine.env:GameFrame(at)
	end
	return frame
end

--- Every build order given to a unit, as the def id each one names. A build
-- order is the negative of a def id, so anything else in the list is another
-- kind of command.
local function builds(engine, unitID)
	local out = {}
	for _, order in ipairs(engine.orders) do
		if order[1] == unitID and order[2] < 0 then
			out[#out + 1] = { def = -order[2], params = order[3] }
		end
	end
	return out
end

local engine, state = playing()

--------------------------------------------------------------------------------
-- The bank the scenario itself asked for, before any trigger has run.
--------------------------------------------------------------------------------

engine.env:GameFrame(1)
check("the scenario's own bank is what the team starts with",
	engine.resources[0].m == 200 and engine.resources[0].e == 200,
	tostring(engine.resources[0].m) .. "/" .. tostring(engine.resources[0].e))
check("and its stated income is paid from the first frame, spread over the second",
	engine.income[0].m == 3 / 30, tostring(engine.income[0] and engine.income[0].m))

--------------------------------------------------------------------------------
-- give_resources, give_storage and set_income, ten seconds in.
--------------------------------------------------------------------------------

local at = playTo(engine, 2, 299)
check("nothing has happened a frame before the trigger's ten seconds",
	state.triggers:isEnabled("grant-arrives") == true)

-- Exactly the frame it fires on, and no further. The income it sets is paid
-- from the next frame, so a check taken later is reading the drain as well as
-- the gift.
at = playTo(engine, at + 1, 300)
check("the trigger fired", state.triggers:isEnabled("grant-arrives") == false)

-- The fixture gifts `{ var = "grant" }`, which is 500, rather than a written
-- number, so this is also the amount plumbing reaching an economy action.
check("give_resources handed over what the var it named holds",
	engine.income[0].m >= 500, tostring(engine.income[0].m))
-- And drains 50 energy off a bank the scenario set to 200. A drain cannot go
-- through AddTeamResource, which clamps at zero, so it is the bank read back and
-- written down.
check("and drained the energy, which the bank shows and the gift ledger does not",
	engine.resources[0].e == 150, tostring(engine.resources[0].e))

check("give_storage moved how much the team can hold",
	engine.resources[0].ms == 1000 and engine.resources[0].es == 1000,
	tostring(engine.resources[0].ms) .. "/" .. tostring(engine.resources[0].es))
check("which the runtime publishes for a game's own code to reach",
	state.economy ~= nil)

--------------------------------------------------------------------------------
-- The income the trigger set, which has to be what is actually paid.
--------------------------------------------------------------------------------

check("set_income replaced what the team is paid, rather than a second copy of it",
	state.economy.income("player").metal == 10 and state.economy.income("player").energy == -5,
	tostring(state.economy.income("player").metal))

local metalBefore = engine.income[0].m
local energyBefore = engine.resources[0].e
at = playTo(engine, at + 1, at + 30)
check("so a second of it pays the new metal rate, not the scenario's",
	math.abs((engine.income[0].m - metalBefore) - 10) < 0.001,
	tostring(engine.income[0].m - metalBefore))
check("and a negative rate bleeds the bank instead of paying nothing",
	math.abs((energyBefore - engine.resources[0].e) - 5) < 0.001,
	tostring(energyBefore - engine.resources[0].e))

--------------------------------------------------------------------------------
-- build_unit: a site on the map, and a factory queue.
--------------------------------------------------------------------------------

local solar = engine.env.UnitDefNames["armsolar"].id
local raider = engine.env.UnitDefNames["armpw"].id

local sited = builds(engine, state.units.engineer)
check("build_unit gave the builder one order per unit it asked for",
	#sited == 2, #sited)
check("each of them a build order for the def the trigger named",
	sited[1] and sited[1].def == solar and sited[2].def == solar)
check("at a site the engine's own build grid decided, not the raw point",
	sited[1] and #sited[1].params == 4 and sited[1].params[1] == 1200 - 1200 % 16,
	sited[1] and tostring(sited[1].params[1]))

local queued = builds(engine, state.units.works)
check("build_unit with no position queues the unit in the factory instead",
	#queued == 1 and queued[1].def == raider, #queued)
check("with no parameters on it at all, which is what appends one unit",
	queued[1] and #queued[1].params == 0, queued[1] and #queued[1].params)

--------------------------------------------------------------------------------
-- A negated condition: the bonus for getting to two minutes without building a
-- fusion plant.
--------------------------------------------------------------------------------

at = playTo(engine, at + 1, 3585)
check("the bonus objective is still open a frame before its two minutes",
	state.objectives.get("purist") == "active", state.objectives.get("purist"))

at = playTo(engine, at + 1, 3615)
check("with nothing built, the negated condition holds and the bonus is earned",
	state.objectives.get("purist") == "complete", state.objectives.get("purist"))
check("and its call_lua found the game's own function and called it",
	#applause == 1 and applause[1] == "GG.TestGame.Applaud",
	#applause .. "/" .. tostring(applause[1]))

--------------------------------------------------------------------------------
-- The same mission, with the shortcut taken. The negated condition must not
-- hold, so the bonus is never earned.
--------------------------------------------------------------------------------

applause = {}
engine, state = playing()
at = playTo(engine, 1, 60)

local shortcut = engine.spawn("armfus", 0)
engine.finish(shortcut)

playTo(engine, at + 1, 3700)
check("building the thing the bonus was about leaves the negated condition false",
	state.objectives.get("purist") == "active", state.objectives.get("purist"))
check("so the bonus trigger is still armed and never ran",
	state.triggers:isEnabled("purist-run") == true and #applause == 0,
	#applause)

--------------------------------------------------------------------------------
-- A call_lua naming something this game has not got.
--------------------------------------------------------------------------------

engine, state = playing()
engine.env:GameFrame(1)
state.call.call("GG.NoSuchGame.Fire", {}, {})
check("a name this game has no function for is reported rather than fatal",
	logged(engine, "call_lua names GG.NoSuchGame.Fire, which this game has no function for"))

state.call.call("", {}, {})
check("and so is a call_lua with no name at all",
	logged(engine, "call_lua names no function"))

support.report()
