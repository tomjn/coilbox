-- Counts what a rewind dump holds, a block at a time, without loading it whole.
-- For checking a recording made by a real engine against the replay it came
-- from, and two recordings of one replay against each other.
--
--   luajit lua/rewind-recorder/tests/dump_summary.lua <dump>
--
-- The three terrain lines at the end are checksums. "terrain rows" covers
-- every terrain row with its frame, in order, so it only matches between two
-- dumps that wrote the same rows on the same frames. "terrain at each window"
-- covers the height of every corner that had changed by each 900th frame, so
-- it matches when two recordings have the same ground at every one of those
-- frames. "terrain at the end" covers the ground the recording finishes with.

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local dump = dofile(here .. "/dump.lua")
local json = dofile(here .. "/../../blueprint-widget/luaui/coilbox_blueprints/json.lua")
local bit = require("bit")

local path = arg[1]
if not path then
	io.stderr:write("usage: dump_summary.lua <dump>\n")
	os.exit(2)
end

-- FNV-1a, 32 bit, over text.
local function hashed(hash, text)
	for index = 1, #text do
		hash = bit.bxor(hash, text:byte(index))
		hash = bit.tobit(hash * 16777619)
	end
	return hash
end

local NAMES = {
	[dump.UNITS_CREATED] = "units created",
	[dump.UNITS_DESTROYED] = "units destroyed",
	[dump.UNITS_GIVEN] = "units given",
	[dump.UNIT_SAMPLES] = "unit samples",
	[dump.WEAPON_TARGETS] = "weapon target rows",
	[dump.BUILDER_WORK] = "builder work rows",
	[dump.BUILD_QUEUES] = "build queue rows",
	[dump.PIECE_POSES] = "piece pose rows",
	[dump.FEATURES_CREATED] = "features created",
	[dump.FEATURES_DESTROYED] = "features destroyed",
	[dump.PROJECTILES] = "projectile rows",
	[dump.TERRAIN] = "terrain rows",
}

local header, ending
local trees, frames, firstFrame, lastFrame = 0, 0, nil, nil
local rows, floats = {}, {}
local createdByTeam, teamOf = {}, {}
local queueItems = 0
local alive, projectiles, debris = {}, 0, 0
local peakUnits, peakProjectiles = 0, 0
local weaponsWithTargets, targetsByWeapon = {}, {}
local posedPieces = {}
local terrainRows = bit.tobit(2166136261)
local ground, corners = {}, 0
local atWindows, windows = bit.tobit(2166136261), 0

-- The checksum of the ground as it stands, folded into `hash`.
local function groundInto(hash)
	local keys = {}
	for key in pairs(ground) do
		keys[#keys + 1] = key
	end
	table.sort(keys)
	for _, key in ipairs(keys) do
		hash = hashed(hash, string.format("%d %.6f\n", key, ground[key]))
	end
	return hash
end

local truncated = dump.stream(path, function(kind, payload)
	if kind == dump.BLOCK_HEADER then
		header = json.decode(payload)
	elseif kind == dump.BLOCK_PIECES then
		trees = trees + 1
	elseif kind == dump.BLOCK_END then
		ending = json.decode(payload)
	elseif kind == dump.BLOCK_FRAME then
		local frame = dump.frame(payload)
		frames = frames + 1
		firstFrame = firstFrame or frame.frame
		lastFrame = frame.frame
		for code, found in pairs(frame.sections) do
			rows[code] = (rows[code] or 0) + #found
		end
		floats.total = (floats.total or 0) + #payload / 4

		for _, row in ipairs(frame.sections[dump.UNITS_CREATED] or {}) do
			createdByTeam[row[3]] = (createdByTeam[row[3]] or 0) + 1
			teamOf[row[1]] = row[3]
		end
		peakUnits = math.max(peakUnits, #(frame.sections[dump.UNIT_SAMPLES] or {}))
		for _, row in ipairs(frame.sections[dump.WEAPON_TARGETS] or {}) do
			targetsByWeapon[row[2]] = (targetsByWeapon[row[2]] or 0) + 1
			if row[3] ~= 0 then
				weaponsWithTargets[row[1]] = weaponsWithTargets[row[1]] or {}
				weaponsWithTargets[row[1]][row[2]] = true
			end
		end
		for _, row in ipairs(frame.sections[dump.BUILD_QUEUES] or {}) do
			queueItems = queueItems + #row.items
		end
		for _, row in ipairs(frame.sections[dump.PIECE_POSES] or {}) do
			posedPieces[row[1] .. ":" .. row[2]] = true
		end

		-- A projectile is new when its id was not in the frame before, or when
		-- it was and stood for something else.
		local now = {}
		local list = frame.sections[dump.PROJECTILES] or {}
		for _, row in ipairs(list) do
			local key = row[2] .. ":" .. row[3] .. ":" .. row[4]
			now[row[1]] = key
			if alive[row[1]] ~= key then
				projectiles = projectiles + 1
				if row[2] == -1 then
					debris = debris + 1
				end
			end
		end
		alive = now
		peakProjectiles = math.max(peakProjectiles, #list)

		for _, row in ipairs(frame.sections[dump.TERRAIN] or {}) do
			terrainRows = hashed(terrainRows, string.format("%d %d %d %.6f %.6f\n", frame.frame, row[1], row[2], row[3], row[4]))
			local key = row[2] * 65536 + row[1]
			if ground[key] == nil then
				corners = corners + 1
			end
			ground[key] = row[4]
		end
		if frame.frame % 900 == 0 then
			atWindows = groundInto(hashed(atWindows, frame.frame .. "\n"))
			windows = windows + 1
		end
	end
end)

local function line(name, value)
	print(string.format("%-34s %s", name, tostring(value)))
end

line("game", header and (header.game .. " " .. header.gameVersion) or "no header")
line("map", header and header.map or "")
line("engine", header and header.engine or "")
line("last frame asked for", header and header.lastFrame or "")
line("terrain recorded", header and tostring(header.terrain) or "")
line("frame blocks", frames)
line("first frame", firstFrame)
line("last frame", lastFrame)
line("ended", ending and (ending.reason .. " at frame " .. ending.frame) or "no end block")
line("winners", ending and table.concat(ending.winners, " ") or "")
line("cut short inside a block", tostring(truncated))
line("piece trees", trees)
for code = 1, 12 do
	line(NAMES[code], rows[code] or 0)
end
line("build queue items", queueItems)
local teams = {}
for team in pairs(createdByTeam) do
	teams[#teams + 1] = team
end
table.sort(teams)
for _, team in ipairs(teams) do
	line("units created for team " .. team, createdByTeam[team])
end
line("peak units in one sample", peakUnits)
line("distinct projectiles", projectiles)
line("of them with no weapon definition", debris)
line("peak projectiles in one frame", peakProjectiles)
local weapons = {}
for weapon in pairs(targetsByWeapon) do
	weapons[#weapons + 1] = weapon
end
table.sort(weapons)
for _, weapon in ipairs(weapons) do
	line("target rows for weapon " .. weapon, targetsByWeapon[weapon])
end
local several = 0
for _, byWeapon in pairs(weaponsWithTargets) do
	local count = 0
	for _ in pairs(byWeapon) do
		count = count + 1
	end
	if count > 1 then
		several = several + 1
	end
end
line("units with a target on 2+ weapons", several)
local posed = 0
for _ in pairs(posedPieces) do
	posed = posed + 1
end
line("pieces with a pose row", posed)
line("numbers in frame blocks", floats.total or 0)
line("corners whose height changed", corners)
line("terrain rows checksum", bit.tohex(terrainRows))
line("terrain at each window checksum", bit.tohex(atWindows) .. " over " .. windows .. " windows")
line("terrain at the end checksum", bit.tohex(groundInto(bit.tobit(2166136261))))
