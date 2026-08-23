-- Run: luajit lua/blueprint-widget/tests/json_test.lua
--
-- The widget's own JSON codec. The engine ships no JSON library, and the
-- library file, the spool and BAR's blueprints.json are all JSON.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local json = support.module("json.lua")

--------------------------------------------------------------------------------
-- decode
--------------------------------------------------------------------------------

local function decodes(name, text, want)
	local got, err = json.decode(text)
	check(name, same(got, want), err or show(got))
end

decodes("empty object", "{}", {})
decodes("empty array", "[]", {})
decodes("numbers", "[0, -1, 2.5, 1e3, -1.5E-2]", { 0, -1, 2.5, 1000, -0.015 })
decodes("literals", "[true, false, null]", { true, false, nil })
decodes("nested", '{"a": {"b": [1, {"c": "d"}]}}', { a = { b = { 1, { c = "d" } } } })
decodes("whitespace", ' \n\t{ "k" :\r\n [ 1 , 2 ] } ', { k = { 1, 2 } })
decodes("escapes", '["a\\"b", "c\\\\d", "e\\nf", "\\u00e9", "\\ud83d\\ude00"]', {
	'a"b',
	"c\\d",
	"e\nf",
	"\195\169",
	"\240\159\152\128",
})

local blueprint = json.decode([[
{
  "version": 1,
  "blueprints": [
    { "id": "x", "name": "Eco", "ordered": true,
      "buildings": [ { "def": "armsolar", "offset": { "x": 16, "z": -32 }, "facing": 1 } ],
      "footprints": { "armsolar": { "x": 4, "z": 4 } } }
  ]
}
]])
check("library file", blueprint.blueprints[1].buildings[1].offset.z == -32, show(blueprint))
check("array length survives a trailing null", #json.decode("[1, 2, null]") == 2)

local function rejects(name, text)
	local got, err = json.decode(text)
	check(name, got == nil and type(err) == "string", show(got))
end

rejects("trailing garbage", "{} x")
rejects("unterminated string", '"abc')
rejects("bad literal", "[tru]")
rejects("missing comma", "[1 2]")
rejects("missing colon", '{"a" 1}')
rejects("empty input", "")
rejects("not text", nil)

--------------------------------------------------------------------------------
-- encode
--------------------------------------------------------------------------------

local function roundtrips(name, value)
	local text = json.encode(value)
	local back, err = json.decode(text)
	check(name, same(back, value), err or (text .. " -> " .. show(back)))
end

roundtrips("object", { name = "Eco", ordered = true, n = 3 })
roundtrips("array", { 1, 2, 3 })
roundtrips("empty array stays an array", {})
roundtrips("nested", { a = { b = { { c = "d" } } } })
roundtrips("string escapes", { s = 'quote " slash \\ newline \n tab \t control \1' })
roundtrips("negative and fractional", { -1, 2.5, 1e10 })
roundtrips("unicode passes through", { "caf\195\169" })

check("integers encode without a decimal point", json.encode({ 16 }) == "[16]", json.encode({ 16 }))
check("objects sort keys", json.encode({ b = 1, a = 2 }) == '{"a":2,"b":1}', json.encode({ b = 1, a = 2 }))
check("empty table is an array", json.encode({}) == "[]", json.encode({}))
check("explicit object marker", json.encode(json.object({})) == "{}", json.encode(json.object({})))
check("null encodes", json.encode({ json.null }) == "[null]", json.encode({ json.null }))
check("null decodes to nil", json.decode("null") == nil)

local ok, err = pcall(json.encode, { f = function() end })
check("functions refuse to encode", not ok and tostring(err):find("function", 1, true) ~= nil, tostring(err))

local holes = json.encode({ [1] = "a", [3] = "c" })
check("a sparse array is an object", holes == '{"1":"a","3":"c"}', holes)

support.report()
