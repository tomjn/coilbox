-- Coilbox rewind player: the resources stage (issue #3982).
--
-- A playback simulates nothing of the match, so each team's economy would be
-- whatever the units the player placed happen to make. This stage makes the
-- engine's own numbers the recorded match's, so a resource bar, a widget and a
-- gadget all read the match and none of them has to be changed.
--
-- What it sets, and how, was read from the engine's source (rts/Sim/Misc/Team.cpp
-- and TeamHandler.cpp, rts/Lua/LuaSyncedCtrl.cpp):
--
--   What a team holds, its storage and its share level have calls that set
--   them. They are set on every frame, and again when the frame is over.
--
--   Income, expense and pull have none. The engine sums what a team makes and
--   uses, and on every frame that divides by 30 the sums become the numbers it
--   reports and start again from nothing. So on those frames the stage adds
--   what the match had more than the playback's own, by adding and using the
--   resource itself, and puts back what the team holds afterwards. The sums
--   only go up, so a number the playback's own economy makes larger than the
--   match's reads as the playback's.
--
--   Excess has a call on engines from 2026.07.01, which adds to the number the
--   engine reports. So that the playback wastes nothing of its own, a team has
--   room for the playback's own income for the length of a frame.
--
--   What a team sent and received has no call either. The engine adds a
--   transfer between two teams to the first one's sent sum and the second one's
--   received sum, so the stage makes the transfers the match made, each from a
--   team that sent to one that received (issue #4011).
--
-- The playback's own share is not known for the 30 frames that are running,
-- since only the sums of the 30 before can be read. The stage takes those, less
-- what it added itself. They are right once three of the engine's stretches of
-- 30 frames have ended with the same units in the world: the first after a
-- seek still has the units of the frame before it, and the second is guessed
-- from that one.
--
-- The engine's own economy runs in the middle of a frame, after a gadget's
-- GameFrame. With GameFramePost the numbers are put back before anything is
-- drawn. On an engine without it (issue #4002) what a team holds is read one
-- frame of the playback's own economy off, and a rules parameter the game sets
-- later in the frame reads as the game's.
--
-- A game's own numbers are rules parameters. The track has the ones the game's
-- adapter named when the match was recorded, and the stage sets those the
-- adapter still names.

local M = {}

local Resources = {}
Resources.__index = Resources

local max = math.max

--- The frames between two of the engine's sums, TEAM_SLOWUPDATE_RATE in
-- rts/Sim/Misc/GlobalConstants.h. It is 30 at 105.0 and at commit 212c369b4c, and Lua
-- is not told it.
local PERIOD = 30

--- The engine reads the first letter of a resource's name, and
-- Spring.SetTeamResource takes these for what is held and what can be stored.
local NAME = { "m", "e" }
local STORAGE_NAME = { "ms", "es" }

--- The rules parameters to set: those the track has that the adapter names.
-- Gives their names and their codes in the track. The names only one of the
-- two has go on the lists `unnamed` and `unrecorded`.
local function parameters(recorded, named, unnamed, unrecorded)
	local wanted = {}
	for _, name in ipairs(named or {}) do
		wanted[name] = true
	end
	local names, codes, has = {}, {}, {}
	for j, name in ipairs(recorded or {}) do
		has[name] = true
		if wanted[name] then
			names[#names + 1] = name
			codes[#codes + 1] = j - 1
		else
			unnamed[#unnamed + 1] = name
		end
	end
	for _, name in ipairs(named or {}) do
		if not has[name] then
			unrecorded[#unrecorded + 1] = name
		end
	end
	return names, codes
end

--- `context` is the player's (see coilbox_player.lua). `reader` is
-- coilbox_track.lua.
function M.new(context, reader)
	local Spring = context.Spring
	local on = context.on
	local adapter = context.adapter
	local CODE = reader.VALUE

	-- The teams of the track that the engine has.
	local has = {}
	for _, team in ipairs(Spring.GetTeamList()) do
		has[team] = true
	end
	local teams, multiplier = {}, {}
	for _, team in ipairs(context.info.teams) do
		if has[team.id] then
			local n = #teams + 1
			teams[n] = team.id
			multiplier[n] = 1
			if on.resourceRates then
				-- The start script gives a team its income multiplier and nothing
				-- changes it, and the engine applies it to what a gadget adds too.
				multiplier[n] = select(7, Spring.GetTeamInfo(team.id, false)) or 1
			end
		end
	end

	local unnamed, unrecorded = {}, {}
	local teamNames, teamCodes = parameters(context.info.teamParams, adapter and adapter.teamParams, unnamed, unrecorded)
	if not on.teamParams then
		teamNames, teamCodes = {}, {}
	end
	local gameNames, gameCodes = parameters(context.info.gameParams, adapter and adapter.gameParams, unnamed, unrecorded)
	if #unnamed > 0 then
		context.report(
			"unnamed parameters",
			"the track has rules parameters the game's adapter does not name, so they are left to the game: " .. table.concat(unnamed, ", ")
		)
	end
	if #unrecorded > 0 then
		context.report(
			"unrecorded parameters",
			"the game's adapter names rules parameters the track was recorded without, so they are the playback's own. A new recording of the replay has them: "
				.. table.concat(unrecorded, ", ")
		)
	end

	local self = setmetatable({
		context = context,
		track = context.track,
		Spring = Spring,
		CODE = CODE,
		teams = teams,
		multiplier = multiplier,
		-- Which parts the engine has the calls for.
		sets = on.resources == true,
		reads = on.resourceRates == true,
		feeds = on.resources == true and on.resourceRates == true,
		shares = on.resources == true and on.resourceRates == true and on.resourceShares == true,
		excess = on.resourceRates == true and on.resourceExcess == true,
		teamNames = teamNames,
		teamCodes = teamCodes,
		gameNames = gameNames,
		gameCodes = gameCodes,
		-- The window whose tracks the lists below point into, and the time of the
		-- frame that was last put in place.
		window = nil,
		t = nil,
		-- True from a frame on which the engine sums up until its new numbers
		-- have been read.
		rolled = false,
		-- Whether the engine calls back at the end of a frame, which the player
		-- finds out and keeps in `post.arrives` (issue #4002).
		post = context.post,
		gameValue = {},
		teamValue = {},
	}, Resources)

	-- For each team and each of its two resources, in one list: the tracks of
	-- its numbers in the window, false for a number the window has no track of,
	-- then the playback's own sums, and what the stage added to the running ones.
	for _, name in ipairs({ "held", "storage", "share", "pull", "income", "expense", "wasted", "sent", "received" }) do
		self[name] = {}
	end
	for _, name in ipairs({ "ownPull", "ownIncome", "ownExpense", "addedPull", "addedIncome", "addedExpense", "ownSent", "ownReceived", "addedSent", "addedReceived", "giving", "taking" }) do
		local list = {}
		for s = 1, #teams * 2 do
			list[s] = 0
		end
		self[name] = list
	end
	return self
end

--- Looks up the tracks of window `w`, once for each window.
local function index(self, w)
	local CODE, teams = self.CODE, self.teams
	for i = 1, #teams do
		local team = teams[i]
		for r = 1, 2 do
			local s = (i - 1) * 2 + r
			local base = (r - 1) * CODE.ENERGY
			self.held[s] = w:valueOf(team, base + CODE.HELD) or false
			self.storage[s] = w:valueOf(team, base + CODE.STORAGE) or false
			self.share[s] = w:valueOf(team, base + CODE.SHARE) or false
			self.pull[s] = w:valueOf(team, base + CODE.PULL) or false
			self.income[s] = w:valueOf(team, base + CODE.INCOME) or false
			self.expense[s] = w:valueOf(team, base + CODE.EXPENSE) or false
			self.wasted[s] = w:valueOf(team, base + CODE.EXCESS) or false
			self.sent[s] = w:valueOf(team, base + CODE.SENT) or false
			self.received[s] = w:valueOf(team, base + CODE.RECEIVED) or false
		end
		local count = #self.teamCodes
		for j = 1, count do
			self.teamValue[(i - 1) * count + j] = w:valueOf(team, CODE.PARAMETER + self.teamCodes[j]) or false
		end
	end
	for j = 1, #self.gameCodes do
		self.gameValue[j] = w:valueOf(CODE.NO_TEAM, CODE.PARAMETER + self.gameCodes[j]) or false
	end
	self.window = w
end

--- A resource number at `t`. One with no track is nothing for the whole window.
local function value(w, v, t)
	if v then
		return w:sampleValue(v, t) or 0
	end
	return 0
end

--- Reads the numbers the engine has just summed. What they hold beyond what
-- the stage added is the playback's own, which is the best there is to know of
-- the stretch that is starting. Then tops the excess up to the track's.
local function settle(self, w, t)
	local Spring, teams = self.Spring, self.teams
	local getTeamResources = Spring.GetTeamResources
	local shares = self.shares
	for i = 1, #teams do
		local team = teams[i]
		for r = 1, 2 do
			local s = (i - 1) * 2 + r
			local _, _, pull, income, expense, _, sent, received, wasted = getTeamResources(team, NAME[r])
			if pull then
				if shares then
					self.ownSent[s] = max(0, sent - self.addedSent[s])
					self.ownReceived[s] = max(0, received - self.addedReceived[s])
					self.addedSent[s], self.addedReceived[s] = 0, 0
				end
				self.ownPull[s] = max(0, pull - self.addedPull[s])
				self.ownIncome[s] = max(0, income - self.addedIncome[s])
				self.ownExpense[s] = max(0, expense - self.addedExpense[s])
				self.addedPull[s], self.addedIncome[s], self.addedExpense[s] = 0, 0, 0
				if self.excess then
					local missing = value(w, self.wasted[s], t) - wasted
					if missing > 0 then
						Spring.AddTeamResourceExcessStats(team, NAME[r], missing)
					end
				end
			end
		end
	end
	self.rolled = false
end

--- Adds to the engine's running sums what the match had more than the
-- playback's own. Storage is made large enough first, so that nothing added is
-- wasted, and `apply` puts it and what the team holds back.
local function feed(self, w, t)
	local Spring, teams = self.Spring, self.teams
	local setTeamResource, addTeamResource, useTeamResource = Spring.SetTeamResource, Spring.AddTeamResource, Spring.UseTeamResource
	for i = 1, #teams do
		local team = teams[i]
		local scale = self.multiplier[i]
		for r = 1, 2 do
			local s = (i - 1) * 2 + r
			local name = NAME[r]
			local income = max(0, value(w, self.income[s], t) - self.ownIncome[s])
			local expense = max(0, value(w, self.expense[s], t) - self.ownExpense[s])
			-- A use counts as a pull as well.
			local pull = max(0, value(w, self.pull[s], t) - self.ownPull[s] - expense)
			if scale <= 0 then
				income = 0
			end
			if income > 0 or expense > 0 or pull > 0 then
				-- Twice what goes through it, so a rounding of the multiplier
				-- cannot push the last of it over the top.
				setTeamResource(team, STORAGE_NAME[r], 2 * (income + expense))
				setTeamResource(team, name, 0)
				if income > 0 then
					addTeamResource(team, name, income / scale)
				end
				-- A use of exactly what the team holds goes through and counts as
				-- an expense. A use of more than it holds counts as a pull only.
				setTeamResource(team, name, expense)
				if expense > 0 then
					useTeamResource(team, name, expense)
				end
				setTeamResource(team, name, 0)
				if pull > 0 then
					useTeamResource(team, name, pull)
				end
			end
			self.addedIncome[s], self.addedExpense[s], self.addedPull[s] = income, expense, expense + pull
		end
	end
end

--- Makes the transfers that add what the match sent and received to the
-- engine's running sums. For each resource the senders give to the receivers,
-- never to themselves. The tracks are thinned one by one, so the two totals may
-- differ. The smaller total is made whole and the larger is cut in the same
-- proportion. `apply` puts what every team holds back.
local function share(self, w, t)
	local Spring, teams = self.Spring, self.teams
	local setTeamResource, shareTeamResource = Spring.SetTeamResource, Spring.ShareTeamResource
	local giving, taking = self.giving, self.taking
	local count = #teams
	for r = 1, 2 do
		local name = NAME[r]
		local gives, takes = 0, 0
		for i = 1, count do
			local s = (i - 1) * 2 + r
			giving[i] = max(0, value(w, self.sent[s], t) - self.ownSent[s])
			taking[i] = max(0, value(w, self.received[s], t) - self.ownReceived[s])
			gives = gives + giving[i]
			takes = takes + taking[i]
		end
		local matched = gives < takes and gives or takes
		if matched > 0 then
			local cutGiving, cutTaking = matched / gives, matched / takes
			for i = 1, count do
				giving[i] = giving[i] * cutGiving
				taking[i] = taking[i] * cutTaking
			end
			for i = 1, count do
				for j = 1, count do
					local amount = giving[i] < taking[j] and giving[i] or taking[j]
					if i ~= j and amount > 0 then
						-- The sender must hold the amount, and storage must hold it.
						setTeamResource(teams[i], STORAGE_NAME[r], 2 * amount)
						setTeamResource(teams[i], name, amount)
						shareTeamResource(teams[i], teams[j], name, amount)
						if (Spring.GetTeamResources(teams[i], name)) > 0 then
							-- Before 2026.07.01 the engine asks the game's
							-- AllowResourceTransfer, which refused.
							self.context.report(
								"transfer refused",
								"the game's AllowResourceTransfer refused a transfer between teams, so what those teams sent and received reads as the playback's own"
							)
						else
							giving[i] = giving[i] - amount
							taking[j] = taking[j] - amount
							local si, sj = (i - 1) * 2 + r, (j - 1) * 2 + r
							self.addedSent[si] = self.addedSent[si] + amount
							self.addedReceived[sj] = self.addedReceived[sj] + amount
						end
					end
				end
			end
		end
	end
end

--- Sets what has a call: storage, share level and what a team holds, and the
-- rules parameters. `summing` is true on a frame the engine sums up on.
-- `during` is true for the start of a frame on an engine that is known to call
-- back when the frame is over.
local function apply(self, w, t, summing, during)
	local Spring, teams = self.Spring, self.teams
	if self.sets then
		local setTeamResource, setTeamShareLevel = Spring.SetTeamResource, Spring.SetTeamShareLevel
		local ownIncome = self.ownIncome
		for i = 1, #teams do
			local team = teams[i]
			for r = 1, 2 do
				local s = (i - 1) * 2 + r
				local storage = value(w, self.storage[s], t)
				if during then
					-- A team that is nearly full would waste what the playback's own
					-- units make in the rest of the frame, and the engine would count
					-- that as excess. So for the rest of the frame the team has room
					-- for all the playback makes in 30 frames, which the engine last
					-- measured. The storage is the track's again when the frame is over.
					storage = storage + ownIncome[s]
				end
				setTeamResource(team, STORAGE_NAME[r], storage)
				-- When the engine sums up it also hands what a team holds above its
				-- share level to its allies, which the match did once already. At a
				-- level of 1 it has nothing to hand over. The level is the track's
				-- again when the frame is over.
				setTeamShareLevel(team, NAME[r], summing and 1 or value(w, self.share[s], t))
				setTeamResource(team, NAME[r], value(w, self.held[s], t))
			end
		end
	end

	-- A rules parameter with no value at `t` had not been set yet, and the game
	-- keeps its own.
	local teamNames = self.teamNames
	local count = #teamNames
	if count > 0 then
		local setTeamRulesParam, teamValue = Spring.SetTeamRulesParam, self.teamValue
		for i = 1, #teams do
			for j = 1, count do
				local v = teamValue[(i - 1) * count + j]
				local now = v and w:sampleValue(v, t)
				if now then
					setTeamRulesParam(teams[i], teamNames[j], now)
				end
			end
		end
	end
	local gameNames = self.gameNames
	for j = 1, #gameNames do
		local v = self.gameValue[j]
		local now = v and w:sampleValue(v, t)
		if now then
			Spring.SetGameRulesParam(gameNames[j], now)
		end
	end
end

function Resources:resync() end

function Resources:remove() end

function Resources:place(t)
	-- The units stage has read the window of `t` already, and has said so when
	-- it cannot be read.
	local w = self.track:seek(t)
	if not w then
		self.window = nil
		return
	end
	if w ~= self.window then
		index(self, w)
	end
	self.t = t
	if self.rolled then
		settle(self, w, t)
	end
	local summing = self.reads and self.Spring.GetGameFrame() % PERIOD == 0
	if summing then
		if self.feeds then
			feed(self, w, t)
		end
		if self.shares then
			share(self, w, t)
		end
		self.rolled = true
	end
	apply(self, w, t, summing, self.post.arrives)
end

--- The player found that no call comes at the end of a frame (issue #4002).
function Resources:withoutAfterSim()
	self.context.report(
		"resources post",
		"GameFramePost does not reach the player, so what a team holds reads one frame of the playback's own economy off, its share level reads 1 on the frames the engine sums up on, and a team is given no room for the playback's own income, so what it wasted can read higher than the match's"
	)
end

--- The end of a simulation frame, after the engine's own economy and after it
-- has summed up (GameFramePost).
function Resources:afterSim()
	local w, t = self.window, self.t
	if not w then
		return
	end
	if self.rolled then
		settle(self, w, t)
	end
	apply(self, w, t, false, false)
end

return M
