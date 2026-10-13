-- Coilbox rewind recorder: writes down where everything was while a replay
-- plays back, so the match can later be shown with time going either way.
--
-- Coilbox generates a game that depends on the game a replay was recorded on,
-- and plays a scratch copy of the replay in it headless. When a run asks for a
-- recording, this file goes into that game beside the replay logger, with a
-- request file that says where the replay ends. Change it in the coilbox
-- repository under lua/rewind-recorder/. Nothing installs it into a game
-- anybody plays.
--
-- It has no synced code. The engine gives the unsynced half of a gadget full
-- read access and the io library, so everything here reads the simulation
-- from outside it and nothing here can change it.
--
-- What it writes is a raw dump: one block for every simulation frame, in
-- binary, flushed as it is written, so a run that is stopped leaves a file
-- that reads up to the frame where it stopped. The byte layout is in
-- lua/rewind-recorder/README.md, and tests/dump.lua reads it.
--
-- Every number that reaches the file is a 32 bit float, which is what a number
-- already is in the engine's Lua. The engine packs a list of numbers and stops
-- at the first thing that is not one, so a nil in the list would cut a block
-- short without a word. Every value read from the engine is checked or given
-- a stand-in before it goes in the list, and the packed length is checked
-- before a block is written.

-- Raised when a reader of an older dump would misread a newer one.
local FORMAT_VERSION = 1

-- Where coilbox puts the request, inside the generated game. A game without
-- it did not ask for a recording.
local REQUEST_FILE = "luarules/configs/coilbox_rewind_request.lua"

-- Relative to the engine's write directory, which is the only place Lua may
-- open a file for writing.
local DUMP_FILE = "coilbox-rewind.dump"

local LOG_SECTION = "coilbox-rewind-recorder"

-- How many frames lie between two samples of every unit. Three is ten samples
-- a second, and it is the interval the two benchmark recordings of issue #3778
-- were made at: 6,996,909 unit rows over a mean of 254.44 units alive is
-- 27,499 samples of an 82,496 frame match. Every size and thinning figure in
-- docs/reference/replay-track-format.md was measured on samples that far
-- apart. Projectiles are written on every frame.
local UNIT_FRAMES = 3

-- One window of a track, from the same page: 900 frames, which is 30 seconds
-- of the match. Two things happen once a window. A line says how far the run
-- has got. And the whole heightmap is read, so that each window of a track
-- ends with the ground the simulation had. The second costs time. Reading the
-- 983,040 corners of a 6,144 by 10,240 elmo map took between 0.087 and 0.107
-- seconds in four readings, and all the terrain reading of an 82,496 frame
-- match on that map, 92 windows of it, took 9.5 seconds.
local WINDOW_FRAMES = 900

local BLOCK_HEADER = 1
local BLOCK_PIECES = 2
local BLOCK_FRAME = 3
local BLOCK_END = 4

local UNITS_CREATED = 1
local UNITS_DESTROYED = 2
local UNITS_GIVEN = 3
local UNIT_SAMPLES = 4
local WEAPON_TARGETS = 5
local BUILDER_WORK = 6
local BUILD_QUEUES = 7
local PIECE_POSES = 8
local FEATURES_CREATED = 9
local FEATURES_DESTROYED = 10
local PROJECTILES = 11
local TERRAIN = 12

function gadget:GetInfo()
	return {
		name = "Coilbox rewind recorder",
		desc = "Writes every unit, feature, projectile and terrain change of a replay to a file",
		author = "coilbox",
		license = "MIT",
		-- After the replay logger, and late for the same reason: a position is
		-- read after the game's own gadgets have had their turn.
		layer = 2001,
		enabled = true,
	}
end

if gadgetHandler:IsSyncedCode() then
	return
end

--------------------------------------------------------------------------------
-- JSON, for the three blocks that are text.
--------------------------------------------------------------------------------

local ESCAPES = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function quote(text)
	local escaped = tostring(text):gsub('[%c"\\]', function(char)
		return ESCAPES[char] or string.format("\\u%04x", char:byte())
	end)
	return '"' .. escaped .. '"'
end

-- A whole number. Everything the text blocks hold is one.
local function whole(value)
	return string.format("%.0f", value)
end

local function quoted(list)
	local parts = {}
	for index = 1, #list do
		parts[index] = quote(list[index])
	end
	return "[" .. table.concat(parts, ",") .. "]"
end

local function wholes(list)
	local parts = {}
	for index = 1, #list do
		parts[index] = whole(list[index])
	end
	return "[" .. table.concat(parts, ",") .. "]"
end

-- Numbers that are not whole. Nine digits carry a 32 bit float exactly.
local function floats(list)
	local parts = {}
	for index = 1, #list do
		parts[index] = string.format("%.9g", tonumber(list[index]) or 0)
	end
	return "[" .. table.concat(parts, ",") .. "]"
end

--------------------------------------------------------------------------------
-- The engine, as locals.
--------------------------------------------------------------------------------

local GetGameFrame = Spring.GetGameFrame
local GetAllUnits = Spring.GetAllUnits
local GetUnitDefID = Spring.GetUnitDefID
local GetUnitTeam = Spring.GetUnitTeam
local GetUnitPosition = Spring.GetUnitPosition
local GetUnitDirection = Spring.GetUnitDirection
local GetUnitVectors = Spring.GetUnitVectors
local GetUnitHealth = Spring.GetUnitHealth
local GetUnitIsActive = Spring.GetUnitIsActive
local GetUnitWeaponTarget = Spring.GetUnitWeaponTarget
local GetUnitWeaponVectors = Spring.GetUnitWeaponVectors
local GetUnitPiecePosDir = Spring.GetUnitPiecePosDir
local GetUnitPieceMatrix = Spring.GetUnitPieceMatrix
local GetUnitWorkerTask = Spring.GetUnitWorkerTask
local GetUnitCurrentBuildPower = Spring.GetUnitCurrentBuildPower
local GetUnitCommandCount = Spring.GetUnitCommandCount
local GetUnitCurrentCommand = Spring.GetUnitCurrentCommand
local GetFeatureDefID = Spring.GetFeatureDefID
local GetFeatureTeam = Spring.GetFeatureTeam
local GetFeaturePosition = Spring.GetFeaturePosition
local GetFeatureDirection = Spring.GetFeatureDirection
local GetProjectilePosition = Spring.GetProjectilePosition
local GetProjectileVelocity = Spring.GetProjectileVelocity
local GetProjectileDefID = Spring.GetProjectileDefID
local GetProjectileTeamID = Spring.GetProjectileTeamID
local GetProjectileOwnerID = Spring.GetProjectileOwnerID
local GetGroundHeight = Spring.GetGroundHeight
local GetGroundOrigHeight = Spring.GetGroundOrigHeight
local PackF32 = VFS.PackF32
local PackU32 = VFS.PackU32

local SQUARE = Game.squareSize or 8
-- Heightmap corners along each axis, less the far edge. The engine clamps a
-- position to one elmo inside the map before it reads a height, so the corners
-- on the far edges cannot be read exactly and are left out.
local CORNERS_X = math.floor((Game.mapSizeX or 0) / SQUARE)
local CORNERS_Z = math.floor((Game.mapSizeZ or 0) / SQUARE)

local CMD_RESTORE = CMD.RESTORE

--------------------------------------------------------------------------------
-- The file.
--------------------------------------------------------------------------------

local file
-- Set once the dump has its end block, to the reason it ended.
local ended
-- The last frame of the replay, from the request.
local lastFrame = math.huge
local framesWritten = 0
local lastWritten

-- The numbers of the block being built, and how many of them there are.
local out, n = {}, 0

local function stop(message)
	Spring.Log(LOG_SECTION, "error", message)
	if file then
		file:close()
		file = nil
	end
end

local function writeBlock(kind, payload)
	file:write(PackU32(kind, #payload), payload)
end

local function writeText(kind, text)
	writeBlock(kind, text)
	file:flush()
end

-- Open a section and return where its count goes.
local function open(code)
	out[n + 1] = code
	n = n + 2
	return n
end

-- Close a section, or take it back out when nothing went in it.
local function close(at)
	if n == at then
		n = at - 2
	else
		out[at] = n - at
	end
end

--------------------------------------------------------------------------------
-- Units.
--
-- The list of units the engine gives is what decides which units there are.
-- UnitCreated and UnitDestroyed only say so sooner. They cannot be relied on:
-- a gadget handler calls every gadget's function for a call-in from one loop,
-- so another gadget that raises in UnitCreated stops the call from reaching
-- this one. Splinter Faction's graphics gadget does exactly that for every
-- unit when the engine is headless.
--------------------------------------------------------------------------------

-- What is remembered about a living unit, so that only changes are written.
local units = {}
-- The same units as a list, so they are gone through in an order that does
-- not depend on how a table happens to be laid out.
local known, knownCount = {}, 0

-- Per unit definition, read from the first unit of it.
-- def -> { weapons, builder, mobileBuilder, pieces, parents, depths }
local defs = {}

local created, createdCount = {}, 0
local destroyed, destroyedCount = {}, 0
local given, givenCount = {}, 0

-- A unit's front and up directions. The engine this was written against
-- answers both from GetUnitDirection. One that answers only the front has
-- them in GetUnitVectors.
local function frontAndUp(unitID)
	local fx, fy, fz, _, _, _, ux, uy, uz = GetUnitDirection(unitID)
	if fx and not ux then
		local front, up = GetUnitVectors(unitID)
		if not up then
			return nil
		end
		return front[1], front[2], front[3], up[1], up[2], up[3]
	end
	return fx, fy, fz, ux, uy, uz
end

-- Put a unit's thirteen pose numbers into `into` from index `at + 1`. Returns
-- false, and writes nothing, when the unit is no longer there to read.
local function pose(unitID, into, at)
	local x, y, z = GetUnitPosition(unitID)
	local fx, fy, fz, ux, uy, uz = frontAndUp(unitID)
	local health, maxHealth, _, _, build = GetUnitHealth(unitID)
	if not (z and uz and health and maxHealth and build) then
		return false
	end
	into[at + 1], into[at + 2], into[at + 3] = x, y, z
	into[at + 4], into[at + 5], into[at + 6] = fx, fy, fz
	into[at + 7], into[at + 8], into[at + 9] = ux, uy, uz
	-- As the engine has them. Health can be above the maximum and below zero.
	into[at + 10], into[at + 11], into[at + 12] = health, maxHealth, build
	into[at + 13] = GetUnitIsActive(unitID) and 1 or 0
	return true
end

-- The piece tree of a unit definition, read from one unit of it and written
-- to the dump once.
--
-- A piece row is a matrix in the unit's model space. Issue #3783 turns it into
-- the turn and move a unit script set on the piece, and for that it needs what
-- the model says about the piece at rest: its offset from its parent, and the
-- box round its geometry, which says how far a turn of the piece moves anything.
-- The engine does not tell Lua the rest rotation that some model formats bake
-- into a piece, so the model's format is written for a reader to judge by.
local function pieceTree(unitID, unitDefID, modelType)
	local names = Spring.GetUnitPieceList(unitID) or {}
	local index = {}
	for piece = 1, #names do
		index[names[piece]] = piece
	end
	local parents, offsets, bounds = {}, {}, {}
	for piece = 1, #names do
		local info = Spring.GetUnitPieceInfo(unitID, piece) or {}
		parents[piece] = index[info.parent] or 0
		offsets[piece] = floats(info.offset or { 0, 0, 0 })
		local min, max = info.min, info.max
		if info.isEmpty or not (min and max) then
			bounds[piece] = "[]"
		else
			bounds[piece] = floats({ min[1], min[2], min[3], max[1], max[2], max[3] })
		end
	end
	local depths = {}
	for piece = 1, #names do
		local depth, at = 0, parents[piece]
		-- A tree is no deeper than it has pieces, which stops a model whose
		-- parents loop from hanging the run.
		while at ~= 0 and depth <= #names do
			depth, at = depth + 1, parents[at]
		end
		depths[piece] = depth
	end
	writeText(BLOCK_PIECES, '{"def":' .. whole(unitDefID)
		.. ',"pieces":' .. quoted(names)
		.. ',"parents":' .. wholes(parents)
		.. ',"modelType":' .. quote(modelType or "")
		.. ',"offsets":[' .. table.concat(offsets, ",")
		.. '],"bounds":[' .. table.concat(bounds, ",") .. "]}")
	return names, parents, depths
end

local function defOf(unitID, unitDefID)
	local known = defs[unitDefID]
	if known then
		return known
	end
	local unitDef = UnitDefs[unitDefID] or {}
	local names, parents, depths = pieceTree(unitID, unitDefID, unitDef.modeltype)
	known = {
		weapons = type(unitDef.weapons) == "table" and #unitDef.weapons or 0,
		builder = unitDef.isBuilder and true or false,
		mobileBuilder = unitDef.isMobileBuilder and true or false,
		pieces = #names,
		parents = parents,
		depths = depths,
	}
	defs[unitDefID] = known
	return known
end

local function remember(unitID, unitDefID, team, frame)
	local held = {}
	if not pose(unitID, held, 0) then
		return
	end
	knownCount = knownCount + 1
	known[knownCount] = unitID
	units[unitID] = {
		def = defOf(unitID, unitDefID),
		team = team,
		-- Where it is in the list of known units, and the last frame the
		-- engine listed it on.
		at = knownCount,
		seen = frame,
		-- The thirteen numbers of its pose as last read.
		pose = held,
		-- Four numbers a weapon: the kind of target and what it is.
		targets = {},
		-- weapon -> the piece its muzzle was last found at.
		muzzles = {},
		-- The pieces being watched, in the order they were first needed, and
		-- piece -> the twelve numbers last written for it.
		watched = {},
		matrices = {},
		-- cmd, target, power, hasPosition, x, y, z as last written.
		work = { 0, -1, 0, 0, 0, 0, 0 },
		-- The build queue as last written, four numbers an item.
		queue = {},
		queued = 0,
	}
	local slot = createdCount * 16
	created[slot + 1], created[slot + 2], created[slot + 3] = unitID, unitDefID, team
	for index = 1, 13 do
		created[slot + 3 + index] = held[index]
	end
	createdCount = createdCount + 1
end

-- Write a unit as destroyed, with the pose it was last read in, and stop
-- remembering it.
local function forget(unitID, unit)
	local last = known[knownCount]
	known[unit.at] = last
	units[last].at = unit.at
	known[knownCount] = nil
	knownCount = knownCount - 1
	units[unitID] = nil

	local slot = destroyedCount * 14
	destroyed[slot + 1] = unitID
	for index = 1, 13 do
		destroyed[slot + 1 + index] = unit.pose[index]
	end
	destroyedCount = destroyedCount + 1
end

function gadget:UnitCreated(unitID, unitDefID, unitTeam)
	if file and not units[unitID] then
		remember(unitID, unitDefID, unitTeam, GetGameFrame())
	end
end

function gadget:UnitDestroyed(unitID)
	local unit = file and units[unitID]
	if unit then
		-- Still there to read: the engine calls this before it removes it.
		pose(unitID, unit.pose, 0)
		forget(unitID, unit)
	end
end

-- Move a buffer of rows into the block as one section, and empty it.
local function section(code, rows, count)
	if count == 0 then
		return
	end
	local at = open(code)
	for index = 1, count do
		out[n + index] = rows[index]
	end
	n = n + count
	close(at)
end

-- The buffers a pass over the units fills beside the samples.
local targets, targetCount = {}, 0
local work, workCount = {}, 0
local queues, queueCount = {}, 0
local poses, poseCount = {}, 0

local function sampleTargets(unitID, unit)
	local held = unit.targets
	for weapon = 1, unit.def.weapons do
		local kind, _, target = GetUnitWeaponTarget(unitID, weapon)
		kind = kind or 0
		local a, b, c = 0, 0, 0
		if type(target) == "table" then
			a, b, c = target[1] or 0, target[2] or 0, target[3] or 0
		elseif type(target) == "number" then
			a = target
		end
		local slot = (weapon - 1) * 4
		if held[slot + 1] ~= kind or held[slot + 2] ~= a or held[slot + 3] ~= b or held[slot + 4] ~= c then
			-- A weapon with no target before its first one is not news.
			if held[slot + 1] or kind ~= 0 then
				targets[targetCount + 1], targets[targetCount + 2], targets[targetCount + 3] = unitID, weapon, kind
				targets[targetCount + 4], targets[targetCount + 5], targets[targetCount + 6] = a, b, c
				targetCount = targetCount + 6
			end
			held[slot + 1], held[slot + 2], held[slot + 3], held[slot + 4] = kind, a, b, c
		end
	end
end

-- What a builder is working on, as the engine names it: a command and, for
-- every kind of work but terraforming, a target. Terraforming has a place
-- instead, which is the place of the order at the front of the queue when
-- that order is to restore ground or to build.
local function sampleWork(unitID, unit)
	local cmd, target = GetUnitWorkerTask(unitID)
	cmd, target = cmd or 0, target or -1
	local power = GetUnitCurrentBuildPower(unitID) or 0
	local known, x, y, z = 0, 0, 0, 0
	if cmd == CMD_RESTORE then
		local front, _, _, px, py, pz = GetUnitCurrentCommand(unitID)
		if front and (front == CMD_RESTORE or front < 0) and pz then
			known, x, y, z = 1, px, py, pz
		end
	end
	local held = unit.work
	if held[1] ~= cmd or held[2] ~= target or held[3] ~= power
		or held[4] ~= known or held[5] ~= x or held[6] ~= y or held[7] ~= z then
		held[1], held[2], held[3], held[4], held[5], held[6], held[7] = cmd, target, power, known, x, y, z
		work[workCount + 1] = unitID
		for index = 1, 7 do
			work[workCount + 1 + index] = held[index]
		end
		workCount = workCount + 8
	end
end

-- The buildings a mobile builder has been told to put up, in order.
local scratch = {}

local function sampleQueue(unitID, unit)
	local items = 0
	for index = 1, GetUnitCommandCount(unitID) or 0 do
		local cmd, _, _, x, _, z, facing = GetUnitCurrentCommand(unitID, index)
		if cmd and cmd < 0 and z then
			local slot = items * 4
			scratch[slot + 1], scratch[slot + 2], scratch[slot + 3], scratch[slot + 4] = -cmd, x, z, facing or 0
			items = items + 1
		end
	end
	local held = unit.queue
	local changed = items ~= unit.queued
	for index = 1, items * 4 do
		if held[index] ~= scratch[index] then
			changed = true
			held[index] = scratch[index]
		end
	end
	if not changed then
		return
	end
	unit.queued = items
	queues[queueCount + 1], queues[queueCount + 2] = unitID, items
	for index = 1, items * 4 do
		queues[queueCount + 2 + index] = scratch[index]
	end
	queueCount = queueCount + 2 + items * 4
end

-- Find the piece a weapon fires from. The engine does not say which piece a
-- unit script answered with, only where the muzzle is, so this is the piece
-- that is nearest to that place. Two pieces can sit on one spot, a flare on
-- the end of its barrel, and then it is the one deeper in the tree, whose
-- parents include the other.
local function findMuzzle(unitID, def, mx, my, mz)
	local best, bestDistance, bestDepth
	for piece = 1, def.pieces do
		local px, py, pz = GetUnitPiecePosDir(unitID, piece)
		if pz then
			local dx, dy, dz = px - mx, py - my, pz - mz
			local distance = dx * dx + dy * dy + dz * dz
			local depth = def.depths[piece]
			if not best or distance < bestDistance or (distance == bestDistance and depth > bestDepth) then
				best, bestDistance, bestDepth = piece, distance, depth
			end
		end
	end
	return best
end

-- Watch a piece and every parent up to the root.
local function watch(unit, piece)
	local parents = unit.def.parents
	local steps = 0
	while piece and piece ~= 0 and not unit.matrices[piece] and steps <= unit.def.pieces do
		unit.matrices[piece] = {}
		unit.watched[#unit.watched + 1] = piece
		piece, steps = parents[piece], steps + 1
	end
end

-- Each weapon's muzzle is looked for once the unit is built, because the
-- engine does not place a weapon's muzzle before then. A unit script can
-- answer with a different piece each time it fires, which is how a unit with
-- two barrels takes turns, so while a weapon has a target the muzzle is looked
-- for again whenever the piece it was last found at is no longer exactly where
-- the engine says the muzzle is.
local function samplePieces(unitID, unit, built)
	local def = unit.def
	for weapon = 1, def.weapons do
		local at = unit.muzzles[weapon]
		if (not at and built) or (unit.targets[(weapon - 1) * 4 + 1] or 0) ~= 0 then
			local mx, my, mz = GetUnitWeaponVectors(unitID, weapon)
			if mz then
				local px, py, pz
				if at then
					px, py, pz = GetUnitPiecePosDir(unitID, at)
				end
				if px ~= mx or py ~= my or pz ~= mz then
					at = findMuzzle(unitID, def, mx, my, mz)
					unit.muzzles[weapon] = at
					watch(unit, at)
				end
			end
		end
	end

	local watched, matrices = unit.watched, unit.matrices
	for index = 1, #watched do
		local piece = watched[index]
		-- The engine's matrix is four columns of four. The fourth row is
		-- 0, 0, 0, 1 for every piece, so the three rows above it are kept.
		local a1, a2, a3, _, b1, b2, b3, _, c1, c2, c3, _, d1, d2, d3 = GetUnitPieceMatrix(unitID, piece)
		if d3 then
			local held = matrices[piece]
			if held[1] ~= a1 or held[2] ~= a2 or held[3] ~= a3
				or held[4] ~= b1 or held[5] ~= b2 or held[6] ~= b3
				or held[7] ~= c1 or held[8] ~= c2 or held[9] ~= c3
				or held[10] ~= d1 or held[11] ~= d2 or held[12] ~= d3 then
				held[1], held[2], held[3], held[4], held[5], held[6] = a1, a2, a3, b1, b2, b3
				held[7], held[8], held[9], held[10], held[11], held[12] = c1, c2, c3, d1, d2, d3
				poses[poseCount + 1], poses[poseCount + 2] = unitID, piece
				for value = 1, 12 do
					poses[poseCount + 2 + value] = held[value]
				end
				poseCount = poseCount + 14
			end
		end
	end
end

-- Go through the engine's list of units, as often as they are sampled:
-- remember the ones that are new and write off the ones that are gone. The
-- engine goes on listing a unit that has been destroyed until its death
-- animation is over, so one that is dead is not new.
local function trackUnits(all, frame)
	for index = 1, #all do
		local unitID = all[index]
		local unit = units[unitID]
		if unit then
			unit.seen = frame
		elseif not Spring.GetUnitIsDead(unitID) then
			local unitDefID, team = GetUnitDefID(unitID), GetUnitTeam(unitID)
			if unitDefID and team then
				remember(unitID, unitDefID, team, frame)
			end
		end
	end
	-- Backwards, because forgetting one moves the last into its place.
	for index = knownCount, 1, -1 do
		local unitID = known[index]
		local unit = units[unitID]
		if unit.seen ~= frame then
			forget(unitID, unit)
		end
	end
end

local function sampleUnits(all)
	local at = open(UNIT_SAMPLES)
	for index = 1, #all do
		local unitID = all[index]
		local unit = units[unitID]
		if unit then
			local held = unit.pose
			if Spring.GetUnitIsDead(unitID) then
				-- Destroyed with no UnitDestroyed to say so.
				pose(unitID, held, 0)
				forget(unitID, unit)
			elseif pose(unitID, held, 0) then
				out[n + 1] = unitID
				for value = 1, 13 do
					out[n + 1 + value] = held[value]
				end
				n = n + 14

				local team = GetUnitTeam(unitID)
				if team and team ~= unit.team then
					unit.team = team
					given[givenCount * 2 + 1], given[givenCount * 2 + 2] = unitID, team
					givenCount = givenCount + 1
				end
				local def = unit.def
				if def.weapons > 0 then
					sampleTargets(unitID, unit)
					-- The twelfth number of a pose is how far built the unit is.
					samplePieces(unitID, unit, held[12] >= 1)
				end
				if def.builder then
					sampleWork(unitID, unit)
				end
				if def.mobileBuilder then
					sampleQueue(unitID, unit)
				end
			end
		end
	end
	close(at)

	section(WEAPON_TARGETS, targets, targetCount)
	section(BUILDER_WORK, work, workCount)
	section(BUILD_QUEUES, queues, queueCount)
	section(PIECE_POSES, poses, poseCount)
	targetCount, workCount, queueCount, poseCount = 0, 0, 0, 0
end

--------------------------------------------------------------------------------
-- Features. The engine's list decides here too, and the two call-ins only
-- say so sooner.
--------------------------------------------------------------------------------

-- feature -> the last frame the engine listed it on.
local features = {}
local knownFeatures, knownFeatureCount = {}, 0
local featuresCreated, featuresCreatedCount = {}, 0
local featuresDestroyed, featuresDestroyedCount = {}, 0

local function rememberFeature(featureID, frame)
	local def = GetFeatureDefID(featureID)
	local x, y, z = GetFeaturePosition(featureID)
	local fx, fy, fz, _, _, _, ux, uy, uz = GetFeatureDirection(featureID)
	if not (def and z and fz) then
		return
	end
	-- An engine that answers only the front says nothing of the up
	-- direction, and a feature is then written as standing upright.
	if not uz then
		ux, uy, uz = 0, 1, 0
	end
	features[featureID] = frame
	knownFeatureCount = knownFeatureCount + 1
	knownFeatures[knownFeatureCount] = featureID
	local slot = featuresCreatedCount * 12
	local into = featuresCreated
	into[slot + 1], into[slot + 2], into[slot + 3] = featureID, def, GetFeatureTeam(featureID) or -1
	into[slot + 4], into[slot + 5], into[slot + 6] = x, y, z
	into[slot + 7], into[slot + 8], into[slot + 9] = fx, fy, fz
	into[slot + 10], into[slot + 11], into[slot + 12] = ux, uy, uz
	featuresCreatedCount = featuresCreatedCount + 1
end

function gadget:FeatureCreated(featureID)
	if file and not features[featureID] then
		rememberFeature(featureID, GetGameFrame())
	end
end

function gadget:FeatureDestroyed(featureID)
	if file and features[featureID] then
		-- Left in the list of known features, which the next pass tidies.
		features[featureID] = nil
		featuresDestroyedCount = featuresDestroyedCount + 1
		featuresDestroyed[featuresDestroyedCount] = featureID
	end
end

-- Go through the engine's list of features, as often as units are sampled.
local function trackFeatures(frame)
	local all = Spring.GetAllFeatures() or {}
	for index = 1, #all do
		local featureID = all[index]
		if features[featureID] then
			features[featureID] = frame
		else
			rememberFeature(featureID, frame)
		end
	end
	local kept = 0
	for index = 1, knownFeatureCount do
		local featureID = knownFeatures[index]
		local seen = features[featureID]
		if seen == frame then
			kept = kept + 1
			knownFeatures[kept] = featureID
		elseif seen then
			features[featureID] = nil
			featuresDestroyedCount = featuresDestroyedCount + 1
			featuresDestroyed[featuresDestroyedCount] = featureID
		end
	end
	for index = kept + 1, knownFeatureCount do
		knownFeatures[index] = nil
	end
	knownFeatureCount = kept
end

--------------------------------------------------------------------------------
-- Projectiles, every one on every frame.
--------------------------------------------------------------------------------

local function allProjectiles()
	if Spring.GetAllProjectiles then
		return Spring.GetAllProjectiles()
	end
	-- An engine without that call. Far past any map in every direction, so
	-- a shell that has left the map is still found.
	return Spring.GetProjectilesInRectangle(-1e9, -1e9, 1e9, 1e9)
end

local function sampleProjectiles()
	local all = allProjectiles()
	if not all or #all == 0 then
		return
	end
	local at = open(PROJECTILES)
	for index = 1, #all do
		local id = all[index]
		local x, y, z = GetProjectilePosition(id)
		local vx, vy, vz = GetProjectileVelocity(id)
		if z and vz then
			out[n + 1] = id
			-- Flying debris has no weapon definition, and is written with -1.
			out[n + 2] = GetProjectileDefID(id) or -1
			out[n + 3] = GetProjectileTeamID(id) or -1
			out[n + 4] = GetProjectileOwnerID(id) or -1
			out[n + 5], out[n + 6], out[n + 7] = x, y, z
			out[n + 8], out[n + 9], out[n + 10] = vx, vy, vz
			n = n + 10
		end
	end
	close(at)
end

--------------------------------------------------------------------------------
-- Terrain.
--
-- The engine tells unsynced Lua which rectangle of the heightmap changed
-- through UnsyncedHeightMapUpdate, and it does that as it draws, not as it
-- simulates: CReadMap::UpdateDraw hands out at most 128 rectangles each time
-- the world is drawn, and several frames can be simulated between two draws.
-- Unsynced Lua also reads the heights the last draw copied, not the ones the
-- simulation holds (GetGroundHeight passes the handle's synced flag down). So
-- a change is written on the first frame after the engine has reported it,
-- which is the frame it happened on or a later one. See the README.
--
-- The engine also does not report every change. A Splinter Faction match of
-- 23,091 frames changed 4,482 corners and the engine reported none of them.
-- The source shows one way a report is lost, though whether it is what
-- happened there was not checked: a builder levelling ground changes heights
-- on every frame and reports them from its slow update, and
-- CBasicMapDamage::RecalcArea drops a report when a flag the engine clears
-- every 30 frames has been cleared in between.
--
-- So the recorder does not only wait to be told. On the first frame, once a
-- window and as the recording ends it makes the engine copy every height
-- across and reads the whole map. Turning a spectator's full view off and on
-- again does the copy (SpecFullViewActionExecutor calls
-- CReadMap::CopySyncedToUnsynced), and a command sent from Lua runs before the
-- call returns. At those frames the heights written are the simulation's own,
-- whatever was drawn or reported when.
--
-- The base content gadget handler does not pass that call-in on to gadgets.
-- The engine calls a global function of that name, and a gadget is handed the
-- global table as _G, so the recorder puts its own function there and calls
-- whatever was there before.
--------------------------------------------------------------------------------

local globals = _G
local canHearTerrain = type(globals) == "table" and Script ~= nil and Script.UpdateCallIn ~= nil
	and CORNERS_X > 0 and CORNERS_Z > 0

-- Rectangles the engine has reported and that have not been looked at, four
-- numbers each.
local rects, rectCount = {}, 0
-- Heights as last written, by corner. A corner not in here is at the map's
-- own height.
local heights = {}
local hook, before

local function hearTerrain()
	before = globals.UnsyncedHeightMapUpdate
	hook = function(x1, z1, x2, z2)
		rects[rectCount + 1], rects[rectCount + 2], rects[rectCount + 3], rects[rectCount + 4] = x1, z1, x2, z2
		rectCount = rectCount + 4
		if before then
			return before(x1, z1, x2, z2)
		end
	end
	globals.UnsyncedHeightMapUpdate = hook
	Script.UpdateCallIn("UnsyncedHeightMapUpdate")
	-- Whatever was reported while nothing was listening is found by looking
	-- at the whole map once. The first time, that is every height a game
	-- changed while it loaded.
	rects[1], rects[2], rects[3], rects[4] = 0, 0, CORNERS_X, CORNERS_Z
	rectCount = 4
end

-- Make the engine copy every height the simulation holds to where unsynced
-- Lua reads them, now. Only a spectator who sees everything has a full view
-- to turn off and on, and the player of a replay is one.
local function catchUpTerrain()
	local spectating, fullView, fullSelect = Spring.GetSpectatingState()
	if spectating and fullView then
		Spring.SendCommands("specfullview 0", "specfullview " .. (fullSelect and 3 or 1))
	end
end

local function sampleTerrain()
	-- A gadget handler rebuilds its call-ins when a gadget is added or
	-- removed, and takes the function away when it does.
	if not hook or globals.UnsyncedHeightMapUpdate ~= hook then
		hearTerrain()
	end
	if rectCount == 0 then
		return
	end
	local at = open(TERRAIN)
	for rect = 0, rectCount - 4, 4 do
		local x1, z1 = math.max(rects[rect + 1], 0), math.max(rects[rect + 2], 0)
		local x2, z2 = math.min(rects[rect + 3], CORNERS_X - 1), math.min(rects[rect + 4], CORNERS_Z - 1)
		for z = z1, z2 do
			local row = z * CORNERS_X
			for x = x1, x2 do
				local now = GetGroundHeight(x * SQUARE, z * SQUARE)
				local was = heights[row + x] or GetGroundOrigHeight(x * SQUARE, z * SQUARE)
				if now and was and now ~= was then
					heights[row + x] = now
					out[n + 1], out[n + 2], out[n + 3], out[n + 4] = x, z, was, now
					n = n + 4
				end
			end
		end
	end
	rectCount = 0
	close(at)
end

--------------------------------------------------------------------------------
-- A frame.
--------------------------------------------------------------------------------

-- `last` is set for the block a recording ends on.
local function writeFrame(frame, last)
	out[1], n = frame, 1

	-- The first block is a sample whatever its frame, so that everything on
	-- the map before the recording began is in it.
	local sampling = frame % UNIT_FRAMES == 0 or not lastWritten
	local all
	if sampling then
		all = GetAllUnits() or {}
		trackUnits(all, frame)
	end
	section(UNITS_CREATED, created, createdCount * 16)
	createdCount = 0
	if sampling then
		sampleUnits(all)
		trackFeatures(frame)
	end
	section(UNITS_DESTROYED, destroyed, destroyedCount * 14)
	section(UNITS_GIVEN, given, givenCount * 2)
	section(FEATURES_CREATED, featuresCreated, featuresCreatedCount * 12)
	section(FEATURES_DESTROYED, featuresDestroyed, featuresDestroyedCount)
	destroyedCount, givenCount, featuresCreatedCount, featuresDestroyedCount = 0, 0, 0, 0
	sampleProjectiles()
	if canHearTerrain then
		if last or not lastWritten or frame % WINDOW_FRAMES == 0 then
			catchUpTerrain()
		end
		sampleTerrain()
	end

	out[n + 1] = nil
	local payload = PackF32(out)
	if not payload or #payload ~= n * 4 then
		-- Something that is not a number got into the block. What is on disk
		-- is whole up to the frame before, so it is left as it is.
		stop("frame " .. frame .. " packed to " .. (payload and #payload or 0) .. " bytes, not "
			.. n * 4 .. ". The recording stops here")
		return
	end
	writeBlock(BLOCK_FRAME, payload)
	-- Every frame, so a run that is killed leaves every frame before it.
	file:flush()
	framesWritten = framesWritten + 1
	lastWritten = frame
end

-- Write the end block and close the file. `frame` is the last frame that was
-- simulated.
local function finish(reason, frame, winners)
	ended = reason
	writeText(BLOCK_END, '{"reason":' .. quote(reason)
		.. ',"frame":' .. whole(frame)
		.. ',"frames":' .. whole(framesWritten)
		.. ',"winners":' .. wholes(winners or {}) .. "}")
	file:close()
	file = nil
end

function gadget:GameFrame(frame)
	if not file then
		-- The replay ran out with no game over in it, so nothing else is going
		-- to stop the engine. A headless one plays on past the end of a replay.
		if ended == "last_frame" and frame > lastFrame then
			Spring.SendCommands("quitforce")
		end
		return
	end
	writeFrame(frame, frame >= lastFrame)
	if not file then
		return
	end
	if frame % WINDOW_FRAMES == 0 then
		Spring.Echo(LOG_SECTION .. ": frame " .. whole(frame)
			.. (lastFrame < math.huge and (" of " .. whole(lastFrame)) or ""))
	end
	if frame >= lastFrame then
		finish("last_frame", frame)
	end
end

function gadget:GameOver(winningAllyTeams)
	if not file then
		return
	end
	-- What has happened since the last block has no frame after it to be
	-- written in, so it gets one more block. A game can end from inside a
	-- frame, before this gadget has been called for it, or between two.
	if lastWritten then
		writeFrame(lastWritten + 1, true)
	end
	if file then
		finish("game_over", GetGameFrame(), winningAllyTeams)
	end
end

--------------------------------------------------------------------------------
-- The start.
--------------------------------------------------------------------------------

local function names(list, first)
	local found = {}
	local id = first
	while list and list[id] do
		found[#found + 1] = list[id].name or ""
		id = id + 1
	end
	return quoted(found)
end

-- Each unit definition's radius in elmos, in the order of the names. The
-- thinning of issue #3782 multiplies a unit's turn by it, so that a tolerance
-- in elmos holds at the unit's edge. Nine digits carry a 32 bit float exactly.
local function radii(list)
	local found = {}
	local id = 1
	while list and list[id] do
		found[#found + 1] = string.format("%.9g", tonumber(list[id].radius) or 0)
		id = id + 1
	end
	return "[" .. table.concat(found, ",") .. "]"
end

-- Each unit definition's footprint, in the order of the names: the engine's
-- xsize and zsize, which count heightmap squares. The map view of issue #3807
-- sizes a unit's mark from it.
local function footprints(list)
	local found = {}
	local id = 1
	while list and list[id] do
		found[#found + 1] = wholes({ tonumber(list[id].xsize) or 0, tonumber(list[id].zsize) or 0 })
		id = id + 1
	end
	return "[" .. table.concat(found, ",") .. "]"
end

local function teamLine(teamID, gaia)
	local _, leader, _, hasAI, side, allyTeam = Spring.GetTeamInfo(teamID, false)
	local red, green, blue = Spring.GetTeamColor(teamID)
	local parts = {
		'{"team":' .. whole(teamID),
		'"allyTeam":' .. whole(allyTeam or -1),
		'"side":' .. quote(side or ""),
		'"leader":' .. quote(leader and Spring.GetPlayerInfo(leader, false) or ""),
		'"color":' .. wholes({
			math.floor((red or 0) * 255 + 0.5),
			math.floor((green or 0) * 255 + 0.5),
			math.floor((blue or 0) * 255 + 0.5),
		}),
	}
	if hasAI then
		local _, aiName = Spring.GetAIInfo(teamID)
		parts[#parts + 1] = '"ai":' .. quote(aiName or "")
	end
	if teamID == gaia then
		parts[#parts + 1] = '"gaia":true'
	end
	return table.concat(parts, ",") .. "}"
end

local function header()
	local engine = (Engine and Engine.versionFull) or (Engine and Engine.version) or Game.version
	local gaia = Spring.GetGaiaTeamID()
	local teams = {}
	for _, teamID in ipairs(Spring.GetTeamList() or {}) do
		teams[#teams + 1] = teamLine(teamID, gaia)
	end
	return '{"format":' .. whole(FORMAT_VERSION)
		.. ',"engine":' .. quote(engine or "")
		.. ',"game":' .. quote(Game.gameName or "")
		.. ',"gameVersion":' .. quote(Game.gameVersion or "")
		.. ',"map":' .. quote(Game.mapName or "")
		.. ',"mapSizeX":' .. whole(Game.mapSizeX or 0)
		.. ',"mapSizeZ":' .. whole(Game.mapSizeZ or 0)
		.. ',"squareSize":' .. whole(SQUARE)
		.. ',"gameSpeed":' .. whole(Game.gameSpeed or 30)
		.. ',"maxUnits":' .. whole(Game.maxUnits or 0)
		.. ',"unitFrames":' .. whole(UNIT_FRAMES)
		.. (lastFrame < math.huge and (',"lastFrame":' .. whole(lastFrame)) or "")
		.. ',"terrain":' .. (canHearTerrain and "true" or "false")
		.. ',"teams":[' .. table.concat(teams, ",") .. "]"
		.. ',"unitDefs":' .. names(UnitDefs, 1)
		.. ',"unitRadii":' .. radii(UnitDefs)
		.. ',"unitFootprints":' .. footprints(UnitDefs)
		.. ',"featureDefs":' .. names(FeatureDefs, 1)
		.. ',"weaponDefs":' .. names(WeaponDefs, 0)
		.. "}"
end

function gadget:Initialize()
	local request = VFS.FileExists(REQUEST_FILE) and VFS.Include(REQUEST_FILE)
	if type(request) ~= "table" then
		-- This run did not ask for a recording.
		gadgetHandler:RemoveGadget(self)
		return
	end
	if type(request.lastFrame) == "number" then
		lastFrame = request.lastFrame
	end

	local opened, reason = io.open(DUMP_FILE, "wb")
	if not opened then
		-- The replay logger and the run it belongs to carry on without it.
		Spring.Log(LOG_SECTION, "error", "could not open " .. DUMP_FILE .. ": " .. tostring(reason))
		gadgetHandler:RemoveGadget(self)
		return
	end
	file = opened
	file:write("CBRD", PackU32(FORMAT_VERSION))
	writeText(BLOCK_HEADER, header())
end

function gadget:Shutdown()
	if hook and globals.UnsyncedHeightMapUpdate == hook then
		globals.UnsyncedHeightMapUpdate = before
		Script.UpdateCallIn("UnsyncedHeightMapUpdate")
	end
	-- No end block: a file without one is a run that was stopped.
	if file then
		file:close()
		file = nil
	end
end
