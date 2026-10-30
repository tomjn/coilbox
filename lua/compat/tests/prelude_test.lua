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
-- Set*RulesParam, which 105.0 stopped turning a numeric string into a number
-- (issue #4700)
--------------------------------------------------------------------------------

-- The engine's SetRulesParam now (rts/Lua/LuaSyncedCtrl.cpp): a number is kept
-- as a number and a string as a string, and nil erases the param.
local function rulesEngine()
	local params = {}
	local function store(scope, name, value, los)
		params[scope] = params[scope] or {}
		params[scope][name] = value
		params.los = los
	end
	local spring = {
		SetGameRulesParam = function(name, value, los) store("game", name, value, los) end,
		GetGameRulesParam = function(name) return (params.game or {})[name] end,
	}
	for _, kind in ipairs({ "Team", "Unit", "Feature" }) do
		spring["Set" .. kind .. "RulesParam"] = function(id, name, value, los) store(kind .. id, name, value, los) end
		spring["Get" .. kind .. "RulesParam"] = function(id, name) return (params[kind .. id] or {})[name] end
	end
	return spring, params
end

do
	local spring, params = rulesEngine()
	local engine = newEngine({ manifest = 14, spring = spring })
	prelude(engine)
	local S = engine.env.Spring
	-- Spring 1944's game_ammo.lua, lines 252 and 178.
	S.SetUnitRulesParam(7, "ammo", "30")
	local ammo = S.GetUnitRulesParam(7, "ammo")
	check("a unit's numeric string is stored as a number", type(ammo) == "number" and ammo == 30, type(ammo))
	local ok, err = pcall(function() return S.GetUnitRulesParam(7, "ammo") < 5 end)
	check("game_ammo.lua's comparison works", ok, tostring(err))
	S.SetGameRulesParam("gravity", " 1.5 ")
	check("a game param's numeric string is a number", S.GetGameRulesParam("gravity") == 1.5)
	S.SetTeamRulesParam(2, "supplies", "-4")
	check("a team param's numeric string is a number", S.GetTeamRulesParam(2, "supplies") == -4)
	S.SetFeatureRulesParam(9, "metal", "1e2", { public = true })
	check("a feature param's numeric string is a number", S.GetFeatureRulesParam(9, "metal") == 100)
	check("the los table is passed on", type(params.los) == "table" and params.los.public == true)
	S.SetUnitRulesParam(7, "name", "Pzkw IV")
	check("a string that is not a number stays a string", S.GetUnitRulesParam(7, "name") == "Pzkw IV")
	S.SetUnitRulesParam(7, "empty", "")
	check("an empty string stays a string", S.GetUnitRulesParam(7, "empty") == "")
	S.SetUnitRulesParam(7, "speed", 2.5)
	check("a number is passed on as it came", S.GetUnitRulesParam(7, "speed") == 2.5)
	S.SetUnitRulesParam(7, "flag", true)
	check("a boolean is passed on as it came", S.GetUnitRulesParam(7, "flag") == true)
	S.SetUnitRulesParam(7, "ammo", nil)
	check("nil still erases the param", S.GetUnitRulesParam(7, "ammo") == nil)
	check("no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))

	-- A game that includes its own entry file runs the prelude a second time.
	prelude(engine)
	S.SetUnitRulesParam(7, "ammo", "12")
	check("a second prelude still stores a number", S.GetUnitRulesParam(7, "ammo") == 12)
end

do
	local engine = newEngine({ manifest = 14 })
	prelude(engine)
	check("without the rules param functions none is defined", engine.env.Spring.SetUnitRulesParam == nil and engine.env.Spring.SetGameRulesParam == nil)
	check("without the rules param functions no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
	local player = function() end
	local only = newEngine({ manifest = 14, spring = { SetPlayerRulesParam = player } })
	prelude(only)
	check("SetPlayerRulesParam, which 104.0 did not have, is left alone", only.env.Spring.SetPlayerRulesParam == player)
	local unsynced = newEngine({ synced = false, manifest = 14, spring = { SetUnitRulesParam = player } })
	prelude(unsynced)
	check("the unsynced state is left alone", unsynced.env.Spring.SetUnitRulesParam == player)
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

--------------------------------------------------------------------------------
-- LuaUI/main.lua including LuaUI/main.lua (issue #4698)
--------------------------------------------------------------------------------

-- Spring 1944 2.31's LuaUI/main.lua as the mutator wraps it: the prelude, then
-- the include function the engine's LuaHandler/Utilities/utils.lua defines,
-- then line 56's include "LuaUI/main.lua". `runs` counts how often the game's
-- code ran, and the count stops a manifest without the fix from including
-- itself for ever.
local s44Entry = 'VFS.Include("compat/prelude-unsynced.lua") '
	.. 'function include(filename, envTable, mode) return VFS.Include(filename, envTable, mode) end '
	.. 'runs = (runs or 0) + 1 '
	.. 'if runs < 3 then include "LuaUI/main.lua" end '
	.. 'loaded = true'

local function luaui(manifest, files, name)
	local all = { ["LuaUI/main.lua"] = s44Entry }
	for path, source in pairs(files or {}) do
		all[path] = source
	end
	return newEngine({ synced = false, manifest = manifest, name = name or "LuaUI", files = all })
end

do
	-- No loose LuaUI/ beside the engine, so the include finds the game's own
	-- entry again.
	local before = luaui(14)
	support.load(before, s44Entry)
	check("manifest 14: the game's entry runs again", before.env.runs == 3, tostring(before.env.runs))

	local engine = luaui(15)
	support.load(engine, s44Entry)
	check("the game's entry runs once", engine.env.runs == 1, tostring(engine.env.runs))
	check("the rest of the entry still runs", engine.env.loaded == true)
	check("no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	-- The engine's LuaUI/main.lua beside it, which stops on rml_setup.lua.
	local engineFile = { ["LuaUI/main.lua"] = 'error("LuaUI/rml_setup.lua: File not seen by VFS")' }
	local engine = luaui(15, engineFile)
	local ok, err = pcall(support.load, engine, s44Entry)
	check("the engine's own LuaUI/main.lua is not run", ok, tostring(err))
	check("the game's entry finishes", engine.env.runs == 1 and engine.env.loaded == true)
end

do
	local engine = luaui(15, {
		["LuaUI/Widgets/gui_x.lua"] = "return ..., 'x'",
		["LuaUI/Widgets/main.lua"] = "return 'w'",
		["LuaUI/Widgets/api_x.lua"] = "return widget",
	})
	local VFS = engine.env.VFS
	local include = VFS.Include
	support.load(engine, s44Entry)
	check("VFS.Include is left alone", VFS.Include == include)
	local a, b = engine.env.include("LuaUI/Widgets/gui_x.lua", { y = 1 }, "rM")
	check("another include passes on its results", a == nil and b == "x", tostring(a) .. " " .. tostring(b))
	for _, path in ipairs({ "luaui/MAIN.lua", "LuaUI\\main.lua", "LUAUI/MAIN.LUA" }) do
		check("the entry under another spelling is skipped: " .. path, engine.env.include(path) == nil and engine.env.runs == 1)
	end
	check("a main.lua in another folder still loads", engine.env.include("LuaUI/Widgets/main.lua") == "w")

	-- Spring 1944's LuaUI/Widgets/api_vector.lua includes a file with no
	-- environment, which then reads the widget's own `widget`.
	local widgetEnv = setmetatable({ widget = "the widget" }, { __index = engine.env })
	local load = setfenv(function()
		local result = VFS.Include("LuaUI/Widgets/api_x.lua")
		return result
	end, widgetEnv)
	check("a widget's include without an environment runs in the widget's", load() == "the widget", tostring(load()))
end

do
	-- A game whose entry is luaui.lua means to include its LuaUI/main.lua.
	local engine = luaui(15, { ["luaui.lua"] = "", ["LuaUI/main.lua"] = "included = true" })
	support.load(engine, (s44Entry:gsub("if runs < 3 then", "if true then")))
	check("with luaui.lua, LuaUI/main.lua is included", engine.env.included == true)
end

for _, name in ipairs({ "LuaRules", "LuaGaia", "LuaIntro" }) do
	local engine = luaui(15, { ["LuaUI/main.lua"] = "included = true" }, name)
	support.load(engine, (s44Entry:gsub("if runs < 3 then", "if true then")))
	check(name .. ": include \"LuaUI/main.lua\" is left alone", engine.env.included == true)
end

--------------------------------------------------------------------------------
-- fontHandler and widgetHandler:InTweakMode under LuaHandler (issue #4705)
--------------------------------------------------------------------------------

-- A stand-in for the engine's LuaHandler/handler.lua, with only what the fixes
-- meet: it copies the globals as it starts, makes the handler global, defines
-- NewAddon, includes the game's config.lua, and then loads one revision 1 and
-- one revision 2 widget. A revision 1 widget gets a widgetHandler table of its
-- own, and a revision 2 widget gets the handler.
local luaHandler = [[
local EG = {}
for k, v in pairs(_G) do EG[k] = v end
handler = { name = "widgetHandler", addons = {} }
setmetatable(handler, { __index = function() end })
function handler:NewAddon(rev)
	local env = {}
	for k, v in pairs(EG) do env[k] = v end
	env.widget = env
	env.widgetHandler = rev > 1 and handler or { RemoveWidget = function() end }
	return env
end
include("config.lua")
for rev, file in ipairs({ "LuaUI/Widgets/rev1.lua", "LuaUI/Widgets/rev2.lua" }) do
	local env = handler:NewAddon(rev)
	VFS.Include(file, env)
	handler.addons[rev] = env
end
]]

-- What gui_flagIncome.lua and gui_buildbar.lua do, in one widget.
local s44Widget = 'function widget:DrawWorld() fontHandler.UseDefaultFont() return widgetHandler:InTweakMode() end'

local s44Handler = 'VFS.Include("compat/prelude-unsynced.lua") '
	.. 'function include(filename, envTable, mode) return VFS.Include(filename, envTable, mode) end '
	.. 'include "LuaHandler/handler.lua"'

local function luaHandlerGame(manifest, name, entry, files)
	local all = {
		["LuaHandler/handler.lua"] = luaHandler,
		["config.lua"] = "configured = true",
		["LuaUI/Widgets/rev1.lua"] = s44Widget,
		["LuaUI/Widgets/rev2.lua"] = s44Widget,
	}
	for path, source in pairs(files or {}) do
		all[path] = source
	end
	local engine = newEngine({ synced = false, manifest = manifest, name = name or "LuaUI", files = all })
	support.load(engine, entry or s44Handler)
	return engine
end

local function drawWorld(engine, rev)
	local widget = engine.env.handler.addons[rev]
	return pcall(widget.DrawWorld, widget)
end

do
	local before = luaHandlerGame(15)
	local ok, err = drawWorld(before, 1)
	check("manifest 15: the widget fails on fontHandler", not ok and tostring(err):find("fontHandler") ~= nil, tostring(err))

	local engine = luaHandlerGame(16)
	check("the handler's config.lua still runs", engine.env.configured == true)
	for rev = 1, 2 do
		local ran, inTweak = drawWorld(engine, rev)
		check("revision " .. rev .. ": the widget draws", ran, tostring(inTweak))
		check("revision " .. rev .. ": InTweakMode says false", inTweak == false, tostring(inTweak))
	end
	check("UseDefaultFont returns nothing", select("#", engine.env.fontHandler.UseDefaultFont()) == 0)
	local own = engine.env.handler.addons[1].widgetHandler
	check("a revision 1 widget keeps its own widgetHandler", own ~= engine.env.handler and own.RemoveWidget ~= nil)
	check("no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	-- A widget made after the handler has started gets InTweakMode too.
	local engine = luaHandlerGame(16)
	local env = engine.env.handler:NewAddon(1)
	check("a widget loaded later gets InTweakMode", env.widgetHandler:InTweakMode() == false)
end

do
	-- What the game or the engine already has is left alone.
	local fonts = { UseDefaultFont = function() return "own" end }
	local own = function() return "own" end
	local handlerWithTweak = luaHandler:gsub("RemoveWidget = function%(%) end", "InTweakMode = OWN_TWEAK")
	local mine = newEngine({
		synced = false,
		manifest = 16,
		name = "LuaUI",
		files = {
			["LuaHandler/handler.lua"] = handlerWithTweak,
			["config.lua"] = "",
			["LuaUI/Widgets/rev1.lua"] = s44Widget,
			["LuaUI/Widgets/rev2.lua"] = s44Widget,
		},
	})
	mine.env.OWN_TWEAK = own
	mine.env.OWN_FONTS = fonts
	support.load(mine, 'VFS.Include("compat/prelude-unsynced.lua") fontHandler = OWN_FONTS ' .. s44Handler:gsub("^[^ ]+ ", ""))
	check("a fontHandler set before the handler starts is kept", mine.env.fontHandler == fonts)
	check("a widgetHandler's own InTweakMode is kept", mine.env.handler.addons[1].widgetHandler.InTweakMode == own)
end

do
	-- The engine's basic widget handler defines fontHandler in its fonts.lua,
	-- which returns early when one is there. A game that runs it never
	-- includes LuaHandler/handler.lua, so the fix sets nothing.
	local basicFonts = 'if fontHandler ~= nil then return fontHandler end fontHandler = { basic = true }'
	local engine = luaHandlerGame(16, "LuaUI", 'VFS.Include("compat/prelude-unsynced.lua") '
		.. 'function include(filename, envTable, mode) return VFS.Include(filename, envTable, mode) end '
		.. 'include "fonts.lua"', { ["fonts.lua"] = basicFonts })
	check("the basic handler's fontHandler is its own", engine.env.fontHandler and engine.env.fontHandler.basic == true)
end

for _, name in ipairs({ "LuaRules", "LuaGaia", "LuaIntro" }) do
	local engine = luaHandlerGame(16, name)
	check(name .. ": no fontHandler is defined", engine.env.fontHandler == nil)
	check(name .. ": no InTweakMode is given", engine.env.handler.addons[1].widgetHandler.InTweakMode == nil)
end

--------------------------------------------------------------------------------
-- The n key of Spring.GetSelectedUnitsCounts and GetSelectedUnitsSorted
-- (issue #4706)
--------------------------------------------------------------------------------

-- The engine's functions now: a table keyed by unit def ID with no n, and the
-- number of unit defs second.
local selected = { [12] = { 101, 102 }, [30] = { 103 } }

local function currentSelection()
	return {
		GetSelectedUnitsCounts = function()
			local counts, n = {}, 0
			for defID, units in pairs(selected) do
				counts[defID], n = #units, n + 1
			end
			return counts, n
		end,
		GetSelectedUnitsSorted = function()
			local sorted, n = {}, 0
			for defID, units in pairs(selected) do
				sorted[defID], n = units, n + 1
			end
			return sorted, n
		end,
	}
end

do
	local before = newEngine({ synced = false, manifest = 15, spring = currentSelection() })
	prelude(before)
	check("manifest 15: the counts have no n", before.env.Spring.GetSelectedUnitsCounts().n == nil)

	local engine = newEngine({ synced = false, manifest = 16, spring = currentSelection() })
	prelude(engine)
	local Spring = engine.env.Spring
	for _, name in ipairs({ "GetSelectedUnitsCounts", "GetSelectedUnitsSorted" }) do
		local units = Spring[name]()
		check(name .. ": n is the number of unit defs", units.n == 2, tostring(units.n))
		check(name .. ": the table is all it returns, as on 104.0", select("#", Spring[name]()) == 1)
		check(name .. ": the unit defs are still there", units[12] ~= nil and units[30] ~= nil)
	end
	check("the counts are still the counts", Spring.GetSelectedUnitsCounts()[12] == 2)
	check("no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))

	-- What gui_s44_selbuttons.lua does with the counts: SortedUnits passes on
	-- every result, and DrawScreen takes the second as a transport's unit ID.
	local function sortedUnits()
		return Spring.GetSelectedUnitsCounts()
	end
	local counts, transID = sortedUnits()
	local ok, err = pcall(function()
		return counts.n + 1
	end)
	check("arithmetic on n works", ok, tostring(err))
	check("no transport ID comes second", transID == nil, tostring(transID))
end

do
	-- Nothing selected.
	local engine = newEngine({
		synced = false,
		manifest = 16,
		spring = {
			GetSelectedUnitsCounts = function()
				return {}, 0
			end,
		},
	})
	prelude(engine)
	check("nothing selected: n is 0", engine.env.Spring.GetSelectedUnitsCounts().n == 0)
end

do
	-- An engine that still sets n keeps its own.
	local engine = newEngine({
		synced = false,
		manifest = 16,
		spring = {
			GetSelectedUnitsSorted = function()
				return { [4] = { 1 }, n = 7 }
			end,
		},
	})
	prelude(engine)
	check("the engine's own n is kept", engine.env.Spring.GetSelectedUnitsSorted().n == 7)
	check("a missing function stays missing", engine.env.Spring.GetSelectedUnitsCounts == nil)
end

do
	local counts = currentSelection().GetSelectedUnitsCounts
	local engine = newEngine({ manifest = 16, spring = { GetSelectedUnitsCounts = counts } })
	prelude(engine)
	check("synced: GetSelectedUnitsCounts is left alone", engine.env.Spring.GetSelectedUnitsCounts == counts)
end

--------------------------------------------------------------------------------
-- Complete Annihilation's widgets (issue #4708)
--------------------------------------------------------------------------------

-- A def proxy as rts/Lua/LuaUtils.h PushObjectDefProxyTable builds one: a
-- table with raw pairs and next, and a protected metatable. `params` are the
-- names the engine knows, each a value or a function that builds one on every
-- read. `removed` are the names it still knows but logs an error for. Writing a
-- known name raises an error, as with editing defs off, and anything else is
-- set raw.
local function defProxy(engine, kind, params, removed)
	local proxy = { pairs = pairs, next = next }
	setmetatable(proxy, {
		__index = function(t, key)
			if removed[key] then
				engine.logs[#engine.logs + 1] = "ERROR_TYPE for key \"" .. key .. "\" in " .. kind .. " __index"
				return nil
			end
			local value = params[key]
			if type(value) == "function" then
				return value()
			end
			return value
		end,
		__newindex = function(t, key, value)
			if params[key] ~= nil or removed[key] then
				error("Attempt to write " .. kind .. "[1]." .. tostring(key), 2)
			end
			rawset(t, key, value)
		end,
		__metatable = function() end,
	})
	return proxy
end

local weaponRemoved = { areaOfEffect = true, maxVelocity = true, onlyTargetCategories = true }

local function caEngine(synced, manifest)
	local engine = newEngine({ synced = synced, manifest = manifest })
	local env = engine.env
	env.WeaponDefs = {
		[0] = defProxy(engine, "WeaponDefs", { name = "flak", damageAreaOfEffect = 64, projectilespeed = 12 }, weaponRemoved),
		[1] = defProxy(engine, "WeaponDefs", { name = "laser", damageAreaOfEffect = 4, projectilespeed = 0.5 }, weaponRemoved),
	}
	env.UnitDefs = {
		[1] = defProxy(engine, "UnitDefs", {
			name = "armcom",
			weapons = function()
				return { { weaponDef = 0 }, { weaponDef = 1 } }
			end,
		}, {}),
		[2] = defProxy(engine, "UnitDefs", {
			name = "armsolar",
			weapons = function()
				return {}
			end,
		}, {}),
	}
	-- rts/Lua/LuaConstCMD.cpp now: no AISELECT or SET_WANTED_MAX_SPEED.
	env.CMD = { STOP = 0, [0] = "STOP", MOVE = 10, [10] = "MOVE", SELFD = 65, [65] = "SELFD" }
	local Spring = env.Spring
	Spring.GetTeamUnits = function(teamID)
		if teamID == 0 then
			return { 11, 12, 13 }
		end
	end
	Spring.GetUnitsInCylinder = function()
		return { 21 }, "second"
	end
	Spring.GetAllUnits = function()
		return {}
	end
	if not synced then
		Spring.GetSelectedUnits = function()
			return { 31, 32 }
		end
		Spring.GetGameState = function(maxLatency)
			engine.latency = maxLatency
			return true, false, false, engine.lagging
		end
	end
	return engine
end

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"

	do
		local before = caEngine(synced, 16)
		prelude(before)
		check(state .. ": manifest 16 has no CMD.AISELECT", before.env.CMD.AISELECT == nil)

		local engine = caEngine(synced, 17)
		prelude(engine)
		local CMD = engine.env.CMD
		check(state .. ": CMD.AISELECT is 30 both ways", CMD.AISELECT == 30 and CMD[30] == "AISELECT")
		check(state .. ": CMD.SET_WANTED_MAX_SPEED is 70 both ways", CMD.SET_WANTED_MAX_SPEED == 70 and CMD[70] == "SET_WANTED_MAX_SPEED")
		-- ca_layout.lua, line 75.
		local ok, err = pcall(function()
			return { [CMD.AISELECT] = true, [CMD.SELFD] = true }
		end)
		check(state .. ": ca_layout's hidden commands table builds", ok, tostring(err))
		check(state .. ": the commands the engine has are unchanged", CMD.STOP == 0 and CMD.MOVE == 10 and CMD[65] == "SELFD")
		check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
	end

	do
		local engine = caEngine(synced, 17)
		engine.env.CMD.AISELECT = 99
		engine.env.CMD[70] = "SOMETHING"
		prelude(engine)
		local CMD = engine.env.CMD
		check(state .. ": a CMD.AISELECT the engine has is left alone", CMD.AISELECT == 99 and CMD[30] == nil)
		check(state .. ": an ID the engine uses is not taken", CMD.SET_WANTED_MAX_SPEED == nil and CMD[70] == "SOMETHING")
	end

	do
		local before = caEngine(synced, 16)
		prelude(before)
		check(state .. ": manifest 16 has no n on GetTeamUnits", before.env.Spring.GetTeamUnits(0).n == nil)

		local engine = caEngine(synced, 17)
		prelude(engine)
		local Spring = engine.env.Spring
		local units = Spring.GetTeamUnits(0)
		check(state .. ": GetTeamUnits(teamID).n is the count", units.n == 3, tostring(units.n))
		-- gui_buildbar.lua, line 653.
		local seen = 0
		for num = 1, units.n do
			seen = seen + (units[num] and 1 or 0)
		end
		check(state .. ": gui_buildbar's loop runs over every unit", seen == 3)
		local keys = 0
		for _ in pairs(units) do
			keys = keys + 1
		end
		check(state .. ": pairs sees only the unit IDs", keys == 3, tostring(keys))
		check(state .. ": nothing for a team the engine gives nothing for", Spring.GetTeamUnits(5) == nil and select("#", Spring.GetTeamUnits(5)) == 1)
		check(state .. ": an empty array has n 0", Spring.GetAllUnits().n == 0)
		local cylinder, second = Spring.GetUnitsInCylinder(0, 0, 100)
		check(state .. ": the other results are passed on", cylinder.n == 1 and second == "second")
		units[4] = 14
		check(state .. ": n follows the array", units.n == 4)
		check(state .. ": a key n of the array's own wins", (function()
			local t = Spring.GetTeamUnits(0)
			t.n = "own"
			return t.n == "own"
		end)())
		check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
	end

	do
		local mt = { __index = function() return "theirs" end }
		local engine = caEngine(synced, 17)
		engine.env.Spring.GetTeamUnits = function()
			return setmetatable({ 1 }, mt)
		end
		prelude(engine)
		check(state .. ": a table with a metatable of its own is left alone", getmetatable(engine.env.Spring.GetTeamUnits(0)) == mt)
	end
end

do
	local engine = caEngine(false, 17)
	prelude(engine)
	local selected = engine.env.Spring.GetSelectedUnits()
	-- gui_transporting.lua, line 82.
	check("unsynced: GetSelectedUnits().n is the count", selected.n == 2, tostring(selected.n))
end

do
	-- gui_attack_aoe.lua, line 182, and gui_blastradius.lua, line 177.
	local engine = caEngine(false, 17)
	prelude(engine)
	local flak, laser = engine.env.WeaponDefs[0], engine.env.WeaponDefs[1]
	check("unsynced: areaOfEffect is damageAreaOfEffect", flak.areaOfEffect == 64 and laser.areaOfEffect == 4, tostring(flak.areaOfEffect))
	check("unsynced: maxVelocity is projectilespeed times 30", flak.maxVelocity == 360 and laser.maxVelocity == 15, tostring(flak.maxVelocity) .. " " .. tostring(laser.maxVelocity))
	check("unsynced: comparing areaOfEffect works", pcall(function()
		return flak.areaOfEffect > 8
	end))
	check("unsynced: the other values are the engine's", flak.name == "flak" and flak.damageAreaOfEffect == 64)
	check("unsynced: no ERROR_TYPE line is logged", #engine.logs == 0, table.concat(engine.logs, "; "))

	local before = caEngine(false, 16)
	prelude(before)
	check("manifest 16: areaOfEffect is nil and logged", before.env.WeaponDefs[0].areaOfEffect == nil and #before.logs == 1)
end

do
	-- The synced state has no rawset, so the fix stays out of it.
	local engine = caEngine(true, 17)
	prelude(engine)
	check("synced: areaOfEffect is not put back", engine.env.WeaponDefs[0].areaOfEffect == nil)
	check("synced: only the read of areaOfEffect is logged", #engine.logs == 1, table.concat(engine.logs, "; "))
end

do
	-- unit_healthbars.lua, line 209.
	local engine = caEngine(false, 17)
	prelude(engine)
	local ud = engine.env.UnitDefs[1]
	check("unsynced: ud.weapons.n is the count", ud.weapons.n == 2, tostring(ud.weapons.n))
	local seen = 0
	for i = 1, ud.weapons.n do
		seen = seen + (ud.weapons[i].weaponDef and 1 or 0)
	end
	check("unsynced: unit_healthbars' loop runs over every weapon", seen == 2)
	check("unsynced: a unit def with no weapons has n 0", engine.env.UnitDefs[2].weapons.n == 0)
	local keys = 0
	for _ in pairs(ud.weapons) do
		keys = keys + 1
	end
	check("unsynced: pairs sees only the weapons", keys == 2, tostring(keys))
	ud.reloadTime = 0
	check("unsynced: a widget can still add its own keys to a unit def", rawget(ud, "reloadTime") == 0)
	check("unsynced: no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))

	local synced = caEngine(true, 17)
	prelude(synced)
	check("synced: ud.weapons has no n, as the state has no rawset", synced.env.UnitDefs[1].weapons.n == nil)
end

do
	-- dbg_dcicon.lua, line 102.
	local engine = caEngine(false, 17)
	prelude(engine)
	local Spring = engine.env.Spring
	check("unsynced: Spring.GetHasLag is defined", type(Spring.GetHasLag) == "function")
	engine.lagging = true
	check("unsynced: GetHasLag is GetGameState's isSimLagging", Spring.GetHasLag() == true and engine.latency == nil)
	engine.lagging = false
	check("unsynced: GetHasLag passes on the latency", Spring.GetHasLag(250) == false and engine.latency == 250)
	check("unsynced: GetHasLag gives one result", select("#", Spring.GetHasLag()) == 1)

	local own = function() return "own" end
	local mine = caEngine(false, 17)
	mine.env.Spring.GetHasLag = own
	prelude(mine)
	check("unsynced: an existing Spring.GetHasLag is left alone", mine.env.Spring.GetHasLag == own)

	local synced = caEngine(true, 17)
	prelude(synced)
	check("synced: no GetHasLag, as GetGameState is unsynced", synced.env.Spring.GetHasLag == nil)
end

--------------------------------------------------------------------------------
-- LOG in a game's own System table, which Complete Annihilation's lacks (issue #4687)
--------------------------------------------------------------------------------

for _, synced in ipairs({ true, false }) do
	local state = synced and "synced" or "unsynced"

	local before = newEngine({ synced = synced, manifest = 17 })
	prelude(before)
	local system = { Spring = before.env.Spring }
	before.env.System = system
	check(state .. ": manifest 17 leaves System without LOG", system.LOG == nil)

	local engine = newEngine({ synced = synced, manifest = 18 })
	prelude(engine)
	local env = engine.env
	check(state .. ": no System until the game sets one", env.System == nil)

	-- What a gadget handler does: set System once, then copy it into each gadget.
	local game = { Spring = env.Spring }
	env.System = game
	check(state .. ": the game's System is the global", env.System == game)
	check(state .. ": a game's System gets LOG", game.LOG == env.LOG)
	local gadget = {}
	for k, v in pairs(env.System) do
		gadget[k] = v
	end
	-- LuaGadgets/Gadgets/unit_script.lua, line 532.
	local ok, err = pcall(function() return gadget.LOG.INFO end)
	check(state .. ": a gadget can read LOG", ok, tostring(err))

	local own = {}
	local mine = newEngine({ synced = synced, manifest = 18 })
	prelude(mine)
	mine.env.System = { LOG = own }
	check(state .. ": a System with its own LOG keeps it", mine.env.System.LOG == own)

	mine.env.Other = {}
	check(state .. ": any other global gets no LOG", mine.env.Other.LOG == nil)

	check(state .. ": no fix failed", #engine.logs == 0, table.concat(engine.logs, "; "))
end

do
	local bare = newEngine({ manifest = 18 })
	bare.env.LOG = nil
	prelude(bare)
	bare.env.System = {}
	check("with no LOG to give, System is left alone", bare.env.System.LOG == nil)
	check("with no LOG to give, no fix failed", #bare.logs == 0, table.concat(bare.logs, "; "))
end

support.report()
