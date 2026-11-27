/**
 * Sending a map or game archive to a hub mirror (issue #5258), as the webview
 * sees it.
 *
 * The transfer belongs to the app, not to the page. `startArchiveUpload`
 * answers as soon as it is running, and leaving the page changes nothing. A
 * page finds an upload again by asking `listArchiveUploads` for the one whose
 * `sha256` is the archive it shows, and hears about changes through
 * `onArchiveUploadChanged`, which carries the same `ArchiveUploadState` the
 * list answers with.
 *
 * Every way an upload can end is an `ArchiveUploadOutcome` in the final state,
 * never a rejected promise. `code` is what to word a message from, and `said`
 * is an English sentence for a log or for a page with no wording yet.
 *
 * The field names inside `ArchiveFacts` are snake case because the struct is
 * the hub's request body as well as the argument, and the hub reads those
 * names. `ArchiveUploadState` is camel case, like the other states that
 * come back from Rust.
 */

import { defineCommand } from "@picoframe/plugin-sdk";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** What `unitsync_upload_facts` answers with in `facts`. */
export interface ArchiveFacts {
  /** SHA-256 of the whole archive file, 64 lowercase hex characters. */
  sha256: string;
  size: number;
  filename: string;
  kind: "map" | "game";
  internal_name: string;
  version: string;
  shortname: string | null;
  author: string | null;
  description: string | null;
}

/** An engine build's facts: what `dl_engine_upload_facts` answers with, the
 *  fields a map or game has and an engine does not, and the uploader's note. */
export interface EngineArchiveFacts extends Omit<ArchiveFacts, "kind"> {
  kind: "engine";
  /** Such as `arm64-macos`. */
  platform: string;
  /** What the uploader says about the build, 1 to 1,000 characters. */
  note: string;
}

export type ArchiveKind = "map" | "game" | "engine" | "replay";

/** Where an upload has got to. `waiting` is the mirror holding every byte and
 *  the hub not having listed the archive yet. */
export type ArchiveUploadPhase = "reserving" | "sending" | "waiting" | "done";

/** What the hub says it already has, on a `duplicate` refusal. */
export interface ArchiveDuplicate {
  /** What matched: the hash or the file name. */
  check: string | null;
  filename: string | null;
  kind: string | null;
  state: string | null;
  /** The archive's page on the hub, when it is listed and has one. */
  url: string | null;
}

/**
 * The codes a page can meet, by who refused. Any other string is a code a newer
 * hub or mirror sent, and `said` has its words.
 *
 * - hub: `bad_request`, `unauthorised`, `not_owner`, `duplicate`,
 *   `unknown_game`, `unknown_map`, `no_mirror`, `not_engine_uploader`,
 *   `no_engine_mirror`, `not_configured`, `unavailable`, `failed`,
 *   `removed`, `not_found`
 * - mirror: `exists`, `hash_mismatch`, `removed`, `expired`, `bad_token`,
 *   `wrong_mirror`, `too_large`, `bad_request`, `write_failed`,
 *   `internal_error`, `not_configured`, `uploads_disabled`, `bad_offset`,
 *   `unreachable`
 * - hub, for a replay: `refused_<reason>`, `replay_removed`, `lapsed`,
 *   `not_sent`, `not_kept`
 * - local: `unauthorised`, `unreachable`, `file_changed`, `unreadable`,
 *   `bad_answer`
 *
 * `exists` is the mirror already holding a file of that name. It is not the
 * hub's `duplicate`, which is the hub already knowing the archive.
 */
export type ArchiveUploadOutcome =
  | { kind: "listed" }
  /** Stopped by the person. The mirror keeps what it received, so sending the
   *  same archive again carries on from there. */
  | { kind: "cancelled" }
  | {
      kind: "stopped";
      source: "hub" | "mirror" | "local";
      code: string;
      status: number | null;
      said: string;
      duplicate?: ArchiveDuplicate;
    };

export interface ArchiveUploadState {
  /** What `cancelArchiveUpload` takes. */
  opId: string;
  hubUrl: string;
  filename: string;
  kind: ArchiveKind;
  /** The archive's hash, which is how a page finds the upload for the archive
   *  it is showing. */
  sha256: string;
  phase: ArchiveUploadPhase;
  /** Bytes the mirror is known to hold. */
  sent: number;
  size: number;
  /** The hub's id for the upload, once it has given one. */
  uploadId: string | null;
  /** The page the hub shows it on, once it says. Only a replay's answer
   *  carries one. */
  pageUrl: string | null;
  /** The hub held this replay before this send, so nothing was uploaded. */
  heldAlready: boolean;
  /** Set when `phase` is `done`. */
  outcome: ArchiveUploadOutcome | null;
}

/** The event every change to an upload is announced on. */
export const ARCHIVE_UPLOAD_EVENT = "coilbox-hub://archive-upload";

const hubArchiveUploadStart = defineCommand<
  {
    hubUrl: string;
    path: string;
    facts: ArchiveFacts | EngineArchiveFacts;
    grant?: string;
  },
  { upload: ArchiveUploadState }
>("coilbox-hub", "hub_archive_upload_start");

const hubReplayUploadStart = defineCommand<
  {
    hubUrl: string;
    path: string;
    gameId: string;
    name: string;
    summary: unknown;
    grant?: string;
  },
  { upload: ArchiveUploadState }
>("coilbox-hub", "hub_replay_upload_start");

/**
 * Start sending a replay of a match the user was in (issue #5493), and answer as
 * soon as it is running. It is followed like an archive upload, with `kind`
 * `replay`. Rust works out the file's hash and size itself.
 *
 * `name` is the name the user was in the battle under, and `summary` what the
 * replay page read out of the file (`content/replaySummary.ts`). `grant` is the
 * one a press of the replay's send button opened. Without one the send is only
 * allowed while the player's "send my finished matches" switch is on (issue
 * #5494).
 */
export async function startReplayUpload(
  hubUrl: string,
  path: string,
  gameId: string,
  name: string,
  summary: unknown,
  grant?: string,
): Promise<ArchiveUploadState> {
  const { upload } = await hubReplayUploadStart({
    hubUrl,
    path,
    gameId,
    name,
    summary,
    ...(grant ? { grant } : {}),
  });
  return upload;
}

const hubArchiveUploadList = defineCommand<
  Record<string, never>,
  { uploads: ArchiveUploadState[] }
>("coilbox-hub", "hub_archive_upload_list");

const hubArchiveUploadCancel = defineCommand<
  { opId: string },
  Record<string, never>
>("coilbox-hub", "hub_archive_upload_cancel");

/**
 * Start sending an archive, and answer as soon as it is running.
 *
 * Rejects only when the send could not start: no permission, no usable hub
 * address, or an archive that is not where it was or not the size its facts say.
 * Everything after that is in the state's `outcome`. Starting an archive that is
 * already on its way answers the upload that is running.
 *
 * `grant` is the one a press of "Send to hub" opened for this map or game. See
 * `manualSend/grant.ts`.
 */
export async function startArchiveUpload(
  hubUrl: string,
  path: string,
  facts: ArchiveFacts | EngineArchiveFacts,
  grant?: string,
): Promise<ArchiveUploadState> {
  const { upload } = await hubArchiveUploadStart({
    hubUrl,
    path,
    facts,
    ...(grant ? { grant } : {}),
  });
  return upload;
}

/** Every archive upload this run of the app has started, finished ones
 *  included. */
export async function listArchiveUploads(): Promise<ArchiveUploadState[]> {
  const { uploads } = await hubArchiveUploadList({});
  return uploads;
}

/** Stop an upload by its `opId`. A no-op for an unknown or finished one. */
export async function cancelArchiveUpload(opId: string): Promise<void> {
  await hubArchiveUploadCancel({ opId });
}

/** Hear about every change to every archive upload. Call the returned function
 *  to stop. */
export function onArchiveUploadChanged(
  handler: (state: ArchiveUploadState) => void,
): Promise<UnlistenFn> {
  return listen<ArchiveUploadState>(ARCHIVE_UPLOAD_EVENT, (event) =>
    handler(event.payload),
  );
}

const hubCanUploadEngines = defineCommand<
  { hubUrl: string },
  { allowed: boolean }
>("coilbox-hub", "hub_can_upload_engines");

/**
 * Whether whoever is signed in to this hub may upload engine builds: a
 * moderator granted it, or they are a moderator. False when nobody is signed
 * in. Asked fresh each time.
 */
export async function canUploadEngines(hubUrl: string): Promise<boolean> {
  const { allowed } = await hubCanUploadEngines({ hubUrl });
  return allowed;
}
