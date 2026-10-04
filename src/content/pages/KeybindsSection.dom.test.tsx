// @vitest-environment happy-dom
/**
 * The keymap editor's game picker when the scan failed. The picker is disabled
 * because there are no games, and the page has to say that the scan failed
 * rather than leave a dead picker.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

const h = vi.hoisted(() => ({
  scan: { data: null as unknown, error: null as string | null, loading: false },
}));

vi.mock("../config", () => ({
  useScanTargetSelection: () => ({
    targets: [{ enginePath: "/engine", rootPath: "/data" }],
    selected: { enginePath: "/engine", rootPath: "/data" },
    selectedKey: "k",
    setSelectedKey: vi.fn(),
    loading: false,
    refresh: vi.fn(),
  }),
  useUnitsyncEngineConfig: () => ({ data: null }),
  useUnitsyncScan: () => ({ ...h.scan, run: vi.fn() }),
  useUnitsyncGameHeaders: () => ({ headers: {} }),
  useUnitsyncArchiveFile: () => ({ data: null }),
  useKeybinds: () => ({ data: null, error: null, write: vi.fn() }),
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null }),
}));
vi.mock("../../play/drafts", () => ({
  useSkirmishDraft: () => [{ gameName: "" }],
}));
vi.mock("../../play/pages/components/GamePickerButton", () => ({
  GamePickerField: () => null,
}));
vi.mock("./components/BrowserToolbar", () => ({
  BrowserToolbar: () => null,
}));
vi.mock("./components/KeyboardMap", () => ({ KeyboardMap: () => null }));
vi.mock("./components/BindingList", () => ({ BindingList: () => null }));
vi.mock("./components/KeyBindingEditor", () => ({
  KeyBindingEditor: () => null,
}));
vi.mock("./components/KeymapsPanel", () => ({
  KeymapsPanel: () => null,
  applyContainerText: () => null,
}));

import KeybindsSection from "./KeybindsSection";

afterEach(cleanup);

function renderSection() {
  return render(
    <MemoryRouter>
      <KeybindsSection />
    </MemoryRouter>,
  );
}

describe("KeybindsSection with a failed scan", () => {
  it("gives the reason the game picker has nothing to offer", () => {
    h.scan = { data: null, error: REASON, loading: false };
    renderSection();
    expect(screen.getByText(new RegExp(REASON))).toBeTruthy();
  });

  it("shows no scan failure when the scan answered", () => {
    h.scan = {
      data: { maps: [], games: [], errors: [] },
      error: null,
      loading: false,
    };
    renderSection();
    expect(screen.queryByText(/The scan failed/)).toBeNull();
  });
});
