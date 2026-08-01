-- Proves what a scenario's restrictions do: which teams may build which defs,
-- which commands are withheld from whom, and what unlock_unit lifts. The gadget
-- is loaded under the stub engine because the two callins doing the enforcing are
-- the gadget's. Run it with:
--
--   luajit lua/mission-runtime/tests/restriction_test.lua
--
-- This directory is not part of the runtime a game vendors. Only luarules/,
-- luaui/ and missions/ are installed into a game.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, load, logged = support.check, support.load, support.logged
local missionFiles, compiled = support.missionFiles, support.compiled

-- The two participants every mission here has, and the human playing the first.
local TEAMS = { player = { team = 0 }, enemy = { team = 1 } }
local PLAYERS = { [0] = { team = 0 } }

-- A game whose first def does nothing at all, because that is what the runtime
-- anchors a human's team with.
local DEFS = {
	{ name = "marker", speed = 0, weapons = {} },
	{ name = "grunt" },
	{ name = "nuke", speed = 0 },
}

-- A team no participant in these missions is on.
local OUTSIDER = 2

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

local function unlocks(params)
	return { type = "unlock_unit", params = params }
end

--- Start a mission and run to the first playable frame.
local function playing(overrides, options)
	overrides.teams = overrides.teams or TEAMS
	options = options or {}
	options.players = options.players == nil and PLAYERS or options.players
	options.defList = options.defList == nil and DEFS or options.defList

	local engine = load({ coilbox_mission = "demo" }, missionFiles(compiled(overrides)), options)
	engine.env:Initialize()
	engine.env:GameStart()
	engine.env:GameFrame(1)
	return engine
end

local function defID(engine, name)
	local def = engine.env.UnitDefNames[name]
	return def and def.id
end

--- Ask the gadget whether a team may build a def, the way the engine asks: the
-- builder's team, because that is the team the unit would land on.
local function mayBuild(engine, name, team)
	if not engine.env.AllowUnitCreation then
		return nil
	end
	return engine.env:AllowUnitCreation(defID(engine, name), 1, team, 0, 0, 0, 0)
end

--- And whether it may be given a command. `fromLua` is the last argument the
-- engine passes, and it is how synced Lua's own orders are told from a player's.
local function mayCommand(engine, cmdID, team, fromLua)
	if not engine.env.AllowCommand then
		return nil
	end
	return engine.env:AllowCommand(1, 1, team, cmdID, {}, {}, 0, 0, true, fromLua == true)
end

--------------------------------------------------------------------------------
-- A deny list: everything but these.
--------------------------------------------------------------------------------

local engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
})

local allowed, drop = mayBuild(engine, "nuke", 0)
check("a denied def is refused to a mission team", allowed == false, tostring(allowed))
check("and the order that asked for it is dropped, so nothing jams retrying", drop == true,
	tostring(drop))
check("a def the mission says nothing about is built", mayBuild(engine, "grunt", 0) == true)
check("the deny list binds every team the scenario declares, not just the player's",
	mayBuild(engine, "nuke", 1) == false)
check("a team the scenario never declared is not the mission's to restrict",
	mayBuild(engine, "nuke", OUTSIDER) == true)
check("a mission that restricts no command does not watch commands",
	engine.env.AllowCommand == nil)

--------------------------------------------------------------------------------
-- An allow list: only these.
--------------------------------------------------------------------------------

engine = playing({
	restrictions = { buildable = { mode = "allow", units = { "grunt" } } },
})

check("a listed def is built under an allow list", mayBuild(engine, "grunt", 0) == true)
check("and everything else is refused", mayBuild(engine, "nuke", 0) == false)

--------------------------------------------------------------------------------
-- A def the game does not have. A scenario built against another version of the
-- game is the likely cause, and a restriction nothing can match is worth saying
-- out loud rather than enforcing silently.
--------------------------------------------------------------------------------

engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "phantom" } } },
})

check("a restricted def this game has no def for is reported",
	logged(engine, "the mission restricts phantom, which this game has no unit def for"))
check("and nothing else is refused because of it", mayBuild(engine, "grunt", 0) == true)

--------------------------------------------------------------------------------
-- unlock_unit: the other end of the same mechanism.
--------------------------------------------------------------------------------

engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	triggers = { once("free", { unlocks({ unitDef = "nuke", team = "enemy" }) }) },
})

check("the def is refused before the trigger runs", mayBuild(engine, "nuke", 1) == false)
engine.env:GameFrame(15)
check("unlock_unit lifts the restriction for the participant it names",
	mayBuild(engine, "nuke", 1) == true)
check("and for nobody else", mayBuild(engine, "nuke", 0) == false)

-- An unlock that names no participant means the team a human is playing, the
-- same team a victory that names none is about.
engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	triggers = { once("free", { unlocks({ unitDef = "nuke" }) }) },
})
engine.env:GameFrame(15)
check("an unlock naming no participant frees the team a human is playing",
	mayBuild(engine, "nuke", 0) == true)
check("and leaves the rest of them where they were", mayBuild(engine, "nuke", 1) == false)

-- Under an allow list the same action adds the def rather than taking it off a
-- list, which is why both modes go through one unlock.
engine = playing({
	restrictions = { buildable = { mode = "allow", units = { "grunt" } } },
	triggers = { once("free", { unlocks({ unitDef = "nuke", team = "player" }) }) },
})
engine.env:GameFrame(15)
check("unlock_unit adds a def to an allow list too", mayBuild(engine, "nuke", 0) == true)
check("without adding it for anyone else", mayBuild(engine, "nuke", 1) == false)

--------------------------------------------------------------------------------
-- Unlocks that do nothing, each said out loud once.
--------------------------------------------------------------------------------

engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	triggers = {
		once("free", {
			unlocks({ unitDef = "grunt", team = "player" }),
			unlocks({ unitDef = "marker", team = "player" }),
			unlocks({ unitDef = "phantom", team = "player" }),
			unlocks({ unitDef = "nuke", team = "nobody" }),
		}),
	},
})
engine.env:GameFrame(15)

check("unlocking a def nothing was restricting says so",
	logged(engine, "nothing restricts grunt for player, so unlock_unit does nothing"))
check("and so does the next one, rather than the first report standing for both",
	logged(engine, "nothing restricts marker for player, so unlock_unit does nothing"))
check("unlocking a def this game does not have says so",
	logged(engine, "unlock_unit names phantom, which this game has no unit def for"))
check("unlocking for a participant the mission does not have says so",
	logged(engine, "no team named nobody in this mission, ignoring unlock_unit"))
check("and none of the three changed what anyone may build",
	mayBuild(engine, "nuke", 0) == false and mayBuild(engine, "grunt", 0) == true)

--------------------------------------------------------------------------------
-- The handle a game's own actions drive, which answers what it did.
--------------------------------------------------------------------------------

engine = playing({ restrictions = { buildable = { mode = "deny", units = { "nuke" } } } })
local handle = engine.GG.CoilboxMission.restrictions

check("an unlock through the handle says it lifted something", handle.unlock("nuke", "enemy") == true)
check("and the team may build the def afterwards", mayBuild(engine, "nuke", 1) == true)
check("an unlock that lifted nothing says so", handle.unlock("grunt", "enemy") == false)
check("as does one for a participant the mission does not have",
	handle.unlock("nuke", "nobody") == false)
check("and one for a def this game does not have", handle.unlock("phantom", "enemy") == false)

--------------------------------------------------------------------------------
-- Withheld commands.
--------------------------------------------------------------------------------

engine = playing({ restrictions = { commands = { "selfd" } } })
local CMD = engine.env.CMD

check("a withheld command is refused to a mission team",
	mayCommand(engine, CMD.SELFD, 0) == false)
check("every other command is let through", mayCommand(engine, CMD.MOVE, 0) == true)
check("a team the scenario never declared keeps the command",
	mayCommand(engine, CMD.SELFD, OUTSIDER) == true)
check("and a command synced Lua gave is the mission's own, so it stands",
	mayCommand(engine, CMD.SELFD, 0, true) == true)
check("a mission that restricts nothing buildable does not watch creation",
	engine.env.AllowUnitCreation == nil)

engine = playing({ restrictions = { commands = { "selfd", "levitate" } } })
check("a name that is not an engine command is reported",
	logged(engine, "the mission withholds levitate, which is not an engine command"))
check("and the commands beside it still are withheld",
	mayCommand(engine, CMD.SELFD, 0) == false)

--------------------------------------------------------------------------------
-- A mission that restricts nothing.
--------------------------------------------------------------------------------

engine = playing({})
check("neither callin exists, so a mission with no restrictions costs the game nothing",
	engine.env.AllowUnitCreation == nil and engine.env.AllowCommand == nil)
check("and the handle is published all the same, for a game's own actions",
	engine.GG.CoilboxMission.restrictions ~= nil)

support.report()
