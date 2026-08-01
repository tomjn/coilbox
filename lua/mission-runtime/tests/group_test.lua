-- Proves groups, dormancy, orders and prefab bases: what is on the map at the
-- start and what is not, what a sleeping group does, what each kind of order
-- becomes, and what a prefab factory is left building. The gadget is loaded
-- under the stub engine rather than the modules on their own, because a group is
-- units on a map and only the gadget puts them there. Run it with:
--
--   luajit lua/mission-runtime/tests/group_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

--- A fire-once trigger that runs `actions` once `seconds` have passed. Times
-- rather than conditions, because this file is about what the actions do and a
-- clock is the shortest way to say when each one runs.
local function at(seconds, actions)
	return {
		id = "t" .. seconds,
		enabled = true,
		["repeat"] = false,
		conditions = {
			op = "all",
			conditions = { { type = "time_elapsed", params = { seconds = seconds } } },
		},
		actions = actions,
	}
end

local MISSION = compiled({
	teams = {
		player = { team = 0 },
		enemy = { team = 1 },
	},
	actors = {
		{ id = "boss", unitDef = "corcom", team = "enemy", pos = { x = 0, z = 0 }, facing = 0 },
	},
	groups = {
		{
			id = "standing",
			team = "enemy",
			pos = { x = 100, z = 100 },
			units = { { def = "armpw", count = 2 }, { def = "armrock", count = 1 } },
			orders = {
				{ kind = "move", waypoints = { { x = 300, z = 300 } } },
				{ kind = "patrol", waypoints = { { x = 400, z = 400 }, { x = 500, z = 500 } } },
			},
			dormant = false,
		},
		{
			id = "wave",
			team = "enemy",
			pos = { x = 700, z = 700 },
			units = { { def = "armpw", count = 2 } },
			orders = { { kind = "guard", target = "boss" } },
			dormant = true,
		},
		{
			id = "hunters",
			team = "enemy",
			pos = { x = 900, z = 900 },
			units = { { def = "armpw", count = 1 } },
			orders = { { kind = "attack", target = "standing" } },
			dormant = true,
		},
		{
			id = "escort",
			team = "enemy",
			pos = { x = 1100, z = 1100 },
			units = { { def = "armpw", count = 1 } },
			orders = { { kind = "guard", target = "standing" } },
			dormant = true,
		},
		{
			id = "reserve",
			team = "enemy",
			pos = { x = 1300, z = 1300 },
			units = { { def = "armpw", count = 1 } },
			orders = {},
			dormant = true,
		},
		{
			id = "lost",
			team = "nobody",
			pos = { x = 0, z = 0 },
			units = { { def = "armpw", count = 1 } },
			orders = {},
			dormant = false,
		},
	},
	prefabs = {
		{
			id = "base",
			team = "enemy",
			origin = { x = 200, z = 200 },
			buildings = {
				{
					def = "armlab",
					offset = { x = 0, z = 0 },
					facing = 1,
					queue = { "armpw", "notaunit", "armrock" },
					["repeat"] = true,
				},
				{ def = "armsolar", offset = { x = 64, z = 0 }, facing = 0 },
			},
		},
	},
	triggers = {
		at(1, { { type = "spawn_group", params = { group = "wave" } } }),
		at(2, { { type = "wake_group", params = { group = "wave" } } }),
		at(3, {
			{
				type = "give_orders",
				params = {
					group = "standing",
					orders = { { kind = "fight", waypoints = { { x = 600, z = 600 } } } },
				},
			},
		}),
		at(4, { { type = "gift_units", params = { group = "wave", team = "player" } } }),
		at(5, { { type = "wake_group", params = { group = "hunters" } } }),
		at(6, {
			{ type = "spawn_group", params = { group = "phantom" } },
			{
				type = "give_orders",
				params = { group = "standing", orders = { { kind = "dance" } } },
			},
		}),
		at(7, { { type = "wake_group", params = { group = "escort" } } }),
		at(8, { { type = "spawn_group", params = { group = "reserve" } } }),
		at(9, {
			{
				type = "give_orders",
				params = {
					group = "reserve",
					orders = { { kind = "move", waypoints = { { x = 50, z = 50 } } } },
				},
			},
		}),
	},
})

local engine

-- Balanced Annihilation's own `AllowUnitTransfer`, which is what the runtime met
-- in a real engine: a share between teams that are not allied is refused, and a
-- capture is not. Every team here is an ally team of its own, so the gift the
-- mission makes at four seconds crosses ally lines.
local function noShareToEnemy(unitID, newTeam, given)
	return not given or engine.units[unitID].team == newTeam
end

engine = load({ coilbox_mission = "demo" }, missionFiles(MISSION), {
	buildings = { armlab = true, armsolar = true },
	-- Named up front, because a prefab factory's queue is read before anything
	-- has spawned one of what it names. The real engine has every def loaded
	-- before a gadget runs.
	defs = { armpw = true, armrock = true, corcom = true, armlab = true, armsolar = true },
	allowTransfer = noShareToEnemy,
})
engine.env:Initialize()
engine.env:GameStart()

local state = engine.GG.CoilboxMission
local CMD = engine.env.CMD

local frame = 0
--- Run the game on to `frame`, ticking every frame the way the engine does.
local function playTo(to)
	while frame < to do
		frame = frame + 1
		engine.env:GameFrame(frame)
	end
end

--- One order as "cmd/opts/first param", which is the whole of what a command is
-- once the unit ids and ground heights are out of the way.
local function shape(order)
	return string.format("%d/%d/%s", order[2], order[4], tostring((order[3] or {})[1]))
end

local function shapes(unitID)
	local out = {}
	for _, order in ipairs(engine.ordersFor(unitID)) do
		out[#out + 1] = shape(order)
	end
	return table.concat(out, " ")
end

--------------------------------------------------------------------------------
-- The start: a standing group is there and running, a dormant one is not there
-- at all.
--------------------------------------------------------------------------------

local standing = state.groups.units("standing")
check("a group that is not dormant is on the map at the start", #standing == 3, tostring(#standing))
check("its units are the defs the scenario counted, in the order it listed them",
	engine.units[standing[1]].def == "armpw"
	and engine.units[standing[2]].def == "armpw"
	and engine.units[standing[3]].def == "armrock")
check("on the group's own team", engine.units[standing[1]].team == 1)
check("in a grid on the group's position",
	engine.units[standing[1]].x == 68 and engine.units[standing[1]].z == 68,
	tostring(engine.units[standing[1]].x) .. "," .. tostring(engine.units[standing[1]].z))
check("and running its orders", state.groups.isAwake("standing") == true)

check("a dormant group is not on the map at the start", #state.groups.units("wave") == 0)
check("a group whose team the mission has no engine team for is reported",
	logged(engine, "group lost belongs to team nobody"))

--------------------------------------------------------------------------------
-- Orders. A move is one command per waypoint, a patrol is one per waypoint too,
-- and everything after the first order queues behind it rather than replacing it.
--------------------------------------------------------------------------------

check("a move and a patrol are one command per waypoint, queued after the first",
	shapes(standing[1]) == string.format("%d/0/300 %d/32/400 %d/32/500", CMD.MOVE, CMD.PATROL, CMD.PATROL),
	shapes(standing[1]))
check("every unit in the group is given the same queue",
	shapes(standing[3]) == shapes(standing[1]))

--------------------------------------------------------------------------------
-- Dormancy: spawn_group puts a group there asleep, wake_group releases it.
--------------------------------------------------------------------------------

playTo(45)
local wave = state.groups.units("wave")
check("spawn_group puts a dormant group on the map", #wave == 2, tostring(#wave))
check("asleep, holding where it stands",
	engine.units[wave[1]].movestate == CMD.MOVESTATE_HOLDPOS)
check("and not running its orders", state.groups.isAwake("wave") == false)
check("so it has been given nothing but the hold",
	shapes(wave[1]) == string.format("%d/0/0", CMD.MOVE_STATE), shapes(wave[1]))

playTo(75)
check("wake_group gives the group back the move state it came with",
	engine.units[wave[1]].movestate == CMD.MOVESTATE_MANEUVER)
check("and it is running its orders now", state.groups.isAwake("wave") == true)
check("a guard order is one command naming the actor's unit",
	shapes(wave[1]) == string.format("%d/0/0 %d/0/%d %d/0/%d",
		CMD.MOVE_STATE, CMD.MOVE_STATE, CMD.MOVESTATE_MANEUVER, CMD.GUARD, state.units.boss),
	shapes(wave[1]))

--------------------------------------------------------------------------------
-- give_orders replaces what a group was doing.
--------------------------------------------------------------------------------

playTo(105)
check("give_orders is one command per waypoint, replacing the queue",
	shapes(standing[1]) == string.format("%d/0/300 %d/32/400 %d/32/500 %d/0/600",
		CMD.MOVE, CMD.PATROL, CMD.PATROL, CMD.FIGHT),
	shapes(standing[1]))

--------------------------------------------------------------------------------
-- gift_units hands a group over, and the group stays the mission's to order.
--------------------------------------------------------------------------------

playTo(135)
check("gift_units moves every unit in the group to the other team",
	engine.units[wave[1]].team == 0 and engine.units[wave[2]].team == 0)
check("across ally lines, which is what a game refuses a share between",
	not logged(engine, "refused to hand"))
check("and the group still holds them", #state.groups.units("wave") == 2)

-- A game may refuse a capture too, and then there is nothing the runtime can do
-- but say so. Silence here is the whole of what an author would see.
local refusing = load({ coilbox_mission = "demo" }, missionFiles(MISSION), {
	buildings = { armlab = true, armsolar = true },
	defs = { armpw = true, armrock = true, corcom = true, armlab = true, armsolar = true },
	allowTransfer = function()
		return false
	end,
})
refusing.env:Initialize()
refusing.env:GameStart()
for tick = 1, 135 do
	refusing.env:GameFrame(tick)
end
local refused = refusing.GG.CoilboxMission.groups.units("wave")
check("a game that refuses the transfer leaves the units where they were",
	refusing.units[refused[1]].team == 1 and refusing.units[refused[2]].team == 1,
	tostring(refusing.units[refused[1]].team))
check("and the refusal is reported rather than swallowed",
	logged(refusing, "the game refused to hand 2 of group wave's 2 units to team player"))

--------------------------------------------------------------------------------
-- An attack on a group is one command per unit in it, which is what
-- shift-attacking a squad gives a player.
--------------------------------------------------------------------------------

playTo(165)
local hunters = state.groups.units("hunters")
check("waking a group that was never spawned spawns it first", #hunters == 1, tostring(#hunters))
check("an attack on a group is one command per unit in it",
	shapes(hunters[1]) == string.format("%d/0/%d %d/32/%d %d/32/%d",
		CMD.ATTACK, standing[1], CMD.ATTACK, standing[2], CMD.ATTACK, standing[3]),
	shapes(hunters[1]))

--------------------------------------------------------------------------------
-- Names and kinds the mission got wrong.
--------------------------------------------------------------------------------

playTo(195)
check("an action naming a group the mission does not have is reported",
	logged(engine, "no group named phantom"))
check("an order kind this runtime has no meaning for is reported",
	logged(engine, "no implementation for order dance"))

--------------------------------------------------------------------------------
-- Guarding a group is one command and no more, because guarding never finishes
-- and a second queued guard would never come up.
--------------------------------------------------------------------------------

playTo(225)
local escort = state.groups.units("escort")
-- Woken without being spawned first, so it was never asleep and there is no move
-- state to hand back: the guard is the whole of what it was given.
check("a guard order on a group is one command, naming one of its units",
	shapes(escort[1]) == string.format("%d/0/%d", CMD.GUARD, standing[1]),
	shapes(escort[1]))

--------------------------------------------------------------------------------
-- give_orders wakes the group it orders, because a group told to move that
-- stands there holding position is a mission that looks broken and says nothing.
--------------------------------------------------------------------------------

playTo(255)
local reserve = state.groups.units("reserve")
check("a group spawned on its own is asleep",
	engine.units[reserve[1]].movestate == CMD.MOVESTATE_HOLDPOS
	and state.groups.isAwake("reserve") == false)

playTo(285)
check("give_orders wakes it", state.groups.isAwake("reserve") == true)
check("and gives it back the move state it came with",
	engine.units[reserve[1]].movestate == CMD.MOVESTATE_MANEUVER)
check("before the orders themselves",
	shapes(reserve[1]) == string.format("%d/0/0 %d/0/%d %d/0/50",
		CMD.MOVE_STATE, CMD.MOVE_STATE, CMD.MOVESTATE_MANEUVER, CMD.MOVE),
	shapes(reserve[1]))

--------------------------------------------------------------------------------
-- A group that is wiped can be sent again; one that is still standing is not
-- doubled.
--------------------------------------------------------------------------------

state.groups.spawn("hunters")
check("spawning a group that is still standing does not double it",
	#state.groups.units("hunters") == 1, tostring(#state.groups.units("hunters")))

engine.env.Spring.DestroyUnit(hunters[1])
check("a dead unit leaves its group's roll", #state.groups.units("hunters") == 0)

state.groups.spawn("hunters")
check("and a group that has been wiped spawns again",
	#state.groups.units("hunters") == 1, tostring(#state.groups.units("hunters")))

--------------------------------------------------------------------------------
-- Prefab bases.
--------------------------------------------------------------------------------

local lab, solar
for unitID, unit in pairs(engine.units) do
	if unit.def == "armlab" then
		lab = unitID
	elseif unit.def == "armsolar" then
		solar = unitID
	end
end

check("a prefab's buildings are on the map", lab ~= nil and solar ~= nil)
check("at the origin plus their own offset, snapped to the build grid",
	engine.units[lab].x == 192 and engine.units[solar].x == 256,
	tostring(engine.units[lab].x) .. "," .. tostring(engine.units[solar].x))
check("facing the way the building says", engine.units[lab].facing == 1)
check("a mobile unit is not put through the build grid",
	#engine.snapped == 2, tostring(#engine.snapped))

local armpw = engine.env.UnitDefNames.armpw.id
local armrock = engine.env.UnitDefNames.armrock.id
check("a factory queue is one build order per entry, with no options at all",
	shapes(lab) == string.format("%d/0/nil %d/0/nil %d/0/1", -armpw, -armrock, CMD.REPEAT),
	shapes(lab))
check("a queue naming a def this game does not have skips it and says so",
	logged(engine, "queue names notaunit"))
check("a building with no queue is left alone", shapes(solar) == "", shapes(solar))

--------------------------------------------------------------------------------
-- Groups are synced only.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(MISSION), { synced = false })
unsynced.env:Initialize()
check("the unsynced half runs no groups", unsynced.GG.CoilboxMission.groups == nil)

support.report()
