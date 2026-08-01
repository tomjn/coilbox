-- Proves the condition and action types a game declares for itself: that a
-- trigger naming one is dispatched to the game's own code, that the game may not
-- redefine a type the runtime owns, and that what runs is what the declaration
-- lists. The gadget is loaded under the stub engine rather than the module on its
-- own, because reading missions/extensions.lua out of the archive is half of what
-- is being proved. Run it with:
--
--   luajit lua/mission-runtime/tests/extension_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

local HANDLER = "luarules/mission_extensions/demo.lua"

--------------------------------------------------------------------------------
-- Scaffolding: a game that declares two types and implements them.
--------------------------------------------------------------------------------

--- A mission of one trigger that fires the given condition into the given action.
local function mission(conditions, actions)
	return compiled({
		teams = { player = { team = 0 }, enemy = { team = 1 } },
		triggers = {
			{
				id = "under-test",
				enabled = true,
				["repeat"] = true,
				conditions = { op = "all", conditions = conditions },
				actions = actions,
			},
		},
	})
end

--- Start a game whose archive holds `declaration` and `handler`, or neither when
-- they are nil, and run to the first playable frame.
local function playing(mission, declaration, handler, handlerPath)
	local files = missionFiles(mission)
	if declaration then
		files["missions/extensions.lua"] = function()
			return declaration
		end
	end
	if handler then
		files[handlerPath or HANDLER] = function()
			return handler
		end
	end

	local engine = load({ coilbox_mission = "demo" }, files)
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

local function declaring(conditions, actions)
	return { handler = HANDLER, conditions = conditions, actions = actions }
end

--------------------------------------------------------------------------------
-- A game with no declaration, which is nearly every game.
--------------------------------------------------------------------------------

local engine = playing(mission({}, {}))

check("a game with no extensions.lua registers nothing",
	#engine.GG.CoilboxMission.extensions.conditions == 0
	and #engine.GG.CoilboxMission.extensions.actions == 0)
check("and says nothing about it", not logged(engine, "extensions.lua"))

--------------------------------------------------------------------------------
-- Dispatch: a trigger naming a declared type reaches the game's own code.
--------------------------------------------------------------------------------

local granted = {}
local ready = false

local handler = {
	conditions = {
		demo_ready = {
			test = function(params, ctx)
				return ready and ctx.teamOf(params.team) == 0
			end,
		},
	},
	actions = {
		demo_grant = function(params, ctx)
			granted[#granted + 1] = {
				team = ctx.teamOf(params.team),
				amount = params.amount,
				frame = ctx.frame,
			}
		end,
	},
}

local declaration = declaring(
	{ { type = "demo_ready", label = "Ready", params = { { name = "team", kind = "teamId" } } } },
	{ { type = "demo_grant", label = "Grant", params = { { name = "amount", kind = "number" } } } })

engine = playing(
	mission(
		{ { type = "demo_ready", params = { team = "player" } } },
		{ { type = "demo_grant", params = { team = "enemy", amount = 25 } }, { type = "probe", params = { mark = "fired" } } }),
	declaration, handler)

check("a declared condition and action are registered",
	engine.GG.CoilboxMission.extensions.conditions[1] == "demo_ready"
	and engine.GG.CoilboxMission.extensions.actions[1] == "demo_grant")

check("a condition the game says does not hold stops the trigger", tick(engine, 15) == "")

ready = true
local held = tick(engine, 30)
check("a condition the game says holds fires the trigger", held == "fired", held)
check("and the action reached the game's own code", #granted == 1, #granted)
check("with the parameters the mission wrote", granted[1] and granted[1].amount == 25, granted[1] and granted[1].amount)
check("and the team resolved to an engine team number",
	granted[1] and granted[1].team == 1, granted[1] and granted[1].team)
check("and the frame it fired on", granted[1] and granted[1].frame == 30, granted[1] and granted[1].frame)
ready = false

--------------------------------------------------------------------------------
-- The boundary: an extension adds a game concept, never an engine one.
--------------------------------------------------------------------------------

local hijacked = false
engine = playing(
	mission(
		{ { type = "time_elapsed", params = { seconds = 0 } } },
		{ { type = "probe", params = { mark = "built-in" } } }),
	declaring(
		{ { type = "time_elapsed", label = "Never" } },
		{ { type = "victory", label = "Ours now" } }),
	{
		conditions = {
			time_elapsed = {
				test = function()
					hijacked = true
					return false
				end,
			},
		},
		actions = {
			victory = function()
				hijacked = true
			end,
		},
	})

check("a declaration may not redefine a condition the runtime owns",
	logged(engine, "time_elapsed is the runtime's own type"))
check("nor an action", logged(engine, "victory is the runtime's own type"))
check("neither is registered",
	#engine.GG.CoilboxMission.extensions.conditions == 0
	and #engine.GG.CoilboxMission.extensions.actions == 0)
check("and the runtime's own type is what runs", tick(engine, 15) == "built-in")
check("the game's version never ran at all", not hijacked)

--------------------------------------------------------------------------------
-- What runs is what the declaration lists.
--------------------------------------------------------------------------------

engine = playing(mission({}, {}), declaring({}, {}), {
	conditions = { demo_ready = { test = function() return true end } },
	actions = { demo_grant = function() end },
})

check("an implementation nothing declared is not registered",
	#engine.GG.CoilboxMission.extensions.conditions == 0
	and #engine.GG.CoilboxMission.extensions.actions == 0)
check("and is reported", logged(engine, "which missions/extensions.lua does not declare"))

engine = playing(
	mission(
		{ { type = "demo_ready", params = {} } },
		{ { type = "demo_grant", params = {} } }),
	declaration, { conditions = {}, actions = {} })

check("a declared condition the handler does not implement is reported",
	logged(engine, "has no test for condition demo_ready"))
check("and a declared action the handler does not implement too",
	logged(engine, "has no function for action demo_grant"))
check("neither is registered",
	#engine.GG.CoilboxMission.extensions.conditions == 0
	and #engine.GG.CoilboxMission.extensions.actions == 0)
check("so the trigger naming them never fires", tick(engine, 15) == "")

--------------------------------------------------------------------------------
-- A declaration that cannot be followed.
--------------------------------------------------------------------------------

engine = playing(mission({}, {}), { conditions = {}, actions = {} })
check("a declaration naming no handler is reported", logged(engine, "names no handler"))

engine = playing(mission({}, {}), declaring({}, {}))
check("a declaration naming a handler that is not there is reported",
	logged(engine, "names a handler this game has no " .. HANDLER))

engine = playing(mission({}, {}), declaring({ "not a table", { label = "no type" } }, {}), handler)
check("an entry that is not a table is reported", logged(engine, "an entry that is not a table"))
check("and one with no type name", logged(engine, "an entry with no type name"))

engine = playing(mission({}, {}), declaring(
	{ { type = "demo_ready" }, { type = "demo_ready" } }, {}), handler)
check("a type declared twice is reported", logged(engine, "demo_ready is declared twice"))
check("and registered once", #engine.GG.CoilboxMission.extensions.conditions == 1,
	#engine.GG.CoilboxMission.extensions.conditions)

--------------------------------------------------------------------------------
-- The handler is code and the declaration is data, so each is read the way the
-- gadget reads its own of each kind.
--------------------------------------------------------------------------------

local declarationSawSpring, handlerSawSpring

local files = missionFiles(mission({}, {}))
files["missions/extensions.lua"] = function(env)
	declarationSawSpring = env.Spring ~= nil
	return declaring({}, {})
end
files[HANDLER] = function(env)
	handlerSawSpring = env.Spring ~= nil
	env.SF_HANDLER_GLOBAL = true
	return { conditions = {}, actions = {} }
end
engine = load({ coilbox_mission = "demo" }, files)
engine.env:Initialize()

check("the declaration is read in an empty environment, so it cannot reach the engine",
	declarationSawSpring == false, tostring(declarationSawSpring))
check("and the handler in one that reaches it, so a game's code can call the engine",
	handlerSawSpring == true, tostring(handlerSawSpring))
check("but a global the handler sets does not land in the runtime's environment",
	rawget(engine.env, "SF_HANDLER_GLOBAL") == nil)

support.report()
