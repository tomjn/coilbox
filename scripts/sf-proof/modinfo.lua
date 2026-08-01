-- The scratch mutator scripts/mission-sf-proof.sh runs the adoption proof in.
-- It carries the probe and nothing else: the runtime, the compiled mission and
-- the unit defs all come out of @BASE@, which is the SplinterFaction working
-- copy coilbox installed the runtime into. @BASE@ is substituted by the script.

return {
	name = "Coilbox SF adoption probe",
	shortname = "coilbox_sf_probe",
	game = "Coilbox SF adoption probe",
	version = "scratch",
	description = "Reads what the runtime vendored into @BASE@ did to its start.",
	modtype = 1,
	depend = { "@BASE@" },
}
