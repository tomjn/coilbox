import type { NotifyInput } from "@/notify/notify";
import { notify } from "@/notify/notify";

/**
 * Telling somebody the hub would not take their pictures (issue #1634).
 *
 * A backfill runs in the background and has nowhere to put "the hub says this
 * build pic is not square". Logging it means the first anybody hears of it is a
 * game with no pictures on the website, so a run somebody started says it out
 * loud through the notification path.
 *
 * ## Who asked decides where it goes (issue #1690)
 *
 * Agreeing to send pictures at all (issue #1635) is permission to upload in the
 * background. It is not permission to put an error in front of somebody who was
 * reading a base layout, which is what happened when a Splinter Faction
 * blueprint was opened and the hub refused the game. So the run carries one more
 * bit than #1634 gave it: who started it.
 *
 * A run a person started is worth interrupting them about, because they are
 * waiting for the answer. A run coilbox started by itself goes to the console
 * with the same words, so somebody wondering why a game has no pictures can find
 * out without being told while they were doing something else.
 *
 * Every caller has to answer, because {@link UploadInitiator} is a required
 * argument rather than one with a default. A default would decide this by
 * whichever way the next caller was written.
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
 * `src/hub/assets/upload.ts` is the only caller, and it is the only door to
 * `hub_upload_assets`, so a run cannot be started without being reported on
 * (issue #1679).
 */

/**
 * Who started an upload run (issue #1690).
 *
 * `user` is somebody who pressed something and is waiting for the answer.
 * `coilbox` is everything the app decided to do on its own, which today is the
 * blueprint backfill and nothing else.
 */
export type UploadInitiator = "user" | "coilbox";

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
 *
 * `outOfDate` is the plugin's answer to whether the hub names an asset vocabulary
 * this build does not hold (issue #1708). When it does, the terminal report says
 * so instead of quoting the hub, because "update coilbox" is something the reader
 * can act on and "this build pic is not square" is not. Omitted means nobody
 * knows, which is what a hub serving no digest leaves behind.
 */
export function assetUploadReports(
  outcomes: AssetOutcome[],
  outOfDate = false,
): NotifyInput[] {
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
    const said = firstWords(terminal);
    if (outOfDate) {
      // One cause for the whole run, so the count is the only number worth
      // saying and the hub's own words are not: they describe a picture, and
      // what is wrong is the build that made every one of them.
      const refused = one
        ? "The hub refused a picture"
        : `The hub refused all ${terminal.length} pictures`;
      reports.push({
        title: "Coilbox is out of date",
        body: `${refused} because this copy of coilbox makes them the way an older hub took them. Update coilbox and they will go.`,
        level: "error",
      });
    } else {
      // The reason in front of the consequence, because the reason is the only
      // part that says which picture and what was wrong with it.
      const consequence = one
        ? "Coilbox will not send it again: the same bytes get the same answer."
        : "Coilbox will not send them again: the same bytes get the same answer.";
      reports.push({
        title: one
          ? "The hub would not take a picture"
          : `The hub would not take ${terminal.length} pictures`,
        body: said ? `${said} ${consequence}` : consequence,
        level: "error",
      });
    }
  }

  return reports;
}

/**
 * What a run that never started is worth telling somebody (issue #1679).
 *
 * Not an outcome, because there are none: no usable sign-in, no permission to
 * send pictures at all, or a hub that never answered stops the run before the
 * first picture, so there is nothing positional to summarise. It is worded here
 * rather than at the call site so all of these sentences stay in one module.
 *
 * Information rather than an error, and the same title a run that stopped
 * partway gets, because from the reader's side they are the same event: the
 * pictures did not go, and the reason is somebody else's to fix.
 */
export function assetUploadFailureReport(
  said: string,
  assets: number,
): NotifyInput {
  const left =
    assets === 1
      ? "One picture was not sent."
      : `${assets} pictures were not sent.`;
  return {
    title: "Picture uploads stopped early",
    body: `${said.trim() || "The hub would not take any just now."} ${left}`,
    level: "info",
  };
}

/**
 * Deliver what a run has to say, to whoever it is for (issue #1690).
 *
 * A notification is recorded in the bell's history as well as shown, so a run
 * somebody started is findable after the toast has gone. A run coilbox started
 * gets neither, and the console line is what it has instead.
 *
 * Fire and forget, the way the download bindings notify: a failed toast must not
 * fail an upload that worked.
 */
function deliver(reports: NotifyInput[], startedBy: UploadInitiator): void {
  for (const report of reports) {
    if (startedBy === "user") {
      void notify(report);
      continue;
    }
    console.warn(
      report.body
        ? `hub picture upload: ${report.title}: ${report.body}`
        : `hub picture upload: ${report.title}`,
    );
  }
}

/** Tell whoever it is for what a finished run came to. */
export function reportAssetUploadOutcomes(
  outcomes: AssetOutcome[],
  startedBy: UploadInitiator,
  outOfDate = false,
): void {
  deliver(assetUploadReports(outcomes, outOfDate), startedBy);
}

/** Tell whoever it is for that a run never started. */
export function reportAssetUploadFailure(
  said: string,
  assets: number,
  startedBy: UploadInitiator,
): void {
  deliver([assetUploadFailureReport(said, assets)], startedBy);
}
