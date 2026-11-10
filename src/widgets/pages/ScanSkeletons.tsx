import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { appFileIO } from "@/blueprint/fileIO";
import { OptionSelect } from "@/components/OptionSelect";
import { SlideDrawer } from "@/components/SlideDrawer";
import { Badge } from "@/components/ui/badge";
import {
  type GameItem,
  unitsyncArchiveTree,
  unitsyncUnitDataset,
} from "@/content/bindings";
import { ErrorBanner } from "@/content/pages/components/states";
import { describeError } from "@/i18n/uiError";
import { builderOpenUrl } from "@/lego/archiveOpen";
import { type SkeletonWrite, writeSkeletonEntries } from "@/lego/skeletonFile";
import {
  countOutcomes,
  runSkeletonScan,
  type ScanOutcome,
  scanEntries,
  type UnitScan,
  unitsToScan,
} from "@/lego/skeletonScan";
import { skeletonScanDeps } from "@/lego/skeletonScanRead";
import { formatDuration } from "@/lib/format";

/** Units with no plan first, then those with part of one, since those are the
 *  ones somebody opens the drawer to find. */
const ORDER: Record<ScanOutcome, number> = { none: 0, partial: 1, full: 2 };

interface Finished {
  game: GameItem;
  scans: UnitScan[];
  total: number;
  seconds: number;
  stopped: boolean;
  written: SkeletonWrite | null;
}

/**
 * The skeleton widget's scan (#5186): read every unit of one installed game,
 * propose a body plan for each from its script, and write those that got one
 * into the game's skeleton file as `observed`. The drawer lists every unit with
 * how much of a plan it got, so one with none can be opened in the builder and
 * fitted by hand.
 *
 * Runs while the Widgets page is open. Leaving the page stops it.
 */
export function ScanSkeletons({
  rootPath,
  enginePath,
  games,
  picked,
  busy,
}: {
  rootPath: string;
  enginePath: string | undefined;
  /** The installed games, one version each. */
  games: readonly GameItem[];
  /** The game the page has picked, by its full name, to scan by default. */
  picked: string | null;
  busy: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const gameName =
    chosen ??
    (picked && games.some((g) => g.name === picked) ? picked : null) ??
    games[0]?.name ??
    "";
  const game = games.find((g) => g.name === gameName) ?? null;

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [scans, setScans] = useState<UnitScan[]>([]);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);

  // Leaving the page stops a scan, so it cannot write into a root the page has
  // moved away from.
  useEffect(() => () => stopper.current?.abort(), []);

  const start = async () => {
    if (!game || !enginePath) return;
    const shortname = game.info?.shortname?.trim();
    const name = game.name;
    if (!shortname) {
      setError(
        t`${name} has no short name, so the widget could not find its file.`,
      );
      return;
    }
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    setError(null);
    setFinished(null);
    setScans([]);
    setProgress({ done: 0, total: 0 });
    const began = performance.now();
    try {
      const archive = game.primaryArchive.name;
      const target = { enginePath, dataDir: rootPath };
      const [tree, dataset] = await Promise.all([
        unitsyncArchiveTree({ ...target, archive }),
        unitsyncUnitDataset({ ...target, gameArchive: archive }),
      ]);
      if (dataset.units.length === 0 && dataset.errors.length > 0) {
        throw new Error(dataset.errors.join(". "));
      }
      const units = unitsToScan({
        files: tree.files,
        units: dataset.units,
        archive,
        ...(tree.archivePath ? { archivePath: tree.archivePath } : {}),
      });
      setProgress({ done: 0, total: units.length });
      const deps = skeletonScanDeps({
        target,
        game: { name: game.name, archive },
        files: tree.files,
        ...(tree.archivePath ? { archivePath: tree.archivePath } : {}),
      });
      const done = await runSkeletonScan(units, deps, {
        signal: controller.signal,
        onUnit: (scan, count) => {
          setScans((was) => [...was, scan]);
          setProgress({ done: count, total: units.length });
        },
      });
      const entries = scanEntries(done);
      const written =
        Object.keys(entries).length > 0
          ? await writeSkeletonEntries(appFileIO, rootPath, shortname, entries)
          : null;
      setFinished({
        game,
        scans: done,
        total: units.length,
        seconds: (performance.now() - began) / 1000,
        stopped: controller.signal.aborted,
        written,
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      stopper.current = null;
      setRunning(false);
    }
  };

  const shown = finished?.scans ?? scans;
  const counts = countOutcomes(shown);
  const sorted = useMemo(
    () =>
      [...shown].sort(
        (a, b) =>
          ORDER[a.outcome] - ORDER[b.outcome] || a.label.localeCompare(b.label),
      ),
    [shown],
  );
  const full = counts.full;
  const partial = counts.partial;
  const none = counts.none;
  const done = progress.done;
  const total = progress.total;
  const summary = t`${full} full, ${partial} partial, ${none} none`;
  const status = running
    ? total === 0
      ? t`Reading the game's units…`
      : t`Scanned ${done} of ${total} units.`
    : finished
      ? finishedText(finished, summary)
      : null;

  function finishedText(f: Finished, counted: string): string {
    const time = formatDuration(f.seconds);
    const scanned = f.scans.length;
    const all = f.total;
    const wrote = f.written?.units.length ?? 0;
    const wroteText = plural(wrote, {
      one: "# unit written",
      other: "# units written",
    });
    return f.stopped
      ? t`Stopped after ${scanned} of ${all} units in ${time}: ${counted}. ${wroteText}.`
      : t`Scanned ${all} units in ${time}: ${counted}. ${wroteText}.`;
  }

  const kind: Record<ScanOutcome, string> = {
    full: t`Full`,
    partial: t`Partial`,
    none: t`None`,
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || games.length === 0 || !enginePath}
        onClick={() => setOpen(true)}
      >
        {running ? t`Scanning…` : t`Scan units`}
      </Button>
      {status && !open && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {status}
        </p>
      )}
      <SlideDrawer
        open={open}
        title={t`Scan units for skeletons`}
        onClose={() => setOpen(false)}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <OptionSelect
            value={gameName}
            onValueChange={setChosen}
            options={games.map((g) => ({ value: g.name, label: g.name }))}
            ariaLabel={t`Game`}
            disabled={running}
          />
          <div className="flex gap-2">
            {running ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => stopper.current?.abort()}
              >
                {t`Stop`}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!game || busy}
                onClick={() => void start()}
              >
                {t`Scan`}
              </Button>
            )}
          </div>
          {status && (
            <p role="status" className="text-xs text-muted-foreground">
              {status}
            </p>
          )}
          {error && <ErrorBanner message={error} />}
          {sorted.length > 0 && (
            <ul
              aria-label={t`Scanned units`}
              className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border"
            >
              {sorted.map((scan) => (
                <li key={scan.unit} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        scan.outcome === "full" ? "secondary" : "outline"
                      }
                    >
                      {kind[scan.outcome]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {scan.label}
                    </span>
                    <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                      {scan.unit}
                    </span>
                  </div>
                  {scan.outcome !== "full" && (
                    <UnitDetail scan={scan} game={finished?.game ?? game} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SlideDrawer>
    </>
  );
}

function UnitDetail({ scan, game }: { scan: UnitScan; game: GameItem | null }) {
  const { t } = useLingui();
  const missing = scan.missing.join(", ");
  const plan = scan.plan;
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <p className="min-w-0 flex-1">
        {scan.outcome === "partial"
          ? t`${plan}, with no piece for ${missing}.`
          : scan.note || t`No plan fits.`}
      </p>
      {scan.member && game && (
        <Link
          className="shrink-0 text-foreground underline"
          to={builderOpenUrl({
            archive: game.primaryArchive.name,
            member: scan.member,
            name: game.name,
            unit: scan.unit,
          })}
        >
          {t`Open in builder`}
        </Link>
      )}
    </div>
  );
}
