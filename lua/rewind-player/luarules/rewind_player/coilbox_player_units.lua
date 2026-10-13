-- Coilbox rewind player: the units stage.
--
-- At a time `t` it makes the engine's units the track's: a unit alive at `t`
-- exists, under move control, at the recorded place and rotation, with the
-- recorded health, build progress and on or off state, and every other unit is
-- gone. It simulates nothing, so `t` can be any frame in any order.
--
-- The engine chooses unit ids. A destroyed id cannot be asked for again at once
-- (issue #3791), so the stage keeps a map from a track's serial number, which is
-- what names a unit across windows, to the id the engine gave.
--
-- A frame of play allocates nothing here. Samples go into two tables made once,
-- the tables handed to the engine are made once and written to, and the units
-- are walked with `next`, because synced `pairs` makes a closure for each call.
--
-- The game's adapter can hide a unit definition, which is then never created,
-- and can ask to be told when a unit is created and put in place (issue #3799).
--
-- Three things the engine or the base game does to a unit are undone here and
-- not prevented, because nothing can prevent them:
--
-- - A nanoframe nobody is building decays, and the engine kills it when its
--   progress or its health reaches zero (CUnit::SlowUpdate). Lua cannot say a
--   unit is being built. So a unit under construction has both set on every
--   frame, and neither goes below one step of that decay.
-- - On an engine before 2025.03.9, `Spring.SetUnitHealth` with a `build` below 1
--   leaves a finished unit finished. The stage asks the engine afterwards, and
--   destroys the unit and creates it as a nanoframe when it is still finished.
-- - A unit the base game destroys is created again on the next frame, and a
--   unit the base game creates is removed on the next frame.

local M = {}

local Units = {}
Units.__index = Units

--- The steps health and build progress are stored in (the format page's status
-- keys). One more than the decay is the least the stage can add to it.
local STEPS = 65535

--- `context` is the player's (see coilbox_player.lua). `rotation` is
-- coilbox_player_rotation.lua.
function M.new(context, rotation)
	local Spring, Game = context.Spring, context.Game
	local names = context.info.unitDefs
	local defID, floor = {}, {}
	-- Definitions the game's adapter hides are treated as ones the game does not
	-- have, without the line about it, since leaving them out is the point.
	local hidden = context.adapter and context.adapter.hiddenUnits
	for i = 1, #names do
		local def = context.UnitDefNames[names[i]]
		if hidden and hidden[names[i]:lower()] then
			def = nil
		end
		defID[i] = def and def.id or false
		-- What one pass of decay takes off progress, and off health as a part of
		-- the maximum.
		floor[i] = 0
		if def and Game.constructionDecay then
			floor[i] = 1 / math.max(0.001, def.buildTime * Game.constructionDecaySpeed) + 1 / STEPS
		end
		if not def and not (hidden and hidden[names[i]:lower()]) then
			context.report("unit " .. names[i], "the game has no unit called " .. names[i] .. ", so the track's units of that kind are left out")
		end
	end
	return setmetatable({
		context = context,
		track = context.track,
		Spring = Spring,
		MoveCtrl = Spring.MoveCtrl,
		euler = rotation.euler,
		names = names,
		defID = defID,
		floor = floor,
		onOff = context.CMD.ONOFF,
		-- The window the index below is for, or nil when it could not be read.
		window = nil,
		badWindow = nil,
		-- A unit's place in the current window's lists, by serial number.
		indexOf = {},
		-- The engine's id for a serial number, and back.
		unitOf = {},
		serialOf = {},
		-- What the engine was last told, by serial number. Health and on are nil
		-- when the engine has to be told again.
		maxHealth = {},
		health = {},
		on = {},
		nanoframe = {},
		-- Serial numbers that could not be created, so they are not tried on every
		-- frame. A seek clears it.
		failed = {},
		-- Units somebody else created since the last frame.
		strangers = {},
		strangerCount = 0,
		creating = false,
		destroying = false,
		lostReported = false,
		transform = { 0, 0, 0, 0, 0, 0, 0 },
		status = { 0, 0, 0 },
		healthArg = { health = 0 },
		buildArg = { health = 0, build = 0 },
		onArg = { 0 },
	}, Units)
end

function Units:forget(serial, unitID)
	self.unitOf[serial] = nil
	self.serialOf[unitID] = nil
	self.maxHealth[serial] = nil
	self.health[serial] = nil
	self.on[serial] = nil
	self.nanoframe[serial] = nil
end

--- Destroys a unit of the track. `loud` is with the game's death effect, and
-- quiet leaves nothing and shows nothing.
function Units:destroy(serial, unitID, loud)
	self.destroying = true
	self.Spring.DestroyUnit(unitID, false, not loud)
	self.destroying = false
	self:forget(serial, unitID)
end

--- Destroys a unit that is not the track's, quietly.
function Units:evict(unitID)
	local Spring = self.Spring
	if self.serialOf[unitID] or not Spring.ValidUnitID(unitID) or Spring.GetUnitIsDead(unitID) then
		return
	end
	self.destroying = true
	Spring.DestroyUnit(unitID, false, true)
	self.destroying = false
end

--- The engine created a unit. One the stage did not ask for goes on the next
-- frame, since destroying a unit from inside its own creation is asking for
-- trouble from every gadget that has yet to hear of it.
function Units:created(unitID)
	if self.creating then
		return
	end
	local n = self.strangerCount + 1
	self.strangerCount = n
	self.strangers[n] = unitID
	self.context.report("unit stranger", "a unit was created that the track does not have, by the map or the base game. The player removes such a unit on the next frame. Later ones are not logged")
end

--- The engine destroyed a unit. When it is one of the track's and the stage did
-- not ask, the base game did, and the unit is made again on the next frame.
function Units:destroyed(unitID)
	local serial = self.serialOf[unitID]
	if not serial or self.destroying then
		return
	end
	self:forget(serial, unitID)
	if not self.lostReported then
		self.lostReported = true
		self.context.report("unit lost", "the base game destroyed a unit the track has alive (unit " .. unitID .. "). The player makes such a unit again on the next frame")
	end
end

--- Something damaged a unit in spite of the gadget. Its health is set again on
-- the next frame.
function Units:damaged(unitID)
	local serial = self.serialOf[unitID]
	if serial then
		self.health[serial] = nil
	end
end

--- After a jump: what the engine has is checked against what the stage thinks
-- it has, and what could not be created is tried again.
function Units:resync()
	local Spring = self.Spring
	local failed = self.failed
	for serial in next, failed do
		failed[serial] = nil
	end
	for serial, unitID in next, self.unitOf do
		if not Spring.ValidUnitID(unitID) or Spring.GetUnitIsDead(unitID) then
			self:forget(serial, unitID)
		end
	end
	local all = Spring.GetAllUnits()
	for i = 1, #all do
		self:evict(all[i])
	end
end

--- Makes `w` the window the index is for.
local function index(self, w)
	local indexOf = self.indexOf
	for serial in next, indexOf do
		indexOf[serial] = nil
	end
	local serials = w.unitSerial
	for i = 1, w.unitCount do
		indexOf[serials[i]] = i
	end
	self.window = w
end

--- Takes away every unit that is not in the track at `t`. This runs for every
-- stage before anything is created, because after a seek a building may stand
-- where another stood earlier.
function Units:remove(t, clock)
	local track = self.track
	local w, why = track:seek(t)
	if not w then
		-- The world is left as it was until a window reads.
		self.window = nil
		local k = track:windowOf(t)
		if self.badWindow ~= k then
			self.badWindow = k
			self.context.report("window " .. k, "the units of frame " .. t .. " cannot be read (" .. tostring(why) .. "), so they are left as they were")
		end
		return
	end
	if w ~= self.window then
		index(self, w)
	end

	-- A unit that dies while somebody watches dies with the game's death effect.
	local loud = clock:watched()
	local indexOf = self.indexOf
	for serial, unitID in next, self.unitOf do
		local i = indexOf[serial]
		if not i or not w:unitExistsAt(i, t) then
			self:destroy(serial, unitID, loud)
		end
	end

	local strangers = self.strangers
	for n = self.strangerCount, 1, -1 do
		self:evict(strangers[n])
		strangers[n] = nil
	end
	self.strangerCount = 0
end

--- Creates unit `i` of window `w` at the transform already sampled, and gives
-- its id, or nil when the engine gave none.
function Units:create(w, i, serial, nanoframe, t)
	local Spring = self.Spring
	local def = w.unitDef[i] + 1
	local id = self.defID[def]
	if not id then
		-- Reported by name when the stage was made.
		self.failed[serial] = true
		return nil
	end
	local team = self.context.teamOf(w.unitTeam[i])
	local at = self.transform
	self.creating = true
	-- The ground is the track's, so the engine is not to flatten it.
	local unitID = Spring.CreateUnit(id, at[1], at[2], at[3], 0, team, nanoframe, false)
	self.creating = false
	if not unitID then
		-- A dead team and a full one both give nothing and raise nothing.
		self.failed[serial] = true
		self.context.report(
			"create " .. team,
			"Spring.CreateUnit gave nothing for " .. self.names[def] .. " on team " .. team .. " at frame " .. t
				.. ". The team is dead or at its unit limit. Its units are tried again after the next seek"
		)
		return nil
	end
	self.MoveCtrl.Enable(unitID)
	-- Weapons never fire. This also stops them aiming, which issue #3796 sets
	-- from the track.
	Spring.SetUnitUseWeapons(unitID, false, false)
	local _, maxHealth = Spring.GetUnitHealth(unitID)
	self.unitOf[serial] = unitID
	self.serialOf[unitID] = serial
	self.maxHealth[serial] = maxHealth
	self.nanoframe[serial] = nanoframe
	return unitID
end

--- Gives the engine the status already sampled for unit `i`. It gives the
-- unit's id, which is a new one when the unit had to be created again.
function Units:applyStatus(w, i, serial, unitID, t)
	local Spring = self.Spring
	local status = self.status
	local health, build = status[1], status[2]
	local maxHealth = self.maxHealth[serial]

	if build < 1 then
		local floor = self.floor[w.unitDef[i] + 1]
		if build < floor then
			build = floor
		end
		if health < floor then
			health = floor
		end
		if not self.nanoframe[serial] then
			-- Its health is told with its progress below, and has to be told again
			-- when it is finished.
			self.health[serial] = nil
		end
		local arg = self.buildArg
		arg.health, arg.build = health * maxHealth, build
		Spring.SetUnitHealth(unitID, arg)
		if not self.nanoframe[serial] then
			local _, _, beingBuilt = Spring.GetUnitIsStunned(unitID)
			if not beingBuilt then
				self:destroy(serial, unitID, false)
				unitID = self:create(w, i, serial, true, t)
				if not unitID then
					return nil
				end
				Spring.SetUnitHealth(unitID, arg)
			end
			self.nanoframe[serial] = true
		end
		return unitID
	end

	-- The engine kills a unit with no health left the next time anything hits
	-- it, for no damage too (CUnit::DoDamage), and a shot of the track that
	-- lands hits it. A unit the track has alive keeps one step of health.
	if health < 1 / STEPS then
		health = 1 / STEPS
	end

	if self.nanoframe[serial] then
		local arg = self.buildArg
		arg.health, arg.build = health * maxHealth, 1
		Spring.SetUnitHealth(unitID, arg)
		self.nanoframe[serial] = false
		self.health[serial] = health
	elseif self.health[serial] ~= health or Spring.GetUnitHealth(unitID) ~= health * maxHealth then
		-- The second test is for health that moved with no damage to hear of: the
		-- engine heals an idle unit and a base game gadget can set health, and
		-- while the track's value stands still, as it does when paused, nothing
		-- else would put it back.
		local arg = self.healthArg
		arg.health = health * maxHealth
		Spring.SetUnitHealth(unitID, arg)
		self.health[serial] = health
	end

	-- A unit under construction cannot be switched on, so this waits for it.
	local on = status[3] % 2
	if self.on[serial] ~= on then
		self.on[serial] = on
		if (Spring.GetUnitIsActive(unitID) and 1 or 0) ~= on then
			local arg = self.onArg
			arg[1] = on
			Spring.GiveOrderToUnit(unitID, self.onOff, arg, 0)
		end
	end
	return unitID
end

--- Creates every unit of the track at `t` that is not there, and puts each one
-- where the track has it.
function Units:place(t, clock)
	local w = self.window
	if not w then
		return
	end
	local unitOf, failed = self.unitOf, self.failed
	local transform, status = self.transform, self.status
	local MoveCtrl, euler = self.MoveCtrl, self.euler
	local placed = self.context.hooks.unitPlaced
	local serials = w.unitSerial
	for i = 1, w.unitCount do
		if w:unitExistsAt(i, t) then
			local serial = serials[i]
			local unitID = unitOf[serial]
			if (unitID or not failed[serial]) and w:sampleTransform(i, t, transform) and w:sampleStatus(i, t, status) then
				local made = not unitID
				if made then
					unitID = self:create(w, i, serial, status[2] < 1, t)
				end
				if unitID then
					unitID = self:applyStatus(w, i, serial, unitID, t)
				end
				if unitID then
					MoveCtrl.SetPosition(unitID, transform[1], transform[2], transform[3])
					MoveCtrl.SetRotation(unitID, euler(transform[4], transform[5], transform[6], transform[7]))
					if made and placed then
						placed(unitID, self.defID[w.unitDef[i] + 1], t, clock)
					end
				end
			end
		end
	end
end

return M
