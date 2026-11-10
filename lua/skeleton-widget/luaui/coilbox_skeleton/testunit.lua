-- Selecting the unit Test in game is about (issue #5182).
--
-- Pure. The widget hands in what it can ask the engine, so the tests run this
-- with plain luajit.
--
-- Coilbox's Test in game writes the unit's definition name under the top level
-- key `coilbox_test_unit` of the game's skeleton file. The widget waits for the
-- player's own unit of that definition to exist, selects it once and has the
-- skeleton shown. A file with no such key, as every file a player's games have
-- but a Test in game launch, gets no picker at all.

local M = {}

--- A picker for the unit named in the file, or nil when the file names none.
-- @param name string|nil the file's `coilbox_test_unit`
-- @param engine table:
--   defID(name) the unit definition's id for a lowercase name, or nil
--   units(defID) the ids of the player's own units of that definition
--   select(unitID) selects the unit and nothing else
function M.new(name, engine)
	if type(name) ~= "string" or name == "" then
		return nil
	end
	name = name:lower()
	local done = false
	local picker = {}

	--- True while the unit has still to be found.
	function picker.pending()
		return not done
	end

	--- Look for the unit once. Select it when it is there and answer
	-- "selected" this one time, then "done" for ever after. Answers "unknown"
	-- once for a name the game has no definition for, "waiting" while no unit
	-- of it exists yet.
	-- @return string
	function picker.step()
		if done then
			return "done"
		end
		local defID = engine.defID(name)
		if not defID then
			done = true
			return "unknown"
		end
		local ids = engine.units(defID)
		if type(ids) ~= "table" or #ids == 0 then
			return "waiting"
		end
		done = true
		engine.select(ids[1])
		return "selected"
	end

	return picker
end

return M
