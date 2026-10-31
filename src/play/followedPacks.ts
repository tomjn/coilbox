import { t } from "@lingui/core/macro";
import { useSetting } from "@picoframe/frame";
import { useEffect, useRef } from "react";
import { decodeContainerText } from "../container/container";
import { dlFetchPresetPack } from "../downloads/bindings";
import { describeError } from "../i18n/uiError";
import { updateStoredSetting } from "../lib/storedSetting";
import {
  decodeSetupPack,
  dedupePresetName,
  parseSetupPackManifest,
  type SetupPackManifest,
  type SetupPackPreset,
} from "../packs/manifest";
import { isTweakSlotKey } from "../workshop/deliveryRoutes";
import { draftKey, isStringMap, type SkirmishPreset } from "./presets";

/**
 * Preset packs a player follows by their address (issue #1298).
 *
 * They live under their own setting rather than in `play.presets`, and nothing
 * here writes to `play.presets`, so a refresh has no way to touch what a player
 * saved. A followed preset is a preset plus what is known about the player having
 * looked at it. The two are kept apart so an export or a copy carries only the
 * preset.
 *
 * A preset's tweak slots are Lua the game runs, and a refresh can change them.
 * `presetForBattle` is what the list hands out, so the slots of a version nobody
 * has opened are not there to apply. Opening records which version was opened.
 */
export const FOLLOWED_PACKS_KEY = "play.followedPacks";

export interface FollowedPreset {
  preset: SkirmishPreset;
  /** `draftKey` of this version, which is how a refresh sees a change. */
  contentKey: string;
  /** `contentKey` of the version the player last opened, or null if never. */
  seenKey: string | null;
  /** Changed or added by a refresh, and not opened since. */
  updated: boolean;
}

export interface FollowedPack {
  id: string;
  url: string;
  title: string;
  /** When a fetch last succeeded. */
  lastUpdatedAt: string;
  /** Why the last refresh failed, or null when it did not. */
  lastError: string | null;
  presets: FollowedPreset[];
}

/**
 * This version of the preset as a battle may take it: whole once it has been
 * opened, and without its tweak slots until then.
 */
export function presetForBattle(entry: FollowedPreset): SkirmishPreset {
  if (entry.seenKey === entry.contentKey) return entry.preset;
  return {
    ...entry.preset,
    modOptionValues: Object.fromEntries(
      Object.entries(entry.preset.modOptionValues).filter(
        ([key]) => !isTweakSlotKey(key),
      ),
    ),
  };
}

/**
 * A preset here came from the internet and is about to be held and loaded, so the
 * fields `parsePresetJson` takes on trust are checked as well.
 */
function isSoundPreset(preset: SetupPackPreset): boolean {
  return (
    isStringMap(preset.modOptionValues) &&
    preset.participants.every(isSoundParticipant)
  );
}

function isSoundParticipant(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const p = raw as Record<string, unknown>;
  const optionalNumber = (v: unknown) =>
    v === undefined || typeof v === "number";
  return (
    (p.kind === "you" || p.kind === "ai") &&
    typeof p.name === "string" &&
    typeof p.side === "string" &&
    typeof p.allyTeam === "number" &&
    Array.isArray(p.color) &&
    p.color.length === 3 &&
    p.color.every((c) => typeof c === "number") &&
    optionalNumber(p.handicap) &&
    optionalNumber(p.team) &&
    (p.ai === undefined || isSoundAi(p.ai))
  );
}

function isSoundAi(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const ai = raw as Record<string, unknown>;
  return (
    typeof ai.shortName === "string" &&
    (ai.kind === "native" || ai.kind === "lua") &&
    (ai.name === undefined || typeof ai.name === "string")
  );
}

function decodeManifest(text: string): SetupPackManifest | null {
  const coded = decodeSetupPack(text);
  if (coded.ok) return coded.settings;
  if (coded.error !== "unknown-format") return null;
  return parseSetupPackManifest(decodeContainerText(text));
}

export type PackReading =
  | { ok: true; title?: string; presets: SetupPackPreset[] }
  | { ok: false; message: string };

/**
 * Read what an address returned, as a bare manifest or as an exported pack. All
 * or nothing: one bad preset refuses the pack, so a refresh cannot quietly drop
 * part of a cached copy.
 */
export function readPack(text: string): PackReading {
  const manifest = decodeManifest(text);
  const presets = manifest?.presets ?? [];
  if (!manifest || !presets.every(isSoundPreset))
    return {
      ok: false,
      message: t`That address did not return a setup pack.`,
    };
  if (presets.length === 0)
    return { ok: false, message: t`That setup pack has no presets to follow.` };
  return { ok: true, title: manifest.title, presets };
}

/**
 * The presets a pack now holds, given what it held before. `previous` is null on
 * the first follow, where nothing is marked as updated because everything is new
 * to the player and they just asked for it.
 *
 * A manifest's presets have no ids, so a preset's name is what makes it the same
 * preset across refreshes, and a renamed one reads as one gone and one added.
 */
export function mergePresets(
  packId: string,
  incoming: readonly SetupPackPreset[],
  previous: readonly FollowedPreset[] | null,
  now: string,
): FollowedPreset[] {
  const names: string[] = [];
  return incoming.map((raw) => {
    const name = dedupePresetName(names, raw.name.trim());
    names.push(name);
    const id = `${packId}/${name}`;
    const before = previous?.find((entry) => entry.preset.id === id);
    const contentKey = draftKey(raw);
    if (before?.contentKey === contentKey) return before;
    const { name: _name, ...draft } = raw;
    return {
      preset: {
        ...draft,
        id,
        name,
        createdAt: before?.preset.createdAt ?? now,
        lastUsedAt: before?.preset.lastUsedAt ?? now,
      },
      contentKey,
      seenKey: before?.seenKey ?? null,
      updated: previous !== null,
    };
  });
}

/** A pack's list after one refresh answered, which only ever touches that pack. */
export function applyRefresh(
  packs: FollowedPack[],
  packId: string,
  reading: PackReading,
  now: string,
): FollowedPack[] {
  return packs.map((pack) => {
    if (pack.id !== packId) return pack;
    if (!reading.ok) return { ...pack, lastError: reading.message };
    return {
      ...pack,
      title: reading.title ?? pack.title,
      lastUpdatedAt: now,
      lastError: null,
      presets: mergePresets(pack.id, reading.presets, pack.presets, now),
    };
  });
}

/** The list after the player opened one version of one preset. */
export function applySeen(
  packs: FollowedPack[],
  packId: string,
  presetId: string,
  contentKey: string,
): FollowedPack[] {
  return packs.map((pack) => {
    if (pack.id !== packId) return pack;
    return {
      ...pack,
      presets: pack.presets.map((entry) => {
        if (entry.preset.id !== presetId) return entry;
        // A refresh that landed while the panel was opening keeps its mark,
        // because what was opened is not what is now stored.
        if (entry.contentKey !== contentKey) return entry;
        return { ...entry, seenKey: contentKey, updated: false };
      }),
    };
  });
}

async function fetchPack(url: string): Promise<PackReading> {
  try {
    const { text } = await dlFetchPresetPack({ url });
    return readPack(text);
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}

/** What to call a pack whose manifest has no title. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The refresh under way, shared by everything that asks for one. The start refresh
 * can overlap the button, and two at once could let the older answer land last and
 * replace the newer presets.
 */
let refreshing: Promise<void> | null = null;

export function useFollowedPacks() {
  const [packs, setPacks] = useSetting<FollowedPack[]>(FOLLOWED_PACKS_KEY, []);

  // Folds over the stored list, because every answer here arrives after a wait
  // and the render's `packs` is out of date by then.
  const write = (change: (prev: FollowedPack[]) => FollowedPack[]) =>
    updateStoredSetting<FollowedPack[]>(
      FOLLOWED_PACKS_KEY,
      [],
      setPacks,
      change,
    );

  /** Follow the pack at `url`, answering why not when it cannot be followed. */
  async function follow(rawUrl: string): Promise<string | null> {
    const url = rawUrl.trim();
    const already = t`You already follow that pack.`;
    if (packs.some((pack) => pack.url === url)) return already;
    const reading = await fetchPack(url);
    if (!reading.ok) return reading.message;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pack: FollowedPack = {
      id,
      url,
      title: reading.title ?? hostOf(url),
      lastUpdatedAt: now,
      lastError: null,
      presets: mergePresets(id, reading.presets, null, now),
    };
    write((prev) => (prev.some((p) => p.url === url) ? prev : [...prev, pack]));
    return null;
  }

  /** Refresh every pack. A failed one keeps its cached copy and says why. */
  function refreshAll(): Promise<void> {
    refreshing ??= Promise.all(
      packs.map(async (pack) => {
        const reading = await fetchPack(pack.url);
        const now = new Date().toISOString();
        write((prev) => applyRefresh(prev, pack.id, reading, now));
      }),
    )
      .then(() => {})
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  /** Drop a pack and its presets. Copies a player saved are in `play.presets`. */
  function unfollow(packId: string) {
    write((prev) => prev.filter((pack) => pack.id !== packId));
  }

  function markSeen(packId: string, presetId: string, contentKey: string) {
    write((prev) => applySeen(prev, packId, presetId, contentKey));
  }

  return { packs, follow, refreshAll, unfollow, markSeen };
}

/**
 * Refreshes followed packs once when the app starts, whichever page it opens on.
 * Renders nothing. Its own component, so a stored pack changing does not re-render
 * the provider beside it.
 */
export function FollowedPacksStartRefresh() {
  const { packs, refreshAll } = useFollowedPacks();
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref guard is what keeps this to one run, and `refreshAll` is rebuilt every render
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (packs.length > 0) void refreshAll();
  }, []);
  return null;
}
