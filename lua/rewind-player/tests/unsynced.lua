-- A stand-in for what the unsynced half of the player gadget takes from the
-- engine: the timers, the Lua message, the camera and the drawing calls. Each
-- call follows the engine source it names, as far as the gadget depends on it.
--
-- `M.new(clock)` gives the stand-in. `clock.now` is the time in milliseconds
-- that the timers read. With `clock.micros` set the engine has
-- `Spring.GetTimerMicros` and the timers read microseconds. `clock.without` is
-- a set of the `Spring` calls an older engine lacks. The messages sent are
-- collected in `clock.messages` and the lines logged in `e.lines`. The view's
-- messages are collected apart, in `clock.views`, so that a test of the budget
-- reads the budget's alone.
--
-- The camera looks straight down at `e.camera.x, e.camera.z` from
-- `e.camera.height`, and sees `e.camera.wide` by `e.camera.deep` elmos of flat
-- ground at height 0. A test replaces `e.trace` for a camera that sees the sky.
--
-- Spring.TraceScreenRay (rts/Lua/LuaUnsyncedRead.cpp) gives nothing for a ray
-- that misses the ground unless `includeSky` is set, and then "sky" and a table
-- whose 4th to 6th numbers are where the ray meets the level plane at the
-- height given as the 7th argument. For a ray that meets the ground it gives
-- "ground" and a table of the place and, after it, the same plane's place.
--
-- The drawing calls record what was drawn: how many vertices, the box that
-- holds them, the colours, and the state calls in order.

local M = {}

M.VIEW_X, M.VIEW_Y = 1280, 720

function M.new(clock)
	clock = clock or { now = 0 }
	clock.messages = clock.messages or {}
	clock.views = clock.views or {}
	local e = {
		clock = clock,
		lines = {},
		camera = { x = 4000, z = 3000, height = 2000, wide = 1600, deep = 900 },
		radius = {},
		colours = {},
		traces = 0,
		state = {},
	}

	function e.clear()
		e.vertices = 0
		e.box = { x1 = math.huge, y1 = math.huge, z1 = math.huge, x2 = -math.huge, y2 = -math.huge, z2 = -math.huge }
		e.colourSum = { 0, 0, 0 }
		-- The sum of the vertices' places, for the middle of what was drawn, and
		-- the greatest alpha any vertex had.
		e.placeSum = { 0, 0, 0 }
		e.maxAlpha = 0
		e.coloured = 0
		e.state = {}
		e.begins = 0
		e.texCoords = 0
	end
	e.clear()

	--- Where the ray through a pixel meets the ground, for the camera above.
	function e.trace(sx, sy)
		local c = e.camera
		local x = c.x + (sx / M.VIEW_X - 0.5) * c.wide
		local z = c.z + (0.5 - sy / M.VIEW_Y) * c.deep
		return "ground", { x, 0, z, x, 0, z }
	end

	local Spring = {}

	-- `e.echoed` counts the lines on the engine's log, which the console shows.
	e.echoed = 0
	function Spring.Echo(line)
		e.echoed = e.echoed + 1
		e.lines[#e.lines + 1] = line
	end

	-- `io` for the playback's log file. What is written to it goes into
	-- `e.lines` with the engine's log, and `e.files` has each file opened with
	-- its mode. `clock.noFile` is a file that cannot be opened.
	e.files = {}
	e.io = {
		open = function(path, mode)
			if clock.noFile then
				return nil, "denied"
			end
			e.files[#e.files + 1] = path .. " " .. mode
			return {
				write = function(_, line)
					e.lines[#e.lines + 1] = line
				end,
				flush = function() end,
				close = function() end,
			}
		end,
	}

	function Spring.GetTimer()
		return clock.now
	end

	function Spring.DiffTimers(a, b, milliseconds, fromMicroseconds)
		assert(milliseconds == true, "the gadget did not ask for milliseconds")
		if clock.micros then
			assert(fromMicroseconds == true, "the gadget read microsecond timers as milliseconds")
			return (a - b) / 1000
		end
		return a - b
	end

	-- The engine's own speed and pause (Spring.GetGameSpeed in
	-- rts/Lua/LuaUnsyncedRead.cpp), which `pause` and `setspeed` change. The
	-- commands sent are collected in `clock.commands`.
	e.speed = { wanted = 1, paused = false }
	clock.commands = clock.commands or {}

	function Spring.GetGameSpeed()
		return e.speed.wanted, e.speed.wanted, e.speed.paused
	end

	function Spring.SendCommands(command)
		clock.commands[#clock.commands + 1] = command
		-- The server answers a command a little later. `clock.held` keeps it
		-- from taking effect, the way the frames before the answer see it.
		if clock.held then
			return
		end
		local pause = command:match("^pause (%d)$")
		if pause then
			e.speed.paused = pause == "1"
		end
		local speed = tonumber(command:match("^setspeed (%S+)$"))
		if speed then
			e.speed.wanted = speed
		end
	end

	function Spring.SendLuaRulesMsg(text)
		if text:find("^coilbox_rewind_view:") then
			clock.views[#clock.views + 1] = text
		else
			clock.messages[#clock.messages + 1] = text
		end
	end

	function Spring.GetViewGeometry()
		return M.VIEW_X, M.VIEW_Y, 0, 0
	end

	function Spring.TraceScreenRay(sx, sy, onlyCoords, useMinimap, includeSky, ignoreWater, heightOffset)
		assert(type(sx) == "number" and type(sy) == "number", "a ray needs a pixel")
		assert(onlyCoords == true, "the view asked for units and features under the ray, which costs a walk of both")
		assert(useMinimap == false, "the view asked for the minimap")
		assert(ignoreWater == true, "the view let the water plane hide the ground, which loses a ray that ends above it")
		e.traces = e.traces + 1
		-- A pixel outside the view gives nothing.
		if sx < 0 or sx >= M.VIEW_X or sy < 0 or sy >= M.VIEW_Y then
			return
		end
		local kind, place = e.trace(sx, sy, heightOffset or 0)
		if kind == "sky" and not includeSky then
			return
		end
		return kind, place
	end

	function Spring.GetCameraPosition()
		return e.camera.x, e.camera.height, e.camera.z
	end

	--- The way the camera looks, which is straight down unless a test says.
	function Spring.GetCameraDirection()
		local d = e.camera.direction
		if d then
			return d[1], d[2], d[3]
		end
		return 0, -1, 0
	end

	function Spring.GetUnitRadius(unitID)
		return e.radius[unitID]
	end

	function Spring.GetTeamColor(team)
		local c = e.colours[team]
		if c then
			return c[1], c[2], c[3], 1
		end
	end

	-- What the stream of build particles reads (issue #4029). `e.units` has a
	-- unit by id: `def`, `team`, its place `x, y, z`, its middle `mx, my, mz`,
	-- `radius`, `pieces` (the engine's nano pieces, model numbers from 1) and
	-- `at`, a piece's place by its number. `e.features` has a feature by id with
	-- its middle and radius. `e.rules` holds the game rules parameters,
	-- `e.config` the settings, `e.offset` the time since the last simulation
	-- frame in frames, and `e.inView` whether a sphere is in view.
	e.units, e.features, e.rules, e.config = {}, {}, {}, {}
	-- The engine's CMD and UnitDefs as far as the stream reads them, and its
	-- unit id limit (Game.maxUnits).
	e.CMD = { REPAIR = 40, RECLAIM = 90, RESURRECT = 125, CAPTURE = 130, RESTORE = 110 }
	e.UnitDefs = {}
	e.maxUnits = 32000
	e.offset, e.inView = 0, true
	function Spring.GetGameRulesParam(name)
		return e.rules[name]
	end
	function Spring.GetFrameTimeOffset()
		return e.offset
	end
	--- The engine gives the default for a setting nobody set.
	function Spring.GetConfigInt(name, default)
		local value = e.config[name]
		if value == nil then
			return default
		end
		return value
	end
	function Spring.ValidUnitID(id)
		return e.units[id] ~= nil
	end
	function Spring.GetUnitDefID(id)
		local u = e.units[id]
		return u and u.def
	end
	function Spring.GetUnitTeam(id)
		local u = e.units[id]
		return u and u.team
	end
	--- A new list, and nothing while there are none (LuaSyncedRead::GetUnitNanoPieces).
	function Spring.GetUnitNanoPieces(id)
		local u = e.units[id]
		if not u or not u.pieces or #u.pieces == 0 then
			return
		end
		local list = {}
		for k, piece in ipairs(u.pieces) do
			list[k] = piece
		end
		return list
	end
	--- A piece's place and the way it points, in the world.
	function Spring.GetUnitPiecePosDir(id, piece)
		local u = e.units[id]
		local at = u and u.at and u.at[piece]
		if not at then
			return
		end
		return at[1], at[2], at[3], 0, 0, 1
	end
	function Spring.GetUnitPosition(id, middle)
		local u = e.units[id]
		if not u then
			return
		end
		if middle then
			return u.x, u.y, u.z, u.mx or u.x, u.my or u.y, u.mz or u.z
		end
		return u.x, u.y, u.z
	end
	function Spring.GetFeaturePosition(id, middle)
		local f = e.features[id]
		if not f then
			return
		end
		if middle then
			return f.x, f.y, f.z, f.x, f.y, f.z
		end
		return f.x, f.y, f.z
	end
	function Spring.GetFeatureRadius(id)
		local f = e.features[id]
		return f and f.radius
	end
	function Spring.IsSphereInView()
		return e.inView
	end
	-- The engine's own answers about a builder's work, which nobody gives in a
	-- playback: nothing for every unit.
	e.workerAsks = 0
	function Spring.GetUnitWorkerTask()
		e.workerAsks = e.workerAsks + 1
	end
	function Spring.GetUnitCurrentBuildPower(id)
		e.workerAsks = e.workerAsks + 1
		if e.units[id] then
			return 0
		end
	end
	local radiusOf = Spring.GetUnitRadius
	function Spring.GetUnitRadius(id)
		local u = e.units[id]
		if u and u.radius then
			return u.radius
		end
		return radiusOf(id)
	end

	for name in pairs(clock.without or {}) do
		Spring[name] = nil
	end
	if clock.micros then
		function Spring.GetTimerMicros()
			return clock.now * 1000
		end
	end
	e.Spring = Spring

	local gl = {}
	local function state(name)
		return function(...)
			local parts = { name }
			for i = 1, select("#", ...) do
				parts[#parts + 1] = tostring((select(i, ...)))
			end
			e.state[#e.state + 1] = table.concat(parts, " ")
		end
	end
	gl.Blending = state("Blending")
	gl.DepthTest = state("DepthTest")
	gl.DepthMask = state("DepthMask")
	-- A texture that the engine finds gives true. `e.noTexture` is a path it
	-- does not find.
	local recordTexture = state("Texture")
	function gl.Texture(which)
		recordTexture(which)
		return which ~= e.noTexture
	end
	local inside = false
	local r, g, b = 1, 1, 1
	-- The texture coordinates given since the last clear.
	e.texCoords = 0
	function gl.TexCoord(s, u)
		assert(inside, "a texture coordinate outside gl.BeginEnd is not drawn")
		assert(s >= 0 and s <= 1 and u >= 0 and u <= 1, "a texture coordinate outside the texture")
		e.texCoords = e.texCoords + 1
	end
	function gl.Color(red, green, blue, alpha)
		assert(type(red) == "number" and type(green) == "number" and type(blue) == "number" and type(alpha) == "number", "a colour is four numbers")
		assert(alpha >= 0 and alpha <= 1, "an alpha of " .. tostring(alpha))
		r, g, b = red, green, blue
		e.lastColour = alpha
		if inside then
			e.drawnAlpha = alpha
			if alpha > e.maxAlpha then
				e.maxAlpha = alpha
			end
		end
		if not inside then
			e.state[#e.state + 1] = "Color " .. red .. " " .. green .. " " .. blue .. " " .. alpha
		end
	end
	function gl.Vertex(x, y, z)
		assert(inside, "a vertex outside gl.BeginEnd is not drawn")
		assert(x == x and y == y and z == z, "a vertex that is not a number")
		local box = e.box
		box.x1, box.x2 = math.min(box.x1, x), math.max(box.x2, x)
		box.y1, box.y2 = math.min(box.y1, y), math.max(box.y2, y)
		box.z1, box.z2 = math.min(box.z1, z), math.max(box.z2, z)
		e.vertices = e.vertices + 1
		local places = e.placeSum
		places[1], places[2], places[3] = places[1] + x, places[2] + y, places[3] + z
		local sum = e.colourSum
		sum[1], sum[2], sum[3] = sum[1] + r, sum[2] + g, sum[3] + b
		e.coloured = e.coloured + 1
	end
	function gl.BeginEnd(mode, draw, ...)
		assert(mode == e.GL.QUADS, "the effect drew something other than quads")
		local before = e.vertices
		inside = true
		draw(...)
		inside = false
		assert((e.vertices - before) % 4 == 0, "a quad is four vertices")
		e.begins = e.begins + 1
	end
	e.gl = gl
	-- The numbers are OpenGL's own.
	e.GL = { QUADS = 7, SRC_ALPHA = 770, ONE = 1, ONE_MINUS_SRC_ALPHA = 771 }
	return e
end

return M
