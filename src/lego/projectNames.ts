/**
 * Naming rules for a unit, kept separate from `projects.ts` (which pulls in
 * the Tauri bindings) so it stays plain, testable logic.
 */

import type { LegoProject } from "./model";

/**
 * Whether `name` can replace the given unit's name, and why not if it cannot.
 *
 * A unit's name is a free-text label, not a piece name, so it is not run
 * through `normalisePieceName`. It only has to be non-empty and not collide
 * with another unit, because the grid tells units apart by name alone.
 */
export function validateProjectName(
  projects: LegoProject[],
  id: string,
  name: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Name cannot be empty";
  const clash = projects.some(
    (project) =>
      project.id !== id &&
      project.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return "Another unit already has this name";
  return null;
}
