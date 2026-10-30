// @vitest-environment happy-dom

/**
 * One toast host, not two (issue #4901).
 *
 * picoframe's `AppLayout` mounts a sonner host. A second one in the notify
 * plugin drew every toast twice, on top of itself, with two live regions for a
 * screen reader. This renders the real frame with the real plugin, so a host
 * coming back in either place makes the counts 2, and a release that stops
 * mounting one makes them 0.
 */

import { AppFrame, toast } from "@picoframe/frame";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(false),
}));

import notifyPlugin from "./index";

afterEach(() => {
  cleanup();
  toast.dismiss();
});

describe("the app frame with the notify plugin", () => {
  it("draws each toast once", async () => {
    render(<AppFrame plugins={[notifyPlugin]} />);

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
