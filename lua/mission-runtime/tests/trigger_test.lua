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
--   chime  an event-driven condition watching "ding", true when the test says so
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

local function chime(name)
	return { type = "chime", params = { name = name } }
end

--- The same condition, read the other way round.
local function negated(condition)
	condition.negate = true
	return condition
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
	engine:addCondition("chime", {
		events = { "ding" },
		test = function(params)
			return held[params.name] == true
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
-- Conditions read the other way round.
--
-- "The player has not built a factory" is `unit_built` with `negate = true`, so
-- what is proved here is that a real answer is turned over, that a non-answer is
-- not, and that a negated condition lands on the polled tick whatever the type
-- underneath it watches.
--------------------------------------------------------------------------------

engine, fired, logs, held = build({
	trigger("while-off", {
		["repeat"] = true,
		conditions = conditions("all", { negated(flag("a")) }),
		actions = { probe("while-off") },
	}),
	trigger("unknown", {
		["repeat"] = true,
		conditions = conditions("all", { negated({ type = "mystery", params = {} }) }),
		actions = { probe("unknown") },
	}),
})

engine:frame(15)
check("a negated condition holds while the one underneath it does not",
	marks(fired) == "while-off", marks(fired))
check("and a condition nothing implements is false either way round, so a broken "
	.. "trigger does not fire on the first frame instead of never",
	marks(fired):find("unknown") == nil, marks(fired))

held.a = true
engine:frame(30)
check("it stops holding the moment the one underneath it starts",
	marks(fired) == "while-off", marks(fired))

held.a = nil
engine:frame(45)
check("and holds again when that stops", marks(fired) == "while-off,while-off", marks(fired))

engine, fired, logs, held = build({
	trigger("waiting", {
		["repeat"] = true,
		conditions = conditions("all", { negated(chime("a")) }),
		actions = { probe("waiting") },
	}),
	trigger("listening", {
		["repeat"] = true,
		conditions = conditions("all", { chime("a") }),
		actions = { probe("listening") },
	}),
})

engine:frame(15)
check("a negated condition is polled, whatever the type underneath it watches",
	marks(fired) == "waiting", marks(fired))
check("where the same condition read the right way up waits for its event",
	marks(fired):find("listening") == nil, marks(fired))

held.a = true
engine:event("ding")
check("so the event still reaches the one that is not negated",
	marks(fired) == "waiting,listening", marks(fired))
check("and does not reach the one that is", select(2, marks(fired):gsub("waiting", "")) == 1,
	marks(fired))

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
-- Firing only when the conditions become true (issue #5295).
--------------------------------------------------------------------------------

local function enable(id)
	return { type = "enable_trigger", params = { trigger = id } }
end

local function disable(id)
	return { type = "disable_trigger", params = { trigger = id } }
end

--- A repeating trigger that fires as its conditions start to hold.
local function rising(id, list, fields)
	local built = { ["repeat"] = true, onBecomingTrue = true, conditions = conditions("all", list), actions = { probe(id) } }
	for key, value in pairs(fields or {}) do
		built[key] = value
	end
	return trigger(id, built)
end

--- Run the next `count` polled ticks.
local nextFrame
local function ticks(running, count)
	for _ = 1, count do
		nextFrame = nextFrame + TRIGGERS.POLL_FRAMES
		running:frame(nextFrame)
	end
end

engine, fired, logs, held = build({ rising("edge", { flag("a") }) })
nextFrame = 0

ticks(engine, 1)
check("it stays quiet while the conditions do not hold", #fired == 0, marks(fired))
held.a = true
ticks(engine, 1)
check("it fires when they start to hold", marks(fired) == "edge", marks(fired))
ticks(engine, 3)
check("it stays quiet while they go on holding", marks(fired) == "edge", marks(fired))
held.a = nil
ticks(engine, 1)
check("it stays quiet when they stop", marks(fired) == "edge", marks(fired))
held.a = true
ticks(engine, 2)
check("it fires again once they come back", marks(fired) == "edge,edge", marks(fired))

engine, fired, logs, held = build({
	trigger("gate", { conditions = conditions("all", { flag("open") }), actions = { enable("late") } }),
	rising("late", { flag("a") }, { enabled = false }),
	trigger("shut", { conditions = conditions("all", { flag("shut") }), actions = { disable("late") } }),
	trigger("nudge", {
		["repeat"] = true,
		conditions = conditions("all", { flag("nudge") }),
		actions = { enable("late") },
	}),
})
nextFrame = 0

held.a = true
ticks(engine, 2)
check("a disabled one does not fire while its conditions hold", #fired == 0, marks(fired))
held.open = true
ticks(engine, 3)
check("enabled while its conditions already hold, it fires once", marks(fired) == "late", marks(fired))
held.nudge = true
ticks(engine, 2)
check("enabling one that is already armed does not fire it again", marks(fired) == "late", marks(fired))
held.nudge, held.shut = nil, true
ticks(engine, 1)
held.nudge = true
ticks(engine, 2)
check("disabled and enabled again while they hold, it fires once more",
	marks(fired) == "late,late", marks(fired))

engine, fired = build({
	trigger("plain", { conditions = conditions("all", { flag("a") }), onBecomingTrue = true, actions = { probe("plain") } }),
})
nextFrame = 0
ticks(engine, 1)
check("on a fire-once trigger the option changes nothing", engine:isEnabled("plain") == true)

-- A one second cooldown, which is two polled ticks.
engine, fired, logs, held = build({ rising("cooled", { flag("a") }, { cooldown = 1 }) })
nextFrame = 0

held.a = true
ticks(engine, 1)
held.a = nil
ticks(engine, 1)
held.a = true
ticks(engine, 1)
check("becoming true inside the cooldown fires once it is up", marks(fired) == "cooled,cooled", marks(fired))
ticks(engine, 3)
check("and only once", marks(fired) == "cooled,cooled", marks(fired))

engine, fired, logs, held = build({ rising("brief", { flag("a") }, { cooldown = 2 }) })
nextFrame = 0

held.a = true
ticks(engine, 1)
held.a = nil
ticks(engine, 1)
held.a = true
ticks(engine, 1)
check("a cooldown still holds the next firing back", marks(fired) == "brief", marks(fired))
held.a = nil
ticks(engine, 4)
check("conditions that stop before the cooldown is up fire nothing", marks(fired) == "brief", marks(fired))

-- Event-driven conditions send nothing when they stop holding, so the polled tick
-- has to notice, or the trigger would never be ready again.
engine, fired, logs, held = build({ rising("rung", { chime("a") }) })
nextFrame = 0

held.a = true
engine:event("ding")
engine:event("ding")
check("an event-driven one fires once while its conditions hold", marks(fired) == "rung", marks(fired))
held.a = nil
ticks(engine, 1)
held.a = true
engine:event("ding")
check("and again once the polled tick has seen them stop", marks(fired) == "rung,rung", marks(fired))

engine, fired, logs, held = build({ rising("quiet", { chime("a") }) })
nextFrame = 0
held.a = true
ticks(engine, 2)
check("an event-driven one whose conditions already hold fires with no event", marks(fired) == "quiet", marks(fired))

-- A condition about something happening is spent by the firing, so the next time
-- it happens is a new one even with no polled tick between the two.
engine, fired, logs, held = build({
	rising("again", { { type = "rang", params = {} } }),
})
local lastRing = 0
engine:addCondition("rang", {
	events = { "ding" },
	test = function(_, ctx)
		return lastRing > ctx.armedAt
	end,
})
lastRing = engine:stamp()
engine:event("ding")
lastRing = engine:stamp()
engine:event("ding")
check("a condition spent by the firing fires it again the next time", marks(fired) == "again,again", marks(fired))

-- The same state loaded again, as `/luarules reload` does it.
do
	local kept, holding, count = {}, true, 0
	local function loaded()
		local running = TRIGGERS.new({ triggers = { rising("kept", { flag("a") }) } }, {
			save = function(id, enabled, readyFrame, wasHeld)
				kept[id] = { enabled = enabled, readyFrame = readyFrame, held = wasHeld }
			end,
			restore = function(id)
				return kept[id]
			end,
		})
		running:addCondition("flag", {
			test = function()
				return holding
			end,
		})
		running:addAction("probe", function()
			count = count + 1
		end)
		return running
	end

	nextFrame = 0
	ticks(loaded(), 1)
	local after = loaded()
	ticks(after, 2)
	check("a reload does not fire it again for conditions that have not changed", count == 1, count)
	holding = false
	ticks(after, 1)
	after = loaded()
	holding = true
	ticks(after, 1)
	check("and one that had stopped holding fires after a reload when they come back", count == 2, count)
end

--------------------------------------------------------------------------------
-- A condition that counts as holding once it has held (issue #5296).
--------------------------------------------------------------------------------

local function latched(condition)
	condition.latched = true
	return condition
end

local function once(id, list, fields)
	local built = { conditions = conditions("all", list), actions = { probe(id) } }
	for key, value in pairs(fields or {}) do
		built[key] = value
	end
	return trigger(id, built)
end

engine, fired, logs, held = build({ once("both", { latched(flag("a")), latched(flag("b")) }) })
nextFrame = 0
held.b = true
ticks(engine, 1)
held.b = nil
ticks(engine, 1)
check("one of two that has held is not both", #fired == 0, marks(fired))
held.a = true
ticks(engine, 1)
check("each counts from when it held, though they never held together", marks(fired) == "both", marks(fired))

-- The first condition not holding must not stop the second being asked.
engine, fired, logs, held = build({ once("behind", { flag("a"), latched(flag("b")) }) })
nextFrame = 0
held.b = true
ticks(engine, 1)
held.b, held.a = nil, true
ticks(engine, 1)
check("one is asked while another condition is not holding", marks(fired) == "behind", marks(fired))

engine, fired, logs, held = build({
	once("either", {}, { conditions = conditions("any", { flag("a"), latched(flag("b")) }), ["repeat"] = true }),
})
nextFrame = 0
held.a, held.b = true, true
ticks(engine, 1)
held.a, held.b = nil, nil
ticks(engine, 1)
check("one is asked when an earlier condition already settles an any",
	marks(fired) == "either,either", marks(fired))

engine, fired, logs, held = build({ once("during", { flag("go"), latched(flag("seen")) }, { cooldown = 1, ["repeat"] = true }) })
nextFrame = 0
engine.byId.during.readyFrame = TRIGGERS.POLL_FRAMES * 2
held.seen = true
ticks(engine, 1)
held.seen, held.go = nil, true
ticks(engine, 1)
check("one is asked while a cooldown runs", marks(fired) == "during", marks(fired))

engine, fired, logs, held = build({ once("off", { latched(flag("a")) }, { enabled = false }) })
nextFrame = 0
held.a = true
ticks(engine, 1)
held.a = nil
engine:setEnabled("off", true)
ticks(engine, 1)
check("a disabled trigger's condition is not asked, so nothing was remembered", #fired == 0, marks(fired))

engine, fired, logs, held = build({ once("kept", { latched(flag("a")) }) })
nextFrame = 0
held.a = true
ticks(engine, 1)
held.a = nil
engine:setEnabled("kept", true)
ticks(engine, 1)
check("enabled again, a trigger keeps what had held", marks(fired) == "kept,kept", marks(fired))

engine, fired, logs, held = build({ rising("edge-latched", { latched(flag("a")) }) })
nextFrame = 0
held.a = true
ticks(engine, 1)
held.a = nil
ticks(engine, 2)
held.a = true
ticks(engine, 1)
check("on a becomes-true trigger it never stops holding, so it fires once",
	marks(fired) == "edge-latched", marks(fired))

engine, fired, logs, held = build({ once("left", { latched(negated(flag("a"))), flag("b") }) })
nextFrame = 0
ticks(engine, 1)
held.a, held.b = true, true
ticks(engine, 1)
check("with not, what is remembered is that it did not hold", marks(fired) == "left", marks(fired))

engine, fired, logs = build({
	once("unknown-latched", { latched(negated({ type = "mystery", params = {} })) }),
})
nextFrame = 0
ticks(engine, 2)
check("one nothing implements is never remembered as held", #fired == 0, marks(fired))

-- Event-driven: heard on its event, remembered for a later one.
engine, fired, logs, held = build({ once("heard", { latched(chime("a")), latched(chime("b")) }) })
held.a = true
engine:event("ding")
held.a, held.b = nil, true
engine:event("ding")
check("event-driven ones are remembered between events", marks(fired) == "heard", marks(fired))

-- A condition spent by a firing, latched, is not spent.
engine, fired, logs, held = build({
	once("rung-once", { latched({ type = "rang", params = {} }) }, { ["repeat"] = true }),
})
do
	local rang = 0
	engine:addCondition("rang", {
		events = { "ding" },
		test = function(_, ctx)
			return rang > ctx.armedAt
		end,
	})
	rang = engine:stamp()
	engine:event("ding")
	engine:event("ding")
	check("a latched moment keeps holding after the firing", marks(fired) == "rung-once,rung-once", marks(fired))
end

-- The same state loaded again, as `/luarules reload` does it.
do
	local kept, holding, count = {}, {}, 0
	local function loaded()
		local running = TRIGGERS.new({ triggers = { once("saved", { latched(flag("a")), latched(flag("b")) }) } }, {
			save = function(id, enabled, readyFrame, wasHeld, happened)
				local copy = {}
				for index, value in ipairs(happened or {}) do
					copy[index] = value
				end
				kept[id] = { enabled = enabled, readyFrame = readyFrame, held = wasHeld, latched = copy }
			end,
			restore = function(id)
				return kept[id]
			end,
		})
		running:addCondition("flag", {
			test = function(params)
				return holding[params.name] == true
			end,
		})
		running:addAction("probe", function()
			count = count + 1
		end)
		return running
	end

	nextFrame = 0
	holding.b = true
	ticks(loaded(), 1)
	check("what has held is handed to the host by its place in the list",
		kept.saved and kept.saved.latched[1] == 2 and #kept.saved.latched == 1)
	holding.b, holding.a = nil, true
	ticks(loaded(), 1)
	check("and read back after a reload", count == 1, count)
end

--------------------------------------------------------------------------------
-- Triggers as a state machine.
--------------------------------------------------------------------------------

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
