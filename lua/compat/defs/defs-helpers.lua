-- id: defs-helpers
-- catalogue:
-- defs: defs_post, weapondefs_post
-- license: MIT or GNU GPL, v2 or later

-- The helpers every def fix uses. It must come first among a manifest's def
-- fixes.
--
-- The def files run before the engine lowers the keys of each definition, so a
-- unit written in Lua may spell a tag `Commander` or `commander`. The helpers
-- find a key by its lower case. When a table has two keys that differ only in
-- case, they take the one first in byte order, so the answer does not depend on
-- the order pairs walks the table in.
--
-- compat.key(t, name) is the key of t whose lower case is name, or nil.
-- compat.get(t, name) is the value at that key.
-- compat.set(t, name, value) writes value there, or at name when t has none,
-- and marks t changed.
-- compat.bool(v) reads v as the engine reads a true or false tag
-- (ParseBoolean in rts/Lua/LuaParser.cpp): a boolean as it is, a number or a
-- string holding one as true when it is not 0, the strings "true" and "false"
-- in any case, and anything else as false.
-- compat.float3(v) reads v as the engine reads three numbers (ParseFloat3):
-- a table of three numbers, or a string of three separated by spaces. It
-- answers with the three, or nothing.
-- compat.param(def, name, value) sets the def's custom parameter `name` to the
-- string `value`, unless the def already has one by that name, and marks the
-- def changed when it does. It makes the customparams table when there is none.
-- compat.units() lists every unit def, and compat.weapons() every weapon def:
-- the shared table and the ones a unit declares inside itself, once each.
-- compat.changed holds every definition a fix changed, as a key.

local compat = ...

compat.changed = {}

function compat.key(t, name)
	if type(t) ~= "table" then
		return nil
	end
	if rawget(t, name) ~= nil then
		return name
	end
	local found
	for key in pairs(t) do
		if type(key) == "string" and key:lower() == name and (found == nil or key < found) then
			found = key
		end
	end
	return found
end

function compat.get(t, name)
	local key = compat.key(t, name)
	if key ~= nil then
		return t[key]
	end
	return nil
end

function compat.set(t, name, value)
	t[compat.key(t, name) or name] = value
	compat.changed[t] = true
end

function compat.bool(v)
	if type(v) == "boolean" then
		return v
	end
	local n = tonumber(v)
	if n ~= nil then
		return n ~= 0
	end
	if type(v) == "string" then
		return v:lower() == "true"
	end
	return false
end

function compat.float3(v)
	local x, y, z
	if type(v) == "table" then
		x, y, z = tonumber(v[1]), tonumber(v[2]), tonumber(v[3])
	elseif type(v) == "string" then
		local words = {}
		for word in v:gmatch("%S+") do
			words[#words + 1] = word
			if #words == 3 then
				break
			end
		end
		x, y, z = tonumber(words[1]), tonumber(words[2]), tonumber(words[3])
	end
	if x ~= nil and y ~= nil and z ~= nil then
		return x, y, z
	end
end

function compat.param(def, name, value)
	local key = compat.key(def, "customparams")
	local params = key and def[key]
	if type(params) ~= "table" then
		params = {}
		def[key or "customparams"] = params
	end
	if compat.key(params, name) ~= nil then
		return
	end
	params[name] = value
	compat.changed[def] = true
end

local function tables(t)
	local out = {}
	if type(t) == "table" then
		for name, def in pairs(t) do
			if type(name) == "string" and type(def) == "table" then
				out[#out + 1] = def
			end
		end
	end
	return out
end

function compat.units()
	return tables(type(DEFS) == "table" and DEFS.unitDefs)
end

function compat.weapons()
	local shared = WeaponDefs
	if type(shared) ~= "table" then
		shared = type(DEFS) == "table" and DEFS.weaponDefs
	end
	local out, seen = {}, {}
	local function add(list)
		for _, def in ipairs(list) do
			if not seen[def] then
				seen[def] = true
				out[#out + 1] = def
			end
		end
	end
	add(tables(shared))
	for _, ud in ipairs(compat.units()) do
		add(tables(compat.get(ud, "weapondefs")))
	end
	return out
end
