import { asContainer } from "../container/container";
import type { SkirmishDraft } from "../play/drafts";
import {
  type Difficulty,
  parseScenario,
  parseSetup,
  type Scenario,
} from "../scenario/model";

/**
 * Campaign schema — the single source of truth for the shape of a campaign
 * document. Rust stores these as opaque JSON, so this file (and
 * {@link parseCampaignJson}) is the only place the shape is defined and validated.
 *
 * A campaign is an authored sequence of skirmish missions. Each mission carries a
 * *snapshot* of a full skirmish setup (copied from a preset at attach time) so the
 * campaign plays identically regardless of later preset edits. A mission may
 * also carry a scenario, snapshotted on exactly the same terms, which is what
 * the mission runtime plays once the engine is up.
 */

/**
 * How a stored media file (image, audio or video) is referenced:
 *
 * - `local` — a path relative to the portable `.coilbox/` folder, served straight to
 *   the webview by the `coilbox://` protocol. The way a *distribution* bundles media
 *   (including audio/video, which can't be a data URI). Only resolves in portable mode.
 * - `file` — a bare filename under the campaign's own app-data folder (`images/<id>/`
 *   for re-encoded images, `media/<id>/` for verbatim AV, picked by extension). How a
 *   *user-authored* campaign stores imported media; works on any install.
 * - `data` — a base64 `data:` URI inlined into the campaign JSON so an exported
 *   campaign travels in a single file. Images only (AV is far too large to inline).
 *
 * Used for every campaign image — panoramas, icons, backgrounds, side graphics — and,
 * via {@link MediaRef}, for mission audio/video.
 */
export type ImageRef =
  | { kind: "local"; path: string }
  | { kind: "file"; file: string }
  | { kind: "data"; dataUri: string };

/**
 * A reference to any campaign media (image, audio or video). Structurally identical
 * to {@link ImageRef} — the alias just documents intent at audio/video fields, which
 * in practice only use `local` (bundled) or `file` (user-imported AV).
 */
export type MediaRef = ImageRef;

/** @deprecated Use {@link ImageRef}; kept so existing panorama imports still type. */
export type PanoramaRef = ImageRef;

/**
 * Author playback config for a media slot. All fields optional; an absent field
 * falls back to a per-slot default at render time (decorative loops autoplay muted;
 * cues start paused and audible), so a campaign with no playback field renders
 * exactly as before this feature. Stored as a sibling of the media ref it configures
 * (mirroring `panoramaMap`/`sideGraphicMap`), so it survives export/import untouched.
 *
 * - `autoplay` / `loop` / `muted` — video and audio. `muted` is the *initial*
 *   mute-button state; the viewer can toggle it. Unmuted autoplay is never attempted
 *   (browsers block it), so an autoplay decorative slot is always muted.
 * - `scroll` — image panorama only: horizontally scroll the backdrop (true) or hold
 *   it static and full-bleed (false). A no-op for video or non-panorama slots.
 *
 * Custom pause/play + mute/unmute controls are always rendered, so there is
 * deliberately no stored `controls` toggle.
 */
export interface MediaPlayback {
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  scroll?: boolean;
}

/** Render style for a live map-preview slot. */
export type MapPreviewStyle = "textured" | "heightmap";

/**
 * Per-slot live map-preview configuration. When present on a mission's
 * `panoramaMap` / `sideGraphicMap`, that slot renders the mission's map as a
 * spinning 3D preview instead of its still image. The map itself is always the
 * mission `snapshot.mapName`.
 */
export interface MapPreviewConfig {
  style: MapPreviewStyle;
  /** Auto-orbit speed multiplier (1 = default). Clamped to 0.25–4 on read. */
  spinSpeed?: number;
  /** Show the water plane. Undefined = fall back to the map's own water heuristic. */
  water?: boolean;
}

/**
 * Per-slot spinning-unit configuration. When present on a mission's
 * `panoramaUnit` / `sideGraphicUnit`, that slot renders one of the game's units
 * as a slowly turning 3D model instead of its still image, so a briefing can
 * show the unit the mission is about. The game is always the mission's
 * `snapshot.gameName`, the way the map preview always uses `snapshot.mapName`.
 */
export interface UnitPreviewConfig {
  /** The unit's internal def name, as the game's unit dataset lists it. */
  unitDef: string;
  /** Auto-orbit speed multiplier (1 = default, negative = reversed). Clamped to
   *  0.25–4 on read. */
  spinSpeed?: number;
}

/**
 * Optional author override for downloading a mission's map through the install
 * gate. Absent = best-effort by `snapshot.mapName` (works for most rapid /
 * springfiles / BAR maps); set these when the map's springname or search URL
 * differs from its name.
 */
export interface MapDownloadHint {
  springName?: string;
  searchUrl?: string;
}

export interface CampaignMission {
  /** UUID — a stable node id, so a future DAG progression can reference missions. */
  id: string;
  title: string;
  /** Location line shown under the title on the briefing screen. */
  subtitle?: string;
  briefing: string;
  objectives: string[];
  /** Scrolling briefing backdrop — a still image or a looping muted video. */
  panorama?: ImageRef;
  /** Playback config for `panorama` (scroll for images; autoplay/loop/muted for video). */
  panoramaPlayback?: MediaPlayback;
  /** Graphic beside the mission briefing card — a still image or a looping muted video. */
  sideGraphic?: ImageRef;
  /** Playback config for `sideGraphic` when it's a video. */
  sideGraphicPlayback?: MediaPlayback;
  /** Optional briefing voiceover (audio) played on the briefing screen. */
  voiceover?: MediaRef;
  /** Playback config for `voiceover` (loop/muted; autoplay is muted-only). */
  voiceoverPlayback?: MediaPlayback;
  /** Optional intro cutscene (video) offered on the briefing screen. */
  cutscene?: MediaRef;
  /** Playback config for `cutscene`. */
  cutscenePlayback?: MediaPlayback;
  /** When set, the panorama slot renders a live 3D map preview instead of `panorama`. */
  panoramaMap?: MapPreviewConfig;
  /** When set, the side-graphic slot renders a live 3D map preview instead of `sideGraphic`. */
  sideGraphicMap?: MapPreviewConfig;
  /**
   * When set, the panorama slot renders a spinning 3D unit instead of `panorama`.
   * Never set alongside `panoramaMap`: a slot has one source.
   */
  panoramaUnit?: UnitPreviewConfig;
  /** When set, the side-graphic slot renders a spinning 3D unit instead of `sideGraphic`. */
  sideGraphicUnit?: UnitPreviewConfig;
  /** Optional install-gate download override for the mission's map. */
  mapDownload?: MapDownloadHint;
  /**
   * A full skirmish setup copied from a preset when the mission was attached. It is
   * a snapshot, never a live reference — editing the source preset never changes an
   * already-attached mission.
   */
  snapshot: SkirmishDraft;
  /**
   * A whole scenario document copied in when it was attached, on the same terms
   * as `snapshot`: a copy, never a live reference, so editing the source
   * scenario never changes an already-attached mission. Absent on a
   * preset-only mission, which plays as an ordinary skirmish.
   *
   * The mission keeps only out-of-engine presentation. Everything the runtime
   * plays (spawns, zones, triggers, objectives, dialogue) is in here.
   */
  scenario?: Scenario;
  /** Internal unit names to forbid, applied as `[RESTRICT] Limit=0` at launch. */
  disabledUnits: string[];
  /** Playable even if the previous mission is incomplete. */
  skippable: boolean;
}

export interface Campaign {
  schemaVersion: 1;
  id: string;
  type: "ta";
  title: string;
  description: string;
  /** Author accent colour (`H S% L%` HSL triple, like the theme tokens),
   * applied as a scoped `--primary` on the campaign's own pages. */
  accent?: string;
  /** Small emblem shown on the campaign in lists. */
  icon?: ImageRef;
  /** Still backdrop shown behind the campaign detail page — image or looping video. */
  background?: ImageRef;
  /** Playback config for `background` when it's a video. */
  backgroundPlayback?: MediaPlayback;
  /** Array order IS the linear play order. */
  missions: CampaignMission[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignProgress {
  completedMissionIds: string[];
  lastPlayedMissionId?: string;
  /**
   * How hard this run of the campaign is being played (issue #2220).
   *
   * On the run rather than on the mission because a campaign is one playthrough:
   * the player picks a difficulty once and every mission after it is played at
   * that level, which is what a campaign author means by "hard" and what a
   * player means when they say a campaign was too hard. It sits in progress
   * rather than in the campaign document so a bundled, read-only campaign can
   * still be played at a level of the player's choosing.
   *
   * Absent means nobody chose, which is every run recorded before this existed.
   * The launch then says nothing about difficulty and the runtime plays at its
   * own default, exactly as those runs already did.
   */
  difficulty?: Difficulty;
  updatedAt: string;
}

export interface ProgressFile {
  schemaVersion: 1;
  /** Keyed by campaign id. */
  campaigns: Record<string, CampaignProgress>;
}

/** The on-disk / shared shape produced by export and consumed by import. */
export interface CampaignExportFile {
  format: "coilbox-campaign";
  formatVersion: 1;
  campaign: Campaign;
}

/** Narrow an unknown to a {@link MediaRef}, or drop it (returns undefined). */
export function parseImageRef(value: unknown): MediaRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (p.kind === "local" && typeof p.path === "string") {
    return { kind: "local", path: p.path };
  }
  if (p.kind === "file" && typeof p.file === "string") {
    return { kind: "file", file: p.file };
  }
  if (p.kind === "data" && typeof p.dataUri === "string") {
    return { kind: "data", dataUri: p.dataUri };
  }
  return undefined;
}

/**
 * Narrow an unknown to a {@link MediaPlayback}, or drop it (returns undefined).
 * Only known boolean keys are kept, and undefined keys are *omitted* (not set to
 * `undefined`) so a render-side `playback.autoplay ?? default` never sees an
 * explicit undefined overwriting the default.
 */
function parsePlayback(value: unknown): MediaPlayback | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  const out: MediaPlayback = {};
  if (typeof p.autoplay === "boolean") out.autoplay = p.autoplay;
  if (typeof p.loop === "boolean") out.loop = p.loop;
  if (typeof p.muted === "boolean") out.muted = p.muted;
  if (typeof p.scroll === "boolean") out.scroll = p.scroll;
  return Object.keys(out).length ? out : undefined;
}

/** Narrow an unknown to a {@link MapPreviewConfig}, or drop it (returns undefined). */
function parseMapPreview(value: unknown): MapPreviewConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (p.style !== "textured" && p.style !== "heightmap") return undefined;
  return {
    style: p.style,
    spinSpeed: typeof p.spinSpeed === "number" ? p.spinSpeed : undefined,
    water: typeof p.water === "boolean" ? p.water : undefined,
  };
}

/**
 * Narrow an unknown to a {@link UnitPreviewConfig}, or drop it (returns
 * undefined). A config naming no unit is dropped: the editor holds that state
 * while an author is still picking, but there is nothing to draw for it, so it
 * is not worth storing.
 *
 * A campaign that carries one of these still exports at the plain container
 * version (`transfer.ts`). An older build drops the field and renders the slot's
 * image, or the gradient, which is what this campaign looked like before the
 * author set a unit: a cosmetic loss, not a mission that plays differently.
 */
function parseUnitPreview(value: unknown): UnitPreviewConfig | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (typeof p.unitDef !== "string" || p.unitDef.trim() === "")
    return undefined;
  return {
    unitDef: p.unitDef,
    spinSpeed: typeof p.spinSpeed === "number" ? p.spinSpeed : undefined,
  };
}

/** Narrow an unknown to a {@link MapDownloadHint}, or drop it (returns undefined). */
export function parseMapDownload(value: unknown): MapDownloadHint | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  const springName =
    typeof p.springName === "string" ? p.springName : undefined;
  const searchUrl = typeof p.searchUrl === "string" ? p.searchUrl : undefined;
  if (!springName && !searchUrl) return undefined;
  return { springName, searchUrl };
}

/** Coerce an unknown into a string array, dropping non-string members. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Parse the raw JSON of a stored or imported campaign into a validated
 * {@link Campaign}, or `null` if the shape doesn't match. This is the single
 * untrusted-input validator (a bundled or imported campaign is untrusted) and the
 * future schema-migration point. Missing optional fields are normalized to
 * defaults (objectives → [], disabledUnits → [], skippable → false). A document
 * is rejected outright if a mission lacks a snapshot, its snapshot has no
 * `mapName` or `gameName` string (see `parseSetup`, issue #2473), or the ids
 * aren't unique.
 */
export function parseCampaignJson(json: string): Campaign | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  let d = data as Record<string, unknown>;

  // Accept the canonical coilbox container (issue #479), so a bundled campaign
  // can be the exact file the builder exported, dropped into
  // `.coilbox/campaigns/` as-is.
  const container = asContainer(d);
  if (
    container &&
    container.kind === "campaign" &&
    typeof container.payload === "object" &&
    container.payload !== null
  ) {
    d = container.payload as Record<string, unknown>;
    // An export carrying scenario media puts the document under `campaign`
    // beside the clips (`transfer.ts`, kindVersion 2), so unwrap that too. A
    // campaign document has no `campaign` field of its own, so this is
    // unambiguous.
    if (typeof d.campaign === "object" && d.campaign !== null) {
      d = d.campaign as Record<string, unknown>;
    }
  } else if (
    // Also accept the legacy export/share wrapper (`CampaignExportFile`).
    d.format === "coilbox-campaign" &&
    typeof d.campaign === "object" &&
    d.campaign !== null
  ) {
    d = d.campaign as Record<string, unknown>;
  }

  if (
    d.type !== "ta" ||
    typeof d.id !== "string" ||
    typeof d.title !== "string" ||
    !Array.isArray(d.missions)
  ) {
    return null;
  }

  const missions: CampaignMission[] = [];
  const seen = new Set<string>();
  for (const raw of d.missions) {
    if (typeof raw !== "object" || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string" || m.id === "" || seen.has(m.id)) return null;
    if (typeof m.title !== "string") return null;
    // The snapshot is the launch payload. A mission without one is unplayable.
    // run.ts reads snapshot.mapName and snapshot.gameName as plain strings to
    // look up the map and game before launch, so parseSetup rejects the whole
    // campaign when either is missing or the wrong type, the same failure
    // parseScenario reports for its own setup block (issue #2473).
    if (
      typeof m.snapshot !== "object" ||
      m.snapshot === null ||
      Array.isArray(m.snapshot)
    ) {
      return null;
    }
    const snapshot = parseSetup(m.snapshot as Record<string, unknown>);
    if (!snapshot) return null;
    // An attached scenario is optional, but a *present* one that will not parse
    // rejects the campaign rather than being dropped. Dropping it would leave a
    // mission that still launches and quietly plays as a plain skirmish, with
    // none of the triggers the author wrote.
    let scenario: Scenario | undefined;
    if (m.scenario !== undefined && m.scenario !== null) {
      const parsed = parseScenario(m.scenario);
      if (!parsed) return null;
      scenario = parsed;
    }
    seen.add(m.id);
    // A slot has one source, so a hand-edited document that sets both keeps the
    // map preview and drops the unit. Everything downstream can then test the
    // two in any order.
    const panoramaMap = parseMapPreview(m.panoramaMap);
    const sideGraphicMap = parseMapPreview(m.sideGraphicMap);
    missions.push({
      id: m.id,
      title: m.title,
      subtitle: typeof m.subtitle === "string" ? m.subtitle : undefined,
      briefing: typeof m.briefing === "string" ? m.briefing : "",
      objectives: stringArray(m.objectives),
      panorama: parseImageRef(m.panorama),
      panoramaPlayback: parsePlayback(m.panoramaPlayback),
      sideGraphic: parseImageRef(m.sideGraphic),
      sideGraphicPlayback: parsePlayback(m.sideGraphicPlayback),
      voiceover: parseImageRef(m.voiceover),
      voiceoverPlayback: parsePlayback(m.voiceoverPlayback),
      cutscene: parseImageRef(m.cutscene),
      cutscenePlayback: parsePlayback(m.cutscenePlayback),
      panoramaMap,
      sideGraphicMap,
      panoramaUnit: panoramaMap ? undefined : parseUnitPreview(m.panoramaUnit),
      sideGraphicUnit: sideGraphicMap
        ? undefined
        : parseUnitPreview(m.sideGraphicUnit),
      mapDownload: parseMapDownload(m.mapDownload),
      snapshot,
      scenario,
      disabledUnits: stringArray(m.disabledUnits),
      skippable: m.skippable === true,
    });
  }

  return {
    schemaVersion: 1,
    id: d.id,
    type: "ta",
    title: d.title,
    description: typeof d.description === "string" ? d.description : "",
    accent:
      typeof d.accent === "string" && d.accent !== "" ? d.accent : undefined,
    icon: parseImageRef(d.icon),
    background: parseImageRef(d.background),
    backgroundPlayback: parsePlayback(d.backgroundPlayback),
    missions,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  };
}
