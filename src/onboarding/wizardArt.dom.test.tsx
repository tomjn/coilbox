// @vitest-environment happy-dom

/**
 * The art the wizard shell paints behind a page, and where the downloads pill
 * sits. The hub account commands are stubbed because the hub page reaches
 * Tauri through them.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { BackgroundProblem } from "./useBackgroundDownloads";

vi.mock("@/hub/auth", () => ({
  hubAccount: async () => ({ signedIn: false, account: null, problem: null }),
  hubSignIn: () => new Promise(() => {}),
  hubSignOut: async () => {},
}));

const { Wizard } = await import("./Wizard");

const PROBLEM: BackgroundProblem = {
  id: "engine",
  label: "Engine",
  message: "offline",
  retry: true,
};

function show(problems: BackgroundProblem[] = []) {
  return render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <Wizard
          pages={["language", "hub", "done"]}
          onSettle={() => {}}
          onClose={() => {}}
          downloads={[]}
          problems={problems}
          onCancelDownload={() => {}}
          onRetryDownload={() => {}}
        />
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const layer = () => screen.queryByTestId("wizard-art");

afterEach(() => {
  cleanup();
});

it("paints nothing behind a page that declares no art", () => {
  show();
  expect(layer()).toBeNull();
  expect(screen.queryByTestId("page-art")).toBeNull();
});

it("paints a page's drawing behind the step bar and the page, not the footer", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const art = screen.getByTestId("page-art");
  expect(art.getAttribute("data-art")).toBe("hub.browse");
  const area = layer()?.parentElement;
  expect(area?.contains(screen.getAllByTestId("wizard-step")[0])).toBe(true);
  expect(area?.contains(screen.getByRole("heading"))).toBe(true);
  expect(area?.contains(screen.getByRole("button", { name: "Continue" }))).toBe(
    false,
  );
});

it("paints the Done picture in the same shell layer", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(layer()?.contains(screen.getByTestId("done-backdrop"))).toBe(true);
  // Fades into the footer rather than stopping at its border.
  expect(layer()?.style.maskImage).toContain("transparent");
  expect(screen.queryByTestId("page-art")).toBeNull();
});

it("puts the downloads pill in the footer, clear of the step bar", () => {
  show([PROBLEM]);
  const pill = screen.getByTestId("downloads-pill");
  expect(screen.getByTestId("wizard-footer").contains(pill)).toBe(true);
  // Nothing sits above the step bar, so it is in the same place with or
  // without a pill.
  const stepRow = screen.getAllByTestId("wizard-step")[0].parentElement;
  expect(stepRow?.previousElementSibling).toBeNull();
  expect(stepRow?.parentElement?.previousElementSibling).toBeNull();
});

it("keeps the step bar's place the same without a pill", () => {
  show();
  expect(screen.queryByTestId("downloads-pill")).toBeNull();
  const stepRow = screen.getAllByTestId("wizard-step")[0].parentElement;
  expect(stepRow?.previousElementSibling).toBeNull();
  expect(stepRow?.parentElement?.previousElementSibling).toBeNull();
});
