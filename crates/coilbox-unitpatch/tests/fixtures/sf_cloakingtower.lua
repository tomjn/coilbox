--------------------------------------------------------------------------------

local unitName                    = "cloakingtower"

--------------------------------------------------------------------------------

local armortype					 = [[building]]

local techrequired				 = [[tech2]]

local buildCostMetal 			  = 500

local unitDef                     = {
	activateWhenBuilt             = true,
	buildAngle                    = 16384,
	buildCostEnergy               = 0,
	buildCostMetal                = buildCostMetal,
	builder                       = false,
	buildTime                     = 5,
	category                      = "BUILDING",
	description                   = [[Generates a Cloaking Field]],
	energyMake                    = 0,
	energyStorage                 = 0,
	energyUse                     = 0,
	explodeAs                     = "smallBuildingExplosionGenericPurple",
	footprintX                    = 2,
	footprintZ                    = 2,
	iconType                      = "structurecounterintelt2",
	idleAutoHeal                  = .5,
	idleTime                      = 2200,
	maxDamage                     = 100,
	maxSlope                      = 60,
	maxWaterDepth                 = 0,
	metalStorage                  = 0,
	name                          = "Cloaking Tower",
	objectName                    = "ejammer3.s3o",
	script						  = "ejammer3.cob",
	onoffable                     = true,
	radarDistanceJam              = 300,
	repairable		              = false,
	selfDestructAs                = "smallBuildingExplosionGenericPurple",
	side                          = "CORE",
	sightDistance                 = 500,
	smoothAnim                    = true,
	sonarDistance                 = 0,
	unitname                      = unitName,
	workerTime                    = 0,
	yardMap                       = "oooo oooo oooo oooo",

	customParams                  = {
		unitguide = [[The Cloaking Tower projects a 300-radius area cloaking field that conceals all friendly units within it from enemy detection. It activates instantly on completion, cloaks itself, and runs at no energy cost. It is fragile and provides no defensive capability of its own — its value is entirely in the invisibility it grants to whatever you position underneath it. A well-placed tower can make an entire defensive line or advance staging area disappear.]],
		RequireTech				 = techrequired,
		unittype				  = "building",
		unitrole				  = "Support Building",
		buildmenucategory		  = "Utility",
		cannotcloak               = false,
		needed_cover              = 3,
		death_sounds              = "generic",
		armortype                 = armortype,
		area_cloak = 1, -- Can this unit emit a cloaking field?
		area_cloak_upkeep = 0, -- How much energy does it cost to maintain the cloaking field?
		area_cloak_radius = 300, -- How large is the cloaking field?
		--area_cloak_grow_rate = 200, -- When the cloaking field is turned on, how fast does the field expand to it's full size?
	},
	useGroundDecal                = true,
	BuildingGroundDecalType       = "factorygroundplate.dds",
	BuildingGroundDecalSizeX      = 6,
	BuildingGroundDecalSizeY      = 6,
	BuildingGroundDecalDecaySpeed = 0.9,
}


--------------------------------------------------------------------------------

return lowerkeys({ [unitName]     = unitDef })

--------------------------------------------------------------------------------
