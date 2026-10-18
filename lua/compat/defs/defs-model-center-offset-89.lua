-- id: defs-model-center-offset-89
-- catalogue: defTag:UnitDefs.modelCenterOffset
-- defs: defs_post
-- license: MIT or GNU GPL, v2 or later

-- A unit def's modelCenterOffset, copied into customparams.modelcenteroffset
-- for the gadget fix gadget-model-center-offset-89 to apply.
--
-- Changelog, 89.0: "remove modelCenterOffset tag (can now be dynamically set
-- with Lua)". Up to 88.0, UnitDef.cpp read the tag as three numbers, and the
-- model loader added them to the model's middle (C3DModelLoader::Load3DModel
-- in rts/Rendering/Models/IModelParser.cpp). The engine no longer reads it,
-- and a gadget cannot read a tag the engine dropped, only a custom parameter.
--
-- The parameter holds the three numbers separated by spaces. A unit whose tag
-- is not three numbers, which the engine read as no offset, gets none, and a
-- unit that already has the parameter keeps its own.

local compat = ...

for _, ud in ipairs(compat.units()) do
	local x, y, z = compat.float3(compat.get(ud, "modelcenteroffset"))
	if x ~= nil then
		compat.param(ud, "modelcenteroffset", x .. " " .. y .. " " .. z)
	end
end
