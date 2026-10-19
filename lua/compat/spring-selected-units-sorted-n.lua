-- id: spring-selected-units-sorted-n
-- catalogue: signature:Spring.GetSelectedUnitsSorted@BAR105 1544
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- The n key on the table Spring.GetSelectedUnitsSorted returns.
--
-- The engine's doc/changelog.txt, under the breaking changes since 105.0,
-- says the tables Spring.GetSelectedUnitsSorted and
-- Spring.GetSelectedUnitsCounts return no longer have that key, and that the
-- number of unit defs is now their second result instead.
--
-- On 104.0 the table held an array of the selected units of each unit def,
-- keyed by unit def ID, and n held how many unit defs it had, 0 when nothing
-- was selected (rts/Lua/LuaUnsyncedRead.cpp). Spring 1944 2.31's
-- gui_s44_selbuttons.lua compares n with the count it keeps. This counts the
-- table's keys into n when the engine has not set it.
--
-- 104.0 returned the table alone, so the count the engine now returns second
-- is dropped, as spring-selected-units-counts-n does for
-- Spring.GetSelectedUnitsCounts.
--
-- Coilbox leaves this fix out for a game whose own Lua already takes that
-- second result (crates/coilbox-compat, ADAPTERS).

local Spring = Spring
if type(Spring) ~= "table" or type(Spring.GetSelectedUnitsSorted) ~= "function" then
	return
end

local type, pairs = type, pairs
local GetSelectedUnitsSorted = Spring.GetSelectedUnitsSorted

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

Spring.GetSelectedUnitsSorted = function(...)
	return withN(GetSelectedUnitsSorted(...))
end
