import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type OrderedSplit,
  SPLIT_BUCKETS,
  type SplitBucket,
} from "../../replayOpening";

const HEADINGS: Record<SplitBucket, string> = {
  economy: "Economy",
  defence: "Defence",
  offence: "Offence",
  other: "Other",
  unclassified: "Unclassified",
};

export interface SplitRow {
  key: string;
  name: string;
  split: OrderedSplit;
}

/**
 * Every player's ordered cost by kind of unit in one table, so openings can be
 * compared without opening each list. Metal sits over energy in each cell: no
 * exchange rate between them is agreed across games.
 */
export function ReplayOpeningSplit({
  rows,
  cutMinutes,
  differentBuild,
}: {
  rows: SplitRow[];
  cutMinutes: number | null;
  differentBuild: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">
        {cutMinutes === null
          ? "Cost by kind of unit"
          : `Cost by kind of unit, to minute ${cutMinutes}`}
      </h3>
      <p className="text-xs text-muted-foreground">
        Cost of what was ordered, not of what was built. Other is builders,
        factories, sensors and transports. Unclassified is units whose
        definition does not say what they are for, which includes anything whose
        income the game sets outside the unit definition.
      </p>
      {differentBuild && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          These costs come from a different build and may be wrong.
        </p>
      )}
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            {SPLIT_BUCKETS.map((bucket) => (
              <TableHead key={bucket} className="text-right">
                {HEADINGS[bucket]}
              </TableHead>
            ))}
            <TableHead className="text-right">Not priced</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className="font-medium">
                {row.name}
              </TableHead>
              {SPLIT_BUCKETS.map((bucket) => (
                <TableCell
                  key={bucket}
                  className="text-right tabular-nums"
                  data-bucket={bucket}
                >
                  <div>
                    {row.split.buckets[bucket].metal.toLocaleString()} metal
                  </div>
                  <div className="text-muted-foreground">
                    {row.split.buckets[bucket].energy.toLocaleString()} energy
                  </div>
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                {row.split.unpriced.toLocaleString()}{" "}
                {row.split.unpriced === 1 ? "unit" : "units"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
