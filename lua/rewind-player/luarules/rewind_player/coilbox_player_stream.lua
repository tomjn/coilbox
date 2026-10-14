-- Coilbox rewind player: a builder's stream of build particles (issue #4029).
--
-- The engine draws the stream from a builder's nano pieces to its work itself,
-- as nano particles, but only while the builder really builds: CBuilder and
-- CFactory make a particle from a build step that moved the work on, after it
-- used resources (CUnit::AddBuildPower). No unit of a playback builds, and an
-- order with no build speed makes no particle, so the unsynced half of the
-- gadget draws the stream here, from the work the animation stage hands on.
--
-- Each particle is the engine's (AddNanoParticle in
-- rts/Sim/Projectiles/ProjectileHandler.cpp, and NanoProjectile.cpp, read at
-- 6e5c5a0):
--
-- - It starts at one of the builder's nano pieces, picked at random. A
--   builder the engine has none for makes none.
-- - A builder's particle goes along the line to the work, spread by a random
--   vector in the unit ball times the target's radius over the distance, at 3
--   elmos a frame, and lives int(distance / 3) frames. The radius is half the
--   target's for a build or a repair, and 0.7 of it for a reclaim, a resurrect
--   and a capture. A reclaim's starts at the work and comes back, and so does
--   half of a resurrect's.
-- - A factory's goes at about 1 elmo a frame with a spread of 0.15, and lives
--   int(distance) frames.
-- - One is made on each frame the engine built on. The recorded build power is
--   the share of the last 15 frames that made one (NanoPieceCache), so a frame
--   makes one when a random number falls under it.
-- - It is a square 6 elmos across facing the camera, in the team's colour at
--   an alpha of 20 in 255, or the definition's nanoColor at 20 in 256 when the
--   TeamNanoSpray setting is off, through the game's particle texture, blended
--   one and one less the alpha.
-- - The engine's MaxNanoParticles setting caps them, and at 0 nothing is
--   drawn. The engine makes a particle with a chance of one less the share of
--   95% of it already alive, so with `c` that would be made it keeps about
--   `L / (c + L)` of them, where `L` is that 95%. Here they are kept with that
--   chance, with `c` counted on the drawn frame before, so that the stream
--   does not flicker, and never more than `L`. A game that draws
--   its own sets it to 0, as Beyond All Reason does, and its own effect asks
--   the engine through the two calls `task` and `power` answer for.
--
-- Unlike the engine's, a particle here is worked out afresh on every drawn
-- frame from the time of the track: which frames since the work began made
-- one, and how far each has gone since. Paused, nothing moves. Played
-- backward, each goes back the way it came and into the piece it left. After a
-- seek the whole stream is there at once. The random numbers come from the
-- builder and the frame, so a frame's particles are the same every time.
--
-- Not the engine's: the engine turns a particle as it flies, which a round
-- texture hides, it starts a particle at the piece's raw place where this
-- takes the place Spring.GetUnitPiecePosDir gives, and a particle in flight
-- here follows its builder and its target when they move.
--
-- A draw allocates nothing. The engine is handed in as a table, so the tests
-- run the same file on a stand-in.

local M = {}

--- A builder's particle's speed, in elmos a frame, and what its distance is
-- divided by for its life (`dif * 3.0f` and `len / 3.0f`).
M.SPEED = 3

--- A factory's particle's spread (`guRNG.NextVector() * 0.15f`).
M.FACTORY_SPREAD = 0.15

--- Half the side of a particle's square, in elmos (CNanoProjectile drawRadius).
M.HALF_SIDE = 3

--- The share of the target's radius a particle is spread by: a build or a
-- repair, and the rest (CBuilder::UpdateBuild and the others).
M.BUILD_SHARE = 0.5
M.OTHER_SHARE = 0.7

--- The alpha of the team's colour and of the definition's.
M.TEAM_ALPHA = 20 / 255
M.DEF_ALPHA = 20 / 256

--- The engine's MaxNanoParticles when nobody set it, and the share of it
-- ordinary particles may fill (NORMAL_NANO_PRIO).
M.DEFAULT_MOST = 2000
M.PRIORITY = 0.95

--- The game rules parameters the time of the track is read from.
local FRAME, PLAYING, DIRECTION, SPEED = "coilbox_rewind_frame", "coilbox_rewind_playing", "coilbox_rewind_direction", "coilbox_rewind_speed"

local floor, ceil, sqrt, cos, sin, max, min = math.floor, math.ceil, math.sqrt, math.cos, math.sin, math.max, math.min
local huge, pi = math.huge, math.pi

--- A number from 0 to 1 for a builder, a frame and a use. Every product stays
-- under 2^24, which a 32 bit float holds exactly, as the engine's Lua numbers
-- are, so it is the same in the engine and in the tests. Three generators of
-- Wichmann and Hill, each turned once more by the other two.
local function random(id, frame, use)
	local a = (id % 30269) * 171 % 30269
	local b = (frame % 30307) * 172 % 30307
	local c = (use * 170 + a + b) % 30323
	local x = (a + c) * 171 % 30269
	local y = (b + c) * 172 % 30307
	local z = (a + b + c) * 170 % 30323
	local r = x / 30269 + y / 30307 + z / 30323
	return r - floor(r)
end

local Stream = {}
Stream.__index = Stream

--- The stream of one engine. `engine` has the engine's `Spring`, `gl`, `GL`,
-- `UnitDefs` and `CMD`, `maxUnits`, which is Game.maxUnits, and `texture`, the
-- particle texture's path or nil.
function M.new(engine)
	local CMD = engine.CMD
	return setmetatable({
		Spring = engine.Spring,
		gl = engine.gl,
		GL = engine.GL,
		UnitDefs = engine.UnitDefs,
		maxUnits = engine.maxUnits,
		texture = engine.texture,
		textureOK = engine.texture ~= nil,
		reclaim = CMD.RECLAIM,
		resurrect = CMD.RESURRECT,
		restore = CMD.RESTORE,
		repair = CMD.REPAIR,
		-- The builders with a stream, by unit id.
		builders = {},
		-- How many particles the last draw would have drawn with room for all.
		candidates = 0,
		-- Set by a test to hear each particle drawn.
		at = nil,
	}, Stream)
end

--- The path of the engine's particle texture, from a game's
-- gamedata/resources.lua: its `gfxtexture`, or `circularthingy` when it has
-- none (CProjectileDrawer::Init), each under bitmaps/. The engine reads the
-- table's keys in any case. Nil when it has neither.
function M.textureOf(resources)
	local function find(t, name)
		if type(t) ~= "table" then
			return nil
		end
		for key, value in next, t do
			if type(key) == "string" and key:lower() == name then
				return value
			end
		end
	end
	local textures = find(find(resources, "graphics"), "projectiletextures")
	local path = find(textures, "gfxtexture") or find(textures, "circularthingy")
	if type(path) ~= "string" then
		return nil
	end
	return "bitmaps/" .. path
end

--- A builder's work changed, or a seek brought the time to it. `command`,
-- `target` and `power` are its unit rules parameters, `x, y, z` where the work
-- is, `frame` the time of the track and `jumped` 1 after a seek.
function Stream:work(unitID, command, target, power, x, y, z, frame, jumped)
	local builders = self.builders
	local b = builders[unitID]
	if command == 0 then
		if not b then
			return
		end
		if jumped == 1 then
			builders[unitID] = nil
			return
		end
		-- No frame from here on makes one: after it going forward, and before
		-- the work's first going backward.
		b.command = 0
		if (self.Spring.GetGameRulesParam(DIRECTION) or 1) > 0 then
			b.to = ceil(frame) - 1
		else
			b.from = floor(frame) + 1
		end
		return
	end
	local Spring = self.Spring
	if not b then
		local def = Spring.GetUnitDefID(unitID)
		local ud = def and self.UnitDefs[def]
		if not ud then
			return
		end
		b = {
			def = def,
			team = Spring.GetUnitTeam(unitID),
			factory = ud.isFactory == true,
			shown = ud.showNanoSpray ~= false,
			red = ud.nanoColorR or 0,
			green = ud.nanoColorG or 0,
			blue = ud.nanoColorB or 0,
			pieces = nil,
			-- Each nano piece's place on the frame drawn, and how long a
			-- particle from it lives.
			px = {},
			py = {},
			pz = {},
			life = {},
			command = 0,
		}
		builders[unitID] = b
	end
	local fresh = command ~= b.command or target ~= b.target
	b.command, b.target, b.power = command, target, power
	b.x, b.y, b.z = x, y, z
	b.reclaims = command == self.reclaim
	b.resurrects = command == self.resurrect
	-- Half a build or a repair's radius, the rest more (CBuilder::Update*).
	b.share = (command < 0 or command == self.repair) and M.BUILD_SHARE or M.OTHER_SHARE
	-- The animation stage gives the engine the pieces before it hands on the
	-- work, so they are there now. A list is made here, not on each draw.
	if not b.pieces then
		b.pieces = Spring.GetUnitNanoPieces(unitID)
	end
	if jumped == 1 then
		b.from, b.to = -huge, huge
	elseif fresh then
		if (Spring.GetGameRulesParam(DIRECTION) or 1) > 0 then
			b.from, b.to = ceil(frame), huge
		else
			-- Played backward into work, which went on until this frame.
			b.from, b.to = -huge, floor(frame)
		end
	end
end

--- Forgets a builder, which the engine has removed.
function Stream:drop(unitID)
	self.builders[unitID] = nil
end

--- What Spring.GetUnitWorkerTask gives for a builder at work: the command and
-- the target, the command alone for terraforming, and nothing for one that is
-- not at work or whose target the playback does not have yet.
function Stream:task(unitID)
	local b = self.builders[unitID]
	if not b or b.command == 0 then
		return nil
	end
	if b.command == self.restore then
		return b.command
	end
	if b.target < 0 then
		return nil
	end
	return b.command, b.target
end

--- What Spring.GetUnitCurrentBuildPower gives for a builder at work: its
-- recorded power while the time goes forward, and 0 paused and backward, so
-- that a game's own stream, which flows on the engine's clock, stands still
-- with the time. Nil for a unit that is not at work.
function Stream:power(unitID)
	local b = self.builders[unitID]
	if not b or b.command == 0 then
		return nil
	end
	local Spring = self.Spring
	if Spring.GetGameRulesParam(PLAYING) ~= 1 or (Spring.GetGameRulesParam(DIRECTION) or 1) < 0 then
		return 0
	end
	return b.power
end

--- Where the builder's work is and its radius: a unit's middle, a feature's,
-- or the place the track has.
local function goalOf(self, b)
	local Spring = self.Spring
	local target = b.target
	if target and target >= 0 then
		if target < self.maxUnits then
			local _, _, _, mx, my, mz = Spring.GetUnitPosition(target, true)
			if mx then
				return mx, my, mz, (Spring.GetUnitRadius(target) or 0) * b.share
			end
		else
			local id = target - self.maxUnits
			local _, _, _, mx, my, mz = Spring.GetFeaturePosition(id, true)
			if mx then
				return mx, my, mz, (Spring.GetFeatureRadius(id) or 0) * b.share
			end
		end
	end
	return b.x, b.y, b.z, 0
end

--- The particles of every builder, inside gl.BeginEnd for quads. `t` is the
-- time drawn, `most` how many the engine allows, the camera's right is
-- `rx, rz` and its up `ux, uy, uz`.
local function particles(self, t, most, team, rx, rz, ux, uy, uz)
	local Spring, gl = self.Spring, self.gl
	local Color, Vertex, TexCoord = gl.Color, gl.Vertex, gl.TexCoord
	local half = M.HALF_SIDE
	local sx, sz, tx, ty, tz = rx * half, rz * half, ux * half, uy * half, uz * half
	local limit = most * M.PRIORITY
	local keep = limit / (self.candidates + limit)
	local drawn, candidates = 0, 0
	local at = self.at
	local now = floor(t)
	for unitID, b in next, self.builders do
		local pieces = b.pieces
		if not Spring.ValidUnitID(unitID) then
			self.builders[unitID] = nil
		elseif b.shown and pieces then
			local gx, gy, gz, radius = goalOf(self, b)
			local px, py, pz, life = b.px, b.py, b.pz, b.life
			local n, longest = #pieces, 0
			local cx, cy, cz = 0, 0, 0
			for k = 1, n do
				local x, y, z = Spring.GetUnitPiecePosDir(unitID, pieces[k])
				if not x then
					x, y, z = gx, gy, gz
				end
				px[k], py[k], pz[k] = x, y, z
				local dx, dy, dz = gx - x, gy - y, gz - z
				local length = sqrt(dx * dx + dy * dy + dz * dz)
				local lives = b.factory and floor(length) or floor(length / M.SPEED)
				life[k] = lives
				if lives > longest then
					longest = lives
				end
				cx, cy, cz = cx + x, cy + y, cz + z
			end
			local first = max(b.from, now - longest + 1)
			local last = min(b.to, now)
			if b.command == 0 and first > last then
				-- Stopped, and nothing of it is in the air.
				self.builders[unitID] = nil
			elseif first <= last then
				cx, cy, cz = (cx / n + gx) / 2, (cy / n + gy) / 2, (cz / n + gz) / 2
				local reach = longest * M.SPEED + radius + half
				if Spring.IsSphereInView(cx, cy, cz, reach) then
					if team then
						local r, g, bl = Spring.GetTeamColor(b.team)
						Color(r or 1, g or 1, bl or 1, M.TEAM_ALPHA)
					else
						Color(b.red, b.green, b.blue, M.DEF_ALPHA)
					end
					local power = b.power
					for born = last, first, -1 do
						-- A frame the engine built on makes one.
						if random(unitID, born, 1) < power then
							local k = 1 + floor(random(unitID, born, 3) * n)
							if k > n then
								k = n
							end
							local age = t - born
							if age >= 0 and age < life[k] then
								candidates = candidates + 1
							end
							-- The more there are the fewer the engine makes
							-- (GetNanoParticleSaturation).
							if age >= 0 and age < life[k] and drawn < limit and random(unitID, born, 2) < keep then
								local x0, y0, z0 = px[k], py[k], pz[k]
								local dx, dy, dz = gx - x0, gy - y0, gz - z0
								local length = sqrt(dx * dx + dy * dy + dz * dz)
								if length > 0 then
									-- A random vector in the unit ball (CGlobalRNG::NextVector).
									local h = 2 * random(unitID, born, 4) - 1
									local turn = 2 * pi * random(unitID, born, 5)
									local reach3 = random(unitID, born, 6) ^ (1 / 3)
									local flat = sqrt(1 - h * h) * reach3
									local jx, jy, jz = flat * cos(turn), h * reach3, flat * sin(turn)
									local x, y, z
									if b.factory then
										local s = M.FACTORY_SPREAD
										local vx, vy, vz = dx / length + jx * s, dy / length + jy * s, dz / length + jz * s
										x, y, z = x0 + vx * age, y0 + vy * age, z0 + vz * age
									else
										local s = radius / length
										local vx, vy, vz = dx / length + jx * s, dy / length + jy * s, dz / length + jz * s
										local back = b.reclaims or (b.resurrects and random(unitID, born, 7) < 0.5)
										if back then
											x, y, z = x0 + vx * (length - M.SPEED * age), y0 + vy * (length - M.SPEED * age), z0 + vz * (length - M.SPEED * age)
										else
											x, y, z = x0 + vx * M.SPEED * age, y0 + vy * M.SPEED * age, z0 + vz * M.SPEED * age
										end
									end
									drawn = drawn + 1
									if at then
										at(x, y, z, unitID, born)
									end
									TexCoord(0, 0)
									Vertex(x - sx - tx, y - ty, z - sz - tz)
									TexCoord(1, 0)
									Vertex(x + sx - tx, y - ty, z + sz - tz)
									TexCoord(1, 1)
									Vertex(x + sx + tx, y + ty, z + sz + tz)
									TexCoord(0, 1)
									Vertex(x - sx + tx, y + ty, z - sz + tz)
								end
							end
						end
					end
				end
			end
		end
	end
	self.candidates = candidates
end

--- Draws every stream, from the gadget's `DrawWorld`.
function Stream:draw()
	if next(self.builders) == nil then
		return
	end
	local Spring, gl, GL = self.Spring, self.gl, self.GL
	local most = Spring.GetConfigInt("MaxNanoParticles", M.DEFAULT_MOST)
	if most <= 0 then
		return
	end
	local t = Spring.GetGameRulesParam(FRAME)
	if not t then
		return
	end
	-- Between two simulation frames a particle is where the time between has
	-- it, as the engine draws its own (drawPos).
	if Spring.GetGameRulesParam(PLAYING) == 1 then
		local rate = (Spring.GetGameRulesParam(DIRECTION) or 1) * (Spring.GetGameRulesParam(SPEED) or 1)
		t = t + rate * (Spring.GetFrameTimeOffset() or 0)
	end
	local team = Spring.GetConfigInt("TeamNanoSpray", 1) ~= 0

	-- The camera's right, level with the ground, and its up, as the arrival
	-- effect takes them. A camera that looks straight down has no right of its
	-- own, and any will do.
	local dx, dy, dz = Spring.GetCameraDirection()
	local rx, rz = -dz, dx
	local length = sqrt(rx * rx + rz * rz)
	if length < 0.001 then
		rx, rz = 1, 0
	else
		rx, rz = rx / length, rz / length
	end
	local ux, uy, uz = -rz * dy, rz * dx - rx * dz, rx * dy

	if self.textureOK then
		self.textureOK = gl.Texture(self.texture) and true or false
	end
	if not self.textureOK then
		gl.Texture(false)
	end
	gl.DepthTest(true)
	gl.DepthMask(false)
	gl.Blending(GL.ONE, GL.ONE_MINUS_SRC_ALPHA)
	gl.BeginEnd(GL.QUADS, particles, self, t, most, team, rx, rz, ux, uy, uz)
	gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
	gl.DepthMask(true)
	gl.Texture(false)
	gl.Color(1, 1, 1, 1)
end

return M
