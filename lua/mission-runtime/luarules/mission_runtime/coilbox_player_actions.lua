-- Coilbox mission runtime: the trigger conditions that read what a player did.
--
-- Two conditions that leave nothing in the world for the others to find:
-- `unit_selected`, which holds while a player has a unit selected, and
-- `command_given`, which holds once a player has given an order. They are what a
-- lesson's "select your builder" and "tell it to build a solar panel" are made
-- of.
--
-- An order is synced. The engine hands every one a unit accepts to synced Lua
-- through UnitCommand, with the player who gave it, so the gadget feeds
-- `hooks.command` straight from that callin.
--
-- A selection is not. It exists on the client of the player who made it and
-- nowhere else, so that client's unsynced half says what it has selected in a
-- Lua message, which the server relays to every machine and writes into the
-- replay. `hooks.selection` reads it in synced code, where every machine reads
-- the same bytes on the same frame. That is what keeps a trigger decided by one
-- player's mouse from desyncing a game with two players in it, and what makes a
-- replay fire the trigger again without anyone selecting anything.
--
-- Read-only. It calls the engine to look a unit up, and changes nothing.

local M = {}

-- What a selection message starts with. Every Lua message any gadget or widget
-- sends reaches RecvLuaMsg, so the prefix is how this one is told from the rest.
M.SELECTION_MESSAGE = "coilbox_mission_selection:"

-- The condition's own word for a build order of any kind. Every other command is
-- named the way the engine's CMD table names it.
local BUILD = "build"

--- Call `fn(params)` for every condition of one type the mission's triggers
-- carry, armed or not, negated or not.
local function eachCondition(mission, kind, fn)
	for _, trigger in ipairs((mission or {}).triggers or {}) do
		for _, condition in ipairs((trigger.conditions or {}).conditions or {}) do
			if condition.type == kind then
				fn(condition.params or {})
			end
		end
	end
end

--- Whether any trigger in the mission asks a condition of this type. The gadget
-- defines the callins these conditions need only when one does, because
-- UnitCommand runs for every order anyone gives.
function M.uses(mission, kind)
	local found = false
	eachCondition(mission, kind, function()
		found = true
	end)
	return found
end

--- What a client has to report about its selection for the mission's
-- `unit_selected` conditions to be answerable, or nil when it has none.
--
-- `defs` and `actors` are the unit types and the placed units some condition
-- names, `any` is whether some condition names neither, and `size` is the most
-- units a report can carry: one for each name, and one more for `any`.
function M.watch(mission)
	local watch = { defs = {}, actors = {}, any = false, size = 1 }
	local used = false
	eachCondition(mission, "unit_selected", function(params)
		used = true
		if params.unitDef and not watch.defs[params.unitDef] then
			watch.defs[params.unitDef] = true
			watch.size = watch.size + 1
		end
		if params.actor and not watch.actors[params.actor] then
			watch.actors[params.actor] = true
			watch.size = watch.size + 1
		end
		if not params.unitDef and not params.actor then
			watch.any = true
		end
	end)
	return used and watch or nil
end

--- The message a client sends for what it has selected.
--
-- Not the whole selection. A player who drags a box over two hundred units has
-- nothing to tell the mission that one unit of each type it asked about does
-- not, so the report is one unit per watched type, the unit of each watched
-- actor, and the first unit selected, which answers "anything at all". That
-- bounds the message by what the mission asks rather than by what the player
-- does.
--
-- `defNameOf(unitID)` is the unit's def name, and `units` maps an actor id to
-- the unit it became.
function M.encode(watch, selected, defNameOf, units)
	local picked, seen = {}, {}
	local function pick(unitID)
		if unitID and not seen[unitID] then
			seen[unitID] = true
			picked[#picked + 1] = unitID
		end
	end

	local isSelected = {}
	local typed = {}
	for _, unitID in ipairs(selected) do
		isSelected[unitID] = true
		local name = defNameOf(unitID)
		if name and watch.defs[name] and not typed[name] then
			typed[name] = true
			pick(unitID)
		end
	end
	for actor in pairs(watch.actors) do
		local unitID = units[actor]
		if unitID and isSelected[unitID] then
			pick(unitID)
		end
	end
	pick(selected[1])

	-- Sorted, so the same selection is the same message however the tables above
	-- happened to be walked, and a client can tell a new report from a repeat.
	table.sort(picked)
	return M.SELECTION_MESSAGE .. table.concat(picked, ",")
end

--- Register the player conditions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @return the hooks the gadget's UnitCommand and RecvLuaMsg callins feed
function M.register(engine, state)
	-- Trigger params name a participant, not an engine team. The mapping is
	-- fixed once the mission has started, so it is taken once.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	local watch = M.watch(state.mission)

	-- Player id -> { team =, any =, defs = { name = true }, actors = { id = true } },
	-- which is what that player's last report said they have selected.
	local selections = {}
	-- Engine team -> what was ordered -> the stamp of the last time a player on
	-- that team ordered it. Keyed by command id, plus "any" and "build".
	local given = {}
	-- Engine team -> whether an AI plays it, asked once.
	local aiTeam = {}

	local function isAiTeam(team)
		if aiTeam[team] == nil then
			aiTeam[team] = select(4, Spring.GetTeamInfo(team, false)) == true
		end
		return aiTeam[team]
	end

	--- Whether one player's selection answers a condition.
	local function selectionHolds(selection, params)
		if params.actor and not selection.actors[params.actor] then
			return false
		end
		if params.unitDef and not selection.defs[params.unitDef] then
			return false
		end
		return selection.any
	end

	-- Woken by a report, so a lesson waiting on a selection moves on the moment
	-- the player makes it, and a selection the player already had when the
	-- trigger was armed is picked up by the tick below.
	engine:addCondition("unit_selected", {
		events = { "selection_changed" },
		test = function(params)
			local team = nil
			if params.team ~= nil then
				team = engineTeam[params.team]
				if not team then
					return false
				end
			end
			for _, selection in pairs(selections) do
				if (team == nil or selection.team == team) and selectionHolds(selection, params) then
					return true
				end
			end
			return false
		end,
	})

	-- A selection is a state rather than a moment: a player who still has their
	-- builder selected when "select your builder" is armed has done what was
	-- asked, and no report is coming to say so. So the question is asked again on
	-- the polled beat for as long as anybody has anything selected.
	engine:addTick(function()
		for _, selection in pairs(selections) do
			if selection.any then
				engine:event("selection_changed", {})
				return
			end
		end
	end)

	--- The key an order is filed under for this condition, or nil with a reason
	-- when the condition names something this game does not have.
	local function wanted(params)
		if params.unitDef then
			local def = UnitDefNames[params.unitDef]
			if not def then
				return nil, string.format(
					"command_given names %s, which this game has no unit def for", tostring(params.unitDef))
			end
			-- A build order's id is the negative of the def it builds.
			return -def.id
		end
		if params.command == nil then
			return "any"
		end
		if params.command == BUILD then
			return BUILD
		end
		local id = CMD[tostring(params.command):upper()]
		if type(id) ~= "number" then
			return nil, string.format(
				"command_given names %s, which is not an engine command", tostring(params.command))
		end
		return id
	end

	-- Holds once a player has given the order since the trigger was armed, or
	-- since it last fired. Not "has ever": a lesson whose third step is "give a
	-- move order" would otherwise be answered by the one given in its first.
	engine:addCondition("command_given", {
		events = { "command_given" },
		test = function(params, ctx)
			local key, problem = wanted(params)
			if not key then
				engine:report("command-given:" .. problem, "warning", problem)
				return false
			end

			local since = ctx.armedAt or 0
			if params.team ~= nil then
				local team = engineTeam[params.team]
				return team ~= nil and ((given[team] or {})[key] or 0) > since
			end
			for _, orders in pairs(given) do
				if (orders[key] or 0) > since then
					return true
				end
			end
			return false
		end,
	})

	local hooks = {}

	--- A unit accepted an order. Returns whether a player gave it, which is
	-- whether there is anything for a trigger to hear about.
	--
	-- An order synced Lua gave is the mission or the game ordering its own units,
	-- and one given to an AI's unit is the AI's, which the engine attributes to
	-- the player hosting that AI. Neither is a player doing what a lesson asked.
	function hooks.command(unitTeam, cmdID, playerID, fromLua)
		if fromLua or type(playerID) ~= "number" or playerID < 0 or isAiTeam(unitTeam) then
			return false
		end

		local stamp = engine:stamp()
		local orders = given[unitTeam]
		if not orders then
			orders = {}
			given[unitTeam] = orders
		end
		orders.any = stamp
		orders[cmdID] = stamp
		if cmdID < 0 then
			orders[BUILD] = stamp
		end
		return true
	end

	--- A Lua message arrived. Returns whether it was a selection report, and
	-- whether it changed what anybody is known to have selected.
	--
	-- The message is whatever a client chose to send, so nothing in it is taken on
	-- trust: a spectator's is dropped, a unit that is not on the sender's own team
	-- is skipped, and no more ids are read than a report can carry.
	function hooks.selection(playerID, message)
		if type(message) ~= "string" or message:sub(1, #M.SELECTION_MESSAGE) ~= M.SELECTION_MESSAGE then
			return false, false
		end
		if not watch then
			return true, false
		end

		local _, _, spectator, team = Spring.GetPlayerInfo(playerID, false)
		if spectator or not team then
			return true, false
		end

		local selection = { team = team, any = false, defs = {}, actors = {} }
		local read = 0
		for digits in message:sub(#M.SELECTION_MESSAGE + 1):gmatch("%d+") do
			read = read + 1
			if read > watch.size then
				break
			end
			local unitID = tonumber(digits)
			if Spring.GetUnitTeam(unitID) == team then
				selection.any = true
				local def = UnitDefs[Spring.GetUnitDefID(unitID)]
				if def then
					selection.defs[def.name] = true
				end
				for actor in pairs(watch.actors) do
					if state.units[actor] == unitID then
						selection.actors[actor] = true
					end
				end
			end
		end

		selections[playerID] = selection
		return true, true
	end

	return hooks
end

return M
