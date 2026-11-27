function gadget:GetInfo()
  return {
    name = "Persepolis tower fade",
    desc = "Fades the upper part of any Persepolis tower between the camera and the street under the cursor, or mostly off the near edges of the screen",
    author = "AF",
    license = "GNU GPL, v2 or later",
    layer = 1000,
    enabled = true,
  }
end

if gadgetHandler:IsSyncedCode() then
  return
end

-- Each building is a plinth and, when taller, a part above it. The ground
-- raised inside a building stays inside the plinth, so the part above can go
-- without showing it. The part above any tower that stands between the camera
-- and the street under the cursor fades out over FADE seconds, once the
-- cursor has been on it for HOLD, and fades back the same way. So does one
-- that is mostly off the bottom or a side of the screen: a tower that near
-- the camera hides the street in front of it while showing little of itself.
-- One cut off only by the top edge is far off and hides nothing, so it stays.
--
-- This is a gadget because Lua may only hide a feature its team controls, and
-- map features belong to Gaia: a widget's Spring.SetFeatureNoDraw on one does
-- nothing. Lua cannot set a feature's alpha either, so the fade is drawn with
-- the game's own pixels. Before a part goes, the screen is copied with it
-- drawn, and its shape is drawn over the gap with that copy, projected from
-- the camera of the moment, fading away. Before it comes back the screen is
-- copied without it, and that copy is drawn over it, fading away. Whatever
-- shading the game uses, the fade shows it.
--
-- The engine also fades features at a distance, which would show the ground
-- inside a building. Buildings are kept out of that fade. Games whose model
-- shaders take a feature over turn it back on, so it is set every frame.
--
-- The hidden parts are passed to LuaUI's PersepolisHiddenTowers, for the x-ray.

local FADE = 0.2 -- seconds
local fadeSeconds = FADE
local HOLD = 0.1 -- seconds
-- Less than this share of a part's box on screen, and the rest off the bottom
-- or a side, and it fades.
local ONSCREEN = 0.3

local spGetCameraPosition = Spring.GetCameraPosition
local spIsAABBInView = Spring.IsAABBInView
local spWorldToScreenCoords = Spring.WorldToScreenCoords
local spGetMouseState = Spring.GetMouseState
local spGetPixelDir = Spring.GetPixelDir
local spGetViewGeometry = Spring.GetViewGeometry
local spIsAboveMiniMap = Spring.IsAboveMiniMap
local spSetFeatureNoDraw = Spring.SetFeatureNoDraw
local spSetFeatureFade = Spring.SetFeatureFade
local spValidFeatureID = Spring.ValidFeatureID
local spGetTimer = Spring.GetTimer
local spDiffTimers = Spring.DiffTimers

local SHOWN, FADING_OUT, HIDDEN, FADING_IN = 0, 1, 2, 3

local tops = {}
local buildings = {}
local street = math.huge
local hiddenVersion = 0

local vertexVBO, indexVBO, ghostIBO, ghostVAO
local ghostShader, alphaLoc, snapLoc
local lastTimer
local now = 0

local function shaderSource()
  local vertex = [[
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
Transform between(Transform a, Transform b, float f) {
  float d = dot(a.quat, b.quat);
  vec4 q = mix(a.quat, b.quat * (d < 0.0 ? -1.0 : 1.0), f);
  float len = length(q);
  return Transform(len > 0.0 ? q / len : a.quat, mix(a.trSc, b.trSc, f));
}

uniform mat4 snapViewProj;
out vec4 snapPos;

void main() {
  uint piece = bonesInfo.x & 0xFFu;
  uint first = instData.x + 2u * (1u + piece);
  Transform pieceT = between(transforms[first], transforms[first + 1u], timeInfo.w);
  if (pieceT.trSc.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  Transform world = between(transforms[instData.x], transforms[instData.x + 1u], timeInfo.w);
  vec4 p = vec4(apply(world, apply(pieceT, pos)), 1.0);
  snapPos = snapViewProj * p;
  gl_Position = cameraViewProj * p;
}
]]
  local fragment = [[
#version 430 core
uniform sampler2D snapshot;
uniform float alpha;
in vec4 snapPos;
out vec4 fragColor;
void main() {
  vec2 at = snapPos.xy / snapPos.w * 0.5 + 0.5;
  fragColor = vec4(texture(snapshot, at).rgb, alpha);
}
]]
  return vertex, fragment
end

-- The part above a plinth, as a box: the footprint as a square on its longer
-- side, so a turned building is still inside, from the plinth to the roof.
-- A part whose footprint holds ground higher than its plinth, as the one
-- vertex raised for aircraft inside the tallest building is, never fades.
local function topOf(id, defID)
  local def = FeatureDefs[defID]
  local x, y, z = Spring.GetFeaturePosition(id)
  local half = math.max(def.xsize, def.zsize) * 4
  local plinth = tonumber(def.customParams and def.customParams.plinth)
  if not plinth then return nil end
  local high = -math.huge
  for gz = math.floor((z - half - 8) / 8) * 8, z + half + 8, 8 do
    for gx = math.floor((x - half - 8) / 8) * 8, x + half + 8, 8 do
      high = math.max(high, Spring.GetGroundHeight(gx, gz))
    end
  end
  return {
    id = id,
    def = defID,
    box = { x - half, y + plinth, z - half, x + half, y + def.height, z + half },
    fades = high <= y + plinth,
    base = y,
    state = SHOWN,
    -- How much of the part shows, 0 to 1, and whether the engine draws it.
    shown = 1,
    drawn = true,
    since = nil,
    -- Waiting for a copy of the screen before it can change direction.
    pending = false,
    snap = nil,
    nextSnap = nil,
  }
end

local function publish()
  local ids = {}
  for _, t in ipairs(tops) do
    if not t.drawn then ids[t.id] = true end
  end
  hiddenVersion = hiddenVersion + 1
  if Script.LuaUI("PersepolisHiddenTowers") then
    Script.LuaUI.PersepolisHiddenTowers(hiddenVersion, ids)
  end
end

-- A copy of the screen and the camera it was taken from, shared by every part
-- that changed direction in the same frame.
local function release(snap)
  if not snap then return end
  snap.users = snap.users - 1
  if snap.users <= 0 then gl.DeleteTexture(snap.tex) end
end

local function goodbye(why)
  Spring.Echo("Persepolis tower fade: off, " .. why)
  gadgetHandler:RemoveGadget(gadget)
end

function gadget:Initialize()
  for _, id in ipairs(Spring.GetAllFeatures()) do
    local defID = Spring.GetFeatureDefID(id)
    local name = FeatureDefs[defID].name
    if name:sub(1, 4) == "pst_" then
      local t = topOf(id, defID)
      if t then
        tops[#tops + 1] = t
        street = math.min(street, t.base)
      end
    end
    if name:sub(1, 4) == "pst_" or (name:sub(1, 4) == "psp_" and name:sub(1, 12) ~= "psp_bollards" and name:sub(1, 10) ~= "psp_street") then
      buildings[#buildings + 1] = id
    end
  end
  if #tops == 0 then
    return goodbye("no building parts above a plinth")
  end
  if not (gl.GetVBO and gl.GetVAO and gl.GetEngineUniformBufferDef and Engine.FeatureSupport and Engine.FeatureSupport.transformsInGL4) then
    return goodbye("this engine has no GL4 model drawing with quaternion transforms")
  end
  vertexVBO = gl.GetVBO(GL.ARRAY_BUFFER, false)
  indexVBO = gl.GetVBO(GL.ELEMENT_ARRAY_BUFFER, false)
  if not (vertexVBO and indexVBO) then
    return goodbye("no vertex buffers, as in a headless engine")
  end
  vertexVBO:ModelsVBO()
  indexVBO:ModelsVBO()
  ghostIBO = gl.GetVBO(GL.ARRAY_BUFFER, true)
  ghostIBO:Define(1, { { id = 6, name = "instData", type = GL.UNSIGNED_INT, size = 4 } })
  ghostVAO = gl.GetVAO()
  ghostVAO:AttachVertexBuffer(vertexVBO)
  ghostVAO:AttachIndexBuffer(indexVBO)
  ghostVAO:AttachInstanceBuffer(ghostIBO)
  local vertex, fragment = shaderSource()
  ghostShader = gl.CreateShader({ vertex = vertex, fragment = fragment, uniformInt = { snapshot = 0 } })
  if not ghostShader then
    return goodbye("the shader did not compile: " .. tostring(gl.GetShaderLog()))
  end
  alphaLoc = gl.GetUniformLocation(ghostShader, "alpha")
  snapLoc = gl.GetUniformLocation(ghostShader, "snapViewProj")
  lastTimer = spGetTimer()
  local fixed = 0
  for _, t in ipairs(tops) do
    if not t.fades then fixed = fixed + 1 end
  end
  Spring.Echo(string.format("Persepolis tower fade: on, %d building tops, %d of them held for the ground inside", #tops, fixed))
end

-- Where the line from the camera through the cursor meets the street, or nil.
-- A test run sets PersepolisFadeTestCursor to "x y" in its own settings, so
-- it can point at a tower without moving the player's real cursor. An
-- optional third number replaces FADE, so a screenshot can land mid fade.
local function cursorLine()
  local mx, my, _, _, _, offscreen = spGetMouseState()
  local test = Spring.GetConfigString("PersepolisFadeTestCursor", "")
  if test ~= "" then
    local tx, ty, seconds = test:match("^(%-?%d+) (%-?%d+) ?([%d%.]*)$")
    if tx then mx, my, offscreen = tonumber(tx), tonumber(ty), false end
    if tonumber(seconds) then fadeSeconds = tonumber(seconds) end
  end
  if offscreen or spIsAboveMiniMap(mx, my) then return nil end
  local _, vsy = spGetViewGeometry()
  local dx, dy, dz = spGetPixelDir(mx, vsy - 1 - my)
  if dy >= 0 then return nil end
  local cx, cy, cz = spGetCameraPosition()
  local k = (street - cy) / dy
  return cx, cy, cz, cx + dx * k, street, cz + dz * k
end

-- Whether the segment from a to b passes through a box.
local function crosses(b, ax, ay, az, bx, by, bz)
  local t0, t1 = 0, 1
  local a = { ax, ay, az }
  local d = { bx - ax, by - ay, bz - az }
  for k = 1, 3 do
    local lo, hi = b[k], b[k + 3]
    if math.abs(d[k]) < 1e-9 then
      if a[k] < lo or a[k] > hi then return false end
    else
      local u0 = (lo - a[k]) / d[k]
      local u1 = (hi - a[k]) / d[k]
      if u0 > u1 then u0, u1 = u1, u0 end
      t0 = math.max(t0, u0)
      t1 = math.min(t1, u1)
      if t0 > t1 then return false end
    end
  end
  return true
end

-- Whether a part's box is mostly off the bottom or a side of the screen.
local function nearEdge(b, vsx, vsy)
  if not spIsAABBInView(b[1], b[2], b[3], b[4], b[5], b[6]) then return false end
  local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
  for i = 0, 7 do
    local sx, sy, sz = spWorldToScreenCoords(
      i % 2 == 0 and b[1] or b[4],
      math.floor(i / 2) % 2 == 0 and b[2] or b[5],
      i < 4 and b[3] or b[6]
    )
    -- A corner behind the camera: the part is right over it.
    if sz > 1 then return true end
    x0, y0, x1, y1 = math.min(x0, sx), math.min(y0, sy), math.max(x1, sx), math.max(y1, sy)
  end
  if not (y0 < 0 or x0 < 0 or x1 > vsx) then return false end
  local area = (x1 - x0) * (y1 - y0)
  if area <= 0 then return false end
  local seen = math.max(0, math.min(x1, vsx) - math.max(x0, 0)) * math.max(0, math.min(y1, vsy) - math.max(y0, 0))
  return seen / area < ONSCREEN
end

function gadget:Update()
  if not ghostShader then return end
  local timer = spGetTimer()
  local dt = spDiffTimers(timer, lastTimer)
  lastTimer = timer
  now = now + dt

  for i = 1, #buildings do
    spSetFeatureFade(buildings[i], false)
  end

  local ax, ay, az, bx, by, bz = cursorLine()
  local vsx, vsy = spGetViewGeometry()
  local changed = false
  for _, t in ipairs(tops) do
    if not t.drawn then spSetFeatureNoDraw(t.id, true) end
    -- A copy of the screen came in: the part now goes, or comes back.
    if t.pending and t.nextSnap then
      release(t.snap)
      t.snap, t.nextSnap, t.pending = t.nextSnap, nil, false
      if t.drawn ~= (t.state == FADING_IN) then
        t.drawn = t.state == FADING_IN
        spSetFeatureNoDraw(t.id, not t.drawn)
        changed = true
      end
    end
    local wanted = t.fades
      and ((ax ~= nil and crosses(t.box, ax, ay, az, bx, by, bz)) or nearEdge(t.box, vsx, vsy))
    -- A change of direction waits HOLD before it starts, so a cursor crossing
    -- the edge of a tower does not flicker it.
    local out = t.state == FADING_OUT or t.state == HIDDEN
    if wanted ~= out then
      t.since = t.since or now
      if now - t.since >= HOLD then
        t.since = nil
        t.state = wanted and FADING_OUT or FADING_IN
        t.pending, t.nextSnap = true, nil
      end
    else
      t.since = nil
    end
    if not t.pending then
      if t.state == FADING_OUT then
        t.shown = math.max(0, t.shown - dt / fadeSeconds)
        if t.shown <= 0 then
          t.state = HIDDEN
          release(t.snap)
          t.snap = nil
        end
      elseif t.state == FADING_IN then
        t.shown = math.min(1, t.shown + dt / fadeSeconds)
        if t.shown >= 1 then
          t.state = SHOWN
          release(t.snap)
          t.snap = nil
        end
      end
    end
  end
  if changed then publish() end
end

-- The screen as it is now, before any part's copy is drawn on it this frame.
local function takeSnapshot()
  local vsx, vsy, vpx, vpy = spGetViewGeometry()
  local tex = gl.CreateTexture(vsx, vsy, {
    border = false,
    min_filter = GL.LINEAR,
    mag_filter = GL.LINEAR,
    wrap_s = GL.CLAMP_TO_EDGE,
    wrap_t = GL.CLAMP_TO_EDGE,
  })
  if not tex then return nil end
  gl.CopyToTexture(tex, 0, 0, vpx, vpy, vsx, vsy)
  gl.Texture(false)
  return { tex = tex, mat = { gl.GetMatrixData("viewprojection") }, users = 0 }
end

-- A part's shape drawn over it with a copy of the screen: with the part in
-- it while the part is hidden, without it while the engine draws it.
local function drawCopy(t)
  if not spValidFeatureID(t.id) or not t.snap then return end
  local alpha = t.drawn and (1 - t.shown) or t.shown
  if alpha <= 0 then return end
  ghostIBO:InstanceDataFromFeatureIDs(t.id, 6)
  ghostVAO:ClearSubmission()
  ghostVAO:AddFeaturesToSubmission(t.id)
  gl.Texture(0, t.snap.tex)
  gl.Uniform(alphaLoc, alpha)
  gl.UniformMatrix(snapLoc, unpack(t.snap.mat))
  -- Depth first, so the copy's own far side never shows through it.
  gl.ColorMask(false, false, false, false)
  ghostVAO:Submit()
  gl.ColorMask(true, true, true, true)
  ghostVAO:Submit()
end

function gadget:DrawWorld()
  if not ghostShader then return end
  local snap
  for _, t in ipairs(tops) do
    if t.pending and not t.nextSnap then
      snap = snap or takeSnapshot()
      if snap then
        snap.users = snap.users + 1
        t.nextSnap = snap
      end
    end
  end
  local any = false
  for _, t in ipairs(tops) do
    if t.snap and t.state ~= SHOWN and t.state ~= HIDDEN then
      if not any then
        any = true
        gl.UseShader(ghostShader)
        gl.Culling(GL.BACK)
        gl.DepthTest(GL.LEQUAL)
        gl.DepthMask(true)
        gl.Blending(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA)
      end
      drawCopy(t)
    end
  end
  if any then
    gl.Texture(0, false)
    gl.UseShader(0)
    gl.Culling(false)
    gl.Blending(false)
  end
end

function gadget:Shutdown()
  for _, t in ipairs(tops) do
    if spValidFeatureID(t.id) and not t.drawn then spSetFeatureNoDraw(t.id, false) end
    release(t.snap)
    release(t.nextSnap)
  end
  if ghostShader then gl.DeleteShader(ghostShader) end
  for _, o in ipairs({ ghostVAO, ghostIBO, vertexVBO, indexVBO }) do
    if o and o.Delete then o:Delete() end
  end
end
