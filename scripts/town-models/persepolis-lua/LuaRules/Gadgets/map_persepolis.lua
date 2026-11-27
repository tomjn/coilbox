function gadget:GetInfo()
  return {
    name = "Persepolis buildings",
    desc = "Lifts aircraft over Persepolis's buildings and makes its bollards block movement but not shots",
    author = "AF",
    license = "GNU GPL, v2 or later",
    layer = 10,
    enabled = true,
  }
end

if not gadgetHandler:IsSyncedCode() then
  return
end

-- Aircraft fly over the engine's smooth mesh, which follows the terrain. The
-- buildings are map features, not terrain, so this raises the mesh over each
-- one to its roof, falling away round it so aircraft climb before they reach it.

-- How far the raised mesh falls per elmo outward from a roof.
local FALL = 1.0
-- The cell this works in, in elmos. The engine's mesh is 16 by default.
local CELL = 16
-- The edge of a roof is taken this far out past the building's footprint.
local MARGIN = 16
-- Each frame one 512 elmo quad of the mesh is checked and lifted again if a
-- crater has rebuilt it from the terrain. 512 is the engine's update quad.
local QUAD = 512
local CHECK_EVERY = 3

local PREFIX = "psp_"
-- A building's part above its plinth, which carries its roof.
local TOP = "pst_"
local BOLLARDS = "psp_bollards"
local STREET = "psp_street"

local spGetFeatureDefID = Spring.GetFeatureDefID
local spGetFeaturePosition = Spring.GetFeaturePosition
local spGetFeatureHeading = Spring.GetFeatureHeading
local spGetSmoothMeshHeight = Spring.GetSmoothMeshHeight
local spSetSmoothMesh = Spring.SetSmoothMesh
local spAddSmoothMesh = Spring.AddSmoothMesh
local floor, ceil, max, min, abs, sqrt = math.floor, math.ceil, math.max, math.min, math.abs, math.sqrt

local nx, nz
-- The wanted height of the mesh at each cell's corner, 0 where nothing is wanted.
local wanted
local quadsX, quadsZ, nextQuad = 0, 0, 0
local started = false

local function buildField()
  nx = floor(Game.mapSizeX / CELL) + 1
  nz = floor(Game.mapSizeZ / CELL) + 1
  wanted = {}
  for i = 0, nx * nz - 1 do
    wanted[i] = 0
  end
  local count = 0
  local tallest = 0
  for _, id in ipairs(Spring.GetAllFeatures()) do
    local fd = FeatureDefs[spGetFeatureDefID(id)]
    local building = fd and (fd.name:sub(1, #TOP) == TOP or (fd.name:sub(1, #PREFIX) == PREFIX and fd.name:sub(1, #BOLLARDS) ~= BOLLARDS and fd.name:sub(1, #STREET) ~= STREET))
    if building then
      local x, y, z = spGetFeaturePosition(id)
      local hx = fd.xsize * Game.squareSize / 2
      local hz = fd.zsize * Game.squareSize / 2
      if abs(abs(spGetFeatureHeading(id)) - 16384) < 4096 then
        hx, hz = hz, hx
      end
      local top = y + fd.height
      tallest = max(tallest, fd.height)
      for j = max(0, ceil((z - hz - MARGIN) / CELL)), min(nz - 1, floor((z + hz + MARGIN) / CELL)) do
        for i = max(0, ceil((x - hx - MARGIN) / CELL)), min(nx - 1, floor((x + hx + MARGIN) / CELL)) do
          local k = j * nx + i
          if wanted[k] < top then
            wanted[k] = top
          end
        end
      end
      count = count + 1
    end
  end
  -- Spread each roof outward with a fall of FALL per elmo, in two passes over
  -- the grid that each carry the height from the cells already visited.
  local straight = FALL * CELL
  local diagonal = FALL * CELL * sqrt(2)
  for j = 0, nz - 1 do
    for i = 0, nx - 1 do
      local k = j * nx + i
      local h = wanted[k]
      if i > 0 then h = max(h, wanted[k - 1] - straight) end
      if j > 0 then
        h = max(h, wanted[k - nx] - straight)
        if i > 0 then h = max(h, wanted[k - nx - 1] - diagonal) end
        if i < nx - 1 then h = max(h, wanted[k - nx + 1] - diagonal) end
      end
      wanted[k] = h
    end
  end
  for j = nz - 1, 0, -1 do
    for i = nx - 1, 0, -1 do
      local k = j * nx + i
      local h = wanted[k]
      if i < nx - 1 then h = max(h, wanted[k + 1] - straight) end
      if j < nz - 1 then
        h = max(h, wanted[k + nx] - straight)
        if i < nx - 1 then h = max(h, wanted[k + nx + 1] - diagonal) end
        if i > 0 then h = max(h, wanted[k + nx - 1] - diagonal) end
      end
      wanted[k] = h
    end
  end
  return count, tallest
end

-- Raise the mesh to the wanted height across cells i0..i1, j0..j1, never
-- lowering it. Each cell is written at both halves of its span, so a mesh
-- finer than CELL is covered too.
local function lift(i0, j0, i1, j1)
  local raised = 0
  for j = j0, j1 do
    for i = i0, i1 do
      local h = wanted[j * nx + i]
      if h > 0 then
        for dz = 0, CELL / 2, CELL / 2 do
          for dx = 0, CELL / 2, CELL / 2 do
            local x, z = i * CELL + dx, j * CELL + dz
            local now = spAddSmoothMesh(x, z, 0)
            if now and now < h then
              spSetSmoothMesh(x, z, h)
              raised = raised + 1
            end
          end
        end
      end
    end
  end
  return raised
end

local function quadNeedsLift(q)
  local qi, qj = q % quadsX, floor(q / quadsX)
  local per = QUAD / CELL
  local i0, j0 = qi * per, qj * per
  local i1, j1 = min(nx - 1, i0 + per - 1), min(nz - 1, j0 + per - 1)
  for j = j0, j1, 2 do
    for i = i0, i1, 2 do
      local h = wanted[j * nx + i]
      if h > 0 and spGetSmoothMeshHeight(i * CELL, j * CELL) < h - 1 then
        return i0, j0, i1, j1
      end
    end
  end
end

-- The bollards must stop units walking through them, but shots and the
-- weapons' line of fire checks must pass, whatever the game did to features.
local function settleBollards()
  local n = 0
  for _, id in ipairs(Spring.GetAllFeatures()) do
    local fd = FeatureDefs[spGetFeatureDefID(id)]
    if fd and fd.name:sub(1, #BOLLARDS) == BOLLARDS then
      -- blocking, solid to units, not hit by projectiles, not hit by rays, and
      -- not crushable: every feature is crushable, and the map's have mass 1,
      -- under any ground unit's crush strength, so units would walk through.
      Spring.SetFeatureBlocking(id, true, true, false, false, false)
      n = n + 1
    elseif fd and fd.name:sub(1, #STREET) == STREET then
      -- Lamps, signals and trees block nothing: not units, shots or rays.
      Spring.SetFeatureBlocking(id, false, false, false, false)
    end
  end
  return n
end

-- Some aircraft fly over the terrain rather than the mesh, as Splinter
-- Faction's gunships, air engineers and transports do, and would fly through
-- the buildings. On this map every aircraft follows the mesh.
function gadget:UnitCreated(unitID, unitDefID)
  local ud = UnitDefs[unitDefID]
  if ud.isHoveringAirUnit then
    Spring.MoveCtrl.SetGunshipMoveTypeData(unitID, "useSmoothMesh", true)
  elseif ud.isStrafingAirUnit then
    Spring.MoveCtrl.SetAirMoveTypeData(unitID, "useSmoothMesh", true)
  end
end

function gadget:GameFrame(f)
  if not started then
    started = true
    local count, tallest = buildField()
    local raised = Spring.SetSmoothMeshFunc(function()
      return lift(0, 0, nx - 1, nz - 1)
    end)
    quadsX = ceil(Game.mapSizeX / QUAD)
    quadsZ = ceil(Game.mapSizeZ / QUAD)
    Spring.Echo(string.format("Persepolis: raised the air mesh over %d building features, plinths and the parts above them, the tallest %.0f elmos", count, tallest))
    Spring.Log("Persepolis", LOG.INFO, string.format("air mesh changed by %.0f", raised or 0))
  end
  -- Some games make every map feature non-blocking early in the match, as
  -- Splinter Faction does on frame 30, so the bollards are set after that.
  if f == 31 or f == 1 then
    local n = settleBollards()
    if f == 31 then
      Spring.Echo(string.format("Persepolis: %d rows of bollards block movement, not shots", n))
    end
  end
  if f % CHECK_EVERY == 0 and quadsX > 0 then
    local i0, j0, i1, j1 = quadNeedsLift(nextQuad)
    if i0 then
      Spring.SetSmoothMeshFunc(function()
        return lift(i0, j0, i1, j1)
      end)
    end
    nextQuad = (nextQuad + 1) % (quadsX * quadsZ)
  end
end
