import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { SettingRow } from "@/components/SettingRow";
import { Progress } from "@/components/ui/progress";
import { describeError } from "@/i18n/uiError";
import { usePreferredTarget } from "@/play/config";
import {
  type SweepProgress,
  type SweepReport,
  sweepMapCatalog,
  sweepSummary,
} from "../../maps/catalogSweep";
import { SendButton } from "./SendButton";

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
  const { t, i18n } = useLingui();
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
      setFailed(describeError(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!agreed) return null;

  return (
    <SettingRow
      label={t`What your maps say`}
      description={
        progress ? (
          <>
            <span className="block">{i18n._(phaseWords(progress))}</span>
            <Progress
              value={progressPercent(progress)}
              className="mt-1.5 h-1.5 bg-muted"
              aria-label={t`Reading and sending your maps`}
            />
          </>
        ) : !target?.enginePath ? (
          t`Coilbox needs an engine installed before it can read your maps.`
        ) : report ? (
          sweepSummary(report)
        ) : undefined
      }
      error={failed}
      help={
        <>
          <p>
            <Trans>
              Coilbox can read the maps on this computer and tell the hub what
              is in them: how big each one is, how high its ground goes, how
              much of it is under water, how much wind and tidal power it has,
              and where players start. It sends no pictures and no files, only
              those measurements.
            </Trans>
          </p>
          <p>
            <Trans>
              It asks the hub what it already knows first, so most of a library
              costs nothing to check. Reading the rest takes a while on a large
              collection.
            </Trans>
          </p>
        </>
      }
      helpLabel={t`About sending what your maps say`}
    >
      <SendButton
        label={t`Send what your maps say`}
        running={running}
        disabled={!target?.enginePath}
        onClick={() => void run()}
      />
    </SettingRow>
  );
}

/** What a phase is called while it is running, counting maps. */
function phaseWords({ phase, done, total }: SweepProgress): MessageDescriptor {
  if (phase === "asking") {
    return total > 0
      ? msg`Asking the hub about ${done} of ${total}`
      : msg`Asking the hub about your maps`;
  }
  if (phase === "sending") {
    return total > 0 ? msg`Sending ${done} of ${total}` : msg`Sending`;
  }
  return total > 0 ? msg`Read ${done} of ${total}` : msg`Reading your maps`;
}

/** How far a phase has got, 0 to 100. Zero before a total is known, which is
 *  the moment right after a phase starts and before its first map has been
 *  read or its first batch answered. */
function progressPercent({ done, total }: SweepProgress): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}
