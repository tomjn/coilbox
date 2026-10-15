import { CheckField } from "@/components/Field";
import { matchCount } from "../../mapAggregate";

export interface VersionItem {
  /** What is switched, and what the row says. */
  name: string;
  matches: number;
  included: boolean;
  /** Said under the name beside the count, such as "this page". */
  note?: string;
}

/**
 * The versions of a map or a game that the matches were recorded under, each
 * with its count and a box to leave it out. One control for both, so the map
 * and the game are switched the same way. The counts are of matches in the
 * library, whatever the other filters say, so a version that is switched off
 * still shows how much it would add.
 */
export function VersionList({
  label,
  testId,
  items,
  onToggle,
}: {
  label: string;
  testId: string;
  items: readonly VersionItem[];
  onToggle: (name: string, included: boolean) => void;
}) {
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
      data-testid={testId}
    >
      <legend className="mb-1.5 p-0 text-xs font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((v) => (
          <CheckField
            key={v.name}
            label={v.name}
            hint={`${matchCount(v.matches)}${v.note ? `, ${v.note}` : ""}`}
            checked={v.included}
            onChange={(on) => onToggle(v.name, on)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** The line above a picture or a table drawn from more than one version. */
export function VersionSpan({
  versions,
  testId,
}: {
  versions: number;
  testId: string;
}) {
  if (versions < 2) return null;
  return (
    <p className="text-xs font-medium" data-testid={testId}>
      Across {versions.toLocaleString()} versions of this map
    </p>
  );
}
