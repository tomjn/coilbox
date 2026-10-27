-- Run: luajit lua/blueprint-widget/tests/ring_sides_test.lua
--
-- How a closed ring of wall is split into sides (issue #4826). The blueprint
-- editor splits it the same way in src/blueprint/terraform.ts, and both are
-- tested against the cases in src/blueprint/fixtures/ring-sides.json.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check
local PLACE = support.module("place.lua")
local JSON = support.module("json.lua")

local file = assert(io.open(support.root() .. "/../../src/blueprint/fixtures/ring-sides.json", "r"))
local cases = JSON.decode(file:read("*a"))
file:close()

check("the shared fixture has cases", #cases > 0)

for _, case in ipairs(cases) do
	local step = { kind = "raise", shape = "wall", points = case.points, height = 112 }
	if case.sides == JSON.null or case.sides == nil then
		check(case.name, not PLACE.closedRing(step))
	else
		local sides = {}
		if PLACE.closedRing(step) then
			for _, side in ipairs(PLACE.ringSides(step)) do
				sides[#sides + 1] = side.points
			end
		end
		check(case.name, support.same(sides, case.sides), support.show(sides))
	end
end

support.report()
