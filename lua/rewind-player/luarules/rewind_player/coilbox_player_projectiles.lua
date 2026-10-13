-- Coilbox rewind player: the projectiles stage (issue #3795).
--
-- No weapon fires in playback, so the stage creates each shot of the track
-- itself. At a time `t` every shot the track has in the air is a projectile of
-- its weapon, held under move control at the recorded place and pointing the
-- way it was going. A piece of debris, which has no weapon, is left to the
-- engine, which makes its own when a unit dies with its death effect.
--
-- What the engine does with a projectile decides the rest, and all of it is
-- read from rts/Sim/Projectiles:
--
-- - Move control only stops the engine moving a projectile. On every frame the
--   engine still looks for a hit from where the projectile is to where its
--   speed would take it, and takes one that is under the ground to have hit
--   it. So a held shot is given a speed of one position step, which keeps its
--   direction and reaches nothing, is kept above the ground, and is held
--   short of where its flight ends. A track has a shot under the ground on its
--   last frame, because that is the frame the engine found the hit on.
-- - That is also all a shot needs to land. Played forward at near the match's
--   own speed, a shot on its last frame is put where the track last has it at
--   the speed the track has, and let go. The engine finds the hit the match
--   had and makes the game's own impact effect and sound.
-- - A shot does no damage, leaves no crater and pushes nothing, because every
--   projectile created here has its damages set to nothing as it is created.
-- - A beam or a bolt of lightning never moves. The track has where it starts
--   and, as its velocity, the way to where it ends. It cannot be steered, so
--   it is fired once as play passes its start going forward, for the frames
--   the track has it. The engine's weapon does a beam's damage, and the
--   projectile is only what is drawn.
-- - Every kind counts its time to live down under move control and some end
--   when it runs out, so a held shot is given the longest there is.
--
-- The engine chooses projectile ids, hands a dead one out again, and tells Lua
-- of a death only for the weapons a gadget has asked to watch, a list the base
-- game's gadgets change. So the stage asks instead: a projectile it holds has
-- a time to live that only one it created can have.
--
-- A frame of play allocates nothing here. Tables grow when a shot is born.

local M = {}

local Projectiles = {}
Projectiles.__index = Projectiles

--- The weapon a piece of debris is stored with, and the team of no team.
local NO_WEAPON = 65535

--- The time to live a held shot is created with: the largest whole number the
-- engine's Lua numbers count to without a gap. At 30 frames a second it runs
-- out after six days.
local HOLD_TTL = 16777216

--- What a weapon's `type` makes, from rts/Sim/Weapons/WeaponDef.cpp. A type
-- that is not here makes no projectile.
local FLIES = {
	Cannon = true,
	AircraftBomb = true,
	LaserCannon = true,
	EmgCannon = true,
	MissileLauncher = true,
	StarburstLauncher = true,
	TorpedoLauncher = true,
	Flame = true,
	DGun = true,
}
--- The kinds that never move (WeaponDef::IsHitScanWeapon).
local BEAMS = { BeamLaser = true, LightningCannon = true }
--- The kinds the engine ends itself when their time to live runs out: a shell
-- bursts, and a bolt stops or fades. A missile does only when its weapon says
-- it explodes at the end of its range.
local ENDS = { Cannon = true, AircraftBomb = true, LaserCannon = true, EmgCannon = true }

local HELD, RELEASED = 1, 2

local function clear(list)
	for key in next, list do
		list[key] = nil
	end
end

--- `context` is the player's (see coilbox_player.lua), `units` its units stage
-- and `clock` coilbox_player_clock.lua.
function M.new(context, units, clock)
	local Spring, Game, on = context.Spring, context.Game, context.on
	local header = context.track.header
	local names = context.info.weaponDefs
	local defID, beam, ends, stops, wet = {}, {}, {}, {}, {}
	local sounds, volumes, quiet, turn = {}, {}, {}, {}
	local bright, range = {}, {}
	for i = 1, #names do
		local def = context.WeaponDefNames[names[i]]
		defID[i] = false
		turn[i] = 0
		if not def then
			context.report("weapon " .. names[i], "the game has no weapon called " .. names[i] .. ", so the track's shots of that kind are left out")
		elseif not FLIES[def.type] and not BEAMS[def.type] then
			context.report("weapon " .. names[i], "the weapon " .. names[i] .. " is of a kind that makes no projectile (" .. tostring(def.type) .. "), so the track's shots of that kind are left out")
		else
			defID[i] = def.id
			beam[i] = BEAMS[def.type] == true
			ends[i] = ENDS[def.type] == true or (def.type == "MissileLauncher" and def.selfExplode == true)
			-- A laser bolt that has hit stands still where it hit while it fades.
			stops[i] = def.type == "LaserCannon"
			wet[i] = def.waterWeapon == true
			bright[i] = (def.intensity or 0) * 255
			range[i] = def.range or 0
			-- The fire sound, and how many frames after one a shot of the same
			-- burst can be born. A weapon that sounds once for a burst fires its
			-- shots `salvoDelay` apart, and a beam fires one on every frame of its
			-- `beamtime` (CWeapon::Fire, CBeamLaser's constructor).
			local set = on.sound and def.fireSound
			if set and #set > 0 then
				sounds[i], volumes[i] = {}, {}
				for n = 1, #set do
					sounds[i][n], volumes[i][n] = set[n].name, set[n].volume or 1
				end
				quiet[i] = 1
				if def.soundTrigger then
					local speed = Game.gameSpeed
					if def.type == "BeamLaser" and not def.beamburst then
						quiet[i] = math.max(1, math.floor((def.beamtime or 0) * speed))
					else
						quiet[i] = ((def.salvoSize or 1) - 1) * math.max(1, math.floor((def.salvoDelay or 0) * speed)) + 1
					end
				end
			end
		end
	end

	-- Every armour type's damage, and what makes a crater and a push. The table
	-- form of `Spring.SetProjectileDamages` takes string keys only, and reads one
	-- that is a number as an armour type.
	local noDamage = { ["0"] = 0, craterMult = 0, craterBoost = 0, impulseFactor = 0, impulseBoost = 0 }
	for key in pairs(Game.armorTypes or {}) do
		if type(key) == "number" then
			noDamage[tostring(key)] = 0
		end
	end

	return setmetatable({
		context = context,
		track = context.track,
		Spring = Spring,
		units = units,
		near = clock.NEAR_SPEED,
		-- Missing before engine 2025.03.9, which coilbox_player_engine.lua checks.
		-- `release` is the one place it is used.
		setTimeToLive = on.shotHandover and Spring.SetProjectileTimeToLive or nil,
		names = names,
		defCount = #names,
		defID = defID,
		beam = beam,
		ends = ends,
		stops = stops,
		wet = wet,
		bright = bright,
		range = range,
		sounds = sounds,
		volumes = volumes,
		quiet = quiet,
		turn = turn,
		-- The frame a weapon last sounded on, by unit and weapon.
		soundAt = {},
		-- How far a shot is at most from where the match had it. A shot slower
		-- than that in a frame is standing still.
		tolerance = header.tolerance,
		stopped = header.tolerance * header.tolerance,
		-- The speed a held shot is given, and how far above the ground it is
		-- kept: the least distance the track tells apart.
		hold = header.positionStep,
		lift = header.positionStep,
		window = nil,
		from = 1,
		to = 0,
		-- Simulation frames the engine has run, which is what a time to live
		-- counts.
		tick = 0,
		-- The time the last frame showed, and the way play last went.
		shown = nil,
		direction = nil,
		-- By serial number: the engine's id, whether the shot is held or let go,
		-- the tick it was created on and the tick it was last alive on.
		idOf = {},
		state = {},
		born = {},
		stamp = {},
		-- The serial number an engine id is for.
		serialOf = {},
		-- How fast a bolt last flew, by serial number.
		flown = {},
		-- Shots the engine has ended or has been handed, which are not made again
		-- until a jump, a turn or the next window.
		spent = {},
		sample = { 0, 0, 0, 0, 0, 0 },
		ahead = { 0, 0, 0, 0, 0, 0 },
		spawnArg = { pos = { 0, 0, 0 }, speed = { 0, 0, 0 }, ["end"] = { 0, 0, 0 }, team = 0, owner = -1, ttl = HOLD_TTL },
		beamArg = { pos = { 0, 0, 0 }, ["end"] = { 0, 0, 0 }, team = 0, owner = -1, ttl = 1, startAlpha = 0, endAlpha = 0 },
		noDamage = noDamage,
	}, Projectiles)
end

function Projectiles:forget(serial, id)
	self.idOf[serial] = nil
	if self.serialOf[id] == serial then
		self.serialOf[id] = nil
	end
	self.state[serial] = nil
	self.born[serial] = nil
	self.stamp[serial] = nil
	self.flown[serial] = nil
end

--- Whether the engine's projectile `id` is still the one created for `serial`.
-- A held shot was created with a time to live nothing else has, and the engine
-- takes at most one off it on a frame.
function Projectiles:valid(serial, id)
	local ttl = self.Spring.GetProjectileTimeToLive(id)
	return ttl ~= nil and ttl >= HOLD_TTL - (self.tick - self.born[serial])
end

--- Takes a shot away with nothing shown.
function Projectiles:delete(serial, id)
	if self:valid(serial, id) then
		self.Spring.DeleteProjectile(id)
	end
	self:forget(serial, id)
end

--- After a jump: a shot that was let go is taken back, a shot the engine ended
-- is forgotten, and every shot may be made again.
function Projectiles:resync()
	clear(self.spent)
	clear(self.soundAt)
	local state = self.state
	for serial, id in next, self.idOf do
		if state[serial] == RELEASED or not self:valid(serial, id) then
			self:delete(serial, id)
		end
	end
end

--- Takes away every shot that is not in the track at `t`. The units stage has
-- said so when the window cannot be read.
function Projectiles:remove(t)
	local w = self.track:seek(t)
	if not w then
		self.window = nil
		return
	end
	if w ~= self.window then
		self.window = w
		clear(self.spent)
	end
	local tick = self.tick

	-- The shots that can be alive, found by their first frame.
	local from, to = w:projectileRange(t)
	self.from, self.to = from, to
	local idOf, stamp = self.idOf, self.stamp
	local serials = w.projectileSerial
	for p = from, to do
		local serial = serials[p]
		if idOf[serial] and w:projectileExistsAt(p, t) then
			stamp[serial] = tick
		end
	end
	for serial, id in next, idOf do
		if stamp[serial] ~= tick then
			self:delete(serial, id)
		end
	end
end

--- The engine's unit that fired shot `p`, or -1.
local function owner(self, w, p)
	local shooter = w.projectileShooter[p]
	if shooter > 0 then
		return self.units.unitOf[w.unitSerial[shooter]] or -1
	end
	return -1
end

--- Creates a held projectile for shot `p` at a place and a velocity, and gives
-- its id, or nil when the engine gave none.
function Projectiles:create(w, p, d, serial, x, y, z, vx, vy, vz)
	local Spring = self.Spring
	local arg = self.spawnArg
	local at, speed, target = arg.pos, arg.speed, arg["end"]
	at[1], at[2], at[3] = x, y, z
	speed[1], speed[2], speed[3] = vx, vy, vz
	target[1], target[2], target[3] = x + vx, y + vy, z + vz
	arg.team = self.context.teamOf(w.projectileTeam[p])
	arg.owner = owner(self, w, p)
	local id = Spring.SpawnProjectile(self.defID[d], arg)
	if not id then
		self.spent[serial] = true
		self.context.report("spawn " .. d, "Spring.SpawnProjectile gave nothing for " .. self.names[d] .. ". Shots of that kind are tried again after the next seek")
		return nil
	end
	-- The engine hands a dead projectile's id out again.
	local was = self.serialOf[id]
	if was then
		self:forget(was, id)
		self.spent[was] = true
	end
	Spring.SetProjectileMoveControl(id, true)
	Spring.SetProjectileDamages(id, 0, self.noDamage)
	self.idOf[serial], self.serialOf[id] = id, serial
	self.state[serial], self.born[serial], self.stamp[serial] = HELD, self.tick, self.tick
	return id
end

--- Lets a shot go on the frame its flight ends, at the place and velocity the
-- track has for it there, so the engine finds the hit the match had.
--
-- With `Spring.SetProjectileTimeToLive`, a kind the engine ends itself is
-- given one frame to live and handed over for good: a shell that hits nothing
-- bursts a frame's flight on, and a bolt goes on to stop and fade. Without the
-- call, which an engine before 2025.03.9 does not have, and for the other
-- kinds, the shot stays under move control for the engine's one look, and is
-- taken away with nothing shown when it hit nothing.
function Projectiles:release(serial, id, d, x, y, z, vx, vy, vz)
	local Spring = self.Spring
	Spring.SetProjectilePosition(id, x, y, z)
	Spring.SetProjectileVelocity(id, vx, vy, vz)
	if self.setTimeToLive and self.ends[d] then
		Spring.SetProjectileMoveControl(id, false)
		self.setTimeToLive(id, 1)
		self:forget(serial, id)
		self.spent[serial] = true
	else
		self.state[serial] = RELEASED
	end
end

--- Plays the fire sound of a shot born at `frame`, unless its weapon has just
-- sounded: one sound for the shots a unit fires on one frame, and one for a
-- burst when the weapon has it so.
function Projectiles:sound(w, p, d, frame, x, y, z)
	local names = self.sounds[d]
	if not names then
		return
	end
	local key = d
	local shooter = w.projectileShooter[p]
	if shooter > 0 then
		key = d + (w.unitSerial[shooter] + 1) * self.defCount
	end
	local soundAt = self.soundAt
	local last = soundAt[key]
	if last and frame >= last and frame - last < self.quiet[d] then
		return
	end
	soundAt[key] = frame
	local n = self.turn[d] % #names + 1
	self.turn[d] = n
	self.Spring.PlaySoundFile(names[n], self.volumes[d][n], x, y, z, "battle")
end

--- A shot born since the last frame of forward play. `step` is how far play
-- moved the time, and `watched` whether somebody is watching.
function Projectiles:birth(w, p, t, step, watched)
	local weapon = w.projectileWeapon[p]
	if weapon == NO_WEAPON then
		return
	end
	local d = weapon + 1
	if not self.defID[d] then
		return
	end
	local first, last = w.projectileFirstFrame[p], w.projectileLastFrame[p]
	local s = self.sample
	if not w:sampleProjectile(p, first, s) then
		return
	end
	if watched then
		self:sound(w, p, d, first, s[1], s[2], s[3])
	end
	local Spring = self.Spring
	if self.beam[d] then
		-- Fired once, for the frames the track has it at the speed of play. The
		-- engine fades it. A beam is as bright at its start as its weapon and
		-- dimmer along its range (CBeamLaser::FireInternal).
		local arg = self.beamArg
		local at, target = arg.pos, arg["end"]
		at[1], at[2], at[3] = s[1], s[2], s[3]
		target[1], target[2], target[3] = s[1] + s[4], s[2] + s[5], s[3] + s[6]
		arg.team = self.context.teamOf(w.projectileTeam[p])
		arg.owner = owner(self, w, p)
		arg.ttl = math.max(1, math.floor((last - first + 1) / step + 0.5))
		local reach = self.range[d]
		local dim = 1
		if reach > 0 then
			dim = math.max(0, 1 - math.sqrt(s[4] * s[4] + s[5] * s[5] + s[6] * s[6]) / reach)
		end
		arg.startAlpha, arg.endAlpha = self.bright[d], self.bright[d] * dim
		local id = Spring.SpawnProjectile(self.defID[d], arg)
		if id then
			Spring.SetProjectileDamages(id, 0, self.noDamage)
		end
	elseif watched then
		-- A shot whose flight is over before this step is, so that it is never
		-- in the air on a frame: its whole life is inside the step, or it is a
		-- bolt that has stopped already. It is created where the track last has
		-- it moving and let go at once.
		local serial = w.projectileSerial[p]
		if self.idOf[serial] or self.spent[serial] then
			return
		end
		local at
		if last < t then
			at = w.projectileFlags[p] < 2 and last or nil
		elseif self.stops[d] and w:sampleProjectile(p, t, s) and s[4] * s[4] + s[5] * s[5] + s[6] * s[6] < self.stopped then
			at = math.ceil(t) - 1
			while at >= first and w:sampleProjectile(p, at, s) and s[4] * s[4] + s[5] * s[5] + s[6] * s[6] < self.stopped do
				at = at - 1
			end
			if at < first then
				at = nil
			end
		end
		if at and w:sampleProjectile(p, at, s) then
			local id = self:create(w, p, d, serial, s[1], s[2], s[3], s[4], s[5], s[6])
			if id then
				self:release(serial, id, d, s[1], s[2], s[3], s[4], s[5], s[6])
			end
		end
	end
end

--- Shot `p`, in the air at `t`: created when it is not there, then held where
-- the track has it or, on the frame its flight ends while somebody watches,
-- let go.
function Projectiles:steer(w, p, d, t, step, watched)
	local serial = w.projectileSerial[p]
	local id = self.idOf[serial]
	if id then
		if self.state[serial] == RELEASED then
			return
		end
		if not self:valid(serial, id) then
			self:forget(serial, id)
			self.spent[serial] = true
			self.context.report("shot ended", "the engine ended a shot the player was holding in the air, of weapon " .. self.names[d] .. " at frame " .. t .. ". Such a shot is not made again until the next seek. Later ones are not logged")
			return
		end
	elseif self.spent[serial] then
		return
	end
	local s = self.sample
	if not w:sampleProjectile(p, t, s) then
		return
	end
	local x, y, z, vx, vy, vz = s[1], s[2], s[3], s[4], s[5], s[6]
	local speed = vx * vx + vy * vy + vz * vz
	local moving = speed >= self.stopped
	local stops = self.stops[d]
	if not id then
		local cx, cy, cz = vx, vy, vz
		if stops and not moving then
			-- A bolt that has hit has no direction left, and it is drawn along
			-- one. The track's last frame before `t` on which it moves has it.
			local a = self.ahead
			local back = math.ceil(t) - 1
			local first = w.projectileFirstFrame[p]
			while back >= first and w:sampleProjectile(p, back, a) and a[4] * a[4] + a[5] * a[5] + a[6] * a[6] < self.stopped do
				back = back - 1
			end
			if back < first then
				return
			end
			cx, cy, cz = a[4], a[5], a[6]
		end
		id = self:create(w, p, d, serial, x, y, z, cx, cy, cz)
		if not id then
			return
		end
		if stops and not moving then
			-- Created at the speed it flew at, which the engine keeps for its
			-- length, and held from here with one that reaches nothing.
			local flew = math.sqrt(cx * cx + cy * cy + cz * cz)
			self.flown[serial] = flew
			local scale = self.hold / flew
			self.Spring.SetProjectileVelocity(id, cx * scale, cy * scale, cz * scale)
		end
	end

	if watched then
		local last = w.projectileLastFrame[p]
		-- Its last frame, unless the window ends before it does.
		if t + step > last and w.projectileFlags[p] < 2 then
			if w:sampleProjectile(p, last, s) then
				self:release(serial, id, d, s[1], s[2], s[3], s[4], s[5], s[6])
			end
			return
		end
		if stops and moving then
			-- A bolt lands on the last whole frame before the track has it standing
			-- still, which is the frame the engine found the hit on.
			local a = self.ahead
			local to = t + step
			if to > last then
				to = last
			end
			if w:sampleProjectile(p, to, a) and a[4] * a[4] + a[5] * a[5] + a[6] * a[6] < self.stopped then
				local before = math.ceil(to) - 1
				local first = w.projectileFirstFrame[p]
				while before >= first and w:sampleProjectile(p, before, a) and a[4] * a[4] + a[5] * a[5] + a[6] * a[6] < self.stopped do
					before = before - 1
				end
				if before >= first then
					self:release(serial, id, d, a[1], a[2], a[3], a[4], a[5], a[6])
				else
					self:release(serial, id, d, x, y, z, vx, vy, vz)
				end
				return
			end
		end
	end

	-- Held. Where a shot ends it is on what it hit, or about to be, and the
	-- engine takes a projectile that reaches or is inside something to have hit
	-- it. So a shot on its last frame is held the track's tolerance short of
	-- where the track has it, which is how far the playback's units can be from
	-- the match's. A bolt stops on the frame it hits, on what it hit, so from
	-- the frame before it stops it is held a frame of its flight short.
	local Spring = self.Spring
	local last = w.projectileLastFrame[p]
	local back = 0
	if stops then
		local flown = self.flown
		local ending = not moving
		if moving then
			flown[serial] = math.sqrt(speed)
			local a = self.ahead
			local to = t + 1
			if to > last then
				to = last
			end
			ending = w:sampleProjectile(p, to, a) and a[4] * a[4] + a[5] * a[5] + a[6] * a[6] < self.stopped
		end
		if ending then
			back = flown[serial]
		end
	elseif moving and t > last - 1 and w.projectileFlags[p] < 2 then
		back = self.tolerance
	end
	if back > 0 then
		if moving then
			local scale = back / math.sqrt(speed)
			x, y, z = x - vx * scale, y - vy * scale, z - vz * scale
		else
			-- It keeps the direction it was last held with.
			local dx, dy, dz = Spring.GetProjectileDirection(id)
			x, y, z = x - dx * back, y - dy * back, z - dz * back
		end
	end
	-- The same goes for one under the ground, or in the water when its weapon
	-- is not one for the water.
	local floor = Spring.GetGroundHeight(x, z)
	if floor < 0 and not self.wet[d] then
		floor = 0
	end
	if y <= floor then
		y = floor + self.lift
	end
	Spring.SetProjectilePosition(id, x, y, z)
	if moving then
		local scale = self.hold / math.sqrt(speed)
		Spring.SetProjectileVelocity(id, vx * scale, vy * scale, vz * scale)
	elseif not stops then
		Spring.SetProjectileVelocity(id, 0, 0, 0)
	end
end

--- Creates every shot of the track at `t` that is not in the air, and puts
-- each one where the track has it.
function Projectiles:place(t, clock)
	self:show(t, clock)
	-- The engine now takes a frame off every time to live.
	self.tick = self.tick + 1
end

function Projectiles:show(t, clock)
	local w = self.window
	local shown = self.shown
	self.shown = t
	if clock.direction ~= self.direction then
		-- Played the other way, a shot that has landed is in the air again.
		self.direction = clock.direction
		clear(self.spent)
	end
	if not w then
		return
	end
	-- How far play moved the time forward to reach this frame, or nil for a
	-- jump, a pause and play backward.
	local step = not clock.jumped and shown and t > shown and t - shown or nil
	local watched = step ~= nil and clock:watched()

	if step then
		-- Births. Watched, every shot born since the last frame. Faster than
		-- that, the ones born on the last frame of the step, which is as many
		-- beams a frame as the match had.
		local after = shown
		if not watched and t - after > 1 then
			after = t - 1
		end
		local from, to = w:projectilesBorn(after, t)
		local firsts, flags = w.projectileFirstFrame, w.projectileFlags
		for p = from, to do
			local first = firsts[p]
			if first > after and first <= t and flags[p] % 2 == 0 then
				self:birth(w, p, t, step, watched)
			end
		end
	end

	local weapons = w.projectileWeapon
	local defID, beam = self.defID, self.beam
	for p = self.from, self.to do
		local weapon = weapons[p]
		if weapon ~= NO_WEAPON and w:projectileExistsAt(p, t) then
			local d = weapon + 1
			if defID[d] and not beam[d] then
				self:steer(w, p, d, t, step, watched)
			end
		end
	end
end

return M
