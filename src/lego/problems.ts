import { t } from "@lingui/core/macro";
/**
 * The builder's problems list: one record for each thing a check found, from
 * every check, so the list can say how bad each is and which pieces it is
 * about.
 *
 * A check keeps its own logic and its own wording. All it changes is that it
 * returns these instead of sentences. Problems never block saving or export.
 */

export type ProblemSeverity = "error" | "warning" | "note";

/** The check that made a problem. */
export type ProblemSource =
  | "document"
  | "pack"
  | "geometry"
  | "balance"
  | "footprint"
  | "overlap"
  | "skeleton"
  | "budget"
  | "actions";

export interface Problem {
  source: ProblemSource;
  severity: ProblemSeverity;
  message: string;
  /** The pieces this is about, none for a problem with the unit as a whole. */
  pieceIds: string[];
}

/** Every source, in the order the list offers them for muting. */
export const PROBLEM_SOURCES: { id: ProblemSource; label: string }[] = [
  {
    id: "document",
    get label() {
      return t`Pieces`;
    },
  },
  {
    id: "pack",
    get label() {
      return t`Parts`;
    },
  },
  {
    id: "geometry",
    get label() {
      return t`Geometry`;
    },
  },
  {
    id: "balance",
    get label() {
      return t`Balance`;
    },
  },
  {
    id: "footprint",
    get label() {
      return t`Footprint`;
    },
  },
  {
    id: "overlap",
    get label() {
      return t`Overlap`;
    },
  },
  {
    id: "skeleton",
    get label() {
      return t`Skeleton`;
    },
  },
  {
    id: "budget",
    get label() {
      return t`Budget`;
    },
  },
  {
    id: "actions",
    get label() {
      return t`Actions`;
    },
  },
];

const SEVERITY_ORDER: ProblemSeverity[] = ["error", "warning", "note"];

export function problem(
  source: ProblemSource,
  severity: ProblemSeverity,
  message: string,
  pieceIds: string[] = [],
): Problem {
  return { source, severity, message, pieceIds: [...pieceIds] };
}

/** Just the sentences, for a caller that has no use for the rest. */
export function problemTexts(problems: Problem[]): string[] {
  return problems.map((p) => p.message);
}

/**
 * What the list shows once the person has muted some sources. An error is
 * never hidden: it means the unit did not open properly, and muting the check
 * that says so would leave nothing saying it.
 */
export function visibleProblems(
  problems: Problem[],
  muted: ReadonlySet<ProblemSource>,
): Problem[] {
  return problems.filter((p) => p.severity === "error" || !muted.has(p.source));
}

/** Problems by severity, worst first, keeping the order they arrived in. */
export function groupProblems(
  problems: Problem[],
): { severity: ProblemSeverity; problems: Problem[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    problems: problems.filter((p) => p.severity === severity),
  })).filter((group) => group.problems.length > 0);
}

/** The muted sources in storage form, or none for anything unreadable. */
export function mutedSourcesFrom(stored: string | null): Set<ProblemSource> {
  const known = new Set<string>(PROBLEM_SOURCES.map((s) => s.id));
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (id): id is ProblemSource => typeof id === "string" && known.has(id),
      ),
    );
  } catch {
    return new Set();
  }
}
