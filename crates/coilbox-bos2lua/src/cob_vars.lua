-- lualibs/cob_vars.lua, written by coilbox.
--
-- Unit scripts coilbox converted from BOS keep the unit values BOS scripts
-- shared, 1024 to 8191, as rules params, because the engine stopped keeping
-- them in Spring 102.0. This file lets a game's gadgets and widgets reach the
-- same values the old way. It brings back Spring.GetCOBUnitVar, GetCOBTeamVar,
-- GetCOBAllyTeamVar and GetCOBGlobalVar, which 102.0 removed. In synced
-- LuaRules it also makes Spring.GetUnitCOBValue and SetUnitCOBValue keep the
-- shared values, which the engine answers with 0 and ignores.
--
-- Include it on the first line of LuaRules/main.lua, LuaRules/draw.lua and
-- luaui.lua (or LuaUI/main.lua), so it runs before any gadget or widget copies
-- a Spring function into a local:
--
--   VFS.Include("lualibs/cob_vars.lua")
--
-- One difference from the engine's: a value the reader may not see, such as an
-- enemy team's, reads 0 where the engine answered nothing.
--
-- Recoil builds its Lua with numbers as C floats, so a value beyond 16777216
-- rounds, the same as it would anywhere else in a Lua unit script. A packed
-- map position is usually beyond that.

if Spring.GetCOBTeamVar then
	return
end

local GetUnitRulesParam = Spring.GetUnitRulesParam
local GetTeamRulesParam = Spring.GetTeamRulesParam
local GetGameRulesParam = Spring.GetGameRulesParam
local GetTeamInfo = Spring.GetTeamInfo
local GetTeamList = Spring.GetTeamList
local GetUnitTeam = Spring.GetUnitTeam
local GetUnitAllyTeam = Spring.GetUnitAllyTeam
local ValidUnitID = Spring.ValidUnitID
local floor = math.floor

local function signed16(value)
	return (value + 32768) % 65536 - 32768
end

-- The value, or its two halves when asked to split it. The engine packed a map
-- position into one value as x * 65536 + z.
local function answer(value, split)
	value = value or 0
	if split then
		return signed16(floor(value / 65536)), signed16(value % 65536)
	end
	return value
end

local function inRange(n, count)
	return type(n) == "number" and n >= 0 and n < count
end

function Spring.GetCOBUnitVar(unitID, n, split)
	if not ValidUnitID(unitID) or not inRange(n, 8) then
		return
	end
	return answer(GetUnitRulesParam(unitID, "cobUnitVar" .. n), split)
end

function Spring.GetCOBTeamVar(teamID, n, split)
	if GetTeamInfo(teamID) == nil or not inRange(n, 64) then
		return
	end
	return answer(GetTeamRulesParam(teamID, "cobTeamVar" .. n), split)
end

-- Every team in an allyteam holds the same copy, so the first one answers.
function Spring.GetCOBAllyTeamVar(allyTeamID, n, split)
	local teams = GetTeamList(allyTeamID)
	if teams == nil or not inRange(n, 64) then
		return
	end
	return answer(teams[1] and GetTeamRulesParam(teams[1], "cobAllyVar" .. n), split)
end

function Spring.GetCOBGlobalVar(n, split)
	if not inRange(n, 4096) then
		return
	end
	return answer(GetGameRulesParam("cobGlobalVar" .. n), split)
end

local GetUnitCOBValue = Spring.GetUnitCOBValue
local SetUnitCOBValue = Spring.SetUnitCOBValue
local SetUnitRulesParam = Spring.SetUnitRulesParam
local SetTeamRulesParam = Spring.SetTeamRulesParam
local SetGameRulesParam = Spring.SetGameRulesParam

-- Only synced LuaRules has both the unit value functions and the setters.
if not (GetUnitCOBValue and SetUnitCOBValue and SetTeamRulesParam) then
	return
end

local allied = { allied = true }

-- Which kind of shared value an id is, and the rules param it lives in, or
-- nil for any other id.
local function shared(id)
	if type(id) ~= "number" then
		return nil
	elseif id >= 1024 and id <= 1031 then
		return "unit", "cobUnitVar" .. (id - 1024)
	elseif id >= 2048 and id <= 2111 then
		return "team", "cobTeamVar" .. (id - 2048)
	elseif id >= 3072 and id <= 3135 then
		return "ally", "cobAllyVar" .. (id - 3072)
	elseif id >= 4096 and id <= 8191 then
		return "game", "cobGlobalVar" .. (id - 4096)
	end
	return nil
end

function Spring.SetUnitCOBValue(unitID, id, value, ...)
	local kind, name = shared(id)
	if kind == nil or not ValidUnitID(unitID) then
		return SetUnitCOBValue(unitID, id, value, ...)
	end
	if select("#", ...) > 0 then
		local z = ...
		value = value * 65536 + (z % 65536)
	elseif type(value) == "boolean" then
		value = value and 1 or 0
	end
	if kind == "unit" then
		SetUnitRulesParam(unitID, name, value, allied)
	elseif kind == "team" then
		SetTeamRulesParam(GetUnitTeam(unitID), name, value, allied)
	elseif kind == "ally" then
		for _, team in ipairs(GetTeamList(GetUnitAllyTeam(unitID))) do
			SetTeamRulesParam(team, name, value, allied)
		end
	else
		SetGameRulesParam(name, value)
	end
end

-- The engine's takes an optional split flag before the id. A unit value with a
-- positive first argument reads that unit's, and with a negative one sets that
-- unit's to the second, as a BOS get did.
function Spring.GetUnitCOBValue(unitID, ...)
	local split, id, p1, p2 = ...
	if type(split) ~= "boolean" then
		split, id, p1, p2 = false, ...
	end
	local kind, name = shared(id)
	if kind == nil or not ValidUnitID(unitID) then
		return GetUnitCOBValue(unitID, ...)
	end
	if type(p1) == "table" then
		p1 = p1[1] * 65536 + (p1[2] % 65536)
	end
	if type(p2) == "table" then
		p2 = p2[1] * 65536 + (p2[2] % 65536)
	end
	local value
	if kind == "unit" then
		p1 = p1 or 0
		if p1 >= 0 then
			value = GetUnitRulesParam(p1 == 0 and unitID or p1, name)
		elseif ValidUnitID(-p1) then
			SetUnitRulesParam(-p1, name, p2 or 0, allied)
			value = 1
		end
	elseif kind == "game" then
		value = GetGameRulesParam(name)
	else
		value = GetTeamRulesParam(GetUnitTeam(unitID), name)
	end
	return answer(value, split)
end
