-- After a seek, the units the viewer is looking at are made first (issue
-- #4008). The gadget's unsynced half tells the player where the camera looks,
-- and the units stage makes the units still to come in that order.
--
-- This file checks what the player does with the view. arrival_test.lua
-- checks how the unsynced half works the view out.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local NAMES = { "tank", "plant" }
local UNIT_DEFS = { { name = "tank", health = 1000 }, { name = "plant", health = 4000, buildTime = 500 } }
local SETTLED = "coilbox_rewind_settled"

local function setup(spec, budget)
	local world = Engine.new({ unitDefs = UNIT_DEFS, featureDefs = { { name = "rock" } }, weaponDefs = { { name = "shell", type = "Cannon" } } })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	spec.unitDefs = NAMES
	spec.weaponDefs = { "shell" }
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

--- `n` units in a row along x, 100 elmos apart, the first at x = 100. Their
-- place in the track's list is their place in the row.
local function row(n, first, last, z)
	local units = {}
	for i = 1, n do
		units[i] = { first = first, last = last, at = { i * 100, 0, z or 0 } }
	end
	return units
end

--- The x of every unit created since the events were last cleared, in the
-- order they were created.
local function createdAt(world)
	local list = {}
	for _, event in ipairs(world.events) do
		local id = event:match("^create (%d+)$")
		if id then
			list[#list + 1] = world.units[tonumber(id)].x
		end
	end
	return table.concat(list, " ")
end

local function frames(player, n)
	for _ = 1, n do
		player:frame()
	end
end

-- With no camera point the order is the track's list.

do
	local world, player = setup({ last = 600, units = row(10, 100, 400) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 4)
	t.same("with no camera point units are made in the order of the track's list", createdAt(world), "100 200 300 400 500 600 700 800 900 1000")
	t.same("settled", world.params[SETTLED], 1)
end

-- With a camera point the nearest come first.

do
	local world, player = setup({ last = 600, units = row(10, 100, 400) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the view message is the player's", player:message("coilbox_rewind_view:1000 0"), true)
	seek(player, 150)
	player:frame()
	t.same("the first frame makes the three nearest the camera point", createdAt(world), "1000 900 800")
	t.same("and is not settled", world.params[SETTLED], 0)
	player:frame()
	t.same("the next frame makes the next nearest", createdAt(world), "1000 900 800 700 600 500")
	frames(player, 2)
	t.same("and so on to the farthest", createdAt(world), "1000 900 800 700 600 500 400 300 200 100")
	t.same("the settled world has every unit of the track", world.unitCount(), 10)
	t.same("settled", world.params[SETTLED], 1)
	t.same("each was made once", world.nextUnit - 100, 10)

	world.events = {}
	seek(player, 0)
	frames(player, 4)
	t.same("a seek back removes them all", world.unitCount(), 0)
	player:message("coilbox_rewind_view:480 0")
	world.events = {}
	seek(player, 150)
	frames(player, 4)
	t.same("a camera point in the middle makes outward from it, and two as near are made in the list's order", createdAt(world), "500 400 600 300 700 200 800 100 900 1000")
end

-- The view's four corners on the ground put a unit inside them before any unit
-- outside, however near the middle the one outside is.

do
	-- A view that is long in x and thin in z, round the origin.
	local view = "coilbox_rewind_view:0 0 -1000 -50 1000 -50 1000 50 -1000 50"
	local units = {
		{ first = 100, last = 400, at = { 900, 0, 0 } },
		{ first = 100, last = 400, at = { 0, 0, 200 } },
		{ first = 100, last = 400, at = { -500, 0, 10 } },
		{ first = 100, last = 400, at = { 0, 0, -100 } },
		{ first = 100, last = 400, at = { 100, 0, 0 } },
	}
	local world, player = setup({ last = 600, units = units }, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("a view with corners is the player's", player:message(view), true)
	seek(player, 150)
	frames(player, 5)
	local places = {}
	for _, event in ipairs(world.events) do
		local unit = world.units[tonumber(event:match("^create (%d+)$"))]
		places[#places + 1] = unit.x .. "," .. unit.z
	end
	t.same("the three inside the view are made first, nearest the middle first, then the two outside", table.concat(places, " "), "100,0 -500,10 900,0 0,-100 0,200")
	t.same("settled", world.params[SETTLED], 1)
end

-- The camera moves while a seek settles, and the units still to come follow it.

do
	local world, player = setup({ last = 600, units = row(10, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_view:100 0")
	seek(player, 150)
	frames(player, 2)
	t.same("the first frames make the units nearest the camera point", createdAt(world), "100 200 300 400")
	player:message("coilbox_rewind_view:1000 0")
	frames(player, 3)
	t.same("after the camera moved, the rest are made nearest the new point first", createdAt(world), "100 200 300 400 1000 900 800 700 600 500")
	t.same("settled", world.params[SETTLED], 1)
end

-- A view that is taken away gives the list's order back.

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_view:600 0")
	t.same("a message that there is no view is the player's", player:message("coilbox_rewind_view:none"), true)
	seek(player, 150)
	frames(player, 3)
	t.same("with the view taken away the order is the list's again", createdAt(world), "100 200 300 400 500 600")
end

-- Removals still come before creations.

do
	local units = row(6, 0, 100)
	for _, one in ipairs(row(6, 101, 300, 500)) do
		units[#units + 1] = one
	end
	local world, player = setup({ last = 400, units = units }, 2)
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind_view:600 500")
	seek(player, 50)
	frames(player, 3)
	t.same("the first six are there", world.unitCount(), 6)
	world.events = {}
	seek(player, 200)
	frames(player, 7)
	local lastRemove, firstCreate
	for n, event in ipairs(world.events) do
		if event:find("^remove") then
			lastRemove = n
		elseif event:find("^create") and not firstCreate then
			firstCreate = n
		end
	end
	t.check("with a view no unit is made before every unit that goes has gone", lastRemove and firstCreate and lastRemove < firstCreate, table.concat(world.events, ", "))
	t.same("and the ones made are made nearest first", createdAt(world), "600 500 400 300 200 100")
	t.same("settled", world.params[SETTLED], 1)
end

-- Play goes on while a seek settles. A unit that is born after the order was
-- worked out is still made.

do
	local units = row(6, 0, 1000)
	units[#units + 1] = { first = 3, last = 1000, at = { 5000, 0, 0 } }
	local world, player = setup({ last = 1000, units = units }, 1)
	player:message("coilbox_rewind_view:100 0")
	frames(player, 12)
	t.same("a unit born while the seek settles is made too", world.unitCount(), 7)
	t.same("settled", world.params[SETTLED], 1)
end

-- A message that is not a view is refused and changes nothing.

do
	local world, player = setup({ last = 600, units = row(4, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_view:400 0")
	local before = #world.lines
	for _, bad in ipairs({ "", "x 4", "4", "1 2 3", "nan 4", "4 inf", "1 2 3 4 5 6 7 8 9", "1 2 3 4 5 6 7 8 9 x", "1 2 3 4 5 6 7 8 9 10 11" }) do
		t.same("the message with \"" .. bad .. "\" is the player's", player:message("coilbox_rewind_view:" .. bad), true)
	end
	t.same("each is refused and logged", #world.lines - before, 9)
	t.check("the line says why", world.lines[#world.lines]:find("view", 1, true) ~= nil, world.lines[#world.lines])
	seek(player, 150)
	frames(player, 2)
	t.same("a refused view leaves the last good one", createdAt(world), "400 300 200 100")
	t.same("a message for somebody else is not taken", player:message("coilbox_rewind_views:2 2"), false)
end

-- A seek that fits in one frame is not sorted at all.

do
	local world, player = setup({ last = 600, units = row(5, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind_view:500 0")
	seek(player, 150)
	player:frame()
	t.same("with no budget every unit is made in the one frame", world.unitCount(), 5)
	t.same("settled", world.params[SETTLED], 1)
end

-- Play with a view allocates nothing, and neither does a view that stands
-- still while nothing is to be made.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, 7)
	player:message("coilbox_rewind_view:2000 0 0 -500 4000 -500 4000 500 0 500")
	frames(player, 8)
	t.same("the forty are made", world.unitCount(), 40)
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first frames
	-- after it take that back, which is the interpreter's and not the player's.
	player:frame()
	player:framePost()
	local before = collectgarbage("count")
	for _ = 1, 300 do
		player:frame()
		player:framePost()
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play with a view allocate nothing", after - before, 0)
end

t.report()
