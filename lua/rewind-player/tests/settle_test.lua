-- A seek that needs more units made or removed than one frame has time for
-- settles over several frames (issue #3988): how many a frame does, the order
-- the work is done in, a second seek while the first settles, play while it
-- settles, and what the player publishes to say the world has caught up.
--
-- The player takes the count a frame may do as an option and as a message, and
-- the gadget's unsynced half works it out from the time a frame's work took.
-- gadget_test.lua checks that half. This file checks what the player does with
-- the count.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local NAMES = { "tank", "plant", "radar" }
local UNIT_DEFS = {
	{ name = "tank", health = 1000 },
	{ name = "plant", health = 4000, buildTime = 500 },
	{ name = "radar", health = 200, onoffable = true },
}
local SETTLED = "coilbox_rewind_settled"

--- A world and a player of `spec`. `budget` is the most units the player may
-- make or remove in a frame, or nil for no limit.
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

--- `n` units that stand still from `first` to `last`, each 10 elmos along.
local function row(n, first, last, def)
	local units = {}
	for i = 1, n do
		units[i] = { first = first, last = last, def = def or 0, at = { i * 10, 0, 0 } }
	end
	return units
end

local function append(list, more)
	for _, one in ipairs(more) do
		list[#list + 1] = one
	end
	return list
end

--- The index in the world's events of the last one that starts with `kind`
-- and the first.
local function span(world, kind)
	local first, last
	for n, event in ipairs(world.events) do
		if event:find("^" .. kind) then
			first = first or n
			last = n
		end
	end
	return first, last
end

-- A seek that needs more units than a frame may make settles over several
-- frames.

do
	local world, player = setup({ last = 600, units = row(10, 100, 400) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the first frame has nothing to make", world.unitCount(), 0)
	t.same("so the world is settled", world.params[SETTLED], 1)

	seek(player, 150)
	t.same("a seek says the world is not settled before the frame that shows it", world.params[SETTLED], 0)
	local counts, flags, made = {}, {}, {}
	for n = 1, 5 do
		player:frame()
		counts[n], flags[n], made[n] = world.unitCount(), world.params[SETTLED], player.units.made
	end
	t.same("a frame makes at most the budget", table.concat(counts, " "), "3 6 9 10 10")
	t.same("the player says it is not settled until the last is made", table.concat(flags, " "), "0 0 0 1 1")
	t.same("the units stage says how many it made in each frame", table.concat(made, " "), "3 3 3 1 0")
	t.same("every unit has been made once", world.nextUnit - 100, 10)
end

-- A seek into another window reads that window, which no budget covers, and
-- on a Beyond All Reason match took 8.5 to 9.4 ms of the seek's first frame
-- (issue #4037). So that frame makes and removes nothing, and the next one
-- starts on the budget. A seek inside the window already read starts at once.

do
	local units = append(row(10, 100, 400), row(6, 180, 400))
	local world, player = setup({ last = 600, windowLength = 100, units = units }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	local counts, starts, flags = {}, {}, {}
	for n = 1, 5 do
		player:frame()
		counts[n], starts[n], flags[n] = world.unitCount(), tostring(player:started()), world.params[SETTLED]
	end
	t.same("the first frame of a seek into another window makes nothing", table.concat(counts, " "), "0 3 6 9 10")
	t.same("and says it was the start", table.concat(starts, " "), "true false false false false")
	t.same("and is not settled", table.concat(flags, " "), "0 0 0 0 1")
	seek(player, 190)
	counts = {}
	for n = 1, 3 do
		player:frame()
		counts[n] = world.unitCount()
	end
	t.same("a seek inside the window already read starts on its first frame", table.concat(counts, " "), "13 16 16")
	t.same("and is no start", tostring(player:started()), "false")
	seek(player, 0)
	counts = {}
	for n = 1, 7 do
		player:frame()
		counts[n] = world.unitCount()
	end
	t.same("removals wait for the start as well", table.concat(counts, " "), "16 13 10 7 4 1 0")
end

-- A budget of nothing means no limit, and the least a frame may do is one.

do
	local world, player = setup({ last = 600, units = row(10, 100, 400) })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	player:frame()
	t.same("with no budget a seek is shown in one frame", world.unitCount(), 10)
	t.same("and it is settled", world.params[SETTLED], 1)

	local world2, player2 = setup({ last = 600, units = row(4, 100, 400) }, 0)
	player2:message("coilbox_rewind:pause")
	seek(player2, 150)
	player2:frame()
	t.same("a budget below one still makes one unit, so that a seek settles", world2.unitCount(), 1)
end

-- The first unit of each definition in the run costs the engine and the game
-- more than the next ones, so the units stage says how many a frame made, for
-- the unsynced half to leave out of the trend in what a unit costs (issue
-- #4015).

do
	local units = append(row(3, 100, 400, 0), row(3, 100, 400, 1))
	local world, player = setup({ last = 600, units = units }, 2)
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	local firsts = {}
	for n = 1, 4 do
		player:frame()
		firsts[n] = player:firstUnits()
	end
	t.same("a frame says how many of its units were the first of their definition", table.concat(firsts, " "), "1 1 0 0")
	seek(player, 0)
	for _ = 1, 3 do
		player:frame()
	end
	t.same("the seek back removed them", world.unitCount(), 0)
	seek(player, 150)
	firsts = {}
	for n = 1, 4 do
		player:frame()
		firsts[n] = player:firstUnits()
	end
	t.same("and a later seek makes none, since the first of a definition is the first in the run", table.concat(firsts, " "), "0 0 0 0")
	t.same("though it made them all again", world.unitCount(), 6)
end

-- What a frame does first is remove, and removals are the budget's too.

do
	local units = append(row(8, 0, 100, 0), row(8, 101, 300, 1))
	local world, player = setup({ last = 400, units = units }, 3)
	player:message("coilbox_rewind:pause")
	seek(player, 50)
	for _ = 1, 4 do
		player:frame()
	end
	t.same("the first eight are there", world.unitCount(), 8)
	t.same("settled", world.params[SETTLED], 1)
	world.events = {}
	seek(player, 200)
	local counts, flags = {}, {}
	for n = 1, 6 do
		player:frame()
		counts[n], flags[n] = world.unitCount(), world.params[SETTLED]
	end
	t.same("removals take the budget, then creations take what is left of it", table.concat(counts, " "), "5 2 1 4 7 8")
	t.same("it is settled with the sixth frame", table.concat(flags, " "), "0 0 0 0 0 1")
	local _, lastRemove = span(world, "remove")
	local firstCreate = span(world, "create")
	t.check("no unit is made before every unit that goes has gone", lastRemove and firstCreate and lastRemove < firstCreate, table.concat(world.events, ", "))
	t.same("and every unit the seek removed went quietly, in the later frames too", span(world, "explode"), nil)
	local removals = 0
	for _, event in ipairs(world.events) do
		if event:find("^remove") then
			removals = removals + 1
		end
	end
	t.same("all eight went", removals, 8)
	t.same("only the second row is there", world.unitNamed("plant") ~= nil and world.unitNamed("tank") == nil, true)
end

-- A second seek while the first settles starts again.

do
	local units = append(row(10, 100, 200, 0), row(10, 300, 400, 1))
	local world, player = setup({ last = 600, units = units }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	player:frame()
	t.same("three of the first ten are made", world.unitCount(), 3)
	seek(player, 350)
	t.same("a second seek while one settles says not settled", world.params[SETTLED], 0)
	player:frame()
	t.same("the next frame removes what the new time does not have", world.unitCount(), 0)
	for _ = 1, 6 do
		player:frame()
	end
	t.same("and the new time settles with its own ten", world.unitCount(), 10)
	t.same("all of them plants", world.unitNamed("tank"), nil)
	t.same("settled", world.params[SETTLED], 1)
	t.same("three were made for the first seek and ten for the second", world.nextUnit - 100, 13)

	seek(player, 150)
	for _ = 1, 8 do
		player:frame()
	end
	t.same("and a seek back settles the first ten again", world.unitCount(), 10)
	t.same("with only tanks", world.unitNamed("plant"), nil)
end

-- Play goes on while a seek settles, and units made late stand where the
-- track has them now.

do
	local units = {}
	for i = 1, 10 do
		units[i] = {
			first = 0,
			last = 1000,
			at = function(frame)
				return i * 10, frame, 0
			end,
		}
	end
	local world, player = setup({ last = 1000, units = units }, 3)
	player:frame()
	t.same("the opening frame makes three", world.unitCount(), 3)
	local frames = {}
	for n = 1, 4 do
		player:frame()
		frames[n] = player.clock.frame
	end
	t.same("play goes on while the world settles", table.concat(frames, " "), "1 2 3 4")
	t.same("all ten are made", world.unitCount(), 10)
	local right = true
	for _, unit in pairs(world.units) do
		if unit.y ~= player.clock.frame then
			right = false
		end
	end
	t.check("each stands where the track has it at the time shown, the late ones too", right)
	t.same("settled", world.params[SETTLED], 1)
	t.same("and still playing", world.params.coilbox_rewind_playing, 1)
end

-- The flag.

do
	local world, player = setup({ last = 600, units = row(2, 0, 600) })
	t.same("before the first frame the world is not settled", world.params[SETTLED], 0)
	player:frame()
	t.same("after the first frame it is", world.params[SETTLED], 1)
	player:message("coilbox_rewind:speed 2")
	t.same("a message that moves nothing leaves it", world.params[SETTLED], 1)
	player:message("coilbox_rewind:step 10")
	t.same("a step is a seek", world.params[SETTLED], 0)
	player:frame()
	t.same("and the frame that shows it settles it", world.params[SETTLED], 1)
end

-- Making and removing have a budget each.

do
	local units = append(row(6, 0, 100, 0), row(6, 101, 300, 1))
	local world, player = setup({ last = 400, units = units }, 3)
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind_budget:4 2")
	seek(player, 50)
	player:frame()
	t.same("a frame makes as many as the make budget", world.unitCount(), 4)
	t.same("and says so", table.concat({ player:worked() }, " "), "4 0 0")
	player:frame()
	t.same("then the rest", world.unitCount(), 6)
	seek(player, 200)
	local counts, removed, made = {}, {}, {}
	for n = 1, 5 do
		player:frame()
		counts[n], removed[n], made[n] = world.unitCount(), player.units.removed, player.units.made
	end
	t.same("a frame removes as many as the remove budget", table.concat(removed, " "), "2 2 2 0 0")
	t.same("the frame that removes the last has no room to make", table.concat(made, " "), "0 0 0 4 2")
	t.same("so the count goes down and then up", table.concat(counts, " "), "4 2 0 4 6")

	seek(player, 50)
	player:frame()
	t.same("a frame that uses its whole removal budget makes nothing", table.concat({ player:worked() }, " "), "0 2 0")
end

-- The count arrives as a message.

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) })
	player:message("coilbox_rewind:pause")
	t.same("the budget message is the player's", player:message("coilbox_rewind_budget:2 3"), true)
	seek(player, 150)
	player:frame()
	t.same("it limits the frame", world.unitCount(), 2)
	player:message("coilbox_rewind_budget:4 4")
	player:frame()
	t.same("a new count applies to the next frame", world.unitCount(), 6)
	local before = #world.lines
	for _, bad in ipairs({ "x 4", "0 4", "4 -3", "1.5 4", "", "4", "nan 4", "4 inf", "4 4 4 4" }) do
		t.same("the message with \"" .. bad .. "\" is the player's", player:message("coilbox_rewind_budget:" .. bad), true)
	end
	t.same("each is refused and logged", #world.lines - before, 9)
	t.check("the line says why", world.lines[#world.lines]:find("budget", 1, true) ~= nil, world.lines[#world.lines])
	seek(player, 0)
	player:frame()
	player:frame()
	t.same("everything is removed", world.unitCount(), 0)
	seek(player, 150)
	player:frame()
	t.same("a refused count changes nothing", world.unitCount(), 4)
	t.same("a message for somebody else is not taken", player:message("coilbox_rewind_budgets:2 2"), false)
end

-- A shot whose unit is not made yet waits for it.

do
	local units = row(2, 0, 400)
	local world, player = setup({
		last = 400,
		units = units,
		projectiles = { { first = 0, last = 400, shooter = 2, at = { 50, 100, 0, 0, 0, 0 } } },
	}, 1)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the first frame makes one unit", world.unitCount(), 1)
	local firstID = next(world.units)
	t.same("its shooter is not made, so the shot is not either", next(world.projectiles), nil)
	t.same("and the world is not settled", world.params[SETTLED], 0)
	player:frame()
	t.same("the next frame makes the second unit", world.unitCount(), 2)
	local _, shot = next(world.projectiles)
	t.check("and the shot with it", shot ~= nil)
	local secondID
	for id in pairs(world.units) do
		if id ~= firstID then
			secondID = id
		end
	end
	t.same("owned by the unit that fired it", shot and shot.owner, secondID)
	t.same("settled", world.params[SETTLED], 1)
end

-- Playing with a limit and nothing to make allocates nothing.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, 7)
	for _ = 1, 8 do
		player:frame()
	end
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
	t.same("300 frames of play with a budget allocate nothing", after - before, 0)
end

t.report()
