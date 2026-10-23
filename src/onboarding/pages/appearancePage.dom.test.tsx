// @vitest-environment happy-dom

/**
 * The appearance page inside the real wizard shell and the real picoframe
 * theme, with the loaded profile stubbed so each test can say which parts of
 * the theme a distribution forces.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Profile } from "@/profile/profile";
import { Wizard } from "../Wizard";
import { ACCENT_OPTIONS, BASE_OPTIONS } from "./themeOptions";

let profile: Pick<Profile, "mode" | "accent" | "base"> = {};

vi.mock("@/profile/profile", async (original) => ({
  ...(await original<typeof import("@/profile/profile")>()),
  getProfile: () => profile,
}));

let storage = memoryStorage();

function show() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <Wizard
          pages={["appearance", "done"]}
          newPagesRun={false}
          onSettle={() => {}}
          onClose={() => {}}
          downloads={[]}
          onCancelDownload={() => {}}
          onRetryDownload={() => {}}
        />
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const group = (name: string) => screen.queryByRole("radiogroup", { name });
const accentTeal = () =>
  within(screen.getByRole("radiogroup", { name: "Accent color" })).getByRole(
    "radio",
    { name: "Teal" },
  );

beforeEach(() => {
  storage = memoryStorage();
  localStorage.clear();
  profile = {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows all three rows when the profile forces nothing", () => {
  show();
  expect(group("Theme")).toBeTruthy();
  expect(group("Base color")).toBeTruthy();
  expect(group("Accent color")).toBeTruthy();
});

it("hides the mode row when the profile sets the mode", () => {
  profile = { mode: "dark" };
  show();
  expect(group("Theme")).toBeNull();
  expect(group("Base color")).toBeTruthy();
  expect(group("Accent color")).toBeTruthy();
});

it("hides both colour rows when the profile sets the accent", () => {
  profile = { accent: "blue" };
  show();
  expect(group("Theme")).toBeTruthy();
  expect(group("Base color")).toBeNull();
  expect(group("Accent color")).toBeNull();
});

it("hides both colour rows when the profile sets the base", () => {
  profile = { base: "slate" };
  show();
  expect(group("Base color")).toBeNull();
  expect(group("Accent color")).toBeNull();
});

it("applies an accent swatch straight away", () => {
  show();
  const teal = accentTeal();
  fireEvent.click(teal);
  expect(teal.getAttribute("aria-checked")).toBe("true");
  expect(document.documentElement.dataset.accent).toBe("teal");
});

it("applies a mode straight away", () => {
  show();
  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(
    screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked"),
  ).toBe("true");
});

it("names every swatch after its value's label", () => {
  show();
  const base = group("Base color");
  const accent = group("Accent color");
  if (!base || !accent) throw new Error("colour rows missing");
  const names = (row: HTMLElement) =>
    Array.from(row.querySelectorAll('[role="radio"]')).map((el) =>
      el.getAttribute("aria-label"),
    );
  expect(names(base)).toHaveLength(BASE_OPTIONS.length);
  expect(names(accent)).toHaveLength(ACCENT_OPTIONS.length);
  for (const name of [...names(base), ...names(accent)]) {
    expect(name).toBeTruthy();
  }
  expect(names(accent)).toContain("Default");
  expect(names(base)).toContain("Zinc");
  expect(accentTeal().getAttribute("aria-checked")).toBe("false");
});
