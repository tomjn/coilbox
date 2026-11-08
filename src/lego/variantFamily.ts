/**
 * Variants of a unit listed with it (issue #3240). Plain functions on saved
 * units, so the project list can group them without pulling in the generator.
 */

import type { LegoProject } from "./model";

/**
 * The unit a variant came from, followed up the chain to the first unit that
 * is not itself a variant of a saved one. A unit whose parent was deleted is
 * its own root. A chain that loops stops where it began.
 */
export function variantRoot(
  project: LegoProject,
  byId: ReadonlyMap<string, LegoProject>,
): LegoProject {
  const seen = new Set([project.id]);
  let at = project;
  for (;;) {
    const parent = at.variantOf ? byId.get(at.variantOf) : undefined;
    if (!parent) return at;
    // A chain that loops has no root, so each unit stands for itself.
    if (seen.has(parent.id)) return project;
    seen.add(parent.id);
    at = parent;
  }
}

/**
 * `projects` with each unit's variants right after it, the family in the order
 * its first member was given. Variants of a variant follow the variant. Units
 * with no variants keep their places.
 */
export function withVariantsTogether(
  projects: readonly LegoProject[],
): LegoProject[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const children = new Map<string, LegoProject[]>();
  const roots: LegoProject[] = [];
  for (const project of projects) {
    const parent = project.variantOf ? byId.get(project.variantOf) : undefined;
    if (!parent || parent.id === project.id) {
      roots.push(project);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(project);
    children.set(parent.id, list);
  }
  const out: LegoProject[] = [];
  const placed = new Set<LegoProject>();
  const place = (project: LegoProject) => {
    if (placed.has(project)) return;
    placed.add(project);
    out.push(project);
    for (const child of children.get(project.id) ?? []) place(child);
  };
  for (const root of roots) place(root);
  // A loop has no root, so its units are placed where they were given.
  for (const project of projects) place(project);
  return out;
}
