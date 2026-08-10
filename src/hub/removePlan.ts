/**
 * What removing a hub import would delete, worked out from plain lists.
 *
 * The reasoning, with no stores and no React in it, so it can be tested without
 * a running app - the same split `./importRecord.ts` has from `./imports.ts`,
 * and for the same reason. `./remove.ts` reads the four stores an import can
 * land in, hands them here, and turns the answer into the calls that delete.
 *
 * It works off the record's `refs` rather than off the item, because a setup
 * pack leaves several presets behind and the record is the only thing that knows
 * which of them came from that item. Refs that are already gone are skipped, so
 * removing a pack whose presets were half deleted by hand still finishes.
 */

import type { HubItem } from "./api";
import type { HubImportRecord } from "./importRecord";

/** Which store the things being deleted live in. */
export type RemovalStore = "preset" | "galaxy" | "run" | "scenario";

/** One thing an import left behind and this install still has. */
export interface RemovalTarget {
  id: string;
  name: string;
  /** Set for a scenario a campaign mission attached, which decides whether its
   * dialogue clips outlive it. */
  keepMedia?: boolean;
}

/** What Remove would delete, before anything is deleted. */
export interface RemovalPlan {
  store: RemovalStore;
  targets: RemovalTarget[];
  /** What the reader is being asked. */
  summary: string;
  /** Why they might not want to, or null when there is no reason to think so. */
  warning: string | null;
}

/** Everything the four stores hold that a removal has to look at. */
export interface RemovalStores {
  presets: { id: string; name: string }[];
  /** Local galaxies only. A bundled one ships with the app, so no import
   * produced it and it cannot be deleted. */
  galaxies: { id: string; title: string }[];
  /** Galaxy ids with a game in progress on them. */
  playing: ReadonlySet<string>;
  runs: { id: string; name: string }[];
  /** Local scenarios only, for the same reason as galaxies. */
  scenarios: { id: string; name: string }[];
  /** Scenario ids a campaign mission attached. */
  attached: ReadonlySet<string>;
}

/**
 * Work out what removing this item would delete, or null when there is nothing
 * of it here.
 *
 * Only a campaign mission playing an imported scenario is a genuine reference
 * from elsewhere. The other warnings are about progress: a conquest galaxy
 * mid-game, or a warpath run, where what is lost is the playing rather than a
 * link from somewhere else.
 */
export function planRemoval(
  item: Pick<HubItem, "kind" | "mode">,
  record: HubImportRecord | undefined,
  stores: RemovalStores,
): RemovalPlan | null {
  if (!record) return null;
  const refs = new Set(record.refs);

  if (item.kind === "challenge" && item.mode === "warpath") {
    return plan(
      "run",
      stores.runs.filter((r) => refs.has(r.id)),
      "warpath run",
      "However far you have got in it goes too.",
    );
  }

  if (item.kind === "challenge") {
    const found = stores.galaxies.filter((g) => refs.has(g.id));
    return plan(
      "galaxy",
      found.map((g) => ({ id: g.id, name: g.title })),
      "galaxy",
      found.some((g) => stores.playing.has(g.id))
        ? "You have a game in progress on it, which goes too."
        : null,
    );
  }

  if (item.kind === "scenario") {
    const targets = stores.scenarios
      .filter((s) => refs.has(s.id))
      .map((s) => ({ ...s, keepMedia: stores.attached.has(s.id) }));
    return plan(
      "scenario",
      targets,
      "scenario",
      targets.some((s) => s.keepMedia)
        ? "A campaign mission plays this scenario. The mission keeps playing, because it carries its own copy."
        : null,
    );
  }

  // A preset, and every preset a setup pack brought with it.
  return plan(
    "preset",
    stores.presets.filter((p) => refs.has(p.id)),
    "preset",
    null,
  );
}

/**
 * Word the confirm, and answer null when there is nothing left to delete.
 *
 * Named things are named, because "delete 1 preset" and "delete Obsidian Belt"
 * are a different amount of help when you have several. Past three the list
 * stops being readable, so it becomes a count.
 */
function plan(
  store: RemovalStore,
  targets: RemovalTarget[],
  noun: string,
  warning: string | null,
): RemovalPlan | null {
  if (targets.length === 0) return null;
  const names = targets.map((t) => t.name);
  const summary =
    names.length <= 3
      ? `Delete ${names.map((n) => `“${n}”`).join(", ")}?`
      : `Delete ${names.length} ${noun}s?`;
  return { store, targets, summary, warning };
}
