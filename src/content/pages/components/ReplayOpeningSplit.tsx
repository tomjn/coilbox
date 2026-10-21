import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import {
  type OrderedSplit,
  SPLIT_BUCKETS,
  type SplitBucket,
} from "../../replayOpening";

const HEADINGS: Record<SplitBucket, MessageDescriptor> = {
  economy: msg`Economy`,
  defence: msg`Defence`,
  offence: msg`Offence`,
  other: msg`Other`,
  unclassified: msg`Unclassified`,
};

export interface SplitRow {
  key: string;
  name: string;
  split: OrderedSplit;
}

/** What the cost table means, for the build orders section's help entry. */
export function OpeningSplitHelp() {
  return (
    <p>
      <Trans>
        The cost table is the cost of what was ordered, not of what was built.
        Other is builders, factories, sensors and transports. Unclassified is
        units whose definition does not say what they are for, which includes
        anything whose income the game sets outside the unit definition.
      </Trans>
    </p>
  );
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
  const { t, i18n } = useLingui();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">
        {cutMinutes === null
          ? t`Cost by kind of unit`
          : t`Cost by kind of unit, to minute ${cutMinutes}`}
      </h3>
      {differentBuild && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          <Trans>
            These costs come from a different build and may be wrong.
          </Trans>
        </p>
      )}
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>
              <Trans>Player</Trans>
            </TableHead>
            {SPLIT_BUCKETS.map((bucket) => (
              <TableHead key={bucket} className="text-right">
                {i18n._(HEADINGS[bucket])}
              </TableHead>
            ))}
            <TableHead className="text-right">
              <Trans>Not priced</Trans>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className="font-medium">
                {row.name}
              </TableHead>
              {SPLIT_BUCKETS.map((bucket) => {
                const metal = formatNumber(row.split.buckets[bucket].metal);
                const energy = formatNumber(row.split.buckets[bucket].energy);
                return (
                  <TableCell
                    key={bucket}
                    className="text-right tabular-nums"
                    data-bucket={bucket}
                  >
                    <div>
                      <Trans>{metal} metal</Trans>
                    </div>
                    <div className="text-muted-foreground">
                      <Trans>{energy} energy</Trans>
                    </div>
                  </TableCell>
                );
              })}
              <TableCell className="text-right tabular-nums">
                <Plural
                  value={row.split.unpriced}
                  one="# unit"
                  other="# units"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
