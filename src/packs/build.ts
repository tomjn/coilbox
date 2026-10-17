import type { StoredBlueprint } from "../blueprint/library";
import {
  gameIdentityForName,
  type InstalledGameInfo,
} from "../container/gameIdentity";
import type { SkirmishPreset } from "../play/presets";
import type { SetupPackGame, SetupPackManifest } from "./manifest";

/** What the export drawer has collected, before it becomes a manifest. */
export interface PackDraft {
  title: string;
  gameNames: string[];
  mapNames: string[];
  presets: SkirmishPreset[];
  /** Library layouts to bundle. Only the layout travels: the id and where this
   * copy came from belong to this machine. */
  blueprints: StoredBlueprint[];
  /** The scan's games, for filling in each pinned game's modinfo shortname. */
  installedGames: { name: string; shortname?: string }[];
}

/**
 * Turn what the drawer collected into a pack manifest, or null when the draft
 * names no content. Presets or blueprints alone are not a pack: they have their
 * own share codes, and a pack is a collection of things to install.
 */
export function buildPackManifest(draft: PackDraft): SetupPackManifest | null {
  if (draft.gameNames.length === 0 && draft.mapNames.length === 0) return null;

  const installed: InstalledGameInfo[] = draft.installedGames.map((g) => ({
    name: g.name,
    ...(g.shortname ? { info: { shortname: g.shortname } } : {}),
  }));
  const games: SetupPackGame[] = draft.gameNames.map((name) => {
    const identity = gameIdentityForName(name, installed);
    return {
      name,
      ...(identity?.shortname ? { shortname: identity.shortname } : {}),
    };
  });

  const presets = draft.presets.map(
    ({ id: _id, createdAt: _createdAt, lastUsedAt: _lastUsedAt, ...rest }) =>
      rest,
  );

  const blueprints = draft.blueprints.map((record) => record.layout);

  return {
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(games.length ? { games } : {}),
    ...(draft.mapNames.length ? { maps: draft.mapNames } : {}),
    ...(presets.length ? { presets } : {}),
    ...(blueprints.length ? { blueprints } : {}),
  };
}

/**
 * Which game's AI list a pack's bundled presets should be reconciled against.
 * One list, because the caller reads it through a hook: the game the first
 * preset names, or the pack's first game when it bundles none.
 */
export function aiGameNameForPack(
  manifest: SetupPackManifest,
): string | undefined {
  return manifest.presets?.[0]?.gameName ?? manifest.games?.[0]?.name;
}
