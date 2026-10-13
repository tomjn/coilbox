-- Drives the player gadget in a real engine and says what the engine then has.
--
-- The ignored Rust test a_real_track_is_played_at_any_time writes this file into
-- the playback game it has just generated, launches a headless engine on it and
-- reads the REWIND_DRIVER lines back out of the log. It is not part of the game
-- coilbox ships: only luarules/ and luaui/ of lua/rewind-player are.
--
-- It reads the track with a reader of its own, so what it expects of a frame
-- does not come from the gadget under test. It sends the player's messages the
-- way a widget does, from the unsynced half with Spring.SendLuaRulesMsg, as the
-- one spectator of the game. A seek that arrives is therefore also the proof
-- that a spectator's message reaches the synced gadget.
--
-- Every line is a measurement. The test decides what passes.

function gadget:GetInfo()
	-- Before the player in the game's handler, which calls gadgets from the
	-- lowest layer up and stops at the first that takes a call from the synced
	-- half. The player takes its own, so a driver after it would hear nothing.
	return { name = "Coilbox rewind playback driver", layer = -1000, enabled = true }
end

local SEND = "rewind_driver_send"
local REPORT = "rewind_driver_report"
-- What the player's synced half sends its unsynced half around a frame's work.
-- The driver listens to the same two calls to say how long the work took.
local WORK = "coilbox_rewind_work"

if not gadgetHandler:IsSyncedCode() then
	local started
	local frames, total, worst, worstFrame = 0, 0, 0, -1

	function gadget:RecvFromSynced(name, a, b)
		if name == SEND then
			Spring.SendLuaRulesMsg(a)
			return true
		elseif name == WORK then
			if a == 0 then
				started = Spring.GetTimer()
			elseif started then
				local took = Spring.DiffTimers(Spring.GetTimer(), started, true)
				started = nil
				frames, total = frames + 1, total + took
				if took > worst then
					worst, worstFrame = took, b
				end
			end
			-- The player's own half has to hear it too.
			return false
		elseif name == REPORT then
			Spring.Echo(string.format("REWIND_DRIVER work frames=%d mean_ms=%.3f worst_ms=%.3f worst_frame=%d", frames, total / math.max(frames, 1), worst, worstFrame))
			Spring.Echo("REWIND_DRIVER done")
			return true
		end
		return false
	end
	return
end

local TAG = "REWIND_DRIVER "
local PARAM = "coilbox_rewind_"
-- Frames given to the engine after a seek has arrived, so that a unit removed
-- quietly is out of its lists and the next frame's work is done.
local SETTLE = 3
-- Frames a message is waited for before the step is called lost.
local PATIENCE = 300
-- A file in the playback game that asks for the whole match plan.
local WHOLE_MATCH = "coilbox_rewind/driver_whole_match.lua"
-- And one that asks for the plan that looks at a match's shots.
local SHOTS = "coilbox_rewind/driver_shots.lua"
-- And one that asks for the plan of seeks across the whole match (issue #3988).
local SEEKS = "coilbox_rewind/driver_seeks.lua"

local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")

local track, info, features
local queue, at = {}, 1
local transform, status = { 0, 0, 0, 0, 0, 0, 0 }, { 0, 0, 0 }

-- How many explosions the engine has made. A unit destroyed with its death
-- effect explodes, and one removed quietly does not.
local explosions = 0

-- The same for the weapons the track's shots are of, by the engine's weapon
-- definition id, with where each was and what the ground was there.
local shotWeapons = {}
local impacts, impactCount = {}, 0
-- Hits the engine worked out some damage for, before any gadget changed it,
-- and hits that did some. The player's shots are created with none to do.
local rawDamage, doneDamage = 0, 0

function gadget:Initialize()
	for weaponDefID in pairs(WeaponDefs) do
		Script.SetWatchExplosion(weaponDefID, true)
	end
end

-- The explosions the track's weapons did not make, which in a playback are a
-- unit's death. The ground round each is looked at on the next frame, to see
-- whether the engine's crater left the ground anywhere but where the track has
-- it (issue #3987).
local deathExplosions, deathCount = {}, 0

function gadget:Explosion(weaponDefID, x, y, z)
	explosions = explosions + 1
	if shotWeapons[weaponDefID] then
		impactCount = impactCount + 1
		impacts[impactCount] = { def = weaponDefID, x = x, y = y, z = z, ground = Spring.GetGroundHeight(x, z), frame = Spring.GetGameRulesParam("coilbox_rewind_frame") }
	else
		deathCount = deathCount + 1
		deathExplosions[deathCount] = { def = weaponDefID, x = x, z = z }
	end
end

-- This gadget is the first the game's handler asks, so the damage is the
-- engine's own.
function gadget:UnitPreDamaged(_, _, _, damage, _, weaponDefID)
	if weaponDefID and shotWeapons[weaponDefID] and damage ~= 0 then
		rawDamage = rawDamage + 1
	end
end

function gadget:UnitDamaged(_, _, _, damage, _, weaponDefID)
	if weaponDefID and shotWeapons[weaponDefID] and damage ~= 0 then
		doneDamage = doneDamage + 1
	end
end

-- The same for features: hits by the track's weapons that the engine worked
-- out some damage for, and hits by anything else, which is a unit's death.
local featureShotDamage, featureOtherDamage = 0, 0
-- Hits on a feature by anything but the track's weapons that did some damage
-- in the end, which the engine only tells of when no gadget took it away.
-- `featureOtherDamage` is what the engine worked out before any gadget was
-- asked, so it says a death's explosion reached a feature, and this says it
-- hurt it.
local featureDoneDamage = 0

function gadget:FeaturePreDamaged(_, _, _, damage, weaponDefID)
	if damage ~= 0 then
		if weaponDefID and shotWeapons[weaponDefID] then
			featureShotDamage = featureShotDamage + 1
		else
			featureOtherDamage = featureOtherDamage + 1
		end
	end
end

function gadget:FeatureDamaged(_, _, _, damage, weaponDefID)
	if damage ~= 0 and not (weaponDefID and shotWeapons[weaponDefID]) then
		featureDoneDamage = featureDoneDamage + 1
	end
end

local function say(text)
	Spring.Echo(TAG .. text)
end

local function push(kind, a, b)
	queue[#queue + 1] = { kind = kind, a = a, b = b, waited = 0 }
end

local function send(message)
	push("send", "coilbox_rewind:" .. message)
end

local function param(name)
	return Spring.GetGameRulesParam(PARAM .. name)
end

--- The height the track has a corner of the ground at `frame`: the last row
-- that touches it, or the map's own.
local function trackGround(corner, frame, x, z)
	local size = Game.squareSize
	local height = Spring.GetGroundOrigHeight(corner.x * size, corner.z * size)
	for k = 0, track:windowOf(frame) do
		local rows = assert(track:terrain(k))
		for i = 1, rows.count do
			if rows.frame[i] <= frame and rows.x[i] == corner.x and rows.z[i] == corner.z then
				height = rows.after[i]
			end
		end
	end
	return height
end

--- Says, for each explosion since the last call, how far the ground round it is
-- from the track's.
local function lookAtDeathGround()
	if deathCount == 0 then
		return
	end
	local size, frame = Game.squareSize, param("frame")
	for n = 1, deathCount do
		local explosion = deathExplosions[n]
		local def = WeaponDefs[explosion.def]
		local reach = math.max(def.craterAreaOfEffect or 0, def.damageAreaOfEffect or 0, 16)
		local worst, changed, looked = 0, 0, 0
		for dx = -3, 3 do
			for dz = -3, 3 do
				local corner = {
					x = math.floor((explosion.x + dx * reach / 3) / size + 0.5),
					z = math.floor((explosion.z + dz * reach / 3) / size + 0.5),
				}
				local actual = Spring.GetGroundHeight(corner.x * size, corner.z * size)
				looked = looked + 1
				if math.abs(actual - Spring.GetGroundOrigHeight(corner.x * size, corner.z * size)) > 0.001 then
					changed = changed + 1
				end
				worst = math.max(worst, math.abs(actual - trackGround(corner, frame, corner.x, corner.z)))
			end
		end
		say(string.format("death_ground weapon=%s frame=%s crater_mult=%s crater_aoe=%.1f damage_aoe=%.1f looked=%d changed_from_map=%d off_worst=%.3f", def.name, tostring(frame), tostring(def.damages and def.damages.craterMult), def.craterAreaOfEffect or 0, def.damageAreaOfEffect or 0, looked, changed, worst))
		deathExplosions[n] = nil
	end
	deathCount = 0
end

--- Seeks, waits for the player to show the frame, and lets the engine settle.
local function seekTo(frame)
	send("seek " .. frame)
	push("await", frame)
	push("wait", SETTLE)
end

local function liveUnits()
	local list = {}
	for _, unitID in ipairs(Spring.GetAllUnits()) do
		if not Spring.GetUnitIsDead(unitID) then
			list[#list + 1] = unitID
		end
	end
	return list
end

--- The front and up a track's quaternion stands for.
local function directions(x, y, z, w)
	return 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)
end

--- What the track has at `frame` against what the engine has.
local function measure(label, frame)
	local w = assert(track:seek(frame))
	local live = liveUnits()
	local taken = {}
	local wanted, worstPlace, worstTurn, worstHealth, worstBuild, wrongState = 0, 0, 0, 0, 0, 0
	-- The same two, less what the player is known to add: a unit under
	-- construction is held one step of the engine's decay above nothing, and the
	-- engine takes a step off again before this looks.
	local overHealth, overBuild = 0, 0
	for i = 1, w.unitCount do
		local def = UnitDefNames[info.unitDefs[w.unitDef[i] + 1]]
		if def and w:unitExistsAt(i, frame) then
			wanted = wanted + 1
			w:sampleTransform(i, frame, transform)
			w:sampleStatus(i, frame, status)
			-- The engine's unit of that kind nearest where the track has this one.
			local best, bestDistance
			for _, unitID in ipairs(live) do
				if not taken[unitID] and Spring.GetUnitDefID(unitID) == def.id then
					local x, y, z = Spring.GetUnitPosition(unitID)
					local d = math.sqrt((x - transform[1]) ^ 2 + (y - transform[2]) ^ 2 + (z - transform[3]) ^ 2)
					if not bestDistance or d < bestDistance then
						best, bestDistance = unitID, d
					end
				end
			end
			if best then
				taken[best] = true
				worstPlace = math.max(worstPlace, bestDistance)
				local fx, fy, fz, ux, uy, uz = directions(transform[4], transform[5], transform[6], transform[7])
				local front, up = Spring.GetUnitVectors(best)
				worstTurn = math.max(worstTurn, math.abs(front[1] - fx), math.abs(front[2] - fy), math.abs(front[3] - fz))
				worstTurn = math.max(worstTurn, math.abs(up[1] - ux), math.abs(up[2] - uy), math.abs(up[3] - uz))
				local health, maxHealth, _, _, build = Spring.GetUnitHealth(best)
				local _, _, beingBuilt = Spring.GetUnitIsStunned(best)
				if (status[2] < 1) ~= (beingBuilt == true) then
					wrongState = wrongState + 1
				end
				local offBuild, offHealth = math.abs(build - status[2]), math.abs(health / maxHealth - status[1])
				worstBuild = math.max(worstBuild, offBuild)
				worstHealth = math.max(worstHealth, offHealth)
				local slack = 0
				if status[2] < 1 and Game.constructionDecay then
					slack = 1 / math.max(0.001, def.buildTime * Game.constructionDecaySpeed) + 1 / 65535
				end
				overBuild = math.max(overBuild, offBuild - slack)
				overHealth = math.max(overHealth, offHealth - slack)
			else
				worstPlace = math.huge
			end
		end
	end
	local wantedFeatures = 0
	for _, feature in ipairs(features) do
		if FeatureDefNames[info.featureDefs[feature.def + 1]] and frame >= feature.firstFrame and frame <= feature.lastFrame then
			wantedFeatures = wantedFeatures + 1
		end
	end
	say(
		string.format(
			"%s frame=%s shown=%s track_units=%d engine_units=%d track_features=%d engine_features=%d place=%.4f turn=%.5f health=%.5f build=%.5f health_over=%.5f build_over=%.5f wrong_build_state=%d",
			label,
			tostring(frame),
			tostring(param("frame")),
			wanted,
			#live,
			wantedFeatures,
			#Spring.GetAllFeatures(),
			worstPlace,
			worstTurn,
			worstHealth,
			worstBuild,
			overHealth,
			overBuild,
			wrongState
		)
	)
end

--- A unit the track has built during the match: where its entry is, when it
-- first exists and the first frame its progress is whole.
local function construction()
	local h = track.header
	for k = 0, h.windowCount - 1 do
		local w = assert(track:loadWindow(k))
		for i = 1, w.unitCount do
			local first = w.unitFirstFrame[i]
			if w.unitFlags[i] % 2 == 0 and first > h.firstFrame and UnitDefNames[info.unitDefs[w.unitDef[i] + 1]] then
				w:sampleStatus(i, first, status)
				if status[2] < 1 then
					local serial, def = w.unitSerial[i], w.unitDef[i]
					for frame = first, h.lastFrame do
						local v = assert(track:seek(frame))
						for j = 1, v.unitCount do
							if v.unitSerial[j] == serial and v:unitExistsAt(j, frame) then
								v:sampleStatus(j, frame, status)
								if status[2] >= 1 then
									return info.unitDefs[def + 1], first, frame
								end
							end
						end
					end
				end
			end
		end
	end
end

--- The last frame of a finished unit that dies before the match ends.
local function death()
	local h = track.header
	for k = 0, h.windowCount - 1 do
		local w = assert(track:loadWindow(k))
		for i = 1, w.unitCount do
			local last = w.unitLastFrame[i]
			if w.unitFlags[i] < 2 and last < h.lastFrame and UnitDefNames[info.unitDefs[w.unitDef[i] + 1]] then
				w:sampleStatus(i, last, status)
				if status[2] >= 1 then
					return last
				end
			end
		end
	end
end

--- The frame at which a finished unit of the track has the least health, looked
-- for every 150 frames, and that health as a part of its maximum.
local function wounded()
	local h = track.header
	local at, least = nil, 1
	for frame = h.firstFrame, h.lastFrame, 150 do
		local w = assert(track:seek(frame))
		for i = 1, w.unitCount do
			if UnitDefNames[info.unitDefs[w.unitDef[i] + 1]] and w:unitExistsAt(i, frame) then
				w:sampleStatus(i, frame, status)
				if status[2] >= 1 and status[1] < least then
					at, least = frame, status[1]
				end
			end
		end
	end
	return at, least
end

--- How many live units of a definition the engine has, and how many of them
-- are under construction.
local function count(name)
	local n, building = 0, 0
	for _, unitID in ipairs(liveUnits()) do
		if Spring.GetUnitDefID(unitID) == UnitDefNames[name].id then
			n = n + 1
			local _, _, beingBuilt = Spring.GetUnitIsStunned(unitID)
			if beingBuilt then
				building = building + 1
			end
		end
	end
	return n, building
end

--- The first corner the track changes, with the height it starts at and the
-- height it ends at.
local function corner()
	local x, z, before, after
	for k = 0, track.header.windowCount - 1 do
		local rows = assert(track:terrain(k))
		for i = 1, rows.count do
			if not x then
				x, z, before = rows.x[i], rows.z[i], rows.before[i]
			end
			if rows.x[i] == x and rows.z[i] == z then
				after = rows.after[i]
			end
		end
	end
	return x, z, before, after
end

--- A string longer than 16,777,216 bytes read through the string fetch, in the
-- engine's own numbers (issue #3971). Each 64 byte block holds its own number.
local function longString()
	local blocks = 600000
	local function block(n)
		return string.format("%063d\n", n)
	end
	local parts = {}
	for n = 0, blocks - 1 do
		parts[n + 1] = block(n)
	end
	local fetch = Fetch.fromString(table.concat(parts))
	parts = nil
	local wrong, checked = 0, 0
	for _, n in ipairs({ 0, 262142, 262143, 262144, 262145, 400000, 524285, 524286, 524287, blocks - 1 }) do
		checked = checked + 1
		if fetch(n, 64) ~= block(n) then
			wrong = wrong + 1
		end
	end
	checked = checked + 1
	if fetch(262142, 192) ~= block(262142) .. block(262143) .. block(262144) then
		wrong = wrong + 1
	end
	say("long_string bytes=" .. blocks * 64 .. " checked=" .. checked .. " wrong=" .. wrong)
end

--- Ten seeks spread over the match, in an order that goes both ways.
local function tenSeeks(first, last)
	local order = { 5, 2, 9, 0, 7, 3, 10, 1, 8, 4 }
	for n, tenth in ipairs(order) do
		local frame = first + math.floor((last - first) * tenth / 10)
		seekTo(frame)
		push("run", function()
			measure("seek n=" .. n, frame)
		end)
	end
end

--- The dead teams, and whether the engine holds the match to be over.
local function ending()
	local dead = 0
	for _, team in ipairs(Spring.GetTeamList()) do
		local _, _, isDead = Spring.GetTeamInfo(team, false)
		if isDead then
			dead = dead + 1
		end
	end
	say("teams dead=" .. dead .. " of=" .. #Spring.GetTeamList() .. " game_over=" .. (Spring.IsGameOver() and 1 or 0))
	say(string.format("deaths explosions=%d feature_hits_by_deaths=%d feature_damage_by_deaths=%d", explosions, featureOtherDamage, featureDoneDamage))
end

-- Projectiles (issue #3795).

local shot = { 0, 0, 0, 0, 0, 0 }

--- The weapon definitions of the track that the game has, and whether each is
-- of a kind that is held in the air and not fired once.
local function weapons()
	local held = {}
	for i, name in ipairs(info.weaponDefs) do
		local def = WeaponDefNames[name]
		if def then
			shotWeapons[def.id] = i
			held[i] = def.type ~= "BeamLaser" and def.type ~= "LightningCannon"
			say(string.format("weapon name=%s type=%s held=%d", name, def.type, held[i] and 1 or 0))
		else
			say("weapon name=" .. name .. " type=missing held=0")
		end
	end
	return held
end

--- Every shot of the track once: its weapon, its first and last frame, where
-- it starts, and where and how fast the track last has it moving.
local function allShots(held)
	local h = track.header
	local list, bySerial = {}, {}
	for k = 0, h.windowCount - 1 do
		local w = assert(track:loadWindow(k))
		for p = 1, w.projectileCount do
			local weapon = w.projectileWeapon[p] + 1
			if w.projectileWeapon[p] ~= 65535 and held[weapon] then
				local serial = w.projectileSerial[p]
				local one = bySerial[serial]
				if not one then
					w:sampleProjectile(p, w.projectileFirstFrame[p], shot)
					one = { serial = serial, weapon = weapon, first = w.projectileFirstFrame[p], x = shot[1], y = shot[2], z = shot[3] }
					bySerial[serial] = one
					list[#list + 1] = one
				end
				one.last = w.projectileLastFrame[p]
				for frame = w.projectileFirstFrame[p], w.projectileLastFrame[p] do
					w:sampleProjectile(p, frame, shot)
					if shot[4] ^ 2 + shot[5] ^ 2 + shot[6] ^ 2 >= h.tolerance ^ 2 then
						one.endFrame = frame
						one.ex, one.ey, one.ez, one.evx, one.evy, one.evz = shot[1], shot[2], shot[3], shot[4], shot[5], shot[6]
					end
				end
			end
		end
	end
	return list
end

--- The engine's weapon projectiles of the track's weapons.
local function airborne()
	local list = {}
	local big = 1e9
	for _, id in ipairs(Spring.GetProjectilesInRectangle(-big, -big, big, big, false, true)) do
		local def = Spring.GetProjectileDefID(id)
		if def and shotWeapons[def] then
			list[#list + 1] = id
		end
	end
	return list
end

--- The track's shots at `frame` against the engine's projectiles. A shot the
-- track has under the ground is expected a position step above it, which is
-- where the player holds one.
local function measureShots(label, frame, held, shots)
	local h = track.header
	local w = assert(track:seek(frame))
	local engine = airborne()
	local taken = {}
	local wanted, raised, worstPlace, worstTurn, worstSpeed = 0, 0, 0, 0, 0
	-- A shot at the end of its flight is held short of where the track has it:
	-- by the tolerance on its last frame, and a bolt by a frame of its flight
	-- from the frame before it stops. `short` is how many were, `place` the
	-- furthest any other shot is from the track, and `over` the furthest any
	-- shot is past what it may be.
	local short, over = 0, 0
	local bySerial = {}
	for _, one in ipairs(shots) do
		bySerial[one.serial] = one
	end
	for p = 1, w.projectileCount do
		local weapon = w.projectileWeapon[p] + 1
		if w.projectileWeapon[p] ~= 65535 and held[weapon] and w:projectileExistsAt(p, frame) then
			wanted = wanted + 1
			w:sampleProjectile(p, frame, shot)
			local x, y, z = shot[1], shot[2], shot[3]
			local floor = math.max(Spring.GetGroundHeight(x, z), 0)
			if y <= floor then
				y = floor + h.positionStep
				raised = raised + 1
			end
			local def = WeaponDefNames[info.weaponDefs[weapon]].id
			local best, bestDistance
			for _, id in ipairs(engine) do
				if not taken[id] and Spring.GetProjectileDefID(id) == def then
					local px, py, pz = Spring.GetProjectilePosition(id)
					local d = math.sqrt((px - x) ^ 2 + (py - y) ^ 2 + (pz - z) ^ 2)
					if not bestDistance or d < bestDistance then
						best, bestDistance = id, d
					end
				end
			end
			if best then
				taken[best] = true
				local one = bySerial[w.projectileSerial[p]]
				local slack = 0
				if one.endFrame and one.endFrame < one.last then
					if frame > one.endFrame - 1 then
						slack = math.sqrt(one.evx ^ 2 + one.evy ^ 2 + one.evz ^ 2)
					end
				elseif frame > one.last - 1 then
					slack = h.tolerance
				end
				if slack > 0 then
					short = short + 1
				else
					worstPlace = math.max(worstPlace, bestDistance)
				end
				over = math.max(over, bestDistance - slack)
				local vx, vy, vz = Spring.GetProjectileVelocity(best)
				local speed = math.sqrt(vx ^ 2 + vy ^ 2 + vz ^ 2)
				local recorded = math.sqrt(shot[4] ^ 2 + shot[5] ^ 2 + shot[6] ^ 2)
				worstSpeed = math.max(worstSpeed, speed)
				if speed > 0 and recorded >= h.tolerance then
					worstTurn = math.max(worstTurn, 1 - (vx * shot[4] + vy * shot[5] + vz * shot[6]) / (speed * recorded))
				end
			else
				worstPlace = math.huge
			end
		end
	end
	say(string.format("%s frame=%s shown=%s track_shots=%d engine_shots=%d raised=%d short=%d place=%.4f over=%.4f turn=%.6f speed=%.4f", label, tostring(frame), tostring(param("frame")), wanted, #engine, raised, short, worstPlace, over, worstTurn, worstSpeed))
end

--- The plan for the shots of a whole recorded match: what is in the air paused
-- during a fight and at seeks, a shot followed backward frame by frame, the
-- fight watched forward at the match's own speed, then at 4x and backward, and
-- a seek across the whole match and back.
local function shotPlan()
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	say(string.format("start first=%d last=%d tolerance=%s step=%s rotation_bits=%d", first, last, tostring(h.tolerance), tostring(h.positionStep), h.rotationBits))
	local held = weapons()
	local shots = allShots(held)
	say("shots held_kinds=" .. #shots)
	if #shots == 0 then
		SendToUnsynced(REPORT)
		return
	end

	-- The frame with the most in the air, and the frames the fight spans.
	local perFrame, busiest, most = {}, nil, 0
	local fightStart, fightEnd = shots[1].first, shots[1].last
	local longest = shots[1]
	for _, one in ipairs(shots) do
		for frame = one.first, one.last do
			perFrame[frame] = (perFrame[frame] or 0) + 1
			if perFrame[frame] > most then
				busiest, most = frame, perFrame[frame]
			end
		end
		fightStart, fightEnd = math.min(fightStart, one.first), math.max(fightEnd, one.last)
		if one.endFrame and longest.endFrame and one.endFrame - one.first > longest.endFrame - longest.first then
			longest = one
		end
	end
	say(string.format("fight first=%d last=%d busiest=%d most=%d", fightStart, fightEnd, busiest, most))

	-- 1. Paused during the fight, and held there for five seconds.
	send("pause")
	seekTo(busiest)
	push("run", function()
		measureShots("paused", busiest, held, shots)
	end)
	push("wait", 150)
	push("run", function()
		measureShots("held", busiest, held, shots)
		say("impacts paused=" .. impactCount)
	end)

	-- 2. Twenty seeks to frames with shots in the air, in an order that goes
	-- both ways.
	local frames = {}
	for frame = fightStart, fightEnd do
		if perFrame[frame] then
			frames[#frames + 1] = frame
		end
	end
	for n = 1, 20 do
		local frame = frames[1 + (n * 7919) % #frames]
		seekTo(frame)
		push("run", function()
			measureShots("shots_seek n=" .. n, frame, held, shots)
		end)
	end
	push("run", function()
		say("impacts seeks=" .. impactCount)
	end)

	-- 3. Backward, one shot frame by frame: how far it is from where the track
	-- has it and from where it was fired.
	local flight = longest.endFrame - longest.first - 2
	seekTo(longest.endFrame)
	send("speed 1")
	send("play -1")
	-- Looked at from the frame play has started on.
	push("await", longest.endFrame - 1)
	local def = WeaponDefNames[info.weaponDefs[longest.weapon]].id
	local previous, falls, rises, seen, worst = nil, 0, 0, 0, 0
	push("each", flight, function()
		local frame = param("frame")
		local w = assert(track:seek(frame))
		for p = 1, w.projectileCount do
			if w.projectileSerial[p] == longest.serial and w:projectileExistsAt(p, frame) then
				w:sampleProjectile(p, frame, shot)
				-- Under the ground the player holds it a position step above.
				local floor = math.max(Spring.GetGroundHeight(shot[1], shot[3]), 0)
				if shot[2] <= floor then
					shot[2] = floor + h.positionStep
				end
				local best
				for _, id in ipairs(airborne()) do
					if Spring.GetProjectileDefID(id) == def then
						local px, py, pz = Spring.GetProjectilePosition(id)
						local d = math.sqrt((px - shot[1]) ^ 2 + (py - shot[2]) ^ 2 + (pz - shot[3]) ^ 2)
						if not best or d < best.d then
							best = { d = d, gun = math.sqrt((px - longest.x) ^ 2 + (py - longest.y) ^ 2 + (pz - longest.z) ^ 2) }
						end
					end
				end
				if best then
					seen, worst = seen + 1, math.max(worst, best.d)
					if previous then
						if best.gun < previous then
							falls = falls + 1
						else
							rises = rises + 1
						end
					end
					previous = best.gun
				end
			end
		end
	end)
	send("pause")
	push("run", function()
		say(string.format("backward serial=%d weapon=%s frames=%d seen=%d falls=%d rises=%d place=%.4f shown=%s first=%d impacts=%d", longest.serial, info.weaponDefs[longest.weapon], flight, seen, falls, rises, worst, tostring(param("frame")), longest.first, impactCount))
	end)

	-- 4. The fight watched forward at the match's own speed, then at 4x, then
	-- backward. Only the first lands anything.
	-- A whole number of steps at every speed, so that play lands on the end.
	local from = math.max(first, fightStart - 5)
	local to = math.min(last, from + math.ceil((fightEnd + 30 - from) / 4) * 4)
	local function watch(label, speed, direction)
		local before
		seekTo(direction == 1 and from or to)
		push("run", function()
			before = impactCount
			rawDamage, doneDamage = 0, 0
			featureShotDamage, featureOtherDamage = 0, 0
		end)
		send("speed " .. speed)
		send("play " .. direction)
		push("await", direction == 1 and to or from, math.ceil((to - from) / speed) + PATIENCE)
		send("pause")
		push("wait", 30)
		push("run", function()
			-- How far each impact is from the nearest place a shot of that weapon
			-- stopped moving, along its last frame of flight, and how many left a
			-- mark on the ground.
			local worstOff, total, craters, late = 0, 0, 0, 0
			for n = before + 1, impactCount do
				local hit = impacts[n]
				local best = math.huge
				for _, one in ipairs(shots) do
					if one.endFrame and shotWeapons[hit.def] == one.weapon and math.abs(hit.frame - one.endFrame) <= 3 then
						-- The nearest point of the last frame's flight.
						local length = one.evx ^ 2 + one.evy ^ 2 + one.evz ^ 2
						local along = math.max(0, math.min(1, ((hit.x - one.ex) * one.evx + (hit.y - one.ey) * one.evy + (hit.z - one.ez) * one.evz) / length))
						local d = math.sqrt((hit.x - one.ex - one.evx * along) ^ 2 + (hit.y - one.ey - one.evy * along) ^ 2 + (hit.z - one.ez - one.evz * along) ^ 2)
						best = math.min(best, d)
					end
				end
				if best == math.huge then
					late = late + 1
				else
					worstOff, total = math.max(worstOff, best), total + best
				end
				if math.abs(Spring.GetGroundHeight(hit.x, hit.z) - hit.ground) > 0.01 then
					craters = craters + 1
				end
			end
			local ended = 0
			for _, one in ipairs(shots) do
				if one.endFrame and one.endFrame > from and one.endFrame <= to then
					ended = ended + 1
				end
			end
			local landed = impactCount - before
			if speed <= 2 and direction == 1 then
				-- The shots that ended and have no impact of their weapon near their
				-- end, by weapon, and the first few.
				local missed, listed = {}, 0
				for _, one in ipairs(shots) do
					if one.endFrame and one.endFrame > from and one.endFrame <= to then
						local found = false
						for n = before + 1, impactCount do
							local hit = impacts[n]
							if shotWeapons[hit.def] == one.weapon and math.abs(hit.frame - one.endFrame) <= 3 then
								found = true
								break
							end
						end
						if not found then
							missed[one.weapon] = (missed[one.weapon] or 0) + 1
							if listed < 6 then
								listed = listed + 1
								say(string.format("missed %s serial=%d weapon=%s first=%d end=%d last=%d", label, one.serial, info.weaponDefs[one.weapon], one.first, one.endFrame, one.last))
							end
						end
					end
				end
				for weapon, n in pairs(missed) do
					say(string.format("missed %s weapon=%s shots=%d", label, info.weaponDefs[weapon], n))
				end
			end
			if speed > 2 or direction == -1 then
				-- Nothing should land here, so say what did and what was near.
				for n = before + 1, math.min(impactCount, before + 12) do
					local hit = impacts[n]
					local near = "nothing"
					local unitID = Spring.GetUnitsInSphere(hit.x, hit.y, hit.z, 60)[1]
					local featureID = Spring.GetFeaturesInSphere(hit.x, hit.y, hit.z, 60)[1]
					if unitID then
						near = "unit " .. UnitDefs[Spring.GetUnitDefID(unitID)].name
					elseif featureID then
						near = "feature " .. FeatureDefs[Spring.GetFeatureDefID(featureID)].name
					end
					say(string.format("stray %s weapon=%s frame=%s at=%.1f,%.1f,%.1f ground=%.1f near=%s", label, info.weaponDefs[shotWeapons[hit.def]], tostring(hit.frame), hit.x, hit.y, hit.z, hit.ground, near))
				end
			end
			say(string.format("watched %s speed=%s direction=%d from=%d to=%d shots_ended=%d impacts=%d unmatched=%d off_mean=%.3f off_worst=%.3f craters=%d raw_damage=%d done_damage=%d feature_damage=%d feature_hits_by_deaths=%d feature_damage_by_deaths=%d in_air_after=%d", label, tostring(speed), direction, from, to, ended, landed, late, total / math.max(landed - late, 1), worstOff, craters, rawDamage, doneDamage, featureShotDamage, featureOtherDamage, featureDoneDamage, #airborne()))
			measure("after_" .. label, param("frame"))
		end)
	end
	watch("forward", 1, 1)
	watch("half", 0.5, 1)
	watch("double", 2, 1)
	watch("fast", 4, 1)
	watch("backward", 1, -1)

	-- 5. Across the whole match and back, and to the fight.
	seekTo(first)
	seekTo(last)
	seekTo(first)
	seekTo(busiest)
	seekTo(last)
	push("run", function()
		measure("after_seeks", last)
		measureShots("shots_after_seeks", last, held, shots)
		ending()
		SendToUnsynced(REPORT)
	end)
end

--- The plan for a whole recorded match (issue #3800): all of it forward, all of
-- it backward, ten seeks, and a death at the match's own speed, which is where
-- the base game's own gadgets hear of a unit dying the way they would in a
-- match. Nothing here knows what the match has in it.
local function matchPlan()
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	-- Simulation frames the whole match takes at the fastest speed, and some
	-- over for the message to arrive.
	local whole = math.ceil((last - first) / 32) + PATIENCE
	say(string.format("start first=%d last=%d tolerance=%s step=%s rotation_bits=%d", first, last, tostring(h.tolerance), tostring(h.positionStep), h.rotationBits))

	send("pause")
	seekTo(first)
	send("speed 32")
	send("play 1")
	push("await", last, whole)
	push("wait", SETTLE)
	push("run", function()
		measure("played_forward", last)
		say("play forward_end playing=" .. tostring(param("playing")))
	end)
	send("reverse")
	push("await", first, whole)
	push("wait", SETTLE)
	push("run", function()
		measure("played_backward", first)
		say("play backward_end playing=" .. tostring(param("playing")) .. " direction=" .. tostring(param("direction")))
	end)
	send("pause")
	send("speed 1")
	send("direction 1")

	tenSeeks(first, last)

	local died = death()
	if died then
		local from = math.max(first, died - 20)
		seekTo(from)
		push("run", function()
			say("explosions before_death=" .. explosions)
		end)
		send("play")
		push("wait", 120)
		send("pause")
		push("wait", SETTLE)
		push("run", function()
			say("death last_frame=" .. died)
			say("explosions after_death=" .. explosions)
			measure("played_past_death", param("frame"))
		end)
	else
		say("death none")
	end

	-- A wounded unit, held paused for fifteen seconds. The engine heals an idle
	-- unit and a base game can have a gadget that does, and neither tells
	-- anybody, so a player that only set health when the track's changed would
	-- let it climb.
	local hurt, least = wounded()
	if hurt then
		seekTo(hurt)
		-- The probe reads the unit's health on every frame, between the game's
		-- gadgets and the player's correction.
		push("run", function()
			local lowest, fraction = nil, 2
			for _, unitID in ipairs(liveUnits()) do
				local health, maxHealth = Spring.GetUnitHealth(unitID)
				local _, _, beingBuilt = Spring.GetUnitIsStunned(unitID)
				if not beingBuilt and health / maxHealth < fraction then
					lowest, fraction = unitID, health / maxHealth
				end
			end
			if lowest and GG.rewind_health_probe then
				GG.rewind_health_probe.start(lowest)
			end
		end)
		push("wait", 450)
		push("run", function()
			if GG.rewind_health_probe then
				GG.rewind_health_probe.finish("held_health")
			end
			say(string.format("wounded frame=%d least=%.5f", hurt, least))
			measure("held_wounded", hurt)
		end)
	else
		say("wounded none")
	end

	-- A time before every unit of the match, held long enough for a base game
	-- to decide a team is beaten.
	seekTo(first)
	push("wait", 150)
	seekTo(last)
	push("run", function()
		measure("after_empty", last)
		ending()
		SendToUnsynced(REPORT)
	end)
end

--- The plan for seeks across a whole match (issue #3988): from the first frame
-- to its last minutes, back, to the end, back, and again, each waited for until
-- the player says the world has caught up. Each says how many simulation
-- frames the world took to settle and what the engine has against the track.
-- The player's own slow frame lines in the log say whether a frame took too
-- long, and the work line at the end has the slowest.
local function seeksPlan()
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	local late = math.max(first, last - 10 * h.framesPerSecond)
	say(string.format("start first=%d last=%d tolerance=%s step=%s rotation_bits=%d", first, last, tostring(h.tolerance), tostring(h.positionStep), h.rotationBits))
	send("pause")
	seekTo(first)
	for n, frame in ipairs({ late, first, last, first, late, last, first, late }) do
		local sent
		push("run", function()
			sent = Spring.GetGameFrame()
		end)
		send("seek " .. frame)
		push("await", frame)
		push("settled")
		push("run", function()
			say(string.format("seek_settle n=%d to=%d frames=%d settled=%s", n, frame, Spring.GetGameFrame() - sent, tostring((param("settled")))))
		end)
		push("wait", SETTLE)
		push("run", function()
			measure("seeks n=" .. n, frame)
		end)
	end
	push("run", function()
		SendToUnsynced(REPORT)
	end)
end

local function plan()
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	say(string.format("start first=%d last=%d tolerance=%s step=%s rotation_bits=%d", first, last, tostring(h.tolerance), tostring(h.positionStep), h.rotationBits))
	say(string.format("options frame=%s playing=%s", tostring(param("frame")), tostring(param("playing"))))

	send("pause")
	tenSeeks(first, last)

	local name, born, built = construction()
	if name then
		local middle = math.floor((born + built) / 2)
		for _, case in ipairs({ { "after", math.min(built + 5, last) }, { "during", middle }, { "before", born - 1 }, { "again", middle } }) do
			seekTo(case[2])
			push("run", function()
				local n, building = count(name)
				say(string.format("construction %s def=%s frame=%d units=%d building=%d", case[1], name, case[2], n, building))
			end)
		end
	else
		say("construction none")
	end

	-- Play through a unit's death at the match's own speed, which is the one
	-- case where it dies with the game's death effect. Every unit removed before
	-- this was removed by a seek, so the explosions counted so far say whether
	-- those were quiet. Whatever the engine or the base game leaves where the
	-- unit died has to be gone again for the features to match the track's.
	local died = death()
	if died then
		-- The engine leaves a wreck when the unit's death animation ends, so play
		-- goes on past the first feature the track has after the death, which in
		-- the fixture match is that wreck.
		local wreck = last
		for _, feature in ipairs(features) do
			if feature.firstFrame > died and feature.firstFrame < wreck then
				wreck = feature.firstFrame
			end
		end
		local from = math.max(first, died - 20)
		seekTo(from)
		push("run", function()
			say("explosions before_death=" .. explosions)
		end)
		send("play")
		push("wait", wreck - from + 30)
		send("pause")
		push("wait", SETTLE)
		push("run", function()
			say("death last_frame=" .. died .. " next_feature=" .. wreck)
			say("explosions after_death=" .. explosions)
			measure("played_past_death", param("frame"))
		end)
	else
		say("death none")
	end

	local x, z, before, after = corner()
	if x then
		local size = Game.squareSize
		for _, case in ipairs({ { "end", last, after }, { "start", first, before }, { "end_again", last, after } }) do
			seekTo(case[2])
			push("run", function()
				say(string.format("terrain %s x=%d z=%d wanted=%.3f engine=%.3f", case[1], x, z, case[3], Spring.GetGroundHeight(x * size, z * size)))
			end)
		end
	else
		say("terrain none")
	end

	-- Play: forward at the match's speed, then backward, then to the end at 32x.
	seekTo(first)
	send("play")
	push("wait", 90)
	push("run", function()
		say("play forward shown=" .. tostring(param("frame")) .. " wanted=" .. (first + 90 - 1))
	end)
	send("reverse")
	push("wait", 45)
	push("run", function()
		say("play backward shown=" .. tostring(param("frame")) .. " direction=" .. tostring(param("direction")))
	end)
	send("play 1")
	send("speed 32")
	push("await", last)
	push("wait", SETTLE)
	push("run", function()
		measure("played_to_end", last)
		say("play end playing=" .. tostring(param("playing")) .. " speed=" .. tostring(param("speed")))
	end)

	-- A time before every unit of the match, held long enough for a base game
	-- to decide a team is beaten. Splinter Faction waited 101 frames in the spike.
	send("pause")
	seekTo(first)
	push("wait", 150)
	seekTo(last)
	push("run", function()
		measure("after_empty", last)
		ending()
		longString()
		-- The unsynced half says how long the player's work took, and that the
		-- run is over.
		SendToUnsynced(REPORT)
	end)
end

function gadget:GameFrame()
	if track then
		lookAtDeathGround()
	end
	if not track then
		track = assert(Track.open(assert(Fetch.fromVFS())))
		info, features = assert(track:info()), assert(track:features())
		-- The test that wants a whole match played writes this file beside the
		-- track. Without it the plan is the fixture match's.
		if VFS.FileExists(SEEKS) then
			seeksPlan()
		elseif VFS.FileExists(SHOTS) then
			shotPlan()
		elseif VFS.FileExists(WHOLE_MATCH) then
			matchPlan()
		else
			plan()
		end
		return
	end
	while queue[at] do
		local item = queue[at]
		if item.kind == "send" then
			SendToUnsynced(SEND, item.a)
		elseif item.kind == "run" then
			item.a()
		elseif item.kind == "await" then
			if param("frame") ~= item.a then
				item.waited = item.waited + 1
				if item.waited < (item.b or PATIENCE) then
					return
				end
				say("lost frame=" .. tostring(item.a) .. " shown=" .. tostring(param("frame")))
			end
		elseif item.kind == "settled" then
			-- A player that publishes no such parameter has nothing to wait for.
			if param("settled") == 0 then
				item.waited = item.waited + 1
				if item.waited < PATIENCE then
					return
				end
				say("lost settle")
			end
		elseif item.kind == "each" then
			-- A function run on each of a number of frames.
			item.waited = item.waited + 1
			if item.waited <= item.a then
				item.b()
				return
			end
		elseif item.kind == "wait" then
			item.waited = item.waited + 1
			if item.waited <= item.a then
				return
			end
		end
		at = at + 1
	end
end
