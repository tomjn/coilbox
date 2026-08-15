import { beforeEach, describe, expect, it, vi } from "vitest";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@/notify/notify", () => ({ notify }));

import {
  type AssetOutcome,
  assetUploadReports,
  reportAssetUploadOutcomes,
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

describe("reportAssetUploadOutcomes", () => {
  beforeEach(() => notify.mockClear());

  it("fires one notification for forty rejections", () => {
    reportAssetUploadOutcomes(
      Array.from({ length: 40 }, (_, n) => notSquare(`u${n}`)),
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe(
      "The hub would not take 40 pictures",
    );
  });

  it("fires nothing for a run where nothing went wrong", () => {
    reportAssetUploadOutcomes([taken(), taken()]);

    expect(notify).not.toHaveBeenCalled();
  });
});
