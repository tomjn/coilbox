-- Shared scaffolding for the skeleton widget's tests.
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

--- lua/skeleton-widget, derived from the test file's own path.
function M.root()
	local dir = arg[0]:match("^(.*)/[^/]+$") or "."
	return dir .. "/.."
end

--- Load a module the way the widget does with VFS.Include.
function M.module(path)
	local chunk = assert(loadfile(M.root() .. "/luaui/coilbox_skeleton/" .. path))
	return chunk()
end

--- Compare two values structurally.
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

return M
