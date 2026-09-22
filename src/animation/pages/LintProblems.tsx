/**
 * What a BOS lint pass found wrong with a script, or the reason it could not
 * be parsed at all. Shared between the converter page, which lints as the
 * user types, and the COB page, which lints a script once it has compiled it.
 *
 * Each row is a {@link CheckItem}, given `onSelect` so clicking it can select
 * the line in the source view beside it (issue: lint problems should jump to
 * their line, the same way `MissionProblemsList`'s rows jump to what they
 * are about).
 */
import { CheckItem, CheckSection } from "@/components/CheckItem";
import type { LintDiagnostic } from "../bindings";

export function LintProblems({
  diagnostics,
  error,
  onSelect,
}: {
  diagnostics: LintDiagnostic[];
  /** The script failed to parse, so there are no diagnostics: this is why. */
  error?: string | null;
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
    <CheckSection title="Problems in the BOS" count={diagnostics.length}>
      {diagnostics.map((d) => (
        <CheckItem
          key={`${d.rule}:${d.line}:${d.message}`}
          severity={d.severity}
          location={`line ${d.line}`}
          message={d.message}
          tag={d.rule}
          onSelect={onSelect ? () => onSelect(d.line) : undefined}
        />
      ))}
    </CheckSection>
  );
}
