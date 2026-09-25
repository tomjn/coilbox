local SpireBase = Unit:New {
    footprintX			    = 2,
	footprintZ			    = 2,
	mass				    = 10e5,
    pushResistant           = true,
    blocking                = false,
    canMove                 = false,
    canGuard                = false,
    canPatrol               = false,
    canRepeat               = false,
    stealth				    = true,
	turnRate			    = 0,
	upright				    = true,
    sightDistance		    = 0,
    yardMap                 = "oooooooo oooooooo oooooooo oooooooo oooooooo oooooooo oooooooo oooooooo",

    name                = "Spire base",
    script              = "spire.lua",

	 customParams        = {
		modelradius        = [[30]],
		midposoffset       = [[0 200 0]],
    },

	-- Hitbox
	collisionVolumeOffsets = "0 0 0",
	collisionVolumeScales  = "200 300 200",
	collisionVolumeType    = "cylY",

	category = "TREE",
	
	idleAutoHeal = 0,
}

local Spire = SpireBase:New {
	name                = "Spire",
	maxDamage			= 1000,
}

return lowerkeys({
    Spire = Spire,
})
