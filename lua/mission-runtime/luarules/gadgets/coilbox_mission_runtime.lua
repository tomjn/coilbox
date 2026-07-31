-- Coilbox mission runtime: the gadget that runs a scenario.
--
-- Vendored into a game by coilbox. Change it in the coilbox repository under
-- lua/mission-runtime/ and install again, or the next runtime update will
-- overwrite the edit.
--
-- The gadget exists for missions and nothing else. Without the coilbox_mission
-- modoption the chunk returns false, the gadget handler drops it, and a normal
-- game pays only the cost of reading this file.

local LOG_SECTION = "coilbox-mission"

local function log(level, message)
	Spring.Log(LOG_SECTION, level, message)
end

-- The scenario id coilbox wrote into the start script, or nil for a normal
-- game. The id becomes part of a VFS path, so anything that is not a plain name
-- is refused rather than followed.
local function readMissionId()
	local raw = Spring.GetModOptions().coilbox_mission
	if type(raw) ~= "string" then
		return nil
	end

	local id = raw:match("^%s*(.-)%s*$")
	if id == "" then
		return nil
	end
	if not id:match("^[%w._%-]+$") or id:match("^%.+$") then
		log("error", "ignoring coilbox_mission: " .. id .. " is not a mission id")
		return nil
	end
	return id
end

local MISSION_ID = readMissionId()
if not MISSION_ID then
	return false
end

-- Read a Lua table out of an archive. The environment is empty because these
-- files are data: a mission that reaches for a global fails here instead of
-- reaching into the gadget.
local function includeTable(path)
	if not VFS.FileExists(path, VFS.ZIP) then
		return nil, path .. " is missing"
	end

	local ok, value = pcall(VFS.Include, path, {}, VFS.ZIP)
	if not ok then
		return nil, path .. " failed to load: " .. tostring(value)
	end
	if type(value) ~= "table" then
		return nil, path .. " did not return a table"
	end
	return value
end

local RUNTIME, runtimeError = includeTable("missions/runtime.lua")
if not RUNTIME then
	log("error", runtimeError)
	return false
end

local MISSION, missionError = includeTable("missions/" .. MISSION_ID .. "/mission.lua")
if not MISSION then
	log("error", missionError)
	return false
end

-- Refuse a mission built for a newer runtime than the game vendored. Running it
-- anyway would quietly drop whatever this version cannot read, and a mission
-- that half works is harder to diagnose than one that refuses to start.
local function needsNewerRuntime(field, have)
	local needs = tonumber(MISSION[field]) or 0
	if needs <= (tonumber(have) or 0) then
		return false
	end
	log("error", string.format(
		"mission %s needs %s %d, this runtime is at %s: update the runtime in this game",
		MISSION_ID, field, needs, tostring(have)))
	return true
end

if needsNewerRuntime("runtimeVersion", RUNTIME.version)
	or needsNewerRuntime("schemaVersion", RUNTIME.schemaVersion) then
	return false
end

-- Not fatal. The mission will spawn its units at coordinates that mean nothing
-- on this map, but saying so beats a silent sea of drowned commanders.
if MISSION.map and MISSION.map ~= Game.mapName then
	log("warning", string.format(
		"mission %s was built for map %s and is running on %s",
		MISSION_ID, MISSION.map, tostring(Game.mapName)))
end

function gadget:GetInfo()
	return {
		name = "Coilbox mission runtime",
		desc = "Runs a coilbox scenario as a mission",
		author = "coilbox",
		date = "2026",
		license = "MIT",
		-- Ahead of the game's own gadgets. The runtime suppresses the normal
		-- start and wants first sight of the events it acts on.
		layer = -1,
		enabled = true,
	}
end

-- The rest of the runtime reads the mission through GG, in both halves. The
-- table is the compiled scenario exactly as coilbox emitted it, so a mission
-- that misbehaves can be diagnosed by reading missions/<id>/mission.lua.
function gadget:Initialize()
	GG.CoilboxMission = {
		id = MISSION_ID,
		mission = MISSION,
		runtime = RUNTIME,
	}

	if gadgetHandler:IsSyncedCode() then
		log("notice", string.format(
			"mission %s loaded, runtime version %s", MISSION_ID, tostring(RUNTIME.version)))
	end
end
