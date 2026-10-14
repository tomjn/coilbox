-- Coilbox rewind player: the aim stage (issue #3796).
--
-- Nothing fires in a playback, so left alone a turret points wherever the
-- unit's own script left it. The track has the pose of every aiming piece: the
-- three turns and three offsets a unit script passes to `Turn` and `Move`
-- (docs/reference/replay-track-format.md, pose tracks). This stage sets them on
-- the engine's units, on every frame, at the time the player shows.
--
-- One path poses a piece of a unit with a COB script and of one with a Lua
-- script (the spike on issue #3791, run on both):
--
--   Spring.UnitScript.CallAsUnit(unitID, fn)   runs fn as that unit's script
--   Spring.UnitScript.Turn(piece, axis, angle)  inside it, at once, in radians
--   Spring.UnitScript.Move(piece, axis, offset) inside it, at once, in elmos
--
-- `Turn` and `Move` go straight to CUnitScript::TurnNow and MoveNow, past the
-- sign changes a COB script's own numbers get, so the track's values are passed
-- as they are for both kinds of unit. The piece is the script's number for it,
-- which is `Spring.GetUnitScriptNames(unitID)[name] + 1`, and not the model's
-- number, which differs on a COB unit. The stage calls `CallAsUnit` once for a
-- unit and poses all its pieces inside the one call.
--
-- The unit's own script goes on running, and would turn an aiming piece back.
-- In a frame the engine runs the gadgets' GameFrame, then the unit scripts, then
-- the gadgets' GameFramePost, so a pose that is set from GameFramePost is the
-- one that is drawn. The stage poses in `afterSim`, which is that call. Where
-- the call does not reach the player (issue #4002) it poses in `place`, which
-- is GameFrame, and a script that moves the piece later in the frame wins.
--
-- Only the pieces the track names for a unit's definition are touched. Legs,
-- wheels and anything else are the script's. A piece the track names and has no
-- pose track for in a window is at rest for the whole of that window, which the
-- format page says, so it is set to no turn and no offset.
--
-- A frame of play allocates nothing. A unit's piece numbers are looked up once,
-- in the frame the units stage makes it, and kept until the unit goes. The one
-- function `CallAsUnit` is given is made when the stage is.
--
-- A unit is never given a target to aim itself at. See "Units with no recorded
-- poses" in lua/rewind-player/README.md for why.
--
-- A unit's walk can turn a piece the track has poses for (issue #3797). The
-- animation stage finds those turns and moves when a unit of a definition is
-- first told that it moves, and writes them into `free`. This stage leaves
-- them to the unit's own script, and sets the rest of the piece's pose.

local M = {}

local Aim = {}
Aim.__index = Aim

--- An angle of the track is in 65,536ths of a turn, and is not reduced to one
-- turn. The engine's numbers are 32 bit floats, so the whole turns are taken
-- off before the angle is made radians.
local STEPS = 65536
local RADIANS = 2 * math.pi / STEPS

--- `context` is the player's (see coilbox_player.lua). `units` is the units
-- stage, whose `unitOf`, `indexOf`, `window` and `made` this reads.
function M.new(context, units)
	local Spring = context.Spring
	local UnitScript = Spring.UnitScript
	-- The posed piece names of a unit definition, by its place in the track's
	-- list of definitions.
	local names = {}
	for _, posed in ipairs(context.info.posedPieces or {}) do
		names[posed.unitDef + 1] = posed.pieces
	end
	local self = setmetatable({
		context = context,
		units = units,
		post = context.post,
		names = names,
		getScriptNames = Spring.GetUnitScriptNames,
		callAsUnit = UnitScript.CallAsUnit,
		-- The engine's unit a serial number's pieces were looked up for, and the
		-- script's number for each posed piece of its definition, in the order the
		-- track names them. False for a piece the script does not have.
		unitID = {},
		pieces = {},
		-- The window and the time of the frame that is being shown.
		window = nil,
		t = nil,
		pose = { 0, 0, 0, 0, 0, 0 },
		-- Which of a unit's posed pieces had a track, while it is being posed.
		seen = {},
		-- By a definition's place in the track's list and then by posed piece:
		-- six flags, true for a turn about x, y or z and a move along x, y or z
		-- that is the script's. The animation stage fills it in.
		free = {},
		-- The flags of the unit that `poseUnit` is to pose, or nil for none.
		frees = nil,
		-- What `poseUnit` is to pose: the unit's piece numbers and its pose tracks.
		numbers = nil,
		first = 0,
		count = 0,
	}, Aim)

	local turn, move = UnitScript.Turn, UnitScript.Move
	local pose, seen = self.pose, self.seen
	--- Poses every piece of one unit. It runs inside `CallAsUnit`, as that unit.
	self.poseUnit = function()
		local w, t, numbers, frees = self.window, self.t, self.numbers, self.frees
		local posePiece = w.posePiece
		for track = self.first, self.first + self.count - 1 do
			local k = posePiece[track] + 1
			local piece = numbers[k]
			if piece and w:samplePose(track, t, pose) then
				seen[k] = true
				local free = frees and frees[k]
				if free then
					-- Part of this piece's pose is the walk's.
					for axis = 1, 3 do
						if not free[axis] then
							turn(piece, axis, (pose[axis] % STEPS) * RADIANS)
						end
						if not free[axis + 3] then
							move(piece, axis, pose[axis + 3])
						end
					end
				else
					turn(piece, 1, (pose[1] % STEPS) * RADIANS)
					turn(piece, 2, (pose[2] % STEPS) * RADIANS)
					turn(piece, 3, (pose[3] % STEPS) * RADIANS)
					move(piece, 1, pose[4])
					move(piece, 2, pose[5])
					move(piece, 3, pose[6])
				end
			end
		end
		-- A piece with no track in this window is at rest.
		for k = 1, #numbers do
			if seen[k] then
				seen[k] = false
			else
				local piece = numbers[k]
				local free = frees and frees[k]
				if piece and free then
					for axis = 1, 3 do
						if not free[axis] then
							turn(piece, axis, 0)
						end
						if not free[axis + 3] then
							move(piece, axis, 0)
						end
					end
				elseif piece then
					turn(piece, 1, 0)
					turn(piece, 2, 0)
					turn(piece, 3, 0)
					move(piece, 1, 0)
					move(piece, 2, 0)
					move(piece, 3, 0)
				end
			end
		end
	end
	return self
end

--- Looks up the script's piece numbers of a unit the units stage has made.
local function learn(self, serial, unitID, def)
	self.unitID[serial] = unitID
	self.pieces[serial] = nil
	local names = self.names[def]
	if not names then
		return
	end
	local script = self.getScriptNames(unitID)
	if not script then
		return
	end
	local numbers, seen = {}, self.seen
	for k = 1, #names do
		local number = script[names[k]]
		numbers[k] = number and number + 1 or false
		-- Made here, so that posing never makes the table grow.
		seen[k] = seen[k] or false
		if not number then
			local unitName = self.context.info.unitDefs[def]
			self.context.report(
				"aim piece " .. unitName .. " " .. names[k],
				"the script of " .. unitName .. " has no piece called " .. names[k] .. ", which the track has poses for, so that piece is left to the unit's own script"
			)
		end
	end
	self.pieces[serial] = numbers
end

--- Sets every posed piece of every unit of the track to its pose at the time
-- shown.
local function poseAll(self)
	local units, w = self.units, self.window
	if not w then
		return
	end
	local unitOf, indexOf, known = units.unitOf, units.indexOf, self.unitID
	local callAsUnit, poseUnit, t = self.callAsUnit, self.poseUnit, self.t
	local firsts, counts, defs, free = w.unitPoseFirst, w.unitPoseCount, w.unitDef, self.free
	for serial, numbers in next, self.pieces do
		local unitID, i = unitOf[serial], indexOf[serial]
		if unitID and i and unitID == known[serial] and w:unitExistsAt(i, t) then
			self.numbers, self.first, self.count = numbers, firsts[i], counts[i]
			self.frees = free[defs[i] + 1]
			callAsUnit(unitID, poseUnit)
		end
	end
end

function Aim:resync() end

function Aim:remove() end

--- Learns the pieces of the units the units stage has just made, which is the
-- frame a unit appears in. With no call at the end of a frame to pose from, it
-- poses here.
function Aim:place(t, clock)
	local units = self.units
	local w = units.window
	local changed = w ~= self.window
	self.window, self.t = w, t
	if not w then
		return
	end
	if changed or clock.jumped or units.made > 0 then
		local unitOf, known = units.unitOf, self.unitID
		if changed or clock.jumped then
			-- A unit that has gone since it was learnt.
			for serial, unitID in next, known do
				if unitOf[serial] ~= unitID then
					known[serial] = nil
					self.pieces[serial] = nil
				end
			end
		end
		local serials, defs = w.unitSerial, w.unitDef
		for i = 1, w.unitCount do
			local serial = serials[i]
			local unitID = unitOf[serial]
			if unitID and known[serial] ~= unitID then
				learn(self, serial, unitID, defs[i] + 1)
			end
		end
	end
	if not self.post.arrives then
		poseAll(self)
	end
end

--- The end of a simulation frame, after the unit scripts have run
-- (GameFramePost): the pose set here is the one that is drawn.
function Aim:afterSim()
	poseAll(self)
end

--- The player found that no call comes at the end of a frame (issue #4002).
function Aim:withoutAfterSim()
	self.context.report(
		"aim post",
		"GameFramePost does not reach the player, so aiming pieces are posed from GameFrame, where a unit's own script can move a piece again before the frame is drawn"
	)
end

return M
