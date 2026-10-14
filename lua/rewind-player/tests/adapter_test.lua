-- The game adapter (issue #3799): how the player reads it, what it hides, the
-- hooks it calls and the line it logs. The part coilbox does, shadowing the
-- gadgets and widgets an adapter names, is Rust and is tested there.
--
-- None of this shows an adapter working in an engine.
-- scripts/rewind-playback-headless.sh does that.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

local Adapter = t.load("coilbox_player_adapter.lua", {
	table = table,
	string = string,
	ipairs = ipairs,
	pairs = pairs,
	pcall = pcall,
	tostring = tostring,
	type = type,
})

-- Reading the file.

do
	t.same("a game with no adapter has none and no reason", select("#", Adapter.normalize(nil)), 1)
	t.same("false is no adapter", Adapter.normalize(false), nil)
	local adapter, why = Adapter.normalize("text")
	t.same("a file that returns a string is not an adapter", adapter, nil)
	t.check("and says so", why:find("returned a string", 1, true) ~= nil, why)

	adapter, why = Adapter.normalize({ problem = "the file could not be read" })
	t.same("a problem the coilbox side found is no adapter", adapter, nil)
	t.same("and is the reason", why, "the file could not be read")

	for key, value in pairs({ gadgets = "game_end.lua", widgets = 4, units = true, features = {}, teamParams = "supplyUsed", gameParams = 7 }) do
		adapter, why = Adapter.normalize({ [key] = value })
		if key == "features" then
			t.check("an empty " .. key .. " list is fine", adapter ~= nil, why)
		else
			t.same(key .. " that is not a list is refused", adapter, nil)
			t.check("with the key named", why:find(key, 1, true) ~= nil, why)
		end
	end
	adapter, why = Adapter.normalize({ gadgets = { "a.lua", 3 } })
	t.same("a list with something that is not a name is refused", adapter, nil)
	t.check("and says where", why:find("place 2", 1, true) ~= nil, why)
	adapter, why = Adapter.normalize({ hooks = "afterFrame" })
	t.same("hooks that is not a table is refused", adapter, nil)

	local hook = function() end
	adapter = Adapter.normalize({
		name = "Test game",
		gadgets = { "game_end.lua", "a.lua" },
		widgets = { "bars.lua" },
		units = { "ArmCom", "armpw" },
		features = { "Rock" },
		hooks = { afterFrame = hook, unitPlaced = hook, onTuesday = hook, frame = "text" },
	})
	t.same("it has a name", adapter.name, "Test game")
	t.same("it counts gadgets", adapter.gadgetCount, 2)
	t.same("it counts widgets", adapter.widgetCount, 1)
	t.same("it counts unit definitions", adapter.hiddenUnitCount, 2)
	t.same("it counts feature definitions", adapter.skippedFeatureCount, 1)
	t.same("a hidden unit is matched in lower case", adapter.hiddenUnits.armcom, true)
	t.same("a skipped feature is matched in lower case", adapter.skippedFeatures.rock, true)
	t.same("the hooks it has are listed in order", table.concat(adapter.hookNames, ","), "afterFrame,unitPlaced")
	t.same("a hook the player does not call is listed apart", table.concat(adapter.unknownHooks, ","), "frame,onTuesday")
	t.same("an adapter with no name is unnamed", Adapter.normalize({}).name, "unnamed")

	-- The ghosts widget's hook (issue #3804) is in the adapter's format, and the
	-- player never calls it, so it is not a misspelling.
	adapter = Adapter.normalize({ hooks = { drawQueuedBuilding = hook } })
	t.same("the ghosts widget's drawing hook is a hook of the format", table.concat(adapter.hookNames, ","), "drawQueuedBuilding")
	adapter = Adapter.normalize({ hooks = { queuedBuildingsDrawn = hook } })
	t.same("so is the hook that hears a pass of drawing is over", table.concat(adapter.hookNames, ","), "queuedBuildingsDrawn")
	t.same("and neither is taken for a misspelling", #adapter.unknownHooks, 0)
	t.same("and not one the player does not know", #adapter.unknownHooks, 0)
end

-- Reading it from the game.

do
	local function vfs(files)
		return {
			FileExists = function(path)
				return files[path] ~= nil
			end,
			Include = function(path)
				local value = files[path]
				if type(value) == "function" then
					return value()
				end
				return value
			end,
		}
	end
	local adapter, why = Adapter.load(vfs({}))
	t.same("a game that holds no adapter file has none", adapter, nil)
	t.same("without a reason", why, nil)
	adapter = Adapter.load(vfs({ [Adapter.PATH] = { name = "Held" } }))
	t.same("a file the game holds is read from its path", adapter.name, "Held")
	t.same("the path is the one coilbox writes", Adapter.PATH, "coilbox_rewind/adapter.lua")
	adapter, why = Adapter.load(vfs({
		[Adapter.PATH] = function()
			error("boom")
		end,
	}))
	t.same("a file that raises is no adapter", adapter, nil)
	t.check("and the reason is the error", why:find("boom", 1, true) ~= nil, why)
end

-- The line it logs.

t.same("no adapter", Adapter.describe(nil), "adapter loaded: none")
t.same(
	"no adapter and why",
	Adapter.describe(nil, "the adapter file raised: boom"),
	"adapter loaded: none. the adapter file raised: boom"
)
t.same(
	"an adapter",
	Adapter.describe(Adapter.normalize({ name = "Test game", gadgets = { "a.lua" }, units = { "x", "y" }, hooks = { afterFrame = function() end } })),
	"adapter loaded: Test game. 1 gadgets and 0 widgets are switched off by the playback game, 2 unit definitions are hidden, 0 feature definitions are skipped, hooks: afterFrame"
)

-- The adapters coilbox ships, read the way the player reads one in the engine.

do
	local adapter, why = Adapter.normalize(dofile(t.root() .. "/adapters/splinter_faction.lua"))
	t.check("the player reads Splinter Faction's adapter", adapter ~= nil, why)
	t.same(
		"and logs what it has",
		Adapter.describe(adapter),
		"adapter loaded: Splinter Faction. 6 gadgets and 5 widgets are switched off by the playback game, 0 unit definitions are hidden, 0 feature definitions are skipped, hooks: none"
	)
	t.same("it has no hook the player does not call", #adapter.unknownHooks, 0)
	t.same(
		"it names the game's own numbers on the resource bar, in the game's own spelling",
		table.concat(adapter.teamParams, ","),
		"supplyUsed,supplyMax,researchPoints"
	)
	t.same("and none of the game's as a whole", #adapter.gameParams, 0)
end

-- Beyond All Reason's adapter (issue #3801), whose hooks do work of their own.
-- They are run here against a stand-in for what they call in the engine and in
-- the game: the commanders that are not drawn before they warp in, the game's
-- warp in effect, and the queued buildings handed to the game's shape widget.

do
	--- The adapter file run in an environment of its own, with what it called.
	local function beyondAllReason(options)
		options = options or {}
		local log = { noDraw = {}, cegs = {}, sounds = {}, lightning = {}, drawn = {}, stopped = {}, teamParams = {}, gameParams = {} }
		local units = options.units or {}
		local env = {
			pairs = pairs,
			ipairs = ipairs,
			next = next,
			select = select,
			error = error,
			table = table,
			math = math,
			UnitDefs = { [1] = { name = "armcom", customParams = { iscommander = "1" } }, [2] = { name = "armpw", customParams = {} }, [3] = { name = "corcom", customParams = { iscommander = "1" } } },
			UnitDefNames = { armcom = { id = 1 }, corcom = { id = 3 } },
			Game = { gameSpeed = 30, spawnInitialFrame = 60, spawnWarpInFrame = 90 },
			GG = {
				SpawnEnvironmentalLightning = function(name, x, y, z)
					log.lightning[#log.lightning + 1] = name .. " " .. x .. " " .. y .. " " .. z
				end,
			},
			WG = {},
			Spring = {
				GetGaiaTeamID = function()
					return 2
				end,
				GetTeamList = function()
					return { 0, 1, 2 }
				end,
				GetTeamInfo = function(team)
					return team, 0, false, false, ({ [0] = "Armada", [1] = "Cortex", [2] = "" })[team], team
				end,
				GetSideData = function(side)
					local sides = { { sideName = "armada", startUnit = "armcom" }, { sideName = "cortex", startUnit = "corcom" }, { sideName = "random", startUnit = "dummycom" } }
					if side == nil then
						return sides
					end
					for _, one in ipairs(sides) do
						if one.sideName == side:lower() then
							return one.startUnit, one.sideName
						end
					end
				end,
				SetTeamRulesParam = function(team, name, value)
					log.teamParams[#log.teamParams + 1] = team .. " " .. name .. " " .. tostring(value)
				end,
				SetGameRulesParam = function(name, value)
					log.gameParams[#log.gameParams + 1] = name .. " " .. tostring(value)
				end,
				SetUnitNoDraw = function(unitID, hide)
					log.noDraw[#log.noDraw + 1] = unitID .. " " .. tostring(hide)
				end,
				ValidUnitID = function(unitID)
					return units[unitID] ~= nil
				end,
				GetUnitDefID = function(unitID)
					return units[unitID]
				end,
				GetUnitPosition = function(unitID)
					if units[unitID] then
						return unitID * 10, 5, unitID * 20
					end
				end,
				SpawnCEG = function(name, x, y, z)
					log.cegs[#log.cegs + 1] = name .. " " .. x .. " " .. y .. " " .. z
				end,
				PlaySoundFile = function(name, volume, channel)
					log.sounds[#log.sounds + 1] = name .. " " .. volume .. " " .. channel
				end,
			},
		}
		if options.helper ~= false then
			local nextId = 0
			env.WG.DrawUnitShapeGL4 = function(def, x, y, z, turn, alpha, team, _, _, _, owner)
				if options.refuse and options.refuse[def] then
					return nil
				end
				nextId = nextId + 1
				log.drawn[#log.drawn + 1] = string.format("%d:%d@%s,%s,%s turn=%.4f team=%d owner=%s", nextId, def, x, y, z, turn, team, tostring(owner))
				return nextId
			end
			env.WG.StopDrawUnitShapeGL4 = function(id)
				log.stopped[#log.stopped + 1] = id
			end
		end
		local chunk = assert(loadfile(t.root() .. "/adapters/beyond_all_reason.lua"))
		setfenv(chunk, env)
		return chunk(), log, units
	end

	local raw = beyondAllReason()
	local adapter, why = Adapter.normalize(raw)
	t.check("the player reads Beyond All Reason's adapter", adapter ~= nil, why)
	t.same(
		"and logs what it has",
		Adapter.describe(adapter),
		"adapter loaded: Beyond All Reason. 32 gadgets and 3 widgets are switched off by the playback game, 0 unit definitions are hidden, 0 feature definitions are skipped, hooks: afterFrame, drawQueuedBuilding, queuedBuildingsDrawn, started, unitPlaced"
	)
	t.same("it has no hook the player does not call", #adapter.unknownHooks, 0)
	t.same("it names each team's commander and its energy converters", table.concat(adapter.teamParams, ","), "startUnit,mmLevel,mmCapacity,mmUse,mmAvgEffi")
	t.same("and none of the game's as a whole", #adapter.gameParams, 0)
	local twice = {}
	for _, name in ipairs(raw.gadgets) do
		t.check("the gadget " .. name .. " is named once", not twice[name])
		twice[name] = true
	end

	-- What the switched off start gadget left for the game's widgets.
	local hooks, log = raw.hooks, nil
	raw, log = beyondAllReason()
	raw.hooks.started()
	t.same("each team that is not Gaia gets its side's commander before the first frame", table.concat(log.teamParams, "|"), "0 startUnit 1|1 startUnit 3")
	t.same("and the game the commanders a team may start with, less a side with none", table.concat(log.gameParams, "|"), "validStartUnits 1|3")

	-- A start commander is not drawn until it has warped in.
	local play = { jumped = false, direction = 1, speed = 1 }
	local jump = { jumped = true, direction = 1, speed = 1 }
	local units
	raw, log, units = beyondAllReason({ units = { [7] = 1, [8] = 2, [9] = 3 } })
	hooks = raw.hooks
	t.same("placing a unit gives nothing back, so the player's arrival effect stays", hooks.unitPlaced(7, 1, 0, jump, true), nil)
	hooks.unitPlaced(8, 2, 0, jump, false)
	hooks.unitPlaced(9, 3, 1, play, false)
	t.same("a commander placed before it warps in is hidden, and another unit is left alone", table.concat(log.noDraw, "|"), "7 true|9 true")
	hooks.afterFrame(1, play)
	local asked = #log.noDraw
	for frame = 2, 89 do
		hooks.afterFrame(frame, play)
	end
	t.same("it stays hidden with nothing more asked of the engine", #log.noDraw, asked)
	hooks.afterFrame(90, play)
	local shown = { log.noDraw[asked + 1], log.noDraw[asked + 2] }
	table.sort(shown)
	t.same("and both are drawn from the frame they warp in on", table.concat(shown, "|"), "7 false|9 false")
	for frame = 91, 200 do
		hooks.afterFrame(frame, play)
	end
	t.same("and that is all while they stay", #log.noDraw, asked + 2)
	units[9] = 2
	hooks.afterFrame(30, jump)
	t.same("a seek back to before hides the one that is still a commander", log.noDraw[asked + 3], "7 true")
	t.same("and not a unit that has its id now", #log.noDraw, asked + 3)
	hooks.afterFrame(4000, jump)
	t.same("a seek forward shows it again", log.noDraw[asked + 4], "7 false")
	local placed = #log.noDraw
	hooks.unitPlaced(7, 1, 4000, jump, true)
	t.same("a commander placed later in the match is drawn as it is", #log.noDraw, placed)

	-- The game's warp in effect, where play passes its frame.
	t.same("frames 1 to 200 at the match's speed showed the effect once for each commander", table.concat(log.cegs, "|"), "commander-spawn 70 5 140|commander-spawn 90 5 180")
	t.same("with the game's lightning", #log.lightning, 2)
	t.same("and its sound once", table.concat(log.sounds, "|"), "commanderspawn 0.6 ui")
	raw, log = beyondAllReason({ units = { [7] = 1 } })
	hooks = raw.hooks
	hooks.unitPlaced(7, 1, 0, jump, false)
	hooks.afterFrame(0, jump)
	hooks.afterFrame(75, jump)
	t.same("a seek past the frame shows none", #log.cegs, 0)
	hooks.afterFrame(40, jump)
	hooks.afterFrame(72, { jumped = false, direction = 1, speed = 32 })
	t.same("nor does play at 32x", #log.cegs, 0)
	hooks.afterFrame(40, { jumped = false, direction = -1, speed = 1 })
	t.same("nor play backward", #log.cegs, 0)
	hooks.afterFrame(59.5, { jumped = false, direction = 1, speed = 0.5 })
	hooks.afterFrame(60, { jumped = false, direction = 1, speed = 0.5 })
	t.same("play at half speed does, on the frame itself", #log.cegs, 1)
	hooks.afterFrame(99, play)
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	for frame = 100, 400 do
		hooks.afterFrame(frame, play)
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of play allocate nothing in the hook", after - before, 0)

	-- Queued buildings, through the game's shape widget, which keeps a shape
	-- until it is told to drop it.
	raw, log = beyondAllReason()
	hooks = raw.hooks
	local function passOf(list)
		for _, b in ipairs(list) do
			hooks.drawQueuedBuilding(b[1], b[2], b[3], b[4], b[5], b[6])
		end
		hooks.queuedBuildingsDrawn(#list)
	end
	passOf({ { 2, 0, 480, 100, 8128, 0 }, { 2, 1, 600, 90, 700, 1 } })
	t.same(
		"each queued building is handed to the game's widget once, with its team and its turn",
		table.concat(log.drawn, "|"),
		"1:2@480,100,8128 turn=0.0000 team=0 owner=coilbox rewind ghosts|2:2@600,90,700 turn=1.5708 team=1 owner=coilbox rewind ghosts"
	)
	for _ = 1, 50 do
		passOf({ { 2, 0, 480, 100, 8128, 0 }, { 2, 1, 600, 90, 700, 1 } })
	end
	t.same("and not again while it stays queued", #log.drawn, 2)
	t.same("with none dropped", #log.stopped, 0)
	passOf({ { 2, 1, 600, 90, 700, 1 } })
	t.same("a building that is no longer queued is dropped", table.concat(log.stopped, ","), "1")
	passOf({ { 2, 1, 600, 90, 700, 3 } })
	t.same("one queued again with another facing is dropped and handed over again", table.concat(log.stopped, ","), "1,2")
	t.check("with the new turn", log.drawn[3]:find("turn=4.7124", 1, true) ~= nil, log.drawn[3])
	passOf({})
	t.same("a pass with nothing queued drops the rest", table.concat(log.stopped, ","), "1,2,3")
	passOf({})
	t.same("and a second one has nothing to drop", #log.stopped, 3)
	passOf({ { 2, 0, 480, 100, 8128, 0 } })
	t.same("a building queued again is handed over again", #log.drawn, 4)

	raw, log = beyondAllReason({ refuse = { [2] = true } })
	hooks = raw.hooks
	hooks.drawQueuedBuilding(2, 0, 480, 100, 8128, 0)
	hooks.queuedBuildingsDrawn(1)
	hooks.drawQueuedBuilding(2, 0, 480, 100, 8128, 0)
	hooks.queuedBuildingsDrawn(1)
	t.same("a definition the game's widget cannot draw raises nothing and drops nothing", #log.stopped, 0)

	raw = beyondAllReason({ helper = false })
	local ok, err = pcall(raw.hooks.drawQueuedBuilding, 2, 0, 480, 100, 8128, 0)
	t.check("without the game's widget the hook raises, so the ghosts widget draws its own", not ok and tostring(err):find("DrawUnitShape GL4", 1, true) ~= nil, tostring(err))
end

-- The player with an adapter.

local UNIT_DEFS = {
	{ name = "tank", health = 1000 },
	{ name = "plant", health = 4000, buildTime = 500 },
	{ name = "radar", health = 200 },
}
local FEATURE_DEFS = { { name = "rock" }, { name = "wreck" } }
local TRACK = {
	last = 300,
	unitDefs = { "tank", "plant", "radar" },
	featureDefs = { "rock", "wreck" },
	units = {
		{ first = 0, last = 300, at = { 10, 5, 20 } },
		{ first = 100, last = 200, def = 1, at = { 30, 5, 20 } },
		{ first = 0, last = 300, def = 2, at = { 50, 5, 20 } },
	},
	features = {
		{ def = 0, first = 0, last = 300, at = { 1, 0, 1 } },
		{ def = 1, first = 0, last = 300, at = { 2, 0, 2 } },
	},
}

--- A world and a player of the track above with the adapter given.
local function setup(raw)
	local world = Engine.new({ unitDefs = UNIT_DEFS, featureDefs = FEATURE_DEFS })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local adapter, why = Adapter.normalize(raw)
	local player = assert(Player.new(Fake.new(TRACK), {
		modOptions = {},
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
		adapter = adapter,
		adapterWhy = why,
	}))
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
	}
	return world, player
end

--- One frame of an engine that calls back when the frame is over.
local function step(player)
	player.frame(player)
	player:framePost()
end

local function seek(player, frame)
	player:message("coilbox_rewind:seek " .. frame)
	step(player)
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

do
	local world, player = setup(nil)
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	t.same("with no adapter nothing is hidden", world.unitCount(), 3)
	t.same("nor any feature skipped", #world.Spring.GetAllFeatures(), 2)
	t.same("the player says it loaded none", world.lines[1], "adapter loaded: none")
	t.same("and that is the only line", #world.lines, 1)
end

do
	local world, player = setup({ name = "Hiding game", units = { "PLANT" }, features = { "Wreck" } })
	t.same("the player says which adapter it loaded", world.lines[1]:find("adapter loaded: Hiding game. 0 gadgets and 0 widgets", 1, true), 1)
	player:message("coilbox_rewind:pause")
	seek(player, 150)
	t.same("a hidden unit definition is not created, whatever its case", world.unitCount(), 2)
	t.same("the others are", world.unitNamed("tank") ~= nil and world.unitNamed("radar") ~= nil, true)
	t.same("a skipped feature definition is not created", #world.Spring.GetAllFeatures(), 1)
	t.same("hiding and skipping are not reported as missing names", #world.lines, 1)
	seek(player, 10)
	seek(player, 150)
	t.same("a seek away and back leaves it hidden", world.unitCount(), 2)
	t.same("and says nothing", #world.lines, 1)
end

do
	local world = setup({ name = "Hiding something else", units = { "nothing" } })
	t.same("a hidden definition the track does not have is harmless", #world.lines, 1)
end

do
	-- A definition the game really lacks is still reported.
	local world = Engine.new({ unitDefs = { { name = "tank" } }, featureDefs = FEATURE_DEFS })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	assert(Player.new(Fake.new(TRACK), {
		modOptions = {},
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
		adapter = Adapter.normalize({ units = { "plant" } }),
	}))
	t.same("a unit the game lacks and the adapter does not hide is reported", said(world, "the game has no unit called radar"), 1)
	t.same("one the adapter hides is not", said(world, "the game has no unit called plant"), 0)
end

-- Hooks.

do
	local placed, after = {}, {}
	local started = 0
	local world, player = setup({
		name = "Hooked",
		hooks = {
			started = function()
				started = started + 1
			end,
			unitPlaced = function(unitID, defID, frame, clock)
				placed[#placed + 1] = { unitID = unitID, defID = defID, frame = frame, jumped = clock.jumped }
			end,
			afterFrame = function(frame, clock)
				after[#after + 1] = { frame = frame, direction = clock.direction }
			end,
		},
	})
	t.check("the line names the hooks", world.lines[1]:find("hooks: afterFrame, started, unitPlaced", 1, true) ~= nil, world.lines[1])
	t.same("started is called when the player is made, before any frame", started, 1)
	t.same("when nothing of the track is in the world yet", world.unitCount(), 0)
	player:message("coilbox_rewind:pause")
	step(player)
	t.same("a frame does not call it again", started, 1)
	t.same("a unit made on the first frame is announced, one for each", #placed, 2)
	t.same("with its engine id", placed[1].unitID, world.unitNamed("tank").id)
	t.same("and its definition's engine id", placed[1].defID, world.units[placed[1].unitID].def.id)
	t.same("and the frame", placed[1].frame, 0)
	t.same("every frame ends in afterFrame", #after, 1)
	t.same("with the frame", after[1].frame, 0)

	step(player)
	t.same("a frame that creates nothing announces nothing", #placed, 2)
	t.same("and still calls afterFrame", #after, 2)

	seek(player, 150)
	t.same("a unit that comes in at a seek is announced", #placed, 3)
	t.same("and the call says the frame was reached by a jump", placed[3].jumped, true)
	seek(player, 50)
	seek(player, 150)
	t.same("one made again after a seek away is announced again", #placed, 4)
end

do
	local calls = 0
	local world, player = setup({
		hooks = {
			afterFrame = function()
				calls = calls + 1
				error("hook failure")
			end,
		},
	})
	player:message("coilbox_rewind:pause")
	step(player)
	step(player)
	step(player)
	t.same("a hook that raises is called once", calls, 1)
	t.same("and the player goes on", world.unitCount(), 2)
	t.same("it is reported once", said(world, "afterFrame hook raised"), 1)
	t.check("with the error", said(world, "hook failure") == 1)
end

do
	local world = setup({ hooks = { afterFram = function() end, unitPlaced = 3 } })
	t.same("a hook with a misspelt name is logged", said(world, "a hook called afterFram"), 1)
	t.same("so is a hook that is not a function", said(world, "a hook called unitPlaced"), 1)
end

-- Playing allocates nothing with hooks that do nothing.

do
	local world, player = setup({
		hooks = {
			unitPlaced = function() end,
			afterFrame = function() end,
		},
	})
	player:message("coilbox_rewind:seek 10")
	player:message("coilbox_rewind:play")
	step(player)
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	for _ = 1, 60 do
		step(player)
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("60 frames of play with hooks allocate nothing", after - before, 0)
	t.check("and they were played", player.clock.frame > 60, player.clock.frame)
	t.same("the world is still the track's", world.unitCount(), 2)
end

t.report()
