-- Self-contained mapinfo: a literal table with mixed-case keys, returned.
local mapinfo = {
    name        = "Self Contained",
    author      = "tester",
    version     = "2.1",
    voidWater   = true,
    smf = {
        minHeight = -300,
        maxHeight = 1150,
    },
    atmosphere = {
        skyColor = {0.64, 0.55, 0.43},
        fogColor = {0.07, 0.06, 0.05},
        sunColor = {1.0, 0.91, 0.75},
    },
    lighting = { sunDir = {-0.5, 0.53, -0.79} },
    water = {
        surfaceColor = {0.75, 0.8, 0.85},
        surfaceAlpha = 0.55,
    },
    terrainTypes = { [0] = { name = "Space", hardness = 1.25 } },
}
return mapinfo
