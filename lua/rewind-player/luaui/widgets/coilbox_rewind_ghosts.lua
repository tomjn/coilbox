-- Coilbox rewind ghosts: the buildings a builder had queued (issue #3804).
--
-- Coilbox generates a game that depends on the game a replay was recorded on,
-- and the player gadget in it plays the replay's track back. The track holds
-- each builder's queue of buildings, and nothing in the world shows one. This
-- widget draws each queued building as a translucent shape in its team's colour,
-- at the place and facing it was queued with. The work is in
-- luaui/rewind_ghosts/coilbox_ghosts.lua and this file is the engine's side of
-- it: the call-ins, and finding the track.
--
-- It reads the track itself, with the player's reader. A widget can: the
-- unsynced VFS reaches any file of the game, the playback game's track and the
-- reader's two files included. The cost is a second copy of the track in the
-- widget's Lua state. In return the synced gadget does nothing for it and sends
-- nothing, a widget that is loaded late or reloaded needs no catching up, and
-- the time is the player's published `coilbox_rewind_frame`.
--
-- A game's adapter can draw the ghosts in the game's own way, with a hook called
-- `drawQueuedBuilding` (lua/rewind-player/README.md, "Hooks"). The adapter file
-- is read here as well as by the player, and runs in this widget's environment,
-- where `gl` is. A second hook, `queuedBuildingsDrawn`, is told when a pass of
-- drawing is over, for a game whose helper keeps a shape until it is dropped.
--
-- A game's own widget handler loads this, as it loads the timeline: it lists
-- luaui/widgets/ out of the game and turns on a widget it has not seen before
-- when `enabled` is true. The timeline's key list has the key that switches the
-- ghosts, and `/rewindghosts` does too.
--
-- Change this in the coilbox repository under lua/rewind-player/.

function widget:GetInfo()
	return {
		name = "Coilbox rewind ghosts",
		desc = "Shows the buildings a builder had queued in a replay being played back.",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

local PREFIX = "COILBOX_REWIND_GHOSTS "
local ADAPTER_PATH = "coilbox_rewind/adapter.lua"

local ghosts
-- What the widget handler kept from last time, which it hands over before
-- Initialize.
local saved

--- The game's definitions by name. A handler whose LuaUI does not make the table
-- has none, and then it is worked out.
local function definitionsByName()
	if UnitDefNames then
		return UnitDefNames
	end
	local names = {}
	for id, def in pairs(UnitDefs) do
		names[def.name] = { id = id }
	end
	return names
end

--- Where the widget's lines go: the playback's own log file, and not the
-- engine's log, which the console shows (issue #4032,
-- luarules/rewind_player/coilbox_log.lua). Without the module, the engine's log.
local function logWriter()
	local ok, Log = pcall(VFS.Include, "luarules/rewind_player/coilbox_log.lua", nil, VFS.ZIP)
	if ok and type(Log) == "table" then
		return (Log.new(io, Spring.Echo))
	end
	return Spring.Echo
end

local say = Spring.Echo

--- The adapter the playback game holds, or nil. Include runs the file in the
-- environment of the function that calls it, which is wanted: its hooks then see
-- the widget's `gl`.
local function readAdapter(engine)
	if not engine.on.adapter or not VFS.FileExists(ADAPTER_PATH, VFS.ZIP) then
		return nil
	end
	local ok, adapter = pcall(function()
		return VFS.Include(ADAPTER_PATH, nil, VFS.ZIP)
	end)
	if not ok then
		say(PREFIX .. "the game's adapter could not be read, so the engine's own shape is used: " .. tostring(adapter))
		return nil
	end
	return adapter
end

function widget:Initialize()
	say = logWriter()
	-- What the engine has comes first. A widget that lacks a call it cannot do
	-- without does not start, and says which.
	local found, Engine = pcall(VFS.Include, "luaui/rewind_ghosts/coilbox_ghosts_engine.lua", nil, VFS.ZIP)
	if not found then
		say(PREFIX .. "failed: " .. tostring(Engine))
		return
	end
	local engine = Engine.check({ Spring = Spring, gl = gl, GL = GL, VFS = VFS })
	for _, line in ipairs(engine.lines) do
		say(line)
	end
	if engine.refused then
		return
	end
	local loaded, Ghosts = pcall(VFS.Include, "luaui/rewind_ghosts/coilbox_ghosts.lua", nil, VFS.ZIP)
	local readers, Track = pcall(VFS.Include, "luarules/rewind_player/coilbox_track.lua", nil, VFS.ZIP)
	local fetchers, Fetch = pcall(VFS.Include, "luarules/rewind_player/coilbox_track_fetch.lua", nil, VFS.ZIP)
	if not (loaded and readers and fetchers) then
		say(PREFIX .. "failed: " .. tostring(not loaded and Ghosts or not readers and Track or Fetch))
		return
	end

	-- A game with no track is no playback, and says so once.
	local fetch, why = Fetch.fromVFS()
	local track
	if fetch then
		track, why = Track.open(fetch)
	end
	if not track then
		say(PREFIX .. "no queued building will be drawn: " .. tostring(why))
		return
	end

	local made = Ghosts.new({
		Spring = Spring,
		gl = gl,
		GL = GL,
		outline = engine.on.outline,
		UnitDefs = UnitDefs,
		UnitDefNames = definitionsByName(),
		adapter = readAdapter(engine),
		log = say,
	}, track)
	made:setConfig(saved)
	ghosts = made
	-- How the timeline's key reaches the ghosts. Another widget can use it too.
	WG.coilboxRewindGhosts = {
		toggle = function()
			return made:toggle()
		end,
		isOn = function()
			return made.enabled
		end,
	}
end

function widget:Shutdown()
	if WG.coilboxRewindGhosts then
		WG.coilboxRewindGhosts = nil
	end
	if ghosts then
		ghosts:close()
	end
	ghosts = nil
end

function widget:GetConfigData()
	if ghosts then
		return ghosts:config()
	end
	return saved
end

function widget:SetConfigData(data)
	saved = data
	if ghosts then
		ghosts:setConfig(data)
	end
end

function widget:DrawWorld()
	if ghosts then
		ghosts:draw()
	end
end

function widget:TextCommand(command)
	return ghosts ~= nil and ghosts:textCommand(command)
end
