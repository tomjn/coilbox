-- Run: luajit lua/blueprint-widget/tests/ground_test.lua
--
-- The ground a layout's terrain steps leave, with the slopes Zero-K adds
-- (issue #4797). The cases are src/blueprint/terraform.test.ts's, so the two
-- stay one model. The wall profiles marked #4789 were measured in a real
-- Zero-K match.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local GROUND = support.module("ground.lua")

--- A map 1024 elmos square, 129 corners a side.
local function ground(height)
	return { heightAt = height, corners = { x = 129, z = 129 } }
end

local FLAT = ground(function()
	return 0
end)
-- 4 elmos every 8 eastward, so 256 at x = 512
local EAST_SLOPE = ground(function(x)
	return x / 2
end)
-- 2 elmos every 8 southward, so 128 at z = 512
local SOUTH_SLOPE = ground(function(_, z)
	return z / 4
end)

local AT = { x = 512, z = 512 }
local SOUTH, NORTH, EAST = { x = 0, z = 8 }, { x = 0, z = -8 }, { x = 8, z = 0 }

--- A step as the widget lays it: points on the map, the pivot's ground, and
-- how many buildings come ahead of it.
local function laid(step, after, base)
	local points = {}
	for i, p in ipairs(step.points) do
		points[i] = { x = AT.x + p.x, z = AT.z + p.z }
	end
	local out = {}
	for k, v in pairs(step) do
		out[k] = v
	end
	out.points, out.after, out.base = points, after or 0, base or 0
	return out
end

local function wall(height, after)
	return laid({ kind = "raise", shape = "wall", points = { { x = -128, z = 0 }, { x = 128, z = 0 } }, height = height }, after)
end

local function pad(kind, height, base)
	return laid({ kind = kind, shape = "area", points = { { x = -64, z = -64 }, { x = 64, z = -64 }, { x = 64, z = 64 }, { x = -64, z = 64 } }, height = height }, 0, base)
end

--- The ground after steps, as heights every 8 elmos from a point.
local function run(env, steps, foot, structures)
	local e = {}
	for k, v in pairs(env) do
		e[k] = v
	end
	e.structures = structures
	local result = GROUND.terraform(e, steps, foot)
	result.at = result.session.reader.at
	return result
end

local function profile(result, from, step, count)
	local out = {}
	for i = 0, count - 1 do
		out[#out + 1] = result.at(from.x + step.x * i, from.z + step.z * i)
	end
	return out
end

local function near(a, b)
	if #a ~= #b then
		return false
	end
	for i = 1, #a do
		if math.abs(a[i] - b[i]) > 0.01 then
			return false
		end
	end
	return true
end

--------------------------------------------------------------------------------
-- a raised wall
--------------------------------------------------------------------------------

do
	local r = run(FLAT, { wall(112) })
	local measured = { 112, 112, 112, 84, 56, 28, 4, 0 }
	check("a wall raised by 112 reads 112, 112, 112, 84, 56, 28, 4, 0 south of its centre line (#4789)", same(profile(r, AT, SOUTH, 8), measured), show(profile(r, AT, SOUTH, 8)))
	check("and the same north of it", same(profile(r, AT, NORTH, 8), measured))
end
do
	local r = run(FLAT, { wall(70) })
	check("a wall raised by 70 reads 70, 70, 70, 42, 14, 4, 0 (#4789)", same(profile(r, AT, SOUTH, 7), { 70, 70, 70, 42, 14, 4, 0 }), show(profile(r, AT, SOUTH, 7)))
	check("it slopes off its ends as well as its sides", same(profile(r, { x = 656, z = 512 }, EAST, 5), { 70, 42, 14, 4, 0 }), show(profile(r, { x = 656, z = 512 }, EAST, 5)))
	local slope = r.steps[1].slope
	local function listed(list, x, z)
		for _, p in ipairs(list) do
			if p.x == x and p.z == z then
				return true
			end
		end
		return false
	end
	check("the slope it added is corners outside the step", listed(slope, 512, 536) and listed(slope, 512, 552) and not listed(slope, 512, 528) and listed(r.steps[1].shape, 512, 528))
	check("the slope's corners carry the height they are set to", (function()
		for _, p in ipairs(slope) do
			if p.x == 512 and p.z == 536 then
				return p.target == 42
			end
		end
	end)())
end

--------------------------------------------------------------------------------
-- a dug trench
--------------------------------------------------------------------------------

do
	local r = run(FLAT, { wall(-50) })
	local expected = { -50, -50, -50, -42, -14, -4, 0 }
	check("a dug trench slopes up gently at first and then at 28 a square", same(profile(r, AT, SOUTH, 7), expected) and same(profile(r, AT, NORTH, 7), expected), show(profile(r, AT, SOUTH, 7)))
end

--------------------------------------------------------------------------------
-- level and raise
--------------------------------------------------------------------------------

do
	local r = run(FLAT, { pad("level", 40) })
	local want = { 4, 12 }
	for _ = 1, 19 do
		want[#want + 1] = 40
	end
	want[#want + 1], want[#want + 2], want[#want + 3] = 12, 4, 0
	check("a level pad on flat ground is flat at its height with a slope of 28 and a lip of 4", same(profile(r, { x = 432, z = 512 }, EAST, 24), want), show(profile(r, { x = 432, z = 512 }, EAST, 24)))
end
do
	local r = run(EAST_SLOPE, { pad("level", 0, 256) })
	check("a level pad raises the low side to the pivot's height", same(profile(r, { x = 424, z = 512 }, EAST, 4), { 212, 216, 228, 256 }), show(profile(r, { x = 424, z = 512 }, EAST, 4)))
	check("and cuts into the high side", r.at(592, 512) == 256 and same(profile(r, { x = 600, z = 512 }, EAST, 4), { 264, 292, 308, 312 }), show(profile(r, { x = 600, z = 512 }, EAST, 4)))
end
do
	local r = run(EAST_SLOPE, { pad("raise", 40) })
	check("a raise adds its height to the ground under each point, on a slope", same(profile(r, { x = 432, z = 512 }, EAST, 4), { 216, 236, 264, 268 }) and r.at(592, 512) == 336 and same(profile(r, { x = 600, z = 512 }, EAST, 3), { 308, 304, 308 }), show(profile(r, { x = 432, z = 512 }, EAST, 4)))
end
do
	local r = run(FLAT, { pad("raise", 40) })
	local ok = true
	for _, c in ipairs({ { 440, 440 }, { 600, 440 }, { 440, 600 }, { 600, 600 } }) do
		ok = ok and r.at(c[1], c[2]) == 4
	end
	check("a pad raised by 40 keeps the 4 elmo foot on its diagonals (#4805)", ok and same(profile(r, { x = 432, z = 512 }, EAST, 4), { 4, 12, 40, 40 }), show(profile(r, { x = 432, z = 512 }, EAST, 4)))
end

--------------------------------------------------------------------------------
-- ramp
--------------------------------------------------------------------------------

do
	local ramp = laid({ kind = "ramp", shape = "wall", points = { { x = -128, z = 0 }, { x = 128, z = 0 } }, heights = { 0, 64 }, width = 64 })
	local r = run(FLAT, { ramp })
	check("a ramp climbs evenly from one end's height to the other's", near(profile(r, { x = 384, z = 512 }, { x = 32, z = 0 }, 9), { 0, 8, 16, 24, 32, 40, 48, 56, 64 }), show(profile(r, { x = 384, z = 512 }, { x = 32, z = 0 }, 9)))
	check("and slopes off its high end", near(profile(r, { x = 648, z = 512 }, EAST, 4), { 36, 8, 4, 0 }), show(profile(r, { x = 648, z = 512 }, EAST, 4)))
	local s = laid({ kind = "ramp", shape = "wall", points = { { x = -128, z = 0 }, { x = 128, z = 0 } }, heights = { 0, 64 }, width = 64 }, 0, 128)
	local on = run(SOUTH_SLOPE, { s })
	check("a ramp measures its heights from the pivot's ground, on a slope", near(profile(on, { x = 384, z = 512 }, { x = 64, z = 0 }, 5), { 128, 144, 160, 176, 192 }), show(profile(on, { x = 384, z = 512 }, { x = 64, z = 0 }, 5)))
	check("and slopes round its sides there", near(profile(on, { x = 512, z = 472 }, SOUTH, 13), { 120, 132, 160, 160, 160, 160, 160, 160, 160, 160, 144, 140, 142 }), show(profile(on, { x = 512, z = 472 }, SOUTH, 13)))
	local short = laid({ kind = "ramp", shape = "wall", points = { { x = -128, z = 0 }, { x = -80, z = 0 } }, heights = { 0, 64 }, width = 64 })
	local refused = run(FLAT, { short })
	check("a ramp shorter than 64 elmos is refused and costs nothing", refused.steps[1].outcome == "refused" and refused.steps[1].metal == 0 and next(refused.session.reader.overlay) == nil)
end

--------------------------------------------------------------------------------
-- smooth
--------------------------------------------------------------------------------

do
	local stepped = ground(function(x)
		return x >= 512 and 40 or 0
	end)
	local smooth = laid({ kind = "smooth", shape = "wall", points = { { x = 0, z = -64 }, { x = 0, z = 64 } } })
	local r = run(stepped, { smooth })
	check("a smooth sets each point to the average of the 5 by 5 corners round it", same(profile(r, { x = 480, z = 512 }, EAST, 8), { 0, 4, 8, 16, 24, 32, 40, 40 }), show(profile(r, { x = 480, z = 512 }, EAST, 8)))
	local flatSmooth = laid({ kind = "smooth", shape = "area", points = pad("level", 0).points })
	local none = run(FLAT, { flatSmooth })
	check("a smooth on flat ground changes nothing and costs nothing", none.metal == 0 and #none.session.changed() == 0)
end

--------------------------------------------------------------------------------
-- a slope meeting a building
--------------------------------------------------------------------------------

do
	-- a building 128 by 64 centred at 512, 576, so its north edge is at z = 544
	local building = { x = 512, z = 576, xsize = 16, zsize = 8, facing = 0 }
	local r = run(FLAT, { wall(100, 1) }, { building })
	check("a slope stops short of a building ahead of its step in the blueprint's order", same(profile(r, AT, SOUTH, 5), { 100, 72, 44, 16, 0 }) and same(profile(r, AT, NORTH, 8), { 100, 100, 100, 72, 44, 16, 4, 0 }), show(profile(r, AT, SOUTH, 5)))
	local after = run(FLAT, { wall(100, 0) }, { building })
	check("a building after the step does not stop it", same(profile(after, AT, SOUTH, 8), { 100, 100, 100, 72, 44, 16, 4, 0 }), show(profile(after, AT, SOUTH, 8)))
	local standing = run(FLAT, { wall(100, 0) }, nil, { building })
	check("a building already standing stops it, whatever the step's place", same(profile(standing, AT, SOUTH, 5), { 100, 72, 44, 16, 0 }), show(profile(standing, AT, SOUTH, 5)))
	local under = { x = 512, z = 512, xsize = 8, zsize = 8, facing = 0 }
	local u = run(FLAT, { wall(20, 1) }, { under })
	check("the ground under a building inside the step is left alone", u.at(512, 512) == 0 and u.at(560, 512) == 20, show({ u.at(512, 512), u.at(560, 512) }))
	local turned = run(FLAT, { wall(100, 0) }, nil, { { x = 512, z = 576, xsize = 8, zsize = 16, facing = 1 } })
	check("a building turned a quarter has its footprint turned", same(profile(turned, AT, SOUTH, 5), { 100, 72, 44, 16, 0 }), show(profile(turned, AT, SOUTH, 5)))
end

--------------------------------------------------------------------------------
-- two steps
--------------------------------------------------------------------------------

do
	local across = laid({ kind = "raise", shape = "wall", points = { { x = 0, z = -128 }, { x = 0, z = 128 } }, height = 40 })
	local r = run(FLAT, { wall(40), across })
	check("two raises where they cross do not add up", r.at(512, 512) == 40 and r.at(512, 600) == 40 and r.at(600, 512) == 40)
end
do
	local trench, raised = wall(-30, 0), wall(30, 1)
	local r = run(FLAT, { raised, trench }, { { x = 0, z = 0, xsize = 0, zsize = 0 } })
	check("steps are built in the blueprint's order, and a later one works on the ground before it", r.steps[1].index == 2 and r.steps[2].index == 1 and same(profile(r, AT, SOUTH, 6), { 30, 30, 30, 2, 4, 0 }), show(profile(r, AT, SOUTH, 6)))
end
do
	local first, second = wall(40, 0), wall(40, 0)
	local session = GROUND.session(FLAT)
	session.apply({ first })
	session.apply({ second })
	check("a second layout works on the ground the first left", session.reader.at(512, 512) == 40 and session.metal > 0)
end

--------------------------------------------------------------------------------
-- metal
--------------------------------------------------------------------------------

do
	local one = laid({ kind = "raise", shape = "wall", points = { { x = 0, z = 0 } }, height = 100 })
	local r = run(FLAT, { one })
	check("the estimate for one point raised by 100 is the gadget's own", math.abs(r.metal - 48.7168) < 1e-9, tostring(r.metal))
	local doubled = GROUND.terraform({ heightAt = FLAT.heightAt, corners = FLAT.corners, costMult = 2 }, { one })
	check("it scales by terracostmult, but not the base cost", math.abs(doubled.metal - 91.4336) < 1e-9, tostring(doubled.metal))
	local both = run(FLAT, { one, one })
	check("it adds up across steps", math.abs(both.metal - 2 * 48.7168) < 1e-9)
end

--------------------------------------------------------------------------------
-- off the map, and numbers the engine's Lua would hold badly
--------------------------------------------------------------------------------

do
	local edge = laid({ kind = "raise", shape = "wall", points = { { x = -512, z = 0 }, { x = -440, z = 0 } }, height = 40 })
	local r = run(FLAT, { edge })
	local least = math.huge
	for _, p in ipairs(r.session.changed()) do
		least = math.min(least, p.x)
	end
	check("a step that runs off the map writes nothing off it", least >= 0 and #r.session.changed() > 0)
end
do
	-- a step far from the origin changes as many corners as the same step at
	-- the origin. A key built into one large number loses its low bits in the
	-- engine's 32 bit float Lua (#4796). Keys here are coordinates.
	local function count(dx)
		local env = { heightAt = function()
			return 0
		end, corners = { x = 4097, z = 4097 } }
		local s = { kind = "level", shape = "area", points = { { x = dx, z = dx }, { x = dx + 128, z = dx }, { x = dx + 128, z = dx + 128 }, { x = dx, z = dx + 128 } }, height = 24, base = 0, after = 0 }
		return #GROUND.terraform(env, { s }).session.changed()
	end
	check("a step on a big map changes as many corners as the same step near the origin", count(64) == count(16000) and count(64) > 300, count(64) .. " and " .. count(16000))
end

support.report()
