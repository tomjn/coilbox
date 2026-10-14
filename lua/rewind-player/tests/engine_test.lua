-- The engine capability table (issue #3802): every call the player needs from
-- the engine, what hangs on it, and what the player does on an engine without
-- it. The tests here are made from the table, so a row added to it is tested
-- without a line written here.
--
-- Nothing here runs an engine. An engine before 2025.03.9 is not installed, so
-- the older paths are tested against the stand-in in engine.lua with a call
-- taken out of it.

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local ROOT = t.root()
local GADGET = ROOT .. "/luarules/gadgets/coilbox_rewind_player.lua"
local TRACK = "coilbox_rewind/track.cbtrack"
local ADAPTER = "coilbox_rewind/adapter.lua"
local PREFIX = "COILBOX_REWIND_PLAYER "
local NOTE = "coilbox_rewind_note"

local Table = t.load("coilbox_player_engine.lua", t.syncedEnv())

--- A call taken out of a gadget's environment, by its dotted name. A top level
-- name reads as nil afterwards, as it does in the engine, and not as an error.
local function remove(env, name)
	local parts = {}
	for part in name:gmatch("[^.]+") do
		parts[#parts + 1] = part
	end
	if #parts == 1 then
		local meta = getmetatable(env)
		local base = meta.__index
		meta.__index = function(e, key)
			if key == name then
				return nil
			end
			return base(e, key)
		end
		rawset(env, name, nil)
		return
	end
	local holder = rawget(env, parts[1])
	for i = 2, #parts - 1 do
		holder = holder[parts[i]]
	end
	holder[parts[#parts]] = nil
end

--- The engine's globals the synced rows name, as the gadget hands them over.
local function rootsOf(env)
	return {
		Spring = env.Spring,
		VFS = env.VFS,
		Game = env.Game,
		CMD = env.CMD,
		SendToUnsynced = rawget(env, "SendToUnsynced"),
		Script = rawget(env, "Script"),
	}
end

local HOOK = "return { name = 'Probe', hooks = { started = function() Spring.Echo('hook ran') end }, "
	.. "teamParams = { 'supplyUsed', 'researchPoints' }, gameParams = { 'wave' } }"

--- A world, the synced half of the gadget in it, and the environment it runs in.
-- `removed` is a call the engine does not have.
local function scene(removed)
	local w = Engine.new({
		-- The fixture has poses for three pieces of armpw.
		unitDefs = { { name = "armcom" }, { name = "armpw", pieces = { "pelvis", "turret", "barrel", "arm" } }, { name = "armsolar" } },
		featureDefs = { { name = "rock" } },
		weaponDefs = {
			{ name = "laser", type = "LaserCannon", fireSound = { { name = "zap", volume = 1 } } },
			{ name = "missile", type = "MissileLauncher" },
		},
	})
	local env = Engine.env(t, w, { [TRACK] = bytes, [ADAPTER] = HOOK })
	if removed then
		remove(env, removed)
	end
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return true
		end,
	}
	local chunk = assert(loadfile(GADGET))
	setfenv(chunk, env)
	chunk()
	w.gadget = env.gadget
	return w, env.gadget, env
end

--- Starts the gadget and plays the track: forward at the match's own speed from
-- the first frame to the last, a seek, backward, and seeks to frames with units
-- under construction, shots in the air and ground changes. Gives whether
-- nothing raised, and the error when something did.
local function play(gadget, w)
	return pcall(function()
		gadget:Initialize()
		-- A frame in the engine's order, with the teams summed up between the
		-- gadget's two call-ins.
		local function frame(n)
			gadget:GameFrame(n)
		end
		local function post(n)
			gadget:GameFramePost(n)
		end
		local function frames(count)
			for _ = 1, count do
				w.step(frame, post)
			end
		end
		frames(2100)
		gadget:RecvLuaMsg("coilbox_rewind:seek 800", 0)
		frames(5)
		gadget:RecvLuaMsg("coilbox_rewind:play -1", 0)
		frames(400)
		for _, frame in ipairs({ 514, 733, 1155, 1300, 100 }) do
			gadget:RecvLuaMsg("coilbox_rewind:seek " .. frame, 0)
			frames(3)
		end
	end)
end

local function count(list, test)
	local n = 0
	for _, item in pairs(list) do
		if test(item) then
			n = n + 1
		end
	end
	return n
end

--- What a feature does to the world, so that a run without its call can be told
-- from one with it. A feature with no entry is tested without this.
local OBSERVE = {
	terrain = function(w)
		return w.heightMapCalls or 0
	end,
	features = function(w)
		return count(w.events, function(event)
			return event:find("^feature ") ~= nil
		end)
	end,
	featureTurn = function(w)
		return count(w.features, function(feature)
			return feature.pitch ~= 0 or feature.yaw ~= 0 or feature.roll ~= 0
		end)
	end,
	sight = function(w)
		return count(w.los, function()
			return true
		end)
	end,
	aimPoses = function(w)
		return w.poseSets
	end,
	holdFire = function(w)
		return count(w.units, function(unit)
			return unit.useWeapons == false
		end)
	end,
	shots = function(w)
		return w.spawned
	end,
	shotHandover = function(w)
		return w.ttlSets or 0
	end,
	sound = function(w)
		return w.soundCount
	end,
	resources = function(w)
		return w.resourceSets + w.shareSets
	end,
	resourceRates = function(w)
		return w.resourceFeeds
	end,
	resourceShares = function(w)
		return w.transfers
	end,
	resourceExcess = function(w)
		return w.excessAdds
	end,
	teamParams = function(w)
		return w.teamParamSets
	end,
	workTiming = function(w)
		return w.sent
	end,
	adapter = function(w)
		return count(w.lines, function(line)
			return line == "hook ran"
		end)
	end,
}

--- The features that work only while another does.
local NEEDS = {
	shotHandover = "shots",
	sound = "shots",
	featureTurn = "features",
	-- Adding to a team's income takes its storage out of the way first, and the
	-- excess is read with the call that reads the income.
	resourceRates = "resources",
	-- A transfer needs the sender to hold the amount first, and the sums read back.
	resourceShares = { "resources", "resourceRates" },
	resourceExcess = "resourceRates",
	-- The adapter names the rules parameters.
	teamParams = "adapter",
}

--- Whether feature `id` works only while feature `other` does.
local function needs(id, other)
	local need = NEEDS[id]
	if type(need) == "table" then
		for _, name in ipairs(need) do
			if name == other then
				return true
			end
		end
		return false
	end
	return need == other
end

--- A line the gadget logged that starts with `start`, after its prefix.
local function logged(w, start)
	for _, line in ipairs(w.lines) do
		if line:sub(1, #PREFIX + #start) == PREFIX .. start then
			return line
		end
	end
end

-- The table itself.

do
	local seen = {}
	for _, scope in ipairs({ "synced", "unsynced" }) do
		local rows = scope == "synced" and Table.SYNCED or Table.UNSYNCED
		t.check("the " .. scope .. " table has rows", #rows > 0)
		local ids = {}
		for _, row in ipairs(rows) do
			local label = scope .. " row " .. tostring(row.id)
			t.check(label .. " has an id nobody else has", type(row.id) == "string" and not ids[row.id])
			ids[row.id] = true
			t.check(label .. " names the calls it needs", type(row.calls) == "table" and #row.calls > 0)
			t.check(label .. " says how it is checked", row.how == "presence" or row.how == "behaviour", row.how)
			t.check(label .. " says whether it is required", type(row.required) == "boolean")
			t.check(label .. " names the feature", type(row.feature) == "string" and row.feature ~= "")
			t.check(label .. " says what happens without it", type(row.without) == "string" and row.without ~= "")
			t.check(label .. " names the engine that has it", type(row.since) == "string" and row.since ~= "")
			t.check(label .. " says where it is used", type(row.used) == "string" and row.used ~= "")
			t.check(label .. " says whether a viewer can see it missing", type(row.visible) == "boolean")
			if row.how == "behaviour" then
				t.check(label .. " says where its behaviour is checked", type(row.where) == "string" and row.where ~= "")
			end
			if row.required then
				t.check(label .. " is required, so nothing is shown in the note for it", row.visible == false)
			end
			for _, call in ipairs(row.calls) do
				t.check(call .. " is in one row of its scope only", not seen[scope .. call])
				seen[scope .. call] = true
			end
		end
	end
end

-- Every engine name the Lua uses has a row. The names are read out of the
-- source, with the comments and the strings taken out (scan.lua).

local Scan = dofile(here .. "/scan.lua")
local usedBy, filesUnder, setOf, callsOf = Scan.usedBy, Scan.filesUnder, Scan.setOf, Scan.callsOf

do
	local allowed = setOf(callsOf(Table.SYNCED), callsOf(Table.UNSYNCED), Table.ASSUMED, Table.REPLACED)
	local used = {}
	local files = filesUnder(ROOT .. "/luarules")
	t.check("the source scan found the player's files", #files >= 10, #files)
	for _, path in ipairs(files) do
		for name in pairs(usedBy(path)) do
			used[name] = true
			t.check(path:match("[^/]+$") .. " uses " .. name .. ", which has a row", allowed[name], "add " .. name .. " to the table in coilbox_player_engine.lua")
		end
	end
	for _, row in ipairs(Table.SYNCED) do
		for _, call in ipairs(row.calls) do
			t.check(call .. " has a row and the player uses it", used[call], "the row " .. row.id .. " is out of date")
		end
	end
	for _, row in ipairs(Table.UNSYNCED) do
		for _, call in ipairs(row.calls) do
			t.check(call .. " has a row and the player uses it", used[call], "the row " .. row.id .. " is out of date")
		end
	end
	for _, item in ipairs(Table.AVOID) do
		t.check(item.call .. " is a call the player must not use", not used[item.call] and type(item.why) == "string" and item.why ~= "")
	end
end

-- With every call there, the player loads, plays and says nothing about the engine.

local CONTROL = {}
local function alive(list)
	return count(list, function(item)
		return not item.dead
	end)
end

do
	local w, gadget = scene()
	local ok, err = play(gadget, w)
	t.check("with every call there the player plays the whole track", ok, err)
	t.same("and says nothing about the engine", logged(w, "this engine"), nil)
	t.same("with no note", w.params[NOTE], nil)
	CONTROL.units = alive(w.units)
	for id, observe in pairs(OBSERVE) do
		CONTROL[id] = observe(w)
		t.check("the run sees " .. id .. " at work, so a run without it can be told apart", CONTROL[id] > 0, CONTROL[id])
	end
end

--- The note a set of optional rows switched off gives.
local function noteOf(rows)
	local names = {}
	for _, row in ipairs(rows) do
		if row.visible then
			names[#names + 1] = row.feature
		end
	end
	if #names == 0 then
		return nil
	end
	local shown = {}
	for i = 1, math.min(3, #names) do
		shown[i] = names[i]
	end
	local text = "Switched off on this engine: " .. table.concat(shown, ", ")
	if #names > 3 then
		text = text .. " and " .. (#names - 3) .. " more"
	end
	return text
end

-- A call taken out, one at a time.

for _, row in ipairs(Table.SYNCED) do
	for _, call in ipairs(row.calls) do
		local label = "without " .. call
		local w, gadget = scene(call)
		local ok, err = play(gadget, w)
		t.check(label .. " the gadget raises nothing", ok, err)
		if row.required then
			local line = logged(w, "cannot play: this engine has no " .. call)
			t.check(label .. " the log line starts with the gadget's prefix and names the call", line ~= nil, table.concat(w.lines, " | "))
			t.check(label .. " it names the engine that has it", line ~= nil and line:find("Engine " .. row.since .. " and later have it", 1, true) ~= nil, line)
			if call ~= "Spring.SetGameRulesParam" then
				t.same(label .. " the timeline's note says so", w.params[NOTE], "Playback needs engine " .. row.since .. " or later: no " .. call)
			end
			t.same(label .. " nothing is made", alive(w.units) + alive(w.features), 0)
			t.same(label .. " no frame is timed", w.sent, 0)
			t.same(label .. " damage is left alone", gadget:UnitPreDamaged(100, 1, 0, 500), nil)
			t.same(label .. " the engine may leave wrecks", gadget:AllowFeatureCreation(1, 0, 0, 0, 0), true)
			t.same(label .. " no message is taken", gadget:RecvLuaMsg("coilbox_rewind:play", 0), false)
		else
			local line = logged(w, "this engine has no " .. call)
			t.check(label .. " the log line names the call", line ~= nil, table.concat(w.lines, " | "))
			t.check(label .. " and says " .. row.feature .. " is switched off", line ~= nil and line:find("Switched off: " .. row.feature .. ".", 1, true) ~= nil, line)
			t.check(label .. " and what happens", line ~= nil and line:find(row.without, 1, true) ~= nil, line)
			t.check(label .. " and which engine has it", line ~= nil and line:find("Engine " .. row.since .. " and later have it", 1, true) ~= nil, line)
			t.same(label .. " the note", w.params[NOTE], noteOf({ row }))
			local observe = OBSERVE[row.id]
			if observe then
				t.same(label .. " " .. row.id .. " does nothing", observe(w), 0)
			end
			for id, observeOther in pairs(OBSERVE) do
				if id ~= row.id and not needs(id, row.id) then
					t.check(label .. " " .. id .. " still works", observeOther(w) > 0, id)
				end
			end
			t.same(label .. " the units are still played", alive(w.units), CONTROL.units)
		end
	end
end

-- Several calls out at once give one note, and a note stays short.

do
	local function rowOf(id)
		for _, row in ipairs(Table.SYNCED) do
			if row.id == id then
				return row
			end
		end
	end
	local function without(ids)
		local w = Engine.new({})
		local env = Engine.env(t, w, {})
		for _, id in ipairs(ids) do
			for _, call in ipairs(rowOf(id).calls) do
				remove(env, call)
			end
		end
		return Table.check(rootsOf(env), Table.SYNCED)
	end

	local none = without({})
	t.same("nothing missing switches nothing off", #none.lines, 0)
	t.same("and gives no note", none.note, nil)
	t.same("and does not refuse", none.refused, false)
	for _, row in ipairs(Table.SYNCED) do
		t.same("with nothing missing " .. row.id .. " is on", none.on[row.id], true)
	end

	local one = without({ "terrain" })
	t.same("terrain gone gives its name", one.note, "Switched off on this engine: " .. rowOf("terrain").feature)
	t.same("and the other rows stay on", one.on.features and one.on.shots, true)

	local quiet = without({ "shotHandover", "sound", "workTiming" })
	t.same("features a viewer cannot see missing give no note", quiet.note, nil)
	t.check("but each is logged", #quiet.lines == 3, #quiet.lines)

	local mixed = without({ "shotHandover", "terrain" })
	t.same("a feature nobody can see is left out of a note with others", mixed.note, noteOf({ rowOf("terrain") }))

	local many = without({ "terrain", "features", "sight", "holdFire", "shots" })
	t.same("a long list is cut to three names and a count", many.note, noteOf({ rowOf("terrain"), rowOf("features"), rowOf("sight"), rowOf("holdFire"), rowOf("shots") }))
	t.check("which ends in the count", many.note:find("and 2 more$") ~= nil, many.note)

	local both = without({ "units", "track", "terrain" })
	t.same("several required calls missing refuse", both.refused, true)
	t.check("the note names the first and counts the rest", both.note:find("^Playback needs engine .+: no .+ and %d+ more$") ~= nil, both.note)
	t.same("each is logged", #both.lines, 3)
end

-- The unsynced half of the gadget.

local Unsynced = dofile(here .. "/unsynced.lua")

local function unsyncedScene(removed)
	-- An engine without the microsecond timer reads whole milliseconds.
	local clock = { now = 0, micros = removed ~= "Spring.GetTimerMicros" }
	local e = Unsynced.new(clock)
	local lines = e.lines
	local env = t.unsyncedEnv()
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return false
		end,
	}
	env.Game = { gameSpeed = 30 }
	env.Spring, env.gl, env.GL = e.Spring, e.gl, e.GL
	env.CMD, env.UnitDefs, env.Game.maxUnits = e.CMD, e.UnitDefs, e.maxUnits
	env.io = e.io
	env.VFS.Include = function(path)
		local file = assert(path:match("^luarules/rewind_player/(.+)$"), path)
		return t.load(file, env)
	end
	if removed then
		remove(env, removed)
	end
	-- A builder at work for the stream: unit 21 with its nano piece 90 elmos
	-- from the middle of unit 22, at frame 1000 of the track, played forward.
	e.UnitDefs[1] = { isFactory = false, showNanoSpray = true, radius = 10, height = 12 }
	e.units[21] = { def = 1, team = 0, x = 0, y = 0, z = 0, pieces = { 1 }, at = { [1] = { 0, 10, 0 } } }
	e.units[22] = { def = 1, team = 0, x = 90, y = 0, z = 0, mx = 90, my = 10, mz = 0, radius = 20 }
	e.rules.coilbox_rewind_frame = 1000
	e.rules.coilbox_rewind_playing = 1
	e.rules.coilbox_rewind_direction = 1
	e.rules.coilbox_rewind_speed = 1
	local chunk = assert(loadfile(GADGET))
	setfenv(chunk, env)
	chunk()
	return env.gadget, lines, clock, e
end

do
	local gadget, lines, clock = unsyncedScene()
	t.same("with every call there the unsynced half logs nothing as it loads", #lines, 0)
	gadget:RecvFromSynced("coilbox_rewind_work", 0, 1)
	clock.now = clock.now + 50
	gadget:RecvFromSynced("coilbox_rewind_work", 1, 1)
	t.same("and times a slow frame", #lines, 1)
	t.same("and sends the view", #clock.views, 1)
	t.same("and has a world draw for the arrival effect", type(gadget.DrawWorld), "function")
end

for _, row in ipairs(Table.UNSYNCED) do
	for _, call in ipairs(row.calls) do
		local label = "unsynced, without " .. call
		local ok, gadget, lines, clock, e = pcall(unsyncedScene, call)
		t.check(label .. " the gadget loads", ok, gadget)
		if ok then
			-- The view needs a way to send it, and the effect needs a clock.
			local viewOff = row.id == "view" or row.id == "budgetMessage"
			local effectOff = row.id == "arrivalEffect" or row.id == "workTimingLine"
			local line = lines[1]
			t.check(label .. " it logs one line that starts with the prefix", #lines == 1 and line:sub(1, #PREFIX) == PREFIX, table.concat(lines, " | "))
			t.check(label .. " naming the call", line ~= nil and line:find("this engine has no " .. call, 1, true) ~= nil, line)
			t.check(label .. " and what happens", line ~= nil and line:find(row.without, 1, true) ~= nil, line)
			local fine = pcall(function()
				gadget:RecvFromSynced("coilbox_rewind_work", 0, 1)
				clock.now = clock.now + 50
				gadget:RecvFromSynced("coilbox_rewind_work", 1, 1)
			end)
			t.check(label .. " a frame's work is taken and raises nothing", fine)
			t.same(label .. " the view is " .. (viewOff and "not sent" or "still sent"), #clock.views, viewOff and 0 or 1)
			-- The stream of build particles needs the arrival effect's drawing
			-- calls and its own, and takes its time from the track.
			local streamOff = row.id == "buildStream" or row.id == "arrivalEffect"
			t.same(label .. " a unit that arrives is taken and raises nothing", pcall(gadget.RecvFromSynced, gadget, "coilbox_rewind_arrive", 7, 1, 0, 0, 0, true), true)
			t.same(label .. " a builder's work is taken and raises nothing", pcall(gadget.RecvFromSynced, gadget, "coilbox_rewind_build", 21, -1, 22, 1, 0, 0, 0, 1000, 1), true)
			t.same(label .. " the world is " .. ((effectOff and streamOff) and "not drawn" or "drawn"), type(gadget.DrawWorld), (effectOff and streamOff) and "nil" or "function")
			if gadget.DrawWorld then
				e.clear()
				t.same(label .. " a draw raises nothing", pcall(gadget.DrawWorld, gadget), true)
				t.same(label .. " the arrival effect is " .. (effectOff and "not drawn" or "still drawn"), e.vertices - e.texCoords > 0, not effectOff)
				t.same(label .. " the stream is " .. (streamOff and "not drawn" or "still drawn"), e.texCoords > 0, not streamOff)
			end
			-- A row that leaves the slow frame line on still logs a slow frame.
			local more = 0
			for _, l in ipairs(lines) do
				if not l:find(PREFIX .. "slow frame:", 1, true) then
					more = more + 1
				end
			end
			t.same(label .. " and nothing more is logged", more, 1)
		end
	end
end

-- Rows checked by behaviour. Each runs the player on an engine that behaves the
-- older way, or on one without the call the check needs.

local BEHAVIOUR = {}

--- A line a player logged that holds `needle`.
local function said(w, needle)
	for _, line in ipairs(w.lines) do
		if line:find(needle, 1, true) then
			return line
		end
	end
end

--- A player of a track with a building that is finished at frame 250 and half
-- built at frame 150, and the world it plays in. `engine` is what the table
-- says of the engine, or nothing for an engine with every call.
local function plantScene(oldEngine, engine)
	local w = Engine.new({ unitDefs = { { name = "plant", health = 4000, buildTime = 500 } } })
	w.oldEngine = oldEngine
	local env = Engine.env(t, w)
	local Player = t.load("coilbox_player.lua", env)
	local track = Fake.new({
		last = 400,
		unitDefs = { "plant" },
		units = { {
			first = 100,
			last = 400,
			at = { 8, 2, 8 },
			status = function(frame)
				return 1, math.min(1, (frame - 100) / 100), 0
			end,
		} },
	})
	local player = assert(Player.new(track, {
		modOptions = {},
		engine = engine,
		log = function(text)
			w.lines[#w.lines + 1] = text
		end,
	}))
	w.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			player:unitDestroyed(unitID)
		end,
	}
	local function seek(frame)
		player:message("coilbox_rewind:seek " .. frame)
		player:frame()
	end
	player:message("coilbox_rewind:pause")
	seek(250)
	seek(150)
	return w
end

BEHAVIOUR.rebuild = function()
	local newer = plantScene(false)
	local plant = newer.unitNamed("plant")
	t.same("rebuild: an engine that can turn a unit back into a nanoframe does", plant.beingBuilt, true)
	t.same("and the player says nothing about it", said(newer, "this engine keeps a finished unit finished"), nil)

	local older = plantScene(true)
	plant = older.unitNamed("plant")
	t.same("rebuild: an engine that keeps a finished unit finished has the unit made again as a nanoframe", plant.beingBuilt, true)
	local line = said(older, "this engine keeps a finished unit finished")
	t.check("and the player says so", line ~= nil, table.concat(older.lines, " | "))
	t.check("naming the engine that does not need it", line ~= nil and line:find("2025.03.9", 1, true) ~= nil, line)

	-- Without the call the check asks with, the player trusts the engine.
	local w = Engine.new({})
	local env = Engine.env(t, w, {})
	remove(env, "Spring.GetUnitIsStunned")
	local engine = Table.check(rootsOf(env), Table.SYNCED)
	t.same("rebuild: without the call it asks with, the row is off", engine.on.rebuild, false)
	local blind = plantScene(true, engine)
	t.same("rebuild: and an older engine leaves the unit finished", blind.unitNamed("plant").beingBuilt, false)
end

-- The call at the end of a frame (issue #4002). The fixture is played through
-- the gadget, in a game whose handler passes GameFramePost on, in one whose
-- handler does not, and on an engine that has no such call. `removed` is a call
-- the engine lacks. Gives the world and what was counted: frames in which a
-- unit's maximum was lowered while the engine healed, units whose maximum was
-- not whole when a frame was over or when the next began, and the calls that
-- reached the gadget. The fixture has no finished unit that is wounded, so
-- that a unit is held once the call is installed is shown in player_test.lua,
-- on a track made from a table.
local function frameEndScene(how, removed, frames)
	local w, gadget = scene(removed)
	gadget:Initialize()
	gadget:RecvLuaMsg("coilbox_rewind_budget:none", 0)
	local seen = { held = 0, lowered = 0, posts = 0 }
	local function lowered()
		local n = 0
		for _, unit in pairs(w.units) do
			if not unit.dead and unit.maxHealth ~= unit.def.health then
				n = n + 1
			end
		end
		return n
	end
	-- The engine's own work in the middle of a frame.
	w.economy = function()
		if lowered() > 0 then
			seen.held = seen.held + 1
		end
		w.heal(30)
	end
	local real = gadget.GameFramePost
	gadget.GameFramePost = function(self, n)
		seen.posts = seen.posts + 1
		return real(self, n)
	end
	local frame = gadget.GameFrame
	gadget.GameFrame = function(self, n)
		seen.lowered = seen.lowered + lowered()
		return frame(self, n)
	end
	for _ = 1, frames or 600 do
		w.gameFrame(gadget, how)
		seen.lowered = seen.lowered + lowered()
	end
	return w, seen, gadget
end

BEHAVIOUR.frameEnd = function()
	local MISSING = "GameFramePost does not reach the player"
	local INSTALLED = "does not pass GameFramePost on, so the player installed it"

	local w, seen = frameEndScene(nil)
	t.same("frameEnd: a handler that passes the call on is left alone", w.callInUpdates, 0)
	t.same("and nothing is put in its global table", w.handlerGlobals.GameFramePost, nil)
	t.same("the call reaches the gadget on every frame", seen.posts, 600)
	t.same("and no unit has a lowered maximum when a frame is over or begins", seen.lowered, 0)
	t.same("the player says nothing about the call", said(w, "GameFramePost"), nil)

	w, seen = frameEndScene({ handler = false })
	t.same("frameEnd: a handler that does not pass the call on has it installed, once", w.callInUpdates, 1)
	t.same("as a global of the call-in's name", type(w.handlerGlobals.GameFramePost), "function")
	t.same("which the engine was told of", w.callIns.GameFramePost, true)
	t.same("the call then reaches the gadget on every frame but the first", seen.posts, 599)
	t.same("and no unit has a lowered maximum when a frame is over or begins", seen.lowered, 0)
	t.check("the player says that it installed the call", said(w, INSTALLED) ~= nil, table.concat(w.lines, " | "))
	t.same("and not that it is missing", said(w, MISSING), nil)

	-- The handler rebuilds its call-ins, which takes the global away.
	local gadget
	w, seen, gadget = frameEndScene({ handler = false }, nil, 50)
	w.handlerGlobals.GameFramePost = nil
	w.callIns.GameFramePost = false
	for _ = 1, 50 do
		w.gameFrame(gadget, { handler = false })
		seen.lowered = seen.lowered + (function()
			local n = 0
			for _, unit in pairs(w.units) do
				if not unit.dead and unit.maxHealth ~= unit.def.health then
					n = n + 1
				end
			end
			return n
		end)()
	end
	t.same("frameEnd: a global the handler took away is installed again", w.callInUpdates, 2)
	t.same("with one frame lost to finding out", seen.posts, 98)
	t.same("and no unit left with a lowered maximum", seen.lowered, 0)

	w, seen = frameEndScene({ engine = false })
	t.same("frameEnd: an engine with no such call has the install tried once", w.callInUpdates, 1)
	t.same("no call reaches the gadget", seen.posts, 0)
	t.same("no unit's maximum is ever lowered", seen.held + seen.lowered, 0)
	local line = said(w, MISSING .. ", so a wounded unit keeps its maximum health")
	t.check("the units stage says what it does without the call", line ~= nil and line:sub(1, #PREFIX) == PREFIX, table.concat(w.lines, " | "))
	t.check("the resources stage does too", said(w, MISSING .. ", so what a team holds") ~= nil)
	t.check("and the player says which engine has the call", said(w, "Engine 105.1.1-2590 and later do") ~= nil)
	local count = 0
	for _, text in ipairs(w.lines) do
		if text:find(MISSING, 1, true) then
			count = count + 1
		end
	end
	t.check("the aim stage says what it does", said(w, MISSING .. ", so aiming pieces are posed from GameFrame") ~= nil)
	t.same("each of the four lines is logged once in 600 frames", count, 4)

	w, seen = frameEndScene({ handler = false }, "Script.UpdateCallIn")
	t.same("frameEnd: without Script.UpdateCallIn nothing is installed", w.handlerGlobals.GameFramePost, nil)
	t.same("no unit's maximum is ever lowered", seen.held + seen.lowered, 0)
	t.check("and the player says it could not install the call", said(w, "could not install the call-in itself") ~= nil, table.concat(w.lines, " | "))
end

-- Aim poses (issue #3796). The fixture's one armpw at frame 800 has pose tracks
-- for three pieces. Its own script turns the turret somewhere else in the
-- middle of every frame, as an aiming script does. Gives the world, the
-- turret's turn about y after the gadget's frame on each of 20 frames, and the
-- same when each frame is over.
local SCRIPT_AIM = 2.5
local function aimScene(how, removed)
	local w, gadget = scene(removed)
	gadget:Initialize()
	gadget:RecvLuaMsg("coilbox_rewind_budget:none", 0)
	gadget:RecvLuaMsg("coilbox_rewind:pause", 0)
	gadget:RecvLuaMsg("coilbox_rewind:seek 800", 0)
	local seen = { framed = {}, over = {} }
	w.economy = function()
		local unit = w.unitNamed("armpw")
		seen.framed[#seen.framed + 1] = unit and select(2, w.pieceOf(unit, "turret")) or false
		if unit then
			w.scriptTurn(unit, "turret", 0, SCRIPT_AIM, 0)
		end
	end
	for _ = 1, 20 do
		w.gameFrame(gadget, how)
		local unit = w.unitNamed("armpw")
		seen.over[#seen.over + 1] = unit and select(2, w.pieceOf(unit, "turret")) or false
	end
	return w, seen
end

--- How many of `list` from position `from` on are `value`.
local function countOf(list, from, value)
	local n = 0
	for i = from, #list do
		if list[i] == value then
			n = n + 1
		end
	end
	return n
end

BEHAVIOUR.aimPoses = function()
	local LINE = "GameFramePost does not reach the player, so aiming pieces are posed from GameFrame"

	local w, seen = aimScene(nil)
	local pose = seen.over[20]
	t.check("aimPoses: the track's turn is not where the script aims, so the two can be told apart", type(pose) == "number" and pose ~= SCRIPT_AIM and pose ~= 0, pose)
	t.same("with the call at the end of a frame the pose is the track's when every frame is over", countOf(seen.over, 1, pose), 20)
	t.same("and the player says nothing about posing", said(w, LINE), nil)

	w, seen = aimScene({ engine = false })
	t.same("aimPoses: on an engine with no such call the pose is set in the gadget's frame, on every frame", countOf(seen.framed, 1, pose), 20)
	t.same("the script, which runs after it, has the last word in each", countOf(seen.over, 1, SCRIPT_AIM), 20)
	local line = said(w, LINE)
	t.check("and the player says so, with its prefix", line ~= nil and line:sub(1, #PREFIX) == PREFIX, table.concat(w.lines, " | "))
	local lines = 0
	for _, text in ipairs(w.lines) do
		if text:find(LINE, 1, true) then
			lines = lines + 1
		end
	end
	t.same("once", lines, 1)

	w, seen = aimScene({ handler = false })
	t.same("aimPoses: in a game whose handler does not pass the call on, the pose holds from the frame the call was installed in", countOf(seen.over, 2, pose), 19)
	t.same("the first frame, before it, is the script's", seen.over[1], SCRIPT_AIM)
	t.same("and the player does not say the call is missing", said(w, LINE), nil)
end

-- Telling a unit's script (issue #3797). A unit with a COB script, one with a
-- Lua script and one with neither walk from frame 100 to frame 200, and a
-- builder with a Lua script works on the first of them from frame 120 to frame
-- 180. The player is made as the gadget makes it, with the wrap of the call a
-- script framework hands a Lua script's call-ins over with. `removed` is a call
-- the engine lacks, and `copied` a game whose framework copied the engine's
-- call before the wrap. Gives the world, or nil and what raised.
local function scriptScene(removed, copied)
	local function walk(world, unit)
		world.animate(unit, "leg", 1)
	end
	local function nothing() end
	local w = Engine.new({
		unitDefs = {
			{ name = "cobbot", script = "cob", pieces = { "base", "leg" }, callins = { StartMoving = walk, StopMoving = nothing } },
			{ name = "luabot", script = "lua", pieces = { "base", "leg" }, callins = { StartMoving = walk, StopMoving = nothing } },
			{ name = "crate" },
			{
				name = "engineer",
				script = "lua",
				isImmobile = true,
				isBuilder = true,
				pieces = { "base", "nozzle" },
				callins = {
					StartBuilding = nothing,
					StopBuilding = nothing,
					QueryNanoPiece = function()
						return 2
					end,
				},
			},
		},
	})
	w.frameworkCopied = copied or false
	local env = Engine.env(t, w)
	if removed then
		remove(env, removed)
	end
	local engine = Table.check(rootsOf(env), Table.SYNCED)
	local callIns = {}
	local create = w.Spring.UnitScript.CreateScript
	if create then
		w.Spring.UnitScript.CreateScript = function(unitID, given)
			callIns[unitID] = given
			return create(unitID, given)
		end
	end
	local function stroll(def, x)
		return {
			first = 0,
			last = 400,
			def = def,
			at = function(frame)
				return x, 0, 2 * (math.min(math.max(frame, 100), 200) - 100)
			end,
			poses = def == 0 and { { piece = 0, at = function()
				return 4096, 0, 0, 0, 0, 0
			end } } or nil,
		}
	end
	local Player = t.load("coilbox_player.lua", env)
	local track = Fake.new({
		last = 400,
		unitDefs = { "cobbot", "luabot", "crate", "engineer" },
		posedPieces = { { unitDef = 0, pieces = { "leg" } } },
		units = {
			stroll(0, 0),
			stroll(1, 50),
			stroll(2, 100),
			{
				first = 0,
				last = 400,
				def = 3,
				at = { 200, 0, 0 },
				work = function(frame)
					return frame >= 120 and frame <= 180 and 16 or 0, 1, 255
				end,
			},
		},
	})
	local player = assert(Player.new(track, {
		modOptions = {},
		engine = engine,
		scriptCallIns = callIns,
		log = function(text)
			w.lines[#w.lines + 1] = text
		end,
	}))
	w.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			player:unitDestroyed(unitID)
		end,
	}
	local ok, err = pcall(function()
		player:message("coilbox_rewind:seek 90")
		for _ = 1, 150 do
			w.step(function()
				player:frame()
			end, function()
				player:framePost()
			end)
		end
	end)
	if not ok then
		return nil, err
	end
	return w, engine
end

--- The names of the script functions a unit of a definition was told, in order.
local function toldTo(w, def)
	local names = {}
	for _, one in ipairs(w.scriptCalls) do
		-- Asking for a nano piece is not telling the script anything.
		if one.def == def and one.name ~= "QueryNanoPiece" then
			names[#names + 1] = one.name .. " by " .. one.how
		end
	end
	return table.concat(names, ", ")
end

BEHAVIOUR.unitScripts = function()
	local w = scriptScene()
	t.same("unitScripts: a unit with a COB script is told through the COB call", toldTo(w, "cobbot"), "StartMoving by cob, StopMoving by cob")
	t.same("a unit with a Lua script is told through its own call-ins", toldTo(w, "luabot"), "StartMoving by lua, StopMoving by lua")
	t.same("a unit with neither is told nothing", toldTo(w, "crate"), "")
	t.same("a builder with a Lua script is told when it works", toldTo(w, "engineer"), "StartBuilding by lua, StopBuilding by lua")
	t.same("and no script raised", said(w, "raised in"), nil)

	-- A framework that copied the engine's call before the gadget wrapped it.
	local err
	w, err = scriptScene(nil, true)
	t.check("unitScripts: a Lua script the wrap did not see raises nothing", w ~= nil, err)
	if w then
		t.same("its unit is told nothing", toldTo(w, "luabot"), "")
		t.same("and a COB unit beside it is still told", toldTo(w, "cobbot"), "StartMoving by cob, StopMoving by cob")
	end
end

-- The rows of the animation stage, which the fixture cannot show: its units
-- are under construction at every whole frame, and such a unit is told
-- nothing. Each call is taken out of the engine in turn and the made-up track
-- above is played.
do
	local full = scriptScene()
	local function sees(w)
		local leg = w.unitNamed("cobbot")
		return {
			unitScripts = #w.scriptCalls,
			unitSpeed = w.velocitySets,
			builderWork = w.unitParamSets,
			nanoPieces = w.nanoSets,
			-- The walk's turn of the posed leg is left to the script.
			walkPieces = said(w, "the walk of cobbot turns leg") and 1 or 0,
			placed = leg and leg.z or -1,
		}
	end
	local control = sees(full)
	for _, id in ipairs({ "unitScripts", "unitSpeed", "builderWork", "walkPieces", "nanoPieces" }) do
		t.check("the made-up track shows " .. id .. " at work", control[id] > 0, control[id])
	end
	-- A walk's pieces can only be asked about when a script is told, and a
	-- builder's nano pieces only asked of a script the stage can call.
	local needs = { walkPieces = "unitScripts", nanoPieces = "unitScripts" }
	for _, row in ipairs(Table.SYNCED) do
		if control[row.id] then
			for _, call in ipairs(row.calls) do
				local label = "without " .. call
				local w, engine = scriptScene(call)
				t.check(label .. " the player raises nothing", w ~= nil, engine)
				if w then
					t.same(label .. " the row " .. row.id .. " is off", engine.on[row.id], false)
					local seen = sees(w)
					t.same(label .. " " .. row.id .. " does nothing", seen[row.id], 0)
					for _, other in ipairs({ "unitScripts", "unitSpeed", "builderWork", "walkPieces", "nanoPieces" }) do
						if other ~= row.id and needs[other] ~= row.id then
							t.check(label .. " " .. other .. " still works", seen[other] > 0, other)
						end
					end
					t.same(label .. " the units are still placed", seen.placed, control.placed)
				end
			end
		end
	end
end

-- A row the fixture track cannot show, because it has no unit that is switched
-- on. A switchable unit is on for the whole of a made-up track, and what the
-- engine did to it is read back.

do
	local function radar(engine)
		local w = Engine.new({ unitDefs = { { name = "radar", health = 200, onoffable = true } } })
		local env = Engine.env(t, w)
		local Player = t.load("coilbox_player.lua", env)
		local player = assert(Player.new(
			Fake.new({
				last = 100,
				unitDefs = { "radar" },
				units = { { first = 0, last = 100, status = function() return 1, 1, 1 end } },
			}),
			{
				modOptions = {},
				engine = engine,
				log = function(text)
					w.lines[#w.lines + 1] = text
				end,
			}
		))
		player:frame()
		player:frame()
		return w
	end

	t.same("a switchable unit the track has on is switched on", radar().unitNamed("radar").active, true)
	local onOff
	for _, row in ipairs(Table.SYNCED) do
		if row.id == "onOff" then
			onOff = row
		end
	end
	for _, call in ipairs(onOff.calls) do
		local w = Engine.new({})
		local env = Engine.env(t, w, {})
		remove(env, call)
		local engine = Table.check(rootsOf(env), Table.SYNCED)
		t.same("without " .. call .. " on and off is off", engine.on.onOff, false)
		local ok, err = pcall(radar, engine)
		t.check("without " .. call .. " the player raises nothing", ok, err)
		if ok then
			t.same("without " .. call .. " the unit is left as it was made", err.unitNamed("radar").active, false)
		end
	end
end

for _, row in ipairs(Table.SYNCED) do
	if row.how == "behaviour" then
		t.check("the behaviour row " .. row.id .. " has a test of its behaviour", BEHAVIOUR[row.id] ~= nil, "add one to BEHAVIOUR in engine_test.lua")
		if BEHAVIOUR[row.id] then
			BEHAVIOUR[row.id]()
		end
	end
end

t.report()
