import { describe, expect, it } from "vitest";
import {
  buildCrashReport,
  classifyExit,
  classifyLine,
  describeExit,
  isAbnormal,
} from "./crash";

/**
 * Every log line quoted here was copied out of a real
 * `~/.config/spring/infolog.txt`, not invented, so the classifier is tested
 * against what the engine actually writes rather than what the formatter's
 * source suggests it should.
 */

describe("classifyExit", () => {
  it("reads a zero exit code as a clean exit", () => {
    expect(classifyExit({ exitCode: 0, signal: null })).toBe("clean");
  });

  it("reads no status at all as a cancel", () => {
    // play_cancel removes the child before it is reaped, so nothing comes back.
    expect(classifyExit({ exitCode: null, signal: null })).toBe("cancelled");
  });

  it("reads a signal as a crash", () => {
    expect(classifyExit({ exitCode: null, signal: 11 })).toBe("signal");
  });

  it("reads a nonzero exit code as a failure", () => {
    expect(classifyExit({ exitCode: 1, signal: null })).toBe("failed");
  });

  it("prefers the signal when both are set", () => {
    // A shell-style 128+n code alongside a signal must not read as a plain
    // failure: the signal is the more specific fact.
    expect(classifyExit({ exitCode: 139, signal: 11 })).toBe("signal");
  });
});

describe("isAbnormal", () => {
  it("is true for a crash and for a nonzero exit", () => {
    expect(isAbnormal({ exitCode: null, signal: 11 })).toBe(true);
    expect(isAbnormal({ exitCode: 2, signal: null })).toBe(true);
  });

  it("is false for a clean exit and for a cancel", () => {
    expect(isAbnormal({ exitCode: 0, signal: null })).toBe(false);
    expect(isAbnormal({ exitCode: null, signal: null })).toBe(false);
  });
});

describe("describeExit", () => {
  it("names a signal it knows", () => {
    expect(describeExit({ exitCode: null, signal: 11 })).toContain("SIGSEGV");
  });

  it("still reports a signal it does not know", () => {
    const said = describeExit({ exitCode: null, signal: 62 });
    expect(said).toContain("62");
  });

  it("gives the exit code for a failure", () => {
    expect(describeExit({ exitCode: 3, signal: null })).toContain("code 3");
  });
});

describe("classifyLine", () => {
  it("marks an error line", () => {
    expect(
      classifyLine(
        '[t=00:00:22.144642][f=-000001] Error: [SetConfigString] key "UsePBO" is deprecated',
      ),
    ).toBe("error");
  });

  it("marks an error on a line carrying both stamps and a lua traceback", () => {
    expect(
      classifyLine(
        "[t=00:00:24.185623][f=-000001] Error: Failed to load: gui_dualfog_gadget.lua  ([string \"LuaGaia/Gadgets/gui_dualfog_gadget.lua\"]:132: attempt to index field 'version' (a nil value))",
      ),
    ).toBe("error");
  });

  it("marks a warning line", () => {
    expect(
      classifyLine(
        "[t=00:00:03.307308] Warning: [GR::ProbeImmediateModeBatching] immediate-mode batches render wrongly (18658 stray, 13071 unlit of 65536)",
      ),
    ).toBe("warning");
  });

  it("reads the level, not the message, so a warning mentioning an error stays a warning", () => {
    expect(
      classifyLine(
        "[t=00:00:03.594541] Warning: [IsPathOnSpinningDisk] Error 'No such file or directory' getting readlink() for file '/Users/tomjn/.spring/'",
      ),
    ).toBe("warning");
  });

  it("leaves an ordinary line alone even with a section and a function tag", () => {
    expect(
      classifyLine(
        '[t=00:00:03.486366] [Font] [InitFontconfig] Using Fontconfig cache dir "/opt/homebrew/var/cache/fontconfig"',
      ),
    ).toBe("normal");
  });

  it("leaves an ordinary line alone when the message has a colon in it", () => {
    expect(
      classifyLine(
        '[t=00:00:00.006087] Using writeable configuration source: "/Users/tomjn/.config/spring/springsettings.cfg"',
      ),
    ).toBe("normal");
  });

  it("treats a stack trace continuation line as normal", () => {
    // Only the trace's heading is logged at Error level. Marking every frame
    // would mark the whole tail.
    expect(classifyLine("    #3 0x00000001045a2f10 in CGame::Draw()")).toBe(
      "normal",
    );
  });

  it("handles an empty line", () => {
    expect(classifyLine("")).toBe("normal");
  });
});

describe("buildCrashReport", () => {
  const report = () =>
    buildCrashReport({
      outcome: { exitCode: null, signal: 11 },
      runKind: "skirmish",
      game: "Beyond All Reason test-1234",
      map: "Comet Catcher Remake",
      engineVersion: "2025.06.19",
      system: { os: "windows", osVersion: "10.0.19045", arch: "x86_64" },
      appVersion: "1.42.0",
      at: Date.UTC(2026, 10, 20, 12, 0, 0),
      log: {
        path: "/Users/tomjn/.config/spring/infolog.txt",
        modifiedMs: 0,
        totalLines: 3,
        lines: ["Spring 2025.06.19", "Loading", "Error: boom"],
        truncated: false,
      },
      output: {
        path: "/cache/engine-output.log",
        modifiedMs: 0,
        totalLines: 1,
        lines: ["terminate called after throwing"],
        truncated: false,
      },
    });

  it("leads with how the engine died", () => {
    expect(report()).toContain("SIGSEGV");
  });

  it("carries the versions and system a helper asks for", () => {
    const r = report();
    expect(r).toContain("Coilbox: 1.42.0");
    expect(r).toContain("System: windows 10.0.19045 (x86_64)");
    expect(r).toContain("Engine version: 2025.06.19");
    expect(r).toContain("Time: 2026-11-20T12:00:00.000Z");
  });

  it("names what was being played", () => {
    const r = report();
    expect(r).toContain("Beyond All Reason test-1234");
    expect(r).toContain("Comet Catcher Remake");
  });

  it("carries every line of both logs, marked as whole files", () => {
    const r = report();
    expect(r).toContain(
      "===== infolog.txt: /Users/tomjn/.config/spring/infolog.txt (whole file, 3 lines) =====\nSpring 2025.06.19\nLoading\nError: boom\n===== end of infolog.txt =====",
    );
    expect(r).toContain("terminate called after throwing");
  });

  it("never passes a slice of a log off as the whole file", () => {
    const r = buildCrashReport({
      outcome: { exitCode: 1, signal: null },
      runKind: "skirmish",
      log: {
        path: "/x/infolog.txt",
        modifiedMs: 0,
        totalLines: 900,
        lines: ["tail"],
        truncated: true,
      },
    });
    expect(r).toContain("last 1 of 900 lines, NOT the whole file");
    expect(r).not.toContain("whole file, ");
  });

  it("says so when anything is missing", () => {
    const r = buildCrashReport({
      outcome: { exitCode: 1, signal: null },
      runKind: "skirmish",
    });
    expect(r).toContain("Log: none found for this run");
    expect(r).toContain("Coilbox: unknown");
    expect(r).toContain("System: unknown");
    expect(r).toContain("Engine version: unknown");
    expect(r).not.toContain("=====");
  });
});
