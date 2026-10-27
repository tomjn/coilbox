-- Run: luajit lua/blueprint-widget/tests/terrain_test.lua
--
-- The preview of a blueprint's terrain steps (issue #4796): which heightmap
-- corners each step sets, and the mesh of the volume, its wire and the grid on
-- the ground.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local TERRAIN = support.module("terrain.lua")
local MODEL = support.module("model.lua")

local function flat(x, z)
	return 100
end

local function corner(list, x, z)
	for _, p in ipairs(list) do
		if p.x == x and p.z == z then
			return p
		end
	end
	return nil
end

-- The engine's Lua numbers are 32 bit floats, exact for integers only up to
-- 2^24. A step on a big map, drawn with keys built into one large number, put
-- every corner of a row under one key and drew a sliver (issue #4796).
check("a corner's key is a string, or a number small enough for the engine's Lua to hold exactly", (function()
	for _, at in ipairs({ { 0, 0 }, { 3280, 1024 }, { 8000, 8000 }, { 16000, 16000 } }) do
		local k = TERRAIN.key(at[1], at[2])
		if type(k) ~= "string" and not (k >= 0 and k < 2 ^ 24) then
			return false
		end
	end
	return true
end)())
check("corners one square apart have different keys, wherever they are", TERRAIN.key(3280, 960) ~= TERRAIN.key(3288, 960) and TERRAIN.key(3280, 960) ~= TERRAIN.key(3280, 968) and TERRAIN.key(16000, 16000) ~= TERRAIN.key(16008, 16000))
check("a step far from the origin sets as many corners as the same step at the origin", (function()
	local function count(dx, dz)
		return #TERRAIN.corners({ kind = "level", shape = "area", points = { { x = dx, z = dz }, { x = dx + 128, z = dz }, { x = dx + 128, z = dz + 128 }, { x = dx, z = dz + 128 } }, height = 24, base = 100 }, flat)
	end
	return count(0, 0) == count(3152, 960) and count(0, 0) == count(16000, 16000) and count(0, 0) == 19 * 19
end)())

check("the mesh has the vertex format the widget's buffer uses", TERRAIN.STRIDE == MODEL.STRIDE)

--------------------------------------------------------------------------------
-- the corners a step sets
--------------------------------------------------------------------------------

local wall = { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 48, z = 0 } }, height = 64, base = 100 }
local corners = TERRAIN.corners(wall, flat)
check("a wall sets the 5 by 5 corners round each point on its path, a point every 16", #corners == 11 * 5, tostring(#corners))
check("they run from 16 before the start to 16 after the end", corner(corners, -16, -16) ~= nil and corner(corners, 64, 16) ~= nil and corner(corners, 72, 0) == nil)
check("a raise aims at the ground there plus its height", corner(corners, 0, 0).aim == 164)
check("a raise follows the ground", (function()
	local hilly = TERRAIN.corners(wall, function(x)
		return 100 + x
	end)
	return corner(hilly, 0, 0).aim == 164 and corner(hilly, 40, 0).aim == 204
end)())
local snapped = TERRAIN.corners({ kind = "level", shape = "wall", points = { { x = 5, z = 3 }, { x = 5, z = 3 } }, height = 8, base = 100 }, flat)
check("a wall's points are snapped to 16, as Zero-K does", corner(snapped, 0, 0) ~= nil and corner(snapped, -16, -16) ~= nil and #snapped == 25, tostring(#snapped))
check("a level aims at the ground under the pivot plus its height wherever the ground is", corner(snapped, 0, 0).aim == 108)

local area = TERRAIN.corners({ kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 }, { x = 0, z = 64 } }, height = 0, base = 100 }, flat)
check("an area sets the corners inside its outline", corner(area, 32, 32) ~= nil and corner(area, 40, 40) ~= nil and corner(area, 200, 200) == nil and #area > 0, tostring(#area))
check("they are all on the 8 elmo grid", (function()
	for _, p in ipairs(area) do
		if p.x % 8 ~= 0 or p.z % 8 ~= 0 then
			return false
		end
	end
	return true
end)())
check("none is counted twice", (function()
	local seen = {}
	for _, p in ipairs(area) do
		local k = p.x .. "," .. p.z
		if seen[k] then
			return false
		end
		seen[k] = true
	end
	return true
end)())

local ramp = TERRAIN.corners({ kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 128, z = 0 } }, heights = { 0, 64 }, width = 48, base = 100 }, flat)
check("a ramp sets the corners in a band as wide as it, from end to end", corner(ramp, 0, 0) ~= nil and corner(ramp, 128, 24) ~= nil and corner(ramp, 64, 32) == nil and corner(ramp, 136, 0) == nil, tostring(#ramp))
check("each is at the height along the ramp", corner(ramp, 0, 0).aim == 100 and corner(ramp, 64, 0).aim == 132 and corner(ramp, 128, 0).aim == 164)
check("a ramp may not climb more than Zero-K's gradient", (function()
	local steep = TERRAIN.corners({ kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, heights = { 0, 1000 }, width = 48, base = 0 }, flat)
	return corner(steep, 64, 0).aim == 320
end)())
check("a smooth step has corners and no height of its own", corner(TERRAIN.corners({ kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 } }, base = 100 }, flat), 16, 8).aim == nil)

--------------------------------------------------------------------------------
-- the mesh
--------------------------------------------------------------------------------

local function vertex(mesh, i)
	local o = i * TERRAIN.STRIDE
	local v = mesh.verts
	return { x = v[o + 1], y = v[o + 2], z = v[o + 3], r = v[o + 4 + 2], g = v[o + 5 + 2], b = v[o + 6 + 2], a = v[o + 7 + 2] }
end

local mesh = TERRAIN.mesh({ wall }, flat)
-- 10 by 4 cells under a wall of two points, 48 apart
local topQuads, sideQuads = 10 * 4, 2 * (10 + 4)
check("a raised wall is a face for each cell of its top and each unit of its sides", mesh.faces == (topQuads + sideQuads) * 6, tostring(mesh.faces))
check("nothing is dug", mesh.downFaces == 0 and mesh.downWire == 0)
check("indices point at vertices that exist", (function()
	local most = #mesh.verts / TERRAIN.STRIDE
	for _, i in ipairs(mesh.idx) do
		if i < 0 or i >= most then
			return false
		end
	end
	return #mesh.idx == mesh.faces + mesh.wire + mesh.downFaces + mesh.downWire + mesh.grid
end)())
check("the faces are green and see-through", (function()
	local v = vertex(mesh, mesh.idx[1])
	return v.r == 0 and v.g == 1 and v.b == 0 and v.a == TERRAIN.FACE_ALPHA
end)())
check("the top of the volume is at the target height and the foot of a side at the ground", (function()
	local top, foot = false, false
	for i = 0, #mesh.verts / TERRAIN.STRIDE - 1 do
		local v = vertex(mesh, i)
		if v.a == TERRAIN.FACE_ALPHA then
			top = top or v.y == 164
			foot = foot or v.y == 100
		end
	end
	return top and foot
end)())
check("the wire is green and nearly opaque, and the ground grid is cyan", (function()
	local wire = vertex(mesh, mesh.idx[mesh.faces + 1])
	local grid = vertex(mesh, mesh.idx[mesh.faces + mesh.wire + 1])
	return wire.g == 1 and wire.r == 0 and wire.a == TERRAIN.COLORS.wireRaise[4] and grid.g == 0.7 and grid.b == 0.7 and grid.a == 0.6
end)())
check("the wire and the grid are lines, a pair of indices each", mesh.wire % 2 == 0 and mesh.grid % 2 == 0 and mesh.wire > 0 and mesh.grid > 0)
check("the grid lies just over the ground", (function()
	local g = vertex(mesh, mesh.idx[mesh.faces + mesh.wire + 1])
	return g.y == 100 + TERRAIN.GROUND_LIFT
end)())
check("the grid is every 16 elmos, so a 10 by 4 cell top has far fewer lines than cell edges", mesh.grid / 2 < 10 * 5 + 11 * 4, tostring(mesh.grid / 2))

local dig = TERRAIN.mesh({ { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 48, z = 0 } }, height = -30, base = 100 } }, flat)
check("dug ground is red, and is kept apart because it is under the terrain", dig.faces == 0 and dig.downFaces == (topQuads + sideQuads) * 6 and (function()
	local v = vertex(dig, dig.idx[1])
	return v.r == 1 and v.g == 0 and v.b == 0 and v.a == TERRAIN.FACE_ALPHA
end)())
check("its wire is the dug colour", (function()
	local v = vertex(dig, dig.idx[dig.downFaces + 1])
	return v.r == 0.8 and v.g == 0.4 and v.b == 0.3
end)())

local smooth = TERRAIN.mesh({ { kind = "smooth", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 }, { x = 0, z = 64 } }, base = 100 } }, flat)
check("a smooth step has no volume, only the grid on the ground", smooth.faces == 0 and smooth.downFaces == 0 and smooth.wire == 0 and smooth.grid > 0)

local flatLevel = TERRAIN.mesh({ { kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 }, { x = 0, z = 64 } }, height = 0, base = 100 } }, flat)
check("a level at the height the ground already is has no volume either", flatLevel.faces == 0 and flatLevel.downFaces == 0 and flatLevel.grid > 0)

local uneven = TERRAIN.mesh({ { kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 64 }, { x = 0, z = 64 } }, height = 0, base = 100 } }, function(x)
	return x < 32 and 60 or 140
end)
check("a level over ground that is partly under it and partly over it is green where it fills and red where it cuts", uneven.faces > 0 and uneven.downFaces > 0)

local ramped = TERRAIN.mesh({ { kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 64, z = 0 } }, heights = { 0, 32 }, width = 48, base = 100 } }, flat)
check("a ramp's top slopes from one end to the other", (function()
	local lowest, highest = math.huge, -math.huge
	for i = 0, #ramped.verts / TERRAIN.STRIDE - 1 do
		local v = vertex(ramped, i)
		if v.a == TERRAIN.FACE_ALPHA and v.y > 100 then
			lowest, highest = math.min(lowest, v.y), math.max(highest, v.y)
		end
	end
	return lowest > 100 and highest == 132 and lowest < 112
end)(), show(ramped.faces))

local capped = TERRAIN.mesh({ { kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 1000, z = 0 }, { x = 1000, z = 1000 }, { x = 0, z = 1000 } }, height = 20, base = 100 } }, flat)
check("a step with too many cells to rebuild as the cursor moves is left out and counted", capped.capped == 1 and capped.faces == 0 and capped.grid == 0 and #capped.idx == 0)
check("no steps, an empty mesh", #TERRAIN.mesh({}, flat).idx == 0 and #TERRAIN.mesh(nil, flat).idx == 0)

local two = TERRAIN.mesh({ wall, wall }, flat)
check("two steps are two meshes in one", two.faces == mesh.faces * 2 and two.wire == mesh.wire * 2)

--------------------------------------------------------------------------------
-- the faces are made of the right triangles
--------------------------------------------------------------------------------

--- The triangles of the faces in a mesh, each as three { x, y, z }, from the
-- index list read as a triangle list, which is how the widget draws it.
local function triangles(mesh, from, count)
	local out = {}
	for i = from + 1, from + count, 3 do
		local tri = {}
		for k = 0, 2 do
			local o = mesh.idx[i + k] * TERRAIN.STRIDE
			tri[k + 1] = { x = mesh.verts[o + 1], y = mesh.verts[o + 2], z = mesh.verts[o + 3] }
		end
		out[#out + 1] = tri
	end
	return out
end

local function flatArea(t)
	return math.abs((t[2].x - t[1].x) * (t[3].z - t[1].z) - (t[3].x - t[1].x) * (t[2].z - t[1].z)) / 2
end

local function checkFaces(name, step, heights)
	local m = TERRAIN.mesh({ step }, heights or flat)
	check(name .. ": the index list is whole triangles", m.faces % 3 == 0 and m.faces > 0, tostring(m.faces))
	check(name .. ": the vertices are whole vertices", #m.verts % TERRAIN.STRIDE == 0)
	local tris = triangles(m, 0, m.faces)
	local cells = TERRAIN.corners(step, heights or flat)
	local at = {}
	for _, p in ipairs(cells) do
		at[p.x .. "," .. p.z] = p
	end
	local tops, topArea, aim = 0, 0, nil
	local inside = true
	local longest = 0
	for _, t in ipairs(tris) do
		for _, v in ipairs(t) do
			-- every vertex is a corner of the shape, at its height or on the ground
			local p = at[v.x .. "," .. v.z]
			if not p or (v.y ~= p.aim and v.y ~= (heights or flat)(v.x, v.z)) then
				inside = false
			end
		end
		-- a side stands straight up, so only a top has any ground under it
		if flatArea(t) > 0 then
			tops = tops + 1
			topArea = topArea + flatArea(t)
		end
		for k = 1, 3 do
			local a, b = t[k], t[k % 3 + 1]
			longest = math.max(longest, math.sqrt((a.x - b.x) ^ 2 + (a.z - b.z) ^ 2))
		end
	end
	check(name .. ": every vertex is a corner the step sets, at its height or the ground's", inside)
	check(name .. ": no triangle reaches further across than a heightmap square's diagonal", longest <= 8 * math.sqrt(2) + 1e-9, tostring(longest))
	return m, tris, topArea, tops
end

local function cellsOf(list)
	local at = {}
	for _, p in ipairs(list) do
		at[p.x .. "," .. p.z] = true
	end
	local n = 0
	for _, p in ipairs(list) do
		if at[(p.x + 8) .. "," .. p.z] and at[p.x .. "," .. (p.z + 8)] and at[(p.x + 8) .. "," .. (p.z + 8)] then
			n = n + 1
		end
	end
	return n
end

local rectangle = { kind = "level", shape = "area", points = { { x = 0, z = 0 }, { x = 64, z = 0 }, { x = 64, z = 32 }, { x = 0, z = 32 } }, height = 24, base = 100 }
local _, _, rectTop, rectTops = checkFaces("a rectangle", rectangle)
check("a rectangle: its top is as much ground as the corners it sets enclose", rectTop == cellsOf(TERRAIN.corners(rectangle, flat)) * 64 and rectTops == cellsOf(TERRAIN.corners(rectangle, flat)) * 2, rectTop .. " " .. rectTops)
check("a rectangle: that is the 80 by 48 Zero-K makes of a 64 by 32 outline snapped to 16", rectTop == 80 * 48, tostring(rectTop))

local slab = { kind = "ramp", shape = "wall", points = { { x = 0, z = 0 }, { x = 128, z = 0 } }, heights = { 24, 0 }, width = 48, base = 100 }
local _, slabTris, slabTop = checkFaces("a ramp", slab)
check("a ramp: its top is as much ground as the corners it sets enclose", slabTop == cellsOf(TERRAIN.corners(slab, flat)) * 64, tostring(slabTop))
check("a ramp: the slab is 128 long and 48 wide", slabTop == 128 * 48, tostring(slabTop))
check("a ramp: its top triangles slope, none is horizontal off the ground", (function()
	local sloped = 0
	for _, t in ipairs(slabTris) do
		if flatArea(t) > 0 and not (t[1].y == t[2].y and t[2].y == t[3].y) then
			sloped = sloped + 1
		end
	end
	return sloped > 0
end)())
check("a ramp: nothing is stretched across the slab", (function()
	for _, t in ipairs(slabTris) do
		local xs = { t[1].x, t[2].x, t[3].x }
		if math.max(unpack and unpack(xs) or table.unpack(xs)) - math.min(unpack and unpack(xs) or table.unpack(xs)) > 8 then
			return false
		end
	end
	return true
end)())

local wallShape = { kind = "raise", shape = "wall", points = { { x = 0, z = 0 }, { x = 48, z = 0 } }, height = 64, base = 100 }
local _, _, wallTop = checkFaces("a wall", wallShape)
check("a wall: its top is 80 by 32", wallTop == 80 * 32, tostring(wallTop))

-- over ground that is not flat
local hills = function(x, z)
	return 100 + (x % 24) + (z % 16)
end
checkFaces("a rectangle over uneven ground", rectangle, hills)
checkFaces("a ramp over uneven ground", slab, hills)

support.report()
