-- Coilbox mission runtime: the trigger engine.
--
-- A scenario's triggers are a flat list of "when these conditions hold, run
-- these actions". Triggers that enable and disable other triggers are what turn
-- that list into a state machine, so this module owns enable, disable, repeat
-- and cooldown, and knows nothing about what any other condition or action
-- means. Those are registered into it, by the runtime's own modules and by a
-- game's extensions.
--
-- Pure. No engine calls, no globals beyond the Lua standard library. Everything
-- that reads the world arrives through a registered condition, which is why the
-- state machine is provable with plain luajit and no engine.

local M = {}

-- How often the polled tick evaluates, in frames. Aggregates (zone occupancy,
-- unit counts, elapsed time) drift rather than jump, so checking them twice a
-- second costs a thirtieth of checking them every frame and no author can tell
-- the difference.
M.POLL_FRAMES = 15

-- How many times one evaluation pass may set off another before the engine
-- stops. Two triggers that enable each other, or that each set a var the other
-- watches, would otherwise loop inside one frame, and synced Lua that does not
-- return takes the game down with it.
local MAX_CASCADE = 16

local DEFAULT_GAME_SPEED = 30

local Engine = {}
Engine.__index = Engine

--------------------------------------------------------------------------------
-- Registration. This is the seam every other part of the runtime fills.
--------------------------------------------------------------------------------

--- Teach the engine a condition type.
--
-- `spec.test(params, ctx)` returns whether the condition holds now. `ctx` is the
-- table handed to M.new, with `frame` set to the current game frame and `event`
-- set to `{ name =, payload = }` when this pass came from an event.
--
-- `spec.events` is the list of event names the condition reacts to. A condition
-- with no events is an aggregate and lands on the polled tick instead. That
-- choice is the condition's to make, not the trigger author's: a trigger is
-- event-driven only when every one of its conditions is.
function Engine:addCondition(kind, spec)
	if self.conditions[kind] then
		self:log("warning", "condition " .. tostring(kind) .. " was registered twice, the later one wins")
	end
	self.conditions[kind] = spec
	self.index = nil
end

--- Run `fn(ctx)` at the top of every polled tick, before the pass.
--
-- A condition answers a question at the moment it is asked. A condition about
-- duration cannot: `test` runs once per armed trigger per pass, so it is neither
-- a clock nor guaranteed to run at all. Anything that has to sample the world on
-- a fixed beat registers here and leaves its `test` a lookup.
--
-- Ticks run on the polled tick only, never on an event and never again inside a
-- cascade, so a sampler advances once per beat however many passes follow it.
function Engine:addTick(fn)
	self.ticks[#self.ticks + 1] = fn
end

--- Teach the engine an action type. `run(params, ctx)` performs it.
function Engine:addAction(kind, run)
	if self.actions[kind] then
		self:log("warning", "action " .. tostring(kind) .. " was registered twice, the later one wins")
	end
	self.actions[kind] = run
end

--------------------------------------------------------------------------------
-- Reporting.
--------------------------------------------------------------------------------

function Engine:log(level, message)
	if self.ctx.log then
		self.ctx.log(level, message)
	end
end

--- Say something once. A trigger naming a type nothing implements would
-- otherwise repeat itself twice a second for the length of the mission.
function Engine:report(key, level, message)
	if self.reported[key] then
		return
	end
	self.reported[key] = true
	self:log(level, message)
end

--------------------------------------------------------------------------------
-- The state machine.
--------------------------------------------------------------------------------

--- Arm or disarm a trigger by id, which is what enable_trigger and
-- disable_trigger do and what a fire-once trigger does to itself.
function Engine:setEnabled(id, enabled)
	local record = self.byId[id]
	if not record then
		self:report("trigger:" .. tostring(id), "warning",
			"no trigger named " .. tostring(id) .. ", ignoring it")
		return
	end
	record.enabled = enabled
	if enabled then
		-- Re-arming clears whatever the trigger was waiting on. A mission that
		-- switches a trigger back on means now, not once an old cooldown runs out.
		record.readyFrame = self.frameNumber
	end
end

function Engine:isEnabled(id)
	local record = self.byId[id]
	return record ~= nil and record.enabled
end

local function registerBuiltins(engine)
	-- Seconds since the game started. Arithmetic on the frame counter and
	-- nothing else, so it belongs to the engine rather than to a module that
	-- reads the world.
	engine:addCondition("time_elapsed", {
		test = function(params, ctx)
			return ctx.frame >= (tonumber(params.seconds) or 0) * ctx.gameSpeed
		end,
	})

	engine:addAction("enable_trigger", function(params)
		engine:setEnabled(params.trigger, true)
	end)
	engine:addAction("disable_trigger", function(params)
		engine:setEnabled(params.trigger, false)
	end)
end

--- Build the engine for a compiled mission.
--
-- `ctx` is handed to every condition and action. The engine puts `engine`,
-- `gameSpeed` and, during a pass, `frame` and `event` on it; the host puts
-- whatever its own conditions need there, such as the published mission state.
-- `ctx.log(level, message)` is used for anything the engine has to report.
function M.new(mission, ctx)
	local self = setmetatable({
		ctx = ctx or {},
		conditions = {},
		actions = {},
		ticks = {},
		-- Trigger records in the order the mission lists them. Evaluation order
		-- is mission order, so a mission plays the same way twice.
		triggers = {},
		byId = {},
		queue = {},
		reported = {},
		frameNumber = 0,
		running = false,
	}, Engine)

	self.ctx.engine = self
	self.ctx.gameSpeed = tonumber(self.ctx.gameSpeed) or DEFAULT_GAME_SPEED

	for _, trigger in ipairs((mission or {}).triggers or {}) do
		local record = {
			id = trigger.id,
			def = trigger,
			-- A trigger nobody thought about is armed. Only an explicit false
			-- makes one wait for enable_trigger.
			enabled = trigger.enabled ~= false,
			repeats = trigger["repeat"] == true,
			cooldown = math.floor((tonumber(trigger.cooldown) or 0) * self.ctx.gameSpeed),
			readyFrame = 0,
		}
		self.triggers[#self.triggers + 1] = record
		self.byId[record.id] = record
	end

	registerBuiltins(self)
	return self
end

--------------------------------------------------------------------------------
-- Evaluation.
--------------------------------------------------------------------------------

--- The events a trigger watches, or nil when it belongs on the polled tick.
--
-- A trigger is event-driven only when every one of its conditions is, because a
-- trigger that fired on a unit's death without rechecking its zone condition
-- would fire on a half-truth. An unknown type polls, so a mission built for a
-- newer runtime is slow rather than silently inert.
function Engine:eventsOf(record)
	local list = (record.def.conditions or {}).conditions or {}
	if #list == 0 then
		return nil
	end

	local events = {}
	for _, condition in ipairs(list) do
		local spec = self.conditions[condition.type]
		if not spec or not spec.events then
			return nil
		end
		for _, name in ipairs(spec.events) do
			events[name] = true
		end
	end
	return events
end

--- Sort the triggers into event subscribers and the polled list. Rebuilt
-- whenever a registration changes what a condition type means.
function Engine:ensureIndex()
	if self.index then
		return
	end

	local subscribers, polled = {}, {}
	for _, record in ipairs(self.triggers) do
		local events = self:eventsOf(record)
		if events then
			for name in pairs(events) do
				subscribers[name] = subscribers[name] or {}
				table.insert(subscribers[name], record)
			end
		else
			polled[#polled + 1] = record
		end
	end

	self.subscribers, self.polled, self.index = subscribers, polled, true
end

--- Whether one condition holds. An unimplemented or broken condition is false,
-- never an error out of the callin that led here.
function Engine:test(condition)
	local kind = tostring(condition.type)
	local spec = self.conditions[condition.type]
	if not spec then
		self:report("condition:" .. kind, "warning",
			"no implementation for condition " .. kind .. ", treating it as false")
		return false
	end

	local ok, held = pcall(spec.test, condition.params or {}, self.ctx)
	if not ok then
		self:report("condition-error:" .. kind, "error",
			"condition " .. kind .. " failed: " .. tostring(held))
		return false
	end
	return not not held
end

--- Whether a trigger's condition group holds. The group is flat: one op over
-- one list, because triggers enabling triggers already express what nesting
-- would, and a flat list is what the editor draws.
--
-- An empty list holds under `all` and does not under `any`, the way an empty
-- conjunction and an empty disjunction always have.
function Engine:holds(record)
	local group = record.def.conditions or {}
	local list = group.conditions or {}
	local any = group.op == "any"

	for _, condition in ipairs(list) do
		local held = self:test(condition)
		if any and held then
			return true
		end
		if not any and not held then
			return false
		end
	end
	return not any
end

function Engine:act(action)
	local kind = tostring(action.type)
	local run = self.actions[action.type]
	if not run then
		self:report("action:" .. kind, "warning",
			"no implementation for action " .. kind .. ", ignoring it")
		return
	end

	local ok, err = pcall(run, action.params or {}, self.ctx)
	if not ok then
		self:report("action-error:" .. kind, "error", "action " .. kind .. " failed: " .. tostring(err))
	end
end

--- Run a trigger's actions.
--
-- The trigger's own state is settled first, so an action has the last word on
-- it: a fire-once trigger that re-enables itself stays armed, rather than being
-- disarmed after the fact by the firing that ran it.
function Engine:fire(record)
	if record.repeats then
		record.readyFrame = self.frameNumber + record.cooldown
	else
		record.enabled = false
	end

	local names = {}
	for _, action in ipairs(record.def.actions or {}) do
		names[#names + 1] = tostring(action.type) .. "(" .. tostring(action.params and action.params.group) .. ")"
	end
	self:log("notice", "FIRE " .. tostring(record.def.id) .. " -> " .. table.concat(names, ","))

	for _, action in ipairs(record.def.actions or {}) do
		self:act(action)
	end
end

--- One evaluation pass over the triggers an event woke, or over the polled ones
-- when `event` is nil.
--
-- Mission order, and each trigger's armed state read as it is reached, so a
-- trigger enabled by an earlier one in the same pass is evaluated in that pass
-- and one disabled by an earlier one is not.
function Engine:pass(event)
	self:ensureIndex()

	local records = self.polled
	if event then
		records = self.subscribers[event.name]
		if not records then
			return
		end
	end

	self.ctx.frame = self.frameNumber
	self.ctx.event = event

	for _, record in ipairs(records) do
		if record.enabled and self.frameNumber >= record.readyFrame and self:holds(record) then
			self:fire(record)
		end
	end

	self.ctx.event = nil
end

--- Run a pass, then whatever passes its actions asked for.
--
-- An action that raises an event is running inside a pass already, so its event
-- is queued rather than run there and then. Nothing re-enters, the ordering
-- stays breadth-first and readable, and a mission whose triggers set each other
-- off forever is cut off instead of hanging the game.
function Engine:run(event)
	if self.running then
		self.queue[#self.queue + 1] = event or false
		return
	end

	self.running = true
	self:pass(event)

	local passes = 0
	while #self.queue > 0 do
		passes = passes + 1
		if passes > MAX_CASCADE then
			self:report("cascade", "error", string.format(
				"triggers set each other off more than %d times in one frame, stopping there",
				MAX_CASCADE))
			break
		end
		local queued = table.remove(self.queue, 1)
		self:pass(queued or nil)
	end

	self.queue = {}
	self.running = false
end

--- Something happened that triggers may care about. The runtime raises
-- `unit_created`, `unit_finished`, `unit_destroyed` and `unit_captured`; a
-- condition may declare any name, and whatever raises it must use the same one.
function Engine:event(name, payload)
	self:run({ name = name, payload = payload })
end

--- Called every game frame. The engine owns the polled rate so that the tick is
-- provable here rather than in whichever callin happens to drive it.
--
-- Samplers first, so a condition that reads what one of them recorded reads this
-- tick's reading rather than the last one's.
function Engine:frame(frame)
	self.frameNumber = frame
	if frame % M.POLL_FRAMES ~= 0 then
		return
	end

	self.ctx.frame = frame
	for index, tick in ipairs(self.ticks) do
		local ok, err = pcall(tick, self.ctx)
		if not ok then
			self:report("tick-error:" .. index, "error", "a polled sampler failed: " .. tostring(err))
		end
	end

	self:run(nil)
end

return M
