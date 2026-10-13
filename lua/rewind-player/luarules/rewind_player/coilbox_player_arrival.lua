-- Coilbox rewind player: the effect where a unit arrives (issue #4009).
--
-- A seek in a large match takes many frames to show, and each unit would pop
-- into place. The player asks for an effect for each unit a slow seek makes in
-- view, and the unsynced half of the gadget draws it here: a column of light
-- that fades, a ring on the ground that closes on the unit, and dots in the
-- team's colour that fall into it. It is drawn beside the unit and never
-- touches how the unit itself is drawn, which a game does in its own way.
--
-- It is drawn with gl.BeginEnd, gl.Vertex and gl.Color, with no texture, no
-- shader and nothing from the game, so it is the same in every game. All of
-- those are in the engine at 105.0 and at 2026.07.04. A game's adapter can
-- show the game's own effect instead (the `unitPlaced` hook), and the player
-- then asks for none.
--
-- An effect is a row in lists made once, and a draw allocates nothing. No more
-- than `M.MOST` are alive at once, and a unit that arrives past that has none.
--
-- The engine is handed in as a table, and nothing here reaches for a global of
-- it, so the tests run the same file on a stand-in.

local M = {}

--- How long an effect lasts, in seconds. A choice, not a measurement: long
-- enough to be seen and short next to the seconds a large seek takes.
M.LIFE = 0.9

--- The most effects alive at once. A draw of 256 took 3.6 ms in an engine with
-- a window, which is what this allows a drawn frame at the worst.
-- lua/rewind-player/README.md has the figures.
M.MOST = 256

--- How far from the unit an effect reaches, in the unit's radius.
M.REACH = 2.5

--- The widest the ring's line is, in elmos, which is its width round a unit
-- of no size at all. A test adds it to the reach.
M.LINE = 2

-- The shape, in the unit's radius. All of these are choices of how it looks.
local BEAM_HEIGHT = 2.4
local BEAM_WIDTH = 0.3
local RING_FROM, RING_TO = 1.3, 0.85
-- The ring's line and half the side of a dot, in elmos: a part that every unit
-- has and a part that grows with the unit, so that a small unit's can still be
-- seen and a large one's are not slabs.
local RING_BAND = 0.06
local RING_LIFT = 0.1
local DOT_FROM = 1.25
local DOT_HEIGHT = 1.4
local DOT_SIZE, DOT_GROWS = 1.5, 0.02

-- The ring is SEGMENTS quads, and DOTS dots fall in.
local SEGMENTS = 24
local DOTS = 16

local cos, sin, sqrt, pi = math.cos, math.sin, math.sqrt, math.pi

local RING_COS, RING_SIN = {}, {}
for k = 0, SEGMENTS do
	RING_COS[k] = cos(k / SEGMENTS * 2 * pi)
	RING_SIN[k] = sin(k / SEGMENTS * 2 * pi)
end

-- Where each dot starts round the unit, how high, how far out and how bright,
-- spread by the golden angle so that no two fall together.
local DOT_COS, DOT_SIN, DOT_HIGH, DOT_OUT, DOT_SHADE = {}, {}, {}, {}, {}
for k = 1, DOTS do
	local angle = k * 2.399963
	DOT_COS[k], DOT_SIN[k] = cos(angle), sin(angle)
	DOT_HIGH[k] = (k * 0.618034) % 1
	DOT_OUT[k] = 0.35 + 0.65 * ((k * 0.381966) % 1)
	DOT_SHADE[k] = 0.8 + 0.35 * ((k * 0.754877) % 1)
end

local Arrival = {}
Arrival.__index = Arrival

--- The light of every effect: the column and the ring. Called inside
-- gl.BeginEnd for quads, with the camera's right as `rx, rz`.
local function glow(self, now, rx, rz)
	local gl = self.gl
	local Color, Vertex = gl.Color, gl.Vertex
	local xs, ys, zs, radii, born = self.x, self.y, self.z, self.radius, self.born
	local reds, greens, blues = self.red, self.green, self.blue
	for i = 1, self.count do
		local p = (now - born[i]) / M.LIFE
		local x, y, z, radius = xs[i], ys[i], zs[i], radii[i]
		-- Lightened, so that a dark team colour still shows.
		local r, g, b = 0.5 + 0.5 * reds[i], 0.5 + 0.5 * greens[i], 0.5 + 0.5 * blues[i]

		-- The column: widest and brightest as the unit appears, clear at its top
		-- and at both sides, so that it has no edge.
		local fade = (1 - p) * (1 - p)
		local half = radius * BEAM_WIDTH * (0.3 + 0.7 * (1 - p))
		local top = y + radius * BEAM_HEIGHT
		local core = 0.9 * fade
		Color(r, g, b, 0)
		Vertex(x - rx * half, y, z - rz * half)
		Color(1, 1, 1, core)
		Vertex(x, y, z)
		Color(r, g, b, 0)
		Vertex(x, top, z)
		Vertex(x - rx * half, top, z - rz * half)
		Color(1, 1, 1, core)
		Vertex(x, y, z)
		Color(r, g, b, 0)
		Vertex(x + rx * half, y, z + rz * half)
		Vertex(x + rx * half, top, z + rz * half)
		Vertex(x, top, z)

		-- The ring: it closes on the unit, quickly at first, and is clear at
		-- its outer edge.
		local closed = 1 - (1 - p) * (1 - p)
		local inner = radius * (RING_FROM + (RING_TO - RING_FROM) * closed)
		local outer = inner + M.LINE + radius * RING_BAND
		local alpha = 0.9 * (1 - p) * (p < 0.15 and p / 0.15 or 1)
		local ground = y + radius * RING_LIFT
		for k = 0, SEGMENTS - 1 do
			local c1, s1, c2, s2 = RING_COS[k], RING_SIN[k], RING_COS[k + 1], RING_SIN[k + 1]
			Color(r, g, b, alpha)
			Vertex(x + c1 * inner, ground, z + s1 * inner)
			Vertex(x + c2 * inner, ground, z + s2 * inner)
			Color(r, g, b, 0)
			Vertex(x + c2 * outer, ground, z + s2 * outer)
			Vertex(x + c1 * outer, ground, z + s1 * outer)
		end
	end
end

--- The dots of every effect, which fall into the unit. Each is a square that
-- faces the camera, whose right is `rx, rz` and whose up is `ux, uy, uz`.
local function dots(self, now, rx, rz, ux, uy, uz)
	local gl = self.gl
	local Color, Vertex = gl.Color, gl.Vertex
	local xs, ys, zs, radii, born = self.x, self.y, self.z, self.radius, self.born
	local reds, greens, blues = self.red, self.green, self.blue
	local turnCos, turnSin = self.turnCos, self.turnSin
	for i = 1, self.count do
		local p = (now - born[i]) / M.LIFE
		local x, y, z, radius = xs[i], ys[i], zs[i], radii[i]
		local r, g, b = reds[i], greens[i], blues[i]
		local tc, ts = turnCos[i], turnSin[i]
		local left = 1 - p
		local out = radius * DOT_FROM * left * sqrt(left)
		local size = (DOT_SIZE + radius * DOT_GROWS) * (0.5 + 0.5 * left)
		local alpha = p < 0.7 and 1 or (1 - p) / 0.3
		local sx, sz, tx, ty, tz = rx * size, rz * size, ux * size, uy * size, uz * size
		for k = 1, DOTS do
			-- Each effect is turned by its own angle, so two side by side differ.
			local c = DOT_COS[k] * tc - DOT_SIN[k] * ts
			local s = DOT_SIN[k] * tc + DOT_COS[k] * ts
			local reach = out * DOT_OUT[k] + radius * 0.15
			local dx = x + c * reach
			local dy = y + radius * (0.3 + DOT_HEIGHT * DOT_HIGH[k] * left)
			local dz = z + s * reach
			local shade = DOT_SHADE[k]
			local red, green, blue = r * shade, g * shade, b * shade
			Color(red < 1 and red or 1, green < 1 and green or 1, blue < 1 and blue or 1, alpha)
			Vertex(dx - sx - tx, dy - ty, dz - sz - tz)
			Vertex(dx + sx - tx, dy - ty, dz + sz - tz)
			Vertex(dx + sx + tx, dy + ty, dz + sz + tz)
			Vertex(dx - sx + tx, dy + ty, dz - sz + tz)
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
		red = {},
		green = {},
		blue = {},
		born = {},
		turnCos = {},
		turnSin = {},
	}, Arrival)
end

--- A unit arrived at `x, y, z`. Past the most at once it gets no effect, and
-- neither does a unit the engine cannot give the size of.
function Arrival:add(unitID, x, y, z, team)
	local i = self.count + 1
	if i > M.MOST then
		return
	end
	local Spring = self.Spring
	local radius = Spring.GetUnitRadius(unitID)
	if not radius then
		return
	end
	local r, g, b = Spring.GetTeamColor(team)
	if not r then
		r, g, b = 0.8, 0.9, 1
	end
	self.count = i
	self.x[i], self.y[i], self.z[i], self.radius[i] = x, y, z, radius
	self.red[i], self.green[i], self.blue[i] = r, g, b
	self.born[i] = self.seconds()
	self.turnCos[i], self.turnSin[i] = cos(unitID), sin(unitID)
end

--- Takes effect `i` out by putting the last in its place.
local function drop(self, i)
	local n = self.count
	self.x[i], self.y[i], self.z[i], self.radius[i] = self.x[n], self.y[n], self.z[n], self.radius[n]
	self.red[i], self.green[i], self.blue[i] = self.red[n], self.green[n], self.blue[n]
	self.born[i] = self.born[n]
	self.turnCos[i], self.turnSin[i] = self.turnCos[n], self.turnSin[n]
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
	-- Light adds to what is behind it. The dots cover it.
	gl.Blending(GL.SRC_ALPHA, GL.ONE)
	gl.BeginEnd(GL.QUADS, glow, self, now, rx, rz)
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.BeginEnd(GL.QUADS, dots, self, now, rx, rz, ux, uy, uz)
	gl.DepthMask(true)
	gl.Color(1, 1, 1, 1)
end

return M
