-- Playing a track: sampling allocates nothing, forward play does no search, and
-- a minute of play does not grow memory.
--
-- A minute is 1,800 frames at the engine's 30 frames a second. The fixture has
-- 4 windows of 600 frames, so a minute crosses three window loads.
--
-- Allocation is counted with the collector stopped, where collectgarbage("count")
-- is exact, and not with a limit chosen by hand.

-- The engine runs plain Lua 5.1, which has no tracing compiler. LuaJIT's builds
-- traces as a loop gets hot, and those are memory the count would show.
if jit then
	jit.off()
end

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local env = t.syncedEnv()
local Track = t.load("coilbox_track.lua", env)
local Fetch = t.load("coilbox_track_fetch.lua", env)

local header = expected.header
local FRAMES = 30 * 60

local function opened()
	return assert(Track.open(Fetch.fromString(bytes)))
end

-- The caller's buffer. It is given its slots before play, so that writing to it
-- does not grow it.
local out = { 0, 0, 0, 0, 0, 0, 0 }

--- Every curve of every unit and projectile that exists at `frame`, sampled into
-- `out`. It makes no table of its own.
local function sampleAll(w, frame)
	for i = 1, w.unitCount do
		if w:unitExistsAt(i, frame) then
			w:sampleTransform(i, frame, out)
			w:sampleStatus(i, frame, out)
			for tr = w.unitTargetFirst[i], w.unitTargetFirst[i] + w.unitTargetCount[i] - 1 do
				w:sampleTarget(tr, frame, out)
			end
			for tr = w.unitPoseFirst[i], w.unitPoseFirst[i] + w.unitPoseCount[i] - 1 do
				w:samplePose(tr, frame, out)
			end
			w:sampleQueue(i, frame)
		end
	end
	for p = 1, w.projectileCount do
		if w:projectileExistsAt(p, frame) then
			w:sampleProjectile(p, frame, out)
		end
	end
end

-- The fixture has something in each of the curves this walks.
do
	local w = assert(opened():loadWindow(1))
	local tracks, poses, projectiles = 0, 0, w.projectileCount
	for i = 1, w.unitCount do
		tracks = tracks + w.unitTargetCount[i]
		poses = poses + w.unitPoseCount[i]
	end
	t.check("the fixture's window has units, target tracks, pose tracks and projectiles", w.unitCount > 0 and tracks > 0 and poses > 0 and projectiles > 0)
end

-- Sampling a window allocates nothing.

do
	local track = opened()
	local w = assert(track:loadWindow(1))
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	for frame = w.startFrame, w.endFrame do
		sampleAll(w, frame)
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("playing forward over a whole window allocates nothing", after - before, 0)

	collectgarbage("stop")
	before = collectgarbage("count")
	for frame = w.endFrame, w.startFrame, -1 do
		sampleAll(w, frame)
	end
	after = collectgarbage("count")
	collectgarbage("restart")
	t.same("playing backward over a whole window allocates nothing", after - before, 0)
end

-- Forward play does no search.

do
	for k = 0, header.windowCount - 1 do
		local track = opened()
		local w = assert(track:loadWindow(k))
		for frame = w.startFrame, w.endFrame do
			sampleAll(w, frame)
		end
		t.same("window " .. k .. " played forward, one frame at a time, searched " .. w.searches .. " times", w.searches, 0)
	end

	local track = opened()
	local w = assert(track:loadWindow(1))
	sampleAll(w, w.startFrame)
	sampleAll(w, w.endFrame)
	local jumped = w.searches
	t.check("a seek from one end of a window to the other searches (" .. jumped .. " times)", jumped > 0)
	for frame = w.endFrame - 1, w.startFrame, -1 do
		sampleAll(w, frame)
	end
	t.same("playing back from there one frame at a time searches no more", w.searches, jumped)
end

-- A minute of play does not grow memory.

do
	--- Plays the minute from the first frame. It gives the bytes sampling
	-- allocated, the bytes the window loads allocated, the number of loads, and
	-- the smallest load.
	local function lap(track)
		local sampling, loading, loads, smallest = 0, 0, 0, math.huge
		collectgarbage("stop")
		for frame = header.firstFrame, header.firstFrame + FRAMES do
			local k = track:windowOf(frame)
			if not track.window or track.window.index ~= k then
				local before = collectgarbage("count")
				assert(track:loadWindow(k))
				local used = collectgarbage("count") - before
				loading = loading + used
				loads = loads + 1
				smallest = math.min(smallest, used)
			end
			local before = collectgarbage("count")
			sampleAll(track.window, frame)
			sampling = sampling + (collectgarbage("count") - before)
		end
		collectgarbage("restart")
		return sampling, loading, loads, smallest
	end

	local track = opened()
	local sampling, loading, loads, smallest = lap(track)
	t.same("a minute's sampling allocated nothing", sampling, 0)
	t.check("the minute loaded " .. loads .. " windows, which is more than one", loads > 1)
	t.check("the loads are where the memory went (" .. string.format("%.1f", loading) .. " KB)", loading > 0)

	-- Play it again and again from the start, and collect each time. What is live
	-- afterwards wobbles by a few hundred bytes with the collector's accounting.
	-- A window kept by mistake would add the size of a window, so the test asks
	-- for less growth than the smallest load of the first minute.
	local rounds = 12
	local live = {}
	for round = 1, rounds do
		lap(track)
		track:seek(header.firstFrame)
		collectgarbage()
		collectgarbage()
		collectgarbage()
		live[round] = collectgarbage("count")
	end
	local grown = live[rounds] - live[1]
	t.check(
		"after " .. rounds .. " minutes, collected, memory has grown by " .. string.format("%.2f", grown) .. " KB, under the " .. string.format("%.1f", smallest) .. " KB of the smallest window",
		grown < smallest
	)
end

t.report()
