/**
 * Sorting saved units into what you built and what you opened out of somebody
 * else's game (#1819).
 *
 * One flat list stops telling you anything once you are working on two games at
 * once, because a unit you assembled out of parts and a unit you opened out of a
 * game look exactly alike in it. `LegoProject.imported` already says which is
 * which, and the picker records the game each opened unit came from, so the only
 * work here is grouping on that.
 *
 * Grouping is on the archive rather than on the game's name, because the name is
 * what a game chooses to call itself and can carry a `$VERSION` placeholder,
 * while the archive is the thing on disk that was read. The name is still what
 * the group is labelled with, since that is what somebody recognises.
 *
 * Pure, so the grouping rules are testable without a webview.
 */

import type { LegoProject } from "./model";

/** The archive extensions a game's models can arrive from. */
const ARCHIVE_EXT = /\.(sdd|sdz|sd7|sdp)$/i;

/** The units opened out of one game. */
export interface LegoGameGroup {
  /** The archive's file name, lower case. Stable across the two ways a unit can
   *  say where it came from, so both land in one group. */
  key: string;
  /** What the group is called: the game's own name where one was recorded, and
   *  the archive's file name where it was only read back out of a path. */
  label: string;
  /** In the order they were given, which is newest first. */
  projects: LegoProject[];
}

export interface GroupedProjects {
  /** Units built out of the parts pack. */
  own: LegoProject[];
  /** Units opened out of a game, one group per game, by label. */
  games: LegoGameGroup[];
  /** Units opened out of a model file that names no game: one exported from
   *  Blender, or downloaded, or sitting on a desktop. Kept apart rather than
   *  filed under a made-up game, because there is no game to name. */
  files: LegoProject[];
}

/**
 * The game archive a model's path ran through, if it ran through one.
 *
 * Units opened before the picker existed carry only the path the file dialog
 * handed over, so this is the one thing that can be recovered for them. The
 * archive is a path segment rather than the last one: a loose `.sdd` game is a
 * folder with the model inside it, and a packed import records the archive's
 * path with the member appended, which describes where the model was rather
 * than naming a file anything can open.
 */
export function archiveFromSource(source: string): string | null {
  const segments = source.replace(/\\/g, "/").split("/");
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (ARCHIVE_EXT.test(segments[i])) return segments[i];
  }
  return null;
}

/** Split saved units by where each one came from. */
export function groupProjects(projects: LegoProject[]): GroupedProjects {
  const own: LegoProject[] = [];
  const files: LegoProject[] = [];
  const games = new Map<string, LegoGameGroup>();
  /** Groups whose label is only an archive name, so a recorded name can still
   *  replace it however the two are ordered. */
  const guessed = new Set<string>();

  for (const project of projects) {
    const imported = project.imported;
    if (!imported) {
      own.push(project);
      continue;
    }
    const recorded = imported.game;
    const archive = recorded?.archive ?? archiveFromSource(imported.source);
    if (!archive) {
      files.push(project);
      continue;
    }
    const key = archive.toLowerCase();
    const group = games.get(key);
    if (!group) {
      games.set(key, {
        key,
        label: recorded?.name ?? archive,
        projects: [project],
      });
      if (!recorded) guessed.add(key);
      continue;
    }
    group.projects.push(project);
    if (recorded && guessed.has(key)) {
      group.label = recorded.name;
      guessed.delete(key);
    }
  }

  return {
    own,
    games: [...games.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    ),
    files,
  };
}
