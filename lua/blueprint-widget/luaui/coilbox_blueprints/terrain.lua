-- The preview of a blueprint's terrain steps on the ground: the volume each
-- changes, as a translucent prism with a wire grid on its top face and its
-- straight sides, and a grid on the ground under it, in the look of Zero-K's
-- own terraform preview and of Helwor's DrawTerra2 widget.
--
-- The look, the colours and the ideas of the grids follow DrawTerra2 in
-- Helwor/New-Hel-K (Widgets/DrawTerra2.lua, GPL-2.0-or-later): green for
-- raised ground (s_elev_color 0, 1, 0), a brownish red for dug ground
-- (s_dig_color 0.8, 0.4, 0.3), a cyan ground grid (s_ground_color 0, 0.7, 0.7).
-- No code is taken from it. Which corners of the heightmap a step sets follows
-- the terraform gadget, as src/blueprint/terraform.ts ports it
-- (wallSegments, areaSegments and rampSegments).
--
-- Only the step itself is drawn: the flat top and the straight sides. The
-- slopes Zero-K adds round it are issue #4797's.
--
-- The geometry is plain Lua over a height function, so a test can run it. The
-- vertices come out in the widget's vertex format (model.lua, M.STRIDE).

local M = {}

--- The engine's heightmap square in elmos, and the spacing of the grids.
M.SQUARE = 8
M.GRID = 16

--- A step with more cells than this is not drawn as a volume, since the mesh is
-- rebuilt as the cursor moves.
M.CELL_LIMIT = 4000

--- How see-through the faces of the volume are, 0 to 1. Zero-K's own preview
-- uses 0.1 on many of its lines. A filled face needs a little more to read.
M.FACE_ALPHA = 0.18

M.COLORS = {
	raise = { 0, 1, 0 },
	dig = { 1, 0, 0 },
	wireRaise = { 0, 1, 0, 0.9 },
	wireDig = { 0.8, 0.4, 0.3, 0.8 },
	ground = { 0, 0.7, 0.7, 0.6 },
}

--- How far above the ground the grid on it floats, in elmos, so it is not lost
-- in the terrain.
M.GROUND_LIFT = 1

-- The vertex format of model.lua: x, y, z, u, v, r, g, b, a, then the shape.
local STRIDE = 13

local function snap16(v)
	return math.floor((v + 8) / 16) * 16
end

local function key(x, z)
	return (math.floor(z / 8 + 0.5) + 32768) * 65536 + math.floor(x / 8 + 0.5)
end

--- The corners of the 5 by 5 round each point of a wall, TerraformWall: each
-- point snapped to 16, the gaps filled every 16.
local function wallCorners(mouse)
	local path = {}
	local prev = { x = snap16(mouse[1].x), z = snap16(mouse[1].z) }
	path[1] = prev
	for i = 2, #mouse do
		local nextPoint = { x = snap16(mouse[i].x), z = snap16(mouse[i].z) }
		local diffX, diffZ = nextPoint.x - prev.x, nextPoint.z - prev.z
		local absX, absZ = math.abs(diffX), math.abs(diffZ)
		if absX <= 16 and absZ <= 16 then
			path[#path + 1] = nextPoint
		elseif absX > absZ then
			local m, sign = diffZ / diffX, diffX / absX
			for j = 0, absX, 16 do
				path[#path + 1] = { x = prev.x + j * sign, z = math.floor((prev.z + j * m * sign) / 16) * 16 }
			end
		else
			local m, sign = diffX / diffZ, diffZ / absZ
			for j = 0, absZ, 16 do
				path[#path + 1] = { x = math.floor((prev.x + j * m * sign) / 16) * 16, z = prev.z + j * sign }
			end
		end
		prev = nextPoint
	end
	local out = {}
	for _, p in ipairs(path) do
		for lx = -16, 16, 8 do
			for lz = -16, 16, 8 do
				out[#out + 1] = { x = p.x + lx, z = p.z + lz }
			end
		end
	end
	return out
end

--- The corners inside an outline, TerraformArea: the outline closed and
-- snapped to 16, the inside found by flood fill from the edge of its box, and
-- each inside 16 elmo cell filled in at 8.
local function areaCorners(mouse)
	local function snap(p)
		return { x = math.floor(p.x / 16) * 16, z = math.floor(p.z / 16) * 16 }
	end
	local loop = {}
	for i, p in ipairs(mouse) do
		loop[i] = snap(p)
	end
	loop[#loop + 1] = snap(mouse[1])
	local border = { left = loop[1].x, right = loop[1].x, top = loop[1].z, bottom = loop[1].z }
	local cell = {}
	local function add(p)
		cell[key(p.x, p.z)] = 2
		border.left, border.right = math.min(border.left, p.x), math.max(border.right, p.x)
		border.top, border.bottom = math.min(border.top, p.z), math.max(border.bottom, p.z)
	end
	add(loop[1])
	for i = 2, #loop do
		local nextPoint = loop[i]
		local diffX, diffZ = nextPoint.x - loop[i - 1].x, nextPoint.z - loop[i - 1].z
		local absX, absZ = math.abs(diffX), math.abs(diffZ)
		if absX <= 16 and absZ <= 16 then
			add(nextPoint)
		elseif absX > absZ then
			local m, sign = diffZ / diffX, diffX / absX
			for j = 0, absX, 16 do
				add({ x = nextPoint.x - j * sign, z = math.floor((nextPoint.z - j * m * sign) / 16) * 16 })
			end
		else
			local m, sign = diffX / diffZ, diffZ / absZ
			for j = 0, absZ, 16 do
				add({ x = math.floor((nextPoint.x - j * m * sign) / 16) * 16, z = nextPoint.z - j * sign })
			end
		end
	end
	-- 2 is the outline, 1 not yet reached, -1 the flood, false flooded
	for i = border.left, border.right, 16 do
		for j = border.top, border.bottom, 16 do
			if cell[key(i, j)] ~= 2 then
				cell[key(i, j)] = 1
			end
		end
	end
	for i = border.left, border.right, 16 do
		if cell[key(i, border.top)] ~= 2 then
			cell[key(i, border.top)] = -1
		end
		if cell[key(i, border.bottom)] ~= 2 then
			cell[key(i, border.bottom)] = -1
		end
	end
	for j = border.top, border.bottom, 16 do
		if cell[key(border.left, j)] ~= 2 then
			cell[key(border.left, j)] = -1
		end
		if cell[key(border.right, j)] ~= 2 then
			cell[key(border.right, j)] = -1
		end
	end
	local flooding = true
	while flooding do
		flooding = false
		for i = border.left, border.right, 16 do
			for j = border.top, border.bottom, 16 do
				if cell[key(i, j)] == -1 then
					for _, d in ipairs({ { 16, 0 }, { -16, 0 }, { 0, 16 }, { 0, -16 } }) do
						if cell[key(i + d[1], j + d[2])] == 1 then
							cell[key(i + d[1], j + d[2])] = -1
							flooding = true
						end
					end
					cell[key(i, j)] = false
				end
			end
		end
	end
	local function inside(x, z)
		local v = cell[key(math.floor(x / 16) * 16, math.floor(z / 16) * 16)]
		return v ~= nil and v ~= false
	end
	local out = {}
	for lx = border.left, border.right, 16 do
		for lz = border.top, border.bottom, 16 do
			if inside(lx, lz) then
				for x = lx, lx + 8, 8 do
					for z = lz, lz + 8, 8 do
						out[#out + 1] = { x = x, z = z }
					end
				end
				local open, below = not inside(lx + 16, lz), not inside(lx, lz + 16)
				if open and below then
					out[#out + 1] = { x = lx + 16, z = lz + 16 }
				end
				if open then
					for z = lz, lz + 8, 8 do
						out[#out + 1] = { x = lx + 16, z = z }
					end
				end
				if below then
					for x = lx, lx + 8, 8 do
						out[#out + 1] = { x = x, z = lz + 16 }
					end
				end
			end
		end
	end
	return out
end

--- The corners in the band a ramp covers, TerraformRamp: its whole width on
-- the ground, from one end to the other, each at the height along it.
local function rampCorners(a, b, width, y1, y2)
	local dx, dz = b.x - a.x, b.z - a.z
	local length = math.sqrt(dx * dx + dz * dz)
	if length == 0 then
		return {}
	end
	-- Zero-K's gradient limit
	local rise = y2 - y1
	if rise / length > 5 then
		rise = 5 * length
	elseif rise / length < -5 then
		rise = -5 * length
	end
	local ux, uz = dx / length, dz / length
	local reach = width / 2 + length
	local out = {}
	for x = math.floor((math.min(a.x, b.x) - width / 2) / 8) * 8, math.ceil((math.max(a.x, b.x) + width / 2) / 8) * 8, 8 do
		for z = math.floor((math.min(a.z, b.z) - width / 2) / 8) * 8, math.ceil((math.max(a.z, b.z) + width / 2) / 8) * 8, 8 do
			local rx, rz = x - a.x, z - a.z
			local along = rx * ux + rz * uz
			local across = -rx * uz + rz * ux
			if along >= 0 and along <= length and math.abs(across) <= width / 2 and reach > 0 then
				out[#out + 1] = { x = x, z = z, aim = y1 + rise * along / length }
			end
		end
	end
	return out
end

--- The heightmap corners a step sets and the height each is set to.
-- @param step table a laid step from place.laySteps: kind, shape, points,
--   height or heights and width, and base, the ground under the pivot
-- @param heightAt function(x, z) -> the ground's height
-- @return table[] { x, z, aim }, aim nil for a step with no height of its own
function M.corners(step, heightAt)
	local out
	if step.kind == "ramp" then
		local a, b = step.points[1], step.points[2]
		return rampCorners(a, b, step.width or 0, step.base + step.heights[1], step.base + step.heights[2])
	elseif step.shape == "wall" then
		out = wallCorners(step.points)
	else
		out = areaCorners(step.points)
	end
	local seen, unique = {}, {}
	for _, p in ipairs(out) do
		local k = key(p.x, p.z)
		if not seen[k] then
			seen[k] = true
			if step.kind == "level" then
				p.aim = step.base + step.height
			elseif step.kind == "raise" then
				p.aim = heightAt(p.x, p.z) + step.height
			end
			unique[#unique + 1] = p
		end
	end
	return unique
end

--- The mesh of a layout's steps.
-- @param steps table[]? laid steps
-- @param heightAt function(x, z) -> the ground's height
-- @return table { verts, idx, faces, wire, downFaces, downWire, grid, capped }.
--   idx holds, one after another, the triangles of the faces over raised ground
--   (faces indices), the lines on those (wire), the same for dug ground
--   (downFaces, downWire), and the lines of the grid on the ground (grid). Dug
--   ground is under the terrain, so the widget draws it without the depth
--   test. capped is how many steps were too big to draw as volumes, which are
--   drawn as nothing.
function M.mesh(steps, heightAt)
	local verts = {}
	local lists = { faces = {}, wire = {}, downFaces = {}, downWire = {}, grid = {} }
	local count = 0
	local out = { capped = 0 }

	local function vertex(x, y, z, c)
		local v = #verts
		verts[v + 1], verts[v + 2], verts[v + 3] = x, y, z
		verts[v + 4], verts[v + 5] = 0, 0
		verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
		verts[v + 10], verts[v + 11], verts[v + 12], verts[v + 13] = 0, 0, 0, 0
		count = count + 1
		return count - 1
	end
	local function line(into, x1, y1, z1, x2, y2, z2, c)
		into[#into + 1] = vertex(x1, y1, z1, c)
		into[#into + 1] = vertex(x2, y2, z2, c)
	end
	local function quad(into, a, b, c, d)
		into[#into + 1], into[#into + 2], into[#into + 3] = a, b, c
		into[#into + 1], into[#into + 2], into[#into + 3] = b, d, c
	end

	for _, step in ipairs(steps or {}) do
		local list = M.corners(step, heightAt)
		local at = {}
		for _, p in ipairs(list) do
			at[key(p.x, p.z)] = p
		end
		-- the cells whose four corners are all set, in the order the corners
		-- were found
		local cells, cellList = {}, {}
		for _, p in ipairs(list) do
			if at[key(p.x + 8, p.z)] and at[key(p.x, p.z + 8)] and at[key(p.x + 8, p.z + 8)] then
				cells[key(p.x, p.z)] = true
				cellList[#cellList + 1] = p
			end
		end
		if #cellList > M.CELL_LIMIT then
			out.capped = out.capped + 1
		else
			local function cellAt(x, z)
				return cells[key(x, z)] == true
			end
			-- a step with no height of its own, such as a smooth, lies on the ground
			local function aimOf(p)
				return p.aim or heightAt(p.x, p.z)
			end
			local vertical = {}
			for _, p in ipairs(cellList) do
				local x, z = p.x, p.z
				local c = { p, at[key(x + 8, z)], at[key(x, z + 8)], at[key(x + 8, z + 8)] }
				local g = { heightAt(x, z), heightAt(x + 8, z), heightAt(x, z + 8), heightAt(x + 8, z + 8) }
				local mean = 0
				for i = 1, 4 do
					mean = mean + (aimOf(c[i]) - g[i]) / 4
				end
				local up = mean >= 0
				local faces, wires = up and lists.faces or lists.downFaces, up and lists.wire or lists.downWire
				if math.abs(mean) >= 0.5 then
					local rgb = up and M.COLORS.raise or M.COLORS.dig
					local face = { rgb[1], rgb[2], rgb[3], M.FACE_ALPHA }
					quad(faces, vertex(x, aimOf(c[1]), z, face), vertex(x + 8, aimOf(c[2]), z, face), vertex(x, aimOf(c[3]), z + 8, face), vertex(x + 8, aimOf(c[4]), z + 8, face))
				end
				local wire = up and M.COLORS.wireRaise or M.COLORS.wireDig
				-- Each cell's top and left edges are lines when they lie on a 16
				-- elmo line or have no cell beyond them, and its bottom and right
				-- edges only when there is no cell beyond, so a shared edge is drawn
				-- once.
				local function edge(i, j, onLine, beyond)
					if onLine or not beyond then
						local a, b = c[i], c[j]
						if math.abs(mean) >= 0.5 then
							line(wires, a.x, aimOf(a), a.z, b.x, aimOf(b), b.z, wire)
						end
						line(lists.grid, a.x, heightAt(a.x, a.z) + M.GROUND_LIFT, a.z, b.x, heightAt(b.x, b.z) + M.GROUND_LIFT, b.z, M.COLORS.ground)
					end
				end
				edge(1, 2, z % 16 == 0, cellAt(x, z - 8))
				edge(1, 3, x % 16 == 0, cellAt(x - 8, z))
				if not cellAt(x, z + 8) then
					edge(3, 4, false, false)
				end
				if not cellAt(x + 8, z) then
					edge(2, 4, false, false)
				end
				-- the straight sides, down from the top to the ground, where there
				-- is no cell beyond, with a vertical line every 16 elmos along them
				local function side(i, j, beyond, axis)
					if beyond then
						return
					end
					local a, b = c[i], c[j]
					local ga, gb = heightAt(a.x, a.z), heightAt(b.x, b.z)
					local sideMean = (aimOf(a) - ga + aimOf(b) - gb) / 2
					if math.abs(sideMean) < 0.5 then
						return
					end
					local sideUp = sideMean > 0
					local rgb = sideUp and M.COLORS.raise or M.COLORS.dig
					local face = { rgb[1], rgb[2], rgb[3], M.FACE_ALPHA }
					quad(sideUp and lists.faces or lists.downFaces, vertex(a.x, aimOf(a), a.z, face), vertex(b.x, aimOf(b), b.z, face), vertex(a.x, ga, a.z, face), vertex(b.x, gb, b.z, face))
					local sideWire = sideUp and M.COLORS.wireRaise or M.COLORS.wireDig
					for _, e in ipairs({ { a, ga }, { b, gb } }) do
						local at16 = (axis == "x" and e[1].x or e[1].z) % 16 == 0
						local k = key(e[1].x, e[1].z)
						if at16 and not vertical[k] then
							vertical[k] = true
							line(sideUp and lists.wire or lists.downWire, e[1].x, aimOf(e[1]), e[1].z, e[1].x, e[2], e[1].z, sideWire)
						end
					end
				end
				side(1, 2, cellAt(x, z - 8), "x")
				side(3, 4, cellAt(x, z + 8), "x")
				side(1, 3, cellAt(x - 8, z), "z")
				side(2, 4, cellAt(x + 8, z), "z")
			end
		end
	end

	local idx = {}
	for _, name in ipairs({ "faces", "wire", "downFaces", "downWire", "grid" }) do
		for _, i in ipairs(lists[name]) do
			idx[#idx + 1] = i
		end
		out[name] = #lists[name]
	end
	out.verts, out.idx = verts, idx
	return out
end

M.STRIDE = STRIDE

return M
