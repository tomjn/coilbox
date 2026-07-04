import type { SkirmishDraft } from "../play/drafts";

/**
 * Campaign schema — the single source of truth for the shape of a campaign
 * document. Rust stores these as opaque JSON, so this file (and
 * {@link parseCampaignJson}) is the only place the shape is defined and validated.
 *
 * A campaign is an authored sequence of skirmish missions. Each mission carries a
 * *snapshot* of a full skirmish setup (copied from a preset at attach time) so the
 * campaign plays identically regardless of later preset edits.
 */

/**
 * How a mission's briefing panorama is referenced. Locally-authored campaigns hold
 * a `file` (a bare filename under the campaign's image folder, materialized by the
 * campaign plugin); an exported campaign inlines the image as a base64 `data` URI
 * so it travels in a single file.
 */
export type PanoramaRef =
  | { kind: "file"; file: string }
  | { kind: "data"; dataUri: string };

export interface CampaignMission {
  /** UUID — a stable node id, so a future DAG progression can reference missions. */
  id: string;
  title: string;
  /** Location line shown under the title on the briefing screen. */
  subtitle?: string;
  briefing: string;
  objectives: string[];
  panorama?: PanoramaRef;
  /**
   * A full skirmish setup copied from a preset when the mission was attached. It is
   * a snapshot, never a live reference — editing the source preset never changes an
   * already-attached mission.
   */
  snapshot: SkirmishDraft;
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
  /** Array order IS the linear play order. */
  missions: CampaignMission[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignProgress {
  completedMissionIds: string[];
  lastPlayedMissionId?: string;
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

/** Narrow an unknown to a `PanoramaRef`, or drop it (returns undefined). */
function parsePanorama(value: unknown): PanoramaRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (p.kind === "file" && typeof p.file === "string") {
    return { kind: "file", file: p.file };
  }
  if (p.kind === "data" && typeof p.dataUri === "string") {
    return { kind: "data", dataUri: p.dataUri };
  }
  return undefined;
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
 * defaults (objectives → [], disabledUnits → [], skippable → false); a document is
 * rejected outright if a mission lacks a snapshot or the ids aren't unique.
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

  // Also accept the export/share wrapper (`CampaignExportFile`), so a bundled
  // campaign can be the exact file the builder exported, dropped into
  // `.coilbox/campaigns/` as-is.
  if (
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
    // The snapshot is the launch payload; a mission without one is unplayable.
    if (typeof m.snapshot !== "object" || m.snapshot === null) return null;
    seen.add(m.id);
    missions.push({
      id: m.id,
      title: m.title,
      subtitle: typeof m.subtitle === "string" ? m.subtitle : undefined,
      briefing: typeof m.briefing === "string" ? m.briefing : "",
      objectives: stringArray(m.objectives),
      panorama: parsePanorama(m.panorama),
      snapshot: m.snapshot as SkirmishDraft,
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
    missions,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  };
}
