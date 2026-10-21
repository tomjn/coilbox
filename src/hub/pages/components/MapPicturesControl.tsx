import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { formatDateTime } from "@/lib/format";
import { usePreferredTarget } from "@/play/config";
import {
  lastMapSweptAt,
  type MapPictureSweepProgress,
  type MapPictureSweepReport,
  mapPictureSweepSummary,
  sweepMapPictures,
} from "../../maps/pictureSweep";

/**
 * Sending the hub pictures of the maps on this computer, in Settings > Coilbox
 * hub (issue #2379).
 *
 * ## Why this is its own button rather than part of the map catalog sweep
 *
 * The two things a map can contribute are its measurements and its picture, and
 * they behave nothing alike. The measurements are one press: nothing rations
 * them, and a library finishes in a sitting. The pictures are rationed by the
 * hour against an allowance the whole community shares, so a large library takes
 * days of pressing.
 *
 * Folding them into one button would mean one press with two answers, one of
 * which is "come back in an hour", and it would hold the cheap half hostage to
 * the slow one. It would also break the shape of this page, where a game already
 * has one button for what it says and another for what it looks like. A map now
 * has the same pair, which is the answer to somebody asking why a game gets both
 * and a map gets one.
 */
export function MapPicturesControl({
  hubUrl,
  agreed,
}: {
  hubUrl: string;
  /** Whether uploads have been agreed to. The Rust side checks this again off
   *  disk and would refuse either way, but a button that can only fail is worse
   *  than one that is not offered yet. */
  agreed: boolean;
}) {
  const { t, i18n } = useLingui();
  const { target } = usePreferredTarget();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MapPictureSweepProgress | null>(
    null,
  );
  const [report, setReport] = useState<MapPictureSweepReport | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Read once on mount rather than on every render: it changes when a run
  // finishes, and a run finishing sets `report` below, which re-reads it.
  const [swept, setSwept] = useState(lastMapSweptAt);

  const run = async () => {
    if (!target?.enginePath) return;
    setRunning(true);
    setReport(null);
    setFailed(null);
    setProgress({ phase: "reading", done: 0, total: 0 });
    try {
      const done = await sweepMapPictures(
        {
          hubUrl,
          enginePath: target.enginePath,
          dataDir: target.dataDir,
        },
        setProgress,
      );
      setReport(done);
      setSwept(lastMapSweptAt());
    } catch (e) {
      setFailed(describeError(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!agreed) return null;

  const lastRun = swept === null ? null : formatDateTime(new Date(swept));

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        <Trans>Sending pictures of your maps</Trans>
      </h3>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Coilbox can read the minimap out of every map on this computer and
          send it to the hub, so a map somebody is looking at there has a
          picture of it rather than a drawing of its name. It asks the hub what
          it already has first, so a map somebody else has covered costs one
          question.
        </Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>
          A big collection takes several goes. Every picture spends part of an
          hourly allowance the whole community shares, so one press covers what
          is left of this hour and picks up where it stopped the next time you
          press it.
        </Trans>
      </p>
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={running || !target?.enginePath}
        >
          {running ? t`Reading your maps…` : t`Send pictures of your maps`}
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
            Coilbox needs an engine installed before it can read your maps.
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
            {mapPictureSweepSummary(report)}
          </p>
          {report.errors.map((said) => (
            <p className="text-sm text-destructive" key={said}>
              {said}
            </p>
          ))}
        </>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}
    </section>
  );
}

/** What a phase is called while it is running, counting maps. */
export function phaseWords({
  phase,
  done,
  total,
}: MapPictureSweepProgress): MessageDescriptor {
  if (phase === "asking") {
    return total > 0
      ? msg`Asking the hub about ${done} of ${total}`
      : msg`Asking the hub about your maps`;
  }
  if (phase === "encoding") {
    return total > 0
      ? msg`Making the pictures ${done} of ${total}`
      : msg`Making the pictures`;
  }
  if (phase === "sending") {
    return total > 0 ? msg`Sending ${done} of ${total}` : msg`Sending`;
  }
  return total > 0 ? msg`Read ${done} of ${total}` : msg`Reading your maps`;
}
