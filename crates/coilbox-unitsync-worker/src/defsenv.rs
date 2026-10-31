//! The game environment a def script expects under unitsync, shared with the
//! plugins that run def scripts through the worker's `--lua` mode.

/// The game environment a def script expects, prepended to any script that runs
/// `gamedata/defs.lua` through unitsync's parser.
///
/// unitsync's parser is the engine's own `LuaParser` compiled with `UNITSYNC`
/// defined, and that switch takes four things away from it. Reading
/// `rts/Lua/LuaParser.cpp` (`SetupEnv`) and `rts/Game/Game.cpp` (`CGame::LoadDefs`)
/// gives the whole list, so this is a closed gap rather than an open-ended one:
///
///  1. the `Game` constants table, behind `#if !defined(UNITSYNC)` and only ever
///     built for the engine's own defs parser.
///  2. the `VFS` mode constants (`VFS.MOD` and friends), behind the same switch.
///  3. sixteen `Spring` team, player and option queries the engine adds to its
///     defs parser by hand, none of which unitsync installs.
///  4. `math.random`, which unitsync's parser replaces with `DummyRandom`, a
///     function that returns no value. `lua/defs-env/math_random.lua` is the
///     stand-in, appended to this text, so the game's own unit list and the list
///     read for a replay's match draw the same number (#4929).
///
/// A def script that touches any of them raises, and the whole game then reads as
/// having no units. Supplying a *partial* `Game` is worse than supplying none:
/// Beyond All Reason's `common/springUtilities/color.lua` opens with
/// `if not Game then return end`, so a half-filled table walks it straight past
/// its own guard and into `Game.textColorCodes`. Supplying none is not an option
/// either, because Splinter Faction's `gamedata/alldefs_post.lua` indexes `Game`
/// without checking. The environment has to be whole.
///
/// Every value here is either an engine constant read out of the engine source or
/// the honest answer for "no game is set up and no map is loaded": no teams, no
/// players, no modoptions. `textColorCodes` is not guessed at all. The engine
/// installs codes on the `Engine` table even under unitsync, so that is where they
/// come from.
///
/// Those codes are not the ones a running game uses. `rts/Lua/LuaConstEngine.cpp`
/// picks the new indicators whenever `HEADLESS` is defined, and unitsync is built
/// with it, so `Engine.textColorCodes.Color` is `\017` here and `\255` in a game
/// left on the default `TextDisableOldColorIndicators`. The unit list is unharmed,
/// but a def script that bakes a colour code into a name at parse time bakes in
/// the wrong one, and showing that raw prints a control character (issue #1664).
///
/// The shim also wraps `Spring.Log` to keep the lines a def script logs at error
/// level (#4928), which `lua/defs-env/log_errors.lua` explains. That is not a gap
/// in unitsync's parser. It is how a unit list read learns that a definition
/// file failed: Beyond All Reason logs the failure and carries on without the
/// file's units, and unitsync's own error list never sees it. The read sends
/// `__cb_logged_errors()` back beside its result.
///
/// Each shim is applied only where the engine left a hole, so a future engine
/// build that fills one in wins over the stand-in. `Spring.TimeCheck` is the
/// exception and is always replaced: builds up to 2026.06 compile it to a no-op
/// under `UNITSYNC` that never runs its callback, which loads no defs at all.
pub const DEFS_ENV_SHIM: &str = concat!(
    r#"
if type(Spring) == 'table' then
  Spring.TimeCheck = function(_, fn, ...)
    if type(fn) == 'function' then return fn(...) end
  end
  local nothing = function() return nil end
  local empty = function() return {} end
  local no = function() return false end
  local no_game_setup = {
    GetModOptions = empty, GetModOption = nothing,
    GetMapOptions = empty, GetMapOption = nothing,
    GetTeamList = empty, GetPlayerList = empty, GetAllyTeamList = empty,
    GetGaiaTeamID = function() return -1 end,
    GetTeamInfo = nothing, GetAllyTeamInfo = nothing, GetAIInfo = nothing,
    GetTeamAllyTeamID = nothing, GetTeamLuaAI = nothing, GetSideData = nothing,
    AreTeamsAllied = no, ArePlayersAllied = no,
  }
  for name, fn in pairs(no_game_setup) do
    if type(Spring[name]) ~= 'function' then Spring[name] = fn end
  end
end

-- The VFS mode letters, verbatim from rts/System/FileSystem/VFSModes.h. Def
-- scripts concatenate them to pick which archives an include may read from.
if type(VFS) == 'table' then
  local modes = {
    RAW = 'r', MOD = 'M', GAME = 'M', MAP = 'm', BASE = 'b', MENU = 'e',
    ZIP = 'Mmeb', RAW_FIRST = 'rMmeb', ZIP_FIRST = 'Mmebr',
    RAW_ONLY = 'r', ZIP_ONLY = 'Mmeb',
  }
  for name, mode in pairs(modes) do
    if VFS[name] == nil then VFS[name] = mode end
  end
end

-- The map-independent half of the engine's Game table, from
-- rts/Sim/Misc/GlobalConstants.h and rts/Lua/LuaConstGame.cpp. The map fields
-- have no answer here and the engine omits them too when no map is loaded, so
-- they stay nil. mapName is the exception: def scripts read it to pick per-map
-- config and assume it is always there. An empty name is the honest "no map" and
-- matches none, so a script falls through to its map-independent defaults
-- instead of loading some other map's overrides.
if type(Game) ~= 'table' then
  Game = {
    maxTeams = 255, maxPlayers = 251, gameSpeed = 30, squareSize = 8,
    metalMapSquareSize = 16, buildSquareSize = 16, buildGridResolution = 2,
    footprintScale = 2, mapName = '',
    speedModClasses = { Tank = 0, KBot = 1, Hover = 2, Boat = 3, Ship = 3 },
    scriptNotifyTypes = { HitNothing = 0, HitGround = 1, HitLimit = 2 },
    textColorCodes = (type(Engine) == 'table') and Engine.textColorCodes or nil,
  }
end
"#,
    include_str!("../../../lua/defs-env/math_random.lua"),
    include_str!("../../../lua/defs-env/log_errors.lua")
);
