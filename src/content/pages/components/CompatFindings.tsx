import { ChevronRight, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Finding } from "../../compatReport";

function SeverityIcon({ finding }: { finding: Finding }) {
  return finding.severity === "problem" ? (
    <TriangleAlert className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
  ) : (
    <Info className="size-4 shrink-0 text-muted-foreground" />
  );
}

function Label({ finding }: { finding: Finding }) {
  return (
    <>
      <span className="min-w-0 flex-1 text-sm">{finding.label}</span>
      {finding.count !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {finding.count}
        </span>
      )}
    </>
  );
}

/**
 * One finding from the game or the map report: its label and count, with an action
 * beside it when the page has one. A finding with details expands to show
 * them, such as the files and lines behind a Lua count.
 */
export function FindingRow({
  finding,
  action,
}: {
  finding: Finding;
  action?: ReactNode;
}) {
  const details = finding.details ?? [];
  if (details.length === 0)
    return (
      <li className="flex items-center gap-2 px-3 py-2">
        <SeverityIcon finding={finding} />
        <Label finding={finding} />
        {action}
      </li>
    );
  return (
    <li className="px-3 py-2">
      <Collapsible>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <SeverityIcon finding={finding} />
            <Label finding={finding} />
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          {action}
        </div>
        <CollapsibleContent>
          <div className="mt-2 flex max-h-96 flex-col gap-2 overflow-auto pl-6">
            {details.map((d) => (
              <div key={d.heading} className="flex flex-col gap-0.5">
                <p className="break-all font-mono text-xs font-medium">
                  {d.heading}
                </p>
                <ul className="flex flex-col pl-3 font-mono text-xs text-muted-foreground">
                  {d.lines.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** A report's findings as one bordered list, with `actions` by finding kind. */
export function FindingList({
  findings,
  actions = {},
}: {
  findings: Finding[];
  actions?: Partial<Record<string, ReactNode>>;
}) {
  return (
    <ul className="divide-y divide-border/40 rounded-lg border border-border/50 bg-card">
      {findings.map((f) => (
        <FindingRow key={f.kind} finding={f} action={actions[f.kind]} />
      ))}
    </ul>
  );
}
