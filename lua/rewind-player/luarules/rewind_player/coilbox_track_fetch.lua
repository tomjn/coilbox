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
-- too, and is exact only up to 16,777,216. So a track held in a string can be
-- read only that far, and `fromString` refuses what lies beyond it and says so.
--
-- `fromFile` uses `file:seek`, whose offset is a multiple of 64 and therefore
-- exact over the whole range, so it reads any track. It needs `io`, which only
-- unsynced Lua has.
--
-- `fromVFS` is for synced Lua, which has no `io` but has `VFS.LoadFile`. That
-- gives the whole file as one string, so it has the string's limit.

local M = {}

--- Where the generated game keeps the track.
M.PATH = "coilbox_rewind/track.cbtrack"

local BLOCK = 64

--- The most bytes of a string that a Lua number can address exactly.
local ADDRESSABLE = 16777216

--- The largest block number the file format allows.
local LAST_BLOCK = 16777215

--- A fetch that reads from a string holding the whole track.
function M.fromString(data)
	return function(block, length)
		local first = block * BLOCK
		if first + length > ADDRESSABLE then
			return nil,
				"the track is read from one string, and this part of it ends at byte "
					.. string.format("%.0f", first + length)
					.. ", past the 16,777,216 bytes a Lua number can address exactly. Read it through io instead"
		end
		local bytes = data:sub(first + 1, first + length)
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
-- loads the whole file, so it has the limit of a string.
function M.fromVFS(path)
	path = path or M.PATH
	local data = VFS.LoadFile(path)
	if not data then
		return nil, "the game holds no file at " .. path
	end
	return M.fromString(data)
end

return M
