-- The scratch game scripts/rewind-headless.sh plays its fixture match in. It
-- carries one gadget, fixture_match.lua, and takes its units from @BASE@, which
-- is the Splinter Faction archive the script was told to use. @BASE@ is
-- substituted by the script.

return {
	name = "Coilbox rewind fixture",
	shortname = "coilbox_rewind_fixture",
	game = "Coilbox rewind fixture",
	version = "scratch",
	description = "Plays a short scripted match for the rewind recorder to record.",
	modtype = 1,
	depend = { "@BASE@" },
}
