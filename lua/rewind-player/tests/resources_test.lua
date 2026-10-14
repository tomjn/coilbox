-- The resources stage (issue #3982): each team's metal and energy, the rest of
-- its economy and the rules parameters a game's adapter names are the
-- recorded match's and not the playback's own.
--
-- The engine here is the stand-in in engine.lua, whose teams follow
-- rts/Sim/Misc/Team.cpp. It runs a frame in the engine's order, with the
-- playback's own economy between the gadget's two call-ins, so a test can tell
-- a number that is set from one that only looks right before the engine has
-- had its turn. None of this shows the stage working in an engine.
-- scripts/rewind-playback-headless.sh does that.

if jit then
	jit.off()
end

local here = arg[0]:match("^(.*)/[^/]+$") or "."
local t = dofile(here .. "/support.lua")
local Engine = dofile(here .. "/engine.lua")
local Fake = dofile(here .. "/fake_track.lua")

-- The codes of a team's numbers, as the format page has them.
local HELD, STORAGE, PULL, INCOME, EXPENSE, SHARE, EXCESS = 0, 1, 2, 3, 4, 5, 8
local ENERGY, PARAMETER, NO_TEAM = 16, 256, 255

--- A world, a player of `spec` in it, and the two functions that stand in for
-- the gadget's call-ins. `options.engine` is what the capability table says of
-- the engine and `options.adapter` what the game's adapter file returns.
local function setup(spec, options)
	options = options or {}
	local world = Engine.new({ teams = options.teams })
	local env = Engine.env(t, world)
	local Player = t.load("coilbox_player.lua", env)
	local Adapter = t.load("coilbox_player_adapter.lua", env)
	spec.last = spec.last or 3000
	local track = spec.header and spec or Fake.new(spec)
	local player = assert(Player.new(track, {
		modOptions = options.modOptions or {},
		engine = options.engine,
		adapter = options.adapter and assert(Adapter.normalize(options.adapter)),
		log = function(text)
			world.lines[#world.lines + 1] = text
		end,
	}))
	local function frame()
		player:frame()
	end
	local function post()
		player:framePost()
	end
	--- `count` frames of an engine that has GameFramePost.
	local function run(count)
		for _ = 1, count do
			world.step(frame, post)
		end
	end
	--- `count` frames of one that does not.
	local function runOld(count)
		for _ = 1, count do
			world.step(frame)
		end
	end
	return world, player, run, runOld, env
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

local function near(label, got, wanted)
	t.check(label, type(got) == "number" and math.abs(got - wanted) < 1e-6, tostring(got) .. " and not " .. tostring(wanted))
end

--- What `Spring.GetTeamResources` gives, by name.
local function read(world, team, name)
	local held, storage, pull, income, expense, share, sent, received, excess = world.Spring.GetTeamResources(team, name)
	return { held = held, storage = storage, pull = pull, income = income, expense = expense, share = share, sent = sent, received = received, excess = excess }
end

--- A track whose team 0 holds 100 metal more for every frame.
local function rising()
	return {
		values = {
			{ team = 0, code = HELD, at = function(frame)
				return 100 + frame
			end },
			{ team = 0, code = STORAGE, at = 5000 },
			{ team = 0, code = SHARE, at = 0.4 },
			{ team = 0, code = ENERGY + HELD, at = 750.5 },
			{ team = 0, code = ENERGY + STORAGE, at = function(frame)
				return frame < 1000 and 6000 or 9000
			end },
			{ team = 0, code = ENERGY + SHARE, at = 0.75 },
		},
	}
end

-- What a team holds, its storage and its share level.

do
	local world, player, run = setup(rising())
	local Spring = world.Spring
	-- What the playback's own units make, in the middle of every frame.
	world.economy = function()
		world.produce(0, "metal", 7)
		world.produce(1, "energy", 3)
	end
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 500")
	run(1)
	local metal, energy = read(world, 0, "metal"), read(world, 0, "energy")
	t.same("paused at a frame a team holds the track's metal", metal.held, 600)
	t.same("and has the track's storage", metal.storage, 5000)
	near("and the track's share level", metal.share, 0.4)
	t.same("and the same for energy", energy.held, 750.5)
	t.same("with its own storage", energy.storage, 6000)
	near("and its own share level", energy.share, 0.75)

	-- The track's teams are 0, 1 and 2, and it has no number for team 1, which
	-- the format page says is a team with nothing.
	local other = read(world, 1, "energy")
	t.same("a team of the track with no number holds nothing", other.held, 0)
	t.same("and stores nothing", other.storage, 0)

	local worst = 0
	for _ = 1, 400 do
		run(1)
		worst = math.max(worst, math.abs(Spring.GetTeamResources(0, "metal") - 600))
	end
	t.same("held while paused for 400 frames of the playback's own economy", worst, 0)

	player:message("coilbox_rewind:seek 2000")
	run(1)
	t.same("a seek forward gives the later frame's metal", Spring.GetTeamResources(0, "metal"), 2100)
	t.same("and its storage", select(2, Spring.GetTeamResources(0, "energy")), 9000)
	player:message("coilbox_rewind:seek 20")
	run(1)
	t.same("a seek backward gives the earlier frame's", Spring.GetTeamResources(0, "metal"), 120)
	t.same("and the storage it had then", select(2, Spring.GetTeamResources(0, "energy")), 6000)

	player:message("coilbox_rewind:play")
	run(10)
	t.same("playing forward the metal follows the time", Spring.GetTeamResources(0, "metal"), 100 + player.clock.frame)
	t.check("which moved", player.clock.frame == 30, player.clock.frame)
	player:message("coilbox_rewind:play -1")
	run(10)
	t.same("and backward it goes backward", Spring.GetTeamResources(0, "metal"), 100 + player.clock.frame)
	t.same("to an earlier frame", player.clock.frame, 20)
end

-- A team the track does not have is left alone.

do
	local spec = rising()
	spec.teams = { 0 }
	local world, _, run = setup(spec)
	world.teams[1].metal.held = 321
	run(3)
	t.same("a team the track does not have keeps what the engine gave it", world.Spring.GetTeamResources(1, "metal"), 321)
	t.same("and its storage", select(2, world.Spring.GetTeamResources(1, "metal")), 1000)
end

-- An engine with no GameFramePost (issue #4002). The player sets the numbers at
-- the start of a frame, the engine's own economy moves them in the rest of it,
-- and nobody puts them back before the frame is drawn.

do
	local world, player, _, runOld = setup(rising())
	world.economy = function()
		world.produce(0, "metal", 7)
	end
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 500")
	runOld(1)
	t.same("without a post frame call a team is one frame of the playback's economy off", world.Spring.GetTeamResources(0, "metal"), 607)
	runOld(200)
	t.same("and no more than one frame of it, however long it runs", world.Spring.GetTeamResources(0, "metal"), 607)
end

-- Income, expense and pull. No call sets them. The engine sums what a team
-- makes and uses over 30 frames and reports the sum of the stretch before, so
-- the player adds what the match had more than the playback's own.

local function economy()
	return {
		values = {
			{ team = 0, code = HELD, at = 400 },
			{ team = 0, code = STORAGE, at = 1000 },
			{ team = 0, code = SHARE, at = 0.99 },
			{ team = 0, code = INCOME, at = function(frame)
				return frame < 1000 and 12 or 31.5
			end },
			{ team = 0, code = EXPENSE, at = 5 },
			{ team = 0, code = PULL, at = 9 },
			{ team = 0, code = ENERGY + HELD, at = 50 },
			{ team = 0, code = ENERGY + STORAGE, at = 100 },
			{ team = 0, code = ENERGY + INCOME, at = 2000 },
			{ team = 0, code = ENERGY + EXPENSE, at = 1500 },
			{ team = 0, code = ENERGY + PULL, at = 1800 },
			{ team = 1, code = HELD, at = 10 },
			{ team = 1, code = STORAGE, at = 500 },
			{ team = 1, code = INCOME, at = 6 },
			{ team = 1, code = EXPENSE, at = 1 },
		},
	}
end

do
	local world, player, run = setup(economy())
	-- The playback's own: team 0 makes 3 metal and uses 1.5 in 30 frames, and
	-- asks for 0.75 more than it has once.
	world.economy = function(frame)
		world.produce(0, "metal", 0.1)
		world.consume(0, "metal", 0.05)
		if frame % 30 == 7 then
			world.consume(0, "metal", 100000)
		end
	end
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 100")
	run(90)
	local metal, energy = read(world, 0, "metal"), read(world, 0, "energy")
	near("after three slow updates the income is the track's", metal.income, 12)
	near("and the expense", metal.expense, 5)
	-- The playback's own pull of 100,000 is more than the match's 9.
	t.check("a pull the playback's own economy makes larger than the match's reads as the playback's", metal.pull > 100000, metal.pull)
	near("energy's income is the track's, though it is far more than the storage", energy.income, 2000)
	near("and its expense", energy.expense, 1500)
	near("and its pull", energy.pull, 1800)
	t.same("the metal a team holds is still the track's", metal.held, 400)
	t.same("and its storage", metal.storage, 1000)
	t.same("and the energy", energy.held, 50)
	t.same("and its storage", energy.storage, 100)
	near("and nothing was wasted to get there", metal.excess + energy.excess, 0)
	local other = read(world, 1, "metal")
	near("another team has its own income", other.income, 6)
	near("and expense", other.expense, 1)
	-- The track has no pull for it. The engine counts every use as a pull.
	near("and a pull that is its expense", other.pull, 1)

	player:message("coilbox_rewind:seek 2000")
	run(60)
	near("two slow updates after a seek the income is the later frame's", read(world, 0, "metal").income, 31.5)
	player:message("coilbox_rewind:seek 100")
	run(60)
	near("and after a seek backward the earlier one's", read(world, 0, "metal").income, 12)

	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	run(300)
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of setting resources allocate nothing", after - before, 0)
end

-- A playback whose own economy makes more than the match did. The engine's sums
-- only go up, so the number reads as the playback's.

do
	local world, player, run = setup(economy())
	world.economy = function()
		world.produce(0, "metal", 1)
	end
	player:message("coilbox_rewind:pause")
	run(90)
	near("an income the playback's own exceeds reads as the playback's", read(world, 0, "metal").income, 30)
	t.same("and what the team holds is still the track's", read(world, 0, "metal").held, 400)
end

-- A team with an income multiplier, which the start script gives it and which
-- the engine applies to what a gadget adds as well.

do
	local world, player, run = setup(economy(), {
		teams = { { id = 0, allyTeam = 0, incomeMultiplier = 2.5 }, { id = 1, allyTeam = 1, incomeMultiplier = 0 }, { id = 2, allyTeam = 2 } },
	})
	player:message("coilbox_rewind:pause")
	run(90)
	near("a team with an income multiplier still reads the track's income", read(world, 0, "metal").income, 12)
	near("and one whose multiplier is nothing has no income to give, so it reads none", read(world, 1, "metal").income, 0)
	near("and still has its expense", read(world, 1, "metal").expense, 1)
end

-- An engine with no GameFramePost still gets the rates, one frame later.

do
	local world, player, _, runOld = setup(economy())
	world.economy = function()
		world.produce(0, "metal", 0.1)
	end
	player:message("coilbox_rewind:pause")
	runOld(91)
	near("without a post frame call the income is the track's too", read(world, 0, "metal").income, 12)
	near("and the expense", read(world, 0, "metal").expense, 5)
end

-- Excess, which one call adds to on the engines that have it.

do
	local spec = economy()
	spec.values[#spec.values + 1] = { team = 0, code = EXCESS, at = 6.25 }
	local world, player, run = setup(spec)
	player:message("coilbox_rewind:pause")
	run(30)
	near("after a slow update the excess is the track's", read(world, 0, "metal").excess, 6.25)
	run(45)
	near("and it stays so", read(world, 0, "metal").excess, 6.25)
	near("a resource with no excess in the track has none", read(world, 0, "energy").excess, 0)
end

-- A team that is full. What the playback's own units make has nowhere to go,
-- and the engine counts it as excess, which may be more than the match wasted.

local function full()
	return {
		values = {
			{ team = 0, code = HELD, at = 1000 },
			{ team = 0, code = STORAGE, at = 1000 },
			{ team = 0, code = SHARE, at = 0.99 },
			{ team = 0, code = INCOME, at = 6 },
			{ team = 0, code = EXCESS, at = 2 },
		},
	}
end

do
	local world, player, run = setup(full())
	world.economy = function()
		world.produce(0, "metal", 0.2)
	end
	player:message("coilbox_rewind:pause")
	run(90)
	local metal = read(world, 0, "metal")
	near("a full team wastes what the match wasted and not what the playback makes", metal.excess, 2)
	near("its income is the track's", metal.income, 6)
	t.same("it holds the track's metal", metal.held, 1000)
	t.same("and its storage is the track's when the frame is over", metal.storage, 1000)

	-- An engine with no post frame call cannot give the room and take it back.
	local old, oldPlayer, _, runOld = setup(full())
	old.economy = function()
		old.produce(0, "metal", 0.2)
	end
	oldPlayer:message("coilbox_rewind:pause")
	runOld(91)
	near("without a post frame call the excess is the playback's own, which is more", read(old, 0, "metal").excess, 6)
	t.same("and the storage is the track's on every frame", read(old, 0, "metal").storage, 1000)
end

-- Allied teams. The engine hands what a team holds above its share level to
-- its allies on a slow update, which the match did once already.

do
	local world, player, run = setup({
		values = {
			{ team = 0, code = HELD, at = 900 },
			{ team = 0, code = STORAGE, at = 1000 },
			{ team = 0, code = SHARE, at = 0.5 },
			{ team = 1, code = HELD, at = 20 },
			{ team = 1, code = STORAGE, at = 1000 },
			{ team = 1, code = SHARE, at = 0.99 },
		},
	}, { teams = { { id = 0, allyTeam = 0 }, { id = 1, allyTeam = 0 }, { id = 2, allyTeam = 2 } } })
	player:message("coilbox_rewind:pause")
	run(95)
	local giver, taker = read(world, 0, "metal"), read(world, 1, "metal")
	t.same("a team above its share level keeps the track's metal", giver.held, 900)
	t.same("and its ally the track's", taker.held, 20)
	near("nothing was sent on the playback's own account", giver.sent, 0)
	near("and nothing received", taker.received, 0)
	near("the share level reads as the track's", giver.share, 0.5)
end

-- Rules parameters a game's adapter names.

do
	local spec = rising()
	spec.teamParams = { "supplyUsed", "researchPoints", "secret" }
	spec.gameParams = { "wave" }
	local values = spec.values
	values[#values + 1] = { team = 0, code = PARAMETER, at = function(frame)
		return math.floor(frame / 100)
	end }
	-- Research points are first set at frame 300.
	values[#values + 1] = { team = 0, code = PARAMETER + 1, at = function(frame)
		if frame >= 300 then
			return frame * 2
		end
	end }
	values[#values + 1] = { team = 0, code = PARAMETER + 2, at = 77 }
	values[#values + 1] = { team = NO_TEAM, code = PARAMETER, at = 4 }
	local world, player, run = setup(spec, {
		adapter = { name = "Test game", teamParams = { "supplyUsed", "researchPoints", "supplyMax" }, gameParams = { "wave" } },
	})
	local Spring = world.Spring
	-- The game's own gadget counts the playback's units, in the middle of a frame.
	world.economy = function()
		Spring.SetTeamRulesParam(0, "supplyUsed", 999)
	end
	Spring.SetTeamRulesParam(0, "researchPoints", 5)
	player:message("coilbox_rewind:pause")
	player:message("coilbox_rewind:seek 250")
	run(2)
	t.same("a team rules parameter the adapter names is the track's", Spring.GetTeamRulesParam(0, "supplyUsed"), 2)
	t.same("one the match had not set yet is left as the game has it", Spring.GetTeamRulesParam(0, "researchPoints"), 5)
	t.same("a rules parameter of the game is the track's", Spring.GetGameRulesParam("wave"), 4)
	t.same("one the track has and the adapter does not name is left to the game", Spring.GetTeamRulesParam(0, "secret"), nil)
	t.same("which is said once", said(world, "secret"), 1)
	t.same("one the adapter names and the track does not have is said once", said(world, "supplyMax"), 1)
	t.same("a team with no value for a parameter is not given one", Spring.GetTeamRulesParam(1, "supplyUsed"), nil)

	player:message("coilbox_rewind:seek 700")
	run(1)
	t.same("a seek forward gives the later value", Spring.GetTeamRulesParam(0, "supplyUsed"), 7)
	t.same("and one that is set by then", Spring.GetTeamRulesParam(0, "researchPoints"), 1400)
	player:message("coilbox_rewind:seek 310")
	run(1)
	t.same("and a seek backward the earlier one", Spring.GetTeamRulesParam(0, "researchPoints"), 620)
	run(50)
	t.same("nothing more is said", said(world, "secret") + said(world, "supplyMax"), 2)
end

-- A game reads some rules parameters once, as it loads, before the first frame.
-- Splinter Faction's weather widget takes its seed that way (issue #4013), so
-- the parameters the adapter names are the track's as soon as the player is
-- made, at the time it opens on.

do
	local spec = rising()
	spec.teamParams = { "supplyUsed" }
	spec.gameParams = { "weather_seed" }
	spec.values[#spec.values + 1] = { team = 0, code = PARAMETER, at = function(frame)
		return math.floor(frame / 100)
	end }
	spec.values[#spec.values + 1] = { team = NO_TEAM, code = PARAMETER, at = 9876543 }
	local world = setup(spec, {
		adapter = { name = "Test game", teamParams = { "supplyUsed" }, gameParams = { "weather_seed" } },
	})
	t.same("a game rules parameter the adapter names is the track's before the first frame", world.Spring.GetGameRulesParam("weather_seed"), 9876543)
	t.same("and a team rules parameter", world.Spring.GetTeamRulesParam(0, "supplyUsed"), 0)
end

do
	local spec = rising()
	spec.gameParams = { "wave" }
	spec.values[#spec.values + 1] = { team = NO_TEAM, code = PARAMETER, at = function(frame)
		return math.floor(frame / 100)
	end }
	local world = setup(spec, {
		adapter = { name = "Test game", gameParams = { "wave" } },
		modOptions = { coilbox_rewind_start_frame = "1234" },
	})
	t.same("a player that opens at a frame sets the value at that frame", world.Spring.GetGameRulesParam("wave"), 12)
end

-- A track with rules parameters and a game with no adapter.

do
	local spec = rising()
	spec.teamParams = { "supplyUsed" }
	spec.values[#spec.values + 1] = { team = 0, code = PARAMETER, at = 3 }
	local world, player, run = setup(spec)
	run(2)
	t.same("with no adapter a rules parameter of the track is left to the game", world.Spring.GetTeamRulesParam(0, "supplyUsed"), nil)
	t.same("and the metal is still the track's", world.Spring.GetTeamResources(0, "metal"), 100 + player.clock.frame)
end

-- A track from before team resources were recorded.

do
	local spec = rising()
	spec.recorderVersion = 3
	local world, _, run = setup(spec)
	world.teams[0].metal.held = 55
	run(40)
	t.same("a track from recorder version 3 sets nothing", world.resourceSets + world.shareSets + world.resourceFeeds, 0)
	t.same("so a team keeps the playback's own", world.Spring.GetTeamResources(0, "metal"), 55)
	t.same("and the log says why, once", said(world, "recorder version 3"), 1)
end

-- The fixture, through the real reader: what the engine holds is what a reader
-- of its own samples.

do
	local bytes = t.read(t.FIXTURES .. "small.cbtrack")
	local reader = t.syncedEnv()
	local Track = t.load("coilbox_track.lua", reader)
	local Fetch = t.load("coilbox_track_fetch.lua", reader)
	local track = assert(Track.open(Fetch.fromString(bytes)))
	local own = assert(Track.open(Fetch.fromString(bytes)))
	local info = assert(own:info())
	local world, player, run = setup(track, {
		adapter = { name = "Fixture", teamParams = info.teamParams, gameParams = info.gameParams },
	})
	local Spring = world.Spring

	local function sampled(frame, team, code)
		local w = assert(own:seek(frame))
		local v = w:valueOf(team, code)
		if v then
			return w:sampleValue(v, frame)
		end
	end

	player:message("coilbox_rewind:pause")
	local checked = 0
	for _, frame in ipairs({ 100, 669, 1300, 1818, 2101, 1500, 400 }) do
		player:message("coilbox_rewind:seek " .. frame)
		run(1)
		local metal, energy = read(world, 0, "metal"), read(world, 0, "energy")
		local label = "the fixture at frame " .. frame .. ": "
		near(label .. "metal", metal.held, math.min(sampled(frame, 0, HELD) or 0, sampled(frame, 0, STORAGE) or 0))
		near(label .. "metal storage", metal.storage, sampled(frame, 0, STORAGE) or 0)
		near(label .. "energy", energy.held, math.min(sampled(frame, 0, ENERGY + HELD) or 0, sampled(frame, 0, ENERGY + STORAGE) or 0))
		near(label .. "energy share level", energy.share, math.max(0, math.min(1, sampled(frame, 0, ENERGY + SHARE) or 0)))
		for j, name in ipairs(info.teamParams) do
			local wanted = sampled(frame, 0, PARAMETER + j - 1)
			if wanted ~= nil then
				checked = checked + 1
				near(label .. "team rules parameter " .. name, Spring.GetTeamRulesParam(0, name), wanted)
			end
		end
		for j, name in ipairs(info.gameParams) do
			local wanted = sampled(frame, NO_TEAM, PARAMETER + j - 1)
			if wanted ~= nil then
				checked = checked + 1
				near(label .. "game rules parameter " .. name, Spring.GetGameRulesParam(name), wanted)
			end
		end
	end
	t.check("the fixture had rules parameters to check", checked > 0, checked)

	-- Playing allocates nothing. Frames 1,400 to 1,700 are inside one window.
	player:message("coilbox_rewind:seek 1400")
	player:message("coilbox_rewind:play")
	run(1)
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	run(300)
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("300 frames of the fixture allocate nothing", after - before, 0)
end

t.report()
