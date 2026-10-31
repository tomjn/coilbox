import { t } from "@lingui/core/macro";
import type { ConfigOption } from "@/content/bindings";
import { undeclaredOptions } from "@/play/presetFit";
import type { PresetPart } from "@/play/presetParts";
import { MAPOPT_PREFIX, MODOPT_PREFIX, partForTag } from "./battleOptions";
import type { HostStep, HostStepFailure, HostSteps } from "./hostSteps";
import type { DeliveryProgress } from "./tweakDelivery";

/**
 * What applying a preset to a battle room left undone, for the message after it
 * (issue #1300).
 *
 * Option failures are read off the paced run the room already confirms each
 * option with, so there is one check of whether an option took, not two.
 */

/** A part, or one of the two room settings that are not a part of their own. */
export type NotTakenWhat = PresetPart | HostStep;

export interface NotTaken {
  what: NotTakenWhat;
  /** The options or map that did not take. Empty where the thing is the
   *  setting itself. */
  items: string[];
  reason?: string;
}

/**
 * Split option tags into what the game and map declare and what they do not.
 *
 * An autohost refuses an option the game does not declare, and the paced run
 * stops at the first refusal, so leaving one in would cost the options after it
 * too. A schema that is empty is not read yet, so nothing is dropped against it.
 */
export function dropUndeclared(
  tags: Record<string, string>,
  schemas: { mod: ConfigOption[]; map: ConfigOption[] },
): { kept: Record<string, string>; notTaken: NotTaken[] } {
  const byPart = new Map<PresetPart, string[]>();
  const kept: Record<string, string> = {};
  for (const [tagKey, value] of Object.entries(tags)) {
    const low = tagKey.toLowerCase();
    const scope = low.startsWith(MODOPT_PREFIX)
      ? { prefix: MODOPT_PREFIX, schema: schemas.mod }
      : low.startsWith(MAPOPT_PREFIX)
        ? { prefix: MAPOPT_PREFIX, schema: schemas.map }
        : null;
    const part = partForTag(tagKey);
    if (!scope || !part) {
      kept[tagKey] = value;
      continue;
    }
    const bare = tagKey.slice(scope.prefix.length);
    if (undeclaredOptions([bare], scope.schema).length === 0) {
      kept[tagKey] = value;
      continue;
    }
    byPart.set(part, [...(byPart.get(part) ?? []), bare]);
  }
  const reason = t`Not declared`;
  return {
    kept,
    notTaken: [...byPart].map(([what, items]) => ({ what, items, reason })),
  };
}

/** The options a paced run left unset, grouped by the part they belong to. A
 *  slot never tried because an earlier one failed did not take either. */
export function deliveryNotTaken(
  progress: DeliveryProgress | null,
): NotTaken[] {
  if (!progress) return [];
  const byPart = new Map<PresetPart, NotTaken>();
  for (const { slot, state, reason, hostSaid } of progress.slots) {
    if (state !== "failed" && state !== "skipped") continue;
    const part = partForTag(slot.tagKey) ?? "modOptions";
    const entry = byPart.get(part) ?? { what: part, items: [] };
    entry.items.push(slot.name);
    if (state === "failed" && !entry.reason)
      entry.reason = hostSaid?.[0] ?? reason;
    byPart.set(part, entry);
  }
  return [...byPart.values()];
}

/** The map and team shape steps that did not take, as entries. */
export function hostStepNotTaken(
  failures: HostStepFailure[],
  mapName?: string,
): NotTaken[] {
  return failures.map(({ step, reason }) => ({
    what: step,
    items: step === "map" && mapName ? [mapName] : [],
    reason,
  }));
}

/**
 * One short message naming everything that did not take, or null when it all
 * did. `label` names a part or setting, so the caller supplies the translation.
 */
export function notTakenMessage(
  entries: NotTaken[],
  label: (what: NotTakenWhat) => string,
): string | null {
  if (entries.length === 0) return null;
  return entries
    .map(({ what, items, reason }) => {
      const head =
        items.length > 0 ? `${label(what)}: ${items.join(", ")}` : label(what);
      return reason ? `${head} (${reason})` : head;
    })
    .join(". ");
}

/**
 * Run what a preset sends to a room besides the seat and the bots, in order, and
 * say what did not take.
 *
 * The map and team shape go first so the options land on the room they are for.
 * Options the game or map does not declare are skipped rather than sent, because
 * an autohost refuses them and the paced run stops at the first refusal, which
 * would cost every option after it. `afterOptions` runs once the options have
 * settled, for the start boxes, which an autohost refuses until the option that
 * puts the room in choose-in-game mode is in.
 */
export async function applyRoomSteps({
  hostSteps,
  tags,
  schemas,
  mapName,
  runHostSteps,
  applyOptionTags,
  afterOptions,
}: {
  hostSteps: HostSteps;
  tags: Record<string, string>;
  schemas: { mod: ConfigOption[]; map: ConfigOption[] };
  mapName: string;
  runHostSteps: (steps: HostSteps) => Promise<HostStepFailure[]>;
  applyOptionTags: (
    tags: Record<string, string>,
  ) => Promise<DeliveryProgress | null>;
  afterOptions: () => void;
}): Promise<NotTaken[]> {
  const { kept, notTaken: undeclared } = dropUndeclared(tags, schemas);
  const hostFailures = await runHostSteps(hostSteps);
  const delivery = await applyOptionTags(kept);
  afterOptions();
  return [
    ...hostStepNotTaken(hostFailures, mapName),
    ...undeclared,
    ...deliveryNotTaken(delivery),
  ];
}
