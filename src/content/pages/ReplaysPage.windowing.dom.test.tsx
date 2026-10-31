// @vitest-environment happy-dom
/**
 * Issue #3828: the replay list keeps only the rows in or near the viewport in
 * the page. happy-dom lays nothing out, so the shell's scroller and the rows'
 * heights are stubbed, and a row's real height follows from whether it has a
 * game type line, as it does on screen.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayFile } from "../bindings";

const COUNT = 5000;
const VIEW_HEIGHT = 800;
/** How far the list starts below the top of the scroller, for the page header. */
const LIST_TOP = 150;
const GAP = 8;
const PLAIN_ROW = 82;
const GAME_TYPE_ROW = 98;
const GAME_TYPE = "Rated duel";

const name = (i: number) => `r${String(i).padStart(4, "0")}.sdfz`;

// Every other row has a game type line, so heights alternate. Dates fall as the
// index rises, so the newest-first default keeps array order.
const replay = (i: number): ReplayFile =>
  ({
    filename: name(i),
    path: `/replays/${name(i)}`,
    sizeBytes: i + 1,
    modifiedMs: 2_000_000 - i,
    mapName: `Map ${name(i)}`,
    durationSec: 600,
    gameType: i % 2 === 1 ? GAME_TYPE : undefined,
  }) as ReplayFile;

const REPLAYS = Array.from({ length: COUNT }, (_, i) => replay(i));

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
const thumbs = vi.hoisted(() => ({ drawn: 0 }));
vi.mock("./components/MapThumb", () => ({
  MapThumb: () => {
    thumbs.drawn += 1;
    return null;
  },
}));

const { PersistentStoreProvider } = await import("@picoframe/frame");
const { memorySettingsStorage } = await import("@/lib/storedSetting");
const { default: ReplaysPage } = await import("./ReplaysPage");

let storage = memorySettingsStorage();

const realHeight = (row: Element) =>
  row.textContent?.includes(GAME_TYPE) ? GAME_TYPE_ROW : PLAIN_ROW;

const rect = (top: number, height: number) =>
  ({ top, height, bottom: top + height }) as DOMRect;

const scroller = () =>
  document.querySelector("main[data-slot='content-scroll']") as HTMLElement;

const rowsInPage = () =>
  Array.from(document.querySelectorAll<HTMLElement>("li[data-row-index]"));

const rowIndices = () => rowsInPage().map((li) => Number(li.dataset.rowIndex));

/** Where each row in the page sits, worked out from the page's own margins. */
function layout() {
  let y = 0;
  return rowsInPage().map((li) => {
    y += Number.parseFloat(li.style.marginTop || "0");
    const top = y;
    y += realHeight(li) + GAP;
    return { index: Number(li.dataset.rowIndex), top };
  });
}

/** The row's distance from the top of the viewport. */
const screenTop = (index: number) => {
  const row = layout().find((r) => r.index === index);
  if (!row) throw new Error(`row ${index} is not in the page`);
  return LIST_TOP - scroller().scrollTop + row.top;
};

const scrollTo = (scrollTop: number) =>
  fireEvent.scroll(scroller(), { target: { scrollTop } });

const renderPage = () =>
  render(
    <PersistentStoreProvider storage={storage}>
      <MemoryRouter>
        <main data-slot="content-scroll">
          <ReplaysPage />
        </main>
      </MemoryRouter>
    </PersistentStoreProvider>,
  );

beforeEach(() => {
  storage = memorySettingsStorage();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === "MAIN" ? VIEW_HEIGHT : 0;
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.tagName === "UL" && this.querySelector("li[data-row-index]")) {
        return rect(LIST_TOP - scroller().scrollTop, 0);
      }
      if (this.matches("li[data-row-index]")) {
        return rect(0, realHeight(this));
      }
      return rect(0, 0);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("the replay list's window", () => {
  it("puts only a window of a huge library in the page", () => {
    renderPage();
    // Three viewports of rows at the shortest row and gap, plus the row cut by
    // each edge, is the most the page may hold at the top of the list.
    const most = Math.ceil((3 * VIEW_HEIGHT) / (PLAIN_ROW + GAP)) + 2;
    expect(rowsInPage().length).toBeLessThanOrEqual(most);
    expect(rowIndices()[0]).toBe(0);
    expect(rowsInPage()[0]?.getAttribute("aria-setsize")).toBe(String(COUNT));
  });

  it("does not build the whole library on the way to the window", () => {
    // The layout effect would cut a first render of every row before anything
    // could look at the page, so this counts the rows that were ever drawn.
    thumbs.drawn = 0;
    renderPage();
    expect(thumbs.drawn).toBeLessThan(COUNT);
  });

  it("moves the window as the list scrolls", () => {
    renderPage();
    scrollTo(200_000);
    const shown = rowIndices();
    expect(shown).not.toContain(0);
    // Nothing above has been measured, so each counts as its estimate and gap.
    const atTop = Math.floor((200_000 - LIST_TOP) / (PLAIN_ROW + GAP));
    expect(shown[0]).toBeLessThanOrEqual(atTop);
    expect(shown[shown.length - 1]).toBeGreaterThan(atTop);
    expect(shown.length).toBeLessThan(40);
  });

  it("holds open the height of the rows it left out", () => {
    renderPage();
    scrollTo(50_000);
    const list = rowsInPage()[0]?.parentElement as HTMLElement;
    const first = rowsInPage()[0] as HTMLElement;
    expect(Number.parseFloat(first.style.marginTop)).toBeGreaterThan(0);
    expect(Number.parseFloat(list.style.paddingBottom)).toBeGreaterThan(0);
  });
});

describe("sorting and filtering", () => {
  it("sorts the whole library before cutting the window", () => {
    storage.set("content.replayFilters.sort", JSON.stringify("date-asc"));
    renderPage();
    // The oldest replay is last in the data, so it is far outside any window of
    // the unsorted list.
    expect(rowsInPage()[0]?.textContent).toContain(name(COUNT - 1));
  });

  it("finds a replay far outside the window when filtering", () => {
    const wanted = name(4321);
    storage.set("content.replayFilters.search", JSON.stringify(wanted));
    renderPage();
    expect(rowsInPage()).toHaveLength(1);
    expect(rowsInPage()[0]?.textContent).toContain(wanted);
    expect(rowsInPage()[0]?.getAttribute("aria-setsize")).toBe("1");
  });

  it("still shows rows when a filter shortens a list scrolled far down", async () => {
    renderPage();
    scrollTo(300_000);
    fireEvent.change(screen.getByLabelText("Filter replays"), {
      target: { value: name(7) },
    });
    await waitFor(() => expect(rowsInPage()).toHaveLength(1));
    expect(rowsInPage()[0]?.textContent).toContain(name(7));
  });
});

describe("rows of different heights", () => {
  it("places each row right after the real heights of the rows above", () => {
    renderPage();
    // Small steps, so every row passes through the window and gets measured.
    for (let y = 0; y <= 6000; y += 300) scrollTo(y);
    for (const { index, top } of layout()) {
      let expected = 0;
      for (let i = 0; i < index; i++) {
        expected += (i % 2 === 1 ? GAME_TYPE_ROW : PLAIN_ROW) + GAP;
      }
      expect(top).toBe(expected);
    }
  });

  it("does not overlap rows, since all but the skipped ones touch", () => {
    renderPage();
    scrollTo(40_000);
    const rows = rowsInPage();
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) {
      expect(row.style.marginTop).toBe("");
    }
  });

  it("keeps the rows on screen still when taller rows are measured above them", () => {
    renderPage();
    scrollTo(100_000);
    const anchor = rowIndices()[10] as number;
    const before = screenTop(anchor);
    const scrolledBefore = scroller().scrollTop;
    // Scrolling up mounts rows nobody has measured, half of them taller than the
    // estimate. Those above the view must not push the anchor down the screen.
    scrollTo(scrolledBefore - 400);
    expect(screenTop(anchor)).toBe(before + 400);
  });
});

describe("a row that holds focus", () => {
  it("keeps an open sets popover and what was typed when it scrolls away", async () => {
    renderPage();
    const firstRow = rowsInPage()[0] as HTMLElement;
    fireEvent.click(
      firstRow.querySelector(
        "button[aria-label='Sets for this replay']",
      ) as HTMLElement,
    );
    const input = (await screen.findByLabelText(
      "New set name",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Keepers" } });
    act(() => input.focus());

    scrollTo(100_000);

    expect(rowIndices()).toContain(0);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe("Keepers");
    // The next row stays too, so Tab lands on a real neighbour.
    expect(rowIndices()).toContain(1);
    expect(rowIndices().length).toBeLessThan(40);
  });

  it("lets the row go once focus moves out of the list", async () => {
    renderPage();
    const link = rowsInPage()[0]?.querySelector("a") as HTMLElement;
    act(() => link.focus());
    scrollTo(100_000);
    expect(rowIndices()).toContain(0);

    act(() => screen.getByLabelText("Filter replays").focus());
    await waitFor(() => expect(rowIndices()).not.toContain(0));
  });

  it("keeps the rows in order when a focused row is held below the window", () => {
    renderPage();
    scrollTo(100_000);
    const link = rowsInPage()[5]?.querySelector("a") as HTMLElement;
    act(() => link.focus());
    scrollTo(0);
    const shown = rowIndices();
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
    expect(link.isConnected).toBe(true);
  });
});
