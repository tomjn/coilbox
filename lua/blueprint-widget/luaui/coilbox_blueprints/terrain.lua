-- The preview of a blueprint's terrain steps on the ground: the ground they
-- leave, slopes included, as a translucent surface over the ground with a wire
-- grid on it, and a grid on the ground under it, in the look of Zero-K's own
-- terraform preview and of Helwor's DrawTerra2 widget.
--
-- The look, the colours and the ideas of the grids follow DrawTerra2 in
-- Helwor/New-Hel-K (Widgets/DrawTerra2.lua, GPL-2.0-or-later): green for
-- raised ground (s_elev_color 0, 1, 0), a brownish red for dug ground
-- (s_dig_color 0.8, 0.4, 0.3), a cyan ground grid (s_ground_color 0, 0.7, 0.7).
-- No code is taken from it. Which corners a step changes, and to what height,
-- is terraform.lua's: the step's own corners and the slope the terraform gadget
-- adds round them.
--
-- The geometry is plain Lua over a height function, so a test can run it. The
-- vertices come out in the widget's vertex format (model.lua, M.STRIDE).

local M = {}

--- The engine's heightmap square in elmos, and the spacing of the grids.
M.SQUARE = 8
M.GRID = 16

--- A preview with more cells than this is not drawn. The widget works a
-- preview out over several frames, 4 ms in each (PREVIEW_BUDGET_MS). The
-- largest example blueprint, 8775 cells, took up to 0.016 ms a cell all told
-- in a Zero-K match on engine 2026.09.01 (#4811). At that rate this many cells
-- is 240 ms of work, 60 frames, so at 60 frames a second the preview catches
-- up with the cursor within a second of it stopping.
M.CELL_LIMIT = 15000

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

local floor, abs = math.floor, math.abs

local function noPause() end

--- The mesh of the ground a layout leaves.
-- @param changed table[] { x, z, h } each corner a step changed, from
--   terraform.lua's session.changed, h the height it is left at
-- @param heightAt function(x, z) -> the ground's height now
-- @param pause function()? called once for each corner and each cell, as
--   terraform.lua's session calls it
-- @return table { verts, idx, faces, wire, downFaces, downWire, grid, cells,
--   capped }. idx holds, one after another, the triangles of the faces over
--   raised ground (faces indices), the lines on those (wire), the same for dug
--   ground (downFaces, downWire), and the lines of the grid on the ground
--   (grid). Dug ground is under the terrain, so the widget draws it without
--   the depth test. capped says there were too many cells to draw, and nothing
--   is drawn.
--
-- Corners and cells are held by their place in the 8 elmo grid, in tables of
-- rows, and a cell's work makes no tables of its own: the largest example
-- blueprint has thousands of cells, and this runs each time it moves (#4811).
function M.mesh(changed, heightAt, pause)
	pause = pause or noPause
	changed = changed or {}
	local verts = {}
	local faces, wire, downFaces, downWire, grid = {}, {}, {}, {}, {}
	local count = 0
	local out = { capped = false, cells = 0 }

	-- the height each changed corner is left at
	local final = {}
	for _, c in ipairs(changed) do
		local iz = floor(c.z / 8 + 0.5)
		local row = final[iz]
		if not row then
			row = {}
			final[iz] = row
		end
		row[floor(c.x / 8 + 0.5)] = c.h
	end
	-- every cell with a changed corner, by its top left corner
	local cells, cellX, cellZ = {}, {}, {}
	local n = 0
	for _, c in ipairs(changed) do
		pause()
		local cx, cz = floor(c.x / 8 + 0.5), floor(c.z / 8 + 0.5)
		for ix = cx - 1, cx do
			for iz = cz - 1, cz do
				local row = cells[iz]
				if not row then
					row = {}
					cells[iz] = row
				end
				if not row[ix] then
					row[ix] = true
					n = n + 1
					cellX[n], cellZ[n] = ix, iz
				end
			end
		end
	end
	out.cells = n
	if n > M.CELL_LIMIT then
		out.capped = true
		n = 0
	end

	local function vertex(x, y, z, c)
		local v = count * STRIDE
		verts[v + 1], verts[v + 2], verts[v + 3] = x, y, z
		verts[v + 4], verts[v + 5] = 0, 0
		verts[v + 6], verts[v + 7], verts[v + 8], verts[v + 9] = c[1], c[2], c[3], c[4]
		verts[v + 10], verts[v + 11], verts[v + 12], verts[v + 13] = 0, 0, 0, 0
		count = count + 1
		return count - 1
	end
	-- the ground's height at a corner, asked of the engine once for the four
	-- cells that share it
	local groundCache = {}
	local function groundAt(ix, iz)
		local row = groundCache[iz]
		if not row then
			row = {}
			groundCache[iz] = row
		end
		local h = row[ix]
		if not h then
			h = heightAt(ix * 8, iz * 8)
			row[ix] = h
		end
		return h
	end
	local function topAt(ix, iz)
		local row = final[iz]
		return row and row[ix] or groundAt(ix, iz)
	end

	-- A corner's vertices are made once for each use and shared by the cells and
	-- lines that meet there. The surface and the wire come in two colours, for
	-- raised and dug ground.
	local function shared(cache, ix, y, iz, c)
		local row = cache[iz]
		if not row then
			row = {}
			cache[iz] = row
		end
		local v = row[ix]
		if not v then
			v = vertex(ix * 8, y, iz * 8, c)
			row[ix] = v
		end
		return v
	end
	local upCache, downCache, wireUpCache, wireDownCache, gridCache = {}, {}, {}, {}, {}
	local faceUp = { M.COLORS.raise[1], M.COLORS.raise[2], M.COLORS.raise[3], M.FACE_ALPHA }
	local faceDown = { M.COLORS.dig[1], M.COLORS.dig[2], M.COLORS.dig[3], M.FACE_ALPHA }
	local groundColor, lift = M.COLORS.ground, M.GROUND_LIFT

	local function hasCell(ix, iz)
		local row = cells[iz]
		return row and row[ix]
	end

	-- Each cell's top and left edges are lines when they lie on a 16 elmo line
	-- or have no cell beyond them, and its bottom and right edges only when
	-- there is no cell beyond, so a shared edge is drawn once. The wire goes on
	-- the cell's surface when it is shown, in the colour of the cell.
	local shown, wires, wireCache, wireColor
	local function edge(ax, az, fa, ga, bx, bz, fb, gb)
		if shown then
			local k = #wires
			wires[k + 1] = shared(wireCache, ax, fa, az, wireColor)
			wires[k + 2] = shared(wireCache, bx, fb, bz, wireColor)
		end
		local k = #grid
		grid[k + 1] = shared(gridCache, ax, ga + lift, az, groundColor)
		grid[k + 2] = shared(gridCache, bx, gb + lift, bz, groundColor)
	end

	for i = 1, n do
		pause()
		local x, z = cellX[i], cellZ[i]
		local x1, z1 = x + 1, z + 1
		-- the corners top left, top right, bottom left, bottom right
		local f1, f2, f3, f4 = topAt(x, z), topAt(x1, z), topAt(x, z1), topAt(x1, z1)
		local g1, g2, g3, g4 = groundAt(x, z), groundAt(x1, z), groundAt(x, z1), groundAt(x1, z1)
		local mean = 0
		mean = mean + (f1 - g1) / 4
		mean = mean + (f2 - g2) / 4
		mean = mean + (f3 - g3) / 4
		mean = mean + (f4 - g4) / 4
		local up = mean >= 0
		shown = abs(mean) >= 0.5
		if shown then
			local cache, face = up and upCache or downCache, up and faceUp or faceDown
			local v1 = shared(cache, x, f1, z, face)
			local v2 = shared(cache, x1, f2, z, face)
			local v3 = shared(cache, x, f3, z1, face)
			local v4 = shared(cache, x1, f4, z1, face)
			local into = up and faces or downFaces
			local k = #into
			into[k + 1], into[k + 2], into[k + 3] = v1, v2, v3
			into[k + 4], into[k + 5], into[k + 6] = v2, v4, v3
		end
		wireColor = up and M.COLORS.wireRaise or M.COLORS.wireDig
		wires = up and wire or downWire
		wireCache = up and wireUpCache or wireDownCache
		if z % 2 == 0 or not hasCell(x, z - 1) then
			edge(x, z, f1, g1, x1, z, f2, g2)
		end
		if x % 2 == 0 or not hasCell(x - 1, z) then
			edge(x, z, f1, g1, x, z1, f3, g3)
		end
		if not hasCell(x, z1) then
			edge(x, z1, f3, g3, x1, z1, f4, g4)
		end
		if not hasCell(x1, z) then
			edge(x1, z, f2, g2, x1, z1, f4, g4)
		end
	end

	local idx = {}
	local k = 0
	for _, list in ipairs({ faces, wire, downFaces, downWire, grid }) do
		for j = 1, #list do
			idx[k + j] = list[j]
		end
		k = k + #list
	end
	out.faces, out.wire, out.downFaces, out.downWire, out.grid = #faces, #wire, #downFaces, #downWire, #grid
	out.verts, out.idx = verts, idx
	return out
end

M.STRIDE = STRIDE

return M
