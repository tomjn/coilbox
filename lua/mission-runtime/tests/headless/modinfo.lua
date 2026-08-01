-- The scratch game the headless harness runs the runtime in. Written into a
-- temporary directory by scripts/mission-headless.sh, which substitutes @BASE@
-- for the base game whose unit defs the fixture missions name.
--
-- The runtime is game-agnostic and a game vendors a copy, so this is what the
-- smallest possible game vendoring it looks like.

return {
	name = "Coilbox mission harness",
	shortname = "coilbox_mission_harness",
	game = "Coilbox mission harness",
	version = "scratch",
	description = "The coilbox mission runtime on top of @BASE@.",
	modtype = 1,
	depend = { "@BASE@" },
}
