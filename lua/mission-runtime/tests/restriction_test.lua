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
-- anchors a human's team with. The builder builds all three, in that order, so a
-- test can say which icon moved and which did not.
local DEFS = {
	{ name = "marker", speed = 0, weapons = {} },
	{ name = "grunt" },
	{ name = "nuke", speed = 0 },
	{ name = "builder", builds = { "marker", "grunt", "nuke" } },
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
-- The build menu. AllowUnitCreation is what holds; this is the sign in front of
-- it, so a player is told before they click rather than after the builder has
-- walked to the site.
--------------------------------------------------------------------------------

--- What a unit's build menu looks like: one entry per build command, in the
-- engine's own order, as `defName` or `defName!` for a greyed one.
local function menu(engine, unitID)
	local entries = {}
	for _, desc in ipairs(engine.env.Spring.GetUnitCmdDescs(unitID)) do
		if desc.id < 0 then
			entries[#entries + 1] =
				engine.env.UnitDefs[-desc.id].name .. (desc.disabled and "!" or "")
		end
	end
	return table.concat(entries, ",")
end

--- Put a builder on the map for a team, the way the engine does.
local function builderFor(engine, team)
	return engine.spawn("builder", team)
end

engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
})

local builder = builderFor(engine, 0)
-- The whole menu in the engine's own order, so an icon taken out and put back at
-- the wrong place would read here as the wrong string rather than as the right
-- one somewhere else.
check("a builder a mission team gets is greyed out for what the mission denies",
	menu(engine, builder) == "marker,grunt,nuke!", menu(engine, builder))
check("and the command standing beside them is left alone",
	engine.cmdDescs[builder][1].disabled == false,
	tostring(engine.cmdDescs[builder][1].disabled))
check("a builder on a team the scenario never declared keeps its whole menu",
	menu(engine, builderFor(engine, OUTSIDER)) == "marker,grunt,nuke",
	menu(engine, builderFor(engine, OUTSIDER)))

local reads = engine.cmdDescReads
engine.spawn("grunt", 0)
check("and a unit that builds nothing is never asked for a menu at all",
	engine.cmdDescReads == reads, engine.cmdDescReads - reads)

-- Only what the mission greyed is ever ungreyed. A game with its own reason to
-- lock a build icon -- a tech tree, a supply limit -- has to still be holding it
-- after the mission has finished with the def beside it.
engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	triggers = { once("free", { unlocks({ unitDef = "nuke", team = "player" }) }) },
})
builder = builderFor(engine, 0)
local descs = engine.cmdDescs[builder]
for _, desc in ipairs(descs) do
	if desc.id == -defID(engine, "grunt") then
		desc.disabled = true
	end
end
check("the mission greys the def it denies and leaves the rest alone",
	menu(engine, builder) == "marker,grunt!,nuke!", menu(engine, builder))
engine.env:GameFrame(15)
check("unlock_unit ungreys the def it freed, on a builder already on the map",
	menu(engine, builder) == "marker,grunt!,nuke", menu(engine, builder))
check("and leaves the icon the game itself had greyed exactly as the game left it",
	menu(engine, builder) == "marker,grunt!,nuke", menu(engine, builder))

-- An allow list is the same question from the other end, so the menu is greyed
-- from the other end too.
engine = playing({
	restrictions = { buildable = { mode = "allow", units = { "grunt" } } },
})
check("under an allow list everything unlisted is greyed",
	menu(engine, builderFor(engine, 0)) == "marker!,grunt,nuke!",
	menu(engine, builderFor(engine, 0)))

-- A builder that changes hands answers to the team holding it.
engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
	teams = { player = { team = 0 }, enemy = { team = 1 } },
})
builder = builderFor(engine, 0)
engine.give(builder, OUTSIDER)
check("a builder given to a team the scenario never declared gets its menu back",
	menu(engine, builder) == "marker,grunt,nuke", menu(engine, builder))
engine.give(builder, 1)
check("and captured back onto a mission team is greyed again",
	menu(engine, builder) == "marker,grunt,nuke!", menu(engine, builder))

-- Painting the same unit twice writes nothing the second time, which is what
-- keeps a repaint per unlock from being a repaint per icon per unlock.
engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
})
builder = builderFor(engine, 0)
local edits = #engine.edits
check("greying a builder is one edit, for the one icon that changed", edits == 1, edits)
engine.GG.CoilboxMission.restrictions.paint(builder, defID(engine, "builder"), 0)
check("and painting it again writes nothing", #engine.edits == edits, #engine.edits)

-- And what a game's own build gating does to it. Splinter Faction's tech tree
-- rewrites `disabled` on every tech-gated icon whenever a team's tech changes,
-- deciding each from its tech alone, so it lifts the grey the mission put on a
-- def it forbids (issue #955). The runtime puts it back on its own cadence.
engine = playing({
	restrictions = { buildable = { mode = "deny", units = { "nuke" } } },
})
builder = builderFor(engine, 0)
check("the mission greys the def it denies", menu(engine, builder) == "marker,grunt,nuke!",
	menu(engine, builder))
for _, desc in ipairs(engine.cmdDescs[builder]) do
	if desc.id == -defID(engine, "nuke") then
		desc.disabled = false
	end
end
check("and something else in the game can paint straight over it",
	menu(engine, builder) == "marker,grunt,nuke", menu(engine, builder))
engine.env:GameFrame(15)
check("but the next repaint puts it back", menu(engine, builder) == "marker,grunt,nuke!",
	menu(engine, builder))

-- A mission that restricts nothing buildable never reads a command description.
engine = playing({ restrictions = { commands = { "selfd" } } })
builderFor(engine, 0)
check("a mission with no buildable restriction never even reads a build menu",
	#engine.edits == 0 and engine.cmdDescReads == 0,
	#engine.edits .. "/" .. engine.cmdDescReads)

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
