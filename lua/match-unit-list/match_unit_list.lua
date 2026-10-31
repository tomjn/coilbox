-- The unit list the engine built for one match, read through unitsync (#3847).
--
-- A replay's unit definition id n is entry n of the list the engine built when
-- that match loaded. The engine built it by running gamedata/defs.lua with the
-- match's own setup to hand, and then refused some definitions. Unitsync runs
-- the same file with no setup and refuses nothing. This file closes both gaps
-- as far as a start script can, and is spliced by the unitsync worker in front
-- of the script that runs gamedata/defs.lua.
--
-- It is not a file of its own to the engine. The worker writes one line ahead
-- of it, `local __cb_match = { ... }` or `local __cb_match = nil`, and the
-- text after it reads `__cb_engine_keeps`. With `__cb_match` nil nothing is
-- installed and the worker's own stand-in answers as it always has, as if no
-- game were set up.
--
-- Every function is a copy of the engine's, and says which. The source read is
-- RecoilEngine at 2026.07.01-113-g212c369b4c.
--
-- `__cb_match` holds the setup as the engine holds it after CGameSetup::Init
-- (rts/Game/GameSetup.cpp) and CTeamHandler::LoadFromSetup
-- (rts/Sim/Misc/TeamHandler.cpp): players, teams and ally teams renumbered
-- from 0 with no gaps, and the Gaia team and its ally team added last.
--
--   modOptions, mapOptions   key to value, both strings
--   teams[i]                 leader, ally, side, income, custom
--   allies[i][j]             whether ally team i - 1 is allied with j - 1
--   allyCustom[i]            key to value
--   players[i]               team, spectator
--   ais[i]                   team, name, host, lua
--   gaia                     the Gaia team's id, or false

if __cb_match and type(Spring) == 'table' then
  local match = __cb_match

  local function copy(t)
    local out = {}
    for k, v in pairs(t) do out[k] = v end
    return out
  end

  -- luaL_checkint: a number, or a string that reads as one, cut to a whole
  -- number. Anything else raises.
  local function int(v, name)
    local n = tonumber(v)
    if n == nil then error('bad argument to ' .. name .. ' (number expected)', 3) end
    if n >= 0 then return math.floor(n) end
    return math.ceil(n)
  end

  -- lua_isnumber, which is true of a string that reads as a number.
  local function isnumber(v)
    return type(v) == 'number' or (type(v) == 'string' and tonumber(v) ~= nil)
  end

  -- CTeamHandler::IsValidTeam and IsValidAllyTeam.
  local function team(id) return match.teams[id + 1] end
  local function valid_ally(id) return match.allies[id + 1] ~= nil end

  -- CTeamHandler::AlliedTeams.
  local function allied(a, b)
    return match.allies[team(a).ally + 1][team(b).ally + 1] == true
  end

  -- The skirmish AIs on a team, lowest id first.
  -- CSkirmishAIHandler::GetSkirmishAIsInTeam.
  local function ais_in(id)
    local out = {}
    for index, ai in ipairs(match.ais) do
      if ai.team == id then out[#out + 1] = index - 1 end
    end
    return out
  end

  -- PushAllOptions and PushSingleOption, rts/Lua/LuaSyncedRead.cpp. A new
  -- table of strings on every call.
  Spring.GetModOptions = function() return copy(match.modOptions) end
  Spring.GetMapOptions = function() return copy(match.mapOptions) end
  Spring.GetModOption = function(key)
    if type(key) ~= 'string' and type(key) ~= 'number' then
      error('bad argument to GetModOption (string expected)', 2)
    end
    local value = match.modOptions[tostring(key)]
    if value ~= nil then return value end
  end
  Spring.GetMapOption = function(key)
    if type(key) ~= 'string' and type(key) ~= 'number' then
      error('bad argument to GetMapOption (string expected)', 2)
    end
    local value = match.mapOptions[tostring(key)]
    if value ~= nil then return value end
  end

  -- LuaSyncedRead::GetGaiaTeamID. No value at all when the match has no Gaia.
  Spring.GetGaiaTeamID = function()
    if match.gaia then return match.gaia end
  end

  -- LuaSyncedRead::GetAllyTeamList.
  Spring.GetAllyTeamList = function()
    local out = {}
    for index = 1, #match.allies do out[index] = index - 1 end
    return out
  end

  -- LuaSyncedRead::GetTeamList. With an argument it must name an ally team,
  -- so -1 gives no value, whatever the engine's own documentation says.
  Spring.GetTeamList = function(...)
    local ally = -1
    if select('#', ...) >= 1 then
      ally = int((...), 'GetTeamList')
      if not valid_ally(ally) then return end
    end
    local out = {}
    for index, t in ipairs(match.teams) do
      if ally < 0 or t.ally == ally then out[#out + 1] = index - 1 end
    end
    return out
  end

  -- LuaSyncedRead::GetPlayerList. A player is active from the moment its name
  -- arrives over the network (CGame::ClientReadNet, rts/Net/NetCommands.cpp),
  -- and the definitions load before the game reads the network, so asking for
  -- active players gives an empty list. That is from reading the source. It
  -- has not been measured in a running engine.
  Spring.GetPlayerList = function(a, b)
    local id, active = -1, false
    if isnumber(a) then
      id = int(a, 'GetPlayerList')
      if type(b) == 'boolean' then active = b end
    elseif type(a) == 'boolean' then
      active = a
      if isnumber(b) then id = int(b, 'GetPlayerList') end
    end
    if id >= #match.teams then return end
    local out = {}
    if active then return out end
    for index, player in ipairs(match.players) do
      if id < 0 or (not player.spectator and player.team == id) then
        out[#out + 1] = index - 1
      end
    end
    return out
  end

  -- LuaSyncedRead::GetTeamInfo. No team is dead while the game loads.
  Spring.GetTeamInfo = function(id, keys)
    id = int(id, 'GetTeamInfo')
    local t = team(id)
    if not t then return end
    if keys == nil then keys = true end
    local has_ai = #ais_in(id) > 0
    if keys then
      return id, t.leader, false, has_ai, t.side, t.ally, t.income, copy(t.custom)
    end
    return id, t.leader, false, has_ai, t.side, t.ally, t.income
  end

  -- LuaSyncedRead::GetTeamAllyTeamID.
  Spring.GetTeamAllyTeamID = function(id)
    local t = team(int(id, 'GetTeamAllyTeamID'))
    if t then return t.ally end
  end

  -- LuaSyncedRead::GetTeamLuaAI. The first AI on the team whose short name the
  -- game's LuaAI.lua lists (CSkirmishAIHandler::IsLuaAI). A team that does not
  -- exist raises, and a team with no such AI gives no value.
  Spring.GetTeamLuaAI = function(id)
    id = int(id, 'GetTeamLuaAI')
    if not team(id) then error('Bad teamID in GetTeamLuaAI', 2) end
    for _, ai in ipairs(ais_in(id)) do
      local lua = match.ais[ai + 1].lua
      if lua then return lua end
    end
  end

  -- LuaSyncedRead::GetAIInfo. The parser's Lua state is marked synced
  -- (LuaParser's constructors set D.synced = true), so the short name and the
  -- version are the two placeholders and the options are empty.
  Spring.GetAIInfo = function(id)
    id = int(id, 'GetAIInfo')
    if not team(id) then return end
    local on_team = ais_in(id)
    if #on_team == 0 then return end
    local ai = match.ais[on_team[1] + 1]
    return on_team[1], ai.name, ai.host, 'SYNCED_NOSHORTNAME', 'SYNCED_NOVERSION', {}
  end

  -- LuaSyncedRead::GetAllyTeamInfo. It reads its last argument.
  Spring.GetAllyTeamInfo = function(...)
    local id = int((select(select('#', ...), ...)), 'GetAllyTeamInfo')
    if not valid_ally(id) then return end
    return copy(match.allyCustom[id + 1])
  end

  -- LuaSyncedRead::AreTeamsAllied. It reads its last two arguments.
  Spring.AreTeamsAllied = function(...)
    local n = select('#', ...)
    local first = int((select(n, ...)), 'AreTeamsAllied')
    local second = int((select(n - 1, ...)), 'AreTeamsAllied')
    if not team(first) or not team(second) then return end
    return allied(first, second)
  end

  -- LuaSyncedRead::ArePlayersAllied. It reads its last two arguments.
  Spring.ArePlayersAllied = function(...)
    local n = select('#', ...)
    local first = match.players[int((select(n, ...)), 'ArePlayersAllied') + 1]
    local second = match.players[int((select(n - 1, ...)), 'ArePlayersAllied') + 1]
    if not first or not second then return end
    return allied(first.team, second.team)
  end
end

-- The definitions the engine gives an id to, as a table keyed the way the
-- engine keys it and the keys in id order.
--
-- CUnitDefHandler::Init (rts/Sim/Units/UnitDefHandler.cpp) takes the string
-- keys of the UnitDefs table, sorted, and hands each to PushNewUnitDef. That
-- takes the next id, builds the definition, and gives the id back when the
-- UnitDef constructor (rts/Sim/Units/UnitDef.cpp) throws. So a refused
-- definition takes no id and the next one gets it.
local function __cb_engine_keeps(defs, units)
  -- LuaUtils::LowerKeys (rts/Lua/LuaUtils.cpp), which the parser runs over
  -- everything a script returns: a key already in lower case wins over a
  -- mixed case spelling of it.
  local function lowered(t)
    local out = {}
    if type(t) ~= 'table' then return out end
    for k, v in pairs(t) do
      if type(k) ~= 'string' then
        out[k] = v
      elseif string.lower(k) == k then
        out[k] = v
      end
    end
    for k, v in pairs(t) do
      if type(k) == 'string' then
        local lower = string.lower(k)
        if lower ~= k and t[lower] == nil then out[lower] = v end
      end
    end
    return out
  end

  -- LuaTable::Get(key, float) (rts/Lua/LuaParser.cpp). A number, a string that
  -- reads as one, zero for a string that does not, and the default for a
  -- missing key or any other type.
  local function number(t, key, default)
    local v = t[key]
    if v == nil then return default end
    local n = tonumber(v)
    if n ~= nil then return n end
    if type(v) == 'string' then return 0 end
    return default
  end

  -- LuaTable::Get(key, bool), through ParseBoolean.
  local function boolean(t, key, default)
    local v = t[key]
    if type(v) == 'boolean' then return v end
    local n = (type(v) == 'number' or type(v) == 'string') and tonumber(v) or nil
    if n ~= nil then return n ~= 0 end
    if type(v) == 'string' then
      local s = string.lower(v)
      if s == 'true' then return true end
      if s == 'false' then return false end
    end
    return default
  end

  -- LuaTable::Get(key, string).
  local function text(t, key, default)
    local v = t[key]
    if type(v) == 'string' then return v end
    if type(v) == 'number' then return tostring(v) end
    return default
  end

  -- The movement classes the game defines, by lowercased name.
  -- MoveDefHandler::Init (rts/Sim/MoveTypes/MoveDefHandler.cpp) reads the
  -- MoveDefs table from 1 until the first entry that is not a table.
  local classes = {}
  local moves = lowered(defs).movedefs
  if type(moves) == 'table' then
    local index = 1
    while type(moves[index]) == 'table' do
      classes[string.lower(text(lowered(moves[index]), 'name', ''))] = true
      index = index + 1
    end
  end

  -- The nine throws of the UnitDef constructor, in its order. GAME_SPEED is
  -- 30 (rts/Sim/Misc/GlobalConstants.h). A definition that is not a table
  -- reads as every default, which the engine accepts.
  local function refused(def)
    local u = lowered(def)
    if number(u, 'health', number(u, 'maxdamage', 100)) <= 0 then return true end
    if number(u, 'metalcost', number(u, 'buildcostmetal', 0)) < 0 then return true end
    if number(u, 'energycost', number(u, 'buildcostenergy', 0)) < 0 then return true end
    if number(u, 'buildtime', 100) <= 0 then return true end
    local speed = number(u, 'speed', math.abs(number(u, 'maxvelocity', 0) * 30))
    if speed < 0 then return true end
    if number(u, 'rspeed', math.abs(number(u, 'maxreversevelocity', 0) * 30)) < 0 then
      return true
    end
    local acceleration = number(u, 'maxacc', number(u, 'acceleration', 0.5))
    if acceleration < 0 then return true end
    if number(u, 'maxdec', number(u, 'brakerate', acceleration)) < 0 then return true end
    -- UnitDef::RequireMoveDef (rts/Sim/Units/UnitDef.h): a unit that moves
    -- over ground or water needs a movement class the game defines.
    if boolean(u, 'canmove', false) and speed > 0 and not boolean(u, 'canfly', false) then
      if not classes[string.lower(text(u, 'movementclass', ''))] then return true end
    end
    return false
  end

  -- LuaTable::GetKeys takes string keys only and sorts them.
  local keyed = lowered(units)
  local names = {}
  for k in pairs(keyed) do
    if type(k) == 'string' then names[#names + 1] = k end
  end
  table.sort(names)

  local kept, order = {}, {}
  for _, k in ipairs(names) do
    if not refused(keyed[k]) then
      kept[k] = keyed[k]
      order[#order + 1] = k
    end
  end
  return kept, order
end
