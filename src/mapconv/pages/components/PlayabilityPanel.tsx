import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useScanTargetSelection,
  useUnitsyncGameHeaders,
  useUnitsyncScan,
} from "@/content/config";
import { mapconvThumbUrl } from "@/lib/assetUrl";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { errorText } from "@/lib/helpers";
import { readHeightGrid } from "@/placement/terrain";
import { useSkirmishDraft } from "@/play/drafts";
import { GamePickerField } from "@/play/pages/components/GamePickerButton";
import { useUnitDefs } from "@/workshop/config";
import { mcSmfHeights } from "../../bindings";
import { readMetalGrid } from "../../metalGrid";
import { ENGINE_EXTRACTOR_RADIUS, type MetalGrid } from "../../metalSpots";
import {
  buildingSpecs,
  type ClassResult,
  type Heights,
  heightsOf,
  moveClassSpecs,
  type Playability,
  type Way,
  type WayEnd,
} from "../../playability";
import { measureOffThread } from "../../playabilityJobs";
import { MetalFigures } from "./MetalFigures";

/**
 * Whether a map is playable, as numbers and no verdict (issue #2169): for each
 * of the chosen game's movement classes how much of the map it can stand on,
 * how that ground splits into areas and the narrowest point on the widest way
 * between start positions, and how much of the map takes the game's buildings.
 *
 * The classes and buildings are a game's, because the engine has none of its
 * own worth measuring: a class with no `maxSlope` climbs anything short of a
 * wall. The game defaults to the one last set up for a skirmish.
 */
export function PlayabilityPanel({
  heights,
  heightsError,
  starts,
  metal,
}: {
  /** The map's corner heights, or null while they are read. */
  heights: Heights | null;
  /** Why the heights could not be read. */
  heightsError?: string | null;
  /** Start positions, in elmos. */
  starts: { x: number; z: number }[];
  /**
   * The map's metal map, for the metal figures (issue #5098). Left out, the
   * panel shows none. A null grid with no error means it is still being read.
   * `extractorRadius` is the map's own, and the engine's default of 500 stands
   * in when it is null or not positive.
   */
  metal?: {
    grid: MetalGrid | null;
    error?: string | null;
    extractorRadius?: number | null;
  };
}) {
  const { t } = useLingui();
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const games = useMemo(
    () => withoutGeneratedGames(scan.data?.games ?? []),
    [scan.data],
  );
  const { headers } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );
  const [draft] = useSkirmishDraft();
  const [gameName, setGameName] = useState("");
  useEffect(() => {
    if (games.length === 0) return;
    const known = games.find((g) => g.name === draft.gameName);
    setGameName((prev) =>
      games.some((g) => g.name === prev)
        ? prev
        : ((known ?? games[0])?.name ?? ""),
    );
  }, [games, draft.gameName]);
  const game = games.find((g) => g.name === gameName);
  const defs = useUnitDefs(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const specs = useMemo(() => {
    if (!defs.defs || defs.defsFor !== game?.primaryArchive.name) return null;
    return {
      classes: moveClassSpecs(defs.defs.moveDefs),
      buildings: buildingSpecs(defs.defs.units),
    };
  }, [defs.defs, defs.defsFor, game]);

  // By value, because a caller's list can be a fresh array each render and
  // the measuring should not start over for it.
  const startsKey = JSON.stringify(starts.map((s) => [s.x, s.z]));
  const startList = useMemo(
    () =>
      (JSON.parse(startsKey) as [number, number][]).map(([x, z]) => ({ x, z })),
    [startsKey],
  );

  // Measuring waits for the metal map, so it does not run twice for one map.
  const metalGrid = metal?.grid ?? null;
  const metalWaiting = !!metal && !metal.grid && !metal.error;
  const declaredRadius = metal?.extractorRadius;
  const extractorRadius =
    declaredRadius != null && declaredRadius > 0
      ? declaredRadius
      : ENGINE_EXTRACTOR_RADIUS;

  const [result, setResult] = useState<Playability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  useEffect(() => {
    setResult(null);
    setError(null);
    if (!heights || !specs || metalWaiting) return;
    const abort = new AbortController();
    setMeasuring(true);
    // A fresh object, because a caller's grid keeps `words` out of key
    // enumeration and a worker message copies enumerable keys only.
    const job = {
      heights: {
        words: heights.words,
        width: heights.width,
        height: heights.height,
        minHeight: heights.minHeight,
        maxHeight: heights.maxHeight,
      },
      ...specs,
      starts: startList,
      ...(metalGrid ? { metal: { grid: metalGrid, extractorRadius } } : {}),
    };
    measureOffThread(job, abort.signal)
      .then(setResult)
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setMeasuring(false);
      });
    return () => abort.abort();
  }, [heights, specs, startList, metalGrid, metalWaiting, extractorRadius]);

  const degrees = (value: number) => `${Number(value.toFixed(1))}°`;
  const percent = (share: number) =>
    `${(share * 100).toFixed(share > 0 && share < 0.01 ? 2 : 1)}%`;
  const endName = (end: WayEnd) => {
    if (end.kind === "start") {
      const number = end.index + 1;
      return t`start ${number}`;
    }
    return {
      west: t`west edge`,
      east: t`east edge`,
      north: t`north edge`,
      south: t`south edge`,
    }[end.edge];
  };
  const narrowest = (ways: Way[]) => {
    const joined = ways.filter((w) => w.width !== null);
    const apart = ways.length - joined.length;
    const parts: string[] = [];
    if (joined.length > 0) {
      const w = joined.reduce((a, b) =>
        (b.width ?? 0) < (a.width ?? 0) ? b : a,
      );
      const width = Math.round(w.width ?? 0);
      const from = endName(w.from);
      const to = endName(w.to);
      const x = Math.round(w.x);
      const z = Math.round(w.z);
      parts.push(t`${width} elmos, ${from} to ${to}, at ${x}, ${z}`);
    }
    if (apart > 0) {
      const w = ways.find((x) => x.width === null);
      if (ways.length === 1 && w) {
        const from = endName(w.from);
        const to = endName(w.to);
        parts.push(t`${from} and ${to} not connected`);
      } else {
        const pairs = ways.length;
        parts.push(t`${apart} of ${pairs} pairs not connected`);
      }
    }
    return parts.join("; ");
  };
  // Classes whose every number is the same share a row, because a game
  // declares dozens and most differ only by name.
  const rows: { names: string[]; c: ClassResult }[] = [];
  for (const c of result?.classes ?? []) {
    const same = rows.find(
      (r) =>
        r.c.kind === c.kind &&
        r.c.maxSlope === c.maxSlope &&
        r.c.passable === c.passable &&
        r.c.largest === c.largest &&
        r.c.areas === c.areas &&
        narrowest(r.c.ways) === narrowest(c.ways),
    );
    if (same) same.names.push(c.name);
    else rows.push({ names: [c.name], c });
  }
  const kindName = {
    tank: t`tank`,
    kbot: t`kbot`,
    hover: t`hover`,
    ship: t`ship`,
  };

  return (
    <section className="flex flex-col gap-2" aria-label={t`Playability`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t`Playability`}</h2>
        <div className="w-72">
          <GamePickerField
            value={gameName}
            onValueChange={setGameName}
            games={games}
            headers={headers}
            placeholder={scan.loading ? t`Reading games...` : t`No game`}
            ariaLabel={t`Game whose units to measure with`}
            disabled={games.length === 0}
            gamesLoading={scan.loading}
            scanError={scan.error}
          />
        </div>
      </div>
      {heightsError ? (
        <p className="text-sm text-destructive">
          {t`Could not read the map's heights: ${heightsError}`}
        </p>
      ) : defs.status === "error" ? (
        <p className="text-sm text-destructive">
          {t`Could not read the game's units: ${defs.error}`}
        </p>
      ) : error ? (
        <p className="text-sm text-destructive">
          {t`Could not measure the map: ${error}`}
        </p>
      ) : !game && !scan.loading ? (
        <p className="text-sm text-muted-foreground">{t`No game installed.`}</p>
      ) : !result || measuring ? (
        <Skeleton className="h-24 rounded bg-muted" />
      ) : (
        <div className="flex flex-col gap-3">
          {result.classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t`The game declares no movement classes.`}
            </p>
          ) : (
            <div className="rounded-lg border border-border/50 bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t`Movement class`}</TableHead>
                    <TableHead>{t`Kind`}</TableHead>
                    <TableHead className="text-right">{t`Max slope`}</TableHead>
                    <TableHead className="text-right">{t`Passable`}</TableHead>
                    <TableHead className="text-right">{t`Largest area`}</TableHead>
                    <TableHead className="text-right">{t`Areas`}</TableHead>
                    <TableHead>{t`Narrowest point on the widest way`}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ names, c }) => (
                    <TableRow key={names.join(" ")}>
                      <TableCell className="whitespace-normal font-mono text-xs">
                        {names.join(", ")}
                      </TableCell>
                      <TableCell>{kindName[c.kind]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.maxSlope === null ? "—" : degrees(c.maxSlope)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(c.passable)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(c.largest)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.areas}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {narrowest(c.ways)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {result.buildings.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t`Building`}</TableHead>
                    <TableHead className="text-right">{t`Defs this shape`}</TableHead>
                    <TableHead className="text-right">{t`Footprint`}</TableHead>
                    <TableHead className="text-right">{t`Max slope`}</TableHead>
                    <TableHead className="text-right">{t`Buildable`}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.buildings.map((b) => {
                    const share = percent(b.buildable);
                    return (
                      <TableRow key={b.name}>
                        <TableCell className="font-mono text-xs">
                          {b.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.defs}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.footprintX} × {b.footprintZ}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {degrees(b.maxSlope)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {plural(b.positions, {
                            one: `${share} of # spot`,
                            other: `${share} of # spots`,
                          })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {metal && <MetalFigures metal={result.metal} error={metal.error} />}
        </div>
      )}
    </section>
  );
}

/**
 * {@link PlayabilityPanel} for a map the Compile page has just written, read
 * from the `.smf` itself so the numbers are the compiled map's.
 */
export function CompiledPlayability({
  smfPath,
  starts,
  extractorRadius,
}: {
  smfPath: string;
  starts: { x: number; z: number }[];
  /** The map's `extractorRadius` from its `mapinfo.lua`, when it sets one. */
  extractorRadius?: number | null;
}) {
  const [heights, setHeights] = useState<Heights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metalGrid, setMetalGrid] = useState<MetalGrid | null>(null);
  const [metalError, setMetalError] = useState<string | null>(null);
  useEffect(() => {
    setHeights(null);
    setError(null);
    setMetalGrid(null);
    setMetalError(null);
    let cancelled = false;
    (async () => {
      const smf = await mcSmfHeights({ path: smfPath });
      const grid = await readHeightGrid(
        mapconvThumbUrl(smf.file),
        smf.width,
        smf.height,
      );
      if (!grid) throw new Error("the heights file is not this map's size");
      if (!cancelled) setHeights(heightsOf(grid, smf.minHeight, smf.maxHeight));
      // The metal map is its own read, so a map whose metal cannot be read
      // still gets the rest of the panel.
      try {
        if (!smf.metalFile || !smf.metalWidth || !smf.metalHeight) {
          throw new Error("the compiled map has no metal map to read");
        }
        const metal = await readMetalGrid(
          mapconvThumbUrl(smf.metalFile),
          smf.metalWidth,
          smf.metalHeight,
        );
        if (!metal)
          throw new Error("the metal map file is not this map's size");
        if (!cancelled) setMetalGrid(metal);
      } catch (e) {
        if (!cancelled) setMetalError(errorText(e));
      }
    })().catch((e: unknown) => {
      if (!cancelled) setError(errorText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [smfPath]);
  return (
    <PlayabilityPanel
      heights={heights}
      heightsError={error}
      starts={starts}
      metal={{ grid: metalGrid, error: metalError, extractorRadius }}
    />
  );
}
