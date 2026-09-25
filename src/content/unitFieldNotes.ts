/**
 * The hand-written half of the field registry: what a field is called, what it
 * is measured in, and what it does.
 *
 * The engine supplies keys, types and defaults, and for weapons its own help
 * text as well. It does not supply a label a person would want to read, and it
 * says nothing at all about units of measure. That is what lives here.
 *
 * Three rules keep this honest:
 *
 *   - A note adds to a generated field. It never sets a key, a type or a
 *     default, so it cannot contradict the engine.
 *   - A note whose path no longer exists in the registry fails the tests, so an
 *     engine bump that renames a key cannot leave a stale description behind.
 *   - A generated field with no note here still renders. It is labelled with its
 *     key and the row says so, rather than passing the key off as a label.
 *
 * Units of measure are only stated where the engine's own source proves them,
 * either in a comment or in the arithmetic it applies to the value. An elmo is
 * the engine's world unit, and a frame is 1/30 of a second.
 *
 * Every unit field the page draws has a note as of issue #2679. What is left
 * without one is the handful of tables that other fields nest inside, which the
 * page never draws a row for, and the three name fields that have an editor of
 * their own. An engine bump that adds a key will arrive here undescribed, and
 * the page will say so until somebody reads the C++ and writes it up.
 *
 * Every sentence below came from reading the engine at the pinned tag: the read
 * itself in `UnitDef.cpp`, `UnitDefHandler.cpp` or `SolidObjectDef.cpp`, the
 * member comment in `UnitDef.h`, the code that consumes the value, or the
 * engine's own changelog entry announcing the key. Where none of those said
 * enough, the note says only what they proved and stops.
 */
import type { FieldNote } from "./unitFields";

/** Notes on unit definition fields, keyed by their dotted path. */
export const UNIT_FIELD_NOTES: Record<string, FieldNote> = {
  health: {
    label: "Health",
    help: "Hit points at full repair. A def with health at or below zero is rejected.",
  },
  maxDamage: {
    label: "Health (old name)",
    help: "The Total Annihilation spelling of health. Used only when health is absent.",
  },
  metalCost: { label: "Metal cost", unit: "metal" },
  energyCost: { label: "Energy cost", unit: "energy" },
  buildTime: {
    label: "Build time",
    help: "Divided by the build power poured into it to give the seconds a build takes.",
  },
  workerTime: {
    label: "Build power",
    help: "How fast this unit builds, repairs, reclaims and captures. Named workerTime for historical reasons.",
  },
  mass: {
    label: "Mass",
    help: "Used for collisions and for melee impulse. Defaults to the metal cost.",
  },
  buildCostMetal: {
    label: "Metal cost (old name)",
    help: "The Total Annihilation spelling. Read only when metalCost is absent.",
  },
  buildCostEnergy: {
    label: "Energy cost (old name)",
    help: "The Total Annihilation spelling. Read only when energyCost is absent.",
  },

  // Production and upkeep. The engine applies all of these on its slow update,
  // which runs every 15 frames, and halves the value each time, so what the def
  // writes is a rate per second.
  metalMake: {
    label: "Metal made",
    unit: "metal/s",
    help: "Produced whether or not the unit is switched on.",
  },
  energyMake: {
    label: "Energy made",
    unit: "energy/s",
    help: "Produced whether or not the unit is switched on.",
  },
  makesMetal: {
    label: "Metal made when on",
    unit: "metal/s",
    help: "Only produced while the unit is switched on and its upkeep was paid that tick.",
  },
  metalUpkeep: {
    label: "Metal upkeep",
    unit: "metal/s",
    help: "Drawn only while the unit is switched on. A negative number is the old way of making production conditional.",
  },
  energyUpkeep: {
    label: "Energy upkeep",
    unit: "energy/s",
    help: "Drawn only while the unit is switched on. A negative number is the old way of making production conditional.",
  },
  metalUse: {
    label: "Metal upkeep (old name)",
    unit: "metal/s",
    help: "Read only when metalUpkeep is absent.",
  },
  energyUse: {
    label: "Energy upkeep (old name)",
    unit: "energy/s",
    help: "Read only when energyUpkeep is absent.",
  },
  metalStorage: {
    label: "Metal storage",
    unit: "metal",
    help: "Added to the team's storage cap while the unit is alive.",
  },
  energyStorage: {
    label: "Energy storage",
    unit: "energy",
    help: "Added to the team's storage cap while the unit is alive.",
  },
  harvestMetalStorage: {
    label: "Harvested metal capacity",
    unit: "metal",
    help: "Above zero, metal this unit reclaims fills the unit instead of the team's pool. Filling it fires an event for the game's own Lua to unload it.",
  },
  harvestStorage: {
    label: "Harvested metal capacity (old name)",
    unit: "metal",
    help: "Read only when harvestMetalStorage is absent.",
  },
  harvestEnergyStorage: {
    label: "Harvested energy capacity",
    unit: "energy",
    help: "Read and stored, but the engine only implements harvesting for metal.",
  },
  extractsMetal: {
    label: "Extraction depth",
    help: "How hard this extractor draws on the metal under it. The ground it covers comes from the map's own extractor radius, not from the unit.",
  },
  windGenerator: {
    label: "Wind generation cap",
    unit: "energy/s",
    help: "The unit makes the map's current wind strength as energy, capped at this. Zero is not a wind generator.",
  },
  tidalGenerator: {
    label: "Tidal generation",
    help: "Multiplied by the map's tidal strength to give energy per second. Zero is not a tidal generator.",
  },
  onoffable: {
    label: "Can be switched off",
    help: "Gives the player the on and off toggle, which is what gates upkeep and everything that depends on it.",
  },
  activateWhenBuilt: {
    label: "Starts switched on",
    help: "Whether the unit is already on the moment it finishes building.",
  },
  builder: {
    label: "Is a builder",
    help: "Offers the build orders. The engine only counts the unit as a builder if it also has build power and build range.",
  },
  buildRange3D: {
    label: "Build range is a sphere",
    help: "Off, build range is an infinite cylinder and height costs nothing. On, it is a sphere, so a builder above or below its target reaches less far.",
  },
  buildeeBuildRadius: {
    label: "Radius when being built",
    unit: "elmo",
    help: "How close a builder has to get to work on this unit. Negative uses the model's own radius, and zero makes builders reach its centre.",
  },
  canAssist: {
    label: "Can assist",
    help: "Can pour build power into somebody else's unfinished unit. Off, it can still start its own nanoframes but cannot resume one it was interrupted on.",
  },
  canBeAssisted: {
    label: "Can be assisted",
    help: "Whether another builder may help build this one.",
  },
  canRepair: {
    label: "Can repair",
    help: "Also needs a repair speed above zero.",
  },
  canReclaim: {
    label: "Can reclaim",
    help: "Also needs a reclaim speed above zero.",
  },
  canRestore: {
    label: "Can restore terrain",
    help: "Also needs a terraform speed above zero.",
  },
  canResurrect: {
    label: "Can resurrect",
    help: "Also needs a resurrect speed above zero. Off by default even for builders, since that speed defaults to their build power.",
  },
  canCapture: {
    label: "Can capture",
    help: "Also needs a capture speed above zero. Off by default even for builders, since that speed defaults to their build power.",
  },
  repairSpeed: {
    label: "Repair speed",
    help: "Build power spent repairing. Defaults to the unit's build power.",
  },
  maxRepairSpeed: {
    label: "Repair received cap",
    help: "The most repair this unit will take from all its repairers at once. The default is high enough to be no cap.",
  },
  reclaimSpeed: {
    label: "Reclaim speed",
    help: "Defaults to the unit's build power.",
  },
  resurrectSpeed: {
    label: "Resurrect speed",
    help: "Defaults to the unit's build power.",
  },
  captureSpeed: {
    label: "Capture speed",
    help: "Defaults to the unit's build power.",
  },
  terraformSpeed: {
    label: "Terraform speed",
    help: "Defaults to the unit's build power.",
  },
  repairable: { label: "Can be repaired" },
  reclaimable: { label: "Can be reclaimed" },
  capturable: { label: "Can be captured" },
  fullHealthFactory: {
    label: "Holds units until fully healed",
    help: "A factory keeps working on a finished unit until it is at full health before letting it leave.",
  },
  showNanoFrame: {
    label: "Show the nanoframe",
    help: "Whether the wireframe build animation is drawn while this unit is under construction.",
  },
  showNanoSpray: {
    label: "Show nano spray",
    help: "Whether a builder's stream of particles is drawn at all.",
  },

  // The engine comment above the read states the unit for each of these four.
  speed: { label: "Speed", unit: "elmo/s" },
  maxVelocity: { label: "Speed (old name)", unit: "elmo/frame" },
  rSpeed: { label: "Reverse speed", unit: "elmo/s" },
  maxReverseVelocity: { label: "Reverse speed (old name)", unit: "elmo/frame" },
  maxAcc: { label: "Acceleration", unit: "elmo/frame²" },
  acceleration: { label: "Acceleration (old name)", unit: "elmo/frame²" },
  maxDec: { label: "Braking", unit: "elmo/frame²" },
  brakeRate: { label: "Braking (old name)", unit: "elmo/frame²" },

  // A heading is a 16 bit angle, so a full turn is 65536 of them. The engine
  // works the turn out as (turnRate / 65536) * 360 degrees in a frame.
  turnRate: {
    label: "Turn rate",
    unit: "COB angle/frame",
    help: "65536 COB angle units is a full turn, so 182 here is a degree per frame, or 30 degrees a second.",
  },
  turnInPlace: {
    label: "Turns on the spot",
    help: "On, the unit slows down for a turn sharper than its angle limit. Off, it keeps rolling and swings round in an arc.",
  },
  turnInPlaceAngleLimit: {
    label: "Turn without slowing",
    unit: "degrees",
    help: "For a unit that turns on the spot, the sharpest turn it will take at full speed. Anything sharper slows it down.",
  },
  turnInPlaceSpeedLimit: {
    label: "Slowest speed in a turn",
    unit: "elmo/s",
    help: "For a unit that does not turn on the spot, the speed it will not drop below while turning. Defaults to whatever its turn rate can hold.",
  },
  upDirSmoothing: {
    label: "Tilt smoothing",
    help: "How much of the old tilt to keep when the ground under the unit changes, from 0 for an instant snap to the slope up to 0.95. Anything higher is clamped.",
  },
  slideTolerance: {
    label: "Slide tolerance",
    help: "Multiplies the move class's maximum slope when deciding the unit is on ground too steep to hold, so above 1 it clings to steeper ground. Zero turns sliding off.",
  },
  minCollisionSpeed: {
    label: "Collision damage threshold",
    unit: "elmo/frame",
    help: "How hard an impact has to be before it does damage. Negative means the unit never takes collision damage.",
  },
  myGravity: {
    label: "Gravity",
    help: "Gravity for this aircraft on its own. The engine's comment says planes are slower than real ones, so the default is lowered to compensate.",
  },
  useSmoothMesh: {
    label: "Fly over the smoothed map",
    help: "An aircraft holds height against a smoothed version of the terrain rather than every bump of it.",
  },
  holdSteady: {
    label: "Passengers follow the piece",
    help: "A transport with this on turns each passenger with the model piece carrying it. Off, they all take the transport's own heading.",
  },
  releaseHeld: {
    label: "Passengers survive its death",
    help: "Off, everything aboard is killed with the transport. On, passengers are dropped and it is up to the game's Lua to deal with where they land.",
  },
  floater: {
    label: "Floats on water",
    help: "Only read for a unit with no movement class, which is anything immobile or flying. Defaults to on if the def has a WaterLine key at all.",
  },
  WaterLine: {
    label: "Waterline (presence only)",
    help: "The engine never reads this value. All it checks is whether the key exists, which is the old way of saying a unit floats.",
  },
  canSubmerge: {
    label: "Can submerge",
    help: "Only has an effect on a unit that flies. The engine drops it for anything else.",
  },
  upright: {
    label: "Stays upright",
    help: "The unit keeps a level body instead of leaning with the ground. Forced on for anything that cannot fly and has no movement class.",
  },
  moveState: {
    label: "Starting move state",
    help: "0 hold position, 1 maneuver, 2 roam. At -1 the unit copies the move state of whatever built it, or maneuvers if nothing did.",
  },
  canFight: { label: "Has the fight order" },
  canPatrol: { label: "Has the patrol order" },
  canGuard: { label: "Has the guard order" },
  canRepeat: { label: "Has the repeat toggle" },
  separationDistance: {
    label: "Separation distance",
    unit: "elmo",
    help: "An extra gap the unit keeps from other moving units, on top of its own size. The engine suggests 32 or less. It does not affect pathing near buildings or terrain.",
  },

  canFly: { label: "Flies" },
  airStrafe: {
    label: "Weaves while circling",
    help: "A gunship circling or attacking keeps picking new points around the circle rather than holding one spot.",
  },
  airHoverFactor: {
    label: "Hover drift",
    help: "Below zero the aircraft lands. Zero or above keeps it airborne and says how much it wanders while hovering on the spot.",
  },
  bankingAllowed: {
    label: "Banks into turns",
  },
  maxBank: { label: "Maximum roll" },
  maxPitch: {
    label: "Maximum pitch",
    help: "The pitch this plane tries to hold.",
  },
  maxAileron: { label: "Roll speed" },
  maxElevator: { label: "Pitch speed" },
  maxRudder: { label: "Yaw speed" },
  wingAngle: {
    label: "Wing angle",
    help: "The angle between the plane's nose and the flat of its wings. It sets the direction lift pulls in and it is squared into the wing drag.",
  },
  wingDrag: {
    label: "Wing drag",
    help: "Drag caused by the wings. Clamped to 0 up to 1.",
  },
  crashDrag: {
    label: "Crash drag",
    help: "The drag used once the aircraft is going down. Clamped to 0 up to 1.",
  },
  cruiseAltitude: {
    label: "Cruise altitude",
    unit: "elmo",
    help: "The height a gunship holds above the ground.",
  },
  cruiseAlt: {
    label: "Cruise altitude (old name)",
    unit: "elmo",
    help: "Read only when cruiseAltitude is absent.",
  },
  verticalSpeed: {
    label: "Climb and descent speed",
    help: "The speed of takeoff and landing, at least for a gunship.",
  },
  turnRadius: {
    label: "Turn radius",
    unit: "elmo",
    help: "A hint to the fixed wing movement code about the circle this plane needs. Doubled for a bomber that leaves it at the default.",
  },
  // The engine gives both of these the same one line comment and nothing else,
  // so neither note claims to know which way round they pull.
  frontToSpeed: {
    label: "Nose and velocity alignment",
    help: "The engine calls this a fudge factor for lining up a plane's speed and the way its nose points.",
  },
  speedToFront: {
    label: "Nose and velocity alignment (second factor)",
    help: "The engine calls this a fudge factor for lining up a plane's speed and the way its nose points.",
  },
  canLoopbackAttack: {
    label: "Loops back to attack",
    help: "Only matters for a fighter.",
  },
  factoryHeadingTakeoff: {
    label: "Takes off facing the factory",
    help: "An aircraft leaving a factory keeps the factory's heading while it climbs.",
  },

  transportCapacity: { label: "Passenger slots" },
  transportSize: {
    label: "Largest passenger footprint",
    unit: "build squares",
    help: "The biggest footprint this transport will pick up.",
  },
  minTransportSize: {
    label: "Smallest passenger footprint",
    unit: "build squares",
  },
  transportMass: { label: "Passenger mass capacity" },
  minTransportMass: { label: "Smallest passenger mass" },
  loadingRadius: {
    label: "Loading radius",
    unit: "elmo",
    help: "How close the transport gets before it starts picking a unit up.",
  },
  unloadSpread: {
    label: "Unload spread",
    help: "Multiplies each passenger's radius to decide how far apart they are put down.",
  },
  transportUnloadMethod: {
    label: "Unload method",
    help: "0 land and unload, 1 drop on a flyover, 2 land and flood out.",
  },
  transportByEnemy: {
    label: "Enemies can carry it",
  },
  cantBeTransported: {
    label: "Cannot be carried",
    help: "Defaults to on for anything with no ground movement, and the game's transport settings can force it on for a whole move class.",
  },

  // Clamped to 0..89 and then converted with DEG_TO_RAD.
  maxSlope: {
    label: "Maximum slope",
    unit: "degrees",
    help: "The steepest ground the unit will climb. Clamped to 89.",
  },
  minWaterDepth: { label: "Minimum water depth", unit: "elmo" },
  maxWaterDepth: { label: "Maximum water depth", unit: "elmo" },
  waterline: {
    label: "Waterline",
    unit: "elmo",
    help: "How deep the model sits when floating.",
  },

  sightDistance: { label: "Line of sight", unit: "elmo" },
  airSightDistance: {
    label: "Air line of sight",
    unit: "elmo",
    help: "Defaults to one and a half times the ground sight distance.",
  },
  radarDistance: { label: "Radar range", unit: "elmo" },
  sonarDistance: { label: "Sonar range", unit: "elmo" },
  radarDistanceJam: { label: "Radar jamming range", unit: "elmo" },
  sonarDistanceJam: { label: "Sonar jamming range", unit: "elmo" },
  seismicDistance: { label: "Seismic range", unit: "elmo" },
  seismicSignature: {
    label: "Seismic signature",
    help: "How loud this unit is to a seismic sensor when it moves. At -1 the engine works one out from the mass, but only for a tank or a bot, and everything else gets nothing.",
  },
  sightEmitHeight: {
    label: "Sight height",
    unit: "elmo",
    help: "How far above the unit its line of sight is measured from, so it can see over a rise.",
  },
  losEmitHeight: {
    label: "Sight height (old name)",
    unit: "elmo",
    help: "Read only when sightEmitHeight is absent.",
  },
  radarEmitHeight: {
    label: "Radar height",
    unit: "elmo",
    help: "The same idea for radar. Defaults to the sight height.",
  },
  leavesGhost: {
    label: "Leaves a ghost",
    help: "Whether the enemy keeps seeing an outline of it after it drops out of sight. Defaults to on for a building.",
  },
  stealth: {
    label: "Radar stealth",
    help: "Radar cannot pick the unit up at all. A unit still being built is not stealthed.",
  },
  sonarStealth: {
    label: "Sonar stealth",
    help: "Sonar cannot pick the unit up.",
  },
  canCloak: {
    label: "Can cloak",
    help: "Defaults to on when a cloak cost is set.",
  },
  initCloaked: { label: "Starts cloaked" },
  cloakCost: {
    label: "Cloak cost",
    unit: "energy/s",
    help: "Drawn while cloaked and standing still.",
  },
  cloakCostMoving: {
    label: "Cloak cost moving",
    unit: "energy/s",
    help: "Drawn while cloaked and moving. Defaults to the standing cost.",
  },
  decloakOnFire: { label: "Decloaks on firing" },
  decloakSpherical: {
    label: "Decloak range is a sphere",
    help: "On, the decloak check is a sphere. Off, it is a cylinder, so height does not count.",
  },
  buildDistance: {
    label: "Build range",
    unit: "elmo",
    help: "Raised to 38 if set lower, the least that lets a 1x1 builder reach a 1x1 building.",
  },
  minCloakDistance: {
    label: "Decloak distance",
    unit: "elmo",
    help: "How close an enemy has to get before the unit decloaks.",
  },
  kamikazeDistance: { label: "Kamikaze trigger distance", unit: "elmo" },

  // The engine multiplies both by UNIT_SLOWUPDATE_RATE / GAME_SPEED, so the
  // value written in the def is per second.
  autoHeal: { label: "Self repair", unit: "HP/s" },
  idleAutoHeal: {
    label: "Idle self repair",
    unit: "HP/s",
    help: "Applied once the unit has been idle for idleTime.",
  },
  // Read as an int and used directly as a frame count.
  idleTime: {
    label: "Idle before self repair",
    unit: "frames",
    help: "600 frames is 20 seconds.",
  },
  canSelfRepair: {
    label: "Repairs itself",
    help: "Lets a builder spend its own build power on its own damage.",
  },
  damageModifier: {
    label: "Armoured damage multiplier",
    help: "The multiplier on incoming damage while the unit's script has put it in its armoured state. 0.5 halves the damage taken.",
  },
  hideDamage: {
    label: "Hide health from enemies",
    help: "A player who is not an ally sees no health bar and no health in the tooltip.",
  },
  crushResistance: {
    label: "Crush resistance",
    help: "Anything whose move class has more crush strength than this runs the unit over. Defaults to the mass.",
  },
  flankingBonusMode: {
    label: "Flanking bonus mode",
    help: "0 off, 1 the protected direction is in map coordinates, 2 it is in unit coordinates and may move, 3 it is in unit coordinates and is locked.",
  },
  flankingBonusDir: {
    label: "Best protected direction",
    help: "The direction the unit takes least damage from, which is what makes flanking it worthwhile.",
  },
  flankingBonusMin: {
    label: "Damage from the protected side",
    help: "The damage multiplier for a hit from the best protected direction.",
  },
  flankingBonusMax: {
    label: "Damage from the exposed side",
    help: "The damage multiplier for a hit from the least protected direction.",
  },
  flankingBonusMobilityAdd: {
    label: "Flanking direction mobility",
    help: "How much of the protected direction's ability to move builds up each frame, in the modes that let it move.",
  },

  canSelfDestruct: { label: "Has the self destruct order" },
  selfDestructCountdown: { label: "Self destruct countdown", unit: "s" },
  kamikaze: {
    label: "Kamikaze",
    help: "The unit blows itself up when an enemy comes inside its trigger distance.",
  },
  kamikazeUseLOS: {
    label: "Kamikaze needs line of sight",
    help: "On, only an enemy the unit can actually see sets it off.",
  },
  fallSpeed: {
    label: "Passenger fall speed",
    help: "How fast units dropped from this transport come down.",
  },
  unitFallSpeed: {
    label: "Own fall speed",
    help: "How fast this unit falls when it is the one being dropped. Overrides the transport's own setting.",
  },
  "SFXTypes.explosionGenerators": {
    label: "Explosion effects",
    help: "The effects the unit's script can set off by index. Each entry carries its own prefix, so a custom one is written as custom:mygenerator. At most 32 are read.",
  },
  "SFXTypes.pieceExplosionGenerators": {
    label: "Piece explosion effects",
    help: "The effects used when a model piece is blown off. These can only be custom ones, so the custom: prefix is added by the engine. At most 32 are read.",
  },
  "SFXTypes.crashExplosionGenerators": {
    label: "Crash effects",
    help: "The effects used while an aircraft is going down. These can only be custom ones, so the custom: prefix is added by the engine. At most 32 are read.",
  },

  canAttack: { label: "Has the attack order" },
  canManualFire: {
    label: "Has a special weapon",
    help: "Gives the unit the manual fire order, which is what a commander's disintegrator gun uses.",
  },
  canDGun: {
    label: "Has a special weapon (old name)",
    help: "Read only when canManualFire is absent.",
  },
  fireState: {
    label: "Starting fire state",
    help: "0 hold fire, 1 return fire, 2 fire at will, 3 fire at neutral. At -1 the unit copies the fire state of whatever built it.",
  },
  noAutoFire: {
    label: "Fire state is fixed",
    help: "Takes away the player's hold fire and return fire buttons, and makes the unit default to fire at will.",
  },
  stopToAttack: {
    label: "Stops to shoot",
  },
  strafeToAttack: {
    label: "Sidesteps to get a shot",
    help: "The unit moves sideways when it cannot shoot from where it is.",
  },
  hoverAttack: {
    label: "Attacks from a hover",
    help: "An aircraft holds position to shoot instead of making passes. It also decides which of the two aircraft movement types the unit gets.",
  },
  highTrajectory: {
    label: "Arc of fire",
    help: "0 low only, 1 high only, 2 the player chooses.",
  },
  canDropFlare: {
    label: "Drops flares",
    help: "The unit throws out a decoy whenever a missile comes at it.",
  },
  flareReload: {
    label: "Flare reload",
    unit: "s",
    help: "The wait before the unit can drop another flare.",
  },
  flareDelay: {
    label: "Flare arming delay",
    help: "Multiplied by a random 1 to 2 and then by 15 frames, so 1 here is between half a second and a second before the flare starts working.",
  },
  flareEfficiency: {
    label: "Flare efficiency",
    help: "The chance, from 0 to 1, that each incoming missile is fooled into chasing the flare instead.",
  },
  flareSalvoSize: {
    label: "Flares per drop",
  },
  flareDropVector: {
    label: "Flare launch direction",
    help: "Extra velocity given to the flare, along the unit's own right, up and forward axes.",
  },
  // Both are multiplied by GAME_SPEED, so the def writes seconds.
  flareTime: { label: "Flare lifetime", unit: "s" },
  flareSalvoDelay: { label: "Flare salvo delay", unit: "s" },

  footprintX: {
    label: "Footprint width",
    unit: "build squares",
    help: "One build square is 16 elmos.",
  },
  footprintZ: {
    label: "Footprint depth",
    unit: "build squares",
    help: "One build square is 16 elmos.",
  },
  yardMap: {
    label: "Yard map",
    help: "One character per footprint square saying what may pass or be built there. Prefix with h for a half-square grid.",
  },
  buildingMask: {
    label: "Building mask",
    help: "A bit mask matched against the mask the game's Lua has painted on each map square. A building only goes down where the two share a bit. Bit 1 is the ordinary case.",
  },
  levelGround: {
    label: "Flattens the ground",
    help: "The ground under the building is levelled when it goes up. Only matters for a building.",
  },
  useGroundDecal: {
    label: "Leaves a ground mark",
    help: "Draws a stain under the unit while it stands there.",
  },
  groundDecalType: {
    label: "Ground mark texture",
    help: "A texture file. With no extension the engine adds .bmp, and it looks for the file as written, then under bitmaps/, then under unittextures/.",
  },
  groundDecalSizeX: {
    label: "Ground mark width",
    unit: "build squares",
    help: "Multiplied by 8 elmos to give the distance from the centre to each edge, so 4 draws a mark 64 elmos across.",
  },
  groundDecalSizeY: {
    label: "Ground mark depth",
    unit: "build squares",
    help: "Multiplied by 8 elmos to give the distance from the centre to each edge.",
  },
  groundDecalDecaySpeed: {
    label: "Ground mark fade rate",
    help: "How much alpha the mark loses each second once the unit is gone.",
  },
  useBuildingGroundDecal: {
    label: "Leaves a ground mark (old name)",
    help: "Read only when useGroundDecal is absent.",
  },
  buildingGroundDecalType: {
    label: "Ground mark texture (old name)",
    help: "Read only when groundDecalType is absent.",
  },
  buildingGroundDecalSizeX: {
    label: "Ground mark width (old name)",
    unit: "build squares",
  },
  buildingGroundDecalSizeY: {
    label: "Ground mark depth (old name)",
    unit: "build squares",
  },
  buildingGroundDecalDecaySpeed: {
    label: "Ground mark fade rate (old name)",
  },

  collide: {
    label: "Collides with units",
    help: "Off, other units pass straight through this one.",
  },
  blocking: {
    label: "Blocks the ground",
    help: "Whether the unit takes up space that other units and buildings have to work around.",
  },
  pushResistant: {
    label: "Resists being pushed",
    help: "Other units cannot shove this one out of the way while it is holding its ground.",
  },
  groundFrictionCoefficient: {
    label: "Ground friction",
    help: "Slows a unit down while it is skidding.",
  },
  rollingResistanceCoefficient: {
    label: "Rolling resistance",
    help: "Slows a unit down while it is going faster than its own maximum speed, which is what brings it back down to that speed.",
  },
  atmosphericDragCoefficient: {
    label: "Air drag",
    help: "Slows a unit down while it is skidding or over its maximum speed.",
  },
  collisionVolumeType: {
    label: "Collision volume shape (flat spelling)",
    help: "The first character is the shape and the last is the axis, so cylY is a cylinder on y. Read only when there is no collisionVolume table.",
  },
  collisionVolumeScales: {
    label: "Collision volume size (flat spelling)",
    unit: "elmo",
    help: "Read only when there is no collisionVolume table.",
  },
  collisionVolumeOffsets: {
    label: "Collision volume offset (flat spelling)",
    unit: "elmo",
    help: "Read only when there is no collisionVolume table.",
  },
  usePieceCollisionVolumes: {
    label: "Hit the model's pieces",
    help: "Shots are tested against each model piece instead of one volume around the whole unit, and the main volume stops taking hits.",
  },
  useFootPrintCollisionVolume: {
    label: "Use the footprint as the volume",
    help: "The collision volume is taken from the footprint rather than from the numbers above.",
  },
  "selectionVolume.type": {
    label: "Selection volume shape",
    help: "The volume the mouse has to hit to pick the unit, which need not match the one shots are tested against. A character: b box, e ellipsoid, c cylinder, s sphere.",
  },
  "selectionVolume.axis": {
    label: "Selection volume axis",
    help: "A character: x, y or z. Only meaningful for a cylinder.",
  },
  "selectionVolume.scales": { label: "Selection volume size", unit: "elmo" },
  "selectionVolume.offsets": {
    label: "Selection volume offset",
    unit: "elmo",
    help: "From the model's centre.",
  },
  selectionVolumeType: {
    label: "Selection volume shape (flat spelling)",
    help: "The first character is the shape and the last is the axis. Read only when there is no selectionVolume table, and it falls back to the collision volume's spelling.",
  },
  selectionVolumeScales: {
    label: "Selection volume size (flat spelling)",
    unit: "elmo",
    help: "Falls back to the collision volume's size.",
  },
  selectionVolumeOffsets: {
    label: "Selection volume offset (flat spelling)",
    unit: "elmo",
    help: "Falls back to the collision volume's offset.",
  },
  usePieceSelectionVolumes: {
    label: "Select on the model's pieces",
    help: "The mouse is tested against each model piece instead of one volume around the whole unit.",
  },
  useFootPrintSelectionVolume: {
    label: "Select on the footprint",
    help: "The selection volume is taken from the footprint rather than from the numbers above.",
  },

  objectName: {
    label: "Model",
    help: "The model file under objects3d/.",
    asset: "model",
  },
  script: {
    label: "Unit script",
    help: "Resolved under scripts/, defaulting to the unit name with a .cob suffix.",
    asset: "script",
  },
  buildPic: {
    label: "Build picture",
    help: "The picture under unitpics/. With none, the engine looks for one named after the unit.",
    asset: "picture",
  },
  iconType: {
    label: "Map icon",
    // Not a path, so deliberately not an asset field. Beyond All Reason writes
    // "armaak" here and Balanced Annihilation "armcommander", and both name an
    // entry in the game's own icon table rather than a file.
    help: "Names an entry in the game's gamedata/icontypes.lua, not a file.",
  },
  corpse: { label: "Wreck", help: "The feature left behind on death." },
  explodeAs: { label: "Death explosion", help: "A weapon definition name." },
  selfDestructAs: {
    label: "Self destruct explosion",
    help: "A weapon definition name. Falls back to explodeAs.",
  },
  category: { label: "Categories", help: "Space separated category names." },
  noChaseCategory: {
    label: "Will not chase",
    help: "Space separated category names this unit refuses to pursue.",
  },
  cobID: {
    label: "COB identifier",
    help: "The number the unit's own script reads back from GET COB_ID. Only the game's scripts give it meaning.",
  },
  decoyFor: {
    label: "Disguised as",
    help: "Names the unit this one pretends to be. An enemy sees that unit's model and name instead of this one's.",
  },
  power: {
    label: "Power",
    help: "What the unit is worth when experience is shared out after a kill. Defaults to the metal cost plus a sixtieth of the energy cost, and the engine floors it just above zero.",
  },
  maxThisUnit: {
    label: "Maximum in play",
    help: "How many of this unit one team may have alive at once. The game's own restrictions can lower it further but never raise it.",
  },
  unitRestricted: {
    label: "Maximum in play (old name)",
    help: "Read only when maxThisUnit is absent.",
  },
  isFeature: {
    label: "Turns into its wreck",
    help: "The moment this unit finishes building it is replaced by the feature named in its wreck field. It is how a game builds a rock or a wall.",
  },
  isFirePlatform: {
    label: "Passengers can shoot",
    help: "Units being carried by this transport keep firing.",
  },
  isTargetingUpgrade: {
    label: "Targeting facility",
    help: "While switched on, this unit shrinks its ally team's radar targeting error.",
  },
  showPlayerName: {
    label: "Show the player's name",
    help: "The tooltip and the selection label read the owning player's name instead of the unit's.",
  },
  canMove: {
    label: "Can move",
    help: "Whether the unit moves at all. A unit with this on and no movement class is dropped at load.",
  },
  movementClass: {
    label: "Movement class",
    help: "Names an entry in the game's move definitions. Required for a ground unit.",
  },
  customParams: {
    label: "Custom parameters",
    help: "Arbitrary key and value pairs the engine ignores. Only the game's own Lua gives them meaning.",
  },

  "sounds.select": { label: "Selected sound" },
  "sounds.ok": { label: "Order acknowledged sound" },
  "sounds.arrived": { label: "Arrived sound" },
  "sounds.cant": { label: "Order refused sound" },
  "sounds.underattack": { label: "Under attack sound" },
  "sounds.build": { label: "Building sound" },
  "sounds.activate": { label: "Switched on sound" },
  "sounds.deactivate": { label: "Switched off sound" },
  // A sound key holds either a file name or a numbered list of tables, and the
  // engine picks one of the list at random each time it plays.
  "sounds.*.*.file": {
    label: "Sound file",
    help: "One of several the engine picks between. Give the sound key a numbered list of tables to use this.",
  },
  "sounds.*.*.volume": {
    label: "Sound volume",
    help: "A sound set to zero volume is dropped rather than played quietly.",
  },

  nanoColor: {
    label: "Nano spray colour",
    help: "Red, green and blue from 0 to 1.",
  },
  leaveTracks: {
    label: "Leaves tracks",
    help: "Draws a trail on the ground behind the unit as it moves.",
  },
  trackType: {
    label: "Track texture",
    help: "A texture in bitmaps/tracks/. Only the base name is used, so the folder and the extension can be left off.",
  },
  trackWidth: { label: "Track width", unit: "elmo" },
  trackOffset: {
    label: "Track offset",
    unit: "elmo",
    help: "How far in front of the unit's centre the track is laid.",
  },
  trackStrength: {
    label: "Track lifetime",
    help: "Multiplied by 90 frames to give how long a track lasts, so 1 is three seconds. Zero leaves no track at all.",
  },
  trackStretch: {
    label: "Track texture stretch",
    help: "Multiplies the track width to decide how far the texture runs before it repeats.",
  },

  "weapons.*.name": {
    label: "Weapon",
    help: "Names an entry in the game's weapon definitions.",
  },
  "weapons.*.slaveTo": {
    label: "Slaved to weapon",
    help: "Counting from one, the mount on this unit whose target this weapon copies. Zero leaves it picking its own.",
  },
  "weapons.*.mainDir": {
    label: "Firing arc centre",
    help: "The direction the arc is measured from, in the unit's own coordinates. The default points forward.",
  },
  "weapons.*.maxAngleDif": {
    label: "Firing arc",
    unit: "degrees",
    help: "The full width of the arc around the arc centre, so 360 is no restriction and 90 is 45 degrees either side.",
  },
  "weapons.*.onlyTargetCategory": {
    label: "Only shoots at",
    help: "Space separated category names. Empty means anything.",
  },
  "weapons.*.badTargetCategory": {
    label: "Poor targets",
    help: "Space separated category names this weapon will shoot only as a last resort.",
  },
  "weapons.*.weaponAimAdjustPriority": {
    label: "Prefers targets it already faces",
    help: "A multiplier on how much target picking favours whatever the weapon is already aimed at.",
  },
  "weapons.*.fastAutoRetargeting": {
    label: "Retargets immediately",
    help: "Picks a new target the moment the current one dies rather than waiting for the next half second check. Costs more processing.",
  },
  "weapons.*.fastQueryPointUpdate": {
    label: "Checks its muzzle every frame",
    help: "Asks the unit script which piece it is firing from before every friendly fire check, rather than twice a second.",
  },
  "weapons.*.burstControlWhenOutOfArc": {
    label: "Burst outside the arc",
    help: "0 fires the rest of the burst wherever the target went, 1 wastes those shots, 2 keeps firing in whatever direction the muzzle already points.",
  },
  "weapons.*.accurateLeading": {
    label: "Leading accuracy",
    help: "How much work goes into aiming ahead of a moving target. 0 undershoots anything closing or running, 1 solves it exactly for a flat shot, and more adds passes for an arcing one.",
  },

  "collisionVolume.type": {
    label: "Collision volume shape",
    help: "A character: b box, e ellipsoid, c cylinder, s sphere.",
  },
  "collisionVolume.axis": {
    label: "Collision volume axis",
    help: "A character: x, y or z. Only meaningful for a cylinder.",
  },
  "collisionVolume.scales": { label: "Collision volume size", unit: "elmo" },
  "collisionVolume.offsets": {
    label: "Collision volume offset",
    unit: "elmo",
    help: "From the model's centre.",
  },
};

/**
 * Notes on weapon definition fields. The engine already writes a description
 * for every tagged weapon key, so this adds labels and the units of measure
 * those descriptions only mention in passing.
 */
export const WEAPON_FIELD_NOTES: Record<string, FieldNote> = {
  name: { label: "Display name" },
  weaponType: { label: "Weapon type" },
  range: { label: "Range", unit: "elmo" },
  reloadTime: { label: "Reload time", unit: "s" },
  burstRate: { label: "Delay between shots in a burst", unit: "s" },
  burst: { label: "Shots per burst" },
  projectiles: { label: "Projectiles per shot" },
  weaponVelocity: { label: "Projectile speed", unit: "elmo/s" },
  maxVelocity: { label: "Projectile speed (old name)", unit: "elmo/s" },
  startvelocity: { label: "Starting speed", unit: "elmo/s" },
  weaponacceleration: { label: "Projectile acceleration", unit: "elmo/s²" },
  turnrate: {
    label: "Tracking turn rate",
    unit: "COB angle/s",
    help: "65536 COB angle units is a full turn.",
  },
  tolerance: {
    label: "Firing cone",
    unit: "COB angle",
    help: "65536 COB angle units is a full turn. Only used when turret is off.",
  },
  firetolerance: { label: "Reaim threshold", unit: "COB angle" },
  flighttime: { label: "Projectile lifetime", unit: "s" },
  weaponTimer: { label: "Ascent time", unit: "s" },
  windup: { label: "Windup", unit: "s" },
  areaOfEffect: {
    label: "Splash diameter",
    unit: "elmo",
    help: "A diameter, not a radius.",
  },
  craterAreaOfEffect: { label: "Crater diameter", unit: "elmo" },
  damage: {
    label: "Damage",
    help: "One entry per armour class. The default entry covers the rest.",
  },
  customParams: {
    label: "Custom parameters",
    help: "Arbitrary key and value pairs the engine ignores. Only the game's own Lua gives them meaning.",
  },
  acceleration: {
    label: "Projectile acceleration (old name)",
    unit: "elmo/s²",
  },
  accuracy: {
    label: "Burst accuracy",
    help: "Higher is less accurate. 0 is perfect. Improves with the firing unit's experience.",
  },
  allowNonBlockingAim: {
    label: "Aims without blocking fire",
    help: "Off, the weapon can't fire until AimWeapon() returns in the unit's script.",
  },
  alphaDecay: {
    label: "Cannon stage fade",
    help: "Cannon only. How much the last stage's alpha fades, blended for the ones in between. See stages.",
  },
  alwaysVisible: {
    label: "Always visible",
    help: "Draws the projectile even outside sight.",
  },
  animParams: {
    label: "Flipbook animation (old name)",
    help: "Frame columns, rows and playback rate for texture1's flipbook animation, and the default for texture2, 3 and 4 too.",
  },
  animParams1: {
    label: "Flipbook animation (texture 1)",
    help: "Frame columns, rows and playback rate for texture1's flipbook animation.",
  },
  animParams2: {
    label: "Flipbook animation (texture 2)",
    help: "Frame columns, rows and playback rate for texture2's flipbook animation.",
  },
  animParams3: {
    label: "Flipbook animation (texture 3)",
    help: "Frame columns, rows and playback rate for texture3's flipbook animation.",
  },
  animParams4: {
    label: "Flipbook animation (texture 4)",
    help: "Frame columns, rows and playback rate for texture4's flipbook animation.",
  },
  avoidCloaked: {
    label: "Avoids firing through cloaked units",
    help: "See avoidFriendly for how avoiding differs from colliding.",
  },
  avoidFeature: { label: "Avoids firing through features" },
  avoidFriendly: {
    label: "Avoids firing through allies",
    help: "An ally can still walk into the projectile after it's fired; use collideFriendly to stop the explosion happening at all.",
  },
  avoidGround: { label: "Avoids firing through blocking terrain" },
  avoidNeutral: {
    label: "Avoids firing through neutral units",
    help: "Does not include Gaia.",
  },
  beamburst: {
    label: "Beam fires in bursts",
    help: "BeamLaser only. Uses burst mechanics, with beamtime forced to the length of one sim frame.",
  },
  beamDecay: {
    label: "Beam fade per frame",
    help: "BeamLaser only. Alpha multiplier applied every sim frame.",
  },
  beamtime: {
    label: "Beam duration",
    unit: "s",
    help: "BeamLaser only. Damage is spread out over this time.",
  },
  beamTTL: {
    label: "Beam sprite linger time",
    unit: "frames",
    help: "BeamLaser and LightningCannon only.",
  },
  bounceExplosionGenerator: {
    label: "Bounce effect",
    help: "Name, with prefix, of the custom explosion generator played when the projectile bounces.",
  },
  bounceRebound: {
    label: "Bounce vertical rebound",
    help: "Multiplies vertical velocity when the projectile bounces.",
  },
  bounceSlip: {
    label: "Bounce horizontal slip",
    help: "Multiplies horizontal velocity when the projectile bounces.",
  },
  burnblow: {
    label: "Explodes at end of flight",
    help: "LaserCannon expires at the target instead of at max range. Cannon explodes on reaching the target instead of falling. Missile, Starburst and TorpedoLauncher explode when out of fuel instead of falling.",
  },
  cameraShake: {
    label: "Camera shake strength",
    help: "Passed to widgets so they can shake the camera on a strong hit. Uses the same scale as damage.",
  },
  canAttackGround: {
    label: "Can target ground",
    help: "Off, only units can be targeted. Features are never directly targetable either way.",
  },
  castShadow: { label: "Projectile casts a shadow" },
  cegTag: {
    label: "Trail effect",
    help: "Name, without prefix, of a custom explosion generator emitted by the projectile every frame.",
  },
  collideCloaked: {
    label: "Collides with cloaked units",
    help: "See collideFriendly for how colliding differs from avoiding.",
  },
  collideEnemy: {
    label: "Collides with enemies",
    help: "Off, the projectile passes through enemies without exploding. Targeting still always picks enemies, never allies.",
  },
  collideFeature: { label: "Collides with features" },
  collideFireBase: {
    label: "Collides with its own firebase",
    help: "Off, a unit can fire out of the transport carrying it (its firebase) without exploding early. Useful for marines shooting from inside a bunker.",
  },
  collideFriendly: {
    label: "Collides with allies",
    help: "Off, projectiles pass through allies without exploding. Whether the unit avoids firing through them at all is controlled separately by avoidFriendly.",
  },
  collideGround: { label: "Collides with terrain" },
  collideNeutral: {
    label: "Collides with neutral units",
    help: "Does not include Gaia.",
  },
  collideNonTarget: {
    label: "Collides with things that aren't its target",
    help: "Off, the projectile ignores everything except what it's locked onto, including other enemies. Combine with tracks and impactOnly for weapons that are mostly visual.",
  },
  collisionSize: {
    label: "Collision size",
    unit: "elmo",
    help: "Width for hitscan interceptors. Meant to be a collision radius for other projectile types too, but that part doesn't currently work.",
  },
  color1: {
    label: "Removed, use rgbColor",
    help: "The engine only logs a warning and ignores this key.",
  },
  color2: {
    label: "Removed, use rgbColor",
    help: "The engine only logs a warning and ignores this key.",
  },
  colormap: {
    label: "Colour cycle",
    help: "A series of RGBA colours the sprite fades through over its lifetime, when it has no model.",
  },
  commandfire: {
    label: "Only fires on manual command",
    help: "On, the weapon never fires automatically and only responds to the manual fire command.",
  },
  coreThickness: {
    label: "Beam core thickness",
    help: "BeamLaser and LaserCannon only. Fraction, 0 to 1, of the beam's full thickness that shows the inner colour set by rgbColor2.",
  },
  coverage: {
    label: "Interception radius",
    unit: "elmo",
    help: "How close a targetable weapon has to be for this interceptor to fire on it.",
  },
  craterBoost: {
    label: "Crater strength bonus",
    help: "Flat addition to cratering strength, applied after altitude reduction but before craterMult.",
  },
  craterMult: {
    label: "Crater strength multiplier",
    help: "Applied last, after every other cratering modifier.",
  },
  cylinderTargeting: {
    label: "Cylinder targeting height",
    help: "Multiplies range to get the height of a targeting cylinder. Zero uses the normal spherical or ballistic range check instead.",
  },
  cylinderTargetting: {
    label: "Cylinder targeting height (old spelling)",
    help: "Multiplies range to get the height of a targeting cylinder. Zero uses the normal spherical or ballistic range check instead.",
  },
  damageAreaOfEffect: {
    label: "Splash diameter",
    unit: "elmo",
    help: "A diameter, not a radius. Also the collision radius for projectile-based interceptors. Cratering is controlled separately by craterAreaOfEffect.",
  },
  dance: {
    label: "Missile wobble distance",
    unit: "elmo",
    help: "Missile only. Maximum random sideways shift, rerolled every 8 sim frames.",
  },
  duration: {
    label: "Beam visual length",
    help: "LaserCannon only. Visual-only, expressed as a fraction of the projectile's per-second speed.",
  },
  dynDamageExp: {
    label: "Range damage falloff exponent",
    help: "0 disables range-based damage scaling. 1 is linear, 2 is quadratic, and so on.",
  },
  dynDamageInverted: {
    label: "Damage increases with range",
    help: "On, the weapon does more damage at greater range instead of less.",
  },
  dynDamageMin: {
    label: "Minimum range-scaled damage",
    help: "The floor that range-dependent damage cannot drop below.",
  },
  dynDamageRange: {
    label: "Range used for damage scaling",
    unit: "elmo",
    help: "Replaces the actual range in the range-dependent damage formula, when set to a non-zero value.",
  },
  edgeEffectiveness: {
    label: "Splash falloff shape",
    help: "0 is a linear falloff to the edge of the splash. 1 is no falloff at all. Negative values concentrate damage further into the centre.",
  },
  energyPerShot: {
    label: "Energy cost per shot",
    unit: "energy",
    help: "For stockpile weapons this is spent over time as it stockpiles; otherwise it's spent immediately on firing.",
  },
  explosionGenerator: {
    label: "Impact effect",
    help: "Name, with prefix, of the custom explosion generator played on impact.",
  },
  explosionScar: { label: "Leaves a scar decal" },
  explosionSpeed: {
    label: "Shockwave propagation speed",
    help: "Controls how fast the damage shockwave spreads outward. Units can't dodge it: they're tagged for damage immediately and only take it after a delay.",
  },
  exteriorShield: { label: "Shield lets outgoing fire through (old name)" },
  falloffRate: {
    label: "Laser fade rate beyond range",
    help: "LaserCannon with hardstop off only. Fraction the laser fades per sim frame past max range. The engine floors this at 0.2, so a laser never takes more than 5 frames to fade out fully.",
  },
  fireStarter: {
    label: "Fire-starting chance",
    unit: "%",
    help: "Chance of setting static map features alight on impact.",
  },
  fireSubmersed: {
    label: "Can fire while underwater",
    help: "Requires waterweapon to also be on.",
  },
  fixedLauncher: {
    label: "Launches along a fixed heading",
    help: "Missile, Torpedo and Starburst only. Starts aimed along the launching piece's own direction rather than at the target.",
  },
  flameGfxTime: {
    label: "Flame visual reach",
    help: "Flamethrower only. Multiplies the weapon's range for the visual-only flame length; at 1.2 the visual extends 20% past max range. Should be 1 or higher.",
  },
  gravityAffected: {
    label: "Falls under gravity",
    help: "DGun weapon type only. Aiming does not account for the fall.",
  },
  groundBounce: { label: "Bounces off terrain" },
  hardstop: {
    label: "Laser stops sharply at range",
    help: "LaserCannon only. On, the laser is cut off at max range. Off, it fades out past range according to intensityFalloff and can no longer collide.",
  },
  heightBoostFactor: {
    label: "Ballistic height range bonus",
    help: "Cannon weapon type only. Adjusts ballistic range for height difference to the target; larger values increase the effect. -1 uses the engine's own formula. How it stacks with heightmod isn't documented.",
  },
  heightmod: {
    label: "Height difference multiplier",
    help: "Below 1, the unit can target further above or below itself than sideways. At 0, height to the target is ignored entirely for targeting.",
  },
  heightMod: {
    label: "Height difference multiplier (case variant)",
    help: "Read with a capital M as an alternate spelling of heightmod. Its default depends on whether the weapon is ballistic (0.8) or guided (1.0).",
  },
  highTrajectory: {
    label: "Trajectory choice",
    help: "0 is low trajectory, 1 is high trajectory, 2 gives the player a toggle between the two.",
  },
  impactOnly: {
    label: "Only damages what it hits",
    help: "Roughly the same as a zero area of effect but without that value's side effects, and it also stops cratering.",
  },
  impulseBoost: {
    label: "Flat impulse bonus",
    help: "Added on top of the impulse from impulseFactor.",
  },
  impulseFactor: {
    label: "Impulse multiplier",
    help: "For most weapons, base impulse equals the damage dealt. For melee weapons it's the attacker's mass instead.",
  },
  intensity: {
    label: "Projectile transparency",
    help: "Sprite-only. Lower is more transparent; 0 makes the projectile invisible.",
  },
  interceptedByShieldType: {
    label: "Shield interception bitmask (incoming)",
    help: "Each set bit lets a shield whose shieldInterceptType has the matching bit hit this weapon.",
  },
  interceptor: {
    label: "Weapon interception bitmask (outgoing)",
    help: "Each set bit lets this weapon intercept a weapon whose targetable has the matching bit set.",
  },
  interceptSolo: {
    label: "Exclusive interception",
    help: "On, once one interceptor is chasing a projectile, no other interceptor may also target it.",
  },
  isShield: {
    label: "Removed, use weaponType Shield",
    help: 'The engine only logs a warning and ignores this key. Set weaponType to "Shield" instead.',
  },
  largeBeamLaser: {
    label: "Large beam laser texturing",
    help: "BeamLaser only. Switches on extra texturing for the 'large' variant. Does not change size on its own.",
  },
  laserFlareSize: {
    label: "Beam flare size",
    unit: "elmo",
    help: "BeamLaser only.",
  },
  leadBonus: {
    label: "Target-leading XP bonus",
    help: "Added to leadLimit, multiplied by the firing unit's raw experience, when leadLimit isn't unlimited.",
  },
  leadLimit: {
    label: "Target-leading distance limit",
    unit: "elmo",
    help: "Negative values mean no limit.",
  },
  lodDistance: {
    label: "Simplified-rendering distance",
    unit: "elmo",
    help: "LaserCannon only. Beyond this distance the beam is drawn without its rounded ends.",
  },
  metalPerShot: {
    label: "Metal cost per shot",
    unit: "metal",
    help: "For stockpile weapons this is spent over time as it stockpiles; otherwise it's spent immediately on firing.",
  },
  minIntensity: {
    label: "Minimum damage falloff",
    help: "BeamLaser only. The lowest fraction of full damage the beam can fall off to across its range; 1.0 disables falloff entirely. Distinct from the visual-only intensity, and largely duplicates dynDamageExp.",
  },
  model: {
    label: "3D model",
    help: "Name of a model to use for the projectile. Without one, the weapon falls back to 2D sprites.",
  },
  movingAccuracy: {
    label: "Burst accuracy while moving",
    help: "Same as accuracy, but used while the firing unit is moving.",
  },
  myGravity: {
    label: "Gravity override",
    help: "Overrides the map's gravity for ballistic weapons and missiles; missiles are only affected once flightTime runs out. 0 disables the override and uses map gravity.",
  },
  noExplode: {
    label: "Never removed by exploding",
    help: "The projectile survives its own explosion and keeps going, exploding again on every sim frame it spends inside a collision volume. Multiplies damage enormously.",
  },
  noGap: {
    label: "Keeps cannon stages touching",
    help: "Cannon only. Adjusts separation to account for sizeDecay so the stages in a burst stay adjacent.",
  },
  noSelfDamage: { label: "Can't damage its own unit" },
  numBounce: {
    label: "Bounce limit",
    help: "How many times the projectile can bounce before exploding on impact instead. -1 is unlimited.",
  },
  ownerExpAccWeight: {
    label: "Accuracy gain from XP",
    help: "How much accuracy, but not sprayAngle, improves with the firing unit's raw experience. At limXP 0.4 and a weight of 2, only 20% of the original inaccuracy remains.",
  },
  paralyzer: {
    label: "Stuns instead of damaging",
    help: "On, the weapon only stuns; it never removes hit points.",
  },
  paralyzeTime: {
    label: "Stun duration",
    unit: "s",
    help: "Restarts every time the target is hit again.",
  },
  predictBoost: {
    label: "Target-leading accuracy",
    help: "0 to 1. At 0, the unit misjudges target speed by up to double or half. At 1, it predicts speed perfectly. leadLimit can still cap how far it leads.",
  },
  proximityPriority: {
    label: "Closeness targeting weight",
    help: "Higher values prefer closer targets more strongly. Negative values make the weapon prefer distant targets instead.",
  },
  pulseSpeed: {
    label: "Beam pulse frequency",
    unit: "Hz",
    help: "'Large' BeamLaser only. How fast the beam fades to nothing and back.",
  },
  rechargeDelay: {
    label: "Shield recharge delay",
    unit: "s",
    help: "How long the shield waits after being hit before it starts regenerating again.",
  },
  reload: {
    label: "Stockpile round time (old name)",
    unit: "s",
  },
  rgbColor: {
    label: "Sprite colour",
    help: "Used when the weapon has no model. EmgCannon defaults to a different colour.",
  },
  rgbColor2: {
    label: "Beam core colour",
    help: "BeamLaser and LaserCannon only. Colour of the beam's inner core, sized by coreThickness.",
  },
  scarAlpha: {
    label: "Scar starting opacity",
    help: "0 to 1.",
  },
  scarColorTint: {
    label: "Scar colour tint",
    help: "0.5 in each channel means no change; 1.0 is twice as bright.",
  },
  scarDiameter: {
    label: "Scar decal size",
    unit: "elmo",
    help: "-1 uses the engine's own default sizing.",
  },
  scarDotElimination: {
    label: "Scar surface-angle cutoff",
    help: "Exponent on the dot product between the scar's projection direction and the terrain normal, used to stop the decal appearing on surfaces it shouldn't. 0 disables the cutoff entirely.",
  },
  scarGlow: {
    label: "Scar glow intensity",
    help: "0 to 1.",
  },
  scarGlowColorMap: {
    label: "Scar glow colour cycle",
    help: "A series of RGBA colours the scar's glow fades through over its lifetime.",
  },
  scarGlowTtl: {
    label: "Scar glow duration",
    unit: "s",
  },
  scarIndices: {
    label: "Scar shape indices",
    help: "Indices into the scar table in resources.lua.",
  },
  scarProjVector: {
    label: "Scar projection direction",
    help: "Forces the direction the scar decal is projected from, as if from a projector at that world-space vector. All zeroes uses the ground normal instead; {0, 1, 0} suits orbital-type weapons.",
  },
  scarTtl: {
    label: "Scar decal duration",
    unit: "s",
  },
  scrollSpeed: {
    label: "Beam texture scroll speed",
    unit: "elmo/s",
    help: "'Large' BeamLaser only.",
  },
  separation: {
    label: "Cannon stage spacing",
    help: "Cannon only. Multiplies the default distance between stages. See stages.",
  },
  shieldAlpha: { label: "Shield opacity (old name)" },
  shieldArmorType: { label: "Shield armour class (old name)" },
  shieldBadColor: { label: "Shield colour when weak (old name)" },
  shieldEnergyUse: { label: "Shield energy drain (old name)" },
  shieldForce: { label: "Shield repulsion force (old name)" },
  shieldGoodColor: { label: "Shield colour when strong (old name)" },
  shieldInterceptType: { label: "Shield interception bitmask (old name)" },
  shieldMaxSpeed: {
    label: "Shield repulsion speed cap (old name)",
    unit: "elmo/s",
  },
  shieldPower: { label: "Shield hit points (old name)" },
  shieldPowerRegen: {
    label: "Shield regen rate (old name)",
    unit: "HP/s",
  },
  shieldPowerRegenEnergy: {
    label: "Energy cost of shield regen (old name)",
    unit: "energy/HP",
  },
  shieldRadius: {
    label: "Shield radius (old name)",
    unit: "elmo",
  },
  shieldRechargeDelay: {
    label: "Shield recharge delay (old name)",
    unit: "s",
  },
  shieldRepulser: { label: "Shield repels rather than absorbs (old name)" },
  shieldStartingPower: { label: "Shield starting charge (old name)" },
  size: {
    label: "Sprite size",
    unit: "elmo",
    help: "Only used when the weapon has no model.",
  },
  sizeDecay: {
    label: "Cannon stage shrink",
    help: "Cannon only. Size reduction per stage, as a fraction of the first stage's size.",
  },
  sizeGrowth: {
    label: "Flame growth rate",
    unit: "elmo/frame",
    help: "Flamethrower only. Visual-only.",
  },
  smartShield: { label: "Shield lets allied fire through (old name)" },
  smokeColor: { label: "Smoke trail brightness" },
  smokePeriod: {
    label: "Smoke trail update rate",
    unit: "frames",
    help: "How often the trail adds a new vertex. Lower is smoother but costs more performance; useful for fast-turning homing missiles to avoid jagged trails.",
  },
  smokeSize: { label: "Smoke trail size" },
  smokeTime: {
    label: "Smoke trail lifetime",
    unit: "frames",
  },
  smokeTrail: {
    label: "Leaves a smoke trail",
    help: "MissileLauncher only.",
  },
  smokeTrailCastShadow: { label: "Smoke trail casts a shadow" },
  soundHit: {
    label: "Impact sound (old name)",
    help: "Played on hitting outside water. A BeamLaser plays it once per sim frame.",
  },
  soundHitDry: {
    label: "Impact sound (outside water)",
    help: "A BeamLaser plays it once per sim frame.",
  },
  soundHitDryVolume: {
    label: "Impact sound volume (outside water)",
    help: "-1 autogenerates the volume from damage dealt.",
  },
  soundHitVolume: {
    label: "Impact sound volume (old name)",
    help: "-1 autogenerates the volume from damage dealt.",
  },
  soundHitWet: {
    label: "Impact sound (underwater)",
    help: "A BeamLaser plays it once per sim frame.",
  },
  soundHitWetVolume: {
    label: "Impact sound volume (underwater)",
    help: "-1 autogenerates the volume from damage dealt.",
  },
  soundStart: { label: "Firing sound" },
  soundStartVolume: {
    label: "Firing sound volume",
    help: "-1 autogenerates the volume from damage dealt.",
  },
  soundTrigger: {
    label: "One firing sound per burst",
    help: "Off, the sound plays once per shot in a burst instead of once for the whole burst.",
  },
  sprayAngle: {
    label: "Burst spread",
    help: "Spread of individual projectiles within one burst, using the same angle transform as accuracy.",
  },
  stages: {
    label: "Cannon sprite stages",
    help: "Cannon only. Number of 2D sprites drawn to fake motion blur, when no model is set.",
  },
  stockpile: {
    label: "Requires stockpiling",
    help: "Each round must be built up by the player before it can fire. Only the first stockpiled weapon of this type on a unit works correctly.",
  },
  stockpileTime: {
    label: "Stockpile round time",
    unit: "s",
    help: "0 stops it progressing, useful for a Lua reimplementation.",
  },
  submissile: {
    label: "Torpedo can surface",
    help: "Torpedo only. Lets it leave the water and continue as a missile, and lets underwater launchers hit above-water targets. Launchers that start above water still can't; use Missile instead of Torpedo for that.",
  },
  sweepFire: {
    label: "Beam sweeps to new targets",
    help: "Makes a BeamLaser keep firing while retargeting, sweeping across the terrain instead of cutting off.",
  },
  targetable: {
    label: "Interceptable-by bitmask",
    help: "Each set bit lets a weapon whose interceptor has the matching bit intercept this one. Instant-hit weapons like BeamLaser, LightningCannon and Rifle can never be targeted this way.",
  },
  targetBorder: {
    label: "Targets the edge, not the centre",
    help: "1 targets the near edge of the collision volume, -1 the far edge, 0 the centre. Mainly matters for large collision volumes or short ranges.",
  },
  targetMoveError: {
    label: "Target-leading error",
    help: "Adds a random vector, up to this fraction of the target's speed, to the predicted position each second. At 0.5 and a target moving 50 elmo/s, the error can be up to 25 elmos.",
  },
  texture1: { label: "Primary texture (old name)" },
  texture2: { label: "Secondary texture (old name)" },
  texture3: { label: "Tertiary texture (old name)" },
  texture4: { label: "Quaternary texture (old name)" },
  thickness: {
    label: "Beam thickness",
    unit: "elmo",
    help: "LaserCannon, BeamLaser and Lightning only.",
  },
  tileLength: {
    label: "Beam texture tile length",
    unit: "elmo",
    help: "'Large' BeamLaser only. Regular BeamLaser stretches a single tile instead of repeating it.",
  },
  tracks: {
    label: "Homes in on its target",
    help: "Missile, Torpedo and Starburst only. Requires a positive turnRate to actually turn towards the target.",
  },
  trajectoryHeight: {
    label: "Missile arc height",
    help: "Missile and Torpedo only. Fraction of the distance to the target added as extra arc height; at 1.0 the arc is as tall as it is long.",
  },
  turret: {
    label: "Aims within a turret arc",
    help: "Off, the weapon always points along the owner's own heading instead of tracking within an arc.",
  },
  visibleShield: { label: "Shield is visible (old name)" },
  visibleShieldHitFrames: {
    label: "Shield visible-on-hit duration (old name)",
    unit: "frames",
  },
  visibleShieldRepulse: { label: "Shows the repulse effect (old name)" },
  waterBounce: { label: "Bounces off water" },
  waterweapon: {
    label: "Can travel underwater",
    help: "Firing underwater at all is controlled separately by fireSubmersed.",
  },
  wobble: {
    label: "Missile wobble turn rate",
    unit: "COB angle/s",
    help: "Missile only. New random direction rolled every 16 sim frames.",
  },
  "damage.default": {
    label: "Default damage",
    help: "Used for any armour class that doesn't have its own entry in damage.",
  },
  "shield.alpha": {
    label: "Shield opacity",
    help: "How transparent the shield is while visible.",
  },
  "shield.armorType": {
    label: "Shield armour class",
    help: "An armour class name, or a unit's name to share its armour class.",
  },
  "shield.badColor": {
    label: "Shield colour when weak",
    help: "The colour the shield fades to as its charge drops to 0.",
  },
  "shield.energyUse": {
    label: "Shield energy drain",
    help: "Energy drained continuously by a repulsor while a projectile is nearby, or spent absorbing a hit.",
  },
  "shield.exterior": {
    label: "Shield lets outgoing fire through",
    help: "On, projectiles fired from inside the shield's radius pass through it. Off, they're intercepted too.",
  },
  "shield.force": {
    label: "Shield repulsion force",
    help: "Higher values deflect incoming weapons away at higher speed.",
  },
  "shield.goodColor": {
    label: "Shield colour when strong",
    help: "The colour the shield fades to as its charge regenerates to full.",
  },
  "shield.interceptType": {
    label: "Shield interception bitmask",
    help: "Each set bit lets the shield intercept a weapon whose interceptedByShieldType has the matching bit set.",
  },
  "shield.maxSpeed": {
    label: "Shield repulsion speed cap",
    unit: "elmo/s",
    help: "The fastest speed the repulsor can impart to a deflected projectile.",
  },
  "shield.power": {
    label: "Shield hit points",
    help: "The maximum charge the shield can hold, reduced by incoming weapon damage.",
  },
  "shield.powerRegen": {
    label: "Shield regen rate",
    unit: "HP/s",
  },
  "shield.powerRegenEnergy": {
    label: "Energy cost of shield regen",
    unit: "energy/HP",
  },
  "shield.radius": {
    label: "Shield radius",
    unit: "elmo",
  },
  "shield.repulser": {
    label: "Shield repels rather than absorbs",
    help: "On, the shield deflects incoming projectiles. Off, it absorbs them.",
  },
  "shield.smart": {
    label: "Shield lets allied fire through",
    help: "On, projectiles fired by allies pass through. Off, they're intercepted the same as enemy fire.",
  },
  "shield.startingPower": {
    label: "Shield starting charge",
    help: "How much charge the shield has when it first appears, rather than starting empty and regenerating up to full power.",
  },
  "shield.visible": { label: "Shield is visible" },
  "shield.visibleHitFrames": {
    label: "Shield visible-on-hit duration",
    unit: "frames",
    help: "How many frames the shield is shown for after being hit.",
  },
  "shield.visibleRepulse": {
    label: "Shows the repulse effect",
    help: "Whether the shield's hard-coded projectile-deflection effect is drawn.",
  },
  "textures.1": {
    label: "Primary texture",
    help: "Sprite texture for AircraftBomb, Cannon, EMG and Flame weapons; the main beam texture for LaserCannon, BeamLaser and Lightning; the flare texture for Missile and Starburst; the shield dome texture. DGun ignores this and uses a hardcoded texture.",
  },
  "textures.2": {
    label: "Secondary texture",
    help: "The end-of-beam texture for LaserCannon and BeamLaser, split between both ends; the smoke trail texture for Missile and Starburst. Torpedo ignores this and uses a hardcoded trail.",
  },
  "textures.3": {
    label: "Tertiary texture",
    help: "The flare texture for a regular BeamLaser, or the directional muzzle exhaust for a 'large' one; the flame exhaust texture for Starburst.",
  },
  "textures.4": {
    label: "Quaternary texture",
    help: "The flare texture for a 'large' BeamLaser.",
  },
};
