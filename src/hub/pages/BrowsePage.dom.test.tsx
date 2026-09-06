// @vitest-environment happy-dom

/**
 * The three unblocked pieces of issue #2567: a "/" shortcut to the search box
 * that never steals a keystroke from a field or an open menu, and paging that
 * scrolls the results back to the top and moves keyboard focus there. Plus the
 * sort and multi-select work of issue #2595: a sort control, several kinds at
 * once, and pressing a second author or tag chip adding to the filters rather
 * than replacing them.
 *
 * Everything not under test - the account/share header controls, the game and
 * map comboboxes, the local-install scan, and the presence lookup that decides
 * whether a card offers "Open" - is stubbed out, following
 * `GameDetailPage.dom.test.tsx`'s shape for a page with this many hooks.
 *
 * `OptionSelect` is stubbed with a plain `<select>` for the same reason
 * `leftoverRelayAgent.dom.test.tsx` stubs it: the real one is a Radix popover
 * with pointer-capture behaviour happy-dom does not implement, and this test
 * is about the wiring from the sort control to `HubFilters`, not about
 * Radix's own combobox behaviour.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { kindLabelPlural } from "../api";
import type { BrowseResult } from "../browse";

vi.mock("../config", () => ({
  useHubUrl: () => "https://hub.example",
  hubItemRoute: (id: string) => `/hub/items/${id}`,
}));

vi.mock("../imports", () => ({
  useHubItemPresence: () => () => ({ state: "none" }),
}));

vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({ selected: null }),
  useUnitsyncScan: () => ({ data: null }),
}));

vi.mock("@/profile/profile", () => ({
  getGameMatcher: () => null,
  getProfile: () => ({}),
}));

vi.mock("@/home/useHomeBackdropStyle", () => ({
  useHomeBackdropStyle: () => null,
}));

vi.mock("./components/FilterCombobox", () => ({
  FilterCombobox: () => null,
}));
vi.mock("./components/HeaderAccount", () => ({ HeaderAccount: () => null }));
vi.mock("./components/ShareMenu", () => ({ ShareMenu: () => null }));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

let mockResult: BrowseResult = {
  items: [],
  total: 0,
  page: 1,
  lastPage: 1,
  truncated: null,
};
// Typed against the real `loadBrowsePage` (rather than left to infer from
// this implementation, which ignores every argument) so `.mock.calls[n][1]`
// below is the `HubFilters` the page actually asked for, not `never`.
const loadBrowsePage = vi.fn<typeof import("../browse").loadBrowsePage>(
  async () => ({
    ok: true as const,
    value: mockResult,
  }),
);

vi.mock("../browse", async () => ({
  ...(await vi.importActual<typeof import("../browse")>("../browse")),
  loadBrowsePage: (...args: Parameters<typeof loadBrowsePage>) =>
    loadBrowsePage(...args),
}));

const { default: BrowsePage } = await import("./BrowsePage");

afterEach(cleanup);

function item(
  id: string,
  title: string,
  overrides: { author_name?: string; tags?: string[] } = {},
) {
  return {
    id,
    kind: "preset" as const,
    mode: null,
    title,
    description: "",
    game_name: null,
    game_key: null,
    map_name: null,
    tags: [],
    author_name: "Someone",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The filters `loadBrowsePage` was asked for on the next call after
 * `callsBefore`, once the state update behind a click has reached the
 * effect that fetches. */
async function nextFilters(callsBefore: number) {
  await waitFor(() =>
    expect(loadBrowsePage.mock.calls.length).toBeGreaterThan(callsBefore),
  );
  return loadBrowsePage.mock.calls.at(-1)?.[1];
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BrowsePage />
    </MemoryRouter>,
  );
}

it('focuses the search box on "/"', async () => {
  renderPage();
  await screen.findByLabelText("Search the hub");

  fireEvent.keyDown(document.body, { key: "/" });

  expect(document.activeElement).toBe(screen.getByLabelText("Search the hub"));
});

it('leaves "/" alone while the search box already has it', async () => {
  renderPage();
  const search = await screen.findByLabelText("Search the hub");
  search.focus();

  const event = new KeyboardEvent("keydown", { key: "/", bubbles: true });
  const prevented = !search.dispatchEvent(event);

  // Typing "/" into the box the user is already in is the browser's own job:
  // the page must not call preventDefault on it.
  expect(prevented).toBe(false);
});

it('leaves "/" alone while a menu is open elsewhere on the page', async () => {
  renderPage();
  await screen.findByLabelText("Search the hub");

  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  const menuItem = document.createElement("div");
  menuItem.setAttribute("tabindex", "-1");
  menu.appendChild(menuItem);
  menuItem.focus();

  fireEvent.keyDown(menuItem, { key: "/" });

  expect(document.activeElement).toBe(menuItem);
  menu.remove();
});

it("scrolls the results back to the top and focuses them when paging", async () => {
  mockResult = {
    items: [item("1", "First"), item("2", "Second")],
    total: 48,
    page: 1,
    lastPage: 2,
    truncated: null,
  };
  renderPage();
  await screen.findByText("First");

  const results = screen.getByLabelText("Hub results");
  Object.defineProperty(results, "scrollTop", {
    value: 400,
    writable: true,
  });

  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(results.scrollTop).toBe(0);
  expect(document.activeElement).toBe(results);
});

it("shows the truncated-hub notice beside the item count rather than below the grid", async () => {
  mockResult = {
    items: [item("1", "First")],
    total: 1,
    page: 1,
    lastPage: 1,
    truncated: { scanned: 480 },
  };
  renderPage();
  await screen.findByText("First");

  const notice = screen.getByText(/Only the first 480 items on the hub were/);
  const count = screen.getByText("1 item");
  // Siblings under the same row, not one above the grid and one below it.
  expect(notice.parentElement).toBe(count.parentElement);
});

it("sends sort when a sort other than the default is chosen", async () => {
  mockResult = {
    items: [item("1", "First")],
    total: 1,
    page: 1,
    lastPage: 1,
    truncated: null,
  };
  renderPage();
  await screen.findByText("First");
  const callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.change(screen.getByLabelText("Sort"), {
    target: { value: "title" },
  });

  const filters = await nextFilters(callsBefore);
  expect(filters?.sort).toBe("title");
});

it("sends two kind values when two kinds are chosen", async () => {
  mockResult = {
    items: [item("1", "First")],
    total: 1,
    page: 1,
    lastPage: 1,
    truncated: null,
  };
  renderPage();
  await screen.findByText("First");
  let callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(
    screen.getByRole("button", { name: kindLabelPlural("preset") }),
  );
  await nextFilters(callsBefore);
  callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(
    screen.getByRole("button", { name: kindLabelPlural("blueprint") }),
  );
  const filters = await nextFilters(callsBefore);

  expect(filters?.kind).toEqual(["preset", "blueprint"]);
});

it("adds a second author chip to the filter rather than replacing the first", async () => {
  mockResult = {
    items: [
      item("1", "First", { author_name: "Alice" }),
      item("2", "Second", { author_name: "Bob" }),
    ],
    total: 2,
    page: 1,
    lastPage: 1,
    truncated: null,
  };
  renderPage();
  await screen.findByText("First");
  let callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "by Alice" }));
  await nextFilters(callsBefore);
  callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "by Bob" }));
  const filters = await nextFilters(callsBefore);

  expect(filters?.author).toEqual(["Alice", "Bob"]);
});

it("removing one filter token leaves the others in place", async () => {
  mockResult = {
    items: [
      item("1", "First", { author_name: "Alice" }),
      item("2", "Second", { author_name: "Bob" }),
    ],
    total: 2,
    page: 1,
    lastPage: 1,
    truncated: null,
  };
  renderPage();
  await screen.findByText("First");
  let callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "by Alice" }));
  await nextFilters(callsBefore);
  callsBefore = loadBrowsePage.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "by Bob" }));
  await nextFilters(callsBefore);
  callsBefore = loadBrowsePage.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: /^By: Alice/ }));
  const filters = await nextFilters(callsBefore);

  expect(filters?.author).toEqual(["Bob"]);
});
