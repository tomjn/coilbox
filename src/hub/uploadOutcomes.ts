import type { NotifyInput } from "@/notify/notify";
import { notify } from "@/notify/notify";

/**
 * Telling somebody the hub would not take their pictures (issue #1634).
 *
 * A backfill runs in the background and has nowhere to put "the hub says this
 * build pic is not square". Logging it means the first anybody hears of it is a
 * game with no pictures on the website, so it goes through the notification path
 * instead. That is only reasonable because backfill is off until somebody turns
 * it on (issue #1635): an unprompted toast about a job the user started is not
 * an interruption.
 *
 * ## Why a whole run gets at most two
 *
 * A backfill of three hundred pictures that has three hundred rejections has one
 * problem, not three hundred. So the run is summarised rather than narrated: one
 * notification for the pictures the hub will never take, however many there were,
 * and one for a run that ended before it got through them. Both carry the hub's
 * own words for the first case of each, because the count says how big it is and
 * only the sentence says what it was.
 *
 * The split is the plugin's [`Verdict`], in
 * `crates/tauri-plugin-coilbox-hub/src/upload.rs`, and nothing here re-decides
 * it. A `terminal` rejection means coilbox produced a picture that does not match
 * the class it labelled it with, which is a bug here rather than anything the hub
 * or the user did, so it is worded as a failure. A run that stopped is the hub
 * saying not now, so it is worded as information.
 *
 * Nothing calls this yet. `hub_upload_assets` has no frontend caller because the
 * backfill that would run it is not written, and wiring this into it is
 * tomjn/coilbox#1679.
 */

/** What became of one asset, as `hub_upload_assets` answers. */
export type AssetUploadResult =
  | "uploaded"
  | "replaced"
  | "already_had"
  | "refused"
  | "not_attempted";

/**
 * Whether another request would say anything different. The plugin's own
 * `Verdict`, and the only thing this module classifies on.
 */
export type AssetUploadVerdict = "terminal" | "transient" | "blocked";

/** One asset's outcome, in the order the assets were given. */
export interface AssetOutcome {
  result: AssetUploadResult;
  /** The hub's status, or null when nothing was sent. */
  status: number | null;
  /** Why not, in the words of whoever objected, naming the picture. */
  said: string | null;
  /** Null when there was no refusal. */
  verdict: AssetUploadVerdict | null;
}

/** The first thing anybody actually said, or null when nobody did. */
function firstWords(outcomes: AssetOutcome[]): string | null {
  for (const outcome of outcomes) {
    const said = outcome.said?.trim();
    if (said) return said;
  }
  return null;
}

/**
 * What a finished run is worth telling somebody, as zero, one or two
 * notifications. Pure, so the aggregation can be asserted on without a window.
 */
export function assetUploadReports(outcomes: AssetOutcome[]): NotifyInput[] {
  const reports: NotifyInput[] = [];

  // The run ending first, because it is what explains a run having fewer
  // results than pictures. `transient` here has already had its retries.
  const stopped = outcomes.find(
    (o) => o.verdict === "blocked" || o.verdict === "transient",
  );
  if (stopped) {
    const untried = outcomes.filter((o) => o.result === "not_attempted").length;
    // Nothing left is the ordinary end of a run that stopped on its last
    // picture, and there is no number worth saying about it.
    const left =
      untried === 0
        ? ""
        : untried === 1
          ? " One more picture was not tried."
          : ` ${untried} more pictures were not tried.`;
    const why =
      stopped.said?.trim() || "The hub would not take any more just now.";
    reports.push({
      title: "Picture uploads stopped early",
      body: `${why}${left}`,
      level: "info",
    });
  }

  const terminal = outcomes.filter((o) => o.verdict === "terminal");
  if (terminal.length > 0) {
    const one = terminal.length === 1;
    // The reason in front of the consequence, because the reason is the only
    // part that says which picture and what was wrong with it.
    const consequence = one
      ? "Coilbox will not send it again: the same bytes get the same answer."
      : "Coilbox will not send them again: the same bytes get the same answer.";
    const said = firstWords(terminal);
    reports.push({
      title: one
        ? "The hub would not take a picture"
        : `The hub would not take ${terminal.length} pictures`,
      body: said ? `${said} ${consequence}` : consequence,
      level: "error",
    });
  }

  return reports;
}

/**
 * Tell somebody what a finished run came to. Fire and forget, the way the
 * download bindings notify: a failed toast must not fail an upload that worked.
 */
export function reportAssetUploadOutcomes(outcomes: AssetOutcome[]): void {
  for (const report of assetUploadReports(outcomes)) {
    void notify(report);
  }
}
