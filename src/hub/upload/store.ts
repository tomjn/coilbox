import { openUrl } from "@tauri-apps/plugin-opener";
import { useSyncExternalStore } from "react";
import { type NotifyInput, notify } from "@/notify/notify";
import {
  type ArchiveKind,
  type ArchiveUploadPhase,
  type ArchiveUploadState,
  listArchiveUploads,
  onArchiveUploadChanged,
} from "../archiveUploads";
import { noteHubChanged } from "../manualSend/run";
import { gamePageUrl, mapPageUrl } from "../manualSend/status";
import { fetchMapFacts } from "../maps/lookup";
import { rememberReplayOnHub } from "../replaysOnHub";
import { describeUploadEnd, type UploadEnding } from "./messages";

/**
 * Archive uploads as the webview follows them (issue #5259).
 *
 * Rust owns each transfer and announces every change on an event. This keeps
 * the latest state of each upload for the topbar badge and the detail pages, and
 * says how an upload ended with a notification, so a player who left the page
 * still hears. It lives here rather than in a page for the same reason the
 * transfer lives in Rust.
 */

/** What the page that started an upload called it, for the messages. */
export interface UploadSubject {
  kind: "map" | "game" | "replay";
  /** What a person calls it. */
  label: string;
  /** A map's name, which the hub's map page is found by. */
  mapName?: string;
  /** A game's modinfo shortname, which the hub's game page is found by. */
  shortname?: string;
  /** A replay's game id, which the replay browser's mark is kept by. */
  gameId?: string;
}

const RANK: Record<ArchiveUploadPhase, number> = {
  reserving: 0,
  sending: 1,
  waiting: 2,
  done: 3,
};

let uploads: readonly ArchiveUploadState[] = [];
const listeners = new Set<() => void>();
/** By archive hash, which is what an upload and the page that started it share. */
const subjects = new Map<string, UploadSubject>();
const announced = new Set<string>();
/** Hashes of uploads a bulk run started, which it reports on itself. */
const quiet = new Set<string>();
let following: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Take in a state, from a start, the list or an event. A state that is behind
 * the one held is a late arrival and is dropped, because a start can answer after
 * the first events for the same upload.
 */
function apply(state: ArchiveUploadState, announce: boolean): void {
  const held = uploads.find((one) => one.opId === state.opId);
  if (held && RANK[held.phase] > RANK[state.phase]) return;
  uploads = held
    ? uploads.map((one) => (one.opId === state.opId ? state : one))
    : [...uploads, state];
  emit();
  if (state.phase === "done" && state.outcome && !announced.has(state.opId)) {
    announced.add(state.opId);
    if (announce) void announceEnd(state);
  }
}

/** Record an upload this page has just started, and what to call it. A
 *  `quiet` upload ends with no notification of its own, because whoever
 *  started it reports on a whole run at once. */
export function rememberUpload(
  state: ArchiveUploadState,
  subject: UploadSubject,
  options: { quiet?: boolean } = {},
): void {
  subjects.set(state.sha256, subject);
  if (options.quiet) quiet.add(state.sha256);
  apply(state, true);
}

/** Hear about every change to the uploads held. Call the returned function to
 *  stop. */
export function subscribeArchiveUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Start hearing about uploads, once. Safe to call from every mount. A failure to
 * listen is not remembered, so the next call tries again.
 */
export function followArchiveUploads(): Promise<void> {
  following ??= (async () => {
    await onArchiveUploadChanged((state) => apply(state, true));
    for (const state of await listArchiveUploads()) apply(state, false);
  })().catch((e: unknown) => {
    following = null;
    console.warn("could not follow archive uploads", e);
  });
  return following;
}

/** Every archive upload held right now. A stable reference between changes,
 *  which is what `useSyncExternalStore` needs. */
export function readArchiveUploads(): readonly ArchiveUploadState[] {
  return uploads;
}

/** Every archive upload the app has started, newest last. */
export function useArchiveUploads(): readonly ArchiveUploadState[] {
  return useSyncExternalStore(
    subscribeArchiveUploads,
    readArchiveUploads,
    readArchiveUploads,
  );
}

/** The most recent upload of this file to this hub, running or finished. */
export function uploadOf(
  list: readonly ArchiveUploadState[],
  hubUrl: string,
  kind: ArchiveKind,
  filename: string | undefined,
): ArchiveUploadState | undefined {
  if (!filename) return undefined;
  const base = (url: string) => url.replace(/\/+$/, "");
  return [...list]
    .reverse()
    .find(
      (one) =>
        one.kind === kind &&
        one.filename === filename &&
        base(one.hubUrl) === base(hubUrl),
    );
}

/** What a person called an upload, or its file name when nobody said. */
export function labelOf(state: ArchiveUploadState): string {
  return subjects.get(state.sha256)?.label ?? state.filename;
}

/** The hub pages a message about this upload can point at. */
export async function linksFor(
  state: ArchiveUploadState,
  subject: UploadSubject | undefined,
): Promise<{ listed: string | null; game: string | null }> {
  const game =
    subject?.kind === "game" && subject.shortname
      ? gamePageUrl(state.hubUrl, subject.shortname)
      : null;
  if (state.outcome?.kind !== "listed") return { listed: null, game };
  if (state.pageUrl) return { listed: state.pageUrl, game };
  if (game) return { listed: game, game };
  if (subject?.kind === "map" && subject.mapName) {
    try {
      const result = await fetchMapFacts(state.hubUrl, [subject.mapName]);
      const slug = result.ok ? result.maps[0]?.slug : undefined;
      if (slug) return { listed: mapPageUrl(state.hubUrl, slug), game };
    } catch {
      // No link is better than a notice that never arrives.
    }
  }
  return { listed: null, game };
}

/** The notification for an upload that has ended. */
export function endingToNotification(ending: UploadEnding): NotifyInput {
  const { link } = ending;
  return {
    title: ending.title,
    body: ending.body,
    level: ending.level,
    // A refusal is worth reading at leisure, and a toast that times out is not.
    sticky: ending.level === "error" || ending.level === "warning",
    action: link
      ? {
          label: link.label,
          onClick: () => void openUrl(link.url).catch(() => {}),
        }
      : undefined,
  };
}

async function announceEnd(state: ArchiveUploadState): Promise<void> {
  const { outcome } = state;
  if (!outcome) return;
  if (quiet.has(state.sha256)) {
    noteHubChanged();
    return;
  }
  const subject = subjects.get(state.sha256);
  if (state.kind === "replay" && outcome.kind === "listed" && subject?.gameId) {
    rememberReplayOnHub(subject.gameId, {
      hubUrl: state.hubUrl,
      url: state.pageUrl,
    });
  }
  const links = await linksFor(state, subject);
  void notify(
    endingToNotification(
      describeUploadEnd(outcome, labelOf(state), links, state.heldAlready),
    ),
  );
  // The hub may list the archive now, so pages ask it again.
  noteHubChanged();
}

/** Forget every upload. For tests, which must not inherit each other's. */
export function forgetArchiveUploads(): void {
  uploads = [];
  subjects.clear();
  announced.clear();
  quiet.clear();
  following = null;
  emit();
}
