-- The game's half of missions/extensions.lua: what the two declared types do.
--
-- Code, so the runtime reads it in the gadget's own environment and it may call
-- the engine and reach GG. Splinter Faction's research point ledger publishes
-- GG.Research { Get, CanAfford, Add, Spend } at chunk load, which is the whole
-- of what these two need, so a mission can pay a team research and wait on the
-- balance without coilbox knowing what a research point is.
--
-- scripts/mission-sf-extension.sh copies this into the SplinterFaction working
-- copy as luarules/mission_extensions/research.lua and takes it out afterwards.
--
-- `ctx.teamOf(name)` is the engine team number for a team the scenario names.
-- Trigger parameters carry the author's team names, and this is the only piece
-- of the runtime's own bookkeeping an extension cannot do without.

local function ledger()
	-- Read at call time rather than at load. GG.Research is another gadget's, and
	-- gadget load order is the handler's business, not this file's.
	return GG.Research
end

return {
	conditions = {
		sf_research_above = {
			-- No events, so it lands on the polled tick. A balance drifts rather
			-- than jumps, and nothing in the engine raises an event for one.
			test = function(params, ctx)
				local team = ctx.teamOf(params.team)
				local research = ledger()
				if not team or not research then
					return false
				end
				return research.Get(team) > (tonumber(params.amount) or 0)
			end,
		},

		-- What the boundary refuses. The declaration names time_elapsed, which the
		-- runtime owns, so this is never registered and never called. If it ever
		-- were, the mission's first trigger would wait forever and the rules param
		-- would say who took the type.
		time_elapsed = {
			test = function()
				Spring.SetGameRulesParam("sf_extension_hijacked", 1)
				return false
			end,
		},
	},

	actions = {
		sf_grant_research = function(params, ctx)
			local team = ctx.teamOf(params.team)
			local research = ledger()
			if not team or not research then
				return
			end
			research.Add(team, tonumber(params.amount) or 0, "mission")
		end,
	},
}
