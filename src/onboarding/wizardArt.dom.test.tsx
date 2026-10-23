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

vi.mock("@/hub/auth", () => ({
  hubAccount: async () => ({ signedIn: false, account: null, problem: null }),
  hubSignIn: () => new Promise(() => {}),
  hubSignOut: async () => {},
}));

const { Wizard } = await import("./Wizard");

function show() {
  return render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <Wizard
          pages={["language", "hub", "done"]}
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
  expect(screen.queryByTestId("page-art")).toBeNull();
});
