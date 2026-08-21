import { Button } from "@picoframe/frame";
import { useState } from "react";
import { usePreferredTarget } from "@/play/config";
import {
  type GameSweepProgress,
  type GameSweepReport,
  gameSweepSummary,
  sweepGameFacts,
} from "../../games/factsSweep";

/**
 * Telling the hub what the installed games say about their units, in Settings >
 * Coilbox hub (issue #1875).
 *
 * Started by a person, for the reason the map sweep beside it is: reading a
 * game's unit graph mounts its whole archive set, twice, and nothing about
 * opening a settings page says that is wanted now.
 *
 * The words say released games only, because somebody with a checkout in their
 * games folder should be able to see that coilbox left it alone rather than
 * having to trust that it did. See `sweepGameFacts`.
 */
export function GameFactsControl({
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
  const [progress, setProgress] = useState<GameSweepProgress | null>(null);
  const [report, setReport] = useState<GameSweepReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async () => {
    if (!target?.enginePath) return;
    setRunning(true);
    setReport(null);
    setFailed(null);
    setProgress({ phase: "scanning", done: 0, total: 0 });
    try {
      const done = await sweepGameFacts(
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
        Sending what your games say
      </h3>
      <p className="text-sm text-muted-foreground">
        Coilbox can read the games on this computer and tell the hub what units
        each one has: their names, what each one builds, and which faction they
        belong to. It sends no pictures and no files, only those names.
      </p>
      <p className="text-sm text-muted-foreground">
        Released games only. A game you are working on in a loose folder stays
        on this machine, and so do the games coilbox writes for itself.
      </p>
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={running || !target?.enginePath}
        >
          {running ? "Reading your games…" : "Send what your games say"}
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {phaseWords(progress)}
          </span>
        )}
      </div>
      {!target?.enginePath && (
        <p className="text-sm text-muted-foreground">
          Coilbox needs an engine installed before it can read your games.
        </p>
      )}
      {report && (
        <p className="text-sm text-muted-foreground">
          {gameSweepSummary(report)}
        </p>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}

/** What a phase is called while it is running, counting games. */
function phaseWords({ phase, done, total, game }: GameSweepProgress): string {
  if (phase === "scanning") return "Looking for your games";
  // `done` counts games finished, so the one being worked on is the next along,
  // except on the last sample where there is no next one.
  const at = Math.min(done + 1, total);
  const of = total > 0 ? ` ${at} of ${total}` : "";
  const named = game ? `: ${game}` : "";
  if (phase === "sending") return `Sending${of}${named}`;
  return `Reading${of}${named}`;
}
