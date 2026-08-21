// @vitest-environment happy-dom

/**
 * What a substituted system offers somebody who wants the map the challenge
 * actually names (issue #1833).
 *
 * Two different things can stop a challenge using its own map, and only one of
 * them is fixed by downloading. Missing from this install is a download. Hidden
 * from warpath and conquest is not: the map is already on disk and fetching it
 * again changes nothing. These tests are here to keep those two apart, because
 * the note says the same cause-neutral sentence for both.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "../downloads/DownloadQueueProvider";
import { SubstitutedMapNote } from "./SubstitutedMapNote";

const scan = vi.hoisted(() => ({
  data: null as { maps: { name: string }[] } | null,
}));
const excluded = vi.hoisted(() => ({ names: [] as string[] }));
const downloadMapAnySource = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    loading: false,
    error: null,
  }),
}));

vi.mock("../content/config", () => ({
  useUnitsyncScan: () => ({
    data: scan.data,
    loading: false,
    error: null,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
  invalidateScans: vi.fn(),
}));

vi.mock("../content/mapEligibility", () => ({
  useMapEligibility: () => ({
    isExcluded: (name: string) => excluded.names.includes(name),
    verdictFor: (name: string) =>
      excluded.names.includes(name) ? { source: "player" as const } : null,
    eligible: <T extends { name: string }>(maps: T[]) =>
      maps.filter((m) => !excluded.names.includes(m.name)),
    playerExcluded: excluded.names,
    setPlayerExcluded: vi.fn(),
  }),
}));

vi.mock("../downloads/config", () => ({
  useWriteRootPath: () => "/write",
}));

vi.mock("../downloads/downloadMap", () => ({ downloadMapAnySource }));
vi.mock("../downloads/downloadGame", () => ({
  downloadGameAnySource: vi.fn(),
}));
vi.mock("../downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <DownloadQueueProvider>{children}</DownloadQueueProvider>
);

const renderNote = (original: string | undefined) =>
  render(<SubstitutedMapNote original={original} />, { wrapper });

/** The note interpolates the map name, so its sentences span several text
 * nodes and only the whole element's text is worth asserting on. */
const noteText = () => document.body.textContent ?? "";

beforeEach(() => {
  scan.data = null;
  excluded.names = [];
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the substituted map note", () => {
  it("says nothing at all when the node is on the map it should be", () => {
    const { container } = renderNote(undefined);
    expect(container.innerHTML).toBe("");
  });

  it("offers to download a map this install does not have", async () => {
    scan.data = { maps: [{ name: "Comet Catcher" }] };
    renderNote("Nowhere Atoll");

    expect(noteText()).toContain(
      "Stands in for Nowhere Atoll, which is not available here.",
    );
    const button = await screen.findByRole("button", {
      name: /Download Nowhere Atoll/,
    });
    button.click();

    await waitFor(() =>
      expect(downloadMapAnySource).toHaveBeenCalledWith(
        expect.objectContaining({ mapName: "Nowhere Atoll" }),
      ),
    );
  });

  it("does not offer a download for a map that is installed but hidden", () => {
    scan.data = { maps: [{ name: "Nowhere Atoll" }] };
    excluded.names = ["Nowhere Atoll"];
    renderNote("Nowhere Atoll");

    expect(noteText()).toContain(
      "You have this map, but it is hidden from warpath and galactic conquest.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not offer a download for a map that has since been installed", () => {
    scan.data = { maps: [{ name: "Nowhere Atoll" }] };
    renderNote("Nowhere Atoll");

    // "Not available here" has stopped being true, so it stops being said.
    expect(noteText()).toContain(
      "You have that map now, but this battle keeps the stand-in.",
    );
    expect(noteText()).not.toContain("not available here");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers nothing until the scan says what is installed", () => {
    scan.data = null;
    renderNote("Nowhere Atoll");

    expect(noteText()).toContain(
      "Stands in for Nowhere Atoll, which is not available here.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
