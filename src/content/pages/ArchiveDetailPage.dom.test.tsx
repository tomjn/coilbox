// @vitest-environment happy-dom
/**
 * Issue #1900. Both archive pages are the same route
 * (`content/archives/:name`) with a different parameter, so a link straight
 * from one archive to another (a dependency row, not the Archives list in
 * between) keeps ArchiveDetailPage mounted and its state alive across the
 * move. Before the fix, the preview pane went on showing whatever member was
 * selected in the archive you just left, and a folder left expanded stayed
 * expanded even though it belongs to a different archive's tree.
 *
 * The two archives here share both a filename ("readme.txt") and a folder
 * name ("docs") on purpose, so a stale selection or a carried-over expanded
 * folder would still show *something* rather than nothing.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchiveFileResult, ArchiveTreeResult } from "../bindings";

// Drawers live on the app frame, which is not mounted here.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

const SELECTED = {
  enginePath: "/engines/105",
  rootPath: "/data",
  engineId: "105",
  engineVersion: "105",
};

const TREES: Record<string, ArchiveTreeResult> = {
  "alpha.sdz": {
    files: [{ path: "docs/readme.txt", size: 10 }],
    errors: [],
  },
  "beta.sdz": {
    files: [{ path: "docs/other.txt", size: 5 }],
    errors: [],
  },
};

const FILE_RESULT: ArchiveFileResult = {
  kind: "text",
  text: "hello",
  size: 5,
  truncated: false,
  errors: [],
};

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({ selected: SELECTED }),
  useArchives: () => ({
    archives: [
      { name: "alpha.sdz", kind: "game", primary: true, gameName: "Alpha" },
      { name: "beta.sdz", kind: "other", primary: false },
    ],
    data: {
      games: [
        {
          name: "Alpha",
          primaryArchive: { name: "alpha.sdz" },
          dependencyArchives: [{ name: "beta.sdz" }],
          info: {},
        },
      ],
      maps: [],
      errors: [],
    },
    loading: false,
  }),
  useUnitsyncArchiveTree: (
    _enginePath?: string,
    _dataDir?: string,
    archive?: string,
  ) => ({ tree: archive ? (TREES[archive] ?? null) : null, loading: false }),
  useUnitsyncArchiveFile: (
    _enginePath?: string,
    _dataDir?: string,
    _archive?: string,
    file?: string,
  ) => ({ data: file ? FILE_RESULT : null, loading: false }),
}));

const { default: ArchiveDetailPage } = await import("./ArchiveDetailPage");

afterEach(cleanup);

function renderAtAlpha() {
  return render(
    <MemoryRouter initialEntries={["/content/archives/alpha.sdz"]}>
      <Routes>
        <Route path="/content/archives/:name" element={<ArchiveDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ArchiveDetailPage across a direct archive-to-archive navigation", () => {
  it("clears the selected member instead of previewing it against the new archive", async () => {
    renderAtAlpha();

    // Expand "docs" and select readme.txt, alpha's own file.
    fireEvent.click(await screen.findByText("docs"));
    fireEvent.click(await screen.findByText("readme.txt"));
    expect(screen.queryByText("Select a file to preview it.")).toBeNull();

    // Follow the dependency link straight to beta.sdz, the same route with a
    // different :name and no intervening Archives list page.
    await act(async () => {
      fireEvent.click(screen.getByText("beta.sdz"));
    });

    // beta.sdz has no "readme.txt", so the pane should read as freshly
    // arrived rather than carry alpha's selection over.
    expect(
      await screen.findByText("Select a file to preview it."),
    ).not.toBeNull();
  });

  it("does not leave a same-named folder expanded from the last archive", async () => {
    renderAtAlpha();

    fireEvent.click(await screen.findByText("docs"));
    expect(await screen.findByText("readme.txt")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("beta.sdz"));
    });

    // beta.sdz also has a "docs" folder (containing other.txt), which should
    // start collapsed rather than inherit alpha's expanded state.
    await screen.findByText("docs");
    expect(screen.queryByText("other.txt")).toBeNull();
  });
});
