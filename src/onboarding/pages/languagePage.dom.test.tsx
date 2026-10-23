// @vitest-environment happy-dom

/**
 * The language page inside the real wizard shell, so Continue and Skip are the
 * footer's own buttons. The system language is stubbed to French, so the
 * preselection is not the source language by accident.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LANGUAGE_KEY } from "@/i18n/language";
import {
  LOCALES,
  localeDisplayName,
  PSEUDO_LOCALE,
  pickerLocales,
} from "@/i18n/locales";
import { Wizard } from "../Wizard";

let storage = memoryStorage();

function show() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <Wizard
          pages={["language", "done"]}
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

const stored = () => storage.get(LANGUAGE_KEY);
const option = (code: string) =>
  screen.getByRole("button", {
    name: new RegExp(`^${localeDisplayName(code)}`),
  });
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  storage = memoryStorage();
  vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("offers one option per locale, named in its own language", () => {
  show();
  const options = screen
    .getAllByRole("button")
    .filter((b) => b.hasAttribute("aria-pressed"));
  expect(options).toHaveLength(LOCALES.length);
  for (const code of LOCALES) expect(option(code)).toBeTruthy();
});

it("leaves out the pseudo-locale, which the Settings picker offers here", () => {
  // Tests run as a dev build, where the Settings picker lists it.
  expect(pickerLocales()).toContain(PSEUDO_LOCALE);
  show();
  expect(
    screen.queryByRole("button", {
      name: new RegExp(`^${localeDisplayName(PSEUDO_LOCALE)}`),
    }),
  ).toBeNull();
});

it("starts with the system locale selected", () => {
  show();
  expect(option("fr").getAttribute("aria-pressed")).toBe("true");
  expect(option("en").getAttribute("aria-pressed")).toBe("false");
  expect(stored()).toBeNull();
});

it("writes a pick to general.language straight away", () => {
  show();
  fireEvent.click(option("de"));
  expect(stored()).toBe(JSON.stringify("de"));
  expect(option("de").getAttribute("aria-pressed")).toBe("true");
});

it("writes the preselected locale on Continue with nothing changed", () => {
  show();
  click("Continue");
  expect(stored()).toBe(JSON.stringify("fr"));
});

it("leaves general.language unset on Skip", () => {
  show();
  click("Skip");
  expect(stored()).toBeNull();
});
