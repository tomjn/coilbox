import { t } from "@lingui/core/macro";
import type { ArchiveUploadOutcome } from "../archiveUploads";

/** What to tell a player when an archive upload ends. */
export interface UploadEnding {
  level: "success" | "info" | "warning" | "error";
  title: string;
  body?: string;
  /** A hub page that goes with the message, with the words for its button. */
  link?: { url: string; label: string };
  /** Whether pressing upload again is a sensible next step. */
  retry: boolean;
}

/** Where the message can point a player, by what it is about. */
export interface UploadLinks {
  /** The archive's page on the hub, when it has one. */
  listed: string | null;
  /** The game's page on the hub, where its owner can be asked about. */
  game: string | null;
}

/**
 * The words for one way an upload can end.
 *
 * Worded from `outcome.code` and who refused. `said` is Rust's English and is
 * only the fallback for a code a newer hub or mirror sent. The hub's `duplicate`
 * and the mirror's `exists` are different messages: one means the hub already
 * lists the archive, the other means a mirror has a file the hub does not.
 */
export function describeUploadEnd(
  outcome: ArchiveUploadOutcome,
  label: string,
  links: UploadLinks,
): UploadEnding {
  if (outcome.kind === "listed") {
    return {
      level: "success",
      title: t`${label} is on the hub`,
      body: t`Other players can now download it from the hub's mirrors.`,
      link: links.listed
        ? { url: links.listed, label: t`Show on hub` }
        : undefined,
      retry: false,
    };
  }
  if (outcome.kind === "cancelled") {
    return {
      level: "info",
      title: t`Stopped uploading ${label}`,
      body: t`The mirror keeps what it received, so uploading it again carries on from there.`,
      retry: true,
    };
  }

  const notUploaded = t`${label} was not uploaded`;
  switch (outcome.code) {
    case "duplicate": {
      const existing = outcome.duplicate;
      const link = existing?.url
        ? { url: existing.url, label: t`Show on hub` }
        : undefined;
      const body =
        existing?.check === "sha256"
          ? t`The hub already has a file with exactly the same contents.`
          : existing?.check === "filename"
            ? t`The hub already has a file with the same name.`
            : existing?.check === "name_version"
              ? t`The hub already has an archive with the same name and version.`
              : t`The hub already has this archive.`;
      return {
        level: "info",
        title: t`The hub already has ${label}`,
        body,
        link,
        retry: false,
      };
    }
    case "not_owner":
      return {
        level: "error",
        title: notUploaded,
        body: t`Only the game's owner can upload it. You can ask to own it on the game's page on the hub.`,
        link: links.game
          ? { url: links.game, label: t`Open the game on the hub` }
          : undefined,
        retry: false,
      };
    case "unknown_game":
      return {
        level: "error",
        title: notUploaded,
        body: t`The hub does not know this game yet. Use Send to hub on this page first, then upload the file.`,
        retry: false,
      };
    case "no_mirror":
    case "unavailable":
    case "not_configured":
    case "uploads_disabled":
      return {
        level: "warning",
        title: notUploaded,
        body: t`No mirror can take an upload right now. Try again later.`,
        retry: true,
      };
    case "file_changed":
      return {
        level: "warning",
        title: notUploaded,
        body: t`The file changed while it was uploading. Upload it again to send the new version.`,
        retry: true,
      };
    case "exists":
      return {
        level: "error",
        title: notUploaded,
        body: t`A mirror already has a file with this name that the hub has not listed, so the hub cannot list this one.`,
        retry: false,
      };
    case "unauthorised":
      return {
        level: "error",
        title: notUploaded,
        body: t`The hub did not accept your sign-in. Sign in again, then upload it again.`,
        retry: true,
      };
    case "unreachable":
      return {
        level: "warning",
        title: notUploaded,
        body: t`Coilbox could not keep a connection to the hub or its mirror. Check your connection and upload it again to carry on.`,
        retry: true,
      };
    case "too_large":
      return {
        level: "error",
        title: notUploaded,
        body: t`The file is larger than the mirror takes.`,
        retry: false,
      };
    case "unreadable":
      return {
        level: "error",
        title: notUploaded,
        body: t`Coilbox could not read the file.`,
        retry: true,
      };
    case "hash_mismatch":
    case "expired":
    case "write_failed":
    case "internal_error":
      return {
        level: "warning",
        title: notUploaded,
        body: outcome.said,
        retry: true,
      };
    default:
      return {
        level: "error",
        title: notUploaded,
        body: outcome.said,
        retry: false,
      };
  }
}
