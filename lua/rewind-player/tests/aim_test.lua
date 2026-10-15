-- The aim stage (issue #3796): the track's pose of each aiming piece, set on
-- the engine's unit on every frame, on the engine stand-in in engine.lua. The
-- tracks are made from a table (fake_track.lua), and the end of the file runs
-- the fixture through the real reader.
--
-- A frame here is the engine's: the player's frame, then the unit's own script,
-- which a test gives as `world.economy`, then the player's post frame. The
-- script runs after the first and before the second in the engine too, which is
-- why a pose only holds when it is set from the second.
--
-- None of this shows a pose in an engine. The ignored Rust test
-- aim_poses_follow_the_track_in_the_engine does that.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local TURN = 2 * math.pi
--- An angle in radians as the track stores it, in 65,536ths of a turn.
local function units(radians)
	return radians * 65536 / TURN
end

local UNIT_DEFS = {
	{ name = "tank", health = 1000, pieces = { "base", "turret", "barrel", "lwheel" } },
	{ name = "walker", health = 500, pieces = { "pelvis", "torso", "lleg" } },
	{ name = "plant", health = 4000, buildTime = 500, pieces = { "base", "pad" } },
}
local NAMES = { "tank", "walker", "plant" }
-- The walker's second posed piece is one its script does not have.
local POSED = { { unitDef = 0, pieces = { "turret", "barrel" } }, { unitDef = 1, pieces = { "torso", "ghost" } } }

--- A world and a player of `spec`. `options.engine` is what the capability
-- table says of the engine and `options.budget` the most units a frame makes.
local function setup(spec, options)
	options = options or {}
	spec.unitDefs = spec.unitDefs or NAMES
	spec.posedPieces = spec.posedPieces or POSED
	local world = Engine.new({ unitDefs = options.unitDefs or UNIT_DEFS })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local track = spec.header and spec or Fake.new(spec)
	local player = assert(Player.new(track, {
		modOptions = {},
		engine = options.engine,
		budget = options.budget,
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
	local function frame()
		player:frame()
	end
	local function post()
		player:framePost()
	end
	--- `count` frames of an engine that calls back at the end of each.
	local function run(count)
		for _ = 1, count or 1 do
			world.step(frame, post)
		end
	end
	--- `count` frames of one that does not.
	local function runOld(count)
		for _ = 1, count or 1 do
			world.step(frame)
		end
	end
	return world, player, run, runOld
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

--- How far a piece's turn is from `x, y, z` radians, taking a whole turn for
-- none, and how far its offset is from `ox, oy, oz`.
local function off(world, unit, piece, x, y, z, ox, oy, oz)
	local rx, ry, rz, px, py, pz = world.pieceOf(unit, piece)
	local worst = 0
	for _, pair in ipairs({ { rx, x }, { ry, y }, { rz, z } }) do
		local d = math.abs(pair[1] - pair[2] % TURN)
		worst = math.max(worst, math.min(d, TURN - d))
	end
	return worst, math.max(math.abs(px - (ox or 0)), math.abs(py - (oy or 0)), math.abs(pz - (oz or 0)))
end

--- A tank whose turret turns about y by a hundredth of a radian a frame, and
-- whose barrel is raised by a tenth of a radian and pulled back 2 elmos.
local function turning()
	return {
		last = 600,
		units = { {
			first = 0,
			last = 600,
			def = 0,
			poses = {
				{ piece = 0, at = function(frame)
					return 0, units(frame / 100), 0, 0, 0, 0
				end },
				{ piece = 1, at = function()
					return units(-0.1), 0, 0, 0, 0, -2
				end },
			},
		} },
	}
end

--- The unit's own script, aiming somewhere else and turning a wheel: what the
-- engine runs between the player's two call-ins.
local function fighting(world)
	local spin = 0
	world.economy = function()
		local tank = world.unitNamed("tank")
		if tank then
			spin = spin + 0.3
			world.scriptTurn(tank, "turret", 0, 2.5, 0)
			world.scriptTurn(tank, "barrel", 0.7, 0, 0)
			world.scriptTurn(tank, "lwheel", spin, 0, 0)
		end
	end
end

-- The first frame, and frames after it paused.

do
	local world, player, run = setup(turning())
	fighting(world)
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 150")
	run(1)
	local tank = world.unitNamed("tank")
	local turn, move = off(world, tank, "turret", 0, 1.5, 0)
	t.near("on the first frame after a seek the turret has the track's turn", turn, 0, 1e-9)
	t.same("and no offset", move, 0)
	turn, move = off(world, tank, "barrel", -0.1, 0, 0, 0, 0, -2)
	t.near("the barrel has the track's turn", turn, 0, 1e-9)
	t.same("and the track's offset", move, 0)
	t.near("a piece the track has no poses for is left as the script has it", (world.pieceOf(tank, "lwheel")), 0.3, 1e-9)
	t.same("the base is left alone too", select(2, world.pieceOf(tank, "base")), 0)

	local worst = 0
	for _ = 1, 60 do
		run(1)
		worst = math.max(worst, (off(world, tank, "turret", 0, 1.5, 0)), (off(world, tank, "barrel", -0.1, 0, 0)))
	end
	t.near("paused, the pose holds for 60 frames against the script", worst, 0, 1e-9)
	t.near("while the wheel goes on turning", (world.pieceOf(tank, "lwheel")), (0.3 * 61) % TURN, 1e-9)
	t.same("the script's names were looked up once for the unit", world.scriptNameLooks, 1)
	t.same("no call was made for a piece the script lacks", world.scriptErrors, 0)

	-- Playing forward and backward.
	player:message("coilbox_rewind:play 1")
	worst = 0
	for _ = 1, 90 do
		run(1)
		worst = math.max(worst, (off(world, tank, "turret", 0, player.clock.frame / 100, 0)))
	end
	t.same("playing forward for 90 frames", player.clock.frame, 240)
	t.near("the turret is the track's at every frame", worst, 0, 1e-9)
	player:message("coilbox_rewind:play -1")
	worst = 0
	for _ = 1, 120 do
		run(1)
		worst = math.max(worst, (off(world, tank, "turret", 0, player.clock.frame / 100, 0)))
	end
	t.same("playing backward for 120 frames", player.clock.frame, 120)
	t.near("it is the track's at every frame too", worst, 0, 1e-9)
	t.same("and the names were not looked up again", world.scriptNameLooks, 1)
end

-- An angle the track has not reduced to one turn, and half speed.

do
	local world, player, run = setup({
		last = 600,
		units = { {
			first = 0,
			last = 600,
			def = 0,
			poses = { { piece = 0, at = function(frame)
				return 0, 65536 * 141 + 16384 + frame * 8, -65536 * 3 - 8192, 0, 0, 0
			end } },
		} },
	})
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 0")
	run(1)
	local tank = world.unitNamed("tank")
	local turn = off(world, tank, "turret", 0, TURN / 4, -TURN / 8)
	t.near("an angle of 141 turns and a quarter is a quarter turn", turn, 0, 1e-9)
	local rx, ry, rz = world.pieceOf(tank, "turret")
	t.check("and what the engine is given is inside one turn", ry >= 0 and ry < TURN and rz >= 0 and rz < TURN and rx == 0, ry)
	player:message("coilbox_rewind:speed 0.5")
	player:message("coilbox_rewind:play 1")
	run(3)
	t.same("at half speed the time is a fraction of a frame", player.clock.frame, 1.5)
	-- The angle about y goes up by 8 of the track's steps a frame.
	turn = off(world, tank, "turret", 0, TURN / 4 + 1.5 * 8 * TURN / 65536, -TURN / 8)
	t.near("and the pose is the track's at that time", turn, 0, 1e-9)
end

-- A piece the script does not have, and a definition with no posed pieces.

do
	local world, player, run = setup({
		last = 300,
		units = {
			{ first = 0, last = 300, def = 1, poses = {
				{ piece = 0, at = function() return 0, units(0.5), 0, 0, 1, 0 end },
				{ piece = 1, at = function() return 0, units(0.25), 0, 0, 0, 0 end },
			} },
			{ first = 0, last = 300, def = 1, at = { 50, 0, 0 }, poses = {
				{ piece = 1, at = function() return 0, units(0.25), 0, 0, 0, 0 end },
			} },
			{ first = 0, last = 300, def = 2, at = { 100, 0, 0 } },
		},
	})
	player:message("coilbox_rewind:pause")
	run(5)
	local walker = world.unitNamed("walker")
	local turn, move = off(world, walker, "torso", 0, 0.5, 0, 0, 1, 0)
	t.near("a unit with one piece its script lacks still has its other piece posed", turn, 0, 1e-9)
	t.same("with its offset", move, 0)
	t.same("the missing piece is said once for the definition, for two units and five frames", said(world, "the script of walker has no piece called ghost"), 1)
	t.same("and no call is made for it", world.scriptErrors, 0)
	t.same("names are looked up for the two units with posed pieces and not for the plant", world.scriptNameLooks, 2)
	local plant = world.unitNamed("plant")
	t.same("a unit of a definition with no posed pieces is not touched", select(2, world.pieceOf(plant, "pad")), 0)
end

-- A piece with no track in a window is at rest for the whole of it, which the
-- format page says. The unit's script may have left it anywhere.

do
	local world, player, run = setup({
		last = 2000,
		windowLength = 900,
		units = { {
			first = 0,
			last = 2000,
			def = 0,
			poses = { { piece = 0, first = 0, last = 800, at = function() return 0, units(1), 0, 0, 3, 0 end } },
		} },
	})
	fighting(world)
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 400")
	run(2)
	local tank = world.unitNamed("tank")
	t.near("in the window that has the track the turret is turned", (off(world, tank, "turret", 0, 1, 0, 0, 3, 0)), 0, 1e-9)
	t.near("and the barrel, which has no track there, is at rest though the script turned it", (off(world, tank, "barrel", 0, 0, 0)), 0, 1e-9)
	player:message("coilbox_rewind:seek 1500")
	run(2)
	local turn, move = off(world, tank, "turret", 0, 0, 0)
	t.near("in a window with no track for it the turret is at rest", turn, 0, 1e-9)
	t.same("with no offset", move, 0)
	t.same("the unit is the same one, and its names were looked up once", world.scriptNameLooks, 1)
end

-- A seek that makes its units over several frames (issue #3988): a unit that
-- is not there yet gets no pose, and gets one on the frame it appears.

do
	local list = {}
	for i = 1, 6 do
		list[i] = {
			first = 100,
			last = 600,
			def = 0,
			at = { i * 40, 0, 0 },
			poses = { { piece = 0, at = function() return 0, units(0.1 * i), 0, 0, 0, 0 end } },
		}
	end
	local world, player, run = setup({ last = 600, units = list }, { budget = 2 })
	world.economy = function()
		for _, unit in pairs(world.units) do
			if not unit.dead then
				world.scriptTurn(unit, "turret", 0, 3, 0)
			end
		end
	end
	player:message("coilbox_rewind:pause")
	run(2)
	t.same("nothing exists before the seek, and nothing is posed", world.poseSets, 0)
	player:message("coilbox_rewind:seek 300")
	local ok = true
	for made = 2, 6, 2 do
		run(1)
		t.same("a frame of the seek makes two units", world.unitCount(), made)
		for _, unit in pairs(world.units) do
			local i = unit.x / 40
			if not unit.dead and (off(world, unit, "turret", 0, 0.1 * i, 0)) > 1e-9 then
				ok = false
			end
		end
	end
	t.check("each unit has its pose at the end of the frame it was made in", ok)
	t.same("the names were looked up once for each", world.scriptNameLooks, 6)

	-- A unit the base game destroys in the middle of a frame.
	local victim = world.unitNamed("tank")
	local fine = pcall(function()
		world.step(function()
			player:frame()
		end, function()
			world.Spring.DestroyUnit(victim.id, false, true)
			player:framePost()
		end)
		run(2)
	end)
	t.check("a unit destroyed between the frame and its post frame raises nothing", fine)
	t.same("it is made again", world.unitCount(), 6)
	t.same("and its names are looked up again, since it is another unit", world.scriptNameLooks, 7)
end

-- A unit under construction is posed as well.

do
	local world, player, run = setup({
		last = 300,
		units = { {
			first = 0,
			last = 300,
			def = 0,
			status = function()
				return 0.5, 0.5, 0
			end,
			poses = { { piece = 0, at = function() return 0, units(0.75), 0, 0, 0, 0 end } },
		} },
	})
	player:message("coilbox_rewind:pause")
	run(2)
	local tank = world.unitNamed("tank")
	t.same("the unit is under construction", tank.beingBuilt, true)
	t.near("and has the track's pose", (off(world, tank, "turret", 0, 0.75, 0)), 0, 1e-9)
end

-- Without the engine's call at the end of a frame (issue #4002) the pose is set
-- from the frame itself, where the unit's script can move the piece afterwards.

do
	local world, player, _, runOld = setup(turning())
	local seen, worst = 0, 0
	local turned = false
	world.economy = function()
		local tank = world.unitNamed("tank")
		-- What the player's frame left, before the script runs.
		worst = math.max(worst, (off(world, tank, "turret", 0, 1.5, 0)))
		seen = seen + 1
		if turned then
			world.scriptTurn(tank, "turret", 0, 2.5, 0)
		end
	end
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 150")
	runOld(40)
	t.same("the pose was looked at after 40 frames", seen, 40)
	t.near("with no post frame call the pose is set in the frame itself, every frame", worst, 0, 1e-9)
	turned = true
	runOld(1)
	local tank = world.unitNamed("tank")
	t.near("and a script that aims afterwards has the last word until the next frame", (off(world, tank, "turret", 0, 2.5, 0)), 0, 1e-9)
	t.same("the player says so once", said(world, "GameFramePost does not reach the player, so aiming pieces are posed from GameFrame"), 1)
end

-- A frame of play allocates nothing.

do
	local list = {}
	for i = 1, 20 do
		list[i] = {
			first = 0,
			last = 3000,
			def = i % 2,
			at = { i * 40, 0, 0 },
			poses = {
				{ piece = 0, at = function(frame) return frame, frame * 3, 0, 0, 0, 0 end },
				{ piece = 1, at = function(frame) return -frame, 0, 0, 0, 0, 1 end },
			},
		}
	end
	local world, player, run = setup({ last = 3000, windowLength = 3000, units = list })
	run(3)
	t.same("twenty units are posed", world.unitCount(), 20)
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first frames
	-- after it take that back, which is the interpreter's and not the player's.
	run(1)
	local before = world.poseSets
	local memory = collectgarbage("count")
	run(300)
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of posing 20 units allocate nothing", after - memory, 0)
	-- Ten tanks with two pieces and ten walkers with one, six values each.
	t.same("and set every value of every posed piece on every frame", world.poseSets - before, 300 * (10 * 2 + 10 * 1) * 6)
end

-- The fixture, through the real reader: every pose the reader gives is what the
-- engine's unit has when a frame is over.

do
	local bytes = t.read(t.FIXTURES .. "small.cbtrack")
	local env = t.syncedEnv()
	local Reader = t.load("coilbox_track.lua", env)
	local Fetch = t.load("coilbox_track_fetch.lua", env)
	local track = assert(Reader.open(Fetch.fromString(bytes)))
	local own = assert(Reader.open(Fetch.fromString(bytes)))
	local info = assert(own:info())
	local world, player, run = setup(track, {
		unitDefs = {
			{ name = "armcom" },
			{ name = "armpw", pieces = { "pelvis", "turret", "barrel", "arm" } },
			{ name = "armsolar" },
		},
	})
	player:message("coilbox_rewind:pause")
	local pose = { 0, 0, 0, 0, 0, 0 }
	local checked, worstTurn, worstMove = 0, 0, 0
	for _, frame in ipairs({ 800, 100, 1300, 2101, 514 }) do
		player:message("coilbox_rewind:seek " .. frame)
		run(2)
		local w = assert(own:seek(frame))
		for i = 1, w.unitCount do
			if w:unitExistsAt(i, frame) then
				for _, posed in ipairs(info.posedPieces) do
					if posed.unitDef == w.unitDef[i] then
						local unit = world.units[player.units.unitOf[w.unitSerial[i]]]
						for track_ = w.unitPoseFirst[i], w.unitPoseFirst[i] + w.unitPoseCount[i] - 1 do
							w:samplePose(track_, frame, pose)
							local name = posed.pieces[w.posePiece[track_] + 1]
							local turn, move = off(world, unit, name, pose[1] * TURN / 65536, pose[2] * TURN / 65536, pose[3] * TURN / 65536, pose[4], pose[5], pose[6])
							checked = checked + 1
							worstTurn, worstMove = math.max(worstTurn, turn), math.max(worstMove, move)
						end
					end
				end
			end
		end
	end
	t.check("the fixture has poses at the frames looked at", checked >= 5, checked)
	t.near("every posed piece of the fixture has the reader's turn", worstTurn, 0, 1e-9)
	t.near("and the reader's offset", worstMove, 0, 1e-9)
end

t.report()
