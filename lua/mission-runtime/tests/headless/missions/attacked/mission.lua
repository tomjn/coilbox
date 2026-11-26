-- The mission the headless harness attacks units in (issue #5298).
--
-- Hand-written in the shape coilbox compiles to. The player's units stand still
-- and unarmed, and the probe puts an enemy laser tower beside them, so the hits
-- the triggers hear are the engine's own from a real weapon. One actor stands out
-- of its range and one is invulnerable, for the hits that must not be heard.
return {
	schemaVersion = 1,
	runtimeVersion = 17,
	id = "attacked",
	name = "Attacked",
	game = "Test Game",
	map = "Comet Catcher Redux",
	teams = {
		enemy = { team = 1, noCommander = true, resources = { metal = 1000, energy = 1000 } },
		player = { team = 0, noCommander = true },
	},
	zones = {},
	actors = {
		{
			id = "victim",
			unitDef = "armsolar",
			team = "player",
			pos = { x = 2000, z = 2000 },
			facing = 0,
		},
		{
			id = "safe",
			unitDef = "armsolar",
			team = "player",
			pos = { x = 3600, z = 800 },
			facing = 0,
		},
		{
			id = "statue",
			unitDef = "armsolar",
			team = "player",
			pos = { x = 3600, z = 1100 },
			facing = 0,
			state = { invulnerable = true },
		},
	},
	groups = {
		{
			id = "convoy",
			team = "player",
			units = { { def = "armsolar", count = 2 } },
			pos = { x = 2000, z = 2200 },
			orders = {},
		},
	},
	prefabs = {},
	restrictions = {},
	vars = { hits = 0 },
	triggers = {
		{
			id = "any",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "any" } } },
		},
		{
			id = "llt",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim", attackerTeam = "enemy", attackerDefs = { "armllt" } } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "llt" } } },
		},
		{
			id = "ownside",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim", attackerTeam = "player" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "ownside" } } },
		},
		{
			id = "pw",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim", attackerDefs = { "armpw" } } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "pw" } } },
		},
		{
			id = "convoy",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { group = "convoy", attackerTeam = "enemy" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "convoy" } } },
		},
		{
			id = "killed",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim" } },
					{ type = "unit_dead", params = { actor = "victim" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "killed" } } },
		},
		{
			id = "safe",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "safe" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "safe" } } },
		},
		{
			id = "statue",
			enabled = true,
			["repeat"] = false,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "statue" } },
				},
			},
			actions = { { type = "complete_objective", params = { objective = "statue" } } },
		},
		{
			id = "count",
			enabled = true,
			["repeat"] = true,
			conditions = {
				op = "all",
				conditions = {
					{ type = "unit_attacked", params = { actor = "victim" } },
				},
			},
			actions = { { type = "add_var", params = { name = "hits", value = 1 } } },
		},
	},
	objectives = {
		{ id = "any", kind = "primary", text = "any", hidden = false },
		{ id = "llt", kind = "primary", text = "llt", hidden = false },
		{ id = "ownside", kind = "primary", text = "ownside", hidden = false },
		{ id = "pw", kind = "primary", text = "pw", hidden = false },
		{ id = "convoy", kind = "primary", text = "convoy", hidden = false },
		{ id = "killed", kind = "primary", text = "killed", hidden = false },
		{ id = "safe", kind = "primary", text = "safe", hidden = false },
		{ id = "statue", kind = "primary", text = "statue", hidden = false },
	},
	dialogue = {},
}
