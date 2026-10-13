-- A reader for the rewind recorder's dump, for the tests and for
-- dump_summary.lua. The layout it reads is in lua/rewind-recorder/README.md.
--
-- It is written from that page and not from the recorder, so a recorder that
-- drifts from the page fails here. It needs LuaJIT, for the ffi library that
-- turns four bytes into a float.

local ffi = require("ffi")

local M = {}

M.MAGIC = "CBRD"
M.VERSION = 1

M.BLOCK_HEADER = 1
M.BLOCK_PIECES = 2
M.BLOCK_FRAME = 3
M.BLOCK_END = 4

M.UNITS_CREATED = 1
M.UNITS_DESTROYED = 2
M.UNITS_GIVEN = 3
M.UNIT_SAMPLES = 4
M.WEAPON_TARGETS = 5
M.BUILDER_WORK = 6
M.BUILD_QUEUES = 7
M.PIECE_POSES = 8
M.FEATURES_CREATED = 9
M.FEATURES_DESTROYED = 10
M.PROJECTILES = 11
M.TERRAIN = 12

--- How many numbers one row of each section holds. Build queues are the one
-- section whose rows vary: a unit, a count, then four numbers for each item.
M.ROW = {
	[M.UNITS_CREATED] = 16,
	[M.UNITS_DESTROYED] = 14,
	[M.UNITS_GIVEN] = 2,
	[M.UNIT_SAMPLES] = 14,
	[M.WEAPON_TARGETS] = 6,
	[M.BUILDER_WORK] = 8,
	[M.PIECE_POSES] = 14,
	[M.FEATURES_CREATED] = 12,
	[M.FEATURES_DESTROYED] = 1,
	[M.PROJECTILES] = 10,
	[M.TERRAIN] = 4,
}

local u32 = ffi.typeof("uint32_t[1]")
local f32 = ffi.typeof("float[?]")

local function readU32(bytes, at)
	local value = u32()
	ffi.copy(value, bytes:sub(at, at + 3), 4)
	return tonumber(value[0])
end

--- The floats of a frame block, as a Lua array.
local function floats(payload)
	local count = #payload / 4
	local values = f32(count)
	ffi.copy(values, payload, #payload)
	local out = {}
	for index = 0, count - 1 do
		out[index + 1] = tonumber(values[index])
	end
	return out
end

--- Cut a frame block's numbers into its sections. Raises when a section runs
-- past the end of the block, which is what a number the recorder failed to
-- write looks like.
function M.frame(payload)
	if #payload % 4 ~= 0 or #payload < 4 then
		error("a frame block of " .. #payload .. " bytes is not a list of floats")
	end
	local values = floats(payload)
	local frame = { frame = values[1], sections = {}, order = {} }
	local at = 2
	while at <= #values do
		local code, count = values[at], values[at + 1]
		if count == nil or at + 1 + count > #values then
			error("section " .. tostring(code) .. " runs past the end of frame " .. frame.frame)
		end
		local rows = {}
		local from, to = at + 2, at + 1 + count
		if code == M.BUILD_QUEUES then
			while from <= to do
				local items = values[from + 1]
				local row = { unit = values[from], items = {} }
				for item = 0, items - 1 do
					local base = from + 2 + item * 4
					row.items[item + 1] = {
						def = values[base], x = values[base + 1], z = values[base + 2], facing = values[base + 3],
					}
				end
				rows[#rows + 1] = row
				from = from + 2 + items * 4
			end
			if from ~= to + 1 then
				error("the build queues of frame " .. frame.frame .. " do not add up")
			end
		else
			local width = M.ROW[code]
			if width then
				if count % width ~= 0 then
					error("section " .. code .. " of frame " .. frame.frame .. " holds " .. count
						.. " numbers, which is not a whole number of rows of " .. width)
				end
				while from <= to do
					local row = {}
					for index = 0, width - 1 do
						row[index + 1] = values[from + index]
					end
					rows[#rows + 1] = row
					from = from + width
				end
			end
			-- A section this reader does not know is skipped by its count.
		end
		if frame.sections[code] then
			error("section " .. code .. " appears twice in frame " .. frame.frame)
		end
		frame.sections[code] = rows
		frame.order[#frame.order + 1] = code
		at = to + 1
	end
	return frame
end

--- Read a dump held in a string. `decodeJson` turns the text blocks into
-- tables. Returns the blocks in order, and whether the file stopped part way
-- through one, which is how a cancelled run can end.
function M.read(bytes, decodeJson)
	if bytes:sub(1, 4) ~= M.MAGIC then
		error("not a rewind dump: it starts " .. string.format("%q", bytes:sub(1, 4)))
	end
	local version = readU32(bytes, 5)
	if version ~= M.VERSION then
		error("dump version " .. version .. ", and this reader knows " .. M.VERSION)
	end
	local dump = { version = version, blocks = {}, truncated = false }
	local at = 9
	while at <= #bytes do
		if at + 7 > #bytes then
			dump.truncated = true
			break
		end
		local kind, length = readU32(bytes, at), readU32(bytes, at + 4)
		if at + 8 + length - 1 > #bytes then
			dump.truncated = true
			break
		end
		local payload = bytes:sub(at + 8, at + 7 + length)
		local block = { kind = kind }
		if kind == M.BLOCK_FRAME then
			block.frame = M.frame(payload)
		elseif kind == M.BLOCK_HEADER or kind == M.BLOCK_PIECES or kind == M.BLOCK_END then
			block.text = payload
			block.json = decodeJson and decodeJson(payload) or nil
		end
		dump.blocks[#dump.blocks + 1] = block
		at = at + 8 + length
	end
	return dump
end

--- Walk a dump file a block at a time without holding it all, calling
-- `visit(kind, payload)` for each whole block. Returns whether the file
-- stopped part way through a block.
function M.stream(path, visit)
	local file = assert(io.open(path, "rb"))
	local head = file:read(8)
	if not head or head:sub(1, 4) ~= M.MAGIC then
		file:close()
		error(path .. " is not a rewind dump")
	end
	local version = readU32(head, 5)
	if version ~= M.VERSION then
		file:close()
		error("dump version " .. version .. ", and this reader knows " .. M.VERSION)
	end
	local truncated = false
	while true do
		local header = file:read(8)
		if not header then
			break
		end
		if #header < 8 then
			truncated = true
			break
		end
		local kind, length = readU32(header, 1), readU32(header, 5)
		local payload = length > 0 and file:read(length) or ""
		if not payload or #payload < length then
			truncated = true
			break
		end
		visit(kind, payload)
	end
	file:close()
	return truncated
end

return M
