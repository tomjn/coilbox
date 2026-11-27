import { useSetting } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { useStoredAnalyses } from "@/content/replayAnalysis";
import { signedInLobbyNames } from "@/content/replayHubName";
import { useStoredTracks } from "@/content/replayTracks";
import { useLastLogin, useLobbyAccounts } from "@/lobby-servers/config";
import { isHubAssetUploadOffered } from "@/profile/profile";
import { useHubAccount } from "../account";
import { useHubUrl } from "../config";
import {
  hubHasTrack,
  readReplayExtras,
  replayExtrasOn,
} from "../replayExtras/onHub";
import {
  AUTO_SEND_REPLAYS_KEY,
  queueReplayExtras,
  useReplaySendQueue,
} from "./queue";
import { runDueReplaySends, stopReplaySends } from "./runner";

/**
 * Runs the background sender (issue #5494). It draws nothing, and sits in the
 * topbar only because that is mounted for as long as the app is.
 */
export default function ReplayAutoSend() {
  const [on] = useSetting<boolean>(AUTO_SEND_REPLAYS_KEY, false);
  const enabled = on && isHubAssetUploadOffered();
  const { queue, extras } = useReplaySendQueue();
  useEffect(() => {
    if (!enabled) void stopReplaySends();
  }, [enabled]);
  if (!enabled) return null;
  // The sender asks who is signed in, which can raise a keychain prompt, so it
  // is only mounted while there is something to send.
  return (
    <>
      <FinishedRuns />
      {queue.length + extras.length > 0 && <Sender />}
    </>
  );
}

/**
 * Queues a match's analysis and track when an analysis run of it finishes while
 * the switch is on (issue #5495). A run that finished before the switch went on
 * is not sent by itself.
 *
 * A run records the track too, and writes the analysis first, so the track can
 * be read after the match has been sent without it. That queues the match
 * again. The analysis's time says whether the recording is new: a track's own
 * time moves when it is watched (issue #5523).
 */
function FinishedRuns() {
  const [since] = useState(Date.now);
  const hubUrl = useHubUrl();
  const analyses = useStoredAnalyses();
  const tracks = useStoredTracks();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const held = readReplayExtras();
    for (const analysis of analyses.values()) {
      const { gameId, analysedAtMs, outcome, map } = analysis;
      if (analysedAtMs < since || outcome !== "reproduced") continue;
      const keys = [`${gameId}:${analysedAtMs}`];
      // A track the hub is known to hold has nothing to be sent, which is
      // every track downloaded from it (issue #5520). One from a newer
      // recorder than the hub's does (issue #5525).
      const track = tracks.get(gameId);
      const record = replayExtrasOn(held, hubUrl, gameId);
      if (track?.state === "current" && !hubHasTrack(record, track)) {
        keys.push(`${gameId}:${analysedAtMs}:track`);
      }
      if (keys.every((key) => seen.current.has(key))) continue;
      for (const key of keys) seen.current.add(key);
      queueReplayExtras({ gameId, mapName: map });
    }
  }, [analyses, tracks, since, hubUrl]);
  return null;
}

function Sender() {
  const hubUrl = useHubUrl();
  const { signedIn, loading, unknown } = useHubAccount(hubUrl);
  const [accounts] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const { queue, extras, revision } = useReplaySendQueue();
  const [due, setDue] = useState(0);

  const account = signedIn ? "in" : loading || unknown ? "unknown" : "out";
  // As text, so an unchanged list does not read as news.
  const names = JSON.stringify(
    signedInLobbyNames(accounts.accounts, lastLogin),
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new queue or a retry coming due is a reason to run, and neither is read here
  useEffect(() => {
    void runDueReplaySends({ hubUrl, names: JSON.parse(names), account });
  }, [hubUrl, names, account, revision, due]);

  const now = Date.now();
  const waits = [...queue, ...extras]
    .map((item) => item.notBefore)
    .filter((at) => at > now);
  const next = waits.length > 0 ? Math.min(...waits) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a timer that fired a moment early has to be set again
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setDue((n) => n + 1), next - Date.now());
    return () => clearTimeout(timer);
  }, [next, due]);

  return null;
}
