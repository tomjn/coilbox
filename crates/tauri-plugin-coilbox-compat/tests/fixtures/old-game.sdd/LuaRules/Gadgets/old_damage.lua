-- A gadget written for the call-in order of an old engine.
function gadget:GetInfo()
  return { name = "old_damage", layer = 0, enabled = true }
end

if not gadgetHandler:IsSyncedCode() then
  return
end

local taken = {}

function gadget:UnitDamaged(unitID, unitDefID, unitTeam, damage, paralyzer, weaponID, attackerID, attackerDefID, attackerTeam)
  taken[unitID] = (taken[unitID] or 0) + damage
end

function gadget:AllowCommand(unitID, unitDefID, teamID, cmdID, cmdParams, cmdOptions, cmdTag, synced)
  return true
end
