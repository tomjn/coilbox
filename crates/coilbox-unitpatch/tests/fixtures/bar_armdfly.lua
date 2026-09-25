-- A representative Beyond All Reason unit file, written for these tests.
-- BAR is not installed as a loose folder on the development machine, so this
-- follows the shape its unit files have: one returned table keyed by unit.
return {
	armdfly = {
		maxacc = 0.2,
		blocking = false,
		buildpic = "ARMDFLY.DDS",
		buildtime   =   16000, -- odd spacing on purpose
		canfly = true,
		category = "ALL NOTLAND MOBILE VTOL NOTSUB NOTSHIP NOTHOVER",
		health = 1200 * 1.5,
		metalcost = 320,
		energycost = 11000;  -- a semicolon separator, which Lua allows
		name = [[Dragonfly]],
		--[[ a block comment
		     spanning two lines ]]
		customparams = {
			model_author = "Beherith",
			subfolder = "ArmAircraft",
			unitgroup = 'util',
		},
		buildoptions = {
			[1] = "armsolar",
			[2] = "armwin",
		},
		sfxtypes = {
			crashexplosiongenerators = { "crashing-small" },
		},
		weapons = {
			[1] = {
				def = "ARMDFLY_PARALYZER",
				onlytargetcategory = "NOTSUB",
			},
		},
	},
}
