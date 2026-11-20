function widget:GetInfo()
  return {
    name = "X-Ray Unit Silhouettes",
    desc = "Draws units hidden behind tall features, such as buildings, as team coloured silhouettes",
    author = "AF",
    license = "MIT or GNU GPL, v2 or later",
    layer = 0,
    enabled = true,
  }
end

-- Installed into the content root by coilbox when the player asks. Change it
-- in the coilbox repository under lua/xray-widget/ and install again, or the
-- next update will overwrite the edit.
--
-- Each frame the tall features' depth alone is drawn into a texture of the
-- screen's size, and then every unit the player can see is drawn flat in its
-- team's colour, kept only where a tall feature stands in front of it and the
-- unit is above the ground. Some models keep parts buried out of sight, as a
-- solar collector's armour is until it closes, so a buried part can be behind
-- a feature too: it is never drawn.
--
-- A feature is tall when its model is at least TALL elmos high. Street
-- furniture, rocks and trees are lower and stay out of it, so a unit walking
-- past a lamp gets no silhouette. A feature Lua has stopped the engine
-- drawing, as a map can to show what is behind a building, hides nothing.
--
-- Units and features are drawn from the engine's shared model buffers with
-- their live transforms, as the game's own GL4 model shaders do. Engines
-- without quaternion transforms in GL4 (Engine.FeatureSupport.transformsInGL4)
-- are not supported, and the widget removes itself there.
--
-- WG.xrayUnitSilhouettes is set while the widget runs, so a map's own copy of
-- this x-ray can stand down. The Persepolis builds before v1.7 do not look for
-- it, so on those maps the widget switches theirs off by name.

local TALL = 100 -- elmos
local MAX_UNITS = 4096
-- How far behind a feature's surface, in depth buffer units, a unit must be.
local DEPTH_BIAS = 0.00002
-- How far below the ground, in elmos, a unit's surface may be and still show,
-- so a unit standing on the ground keeps its foot.
local GROUND_BIAS = 1
local ALPHA = 0.6
-- The x-ray each Persepolis build before v1.7 carries, by its widget name.
local OLD_COPY = "Persepolis x-ray"

local GL_DEPTH_COMPONENT24 = 0x81A6
local GL_NONE = 0

local spGetVisibleUnits = Spring.GetVisibleUnits
local spGetUnitLosState = Spring.GetUnitLosState
local spGetMyAllyTeamID = Spring.GetMyAllyTeamID
local spGetSpectatingState = Spring.GetSpectatingState
local spGetFeatureDefID = Spring.GetFeatureDefID
local spGetFeatureNoDraw = Spring.GetFeatureNoDraw

local vertexVBO, indexVBO
local featureIBO, featureVAO
local featureRoom = 0
local unitIBO, unitVAO
local depthTex, depthFBO
local depthShader, silhouetteShader
local viewSizeLoc, viewPosLoc, mapSizeLoc
local vsx, vsy, vpx, vpy

local function shaderSource()
  local common = [[
#version 430 core
]] .. gl.GetEngineUniformBufferDef(0) .. gl.GetEngineUniformBufferDef(1) .. [[

layout (location = 0) in vec3 pos;
layout (location = 1) in vec3 normal;
layout (location = 2) in vec3 T;
layout (location = 3) in vec3 B;
layout (location = 4) in vec4 uv;
layout (location = 5) in uvec3 bonesInfo;
layout (location = 6) in uvec4 instData; // transforms offset, uniforms offset, team palette index, bind pose

struct Transform {
  vec4 quat;
  vec4 trSc; // translation, then scale
};
layout (std140, binding = 0) readonly buffer TransformBuffer {
  Transform transforms[];
};

vec3 rotate(vec4 q, vec3 v) {
  return 2.0 * dot(q.xyz, v) * q.xyz + (q.w * q.w - dot(q.xyz, q.xyz)) * v + 2.0 * q.w * cross(q.xyz, v);
}
vec3 apply(Transform t, vec3 v) {
  return rotate(t.quat, v * t.trSc.w) + t.trSc.xyz;
}
// Between the last sim frame's transform and this one's, as the engine draws.
Transform between(Transform a, Transform b, float f) {
  float d = dot(a.quat, b.quat);
  vec4 q = mix(a.quat, b.quat * (d < 0.0 ? -1.0 : 1.0), f);
  float len = length(q);
  return Transform(len > 0.0 ? q / len : a.quat, mix(a.trSc, b.trSc, f));
}

flat out vec4 teamCol;
out vec3 worldPos;

void main() {
  uint piece = bonesInfo.x & 0xFFu;
  uint first = instData.x + 2u * (1u + piece);
  Transform pieceT = between(transforms[first], transforms[first + 1u], timeInfo.w);
  teamCol = teamColor[instData.z & 0xFFu];
  // A hidden piece has a scale of 0. Put it off screen.
  if (pieceT.trSc.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  Transform world = between(transforms[instData.x], transforms[instData.x + 1u], timeInfo.w);
  worldPos = apply(world, apply(pieceT, pos));
  gl_Position = cameraViewProj * vec4(worldPos, 1.0);
}
]]
  local depthFragment = [[
#version 430 core
void main() {}
]]
  local silhouetteFragment = [[
#version 430 core
uniform sampler2D featureDepth;
uniform sampler2D groundHeight;
uniform vec2 viewSize;
uniform vec2 viewPos;
// Not mapSize: the engine's uniform blocks, in the vertex shader, have one.
uniform vec2 groundSize;
flat in vec4 teamCol;
in vec3 worldPos;
out vec4 fragColor;
void main() {
  // The heightmap has a texel on each corner of the map's 8 elmo squares.
  vec2 hm = (worldPos.xz / 8.0 + 0.5) / (groundSize / 8.0 + 1.0);
  if (worldPos.y < textureLod(groundHeight, hm, 0.0).r - ]] .. string.format("%.3f", GROUND_BIAS) .. [[) discard;
  float feature = texture(featureDepth, (gl_FragCoord.xy - viewPos) / viewSize).r;
  if (gl_FragCoord.z <= feature + ]] .. string.format("%.8f", DEPTH_BIAS) .. [[) discard;
  fragColor = vec4(mix(teamCol.rgb, vec3(1.0), 0.15), ]] .. string.format("%.3f", ALPHA) .. [[);
}
]]
  return common, depthFragment, silhouetteFragment
end

local function makeDepthTarget()
  if depthFBO then gl.DeleteFBO(depthFBO) end
  if depthTex then gl.DeleteTexture(depthTex) end
  vsx, vsy, vpx, vpy = Spring.GetViewGeometry()
  depthTex = gl.CreateTexture(vsx, vsy, {
    border = false,
    format = GL_DEPTH_COMPONENT24,
    min_filter = GL.NEAREST,
    mag_filter = GL.NEAREST,
    wrap_s = GL.CLAMP_TO_EDGE,
    wrap_t = GL.CLAMP_TO_EDGE,
  })
  depthFBO = depthTex and gl.CreateFBO({ depth = depthTex, drawbuffers = { GL_NONE }, readbuffer = GL_NONE })
  return depthFBO and gl.IsValidFBO(depthFBO)
end

-- Whether each feature definition is tall, worked out the first time it is asked.
local tallDef = {}
local function isTall(featureID)
  local defID = spGetFeatureDefID(featureID)
  if not defID then return false end
  local tall = tallDef[defID]
  if tall == nil then
    local def = FeatureDefs[defID]
    tall = def ~= nil and (def.height or 0) >= TALL
    tallDef[defID] = tall
  end
  return tall
end

-- Every tall feature, and whether it was drawn when last submitted. `dirty`
-- means one came or went since.
local tall = {}
local dirty = true
local shown = {}

local INSTANCE_LAYOUT = { { id = 6, name = "instData", type = GL.UNSIGNED_INT, size = 4 } }

-- A buffer for at least `count` features, made larger when the map gains them.
local function makeFeatureBuffer(count)
  if featureVAO then featureVAO:Delete() end
  if featureIBO then featureIBO:Delete() end
  featureRoom = math.max(count, 1)
  featureIBO = gl.GetVBO(GL.ARRAY_BUFFER, true)
  featureIBO:Define(featureRoom, INSTANCE_LAYOUT)
  featureVAO = gl.GetVAO()
  featureVAO:AttachVertexBuffer(vertexVBO)
  featureVAO:AttachIndexBuffer(indexVBO)
  featureVAO:AttachInstanceBuffer(featureIBO)
end

-- The tall features the engine draws now. Submitted again only when that
-- changes: one is hidden or shown, or comes or goes.
local function refreshFeatures()
  local changed = dirty
  for id, drawn in pairs(tall) do
    local now = not spGetFeatureNoDraw(id)
    if now ~= drawn then
      tall[id] = now
      changed = true
    end
  end
  if not changed then return #shown end
  dirty = false
  shown = {}
  for id, drawn in pairs(tall) do
    if drawn then shown[#shown + 1] = id end
  end
  if #shown > featureRoom then makeFeatureBuffer(#shown * 2) end
  featureVAO:ClearSubmission()
  if #shown > 0 then
    featureIBO:InstanceDataFromFeatureIDs(shown, 6)
    featureVAO:AddFeaturesToSubmission(shown)
  end
  return #shown
end

local function goodbye(why)
  Spring.Echo("X-Ray Unit Silhouettes: off, " .. why)
  widgetHandler:RemoveWidget(widget)
end

-- A Persepolis build before v1.7, whose own x-ray does not stand down.
local function oldPersepolis()
  local major, minor = (Game.mapName or ""):match("^Persepolis v(%d+)%.(%d+)")
  major, minor = tonumber(major), tonumber(minor)
  return major ~= nil and (major < 1 or (major == 1 and minor < 7))
end

function widget:Initialize()
  if not (gl.GetVBO and gl.GetVAO and gl.GetEngineUniformBufferDef and Engine.FeatureSupport and Engine.FeatureSupport.transformsInGL4) then
    return goodbye("this engine has no GL4 model drawing with quaternion transforms")
  end
  if not spGetFeatureNoDraw then
    return goodbye("this engine cannot say which features it draws")
  end
  vertexVBO = gl.GetVBO(GL.ARRAY_BUFFER, false)
  indexVBO = gl.GetVBO(GL.ELEMENT_ARRAY_BUFFER, false)
  if not (vertexVBO and indexVBO) then
    return goodbye("no vertex buffers, as in a headless engine")
  end
  vertexVBO:ModelsVBO()
  indexVBO:ModelsVBO()

  local count = 0
  for _, id in ipairs(Spring.GetAllFeatures()) do
    if isTall(id) then
      tall[id] = false
      count = count + 1
    end
  end
  makeFeatureBuffer(count)

  unitIBO = gl.GetVBO(GL.ARRAY_BUFFER, true)
  unitIBO:Define(MAX_UNITS, INSTANCE_LAYOUT)
  unitVAO = gl.GetVAO()
  unitVAO:AttachVertexBuffer(vertexVBO)
  unitVAO:AttachIndexBuffer(indexVBO)
  unitVAO:AttachInstanceBuffer(unitIBO)

  local vertex, depthFragment, silhouetteFragment = shaderSource()
  depthShader = gl.CreateShader({ vertex = vertex, fragment = depthFragment })
  if not depthShader then
    return goodbye("the depth shader did not compile: " .. tostring(gl.GetShaderLog()))
  end
  silhouetteShader = gl.CreateShader({ vertex = vertex, fragment = silhouetteFragment, uniformInt = { featureDepth = 0, groundHeight = 1 } })
  if not silhouetteShader then
    return goodbye("the silhouette shader did not compile: " .. tostring(gl.GetShaderLog()))
  end
  viewSizeLoc = gl.GetUniformLocation(silhouetteShader, "viewSize")
  viewPosLoc = gl.GetUniformLocation(silhouetteShader, "viewPos")
  mapSizeLoc = gl.GetUniformLocation(silhouetteShader, "groundSize")

  if not makeDepthTarget() then
    return goodbye("could not make a depth texture to draw the features into")
  end

  WG.xrayUnitSilhouettes = true
  if oldPersepolis() then
    Spring.SendCommands("luaui disablewidget " .. OLD_COPY)
  end
  Spring.Echo(string.format("X-Ray Unit Silhouettes: on, %d tall features hide units", count))
end

function widget:FeatureCreated(featureID)
  if isTall(featureID) then
    tall[featureID] = false
    dirty = true
  end
end

function widget:FeatureDestroyed(featureID)
  if tall[featureID] ~= nil then
    tall[featureID] = nil
    dirty = true
  end
end

function widget:ViewResize()
  if not makeDepthTarget() then
    goodbye("could not remake the depth texture at the new size")
  end
end

-- The units this player may see: all of them when spectating with full view,
-- otherwise allied units and those in line of sight, never radar contacts.
local units = {}
local function gatherUnits()
  local n = 0
  local _, fullView = spGetSpectatingState()
  local myAlly = spGetMyAllyTeamID()
  for _, id in ipairs(spGetVisibleUnits(-1, nil, false) or {}) do
    if n >= MAX_UNITS then break end
    local ok = fullView
    if not ok then
      local los = spGetUnitLosState(id, myAlly)
      ok = los and los.los
    end
    if ok then
      n = n + 1
      units[n] = id
    end
  end
  for i = n + 1, #units do units[i] = nil end
  return n
end

local function drawFeatureDepth()
  gl.Clear(GL.DEPTH_BUFFER_BIT, 1)
  featureVAO:Submit()
end

function widget:DrawWorld()
  if refreshFeatures() == 0 then return end
  local n = gatherUnits()
  if n == 0 then return end
  unitIBO:InstanceDataFromUnitIDs(units, 6)
  unitVAO:ClearSubmission()
  unitVAO:AddUnitsToSubmission(units)

  gl.Culling(GL.BACK)
  gl.DepthMask(true)
  gl.DepthTest(GL.LEQUAL)
  gl.UseShader(depthShader)
  gl.ActiveFBO(depthFBO, drawFeatureDepth)

  gl.DepthTest(false)
  gl.DepthMask(false)
  gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
  gl.UseShader(silhouetteShader)
  gl.Uniform(viewSizeLoc, vsx, vsy)
  gl.Uniform(viewPosLoc, vpx, vpy)
  gl.Uniform(mapSizeLoc, Game.mapSizeX, Game.mapSizeZ)
  gl.Texture(0, depthTex)
  gl.Texture(1, "$heightmap")
  unitVAO:Submit()
  gl.Texture(1, false)
  gl.Texture(0, false)
  gl.UseShader(0)

  gl.Culling(false)
  gl.DepthTest(GL.LEQUAL)
  gl.DepthMask(true)
end

function widget:Shutdown()
  WG.xrayUnitSilhouettes = nil
  if depthShader then gl.DeleteShader(depthShader) end
  if silhouetteShader then gl.DeleteShader(silhouetteShader) end
  if depthFBO then gl.DeleteFBO(depthFBO) end
  if depthTex then gl.DeleteTexture(depthTex) end
  for _, o in ipairs({ featureVAO, unitVAO, featureIBO, unitIBO, vertexVBO, indexVBO }) do
    if o and o.Delete then o:Delete() end
  end
end
