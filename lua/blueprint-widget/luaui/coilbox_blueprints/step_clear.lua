-- Keeping a builder clear of a step's ground while it works on it (#4816).
--
-- Placing sends each builder to a clear spot before a step's level command, but
-- one spot does not reach every part of a big step, such as a ring of wall.
-- Zero-K's gadget (unit_terraform.lua) then has the builder repair the
-- terraform unit nearest to it, and the builder walks until that unit is in
-- range. It stops wherever that is, which is often on the step or its slope,
-- and the ground then rises under it.
--
-- So while a builder works on a step, this watches the front of its queue. When
-- it is about to walk to a terraform unit out of its range, a move to a clear
-- spot within range of that unit goes in front, the way Helwor's
-- MoveAwayFromLevelBuild.lua inserts one (line 179).

local M = {}

-- The engine's commands (CMD.REPAIR, CMD.MOVE, CMD.INSERT, CMD.OPT_ALT).
M.CMD_REPAIR = 40
M.CMD_MOVE = 10
M.CMD_INSERT = 1
M.OPT_ALT = 128
-- Zero-K's level command and raw build (LuaRules/Configs/customcmds.lua). Zero-K
-- puts a raw build in front of a repair to walk the builder into range
-- (cmd_raw_move.lua, CheckConstructorBuild).
M.CMD_LEVEL = 39736
M.CMD_RAW_BUILD = 31110
-- How often, in game frames, the watched builders are checked for a step that
-- has left their queue.
M.SWEEP_EVERY = 30

local Spring, UnitDefs

--- Hand over the engine tables. A test passes a stub.
function M.use(engine)
	Spring = engine.Spring
	UnitDefs = engine.UnitDefs
end

-- unitID -> { tag -> { spots, range, stop, apart, defID } }
local watched = {}
-- unitID -> the terraform unit a move was last inserted for, so a builder that
-- still cannot reach it from the spot is not sent again and again
local sentFor = {}
-- unitID -> { x, z } the spot each builder was last sent to
local goals = {}

--- Forget everything, for a test.
function M.reset()
	watched, sentFor, goals = {}, {}, {}
end

--- How many builders are watched.
function M.count()
	local n = 0
	for _ in pairs(watched) do
		n = n + 1
	end
	return n
end

--- Watch a builder while it works on a step.
-- @param unitID integer
-- @param tag number the step's terraform tag, as its level command carries it
-- @param w table { spots = from place.lua's M.clearSpots, range = build range,
--   stop = how far short of a move's goal it may stop, apart = how far its spot
--   must be from another builder's, defID, stand = function(defID, x, z) ->
--   whether the builder can stand there }
function M.watch(unitID, tag, w)
	watched[unitID] = watched[unitID] or {}
	watched[unitID][tag] = w
end

local function isTerraunit(unitID)
	local def = UnitDefs[Spring.GetUnitDefID(unitID) or -1]
	return def ~= nil and def.name == "terraunit"
end

--- The spot for a builder to stand at to reach a terraform unit: within range
-- of where the unit is, less how far short the move may stop, not near another
-- builder's spot, on ground the builder can stand on, and the nearest to the
-- builder. The gadget pulls a unit towards the builder working on it only when
-- it next checks that builder, which for each builder is once in 1200 frames
-- (unit_terraform.lua, checkLoopFrames), so the unit is taken to stay put.
local function spotFor(unitID, w, bx, bz, tx, tz)
	local reach = w.range - w.stop
	local best, bestD
	for _, s in ipairs(w.spots) do
		if (s.x - tx) ^ 2 + (s.z - tz) ^ 2 <= reach * reach then
			local d = (s.x - bx) ^ 2 + (s.z - bz) ^ 2
			if not bestD or d < bestD then
				local free = true
				for other, g in pairs(goals) do
					if other ~= unitID and (g.x - s.x) ^ 2 + (g.z - s.z) ^ 2 < w.apart * w.apart then
						free = false
					end
				end
				if free and (not w.stand or w.stand(w.defID, s.x, s.z)) then
					best, bestD = s, d
				end
			end
		end
	end
	return best
end

--- Whether a builder's queue still holds a level command with a tag.
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

--- Check every watched builder. Call it every game frame.
-- @param frame integer the game frame
function M.update(frame)
	for unitID, steps in pairs(watched) do
		-- Zero-K walks a builder into range with a raw build in front of the
		-- repair, so the repair can be second
		local at = 1
		local id, _, _, target = Spring.GetUnitCurrentCommand(unitID, 1)
		if id == M.CMD_RAW_BUILD then
			at = 2
			id, _, _, target = Spring.GetUnitCurrentCommand(unitID, 2)
		end
		local nextID, _, _, _, _, _, tag = Spring.GetUnitCurrentCommand(unitID, at + 1)
		local w = nextID == M.CMD_LEVEL and steps[tag] or nil
		if id == M.CMD_REPAIR and w and target and sentFor[unitID] ~= target and isTerraunit(target) then
			local bx, _, bz = Spring.GetUnitPosition(unitID)
			local tx, _, tz = Spring.GetUnitPosition(target)
			if bx and tx and (bx - tx) ^ 2 + (bz - tz) ^ 2 > w.range * w.range then
				sentFor[unitID] = target
				local spot = spotFor(unitID, w, bx, bz, tx, tz)
				if spot then
					goals[unitID] = spot
					Spring.GiveOrderToUnit(unitID, M.CMD_INSERT, { 0, M.CMD_MOVE, 0, spot.x, Spring.GetGroundHeight(spot.x, spot.z), spot.z }, M.OPT_ALT)
				end
			end
		end
	end
	if frame % M.SWEEP_EVERY == 0 then
		-- a step is kept until its level command has reached the queue, since
		-- orders arrive a frame or more after they are given, and dropped once it
		-- has left, or the builder is gone
		for unitID, steps in pairs(watched) do
			local any = false
			for tag, w in pairs(steps) do
				local h = holds(unitID, tag)
				w.seen = w.seen or h == true
				if h or (h == false and not w.seen) then
					any = true
				else
					steps[tag] = nil
				end
			end
			if not any then
				watched[unitID], sentFor[unitID], goals[unitID] = nil, nil, nil
			end
		end
	end
end

return M
