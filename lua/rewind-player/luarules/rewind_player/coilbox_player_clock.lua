-- Coilbox rewind player: the time the player holds, and what changes it.
--
-- The clock has a frame of the track, whether it is playing, which way and how
-- fast. `advance` is called once for every simulation frame and moves the frame
-- by direction times speed. `message` takes the text of a Lua message and
-- changes the clock. Nothing here touches the engine, so the same file runs in
-- the tests.
--
-- The actions are those of the replay page's timeline
-- (src/content/replayMapView/playback.ts), so that the two behave the same way:
-- playing into an end stops there, and playing again from that end starts from
-- the other one.
--
-- A frame can be a fraction, at half speed and after a seek to one.

local M = {}

--- What a message for the player starts with. `gadget:RecvLuaMsg` is given
-- every gadget's and widget's messages.
M.PREFIX = "coilbox_rewind:"

--- The speeds the timeline offers, as multiples of the match's own.
M.SPEEDS = { 0.5, 1, 2, 4, 8, 16, 32 }

local SPEED_LIST = table.concat(M.SPEEDS, ", ")

local Clock = {}
Clock.__index = Clock

--- A clock for a track whose frames run from `first` to `last`. It starts on
-- the first frame, playing forward at the match's own speed.
function M.new(first, last)
	return setmetatable({
		first = first,
		last = last,
		frame = first,
		playing = true,
		direction = 1,
		speed = 1,
		-- Whether the frame the last `advance` left was reached by a jump and not
		-- by playing. The first frame shown is one.
		jumped = true,
		-- A jump that no `advance` has shown yet.
		pending = true,
	}, Clock)
end

--- One simulation frame. A jump made since the last one is shown as it is, and
-- play goes on from it on the next frame.
function Clock:advance()
	if self.pending then
		self.pending = false
		self.jumped = true
		return
	end
	self.jumped = false
	if not self.playing then
		return
	end
	local frame = self.frame + self.direction * self.speed
	if self.direction == 1 and frame >= self.last then
		frame = self.last
		self.playing = false
	elseif self.direction == -1 and frame <= self.first then
		frame = self.first
		self.playing = false
	end
	self.frame = frame
end

--- Jumps to `frame`, held inside the track.
function Clock:seek(frame)
	if frame < self.first then
		frame = self.first
	elseif frame > self.last then
		frame = self.last
	end
	self.frame = frame
	self.pending = true
end

--- Plays in `direction`, or the way it last played. From the other end when
-- the clock is already at the end it would play into.
function Clock:play(direction)
	direction = direction or self.direction
	if direction == 1 and self.frame >= self.last then
		self:seek(self.first)
	elseif direction == -1 and self.frame <= self.first then
		self:seek(self.last)
	end
	self.direction = direction
	self.playing = true
end

--- A number a message carried, or nil. `tonumber` reads "nan" and "inf".
local function number(text)
	local n = tonumber(text)
	if n and n == n and n > -math.huge and n < math.huge then
		return n
	end
end

local function direction(text)
	local n = number(text)
	if n == 1 or n == -1 then
		return n
	end
end

--- Where a speed is in the list, or nil.
local function speedIndex(speed)
	for i = 1, #M.SPEEDS do
		if M.SPEEDS[i] == speed then
			return i
		end
	end
end

local COMMANDS = {}

function COMMANDS.seek(clock, argument)
	local frame = number(argument)
	if not frame then
		return false, "seek needs a frame, and got \"" .. argument .. "\""
	end
	clock:seek(frame)
	return true
end

--- Moves by a number of frames, as the arrow keys and the frame keys do. It
-- neither starts nor stops play.
function COMMANDS.step(clock, argument)
	local frames = number(argument)
	if not frames then
		return false, "step needs a number of frames, and got \"" .. argument .. "\""
	end
	clock:seek(clock.frame + frames)
	return true
end

function COMMANDS.play(clock, argument)
	local way
	if argument ~= "" then
		way = direction(argument)
		if not way then
			return false, "play takes a direction of 1 or -1, and got \"" .. argument .. "\""
		end
	end
	clock:play(way)
	return true
end

function COMMANDS.pause(clock)
	clock.playing = false
	return true
end

function COMMANDS.toggle(clock)
	if clock.playing then
		clock.playing = false
	else
		clock:play()
	end
	return true
end

--- Plays the other way, starting if the clock was paused.
function COMMANDS.reverse(clock)
	clock:play(-clock.direction)
	return true
end

--- Sets the way play goes and leaves playing or paused as it was.
function COMMANDS.direction(clock, argument)
	local way = direction(argument)
	if not way then
		return false, "direction is 1 or -1, and got \"" .. argument .. "\""
	end
	clock.direction = way
	return true
end

function COMMANDS.speed(clock, argument)
	local speed = number(argument)
	if not speed or not speedIndex(speed) then
		return false, "speed is one of " .. SPEED_LIST .. ", and got \"" .. argument .. "\""
	end
	clock.speed = speed
	return true
end

function COMMANDS.faster(clock)
	clock.speed = M.SPEEDS[math.min(#M.SPEEDS, speedIndex(clock.speed) + 1)]
	return true
end

function COMMANDS.slower(clock)
	clock.speed = M.SPEEDS[math.max(1, speedIndex(clock.speed) - 1)]
	return true
end

--- Takes a Lua message. It gives nil for a message that is not the player's,
-- true for one that was done, and false and the reason for one that was
-- refused. A refused message changes nothing.
function Clock:message(text)
	if text:sub(1, #M.PREFIX) ~= M.PREFIX then
		return nil
	end
	local command, argument = text:match("^(%a+) ?(.*)$", #M.PREFIX + 1)
	local run = command and COMMANDS[command]
	if not run then
		return false, "there is no command \"" .. text:sub(#M.PREFIX + 1) .. "\""
	end
	return run(self, argument)
end

return M
