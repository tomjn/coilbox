import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ArrowUp, Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHubAccount } from "@/hub/account";
import { useHubUrl } from "@/hub/config";
import { beginReplayExtraSend, endManualSend } from "@/hub/manualSend/grant";
import {
  describeAnalysisRefusal,
  describeAnalysisStop,
  describeTrackEnd,
} from "@/hub/replayExtras/messages";
import {
  analysisPassed,
  replayExtrasOn,
  useReplayExtras,
} from "@/hub/replayExtras/onHub";
import {
  ANALYSIS_RECHECK_MS,
  sendStoredAnalysis,
  startStoredTrack,
  trackFilename,
} from "@/hub/replayExtras/send";
import { replayOnHub, useReplaysOnHub } from "@/hub/replaysOnHub";
import { uploadOf, useArchiveUploads } from "@/hub/upload/store";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { useLastLogin, useLobbyAccounts } from "../../../lobby-servers/config";
import type { DemoInfo } from "../../bindings";
import { useStoredAnalyses } from "../../replayAnalysis";
import { signedInLobbyNames, userNameInReplay } from "../../replayHubName";
import { useStoredTracks } from "../../replayTracks";

/** Run one send under a grant a press opened, and close the grant after. */
async function granted<T>(
  kind: "analysis" | "track",
  gameId: string,
  send: (grant: string) => Promise<T>,
): Promise<T> {
  const grant = await beginReplayExtraSend(kind, gameId);
  try {
    return await send(grant);
  } finally {
    await endManualSend(grant).catch((e: unknown) => {
      console.warn("could not end replay extra send grant", e);
    });
  }
}

/**
 * Sending a match's analysis, then its track, to the hub from the replay's
 * page (issue #5495).
 *
 * Shown once the hub lists the replay, to a player signed in to the hub who
 * was in the battle. It offers the analysis when one reproduced the match, and
 * the track once the hub's check has passed the analysis. A run that diverged
 * is never offered. While the hub checks an analysis the page sends it again
 * now and then, because that is how the hub says how the check went.
 */
export function SendReplayExtrasToHub({ info }: { info: DemoInfo }) {
  const { t } = useLingui();
  const hubUrl = useHubUrl();
  const account = useHubAccount(hubUrl);
  const [accounts] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const held = useReplaysOnHub();
  const extras = useReplayExtras();
  const analyses = useStoredAnalyses();
  const tracks = useStoredTracks();
  const uploads = useArchiveUploads();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const gameId = info.remixed ? undefined : info.gameId;
  const name = userNameInReplay(
    info,
    signedInLobbyNames(accounts.accounts, lastLogin),
  );
  const onHub = replayOnHub(held, hubUrl, gameId) !== undefined;
  const record = replayExtrasOn(extras, hubUrl, gameId);
  const stored = gameId ? analyses.get(gameId) : undefined;
  const reproduced = stored !== undefined && stored.outcome === "reproduced";
  const sentAnalysis =
    record?.analysis &&
    stored &&
    record.analysis.loggerVersion >= stored.loggerVersion
      ? record.analysis
      : undefined;
  const checking = sentAnalysis?.state === "checking";
  const shown =
    gameId !== undefined && !!name && onHub && account.signedIn && reproduced;

  // The hub answers a repeat of the same log with how its check went.
  useEffect(() => {
    if (!shown || !checking || !gameId) return;
    const timer = setInterval(() => {
      void granted("analysis", gameId, (grant) =>
        sendStoredAnalysis(hubUrl, gameId, grant),
      ).catch((e: unknown) => {
        console.warn("could not ask the hub about an analysis", e);
      });
    }, ANALYSIS_RECHECK_MS);
    return () => clearInterval(timer);
  }, [shown, checking, gameId, hubUrl]);

  if (!shown || !gameId) return null;
  const label = t`the match on ${info.mapName}`;

  const icons = (text: string, done = false) => (
    <>
      <CoilboxGlyph size={16} />
      {text}
      {done ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <ArrowUp className="size-4" aria-hidden />
      )}
    </>
  );
  const waiting = (text: string) => (
    <Button size="sm" variant="outline" className="gap-1.5" disabled>
      {icons(text)}
    </Button>
  );

  const sendAnalysis = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await granted("analysis", gameId, (grant) =>
        sendStoredAnalysis(hubUrl, gameId, grant),
      );
      if (answer.kind === "stopped") setProblem(describeAnalysisStop(answer));
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const sendTrack = async () => {
    setBusy(true);
    try {
      const upload = await granted("track", gameId, (grant) =>
        startStoredTrack(hubUrl, gameId, label, grant),
      );
      if (!upload) {
        void notify({
          title: t`The track of ${label} was not sent`,
          body: t`This match has no track to send.`,
          level: "error",
        });
      }
      setOpen(false);
    } catch (e) {
      void notify({
        title: t`The track of ${label} was not sent`,
        body: describeError(e),
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const panel = (trigger: string, body: ReactNode) => (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          {icons(trigger)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        {body}
      </PopoverContent>
    </Popover>
  );

  if (!sentAnalysis) {
    if (busy) return waiting(t`Sending analysis…`);
    if (problem) {
      return panel(
        t`Analysis not sent`,
        <>
          <p>{problem}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void sendAnalysis()}>
              {t`Send again`}
            </Button>
          </div>
        </>,
      );
    }
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => void sendAnalysis()}
      >
        {icons(t`Send analysis`)}
      </Button>
    );
  }

  if (checking) return waiting(t`The hub is checking the analysis…`);

  if (sentAnalysis.state === "refused") {
    return panel(
      t`Analysis refused`,
      <p>{describeAnalysisRefusal(sentAnalysis.reason)}</p>,
    );
  }

  if (!analysisPassed(sentAnalysis)) return null;
  const track = tracks.get(gameId);
  const upload = uploadOf(uploads, hubUrl, "track", trackFilename(gameId));
  const running = upload !== undefined && upload.phase !== "done";
  const ending =
    upload?.phase === "done" && upload.outcome && upload.opId !== dismissed
      ? upload.outcome
      : null;

  if (record?.track || ending?.kind === "listed") {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        {icons(t`Track on the hub`, true)}
      </Button>
    );
  }
  if (running) {
    return waiting(
      upload.phase === "waiting"
        ? t`The hub is checking the track…`
        : t`Sending track…`,
    );
  }
  if (ending && ending.kind !== "cancelled") {
    const said = describeTrackEnd(ending, label, upload?.heldAlready ?? false);
    return panel(
      t`Track not sent`,
      <>
        <p className="font-medium">{said.title}</p>
        {said.body && <p>{said.body}</p>}
        {said.retry && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => upload && setDismissed(upload.opId)}
            >
              {t`Send again`}
            </Button>
          </div>
        )}
      </>,
    );
  }
  if (track?.state !== "current") {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        {icons(t`Analysis on the hub`, true)}
      </Button>
    );
  }
  if (busy) return waiting(t`Sending track…`);
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => void sendTrack()}
    >
      {icons(t`Send track`)}
    </Button>
  );
}
