-- Proves where a mission points the player: that camera_pan and map_marker
-- resolve their position and hand it out, and that the unsynced half moves the
-- camera and puts the marker on the map. Run it with:
--
--   luajit lua/mission-runtime/tests/view_test.lua
--
-- The gadget is loaded under the stub engine rather than the module on its own,
-- because both halves are part of the claim: the synced one decides the mission
-- asked, and the unsynced one is what the player sees.
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged, sent = support.check, support.load, support.logged, support.sent
local missionFiles, compiled = support.missionFiles, support.compiled

-- The names the unsynced half depends on. Hard-coded rather than read off the
-- runtime, because each one is a contract.
local CAMERA_MESSAGE = "coilbox_mission_camera"
local MARKER_MESSAGE = "coilbox_mission_marker"

-- What the runtime falls back to when the author gives no pan time.
local DEFAULT_PAN_SECONDS = 1

--------------------------------------------------------------------------------
-- Scaffolding.
--------------------------------------------------------------------------------

--- A fire-once trigger that runs `actions` on the first polled tick.
local function once(id, actions)
	return {
		id = id,
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "time_elapsed", params = { seconds = 0 } } } },
		actions = actions,
	}
end

local function pan(params)
	return { type = "camera_pan", params = params }
end

local function mark(params)
	return { type = "map_marker", params = params }
end

-- The participants a mission that names a team can name.
local TEAMS = {
	player = { team = 0 },
	ally = { team = 1 },
}

local function playing(overrides, options)
	overrides.teams = overrides.teams or TEAMS
	local mission = compiled(overrides)
	local engine = load({ coilbox_mission = "demo" }, missionFiles(mission), options)
	engine.env:Initialize()
	engine.env:GameStart()
	engine.env:GameFrame(1)
	engine.env:GameFrame(15)
	return engine
end

--- The arguments one message carried, as text, so a failure says what was sent.
-- The team the action is for is left off: it has its own section below, and
-- every check up to there is about a mission that names none.
local function args(engine, message)
	local out = {}
	for _, entry in ipairs(engine.sent) do
		if entry[1] == message then
			out[#out + 1] = table.concat({ tostring(entry[2]), tostring(entry[3]), tostring(entry[4]) }, "/")
		end
	end
	return table.concat(out, ", ")
end

--- The team one message was aimed at.
local function audience(engine, message)
	for _, entry in ipairs(engine.sent) do
		if entry[1] == message then
			return entry[5]
		end
	end
end

--------------------------------------------------------------------------------
-- Panning the camera.
--------------------------------------------------------------------------------

local engine = playing({
	triggers = { once("look", { pan({ pos = { x = 300, z = 400 }, seconds = 2 }) }) },
})
check("a camera_pan hands out the place and the time it was given",
	args(engine, CAMERA_MESSAGE) == "300/400/2", args(engine, CAMERA_MESSAGE))

engine = playing({ triggers = { once("look", { pan({ pos = { x = 10, z = 20 } }) }) } })
check("one with no time takes a whole second, which the player can follow",
	args(engine, CAMERA_MESSAGE) == "10/20/" .. DEFAULT_PAN_SECONDS, args(engine, CAMERA_MESSAGE))

engine = playing({ triggers = { once("look", { pan({ pos = { x = 10, z = 20 }, seconds = -5 }) }) } })
check("a negative time is no time at all, which is a cut rather than a pan",
	args(engine, CAMERA_MESSAGE) == "10/20/0", args(engine, CAMERA_MESSAGE))

engine = playing({ triggers = { once("look", { pan({ seconds = 2 }) }) } })
check("a camera_pan with nowhere to pan to pans nowhere", #sent(engine, CAMERA_MESSAGE) == 0)
check("and is reported", logged(engine, "camera_pan was given no position on the map"))

engine = playing({ triggers = { once("look", { pan({ pos = { x = 10 } }) }) } })
check("so does one with half a position", #sent(engine, CAMERA_MESSAGE) == 0)

--------------------------------------------------------------------------------
-- Marking the map.
--------------------------------------------------------------------------------

engine = playing({
	triggers = { once("here", { mark({ pos = { x = 50, z = 60 }, text = "Ambush!" }) }) },
})
check("a map_marker hands out the place and the label",
	args(engine, MARKER_MESSAGE) == "50/60/Ambush!", args(engine, MARKER_MESSAGE))

engine = playing({ triggers = { once("here", { mark({ pos = { x = 50, z = 60 } }) }) } })
check("one with no label is the plain dot a player gets from a click",
	args(engine, MARKER_MESSAGE) == "50/60/", args(engine, MARKER_MESSAGE))

engine = playing({ triggers = { once("here", { mark({ text = "Ambush!" }) }) } })
check("a map_marker with nowhere to mark marks nothing", #sent(engine, MARKER_MESSAGE) == 0)
check("and is reported", logged(engine, "map_marker was given no position on the map"))

--------------------------------------------------------------------------------
-- Order, because a trigger that pans and then marks is an author staging a
-- moment.
--------------------------------------------------------------------------------

engine = playing({
	triggers = {
		once("staged", {
			pan({ pos = { x = 1, z = 1 } }),
			mark({ pos = { x = 1, z = 1 }, text = "Here" }),
			pan({ pos = { x = 2, z = 2 } }),
		}),
	},
})
local order = {}
for _, entry in ipairs(engine.sent) do
	if entry[1] == CAMERA_MESSAGE or entry[1] == MARKER_MESSAGE then
		order[#order + 1] = entry[1]
	end
end
check("they run in the order the trigger lists them",
	table.concat(order, ",") == CAMERA_MESSAGE .. "," .. MARKER_MESSAGE .. "," .. CAMERA_MESSAGE,
	table.concat(order, ","))

--------------------------------------------------------------------------------
-- Whose screen it is (issue #827). The synced half resolves the participant the
-- action names into an engine team and sends it along; every client's unsynced
-- half decides whether that is them.
--------------------------------------------------------------------------------

local VIEW = dofile(support.root() .. "/luarules/mission_runtime/coilbox_view.lua")

engine = playing({ triggers = { once("look", { pan({ pos = { x = 1, z = 1 } }) }) } })
check("an action naming no team is for everyone",
	audience(engine, CAMERA_MESSAGE) == VIEW.EVERYONE, tostring(audience(engine, CAMERA_MESSAGE)))

engine = playing({
	triggers = {
		once("look", {
			pan({ pos = { x = 1, z = 1 }, team = "ally" }),
			mark({ pos = { x = 1, z = 1 }, text = "Here", team = "ally" }),
		}),
	},
})
check("one naming a participant carries that participant's engine team",
	audience(engine, CAMERA_MESSAGE) == 1, tostring(audience(engine, CAMERA_MESSAGE)))
check("and a marker carries it the same way",
	audience(engine, MARKER_MESSAGE) == 1, tostring(audience(engine, MARKER_MESSAGE)))

engine = playing({
	triggers = { once("look", { pan({ pos = { x = 1, z = 1 }, team = "nobody" }) }) },
})
check("one naming a participant the mission has no team for still happens",
	audience(engine, CAMERA_MESSAGE) == VIEW.EVERYONE, tostring(audience(engine, CAMERA_MESSAGE)))
check("and says so, because a camera move that never happens looks like a dead trigger",
	logged(engine, "no team named nobody in this mission, doing camera_pan for everyone"))

check("every client acts on an action for everyone",
	VIEW.isFor(VIEW.EVERYONE, 0) and VIEW.isFor(VIEW.EVERYONE, 7))
check("only the client on that team acts on one aimed at a team",
	VIEW.isFor(1, 1) and not VIEW.isFor(1, 0))
check("and a message from a runtime that sent no team at all reaches everyone",
	VIEW.isFor(nil, 3))

--------------------------------------------------------------------------------
-- The published handle, which is how a game's own actions point the player.
--------------------------------------------------------------------------------

engine = playing({})
local view = engine.GG.CoilboxMission.view

check("panning through the handle pans", view.pan(7, 8, 3) == true)
check("and it went out", args(engine, CAMERA_MESSAGE) == "7/8/3", args(engine, CAMERA_MESSAGE))
check("for everyone, because the handle names no team",
	audience(engine, CAMERA_MESSAGE) == VIEW.EVERYONE, tostring(audience(engine, CAMERA_MESSAGE)))
check("marking through the handle marks", view.mark(7, 8, "There") == true)
check("and it went out", args(engine, MARKER_MESSAGE) == "7/8/There", args(engine, MARKER_MESSAGE))
check("a game's own action can aim one at a team", view.mark(7, 8, "There", 1) == true)
check("and it goes out for that team",
	engine.sent[#engine.sent][5] == 1, tostring(engine.sent[#engine.sent][5]))
check("panning nowhere pans nothing", view.pan(nil, 8, 3) == false)
check("marking nowhere marks nothing", view.mark(7, nil, "There") == false)

--------------------------------------------------------------------------------
-- The unsynced half, which is what the player actually sees.
--------------------------------------------------------------------------------

local unsynced = load({ coilbox_mission = "demo" }, missionFiles(compiled({ teams = TEAMS })), {
	synced = false,
	-- This client is playing team 0, so an action for team 1 is somebody else's.
	myTeam = 0,
	-- A map with a hill, so the height is proved to be read at the place named
	-- rather than assumed flat.
	ground = function(x)
		return x * 2
	end,
})
unsynced.env:Initialize()

check("the unsynced half holds no view of its own", unsynced.GG.CoilboxMission.view == nil)

unsynced.env:RecvFromSynced(CAMERA_MESSAGE, 300, 400, 2)
local camera = unsynced.camera[1]
check("a camera message moves the camera", #unsynced.camera == 1)
check("to the place it named, at the height of the ground there",
	camera and camera[1] == 300 and camera[2] == 600 and camera[3] == 400,
	camera and table.concat(camera, "/"))
check("over the time it named", camera and camera[4] == 2)

unsynced.env:RecvFromSynced(MARKER_MESSAGE, 50, 60, "Ambush!")
local marker = unsynced.markers[1]
check("a marker message puts a marker on the map", #unsynced.markers == 1)
check("at the place it named, on the ground",
	marker and marker[1] == 50 and marker[2] == 100 and marker[3] == 60,
	marker and table.concat({ marker[1], marker[2], marker[3] }, "/"))
check("with the label it named", marker and marker[4] == "Ambush!")
check("and locally, because every client runs this half and a broadcast would "
	.. "land one marker per player", marker and marker[5] == true)

check("a message that is not ours is left alone",
	unsynced.env:RecvFromSynced("someone_elses_message", 1, 2, 3) == nil)
check("and moved nothing", #unsynced.camera == 1 and #unsynced.markers == 1)

-- Issue #827. This client is on team 0, so an action for team 1 is not its
-- business, and one for everyone or for team 0 is.
unsynced.env:RecvFromSynced(CAMERA_MESSAGE, 700, 800, 1, 1)
unsynced.env:RecvFromSynced(MARKER_MESSAGE, 700, 800, "Theirs", 1)
check("a camera message for another team moves nothing here", #unsynced.camera == 1)
check("and a marker for another team lands nowhere here", #unsynced.markers == 1)

unsynced.env:RecvFromSynced(CAMERA_MESSAGE, 700, 800, 1, 0)
unsynced.env:RecvFromSynced(MARKER_MESSAGE, 700, 800, "Mine", 0)
check("one for this client's own team is carried out", #unsynced.camera == 2)
check("and so is its marker", #unsynced.markers == 2 and unsynced.markers[2][4] == "Mine")

unsynced.env:RecvFromSynced(CAMERA_MESSAGE, 900, 900, 1, -1)
check("and one for everyone is carried out here too", #unsynced.camera == 3)

support.report()
