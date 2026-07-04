import { useSetting } from "@picoframe/frame";
import type { SkirmishDraft } from "./drafts";

/**
 * Named singleplayer (skirmish) presets: saved snapshots of a full setup (game,
 * map, opponents, start-pos type and mod options) the user can reload later. A
 * preset is just a named `SkirmishDraft` — the same five fields the working draft
 * holds — plus identity and timestamps, persisted through the frame settings store
 * under one key. Mirrors the `useMapProjects` named-collection pattern.
 */
export interface SkirmishPreset extends SkirmishDraft {
  /** Stable identity (UUID) — presets can share a name. */
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
}

export function useSkirmishPresets() {
  const [presets, setPresets] = useSetting<SkirmishPreset[]>(
    "play.presets",
    [],
  );

  /** Save the given setup under a name as a new preset, prepended to the list. */
  function savePreset(name: string, draft: SkirmishDraft): SkirmishPreset {
    const now = new Date().toISOString();
    const preset: SkirmishPreset = {
      ...draft,
      id: crypto.randomUUID(),
      name,
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
  }

  return { presets, savePreset, touchPreset, removePreset };
}
