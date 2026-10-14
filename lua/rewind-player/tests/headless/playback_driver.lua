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
	-- The work of the frame that is running: the player's frame (phases 0 and
	-- 1) and its post frame (phases 2 and 3), which are one frame's work. The
	-- post frame alone is summed too, since the aim stage does its work there.
	local current, currentFrame = 0, -1
	local postFrames, postTotal, postWorst = 0, 0, 0
	local micros = Spring.GetTimerMicros ~= nil
	local clock = micros and Spring.GetTimerMicros or Spring.GetTimer

	local function close()
		if currentFrame >= 0 then
			frames, total = frames + 1, total + current
			if current > worst then
				worst, worstFrame = current, currentFrame
			end
		end
		current, currentFrame = 0, -1
	end

	function gadget:RecvFromSynced(name, a, b)
		if name == SEND then
			Spring.SendLuaRulesMsg(a)
			return true
		elseif name == WORK then
			if a == 0 then
				close()
				currentFrame = b
				started = clock()
			elseif a == 2 then
				started = clock()
			elseif started then
				local took = Spring.DiffTimers(clock(), started, true, micros)
				started = nil
				current = current + took
				if a == 3 then
					postFrames, postTotal = postFrames + 1, postTotal + took
					if took > postWorst then
						postWorst = took
					end
				end
			end
			-- The player's own half has to hear it too.
			return false
		elseif name == REPORT then
			close()
			Spring.Echo(
				string.format(
					"REWIND_DRIVER work frames=%d mean_ms=%.3f worst_ms=%.3f worst_frame=%d post_frames=%d post_mean_ms=%.3f post_worst_ms=%.3f",
					frames,
					total / math.max(frames, 1),
					worst,
					worstFrame,
					postFrames,
					postTotal / math.max(postFrames, 1),
					postWorst
				)
			)
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
-- The distance said for a unit or a shot of the track that the engine does not
-- have. It is a number and not an infinity, because the string.format of the
-- engine's Lua raises for one, which left a run with no report at all.
local MISSING = 1e9
-- A file in the playback game that asks for the whole match plan.
local WHOLE_MATCH = "coilbox_rewind/driver_whole_match.lua"
-- And one that asks for the plan that looks at a match's shots.
local SHOTS = "coilbox_rewind/driver_shots.lua"
-- And one that asks for the plan that looks at the teams' resources. It
-- returns a list of frames to look at, or anything else for none.
local RESOURCES = "coilbox_rewind/driver_resources.lua"
-- And one that asks for the plan of seeks across the whole match (issue #3988).
local SEEKS = "coilbox_rewind/driver_seeks.lua"

-- And one that asks for the plan that looks at aim poses (issue #3796). It
-- returns a table: `frames` to seek to, and `off = true` to play with the aim
-- stage switched off, which is how its cost is told from the rest.
local AIM = "coilbox_rewind/driver_aim.lua"

-- And one that asks for the plan that looks at what unit scripts are told
-- (issue #3797). It returns a table: `frames` to seek to, `long`, a number of
-- frames to play forward from the first of them, and `walkPieces`, by unit
-- definition name, the posed pieces a walk turns, which are the script's.
local ANIMATION = "coilbox_rewind/driver_animation.lua"

local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")

local aimAsked = VFS.FileExists(AIM) and VFS.Include(AIM) or nil
local animationAsked = VFS.FileExists(ANIMATION) and VFS.Include(ANIMATION) or nil
-- The driver keeps the call for itself, and takes it out of the table every
-- gadget shares before the player's gadget looks at what the engine has. The
-- player then finds the aim stage's row off, as on an engine without the call.
local getUnitScriptNames = Spring.GetUnitScriptNames
if type(aimAsked) == "table" and aimAsked.off then
	Spring.GetUnitScriptNames = nil
end
-- `nocall = true` stands in for an engine that makes no GameFramePost call
-- (issue #4002): nothing can tell the engine that a handler or a gadget has a
-- function of that name, so the engine never calls one.
if type(aimAsked) == "table" and aimAsked.nocall then
	local update = Script.UpdateCallIn
	Script.UpdateCallIn = function(name)
		if name ~= "GameFramePost" then
			return update(name)
		end
	end
end

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

-- Every row of the track's terrain, by corner: `groundRows[z][x]` is a list of
-- a frame and the height after it, in the order the track has them. It is made
-- the first time it is asked for. Reading every window's terrain for each
-- corner looked at was 1.5 GB of synced Lua in a few frames on a Beyond All
-- Reason match, whose track has 168,000 rows, and the engine stopped.
local groundRows

local function indexGround()
	groundRows = {}
	for k = 0, track.header.windowCount - 1 do
		local rows = assert(track:terrain(k))
		for i = 1, rows.count do
			local row = groundRows[rows.z[i]]
			if not row then
				row = {}
				groundRows[rows.z[i]] = row
			end
			local list = row[rows.x[i]]
			if not list then
				list = {}
				row[rows.x[i]] = list
			end
			list[#list + 1] = rows.frame[i]
			list[#list + 1] = rows.after[i]
		end
	end
end

--- The height the track has a corner of the ground at `frame`: the last row
-- that touches it, or the map's own.
local function trackGround(corner, frame)
	if not groundRows then
		indexGround()
	end
	local size = Game.squareSize
	local height = Spring.GetGroundOrigHeight(corner.x * size, corner.z * size)
	local list = groundRows[corner.z] and groundRows[corner.z][corner.x]
	if list then
		for i = 1, #list, 2 do
			if list[i] <= frame then
				height = list[i + 1]
			end
		end
	end
	return height
end

--- How many corners the track changes are not at the track's height at
-- `frame` in the engine, and the furthest any is (issue #4025).
local function groundAgainstTrack(frame)
	if not groundRows then
		indexGround()
	end
	local size = Game.squareSize
	local corners, wrong, worst = 0, 0, 0
	local corner = { x = 0, z = 0 }
	for z, row in pairs(groundRows) do
		for x in pairs(row) do
			corner.x, corner.z = x, z
			corners = corners + 1
			local off = math.abs(Spring.GetGroundHeight(x * size, z * size) - trackGround(corner, frame))
			if off > 0.001 then
				wrong = wrong + 1
			end
			worst = math.max(worst, off)
		end
	end
	return corners, wrong, worst
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
				worst = math.max(worst, math.abs(actual - trackGround(corner, frame)))
			end
		end
		say(string.format("death_ground weapon=%s frame=%s crater_mult=%s crater_aoe=%.1f damage_aoe=%.1f looked=%d changed_from_map=%d off_worst=%.3f", def.name, tostring(frame), tostring(def.damages and def.damages.craterMult), def.craterAreaOfEffect or 0, def.damageAreaOfEffect or 0, looked, changed, worst))
		deathExplosions[n] = nil
	end
	deathCount = 0
end

--- Seeks, waits for the player to show the frame and say that the world has
-- caught up (a seek can take several frames, issue #3988), and lets the engine
-- settle.
local function seekTo(frame)
	send("seek " .. frame)
	push("await", frame)
	push("settled")
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
				worstPlace = MISSING
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
			"%s frame=%s shown=%s track_units=%d engine_units=%d track_features=%d engine_features=%d place=%.4f turn=%.5f health=%.5f build=%.5f health_over=%.8f build_over=%.8f wrong_build_state=%d",
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
	-- on its last frame by a frame of its flight, or twice the tolerance when
	-- that is more, and a bolt by a frame of its flight from the frame before it
	-- stops. `short` is how many were, `place` the
	-- furthest any other shot is from the track, and `over` the furthest any
	-- shot is past what it may be.
	local short, over = 0, 0
	local bySerial = {}
	for _, one in ipairs(shots) do
		bySerial[one.serial] = one
	end
	-- The shots held where the track has them choose first, since one held short
	-- can be where the next shot of a burst is (issue #4026).
	local found = {}
	for p = 1, w.projectileCount do
		local weapon = w.projectileWeapon[p] + 1
		if w.projectileWeapon[p] ~= 65535 and held[weapon] and w:projectileExistsAt(p, frame) then
			wanted = wanted + 1
			w:sampleProjectile(p, frame, shot)
			local one = bySerial[w.projectileSerial[p]]
			local slack = 0
			if one.endFrame and one.endFrame < one.last then
				if frame > one.endFrame - 1 then
					slack = math.sqrt(one.evx ^ 2 + one.evy ^ 2 + one.evz ^ 2)
				end
			elseif frame > one.last - 1 then
				-- A frame of its flight, and twice the tolerance for a slower shot.
				slack = math.max(2 * h.tolerance, math.sqrt(shot[4] ^ 2 + shot[5] ^ 2 + shot[6] ^ 2))
			end
			found[#found + 1] = { weapon = weapon, slack = slack, shot[1], shot[2], shot[3], shot[4], shot[5], shot[6] }
		end
	end
	table.sort(found, function(a, b)
		return (a.slack > 0 and 1 or 0) < (b.slack > 0 and 1 or 0)
	end)
	for _, one in ipairs(found) do
		local weapon, slack = one.weapon, one.slack
		shot[1], shot[2], shot[3], shot[4], shot[5], shot[6] = one[1], one[2], one[3], one[4], one[5], one[6]
		do
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
				worstPlace = MISSING
			end
		end
	end
	say(string.format("%s frame=%s shown=%s track_shots=%d engine_shots=%d raised=%d short=%d place=%.4f over=%.4f turn=%.6f speed=%.4f", label, tostring(frame), tostring(param("frame")), wanted, #engine, raised, short, worstPlace, over, worstTurn, worstSpeed))
end

--- The plan for the shots of a whole recorded match: what is in the air paused
-- during a fight and at seeks, a shot followed backward frame by frame, the
-- fight watched forward at the match's own speed, then at 4x and backward, and
-- a seek across the whole match and back.
--
-- `asked` is what the file that asks for the plan returns. A table with `from`
-- and `to` keeps the plan to the shots that are fired and end between those two
-- frames. A Beyond All Reason match has shots in the air from its first minutes
-- to its last, and the plan plays the frames its shots span five times over.
local function shotPlan(asked)
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	say(string.format("start first=%d last=%d tolerance=%s step=%s rotation_bits=%d", first, last, tostring(h.tolerance), tostring(h.positionStep), h.rotationBits))
	local held = weapons()
	local shots = allShots(held)
	-- The shots whose frames the plan plays. Every shot of the track is still
	-- measured against, since a frame in the span has shots from outside it.
	local span = shots
	if type(asked) == "table" and asked.from and asked.to then
		span = {}
		for _, one in ipairs(shots) do
			if one.first >= asked.from and one.last <= asked.to then
				span[#span + 1] = one
			end
		end
		say(string.format("shots between from=%d to=%d kept=%d of=%d", asked.from, asked.to, #span, #shots))
	end
	say("shots held_kinds=" .. #span)
	if #span == 0 then
		SendToUnsynced(REPORT)
		return
	end

	-- The frame with the most in the air, and the frames the fight spans.
	local perFrame, busiest, most = {}, nil, 0
	local fightStart, fightEnd = span[1].first, span[1].last
	local longest = span[1]
	for _, one in ipairs(span) do
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
			-- stopped moving, along its flight from a frame before its last place to
			-- a frame after it, and how many left a mark on the ground. The engine
			-- finds a unit or a feature along a shot's speed from where it is, and
			-- the ground between where it was before its last move and where it is
			-- (CProjectileHandler::CheckGroundCollisions), so a shot that hit the
			-- ground landed short of its last place (issue #4026).
			local function off(one, hit)
				if not one.endFrame or shotWeapons[hit.def] ~= one.weapon or math.abs(hit.frame - one.endFrame) > 3 then
					return nil
				end
				local length = one.evx ^ 2 + one.evy ^ 2 + one.evz ^ 2
				local along = math.max(-1, math.min(1, ((hit.x - one.ex) * one.evx + (hit.y - one.ey) * one.evy + (hit.z - one.ez) * one.evz) / length))
				return math.sqrt((hit.x - one.ex - one.evx * along) ^ 2 + (hit.y - one.ey - one.evy * along) ^ 2 + (hit.z - one.ez - one.evz * along) ^ 2)
			end
			local worstOff, total, craters, late = 0, 0, 0, 0
			for n = before + 1, impactCount do
				local hit = impacts[n]
				local best = math.huge
				for _, one in ipairs(shots) do
					local d = off(one, hit)
					if d and d < best then
						best = d
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
			-- A flame that reaches the end of its life goes with no impact, and one
			-- that touches the ground only slides along it (CFlameProjectile), so a
			-- flame's end in the track can be a landing or not. The ones with no
			-- impact are counted apart.
			local unlandedFlames = 0
			if speed <= 2 and direction == 1 then
				-- The shots that ended and have no impact of their own near their end,
				-- by weapon, and the first few. Each impact is the nearest shot's that
				-- has none yet, since shots of a burst end on the same frames.
				local claimed = {}
				for n = before + 1, impactCount do
					local hit = impacts[n]
					local best, bestOne = math.huge, nil
					for _, one in ipairs(shots) do
						local d = not claimed[one] and off(one, hit)
						if d and d < best then
							best, bestOne = d, one
						end
					end
					if bestOne then
						claimed[bestOne] = true
					end
				end
				local missed, listed = {}, 0
				for _, one in ipairs(shots) do
					if one.endFrame and one.endFrame > from and one.endFrame <= to then
						local found = claimed[one]
						if not found and WeaponDefNames[info.weaponDefs[one.weapon]].type == "Flame" then
							unlandedFlames = unlandedFlames + 1
						elseif not found then
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
			say(string.format("watched %s speed=%s direction=%d from=%d to=%d shots_ended=%d flames_unlanded=%d impacts=%d unmatched=%d off_mean=%.3f off_worst=%.3f craters=%d raw_damage=%d done_damage=%d feature_damage=%d feature_hits_by_deaths=%d feature_damage_by_deaths=%d in_air_after=%d", label, tostring(speed), direction, from, to, ended, unlandedFlames, landed, late, total / math.max(landed - late, 1), worstOff, craters, rawDamage, doneDamage, featureShotDamage, featureOtherDamage, featureDoneDamage, #airborne()))
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
	push("settled")
	push("wait", SETTLE)
	push("run", function()
		measure("played_forward", last)
		say("play forward_end playing=" .. tostring(param("playing")))
	end)
	send("reverse")
	push("await", first, whole)
	push("settled")
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

-- Team resources (issue #3982).

--- A number as the engine holds it, which is in 32 bits.
local function single(value)
	return VFS.UnpackF32(VFS.PackF32(value))
end

local RESOURCE_CODES = { "held", "storage", "pull", "income", "expense", "share", "sent", "received", "excess" }

--- What the driver's own reader has for a number of a team at `frame`. A
-- resource with no track is 0 and a rules parameter with none is not set.
local function trackValue(w, team, code, frame)
	local v = w:valueOf(team, code)
	if v then
		return w:sampleValue(v, frame)
	end
	if code < Track.VALUE.PARAMETER then
		return 0
	end
end

--- The teams of the track that the engine has.
local function resourceTeams()
	local has, teams = {}, {}
	for _, team in ipairs(Spring.GetTeamList()) do
		has[team] = true
	end
	for _, team in ipairs(info.teams) do
		if has[team.id] then
			teams[#teams + 1] = team.id
		end
	end
	return teams
end

--- How far what the teams hold and can store is from the track at `frame`: the
-- most over every team, for metal and energy. What a team holds is compared as
-- the engine holds it, cut to its storage.
local function heldOff(frame)
	local w = assert(track:seek(frame))
	local CODE = Track.VALUE
	local worst = 0
	for _, team in ipairs(resourceTeams()) do
		for r, name in ipairs({ "metal", "energy" }) do
			local base = (r - 1) * CODE.ENERGY
			local held, storage = Spring.GetTeamResources(team, name)
			local wantStorage = single(trackValue(w, team, base + CODE.STORAGE, frame))
			local wantHeld = math.min(single(trackValue(w, team, base + CODE.HELD, frame)), wantStorage)
			worst = math.max(worst, math.abs(held - wantHeld), math.abs(storage - wantStorage))
		end
	end
	return worst
end

--- A line for each resource of each team with the engine's nine numbers and
-- the track's, and one for each rules parameter the track has.
local function measureResources(label, frame)
	local w = assert(track:seek(frame))
	local CODE = Track.VALUE
	for _, team in ipairs(resourceTeams()) do
		for r, name in ipairs({ "metal", "energy" }) do
			local base = (r - 1) * CODE.ENERGY
			local engine = { Spring.GetTeamResources(team, name) }
			-- The engine's order is held, storage, pull, income, expense, share,
			-- sent, received and excess, which is the order of the track's codes.
			local parts = {}
			for i, key in ipairs(RESOURCE_CODES) do
				parts[#parts + 1] = string.format("%s=%.4f track_%s=%.4f", key, engine[i], key, trackValue(w, team, base + i - 1, frame))
			end
			-- How far what the team holds and can store is from the track's, as
			-- the engine holds a number, with what it holds cut to its storage.
			local wantStorage = single(trackValue(w, team, base + CODE.STORAGE, frame))
			local wantHeld = math.min(single(trackValue(w, team, base + CODE.HELD, frame)), wantStorage)
			local off = math.max(math.abs(engine[1] - wantHeld), math.abs(engine[2] - wantStorage))
			say(string.format("resources %s frame=%d team=%d resource=%s held_off=%.6f %s", label, frame, team, name, off, table.concat(parts, " ")))
		end
		for j, name in ipairs(info.teamParams) do
			local wanted = trackValue(w, team, CODE.PARAMETER + j - 1, frame)
			local engine = Spring.GetTeamRulesParam(team, name)
			-- A parameter the match had not set is the game's to have or not.
			local off = wanted and (engine and math.abs(engine - single(wanted)) or -1) or 0
			say(string.format("team_param %s frame=%d team=%d name=%s engine=%s track=%s off=%.6f", label, frame, team, name, tostring(engine), tostring(wanted), off))
		end
	end
	for j, name in ipairs(info.gameParams) do
		local wanted = trackValue(w, CODE.NO_TEAM, CODE.PARAMETER + j - 1, frame)
		local engine = Spring.GetGameRulesParam(name)
		local off = wanted and (engine and math.abs(engine - single(wanted)) or -1) or 0
		say(string.format("game_param %s frame=%d name=%s engine=%s track=%s off=%.6f", label, frame, name, tostring(engine), tostring(wanted), off))
	end
end

--- The plan that looks at the teams' resources: the frames it is asked for and
-- eight more across the match, each seeked to going forward and then again
-- going backward, one of them held paused for 600 frames, and 300 frames of
-- play each way. This gadget runs before the player's on a frame, so what it
-- reads is what the frame before left, which is what a widget draws.
local function resourcePlan(asked)
	local h = track.header
	local first, last = h.firstFrame, h.lastFrame
	say(
		string.format(
			"start first=%d last=%d recorder=%d resource_tolerance=%s resource_fraction=%s team_params=%d game_params=%d",
			first,
			last,
			h.recorderVersion,
			tostring(h.resourceTolerance),
			tostring(h.resourceFraction),
			#info.teamParams,
			#info.gameParams
		)
	)
	local frames = {}
	for _, frame in ipairs(type(asked) == "table" and asked or {}) do
		if frame >= first and frame <= last then
			frames[#frames + 1] = frame
		end
	end
	for i = 1, 8 do
		frames[#frames + 1] = first + math.floor((last - first) * i / 9)
	end
	table.sort(frames)

	send("pause")
	-- Three of the engine's sums after a seek, which is when income, expense and
	-- pull have had the playback's own taken off: the first sum after a seek
	-- still has what the units of the frame before it made, and the player
	-- knows the playback's own from the sum before.
	local sums = 3 * 30 + SETTLE
	for _, frame in ipairs(frames) do
		seekTo(frame)
		push("wait", sums)
		push("run", function()
			measureResources("forward", frame)
		end)
	end
	for i = #frames - 1, 1, -1 do
		local frame = frames[i]
		seekTo(frame)
		push("run", function()
			say(string.format("seek_back frame=%d held_off=%.6f", frame, heldOff(frame)))
		end)
	end

	-- Held paused.
	local middle = frames[math.ceil(#frames / 2)]
	seekTo(middle)
	local worst, looked = 0, 0
	push("each", 600, function()
		worst, looked = math.max(worst, heldOff(middle)), looked + 1
	end)
	push("run", function()
		say(string.format("held_resources frame=%d frames=%d held_off=%.6f", middle, looked, worst))
		measureResources("held", middle)
	end)

	-- Played at the match's own speed, forward and then backward. The time the
	-- player shows is the time its numbers are of.
	for _, way in ipairs({ { "forward", "play 1" }, { "backward", "reverse" } }) do
		local off, seen, from = 0, 0, nil
		send(way[2])
		push("wait", SETTLE)
		push("each", 300, function()
			local shown = param("frame")
			from = from or shown
			off, seen = math.max(off, heldOff(shown)), seen + 1
		end)
		push("run", function()
			say(string.format("played_resources way=%s from=%s to=%s frames=%d held_off=%.6f", way[1], tostring(from), tostring(param("frame")), seen, off))
		end)
	end
	send("pause")
	push("run", function()
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
			local corners, wrong, worst = groundAgainstTrack(frame)
			say(string.format("seek_ground n=%d frame=%d corners=%d wrong=%d worst=%.4f", n, frame, corners, wrong, worst))
		end)
	end
	push("run", function()
		SendToUnsynced(REPORT)
	end)
end

-- Aim poses (issue #3796).

-- The posed piece names of a unit definition, by its place in the track's list.
local posedNames
-- The script's piece numbers of an engine unit, by name, read once for a unit.
local scriptNames = {}
local pose = { 0, 0, 0, 0, 0, 0 }
local TURN = 2 * math.pi
-- Half a step of what the track stores: an angle in 65,536ths of a turn, and
-- an offset in position steps. A piece further from the track than this was
-- not set to the track's value.
local TURN_LIMIT = math.pi / 65536

--- How far two angles are apart, taking a whole turn for none.
local function apart(a, b)
	local d = math.abs(a - b) % TURN
	return math.min(d, TURN - d)
end

--- Looks at every posed piece of every unit the track has at the time the
-- player last showed, and adds to `sum` what it finds: `pieces` looked at,
-- `turned` of them that the track has away from rest, `bad` of them that are
-- not the track's, the worst turn and offset from it, `absent` units that the
-- engine does not have yet, `missing` pieces a script lacks, and of all the
-- engine's units, `wounded` ones and ones whose maximum health is not their
-- definition's (issue #4002). `skip` is, by unit definition name, the posed
-- pieces that a walk turns, which the aim stage leaves to the unit's own
-- script (issue #3797) and this does not look at.
local function aimLook(sum, skip)
	local frame = param("frame")
	local w = assert(track:seek(frame))
	local moveLimit = track.header.positionStep / 2
	local UnitScript = Spring.UnitScript
	local byPlace = {}
	for _, unitID in ipairs(liveUnits()) do
		local x, y, z = Spring.GetUnitPosition(unitID)
		byPlace[string.format("%d %.3f %.3f %.3f", Spring.GetUnitDefID(unitID), x, y, z)] = unitID
		local health, maxHealth = Spring.GetUnitHealth(unitID)
		if health < maxHealth then
			sum.wounded = sum.wounded + 1
		end
		if maxHealth ~= UnitDefs[Spring.GetUnitDefID(unitID)].health then
			sum.lowered = sum.lowered + 1
		end
	end
	sum.looks = sum.looks + 1
	for i = 1, w.unitCount do
		local names = posedNames[w.unitDef[i] + 1]
		local def = UnitDefNames[info.unitDefs[w.unitDef[i] + 1]]
		local unitID
		if def and w:unitExistsAt(i, frame) then
			w:sampleTransform(i, frame, transform)
			unitID = byPlace[string.format("%d %.3f %.3f %.3f", def.id, transform[1], transform[2], transform[3])]
			if unitID then
				-- A finished unit's health against the track's, as the frame before
				-- left it. The player keeps a unit one step of health above none.
				w:sampleStatus(i, frame, status)
				if status[2] >= 1 then
					local health, maxHealth = Spring.GetUnitHealth(unitID)
					local off = math.abs(health / maxHealth - math.max(status[1], 1 / 65535))
					if off > 1 / 65535 then
						sum.healthOff = sum.healthOff + 1
					end
					sum.worstHealth = math.max(sum.worstHealth, off)
				end
			end
		end
		if names and def and w:unitExistsAt(i, frame) then
			if not unitID then
				sum.absent = sum.absent + 1
			else
				local script = scriptNames[unitID]
				if not script then
					script = getUnitScriptNames(unitID)
					scriptNames[unitID] = script
				end
				-- The pose track of each posed piece, or none for one at rest.
				local trackOf = {}
				for poseTrack = w.unitPoseFirst[i], w.unitPoseFirst[i] + w.unitPoseCount[i] - 1 do
					trackOf[w.posePiece[poseTrack] + 1] = poseTrack
				end
				local walks = skip and skip[def.name]
				for k, name in ipairs(names) do
					local number = script[name]
					if walks and walks[name] then
						sum.walked = (sum.walked or 0) + 1
					elseif not number then
						sum.missing = sum.missing + 1
					else
						pose[1], pose[2], pose[3], pose[4], pose[5], pose[6] = 0, 0, 0, 0, 0, 0
						if trackOf[k] then
							w:samplePose(trackOf[k], frame, pose)
						end
						local rx, ry, rz = UnitScript.CallAsUnit(unitID, UnitScript.GetPieceRotation, number + 1)
						local px, py, pz = UnitScript.CallAsUnit(unitID, UnitScript.GetPieceTranslation, number + 1)
						local turn = math.max(
							apart(rx, (pose[1] % 65536) * TURN / 65536),
							apart(ry, (pose[2] % 65536) * TURN / 65536),
							apart(rz, (pose[3] % 65536) * TURN / 65536)
						)
						local move = math.max(math.abs(px - pose[4]), math.abs(py - pose[5]), math.abs(pz - pose[6]))
						sum.pieces = sum.pieces + 1
						if pose[1] % 65536 ~= 0 or pose[2] % 65536 ~= 0 or pose[3] % 65536 ~= 0 or pose[4] ~= 0 or pose[5] ~= 0 or pose[6] ~= 0 then
							sum.turned = sum.turned + 1
						end
						if turn > TURN_LIMIT or move > moveLimit then
							sum.bad = sum.bad + 1
						end
						sum.worstTurn, sum.worstMove = math.max(sum.worstTurn, turn), math.max(sum.worstMove, move)
					end
				end
			end
		end
	end
end

local function aimSum()
	return {
		looks = 0,
		pieces = 0,
		turned = 0,
		bad = 0,
		absent = 0,
		missing = 0,
		wounded = 0,
		lowered = 0,
		healthOff = 0,
		worstTurn = 0,
		worstMove = 0,
		worstHealth = 0,
	}
end

local function aimSay(label, sum)
	say(
		string.format(
			"aim %s shown=%s looks=%d pieces=%d turned=%d bad=%d worst_turn=%.7f worst_move=%.5f absent=%d missing=%d wounded=%d lowered_max=%d health_off=%d worst_health=%.6f",
			label,
			tostring(param("frame")),
			sum.looks,
			sum.pieces,
			sum.turned,
			sum.bad,
			sum.worstTurn,
			sum.worstMove,
			sum.absent,
			sum.missing,
			sum.wounded,
			sum.lowered,
			sum.healthOff,
			sum.worstHealth
		)
	)
end

--- The frames to seek to when the test names none: the six frames with the
-- most pieces away from rest, among every 30th frame of the track, no two of
-- them within 150 frames.
local function aimFrames()
	local h = track.header
	local scored = {}
	for frame = h.firstFrame, h.lastFrame - 100, 30 do
		local w = assert(track:seek(frame))
		local n = 0
		for i = 1, w.unitCount do
			if w:unitExistsAt(i, frame) then
				for poseTrack = w.unitPoseFirst[i], w.unitPoseFirst[i] + w.unitPoseCount[i] - 1 do
					w:samplePose(poseTrack, frame, pose)
					if pose[1] % 65536 ~= 0 or pose[2] % 65536 ~= 0 or pose[3] % 65536 ~= 0 then
						n = n + 1
					end
				end
			end
		end
		scored[#scored + 1] = { frame = frame, n = n }
	end
	table.sort(scored, function(a, b)
		if a.n ~= b.n then
			return a.n > b.n
		end
		return a.frame < b.frame
	end)
	local frames = {}
	for _, item in ipairs(scored) do
		local clear = true
		for _, taken in ipairs(frames) do
			if math.abs(taken - item.frame) < 150 then
				clear = false
			end
		end
		if clear and item.n > 0 and #frames < 6 then
			frames[#frames + 1] = item.frame
		end
	end
	table.sort(frames)
	return frames
end

--- The plan for aim poses: seeks into the match's fights, and at each a look on
-- the first frame the seek is shown, on each of 60 frames paused, and on each of
-- 90 frames played forward and 90 played backward at the match's own speed. The
-- driver's frame runs before the player's, so a look reads what the frame
-- before left when it was over, at the time that frame showed. `asked.frames`
-- are the frames to seek to.
local function aimPlan(asked)
	local h = track.header
	posedNames = {}
	for _, posed in ipairs(info.posedPieces) do
		posedNames[posed.unitDef + 1] = posed.pieces
	end
	local frames = type(asked) == "table" and asked.frames or nil
	if not frames or #frames == 0 then
		frames = aimFrames()
	end
	local walkPieces = type(asked) == "table" and asked.walkPieces or nil
	say(string.format("start first=%d last=%d seeks=%d posed_defs=%d", h.firstFrame, h.lastFrame, #frames, #info.posedPieces))
	send("pause")
	seekTo(h.firstFrame)
	for n, frame in ipairs(frames) do
		send("seek " .. frame)
		push("await", frame)
		-- The message changes the published frame as it arrives. The frame that
		-- shows it is the next one.
		push("wait", 1)
		push("run", function()
			local sum = aimSum()
			aimLook(sum, walkPieces)
			aimSay("first n=" .. n .. " frame=" .. frame .. " settled=" .. tostring(param("settled")), sum)
		end)
		local held = aimSum()
		push("each", 60, function()
			aimLook(held, walkPieces)
		end)
		push("run", function()
			aimSay("held n=" .. n .. " frame=" .. frame, held)
		end)
		for _, way in ipairs({ { "forward", "play 1" }, { "backward", "play -1" } }) do
			local sum = aimSum()
			send(way[2])
			push("each", 90, function()
				aimLook(sum, walkPieces)
			end)
			push("run", function()
				aimSay(way[1] .. " n=" .. n .. " frame=" .. frame, sum)
			end)
		end
		send("pause")
		push("wait", SETTLE)
	end
	-- A long rest, paused, for a game whose units heal only after they have
	-- stood idle for a while.
	local rest = type(asked) == "table" and tonumber(asked.rest) or 0
	if rest > 0 and #frames > 0 then
		local frame = frames[#frames]
		seekTo(frame)
		local sum = aimSum()
		push("each", rest, function()
			aimLook(sum, walkPieces)
		end)
		push("run", function()
			aimSay("rest frame=" .. frame, sum)
		end)
	end
	push("run", function()
		SendToUnsynced(REPORT)
	end)
end

-- Unit scripts (issue #3797).

-- What the player told a unit's script, heard at the two calls it tells one
-- through: `unit`, `name`, `how` ("lua" or "cob") and the two arguments.
local heard, heardCount, heardRead = {}, 0, 0
local WATCHED = { "StartMoving", "StopMoving", "StartBuilding", "StopBuilding" }

-- The functions each unit's Lua script has, of those four, by unit id.
local luaHas = {}

local function hear(unitID, name, how, a, b)
	heardCount = heardCount + 1
	heard[heardCount] = { unit = unitID, name = name, how = how, a = a, b = b }
end

if animationAsked then
	-- This file loads after the player's, so the call it finds is the player's
	-- wrap. The functions put in the table here are the ones the player keeps
	-- and the engine is given, so a count here is a count of the script's own
	-- function being run, whoever ran it.
	local create = Spring.UnitScript.CreateScript
	Spring.UnitScript.CreateScript = function(unitID, callIns, ...)
		luaHas[unitID] = {}
		for _, name in ipairs(WATCHED) do
			local fn = callIns[name]
			if fn then
				luaHas[unitID][name] = true
				callIns[name] = function(...)
					local a, b = ...
					hear(unitID, name, "lua", a, b)
					return fn(...)
				end
			end
		end
		return create(unitID, callIns, ...)
	end
	-- A COB function is run through this call, by number.
	local call = Spring.CallCOBScript
	local numbers = {}
	Spring.CallCOBScript = function(unitID, func, ...)
		local name = func
		if type(func) == "number" then
			local defID = Spring.GetUnitDefID(unitID)
			local known = numbers[defID]
			if not known then
				known = {}
				for _, watched in ipairs(WATCHED) do
					local number = Spring.GetCOBScriptID(unitID, watched)
					if number then
						known[number] = watched
					end
				end
				numbers[defID] = known
			end
			name = known[func] or ("function " .. func)
		end
		local _, a, b = ...
		hear(unitID, name, "cob", a, b)
		return call(unitID, func, ...)
	end
end

-- What the driver takes each unit's script to have been told last, by the
-- track's serial number: 0 for standing, 1 for moving and 2 for reversing, and
-- its work as a text.
local toldMoving, toldJob = {}, {}
-- Whether the next look is the first after a seek made while paused, which
-- told every builder at work that it works.
local afterPausedSeek = false
-- The frame a seek made while playing goes to, from the look that sees its
-- message arrive until the look that sees the world there.
local seekingTo = nil
-- The engine's unit a serial number was last seen as, and back.
local seenAs, serialOfUnit = {}, {}
-- The pieces of a unit that the track has no poses for, as script numbers, and
-- what they added up to at the last look.
local freePieces, pieceSum = {}, {}
local lastShown, lastRate = nil, 0
local other = { 0, 0, 0, 0, 0, 0, 0 }
local target = { 0, 0, 0, 0, 0, 0 }
local velocity = { 0, 0, 0 }
local RATES = { [0] = true, [0.5] = true, [1] = true, [2] = true, [4] = true, [8] = true, [16] = true, [32] = true }

local function animationSum()
	return {
		looks = 0,
		units = 0,
		absent = 0,
		movingLooks = 0,
		movingAnimated = 0,
		standingLooks = 0,
		standingAnimated = 0,
		movingMost = 0,
		expected = 0,
		heard = 0,
		missing = 0,
		extra = 0,
		want = {},
		got = {},
		argsBad = 0,
		velocityBad = 0,
		worstVelocity = 0,
		fastest = 0,
		builders = 0,
		working = 0,
		paramsBad = 0,
		headings = 0,
		headingBad = 0,
		worstHeading = 0,
		lua = 0,
		cob = 0,
		unknown = 0,
		notes = {},
		byDef = {},
	}
end

local function note(sum, text)
	if #sum.notes < 6 then
		sum.notes[#sum.notes + 1] = text
	end
end

--- The sum of every turn and offset of a unit's pieces that the track has no
-- poses for, which only the unit's own script moves.
local function ownPieces(unitID, def)
	local pieces = freePieces[unitID]
	if not pieces then
		pieces = {}
		local posed = {}
		for _, name in ipairs(posedNames[def] or {}) do
			posed[name] = true
		end
		for name, number in pairs(getUnitScriptNames(unitID) or {}) do
			if not posed[name] then
				pieces[#pieces + 1] = number + 1
			end
		end
		table.sort(pieces)
		freePieces[unitID] = pieces
	end
	local UnitScript = Spring.UnitScript
	local sum = 0
	for _, piece in ipairs(pieces) do
		local rx, ry, rz = UnitScript.CallAsUnit(unitID, UnitScript.GetPieceRotation, piece)
		local px, py, pz = UnitScript.CallAsUnit(unitID, UnitScript.GetPieceTranslation, piece)
		sum = sum + rx + 2 * ry + 3 * rz + 5 * px + 7 * py + 11 * pz
	end
	return sum
end

--- Whether a unit's script has a function, which is when the engine would
-- call it.
local function scriptHas(unitID, name)
	if luaHas[unitID] then
		return luaHas[unitID][name] == true
	end
	return Spring.GetCOBScriptID(unitID, name) ~= nil
end

--- A wrapped angle's distance from another.
local function angleOff(a, b)
	local d = math.abs(a - b) % TURN
	return math.min(d, TURN - d)
end

--- Looks at every unit the track has at the time the player last showed, and
-- at what its script was told since the last look. Adds to `sum`:
--
-- - `expected` script calls, worked out from the track by this file's own
--   reader, `heard` calls the scripts got, and `missing` and `extra`, the
--   expected ones not heard in this look and the heard ones not expected.
--   `want` and `got` count them by unit and name over the whole of `sum`.
-- - `velocityBad` units whose velocity is not the track's times the rate of
--   play, read with Spring.GetUnitVelocity.
-- - `movingAnimated` of `movingLooks`, the units the track has moving whose
--   own pieces moved since the last look, and the same for standing ones.
-- - `paramsBad` builders whose unit rules parameters are not the track's work.
-- - `headingBad` of `headings` calls of StartBuilding whose angles are not the
--   engine's own, from the unit's vectors and middle as the engine has them.
--
-- A message changes the frame the player publishes as it arrives, and the
-- world shows it a frame later. So in the look that sees a seek's message
-- arrive, the world is still where play had taken it, and that is the time
-- looked at. The look after sees the world at the seek's frame, which is the
-- frame the player tells every builder at work that it works, since a seek
-- may have turned it. Gives true for the first of those two looks.
local function animationLook(sum)
	local frame = param("frame")
	local rate = lastShown and frame - lastShown or 0
	local arriving = not RATES[math.abs(rate)]
	local shown = false
	if arriving then
		-- The world is one frame of play on from the last look.
		seekingTo = frame
		rate = lastRate
		frame = lastShown + lastRate
	elseif seekingTo then
		shown = seekingTo == frame
		seekingTo = nil
		if shown then
			rate = lastRate
		end
	end
	local w = assert(track:seek(frame))
	local flipped = rate ~= 0 and lastRate ~= 0 and (rate > 0) ~= (lastRate > 0)
	lastShown = arriving and seekingTo or frame
	if rate ~= 0 then
		lastRate = rate
	end
	local again = shown or afterPausedSeek
	local quiet = afterPausedSeek
	afterPausedSeek = false
	sum.looks = sum.looks + 1
	sum.fastest = math.max(sum.fastest, math.abs(rate))

	local byPlace = {}
	for _, unitID in ipairs(liveUnits()) do
		local x, y, z = Spring.GetUnitPosition(unitID)
		byPlace[string.format("%d %.3f %.3f %.3f", Spring.GetUnitDefID(unitID), x, y, z)] = unitID
	end
	local unitAt = {}
	for i = 1, w.unitCount do
		local def = UnitDefNames[info.unitDefs[w.unitDef[i] + 1]]
		if def and w:unitExistsAt(i, frame) then
			w:sampleTransform(i, frame, transform)
			local unitID = byPlace[string.format("%d %.3f %.3f %.3f", def.id, transform[1], transform[2], transform[3])]
			unitAt[i] = unitID
			if unitID then
				local serial = w.unitSerial[i]
				if seenAs[serial] ~= unitID then
					-- Another unit than the one last seen, which has been told nothing.
					seenAs[serial] = unitID
					toldMoving[serial], toldJob[serial] = 0, nil
					pieceSum[unitID] = nil
				end
				serialOfUnit[unitID] = serial
			else
				sum.absent = sum.absent + 1
			end
		end
	end

	-- What the scripts should have been told, from the track.
	local want = {}
	local function expect(serial, name, unitID)
		if not scriptHas(unitID, name) then
			return
		end
		sum.expected = sum.expected + 1
		local key = serial .. " " .. name
		want[key] = (want[key] or 0) + 1
		sum.want[key] = (sum.want[key] or 0) + 1
	end
	local movingNow = 0
	local startArg, headingOf = {}, {}
	for i = 1, w.unitCount do
		local unitID = unitAt[i]
		if unitID then
			local serial = w.unitSerial[i]
			local def = UnitDefNames[info.unitDefs[w.unitDef[i] + 1]]
			sum.units = sum.units + 1
			w:sampleStatus(i, frame, status)
			local finished = status[2] >= 1
			-- The reader's own slope. A difference of two places sampled a part of
			-- a frame apart would be off by more than the engine's numbers hold: a
			-- 32 bit float has steps of a thousandth of an elmo at 8,192 elmos.
			w:sampleTransform(i, frame, transform)
			w:sampleVelocity(i, frame, velocity)
			local vx, vy, vz = velocity[1], velocity[2], velocity[3]
			local moves = false
			if rate == 0 or not finished then
				vx, vy, vz = 0, 0, 0
			else
				moves = vx * vx + vy * vy + vz * vz > 0.0001
				vx, vy, vz = vx * rate, vy * rate, vz * rate
			end
			if not def.isImmobile then
				do
					local ex, ey, ez = Spring.GetUnitVelocity(unitID)
					local off = math.max(math.abs(ex - vx), math.abs(ey - vy), math.abs(ez - vz))
					sum.worstVelocity = math.max(sum.worstVelocity, off)
					if off > 0.0001 then
						sum.velocityBad = sum.velocityBad + 1
						note(sum, string.format("velocity %s at %s: engine %.3f %.3f %.3f track %.3f %.3f %.3f", def.name, tostring(frame), ex, ey, ez, vx, vy, vz))
					end
				end
				local was = toldMoving[serial] or 0
				if moves then
					movingNow = movingNow + 1
					-- A unit that moves against its facing reverses. A script is told
					-- again when play turns round and that changes.
					local fx, _, fz = directions(transform[4], transform[5], transform[6], transform[7])
					local state = (vx * fx + vz * fz < 0) and 2 or 1
					if was == 0 or (flipped and state ~= was) then
						expect(serial, "StartMoving", unitID)
						startArg[serial] = state - 1
						toldMoving[serial] = state
					end
				elseif was ~= 0 then
					expect(serial, "StopMoving", unitID)
					toldMoving[serial] = 0
				end
				-- Whether the unit's own script moved a piece since the last look.
				local now = ownPieces(unitID, w.unitDef[i] + 1)
				local animated = pieceSum[unitID] ~= nil and pieceSum[unitID] ~= now
				pieceSum[unitID] = now
				if moves then
					sum.movingLooks = sum.movingLooks + 1
					sum.movingAnimated = sum.movingAnimated + (animated and 1 or 0)
					local byDef = sum.byDef[def.name] or { 0, 0 }
					sum.byDef[def.name] = byDef
					byDef[1], byDef[2] = byDef[1] + (animated and 1 or 0), byDef[2] + 1
				else
					sum.standingLooks = sum.standingLooks + 1
					sum.standingAnimated = sum.standingAnimated + (animated and 1 or 0)
				end
			end

			-- A builder's work.
			local job, command, wantedTarget, power = nil, 0, -1, 0
			local builder = false
			for targetTrack = w.unitTargetFirst[i], w.unitTargetFirst[i] + w.unitTargetCount[i] - 1 do
				if w.targetWeapon[targetTrack] == 0 then
					builder = true
					if finished and w:sampleTarget(targetTrack, frame, target) then
						local kind, ref = target[1], target[2]
						if (kind == 16 or kind == 17 or kind == 20) and ref >= 1 and w:unitExistsAt(ref, frame) then
							job = kind .. " unit " .. w.unitSerial[ref]
							wantedTarget = unitAt[ref] or -1
							w:sampleTransform(ref, frame, other)
							headingOf[serial] = { other[1], other[2], other[3] }
							if kind == 17 then
								command = CMD.RECLAIM
							elseif kind == 20 then
								command = CMD.CAPTURE
							else
								w:sampleStatus(ref, frame, status)
								local targetDef = UnitDefNames[info.unitDefs[w.unitDef[ref] + 1]]
								command = (status[2] < 1 and targetDef) and -targetDef.id or CMD.REPAIR
							end
						elseif (kind == 18 or kind == 19) and features[ref] then
							job = kind .. " feature " .. ref
							wantedTarget = nil
							command = kind == 19 and CMD.RESURRECT or CMD.RECLAIM
							headingOf[serial] = features[ref].position
						elseif kind == 129 then
							job = "129"
							command = CMD.RESTORE
							headingOf[serial] = { target[4], target[5], target[6] }
						end
						if job then
							power = target[3] / 255
						end
					end
				end
			end
			if builder then
				sum.builders = sum.builders + 1
				if job then
					sum.working = sum.working + 1
				end
				local gotCommand = Spring.GetUnitRulesParam(unitID, "coilbox_rewind_work_command")
				local gotTarget = Spring.GetUnitRulesParam(unitID, "coilbox_rewind_work_target")
				local gotPower = Spring.GetUnitRulesParam(unitID, "coilbox_rewind_work_power")
				if (gotCommand or 0) ~= command or (wantedTarget and (gotTarget or -1) ~= wantedTarget) or math.abs((gotPower or 0) - power) > 0.000001 then
					sum.paramsBad = sum.paramsBad + 1
					note(sum, string.format("params %s at %s: engine %s %s %s track %s %s %s", def.name, tostring(frame), tostring(gotCommand), tostring(gotTarget), tostring(gotPower), tostring(command), tostring(wantedTarget), tostring(power)))
				end
			end
			if quiet then
				-- Told on the way here, before the counting began.
			elseif job ~= toldJob[serial] or (again and job) then
				if job then
					expect(serial, "StartBuilding", unitID)
				elseif toldJob[serial] then
					expect(serial, "StopBuilding", unitID)
				end
			end
			toldJob[serial] = job
		end
	end
	sum.movingMost = math.max(sum.movingMost, movingNow)

	-- What they were told.
	for k = heardRead + 1, heardCount do
		local one = heard[k]
		heard[k] = nil
		sum.heard = sum.heard + 1
		sum[one.how] = sum[one.how] + 1
		local serial = serialOfUnit[one.unit]
		if not serial then
			sum.unknown = sum.unknown + 1
			note(sum, "a unit the track does not have was told " .. one.name)
		else
			local key = serial .. " " .. one.name
			sum.got[key] = (sum.got[key] or 0) + 1
			if want[key] and want[key] > 0 then
				want[key] = want[key] - 1
			else
				sum.extra = sum.extra + 1
				note(sum, "extra " .. one.name .. " at " .. tostring(frame) .. " for " .. UnitDefs[Spring.GetUnitDefID(one.unit)].name)
			end
			if one.name == "StartMoving" and startArg[serial] and one.a ~= startArg[serial] then
				sum.argsBad = sum.argsBad + 1
				note(sum, "StartMoving was given " .. tostring(one.a) .. " and the track has " .. startArg[serial])
			end
			local place = headingOf[serial]
			local unitDef = UnitDefs[Spring.GetUnitDefID(one.unit)]
			if one.name == "StartBuilding" and place and not unitDef.isFactory then
				-- The engine's own angles (CBuilder::ScriptStartBuilding), from the
				-- unit as the engine has it.
				local _, _, _, mx, my, mz = Spring.GetUnitPosition(one.unit, true)
				local front, up = Spring.GetUnitVectors(one.unit)
				local dx, dy, dz = place[1] - mx, place[2] - my, place[3] - mz
				local length = math.sqrt(dx * dx + dy * dy + dz * dz)
				if length > 0 and one.a and one.b then
					dx, dy, dz = dx / length, dy / length, dz / length
					local heading = math.atan2(dx, dz) - math.atan2(front[1], front[3])
					local pitch = math.asin(math.max(-1, math.min(1, dx * up[1] + dy * up[2] + dz * up[3])))
					local a, b = one.a, one.b
					local limit = 0.001
					if one.how == "cob" then
						a, b = a * math.pi / 32768, b * math.pi / 32768
						limit = 0.001 + math.pi / 32768
					end
					local off = math.max(angleOff(a, heading), angleOff(b, pitch))
					sum.headings = sum.headings + 1
					sum.worstHeading = math.max(sum.worstHeading, off)
					if off > limit then
						sum.headingBad = sum.headingBad + 1
						note(sum, string.format("StartBuilding of %s was given %.4f %.4f and the engine's vectors give %.4f %.4f", unitDef.name, a, b, heading, pitch))
					end
				end
			elseif one.name == "StartBuilding" and unitDef.isFactory and (one.a ~= nil or one.b ~= nil) then
				sum.argsBad = sum.argsBad + 1
				note(sum, "a factory's StartBuilding was given an argument")
			end
		end
	end
	heardRead = heardCount
	for key, left in pairs(want) do
		if left > 0 then
			sum.missing = sum.missing + left
			local serial = tonumber(key:match("^(%d+)"))
			local unitID = seenAs[serial]
			local name = unitID and Spring.GetUnitDefID(unitID) and UnitDefs[Spring.GetUnitDefID(unitID)].name or "?"
			note(sum, "missing " .. key .. " of " .. name .. " at " .. tostring(frame))
		end
	end
	return arriving
end

local function animationSay(label, sum, aim)
	-- Over the whole of the looks, whatever look each call fell in.
	local looseMissing, looseExtra = 0, 0
	for key, n in pairs(sum.want) do
		looseMissing = looseMissing + math.max(0, n - (sum.got[key] or 0))
	end
	for key, n in pairs(sum.got) do
		looseExtra = looseExtra + math.max(0, n - (sum.want[key] or 0))
	end
	say(
		string.format(
			"animation %s shown=%s looks=%d units=%d absent=%d moving_most=%d moving_looks=%d moving_animated=%d standing_looks=%d standing_animated=%d expected=%d heard=%d missing=%d extra=%d loose_missing=%d loose_extra=%d args_bad=%d lua=%d cob=%d unknown=%d fastest=%s velocity_bad=%d worst_velocity=%.6f builders=%d working=%d params_bad=%d headings=%d heading_bad=%d worst_heading=%.6f posed=%d posed_bad=%d posed_walk=%d",
			label,
			tostring(param("frame")),
			sum.looks,
			sum.units,
			sum.absent,
			sum.movingMost,
			sum.movingLooks,
			sum.movingAnimated,
			sum.standingLooks,
			sum.standingAnimated,
			sum.expected,
			sum.heard,
			sum.missing,
			sum.extra,
			looseMissing,
			looseExtra,
			sum.argsBad,
			sum.lua,
			sum.cob,
			sum.unknown,
			tostring(sum.fastest),
			sum.velocityBad,
			sum.worstVelocity,
			sum.builders,
			sum.working,
			sum.paramsBad,
			sum.headings,
			sum.headingBad,
			sum.worstHeading,
			aim.pieces,
			aim.bad,
			aim.walked or 0
		)
	)
	local byDef = {}
	for name, counts in pairs(sum.byDef) do
		byDef[#byDef + 1] = name .. ":" .. counts[1] .. "/" .. counts[2]
	end
	table.sort(byDef)
	if #byDef > 0 then
		say("animation note " .. label .. ": moving looks animated by definition " .. table.concat(byDef, " "))
	end
	for _, text in ipairs(sum.notes) do
		say("animation note " .. label .. ": " .. text)
	end
end

--- The frames to seek to when the test names none: among every 30th frame of
-- the track, the two with the most units moving and the two with the most
-- builders at work, no two of them within 600 frames, each with 400 frames of
-- the track after it.
local function animationFrames()
	local h = track.header
	local scored = {}
	for frame = h.firstFrame, h.lastFrame - 400, 30 do
		local w = assert(track:seek(frame))
		local moving, working = 0, 0
		for i = 1, w.unitCount do
			if w:unitExistsAt(i, frame) then
				w:sampleStatus(i, frame, status)
				if status[2] >= 1 then
					w:sampleTransform(i, frame, transform)
					w:sampleTransform(i, frame + 0.25, other)
					if (other[1] - transform[1]) ^ 2 + (other[3] - transform[3]) ^ 2 > 0.0001 / 16 then
						moving = moving + 1
					end
					for targetTrack = w.unitTargetFirst[i], w.unitTargetFirst[i] + w.unitTargetCount[i] - 1 do
						if w.targetWeapon[targetTrack] == 0 and w:sampleTarget(targetTrack, frame, target) and target[1] ~= 0 then
							working = working + 1
						end
					end
				end
			end
		end
		scored[#scored + 1] = { frame = frame, moving = moving, working = working }
	end
	local frames = {}
	for _, by in ipairs({ "moving", "working" }) do
		table.sort(scored, function(a, b)
			if a[by] ~= b[by] then
				return a[by] > b[by]
			end
			return a.frame < b.frame
		end)
		local taken = 0
		for _, item in ipairs(scored) do
			local clear = item[by] > 0
			for _, frame in ipairs(frames) do
				if math.abs(frame - item.frame) < 600 then
					clear = false
				end
			end
			if clear and taken < 2 then
				taken = taken + 1
				frames[#frames + 1] = item.frame
			end
		end
	end
	table.sort(frames)
	return frames
end

--- The plan for unit scripts. At each frame asked for it seeks there paused,
-- which leaves every script told that its unit stands, and then looks on every
-- frame of: 150 frames played forward, 30 paused, 40 forward and 60 backward
-- with no pause between, 20 frames at 8x, and 30 frames across a seek made
-- while playing. `asked.frames` are the frames, and `asked.long` a number of
-- frames to play forward from the first of them with a look on each.
local function animationPlan(asked)
	local h = track.header
	posedNames = {}
	for _, posed in ipairs(info.posedPieces) do
		posedNames[posed.unitDef + 1] = posed.pieces
	end
	local frames = type(asked) == "table" and asked.frames or nil
	if not frames or #frames == 0 then
		frames = animationFrames()
	end
	say(string.format("start first=%d last=%d seeks=%d frames=%s", h.firstFrame, h.lastFrame, #frames, table.concat(frames, ",")))
	send("pause")
	seekTo(h.firstFrame)
	local walkPieces = type(asked) == "table" and asked.walkPieces or nil
	--- `count` frames with a look on each. The posed pieces are looked at too,
	-- as the aim plan looks at them, but for the frame a seek's message has
	-- arrived in and the world has yet to show.
	local function looked(label, count)
		local sum, aim = animationSum(), aimSum()
		push("each", count, function()
			if not animationLook(sum) then
				aimLook(aim, walkPieces)
			end
		end)
		push("run", function()
			animationSay(label, sum, aim)
		end)
	end
	for n, frame in ipairs(frames) do
		local at = " n=" .. n .. " frame=" .. frame
		send("pause")
		send("speed 1")
		seekTo(frame)
		push("run", function()
			-- Whatever was told on the way here is not what is being counted.
			heardRead = heardCount
			lastShown, lastRate, seekingTo = param("frame"), 0, nil
			afterPausedSeek = true
			for serial in pairs(toldMoving) do
				toldMoving[serial] = 0
			end
		end)
		looked("still" .. at, 5)
		send("play 1")
		looked("forward" .. at, 150)
		send("pause")
		looked("paused" .. at, 30)
		send("play 1")
		looked("again" .. at, 40)
		send("reverse")
		looked("backward" .. at, 60)
		send("play 1")
		send("speed 8")
		looked("fast" .. at, 20)
		send("speed 1")
		looked("slowed" .. at, 10)
		send("seek " .. (frame + 45))
		looked("seek" .. at, 30)
	end
	local long = type(asked) == "table" and tonumber(asked.long) or 0
	if long > 0 and #frames > 0 then
		send("pause")
		send("speed 1")
		seekTo(frames[1])
		push("run", function()
			heardRead = heardCount
			lastShown, lastRate, seekingTo = param("frame"), 0, nil
			afterPausedSeek = true
			for serial in pairs(toldMoving) do
				toldMoving[serial] = 0
			end
		end)
		looked("still long frame=" .. frames[1], 2)
		send("play 1")
		looked("long frame=" .. frames[1], long)
	end
	send("pause")
	push("wait", SETTLE)
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
	push("settled")
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
		if animationAsked then
			animationPlan(animationAsked)
		elseif aimAsked then
			aimPlan(aimAsked)
		elseif VFS.FileExists(RESOURCES) then
			resourcePlan(VFS.Include(RESOURCES))
		elseif VFS.FileExists(SEEKS) then
			seeksPlan()
		elseif VFS.FileExists(SHOTS) then
			shotPlan(VFS.Include(SHOTS))
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
