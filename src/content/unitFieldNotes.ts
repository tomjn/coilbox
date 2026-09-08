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
};
