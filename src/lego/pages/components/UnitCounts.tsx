/**
 * The unit's piece, triangle and vertex counts beside the reference unit's.
 *
 * Numbers only. No limit is known for any of them, so nothing here says whether
 * a count is too high.
 */

import { formatNumber } from "@/lib/format";
import type { ModelCounts } from "../../s3oBuild";

const ROWS: { key: keyof ModelCounts; label: string }[] = [
  { key: "pieces", label: "Pieces" },
  { key: "triangles", label: "Triangles" },
  { key: "vertices", label: "Vertices" },
];

export function UnitCounts({
  unit,
  reference,
  referenceLabel,
}: {
  unit: ModelCounts;
  reference: ModelCounts;
  referenceLabel: string;
}) {
  return (
    <table className="w-full text-xs tabular-nums" aria-label="Unit counts">
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="text-left font-medium" />
          <th scope="col" className="text-right font-medium">
            Your unit
          </th>
          <th scope="col" className="max-w-24 truncate text-right font-medium">
            {referenceLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(({ key, label }) => (
          <tr key={key}>
            <th scope="row" className="text-left font-normal">
              {label}
            </th>
            <td className="text-right">{formatNumber(unit[key])}</td>
            <td className="text-right">{formatNumber(reference[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
