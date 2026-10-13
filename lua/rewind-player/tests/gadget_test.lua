-- The stand-in gadget that coilbox puts in the playback game (issue #3793):
-- it logs one line about the track, or the reason it could not.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local expected = dofile(t.FIXTURES .. "expected.lua")
local bytes = t.read(t.FIXTURES .. "small.cbtrack")

local GADGET = t.root() .. "/luarules/gadgets/coilbox_rewind_player.lua"

--- The gadget loaded the way the engine loads one: a chunk whose environment is
-- a synced Lua one, with the handler's `gadget` table and a `VFS.Include` that
-- reads the player's own modules. Gives the gadget and the lines it echoed.
local function load(options)
	local lines = {}
	local env = t.syncedEnv({ files = options.files })
	env.gadget = {}
	env.gadgetHandler = {
		IsSyncedCode = function()
			return options.synced ~= false
		end,
	}
	env.Spring = {
		Echo = function(line)
			lines[#lines + 1] = line
		end,
	}
	env.VFS.Include = function(path)
		local file = path:match("^luarules/rewind_player/(.+)$")
		assert(file, "the gadget included " .. path)
		return t.load(file, env)
	end
	local chunk = assert(loadfile(GADGET))
	setfenv(chunk, env)
	local returned = chunk()
	return env.gadget, lines, returned
end

do
	local gadget, lines = load({ files = { ["coilbox_rewind/track.cbtrack"] = bytes } })
	t.same("it names itself", gadget:GetInfo().name, "Coilbox rewind player")
	gadget:Initialize()
	t.same("it logs one line", #lines, 1)
	local h, info = expected.header, expected.info
	local line = lines[1]
	t.check("the line is the player's", line:find("^COILBOX_REWIND_PLAYER ") ~= nil, line)
	t.check(
		"the line has the frame range",
		line:find("track frames " .. h.firstFrame .. " to " .. h.lastFrame .. ",", 1, true) ~= nil,
		line
	)
	t.check("the line has the window count", line:find("windows " .. h.windowCount .. ",", 1, true) ~= nil, line)
	t.check(
		"the line has the feature count",
		line:find("features " .. #expected.features .. ",", 1, true) ~= nil,
		line
	)
	t.check("the line has the team count", line:find("teams " .. #info.teams .. ",", 1, true) ~= nil, line)
	t.check("the line names the map", line:find("map " .. info.map, 1, true) ~= nil, line)
end

do
	local gadget, lines = load({ files = {} })
	gadget:Initialize()
	t.same("a game with no track logs one line", #lines, 1)
	t.check(
		"the line says what is missing",
		lines[1]:find("failed: the game holds no file at coilbox_rewind/track.cbtrack", 1, true) ~= nil,
		lines[1]
	)
end

do
	local gadget, lines = load({ files = { ["coilbox_rewind/track.cbtrack"] = "not a track" } })
	gadget:Initialize()
	t.same("a file that is not a track logs one line", #lines, 1)
	t.check("the line is a failure", lines[1]:find("COILBOX_REWIND_PLAYER failed: ", 1, true) == 1, lines[1])
end

do
	local _, _, returned = load({ files = {}, synced = false })
	t.same("the unsynced half does not load it", returned, false)
end

t.report()
