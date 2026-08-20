import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notify, recordQuietly } = vi.hoisted(() => ({
  notify: vi.fn(),
  recordQuietly: vi.fn(),
}));
vi.mock("@/notify/notify", () => ({ notify, recordQuietly }));

import {
  type AssetOutcome,
  assetUploadFailureReport,
  assetUploadReports,
  assetUploadStoppedReport,
  reportAssetUploadFailure,
  reportAssetUploadOutcomes,
  reportAssetUploadStopped,
} from "./uploadOutcomes";

/** The hub's own words for the refusal issue #1634 is named after, as its
 * `checkAssetImage` produced them, wrapped the way the plugin wraps a refusal. */
function notSquare(unit: string): AssetOutcome {
  return {
    result: "refused",
    status: 400,
    said: `The hub at coilbox.example refused bar's ${unit} buildpic: A "buildpic" must be square, and that one is 256x128.`,
    verdict: "terminal",
  };
}

function taken(): AssetOutcome {
  return { result: "uploaded", status: 201, said: null, verdict: null };
}

function untried(): AssetOutcome {
  return { result: "not_attempted", status: null, said: null, verdict: null };
}

describe("assetUploadReports", () => {
  /** The whole point of aggregating. A backfill of three hundred pictures that
   * rejects forty has one problem, and forty toasts would bury it. */
  it("says one thing about forty rejections, not forty", () => {
    const outcomes = Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`));

    const reports = assetUploadReports(outcomes);

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("The hub would not take 40 pictures");
  });

  /** The count is what says how big it is and the sentence is what says what it
   * was, so the words of the first one survive the summary. */
  it("carries the hub's own words for the first rejection", () => {
    const reports = assetUploadReports([
      taken(),
      notSquare("armsolar"),
      notSquare("armcom"),
    ]);

    expect(reports[0].body).toContain("bar's armsolar buildpic");
    expect(reports[0].body).toContain("must be square");
    expect(reports[0].body).toContain("will not send them again");
    expect(reports[0].level).toBe("error");
  });

  it("words a single rejection in the singular", () => {
    const reports = assetUploadReports([taken(), notSquare("armsolar")]);

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("The hub would not take a picture");
    expect(reports[0].body).toContain("will not send it again");
  });

  /** A run that ended is a different fact from a picture that was refused: it
   * says why the rest have no result at all. */
  it("says a run stopped early, and how much of it never ran", () => {
    const outcomes: AssetOutcome[] = [
      taken(),
      {
        result: "refused",
        status: 429,
        said: "The hub at coilbox.example refused bar's armcom buildpic: Too many uploads for that subject in the last hour, which is capped at 100. Try again later.",
        verdict: "blocked",
      },
      untried(),
      untried(),
    ];

    const reports = assetUploadReports(outcomes);

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("Picture uploads stopped early");
    expect(reports[0].body).toContain("capped at 100");
    expect(reports[0].body).toContain("2 more pictures were not tried.");
    // The hub saying not now is not coilbox being wrong, so it is not worded as
    // a failure.
    expect(reports[0].level).toBe("info");
  });

  /** A hub that would not answer has already had its retries by the time this
   * sees it, so it reads the same as any other stop. */
  it("treats a hub that never answered as a stop rather than a bad picture", () => {
    const reports = assetUploadReports([
      {
        result: "refused",
        status: 503,
        said: "The hub at coilbox.example refused bar's armsolar buildpic: The upload quotas could not be read just now. Try again shortly.",
        verdict: "transient",
      },
      untried(),
    ]);

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("Picture uploads stopped early");
    expect(reports[0].body).toContain("One more picture was not tried.");
  });

  /** Two facts, so two notifications, and never more than that however long the
   * run was. */
  it("says at most two things about a run, whatever its size", () => {
    const outcomes: AssetOutcome[] = [
      ...Array.from({ length: 120 }, (_, n) => notSquare(`u${n}`)),
      {
        result: "refused",
        status: 401,
        said: "The hub at coilbox.example did not accept the sign-in. Sign in again and try once more.",
        verdict: "blocked",
      },
      ...Array.from({ length: 200 }, untried),
    ];

    const reports = assetUploadReports(outcomes);

    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.title)).toEqual([
      "Picture uploads stopped early",
      "The hub would not take 120 pictures",
    ]);
  });

  it("says nothing about a run where nothing went wrong", () => {
    expect(
      assetUploadReports([
        taken(),
        { result: "already_had", status: null, said: null, verdict: null },
        { result: "replaced", status: 200, said: null, verdict: null },
      ]),
    ).toEqual([]);
  });

  it("says nothing about an empty run", () => {
    expect(assetUploadReports([])).toEqual([]);
  });

  /** A cancelled run is untried assets and no refusal, which is somebody getting
   * what they asked for rather than something to be told about. */
  it("says nothing about a run somebody cancelled", () => {
    expect(assetUploadReports([untried(), untried(), untried()])).toEqual([]);
  });

  /** The stop sentence has to stand on its own when the picture that stopped the
   * run was the last one in it. */
  it("leaves out the count when there was nothing left to try", () => {
    const reports = assetUploadReports([
      {
        result: "refused",
        status: 429,
        said: "Too many uploads for that subject in the last hour.",
        verdict: "blocked",
      },
    ]);

    expect(reports[0].body).toBe(
      "Too many uploads for that subject in the last hour.",
    );
  });
});

/** Issue #1708. The plugin has asked the hub which vocabulary it takes, and the
 * answer was not this build's, so every one of these refusals has one cause and
 * one thing the reader can do about it. */
describe("a run refused by a hub this build does not agree with", () => {
  it("says coilbox is out of date rather than quoting the hub", () => {
    const outcomes = Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`));

    const reports = assetUploadReports(outcomes, { outOfDate: true });

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("Coilbox is out of date");
    expect(reports[0].body).toContain("refused all 40 pictures");
    expect(reports[0].body).toContain("Update coilbox");
    expect(reports[0].level).toBe("error");
  });

  /** The hub's sentence describes one picture. What is wrong is the build that
   * made every one of them, so repeating it would point at the wrong thing. */
  it("leaves the hub's words about a single picture out of it", () => {
    const reports = assetUploadReports([notSquare("armsolar")], {
      outOfDate: true,
    });

    expect(reports[0].body).not.toContain("must be square");
    expect(reports[0].body).toContain("refused a picture");
  });

  /** A hub serving no digest, or one serving this build's own, leaves the
   * wording exactly as #1634 wrote it. */
  it("says nothing about being out of date when nobody said it was", () => {
    const reports = assetUploadReports([notSquare("armsolar")]);

    expect(reports[0].title).toBe("The hub would not take a picture");
    expect(reports[0].body).toContain("must be square");
  });

  /** The flag rides on the whole run, and a run that stopped early stopped for
   * the hub's own reasons. Only the terminal report changes. */
  it("leaves a run that stopped early worded as it was", () => {
    const reports = assetUploadReports(
      [
        {
          result: "refused",
          status: 503,
          said: "Try later.",
          verdict: "transient",
        },
        untried(),
      ],
      { outOfDate: true },
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].title).toBe("Picture uploads stopped early");
  });
});

/**
 * Issue #1703. The refusal #1690 was named after said "no recorded permission to
 * redistribute pictures for that game", which names a game the reader cannot
 * see. Somebody who plays four of them is owed the name.
 */
describe("naming the game a run was for", () => {
  it("names it in the count of what was never sent", () => {
    const report = assetUploadFailureReport(
      "The hub at coilbox.example has no recorded permission to redistribute pictures for that game.",
      12,
      { game: "sf" },
    );

    expect(report.body).toContain("12 pictures for sf were not sent.");
  });

  it("names it in the singular too", () => {
    const report = assetUploadFailureReport("The hub would not answer.", 1, {
      game: "sf",
    });

    expect(report.body).toContain("One picture for sf was not sent.");
  });

  it("names it in the count a stopped run did not get to", () => {
    const reports = assetUploadReports(
      [
        {
          result: "refused",
          status: 429,
          said: "Too many uploads for that subject in the last hour.",
          verdict: "blocked",
        },
        untried(),
        untried(),
      ],
      { game: "bar" },
    );

    expect(reports[0].body).toContain(
      "2 more pictures for bar were not tried.",
    );
  });

  /** The one branch with no sentence from the hub in it, and so the one that
   * would otherwise name neither the game nor anything else. */
  it("names it when the hub gave no words of its own", () => {
    const reports = assetUploadReports(
      [{ result: "refused", status: 429, said: null, verdict: "blocked" }],
      { game: "bar" },
    );

    expect(reports[0].body).toBe(
      "The hub would not take any more pictures for bar just now.",
    );
  });

  it("names it when the whole run was refused for being out of date", () => {
    const reports = assetUploadReports(
      Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`)),
      { game: "bar", outOfDate: true },
    );

    expect(reports[0].body).toContain("refused all 40 pictures for bar");
  });

  /** The hub names the game itself when it objects to a picture, so the report
   * carries it without this having to add anything. */
  it("leaves the hub's own naming of it alone", () => {
    const reports = assetUploadReports([notSquare("armsolar")], {
      game: "bar",
    });

    expect(reports[0].body).toContain("bar's armsolar buildpic");
    expect(reports[0].body).not.toContain("for bar");
  });

  /** A run of pictures for nothing in particular has no name to give, and an
   * invented one would be worse than none. */
  it("says nothing about a game when the run was not for one", () => {
    const report = assetUploadFailureReport("The hub would not answer.", 3);

    expect(report.body).toContain("3 pictures were not sent.");
  });
});

describe("reportAssetUploadOutcomes", () => {
  beforeEach(() => notify.mockClear());

  it("fires one notification for forty rejections", () => {
    reportAssetUploadOutcomes(
      Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`)),
      "user",
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe(
      "The hub would not take 40 pictures",
    );
  });

  it("fires nothing for a run where nothing went wrong", () => {
    reportAssetUploadOutcomes([taken(), taken()], "user");

    expect(notify).not.toHaveBeenCalled();
  });
});

/**
 * Issue #1690. The rejection this is named after arrived while somebody was
 * reading a base layout: they had not asked for an upload, and the hub refusing
 * their game is not something to stop them for.
 */
describe("a run coilbox started by itself", () => {
  let logged: string[];

  beforeEach(() => {
    notify.mockClear();
    recordQuietly.mockClear();
    logged = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("does not interrupt with a toast when the hub refuses the pictures", () => {
    reportAssetUploadOutcomes(
      Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`)),
      "coilbox",
    );

    expect(notify).not.toHaveBeenCalled();
  });

  /** Silent to the user is not silent to whoever wonders why a game has no
   * pictures, so the hub's own words survive into the log. */
  it("says the same thing in the console instead", () => {
    reportAssetUploadOutcomes([taken(), notSquare("armsolar")], "coilbox");

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("The hub would not take a picture");
    expect(logged[0]).toContain("bar's armsolar buildpic");
    expect(logged[0]).toContain("must be square");
  });

  /** The two-per-run cap is the taxonomy from #1634 and is not re-decided here:
   * a silent run logs exactly what a loud one would have said. */
  it("logs both of a run's two reports and no more", () => {
    reportAssetUploadOutcomes(
      [
        notSquare("armsolar"),
        {
          result: "refused",
          status: 429,
          said: "Too many uploads for that subject in the last hour.",
          verdict: "blocked",
        },
        untried(),
      ],
      "coilbox",
    );

    expect(notify).not.toHaveBeenCalled();
    expect(logged).toHaveLength(2);
  });

  /** A run that never started is the licence refusal's own shape: no outcomes,
   * one sentence from whoever refused it. */
  it("does not interrupt when the run never started", () => {
    reportAssetUploadFailure(
      "The hub at coilbox.example has no recorded permission to redistribute pictures for that game.",
      12,
      "coilbox",
    );

    expect(notify).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("no recorded permission");
    expect(logged[0]).toContain("12 pictures were not sent.");
  });

  it("still interrupts when a person started the run", () => {
    reportAssetUploadFailure("The hub would not answer.", 3, "user");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe("Picture uploads stopped early");
    expect(logged).toEqual([]);
  });

  /**
   * Issue #1703. The console stopped the interruption and put the answer
   * somewhere a player cannot reach in a release build, so the same words also
   * go in the bell, where nothing shows them until somebody opens it.
   */
  it("files it in the bell so somebody can go and read it", () => {
    reportAssetUploadOutcomes([taken(), notSquare("armsolar")], "coilbox");

    expect(recordQuietly).toHaveBeenCalledTimes(1);
    const filed = recordQuietly.mock.calls[0][0];
    expect(filed.title).toBe("The hub would not take a picture");
    expect(filed.body).toContain("bar's armsolar buildpic");
    expect(filed.body).toContain("must be square");
    expect(filed.level).toBe("error");
  });

  /** Reading what happened and stopping it happening again are the same
   * errand, and the switch that permits uploads is in the hub settings. */
  it("points the entry at the switch that started it", () => {
    reportAssetUploadOutcomes([notSquare("armsolar")], "coilbox");

    expect(recordQuietly.mock.calls[0][0].to).toBe("/settings/hub");
  });

  it("files a run that never started as well", () => {
    reportAssetUploadFailure(
      "The hub at coilbox.example has no recorded permission to redistribute pictures for that game.",
      12,
      "coilbox",
      { game: "sf" },
    );

    expect(notify).not.toHaveBeenCalled();
    expect(recordQuietly).toHaveBeenCalledTimes(1);
    expect(recordQuietly.mock.calls[0][0].body).toContain(
      "12 pictures for sf were not sent.",
    );
  });

  /** The two-per-run cap governs what gets filed as much as what gets shown. */
  it("files both of a run's two reports and no more", () => {
    reportAssetUploadOutcomes(
      [
        notSquare("armsolar"),
        {
          result: "refused",
          status: 429,
          said: "Too many uploads for that subject in the last hour.",
          verdict: "blocked",
        },
        untried(),
      ],
      "coilbox",
    );

    expect(recordQuietly).toHaveBeenCalledTimes(2);
  });

  /** A run that went fine files nothing, so the bell does not fill up with
   * every backfill any blueprint page ever ran. */
  it("files nothing about a run where nothing went wrong", () => {
    reportAssetUploadOutcomes([taken(), taken()], "coilbox");

    expect(recordQuietly).not.toHaveBeenCalled();
  });

  /** A person watching a toast does not need the same sentence twice, and
   * `notify` records for itself. */
  it("does not file a second copy of what a person was shown", () => {
    reportAssetUploadOutcomes([notSquare("armsolar")], "user");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(recordQuietly).not.toHaveBeenCalled();
  });
});

describe("assetUploadStoppedReport", () => {
  beforeEach(() => {
    notify.mockClear();
    recordQuietly.mockClear();
  });

  /** A stop is not an undo, and the person who has just changed their mind is
   * exactly the one that matters to. */
  it("says what had already gone and that the hub keeps it", () => {
    expect(assetUploadStoppedReport(3, { game: "bar" })).toEqual({
      title: "You stopped the picture uploads",
      body: "Coilbox has stopped sending pictures for bar. 3 pictures had already gone, and they stay on the hub.",
      level: "info",
    });
  });

  it("says so plainly when nothing had gone", () => {
    expect(assetUploadStoppedReport(0, { game: "bar" }).body).toBe(
      "Coilbox has stopped sending pictures for bar. Nothing had been sent, so nothing was added to the hub.",
    );
  });

  it("counts one picture in the singular", () => {
    expect(assetUploadStoppedReport(1, { game: "bar" }).body).toBe(
      "Coilbox has stopped sending pictures for bar. One picture had already gone, and it stays on the hub.",
    );
  });

  /** A run that was not for one game names none, the same way every other
   * sentence here does. */
  it("names no game when the run was not for one", () => {
    expect(assetUploadStoppedReport(2).body).toBe(
      "Coilbox has stopped sending pictures. 2 pictures had already gone, and they stay on the hub.",
    );
  });

  /** The bell, never a toast. The button was pressed a moment ago and the badge
   * has already gone, so showing it would be telling somebody what they just
   * did. Clicking through goes to the switch that starts these runs. */
  it("goes to the bell without showing, and links to the hub settings", () => {
    reportAssetUploadStopped(3, { game: "bar" });

    expect(notify).not.toHaveBeenCalled();
    expect(recordQuietly).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/settings/hub" }),
    );
  });
});
