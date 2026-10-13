-- The engine stand-in has to behave as the engine's VFS calls do, or the reader
-- passes tests in a way the engine would not. These check it against the
-- behaviour read from rts/Lua/LuaVFS.cpp and rts/System/StringUtil.cpp.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local VFS = t.vfs({ files = { ["a/b.bin"] = "xyz" } })

local bytes = string.char(1, 2, 3, 4, 5, 6, 7, 8)

-- Position and length.
t.same("U8 with no position and no count gives the first byte", VFS.UnpackU8(bytes), 1)
t.same("U8 counts the position from 1", VFS.UnpackU8(bytes, 2), 2)
t.same("U8 at the last byte gives nothing", VFS.UnpackU8(bytes, 8), nil)
t.same("U8 past the end gives nothing", VFS.UnpackU8(bytes, 9), nil)
t.same("U8 at position 0 gives nothing", VFS.UnpackU8(bytes, 0), nil)
t.same("U8 at a negative position gives nothing", VFS.UnpackU8(bytes, -1), nil)
t.same("U8 at the byte before the last gives that byte", VFS.UnpackU8(bytes, 7), 7)
t.same("a string that is not a string gives nothing", VFS.UnpackU8(nil, 1), nil)
t.same("U16 with one byte left gives nothing", VFS.UnpackU16(bytes, 8), nil)
t.same("U16 with two bytes left gives a value", VFS.UnpackU16(bytes, 7), 7 + 8 * 256)
t.same("an empty string gives nothing", VFS.UnpackU8(""), nil)

-- Count.
local three = VFS.UnpackU8(bytes, 2, 3)
t.same("a count gives a table of that many", #three, 3)
t.same("the table starts at the position", three[1], 2)
t.same("a count past the end is cut to what is there", #VFS.UnpackU8(bytes, 3, 100), 6)
t.same("a negative count gives all that is left", #VFS.UnpackU8(bytes, 3, -1), 6)
t.same("a count of 0 gives an empty table", #VFS.UnpackU8(bytes, 3, 0), 0)
t.same("U16 counts whole values only", #VFS.UnpackU16(bytes, 2, -1), 3)
t.same("a count without a position starts at the first byte", VFS.UnpackU8(bytes, nil, 2)[1], 1)

-- Types and byte order.
local packed = string.char(0xff, 0xff, 0xff, 0xff, 0x00, 0x80, 0x00, 0x00, 0x80)
t.same("S8 reads a negative", VFS.UnpackS8(packed, 1), -1)
t.same("U8 reads the same byte unsigned", VFS.UnpackU8(packed, 1), 255)
t.same("S16 reads a negative", VFS.UnpackS16(packed, 1), -1)
t.same("S16 reads -32768, the escape", VFS.UnpackS16(packed, 5), -32768)
t.same("U32 is little endian", VFS.UnpackU32(string.char(1, 2, 3, 0, 0), 1), 1 + 2 * 256 + 3 * 65536)
t.same("S32 reads a negative", VFS.UnpackS32(packed, 1), -1)
t.same("F32 reads a float", VFS.UnpackF32(string.char(0, 0, 0x80, 0x3f, 0), 1), 1)

-- A 32 bit float holds a whole number exactly up to 16,777,216.
local big = string.char(1, 0, 0, 1, 0)
t.same("U32 of 16,777,217 comes back as 16,777,216", VFS.UnpackU32(big, 1), 16777216)
t.same("U32 of 16,777,215 comes back whole", VFS.UnpackU32(string.char(255, 255, 255, 0, 0), 1), 16777215)
t.raises("a position the engine could not hold raises", "not held exactly", VFS.UnpackU8, bytes, 16777217)
t.raises("a count the engine could not hold raises", "not held exactly", VFS.UnpackU8, bytes, 1, 16777217)
t.same("a position of 16,777,216 is held and is read", VFS.UnpackU8(string.rep("a", 16777217), 16777216), 97)

-- LoadFile.
t.same("LoadFile gives a file's contents", VFS.LoadFile("a/b.bin"), "xyz")
t.same("LoadFile of a missing file gives nothing", VFS.LoadFile("a/missing.bin"), nil)

-- ZlibDecompress.
local text = "a track " .. string.rep("0123456789", 100)
t.same("ZlibDecompress inflates a zlib stream", VFS.ZlibDecompress(t.deflate(text)), text)

-- The engine's first buffer is 262,144 bytes and it doubles it from there.
local large = string.rep("abcdefgh", 100000)
t.same("ZlibDecompress doubles its buffer for a result over 262,144 bytes", VFS.ZlibDecompress(t.deflate(large)) == large, true)

t.raises("ZlibDecompress raises on a bad stream", "Error while decompressing", VFS.ZlibDecompress, "not a stream at all")
local stream = t.deflate(text)
t.raises("ZlibDecompress raises on a stream cut short", "Error while decompressing", VFS.ZlibDecompress, stream:sub(1, #stream - 6))
local flipped = stream:sub(1, 10) .. string.char((stream:byte(11) + 1) % 256) .. stream:sub(12)
t.raises("ZlibDecompress raises on a stream that fails its checksum", "Error while decompressing", VFS.ZlibDecompress, flipped)
t.raises("ZlibDecompress raises on an empty result", "Error while decompressing", VFS.ZlibDecompress, t.deflate(""))
t.raises("ZlibDecompress does not read gzip", "Error while decompressing", VFS.ZlibDecompress, string.char(0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3) .. "xxxxxxxx")

-- The environments.
local synced = t.syncedEnv()
t.raises("synced Lua has no io", "synced Lua has no io", function()
	return synced.io
end)
t.same("unsynced Lua has io", t.unsyncedEnv().io, io)

t.report()
