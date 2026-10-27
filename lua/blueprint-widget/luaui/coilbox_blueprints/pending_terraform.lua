-- Zero-K's terraform orders for a placed blueprint, each held back until a
-- builder is about to reach its level step (issue #4803).
--
-- Zero-K's gadget (unit_terraform.lua) removes terraform units nobody has
-- worked on for two minutes. It keeps them alive while a level step for them
-- sits in a constructor's queue, but Zero-K v1.14.10.3 can lose track of a
-- constructor once two others die, and then the units go two minutes after the
-- order. A layout with more than two minutes of buildings ahead of a terrain
-- change would leave its builder nothing to build when it got there. Sent late,
-- the order starts its two minutes when the builder is nearly at the step.
--
-- It cannot wait until the step is at the very front. The order reaches the
-- gadget a frame or more after it is given, and the gadget drops a level step
-- whose tag it does not know as soon as a builder reaches it. So an order goes
-- out while at most one building is still ahead of its step.

local M = {}

-- Zero-K's command numbers (LuaRules/Configs/customcmds.lua), as in place.lua.
M.CMD_TERRAFORM_INTERNAL = 39801
M.CMD_LEVEL = 39736
-- Commands that are terraform work, not a building: the repair Zero-K's gadget
-- puts in front of a level step, and Zero-K's terraform steps (ramp, level,
-- raise, smooth, restore). None of them counts as a building ahead.
local TERRAFORM_WORK = { [40] = true, [39734] = true, [39736] = true, [39737] = true, [39738] = true, [39739] = true }
-- Nor is the move placing puts in front of a level step to step clear of it
-- (#4816): the engine's move, and Zero-K's raw move and raw build
-- (customcmds.lua), which a move turns into and which walks a builder into
-- range. A move is over in a moment, too soon for the order to arrive in.
-- The wait builders hold at their spots until all are clear goes the same way.
local STEPPING = { [5] = true, [10] = true, [31109] = true, [31110] = true }
-- How many buildings may still be ahead of a level step when its order goes.
M.AHEAD = 1
-- How often, in game frames, the whole of each queue is read to drop orders
-- whose step has left every queue, because the queue was cancelled or the
-- builder died.
M.SWEEP_EVERY = 30

local Spring

--- Hand over the engine table. A test passes a stub.
function M.use(engine)
	Spring = engine.Spring
end

-- Orders not yet sent: { unitID, params, tag, builders = unitID[], seen, group }.
-- Orders with the same group, the sides of one ring of wall, go together: a
-- raise is measured from the ground as it is when ordered, and the sides share
-- their corners (#4816).
local pending = {}

--- Forget every held order, for a test.
function M.reset()
	pending = {}
end

--- How many orders are held.
function M.count()
	return #pending
end

--- Whether a terraform order from a plan has to go now, because its level step
-- will be at most M.AHEAD commands from the front of some builder's queue as
-- soon as the plan's orders arrive. With shift the plan's orders go after what
-- each builder already has queued.
-- @param t table a plan's terraform entry: { unitID, params, tag, levelAt =
--   { { unitID, index } } with index the level step's place in that builder's
--   orders }
-- @param shift boolean
function M.near(t, shift)
	for _, at in ipairs(t.levelAt or {}) do
		local queued = shift and (Spring.GetUnitCommandCount(at.unitID) or 0) or 0
		if queued + at.index - 1 <= M.AHEAD then
			return true
		end
	end
	return false
end

--- Hold a terraform order until a builder nears its level step.
function M.add(t)
	local builders = {}
	for _, at in ipairs(t.levelAt or {}) do
		builders[#builders + 1] = at.unitID
	end
	pending[#pending + 1] = { unitID = t.unitID, params = t.params, tag = t.tag, builders = builders, seen = false, group = t.group }
end

--- The tags of the level steps near the front of a builder's queue: those with
-- at most M.AHEAD buildings ahead of them.
local function nearTags(unitID)
	local tags, ahead, i = {}, 0, 1
	while true do
		-- the id, options and tag of the command, then its parameters
		local id, _, _, _, _, _, tag = Spring.GetUnitCurrentCommand(unitID, i)
		if not id then
			break
		end
		if id == M.CMD_LEVEL then
			tags[#tags + 1] = tag
		elseif not (TERRAFORM_WORK[id] or STEPPING[id]) then
			ahead = ahead + 1
			if ahead > M.AHEAD then
				break
			end
		end
		i = i + 1
	end
	return tags
end

--- Whether a builder's queue holds a level step with a tag anywhere.
-- @return boolean? nil for a builder that is gone
local function holds(unitID, tag)
	local n = Spring.GetUnitCommandCount(unitID)
	if not n then
		return nil
	end
	for i = 1, n do
		local id, _, _, _, _, _, t = Spring.GetUnitCurrentCommand(unitID, i)
		if id == M.CMD_LEVEL and t == tag then
			return true
		end
	end
	return false
end

-- The order goes to the builder that is nearly there, which is alive, since
-- the one the plan named may since have died.
local function send(p, unitID)
	Spring.GiveOrderToUnit(unitID, M.CMD_TERRAFORM_INTERNAL, p.params, 0)
end

--- Send the held orders whose level step a builder is nearly at, and drop
-- the ones whose step has left every queue. Call it every game frame.
-- @param frame integer the game frame
function M.update(frame)
	if #pending == 0 then
		return
	end
	local near = {}
	local sweep = frame % M.SWEEP_EVERY == 0
	local keep = {}
	-- the groups sent this frame, by the builder they went to
	local goGroup = {}
	for _, p in ipairs(pending) do
		local by
		for _, unitID in ipairs(p.builders) do
			near[unitID] = near[unitID] or nearTags(unitID)
			for _, tag in ipairs(near[unitID]) do
				if tag == p.tag then
					by = by or unitID
				end
			end
		end
		if by then
			send(p, by)
			if p.group then
				goGroup[p.group] = by
			end
		elseif sweep then
			-- held until its level step has reached a queue, since the plan's
			-- orders arrive a frame or more after they are given, and dropped
			-- once it has left every queue, or every builder is gone
			local found, alive = false, false
			for _, unitID in ipairs(p.builders) do
				local h = holds(unitID, p.tag)
				alive = alive or h ~= nil
				found = found or h == true
			end
			p.seen = p.seen or found
			if found or (alive and not p.seen) then
				keep[#keep + 1] = p
			end
		else
			keep[#keep + 1] = p
		end
	end
	-- the rest of a group goes with the first of it
	local still = {}
	for _, p in ipairs(keep) do
		if p.group and goGroup[p.group] then
			send(p, goGroup[p.group])
		else
			still[#still + 1] = p
		end
	end
	pending = still
end

--- Send every held order whose level step is still queued, for when the
-- widget stops, so its builders do not reach steps the gadget never heard of.
function M.flush()
	for _, p in ipairs(pending) do
		for _, unitID in ipairs(p.builders) do
			if holds(unitID, p.tag) then
				send(p, unitID)
				break
			end
		end
	end
	pending = {}
end

return M
