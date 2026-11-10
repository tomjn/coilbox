-- Proves which language the in-game widgets draw in (issue #4597): the
-- mission panels with a fixture French table, the order the sources are read
-- in, the pseudo-locale, and that every widget's copy of coilbox_i18n.lua and
-- every strings.lua agree. Run it with:
--
--   luajit lua/mission-runtime/tests/i18n_test.lua

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local ROOT = support.root()
local LUA = ROOT .. "/.."
local I18N = dofile(ROOT .. "/luaui/mission_ui/coilbox_i18n.lua")
local MODEL = dofile(ROOT .. "/luaui/mission_ui/coilbox_panel_model.lua")

--- The mission panels' tables, with a fixture French one that has only some
-- of the keys, the way a table that is half translated does.
local function tables()
	local loaded = dofile(ROOT .. "/luaui/mission_ui/strings.lua")
	loaded.fr = { objectives = "Objectifs", holdHint = "Cliquez pour continuer" }
	return loaded
end

local function measure(value)
	return #value
end

local VIEW = { w = 1920, h = 1080 }

local function hasText(layout, text)
	for _, entry in ipairs(layout.texts) do
		if entry.text == text then
			return true
		end
	end
	return false
end

--------------------------------------------------------------------------------
-- The mission panels, in French.
--------------------------------------------------------------------------------

local text = I18N.pick(tables(), { coilbox_lang = "fr" }, "")
local OBJECTIVES = { { id = "a", kind = "primary", text = "Take the keep.", state = "active" } }

local L = MODEL.layout({ objectives = OBJECTIVES }, measure, VIEW, text)
check("with coilbox_lang=fr the objectives panel is titled in French", hasText(L, "Objectifs"))
check("and not in English", not hasText(L, "Objectives"))
check("the objective is the author's words, untouched", hasText(L, "Take the keep."))

L = MODEL.layout({ objectives = {}, line = { id = "x", speaker = "HQ", text = "Go." }, hold = true }, measure, VIEW, text)
check("a held line's hint is in French", hasText(L, "Cliquez pour continuer"))

L = MODEL.layout({ objectives = {}, debrief = { outcome = "victory", objectives = {} } }, measure, VIEW, text)
check("a key the French table lacks is drawn in English", hasText(L, "Mission accomplished"))

--------------------------------------------------------------------------------
-- Where the language comes from.
--------------------------------------------------------------------------------

local T = tables()
T["zh-Hans"] = { objectives = "目标" }
T["pt-BR"] = { objectives = "Objetivos" }
T.nb = { objectives = "Mål" }
T.el = { objectives = "Στόχοι" }
T.nl = { objectives = "Doelen" }
T.it = { objectives = "Obiettivi" }

check("the mod option comes first", I18N.code(T, { coilbox_lang = "fr" }, "zh-Hans") == "fr")
check("then the engine's language key", I18N.code(T, {}, "fr") == "fr")
check("then English", I18N.code(T, {}, "") == "en")
check("with no mod options at all", I18N.code(T, nil, nil) == "en")
-- Issue #5046: a networked game's script carries no mod option, so each
-- player's own launch settings come next, ahead of the engine's `language`.
check("each config value counts in the order given", I18N.code(T, {}, "de", "fr") == "de")
check("one with no table is passed over for the next", I18N.code(T, {}, "nn", "fr") == "fr")
check("and an empty one too", I18N.code(T, {}, "", "fr") == "fr")
check("the mod option still comes before them", I18N.code(T, { coilbox_lang = "fr" }, "de", "zh-Hans") == "fr")
local asked = {}
local stub = {
	GetConfigString = function(key, default)
		asked[#asked + 1] = key
		return ({ CoilboxLanguage = "de", language = "fr" })[key] or default
	end,
}
check("config reads coilbox's launch key, then the engine's",
	I18N.code(T, {}, I18N.config(stub)) == "de"
		and asked[1] == "CoilboxLanguage" and asked[2] == "language")
check("a launch with no key of its own falls to the engine's",
	I18N.code(T, {}, I18N.config({ GetConfigString = function(key, default)
		return key == "language" and "fr" or default
	end })) == "fr")
check("a mod option naming a language with no table is passed over",
	I18N.code(T, { coilbox_lang = "nn" }, "fr") == "fr")
check("and with nothing after it, English", I18N.code(T, { coilbox_lang = "nn" }, "") == "en")
check("a region finds its language", I18N.code(T, {}, "fr-FR") == "fr")
check("as does an underscore", I18N.code(T, {}, "fr_CA") == "fr")
check("a case the table does not use still matches", I18N.code(T, { coilbox_lang = "ZH-hans" }, "") == "zh-Hans")
check("a bare language finds its one table", I18N.code(T, {}, "zh") == "zh-Hans")
check("as does a region of it", I18N.code(T, {}, "zh-CN") == "zh-Hans")
check("Traditional Chinese has no table and is English", I18N.code(T, {}, "zh-Hant") == "en")
check("nor does a Traditional region", I18N.code(T, { coilbox_lang = "zh_TW" }, "") == "en")
check("nor a script and region together", I18N.code(T, {}, "zh-Hant-HK") == "en")
check("and so does pt", I18N.code(T, {}, "pt") == "pt-BR")
check("no is written nb", I18N.code(T, {}, "no") == "nb")
check("as is a region of it", I18N.code(T, { coilbox_lang = "no-NO" }, "") == "nb")
check("nb with a region finds nb", I18N.code(T, {}, "nb_NO") == "nb")
check("Nynorsk has no table and is English", I18N.code(T, {}, "nn") == "en")
check("el finds el", I18N.code(T, { coilbox_lang = "el" }, "") == "el")
check("Cypriot Greek finds el", I18N.code(T, {}, "el-CY") == "el")
check("as does el_GR", I18N.code(T, {}, "el_GR") == "el")
check("nl finds nl", I18N.code(T, { coilbox_lang = "nl" }, "") == "nl")
check("Flemish finds nl", I18N.code(T, {}, "nl-BE") == "nl")
check("as does nl_NL", I18N.code(T, {}, "nl_NL") == "nl")
check("it finds it", I18N.code(T, { coilbox_lang = "it" }, "") == "it")
check("Swiss Italian finds it", I18N.code(T, {}, "it-CH") == "it")
check("as does it_IT", I18N.code(T, {}, "it_IT") == "it")
check("a language coilbox does not draw in is English", I18N.code(T, {}, "xx") == "en")
check("the pseudo-locale needs no table", I18N.code(T, { coilbox_lang = "en-XA" }, "") == "en-XA")

local picked, code = I18N.pick(T, { coilbox_lang = "fr" }, "")
check("pick answers the code it chose", code == "fr")
check("and the strings for it", picked.objectives == "Objectifs" and picked.victory == "Mission accomplished")
check("the table it was given is left alone", T.fr.victory == nil)

--------------------------------------------------------------------------------
-- The pseudo-locale.
--------------------------------------------------------------------------------

local pseudo = I18N.pick(T, { coilbox_lang = "en-XA" }, "")
check("every pseudo string is bracketed", pseudo.objectives:match("^%[~+.+~+%]$") ~= nil, pseudo.objectives)
check("with no unaccented letter left", not pseudo.objectives:find("[A-Za-z]"), pseudo.objectives)
check("and longer than the English", #pseudo.victory > #"Mission accomplished")
local format = I18N.pseudo("%s or %s")
check("a format placeholder survives", string.format(format, "A", "B"):find("A", 1, true) ~= nil, format)

--------------------------------------------------------------------------------
-- Every widget's copy agrees.
--------------------------------------------------------------------------------

local function read(path)
	local file = assert(io.open(path, "rb"))
	local body = file:read("*a")
	file:close()
	return body
end

local CANON = ROOT .. "/luaui/mission_ui/coilbox_i18n.lua"
for _, copy in ipairs({
	LUA .. "/rewind-player/luaui/rewind_timeline/coilbox_i18n.lua",
	LUA .. "/blueprint-widget/luaui/coilbox_blueprints/coilbox_i18n.lua",
	LUA .. "/skeleton-widget/luaui/coilbox_skeleton/coilbox_i18n.lua",
}) do
	check(copy:match("lua/.*$") .. " is the same as the mission runtime's", read(copy) == read(CANON))
end

-- Every table holds only keys `en` has, as strings, and every `%` in one is
-- where `en` has it, so a translation can never break a string.format.
local function placeholders(value)
	local found = {}
	for spec in value:gmatch("%%.") do
		found[#found + 1] = spec
	end
	return table.concat(found)
end

for _, path in ipairs({
	ROOT .. "/luaui/mission_ui/strings.lua",
	LUA .. "/rewind-player/luaui/rewind_timeline/strings.lua",
	LUA .. "/blueprint-widget/luaui/coilbox_blueprints/strings.lua",
	LUA .. "/skeleton-widget/luaui/coilbox_skeleton/strings.lua",
}) do
	local name = path:match("lua/.*$")
	local loaded = dofile(path)
	check(name .. " has an English table", type(loaded.en) == "table" and next(loaded.en) ~= nil)
	for locale, strings in pairs(loaded) do
		for key, value in pairs(strings) do
			local english = loaded.en[key]
			check(name .. " " .. locale .. "." .. key .. " is a string English has",
				type(value) == "string" and type(english) == "string")
			if type(value) == "string" and type(english) == "string" then
				check(name .. " " .. locale .. "." .. key .. " keeps English's placeholders",
					placeholders(value) == placeholders(english), placeholders(value))
			end
		end
	end
end

support.report()
