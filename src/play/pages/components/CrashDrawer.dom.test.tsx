// @vitest-environment happy-dom

/**
 * What the player sees after the engine dies (issue #379).
 *
 * The drawer points at the real `infolog.txt` and shows none of it, as the
 * Engine log page does. A slice of the file reads as the whole of it, and the
 * start, where the engine records the system and the GPU, is the part a slice
 * leaves out (issue #4167).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InfologTail } from "@/play/bindings";
import type { CrashTriage } from "@/play/useCrashTriage";
import { CrashDrawer } from "./CrashDrawer";

const m = vi.hoisted(() => ({
  contentOpenPath: vi.fn(async (_a: { path: string }) => {}),
  revealItemInDir: vi.fn(async (_p: string) => {}),
}));

vi.mock("@/content/bindings", () => ({ contentOpenPath: m.contentOpenPath }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: m.revealItemInDir,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
  triagedAt: 1_755_800_100_000,
  ...over,
});

const launch = {
  command: "'/home/al/.spring/engine/2026.09.02/spring' 'script.txt'",
  env: ["AppImage: yes", "LD_LIBRARY_PATH=(unset)"],
  outputLog: "/home/al/.cache/com.tomjn.coilbox/engine-output.log",
};

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

  it("shows the path to the log file and when it was written", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(screen.getByText(log.path)).toBeTruthy();
    expect(screen.getByText(/Written /)).toBeTruthy();
  });

  it("shows no line of the log, which would pass for the whole file", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    expect(screen.queryByText(/UsePBO/)).toBeNull();
    expect(screen.queryByText(/Fontconfig/)).toBeNull();
    expect(screen.queryByText(/showing the last/i)).toBeNull();
  });

  it("opens the log file", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    fireEvent.click(screen.getByRole("button", { name: /open the log file/i }));
    expect(m.contentOpenPath).toHaveBeenCalledWith({ path: log.path });
  });

  it("shows the log file in its folder", () => {
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    fireEvent.click(screen.getByRole("button", { name: /show in folder/i }));
    expect(m.revealItemInDir).toHaveBeenCalledWith(log.path);
  });

  it("copies the crash details and the log path, and no log line", () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<CrashDrawer open onOpenChange={() => {}} triage={triage()} />);
    fireEvent.click(screen.getByRole("button", { name: /copy details/i }));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("Comet Catcher Remake");
    expect(text).toContain(log.path);
    expect(text).not.toContain("UsePBO");
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
    expect(screen.queryByText(log.path)).toBeNull();
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
    expect(screen.getByText("Show in folder")).toBeTruthy();
    unmount();

    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ log: null, stale: true })}
      />,
    );
    expect(screen.queryByText("Open the log file")).toBeNull();
    expect(screen.queryByText("Show in folder")).toBeNull();
  });

  it("points at the engine's output when it died before writing its log", () => {
    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({
          outcome: { exitCode: null, signal: 6, launch },
          log: null,
          stale: true,
        })}
      />,
    );
    expect(screen.getByText(launch.outputLog)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open the log file/i }));
    expect(m.contentOpenPath).toHaveBeenCalledWith({ path: launch.outputLog });
  });

  it("copies the command, the loader variables and the output file", () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <CrashDrawer
        open
        onOpenChange={() => {}}
        triage={triage({ outcome: { exitCode: null, signal: 6, launch } })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy details/i }));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain(`Command: ${launch.command}`);
    expect(text).toContain("LD_LIBRARY_PATH=(unset)");
    expect(text).toContain(`Engine output: ${launch.outputLog}`);
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
