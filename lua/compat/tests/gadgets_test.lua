-- Proves what the compat gadgets do in front of an old game: each turns itself
-- off when the game shows no sign of needing it, and otherwise brings back what
-- the engine stopped doing. Run it with:
--
--   luajit lua/compat/tests/gadgets_test.lua
--
-- Each test loads a gadget file the way a game's gadget handler does: in its
-- own environment, with `gadget` and `gadgetHandler` set, once for the Lua
-- state it is asked about. The Spring, VFS, UnitDefs and WeaponDefs tables are
-- stand-ins that record what the gadget asks of the engine.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check = support.check

local GADGETS = support.root() .. "/gadgets/"

--- A gadget loaded into a fresh stand-in for the engine. `opts.synced` says
--- which state, `opts.files` is the VFS by path, `opts.random` the numbers
--- math.random gives in turn, and `opts.spring` adds to the Spring table.
local function load(file, opts)
	opts = opts or {}
	local engine = {
		removed = false,
		logs = {},
		echoes = {},
		frame = 0,
		units = {},
		weaponStates = {},
		crashing = {},
		health = {},
		files = opts.files or {},
		random = opts.random or {},
	}
	local env = setmetatable({}, { __index = _G })
	env._G = env
	env.gadget = env
	env.gadgetHandler = {
		IsSyncedCode = function()
			return opts.synced ~= false
		end,
		RemoveGadget = function()
			engine.removed = true
		end,
	}
	env.math = setmetatable({
		random = function(n)
			local value = table.remove(engine.random, 1)
			assert(value ~= nil, "the test gave no more random numbers")
			return n and math.min(n, math.floor(value * n) + 1) or value
		end,
	}, { __index = math })
	env.UnitDefs = opts.unitDefs or {}
	env.WeaponDefs = opts.weaponDefs or {}
	env.VFS = {
		FileExists = function(path)
			return engine.files[path] ~= nil
		end,
		LoadFile = function(path)
			local value = engine.files[path]
			return type(value) == "string" and value or nil
		end,
		DirList = function(dir, _, _, recursive)
			local found = {}
			for path in pairs(engine.files) do
				local rest = path:sub(#dir + 1)
				if path:sub(1, #dir) == dir and path:sub(-4) == ".lua" and (recursive or not rest:find("/", 1, true)) then
					found[#found + 1] = path
				end
			end
			table.sort(found)
			return found
		end,
		Include = function(path)
			local value = engine.files[path]
			assert(type(value) == "function", "no Lua file in the test VFS: " .. path)
			return value()
		end,
	}
	local Spring = {
		Echo = function(text)
			engine.echoes[#engine.echoes + 1] = text
		end,
		Log = function(_, _, text)
			engine.logs[#engine.logs + 1] = text
		end,
		GetGameFrame = function()
			return engine.frame
		end,
		GetAllUnits = function()
			local ids = {}
			for unitID in pairs(engine.units) do
				ids[#ids + 1] = unitID
			end
			table.sort(ids)
			return ids
		end,
		GetUnitDefID = function(unitID)
			return engine.units[unitID] and engine.units[unitID].unitDefID
		end,
		GetUnitHealth = function(unitID)
			local unit = engine.units[unitID]
			if unit then
				return unit.health, unit.maxHealth
			end
		end,
		GetUnitIsBeingBuilt = function(unitID)
			local unit = engine.units[unitID]
			return unit and unit.beingBuilt == true, 1
		end,
		SetUnitCrashing = function(unitID, crash)
			local unit = engine.units[unitID]
			if not unit or unit.landed or not crash then
				return false
			end
			engine.crashing[unitID] = true
			return true
		end,
		SetUnitHealth = function(unitID, health)
			engine.units[unitID].health = health
			engine.health[unitID] = health
		end,
		SetUnitWeaponState = function(unitID, weaponNum, key, value)
			local states = engine.weaponStates
			states[#states + 1] = unitID .. ":" .. weaponNum .. ":" .. key .. "=" .. value
		end,
		GetTeamInfo = function(teamID)
			local team = opts.teams and opts.teams[teamID]
			if team then
				return teamID, team.leader, true
			end
		end,
		GetPlayerInfo = function(playerID)
			return opts.players and opts.players[playerID]
		end,
	}
	for name, value in pairs(opts.spring or {}) do
		Spring[name] = value
	end
	env.Spring = Spring
	engine.env = env

	local chunk = assert(loadfile(GADGETS .. file))
	setfenv(chunk, env)
	engine.returned = chunk()
	if engine.returned ~= false and type(env.Initialize) == "function" then
		env.Initialize(env)
	end
	return engine
end

--- Call one of the gadget's call-ins, as the handler does.
local function call(engine, name, ...)
	local fn = engine.env[name]
	if type(fn) == "function" then
		return fn(engine.env, ...)
	end
end

--------------------------------------------------------------------------------
-- Every gadget
--------------------------------------------------------------------------------

for _, file in ipairs({
	"gadget-aircraft-crash-83.lua",
	"gadget-aircraft-crash-83-v2.lua",
	"gadget-aircraft-crash-83-v3.lua",
	"gadget-only-forward-aim-105.lua",
	"gadget-messages-tdf-95.lua",
	"gadget-model-center-offset-89.lua",
}) do
	local engine = load(file, { files = { ["gamedata/messages.tdf"] = "x" } })
	local info = engine.env.GetInfo(engine.env)
	local id = file:gsub("%.lua$", "")
	local source = assert(io.open(GADGETS .. file)):read("*a")
	local header = source:match("%-%- gadget: ([%w_]+)\n")
	check(id .. ": its name starts with coilbox_compat_", info.name:sub(1, 15) == "coilbox_compat_", info.name)
	check(id .. ": its name is the one its header gives", info.name == header, tostring(header))
	check(id .. ": its header names the file", source:match("^%-%- id: ([%w-]+)\n") == id)
end

--------------------------------------------------------------------------------
-- Aircraft crash
--------------------------------------------------------------------------------

-- The fix the latest manifest lists. gadget-aircraft-crash-83-v2 is the same
-- gadget without the check for the engine a game's modinfo.lua names, and
-- gadget-aircraft-crash-83 lacks the check for newer Spring calls too.
local CRASH = "gadget-aircraft-crash-83-v3.lua"

-- A COB script that does `set CRASHING to 1`, among other code.
local function cob(sets)
	local push97 = "\001\016\002\016\097\000\000\000"
	local push1 = "\001\016\002\016\001\000\000\000"
	local set = "\000\032\008\016"
	local body = "COBHEADER" .. push97 .. "\003\016\002\016" .. push1 .. set
	if sets then
		body = body .. push97 .. push1 .. set
	end
	return body .. "\000\000\000\000Killed\000"
end

local PLANE, GUNSHIP, TANK, SCRIPTED = 1, 2, 3, 4

local function aircraft(opts)
	opts = opts or {}
	local files = {
		["scripts/plane.cob"] = cob(false),
		["scripts/gunship.cob"] = cob(false),
		["scripts/tank.cob"] = cob(false),
		["scripts/scripted.cob"] = cob(true),
		["luarules/gadgets/coilbox_compat_aircraft_crash.lua"] = "Spring.SetUnitCrashing(1, true)",
		["luarules/gadgets/game_rules.lua"] = "return {}",
	}
	for path, text in pairs(opts.files or {}) do
		files[path] = text or nil
	end
	return load(CRASH, {
		synced = opts.synced,
		files = files,
		random = opts.random,
		unitDefs = opts.unitDefs or {
			[PLANE] = { isStrafingAirUnit = true, scriptName = "scripts/plane.cob" },
			[GUNSHIP] = { isStrafingAirUnit = false, scriptName = "scripts/gunship.cob" },
			[TANK] = { scriptName = "scripts/tank.cob" },
			[SCRIPTED] = { isStrafingAirUnit = true, scriptName = "scripts/scripted.cob" },
		},
	})
end

do
	local engine = aircraft({ synced = false })
	check("crash: has no unsynced half", engine.returned == false)
end

do
	local engine = aircraft()
	check("crash: stays on for a plane whose script never sets CRASHING", not engine.removed)
end

do
	local engine = aircraft({ unitDefs = { [GUNSHIP] = { isStrafingAirUnit = false, scriptName = "scripts/gunship.cob" } } })
	check("crash: turns off in a game with no planes", engine.removed)
end

do
	local engine = aircraft({ unitDefs = { [SCRIPTED] = { isStrafingAirUnit = true, scriptName = "scripts/scripted.cob" } } })
	check("crash: turns off when every plane's COB script sets CRASHING", engine.removed)
end

do
	local engine = aircraft({
		files = { ["scripts/plane.lua"] = "Spring.UnitScript.SetUnitValue(COB.CRASHING, 1)" },
		unitDefs = { [PLANE] = { isStrafingAirUnit = true, scriptName = "scripts/plane.lua" } },
	})
	check("crash: turns off when every plane's Lua script sets CRASHING", engine.removed)
end

do
	local engine = aircraft({ files = { ["luarules/gadgets/unit_crash.lua"] = "Spring.SetUnitCrashing(unitID, true)" } })
	check("crash: turns off when the game's LuaRules crashes planes itself", engine.removed)
end

do
	local engine = aircraft({ files = { ["scripts/plane.cob"] = false } })
	check("crash: a plane whose script cannot be read is crashed", not engine.removed)
end

-- Lines from the games' own LuaRules, cut down to what the gadget reads.
do
	local engine = aircraft({
		files = {
			["luarules/gadgets/unit_airbase.lua"] = "local upitch, uyaw, uroll = Spring.GetUnitRotation(unitID)",
			["luarules/gadgets/mex_spot_finder.lua"] =
				'Spring.Log(gadget:GetInfo().name, LOG.INFO, "Mex Spot Finder Initialising")',
		},
	})
	check("crash: turns off for Balanced Annihilation 15.9.8, whose gadgets call functions 0.82 did not have",
		engine.removed)
end

do
	local engine = aircraft({
		files = {
			["luarules/gadgets/unit_dynamic_collision_volume.lua"] = table.concat({
				"--[[ unsupported by engine ATM, same as for 3DO units, but for features",
				"function gadget:FeatureCreated(featureID, allyTeam)",
				"\tlocal xs, ys, zs = Spring.GetFeatureCollisionVolumeData(featureID)",
				"end",
				"]]--",
				"local xs, ys, zs = Spring.GetUnitCollisionVolumeData(unitID)",
			}, "\n"),
			["luarules/gadgets/unit_spawner.lua"] = "gameMode = 'normal' --Spring.GetModOption(\"gamemode\")",
			["luarules/deploy/main.lua"] = 'if (Spring.GetModOption("gamemode")=="tactics") then end',
		},
	})
	check("crash: stays on for XTA 9.65, whose gadgets call nothing newer outside comments and other folders",
		not engine.removed)
end

do
	local engine = aircraft({
		files = {
			["luarules/main.lua"] = "function Spring.GetModOption(s, bool, default) end",
			["luarules/gadgets/start_unit_setup.lua"] =
				'local startMode = Spring.GetModOption("startingresourcetype", false, "facplopboost")',
		},
	})
	check("crash: stays on when the newer name is one the game defines itself", not engine.removed)
end

do
	local engine = aircraft({
		files = { ["luarules/gadgets/coilbox_compat_aircraft_crash.lua"] = "Spring.GetUnitRotation(1)" },
	})
	check("crash: does not count its own file as the game's", not engine.removed)
end

-- The mutator's modinfo.lua as the engine hands it to the gadget: the base
-- game's name and version under compatbasename and compatbaseversion. The
-- values are the ones in the games' own modinfo.lua (name_pure and version).
local function modinfo(name, version)
	return function()
		return { name = name .. " (compat 7)", version = "7", compatbasename = name, compatbaseversion = version }
	end
end

local function crashWithModinfo(name, version, file)
	return load(file or CRASH, {
		files = {
			["modinfo.lua"] = modinfo(name, version),
			["scripts/plane.cob"] = cob(false),
		},
		unitDefs = { [PLANE] = { isStrafingAirUnit = true, scriptName = "scripts/plane.cob" } },
	})
end

do
	check("crash: turns off for Expand and Exterminate 0.46, made for Spring 0.88",
		crashWithModinfo("Expand and Exterminate", "0.46 for Spring 0.88").removed)
	check("crash: the earlier fix is unchanged and stays on for it",
		not crashWithModinfo("Expand and Exterminate", "0.46 for Spring 0.88", "gadget-aircraft-crash-83-v2.lua").removed)
	check("crash: stays on for XTA 9.65", not crashWithModinfo("XTA", "9.65").removed)
	check("crash: stays on for Complete Annihilation stable-8405",
		not crashWithModinfo("Complete Annihilation stable-8405", "stable-8405").removed)
	check("crash: stays on for Spring 1944 2.31, whose name has a number that is not an engine's",
		not crashWithModinfo("Spring 1944", "2.31").removed)
end

do
	for _, version in ipairs({ "1.2 for Spring 0.88", "for spring 85", "Spring 0.83", "r5 FOR SPRING 91.0", "3.1 (Spring v94.1)" }) do
		check("crash: turns off for a version that reads '" .. version .. "'",
			crashWithModinfo("Some Game", version).removed)
	end
	check("crash: turns off when the name gives the engine", crashWithModinfo("Some Game for Spring 0.88", "1").removed)
	for _, version in ipairs({
		"9.65", "0.46", "83", "stable-8405", "for Spring 0.82.7.1", "Spring 0.75", "for Spring 8", "Springfield 90",
		"Spring 1944", "for Spring", "", "Spring 83abc", "Springs 90",
	}) do
		check("crash: stays on for a version that reads '" .. version .. "'",
			not crashWithModinfo("Some Game", version).removed)
	end
end

do
	local function with(modinfoFile)
		return aircraft({ files = { ["modinfo.lua"] = modinfoFile } })
	end
	check("crash: a modinfo.lua without the base game's values is no sign",
		not with(function() return { name = "G (compat 7)", version = "for Spring 0.88" } end).removed)
	check("crash: a modinfo.lua the engine cannot include is no sign",
		not with(function() error("boom") end).removed)
	check("crash: a modinfo.lua that returns no table is no sign", not with(function() return "x" end).removed)
	check("crash: values that are not strings are no sign",
		not with(function() return { compatbasename = 5, compatbaseversion = {} } end).removed)
end

do
	-- The threshold is 0.7 * 120 / 100 + 0.2 = 1.04, which no random number
	-- from 0 to 1 is above.
	local engine = aircraft({ random = { 0.99 } })
	engine.units[10] = { unitDefID = PLANE, health = -20, maxHealth = 100 }
	call(engine, "UnitDamaged", 10, PLANE, 0, 120, false)
	check("crash: a plane hit far past its health dies", not engine.crashing[10])
end

do
	local engine = aircraft({ random = { 0.75, 0.74 } })
	engine.units[11] = { unitDefID = PLANE, health = 50, maxHealth = 100 }
	call(engine, "UnitDamaged", 11, PLANE, 0, 50, false)
	check("crash: a hit that leaves health does nothing", not engine.crashing[11] and engine.units[11].health == 50)

	-- 50 ten frames ago is 50 * 0.9^10, about 17.43, so with this hit of 60 the
	-- threshold is 0.7 * 77.43 / 100 + 0.2, about 0.742.
	engine.frame = 10
	engine.units[11].health = -10
	call(engine, "UnitDamaged", 11, PLANE, 0, 60, false)
	check("crash: a dying plane above the threshold crashes", engine.crashing[11] == true)
	check("crash: and is given half its health back", engine.health[11] == 50, tostring(engine.health[11]))

	engine.units[12] = { unitDefID = PLANE, health = 50, maxHealth = 100 }
	call(engine, "UnitDamaged", 12, PLANE, 0, 50, false)
	engine.frame = 20
	engine.units[12].health = -10
	call(engine, "UnitDamaged", 12, PLANE, 0, 60, false)
	check("crash: a dying plane below the threshold dies", not engine.crashing[12] and engine.health[12] == nil)
	check("crash: the random numbers were used once for each death", #engine.random == 0, tostring(#engine.random))
end

do
	local engine = aircraft({ random = {} })
	engine.units[13] = { unitDefID = PLANE, health = 0, maxHealth = 100 }
	call(engine, "UnitDamaged", 13, PLANE, 0, 100, true)
	engine.units[14] = { unitDefID = PLANE, health = -5, maxHealth = 100, beingBuilt = true }
	call(engine, "UnitDamaged", 14, PLANE, 0, 10, false)
	engine.units[15] = { unitDefID = SCRIPTED, health = -5, maxHealth = 100 }
	call(engine, "UnitDamaged", 15, SCRIPTED, 0, 10, false)
	engine.units[16] = { unitDefID = GUNSHIP, health = -5, maxHealth = 100 }
	call(engine, "UnitDamaged", 16, GUNSHIP, 0, 10, false)
	check("crash: paralysing damage, a plane being built, a plane that crashes itself and a gunship are left alone",
		next(engine.crashing) == nil)
end

do
	local engine = aircraft({ random = { 0.9 } })
	engine.units[17] = { unitDefID = PLANE, health = -5, maxHealth = 100, landed = true }
	call(engine, "UnitDamaged", 17, PLANE, 0, 10, false)
	check("crash: a plane the engine will not crash keeps its health", engine.health[17] == nil)
end

do
	local engine = aircraft({ random = { 0.5 } })
	engine.units[18] = { unitDefID = PLANE, health = 10, maxHealth = 100 }
	call(engine, "UnitDamaged", 18, PLANE, 0, 90, false)
	call(engine, "UnitDestroyed", 18, PLANE, 0)
	-- A new unit with the same ID starts with no recent damage, so the
	-- threshold is 0.7 * 10 / 100 + 0.2 = 0.27, below 0.5.
	engine.units[18] = { unitDefID = PLANE, health = -5, maxHealth = 100 }
	call(engine, "UnitDamaged", 18, PLANE, 0, 10, false)
	check("crash: a destroyed unit's recent damage is forgotten", engine.crashing[18] == true)
end

--------------------------------------------------------------------------------
-- onlyForward aim
--------------------------------------------------------------------------------

local FORWARD = "gadget-only-forward-aim-105.lua"

local function forward(opts)
	opts = opts or {}
	local engine = load(FORWARD, {
		synced = opts.synced,
		unitDefs = opts.unitDefs or {
			[1] = { weapons = { { weaponDef = 10 }, { weaponDef = 11 }, { weaponDef = 10 } } },
			[2] = { weapons = { { weaponDef = 11 } } },
			[3] = { weapons = {} },
		},
		weaponDefs = { [10] = { onlyForward = true }, [11] = { onlyForward = false } },
	})
	return engine
end

do
	check("forward: has no unsynced half", forward({ synced = false }).returned == false)
	local off = forward({ unitDefs = { [2] = { weapons = { { weaponDef = 11 } } } } })
	check("forward: turns off in a game with no onlyForward weapon", off.removed)
end

do
	local engine = forward()
	check("forward: stays on in a game with an onlyForward weapon", not engine.removed)
	call(engine, "UnitCreated", 100, 1, 0)
	call(engine, "UnitCreated", 101, 2, 0)
	call(engine, "UnitCreated", 102, 3, 0)
	call(engine, "GameFrame", 1)
	table.sort(engine.weaponStates)
	check("forward: each frame, every onlyForward weapon is made ready to fire and no other",
		table.concat(engine.weaponStates, " ") == "100:1:aimReady=1 100:3:aimReady=1",
		table.concat(engine.weaponStates, " "))

	engine.weaponStates = {}
	call(engine, "UnitDestroyed", 100, 1, 0)
	call(engine, "GameFrame", 2)
	check("forward: a destroyed unit is left alone", #engine.weaponStates == 0, table.concat(engine.weaponStates, " "))
end

do
	-- A unit already on the map when the gadget loads, as after /luarules reload.
	local engine = load(FORWARD, {
		unitDefs = { [1] = { weapons = { { weaponDef = 10 } } } },
		weaponDefs = { [10] = { onlyForward = true } },
		spring = {},
	})
	engine.units[7] = { unitDefID = 1 }
	call(engine, "Initialize")
	call(engine, "GameFrame", 1)
	check("forward: a unit there before the gadget loaded is covered", engine.weaponStates[1] == "7:1:aimReady=1", tostring(engine.weaponStates[1]))
end

--------------------------------------------------------------------------------
-- messages.tdf
--------------------------------------------------------------------------------

local MESSAGES = "gadget-messages-tdf-95.lua"

-- What the engine's gamedata/parse_tdf.lua returns for XTA 9.65's file: the
-- section and line names in lower case, the translations under keys of their
-- own.
local XTA = {
	messages = {
		["team%i(%s) is no more"] = {
			tr1 = "Team%i(%s) has been obliterated",
			tr2 = "Team%i(%s) is now an ex-Team%i(%s)",
			tr3 = "",
		},
	},
}

local function messages(opts)
	opts = opts or {}
	local files = {
		["gamedata/messages.tdf"] = "[messages] {}",
		["gamedata/parse_tdf.lua"] = function()
			return {
				Parse = function(path)
					assert(path == "gamedata/messages.tdf", path)
					if opts.parsed == nil then
						return nil, "line 3: unexpected }"
					end
					return opts.parsed
				end,
			}
		end,
	}
	for path, value in pairs(opts.files or {}) do
		files[path] = value or nil
	end
	return load(MESSAGES, {
		synced = opts.synced == true,
		files = files,
		random = opts.random,
		teams = { [1] = { leader = 4 }, [2] = { leader = -1 }, [3] = { leader = 9 } },
		players = { [4] = "Alice" },
	})
end

do
	check("messages: has no synced half", messages({ synced = true, parsed = XTA }).returned == false)
	local off = messages({ parsed = XTA, files = { ["gamedata/messages.tdf"] = false } })
	check("messages: turns off in a game with no gamedata/messages.tdf", off.removed)
end

do
	local engine = messages({ parsed = XTA, random = { 0, 0.99 } })
	check("messages: stays on in a game with gamedata/messages.tdf", not engine.removed and #engine.logs == 0, table.concat(engine.logs, "; "))
	call(engine, "TeamDied", 1)
	call(engine, "TeamDied", 1)
	check("messages: a death is announced with a translation the game gives for the old line",
		engine.echoes[1] == "Team1(Alice) has been obliterated", tostring(engine.echoes[1]))
	check("messages: every %i and %s in a translation is filled in",
		engine.echoes[2] == "Team1(Alice) is now an ex-Team1(Alice)", tostring(engine.echoes[2]))
end

do
	local engine = messages({ parsed = XTA })
	call(engine, "TeamDied", 2)
	call(engine, "TeamDied", 3)
	check("messages: a team with no leader is announced in the engine's words",
		engine.echoes[1] == "Team 2 is no more", tostring(engine.echoes[1]))
	check("messages: so is a team whose leader the engine cannot name",
		engine.echoes[2] == "Team 3 is no more", tostring(engine.echoes[2]))
end

do
	local engine = messages({
		parsed = { messages = { ["Team %i (lead by %s) is no more"] = { a = "%s lost team %i, 100%% gone" } } },
		random = { 0.5 },
	})
	call(engine, "TeamDied", 1)
	check("messages: the 83.0 to 94.1 line is found without regard to case",
		engine.echoes[1] == "Alice lost team 1, 100% gone", tostring(engine.echoes[1]))
end

do
	local engine = messages({ parsed = { messages = { other = { a = "x" } } } })
	call(engine, "TeamDied", 1)
	check("messages: a line the game does not translate is announced in the engine's words",
		engine.echoes[1] == "Team 1 (lead by Alice) is no more", tostring(engine.echoes[1]))
end

do
	-- Balanced Annihilation's gamedata/messages.lua returns an empty table to
	-- keep the engine's words.
	local engine = messages({
		parsed = XTA,
		files = {
			["gamedata/messages.lua"] = function()
				return { ["TEAM %I IS NO MORE"] = { "Gone: %i", "" , "never" } }
			end,
		},
		random = { 0 },
	})
	call(engine, "TeamDied", 1)
	call(engine, "TeamDied", 2)
	check("messages: the game's own gamedata/messages.lua is used before the .tdf",
		engine.echoes[1] == "Team 1 (lead by Alice) is no more", tostring(engine.echoes[1]))
	check("messages: and its lines are read up to the first empty one",
		engine.echoes[2] == "Gone: 2", tostring(engine.echoes[2]))
end

do
	local engine = messages({ parsed = nil })
	check("messages: a file the parser cannot read is logged and turns the gadget off",
		engine.removed and #engine.logs == 1 and engine.logs[1]:find("unexpected }", 1, true) ~= nil,
		table.concat(engine.logs, "; "))
	local noSection = messages({ parsed = { other = {} } })
	check("messages: so is a file with no [messages] section", noSection.removed and #noSection.logs == 1)
end

--------------------------------------------------------------------------------
-- modelCenterOffset
--------------------------------------------------------------------------------

local OFFSET = "gadget-model-center-offset-89.lua"

local CENTRED, PLAIN = 1, 2

local function centred(opts)
	opts = opts or {}
	local moved = {}
	local engine = load(OFFSET, {
		synced = opts.synced,
		unitDefs = opts.unitDefs or {
			[CENTRED] = { customParams = { modelcenteroffset = "0 -5 2.5" } },
			[PLAIN] = { customParams = {} },
		},
		spring = {
			GetUnitDefDimensions = function(unitDefID)
				return { midx = 1, midy = 10, midz = unitDefID }
			end,
			SetUnitMidAndAimPos = function(unitID, mx, my, mz, ax, ay, az, relative)
				moved[#moved + 1] = { unitID, mx, my, mz, ax, ay, az, relative }
				return true
			end,
			GetAllUnits = function()
				return opts.existing or {}
			end,
			GetUnitDefID = function()
				return CENTRED
			end,
		},
	})
	engine.moved = moved
	return engine
end

do
	local engine = centred({ synced = false })
	check("offset: has no unsynced half", engine.returned == false)
end

do
	local engine = centred({ unitDefs = { [PLAIN] = { customParams = {} }, [3] = { customParams = { modelcenteroffset = "1 2" } } } })
	check("offset: turns off in a game with no def that has the parameter", engine.removed)
end

do
	local engine = centred()
	check("offset: stays on when a def has the parameter", not engine.removed)
	call(engine, "UnitCreated", 7, CENTRED)
	call(engine, "UnitCreated", 8, PLAIN)
	local m = engine.moved
	check("offset: one unit is moved", #m == 1, tostring(#m))
	check("offset: its middle is the model's middle plus the offset",
		m[1] and m[1][1] == 7 and m[1][2] == 1 and m[1][3] == 5 and m[1][4] == 3.5)
	check("offset: its aim point is its middle, in its own space",
		m[1] and m[1][5] == 1 and m[1][6] == 5 and m[1][7] == 3.5 and m[1][8] == true)
end

do
	local engine = centred({ existing = { 4 } })
	check("offset: a unit there before the gadget loaded is moved", #engine.moved == 1 and engine.moved[1][1] == 4)
end

support.report()
