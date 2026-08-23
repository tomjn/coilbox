-- JSON for the blueprint widget.
--
-- The engine ships no JSON library and this widget adds no dependency, so the
-- library file, the spool and BAR's blueprints.json are read and written here.
-- Decoding accepts any JSON text. Encoding covers what the widget writes:
-- strings, numbers, booleans, arrays and objects.
--
-- Lua has one table type, so the encoder calls a table an array when its keys
-- are exactly 1..n, and an object otherwise. An empty table is an array. Wrap a
-- table in json.object() to force an object, and use json.null for a JSON null
-- inside an array, where nil would end the array early.

local M = {}

--- Marks a JSON null inside a Lua array.
M.null = setmetatable({}, { __tostring = function()
	return "null"
end })

local OBJECT = {}

--- Marks a table as an object, for an empty one or one the caller wants
-- written with braces whatever its keys.
function M.object(t)
	return setmetatable(t, OBJECT)
end

--------------------------------------------------------------------------------
-- decode
--------------------------------------------------------------------------------

local ESCAPES = {
	['"'] = '"',
	["\\"] = "\\",
	["/"] = "/",
	b = "\b",
	f = "\f",
	n = "\n",
	r = "\r",
	t = "\t",
}

local function utf8(code)
	if code < 0x80 then
		return string.char(code)
	elseif code < 0x800 then
		return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
	elseif code < 0x10000 then
		return string.char(
			0xE0 + math.floor(code / 0x1000),
			0x80 + math.floor(code / 0x40) % 0x40,
			0x80 + code % 0x40
		)
	end
	return string.char(
		0xF0 + math.floor(code / 0x40000),
		0x80 + math.floor(code / 0x1000) % 0x40,
		0x80 + math.floor(code / 0x40) % 0x40,
		0x80 + code % 0x40
	)
end

local function fail(text, pos, what)
	error({ pos = pos, message = what .. " at byte " .. pos .. " of " .. #text }, 0)
end

local function skip(text, pos)
	local _, stop = text:find("^[ \t\r\n]*", pos)
	return stop + 1
end

local parseValue

local function parseString(text, pos)
	local out = {}
	local i = pos + 1
	while true do
		local c = text:sub(i, i)
		if c == "" then
			fail(text, i, "unterminated string")
		elseif c == '"' then
			return table.concat(out), i + 1
		elseif c == "\\" then
			local e = text:sub(i + 1, i + 1)
			if e == "u" then
				local hex = text:sub(i + 2, i + 5)
				if not hex:match("^%x%x%x%x$") then
					fail(text, i, "bad unicode escape")
				end
				local code = tonumber(hex, 16)
				i = i + 6
				if code >= 0xD800 and code <= 0xDBFF and text:sub(i, i + 1) == "\\u" then
					local low = tonumber(text:sub(i + 2, i + 5), 16)
					if low and low >= 0xDC00 and low <= 0xDFFF then
						code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
						i = i + 6
					end
				end
				out[#out + 1] = utf8(code)
			elseif ESCAPES[e] then
				out[#out + 1] = ESCAPES[e]
				i = i + 2
			else
				fail(text, i, "bad escape")
			end
		else
			local stop = text:find('["\\]', i) or (#text + 1)
			out[#out + 1] = text:sub(i, stop - 1)
			i = stop
		end
	end
end

local function parseNumber(text, pos)
	local _, stop = text:find("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
	if not stop then
		fail(text, pos, "bad number")
	end
	local n = tonumber(text:sub(pos, stop))
	if n == nil then
		fail(text, pos, "bad number")
	end
	return n, stop + 1
end

local function parseArray(text, pos)
	local out = {}
	pos = skip(text, pos + 1)
	if text:sub(pos, pos) == "]" then
		return out, pos + 1
	end
	local n = 0
	while true do
		local value
		value, pos = parseValue(text, pos)
		n = n + 1
		out[n] = value
		pos = skip(text, pos)
		local c = text:sub(pos, pos)
		if c == "]" then
			return out, pos + 1
		elseif c ~= "," then
			fail(text, pos, "expected , or ]")
		end
		pos = skip(text, pos + 1)
	end
end

local function parseObject(text, pos)
	local out = {}
	pos = skip(text, pos + 1)
	if text:sub(pos, pos) == "}" then
		return out, pos + 1
	end
	while true do
		if text:sub(pos, pos) ~= '"' then
			fail(text, pos, "expected a key")
		end
		local key
		key, pos = parseString(text, pos)
		pos = skip(text, pos)
		if text:sub(pos, pos) ~= ":" then
			fail(text, pos, "expected :")
		end
		pos = skip(text, pos + 1)
		local value
		value, pos = parseValue(text, pos)
		out[key] = value
		pos = skip(text, pos)
		local c = text:sub(pos, pos)
		if c == "}" then
			return out, pos + 1
		elseif c ~= "," then
			fail(text, pos, "expected , or }")
		end
		pos = skip(text, pos + 1)
	end
end

local LITERALS = { t = { "true", true }, f = { "false", false }, n = { "null", nil } }

parseValue = function(text, pos)
	local c = text:sub(pos, pos)
	if c == "{" then
		return parseObject(text, pos)
	elseif c == "[" then
		return parseArray(text, pos)
	elseif c == '"' then
		return parseString(text, pos)
	elseif c == "-" or c:match("%d") then
		return parseNumber(text, pos)
	end
	local literal = LITERALS[c]
	if literal and text:sub(pos, pos + #literal[1] - 1) == literal[1] then
		return literal[2], pos + #literal[1]
	end
	fail(text, pos, "unexpected character")
end

--- Parse JSON text.
-- @param text string
-- @return any value, or nil and a message when the text is not JSON. A top
--   level null also returns nil, with no message.
function M.decode(text)
	if type(text) ~= "string" then
		return nil, "expected a string, got " .. type(text)
	end
	local ok, value, pos = pcall(function()
		local pos = skip(text, 1)
		if pos > #text then
			fail(text, pos, "empty input")
		end
		local value, after = parseValue(text, pos)
		after = skip(text, after)
		if after <= #text then
			fail(text, after, "trailing characters")
		end
		return value, after
	end)
	if not ok then
		local err = value
		if type(err) == "table" then
			return nil, err.message
		end
		return nil, tostring(err)
	end
	return value
end

--------------------------------------------------------------------------------
-- encode
--------------------------------------------------------------------------------

local function escapeString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		if c == '"' then
			return '\\"'
		elseif c == "\\" then
			return "\\\\"
		elseif c == "\n" then
			return "\\n"
		elseif c == "\r" then
			return "\\r"
		elseif c == "\t" then
			return "\\t"
		end
		return string.format("\\u%04x", c:byte())
	end) .. '"'
end

local function isArray(t)
	if getmetatable(t) == OBJECT then
		return false
	end
	local n = 0
	for _ in pairs(t) do
		n = n + 1
	end
	return n == #t
end

local encodeValue

local function encodeArray(t)
	local parts = {}
	for i = 1, #t do
		parts[i] = encodeValue(t[i])
	end
	return "[" .. table.concat(parts, ",") .. "]"
end

local function encodeObject(t)
	local keys = {}
	for k in pairs(t) do
		keys[#keys + 1] = tostring(k)
	end
	table.sort(keys)
	local parts = {}
	for i, k in ipairs(keys) do
		local v = t[k]
		if v == nil then
			v = t[tonumber(k)]
		end
		parts[i] = escapeString(k) .. ":" .. encodeValue(v)
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

encodeValue = function(v)
	local kind = type(v)
	if v == M.null or v == nil then
		return "null"
	elseif kind == "boolean" then
		return tostring(v)
	elseif kind == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			error("cannot encode " .. tostring(v))
		end
		if v == math.floor(v) and math.abs(v) < 1e15 then
			return string.format("%d", v)
		end
		return string.format("%.14g", v)
	elseif kind == "string" then
		return escapeString(v)
	elseif kind == "table" then
		if isArray(v) then
			return encodeArray(v)
		end
		return encodeObject(v)
	end
	error("cannot encode a " .. kind)
end

--- Serialise a value as compact JSON. Object keys are sorted so the same
-- value always gives the same text.
-- @param value any
-- @return string
function M.encode(value)
	return encodeValue(value)
end

return M
