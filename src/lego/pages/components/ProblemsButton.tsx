/**
 * The problems list: a button in the view's controls showing how many there
 * are, and a drawer holding them. Clicking a problem hands it to the page, which
 * selects its pieces and frames them.
 */
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button, Drawer } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  CheckItem,
  CheckSection,
  type CheckSeverity,
  SEVERITY_COLOR,
  worstSeverity,
} from "@/components/CheckItem";
import { CheckField } from "@/components/Field";

import {
  groupProblems,
  PROBLEM_SOURCES,
  type Problem,
  type ProblemSeverity,
  type ProblemSource,
  visibleProblems,
} from "../../problems";
import { useMutedProblemSources } from "../../useMutedProblemSources";

/** Why a check has no answer to show right now. */
export type CheckStatus = "checking" | "paused";

/** One finished sentence about a source whose check has no answer yet. */
function statusSentence(label: string, status: CheckStatus): string {
  return status === "paused"
    ? t`${label}: not checked while a script plays.`
    : t`${label}: checking.`;
}

function groupTitle(severity: ProblemSeverity): string {
  if (severity === "error") return t`Errors`;
  if (severity === "warning") return t`Warnings`;
  return t`Notes`;
}

const ROW_SEVERITY: Record<ProblemSeverity, CheckSeverity> = {
  error: "error",
  warning: "warning",
  note: "info",
};

export function ProblemsButton({
  problems,
  statuses,
  onSelect,
  className,
}: {
  problems: Problem[];
  statuses: Partial<Record<ProblemSource, CheckStatus>>;
  onSelect: (problem: Problem) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useMutedProblemSources();
  const shown = visibleProblems(problems, muted);
  const worst = worstSeverity(shown.map((p) => ROW_SEVERITY[p.severity]));
  const sources = PROBLEM_SOURCES.filter((s) =>
    problems.some((p) => p.source === s.id),
  );
  const pending = PROBLEM_SOURCES.filter((s) => statuses[s.id]);

  if (problems.length === 0) return null;

  const shownCount = shown.length;
  const label =
    shownCount > 0
      ? t`Problems with this unit: ${shownCount}`
      : t`Problems with this unit`;
  return (
    <>
      <Button
        size="icon"
        variant="outline"
        className={`relative ${className ?? ""}`}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
      >
        <TriangleAlert
          className={`size-4 ${worst ? SEVERITY_COLOR[worst] : ""}`}
        />
        {shown.length > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-background px-1 text-center text-[10px] leading-4 tabular-nums">
            {shown.length}
          </span>
        ) : null}
      </Button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={t`Problems`}
        description={t`Click one to select its pieces.`}
        width="30rem"
      >
        <div className="flex flex-col gap-5 text-sm">
          {pending.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {pending
                .map((s) =>
                  statusSentence(s.label, statuses[s.id] ?? "checking"),
                )
                .join(" ")}
            </p>
          ) : null}

          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <Trans>No problems.</Trans>
            </p>
          ) : null}

          {groupProblems(shown).map((group) => (
            <CheckSection
              key={group.severity}
              title={groupTitle(group.severity)}
              count={group.problems.length}
            >
              {group.problems.map((p) => (
                <CheckItem
                  key={`${p.source}:${p.message}:${p.pieceIds.join(",")}`}
                  severity={ROW_SEVERITY[p.severity]}
                  message={p.message}
                  tag={p.source}
                  onSelect={
                    p.pieceIds.length > 0 ? () => onSelect(p) : undefined
                  }
                />
              ))}
            </CheckSection>
          ))}

          {sources.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">
                <Trans>Show</Trans>
              </h3>
              {sources.map((s) => (
                <CheckField
                  key={s.id}
                  label={s.label}
                  checked={!muted.has(s.id)}
                  onChange={(on) => setMuted(s.id, !on)}
                />
              ))}
            </section>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
