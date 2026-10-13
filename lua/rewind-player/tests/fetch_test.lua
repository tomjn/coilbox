-- A track longer than 16,777,216 bytes, read from one string (issue #3971).
--
-- The engine's numbers are 32 bit floats, so a position in a string past that
-- many bytes is exact only when it is a multiple of a large enough power of
-- two. `Fetch.fromString` cuts a long string into pieces so that it never asks
-- `string.sub` for a position a float cannot hold. LuaJIT's numbers are
-- doubles and would let a wrong position through, so `string.sub` is wrapped
-- here to raise for one.
--
-- The long track is the fixture with 19,200,000 zero bytes put in after its
-- header and index, and every block number moved along by as much. That is a
-- track by the format page, so the reader has to read it the same.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local env = t.syncedEnv()
local Track = t.load("coilbox_track.lua", env)
local Fetch = t.load("coilbox_track_fetch.lua", env)

local bytes = t.read(t.FIXTURES .. "small.cbtrack")

-- Every position `string.sub` is given, for the rest of this file. Method calls
-- on a string go through the same table.
local realSub = string.sub
local subs = 0
string.sub = function(s, i, j)
	subs = subs + 1
	for _, position in ipairs({ i, j }) do
		if t.float(position) ~= position then
			error("string.sub was given " .. string.format("%.0f", position) .. ", which a 32 bit float does not hold", 2)
		end
	end
	return realSub(s, i, j)
end

t.raises("the wrapper catches a position a float does not hold", "16777217", string.sub, "x", 16777217)

-- A string of numbered blocks, so that what a fetch gives says where it is from.

local BLOCKS = 600000
local function block(n)
	return string.format("%063d\n", n)
end

local long
do
	local parts = {}
	for n = 0, BLOCKS - 1 do
		parts[n + 1] = block(n)
	end
	long = table.concat(parts)
end
t.same("the long string is 38,400,000 bytes, over two pieces", #long, 38400000)

do
	local fetch = Fetch.fromString(long)
	-- 262,143 blocks are 16,777,152 bytes, which is one piece.
	for _, n in ipairs({ 0, 1, 262142, 262143, 262144, 262145, 400000, 524285, 524286, 524287, BLOCKS - 1 }) do
		t.same("block " .. n .. " of the long string", fetch(n, 64), block(n))
	end
	t.same("a part that runs from one piece into the next", fetch(262142, 192), block(262142) .. block(262143) .. block(262144))
	t.same("a part that runs into the third piece", fetch(524284, 256), block(524284) .. block(524285) .. block(524286) .. block(524287))
	t.same("a part of some bytes inside a block", fetch(300000, 10), realSub(block(300000), 1, 10))
	local short, why = fetch(BLOCKS - 1, 65)
	t.check("a part that runs past the end of the string is an error", short == nil and why:find("ends after 64", 1, true), why)
	local past, pastWhy = fetch(BLOCKS + 5, 64)
	t.check("a block past the end is an error", past == nil and pastWhy:find("ends after 0", 1, true), pastWhy)
	local big, bigWhy = fetch(0, 16777153)
	t.check("a part longer than a piece is refused", big == nil and bigWhy:find("longer than", 1, true), bigWhy)
end

-- The fixture, moved past 16,777,216 bytes.

local function u32(s, at)
	local a, b, c, d = s:byte(at + 1, at + 4)
	return a + b * 256 + c * 65536 + d * 16777216
end

local function packed(n)
	return string.char(n % 256, math.floor(n / 256) % 256, math.floor(n / 65536) % 256, math.floor(n / 16777216))
end

local SHIFT = 300000

--- `source` with `SHIFT` blocks of zero bytes after its header and index, and
-- every block number moved by `SHIFT`.
local function moved(source)
	local windows = u32(source, 24)
	local headerSize = source:byte(7) + source:byte(8) * 256
	local parts = { realSub(source, 1, 36), packed(u32(source, 36) + SHIFT), realSub(source, 41, 44), packed(u32(source, 44) + SHIFT), realSub(source, 49, headerSize) }
	local first = u32(source, 36)
	for k = 0, windows - 1 do
		local at = headerSize + 16 * k
		local main, mainLength, terrain, terrainLength = u32(source, at), u32(source, at + 4), u32(source, at + 8), u32(source, at + 12)
		first = math.min(first, main)
		parts[#parts + 1] = packed(main + SHIFT) .. packed(mainLength) .. packed(terrainLength > 0 and terrain + SHIFT or terrain) .. packed(terrainLength)
	end
	first = math.min(first, u32(source, 44))
	local head = table.concat(parts)
	return head .. string.rep("\0", first * 64 - #head) .. string.rep("\0", SHIFT * 64) .. realSub(source, first * 64 + 1)
end

do
	local far = moved(bytes)
	t.same("the moved track is 19,200,000 bytes longer", #far - #bytes, 19200000)
	local near = assert(Track.open(Fetch.fromString(bytes)))
	local track, why = Track.open(Fetch.fromString(far))
	t.check("a track with every chunk past 16,777,216 bytes opens", track ~= nil, why)
	if track then
		local info = assert(track:info())
		t.same("its info reads", info.map, assert(near:info()).map)
		t.same("its features read", #assert(track:features()), #assert(near:features()))
		local a, b = { 0, 0, 0, 0, 0, 0, 0 }, { 0, 0, 0, 0, 0, 0, 0 }
		local same, compared = true, 0
		for k = 0, track.header.windowCount - 1 do
			local w, v = assert(track:loadWindow(k)), assert(near:loadWindow(k))
			same = same and w.unitCount == v.unitCount
			for i = 1, v.unitCount do
				local frame = v.unitFirstFrame[i]
				w:sampleTransform(i, frame, a)
				v:sampleTransform(i, frame, b)
				for slot = 1, 7 do
					compared = compared + 1
					same = same and a[slot] == b[slot]
				end
			end
			same = same and assert(track:terrain(k)).count == assert(near:terrain(k)).count
		end
		t.check("every window of it samples the same as the fixture (" .. compared .. " values)", same and compared > 0)
	end
end

t.check("string.sub was called through the wrapper (" .. subs .. " times)", subs > 0)
string.sub = realSub

t.report()
