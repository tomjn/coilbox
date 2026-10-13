import type { ReplayTrackHeader } from "../bindings";
import {
  aliveUnitCount,
  forEachAliveProjectile,
  forEachAliveUnit,
  type ProjectileValue,
  projectileAt,
  type StatusValue,
  statusAt,
  type TransformValue,
  transformAt,
} from "./curves";
import type { ReplayTrackError } from "./fault";
import type { TrackWindow } from "./trackWindow";
import {
  createWindowStore,
  type Direction,
  type WindowStore,
  windowOfFrame,
} from "./windowStore";

/**
 * A unit at a frame, for the map view (#3806). The same object is passed to
 * every visit of one call and of every call after it, so read what you need
 * inside the callback and do not keep it.
 */
export interface UnitMark {
  /** Identifies a unit across windows. The engine reuses its unit ids. */
  serial: number;
  /** An index in `header.unitDefs`. */
  def: number;
  /** A team id, as in `header.teams`. */
  team: number;
  /** Elmos along x and z. */
  x: number;
  z: number;
  /** Where the unit's front points on the map. A unit vector's x and z parts
   *  when the unit is level, and shorter when it is tilted. */
  fx: number;
  fz: number;
  /** 0 to 1. */
  health: number;
  /** 0 to 1, with 1 for complete. A unit under construction is below 1. */
  build: number;
}

/** A projectile at a frame. Reused for every visit as {@link UnitMark} is. */
export interface ProjectileMark {
  serial: number;
  /** An index in `header.weaponDefs`, or 65,535 for a piece of debris. */
  weapon: number;
  /** 255 for none. */
  team: number;
  x: number;
  z: number;
  /** Elmos per frame. */
  vx: number;
  vz: number;
}

/**
 * What a component holds of an open track (#3806). It is a plain object of
 * functions and the header, and it stays the same object for as long as the
 * track is open, however many windows load and drop.
 *
 * No typed array is reachable from it. A window's arrays stay inside the
 * handle, and a frame's values come out through the callbacks below, so there
 * is nothing to pass as a prop. React's development build diffs a typed array
 * prop element by element, and that cost 2 seconds on the scenario map preview.
 *
 * The usual loop: call {@link follow} from the animation frame with the time
 * and the direction, then draw with {@link forEachUnit} and
 * {@link forEachProjectile}. Both return false while the frame's window is
 * still loading, and the view keeps the last picture it drew.
 */
export interface ReplayTrackHandle {
  readonly header: ReplayTrackHeader;
  /**
   * Say where time is and which way it is going. Holds the window the frame is
   * in and the next one in that direction, and drops every other. Cheap to call
   * on every animation frame.
   */
  follow(frame: number, direction: Direction): void;
  /** Whether the window that has `frame` is held. */
  isReady(frame: number): boolean;
  /** How many units are alive at `frame`, or 0 if its window is not held. */
  unitCountAt(frame: number): number;
  /** Calls `visit` for every unit alive at `frame`. False if not ready. */
  forEachUnit(frame: number, visit: (unit: UnitMark) => void): boolean;
  /** Calls `visit` for every projectile alive at `frame`. False if not ready. */
  forEachProjectile(
    frame: number,
    visit: (projectile: ProjectileMark) => void,
  ): boolean;
  /** Why the window that has `frame` could not be read, if it could not. */
  windowFault(frame: number): ReplayTrackError | undefined;
  /** The indexes of the windows held now, rising. */
  heldWindows(): readonly number[];
  /** Called when a window arrives, is dropped or fails. Returns the stop. */
  subscribe(listener: () => void): () => void;
}

/** @internal Closes the handle. The hook does this when the track closes. */
export interface OwnedHandle {
  handle: ReplayTrackHandle;
  close(): void;
}

export function createReplayTrackHandle(
  header: ReplayTrackHeader,
  load: (window: number) => Promise<TrackWindow>,
): OwnedHandle {
  const store: WindowStore = createWindowStore(header, load);
  const transform: TransformValue = {
    x: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 0,
    fx: 0,
    fz: 0,
  };
  const status: StatusValue = { health: 1, build: 1 };
  const shot: ProjectileValue = { x: 0, z: 0, vx: 0, vz: 0 };
  const unit: UnitMark = {
    serial: 0,
    def: 0,
    team: 0,
    x: 0,
    z: 0,
    fx: 0,
    fz: 1,
    health: 1,
    build: 1,
  };
  const projectile: ProjectileMark = {
    serial: 0,
    weapon: 0,
    team: 0,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
  };

  const handle: ReplayTrackHandle = {
    header,
    follow: (frame, direction) => store.follow(frame, direction),
    isReady: (frame) => store.windowFor(frame) !== undefined,
    unitCountAt(frame) {
      const w = store.windowFor(frame);
      return w ? aliveUnitCount(w, frame) : 0;
    },
    forEachUnit(frame, visit) {
      const w = store.windowFor(frame);
      if (!w) return false;
      forEachAliveUnit(w, frame, (i) => {
        if (!transformAt(w, i, frame, transform)) return;
        // A unit with no status keys is whole and complete.
        status.health = 1;
        status.build = 1;
        statusAt(w, i, frame, status);
        unit.serial = w.unitSerial[i];
        unit.def = w.unitDef[i];
        unit.team = w.unitTeam[i];
        unit.x = transform.x;
        unit.z = transform.z;
        unit.fx = transform.fx;
        unit.fz = transform.fz;
        unit.health = status.health;
        unit.build = status.build;
        visit(unit);
      });
      return true;
    },
    forEachProjectile(frame, visit) {
      const w = store.windowFor(frame);
      if (!w) return false;
      forEachAliveProjectile(w, frame, (i) => {
        if (!projectileAt(w, i, frame, shot)) return;
        projectile.serial = w.projectileSerial[i];
        projectile.weapon = w.projectileWeapon[i];
        projectile.team = w.projectileTeam[i];
        projectile.x = shot.x;
        projectile.z = shot.z;
        projectile.vx = shot.vx;
        projectile.vz = shot.vz;
        visit(projectile);
      });
      return true;
    },
    windowFault: (frame) => store.failure(windowOfFrame(header, frame)),
    heldWindows: () => store.held(),
    subscribe: (listener) => store.subscribe(listener),
  };
  return { handle, close: () => store.dispose() };
}
