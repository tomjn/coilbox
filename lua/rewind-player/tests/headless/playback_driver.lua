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

local Track = VFS.Include("luarules/rewind_player/coilbox_track.lua")
local Fetch = VFS.Include("luarules/rewind_player/coilbox_track_fetch.lua")

local track, info, features
local queue, at = {}, 1
local transform, status = { 0, 0, 0, 0, 0, 0, 0 }, { 0, 0, 0 }

-- How many explosions the engine has made. A unit destroyed with its death
-- effect explodes, and one removed quietly does not.
local explosions = 0

function gadget:Initialize()
	for weaponDefID in pairs(WeaponDefs) do
		Script.SetWatchExplosion(weaponDefID, true)
	end
end

function gadget:Explosion()
	explosions = explosions + 1
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
		push("wait", 450)
		push("run", function()
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
	if not track then
		track = assert(Track.open(assert(Fetch.fromVFS())))
		info, features = assert(track:info()), assert(track:features())
		-- The test that wants a whole match played writes this file beside the
		-- track. Without it the plan is the fixture match's.
		if VFS.FileExists(WHOLE_MATCH) then
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
		elseif item.kind == "wait" then
			item.waited = item.waited + 1
			if item.waited <= item.a then
				return
			end
		end
		at = at + 1
	end
end
