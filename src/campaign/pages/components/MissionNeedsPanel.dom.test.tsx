// @vitest-environment happy-dom
/**
 * The briefing's download card (issue #3366). The queue and the release list
 * are stood in for: what matters is which downloads the card offers, what it
 * asks the queue for, and that it tells the page when one finished.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignMission } from "../../model";

const { queue, newest, writeRoot } = vi.hoisted(() => ({
  queue: {
    inputs: [] as { kind: string; args: Record<string, unknown> }[],
    start: vi.fn(),
    error: null as string | null,
  },
  newest: vi.fn(),
  writeRoot: { path: "/write" as string | undefined, loading: false },
}));

vi.mock("../../../general/display", () => ({ useStillUi: () => false }));

vi.mock("../../../downloads/useQueuedDownload", () => ({
  useQueuedDownload: (input: {
    kind: string;
    args: Record<string, unknown>;
  }) => {
    queue.inputs.push(input);
    return {
      start: queue.start,
      status: null,
      progress: null,
      rate: {},
      startedAt: null,
      error: queue.error,
      completed: false,
      busy: false,
    };
  },
}));

vi.mock("../../../downloads/config", () => ({
  useWriteRoot: () => writeRoot,
}));

vi.mock("../../../downloads/engineInstall", () => ({
  fetchNewestRecoil: newest,
}));

import { MissionNeedsPanel } from "./MissionNeedsPanel";

const mission = {
  id: "m1",
  snapshot: { gameName: "XTA 1.2", mapName: "Delta" },
} as unknown as CampaignMission;

function show(
  needs: { kind: "engine" | "game" | "map"; name: string }[],
  m: CampaignMission = mission,
) {
  const onInstalled = vi.fn(async () => {});
  render(
    <MemoryRouter>
      <MissionNeedsPanel mission={m} needs={needs} onInstalled={onInstalled} />
    </MemoryRouter>,
  );
  return onInstalled;
}

beforeEach(() => {
  queue.inputs = [];
  queue.error = null;
  queue.start.mockReset();
  queue.start.mockResolvedValue({ status: "done" });
  newest.mockReset();
  newest.mockResolvedValue({
    release: { version: "2026.1", assetUrl: "https://x/e.7z" },
    platform: "linux",
  });
  writeRoot.path = "/write";
  writeRoot.loading = false;
});
afterEach(cleanup);

describe("the mission needs card", () => {
  it("downloads a missing game by its full name, and tells the page", async () => {
    const onInstalled = show([{ kind: "game", name: "XTA 1.2" }]);

    fireEvent.click(screen.getByRole("button", { name: /Download & Install/ }));

    expect(queue.inputs[0]).toMatchObject({
      kind: "game",
      args: { gameName: "XTA 1.2", writePath: "/write" },
    });
    await waitFor(() =>
      expect(onInstalled).toHaveBeenCalledWith({
        kind: "game",
        name: "XTA 1.2",
      }),
    );
  });

  it("does not tell the page when the download did not finish", async () => {
    queue.start.mockResolvedValue({ status: "error" });
    const onInstalled = show([{ kind: "game", name: "XTA 1.2" }]);

    fireEvent.click(screen.getByRole("button", { name: /Download & Install/ }));

    await waitFor(() => expect(queue.start).toHaveBeenCalled());
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("keeps the map's own download hint", () => {
    show([{ kind: "map", name: "Delta" }], {
      ...mission,
      mapDownload: { springName: "Delta Reborn", searchUrl: "https://x/s" },
    } as CampaignMission);

    expect(queue.inputs[0]).toMatchObject({
      kind: "map",
      args: { springName: "Delta Reborn", searchUrl: "https://x/s" },
    });
  });

  it("lists the game and the map in one card, each with its own button", () => {
    show([
      { kind: "game", name: "XTA 1.2" },
      { kind: "map", name: "Delta" },
    ]);

    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading").textContent).toBe("Content required");
    expect(screen.getAllByRole("button", { name: /Download/ })).toHaveLength(2);
  });

  it("offers the newest engine when there is none", async () => {
    const onInstalled = show([{ kind: "engine", name: "" }]);

    const button = await screen.findByRole("button", {
      name: /Download & Install/,
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);

    expect(queue.inputs.at(-1)).toMatchObject({
      kind: "engineRecoil",
      args: { version: "2026.1", writePath: "/write" },
    });
    await waitFor(() =>
      expect(onInstalled).toHaveBeenCalledWith({ kind: "engine", name: "" }),
    );
  });

  it("says so, and offers no engine download, when no build exists here", async () => {
    newest.mockResolvedValue({ release: null, platform: "macos" });
    show([{ kind: "engine", name: "" }]);

    expect(
      await screen.findByText(/No engine build is available/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Download & Install/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says plainly that the exact game version could not be fetched", () => {
    queue.error = "No release matches XTA 1.2";
    show([{ kind: "game", name: "XTA 1.2" }]);

    expect(
      screen.getByText(/exact version this mission was made for/),
    ).toBeTruthy();
    expect(screen.getByText(/Another version will not run/)).toBeTruthy();
  });
});
