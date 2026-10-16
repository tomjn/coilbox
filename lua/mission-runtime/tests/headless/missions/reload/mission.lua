-- The mission the headless harness reloads mid-game (issue #4147).
--
-- Hand-written in the shape coilbox compiles to, because it is not a scenario
-- anybody plays: it exists to hold one of each thing `/luarules reload` used to
-- lose. An invulnerable actor, an ordinary one, a var, two objectives and a
-- trigger that fires once and settles one of them. The human on team 0 gets the
-- runtime's anchor.
return {
	schemaVersion = 1,
	runtimeVersion = 1,
	id = "reload",
	name = "Reload",
	game = "Test Game",
	map = "Comet Catcher Redux",
	teams = {
		enemy = { team = 1, noCommander = true },
		player = { team = 0 },
	},
	zones = {},
	actors = {
		{
			id = "hero",
			unitDef = "armpw",
			team = "enemy",
			pos = { x = 2000, z = 2000 },
			facing = 0,
			state = { invulnerable = true },
		},
		{
			id = "grunt",
			unitDef = "armpw",
			team = "enemy",
			pos = { x = 2200, z = 2000 },
			facing = 0,
		},
	},
	groups = {},
	prefabs = {},
	restrictions = {},
	vars = { counter = 5 },
	triggers = {
		{
			id = "tally",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "time_elapsed", params = { seconds = 1 } },
				},
			},
			actions = {
				{ type = "add_var", params = { name = "counter", value = 1 } },
				{ type = "complete_objective", params = { objective = "first" } },
			},
		},
	},
	objectives = {
		{ id = "first", kind = "primary", text = "Happens once.", hidden = false },
		{ id = "second", kind = "primary", text = "Never happens.", hidden = false },
	},
	dialogue = {},
}
