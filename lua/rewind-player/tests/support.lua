-- Shared scaffolding for the rewind player's tests: a stand-in for the slice of
-- the engine the track reader uses, and the environments the reader is loaded
-- into.
--
-- The VFS calls here follow rts/Lua/LuaVFS.cpp and rts/System/StringUtil.cpp in
-- RecoilEngine at commit 212c369b4c, not what a manual says:
--
-- VFS.Unpack* returns nothing when the first argument is not a string, when the
-- position is below 1 or at the last byte or beyond, and when fewer bytes than
-- one value are left. With a count it returns a table of at most that many
-- values, all of them for a negative count. Without one it returns one value.
-- A position or count has to be a whole number a 32 bit float holds. The
-- engine's Lua numbers are 32 bit floats, so it cannot be anything else, and
-- the stub raises for one that LuaJIT's doubles would let through.
--
-- A value that comes back is rounded to a 32 bit float, as the engine's is. A
-- U32 above 16,777,216 comes back wrong here as it does there.
--
-- VFS.ZlibDecompress starts with a 262,144 byte buffer and doubles it until
-- zlib's uncompress fits, and raises when the stream is bad or the result is
-- empty.
--
-- LuaJIT's numbers are still doubles, so arithmetic in the code under test is
-- not rounded to a float the way the engine's is. A test that passes here has
-- shown the logic and the addressing. It has not shown the precision.
--
-- The environments hold the globals the reader may reach. The synced one has no
-- io, as the engine's synced Lua has none, so a reader that reaches for it
-- fails here and not in a game.
--
-- This directory is not part of what coilbox puts in a game. Only luarules/ is.

local ffi = require("ffi")

local M = {}

M.failures = 0

function M.check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		M.failures = M.failures + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

--- Check two values are the same, and say both when they are not.
function M.same(name, got, wanted)
	M.check(name, got == wanted, "got " .. tostring(got) .. ", wanted " .. tostring(wanted))
end

--- Check two numbers are within a relative tolerance, which is for values the
-- reader works out and the Rust reader works out in doubles too.
function M.near(name, got, wanted, tolerance)
	tolerance = tolerance or 1e-9
	local ok = type(got) == "number" and math.abs(got - wanted) <= tolerance * math.max(1, math.abs(wanted))
	M.check(name, ok, "got " .. tostring(got) .. ", wanted " .. tostring(wanted))
end

--- Check that a call raises, and that the message holds `needle`.
function M.raises(name, needle, fn, ...)
	local ok, err = pcall(fn, ...)
	M.check(name, not ok and tostring(err):find(needle, 1, true) ~= nil, ok and "it did not raise" or tostring(err))
end

function M.report()
	if M.failures > 0 then
		print(M.failures .. " failed")
		os.exit(1)
	end
	print("all passed")
end

--- lua/rewind-player, derived from the test file's own path.
function M.root()
	return arg[0]:match("^(.*)/tests/[^/]+$") or "."
end

M.MODULES = "luarules/rewind_player/"
M.FIXTURES = M.root() .. "/tests/fixtures/"

--- A file read whole.
function M.read(path)
	local file = assert(io.open(path, "rb"))
	local data = file:read("*a")
	file:close()
	return data
end

-- zlib, from the system. The names are the ones a Mac and a Linux runner use.
ffi.cdef([[
int uncompress(uint8_t *dest, unsigned long *destLen, const uint8_t *source, unsigned long sourceLen);
int compress2(uint8_t *dest, unsigned long *destLen, const uint8_t *source, unsigned long sourceLen, int level);
unsigned long compressBound(unsigned long sourceLen);
]])

local zlib
for _, name in ipairs({ "z", "libz.so.1", "libz.1.dylib" }) do
	local ok, lib = pcall(ffi.load, name)
	if ok then
		zlib = lib
		break
	end
end
assert(zlib, "the tests need the system zlib, and luajit could not load it")

local Z_OK, Z_BUF_ERROR = 0, -5

--- A zlib stream (RFC 1950) of `data`, at level 9. Tests build chunks with it.
function M.deflate(data)
	local size = ffi.new("unsigned long[1]", zlib.compressBound(#data))
	local out = ffi.new("uint8_t[?]", size[0])
	assert(zlib.compress2(out, size, data, #data, 9) == Z_OK, "compress2 failed")
	return ffi.string(out, size[0])
end

--- Whether a number is held exactly by a 32 bit float.
local single = ffi.new("float[1]")

--- A number as the 32 bit float the engine holds it as.
function M.float(value)
	single[0] = value
	return tonumber(single[0])
end

local function whole(what, value)
	if M.float(value) ~= value then
		error(what .. " " .. string.format("%.0f", value) .. " is not held exactly by a 32 bit float", 3)
	end
	return value >= 0 and math.floor(value) or -math.floor(-value)
end

local function unpacker(ctype, size, rounded)
	local pointer = ctype .. " const *"
	return function(str, pos, count)
		if type(str) ~= "string" then
			return
		end
		local length = #str
		local offset = 0
		if type(pos) == "number" then
			pos = whole("position", pos)
			if pos < 1 or pos >= length then
				return
			end
			offset = pos - 1
			length = length - offset
		end
		if length < size then
			return
		end
		local values = ffi.cast(pointer, ffi.cast("const uint8_t *", str) + offset)
		local function value(index)
			local v = tonumber(values[index])
			return rounded and M.float(v) or v
		end
		if type(count) ~= "number" then
			return value(0)
		end
		local most = math.floor(length / size)
		count = whole("count", count)
		if count < 0 then
			count = most
		end
		count = math.min(most, count)
		local out = {}
		for index = 1, count do
			out[index] = value(index - 1)
		end
		return out
	end
end

local function decompress(data)
	if type(data) ~= "string" then
		error("bad argument #1 to 'ZlibDecompress' (string expected, got " .. type(data) .. ")", 2)
	end
	local capacity = 256 * 1024
	local buffer = ffi.new("uint8_t[?]", capacity)
	local size = ffi.new("unsigned long[1]", capacity)
	local status
	while true do
		status = zlib.uncompress(buffer, size, data, #data)
		if status ~= Z_BUF_ERROR then
			break
		end
		capacity = capacity * 2
		buffer = ffi.new("uint8_t[?]", capacity)
		size[0] = capacity
	end
	if status ~= Z_OK or size[0] == 0 then
		error("Error while decompressing", 2)
	end
	return ffi.string(buffer, size[0])
end

--- The VFS table. `options.files` holds the contents of the files VFS.LoadFile
-- can find, keyed by path.
function M.vfs(options)
	options = options or {}
	local files = options.files or {}
	return {
		UnpackU8 = unpacker("uint8_t", 1, false),
		UnpackU16 = unpacker("uint16_t", 2, false),
		UnpackU32 = unpacker("uint32_t", 4, true),
		UnpackS8 = unpacker("int8_t", 1, false),
		UnpackS16 = unpacker("int16_t", 2, false),
		UnpackS32 = unpacker("int32_t", 4, true),
		UnpackF32 = unpacker("float", 4, true),
		ZlibDecompress = decompress,
		LoadFile = function(path)
			return files[path]
		end,
	}
end

local SHARED = {
	"assert", "error", "ipairs", "next", "pairs", "pcall", "select", "setmetatable", "getmetatable",
	"rawget", "rawset", "tonumber", "tostring", "type", "unpack", "math", "string", "table",
}

local function environment(name, extra, options)
	local env = {}
	for _, global in ipairs(SHARED) do
		env[global] = _G[global]
	end
	env.VFS = M.vfs(options)
	for key, value in pairs(extra) do
		env[key] = value
	end
	return setmetatable(env, {
		__index = function(_, global)
			error(name .. " Lua has no " .. tostring(global), 2)
		end,
	})
end

--- The globals the engine's synced Lua gives a gadget that this reader could
-- want. There is no io.
function M.syncedEnv(options)
	return environment("synced", {}, options)
end

--- The same with io, as unsynced Lua has.
function M.unsyncedEnv(options)
	return environment("unsynced", { io = io }, options)
end

--- A module of the reader, loaded the way VFS.Include loads one: as a chunk
-- whose environment is the one it is given.
function M.load(file, env)
	local chunk = assert(loadfile(M.root() .. "/" .. M.MODULES .. file))
	setfenv(chunk, env)
	return chunk()
end

return M
