/**
 * The marks under the script scrubber: one per frame on which the script
 * announced something, and the words each one says.
 *
 * Nano spray is not marked. A build span records it on every frame, which
 * would bury everything else, and `build-start` already says where it starts.
 */

import { t } from "@lingui/core/macro";
import { type ScriptOutput, STAND_IN_UNIT_ID } from "./scriptPlayback";

/** Every event on frames that land on the same pixel of the scrubber, and the
 *  frame a click on the mark seeks to, which is the first of them. */
export interface ScrubberMark {
  frame: number;
  events: ScriptOutput[];
}

/** How far along the scrubber a frame is, from 0 to 100. */
export function markPercent(frame: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : (frame / (frameCount - 1)) * 100;
}

/**
 * Group a run's events into marks.
 *
 * Frames that land on the same pixel of a scrubber `width` pixels wide become
 * one mark, so a burst of effects is one thing to point at rather than a smear.
 * Before the row has been measured its width is 0, and marks merge only when
 * they share a frame.
 */
export function scrubberMarks(
  events: ScriptOutput[],
  frameCount: number,
  width: number,
): ScrubberMark[] {
  const marks: ScrubberMark[] = [];
  let lastPixel: number | null = null;
  for (const event of events) {
    if (!isMarked(event)) continue;
    const pixel =
      width > 0
        ? Math.round((markPercent(event.frame, frameCount) / 100) * width)
        : event.frame;
    const last = marks[marks.length - 1];
    if (last && pixel === lastPixel) {
      last.events.push(event);
    } else {
      marks.push({ frame: event.frame, events: [event] });
      lastPixel = pixel;
    }
  }
  return marks;
}

/** What a mark's button is called: its frame, counted from one as the frame
 *  counter beside the scrubber counts, and the first thing that happened. */
export function markLabel(mark: ScrubberMark): string {
  const more = mark.events.length - 1;
  const frame = mark.frame + 1;
  const first = `${t`Frame ${frame}`}: ${describeOutput(mark.events[0])}`;
  return more > 0 ? `${first}${t`, and ${more} more`}` : first;
}

/** Whether an event gets a mark under the scrubber. */
export function isMarked(event: ScriptOutput): boolean {
  return event.kind !== "nano";
}

export function describeOutput(event: ScriptOutput): string {
  switch (event.kind) {
    case "sfx": {
      const { sfx, piece } = event;
      return `${t`EmitSfx ${sfx} from ${piece}`} (${sfxName(sfx)})`;
    }
    case "explode": {
      const { piece } = event;
      return `${t`Explode ${piece}`} (${explodeFlags(event.flags)})`;
    }
    case "sound": {
      const { name } = event;
      return name === null
        ? t`Sound, which a TA script does not name`
        : t`Sound ${name}`;
    }
    case "attach": {
      const { piece, unit } = event;
      if (unit === STAND_IN_UNIT_ID) {
        return piece === null
          ? t`Attach stand-in to the void`
          : t`Attach stand-in to ${piece}`;
      }
      return piece === null
        ? t`Attach unit ${unit} to the void`
        : t`Attach unit ${unit} to ${piece}`;
    }
    case "drop": {
      const { unit } = event;
      return unit === STAND_IN_UNIT_ID
        ? t`Drop stand-in`
        : t`Drop unit ${unit}`;
    }
    case "nano": {
      const { piece } = event;
      return piece === null
        ? t`Nano spray from no piece`
        : t`Nano spray from ${piece}`;
    }
    case "build-start":
      return t`Factory starts building`;
    case "flare": {
      const { piece } = event;
      return t`Flare from ${piece}`;
    }
    case "shot": {
      const { weapon, piece } = event;
      return piece === null
        ? t`Shot, weapon ${weapon} from no piece`
        : t`Shot, weapon ${weapon} from ${piece}`;
    }
  }
}

/** The built-in effects, by the number `rts/Sim/Units/Scripts/CobDefines.h:9-16`
 *  gives them. */
function builtInSfx(sfx: number): string | undefined {
  switch (sfx) {
    case 0:
      return t`VTOL`;
    case 2:
    case 3:
      return t`wake`;
    case 4:
    case 5:
      return t`reverse wake`;
    case 257:
      return t`white smoke`;
    case 258:
      return t`black smoke`;
    case 259:
      return t`bubbles`;
  }
}

/** The range bits, in the order `CUnitScript::EmitSfx` tests them
 *  (`UnitScript.cpp:597-790`), each with what it means. */
const SFX_RANGES: [number, (index: number) => string][] = [
  [16384, (index) => t`global CEG ${index}`],
  [1024, (index) => t`CEG ${index}`],
  // A unit definition counts its weapons from one.
  [
    2048,
    (index) => {
      const weapon = index + 1;
      return t`fires weapon ${weapon}`;
    },
  ],
  [
    4096,
    (index) => {
      const weapon = index + 1;
      return t`detonates weapon ${weapon}`;
    },
  ],
];

/** An effect number in words, as the engine would read it. */
export function sfxName(sfx: number): string {
  const builtIn = builtInSfx(sfx);
  if (builtIn) return builtIn;
  for (const [bit, name] of SFX_RANGES) {
    if ((sfx & bit) !== 0) return name(sfx - bit);
  }
  return t`not an effect the engine knows`;
}

/**
 * Explode's flags, by the names BOS scripts use in Balanced Annihilation's
 * `scripts/exptype.h`, plus the two only the engine names
 * (`rts/Sim/Projectiles/PieceProjectile.h:9-17`).
 */
const EXPLODE_FLAGS: [number, string][] = [
  [1, "SHATTER"],
  [2, "EXPLODE_ON_HIT"],
  [4, "FALL"],
  [8, "SMOKE"],
  [16, "FIRE"],
  [32, "BITMAPONLY"],
  [64, "NOCEGTRAIL"],
  [128, "NOHEATCLOUD"],
  [256, "BITMAP1"],
  [512, "BITMAP2"],
  [1024, "BITMAP3"],
  [2048, "BITMAP4"],
  [4096, "BITMAP5"],
  [8192, "BITMAPNUKE"],
  [16384, "RECURSIVE"],
];

export function explodeFlags(flags: number): string {
  const names: string[] = [];
  let rest = flags;
  for (const [bit, name] of EXPLODE_FLAGS) {
    if ((flags & bit) !== 0) {
      names.push(name);
      rest &= ~bit;
    }
  }
  if (rest !== 0) names.push(String(rest));
  return names.length > 0 ? names.join(" | ") : t`no flags`;
}
