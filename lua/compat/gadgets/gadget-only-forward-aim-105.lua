-- id: gadget-only-forward-aim-105
-- catalogue:
-- gadget: coilbox_compat_only_forward_aim
-- license: MIT or GNU GPL, v2 or later

-- A weapon that only fires forward fires once its target is in front of it,
-- whatever the unit's script says about aiming, as it did before 105.0.
--
-- Changelog, 105.0: "remove legacy (COB, though also affecting Lua) hack
-- allowing units with onlyForward weapons to fire regardless of AimWeapon
-- status".
--
-- In 104.0, CWeapon::UpdateAim (rts/Sim/Weapons/Weapon.cpp) set the weapon's
-- angleGood every frame it had a target that was within its firing angle, if
-- the weapon was onlyForward. angleGood is what lets a weapon fire, and the
-- script's AimWeapon otherwise sets it from what it returns. The engine's
-- comment gives the reason: many old scripts have no Aim function for these
-- weapons, and the engine treats a missing one as a refusal, so they never
-- fire. A weapon def is onlyForward when it is not a turret and not a
-- StarburstLauncher (rts/Sim/Weapons/WeaponDef.cpp).
--
-- This sets angleGood through Spring.SetUnitWeaponState's aimReady on every
-- frame, from GameFrame, which the engine runs before it updates the units
-- (CGame::SimFrame). The weapon's update then clears it again when the target
-- is outside the firing angle, and on a frame it asks the script to aim again,
-- as 104.0 did (CWeapon::CallAimingScript), so it fires on the same frames.
--
-- It does nothing in a game with no onlyForward weapon.

function gadget:GetInfo()
	return {
		name = "coilbox_compat_only_forward_aim",
		desc = "Forward firing weapons fire whatever AimWeapon says, as before engine 105.0",
		author = "coilbox",
		license = "MIT or GNU GPL, v2 or later",
		layer = 0,
		enabled = true,
	}
end

if not gadgetHandler:IsSyncedCode() then
	return false
end

local Spring = Spring

-- The weapon numbers of each unit def's onlyForward weapons, by unit def ID.
local forward = {}

-- The same list for each unit on the map, by unit ID.
local units = {}

function gadget:UnitCreated(unitID, unitDefID)
	units[unitID] = forward[unitDefID]
end

function gadget:UnitDestroyed(unitID)
	units[unitID] = nil
end

function gadget:Initialize()
	for unitDefID, ud in pairs(UnitDefs) do
		local list
		for number, weapon in ipairs(ud.weapons or {}) do
			local wd = WeaponDefs[weapon.weaponDef]
			if wd ~= nil and wd.onlyForward then
				list = list or {}
				list[#list + 1] = number
			end
		end
		forward[unitDefID] = list
	end
	if next(forward) == nil then
		gadgetHandler:RemoveGadget()
		return
	end
	for _, unitID in ipairs(Spring.GetAllUnits()) do
		gadget:UnitCreated(unitID, Spring.GetUnitDefID(unitID))
	end
end

function gadget:GameFrame()
	local setState = Spring.SetUnitWeaponState
	for unitID, list in pairs(units) do
		for i = 1, #list do
			setState(unitID, list[i], "aimReady", 1)
		end
	end
end
