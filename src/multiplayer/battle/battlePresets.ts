import { useSetting } from "@picoframe/frame";
import { battleOptionTags } from "./battleOptions";

/**
 * Named hosting-option presets: saved snapshots of a battle's mod/map options and
 * start-pos type that the host can reload later, plus an optional per-game default
 * preset applied automatically when that game is hosted. A preset is scoped to one
 * game (its options only make sense there), persisted through the frame settings
 * store under one key — mirroring the singleplayer `useSkirmishPresets` pattern.
 */
export interface BattlePreset {
  /** Stable identity (UUID) — presets can share a name. */
  id: string;
  name: string;
  /** The game these options belong to (drives the per-game default match). */
  gameName: string;
  /** The captured option script tags (mod/map options + start-pos type only). */
  scriptTags: Record<string, string>;
  createdAt: string;
  lastUsedAt: string;
}

export function useBattlePresets() {
  const [presets, setPresets] = useSetting<BattlePreset[]>(
    "multiplayer.battlePresets",
    [],
  );
  // Game name -> preset id. Kept separate from the preset list so "set as default"
  // is a clean single-default-per-game toggle.
  const [defaults, setDefaults] = useSetting<Record<string, string>>(
    "multiplayer.battlePresetDefaults",
    {},
  );

  /** Save the given option tags under a name for `gameName`, prepended to the list. */
  function savePreset(
    name: string,
    gameName: string,
    scriptTags: Record<string, string>,
  ): BattlePreset {
    const now = new Date().toISOString();
    const preset: BattlePreset = {
      id: crypto.randomUUID(),
      name,
      gameName,
      scriptTags: battleOptionTags(scriptTags),
      createdAt: now,
      lastUsedAt: now,
    };
    setPresets([preset, ...presets]);
    return preset;
  }

  /** Bump `lastUsedAt` and move the preset to the front (called on load). */
  function touchPreset(id: string) {
    const now = new Date().toISOString();
    const target = presets.find((p) => p.id === id);
    if (!target) return;
    setPresets([
      { ...target, lastUsedAt: now },
      ...presets.filter((p) => p.id !== id),
    ]);
  }

  function removePreset(id: string) {
    setPresets(presets.filter((p) => p.id !== id));
    // Drop it from any game default that referenced it.
    const next: Record<string, string> = {};
    let changed = false;
    for (const [g, pid] of Object.entries(defaults)) {
      if (pid === id) changed = true;
      else next[g] = pid;
    }
    if (changed) setDefaults(next);
  }

  /** Set (or clear, with `null`) the default preset applied when `gameName` is hosted. */
  function setDefaultForGame(gameName: string, presetId: string | null) {
    const next = { ...defaults };
    if (presetId) next[gameName] = presetId;
    else delete next[gameName];
    setDefaults(next);
  }

  function defaultForGame(gameName: string): string | undefined {
    return defaults[gameName];
  }

  function presetsForGame(gameName: string): BattlePreset[] {
    return presets.filter((p) => p.gameName === gameName);
  }

  return {
    presets,
    savePreset,
    touchPreset,
    removePreset,
    setDefaultForGame,
    defaultForGame,
    presetsForGame,
  };
}
