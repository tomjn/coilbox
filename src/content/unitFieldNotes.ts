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
import { t } from "@lingui/core/macro";
import type { FieldNote } from "./unitFields";

/** Notes on unit definition fields, keyed by their dotted path. */
export const UNIT_FIELD_NOTES: Record<string, FieldNote> = {
  health: {
    get label() {
      return t`Health`;
    },
    get help() {
      return t`Hit points at full repair. A def with health at or below zero is rejected.`;
    },
  },
  maxDamage: {
    get label() {
      return t`Health (old name)`;
    },
    get help() {
      return t`The Total Annihilation spelling of health. Used only when health is absent.`;
    },
  },
  metalCost: {
    get label() {
      return t`Metal cost`;
    },
    unit: "metal",
  },
  energyCost: {
    get label() {
      return t`Energy cost`;
    },
    unit: "energy",
  },
  buildTime: {
    get label() {
      return t`Build time`;
    },
    get help() {
      return t`Divided by the build power poured into it to give the seconds a build takes.`;
    },
  },
  workerTime: {
    get label() {
      return t`Build power`;
    },
    get help() {
      return t`How fast this unit builds, repairs, reclaims and captures. Named workerTime for historical reasons.`;
    },
  },
  mass: {
    get label() {
      return t`Mass`;
    },
    get help() {
      return t`Used for collisions and for melee impulse. Defaults to the metal cost.`;
    },
  },
  buildCostMetal: {
    get label() {
      return t`Metal cost (old name)`;
    },
    get help() {
      return t`The Total Annihilation spelling. Read only when metalCost is absent.`;
    },
  },
  buildCostEnergy: {
    get label() {
      return t`Energy cost (old name)`;
    },
    get help() {
      return t`The Total Annihilation spelling. Read only when energyCost is absent.`;
    },
  },

  // Production and upkeep. The engine applies all of these on its slow update,
  // which runs every 15 frames, and halves the value each time, so what the def
  // writes is a rate per second.
  metalMake: {
    get label() {
      return t`Metal made`;
    },
    unit: "metal/s",
    get help() {
      return t`Produced whether or not the unit is switched on.`;
    },
  },
  energyMake: {
    get label() {
      return t`Energy made`;
    },
    unit: "energy/s",
    get help() {
      return t`Produced whether or not the unit is switched on.`;
    },
  },
  makesMetal: {
    get label() {
      return t`Metal made when on`;
    },
    unit: "metal/s",
    get help() {
      return t`Only produced while the unit is switched on and its upkeep was paid that tick.`;
    },
  },
  metalUpkeep: {
    get label() {
      return t`Metal upkeep`;
    },
    unit: "metal/s",
    get help() {
      return t`Drawn only while the unit is switched on. A negative number is the old way of making production conditional.`;
    },
  },
  energyUpkeep: {
    get label() {
      return t`Energy upkeep`;
    },
    unit: "energy/s",
    get help() {
      return t`Drawn only while the unit is switched on. A negative number is the old way of making production conditional.`;
    },
  },
  metalUse: {
    get label() {
      return t`Metal upkeep (old name)`;
    },
    unit: "metal/s",
    get help() {
      return t`Read only when metalUpkeep is absent.`;
    },
  },
  energyUse: {
    get label() {
      return t`Energy upkeep (old name)`;
    },
    unit: "energy/s",
    get help() {
      return t`Read only when energyUpkeep is absent.`;
    },
  },
  metalStorage: {
    get label() {
      return t`Metal storage`;
    },
    unit: "metal",
    get help() {
      return t`Added to the team's storage cap while the unit is alive.`;
    },
  },
  energyStorage: {
    get label() {
      return t`Energy storage`;
    },
    unit: "energy",
    get help() {
      return t`Added to the team's storage cap while the unit is alive.`;
    },
  },
  harvestMetalStorage: {
    get label() {
      return t`Harvested metal capacity`;
    },
    unit: "metal",
    get help() {
      return t`Above zero, metal this unit reclaims fills the unit instead of the team's pool. Filling it fires an event for the game's own Lua to unload it.`;
    },
  },
  harvestStorage: {
    get label() {
      return t`Harvested metal capacity (old name)`;
    },
    unit: "metal",
    get help() {
      return t`Read only when harvestMetalStorage is absent.`;
    },
  },
  harvestEnergyStorage: {
    get label() {
      return t`Harvested energy capacity`;
    },
    unit: "energy",
    get help() {
      return t`Read and stored, but the engine only implements harvesting for metal.`;
    },
  },
  extractsMetal: {
    get label() {
      return t`Extraction depth`;
    },
    get help() {
      return t`How hard this extractor draws on the metal under it. The ground it covers comes from the map's own extractor radius, not from the unit.`;
    },
  },
  windGenerator: {
    get label() {
      return t`Wind generation cap`;
    },
    unit: "energy/s",
    get help() {
      return t`The unit makes the map's current wind strength as energy, capped at this. Zero is not a wind generator.`;
    },
  },
  tidalGenerator: {
    get label() {
      return t`Tidal generation`;
    },
    get help() {
      return t`Multiplied by the map's tidal strength to give energy per second. Zero is not a tidal generator.`;
    },
  },
  onoffable: {
    get label() {
      return t`Can be switched off`;
    },
    get help() {
      return t`Gives the player the on and off toggle, which is what gates upkeep and everything that depends on it.`;
    },
  },
  activateWhenBuilt: {
    get label() {
      return t`Starts switched on`;
    },
    get help() {
      return t`Whether the unit is already on the moment it finishes building.`;
    },
  },
  builder: {
    get label() {
      return t`Is a builder`;
    },
    get help() {
      return t`Offers the build orders. The engine only counts the unit as a builder if it also has build power and build range.`;
    },
  },
  buildRange3D: {
    get label() {
      return t`Build range is a sphere`;
    },
    get help() {
      return t`Off, build range is an infinite cylinder and height costs nothing. On, it is a sphere, so a builder above or below its target reaches less far.`;
    },
  },
  buildeeBuildRadius: {
    get label() {
      return t`Radius when being built`;
    },
    unit: "elmo",
    get help() {
      return t`How close a builder has to get to work on this unit. Negative uses the model's own radius, and zero makes builders reach its centre.`;
    },
  },
  canAssist: {
    get label() {
      return t`Can assist`;
    },
    get help() {
      return t`Can pour build power into somebody else's unfinished unit. Off, it can still start its own nanoframes but cannot resume one it was interrupted on.`;
    },
  },
  canBeAssisted: {
    get label() {
      return t`Can be assisted`;
    },
    get help() {
      return t`Whether another builder may help build this one.`;
    },
  },
  canRepair: {
    get label() {
      return t`Can repair`;
    },
    get help() {
      return t`Also needs a repair speed above zero.`;
    },
  },
  canReclaim: {
    get label() {
      return t`Can reclaim`;
    },
    get help() {
      return t`Also needs a reclaim speed above zero.`;
    },
  },
  canRestore: {
    get label() {
      return t`Can restore terrain`;
    },
    get help() {
      return t`Also needs a terraform speed above zero.`;
    },
  },
  canResurrect: {
    get label() {
      return t`Can resurrect`;
    },
    get help() {
      return t`Also needs a resurrect speed above zero. Off by default even for builders, since that speed defaults to their build power.`;
    },
  },
  canCapture: {
    get label() {
      return t`Can capture`;
    },
    get help() {
      return t`Also needs a capture speed above zero. Off by default even for builders, since that speed defaults to their build power.`;
    },
  },
  repairSpeed: {
    get label() {
      return t`Repair speed`;
    },
    get help() {
      return t`Build power spent repairing. Defaults to the unit's build power.`;
    },
  },
  maxRepairSpeed: {
    get label() {
      return t`Repair received cap`;
    },
    get help() {
      return t`The most repair this unit will take from all its repairers at once. The default is high enough to be no cap.`;
    },
  },
  reclaimSpeed: {
    get label() {
      return t`Reclaim speed`;
    },
    get help() {
      return t`Defaults to the unit's build power.`;
    },
  },
  resurrectSpeed: {
    get label() {
      return t`Resurrect speed`;
    },
    get help() {
      return t`Defaults to the unit's build power.`;
    },
  },
  captureSpeed: {
    get label() {
      return t`Capture speed`;
    },
    get help() {
      return t`Defaults to the unit's build power.`;
    },
  },
  terraformSpeed: {
    get label() {
      return t`Terraform speed`;
    },
    get help() {
      return t`Defaults to the unit's build power.`;
    },
  },
  repairable: {
    get label() {
      return t`Can be repaired`;
    },
  },
  reclaimable: {
    get label() {
      return t`Can be reclaimed`;
    },
  },
  capturable: {
    get label() {
      return t`Can be captured`;
    },
  },
  fullHealthFactory: {
    get label() {
      return t`Holds units until fully healed`;
    },
    get help() {
      return t`A factory keeps working on a finished unit until it is at full health before letting it leave.`;
    },
  },
  showNanoFrame: {
    get label() {
      return t`Show the nanoframe`;
    },
    get help() {
      return t`Whether the wireframe build animation is drawn while this unit is under construction.`;
    },
  },
  showNanoSpray: {
    get label() {
      return t`Show nano spray`;
    },
    get help() {
      return t`Whether a builder's stream of particles is drawn at all.`;
    },
  },

  // The engine comment above the read states the unit for each of these four.
  speed: {
    get label() {
      return t`Speed`;
    },
    unit: "elmo/s",
  },
  maxVelocity: {
    get label() {
      return t`Speed (old name)`;
    },
    unit: "elmo/frame",
  },
  rSpeed: {
    get label() {
      return t`Reverse speed`;
    },
    unit: "elmo/s",
  },
  maxReverseVelocity: {
    get label() {
      return t`Reverse speed (old name)`;
    },
    unit: "elmo/frame",
  },
  maxAcc: {
    get label() {
      return t`Acceleration`;
    },
    unit: "elmo/frame²",
  },
  acceleration: {
    get label() {
      return t`Acceleration (old name)`;
    },
    unit: "elmo/frame²",
  },
  maxDec: {
    get label() {
      return t`Braking`;
    },
    unit: "elmo/frame²",
  },
  brakeRate: {
    get label() {
      return t`Braking (old name)`;
    },
    unit: "elmo/frame²",
  },

  // A heading is a 16 bit angle, so a full turn is 65536 of them. The engine
  // works the turn out as (turnRate / 65536) * 360 degrees in a frame.
  turnRate: {
    get label() {
      return t`Turn rate`;
    },
    unit: "COB angle/frame",
    get help() {
      return t`65536 COB angle units is a full turn, so 182 here is a degree per frame, or 30 degrees a second.`;
    },
  },
  turnInPlace: {
    get label() {
      return t`Turns on the spot`;
    },
    get help() {
      return t`On, the unit slows down for a turn sharper than its angle limit. Off, it keeps rolling and swings round in an arc.`;
    },
  },
  turnInPlaceAngleLimit: {
    get label() {
      return t`Turn without slowing`;
    },
    unit: "degrees",
    get help() {
      return t`For a unit that turns on the spot, the sharpest turn it will take at full speed. Anything sharper slows it down.`;
    },
  },
  turnInPlaceSpeedLimit: {
    get label() {
      return t`Slowest speed in a turn`;
    },
    unit: "elmo/s",
    get help() {
      return t`For a unit that does not turn on the spot, the speed it will not drop below while turning. Defaults to whatever its turn rate can hold.`;
    },
  },
  upDirSmoothing: {
    get label() {
      return t`Tilt smoothing`;
    },
    get help() {
      return t`How much of the old tilt to keep when the ground under the unit changes, from 0 for an instant snap to the slope up to 0.95. Anything higher is clamped.`;
    },
  },
  slideTolerance: {
    get label() {
      return t`Slide tolerance`;
    },
    get help() {
      return t`Multiplies the move class's maximum slope when deciding the unit is on ground too steep to hold, so above 1 it clings to steeper ground. Zero turns sliding off.`;
    },
  },
  minCollisionSpeed: {
    get label() {
      return t`Collision damage threshold`;
    },
    unit: "elmo/frame",
    get help() {
      return t`How hard an impact has to be before it does damage. Negative means the unit never takes collision damage.`;
    },
  },
  myGravity: {
    get label() {
      return t`Gravity`;
    },
    get help() {
      return t`Gravity for this aircraft on its own. The engine's comment says planes are slower than real ones, so the default is lowered to compensate.`;
    },
  },
  useSmoothMesh: {
    get label() {
      return t`Fly over the smoothed map`;
    },
    get help() {
      return t`An aircraft holds height against a smoothed version of the terrain rather than every bump of it.`;
    },
  },
  holdSteady: {
    get label() {
      return t`Passengers follow the piece`;
    },
    get help() {
      return t`A transport with this on turns each passenger with the model piece carrying it. Off, they all take the transport's own heading.`;
    },
  },
  releaseHeld: {
    get label() {
      return t`Passengers survive its death`;
    },
    get help() {
      return t`Off, everything aboard is killed with the transport. On, passengers are dropped and it is up to the game's Lua to deal with where they land.`;
    },
  },
  floater: {
    get label() {
      return t`Floats on water`;
    },
    get help() {
      return t`Only read for a unit with no movement class, which is anything immobile or flying. Defaults to on if the def has a WaterLine key at all.`;
    },
  },
  WaterLine: {
    get label() {
      return t`Waterline (presence only)`;
    },
    get help() {
      return t`The engine never reads this value. All it checks is whether the key exists, which is the old way of saying a unit floats.`;
    },
  },
  canSubmerge: {
    get label() {
      return t`Can submerge`;
    },
    get help() {
      return t`Only has an effect on a unit that flies. The engine drops it for anything else.`;
    },
  },
  upright: {
    get label() {
      return t`Stays upright`;
    },
    get help() {
      return t`The unit keeps a level body instead of leaning with the ground. Forced on for anything that cannot fly and has no movement class.`;
    },
  },
  moveState: {
    get label() {
      return t`Starting move state`;
    },
    get help() {
      return t`0 hold position, 1 maneuver, 2 roam. At -1 the unit copies the move state of whatever built it, or maneuvers if nothing did.`;
    },
  },
  canFight: {
    get label() {
      return t`Has the fight order`;
    },
  },
  canPatrol: {
    get label() {
      return t`Has the patrol order`;
    },
  },
  canGuard: {
    get label() {
      return t`Has the guard order`;
    },
  },
  canRepeat: {
    get label() {
      return t`Has the repeat toggle`;
    },
  },
  separationDistance: {
    get label() {
      return t`Separation distance`;
    },
    unit: "elmo",
    get help() {
      return t`An extra gap the unit keeps from other moving units, on top of its own size. The engine suggests 32 or less. It does not affect pathing near buildings or terrain.`;
    },
  },

  canFly: {
    get label() {
      return t`Flies`;
    },
  },
  airStrafe: {
    get label() {
      return t`Weaves while circling`;
    },
    get help() {
      return t`A gunship circling or attacking keeps picking new points around the circle rather than holding one spot.`;
    },
  },
  airHoverFactor: {
    get label() {
      return t`Hover drift`;
    },
    get help() {
      return t`Below zero the aircraft lands. Zero or above keeps it airborne and says how much it wanders while hovering on the spot.`;
    },
  },
  bankingAllowed: {
    get label() {
      return t`Banks into turns`;
    },
  },
  maxBank: {
    get label() {
      return t`Maximum roll`;
    },
  },
  maxPitch: {
    get label() {
      return t`Maximum pitch`;
    },
    get help() {
      return t`The pitch this plane tries to hold.`;
    },
  },
  maxAileron: {
    get label() {
      return t`Roll speed`;
    },
  },
  maxElevator: {
    get label() {
      return t`Pitch speed`;
    },
  },
  maxRudder: {
    get label() {
      return t`Yaw speed`;
    },
  },
  wingAngle: {
    get label() {
      return t`Wing angle`;
    },
    get help() {
      return t`The angle between the plane's nose and the flat of its wings. It sets the direction lift pulls in and it is squared into the wing drag.`;
    },
  },
  wingDrag: {
    get label() {
      return t`Wing drag`;
    },
    get help() {
      return t`Drag caused by the wings. Clamped to 0 up to 1.`;
    },
  },
  crashDrag: {
    get label() {
      return t`Crash drag`;
    },
    get help() {
      return t`The drag used once the aircraft is going down. Clamped to 0 up to 1.`;
    },
  },
  cruiseAltitude: {
    get label() {
      return t`Cruise altitude`;
    },
    unit: "elmo",
    get help() {
      return t`The height a gunship holds above the ground.`;
    },
  },
  cruiseAlt: {
    get label() {
      return t`Cruise altitude (old name)`;
    },
    unit: "elmo",
    get help() {
      return t`Read only when cruiseAltitude is absent.`;
    },
  },
  verticalSpeed: {
    get label() {
      return t`Climb and descent speed`;
    },
    get help() {
      return t`The speed of takeoff and landing, at least for a gunship.`;
    },
  },
  turnRadius: {
    get label() {
      return t`Turn radius`;
    },
    unit: "elmo",
    get help() {
      return t`A hint to the fixed wing movement code about the circle this plane needs. Doubled for a bomber that leaves it at the default.`;
    },
  },
  // The engine gives both of these the same one line comment and nothing else,
  // so neither note claims to know which way round they pull.
  frontToSpeed: {
    get label() {
      return t`Nose and velocity alignment`;
    },
    get help() {
      return t`The engine calls this a fudge factor for lining up a plane's speed and the way its nose points.`;
    },
  },
  speedToFront: {
    get label() {
      return t`Nose and velocity alignment (second factor)`;
    },
    get help() {
      return t`The engine calls this a fudge factor for lining up a plane's speed and the way its nose points.`;
    },
  },
  canLoopbackAttack: {
    get label() {
      return t`Loops back to attack`;
    },
    get help() {
      return t`Only matters for a fighter.`;
    },
  },
  factoryHeadingTakeoff: {
    get label() {
      return t`Takes off facing the factory`;
    },
    get help() {
      return t`An aircraft leaving a factory keeps the factory's heading while it climbs.`;
    },
  },

  transportCapacity: {
    get label() {
      return t`Passenger slots`;
    },
  },
  transportSize: {
    get label() {
      return t`Largest passenger footprint`;
    },
    unit: "build squares",
    get help() {
      return t`The biggest footprint this transport will pick up.`;
    },
  },
  minTransportSize: {
    get label() {
      return t`Smallest passenger footprint`;
    },
    unit: "build squares",
  },
  transportMass: {
    get label() {
      return t`Passenger mass capacity`;
    },
  },
  minTransportMass: {
    get label() {
      return t`Smallest passenger mass`;
    },
  },
  loadingRadius: {
    get label() {
      return t`Loading radius`;
    },
    unit: "elmo",
    get help() {
      return t`How close the transport gets before it starts picking a unit up.`;
    },
  },
  unloadSpread: {
    get label() {
      return t`Unload spread`;
    },
    get help() {
      return t`Multiplies each passenger's radius to decide how far apart they are put down.`;
    },
  },
  transportUnloadMethod: {
    get label() {
      return t`Unload method`;
    },
    get help() {
      return t`0 land and unload, 1 drop on a flyover, 2 land and flood out.`;
    },
  },
  transportByEnemy: {
    get label() {
      return t`Enemies can carry it`;
    },
  },
  cantBeTransported: {
    get label() {
      return t`Cannot be carried`;
    },
    get help() {
      return t`Defaults to on for anything with no ground movement, and the game's transport settings can force it on for a whole move class.`;
    },
  },

  // Clamped to 0..89 and then converted with DEG_TO_RAD.
  maxSlope: {
    get label() {
      return t`Maximum slope`;
    },
    unit: "degrees",
    get help() {
      return t`The steepest ground the unit will climb. Clamped to 89.`;
    },
  },
  minWaterDepth: {
    get label() {
      return t`Minimum water depth`;
    },
    unit: "elmo",
  },
  maxWaterDepth: {
    get label() {
      return t`Maximum water depth`;
    },
    unit: "elmo",
  },
  waterline: {
    get label() {
      return t`Waterline`;
    },
    unit: "elmo",
    get help() {
      return t`How deep the model sits when floating.`;
    },
  },

  sightDistance: {
    get label() {
      return t`Line of sight`;
    },
    unit: "elmo",
  },
  airSightDistance: {
    get label() {
      return t`Air line of sight`;
    },
    unit: "elmo",
    get help() {
      return t`Defaults to one and a half times the ground sight distance.`;
    },
  },
  radarDistance: {
    get label() {
      return t`Radar range`;
    },
    unit: "elmo",
  },
  sonarDistance: {
    get label() {
      return t`Sonar range`;
    },
    unit: "elmo",
  },
  radarDistanceJam: {
    get label() {
      return t`Radar jamming range`;
    },
    unit: "elmo",
  },
  sonarDistanceJam: {
    get label() {
      return t`Sonar jamming range`;
    },
    unit: "elmo",
  },
  seismicDistance: {
    get label() {
      return t`Seismic range`;
    },
    unit: "elmo",
  },
  seismicSignature: {
    get label() {
      return t`Seismic signature`;
    },
    get help() {
      return t`How loud this unit is to a seismic sensor when it moves. At -1 the engine works one out from the mass, but only for a tank or a bot, and everything else gets nothing.`;
    },
  },
  sightEmitHeight: {
    get label() {
      return t`Sight height`;
    },
    unit: "elmo",
    get help() {
      return t`How far above the unit its line of sight is measured from, so it can see over a rise.`;
    },
  },
  losEmitHeight: {
    get label() {
      return t`Sight height (old name)`;
    },
    unit: "elmo",
    get help() {
      return t`Read only when sightEmitHeight is absent.`;
    },
  },
  radarEmitHeight: {
    get label() {
      return t`Radar height`;
    },
    unit: "elmo",
    get help() {
      return t`The same idea for radar. Defaults to the sight height.`;
    },
  },
  leavesGhost: {
    get label() {
      return t`Leaves a ghost`;
    },
    get help() {
      return t`Whether the enemy keeps seeing an outline of it after it drops out of sight. Defaults to on for a building.`;
    },
  },
  stealth: {
    get label() {
      return t`Radar stealth`;
    },
    get help() {
      return t`Radar cannot pick the unit up at all. A unit still being built is not stealthed.`;
    },
  },
  sonarStealth: {
    get label() {
      return t`Sonar stealth`;
    },
    get help() {
      return t`Sonar cannot pick the unit up.`;
    },
  },
  canCloak: {
    get label() {
      return t`Can cloak`;
    },
    get help() {
      return t`Defaults to on when a cloak cost is set.`;
    },
  },
  initCloaked: {
    get label() {
      return t`Starts cloaked`;
    },
  },
  cloakCost: {
    get label() {
      return t`Cloak cost`;
    },
    unit: "energy/s",
    get help() {
      return t`Drawn while cloaked and standing still.`;
    },
  },
  cloakCostMoving: {
    get label() {
      return t`Cloak cost moving`;
    },
    unit: "energy/s",
    get help() {
      return t`Drawn while cloaked and moving. Defaults to the standing cost.`;
    },
  },
  decloakOnFire: {
    get label() {
      return t`Decloaks on firing`;
    },
  },
  decloakSpherical: {
    get label() {
      return t`Decloak range is a sphere`;
    },
    get help() {
      return t`On, the decloak check is a sphere. Off, it is a cylinder, so height does not count.`;
    },
  },
  buildDistance: {
    get label() {
      return t`Build range`;
    },
    unit: "elmo",
    get help() {
      return t`Raised to 38 if set lower, the least that lets a 1x1 builder reach a 1x1 building.`;
    },
  },
  minCloakDistance: {
    get label() {
      return t`Decloak distance`;
    },
    unit: "elmo",
    get help() {
      return t`How close an enemy has to get before the unit decloaks.`;
    },
  },
  kamikazeDistance: {
    get label() {
      return t`Kamikaze trigger distance`;
    },
    unit: "elmo",
  },

  // The engine multiplies both by UNIT_SLOWUPDATE_RATE / GAME_SPEED, so the
  // value written in the def is per second.
  autoHeal: {
    get label() {
      return t`Self repair`;
    },
    unit: "HP/s",
  },
  idleAutoHeal: {
    get label() {
      return t`Idle self repair`;
    },
    unit: "HP/s",
    get help() {
      return t`Applied once the unit has been idle for idleTime.`;
    },
  },
  // Read as an int and used directly as a frame count.
  idleTime: {
    get label() {
      return t`Idle before self repair`;
    },
    unit: "frames",
    get help() {
      return t`600 frames is 20 seconds.`;
    },
  },
  canSelfRepair: {
    get label() {
      return t`Repairs itself`;
    },
    get help() {
      return t`Lets a builder spend its own build power on its own damage.`;
    },
  },
  damageModifier: {
    get label() {
      return t`Armoured damage multiplier`;
    },
    get help() {
      return t`The multiplier on incoming damage while the unit's script has put it in its armoured state. 0.5 halves the damage taken.`;
    },
  },
  hideDamage: {
    get label() {
      return t`Hide health from enemies`;
    },
    get help() {
      return t`A player who is not an ally sees no health bar and no health in the tooltip.`;
    },
  },
  crushResistance: {
    get label() {
      return t`Crush resistance`;
    },
    get help() {
      return t`Anything whose move class has more crush strength than this runs the unit over. Defaults to the mass.`;
    },
  },
  flankingBonusMode: {
    get label() {
      return t`Flanking bonus mode`;
    },
    get help() {
      return t`0 off, 1 the protected direction is in map coordinates, 2 it is in unit coordinates and may move, 3 it is in unit coordinates and is locked.`;
    },
  },
  flankingBonusDir: {
    get label() {
      return t`Best protected direction`;
    },
    get help() {
      return t`The direction the unit takes least damage from, which is what makes flanking it worthwhile.`;
    },
  },
  flankingBonusMin: {
    get label() {
      return t`Damage from the protected side`;
    },
    get help() {
      return t`The damage multiplier for a hit from the best protected direction.`;
    },
  },
  flankingBonusMax: {
    get label() {
      return t`Damage from the exposed side`;
    },
    get help() {
      return t`The damage multiplier for a hit from the least protected direction.`;
    },
  },
  flankingBonusMobilityAdd: {
    get label() {
      return t`Flanking direction mobility`;
    },
    get help() {
      return t`How much of the protected direction's ability to move builds up each frame, in the modes that let it move.`;
    },
  },

  canSelfDestruct: {
    get label() {
      return t`Has the self destruct order`;
    },
  },
  selfDestructCountdown: {
    get label() {
      return t`Self destruct countdown`;
    },
    unit: "s",
  },
  kamikaze: {
    get label() {
      return t`Kamikaze`;
    },
    get help() {
      return t`The unit blows itself up when an enemy comes inside its trigger distance.`;
    },
  },
  kamikazeUseLOS: {
    get label() {
      return t`Kamikaze needs line of sight`;
    },
    get help() {
      return t`On, only an enemy the unit can actually see sets it off.`;
    },
  },
  fallSpeed: {
    get label() {
      return t`Passenger fall speed`;
    },
    get help() {
      return t`How fast units dropped from this transport come down.`;
    },
  },
  unitFallSpeed: {
    get label() {
      return t`Own fall speed`;
    },
    get help() {
      return t`How fast this unit falls when it is the one being dropped. Overrides the transport's own setting.`;
    },
  },
  "SFXTypes.explosionGenerators": {
    get label() {
      return t`Explosion effects`;
    },
    get help() {
      return t`The effects the unit's script can set off by index. Each entry carries its own prefix, so a custom one is written as custom:mygenerator. At most 32 are read.`;
    },
  },
  "SFXTypes.pieceExplosionGenerators": {
    get label() {
      return t`Piece explosion effects`;
    },
    get help() {
      return t`The effects used when a model piece is blown off. These can only be custom ones, so the custom: prefix is added by the engine. At most 32 are read.`;
    },
  },
  "SFXTypes.crashExplosionGenerators": {
    get label() {
      return t`Crash effects`;
    },
    get help() {
      return t`The effects used while an aircraft is going down. These can only be custom ones, so the custom: prefix is added by the engine. At most 32 are read.`;
    },
  },

  canAttack: {
    get label() {
      return t`Has the attack order`;
    },
  },
  canManualFire: {
    get label() {
      return t`Has a special weapon`;
    },
    get help() {
      return t`Gives the unit the manual fire order, which is what a commander's disintegrator gun uses.`;
    },
  },
  canDGun: {
    get label() {
      return t`Has a special weapon (old name)`;
    },
    get help() {
      return t`Read only when canManualFire is absent.`;
    },
  },
  fireState: {
    get label() {
      return t`Starting fire state`;
    },
    get help() {
      return t`0 hold fire, 1 return fire, 2 fire at will, 3 fire at neutral. At -1 the unit copies the fire state of whatever built it.`;
    },
  },
  noAutoFire: {
    get label() {
      return t`Fire state is fixed`;
    },
    get help() {
      return t`Takes away the player's hold fire and return fire buttons, and makes the unit default to fire at will.`;
    },
  },
  stopToAttack: {
    get label() {
      return t`Stops to shoot`;
    },
  },
  strafeToAttack: {
    get label() {
      return t`Sidesteps to get a shot`;
    },
    get help() {
      return t`The unit moves sideways when it cannot shoot from where it is.`;
    },
  },
  hoverAttack: {
    get label() {
      return t`Attacks from a hover`;
    },
    get help() {
      return t`An aircraft holds position to shoot instead of making passes. It also decides which of the two aircraft movement types the unit gets.`;
    },
  },
  highTrajectory: {
    get label() {
      return t`Arc of fire`;
    },
    get help() {
      return t`0 low only, 1 high only, 2 the player chooses.`;
    },
  },
  canDropFlare: {
    get label() {
      return t`Drops flares`;
    },
    get help() {
      return t`The unit throws out a decoy whenever a missile comes at it.`;
    },
  },
  flareReload: {
    get label() {
      return t`Flare reload`;
    },
    unit: "s",
    get help() {
      return t`The wait before the unit can drop another flare.`;
    },
  },
  flareDelay: {
    get label() {
      return t`Flare arming delay`;
    },
    get help() {
      return t`Multiplied by a random 1 to 2 and then by 15 frames, so 1 here is between half a second and a second before the flare starts working.`;
    },
  },
  flareEfficiency: {
    get label() {
      return t`Flare efficiency`;
    },
    get help() {
      return t`The chance, from 0 to 1, that each incoming missile is fooled into chasing the flare instead.`;
    },
  },
  flareSalvoSize: {
    get label() {
      return t`Flares per drop`;
    },
  },
  flareDropVector: {
    get label() {
      return t`Flare launch direction`;
    },
    get help() {
      return t`Extra velocity given to the flare, along the unit's own right, up and forward axes.`;
    },
  },
  // Both are multiplied by GAME_SPEED, so the def writes seconds.
  flareTime: {
    get label() {
      return t`Flare lifetime`;
    },
    unit: "s",
  },
  flareSalvoDelay: {
    get label() {
      return t`Flare salvo delay`;
    },
    unit: "s",
  },

  footprintX: {
    get label() {
      return t`Footprint width`;
    },
    unit: "build squares",
    get help() {
      return t`One build square is 16 elmos.`;
    },
  },
  footprintZ: {
    get label() {
      return t`Footprint depth`;
    },
    unit: "build squares",
    get help() {
      return t`One build square is 16 elmos.`;
    },
  },
  yardMap: {
    get label() {
      return t`Yard map`;
    },
    get help() {
      return t`One character per footprint square saying what may pass or be built there. Prefix with h for a half-square grid.`;
    },
  },
  buildingMask: {
    get label() {
      return t`Building mask`;
    },
    get help() {
      return t`A bit mask matched against the mask the game's Lua has painted on each map square. A building only goes down where the two share a bit. Bit 1 is the ordinary case.`;
    },
  },
  levelGround: {
    get label() {
      return t`Flattens the ground`;
    },
    get help() {
      return t`The ground under the building is levelled when it goes up. Only matters for a building.`;
    },
  },
  useGroundDecal: {
    get label() {
      return t`Leaves a ground mark`;
    },
    get help() {
      return t`Draws a stain under the unit while it stands there.`;
    },
  },
  groundDecalType: {
    get label() {
      return t`Ground mark texture`;
    },
    get help() {
      return t`A texture file. With no extension the engine adds .bmp, and it looks for the file as written, then under bitmaps/, then under unittextures/.`;
    },
  },
  groundDecalSizeX: {
    get label() {
      return t`Ground mark width`;
    },
    unit: "build squares",
    get help() {
      return t`Multiplied by 8 elmos to give the distance from the centre to each edge, so 4 draws a mark 64 elmos across.`;
    },
  },
  groundDecalSizeY: {
    get label() {
      return t`Ground mark depth`;
    },
    unit: "build squares",
    get help() {
      return t`Multiplied by 8 elmos to give the distance from the centre to each edge.`;
    },
  },
  groundDecalDecaySpeed: {
    get label() {
      return t`Ground mark fade rate`;
    },
    get help() {
      return t`How much alpha the mark loses each second once the unit is gone.`;
    },
  },
  useBuildingGroundDecal: {
    get label() {
      return t`Leaves a ground mark (old name)`;
    },
    get help() {
      return t`Read only when useGroundDecal is absent.`;
    },
  },
  buildingGroundDecalType: {
    get label() {
      return t`Ground mark texture (old name)`;
    },
    get help() {
      return t`Read only when groundDecalType is absent.`;
    },
  },
  buildingGroundDecalSizeX: {
    get label() {
      return t`Ground mark width (old name)`;
    },
    unit: "build squares",
  },
  buildingGroundDecalSizeY: {
    get label() {
      return t`Ground mark depth (old name)`;
    },
    unit: "build squares",
  },
  buildingGroundDecalDecaySpeed: {
    get label() {
      return t`Ground mark fade rate (old name)`;
    },
  },

  collide: {
    get label() {
      return t`Collides with units`;
    },
    get help() {
      return t`Off, other units pass straight through this one.`;
    },
  },
  blocking: {
    get label() {
      return t`Blocks the ground`;
    },
    get help() {
      return t`Whether the unit takes up space that other units and buildings have to work around.`;
    },
  },
  pushResistant: {
    get label() {
      return t`Resists being pushed`;
    },
    get help() {
      return t`Other units cannot shove this one out of the way while it is holding its ground.`;
    },
  },
  groundFrictionCoefficient: {
    get label() {
      return t`Ground friction`;
    },
    get help() {
      return t`Slows a unit down while it is skidding.`;
    },
  },
  rollingResistanceCoefficient: {
    get label() {
      return t`Rolling resistance`;
    },
    get help() {
      return t`Slows a unit down while it is going faster than its own maximum speed, which is what brings it back down to that speed.`;
    },
  },
  atmosphericDragCoefficient: {
    get label() {
      return t`Air drag`;
    },
    get help() {
      return t`Slows a unit down while it is skidding or over its maximum speed.`;
    },
  },
  collisionVolumeType: {
    get label() {
      return t`Collision volume shape (flat spelling)`;
    },
    get help() {
      return t`The first character is the shape and the last is the axis, so cylY is a cylinder on y. Read only when there is no collisionVolume table.`;
    },
  },
  collisionVolumeScales: {
    get label() {
      return t`Collision volume size (flat spelling)`;
    },
    unit: "elmo",
    get help() {
      return t`Read only when there is no collisionVolume table.`;
    },
  },
  collisionVolumeOffsets: {
    get label() {
      return t`Collision volume offset (flat spelling)`;
    },
    unit: "elmo",
    get help() {
      return t`Read only when there is no collisionVolume table.`;
    },
  },
  usePieceCollisionVolumes: {
    get label() {
      return t`Hit the model's pieces`;
    },
    get help() {
      return t`Shots are tested against each model piece instead of one volume around the whole unit, and the main volume stops taking hits.`;
    },
  },
  useFootPrintCollisionVolume: {
    get label() {
      return t`Use the footprint as the volume`;
    },
    get help() {
      return t`The collision volume is taken from the footprint rather than from the numbers above.`;
    },
  },
  "selectionVolume.type": {
    get label() {
      return t`Selection volume shape`;
    },
    get help() {
      return t`The volume the mouse has to hit to pick the unit, which need not match the one shots are tested against. A character: b box, e ellipsoid, c cylinder, s sphere.`;
    },
  },
  "selectionVolume.axis": {
    get label() {
      return t`Selection volume axis`;
    },
    get help() {
      return t`A character: x, y or z. Only meaningful for a cylinder.`;
    },
  },
  "selectionVolume.scales": {
    get label() {
      return t`Selection volume size`;
    },
    unit: "elmo",
  },
  "selectionVolume.offsets": {
    get label() {
      return t`Selection volume offset`;
    },
    unit: "elmo",
    get help() {
      return t`From the model's centre.`;
    },
  },
  selectionVolumeType: {
    get label() {
      return t`Selection volume shape (flat spelling)`;
    },
    get help() {
      return t`The first character is the shape and the last is the axis. Read only when there is no selectionVolume table, and it falls back to the collision volume's spelling.`;
    },
  },
  selectionVolumeScales: {
    get label() {
      return t`Selection volume size (flat spelling)`;
    },
    unit: "elmo",
    get help() {
      return t`Falls back to the collision volume's size.`;
    },
  },
  selectionVolumeOffsets: {
    get label() {
      return t`Selection volume offset (flat spelling)`;
    },
    unit: "elmo",
    get help() {
      return t`Falls back to the collision volume's offset.`;
    },
  },
  usePieceSelectionVolumes: {
    get label() {
      return t`Select on the model's pieces`;
    },
    get help() {
      return t`The mouse is tested against each model piece instead of one volume around the whole unit.`;
    },
  },
  useFootPrintSelectionVolume: {
    get label() {
      return t`Select on the footprint`;
    },
    get help() {
      return t`The selection volume is taken from the footprint rather than from the numbers above.`;
    },
  },

  objectName: {
    get label() {
      return t`Model`;
    },
    get help() {
      return t`The model file under objects3d/.`;
    },
    asset: "model",
  },
  script: {
    get label() {
      return t`Unit script`;
    },
    get help() {
      return t`Resolved under scripts/, defaulting to the unit name with a .cob suffix.`;
    },
    asset: "script",
  },
  buildPic: {
    get label() {
      return t`Build picture`;
    },
    get help() {
      return t`The picture under unitpics/. With none, the engine looks for one named after the unit.`;
    },
    asset: "picture",
  },
  iconType: {
    get label() {
      return t`Map icon`;
    },
    // Not a path, so deliberately not an asset field. Beyond All Reason writes
    // "armaak" here and Balanced Annihilation "armcommander", and both name an
    // entry in the game's own icon table rather than a file.
    get help() {
      return t`Names an entry in the game's gamedata/icontypes.lua, not a file.`;
    },
  },
  corpse: {
    get label() {
      return t`Wreck`;
    },
    get help() {
      return t`The feature left behind on death.`;
    },
  },
  explodeAs: {
    get label() {
      return t`Death explosion`;
    },
    get help() {
      return t`A weapon definition name.`;
    },
  },
  selfDestructAs: {
    get label() {
      return t`Self destruct explosion`;
    },
    get help() {
      return t`A weapon definition name. Falls back to explodeAs.`;
    },
  },
  category: {
    get label() {
      return t`Categories`;
    },
    get help() {
      return t`Space separated category names.`;
    },
  },
  noChaseCategory: {
    get label() {
      return t`Will not chase`;
    },
    get help() {
      return t`Space separated category names this unit refuses to pursue.`;
    },
  },
  cobID: {
    get label() {
      return t`COB identifier`;
    },
    get help() {
      return t`The number the unit's own script reads back from GET COB_ID. Only the game's scripts give it meaning.`;
    },
  },
  decoyFor: {
    get label() {
      return t`Disguised as`;
    },
    get help() {
      return t`Names the unit this one pretends to be. An enemy sees that unit's model and name instead of this one's.`;
    },
  },
  power: {
    get label() {
      return t`Power`;
    },
    get help() {
      return t`What the unit is worth when experience is shared out after a kill. Defaults to the metal cost plus a sixtieth of the energy cost, and the engine floors it just above zero.`;
    },
  },
  maxThisUnit: {
    get label() {
      return t`Maximum in play`;
    },
    get help() {
      return t`How many of this unit one team may have alive at once. The game's own restrictions can lower it further but never raise it.`;
    },
  },
  unitRestricted: {
    get label() {
      return t`Maximum in play (old name)`;
    },
    get help() {
      return t`Read only when maxThisUnit is absent.`;
    },
  },
  isFeature: {
    get label() {
      return t`Turns into its wreck`;
    },
    get help() {
      return t`The moment this unit finishes building it is replaced by the feature named in its wreck field. It is how a game builds a rock or a wall.`;
    },
  },
  isFirePlatform: {
    get label() {
      return t`Passengers can shoot`;
    },
    get help() {
      return t`Units being carried by this transport keep firing.`;
    },
  },
  isTargetingUpgrade: {
    get label() {
      return t`Targeting facility`;
    },
    get help() {
      return t`While switched on, this unit shrinks its ally team's radar targeting error.`;
    },
  },
  showPlayerName: {
    get label() {
      return t`Show the player's name`;
    },
    get help() {
      return t`The tooltip and the selection label read the owning player's name instead of the unit's.`;
    },
  },
  canMove: {
    get label() {
      return t`Can move`;
    },
    get help() {
      return t`Whether the unit moves at all. A unit with this on and no movement class is dropped at load.`;
    },
  },
  movementClass: {
    get label() {
      return t`Movement class`;
    },
    get help() {
      return t`Names an entry in the game's move definitions. Required for a ground unit.`;
    },
  },
  customParams: {
    get label() {
      return t`Custom parameters`;
    },
    get help() {
      return t`Arbitrary key and value pairs the engine ignores. Only the game's own Lua gives them meaning.`;
    },
  },

  "sounds.select": {
    get label() {
      return t`Selected sound`;
    },
  },
  "sounds.ok": {
    get label() {
      return t`Order acknowledged sound`;
    },
  },
  "sounds.arrived": {
    get label() {
      return t`Arrived sound`;
    },
  },
  "sounds.cant": {
    get label() {
      return t`Order refused sound`;
    },
  },
  "sounds.underattack": {
    get label() {
      return t`Under attack sound`;
    },
  },
  "sounds.build": {
    get label() {
      return t`Building sound`;
    },
  },
  "sounds.activate": {
    get label() {
      return t`Switched on sound`;
    },
  },
  "sounds.deactivate": {
    get label() {
      return t`Switched off sound`;
    },
  },
  // A sound key holds either a file name or a numbered list of tables, and the
  // engine picks one of the list at random each time it plays.
  "sounds.*.*.file": {
    get label() {
      return t`Sound file`;
    },
    get help() {
      return t`One of several the engine picks between. Give the sound key a numbered list of tables to use this.`;
    },
  },
  "sounds.*.*.volume": {
    get label() {
      return t`Sound volume`;
    },
    get help() {
      return t`A sound set to zero volume is dropped rather than played quietly.`;
    },
  },

  nanoColor: {
    get label() {
      return t`Nano spray colour`;
    },
    get help() {
      return t`Red, green and blue from 0 to 1.`;
    },
  },
  leaveTracks: {
    get label() {
      return t`Leaves tracks`;
    },
    get help() {
      return t`Draws a trail on the ground behind the unit as it moves.`;
    },
  },
  trackType: {
    get label() {
      return t`Track texture`;
    },
    get help() {
      return t`A texture in bitmaps/tracks/. Only the base name is used, so the folder and the extension can be left off.`;
    },
  },
  trackWidth: {
    get label() {
      return t`Track width`;
    },
    unit: "elmo",
  },
  trackOffset: {
    get label() {
      return t`Track offset`;
    },
    unit: "elmo",
    get help() {
      return t`How far in front of the unit's centre the track is laid.`;
    },
  },
  trackStrength: {
    get label() {
      return t`Track lifetime`;
    },
    get help() {
      return t`Multiplied by 90 frames to give how long a track lasts, so 1 is three seconds. Zero leaves no track at all.`;
    },
  },
  trackStretch: {
    get label() {
      return t`Track texture stretch`;
    },
    get help() {
      return t`Multiplies the track width to decide how far the texture runs before it repeats.`;
    },
  },

  "weapons.*.name": {
    get label() {
      return t`Weapon`;
    },
    get help() {
      return t`Names an entry in the game's weapon definitions.`;
    },
  },
  "weapons.*.slaveTo": {
    get label() {
      return t`Slaved to weapon`;
    },
    get help() {
      return t`Counting from one, the mount on this unit whose target this weapon copies. Zero leaves it picking its own.`;
    },
  },
  "weapons.*.mainDir": {
    get label() {
      return t`Firing arc centre`;
    },
    get help() {
      return t`The direction the arc is measured from, in the unit's own coordinates. The default points forward.`;
    },
  },
  "weapons.*.maxAngleDif": {
    get label() {
      return t`Firing arc`;
    },
    unit: "degrees",
    get help() {
      return t`The full width of the arc around the arc centre, so 360 is no restriction and 90 is 45 degrees either side.`;
    },
  },
  "weapons.*.onlyTargetCategory": {
    get label() {
      return t`Only shoots at`;
    },
    get help() {
      return t`Space separated category names. Empty means anything.`;
    },
  },
  "weapons.*.badTargetCategory": {
    get label() {
      return t`Poor targets`;
    },
    get help() {
      return t`Space separated category names this weapon will shoot only as a last resort.`;
    },
  },
  "weapons.*.weaponAimAdjustPriority": {
    get label() {
      return t`Prefers targets it already faces`;
    },
    get help() {
      return t`A multiplier on how much target picking favours whatever the weapon is already aimed at.`;
    },
  },
  "weapons.*.fastAutoRetargeting": {
    get label() {
      return t`Retargets immediately`;
    },
    get help() {
      return t`Picks a new target the moment the current one dies rather than waiting for the next half second check. Costs more processing.`;
    },
  },
  "weapons.*.fastQueryPointUpdate": {
    get label() {
      return t`Checks its muzzle every frame`;
    },
    get help() {
      return t`Asks the unit script which piece it is firing from before every friendly fire check, rather than twice a second.`;
    },
  },
  "weapons.*.burstControlWhenOutOfArc": {
    get label() {
      return t`Burst outside the arc`;
    },
    get help() {
      return t`0 fires the rest of the burst wherever the target went, 1 wastes those shots, 2 keeps firing in whatever direction the muzzle already points.`;
    },
  },
  "weapons.*.accurateLeading": {
    get label() {
      return t`Leading accuracy`;
    },
    get help() {
      return t`How much work goes into aiming ahead of a moving target. 0 undershoots anything closing or running, 1 solves it exactly for a flat shot, and more adds passes for an arcing one.`;
    },
  },

  "collisionVolume.type": {
    get label() {
      return t`Collision volume shape`;
    },
    get help() {
      return t`A character: b box, e ellipsoid, c cylinder, s sphere.`;
    },
  },
  "collisionVolume.axis": {
    get label() {
      return t`Collision volume axis`;
    },
    get help() {
      return t`A character: x, y or z. Only meaningful for a cylinder.`;
    },
  },
  "collisionVolume.scales": {
    get label() {
      return t`Collision volume size`;
    },
    unit: "elmo",
  },
  "collisionVolume.offsets": {
    get label() {
      return t`Collision volume offset`;
    },
    unit: "elmo",
    get help() {
      return t`From the model's centre.`;
    },
  },
};

/**
 * Notes on weapon definition fields. The engine already writes a description
 * for every tagged weapon key, so this adds labels and the units of measure
 * those descriptions only mention in passing.
 */
export const WEAPON_FIELD_NOTES: Record<string, FieldNote> = {
  name: {
    get label() {
      return t`Display name`;
    },
  },
  weaponType: {
    get label() {
      return t`Weapon type`;
    },
  },
  range: {
    get label() {
      return t`Range`;
    },
    unit: "elmo",
  },
  reloadTime: {
    get label() {
      return t`Reload time`;
    },
    unit: "s",
  },
  burstRate: {
    get label() {
      return t`Delay between shots in a burst`;
    },
    unit: "s",
  },
  burst: {
    get label() {
      return t`Shots per burst`;
    },
  },
  projectiles: {
    get label() {
      return t`Projectiles per shot`;
    },
  },
  weaponVelocity: {
    get label() {
      return t`Projectile speed`;
    },
    unit: "elmo/s",
  },
  maxVelocity: {
    get label() {
      return t`Projectile speed (old name)`;
    },
    unit: "elmo/s",
  },
  startvelocity: {
    get label() {
      return t`Starting speed`;
    },
    unit: "elmo/s",
  },
  weaponacceleration: {
    get label() {
      return t`Projectile acceleration`;
    },
    unit: "elmo/s²",
  },
  turnrate: {
    get label() {
      return t`Tracking turn rate`;
    },
    unit: "COB angle/s",
    get help() {
      return t`65536 COB angle units is a full turn.`;
    },
  },
  tolerance: {
    get label() {
      return t`Firing cone`;
    },
    unit: "COB angle",
    get help() {
      return t`65536 COB angle units is a full turn. Only used when turret is off.`;
    },
  },
  firetolerance: {
    get label() {
      return t`Reaim threshold`;
    },
    unit: "COB angle",
  },
  flighttime: {
    get label() {
      return t`Projectile lifetime`;
    },
    unit: "s",
  },
  weaponTimer: {
    get label() {
      return t`Ascent time`;
    },
    unit: "s",
  },
  windup: {
    get label() {
      return t`Windup`;
    },
    unit: "s",
  },
  areaOfEffect: {
    get label() {
      return t`Splash diameter`;
    },
    unit: "elmo",
    get help() {
      return t`A diameter, not a radius.`;
    },
  },
  craterAreaOfEffect: {
    get label() {
      return t`Crater diameter`;
    },
    unit: "elmo",
  },
  damage: {
    get label() {
      return t`Damage`;
    },
    get help() {
      return t`One entry per armour class. The default entry covers the rest.`;
    },
  },
  customParams: {
    get label() {
      return t`Custom parameters`;
    },
    get help() {
      return t`Arbitrary key and value pairs the engine ignores. Only the game's own Lua gives them meaning.`;
    },
  },
  acceleration: {
    get label() {
      return t`Projectile acceleration (old name)`;
    },
    unit: "elmo/s²",
  },
  accuracy: {
    get label() {
      return t`Burst accuracy`;
    },
    get help() {
      return t`Higher is less accurate. 0 is perfect. Improves with the firing unit's experience.`;
    },
  },
  allowNonBlockingAim: {
    get label() {
      return t`Aims without blocking fire`;
    },
    get help() {
      return t`Off, the weapon can't fire until AimWeapon() returns in the unit's script.`;
    },
  },
  alphaDecay: {
    get label() {
      return t`Cannon stage fade`;
    },
    get help() {
      return t`Cannon only. How much the last stage's alpha fades, blended for the ones in between. See stages.`;
    },
  },
  alwaysVisible: {
    get label() {
      return t`Always visible`;
    },
    get help() {
      return t`Draws the projectile even outside sight.`;
    },
  },
  animParams: {
    get label() {
      return t`Flipbook animation (old name)`;
    },
    get help() {
      return t`Frame columns, rows and playback rate for texture1's flipbook animation, and the default for texture2, 3 and 4 too.`;
    },
  },
  animParams1: {
    get label() {
      return t`Flipbook animation (texture 1)`;
    },
    get help() {
      return t`Frame columns, rows and playback rate for texture1's flipbook animation.`;
    },
  },
  animParams2: {
    get label() {
      return t`Flipbook animation (texture 2)`;
    },
    get help() {
      return t`Frame columns, rows and playback rate for texture2's flipbook animation.`;
    },
  },
  animParams3: {
    get label() {
      return t`Flipbook animation (texture 3)`;
    },
    get help() {
      return t`Frame columns, rows and playback rate for texture3's flipbook animation.`;
    },
  },
  animParams4: {
    get label() {
      return t`Flipbook animation (texture 4)`;
    },
    get help() {
      return t`Frame columns, rows and playback rate for texture4's flipbook animation.`;
    },
  },
  avoidCloaked: {
    get label() {
      return t`Avoids firing through cloaked units`;
    },
    get help() {
      return t`See avoidFriendly for how avoiding differs from colliding.`;
    },
  },
  avoidFeature: {
    get label() {
      return t`Avoids firing through features`;
    },
  },
  avoidFriendly: {
    get label() {
      return t`Avoids firing through allies`;
    },
    get help() {
      return t`An ally can still walk into the projectile after it's fired; use collideFriendly to stop the explosion happening at all.`;
    },
  },
  avoidGround: {
    get label() {
      return t`Avoids firing through blocking terrain`;
    },
  },
  avoidNeutral: {
    get label() {
      return t`Avoids firing through neutral units`;
    },
    get help() {
      return t`Does not include Gaia.`;
    },
  },
  beamburst: {
    get label() {
      return t`Beam fires in bursts`;
    },
    get help() {
      return t`BeamLaser only. Uses burst mechanics, with beamtime forced to the length of one sim frame.`;
    },
  },
  beamDecay: {
    get label() {
      return t`Beam fade per frame`;
    },
    get help() {
      return t`BeamLaser only. Alpha multiplier applied every sim frame.`;
    },
  },
  beamtime: {
    get label() {
      return t`Beam duration`;
    },
    unit: "s",
    get help() {
      return t`BeamLaser only. Damage is spread out over this time.`;
    },
  },
  beamTTL: {
    get label() {
      return t`Beam sprite linger time`;
    },
    unit: "frames",
    get help() {
      return t`BeamLaser and LightningCannon only.`;
    },
  },
  bounceExplosionGenerator: {
    get label() {
      return t`Bounce effect`;
    },
    get help() {
      return t`Name, with prefix, of the custom explosion generator played when the projectile bounces.`;
    },
  },
  bounceRebound: {
    get label() {
      return t`Bounce vertical rebound`;
    },
    get help() {
      return t`Multiplies vertical velocity when the projectile bounces.`;
    },
  },
  bounceSlip: {
    get label() {
      return t`Bounce horizontal slip`;
    },
    get help() {
      return t`Multiplies horizontal velocity when the projectile bounces.`;
    },
  },
  burnblow: {
    get label() {
      return t`Explodes at end of flight`;
    },
    get help() {
      return t`LaserCannon expires at the target instead of at max range. Cannon explodes on reaching the target instead of falling. Missile, Starburst and TorpedoLauncher explode when out of fuel instead of falling.`;
    },
  },
  cameraShake: {
    get label() {
      return t`Camera shake strength`;
    },
    get help() {
      return t`Passed to widgets so they can shake the camera on a strong hit. Uses the same scale as damage.`;
    },
  },
  canAttackGround: {
    get label() {
      return t`Can target ground`;
    },
    get help() {
      return t`Off, only units can be targeted. Features are never directly targetable either way.`;
    },
  },
  castShadow: {
    get label() {
      return t`Projectile casts a shadow`;
    },
  },
  cegTag: {
    get label() {
      return t`Trail effect`;
    },
    get help() {
      return t`Name, without prefix, of a custom explosion generator emitted by the projectile every frame.`;
    },
  },
  collideCloaked: {
    get label() {
      return t`Collides with cloaked units`;
    },
    get help() {
      return t`See collideFriendly for how colliding differs from avoiding.`;
    },
  },
  collideEnemy: {
    get label() {
      return t`Collides with enemies`;
    },
    get help() {
      return t`Off, the projectile passes through enemies without exploding. Targeting still always picks enemies, never allies.`;
    },
  },
  collideFeature: {
    get label() {
      return t`Collides with features`;
    },
  },
  collideFireBase: {
    get label() {
      return t`Collides with its own firebase`;
    },
    get help() {
      return t`Off, a unit can fire out of the transport carrying it (its firebase) without exploding early. Useful for marines shooting from inside a bunker.`;
    },
  },
  collideFriendly: {
    get label() {
      return t`Collides with allies`;
    },
    get help() {
      return t`Off, projectiles pass through allies without exploding. Whether the unit avoids firing through them at all is controlled separately by avoidFriendly.`;
    },
  },
  collideGround: {
    get label() {
      return t`Collides with terrain`;
    },
  },
  collideNeutral: {
    get label() {
      return t`Collides with neutral units`;
    },
    get help() {
      return t`Does not include Gaia.`;
    },
  },
  collideNonTarget: {
    get label() {
      return t`Collides with things that aren't its target`;
    },
    get help() {
      return t`Off, the projectile ignores everything except what it's locked onto, including other enemies. Combine with tracks and impactOnly for weapons that are mostly visual.`;
    },
  },
  collisionSize: {
    get label() {
      return t`Collision size`;
    },
    unit: "elmo",
    get help() {
      return t`Width for hitscan interceptors. Meant to be a collision radius for other projectile types too, but that part doesn't currently work.`;
    },
  },
  color1: {
    get label() {
      return t`Removed, use rgbColor`;
    },
    get help() {
      return t`The engine only logs a warning and ignores this key.`;
    },
  },
  color2: {
    get label() {
      return t`Removed, use rgbColor`;
    },
    get help() {
      return t`The engine only logs a warning and ignores this key.`;
    },
  },
  colormap: {
    get label() {
      return t`Colour cycle`;
    },
    get help() {
      return t`A series of RGBA colours the sprite fades through over its lifetime, when it has no model.`;
    },
  },
  commandfire: {
    get label() {
      return t`Only fires on manual command`;
    },
    get help() {
      return t`On, the weapon never fires automatically and only responds to the manual fire command.`;
    },
  },
  coreThickness: {
    get label() {
      return t`Beam core thickness`;
    },
    get help() {
      return t`BeamLaser and LaserCannon only. Fraction, 0 to 1, of the beam's full thickness that shows the inner colour set by rgbColor2.`;
    },
  },
  coverage: {
    get label() {
      return t`Interception radius`;
    },
    unit: "elmo",
    get help() {
      return t`How close a targetable weapon has to be for this interceptor to fire on it.`;
    },
  },
  craterBoost: {
    get label() {
      return t`Crater strength bonus`;
    },
    get help() {
      return t`Flat addition to cratering strength, applied after altitude reduction but before craterMult.`;
    },
  },
  craterMult: {
    get label() {
      return t`Crater strength multiplier`;
    },
    get help() {
      return t`Applied last, after every other cratering modifier.`;
    },
  },
  cylinderTargeting: {
    get label() {
      return t`Cylinder targeting height`;
    },
    get help() {
      return t`Multiplies range to get the height of a targeting cylinder. Zero uses the normal spherical or ballistic range check instead.`;
    },
  },
  cylinderTargetting: {
    get label() {
      return t`Cylinder targeting height (old spelling)`;
    },
    get help() {
      return t`Multiplies range to get the height of a targeting cylinder. Zero uses the normal spherical or ballistic range check instead.`;
    },
  },
  damageAreaOfEffect: {
    get label() {
      return t`Splash diameter`;
    },
    unit: "elmo",
    get help() {
      return t`A diameter, not a radius. Also the collision radius for projectile-based interceptors. Cratering is controlled separately by craterAreaOfEffect.`;
    },
  },
  dance: {
    get label() {
      return t`Missile wobble distance`;
    },
    unit: "elmo",
    get help() {
      return t`Missile only. Maximum random sideways shift, rerolled every 8 sim frames.`;
    },
  },
  duration: {
    get label() {
      return t`Beam visual length`;
    },
    get help() {
      return t`LaserCannon only. Visual-only, expressed as a fraction of the projectile's per-second speed.`;
    },
  },
  dynDamageExp: {
    get label() {
      return t`Range damage falloff exponent`;
    },
    get help() {
      return t`0 disables range-based damage scaling. 1 is linear, 2 is quadratic, and so on.`;
    },
  },
  dynDamageInverted: {
    get label() {
      return t`Damage increases with range`;
    },
    get help() {
      return t`On, the weapon does more damage at greater range instead of less.`;
    },
  },
  dynDamageMin: {
    get label() {
      return t`Minimum range-scaled damage`;
    },
    get help() {
      return t`The floor that range-dependent damage cannot drop below.`;
    },
  },
  dynDamageRange: {
    get label() {
      return t`Range used for damage scaling`;
    },
    unit: "elmo",
    get help() {
      return t`Replaces the actual range in the range-dependent damage formula, when set to a non-zero value.`;
    },
  },
  edgeEffectiveness: {
    get label() {
      return t`Splash falloff shape`;
    },
    get help() {
      return t`0 is a linear falloff to the edge of the splash. 1 is no falloff at all. Negative values concentrate damage further into the centre.`;
    },
  },
  energyPerShot: {
    get label() {
      return t`Energy cost per shot`;
    },
    unit: "energy",
    get help() {
      return t`For stockpile weapons this is spent over time as it stockpiles; otherwise it's spent immediately on firing.`;
    },
  },
  explosionGenerator: {
    get label() {
      return t`Impact effect`;
    },
    get help() {
      return t`Name, with prefix, of the custom explosion generator played on impact.`;
    },
  },
  explosionScar: {
    get label() {
      return t`Leaves a scar decal`;
    },
  },
  explosionSpeed: {
    get label() {
      return t`Shockwave propagation speed`;
    },
    get help() {
      return t`Controls how fast the damage shockwave spreads outward. Units can't dodge it: they're tagged for damage immediately and only take it after a delay.`;
    },
  },
  exteriorShield: {
    get label() {
      return t`Shield lets outgoing fire through (old name)`;
    },
  },
  falloffRate: {
    get label() {
      return t`Laser fade rate beyond range`;
    },
    get help() {
      return t`LaserCannon with hardstop off only. Fraction the laser fades per sim frame past max range. The engine floors this at 0.2, so a laser never takes more than 5 frames to fade out fully.`;
    },
  },
  fireStarter: {
    get label() {
      return t`Fire-starting chance`;
    },
    unit: "%",
    get help() {
      return t`Chance of setting static map features alight on impact.`;
    },
  },
  fireSubmersed: {
    get label() {
      return t`Can fire while underwater`;
    },
    get help() {
      return t`Requires waterweapon to also be on.`;
    },
  },
  fixedLauncher: {
    get label() {
      return t`Launches along a fixed heading`;
    },
    get help() {
      return t`Missile, Torpedo and Starburst only. Starts aimed along the launching piece's own direction rather than at the target.`;
    },
  },
  flameGfxTime: {
    get label() {
      return t`Flame visual reach`;
    },
    get help() {
      return t`Flamethrower only. Multiplies the weapon's range for the visual-only flame length; at 1.2 the visual extends 20% past max range. Should be 1 or higher.`;
    },
  },
  gravityAffected: {
    get label() {
      return t`Falls under gravity`;
    },
    get help() {
      return t`DGun weapon type only. Aiming does not account for the fall.`;
    },
  },
  groundBounce: {
    get label() {
      return t`Bounces off terrain`;
    },
  },
  hardstop: {
    get label() {
      return t`Laser stops sharply at range`;
    },
    get help() {
      return t`LaserCannon only. On, the laser is cut off at max range. Off, it fades out past range according to intensityFalloff and can no longer collide.`;
    },
  },
  heightBoostFactor: {
    get label() {
      return t`Ballistic height range bonus`;
    },
    get help() {
      return t`Cannon weapon type only. Adjusts ballistic range for height difference to the target; larger values increase the effect. -1 uses the engine's own formula. How it stacks with heightmod isn't documented.`;
    },
  },
  heightmod: {
    get label() {
      return t`Height difference multiplier`;
    },
    get help() {
      return t`Below 1, the unit can target further above or below itself than sideways. At 0, height to the target is ignored entirely for targeting.`;
    },
  },
  heightMod: {
    get label() {
      return t`Height difference multiplier (case variant)`;
    },
    get help() {
      return t`Read with a capital M as an alternate spelling of heightmod. Its default depends on whether the weapon is ballistic (0.8) or guided (1.0).`;
    },
  },
  highTrajectory: {
    get label() {
      return t`Trajectory choice`;
    },
    get help() {
      return t`0 is low trajectory, 1 is high trajectory, 2 gives the player a toggle between the two.`;
    },
  },
  impactOnly: {
    get label() {
      return t`Only damages what it hits`;
    },
    get help() {
      return t`Roughly the same as a zero area of effect but without that value's side effects, and it also stops cratering.`;
    },
  },
  impulseBoost: {
    get label() {
      return t`Flat impulse bonus`;
    },
    get help() {
      return t`Added on top of the impulse from impulseFactor.`;
    },
  },
  impulseFactor: {
    get label() {
      return t`Impulse multiplier`;
    },
    get help() {
      return t`For most weapons, base impulse equals the damage dealt. For melee weapons it's the attacker's mass instead.`;
    },
  },
  intensity: {
    get label() {
      return t`Projectile transparency`;
    },
    get help() {
      return t`Sprite-only. Lower is more transparent; 0 makes the projectile invisible.`;
    },
  },
  interceptedByShieldType: {
    get label() {
      return t`Shield interception bitmask (incoming)`;
    },
    get help() {
      return t`Each set bit lets a shield whose shieldInterceptType has the matching bit hit this weapon.`;
    },
  },
  interceptor: {
    get label() {
      return t`Weapon interception bitmask (outgoing)`;
    },
    get help() {
      return t`Each set bit lets this weapon intercept a weapon whose targetable has the matching bit set.`;
    },
  },
  interceptSolo: {
    get label() {
      return t`Exclusive interception`;
    },
    get help() {
      return t`On, once one interceptor is chasing a projectile, no other interceptor may also target it.`;
    },
  },
  isShield: {
    get label() {
      return t`Removed, use weaponType Shield`;
    },
    get help() {
      return t`The engine only logs a warning and ignores this key. Set weaponType to "Shield" instead.`;
    },
  },
  largeBeamLaser: {
    get label() {
      return t`Large beam laser texturing`;
    },
    get help() {
      return t`BeamLaser only. Switches on extra texturing for the 'large' variant. Does not change size on its own.`;
    },
  },
  laserFlareSize: {
    get label() {
      return t`Beam flare size`;
    },
    unit: "elmo",
    get help() {
      return t`BeamLaser only.`;
    },
  },
  leadBonus: {
    get label() {
      return t`Target-leading XP bonus`;
    },
    get help() {
      return t`Added to leadLimit, multiplied by the firing unit's raw experience, when leadLimit isn't unlimited.`;
    },
  },
  leadLimit: {
    get label() {
      return t`Target-leading distance limit`;
    },
    unit: "elmo",
    get help() {
      return t`Negative values mean no limit.`;
    },
  },
  lodDistance: {
    get label() {
      return t`Simplified-rendering distance`;
    },
    unit: "elmo",
    get help() {
      return t`LaserCannon only. Beyond this distance the beam is drawn without its rounded ends.`;
    },
  },
  metalPerShot: {
    get label() {
      return t`Metal cost per shot`;
    },
    unit: "metal",
    get help() {
      return t`For stockpile weapons this is spent over time as it stockpiles; otherwise it's spent immediately on firing.`;
    },
  },
  minIntensity: {
    get label() {
      return t`Minimum damage falloff`;
    },
    get help() {
      return t`BeamLaser only. The lowest fraction of full damage the beam can fall off to across its range; 1.0 disables falloff entirely. Distinct from the visual-only intensity, and largely duplicates dynDamageExp.`;
    },
  },
  model: {
    get label() {
      return t`3D model`;
    },
    get help() {
      return t`Name of a model to use for the projectile. Without one, the weapon falls back to 2D sprites.`;
    },
  },
  movingAccuracy: {
    get label() {
      return t`Burst accuracy while moving`;
    },
    get help() {
      return t`Same as accuracy, but used while the firing unit is moving.`;
    },
  },
  myGravity: {
    get label() {
      return t`Gravity override`;
    },
    get help() {
      return t`Overrides the map's gravity for ballistic weapons and missiles; missiles are only affected once flightTime runs out. 0 disables the override and uses map gravity.`;
    },
  },
  noExplode: {
    get label() {
      return t`Never removed by exploding`;
    },
    get help() {
      return t`The projectile survives its own explosion and keeps going, exploding again on every sim frame it spends inside a collision volume. Multiplies damage enormously.`;
    },
  },
  noGap: {
    get label() {
      return t`Keeps cannon stages touching`;
    },
    get help() {
      return t`Cannon only. Adjusts separation to account for sizeDecay so the stages in a burst stay adjacent.`;
    },
  },
  noSelfDamage: {
    get label() {
      return t`Can't damage its own unit`;
    },
  },
  numBounce: {
    get label() {
      return t`Bounce limit`;
    },
    get help() {
      return t`How many times the projectile can bounce before exploding on impact instead. -1 is unlimited.`;
    },
  },
  ownerExpAccWeight: {
    get label() {
      return t`Accuracy gain from XP`;
    },
    get help() {
      return t`How much accuracy, but not sprayAngle, improves with the firing unit's raw experience. At limXP 0.4 and a weight of 2, only 20% of the original inaccuracy remains.`;
    },
  },
  paralyzer: {
    get label() {
      return t`Stuns instead of damaging`;
    },
    get help() {
      return t`On, the weapon only stuns; it never removes hit points.`;
    },
  },
  paralyzeTime: {
    get label() {
      return t`Stun duration`;
    },
    unit: "s",
    get help() {
      return t`Restarts every time the target is hit again.`;
    },
  },
  predictBoost: {
    get label() {
      return t`Target-leading accuracy`;
    },
    get help() {
      return t`0 to 1. At 0, the unit misjudges target speed by up to double or half. At 1, it predicts speed perfectly. leadLimit can still cap how far it leads.`;
    },
  },
  proximityPriority: {
    get label() {
      return t`Closeness targeting weight`;
    },
    get help() {
      return t`Higher values prefer closer targets more strongly. Negative values make the weapon prefer distant targets instead.`;
    },
  },
  pulseSpeed: {
    get label() {
      return t`Beam pulse frequency`;
    },
    unit: "Hz",
    get help() {
      return t`'Large' BeamLaser only. How fast the beam fades to nothing and back.`;
    },
  },
  rechargeDelay: {
    get label() {
      return t`Shield recharge delay`;
    },
    unit: "s",
    get help() {
      return t`How long the shield waits after being hit before it starts regenerating again.`;
    },
  },
  reload: {
    get label() {
      return t`Stockpile round time (old name)`;
    },
    unit: "s",
  },
  rgbColor: {
    get label() {
      return t`Sprite colour`;
    },
    get help() {
      return t`Used when the weapon has no model. EmgCannon defaults to a different colour.`;
    },
  },
  rgbColor2: {
    get label() {
      return t`Beam core colour`;
    },
    get help() {
      return t`BeamLaser and LaserCannon only. Colour of the beam's inner core, sized by coreThickness.`;
    },
  },
  scarAlpha: {
    get label() {
      return t`Scar starting opacity`;
    },
    get help() {
      return t`0 to 1.`;
    },
  },
  scarColorTint: {
    get label() {
      return t`Scar colour tint`;
    },
    get help() {
      return t`0.5 in each channel means no change; 1.0 is twice as bright.`;
    },
  },
  scarDiameter: {
    get label() {
      return t`Scar decal size`;
    },
    unit: "elmo",
    get help() {
      return t`-1 uses the engine's own default sizing.`;
    },
  },
  scarDotElimination: {
    get label() {
      return t`Scar surface-angle cutoff`;
    },
    get help() {
      return t`Exponent on the dot product between the scar's projection direction and the terrain normal, used to stop the decal appearing on surfaces it shouldn't. 0 disables the cutoff entirely.`;
    },
  },
  scarGlow: {
    get label() {
      return t`Scar glow intensity`;
    },
    get help() {
      return t`0 to 1.`;
    },
  },
  scarGlowColorMap: {
    get label() {
      return t`Scar glow colour cycle`;
    },
    get help() {
      return t`A series of RGBA colours the scar's glow fades through over its lifetime.`;
    },
  },
  scarGlowTtl: {
    get label() {
      return t`Scar glow duration`;
    },
    unit: "s",
  },
  scarIndices: {
    get label() {
      return t`Scar shape indices`;
    },
    get help() {
      return t`Indices into the scar table in resources.lua.`;
    },
  },
  scarProjVector: {
    get label() {
      return t`Scar projection direction`;
    },
    get help() {
      return t`Forces the direction the scar decal is projected from, as if from a projector at that world-space vector. All zeroes uses the ground normal instead; '{'0, 1, 0'}' suits orbital-type weapons.`;
    },
  },
  scarTtl: {
    get label() {
      return t`Scar decal duration`;
    },
    unit: "s",
  },
  scrollSpeed: {
    get label() {
      return t`Beam texture scroll speed`;
    },
    unit: "elmo/s",
    get help() {
      return t`'Large' BeamLaser only.`;
    },
  },
  separation: {
    get label() {
      return t`Cannon stage spacing`;
    },
    get help() {
      return t`Cannon only. Multiplies the default distance between stages. See stages.`;
    },
  },
  shieldAlpha: {
    get label() {
      return t`Shield opacity (old name)`;
    },
  },
  shieldArmorType: {
    get label() {
      return t`Shield armour class (old name)`;
    },
  },
  shieldBadColor: {
    get label() {
      return t`Shield colour when weak (old name)`;
    },
  },
  shieldEnergyUse: {
    get label() {
      return t`Shield energy drain (old name)`;
    },
  },
  shieldForce: {
    get label() {
      return t`Shield repulsion force (old name)`;
    },
  },
  shieldGoodColor: {
    get label() {
      return t`Shield colour when strong (old name)`;
    },
  },
  shieldInterceptType: {
    get label() {
      return t`Shield interception bitmask (old name)`;
    },
  },
  shieldMaxSpeed: {
    get label() {
      return t`Shield repulsion speed cap (old name)`;
    },
    unit: "elmo/s",
  },
  shieldPower: {
    get label() {
      return t`Shield hit points (old name)`;
    },
  },
  shieldPowerRegen: {
    get label() {
      return t`Shield regen rate (old name)`;
    },
    unit: "HP/s",
  },
  shieldPowerRegenEnergy: {
    get label() {
      return t`Energy cost of shield regen (old name)`;
    },
    unit: "energy/HP",
  },
  shieldRadius: {
    get label() {
      return t`Shield radius (old name)`;
    },
    unit: "elmo",
  },
  shieldRechargeDelay: {
    get label() {
      return t`Shield recharge delay (old name)`;
    },
    unit: "s",
  },
  shieldRepulser: {
    get label() {
      return t`Shield repels rather than absorbs (old name)`;
    },
  },
  shieldStartingPower: {
    get label() {
      return t`Shield starting charge (old name)`;
    },
  },
  size: {
    get label() {
      return t`Sprite size`;
    },
    unit: "elmo",
    get help() {
      return t`Only used when the weapon has no model.`;
    },
  },
  sizeDecay: {
    get label() {
      return t`Cannon stage shrink`;
    },
    get help() {
      return t`Cannon only. Size reduction per stage, as a fraction of the first stage's size.`;
    },
  },
  sizeGrowth: {
    get label() {
      return t`Flame growth rate`;
    },
    unit: "elmo/frame",
    get help() {
      return t`Flamethrower only. Visual-only.`;
    },
  },
  smartShield: {
    get label() {
      return t`Shield lets allied fire through (old name)`;
    },
  },
  smokeColor: {
    get label() {
      return t`Smoke trail brightness`;
    },
  },
  smokePeriod: {
    get label() {
      return t`Smoke trail update rate`;
    },
    unit: "frames",
    get help() {
      return t`How often the trail adds a new vertex. Lower is smoother but costs more performance; useful for fast-turning homing missiles to avoid jagged trails.`;
    },
  },
  smokeSize: {
    get label() {
      return t`Smoke trail size`;
    },
  },
  smokeTime: {
    get label() {
      return t`Smoke trail lifetime`;
    },
    unit: "frames",
  },
  smokeTrail: {
    get label() {
      return t`Leaves a smoke trail`;
    },
    get help() {
      return t`MissileLauncher only.`;
    },
  },
  smokeTrailCastShadow: {
    get label() {
      return t`Smoke trail casts a shadow`;
    },
  },
  soundHit: {
    get label() {
      return t`Impact sound (old name)`;
    },
    get help() {
      return t`Played on hitting outside water. A BeamLaser plays it once per sim frame.`;
    },
  },
  soundHitDry: {
    get label() {
      return t`Impact sound (outside water)`;
    },
    get help() {
      return t`A BeamLaser plays it once per sim frame.`;
    },
  },
  soundHitDryVolume: {
    get label() {
      return t`Impact sound volume (outside water)`;
    },
    get help() {
      return t`-1 autogenerates the volume from damage dealt.`;
    },
  },
  soundHitVolume: {
    get label() {
      return t`Impact sound volume (old name)`;
    },
    get help() {
      return t`-1 autogenerates the volume from damage dealt.`;
    },
  },
  soundHitWet: {
    get label() {
      return t`Impact sound (underwater)`;
    },
    get help() {
      return t`A BeamLaser plays it once per sim frame.`;
    },
  },
  soundHitWetVolume: {
    get label() {
      return t`Impact sound volume (underwater)`;
    },
    get help() {
      return t`-1 autogenerates the volume from damage dealt.`;
    },
  },
  soundStart: {
    get label() {
      return t`Firing sound`;
    },
  },
  soundStartVolume: {
    get label() {
      return t`Firing sound volume`;
    },
    get help() {
      return t`-1 autogenerates the volume from damage dealt.`;
    },
  },
  soundTrigger: {
    get label() {
      return t`One firing sound per burst`;
    },
    get help() {
      return t`Off, the sound plays once per shot in a burst instead of once for the whole burst.`;
    },
  },
  sprayAngle: {
    get label() {
      return t`Burst spread`;
    },
    get help() {
      return t`Spread of individual projectiles within one burst, using the same angle transform as accuracy.`;
    },
  },
  stages: {
    get label() {
      return t`Cannon sprite stages`;
    },
    get help() {
      return t`Cannon only. Number of 2D sprites drawn to fake motion blur, when no model is set.`;
    },
  },
  stockpile: {
    get label() {
      return t`Requires stockpiling`;
    },
    get help() {
      return t`Each round must be built up by the player before it can fire. Only the first stockpiled weapon of this type on a unit works correctly.`;
    },
  },
  stockpileTime: {
    get label() {
      return t`Stockpile round time`;
    },
    unit: "s",
    get help() {
      return t`0 stops it progressing, useful for a Lua reimplementation.`;
    },
  },
  submissile: {
    get label() {
      return t`Torpedo can surface`;
    },
    get help() {
      return t`Torpedo only. Lets it leave the water and continue as a missile, and lets underwater launchers hit above-water targets. Launchers that start above water still can't; use Missile instead of Torpedo for that.`;
    },
  },
  sweepFire: {
    get label() {
      return t`Beam sweeps to new targets`;
    },
    get help() {
      return t`Makes a BeamLaser keep firing while retargeting, sweeping across the terrain instead of cutting off.`;
    },
  },
  targetable: {
    get label() {
      return t`Interceptable-by bitmask`;
    },
    get help() {
      return t`Each set bit lets a weapon whose interceptor has the matching bit intercept this one. Instant-hit weapons like BeamLaser, LightningCannon and Rifle can never be targeted this way.`;
    },
  },
  targetBorder: {
    get label() {
      return t`Targets the edge, not the centre`;
    },
    get help() {
      return t`1 targets the near edge of the collision volume, -1 the far edge, 0 the centre. Mainly matters for large collision volumes or short ranges.`;
    },
  },
  targetMoveError: {
    get label() {
      return t`Target-leading error`;
    },
    get help() {
      return t`Adds a random vector, up to this fraction of the target's speed, to the predicted position each second. At 0.5 and a target moving 50 elmo/s, the error can be up to 25 elmos.`;
    },
  },
  texture1: {
    get label() {
      return t`Primary texture (old name)`;
    },
  },
  texture2: {
    get label() {
      return t`Secondary texture (old name)`;
    },
  },
  texture3: {
    get label() {
      return t`Tertiary texture (old name)`;
    },
  },
  texture4: {
    get label() {
      return t`Quaternary texture (old name)`;
    },
  },
  thickness: {
    get label() {
      return t`Beam thickness`;
    },
    unit: "elmo",
    get help() {
      return t`LaserCannon, BeamLaser and Lightning only.`;
    },
  },
  tileLength: {
    get label() {
      return t`Beam texture tile length`;
    },
    unit: "elmo",
    get help() {
      return t`'Large' BeamLaser only. Regular BeamLaser stretches a single tile instead of repeating it.`;
    },
  },
  tracks: {
    get label() {
      return t`Homes in on its target`;
    },
    get help() {
      return t`Missile, Torpedo and Starburst only. Requires a positive turnRate to actually turn towards the target.`;
    },
  },
  trajectoryHeight: {
    get label() {
      return t`Missile arc height`;
    },
    get help() {
      return t`Missile and Torpedo only. Fraction of the distance to the target added as extra arc height; at 1.0 the arc is as tall as it is long.`;
    },
  },
  turret: {
    get label() {
      return t`Aims within a turret arc`;
    },
    get help() {
      return t`Off, the weapon always points along the owner's own heading instead of tracking within an arc.`;
    },
  },
  visibleShield: {
    get label() {
      return t`Shield is visible (old name)`;
    },
  },
  visibleShieldHitFrames: {
    get label() {
      return t`Shield visible-on-hit duration (old name)`;
    },
    unit: "frames",
  },
  visibleShieldRepulse: {
    get label() {
      return t`Shows the repulse effect (old name)`;
    },
  },
  waterBounce: {
    get label() {
      return t`Bounces off water`;
    },
  },
  waterweapon: {
    get label() {
      return t`Can travel underwater`;
    },
    get help() {
      return t`Firing underwater at all is controlled separately by fireSubmersed.`;
    },
  },
  wobble: {
    get label() {
      return t`Missile wobble turn rate`;
    },
    unit: "COB angle/s",
    get help() {
      return t`Missile only. New random direction rolled every 16 sim frames.`;
    },
  },
  "damage.default": {
    get label() {
      return t`Default damage`;
    },
    get help() {
      return t`Used for any armour class that doesn't have its own entry in damage.`;
    },
  },
  "shield.alpha": {
    get label() {
      return t`Shield opacity`;
    },
    get help() {
      return t`How transparent the shield is while visible.`;
    },
  },
  "shield.armorType": {
    get label() {
      return t`Shield armour class`;
    },
    get help() {
      return t`An armour class name, or a unit's name to share its armour class.`;
    },
  },
  "shield.badColor": {
    get label() {
      return t`Shield colour when weak`;
    },
    get help() {
      return t`The colour the shield fades to as its charge drops to 0.`;
    },
  },
  "shield.energyUse": {
    get label() {
      return t`Shield energy drain`;
    },
    get help() {
      return t`Energy drained continuously by a repulsor while a projectile is nearby, or spent absorbing a hit.`;
    },
  },
  "shield.exterior": {
    get label() {
      return t`Shield lets outgoing fire through`;
    },
    get help() {
      return t`On, projectiles fired from inside the shield's radius pass through it. Off, they're intercepted too.`;
    },
  },
  "shield.force": {
    get label() {
      return t`Shield repulsion force`;
    },
    get help() {
      return t`Higher values deflect incoming weapons away at higher speed.`;
    },
  },
  "shield.goodColor": {
    get label() {
      return t`Shield colour when strong`;
    },
    get help() {
      return t`The colour the shield fades to as its charge regenerates to full.`;
    },
  },
  "shield.interceptType": {
    get label() {
      return t`Shield interception bitmask`;
    },
    get help() {
      return t`Each set bit lets the shield intercept a weapon whose interceptedByShieldType has the matching bit set.`;
    },
  },
  "shield.maxSpeed": {
    get label() {
      return t`Shield repulsion speed cap`;
    },
    unit: "elmo/s",
    get help() {
      return t`The fastest speed the repulsor can impart to a deflected projectile.`;
    },
  },
  "shield.power": {
    get label() {
      return t`Shield hit points`;
    },
    get help() {
      return t`The maximum charge the shield can hold, reduced by incoming weapon damage.`;
    },
  },
  "shield.powerRegen": {
    get label() {
      return t`Shield regen rate`;
    },
    unit: "HP/s",
  },
  "shield.powerRegenEnergy": {
    get label() {
      return t`Energy cost of shield regen`;
    },
    unit: "energy/HP",
  },
  "shield.radius": {
    get label() {
      return t`Shield radius`;
    },
    unit: "elmo",
  },
  "shield.repulser": {
    get label() {
      return t`Shield repels rather than absorbs`;
    },
    get help() {
      return t`On, the shield deflects incoming projectiles. Off, it absorbs them.`;
    },
  },
  "shield.smart": {
    get label() {
      return t`Shield lets allied fire through`;
    },
    get help() {
      return t`On, projectiles fired by allies pass through. Off, they're intercepted the same as enemy fire.`;
    },
  },
  "shield.startingPower": {
    get label() {
      return t`Shield starting charge`;
    },
    get help() {
      return t`How much charge the shield has when it first appears, rather than starting empty and regenerating up to full power.`;
    },
  },
  "shield.visible": {
    get label() {
      return t`Shield is visible`;
    },
  },
  "shield.visibleHitFrames": {
    get label() {
      return t`Shield visible-on-hit duration`;
    },
    unit: "frames",
    get help() {
      return t`How many frames the shield is shown for after being hit.`;
    },
  },
  "shield.visibleRepulse": {
    get label() {
      return t`Shows the repulse effect`;
    },
    get help() {
      return t`Whether the shield's hard-coded projectile-deflection effect is drawn.`;
    },
  },
  "textures.1": {
    get label() {
      return t`Primary texture`;
    },
    get help() {
      return t`Sprite texture for AircraftBomb, Cannon, EMG and Flame weapons; the main beam texture for LaserCannon, BeamLaser and Lightning; the flare texture for Missile and Starburst; the shield dome texture. DGun ignores this and uses a hardcoded texture.`;
    },
  },
  "textures.2": {
    get label() {
      return t`Secondary texture`;
    },
    get help() {
      return t`The end-of-beam texture for LaserCannon and BeamLaser, split between both ends; the smoke trail texture for Missile and Starburst. Torpedo ignores this and uses a hardcoded trail.`;
    },
  },
  "textures.3": {
    get label() {
      return t`Tertiary texture`;
    },
    get help() {
      return t`The flare texture for a regular BeamLaser, or the directional muzzle exhaust for a 'large' one; the flame exhaust texture for Starburst.`;
    },
  },
  "textures.4": {
    get label() {
      return t`Quaternary texture`;
    },
    get help() {
      return t`The flare texture for a 'large' BeamLaser.`;
    },
  },
};
