// @vitest-environment happy-dom

/**
 * One toast host, not two (issue #4901).
 *
 * picoframe's `AppLayout` mounts a sonner host. A second one here drew every
 * toast twice, on top of itself, with two live regions for a screen reader. The
 * layout's host is stood in for by the frame's own `Toaster`, mounted beside
 * `NotifyProvider`, so a host coming back in the provider makes the counts 2.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
  Toaster,
  toast,
} from "@picoframe/frame";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(false),
}));

import { NotifyProvider } from "./NotifyProvider";

afterEach(() => {
  cleanup();
  toast.dismiss();
});

describe("the notify provider", () => {
  it("draws each toast once", async () => {
    render(
      <PersistentStoreProvider storage={memoryStorage()}>
        <ThemeProvider>
          <NotifyProvider>
            <Toaster />
          </NotifyProvider>
        </ThemeProvider>
      </PersistentStoreProvider>,
    );

    toast.error("Your settings could not be read");

    await waitFor(() =>
      expect(screen.getByText("Your settings could not be read")).toBeTruthy(),
    );
    expect(
      document.querySelectorAll('section[aria-label^="Notifications"]'),
    ).toHaveLength(1);
    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
  });
});
