/**
 * Where a tweak project is reached (issue #2696).
 *
 * The workshop used to be one route with the game in the query string, and a
 * project appeared behind you as you typed. Now `/workshop` is the list and
 * `/workshop/:id` is the editor, the way `/lego` and `/lego/:id` are, because a
 * project is scoped to one game (issue #2664) and choosing the game is part of
 * starting one rather than a control inside the editor.
 *
 * `/workshop/new` is the third path and the only interesting one. Somebody who
 * presses "Edit in Unit tweaks" on a unit's encyclopedia page has chosen a unit,
 * not a project, and sending them to a list would lose the unit they were
 * reading about. So {@link unitEditPath} answers with the game's own project
 * where there is one, and with `/workshop/new` where there is not: the editor
 * opens on the unit with nothing saved, and the first edit starts the project,
 * which is exactly what the page did before this issue. Looking at a unit still
 * leaves nothing behind.
 */
import type { ModProject } from "./project";

/**
 * The project a game's edits belong in: whichever of its projects was written
 * to last, which is the one the user was working in.
 *
 * Two written at the same moment, which is a project and a copy of it, fall to
 * the older, so duplicating does not move you into the copy. This is the rule
 * the unit page used to apply per game to decide which project the picker
 * opened, kept because it is still the right answer for a link that names a
 * game and no project.
 */
export function newestProjectForGame(
  projects: readonly ModProject[],
  gameName: string,
): ModProject | undefined {
  return projects
    .filter((p) => p.gameName === gameName)
    .reduce<ModProject | undefined>((newest, p) => {
      if (!newest) return p;
      if (p.updatedAt !== newest.updatedAt)
        return p.updatedAt > newest.updatedAt ? p : newest;
      return p.createdAt < newest.createdAt ? p : newest;
    }, undefined);
}

/** The editor for one saved project, on a unit when one is named. */
export function projectPath(id: string, unitKey?: string): string {
  return unitKey
    ? `/workshop/${id}?${new URLSearchParams({ unit: unitKey })}`
    : `/workshop/${id}`;
}

/**
 * Where "edit this unit" lands: the game's own project, or the editor with no
 * project yet. Either way the unit is the one that was asked for.
 */
export function unitEditPath(
  projects: readonly ModProject[],
  gameName: string,
  unitKey: string,
): string {
  const project = newestProjectForGame(projects, gameName);
  if (project) return projectPath(project.id, unitKey);
  // Built with `URLSearchParams` rather than `encodeURIComponent`, because the
  // page reads it back with `useSearchParams` and a game installs under a name
  // with spaces in it ("Beyond All Reason test-...").
  return `/workshop/new?${new URLSearchParams({ game: gameName, unit: unitKey })}`;
}
