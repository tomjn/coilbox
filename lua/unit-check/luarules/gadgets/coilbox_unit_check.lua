-- Coilbox unit check: spawns the unit the builder exported, lets it run, says
-- what it found and ends the match (issue #3319).
--
-- Coilbox generates a game that depends on the unit builder's scratch game and
-- runs it headless. This gadget goes into that game with a request file naming
-- the unit. Change it in the coilbox repository under lua/unit-check/. Nothing
-- installs it into a game anybody plays.
--
-- Everything it says goes to the log under its own section, which is what
-- coilbox reads back: `spawned <unit> with <n> pieces`, `done at frame <n>`, and
-- an error for each thing it found wrong.

-- Where coilbox puts the request, inside the generated game.
local REQUEST_FILE = "luarules/configs/coilbox_unit_check_request.lua"

local LOG_SECTION = "coilbox-unit-check"

local DONE_MESSAGE = "coilbox_unit_check_done"

function gadget:GetInfo()
	return {
		name = "Coilbox unit check",
		desc = "Spawns the unit coilbox's builder exported and reports how it loaded.",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		-- After the game's own gadgets, so a unit they act on as it is
		-- created has been acted on before this reads it.
		layer = 2000,
		enabled = true,
	}
end

if gadgetHandler:IsSyncedCode() then
	local request = VFS.FileExists(REQUEST_FILE) and VFS.Include(REQUEST_FILE)
	if type(request) ~= "table" then
		Spring.Log(LOG_SECTION, "error", "no request in " .. REQUEST_FILE)
		return false
	end

	local UNIT_NAME = request.unitName
	local SPAWN_FRAME = request.spawnFrame
	local LAST_FRAME = request.spawnFrame + request.frames

	local unitID

	local function fail(text)
		Spring.Log(LOG_SECTION, "error", text)
	end

	local function finish(frame)
		Spring.Log(LOG_SECTION, "notice", "done at frame " .. frame)
		SendToUnsynced(DONE_MESSAGE)
	end

	-- The two places the engine's s3o texture loader tries, in order: the
	-- name as the model writes it, then under unittextures/
	-- (rts/Rendering/Textures/S3OTextureHandler.cpp). A headless engine loads
	-- no textures and so never says one is missing.
	local function textureFound(name)
		return VFS.FileExists(name) or VFS.FileExists("unittextures/" .. name)
	end

	local function checkTextures(def)
		-- Reading the model table loads the model, which the spawn below
		-- would do anyway.
		local textures = def.model and def.model.textures or {}
		for _, key in ipairs({ "tex1", "tex2" }) do
			local name = textures[key]
			if name and name ~= "" and not textureFound(name) then
				fail("texture not found: " .. name)
			end
		end
	end

	local function spawn(frame)
		local def = UnitDefNames[UNIT_NAME]
		if not def then
			fail("no unit definition called " .. UNIT_NAME)
			finish(frame)
			return
		end
		checkTextures(def)

		local x, z = Game.mapSizeX / 2, Game.mapSizeZ / 2
		unitID = Spring.CreateUnit(def.id, x, Spring.GetGroundHeight(x, z), z, 0, 0)
		if not unitID then
			fail("could not spawn " .. UNIT_NAME)
			finish(frame)
			return
		end
		-- A Lua unit script that fails to load leaves the unit running with
		-- no script at all, which is otherwise silent from here on. A game that
		-- never turned the framework on has no way to ask, and says so rather
		-- than losing the line below (issue #4139).
		local scriptName = def.scriptName or ""
		if scriptName:lower():match("%.lua$") then
			local getScriptEnv = Spring.UnitScript and Spring.UnitScript.GetScriptEnv
			if not getScriptEnv then
				fail("the game does not run Lua unit scripts: " .. scriptName)
			elseif not getScriptEnv(unitID) then
				fail("the unit script did not load: " .. scriptName)
			end
		end
		local pieces = Spring.GetUnitPieceList(unitID) or {}
		Spring.Log(LOG_SECTION, "notice", "spawned " .. UNIT_NAME .. " with " .. #pieces .. " pieces")
	end

	function gadget:GameFrame(frame)
		if frame == SPAWN_FRAME then
			spawn(frame)
		elseif frame == LAST_FRAME and unitID then
			if Spring.GetUnitIsDead(unitID) ~= false then
				fail(UNIT_NAME .. " died before frame " .. frame)
			end
			finish(frame)
		end
	end
else
	-- How fast to ask the server to play, as a multiple of real time. The
	-- replay logger's figure, and for the same reason: the server slows
	-- itself down again when the machine cannot keep up, so it is a ceiling.
	local SPEED = 100

	local function playFast()
		-- Maximum first: the server clamps a minimum to the maximum it has.
		Spring.SendCommands("setmaxspeed " .. SPEED, "setminspeed " .. SPEED)
	end

	function gadget:Initialize()
		gadgetHandler:AddSyncAction(DONE_MESSAGE, function()
			-- A headless engine plays on until something tells it to stop.
			Spring.SendCommands("quitforce")
		end)
		playFast()
	end

	-- Asked again once the game is running, because a server still loading
	-- may not have been listening the first time.
	function gadget:GameStart()
		playFast()
	end
end
