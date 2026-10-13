import { ReplayTrackError } from "./fault";

/**
 * One window of a track, as typed arrays over the bytes the window command
 * sent (#3806). The layout is in the module note of
 * `crates/tauri-plugin-coilbox-content/src/demo/track_view.rs`.
 *
 * Every array is a view of one `ArrayBuffer`, so reading a window copies
 * nothing. A frame `F` is absolute. A unit's keys are the slice of each key
 * array from `unitTransformStart[i]` to `unitTransformStart[i + 1]`, and the
 * same for status keys and for a projectile's.
 *
 * Do not pass a `TrackWindow` or one of its arrays as a React prop. React's
 * development build diffs a typed array element by element, which cost 2
 * seconds on the scenario map preview. {@link ReplayTrackHandle} hides the
 * windows behind accessors for that reason.
 */
export interface TrackWindow {
  index: number;
  startFrame: number;
  endFrame: number;
  /** Used to turn a stored rotation back into a quaternion. */
  rotationBits: number;

  unitCount: number;
  unitSerial: Uint32Array;
  unitFirst: Uint32Array;
  unitLast: Uint32Array;
  /** `unitCount + 1` entries. */
  unitTransformStart: Uint32Array;
  /** `unitCount + 1` entries. */
  unitStatusStart: Uint32Array;
  /** An index in the header's `unitDefs`. */
  unitDef: Uint16Array;
  unitTeam: Uint8Array;

  transformFrame: Uint32Array;
  /** Elmos. */
  transformX: Float32Array;
  transformZ: Float32Array;
  /** The three kept components of the rotation, as the file stores them. */
  rotationA: Int16Array;
  rotationB: Int16Array;
  rotationC: Int16Array;
  /** Which of the quaternion's `x, y, z, w` is the one left out, 0 to 3. */
  rotationDropped: Uint8Array;

  statusFrame: Uint32Array;
  /** 0 to 65,535. */
  statusHealth: Uint16Array;
  statusBuild: Uint16Array;

  projectileCount: number;
  projectileSerial: Uint32Array;
  projectileFirst: Uint32Array;
  projectileLast: Uint32Array;
  /** `projectileCount + 1` entries. */
  projectileKeyStart: Uint32Array;
  /** An index in the header's `weaponDefs`, or 65,535 for debris. */
  projectileWeapon: Uint16Array;
  /** 255 for none. */
  projectileTeam: Uint8Array;

  shotFrame: Uint32Array;
  shotX: Float32Array;
  shotZ: Float32Array;
  /** Elmos per frame. */
  shotVx: Float32Array;
  shotVz: Float32Array;
}

/** Must match `LAYOUT_VERSION` in `track_view.rs`. */
export const LAYOUT_VERSION = 1;

const HEADER_WORDS = 10;

function bad(message: string): ReplayTrackError {
  return new ReplayTrackError({
    kind: "unreadable",
    message: `a window's bytes: ${message}`,
  });
}

/** Cuts the arrays out of a window's bytes, in the order the layout gives. */
export function decodeWindowPayload(
  buffer: ArrayBuffer,
  rotationBits: number,
): TrackWindow {
  if (buffer.byteLength < HEADER_WORDS * 4) {
    throw bad(`${buffer.byteLength} bytes is too short for the header`);
  }
  const head = new Uint32Array(buffer, 0, HEADER_WORDS);
  if (head[0] !== LAYOUT_VERSION) {
    throw bad(`layout ${head[0]}, this build reads ${LAYOUT_VERSION}`);
  }
  const [
    ,
    index,
    startFrame,
    endFrame,
    units,
    transforms,
    statuses,
    projectiles,
    keys,
  ] = head;

  let at = HEADER_WORDS * 4;
  const take = <T extends ArrayBufferView>(
    make: new (b: ArrayBuffer, offset: number, length: number) => T,
    count: number,
    width: number,
  ): T => {
    const bytes = count * width;
    if (at + bytes > buffer.byteLength) {
      throw bad(
        `it ends at ${buffer.byteLength}, short of the ${at + bytes} it needs`,
      );
    }
    const view = new make(buffer, at, count);
    // Every array starts on a multiple of 4 bytes.
    at += Math.ceil(bytes / 4) * 4;
    return view;
  };
  const u32 = (n: number) => take(Uint32Array, n, 4);
  const f32 = (n: number) => take(Float32Array, n, 4);
  const u16 = (n: number) => take(Uint16Array, n, 2);
  const i16 = (n: number) => take(Int16Array, n, 2);
  const u8 = (n: number) => take(Uint8Array, n, 1);

  const window: TrackWindow = {
    index,
    startFrame,
    endFrame,
    rotationBits,
    unitCount: units,
    unitSerial: u32(units),
    unitFirst: u32(units),
    unitLast: u32(units),
    unitTransformStart: u32(units + 1),
    unitStatusStart: u32(units + 1),
    unitDef: u16(units),
    unitTeam: u8(units),
    transformFrame: u32(transforms),
    transformX: f32(transforms),
    transformZ: f32(transforms),
    rotationA: i16(transforms),
    rotationB: i16(transforms),
    rotationC: i16(transforms),
    rotationDropped: u8(transforms),
    statusFrame: u32(statuses),
    statusHealth: u16(statuses),
    statusBuild: u16(statuses),
    projectileCount: projectiles,
    projectileSerial: u32(projectiles),
    projectileFirst: u32(projectiles),
    projectileLast: u32(projectiles),
    projectileKeyStart: u32(projectiles + 1),
    projectileWeapon: u16(projectiles),
    projectileTeam: u8(projectiles),
    shotFrame: u32(keys),
    shotX: f32(keys),
    shotZ: f32(keys),
    shotVx: f32(keys),
    shotVz: f32(keys),
  };
  if (at !== buffer.byteLength) {
    throw bad(`${buffer.byteLength - at} bytes follow the last array`);
  }
  // A start array that runs past its keys would read other units' keys.
  if (
    window.unitTransformStart[units] !== transforms ||
    window.unitStatusStart[units] !== statuses ||
    window.projectileKeyStart[projectiles] !== keys
  ) {
    throw bad("a unit's key ranges do not add up to the keys");
  }
  return window;
}
