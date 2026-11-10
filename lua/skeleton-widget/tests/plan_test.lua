-- Run: luajit lua/skeleton-widget/tests/plan_test.lua
--
-- The body plan file coilbox writes (issue #5181): read from a fixture, matched
-- by unit definition name, and what a missing or broken file does.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local PLAN = support.module("plan.lua")
local JSON = support.module("json.lua")

local FIXTURES = support.root() .. "/tests/fixtures/"

--- The fixture folder as the engine's VFS shows it, by the path the widget asks for.
local function vfs(folder)
	local function where(path)
		return folder .. "/" .. path:gsub("^LuaUI/Config/", "")
	end
	return {
		exists = function(path)
			local f = io.open(where(path), "rb")
			if f then
				f:close()
			end
			return f ~= nil
		end,
		load = function(path)
			local f = io.open(where(path), "rb")
			local text = f:read("*a")
			f:close()
			return text
		end,
	}
end

check("the file for a game is in coilbox_skeletons", PLAN.path("sf") == "LuaUI/Config/coilbox_skeletons/sf.json", PLAN.path("sf"))
check("a name a file cannot hold is changed as coilbox changes it", PLAN.path("a b/c") == "LuaUI/Config/coilbox_skeletons/a_b_c.json", PLAN.path("a b/c"))

local units, problem = PLAN.read(vfs(FIXTURES), JSON.decode, "testgame")
check("a fixture reads with no message", problem == nil, tostring(problem))

local commander = units.fedcommander
check("a unit is matched by its definition name, whatever the case", commander ~= nil)
check("its evidence is kept", commander and commander.evidence == "fitted")
check("a piece is matched by its name, whatever the case", commander and commander.pieces.base ~= nil and commander.pieces.lthigh ~= nil)
check("a piece has its bone and its label", commander and same(commander.pieces.lthigh, { bone = "thigh.l1", label = "Left thigh" }), show(commander and commander.pieces.lthigh))
check("a piece with no label is labelled with its name", commander and commander.pieces.tag.label == "tag", show(commander and commander.pieces.tag))
check("observed evidence is kept", units.fedwalker and units.fedwalker.evidence == "observed")
check("evidence a later coilbox invents is a plan, as built is", units.fedtank and units.fedtank.evidence == "built")
check("a unit with no pieces is not an entry", units.fedempty == nil)
check("a unit that is not an object is not an entry", units.fedbroken == nil)
check("a unit the file does not name has no entry", units.fedmystery == nil)
check("a key other writers own is not a unit", units.coilbox_test_unit == nil)

local none, none_problem = PLAN.read(vfs(FIXTURES), JSON.decode, "nogame")
check("no file for the game is no units and says nothing", next(none) == nil and none_problem == nil, tostring(none_problem))

local nofolder, nofolder_problem = PLAN.read(vfs(FIXTURES .. "missing"), JSON.decode, "testgame")
check("no folder at all is the same", next(nofolder) == nil and nofolder_problem == nil)

local unnamed, unnamed_problem = PLAN.read(vfs(FIXTURES), JSON.decode, nil)
check("a game with no short name has none, and says nothing", next(unnamed) == nil and unnamed_problem == nil)

local function readText(text)
	return PLAN.read({
		exists = function()
			return true
		end,
		load = function()
			return text
		end,
	}, JSON.decode, "g")
end

local broken, broken_problem = readText("{ not json")
check("a file that is not JSON gives no units and a message", next(broken) == nil and broken_problem ~= nil and broken_problem:find("coilbox_skeletons/g.json", 1, true) ~= nil, tostring(broken_problem))

local future, future_problem = readText('{"version": 2, "units": {"a": {"pieces": {"p": {"bone": "b"}}}}}')
check("a version this widget does not read gives no units and a message", next(future) == nil and future_problem ~= nil, tostring(future_problem))

local empty = readText('{"version": 1}')
check("a file with no units is no units", next(empty) == nil)

support.report()
