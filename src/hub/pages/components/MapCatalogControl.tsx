import { Button } from "@picoframe/frame";
import { useState } from "react";
import { usePreferredTarget } from "@/play/config";
import {
  type SweepProgress,
  type SweepReport,
  sweepMapCatalog,
  sweepSummary,
} from "../../maps/catalogSweep";

/**
 * Sending the hub what coilbox read out of the installed maps, in Settings >
 * Coilbox hub (issue #1737).
 *
 * Started by a person rather than by opening a page. A sweep reads every map
 * archive on the machine, which is a minute on a small library and much longer
 * on a full one, and nothing about opening a settings page or a map says that is
 * wanted now. The picture backfill fires on opening a blueprint because a
 * blueprint names the twelve units it needs, and a map library names nothing.
 *
 * The counts at the end are the point. A conflict is worded as what it means for
 * this machine rather than as a hub problem: an archive here differs from the
 * one everybody else has under that name, so that install shows as out of sync
 * in a lobby and would desync in a game. See `sweepSummary`.
 */
export function MapCatalogControl({
  hubUrl,
  agreed,
}: {
  hubUrl: string;
  /** Whether uploads have been agreed to. The Rust side checks this again off
   *  disk, and would refuse either way, but a button that can only fail is
   *  worse than one that is not offered yet. */
  agreed: boolean;
}) {
  const { target } = usePreferredTarget();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SweepProgress | null>(null);
  const [report, setReport] = useState<SweepReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async () => {
    if (!target?.enginePath) return;
    setRunning(true);
    setReport(null);
    setFailed(null);
    setProgress({ phase: "reading", done: 0, total: 0 });
    try {
      const done = await sweepMapCatalog(
        {
          hubUrl,
          enginePath: target.enginePath,
          dataDir: target.dataDir,
        },
        setProgress,
      );
      setReport(done);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!agreed) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        Sending what your maps say
      </h3>
      <p className="text-sm text-muted-foreground">
        Coilbox can read the maps on this computer and tell the hub what is in
        them: how big each one is, how high its ground goes, how much of it is
        under water, how much wind and tidal power it has, and where players
        start. It sends no pictures and no files, only those measurements.
      </p>
      <p className="text-sm text-muted-foreground">
        It asks the hub what it already knows first, so most of a library costs
        nothing to check. Reading the rest takes a while on a large collection.
      </p>
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={running || !target?.enginePath}
        >
          {running ? "Reading your maps…" : "Send what your maps say"}
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {phaseWords(progress)}
          </span>
        )}
      </div>
      {!target?.enginePath && (
        <p className="text-sm text-muted-foreground">
          Coilbox needs an engine installed before it can read your maps.
        </p>
      )}
      {report && (
        <p className="text-sm text-muted-foreground">{sweepSummary(report)}</p>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}

/** What a phase is called while it is running, counting maps. */
function phaseWords({ phase, done, total }: SweepProgress): string {
  const of = total > 0 ? ` ${done} of ${total}` : "";
  if (phase === "asking") return `Asking the hub about${of || " your maps"}`;
  if (phase === "sending") return `Sending${of || ""}`;
  return total > 0 ? `Read${of}` : "Reading your maps";
}
