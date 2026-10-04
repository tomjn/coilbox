// @vitest-environment happy-dom
/**
 * Issue #3489: a replay whose game depends on an archive that is not installed
 * must not start an engine, which would fail on it. Watch is disabled and says
 * which archive is missing.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ensureContent: vi.fn(),
  launchReplay: vi.fn(),
}));

vi.mock("../play/config", () => ({
  useReplayTarget: () => ({
    resolved: {
      target: { executable: "/root/engine/spring", dataDir: "/root" },
      matched: true,
    },
  }),
}));
vi.mock("../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: h.ensureContent }),
}));
vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launchReplay: h.launchReplay }),
}));
vi.mock("./replayUserState", () => ({
  useReplayUserState: () => ({ setWatched: () => {} }),
}));

import { WatchButton } from "./pages/components/WatchButton";

const REASON =
  "Archive not installed: springcontent.sdz. SplinterFaction 0.1.86 depends on it.";

beforeEach(() => {
  h.ensureContent.mockReset();
  h.launchReplay.mockReset();
  h.launchReplay.mockResolvedValue({ exitCode: 0 });
});
afterEach(cleanup);

describe("Watch on a replay whose game lacks a dependency archive", () => {
  it("is disabled, says why, and starts no engine", () => {
    render(
      <WatchButton
        replayPath="/replays/a.sdfz"
        engineVersion="105.1.1"
        watch={{ kind: "recorded" }}
        dependencyBlock={REASON}
      />,
    );
    const button = screen.getByRole("button", {
      name: /watch/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(REASON);
    fireEvent.click(button);
    expect(h.launchReplay).not.toHaveBeenCalled();
  });

  it("does not fall back to another engine or offer a download", () => {
    render(
      <WatchButton
        replayPath="/replays/a.sdfz"
        engineVersion="105.1.1"
        watch={{ kind: "download" }}
        dependencyBlock={REASON}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    expect(h.ensureContent).not.toHaveBeenCalled();
    expect(h.launchReplay).not.toHaveBeenCalled();
  });

  it("still launches when nothing is missing", async () => {
    render(
      <WatchButton
        replayPath="/replays/a.sdfz"
        engineVersion="105.1.1"
        watch={{ kind: "recorded" }}
        dependencyBlock={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    await waitFor(() => expect(h.launchReplay).toHaveBeenCalledTimes(1));
  });
});
