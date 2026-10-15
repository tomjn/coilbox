-- Reads the engine names a file of Lua uses, for the tests that hold the
-- engine tables to the source (issue #3802). Comments and strings are taken
-- out first, so a name in either is not a use.
--
-- A name is a use when it is a member of `Spring`, `VFS`, `Game`, `CMD`,
-- `Script`, `gl` or `GL`, a member of `Spring.MoveCtrl` or `Spring.UnitScript`
-- however it is reached, or the global `SendToUnsynced`. A parameter called
-- `vfs` is `VFS`.

local M = {}

function M.sourceOf(path)
	local file = assert(io.open(path, "rb"))
	local source = file:read("*a")
	file:close()
	return source
end

function M.strip(source)
	local out, i, n = {}, 1, #source
	while i <= n do
		local c = source:sub(i, i)
		if c == "-" and source:sub(i, i + 1) == "--" then
			i = source:find("\n", i, true) or n + 1
		elseif c == '"' or c == "'" then
			local j = i + 1
			while j <= n do
				local d = source:sub(j, j)
				if d == "\\" then
					j = j + 2
				elseif d == c then
					break
				else
					j = j + 1
				end
			end
			i = j + 1
			out[#out + 1] = '""'
		else
			out[#out + 1] = c
			i = i + 1
		end
	end
	return table.concat(out)
end

--- The engine names a file of Lua uses, as a set.
function M.usedBy(path)
	local code = M.strip(M.sourceOf(path)):gsub("%f[%w_]vfs%.", "VFS.")
	local found = {}
	for _, root in ipairs({ "Spring", "VFS", "Game", "CMD", "Script", "gl", "GL" }) do
		for member in code:gmatch("%f[%w_]" .. root .. "%.([%w_]+)") do
			if not (root == "Spring" and (member == "MoveCtrl" or member == "UnitScript")) then
				found[root .. "." .. member] = true
			end
		end
	end
	for member in code:gmatch("%f[%w_]MoveCtrl%.([%w_]+)") do
		found["Spring.MoveCtrl." .. member] = true
	end
	for member in code:gmatch("%f[%w_]UnitScript%.([%w_]+)") do
		found["Spring.UnitScript." .. member] = true
	end
	if code:find("%f[%w_]SendToUnsynced%f[^%w_]") then
		found.SendToUnsynced = true
	end
	return found
end

--- The Lua files under a directory, sorted.
function M.filesUnder(dir)
	local list = {}
	local pipe = io.popen('find "' .. dir .. '" -name "*.lua" | sort')
	for line in pipe:lines() do
		list[#list + 1] = line
	end
	pipe:close()
	return list
end

--- A set of the items of the lists given.
function M.setOf(...)
	local set = {}
	for _, list in ipairs({ ... }) do
		for _, item in ipairs(list) do
			set[item] = true
		end
	end
	return set
end

--- Every call of the rows, as a list.
function M.callsOf(rows)
	local list = {}
	for _, row in ipairs(rows) do
		for _, call in ipairs(row.calls) do
			list[#list + 1] = call
		end
	end
	return list
end

return M
