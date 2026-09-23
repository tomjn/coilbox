/**
 * Playing a unit's own script in the viewport.
 *
 * A script animates in response to events, so a preview has to decide what
 * happens to the unit before it can show anything. That is what a scenario is:
 * a short list of call-ins and the frames to fire them on. The runtime in Rust
 * runs them and hands back a pose per frame, which the viewport plays the same
 * way it plays a preset's `track`.
 *
 * The scenarios live here rather than in Rust because they are wording as much
 * as timing: what the user picked from is the thing that has to make sense.
 */

/** A call-in to fire, and when. Frames are counted from the start of the run. */
export interface ScriptEvent {
  frame: number;
  /** The call-in to fire. Absent on an event the engine acts on. */
  callin?: string;
  args?: number[];
  /** Whether this is the preview describing the world rather than putting the
   *  unit through something. Almost no unit defines those call-ins, so a
   *  runtime saying it does not have one would say it about nearly every
   *  unit. */
  ambient?: boolean;
  /**
   * Work this event's arguments out from where the stand-in is on its frame,
   * rather than taking them as literals.
   *
   * A literal aim is a number somebody picked, and a script that aims at it
   * correctly looks exactly like one that does not. `aimResolver.ts` replaces
   * the marker with `args` before the run, using the engine's own formula:
   * `AimFromWeapon` measures from the piece that call-in names
   * (`rts/Sim/Weapons/Weapon.cpp:410-424`), `midPos` from the unit's mid
   * (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`).
   */
  aimAtStandIn?: { from: "AimFromWeapon" | "midPos" };
  /**
   * Put the stand-in down where the track had it on `frame`, rather than at
   * literal coordinates. `resolveScenario` replaces the marker with
   * `TransportDrop`'s Lua arguments, the unit id then x, y and z in elmos,
   * because a track is measured in the stand-in's radius and that depends on
   * the unit.
   */
  dropAtStandIn?: { frame: number };
  /**
   * The scene on this event's frame, for a script that asks where something is.
   * Filled in by `withWorld` before the run, never written by hand, for the
   * same reason `aimAtStandIn` is resolved rather than literal.
   */
  world?: ScriptWorld;
  /**
   * Something the engine does to the stand-in itself, rather than a call-in it
   * fires. The air transport arm attaches a passenger to the piece
   * `QueryTransport` names, and detaches it, without the script asking
   * (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2041-2042,2090-2091`).
   * The runtime asks `QueryTransport` at the moment it attaches.
   *
   * `nano-start` and `nano-stop` bracket the frames a builder sprays nano on.
   * The runtime asks `QueryNanoPiece` on each of them, through the engine's
   * cache (`rts/Sim/Misc/NanoPieceCache.cpp:17-50`).
   *
   * `factory-build` queues a build. The runtime starts it, and starts spraying
   * nano, on the first frame the script puts the unit in build stance
   * (`Factory.cpp:138-151`).
   *
   * `factory-finish` stops the spray and fires `StopBuilding`, or notes that
   * the script never set stance.
   */
  engine?:
    | "attach"
    | "detach"
    | "nano-start"
    | "nano-stop"
    | "factory-build"
    | "factory-finish";
}

/** The scene one frame of a script run is told about. */
export interface ScriptWorld {
  standIn: {
    id: number;
    pos: [number, number, number] | null;
    radius: number;
    height: number;
  } | null;
  self: { radius: number; height: number };
}

/**
 * Something a script announced, on the frame it did. Mirrors `ScriptOutput` in
 * `crates/coilbox-unitpose/src/lib.rs`. Pieces are named, because a name means
 * the same in both runtimes.
 */
export type ScriptOutput =
  | { frame: number; kind: "attach"; unit: number; piece: string | null } // null is the void
  | { frame: number; kind: "drop"; unit: number }
  | { frame: number; kind: "sfx"; piece: string; sfx: number }
  | { frame: number; kind: "explode"; piece: string; flags: number }
  | { frame: number; kind: "sound"; name: string | null }
  | { frame: number; kind: "nano"; piece: string | null } // null when no piece is named yet
  | { frame: number; kind: "build-start" }; // the frame a factory started building

/** What one run of a script produced. Mirrors the runtime's own report. */
export interface ScriptTimeline {
  fps: number;
  /** Piece names, in the order every frame's numbers are laid out. */
  pieces: string[];
  /** Per frame, six numbers per piece: x, y, z offset then x, y, z rotation. */
  frames: number[][];
  /** Per frame, one flag per piece, or empty when nothing was ever hidden. */
  hidden: boolean[][];
  /** What stopped the run early, if anything did. */
  error: string | null;
  /** What the run wants to say that did not stop it. */
  warnings: string[];
  /** Every unit value id the script read, in the order it first read each one.
   *  A caller offering controls for a script's unit values has to run it once
   *  before it knows which to offer. */
  asked: { id: number; name: string | null; default: number | null }[];
  /** The functions the script defines: a `.cob`'s script name table, or a Lua
   *  unit script's `script` table keys. What a caller offering "call any
   *  function" has to run the script once to learn. */
  functions: string[];
  /** Main-script source lines the run executed at least once, 1-indexed.
   *  Empty for a compiled run, which reports `offsetsRun` instead. */
  linesRun: number[];
  /** COB instruction word offsets the run executed at least once. Empty for a
   *  Lua run, which reports `linesRun` instead. */
  offsetsRun: number[];
  /** What the script announced, in frame order: effects, sound, and carrying
   *  the stand-in. */
  events: ScriptOutput[];
}

/** What one call-in that answers with a piece said. */
export interface ScriptProbe {
  /** Key in the script's `script` table, such as `QueryNanoPiece`. */
  callin: string;
  /** The pieces it named, in call order and with repeats kept, because the
   *  order is the cycle a multi-nozzle builder walks. */
  pieces: string[];
  /** Why it named nothing: no such call-in, a throw, or an answer that is not
   *  a piece of this unit. */
  note: string | null;
}

/** Every probe of one script, plus whatever stopped it loading at all. */
export interface ScriptProbes {
  pieces: string[];
  probes: ScriptProbe[];
  /** Set when nothing could be asked, in which case `probes` is empty. */
  error: string | null;
}

/**
 * How long a preview runs before it loops.
 *
 * Six seconds was enough to see a walk cycle as a cycle, and it is not enough
 * once there is a second object in the scene: a builder reaching one way and
 * then the other, with something to reach at, is a sequence rather than a
 * cycle, and it needs room to play out before it starts again.
 */
export const PREVIEW_SECONDS = 15;

/** Frames in a preview, at the sim rate the runtime works in. */
export const PREVIEW_FRAMES = PREVIEW_SECONDS * 30;

/** Where the stand-in is on one frame, and which way it faces. */
export interface StandInKey {
  frame: number;
  /** Unit-local, in multiples of the stand-in's radius. A track written this
   *  way serves a scout and a factory alike, since the radius comes from the
   *  edited unit's own size rather than from the track. */
  pos: [number, number, number];
  /**
   * Measure `pos` from where the stand-in was last let go, rather than from the
   * unit's origin.
   *
   * What a dropped passenger needs: it moves off from where the transport put
   * it down. Before anything has let it go it is measured from the unit's
   * origin, as any other key is.
   */
  fromRelease?: boolean;
  /**
   * Measure `pos` from a spot a fixed number of elmos clear of the unit's
   * edge, rather than from the unit's origin.
   *
   * `trackBesideUnit` in `standIn.ts` resolves this into an ordinary `pos`
   * once the unit's and stand-in's radii are both known, so nothing
   * downstream reads `fromEdge` itself. Never set together with
   * `fromRelease`.
   */
  fromEdge?: number;
  /** Radians about the vertical axis, relative to the unit's facing. Zero
   *  where no key sets one. */
  heading?: number;
}

/**
 * The piece a factory builds on, and for how long.
 *
 * `UpdateBuild` moves the buildee to the world position of the piece
 * `QueryBuildInfo` names, and turns it with the piece, on every frame of the
 * build (`rts/Sim/Units/UnitTypes/Factory.cpp:209-244`), so the stand-in rides
 * it rather than sitting at its rest position. A transport's passenger is
 * carried by the runtime instead, from the attach events it reports.
 */
export interface StandInAttach {
  /** The call-in the probe asks for that piece. */
  from: "QueryBuildInfo";
  /**
   * The first frame the stand-in could be riding it, for `aimResolver.ts`'s
   * own pre-run use. The preview's own placement ignores this and waits for
   * the run's `build-start` output instead, because a script can take longer
   * than this to set build stance.
   */
  frame?: number;
  /** The frame it comes off again, or null to stay on to the end. */
  until: number | null;
}

/** Where the stand-in goes over a scenario, as a preview aid layered over the
 *  timeline. The runtimes know nothing about it. */
export interface StandInTrack {
  keys: StandInKey[];
  attach?: StandInAttach | null;
  /** The stand-in's radius as a fraction of the unit's wider footprint, in
   *  place of the usual 7/30. Absent means the usual size.
   *
   *  A transport's passenger is set smaller: at the usual size it reads as
   *  half the transport's own length rather than as cargo. A track's keys
   *  are counted in radii too, so a smaller stand-in also stands closer,
   *  the same way a smaller `RADIUS_FRACTION` would. */
  size?: number;
}

/** How a unit sprays nano, which sets the particle's speed and spread: a
 *  construction unit's at 3 elmos a frame, a factory's at 1
 *  (`rts/Sim/Projectiles/ProjectileHandler.cpp:670-746`). */
export type NanoStyle = "builder" | "factory";

export interface Scenario {
  id: string;
  label: string;
  /** Why you would pick it, in the panel under the picker. */
  description: string;
  events: ScriptEvent[];
  /** The stand-in this scenario puts in the scene, if it puts one there at
   *  all. A scenario with no track shows no stand-in. */
  standIn?: StandInTrack;
  /** How this scenario's unit sprays nano, when it does. */
  nano?: NanoStyle;
}

/** Seconds to frames, for writing a scenario in the units it reads in.
 *  Exported so anything that builds its own events, such as a call to a
 *  function the panel does not have a scenario for, starts them the same
 *  half second in as every scenario above does. */
export function at(seconds: number): number {
  return Math.round(seconds * 30);
}

/**
 * What the engine tells a unit standing on solid ground.
 *
 * `SFX_TERRAINTYPE_LAND` in `rts/Sim/Units/Unit.cpp`, where the others are
 * nothing (0) and two kinds of water (1 and 2).
 */
export const ON_LAND = 4;

/**
 * How every scenario starts: the unit exists, and it is standing on land.
 *
 * `Create` because the engine does it and because a script's rest pose is often
 * set there. `setSFXoccupy` because a unit does not work out what it is
 * standing on, the engine tells it, and a script that branches on the answer
 * gets nothing until something does. Expand and Exterminate's construction mech
 * only walks on land or shallow water and stands still on anything else, so
 * without this it never walks at all (#1940).
 *
 * Land rather than water because the viewport draws a unit on a ground plane,
 * and a preview should agree with what it is showing.
 *
 * Exported because anything that drives a script itself needs the same two
 * events for the same reason, not only the scenarios below.
 *
 * A frame after `Create` rather than alongside it, which is not a detail. A
 * script routinely starts its own `setSFXoccupy` from `Create` with no argument
 * at all, which sets the surface to nothing, and a started thread runs after
 * the call that started it. Told on the same frame, the unit is told and then
 * immediately un-told. The engine has the same order for the same reason: it
 * works the terrain out in the unit's update, which is a later frame than the
 * one the unit was made on.
 */
export const CREATED: ScriptEvent[] = [
  { frame: 0, callin: "Create" },
  { frame: 1, callin: "setSFXoccupy", args: [ON_LAND], ambient: true },
];

/**
 * The stand-in that stands in for a passenger, in the Lua argument form.
 *
 * `BeginTransport`, `QueryTransport` and `TransportDrop` all take a unit id in
 * Lua where COB takes the passenger's model height or a packed position
 * (`rts/Sim/Units/Scripts/LuaUnitScript.cpp:139-141,787-826` against
 * `CobInstance.cpp:355-395`). The scenario writes the Lua form and the COB
 * runtime converts, which is how radians are already handled.
 *
 * The preview has no unit table for a script to look this up in, so the number
 * only has to be a plausible id: what a script does with it is open a door.
 *
 * Two, not one: one is the unit itself (`UNIT_ID` in
 * `crates/coilbox-unitpose/src/unitvalue.rs`), and a script asking where its
 * passenger is would otherwise be told where it is itself.
 */
export const STAND_IN_UNIT_ID = 2;

/** Elmos between the transport's edge and a stand-in waiting beside it,
 *  chosen by the user as a fixed gap rather than one that scales with the
 *  unit. */
const STAND_OFF = 5;

/**
 * What a preview can put a unit through.
 *
 * Every one of them starts with `Create`, because the engine does and because a
 * script's rest pose is often set there. The rest are the call-ins coilbox's own
 * generator writes, so a unit that took ownership of a generated script has a
 * scenario for everything in it.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "moving",
    label: "Moving",
    description: "Created, then told to move and left moving.",
    // Half a second in, not on the frame the unit was made. A `Create` that
    // sleeps is suspended mid-way through setting the unit up, and what it
    // writes after the sleep is often what the move animation reads: flove's
    // mushrooms set their rest pose in a sleeping call and then work out how
    // fast to walk. Told to move first, the unit reads what is not written yet.
    // The engine never has the two together either, since a move order comes
    // from a player long after the unit exists.
    events: [...CREATED, { frame: at(0.5), callin: "StartMoving" }],
  },
  {
    id: "starting-stopping",
    label: "Starting and stopping",
    description: "Moves for half the preview, then stops, so both are visible.",
    events: [
      ...CREATED,
      // After `Create` has finished, for the reason the scenario above gives.
      { frame: at(0.5), callin: "StartMoving" },
      { frame: at(PREVIEW_SECONDS / 2), callin: "StopMoving" },
    ],
  },
  {
    id: "idle",
    label: "Standing still",
    description: "Created and nothing else. Shows what a script does unasked.",
    events: CREATED,
  },
  {
    id: "active",
    label: "Switched on",
    description: "Activated, for a unit that opens or spins up when it is on.",
    events: [...CREATED, { frame: 0, callin: "Activate" }],
  },
  {
    id: "building",
    label: "Building (mobile)",
    description:
      "A construction unit reaching one way, stopping, then reaching the other, with something there to build. Its nanolathe is aimed, so this is the one with angles in it.",
    nano: "builder",
    events: [
      ...CREATED,
      // No literal angles. `aimResolver.ts` works them out from where the
      // stand-in is on each of these frames, using the builder's own formula
      // (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`), so an arm that aims
      // at the wrong place is visibly aiming at the wrong place.
      {
        frame: at(0.5),
        callin: "StartBuilding",
        aimAtStandIn: { from: "midPos" },
      },
      { frame: at(0.5), engine: "nano-start" },
      { frame: at(5), callin: "StopBuilding" },
      { frame: at(5), engine: "nano-stop" },
      {
        frame: at(6.5),
        callin: "StartBuilding",
        aimAtStandIn: { from: "midPos" },
      },
      { frame: at(6.5), engine: "nano-start" },
      { frame: at(11), callin: "StopBuilding" },
      { frame: at(11), engine: "nano-stop" },
    ],
    // On the ground ahead and to one side, then across to the other during the
    // gap between the two builds, so the arm is seen to follow it.
    //
    // Well out in front. These are multiples of the stand-in's own radius,
    // which is itself a fraction of the unit, so the distance works out at
    // about 1.8 times the unit's wider horizontal extent: a unit filling the
    // 5x5 plate gets a build target a little over 120 elmos away. Anything
    // nearer and it sits inside the unit's own silhouette and reads as a part
    // of it rather than as a thing being built, which is what it did at half
    // this distance on a walker.
    //
    // It comes back to where it started, so the preview loops without the
    // stand-in jumping across the scene on the frame it restarts.
    standIn: {
      keys: [
        { frame: 0, pos: [3.5, 0, 7] },
        { frame: at(5), pos: [3.5, 0, 7] },
        { frame: at(6.5), pos: [-3.5, 0, 7] },
        { frame: at(11), pos: [-3.5, 0, 7] },
        { frame: at(PREVIEW_SECONDS), pos: [3.5, 0, 7] },
      ],
    },
  },
  {
    id: "building-factory",
    label: "Building (factory)",
    description:
      "A factory opening its yard and waiting for its own script to be ready before it builds, which is a different pair of call-ins from a construction unit's.",
    nano: "factory",
    events: [
      ...CREATED,
      // A factory is opened first. `CFactory::Update` calls `Activate` when the
      // yard opens and that is what sets the build stance, so a factory script
      // that animates its doors does it from here and most of them will not
      // animate a build at all until it has happened.
      { frame: at(0.5), callin: "Activate" },
      // The runtime queues the build behind this and starts it, and starts
      // spraying nano, once the script puts the unit in build stance, which
      // may be several frames after this event (`Factory.cpp:138-151`).
      { frame: at(0.5), engine: "factory-build" },
      // Stops the spray and fires `StopBuilding`.
      { frame: at(11), engine: "factory-finish" },
      { frame: at(13), callin: "Deactivate" },
    ],
    standIn: {
      // Nowhere until the run reports `build-start`, which is the frame the
      // script actually set build stance on rather than a frame picked here.
      keys: [{ frame: 0, pos: [0, 0, 0] }],
      // `UpdateBuild` moves the buildee to the build piece's world position
      // and turns it with the piece, every frame of the build
      // (`rts/Sim/Units/UnitTypes/Factory.cpp:209-244`), so the stand-in rides
      // it rather than sitting at its rest position.
      attach: {
        from: "QueryBuildInfo",
        until: null,
      },
      // Two thirds of the usual 7/30, set by eye with the user so the
      // stand-in fits a factory's build pad.
      size: (7 / 30) * (2 / 3),
    },
  },
  {
    id: "destroyed",
    label: "Hit and destroyed",
    description:
      "Takes a hit, then dies. A unit's death is usually its biggest animation: pieces are thrown off and the rest is hidden.",
    events: [
      ...CREATED,
      // `HitByWeapon(dirX, dirZ, weaponDefID, damage)`, the direction the hit
      // came from and what it did. Straight on from the front, because a
      // flinch is easier to read when it is not also turning away.
      { frame: at(1), callin: "HitByWeapon", args: [0, 1, 0, 100] },
      // `Killed(recentDamage, maxHealth)`. A script works the severity out as
      // the ratio of the two and picks how thoroughly to come apart, so the
      // numbers matter only against each other. Half, which is the middle of
      // the three or four bands every script written from the same template
      // has, and the one that neither leaves the unit whole nor removes it.
      { frame: at(2), callin: "Killed", args: [50, 100] },
    ],
  },
  {
    id: "firing",
    label: "Aiming and firing",
    description: "Aims one way, fires, aims the other, fires again.",
    events: [
      ...CREATED,
      // Aimed at the stand-in rather than at two numbers, and measured from
      // the piece `AimFromWeapon1` names, as the engine measures it
      // (`rts/Sim/Weapons/Weapon.cpp:241-244,286-304,410-424`).
      {
        frame: at(0.5),
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
      { frame: at(4), callin: "Shot1" },
      {
        frame: at(6),
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
      { frame: at(9.5), callin: "Shot1" },
    ],
    // Off the ground and well out, so the second aim differs from the first in
    // pitch as well as heading and a barrel that only turns is obvious.
    //
    // Back where it started by the end, so the turret tracks it round rather
    // than the stand-in jumping across the scene when the preview loops.
    standIn: {
      keys: [
        { frame: 0, pos: [2.6, 2.2, 4] },
        { frame: at(4), pos: [2.6, 2.2, 4] },
        { frame: at(6), pos: [-2.6, 0.6, 4] },
        { frame: at(10), pos: [-2.6, 0.6, 4] },
        { frame: at(PREVIEW_SECONDS), pos: [2.6, 2.2, 4] },
      ],
    },
  },
  {
    id: "transport-pickup",
    label: "Loading and unloading a ship or hover transport",
    description:
      "A ship, hovercraft or ground transport picking something up, then putting it back down where it found it. It is told what to load and reaches for it, and the script decides where it goes in between.",
    events: [
      ...CREATED,
      // The engine's other arm: anything that is not an air transport stops,
      // then calls `TransportPickup` with the passenger and leaves the script
      // to attach it (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1459-1463`).
      { frame: at(4), callin: "TransportPickup", args: [STAND_IN_UNIT_ID] },
      // Then puts it down where it found it. The Hulk's pickup ends on frame
      // 156, measured by running armtship from balanced_annihilation-v15.9.8,
      // and this is a second later so the stand-in is seen to go.
      {
        frame: 156 + at(1),
        callin: "TransportDrop",
        dropAtStandIn: { frame: at(4) },
      },
    ],
    // Chosen by eye, as RADIUS_FRACTION was: a passenger, not a second
    // transport.
    standIn: {
      size: 0.1,
      keys: [
        // Approaching on the ground, from in front, and still by the time the
        // transport is told to pick it up. The engine only calls
        // `TransportPickup` once the passenger is in range, and a passenger
        // that asked to be loaded stops there (`MobileCAI.cpp:430-465`).
        { frame: 0, pos: [0, 0, 2], fromEdge: STAND_OFF },
        { frame: at(3), pos: [0, 0, 0], fromEdge: STAND_OFF },
        // Still there when it is picked up, which is where it is put down.
        { frame: at(4), pos: [0, 0, 0], fromEdge: STAND_OFF },
        // Held where the Hulk put it down, then the preview's own return leg.
        // No call-in fires during it.
        { frame: at(13), pos: [0, 0, 0], fromRelease: true },
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 2], fromEdge: STAND_OFF },
      ],
    },
  },
  {
    id: "transport-load",
    label: "Loading and unloading a transport",
    description:
      "An air transport picking something up on the piece the script names, carrying it, then landing and letting it go.",
    events: [
      ...CREATED,
      // The engine's air arm calls `BeginTransport`, then attaches the
      // passenger to the piece `QueryTransport` names, itself
      // (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453`).
      { frame: at(4), callin: "BeginTransport", args: [STAND_IN_UNIT_ID] },
      { frame: at(4), engine: "attach" },
      // Landing: `TransportDrop` with where the passenger is going, then the
      // arm detaches it itself (`MobileCAI.cpp:2090-2091`). At the frame this
      // scenario's attachment has always ended. Put down where it was picked
      // up.
      {
        frame: at(11),
        callin: "TransportDrop",
        dropAtStandIn: { frame: at(4) },
      },
      { frame: at(11), engine: "detach" },
      // Once the last passenger is off (`MobileCAI.cpp:2094-2098`), a second
      // later, as the unload scenario this replaces had it.
      { frame: at(12), callin: "EndTransport" },
    ],
    // Chosen by eye, as RADIUS_FRACTION was: a passenger, not a second
    // transport.
    standIn: {
      size: 0.1,
      keys: [
        // Approaching on the ground, from in front.
        { frame: 0, pos: [0, 0, 2], fromEdge: STAND_OFF },
        { frame: at(4), pos: [0, 0, 1] },
        // Let go wherever the piece had it, then settles onto the spot it was
        // picked up from, over the two and a half seconds the unload scenario
        // this replaces took. The preview has no falling, so this stands in
        // for it.
        { frame: at(13.5), pos: [0, 0, 1] },
        // The preview's own return leg. No call-in fires during it.
        { frame: at(PREVIEW_SECONDS), pos: [0, 0, 2], fromEdge: STAND_OFF },
      ],
    },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Which frame of the timeline a moment belongs to, looping.
 *
 * A run that stopped early is looped at the length it reached, so a script that
 * threw two seconds in plays those two seconds over rather than freezing.
 */
export function frameAt(timeline: ScriptTimeline, seconds: number): number {
  const count = timeline.frames.length;
  if (count === 0) return -1;
  const frame = Math.floor(seconds * timeline.fps);
  return ((frame % count) + count) % count;
}

/** A piece's pose on one frame: x, y, z offset then x, y, z rotation. */
export function poseAt(
  timeline: ScriptTimeline,
  frame: number,
  piece: number,
): [number, number, number, number, number, number] | null {
  const row = timeline.frames[frame];
  if (!row) return null;
  const start = piece * 6;
  if (start + 6 > row.length) return null;
  return [
    row[start],
    row[start + 1],
    row[start + 2],
    row[start + 3],
    row[start + 4],
    row[start + 5],
  ];
}

/**
 * Keep a frame index inside the bounds of a timeline, for scrubbing and
 * stepping: a slider dragged past either end, or a step off the last frame,
 * lands on the frame nearest to it rather than wrapping or going nowhere.
 */
export function clampFrame(timeline: ScriptTimeline, frame: number): number {
  const count = timeline.frames.length;
  if (count === 0) return 0;
  return Math.min(Math.max(frame, 0), count - 1);
}

/** Whether a piece is hidden on a frame. Nothing is hidden when nothing was. */
export function hiddenAt(
  timeline: ScriptTimeline,
  frame: number,
  piece: number,
): boolean {
  return timeline.hidden[frame]?.[piece] ?? false;
}

/**
 * What to say about a run that produced no frames at all.
 *
 * A timeline with an error and frames is worth playing, and the error goes
 * beside it. A timeline with an error and nothing to play is only the error.
 */
export function playable(timeline: ScriptTimeline | null): boolean {
  return timeline !== null && timeline.frames.length > 0;
}
