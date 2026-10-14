-- A unit that a jump makes beams in as an orb (issues #4009 and #4051). The
-- units stage says which units want one, the gadget hands that to its unsynced
-- half, and the unsynced half draws it.
--
-- The first part checks which units the player asks an effect for. The second
-- checks the unsynced modules on a stand-in for `Spring` and `gl`: how the view
-- is worked out and when it is sent (issue #4008), and what the effect draws.
-- None of it shows how the effect looks.

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

--- A world and a player of `spec`. The effects the player asks for are in
-- `world.asked`, each as the x of the unit. `hooks` are an adapter's.
local function setup(spec, budget, hooks)
	local world = Engine.new({ unitDefs = UNIT_DEFS, featureDefs = { { name = "rock" } }, weaponDefs = { { name = "shell", type = "Cannon" } } })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local Adapter = t.load("coilbox_player_adapter.lua", env)
	spec.unitDefs = NAMES
	spec.weaponDefs = { "shell" }
	world.asked = {}
	world.askedWith = {}
	local player = assert(Player.new(Fake.new(spec), {
		modOptions = {},
		budget = budget,
		adapter = hooks and Adapter.normalize({ name = "Test", hooks = hooks }) or nil,
		arrive = function(unitID, x, y, z, team)
			world.asked[#world.asked + 1] = x
			world.askedWith[#world.askedWith + 1] = table.concat({ unitID, x, y, z, team }, " ")
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

-- A jump asks for an effect for each unit it makes, in the frame that shows it
-- and in the ones after.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400, 1) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	player:frame()
	t.same("the frame that shows a jump asks for the units it makes", asked(world), "100 200 300")
	player:frame()
	t.same("the next frame asks for the ones it makes", asked(world), "100 200 300 400 500 600")
	player:frame()
	t.same("and so does the one after", asked(world), "100 200 300 400 500 600 700 800")
	t.same("settled", world.params[SETTLED], 1)
	local id
	for unitID, unit in pairs(world.units) do
		if unit.x == 400 then
			id = unitID
		end
	end
	t.same("an ask has the unit, where it is and its team", world.askedWith[4], id .. " 400 5 7 1")
	frames(player, 3)
	t.same("a settled world asks for nothing more", #world.asked, 8)
end

-- A jump that is shown in one frame asks for them too, however fast it is.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("every unit is made", world.unitCount(), 8)
	t.same("a jump that settles in the frame that shows it asks for every unit", sorted(world), "100 200 300 400 500 600 700 800")
	local before = #world.asked
	seek(player, 160)
	frames(player, 3)
	t.same("a jump that makes none asks for none", #world.asked, before)
	seek(player, 450)
	frames(player, 3)
	seek(player, 150)
	frames(player, 3)
	t.same("and a jump back that makes them again asks again", #world.asked - before, 8)
end

-- The first frame of a playback is not a jump the viewer made.

do
	local world, player = setup({ last = 600, units = row(5, 0, 400) }, 2)
	frames(player, 6)
	t.same("every unit is made", world.unitCount(), 5)
	t.same("the units the playback starts with get no effect", asked(world), "")
end

-- Jump keys and a wrap from the end are jumps.

do
	local world, player = setup({ last = 600, units = row(4, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	player:message("coilbox_rewind:step 200")
	frames(player, 2)
	t.same("a step is a jump", asked(world), "100 200 300 400")
	world.asked = {}
	player:message("coilbox_rewind:seek 600")
	frames(player, 2)
	t.same("a jump to a time with none removes them and asks for none", asked(world), "")
end

do
	local world, player = setup({ last = 600, units = row(4, 0, 100) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 600)
	frames(player, 2)
	t.same("no unit stands at the end", world.unitCount(), 0)
	player:message("coilbox_rewind:play")
	frames(player, 3)
	t.same("a play from the end starts again from the first frame, which is a jump", sorted(world), "100 200 300 400")
end

-- Units removed by a seek get none, and neither does plain play.

do
	local units = row(6, 0, 100)
	units[#units + 1] = { first = 300, last = 600, at = { 5000, 0, 0 } }
	local world, player = setup({ last = 600, units = units }, 2)
	player:message("coilbox_rewind:pause")
	seek(player, 50)
	frames(player, 3)
	t.same("the six are made", world.unitCount(), 6)
	world.asked = {}
	seek(player, 200)
	frames(player, 4)
	t.same("a seek that removes them all", world.unitCount(), 0)
	t.same("asks for no effect", asked(world), "")

	seek(player, 298)
	player:frame()
	player:message("coilbox_rewind:play")
	frames(player, 5)
	t.same("a unit built during play is made", world.unitCount(), 1)
	t.same("with no effect", asked(world), "")
end

-- Play in either direction at any speed asks for none.

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
			frames(player, 4)
			world.asked = {}
			placed = 0
			player:message("coilbox_rewind:direction " .. way)
			player:message("coilbox_rewind:speed " .. speed)
			player:message("coilbox_rewind:play")
			frames(player, 60)
			t.check("play at " .. speed .. "x " .. (way == 1 and "forward" or "backward") .. " made units", placed > 0, placed)
			t.same("and asked for no effect", asked(world), "")
		end
	end
end

-- Dragging the timeline's knob asks for none until the drag ends, and then for
-- the units the drag made.

do
	local world, player = setup({ last = 600, units = row(12, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the drag message is the player's", player:message("coilbox_rewind:drag 1"), true)
	seek(player, 150)
	frames(player, 2)
	seek(player, 160)
	frames(player, 2)
	t.same("units are made during a drag", world.unitCount(), 8)
	t.same("and none is asked an effect for", asked(world), "")
	player:message("coilbox_rewind:drag 0")
	frames(player, 3)
	t.same("when the drag ends the units it made and the ones still to come are", sorted(world), "100 200 300 400 500 600 700 800 900 1000 1100 1200")
	t.same("settled", world.params[SETTLED], 1)
	local count = #world.asked
	frames(player, 3)
	t.same("and once each", #world.asked, count)

	local before = #world.lines
	t.same("a drag that is neither 1 nor 0 is the player's", player:message("coilbox_rewind:drag 2"), true)
	t.same("and is refused and logged", #world.lines - before, 1)
end

-- A drag that ends where the units it made are gone asks for none of them, and
-- a drag that makes none asks for none.

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

-- A jump after a drag is a jump again, and a drag that never ends is cleared by
-- the next one that does not drag.

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
	seek(player, 150)
	frames(player, 2)
	t.same("a click after it asks for them again", sorted(world), "100 200 300 400")
end

-- An adapter that shows its own effect is asked again for a unit a drag made,
-- when the drag ends.

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

-- A unit outside the view needs no effect.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400) }, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	-- A view round the units at 100 to 400.
	player:message("coilbox_rewind_view:250 7 50 -100 450 -100 450 100 50 100")
	seek(player, 150)
	frames(player, 4)
	t.same("every unit is made", world.unitCount(), 8)
	t.same("the units in view are asked for, and the ones outside are not", sorted(world), "100 200 300 400")
end

-- An adapter that shows its own effect stops the player's.

do
	local calls = {}
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 2, {
		unitPlaced = function(unitID, unitDefID, frame, clock, effect)
			calls[#calls + 1] = tostring(effect)
			-- It shows its own for some and leaves the others to the player.
			return effect and unitID ~= nil and unitDefID ~= nil and frame == 150 and clock ~= nil and #calls % 2 == 0
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("the hook is told for each unit whether the player would show an effect", table.concat(calls, " "), "true true true true true true")
	t.same("and the player shows none for a unit the hook said it handled", asked(world), "100 300 500")
end

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 2, {
		unitPlaced = function() end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("a hook that gives nothing back leaves the player's effect", asked(world), "100 200 300 400 500 600")
end

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 2, {
		unitPlaced = function(_, _, _, _, effect)
			if effect then
				error("broken")
			end
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("a hook that raises leaves the player's effect too", asked(world), "100 200 300 400 500 600")
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
	t.check("with nowhere to ask for an effect the player raises nothing", ok, err)
	t.same("and makes every unit", world.unitCount(), 6)
end

-- A jump with effects allocates nothing more in a frame of play.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, 7)
	frames(player, 1)
	seek(player, 1500)
	frames(player, 8)
	t.same("the forty are made", world.unitCount(), 40)
	t.check("some with an effect", #world.asked > 0, #world.asked)
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
		seconds = function()
			return seconds
		end,
	})
	return arrival, function(to)
		seconds = to
	end
end

--- A unit of the stand-in: its base at `x, y, z`, its middle `lift` above it.
local function unit(e, id, radius, x, y, z, lift)
	e.units[id] = { x = x, y = y, z = z, mx = x, my = y + lift, mz = z, radius = radius, team = 0 }
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

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	unit(e, 7, 20, 1000, 50, 2000, 12)

	arrival:draw()
	t.same("with no unit arriving a draw does nothing", #e.state + e.vertices, 0)

	arrival:add(7, 1000, 50, 2000, 1)
	t.same("a unit that arrives has an effect", arrival.count, 1)
	t.same("the design's three stages are 0.25 seconds of growing and 0.1 of rising", Arrival.GROW .. " " .. Arrival.FADE, "0.25 0.1")
	t.same("so that the effect lasts 0.35 seconds", Arrival.LIFE, 0.35)

	-- Stage one: a small orb at the unit that grows until it covers it. With the
	-- camera straight down the orb is a flat disc, and its width is its box.
	look(e, arrival, at, 0)
	local small = e.box.x2 - e.box.x1
	t.check("at the start the orb is small, smaller than the unit", small > 0 and small < 2 * 20, small)
	t.same("and fully opaque at its middle", e.maxAlpha, 1)
	look(e, arrival, at, Arrival.GROW / 2)
	local half = e.box.x2 - e.box.x1
	t.check("half way through growing it is larger", half > small, half .. " " .. small)
	look(e, arrival, at, Arrival.GROW)
	local grown = e.box.x2 - e.box.x1
	t.check("when grown it is larger again", grown > half, grown .. " " .. half)
	t.check("and wider than the unit's width, so that it covers the unit", grown >= 2 * 20, grown)
	t.same("still fully opaque", e.maxAlpha, 1)
	local x, y, z = middle(e)
	t.near("it is over the unit in x", x, 1000, 1e-6)
	t.near("and in z", z, 2000, 1e-6)
	t.check("in front of the unit as the camera sees it, which is above it for a camera looking down", y > 50 + 12, y)
	t.check("with the part that is opaque as wide as the unit", Arrival.CORE * Arrival.COVER >= 1, Arrival.CORE * Arrival.COVER)

	-- Stage two: it goes up fast and becomes clear, over 0.1 seconds.
	local start = y
	look(e, arrival, at, Arrival.GROW + Arrival.FADE / 2)
	local _, mid = middle(e)
	local midAlpha = e.maxAlpha
	t.check("half way through the rise it has gone up", mid > start, mid .. " " .. start)
	t.check("and is half clear", midAlpha > 0.4 and midAlpha < 0.6, midAlpha)
	look(e, arrival, at, Arrival.LIFE - 0.001)
	local _, top = middle(e)
	local size = e.box.x2 - e.box.x1
	t.check("it travelled at least its own size in the 0.1 seconds", top - start >= size, top - start .. " against " .. size)
	t.check("and is nearly clear at the end", e.maxAlpha < 0.05, e.maxAlpha)
	t.check("it keeps its size while it rises", math.abs(size - grown) < 1e-6, size .. " " .. grown)

	look(e, arrival, at, Arrival.LIFE + 0.001)
	t.same("after 0.35 seconds it is gone", arrival.count, 0)
	t.same("and nothing is drawn", e.vertices, 0)
end

-- The state the draw sets, and leaves as it found it.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	unit(e, 7, 20, 1000, 50, 2000, 12)
	arrival:add(7, 1000, 50, 2000, 1)
	look(e, arrival, at, 0.1)
	local state = table.concat(e.state, ", ")
	t.same("no texture, the depth test on and nothing written to depth", table.concat(e.state, ", ", 1, 3), "Texture false, DepthTest true, DepthMask false")
	t.check("blended over what is there, so that it hides the unit", state:find("Blending " .. e.GL.SRC_ALPHA .. " " .. e.GL.ONE_MINUS_SRC_ALPHA, 1, true) ~= nil, state)
	t.same("the depth written again", e.state[#e.state - 1], "DepthMask true")
	t.same("and the colour white", e.state[#e.state], "Color 1 1 1 1")
	local sum = e.colourSum
	t.check("the orb is white", sum[1] == sum[2] and sum[2] == sum[3] and sum[1] > 0, table.concat(sum, " "))
end

-- A unit twice the size has an orb twice the size, and a small and a large unit
-- are both covered.

do
	local widths = {}
	for _, radius in ipairs({ 8, 16, 32, 64 }) do
		local e = Unsynced.new()
		local arrival, at = effects(e)
		unit(e, 7, radius, 0, 0, 0, radius)
		arrival:add(7, 0, 0, 0, 1)
		look(e, arrival, at, Arrival.GROW)
		widths[#widths + 1] = e.box.x2 - e.box.x1
		t.check("a unit of radius " .. radius .. " is covered", widths[#widths] >= 2 * radius, widths[#widths])
	end
	t.near("a unit twice the size has an orb twice the size", widths[2], widths[1] * 2, 1e-6)
	t.near("and again", widths[4], widths[3] * 2, 1e-6)
end

-- The orb is nearer the camera than the unit, whichever way the camera looks,
-- so that the depth test does not hide it behind the unit it covers.

do
	for _, direction in ipairs({ { 0, -1, 0 }, { 1, 0, 0 }, { 0.6, -0.5, 0.62 }, { 0, -0.7, 0.7 } }) do
		local e = Unsynced.new()
		e.camera.direction = direction
		local len = math.sqrt(direction[1] ^ 2 + direction[2] ^ 2 + direction[3] ^ 2)
		local arrival, at = effects(e)
		unit(e, 7, 20, 0, 0, 0, 12)
		arrival:add(7, 0, 0, 0, 1)
		look(e, arrival, at, 0.1)
		local x, y, z = middle(e)
		-- How far along the camera's direction the orb's middle is, against the
		-- unit's middle.
		local along = ((x - 0) * direction[1] + (y - 12) * direction[2] + z * direction[3]) / len
		t.check("a camera looking along " .. table.concat(direction, ",") .. " draws", e.vertices > 0)
		t.check("with the orb on the camera's side of the unit", along < 0, along)
	end
end

-- The orb does not reach below the ground the unit stands on, for a camera
-- that looks along the ground.

do
	local e = Unsynced.new()
	e.camera.direction = { 1, 0, 0 }
	local arrival, at = effects(e)
	unit(e, 7, 20, 0, 100, 0, 2)
	arrival:add(7, 0, 100, 0, 1)
	look(e, arrival, at, Arrival.GROW)
	t.check("the lowest of it is no lower than the unit's base", e.box.y1 >= 100 - 1e-6, e.box.y1)
	t.check("and it is still as tall as the unit is wide", e.box.y2 - e.box.y1 >= 2 * 20, e.box.y2 - e.box.y1)
end

-- A unit the engine cannot size, or place, has no effect.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	arrival:add(9, 0, 0, 0, 0)
	t.same("a unit the engine cannot size or place has no effect", arrival.count, 0)
	e.radius[9] = 10
	arrival:add(9, 0, 0, 0, 0)
	t.same("nor one it can size and not place", arrival.count, 0)
	unit(e, 9, 10, 0, 0, 0, 5)
	arrival:add(9, 0, 0, 0, 5)
	t.same("a unit of a team with no colour has one, since the orb is white", arrival.count, 1)
	local ok, err = pcall(function()
		look(e, arrival, at, 0.1)
	end)
	t.check("and is drawn", ok and e.vertices > 0, err)

	-- No more than the most at once: the ones that arrive past it have none.
	for id = 100, 100 + Arrival.MOST + 20 do
		unit(e, id, 10, id, 0, 0, 5)
		arrival:add(id, id, 0, 0, 0)
	end
	t.same("there are never more than the most at once", arrival.count, Arrival.MOST)
	at(Arrival.LIFE + 1)
	arrival:draw()
	t.same("and all are gone when their lives are over", arrival.count, 0)
	arrival:add(100, 0, 0, 0, 0)
	t.same("so that a later unit has one again", arrival.count, 1)
end

-- A camera looking straight down, or along the ground, draws finite quads.

do
	for _, direction in ipairs({ { 0, -1, 0 }, { 1, 0, 0 }, { 0, 1, 0 }, { 0.6, -0.5, 0.62 } }) do
		local e = Unsynced.new()
		e.camera.direction = direction
		local arrival, at = effects(e)
		unit(e, 7, 20, 0, 0, 0, 12)
		arrival:add(7, 0, 0, 0, 0)
		at(0.2)
		local ok, err = pcall(arrival.draw, arrival)
		t.check("a camera looking along " .. table.concat(direction, ",") .. " draws", ok and e.vertices > 0, err)
	end
end

-- Drawing allocates nothing.

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	for id = 1, 20 do
		unit(e, id, 10 + id, id * 50, 0, 0, 5)
		arrival:add(id, id * 50, 0, 0, 0)
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
