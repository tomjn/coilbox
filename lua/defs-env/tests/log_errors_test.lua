-- Tests for the Spring.Log wrapper that the unitsync worker puts at the end of
-- its definitions environment (DEFS_ENV_SHIM).
--
-- Run with: luajit lua/defs-env/tests/log_errors_test.lua
--
-- A definition script that fails logs the failure at error level and carries on
-- (#4926). The wrapper keeps those lines so the worker can report them (#4928).

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
local file = assert(io.open(root .. "/log_errors.lua"))
local source = file:read("*a")
file:close()

local PREFIX = "a definitions script logged an error: "

--- Run the file in an environment with the engine's `LOG` levels and a
--- `Spring.Log` that records what it is given. Returns that environment and the
--- calls the engine's own Spring.Log received.
local function load(spring)
	local engine_calls = {}
	local env = setmetatable({
		LOG = { DEBUG = 20, INFO = 30, NOTICE = 35, DEPRECATED = 37, WARNING = 40, ERROR = 50, FATAL = 60 },
		Spring = spring or {
			Log = function(...)
				engine_calls[#engine_calls + 1] = { n = select("#", ...), ... }
			end,
		},
	}, { __index = _G })
	local chunk = assert(loadstring(source))
	setfenv(chunk, env)
	chunk()
	return env, engine_calls
end

--- What the wrapper kept after `calls`, each a list of Spring.Log arguments.
local function logged(calls)
	local env = load()
	for _, args in ipairs(calls) do
		env.Spring.Log(unpack(args))
	end
	return env.__cb_logged_errors()
end

eq("nothing logged keeps nothing", logged({}), "")

-- What counts as an error.
eq(
	"an error is kept with its section",
	logged({ { "unitdefs", 50, "Error loading units/a.lua" } }),
	PREFIX .. "[unitdefs] Error loading units/a.lua"
)
eq(
	"a fatal is kept",
	logged({ { "unitdefs", 60, "gone" } }),
	PREFIX .. "[unitdefs] gone"
)
eq("a warning is not kept", logged({ { "unitdefs", 40, "odd" } }), "")
eq("a notice is not kept", logged({ { "unitdefs", 35, "hello" } }), "")
eq("a deprecation is not kept", logged({ { "unitdefs", 37, "old" } }), "")
eq("a debug line is not kept", logged({ { "unitdefs", 20, "detail" } }), "")
eq("a level written as text is read as the engine reads it", logged({
	{ "s", "error", "a" },
	{ "s", "Error", "b" },
	{ "s", "fatal", "c" },
	{ "s", "warning", "d" },
	{ "s", "notice", "e" },
	{ "s", "info", "f" },
}), table.concat({
	PREFIX .. "[s] a",
	PREFIX .. "[s] b",
	PREFIX .. "[s] c",
}, "\n"))

-- How the message is written.
eq(
	"several messages are joined with a comma, as the engine joins them",
	logged({ { "s", 50, "one", 2, "three" } }),
	PREFIX .. "[s] one, 2, three"
)
eq(
	"a newline in a message does not make a second error",
	logged({ { "s", 50, "first\nsecond\ttabbed" } }),
	PREFIX .. "[s] first second tabbed"
)
eq(
	"each error is a line of its own",
	logged({ { "s", 50, "a" }, { "s", 30, "skipped" }, { "s", 50, "b" } }),
	PREFIX .. "[s] a\n" .. PREFIX .. "[s] b"
)

-- The engine's own Spring.Log still runs, and still decides what is allowed.
do
	local env, engine_calls = load()
	env.Spring.Log("s", 30, "just a note")
	env.Spring.Log("s", 50, "a failure")
	eq("every call reaches the engine's Spring.Log", #engine_calls, 2)
	eq("the engine gets the arguments as given", engine_calls[2][3], "a failure")
end

do
	local env = load({
		Log = function(_, level)
			if type(level) ~= "number" then error("Incorrect arguments to Spring.Log") end
		end,
	})
	local ok = pcall(env.Spring.Log, "s", "nonsense level", "x")
	check("a call the engine refuses still raises", not ok)
	eq("a call the engine refuses is not kept", env.__cb_logged_errors(), "")
end

-- The bound.
do
	local env = load()
	local big = string.rep("x", 1000)
	for _ = 1, 100 do env.Spring.Log("s", 50, big) end
	local text = env.__cb_logged_errors()
	local body, trailer = text:match("^(.*)\n([^\n]*)$")
	check("the kept text stops at 60000 bytes", #body <= 60000 + 1, #body)
	local kept = 0
	for _ in body:gmatch("[^\n]+") do kept = kept + 1 end
	local left_out = tonumber(trailer:match("^(%d+) more"))
	check("the last line says how many were left out", left_out ~= nil, trailer)
	eq("kept and left out add up to what was logged", kept + left_out, 100)
	check("some were left out", left_out > 0)
end

do
	local env = load()
	env.Spring.Log("s", 50, string.rep("y", 70000))
	local text = env.__cb_logged_errors()
	check("one line longer than the bound is cut to it", #text <= 60000, #text)
	eq("a cut line leaves room for nothing else", select(2, text:gsub("\n", "")), 0)
	env.Spring.Log("s", 50, "after")
	check(
		"nothing is kept once the bound is reached",
		env.__cb_logged_errors():find("1 more definitions script errors were not kept", 1, true)
	)
end

-- Without a Spring.Log there is nothing to wrap, and the answer is empty.
do
	local env = load({})
	eq("a parser with no Spring.Log answers with nothing", env.__cb_logged_errors(), "")
end

if failures > 0 then
	print(failures .. " failed")
	os.exit(1)
end
print("all passed")
