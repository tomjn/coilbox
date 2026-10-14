-- The terrain stage after a seek (issue #4025): the ground moves to the new time
-- over as many frames as a budget allows, in tiles, and ends as the track has
-- it. Play at the match's own speed still moves a crater on its frame. The
-- ground comes before the units, and the player is not settled until both are.
--
-- The tracks are made from a table (fake_track.lua). Each has craters spread
-- over a map of 256 by 256 corners and a block of rows on the last frame, the
-- way a recording ends with a read of the whole map.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local UNIT_DEFS = { { name = "tank", health = 1000 } }
local SETTLED = "coilbox_rewind_settled"
local LAST = 3000

--- Craters at frames spread over the match, each a block of corners lowered
-- by a few elmos, and some on top of an earlier one. A corner's height before
-- is its height after the row before, as the format page's rule 3 has it.
local function craters(spec)
	local rows, current = {}, {}
	local seed = 12345
	local function random(n)
		seed = (seed * 1103515245 + 12345) % 2147483648
		return seed % n
	end
	local function lower(frame, x, z, depth)
		local key = z * 65536 + x
		local before = current[key] or (100 + (x + z) % 7)
		local after = before - depth
		current[key] = after
		rows[#rows + 1] = { frame, x, z, before, after }
	end
	for n = 1, (spec.count or 60) do
		local frame = 40 * n
		local cx, cz = 2 + random(250), 2 + random(250)
		for dz = -1, 1 do
			for dx = -1, 1 do
				lower(frame, cx + dx, cz + dz, 1 + random(4))
			end
		end
	end
	-- One corner alone and one line of corners, which would give the engine a
	-- rectangle of no area to work out again.
	lower(1000, 77, 140, 3)
	for x = 30, 40 do
		lower(1100, x, 200, 2)
	end
	-- The read of the whole map at the end, here a block of 40 by 40.
	for z = 100, 139 do
		for x = 100, 139 do
			lower(LAST, x, z, 0.5)
		end
	end
	table.sort(rows, function(a, b)
		if a[1] ~= b[1] then
			return a[1] < b[1]
		end
		if a[3] ~= b[3] then
			return a[3] < b[3]
		end
		return a[2] < b[2]
	end)
	return rows
end

local ROWS = craters({})

--- The height the track has a corner at `frame`: the height after the last
-- row at or before it, or the height before its first row.
local function trackHeight(rows, x, z, frame)
	local height
	for _, row in ipairs(rows) do
		if row[2] == x and row[3] == z then
			if row[1] <= frame then
				height = row[5]
			elseif not height then
				return row[4]
			else
				return height
			end
		end
	end
	return height
end

--- How many corners the engine does not have as the track has them at `frame`.
-- A corner the engine was never told about is the map's own, which is the
-- track's before its first row.
local function wrongCorners(world, rows, frame)
	local seen, wrong, first = {}, 0, nil
	for _, row in ipairs(rows) do
		local key = row[3] * 65536 + row[2]
		if not seen[key] then
			seen[key] = true
			local wanted = trackHeight(rows, row[2], row[3], frame)
			local have = world.height(row[2], row[3])
			if have == nil then
				have = row[4]
			end
			if have ~= wanted then
				wrong = wrong + 1
				first = first or string.format("corner %d,%d has %s where the track has %s", row[2], row[3], tostring(have), tostring(wanted))
			end
		end
	end
	return wrong, first
end

local function setup(spec, budget)
	local world = Engine.new({ unitDefs = UNIT_DEFS, featureDefs = { { name = "rock" } } })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	spec.unitDefs = { "tank" }
	spec.last = spec.last or LAST
	spec.windowLength = spec.windowLength or 900
	spec.terrain = spec.terrain or ROWS
	local player = assert(Player.new(Fake.new(spec), {
		modOptions = {},
		budget = budget,
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
	}))
	world.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			player:unitDestroyed(unitID)
		end,
	}
	return world, player
end

local function seek(player, frame)
	player:message("coilbox_rewind:seek " .. frame)
end

--- Runs frames until the player says the world is the track's, and gives how
-- many it took and the most ground the stage did in one of them.
local function settle(world, player, limit)
	local frames, most = 0, 0
	repeat
		player:frame()
		player:framePost()
		frames = frames + 1
		local _, _, ground = player:worked()
		most = math.max(most, ground or 0)
	until world.params[SETTLED] == 1 or frames >= (limit or 5000)
	return frames, most
end

-- A seek is spread over frames within the ground budget, in tiles.

do
	local world, player = setup({}, 1)
	world.recordRects = true
	player:message("coilbox_rewind:pause")
	player:frame()
	local tile = player.terrain.tile
	t.check("the stage works in tiles", type(tile) == "number" and tile > 0, tostring(tile))
	player:message("coilbox_rewind_budget:1000 1000 30")
	world.heightMapRects = {}
	seek(player, LAST)
	local frames, most = settle(world, player)
	t.check("a seek across the match takes more than one frame with a small budget", frames > 1, frames)
	t.check("a frame does no more ground than its budget and one tile", most <= 30 - 1 + tile * tile, most)
	local wrong, first = wrongCorners(world, ROWS, LAST)
	t.check("the ground at the end of the seek is the track's", wrong == 0, first)
	local wide = 0
	for _, rect in ipairs(world.heightMapRects) do
		if rect[2] - rect[1] >= tile + 1 or rect[4] - rect[3] >= tile + 1 then
			wide = wide + 1
		end
	end
	t.same("no call reaches further than a tile and the corner beside it", wide, 0)
	local flat = 0
	for _, rect in ipairs(world.heightMapRects) do
		if rect[5] > 0 and (rect[1] == rect[2] or rect[3] == rect[4]) then
			flat = flat + 1
		end
	end
	t.same("no call that moved a corner leaves the engine a rectangle of no area", flat, 0)

	-- And back, and to the middle, in both directions.
	for _, frame in ipairs({ 0, 1500, 1040, LAST, 999, 1100, 0 }) do
		seek(player, frame)
		settle(world, player)
		local wrongAt, firstAt = wrongCorners(world, ROWS, frame)
		t.check("after a seek to " .. frame .. " the ground is the track's", wrongAt == 0, firstAt)
	end
end

-- With no budget the ground of a seek is all moved in the frame it is shown.

do
	local world, player = setup({})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 2000)
	player:frame()
	t.same("with no budget the seek settles in one frame", world.params[SETTLED], 1)
	t.same("and the ground is the track's", (wrongCorners(world, ROWS, 2000)), 0)
end

-- The player is not settled until the ground is, and the ground comes before
-- the units: none is made while the ground still moves.

do
	local world, player = setup({
		units = {
			{ first = 1990, last = LAST, at = { 800, 50, 800 } },
			{ first = 1990, last = LAST, at = { 900, 50, 900 } },
		},
	}, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_budget:1000 1000 20")
	seek(player, 2000)
	local before, groundFrames = 0, 0
	repeat
		player:frame()
		player:framePost()
		if player.terrain.unsettled then
			groundFrames = groundFrames + 1
			t.same("not settled while the ground moves", world.params[SETTLED], 0)
			before = before + world.unitCount()
		end
	until world.params[SETTLED] == 1
	t.check("the ground took several frames", groundFrames > 1, groundFrames)
	t.same("no unit was made while the ground still moved", before, 0)
	t.same("the units are made after it", world.unitCount(), 2)
	t.same("and the ground is the track's", (wrongCorners(world, ROWS, 2000)), 0)
end

-- A unit stands where the track has it, at the track's height, while the ground
-- under it settles and after.

do
	-- A crater at frame 500 under a unit that sits in it from then on.
	local rows = {}
	for z = 9, 11 do
		for x = 9, 11 do
			rows[#rows + 1] = { 500, x, z, 100, 90 }
		end
	end
	for z = 0, 200, 4 do
		for x = 0, 200, 4 do
			if x > 20 or z > 20 then
				rows[#rows + 1] = { 600, x, z, 100, 98 }
			end
		end
	end
	table.sort(rows, function(a, b)
		if a[1] ~= b[1] then
			return a[1] < b[1]
		end
		if a[3] ~= b[3] then
			return a[3] < b[3]
		end
		return a[2] < b[2]
	end)
	local world, player = setup({
		last = 1000,
		terrain = rows,
		units = {
			{
				first = 0,
				last = 1000,
				at = function(frame)
					return 80, frame < 500 and 100 or 90, 80
				end,
			},
		},
	}, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_budget:1000 1000 5")
	seek(player, 900)
	local off = 0
	repeat
		player:frame()
		player:framePost()
		local tank = world.unitNamed("tank")
		if tank and tank.y ~= 90 then
			off = off + 1
		end
	until world.params[SETTLED] == 1
	local tank = world.unitNamed("tank")
	t.same("after the ground arrives the unit stands at the track's height", tank and tank.y, 90)
	t.same("and was never at another height on the way", off, 0)
	t.same("the ground under it is the track's", world.height(10, 10), 90)
	t.same("the rest of the ground is too", (wrongCorners(world, rows, 900)), 0)
end

-- Play at the match's own speed moves a crater on its frame, forward and
-- backward, even while a seek's ground is still being moved with a budget of
-- almost nothing.

do
	local world, player = setup({}, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_budget:1000 1000 1")
	-- The crater at frame 1200 is the 30th.
	local crater = 1200
	local cx, cz
	for _, row in ipairs(ROWS) do
		if row[1] == crater then
			cx, cz = cx or row[2], cz or row[3]
		end
	end
	seek(player, LAST)
	player:frame()
	t.same("a seek with a budget of one corner is not settled at once", world.params[SETTLED], 0)
	seek(player, crater - 3)
	player:message("coilbox_rewind:play 1")
	local onFrame
	for _ = 1, 10 do
		player:frame()
		player:framePost()
		if world.params["coilbox_rewind_frame"] == crater then
			onFrame = world.height(cx, cz)
		end
	end
	t.same("played forward at 1x the crater is in the ground on its frame", onFrame, trackHeight(ROWS, cx, cz, crater))
	player:message("coilbox_rewind:play -1")
	local undone
	for _ = 1, 10 do
		player:frame()
		player:framePost()
		if world.params["coilbox_rewind_frame"] == crater - 1 then
			undone = world.height(cx, cz)
		end
	end
	t.same("played backward the crater is gone on the frame before it", undone, trackHeight(ROWS, cx, cz, crater - 1))
	player:message("coilbox_rewind:pause")
	local frame = world.params["coilbox_rewind_frame"]
	settle(world, player)
	t.same("and the seek still settles to the track's ground", (wrongCorners(world, ROWS, frame)), 0)
end

-- A seek that arrives while another one's ground is still moving ends on the
-- second one's ground.

do
	local world, player = setup({}, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_budget:1000 1000 25")
	seek(player, LAST)
	for _ = 1, 3 do
		player:frame()
	end
	t.same("the first seek is still settling", world.params[SETTLED], 0)
	seek(player, 1300)
	settle(world, player)
	t.same("the ground is the second seek's", (wrongCorners(world, ROWS, 1300)), 0)
end

-- The budget message carries the ground's budget as a third number.

do
	local world, player = setup({}, 1)
	t.same("three numbers are the player's", player:message("coilbox_rewind_budget:4 4 900"), true)
	t.same("and take", #world.lines, 1)
	t.same("two numbers still are", player:message("coilbox_rewind_budget:4 4"), true)
	for _, bad in ipairs({ "4 4 0", "4 4 x", "4 4 9 9" }) do
		player:message("coilbox_rewind_budget:" .. bad)
	end
	t.same("and a bad ground budget is refused with a line each", #world.lines, 4)
end

-- Playing through craters allocates nothing. The track is one window, since
-- loading a window allocates, in the units stage as in the reader.

do
	local world, player = setup({ windowLength = LAST }, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_budget:1000 1000 100000")
	seek(player, 0)
	settle(world, player)
	-- Once through, so that the stand-in's own table of heights has every
	-- corner, which is the stand-in's allocation and not the player's.
	player:message("coilbox_rewind:speed 8")
	player:message("coilbox_rewind:play 1")
	for _ = 1, 300 do
		player:frame()
		player:framePost()
	end
	seek(player, 0)
	settle(world, player)
	player:message("coilbox_rewind:play 1")
	collectgarbage()
	collectgarbage("stop")
	player:frame()
	player:framePost()
	local before = collectgarbage("count")
	for _ = 1, 300 do
		player:frame()
		player:framePost()
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play through craters allocate nothing", after - before, 0)
	t.same("and the ground is the track's where play stopped", (wrongCorners(world, ROWS, world.params["coilbox_rewind_frame"])), 0)
end

t.report()
