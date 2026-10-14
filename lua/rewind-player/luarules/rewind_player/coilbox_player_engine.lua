-- Coilbox rewind player: what the player needs from the engine (issue #3802).
--
-- Replay rewind plays a match back on the engine it was recorded on, which may
-- be an old one. An old engine can lack a call the player uses, and the wrong
-- outcome is a Lua error half way through a match. So this file lists every
-- call the player depends on, in rows. When the gadget loads it checks each
-- row. A row with a call missing switches off the one feature that hangs on it
-- and the rest plays. A row marked required refuses to start playback.
--
-- A row is a table:
--
--   id        the name the stages read: `engine.on[id]` is false when it is off
--   feature   what hangs on the calls, as the log and the timeline's note name it
--   calls     the dotted names that must all be there
--   how       "presence" when having the calls is the whole check, and
--             "behaviour" when a call that is there can still act differently
--             and the player checks that where it uses the call
--   where     for a row checked by behaviour, where the player checks it
--   used      the file and function that use the calls
--   required  true when the player cannot work without it
--   since     the oldest engine tag read that has the calls (see below)
--   without   what the player does on an engine without them
--   visible   whether a viewer can tell it is missing, which is whether the
--             timeline's note names it
--
-- A new stage adds its calls here. A test reads the source of every file under
-- luarules/ and luaui/ and fails for an engine call that has no row, and for a
-- row whose call nothing uses. Other tests take a call out of the engine
-- stand-in for each call of each row, so a row is tested when it is added.
--
-- `since` was read from the engine's source (rts/Lua, the registration of each
-- name) at the tags 105.0, 105.1.1, 2025.01.6 and 2026.07.04, and agrees with
-- the spike on issue #3791, which read ten tags. The camera and drawing calls
-- of the `view` and `arrivalEffect` rows were read at those and at 2025.03.9,
-- and those of the `nanoPieces`, `buildStream` and `workerAnswer` rows at all
-- five. A name found at 105.0 is given
-- as 105.0. No older engine was read, so the player does not say that one older
-- lacks it. The rows of the resources stage (issue #3982) were read at 105.0,
-- 105.1.1, 2025.01.6, 2025.03.9 and 2026.07.04, and the one call that is not at
-- all five, Spring.AddTeamResourceExcessStats, at every tag of 2025 and 2026:
-- 2026.07.01 is the first that has it. None of the older paths has run in an engine: no engine before
-- 2025.03.9 is installed, so they are tested on the stand-in in
-- tests/engine.lua only.
--
-- The unsynced half of a gadget has its own `Spring`, and the timeline widget
-- has `gl`, `GL` and the unsynced `Spring`. The synced gadget cannot look at
-- those, so the unsynced half has a list here and the widget has one in
-- luaui/rewind_timeline/coilbox_timeline_engine.lua, in the same shape.

local M = {}

--- The game rules parameter the timeline shows as its note.
M.NOTE_PARAM = "coilbox_rewind_note"

--- Calls the player cannot check, since it cannot report without them.
M.ASSUMED = { "Spring.Echo", "VFS.Include" }

--- Calls the guard gadget replaces and does not call.
M.REPLACED = { "Spring.KillTeam", "Spring.GameOver" }

--- Calls that are there on every engine read and act differently on some. The
-- player does not use them. A presence check cannot tell the two behaviours
-- apart, so a stage that needs one has to check what it does.
M.AVOID = {
	{
		call = "Spring.SetUnitPieceMatrix",
		why = "up to 2025.06.05 it stores the matrix and blocks the script from the piece, and from 2025.06.06 it drops the matrix and only blocks",
	},
	{
		call = "Spring.SetUnitDirection",
		why = "it takes a front only at 2025.01.6, and a front and an optional right from 2025.03.9. The player turns a unit with Spring.MoveCtrl.SetRotation, which every engine read has",
	},
	{
		call = "Spring.SetFeatureDirection",
		why = "it changed with Spring.SetUnitDirection. The player turns a feature with Spring.SetFeatureRotation",
	},
	{
		call = "Spring.GetFeatureDirection",
		why = "it gives 3 numbers up to 105.1.1-2590 and 9 numbers after it",
	},
}

--- Rows for the synced half of the gadget, in the order they are logged.
M.SYNCED = {
	{
		id = "track",
		feature = "reading the track",
		calls = {
			"VFS.UnpackU8",
			"VFS.UnpackU16",
			"VFS.UnpackS16",
			"VFS.UnpackU32",
			"VFS.UnpackS32",
			"VFS.UnpackF32",
			"VFS.ZlibDecompress",
			"VFS.LoadFile",
		},
		how = "presence",
		used = "coilbox_track.lua and coilbox_track_fetch.lua",
		required = true,
		since = "105.0",
		without = "Playback does not start",
		visible = false,
	},
	{
		id = "world",
		feature = "the clock and the teams",
		calls = {
			"Spring.GetModOptions",
			"Spring.GetGaiaTeamID",
			"Spring.GetTeamList",
			"Spring.GetAllyTeamList",
			"Spring.SetGameRulesParam",
		},
		how = "presence",
		used = "coilbox_player.lua, Player.new and publish",
		required = true,
		since = "105.0",
		without = "Playback does not start",
		visible = false,
	},
	{
		id = "units",
		feature = "creating and placing units",
		calls = {
			"Spring.CreateUnit",
			"Spring.DestroyUnit",
			"Spring.ValidUnitID",
			"Spring.GetUnitIsDead",
			"Spring.GetAllUnits",
			"Spring.GetUnitHealth",
			"Spring.SetUnitHealth",
			"Spring.SetUnitMaxHealth",
			"Spring.MoveCtrl.Enable",
			"Spring.MoveCtrl.SetPosition",
			"Spring.MoveCtrl.SetRotation",
			"Game.constructionDecay",
			"Game.constructionDecaySpeed",
		},
		how = "presence",
		used = "coilbox_player_units.lua",
		required = true,
		since = "105.0",
		without = "Playback does not start",
		visible = false,
	},
	{
		id = "aimPoses",
		feature = "unit aiming",
		calls = { "Spring.UnitScript.CallAsUnit", "Spring.UnitScript.Turn", "Spring.UnitScript.Move", "Spring.GetUnitScriptNames" },
		how = "behaviour",
		where = "coilbox_player_aim.lua. The stage poses from gadget:GameFramePost, and the gadget installs the global when the game's handler does not pass the call-in on (the frameEnd row). On an engine with no GameFramePost (105.0 and 105.1.1) it poses from GameFrame and gives a posed unit no target",
		used = "coilbox_player_aim.lua",
		required = false,
		since = "105.0",
		without = "Units hold the pose the engine's own script gives them",
		visible = true,
	},
	{
		id = "unitScripts",
		feature = "walking and building animation",
		calls = { "Spring.UnitScript.CreateScript", "Spring.CallCOBScript", "Spring.GetCOBScriptID", "Spring.GetUnitPosition" },
		how = "behaviour",
		where = "coilbox_player_animation.lua, learn. A unit whose call-ins a game's script framework handed to the engine with Spring.UnitScript.CreateScript, which the gadget wraps as its file loads, has a Lua script, and a call-in is run with Spring.UnitScript.CallAsUnit. Any other unit is asked for the number of each function with Spring.GetCOBScriptID, which gives nothing for a unit with no COB script, and a function it has is run with Spring.CallCOBScript, which raises for a unit with no COB script. A unit that is neither is told nothing",
		used = "coilbox_rewind_player.lua, the wrap of CreateScript, and coilbox_player_animation.lua",
		required = false,
		since = "105.0",
		without = "Units slide with their legs and wheels still, and a builder's script is not told that it builds",
		visible = true,
	},
	{
		id = "unitSpeed",
		feature = "unit speed",
		calls = { "Spring.MoveCtrl.SetExtrapolate", "Spring.MoveCtrl.SetVelocity" },
		how = "presence",
		used = "coilbox_player_animation.lua, learn and move",
		required = false,
		since = "105.0",
		without = "A unit's speed reads as nothing, to its own script and to anything else that asks the engine",
		visible = false,
	},
	{
		id = "walkPieces",
		feature = "leaving a walk's pieces to the script",
		calls = { "Spring.UnitScript.IsInTurn", "Spring.UnitScript.IsInMove" },
		how = "presence",
		used = "coilbox_player_animation.lua, the two probes of M.new",
		required = false,
		since = "105.0",
		without = "A piece the track has poses for that a unit's walk also turns follows the track, out of step with the rest of the walk",
		visible = false,
	},
	{
		id = "builderWork",
		feature = "builder work for a game's build effect",
		calls = { "Spring.SetUnitRulesParam", "CMD.REPAIR", "CMD.RECLAIM", "CMD.RESURRECT", "CMD.CAPTURE", "CMD.RESTORE", "Game.maxUnits" },
		how = "presence",
		used = "coilbox_player_animation.lua, labour and build",
		required = false,
		since = "105.0",
		without = "The unit rules parameters that hold a builder's recorded work are not set",
		visible = false,
	},
	{
		id = "nanoPieces",
		feature = "the nano pieces a build stream starts at",
		calls = { "Spring.SetUnitNanoPieces", "Spring.GetUnitNanoPieces", "Spring.GetUnitScriptPiece" },
		how = "presence",
		used = "coilbox_player_animation.lua, nanoPieces",
		required = false,
		since = "105.0",
		without = "A builder whose script does not give its own nano pieces has none, so it shows no build stream, and nor does a game's own build effect that reads them",
		visible = false,
	},
	{
		id = "frameEnd",
		feature = "installing the end of frame call-in",
		calls = { "Script.UpdateCallIn" },
		how = "behaviour",
		where = "coilbox_player.lua, lookBack. Whether gadget:GameFramePost comes is found by whether it came after the frame before. When it did not, the gadget puts a global of that name in the handler's table and tells the engine with Script.UpdateCallIn, and the player gives that one frame. On an engine with no GameFramePost (105.0 and 105.1.1) nothing comes of it, and the units, resources and aim stages each say what they do without the call",
		used = "coilbox_rewind_player.lua, installFramePost",
		required = false,
		since = "105.0",
		without = "In a game whose gadget handler does not pass GameFramePost on, a wounded unit can heal for a frame, what a team holds reads a frame off and a unit's own script can move an aiming piece after it was posed",
		visible = false,
	},
	{
		id = "terrain",
		feature = "ground changes",
		calls = { "Spring.SetHeightMapFunc", "Spring.SetHeightMap", "Game.squareSize" },
		how = "presence",
		used = "coilbox_player_terrain.lua",
		required = false,
		since = "105.0",
		without = "The ground stays as the map has it",
		visible = true,
	},
	{
		id = "terrainOrigin",
		feature = "the map's own ground",
		calls = { "Spring.GetGroundOrigHeight" },
		how = "presence",
		used = "coilbox_player_terrain.lua",
		required = false,
		since = "105.0",
		without = "A corner before its first change takes the track's height for it, which is in position steps and can be up to half a step from the map's own",
		visible = false,
	},
	{
		id = "features",
		feature = "wrecks and rocks",
		calls = { "Spring.CreateFeature", "Spring.DestroyFeature", "Spring.ValidFeatureID", "Spring.GetAllFeatures" },
		how = "presence",
		used = "coilbox_player_features.lua",
		required = false,
		since = "105.0",
		without = "No feature of the track is shown, and the engine's own are left where they are",
		visible = true,
	},
	{
		id = "featureTurn",
		feature = "feature turns",
		calls = { "Spring.SetFeatureRotation" },
		how = "presence",
		used = "coilbox_player_features.lua, Features:create",
		required = false,
		since = "105.0",
		without = "Features stand unturned",
		visible = true,
	},
	{
		id = "sight",
		feature = "full sight",
		calls = { "Spring.SetGlobalLos" },
		how = "presence",
		used = "coilbox_player.lua, Player.new",
		required = false,
		since = "105.0",
		without = "The fog of war is not lifted for any team",
		visible = true,
	},
	{
		id = "holdFire",
		feature = "holding fire",
		calls = { "Spring.SetUnitUseWeapons" },
		how = "presence",
		used = "coilbox_player_units.lua, Units:create",
		required = false,
		since = "105.0",
		without = "Units may fire their own weapons. They do no damage",
		visible = true,
	},
	{
		id = "onOff",
		feature = "unit on and off",
		calls = { "Spring.GetUnitIsActive", "Spring.GiveOrderToUnit", "CMD.ONOFF" },
		how = "presence",
		used = "coilbox_player_units.lua, Units:applyStatus",
		required = false,
		since = "105.0",
		without = "Units keep the on or off state they were created with",
		visible = true,
	},
	{
		id = "rebuild",
		feature = "construction after a seek",
		calls = { "Spring.GetUnitIsStunned" },
		how = "behaviour",
		where = "coilbox_player_units.lua, Units:applyStatus. After Spring.SetUnitHealth with a build progress below 1 it asks the unit's being built flag, and a unit still finished is destroyed and created again as a nanoframe. Spring.GetUnitIsBeingBuilt is not registered at 105.0",
		used = "coilbox_player_units.lua, Units:applyStatus",
		required = false,
		since = "105.0",
		without = "A building seeked back to its construction can show as finished on an engine before 2025.03.9",
		visible = true,
	},
	{
		id = "shots",
		feature = "shots",
		calls = {
			"Spring.SpawnProjectile",
			"Spring.SetProjectileMoveControl",
			"Spring.SetProjectileDamages",
			"Spring.SetProjectilePosition",
			"Spring.SetProjectileVelocity",
			"Spring.GetProjectileTimeToLive",
			"Spring.GetProjectileDirection",
			"Spring.DeleteProjectile",
			"Spring.GetGroundHeight",
			"Game.armorTypes",
		},
		how = "presence",
		used = "coilbox_player_projectiles.lua",
		required = false,
		since = "105.0",
		without = "No shot is shown. A shot made without Spring.SetProjectileDamages would do damage",
		visible = true,
	},
	{
		id = "shotHandover",
		feature = "handing a shot back to the engine",
		calls = { "Spring.SetProjectileTimeToLive" },
		how = "presence",
		used = "coilbox_player_projectiles.lua, Projectiles:release",
		required = false,
		since = "2025.03.9",
		without = "A shot stays under move control for the engine's one look and is deleted on the next frame if it hit nothing, so a shell that ended in the air shows no burst and a laser bolt that hit nothing stays whole until its last frame",
		visible = false,
	},
	{
		id = "hiddenBursts",
		feature = "hiding the burst of a shot the engine ends while it is held",
		calls = { "Script.SetWatchExplosion" },
		how = "presence",
		used = "coilbox_player_projectiles.lua, Projectiles.new and Projectiles:explosion",
		required = false,
		since = "105.0",
		without = "A shot the engine ends while the player holds it, where the match had nothing in its way, bursts with the game's impact effect at a time and place the match had none",
		visible = true,
	},
	{
		id = "sound",
		feature = "fire sounds",
		calls = { "Spring.PlaySoundFile", "Game.gameSpeed" },
		how = "presence",
		used = "coilbox_player_projectiles.lua, Projectiles.new and Projectiles:sound",
		required = false,
		since = "105.0",
		without = "Weapons fire without a sound",
		visible = false,
	},
	{
		id = "resources",
		feature = "team resources",
		calls = { "Spring.SetTeamResource", "Spring.SetTeamShareLevel" },
		how = "presence",
		used = "coilbox_player_resources.lua, apply",
		required = false,
		since = "105.0",
		without = "Each team's metal, energy, storage and share level are the playback's own and not the match's",
		visible = true,
	},
	{
		id = "resourceRates",
		feature = "team income and expense",
		calls = {
			"Spring.GetGameFrame",
			"Spring.GetTeamResources",
			"Spring.GetTeamInfo",
			"Spring.AddTeamResource",
			"Spring.UseTeamResource",
		},
		how = "presence",
		used = "coilbox_player_resources.lua, feed and settle",
		required = false,
		since = "105.0",
		without = "Each team's income, expense and pull are the playback's own and not the match's",
		visible = true,
	},
	{
		id = "resourceExcess",
		feature = "team excess",
		calls = { "Spring.AddTeamResourceExcessStats" },
		how = "presence",
		used = "coilbox_player_resources.lua, settle",
		required = false,
		since = "2026.07.01",
		without = "The resources a team wasted read as the playback's own, which is none",
		visible = false,
	},
	{
		id = "teamParams",
		feature = "the game's own team numbers",
		calls = { "Spring.SetTeamRulesParam" },
		how = "presence",
		used = "coilbox_player_resources.lua, apply",
		required = false,
		since = "105.0",
		without = "The team rules parameters a game's adapter names are the playback's own and not the match's",
		visible = true,
	},
	{
		id = "workTiming",
		feature = "timing a frame's work",
		calls = { "SendToUnsynced" },
		how = "presence",
		used = "coilbox_rewind_player.lua, gadget:GameFrame and the arrive function of gadget:Initialize",
		required = false,
		since = "105.0",
		without = "The slow frame line is not logged, a seek is shown in one frame, units are made in the order of the track's list and no arrival effect is shown",
		visible = false,
	},
	{
		id = "adapter",
		feature = "the game adapter",
		calls = { "VFS.FileExists" },
		how = "presence",
		used = "coilbox_player_adapter.lua, M.load",
		required = false,
		since = "105.0",
		without = "No adapter is read, so no unit or feature is hidden and no hook runs",
		visible = true,
	},
}

--- Rows for the unsynced half of the gadget.
M.UNSYNCED = {
	{
		id = "workTimingLine",
		feature = "the slow frame line",
		calls = { "Spring.GetTimer", "Spring.DiffTimers", "Game.gameSpeed" },
		how = "presence",
		used = "coilbox_rewind_player.lua, gadget:RecvFromSynced",
		required = false,
		since = "105.0",
		without = "The slow frame line is not logged and a seek is not spread over frames, so a seek of many units is shown in one frame and there is no arrival effect, which has no clock",
		visible = false,
	},
	{
		id = "microTimer",
		feature = "timing a frame in microseconds",
		calls = { "Spring.GetTimerMicros" },
		how = "presence",
		used = "coilbox_rewind_player.lua, the unsynced half",
		required = false,
		since = "2025.01.6",
		without = "A frame is timed in whole milliseconds, so the cost of each unit, and the budget worked out from it, is coarser",
		visible = false,
	},
	{
		id = "budgetMessage",
		feature = "spreading a seek over frames",
		calls = { "Spring.SendLuaRulesMsg" },
		how = "presence",
		used = "coilbox_rewind_player.lua, retune",
		required = false,
		since = "105.0",
		without = "The budget cannot be sent, so it stays at one unit made and one removed in a frame, and a seek of many units takes that many frames to show. The view cannot be sent either, so units are made in the order of the track's list",
		visible = true,
	},
	{
		id = "enginePace",
		feature = "keeping the engine's own pause and speed to the timeline",
		calls = { "Spring.GetGameSpeed", "Spring.SendCommands" },
		how = "presence",
		used = "coilbox_rewind_player.lua, gadget:Update",
		required = false,
		since = "105.0",
		without = "A game's pause key or speed command stops or speeds the engine, and with it the playback, without the timeline knowing",
		visible = false,
	},
	{
		id = "view",
		feature = "making the units in view first",
		calls = { "Spring.GetViewGeometry", "Spring.TraceScreenRay", "Spring.GetCameraPosition" },
		how = "presence",
		used = "coilbox_player_view.lua, View:poll",
		required = false,
		since = "105.0",
		without = "The units a seek makes are made in the order of the track's list, and an arrival effect is shown for a unit outside the view too",
		visible = false,
	},
	{
		id = "arrivalEffect",
		feature = "the arrival effect",
		calls = {
			"gl.BeginEnd",
			"gl.Vertex",
			"gl.Color",
			"gl.Blending",
			"gl.DepthTest",
			"gl.DepthMask",
			"gl.Texture",
			"GL.QUADS",
			"GL.SRC_ALPHA",
			"GL.ONE",
			"GL.ONE_MINUS_SRC_ALPHA",
			"Spring.GetCameraDirection",
			"Spring.GetUnitRadius",
			"Spring.GetTeamColor",
		},
		how = "presence",
		used = "coilbox_player_arrival.lua",
		required = false,
		since = "105.0",
		without = "A unit that a slow seek makes appears with no effect",
		visible = false,
	},
	{
		id = "buildStream",
		feature = "the stream of build particles",
		-- The drawing calls it shares with the arrival effect are in that row,
		-- and the stream is off without them too.
		calls = {
			"gl.TexCoord",
			"Spring.GetGameRulesParam",
			"Spring.GetFrameTimeOffset",
			"Spring.GetConfigInt",
			"Spring.IsSphereInView",
			"Spring.ValidUnitID",
			"Spring.GetUnitDefID",
			"Spring.GetUnitTeam",
			"Spring.GetUnitNanoPieces",
			"Spring.GetUnitPiecePosDir",
			"Spring.GetUnitPosition",
			"Spring.GetFeaturePosition",
			"Spring.GetFeatureRadius",
			"Game.maxUnits",
			"CMD.REPAIR",
			"CMD.RECLAIM",
			"CMD.RESURRECT",
			"CMD.RESTORE",
		},
		how = "presence",
		used = "coilbox_player_stream.lua",
		required = false,
		since = "105.0",
		without = "A builder at work shows no stream of build particles, and a game's own build effect that asks the engine gets nothing",
		visible = false,
	},
	{
		id = "workerAnswer",
		feature = "answering a game's build effect from the recording",
		calls = { "Spring.GetUnitWorkerTask", "Spring.GetUnitCurrentBuildPower" },
		how = "presence",
		used = "coilbox_rewind_player.lua, the unsynced half",
		required = false,
		since = "2025.01.6",
		without = "A game's own build effect that asks the engine what a builder is doing gets nothing, since no unit of a playback builds",
		visible = false,
	},
}

--- The value at a dotted name, or nil when any part of it is not there.
local function lookup(roots, name)
	local value = roots
	for part in name:gmatch("[^.]+") do
		if type(value) ~= "table" then
			return nil
		end
		value = value[part]
	end
	return value
end

--- The note for the optional rows that are off: the names of those a viewer can
-- tell are missing, the first three of them, and a count of the rest.
local SHOWN = 3
local function noteFor(off)
	local names = {}
	for _, row in ipairs(off) do
		if row.visible then
			names[#names + 1] = row.feature
		end
	end
	if #names == 0 then
		return nil
	end
	local shown = {}
	for i = 1, math.min(SHOWN, #names) do
		shown[i] = names[i]
	end
	local text = "Switched off on this engine: " .. table.concat(shown, ", ")
	if #names > SHOWN then
		text = text .. " and " .. (#names - SHOWN) .. " more"
	end
	return text
end

--- Checks `rows` against the engine. `roots` holds the engine's globals the rows
-- name: for the synced gadget `Spring`, `VFS`, `Game`, `CMD` and
-- `SendToUnsynced`. Gives a table with
--
--   on        by row id, whether its calls are all there
--   lines     what to log, one for each row with a call missing
--   refused   true when a required row has a call missing
--   note      the line for the timeline: why playback cannot start, or what is
--             switched off that a viewer can tell, or nil
function M.check(roots, rows)
	local result = { on = {}, lines = {}, refused = false, note = nil }
	local off = {}
	local blocked, blockedCalls = nil, 0
	for _, row in ipairs(rows) do
		local gone = {}
		for _, call in ipairs(row.calls) do
			if lookup(roots, call) == nil then
				gone[#gone + 1] = call
			end
		end
		result.on[row.id] = #gone == 0
		if #gone > 0 then
			local missing = table.concat(gone, ", ")
			if row.required then
				result.refused = true
				result.lines[#result.lines + 1] = "cannot play: this engine has no "
					.. missing
					.. ". It is needed for "
					.. row.feature
					.. ". Engine "
					.. row.since
					.. " and later have it"
				if not blocked then
					blocked = { row = row, call = gone[1] }
				end
				blockedCalls = blockedCalls + #gone
			else
				off[#off + 1] = row
				result.lines[#result.lines + 1] = "this engine has no "
					.. missing
					.. ". Switched off: "
					.. row.feature
					.. ". "
					.. row.without
					.. ". Engine "
					.. row.since
					.. " and later have it"
			end
		end
	end
	if blocked then
		result.note = "Playback needs engine " .. blocked.row.since .. " or later: no " .. blocked.call
		if blockedCalls > 1 then
			result.note = result.note .. " and " .. (blockedCalls - 1) .. " more"
		end
	else
		result.note = noteFor(off)
	end
	return result
end

--- What a check of an engine with every call gives, for a player made with no
-- check: every feature is on.
M.ALL_ON = setmetatable({}, {
	__index = function()
		return true
	end,
})

return M
