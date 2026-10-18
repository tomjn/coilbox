-- id: gadget-messages-tdf-95
-- catalogue: file:gamedata/messages.tdf
-- gadget: coilbox_compat_messages_tdf
-- license: MIT or GNU GPL, v2 or later

-- The game's gamedata/messages.tdf names how a team's death is announced, as it
-- did before 95.0.
--
-- Changelog, 95.0: "remove engine support for gamedata/messages.tdf". The same
-- release stopped the engine announcing a team's death at all.
--
-- Up to 94.1, CTeam::Died (rts/Sim/Misc/Team.cpp) wrote a line to the console
-- on every machine when a team died: "Team %i (lead by %s) is no more" with the
-- team's number and its leader's name, or "Team %i is no more" for a team with
-- no leader. Before 83.0 the two lines were "Team%i(%s) is no more" and
-- "Team%i is no more". CMessages (rts/Game/Messages.cpp) looked the line up,
-- without regard to case, in the table gamedata/messages.lua returned, and
-- used one of the lines listed under it, picked at random, in its place. The
-- engine's own gamedata/messages.lua read gamedata/messages.tdf, and a game
-- could ship its own instead. TeamDied hears of every death the engine
-- announced. The teams it kills at the end of a game, after Lua has gone
-- (rts/Game/Game.cpp), were never announced.
--
-- This does the same from TeamDied, in unsynced code, so the random pick does
-- not use the synced random numbers. It looks a line up under both names, so a
-- game written for either engine finds its own. A translation is free text, so
-- each %i or %d in it becomes the team's number and each %s the leader's name,
-- however many there are.
--
-- It does nothing in a game with no gamedata/messages.tdf.

function gadget:GetInfo()
	return {
		name = "coilbox_compat_messages_tdf",
		desc = "Announces a team's death with the game's gamedata/messages.tdf, as before engine 95.0",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

if gadgetHandler:IsSyncedCode() then
	return false
end

local Spring = Spring
local random = math.random

local NAME = "coilbox_compat_messages_tdf"
local TDF_FILE = "gamedata/messages.tdf"
local LUA_FILE = "gamedata/messages.lua"

-- The lines the engine announced, newest wording first.
local LED = { "Team %i (lead by %s) is no more", "Team%i(%s) is no more" }
local LEADERLESS = { "Team %i is no more", "Team%i is no more" }

-- The translations, by line in lower case.
local messages = {}

--- A translation table as gamedata/messages.lua returns it, keyed by line in
--- lower case. The engine read each line's translations from 1 up to the first
--- that is missing or empty.
local function fromLua(root)
	for line, list in pairs(root) do
		if type(line) == "string" and type(list) == "table" then
			local found = {}
			while type(list[#found + 1]) == "string" and list[#found + 1] ~= "" do
				found[#found + 1] = list[#found + 1]
			end
			if #found > 0 then
				messages[line:lower()] = found
			end
		end
	end
end

--- The `messages` section of gamedata/messages.tdf, read with the TDF parser
--- the engine ships. Each line's translations are the strings under it in any
--- key, in the order of their keys.
local function fromTdf(section)
	for line, list in pairs(section) do
		if type(line) == "string" and type(list) == "table" then
			local keys = {}
			for key, text in pairs(list) do
				if type(text) == "string" and text ~= "" then
					keys[#keys + 1] = tostring(key)
				end
			end
			table.sort(keys)
			local found = {}
			for i, key in ipairs(keys) do
				found[i] = list[key]
			end
			if #found > 0 then
				messages[line:lower()] = found
			end
		end
	end
end

local function load()
	if VFS.FileExists(LUA_FILE) then
		local root = VFS.Include(LUA_FILE)
		if type(root) == "table" then
			fromLua(root)
		end
		return
	end
	local TDF = VFS.Include("gamedata/parse_tdf.lua")
	local parsed, err = TDF.Parse(TDF_FILE)
	if type(parsed) ~= "table" then
		error(TDF_FILE .. ": " .. tostring(err))
	end
	if type(parsed.messages) ~= "table" then
		error(TDF_FILE .. " has no [messages] section")
	end
	fromTdf(parsed.messages)
end

--- `text` with the team's number and leader's name in it.
local function fill(text, teamID, name)
	return (text:gsub("%%([%%dis])", function(c)
		if c == "%" then
			return "%"
		elseif c == "s" then
			return name or ""
		end
		return tostring(teamID)
	end))
end

function gadget:Initialize()
	if not VFS.FileExists(TDF_FILE) then
		gadgetHandler:RemoveGadget()
		return
	end
	local ok, err = pcall(load)
	if not ok then
		Spring.Log(NAME, "warning", "could not read the death messages: " .. tostring(err))
		gadgetHandler:RemoveGadget()
	end
end

function gadget:TeamDied(teamID)
	local _, leader = Spring.GetTeamInfo(teamID, false)
	local name = leader ~= nil and leader >= 0 and Spring.GetPlayerInfo(leader, false) or nil
	local lines = name and LED or LEADERLESS
	local text = lines[1]
	for _, line in ipairs(lines) do
		local found = messages[line:lower()]
		if found ~= nil then
			text = found[random(#found)]
			break
		end
	end
	Spring.Echo(fill(text, teamID, name))
end
