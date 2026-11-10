/**
 * Scanning every unit of a game for a body plan, so the skeleton widget labels
 * units nobody opened in the builder (#5186).
 *
 * Each unit goes through what the builder does for one open unit: its script is
 * asked what its pieces are for (`inferRoles`), and a plan is proposed from the
 * answer (`proposePlan`). A unit with a plan goes into the game's skeleton file
 * marked `observed`, which never replaces a `built` or `fitted` entry
 * (`mergeSkeleton`).
 *
 * The reading is passed in, so the loop and the judging are testable without
 * unitsync or the script sandbox. `skeletonScanRead.ts` is the real reader.
 *
 * No unit can hang the scan. Every step that could run long already has a
 * bound where it runs: the script sandbox abandons a frame past its instruction
 * budget, and the unitsync worker is killed past its timeout. A stop is
 * answered at once, without waiting for the unit in hand.
 */

import type { UnitDatasetEntry } from "@/content/bindings";
import { roleLabel } from "./animPresets";
import { withGroups } from "./describedPlan";
import { fitPlan, planBones } from "./fitPlan";
import { gameModelRows } from "./gameModels";
import type { RoleFindings } from "./inferRoles";
import type { LegoProject } from "./model";
import { proposePlan } from "./proposePlan";
import { type SkeletonUnitEntry, unitSkeletonEntry } from "./skeletonFile";

/** A unit to scan, as the game's unit list and archive name it. */
export interface ScanUnit {
  /** The unitdef's name, which the skeleton file is keyed by. */
  unit: string;
  /** What the list calls it: the unit's human name, or its unitdef name. */
  label: string;
  /** The model's path in the archive, or null when the archive has none the
   *  builder can read. */
  member: string | null;
}

/** A unit read for scanning: its pieces, and its script as Lua. */
export interface UnitRead {
  /** The model's pieces, with the unit's definition on `gameUnitDef`. */
  project: LegoProject;
  /** Null for a unit with no script to ask, with the reason in `notes`. */
  script: string | null;
  notes: string[];
}

export interface ScanDeps {
  read(unit: ScanUnit): Promise<UnitRead>;
  infer(project: LegoProject, script: string): Promise<RoleFindings>;
}

/**
 * How much of a plan a unit got. `full` is a plan with a piece for every bone,
 * `partial` a plan with some bones left for the game maker to pick, and `none`
 * no plan at all.
 */
export type ScanOutcome = "full" | "partial" | "none";

export interface UnitScan {
  unit: string;
  label: string;
  member: string | null;
  outcome: ScanOutcome;
  /** The plan's name, or null for no plan. */
  plan: string | null;
  /** The plan's bones no piece was found for, by their label. */
  missing: string[];
  /** The first thing the reading or the proposal said, as the reason. */
  note: string | null;
  /** What goes into the skeleton file, or null for nothing. */
  entry: SkeletonUnitEntry | null;
}

/**
 * Judge a proposal for one unit. The plan's root bone is not counted as
 * missing when the unit's root piece already stands for another bone, because
 * `proposePlan` leaves it unpicked on purpose then: the body is the root.
 */
export function judgeUnit(
  unit: ScanUnit,
  project: LegoProject,
  findings: RoleFindings,
): UnitScan {
  const proposal = proposePlan(project, findings);
  const note = proposal.notes[0] ?? null;
  const none: UnitScan = {
    ...unit,
    outcome: "none",
    plan: null,
    missing: [],
    note,
    entry: null,
  };
  if (!proposal.base) return none;

  const plan = withGroups(proposal.base, proposal.groups);
  const fitted = fitPlan(project, plan, proposal.counts, proposal.picks);
  const fittedEntry = unitSkeletonEntry(fitted.project);
  if (!fittedEntry) return none;

  const rootTaken = Object.values(proposal.picks).includes(project.rootPieceId);
  const missing = planBones(plan, proposal.counts)
    .filter((bone) => !(bone.id in proposal.picks))
    .filter((bone) => !(bone.parent === null && rootTaken))
    .map((bone) => (bone.role ? roleLabel(bone.role) : bone.name));
  return {
    ...unit,
    outcome: missing.length === 0 ? "full" : "partial",
    plan: proposal.base.label,
    missing,
    note,
    entry: { ...fittedEntry, evidence: "observed" },
  };
}

/** Read one unit, ask its script and judge the answer. Never throws: a unit
 *  that cannot be read is a unit with no plan, with the reason. */
export async function scanUnit(
  unit: ScanUnit,
  deps: ScanDeps,
): Promise<UnitScan> {
  const nothing = (note: string): UnitScan => ({
    ...unit,
    outcome: "none",
    plan: null,
    missing: [],
    note,
    entry: null,
  });
  try {
    const read = await deps.read(unit);
    if (read.script === null) {
      return nothing(read.notes[0] ?? "");
    }
    const findings = await deps.infer(read.project, read.script);
    return judgeUnit(unit, read.project, {
      ...findings,
      notes: [...read.notes, ...findings.notes],
    });
  } catch (error) {
    return nothing(error instanceof Error ? error.message : String(error));
  }
}

/** Resolves when `signal` aborts, so a wait can be cut short by a stop. */
function aborted(signal: AbortSignal): Promise<"stopped"> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve("stopped");
    else signal.addEventListener("abort", () => resolve("stopped"));
  });
}

/**
 * Scan `units` one at a time, reporting each as it is done. Stops at once when
 * `signal` aborts, leaving the unit in hand to finish unheard. Returns the
 * units scanned, which is all of them unless it was stopped.
 */
export async function runSkeletonScan(
  units: readonly ScanUnit[],
  deps: ScanDeps,
  options: {
    signal: AbortSignal;
    onUnit?: (scan: UnitScan, done: number) => void;
  },
): Promise<UnitScan[]> {
  const { signal } = options;
  const stop = aborted(signal);
  const out: UnitScan[] = [];
  for (const unit of units) {
    if (signal.aborted) break;
    const scan = await Promise.race([scanUnit(unit, deps), stop]);
    if (scan === "stopped") break;
    out.push(scan);
    options.onUnit?.(scan, out.length);
  }
  return out;
}

/**
 * Every unit of a game, in the dataset's order, with the model the archive
 * holds for it. A unit whose model is missing or unreadable is still listed,
 * with no member, so it shows as having no plan rather than vanishing.
 */
export function unitsToScan(input: {
  files: { path: string }[];
  units: UnitDatasetEntry[];
  archive: string;
  archivePath?: string;
}): ScanUnit[] {
  const { rows } = gameModelRows({ ...input, projects: [] });
  const members = new Map<string, string>();
  for (const row of rows) {
    if (row.unit && !members.has(row.unit)) members.set(row.unit, row.member);
  }
  return input.units.map((unit) => ({
    unit: unit.name,
    label: unit.fullName?.trim() || unit.name,
    member: members.get(unit.name) ?? null,
  }));
}

/** How many units got each outcome. */
export function countOutcomes(
  scans: readonly UnitScan[],
): Record<ScanOutcome, number> {
  const counts = { full: 0, partial: 0, none: 0 };
  for (const scan of scans) counts[scan.outcome] += 1;
  return counts;
}

/** The skeleton file entries of the units that got a plan, by unit name. */
export function scanEntries(
  scans: readonly UnitScan[],
): Record<string, SkeletonUnitEntry> {
  const entries: Record<string, SkeletonUnitEntry> = {};
  for (const scan of scans) {
    if (scan.entry) entries[scan.unit] = scan.entry;
  }
  return entries;
}
