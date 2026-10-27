-- Checks the save ground fixture matches (issue #4798), for
-- scripts/zerok-terraform-headless.sh. Runs in luajit with the coilbox
-- widget's own json.lua and ground.lua.
--
--   luajit ground_check.lua steps <build log> <out.lua>
--       write the saved selection for the place match to read
--   luajit ground_check.lua check <build log> <place log>
--       print an ok or fail line per claim, and exit 1 on any fail
--   luajit ground_check.lua stats <build log>
--       print the changes in height the build match left, for choosing
--       ground.lua's tolerance

local dir = arg[0]:match("^(.*)/[^/]+$") or "."
local modules = dir .. "/../../luaui/coilbox_blueprints/"
local JSON = dofile(modules .. "json.lua")
local GROUND = dofile(modules .. "ground.lua")

local function lines(path)
	local out = {}
	local file = assert(io.open(path, "r"))
	for line in file:lines() do
		local body = line:match("GROUND (.*)$")
		if body then
			out[#out + 1] = body
		end
	end
	file:close()
	return out
end

local function find(log, prefix)
	for _, line in ipairs(log) do
		if line:sub(1, #prefix) == prefix then
			return line
		end
	end
end

local function all(log, prefix)
	local out = {}
	for _, line in ipairs(log) do
		if line:sub(1, #prefix) == prefix then
			out[#out + 1] = line
		end
	end
	return out
end

local function decodeAfter(line)
	if not line then
		return nil
	end
	local text = line:match("(%{.*)$")
	return text and JSON.decode(text)
end

--- The change in height the match dumped, keyed "x:z".
local function grid(log)
	local box = find(log, "grid-box ")
	if not box then
		return nil
	end
	local x0 = tonumber(box:match("x0=(%-?%d+)"))
	local out = {}
	for _, line in ipairs(all(log, "grid-row ")) do
		local z = tonumber(line:match("z=(%-?%d+)"))
		local x = x0
		for v in line:match("z=%-?%d+ (.*)$"):gmatch("[^,]+") do
			out[x .. ":" .. z] = tonumber(v)
			x = x + 8
		end
	end
	return out
end

--- The corners a step raises where it was saved.
local function stepCorners(step, anchor)
	local points = {}
	for i, p in ipairs(step.points) do
		points[i] = { x = anchor.x + p.x, z = anchor.z + p.z }
	end
	return GROUND.cellCorners(GROUND.areaCells(points))
end

--- A step's outline as the box round its points, from the middle of the map.
local function box(step, anchor, centre)
	local b = {}
	for _, q in ipairs(step.points) do
		local x, z = anchor.x + q.x - centre.x, anchor.z + q.z - centre.z
		b.x0, b.x1 = math.min(b.x0 or x, x), math.max(b.x1 or x, x)
		b.z0, b.z1 = math.min(b.z0 or z, z), math.max(b.z1 or z, z)
	end
	return string.format("%d,%d..%d,%d", b.x0, b.z0, b.x1, b.z1)
end

local function heights(terrain)
	local out = {}
	for i, s in ipairs(terrain or {}) do
		out[i] = s.height
	end
	table.sort(out)
	return table.concat(out, ",")
end

--- Every step of a height as one, its points all together. A wall longer
-- than one of the gadget's terraform blocks is saved as several steps.
local function byHeight(terrain, h)
	local found
	for _, s in ipairs(terrain or {}) do
		if s.height == h then
			found = found or { height = h, points = {} }
			for _, p in ipairs(s.points) do
				found.points[#found.points + 1] = p
			end
		end
	end
	return found
end

local failures = 0
local function expect(what, actual, expected)
	if tostring(actual) == tostring(expected) then
		print("  ok " .. what .. ": " .. tostring(actual))
	else
		print("  fail " .. what .. ": expected '" .. tostring(expected) .. "', got '" .. tostring(actual) .. "'")
		failures = failures + 1
	end
end

local function finished(log, unit)
	local out = {}
	for _, line in ipairs(all(log, "finished ")) do
		if line:match("unit=" .. unit .. " ") then
			out[#out + 1] = line:match("raised=(%-?[%d.]+)")
		end
	end
	table.sort(out)
	return table.concat(out, ",")
end

local function serialise(value, indent)
	indent = indent or ""
	if type(value) == "table" then
		local parts = {}
		for k, v in pairs(value) do
			local key = type(k) == "number" and "[" .. k .. "]" or string.format("[%q]", k)
			parts[#parts + 1] = indent .. "\t" .. key .. " = " .. serialise(v, indent .. "\t")
		end
		table.sort(parts)
		return "{\n" .. table.concat(parts, ",\n") .. "\n" .. indent .. "}"
	elseif type(value) == "string" then
		return string.format("%q", value)
	end
	return tostring(value)
end

local mode = arg[1]

if mode == "steps" then
	local saved = decodeAfter(find(lines(arg[2]), "save-selection "))
	if not saved then
		io.stderr:write("no saved selection in " .. arg[2] .. "\n")
		os.exit(1)
	end
	local file = assert(io.open(arg[3], "w"))
	file:write("return " .. serialise(saved) .. "\n")
	file:close()
	os.exit(0)
end

if mode == "stats" then
	local log = lines(arg[2])
	local g = grid(log)
	local saved = decodeAfter(find(log, "save-selection "))
	local onStep, buckets = {}, {}
	for _, s in ipairs(saved and saved.entry.terrain or {}) do
		local lo, hi, n = math.huge, -math.huge, 0
		for k in pairs(stepCorners(s, saved.anchor)) do
			local v = g[k]
			if v then
				onStep[k] = true
				lo, hi, n = math.min(lo, v), math.max(hi, v), n + 1
			end
		end
		print(string.format("step height=%s corners=%d change from %.3f to %.3f, spread %.3f", tostring(s.height), n, lo, hi, hi - lo))
	end
	local off = {}
	for k, v in pairs(g) do
		if not onStep[k] then
			local b = string.format("%.1f", v)
			buckets[b] = (buckets[b] or 0) + 1
		end
	end
	for b, n in pairs(buckets) do
		off[#off + 1] = { tonumber(b), n }
	end
	table.sort(off, function(a, b)
		return a[1] < b[1]
	end)
	print("changes off the steps, to 0.1 elmo, with how many corners:")
	for _, o in ipairs(off) do
		print(string.format("  %8.1f  %d", o[1], o[2]))
	end
	-- the smallest difference between two neighbouring corners that differ
	local least, most = math.huge, 0
	for k, v in pairs(g) do
		local x, z = k:match("^(%-?%d+):(%-?%d+)$")
		for _, n in ipairs({ (x + 8) .. ":" .. z, x .. ":" .. (z + 8) }) do
			local w = g[n]
			if w then
				local d = math.abs(v - w)
				if d > 0 then
					least = math.min(least, d)
				end
				if onStep[k] and onStep[n] then
					most = math.max(most, d)
				end
			end
		end
	end
	print(string.format("smallest difference between neighbouring corners that differ: %.3f", least))
	print(string.format("largest difference between neighbouring corners on one step: %.3f", most))
	os.exit(0)
end

if mode == "check" then
	local build, place = lines(arg[2]), lines(arg[3])
	local tol = GROUND.TOLERANCE

	print("  the build match")
	expect("the probe loaded", find(build, "loaded mode=ground_build") ~= nil, true)
	expect("builders", (find(build, "builders count=") or ""):match("count=(%d+)"), 3)
	expect("Lotus finished on ground raised by", finished(build, "turretlaser"), "112.0,112.0")
	expect("solar collectors finished on ground raised by", finished(build, "energysolar"), "0.0,40.0")
	local saved = decodeAfter(find(build, "save-selection "))
	local entry = saved and saved.entry or {}
	-- the trench is past untouched ground east of the pad, so it is not round
	-- the selected buildings
	expect("Save selection saved the wall, in two steps, and the pad", heights(entry.terrain), "40,112,112")
	expect("Save selection marked the entry as from the ground", entry.fromGround, true)
	local defs = {}
	for i, b in ipairs(entry.buildings or {}) do
		defs[i] = b.def
	end
	expect("Save selection put the solar on untouched ground first", table.concat(defs, ","), "energysolar,turretlaser,turretlaser,energysolar")
	expect("Save selection put the steps after it", (entry.terrain or {})[1] and entry.terrain[1].before, 1)
	-- from the middle of the map: the wall's path from 720 to 528 west of it
	-- with 16 either side, and the pad's outline as ordered
	local cx, cz = (find(build, "loaded ") or ""):match("centre=(%-?%d+),(%-?%d+)")
	local centre = { x = tonumber(cx), z = tonumber(cz) }
	local wall, pad = byHeight(entry.terrain, 112), byHeight(entry.terrain, 40)
	expect("the wall's outline", wall and box(wall, saved.anchor, centre), "-736,-16..-528,0")
	expect("the pad's outline", pad and box(pad, saved.anchor, centre), "-64,-48..48,32")
	local ground = decodeAfter(find(build, "save-ground "))
	expect("Save ground saved the pad and the trench", ground and heights(ground.terrain), "-48,40")
	expect("Save ground saved no buildings", ground and #ground.buildings, 0)
	-- anchored at the pad's corner, the trench 272 east of it as ordered
	local origin = { x = 0, z = 0 }
	expect("Save ground's pad", ground and byHeight(ground.terrain, 40) and box(byHeight(ground.terrain, 40), origin, origin), "0,0..112,80")
	expect("Save ground's trench", ground and byHeight(ground.terrain, -48) and box(byHeight(ground.terrain, -48), origin, origin), "272,32..416,48")

	-- every corner of every step has the step's change, where it was saved
	local g = grid(build)
	local off = 0
	for _, s in ipairs(entry.terrain or {}) do
		for k in pairs(stepCorners(s, saved.anchor)) do
			if not g[k] or math.abs(g[k] - s.height) > tol then
				off = off + 1
			end
		end
	end
	expect("corners of the steps not at their step's height in the build match", off, 0)

	print("  the place match")
	expect("the probe placed the saved selection", (find(place, "placed ") or ""), "placed steps=3 buildings=4")
	expect("Lotus finished on ground raised by", finished(place, "turretlaser"), "112.0,112.0")
	expect("solar collectors finished on ground raised by", finished(place, "energysolar"), "0.0,40.0")
	local again = decodeAfter(find(place, "save-selection "))
	expect("saving the placed blueprint gives the same steps", again and JSON.encode(again.entry.terrain), JSON.encode(entry.terrain))
	local p = grid(place)
	local moved, top = 0, 0
	for _, s in ipairs(entry.terrain or {}) do
		for k in pairs(stepCorners(s, saved.anchor)) do
			top = top + 1
			if not (p and p[k] and g[k]) or math.abs(p[k] - g[k]) > tol then
				moved = moved + 1
			end
		end
	end
	expect("step corners that differ between the two matches, of " .. top, moved, 0)
	-- No step raises past its outline: Zero-K raised a wall saved as one area
	-- of two terraform blocks 8 elmos past its end, which the step corners
	-- above cannot show.
	local inside, tops = {}, {}
	for _, s in ipairs(entry.terrain or {}) do
		tops[s.height] = true
		for k in pairs(stepCorners(s, saved.anchor)) do
			inside[k] = true
		end
	end
	local past, slopes = 0, 0
	for k, v in pairs(p or {}) do
		local x = tonumber(k:match("^(%-?%d+):"))
		if not inside[k] and tops[v] then
			past = past + 1
		end
		-- the trench, which the selection left out, is east of here
		if x < centre.x + 160 and g[k] ~= v then
			slopes = slopes + 1
		end
	end
	expect("corners outside the steps at a step's height in the place match", past, 0)
	print(string.format("  corners of slope west of the trench that differ between the two matches: %d", slopes))
	os.exit(failures == 0 and 0 or 1)
end

io.stderr:write("usage: ground_check.lua steps|check|stats ...\n")
os.exit(2)
