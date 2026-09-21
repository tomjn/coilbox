/**
 * What a BOS lint pass found wrong with a script, or the reason it could not
 * be parsed at all. Shared between the converter page, which lints as the
 * user types, and the COB page, which lints a script once it has compiled it.
 *
 * A row is a button so clicking it can select the line in the source view
 * beside it (issue: lint problems should jump to their line, the same way
 * `MissionProblemsList`'s rows jump to what they are about).
 */
import { Button } from "@picoframe/frame";
import { AlertCircle, Info, TriangleAlert } from "lucide-react";
import type { LintDiagnostic } from "../bindings";

/** Which icon reads a severity, wherever one is shown. */
export const SEVERITY_ICON: Record<
  LintDiagnostic["severity"],
  typeof AlertCircle
> = {
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
};

/** How a severity reads, wherever one is shown: a row's icon, a gutter mark,
 *  or a count button covering a whole page's worth of them. */
export const SEVERITY_COLOR: Record<LintDiagnostic["severity"], string> = {
  error: "text-destructive",
  warning: "text-amber-700 dark:text-amber-400",
  info: "text-muted-foreground",
};

/** The most urgent of a set of severities, error first, then warning, then
 *  info. `null` for an empty set, so a caller does not need its own guard. */
export function worstSeverity(
  severities: LintDiagnostic["severity"][],
): LintDiagnostic["severity"] | null {
  if (severities.includes("error")) return "error";
  if (severities.includes("warning")) return "warning";
  return severities.length > 0 ? "info" : null;
}

export function LintProblems({
  diagnostics,
  error,
  selectedLine,
  onSelect,
}: {
  diagnostics: LintDiagnostic[];
  /** The script failed to parse, so there are no diagnostics: this is why. */
  error?: string | null;
  /** The line of the row shown as picked, if any. */
  selectedLine?: number | null;
  onSelect?: (line: number) => void;
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (diagnostics.length === 0) return null;
  return (
    <ul aria-label="Lint problems" className="flex flex-col gap-1 text-xs">
      {diagnostics.map((d) => {
        const Icon = SEVERITY_ICON[d.severity];
        return (
          <li key={`${d.rule}:${d.line}:${d.message}`}>
            <Button
              type="button"
              variant="ghost"
              className={`h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-1 text-left font-normal ${
                selectedLine === d.line ? "bg-accent" : ""
              }`}
              onClick={() => onSelect?.(d.line)}
            >
              <Icon
                className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_COLOR[d.severity]}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">line {d.line}: </span>
                {d.message}
              </span>
              <span className="shrink-0 text-muted-foreground">{d.rule}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
