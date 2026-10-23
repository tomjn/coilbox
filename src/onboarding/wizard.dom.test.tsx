// @vitest-environment happy-dom

/**
 * The onboarding provider and the wizard shell it opens. Relevance is set
 * directly through a stubbed `useWizardContext`, so each test reads as one row
 * of the spec's "Which pages a launch shows" rules.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WizardContext } from "./relevance";

const IRRELEVANT: WizardContext = {
  languageStored: true,
  profileMode: true,
  profileColours: true,
  hubEnabled: false,
  hub: { loading: false, signedIn: false, unknown: false },
  lobbyAccountCount: 1,
  games: { kind: "none" },
};

let ctx: WizardContext = IRRELEVANT;
vi.mock("./useWizardContext", () => ({
  useWizardContext: () => ({ ctx, candidates: [] }),
}));

// The background downloads have their own test. Here they would reach Tauri.
vi.mock("./useBackgroundDownloads", () => ({
  useBackgroundDownloads: () => ({
    items: [],
    cancel: () => {},
    retry: () => {},
  }),
}));

const { OnboardingProvider } = await import("./OnboardingProvider");
const { requestOnboardingRerun } = await import("./rerun");
const { SETTLED_KEY } = await import("./ids");

let storage = memoryStorage();

function show() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <OnboardingProvider>
          <p>home</p>
        </OnboardingProvider>
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const settled = (): string[] => JSON.parse(storage.get(SETTLED_KEY) ?? "[]");
const wizard = () => screen.queryByRole("dialog");
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  storage = memoryStorage();
  ctx = IRRELEVANT;
});

afterEach(() => {
  cleanup();
});

it("renders nothing when every page but done is irrelevant", () => {
  show();
  expect(screen.getByText("home")).toBeTruthy();
  expect(wizard()).toBeNull();
  expect(settled()).toEqual([
    "language",
    "appearance",
    "games",
    "hub",
    "server",
    "done",
  ]);
});

it("opens on a relevant page, ends on done, and settles nothing on open", () => {
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  expect(wizard()).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Log in to a server" }),
  ).toBeTruthy();
  expect(screen.getAllByTestId("wizard-step")).toHaveLength(2);
  expect(settled()).not.toContain("server");
  expect(settled()).not.toContain("done");

  click("Continue");
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(settled()).toContain("server");
  // Theme names, not raw ids such as "zinc".
  expect(
    screen.getByText(/^(Light|Dark|System), [A-Z]\w* \/ [A-Z]\w*$/),
  ).toBeTruthy();
  // The last page offers one way out.
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  click("Go to Home");
  expect(wizard()).toBeNull();
  expect(settled()).toContain("done");
});

it("settles the page on Skip", () => {
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  click("Skip");
  expect(settled()).toContain("server");
  expect(settled()).not.toContain("done");
});

it("goes back without unsettling anything", () => {
  ctx = { ...IRRELEVANT, languageStored: false, lobbyAccountCount: 0 };
  show();
  click("Continue");
  expect(
    screen.getByRole("heading", { name: "Log in to a server" }),
  ).toBeTruthy();
  click("Back");
  expect(
    screen.getByRole("heading", { name: "Choose your language" }),
  ).toBeTruthy();
  expect(settled()).toContain("language");
});

it("settles every page in the run on Skip setup and removes the overlay", () => {
  ctx = { ...IRRELEVANT, languageStored: false, lobbyAccountCount: 0 };
  show();
  click("Skip setup");
  expect(wizard()).toBeNull();
  expect(screen.getByText("home")).toBeTruthy();
  expect(settled()).toEqual(
    expect.arrayContaining(["language", "server", "done"]),
  );
});

it("stays open when Escape is pressed", () => {
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(wizard()).toBeTruthy();
});

it("draws the overlay over the whole window below popovers", () => {
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  const overlay = screen.getByRole("dialog");
  expect(overlay.className).toContain("fixed");
  expect(overlay.className).toContain("inset-0");
  expect(overlay.className).toContain("z-40");
});

/** The wrapper the provider puts round the app. */
const appIsInert = () =>
  screen.getByText("home").parentElement?.hasAttribute("inert");

it("makes the app inert while the wizard is open, and focuses the wizard", () => {
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  expect(appIsInert()).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("dialog"));
  click("Skip setup");
  expect(wizard()).toBeNull();
  expect(appIsInert()).toBe(false);
});

it("leaves the app alone when the wizard does not open", () => {
  show();
  expect(appIsInert()).toBe(false);
});

it("shows a blank frame while an unsettled page has not answered", () => {
  ctx = { ...IRRELEVANT, games: null };
  show();
  expect(screen.getByTestId("onboarding-waiting").className).toContain(
    "fixed inset-0 z-40",
  );
  expect(wizard()).toBeNull();
  expect(appIsInert()).toBe(true);
  expect(settled()).toEqual([]);
});

it("shows no blank frame when the unanswered page is already settled", () => {
  storage.set(
    SETTLED_KEY,
    JSON.stringify([
      "language",
      "appearance",
      "games",
      "hub",
      "server",
      "done",
    ]),
  );
  ctx = { ...IRRELEVANT, games: null };
  show();
  expect(screen.queryByTestId("onboarding-waiting")).toBeNull();
  expect(appIsInert()).toBe(false);
});

it("uses the new pages eyebrow once done is settled", () => {
  storage.set(
    SETTLED_KEY,
    JSON.stringify(["language", "appearance", "games", "hub", "done"]),
  );
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  expect(screen.getByText("New in Coilbox")).toBeTruthy();
  expect(screen.getAllByTestId("wizard-step")).toHaveLength(1);
  // A one page run ends on that page.
  click("Go to Home");
  expect(wizard()).toBeNull();
  expect(settled()).toContain("server");
});

it("opens again on a rerun request once everything is settled", () => {
  storage.set(
    SETTLED_KEY,
    JSON.stringify([
      "language",
      "appearance",
      "games",
      "hub",
      "server",
      "done",
    ]),
  );
  ctx = { ...IRRELEVANT, lobbyAccountCount: 0 };
  show();
  expect(wizard()).toBeNull();
  act(() => requestOnboardingRerun());
  expect(
    screen.getByRole("heading", { name: "Log in to a server" }),
  ).toBeTruthy();
  expect(screen.getAllByTestId("wizard-step")).toHaveLength(2);
});
