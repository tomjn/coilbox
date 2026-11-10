-- Run: luajit lua/skeleton-widget/tests/testunit_test.lua
--
-- The unit Test in game wants selected (issue #5182): the key read from the
-- file, and the picker that selects the unit once it exists.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local PLAN = support.module("plan.lua")
local JSON = support.module("json.lua")
local TESTUNIT = support.module("testunit.lua")

local FIXTURES = support.root() .. "/tests/fixtures/"

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

--- Read a file's text as the widget would.
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

--------------------------------------------------------------------------------
-- The entry
--------------------------------------------------------------------------------

local _, problem, named = PLAN.read(vfs(FIXTURES), JSON.decode, "testgame")
check("the fixture reads with no message", problem == nil, tostring(problem))
check("the test unit is the file's coilbox_test_unit", named == "fedcommander", show(named))

local _, _, none = PLAN.read(vfs(FIXTURES), JSON.decode, "nogame")
check("no file names no test unit", none == nil)

local _, _, absent = readText('{"version": 1, "units": {}}')
check("a file without the key names no test unit", absent == nil)

local _, _, notAName = readText('{"version": 1, "coilbox_test_unit": 5}')
check("a value that is not a name is no test unit", notAName == nil)

local _, _, empty = readText('{"version": 1, "coilbox_test_unit": ""}')
check("an empty name is no test unit", empty == nil)

local _, brokenProblem, brokenName = readText("{ not json")
check("a file that will not read names no test unit and says why", brokenName == nil and brokenProblem ~= nil)

--------------------------------------------------------------------------------
-- The picker
--------------------------------------------------------------------------------

--- An engine with `defs` (name to id) and a list of `alive` unit ids by def id,
-- recording what was selected.
local function engine(defs, alive)
	local e = { selected = {}, asked = {} }
	e.defID = function(name)
		e.asked[#e.asked + 1] = name
		return defs[name]
	end
	e.units = function(defID)
		return alive[defID] or {}
	end
	e.select = function(unitID)
		e.selected[#e.selected + 1] = unitID
	end
	return e
end

check("no name, no picker", TESTUNIT.new(nil, engine({}, {})) == nil)
check("an empty name, no picker", TESTUNIT.new("", engine({}, {})) == nil)

do
	local e = engine({ fedcommander = 7 }, { [7] = { 31, 32 } })
	local picker = TESTUNIT.new("FedCommander", e)
	check("a name makes a picker that is waiting", picker ~= nil and picker.pending())
	check("the unit is selected when it exists", picker.step() == "selected")
	check("the name is looked up in lowercase", same(e.asked, { "fedcommander" }), show(e.asked))
	check("only the first unit is selected, and only it", same(e.selected, { 31 }), show(e.selected))
	check("then it is done", not picker.pending())
	check("selecting happens once", picker.step() == "done" and picker.step() == "done" and #e.selected == 1, show(e.selected))
end

do
	local alive = {}
	local e = engine({ fedcommander = 7 }, alive)
	local picker = TESTUNIT.new("fedcommander", e)
	check("it waits while the unit does not exist", picker.step() == "waiting" and picker.step() == "waiting")
	check("and selects nothing while it waits", #e.selected == 0 and picker.pending())
	alive[7] = { 55 }
	check("it selects the unit when it appears", picker.step() == "selected" and same(e.selected, { 55 }), show(e.selected))
	alive[7] = { 56 }
	picker.step()
	check("a later unit is not selected", same(e.selected, { 55 }), show(e.selected))
end

do
	local e = engine({}, {})
	local picker = TESTUNIT.new("nosuchunit", e)
	check("a name the game has no definition for is reported once", picker.step() == "unknown")
	check("and then it stops looking", not picker.pending() and picker.step() == "done" and #e.selected == 0)
end

support.report()
