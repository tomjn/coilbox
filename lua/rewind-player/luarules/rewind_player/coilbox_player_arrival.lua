-- Coilbox rewind player: the effect where a unit arrives (issues #4009 and
-- #4051).
--
-- A jump to another time makes the units of that time, and each would pop into
-- place. The player asks for an effect for each unit a jump makes in view, and
-- the unsynced half of the gadget draws it here as the transporter beam of
-- Stargate: a small white orb appears at the unit, grows over 0.25 seconds
-- until it covers the unit, then goes up fast over 0.1 seconds and turns from
-- opaque to clear, travelling at least its own size in that time. The unit
-- stands under it all along. The two times are the design (issue #4051) and the
-- rest of the shape is a choice of how it looks. It is drawn beside the unit
-- and never touches how the unit itself is drawn, which a game does in its own
-- way.
--
-- It is drawn with gl.BeginEnd, gl.Vertex and gl.Color, with no texture, no
-- shader and nothing from the game, so it is the same in every game. The orb is
-- a disc that faces the camera, as rings of quads whose colour runs from opaque
-- at the middle to clear at the edge, which is the glow. All of those calls are
-- in the engine at 105.0 and at 2026.07.04. A game's adapter can show the
-- game's own effect instead (the `unitPlaced` hook), and the player then asks
-- for none.
--
-- An effect is a row in lists made once, and a draw allocates nothing. No more
-- than `M.MOST` are alive at once, and a unit that arrives past that has none.
--
-- The engine is handed in as a table, and nothing here reaches for a global of
-- it, so the tests run the same file on a stand-in.

local M = {}

--- How long the orb grows, and how long it takes to rise and clear, in
-- seconds. The design of issue #4051.
M.GROW = 0.25
M.FADE = 0.1

--- How long an effect lasts, in seconds.
M.LIFE = M.GROW + M.FADE

--- The most effects alive at once. The cost of a draw is in
-- lua/rewind-player/README.md, which is what this allows a drawn frame at the
-- worst.
M.MOST = 256

-- The shape. All of these are set by eye, none is measured or designed.
--
-- The orb's size, in the unit's radius: where it starts and where it ends.
-- `COVER` is wide enough that the opaque part, which is `CORE` of the orb, is as
-- wide as the unit.
M.START = 0.15
M.COVER = 1.25
M.CORE = 0.85
-- How far the orb rises, in its own radius. Two is its own size.
M.RISE = 2.4
-- Where the glow's bands end, in the orb's radius, and how opaque it is at the
-- inner and outer edge of each. The middle band bends the fall off.
local EDGES = { 0, M.CORE, 0.86, 1 }
local ALPHAS = { 1, 1, 0.5, 0 }
local BANDS = 3
-- The disc is this many quads round.
local SEGMENTS = 20

local cos, sin, sqrt, pi = math.cos, math.sin, math.sqrt, math.pi

local DISC_COS, DISC_SIN = {}, {}
for k = 0, SEGMENTS do
	DISC_COS[k] = cos(k / SEGMENTS * 2 * pi)
	DISC_SIN[k] = sin(k / SEGMENTS * 2 * pi)
end

local Arrival = {}
Arrival.__index = Arrival

--- The orbs of every effect, called inside gl.BeginEnd for quads. The camera's
-- right is `rx, rz` (level with the ground), its up is `ux, uy, uz` and the way
-- it looks is `dx, dy, dz`.
local function orbs(self, now, rx, rz, ux, uy, uz, dx, dy, dz)
	local gl = self.gl
	local Color, Vertex = gl.Color, gl.Vertex
	local xs, ys, zs, radii, born, bases = self.x, self.y, self.z, self.radius, self.born, self.base
	local grow, fade, start, cover, rise = M.GROW, M.FADE, M.START, M.COVER, M.RISE
	for i = 1, self.count do
		local seconds = now - born[i]
		local radius = radii[i]
		local size, alpha, lift
		if seconds < grow then
			-- Quick at first, slowing as it reaches the unit's size.
			local left = 1 - seconds / grow
			size = radius * (start + (cover - start) * (1 - left * left))
			alpha, lift = 1, 0
		else
			local gone = (seconds - grow) / fade
			size = radius * cover
			alpha, lift = 1 - gone, gone * rise * size
		end
		-- Nearer the camera than the unit by the orb's full radius, so that the
		-- depth test hides the orb neither behind the unit it covers nor in the
		-- ground below it.
		local near = radius * cover
		local cx = xs[i] - dx * near
		-- And no lower than its own radius above the unit's base, so that the
		-- ground does not cut the bottom off the orb.
		local base = bases[i] + size
		local middle = ys[i]
		local cy = (middle > base and middle or base) + lift - dy * near
		local cz = zs[i] - dz * near
		local rightX, rightZ = rx * size, rz * size
		local upX, upY, upZ = ux * size, uy * size, uz * size
		for band = 1, BANDS do
			local inner, outer = EDGES[band], EDGES[band + 1]
			local a0, a1 = ALPHAS[band] * alpha, ALPHAS[band + 1] * alpha
			for k = 0, SEGMENTS - 1 do
				local c1, s1, c2, s2 = DISC_COS[k], DISC_SIN[k], DISC_COS[k + 1], DISC_SIN[k + 1]
				Color(1, 1, 1, a0)
				Vertex(cx + (rightX * c1 + upX * s1) * inner, cy + upY * s1 * inner, cz + (rightZ * c1 + upZ * s1) * inner)
				Vertex(cx + (rightX * c2 + upX * s2) * inner, cy + upY * s2 * inner, cz + (rightZ * c2 + upZ * s2) * inner)
				Color(1, 1, 1, a1)
				Vertex(cx + (rightX * c2 + upX * s2) * outer, cy + upY * s2 * outer, cz + (rightZ * c2 + upZ * s2) * outer)
				Vertex(cx + (rightX * c1 + upX * s1) * outer, cy + upY * s1 * outer, cz + (rightZ * c1 + upZ * s1) * outer)
			end
		end
	end
end

--- The effects of one engine. `engine` has the engine's `Spring`, `gl` and
-- `GL`, and `seconds`, a function that gives a time in seconds that only goes
-- forward.
function M.new(engine)
	return setmetatable({
		Spring = engine.Spring,
		gl = engine.gl,
		GL = engine.GL,
		seconds = engine.seconds,
		count = 0,
		x = {},
		y = {},
		z = {},
		radius = {},
		born = {},
		base = {},
	}, Arrival)
end

--- A unit arrived at `x, y, z`. Past the most at once it gets no effect, and
-- neither does a unit the engine cannot give the size or the middle of. The
-- orb is round the unit's middle, which is `lift` above its base.
function Arrival:add(unitID, x, y, z)
	local i = self.count + 1
	if i > M.MOST then
		return
	end
	local Spring = self.Spring
	local radius = Spring.GetUnitRadius(unitID)
	if not radius then
		return
	end
	local _, baseY, _, _, middleY = Spring.GetUnitPosition(unitID, true)
	if not middleY then
		return
	end
	self.count = i
	self.x[i], self.y[i] = x, y + (middleY - baseY)
	self.z[i], self.radius[i] = z, radius
	self.base[i] = y
	self.born[i] = self.seconds()
end

--- Takes effect `i` out by putting the last in its place.
local function drop(self, i)
	local n = self.count
	self.x[i], self.y[i], self.z[i], self.radius[i] = self.x[n], self.y[n], self.z[n], self.radius[n]
	self.born[i], self.base[i] = self.born[n], self.base[n]
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
	local i = 1
	while i <= self.count do
		if now - born[i] >= M.LIFE then
			drop(self, i)
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
	gl.DepthTest(true)
	gl.DepthMask(false)
	-- The orb covers what is behind it where it is opaque.
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.BeginEnd(GL.QUADS, orbs, self, now, rx, rz, ux, uy, uz, dx, dy, dz)
	gl.DepthMask(true)
	gl.Color(1, 1, 1, 1)
end

return M
