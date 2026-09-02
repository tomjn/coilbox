/**
 * The mission editor's four groups: which of them is open, and what each one
 * says it is holding while it is shut (issue #2261).
 *
 * The drawer used to be one flat scroll of eleven sections doing three
 * different jobs, every header the same size, and the three sections most
 * missions never use taking full height whether or not anything was in them.
 * Grouping them by job is only half the fix. The other half is that a shut
 * group has to answer the question the flat scroll answered by scrolling: is
 * anything set in there? So every summary here names what is set, and says so
 * plainly when nothing is.
 *
 * The summaries read the mission and nothing else. That is deliberate: the
 * scenario field and the unit picker both reach for a unitsync scan, which
 * costs 23 seconds on a cold archive cache (issue #2265), and a summary that
 * needed one would put that cost back on the drawer whether or not the group
 * it describes was ever opened. The one fact that cannot be read off the
 * mission alone, whether its scenario copy has fallen behind, is answered
 * beside the heading instead, from a list the drawer is handed rather than one
 * it reads (issue #2392).
 *
 * Which groups are open is remembered the way the campaign page remembers its
 * Presentation disclosure: in `localStorage`, under one key that covers every
 * mission in every campaign. Wanting the media pickers open is a fact about how
 * somebody works rather than about the mission they happen to have open, and
 * writing it into the document would stamp `updatedAt` for a click that changed
 * nothing.
 */

import { useRef, useState } from "react";
import { scenarioContents } from "@/scenario/listing";
import { refIsVideo } from "../../../lib/assetUrl";
import type { CampaignMission } from "../../model";

/** The four jobs the drawer's fields split into. */
export type MissionGroupKey = "content" | "scenario" | "presentation" | "rules";

/**
 * Which groups an author who has never touched one sees open.
 *
 * Content only. It is the mission: the title, what the briefing says and what
 * the player is being asked to do. The other three are set once and then left,
 * and every one of them mounts something that scans the installed games, so
 * starting them shut is also what keeps opening a mission cheap.
 */
export const DEFAULT_OPEN: Record<MissionGroupKey, boolean> = {
  content: true,
  scenario: false,
  presentation: false,
  rules: false,
};

const KEY = "coilbox.mission.editorGroups";

/** Read a stored map of open groups, ignoring anything that is not one. */
export function storedGroups(
  raw: string | null,
): Partial<Record<MissionGroupKey, boolean>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<MissionGroupKey, boolean>> = {};
    for (const key of Object.keys(DEFAULT_OPEN) as MissionGroupKey[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Which groups are open, and a setter that remembers the answer. */
export function useMissionGroups(): [
  Record<MissionGroupKey, boolean>,
  (key: MissionGroupKey, open: boolean) => void,
] {
  const [open, setOpen] = useState<Record<MissionGroupKey, boolean>>(() => {
    try {
      return { ...DEFAULT_OPEN, ...storedGroups(localStorage.getItem(KEY)) };
    } catch {
      // Storage unavailable (private mode / quota). The choice still applies,
      // it just lasts for the session.
      return { ...DEFAULT_OPEN };
    }
  });

  // The answer as it stands, which is ahead of `open` for a second toggle in
  // the same tick. Building the next map from this render's copy instead lost
  // every toggle but the last.
  const latest = useRef(open);
  latest.current = open;

  return [
    open,
    (key, next) => {
      const all = { ...latest.current, [key]: next };
      latest.current = all;
      setOpen(all);
      try {
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {}
    },
  ];
}

/** "3 objectives", "1 objective", "0 objectives". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * What the mission itself says: whether there is a briefing, how many
 * objectives, and whether it can be skipped.
 *
 * Content is the group that opens by default, so this line is mostly read while
 * the fields it describes are on screen. It is still worth having: it is the
 * one place the three facts are said together, and somebody who shuts Content
 * to get at the media below it does not lose them.
 */
export function contentSummary(mission: CampaignMission): string {
  const parts = [
    mission.briefing.trim() ? "briefing written" : "no briefing",
    count(mission.objectives.length, "objective"),
  ];
  if (mission.skippable) parts.push("skippable");
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", ");
}

/**
 * The attached scenario by name, with what is in it.
 *
 * Whether the copy has fallen behind the stored scenario is the other thing
 * worth knowing here, and it is not said in this line, because answering it
 * means reading every stored scenario and that reads the content scan. The
 * drawer puts an amber badge beside the heading instead, from the list the
 * campaign page had already read (issue #2392).
 */
export function scenarioSummary(mission: CampaignMission): string {
  const scenario = mission.scenario;
  if (!scenario) return "No scenario attached";
  // The same counts the attached-scenario block and the scenario picker say,
  // so the shut group and the open one describe it the same way.
  return `${scenario.name} · ${scenarioContents(scenario)}`;
}

/** How a slot's source reads in a summary line, or nothing when it is unset. */
function slotSummary(
  mission: CampaignMission,
  slot: "panorama" | "sideGraphic",
): string | null {
  const noun = slot === "panorama" ? "panorama" : "side graphic";
  if (mission[slot === "panorama" ? "panoramaMap" : "sideGraphicMap"]) {
    return `map ${noun}`;
  }
  const unit =
    mission[slot === "panorama" ? "panoramaUnit" : "sideGraphicUnit"];
  if (unit) return `${unit.unitDef || "unit"} ${noun}`;
  const ref = mission[slot];
  if (!ref) return null;
  return `${noun} ${refIsVideo(ref) ? "video" : "image"}`;
}

/**
 * What the briefing screen will actually show.
 *
 * Naming the source rather than the slot, because "panorama set" leaves an
 * author who has to know whether it is the map, a unit or an imported image
 * opening the group to find out, which is the scrolling this was meant to
 * replace.
 */
export function presentationSummary(mission: CampaignMission): string {
  const set = [
    slotSummary(mission, "panorama"),
    slotSummary(mission, "sideGraphic"),
    mission.voiceover ? "voiceover" : null,
    mission.cutscene ? "cutscene" : null,
  ].filter((s): s is string => s !== null);
  if (set.length === 0) {
    return "No panorama, side graphic, voiceover or cutscene";
  }
  const [first, ...rest] = set;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", ");
}

/** How many units the mission bans, which is all this group holds. */
export function rulesSummary(mission: CampaignMission): string {
  const banned = mission.disabledUnits.length;
  if (banned === 0) return "No restrictions";
  return `${count(banned, "unit")} banned`;
}
