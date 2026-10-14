-- Coilbox rewind ghosts: the buildings a builder had queued, drawn as
-- translucent shapes (issue #3804).
--
-- The track holds every mobile builder's queue of buildings over time, and the
-- playback's units do not carry a queue, so nothing in the world shows one. This
-- reads the track itself, in the widget's own Lua state, and draws each queued
-- building where it would stand, in its team's colour. The time is the player's
-- `coilbox_rewind_frame`, so a seek, a step and play in either direction need
-- nothing more than reading it.
--
-- A queued building that has been started stays in the queue until it is
-- finished, and it is a unit in the track from the frame it is started on. So
-- an item is not drawn while a unit of its definition stands where it would
-- (within the snap of the build grid, see COVER). The track says what is where,
-- and the playback's world does not need to have caught up.
--
-- A frame of play allocates nothing. A window of the track is read when the time
-- crosses into one, which allocates, as it does in the player.
--
-- The engine is handed in as a table and nothing here reaches for a global of
-- it, so the tests run the same file on a stand-in.
--
-- Change this in the coilbox repository under lua/rewind-player/.

local M = {}

M.PREFIX = "COILBOX_REWIND_GHOSTS "

--- The player's parameter for the time, a frame of the track that can be a
-- fraction. It is only there when the player is.
M.FRAME = "coilbox_rewind_frame"

--- How far from a queued item's place a unit of its definition may stand and
-- still be that item. The engine snaps a build to a 16 elmo grid
-- (`CGameHelper::Pos2BuildPos`), which moves it by up to half a grid square on
-- each axis. The whole match's first extractor was queued at 480,8128 and stands
-- at 488,8136.
M.COVER = 8

--- A shape is turned a quarter for each facing, 0 being south, 1 east, 2 north
-- and 3 west, which is the way the engine turns a unit built with that facing.
M.FACING_DEGREES = 90

--- The name of the adapter's hook that draws a ghost in the game's own way, and
-- what a hook is called with.
M.HOOK = "drawQueuedBuilding"

--- Elmos in a square of a unit definition's footprint.
M.SQUARE = 8

--- How far above the ground the footprint is drawn, in elmos.
M.OUTLINE_LIFT = 2

--- The footprint's look: the width of its line in pixels, how much of the way
-- from the team's colour to white the line is, and the fill's opacity. A dark
-- team colour in a thin line was hard to see on the ground in the engine run
-- (issue #3804). They are design choices and not measurements.
M.LINE_WIDTH = 2
M.LIGHTEN = 0.4
M.FILL_ALPHA = 0.25

local Ghosts = {}
Ghosts.__index = Ghosts

--- Ghosts for an opened `track`. `engine` has `Spring`, `gl`, `UnitDefNames` and
-- `UnitDefs`, and `adapter`, the game's adapter table or nil.
function M.new(engine, track)
	local self = setmetatable({
		Spring = engine.Spring,
		gl = engine.gl,
		track = track,
		enabled = true,
		said = {},
		-- What is to be drawn, as parallel lists.
		count = 0,
		defs = {},
		teams = {},
		xs = {},
		zs = {},
		facings = {},
		floats = {},
		reds = {},
		greens = {},
		blues = {},
		hx = {},
		hz = {},
		GL = engine.GL,
		-- Whether the footprint is outlined on the ground, in the team's colour.
		outline = engine.outline == true,
		-- The window the lists below are for.
		window = nil,
		builders = {},
		builderCount = 0,
		seenFirst = {},
		seenCount = {},
		distinctOf = {},
		stampOf = {},
		stamp = 0,
		coverFirst = {},
		coverCount = {},
		coverUnit = {},
		events = {},
		eventCount = 0,
		eventCursor = 0,
		-- The time the lists are for, and whether they have to be made again.
		shown = nil,
		dirty = true,
		out = { 0, 0, 0, 0, 0, 0, 0 },
	}, Ghosts)
	self:lookUp(engine, track)
	local adapter = engine.adapter
	local hook = type(adapter) == "table" and type(adapter.hooks) == "table" and adapter.hooks[M.HOOK]
	if type(hook) == "function" then
		self.hook = hook
	end
	return self
end

function Ghosts:say(key, text)
	if not self.said[key] then
		self.said[key] = true
		self.Spring.Echo(M.PREFIX .. text)
	end
end

--- The engine's definition for each of the track's, by name. The track counts
-- definitions from 0. A name the game does not have is false and its buildings
-- are left out, with one line to say so.
function Ghosts:lookUp(engine, track)
	local names = track:info().unitDefs
	self.defOf = {}
	self.floatOf = {}
	self.halfX, self.halfZ = {}, {}
	for i = 1, #names do
		local found = engine.UnitDefNames[names[i]]
		if found then
			self.defOf[i - 1] = found.id
			local def = engine.UnitDefs[found.id]
			self.floatOf[i - 1] = def ~= nil and def.floatOnWater == true
			-- The footprint, in squares of 8 elmos (xsize is twice footprintX).
			self.halfX[i - 1] = (def and def.xsize or 4) * M.SQUARE / 2
			self.halfZ[i - 1] = (def and def.zsize or 4) * M.SQUARE / 2
		else
			self.defOf[i - 1] = false
			self.missing = (self.missing or 0) + 1
		end
	end
	if self.missing then
		self:say("defs", string.format("%d of the track's %d unit definitions are not in this game, so buildings of them are not drawn", self.missing, #names))
	end
end

--- Works out, for a window just read, which units have a queue, which queued
-- item is the same building as which, and which units stand where an item is.
function Ghosts:index(w)
	self.window = w
	local builders, count = self.builders, 0
	for i = 1, w.unitCount do
		if w.unitQueueCount[i] > 0 then
			count = count + 1
			builders[count] = i
			self.seenFirst[count], self.seenCount[count] = -1, -1
		end
	end
	self.builderCount = count

	-- The same building queued in two keys, or by two builders, is one.
	local items = #w.queueItemDef
	local distinctOf, ids, number = {}, {}, 0
	local dDef, dX, dZ = {}, {}, {}
	for j = 1, items do
		local key = w.queueItemDef[j] .. ":" .. w.queueItemX[j] .. ":" .. w.queueItemZ[j]
		local d = ids[key]
		if not d then
			number = number + 1
			d = number
			ids[key] = d
			dDef[d], dX[d], dZ[d] = w.queueItemDef[j], w.queueItemX[j], w.queueItemZ[j]
		end
		distinctOf[j] = d
	end
	self.distinctOf = distinctOf
	self.stampOf = {}
	self.stamp = 0

	-- Units of the definitions that are queued, and where each stands. A
	-- building does not move, so where it is when it first exists is where it is.
	local wanted = {}
	for d = 1, number do
		wanted[dDef[d]] = true
	end
	local byDef, out = {}, self.out
	for u = 1, w.unitCount do
		local def = w.unitDef[u]
		if wanted[def] and w:sampleTransform(u, w.unitFirstFrame[u], out) then
			local list = byDef[def]
			if not list then
				list = {}
				byDef[def] = list
			end
			list[#list + 1] = { u, out[1], out[3] }
		end
	end
	local coverFirst, coverCount, coverUnit, events = {}, {}, {}, {}
	local covers, eventCount = 0, 0
	local near = M.COVER
	for d = 1, number do
		coverFirst[d], coverCount[d] = covers + 1, 0
		local list = byDef[dDef[d]]
		for k = 1, list and #list or 0 do
			local standing = list[k]
			if math.abs(standing[2] - dX[d]) <= near and math.abs(standing[3] - dZ[d]) <= near then
				covers = covers + 1
				coverUnit[covers] = standing[1]
				coverCount[d] = coverCount[d] + 1
				events[eventCount + 1] = w.unitFirstFrame[standing[1]]
				events[eventCount + 2] = w.unitLastFrame[standing[1]] + 1
				eventCount = eventCount + 2
			end
		end
	end
	table.sort(events)
	self.coverFirst, self.coverCount, self.coverUnit = coverFirst, coverCount, coverUnit
	self.events, self.eventCount, self.eventCursor = events, eventCount, 0
	self.dirty = true
end

--- Whether a unit of the same building stands at queued item `d` at `frame`.
local function covered(self, d, frame)
	local w = self.window
	local first = self.coverFirst[d]
	for c = first, first + self.coverCount[d] - 1 do
		if w:unitExistsAt(self.coverUnit[c], frame) then
			return true
		end
	end
	return false
end

--- Makes the lists of what to draw at `frame` from the queues just read.
local function rebuild(self, frame)
	local w = self.window
	local defs, teams, xs, zs, facings, floats = self.defs, self.teams, self.xs, self.zs, self.facings, self.floats
	self.stamp = self.stamp + 1
	local stamp, stampOf = self.stamp, self.stampOf
	local count = 0
	for b = 1, self.builderCount do
		local n = self.seenCount[b]
		if n > 0 then
			local first = self.seenFirst[b]
			local team = w.unitTeam[self.builders[b]]
			for j = first, first + n - 1 do
				local d = self.distinctOf[j]
				if stampOf[d] ~= stamp then
					stampOf[d] = stamp
					local trackDef = w.queueItemDef[j]
					local def = self.defOf[trackDef]
					if def and not covered(self, d, frame) then
						count = count + 1
						defs[count], teams[count] = def, team
						xs[count], zs[count] = w.queueItemX[j], w.queueItemZ[j]
						local facing = w.queueItemFacing[j]
						facings[count], floats[count] = facing, self.floatOf[trackDef]
						-- A building turned a quarter has its sides the other way round.
						local hx, hz = self.halfX[trackDef], self.halfZ[trackDef]
						if facing % 2 == 1 then
							hx, hz = hz, hx
						end
						self.hx[count], self.hz[count] = hx, hz
						if self.outline then
							local r, g, b = self.Spring.GetTeamColor(team)
							local lighten = M.LIGHTEN
							self.reds[count] = r + (1 - r) * lighten
							self.greens[count] = g + (1 - g) * lighten
							self.blues[count] = b + (1 - b) * lighten
						end
					end
				end
			end
		end
	end
	self.count = count
end

--- Brings the lists to the player's time. Cheap when the time has not moved.
function Ghosts:update()
	local frame = self.Spring.GetGameRulesParam(M.FRAME)
	if type(frame) ~= "number" then
		self.count = 0
		self.shown = nil
		return
	end
	if frame == self.shown and not self.dirty then
		return
	end
	local track = self.track
	local k = track:windowOf(frame)
	local w = self.window
	if not w or w.index ~= k then
		local loaded, why = track:loadWindow(k)
		if not loaded then
			self:say("window" .. k, "window " .. k .. " of the track could not be read, so no queued buildings are drawn there: " .. tostring(why))
			self.window = nil
			self.count = 0
			self.shown = nil
			return
		end
		self:index(loaded)
		w = loaded
	end

	local changed = self.dirty
	self.dirty = false
	local seenFirst, seenCount, builders = self.seenFirst, self.seenCount, self.builders
	for b = 1, self.builderCount do
		local u = builders[b]
		local first, n = 0, 0
		if w:unitExistsAt(u, frame) then
			first, n = w:sampleQueue(u, frame)
		end
		if first ~= seenFirst[b] or n ~= seenCount[b] then
			seenFirst[b], seenCount[b] = first, n
			changed = true
		end
	end
	-- A unit that stands where an item is begins or ends on some frame, and then
	-- the item is covered or is not.
	local events, cursor, total = self.events, self.eventCursor, self.eventCount
	while cursor < total and events[cursor + 1] <= frame do
		cursor = cursor + 1
	end
	while cursor > 0 and events[cursor] > frame do
		cursor = cursor - 1
	end
	if cursor ~= self.eventCursor then
		self.eventCursor = cursor
		changed = true
	end
	self.shown = frame
	if changed then
		rebuild(self, frame)
	end
end

--- The corners of a footprint `hx` and `hz` either side of `x, z`, for
-- `gl.BeginEnd`. A function made once, so that a draw makes nothing.
local function footprint(vertex, x, y, z, hx, hz)
	vertex(x - hx, y, z - hz)
	vertex(x + hx, y, z - hz)
	vertex(x + hx, y, z + hz)
	vertex(x - hx, y, z + hz)
end

--- Draws what `update` made, from `widget:DrawWorld`.
function Ghosts:draw()
	if not self.enabled then
		return
	end
	self:update()
	local count = self.count
	if count == 0 then
		return
	end
	local gl, ground = self.gl, self.Spring.GetGroundHeight
	local defs, teams, xs, zs, facings, floats = self.defs, self.teams, self.xs, self.zs, self.facings, self.floats
	-- UnitShape wants the model view matrix, and a widget's world drawing is not
	-- always left on it.
	gl.MatrixMode(self.GL.MODELVIEW)
	if self.outline and not self.hook then
		local lift, GL = M.OUTLINE_LIFT, self.GL
		gl.Blending(true)
		gl.LineWidth(M.LINE_WIDTH)
		for k = 1, count do
			local x, z = xs[k], zs[k]
			local y = ground(x, z)
			if floats[k] and y < 0 then
				y = 0
			end
			local r, g, b = self.reds[k], self.greens[k], self.blues[k]
			gl.Color(r, g, b, M.FILL_ALPHA)
			gl.BeginEnd(GL.TRIANGLE_FAN, footprint, gl.Vertex, x, y + lift, z, self.hx[k], self.hz[k])
			gl.Color(r, g, b, 1)
			gl.BeginEnd(GL.LINE_LOOP, footprint, gl.Vertex, x, y + lift, z, self.hx[k], self.hz[k])
		end
		gl.LineWidth(1)
		gl.Color(1, 1, 1, 1)
	end
	for k = 1, count do
		local x, z = xs[k], zs[k]
		local y = ground(x, z)
		-- A floating building rides on the water and does not sink below it.
		if floats[k] and y < 0 then
			y = 0
		end
		gl.PushMatrix()
		local drawn = false
		if self.hook then
			local ok, err = pcall(self.hook, defs[k], teams[k], x, y, z, facings[k])
			if ok then
				drawn = true
			else
				self.hook = nil
				self:say("hook", "the adapter's " .. M.HOOK .. " hook raised and is switched off for the rest of the run: " .. tostring(err))
			end
		end
		if not drawn then
			gl.Translate(x, y, z)
			gl.Rotate(facings[k] * M.FACING_DEGREES, 0, 1, 0)
			-- Without its raw state UnitShape pops the matrix and pushes a copy of
			-- the one below (CModelDrawerHelper::DIDResetPrevModelView), which
			-- drops the transform above. A push of its own keeps it.
			gl.PushMatrix()
			gl.UnitShape(defs[k], teams[k], false, false, false)
			gl.PopMatrix()
		end
		gl.PopMatrix()
	end
end

--- Switches the ghosts on or off.
function Ghosts:setEnabled(on)
	if on ~= self.enabled then
		self.enabled = on
		self.dirty = true
	end
end

function Ghosts:toggle()
	self:setEnabled(not self.enabled)
	return self.enabled
end

--- A text command, as `widget:TextCommand` gets it. `rewindghosts` switches
-- them over and `rewindghosts on` or `off` sets them. Gives whether it was one.
function Ghosts:textCommand(command)
	local word, argument = command:match("^(%S+)%s*(%S*)")
	if word ~= "rewindghosts" then
		return false
	end
	if argument == "on" then
		self:setEnabled(true)
	elseif argument == "off" then
		self:setEnabled(false)
	else
		self:toggle()
	end
	return true
end

--- What to remember for next time.
function Ghosts:config()
	return { show = self.enabled }
end

--- Takes back what `config` gave. Anything else in it is ignored.
function Ghosts:setConfig(data)
	if type(data) == "table" and type(data.show) == "boolean" then
		self:setEnabled(data.show)
	end
end

return M
