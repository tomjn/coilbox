function widget:GetInfo()
  return {
    name = "Persepolis hover",
    desc = "Keeps cursor highlights off Persepolis's buildings, and passes on which tower tops are faded",
    author = "AF",
    license = "GNU GPL, v2 or later",
    -- After BAR's Selected Units GL4, at -50, which sets the highlight.
    layer = 0,
    enabled = true,
  }
end

-- BAR's Selected Units GL4 highlights the feature under the cursor by setting
-- its shader uniform 6 to 2, and writes again only when the cursor moves to
-- another feature. On a building, the map's own features, it is set back to 0
-- each frame. Games that read uniform 6 as a model's selection take 0 as not
-- selected, which a building never is.
--
-- The tower fade gadget calls PersepolisHiddenTowers with the tops it has
-- faded, kept in WG.persepolisHiddenTowers for the x-ray.

local spGetMouseState = Spring.GetMouseState
local spTraceScreenRay = Spring.TraceScreenRay
local spGetFeatureDefID = Spring.GetFeatureDefID
local setUniforms = gl.SetFeatureBufferUniforms

local building = {}
for defID, def in pairs(FeatureDefs) do
  local name = def.name
  if name:sub(1, 4) == "pst_" or (name:sub(1, 4) == "psp_" and name:sub(1, 12) ~= "psp_bollards" and name:sub(1, 10) ~= "psp_street") then
    building[defID] = true
  end
end
local zero = { 0 }

function widget:Initialize()
  WG.persepolisHiddenTowers = { version = 0, ids = {} }
  widgetHandler:RegisterGlobal("PersepolisHiddenTowers", function(version, ids)
    WG.persepolisHiddenTowers = { version = version, ids = ids }
  end)
end

function widget:Shutdown()
  widgetHandler:DeregisterGlobal("PersepolisHiddenTowers")
  WG.persepolisHiddenTowers = nil
end

function widget:Update()
  if not setUniforms then return end
  local mx, my = spGetMouseState()
  local kind, id = spTraceScreenRay(mx, my)
  if kind == "feature" and building[spGetFeatureDefID(id)] then
    setUniforms(id, zero, 6)
  end
end
