-- The track reader against the fixture. small.cbtrack is a track the Rust crate
-- wrote, and expected.lua holds what the Rust reader gives for it. The Rust
-- test crates/coilbox-track/tests/lua_fixture.rs fails when the two drift.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local env = t.syncedEnv()
local Track = t.load("coilbox_track.lua", env)
local Fetch = t.load("coilbox_track_fetch.lua", env)

local function opened(data)
	local track, err = Track.open(Fetch.fromString(data or bytes))
	assert(track, err)
	return track
end

-- Comparing.

local function approx(got, wanted)
	return type(got) == "number" and math.abs(got - wanted) <= 1e-9 * math.max(1, math.abs(wanted))
end

--- The first difference between two values, as text, or nil when there is none.
-- Numbers are compared to a relative 1e-9, since the Rust reader works in
-- doubles and so does LuaJIT.
local function difference(path, got, wanted)
	if type(wanted) == "number" then
		if not approx(got, wanted) then
			return path .. ": got " .. tostring(got) .. ", wanted " .. tostring(wanted)
		end
		return nil
	elseif type(wanted) == "table" then
		if type(got) ~= "table" then
			return path .. ": got " .. tostring(got) .. ", wanted a table"
		end
		for key, value in pairs(wanted) do
			local d = difference(path .. "." .. tostring(key), got[key], value)
			if d then
				return d
			end
		end
		for key in pairs(got) do
			if wanted[key] == nil then
				return path .. "." .. tostring(key) .. ": got a value, wanted none"
			end
		end
		return nil
	elseif got ~= wanted then
		return path .. ": got " .. tostring(got) .. ", wanted " .. tostring(wanted)
	end
end

local function sameAs(name, got, wanted)
	local d = difference("value", got, wanted)
	t.check(name, d == nil, d)
end

-- Header, info, features, terrain.

local track = opened()
local header = track.header
local h = expected.header
sameAs("the header's fields", {
	recorderVersion = header.recorderVersion,
	framesPerSecond = header.framesPerSecond,
	firstFrame = header.firstFrame,
	lastFrame = header.lastFrame,
	windowLength = header.windowLength,
	windowCount = header.windowCount,
	tolerance = header.tolerance,
	positionShift = header.positionShift,
	velocityShift = header.velocityShift,
	rotationBits = header.rotationBits,
	sampleInterval = header.sampleInterval,
	unitCount = header.unitCount,
	projectileCount = header.projectileCount,
	featureCount = header.featureCount,
	gameId = header.gameId,
}, h)

local info, err = track:info()
sameAs("the info chunk", info, expected.info)
t.same("info is the same table on a second call", track:info(), info)

local features = track:features()
sameAs("the features chunk", features, expected.features)

local terrainOk = true
for k = 0, h.windowCount - 1 do
	local rows = expected.terrain[k + 1]
	local terrain = assert(track:terrain(k))
	if terrain.count ~= #rows then
		terrainOk = false
		print("window " .. k .. " has " .. terrain.count .. " terrain rows, wanted " .. #rows)
	end
	for i, row in ipairs(rows) do
		local got = { terrain.frame[i], terrain.x[i], terrain.z[i], terrain.before[i], terrain.after[i] }
		local d = difference("row " .. i, got, row)
		if d then
			terrainOk = false
			print("window " .. k .. " " .. d)
			break
		end
	end
end
t.check("the terrain rows of every window", terrainOk)

-- Frames.

local function unitsOf(ef)
	if not ef.byIndex then
		ef.byIndex = {}
		for _, u in ipairs(ef.units) do
			ef.byIndex[u.index] = u
		end
		ef.projectileByIndex = {}
		for _, p in ipairs(ef.projectiles) do
			ef.projectileByIndex[p.index] = p
		end
	end
	return ef.byIndex, ef.projectileByIndex
end

local out = {}

--- Every unit and projectile of one expected frame against the reader, or the
-- first thing that differs as text.
local function compareFrame(trk, ef)
	local frame = ef.frame
	local w, problem = trk:seek(frame)
	if not w then
		return "seek " .. frame .. ": " .. tostring(problem)
	end
	if w.index ~= ef.window - 1 then
		return "frame " .. frame .. " is in window " .. w.index .. ", wanted " .. (ef.window - 1)
	end
	local units, projectiles = unitsOf(ef)
	local seen = 0
	for i = 1, w.unitCount do
		if w:unitExistsAt(i, frame) then
			seen = seen + 1
			local eu = units[i]
			if not eu then
				return "frame " .. frame .. " has unit " .. i .. ", which Rust does not"
			end
			local at = "frame " .. frame .. " unit " .. i
			local got = {
				index = i,
				serial = w.unitSerial[i],
				engineId = w.unitId[i],
				def = w.unitDef[i],
				team = w.unitTeam[i],
			}
			w:sampleTransform(i, frame, out)
			got.position = { out[1], out[2], out[3] }
			got.rotation = { out[4], out[5], out[6], out[7] }
			w:sampleStatus(i, frame, out)
			got.health, got.build, got.flags = out[1], out[2], out[3]
			got.targets = {}
			for tr = w.unitTargetFirst[i], w.unitTargetFirst[i] + w.unitTargetCount[i] - 1 do
				if w:sampleTarget(tr, frame, out) then
					got.targets[#got.targets + 1] = {
						weapon = w.targetWeapon[tr],
						kind = out[1],
						reference = out[2],
						power = out[3],
						position = { out[4], out[5], out[6] },
					}
				end
			end
			got.poses = {}
			for tr = w.unitPoseFirst[i], w.unitPoseFirst[i] + w.unitPoseCount[i] - 1 do
				if w:samplePose(tr, frame, out) then
					got.poses[#got.poses + 1] = {
						piece = w.posePiece[tr],
						angles = { out[1], out[2], out[3] },
						offsets = { out[4], out[5], out[6] },
					}
				end
			end
			got.queue = {}
			local first, count = w:sampleQueue(i, frame)
			for j = first, first + count - 1 do
				got.queue[#got.queue + 1] = { w.queueItemDef[j], w.queueItemX[j], w.queueItemZ[j], w.queueItemFacing[j] }
			end
			local d = difference(at, got, eu)
			if d then
				return d
			end
		end
	end
	if seen ~= #ef.units then
		return "frame " .. frame .. " has " .. seen .. " units, Rust has " .. #ef.units
	end
	seen = 0
	for p = 1, w.projectileCount do
		if w:projectileExistsAt(p, frame) then
			seen = seen + 1
			local ep = projectiles[p]
			if not ep then
				return "frame " .. frame .. " has projectile " .. p .. ", which Rust does not"
			end
			w:sampleProjectile(p, frame, out)
			local d = difference("frame " .. frame .. " projectile " .. p, {
				index = p,
				serial = w.projectileSerial[p],
				weapon = w.projectileWeapon[p],
				team = w.projectileTeam[p],
				shooter = w.projectileShooter[p],
				position = { out[1], out[2], out[3] },
				velocity = { out[4], out[5], out[6] },
			}, ep)
			if d then
				return d
			end
		end
	end
	if seen ~= #ef.projectiles then
		return "frame " .. frame .. " has " .. seen .. " projectiles, Rust has " .. #ef.projectiles
	end
end

local function pass(name, order)
	local trk = opened()
	for _, i in ipairs(order) do
		local problem = compareFrame(trk, expected.frames[i])
		if problem then
			t.check(name, false, problem)
			return
		end
	end
	t.check(name .. " (" .. #order .. " frames)", true)
end

local forward, backward, shuffled = {}, {}, {}
local count = #expected.frames
for i = 1, count do
	forward[i] = i
	backward[i] = count + 1 - i
	shuffled[i] = i
end
-- A fixed shuffle, so a failure can be run again.
local seed = 3792
for i = count, 2, -1 do
	seed = (seed * 1103515245 + 12345) % 2147483648
	local j = 1 + seed % i
	shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
end

pass("playing forward gives the values Rust gives", forward)
pass("playing backward gives the values Rust gives", backward)
pass("seeking about gives the values Rust gives", shuffled)

-- Playing every frame forward over the first window keeps its cursors honest.
do
	local trk = opened()
	local problem
	local checked = 0
	for _, ef in ipairs(expected.frames) do
		if ef.window == 1 then
			problem = problem or compareFrame(trk, ef)
			checked = checked + 1
		end
	end
	t.check("the first window's frames, one window loaded once", problem == nil and checked > 1, problem)
end

-- Which window a frame is in.

do
	local first, last, length = h.firstFrame, h.lastFrame, h.windowLength
	t.same("the first frame is in window 0", track:windowOf(first), 0)
	t.same("a frame before the first is in window 0", track:windowOf(first - 5), 0)
	t.same("a frame on a boundary is in the later window", track:windowOf(first + length), 1)
	t.same("the frame before a boundary is in the earlier", track:windowOf(first + length - 1), 0)
	t.same("the last frame is in the last window", track:windowOf(last), h.windowCount - 1)
	t.same("a frame past the end is in the last window", track:windowOf(last + 1000), h.windowCount - 1)
end

-- A frame on a boundary is in two windows, and a window can be loaded by number.

do
	local trk = opened()
	local boundary = h.firstFrame + h.windowLength
	local before = assert(trk:loadWindow(0))
	local after = assert(trk:loadWindow(1))
	t.same("a window loaded by number is the current one", trk.window, after)
	t.same("the earlier window ends on the boundary", before.endFrame, boundary)
	t.same("the later window starts on it", after.startFrame, boundary)
	t.same("loading the loaded window again gives the same table", trk:loadWindow(1), after)
	t.same("seek to a frame in the loaded window does not load another", trk:seek(boundary + 3), after)
end

-- Errors. A bad part is an error for that part, and the rest still reads.

local function corrupted(data, from, to, replacement)
	return data:sub(1, from - 1) .. replacement .. data:sub(to + 1)
end

do
	local _, why = Track.open(Fetch.fromString(corrupted(bytes, 1, 4, "NOPE")))
	t.check("a file with the wrong magic is refused by name", why and why:find("magic", 1, true) and why:find("NOPE", 1, true), why)
	_, why = Track.open(Fetch.fromString(corrupted(bytes, 5, 6, string.char(2, 0))))
	t.check("a file of another version is refused by name", why and why:find("version", 1, true) and why:find("2", 1, true), why)
	_, why = Track.open(Fetch.fromString(corrupted(bytes, 7, 8, string.char(95, 0))))
	t.check("a header size under 96 is refused", why and why:find("header size", 1, true), why)
	_, why = Track.open(Fetch.fromString(bytes:sub(1, 60)))
	t.check("a file cut inside the header is refused", why and why:find("ends", 1, true), why)
	_, why = Track.open(Fetch.fromString(bytes:sub(1, 100)))
	t.check("a file cut inside the index is refused", why and why:find("ends", 1, true), why)
	_, why = Track.open(Fetch.fromString(corrupted(bytes, 21, 24, string.char(0, 0, 0, 0))))
	t.check("a window length of 0 is refused", why and why:find("window length", 1, true), why)
	_, why = Track.open(Fetch.fromString(corrupted(bytes, 25, 28, string.char(9, 0, 0, 0))))
	t.check("a window count that does not fit the frames is refused", why and why:find("windows", 1, true), why)
	_, why = Track.open(Fetch.fromString(corrupted(bytes, 35, 35, string.char(7))))
	t.check("rotation bits under 8 are refused", why and why:find("rotation bits", 1, true), why)
	_, why = Track.open(function()
		return nil, "the disk went away"
	end)
	t.check("a fetch that fails is passed on", why and why:find("the disk went away", 1, true), why)
end

do
	-- Spoil window 1's main chunk and leave every other part alone.
	local index = 96
	local function word(at)
		return bytes:byte(at) + bytes:byte(at + 1) * 256 + bytes:byte(at + 2) * 65536
	end
	local entry = index + 16
	local block, length = word(entry + 1), word(entry + 5)
	local from = block * 64 + 1
	local spoiled = corrupted(bytes, from + 8, from + 15, string.rep("\255", 8))
	local trk = opened(spoiled)
	local w1, why = trk:loadWindow(1)
	t.check("a window that will not decompress is an error", w1 == nil and why and why:find("window 1", 1, true), why)
	t.check("the error says what failed", why and why:find("decompress", 1, true), why)
	local w0 = trk:loadWindow(0)
	t.check("the window before it still reads", w0 ~= nil)
	t.check("a failed load leaves the loaded window as it was", trk.window == w0)
	t.check("the window after it still reads", trk:loadWindow(2) ~= nil)
	t.check("the terrain of the spoiled window still reads", trk:terrain(1) ~= nil)
	local _, cut = opened(bytes:sub(1, from + length - 20)):loadWindow(1)
	t.check("a chunk that runs past the end of the file is an error", cut and cut:find("ends", 1, true), cut)
	local _, missing = trk:loadWindow(h.windowCount)
	t.check("a window that is not there is an error", missing and missing:find("no window", 1, true), missing)
	local _, negative = trk:loadWindow(-1)
	t.check("a window below 0 is an error", negative and negative:find("no window", 1, true), negative)
end

-- Fetchers.

do
	local fetch = Fetch.fromString(bytes)
	t.same("fromString gives the bytes at a block", fetch(1, 10), bytes:sub(65, 74))
	t.same("fromString gives nothing past the end of the string", (fetch(100000, 10)), nil)
	local huge, why = fetch(262145, 10)
	t.check("fromString refuses a chunk past the 16,777,216 bytes the engine can address", huge == nil and why and why:find("16,777,216", 1, true), why)
	local straddle, reason = fetch(262143, 128)
	t.check("fromString refuses a chunk that ends past them", straddle == nil and reason and reason:find("16,777,216", 1, true), reason)
	local file = assert(io.open(t.FIXTURES .. "small.cbtrack", "rb"))
	local viaFile = Fetch.fromFile(file)
	t.same("fromFile gives the bytes at a block", viaFile(1, 10), bytes:sub(65, 74))
	t.same("fromFile gives nothing past the end of the file", (viaFile(100000, 10)), nil)
	local fileTrack = assert(Track.open(viaFile))
	local window = assert(fileTrack:loadWindow(2))
	t.same("a track read through io has the same window", window.unitCount, assert(opened():loadWindow(2)).unitCount)
	file:close()
	local gameEnv = t.syncedEnv({ files = { ["coilbox_rewind/track.cbtrack"] = bytes } })
	local GameFetch = t.load("coilbox_track_fetch.lua", gameEnv)
	t.same("the track is looked for where the generated game puts it", GameFetch.PATH, "coilbox_rewind/track.cbtrack")
	t.same("fromVFS reads a track the game holds", assert(Track.open(assert(GameFetch.fromVFS()))).header.lastFrame, h.lastFrame)
	local none, noWhy = GameFetch.fromVFS("coilbox_rewind/other.cbtrack")
	t.check("fromVFS of a missing file says so", none == nil and noWhy and noWhy:find("coilbox_rewind/other.cbtrack", 1, true), noWhy)
end

-- Terrain moves the ground from one frame to another.

do
	local windows = {}
	for k = 0, h.windowCount - 1 do
		windows[k] = assert(track:terrain(k))
	end
	local height = {}
	local function key(x, z)
		return z * 100000 + x
	end
	-- The map's own height is each corner's first height before.
	for k = 0, h.windowCount - 1 do
		local rows = windows[k]
		for i = 1, rows.count do
			local at = key(rows.x[i], rows.z[i])
			if height[at] == nil then
				height[at] = rows.before[i]
			end
		end
	end
	local original = {}
	for at, v in pairs(height) do
		original[at] = v
	end
	local function set(x, z, v)
		height[key(x, z)] = v
	end
	-- A window's rows are the frames after its first, up to its last. Window 0
	-- also holds the rows on the first frame, so the first move starts before it.
	local function edges(k)
		local start = h.firstFrame + k * h.windowLength
		return k == 0 and start - 1 or start, math.min(start + h.windowLength, h.lastFrame)
	end
	-- Forward over every window, then back over every window.
	for k = 0, h.windowCount - 1 do
		local start, finish = edges(k)
		Track.applyTerrain(windows[k], start, finish, set)
	end
	local moved = false
	for at, v in pairs(height) do
		if v ~= original[at] then
			moved = true
		end
	end
	t.check("playing forward changes the ground", moved)
	for k = h.windowCount - 1, 0, -1 do
		local start, finish = edges(k)
		Track.applyTerrain(windows[k], finish, start, set)
	end
	local same = true
	for at, v in pairs(original) do
		if height[at] ~= v then
			same = false
		end
	end
	t.check("playing back lands on the ground it started from", same)
end

-- The edges of a move: a row on a frame is applied by the move that crosses it.

do
	local rows = {
		count = 4,
		frame = { 5, 5, 7, 9 },
		x = { 1, 1, 2, 3 },
		z = { 0, 0, 0, 0 },
		before = { 10, 20, 30, 40 },
		after = { 20, 25, 35, 45 },
	}
	local function applied(from, to)
		local calls = {}
		Track.applyTerrain(rows, from, to, function(x, z, height)
			calls[#calls + 1] = x .. ":" .. height
		end)
		return table.concat(calls, " ")
	end
	t.same("forward over a frame with two rows applies both in order", applied(4, 5), "1:20 1:25")
	t.same("forward from a row's own frame does not apply it again", applied(5, 6), "")
	t.same("forward up to a row's frame applies it", applied(5, 7), "2:35")
	t.same("forward over everything", applied(0, 100), "1:20 1:25 2:35 3:45")
	t.same("back over a frame with two rows applies the befores in reverse", applied(5, 4), "1:20 1:10")
	t.same("back from a row's own frame undoes it", applied(7, 6), "2:30")
	t.same("back down to a row's frame leaves it applied", applied(7, 5), "2:30")
	t.same("back over everything", applied(100, 0), "3:40 2:30 1:20 1:10")
	t.same("no move applies nothing", applied(7, 7), "")
	t.same("a move through a window with no rows applies nothing", select("#", Track.applyTerrain({ count = 0, frame = {} }, 0, 9, error)), 0)
end

t.report()
