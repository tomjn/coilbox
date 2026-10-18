-- id: spring-set-unit-to-feature
-- catalogue: removed:Spring.SetUnitToFeature
-- states: synced
-- license: MIT or GNU GPL, v2 or later

-- Spring.SetUnitToFeature, through the AllowFeatureCreation call-in.
--
-- Changelog, 105.0: "remove Spring.SetUnitToFeature (use the AllowFeatureCreation
-- callin to block features from being spawned)".
--
-- In 104.0.1 SetUnitToFeature(bool) set one switch for the whole game, true at
-- the start (rts/Sim/Units/Unit.cpp, CUnit::spawnFeature). A unit whose def has
-- isFeature turns into its wreck feature when it is finished. With the switch
-- off it was left as a unit instead. The argument had to be a boolean.
--
-- The current engine makes that wreck in CUnit::FinishedBuilding straight after
-- the UnitFinished call-in, and leaves the unit alone when AllowFeatureCreation
-- refuses it. So with the switch off, UnitFinished notes an isFeature unit's
-- wreck and the next AllowFeatureCreation for that wreck on that frame refuses.

local compat = ...

local Spring = Spring
if type(Spring) ~= "table" or Spring.SetUnitToFeature ~= nil then
	return
end

local spawn = true
local pending = nil

Spring.SetUnitToFeature = function(value)
	if type(value) ~= "boolean" then
		error("bad argument #1 to 'SetUnitToFeature' (boolean expected, got " .. type(value) .. ")", 2)
	end
	spawn = value
end

-- The FeatureDef ID of a unit def's wreck, as CUnit::PreInit looks it up.
local function wreckOf(unitDefID)
	local def = UnitDefs and UnitDefs[unitDefID]
	if def == nil or not def.isFeature or type(def.wreckName) ~= "string" then
		return nil
	end
	local feature = FeatureDefNames and FeatureDefNames[def.wreckName:lower()]
	return feature and feature.id
end

compat.hook("UnitFinished", function(nextFn, unitID, unitDefID, ...)
	pending = nil
	local result = nextFn(unitID, unitDefID, ...)
	if not spawn then
		local featureDefID = wreckOf(unitDefID)
		if featureDefID ~= nil then
			pending = { featureDefID = featureDefID, frame = Spring.GetGameFrame() }
		end
	end
	return result
end, true)

compat.hook("AllowFeatureCreation", function(nextFn, featureDefID, ...)
	local wreck = pending
	pending = nil
	if wreck ~= nil and wreck.featureDefID == featureDefID and wreck.frame == Spring.GetGameFrame() then
		return false
	end
	return nextFn(featureDefID, ...)
end, true)
