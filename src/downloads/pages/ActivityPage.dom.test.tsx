// @vitest-environment happy-dom

/**
 * Library > Downloads (issue #4583): the rows it draws from fixture data, and a
 * retry on a failed row asking the queue for the same download from the next
 * source.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../../lib/storedSetting";
import { activityRows } from "../activityRows";
import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "../DownloadQueueProvider";
import { downloadMapAnySource } from "../downloadMap";
import { DOWNLOADING, FAILED, HISTORY, QUEUED } from "../fixtures/activity";
import { SourceWalkError } from "../sourceWalk";
import ActivityPage, { DownloadsActivity } from "./ActivityPage";

const drawerOpen = vi.fn();
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: drawerOpen, close: () => {}, isOpen: false }),
}));
vi.mock("../bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("../warmEngineCache", () => ({ installEngine: vi.fn() }));
vi.mock("../downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("../downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../../content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
vi.mock("../../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  installSettingsStorage(null);
});

const rowOf = (name: string) => {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

describe("the downloads table", () => {
  const rows = activityRows({
    items: [QUEUED, DOWNLOADING],
    settled: [FAILED],
    history: HISTORY,
  });
  const handlers = { onCancel: vi.fn(), onRetry: vi.fn(), onLog: vi.fn() };
  const draw = () =>
    render(
      <MemoryRouter>
        <DownloadsActivity rows={rows} {...handlers} />
      </MemoryRouter>,
    );

  it("draws a downloading, a queued, a failed and a done row", () => {
    draw();

    const zk = rowOf("Zero-K v1.12.5");
    expect(zk.dataset.state).toBe("active");
    expect(within(zk).getByText("GitHub · github.com")).toBeTruthy();
    expect(
      within(zk).getByText("59 MB of 95 MB · 40 MB/s · 1m left"),
    ).toBeTruthy();
    expect(within(zk).getByRole("button", { name: "Cancel" })).toBeTruthy();

    const isis = rowOf("Isis");
    expect(isis.dataset.state).toBe("queued");
    expect(within(isis).getByText("Queued · 12 MB")).toBeTruthy();
    expect(
      within(isis).getByRole("button", { name: "Remove from queue" }),
    ).toBeTruthy();

    const isthmus = rowOf("Supreme_Isthmus_v2");
    expect(isthmus.dataset.state).toBe("failed");
    expect(
      within(isthmus).getByText("Springfiles · springfiles.springrts.com"),
    ).toBeTruthy();
    expect(within(isthmus).getByText(/answered 404/)).toBeTruthy();
    expect(
      within(isthmus).getByRole("button", { name: "Try next mirror" }),
    ).toBeTruthy();
    expect(within(isthmus).getByRole("button", { name: "Log" })).toBeTruthy();

    const sf = rowOf("Splinter Faction 0.1.86");
    expect(sf.dataset.state).toBe("done");
    expect(within(sf).getByText("Rapid · repos.springrts.com")).toBeTruthy();
    expect(
      within(sf).getByRole("link", { name: "Show in Games" }),
    ).toBeTruthy();
  });

  it("lists the queue first, running before waiting", () => {
    draw();
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelector("td:nth-child(2) span")?.textContent);
    expect(names).toEqual([
      "Zero-K v1.12.5",
      "Isis",
      "Supreme_Isthmus_v2",
      "Splinter Faction 0.1.86",
    ]);
  });

  it("counts each chip and filters to it", () => {
    draw();
    fireEvent.click(screen.getByRole("radio", { name: /Failed/ }));
    expect(screen.queryByText("Zero-K v1.12.5")).toBeNull();
    expect(screen.getByText("Supreme_Isthmus_v2")).toBeTruthy();
  });
});

/** Asks the queue for one download when it mounts. */
function Enqueue() {
  const { enqueue } = useDownloadQueue();
  useEffect(() => {
    enqueue({
      kind: "mapAnySource",
      label: "Map: Supreme Isthmus",
      args: { mapName: "Supreme_Isthmus_v2", writePath: "/data" },
    });
  }, [enqueue]);
  return null;
}

describe("a retry on the next source", () => {
  it("asks for the same map again, starting at the mirror it had not reached", async () => {
    const next = { source: "springfiles", mirror: "mirror2.test" } as const;
    vi.mocked(downloadMapAnySource)
      .mockImplementationOnce(async (args) => {
        args.onSource?.({ source: "springfiles", mirror: "mirror1.test" });
        throw new SourceWalkError("mirror1.test stopped sending", next);
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    render(
      <MemoryRouter>
        <DownloadQueueProvider>
          <Enqueue />
          <ActivityPage />
        </DownloadQueueProvider>
      </MemoryRouter>,
    );

    const retry = await screen.findByRole("button", {
      name: "Try next mirror",
    });
    // Nothing was recorded, so the row names the source it stopped on.
    expect(
      within(rowOf("Supreme_Isthmus_v2")).getByText(
        "Springfiles · mirror1.test",
      ),
    ).toBeTruthy();
    act(() => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(downloadMapAnySource).toHaveBeenCalledTimes(2));
    const [again] = vi.mocked(downloadMapAnySource).mock.calls[1];
    expect(again).toMatchObject({
      mapName: "Supreme_Isthmus_v2",
      writePath: "/data",
      startAt: next,
    });
    await waitFor(() =>
      expect(rowOf("Supreme_Isthmus_v2").dataset.state).toBe("active"),
    );
  });

  it("opens the log in a drawer", async () => {
    vi.mocked(downloadMapAnySource).mockRejectedValueOnce(
      new SourceWalkError("mirror1.test stopped sending", null),
    );
    render(
      <MemoryRouter>
        <DownloadQueueProvider>
          <Enqueue />
          <ActivityPage />
        </DownloadQueueProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Log" }));
    expect(drawerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Supreme_Isthmus_v2" }),
    );
    expect(screen.queryByRole("button", { name: /^Try / })).toBeNull();
  });
});
