// @vitest-environment happy-dom

/**
 * The three unblocked pieces of issue #2567: a "/" shortcut to the search box
 * that never steals a keystroke from a field or an open menu, and paging that
 * scrolls the results back to the top and moves keyboard focus there.
 *
 * Everything not under test - the account/share header controls, the game and
 * map comboboxes, the local-install scan, and the presence lookup that decides
 * whether a card offers "Open" - is stubbed out, following
 * `GameDetailPage.dom.test.tsx`'s shape for a page with this many hooks.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
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

let mockResult: BrowseResult = {
  items: [],
  total: 0,
  page: 1,
  lastPage: 1,
  truncated: null,
};
const loadBrowsePage = vi.fn(async () => ({
  ok: true as const,
  value: mockResult,
}));

vi.mock("../browse", async () => ({
  ...(await vi.importActual<typeof import("../browse")>("../browse")),
  loadBrowsePage: (...args: Parameters<typeof loadBrowsePage>) =>
    loadBrowsePage(...args),
}));

const { default: BrowsePage } = await import("./BrowsePage");

afterEach(cleanup);

function item(id: string, title: string) {
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
  };
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
