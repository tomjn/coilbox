-- Coilbox in-game strings: which language a widget draws in (issue #4597).
--
-- Each widget keeps a strings.lua beside its modules that returns one table
-- per locale code, `en` complete and the rest filled as they are translated.
-- This picks one of them. The `coilbox_lang` mod option comes first, which
-- coilbox writes into the start script of a game it launches on its own
-- machine. The engine config key `CoilboxLanguage` comes next, which coilbox
-- sets for every game it launches through a settings file of that launch's
-- own (issue #5046). A networked game reaches it, because the host's script
-- goes to every player but each player's settings stay their own. The engine
-- config key `language` comes next, for a game coilbox did not launch: the
-- engine has no such setting of its own, but it is where a game's language
-- picker writes. Then `en`.
--
-- A key the chosen table lacks reads from `en`, so a table that is half
-- translated never draws nil.
--
-- `en-XA` is the pseudo-locale coilbox's own interface offers in development.
-- It has no table: it is made from `en` here, accented, padded by 30 percent
-- with "~" and bracketed, as lingui.config.ts makes coilbox's own, so text that
-- was never moved into a table and text that clips both show up on screen.
--
-- Pure. The caller hands in the mod options and the config values, which is
-- what lets the tests run this with plain luajit.
--
-- Each tree that ships on its own carries a copy: lua/mission-runtime,
-- lua/rewind-player and lua/blueprint-widget. Change this one, in
-- lua/mission-runtime/luaui/mission_ui/, and copy it to the other two.
-- lua/mission-runtime/tests/i18n_test.lua fails while they differ.

local M = {}

M.SOURCE = "en"
M.PSEUDO = "en-XA"
M.OPTION = "coilbox_lang"
-- Spelt the same as LANGUAGE_KEY in crates/tauri-plugin-coilbox-play/src/
-- launch_settings.rs. The engine reads config keys case and all.
M.CONFIG = "CoilboxLanguage"

--- A locale code with `_` read as `-` and the space around it dropped, or nil.
local function tidy(code)
	if type(code) ~= "string" then
		return nil
	end
	code = code:match("^%s*(.-)%s*$"):gsub("_", "-")
	if code == "" then
		return nil
	end
	return code
end

--- Languages written under another code: Norwegian "no" is Bokmål, `nb`.
local SAME_LANGUAGE = { no = "nb" }

--- Subtags that mark Chinese as Traditional, as src/i18n/locales.ts lists them.
local TRADITIONAL = { hant = true, tw = true, hk = true, mo = true }

--- The language part of a code: "pt" for "pt-BR", and "nb" for "no".
-- Traditional Chinese is a language of its own here, so "zh-TW" never draws
-- the `zh-Hans` table, as coilbox's own interface falls back to English then.
local function language(code)
	code = code:lower()
	local base = code:match("^([^-]+)") or code
	if base == "zh" then
		for subtag in code:gmatch("-([^-]+)") do
			if TRADITIONAL[subtag] then
				return "zh-hant"
			end
		end
	end
	return SAME_LANGUAGE[base] or base
end

--- The codes of `tables`, in order, so a match never depends on `pairs`.
local function codes(tables)
	local list = {}
	for code in pairs(tables) do
		if type(code) == "string" then
			list[#list + 1] = code
		end
	end
	table.sort(list)
	return list
end

--- The code in `tables` that `wanted` names, or nil.
--
-- The exact code first, then the same code in another case, then the first
-- table for the same language, so "fr-FR" finds `fr`, "zh" finds `zh-Hans`,
-- "pt" finds `pt-BR` and "no" finds `nb`.
function M.match(tables, wanted)
	wanted = tidy(wanted)
	if not wanted then
		return nil
	end
	if wanted:lower() == M.PSEUDO:lower() then
		return M.PSEUDO
	end
	if tables[wanted] then
		return wanted
	end
	local list = codes(tables)
	for _, code in ipairs(list) do
		if code:lower() == wanted:lower() then
			return code
		end
	end
	for _, code in ipairs(list) do
		if language(code) == language(wanted) then
			return code
		end
	end
	return nil
end

--- The code to draw in: the mod option's, then each config value given after
-- it in turn, then `en`. A source naming a language there is no table for is
-- passed over.
function M.code(tables, modOptions, ...)
	local option = type(modOptions) == "table" and modOptions[M.OPTION] or nil
	local found = M.match(tables, option)
	for i = 1, select("#", ...) do
		if found then
			break
		end
		found = M.match(tables, (select(i, ...)))
	end
	return found or M.SOURCE
end

--- The config values to hand `code` after the mod options, in the order they
-- count: coilbox's per-launch key, then the engine's `language`.
function M.config(Spring)
	return Spring.GetConfigString(M.CONFIG, ""), Spring.GetConfigString("language", "")
end

-- Every ASCII letter's pseudo-locale stand-in.
local ACCENTS = {
	a = "á", b = "ƀ", c = "ç", d = "ð", e = "é", f = "ƒ", g = "ĝ", h = "ĥ", i = "í",
	j = "ĵ", k = "ķ", l = "ĺ", m = "ɱ", n = "ñ", o = "ó", p = "þ", q = "ǫ", r = "ŕ",
	s = "š", t = "ţ", u = "ú", v = "ṽ", w = "ŵ", x = "ẋ", y = "ý", z = "ž",
	A = "Á", B = "Ɓ", C = "Ç", D = "Ð", E = "É", F = "Ƒ", G = "Ĝ", H = "Ĥ", I = "Í",
	J = "Ĵ", K = "Ķ", L = "Ĺ", M = "Ṁ", N = "Ñ", O = "Ó", P = "Þ", Q = "Ǫ", R = "Ŕ",
	S = "Š", T = "Ţ", U = "Ú", V = "Ṽ", W = "Ŵ", X = "Ẋ", Y = "Ý", Z = "Ž",
}

--- A string as the pseudo-locale shows it. A `%` and the letter after it are
-- left alone, so a string.format placeholder still works.
function M.pseudo(text)
	local out = {}
	local i, n = 1, #text
	while i <= n do
		local ch = text:sub(i, i)
		if ch == "%" and i < n then
			out[#out + 1] = text:sub(i, i + 1)
			i = i + 2
		else
			out[#out + 1] = ACCENTS[ch] or ch
			i = i + 1
		end
	end
	local pad = math.max(2, math.floor(#text * 0.3 + 0.5))
	local left = math.floor(pad / 2)
	return "[" .. ("~"):rep(left) .. table.concat(out) .. ("~"):rep(pad - left) .. "]"
end

--- The strings for `code`. Every key the table lacks reads from `en`.
function M.strings(tables, code)
	local source = tables[M.SOURCE] or {}
	if code == M.PSEUDO then
		local made = {}
		for key, value in pairs(source) do
			made[key] = type(value) == "string" and M.pseudo(value) or value
		end
		return made
	end
	local chosen = {}
	for key, value in pairs(tables[code] or {}) do
		chosen[key] = value
	end
	return setmetatable(chosen, { __index = source })
end

--- The strings to draw: `strings` for the code `code` picks.
function M.pick(tables, modOptions, ...)
	local code = M.code(tables, modOptions, ...)
	return M.strings(tables, code), code
end

return M
