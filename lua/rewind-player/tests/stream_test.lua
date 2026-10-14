-- A builder's stream of build particles (issue #4029). The engine draws one
-- only while a builder really builds, and no unit of a playback does, so the
-- unsynced half of the gadget draws it from the work the animation stage hands
-- on. Every particle is the engine's nano particle (AddNanoParticle in
-- rts/Sim/Projectiles/ProjectileHandler.cpp): where it starts, the way and the
-- speed it goes, how long it lives and its colour. Its place is worked out
-- from the time of the track, so paused it stands still and played backward it
-- goes back.
--
-- All of it on a stand-in for `Spring` and `gl` (unsynced.lua). None of it
-- shows how the stream looks.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Unsynced = dofile(here .. "/unsynced.lua")
local Stream = t.load("coilbox_player_stream.lua", t.unsyncedEnv())

local MAX_UNITS = 32000
local CMD = { REPAIR = 40, RECLAIM = 90, RESURRECT = 125, CAPTURE = 130, RESTORE = 110 }

-- The definitions: an engineer, a factory, one with no spray and a hut.
local ENGINEER, PLANT, QUIET, HUT = 1, 2, 3, 4
local DEFS = {
	[ENGINEER] = { isFactory = false, showNanoSpray = true, nanoColorR = 0.2, nanoColorG = 0.7, nanoColorB = 0.2 },
	[PLANT] = { isFactory = true, showNanoSpray = true, nanoColorR = 0.2, nanoColorG = 0.7, nanoColorB = 0.2 },
	[QUIET] = { isFactory = false, showNanoSpray = false, nanoColorR = 0.2, nanoColorG = 0.7, nanoColorB = 0.2 },
	[HUT] = { isFactory = false, showNanoSpray = true, nanoColorR = 0.2, nanoColorG = 0.7, nanoColorB = 0.2 },
}

--- A stand-in with a builder (id 7, team 1) whose one nano piece is at
-- 0, 10, 0, and a hut (id 8) whose middle is 90 elmos along x from it, with a
-- radius of 20. Playing forward at 1x at frame 1000.
local function scene(def)
	local e = Unsynced.new()
	e.units[7] = { def = def or ENGINEER, team = 1, x = 0, y = 0, z = 0, radius = 15, pieces = { 2 }, at = { [2] = { 0, 10, 0 } } }
	e.units[8] = { def = HUT, team = 1, x = 90, y = 0, z = 0, mx = 90, my = 10, mz = 0, radius = 20 }
	e.colours[1] = { 1, 0, 0 }
	e.rules.coilbox_rewind_frame = 1000
	e.rules.coilbox_rewind_playing = 1
	e.rules.coilbox_rewind_direction = 1
	e.rules.coilbox_rewind_speed = 1
	-- Room for so many that next to none is thinned out, so a count is exact.
	e.config.MaxNanoParticles = 1000000
	local stream = Stream.new({ Spring = e.Spring, gl = e.gl, GL = e.GL, UnitDefs = DEFS, CMD = CMD, maxUnits = MAX_UNITS, texture = "bitmaps/thingy.tga" })
	-- Every particle drawn: its place and its builder.
	local seen = {}
	stream.at = function(x, y, z, unitID, born)
		seen[#seen + 1] = { x, y, z, unitID, born }
	end
	local function draw(frame, offset)
		for k = #seen, 1, -1 do
			seen[k] = nil
		end
		e.rules.coilbox_rewind_frame = frame or e.rules.coilbox_rewind_frame
		e.offset = offset or 0
		e.clear()
		stream:draw()
		return seen
	end
	return e, stream, draw
end

--- The places of `seen` as one text, to compare two draws.
local function places(seen)
	local parts = {}
	for k, p in ipairs(seen) do
		parts[k] = string.format("%.4f,%.4f,%.4f", p[1], p[2], p[3])
	end
	table.sort(parts)
	return table.concat(parts, " ")
end

--- How far `p` is from the line from `a` to `b`, and how far along it, as a
-- share of its length.
local function fromLine(p, a, b)
	local dx, dy, dz = b[1] - a[1], b[2] - a[2], b[3] - a[3]
	local length = math.sqrt(dx * dx + dy * dy + dz * dz)
	local ux, uy, uz = dx / length, dy / length, dz / length
	local px, py, pz = p[1] - a[1], p[2] - a[2], p[3] - a[3]
	local along = px * ux + py * uy + pz * uz
	local ox, oy, oz = px - along * ux, py - along * uy, pz - along * uz
	return math.sqrt(ox * ox + oy * oy + oz * oz), along / length
end

-- A builder at work, seen after a seek: the whole stream is there at once. The
-- piece is 90 elmos from the hut's middle, so a particle lives 30 frames
-- (int(len / 3)) and one is made on each frame at full power.

do
	local e, stream, draw = scene()
	t.same("with no builder at work a draw does nothing", #draw() + #e.state, 0)
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	local seen = draw()
	t.same("after a seek into the work the whole stream is there: a particle from each of the last 30 frames", #seen, 30)
	t.same("each a quad", e.vertices, 120)
	t.same("with a place in the texture for each corner", e.texCoords, 120)
	local worst, nearest, furthest = 0, 1, 0
	for _, p in ipairs(seen) do
		local off, along = fromLine(p, { 0, 10, 0 }, { 90, 10, 0 })
		worst = math.max(worst, off)
		nearest, furthest = math.min(nearest, along), math.max(furthest, along)
	end
	-- The engine spreads a particle by a random vector no longer than the
	-- target's radius over the distance, times half the radius for a build
	-- (CBuilder::UpdateBuild), so it ends at most that far from the middle.
	t.check("every particle is within half the hut's radius of the line from the piece to the hut", worst <= 10 + 1e-6, worst)
	t.check("the newest is at the piece", nearest < 0.05, nearest)
	t.check("and the oldest nearly at the hut", furthest > 0.9 and furthest <= 1.05, furthest)
	t.same("they are the builder's", seen[1][4], 7)
end

-- The engine's colour: the team's, at an alpha of 20 in 255, with
-- TeamNanoSpray on, which is the engine's default with a window, and the
-- definition's nanoColor at 20 in 256 with it off. Blended as the engine
-- blends its particles, one and one less the alpha, with no depth written.

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	draw()
	local state = table.concat(e.state, " | ")
	t.check("it draws with the engine's blending", state:find("Blending 1 771", 1, true) ~= nil, state)
	t.check("with the texture", state:find("Texture bitmaps/thingy.tga", 1, true) ~= nil, state)
	t.check("writes no depth while it draws", state:find("DepthMask false", 1, true) ~= nil, state)
	t.check("and puts the state back", state:find("DepthMask true", 1, true) ~= nil and state:find("Texture false", 1, true) ~= nil, state)
	t.same("in the team's colour", e.colourSum[1] / e.coloured, 1)
	t.near("at the engine's alpha", e.drawnAlpha, 20 / 255, 1e-9)
	e.config.TeamNanoSpray = 0
	draw()
	t.near("with the team's colour switched off, the definition's", e.colourSum[2] / e.coloured, 0.7, 1e-9)
	t.near("at the alpha the engine gives it", e.drawnAlpha, 20 / 256, 1e-9)
end

-- The engine's own settings say whether it draws them.

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	e.config.MaxNanoParticles = 0
	t.same("with MaxNanoParticles at 0, as a game that draws its own sets it, nothing is drawn", #draw(), 0)
	e.config.MaxNanoParticles = 10
	local n = #draw()
	t.check("with room for 10, no more are drawn", n > 0 and n <= 10, n)
	e.config.MaxNanoParticles = nil
	draw()
	n = #draw()
	t.check("without the setting, the engine's default of 2000 leaves room for nearly all", n >= 28 and n <= 30, n)
end

do
	local _, stream, draw = scene(QUIET)
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	t.same("a builder whose definition has showNanoSpray false draws none", #draw(), 0)
end

do
	local e, stream, draw = scene()
	e.units[7].pieces = nil
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	t.same("a builder the engine has no nano piece for draws none, as in the engine", #draw(), 0)
end

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	e.inView = false
	t.same("a stream out of view is not drawn", #draw(), 0)
end

-- Paused, the stream stands still. Playing, a particle is drawn between frames
-- where it is by the time since the last simulation frame.

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	local still = places(draw(1000, 0))
	e.rules.coilbox_rewind_playing = 0
	t.same("paused, the stream is where it was", places(draw(1000, 0.5)), still)
	t.same("on every drawn frame", places(draw(1000, 0.9)), still)
	e.rules.coilbox_rewind_playing = 1
	t.check("playing, it moves between frames", places(draw(1000, 0.5)) ~= still)
	t.same("to where the next frame has it", places(draw(1000, 1)), places(draw(1001, 0)))
end

-- Where a particle is depends only on the time shown, so played backward the
-- stream goes back the way it came.

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	local forward = places(draw(1010))
	draw(1020)
	e.rules.coilbox_rewind_direction = -1
	t.same("played back to a frame, the stream is as it was going forward", places(draw(1010)), forward)
	local function bornAt(seen, frame)
		for _, p in ipairs(seen) do
			if p[5] == frame then
				return p[1]
			end
		end
	end
	local at = bornAt(draw(1010, 0), 1000)
	local between = bornAt(draw(1010, 0.5), 1000)
	t.check("and between frames backward a particle goes back toward the piece", at and between and between < at, tostring(at) .. " then " .. tostring(between))
end

-- Starting, stopping and seeks.

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 0)
	t.same("work that starts while playing forward has only its first particle", #draw(1000), 1)
	t.same("and one more each frame", #draw(1005), 6)
	stream:work(7, 0, -1, 0, 90, 0, 0, 1010, 0)
	t.same("work that stops makes no more, and what is in the air flies on", #draw(1015), 10)
	t.same("until the last has lived its 30 frames", #draw(1038), 1)
	t.same("then there is none", #draw(1039), 0)
	t.same("and the builder is forgotten", stream:power(7), nil)
end

do
	local e, stream, draw = scene()
	e.rules.coilbox_rewind_direction = -1
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 0)
	t.same("played backward into work, the stream is whole at once, as it was at its end", #draw(1000), 30)
	stream:work(7, 0, -1, 0, 90, 0, 0, 979, 0)
	t.same("played backward toward its start, only the particles born since it", #draw(985), 6)
	t.same("and the first goes back into the piece", #draw(980), 1)
	t.same("then none", #draw(979), 0)
end

do
	local _, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 0)
	draw(1003)
	stream:work(7, 0, -1, 0, 90, 0, 0, 2000, 1)
	t.same("a seek to no work takes the stream away at once", #draw(2000), 0)
end

-- What the work is.

do
	local e, stream, draw = scene(PLANT)
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	local seen = draw()
	-- A factory's particle goes 1 elmo a frame and lives int(len) frames, with a
	-- spread of 0.15 (CFactory::CreateNanoParticle and the first AddNanoParticle).
	t.same("a factory's stream has a particle from each of the last 90 frames", #seen, 90)
	local worst = 0
	for _, p in ipairs(seen) do
		worst = math.max(worst, (fromLine(p, { 0, 10, 0 }, { 90, 10, 0 })))
	end
	t.check("each within 0.15 of its way along the line", worst <= 0.15 * 90 + 1e-6, worst)
end

do
	local e, stream, draw = scene()
	stream:work(7, CMD.RECLAIM, 8, 1, 90, 0, 0, 1000, 0)
	local first = draw(1000)[1]
	local _, along = fromLine(first, { 0, 10, 0 }, { 90, 10, 0 })
	t.check("a reclaim's first particle starts at the hut and comes back", along > 0.8, along)
end

do
	local e, stream, draw = scene()
	e.features[11] = { x = 0, y = 10, z = 60, radius = 10 }
	stream:work(7, CMD.RESURRECT, 11 + MAX_UNITS, 1, 0, 10, 60, 1000, 1)
	local seen = draw()
	local worst = 0
	for _, p in ipairs(seen) do
		worst = math.max(worst, (fromLine(p, { 0, 10, 0 }, { 0, 10, 60 })))
	end
	t.same("a feature is found past the unit ids, and a resurrect's stream lives int(60 / 3) frames", #seen, 20)
	t.check("along the line to the feature", worst <= 7 + 1e-6, worst)
end

do
	local _, stream, draw = scene()
	stream:work(7, -HUT, -1, 1, 0, 10, 60, 1000, 1)
	local seen = draw()
	t.same("a target the playback does not have yet takes the work's place", #seen, 20)
end

do
	local _, stream, draw = scene()
	stream:work(7, -HUT, 8, 0.5, 90, 0, 0, 1000, 1)
	local total, frames = 0, 0
	for frame = 1000, 2000, 7 do
		total = total + #draw(frame)
		frames = frames + 1
	end
	-- The recorded power is the share of the last 15 frames the engine made a
	-- particle on (NanoPieceCache::GetBuildPower).
	local share = total / frames / 30
	t.check("at half power about half the frames make a particle", share > 0.4 and share < 0.6, share)
end

do
	local e, stream, draw = scene()
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	e.units[7] = nil
	t.same("a builder that is gone draws nothing", #draw(), 0)
	t.same("and is forgotten", stream:power(7), nil)
	stream:work(9, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	stream:drop(9)
	t.same("a builder that is dropped is forgotten", stream:power(9), nil)
end

-- The answers a game's own build effect asks the engine for.

do
	local e, stream = scene()
	t.same("a unit not at work has no answer", stream:task(7), nil)
	stream:work(7, -HUT, 8, 0.6, 90, 0, 0, 1000, 1)
	local command, target = stream:task(7)
	t.same("a builder at work gives its command", command, -HUT)
	t.same("and its target", target, 8)
	t.same("and, playing forward, its power", stream:power(7), 0.6)
	e.rules.coilbox_rewind_playing = 0
	t.same("paused it gives no power, so a game's stream does not flow", stream:power(7), 0)
	t.same("and the same task", (stream:task(7)), -HUT)
	e.rules.coilbox_rewind_playing = 1
	e.rules.coilbox_rewind_direction = -1
	t.same("played backward, no power", stream:power(7), 0)
	stream:work(7, CMD.RESTORE, -1, 1, 5, 6, 7, 1000, 1)
	command, target = stream:task(7)
	t.same("terraforming gives the command", command, CMD.RESTORE)
	t.same("and no target, as the engine gives none", target, nil)
	stream:work(7, -HUT, -1, 1, 5, 6, 7, 1000, 1)
	t.same("a build whose unit the playback does not have yet has no answer", stream:task(7), nil)
end

-- Which texture the engine's particle has: the game's `gfxtexture` from its
-- gamedata/resources.lua, and `circularthingy` when it has none
-- (CProjectileDrawer::Init), with the folder names in any case.

do
	t.same("the game's gfxtexture", Stream.textureOf({ graphics = { projectileTextures = { gfxtexture = "a.tga", circularthingy = "b.tga" } } }), "bitmaps/a.tga")
	t.same("circularthingy without one", Stream.textureOf({ Graphics = { projectiletextures = { CircularThingy = "b.tga" } } }), "bitmaps/b.tga")
	t.same("nothing without either", Stream.textureOf({ graphics = { projectiletextures = {} } }), nil)
	t.same("nothing for a table that is not one", Stream.textureOf(nil), nil)
end

do
	local e, stream, draw = scene()
	e.noTexture = "bitmaps/thingy.tga"
	stream:work(7, -HUT, 8, 1, 90, 0, 0, 1000, 1)
	t.same("a texture the engine cannot load still draws the particles", #draw(), 30)
end

-- Drawing allocates nothing.

do
	local e, stream, draw = scene()
	for id = 20, 39 do
		e.units[id] = { def = id % 2 == 0 and ENGINEER or PLANT, team = 1, x = id, y = 0, z = 0, pieces = { 1, 2 }, at = { [1] = { id, 10, 0 }, [2] = { id, 12, 3 } } }
		stream:work(id, -HUT, 8, 0.8, 90, 0, 0, 1000, 1)
	end
	stream.at = nil
	local nothing = function() end
	local gl = e.gl
	gl.Blending, gl.DepthTest, gl.DepthMask, gl.Texture, gl.Color, gl.TexCoord = nothing, nothing, nothing, nothing, nothing, nothing
	gl.Vertex = nothing
	gl.BeginEnd = function(_, fn, ...)
		fn(...)
	end
	local function draws()
		for n = 1, 300 do
			e.rules.coilbox_rewind_frame = 1000 + n
			e.offset = (n % 10) / 10
			stream:draw()
		end
	end
	draws()
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the draws after it
	-- take that back, which is the interpreter's and not the stream's. LuaJIT
	-- 2.1.0-beta3 on x64 took 1.2 kB more in the first measured batch after one
	-- batch of this, which is less than one table and does not grow with the
	-- draws, so it takes two.
	draws()
	draws()
	local before = collectgarbage("count")
	draws()
	local grew = collectgarbage("count") - before
	collectgarbage("restart")
	t.same("300 draws of twenty streams allocate nothing", grew, 0)
end

t.report()
