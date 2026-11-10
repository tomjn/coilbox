-- The body plan file coilbox writes for the skeleton widget (issue #5181).
--
-- Pure. The widget hands in the engine's file reader, so the tests run this
-- with plain luajit.
--
-- LuaUI/Config/coilbox_skeletons/<Game.gameShortName>.json:
--
--   {
--     "version": 1,
--     "units": {
--       "armcom": {
--         "evidence": "built" | "fitted" | "observed",
--         "pieces": { "lthigh": { "bone": "thigh.l1", "label": "Left thigh" } }
--       }
--     }
--   }
--
-- A unit is matched by its unit definition's name and a piece by the name the
-- engine reports, both ignoring case. The writer is src/lego/skeletonFile.ts.
-- `coilbox_test_unit`, a unit definition's name, is the unit Test in game wants
-- selected (issue #5182, testunit.lua). Other keys beyond `version` and `units`
-- belong to other writers and are ignored.

local M = {}

M.FOLDER = "LuaUI/Config/coilbox_skeletons/"
M.VERSION = 1

--- The file name for a game: anything a file name cannot hold becomes an
-- underscore, as skeletonFileName in src/lego/skeletonFile.ts does.
function M.path(shortName)
	return M.FOLDER .. tostring(shortName):gsub("[^%w._-]", "_") .. ".json"
end

--- A unit's bones as the widget uses them, or nil when the file says nothing
-- useful about it.
-- @return table|nil { evidence = "built"|"fitted"|"observed", pieces = { [lowercase piece name] = { bone, label } } }
local function normalise(unit)
	if type(unit) ~= "table" or type(unit.pieces) ~= "table" then
		return nil
	end
	local pieces, count = {}, 0
	for name, piece in pairs(unit.pieces) do
		if type(name) == "string" and type(piece) == "table" then
			local label = piece.label
			if type(label) ~= "string" or label == "" then
				label = name
			end
			pieces[name:lower()] = { bone = tostring(piece.bone or ""), label = label }
			count = count + 1
		end
	end
	if count == 0 then
		return nil
	end
	-- A word this version does not know is a plan, as `built` is
	local evidence = unit.evidence == "observed" and "observed" or (unit.evidence == "fitted" and "fitted" or "built")
	return { evidence = evidence, pieces = pieces }
end

--- Every unit's bones from a file's text.
-- @param text string the file
-- @param decode function(text) the JSON decoder
-- @return table|nil units by lowercase unit definition name, or nil and a message when the text is not a skeleton file
-- @return string|nil the file's `coilbox_test_unit`, when it is a name
function M.parse(text, decode)
	local value, err = decode(text)
	if type(value) ~= "table" then
		return nil, err or "not an object"
	end
	if value.version ~= M.VERSION then
		return nil, "version " .. tostring(value.version) .. " is not one this widget reads"
	end
	local units = {}
	if type(value.units) == "table" then
		for name, unit in pairs(value.units) do
			local entry = type(name) == "string" and normalise(unit)
			if entry then
				units[name:lower()] = entry
			end
		end
	end
	local testUnit = type(value.coilbox_test_unit) == "string" and value.coilbox_test_unit ~= "" and value.coilbox_test_unit or nil
	return units, testUnit
end

--- Read a game's file.
--
-- `vfs` is what the widget has of the engine:
--   exists(path) whether the file is there
--   load(path) its text
--
-- No file is the normal case, since a game coilbox has written nothing for has
-- none, so it answers an empty table and no message.
-- @return table units, string|nil a message for a file that is there and will not read, string|nil the file's `coilbox_test_unit`
function M.read(vfs, decode, shortName)
	if not shortName or shortName == "" then
		return {}
	end
	local path = M.path(shortName)
	if not vfs.exists(path) then
		return {}
	end
	local text = vfs.load(path)
	if type(text) ~= "string" then
		return {}, path .. " could not be read"
	end
	local units, testUnit = M.parse(text, decode)
	if not units then
		return {}, path .. ": " .. testUnit
	end
	return units, nil, testUnit
end

return M
