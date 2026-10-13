-- A track made from a table, for tests that need a unit to be built, to die or
-- to stand somewhere at a chosen frame. It answers the calls of
-- luarules/rewind_player/coilbox_track.lua that the player uses, with the same
-- conventions: windows counted from 0, lists from 1, definitions and teams from
-- 0, and a frame on a window's edge in both windows.
--
-- The fixture small.cbtrack is random, which is right for the reader and wrong
-- for "this building was finished at frame 300". The gadget is also tested
-- against that fixture through the real reader.

local M = {}

local Window = {}
Window.__index = Window

function Window:unitExistsAt(i, frame)
	return frame >= self.unitFirstFrame[i] and frame <= self.unitLastFrame[i]
end

function Window:sampleTransform(i, frame, out)
	local unit = self.source[i]
	local x, y, z = unit.at(frame)
	local q = unit.rotation
	out[1], out[2], out[3] = x, y, z
	out[4], out[5], out[6], out[7] = q[1], q[2], q[3], q[4]
	return true
end

function Window:sampleStatus(i, frame, out)
	out[1], out[2], out[3] = self.source[i].status(frame)
	return true
end

local Track = {}
Track.__index = Track

function Track:windowOf(frame)
	local h = self.header
	if frame <= h.firstFrame then
		return 0
	end
	return math.min(math.floor((frame - h.firstFrame) / h.windowLength), h.windowCount - 1)
end

function Track:loadWindow(k)
	if self.broken[k] then
		return nil, "window " .. k .. " main chunk: it does not decompress"
	end
	local current = self.window
	if current and current.index == k then
		return current
	end
	local h = self.header
	local start = h.firstFrame + k * h.windowLength
	local finish = math.min(start + h.windowLength, h.lastFrame)
	local w = setmetatable({
		index = k,
		startFrame = start,
		endFrame = finish,
		source = {},
		unitSerial = {},
		unitDef = {},
		unitTeam = {},
		unitFirstFrame = {},
		unitLastFrame = {},
	}, Window)
	local n = 0
	for _, unit in ipairs(self.units) do
		if unit.first <= finish and unit.last >= start then
			n = n + 1
			w.source[n] = unit
			w.unitSerial[n], w.unitDef[n], w.unitTeam[n] = unit.serial, unit.def, unit.team
			w.unitFirstFrame[n], w.unitLastFrame[n] = math.max(unit.first, start), math.min(unit.last, finish)
		end
	end
	w.unitCount = n
	self.window = w
	self.loads = self.loads + 1
	return w
end

function Track:seek(frame)
	return self:loadWindow(self:windowOf(frame))
end

function Track:info()
	return self.infoTable
end

function Track:features()
	return self.featureList
end

--- Window 0 holds the rows on its first frame, and every later window the rows
-- after its first frame, as the format page says.
function Track:terrain(k)
	local h = self.header
	local start = h.firstFrame + k * h.windowLength
	local finish = math.min(start + h.windowLength, h.lastFrame)
	local rows = { count = 0, frame = {}, x = {}, z = {}, before = {}, after = {} }
	for _, row in ipairs(self.terrainRows) do
		if row[1] <= finish and (row[1] > start or (k == 0 and row[1] == start)) then
			local n = rows.count + 1
			rows.count = n
			rows.frame[n], rows.x[n], rows.z[n], rows.before[n], rows.after[n] = row[1], row[2], row[3], row[4], row[5]
		end
	end
	self.terrainLoads = self.terrainLoads + 1
	return rows
end

--- A unit that stands at `x, y, z`, is whole and built, and is switched off.
local function unit(spec, serial)
	local place = spec.at or { 0, 0, 0 }
	return {
		serial = spec.serial or serial,
		def = spec.def or 0,
		team = spec.team or 0,
		first = spec.first,
		last = spec.last,
		rotation = spec.rotation or { 0, 0, 0, 1 },
		at = type(place) == "function" and place or function()
			return place[1], place[2], place[3]
		end,
		status = spec.status or function()
			return 1, 1, 0
		end,
	}
end

--- `spec` has `first`, `last` and `windowLength`, the names `unitDefs` and
-- `featureDefs`, `teams` as a list of team ids, and `units`, `features` and
-- `terrain` rows of `{ frame, x, z, before, after }`.
function M.new(spec)
	local first, last, length = spec.first or 0, spec.last, spec.windowLength or 900
	local teams = {}
	for i, id in ipairs(spec.teams or { 0, 1, 2 }) do
		teams[i] = { id = id, allyTeam = id, flags = 0, colour = { 0, 0, 0 }, side = "", leader = "" }
	end
	local units = {}
	for i, one in ipairs(spec.units or {}) do
		units[i] = unit(one, i - 1)
	end
	local features = {}
	for i, one in ipairs(spec.features or {}) do
		features[i] = {
			engineId = i,
			def = one.def or 0,
			team = one.team or 255,
			flags = 0,
			firstFrame = one.first or first,
			lastFrame = one.last or last,
			position = one.at or { 0, 0, 0 },
			rotation = one.rotation or { 0, 0, 0, 1 },
		}
	end
	return setmetatable({
		header = {
			firstFrame = first,
			lastFrame = last,
			windowLength = length,
			windowCount = math.max(1, math.ceil((last - first) / length)),
			framesPerSecond = 30,
		},
		infoTable = {
			engineVersion = "fake",
			game = "fake game 1",
			map = "fake map",
			writer = "fake_track.lua",
			unitDefs = spec.unitDefs or {},
			weaponDefs = spec.weaponDefs or {},
			featureDefs = spec.featureDefs or {},
			teams = teams,
		},
		units = units,
		featureList = features,
		terrainRows = spec.terrain or {},
		broken = spec.broken or {},
		loads = 0,
		terrainLoads = 0,
	}, Track)
end

return M
