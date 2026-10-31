-- Tests for the math.random stand-in that the unitsync worker puts at the end of
-- its definitions environment (DEFS_ENV_SHIM).
--
-- Run with: luajit lua/defs-env/tests/math_random_test.lua
--
-- Under unitsync the parser's math.random returns no value
-- (LuaParser::DummyRandom), so the stand-in gives a fixed answer inside the
-- range asked for, and raises where the engine's own does.

local failures = 0

local function check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		failures = failures + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

local function eq(name, got, want)
	check(name, got == want, "got " .. tostring(got) .. ", wanted " .. tostring(want))
end

local root = arg[0]:match("^(.*)/tests/[^/]+$") or "."
local file = assert(io.open(root .. "/math_random.lua"))
local source = file:read("*a")
file:close()

--- Run the file in an environment whose `math` is `math_`. Returns that `math`.
local function load(math_)
	local env = setmetatable({ math = math_ }, { __index = _G })
	local chunk = assert(loadstring(source))
	setfenv(chunk, env)
	chunk()
	return env.math
end

--- A `math` the way unitsync's parser has it: random returns nothing.
local function unitsync_math()
	local copy = {}
	for k, v in pairs(math) do copy[k] = v end
	copy.random = function() end
	return copy
end

--- What `math.random(...)` gives under the stand-in.
local function draw(...)
	return load(unitsync_math()).random(...)
end

--- The message a call raises, or nil when it does not.
local function raised(...)
	local args = { n = select("#", ...), ... }
	local math_ = load(unitsync_math())
	local ok, err = pcall(function() return math_.random(unpack(args, 1, args.n)) end)
	if not ok then return tostring(err) end
end

-- With no argument the engine gives a float from 0 to 1.
eq("random() gives a number from 0 to 1", draw(), 0)
-- With one it gives a whole number from 1 to m.
eq("random(m) gives 1", draw(6), 1)
eq("random(1) gives 1", draw(1), 1)
eq("random(m) cuts m to a whole number", draw(2.9), 1)
eq("random(m) takes m written as text", draw("4"), 1)
-- With two it gives a whole number from m to n.
eq("random(m, n) gives m", draw(3, 9), 3)
eq("random(m, n) with m equal to n gives it", draw(5, 5), 5)
eq("random(m, n) with a negative range stays in it", draw(-8, -2), -8)
eq("random(m, n) cuts both to whole numbers", draw(2.7, 9.9), 2)
eq("random(m, n) takes both written as text", draw("2", "9"), 2)

-- The engine's own errors.
check("random(0) raises", (raised(0) or ""):find("too small upper limit (0)", 1, true))
check("random(-3) raises", (raised(-3) or ""):find("too small upper limit (-3)", 1, true))
check("random(0.5) raises, as it is cut to 0", (raised(0.5) or ""):find("too small upper limit (0)", 1, true))
check("random(m, n) with m above n raises", (raised(3, 2) or ""):find("Empty interval", 1, true))
check("random(1, 0) raises, as when a list is empty", (raised(1, 0) or ""):find("Empty interval", 1, true))
check("random(text) raises", (raised("x") or ""):find("Incorrect arguments", 1, true))
check("random(m, text) raises", (raised(1, "x") or ""):find("Incorrect arguments", 1, true))
check("random with three arguments raises", (raised(1, 2, 3) or ""):find("Incorrect arguments", 1, true))
eq("random(nil) raises", raised(nil) ~= nil, true)

-- The lootbox definitions index a table with the draw, then index what came
-- back. With no draw the second index is of nil and raises.
do
	local models = { { objectName = "one" }, { objectName = "two" } }
	local math_ = load(unitsync_math())
	local ok, got = pcall(function() return models[math_.random(1, #models)].objectName end)
	check("a table indexed by a draw gives an entry", ok and got == "one", got)
end

-- An engine that does answer wins over the stand-in.
do
	local real = unitsync_math()
	real.random = function() return 42 end
	eq("a math.random that answers is left alone", load(real).random(1, 9), 42)
end

if failures > 0 then
	print(failures .. " failed")
	os.exit(1)
end
print("all passed")
