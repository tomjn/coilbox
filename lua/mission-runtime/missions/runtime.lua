-- Coilbox mission runtime: version marker and capability table.
--
-- Coilbox reads this file out of a game to find out which runtime that game has
-- vendored, what the editor may offer, and whether a scenario will run. It is
-- data only, with no globals and no engine calls, so it evaluates the same in
-- the engine and in coilbox's sandboxed Lua reader.
--
-- version is what a scenario names in its runtimeVersion. Bump it in the same
-- change that adds a condition or action type below, or a format feature an
-- older runtime would ignore. Never drop a type from a version that has shipped:
-- a scenario asking for it would then start silently doing nothing, which is the
-- failure this file exists to prevent.
--
-- 2 added no types. It records which unit each named prefab building became, so
-- a trigger can name one (issue #878). Version 1 ignores a building's id, and
-- `unit_dead` on a name it has never heard of holds from the first frame, so a
-- scenario that names one has to be refused rather than half played.
--
-- 3 is four format changes at once, because each of them on its own would have
-- wanted a version of its own and a game chasing four floors for one release is
-- worse than a game chasing one:
--
--   * a var condition and the two var actions take a number or the name of
--     another var, so a mission can compare a counter against a quota
--     (issue #808)
--   * camera_pan and map_marker name a team, so a co-op mission does not yank
--     every player's camera (issue #827)
--   * zone_held_for can ask for an uncontested hold (issue #802)
--   * release_group stops the mission ordering a squad it handed over
--     (issue #812)
--
-- Each raises a scenario's requiredRuntimeVersion only when the scenario uses
-- it, so nothing already authored asks for 3.

return {
	version = 3,

	-- The compiled mission format this runtime reads.
	schemaVersion = 1,

	conditions = {
		"units_in_zone",
		"unit_count",
		"unit_dead",
		"unit_health_below",
		"unit_built",
		"unit_captured",
		"time_elapsed",
		"var",
		"zone_held_for",
	},

	actions = {
		"spawn_group",
		"wake_group",
		"give_orders",
		"gift_units",
		"set_var",
		"add_var",
		"enable_trigger",
		"disable_trigger",
		"complete_objective",
		"fail_objective",
		"dialogue",
		"play_sound",
		"reveal_area",
		"unlock_unit",
		"camera_pan",
		"map_marker",
		"victory",
		"defeat",
	},
}
