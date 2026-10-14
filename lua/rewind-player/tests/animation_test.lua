-- The animation stage (issue #3797): a unit's script is told when its unit
-- starts and stops moving and when a builder starts and stops work, a unit has
-- the velocity it is shown moving at, and a builder's recorded work is in unit
-- rules parameters. All of it on the engine stand-in in engine.lua, with tracks
-- made from a table (fake_track.lua). The end of the file runs the fixture
-- through the real reader.
--
-- None of this shows a walk in an engine. The ignored Rust test
-- units_are_animated_from_the_track_in_the_engine does that.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local TURN = 2 * math.pi

--- What a walking script does when it is told its unit moves: it starts
-- turning both legs.
local function walk(world, unit)
	world.animate(unit, "rleg", 1)
	world.animate(unit, "lleg", 1)
end

local function nothing() end

--- A Lua script's QueryNanoPiece that gives its two nozzles in turn, counted
-- from 1 as a Lua script counts its pieces: the model's third and fourth.
local function nozzles(_, unit)
	unit.nozzle = unit.nozzle == 3 and 4 or 3
	return unit.nozzle
end

--- A COB script's QueryNanoPiece that always gives its arm, counted from 0 as
-- a COB script counts its pieces: the model's second.
local function arm()
	return 1
end

local LEGS = { "pelvis", "torso", "rleg", "lleg" }
local UNIT_DEFS = {
	{ name = "walker", script = "lua", pieces = LEGS, callins = { StartMoving = walk, StopMoving = nothing } },
	{ name = "bot", script = "cob", pieces = LEGS, callins = { StartMoving = walk, StopMoving = nothing } },
	{ name = "crate", pieces = { "base" } },
	{
		name = "engineer",
		script = "lua",
		isBuilder = true,
		pieces = { "base", "arm", "nozzle1", "nozzle2" },
		midHeight = 10,
		callins = { StartMoving = nothing, StopMoving = nothing, StartBuilding = nothing, StopBuilding = nothing, QueryNanoPiece = nozzles },
	},
	{
		name = "cobengineer",
		script = "cob",
		isBuilder = true,
		pieces = { "base", "arm" },
		midHeight = 10,
		callins = { StartBuilding = nothing, StopBuilding = nothing, QueryNanoPiece = arm },
	},
	{ name = "plant", script = "cob", isImmobile = true, isFactory = true, buildTime = 500, callins = { StartBuilding = nothing, StopBuilding = nothing } },
	{ name = "hut", isImmobile = true, buildTime = 500 },
}
local NAMES = { "walker", "bot", "crate", "engineer", "cobengineer", "plant", "hut" }
local WALKER, BOT, CRATE, ENGINEER, COBENGINEER, PLANT, HUT = 0, 1, 2, 3, 4, 5, 6

--- A world and a player of `spec`. The player is made the way the gadget makes
-- it: the call that hands a Lua script's call-ins to the engine is wrapped
-- first, and the player is given what the wrap collects.
local function setup(spec, options)
	options = options or {}
	spec.unitDefs = spec.unitDefs or NAMES
	spec.featureDefs = spec.featureDefs or { "wreck" }
	local world = Engine.new({ unitDefs = options.unitDefs or UNIT_DEFS, featureDefs = { { name = "wreck" } } })
	world.frameworkCopied = options.copied or false
	local env = Engine.env(t, world)
	local callIns = {}
	local create = world.Spring.UnitScript.CreateScript
	world.Spring.UnitScript.CreateScript = function(unitID, given)
		callIns[unitID] = given
		return create(unitID, given)
	end
	local Player = t.load("coilbox_player.lua", env)
	local track = spec.header and spec or Fake.new(spec)
	local player = assert(Player.new(track, {
		modOptions = {},
		engine = options.engine,
		budget = options.budget,
		scriptCallIns = callIns,
		work = options.work,
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
	}))
	world.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			callIns[unitID] = nil
			player:unitDestroyed(unitID)
		end,
		FeatureCreated = function(_, featureID)
			player:featureCreated(featureID)
		end,
		FeatureDestroyed = function(_, featureID)
			player:featureDestroyed(featureID)
		end,
	}
	local function frame()
		player:frame()
	end
	local function post()
		player:framePost()
	end
	local function run(count)
		for _ = 1, count or 1 do
			world.step(frame, post)
		end
	end
	return world, player, run, track
end

local function said(world, needle)
	local n = 0
	for _, line in ipairs(world.lines) do
		if line:find(needle, 1, true) then
			n = n + 1
		end
	end
	return n
end

--- The names of the script functions a unit was told, in order, with the frame
-- of the track each was told on in `frames`.
local function calls(world, unit)
	local names = {}
	for _, one in ipairs(world.callsTo(unit)) do
		-- Asking for a nano piece is not telling the script anything.
		if one.name ~= "QueryNanoPiece" then
			names[#names + 1] = one.name
		end
	end
	return table.concat(names, " ")
end

--- A unit that stands at the start, walks along z at 2 elmos a frame from
-- frame 100 to frame 200, and stands again.
local function stroll(def)
	return {
		first = 0,
		last = 600,
		def = def,
		at = function(frame)
			return 50, 0, 2 * (math.min(math.max(frame, 100), 200) - 100)
		end,
	}
end

--- The unit rules parameters of a builder's work, as a text.
local function work(unit)
	local p = unit.params
	return string.format(
		"%s %s %s at %s %s %s",
		tostring(p.coilbox_rewind_work_command),
		tostring(p.coilbox_rewind_work_target),
		tostring(p.coilbox_rewind_work_power),
		tostring(p.coilbox_rewind_work_x),
		tostring(p.coilbox_rewind_work_y),
		tostring(p.coilbox_rewind_work_z)
	)
end

-- A unit that starts and stops moving, with a Lua script and with a COB one.

for _, case in ipairs({ { "walker", WALKER, "lua" }, { "bot", BOT, "cob" } }) do
	local name, def, how = case[1], case[2], case[3]
	local label = "a unit with a " .. how .. " script"
	local world, player, run = setup({ last = 600, units = { stroll(def) } })
	player:message("coilbox_rewind:seek 90")
	run(10)
	local unit = world.unitNamed(name)
	t.same(label .. " that stands is told nothing", calls(world, unit), "")
	t.same("and has no velocity", unit.vz, 0)
	run(1)
	t.same(label .. " is told once when it starts moving", calls(world, unit), "StartMoving")
	local start = world.callsTo(unit)[1]
	t.same("through the call for its kind of script", start.how, how)
	t.same("with a 0 for not reversing", start.a, 0)
	t.same("on the frame the track has it start", player.clock.frame, 100)
	t.same("it has the velocity the track has it moving at", unit.vz, 2)
	t.same("and none sideways", unit.vx, 0)
	t.same("the engine did not move it by that velocity", unit.z, 0)
	t.same("it is told not to move by itself", unit.extrapolate, false)
	run(99)
	t.same(label .. " is not told again while it keeps moving", calls(world, unit), "StartMoving")
	t.same("it stands where the track has it", unit.z, 198)
	local sets = world.velocitySets
	run(1)
	t.same(label .. " is told once when it stops", calls(world, unit), "StartMoving StopMoving")
	t.same("on the frame the track has it stop", player.clock.frame, 200)
	t.same("and its velocity is nothing again", unit.vz, 0)
	t.same("which took one call", world.velocitySets, sets + 1)
	run(50)
	t.same(label .. " is told nothing more while it stands", calls(world, unit), "StartMoving StopMoving")
	t.same("and its velocity is not set again", world.velocitySets, sets + 1)
	t.same("nothing was logged about a script", said(world, "script"), 0)
end

-- A unit with no script the player can reach.

do
	local world, player, run = setup({ last = 600, units = { stroll(CRATE) } })
	player:message("coilbox_rewind:seek 90")
	local ok, err = pcall(run, 150)
	t.check("a unit with no script raises nothing", ok, err)
	local unit = world.unitNamed("crate")
	t.same("and is told nothing", calls(world, unit), "")
	player:message("coilbox_rewind:seek 150")
	run(2)
	t.same("it still has the velocity the track has", unit.vz, 2)
end

-- Paused, a walk stops, because the time does.

do
	local world, player, run = setup({ last = 600, units = { stroll(WALKER) } })
	player:message("coilbox_rewind:seek 140")
	run(5)
	local unit = world.unitNamed("walker")
	t.same("a seek into a walk while playing tells the unit it moves", calls(world, unit), "StartMoving")
	player:message("coilbox_rewind:pause")
	run(1)
	t.same("pausing tells a moving unit it stopped", calls(world, unit), "StartMoving StopMoving")
	t.same("and takes its velocity away", unit.vz, 0)
	run(30)
	t.same("nothing more is told while paused", calls(world, unit), "StartMoving StopMoving")
	player:message("coilbox_rewind:seek 160")
	run(3)
	t.same("a seek while paused tells it nothing", calls(world, unit), "StartMoving StopMoving")
	t.same("and gives it no velocity", unit.vz, 0)
	player:message("coilbox_rewind:play")
	run(1)
	t.same("playing again tells it once that it moves", calls(world, unit), "StartMoving StopMoving StartMoving")
	t.same("with its velocity back", unit.vz, 2)
end

-- Played backward, a unit moves against the way it faces, which is what the
-- engine calls reversing.

do
	local world, player, run = setup({ last = 600, units = { stroll(WALKER) } })
	player:message("coilbox_rewind:seek 140")
	run(5)
	local unit = world.unitNamed("walker")
	player:message("coilbox_rewind:reverse")
	run(1)
	t.same("turning play round tells a moving unit again", calls(world, unit), "StartMoving StartMoving")
	t.same("that it is now reversing", world.callsTo(unit)[2].a, 1)
	t.same("its velocity is the way it is shown moving", unit.vz, -2)
	run(20)
	t.same("and nothing more while it keeps going", calls(world, unit), "StartMoving StartMoving")
	run(40)
	t.same("played back to before it set off, it is told it stopped", calls(world, unit), "StartMoving StartMoving StopMoving")
	t.same("the frame after the one the track has it start on", player.clock.frame < 100, true)
	t.same("with no velocity", unit.vz, 0)

	-- A unit the match had driving backward is reversing when played forward.
	local back = stroll(BOT)
	back.rotation = { 0, 1, 0, 0 }
	world, player, run = setup({ last = 600, units = { back } })
	player:message("coilbox_rewind:seek 140")
	run(2)
	unit = world.unitNamed("bot")
	t.same("a unit that moves against its facing in the match is told it reverses", world.callsTo(unit)[1].a, 1)
	player:message("coilbox_rewind:reverse")
	run(1)
	t.same("and played backward it is told it goes forward", world.callsTo(unit)[2].a, 0)
end

-- A seek.

do
	local world, player, run = setup({ last = 600, units = { stroll(WALKER) } })
	player:message("coilbox_rewind:seek 110")
	run(3)
	local unit = world.unitNamed("walker")
	player:message("coilbox_rewind:seek 170")
	run(3)
	t.same("a seek from one moment of a walk to another tells nothing more", calls(world, unit), "StartMoving")
	t.same("the same unit is still there", world.unitNamed("walker").id, unit.id)
	player:message("coilbox_rewind:seek 300")
	run(2)
	t.same("a seek to where it stands tells it that it stopped", calls(world, unit), "StartMoving StopMoving")
	player:message("coilbox_rewind:seek 150")
	run(2)
	t.same("and a seek back into the walk that it moves", calls(world, unit), "StartMoving StopMoving StartMoving")
end

-- A unit made again is another unit, which has been told nothing.

do
	local late = stroll(WALKER)
	late.first = 120
	local world, player, run = setup({ last = 600, units = { late } })
	player:message("coilbox_rewind:seek 150")
	run(3)
	local first = world.unitNamed("walker")
	t.same("a unit made in the middle of its walk is told it moves", calls(world, first), "StartMoving")
	player:message("coilbox_rewind:seek 50")
	run(3)
	t.same("a seek to before it existed removes it", world.unitNamed("walker"), nil)
	player:message("coilbox_rewind:seek 160")
	run(3)
	local second = world.unitNamed("walker")
	t.check("a seek back makes another unit", second ~= nil and second.id ~= first.id)
	t.same("which is told it moves", calls(world, second), "StartMoving")
	t.same("and told not to move by itself", second.extrapolate, false)
end

-- The speed of play scales the velocity and nothing else.

do
	local world, player, run = setup({ last = 600, units = { stroll(WALKER) } })
	player:message("coilbox_rewind:seek 104")
	player:message("coilbox_rewind:speed 8")
	run(2)
	local unit = world.unitNamed("walker")
	t.same("at 8x a unit has 8 times the track's velocity", unit.vz, 16)
	t.same("and is told once that it moves", calls(world, unit), "StartMoving")
	player:message("coilbox_rewind:speed 0.5")
	run(2)
	t.same("at half speed it has half", unit.vz, 1)
	t.same("and is not told again", calls(world, unit), "StartMoving")
end

-- A unit under construction is told nothing, though the track moves it.

do
	local moved = stroll(WALKER)
	moved.status = function(frame)
		return 1, frame < 150 and 0.5 or 1, 0
	end
	local world, player, run = setup({ last = 600, units = { moved } })
	player:message("coilbox_rewind:seek 120")
	run(10)
	local unit = world.unitNamed("walker")
	t.same("a unit under construction is not told it moves", calls(world, unit), "")
	t.same("and has no velocity", unit.vz, 0)
	run(25)
	t.same("once it is finished it is", calls(world, unit), "StartMoving")
end

-- A builder. It stands at the origin facing along z, with its middle 10 elmos
-- up. From frame 50 it builds a hut 100 elmos along x and 100 above its middle,
-- which is finished at frame 120, and from frame 151 it does nothing.

local function building(def, extra)
	local spec = {
		last = 600,
		features = { { def = 0, at = { 30, 0, 40 } } },
		units = {
			{
				first = 0,
				last = 600,
				def = def,
				work = function(frame)
					if frame >= 50 and frame <= 150 then
						return 16, 2, frame < 100 and 255 or 51
					end
					return 0, 0, 0
				end,
			},
			{
				first = 50,
				last = 600,
				def = HUT,
				at = { 100, 110, 0 },
				status = function(frame)
					return 1, frame < 120 and 0.5 or 1, 0
				end,
			},
		},
	}
	for key, value in pairs(extra or {}) do
		spec.units[1][key] = value
	end
	return spec
end

do
	local world, player, run = setup(building(ENGINEER))
	player:message("coilbox_rewind:seek 40")
	run(10)
	local builder = world.unitNamed("engineer")
	t.same("a builder with no work is told nothing", calls(world, builder), "")
	t.same("and its parameters say it has none", work(builder), "0 -1 0 at nil nil nil")
	run(1)
	local hut = world.unitNamed("hut")
	t.same("a builder is told once when it starts work", calls(world, builder), "StartBuilding")
	t.same("on the frame the track has it start", player.clock.frame, 50)
	local start = world.callsTo(builder, "StartBuilding")[1]
	t.near("with the heading from its facing to what it builds", start.a, TURN / 4, 1e-9)
	t.near("and the pitch up to it from its own middle", start.b, TURN / 8, 1e-9)
	local hutDef = world.globals.UnitDefNames.hut.id
	t.same(
		"its parameters hold the work: building a hut, which unit, at full power, and where",
		work(builder),
		string.format("%d %d 1 at 100 110 0", -hutDef, hut.id)
	)
	local sets = world.unitParamSets
	run(30)
	t.same("it is not told again while the work goes on", calls(world, builder), "StartBuilding")
	t.same("and no parameter is set again", world.unitParamSets, sets)
	run(20)
	t.same("a change of build power is one parameter", world.unitParamSets, sets + 1)
	t.same("which is the power", builder.params.coilbox_rewind_work_power, 0.2)
	run(20)
	t.same("once what it builds is finished the work is a repair", builder.params.coilbox_rewind_work_command, 40)
	t.same("and its script is not told again for the same unit", calls(world, builder), "StartBuilding")

	-- Paused, a builder goes on facing its work.
	player:message("coilbox_rewind:pause")
	run(20)
	t.same("pausing tells a builder nothing", calls(world, builder), "StartBuilding")
	t.same("and its work stays in its parameters", builder.params.coilbox_rewind_work_target, hut.id)
	player:message("coilbox_rewind:play")
	run(31)
	t.same("it is told once when the work stops", calls(world, builder), "StartBuilding StopBuilding")
	t.same("on the frame after the last the track has it working", player.clock.frame, 151)
	t.same("and its parameters say it has none", work(builder), "0 -1 0 at 100 110 0")
	run(30)
	t.same("nothing more is told", calls(world, builder), "StartBuilding StopBuilding")

	-- Backward, the work is what the track has, as forward.
	player:message("coilbox_rewind:reverse")
	run(40)
	t.same("played backward into the work it is told it starts", calls(world, builder), "StartBuilding StopBuilding StartBuilding")
	run(120)
	t.same("and that it stops, before the frame the work began on", calls(world, builder), "StartBuilding StopBuilding StartBuilding StopBuilding")

	-- A seek puts the builder somewhere else, so it is told again where to face.
	player:message("coilbox_rewind:seek 80")
	run(2)
	t.same("a seek into the work tells it to start", #world.callsTo(builder, "StartBuilding"), 3)
	player:message("coilbox_rewind:seek 90")
	run(2)
	t.same("and a seek inside the work tells it again, since it may face another way", #world.callsTo(builder, "StartBuilding"), 4)
	t.same("with no stop between", #world.callsTo(builder, "StopBuilding"), 2)
end

-- The same builder with a COB script is given the angles as whole numbers, in
-- the 65,536ths of a turn a COB script takes.

do
	local world, player, run = setup(building(COBENGINEER))
	player:message("coilbox_rewind:seek 60")
	run(2)
	local builder = world.unitNamed("cobengineer")
	local start = world.callsTo(builder, "StartBuilding")[1]
	t.same("a builder with a COB script is told through the COB call", start.how, "cob")
	t.same("with whole numbers", start.a == math.floor(start.a) and start.b == math.floor(start.b), true)
	-- A quarter turn and an eighth, cut to a whole number as the engine cuts them.
	t.near("the heading in 65,536ths of a turn", start.a, 16384, 1)
	t.near("and the pitch", start.b, 8192, 1)
	run(100)
	t.same("and that it stops", calls(world, builder), "StartBuilding StopBuilding")
end

-- A factory's script takes no heading.

do
	local world, player, run = setup(building(PLANT))
	player:message("coilbox_rewind:seek 60")
	run(2)
	local plant = world.unitNamed("plant")
	local start = world.callsTo(plant, "StartBuilding")[1]
	t.same("a factory is told it builds", start.name, "StartBuilding")
	t.same("with no heading", start.a, nil)
	t.same("and no pitch", start.b, nil)
end

-- A factory that starts the next unit on the frame it finished the last, with
-- no frame of no work between, is told it builds again.

do
	local spec = building(PLANT, {
		work = function(frame)
			return 16, frame < 100 and 2 or 3, 255
		end,
	})
	spec.units[3] = { first = 100, last = 600, def = HUT, at = { 0, 0, 100 }, status = function()
		return 1, 0.5, 0
	end }
	local world, player, run = setup(spec)
	player:message("coilbox_rewind:seek 90")
	run(20)
	t.same("a factory that moves straight on to the next unit is told again", calls(world, world.unitNamed("plant")), "StartBuilding StartBuilding")
end

-- The other kinds of work.

do
	local kinds = {
		{ 17, 2, "reclaiming a unit", 90, "unit" },
		{ 20, 2, "capturing a unit", 130, "unit" },
		{ 18, 1, "reclaiming a feature", 90, "feature" },
		{ 19, 1, "resurrecting a feature", 125, "feature" },
		{ 129, 0, "terraforming", 110, "place" },
	}
	for _, kind in ipairs(kinds) do
		local world, player, run = setup(building(ENGINEER, {
			work = function()
				return kind[1], kind[2], 255, 7, 8, 9
			end,
		}))
		player:message("coilbox_rewind:seek 200")
		run(2)
		local builder = world.unitNamed("engineer")
		local p = builder.params
		t.same(kind[3] .. " is the engine's command for it", p.coilbox_rewind_work_command, kind[4])
		if kind[5] == "unit" then
			t.same(kind[3] .. " names the unit", p.coilbox_rewind_work_target, world.unitNamed("hut").id)
			t.same("and where it is", p.coilbox_rewind_work_x, 100)
		elseif kind[5] == "feature" then
			local featureID = world.Spring.GetAllFeatures()[1]
			t.same(kind[3] .. " names the feature as the engine does, past the unit ids", p.coilbox_rewind_work_target, featureID + 32000)
			t.same("and where it is, x", p.coilbox_rewind_work_x, 30)
			t.same("z", p.coilbox_rewind_work_z, 40)
		else
			t.same(kind[3] .. " has no target", p.coilbox_rewind_work_target, -1)
			t.same("and the place the track has, x", p.coilbox_rewind_work_x, 7)
			t.same("y", p.coilbox_rewind_work_y, 8)
			t.same("z", p.coilbox_rewind_work_z, 9)
		end
		t.same(kind[3] .. " tells the script it builds", calls(world, builder), "StartBuilding")
	end
end

-- A window with no track for a builder's work means it has none there.

do
	local spec = building(ENGINEER, {
		work = function(frame)
			return frame < 900 and 16 or 0, 2, 255
		end,
		workUntil = 899,
	})
	spec.last = 2000
	spec.units[1].last = 2000
	spec.units[2].last = 2000
	local world, player, run = setup(spec)
	player:message("coilbox_rewind:seek 880")
	run(5)
	local builder = world.unitNamed("engineer")
	t.same("a builder at work at the end of a window", calls(world, builder), "StartBuilding")
	run(30)
	t.same("is told it stopped in the next window, which has no track for its work", calls(world, builder), "StartBuilding StopBuilding")
	t.same("and its parameters say so", builder.params.coilbox_rewind_work_command, 0)
end

-- A builder whose target the seek has yet to make.

do
	local world, player, run = setup(building(ENGINEER), { budget = 1 })
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 80")
	run(1)
	local builder = world.unitNamed("engineer")
	t.same("only the builder has been made", world.unitCount(), 1)
	t.same("its work names no unit yet", builder.params.coilbox_rewind_work_target, -1)
	t.same("and has the place the track has for it", builder.params.coilbox_rewind_work_x, 100)
	run(2)
	t.same("the frame that makes the target names it", builder.params.coilbox_rewind_work_target, world.unitNamed("hut").id)
end

-- A builder's nano pieces (issue #4029). The engine fills its list by asking
-- the script only while a builder really builds, which none does in a
-- playback, so the stage asks the script the engine's way, once for a unit,
-- and gives the engine what it found.

do
	local world, player, run = setup(building(ENGINEER))
	player:message("coilbox_rewind:seek 40")
	run(10)
	local builder = world.unitNamed("engineer")
	t.same("a builder with no work is not asked for a nano piece", #world.callsTo(builder, "QueryNanoPiece"), 0)
	t.same("and the engine has none for it", world.Spring.GetUnitNanoPieces(builder.id), nil)
	run(1)
	local pieces = world.Spring.GetUnitNanoPieces(builder.id)
	t.same("once it works the engine has its nano pieces, as the model numbers them from 1", pieces and table.concat(pieces, " "), "3 4")
	-- Two new pieces, then 31 asks that give none, as NanoPieceCache does.
	t.same("asked until 31 asks in a row give no new piece", #world.callsTo(builder, "QueryNanoPiece"), 33)
	t.same("in the frame its work starts", world.callsTo(builder, "QueryNanoPiece")[1].frame, world.callsTo(builder, "StartBuilding")[1].frame)
	run(150)
	player:message("coilbox_rewind:seek 80")
	run(2)
	t.same("a unit is asked once, whatever its work does after", #world.callsTo(builder, "QueryNanoPiece"), 33)
	t.same("and the engine was told once", world.nanoSets, 1)
end

do
	local world, player, run = setup(building(COBENGINEER))
	player:message("coilbox_rewind:seek 60")
	run(2)
	local builder = world.unitNamed("cobengineer")
	local pieces = world.Spring.GetUnitNanoPieces(builder.id)
	t.same("a COB script's piece, counted from 0, is the model's from 1", pieces and table.concat(pieces, " "), "2")
	t.same("asked once and then 31 times more", #world.callsTo(builder, "QueryNanoPiece"), 32)
	t.same("through the COB call", world.callsTo(builder, "QueryNanoPiece")[1].how, "cob")
end

do
	local world, player, run = setup(building(ENGINEER))
	player:message("coilbox_rewind:seek 40")
	run(2)
	local builder = world.unitNamed("engineer")
	-- What a game's script does as its unit is created, as Splinter Faction's do.
	world.Spring.SetUnitNanoPieces(builder.id, { 2 })
	local sets = world.nanoSets
	run(20)
	t.same("a builder whose script gave its own nano pieces is not asked", #world.callsTo(builder, "QueryNanoPiece"), 0)
	t.same("and keeps them", table.concat(world.Spring.GetUnitNanoPieces(builder.id), " "), "2")
	t.same("the engine is not told again", world.nanoSets, sets)
end

do
	local world, player, run = setup(building(PLANT))
	player:message("coilbox_rewind:seek 60")
	local ok, err = pcall(run, 5)
	t.check("a factory whose script has no QueryNanoPiece raises nothing", ok, err)
	t.same("and the engine has no nano piece for it", world.Spring.GetUnitNanoPieces(world.unitNamed("plant").id), nil)
end

do
	local raising = {}
	for k, def in ipairs(UNIT_DEFS) do
		raising[k] = def
	end
	raising[ENGINEER + 1] = {
		name = "engineer",
		script = "lua",
		isBuilder = true,
		pieces = { "base", "arm" },
		midHeight = 10,
		callins = {
			StartBuilding = nothing,
			StopBuilding = nothing,
			QueryNanoPiece = function()
				error("no nozzle")
			end,
		},
	}
	local world, player, run = setup(building(ENGINEER), { unitDefs = raising })
	player:message("coilbox_rewind:seek 60")
	local ok, err = pcall(run, 5)
	t.check("a script that raises when asked for a nano piece takes nothing down", ok, err)
	local builder = world.unitNamed("engineer")
	t.same("it is asked once", #world.callsTo(builder, "QueryNanoPiece"), 1)
	t.same("and the line says so once", said(world, "raised in QueryNanoPiece"), 1)
	t.same("its unit is still told it builds", calls(world, builder), "StartBuilding")
end

-- The work the stage hands on to the unsynced half, which draws the stream of
-- build particles (issue #4029): a builder's id, the command and target of its
-- parameters, the build power, where the work is, the frame of the track and
-- whether a seek brought it there. Handed on when one of the first three
-- changes, and again after a seek while it works.

do
	local sent = {}
	local world, player, run = setup(building(ENGINEER), {
		work = function(unitID, command, target, power, x, y, z, frame, jumped)
			sent[#sent + 1] = table.concat({ unitID, command, target, power, x, y, z, frame, jumped }, " ")
		end,
	})
	player:message("coilbox_rewind:seek 40")
	run(10)
	t.same("a builder with no work hands nothing on", #sent, 0)
	run(1)
	local builder, hut = world.unitNamed("engineer"), world.unitNamed("hut")
	local hutDef = world.globals.UnitDefNames.hut.id
	t.same("its work is handed on as it starts", sent[1], string.format("%d %d %d 1 100 110 0 50 0", builder.id, -hutDef, hut.id))
	run(30)
	t.same("and not again while it goes on", #sent, 1)
	run(20)
	t.same("a change of power is handed on", sent[2], string.format("%d %d %d 0.2 100 110 0 100 0", builder.id, -hutDef, hut.id))
	run(20)
	t.same("so is the build becoming a repair", sent[3], string.format("%d 40 %d 0.2 100 110 0 120 0", builder.id, hut.id))
	player:message("coilbox_rewind:pause")
	run(20)
	t.same("pausing hands nothing on", #sent, 3)
	player:message("coilbox_rewind:play")
	run(31)
	t.same("the work stopping is handed on as no command", sent[4], string.format("%d 0 -1 0 100 110 0 151 0", builder.id))
	player:message("coilbox_rewind:seek 80")
	run(1)
	t.same("a seek into the work hands it on, saying it was a seek", sent[5], string.format("%d %d %d 1 100 110 0 80 1", builder.id, -hutDef, hut.id))
	player:message("coilbox_rewind:seek 90")
	run(1)
	t.same("so does a seek inside the same work", sent[6], string.format("%d %d %d 1 100 110 0 90 1", builder.id, -hutDef, hut.id))
	run(5)
	t.same("and play after it hands nothing more on", #sent, 6)
end

-- A piece the track has poses for and a walk also turns. The script turns the
-- right leg about x the moment it is told its unit moves, so that turn is the
-- walk's, and the aim stage leaves it to the script from then on, for every
-- unit of the definition. The other turns of the leg and the torso are still
-- the track's.

do
	local POSED = { { unitDef = WALKER, pieces = { "torso", "rleg" } } }
	local function legged(first)
		local unit = stroll(WALKER)
		unit.first = first or 0
		unit.poses = {
			{ piece = 0, at = function()
				return 0, 16384, 0, 0, 0, 0
			end },
			{ piece = 1, at = function()
				return 8192, 4096, 0, 0, 0, 0
			end },
		}
		return unit
	end
	local world, player, run = setup({ last = 600, posedPieces = POSED, units = { legged(), legged(150) } })
	-- The script's own walk, which the engine runs between the player's two calls.
	world.economy = function()
		for _, id in ipairs(world.Spring.GetAllUnits()) do
			local unit = world.units[id]
			world.scriptTurn(unit, "rleg", 1.25, 1.25, 0)
			world.scriptTurn(unit, "torso", 2.5, 2.5, 0)
		end
	end
	player:message("coilbox_rewind:seek 90")
	run(5)
	local unit = world.unitNamed("walker")
	local rx, ry = world.pieceOf(unit, "rleg")
	t.near("a posed leg of a unit that stands has the track's turn about x", rx, TURN / 8, 1e-9)
	t.near("and about y", ry, TURN / 16, 1e-9)
	run(10)
	rx, ry = world.pieceOf(unit, "rleg")
	t.same("once the unit walks, the turn its walk makes is left to its script", rx, 1.25)
	t.near("a turn of the same piece that the walk does not make is still the track's", ry, TURN / 16, 1e-9)
	local _, torso = world.pieceOf(unit, "torso")
	t.near("and a piece the walk does not turn is the track's", torso, TURN / 4, 1e-9)
	t.same("the player says so once, naming the piece", said(world, "the walk of walker turns rleg"), 1)
	run(60)
	local second
	for _, id in ipairs(world.Spring.GetAllUnits()) do
		if id ~= unit.id then
			second = world.units[id]
		end
	end
	t.check("a second unit of the definition was made", second ~= nil)
	rx = world.pieceOf(second, "rleg")
	t.same("and its leg is its script's from the start", rx, 1.25)
	player:message("coilbox_rewind:seek 300")
	run(3)
	rx = world.pieceOf(unit, "rleg")
	t.same("it stays the script's when the unit stands again", rx, 1.25)
	t.same("the line is logged once for the definition", said(world, "the walk of walker turns rleg"), 1)

	-- A turn that was already running when the unit was told is not the walk's.
	world, player, run = setup({ last = 600, posedPieces = POSED, units = { legged() } })
	player:message("coilbox_rewind:seek 90")
	run(5)
	unit = world.unitNamed("walker")
	world.animate(unit, "torso", 2)
	world.economy = function()
		world.scriptTurn(unit, "torso", 2.5, 2.5, 0)
	end
	run(10)
	_, torso = world.pieceOf(unit, "torso")
	t.near("a turn that was running before the unit was told it moves stays the track's", torso, TURN / 4, 1e-9)

	-- Without the two calls that ask, nothing is left to the script.
	local Table = t.load("coilbox_player_engine.lua", t.syncedEnv())
	local on = setmetatable({ walkPieces = false }, { __index = Table.ALL_ON })
	world, player, run = setup({ last = 600, posedPieces = POSED, units = { legged() } }, { engine = { on = on } })
	world.economy = function()
		world.scriptTurn(world.unitNamed("walker"), "rleg", 1.25, 1.25, 0)
	end
	player:message("coilbox_rewind:seek 90")
	run(20)
	rx = world.pieceOf(world.unitNamed("walker"), "rleg")
	t.near("with the row off a walking unit's posed leg is still the track's", rx, TURN / 8, 1e-9)
end

-- A script that raises is said once and not called again, and the player goes on.

do
	local defs = {
		{
			name = "walker",
			script = "lua",
			pieces = LEGS,
			callins = {
				StartMoving = function()
					error("the script broke")
				end,
				StopMoving = nothing,
			},
		},
	}
	local world, player, run = setup({ last = 600, unitDefs = { "walker" }, units = { stroll(0) } }, { unitDefs = defs })
	player:message("coilbox_rewind:seek 90")
	local ok, err = pcall(run, 30)
	t.check("a script that raises does not raise in the player", ok, err)
	t.same("it is logged once", said(world, "the script of walker raised in StartMoving"), 1)
	t.check("with what it said", said(world, "the script broke") == 1, table.concat(world.lines, " | "))
	local unit = world.unitNamed("walker")
	player:message("coilbox_rewind:seek 300")
	run(2)
	player:message("coilbox_rewind:seek 150")
	run(2)
	t.same("and that function of that unit is not run again", #world.callsTo(unit, "StartMoving"), 1)
	t.same("the unit is still placed", unit.z, 2 * 51)
end

-- A game whose script framework copied the engine's call before the gadget
-- wrapped it: the player never sees the script, tells it nothing and raises
-- nothing.

do
	local world, player, run = setup({ last = 600, units = { stroll(WALKER), stroll(BOT) } }, { copied = true })
	player:message("coilbox_rewind:seek 90")
	local ok, err = pcall(run, 150)
	t.check("a Lua script the player cannot see raises nothing", ok, err)
	t.same("its unit is told nothing", calls(world, world.unitNamed("walker")), "")
	t.same("a unit with a COB script beside it is still told", calls(world, world.unitNamed("bot")), "StartMoving StopMoving")
end

-- With a row of the engine table off.

do
	local Table = t.load("coilbox_player_engine.lua", t.syncedEnv())
	local function without(id)
		return { on = setmetatable({ [id] = false }, { __index = Table.ALL_ON }) }
	end
	local spec = function()
		local s = building(ENGINEER)
		s.units[3] = stroll(WALKER)
		return s
	end

	local world, player, run = setup(spec(), { engine = without("unitScripts") })
	player:message("coilbox_rewind:seek 40")
	run(200)
	t.same("without the script calls no script is told anything", #world.scriptCalls, 0)
	t.check("velocity is still set", world.velocitySets > 0)
	t.check("and a builder's work is still in its parameters", world.unitParamSets > 0)

	world, player, run = setup(spec(), { engine = without("unitSpeed") })
	player:message("coilbox_rewind:seek 40")
	run(200)
	t.same("without the velocity calls no velocity is set", world.velocitySets, 0)
	t.same("and no unit is told to stop moving by itself", world.unitNamed("walker").extrapolate, true)
	t.same("scripts are still told", calls(world, world.unitNamed("walker")), "StartMoving StopMoving")

	world, player, run = setup(spec(), { engine = without("builderWork") })
	player:message("coilbox_rewind:seek 40")
	run(200)
	t.same("without the parameter call no parameter is set", world.unitParamSets, 0)
	t.same("and a builder's script is still told", calls(world, world.unitNamed("engineer")), "StartBuilding StopBuilding")

	world, player, run = setup(spec(), { engine = without("nanoPieces") })
	player:message("coilbox_rewind:seek 40")
	run(200)
	t.same("without the nano piece calls no script is asked for one", #world.callsTo(world.unitNamed("engineer"), "QueryNanoPiece"), 0)
	t.same("and the engine is told none", world.nanoSets, 0)
	t.same("and a builder's script is still told", calls(world, world.unitNamed("engineer")), "StartBuilding StopBuilding")
end

-- A frame of play allocates nothing: 20 units that walk and 5 builders at work,
-- in the frames between one start and the next stop.

do
	local units = {}
	for n = 1, 20 do
		units[n] = {
			first = 0,
			last = 2000,
			def = n % 2 == 0 and WALKER or BOT,
			at = function(frame)
				return n * 40, 0, frame * 1.5
			end,
		}
	end
	for n = 21, 25 do
		units[n] = {
			first = 0,
			last = 2000,
			def = ENGINEER,
			at = { n * 40, 0, 0 },
			work = function()
				return 16, 26, 255
			end,
		}
	end
	units[26] = { first = 0, last = 2000, def = HUT, at = { 500, 0, 500 } }
	local world, player, run = setup({ last = 2000, units = units })
	player:message("coilbox_rewind:seek 100")
	run(20)
	t.same("the 20 walkers were told they move", #world.scriptCalls >= 20, true)
	local told = #world.scriptCalls
	local function frame()
		player:frame()
	end
	local function post()
		player:framePost()
	end
	local step = world.step
	for _ = 1, 9 do
		step(frame, post)
	end
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first frame
	-- after it takes that back, which is the interpreter's and not the player's.
	step(frame, post)
	local before = collectgarbage("count")
	for _ = 1, 300 do
		step(frame, post)
	end
	local grown = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 frames of 20 walking units and 5 builders at work allocate nothing", grown, 0)
	t.same("and no script was told anything in them", #world.scriptCalls, told)
	t.same("they were played", player.clock.frame, 100 + 20 + 10 + 300 - 1)
end

-- The fixture, through the real reader.

do
	local bytes = t.read(t.FIXTURES .. "small.cbtrack")
	local env = t.syncedEnv()
	local Reader = t.load("coilbox_track.lua", env)
	local Fetch = t.load("coilbox_track_fetch.lua", env)
	local track = assert(Reader.open(Fetch.fromString(bytes)))
	local defs = {
		{ name = "armcom", script = "lua", callins = { StartMoving = nothing, StopMoving = nothing, StartBuilding = nothing, StopBuilding = nothing } },
		{ name = "armpw", script = "cob", pieces = { "pelvis", "turret", "barrel", "arm" }, callins = { StartMoving = nothing, StopMoving = nothing } },
		{ name = "armsolar", isImmobile = true },
	}
	local world, player, run = setup(track, { unitDefs = defs })
	local ok, err = pcall(run, 2100)
	t.check("the fixture plays forward with the stage on", ok, err)
	player:message("coilbox_rewind:play -1")
	ok, err = pcall(run, 600)
	t.check("and backward", ok, err)
	-- The fixture's units are under construction at every whole frame, and
	-- such a unit is told nothing, so this shows that the stage reads a real
	-- window and not that anything walks.
	t.same("every unit of the last frame shown is there", world.unitCount() > 0, true)
	local starts, stops = 0, 0
	for _, one in ipairs(world.scriptCalls) do
		if one.name == "StartMoving" then
			starts = starts + 1
		elseif one.name == "StopMoving" then
			stops = stops + 1
		end
	end
	t.check("a unit is told it stopped no more often than that it moves", stops <= starts, starts .. " starts, " .. stops .. " stops")
	t.same("nothing was logged about a script raising", said(world, "raised in"), 0)
end

t.report()
