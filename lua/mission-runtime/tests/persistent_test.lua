-- Proves a campaign's persistent vars (issue #5294): a var marked persistent
-- starts from the value coilbox hands in through coilbox_campaign_vars, a var
-- not marked never does, and the unsynced half writes what the persistent ones
-- end at, with the launch's token, only in a campaign launch and never during a
-- replay. Run it with:
--
--   luajit lua/mission-runtime/tests/persistent_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

local PREFIX = "coilbox_mission_var_"
local FILE = "coilbox-campaign-vars.json"
local VARS = dofile(support.root() .. "/luarules/mission_runtime/coilbox_vars.lua")

--------------------------------------------------------------------------------
-- The modoption's format, read on its own.
--------------------------------------------------------------------------------

local decoded, dropped = VARS.decode("rescued%20Pilots=3,bridge%2Cdown=1,broken,neg=-2.5")
check("a percent-encoded name is read back", decoded["rescued Pilots"] == 3)
check("an encoded comma is part of the name, not a separator", decoded["bridge,down"] == 1)
check("a negative fraction is read", decoded.neg == -2.5)
check("a pair that is not a name and a number is dropped", dropped[1] == "broken" and #dropped == 1)
check("no modoption is no values", next((VARS.decode(nil))) == nil)

check("the file names the run and each var, sorted",
	VARS.encodeFile("tok", { b = 2, a = 1.5 }) == '{"run":"tok","vars":{"a":1.5,"b":2}}\n',
	VARS.encodeFile("tok", { b = 2, a = 1.5 }))
check("a name is written as a JSON string",
	VARS.encodeFile("t", { ['say "hi"'] = 1 }) == '{"run":"t","vars":{"say \\"hi\\"":1}}\n',
	VARS.encodeFile("t", { ['say "hi"'] = 1 }))

--------------------------------------------------------------------------------
-- In: what a mission starts its vars at.
--------------------------------------------------------------------------------

local MISSION = compiled({
	runtimeVersion = 21,
	vars = { rescuedPilots = 0, wave = 0 },
	persistentVars = { "rescuedPilots" },
	triggers = {
		{
			id = "count",
			enabled = true,
			["repeat"] = false,
			conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
			actions = { { type = "add_var", params = { name = "rescuedPilots", value = 2 } } },
		},
	},
})

--- How many times the synced half told the unsynced one a persistent var changed.
local function told(engine)
	local count = 0
	for _, entry in ipairs(engine.sent) do
		if entry[1] == "coilbox_mission_vars" then
			count = count + 1
		end
	end
	return count
end

local function started(modOptions)
	local engine = load(modOptions, missionFiles(MISSION))
	engine.env:Initialize()
	return engine
end

local engine = started({
	coilbox_mission = "demo",
	coilbox_campaign_run = "run-1",
	coilbox_campaign_vars = "rescuedPilots=5,wave=9",
})
local vars = engine.GG.CoilboxMission.vars
check("a persistent var starts from the campaign's saved value", vars.get("rescuedPilots") == 5,
	tostring(vars.get("rescuedPilots")))
check("and the mirror says so", engine.rulesParams[PREFIX .. "rescuedPilots"] == 5)
check("a var not marked persistent never reads a saved value", vars.get("wave") == 0,
	tostring(vars.get("wave")))
check("nothing is told to the unsynced half while the vars are registered", told(engine) == 0)

engine.env:GameStart()
engine.env:GameFrame(1)
engine.env:GameFrame(15)
check("a trigger moves it on from the saved value", vars.get("rescuedPilots") == 7, tostring(vars.get("rescuedPilots")))
check("and the change is told to the unsynced half", told(engine) == 1)

vars.set("wave", 3)
check("a change to a var not marked persistent is not", told(engine) == 1)

local fresh = started({ coilbox_mission = "demo", coilbox_campaign_run = "run-2" })
check("with nothing saved, a persistent var starts from the scenario's value",
	fresh.GG.CoilboxMission.vars.get("rescuedPilots") == 0)

local solo = started({ coilbox_mission = "demo", coilbox_campaign_vars = "rescuedPilots=5" })
solo.env:GameStart()
solo.env:GameFrame(1)
solo.env:GameFrame(15)
check("outside a campaign, with no run token, no change is told to the unsynced half",
	told(solo) == 0)

local bad = started({ coilbox_mission = "demo", coilbox_campaign_run = "r", coilbox_campaign_vars = "rescuedPilots=lots" })
check("a saved value that is not a number is ignored", bad.GG.CoilboxMission.vars.get("rescuedPilots") == 0)
check("and said once", logged(bad, "ignoring a saved campaign var"))

--------------------------------------------------------------------------------
-- Out: the file the unsynced half writes.
--------------------------------------------------------------------------------

local function unsynced(modOptions, options)
	options = options or {}
	options.synced = false
	local half = load(modOptions, missionFiles(MISSION), options)
	half.rulesParams[PREFIX .. "rescuedPilots"] = 7
	half.rulesParams[PREFIX .. "wave"] = 3
	return half
end

local half = unsynced({ coilbox_mission = "demo", coilbox_campaign_run = "run-1" })
half.env:Initialize()
check("the unsynced half writes the persistent vars when it loads",
	half.written[FILE] == '{"run":"run-1","vars":{"rescuedPilots":7}}\n', tostring(half.written[FILE]))

half.rulesParams[PREFIX .. "rescuedPilots"] = 8
half.env:RecvFromSynced("coilbox_mission_vars")
check("and again when the synced half says one changed",
	half.written[FILE] == '{"run":"run-1","vars":{"rescuedPilots":8}}\n', tostring(half.written[FILE]))

local outside = unsynced({ coilbox_mission = "demo" })
outside.env:Initialize()
check("outside a campaign it writes nothing", next(outside.written) == nil)

local replay = unsynced({ coilbox_mission = "demo", coilbox_campaign_run = "run-1" }, { replay = true })
replay.env:Initialize()
check("watching a replay of a campaign mission writes nothing", next(replay.written) == nil)

local denied = unsynced({ coilbox_mission = "demo", coilbox_campaign_run = "run-1" }, { unwritable = true })
denied.env:Initialize()
denied.env:RecvFromSynced("coilbox_mission_vars")
check("a write directory it cannot write to is said", logged(denied, "could not write " .. FILE))

support.report()
