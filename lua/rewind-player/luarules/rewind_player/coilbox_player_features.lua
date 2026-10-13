-- Coilbox rewind player: the features stage.
--
-- A track holds every feature of the match in one list, each with the first and
-- the last frame it exists on, and does not record them as moving. At a time `t`
-- this stage makes the engine's features that list's: the ones alive at `t`
-- exist where they were recorded, and every other feature is gone.
--
-- That includes the features the map put down before the first frame and any
-- the base game creates, because the track already has those it should have.
-- The engine asks before it leaves a wreck (`AllowFeatureCreation`) and the
-- gadget refuses. It does not ask for a feature Lua creates, so such a feature
-- is removed on the next frame.

local M = {}

local Features = {}
Features.__index = Features

--- The team a feature of no team is stored with.
local NO_TEAM = 255

--- `context` is the player's (see coilbox_player.lua). `rotation` is
-- coilbox_player_rotation.lua.
function M.new(context, rotation)
	local names = context.info.featureDefs
	local defID = {}
	-- Definitions the game's adapter skips are treated as ones the game does not
	-- have, without the line about it, since leaving them out is the point.
	local skipped = context.adapter and context.adapter.skippedFeatures
	for i = 1, #names do
		local def = context.FeatureDefNames[names[i]]
		local skip = skipped and skipped[names[i]:lower()]
		if skip then
			def = nil
		end
		defID[i] = def and def.id or false
		if not def and not skip then
			context.report("feature " .. names[i], "the game has no feature called " .. names[i] .. ", so the track's features of that kind are left out")
		end
	end
	local list = context.features
	local first, last = {}, {}
	for i = 1, #list do
		first[i], last[i] = list[i].firstFrame, list[i].lastFrame
	end
	return setmetatable({
		context = context,
		Spring = context.Spring,
		euler = rotation.euler,
		names = names,
		defID = defID,
		list = list,
		count = #list,
		first = first,
		last = last,
		-- The engine's id for a feature of the list, and back.
		featureOf = {},
		indexOf = {},
		-- Features that could not be created. A seek clears it.
		failed = {},
		strangers = {},
		strangerCount = 0,
		creating = false,
		destroying = false,
		lostReported = false,
	}, Features)
end

--- Destroys a feature that is not the track's.
function Features:evict(featureID)
	local Spring = self.Spring
	if self.indexOf[featureID] or not Spring.ValidFeatureID(featureID) then
		return
	end
	self.destroying = true
	Spring.DestroyFeature(featureID)
	self.destroying = false
end

--- The engine created a feature. One the stage did not ask for goes on the next
-- frame.
function Features:created(featureID)
	if self.creating then
		return
	end
	local n = self.strangerCount + 1
	self.strangerCount = n
	self.strangers[n] = featureID
	self.context.report("feature stranger", "a feature was created that the track does not have, by the map or the base game. The player removes such a feature on the next frame. Later ones are not logged")
end

--- The engine destroyed a feature. When it is one of the track's and the stage
-- did not ask, it is made again on the next frame.
function Features:destroyed(featureID)
	local i = self.indexOf[featureID]
	if not i or self.destroying then
		return
	end
	self.indexOf[featureID] = nil
	self.featureOf[i] = nil
	if not self.lostReported then
		self.lostReported = true
		self.context.report("feature lost", "the base game destroyed a feature the track has (feature " .. featureID .. "). The player makes such a feature again on the next frame")
	end
end

--- After a jump: every feature the engine has that is not the track's goes, and
-- what could not be created is tried again.
function Features:resync()
	local Spring = self.Spring
	local failed = self.failed
	for i in next, failed do
		failed[i] = nil
	end
	for i, featureID in next, self.featureOf do
		if not Spring.ValidFeatureID(featureID) then
			self.featureOf[i] = nil
			self.indexOf[featureID] = nil
		end
	end
	local all = Spring.GetAllFeatures()
	for n = 1, #all do
		self:evict(all[n])
	end
end

--- Takes away every feature that is not in the track at `t`.
function Features:remove(t)
	local Spring = self.Spring
	local first, last = self.first, self.last
	for i, featureID in next, self.featureOf do
		if t < first[i] or t > last[i] then
			self.destroying = true
			Spring.DestroyFeature(featureID)
			self.destroying = false
			self.featureOf[i] = nil
			self.indexOf[featureID] = nil
		end
	end
	local strangers = self.strangers
	for n = self.strangerCount, 1, -1 do
		self:evict(strangers[n])
		strangers[n] = nil
	end
	self.strangerCount = 0
end

function Features:create(i, t)
	local Spring = self.Spring
	local feature = self.list[i]
	local id = self.defID[feature.def + 1]
	if not id then
		-- Reported by name when the stage was made.
		self.failed[i] = true
		return
	end
	local team = feature.team == NO_TEAM and -1 or self.context.teamOf(feature.team)
	local at, turn = feature.position, feature.rotation
	self.creating = true
	local featureID = Spring.CreateFeature(id, at[1], at[2], at[3], 0, team)
	self.creating = false
	if not featureID then
		self.failed[i] = true
		self.context.report(
			"feature " .. id,
			"Spring.CreateFeature gave nothing for " .. self.names[feature.def + 1] .. " at frame " .. t .. ". Features of that kind are tried again after the next seek"
		)
		return
	end
	if self.context.on.featureTurn then
		Spring.SetFeatureRotation(featureID, self.euler(turn[1], turn[2], turn[3], turn[4]))
	end
	self.featureOf[i] = featureID
	self.indexOf[featureID] = i
end

--- Creates every feature of the track at `t` that is not there.
function Features:place(t)
	local first, last = self.first, self.last
	local featureOf, failed = self.featureOf, self.failed
	for i = 1, self.count do
		if t >= first[i] and t <= last[i] and not featureOf[i] and not failed[i] then
			self:create(i, t)
		end
	end
end

return M
