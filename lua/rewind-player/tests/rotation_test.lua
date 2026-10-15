-- A track's rotation turned into the three angles the engine takes.
--
-- The check is against the engine's own arithmetic, copied here from
-- rts/System/Matrix44f.cpp in RecoilEngine at 212c369b4c: RotateEulerXYZ runs
-- RotateX, RotateY and RotateZ on an identity matrix, and
-- CSolidObject::SetDirVectors reads up from its second column and front from
-- its third. The angles `euler` gives have to make the front and up the
-- quaternion stands for, by the formulas on the format page.

local t = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")

local Rotation = t.load("coilbox_player_rotation.lua", t.syncedEnv())

--- The engine's front and up for a pitch, a yaw and a roll.
local function engine(pitch, yaw, roll)
	-- Column major, as the engine's m[0] to m[11] are.
	local m = { [0] = 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0 }
	local s, c = math.sin(pitch), math.cos(pitch)
	for row = 0, 2 do
		local a = m[4 + row]
		m[4 + row] = c * a - s * m[8 + row]
		m[8 + row] = s * a + c * m[8 + row]
	end
	s, c = math.sin(yaw), math.cos(yaw)
	for row = 0, 2 do
		local a = m[row]
		m[row] = c * a + s * m[8 + row]
		m[8 + row] = -s * a + c * m[8 + row]
	end
	s, c = math.sin(roll), math.cos(roll)
	for row = 0, 2 do
		local a = m[row]
		m[row] = c * a - s * m[4 + row]
		m[4 + row] = s * a + c * m[4 + row]
	end
	return m[8], m[9], m[10], m[4], m[5], m[6]
end

--- The front and up a quaternion stands for.
local function wanted(x, y, z, w)
	return 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)
end

local function check(name, x, y, z, w)
	local length = math.sqrt(x * x + y * y + z * z + w * w)
	x, y, z, w = x / length, y / length, z / length, w / length
	local got = { engine(Rotation.euler(x, y, z, w)) }
	local want = { wanted(x, y, z, w) }
	local worst = 0
	for i = 1, 6 do
		worst = math.max(worst, math.abs(got[i] - want[i]))
	end
	t.check(name, worst < 1e-9, "the furthest component is " .. worst .. " out")
end

local half = math.sqrt(0.5)
check("at rest", 0, 0, 0, 1)
check("facing along x", 0, half, 0, half)
check("facing against x", 0, -half, 0, half)
check("facing against z", 0, 1, 0, 0)
check("facing along x and rolled", 0.5, 0.5, 0.5, 0.5)
check("facing against x and rolled", 0.5, -0.5, 0.5, -0.5)
check("on its back", 0, 0, 1, 0)
check("nose up", -half, 0, 0, half)
check("nose down", half, 0, 0, half)
check("leaning", 0, 0, 0.1, 1)

-- A fixed spread of rotations, and the fixture's own.
do
	local seed = 12345
	local function random()
		seed = (seed * 1103515245 + 12345) % 2147483648
		return seed / 2147483648 * 2 - 1
	end
	local worst = 0
	for _ = 1, 2000 do
		local x, y, z, w = random(), random(), random(), random()
		local length = math.sqrt(x * x + y * y + z * z + w * w)
		x, y, z, w = x / length, y / length, z / length, w / length
		local got = { engine(Rotation.euler(x, y, z, w)) }
		local want = { wanted(x, y, z, w) }
		for i = 1, 6 do
			worst = math.max(worst, math.abs(got[i] - want[i]))
		end
	end
	t.check("2,000 rotations spread over every direction", worst < 1e-9, "the furthest component is " .. worst .. " out")
end

do
	local expected = dofile(t.FIXTURES .. "expected.lua")
	for i, feature in ipairs(expected.features) do
		local q = feature.rotation
		check("the rotation of the fixture's feature " .. i, q[1], q[2], q[3], q[4])
	end
end

-- The engine's numbers are 32 bit floats. Facing nearly along x is where that
-- matters: the cosine of the yaw is then close to nothing, and one worked out
-- from the yaw itself can come back with the wrong sign. A real run showed a
-- unit standing on its head that way. Here every value the module's maths gives
-- is rounded to a float, as the engine's is.
do
	local rounded = {}
	for name, fn in pairs(math) do
		rounded[name] = fn
	end
	for _, name in ipairs({ "asin", "atan2", "sin", "cos", "sqrt" }) do
		local real = math[name]
		rounded[name] = function(...)
			return t.float(real(...))
		end
	end
	local env = t.syncedEnv()
	env.math = rounded
	local Float = t.load("coilbox_player_rotation.lua", env)

	local worst, worstAt = 0, nil
	local function try(x, y, z, w)
		local length = math.sqrt(x * x + y * y + z * z + w * w)
		x, y, z, w = t.float(x / length), t.float(y / length), t.float(z / length), t.float(w / length)
		local got = { engine(Float.euler(x, y, z, w)) }
		local want = { wanted(x, y, z, w) }
		for i = 1, 6 do
			local off = math.abs(got[i] - want[i])
			if off > worst then
				worst, worstAt = off, string.format("%.9g %.9g %.9g %.9g", x, y, z, w)
			end
		end
	end
	-- A quarter turn about y either way, and a little off it in every direction.
	for _, side in ipairs({ 1, -1 }) do
		for _, off in ipairs({ 0, 1e-7, -1e-7, 1e-5, -1e-5, 1e-3, -1e-3 }) do
			for _, lean in ipairs({ 0, 1e-6, -1e-6, 1e-4, -1e-4, 0.01, -0.01 }) do
				local angle = side * math.pi / 2 + off
				try(lean, math.sin(angle / 2), 0, math.cos(angle / 2))
				try(0, math.sin(angle / 2), lean, math.cos(angle / 2))
				try(lean, math.sin(angle / 2), -lean, math.cos(angle / 2))
			end
		end
	end
	t.check("294 rotations facing along x or nearly, in the engine's floats", worst < 1e-5, "the furthest component is " .. worst .. " out, at " .. tostring(worstAt))
end

-- It makes no table.
do
	if jit then
		jit.off()
	end
	collectgarbage()
	collectgarbage("stop")
	local before = collectgarbage("count")
	for _ = 1, 1000 do
		Rotation.euler(0.1, 0.2, 0.3, 0.9)
	end
	local after = collectgarbage("count")
	collectgarbage("restart")
	t.same("1,000 calls allocate nothing", after - before, 0)
end

t.report()
