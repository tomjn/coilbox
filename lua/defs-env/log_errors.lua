-- Error-level Spring.Log lines under unitsync (#4928). Beyond All Reason's
-- gamedata/unitdefs.lua loads each unit file inside a pcall, and when one raises
-- it calls Spring.Log(section, LOG.ERROR, ...) and carries on without that
-- file's definitions. Spring.Log writes to the engine's log, which unitsync's
-- GetNextError never reads, so a read that lost 36 units said nothing (#4926).
--
-- This keeps those lines. The worker puts this file at the end of DEFS_ENV_SHIM
-- (crates/coilbox-unitsync-worker/src/defsenv.rs), and a unit list read sends
-- __cb_logged_errors() back beside its result, where the worker adds the lines
-- to its errors list.
--
-- What counts is what the engine counts as an error: LOG.ERROR (50) or above,
-- which takes in LOG.FATAL (60), and a level written as text that starts with
-- "e" or "f" (LuaUtils::ParseLogLevel in rts/Lua/LuaUtils.cpp). The engine's
-- Spring.Log runs first, so a call it refuses still raises and is not kept.
--
-- A noisy game cannot grow the answer without bound. Lines are kept until the
-- kept text reaches 60000 bytes, which is the size of one piece __cb_chunk
-- sends (CHUNKED_RESULT in lua.rs). That size is chosen to sit under unitsync's
-- 100000 byte string buffer, so the whole answer reads back in one piece. Past
-- it only a count is kept, and the last line says how many were left out.
do
  local limit = 60000
  local kept, size, left_out = {}, 0, 0

  function __cb_logged_errors()
    local text = table.concat(kept, '\n')
    if left_out > 0 then
      if text ~= '' then text = text .. '\n' end
      text = text .. string.format('%d more definitions script errors were not kept', left_out)
    end
    return text
  end

  if type(Spring) == 'table' and type(Spring.Log) == 'function' then
    local engine_log = Spring.Log
    local error_level = (type(LOG) == 'table' and tonumber(LOG.ERROR)) or 50

    local function is_error(level)
      if type(level) == 'number' then return level >= error_level end
      if type(level) == 'string' then
        local first = string.lower(string.sub(level, 1, 1))
        return first == 'e' or first == 'f'
      end
      return false
    end

    -- The engine joins the messages with ", ". A control character, a newline
    -- among them, becomes a space so that one error is one line.
    local function keep(section, level, ...)
      if not is_error(level) then return end
      if size >= limit then
        left_out = left_out + 1
        return
      end
      local parts = {}
      for i = 1, select('#', ...) do parts[i] = tostring((select(i, ...))) end
      local line = (string.gsub(
        'a definitions script logged an error: [' .. tostring(section) .. '] ' .. table.concat(parts, ', '),
        '%c', ' '))
      line = string.sub(line, 1, limit - size)
      kept[#kept + 1] = line
      size = size + #line + 1
    end

    Spring.Log = function(...)
      engine_log(...)
      pcall(keep, ...)
    end
  end
end
