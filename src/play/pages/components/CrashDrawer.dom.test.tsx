// @vitest-environment happy-dom

/**
 * What the player sees after the engine dies (issue #379).
 *
 * The log lines below were copied out of a real `~/.config/spring/infolog.txt`,
 * so the highlighting is tested against what the engine writes rather than what
 * its formatter's source suggests it should.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InfologTail } from "@/play/bindings";
import type { CrashTriage } from "@/play/useCrashTriage";
import { CrashDrawer } from "./CrashDrawer";

// The drawer's buttons reach the plugin. Neither is pressed here, so the mock
// only has to stop the import resolving a real Tauri command.
vi.mock("@/content/bindings", () => ({ contentOpenPath: vi.fn() }));

afterEach(cleanup);

const LINES = [
  '[t=00:00:03.486366] [Font] [InitFontconfig] Using Fontconfig cache dir "/opt/homebrew/var/cache/fontconfig"',
  "[t=00:00:03.307308] Warning: [GR::ProbeImmediateModeBatching] immediate-mode batches render wrongly",
  '[t=00:00:22.144642][f=-000001] Error: [SetConfigString] key "UsePBO" is deprecated',
];

const log: InfologTail = {
  path: "/Users/tomjn/.config/spring/infolog.txt",
  modifiedMs: 1_755_800_000_000,
  totalLines: 1091,
  lines: LINES,
  truncated: true,
};

const triage = (over: Partial<CrashTriage> = {}): CrashTriage => ({
  outcome: { exitCode: null, signal: 11 },
  runKind: "Skirmish",
  game: "Beyond All Reason test-1234",
  map: "Comet Catcher Remake",
  log,
  stale: false,
  ...over,
});

/** The line elements, in order, tagged with how the drawer classified them. */
function lineKinds(): string[] {
  return Array.from(document.querySelectorAll("[data-line-kind]")).map(
    (el) => el.getAttribute("data-line-kind") ?? "",
  );
}

describe("CrashDrawer", () => {
  it("says how the engine died", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(screen.getByText(/SIGSEGV/)).toBeTruthy();
  });

  it("names what was being played", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(screen.getByText("Comet Catcher Remake")).toBeTruthy();
    expect(screen.getByText("Beyond All Reason test-1234")).toBeTruthy();
  });

  it("marks the error and warning lines and leaves the rest alone", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(lineKinds()).toEqual(["normal", "warning", "error"]);
  });

  it("says how much of the log it is showing", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(screen.getByText(/last 3 of 1091 lines/)).toBeTruthy();
  });

  it("shows no log at all when the newest one predates the run", () => {
    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ log: null, stale: true })}
      />,
    );
    // A log from an earlier session reads as evidence, so it is withheld rather
    // than shown with a caveat.
    expect(lineKinds()).toEqual([]);
    expect(screen.getByText(/wrote no log for this run/)).toBeTruthy();
  });

  it("distinguishes no log at all from a stale one", () => {
    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ log: null, stale: false })}
      />,
    );
    expect(screen.getByText(/No engine log was found/)).toBeTruthy();
  });

  it("offers to open the log file only when there is one", () => {
    const { unmount } = render(
      <CrashDrawer open onOpenChange={() => {}} triage={triage()} />,
    );
    expect(screen.getByText("Open the log file")).toBeTruthy();
    unmount();

    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ log: null, stale: true })}
      />,
    );
    expect(screen.queryByText("Open the log file")).toBeNull();
  });

  it("reports a nonzero exit with its code", () => {
    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ outcome: { exitCode: 1, signal: null } })}
      />,
    );
    expect(screen.getByText(/code 1/)).toBeTruthy();
  });

  it("renders nothing without a triage", () => {
    const { container } = render(
      <CrashDrawer open onOpenChange={() => {}} triage={null} />,
    );
    expect(container.textContent).toBe("");
  });
});
