/**
 * Which of a player's widgets a battle room stops from loading (issue #1292).
 *
 * Some games let a room's mod options turn off every widget a player added,
 * and some read the player's own config file for the same switch. Beyond All
 * Reason also has an option that stops widgets giving orders. What each
 * handler checks is in `handlers.ts`. This works out, for the room as it
 * stands, which widgets that costs the player.
 */

import type { UserWidgetGates } from "./handlers";
import type { GameHandler, WidgetRow } from "./widgetList";
import { appliedSet, entry, setKey, type WidgetSets } from "./widgetSets";

/** Why a player's widgets will not load, first of the reasons that apply. */
export type OffReason =
  /** The room's mod option. */
  | "option"
  /** The room's team colour mode hides who is who. */
  | "anonymous-colours"
  /** The player's own setting in the game's widget list. */
  | "config-flag"
  /** The player has not turned local widgets on in the game. */
  | "local-widgets";

export interface RoomWidgetContext {
  rules: UserWidgetGates;
  /** The room's value for a mod option, or undefined when it sets none. */
  option(key: string): string | undefined;
  /** Whether the player is a spectator in the room. */
  spectating: boolean;
  /** `allowUserWidgets` in the game's config file, null when it has none or
   *  the file could not be read. */
  configFlag: boolean | null;
  /** Whether the "Local Widgets Config" entry turns local widgets on, null
   *  when the file could not be read. */
  localWidgets: boolean | null;
}

export interface RoomWidgetVerdict {
  /** Why the player's widgets will not load, or null when they will. */
  off: OffReason | null;
  /** The room turns off widgets that give orders. */
  noUnitControl: boolean;
}

/** A mod option's value as a flag, undefined when it is not one. */
function flag(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

export function roomWidgetVerdict(ctx: RoomWidgetContext): RoomWidgetVerdict {
  const { rules } = ctx;
  if (ctx.spectating && rules.spectators === "all") {
    return { off: null, noUnitControl: false };
  }
  let off: OffReason | null = null;
  const o = rules.option;
  if (o && !(ctx.spectating && rules.spectators === "option")) {
    if ((flag(ctx.option(o.key)) ?? o.unset) !== o.loads) off = "option";
  }
  if (
    !off &&
    rules.anonymousColours &&
    (ctx.option("teamcolors_anonymous_mode") ?? "disabled") !== "disabled"
  ) {
    off = "anonymous-colours";
  }
  if (!off && rules.configFlag && ctx.configFlag === false) off = "config-flag";
  if (!off && rules.localWidgetsFile && ctx.localWidgets === false) {
    off = "local-widgets";
  }
  const noUnitControl =
    !off &&
    !!rules.unitControlOption &&
    flag(ctx.option(rules.unitControlOption)) === false;
  return { off, noUnitControl };
}

export interface RoomWidgetWarning extends RoomWidgetVerdict {
  /** Widgets the player's game will not load at all. */
  blocked: string[];
  /** Widgets that declare they give orders, which the game skips. */
  skipped: string[];
  /** Widgets that give orders without declaring it, which load and then raise
   *  an error each time they do. */
  failing: string[];
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function names(rows: readonly WidgetRow[]): string[] {
  return [...new Set(rows.map((r) => r.info?.name ?? fileName(r.path)))];
}

/**
 * What the room costs the player, or null when it costs nothing. Counts the
 * widgets `game` would load: its own handler's folders, not coilbox's own
 * widget, and not one the player's widget set already has off.
 */
export function roomWidgetWarning(
  verdict: RoomWidgetVerdict,
  rows: readonly WidgetRow[],
  game: Pick<GameHandler, "game" | "shortName">,
  sets: WidgetSets,
): RoomWidgetWarning | null {
  if (!verdict.off && !verdict.noUnitControl) return null;
  const set = appliedSet(sets, setKey(game));
  const loaded = rows.filter(
    (r) =>
      r.loadedBy.includes(game.game) &&
      !r.coilbox &&
      r.info !== null &&
      (r.switch.kind !== "ready" || entry(set, r.switch.name) !== false),
  );
  const blocked = verdict.off ? names(loaded) : [];
  const skipped = verdict.noUnitControl
    ? names(loaded.filter((r) => r.info?.control === true))
    : [];
  const failing = verdict.noUnitControl
    ? names(loaded.filter((r) => r.info?.control !== true && r.givesOrders))
    : [];
  if (blocked.length + skipped.length + failing.length === 0) return null;
  return { ...verdict, blocked, skipped, failing };
}
