import { describe, expect, it } from "vitest";
import type { InfologTail } from "@/play/bindings";
import { isMissionLine, logBelongsToRun, readRunLog } from "./runLog";

/**
 * Real lines. Two of the engine's own, in the shapes `crash.test.ts` takes from
 * an actual infolog, and two the mission runtime writes: Spring's formatter puts
 * the section in brackets before the level, which is the same
 * `[coilbox-mission] Error` the headless harness scripts grep for.
 */
const LINES = [
  '[t=00:00:00.006087] Using writeable configuration source: "/Users/tomjn/.config/spring/springsettings.cfg"',
  "[t=00:00:03.307308] Warning: [GR::ProbeImmediateModeBatching] immediate-mode batches render wrongly (18658 stray, 13071 unlit of 65536)",
  "[t=00:00:24.185623][f=-000001] [coilbox-mission] Notice: mission demo loaded, runtime version 5",
  "[t=00:00:25.001200][f=0000030] [coilbox-mission] Error: the engine refused to spawn corkrog for team 1 at 900,800, so it is not on the map",
  "[t=00:00:26.400000][f=0000060] [coilbox-mission] Error: group wave has no units on the map to order",
  '[t=00:00:22.144642][f=-000001] Error: [SetConfigString] key "UsePBO" is deprecated',
];

function tail(overrides: Partial<InfologTail> = {}): InfologTail {
  return {
    path: "/Users/tomjn/.config/spring/infolog.txt",
    modifiedMs: 2_000,
    totalLines: LINES.length,
    lines: LINES,
    truncated: false,
    ...overrides,
  };
}

describe("logBelongsToRun", () => {
  it("keeps a log the engine wrote after the launch began", () => {
    expect(logBelongsToRun(tail({ modifiedMs: 2_000 }), 1_000)).toBe(true);
  });

  it("keeps one written in the same millisecond the run started", () => {
    expect(logBelongsToRun(tail({ modifiedMs: 1_000 }), 1_000)).toBe(true);
  });

  it("refuses yesterday's, which an engine that died early leaves behind", () => {
    expect(logBelongsToRun(tail({ modifiedMs: 999 }), 1_000)).toBe(false);
  });
});

describe("isMissionLine", () => {
  it("reads the section the runtime logs under", () => {
    expect(isMissionLine(LINES[3])).toBe(true);
    expect(isMissionLine(LINES[5])).toBe(false);
  });
});

describe("readRunLog", () => {
  it("keeps the runtime's refusals apart from the engine's own noise", () => {
    const run = readRunLog(tail(), 1_000);

    expect(run?.mission).toEqual([LINES[3], LINES[4]]);
    expect(run?.engine).toEqual([LINES[1], LINES[5]]);
    expect(run?.path).toBe("/Users/tomjn/.config/spring/infolog.txt");
  });

  it("drops everything the engine did not log at a level", () => {
    const run = readRunLog(tail(), 1_000);

    // The config line and the runtime's own Notice both read as normal, and a
    // clean run's drawer should not fill up with either.
    expect(run?.mission).not.toContain(LINES[2]);
    expect([...(run?.mission ?? []), ...(run?.engine ?? [])]).not.toContain(
      LINES[0],
    );
  });

  it("says nothing rather than showing the run before this one", () => {
    expect(readRunLog(tail({ modifiedMs: 999 }), 1_000)).toBeNull();
    expect(readRunLog(null, 1_000)).toBeNull();
  });

  it("answers with two empty lists when the run was quiet", () => {
    const quiet = readRunLog(tail({ lines: [LINES[0], LINES[2]] }), 1_000);

    // Not null: "the log was read and the runtime said nothing" is the answer
    // the author came for, and it is not the same as "there was no log".
    expect(quiet).not.toBeNull();
    expect(quiet?.mission).toEqual([]);
    expect(quiet?.engine).toEqual([]);
  });
});
