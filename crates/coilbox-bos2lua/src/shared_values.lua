
-- Unit values 1024 to 8191 were numbers BOS scripts shared: 8 per unit, 64 per
-- team, 64 per allyteam and 4096 for the whole game. The engine stopped keeping
-- them in Spring 102.0, so these keep them as rules params, which gadgets and
-- widgets can read too: cobUnitVar<n> on the unit, cobTeamVar<n> on the team,
-- cobAllyVar<n> on every team in the allyteam and cobGlobalVar<n> on the game,
-- with n counted from 0. lualibs/cob_vars.lua reads and writes the same ones
-- through Spring.GetCOBTeamVar, Spring.SetUnitCOBValue and their siblings.
local cobAllied = { allied = true }

-- get, keeping the shared values. A unit value with a positive first argument
-- reads that unit's, and with a negative one sets that unit's to the second.
-- Any other id goes to the engine.
local function cobGet(id, ...)
	if id >= 1024 and id <= 1031 then
		local p1, p2 = ...
		p1 = p1 or 0
		local name = "cobUnitVar" .. (id - 1024)
		if p1 == 0 then
			return Spring.GetUnitRulesParam(unitID, name) or 0
		elseif p1 > 0 then
			return Spring.GetUnitRulesParam(p1, name) or 0
		elseif Spring.ValidUnitID(-p1) then
			Spring.SetUnitRulesParam(-p1, name, p2 or 0, cobAllied)
			return 1
		end
		return 0
	elseif id >= 2048 and id <= 2111 then
		return Spring.GetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobTeamVar" .. (id - 2048)) or 0
	elseif id >= 3072 and id <= 3135 then
		return Spring.GetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobAllyVar" .. (id - 3072)) or 0
	elseif id >= 4096 and id <= 8191 then
		return Spring.GetGameRulesParam("cobGlobalVar" .. (id - 4096)) or 0
	end
	return GetUnitValue(id, ...)
end

-- set, keeping the shared values. Any other id goes to the engine.
local function cobSet(id, value)
	if id >= 1024 and id <= 1031 then
		Spring.SetUnitRulesParam(unitID, "cobUnitVar" .. (id - 1024), value, cobAllied)
	elseif id >= 2048 and id <= 2111 then
		Spring.SetTeamRulesParam(Spring.GetUnitTeam(unitID), "cobTeamVar" .. (id - 2048), value, cobAllied)
	elseif id >= 3072 and id <= 3135 then
		local name = "cobAllyVar" .. (id - 3072)
		for _, team in ipairs(Spring.GetTeamList(Spring.GetUnitAllyTeam(unitID))) do
			Spring.SetTeamRulesParam(team, name, value, cobAllied)
		end
	elseif id >= 4096 and id <= 8191 then
		Spring.SetGameRulesParam("cobGlobalVar" .. (id - 4096), value)
	else
		SetUnitValue(id, value)
	end
end
