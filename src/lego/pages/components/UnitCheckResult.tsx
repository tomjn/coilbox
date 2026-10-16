/**
 * What a unit load check found, in the Test drawer (issue #3319). The headline
 * comes from `describeCheck`. Below it are the engine's own words: why the game
 * did not load, then every error and warning about the unit.
 */

import { FileText } from "lucide-react";

import type { UnitCheckEntry, UnitCheckReport } from "@/content/bindings";

import {
  describeCheck,
  describeMove,
  describeOtherErrors,
} from "../../unitCheck";
import { ShowMe } from "./ShowMe";

interface Props {
  report: UnitCheckReport;
  unitName: string;
}

function Entries({
  title,
  entries,
  tone,
}: {
  title: string;
  entries: UnitCheckEntry[];
  tone: "error" | "warning";
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">{title}</h3>
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li
            key={entry.text}
            className={`rounded border px-2 py-1 ${
              tone === "error"
                ? "border-destructive/50 text-destructive"
                : "border-amber-500/50 text-amber-600 dark:text-amber-400"
            }`}
          >
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">
              {entry.text}
            </pre>
            {entry.count > 1 ? (
              <span className="text-[11px] text-muted-foreground">
                {entry.count} times
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function UnitCheckResult({ report, unitName }: Props) {
  const others = describeOtherErrors(report);
  const moved = describeMove(report);
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="unit-check">
      <p
        className={
          report.outcome === "loaded"
            ? "text-sm font-medium"
            : "text-sm font-medium text-destructive"
        }
      >
        {describeCheck(report, unitName)}
      </p>
      {moved ? <p>{moved}</p> : null}
      <Entries title="Why" entries={report.fatal} tone="error" />
      <Entries title="Errors" entries={report.problems} tone="error" />
      <Entries title="Warnings" entries={report.warnings} tone="warning" />
      {others ? <p className="text-muted-foreground">{others}</p> : null}
      <ShowMe path={report.logPath}>
        <FileText className="size-4" /> Show me the engine log
      </ShowMe>
    </div>
  );
}
