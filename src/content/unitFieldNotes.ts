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
 *   - A generated field with no note here still renders, labelled with its key.
 *     This file is deliberately partial and grows as fields get documented.
 *
 * Units of measure are only stated where the engine's own source proves them,
 * either in a comment or in the arithmetic it applies to the value. An elmo is
 * the engine's world unit, and a frame is 1/30 of a second.
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

  // The engine comment above the read states the unit for each of these four.
  speed: { label: "Speed", unit: "elmo/s" },
  maxVelocity: { label: "Speed (old name)", unit: "elmo/frame" },
  rSpeed: { label: "Reverse speed", unit: "elmo/s" },
  maxReverseVelocity: { label: "Reverse speed (old name)", unit: "elmo/frame" },
  maxAcc: { label: "Acceleration", unit: "elmo/frame²" },
  acceleration: { label: "Acceleration (old name)", unit: "elmo/frame²" },
  maxDec: { label: "Braking", unit: "elmo/frame²" },
  brakeRate: { label: "Braking (old name)", unit: "elmo/frame²" },

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
  selfDestructCountdown: { label: "Self destruct countdown", unit: "s" },
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

  objectName: { label: "Model", help: "The model file under objects3d/." },
  script: {
    label: "Unit script",
    help: "Resolved under scripts/, defaulting to the unit name with a .cob suffix.",
  },
  buildPic: { label: "Build picture" },
  iconType: { label: "Map icon" },
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
