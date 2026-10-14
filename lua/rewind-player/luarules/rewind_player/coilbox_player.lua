-- Coilbox rewind player: the player.
--
-- It holds a time `t` and on every simulation frame makes the world the track
-- at `t`. It simulates nothing, so `t` can jump or run backwards. The gadget
-- (luarules/gadgets/coilbox_rewind_player.lua) opens the track, makes one of
-- these and hands it the engine's calls.
--
-- The work is done by stages, in a list. On a frame every stage first takes
-- away what the track does not have at `t`, and then every stage puts in place
-- what it does have. Removals come before creations across all of them. A
-- stage is a table with three functions:
--
--   stage:resync(t)         after a jump, before the two below: check what the
--                           engine has against what the stage thinks it has
--   stage:remove(t, clock)  take away what is not in the track at t
--   stage:place(t, clock)   create what is missing and put everything in place
--
-- `clock` is coilbox_player_clock.lua's: `clock.jumped` says the frame was
-- reached by a seek or a step and not by play, and `clock.direction` and
-- `clock.speed` say how it is playing, and `clock:watched()` whether it is
-- forward at near the match's own speed. A stage can also have `stage:afterSim()`, which
-- runs when the frame is over (GameFramePost). That call does not reach every
-- gadget (issue #4002), so `context.post.arrives` says whether the frame before
-- ended with it, and a stage that leans on it can have two more:
--
--   stage:afterSimMissed()   a frame ended without the call, after frames that
--                            ended with it: put back what was held for the frame
--   stage:withoutAfterSim()  the call does not come: say once what the stage
--                            does without it
--
-- What a stage is given is the context: the track, its info and features, the
-- engine's tables, `teamOf` and `report`. A stage takes the engine from the
-- context and not from a global, so the tests can hand it a stand-in.
--
-- Play state goes out as game rules parameters, which any widget can read, and
-- comes in as Lua messages. lua/rewind-player/README.md has both.

local MODULES = "luarules/rewind_player/"

local Reader = VFS.Include(MODULES .. "coilbox_track.lua")
local Clock = VFS.Include(MODULES .. "coilbox_player_clock.lua")
local Rotation = VFS.Include(MODULES .. "coilbox_player_rotation.lua")
local Terrain = VFS.Include(MODULES .. "coilbox_player_terrain.lua")
local Features = VFS.Include(MODULES .. "coilbox_player_features.lua")
local Units = VFS.Include(MODULES .. "coilbox_player_units.lua")
local Aim = VFS.Include(MODULES .. "coilbox_player_aim.lua")
local Animation = VFS.Include(MODULES .. "coilbox_player_animation.lua")
local Projectiles = VFS.Include(MODULES .. "coilbox_player_projectiles.lua")
local Resources = VFS.Include(MODULES .. "coilbox_player_resources.lua")
local Adapter = VFS.Include(MODULES .. "coilbox_player_adapter.lua")
local Engine = VFS.Include(MODULES .. "coilbox_player_engine.lua")

local M = {}

--- The first recorder version whose tracks have the teams' resources.
local RESOURCES_SINCE = 4

--- The game rules parameters the player publishes. All are numbers.
M.PARAMS = {
	-- The time, as a frame of the track. It can be a fraction.
	frame = "coilbox_rewind_frame",
	-- 1 while playing and 0 while paused.
	playing = "coilbox_rewind_playing",
	-- 1 for forward and -1 for backward.
	direction = "coilbox_rewind_direction",
	-- Frames of the track for each simulation frame.
	speed = "coilbox_rewind_speed",
	firstFrame = "coilbox_rewind_first_frame",
	lastFrame = "coilbox_rewind_last_frame",
	framesPerSecond = "coilbox_rewind_frames_per_second",
	-- 1 when the world is the track at the time shown, 0 from a seek until it is.
	-- A seek can take several frames (issue #3988).
	settled = "coilbox_rewind_settled",
}

--- The Lua message that sets the most units made in a frame and the most
-- removed, as two whole numbers after the text. The gadget's unsynced half sends
-- it, for example `coilbox_rewind_budget:40 30`. `coilbox_rewind_budget:none`
-- says that no budget will come, because the unsynced half cannot time a frame,
-- and takes the limit off.
M.BUDGET = "coilbox_rewind_budget:"

--- The Lua message that says where the viewer looks, from the gadget's unsynced
-- half (issue #4008): the x and z of the place on the ground in the middle of
-- the view, and after them the x and z of the view's four corners on the
-- ground, in order round it, when all four are on the ground. For example
-- `coilbox_rewind_view:4096 2048`. `coilbox_rewind_view:none` says there is no
-- such place, as when the camera looks at the sky.
M.VIEW = "coilbox_rewind_view:"

--- The mod options the player reads.
M.OPTIONS = {
	-- The frame to open on. The track's first frame without it.
	startFrame = "coilbox_rewind_start_frame",
	-- "1" to open paused. Playing without it.
	startPaused = "coilbox_rewind_start_paused",
}

local Player = {}
Player.__index = Player

--- The whole number of 1 or more that `text` holds, or nil.
local function whole(text)
	local n = tonumber(text)
	if n and n >= 1 and n < math.huge and n == math.floor(n) then
		return n
	end
end

--- The numbers a view message carries, or nil when it is not two or ten
-- numbers. `tonumber` reads "nan" and "inf".
local function viewOf(text)
	local numbers = {}
	for word in text:gmatch("%S+") do
		local n = tonumber(word)
		if not n or n ~= n or n == math.huge or n == -math.huge then
			return nil
		end
		numbers[#numbers + 1] = n
	end
	if #numbers == 2 or #numbers == 10 then
		return numbers
	end
end

--- A stage that does nothing, for one whose engine calls are missing. It takes
-- the engine's call-ins too, since the player hands them to every stage.
local OFF = {}
for _, name in ipairs({ "resync", "remove", "place", "created", "destroyed", "afterSim" }) do
	OFF[name] = function() end
end

--- Sets a parameter when its value has changed since it was last set.
local function publish(self, name, value)
	if self.published[name] ~= value then
		self.published[name] = value
		self.Spring.SetGameRulesParam(name, value)
	end
end

local function publishClock(self)
	local clock, P = self.clock, M.PARAMS
	publish(self, P.settled, self:settled() and 1 or 0)
	publish(self, P.frame, clock.frame)
	publish(self, P.playing, clock.playing and 1 or 0)
	publish(self, P.direction, clock.direction)
	publish(self, P.speed, clock.speed)
end

--- A player of `track`, or nil and the reason. `options.budget` is the most
-- units a frame makes and the most it removes, and without it there is no
-- limit. `options.modOptions` is what
-- `Spring.GetModOptions` gave and `options.log` takes a line for the engine's
-- log. `options.adapter` is the game's adapter as coilbox_player_adapter.lua
-- reads it, or nil for a game with none, and `options.adapterWhy` is the reason
-- when there is none because the game's could not be used. `options.engine` is
-- what coilbox_player_engine.lua's `check` gave for the engine, which says what
-- is switched off. Without it every feature is on. `options.arrive` is a function
-- the units stage calls with a unit's id, its x, y and z and its team when the
-- unit wants an arrival effect (issue #4009), and without it none is asked for.
-- `options.scriptCallIns` is a table the gadget keeps, by the engine's unit id,
-- of the call-ins of each Lua unit script (issue #3797), and without it a unit
-- with a Lua script is told nothing.
function M.new(track, options)
	local header = track.header
	local info, why = track:info()
	if not info then
		return nil, why
	end
	local features, featuresWhy = track:features()
	if not features then
		return nil, featuresWhy
	end

	local log = options.log
	local reported = {}
	--- Logs `text` the first time it is called with `key`.
	local function report(key, text)
		if not reported[key] then
			reported[key] = true
			log(text)
		end
	end

	-- A team of the track is the same number in the game, because the start
	-- script carries the replay's teams. The one the game does not have as a
	-- team of its own is Gaia, which the engine numbers itself.
	local gaia = Spring.GetGaiaTeamID()
	local teams = {}
	for _, team in ipairs(Spring.GetTeamList()) do
		teams[team] = team
	end
	local function teamOf(team)
		local found = teams[team]
		if found == nil or found == gaia then
			return gaia
		end
		return found
	end

	local clock = Clock.new(header.firstFrame, header.lastFrame)
	local modOptions = options.modOptions or {}
	local start = tonumber(modOptions[M.OPTIONS.startFrame])
	if start and start == start then
		clock:seek(start)
	end
	if modOptions[M.OPTIONS.startPaused] == "1" then
		clock.playing = false
	end

	-- The hooks the adapter has, each guarded so that one that raises is
	-- reported and switched off and does not take the player down. A table with
	-- no hooks in it when the adapter has none.
	local hooks = {
		started = Adapter.guarded(options.adapter, "started", report),
		unitPlaced = Adapter.guarded(options.adapter, "unitPlaced", report),
		afterFrame = Adapter.guarded(options.adapter, "afterFrame", report),
	}
	log(Adapter.describe(options.adapter, options.adapterWhy))
	if options.adapter then
		for _, name in ipairs(options.adapter.unknownHooks) do
			log("the adapter has a hook called " .. name .. " that is not a function the player calls, so it is never called")
		end
	end

	local on = options.engine and options.engine.on or Engine.ALL_ON
	-- Whether the engine tells the player when a frame is over. `arrives` is
	-- true in a frame when the frame before ended with that call.
	local post = { arrives = false }
	local context = {
		on = on,
		post = post,
		adapter = options.adapter,
		hooks = hooks,
		track = track,
		info = info,
		features = features,
		Spring = Spring,
		Game = Game,
		CMD = CMD,
		UnitDefNames = UnitDefNames,
		FeatureDefNames = FeatureDefNames,
		WeaponDefNames = WeaponDefNames,
		teamOf = teamOf,
		report = report,
		arrive = options.arrive,
		scriptCallIns = options.scriptCallIns,
	}
	-- A stage whose calls the engine lacks is the one that does nothing.
	local terrain = on.terrain and Terrain.new(context, Reader) or OFF
	local featureStage = on.features and Features.new(context, Rotation) or OFF
	local units = Units.new(context, Rotation)
	if options.budget then
		units:setBudget(options.budget)
	end
	-- Aiming pieces are posed on the units the stage before it made.
	local aim = on.aimPoses and Aim.new(context, units) or OFF
	-- Scripts are told what their units do, and builders' work is published.
	-- Each of its rows switches off a part of it, so the stage is always made.
	local animation = Animation.new(context, units, aim ~= OFF and aim or nil, featureStage ~= OFF and featureStage or nil)
	local projectiles = on.shots and Projectiles.new(context, units, Clock) or OFF
	-- A track from before recorder version 4 has no team's resources in it.
	local resources = OFF
	if (header.recorderVersion or 0) >= RESOURCES_SINCE then
		resources = Resources.new(context, Reader)
	else
		log(
			"the track is from recorder version "
				.. tostring(header.recorderVersion)
				.. ", which did not record the teams' resources, so the resource bars show the playback's own economy. A new recording of the replay has them"
		)
	end

	local self = setmetatable({
		Spring = Spring,
		track = track,
		clock = clock,
		context = context,
		log = log,
		report = report,
		terrain = terrain,
		features = featureStage,
		units = units,
		aim = aim,
		animation = animation,
		projectiles = projectiles,
		resources = resources,
		-- In the order they run. Terrain moves the ground before anything is put
		-- on it, and a shot's owner is a unit. Resources come last, after every
		-- unit the game's own gadgets count has been made or taken away.
		-- Animation comes after aim, which has looked up the pieces of the units
		-- made in the frame.
		stages = { terrain, featureStage, units, aim, animation, projectiles, resources },
		afterFrame = hooks.afterFrame,
		published = {},
		post = post,
		installFramePost = options.installFramePost,
		-- Whether a frame has run, whether the call came after the last one, how
		-- many frames in a row ended without it, and whether the install was
		-- asked for since it last came.
		framed = false,
		posted = false,
		misses = 0,
		installed = false,
	}, Player)

	-- Every ally team sees the whole map, so nothing the track shows is hidden
	-- from a view that follows one of them.
	if on.sight then
		for _, allyTeam in ipairs(Spring.GetAllyTeamList()) do
			Spring.SetGlobalLos(allyTeam, true)
		end
	end

	local P = M.PARAMS
	publish(self, P.firstFrame, header.firstFrame)
	publish(self, P.lastFrame, header.lastFrame)
	publish(self, P.framesPerSecond, header.framesPerSecond)
	publishClock(self)
	if hooks.started then
		hooks.started()
	end
	return self
end

--- Tells every stage that has `name` to run it.
local function each(stages, name)
	for i = 1, #stages do
		local stage = stages[i]
		if stage[name] then
			stage[name](stage)
		end
	end
end

--- Finds out whether the frame before this one ended with the engine's call
-- (GameFramePost), which is the only way to know that it comes (issue #4002).
-- An engine before 105.1.1-2590 does not make the call, and a game's gadget
-- handler may not pass it on.
--
-- The first frame that follows one with no call asks the gadget to install the
-- call-in, and the install has the one frame it needs to show. When that frame
-- ends without the call too, or nothing could be installed, the stages are
-- told, and each says what it does without it. A call that stops coming later,
-- which a handler that rebuilds its call-ins can cause, is asked for again the
-- same way.
local function lookBack(self)
	local post = self.post
	if self.posted then
		self.posted = false
		if self.installed and self.misses > 0 then
			self.report("post installed", "the game's gadget handler does not pass GameFramePost on, so the player installed it, and the engine's call now reaches the player")
		end
		post.arrives = true
		self.misses = 0
		self.installed = false
		return
	end
	if not self.framed then
		self.framed = true
		return
	end
	if post.arrives then
		post.arrives = false
		each(self.stages, "afterSimMissed")
	end
	self.misses = self.misses + 1
	if self.misses == 1 and self.installFramePost and self.installFramePost() then
		self.installed = true
		return
	end
	if self.misses == 1 or (self.misses == 2 and self.installed) then
		each(self.stages, "withoutAfterSim")
		if self.installed then
			self.report("post missing", "GameFramePost does not reach the player. The player installed the call-in itself and still none came, so this engine does not make the call. Engine 105.1.1-2590 and later do")
		else
			self.report("post missing", "GameFramePost does not reach the player, and the player could not install the call-in itself")
		end
	end
end

--- One simulation frame: move the clock, then make the world the track at the
-- time it shows.
function Player:frame()
	local clock, stages = self.clock, self.stages
	lookBack(self)
	clock:advance()
	local t = clock.frame
	if clock.jumped then
		for i = 1, #stages do
			stages[i]:resync(t)
		end
	end
	for i = 1, #stages do
		stages[i]:remove(t, clock)
	end
	for i = 1, #stages do
		stages[i]:place(t, clock)
	end
	if self.afterFrame then
		self.afterFrame(t, clock)
	end
	publishClock(self)
end

--- The end of a simulation frame, after the engine has done its own work on
-- the units (GameFramePost).
function Player:framePost()
	self.posted = true
	self.units:afterSim()
	self.aim:afterSim()
	self.resources:afterSim()
end

--- The gadget is going away. Nothing the player holds for the length of a
-- frame is left behind.
function Player:shutdown()
	each(self.stages, "afterSimMissed")
end

--- Whether the world is the track at the time shown: no seek is waiting to be
-- shown and no stage left work for a later frame.
function Player:settled()
	return not self.clock.pending and not self.units.unsettled and not self.projectiles.unsettled
end

--- How many units the last frame made, and how many it removed.
function Player:worked()
	return self.units.made, self.units.removed
end

--- A Lua message. True when it was the player's, done or refused, and false
-- when it was somebody else's.
function Player:message(text)
	if text:sub(1, #M.BUDGET) == M.BUDGET then
		if text == M.BUDGET .. "none" then
			self.units:setBudget(math.huge)
			return true
		end
		local make, remove = text:match("^(%S+) (%S+)$", #M.BUDGET + 1)
		make, remove = whole(make), whole(remove)
		if make and remove then
			self.units:setBudget(make, remove)
		else
			self.log("the message \"" .. text .. "\" was refused: the budget is two whole numbers of 1 or more, the most units made and the most removed in a frame")
		end
		return true
	end
	if text:sub(1, #M.VIEW) == M.VIEW then
		local rest = text:sub(#M.VIEW + 1)
		local numbers = rest ~= "none" and viewOf(rest)
		if rest == "none" then
			self.units:setView(nil)
		elseif numbers then
			local corners = #numbers == 10 and { unpack(numbers, 3, 10) } or nil
			self.units:setView(numbers[1], numbers[2], corners)
		else
			self.log("the message \"" .. text .. "\" was refused: the view is the x and z of the place the camera looks at, and after them the x and z of the view's four corners or nothing")
		end
		return true
	end
	local done, why = self.clock:message(text)
	if done == nil then
		return false
	end
	if done then
		publishClock(self)
	else
		self.log("the message \"" .. text .. "\" was refused: " .. tostring(why))
	end
	return true
end

-- What the engine tells the gadget, handed on.

function Player:unitCreated(unitID)
	self.units:created(unitID)
end

function Player:unitDestroyed(unitID)
	self.units:destroyed(unitID)
end

function Player:unitDamaged(unitID, damage)
	self.units:damaged(unitID, damage)
end

function Player:featureCreated(featureID)
	self.features:created(featureID)
end

function Player:featureDestroyed(featureID)
	self.features:destroyed(featureID)
end

--- The engine asks before it leaves a wreck. The track already has every wreck
-- of the match.
function Player:allowFeatureCreation()
	self.report("wreck", "the engine asked to leave a wreck, and was refused, since the track has the match's wrecks. Later asks are not logged")
	return false
end

--- A team died, which only the base game can have done. Nothing can be created
-- on a dead team again and no call revives one, so all there is to do is say so.
function Player:teamDied(teamID)
	self.report("team " .. teamID, "team " .. teamID .. " died, so the engine will create no more units on it. The base game killed it past the guard gadget")
end

return M
