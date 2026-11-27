import { t } from "@lingui/core/macro";
import type { AnalysisAnswer, ArchiveUploadOutcome } from "../archiveUploads";
import { describeUploadEnd, type UploadEnding } from "../upload/messages";

/** The words for how sending a match's analysis or track went (issue #5495). */

/** Why the hub's check refused an analysis, in words. */
export function describeAnalysisRefusal(reason: string | null): string {
  switch (reason) {
    case "not_listed":
      return t`The hub stopped listing the replay before it checked the analysis.`;
    case "check_failed":
      return t`The hub could not finish checking the analysis.`;
    default:
      return t`The hub's check found the analysis does not match the replay.`;
  }
}

/** Why an analysis was not sent, in words. */
export function describeAnalysisStop(
  answer: Extract<AnalysisAnswer, { kind: "stopped" }>,
): string {
  switch (answer.code) {
    case "not_listed":
      return t`The hub does not list this replay yet. Send the replay first.`;
    case "unauthorised":
      return t`The hub did not accept your sign-in. Sign in again and try once more.`;
    case "unreachable":
      return t`Coilbox could not reach the hub. Try again later.`;
    default:
      return answer.said;
  }
}

/** Whether an analysis send that stopped this way is worth another try. */
export function analysisWorthAnotherTry(
  answer: Extract<AnalysisAnswer, { kind: "stopped" }>,
): boolean {
  const { source, code, status } = answer;
  if (source === "local") return true;
  if (status !== null && (status >= 500 || status === 408 || status === 429)) {
    return true;
  }
  return ["not_listed", "unauthorised", "unreachable", "bad_answer"].includes(
    code,
  );
}

/** What to tell a player when a track upload ends. */
export function describeTrackEnd(
  outcome: ArchiveUploadOutcome,
  label: string,
  heldAlready: boolean,
): UploadEnding {
  if (outcome.kind === "listed") {
    return heldAlready
      ? {
          level: "info",
          title: t`The hub already has a track of ${label}`,
          body: t`Nothing was uploaded.`,
          retry: false,
        }
      : {
          level: "success",
          title: t`The track of ${label} is on the hub`,
          retry: false,
        };
  }
  const notSent = t`The track of ${label} was not sent`;
  if (outcome.kind === "stopped") {
    switch (outcome.code) {
      case "no_analysis":
        return {
          level: "warning",
          title: notSent,
          body: t`The hub has not passed an analysis of this match yet. Try again once its check has finished.`,
          retry: true,
        };
      case "uploading":
        return {
          level: "warning",
          title: notSent,
          body: t`Someone else is sending a track of this match right now. Try again later.`,
          retry: true,
        };
      case "older_kept":
        return {
          level: "warning",
          title: notSent,
          body: t`The hub is keeping its older track of this match, because it cannot replace it right now. Try again later.`,
          retry: true,
        };
      case "unknown_format":
        return {
          level: "error",
          title: notSent,
          body: t`The hub does not take tracks in this format.`,
          retry: false,
        };
      case "not_listed":
      case "not_found":
        return {
          level: "error",
          title: notSent,
          body: t`The hub does not list this replay.`,
          retry: false,
        };
      case "no_track_mirror":
        return {
          level: "warning",
          title: notSent,
          body: t`No mirror can take an upload right now. Try again later.`,
          retry: true,
        };
    }
  }
  return describeUploadEnd(outcome, t`The track of ${label}`, {
    listed: null,
    game: null,
  });
}

/** Whether a track send that ended this way is worth another try later. */
export function trackWorthAnotherTry(
  outcome: Extract<ArchiveUploadOutcome, { kind: "stopped" }>,
): boolean {
  const { source, code, status } = outcome;
  if (source === "mirror") return code !== "removed" && code !== "too_large";
  if (source === "local") return true;
  if (status !== null && (status >= 500 || status === 408 || status === 429)) {
    return true;
  }
  return [
    "no_analysis",
    "uploading",
    "unauthorised",
    "unreachable",
    "no_track_mirror",
    "not_configured",
    "bad_answer",
  ].includes(code);
}
