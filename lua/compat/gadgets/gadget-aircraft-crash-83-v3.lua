-- id: gadget-aircraft-crash-83-v3
-- catalogue:
-- gadget: coilbox_compat_aircraft_crash
-- license: MIT or GNU GPL, v2 or later

-- A plane that is shot down falls out of the sky, as it did before 83.0,
-- instead of exploding where it was hit.
--
-- Changelog, 83.0: "remove hardcoded enter-crashing-state-on-death behavior
-- for aircraft (now delegated to Lua or COB)".
--
-- Up to 0.82, CUnit::KillUnit (rts/Sim/Units/Unit.cpp) put a dying aircraft in
-- its crashing state instead of killing it when all of these held: it flew as a
-- plane (CAirMoveType, a strafing air unit now), it was not being built, its
-- def did not set canCrash to false, it was not self destructing or being
-- reclaimed, and a random number from 0 to 1 was above
-- recentDamage * 0.7 / maxHealth + 0.2. Its health was then set to half its
-- maximum, and it died when it hit the ground. recentDamage was the damage the
-- unit had taken, including the killing hit, and lost a tenth of itself every
-- frame (CUnit::DoDamage and CUnit::Update).
--
-- This does the same from UnitDamaged. The engine calls that after it takes the
-- damage off the unit's health and before it kills the unit (CUnit::DoDamage),
-- so a crash that starts there keeps the unit alive, and every other gadget's
-- UnitDamaged sees the health at or below 0 first, as it did then. Self
-- destruction and reclaiming do not pass through UnitDamaged, and they never
-- crashed a plane either. Lua cannot read canCrash any more, so a def that set
-- it to false crashes too. The engine refuses to crash a plane that has landed,
-- so one killed on the ground dies there.
--
-- It does nothing in a game that crashes planes itself: one whose LuaRules
-- calls Spring.SetUnitCrashing, and each plane whose unit script sets
-- CRASHING. Setting a unit value in a script that is already running Killed is
-- too late, as the unit is dead by then, so a script that crashes its plane
-- sets CRASHING wherever it is, and this looks for it anywhere in the script.
--
-- It also does nothing in a game made for engine 83.0 or later, which already
-- had planes that explode where they are hit and chose not to crash them, as
-- Balanced Annihilation 15.9.8 did (issue #4638). The sign is a gadget of the
-- game's own, a file directly in LuaRules/Gadgets/ that its gadget handler
-- loads, naming a function in the Spring table that 0.82.7.1, the last engine
-- before 83.0, did not have. A gadget that called one would fail on the engine
-- it was made for. Comments are not read, nor are files in other folders,
-- which an old game can keep without loading: XTA 9.65 has a call to
-- Spring.GetModOption in a comment and in LuaRules/Deploy/. A name the game
-- defines itself does not count either: Complete Annihilation stable-8405
-- defines its own Spring.GetModOption in LuaRules/main.lua.
--
-- A game with no such gadget can still name its engine (issue #4645). Expand
-- and Exterminate 0.46 has five gadgets, all copies of older ones, and its
-- version is "0.46 for Spring 0.88". The mutator's modinfo.lua carries the base
-- game's name and version as compatbasename and compatbaseversion when the
-- manifest lists game-identity (#4633), and this reads them. Only the word
-- Spring followed by a version of 0.83 or later counts, so the game's own
-- version (XTA 9.65, Complete Annihilation stable-8405) and a name such as
-- Spring 1944 do not.

function gadget:GetInfo()
	return {
		name = "coilbox_compat_aircraft_crash",
		desc = "Planes that are shot down crash, as before engine 83.0",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		-- After the game's own gadgets, which saw a dying plane's health at or
		-- below 0 in UnitDamaged before the engine crashed it.
		layer = 100000,
		enabled = true,
	}
end

if not gadgetHandler:IsSyncedCode() then
	return false
end

local Spring = Spring
local random = math.random

-- `set CRASHING to <value>` in a COB script: push the constant 97 (CRASHING in
-- rts/Sim/Units/Scripts/CobDefines.h), push the value as a constant, a local
-- or a static, then SET (rts/Sim/Units/Scripts/CobOpCodes.h). Each opcode and
-- operand is a 32 bit little endian word. A Lua 5.1 pattern cannot hold a zero
-- byte, so %z stands for one.
local SET_CRASHING = "\001\016\002\016a%z%z%z[\001\002\004]\016\002\016....%z \008\016"

local OWN_FILES = "coilbox_compat_"

-- Every function in the Spring table that RecoilEngine registers in
-- rts/Lua/LuaSyncedCtrl.cpp, LuaSyncedRead.cpp, LuaUnsyncedCtrl.cpp or
-- LuaUnsyncedRead.cpp at any release tag from 83.0 on or at commit 4282724f71,
-- less every name that appears as a registration or a string anywhere in the
-- C++ of rts/Lua/ at tag 0.82.7.1 or as Spring.<name> in its cont/ Lua.
local NEWER = {}
for name in ([[
AddFeatureDamage AddMapLight AddModelLight AddObjectDecal AddOriginalHeightMap
AddTeamResourceExcessStats AddUnitExperience AdjustOriginalHeightMap
AssignPlayerToTeam BuggerOff ClearFeaturesPreviousDrawFlag ClearUnitGoal
ClearUnitsPreviousDrawFlag ClearWatchDogTimer ClosestBuildPos CreateDecal
CreateFeatureWreck CreateGroundDecal CreateUnitWreck DeleteProjectile
DeselectUnit DeselectUnitArray DeselectUnitMap DestroyDecal DestroyGroundDecal
ForceTesselationUpdate ForceUnitCollisionUpdate GarbageCollectCtrl
GetAllDecals GetAllGroundDecals GetAllIconDataArray GetAllProjectiles
GetBoxSelectionByEngine GetCEGID GetCameraRotation GetClipboard
GetClosestEnemyUnit GetConfigFloat GetConfigParams GetCustomPaletteColor
GetDecalAlpha GetDecalOwner GetDecalPos GetDecalRotation GetDecalSize
GetDecalTexture GetDecalType GetDrawSeconds GetDualViewGeometry
GetFacingFromHeading GetFactoryBuggerOff GetFactoryCommandCount
GetFeatureAlwaysUpdateMatrix GetFeatureBlocking GetFeatureCollisionVolumeData
GetFeatureDrawFlag GetFeatureEngineDrawMask GetFeatureFireTime
GetFeatureLastAttackedPiece GetFeatureMass GetFeatureNoDraw
GetFeaturePaletteIndex GetFeaturePieceCollisionVolumeData
GetFeaturePieceDirection GetFeaturePieceInfo GetFeaturePieceList
GetFeaturePieceMap GetFeaturePieceMatrix GetFeaturePiecePosDir
GetFeaturePiecePosition GetFeaturePieceTransformMatrices GetFeatureRootPiece
GetFeatureRotation GetFeatureRulesParam GetFeatureRulesParams
GetFeatureSelectionVolumeData GetFeatureSeparation GetFeatureSmokeTime
GetFeatureTransformMatrix GetFeatureVelocity GetFeaturesInCylinder
GetFeaturesInScreenRectangle GetFeaturesInSphere GetFrameTimer GetGameName
GetGameSecondsInterpolated GetGameState GetGlobalLos GetGrass
GetGroundDecalAlpha GetGroundDecalCreationFrame GetGroundDecalGlowParams
GetGroundDecalMiddlePos GetGroundDecalMisc GetGroundDecalNormal
GetGroundDecalOwner GetGroundDecalQuadPos GetGroundDecalRotation
GetGroundDecalSizeAndHeight GetGroundDecalTexture GetGroundDecalTextureParams
GetGroundDecalTextures GetGroundDecalTint GetGroundDecalType
GetGroundDecalUserData GetHeadingFromFacing GetIconData GetKeyFromScanSymbol
GetLogSections GetLosViewColors GetLuaMemUsage GetMapOption
GetMapSquareTexture GetMapStartPositions GetMenuName GetMiniMapRotation
GetModOption GetModelPieceList GetModelPieceMap GetModelRootPiece
GetMouseButtonsPressed GetNanoProjectileParams GetNumDisplays
GetPieceProjectileName GetPieceProjectileParams GetPixelDir
GetPlayerRulesParam GetPlayerRulesParams GetPlayerStatistics GetPressedScans
GetPrevFrameSyncChecksum GetProfilerRecordNames GetProfilerTimeRecord
GetProjectileAllyTeamID GetProjectileDamages GetProjectileDefID
GetProjectileDirection GetProjectileIsIntercepted GetProjectileOwnerID
GetProjectileTarget GetProjectileTeamID GetProjectileTimeToLive
GetProjectilesInRectangle GetProjectilesInSphere GetRadarErrorParams
GetRenderFeatures GetRenderFeaturesDrawFlagChanged GetRenderUnits
GetRenderUnitsDrawFlagChanged GetReplayFilePath GetReplayLength
GetReplayRecordingFilePath GetScanSymbol GetSelectionBox GetSoundDevices
GetSoundEffectParams GetSyncedGCInfo GetTeamAllyTeamID GetTeamDamageStats
GetTeamMaxUnits GetTerrainTypeData GetTidal GetTimerMicros
GetUnitAlwaysUpdateMatrix GetUnitArrayCentroid GetUnitBlocking
GetUnitBuildParams GetUnitBuildeeRadius GetUnitCommandCount GetUnitCostTable
GetUnitCosts GetUnitCurrentBuildPower GetUnitCurrentCommand GetUnitDrawFlag
GetUnitEffectiveBuildRange GetUnitEngineDrawMask GetUnitFeatureSeparation
GetUnitHarvestStorage GetUnitIcon GetUnitIconData GetUnitInBuildStance
GetUnitIsBeingBuilt GetUnitLeavesGhost GetUnitMapCentroid GetUnitMass
GetUnitMaxRange GetUnitMoveDefID GetUnitNanoPieces GetUnitNoGroup
GetUnitPaletteIndex GetUnitPhysicalState GetUnitPieceTransformMatrices
GetUnitPosErrorParams GetUnitRootPiece GetUnitRotation GetUnitSeismicSignature
GetUnitSelectionVolumeData GetUnitStorage GetUnitWeaponCanFire
GetUnitWeaponDamages GetUnitWeaponHaveFreeLineOfFire GetUnitWeaponTarget
GetUnitWeaponTestRange GetUnitWeaponTestTarget GetUnitWeaponTryTarget
GetUnitWorkerTask GetUnitsInScreenRectangle GetVidMemUsage
GetVideoCapturingMode GetVisibleProjectiles GetWaterLevel GetWaterPlaneLevel
GetWindowDisplayMode GiveOrderArrayToUnit IsNoCostEnabled IsPosInMap
IsUnitInAirLos IsUnitInJammer IsUnitInLos IsUnitInRadar IsUserWriting KillTeam
LevelOriginalHeightMap LoadCmdColorsConfig LoadCtrlPanelConfig
LoadModelTextures Log PauseDollyCamera Ping PreloadFeatureDefModel
PreloadSoundItem PreloadUnitDefModel Quit RebuildSmoothMesh Reload
RemoveObjectDecal RequestStartPosition ResumeDollyCamera
RevertOriginalHeightMap RunDollyCamera SDLSetTextInputRect SDLStartTextInput
SDLStopTextInput SelectUnit SendAllyChat SendLuaMenuMsg SendPrivateChat
SendPublicChat SendSkirmishAIMessage SendSpectatorChat SetAlly
SetAllyTeamStartBox SetAtmosphere SetAutoShowMetal SetBoxSelectionByEngine
SetCheatingEnabled SetClipboard SetConfigFloat SetCustomPaletteColor
SetDecalAlpha SetDecalPos SetDecalRotation SetDecalSize SetDecalTexture
SetDollyCameraCurve SetDollyCameraLookCurve SetDollyCameraLookPosition
SetDollyCameraLookUnit SetDollyCameraMode SetDollyCameraPosition
SetDollyCameraRelativeMode SetDrawGroundDeferred SetDrawModelsDeferred
SetEngineBuildSquareRendering SetFactoryBuggerOff SetFeatureAlwaysUpdateMatrix
SetFeatureBlocking SetFeatureEngineDrawMask SetFeatureFade SetFeatureFireTime
SetFeatureHeadingAndUpDir SetFeatureMass SetFeatureMaxHealth
SetFeatureMidAndAimPos SetFeatureMoveCtrl SetFeatureNoDraw
SetFeaturePaletteIndex SetFeaturePhysics SetFeaturePieceCollisionVolumeData
SetFeaturePieceMatrix SetFeaturePieceVisible SetFeatureRadiusAndHeight
SetFeatureResources SetFeatureRotation SetFeatureRulesParam
SetFeatureSelectionVolumeData SetFeatureSmokeTime SetFeatureUseAirLos
SetFeatureVelocity SetGlobalLos SetGodMode SetGroundDecalAlpha
SetGroundDecalCreationFrame SetGroundDecalGlowParams SetGroundDecalMisc
SetGroundDecalNormal SetGroundDecalPosAndDims SetGroundDecalQuadPosAndHeight
SetGroundDecalRotation SetGroundDecalTexture SetGroundDecalTextureParams
SetGroundDecalTint SetGroundDecalUserData SetLogSectionFilterLevel
SetMapLightTrackingState SetMapRenderingParams SetMapShader
SetMapShadingTexture SetMapSquareTexture SetMiniMapRotation
SetModelLightTrackingState SetNanoProjectileParams SetOriginalHeightMap
SetOriginalHeightMapFunc SetPieceProjectileParams SetPlayerReadyState
SetPlayerRulesParam SetProjectileAlwaysVisible SetProjectileDamages
SetProjectileIgnoreTrackingError SetProjectileIsIntercepted
SetProjectileTarget SetProjectileTimeToLive SetProjectileUseAirLos
SetRadarErrorParams SetSkyBoxTexture SetSoundEffectParams
SetSquareBuildingMask SetSunDirection SetSunLighting SetSunManualControl
SetSunParameters SetTeamStartPosition SetTidal SetUnitAlwaysUpdateMatrix
SetUnitBuildParams SetUnitBuildeeRadius SetUnitCrashing SetUnitDirection
SetUnitEngineDrawMask SetUnitHarvestStorage SetUnitHeadingAndUpDir SetUnitIcon
SetUnitIconDraw SetUnitLandGoal SetUnitLeaveTracks SetUnitLeavesGhost
SetUnitLoadingTransport SetUnitMass SetUnitMaxRange SetUnitMidAndAimPos
SetUnitNanoPieces SetUnitNoGroup SetUnitPaletteIndex SetUnitPhysicalStateBit
SetUnitPieceMatrix SetUnitPieceParent SetUnitPieceVisible
SetUnitPosErrorParams SetUnitRadiusAndHeight SetUnitSeismicSignature
SetUnitSelectionVolumeData SetUnitShieldRechargeDelay SetUnitStorage
SetUnitUseAirLos SetUnitUseWeapons SetUnitWeaponDamages SetVideoCapturingMode
SetVideoCapturingTimeOffset SetWMCaption SetWMIcon SetWind SetWindowGeometry
SetWindowMaximized SetWindowMinimized SolveNURBSCurve SpawnExplosion
SpawnProjectile SpawnSFX Start TestMoveOrder TraceRayBetweenPositions
TraceRayGroundBetweenPositions TraceRayGroundInDirection TraceRayInDirection
TransferTeamMaxUnits UnbindAll UnitAttach UnitDetach UnitDetachFromAir
UnitFinishCommand UnitIconGetDraw UnitIconSetDraw UnitWeaponFire
UnitWeaponHoldFire UpdateInfoTexture UpdateMapLight UpdateModelLight
WeaponHaveFreeLineOfFire WeaponTestRange WeaponTestTarget WeaponTryTarget
Yield
]]):gmatch("%S+") do
	NEWER[name] = true
end

--- Whether the unit script at `path` sets CRASHING itself.
local function scriptCrashes(path)
	local text = VFS.LoadFile(path)
	if type(text) ~= "string" then
		return false
	end
	if path:lower():sub(-4) == ".lua" then
		return text:find("CRASHING", 1, true) ~= nil
	end
	return text:find(SET_CRASHING) ~= nil
end

--- `text` with its comments taken out.
local function code(text)
	text = text:gsub("%-%-%[(=*)%[.-%]%1%]", "")
	return (text:gsub("%-%-[^\n]*", ""))
end

--- Whether `text` names a Spring engine of 83.0 or later: the word Spring and
--- then a version, as in "0.46 for Spring 0.88", "Spring 0.83" or "for spring
--- 85". A version before 83.0 does not count, nor does a number that is no
--- engine's, such as the 1944 of the game Spring 1944, and nor does any other
--- number in the text, such as the game's own version.
local function namesNewerEngine(text)
	if type(text) ~= "string" then
		return false
	end
	for major, minor in text:lower():gmatch("%f[%a]spring%f[%A]%s+v?(%d+)%.?(%d*)%f[%W]") do
		local version = tonumber(major .. "." .. (minor ~= "" and minor or "0"))
		if (version >= 0.83 and version < 1) or (version >= 83 and version < 1000) then
			return true
		end
	end
	return false
end

--- Whether the mutator's modinfo.lua gives the base game's name or version as
--- one that names a Spring engine of 83.0 or later. The writer puts both there
--- as compatbasename and compatbaseversion.
local function modinfoNamesNewerEngine()
	local ok, info = pcall(VFS.Include, "modinfo.lua", nil, VFS.MOD)
	if not ok or type(info) ~= "table" then
		return false
	end
	return namesNewerEngine(info.compatbasename) or namesNewerEngine(info.compatbaseversion)
end

--- Whether any of the game's own LuaRules files calls Spring.SetUnitCrashing,
--- and whether one of its gadgets names a function the engine gained in 83.0
--- or later.
local function readLuaRules()
	local crashes, used, defined = false, {}, {}
	for _, path in ipairs(VFS.DirList("luarules/", "*.lua", VFS.MOD, true) or {}) do
		local lower = path:lower()
		local text = not lower:find(OWN_FILES, 1, true) and VFS.LoadFile(path, VFS.MOD)
		if type(text) == "string" then
			crashes = crashes or text:find("SetUnitCrashing", 1, true) ~= nil
			text = code(text)
			for name in text:gmatch("function%s+Spring%.([%w_]+)") do
				defined[name] = true
			end
			for name, after in text:gmatch("%f[%w_]Spring%.([%w_]+)%s*=(.?)") do
				if after ~= "=" then
					defined[name] = true
				end
			end
			if lower:find("^luarules/gadgets/[^/]+$") then
				for name in text:gmatch("%f[%w_]Spring%.([%w_]+)") do
					used[name] = true
				end
			end
		end
	end
	for name in pairs(used) do
		if NEWER[name] and not defined[name] then
			return crashes, true
		end
	end
	return crashes, false
end

-- The planes this crashes, by unit def ID.
local planes = {}

-- The damage each plane has taken lately, as it stood on `frame`.
local recent = {}

function gadget:Initialize()
	local crashes, newer = readLuaRules()
	if crashes or newer or modinfoNamesNewerEngine() then
		gadgetHandler:RemoveGadget()
		return
	end
	local checked = {}
	for unitDefID, ud in pairs(UnitDefs) do
		if ud.isStrafingAirUnit then
			local path = ud.scriptName or ""
			if checked[path] == nil then
				checked[path] = scriptCrashes(path)
			end
			if not checked[path] then
				planes[unitDefID] = true
			end
		end
	end
	if next(planes) == nil then
		gadgetHandler:RemoveGadget()
	end
end

function gadget:UnitDamaged(unitID, unitDefID, _, damage, paralyzer)
	if not planes[unitDefID] then
		return
	end
	local frame = Spring.GetGameFrame()
	local seen = recent[unitID]
	local total = 0
	if seen ~= nil then
		total = seen.damage * 0.9 ^ (frame - seen.frame)
	else
		seen = {}
		recent[unitID] = seen
	end
	if damage > 0 then
		total = total + damage
	end
	seen.damage, seen.frame = total, frame

	if paralyzer then
		return
	end
	local health, maxHealth = Spring.GetUnitHealth(unitID)
	if health == nil or health > 0 or Spring.GetUnitIsBeingBuilt(unitID) then
		return
	end
	if random() > total * 0.7 / maxHealth + 0.2 and Spring.SetUnitCrashing(unitID, true) then
		Spring.SetUnitHealth(unitID, maxHealth * 0.5)
	end
end

function gadget:UnitDestroyed(unitID)
	recent[unitID] = nil
end
