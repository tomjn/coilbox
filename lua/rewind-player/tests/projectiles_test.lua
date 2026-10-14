-- The projectiles stage: what the player makes of a track's shots at a time, on
-- the engine stand-in in engine.lua and tracks made from a table
-- (fake_track.lua).
--
-- None of this shows a shot in an engine. The ignored Rust test
-- projectiles_follow_a_whole_match does that.

-- The engine runs plain Lua 5.1. LuaJIT's traces are memory the allocation
-- count at the end would show.
if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local UNIT_DEFS = { { name = "tank", health = 1000 } }
local WEAPON_DEFS = {
	{ name = "shell", type = "Cannon", fireSound = { { name = "sounds/boom.wav", volume = 2 } } },
	{ name = "bolt", type = "LaserCannon" },
	{ name = "beam", type = "BeamLaser", intensity = 0.5, range = 400, beamtime = 0.1, soundTrigger = true, fireSound = { { name = "sounds/hum.wav", volume = 1 } } },
	{ name = "rocket", type = "MissileLauncher" },
	{ name = "burst", type = "Cannon", soundTrigger = true, salvoSize = 3, salvoDelay = 0.1, fireSound = { { name = "sounds/a.wav", volume = 1 }, { name = "sounds/b.wav", volume = 1 } } },
	{ name = "fist", type = "Melee" },
}
local NAMES = { "shell", "bolt", "beam", "rocket", "burst", "fist", "gone" }
local SHELL, BOLT, BEAM, ROCKET, BURST, FIST, GONE = 0, 1, 2, 3, 4, 5, 6

--- A world and a player of `spec`, a fake track's table. The player has not
-- taken a frame yet.
local function setup(spec, options)
	options = options or {}
	spec.unitDefs = spec.unitDefs or { "tank" }
	spec.weaponDefs = spec.weaponDefs or NAMES
	local world = Engine.new({ unitDefs = UNIT_DEFS, weaponDefs = options.weaponDefs or WEAPON_DEFS })
	if options.before then
		options.before(world)
	end
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local track = Fake.new(spec)
	local player = assert(Player.new(track, {
		modOptions = {},
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
	return world, player, track
end

--- One simulation frame: the gadget's, then the engine's own.
local function frame(world, player)
	player:frame()
	world.simulate()
end

local function run(world, player, frames)
	for _ = 1, frames do
		frame(world, player)
	end
end

local function send(player, text)
	player:message("coilbox_rewind:" .. text)
end

local function seek(world, player, to)
	send(player, "seek " .. to)
	frame(world, player)
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

--- A shot that leaves `from` on frame `first` at `velocity` a frame and keeps
-- it. `stop` is the frame from which it stands still, as a laser bolt that has
-- hit does.
local function flight(first, from, velocity, stop)
	return function(at)
		local n = at - first
		if stop and at >= stop then
			n = stop - first
			return from[1] + velocity[1] * n, from[2] + velocity[2] * n, from[3] + velocity[3] * n, 0, 0, 0
		end
		return from[1] + velocity[1] * n, from[2] + velocity[2] * n, from[3] + velocity[3] * n, velocity[1], velocity[2], velocity[3]
	end
end

-- A shell that leaves at frame 100 from 100 up, falls 10 a frame, and is last
-- seen on frame 111, 10 under the ground, which is how the engine has a shell
-- on the frame it finds the hit.
local function shell(extra)
	local one = { weapon = SHELL, first = 100, last = 111, shooter = 1, at = flight(100, { 0, 100, 0 }, { 4, -10, 0 }) }
	for key, value in pairs(extra or {}) do
		one[key] = value
	end
	return one
end

-- What is alive at a time.

do
	local world, player = setup({
		last = 400,
		units = { { first = 0, last = 400, at = { 0, 0, 0 } } },
		projectiles = {
			shell(),
			{ weapon = ROCKET, first = 105, last = 200, team = 1, at = flight(105, { 0, 50, 0 }, { 0, 0, 3 }) },
			{ weapon = false, first = 100, last = 300 },
			{ weapon = ROCKET, first = 150, last = 160, at = flight(150, { 9, 50, 9 }, { 1, 0, 0 }) },
		},
	})
	send(player, "pause")
	frame(world, player)
	t.same("before any shot nothing is in the air", world.projectileCount(), 0)
	for _, case in ipairs({ { 100, 1 }, { 105, 2 }, { 111, 2 }, { 112, 1 }, { 155, 2 }, { 201, 0 }, { 110, 2 }, { 99, 0 } }) do
		seek(world, player, case[1])
		t.same("at frame " .. case[1] .. " the shots in the air are the track's " .. case[2], world.projectileCount(), case[2])
	end
	t.same("a piece of debris is never created", world.spawned, 5)

	seek(world, player, 105)
	local one = world.projectileNamed("shell")
	t.same("a shot is where the track has it, x", one.x, 20)
	t.same("y", one.y, 50)
	t.same("z", one.z, 0)
	t.same("it is under move control", one.moveCtrl, true)
	t.near("it points the way the track has it going, x", one.vx / math.sqrt(one.vx ^ 2 + one.vy ^ 2), 4 / math.sqrt(116), 1e-9)
	t.near("y", one.vy / math.sqrt(one.vx ^ 2 + one.vy ^ 2), -10 / math.sqrt(116), 1e-9)
	t.near("and reaches no further in a frame than one position step", math.sqrt(one.vx ^ 2 + one.vy ^ 2 + one.vz ^ 2), 0.125, 1e-9)
	t.same("it was created at the speed the track has, which a laser keeps for its length", one.speedf, math.sqrt(116))
	t.same("it is on the track's team", one.team, 0)
	t.same("its owner is the unit that fired it", one.owner, world.unitNamed("tank").id)
	t.same("a shot of another team is on that team", world.projectileNamed("rocket").team, 1)
	t.same("a shot with no shooter in the track has no owner", world.projectileNamed("rocket").owner, -1)
	for armor = 0, 2 do
		t.same("it does no damage to armour type " .. armor, one.damages[armor], 0)
	end
	t.same("it leaves no crater", one.damages.craterMult, 0)
	t.same("nor adds to one", one.damages.craterBoost, 0)
	t.same("it pushes nothing", one.damages.impulseFactor, 0)
	t.same("at all", one.damages.impulseBoost, 0)

	-- Held paused for ten seconds, the engine ends nothing.
	run(world, player, 300)
	t.same("paused for 300 frames, both are still in the air", world.projectileCount(), 2)
	t.same("and nothing exploded", #world.explosions, 0)
	t.same("the engine was told about no projectile it no longer has", world.staleCalls, 0)
end

-- Stepping forward and backward.

do
	local world, player = setup({ last = 400, projectiles = { { weapon = ROCKET, first = 100, last = 200, at = flight(100, { 0, 50, 0 }, { 2, 0, 1 }) } } })
	send(player, "pause")
	seek(world, player, 120)
	local one = world.projectileNamed("rocket")
	local id = one.id
	send(player, "play 1")
	run(world, player, 10)
	t.same("ten frames forward it is ten frames on, x", one.x, 60)
	t.same("z", one.z, 30)
	send(player, "reverse")
	run(world, player, 25)
	t.same("25 frames backward it is 25 frames back, x", one.x, 10)
	t.same("z", one.z, 5)
	t.check("it still points forward, the way it flew", one.vx > 0 and one.vz > 0)
	t.same("it is the same projectile all the way", world.projectileNamed("rocket").id, id)
	t.same("one was ever created", world.spawned, 1)
	send(player, "speed 0.5")
	run(world, player, 1)
	t.same("at half speed it moves half a frame, x", one.x, 9)
	send(player, "speed 8")
	send(player, "play 1")
	run(world, player, 2)
	t.same("at 8x forward it moves 8 frames, x", one.x, 9 + 32)
	run(world, player, 30)
	t.same("past its last frame it is gone", world.projectileCount(), 0)
	t.same("with nothing shown", #world.explosions, 0)
end

-- After a seek only the shots that can be alive are looked at.

do
	local shots = {}
	for n = 1, 3000 do
		local first = 10 + n * 3
		shots[n] = { weapon = ROCKET, first = first, last = first + 20, at = flight(first, { n, 50, 0 }, { 0, 0, 1 }) }
	end
	local world, player, track = setup({ last = 9100, windowLength = 9100, projectiles = shots })
	send(player, "pause")
	frame(world, player)
	local before = track.projectileLooks
	seek(world, player, 5000)
	local looks = track.projectileLooks - before
	t.same("a seek into a window of 3,000 shots finds the 7 in the air", world.projectileCount(), 7)
	t.check("having looked at them and not the 3,000 (" .. looks .. " looks)", looks < 60, looks)
	before = track.projectileLooks
	run(world, player, 10)
	t.check("a paused frame looks at no more (" .. (track.projectileLooks - before) / 10 .. " a frame)", (track.projectileLooks - before) / 10 < 60)

	-- A window whose shots are not in order of birth still plays.
	shots[1], shots[3000] = shots[3000], shots[1]
	world, player = setup({ last = 9100, windowLength = 9100, projectiles = shots })
	send(player, "pause")
	seek(world, player, 5000)
	t.same("a window out of order of birth has the same 7 in the air", world.projectileCount(), 7)
end

-- A shot lands with the game's effect only while it is watched.

local function landing(speed, direction)
	local world, player = setup({ last = 400, units = { { first = 0, last = 400 } }, projectiles = { shell() } })
	send(player, "pause")
	if direction == 1 then
		seek(world, player, 96)
	else
		seek(world, player, 120)
	end
	send(player, "speed " .. speed)
	send(player, "play " .. direction)
	run(world, player, 60)
	return world
end

for _, speed in ipairs({ 0.5, 1, 2 }) do
	local world = landing(speed, 1)
	t.same("played forward at " .. speed .. "x the shell lands once", #world.explosions, 1)
	local hit = world.explosions[1] or {}
	t.same("on the ground", hit.why, "ground")
	t.same("with no damage", hit.damage, 0)
	t.same("no crater", hit.crater, false)
	t.same("and no push", hit.impulse, false)
	t.same("nothing is left in the air", world.projectileCount(), 0)
	t.same("and the engine was told about nothing it no longer has", world.staleCalls, 0)
end
for _, speed in ipairs({ 4, 8, 32 }) do
	local world = landing(speed, 1)
	t.same("played forward at " .. speed .. "x nothing lands", #world.explosions, 0)
	t.same("and nothing is left in the air", world.projectileCount(), 0)
end
for _, speed in ipairs({ 0.5, 1, 4 }) do
	local world = landing(speed, -1)
	t.same("played backward at " .. speed .. "x nothing lands", #world.explosions, 0)
	t.same("and the shell was in the air on the way", world.spawned, 1)
end

do
	local world, player = setup({ last = 400, projectiles = { shell() } })
	send(player, "pause")
	seek(world, player, 111)
	t.same("a seek onto a shell's last frame has it in the air", world.projectileCount(), 1)
	t.check("above the ground, though the track has it under", world.projectileNamed("shell").y > 0, world.projectileNamed("shell").y)
	run(world, player, 60)
	t.same("held there paused it stays", world.projectileCount(), 1)
	t.same("and never lands", #world.explosions, 0)
	seek(world, player, 110.5)
	seek(world, player, 300)
	t.same("a seek past it takes it away with nothing shown", #world.explosions, 0)
	t.same("and nothing in the air", world.projectileCount(), 0)
end

-- A shell that ends in the air lands by its time to live, and where the engine
-- cannot set one it is taken away quietly.

do
	local air = { weapon = SHELL, first = 100, last = 105, at = flight(100, { 0, 500, 0 }, { 5, 0, 0 }) }
	local world, player = setup({ last = 400, projectiles = { air } })
	send(player, "pause")
	seek(world, player, 99)
	send(player, "play 1")
	run(world, player, 20)
	t.same("a shell that ends in the air bursts there", #world.explosions, 1)
	t.same("because its time to live ran out", (world.explosions[1] or {}).why, "ttl")
	t.same("a frame's flight on from where the track last has it", (world.explosions[1] or {}).x, 30)
	t.same("with no damage", (world.explosions[1] or {}).damage, 0)

	world, player = setup({ last = 400, projectiles = { air, shell({ first = 120, last = 131, at = flight(120, { 0, 100, 0 }, { 4, -10, 0 }) }) } }, {
		before = function(w)
			w.Spring.SetProjectileTimeToLive = nil
		end,
	})
	send(player, "pause")
	seek(world, player, 99)
	send(player, "play 1")
	run(world, player, 15)
	t.same("on an engine that cannot set a time to live it is taken away quietly", #world.explosions, 0)
	t.same("and is gone", world.projectileCount(), 0)
	run(world, player, 30)
	t.same("a shell that hits the ground still lands there", #world.explosions, 1)
	t.same("on the ground", (world.explosions[1] or {}).why, "ground")
	t.same("and nothing is left", world.projectileCount(), 0)
	t.same("the engine was told about nothing it no longer has", world.staleCalls, 0)
end

-- A shot that hits a unit: the engine looks along the path it is given.

do
	local world, player = setup({ last = 400, projectiles = { { weapon = ROCKET, first = 100, last = 110, at = flight(100, { 0, 50, 0 }, { 10, 0, 0 }) } } })
	world.target = { x = 105, y = 50, z = 0, radius = 3 }
	send(player, "pause")
	seek(world, player, 103)
	run(world, player, 30)
	seek(world, player, 110)
	t.same("on its last frame it is held the track's tolerance short of where it ends", world.projectileNamed("rocket").x, 99.5)
	run(world, player, 30)
	t.same("held, a rocket whose path ends in a unit does not hit it", #world.explosions, 0)
	seek(world, player, 109)
	t.same("and on the frame before, where the track has it", world.projectileNamed("rocket").x, 90)
	seek(world, player, 105)
	send(player, "play 1")
	run(world, player, 10)
	t.same("watched, it hits on its last frame", #world.explosions, 1)
	t.same("the unit", (world.explosions[1] or {}).why, "target")
	t.same("and is gone", world.projectileCount(), 0)
end

-- A laser bolt stops where it hit and fades there for some frames more. It
-- lands on the frame it stops, not its last.

do
	local bolt = { weapon = BOLT, first = 100, last = 112, at = flight(100, { 0, 60, 0 }, { 0, -10, 20 }, 106.5) }
	local world, player = setup({ last = 400, projectiles = { bolt } })
	send(player, "pause")
	seek(world, player, 98)
	send(player, "play 1")
	run(world, player, 8)
	t.same("on the frame before a bolt stops nothing has landed", #world.explosions, 0)
	run(world, player, 1)
	t.same("on the frame it stops it lands", #world.explosions, 1)
	t.same("on the ground", (world.explosions[1] or {}).why, "ground")
	run(world, player, 20)
	t.same("once", #world.explosions, 1)
	t.same("and it was not made again while it faded", world.spawned, 1)
	t.same("the engine was told about nothing it no longer has", world.staleCalls, 0)

	-- A bolt stops on what it hit, so it is held short of there from the frame
	-- before it stops.
	world, player = setup({ last = 400, projectiles = { bolt } })
	send(player, "pause")
	seek(world, player, 105)
	t.same("two frames before a bolt stops it is where the track has it", world.projectileNamed("bolt").z, 100)
	seek(world, player, 106)
	t.near("on the frame before it stops it is held a frame of its flight short", world.projectileNamed("bolt").z, 100, 1e-9)
	run(world, player, 30)
	t.same("and nothing lands", #world.explosions, 0)

	-- Backward, it appears where it is still moving.
	world, player = setup({ last = 400, projectiles = { bolt } })
	send(player, "pause")
	seek(world, player, 110)
	t.same("a seek into the frames a bolt fades in has it in the air", world.projectileCount(), 1)
	local one = world.projectileNamed("bolt")
	t.near("a frame of its flight short of where it stopped, which is on what it hit", one.z, 110, 1e-9)
	t.near("in height too", one.y, 5, 1e-9)
	t.check("pointing the way it flew", one.vz > 0 and one.vy < 0 and one.vx == 0, one.vy .. " " .. one.vz)
	t.same("as long as a bolt that flew at its speed", one.speedf, math.sqrt(500))
	run(world, player, 30)
	t.same("held there paused it stays", world.projectileCount(), 1)
	send(player, "play -1")
	run(world, player, 6)
	t.same("played backward it is the same bolt", world.projectileNamed("bolt"), one)
	t.same("where the track has it", one.z, 80)
	run(world, player, 20)
	t.same("and nothing lands", #world.explosions, 0)
end

-- A beam is fired once, when play passes its start going forward.

do
	local function beams()
		local list = {}
		for n = 0, 2 do
			list[n + 1] = { weapon = BEAM, first = 100 + n, last = 102 + n, shooter = 1, at = { 10, 20, 30, 0, 0, 100 } }
		end
		return setup({ last = 400, units = { { first = 0, last = 400 } }, projectiles = list })
	end
	local world, player = beams()
	send(player, "pause")
	seek(world, player, 98)
	send(player, "play 1")
	frame(world, player)
	t.same("before a beam starts there is none", world.spawned, 0)
	player:frame()
	t.same("as play passes its start it is fired", world.spawned, 1)
	local one = world.projectileNamed("beam")
	t.same("from where the track has it, x", one.x, 10)
	t.same("to where the track's velocity says it ends, z", one.endZ, 130)
	t.same("y", one.endY, 20)
	t.same("for the frames the track has it", one.ttl, 3)
	t.same("as bright at its start as the weapon is", one.startAlpha, 0.5 * 255)
	t.same("and dimmer along its range", one.endAlpha, 0.5 * 255 * (1 - 100 / 400))
	t.same("it is not under move control", one.moveCtrl, false)
	t.same("it does no damage", one.damages[0], 0)
	t.same("its owner is the unit that fired it", one.owner, world.unitNamed("tank").id)
	world.simulate()
	run(world, player, 10)
	t.same("each beam of the three was fired once", world.spawned, 3)
	t.same("none was moved", one.moves, 0)
	t.same("the engine ended them all", world.projectileCount(), 0)
	t.same("its sound played once for the three, the weapon's being one for a burst", world.soundCount, 1)

	world, player = beams()
	send(player, "pause")
	seek(world, player, 101)
	run(world, player, 5)
	t.same("a seek into a beam fires nothing", world.spawned, 0)
	seek(world, player, 110)
	send(player, "play -1")
	run(world, player, 20)
	t.same("nor does playing backward through it", world.spawned, 0)
	t.same("and neither makes a sound", world.soundCount, 0)

	world, player = beams()
	send(player, "pause")
	seek(world, player, 99)
	send(player, "speed 0.5")
	send(player, "play 1")
	run(world, player, 2)
	t.same("at half speed a beam lasts twice the frames", (world.projectileNamed("beam") or {}).ttl, 6 - 1)

	world, player = beams()
	send(player, "pause")
	seek(world, player, 70)
	send(player, "speed 32")
	send(player, "play 1")
	player:frame()
	t.same("at 32x the beam born as the step ends is fired, and the two before it are not", world.spawned, 1)
	t.same("for one frame", (world.projectileNamed("beam") or {}).ttl, 1)
	t.same("without a sound", world.soundCount, 0)
end

-- A shot whose whole life a step passes over is fired and let go at once.

do
	local world, player = setup({ last = 400, projectiles = { { weapon = SHELL, first = 101, last = 101, at = { 5, 300, 5, 3, 0, 0 } } } })
	send(player, "pause")
	seek(world, player, 100)
	send(player, "speed 2")
	send(player, "play 1")
	run(world, player, 3)
	t.same("a shell that lived one frame, passed over at 2x, still bursts", #world.explosions, 1)
	t.same("with no damage", (world.explosions[1] or {}).damage, 0)
	t.same("and is gone", world.projectileCount(), 0)
end

do
	-- A bolt that moves on its first frame only, which a step at 2x passes.
	local close = { weapon = BOLT, first = 101, last = 108, at = flight(101, { 0, 5, 0 }, { 0, -10, 20 }, 101.5) }
	local world, player = setup({ last = 400, projectiles = { close } })
	send(player, "pause")
	seek(world, player, 100)
	send(player, "speed 2")
	send(player, "play 1")
	run(world, player, 6)
	t.same("a bolt that stops inside the step it is born in still lands", #world.explosions, 1)
	t.same("and is made once", world.spawned, 1)
end

-- The sound a weapon fires with.

do
	local function shots()
		return setup({
			last = 400,
			units = { { first = 0, last = 400 }, { first = 0, last = 400 } },
			projectiles = {
				shell({ first = 100, last = 111 }),
				-- Two from one barrel on one frame, as a weapon that fires several does.
				shell({ first = 120, last = 131, at = flight(120, { 0, 100, 0 }, { 4, -10, 0 }) }),
				shell({ first = 120, last = 131, at = flight(120, { 0, 100, 0 }, { 5, -10, 0 }) }),
				-- And one from another unit on that frame.
				shell({ first = 120, last = 131, shooter = 2, at = flight(120, { 9, 100, 0 }, { 5, -10, 0 }) }),
				{ weapon = ROCKET, first = 140, last = 150 },
				-- A burst of three, 3 frames apart, and the next burst.
				{ weapon = BURST, first = 160, last = 170, shooter = 1 },
				{ weapon = BURST, first = 163, last = 170, shooter = 1 },
				{ weapon = BURST, first = 166, last = 170, shooter = 1 },
				{ weapon = BURST, first = 200, last = 210, shooter = 1 },
			},
		})
	end
	local world, player = shots()
	send(player, "pause")
	seek(world, player, 98)
	send(player, "play 1")
	run(world, player, 3)
	t.same("a shot born while it is watched makes its weapon's sound", world.soundCount, 1)
	local heard = world.sounds[1] or {}
	t.same("the weapon's own", heard.name, "sounds/boom.wav")
	t.same("as loud as the weapon has it", heard.volume, 2)
	t.same("where the shot was born, x", heard.x, 0)
	t.same("y", heard.y, 100)
	t.same("with the battle sounds", heard.channel, "battle")
	run(world, player, 25)
	t.same("two shots from one unit on one frame make one sound, and another unit's makes its own", world.soundCount, 3)
	run(world, player, 25)
	t.same("a weapon with no sound makes none", world.soundCount, 3)
	run(world, player, 25)
	t.same("a burst makes one sound when the weapon has one for a burst", world.soundCount, 4)
	t.same("the first of its two", world.sounds[4].name, "sounds/a.wav")
	run(world, player, 40)
	t.same("and the next burst makes the next", world.soundCount, 5)
	t.same("which is the second of its two", world.sounds[5].name, "sounds/b.wav")

	for _, case in ipairs({ { "at 4x", "speed 4", "play 1", 98 }, { "backward", "speed 1", "play -1", 230 } }) do
		world, player = shots()
		send(player, "pause")
		seek(world, player, case[4])
		send(player, case[2])
		send(player, case[3])
		run(world, player, 140)
		t.same("played " .. case[1] .. " nothing makes a sound", world.soundCount, 0)
	end
	world, player = shots()
	send(player, "pause")
	for _, to in ipairs({ 100, 120, 121, 160, 99 }) do
		seek(world, player, to)
	end
	t.same("a seek makes no sound, onto a shot's first frame or anywhere", world.soundCount, 0)
	send(player, "step 1")
	frame(world, player)
	t.same("nor does a step of one frame", world.soundCount, 0)
end

-- A weapon the game does not have, and one that makes no projectile.

do
	local world, player = setup({
		last = 400,
		projectiles = {
			{ weapon = GONE, first = 100, last = 200 },
			{ weapon = GONE, first = 101, last = 200 },
			{ weapon = FIST, first = 100, last = 200 },
			{ weapon = ROCKET, first = 100, last = 200 },
		},
	})
	send(player, "pause")
	seek(world, player, 150)
	seek(world, player, 90)
	send(player, "play 1")
	run(world, player, 30)
	t.same("a weapon the game does not have is reported once", said(world, "the game has no weapon called gone"), 1)
	t.same("a weapon that makes no projectile is reported once", said(world, "fist"), 1)
	t.same("the shots of the weapons it has are in the air", world.projectileCount(), 1)
	t.same("and only they were ever created", world.spawned, 2)
end

-- The engine ends a shot the player is holding, and hands its id out again.

do
	local world, player = setup({
		last = 400,
		projectiles = {
			{ weapon = ROCKET, first = 100, last = 300, at = { 1, 50, 1, 1, 0, 0 } },
			{ weapon = ROCKET, first = 160, last = 300, at = { 2, 50, 2, 1, 0, 0 } },
		},
	})
	send(player, "pause")
	seek(world, player, 150)
	local first = world.projectileNamed("rocket")
	world.projectiles[first.id] = nil
	-- A piece of debris, which has no time to live, takes the id.
	local debris = { id = first.id, def = { name = "debris", type = "none" }, x = 0, y = 900, z = 0, vx = 0, vy = 0, vz = 0, moves = 0, damages = {} }
	world.projectiles[first.id] = debris
	run(world, player, 5)
	t.same("a projectile that took a dead shot's id is not moved", debris.moves, 0)
	t.same("the shot the engine ended is not made again on every frame", world.spawned, 1)
	t.same("and it is said once", said(world, "the engine ended a shot"), 1)
	seek(world, player, 151)
	t.same("after a seek it is made again", world.spawned, 2)

	world.projectiles[debris.id] = nil

	-- The engine hands a dead shot's id to the next one the player creates.
	local second = world.projectileNamed("rocket")
	world.projectiles[second.id] = nil
	world.nextProjectile = function()
		return second.id
	end
	seek(world, player, 165)
	t.same("a new shot can take a dead one's id", world.projectileNamed("rocket").id, second.id)
	t.same("and is the only one in the air, the dead one being spent", world.projectileCount(), 1)
	local kept = world.projectileNamed("rocket")
	run(world, player, 5)
	t.same("it is where the track has the second shot", kept.x, 2)
	t.same("the engine was told about nothing it no longer has", world.staleCalls, 0)
end

-- A shot alive across two windows is one projectile.

do
	local world, player, track = setup({ last = 2000, windowLength = 900, projectiles = { { weapon = ROCKET, first = 880, last = 930, at = flight(880, { 0, 50, 0 }, { 1, 0, 0 }) } } })
	send(player, "pause")
	seek(world, player, 890)
	local id = world.projectileNamed("rocket").id
	local loads = track.loads
	send(player, "play 1")
	run(world, player, 25)
	t.check("play crossed into the next window", track.loads > loads)
	t.same("a shot alive across two windows is the same projectile", (world.projectileNamed("rocket") or {}).id, id)
	t.same("where the track has it", (world.projectileNamed("rocket") or {}).x, 35)
	t.same("and it did not land at the window's end", #world.explosions, 0)
	run(world, player, 30)
	t.same("it lands at its own end", #world.explosions + world.projectileCount(), 0)
end

-- A frame of play allocates nothing.

do
	local shots = {}
	for n = 1, 40 do
		shots[n] = { weapon = n % 2 == 0 and ROCKET or SHELL, first = 100, last = 800, shooter = 1, at = flight(100, { n, 5000, 0 }, { 1, -1, 2 }) }
	end
	local world, player = setup({ last = 900, units = { { first = 0, last = 900 } }, projectiles = shots })
	send(player, "pause")
	seek(world, player, 120)
	send(player, "play 1")
	run(world, player, 2)
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first frames
	-- after it take that back, which is the interpreter's and not the player's.
	run(world, player, 2)
	local before = collectgarbage("count")
	run(world, player, 300)
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play with 40 shots in the air allocate nothing", after - before, 0)
	t.same("and they were in the air", world.projectileCount(), 40)

	send(player, "reverse")
	run(world, player, 2)
	collectgarbage()
	collectgarbage("stop")
	run(world, player, 2)
	before = collectgarbage("count")
	run(world, player, 250)
	after = collectgarbage("count")
	collectgarbage("restart")
	t.same("250 frames of play backward allocate nothing", after - before, 0)

	send(player, "pause")
	run(world, player, 2)
	collectgarbage()
	collectgarbage("stop")
	run(world, player, 2)
	before = collectgarbage("count")
	run(world, player, 100)
	after = collectgarbage("count")
	collectgarbage("restart")
	t.same("100 paused frames allocate nothing", after - before, 0)
end

t.report()
