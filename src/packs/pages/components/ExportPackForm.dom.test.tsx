// @vitest-environment happy-dom
/**
 * A scan whose unitsync Init failed has not said what is installed (issue
 * #3423), so the pickers must show the failure and not say no games or maps
 * are installed.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scan = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    error: null as string | null,
    loading: false,
  },
}));

vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => scan.current,
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: {} }),
}));
vi.mock("../../../play/presets", () => ({
  useSkirmishPresets: () => ({ presets: [] }),
}));

import { ExportPackForm } from "./ExportPackForm";

afterEach(cleanup);

describe("ExportPackForm", () => {
  it("shows the failure and not an empty install when the scan failed", () => {
    scan.current = {
      data: null,
      error: "no space left on device",
      loading: false,
    };
    render(<ExportPackForm />);
    expect(screen.getAllByText(/no space left on device/)).toHaveLength(2);
    expect(screen.queryByText(/installed for this engine/)).toBeNull();
  });

  it("still says nothing is installed when the scan answered empty", () => {
    scan.current = {
      data: { games: [], maps: [] },
      error: null,
      loading: false,
    };
    render(<ExportPackForm />);
    expect(
      screen.getByText("No games installed for this engine."),
    ).toBeTruthy();
  });
});
