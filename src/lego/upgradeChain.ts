/**
 * Loadouts as an upgrade chain (#3286). A loadout can name the loadout it
 * upgrades from, with `LegoLoadout.upgradesFrom`, so the family reads as tiers.
 *
 * A chain is a line: a loadout upgrades from at most one other, and at most one
 * loadout upgrades from any one. The setter refuses a link that would loop or
 * branch. A saved file can still hold either, so `upgradeChainProblems` reports
 * them and `chainOrder` still lists every loadout once.
 *
 * This only stores and shows the chain. Writing it into a game's morph or
 * upgrade data is #3287.
 */

import { t } from "@lingui/core/macro";
import type { LegoLoadout, LegoProject } from "./model";
import { type Problem, problem } from "./problems";

/** Why loadout `id` cannot upgrade from `from`, or null when it can. */
export function upgradeRefusal(
  project: LegoProject,
  id: string,
  from: string,
): string | null {
  const loadouts = project.loadouts ?? [];
  const byId = new Map(loadouts.map((l) => [l.id, l]));
  if (!byId.has(id) || !byId.has(from)) return t`No such loadout.`;
  if (id === from) return t`A loadout cannot upgrade from itself.`;
  const taken = loadouts.find((l) => l.id !== id && l.upgradesFrom === from);
  if (taken) {
    const takenName = taken.name;
    const fromName = byId.get(from)?.name ?? from;
    return t`${takenName} already upgrades from ${fromName}.`;
  }
  const seen = new Set<string>();
  for (let at = byId.get(from); at && !seen.has(at.id); ) {
    if (at.id === id) {
      const fromName = byId.get(from)?.name ?? from;
      const idName = byId.get(id)?.name ?? id;
      return t`${fromName} already upgrades from ${idName}.`;
    }
    seen.add(at.id);
    at = at.upgradesFrom ? byId.get(at.upgradesFrom) : undefined;
  }
  return null;
}

/**
 * Make loadout `id` an upgrade of `from`, or with `from` null make it the start
 * of a chain. The same project when the link is refused, see `upgradeRefusal`,
 * or already as asked.
 */
export function setUpgradesFrom(
  project: LegoProject,
  id: string,
  from: string | null,
): LegoProject {
  const loadouts = project.loadouts;
  const entry = loadouts?.find((l) => l.id === id);
  if (!loadouts || !entry) return project;
  if ((entry.upgradesFrom ?? null) === from) return project;
  if (from !== null && upgradeRefusal(project, id, from) !== null)
    return project;
  return {
    ...project,
    loadouts: loadouts.map((l) => {
      if (l.id !== id) return l;
      const { upgradesFrom: _old, ...rest } = l;
      return from === null ? rest : { ...rest, upgradesFrom: from };
    }),
  };
}

/**
 * The loadouts in chain order: each chain from its start, one tier after the
 * next, chains and loose loadouts in the order the list has them. Every loadout
 * appears once, so a loop in a saved file still lists.
 */
export function chainOrder(loadouts: LegoLoadout[]): LegoLoadout[] {
  const ids = new Set(loadouts.map((l) => l.id));
  const after = new Map<string, LegoLoadout[]>();
  for (const l of loadouts) {
    if (l.upgradesFrom && ids.has(l.upgradesFrom))
      after.set(l.upgradesFrom, [...(after.get(l.upgradesFrom) ?? []), l]);
  }
  const out: LegoLoadout[] = [];
  const seen = new Set<string>();
  const visit = (l: LegoLoadout) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    out.push(l);
    for (const next of after.get(l.id) ?? []) visit(next);
  };
  for (const l of loadouts) {
    if (!l.upgradesFrom || !ids.has(l.upgradesFrom)) visit(l);
  }
  for (const l of loadouts) visit(l);
  return out;
}

/** The loadout `loadout` upgrades from, if the project has it. */
export function predecessorOf(
  project: LegoProject,
  loadout: LegoLoadout,
): LegoLoadout | undefined {
  return loadout.upgradesFrom
    ? project.loadouts?.find((l) => l.id === loadout.upgradesFrom)
    : undefined;
}

/** Whether any loadout is part of a chain. */
export function hasChain(project: LegoProject): boolean {
  return (project.loadouts ?? []).some((l) => predecessorOf(project, l));
}

/** Loops and branches a saved file holds, as problems for the list. */
export function upgradeChainProblems(project: LegoProject): Problem[] {
  const loadouts = project.loadouts ?? [];
  const byId = new Map(loadouts.map((l) => [l.id, l]));
  const out: Problem[] = [];

  const looped = new Set<string>();
  for (const start of loadouts) {
    const path: string[] = [];
    let at: LegoLoadout | undefined = start;
    while (at && !path.includes(at.id)) {
      path.push(at.id);
      at = at.upgradesFrom ? byId.get(at.upgradesFrom) : undefined;
    }
    if (!at) continue;
    const loop = path.slice(path.indexOf(at.id));
    if (loop.some((id) => looped.has(id))) continue;
    for (const id of loop) looped.add(id);
    const names = loop.map((id) => byId.get(id)?.name ?? id).join(", ");
    out.push(
      problem(
        "document",
        "warning",
        t`${names} upgrade from each other in a loop. An upgrade path is a line.`,
      ),
    );
  }

  const branches = new Map<string, string[]>();
  for (const l of loadouts) {
    if (l.upgradesFrom && byId.has(l.upgradesFrom))
      branches.set(l.upgradesFrom, [
        ...(branches.get(l.upgradesFrom) ?? []),
        l.name,
      ]);
  }
  for (const [from, names] of branches) {
    if (names.length > 1) {
      const together = names.join(" and ");
      const fromName = byId.get(from)?.name ?? from;
      out.push(
        problem(
          "document",
          "warning",
          t`${together} both upgrade from ${fromName}. An upgrade path is a line.`,
        ),
      );
    }
  }
  return out;
}
