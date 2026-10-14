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
-- A seek can need hundreds of units made or removed, and the engine takes the
-- time it takes for each (issue #3988). The stage removes at most `removeBudget`
-- units in a frame and makes at most `makeBudget`, and the rest wait for the
-- next frames. A removal costs the engine something other than a creation, so
-- each has its own budget. Removals come first: while any is left, nothing is
-- made, and the frame that does the last of them makes only as many as the part
-- of its removal budget it did not use leaves room for. A stage that has left
-- work says so with `unsettled`. `made` and `removed` are how many it did in the
-- frame, which the gadget tells its unsynced half, which times the frame and
-- works out the budgets (see coilbox_rewind_player.lua). Every frame works out
-- what is wanted at `t` from nothing, so a seek that arrives while another
-- settles needs no special care.
--
-- Which units a seek makes first follows the viewer (issue #4008). The gadget's
-- unsynced half sends the place on the ground the camera looks at, and the four
-- corners of the view on the ground when it has them. While a seek settles, the
-- units still to be made are put in order once: those inside the corners first,
-- and within each group the nearest the camera's place first. The order is
-- worked out again when a new view arrives, when another seek does and when
-- the window changes, and never in a frame of play. With no view the order is
-- the window's list.
--
-- A unit that a slow seek makes gets a short effect where it appears (issue
-- #4009). The stage only says which: a unit made in a later frame than the one
-- that showed the seek, while the seek's units are still arriving, inside the
-- view's corners, and not while the timeline's knob is being dragged. It asks
-- with `context.arrive`, and the gadget's unsynced half draws. A seek that is
-- shown in one frame, a removal and a unit that play brings in ask for none.
--
-- The game's adapter can hide a unit definition, which is then never created,
-- and can ask to be told when a unit is created and put in place (issue #3799).
-- Its hook can show the game's own effect, and says so by giving true.
--
-- The engine heals a unit by itself, and nothing in the engine switches that
-- off for one unit (issue #3986). CUnit::SlowUpdate adds `autoHeal`, and
-- `idleAutoHeal` once the unit has rested `idleTime` frames, to the health of a
-- unit that has less than its maximum. It does that after the gadgets' GameFrame
-- and before their GameFramePost, and nothing about it reaches a gadget. The
-- definitions that hold the numbers cannot be changed from Lua, and a game's
-- `gamedata/defs.lua` is one file that a depending game can only replace. So for
-- the stretch between the player's frame and its post frame, a wounded unit's
-- maximum is its health, and the engine finds nothing to heal. A builder's
-- repair stops on the same test (CUnit::AddBuildPower). `Units:afterSim` gives
-- the maximum back, so nothing else sees it, and checks health once more.
--
-- That rests on the engine calling back at the end of the frame, which an
-- engine before 105.1.1-2590 does not do and a game's gadget handler may not
-- pass on (issue #4002). The player finds out by whether the call came after
-- the frame before, and a unit is only held in a frame that follows one it came
-- after. Without the call no maximum is touched, and health the engine added is
-- taken off on the next frame, as it was before issue #3986.
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

--- The line for health that moved with nothing to hear of. A game's own
-- gadget that heals belongs in the game's adapter.
local HEALTH_MOVED = "the health of a unit of the track changed with no damage to hear of, by a gadget of the game or by something the player does not stop, and the player set it again. Later ones are not logged. A game's adapter can switch off a gadget that heals"

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
		-- The share of the frame a seek's ground used (coilbox_player_terrain.lua).
		share = context.share or { ground = 0 },
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
		-- A wounded unit whose maximum is its health until the frame is over,
		-- with the maximum it has to be given back and the health it was held at.
		held = {},
		fullHealth = {},
		holdAt = {},
		-- Whether any unit is held in this frame, and whether the engine calls
		-- back at the end of a frame, which the player finds out (issue #4002).
		holding = false,
		post = context.post,
		on = {},
		nanoframe = {},
		-- Serial numbers that could not be created, so they are not tried on every
		-- frame. A seek clears it.
		failed = {},
		-- Units somebody else created since the last frame.
		strangers = {},
		strangerCount = 0,
		-- The most units made and removed in a frame, how many were in this one,
		-- and whether the frame left some for the next. `removing` is whether a
		-- removal was left.
		makeBudget = math.huge,
		removeBudget = math.huge,
		made = 0,
		removed = 0,
		unsettled = false,
		removing = false,
		-- Whether a seek's removals are still being done, which go quietly in
		-- every frame they take.
		seeking = false,
		-- Whether a seek's units are still being made. It is what the view's
		-- order is for, so that a frame of play never sorts.
		arriving = false,
		-- Whether the frame that showed the last seek is over. A unit made after
		-- it, while the seek's units arrive, is one a viewer saw arrive late.
		late = false,
		-- Where the viewer looks: the camera's place on the ground, and the
		-- corners of the view on the ground, which `cornered` says are there.
		-- `viewed` is whether any of it is.
		viewed = false,
		cornered = false,
		view = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
		-- The units still to be made, as places in the window's lists, in the
		-- order to make them, with how many there are and whether the order has
		-- to be worked out again. `far` is a unit's distance from the camera's
		-- place, squared, and `inside` whether it is within the view's corners.
		order = {},
		orderCount = 0,
		orderStale = true,
		far = {},
		inside = {},
		nearer = nil,
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

--- Where the viewer looks, from the gadget's unsynced half: the camera's place
-- on the ground, and the four corners of the view on the ground in order round
-- it, or nothing for those when a corner is in the sky. With no `x` there is
-- no view, and units are made in the order of the window's list.
function Units:setView(x, z, corners)
	self.viewed = x ~= nil
	self.cornered = corners ~= nil
	local view = self.view
	if x then
		view[1], view[2] = x, z
	end
	if corners then
		for i = 1, 8 do
			view[i + 2] = corners[i]
		end
	end
	self.orderStale = true
end

--- Whether a place is within the corners of the view. Without corners every
-- place is.
function Units:inView(x, z)
	if not self.cornered then
		return true
	end
	local view = self.view
	-- The corners go round the view one way, so a place inside is on the same
	-- side of all four edges.
	local side = 0
	for i = 0, 3 do
		local ax, az = view[3 + i * 2], view[4 + i * 2]
		local j = (i + 1) % 4
		local bx, bz = view[3 + j * 2], view[4 + j * 2]
		local cross = (bx - ax) * (z - az) - (bz - az) * (x - ax)
		if cross ~= 0 then
			if side == 0 then
				side = cross > 0 and 1 or -1
			elseif (cross > 0) ~= (side > 0) then
				return false
			end
		end
	end
	return true
end

--- Sets the most units made in a frame and the most removed, each at least one.
-- With one number, both.
function Units:setBudget(make, remove)
	self.makeBudget = math.max(1, make)
	self.removeBudget = math.max(1, remove or make)
end

function Units:forget(serial, unitID)
	self.unitOf[serial] = nil
	self.serialOf[unitID] = nil
	self.maxHealth[serial] = nil
	self.health[serial] = nil
	self.held[serial] = nil
	self.fullHealth[serial] = nil
	self.holdAt[serial] = nil
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
		self.context.report("unit damaged", "a unit of the track was damaged, past the gadget that gives every hit no damage, so another gadget of the game overruled it. The player sets its health again. Later ones are not logged")
	end
end

--- Makes the maximum of a wounded unit its health, so that the engine's own
-- healing in the rest of the frame has nothing to heal. Only in a frame that
-- follows one the engine called back at the end of: with no such call nothing
-- would give the maximum back (issue #4002).
function Units:hold(serial, unitID)
	local health = self.health[serial]
	if not health or health >= 1 or not self.post.arrives then
		return
	end
	local Spring = self.Spring
	local now, max = Spring.GetUnitHealth(unitID)
	if not now or now >= max then
		return
	end
	self.fullHealth[serial] = max
	self.holdAt[serial] = now
	self.held[serial] = true
	self.holding = true
	Spring.SetUnitMaxHealth(unitID, now)
end

--- Gives a held unit its maximum back.
function Units:release(serial, unitID)
	self.held[serial] = false
	self.Spring.SetUnitMaxHealth(unitID, self.fullHealth[serial])
end

--- The end of a simulation frame, after the engine has healed what it could.
-- Every held unit has its maximum back and the health it was held at. Anything
-- that moved it in the meantime is put right.
--
-- In a frame that held nothing because the call was not yet known to come,
-- which the first frame is, the engine may have healed a wounded unit. Its
-- health is put back here without a word.
function Units:afterSim()
	local Spring, held, holdAt = self.Spring, self.held, self.holdAt
	if not self.post.arrives then
		local health, maxHealth, nanoframe = self.health, self.maxHealth, self.nanoframe
		for serial, unitID in next, self.unitOf do
			local wanted = health[serial]
			if wanted and wanted < 1 and not nanoframe[serial] and not held[serial] and Spring.GetUnitHealth(unitID) ~= wanted * maxHealth[serial] then
				local arg = self.healthArg
				arg.health = wanted * maxHealth[serial]
				Spring.SetUnitHealth(unitID, arg)
			end
		end
	end
	if not self.holding then
		return
	end
	self.holding = false
	for serial, unitID in next, self.unitOf do
		if held[serial] then
			self:release(serial, unitID)
			local now = Spring.GetUnitHealth(unitID)
			if now ~= holdAt[serial] then
				local arg = self.healthArg
				arg.health = holdAt[serial]
				Spring.SetUnitHealth(unitID, arg)
				self.context.report("health moved", HEALTH_MOVED)
			end
		end
	end
end

--- A frame ended and the engine did not call back, after frames in which it
-- did. Every unit that was held for that frame has its maximum back, so none is
-- left lowered. `Player:shutdown` uses it too.
function Units:afterSimMissed()
	if not self.holding then
		return
	end
	self.holding = false
	local held = self.held
	for serial, unitID in next, self.unitOf do
		if held[serial] then
			self:release(serial, unitID)
		end
	end
end

--- The player found that no call comes at the end of a frame.
function Units:withoutAfterSim()
	self.context.report(
		"health post",
		"GameFramePost does not reach the player, so a wounded unit keeps its maximum health, and health the engine's own healing adds in a frame is taken off again on the next"
	)
end

--- After a jump: what the engine has is checked against what the stage thinks
-- it has, and what could not be created is tried again.
function Units:resync()
	self.seeking = true
	self.arriving = true
	self.late = false
	self.orderStale = true
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
	-- The order is of places in the window's lists.
	self.orderStale = true
end

--- Takes away every unit that is not in the track at `t`. This runs for every
-- stage before anything is created, because after a seek a building may stand
-- where another stood earlier.
function Units:remove(t, clock)
	self.made, self.removed = 0, 0
	self.removing = false
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
	-- One a seek removes does not, in the frames after the seek's too.
	local loud = clock:watched() and not self.seeking
	local indexOf = self.indexOf
	local budget = self.removeBudget
	-- What the ground of a seek used of the frame comes off the share first.
	local ground = self.share.ground
	for serial, unitID in next, self.unitOf do
		local i = indexOf[serial]
		if not i or not w:unitExistsAt(i, t) then
			if ground + self.removed / budget >= 1 then
				self.removing = true
				break
			end
			self.removed = self.removed + 1
			self:destroy(serial, unitID, loud)
		end
	end

	local strangers = self.strangers
	local n = self.strangerCount
	while n > 0 and ground + self.removed / budget < 1 do
		self.removed = self.removed + 1
		self:evict(strangers[n])
		strangers[n] = nil
		n = n - 1
	end
	self.strangerCount = n
	if n > 0 then
		self.removing = true
	end
	if not self.removing then
		self.seeking = false
	end
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
	self.made = self.made + 1
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
	if self.context.on.holdFire then
		Spring.SetUnitUseWeapons(unitID, false, false)
	end
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
			-- The engine is trusted when it cannot be asked.
			local beingBuilt = true
			if self.context.on.rebuild then
				local _, _, building = Spring.GetUnitIsStunned(unitID)
				beingBuilt = building
			end
			if not beingBuilt then
				self.context.report("rebuild", "this engine keeps a finished unit finished when its build progress is set below 1, so the player destroys such a unit and creates it again. Engine 2025.03.9 and later do not need this. Later ones are not logged")
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
		-- The second test is for health that moved with no damage to hear of: a
		-- base game gadget can set health, and while the track's value stands
		-- still, as it does when paused, nothing else would put it back.
		-- Without the call at the end of a frame the engine's own healing is what
		-- moved it, which `Units:withoutAfterSim` has said.
		if self.health[serial] == health and self.post.arrives then
			self.context.report("health moved", HEALTH_MOVED)
		end
		local arg = self.healthArg
		arg.health = health * maxHealth
		Spring.SetUnitHealth(unitID, arg)
		self.health[serial] = health
	end

	-- A unit under construction cannot be switched on, so this waits for it.
	local on = status[3] % 2
	if self.context.on.onOff and self.on[serial] ~= on then
		self.on[serial] = on
		if (Spring.GetUnitIsActive(unitID) and 1 or 0) ~= on then
			local arg = self.onArg
			arg[1] = on
			Spring.GiveOrderToUnit(unitID, self.onOff, arg, 0)
		end
	end
	return unitID
end

--- Puts unit `i` of window `w` where the track has it at `t`, with its status,
-- and creates it first when `unitID` is nil. The transform and the status are
-- sampled here.
function Units:put(w, i, serial, unitID, t, clock)
	local transform, status = self.transform, self.status
	if not (w:sampleTransform(i, t, transform) and w:sampleStatus(i, t, status)) then
		return
	end
	local made = not unitID
	if unitID and self.held[serial] then
		self:release(serial, unitID)
	end
	if made then
		unitID = self:create(w, i, serial, status[2] < 1, t)
	end
	if unitID then
		unitID = self:applyStatus(w, i, serial, unitID, t)
	end
	if unitID then
		if not self.nanoframe[serial] then
			self:hold(serial, unitID)
		end
		self.MoveCtrl.SetPosition(unitID, transform[1], transform[2], transform[3])
		self.MoveCtrl.SetRotation(unitID, self.euler(transform[4], transform[5], transform[6], transform[7]))
		if made then
			local context = self.context
			local placed, arrive = context.hooks.unitPlaced, context.arrive
			local effect = self.late and self.arriving and not clock.dragging and arrive ~= nil and self:inView(transform[1], transform[3])
			local handled = placed and placed(unitID, self.defID[w.unitDef[i] + 1], t, clock, effect)
			if effect and not handled then
				arrive(unitID, transform[1], transform[2], transform[3], context.teamOf(w.unitTeam[i]))
			end
		end
	end
end

--- Works out the order to make the units still to come in: those inside the
-- view's corners first, and the nearest the camera's place first.
function Units:sortPending(w, t)
	local order, far, inside = self.order, self.far, self.inside
	local unitOf, failed, defID = self.unitOf, self.failed, self.defID
	local transform, view = self.transform, self.view
	local cx, cz = view[1], view[2]
	local serials = w.unitSerial
	local n = 0
	for i = 1, w.unitCount do
		local serial = serials[i]
		if not unitOf[serial] and not failed[serial] and defID[w.unitDef[i] + 1] and w:unitExistsAt(i, t) and w:sampleTransform(i, t, transform) then
			n = n + 1
			order[n] = i
			local dx, dz = transform[1] - cx, transform[3] - cz
			far[i] = dx * dx + dz * dz
			inside[i] = self:inView(transform[1], transform[3])
		end
	end
	for k = n + 1, self.orderCount do
		order[k] = nil
	end
	self.orderCount = n
	if not self.nearer then
		-- Made once. Two units as far are in the order of the window's list, so
		-- that the order is the same every time.
		self.nearer = function(a, b)
			if inside[a] ~= inside[b] then
				return inside[a]
			end
			if far[a] ~= far[b] then
				return far[a] < far[b]
			end
			return a < b
		end
	end
	table.sort(order, self.nearer)
	self.orderStale = false
end

--- Creates every unit of the track at `t` that is not there, as far as the
-- budget goes, and puts each one where the track has it. A unit the budget
-- leaves is made on a later frame, where the track has it then.
function Units:place(t, clock)
	local w = self.window
	self.unsettled = self.removing
	if not w then
		return
	end
	local makeBudget, removeBudget, defID = self.makeBudget, self.removeBudget, self.defID
	local unitOf, failed = self.unitOf, self.failed
	local ground = self.share.ground
	local serials = w.unitSerial
	-- While a seek's units arrive and the viewer's place is known, a unit to be
	-- made waits for the walk in the view's order below.
	local sorted = self.arriving and self.viewed
	local waiting = 0
	for i = 1, w.unitCount do
		if w:unitExistsAt(i, t) then
			local serial = serials[i]
			local unitID = unitOf[serial]
			if not unitID and not failed[serial] and defID[w.unitDef[i] + 1] and (sorted or self.removing or ground + self.removed / removeBudget + self.made / makeBudget >= 1) then
				-- Nothing is made while a removal is left, and what the frame has
				-- removed uses up its share of the time. A definition the game lacks
				-- costs nothing, so it is not held back.
				self.unsettled = true
				waiting = waiting + 1
			elseif unitID or not failed[serial] then
				self:put(w, i, serial, unitID, t, clock)
			end
		end
	end
	if sorted and waiting > 0 and not self.removing then
		if self.orderStale then
			self:sortPending(w, t)
		end
		local order = self.order
		for k = 1, self.orderCount do
			if ground + self.removed / removeBudget + self.made / makeBudget >= 1 then
				break
			end
			local i = order[k]
			local serial = serials[i]
			if not unitOf[serial] and not failed[serial] and w:unitExistsAt(i, t) then
				self:put(w, i, serial, nil, t, clock)
				waiting = waiting - 1
			end
		end
		-- A unit that play brought in since the order was worked out is not in
		-- it, so the order is worked out again for the next frame.
		if waiting > 0 and ground + self.removed / removeBudget + self.made / makeBudget < 1 then
			self.orderStale = true
		end
		self.unsettled = waiting > 0
	end
	if not self.unsettled then
		self.arriving = false
	end
	self.late = true
end

return M
