-- Shared scaffolding for the blueprint widget's tests.
--
-- The widget's modules take the engine tables they use as arguments, so a test
-- hands them a stub. The stub records what a module asked for and answers the
-- few reads the modules make: unit defs, selected units, build positions.
--
-- This directory is not installed. Only luaui/ is copied into the content root.

local M = {}

M.failures = 0

function M.check(name, ok, detail)
	if ok then
		print("ok   " .. name)
	else
		M.failures = M.failures + 1
		print("FAIL " .. name .. (detail and (": " .. detail) or ""))
	end
end

function M.report()
	if M.failures > 0 then
		print(M.failures .. " failed")
		os.exit(1)
	end
	print("all passed")
end

--- lua/blueprint-widget, derived from the test file's own path.
function M.root()
	local dir = arg[0]:match("^(.*)/[^/]+$") or "."
	return dir .. "/.."
end

--- Load a module the way the widget does with VFS.Include: as a chunk that
-- returns its table.
function M.module(path)
	local chunk = assert(loadfile(M.root() .. "/luaui/coilbox_blueprints/" .. path))
	return chunk()
end

--- Compare two values structurally, for tables that hold numbers, strings,
-- booleans and nested tables.
function M.same(a, b)
	if type(a) ~= type(b) then
		return false
	end
	if type(a) ~= "table" then
		return a == b
	end
	for k, v in pairs(a) do
		if not M.same(v, b[k]) then
			return false
		end
	end
	for k in pairs(b) do
		if a[k] == nil then
			return false
		end
	end
	return true
end

--- A readable rendering for failure details.
function M.show(value)
	if type(value) ~= "table" then
		return tostring(value)
	end
	local keys = {}
	for k in pairs(value) do
		keys[#keys + 1] = k
	end
	table.sort(keys, function(x, y)
		return tostring(x) < tostring(y)
	end)
	local parts = {}
	for _, k in ipairs(keys) do
		parts[#parts + 1] = tostring(k) .. "=" .. M.show(value[k])
	end
	return "{" .. table.concat(parts, ", ") .. "}"
end

--- A unit def table shaped like the engine's UnitDefs entry, with only the
-- fields the widget reads.
-- @param id integer
-- @param name string internal name
-- @param opts table? isBuilding, xsize, zsize, buildOptions (def ids), humanName
function M.def(id, name, opts)
	opts = opts or {}
	return {
		id = id,
		name = name,
		humanName = opts.humanName or name,
		isBuilding = opts.isBuilding or false,
		xsize = opts.xsize or 2,
		zsize = opts.zsize or 2,
		buildOptions = opts.buildOptions or {},
	}
end

--- The engine stub. Holds UnitDefs and UnitDefNames built from the defs given,
-- a selection, and records every order issued.
-- @param defs table[] from M.def
-- @param opts table? selected (unit ids), units (id -> { def, x, y, z, facing }),
--   blocked (function(defID, x, z, facing) -> status), ground (function(x, z) -> y)
function M.engine(defs, opts)
	opts = opts or {}
	local E = {
		UnitDefs = {},
		UnitDefNames = {},
		orders = {},
		echoed = {},
		units = opts.units or {},
		selected = opts.selected or {},
		ground = opts.ground or function()
			return 0
		end,
		blocked = opts.blocked or function()
			return 2
		end,
	}
	for _, def in ipairs(defs) do
		E.UnitDefs[def.id] = def
		E.UnitDefNames[def.name] = def
	end

	E.Spring = {
		Echo = function(...)
			E.echoed[#E.echoed + 1] = table.concat({ ... }, " ")
		end,
		GetSelectedUnits = function()
			local copy = {}
			for i, id in ipairs(E.selected) do
				copy[i] = id
			end
			return copy
		end,
		GetUnitDefID = function(unitID)
			local unit = E.units[unitID]
			return unit and unit.def or nil
		end,
		GetUnitPosition = function(unitID)
			local unit = E.units[unitID]
			if not unit then
				return nil
			end
			return unit.x, unit.y or 0, unit.z
		end,
		GetUnitBuildFacing = function(unitID)
			local unit = E.units[unitID]
			return unit and unit.facing or 0
		end,
		-- Snaps the way CGameHelper::Pos2BuildPos does: a footprint spanning an
		-- odd number of build squares centres on a square, an even one on a
		-- corner.
		Pos2BuildPos = function(defID, x, y, z, facing)
			local def = E.UnitDefs[defID]
			local xs, zs = def.xsize, def.zsize
			if facing % 2 == 1 then
				xs, zs = zs, xs
			end
			local function snap(v, size)
				if (size / 2) % 2 == 1 then
					return math.floor(v / 16) * 16 + 8
				end
				return math.floor((v + 8) / 16) * 16
			end
			local sx, sz = snap(x, xs), snap(z, zs)
			return sx, E.ground(sx, sz), sz
		end,
		TestBuildOrder = function(defID, x, y, z, facing)
			return E.blocked(defID, x, z, facing)
		end,
		GiveOrderArrayToUnitArray = function(unitIDs, cmds)
			E.orders[#E.orders + 1] = { units = unitIDs, cmds = cmds }
			return true
		end,
	}
	E.Game = {
		gameName = opts.gameName or "Test Game 1.0",
		gameShortName = opts.gameShortName or "TEST",
		mapName = opts.mapName or "Test Map",
	}
	return E
end

return M
