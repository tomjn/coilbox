-- Run: luajit lua/blueprint-widget/tests/terrain_test.lua
--
-- The preview of the ground a blueprint's terrain steps leave (issues #4796 and
-- #4797): the mesh of its surface, slopes included, its wire and the grid on
-- the ground. Which corners change, and to what, is terraform.lua's and its own
-- test's.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local TERRAIN = support.module("terrain.lua")
local TERRAFORM = support.module("terraform.lua")
local MODEL = support.module("model.lua")

local function flat()
	return 100
end

--- The mesh of some laid steps on ground, through the real model.
local function meshOf(steps, heightAt)
	local env = { heightAt = heightAt or flat, corners = { x = 4097, z = 4097 } }
	local session = TERRAFORM.session(env)
	session.apply(steps)
	return TERRAIN.mesh(session.changed(), env.heightAt), session
end

local function step(kind, shape, points, extra)
	local s = { kind = kind, shape = shape, points = points, base = 100, after = 0 }
	for k, v in pairs(extra or {}) do
		s[k] = v
	end
	return s
end

check("the mesh has the vertex format the widget's buffer uses", TERRAIN.STRIDE == MODEL.STRIDE)

local function vertex(mesh, i)
	local o = i * TERRAIN.STRIDE
	local v = mesh.verts
	return { x = v[o + 1], y = v[o + 2], z = v[o + 3], r = v[o + 4 + 2], g = v[o + 5 + 2], b = v[o + 6 + 2], a = v[o + 7 + 2] }
end

local wall = step("raise", "wall", { { x = 512, z = 512 }, { x = 560, z = 512 } }, { height = 64 })
local mesh = meshOf({ wall })

check("a raised wall is faces, wire and a grid", mesh.faces > 0 and mesh.wire > 0 and mesh.grid > 0 and mesh.capped == false)
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
check("the wire is green and nearly opaque, and the ground grid is cyan", (function()
	local wire = vertex(mesh, mesh.idx[mesh.faces + 1])
	local grid = vertex(mesh, mesh.idx[mesh.faces + mesh.wire + 1])
	return wire.g == 1 and wire.r == 0 and wire.a == TERRAIN.COLORS.wireRaise[4] and grid.g == 0.7 and grid.b == 0.7 and grid.a == 0.6
end)())
check("the wire and the grid are lines, a pair of indices each", mesh.wire % 2 == 0 and mesh.grid % 2 == 0)
check("the grid lies just over the ground", (function()
	local g = vertex(mesh, mesh.idx[mesh.faces + mesh.wire + 1])
	return g.y == 100 + TERRAIN.GROUND_LIFT
end)())

--------------------------------------------------------------------------------
-- the slopes
--------------------------------------------------------------------------------

check("the surface reaches the top and runs down the slope to the ground", (function()
	local heights = {}
	for i = 0, #mesh.verts / TERRAIN.STRIDE - 1 do
		local v = vertex(mesh, i)
		if v.a == TERRAIN.FACE_ALPHA then
			heights[v.y] = true
		end
	end
	-- 64 on top, 36 and 8 down the slope, the lip of 4 and the ground at 0, all
	-- over a base of 100
	return heights[164] and heights[136] and heights[108] and heights[104] and heights[100]
end)())
check("the grid on the ground covers the slope as well as the step", (function()
	local lowest, highest = math.huge, -math.huge
	for i = mesh.faces + mesh.wire, mesh.faces + mesh.wire + mesh.grid - 1 do
		local v = vertex(mesh, mesh.idx[i + 1])
		lowest, highest = math.min(lowest, v.z), math.max(highest, v.z)
	end
	-- the 5 by 5 corners of the wall's points reach 16 either side of 512, and
	-- the slope 4 squares further
	return lowest <= 512 - 16 - 3 * 8 and highest >= 512 + 16 + 3 * 8
end)())
check("a slope costs cells: the preview is wider than the wall's own top", (function()
	local bare = meshOf({ step("level", "wall", { { x = 512, z = 512 }, { x = 560, z = 512 } }, { height = 0 }) })
	return mesh.cells > 4 * 10 + 20 and bare.faces == 0
end)())

local dig = meshOf({ step("raise", "wall", { { x = 512, z = 512 }, { x = 560, z = 512 } }, { height = -30 }) })
check("dug ground is red, and is kept apart because it is under the terrain", dig.faces == 0 and dig.downFaces > 0 and (function()
	local v = vertex(dig, dig.idx[1])
	return v.r == 1 and v.g == 0 and v.b == 0 and v.a == TERRAIN.FACE_ALPHA
end)())
check("its wire is the dug colour", (function()
	local v = vertex(dig, dig.idx[dig.downFaces + 1])
	return v.r == 0.8 and v.g == 0.4 and v.b == 0.3
end)())

local smooth = meshOf({ step("smooth", "area", { { x = 512, z = 512 }, { x = 576, z = 512 }, { x = 576, z = 576 }, { x = 512, z = 576 } }) })
check("a smooth on flat ground changes nothing, so draws nothing", #smooth.idx == 0)

local uneven = meshOf({ step("level", "area", { { x = 512, z = 512 }, { x = 576, z = 512 }, { x = 576, z = 576 }, { x = 512, z = 576 } }, { height = 0 }) }, function(x)
	return x < 544 and 60 or 140
end)
check("a level over ground that is partly under it and partly over it is green where it fills and red where it cuts", uneven.faces > 0 and uneven.downFaces > 0)

local ramped = meshOf({ step("ramp", "wall", { { x = 512, z = 512 }, { x = 576, z = 512 } }, { heights = { 0, 32 }, width = 48 }) })
check("a ramp's top slopes from one end to the other", (function()
	local lowest, highest = math.huge, -math.huge
	for i = 0, #ramped.verts / TERRAIN.STRIDE - 1 do
		local v = vertex(ramped, i)
		if v.a == TERRAIN.FACE_ALPHA and v.y > 100 then
			lowest, highest = math.min(lowest, v.y), math.max(highest, v.y)
		end
	end
	return lowest > 100 and highest > 125 and lowest < 112
end)(), show(ramped.faces))

check("too many cells to rebuild as the cursor moves, and nothing is drawn", (function()
	local big = meshOf({ step("level", "area", { { x = 512, z = 512 }, { x = 1500, z = 512 }, { x = 1500, z = 1500 }, { x = 512, z = 1500 } }, { height = 20 }) })
	return big.capped == true and big.faces == 0 and big.grid == 0 and #big.idx == 0 and big.cells > TERRAIN.CELL_LIMIT
end)())
check("no steps, an empty mesh", #TERRAIN.mesh({}, flat).idx == 0 and #TERRAIN.mesh(nil, flat).idx == 0)

--------------------------------------------------------------------------------
-- the faces are made of the right triangles
--------------------------------------------------------------------------------

--- The triangles of the faces in a mesh, each as three { x, y, z }, from the
-- index list read as a triangle list, which is how the widget draws it.
local function triangles(m, from, count)
	local out = {}
	for i = from + 1, from + count, 3 do
		local tri = {}
		for k = 0, 2 do
			local o = m.idx[i + k] * TERRAIN.STRIDE
			tri[k + 1] = { x = m.verts[o + 1], y = m.verts[o + 2], z = m.verts[o + 3] }
		end
		out[#out + 1] = tri
	end
	return out
end

local function checkFaces(name, s, heights)
	local m = meshOf({ s }, heights)
	check(name .. ": the index list is whole triangles", m.faces % 3 == 0 and m.faces > 0, tostring(m.faces))
	check(name .. ": the vertices are whole vertices", #m.verts % TERRAIN.STRIDE == 0)
	local tris = triangles(m, 0, m.faces)
	local longest = 0
	for _, t in ipairs(tris) do
		for k = 1, 3 do
			local a, b = t[k], t[k % 3 + 1]
			longest = math.max(longest, math.sqrt((a.x - b.x) ^ 2 + (a.z - b.z) ^ 2))
		end
	end
	check(name .. ": no triangle reaches further across than a heightmap square's diagonal", longest <= 8 * math.sqrt(2) + 1e-9, tostring(longest))
	return tris
end

local rectangle = step("level", "area", { { x = 512, z = 512 }, { x = 576, z = 512 }, { x = 576, z = 544 }, { x = 512, z = 544 } }, { height = 24 })
checkFaces("a rectangle", rectangle)
local slab = step("ramp", "wall", { { x = 512, z = 512 }, { x = 640, z = 512 } }, { heights = { 24, 0 }, width = 48 })
checkFaces("a ramp", slab)

local hills = function(x, z)
	return 100 + (x % 24) + (z % 16)
end
checkFaces("a rectangle over uneven ground", rectangle, hills)
checkFaces("a ramp over uneven ground", slab, hills)

-- A level step is one flat top at the pivot's ground plus its height, whatever
-- the ground under it does. A raise follows the ground. The middle of the
-- rectangle, away from its sides, is all top.
local function middleHeights(s)
	local heights, n = {}, 0
	for _, t in ipairs(checkFaces("the middle of " .. s.kind, s, hills)) do
		for _, v in ipairs(t) do
			if v.x >= 536 and v.x <= 552 and v.z >= 520 and v.z <= 536 and not heights[v.y] then
				heights[v.y] = true
				n = n + 1
			end
		end
	end
	return n, heights
end
check("a level over uneven ground has one flat top", (function()
	local n, heights = middleHeights(rectangle)
	return n == 1 and heights[124]
end)())
check("a raise over the same ground does not", middleHeights(step("raise", "area", rectangle.points, { height = 24 })) > 1)

support.report()
