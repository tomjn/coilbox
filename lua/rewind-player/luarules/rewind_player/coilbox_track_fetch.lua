-- Coilbox rewind player: the ways to fetch bytes of a track.
--
-- The track reader asks for bytes through one function, `fetch(block, length)`,
-- which gives `length` bytes starting at `block * 64` in the file, or nil and a
-- reason. The reader never learns where the bytes are from, so the player picks
-- the way its half of the engine allows.
--
-- The engine's Lua numbers are 32 bit floats, which hold a whole number exactly
-- up to 16,777,216. A block number is at most 16,777,215, so `block * 64` is
-- exact up to a gigabyte, but a position inside one Lua string is a Lua number
-- too, and only a multiple of 64 is exact that far. `string.sub` takes the
-- first byte it is to give counted from 1, which past 16,777,216 no float holds.
--
-- So `fromString` cuts a longer string into pieces of 16,777,152 bytes when it
-- is made, and reads from inside a piece, where every position is small. A
-- piece is cut from the front of what is left of the string, and what is left
-- starts at byte 16,777,153 of what was left before, a position a float holds.
-- Cutting copies what is left each time, so a track of `n` bytes costs about
-- `n * n / 33,554,304` bytes of copying once, when it is opened. A track of
-- 16,777,152 bytes or less is one piece and nothing is copied.
--
-- `fromFile` uses `file:seek`, whose offset is a multiple of 64 and therefore
-- exact over the whole range, so it reads any track and copies nothing. It
-- needs `io`, which only unsynced Lua has.
--
-- `fromVFS` is for synced Lua, which has no `io` but has `VFS.LoadFile`. That
-- gives the whole file as one string.

local M = {}

--- Where the generated game keeps the track.
M.PATH = "coilbox_rewind/track.cbtrack"

local BLOCK = 64

--- The bytes in a piece of a long string. A multiple of 64, so a piece starts
-- on a block, and one less than a float's 16,777,216 would be, so the byte
-- after a piece is a position a float holds.
local PIECE = 16777152

--- The largest block number the file format allows.
local LAST_BLOCK = 16777215

--- `data` cut into pieces of `PIECE` bytes, counted from 0. A string that fits
-- one piece is the piece.
local function pieces(data)
	local list, rest, k = {}, data, 0
	while #rest > PIECE do
		list[k] = rest:sub(1, PIECE)
		rest = rest:sub(PIECE + 1)
		k = k + 1
	end
	list[k] = rest
	return list
end

--- A fetch that reads from a string holding the whole track.
function M.fromString(data)
	local list = pieces(data)
	return function(block, length)
		if block > LAST_BLOCK then
			return nil, "block " .. string.format("%.0f", block) .. " is past the last the format allows"
		end
		if length > PIECE then
			return nil, "a part of " .. string.format("%.0f", length) .. " bytes is longer than the " .. PIECE .. " a string is read in"
		end
		-- The piece the block is in and where in it. A division could round a
		-- block just short of a piece into the next one.
		local at, k = block * BLOCK, 0
		while at >= PIECE do
			at = at - PIECE
			k = k + 1
		end
		local piece = list[k]
		local bytes = piece and piece:sub(at + 1, at + length) or ""
		if #bytes < length and at + length > PIECE and list[k + 1] then
			-- The part runs over the end of the piece into the next.
			bytes = bytes .. list[k + 1]:sub(1, length - #bytes)
		end
		if #bytes < length then
			return nil, "the file ends after " .. #bytes .. " of the " .. length .. " bytes asked for"
		end
		return bytes
	end
end

--- A fetch that reads from an open file, in unsynced Lua. The caller closes it.
function M.fromFile(file)
	return function(block, length)
		if block > LAST_BLOCK then
			return nil, "block " .. string.format("%.0f", block) .. " is past the last the format allows"
		end
		local ok, seeked, why = pcall(file.seek, file, "set", block * BLOCK)
		if not ok or not seeked then
			return nil, tostring(ok and why or seeked)
		end
		local bytes = file:read(length)
		if not bytes or #bytes < length then
			return nil, "the file ends after " .. (bytes and #bytes or 0) .. " of the " .. length .. " bytes asked for"
		end
		return bytes
	end
end

--- A fetch that reads a track the game holds, in synced or unsynced Lua. It
-- loads the whole file as one string.
function M.fromVFS(path)
	path = path or M.PATH
	local data = VFS.LoadFile(path)
	if not data then
		return nil, "the game holds no file at " .. path
	end
	return M.fromString(data)
end

return M
