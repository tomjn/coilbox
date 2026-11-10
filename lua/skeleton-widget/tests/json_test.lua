-- Run: luajit lua/skeleton-widget/tests/json_test.lua
--
-- The decoder the widget carries a copy of (issue #5181). plan_test.lua reads
-- real files through it. This covers what a file written by coilbox does not
-- reach: escapes, surrogate pairs, numbers, and text that is not JSON.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local J = support.module("json.lua")

local function decodes(name, text, want)
	local got, err = J.decode(text)
	check(name, same(got, want) and err == nil, show(got) .. " " .. tostring(err))
end

local function refuses(name, text)
	local got, err = J.decode(text)
	check(name, got == nil and type(err) == "string", show(got) .. " " .. tostring(err))
end

decodes("an object", '{"a": 1, "b": "x"}', { a = 1, b = "x" })
decodes("an array", "[1, 2, 3]", { 1, 2, 3 })
decodes("nesting", '{"a": [{"b": true}, false]}', { a = { { b = true }, false } })
decodes("an empty object", "{}", {})
decodes("an empty array", "[]", {})
decodes("surrounding space", ' \n\t{"a":1}\r\n', { a = 1 })
decodes("numbers", "[0, -1, 2.5, 1e3, -2.5E-1]", { 0, -1, 2.5, 1000, -0.25 })
decodes("a string", '"hello"', "hello")
decodes("simple escapes", [["a\"b\\c\/d\ne\tf"]], 'a"b\\c/d\ne\tf')
decodes("a unicode escape", [["é"]], "\195\169")
decodes("a surrogate pair", [["😀"]], "\240\159\152\128")
decodes("literals in an array", "[true, false]", { true, false })

local null = J.decode("null")
check("a top level null is nil with no message", null == nil and select(2, J.decode("null")) == nil)

refuses("empty text", "")
refuses("only space", "   ")
refuses("not JSON", "{ nope")
refuses("an unterminated string", '"abc')
refuses("a bad escape", [["\q"]])
refuses("a bad unicode escape", [["\u12"]])
refuses("trailing characters", '{"a":1} x')
refuses("a missing colon", '{"a" 1}')
refuses("a missing comma", "[1 2]")
refuses("an unquoted key", "{a: 1}")
refuses("a bare word", "maybe")

local got, err = J.decode(42)
check("a value that is not text is refused", got == nil and err:find("expected a string", 1, true) ~= nil, tostring(err))

support.report()
