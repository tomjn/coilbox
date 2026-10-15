-- Coilbox rewind: the playback's own log file (issue #4032).
--
-- The player's, the timeline's and the ghosts widget's lines are for whoever
-- works on the player or a game's adapter, and a viewer reads them as errors.
-- The engine cannot put a line in infolog.txt and keep it off the console: a
-- line's section and level only decide whether it is logged at all
-- (log_filter_record in rts/System/Log/DefaultFilter.cpp), and every line that is
-- logged goes to every sink, the console among them (log_backend_record in
-- rts/System/Log/Backend.cpp). So these lines go to a file of their own,
-- coilbox_rewind.log, in the engine's write folder beside infolog.txt, through
-- the `io` that unsynced Lua has. Nothing of them reaches the console in any
-- game.
--
-- Synced Lua has no `io`. The gadget's synced half sends its lines to its
-- unsynced half, which writes them.

local M = {}

--- The file, in the engine's write folder.
M.PATH = "coilbox_rewind.log"

--- A function that writes a line to the file. `fresh` empties the file first,
-- which the gadget's unsynced half does as it loads, before any widget. Each Lua
-- state keeps its own handle and appends, so lines from all of them are in the
-- order they were written. Without `io`, or with a file that cannot be opened,
-- the lines go to `echo`, so that they are not lost. The second value says
-- whether the file is in use.
function M.new(io, echo, fresh)
	local file
	if type(io) == "table" and io.open then
		if fresh then
			local empty = io.open(M.PATH, "w")
			if empty then
				empty:close()
			end
		end
		file = io.open(M.PATH, "a")
	end
	if not file then
		return echo, false
	end
	return function(line)
		file:write(line, "\n")
		file:flush()
	end, true
end

return M
