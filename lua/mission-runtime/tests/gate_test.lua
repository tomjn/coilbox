-- Proves the modoption gate: what the runtime gadget does before it is a
-- mission runtime at all. Run it with:
--
--   luajit lua/mission-runtime/tests/gate_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- A normal game: no modoption, so the gadget drops itself without reading a
-- single file.
local engine, result = load({})
check("no modoption drops the gadget", result == false)
check("no modoption reads nothing", engine.reads == 0, engine.reads .. " reads")
check("no modoption says nothing", #engine.logs == 0, table.concat(engine.logs, " / "))

engine, result = load({ coilbox_mission = "  " })
check("blank modoption drops the gadget", result == false)
check("blank modoption reads nothing", engine.reads == 0)

engine, result = load({ coilbox_mission = "../../evil" }, missionFiles(compiled()))
check("a path is not a mission id", result == false)
check("a path is reported", logged(engine, "not a mission id"))

local files = missionFiles(compiled())
files["missions/demo/mission.lua"] = nil
engine, result = load({ coilbox_mission = "demo" }, files)
check("a missing mission drops the gadget", result == false)
check("a missing mission is reported", logged(engine, "missions/demo/mission.lua is missing"))

files = missionFiles(compiled())
files["luarules/mission_runtime/coilbox_start.lua"] = nil
engine, result = load({ coilbox_mission = "demo" }, files)
check("a missing runtime module drops the gadget", result == false)
check("a missing runtime module is reported", logged(engine, "coilbox_start.lua is missing"))

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled({ runtimeVersion = 99 })))
check("a mission from the future is refused", result == false)
check("a mission from the future is reported", logged(engine, "needs runtimeVersion 99"))

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled()))
check("a mission keeps the gadget", result ~= false, tostring(result))
check("a mission defines GetInfo", type(engine.env.GetInfo) == "function")
engine.env:Initialize()
check("a mission reaches the rest of the runtime", engine.GG.CoilboxMission ~= nil)
check("the mission id is the modoption", (engine.GG.CoilboxMission or {}).id == "demo")
check("the runtime version is the marker file", (engine.GG.CoilboxMission or {}).runtime.version == 1)

engine, result = load({ coilbox_mission = "demo" }, missionFiles(compiled({ map = "Other Map" })))
check("the wrong map still runs", result ~= false)
check("the wrong map is reported", logged(engine, "built for map Other Map"))

support.report()
