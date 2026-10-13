-- A unit that appears while a slow seek settles gets a short effect (issue
-- #4009). The units stage says which units want one, the gadget hands that to
-- its unsynced half, and the unsynced half draws it.
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

-- A slow seek asks for an effect for each unit it makes after the frame that
-- showed it.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400, 1) }, 3)
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	player:frame()
	t.same("the frame that shows a seek asks for no effect, since a seek that fits in it is not slow", asked(world), "")
	player:frame()
	t.same("the next frame asks for one for each unit it makes", asked(world), "400 500 600")
	player:frame()
	t.same("and so does the one after", asked(world), "400 500 600 700 800")
	t.same("settled", world.params[SETTLED], 1)
	local id
	for unitID, unit in pairs(world.units) do
		if unit.x == 400 then
			id = unitID
		end
	end
	t.same("an ask has the unit, where it is and its team", world.askedWith[1], id .. " 400 5 7 1")
	frames(player, 3)
	t.same("a settled world asks for nothing more", #world.asked, 5)
end

-- A seek that is shown in one frame asks for none.

do
	local world, player = setup({ last = 600, units = row(8, 100, 400) })
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("every unit is made", world.unitCount(), 8)
	t.same("a seek that settles in the frame that shows it asks for no effect", asked(world), "")
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

-- Dragging the timeline's knob asks for none until the drag ends.

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
	frames(player, 2)
	t.same("the units still to come when the drag ends are", asked(world), "900 1000 1100 1200")
	t.same("settled", world.params[SETTLED], 1)

	local before = #world.lines
	t.same("a drag that is neither 1 nor 0 is the player's", player:message("coilbox_rewind:drag 2"), true)
	t.same("and is refused and logged", #world.lines - before, 1)
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
	t.same("the units in view made after the first frame are asked for, and the ones outside are not", asked(world), "100 400")
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
	t.same("the hook is told for each unit whether the player would show an effect", table.concat(calls, " "), "false false true true true true")
	t.same("and the player shows none for a unit the hook said it handled", asked(world), "300 500")
end

do
	local world, player = setup({ last = 600, units = row(6, 100, 400) }, 2, {
		unitPlaced = function() end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	seek(player, 150)
	frames(player, 3)
	t.same("a hook that gives nothing back leaves the player's effect", asked(world), "300 400 500 600")
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
	t.same("a hook that raises leaves the player's effect too", asked(world), "300 400 500 600")
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

-- A slow seek with effects allocates nothing more in a frame of play.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, 7)
	frames(player, 8)
	t.same("the forty are made", world.unitCount(), 40)
	t.check("some with an effect", #world.asked > 0, #world.asked)
	collectgarbage()
	collectgarbage("stop")
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

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	e.radius[7] = 20
	e.colours[1] = { 1, 0, 0 }

	arrival:draw()
	t.same("with no unit arriving a draw does nothing", #e.state + e.vertices, 0)

	arrival:add(7, 1000, 50, 2000, 1)
	t.same("a unit that arrives has an effect", arrival.count, 1)
	at(Arrival.LIFE / 2)
	arrival:draw()
	t.check("half way through its life it is drawn", e.vertices > 0, e.vertices)
	local box = e.box
	local reach = 20 * Arrival.REACH + Arrival.LINE
	t.check(
		"round the unit, no farther out than the module says an effect reaches",
		box.x1 >= 1000 - reach and box.x2 <= 1000 + reach and box.z1 >= 2000 - reach and box.z2 <= 2000 + reach and box.y1 >= 50 - reach and box.y2 <= 50 + reach,
		table.concat({ box.x1, box.x2, box.y1, box.y2, box.z1, box.z2 }, " ")
	)
	t.check("and not all at one point", box.x2 - box.x1 > 20 and box.y2 - box.y1 > 20)
	local sum = e.colourSum
	t.check("mostly in the team's colour", sum[1] > sum[2] and sum[1] > sum[3], table.concat(sum, " "))
	t.same("with no texture bound, and the depth test on and nothing written to depth", table.concat(e.state, ", ", 1, 3), "Texture false, DepthTest true, DepthMask false")
	t.same("it leaves the engine's blending as it found it", e.state[#e.state - 2], "Blending " .. e.GL.SRC_ALPHA .. " " .. e.GL.ONE_MINUS_SRC_ALPHA)
	t.same("and the depth written again", e.state[#e.state - 1], "DepthMask true")
	t.same("and the colour white", e.state[#e.state], "Color 1 1 1 1")
	local wide = box.x2 - box.x1

	-- A unit twice the size has an effect twice the size.
	local e2 = Unsynced.new()
	local arrival2, at2 = effects(e2)
	e2.radius[7] = 40
	e2.colours[1] = { 1, 0, 0 }
	arrival2:add(7, 1000, 50, 2000, 1)
	at2(Arrival.LIFE / 2)
	arrival2:draw()
	t.near("a unit twice the size has an effect twice as wide, but for the ring's own line", e2.box.x2 - e2.box.x1 - 2 * Arrival.LINE, (wide - 2 * Arrival.LINE) * 2, 1e-6)

	e.clear()
	at(Arrival.LIFE + 0.01)
	arrival:draw()
	t.same("after its life it is gone", arrival.count, 0)
	t.same("and nothing is drawn for it", e.vertices, 0)
end

do
	local e = Unsynced.new()
	local arrival, at = effects(e)
	e.colours[0] = { 0, 0, 1 }
	arrival:add(9, 0, 0, 0, 0)
	t.same("a unit the engine cannot size has no effect", arrival.count, 0)
	e.radius[9] = 10
	arrival:add(9, 0, 0, 0, 5)
	t.same("a unit of a team with no colour has one", arrival.count, 1)
	local ok, err = pcall(function()
		at(0.1)
		arrival:draw()
	end)
	t.check("and is drawn", ok and e.vertices > 0, err)

	-- No more than the most at once: the ones that arrive past it have none.
	for id = 100, 100 + Arrival.MOST + 20 do
		e.radius[id] = 10
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
	for _, direction in ipairs({ { 0, -1, 0 }, { 1, 0, 0 }, { 0.6, -0.5, 0.62 } }) do
		local e = Unsynced.new()
		e.camera.direction = direction
		local arrival, at = effects(e)
		e.radius[7] = 20
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
		e.radius[id] = 10 + id
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
	local before = collectgarbage("count")
	draws()
	local grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 draws of twenty effects allocate nothing", grew, 0)
	t.same("and the stand-in's list was left alone", #kept, 0)
end

t.report()
