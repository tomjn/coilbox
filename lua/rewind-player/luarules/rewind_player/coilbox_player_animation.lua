-- Coilbox rewind player: the animation stage (issue #3797).
--
-- A unit of a playback is held under move control and put where the track has
-- it, so its own script does not know that it moves, and the engine tells it
-- nothing: the move type of a unit under move control calls no script function
-- (CScriptMoveType in rts/Sim/MoveTypes). A unit slides with its legs still and
-- a builder does not turn to its work. This stage tells the script what the
-- engine would have told it, from the track:
--
--   StartMoving(reversing)         a unit's place starts to change
--   StopMoving()                   and stops
--   StartBuilding(heading, pitch)  a builder starts work, or works on something
--                                  else. A factory is given no angles
--   StopBuilding()                 and stops
--
-- A script is told on a change and never on every frame. It is told in
-- GameFrame, before the engine runs the unit scripts of the frame.
--
-- How a script is run depends on its kind, and the stage finds the kind once
-- for a unit:
--
-- - A Lua script exists because the game's script framework handed its
--   call-ins to the engine with Spring.UnitScript.CreateScript. The gadget
--   wraps that call as its file loads and keeps the table for each unit
--   (`context.scriptCallIns`), and a call-in is run with
--   Spring.UnitScript.CallAsUnit, which is how the engine itself runs one.
--   Nothing is asked of the game.
-- - Any other unit is asked for the number of each function with
--   Spring.GetCOBScriptID, which gives nothing for a unit with no COB script,
--   and a function it has is run with Spring.CallCOBScript. A COB script takes
--   whole numbers: 0 or 1 for reversing, and an angle in 65,536ths of a turn.
-- - A unit that is neither is told nothing.
--
-- A script that raises is logged once for the definition and that function of
-- that unit is not run again.
--
-- A unit also has the velocity it is shown moving at: the track's, which is
-- the slope of its place between two keys, times the direction and the speed
-- of play, and nothing while paused. A script that reads its own speed, and
-- anything else that asks the engine, reads that. The engine moves a unit
-- under move control by its velocity on every frame unless it is told not to
-- (CScriptMoveType::Update), and the track owns a unit's place, so each unit
-- is told not to once (Spring.MoveCtrl.SetExtrapolate).
--
-- What plays when:
--
-- - Paused, the time stands still, so a moving unit is told that it stopped
--   and has no velocity. A script cannot be held in the middle of a step.
-- - Backward, a unit moves against the way it faces, which is what the engine
--   means by reversing, so its script is told that it moves and that it
--   reverses. A script cannot be run backward. One that has no animation of
--   its own for reversing plays its walk.
-- - At any speed a script is told the same. Its animation runs at the engine's
--   pace, and the velocity says how fast the ground goes by.
-- - A seek tells a unit nothing by itself. What it is told follows from where
--   the track has it afterwards.
-- - A builder's work does not follow the clock. It is what the track has at
--   the time shown, paused and backward too, so a paused builder goes on
--   facing what it was building.
--
-- A builder's work is also published in unit rules parameters (`M.PARAMS`),
-- for a game's own build effect to read. The command and the target are what
-- Spring.GetUnitWorkerTask answers in a match.
--
-- The engine draws a builder's stream of build particles only while the
-- builder really builds (issue #4029), so the unsynced half of the gadget
-- draws it, and this stage hands it each change of a builder's work
-- (`context.work`). The stream starts at the builder's nano pieces, which the
-- engine keeps and fills by asking the script only while a builder really
-- builds. So the first time a unit works, the stage asks its script the
-- engine's way and gives the engine what it found, unless the script gave its
-- own, as Splinter Faction's do.
--
-- The aim stage sets the pieces the track has poses for at the end of every
-- frame, and a walk can turn one of those too: the track of the match this was
-- written on has the right leg of one unit, because the recorder took a piece
-- on it for a muzzle (issue #3941). That leg would follow the recording and
-- the other the script. So the first time a unit of a definition is told that
-- it moves, the stage asks which turns and moves of the posed pieces the
-- script started in answer (Spring.UnitScript.IsInTurn and IsInMove, before
-- and after). Those are the walk's, and the aim stage leaves them to the
-- script from then on, for every unit of the definition.
--
-- A frame of play allocates nothing here. A call into a Lua script allocates
-- whatever that script does.

local M = {}

local Animation = {}
Animation.__index = Animation

--- The unit rules parameters a builder's work is published in.
M.PARAMS = {
	-- What Spring.GetUnitWorkerTask gives first in a match: minus the unit
	-- definition's id while building one, CMD.REPAIR, CMD.RECLAIM,
	-- CMD.RESURRECT, CMD.CAPTURE or CMD.RESTORE, and 0 for no work.
	command = "coilbox_rewind_work_command",
	-- What it gives second: the playback's unit id of what is worked on, or the
	-- playback's feature id plus Game.maxUnits. -1 when there is none, or when
	-- the playback does not have it.
	target = "coilbox_rewind_work_target",
	-- The build power in use, from 0 to 1.
	power = "coilbox_rewind_work_power",
	-- Where the work is, in elmos, as it was when the command or the target last
	-- changed.
	x = "coilbox_rewind_work_x",
	y = "coilbox_rewind_work_y",
	z = "coilbox_rewind_work_z",
}

--- The speed above which the engine takes a unit to be moving, in elmos a
-- frame (CGroundMoveType::UpdateOwnerSpeed), squared.
local MOVING = 0.01 * 0.01

--- A half turn in what a COB script takes for an angle (RAD2TAANG).
local COB_HALF_TURN = 32768

--- How many asks in a row the engine lets give no new nano piece before it
-- stops asking a builder's script (MAX_QUERYNANOPIECE_CALLS in
-- rts/Sim/Misc/NanoPieceCache.h).
local QUIET_ASKS = 30

--- The kinds of work a track has (the format page, target tracks).
local BUILD, RECLAIM_UNIT, RECLAIM_FEATURE, RESURRECT, CAPTURE, TERRAFORM = 16, 17, 18, 19, 20, 129

local atan2, asin, sqrt, floor, ceil = math.atan2, math.asin, math.sqrt, math.floor, math.ceil
local PI = math.pi

--- `context` is the player's (see coilbox_player.lua). `units` is the units
-- stage, `aim` the aim stage or nil, and `features` the features stage or nil.
function M.new(context, units, aim, features)
	local Spring, on = context.Spring, context.on
	local UnitScript = Spring.UnitScript
	local names = context.info.unitDefs
	-- By a definition's place in the track's list: the engine's id, whether a
	-- unit of it can move, and whether it is a factory.
	local defID, mobile, factory = {}, {}, {}
	for i = 1, #names do
		local def = context.UnitDefNames[names[i]]
		defID[i] = def and def.id or false
		mobile[i] = def ~= nil and not def.isImmobile
		factory[i] = def ~= nil and def.isFactory == true
	end
	local scripts = on.unitScripts
	local self = setmetatable({
		context = context,
		units = units,
		aim = aim,
		features = features,
		names = names,
		defID = defID,
		mobile = mobile,
		factory = factory,
		-- The calls, or nil for one that is switched off.
		callIns = scripts and context.scriptCallIns or nil,
		getCOBScriptID = scripts and Spring.GetCOBScriptID or nil,
		callCOBScript = scripts and Spring.CallCOBScript or nil,
		callAsUnit = scripts and UnitScript and UnitScript.CallAsUnit or nil,
		getUnitPosition = scripts and Spring.GetUnitPosition or nil,
		setVelocity = on.unitSpeed and Spring.MoveCtrl.SetVelocity or nil,
		setExtrapolate = on.unitSpeed and Spring.MoveCtrl.SetExtrapolate or nil,
		setParam = on.builderWork and Spring.SetUnitRulesParam or nil,
		-- Hands a change of a builder's work to the stream, or nil.
		signal = context.work,
		setNano = scripts and on.nanoPieces and Spring.SetUnitNanoPieces or nil,
		getNano = scripts and on.nanoPieces and Spring.GetUnitNanoPieces or nil,
		scriptPiece = scripts and on.nanoPieces and Spring.GetUnitScriptPiece or nil,
		probing = on.walkPieces and aim ~= nil and aim.free ~= nil,
		maxUnits = context.Game.maxUnits,
		-- The engine's commands for the kinds of work.
		repair = context.CMD.REPAIR,
		reclaim = context.CMD.RECLAIM,
		resurrect = context.CMD.RESURRECT,
		capture = context.CMD.CAPTURE,
		restore = context.CMD.RESTORE,
		-- The engine's unit a serial number's state is for.
		unitID = {},
		-- A unit's script functions: a function of a Lua script, the number of a
		-- COB script's, or false for one the script lacks.
		startMoving = {},
		stopMoving = {},
		startBuilding = {},
		stopBuilding = {},
		queryNano = {},
		-- The unit whose nano pieces have been seen to, by serial number, and the
		-- list the asks fill, made once.
		nanoFor = {},
		nanoFound = {},
		-- What the script was last told: 0 for stopped, 1 for moving and 2 for
		-- reversing.
		told = {},
		-- The velocity the engine was last given.
		vx = {},
		vy = {},
		vz = {},
		-- A builder's work as last published, and the work its script was last
		-- told of: the track's kind, 0 for none, and what it is done to, as a
		-- unit's serial number or a feature's place in the track's list. The two
		-- are kept apart, since the engine's numbers are 32 bit floats, which
		-- cannot tell one large number from the next.
		command = {},
		target = {},
		power = {},
		jobKind = {},
		jobOn = {},
		-- The builders of the window: each one's place in the window's lists and
		-- its target track.
		window = nil,
		builders = {},
		builderTrack = {},
		builderCount = 0,
		listed = {},
		-- The definitions whose walk has been asked about.
		walked = {},
		direction = 1,
		velocity = { 0, 0, 0 },
		transform = { 0, 0, 0, 0, 0, 0, 0 },
		status = { 0, 0, 0 },
		work = { 0, 0, 0, 0, 0, 0 },
		site = { 0, 0, 0 },
		-- What `probe` is to look at, and what it found before the unit was told.
		probeNumbers = nil,
		probeBefore = {},
		probeDef = 0,
		probeFound = false,
	}, Animation)

	local isInTurn, isInMove = UnitScript and UnitScript.IsInTurn, UnitScript and UnitScript.IsInMove
	local before = self.probeBefore
	--- Notes which turns and moves of the posed pieces are running. It runs
	-- inside `CallAsUnit`, as the unit.
	self.probeFirst = function()
		local numbers = self.probeNumbers
		for k = 1, #numbers do
			local piece = numbers[k]
			for axis = 1, 3 do
				before[(k - 1) * 6 + axis] = piece and isInTurn(piece, axis) or false
				before[(k - 1) * 6 + 3 + axis] = piece and isInMove(piece, axis) or false
			end
		end
	end
	--- Leaves to the script each turn and move that is running now and was not
	-- before, which the script started when it was told its unit moves.
	self.probeSecond = function()
		local numbers = self.probeNumbers
		local free = aim.free[self.probeDef]
		for k = 1, #numbers do
			local piece = numbers[k]
			if piece then
				for axis = 1, 3 do
					local turns = isInTurn(piece, axis) and not before[(k - 1) * 6 + axis]
					local moves = isInMove(piece, axis) and not before[(k - 1) * 6 + 3 + axis]
					if turns or moves then
						if not free then
							free = {}
							aim.free[self.probeDef] = free
						end
						free[k] = free[k] or { false, false, false, false, false, false }
						if turns then
							free[k][axis] = true
						end
						if moves then
							free[k][3 + axis] = true
						end
						self.probeFound = true
					end
				end
			end
		end
	end
	return self
end

--- Runs a function of a unit's script with `count` arguments. A script that
-- raises is logged, and gives false.
local function run(self, unitID, def, name, fn, count, a, b)
	local ok, why
	if type(fn) == "number" then
		local call = self.callCOBScript
		if count == 0 then
			ok, why = pcall(call, unitID, fn, 0)
		elseif count == 1 then
			ok, why = pcall(call, unitID, fn, 0, a)
		else
			ok, why = pcall(call, unitID, fn, 0, a, b)
		end
	else
		ok, why = pcall(self.callAsUnit, unitID, fn, a, b)
	end
	if not ok then
		local unitName = self.names[def]
		self.context.report(
			"script " .. unitName .. " " .. name,
			"the script of " .. unitName .. " raised in " .. name .. ", so that function of that unit is not run again: " .. tostring(why) .. ". Later ones are not logged"
		)
	end
	return ok
end

--- Finds a unit's script, once, and tells the engine not to move the unit by
-- its velocity.
local function learn(self, serial, unitID)
	self.unitID[serial] = unitID
	self.told[serial] = 0
	self.vx[serial], self.vy[serial], self.vz[serial] = 0, 0, 0
	self.command[serial], self.target[serial], self.power[serial] = nil, nil, nil
	self.jobKind[serial], self.jobOn[serial] = 0, 0
	if self.setExtrapolate then
		self.setExtrapolate(unitID, false)
	end
	local lua = self.callIns and self.callAsUnit and self.callIns[unitID]
	local cob = self.getCOBScriptID
	if lua then
		self.startMoving[serial] = lua.StartMoving or false
		self.stopMoving[serial] = lua.StopMoving or false
		self.startBuilding[serial] = lua.StartBuilding or false
		self.stopBuilding[serial] = lua.StopBuilding or false
		self.queryNano[serial] = lua.QueryNanoPiece or false
	elseif cob and self.callCOBScript then
		self.startMoving[serial] = cob(unitID, "StartMoving") or false
		self.stopMoving[serial] = cob(unitID, "StopMoving") or false
		self.startBuilding[serial] = cob(unitID, "StartBuilding") or false
		self.stopBuilding[serial] = cob(unitID, "StopBuilding") or false
		self.queryNano[serial] = cob(unitID, "QueryNanoPiece") or false
	else
		self.startMoving[serial], self.stopMoving[serial] = false, false
		self.startBuilding[serial], self.stopBuilding[serial] = false, false
		self.queryNano[serial] = false
	end
end

--- Gives the engine a builder's nano pieces, once for a unit. The engine asks
-- the script for one each time it makes a particle, until QUIET_ASKS asks in a
-- row have given none it had (NanoPieceCache::GetNanoPiece), and here those
-- asks are made at once. A script's piece is turned into the model's, which is
-- what the engine keeps. A script that gave its own is left alone.
local function nanoPieces(self, unitID, serial, def)
	if self.nanoFor[serial] == unitID then
		return
	end
	self.nanoFor[serial] = unitID
	local query = self.queryNano[serial]
	if not query or not self.setNano or self.getNano(unitID) then
		return
	end
	local found, count, quiet = self.nanoFound, 0, 0
	while quiet <= QUIET_ASKS do
		local ok, piece, given
		if type(query) == "number" then
			-- The script puts its piece, counted from 0, in its one argument.
			ok, piece, given = pcall(self.callCOBScript, unitID, query, 1, -1)
			piece = given
		else
			-- A Lua script gives its piece counted from 1
			-- (CLuaUnitScript::RunQueryCallIn).
			ok, piece = pcall(self.callAsUnit, unitID, query)
			piece = type(piece) == "number" and piece - 1 or nil
		end
		if not ok then
			local unitName = self.names[def]
			self.context.report(
				"script " .. unitName .. " QueryNanoPiece",
				"the script of " .. unitName .. " raised in QueryNanoPiece, so the engine has the nano pieces it gave before that: " .. tostring(piece) .. ". Later ones are not logged"
			)
			break
		end
		local model = type(piece) == "number" and self.scriptPiece(unitID, piece) or nil
		local new = model ~= nil
		for k = 1, count do
			if found[k] == model then
				new = false
				break
			end
		end
		if new then
			count = count + 1
			found[count] = model
			quiet = 0
		else
			quiet = quiet + 1
		end
	end
	for k = #found, count + 1, -1 do
		found[k] = nil
	end
	if count > 0 then
		self.setNano(unitID, found)
	end
end

--- Tells a unit's script that the unit moves, and the first time for a
-- definition asks which posed pieces its walk turns.
local function tellMoving(self, serial, unitID, def, state)
	self.told[serial] = state
	local fn = self.startMoving[serial]
	if not fn then
		return
	end
	local numbers = self.probing and not self.walked[def] and self.aim.pieces[serial]
	if numbers then
		self.probeNumbers, self.probeDef, self.probeFound = numbers, def, false
		numbers = pcall(self.callAsUnit, unitID, self.probeFirst)
	end
	if not run(self, unitID, def, "StartMoving", fn, 1, state == 2 and 1 or 0) then
		self.startMoving[serial] = false
		return
	end
	self.walked[def] = true
	if numbers and pcall(self.callAsUnit, unitID, self.probeSecond) and self.probeFound then
		local posed, free, turned = self.aim.names[def], self.aim.free[def], {}
		for k = 1, #posed do
			if free[k] then
				turned[#turned + 1] = posed[k]
			end
		end
		self.context.report(
			"walk " .. self.names[def],
			"the walk of " .. self.names[def] .. " turns " .. table.concat(turned, ", ") .. ", which the track has poses for, so those turns are left to the unit's own script and the rest of each piece's pose is the track's"
		)
	end
end

local function tellStopped(self, serial, unitID, def)
	self.told[serial] = 0
	local fn = self.stopMoving[serial]
	if fn and not run(self, unitID, def, "StopMoving", fn, 0) then
		self.stopMoving[serial] = false
	end
end

--- Whether a unit shown moving by `vx, vz` moves against the way it faces.
local function reversing(self, w, i, t, vx, vz)
	local q = self.transform
	if not w:sampleTransform(i, t, q) then
		return false
	end
	local x, y, z, u = q[4], q[5], q[6], q[7]
	-- The front a track's quaternion stands for.
	return vx * 2 * (x * z + u * y) + vz * (1 - 2 * (x * x + y * y)) < 0
end

--- The velocity and the moving state of unit `i`, which exists and is the
-- engine's `unitID`. `rate` is the frames of the track a frame of play covers,
-- with its sign, and 0 while paused.
local function move(self, w, i, t, serial, unitID, def, rate, flipped)
	local v = self.velocity
	local x, y, z = 0, 0, 0
	local moving = false
	if rate ~= 0 and not self.units.nanoframe[serial] and w:sampleVelocity(i, t, v) then
		x, y, z = v[1], v[2], v[3]
		moving = x * x + y * y + z * z > MOVING
		x, y, z = x * rate, y * rate, z * rate
	end
	if self.setVelocity and (x ~= self.vx[serial] or y ~= self.vy[serial] or z ~= self.vz[serial]) then
		self.vx[serial], self.vy[serial], self.vz[serial] = x, y, z
		self.setVelocity(unitID, x, y, z)
	end
	local told = self.told[serial]
	if moving then
		if told == 0 or flipped then
			local state = reversing(self, w, i, t, x, z) and 2 or 1
			if state ~= told then
				tellMoving(self, serial, unitID, def, state)
			end
		end
	elseif told ~= 0 then
		tellStopped(self, serial, unitID, def)
	end
end

--- Tells a builder's script that it starts work at the place in `self.site`.
-- The angles are the engine's (CBuilder::ScriptStartBuilding): the heading
-- from the unit's facing to the place, and the pitch from its middle up to it.
local function tellBuilding(self, w, i, t, serial, unitID, def)
	local fn = self.startBuilding[serial]
	if not fn then
		return
	end
	if self.factory[def] then
		if not run(self, unitID, def, "StartBuilding", fn, 0) then
			self.startBuilding[serial] = false
		end
		return
	end
	local q, place = self.transform, self.site
	local _, _, _, mx, my, mz = self.getUnitPosition(unitID, true)
	if not mx or not w:sampleTransform(i, t, q) then
		return
	end
	local dx, dy, dz = place[1] - mx, place[2] - my, place[3] - mz
	local length = sqrt(dx * dx + dy * dy + dz * dz)
	if length == 0 then
		return
	end
	dx, dy, dz = dx / length, dy / length, dz / length
	local x, y, z, u = q[4], q[5], q[6], q[7]
	-- The front and the up a track's quaternion stands for.
	local fx, fz = 2 * (x * z + u * y), 1 - 2 * (x * x + y * y)
	local ux, uy, uz = 2 * (x * y - u * z), 1 - 2 * (x * x + z * z), 2 * (y * z + u * x)
	local heading = atan2(dx, dz) - atan2(fx, fz)
	if heading > PI then
		heading = heading - 2 * PI
	elseif heading < -PI then
		heading = heading + 2 * PI
	end
	local pitch = asin(math.max(-1, math.min(1, dx * ux + dy * uy + dz * uz)))
	if type(fn) == "number" then
		-- Cut to a whole number the way the engine cuts it (RadAngleToCobShort).
		heading, pitch = heading * COB_HALF_TURN / PI, pitch * COB_HALF_TURN / PI
		heading = heading < 0 and ceil(heading) or floor(heading)
		pitch = pitch < 0 and ceil(pitch) or floor(pitch)
	end
	if not run(self, unitID, def, "StartBuilding", fn, 2, heading, pitch) then
		self.startBuilding[serial] = false
	end
end

--- Publishes a builder's work and tells its script of a change. `kind` is the
-- track's kind of work, 0 for none, `on` what it is done to, and `self.site`
-- is where the work is.
local function labour(self, w, i, t, serial, unitID, def, kind, on, command, target, power, again)
	local set, P = self.setParam, M.PARAMS
	local had = self.command[serial]
	local changed = command ~= had or target ~= self.target[serial]
	local powered = power ~= self.power[serial]
	if kind ~= 0 and self.setNano then
		nanoPieces(self, unitID, serial, def)
	end
	if changed then
		self.command[serial], self.target[serial] = command, target
		if set then
			set(unitID, P.command, command)
			set(unitID, P.target, target)
			if command ~= 0 then
				local place = self.site
				set(unitID, P.x, place[1])
				set(unitID, P.y, place[2])
				set(unitID, P.z, place[3])
			end
		end
	end
	if powered then
		self.power[serial] = power
		if set then
			set(unitID, P.power, power)
		end
	end
	-- A builder first seen with no work has nothing to stop.
	local signal = self.signal
	if signal and (changed or powered or (again and kind ~= 0)) and (command ~= 0 or (had ~= nil and had ~= 0)) then
		local place = self.site
		signal(unitID, command, target, power, place[1], place[2], place[3], t, again and 1 or 0)
	end
	if kind ~= self.jobKind[serial] or on ~= self.jobOn[serial] or (again and kind ~= 0) then
		self.jobKind[serial], self.jobOn[serial] = kind, on
		if kind ~= 0 then
			tellBuilding(self, w, i, t, serial, unitID, def)
		else
			local fn = self.stopBuilding[serial]
			if fn and not run(self, unitID, def, "StopBuilding", fn, 0) then
				self.stopBuilding[serial] = false
			end
		end
	end
end

--- The work the track has for the builder at `i` on target track `track`, put
-- through `labour`.
local function build(self, w, i, t, serial, unitID, def, track, again)
	local sample, place = self.work, self.site
	local units = self.units
	local job, on, command, target, power = 0, 0, 0, -1, 0
	if not units.nanoframe[serial] and w:sampleTarget(track, t, sample) then
		local kind, ref = sample[1], sample[2]
		if kind == BUILD or kind == RECLAIM_UNIT or kind == CAPTURE then
			if ref >= 1 and ref <= w.unitCount and w:unitExistsAt(ref, t) and w:sampleTransform(ref, t, self.transform) then
				local q = self.transform
				place[1], place[2], place[3] = q[1], q[2], q[3]
				local other = w.unitSerial[ref]
				job, on = kind, other
				target = units.unitOf[other] or -1
				if kind == RECLAIM_UNIT then
					command = self.reclaim
				elseif kind == CAPTURE then
					command = self.capture
				else
					-- The engine answers with the definition while the unit is being
					-- built and with a repair once it is finished.
					command = self.repair
					local id = self.defID[w.unitDef[ref] + 1]
					if id and w:sampleStatus(ref, t, self.status) and self.status[2] < 1 then
						command = -id
					end
				end
			end
		elseif kind == RECLAIM_FEATURE or kind == RESURRECT then
			local feature = self.context.features[ref]
			if feature then
				local at = feature.position
				place[1], place[2], place[3] = at[1], at[2], at[3]
				job, on = kind, ref
				local featureID = self.features and self.features.featureOf and self.features.featureOf[ref]
				target = featureID and featureID + self.maxUnits or -1
				command = kind == RESURRECT and self.resurrect or self.reclaim
			end
		elseif kind == TERRAFORM then
			place[1], place[2], place[3] = sample[4], sample[5], sample[6]
			job = kind
			command = self.restore
		end
		if job ~= 0 then
			power = sample[3] / 255
		end
	end
	labour(self, w, i, t, serial, unitID, def, job, on, command, target, power, again)
end

--- Makes `w` the window the list of builders is for. A builder that was at
-- work and has no track for it in this window has no work in it.
local function index(self, w)
	self.window = w
	local builders, tracks, listed = self.builders, self.builderTrack, self.listed
	for serial in next, listed do
		listed[serial] = nil
	end
	local n = 0
	local firsts, counts, weapons, serials = w.unitTargetFirst, w.unitTargetCount, w.targetWeapon, w.unitSerial
	for i = 1, w.unitCount do
		for track = firsts[i], firsts[i] + counts[i] - 1 do
			if weapons[track] == 0 then
				n = n + 1
				builders[n], tracks[n] = i, track
				listed[serials[i]] = true
			end
		end
	end
	for k = n + 1, self.builderCount do
		builders[k], tracks[k] = nil, nil
	end
	self.builderCount = n
	-- A unit that has gone since it was learnt, and a builder with no track now.
	local unitOf, indexOf = self.units.unitOf, self.units.indexOf
	for serial, unitID in next, self.unitID do
		if unitOf[serial] ~= unitID then
			self.unitID[serial] = nil
		elseif self.jobKind[serial] ~= 0 and not listed[serial] and indexOf[serial] then
			local i = indexOf[serial]
			labour(self, w, i, w.unitFirstFrame[i], serial, unitID, w.unitDef[i] + 1, 0, 0, 0, -1, 0, false)
		end
	end
end

function Animation:resync() end

function Animation:remove() end

--- Gives every unit of the track the velocity it is shown moving at, and tells
-- each script what has changed since it was last told.
function Animation:place(t, clock)
	local units = self.units
	local w = units.window
	if not w then
		return
	end
	if w ~= self.window then
		index(self, w)
	end
	local rate = clock.playing and clock.direction * clock.speed or 0
	local flipped = clock.direction ~= self.direction
	self.direction = clock.direction
	local unitOf, known = units.unitOf, self.unitID
	local serials, defs, mobile = w.unitSerial, w.unitDef, self.mobile
	for i = 1, w.unitCount do
		local def = defs[i] + 1
		if mobile[def] then
			local serial = serials[i]
			local unitID = unitOf[serial]
			if unitID and w:unitExistsAt(i, t) then
				if known[serial] ~= unitID then
					learn(self, serial, unitID)
				end
				move(self, w, i, t, serial, unitID, def, rate, flipped)
			elseif known[serial] then
				known[serial] = nil
			end
		end
	end
	local builders, tracks = self.builders, self.builderTrack
	for n = 1, self.builderCount do
		local i = builders[n]
		local serial = serials[i]
		local unitID = unitOf[serial]
		if unitID and w:unitExistsAt(i, t) then
			if known[serial] ~= unitID then
				learn(self, serial, unitID)
			end
			build(self, w, i, t, serial, unitID, defs[i] + 1, tracks[n], clock.jumped)
		elseif known[serial] then
			known[serial] = nil
		end
	end
end

return M
