-- id: spring-rules-param-105
-- catalogue: signature:Spring.SetGameRulesParam@105.0, signature:Spring.SetTeamRulesParam@105.0, signature:Spring.SetUnitRulesParam@105.0, signature:Spring.SetFeatureRulesParam@105.0
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- Spring.Set{Game,Team,Unit,Feature}RulesParam storing a string that reads as
-- a number as that number, as 104.0 did.
--
-- In 104.0, SetRulesParam (rts/Lua/LuaSyncedCtrl.cpp) stored any value
-- lua_isnumber accepts as a number, and lua_isnumber accepts a string such as
-- "30". RecoilEngine commit ffafcbc51a, "Coerce to number less often in
-- *SetRulesParam" (#511, first in 105.0), changed the test to
-- lua_israwnumber, so "30" is now stored and read back as a string. Spring
-- 1944's game_ammo.lua sets a unit's ammo from a def's custom parameter, which
-- is a string, and then compares it with a number.
--
-- The four functions share SetRulesParam, and these are the ones 104.0 had.
-- Spring.SetPlayerRulesParam came later, so no game written for 104.0 calls it.
--
-- tonumber reads a string the way lua_isnumber does, through the same
-- luaO_str2d, so the value changes only where the two engines differ. Any
-- other value, a number included, is passed on as it came.

local Spring = Spring
if type(Spring) ~= "table" then
	return
end

local tonumber, type = tonumber, type

local function number(value)
	if type(value) == "string" then
		local n = tonumber(value)
		if n ~= nil then
			return n
		end
	end
	return value
end

local set = Spring.SetGameRulesParam
if type(set) == "function" then
	Spring.SetGameRulesParam = function(name, value, ...)
		return set(name, number(value), ...)
	end
end

for _, key in ipairs({ "SetTeamRulesParam", "SetUnitRulesParam", "SetFeatureRulesParam" }) do
	local setOne = Spring[key]
	if type(setOne) == "function" then
		Spring[key] = function(id, name, value, ...)
			return setOne(id, name, number(value), ...)
		end
	end
end
