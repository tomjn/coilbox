-- Proves what the compat prelude does in front of an old game's Lua: it
-- defines what the engine removed, leaves alone what the engine still has, and
-- hands an old game's handler the call-in arguments it was written for. Run it
-- with:
--
--   luajit lua/compat/tests/prelude_test.lua
--
-- It loads the preludes coilbox-compat builds for manifests 9, 11 and 12, kept in
-- tests/fixtures/. After changing a fix or how a prelude is built, write them
-- again with:
--
--   COILBOX_WRITE_FIXTURE=1 cargo test -p coilbox-compat

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, newEngine, prelude, call, handler =
	support.check, support.newEngine, support.prelude, support.call, support.handler

--------------------------------------------------------------------------------
-- The stand-in states lack what the engine removes (issue #4685)
--------------------------------------------------------------------------------

do
	local synced, unsynced = newEngine().env, newEngine({ synced = false }).env
	for _, name in ipairs({ "rawget", "rawset", "rawequal", "newproxy", "gcinfo", "collectgarbage" }) do
		check("synced: " .. name .. " is removed", synced[name] == nil)
	end
	check("synced: getmetatable and setmetatable stay", synced.getmetatable ~= nil and synced.setmetatable ~= nil)
	check("unsynced: rawget and rawset stay", unsynced.rawget ~= nil and unsynced.rawset ~= nil)
	check("a global table has no metatable, as in the engine", getmetatable(synced) == nil)
end

--------------------------------------------------------------------------------
-- Defining what is missing, and only that
--------------------------------------------------------------------------------

do
	local engine = newEngine({ synced = false })
	prelude(engine)
	local Spring, gl = engine.env.Spring, engine.env.gl
	check("unsynced: gl.Smoothing is defined and does nothing", type(gl.Smoothing) == "function" and select("#", gl.Smoothing(true, true, false)) == 0)
	check("unsynced: Spring.MakeFont is defined and returns nil", type(Spring.MakeFont) == "function" and Spring.MakeFont("fonts/a.ttf", { height = 12 }) == nil)
	check("unsynced: Spring.UpdateInfoTexture returns false", Spring.UpdateInfoTexture(1) == false)
	check("unsynced: Spring.SetSunParameters is defined", type(Spring.SetSunParameters) == "function" and select("#", Spring.SetSunParameters(0, 1, 0, 1, 0, 100)) == 0)
	check("unsynced: Spring.SetSunManualControl is defined", type(Spring.SetSunManualControl) == "function")
	check("unsynced: the synced functions are not defined", Spring.SetUnitToFeature == nil and Spring.GetUnitTravel == nil)
	check("unsynced: no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	local ownSmoothing = function() return "own" end
	local ownFont = function() return "font" end
	local engine = newEngine({ synced = false, gl = { Smoothing = ownSmoothing }, spring = { MakeFont = ownFont } })
	prelude(engine)
	check("an existing gl.Smoothing is left alone", engine.env.gl.Smoothing == ownSmoothing)
	check("an existing Spring.MakeFont is left alone", engine.env.Spring.MakeFont == ownFont)
end

do
	local engine = newEngine()
	prelude(engine)
	check("synced: Spring.SetUnitToFeature is defined", type(engine.env.Spring.SetUnitToFeature) == "function")
	check("synced: the unsynced functions are not defined", engine.env.Spring.MakeFont == nil and engine.env.gl == nil)
	check("synced: no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	local own = function() end
	local engine = newEngine({ spring = { SetUnitToFeature = own } })
	prelude(engine)
	check("an existing Spring.SetUnitToFeature is left alone", engine.env.Spring.SetUnitToFeature == own)
end

do
	-- A fix that raises is logged, and the fixes after it still load.
	local engine = newEngine({
		springMeta = {
			__index = function(_, name)
				if name == "SetUnitToFeature" then
					error("boom")
				end
			end,
		},
	})
	prelude(engine)
	local logged = table.concat(engine.logs, "; ")
	check("a fix that fails is logged by name", logged:find("spring-set-unit-to-feature failed", 1, true) ~= nil, logged)
	check("only that fix is logged", #engine.logs == 1, logged)
	local fromSynced
	handler(engine, {
		AllowCommand = function(_, _, _, _, _, _, _, synced)
			fromSynced = synced
			return true
		end,
	})
	call(engine, "AllowCommand", 1, 2, 0, 10, {}, {}, 5, 3, false, false)
	check("the fixes after it still load", fromSynced == false, tostring(fromSynced))
end

--------------------------------------------------------------------------------
-- Unit travel
--------------------------------------------------------------------------------

do
	local engine = newEngine()
	local stub = engine.env.Spring.GetUnitTravel
	prelude(engine)
	local Spring = engine.env.Spring
	check("the engine's travel stub is replaced", Spring.GetUnitTravel ~= stub)

	engine.units[7] = { speed = 3 }
	local travel, period = Spring.GetUnitTravel(7)
	check("a unit never set has travel 0 and period 0", travel == 0 and period == 0)
	check("a unit that does not exist has no travel", select("#", Spring.GetUnitTravel(99)) == 0)

	Spring.SetUnitTravel(7, 10, 100)
	engine.frame = 5
	travel, period = Spring.GetUnitTravel(7)
	check("travel grows by the unit's speed each frame", travel == 25 and period == 100, tostring(travel))

	engine.frame = 35
	travel = Spring.GetUnitTravel(7)
	check("travel wraps at the period", travel == 15, tostring(travel))

	engine.units[7].beingBuilt = true
	engine.frame = 40
	travel = Spring.GetUnitTravel(7)
	check("a unit being built does not travel", travel == 15, tostring(travel))
	engine.units[7].beingBuilt = nil

	Spring.SetUnitTravel(7, nil, 0)
	engine.frame = 50
	travel, period = Spring.GetUnitTravel(7)
	check("a period of 0 stops travel and keeps the value", travel == 15 and period == 0, tostring(travel))

	support.load(engine, "")
	local seen
	handler(engine, {
		UnitDestroyed = function(unitID)
			seen = Spring.GetUnitTravel(unitID)
		end,
	})
	call(engine, "UnitDestroyed", 7, 1, 0)
	engine.frame = 60
	local after = { Spring.GetUnitTravel(7) }
	check("the game's UnitDestroyed still reads a dying unit's travel", seen == 15, tostring(seen))
	check("a destroyed unit's ID starts again at 0, 0", after[1] == 0 and after[2] == 0)
end

do
	local real = function(unitID)
		if unitID == 1 then
			return 4, 8
		end
	end
	local engine = newEngine({ spring = { GetUnitTravel = real } })
	prelude(engine)
	check("a GetUnitTravel that works is left alone", engine.env.Spring.GetUnitTravel == real)
end

--------------------------------------------------------------------------------
-- SetUnitToFeature
--------------------------------------------------------------------------------

do
	local engine = newEngine({
		unitDefs = { [3] = { isFeature = true, wreckName = "Rock_Dead" }, [4] = { isFeature = false, wreckName = "tank_dead" } },
		featureDefNames = { rock_dead = { id = 30 }, tank_dead = { id = 40 } },
	})
	prelude(engine)
	local Spring = engine.env.Spring
	local asked = {}
	handler(engine, {
		AllowFeatureCreation = function(featureDefID)
			asked[#asked + 1] = featureDefID
			return featureDefID ~= 99
		end,
	})

	call(engine, "UnitFinished", 1, 3, 0)
	check("with the switch on, an isFeature unit's wreck is allowed", call(engine, "AllowFeatureCreation", 30, 0, 0, 0, 0) == true)

	Spring.SetUnitToFeature(false)
	call(engine, "UnitFinished", 1, 3, 0)
	check("with the switch off, an isFeature unit's wreck is refused", call(engine, "AllowFeatureCreation", 30, 0, 0, 0, 0) == false)
	check("only the next feature is refused", call(engine, "AllowFeatureCreation", 30, 0, 0, 0, 0) == true)

	call(engine, "UnitFinished", 2, 4, 0)
	check("a unit that is not isFeature is not affected", call(engine, "AllowFeatureCreation", 40, 0, 0, 0, 0) == true)

	call(engine, "UnitFinished", 1, 3, 0)
	engine.frame = engine.frame + 1
	check("a wreck on a later frame is not refused", call(engine, "AllowFeatureCreation", 30, 0, 0, 0, 0) == true)

	check("the game's AllowFeatureCreation still decides the rest", call(engine, "AllowFeatureCreation", 99, 0, 0, 0, 0) == false)
	check("the game's AllowFeatureCreation is asked each time it is not refused first", #asked == 5, tostring(#asked))

	local ok = pcall(Spring.SetUnitToFeature, 0)
	check("SetUnitToFeature wants a boolean", not ok)
end

do
	local engine = newEngine({
		unitDefs = { [3] = { isFeature = true, wreckName = "rock_dead" } },
		featureDefNames = { rock_dead = { id = 30 } },
	})
	prelude(engine)
	support.load(engine, "")
	check("the call-ins the switch needs are registered when the game has none", engine.registered.UnitFinished and engine.registered.AllowFeatureCreation)
	engine.env.Spring.SetUnitToFeature(false)
	call(engine, "UnitFinished", 1, 3, 0)
	check("and refuse without a game handler", call(engine, "AllowFeatureCreation", 30, 0, 0, 0, 0) == false)
end

--------------------------------------------------------------------------------
-- Call-in signatures
--------------------------------------------------------------------------------

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"
	local engine = newEngine({ synced = synced })
	prelude(engine)
	check(state .. ": UnitDamaged is not registered before the game handles it", not engine.registered.UnitDamaged)

	local got
	-- Written for 0.81 to 94: weaponDefID, then the attacker.
	local h = handler(engine, {
		UnitDamaged = function(unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, attackerID, attackerDefID, attackerTeam, extra)
			got = { unitID, unitDefID, unitTeam, damage, paralyzer, weaponDefID, attackerID, attackerDefID, attackerTeam, extra }
		end,
	})
	check(state .. ": UnitDamaged is registered once the game handles it", engine.registered.UnitDamaged)

	-- The engine's order now: weaponDefID, projectileID, then the attacker.
	call(engine, "UnitDamaged", 11, 12, 1, 250, false, 5, 9001, 21, 22, 2)
	check(state .. ": an old UnitDamaged handler gets the old argument list",
		got and got[1] == 11 and got[2] == 12 and got[3] == 1 and got[4] == 250 and got[5] == false
			and got[6] == 5 and got[7] == 21 and got[8] == 22 and got[9] == 2 and got[10] == nil,
		got and table.concat({ tostring(got[6]), tostring(got[7]), tostring(got[8]), tostring(got[9]) }, ","))

	h.set("UnitDamaged", nil)
	check(state .. ": UnitDamaged goes when the game stops handling it", not engine.registered.UnitDamaged and rawget(engine.env, "UnitDamaged") == nil)
end

do
	local engine = newEngine()
	prelude(engine)
	local got
	-- Written for 104 and before: fromSynced is the eighth argument.
	handler(engine, {
		AllowCommand = function(unitID, unitDefID, unitTeam, cmdID, cmdParams, cmdOptions, cmdTag, fromSynced, extra)
			got = { cmdID = cmdID, params = cmdParams, options = cmdOptions, tag = cmdTag, fromSynced = fromSynced, extra = extra }
			return cmdID ~= 13
		end,
	})
	local params, options = { 1, 2, 3 }, { shift = true }
	local allowed = call(engine, "AllowCommand", 5, 6, 0, 10, params, options, 77, 3, false, true)
	check("an old AllowCommand handler gets fromSynced eighth", got.fromSynced == false and got.extra == nil and got.tag == 77, tostring(got.fromSynced))
	check("an old AllowCommand handler gets the command unchanged", got.cmdID == 10 and got.params == params and got.options == options)
	check("AllowCommand passes the handler's yes back", allowed == true)
	check("AllowCommand passes the handler's no back", call(engine, "AllowCommand", 5, 6, 0, 13, params, options, 78, 3, true, false) == false)
end

do
	-- The oldest games define their call-ins as plain globals in main.lua and
	-- never call Script.UpdateCallIn. The engine registers them when the file
	-- ends.
	local engine = newEngine()
	prelude(engine)
	support.load(engine, "function UnitDamaged(...) GOT = { ... } end")
	call(engine, "UnitDamaged", 1, 2, 3, 4, false, 5, 6, 7, 8, 9)
	local got = engine.env.GOT
	check("a call-in set as a plain global gets the old argument list", got ~= nil and got[7] == 7 and got[9] == 9 and got[10] == nil)
	support.load(engine, "NOT_A_CALLIN = 1")
	check("other globals are set as normal", rawget(engine.env, "NOT_A_CALLIN") == 1)
end

--------------------------------------------------------------------------------
-- Game identity
--------------------------------------------------------------------------------

-- The mutator's own values, as the engine reads them from its modinfo.lua, and
-- the base game's, which the mutator's modinfo.lua carries.
local function identity(synced)
	return newEngine({
		synced = synced,
		game = { gameName = "XTA 9.65 (compat 6)", gameVersion = "6", gameShortName = "XTA" },
		modinfo = { name = "XTA 9.65 (compat 6)", version = "6", compatbasename = "XTA", compatbaseversion = "9.65" },
	})
end

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"
	local engine = identity(synced)
	prelude(engine)
	local Game = engine.env.Game
	check(state .. ": Game.gameName is the base game's", Game.gameName == "XTA", tostring(Game.gameName))
	check(state .. ": Game.gameVersion is the base game's", Game.gameVersion == "9.65", tostring(Game.gameVersion))
	check(state .. ": Game.gameShortName is left alone", Game.gameShortName == "XTA")
	check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	-- A base game with no version reads as the empty string, as it does unwrapped.
	local engine = newEngine({
		game = { gameName = "Bare (compat 6)", gameVersion = "6" },
		modinfo = { compatbasename = "Bare", compatbaseversion = "" },
	})
	prelude(engine)
	check("a base game with no version reads as empty", engine.env.Game.gameVersion == "" and engine.env.Game.gameName == "Bare")
end

do
	-- A modinfo that does not carry the base game's values changes nothing.
	local engine = newEngine({
		game = { gameName = "Own (compat 6)", gameVersion = "6" },
		modinfo = { name = "Own (compat 6)", version = "6" },
	})
	prelude(engine)
	check("without the base values Game is left alone", engine.env.Game.gameName == "Own (compat 6)" and engine.env.Game.gameVersion == "6")
	check("without the base values no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	-- A strict game's global table errors on a read of an undefined call-in. The
	-- hooks read the global without going through that, and put the metatable back.
	local engine = newEngine()
	support.load(engine, 'setmetatable(_G, { __index = function(_, k) if k == "UnitDamaged" or k == "AllowCommand" then error("undefined " .. k) end end })')
	prelude(engine)
	local got
	handler(engine, { UnitDamaged = function(...) got = { ... } end })
	call(engine, "UnitDamaged", 1, 2, 3, 4, false, 5, 6, 7, 8, 9)
	check("a strict global table still gets hooked", got ~= nil and got[7] == 7)
	check("no fix failed under a strict global table", #engine.logs == 0, table.concat(engine.logs, "; "))
	check("the game's metatable is back", getmetatable(engine.env).__index ~= nil and getmetatable(engine.env).__newindex ~= nil)
end

--------------------------------------------------------------------------------
-- Game.version, which 104.0 moved to Engine.version (issue #4695)
--------------------------------------------------------------------------------

local ENGINE = { version = "2026.09.01", versionFull = "2026.09.01 release", versionPatchSet = "0" }

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"
	local engine = newEngine({ synced = synced, manifest = 11, game = { gameName = "S44" }, engine = ENGINE, modinfo = {} })
	prelude(engine)
	local Game = engine.env.Game
	check(state .. ": Game.version reads Engine.version", Game.version == "2026.09.01", tostring(Game.version))
	check(state .. ": Game.versionFull reads Engine.versionFull", Game.versionFull == "2026.09.01 release")
	check(state .. ": Game.versionPatchSet reads Engine.versionPatchSet", Game.versionPatchSet == "0")
	-- Spring 1944's unit_weaponToggle.lua, line 33.
	local ok, err = pcall(function() return Game.version:find("100") == 1 end)
	check(state .. ": a gadget that reads Game.version loads", ok, tostring(err))
	check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	local engine = newEngine({ manifest = 11, game = { version = "own" }, engine = ENGINE, modinfo = {} })
	prelude(engine)
	check("a Game.version that is set is left alone", engine.env.Game.version == "own")
	local bare = newEngine({ manifest = 11 })
	prelude(bare)
	check("without Game or Engine no fix failed", #bare.logs == 0, table.concat(bare.logs, "; "))
end

--------------------------------------------------------------------------------
-- Spring.GetGroundInfo, which 105.0 gave a terrain type index first (issue #4695)
--------------------------------------------------------------------------------

-- The engine's order now (rts/Lua/LuaSyncedRead.cpp, PushTerrainTypeData):
-- index, name, metal, hardness, tank, kbot, hover, ship, receiveTracks.
local function groundInfo(x, z)
	return 3, "sand", x + z, 1.5, 1, 0.9, 0.8, 0.7, true
end

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"
	local engine = newEngine({ synced = synced, manifest = 11, spring = { GetGroundInfo = groundInfo } })
	prelude(engine)
	local got = { engine.env.Spring.GetGroundInfo(10, 2) }
	check(state .. ": GetGroundInfo gives the 104 order", #got == 8 and got[1] == "sand" and got[2] == 12 and got[3] == 1.5 and got[8] == true,
		table.concat({ tostring(got[1]), tostring(got[2]), tostring(#got) }, ","))
	-- Spring 1944's game_flagManager.lua, line 152.
	local _, curMetal = engine.env.Spring.GetGroundInfo(0, 0)
	check(state .. ": the metal is the second value", type(curMetal) == "number" and curMetal == 0, tostring(curMetal))
	check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))

	-- A game that includes its own entry file runs the prelude a second time.
	prelude(engine)
	got = { engine.env.Spring.GetGroundInfo(10, 2) }
	check(state .. ": a second prelude does not move the order again", got[1] == "sand" and got[2] == 12, tostring(got[1]))
end

do
	local old = function() return "sand", 4 end
	local engine = newEngine({ manifest = 11, spring = { GetGroundInfo = old } })
	prelude(engine)
	check("a GetGroundInfo that gives the name first is left alone", engine.env.Spring.GetGroundInfo == old)
	local missing = newEngine({ manifest = 11 })
	prelude(missing)
	check("without GetGroundInfo it is not defined", missing.env.Spring.GetGroundInfo == nil)
	check("without GetGroundInfo no fix failed", #missing.logs == 0, table.concat(missing.logs, "; "))
end

--------------------------------------------------------------------------------
-- snext, spairs and sipairs (issue #4692)
--------------------------------------------------------------------------------

-- The unsynced half of LuaRules or LuaGaia, which has the SYNCED proxy.
local function splitUnsynced(opts)
	opts = opts or {}
	opts.synced, opts.manifest = false, 12
	local engine = newEngine(opts)
	engine.env.SYNCED = {}
	return engine
end

do
	local engine = splitUnsynced()
	prelude(engine)
	local env = engine.env
	check("unsynced rules: snext is next", env.snext == next)
	check("unsynced rules: spairs is pairs", env.spairs == pairs)
	check("unsynced rules: sipairs is ipairs", env.sipairs == ipairs)
	check("unsynced rules: no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))

	-- The engine's LuaGadgets/system.lua builds System, and its gadget handler
	-- gives each gadget a copy of it rather than the globals.
	support.load(engine, "System = { pairs = pairs, SYNCED = SYNCED }")
	local System = env.System
	check("System gets snext, spairs and sipairs", System.snext == next and System.spairs == pairs and System.sipairs == ipairs)
	check("System keeps what system.lua put in it", System.pairs == pairs and System.SYNCED == env.SYNCED)

	local seen = {}
	support.load(engine, "for k, v in System.spairs({ a = 1 }) do SEEN = k end for i, v in System.sipairs({ 7 }) do SEEN2 = v end")
	check("spairs and sipairs iterate as pairs and ipairs", env.SEEN == "a" and env.SEEN2 == 7)
	support.load(engine, "OTHER = 1")
	check("other globals are set as normal", rawget(env, "OTHER") == 1)
end

do
	-- A game's own system.lua that lists them reads the globals.
	local engine = splitUnsynced()
	prelude(engine)
	support.load(engine, "System = { snext = snext, spairs = spairs }")
	check("a system.lua that lists them gets the globals", engine.env.System.snext == next and engine.env.System.spairs == pairs)
end

do
	local own = function() return "own" end
	local engine = splitUnsynced()
	engine.env.snext = own
	prelude(engine)
	support.load(engine, "System = { snext = MINE }")
	engine.env.MINE = nil
	check("a game's own snext is left alone", engine.env.snext == own)
end

do
	-- The call-in hooks still see a call-in set once the iterators are in.
	local engine = splitUnsynced()
	prelude(engine)
	local got
	support.load(engine, "System = {}")
	handler(engine, { UnitDamaged = function(...) got = { ... } end })
	call(engine, "UnitDamaged", 1, 2, 3, 4, false, 5, 6, 7, 8, 9)
	check("the hooks still work after System is set", got ~= nil and got[7] == 7)
end

for _, case in ipairs({
	{ name = "LuaUI", engine = function() return newEngine({ synced = false, manifest = 12 }) end },
	{ name = "synced", engine = function() return newEngine({ manifest = 12 }) end },
}) do
	local engine = case.engine()
	prelude(engine)
	support.load(engine, "System = {}")
	check(case.name .. ": no snext, spairs or sipairs, as the engine never gave it them",
		engine.env.snext == nil and engine.env.spairs == nil and engine.env.sipairs == nil and engine.env.System.snext == nil)
	check(case.name .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

--------------------------------------------------------------------------------
-- Unit lineage (issue #4693)
--------------------------------------------------------------------------------

-- A synced state whose units have teams, and teams 0 to 3.
local function lineageEngine(opts)
	opts = opts or {}
	opts.manifest = 12
	local engine = newEngine(opts)
	local Spring = engine.env.Spring
	Spring.GetUnitTeam = function(unitID)
		local unit = engine.units[unitID]
		return unit and unit.team
	end
	Spring.GetTeamInfo = function(teamID)
		if teamID >= 0 and teamID < 4 then
			return teamID
		end
	end
	return engine
end

do
	local engine = lineageEngine()
	prelude(engine)
	support.load(engine, "")
	local Spring = engine.env.Spring
	check("synced: Spring.SetUnitLineage and GetUnitLineage are defined", type(Spring.SetUnitLineage) == "function" and type(Spring.GetUnitLineage) == "function")
	check("the call-ins lineage needs are registered when the game has none", engine.registered.UnitCreated and engine.registered.UnitDestroyed)

	-- XTA's CommOption.lua: the start unit is its team's lineage root.
	engine.units[10] = { team = 1 }
	call(engine, "UnitCreated", 10, 5, 1)
	local lineage, root = Spring.GetUnitLineage(10)
	check("a new unit's lineage is its team", lineage == 1 and root == false, tostring(lineage) .. " " .. tostring(root))
	Spring.SetUnitLineage(10, 1, true)
	lineage, root = Spring.GetUnitLineage(10)
	check("SetUnitLineage with true makes the unit its team's root", lineage == 1 and root == true)

	-- unit_morph.lua: the new unit takes the old one's lineage and is the root.
	engine.units[12] = { team = 1 }
	call(engine, "UnitCreated", 12, 7, 1)
	Spring.SetUnitLineage(12, (Spring.GetUnitLineage(10)), true)
	lineage, root = Spring.GetUnitLineage(12)
	check("a morphed unit takes the old one's lineage and becomes the root", lineage == 1 and root == true)
	check("a team has one root", select(2, Spring.GetUnitLineage(10)) == false)

	-- A unit built by a unit takes its builder's lineage.
	Spring.SetUnitLineage(12, 2)
	check("SetUnitLineage without true keeps the root", select(2, Spring.GetUnitLineage(12)) == true)
	engine.units[11] = { team = 1 }
	call(engine, "UnitCreated", 11, 6, 1, 12)
	lineage, root = Spring.GetUnitLineage(11)
	check("a built unit takes its builder's lineage", lineage == 2 and root == false, tostring(lineage))

	-- As in 0.82, true makes the unit the root of the team it is given, and
	-- GetUnitLineage asks whether it is the root of its own team.
	Spring.SetUnitLineage(11, 3, true)
	lineage, root = Spring.GetUnitLineage(11)
	check("a unit made root of another team is not its own team's root", lineage == 3 and root == false)

	check("a unit that does not exist has no lineage", select("#", Spring.GetUnitLineage(99)) == 0)
	check("SetUnitLineage on a unit that does not exist does nothing", select("#", Spring.SetUnitLineage(99, 1, true)) == 0 and select(2, Spring.GetUnitLineage(12)) == true)
	check("SetUnitLineage wants a unit ID", not pcall(Spring.SetUnitLineage, "a", 1))
	check("SetUnitLineage wants a team ID", not pcall(Spring.SetUnitLineage, 12, nil))
	check("SetUnitLineage wants a team that exists", not pcall(Spring.SetUnitLineage, 12, 9))
	check("GetUnitLineage wants a unit ID", not pcall(Spring.GetUnitLineage, {}))

	local seen
	handler(engine, {
		UnitDestroyed = function(unitID)
			seen = { Spring.GetUnitLineage(unitID) }
		end,
	})
	call(engine, "UnitDestroyed", 12, 7, 1)
	check("the game's UnitDestroyed still reads a dying unit's lineage", seen[1] == 2 and seen[2] == true)
	engine.units[12] = { team = 3 }
	call(engine, "UnitCreated", 12, 7, 3)
	lineage, root = Spring.GetUnitLineage(12)
	check("a destroyed unit's ID starts again as a unit of its new team", lineage == 3 and root == false, tostring(lineage))
	check("synced: no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	-- A unit made before the call-in was registered reads as its team's.
	local engine = lineageEngine()
	prelude(engine)
	engine.units[4] = { team = 2 }
	local lineage, root = engine.env.Spring.GetUnitLineage(4)
	check("a unit the fix never saw made has its team's lineage", lineage == 2 and root == false)
end

do
	local own = function() end
	local engine = lineageEngine({ spring = { SetUnitLineage = own } })
	prelude(engine)
	check("an existing Spring.SetUnitLineage is left alone", engine.env.Spring.SetUnitLineage == own)
end

do
	local engine = newEngine({ synced = false, manifest = 12 })
	prelude(engine)
	check("unsynced: no lineage functions, as the table lives in the synced state", engine.env.Spring.SetUnitLineage == nil and engine.env.Spring.GetUnitLineage == nil)
end

--------------------------------------------------------------------------------
-- Spring.GetTeamInfo's results (issue #4694)
--------------------------------------------------------------------------------

-- The engine's GetTeamInfo now: income multiplier 7th, custom keys 8th, and
-- no keys at all when the second argument is false.
local keys = { startmetal = "500" }
local function currentGetTeamInfo(teamID, getTeamKeys)
	if teamID ~= 0 then
		return
	end
	if getTeamKeys == false then
		return 0, 1, false, true, "arm", 0, 1.5
	end
	return 0, 1, false, true, "arm", 0, 1.5, keys
end

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"
	local engine = newEngine({ synced = synced, manifest = 12, spring = { GetTeamInfo = currentGetTeamInfo } })
	prelude(engine)
	local GetTeamInfo = engine.env.Spring.GetTeamInfo
	local got = { GetTeamInfo(0) }
	check(state .. ": GetTeamInfo gives the custom keys 7th and the income multiplier 8th",
		select("#", GetTeamInfo(0)) == 8 and got[7] == keys and got[8] == 1.5, tostring(got[7]) .. " " .. tostring(got[8]))
	check(state .. ": the values before them are unchanged", got[1] == 0 and got[2] == 1 and got[3] == false and got[4] == true and got[5] == "arm" and got[6] == 0)
	-- Expand and Exterminate's start_unit_spawn.lua, line 59.
	local teamOptions = select(7, GetTeamInfo(0))
	check(state .. ": select(7, ...) is the custom keys table", type(teamOptions) == "table" and teamOptions.startmetal == "500")
	check(state .. ": a team that does not exist gives nothing", select("#", GetTeamInfo(5)) == 0)
	check(state .. ": with no keys asked for, the seven values come back as they are", select("#", GetTeamInfo(0, false)) == 7 and select(7, GetTeamInfo(0, false)) == 1.5)
	check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

support.report()
