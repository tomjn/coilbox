import { t } from "@lingui/core/macro";
import { contentDemoInfo, type DemoInfo } from "@/content/bindings";
import { userNameInReplay } from "@/content/replayHubName";
import { readReplaySummary } from "@/content/replaySummaryRead";
import { describeError } from "@/i18n/uiError";
import { settingsWritten } from "@/lib/storedSetting";
import { notify } from "@/notify/notify";
import {
  type ArchiveUploadOutcome,
  type ArchiveUploadState,
  cancelArchiveUpload,
  startReplayUpload,
} from "../archiveUploads";
import { rememberReplayOnHub } from "../replaysOnHub";
import { describeUploadEnd } from "../upload/messages";
import {
  followArchiveUploads,
  muteReplayUpload,
  readArchiveUploads,
  rememberUpload,
  subscribeArchiveUploads,
  uploadOf,
} from "../upload/store";
import { describeSummaryProblem } from "./messages";
import {
  autoSendReplaysAllowed,
  clearReplaySendQueue,
  dropQueuedReplay,
  type QueuedReplay,
  readReplaySendQueue,
  updateQueuedReplay,
} from "./queue";

/**
 * Sending the queued replays, one at a time, in the background (issue #5494).
 *
 * A match is sent when it has a game id, reached game over, had people on two
 * or more sides, and one of the user's lobby names is in it. It is tried again
 * while the hub or a mirror cannot take it, and given up on when the hub
 * refuses it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long to wait before each further try. The last one repeats. */
export const RETRY_DELAYS_MS = [
  MINUTE,
  5 * MINUTE,
  30 * MINUTE,
  2 * HOUR,
  6 * HOUR,
];

/** How long after a match ends Coilbox stops trying to send it. */
export const GIVE_UP_AFTER_MS = 7 * 24 * HOUR;

export interface SendContext {
  hubUrl: string;
  /** The lobby names the user has signed in with. */
  names: readonly string[];
  /** Signed in to the hub. `unknown` is not asked yet, or no answer. */
  account: "in" | "out" | "unknown";
  now?: () => number;
}

/** How one try at one queued replay ended. */
type Step =
  /** Finished with, one way or another, and nothing to say about it. */
  | { kind: "done" }
  /** Waiting for a sign-in, which is not a try. */
  | { kind: "wait" }
  | { kind: "retry"; label: string; why: string }
  | { kind: "giveUp"; label: string; why: string };

/** The upload this sender is waiting on. */
let current: string | null = null;
let latest: SendContext | null = null;
let pass: Promise<void> | null = null;

/** Whether the hub can see the replay, from the sides people were on. A match
 *  with people on one side only is a match against AIs. */
function peopleOnBothSides(info: DemoInfo): boolean {
  const sides = info.players
    .filter((p) => !p.spectator && p.allyTeam !== undefined)
    .map((p) => p.allyTeam);
  return new Set(sides).size > 1;
}

/**
 * Whether a send that ended this way is worth another try. A mirror's or this
 * computer's trouble can pass. The hub's refusal of the replay does not.
 */
function worthAnotherTry(
  outcome: Extract<ArchiveUploadOutcome, { kind: "stopped" }>,
): boolean {
  const { source, code, status } = outcome;
  if (source === "mirror") return code !== "removed" && code !== "too_large";
  if (source === "local") return true;
  if (status !== null && (status >= 500 || status === 408 || status === 429)) {
    return true;
  }
  return [
    "unauthorised",
    "unreachable",
    "uploading",
    "no_replay_mirror",
    "not_configured",
    "unavailable",
    "bad_answer",
  ].includes(code);
}

/** The state an upload ends in. */
function ended(opId: string): Promise<ArchiveUploadState> {
  return new Promise((resolve) => {
    let stop = () => {};
    const look = () => {
      const state = readArchiveUploads().find((one) => one.opId === opId);
      if (state?.phase !== "done") return false;
      stop();
      resolve(state);
      return true;
    };
    if (look()) return;
    stop = subscribeArchiveUploads(look);
  });
}

async function send(item: QueuedReplay, context: SendContext): Promise<Step> {
  const filename = item.path.split(/[\\/]/).pop() ?? item.path;
  let label = filename;
  try {
    const { info } = await contentDemoInfo({
      enginePath: item.enginePath,
      replayPath: item.path,
    });
    const { mapName, gameId } = info;
    label = t`The replay on ${mapName}`;
    const name = userNameInReplay(info, context.names);
    if (
      !gameId ||
      !name ||
      info.remixed ||
      !info.winnersKnown ||
      info.durationSec <= 0 ||
      !peopleOnBothSides(info)
    ) {
      return { kind: "done" };
    }
    if (context.account !== "in") return { kind: "wait" };

    await followArchiveUploads();
    const held = uploadOf(
      readArchiveUploads(),
      context.hubUrl,
      "replay",
      filename,
    );
    // A send of this replay started from its page is waited for, not doubled.
    const theirs = held && held.phase !== "done" ? held : null;
    let running = theirs;
    let unmute = () => {};
    try {
      if (!running) {
        const made = await readReplaySummary(item, item.path, info);
        if ("problem" in made) {
          const why = describeSummaryProblem(made.problem);
          // A game that is installed later, or read again, can answer these.
          const later =
            made.problem.kind === "unknownUnit" ||
            made.problem.kind === "otherBuild";
          return { kind: later ? "retry" : "giveUp", label, why };
        }
        // The plugin reads the switch off disk before it lets the replay go.
        await settingsWritten();
        // Turned off while the replay was being read.
        if (!stillQueued(item)) return { kind: "done" };
        unmute = muteReplayUpload(filename);
        running = await startReplayUpload(
          context.hubUrl,
          item.path,
          gameId,
          name,
          made.summary,
        );
        rememberUpload(running, { kind: "replay", label, gameId });
        if (!stillQueued(item)) {
          await cancelArchiveUpload(running.opId);
          return { kind: "done" };
        }
        current = running.opId;
      }
      const state = await ended(running.opId);
      const { outcome } = state;
      if (!outcome || outcome.kind === "cancelled") return { kind: "done" };
      if (outcome.kind === "listed") {
        rememberReplayOnHub(gameId, {
          hubUrl: state.hubUrl,
          url: state.pageUrl,
        });
        return { kind: "done" };
      }
      const again = worthAnotherTry(outcome);
      // A send from the replay's page has already said why it was refused.
      if (theirs && !again) return { kind: "done" };
      const said = describeUploadEnd(outcome, label, {
        listed: null,
        game: null,
      });
      return {
        kind: again ? "retry" : "giveUp",
        label,
        why: said.body ?? outcome.said,
      };
    } finally {
      unmute();
      current = null;
    }
  } catch (e) {
    return { kind: "retry", label, why: describeError(e) };
  }
}

function stillQueued(item: QueuedReplay): boolean {
  return (
    autoSendReplaysAllowed() &&
    readReplaySendQueue().some((one) => one.path === item.path)
  );
}

function giveUp(item: QueuedReplay, label: string, why: string): void {
  dropQueuedReplay(item.path);
  void notify({
    title: t`${label} was not sent`,
    body: why,
    level: "error",
  });
}

function settle(item: QueuedReplay, step: Step, context: SendContext): void {
  // Turned off, or cleared, while the try was under way.
  if (!stillQueued(item)) return;
  const now = (context.now ?? Date.now)();
  const expired = now - item.queuedAt > GIVE_UP_AFTER_MS;
  switch (step.kind) {
    case "done":
      dropQueuedReplay(item.path);
      return;
    case "wait":
      // Nobody signed in for that long is not owed a surprise upload later.
      if (expired && context.account === "out") dropQueuedReplay(item.path);
      return;
    case "giveUp":
      giveUp(item, step.label, step.why);
      return;
    case "retry": {
      if (expired) {
        giveUp(item, step.label, step.why);
        return;
      }
      const wait =
        RETRY_DELAYS_MS[Math.min(item.attempts, RETRY_DELAYS_MS.length - 1)];
      updateQueuedReplay(item.path, {
        attempts: item.attempts + 1,
        notBefore: now + wait,
      });
    }
  }
}

async function runPass(): Promise<void> {
  // Each replay is tried once for each context, so one left waiting for a
  // sign-in does not come round until there is news.
  const tried = new Set<string>();
  let seen: SendContext | null = null;
  while (latest && autoSendReplaysAllowed()) {
    const context: SendContext = latest;
    if (context !== seen) tried.clear();
    seen = context;
    const now = (context.now ?? Date.now)();
    const item = readReplaySendQueue().find(
      (one) => !tried.has(one.path) && one.notBefore <= now,
    );
    if (!item) return;
    tried.add(item.path);
    settle(item, await send(item, context), context);
  }
}

/**
 * Try every queued replay that is due. Safe to call at any time: a call during a
 * pass hands that pass the newer context, and resolves when it ends.
 */
export function runDueReplaySends(context: SendContext): Promise<void> {
  latest = context;
  pass ??= runPass().finally(() => {
    pass = null;
  });
  return pass;
}

/** Forget what is queued and stop the upload under way, for the switch being
 *  turned off. */
export async function stopReplaySends(): Promise<void> {
  latest = null;
  clearReplaySendQueue();
  const opId = current;
  current = null;
  if (!opId) return;
  await cancelArchiveUpload(opId).catch((e: unknown) => {
    console.warn("could not stop a replay upload", e);
  });
}
