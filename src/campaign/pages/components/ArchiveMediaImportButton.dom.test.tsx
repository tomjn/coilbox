// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the popover must show the failure and not say the game is not
 * installed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    error: null as string | null,
    loading: false,
  },
}));

vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => scan.current,
  useUnitsyncArchiveTree: () => ({ tree: null, loading: false }),
  useUnitsyncArchiveFile: () => ({ data: null, loading: false }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));

import { ArchiveMediaImportButton } from "./ArchiveMediaImportButton";

afterEach(cleanup);

function open() {
  render(
    <ArchiveMediaImportButton
      campaignId="c1"
      gameName="Splinter Faction"
      mediaType="image"
      onImported={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /From game files/ }));
}

describe("ArchiveMediaImportButton", () => {
  it("shows the failure and not a missing game when the scan failed", async () => {
    scan.current = {
      data: null,
      error: "no space left on device",
      loading: false,
    };
    open();
    expect(await screen.findByText(/no space left on device/)).toBeTruthy();
    expect(screen.queryByText(/isn't installed/)).toBeNull();
  });

  it("still says the game is not installed when the scan answered", async () => {
    scan.current = { data: { games: [] }, error: null, loading: false };
    open();
    expect(await screen.findByText(/isn't installed/)).toBeTruthy();
  });
});
