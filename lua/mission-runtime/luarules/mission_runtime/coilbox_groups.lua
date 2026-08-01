-- Coilbox mission runtime: groups, dormancy and orders.
--
-- A group is a block of units spawned and ordered together under one id: a
-- raiding party, a reinforcement wave, a garrison. The scenario says what is in
-- it, where it lands, what it does and whether it is there from the start.
--
-- Two states, and both actions earn their keep:
--
-- - On the map or not. A group that is not `dormant` is placed at game start. A
--   dormant one waits for `spawn_group`.
-- - Awake or asleep. Asleep is a group that is standing there holding position:
--   its units exist, defend themselves and do not wander. Awake is a group
--   running its orders. `wake_group` is the release.
--
-- So a dormant garrison is `spawn_group` now and `wake_group` when the mission
-- says go, and a reinforcement wave is `wake_group` on its own, which spawns it
-- and sends it off in one action.
--
-- This module calls the engine, to create, order and hand over units. The
-- layout of a spawned block is coilbox_start.lua's, and the creation itself is
-- the gadget's, so the suppression window and the ground read stay in one place.

local M = {}

-- Queue this command behind the ones already given, rather than replacing them.
-- Every order after a group's first carries it, which is what a player holding
-- shift through a path gets.
local QUEUED = CMD.OPT_SHIFT

-- The orders that are a list of places to go, and the command each becomes.
--
-- `patrol` is the engine's own: giving the first patrol point to a unit with an
-- empty queue makes the engine close the loop back to where the unit is
-- standing, so a group patrols between its spawn and the points the author drew,
-- exactly as it would if a player had shift-clicked them.
local WAYPOINT_COMMAND = {
	move = CMD.MOVE,
	patrol = CMD.PATROL,
	fight = CMD.FIGHT,
}

-- The move state the engine gives a unit whose def does not ask for one. Used
-- only when a unit's state cannot be read back, so waking still hands something
-- sane rather than pinning the unit down for the rest of the mission.
local DEFAULT_MOVE_STATE = CMD.MOVESTATE_MANEUVER

--- Register the group actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `spawn(group, team)` puts a group's units on the map and returns
--   their unit ids. The gadget owns it because creating a unit has to happen
--   inside the runtime's own start suppression.
-- @return the groups themselves, so a game's own actions drive them the way
--   these do rather than around them
function M.register(engine, state, hooks)
	-- Group id -> the scenario's group.
	local groups = {}
	-- Group id -> its units that are alive, in the order they were spawned.
	local members = {}
	-- unitID -> the group it belongs to.
	local groupOf = {}
	-- unitID -> the move state it had before it was put to sleep. Kept rather
	-- than assumed, because it is the game's own default for that unit type and
	-- waking has to give it back rather than guess at it.
	local resting = {}
	-- Group id -> true while it is running its orders.
	local awake = {}

	-- Trigger params name a participant, not an engine team, and the mapping is
	-- fixed once the mission has started.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	for _, group in ipairs((state.mission or {}).groups or {}) do
		groups[group.id] = group
		members[group.id] = {}
	end

	--- The group a params table names, or nil once it has said so.
	local function groupOfName(name)
		local group = groups[name]
		if not group then
			engine:report("group:" .. tostring(name), "warning",
				"no group named " .. tostring(name) .. ", ignoring it")
		end
		return group
	end

	--- The units an order's target names: an actor's unit, or a group's living
	-- units. One name space, because the editor offers the author one list.
	--
	-- A declared actor that has died, or a group that has been wiped, is a target
	-- that is simply not there any more. Only a name the mission never declared
	-- is worth reporting.
	local function targetsOf(name)
		local unitID = state.units[name]
		if unitID then
			return { unitID }
		end
		if members[name] then
			return members[name]
		end
		if state.actors[name] then
			return {}
		end
		engine:report("order-target:" .. tostring(name), "warning",
			"no actor or group named " .. tostring(name) .. " to give an order about")
		return {}
	end

	--- Add the commands one order becomes to `out`. False when the runtime has no
	-- meaning for the order's kind.
	--
	-- `guard` is one command and no more: guarding never finishes, so a second
	-- queued guard would never come up. `attack` is one command per target unit,
	-- which is what shift-attacking a squad gives a player and what lets a group
	-- work through the units it was pointed at.
	local function commandsFor(order, out)
		local waypoint = WAYPOINT_COMMAND[order.kind]
		if waypoint then
			for _, point in ipairs(order.waypoints or {}) do
				out[#out + 1] = {
					cmd = waypoint,
					-- A scenario carries no height, so the ground is read here.
					params = { point.x, Spring.GetGroundHeight(point.x, point.z), point.z },
				}
			end
			return true
		end

		if order.kind == "guard" then
			local targets = targetsOf(order.target)
			if targets[1] then
				out[#out + 1] = { cmd = CMD.GUARD, params = { targets[1] } }
			end
			return true
		end

		if order.kind == "attack" then
			for _, unitID in ipairs(targetsOf(order.target)) do
				out[#out + 1] = { cmd = CMD.ATTACK, params = { unitID } }
			end
			return true
		end

		return false
	end

	--- Give a group's units their orders.
	--
	-- Every unit gets the same queue. The first command replaces whatever the unit
	-- was doing and the rest queue behind it, so an order list is one path rather
	-- than a series of instructions each cancelling the last.
	local function issue(id, orders)
		local commands = {}
		for _, order in ipairs(orders or {}) do
			if not commandsFor(order, commands) then
				engine:report("order-kind:" .. tostring(order.kind), "warning",
					"no implementation for order " .. tostring(order.kind) .. ", ignoring it")
			end
		end

		for _, unitID in ipairs(members[id]) do
			for index, command in ipairs(commands) do
				Spring.GiveOrderToUnit(unitID, command.cmd, command.params, index > 1 and QUEUED or 0)
			end
		end
	end

	--- Hold a group where it stands.
	local function sleep(id)
		for _, unitID in ipairs(members[id]) do
			if resting[unitID] == nil then
				local states = Spring.GetUnitStates(unitID)
				resting[unitID] = (states and states.movestate) or DEFAULT_MOVE_STATE
			end
			Spring.GiveOrderToUnit(unitID, CMD.MOVE_STATE, { CMD.MOVESTATE_HOLDPOS }, 0)
		end
	end

	--- Give a group back the move state each of its units came with.
	local function rouse(id)
		for _, unitID in ipairs(members[id]) do
			local was = resting[unitID]
			if was ~= nil then
				Spring.GiveOrderToUnit(unitID, CMD.MOVE_STATE, { was }, 0)
				resting[unitID] = nil
			end
		end
	end

	--- Put a group's units on the map, unless it already has some standing.
	--
	-- A group whose units are all dead spawns again, so a repeating trigger is how
	-- a mission sends wave after wave. A group that is still standing is left
	-- alone, so a trigger that fires twice does not double it.
	local function place(group)
		if #members[group.id] > 0 then
			return
		end

		local team = engineTeam[group.team]
		if not team then
			engine:report("group-team:" .. tostring(group.id), "warning", string.format(
				"group %s belongs to team %s, which the mission has no engine team for",
				tostring(group.id), tostring(group.team)))
			return
		end

		local living = members[group.id]
		for _, unitID in ipairs(hooks.spawn(group, team)) do
			living[#living + 1] = unitID
			groupOf[unitID] = group.id
		end
	end

	--- What a group does now: run `orders` if it is awake, hold if it is not.
	local function settle(group, orders)
		if awake[group.id] then
			rouse(group.id)
			issue(group.id, orders)
		else
			sleep(group.id)
		end
	end

	--- Say once that an action was aimed at a group with nothing on the map. Not
	-- fatal, but it is what a mission that forgot its spawn_group looks like.
	local function requireUnits(group, what)
		if #members[group.id] > 0 then
			return true
		end
		engine:report("group-empty:" .. tostring(group.id) .. ":" .. what, "warning",
			"group " .. tostring(group.id) .. " has no units on the map to " .. what)
		return false
	end

	local handle = {}

	--- A group's units that are alive, in the order they were spawned. The table
	-- is the runtime's own, so read it and do not keep it.
	function handle.units(id)
		return members[id] or {}
	end

	--- Whether a group is running its orders rather than holding.
	function handle.isAwake(id)
		return awake[id] == true
	end

	--- Place a group, leaving it asleep if it was. This is `spawn_group`: it is
	-- how a mission puts a garrison somewhere without setting it off.
	function handle.spawn(id)
		local group = groupOfName(id)
		if group then
			place(group)
			settle(group, group.orders)
		end
	end

	--- Release a group to run its authored orders. This is `wake_group`.
	--
	-- A group that is not on the map yet is placed first, because "wake the
	-- reinforcements" with nothing to wake would say nothing and do nothing, and
	-- one action for a wave is what a mission author reaches for.
	function handle.wake(id)
		local group = groupOfName(id)
		if group then
			awake[group.id] = true
			place(group)
			settle(group, group.orders)
		end
	end

	--- Replace a group's orders. This is `give_orders`.
	--
	-- It wakes the group too: a group told to move that stands there holding
	-- position is a mission that looks broken and reports nothing. It does not
	-- spawn one, because ordering units that were never asked for is not what the
	-- author wrote.
	function handle.orders(id, orders)
		local group = groupOfName(id)
		if group and requireUnits(group, "order") then
			awake[group.id] = true
			settle(group, orders)
		end
	end

	--- Hand a group's units to another participant. This is `gift_units`.
	--
	-- Given rather than captured, so the engine tells everyone what it was: a
	-- mission handing the player a squad is a gift, and the units keep their
	-- group so the mission can go on ordering them.
	function handle.gift(id, team)
		local group = groupOfName(id)
		if not group then
			return
		end

		local newTeam = engineTeam[team]
		if not newTeam then
			engine:report("group-gift-team:" .. tostring(team), "warning",
				"no team named " .. tostring(team) .. " in this mission")
			return
		end
		if not requireUnits(group, "gift") then
			return
		end

		for _, unitID in ipairs(members[group.id]) do
			Spring.TransferUnit(unitID, newTeam, true)
		end
	end

	--- A unit is gone. Fed from the gadget's UnitDestroyed, so a group's roll is
	-- the units that are actually standing and a wiped group can be sent again.
	function handle.removed(unitID)
		resting[unitID] = nil

		local id = groupOf[unitID]
		if not id then
			return
		end
		groupOf[unitID] = nil

		local living = members[id]
		for index, member in ipairs(living) do
			if member == unitID then
				table.remove(living, index)
				return
			end
		end
	end

	--- Place every group the scenario says is there from the start, awake and
	-- already running its orders. Returns how many units that took, so the gadget
	-- can report one figure for everything it put on the map.
	function handle.start()
		local spawned = 0
		for _, group in ipairs((state.mission or {}).groups or {}) do
			if group.dormant ~= true then
				awake[group.id] = true
				place(group)
				settle(group, group.orders)
				spawned = spawned + #members[group.id]
			end
		end
		return spawned
	end

	engine:addAction("spawn_group", function(params)
		handle.spawn(params.group)
	end)

	engine:addAction("wake_group", function(params)
		handle.wake(params.group)
	end)

	engine:addAction("give_orders", function(params)
		handle.orders(params.group, params.orders)
	end)

	engine:addAction("gift_units", function(params)
		handle.gift(params.group, params.team)
	end)

	return handle
end

return M
