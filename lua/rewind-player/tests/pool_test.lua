-- The unit pool (issue #5029): with a game's adapter asking for it, a seek parks
-- the finished units it removes and uses them again for the units it needs,
-- in place of destroying and creating them. All of it on the engine stand-in in
-- engine.lua, with tracks made from a table (fake_track.lua).
--
-- With the adapter's flag off the player is as it was, which every other test
-- file of the units stage checks, since none of them turns it on.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")
local Unsynced = dofile(here .. "/unsynced.lua")

local function walk(world, unit)
	world.animate(unit, "rleg", 1)
end
local function nothing() end

local NAMES = { "tank", "plant", "walker", "engineer" }
local TANK, PLANT, WALKER, ENGINEER = 0, 1, 2, 3
local UNIT_DEFS = {
	{ name = "tank", health = 1000 },
	{ name = "plant", health = 4000, buildTime = 500 },
	{ name = "walker", script = "lua", pieces = { "base", "rleg" }, callins = { StartMoving = walk, StopMoving = nothing } },
	{ name = "engineer", script = "lua", isBuilder = true, pieces = { "base", "arm" }, callins = { StartBuilding = nothing, StopBuilding = nothing } },
}
local SETTLED = "coilbox_rewind_settled"

--- A world and a player of `spec`, with an adapter that turns the pool on
-- unless `options.off`. `options.budget` is the most a frame does of each kind
-- of work, `options.limit` each team's unit limit, `options.maxUnits` the
-- engine's and `options.engine` what the engine check gave.
local function setup(spec, options)
	options = options or {}
	local teams = {}
	for i, id in ipairs({ 0, 1, 2 }) do
		teams[i] = { id = id, allyTeam = id, limit = options.limit }
	end
	local world = Engine.new({ unitDefs = UNIT_DEFS, teams = teams })
	if options.maxUnits then
		world.globals.Game.maxUnits = options.maxUnits
	end
	local env = Engine.env(t, world)
	local callIns = {}
	local create = world.Spring.UnitScript.CreateScript
	world.Spring.UnitScript.CreateScript = function(unitID, given)
		callIns[unitID] = given
		return create(unitID, given)
	end
	local Player = t.load("coilbox_player.lua", env)
	local Adapter = t.load("coilbox_player_adapter.lua", env)
	local adapter = Adapter.normalize({ name = "test", unitPool = not options.off })
	spec.unitDefs = NAMES
	local player = assert(Player.new(Fake.new(spec), {
		modOptions = {},
		budget = options.budget,
		adapter = adapter,
		engine = options.engine,
		scriptCallIns = callIns,
		work = options.work,
		park = function(unitID, hide)
			world.globals.SendToUnsynced("coilbox_rewind_park", unitID, hide and 1 or 0)
		end,
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
	}))
	world.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			callIns[unitID] = nil
			player:unitDestroyed(unitID)
		end,
	}
	return world, player
end

local function seek(player, frame)
	player:message("coilbox_rewind:seek " .. frame)
end

--- Frames until the player says the world is settled, at most `most`.
local function settle(player, world, most)
	for n = 1, most or 50 do
		player:frame()
		player:framePost()
		if world.params[SETTLED] == 1 then
			return n
		end
	end
	error("the player never settled")
end

--- `n` units from `first` to `last`, each 10 elmos along.
local function row(n, first, last, def, team)
	local units = {}
	for i = 1, n do
		units[i] = { first = first, last = last, def = def or TANK, team = team or 0, at = { i * 10, 0, 0 } }
	end
	return units
end

local function append(list, more)
	for _, one in ipairs(more) do
		list[#list + 1] = one
	end
	return list
end

local function events(world, kind)
	local n = 0
	for _, event in ipairs(world.events) do
		if event:find("^" .. kind .. " ") then
			n = n + 1
		end
	end
	return n
end

local function said(world, needle)
	for _, line in ipairs(world.lines) do
		if line:find(needle, 1, true) then
			return true
		end
	end
	return false
end

--- The units alive in the world that are not parked.
local function shown(world, player)
	local n = 0
	for id, unit in pairs(world.units) do
		if not unit.dead and not player.units.parkedKey[id] then
			n = n + 1
		end
	end
	return n
end

-- A seek parks the finished units it removes, and a seek back uses them again.

do
	local world, player = setup({ last = 600, units = row(5, 100, 400) })
	t.check("the player says the adapter turned the pool on", said(world, "turns the unit pool on, so"))
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	t.same("the five are made", events(world, "create"), 5)
	world.events = {}
	seek(player, 50)
	settle(player, world)
	t.same("a seek away destroys none of them", events(world, "remove") + events(world, "explode"), 0)
	t.same("all five are parked", player.units.parkedCount, 5)
	t.same("and none is shown", shown(world, player), 0)
	local id, unit = next(world.units)
	t.same("a parked unit stands off the map", table.concat({ unit.x, unit.y, unit.z }, " "), "-2000 -5000 -2000")
	t.same("blocks nothing", table.concat({ tostring(unit.blocking[1]), tostring(unit.blocking[2]), tostring(unit.blocking[7]) }, " "), "false false false")
	t.same("sees nothing", unit.sensors.los + unit.sensors.airLos + unit.sensors.radar, 0)
	t.same("is neutral", unit.neutral, true)
	t.same("is stunned, so that it makes and uses no resources", unit.stunned, true)
	t.same("and the unsynced half was told to hide it", world.hidden[id], true)
	t.same("the parked units are in the set the gadget gives the base game", player.units.parkedKey[id] ~= nil, true)

	world.events = {}
	seek(player, 150)
	settle(player, world)
	t.same("a seek back creates none", events(world, "create"), 0)
	t.same("the pool is empty again", player.units.parkedCount, 0)
	t.same("all five are shown", shown(world, player), 5)
	t.same("where the track has them", unit.y == 0 and unit.x > 0, true)
	t.same("blocking as before", unit.blocking[1] and unit.blocking[2] and unit.blocking[7], true)
	t.same("seeing as before", unit.sensors.los, 300)
	t.same("not neutral", unit.neutral, false)
	t.same("not stunned", unit.stunned, false)
	t.same("and shown by the unsynced half", world.hidden[id], false)
	t.same("its health is the track's", unit.health, unit.maxHealth)
end

-- A nanoframe is destroyed, and a unit that dies while watched is destroyed
-- with its explosion.

do
	local building = {
		first = 100,
		last = 400,
		def = PLANT,
		at = { 100, 0, 100 },
		status = function()
			return 0.5, 0.5, 0
		end,
	}
	local units = append({ building }, row(2, 100, 400))
	units[#units + 1] = { first = 100, last = 160, def = TANK, at = { 500, 0, 0 } }
	local world, player = setup({ last = 600, units = units })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	world.events = {}
	player:message("coilbox_rewind:play")
	for _ = 1, 15 do
		player:frame()
		player:framePost()
	end
	t.same("a unit that dies while watched explodes", events(world, "explode"), 1)
	t.same("and is not parked", player.units.parkedCount, 0)
	player:message("coilbox_rewind:pause")
	world.events = {}
	seek(player, 50)
	settle(player, world)
	t.same("a seek parks the two finished units", player.units.parkedCount, 2)
	t.same("and destroys the nanoframe", events(world, "remove"), 1)
	world.events = {}
	seek(player, 150)
	settle(player, world)
	t.same("a seek back creates the nanoframe, which is never taken from the pool, and the tank that exploded", events(world, "create"), 2)
	t.same("and its unit is under construction", world.unitNamed("plant").beingBuilt, true)
end

-- A pool is one definition on one team, and holds no more than were ever alive
-- at once.

do
	local units = append(row(3, 100, 200, TANK, 0), row(3, 300, 400, TANK, 1))
	append(units, row(2, 300, 400, WALKER, 0))
	local world, player = setup({ last = 600, units = units })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	world.events = {}
	seek(player, 350)
	settle(player, world)
	t.same("three tanks of team 0 are parked", player.units.parkedCount, 3)
	t.same("and none is used for team 1's tanks or team 0's walkers, which are created", events(world, "create"), 5)
	seek(player, 150)
	settle(player, world)
	t.same("a seek back uses the three tanks and parks the five", player.units.parkedCount, 5)
	-- Three tanks that are built while three others are parked are made as
	-- nanoframes, which never come from the pool, so six tanks are held and the
	-- most alive at once is three.
	local units2 = row(3, 100, 200, TANK, 0)
	for _, one in ipairs(row(3, 300, 400, TANK, 0)) do
		one.status = function(frame)
			if frame < 350 then
				return 0.5, 0.5, 0
			end
			return 1, 1, 0
		end
		units2[#units2 + 1] = one
	end
	local world2, player2 = setup({ last = 600, units = units2 })
	player2:message("coilbox_rewind:pause")
	seek(player2, 150)
	settle(player2, world2)
	seek(player2, 320)
	settle(player2, world2)
	t.same("the second three are made as nanoframes beside the three parked", player2.units.parkedCount .. " " .. events(world2, "create"), "3 6")
	seek(player2, 380)
	settle(player2, world2)
	seek(player2, 50)
	settle(player2, world2)
	t.same("a pool keeps no more than were ever alive at once", player2.units.parkedCount, 3)
	t.same("so the finished three are destroyed", events(world2, "remove"), 3)
end

-- The whole player stays under the engine's limit, and a unit the engine
-- refuses at its team's limit makes room by destroying a parked unit.

do
	local units = append(row(4, 100, 200, TANK, 0), row(4, 300, 400, WALKER, 0))
	local world, player = setup({ last = 600, units = units }, { maxUnits = 6 })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	seek(player, 50)
	settle(player, world)
	t.same("the pool and the most alive at once stay under the engine's limit", player.units.parkedCount, 2)

	local world2, player2 = setup({ last = 600, units = units }, { limit = 5 })
	player2:message("coilbox_rewind:pause")
	seek(player2, 150)
	settle(player2, world2)
	world2.events = {}
	seek(player2, 350)
	settle(player2, world2)
	t.same("four walkers are made at a team limit of five, four tanks parked", shown(world2, player2), 4)
	t.same("by destroying three parked tanks to make room", player2.units.parkedCount, 1)
	t.same("and says so", said(world2, "while parked units held the room"), true)
end

-- A parked unit is left alone by a seek's sweep for strangers, and one the base
-- game destroys leaves the pool.

do
	local world, player = setup({ last = 600, units = row(3, 100, 400) })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	seek(player, 50)
	settle(player, world)
	seek(player, 60)
	settle(player, world)
	t.same("a seek leaves parked units alone", player.units.parkedCount, 3)
	local id = next(player.units.parkedKey)
	world.Spring.DestroyUnit(id, false, true)
	t.same("a parked unit the base game destroys leaves the pool", player.units.parkedCount, 2)
	t.same("and that is logged", said(world, "destroyed a parked unit"), true)
	world.events = {}
	seek(player, 150)
	settle(player, world)
	t.same("so a seek back makes one and uses two", events(world, "create"), 1)
	t.same("and the three are there", shown(world, player), 3)
end

-- Parking and unparking come first, each with a budget of its own.

do
	local units = append(row(6, 100, 200, TANK, 0), row(6, 300, 400, TANK, 0))
	append(units, row(4, 300, 400, WALKER, 0))
	local world, player = setup({ last = 600, units = units }, { budget = 1 })
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind_budget:100 100 100 100 100")
	seek(player, 150)
	settle(player, world)
	-- Six tanks out, six tanks in, four walkers in. The pool holds six tanks.
	player:message("coilbox_rewind_budget:2 3 100 4 5")
	seek(player, 50)
	local parks = {}
	for n = 1, 2 do
		player:frame()
		parks[n] = player.units.parks .. "/" .. player.units.removed
	end
	t.same("a frame parks as many as the park budget, and destroys nothing while one is left", table.concat(parks, " "), "4/0 2/0")
	seek(player, 350)
	local work = {}
	for n = 1, 3 do
		player:frame()
		work[n] = player.units.unparks .. "/" .. player.units.made
	end
	t.same("unparking comes first, at its budget, and making waits for it, as removing does", table.concat(work, " "), "5/0 1/2 0/2")
	t.same("the player says what it made, removed, set, parked and unparked", table.concat({ player:worked() }, " "), "2 0 0 0 0")
	t.same("and the budgets it worked to", table.concat({ player:budgets() }, " "), "2 3 100 4 5")
	t.same("a budget of two or three numbers leaves the pool's", player:message("coilbox_rewind_budget:7 8"), true)
	t.same("as they were", table.concat({ player:budgets() }, " "), "7 8 100 4 5")
	t.same("four numbers are refused", player:message("coilbox_rewind_budget:1 2 3 4"), true)
	t.same("so nothing moves", table.concat({ player:budgets() }, " "), "7 8 100 4 5")
end

-- A unit parked while it walks or builds is told so, and one used again is
-- learnt afresh by the animation and aim stages.

do
	local walker = {
		first = 0,
		last = 600,
		def = WALKER,
		at = function(frame)
			return 50, 0, 2 * (math.min(math.max(frame, 100), 400) - 100)
		end,
	}
	local other = {
		first = 500,
		last = 600,
		def = WALKER,
		at = { 80, 0, 80 },
	}
	walker.last = 300
	local builder = {
		first = 0,
		last = 300,
		def = ENGINEER,
		at = { 0, 0, 0 },
		work = function()
			return 16, 1, 255
		end,
	}
	local world, player = setup({ last = 600, units = { walker, other, builder } })
	for _ = 1, 150 do
		player:frame()
		player:framePost()
	end
	local unit = world.unitNamed("walker")
	local engineer = world.unitNamed("engineer")
	t.same("the walker walks", unit.vz, 2)
	t.same("the builder publishes its work", engineer.params.coilbox_rewind_work_command ~= nil and engineer.params.coilbox_rewind_work_command ~= 0, true)
	player:message("coilbox_rewind:pause")
	seek(player, 550)
	settle(player, world)
	t.same("the walker was parked and its unit used again for the other walker", world.unitNamed("walker"), unit)
	local stops = 0
	for _, one in ipairs(world.callsTo(unit)) do
		if one.name == "StopMoving" then
			stops = stops + 1
		end
	end
	t.same("its script was told it stopped as it was parked", stops, 1)
	t.same("and it has no velocity", unit.vz, 0)
	t.same("the parked builder's work is cleared", engineer.params.coilbox_rewind_work_command, 0)
	-- The fake track numbers its units' serials from 0, in the order given.
	t.same("the animation stage knows the walker by its new serial", player.animation.unitID[1], unit.id)
end

-- With the adapter's flag off, or an engine without the calls, a seek destroys
-- and creates as before.

do
	local world, player = setup({ last = 600, units = row(3, 100, 400) }, { off = true })
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	settle(player, world)
	seek(player, 50)
	settle(player, world)
	t.same("with the flag off nothing is parked", player.units.parkedCount, 0)
	t.same("the units are destroyed", events(world, "remove"), 3)
	t.same("and the pool is not mentioned", said(world, "unit pool"), false)
	t.same("nor sent with the work", select("#", player:worked()), 3)

	local on = setmetatable({ unitPool = false }, {
		__index = function()
			return true
		end,
	})
	local world2, player2 = setup({ last = 600, units = row(3, 100, 400) }, { engine = { on = on } })
	player2:message("coilbox_rewind:pause")
	seek(player2, 150)
	settle(player2, world2)
	seek(player2, 50)
	settle(player2, world2)
	t.same("on an engine without the calls nothing is parked", player2.units.parkedCount, 0)
	t.same("and it says why", said(world2, "this engine lacks a call it needs"), true)
end

-- A pool smaller than a seek makes no frame slower than one simulation frame.
-- The synced player and the gadget's unsynced half run together here, the
-- budgets going between them as messages, on a clock that each kind of work
-- moves by what it cost the engine: 0.9 ms to create a unit, 0.6 ms to destroy
-- one and 0.04 ms to park or unpark one, which is the order the spike measured
-- on Splinter Faction (#4010). A seek of 400 units is played back and forth
-- with an engine limit that leaves the pool room for 150 of them, so every
-- seek parks and destroys, and unparks and creates.

do
	local units = append(row(400, 100, 200, TANK, 0), row(400, 300, 400, WALKER, 0))
	local world, player = setup({ last = 600, units = units }, { budget = 1, maxUnits = 550 })
	local clock = { now = 0, micros = true }
	local e = Unsynced.new(clock)
	local env = t.unsyncedEnv()
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return false
		end,
	}
	env.Game = { gameSpeed = 30, maxUnits = e.maxUnits }
	env.VFS.Include = function(path)
		return t.load(assert(path:match("^luarules/rewind_player/(.+)$"), path), env)
	end
	env.Spring, env.gl, env.GL, env.CMD, env.UnitDefs, env.io = e.Spring, e.gl, e.GL, e.CMD, e.UnitDefs, e.io
	e.lines = {}
	local chunk = assert(loadfile(t.root() .. "/luarules/gadgets/coilbox_rewind_player.lua"))
	setfenv(chunk, env)
	chunk()
	local gadget = env.gadget
	local LIMIT = 1000 / 30
	local worst, frames, seen, mostParked = 0, 0, 0, 0
	local before = { create = 0, remove = 0 }
	local function cost()
		local made, destroyed = events(world, "create"), events(world, "remove")
		local ms = (made - before.create) * 0.9 + (destroyed - before.remove) * 0.6 + (player.units.parks + player.units.unparks) * 0.04
		before.create, before.remove = made, destroyed
		return ms
	end
	local function frame()
		frames = frames + 1
		player:frame()
		player:framePost()
		local ms = cost()
		worst = math.max(worst, ms)
		mostParked = math.max(mostParked, player.units.parkedCount)
		local made, removed, ground, parked, unparked = player:worked()
		local make, remove, earth, park, unpark = player:budgets()
		gadget:RecvFromSynced("coilbox_rewind_work", 0, frames)
		clock.now = clock.now + ms
		gadget:RecvFromSynced("coilbox_rewind_work", 1, frames, made, removed, ground, make, remove, earth, player:firstUnits(), player:started() and 1 or 0, parked, unparked, park, unpark)
		-- Each message reaches the synced half before its next frame.
		for k = seen + 1, #clock.messages do
			player:message(clock.messages[k])
		end
		seen = #clock.messages
	end
	player:message("coilbox_rewind:pause")
	local settledIn = {}
	for n, to in ipairs({ 150, 350, 150, 350, 150 }) do
		seek(player, to)
		local count = 0
		repeat
			frame()
			count = count + 1
		until world.params[SETTLED] == 1 or count > 400
		settledIn[n] = count
		t.same("seek " .. n .. " ends with the track's 400 units shown", shown(world, player), 400)
	end
	t.check("the pool is smaller than a seek", mostParked > 0 and mostParked < 400, mostParked)
	t.check("no frame took longer than a simulation frame", worst <= LIMIT, string.format("%.1f ms, seeks took %s frames", worst, table.concat(settledIn, " ")))
	t.check("and the pool's budgets were sent", clock.messages[#clock.messages]:find("^coilbox_rewind_budget:%d+ %d+ %d+ %d+ %d+$") ~= nil, clock.messages[#clock.messages])
	t.same("no slow frame was logged", #e.lines, 0)
end

-- The unsynced half hides a parked unit and shows it again.

do
	local clock = { now = 0 }
	local e = Unsynced.new(clock)
	local env = t.unsyncedEnv()
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return false
		end,
	}
	env.Game = { gameSpeed = 30, maxUnits = e.maxUnits }
	env.VFS.Include = function(path)
		return t.load(assert(path:match("^luarules/rewind_player/(.+)$"), path), env)
	end
	env.Spring, env.gl, env.GL, env.CMD, env.UnitDefs, env.io = e.Spring, e.gl, e.GL, e.CMD, e.UnitDefs, e.io
	e.lines = {}
	local chunk = assert(loadfile(t.root() .. "/luarules/gadgets/coilbox_rewind_player.lua"))
	setfenv(chunk, env)
	chunk()
	env.gadget:RecvFromSynced("coilbox_rewind_park", 7, 1)
	t.same("a parked unit is not drawn, selected or on the minimap", tostring(e.noDraw[7]) .. tostring(e.noSelect[7]) .. tostring(e.noMinimap[7]), "truetruetrue")
	env.gadget:RecvFromSynced("coilbox_rewind_park", 7, 0)
	t.same("and one taken back is all three again", tostring(e.noDraw[7]) .. tostring(e.noSelect[7]) .. tostring(e.noMinimap[7]), "falsefalsefalse")
end

-- Playing with the pool on and nothing to do allocates nothing.

do
	local world, player = setup({ last = 3000, windowLength = 3000, units = row(40, 0, 3000) }, { budget = 7 })
	for _ = 1, 8 do
		player:frame()
		player:framePost()
	end
	t.same("the forty are made", shown(world, player), 40)
	collectgarbage()
	collectgarbage("stop")
	player:frame()
	player:framePost()
	local before = collectgarbage("count")
	for _ = 1, 300 do
		player:frame()
		player:framePost()
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play with the pool on allocate nothing", after - before, 0)
end

t.report()
