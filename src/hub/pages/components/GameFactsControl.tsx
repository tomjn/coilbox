import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { SettingRow } from "@/components/SettingRow";
import { describeError } from "@/i18n/uiError";
import { usePreferredTarget } from "@/play/config";
import {
  type GameSweepProgress,
  type GameSweepReport,
  gameSweepSummary,
  sweepGameFacts,
} from "../../games/factsSweep";
import { SendButton } from "./SendButton";

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
 *
 * A game that did not land is named, with whatever turned it away quoted under
 * the summary. The summary counts those games and says no more, which is enough
 * to know something went wrong and not enough to do anything about it: the
 * reason is already in the report and used to stop here. It matters more than
 * the count does, because `failed` catches every throw out of the send and only
 * some of them are the hub declining anything. A refused sign-in, a hub that was
 * not answering, and a game the local checks would not let out all arrive as one
 * line saying the hub would not take a game.
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
  const { t, i18n } = useLingui();
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
      setFailed(describeError(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!agreed) return null;

  return (
    <SettingRow
      label={t`What your games say`}
      description={
        progress ? (
          i18n._(phaseWords(progress))
        ) : !target?.enginePath ? (
          t`Coilbox needs an engine installed before it can read your games.`
        ) : report ? (
          <>
            <span className="block">{gameSweepSummary(report)}</span>
            {report.failed.map(({ game, said }) => (
              <span className="block text-destructive" key={game}>
                {game}: {said}
              </span>
            ))}
          </>
        ) : undefined
      }
      error={failed}
      help={
        <>
          <p>
            <Trans>
              Coilbox can read the games on this computer and tell the hub what
              units each one has: their names, what each one builds, and which
              faction they belong to. It sends no pictures and no files, only
              those names.
            </Trans>
          </p>
          <p>
            <Trans>
              Released games only. A game you are working on in a loose folder
              stays on this machine, and so do the games coilbox writes for
              itself.
            </Trans>
          </p>
        </>
      }
      helpLabel={t`About sending what your games say`}
    >
      <SendButton
        label={t`Send what your games say`}
        running={running}
        disabled={!target?.enginePath}
        onClick={() => void run()}
      />
    </SettingRow>
  );
}

/** What a phase is called while it is running, counting games. */
function phaseWords({
  phase,
  done,
  total,
  game,
}: GameSweepProgress): MessageDescriptor {
  if (phase === "scanning") return msg`Looking for your games`;
  // `done` counts games finished, so the one being worked on is the next along,
  // except on the last sample where there is no next one.
  const at = Math.min(done + 1, total);
  if (phase === "sending") {
    if (total > 0) {
      return game
        ? msg`Sending ${at} of ${total}: ${game}`
        : msg`Sending ${at} of ${total}`;
    }
    return game ? msg`Sending: ${game}` : msg`Sending`;
  }
  if (total > 0) {
    return game
      ? msg`Reading ${at} of ${total}: ${game}`
      : msg`Reading ${at} of ${total}`;
  }
  return game ? msg`Reading: ${game}` : msg`Reading`;
}
