-- The mission the headless harness upgrades actors and a group's units in
-- (issues #5297 and #5475).
--
-- Hand-written in the shape coilbox compiles to. The probe replaces each actor's
-- unit the way a game's upgrade does: a new unit where the old one stands, then
-- the old one destroyed by script. "hero" goes in one frame, as Beyond All
-- Reason's evolving commanders do, "scout" on the next frame, as Splinter
-- Faction's morphs do, and "post" is a building put half a build square off its
-- spot, as Splinter Faction snaps one to the grid. Each actor's death completes
-- an objective, so an objective still open is an actor still alive. The group
-- "squad" starts asleep, has one unit upgraded each way, and completes an
-- objective of its own once the mission calls it dead.
local function onDeath(actor)
	return {
		id = actor .. "Dead",
		enabled = true,
		["repeat"] = false,
		conditions = { op = "all", conditions = { { type = "unit_dead", params = { actor = actor } } } },
		actions = { { type = "complete_objective", params = { objective = actor .. "Dead" } } },
	}
end

return {
	schemaVersion = 1,
	runtimeVersion = 19,
	id = "upgrade",
	name = "Upgrade",
	game = "Test Game",
	map = "Comet Catcher Redux",
	teams = {
		enemy = { team = 1, noCommander = true },
		player = { team = 0, noCommander = true },
	},
	zones = {},
	actors = {
		{ id = "hero", unitDef = "armpw", team = "player", pos = { x = 2000, z = 2000 }, facing = 0 },
		{ id = "scout", unitDef = "armrock", team = "player", pos = { x = 2400, z = 2000 }, facing = 0 },
		{ id = "post", unitDef = "armsolar", team = "player", pos = { x = 2800, z = 2000 }, facing = 0 },
	},
	groups = {
		{
			id = "squad",
			team = "player",
			pos = { x = 2400, z = 2600 },
			units = { { def = "armpw", count = 2 } },
			orders = {},
			startsAsleep = true,
		},
	},
	prefabs = {},
	restrictions = {},
	vars = {},
	triggers = {
		onDeath("hero"),
		onDeath("scout"),
		onDeath("post"),
		{
			id = "squadDead",
			enabled = true,
			["repeat"] = false,
			conditions = { op = "all", conditions = { { type = "group_dead", params = { group = "squad" } } } },
			actions = { { type = "complete_objective", params = { objective = "squadDead" } } },
		},
		{
			id = "wounded",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = { { type = "unit_health_below", params = { actor = "hero", fraction = 0.5 } } },
			},
			actions = { { type = "complete_objective", params = { objective = "wounded" } } },
		},
	},
	objectives = {
		{ id = "heroDead", kind = "primary", text = "heroDead", hidden = false },
		{ id = "scoutDead", kind = "primary", text = "scoutDead", hidden = false },
		{ id = "postDead", kind = "primary", text = "postDead", hidden = false },
		{ id = "squadDead", kind = "primary", text = "squadDead", hidden = false },
		{ id = "wounded", kind = "primary", text = "wounded", hidden = false },
	},
	dialogue = {},
}
