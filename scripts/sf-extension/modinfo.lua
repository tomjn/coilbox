-- The scratch mutator scripts/mission-sf-extension.sh runs the extension proof
-- in. It carries the probe and nothing else: the runtime, the compiled mission,
-- the declaration and its handler all come out of @BASE@, which is the
-- SplinterFaction working copy. @BASE@ is substituted by the script.

return {
	name = "Coilbox SF extension probe",
	shortname = "coilbox_sf_extension",
	game = "Coilbox SF extension probe",
	version = "scratch",
	description = "Reads what the condition and action types @BASE@ declares did.",
	modtype = 1,
	depend = { "@BASE@" },
}
