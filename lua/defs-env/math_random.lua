-- math.random under unitsync (#4926, #4929). LuaParser compiles Random out under
-- UNITSYNC and installs DummyRandom, which returns no value
-- (rts/Lua/LuaParser.cpp). A definition script that indexes with the draw then
-- reads nil, and Beyond All Reason's lootboxnano script indexes what that gave
-- (unitbasedefs/lootboxes/lootboxnano.lua). The game's loader logs the error
-- and drops all 36 definitions, which moves every id after them.
--
-- This is the one copy. The worker puts it at the end of DEFS_ENV_SHIM
-- (crates/coilbox-unitsync-worker/src/defsenv.rs), which every definitions read
-- runs, so the game's own unit list and the list read for a replay's match give
-- the same answers. It is not a file of its own to the engine.
--
-- The engine seeds the draw from the match. That script uses it for a build
-- list and a model, never for a name, a cost or anything the refusal rules
-- read, so a fixed answer gives the same ids. The answer is the bottom of the
-- range asked for: 0 for no range, 1 for random(m), m for random(m, n). The
-- argument checks are LuaParser::Random's, so a call the engine refuses is
-- refused here too. It stands aside if the engine's own answers.
if type(math) == 'table' and (type(math.random) ~= 'function' or math.random(1) == nil) then
  -- lua_toint of an argument lua_isnumber accepts, or nil.
  local function whole(v)
    local n = tonumber(v)
    if n == nil then return nil end
    if n >= 0 then return math.floor(n) end
    return math.ceil(n)
  end

  math.random = function(...)
    local count = select('#', ...)
    local a, b = ...
    if count == 0 then return 0 end
    if count == 1 and whole(a) then
      local upper = whole(a)
      if upper < 1 then
        error(string.format('error: too small upper limit (%d) given to math.random(), should be >= 1 {LuaParser}', upper), 2)
      end
      return 1
    end
    if count == 2 and whole(a) and whole(b) then
      local lower, upper = whole(a), whole(b)
      if lower > upper then error('Empty interval in math.random() {LuaParser}', 2) end
      return lower
    end
    error('Incorrect arguments to math.random() {LuaParser}', 2)
  end
end
