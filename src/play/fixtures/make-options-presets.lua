-- Regenerates optionsPresets.chobby.json.
--
-- The file is written by encoding Lua tables with BYAR-Chobby's own JSON
-- encoder (libs/json.lua, MIT), the one gui_optionpresets_panel.lua saves with.
-- The tables follow what that panel stores: the battle's mod options, the map
-- name, userBattleStatus for each bot (InterfaceSkirmish:AddAi), the start
-- rectangles BattleRoomWindow.GetCurrentStartRects returns, and the
-- multiplayer settings it copies off the battle.
--
-- Run: luajit make-options-presets.lua <path to BYAR-Chobby libs/json.lua> > optionsPresets.chobby.json
local json = dofile(arg[1])

-- Saved from a skirmish: no multiplayer section, bots with colours and sides.
-- The mod options show the same option saved as 0, "0" and false.
local skirmish = {
	Map = "Supreme Isthmus v2.1",
	Modoptions = {
		startmetal = "1000",
		startenergy = 1000,
		ruins = "disabled",
		scav_spawncountmult = 0,
		experimentalextraunits = "0",
		disable_fogofwar = false,
		comrespawn = true,
	},
	Bots = {
		["BARb(1)"] = {
			aiLib = "BARb",
			allyNumber = 1,
			owner = "Tomjn",
			aiVersion = "stable",
			aiOptions = {},
			teamColor = { 0.9, 0.24, 0.2 },
			side = 1,
			handicap = 25,
			isSpectator = false,
		},
		["SimpleAI(2)"] = {
			aiLib = "SimpleAI",
			allyNumber = 1,
			owner = "Tomjn",
			aiVersion = "<not-versioned>",
			aiOptions = { profile = "default" },
			teamColor = { 0.31, 0.55, 1 },
			side = 0,
			isSpectator = false,
		},
	},
	["Start Boxes"] = {
		{ left = 0, top = 0, right = 66, bottom = 200 },
		{ left = 134, top = 0, right = 200, bottom = 200 },
	},
}

-- Saved from a multiplayer room: all five sections. Start boxes for ally team 1
-- only, so the table has a hole and the encoder writes the first entry as null.
local multiplayer = {
	Map = "Full Metal Plate 1.7",
	Modoptions = {
		startmetal = "1000",
		raptor_difficulty = "veryhard",
		tweakdefs = "bG9jYWwgdW5pdERlZnMgPSB7fQ==",
	},
	Bots = {},
	["Start Boxes"] = {
		[2] = { left = 100, top = 40, right = 200, bottom = 160 },
	},
	["Multiplayer Battle Settings"] = {
		locked = false,
		autoBalance = "advanced",
		balanceMode = "skill",
		teamSize = 8,
		nbTeams = 2,
		preset = "team",
	},
}

-- Start boxes held under string keys, the second shape the encoder can produce
-- (a table decoded from an earlier file and saved again).
local keyed = {
	Map = "Comet Catcher Remake 1.8",
	Modoptions = {},
}
keyed["Start Boxes"] = {
	["2"] = { left = "80", top = "82", right = "115", bottom = "117" },
}

-- The encoder writes an object's keys in `pairs` order, which is not fixed, so
-- the three records are encoded one at a time and joined in a fixed order.
local out = {}
for _, entry in ipairs({
	{ "Skirmish 2v2", skirmish },
	{ "Multiplayer coop", multiplayer },
	{ "Keyed boxes", keyed },
}) do
	table.insert(out, '"' .. entry[1] .. '":' .. json.encode(entry[2]))
end
io.write("{" .. table.concat(out, ",") .. "}")
