-- Proves the trigger engine wired into the gadget, driven by the scenario
-- fixtures coilbox itself compiles. Everything here reads a real
-- missions/<id>/mission.lua, so the shapes under test are the emitted ones, not
-- shapes invented to suit the runtime. Run it with:
--
--   luajit lua/mission-runtime/tests/mission_trigger_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged, sent = support.check, support.load, support.logged, support.sent
local missionFiles, fixture = support.missionFiles, support.fixture

--- Start a fixture mission and run up to the first frame the game is playing.
--
-- The def list starts with one that does nothing at all, because that is what
-- the runtime builds a spotter from and the fixtures' own defs all move and
-- shoot.
--
-- The rest of the list is the defs the fixtures restrict. The stub invents a def
-- the first time something spawns one, and a restriction is read at load, before
-- anything has, so a mission restricting a def nothing has spawned yet would
-- load as one that restricts nothing.
local function playing(id)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(fixture(id)), {
		startPositions = { [0] = { x = 500, z = 500 }, [1] = { x = 100, z = 100 } },
		defList = {
			{ name = "marker", speed = 0, weapons = {} },
			{ name = "armestor" }, { name = "armllt" }, { name = "corthud" },
		},
	})
	engine.env:Initialize()
	engine.env:GameStart()
	return engine, engine.GG.CoilboxMission
end

--------------------------------------------------------------------------------
-- Garrison: what a team owns, what it has built, and what it has lost.
--------------------------------------------------------------------------------

local engine, state = playing("garrison")

check("the trigger engine is published", state.triggers ~= nil)
check("a trigger the scenario disabled starts disabled", state.triggers:isEnabled("unlock") == false)
check("every other trigger starts armed", state.triggers:isEnabled("count-check") == true)

-- This mission denies a unit def and withholds no command, so it should have
-- gained one of the two callins and not the other.
check("a mission that restricts what may be built enforces that and nothing else",
	engine.env.AllowUnitCreation ~= nil and engine.env.AllowCommand == nil)

-- The def the mission's unlock trigger frees further down, so the deny and the
-- lift are read off the same id.
local storage = engine.env.UnitDefNames["armestor"].id
check("and the def it denies is one the player may not build",
	state.restrictions.allowsBuild(storage, 0) == false)

engine.env:GameFrame(0)
check("nothing fires while the start window is open", state.triggers:isEnabled("count-check") == true)
engine.env:GameFrame(1)

for _ = 1, 2 do
	engine.spawn("armpw", 1)
end
engine.env:GameFrame(15)
check("a unit count short of its minimum does not hold", state.triggers:isEnabled("count-check") == true)

engine.spawn("armpw", 1)
engine.env:GameFrame(30)
check("a unit count reaching its minimum fires", state.triggers:isEnabled("count-check") == false)
check("a fired trigger's enable_trigger arms another", state.triggers:isEnabled("unlock") == false,
	"unlock should have been armed and then spent")
-- The armed trigger's one action is the unlock_unit that lifts the deny above.
check("the trigger it armed ran in the same pass, and its unlock_unit lifted the deny",
	state.restrictions.allowsBuild(storage, 0) == true)
check("without reporting a reward the player already had",
	not logged(engine, "nothing restricts armestor for player, so unlock_unit does nothing"))
check("the var an earlier action set is what let it hold", state.vars.get("garrisonBuilt") == 1,
	tostring(state.vars.get("garrisonBuilt")))

-- The same var arms the wave, which is a repeating trigger with a cooldown, so
-- the dormant group the mission gifts later is on the map from here.
check("a repeating trigger the var armed spawned the dormant group",
	#state.groups.units("reinforcements") == 2, #state.groups.units("reinforcements"))
check("and woke it", state.groups.isAwake("reinforcements") == true)
check("a repeating trigger stays armed", state.triggers:isEnabled("reinforcement-wave") == true)

check("the mission's own units are not counted as built",
	state.triggers:isEnabled("built-outpost") == true)

local depot = engine.spawn("armestor", 1, 99)
engine.env:GameFrame(45)
check("a unit under construction has not been built yet",
	state.triggers:isEnabled("built-outpost") == true)

engine.finish(depot)
check("a finished unit fires the trigger watching for it",
	state.triggers:isEnabled("built-outpost") == false)
-- The fixture adds `{ var = "bonus" }` rather than a written number, so 1 plus
-- 5 is what says the runtime read the var it was pointed at (issue #808).
check("its add_var ran on the event, not on the next tick, and added what the bonus var holds",
	state.vars.get("garrisonBuilt") == 6, tostring(state.vars.get("garrisonBuilt")))
check("and its disable_trigger took effect", state.triggers:isEnabled("count-check") == false)

engine.give(state.units.outpost, 0)
check("an actor changing hands fires the trigger watching for it",
	state.triggers:isEnabled("outpost-captured") == false)

-- The capture's other action hands the wave's units to the garrison, and the
-- group keeps them, so the mission can go on ordering the squad it gave away.
-- Read here rather than after the loops below, because the mission releases the
-- group at eight seconds and the roll is empty from then on (issue #812).
--
-- This is the ask, not the outcome. The stub always agrees; a real game may
-- refuse a share between enemies, which is #857.
local gifted = {}
for index, unitID in ipairs(state.groups.units("reinforcements")) do
	gifted[index] = unitID
end
check("gifting a group asks for its units on the team the trigger named",
	#gifted == 2 and engine.units[gifted[1]].team == 1 and engine.units[gifted[2]].team == 1,
	#gifted .. "/" .. tostring(gifted[1] and engine.units[gifted[1]].team))

-- That trigger's own actions are a gift and a reveal, both proved below.
--
-- The mission reveals its supply depot to the player for thirty seconds. The
-- zone is a circle of 200 on (2000, 2000), so the spotter is one unit standing
-- there with sight enough to cover it.
local lit
for _, unitID in ipairs(engine.order) do
	if state.reveal.isSpotter(unitID) then
		lit = unitID
	end
end
check("the trigger's reveal_area lit the zone it named", lit ~= nil)
check("from the middle of it",
	lit and engine.units[lit].x == 2000 and engine.units[lit].z == 2000)
check("for the team the mission named", lit and engine.units[lit].team == 0,
	lit and engine.units[lit].team)
check("and the mission's own counting does not see the unit doing it",
	lit and state.reveal.spotterCount(0) == 1, lit and state.reveal.spotterCount(0))

-- The capture landed on frame 45, so the thirty seconds are up on frame 945.
for at = 46, 930 do
	engine.env:GameFrame(at)
end
check("and it stays lit for the thirty seconds the mission asked for",
	state.reveal.spotterCount(0) == 1, state.reveal.spotterCount(0))

for at = 931, 945 do
	engine.env:GameFrame(at)
end
check("after which the fog comes back", state.reveal.spotterCount(0) == 0,
	state.reveal.spotterCount(0))

-- The mission's release_group ran at eight seconds, long before this frame. The
-- units it gave away are still standing on the team it gave them to, and the
-- mission is holding none of them (issue #812).
check("release_group left the mission holding none of the group's units",
	#state.groups.units("reinforcements") == 0,
	#state.groups.units("reinforcements"))
check("while the units it gave away stand where they were, on the team it gave them to",
	engine.units[gifted[1]].alive == true and engine.units[gifted[1]].team == 1
	and engine.units[gifted[2]].alive == true and engine.units[gifted[2]].team == 1)

--------------------------------------------------------------------------------
-- Ambush: an actor's health and its death.
--------------------------------------------------------------------------------

engine, state = playing("ambush")

check("a mission that restricts nothing enforces nothing",
	engine.env.AllowUnitCreation == nil and engine.env.AllowCommand == nil)

local scout = state.units.scout

--- What the mission has staged for the player so far: every camera move and
-- every marker, in the order they went out, and the engine team each was aimed
-- at. Read off the messages the synced half sent, because that is the whole of
-- what those two actions do.
local function staged()
	local out = {}
	for _, entry in ipairs(engine.sent) do
		if entry[1] == "coilbox_mission_camera" then
			out[#out + 1] = "pan " .. entry[2] .. "/" .. entry[3]
				.. " over " .. entry[4] .. " for " .. entry[5]
		elseif entry[1] == "coilbox_mission_marker" then
			out[#out + 1] = "mark " .. entry[2] .. "/" .. entry[3]
				.. " " .. entry[4] .. " for " .. entry[5]
		end
	end
	return table.concat(out, ", ")
end

--- The dialogue lines this mission has said so far.
local function said()
	return table.concat(sent(engine, "coilbox_mission_dialogue"), ",")
end

engine.env:GameFrame(1)
engine.env:GameFrame(15)
check("a healthy actor trips nothing", said() == "" and staged() == "", said())

engine.env.Spring.SetUnitHealth(scout, 40)
check("health is not read between ticks", said() == "")
engine.env:GameFrame(30)
check("an actor below its stated health fires on the polled tick", said() == "warn", said())
check("the trigger watching it is spent", state.triggers:isEnabled("scout-wounded") == false)
check("the trigger watching its death is not", state.triggers:isEnabled("scout-down") == true)

engine.env.Spring.DestroyUnit(scout)
check("a dead actor fires on the death itself", state.triggers:isEnabled("scout-down") == false)
check("its dialogue ran", said() == "warn,warn", said())

--------------------------------------------------------------------------------
-- The ambush itself: a box zone the player has to walk into.
--
-- The mission's own units are already on the map, and the enemy scout stood
-- inside the pass from the first frame, so the zone is proved to be reading the
-- team the trigger names rather than whatever is nearest.
--------------------------------------------------------------------------------

local patrol = engine.spawn("armpw", 0)
engine.move(patrol, 800, 800)
engine.env:GameFrame(45)
check("the player's units outside the pass do not spring the ambush",
	state.triggers:isEnabled("spring-ambush") == true)
check("a dormant group is not on the map before it is spawned",
	#state.groups.units("raiders") == 0)

engine.move(patrol, 1900, 1900)
engine.env:GameFrame(60)
check("walking into the pass springs it", state.triggers:isEnabled("spring-ambush") == false)
-- The pan and the first marker name the player participant, which is engine
-- team 0, and the second marker names none, which is everyone (issue #827).
check("and the whole trigger ran, in the order the mission wrote it, each for the team it names",
	said() == "warn,warn,warn"
	and staged() == "pan 2000/2000 over 2 for 0, mark 2000/2000 Ambush! for 0, "
		.. "mark 1800/1800 They came. for -1"
	and table.concat(sent(engine, "coilbox_mission_sound"), ",") == "alarm.wav",
	said() .. " / " .. staged())

--------------------------------------------------------------------------------
-- The raiders: spawn_group, wake_group and give_orders as the mission wrote
-- them, against the real implementation.
--------------------------------------------------------------------------------

local raiders = state.groups.units("raiders")
check("spawn_group put the whole group on the map", #raiders == 4, tostring(#raiders))
check("its units are the def and team the scenario names",
	engine.units[raiders[1]].def == "armpw" and engine.units[raiders[1]].team == 1)
check("wake_group left it running its orders", state.groups.isAwake("raiders") == true)
check("so it is not holding position",
	engine.units[raiders[1]].movestate ~= engine.env.CMD.MOVESTATE_HOLDPOS)

-- The scout the group was told to attack died earlier in this test. A declared
-- actor that is dead is a target that is not there, not a name the mission got
-- wrong, so nothing is reported.
check("an order about an actor that has died is not reported as a bad name",
	not logged(engine, "to give an order about"))

--------------------------------------------------------------------------------
-- Siege: holding a zone for a minute.
--------------------------------------------------------------------------------

local siege
engine, siege = playing("siege")

--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(from, frame)
	for at = from, frame do
		engine.env:GameFrame(at)
	end
	return frame
end

--- The mission's objective and who has won, as text. Read off the real
-- objectives and the real Spring.GameOver call rather than off stand-ins,
-- because what a replay says is the whole point of ending a mission.
local function outcome()
	return tostring(siege.objectives.get("take-keep")) .. "/"
		.. (engine.gameOver[1] and table.concat(engine.gameOver[1], ",") or "playing")
end

local at = playTo(1, 60)
check("the defenders sitting in their own keep do not complete the player's objective",
	outcome() == "active/playing", outcome())

local squad = engine.spawn("armpw", 0)
engine.move(squad, 2100, 2100)
at = playTo(at + 1, 1800)
check("taking the keep does not complete a hold on its own", outcome() == "active/playing", outcome())

engine.move(squad, 900, 900)
at = playTo(at + 1, 1830)
check("and leaving before the minute is up loses the hold", outcome() == "active/playing", outcome())

engine.move(squad, 2100, 2100)
at = playTo(at + 1, 3600)
check("so the minute has to be served from the return", outcome() == "active/playing", outcome())

playTo(at + 1, 3660)
check("a minute held end to end completes the objective and wins the mission for the player",
	outcome() == "complete/0", outcome())
check("which is one Spring.GameOver call and no more", #engine.gameOver == 1, #engine.gameOver)

--------------------------------------------------------------------------------
-- The same mission lost: the clock runs out with the player never in the keep.
--------------------------------------------------------------------------------

engine, siege = playing("siege")

at = playTo(1, 17999)
check("the mission is still running a frame before its deadline",
	outcome() == "active/playing", outcome())

playTo(at + 1, 18010)
check("the deadline fails the objective and hands the win to everyone else",
	outcome() == "failed/1", outcome())

--------------------------------------------------------------------------------
-- Triggers are synced only.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(fixture("ambush")), { synced = false })
unsynced.env:Initialize()
check("the unsynced half runs no triggers", unsynced.GG.CoilboxMission.triggers == nil)

support.report()
