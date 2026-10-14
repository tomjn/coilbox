-- Coilbox rewind player: the effect where a unit arrives or leaves (issues
-- #4009 and #4051).
--
-- A jump to another time makes and removes units, and each would pop in or out.
-- The unsynced half of the gadget draws an orb of light over each unit in view
-- while the player makes or removes it, as the transporter beam of Stargate.
-- The whole effect takes 0.5 seconds of the frame timer's clock, whatever the
-- rate the game draws at:
--
--   0 to 0.08 s    a small white orb appears at the unit and grows until it
--                  covers it. Quick, and a choice of how it looks.
--   0.08 to 0.4 s  it holds at full size, which is when the player makes or
--                  removes the unit under it, never before.
--   0.4 to 0.5 s   it goes up fast, at least its own size, and goes from
--                  opaque to clear. The 0.1 seconds are the design of issue
--                  #4051.
--
-- The orb never waits for the unit. If the player is behind, the unit appears
-- after the orb is gone.
--
-- The orb is a circle that faces the camera, whose middle is as opaque as can
-- be and which fades smoothly to nothing at its rim, so no edge shows. It is
-- drawn with gl.BeginEnd, gl.Vertex and gl.Color as quads, added to what is
-- behind it, with the depth test off so that nothing in front hides it. It has
-- no texture, no shader and nothing from the game, so it is the same in every
-- game. All of those calls are in the engine at 105.0 and at 2026.07.04. A
-- game's adapter can show the game's own effect instead (the `unitPlaced`
-- hook), and the player then takes the orb away.
--
-- An effect is a row in lists made once, and a draw allocates nothing. No more
-- than `M.MOST` are alive at once, and a unit past that has none.
--
-- The engine is handed in as a table, and nothing here reaches for a global of
-- it, so the tests run the same file on a stand-in.

local M = {}

--- How long the orb takes to grow, how long the whole effect lasts, and how
-- long it takes to rise and clear at the end, in seconds. The rise is the
-- design of issue #4051. The other two are a choice of how it looks, from the
-- owner's note that the whole effect is 0.5 seconds and the growing a small
-- part of it.
M.GROW = 0.08
M.LIFE = 0.5
M.FADE = 0.1

--- The most effects alive at once. The cost of a draw is in
-- lua/rewind-player/README.md, which is what this allows a drawn frame at the
-- worst.
M.MOST = 256

-- The shape. All of these are set by eye, none is measured or designed.
--
-- The orb's size, in the unit's size, which is the larger of its radius and
-- half its height. It starts at `START` of its size and ends at `COVER` times
-- the unit's. `CORE` of that is as opaque as the orb gets, and `COVER * CORE`
-- is over 1, so the opaque part covers the unit's height and width. The glow
-- is the rest.
M.START = 0.15
M.COVER = 2.2
M.CORE = 0.6
-- How far the orb rises, in its own size. Two is its diameter.
M.RISE = 2.2
-- The glow's bands, in the share of the way from the core to the rim, with how
-- opaque each edge is: a curve that bends to nothing at the rim.
local FALL = { 0, 1 / 3, 2 / 3, 1 }
local FALL_ALPHA = { 1, 4 / 9, 1 / 9, 0 }
local FALLS = 3
-- The disc is this many quads round.
local SEGMENTS = 14

local cos, sin, sqrt, pi = math.cos, math.sin, math.sqrt, math.pi

local DISC_COS, DISC_SIN = {}, {}
for k = 0, SEGMENTS do
	DISC_COS[k] = cos(k / SEGMENTS * 2 * pi)
	DISC_SIN[k] = sin(k / SEGMENTS * 2 * pi)
end

local Arrival = {}
Arrival.__index = Arrival

--- The orbs of every effect, called inside gl.BeginEnd for quads. The camera's
-- right is `rx, rz` (level with the ground) and its up is `ux, uy, uz`.
local function orbs(self, now, rx, rz, ux, uy, uz)
	local gl = self.gl
	local Color, Vertex = gl.Color, gl.Vertex
	local xs, ys, zs, sizes, born = self.x, self.y, self.z, self.size, self.born
	local grow, life, fade, start, rise, core = M.GROW, M.LIFE, M.FADE, M.START, M.RISE, M.CORE
	for i = 1, self.count do
		local seconds = now - born[i]
		local size, alpha, lift = sizes[i], 1, 0
		if seconds < grow then
			-- Quick at first, slowing as it reaches full size.
			local left = 1 - seconds / grow
			size = size * (start + (1 - start) * (1 - left * left))
		elseif seconds > life - fade then
			-- Up fast and then slowing, and clear as it goes.
			local gone = (seconds - (life - fade)) / fade
			alpha = 1 - gone
			lift = rise * size * (1 - (1 - gone) * (1 - gone))
		end
		local cx, cy, cz = xs[i], ys[i] + lift, zs[i]
		local rightX, rightZ = rx * size, rz * size
		local upX, upY, upZ = ux * size, uy * size, uz * size
		-- The core, then the bands of the glow, each as a ring of quads. The first
		-- ring has no inside, which makes its quads triangles.
		local inner, a0 = 0, alpha
		for band = 1, FALLS + 1 do
			local outer, a1
			if band == 1 then
				outer, a1 = core, alpha
			else
				outer = core + (1 - core) * FALL[band]
				a1 = alpha * FALL_ALPHA[band]
			end
			for k = 0, SEGMENTS - 1 do
				local c1, s1, c2, s2 = DISC_COS[k], DISC_SIN[k], DISC_COS[k + 1], DISC_SIN[k + 1]
				Color(1, 1, 1, a0)
				Vertex(cx + (rightX * c1 + upX * s1) * inner, cy + upY * s1 * inner, cz + (rightZ * c1 + upZ * s1) * inner)
				Vertex(cx + (rightX * c2 + upX * s2) * inner, cy + upY * s2 * inner, cz + (rightZ * c2 + upZ * s2) * inner)
				Color(1, 1, 1, a1)
				Vertex(cx + (rightX * c2 + upX * s2) * outer, cy + upY * s2 * outer, cz + (rightZ * c2 + upZ * s2) * outer)
				Vertex(cx + (rightX * c1 + upX * s1) * outer, cy + upY * s1 * outer, cz + (rightZ * c1 + upZ * s1) * outer)
			end
			inner, a0 = outer, a1
		end
	end
end

--- The effects of one engine. `engine` has the engine's `Spring`, `gl`, `GL`
-- and `UnitDefs`, and `seconds`, a function that gives a time in seconds that
-- only goes forward.
function M.new(engine)
	return setmetatable({
		Spring = engine.Spring,
		gl = engine.gl,
		GL = engine.GL,
		UnitDefs = engine.UnitDefs,
		seconds = engine.seconds,
		count = 0,
		key = {},
		x = {},
		y = {},
		z = {},
		size = {},
		born = {},
		-- When the last orb that the units stage waits for was made, and whether
		-- the stage has been told it is full.
		fullAt = nil,
		-- Called with an orb's key and how old it was when it was taken out, for a
		-- scratch run that measures the times. Nothing sets it in a game.
		trace = nil,
	}, Arrival)
end

--- An orb for a unit of the definition `defID` whose base is at `x, y, z`,
-- found by `key`. Past the most at once it gets none, and neither does a
-- definition the engine cannot give the size of. `gated` is whether the units
-- stage is holding units for it, which `poll` then says when the orb is full.
function Arrival:add(key, defID, x, y, z, gated)
	local i = self.count + 1
	if i > M.MOST then
		return
	end
	local def = self.UnitDefs[defID]
	local radius, height = def and def.radius, def and def.height
	if not radius or not height then
		return
	end
	local now = self.seconds()
	self.count = i
	self.key[i] = key
	self.x[i], self.z[i] = x, z
	-- Round the middle of the unit, with a size that reaches the ground and
	-- covers the unit's height and width.
	self.y[i] = y + height / 2
	self.size[i] = M.COVER * (radius > height / 2 and radius or height / 2)
	self.born[i] = now
	if gated then
		self.fullAt = now + M.GROW
	end
end

--- Takes the orb of `key` away at once, for a unit whose game shows its own.
function Arrival:cancel(key)
	local keys = self.key
	for i = 1, self.count do
		if keys[i] == key then
			self:drop(i)
			return
		end
	end
end

--- True once, when the orbs the units stage is holding units for have all
-- grown full.
function Arrival:poll()
	local at = self.fullAt
	if at and self.seconds() >= at then
		self.fullAt = nil
		return true
	end
	return false
end

--- Takes effect `i` out by putting the last in its place.
function Arrival:drop(i)
	local n = self.count
	self.key[i] = self.key[n]
	self.x[i], self.y[i], self.z[i], self.size[i] = self.x[n], self.y[n], self.z[n], self.size[n]
	self.born[i] = self.born[n]
	self.count = n - 1
end

--- Draws every effect, from the gadget's `DrawWorld`, where a vertex is a
-- place in the world.
function Arrival:draw()
	if self.count == 0 then
		return
	end
	local now = self.seconds()
	local born = self.born
	local trace = self.trace
	local i = 1
	while i <= self.count do
		if now - born[i] >= M.LIFE then
			if trace then
				trace(self.key[i], now - born[i])
			end
			self:drop(i)
		else
			i = i + 1
		end
	end
	if self.count == 0 then
		return
	end

	-- The camera's right, level with the ground, and its up. A camera that
	-- looks straight down has no right of its own, and any will do.
	local dx, dy, dz = self.Spring.GetCameraDirection()
	local rx, rz = -dz, dx
	local length = sqrt(rx * rx + rz * rz)
	if length < 0.001 then
		rx, rz = 1, 0
	else
		rx, rz = rx / length, rz / length
	end
	local ux, uy, uz = -rz * dy, rz * dx - rx * dz, rx * dy

	local gl, GL = self.gl, self.GL
	gl.Texture(false)
	gl.DepthTest(false)
	gl.DepthMask(false)
	-- Light adds to what is behind it, and the core is enough to whiten a unit.
	gl.Blending(GL.SRC_ALPHA, GL.ONE)
	gl.BeginEnd(GL.QUADS, orbs, self, now, rx, rz, ux, uy, uz)
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.DepthTest(true)
	gl.DepthMask(true)
	gl.Color(1, 1, 1, 1)
end

return M
