import { Button } from "@picoframe/frame";
import { useState } from "react";
import { usePreferredTarget } from "@/play/config";
import {
  type GamePictures,
  lastSweptAt,
  type PictureSweepProgress,
  type PictureSweepReport,
  pictureSweepSummary,
  sweepGamePictures,
} from "../../assets/pictureSweep";
import { RENDER_ANGLES } from "../../assets/vocabulary";

/**
 * Sending the hub pictures of the units in the installed games, in Settings >
 * Coilbox hub (issue #1952).
 *
 * The gap this closes is a plain one. The switch above these buttons says
 * coilbox "makes pictures of the units and maps inside them, and sends those
 * pictures to the hub", and the two buttons under it both say they send no
 * pictures. Until this, the only thing in the whole app that sent one was
 * opening a blueprint, which nobody would guess and which only ever covers the
 * units on that one layout.
 *
 * Started by a person, like the two sweeps beside it and for a stronger reason:
 * this one draws, which is seconds of GPU a picture, and a whole game is
 * minutes.
 *
 * The words have to carry two things somebody would otherwise find out by
 * waiting. It takes several goes, because a game's uploads are rationed by the
 * hour and the ration is shared with everybody using the hub. And pressing it
 * again later carries on rather than starting over, which is true because the
 * sweep asks the hub what it is missing before it spends anything.
 */
export function GamePicturesControl({
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
  const [progress, setProgress] = useState<PictureSweepProgress | null>(null);
  const [report, setReport] = useState<PictureSweepReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Read once on mount rather than on every render: it changes when a run
  // finishes, and a run finishing sets `report` below, which re-reads it.
  const [swept, setSwept] = useState(lastSweptAt);

  const run = async () => {
    if (!target?.enginePath) return;
    setRunning(true);
    setReport(null);
    setFailed(null);
    setProgress({ phase: "scanning", done: 0, total: 0 });
    try {
      const done = await sweepGamePictures(
        {
          hubUrl,
          enginePath: target.enginePath,
          dataDir: target.dataDir,
        },
        setProgress,
      );
      setReport(done);
      setSwept(lastSweptAt());
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
        Sending pictures of your games
      </h3>
      <p className="text-sm text-muted-foreground">
        Coilbox can draw every unit in the games on this computer and send the
        pictures to the hub: the icon the game ships, and {RENDER_ANGLES.length}{" "}
        views of the model drawn here. It asks the hub what it already has
        first, so a game somebody else has covered costs one question.
      </p>
      <p className="text-sm text-muted-foreground">
        A big game takes several goes. Every upload spends part of an hourly
        allowance the whole community shares, so one press covers what is left
        of this hour and picks up where it stopped the next time you press it.
      </p>
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={running || !target?.enginePath}
        >
          {running ? "Drawing your units…" : "Send pictures of your games"}
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {phaseWords(progress)}
          </span>
        )}
      </div>
      {!target?.enginePath && (
        <p className="text-sm text-muted-foreground">
          Coilbox needs an engine installed before it can draw your units.
        </p>
      )}
      {swept !== null && !running && (
        <p className="text-sm text-muted-foreground">
          Last run {new Date(swept).toLocaleString()}.
        </p>
      )}
      {report && (
        <>
          <p className="text-sm text-muted-foreground">
            {pictureSweepSummary(report)}
          </p>
          {report.games.length > 0 && (
            <ul className="text-sm text-muted-foreground">
              {report.games.map((one) => (
                <li key={one.shortname}>{gameWords(one)}</li>
              ))}
            </ul>
          )}
          {report.failed.map((one) => (
            <p className="text-sm text-destructive" key={one.game}>
              Coilbox could not read {one.game}: {one.said}
            </p>
          ))}
        </>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}

/** What a phase is called while it is running, counting games. */
export function phaseWords({
  phase,
  done,
  total,
  game,
}: PictureSweepProgress): string {
  if (phase === "scanning") return "Looking for your games";
  // `done` counts games finished, so the one being worked on is the next along,
  // except on the last sample where there is no next one.
  const at = Math.min(done + 1, total);
  const of = total > 0 ? ` ${at} of ${total}` : "";
  const named = game ? `: ${game}` : "";
  if (phase === "filling") return `Drawing${of}${named}`;
  return `Reading${of}${named}`;
}

/**
 * One game's line, which is the thing the issue asks for: what the hub is
 * missing, per game, in units rather than in pictures.
 *
 * Units rather than pictures because a unit is what a person counts. A game
 * missing one angle of four hundred units is not four hundred pictures of work
 * to anybody reading this, it is four hundred units.
 */
export function gameWords(one: GamePictures): string {
  const left = Math.max(0, one.wanted - one.covered);
  if (one.units === 0) return `${one.game}: coilbox could not read its units.`;
  if (one.wanted === 0) {
    return `${one.game}: the hub has all ${one.units} units.`;
  }
  const covered = one.covered > 0 ? `sent ${one.covered} of them, ` : "";
  const waiting = left === 1 ? "1 unit" : `${left} units`;
  return `${one.game}: ${covered}${waiting} still waiting out of ${one.units}.`;
}
