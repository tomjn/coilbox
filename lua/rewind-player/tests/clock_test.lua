-- The player's clock: the time it holds, how a simulation frame moves it, and
-- the messages that change it. The actions are the ones in the replay page's
-- key table (src/content/replayMapView/timelineKeys.ts), and the way play,
-- reverse and seek behave is src/content/replayMapView/playback.ts.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local Clock = t.load("coilbox_player_clock.lua", t.syncedEnv())

local function clock()
	return Clock.new(100, 1000)
end

--- A clock that has taken its first frame, which is a jump to where it starts.
local function running()
	local c = clock()
	c:advance()
	return c
end

local function send(c, text)
	return c:message(Clock.PREFIX .. text)
end

-- Where it starts.

do
	local c = clock()
	t.same("it starts on the first frame", c.frame, 100)
	t.same("it starts playing", c.playing, true)
	t.same("it starts going forward", c.direction, 1)
	t.same("it starts at the match's own speed", c.speed, 1)
	c:advance()
	t.same("the first frame shows the start and does not move", c.frame, 100)
	t.same("the first frame is a jump", c.jumped, true)
	c:advance()
	t.same("the next frame plays one frame on", c.frame, 101)
	t.same("a played frame is not a jump", c.jumped, false)
end

-- Playing.

do
	local c = running()
	send(c, "speed 4")
	c:advance()
	t.same("at 4x a frame moves 4 frames", c.frame, 104)
	send(c, "speed 0.5")
	c:advance()
	c:advance()
	t.same("at 0.5x two frames move one", c.frame, 105)
	send(c, "direction -1")
	c:advance()
	t.same("backward at 0.5x", c.frame, 104.5)
	t.same("changing direction does not pause", c.playing, true)
end

do
	local c = running()
	send(c, "seek 998")
	c:advance()
	send(c, "speed 32")
	c:advance()
	t.same("it stops on the last frame", c.frame, 1000)
	t.same("and pauses there", c.playing, false)
	c:advance()
	t.same("a paused clock stays", c.frame, 1000)

	send(c, "play")
	c:advance()
	t.same("play at the end it would play into starts again from the other end", c.frame, 100)
	t.same("that is a jump", c.jumped, true)
	t.same("and it is playing", c.playing, true)

	send(c, "reverse")
	c:advance()
	t.same("reverse at the first frame starts from the last", c.frame, 1000)
	t.same("going backward", c.direction, -1)
	send(c, "seek 101")
	c:advance()
	send(c, "speed 2")
	c:advance()
	t.same("backward it stops on the first frame", c.frame, 100)
	t.same("and pauses there too", c.playing, false)
end

-- Every action in the key table.

do
	local c = running()
	send(c, "toggle")
	t.same("toggle pauses a playing clock", c.playing, false)
	send(c, "toggle")
	t.same("toggle plays a paused one", c.playing, true)
	send(c, "pause")
	t.same("pause", c.playing, false)

	send(c, "reverse")
	t.same("reverse plays the other way", c.direction, -1)
	t.same("reverse starts a paused clock", c.playing, true)
	send(c, "pause")
	send(c, "play 1")
	t.same("play with a direction takes it", c.direction, 1)

	send(c, "pause")
	send(c, "seek 400")
	c:advance()
	send(c, "step 30")
	t.same("forward 1 second is 30 frames", c.frame, 430)
	send(c, "step -300")
	t.same("back 10 seconds is 300 frames", c.frame, 130)
	send(c, "step -300")
	t.same("a step is held inside the match", c.frame, 100)
	send(c, "step 1")
	t.same("forward one frame", c.frame, 101)
	send(c, "step -1")
	t.same("back one frame", c.frame, 100)
	t.same("a step does not start a paused clock", c.playing, false)
	c:advance()
	t.same("a step is a jump", c.jumped, true)

	send(c, "seek 5000")
	t.same("a seek past the end is the last frame", c.frame, 1000)
	send(c, "seek -3")
	t.same("a seek before the start is the first frame", c.frame, 100)
	send(c, "seek 250.5")
	t.same("a seek can land between two frames", c.frame, 250.5)
end

do
	local c = running()
	local seen = {}
	for _ = 1, 8 do
		send(c, "faster")
		seen[#seen + 1] = c.speed
	end
	t.same("faster walks up the speeds and stops at 32x", table.concat(seen, " "), "2 4 8 16 32 32 32 32")
	seen = {}
	for _ = 1, 8 do
		send(c, "slower")
		seen[#seen + 1] = c.speed
	end
	t.same("slower walks down and stops at 0.5x", table.concat(seen, " "), "16 8 4 2 1 0.5 0.5 0.5")
	for _, speed in ipairs({ 0.5, 1, 2, 4, 8, 16, 32 }) do
		t.same("speed " .. speed .. " is taken", send(c, "speed " .. speed), true)
		t.same("speed " .. speed .. " is set", c.speed, speed)
	end
end

-- What is refused.

do
	local c = running()
	local function refused(name, text, needle)
		local before = { c.frame, c.playing, c.direction, c.speed }
		local ok, why = send(c, text)
		t.same(name .. " is refused", ok, false)
		t.check(name .. " says why", type(why) == "string" and why:find(needle, 1, true) ~= nil, why)
		t.check(
			name .. " changes nothing",
			before[1] == c.frame and before[2] == c.playing and before[3] == c.direction and before[4] == c.speed
		)
	end
	refused("a speed off the list", "speed 3", "0.5, 1, 2, 4, 8, 16, 32")
	refused("a speed that is not a number", "speed fast", "speed")
	refused("a seek with no frame", "seek", "seek")
	refused("a seek to no number", "seek nan", "seek")
	refused("a seek to infinity", "seek inf", "seek")
	refused("a direction that is not one", "direction 2", "1 or -1")
	refused("a play with a bad direction", "play 0", "1 or -1")
	refused("a step of no number", "step back", "step")
	refused("a command it does not know", "rewind", "rewind")

	t.same("a message for something else is not the clock's", c:message("some_other_gadget:seek 5"), nil)
	t.same("an empty message is not the clock's", c:message(""), nil)
end

t.report()
