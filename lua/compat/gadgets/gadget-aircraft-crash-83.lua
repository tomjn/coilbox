-- id: gadget-aircraft-crash-83
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

--- Whether any of the game's own LuaRules files calls Spring.SetUnitCrashing.
local function luaCrashes()
	for _, path in ipairs(VFS.DirList("luarules/", "*.lua", nil, true) or {}) do
		if not path:lower():find(OWN_FILES, 1, true) then
			local text = VFS.LoadFile(path)
			if type(text) == "string" and text:find("SetUnitCrashing", 1, true) then
				return true
			end
		end
	end
	return false
end

-- The planes this crashes, by unit def ID.
local planes = {}

-- The damage each plane has taken lately, as it stood on `frame`.
local recent = {}

function gadget:Initialize()
	if luaCrashes() then
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
