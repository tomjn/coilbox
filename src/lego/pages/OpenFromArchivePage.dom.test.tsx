// @vitest-environment happy-dom
/**
 * Issue #1906. `/lego/open` reads its archive and member off the URL's query
 * string, and the browser can send somebody straight from one open link to
 * another without this page ever unmounting in between: only today's route
 * in unmounts on the way back, but any second route in would trip this the
 * same way. Before the fix, a `started` ref guarded against a re-render
 * starting a second import, but nothing lowered it when the request changed,
 * so the second model's header and description showed correctly while the
 * body went on reporting whatever the first one read, right down to the
 * button that would have saved it under the wrong name.
 *
 * `readModel` is mocked with a resolver per model name, kept in a map so the
 * test controls exactly when each read finishes. That is what the second
 * case below needs: the first model's read is left unresolved until after
 * the second has already landed, to prove a slow first read cannot overwrite
 * a faster second one.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportStage } from "./components/ImportResult";

const { resolvers } = vi.hoisted(() => ({
  resolvers: new Map<string, (stage: ImportStage) => void>(),
}));

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engines/105", rootPath: "/data" },
    loading: false,
  }),
  useUnitsyncArchiveTree: (
    _enginePath?: string,
    _dataDir?: string,
    archive?: string,
  ) => ({
    tree: archive ? { files: [], errors: [] } : null,
    loading: false,
  }),
}));

vi.mock("../projects", () => ({
  useLegoProjects: () => ({ projects: [], loading: false }),
  saveProject: vi.fn(async (project) => project),
}));

vi.mock("../gameModels", () => ({
  openedProjectFor: () => undefined,
}));

vi.mock("../gameImport", () => ({
  modelSource: (picked: { member: string }) => picked.member,
  stageModel: vi.fn(async () => ({ path: "/tmp/model.s3o", staged: null })),
  stageTextures: vi.fn(async () => {}),
}));

vi.mock("./components/ImportResult", async () => {
  const actual = await vi.importActual<
    typeof import("./components/ImportResult")
  >("./components/ImportResult");
  return {
    ...actual,
    readModel: vi.fn(
      (options: { name?: string }) =>
        new Promise<ImportStage>((resolve) => {
          resolvers.set(options.name ?? "", resolve);
        }),
    ),
  };
});

const { default: OpenFromArchivePage } = await import("./OpenFromArchivePage");

afterEach(() => {
  cleanup();
  resolvers.clear();
  vi.clearAllMocks();
});

/** A minimal "imported" stage, naming only what the page itself reads back:
 *  the project name the Open button prints. */
function importedStage(name: string): ImportStage {
  return {
    state: "imported",
    refused: "not made here",
    imported: {
      project: { name, pieces: [] },
      meshes: 0,
      vertices: 0,
      triangles: 0,
      converted: 0,
      bytes: 0,
    },
  } as unknown as ImportStage;
}

const ROUTES: RouteObject[] = [
  { path: "/lego/open", element: <OpenFromArchivePage /> },
];

const ANT_URL =
  "/lego/open?archive=archive.sdz&member=objects3d%2Fcritter_ant.s3o";
const DUCK_URL =
  "/lego/open?archive=archive.sdz&member=objects3d%2Fcritter_duck.s3o";

describe("OpenFromArchivePage across a request change without unmounting", () => {
  it("reports the second model under its own name rather than the first's", async () => {
    const router = createMemoryRouter(ROUTES, { initialEntries: [ANT_URL] });
    render(<RouterProvider router={router} />);

    await screen.findByText("Reading the model.");
    resolvers.get("critter_ant")?.(importedStage("critter_ant"));
    expect(await screen.findByText("Open critter_ant")).not.toBeNull();

    // The archive browser's own link to a second model, reached directly
    // rather than through a link inside this page, is what #1906 was found
    // through: it lands on the same route with new query params and does not
    // remount the page.
    await act(async () => {
      await router.navigate(DUCK_URL);
    });

    resolvers.get("critter_duck")?.(importedStage("critter_duck"));

    expect(await screen.findByText("Open critter_duck")).not.toBeNull();
    expect(screen.queryByText("Open critter_ant")).toBeNull();
  });

  it("does not let a slow first read land after a faster second one finishes", async () => {
    const router = createMemoryRouter(ROUTES, { initialEntries: [ANT_URL] });
    render(<RouterProvider router={router} />);

    await screen.findByText("Reading the model.");
    // The first model's read is left pending on purpose.

    await act(async () => {
      await router.navigate(DUCK_URL);
    });
    await screen.findByText("Reading the model.");

    resolvers.get("critter_duck")?.(importedStage("critter_duck"));
    expect(await screen.findByText("Open critter_duck")).not.toBeNull();

    // The stale first read finishes after the second already landed. It must
    // not overwrite what is on screen.
    await act(async () => {
      resolvers.get("critter_ant")?.(importedStage("critter_ant"));
    });

    expect(screen.queryByText("Open critter_ant")).toBeNull();
    expect(await screen.findByText("Open critter_duck")).not.toBeNull();
  });
});
