-- Proves the trigger engine: what a trigger fires on, when it stops firing, and
-- what enabling and disabling one does to the rest. The module under test is
-- pure, so the conditions and actions here are made up on the spot and no stub
-- engine is involved. Run it with:
--
--   luajit lua/mission-runtime/tests/trigger_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local TRIGGERS = dofile(support.root() .. "/luarules/mission_runtime/coilbox_triggers.lua")

--------------------------------------------------------------------------------
-- Scaffolding: a trigger, and the made-up types the triggers here use.
--
--   flag   a polled condition, true when the test says so
--   bell   an event-driven condition, watching "ding"
--   probe  an action that records that it ran
--   ring   an action that raises "ding" from inside a firing
--------------------------------------------------------------------------------

local function trigger(id, fields)
	local built = {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = {} },
		actions = {},
	}
	for key, value in pairs(fields or {}) do
		built[key] = value
	end
	return built
end

local function conditions(op, list)
	return { op = op, conditions = list }
end

local function flag(name)
	return { type = "flag", params = { name = name } }
end

local function bell()
	return { type = "bell", params = {} }
end

local function probe(mark)
	return { type = "probe", params = { mark = mark } }
end

local function build(list)
	local fired, logs, held = {}, {}, {}

	local engine = TRIGGERS.new({ triggers = list }, {
		gameSpeed = 30,
		log = function(level, message)
			logs[#logs + 1] = level .. ": " .. message
		end,
	})

	engine:addCondition("flag", {
		test = function(params)
			return held[params.name] == true
		end,
	})
	engine:addCondition("bell", {
		events = { "ding" },
		test = function()
			return true
		end,
	})
	engine:addAction("probe", function(params)
		fired[#fired + 1] = params.mark
	end)
	engine:addAction("ring", function(_, ctx)
		ctx.engine:event("ding")
	end)

	return engine, fired, logs, held
end

local function marks(fired)
	return table.concat(fired, ",")
end

local function said(logs, needle)
	for _, line in ipairs(logs) do
		if line:find(needle, 1, true) then
			return true
		end
	end
	return false
end

--------------------------------------------------------------------------------
-- Evaluating a condition group.
--------------------------------------------------------------------------------

local engine, fired, logs, held = build({
	trigger("both", { conditions = conditions("all", { flag("a"), flag("b") }), actions = { probe("both") } }),
	trigger("either", { conditions = conditions("any", { flag("a"), flag("b") }), actions = { probe("either") } }),
	trigger("nothing-all", { actions = { probe("nothing-all") } }),
	trigger("nothing-any", { conditions = conditions("any", {}), actions = { probe("nothing-any") } }),
})

held.a = true
engine:frame(15)
check("all holds only when every condition does", marks(fired) == "either,nothing-all", marks(fired))
check("any holds when one condition does", marks(fired):find("either") ~= nil)
check("an empty all holds, the way an empty conjunction does", marks(fired):find("nothing%-all") ~= nil)
check("an empty any does not", marks(fired):find("nothing%-any") == nil)

held.b = true
engine:frame(30)
check("a condition group is asked again on the next tick", marks(fired) == "either,nothing-all,both", marks(fired))

--------------------------------------------------------------------------------
-- The polled tick is slow on purpose.
--------------------------------------------------------------------------------

engine, fired, logs, held = build({
	trigger("tick", { ["repeat"] = true, conditions = conditions("all", { flag("a") }), actions = { probe("tick") } }),
})

held.a = true
for frame = 1, TRIGGERS.POLL_FRAMES * 2 do
	engine:frame(frame)
end
check("the polled tick does not run every frame", #fired == 2, #fired .. " ticks")

--------------------------------------------------------------------------------
-- Events against the polled tick.
--------------------------------------------------------------------------------

engine, fired, logs, held = build({
	trigger("polled", {
		["repeat"] = true,
		conditions = conditions("all", { flag("a") }),
		actions = { probe("polled") },
	}),
	trigger("evented", {
		["repeat"] = true,
		conditions = conditions("all", { bell() }),
		actions = { probe("evented") },
	}),
	trigger("mixed", {
		["repeat"] = true,
		conditions = conditions("all", { flag("a"), bell() }),
		actions = { probe("mixed") },
	}),
})

held.a = true
engine:event("ding")
check("an event fires the triggers that watch it", marks(fired) == "evented", marks(fired))
check("an event leaves the polled triggers alone", marks(fired):find("polled") == nil)

engine:event("clang")
check("an event nothing watches fires nothing", marks(fired) == "evented", marks(fired))

engine:frame(15)
check("the polled tick fires the polled triggers", marks(fired) == "evented,polled,mixed", marks(fired))
check("a trigger with one polled condition is polled, not evented",
	marks(fired):find("mixed") ~= nil)

--------------------------------------------------------------------------------
-- Firing once against repeating.
--------------------------------------------------------------------------------

engine, fired, logs, held = build({
	trigger("once", { conditions = conditions("all", { flag("a") }), actions = { probe("once") } }),
	trigger("again", {
		["repeat"] = true,
		conditions = conditions("all", { flag("a") }),
		actions = { probe("again") },
	}),
	trigger("slowly", {
		["repeat"] = true,
		cooldown = 1,
		conditions = conditions("all", { flag("a") }),
		actions = { probe("slowly") },
	}),
})

held.a = true
engine:frame(15)
check("a trigger fires when its conditions hold", marks(fired) == "once,again,slowly", marks(fired))
check("a spent trigger is no longer armed", engine:isEnabled("once") == false)

engine:frame(30)
check("a fire-once trigger fires once", marks(fired) == "once,again,slowly,again", marks(fired))
check("a repeating trigger holding off does not fire", marks(fired):find("slowly,again") ~= nil)

engine:frame(45)
check("a repeating trigger fires again once its cooldown is up",
	marks(fired) == "once,again,slowly,again,again,slowly", marks(fired))

--------------------------------------------------------------------------------
-- Triggers as a state machine.
--------------------------------------------------------------------------------

local function enable(id)
	return { type = "enable_trigger", params = { trigger = id } }
end

local function disable(id)
	return { type = "disable_trigger", params = { trigger = id } }
end

engine, fired, logs, held = build({
	trigger("gate", {
		conditions = conditions("all", { flag("a") }),
		actions = { probe("gate"), enable("late"), disable("doomed") },
	}),
	trigger("doomed", { conditions = conditions("all", { flag("a") }), actions = { probe("doomed") } }),
	trigger("late", {
		enabled = false,
		conditions = conditions("all", { flag("a") }),
		actions = { probe("late") },
	}),
	trigger("sticky", {
		conditions = conditions("all", { flag("a") }),
		actions = { probe("sticky"), enable("sticky") },
	}),
})

engine:frame(15)
check("a disabled trigger does not fire, whatever its conditions say", #fired == 0, marks(fired))

held.a = true
engine:frame(30)
check("a trigger enabled by an earlier one fires in the same pass",
	marks(fired) == "gate,late,sticky", marks(fired))
check("a trigger disabled by an earlier one does not", marks(fired):find("doomed") == nil)
check("a fire-once trigger that re-arms itself has the last word",
	engine:isEnabled("sticky") == true)

engine:frame(45)
check("a re-armed fire-once trigger fires again",
	marks(fired) == "gate,late,sticky,sticky", marks(fired))

engine, fired, logs = build({
	trigger("stray", { actions = { enable("nobody") } }),
})
engine:frame(15)
check("enabling a trigger that does not exist is reported", said(logs, "no trigger named nobody"))

--------------------------------------------------------------------------------
-- Types nothing implements, and types that go wrong.
--------------------------------------------------------------------------------

engine, fired, logs = build({
	trigger("unknown-condition", {
		conditions = conditions("any", { { type = "units_in_zone", params = {} } }),
		actions = { probe("unknown-condition") },
	}),
	trigger("unknown-action", { actions = { { type = "set_var", params = {} }, probe("unknown-action") } }),
})

engine:frame(15)
engine:frame(30)
check("a condition nothing implements is false", marks(fired) == "unknown-action", marks(fired))
check("a condition nothing implements is reported", said(logs, "no implementation for condition units_in_zone"))
check("an action nothing implements is reported", said(logs, "no implementation for action set_var"))
check("the rest of a trigger's actions still run", marks(fired):find("unknown%-action") ~= nil)
check("a missing type is reported once, not twice a second", #logs == 2, table.concat(logs, " / "))

engine, fired, logs = build({
	trigger("broken", {
		conditions = conditions("all", { { type = "explode", params = {} } }),
		actions = { probe("broken") },
	}),
})
engine:addCondition("explode", {
	test = function()
		error("no")
	end,
})
engine:frame(15)
check("a condition that errors is false rather than fatal", #fired == 0)
check("a condition that errors is reported", said(logs, "condition explode failed"))

--------------------------------------------------------------------------------
-- Time, and triggers that set each other off.
--------------------------------------------------------------------------------

engine, fired = build({
	trigger("wait", {
		conditions = conditions("all", { { type = "time_elapsed", params = { seconds = 1 } } }),
		actions = { probe("wait") },
	}),
})

engine:frame(15)
check("time_elapsed does not hold early", #fired == 0)
engine:frame(30)
check("time_elapsed holds once the seconds have passed", marks(fired) == "wait")

engine, fired, logs = build({
	trigger("loop", {
		["repeat"] = true,
		conditions = conditions("all", { bell() }),
		actions = { probe("loop"), { type = "ring", params = {} } },
	}),
})

engine:event("ding")
check("triggers that set each other off forever are cut short", #fired < 100, #fired .. " fires")
check("a cascade that will not settle is reported", said(logs, "set each other off"))

--------------------------------------------------------------------------------
-- A mission with no triggers at all.
--------------------------------------------------------------------------------

engine = TRIGGERS.new({}, {})
engine:frame(15)
engine:event("ding")
check("a mission with no triggers is not a special case", engine:isEnabled("anything") == false)

support.report()
