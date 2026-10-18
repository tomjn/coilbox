// @vitest-environment happy-dom

/**
 * The queue remembers where each finished download came from (issue #4576),
 * driven through the provider rather than read from it.
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "./DownloadQueueProvider";
import {
  downloadKey,
  readDownloadHistory,
  recordsFor,
} from "./downloadHistory";
import { downloadMapAnySource } from "./downloadMap";

vi.mock("./bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("./warmEngineCache", () => ({
  installEngine: vi.fn(async (d: () => Promise<unknown>) => {
    await d();
  }),
}));
vi.mock("./downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("./downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
vi.mock("../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadQueueProvider>{children}</DownloadQueueProvider>
);

const request = {
  kind: "mapAnySource",
  label: "Map: Isis",
  args: { mapName: "Isis" },
} as const;

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the download queue's history", () => {
  it("stores the source and date of a completed download", async () => {
    vi.mocked(downloadMapAnySource).mockImplementationOnce(async (args) => {
      args.onAttempt?.({
        source: "springfiles",
        outcome: "ok",
        reference: "https://mirror.test/Isis.sd7",
        filename: "Isis.sd7",
        md5: null,
        mirror: "mirror.test",
        failure: null,
        durationMs: 120,
      });
      return "springfiles mirror";
    });
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    const before = Date.now();
    act(() => {
      result.current.enqueue(request);
    });
    await waitFor(() =>
      expect(result.current.completedFor("mapAnySource:Isis")).toBe(true),
    );

    const [record] = recordsFor(
      readDownloadHistory(),
      downloadKey("map", "Isis"),
    );
    expect(record).toMatchObject({
      source: "springfiles",
      outcome: "ok",
      filename: "Isis.sd7",
      mirror: "mirror.test",
    });
    expect(Date.parse(record.at)).toBeGreaterThanOrEqual(before);
  });

  it("stores the failure text of a download that failed", async () => {
    vi.mocked(downloadMapAnySource).mockImplementationOnce(async (args) => {
      args.onAttempt?.({
        source: "hakora",
        outcome: "failed",
        reference: "https://hakora.test/Isis.sd7",
        filename: "Isis.sd7",
        md5: null,
        mirror: "hakora.test",
        failure: "hakora: the host refused the connection",
        durationMs: 80,
      });
      throw new Error("No source could provide Isis");
    });
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(request);
    });
    await waitFor(() =>
      expect(result.current.failureFor("mapAnySource:Isis")).not.toBeNull(),
    );

    const [record] = recordsFor(
      readDownloadHistory(),
      downloadKey("map", "Isis"),
    );
    expect(record.outcome).toBe("failed");
    expect(record.failure).toBe("hakora: the host refused the connection");
  });

  it("does not record a cancelled download", async () => {
    vi.mocked(downloadMapAnySource).mockRejectedValueOnce(
      new Error("download cancelled"),
    );
    const { result } = renderHook(() => useDownloadQueue(), { wrapper });

    act(() => {
      result.current.enqueue(request);
    });
    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("canceled"),
    );

    expect(readDownloadHistory()).toEqual({});
  });
});
