-- id: spring-sun-parameters
-- catalogue: removed:Spring.SetSunParameters, removed:Spring.SetSunManualControl
-- states: unsynced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetSunParameters and Spring.SetSunManualControl, which do nothing.
--
-- Changelog, 104.0: "remove Spring.SetSunParameters and
-- Spring.SetSunManualControl". In 103.0.1 both worked only on a map with a
-- dynamic sun and returned nothing (rts/Lua/LuaUnsyncedCtrl.cpp). The current
-- engine has no dynamic sun, so the sun stays where the map puts it.

local compat = ...

if type(Spring) == "table" then
	compat.define(Spring, "SetSunParameters", function() end)
	compat.define(Spring, "SetSunManualControl", function() end)
end
