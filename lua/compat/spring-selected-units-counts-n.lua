-- id: spring-selected-units-counts-n
-- catalogue: signature:Spring.GetSelectedUnitsCounts@BAR105 1544
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the table Spring.GetSelectedUnitsCounts returns.
--
-- The engine's doc/changelog.txt, under the breaking changes since 105.0,
-- says the tables Spring.GetSelectedUnitsSorted and
-- Spring.GetSelectedUnitsCounts return no longer have that key, and that the
-- number of unit defs is now their second result instead.
--
-- On 104.0 the table held the number of selected units of each unit def,
-- keyed by unit def ID, and n held how many unit defs it had, 0 when nothing
-- was selected (rts/Lua/LuaUnsyncedRead.cpp). Spring 1944 2.31's
-- gui_s44_selbuttons.lua reads n and does arithmetic on it. This counts the
-- table's keys into n when the engine has not set it.
--
-- 104.0 returned the table alone. The widget passes on every result of
-- Spring.GetSelectedUnitsCounts from a function whose second result it takes
-- as a transport's unit ID, so the count the engine now returns second is
-- dropped.
--
-- Coilbox leaves this fix out for a game whose own Lua already takes that
-- second result (crates/coilbox-compat, ADAPTERS).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetSelectedUnitsCounts) ~= "function" then
	return
end

local type, pairs = type, pairs
local GetSelectedUnitsCounts = Spring.GetSelectedUnitsCounts

local function withN(units)
	if type(units) == "table" and units.n == nil then
		local n = 0
		for _ in pairs(units) do
			n = n + 1
		end
		units.n = n
	end
	return units
end

Spring.GetSelectedUnitsCounts = function(...)
	return withN(GetSelectedUnitsCounts(...))
end
