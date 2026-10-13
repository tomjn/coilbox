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

function Window:projectileExistsAt(p, frame)
	self.track.projectileLooks = self.track.projectileLooks + 1
	return frame >= self.projectileFirstFrame[p] and frame <= self.projectileLastFrame[p]
end

--- A projectile's `at(frame)` gives its place and its velocity.
function Window:sampleProjectile(p, frame, out)
	self.track.projectileLooks = self.track.projectileLooks + 1
	out[1], out[2], out[3], out[4], out[5], out[6] = self.projectileSource[p].at(frame)
	return true
end

--- As the reader's: the positions between which every projectile alive at
-- `frame` lies, from the first frames alone.
function Window:projectileRange(frame)
	local n = self.projectileCount
	if not self.projectileOrdered then
		return 1, n
	end
	local firsts = self.projectileFirstFrame
	local from, to = n + 1, 0
	for p = 1, n do
		if firsts[p] >= frame - self.projectileLongest and from > n then
			from = p
		end
		if firsts[p] <= frame then
			to = p
		end
	end
	return from, to
end

function Window:projectilesBorn(after, frame)
	local n = self.projectileCount
	if not self.projectileOrdered then
		return 1, n
	end
	local firsts = self.projectileFirstFrame
	local from, to = n + 1, 0
	for p = 1, n do
		if firsts[p] > after and from > n then
			from = p
		end
		if firsts[p] <= frame then
			to = p
		end
	end
	return from, to
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
	-- Projectiles, in the order the track was given them, which a test that
	-- wants a window out of order of birth uses.
	w.track = self
	w.projectileSource, w.projectileSerial, w.projectileWeapon, w.projectileTeam = {}, {}, {}, {}
	w.projectileFlags, w.projectileShooter, w.projectileFirstFrame, w.projectileLastFrame = {}, {}, {}, {}
	w.projectileOrdered, w.projectileLongest = true, 0
	local m = 0
	for _, shot in ipairs(self.projectiles) do
		if shot.first <= finish and shot.last >= start then
			m = m + 1
			local first, last = math.max(shot.first, start), math.min(shot.last, finish)
			w.projectileSource[m] = shot
			w.projectileSerial[m], w.projectileWeapon[m], w.projectileTeam[m] = shot.serial, shot.weapon, shot.team
			w.projectileFlags[m] = (shot.first < start and 1 or 0) + (shot.last > finish and 2 or 0)
			w.projectileFirstFrame[m], w.projectileLastFrame[m] = first, last
			w.projectileShooter[m] = 0
			for i = 1, n do
				if shot.shooter and w.source[i] == self.units[shot.shooter] then
					w.projectileShooter[m] = i
				end
			end
			if m > 1 and first < w.projectileFirstFrame[m - 1] then
				w.projectileOrdered = false
			end
			w.projectileLongest = math.max(w.projectileLongest, last - first)
		end
	end
	w.projectileCount = m
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

--- A projectile of weapon definition 0 and team 0 that hangs at `0, 100, 0`
-- going nowhere. `weapon = false` is one with no weapon definition, a piece of
-- debris. `shooter` is the position of the unit that fired it in `spec.units`.
local function projectile(spec, serial)
	local place = spec.at or { 0, 100, 0, 0, 0, 0 }
	return {
		serial = spec.serial or serial,
		weapon = spec.weapon == false and 65535 or spec.weapon or 0,
		team = spec.team or 0,
		shooter = spec.shooter,
		first = spec.first,
		last = spec.last,
		at = type(place) == "function" and place or function()
			return place[1], place[2], place[3], place[4], place[5], place[6]
		end,
	}
end

--- `spec` has `first`, `last` and `windowLength`, the names `unitDefs`,
-- `weaponDefs` and `featureDefs`, `teams` as a list of team ids, and `units`,
-- `projectiles`, `features` and `terrain` rows of
-- `{ frame, x, z, before, after }`. `tolerance` and `positionStep` are the
-- header's, 0.5 and 0.125 without them.
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
	local projectiles = {}
	for i, one in ipairs(spec.projectiles or {}) do
		projectiles[i] = projectile(one, i - 1)
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
			tolerance = spec.tolerance or 0.5,
			positionStep = spec.positionStep or 0.125,
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
		projectiles = projectiles,
		-- How often a window was asked whether a projectile exists or where it is.
		projectileLooks = 0,
		featureList = features,
		terrainRows = spec.terrain or {},
		broken = spec.broken or {},
		loads = 0,
		terrainLoads = 0,
	}, Track)
end

return M
