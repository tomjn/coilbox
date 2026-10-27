-- The preview mesh as terrain.lua built it before issue #4811 made it faster,
-- kept so terrain_test.lua can check the faster one gives the same mesh. It
-- reads its constants from the module, so a change to CELL_LIMIT or a colour
-- applies to both.

return function(M)
	local STRIDE = M.STRIDE

	local floor, abs = math.floor, math.abs

	--- A set of corners or cells, by their place in the 8 elmo grid.
	local function put(g, x, z, v)
		local iz = floor(z / 8 + 0.5)
		local row = g[iz]
		if not row then
			row = {}
			g[iz] = row
		end
		row[floor(x / 8 + 0.5)] = v
	end

	local function get(g, x, z)
		local row = g[floor(z / 8 + 0.5)]
		return row and row[floor(x / 8 + 0.5)]
	end

	--- The mesh of the ground a layout leaves.
	-- @param changed table[] { x, z, h } each corner a step changed, from
	--   terraform.lua's session.changed, h the height it is left at
	-- @param heightAt function(x, z) -> the ground's height now
	-- @return table { verts, idx, faces, wire, downFaces, downWire, grid, cells,
	--   capped }. idx holds, one after another, the triangles of the faces over
	--   raised ground (faces indices), the lines on those (wire), the same for dug
	--   ground (downFaces, downWire), and the lines of the grid on the ground
	--   (grid). Dug ground is under the terrain, so the widget draws it without
	--   the depth test. capped says there were too many cells to draw, and nothing
	--   is drawn.
	local function mesh(changed, heightAt)
		local verts = {}
		local lists = { faces = {}, wire = {}, downFaces = {}, downWire = {}, grid = {} }
		local count = 0
		local out = { capped = false, cells = 0 }

		local final = {}
		for _, c in ipairs(changed or {}) do
			put(final, c.x, c.z, c.h)
		end
		-- every cell with a changed corner
		local cells, cellList = {}, {}
		for _, c in ipairs(changed or {}) do
			for dx = -8, 0, 8 do
				for dz = -8, 0, 8 do
					local x, z = c.x + dx, c.z + dz
					if not get(cells, x, z) then
						put(cells, x, z, true)
						cellList[#cellList + 1] = { x = x, z = z }
					end
				end
			end
		end
		out.cells = #cellList
		if #cellList > M.CELL_LIMIT then
			out.capped = true
			cellList = {}
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
		local function quad(into, a, b, c, d)
			into[#into + 1], into[#into + 2], into[#into + 3] = a, b, c
			into[#into + 1], into[#into + 2], into[#into + 3] = b, d, c
		end
		-- the ground's height at a corner, asked of the engine once for the four
		-- cells that share it
		local groundCache = {}
		local function groundAt(x, z)
			local h = get(groundCache, x, z)
			if not h then
				h = heightAt(x, z)
				put(groundCache, x, z, h)
			end
			return h
		end
		local function topAt(x, z)
			return get(final, x, z) or groundAt(x, z)
		end

		-- A corner's vertices are made once for each use and shared by the cells and
		-- lines that meet there. The surface and the wire come in two colours, for
		-- raised and dug ground.
		local caches = { up = {}, down = {}, wireUp = {}, wireDown = {}, grid = {} }
		local function shared(cache, x, y, z, c)
			local v = get(cache, x, z)
			if not v then
				v = vertex(x, y, z, c)
				put(cache, x, z, v)
			end
			return v
		end
		local faceUp = { M.COLORS.raise[1], M.COLORS.raise[2], M.COLORS.raise[3], M.FACE_ALPHA }
		local faceDown = { M.COLORS.dig[1], M.COLORS.dig[2], M.COLORS.dig[3], M.FACE_ALPHA }

		for _, cell in ipairs(cellList) do
			local x, z = cell.x, cell.z
			local fx = { topAt(x, z), topAt(x + 8, z), topAt(x, z + 8), topAt(x + 8, z + 8) }
			local gx = { groundAt(x, z), groundAt(x + 8, z), groundAt(x, z + 8), groundAt(x + 8, z + 8) }
			local mean = 0
			for i = 1, 4 do
				mean = mean + (fx[i] - gx[i]) / 4
			end
			local up = mean >= 0
			local shown = abs(mean) >= 0.5
			local corners = { { x, z }, { x + 8, z }, { x, z + 8 }, { x + 8, z + 8 } }
			if shown then
				local cache, face = up and caches.up or caches.down, up and faceUp or faceDown
				local v = {}
				for i = 1, 4 do
					v[i] = shared(cache, corners[i][1], fx[i], corners[i][2], face)
				end
				quad(up and lists.faces or lists.downFaces, v[1], v[2], v[3], v[4])
			end
			local wire = up and M.COLORS.wireRaise or M.COLORS.wireDig
			local wires = up and lists.wire or lists.downWire
			local wireCache = up and caches.wireUp or caches.wireDown
			-- Each cell's top and left edges are lines when they lie on a 16 elmo
			-- line or have no cell beyond them, and its bottom and right edges only
			-- when there is no cell beyond, so a shared edge is drawn once.
			local function edge(ax, az, ai, bx, bz, bi, onLine, beyond)
				if onLine or not beyond then
					if shown then
						wires[#wires + 1] = shared(wireCache, ax, fx[ai], az, wire)
						wires[#wires + 1] = shared(wireCache, bx, fx[bi], bz, wire)
					end
					lists.grid[#lists.grid + 1] = shared(caches.grid, ax, gx[ai] + M.GROUND_LIFT, az, M.COLORS.ground)
					lists.grid[#lists.grid + 1] = shared(caches.grid, bx, gx[bi] + M.GROUND_LIFT, bz, M.COLORS.ground)
				end
			end
			edge(x, z, 1, x + 8, z, 2, z % 16 == 0, get(cells, x, z - 8))
			edge(x, z, 1, x, z + 8, 3, x % 16 == 0, get(cells, x - 8, z))
			if not get(cells, x, z + 8) then
				edge(x, z + 8, 3, x + 8, z + 8, 4, false, false)
			end
			if not get(cells, x + 8, z) then
				edge(x + 8, z, 2, x + 8, z + 8, 4, false, false)
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

	return mesh
end
