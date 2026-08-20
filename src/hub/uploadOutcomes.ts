import type { NotifyInput } from "@/notify/notify";
import { notify, recordQuietly } from "@/notify/notify";

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
 * waiting for the answer. A run coilbox started by itself is filed in the
 * notifications bell without a toast and without a badge (issue #1703), so
 * somebody wondering why a game has no pictures can go and read what the hub
 * said, days later, without having been told while they were doing something
 * else. The console line stays for whoever has devtools open, which is not the
 * player this is for.
 *
 * Every caller has to answer, because {@link UploadInitiator} is a required
 * argument rather than one with a default. A default would decide this by
 * whichever way the next caller was written.
 *
 * ## Every report names the game
 *
 * The refusal issue #1690 was named after read "no recorded permission to
 * redistribute pictures for that game", which is the hub's sentence about a
 * request it can see and the reader cannot. Somebody who plays four games and
 * finds one of them has no pictures is being told about a game they have to
 * guess. So {@link UploadRun} carries the game, and the sentences say it.
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

/** What was true of the whole run, as against what was true of one picture in
 *  it. Both fields are things only the run knows. */
export interface UploadRun {
  /**
   * The game these pictures are for, or null when the run was not for one game.
   * Every sentence that counts pictures names it, because the reader is looking
   * at an app that holds several games and the hub's own words say "that game".
   */
  game?: string | null;
  /**
   * The plugin's answer to whether the hub names an asset vocabulary this build
   * does not hold (issue #1708). When it does, the terminal report says so
   * instead of quoting the hub, because "update coilbox" is something the reader
   * can act on and "this build pic is not square" is not. Omitted means nobody
   * knows, which is what a hub serving no digest leaves behind.
   */
  outOfDate?: boolean;
}

/**
 * "picture for bar" or "pictures for bar", and neither half of that when the run
 * was not for one game. The count goes in front of it at the call site, because
 * some of these sentences count and some of them say "any more".
 *
 * Plural for every count but one, so a sentence with no number in it asks for
 * the plural by passing anything else.
 */
function pictures(count: number, game: string | null | undefined): string {
  const noun = count === 1 ? "picture" : "pictures";
  return game ? `${noun} for ${game}` : noun;
}

/**
 * What a finished run is worth telling somebody, as zero, one or two
 * notifications. Pure, so the aggregation can be asserted on without a window.
 */
export function assetUploadReports(
  outcomes: AssetOutcome[],
  run: UploadRun = {},
): NotifyInput[] {
  const { game = null, outOfDate = false } = run;
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
          ? ` One more ${pictures(1, game)} was not tried.`
          : ` ${untried} more ${pictures(untried, game)} were not tried.`;
    // The fallback names the game because it is the one branch here with no
    // sentence from the hub, and the hub's sentences name the picture.
    const why =
      stopped.said?.trim() ||
      `The hub would not take any more ${pictures(0, game)} just now.`;
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
        ? `The hub refused a ${pictures(1, game)}`
        : `The hub refused all ${terminal.length} ${pictures(terminal.length, game)}`;
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
  run: UploadRun = {},
): NotifyInput {
  const { game = null } = run;
  const left =
    assets === 1
      ? `One ${pictures(1, game)} was not sent.`
      : `${assets} ${pictures(assets, game)} were not sent.`;
  return {
    title: "Picture uploads stopped early",
    body: `${said.trim() || "The hub would not take any just now."} ${left}`,
    level: "info",
  };
}

/**
 * What a run somebody stopped is worth leaving behind (issue #1686).
 *
 * Pressing the button is its own answer, so this is not news. It is here because
 * a stop is not an undo: a picture the hub took before the button was pressed is
 * on the hub, in a public repository, and the person who has just changed their
 * mind about uploading is exactly the person that matters to.
 *
 * The count is what actually reached the hub, not what the run was working
 * through, so a stop during the drawing half says nothing went and means it.
 */
export function assetUploadStoppedReport(
  sent: number,
  run: UploadRun = {},
): NotifyInput {
  const { game = null } = run;
  const already =
    sent === 0
      ? "Nothing had been sent, so nothing was added to the hub."
      : sent === 1
        ? "One picture had already gone, and it stays on the hub."
        : `${sent} pictures had already gone, and they stay on the hub.`;
  return {
    title: "You stopped the picture uploads",
    body: `Coilbox has stopped sending ${pictures(0, game)}. ${already}`,
    level: "info",
  };
}

/**
 * Where the bell sends somebody who clicks one of these. The hub settings
 * section holds the switch that permits uploads at all, which is both the
 * explanation for a run they did not start and the way to stop the next one.
 */
const HUB_SETTINGS = "/settings/hub";

/**
 * Deliver what a run has to say, to whoever it is for (issues #1690, #1703).
 *
 * A run somebody started is shown and recorded, so it is still findable after
 * the toast has gone. A run coilbox started is recorded and not shown: the
 * notifications bell keeps it, with no toast and no unread badge, and somebody
 * who wonders why a game has no pictures can open the bell and read the hub's
 * own words whenever they get round to it.
 *
 * The console line stays for both, because it carries the same sentence to
 * whoever is looking at a log rather than at the app.
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
    recordQuietly({ ...report, to: HUB_SETTINGS });
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
  run: UploadRun = {},
): void {
  deliver(assetUploadReports(outcomes, run), startedBy);
}

/**
 * File what a run somebody stopped left behind (issue #1686).
 *
 * Always the quiet path, whoever started the run. The person pressed the button
 * a moment ago and watched the badge go, so a toast would be telling them what
 * they just did. What the bell holds is the part they may want later: what had
 * already gone.
 */
export function reportAssetUploadStopped(sent: number, run: UploadRun = {}): void {
  deliver([assetUploadStoppedReport(sent, run)], "coilbox");
}

/** Tell whoever it is for that a run never started. */
export function reportAssetUploadFailure(
  said: string,
  assets: number,
  startedBy: UploadInitiator,
  run: UploadRun = {},
): void {
  deliver([assetUploadFailureReport(said, assets, run)], startedBy);
}
