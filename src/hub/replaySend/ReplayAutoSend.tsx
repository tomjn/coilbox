import { useSetting } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { signedInLobbyNames } from "@/content/replayHubName";
import { useLastLogin, useLobbyAccounts } from "@/lobby-servers/config";
import { isHubAssetUploadOffered } from "@/profile/profile";
import { useHubAccount } from "../account";
import { useHubUrl } from "../config";
import { AUTO_SEND_REPLAYS_KEY, useReplaySendQueue } from "./queue";
import { runDueReplaySends, stopReplaySends } from "./runner";

/**
 * Runs the background sender (issue #5494). It draws nothing, and sits in the
 * topbar only because that is mounted for as long as the app is.
 */
export default function ReplayAutoSend() {
  const [on] = useSetting<boolean>(AUTO_SEND_REPLAYS_KEY, false);
  const enabled = on && isHubAssetUploadOffered();
  const { queue } = useReplaySendQueue();
  useEffect(() => {
    if (!enabled) void stopReplaySends();
  }, [enabled]);
  // The sender asks who is signed in, which can raise a keychain prompt, so it
  // is only mounted while there is something to send.
  return enabled && queue.length > 0 ? <Sender /> : null;
}

function Sender() {
  const hubUrl = useHubUrl();
  const { signedIn, loading, unknown } = useHubAccount(hubUrl);
  const [accounts] = useLobbyAccounts();
  const [lastLogin] = useLastLogin();
  const { queue, revision } = useReplaySendQueue();
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
  const waits = queue.map((item) => item.notBefore).filter((at) => at > now);
  const next = waits.length > 0 ? Math.min(...waits) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a timer that fired a moment early has to be set again
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setDue((n) => n + 1), next - Date.now());
    return () => clearTimeout(timer);
  }, [next, due]);

  return null;
}
