import { useSetting } from "@picoframe/frame";
import {
  asContainer,
  CONTAINER_VERSION,
  decodeContainerText,
} from "../container/container";
import type { BattleRestrictions, SkirmishDraft } from "./drafts";

/** Payload schema version for a preset container. */
export const PRESET_KIND_VERSION = 1;

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
 * Canonicalize a value for stable structural comparison: object keys are sorted
 * recursively (so field/key order never affects the result) while arrays keep
 * their order (participant order and the disabled-unit list are meaningful).
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonical(obj[k])]),
    );
  }
  return value;
}

/**
 * A stable content key identifying the *battle* a draft launches, ignoring
 * session-volatile identity. Preset id/name/timestamps aren't part of the draft,
 * and each participant's `id` is dropped because it's a per-session counter
 * (`rl0`, `p3`, …) that differs every time the same encounter is synthesized —
 * keeping it would make an already-saved battle never match itself after a reload.
 * Absent restrictions normalize to `null` so a draft with none matches another
 * with none.
 */
function draftKey(draft: SkirmishDraft): string {
  const participants = draft.participants.map(({ id: _id, ...rest }) => rest);
  return JSON.stringify(
    canonical({
      participants,
      gameName: draft.gameName,
      mapName: draft.mapName,
      startPosType: draft.startPosType,
      modOptionValues: draft.modOptionValues,
      restrictions: draft.restrictions ?? null,
    }),
  );
}

/**
 * True when the saved-presets list already holds a preset capturing the same
 * battle as `draft`. Lets a battle surface show its "already saved" cue from the
 * durable presets store rather than transient component state, so the cue is
 * correct after leaving and re-entering the screen.
 */
export function presetMatchesDraft(
  presets: SkirmishPreset[],
  draft: SkirmishDraft,
): boolean {
  const key = draftKey(draft);
  return presets.some((p) => draftKey(p) === key);
}

/**
 * Parse the raw JSON of an imported preset file into a `SkirmishDraft` (plus its
 * original name), or `null` if the shape doesn't match. An imported file is
 * untrusted input, so validate the five draft fields before adopting it. Identity
 * and timestamps are intentionally dropped: the importer mints fresh ones via
 * `savePreset`, so importing never collides with an existing preset's id.
 *
 * Accepts BOTH the canonical coilbox container (issue #479, `kind: "preset"`)
 * and a legacy bare preset file (no envelope, exported before #479), so no
 * already-shared preset breaks. A newer-version container is rejected as `null`.
 * The pack importer also calls this on bare preset objects bundled inside a
 * pack, which stay unwrapped, so the bare path must keep working.
 */
export function parsePresetJson(
  json: string,
): (SkirmishDraft & { name?: string }) | null {
  const parsed = decodeContainerText(json);
  if (typeof parsed !== "object" || parsed === null) return null;

  let value: unknown = parsed;
  const container = asContainer(parsed);
  if (container) {
    if (container.kind !== "preset") return null;
    if (container.container > CONTAINER_VERSION) return null;
    if (container.kindVersion > PRESET_KIND_VERSION) return null;
    value = container.payload;
  }
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;
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
