import { useSetting } from "@picoframe/frame";
import type { BattleRestrictions, SkirmishDraft } from "./drafts";

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

/**
 * Parse the raw JSON of an imported preset file into a `SkirmishDraft` (plus its
 * original name), or `null` if the shape doesn't match — an imported file is
 * untrusted input, so validate the five draft fields before adopting it. Identity
 * and timestamps are intentionally dropped: the importer mints fresh ones via
 * `savePreset`, so importing never collides with an existing preset's id.
 */
export function parsePresetJson(
  json: string,
): (SkirmishDraft & { name?: string }) | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    !Array.isArray(d.participants) ||
    typeof d.gameName !== "string" ||
    typeof d.mapName !== "string" ||
    typeof d.startPosType !== "number" ||
    typeof d.modOptionValues !== "object" ||
    d.modOptionValues === null
  )
    return null;
  return {
    participants: d.participants as SkirmishDraft["participants"],
    gameName: d.gameName,
    mapName: d.mapName,
    startPosType: d.startPosType,
    modOptionValues: d.modOptionValues as SkirmishDraft["modOptionValues"],
    restrictions: parseRestrictions(d.restrictions),
    name: typeof d.name === "string" ? d.name : undefined,
  };
}

/**
 * Validate the optional restrictions blob from imported preset JSON, dropping any
 * malformed field (untrusted input). Returns undefined when nothing valid remains,
 * so a preset without restrictions never gains an empty object.
 */
function parseRestrictions(value: unknown): BattleRestrictions | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const out: BattleRestrictions = {};
  if (
    Array.isArray(r.disabledUnits) &&
    r.disabledUnits.every((u) => typeof u === "string")
  )
    out.disabledUnits = r.disabledUnits as string[];
  if (typeof r.advantage === "number") out.advantage = r.advantage;
  if (typeof r.incomeMultiplier === "number")
    out.incomeMultiplier = r.incomeMultiplier;
  return Object.keys(out).length > 0 ? out : undefined;
}
