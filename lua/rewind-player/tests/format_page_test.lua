-- The reader against the worked example on the format page, built by hand in
-- this file. That makes it a check against the page itself, which the fixture is
-- not: the fixture was written and read by one Rust crate, and this was not.
--
-- The page's chunk is 420 bytes before compression. It is put in a file with a
-- header and a window index built here from the page's tables, with one window of
-- 900 frames, a position shift of 3 and 12 rotation bits.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local env = t.syncedEnv()
local Track = t.load("coilbox_track.lua", env)
local Fetch = t.load("coilbox_track_fetch.lua", env)

-- The hex dump on the page, rows of 16 bytes after their offsets.
local DUMP = [[
0000  18 00 00 00 01 00 02 00 24 01 00 00 01 00 00 00
0010  02 00 04 00 28 01 00 00 01 00 00 00 03 00 02 00
0020  2c 01 00 00 01 00 00 00 04 00 01 00 30 01 00 00
0030  01 00 00 00 05 00 01 00 34 01 00 00 01 00 00 00
0040  06 00 02 00 38 01 00 00 01 00 00 00 07 00 02 00
0050  3c 01 00 00 01 00 00 00 08 00 02 00 40 01 00 00
0060  01 00 00 00 09 00 02 00 44 01 00 00 01 00 00 00
0070  10 00 02 00 48 01 00 00 03 00 00 00 11 00 03 00
0080  50 01 00 00 03 00 00 00 12 00 03 00 58 01 00 00
0090  03 00 00 00 13 00 03 00 60 01 00 00 03 00 00 00
00a0  14 00 05 00 68 01 00 00 01 00 00 00 15 00 05 00
00b0  6c 01 00 00 01 00 00 00 16 00 05 00 70 01 00 00
00c0  01 00 00 00 17 00 01 00 74 01 00 00 03 00 00 00
00d0  18 00 02 00 78 01 00 00 03 00 00 00 19 00 02 00
00e0  80 01 00 00 03 00 00 00 1a 00 02 00 88 01 00 00
00f0  03 00 00 00 20 00 02 00 90 01 00 00 01 00 00 00
0100  21 00 02 00 94 01 00 00 01 00 00 00 22 00 02 00
0110  98 01 00 00 01 00 00 00 23 00 01 00 9c 01 00 00
0120  01 00 00 00 2f 1f 00 00 00 00 00 00 00 00 00 00
0130  00 00 00 00 02 00 00 00 00 00 00 00 84 03 00 00
0140  03 00 00 00 01 00 00 00 00 00 2c 01 78 00 00 00
0150  00 80 00 00 e0 01 00 00 00 80 00 00 06 00 00 00
0160  00 80 00 00 00 00 00 00 a0 16 00 00 e4 06 00 00
0170  00 19 00 00 03 03 03 00 00 00 00 00 00 00 00 00
0180  00 00 00 00 a7 05 00 00 00 00 00 00 00 00 00 00
0190  00 00 00 00 ff ff 00 00 ff ff 00 00 01 00 00 00
01a0  00 00 00 00
]]

local chunk = {}
for line in DUMP:gmatch("[^\n]+") do
	for byte in line:sub(7):gmatch("%x%x") do
		chunk[#chunk + 1] = string.char(tonumber(byte, 16))
	end
end
chunk = table.concat(chunk)
t.same("the page's chunk is 420 bytes", #chunk, 420)

local function u16(n)
	return string.char(n % 256, math.floor(n / 256) % 256)
end

local function u32(n)
	return u16(n % 65536) .. u16(math.floor(n / 65536))
end

local packed = t.deflate(chunk)
local block = 2
local header = "CBTK" .. u16(1) .. u16(96) .. u16(3) .. u16(30)
	.. u32(0) .. u32(900) .. u32(900) .. u32(1)
	.. string.char(0, 0, 0, 0x3f) -- the tolerance, 0.5
	.. string.char(3, 11, 12, 0)
	.. u32(0) .. u32(0) .. u32(0) .. u32(0)
	.. u32(1) .. u32(0) .. u32(0)
	.. string.rep("\0", 32)
t.same("the header is 96 bytes", #header, 96)
local index = u32(block) .. u32(#packed) .. u32(0) .. u32(0)
local file = header .. index .. string.rep("\0", 128 - 96 - 16) .. packed

local track = assert(Track.open(Fetch.fromString(file)))
t.same("the window length", track.header.windowLength, 900)
t.same("one window", track.header.windowCount, 1)
t.same("the position step is an eighth of an elmo", track.header.positionStep, 0.125)

local w = assert(track:loadWindow(0))
t.same("one unit", w.unitCount, 1)
t.same("its engine id", w.unitId[1], 7983)
t.same("its serial number", w.unitSerial[1], 0)
t.same("it exists after the window", w.unitFlags[1], 2)
t.same("it exists from the first frame", w.unitFirstFrame[1], 0)
t.same("it exists to the last", w.unitLastFrame[1], 900)
t.same("it has three transform keys", w.transformCount[1], 3)
t.same("it has one status key", w.statusCount[1], 1)
t.same("it has no target tracks", w.unitTargetCount[1], 0)
t.same("it has no pose tracks", w.unitPoseCount[1], 0)
t.same("it has no queue keys", w.unitQueueCount[1], 0)
t.same("no projectiles", w.projectileCount, 0)

local out = {}
w:sampleTransform(1, 0, out)
t.same("at 0 x is 724 elmos", out[1], 724)
t.same("at 0 y is 220.5", out[2], 220.5)
t.same("at 0 z is 800", out[3], 800)
t.same("at 0 the rotation is (0, 0, 0, 1)", out[4] .. " " .. out[5] .. " " .. out[6] .. " " .. out[7], "0 0 0 1")
w:sampleTransform(1, 300, out)
t.same("at 300 it has not moved", out[1], 724)
w:sampleTransform(1, 360, out)
t.same("at 360, half way, x is 754", out[1], 754)
w:sampleTransform(1, 420, out)
t.same("at 420 x is 784", out[1], 784)
t.same("at 420 y is 221.25", out[2], 221.25)
t.same("at 420 z is 800", out[3], 800)
t.near("at 420 the kept y component is 0.49985", out[5], 0.49985, 1e-5)
t.near("at 420 w is 0.86611", out[7], 0.86611, 1e-5)
t.near("the front direction's x is 0.86585", 2 * (out[4] * out[6] + out[7] * out[5]), 0.86585, 1e-5)
t.near("the front direction's z is 0.50031", 1 - 2 * (out[4] * out[4] + out[5] * out[5]), 0.50031, 1e-4)
w:sampleTransform(1, 900, out)
t.same("from 420 to 900 it holds the last key", out[1], 784)

w:sampleStatus(1, 600, out)
t.same("it is at full health", out[1], 1)
t.same("it is complete", out[2], 1)
t.same("it is switched on", out[3], 1)

-- The worked example is a track from before recorder version 4: its chunk has
-- no columns for the numbers of a team and its header's bytes from 80 are zero.
t.same("a track with no team resources has no tracks for them", w.valueCount, 0)
t.same("asking for one gives nothing", w:valueOf(0, 0), nil)
t.same("and its resource tolerance is 0", track.header.resourceTolerance, 0)

t.report()
