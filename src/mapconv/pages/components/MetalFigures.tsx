import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MetalResult, MirrorName } from "../../metalSpots";

/**
 * A map's metal as numbers and no verdict (issue #5098): how far each start is
 * from its nearest spots, which spots one extractor covers both of, and how
 * closely the spot layout mirrors itself. The arithmetic is `metalSpots.ts`.
 */
export function MetalFigures({
  metal,
  error,
}: {
  metal: MetalResult | null;
  /** Why the metal map could not be read. */
  error?: string | null;
}) {
  const { t } = useLingui();
  const elmos = (value: number) => Math.round(value);
  const mirrorName: Record<MirrorName, string> = {
    centre: t`through the centre`,
    eastWest: t`east to west`,
    northSouth: t`north to south`,
  };

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {t`Could not read the map's metal: ${error}`}
      </p>
    );
  }
  if (!metal) return null;
  const radius = elmos(metal.extractorRadius);
  if (metal.spotCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t`The metal map has no metal.`}
      </p>
    );
  }
  const hidden = metal.closeCount - metal.close.length;
  const widest = elmos(metal.widest);

  return (
    <section className="flex flex-col gap-2" aria-label={t`Metal`}>
      <h3 className="text-sm font-medium">{t`Metal`}</h3>
      <p className="text-sm">
        {plural(metal.spotCount, {
          one: `# metal spot, extractor radius is ${radius} elmos`,
          other: `# metal spots, extractor radius is ${radius} elmos`,
        })}
      </p>
      {metal.nearest.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t`Start`}</TableHead>
                <TableHead>{t`Nearest spots, in elmos`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metal.nearest.map((row) => {
                const number = row.start + 1;
                return (
                  <TableRow key={row.start}>
                    <TableCell>{t`start ${number}`}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.distances.map(elmos).join(", ")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {metal.closeCount === 0 ? (
        <p className="text-sm">
          {t`No two spots are closer together than the extractor radius, ${radius} elmos.`}
        </p>
      ) : (
        <div className="text-sm">
          <p>
            {plural(metal.closeCount, {
              one: `# pair of spots is closer together than the extractor radius, ${radius} elmos:`,
              other: `# pairs of spots are closer together than the extractor radius, ${radius} elmos:`,
            })}
          </p>
          <ul className="list-disc pl-5 tabular-nums">
            {metal.close.map((pair) => {
              const distance = elmos(pair.distance);
              const ax = elmos(pair.ax);
              const az = elmos(pair.az);
              const bx = elmos(pair.bx);
              const bz = elmos(pair.bz);
              return (
                <li key={`${pair.ax}:${pair.az}:${pair.bx}:${pair.bz}`}>
                  {t`two spots are ${distance} elmos apart, at ${ax}, ${az} and ${bx}, ${bz}`}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && <p>{t`and ${hidden} more`}</p>}
        </div>
      )}
      <p className="text-sm">
        {plural(metal.wide, {
          one: `# spot has metal farther than the extractor radius from its centre. The widest reaches ${widest} elmos.`,
          other: `# spots have metal farther than the extractor radius from their centre. The widest reaches ${widest} elmos.`,
        })}
      </p>
      <div className="rounded-lg border border-border/50 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t`Mirror`}</TableHead>
              <TableHead className="text-right">
                {t`Starts, largest gap`}
              </TableHead>
              <TableHead className="text-right">
                {t`Spots, largest gap`}
              </TableHead>
              <TableHead>{t`Spot with the largest gap`}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metal.mirrors.map((m) => (
              <TableRow key={m.mirror}>
                <TableCell>{mirrorName[m.mirror]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.starts === null ? "—" : elmos(m.starts)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.spots === null ? "—" : elmos(m.spots)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {m.worst ? `${elmos(m.worst.x)}, ${elmos(m.worst.z)}` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
