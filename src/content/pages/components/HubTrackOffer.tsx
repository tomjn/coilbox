import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import { useHubUrl } from "@/hub/config";
import { rememberTrackOnHub } from "@/hub/replayExtras/onHub";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { isHubEnabled } from "@/profile/profile";
import {
  contentReplayHubTrack,
  contentReplayHubTrackDownload,
} from "../../bindings";
import { ANALYSIS_ACTION_ATTRIBUTE } from "../../replayAnalysis";
import { refreshStoredTracks } from "../../replayTracks";

type State =
  | { step: "idle"; problem?: string }
  | { step: "asking" }
  | { step: "none" }
  | { step: "found"; size: number }
  | { step: "downloading"; size: number };

const IDLE: State = { step: "idle" };

export interface HubTrack {
  /** The hub can be asked about this match. */
  offered: boolean;
  /** The hub has a track to download, or it is on its way. */
  found: boolean;
  state: State;
  look: () => Promise<void>;
  download: () => Promise<void>;
}

/**
 * The hub's track of a match with no current track on this machine (issue
 * #5520). Nothing is sent to the hub until {@link HubTrack.look} is called.
 * `gameId` is left out when there is nothing to offer.
 */
export function useHubTrack(gameId: string | undefined): HubTrack {
  const hubUrl = useHubUrl();
  const offered = gameId !== undefined && isHubEnabled();
  // What is known belongs to one match on one hub.
  const key = `${hubUrl} ${gameId}`;
  const [held, setHeld] = useState<{ key: string; state: State }>({
    key,
    state: IDLE,
  });
  const state = offered && held.key === key ? held.state : IDLE;
  const set = (next: State) => setHeld({ key, state: next });

  async function look() {
    if (!gameId) return;
    set({ step: "asking" });
    try {
      const { track } = await contentReplayHubTrack({ hubUrl, gameId });
      set(track ? { step: "found", size: track.size } : { step: "none" });
    } catch (e) {
      set({ step: "idle", problem: describeError(e) });
    }
  }

  async function download() {
    if (!gameId || state.step !== "found") return;
    set({ step: "downloading", size: state.size });
    try {
      const { outcome } = await contentReplayHubTrackDownload({
        hubUrl,
        gameId,
      });
      if (outcome === "unavailable") {
        set({ step: "none" });
        return;
      }
      // Before the tracks are read again, so the automatic sender sees that
      // this one is the hub's own.
      rememberTrackOnHub(gameId, hubUrl);
      await refreshStoredTracks();
      set(IDLE);
    } catch (e) {
      set({ step: "idle", problem: describeError(e) });
    }
  }

  return {
    offered,
    found: state.step === "found" || state.step === "downloading",
    state,
    look,
    download,
  };
}

/** The button that downloads a track the hub was found to have. */
export function HubTrackDownload({ hubTrack }: { hubTrack: HubTrack }) {
  const { t } = useLingui();
  const { state } = hubTrack;
  if (state.step !== "found" && state.step !== "downloading") return null;
  const downloading = state.step === "downloading";
  const size = formatBytes(state.size);
  return (
    <Button
      type="button"
      variant="outline"
      className="w-fit gap-1.5"
      disabled={downloading}
      onClick={() => void hubTrack.download()}
      {...{ [ANALYSIS_ACTION_ATTRIBUTE]: "" }}
    >
      {downloading ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <Download className="size-4" />
      )}
      {downloading
        ? t`Downloading the track…`
        : t`Download the hub's track (${size})`}
    </Button>
  );
}

/** The button that asks the hub for a track, and what came of asking. */
export function HubTrackLook({ hubTrack }: { hubTrack: HubTrack }) {
  const { t } = useLingui();
  const { offered, state } = hubTrack;
  if (!offered) return null;
  if (state.step === "none") {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        <Trans>
          The hub has no track of this match that this version of coilbox can
          play.
        </Trans>
      </p>
    );
  }
  const asking = state.step === "asking";
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-fit gap-1.5"
        disabled={asking}
        onClick={() => void hubTrack.look()}
      >
        {asking ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <CoilboxGlyph size={16} />
        )}
        {asking ? t`Asking the hub…` : t`Look for a track on the hub`}
      </Button>
      {state.step === "idle" && state.problem && (
        <p className="text-xs text-destructive" role="alert">
          {state.problem}
        </p>
      )}
    </>
  );
}
