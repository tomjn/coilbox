/**
 * Sorting saved units by the game each is for (#1819, #4328).
 *
 * A unit belongs to the game it is for, whether it was built from parts or
 * opened out of somebody else's game, so one game's units sit together.
 * Two versions of a game, or a game and its mutator, are one game by the rule
 * in `unitGame.ts`, so they share a section. A unit for no game keeps a section
 * of its own, and a unit opened from a model file that names no game keeps
 * another.
 *
 * Pure, so the grouping rules are testable without a webview.
 */

import type { GameItem } from "@/content/bindings";
import type { LegoProject } from "./model";
import { gameKey, unitGame } from "./unitGame";
import { variantRoot, withVariantsTogether } from "./variantFamily";

/** The archive extensions a game's models can arrive from. */
const ARCHIVE_EXT = /\.(sdd|sdz|sd7|sdp)$/i;

/** The units for one game, across its versions and mutators. */
export interface LegoGameGroup {
  /** The game's `gameKey`. What a folded section is remembered by. */
  key: string;
  /** What the group is called: the newest game name recorded on its units, or
   *  an archive's file name where that is all a unit's path gave. */
  label: string;
  /** Every archive a unit in the group is for, lower case. Lets a fold saved
   *  under an archive name be carried to this group's key. */
  archives: string[];
  /** Built units first, then opened ones, each in the order they were given
   *  (newest first), with each variant right after the unit it came from. */
  projects: LegoProject[];
}

/** The units of one roster (#3239), which the game maker asked for together. */
export interface LegoRosterGroup {
  /** The roster's id. What a folded section is remembered by. */
  key: string;
  label: string;
  /** By unit name, which is by job and then tier. */
  projects: LegoProject[];
}

export interface GroupedProjects {
  /** Units generated as a roster, one group per roster, by label. A roster's
   *  units sit here rather than with their game, so a roster stays whole. */
  rosters: LegoRosterGroup[];
  /** Units built from parts that are for no game. */
  own: LegoProject[];
  /** Units for a game, one group per game, by label. */
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

/** Split saved units by the game each is for. `installed` lets a unit saved
 *  before short names were recorded find its game's key. */
export function groupProjects(
  projects: LegoProject[],
  installed: readonly GameItem[] = [],
): GroupedProjects {
  const own: LegoProject[] = [];
  const files: LegoProject[] = [];
  interface Building {
    key: string;
    archives: Set<string>;
    names: { name: string; guessed: boolean }[];
    built: LegoProject[];
    opened: LegoProject[];
  }
  const games = new Map<string, Building>();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rosters = new Map<string, LegoRosterGroup>();

  for (const project of projects) {
    // A variant is filed where the unit it came from is (#3240), and listed
    // after it below.
    const home = variantRoot(project, byId);
    if (home.roster) {
      const { id, name } = home.roster;
      const group = rosters.get(id) ?? { key: id, label: name, projects: [] };
      group.projects.push(project);
      rosters.set(id, group);
      continue;
    }
    let game = unitGame(home);
    let guessed = false;
    if (!game && home.imported && home.game === undefined) {
      // Opened before the picker recorded a game: all that is left is the path.
      const archive = archiveFromSource(home.imported.source);
      if (archive) {
        game = { name: archive, archive };
        guessed = true;
      }
    }
    if (!game) {
      (home.imported ? files : own).push(project);
      continue;
    }
    const key = gameKey(game, installed);
    let group = games.get(key);
    if (!group) {
      group = { key, archives: new Set(), names: [], built: [], opened: [] };
      games.set(key, group);
    }
    group.archives.add(game.archive.toLowerCase());
    group.names.push({ name: (game.base ?? game).name, guessed });
    (home.imported ? group.opened : group.built).push(project);
  }

  const newest = (a: string, b: string) =>
    b.localeCompare(a, undefined, { numeric: true });
  const groups = [...games.values()].map((group): LegoGameGroup => {
    const named = group.names.filter((n) => !n.guessed);
    const label = (named.length > 0 ? named : group.names)
      .map((n) => n.name)
      .sort(newest)[0];
    return {
      key: group.key,
      label,
      archives: [...group.archives],
      projects: [
        ...withVariantsTogether(group.built),
        ...withVariantsTogether(group.opened),
      ],
    };
  });

  const byLabel = (
    a: { label: string; key: string },
    b: { label: string; key: string },
  ) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
    a.key.localeCompare(b.key);
  return {
    rosters: [...rosters.values()]
      .map((roster) => ({
        ...roster,
        projects: withVariantsTogether(
          [...roster.projects].sort((a, b) =>
            a.unitName.localeCompare(b.unitName),
          ),
        ),
      }))
      .sort(byLabel),
    own: withVariantsTogether(own),
    games: groups.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    ),
    files: withVariantsTogether(files),
  };
}

/**
 * Only the units a search asks for, still in their groups.
 *
 * Matches the unit's name, its unit name and the name of the game it is for,
 * ignoring case. A group's own name matches too, and brings every unit in it,
 * so typing a game finds its units even when none of them is named after it. A group left with nothing is
 * dropped. An empty or blank query changes nothing.
 */
export function filterGrouped(
  grouped: GroupedProjects,
  query: string,
): GroupedProjects {
  const needle = query.trim().toLowerCase();
  if (!needle) return grouped;
  // A variant has the game of the unit it came from (#3240).
  const byId = new Map(
    [
      ...grouped.own,
      ...grouped.files,
      ...grouped.games.flatMap((game) => game.projects),
    ].map((p) => [p.id, p]),
  );
  const matches = (project: LegoProject) =>
    project.name.toLowerCase().includes(needle) ||
    project.unitName.toLowerCase().includes(needle) ||
    (unitGame(variantRoot(project, byId))
      ?.name.toLowerCase()
      .includes(needle) ??
      false);

  return {
    rosters: grouped.rosters
      .map((roster) =>
        roster.label.toLowerCase().includes(needle)
          ? roster
          : { ...roster, projects: roster.projects.filter(matches) },
      )
      .filter((roster) => roster.projects.length > 0),
    own: grouped.own.filter(matches),
    games: grouped.games
      .map((game) =>
        game.label.toLowerCase().includes(needle)
          ? game
          : { ...game, projects: game.projects.filter(matches) },
      )
      .filter((game) => game.projects.length > 0),
    files: grouped.files.filter(matches),
  };
}

/**
 * Carry folded sections saved under an archive name over to the game key that
 * now stands for that archive. A saved key that no group's archive matches is
 * left alone, so a fold survives a visit when its units are not loaded.
 */
export function carryFoldedKeys(
  saved: ReadonlySet<string>,
  groups: readonly LegoGameGroup[],
): ReadonlySet<string> {
  const next = new Set(saved);
  for (const group of groups) {
    const old = group.archives.filter((archive) => next.has(archive));
    if (old.length === 0) continue;
    for (const archive of old) next.delete(archive);
    next.add(group.key);
  }
  return next.size === saved.size && [...next].every((k) => saved.has(k))
    ? saved
    : next;
}
