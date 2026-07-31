-- Proves mission variables: what a var starts at, what the six comparisons
-- answer, what set_var and add_var do to a counter, and what a var nothing
-- declared reads as. The gadget is loaded under the stub engine rather than the
-- trigger module on its own, because a var is mirrored into a game rules param
-- and that mirror is the only way anything outside synced Lua reads one. Run it
-- with:
--
--   luajit lua/mission-runtime/tests/var_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- What a mirrored var is called. Hard-coded rather than read off the module,
-- because this name is the contract a LuaUI panel and a debug view depend on.
local PREFIX = "coilbox_mission_var_"

--------------------------------------------------------------------------------
-- Scaffolding: a mission of nothing but vars and the triggers that read and
-- write them.
--
-- Every trigger repeats unless it says otherwise, so each polled tick says which
-- conditions hold right then rather than which have ever held.
--------------------------------------------------------------------------------

local function watching(id, params)
	return {
		id = id,
		enabled = true,
		["repeat"] = true,
		conditions = { op = "all", conditions = { { type = "var", params = params } } },
		actions = { { type = "probe", params = { mark = id } } },
	}
end

--- A fire-once trigger that runs `actions` on the first polled tick.
local function once(id, actions)
	return {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = actions,
	}
end

local function setVar(name, value)
	return { type = "set_var", params = { name = name, value = value } }
end

local function addVar(name, value)
	return { type = "add_var", params = { name = name, value = value } }
end

--- Start a mission of the given vars and triggers and run to the first playable
-- frame.
local function playing(vars, triggers)
	local mission = compiled({ vars = vars, triggers = triggers })
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission))
	engine.env:Initialize()
	engine.env:GameStart()

	local fired = {}
	engine.GG.CoilboxMission.triggers:addAction("probe", function(params)
		fired[#fired + 1] = params.mark
	end)
	engine.fired = fired

	engine.env:GameFrame(1)
	return engine
end

--- Run the polled tick at `frame` and say what fired on it, in mission order.
local function tick(engine, frame)
	for index = #engine.fired, 1, -1 do
		engine.fired[index] = nil
	end
	engine.env:GameFrame(frame)
	return table.concat(engine.fired, ",")
end

--- What anything outside synced Lua reads a var as.
local function mirrored(engine, name)
	return engine.env.Spring.GetGameRulesParam(PREFIX .. name)
end

--------------------------------------------------------------------------------
-- What a var starts at.
--------------------------------------------------------------------------------

local engine = playing({ alertLevel = 0, phase = 2, rations = 1.5 }, {})

check("a var starts at the number the scenario declared", engine.GG.CoilboxMission.vars.get("phase") == 2)
check("a var declared at nothing starts at nothing", engine.GG.CoilboxMission.vars.get("alertLevel") == 0)
check("a var is a number, not a counter", engine.GG.CoilboxMission.vars.get("rations") == 1.5)
check("an initial value is readable outside synced Lua before the first frame",
	mirrored(engine, "phase") == 2, tostring(mirrored(engine, "phase")))

--------------------------------------------------------------------------------
-- A var read before anything has set it.
--------------------------------------------------------------------------------

engine = playing({ phase = 2 }, {
	watching("declared", { name = "phase", op = "eq", value = 2 }),
	watching("undeclared", { name = "ghost", op = "eq", value = 0 }),
	watching("undeclared-set", { name = "ghost", op = "gt", value = 0 }),
})

local held = tick(engine, 15)
check("a var nothing has written yet reads as the number it was declared at",
	held == "declared,undeclared", held)
check("so a var the mission never declared reads as nothing", held:find("undeclared") ~= nil, held)
check("and a condition asking whether it is above nothing does not hold",
	held:find("undeclared%-set") == nil, held)
check("and a var the mission never declared is reported",
	logged(engine, "no var named ghost in this mission"))

--------------------------------------------------------------------------------
-- The six comparisons.
--------------------------------------------------------------------------------

engine = playing({ phase = 2 }, {
	watching("eq", { name = "phase", op = "eq", value = 2 }),
	watching("ne", { name = "phase", op = "ne", value = 2 }),
	watching("lt", { name = "phase", op = "lt", value = 2 }),
	watching("lte", { name = "phase", op = "lte", value = 2 }),
	watching("gt", { name = "phase", op = "gt", value = 2 }),
	watching("gte", { name = "phase", op = "gte", value = 2 }),
	watching("nonsense", { name = "phase", op = "approximately", value = 2 }),
})

held = tick(engine, 15)
check("a var equal to the value holds eq, lte and gte", held == "eq,lte,gte", held)

engine.GG.CoilboxMission.vars.set("phase", 1)
held = tick(engine, 30)
check("a var below the value holds ne, lt and lte", held == "ne,lt,lte", held)

engine.GG.CoilboxMission.vars.set("phase", 3)
held = tick(engine, 45)
check("a var above the value holds ne, gt and gte", held == "ne,gt,gte", held)

check("a comparison this runtime does not know never holds", held:find("nonsense") == nil, held)
check("and is reported", logged(engine, "no comparison named approximately"))

--------------------------------------------------------------------------------
-- Setting and adding.
--------------------------------------------------------------------------------

engine = playing({ alertLevel = 0 }, {
	once("alarm", { setVar("alertLevel", 3) }),
	watching("alerted", { name = "alertLevel", op = "gte", value = 3 }),
})

held = tick(engine, 15)
check("a trigger reading a var an earlier trigger set fires in the same pass",
	held == "alerted", held)
check("and the new number is readable outside synced Lua", mirrored(engine, "alertLevel") == 3,
	tostring(mirrored(engine, "alertLevel")))

engine = playing({ kills = 0, morale = 10, rations = 0 }, {
	once("count", { addVar("kills", 1), addVar("kills", 1), addVar("kills", 1) }),
	once("wound", { addVar("morale", -4) }),
	once("ration", { addVar("rations", 0.5) }),
	watching("enough", { name = "kills", op = "gte", value = 3 }),
	watching("shaken", { name = "morale", op = "lt", value = 10 }),
})

held = tick(engine, 15)
check("adding to a var counts", engine.GG.CoilboxMission.vars.get("kills") == 3,
	tostring(engine.GG.CoilboxMission.vars.get("kills")))
check("a counter that reached its number fires the trigger watching it",
	held:find("enough") ~= nil, held)
check("adding a negative counts down", engine.GG.CoilboxMission.vars.get("morale") == 6,
	tostring(engine.GG.CoilboxMission.vars.get("morale")))
check("and the trigger watching that fires too", held:find("shaken") ~= nil, held)
check("adding a fraction keeps the fraction", engine.GG.CoilboxMission.vars.get("rations") == 0.5,
	tostring(engine.GG.CoilboxMission.vars.get("rations")))
check("every add is mirrored, not just the last", mirrored(engine, "kills") == 3,
	tostring(mirrored(engine, "kills")))

engine = playing({}, {
	once("start-counting", { addVar("ghost", 2) }),
	watching("counted", { name = "ghost", op = "eq", value = 2 }),
})

held = tick(engine, 15)
check("adding to a var the mission never declared starts from nothing", held == "counted", held)
check("and says so once rather than on every tick", logged(engine, "no var named ghost"))

--------------------------------------------------------------------------------
-- Vars against the trigger engine.
--
-- A var condition is polled rather than event-driven, so a trigger reading a var
-- nothing has changed since the mission started is still asked.
--------------------------------------------------------------------------------

engine = playing({ phase = 0 }, {
	-- Mission order matters: this reader is listed before the writer, so it is
	-- asked before the write happens and has to wait for the next tick.
	watching("late-reader", { name = "phase", op = "eq", value = 1 }),
	once("writer", { setVar("phase", 1) }),
})

held = tick(engine, 15)
check("a trigger listed before the one that sets its var waits a tick", held == "", held)

held = tick(engine, 30)
check("and reads the new number on the next one", held == "late-reader", held)

--------------------------------------------------------------------------------
-- The published handle, which is how a game's own actions touch a var.
--------------------------------------------------------------------------------

engine = playing({ phase = 0 }, {})
local vars = engine.GG.CoilboxMission.vars

vars.set("phase", 4)
check("setting a var through the published handle writes it", vars.get("phase") == 4)
check("and mirrors it", mirrored(engine, "phase") == 4, tostring(mirrored(engine, "phase")))

vars.add("phase", -4)
check("adding through the published handle writes it too", vars.get("phase") == 0)
check("and mirrors that", mirrored(engine, "phase") == 0, tostring(mirrored(engine, "phase")))

--------------------------------------------------------------------------------
-- Vars are synced only, like the triggers that read them. The unsynced half has
-- the rules params to read instead, which the engine keeps in one table for
-- every Lua handle.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(compiled({ vars = { phase = 1 } })),
	{ synced = false })
unsynced.env:Initialize()
check("the unsynced half holds no vars of its own", unsynced.GG.CoilboxMission.vars == nil)
check("and writes no rules params either", next(unsynced.rulesParams) == nil)

support.report()
