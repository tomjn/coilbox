-- The scratch game scripts/replay-logger-headless.sh plays one fixture in. It
-- carries that fixture's gadgets and takes its units from @BASE@, the game the
-- script was told to use. @BASE@ and @NAME@ are substituted by the script.
return {
	name = "@NAME@",
	shortname = "coilbox_logger_fixture",
	game = "@NAME@",
	version = "scratch",
	description = "Plays a short scripted match for the replay logger to read back.",
	modtype = 1,
	depend = { "@BASE@" },
}
