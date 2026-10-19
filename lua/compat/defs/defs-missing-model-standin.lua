-- id: defs-missing-model-standin
-- catalogue:
-- defs: defs_post
-- license: MIT or GNU GPL, v2 or later

-- Points every unit, feature and weapon def whose model is not in the game at
-- a plain box the mutator carries (issue #4686).
--
-- The engine loads the model of every unit (objectName), feature (object) and
-- weapon (model) while the game loads, and quits if one is missing
-- (CModelLoader::LogErrors in rts/Rendering/Models/IModelParser.cpp). XTA 9.65,
-- Expand and Exterminate 0.46 and Spring 1944 2.31 each name a wreck model
-- their archive does not have. Dropping the def would take the wreck away, with
-- the metal in it and the ground it blocks, so the def keeps every number and
-- only its look changes. A name close to one in the archive is not taken for
-- it, since a wrong guess would draw the wrong model.
--
-- A model is looked for the way CModelLoader::FindModelPath looks: the name in
-- lower case, given each model extension when it has none, as it is and then
-- under objects3d/. A file whose extension no model parser reads does not load
-- either. VFS.FileExists answers with nothing for a path it will not look up,
-- such as one with "..", and a def whose model cannot be checked is left alone.
--
-- The box is the def's footprint across, so a wreck covers the ground it
-- blocks: compat/models/standin-<x>x<z>.s3o. A weapon has no footprint and gets
-- the 1x1 box. The build runs this fix over the game's defs to learn which
-- boxes to write, and always writes the 1x1 one, which a def gets when the box
-- for its footprint is not there.
--
-- compat.standins lists each def changed as { kind, name, model, standin }:
-- the model it named, and the box its footprint asks for.

local compat = ...

compat.standins = {}

local FORMATS = { "3do", "s3o", "gltf", "glb", "3ds", "dae", "lwo", "obj", "blend" }
local PARSED = {}
for _, ext in ipairs(FORMATS) do
	PARSED[ext] = true
end
local DIR = "objects3d/"
local FALLBACK = "compat/models/standin-1x1.s3o"

-- The extension of the file the path names, as std::filesystem reads it, or
-- nil when it has none.
local function extension(path)
	local file = path:match("[^/\\]*$")
	local ext = file:match("^.+%.([^.]*)$")
	if ext == "" then
		return nil
	end
	return ext
end

-- true when the model loads, false when it does not, nil when it cannot be told.
local function loads(name)
	local path = name:lower()
	while true do
		if extension(path) == nil then
			for _, ext in ipairs(FORMATS) do
				local found = VFS.FileExists(path .. "." .. ext)
				if found == nil then
					return nil
				end
				if found then
					path = path .. "." .. ext
					break
				end
			end
		end
		local found = VFS.FileExists(path)
		if found == nil then
			return nil
		end
		if found then
			return PARSED[extension(path) or ""] == true
		end
		if path:find(DIR, 1, true) then
			return false
		end
		path = DIR .. path
	end
end

-- A footprint size as the engine reads it, a whole number of at least 1.
local function size(def, name)
	local n = tonumber(compat.get(def, name))
	if n == nil or n < 1 then
		return 1
	end
	return math.floor(n)
end

local function check(kind, defs, field, sized)
	if type(defs) ~= "table" then
		return
	end
	for name, def in pairs(defs) do
		if type(name) == "string" and type(def) == "table" then
			local model = compat.get(def, field)
			if type(model) == "string" and model ~= "" and loads(model) == false then
				local standin = FALLBACK
				if sized then
					standin = "compat/models/standin-" .. size(def, "footprintx") .. "x" .. size(def, "footprintz") .. ".s3o"
				end
				compat.standins[#compat.standins + 1] = { kind = kind, name = name, model = model, standin = standin }
				if standin ~= FALLBACK and not VFS.FileExists(standin) then
					standin = FALLBACK
				end
				compat.set(def, field, standin)
			end
		end
	end
end

check("unit", DEFS.unitDefs, "objectname", true)
check("feature", DEFS.featureDefs, "object", true)
check("weapon", DEFS.weaponDefs, "model", false)
