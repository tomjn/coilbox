-- A jump's units arrive and leave under an orb (issues #4009 and #4051). The
-- units stage says which units get one and holds them until the orbs are full,
-- the gadget hands that to its unsynced half, and the unsynced half draws it.
--
-- The first part checks the units stage: which units the player asks an orb for,
-- and what it holds back. The second checks the unsynced modules on a stand-in
-- for `Spring` and `gl`: how the view is worked out and when it is sent (issue
-- #4008), and what the orb draws, when and how fast. None of it shows how the
-- effect looks.

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

--- A world and a player of `spec`. The orbs the player asks for are in
-- `world.asked`, each as the x of the unit, and `world.askedWith` has every
-- argument. `world.cancelled` has the serials of the ones taken away. `hooks`
-- are an adapter's.
local function setup(spec, budget, hooks)
	local world = Engine.new({ unitDefs = UNIT_DEFS, featureDefs = { { name = "rock" } }, weaponDefs = { { name = "shell", type = "Cannon" } } })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local Adapter = t.load("coilbox_player_adapter.lua", env)
	spec.unitDefs = NAMES
	spec.weaponDefs = { "shell" }
	world.asked = {}
	world.askedWith = {}
	world.cancelled = {}
	local player = assert(Player.new(Fake.new(spec), {
		modOptions = {},
		budget = budget,
		adapter = hooks and Adapter.normalize({ name = "Test", hooks = hooks }) or nil,
		arrive = function(serial, defID, x, y, z, gated)
			world.asked[#world.asked + 1] = x
			world.askedWith[#world.askedWith + 1] = table.concat({ serial, defID, x, y, z, tostring(gated) }, " ")
		end,
		cancel = function(serial)
			world.cancelled[#world.cancelled + 1] = serial
		end,
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
	-- The unsynced half says it can draw orbs.
	player:message("coilbox_rewind_orbs:ready")
	return world, player
end

local function seek(player, frame)
	player:message("coilbox_rewind:seek " .. frame)
end

local function frames(player, n)
	for _ = 1, n do
		player:frame()
	end
end

--- What the unsynced half says when the orbs have grown.
local function full(player)
	player:message("coilbox_rewind_orbs:full")
end

--- `n` units in a row along x, 100 elmos apart, the first at x = 100.
local function row(n, first, last, team)
	local units = {}
	for i = 1, n do
		units[i] = { first = first, last = last, at = { i * 100, 5, 7 }, team = team }
	end
	return units
end

local function asked(world)
	return table.concat(world.asked, " ")
end

local function sorted(world)
	local copy = {}
	for i, x in ipairs(world.asked) do
		copy[i] = x
	end
	table.sort(copy)
	return table.concat(copy, " ")
end

-- A jump asks for an orb for each unit it makes, in the frame that shows it,
-- and makes none of them until the orbs are full.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400, 1) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	player:frame()
	t.same("the frame that shows a jump asks for an orb for every unit it will make", sorted(world), "100 200 300 400 500 600 700 800")
	frames(player, 5)
	t.same("no unit is made while the orbs grow", world.unitCount(), 0)
	t.same("and the jump is not settled", world.params[SETTLED], 0)
	full(player)
	player:frame()
	t.same("when they are full the units are made as the budget allows", world.unitCount(), 3)
	frames(player, 3)
	t.same("all of them", world.unitCount(), 8)
	t.same("settled", world.params[SETTLED], 1)
	t.same("with no more orbs asked for", #world.asked, 8)
	t.check("an ask has the unit's serial, its definition, its place and that units wait for it", world.askedWith[4]:find("^%d+ 1 400 5 7 true$") ~= nil, world.askedWith[4])
end

-- A jump that is shown in one frame asks for them too, however fast it is.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("a jump with no budget asks for every orb", sorted(world), "100 200 300 400 500 600 700 800")
	t.same("and makes no unit while they grow", world.unitCount(), 0)
	full(player)
	player:frame()
	t.same("then makes every unit in the next frame", world.unitCount(), 8)
	t.same("settled", world.params[SETTLED], 1)
	local before = #world.asked
	seek(player, 160)
	frames(player, 3)
	t.same("a jump that makes and removes none asks for none", #world.asked, before)
	seek(player, 450)
	frames(player, 2)
	full(player)
	frames(player, 2)
	seek(player, 150)
	frames(player, 2)
	full(player)
	frames(player, 2)
	t.same("a jump back that removes and makes them again asks again", #world.asked - before, 8 + 8)
end

-- The first frame of a playback is not a jump the viewer made.

do
	local world, player = setup({ last = 600, units = row(5, 0, 400) }, 2)
	frames(player, 6)
	t.same("every unit is made", world.unitCount(), 5)
	t.same("the units the playback starts with get no orb", asked(world), "")
end

-- Jump keys and a wrap from the end are jumps.

do
	local world, player = setup({ last = 600, units = row(4, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind:step 200")
	frames(player, 2)
	t.same("a step is a jump", sorted(world), "100 200 300 400")
end

do
	local world, player = setup({ last = 600, units = row(4, 0, 100) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 600)
	frames(player, 2)
	full(player)
	frames(player, 2)
	t.same("no unit stands at the end", world.unitCount(), 0)
	world.asked = {}
	player:message("coilbox_rewind:play")
	frames(player, 3)
	t.same("a play from the end starts again from the first frame, which is a jump", sorted(world), "100 200 300 400")
	t.same("and the units wait for the orbs", world.unitCount(), 0)
end

-- Units that a jump removes get an orb too, and are removed once it is full.

do
	local world, player = setup({ last = 600, units = row(6, 0, 100) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 50)
	frames(player, 2)
	full(player)
	frames(player, 5)
	t.same("the six are made", world.unitCount(), 6)
	world.asked = {}
	seek(player, 200)
	frames(player, 4)
	t.same("a jump that removes them all asks for an orb for each", sorted(world), "100 200 300 400 500 600")
	t.same("and removes none while they grow", world.unitCount(), 6)
	t.same("so it is not settled", world.params[SETTLED], 0)
	full(player)
	frames(player, 4)
	t.same("then removes them", world.unitCount(), 0)
	t.same("and settles", world.params[SETTLED], 1)
end

-- A removal that is held holds up every creation, which comes after the
-- removals.

do
	local units = row(3, 0, 100)
	units[4] = { first = 200, last = 600, at = { 5000, 5, 7 } }
	local world, player = setup({ last = 600, units = units }, 10)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 50)
	frames(player, 2)
	full(player)
	frames(player, 3)
	t.same("three units stand", world.unitCount(), 3)
	-- A view that has the three and not the unit that comes.
	player:message("coilbox_rewind_view:200 7 0 -100 450 -100 450 100 0 100")
	seek(player, 300)
	frames(player, 3)
	t.same("the unit outside the view is not made while a removal in view waits for its orb", world.unitCount(), 3)
	full(player)
	frames(player, 3)
	t.same("then the three go and the one comes", world.unitCount(), 1)
end

-- Units outside the view get no orb and no wait.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400) }, 10)
	player:message("coilbox_rewind:pause")
	player:frame()
	-- A view round the units at 100 to 400.
	player:message("coilbox_rewind_view:250 7 50 -100 450 -100 450 100 50 100")
	seek(player, 150)
	frames(player, 2)
	t.same("an orb for each unit in view and none for the others", sorted(world), "100 200 300 400")
	t.same("the units outside the view are made at once, with no wait", world.unitCount(), 4)
	full(player)
	frames(player, 2)
	t.same("and the others once the orbs are full", world.unitCount(), 8)
	t.same("with no orb for them", #world.asked, 4)
end

-- No more orbs than the module draws, and the units past it wait for nothing.

do
	local Units = t.load("coilbox_player_units.lua", t.unsyncedEnv())
	local world, player = setup({ last = 600, units = row(300, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 2)
	t.same("a jump of more units than the most asks for the most", #world.asked, Units.MOST_ORBS)
	t.same("and the others are made at once", world.unitCount(), 300 - Units.MOST_ORBS)
	full(player)
	frames(player, 2)
	t.same("then the rest", world.unitCount(), 300)
end

-- Plain play asks for none, in either direction at any speed.

do
	local units = row(6, 0, 100)
	units[#units + 1] = { first = 300, last = 600, at = { 5000, 0, 0 } }
	local world, player = setup({ last = 600, units = units }, 2)
	player:message("coilbox_rewind:pause")
	seek(player, 298)
	frames(player, 3)
	full(player)
	frames(player, 3)
	world.asked = {}
	player:message("coilbox_rewind:play")
	frames(player, 5)
	t.same("a unit built during play is made", world.unitCount(), 1)
	t.same("with no orb", asked(world), "")
end

do
	for _, speed in ipairs({ 0.5, 1, 2, 4, 8, 16, 32 }) do
		for _, way in ipairs({ 1, -1 }) do
			-- Units come and go along the track, so that play both makes and removes,
			-- from either end.
			local units = {}
			for i = 1, 30 do
				units[i] = { first = i * 10, last = i * 10 + 40, at = { i * 100, 0, 0 } }
				units[30 + i] = { first = 300, last = 520 + i * 2, at = { 3000 + i * 100, 0, 0 } }
			end
			local placed = 0
			local world, player = setup({ last = 600, units = units }, 3, {
				unitPlaced = function()
					placed = placed + 1
				end,
			})
			player:message("coilbox_rewind:pause")
			player:frame()
			seek(player, way == 1 and 0 or 600)
			frames(player, 2)
			full(player)
			frames(player, 6)
			world.asked = {}
			placed = 0
			player:message("coilbox_rewind:direction " .. way)
			player:message("coilbox_rewind:speed " .. speed)
			player:message("coilbox_rewind:play")
			frames(player, 60)
			t.check("play at " .. speed .. "x " .. (way == 1 and "forward" or "backward") .. " made units", placed > 0, placed)
			t.same("and asked for no orb", asked(world), "")
		end
	end
end

-- Dragging the timeline's knob asks for none until the drag ends, and then for
-- the units the drag made, which are not held.

do
	local world, player = setup({ last = 600, units = row(12, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the drag message is the player's", player:message("coilbox_rewind:drag 1"), true)
	seek(player, 150)
	frames(player, 2)
	seek(player, 160)
	frames(player, 2)
	t.same("units are made during a drag with no wait", world.unitCount(), 8)
	t.same("and no orb is asked for", asked(world), "")
	player:message("coilbox_rewind:drag 0")
	frames(player, 3)
	t.same("when the drag ends the units it made get one each", #world.asked, 8)
	t.same("and the ones still to come are made, with none", world.unitCount(), 12)
	t.check("the orbs are not ones units wait for", world.askedWith[1]:find("false$") ~= nil, world.askedWith[1])
	t.same("settled", world.params[SETTLED], 1)
	local count = #world.asked
	frames(player, 3)
	t.same("and once each", #world.asked, count)

	local before = #world.lines
	t.same("a drag that is neither 1 nor 0 is the player's", player:message("coilbox_rewind:drag 2"), true)
	t.same("and is refused and logged", #world.lines - before, 1)
end

-- A drag that ends where the units it made are gone asks for none of them, and
-- a drag that made none asks for none.

do
	local world, player = setup({ last = 600, units = row(6, 100, 300) }, 6)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind:drag 1")
	seek(player, 150)
	frames(player, 2)
	seek(player, 500)
	frames(player, 2)
	t.same("the units a drag made were removed by its next seek", world.unitCount(), 0)
	player:message("coilbox_rewind:drag 0")
	frames(player, 2)
	t.same("so that its end asks for none", asked(world), "")
	player:message("coilbox_rewind:drag 1")
	player:message("coilbox_rewind:drag 0")
	frames(player, 2)
	t.same("and a drag that made nothing asks for nothing", asked(world), "")
end

-- A jump after a drag is a jump again.

do
	local world, player = setup({ last = 600, units = row(4, 100, 300) }, 6)
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind:drag 1")
	seek(player, 150)
	frames(player, 2)
	player:message("coilbox_rewind:drag 0")
	frames(player, 2)
	t.same("a drag's end asks for its units", sorted(world), "100 200 300 400")
	world.asked = {}
	seek(player, 500)
	frames(player, 2)
	full(player)
	frames(player, 2)
	seek(player, 150)
	frames(player, 2)
	t.same("a click after it asks for the units it removes and then for the ones it makes", sorted(world), "100 100 200 200 300 300 400 400")
end

-- An adapter that shows its own effect takes the orb away, and is asked again
-- for a unit a drag made when the drag ends.

do
	local calls = {}
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 6, {
		unitPlaced = function(unitID, unitDefID, frame, clock, effect)
			calls[#calls + 1] = tostring(effect)
			-- It shows its own for some and leaves the others to the player.
			return effect and unitID ~= nil and unitDefID ~= nil and frame == 150 and clock ~= nil and #calls % 2 == 0
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 2)
	full(player)
	frames(player, 2)
	t.same("the hook is told for each unit that the player has an orb for it", table.concat(calls, " "), "true true true true true true")
	t.same("and the player takes the orb away of each unit the hook said it handled", #world.cancelled, 3)
end

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 6, {
		unitPlaced = function() end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 2)
	full(player)
	frames(player, 2)
	t.same("a hook that gives nothing back leaves the orb", #world.cancelled, 0)
end

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 6, {
		unitPlaced = function(_, _, _, _, effect)
			if effect then
				error("broken")
			end
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 2)
	full(player)
	frames(player, 2)
	t.same("a hook that raises leaves the orb too", #world.cancelled, 0)
	t.same("and the units are made", world.unitCount(), 6)
end

do
	local calls = {}
	local world, player = setup({ last = 600, units = row(4, 100, 400) }, 6, {
		unitPlaced = function(_, _, _, _, effect)
			calls[#calls + 1] = tostring(effect)
			return effect
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind:drag 1")
	seek(player, 150)
	frames(player, 2)
	t.same("during the drag the hook is told the player shows none", table.concat(calls, " "), "false false false false")
	player:message("coilbox_rewind:drag 0")
	frames(player, 2)
	t.same("when it ends the hook is told again, with the effect", table.concat(calls, " "), "false false false false true true true true")
	t.same("and the player shows none for the units it handled", asked(world), "")
end

-- A new jump while the orbs of one grow starts again.

do
	local world, player = setup({ last = 600, units = row(4, 100, 400) }, 6)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 2)
	seek(player, 160)
	frames(player, 2)
	t.same("a jump that arrives while the orbs of another grow asks for its own", #world.asked, 8)
	t.same("and the units still wait", world.unitCount(), 0)
	full(player)
	frames(player, 2)
	t.same("until they are full", world.unitCount(), 4)
	t.same("settled", world.params[SETTLED], 1)
end

-- A player that is given nowhere to ask makes its units all the same.

do
	local world = Engine.new({ unitDefs = UNIT_DEFS })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local player = assert(Player.new(Fake.new({ last = 600, unitDefs = NAMES, units = row(6, 100, 400) }), {
		modOptions = {},
		budget = 2,
		log = function() end,
	}))
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	local ok, err = pcall(frames, player, 3)
	t.check("with nowhere to ask for an orb the player raises nothing", ok, err)
	t.same("makes every unit", world.unitCount(), 6)
	t.same("and waits for nothing", world.params[SETTLED], 1)
end

-- A jump with orbs allocates nothing more in a frame of play.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, 7)
	frames(player, 1)
	seek(player, 1500)
	frames(player, 2)
	full(player)
	frames(player, 8)
	t.same("the forty are made", world.unitCount(), 40)
	t.check("some with an orb", #world.asked > 0, #world.asked)
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
	t.same("300 frames of play after it allocate nothing", after - before, 0)
end

-- The unsynced half. Both modules take the engine as a table.

local Unsynced = dofile(here .. "/unsynced.lua")
local View = t.load("coilbox_player_view.lua", t.unsyncedEnv())
local Arrival = t.load("coilbox_player_arrival.lua", t.unsyncedEnv())

-- The view: the place in the middle of the screen and the four corners, on the
-- ground, as a message for the player.

do
	local e = Unsynced.new()
	local view = View.new(e.Spring)
	t.same("the view's message is the one the player takes", View.MESSAGE, "coilbox_rewind_view:")
	t.same("the first look sends the middle and the four corners, going round", view:poll(), "coilbox_rewind_view:4000 3000 3200 3450 4799 3450 4799 2551 3200 2551")
	t.same("a look takes five rays", e.traces, 5)
	t.same("a camera that has not moved sends nothing", view:poll(), nil)

	-- The camera is 2,000 above the place it looks at, and a move counts when it
	-- is more than a share of that.
	local step = 2000 * View.SHARE
	e.camera.x = 4000 + step - 1
	t.same("a move of less than the share of the camera's distance sends nothing", view:poll(), nil)
	e.camera.x = 4000 + step + 1
	local sent = view:poll()
	t.check("a move of more than that sends the view again", sent ~= nil and sent:find("^coilbox_rewind_view:4126 3000 ") ~= nil, sent)
	t.same("and then nothing until the next", view:poll(), nil)

	e.camera.wide, e.camera.deep = 800, 450
	sent = view:poll()
	t.check("a camera that zooms in on the same place sends the new corners", sent ~= nil and sent:find(" 3726 3225 ", 1, true) ~= nil, sent)
end

-- A corner that looks past the edge of the map is where its ray meets the level
-- of the middle. A corner that looks at the sky is nowhere, and the view is
-- then the middle alone.

do
	local e = Unsynced.new()
	local view = View.new(e.Spring)
	local flat = e.trace
	e.trace = function(sx, sy, level)
		if sx > 1000 and sy > 600 then
			return "sky", { 0, 0, 0, 9000, level, 500 }
		end
		local kind, place = flat(sx, sy)
		place[2] = 40
		return kind, place
	end
	local sent = view:poll()
	t.check("a corner off the map is where its ray meets the level of the middle", sent ~= nil and sent:find(" 9000 500 ", 1, true) ~= nil, sent)

	e.trace = function(sx, sy, level)
		if sy > 600 then
			-- The plane is behind the camera, which the engine gives as a place
			-- that is not on the plane.
			return "sky", { 0, 0, 0, 4000, 2001, 3000 }
		end
		return flat(sx, sy)
	end
	t.same("a view with a corner in the sky is its middle alone", view:poll(), "coilbox_rewind_view:4000 3000")
	t.same("and is not sent twice", view:poll(), nil)

	e.trace = function()
		return "sky", { 0, 0, 0, 0, 0, 0 }
	end
	t.same("a camera that looks at the sky has no view", view:poll(), "coilbox_rewind_view:none")
	t.same("which is said once", view:poll(), nil)
	e.trace = flat
	t.check("and a camera that looks at the ground again has one", (view:poll() or ""):find("^coilbox_rewind_view:4000 3000 3200 ") ~= nil)
end

-- The player takes what the view sends.

do
	local e = Unsynced.new()
	local view = View.new(e.Spring)
	local world, player = setup({ last = 600, units = row(2, 100, 400) }, 2)
	local before = #world.lines
	t.same("the player takes the view's message", player:message(view:poll()), true)
	e.trace = function()
		return "sky", { 0, 0, 0, 0, 0, 0 }
	end
	t.same("and the one for no view", player:message(view:poll()), true)
	t.same("and refuses neither", #world.lines, before)
end

-- The effect.

local function effects(e)
	local seconds = 0
	local arrival = Arrival.new({
		Spring = e.Spring,
		gl = e.gl,
		GL = e.GL,
		UnitDefs = e.UnitDefs,
		seconds = function()
			return seconds
		end,
	})
	return arrival, function(to)
		seconds = to
	end
end

--- A unit definition of the stand-in, with the size the engine gives it.
local function def(e, id, radius, height)
	e.UnitDefs[id] = { radius = radius, height = height }
end

--- The middle of what the last draw put on the screen, which is the middle of
-- the orb.
local function middle(e)
	local sum = e.placeSum
	return sum[1] / e.vertices, sum[2] / e.vertices, sum[3] / e.vertices
end

--- Draws the effect of `arrival` at `seconds` and says what it drew.
local function look(e, arrival, at, seconds)
	e.clear()
	at(seconds)
	arrival:draw()
end

t.same("the whole effect is 0.5 seconds", Arrival.LIFE, 0.5)
t.same("the rise at the end takes the design's 0.1 seconds", Arrival.FADE, 0.1)
t.check("the growing is a small part of the effect, under the design's 0.25 seconds", Arrival.GROW < 0.25 and Arrival.GROW <= Arrival.LIFE / 4, Arrival.GROW)
t.same("the units stage holds for as many orbs as the module draws", t.load("coilbox_player_units.lua", t.unsyncedEnv()).MOST_ORBS, Arrival.MOST)

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	def(e, 3, 20, 30)

	arrival:draw()
	t.same("with no unit arriving a draw does nothing", #e.state + e.vertices, 0)

	-- Seen from the side, so that the orb's height and width are its box.
	e.camera.direction = { 1, 0, 0 }
	arrival:add(7, 3, 1000, 50, 2000, true)
	t.same("a unit that arrives has an orb", arrival.count, 1)

	-- Stage one: a small orb appears at the unit and grows until it covers it.
	look(e, arrival, at, 0)
	local small = e.box.y2 - e.box.y1
	t.check("at the start the orb is small, smaller than the unit", small > 0 and small < 30, small)
	t.same("and its middle is as opaque as it gets", e.maxAlpha, 1)
	look(e, arrival, at, Arrival.GROW / 2)
	local half = e.box.y2 - e.box.y1
	t.check("half way through growing it is larger", half > small, half .. " " .. small)
	look(e, arrival, at, Arrival.GROW)
	local grown = e.box.y2 - e.box.y1
	t.check("when it has grown it is larger again", grown > half, grown .. " " .. half)
	local x, y, z = middle(e)
	t.near("it is round the unit's middle in x", x, 1000, 1e-6)
	t.near("in z", z, 2000, 1e-6)
	t.near("and in height, which is half the unit's height above its base", y, 50 + 15, 1e-6)

	-- The opaque part covers the unit's width and height, and the bottom of the
	-- orb reaches the ground.
	local core = grown * Arrival.CORE
	t.check("the opaque part is wider than the unit's width", core >= 2 * 20, core)
	t.check("and taller than the unit's height", core >= 30, core)
	t.check("the orb reaches the ground the unit stands on", e.box.y1 <= 50, e.box.y1)
	t.check("and goes past the opaque part, which is the glow", grown > core * 1.2, grown .. " " .. core)

	-- Stage two: it holds at full size, opaque, until the last 0.1 seconds.
	for _, seconds in ipairs({ Arrival.GROW, 0.2, Arrival.LIFE - Arrival.FADE - 0.001 }) do
		look(e, arrival, at, seconds)
		local px, py = middle(e)
		t.check("held at " .. seconds .. " s it has full size", math.abs(e.box.y2 - e.box.y1 - grown) < 1e-6, e.box.y2 - e.box.y1)
		t.check("is as opaque as it gets", e.maxAlpha == 1, e.maxAlpha)
		t.near("and stays where it was", py, y, 1e-6)
		t.near("in x too", px, x, 1e-6)
	end

	-- Stage three: it goes up fast, at least its own size, and clears, in 0.1
	-- seconds.
	local start = Arrival.LIFE - Arrival.FADE
	look(e, arrival, at, start + Arrival.FADE / 2)
	local _, mid = middle(e)
	t.check("half way through the rise it has gone up", mid > y, mid .. " " .. y)
	t.check("and is half clear", e.maxAlpha > 0.4 and e.maxAlpha < 0.6, e.maxAlpha)
	look(e, arrival, at, Arrival.LIFE - 0.0001)
	local _, top = middle(e)
	t.check("it travelled at least its own size in the 0.1 seconds", top - y >= grown, top - y .. " against " .. grown)
	t.check("and is clear at the end", e.maxAlpha < 0.01, e.maxAlpha)
	t.check("it keeps its size while it rises", math.abs(e.box.y2 - e.box.y1 - grown) < 1e-6)
	-- Most of the rise is in the first half of the 0.1 seconds, which is fast.
	look(e, arrival, at, start + Arrival.FADE / 2)
	local _, half_up = middle(e)
	t.check("most of the rise is in the first half of the 0.1 seconds", (half_up - y) / (top - y) > 0.6, (half_up - y) / (top - y))

	look(e, arrival, at, Arrival.LIFE + 0.001)
	t.same("after 0.5 seconds it is gone", arrival.count, 0)
	t.same("and nothing is drawn", e.vertices, 0)
end

-- The orb is smooth: nothing at the rim, and no step in how opaque it is.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	def(e, 3, 20, 30)
	e.camera.direction = { 1, 0, 0 }
	arrival:add(7, 3, 0, 0, 0, false)
	-- The rim's vertices are clear, which is the greatest distance from the middle.
	local rimAlpha, rimAt, centreAlpha = nil, 0, nil
	local x0, y0, z0
	do
		look(e, arrival, at, 0.2)
		x0, y0, z0 = middle(e)
	end
	local seen = {}
	local Color = e.gl.Color
	local Vertex = e.gl.Vertex
	local alpha = 0
	e.gl.Color = function(r, g, b, a)
		alpha = a
		return Color(r, g, b, a)
	end
	e.gl.Vertex = function(x, y, z)
		local d = math.sqrt((y - y0) ^ 2 + (z - z0) ^ 2)
		seen[#seen + 1] = { d, alpha }
		if d > rimAt then
			rimAt, rimAlpha = d, alpha
		end
		return Vertex(x, y, z)
	end
	look(e, arrival, at, 0.2)
	t.same("the vertices at the rim are fully clear", rimAlpha, 0)
	table.sort(seen, function(a, b)
		return a[1] < b[1]
	end)
	local step = 0
	for k = 2, #seen do
		step = math.max(step, math.abs(seen[k - 1][2] - seen[k][2]) / math.max(seen[k][1] - seen[k - 1][1], 1e-9) * 0)
	end
	-- Alpha only ever falls with the distance from the middle.
	local rises = 0
	for k = 2, #seen do
		if seen[k][2] > seen[k - 1][2] + 1e-9 then
			rises = rises + 1
		end
	end
	t.same("how opaque it is only ever falls as the distance grows", rises, 0)
	t.same("and a vertex at the middle is as opaque as it gets", seen[1][2], 1)
	centreAlpha = seen[1][2]
	t.check("with the core as wide as it says", centreAlpha == 1 and step == 0)
end

-- The state the draw sets, and leaves as it found it.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	def(e, 3, 20, 30)
	arrival:add(7, 3, 1000, 50, 2000, true)
	look(e, arrival, at, 0.1)
	local state = table.concat(e.state, ", ")
	t.same("no texture, the depth test off so that nothing in front hides it, and nothing written to depth", table.concat(e.state, ", ", 1, 3), "Texture false, DepthTest false, DepthMask false")
	t.check("added to what is there, so that it reads as light", state:find("Blending " .. e.GL.SRC_ALPHA .. " " .. e.GL.ONE, 1, true) ~= nil, state)
	t.same("the depth test back on", e.state[#e.state - 2], "DepthTest true")
	t.same("the depth written again", e.state[#e.state - 1], "DepthMask true")
	t.same("and the colour white", e.state[#e.state], "Color 1 1 1 1")
	local sum = e.colourSum
	t.check("the orb is white", sum[1] == sum[2] and sum[2] == sum[3] and sum[1] > 0, table.concat(sum, " "))
end

-- A unit twice the size has an orb twice the size, and a small and a large unit
-- are both covered.

do
	local widths = {}
	for _, size in ipairs({ { 8, 10 }, { 16, 20 }, { 32, 40 }, { 64, 80 } }) do
		local e = Unsynced.new()
		e.camera.direction = { 1, 0, 0 }
		local arrival, at = effects(e)
		def(e, 3, size[1], size[2])
		arrival:add(7, 3, 0, 0, 0, true)
		look(e, arrival, at, Arrival.GROW)
		widths[#widths + 1] = e.box.y2 - e.box.y1
		t.check("a unit of radius " .. size[1] .. " and height " .. size[2] .. " has its height and width covered by the opaque part", widths[#widths] * Arrival.CORE >= math.max(2 * size[1], size[2]), widths[#widths])
	end
	t.near("a unit twice the size has an orb twice the size", widths[2], widths[1] * 2, 1e-6)
	t.near("and again", widths[4], widths[3] * 2, 1e-6)
	-- A tall thin unit is sized by its height, a wide low one by its radius.
	local e = Unsynced.new()
	e.camera.direction = { 1, 0, 0 }
	local arrival, at = effects(e)
	def(e, 3, 10, 100)
	def(e, 4, 100, 10)
	arrival:add(7, 3, 0, 0, 0, true)
	arrival:add(8, 4, 500, 0, 0, true)
	look(e, arrival, at, Arrival.GROW)
	t.check("a tall unit's orb reaches the ground and covers its height", e.box.y1 <= 0 and e.box.y2 * 1 >= 100, e.box.y1 .. " " .. e.box.y2)
end

-- It faces the camera, whichever way the camera looks.

do
	for _, direction in ipairs({ { 0, -1, 0 }, { 1, 0, 0 }, { 0, 1, 0 }, { 0.6, -0.5, 0.62 }, { 0, -0.7, 0.7 } }) do
		local e = Unsynced.new()
		e.camera.direction = direction
		local len = math.sqrt(direction[1] ^ 2 + direction[2] ^ 2 + direction[3] ^ 2)
		local arrival, at = effects(e)
		def(e, 3, 20, 30)
		arrival:add(7, 3, 0, 0, 0, true)
		at(0.2)
		local ok, err = pcall(arrival.draw, arrival)
		t.check("a camera looking along " .. table.concat(direction, ",") .. " draws", ok and e.vertices > 0, err)
		-- Every vertex is in the plane through the orb's middle that the camera
		-- looks at straight on.
		local x, y, z = middle(e)
		local worst = 0
		local Vertex = e.gl.Vertex
		e.clear()
		e.gl.Vertex = function(vx, vy, vz)
			worst = math.max(worst, math.abs((vx - x) * direction[1] + (vy - y) * direction[2] + (vz - z) * direction[3]) / len)
			return Vertex(vx, vy, vz)
		end
		arrival:draw()
		t.check("and the orb is flat on to the camera", worst < 1e-6, worst)
	end
end

-- An orb is taken away, and one past the most or of a definition the engine does
-- not know has none.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	arrival:add(9, 99, 0, 0, 0, true)
	t.same("a unit of a definition the engine cannot size has no orb", arrival.count, 0)
	def(e, 3, 10, 12)
	arrival:add(9, 3, 0, 0, 0, true)
	arrival:add(10, 3, 100, 0, 0, true)
	t.same("two units have two", arrival.count, 2)
	arrival:cancel(9)
	t.same("one is taken away by its key", arrival.count, 1)
	arrival:cancel(77)
	t.same("a key it has not got takes nothing", arrival.count, 1)
	look(e, arrival, at, 0.2)
	local x = middle(e)
	t.near("and the other is the one left", x, 100, 1e-6)

	-- No more than the most at once: the ones that arrive past it have none.
	for id = 100, 100 + Arrival.MOST + 20 do
		arrival:add(id, 3, id, 0, 0, false)
	end
	t.same("there are never more than the most at once", arrival.count, Arrival.MOST)
	at(Arrival.LIFE + 1)
	arrival:draw()
	t.same("and all are gone when their lives are over", arrival.count, 0)
	arrival:add(100, 3, 0, 0, 0, false)
	t.same("so that a later unit has one again", arrival.count, 1)
end

-- The unsynced half says when the orbs the units stage waits for are full, once.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	def(e, 3, 10, 12)
	t.same("with nothing asked it says nothing", arrival:poll(), false)
	arrival:add(1, 3, 0, 0, 0, true)
	arrival:add(2, 3, 0, 0, 0, true)
	at(Arrival.GROW - 0.001)
	t.same("before they are full it says nothing", arrival:poll(), false)
	at(Arrival.GROW)
	t.same("when they are it says so", arrival:poll(), true)
	t.same("once", arrival:poll(), false)
	arrival:add(3, 3, 0, 0, 0, false)
	at(Arrival.GROW * 3)
	t.same("an orb that nobody waits for says nothing", arrival:poll(), false)
end

-- Every orb's times, read from the timer: the one that takes it out says how
-- old it was.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	def(e, 3, 10, 12)
	local ages = {}
	arrival.trace = function(key, age)
		ages[key] = age
	end
	arrival:add(1, 3, 0, 0, 0, true)
	at(0.2)
	arrival:add(2, 3, 0, 0, 0, true)
	at(0.2 + Arrival.LIFE + 0.004)
	arrival:draw()
	t.check("an orb that is taken out is told its age, which is its whole life and the time since", ages[2] ~= nil and math.abs(ages[2] - (Arrival.LIFE + 0.004)) < 1e-9 and ages[1] > ages[2], tostring(ages[1]) .. " " .. tostring(ages[2]))
end

-- Drawing allocates nothing.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	for id = 1, 20 do
		def(e, id, 10 + id, 20 + id)
		arrival:add(id, id, id * 50, 0, 0, false)
	end
	local function draws()
		for n = 1, 300 do
			at(n / 300 * Arrival.LIFE * 0.9)
			arrival:draw()
		end
	end
	draws()
	e.state = {}
	local kept = e.state
	-- The stand-in's list of state calls grows, and that is the stand-in's.
	local nothing = function() end
	e.gl.Blending, e.gl.DepthTest, e.gl.DepthMask, e.gl.Texture, e.gl.Color = nothing, nothing, nothing, nothing, nothing
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first draws
	-- after it take that back, which is the interpreter's and not the effect's.
	draws()
	local before = collectgarbage("count")
	draws()
	local grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 draws of twenty effects allocate nothing", grew, 0)
	t.same("and the stand-in's list was left alone", #kept, 0)
end

t.report()
