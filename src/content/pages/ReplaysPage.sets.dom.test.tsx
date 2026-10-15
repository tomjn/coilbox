// @vitest-environment happy-dom
/**
 * Issue #1180: a named set of replays narrows the replay list, and replays are
 * added to and removed from a set from the list. Sets live in the settings
 * store, so these tests run the real store over memory storage.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../bindings";

const file = (name: string, extra: Partial<ReplayFile> = {}): ReplayFile => ({
  filename: name,
  path: `/replays/${name}`,
  sizeBytes: 1,
  modifiedMs: 1,
  mapName: `Map of ${name}`,
  durationSec: 600,
  ...extra,
});

const REPLAYS = [file("a.sdfz"), file("b.sdfz"), file("c.sdfz")];

vi.mock("../config", () => ({
  useContentState: () => ({ state: { roots: [] } }),
  useReplayStats: () => ({ records: [] }),
  useReplays: () => ({
    replays: REPLAYS,
    loading: false,
    error: null,
    ready: true,
    refresh: async () => {},
  }),
  useScanTargetSelection: () => ({
    targets: [],
    selected: null,
    selectedKey: "",
    setSelectedKey: () => {},
  }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map(), loading: false }),
}));
vi.mock("../useReplaysRoot", () => ({ useReplaysRoot: () => "/replays" }));
vi.mock("../useMetricRegistry", () => ({ useMetricRegistry: () => [] }));
vi.mock("./components/BrowserToolbar", () => ({ BrowserToolbar: () => null }));
vi.mock("./components/GatherReplaysButton", () => ({
  GatherReplaysButton: () => null,
}));
vi.mock("./components/MapThumb", () => ({ MapThumb: () => null }));

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { memorySettingsStorage } = await import("@/lib/storedSetting");
const { default: ReplaysPage } = await import("./ReplaysPage");

let storage = memorySettingsStorage();

const stored = (key: string) => {
  const raw = storage.get(key);
  return raw == null ? undefined : JSON.parse(raw);
};

function renderPage() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <MemoryRouter>
        <ReplaysPage />
      </MemoryRouter>
    </PersistentStoreProvider>,
  );
}

const listed = () =>
  screen
    .queryAllByRole("link")
    .map((a) => a.textContent ?? "")
    .filter((t) => t.includes("Map of"));

beforeEach(() => {
  storage = memorySettingsStorage();
});
afterEach(cleanup);

describe("replay sets on the replays page", () => {
  it("narrows the list to a set and counts members that are not in the library", () => {
    storage.set(
      "content.replaySets",
      JSON.stringify([
        {
          id: "s1",
          name: "Finals",
          members: [{ filename: "b.sdfz" }, { filename: "gone.sdfz" }],
        },
      ]),
    );
    storage.set("content.replayFilters.set", JSON.stringify("s1"));
    renderPage();
    expect(listed()).toEqual([expect.stringContaining("Map of b.sdfz")]);
    expect(
      screen.getByRole("button", { name: /Set: Finals \(1 not in library\)/ }),
    ).toBeTruthy();
  });

  it("shows every replay when the saved set no longer exists", () => {
    storage.set("content.replayFilters.set", JSON.stringify("deleted"));
    renderPage();
    expect(listed()).toHaveLength(3);
  });

  it("adds a replay to a new set from its row, then removes it", async () => {
    renderPage();
    const rowButtons = screen.getAllByRole("button", {
      name: "Sets for this replay",
    });
    fireEvent.click(rowButtons[1]);
    fireEvent.change(await screen.findByLabelText("New set name"), {
      target: { value: "  Night one " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(stored("content.replaySets")).toEqual([
        expect.objectContaining({
          name: "Night one",
          members: [{ filename: "b.sdfz" }],
        }),
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Night one" }));
    await waitFor(() =>
      expect(stored("content.replaySets")[0].members).toEqual([]),
    );
  });

  it("refuses a second set with the same name ignoring case", async () => {
    storage.set(
      "content.replaySets",
      JSON.stringify([{ id: "s1", name: "Finals", members: [] }]),
    );
    renderPage();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Sets for this replay" })[0],
    );
    fireEvent.change(await screen.findByLabelText("New set name"), {
      target: { value: "FINALS" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /already exists/,
    );
    expect(stored("content.replaySets")).toHaveLength(1);
  });

  it.each([
    [[], "Delete the set “Finals”? Only the set goes."],
    [
      [{ filename: "b.sdfz" }],
      "Delete the set “Finals”? Only the set goes. Its 1 replay stays in your library.",
    ],
    [
      [{ filename: "a.sdfz" }, { filename: "b.sdfz" }],
      "Delete the set “Finals”? Only the set goes. Its 2 replays stay in your library.",
    ],
  ])("words the delete confirmation for members %j", async (members, text) => {
    storage.set(
      "content.replaySets",
      JSON.stringify([{ id: "s1", name: "Finals", members }]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Sets \(1\)$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete set" }));
    const confirm = await screen.findByText(/Only the set goes/);
    expect(confirm.textContent).toBe(text);
  });

  it.each([
    [1, "1 not in your library. It stays in the set."],
    [2, "2 not in your library. They stay in the set."],
  ])("words the missing note for %i missing", async (count, text) => {
    const members = Array.from({ length: count }, (_, i) => ({
      filename: `gone${i}.sdfz`,
    }));
    storage.set(
      "content.replaySets",
      JSON.stringify([{ id: "s1", name: "Finals", members }]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Sets \(1\)$/ }));
    expect((await screen.findByText(/not in your library/)).textContent).toBe(
      text,
    );
  });

  it("adds every shown replay to a set and deletes the set without touching replays", async () => {
    storage.set(
      "content.replaySets",
      JSON.stringify([{ id: "s1", name: "Finals", members: [] }]),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Sets \(1\)$/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Add the 3 shown/ }),
    );
    await waitFor(() =>
      expect(stored("content.replaySets")[0].members).toHaveLength(3),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete set" }));
    const confirm = await screen.findByText(/Only the set goes/);
    expect(confirm.textContent).toMatch(/stay in your library/);
    const dialogArea = confirm.parentElement as HTMLElement;
    fireEvent.click(
      within(dialogArea).getByRole("button", { name: "Delete set" }),
    );
    await waitFor(() => expect(stored("content.replaySets")).toEqual([]));
    expect(listed()).toHaveLength(3);
  });
});
