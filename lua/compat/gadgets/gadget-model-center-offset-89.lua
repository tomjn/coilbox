-- id: gadget-model-center-offset-89
-- catalogue: defTag:UnitDefs.modelCenterOffset
-- gadget: coilbox_compat_model_center_offset
-- license: MIT or GNU GPL, v2 or later

-- A unit def's modelCenterOffset moves the unit's middle again, as it did
-- before 89.0.
--
-- Changelog, 89.0: "remove modelCenterOffset tag (can now be dynamically set
-- with Lua)". Up to 88.0 the model loader added the def's three numbers to the
-- model's middle (C3DModelLoader::Load3DModel in
-- rts/Rendering/Models/IModelParser.cpp), and a unit's middle was the one
-- point its collision volume sat on and other units aimed at.
--
-- The def fix defs-model-center-offset-89 keeps the numbers in
-- customparams.modelcenteroffset. This puts each new unit of such a def's
-- middle and aim point at the model's middle plus the offset, in the unit's own
-- space, with Spring.SetUnitMidAndAimPos. Spring.GetUnitDefDimensions gives
-- the model's middle. The engine still puts the collision volume on the
-- middle.
--
-- 88.0 kept one copy of each model, so where two defs shared a model the first
-- to load it set the offset for both. This uses each def's own.
--
-- It turns itself off in a game with no def that has the parameter.

function gadget:GetInfo()
	return {
		name = "coilbox_compat_model_center_offset",
		desc = "Units are centred by their def's modelCenterOffset, as before engine 89.0",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

if not gadgetHandler:IsSyncedCode() then
	return false
end

local Spring = Spring

-- The offset of each def that has one, by unit def ID.
local offsets = {}

-- The middle each def's unit is put on, by unit def ID, worked out once.
local middles = {}

local function middle(unitDefID)
	local mid = middles[unitDefID]
	if mid == nil then
		local offset = offsets[unitDefID]
		local dims = Spring.GetUnitDefDimensions(unitDefID)
		if type(dims) ~= "table" then
			return nil
		end
		mid = {
			(dims.midx or 0) + offset[1],
			(dims.midy or 0) + offset[2],
			(dims.midz or 0) + offset[3],
		}
		middles[unitDefID] = mid
	end
	return mid
end

local function centre(unitID, unitDefID)
	if offsets[unitDefID] == nil then
		return
	end
	local mid = middle(unitDefID)
	if mid ~= nil then
		Spring.SetUnitMidAndAimPos(unitID, mid[1], mid[2], mid[3], mid[1], mid[2], mid[3], true)
	end
end

function gadget:Initialize()
	for unitDefID, ud in pairs(UnitDefs) do
		local text = type(ud.customParams) == "table" and ud.customParams.modelcenteroffset
		if type(text) == "string" then
			local x, y, z = text:match("^(%S+) (%S+) (%S+)$")
			x, y, z = tonumber(x), tonumber(y), tonumber(z)
			if x ~= nil and y ~= nil and z ~= nil then
				offsets[unitDefID] = { x, y, z }
			end
		end
	end
	if next(offsets) == nil then
		gadgetHandler:RemoveGadget()
		return
	end
	for _, unitID in ipairs(Spring.GetAllUnits()) do
		centre(unitID, Spring.GetUnitDefID(unitID))
	end
end

function gadget:UnitCreated(unitID, unitDefID)
	centre(unitID, unitDefID)
end
