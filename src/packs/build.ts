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
  /** The scan's games, for filling in each pinned game's modinfo shortname. */
  installedGames: { name: string; shortname?: string }[];
}

/**
 * Turn what the drawer collected into a pack manifest, or null when the draft
 * names no content. Presets alone are not a pack: they have their own share
 * code, and a pack is a collection of things to install.
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

  return {
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(games.length ? { games } : {}),
    ...(draft.mapNames.length ? { maps: draft.mapNames } : {}),
    ...(presets.length ? { presets } : {}),
  };
}
