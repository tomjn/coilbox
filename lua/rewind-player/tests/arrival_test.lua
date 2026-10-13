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

t.report()
