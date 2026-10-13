-- Coilbox rewind player: the reader for a replay track.
--
-- A track is a file of recorded curves (units, the pieces they aim with,
-- projectiles, features, terrain and build queues), described in
-- docs/reference/replay-track-format.md. This reads it from inside the engine,
-- one window of frames at a time. It is written from that page, and
-- crates/coilbox-track is the reader it is checked against.
--
-- The way bytes are fetched is passed in (see coilbox_track_fetch.lua), because
-- synced Lua cannot open a file and unsynced Lua can.
--
-- Everything is read with VFS.Unpack*, one call for a column, and
-- VFS.ZlibDecompress. The engine's numbers are 32 bit floats, so no single
-- value here is above 16,777,215 and every position in a file is a multiple of
-- 64. A window is turned into flat tables when it is loaded. Sampling it
-- afterwards allocates nothing: a sample goes into a table the caller owns, and
-- each curve keeps a cursor where it last read, so playing forward does no
-- search.
--
-- Lists are counted from 1: units, projectiles, target tracks, pose tracks,
-- keys and queue items. A definition id, a team and a posed piece are counted
-- from 0 as the file counts them, so the name of unit definition `d` is
-- `info.unitDefs[d + 1]`. Windows are counted from 0, as the format page does.
-- A unit, a projectile or a feature that a target names is a position in the
-- list it is in, counted from 1, and 0 means none.
--
-- Loading a part that is bad returns nil and the reason, and the rest of the
-- track still reads. A call that is wrong in its arguments raises.

local VFS = VFS

local floor, sqrt, min, max = math.floor, math.sqrt, math.min, math.max
local sub, format = string.sub, string.format
local concat = table.concat

local M = {}

--- The codes of the numbers of a team, as `Window:valueOf` takes them. Add
-- `ENERGY` to one of the first nine for energy. A rules parameter is
-- `PARAMETER` plus its place in the info chunk's list, counted from 0.
M.VALUE = {
	HELD = 0,
	STORAGE = 1,
	PULL = 2,
	INCOME = 3,
	EXPENSE = 4,
	SHARE = 5,
	SENT = 6,
	RECEIVED = 7,
	EXCESS = 8,
	ENERGY = 16,
	PARAMETER = 256,
	NO_TEAM = 255,
}

local FORMAT_VERSION = 1
local HEADER_SIZE = 96
local INDEX_ENTRY_SIZE = 16

--- No single value in a track is above this. Past it a 32 bit float is not exact.
local LIMIT = 16777215

--- A narrow value that stands for "the next wide value".
local ESCAPE = -32768

--- A shooter that is not in the window.
local NO_INDEX = 65535

--- 1 / sqrt(2), the largest a kept component of a rotation is.
local SQRT_HALF = 0.7071067811865476

--- The health and build progress of a full or complete unit.
local FULL = 65535

--- How many keys a curve is walked past before the cursor gives up and searches.
local WALK = 8

--- A column that is not in the chunk, shared. Nothing writes to it.
local EMPTY = {}

--- The kinds of target key whose reference is a position in a list. Every other
-- kind has none.
local POINTS_AT = { [1] = true, [2] = true, [4] = true, [16] = true, [17] = true, [18] = true, [19] = true, [20] = true }
local KNOWN_KIND = { [0] = true, [128] = true, [129] = true }
for kind in pairs(POINTS_AT) do
	KNOWN_KIND[kind] = true
end

local Track = {}
Track.__index = Track

local Window = {}
Window.__index = Window

-- A bad part is raised with level 0 and caught where the part is loaded, so it
-- is an error for that part and no more.

local function fail(...)
	error(concat({ ... }), 0)
end

local function protect(what, fn, ...)
	local ok, result = pcall(fn, ...)
	if ok then
		return result
	end
	return nil, what .. ": " .. tostring(result)
end

local function check(condition, ...)
	if not condition then
		fail(...)
	end
end

-- Chunks.

local UNPACK = {
	[1] = VFS.UnpackU8,
	[2] = VFS.UnpackU16,
	[3] = VFS.UnpackS16,
	[4] = VFS.UnpackU32,
	[5] = VFS.UnpackS32,
	[6] = VFS.UnpackF32,
}
local TYPE_NAME = { [1] = "u8", [2] = "u16", [3] = "s16", [4] = "u32", [5] = "s32", [6] = "f32" }

--- The first code of a rules parameter among the numbers of a team. A code
-- below it is a resource.
local PARAMETER = M.VALUE.PARAMETER

--- A decompressed chunk's list of columns. A column of a type this reader does
-- not know is left out, as the format says to.
local function openChunk(bytes)
	local count = VFS.UnpackU32(bytes, 1)
	if not count or count > (#bytes - 4) / 12 then
		fail("it lists ", tostring(count), " columns in ", #bytes, " bytes")
	end
	local chunk = { bytes = bytes, type = {}, offset = {}, count = {} }
	local previous = -1
	for n = 0, count - 1 do
		local at = 5 + 12 * n
		local id, ty = VFS.UnpackU16(bytes, at), VFS.UnpackU16(bytes, at + 2)
		local offset, length = VFS.UnpackU32(bytes, at + 4), VFS.UnpackU32(bytes, at + 8)
		if id <= previous then
			fail("column ", id, " is not in rising order")
		end
		previous = id
		if TYPE_NAME[ty] then
			chunk.type[id], chunk.offset[id], chunk.count[id] = ty, offset, length
		end
	end
	return chunk
end

--- A column's values as a table, or the shared empty one when the chunk has no
-- such column. The table is new, so the caller may change it.
local function column(chunk, id, wanted)
	local ty = chunk.type[id]
	if ty == nil then
		return EMPTY
	end
	if ty ~= wanted then
		fail("column ", id, " is ", TYPE_NAME[ty], ", not ", TYPE_NAME[wanted])
	end
	local n = chunk.count[id]
	if n == 0 then
		return EMPTY
	end
	local values = n <= LIMIT and UNPACK[ty](chunk.bytes, chunk.offset[id] + 1, n)
	if not values or #values ~= n then
		fail("column ", id, " is cut short")
	end
	return values
end

--- A u8 column as the string it holds.
local function text(chunk, id)
	local ty = chunk.type[id]
	if ty == nil then
		return ""
	end
	if ty ~= 1 then
		fail("column ", id, " is ", TYPE_NAME[ty], ", not u8")
	end
	local offset, n = chunk.offset[id], chunk.count[id]
	local s = sub(chunk.bytes, offset + 1, offset + n)
	if #s ~= n then
		fail("column ", id, " is cut short")
	end
	return s
end

local function exactly(values, n, id)
	if #values ~= n then
		fail("column ", id, " has ", #values, " values, not ", n)
	end
	return values
end

--- A list of strings: the length of each as a u16 column, then their bytes end
-- to end as a u8 column.
local function strings(chunk, lengths, bytes)
	local sizes, data = column(chunk, lengths, 2), text(chunk, bytes)
	local out, at = {}, 0
	for i = 1, #sizes do
		local s = sub(data, at + 1, at + sizes[i])
		if #s ~= sizes[i] then
			fail("column ", bytes, " is shorter than the lengths in column ", lengths)
		end
		out[i] = s
		at = at + sizes[i]
	end
	if at ~= #data then
		fail("column ", bytes, " is longer than the lengths in column ", lengths)
	end
	return out
end

-- Curves. A curve is some keys, kept end to end with the keys of the curves
-- like it. `firsts[c]` is where curve `c` starts and `counts[c]` how many keys
-- it has.

--- A count column that is left out when it is 0 for every owner.
local function countsOf(chunk, id, ty, n)
	local values = column(chunk, id, ty)
	if values == EMPTY then
		values = {}
		for i = 1, n do
			values[i] = 0
		end
		return values
	end
	return exactly(values, n, id)
end

--- Where each curve starts, and how many keys they have in all.
local function layout(counts, n)
	local firsts, total = {}, 0
	for c = 1, n do
		firsts[c] = total + 1
		total = total + counts[c]
	end
	return firsts, total
end

--- A time column into frames. A curve's first gap is counted from the window's
-- first frame, and each later gap from the key before.
local function toFrames(times, firsts, counts, n, start, what)
	for c = 1, n do
		local at = start
		local first = firsts[c]
		for j = first, first + counts[c] - 1 do
			local gap = times[j]
			if gap == 0 and j > first then
				fail(what, " has two keys at frame ", at)
			end
			at = at + gap
			times[j] = at
		end
	end
end

--- A narrow column and its wide one into values, times `scale`. This is the
-- "difference with an escape" of the format page: a running value that starts
-- again for each curve, and a wide column that is read on through all of them.
local function escaped(narrow, wide, firsts, counts, n, scale, id)
	local used = 0
	for c = 1, n do
		local running
		local first = firsts[c]
		for j = first, first + counts[c] - 1 do
			local d = narrow[j]
			if d == ESCAPE then
				used = used + 1
				running = wide[used]
				if running == nil then
					fail("column ", id, " runs out of wide values")
				end
			else
				if running == nil then
					fail("a curve's first key is not an escape in column ", id)
				end
				running = running + d
			end
			if running > LIMIT or running < -LIMIT then
				fail("a value of ", running, " in column ", id, " is over ", LIMIT)
			end
			narrow[j] = running * scale
		end
	end
	if used ~= #wide then
		fail("column ", id, " has ", #wide, " wide values and the curves use ", used)
	end
end

--- A u16 column of wrapping differences into values, where each curve starts
-- from 0. With `signed`, 32,768 and over stands for that minus 65,536.
local function wrapped(values, firsts, counts, n, signed)
	for c = 1, n do
		local running = 0
		local first = firsts[c]
		for j = first, first + counts[c] - 1 do
			running = (running + values[j]) % 65536
			values[j] = (signed and running >= 32768) and running - 65536 or running
		end
	end
end

--- The quaternion (x, y, z, w) of a rotation in the smallest three form.
-- `a`, `b` and `c` are the three kept components as whole numbers, and
-- `dropped` says which of x, y, z, w is the fourth.
local function quaternion(dropped, a, b, c, scale)
	local k1, k2, k3 = a * SQRT_HALF / scale, b * SQRT_HALF / scale, c * SQRT_HALF / scale
	local d = sqrt(max(1 - (k1 * k1 + k2 * k2 + k3 * k3), 0))
	if dropped == 0 then
		return d, k1, k2, k3
	elseif dropped == 1 then
		return k1, d, k2, k3
	elseif dropped == 2 then
		return k1, k2, d, k3
	elseif dropped == 3 then
		return k1, k2, k3, d
	end
	fail("a rotation drops component ", dropped)
end

-- Windows.

--- The columns of a window's main chunk as flat tables.
local function decodeWindow(chunk, index, header)
	local start = header.firstFrame + index * header.windowLength
	local posStep, velStep = header.positionStep, header.velocityStep

	local w = setmetatable({
		index = index,
		startFrame = start,
		endFrame = min(start + header.windowLength, header.lastFrame),
		-- How many times a cursor missed and a search ran.
		searches = 0,
	}, Window)

	-- Units.
	local ids = column(chunk, 1, 2)
	local n = #ids
	w.unitCount = n
	w.unitId = ids
	w.unitSerial = exactly(column(chunk, 2, 4), n, 2)
	w.unitDef = exactly(column(chunk, 3, 2), n, 3)
	w.unitTeam = exactly(column(chunk, 4, 1), n, 4)
	w.unitFlags = exactly(column(chunk, 5, 1), n, 5)
	local firsts = exactly(column(chunk, 6, 2), n, 6)
	local lasts = exactly(column(chunk, 7, 2), n, 7)
	for i = 1, n do
		firsts[i] = start + firsts[i]
		lasts[i] = start + lasts[i]
	end
	w.unitFirstFrame, w.unitLastFrame = firsts, lasts
	local transformCount = countsOf(chunk, 8, 2, n)
	local statusCount = countsOf(chunk, 9, 2, n)
	local targetCount = countsOf(chunk, 10, 1, n)
	local poseCount = countsOf(chunk, 11, 2, n)
	local queueCount = countsOf(chunk, 12, 2, n)

	-- Transform keys.
	local transformFirst, total = layout(transformCount, n)
	local times = exactly(column(chunk, 16, 2), total, 16)
	toFrames(times, transformFirst, transformCount, n, start, "the transform keys of a unit")
	local x = exactly(column(chunk, 17, 3), total, 17)
	local y = exactly(column(chunk, 18, 3), total, 18)
	local z = exactly(column(chunk, 19, 3), total, 19)
	escaped(x, column(chunk, 20, 5), transformFirst, transformCount, n, posStep, 20)
	escaped(y, column(chunk, 21, 5), transformFirst, transformCount, n, posStep, 21)
	escaped(z, column(chunk, 22, 5), transformFirst, transformCount, n, posStep, 22)
	local dropped = exactly(column(chunk, 23, 1), total, 23)
	local k1 = exactly(column(chunk, 24, 2), total, 24)
	local k2 = exactly(column(chunk, 25, 2), total, 25)
	local k3 = exactly(column(chunk, 26, 2), total, 26)
	wrapped(k1, transformFirst, transformCount, n, true)
	wrapped(k2, transformFirst, transformCount, n, true)
	wrapped(k3, transformFirst, transformCount, n, true)
	local qx, qy, qz, qw = {}, {}, {}, {}
	for j = 1, total do
		qx[j], qy[j], qz[j], qw[j] = quaternion(dropped[j], k1[j], k2[j], k3[j], header.rotationScale)
	end
	w.transformFirst, w.transformCount, w.transformTime = transformFirst, transformCount, times
	w.transformX, w.transformY, w.transformZ = x, y, z
	w.transformQX, w.transformQY, w.transformQZ, w.transformQW = qx, qy, qz, qw

	-- Status keys.
	local statusFirst
	statusFirst, total = layout(statusCount, n)
	times = exactly(column(chunk, 32, 2), total, 32)
	toFrames(times, statusFirst, statusCount, n, start, "the status keys of a unit")
	local health = exactly(column(chunk, 33, 2), total, 33)
	local build = exactly(column(chunk, 34, 2), total, 34)
	wrapped(health, statusFirst, statusCount, n)
	wrapped(build, statusFirst, statusCount, n)
	w.statusFirst, w.statusCount, w.statusTime = statusFirst, statusCount, times
	w.statusHealth, w.statusBuild = health, build
	w.statusFlags = exactly(column(chunk, 35, 1), total, 35)

	-- Target tracks. A track is one weapon's, or the builder work's.
	local trackFirst, tracks = layout(targetCount, n)
	w.unitTargetFirst, w.unitTargetCount = trackFirst, targetCount
	w.targetWeapon = exactly(column(chunk, 40, 1), tracks, 40)
	local keyCount = exactly(column(chunk, 41, 2), tracks, 41)
	local keyFirst
	keyFirst, total = layout(keyCount, tracks)
	times = exactly(column(chunk, 42, 2), total, 42)
	toFrames(times, keyFirst, keyCount, tracks, start, "a target track of a unit")
	local kinds = exactly(column(chunk, 43, 1), total, 43)
	local refs = exactly(column(chunk, 44, 4), total, 44)
	local places = 0
	for j = 1, total do
		if kinds[j] >= 128 then
			places = places + 1
		end
	end
	local px = exactly(column(chunk, 46, 5), places, 46)
	local py = exactly(column(chunk, 47, 5), places, 47)
	local pz = exactly(column(chunk, 48, 5), places, 48)
	local tx, ty, tz = {}, {}, {}
	local place = 0
	for j = 1, total do
		local kind = kinds[j]
		tx[j], ty[j], tz[j] = 0, 0, 0
		if kind >= 128 then
			place = place + 1
			tx[j], ty[j], tz[j] = px[place] * posStep, py[place] * posStep, pz[place] * posStep
		end
		-- The reference is counted from 1 in the list it points into. A kind this
		-- reader does not know is a target of nothing.
		refs[j] = POINTS_AT[kind] and refs[j] + 1 or 0
		if not KNOWN_KIND[kind] then
			kinds[j] = 0
		end
	end
	w.targetKeyFirst, w.targetKeyCount, w.targetTime = keyFirst, keyCount, times
	w.targetKind, w.targetRef = kinds, refs
	w.targetPower = exactly(column(chunk, 45, 1), total, 45)
	w.targetX, w.targetY, w.targetZ = tx, ty, tz

	-- Pose tracks. A track is one aiming piece.
	trackFirst, tracks = layout(poseCount, n)
	w.unitPoseFirst, w.unitPoseCount = trackFirst, poseCount
	w.posePiece = exactly(column(chunk, 56, 2), tracks, 56)
	keyCount = exactly(column(chunk, 57, 2), tracks, 57)
	keyFirst, total = layout(keyCount, tracks)
	times = exactly(column(chunk, 58, 2), total, 58)
	toFrames(times, keyFirst, keyCount, tracks, start, "a pose track of a unit")
	local angles, offsets = {}, {}
	for axis = 1, 3 do
		angles[axis] = exactly(column(chunk, 58 + axis, 3), total, 58 + axis)
		escaped(angles[axis], column(chunk, 61 + axis, 5), keyFirst, keyCount, tracks, 1, 61 + axis)
		offsets[axis] = exactly(column(chunk, 64 + axis, 3), total, 64 + axis)
		escaped(offsets[axis], column(chunk, 67 + axis, 5), keyFirst, keyCount, tracks, posStep, 67 + axis)
	end
	w.poseKeyFirst, w.poseKeyCount, w.poseTime = keyFirst, keyCount, times
	w.poseAX, w.poseAY, w.poseAZ = angles[1], angles[2], angles[3]
	w.poseOX, w.poseOY, w.poseOZ = offsets[1], offsets[2], offsets[3]

	-- Build queue keys. A key is a whole queue, held until the next.
	local queueFirst
	queueFirst, total = layout(queueCount, n)
	w.unitQueueFirst, w.unitQueueCount = queueFirst, queueCount
	times = exactly(column(chunk, 72, 2), total, 72)
	toFrames(times, queueFirst, queueCount, n, start, "the build queue of a unit")
	local lengths = exactly(column(chunk, 73, 1), total, 73)
	local itemFirst, items = layout(lengths, total)
	local itemX = exactly(column(chunk, 75, 5), items, 75)
	local itemZ = exactly(column(chunk, 76, 5), items, 76)
	for j = 1, items do
		itemX[j], itemZ[j] = itemX[j] * posStep, itemZ[j] * posStep
	end
	w.queueTime, w.queueItemFirst, w.queueItemCount = times, itemFirst, lengths
	w.queueItemDef = exactly(column(chunk, 74, 2), items, 74)
	w.queueItemX, w.queueItemZ = itemX, itemZ
	w.queueItemFacing = exactly(column(chunk, 77, 1), items, 77)

	-- Projectiles.
	local serials = column(chunk, 80, 4)
	n = #serials
	w.projectileCount = n
	w.projectileSerial = serials
	w.projectileWeapon = exactly(column(chunk, 81, 2), n, 81)
	w.projectileTeam = exactly(column(chunk, 82, 1), n, 82)
	w.projectileFlags = exactly(column(chunk, 83, 1), n, 83)
	local shooters = exactly(column(chunk, 84, 2), n, 84)
	for i = 1, n do
		shooters[i] = shooters[i] == NO_INDEX and 0 or shooters[i] + 1
	end
	w.projectileShooter = shooters
	firsts = exactly(column(chunk, 85, 2), n, 85)
	lasts = exactly(column(chunk, 86, 2), n, 86)
	-- Whether the entries are in the order they were born in, which is what lets
	-- `projectileRange` search them, and the longest any of them lasts here.
	local ordered, longest = true, 0
	for i = 1, n do
		firsts[i] = start + firsts[i]
		lasts[i] = start + lasts[i]
		if i > 1 and firsts[i] < firsts[i - 1] then
			ordered = false
		end
		if lasts[i] - firsts[i] > longest then
			longest = lasts[i] - firsts[i]
		end
	end
	w.projectileFirstFrame, w.projectileLastFrame = firsts, lasts
	w.projectileOrdered, w.projectileLongest = ordered, longest
	local projectileCount = exactly(column(chunk, 87, 2), n, 87)
	local projectileFirst
	projectileFirst, total = layout(projectileCount, n)
	times = exactly(column(chunk, 88, 2), total, 88)
	toFrames(times, projectileFirst, projectileCount, n, start, "a projectile")
	local p, v = {}, {}
	for axis = 1, 3 do
		p[axis] = exactly(column(chunk, 88 + axis, 3), total, 88 + axis)
		escaped(p[axis], column(chunk, 91 + axis, 5), projectileFirst, projectileCount, n, posStep, 91 + axis)
		v[axis] = exactly(column(chunk, 94 + axis, 3), total, 94 + axis)
		escaped(v[axis], column(chunk, 97 + axis, 5), projectileFirst, projectileCount, n, velStep, 97 + axis)
	end
	w.projectileKeyFirst, w.projectileKeyCount, w.projectileTime = projectileFirst, projectileCount, times
	w.projectileX, w.projectileY, w.projectileZ = p[1], p[2], p[3]
	w.projectileVX, w.projectileVY, w.projectileVZ = v[1], v[2], v[3]

	-- The numbers of the teams and of the game: what a team holds, the rest of
	-- its economy and rules parameters. A track is one number of one team. A
	-- track from before recorder version 4 has none.
	local valueTeam = column(chunk, 104, 1)
	local values = #valueTeam
	w.valueCount = values
	w.valueTeam = valueTeam
	w.valueCode = exactly(column(chunk, 105, 2), values, 105)
	local valueKeyCount = exactly(column(chunk, 106, 2), values, 106)
	local valueKeyFirst
	valueKeyFirst, total = layout(valueKeyCount, values)
	times = exactly(column(chunk, 107, 2), total, 107)
	toFrames(times, valueKeyFirst, valueKeyCount, values, start, "a number of a team")
	w.valueKeyFirst, w.valueKeyCount, w.valueTime = valueKeyFirst, valueKeyCount, times
	w.valueValue = exactly(column(chunk, 108, 6), total, 108)
	-- By team and code, as one number: a team is under 256 and a code under
	-- 65,536, so the two together are under 16,777,216.
	w.valueIndex, w.valueCursor = {}, {}
	for v = 1, values do
		w.valueIndex[valueTeam[v] * 65536 + w.valueCode[v]] = v
		w.valueCursor[v] = valueKeyFirst[v]
	end

	-- A cursor for each curve, at its first key.
	w.transformCursor, w.statusCursor, w.queueCursor = {}, {}, {}
	for i = 1, w.unitCount do
		w.transformCursor[i], w.statusCursor[i], w.queueCursor[i] = transformFirst[i], statusFirst[i], queueFirst[i]
	end
	w.targetCursor, w.poseCursor, w.projectileCursor = {}, {}, {}
	for c = 1, #w.targetKeyFirst do
		w.targetCursor[c] = w.targetKeyFirst[c]
	end
	for c = 1, #w.poseKeyFirst do
		w.poseCursor[c] = w.poseKeyFirst[c]
	end
	for c = 1, n do
		w.projectileCursor[c] = projectileFirst[c]
	end
	return w
end

--- Where a frame is among a curve's keys: the index of the last key at or before
-- it, or the first key when the frame is before them all. The cursor is where
-- the curve was last read. A frame a few keys either side of it, which is
-- playing in either direction, is found by looking at the keys next to it.
-- Anything further is searched for, and the search is counted.
local function locate(w, times, first, last, cursor, frame)
	local lo, hi
	if times[cursor] <= frame then
		for _ = 1, WALK do
			if cursor == last or times[cursor + 1] > frame then
				return cursor
			end
			cursor = cursor + 1
		end
		lo, hi = cursor, last
	else
		if cursor == first then
			return first
		end
		for _ = 1, WALK do
			cursor = cursor - 1
			if times[cursor] <= frame then
				return cursor
			end
			if cursor == first then
				return first
			end
		end
		lo, hi = first, cursor
	end
	w.searches = w.searches + 1
	while lo < hi do
		local mid = floor((lo + hi + 1) / 2)
		if times[mid] <= frame then
			lo = mid
		else
			hi = mid - 1
		end
	end
	return lo
end

--- Whether unit `i` exists at `frame`.
function Window:unitExistsAt(i, frame)
	return frame >= self.unitFirstFrame[i] and frame <= self.unitLastFrame[i]
end

--- Whether projectile `p` exists at `frame`.
function Window:projectileExistsAt(p, frame)
	return frame >= self.projectileFirstFrame[p] and frame <= self.projectileLastFrame[p]
end

--- Unit `i`'s place and rotation at `frame`, written to `out` as x, y, z in
-- elmos then the quaternion x, y, z, w. A straight line for place, and for
-- rotation the two quaternions blended in the same proportion and scaled back to
-- unit length, the second negated first when their dot product is negative.
-- False when the unit has no key, which a good track never does.
function Window:sampleTransform(i, frame, out)
	local n = self.transformCount[i]
	if n == 0 then
		return false
	end
	local first = self.transformFirst[i]
	local times = self.transformTime
	local a = locate(self, times, first, first + n - 1, self.transformCursor[i], frame)
	self.transformCursor[i] = a
	local ta = times[a]
	local xs, ys, zs = self.transformX, self.transformY, self.transformZ
	local qx, qy, qz, qw = self.transformQX, self.transformQY, self.transformQZ, self.transformQW
	if ta >= frame or a == first + n - 1 then
		out[1], out[2], out[3] = xs[a], ys[a], zs[a]
		out[4], out[5], out[6], out[7] = qx[a], qy[a], qz[a], qw[a]
		return true
	end
	local b = a + 1
	local s = (frame - ta) / (times[b] - ta)
	out[1] = xs[a] + (xs[b] - xs[a]) * s
	out[2] = ys[a] + (ys[b] - ys[a]) * s
	out[3] = zs[a] + (zs[b] - zs[a]) * s
	local ax, ay, az, aw = qx[a], qy[a], qz[a], qw[a]
	local bx, by, bz, bw = qx[b], qy[b], qz[b], qw[b]
	local sign = (ax * bx + ay * by + az * bz + aw * bw) < 0 and -1 or 1
	local r = 1 - s
	local x, y, z, u = ax * r + sign * bx * s, ay * r + sign * by * s, az * r + sign * bz * s, aw * r + sign * bw * s
	local length = sqrt(x * x + y * y + z * z + u * u)
	if length > 0 then
		out[4], out[5], out[6], out[7] = x / length, y / length, z / length, u / length
	else
		out[4], out[5], out[6], out[7] = ax, ay, az, aw
	end
	return true
end

--- Unit `i`'s health and build progress at `frame` as fractions from 0 to 1,
-- then its flags (bit 0: switched on), written to `out`. The fractions run in a
-- straight line between keys and the flags hold until the next.
function Window:sampleStatus(i, frame, out)
	local n = self.statusCount[i]
	if n == 0 then
		return false
	end
	local first = self.statusFirst[i]
	local times = self.statusTime
	local a = locate(self, times, first, first + n - 1, self.statusCursor[i], frame)
	self.statusCursor[i] = a
	local ta = times[a]
	local health, build = self.statusHealth, self.statusBuild
	out[3] = self.statusFlags[a]
	if ta >= frame or a == first + n - 1 then
		out[1], out[2] = health[a] / FULL, build[a] / FULL
		return true
	end
	local b = a + 1
	local s = (frame - ta) / (times[b] - ta)
	out[1] = (health[a] + (health[b] - health[a]) * s) / FULL
	out[2] = (build[a] + (build[b] - build[a]) * s) / FULL
	return true
end

--- Target track `track` (counted over the whole window, from
-- `unitTargetFirst[i]`) at `frame`, written to `out` as the kind, the reference,
-- the build power, then x, y, z in elmos. A target holds until the next key.
-- False when the track has no key.
function Window:sampleTarget(track, frame, out)
	local n = self.targetKeyCount[track]
	if n == 0 then
		return false
	end
	local first = self.targetKeyFirst[track]
	local a = locate(self, self.targetTime, first, first + n - 1, self.targetCursor[track], frame)
	self.targetCursor[track] = a
	out[1], out[2], out[3] = self.targetKind[a], self.targetRef[a], self.targetPower[a]
	out[4], out[5], out[6] = self.targetX[a], self.targetY[a], self.targetZ[a]
	return true
end

--- Pose track `track` (counted over the whole window, from `unitPoseFirst[i]`)
-- at `frame`, written to `out` as the turns about x, y and z in 65,536ths of a
-- turn, then the offsets in elmos. All six run in a straight line between keys.
-- False when the track has no key.
function Window:samplePose(track, frame, out)
	local n = self.poseKeyCount[track]
	if n == 0 then
		return false
	end
	local first = self.poseKeyFirst[track]
	local times = self.poseTime
	local a = locate(self, times, first, first + n - 1, self.poseCursor[track], frame)
	self.poseCursor[track] = a
	local ax, ay, az, ox, oy, oz = self.poseAX, self.poseAY, self.poseAZ, self.poseOX, self.poseOY, self.poseOZ
	local ta = times[a]
	if ta >= frame or a == first + n - 1 then
		out[1], out[2], out[3], out[4], out[5], out[6] = ax[a], ay[a], az[a], ox[a], oy[a], oz[a]
		return true
	end
	local b = a + 1
	local s = (frame - ta) / (times[b] - ta)
	out[1] = ax[a] + (ax[b] - ax[a]) * s
	out[2] = ay[a] + (ay[b] - ay[a]) * s
	out[3] = az[a] + (az[b] - az[a]) * s
	out[4] = ox[a] + (ox[b] - ox[a]) * s
	out[5] = oy[a] + (oy[b] - oy[a]) * s
	out[6] = oz[a] + (oz[b] - oz[a]) * s
	return true
end

--- Unit `i`'s build queue at `frame`, as the first item and the number of items.
-- The items are in `queueItemDef`, `queueItemX`, `queueItemZ` and
-- `queueItemFacing`. A queue holds until the next key.
function Window:sampleQueue(i, frame)
	local n = self.unitQueueCount[i]
	if n == 0 then
		return 1, 0
	end
	local first = self.unitQueueFirst[i]
	local a = locate(self, self.queueTime, first, first + n - 1, self.queueCursor[i], frame)
	self.queueCursor[i] = a
	return self.queueItemFirst[a], self.queueItemCount[a]
end

--- The track of one number of a team in this window, or nil when the window
-- has none. `team` is the team's id, or 255 for a number that is the game's.
-- `code` is the file's: 0 to 8 for the metal a team holds, its storage, pull,
-- income, expense, share level, sent, received and excess, 16 to 24 for the
-- same of energy, and 256 and up for a rules parameter, counted from the info
-- chunk's first name. A resource with no track is 0 for the whole window. A
-- rules parameter with none had not been set by the window's end.
function Window:valueOf(team, code)
	return self.valueIndex[team * 65536 + code]
end

--- Track `v` of the team numbers at `frame`, in a straight line between keys.
-- Nothing for a rules parameter before the frame it was first set on, and for a
-- track with no key, which a good track never has.
function Window:sampleValue(v, frame)
	local n = self.valueKeyCount[v]
	if n == 0 then
		return nil
	end
	local first = self.valueKeyFirst[v]
	local times = self.valueTime
	if frame < times[first] and self.valueCode[v] >= PARAMETER then
		return nil
	end
	local a = locate(self, times, first, first + n - 1, self.valueCursor[v], frame)
	self.valueCursor[v] = a
	local values = self.valueValue
	local ta = times[a]
	if ta >= frame or a == first + n - 1 then
		return values[a]
	end
	local b = a + 1
	return values[a] + (values[b] - values[a]) * ((frame - ta) / (times[b] - ta))
end

--- The first position in the projectiles whose first frame is `frame` or
-- later, or one past the end. Only for a window whose entries are in order.
local function bornFrom(self, frame)
	local firsts = self.projectileFirstFrame
	local lo, hi = 1, self.projectileCount + 1
	while lo < hi do
		local mid = math.floor((lo + hi) / 2)
		if firsts[mid] < frame then
			lo = mid + 1
		else
			hi = mid
		end
	end
	return lo
end

--- The first position in the projectiles whose first frame is after `frame`,
-- or one past the end.
local function bornAfter(self, frame)
	local firsts = self.projectileFirstFrame
	local lo, hi = 1, self.projectileCount + 1
	while lo < hi do
		local mid = math.floor((lo + hi) / 2)
		if firsts[mid] <= frame then
			lo = mid + 1
		else
			hi = mid
		end
	end
	return lo
end

--- The positions `from, to` between which every projectile that exists at
-- `frame` lies, found by two searches on the first frame and no walk of the
-- list. Not every position between them exists at `frame`, so ask
-- `projectileExistsAt`. `from` is past `to` when there can be none.
--
-- A projectile that exists at `frame` was born at or before it, and no earlier
-- than the longest life in the window before it. A writer is not held to
-- writing the entries in the order they were born in, though coilbox's does,
-- and for a window that is not, this gives the whole list.
function Window:projectileRange(frame)
	if not self.projectileOrdered then
		return 1, self.projectileCount
	end
	return bornFrom(self, frame - self.projectileLongest), bornAfter(self, frame) - 1
end

--- The positions `from, to` of the projectiles whose first frame is after
-- `after` and no later than `frame`, in a window whose entries are in order.
-- In one that is not, the whole list, so check the first frame of each. An
-- entry with bit 0 of its flags set was born in an earlier window, whatever its
-- first frame here.
function Window:projectilesBorn(after, frame)
	if not self.projectileOrdered then
		return 1, self.projectileCount
	end
	return bornAfter(self, after), bornAfter(self, frame) - 1
end

--- Projectile `p` at `frame`, written to `out` as x, y, z in elmos then the
-- velocity in elmos a frame. Between two keys `n` frames apart the place is the
-- cubic through both that matches both velocities, and the velocity is the
-- slope of the cubic divided by `n`.
function Window:sampleProjectile(p, frame, out)
	local count = self.projectileKeyCount[p]
	if count == 0 then
		return false
	end
	local first = self.projectileKeyFirst[p]
	local times = self.projectileTime
	local a = locate(self, times, first, first + count - 1, self.projectileCursor[p], frame)
	self.projectileCursor[p] = a
	local px, py, pz = self.projectileX, self.projectileY, self.projectileZ
	local vx, vy, vz = self.projectileVX, self.projectileVY, self.projectileVZ
	local ta = times[a]
	if ta >= frame or a == first + count - 1 then
		out[1], out[2], out[3], out[4], out[5], out[6] = px[a], py[a], pz[a], vx[a], vy[a], vz[a]
		return true
	end
	local b = a + 1
	local n = times[b] - ta
	local s = (frame - ta) / n
	local s2 = s * s
	local s3 = s2 * s
	local h00, h10, h01, h11 = 2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2
	local d00, d10, d01, d11 = 6 * s2 - 6 * s, 3 * s2 - 4 * s + 1, -6 * s2 + 6 * s, 3 * s2 - 2 * s
	out[1] = h00 * px[a] + h10 * n * vx[a] + h01 * px[b] + h11 * n * vx[b]
	out[2] = h00 * py[a] + h10 * n * vy[a] + h01 * py[b] + h11 * n * vy[b]
	out[3] = h00 * pz[a] + h10 * n * vz[a] + h01 * pz[b] + h11 * n * vz[b]
	out[4] = (d00 * px[a] + d10 * n * vx[a] + d01 * px[b] + d11 * n * vx[b]) / n
	out[5] = (d00 * py[a] + d10 * n * vy[a] + d01 * py[b] + d11 * n * vy[b]) / n
	out[6] = (d00 * pz[a] + d10 * n * vz[a] + d01 * pz[b] + d11 * n * vz[b]) / n
	return true
end

-- The track.

--- Fetches `length` bytes at `block` or raises with the fetcher's reason.
local function need(fetch, block, length, what)
	local bytes, why = fetch(block, length)
	if not bytes then
		fail(what, ": ", tostring(why))
	end
	return bytes
end

local function readHeader(fetch)
	local head = need(fetch, 0, HEADER_SIZE, "the header")
	local magic = sub(head, 1, 4)
	check(magic == "CBTK", "the magic is ", format("%q", magic), ", not \"CBTK\"")
	local version = VFS.UnpackU16(head, 5)
	check(version == FORMAT_VERSION, "the format version is ", version, " and this reader knows ", FORMAT_VERSION)
	local size = VFS.UnpackU16(head, 7)
	check(size >= HEADER_SIZE, "the header size is ", size, ", under ", HEADER_SIZE)

	local h = {
		headerSize = size,
		recorderVersion = VFS.UnpackU16(head, 9),
		framesPerSecond = VFS.UnpackU16(head, 11),
		firstFrame = VFS.UnpackU32(head, 13),
		lastFrame = VFS.UnpackU32(head, 17),
		windowLength = VFS.UnpackU32(head, 21),
		windowCount = VFS.UnpackU32(head, 25),
		tolerance = VFS.UnpackF32(head, 29),
		positionShift = VFS.UnpackU8(head, 33),
		velocityShift = VFS.UnpackU8(head, 34),
		rotationBits = VFS.UnpackU8(head, 35),
		sampleInterval = VFS.UnpackU8(head, 36),
		info = { block = VFS.UnpackU32(head, 37), length = VFS.UnpackU32(head, 41) },
		features = { block = VFS.UnpackU32(head, 45), length = VFS.UnpackU32(head, 49) },
		unitCount = VFS.UnpackU32(head, 53),
		projectileCount = VFS.UnpackU32(head, 57),
		featureCount = VFS.UnpackU32(head, 61),
		-- Both 0 in a track from before recorder version 4, which holds no team
		-- resources and has zero bytes here.
		resourceTolerance = VFS.UnpackF32(head, 81),
		resourceFraction = VFS.UnpackF32(head, 85),
	}
	local id = {}
	for i = 65, 80 do
		id[#id + 1] = format("%02x", head:byte(i))
	end
	h.gameId = concat(id)

	check(h.windowLength >= 1 and h.windowLength <= 65535, "the window length is ", h.windowLength)
	check(h.lastFrame >= h.firstFrame, "the last frame, ", h.lastFrame, ", is before the first, ", h.firstFrame)
	check(h.rotationBits >= 8 and h.rotationBits <= 16, "the rotation bits are ", h.rotationBits)
	local windows = max(1, math.ceil((h.lastFrame - h.firstFrame) / h.windowLength))
	check(h.windowCount == windows, "it says ", h.windowCount, " windows, but its frames and window length make ", windows)
	h.positionStep = 2 ^ -h.positionShift
	h.velocityStep = 2 ^ -h.velocityShift
	h.rotationScale = 2 ^ (h.rotationBits - 1) - 1

	-- The index follows the header, and the header size is where it starts.
	local whole = need(fetch, 0, size + INDEX_ENTRY_SIZE * h.windowCount, "the window index")
	local words = VFS.UnpackU32(whole, size + 1, 4 * h.windowCount)
	check(words and #words == 4 * h.windowCount, "the window index is cut short")
	h.index = words
	return h
end

--- Opens a track from a fetch function (see coilbox_track_fetch.lua). This reads
-- the header and the window index and nothing else. It gives the track, or nil
-- and the reason when the file is not one this reader can read.
function M.open(fetch)
	local header, why = protect("the track", readHeader, fetch)
	if not header then
		return nil, why
	end
	return setmetatable({ header = header, fetch = fetch, window = nil }, Track)
end

--- The window that holds `frame`. A frame on the boundary between two windows is
-- in both, and this gives the later. A frame before the first is in window 0 and
-- one past the last is in the last window.
function Track:windowOf(frame)
	local h = self.header
	if frame <= h.firstFrame then
		return 0
	end
	return min(floor((frame - h.firstFrame) / h.windowLength), h.windowCount - 1)
end

--- Where a part of window `k` is, from the index. `which` is 0 for the main
-- chunk and 2 for the terrain chunk.
local function extent(self, k, which)
	local words = self.header.index
	local at = 4 * k + which
	return words[at + 1], words[at + 2]
end

local function readChunk(self, block, length)
	check(length > 0, "it is not in the file")
	check(length <= LIMIT and block <= LIMIT, "the index puts it at block ", block, " with length ", length)
	local packed = need(self.fetch, block, length, "the file")
	local ok, bytes = pcall(VFS.ZlibDecompress, packed)
	check(ok, "it does not decompress (", tostring(bytes), ")")
	return openChunk(bytes)
end

local function windowExists(self, k)
	return type(k) == "number" and k >= 0 and k < self.header.windowCount and k == floor(k)
end

local function noWindow(self, k)
	return nil, "there is no window " .. tostring(k) .. ", only " .. self.header.windowCount
end

--- Loads window `k` and makes it the current window, or gives the one already
-- loaded. A window that cannot be read gives nil and the reason, and leaves the
-- current window as it was.
function Track:loadWindow(k)
	if not windowExists(self, k) then
		return noWindow(self, k)
	end
	local current = self.window
	if current and current.index == k then
		return current
	end
	local w, why = protect("window " .. k .. " main chunk", function()
		local block, length = extent(self, k, 0)
		return decodeWindow(readChunk(self, block, length), k, self.header)
	end)
	if not w then
		return nil, why
	end
	self.window = w
	return w
end

--- Makes the window that holds `frame` the current one and gives it.
function Track:seek(frame)
	return self:loadWindow(self:windowOf(frame))
end

--- The text of the track and the names its definitions go by. The first time
-- this is called it reads the info chunk. The table is kept.
function Track:info()
	if self.infoTable then
		return self.infoTable
	end
	local h = self.header
	local info, why = protect("info chunk", function()
		local chunk = readChunk(self, h.info.block, h.info.length)
		local texts = strings(chunk, 160, 161)
		check(#texts >= 4, "it has ", #texts, " lines of track text, not 4")
		local piece = {
			engineVersion = texts[1],
			game = texts[2],
			map = texts[3],
			writer = texts[4],
			unitDefs = strings(chunk, 162, 163),
			weaponDefs = strings(chunk, 164, 165),
			featureDefs = strings(chunk, 166, 167),
			posedPieces = {},
			teams = {},
			unitFootprints = {},
		}
		local defs, counts = column(chunk, 168, 2), column(chunk, 169, 2)
		check(#defs == #counts, "columns 168 and 169 have different lengths")
		local names = strings(chunk, 170, 171)
		local at = 0
		for i = 1, #defs do
			local pieces = {}
			for j = 1, counts[i] do
				pieces[j] = names[at + j]
				check(pieces[j], "column 170 has fewer names than column 169 counts")
			end
			at = at + counts[i]
			piece.posedPieces[i] = { unitDef = defs[i], pieces = pieces }
		end
		local ids = column(chunk, 172, 1)
		local ally, flags, colour = column(chunk, 173, 1), column(chunk, 174, 1), column(chunk, 175, 1)
		local sides, leaders = strings(chunk, 176, 177), strings(chunk, 178, 179)
		local n = #ids
		check(#ally == n and #flags == n and #sides == n and #leaders == n and #colour == 3 * n, "the team columns have different lengths")
		for i = 1, n do
			piece.teams[i] = {
				id = ids[i],
				allyTeam = ally[i],
				flags = flags[i],
				colour = { colour[3 * i - 2], colour[3 * i - 1], colour[3 * i] },
				side = sides[i],
				leader = leaders[i],
			}
		end
		local size = column(chunk, 180, 4)
		check(#size == 0 or #size == 2, "column 180 does not have two values")
		piece.mapSize = { size[1] or 0, size[2] or 0 }
		-- A track from before recorder version 3 has no footprints.
		local across, along = column(chunk, 181, 2), column(chunk, 182, 2)
		check(#across == #along and (#across == 0 or #across == #piece.unitDefs), "columns 181 and 182 do not hold a footprint for each unit definition")
		for i = 1, #across do
			piece.unitFootprints[i] = { across[i], along[i] }
		end
		-- A track from before recorder version 4 names no rules parameters.
		piece.teamParams = strings(chunk, 183, 184)
		piece.gameParams = strings(chunk, 185, 186)
		return piece
	end)
	if not info then
		return nil, why
	end
	self.infoTable = info
	return info
end

--- Every feature of the match, in a list. A feature exists at frame `f` when
-- `firstFrame <= f` and `f <= lastFrame`. Its position is in elmos and its
-- rotation is (x, y, z, w). The table is kept.
function Track:features()
	if self.featureList then
		return self.featureList
	end
	local h = self.header
	local list, why = protect("features chunk", function()
		local chunk = readChunk(self, h.features.block, h.features.length)
		local ids = column(chunk, 128, 2)
		local n = #ids
		local defs = exactly(column(chunk, 129, 2), n, 129)
		local teams = exactly(column(chunk, 130, 1), n, 130)
		local flags = exactly(column(chunk, 131, 1), n, 131)
		local first = exactly(column(chunk, 132, 4), n, 132)
		local last = exactly(column(chunk, 133, 4), n, 133)
		local pos = {
			exactly(column(chunk, 134, 5), n, 134),
			exactly(column(chunk, 135, 5), n, 135),
			exactly(column(chunk, 136, 5), n, 136),
		}
		local dropped = exactly(column(chunk, 137, 1), n, 137)
		local kept = {
			exactly(column(chunk, 138, 2), n, 138),
			exactly(column(chunk, 139, 2), n, 139),
			exactly(column(chunk, 140, 2), n, 140),
		}
		local out = {}
		for i = 1, n do
			-- The kept components are stored as 16 bit two's complement.
			local a, b, c = kept[1][i], kept[2][i], kept[3][i]
			a, b, c = a >= 32768 and a - 65536 or a, b >= 32768 and b - 65536 or b, c >= 32768 and c - 65536 or c
			local x, y, z, w = quaternion(dropped[i], a, b, c, h.rotationScale)
			out[i] = {
				engineId = ids[i],
				def = defs[i],
				team = teams[i],
				flags = flags[i],
				firstFrame = first[i],
				lastFrame = last[i],
				position = { pos[1][i] * h.positionStep, pos[2][i] * h.positionStep, pos[3][i] * h.positionStep },
				rotation = { x, y, z, w },
			}
		end
		return out
	end)
	if not list then
		return nil, why
	end
	self.featureList = list
	return list
end

--- The terrain rows of window `k` as parallel lists: `frame`, `x`, `z`, `before`
-- and `after`, with `count` rows. The heights are in elmos, x and z count
-- heightmap corners, and the rows are in order of frame. A window where no
-- terrain changed has no rows. Rows are read when asked for and not kept.
function Track:terrain(k)
	if not windowExists(self, k) then
		return noWindow(self, k)
	end
	local block, length = extent(self, k, 2)
	if length == 0 then
		return { count = 0, frame = {}, x = {}, z = {}, before = {}, after = {} }
	end
	local h = self.header
	return protect("window " .. k .. " terrain chunk", function()
		local chunk = readChunk(self, block, length)
		local gap = column(chunk, 112, 2)
		local n = #gap
		local xs = exactly(column(chunk, 113, 2), n, 113)
		local zs = exactly(column(chunk, 114, 2), n, 114)
		local before = exactly(column(chunk, 115, 5), n, 115)
		local delta = exactly(column(chunk, 116, 5), n, 116)
		local frame = h.firstFrame + k * h.windowLength
		local x, z, height = 0, 0, 0
		for i = 1, n do
			frame = frame + gap[i]
			x = (x + xs[i]) % 65536
			z = (z + zs[i]) % 65536
			height = height + before[i]
			local after = height + delta[i]
			check(height <= LIMIT and height >= -LIMIT and after <= LIMIT and after >= -LIMIT, "a height is over ", LIMIT)
			gap[i], xs[i], zs[i] = frame, x, z
			before[i], delta[i] = height * h.positionStep, after * h.positionStep
		end
		return { count = n, frame = gap, x = xs, z = zs, before = before, after = delta }
	end)
end

--- Moves the ground from frame `from` to frame `to` by calling `set(x, z,
-- height)` for each corner and the height it takes. `rows` are one window's
-- terrain rows. Going forward, a corner takes its height after for every row
-- with a frame after `from` and up to `to`, in order. Going back, it takes its
-- height before for every row with a frame after `to` and up to `from`, in
-- reverse order. A move across several windows calls this for each of them, in
-- order going forward and in reverse order going back. Window 0 also holds the
-- rows on the track's first frame, so the first move forward starts from the
-- frame before it.
function M.applyTerrain(rows, from, to, set)
	local frames, n = rows.frame, rows.count
	-- The first row with a frame after `from`.
	local lo, hi = 1, n + 1
	while lo < hi do
		local mid = floor((lo + hi) / 2)
		if frames[mid] > from then
			hi = mid
		else
			lo = mid + 1
		end
	end
	if from < to then
		local xs, zs, after = rows.x, rows.z, rows.after
		for i = lo, n do
			if frames[i] > to then
				break
			end
			set(xs[i], zs[i], after[i])
		end
	else
		local xs, zs, before = rows.x, rows.z, rows.before
		for i = lo - 1, 1, -1 do
			if frames[i] <= to then
				break
			end
			set(xs[i], zs[i], before[i])
		end
	end
end

return M
