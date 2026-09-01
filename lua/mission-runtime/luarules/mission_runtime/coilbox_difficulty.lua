-- Coilbox mission runtime: which difficulty the mission is being played at.
--
-- One scenario is played at every difficulty, so the level is not in the
-- compiled mission. It arrives in the coilbox_difficulty modoption, beside the
-- coilbox_mission that named the mission in the first place, and everything the
-- scenario gates carries a range that is read against it (issue #2164).
--
-- Pure. No engine calls, no state, no globals beyond the Lua standard library.
-- The gadget reads the modoption and hands the level here, which is what makes
-- the whole of the gating provable with plain luajit and no engine.

local M = {}

-- The ladder, easiest first. Never reorder or drop one: a document names a
-- level by its own name, so this order is the meaning of every range an author
-- has already written.
M.LEVELS = { "easy", "normal", "hard" }

-- What a mission plays at when nobody chose, which is the middle one. It is
-- also what an older coilbox launching a newer mission leaves behind, since it
-- writes no modoption at all.
M.DEFAULT = "normal"

-- Level name -> where it sits on the ladder.
local RANK = {}
for index, name in ipairs(M.LEVELS) do
	RANK[name] = index
end

--- The level a modoption names.
--
-- Trimmed and lowercased, because it is a start script field an author or
-- another launcher may have written by hand. Anything this build cannot rank
-- falls back to the default rather than to the hardest or the easiest, and is
-- reported: guessing which end of the ladder an unknown word meant is how a
-- player who asked for easy gets hard.
--
-- @param value the raw modoption
-- @return the level, and the problem to log or nil
function M.parse(value)
	if value == nil then
		return M.DEFAULT, nil
	end
	if type(value) ~= "string" then
		return M.DEFAULT, "ignoring a coilbox_difficulty that is not a name, playing at " .. M.DEFAULT
	end

	local name = value:match("^%s*(.-)%s*$"):lower()
	if name == "" then
		return M.DEFAULT, nil
	end
	if not RANK[name] then
		return M.DEFAULT, string.format(
			"this runtime has no difficulty called %s, playing at %s", name, M.DEFAULT)
	end
	return name, nil
end

--- Whether something with `range` is part of a mission played at `level`.
--
-- Both bounds are optional and inclusive, and a range that names neither is
-- what everything authored before difficulty existed says: it is always there.
-- A bound this runtime cannot rank is ignored rather than treated as excluding,
-- so a mission built against a longer ladder loses the bound and keeps the
-- thing, which is the safe way round for a placement.
function M.applies(range, level)
	if type(range) ~= "table" then
		return true
	end

	local at = RANK[level]
	if not at then
		return true
	end

	local least = RANK[range.atLeast]
	if least and at < least then
		return false
	end
	local most = RANK[range.atMost]
	if most and at > most then
		return false
	end
	return true
end

--- {@link M.applies} bound to one level, which is what the rest of the runtime
-- filters with. One closure passed down rather than the level and this module
-- both, so a module that gates something needs no opinion about the ladder.
function M.gate(level)
	return function(range)
		return M.applies(range, level)
	end
end

return M
