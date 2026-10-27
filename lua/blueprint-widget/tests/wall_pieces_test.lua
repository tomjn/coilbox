-- Run: luajit lua/blueprint-widget/tests/wall_pieces_test.lua
--
-- How an open wall longer than one of Zero-K's blocks is cut into orders (issue
-- #4833). The blueprint editor cuts it the same way in src/blueprint/terraform.ts,
-- and both are tested against the cases in src/blueprint/fixtures/wall-pieces.json.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check
local PLACE = support.module("place.lua")
local JSON = support.module("json.lua")
local TERRAFORM = support.module("terraform.lua")

local file = assert(io.open(support.root() .. "/../../src/blueprint/fixtures/wall-pieces.json", "r"))
local cases = JSON.decode(file:read("*a"))
file:close()

check("the shared fixture has cases", #cases > 0)

for _, case in ipairs(cases) do
	local step = { kind = "raise", shape = "wall", points = case.points, height = 112 }
	local pieces = PLACE.wallPieces(step)
	if case.pieces == JSON.null or case.pieces == nil then
		check(case.name, #pieces == 1 and pieces[1] == step)
	else
		local cut = {}
		for _, piece in ipairs(pieces) do
			cut[#cut + 1] = piece.points
		end
		check(case.name, support.same(cut, case.pieces), support.show(cut))
	end
end

-- What Zero-K estimated for the two walls the Zero-K driver measures, ordered
-- as the widget orders them (#4833), on flat ground. The bent wall was held 4
-- elmos off the 16 elmo grid in z, which changes where its corners overlap.
local function metal(points, height, at)
	local laid = {}
	for i, p in ipairs(points) do
		laid[i] = { x = at.x + p.x, z = at.z + p.z }
	end
	local pieces = PLACE.wallPieces({ kind = "raise", shape = "wall", points = laid, height = height, before = 0 })
	local env = {
		heightAt = function()
			return 0
		end,
		corners = { x = 129, z = 129 },
	}
	return TERRAFORM.terraform(env, pieces).metal
end
local straight = { { x = -400, z = 0 }, { x = 400, z = 0 } }
local bent = { { x = -200, z = 150 }, { x = 200, z = 150 }, { x = 200, z = -150 } }
local function near(a, b)
	return math.abs(a - b) < 0.005
end
check("a straight wall of four blocks costs what Zero-K estimated at 112", near(metal(straight, 112, { x = 512, z = 512 }), 995.1864), metal(straight, 112, { x = 512, z = 512 }))
check("a straight wall of four blocks costs what Zero-K estimated at 70", near(metal(straight, 70, { x = 512, z = 512 }), 631.7688), metal(straight, 70, { x = 512, z = 512 }))
check("a wall with a corner costs what Zero-K estimated at 112", near(metal(bent, 112, { x = 512, z = 676 }), 908.3736), metal(bent, 112, { x = 512, z = 676 }))
check("a wall with a corner costs what Zero-K estimated at 70", near(metal(bent, 70, { x = 512, z = 676 }), 578.2872), metal(bent, 70, { x = 512, z = 676 }))

support.report()
