-- The player: what it makes of a track at a time, on the engine stand-in in
-- engine.lua. Most of it runs on tracks made from a table (fake_track.lua), so a
-- test can say when a building was finished. The end of the file runs the
-- fixture through the real reader.
--
-- None of this shows the player working in an engine. scripts/rewind-playback-headless.sh
-- does that.

-- The engine runs plain Lua 5.1. LuaJIT's traces are memory the allocation
-- count at the end would show.
if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local UNIT_DEFS = {
	{ name = "tank", health = 1000 },
	{ name = "plant", health = 4000, buildTime = 500 },
	{ name = "radar", health = 200, onoffable = true },
}
local FEATURE_DEFS = { { name = "rock" }, { name = "wreck" } }

--- A world and a player of `spec`, which is a fake track's table or a track.
-- The player has not taken a frame yet.
local function setup(spec, options)
	options = options or {}
	local world = Engine.new({
		unitDefs = options.unitDefs or UNIT_DEFS,
		featureDefs = options.featureDefs or FEATURE_DEFS,
		teams = options.teams,
		constructionDecay = options.constructionDecay,
	})
	if options.before then
		options.before(world)
	end
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local track = spec.header and spec or Fake.new(spec)
	local player = assert(Player.new(track, {
		modOptions = options.modOptions or {},
		installFramePost = options.installFramePost,
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
	}))
	-- The engine calls the gadget, and the gadget hands the call to the player.
	world.gadget = {
		UnitCreated = function(_, unitID)
			player:unitCreated(unitID)
		end,
		UnitDestroyed = function(_, unitID)
			player:unitDestroyed(unitID)
		end,
		FeatureCreated = function(_, featureID)
			player:featureCreated(featureID)
		end,
		FeatureDestroyed = function(_, featureID)
			player:featureDestroyed(featureID)
		end,
		AllowFeatureCreation = function()
			return player:allowFeatureCreation()
		end,
		TeamDied = function(_, teamID)
			player:teamDied(teamID)
		end,
	}
	return world, player, track, Player
end

local function seek(player, frame)
	player:message("coilbox_rewind:seek " .. frame)
	player:frame()
end

local function said(world, needle)
	local n = 0
	for _, line in ipairs(world.lines) do
		if line:find(needle, 1, true) then
			n = n + 1
		end
	end
	return n
end

local NAMES = { "tank", "plant", "radar" }

-- What is alive at a time.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{ first = 0, last = 300, at = { 10, 5, 20 } },
			{ first = 100, last = 200, team = 1 },
			{ first = 150, last = 300, def = 2 },
		},
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("at the first frame one unit is alive", world.unitCount(), 1)
	for _, case in ipairs({ { 120, 2 }, { 180, 3 }, { 250, 2 }, { 50, 1 }, { 200, 3 }, { 201, 2 }, { 99, 1 }, { 100, 2 } }) do
		seek(player, case[1])
		t.same("at frame " .. case[1] .. " the live units are the track's " .. case[2], world.unitCount(), case[2])
	end

	local tank = world.unitNamed("tank")
	t.same("a unit stands where the track has it, x", tank.x, 10)
	t.same("y", tank.y, 5)
	t.same("z", tank.z, 20)
	t.same("it is under move control", tank.moveCtrl, true)
	t.same("its weapons are switched off", tank.useWeapons, false)
	t.same("it is on the track's team", tank.team, 0)
	t.same("a track with no terrain rows never touches the heightmap", world.heightMapCalls, nil)
end

-- A unit the track has alive with no health left.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = { {
			first = 0,
			last = 300,
			status = function(frame)
				return frame >= 100 and 0 or 0.5, 1, 0
			end,
		} },
	})
	player:message("coilbox_rewind:pause")
	seek(player, 50)
	t.same("a unit has the track's health", world.unitNamed("tank").health, 500)
	seek(player, 150)
	t.near("a unit the track has alive at no health keeps one step of it, since the engine kills a unit with none on its next hit", world.unitNamed("tank").health, 1000 / 65535, 1e-9)
end

-- Removals come before creations.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{ first = 0, last = 100, def = 1, at = { 64, 0, 64 } },
			{ first = 101, last = 300, def = 1, at = { 64, 0, 64 } },
			{ first = 101, last = 300, at = { 5, 0, 5 } },
		},
		features = { { def = 1, first = 101, last = 300, at = { 64, 0, 64 } } },
	})
	player:message("coilbox_rewind:pause")
	seek(player, 100)
	local first = world.unitNamed("plant").id
	world.events = {}
	seek(player, 101)
	local removed, created
	for n, event in ipairs(world.events) do
		if event == "remove " .. first then
			removed = n
		elseif event:find("^create ") or event:find("^feature ") then
			created = created or n
		end
	end
	t.check("the building that stood there is removed", removed ~= nil, table.concat(world.events, ", "))
	t.check("before anything is created", removed and created and removed < created, table.concat(world.events, ", "))
	t.check("the engine chose a new id for the building that replaced it", world.unitNamed("plant").id ~= first)
end

-- Seeking backward past a construction.

do
	local world, player = setup({
		last = 400,
		unitDefs = NAMES,
		units = {
			{
				first = 100,
				last = 400,
				def = 1,
				status = function(frame)
					local build = math.min(1, (frame - 100) / 100)
					return 0.5 + build / 2, build, 0
				end,
			},
		},
	})
	player:message("coilbox_rewind:pause")
	seek(player, 250)
	local plant = world.unitNamed("plant")
	t.same("after it was built the building is finished", plant.beingBuilt, false)
	t.same("with the track's health", plant.health, 4000)
	seek(player, 150)
	plant = world.unitNamed("plant")
	t.same("half way through its construction it is a nanoframe", plant.beingBuilt, true)
	t.same("at the track's build progress", plant.build, 0.5)
	t.same("and health", plant.health, 3000)
	local id = plant.id
	seek(player, 50)
	t.same("before its construction it is removed", world.unitCount(), 0)
	seek(player, 150)
	t.check("and going forward again makes it again, with an id the engine chose", world.unitNamed("plant").id ~= id)
	seek(player, 200)
	t.same("it is finished on the frame its progress is whole", world.unitNamed("plant").beingBuilt, false)
end

-- An engine where a finished unit cannot go back under construction.

do
	local world, player = setup({
		last = 400,
		unitDefs = NAMES,
		units = {
			{
				first = 100,
				last = 400,
				def = 1,
				at = { 8, 2, 8 },
				status = function(frame)
					return 1, math.min(1, (frame - 100) / 100), 0
				end,
			},
		},
	})
	world.oldEngine = true
	player:message("coilbox_rewind:pause")
	seek(player, 250)
	local id = world.unitNamed("plant").id
	seek(player, 150)
	local plant = world.unitNamed("plant")
	t.same("on an older engine the unit is under construction after seeking back", plant.beingBuilt, true)
	t.check("because it was destroyed and created again", plant.id ~= id)
	t.same("at the track's progress", plant.build, 0.5)
	t.same("and place", plant.x, 8)
	t.same("one unit, not two", world.unitCount(), 1)
end

-- A nanoframe the game would let decay.

do
	local world, player = setup({
		last = 400,
		unitDefs = NAMES,
		units = {
			{
				first = 0,
				last = 400,
				def = 1,
				status = function()
					return 0, 0, 0
				end,
			},
		},
	}, { constructionDecay = true })
	player:message("coilbox_rewind:pause")
	player:frame()
	local plant = world.unitNamed("plant")
	-- CUnit::SlowUpdate takes 1 / (buildTime * constructionDecaySpeed) off both
	-- and kills the unit when either reaches zero.
	local decay = 1 / (500 * 0.03)
	t.check("its progress is held above one step of decay", plant.build > decay, plant.build)
	t.check("and its health", plant.health > 4000 * decay, plant.health)
	local sets = plant.healthSets
	player:frame()
	t.check("and both are set again on every frame", plant.healthSets > sets)
end

-- Playing forward and backward.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{
				first = 0,
				last = 300,
				at = function(frame)
					return frame * 2, 0, 0
				end,
			},
		},
	})
	player:frame()
	local tank = world.unitNamed("tank")
	t.same("the first frame is the track's first", tank.x, 0)
	player:frame()
	player:frame()
	t.same("each frame plays one frame on", tank.x, 4)
	player:message("coilbox_rewind:direction -1")
	player:frame()
	t.same("backward plays one frame back", tank.x, 2)
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("paused, it stays", tank.x, 2)
	player:message("coilbox_rewind:step 1")
	player:frame()
	t.same("a step forward is one frame", tank.x, 4)
	player:message("coilbox_rewind:step -1")
	player:frame()
	player:message("coilbox_rewind:step -1")
	player:frame()
	t.same("two steps back are two frames", tank.x, 0)
	t.same("the same unit all along", world.unitNamed("tank").id, tank.id)
end

-- How a unit goes.

do
	local function dying(prepare)
		local world, player = setup({
			last = 300,
			unitDefs = NAMES,
			units = { { first = 0, last = 300 }, { first = 0, last = 100, team = 1 } },
		})
		seek(player, 98)
		prepare(player)
		world.events = {}
		for _ = 1, 8 do
			player:frame()
		end
		return world, table.concat(world.events, ", ")
	end

	local world, events = dying(function() end)
	t.check("a unit that dies while playing forward at 1x dies with its death effect", events:find("explode", 1, true) ~= nil, events)
	t.same("the wreck the engine would leave is refused", world.refusedWrecks, 1)
	t.same("no wreck was left", world.wrecks, nil)
	t.same("the refusal is logged once", said(world, "asked to leave a wreck"), 1)
	t.same("the other unit is still there", world.unitCount(), 1)

	_, events = dying(function(player)
		player:message("coilbox_rewind:speed 2")
	end)
	t.check("and at 2x", events:find("explode", 1, true) ~= nil, events)
	_, events = dying(function(player)
		player:message("coilbox_rewind:speed 0.5")
	end)
	t.check("and at 0.5x", events:find("explode", 1, true) ~= nil, events)
	_, events = dying(function(player)
		player:message("coilbox_rewind:speed 4")
	end)
	t.check("at 4x it vanishes quietly", events:find("^remove") ~= nil, events)
	_, events = dying(function(player)
		player:message("coilbox_rewind:seek 200")
	end)
	t.check("a seek past its death removes it quietly", events:find("^remove") ~= nil, events)

	local backward, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = { { first = 100, last = 300 } },
	})
	seek(player, 102)
	player:message("coilbox_rewind:direction -1")
	backward.events = {}
	for _ = 1, 4 do
		player:frame()
	end
	t.same("playing backward past a unit's first frame removes it quietly", backward.events[1], "remove 100")
end

-- Health, and switching on.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{
				first = 0,
				last = 300,
				def = 2,
				status = function(frame)
					return frame < 100 and 0.5 or 0.25, 1, frame >= 50 and 1 or 0
				end,
			},
		},
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	local radar = world.unitNamed("radar")
	t.same("health is the track's fraction of the unit's maximum", radar.health, 100)
	t.same("a unit the track has switched off is off", radar.active, false)
	local sets, orders = radar.healthSets, world.orders
	player:frame()
	player:frame()
	t.same("health that has not changed is not set again", radar.healthSets, sets)
	t.same("and no order is given", world.orders, orders)
	seek(player, 60)
	t.same("a unit the track has switched on is on", radar.active, true)
	seek(player, 120)
	t.same("health follows the track", radar.health, 50)

	-- Something hurt it. The track owns health.
	radar.health = 10
	player:unitDamaged(radar.id)
	player:frame()
	t.same("damage that got through is put right on the next frame", radar.health, 50)

	-- Something healed it and nothing said so: the engine heals an idle unit,
	-- and Splinter Faction's regeneration gadget sets health once a second. The
	-- track's value stands still while paused, so only the engine's own value
	-- can show it.
	radar.health = 180
	player:frame()
	t.same("health that rose with no damage is put right on the next frame", radar.health, 50)
end

-- The engine heals a unit in the middle of a simulation frame, after the
-- gadgets' GameFrame and before their GameFramePost (CUnit::SlowUpdate), and
-- only a unit with health below its maximum. The player makes the maximum the
-- health for that stretch, so the engine has nothing to heal (issue #3986).

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{
				first = 0,
				last = 300,
				def = 2,
				status = function()
					return 0.25, 1, 1
				end,
			},
			{
				first = 0,
				last = 300,
				def = 0,
				status = function()
					return 1, 1, 1
				end,
			},
			{
				first = 0,
				last = 300,
				def = 1,
				status = function()
					return 0.5, 0.5, 1
				end,
			},
		},
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	local radar, tank, plant = world.unitNamed("radar"), world.unitNamed("tank"), world.unitNamed("plant")
	t.same("a wounded unit has the track's health", radar.health, 50)

	-- The first frame: nothing has said yet that the engine tells the player when
	-- a frame is over, so the maximum is left alone (issue #4002).
	t.same("before the player knows a post frame call comes, the maximum is whole", radar.maxHealth, 200)
	world.heal(30)
	t.same("so the engine heals in the first frame", radar.health, 80)
	player:framePost()
	t.same("and the post frame call takes it off again", radar.health, 50)
	t.same("without a word, since nothing of the game did it", said(world, "with no damage to hear of"), 0)
	t.same("the maximum was never touched", radar.maxHealthSets, nil)

	player:frame()
	world.heal(30)
	t.same("the engine's healing in the rest of the frame changes nothing", radar.health, 50)
	t.same("because until the frame is over the unit's maximum is its health", radar.maxHealth, 50)
	player:framePost()
	t.same("the maximum is back when the frame is over", radar.maxHealth, 200)
	t.same("and the health is the track's", radar.health, 50)
	t.same("the player had nothing to say about it", said(world, "with no damage to hear of"), 0)

	for _ = 1, 40 do
		player:frame()
		world.heal(30)
		player:framePost()
	end
	t.same("forty frames of healing later it is still the track's", radar.health, 50)
	t.same("a unit at full health keeps its maximum all the time", tank.maxHealthSets, nil)
	t.same("a unit under construction does too, since the engine does not heal it", plant.maxHealthSets, nil)

	-- A frame whose post frame call never comes, which is a gadget handler that
	-- stopped passing it on. The maximum is back at the start of the next frame,
	-- and no unit is held again until the call has come back.
	player:frame()
	t.same("a unit is held in a frame that follows a post frame call", radar.maxHealth, 50)
	player:message("coilbox_rewind:seek 10")
	player:frame()
	t.same("a unit whose post frame call never came has its maximum back on the next frame", radar.maxHealth, 200)
	t.same("and the track's health", radar.health, 50)
	player:framePost()
	t.same("with its maximum whole after", radar.maxHealth, 200)
	player:frame()
	t.same("and is held again once the call has come back", radar.maxHealth, 50)
	player:framePost()

	-- Holding a unit and giving it back allocates nothing.
	player:message("coilbox_rewind:play")
	player:frame()
	player:framePost()
	collectgarbage()
	collectgarbage("stop")
	-- A full collection gives back part of the Lua stack, and the first frames
	-- after it take that back, which is the interpreter's and not the player's.
	player:frame()
	world.heal(30)
	player:framePost()
	local before = collectgarbage("count")
	for _ = 1, 200 do
		player:frame()
		world.heal(30)
		player:framePost()
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("200 frames of holding a wounded unit allocate nothing", after - before, 0)
	t.same("and it kept the track's health", radar.health, 50)
end

-- The post frame call never arrives (issue #4002): an engine before
-- 105.1.1-2590, or a game whose gadget handler does not pass it on and where
-- the player could not install it. No unit's maximum is ever lowered, the
-- engine's healing is taken off on the next frame, and the player says so once.

local function wounded()
	return {
		last = 300,
		unitDefs = NAMES,
		units = { {
			first = 0,
			last = 300,
			def = 2,
			status = function()
				return 0.25, 1, 1
			end,
		} },
	}
end

do
	local world, player = setup(wounded())
	player:message("coilbox_rewind:pause")
	local lowered, radar = 0, nil
	for _ = 1, 60 do
		player:frame()
		radar = world.unitNamed("radar")
		if radar.maxHealth ~= 200 then
			lowered = lowered + 1
		end
		world.heal(30)
		if radar.maxHealth ~= 200 then
			lowered = lowered + 1
		end
	end
	t.same("with no post frame call no unit starts or ends a frame with a lowered maximum", lowered, 0)
	t.same("its maximum is never set at all", radar.maxHealthSets, nil)
	t.same("the engine's healing of a frame shows until the next", radar.health, 80)
	player:frame()
	t.same("which puts the health back", radar.health, 50)
	t.same("the player says once that the call does not reach it", said(world, "GameFramePost does not reach the player, so a wounded unit keeps its maximum health"), 1)
	t.same("and does not blame a gadget of the game", said(world, "with no damage to hear of"), 0)
	t.same("the resources stage says what it does without the call, once", said(world, "GameFramePost does not reach the player, so what a team holds"), 1)
end

-- The gadget can install the call when the game's handler does not pass it on.
-- The player asks once, a frame after it saw none, and gives it one frame.

do
	local asked = 0
	local world, player = setup(wounded(), {
		installFramePost = function()
			asked = asked + 1
			return true
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	local radar = world.unitNamed("radar")
	t.same("the first frame asks for nothing, since no frame has ended yet", asked, 0)
	player:frame()
	t.same("the second frame, with no post frame call before it, asks for the install", asked, 1)
	t.same("and lowers nothing while it waits", radar.maxHealth, 200)
	player:framePost()
	for _ = 1, 20 do
		player:frame()
		world.heal(30)
		player:framePost()
	end
	t.same("an install that works is asked for once", asked, 1)
	t.same("and the unit is held from then on", radar.health, 50)
	t.same("with its maximum whole when a frame is over", radar.maxHealth, 200)
	t.same("the player says that it installed the call", said(world, "does not pass GameFramePost on, so the player installed it"), 1)
	t.same("and not that it is missing", said(world, "GameFramePost does not reach the player"), 0)

	-- The handler takes the global away again, as one does when a gadget is
	-- removed. The player asks again.
	player:frame()
	player:frame()
	t.same("a call that stops coming is asked for again", asked, 2)
	t.same("with the maximum whole in the meantime", radar.maxHealth, 200)
	player:framePost()
	player:frame()
	t.same("and held again once it is back", radar.maxHealth, 50)
	player:framePost()

	-- The gadget is removed in the middle of a frame.
	player:frame()
	t.same("a unit is held in the frame the gadget goes in", radar.maxHealth, 50)
	player:shutdown()
	t.same("and has its maximum back when the gadget shuts down", radar.maxHealth, 200)
end

do
	-- An install that changes nothing: the engine has no such call.
	local asked = 0
	local world, player = setup(wounded(), {
		installFramePost = function()
			asked = asked + 1
			return true
		end,
	})
	player:message("coilbox_rewind:pause")
	for _ = 1, 30 do
		player:frame()
		world.heal(30)
	end
	local radar = world.unitNamed("radar")
	t.same("an install that brings no call is tried once and not again", asked, 1)
	t.same("the maximum is never set", radar.maxHealthSets, nil)
	t.same("the missing call is said once", said(world, "GameFramePost does not reach the player, so a wounded unit keeps its maximum health"), 1)
	t.same("with the install that was tried", said(world, "The player installed the call-in itself and still none came"), 1)
end

-- A game's gadget that heals before the player's frame, and anything else that
-- moves health during the frame, are put right and said once.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = {
			{
				first = 0,
				last = 300,
				def = 2,
				status = function()
					return 0.25, 1, 1
				end,
			},
		},
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	local radar = world.unitNamed("radar")
	player:framePost()

	-- Splinter Faction's regeneration gadget, which runs before the player.
	radar.health = 180
	radar.maxHealth = 200
	player:frame()
	t.same("health a gadget raised before the player's frame is put right", radar.health, 50)
	t.same("and said once", said(world, "with no damage to hear of"), 1)
	player:framePost()

	radar.health = 190
	player:frame()
	player:framePost()
	t.same("and the next time is not said again", said(world, "with no damage to hear of"), 1)

	-- Something that got past the held maximum, down.
	player:frame()
	radar.health = 10
	player:framePost()
	t.same("health that fell during the frame is put right by its end", radar.health, 50)
	t.same("with the maximum back", radar.maxHealth, 200)

	-- A unit the base game destroyed between the frame and the post frame.
	player:frame()
	world.Spring.DestroyUnit(radar.id, false, true)
	player:framePost()
	player:frame()
	player:framePost()
	t.same("a unit lost in the middle of a frame is made again", world.unitCount(), 1)
	t.same("with the track's health", world.unitNamed("radar").health, 50)
	t.same("and its own maximum", world.unitNamed("radar").maxHealth, 200)
end

-- A definition the installed game does not have.

do
	local world, player = setup({
		last = 300,
		unitDefs = { "tank", "ghost" },
		featureDefs = { "rock", "phantom" },
		units = { { first = 0, last = 300 }, { first = 0, last = 300, def = 1 }, { first = 0, last = 300, def = 1 } },
		features = { { def = 0 }, { def = 1 }, { def = 1 } },
	})
	for _ = 1, 10 do
		player:frame()
	end
	seek(player, 200)
	t.same("a unit whose definition is missing is skipped", world.unitCount(), 1)
	t.same("the missing unit definition is reported once", said(world, "ghost"), 1)
	t.same("a feature whose definition is missing is skipped", #world.Spring.GetAllFeatures(), 1)
	t.same("the missing feature definition is reported once", said(world, "phantom"), 1)
end

-- A team that cannot hold a unit.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = { { first = 0, last = 300 }, { first = 0, last = 300, team = 1 }, { first = 0, last = 300, team = 1, def = 2 } },
	}, {
		before = function(world)
			world.teams[1].dead = true
		end,
	})
	local attempts = 0
	local create = world.Spring.CreateUnit
	world.Spring.CreateUnit = function(...)
		attempts = attempts + 1
		return create(...)
	end
	for _ = 1, 10 do
		player:frame()
	end
	t.same("the units of the other teams are there", world.unitCount(), 1)
	t.same("a nil from CreateUnit is reported once", said(world, "CreateUnit"), 1)
	t.check("the report names the team", said(world, "team 1") == 1, table.concat(world.lines, "\n"))
	t.same("and it is not tried again on every frame", attempts, 3)
	world.teams[1].dead = false
	seek(player, 50)
	t.same("a seek tries again", world.unitCount(), 3)
end

-- Gaia is wherever the engine put it.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		featureDefs = { "rock", "wreck" },
		teams = { 0, 1, 2 },
		units = { { first = 0, last = 300, team = 2 }, { first = 0, last = 300, team = 1, def = 2 } },
		features = { { def = 0, team = 2 }, { def = 0 } },
	}, { teams = { { id = 0, allyTeam = 0 }, { id = 1, allyTeam = 1 }, { id = 3, allyTeam = 3 } } })
	player:frame()
	t.same("a unit of a team the game does not have is Gaia's", world.unitNamed("tank").team, 3)
	t.same("a unit of a team the game has stays on it", world.unitNamed("radar").team, 1)
	local teams = {}
	for _, id in ipairs(world.Spring.GetAllFeatures()) do
		teams[#teams + 1] = world.features[id].team
	end
	table.sort(teams)
	t.same("features go to Gaia and to no team", table.concat(teams, " "), "-1 3")
end

-- Features.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		featureDefs = { "rock", "wreck" },
		features = {
			{ def = 0, at = { 100, 7, 200 } },
			{ def = 1, first = 100, last = 200, team = 1 },
		},
	}, {
		before = function(world)
			-- What the map put there before the first frame.
			world.Spring.CreateFeature("rock", 1, 0, 1)
			world.Spring.CreateFeature("rock", 2, 0, 2)
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	local ids = world.Spring.GetAllFeatures()
	t.same("the map's own features are removed, and the track's are there", #ids, 1)
	local rock = world.features[ids[1]]
	t.same("a feature is where the track has it, x", rock.x, 100)
	t.same("y", rock.y, 7)
	t.same("z", rock.z, 200)
	seek(player, 150)
	t.same("a feature appears on its first frame", #world.Spring.GetAllFeatures(), 2)
	seek(player, 201)
	t.same("and goes after its last", #world.Spring.GetAllFeatures(), 1)
	seek(player, 200)
	t.same("going back brings it back", #world.Spring.GetAllFeatures(), 2)

	-- A base game gadget makes a feature of its own.
	world.Spring.CreateFeature("rock", 9, 0, 9)
	t.same("a feature the game makes is there for a frame", #world.Spring.GetAllFeatures(), 3)
	player:frame()
	t.same("and is removed on the next", #world.Spring.GetAllFeatures(), 2)
	t.same("the engine is refused a wreck", world.gadget.AllowFeatureCreation(), false)
end

-- Units the player did not make, and units it lost.

do
	local world, player = setup({
		last = 300,
		unitDefs = NAMES,
		units = { { first = 0, last = 300 } },
	}, {
		before = function(world)
			world.Spring.CreateUnit("radar", 0, 0, 0, 0, 0, false, false)
		end,
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("a unit that was there before the player started is removed", world.unitCount(), 1)
	world.Spring.CreateUnit("plant", 0, 0, 0, 0, 1, false, false)
	player:frame()
	t.same("a unit the game creates is removed on the next frame", world.unitCount(), 1)
	t.same("and the track's unit is the one left", world.unitNamed("tank") ~= nil, true)

	local id = world.unitNamed("tank").id
	world.Spring.DestroyUnit(id, false, true)
	t.same("the game destroys a unit the track has alive", world.unitCount(), 0)
	player:frame()
	t.same("it is made again on the next frame", world.unitCount(), 1)
	world.Spring.DestroyUnit(world.unitNamed("tank").id, false, true)
	player:frame()
	t.same("and that is reported once", said(world, "destroyed a unit"), 1)
end

-- Terrain.

do
	local world, player, track = setup({
		last = 2000,
		windowLength = 900,
		terrain = {
			{ 0, 3, 4, 10, 12 },
			{ 50, 3, 4, 12, 20 },
			{ 50, 5, 5, 30, 31 },
			{ 900, 3, 4, 20, 25 },
			{ 1500, 6, 6, 40, 44 },
		},
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the rows on the first frame are applied on the first frame", world.height(3, 4), 12)
	t.same("a corner whose change is later keeps the map's own height", world.height(5, 5), 30)
	seek(player, 49)
	t.same("nothing changes before a row's frame", world.height(3, 4), 12)
	seek(player, 50)
	t.same("a row is applied on its frame", world.height(3, 4), 20)
	t.same("with every other row of that frame", world.height(5, 5), 31)
	seek(player, 1600)
	t.same("a seek across windows applies the rows in between", world.height(3, 4), 25)
	t.same("and the ones in the last window", world.height(6, 6), 44)
	seek(player, 1499)
	t.same("going back undoes a row", world.height(6, 6), 40)
	t.same("and leaves the ones before it", world.height(3, 4), 25)
	seek(player, 0)
	t.same("back at the first frame its rows still hold", world.height(3, 4), 12)
	t.same("and every later change is undone", world.height(5, 5), 30)

	-- Playing where nothing changes costs no call into the engine.
	seek(player, 100)
	local loads = track.terrainLoads
	player:message("coilbox_rewind:play")
	for _ = 1, 50 do
		player:frame()
	end
	t.same("the terrain chunk is not read again while playing inside a window", track.terrainLoads, loads)
	t.same("and the ground stays as it was", world.height(3, 4), 20)
end

-- A window that cannot be read.

do
	local world, player = setup({
		last = 2000,
		windowLength = 900,
		unitDefs = NAMES,
		units = { { first = 0, last = 2000 } },
		broken = { [1] = true },
	})
	player:message("coilbox_rewind:pause")
	player:frame()
	t.same("the first window plays", world.unitCount(), 1)
	seek(player, 1000)
	player:frame()
	player:frame()
	t.same("a window that cannot be read is reported once", said(world, "window 1"), 1)
	t.same("and the world is left as it was", world.unitCount(), 1)
	seek(player, 1900)
	t.same("the window after it plays", world.unitCount(), 1)
end

-- What everybody can see and read.

do
	local world, player, _, Player = setup({ first = 30, last = 300, unitDefs = NAMES })
	for _, ally in ipairs(world.Spring.GetAllyTeamList()) do
		t.same("ally team " .. ally .. " sees the whole map", world.los[ally], true)
	end
	local P = Player.PARAMS
	t.same("the first frame is published before a frame is played", world.params[P.firstFrame], 30)
	t.same("the last frame", world.params[P.lastFrame], 300)
	t.same("the frames in a second", world.params[P.framesPerSecond], 30)
	t.same("the time", world.params[P.frame], 30)
	t.same("playing", world.params[P.playing], 1)
	t.same("the direction", world.params[P.direction], 1)
	t.same("the speed", world.params[P.speed], 1)
	player:frame()
	player:frame()
	t.same("the time moves with play", world.params[P.frame], 31)
	player:message("coilbox_rewind:speed 8")
	player:message("coilbox_rewind:reverse")
	t.same("a message is published as it arrives, speed", world.params[P.speed], 8)
	t.same("direction", world.params[P.direction], -1)
	player:message("coilbox_rewind:pause")
	t.same("and pause", world.params[P.playing], 0)
	player:message("coilbox_rewind:seek 200")
	t.same("a seek is published as it arrives", world.params[P.frame], 200)
	for name, param in pairs(P) do
		t.check("the parameter for " .. name .. " is the player's own", param:find("^coilbox_rewind_") ~= nil, param)
	end

	t.same("a message that is the player's is taken", player:message("coilbox_rewind:play"), true)
	t.same("a message that is refused is still the player's", player:message("coilbox_rewind:speed 3"), true)
	t.same("the refusal is logged", said(world, "speed 3"), 1)
	t.same("a message for something else is left alone", player:message("other:play"), false)
end

-- Where it starts.

do
	local _, player, _, Player = setup({ first = 30, last = 300, unitDefs = NAMES }, {
		modOptions = { coilbox_rewind_start_frame = "120", coilbox_rewind_start_paused = "1" },
	})
	t.same("the start frame option is where it starts", player.clock.frame, 120)
	t.same("the paused option starts it paused", player.clock.playing, false)
	t.same("the option names are the page's", Player.OPTIONS.startFrame .. " " .. Player.OPTIONS.startPaused, "coilbox_rewind_start_frame coilbox_rewind_start_paused")

	_, player = setup({ first = 30, last = 300, unitDefs = NAMES }, {
		modOptions = { coilbox_rewind_start_frame = "9000", coilbox_rewind_start_paused = "0" },
	})
	t.same("a start frame past the end is the last frame", player.clock.frame, 300)
	t.same("a paused option of 0 plays", player.clock.playing, true)

	_, player = setup({ first = 30, last = 300, unitDefs = NAMES }, { modOptions = { coilbox_rewind_start_frame = "soon" } })
	t.same("a start frame that is not a number is the first frame", player.clock.frame, 30)
end

-- The base game kills a team.

do
	local world, player = setup({ last = 300, unitDefs = NAMES })
	player:frame()
	world.Spring.KillTeam(1)
	world.Spring.KillTeam(1)
	t.same("a team that died is reported once", said(world, "team 1 died"), 1)
end

-- The fixture, through the real reader.

do
	local bytes = t.read(t.FIXTURES .. "small.cbtrack")
	local reader = t.syncedEnv()
	local Track = t.load("coilbox_track.lua", reader)
	local Fetch = t.load("coilbox_track_fetch.lua", reader)
	local track = assert(Track.open(Fetch.fromString(bytes)))
	local own = assert(Track.open(Fetch.fromString(bytes)))

	local world, player = setup(track, {
		unitDefs = { { name = "armcom" }, { name = "armpw" }, { name = "armsolar" } },
		featureDefs = { { name = "rock" } },
	})

	--- What a reader of its own says is alive at a frame.
	local function alive(frame)
		local w = assert(own:seek(frame))
		local n = 0
		for i = 1, w.unitCount do
			if w:unitExistsAt(i, frame) then
				n = n + 1
			end
		end
		return n
	end

	player:message("coilbox_rewind:pause")
	player:frame()
	for _, frame in ipairs({ 100, 669, 670, 700, 756, 757, 793, 794, 1300, 1818, 1819, 2101, 1500, 400 }) do
		seek(player, frame)
		t.same("the fixture at frame " .. frame .. " has the reader's " .. alive(frame) .. " units", world.unitCount(), alive(frame))
	end
	t.same("and its 5 features", #world.Spring.GetAllFeatures(), 5)

	-- A unit is where the reader samples it.
	seek(player, 1400)
	local w = assert(own:seek(1400))
	local out = { 0, 0, 0, 0, 0, 0, 0 }
	w:sampleTransform(1, 1400, out)
	local found = false
	for _, id in ipairs(world.Spring.GetAllUnits()) do
		local unit = world.units[id]
		if unit.x == out[1] and unit.y == out[2] and unit.z == out[3] then
			found = true
		end
	end
	t.check("a unit of the fixture is where the reader samples it", found)

	-- Playing allocates nothing. Frames 1,400 to 1,700 are inside one window and
	-- no unit of the fixture comes or goes in them. The stand-in keeps a height
	-- for each corner it is given, so every corner is given one first.
	seek(player, 2101)
	seek(player, 1400)
	player:message("coilbox_rewind:play")
	player:frame()
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	for _ = 1, 300 do
		player:frame()
		player:framePost()
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play allocate nothing", after - before, 0)
	t.check("and they were played", player.clock.frame > 1690, player.clock.frame)

	player:message("coilbox_rewind:direction -1")
	player:frame()
	collectgarbage()
	collectgarbage("stop")
	before = collectgarbage("count")
	for _ = 1, 250 do
		player:frame()
		player:framePost()
	end
	after = collectgarbage("count")
	collectgarbage("restart")
	t.same("250 frames of play backward allocate nothing", after - before, 0)
end

t.report()
