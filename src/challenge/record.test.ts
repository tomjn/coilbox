import { describe, expect, it } from "vitest";
import { mergeResult, type ResultRecord } from "../records/bestResult";
import {
  type ChallengeBest,
  challengeRanking,
  codeFromPaste,
  describeBest,
  recordSummary,
  shareText,
} from "./record";
import type { ChallengeMode, ChallengeRunResult } from "./result";

const run = (
  mode: ChallengeMode,
  runId: string,
  won: boolean,
  measure: number,
  extra: { hull?: number; salvage?: number } = {},
): ChallengeRunResult => ({
  mode,
  identity: `${mode}-1`,
  runId,
  score: { won, measure, ...extra },
});

function play(...results: ChallengeRunResult[]) {
  let record: ResultRecord<ChallengeBest> | undefined;
  let change: ReturnType<typeof mergeResult>["change"] | undefined;
  for (const r of results) {
    const merged = mergeResult(record, r, challengeRanking);
    record = merged.record;
    change = merged.change;
  }
  // biome-ignore lint/style/noNonNullAssertion: every caller passes a result
  return { record: record!, change: change! };
}

describe("a challenge record", () => {
  it("makes the first finished run the best, even a loss", () => {
    const { record, change } = play(run("conquest", "r1", false, 9));
    expect(change).toEqual({ kind: "first" });
    expect(record).toEqual({
      attempts: 1,
      wins: 0,
      best: { mode: "conquest", won: false, measure: 9, runId: "r1" },
      seen: ["r1"],
    });
  });

  it("replaces a loss with a win and a slower win with a faster one", () => {
    const first = play(run("conquest", "r1", false, 30));
    expect(
      mergeResult(
        first.record,
        run("conquest", "r2", true, 40),
        challengeRanking,
      ).change,
    ).toEqual({ kind: "better" });
    const slow = play(
      run("conquest", "r1", true, 40),
      run("conquest", "r2", true, 25),
    );
    expect(slow.record.best?.runId).toBe("r2");
    expect(slow.change).toEqual({ kind: "better" });
  });

  it("keeps the best when a later run is slower, equal or a loss", () => {
    const { record, change } = play(
      run("conquest", "r1", true, 20),
      run("conquest", "r2", true, 30),
      run("conquest", "r3", true, 20),
      run("conquest", "r4", false, 90),
    );
    expect(change).toEqual({ kind: "kept" });
    expect(record.best?.runId).toBe("r1");
    expect(record.attempts).toBe(4);
    expect(record.wins).toBe(3);
  });

  it("keeps the deeper warpath loss", () => {
    const { record } = play(
      run("warpath", "r1", false, 5),
      run("warpath", "r2", false, 3),
    );
    expect(record.best?.runId).toBe("r1");
  });

  describe("warpath wins", () => {
    const won = (id: string, hull: number, salvage: number) =>
      run("warpath", id, true, 7, { hull, salvage });

    it("replaces a win with one that has more hull", () => {
      const { record, change } = play(won("r1", 40, 500), won("r2", 60, 0));
      expect(change).toEqual({ kind: "better" });
      expect(record.best).toEqual({
        mode: "warpath",
        won: true,
        measure: 7,
        hull: 60,
        salvage: 0,
        runId: "r2",
      });
    });

    it("replaces a win with one that has equal hull and more salvage", () => {
      const { record } = play(won("r1", 40, 100), won("r2", 40, 120));
      expect(record.best?.runId).toBe("r2");
    });

    it("keeps the first of two wins equal on hull and salvage", () => {
      const { record, change } = play(won("r1", 40, 100), won("r2", 40, 100));
      expect(change).toEqual({ kind: "kept" });
      expect(record.best?.runId).toBe("r1");
    });

    it("keeps a win over a later loss", () => {
      const { record } = play(won("r1", 10, 0), run("warpath", "r2", false, 9));
      expect(record.best?.runId).toBe("r1");
    });

    it("replaces a win stored without hull and salvage with any new win", () => {
      const stored: ResultRecord<ChallengeBest> = {
        attempts: 1,
        wins: 1,
        best: { mode: "warpath", won: true, measure: 7, runId: "old" },
        seen: ["old"],
      };
      const merged = mergeResult(stored, won("r2", 1, 0), challengeRanking);
      expect(merged.change).toEqual({ kind: "better" });
      expect(merged.record.best?.runId).toBe("r2");
    });
  });

  it("counts the same run once", () => {
    const first = play(run("conquest", "r1", true, 20));
    const again = mergeResult(
      first.record,
      run("conquest", "r1", true, 5),
      challengeRanking,
    );
    expect(again.change).toEqual({ kind: "duplicate" });
    expect(again.record).toBe(first.record);
    expect(again.record.attempts).toBe(1);
  });
});

describe("wording", () => {
  const best = (b: Partial<ChallengeBest>): ChallengeBest => ({
    mode: "conquest",
    won: true,
    measure: 14,
    runId: "r",
    ...b,
  });

  it("describes a conquest best in turns", () => {
    expect(describeBest(best({}))).toBe("won in 14 turns");
    expect(describeBest(best({ measure: 1 }))).toBe("won in 1 turn");
    expect(describeBest(best({ won: false, measure: 9 }))).toBe(
      "lost after 9 turns",
    );
  });

  it("describes a warpath best by depth", () => {
    expect(describeBest(best({ mode: "warpath", measure: 7 }))).toBe(
      "won, reaching depth 7",
    );
    expect(
      describeBest(best({ mode: "warpath", won: false, measure: 4 })),
    ).toBe("lost at depth 4");
  });

  it("describes a warpath win with its hull and salvage", () => {
    expect(describeBest(best({ mode: "warpath", hull: 7, salvage: 120 }))).toBe(
      "won with 7 hull and 120 salvage",
    );
  });

  it("describes a warpath win stored before hull and salvage as it was", () => {
    expect(describeBest(best({ mode: "warpath", measure: 7 }))).toBe(
      "won, reaching depth 7",
    );
  });

  it("loads and summarises a record stored before hull and salvage", () => {
    const stored: ResultRecord<ChallengeBest> = JSON.parse(
      '{"attempts":2,"wins":1,"best":{"mode":"warpath","won":true,"measure":7,"runId":"old"},"seen":["a","old"]}',
    );
    expect(recordSummary(stored)).toBe(
      "Your best: won, reaching depth 7. 2 attempts.",
    );
  });

  it("summarises a record with its attempts", () => {
    const one = play(run("conquest", "r1", true, 14)).record;
    expect(recordSummary(one)).toBe("Your best: won in 14 turns. 1 attempt.");
    const many = play(
      run("conquest", "r1", false, 14),
      run("conquest", "r2", false, 20),
    ).record;
    expect(recordSummary(many)).toBe(
      "Your best: lost after 20 turns. 2 attempts.",
    );
  });
});

describe("share text", () => {
  const code = "cbz1.AAAA";
  it("is the bare code when no result is included", () => {
    expect(shareText(code, undefined)).toBe(code);
  });
  it("words a new warpath win by hull and salvage", () => {
    expect(
      shareText(code, {
        mode: "warpath",
        won: true,
        measure: 7,
        hull: 7,
        salvage: 120,
        runId: "r",
      }),
    ).toBe(
      `${code}\n\nMy best result so far (my claim, not checked by coilbox): won with 7 hull and 120 salvage`,
    );
  });
  it("puts the result on a line under the code", () => {
    expect(
      shareText(code, { mode: "conquest", won: true, measure: 14, runId: "r" }),
    ).toBe(
      `${code}\n\nMy best result so far (my claim, not checked by coilbox): won in 14 turns`,
    );
  });
});

describe("codeFromPaste", () => {
  it("returns the code when text follows it", () => {
    const text = shareText("cbz1.AAAA", {
      mode: "conquest",
      won: true,
      measure: 14,
      runId: "r",
    });
    expect(codeFromPaste(text)).toBe("cbz1.AAAA");
  });
  it("leaves a bare code, a file's JSON and a legacy code alone", () => {
    expect(codeFromPaste("  cbz1.AAAA \n")).toBe("cbz1.AAAA");
    expect(
      codeFromPaste('{ "format": "coilbox",\n "kind": "challenge" }'),
    ).toBe('{ "format": "coilbox",\n "kind": "challenge" }');
    expect(codeFromPaste("eyJhIjoxfQ")).toBe("eyJhIjoxfQ");
  });
});
