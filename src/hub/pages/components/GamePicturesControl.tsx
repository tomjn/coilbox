import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import type { GameItem } from "@/content/bindings";
import { useUnitsyncScan } from "@/content/config";
import { describeError } from "@/i18n/uiError";
import { formatDateTime } from "@/lib/format";
import { withoutGeneratedGames } from "@/lib/generatedGames";
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
  const { t, i18n } = useLingui();
  const { target } = usePreferredTarget();
  const { data: scan } = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const games = useMemo(
    () => gameOptions(withoutGeneratedGames(scan?.games ?? [])),
    [scan],
  );
  const [only, setOnly] = useState(ALL_GAMES);
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
          ...(only === ALL_GAMES ? {} : { only }),
        },
        setProgress,
      );
      setReport(done);
      setSwept(lastSweptAt());
    } catch (e) {
      setFailed(describeError(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!agreed) return null;

  const angleCount = RENDER_ANGLES.length;
  const lastRun = swept === null ? null : formatDateTime(new Date(swept));

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        <Trans>Sending pictures of your games</Trans>
      </h3>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Coilbox can draw every unit in the games on this computer and send the
          pictures to the hub: the icon the game ships, and {angleCount} views
          of the model drawn here. It asks the hub what it already has first, so
          a game somebody else has covered costs one question.
        </Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>
          A big game takes several goes. Every upload spends part of an hourly
          allowance the whole community shares, so one press covers what is left
          of this hour and picks up where it stopped the next time you press it.
        </Trans>
      </p>
      <div className="flex items-center gap-3 pt-1">
        <OptionSelect
          value={only}
          onValueChange={setOnly}
          options={[{ value: ALL_GAMES, label: t`All games` }, ...games]}
          disabled={running}
          size="sm"
          className="w-56"
          ariaLabel={t`Which game to send pictures of`}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={running || !target?.enginePath}
        >
          {running ? t`Drawing your units…` : t`Send pictures of your games`}
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {i18n._(phaseWords(progress))}
          </span>
        )}
      </div>
      {!target?.enginePath && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Coilbox needs an engine installed before it can draw your units.
          </Trans>
        </p>
      )}
      {swept !== null && !running && (
        <p className="text-sm text-muted-foreground">
          <Trans>Last run {lastRun}.</Trans>
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
                <li key={one.shortname}>{i18n._(gameWords(one))}</li>
              ))}
            </ul>
          )}
          {report.failed.map((one) => {
            const { game, said } = one;
            return (
              <p className="text-sm text-destructive" key={game}>
                <Trans>
                  Coilbox could not read {game}: {said}
                </Trans>
              </p>
            );
          })}
        </>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}

/** The picker's value for every game. Not a shortname any game could have,
 *  since a shortname is what the other options carry. */
const ALL_GAMES = "*";

/**
 * One option per shortname, which is what the sweep matches on and what it
 * sends one install of. Whether a game is a release is left to the sweep, which
 * says so when the one picked is not.
 */
export function gameOptions(
  games: readonly GameItem[],
): { value: string; label: string }[] {
  const byShortname = new Map<string, string>();
  for (const game of games) {
    const shortname = game.info?.shortname?.trim();
    if (!shortname || byShortname.has(shortname.toLowerCase())) continue;
    byShortname.set(
      shortname.toLowerCase(),
      game.info?.name?.trim() || game.name,
    );
  }
  return [...byShortname]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** What a phase is called while it is running, counting games. */
export function phaseWords({
  phase,
  done,
  total,
  game,
}: PictureSweepProgress): MessageDescriptor {
  if (phase === "scanning") return msg`Looking for your games`;
  // `done` counts games finished, so the one being worked on is the next along,
  // except on the last sample where there is no next one.
  const at = Math.min(done + 1, total);
  if (phase === "filling") {
    if (total > 0) {
      return game
        ? msg`Drawing ${at} of ${total}: ${game}`
        : msg`Drawing ${at} of ${total}`;
    }
    return game ? msg`Drawing: ${game}` : msg`Drawing`;
  }
  if (total > 0) {
    return game
      ? msg`Reading ${at} of ${total}: ${game}`
      : msg`Reading ${at} of ${total}`;
  }
  return game ? msg`Reading: ${game}` : msg`Reading`;
}

/**
 * One game's line, which is the thing the issue asks for: what the hub is
 * missing, per game, in units rather than in pictures.
 *
 * Units rather than pictures because a unit is what a person counts. A game
 * missing one angle of four hundred units is not four hundred pictures of work
 * to anybody reading this, it is four hundred units.
 */
export function gameWords(one: GamePictures): MessageDescriptor {
  const left = Math.max(0, one.wanted - one.covered);
  const { game, units, covered } = one;
  if (units === 0) return msg`${game}: coilbox could not read its units.`;
  if (one.wanted === 0) {
    return msg`${game}: ${plural(units, {
      one: "the hub has the # unit.",
      other: "the hub has all # units.",
    })}`;
  }
  if (covered > 0) {
    return msg`${game}: sent ${covered} of them, ${plural(left, {
      one: "# unit",
      other: "# units",
    })} still waiting out of ${units}.`;
  }
  return msg`${game}: ${plural(left, {
    one: "# unit",
    other: "# units",
  })} still waiting out of ${units}.`;
}
