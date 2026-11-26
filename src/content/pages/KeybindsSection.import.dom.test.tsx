// @vitest-environment happy-dom
/**
 * A shared keymap link usually lands before uikeys.txt has been read. The
 * keymap it carries has to survive the file loading underneath it, rather than
 * being replaced by the file's own bindings.
 */
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Keymap, SavedKeymap } from "../keymap";

const LINKED: SavedKeymap = {
  bindings: [{ keys: "Ctrl+q", action: "linkedaction" }],
  fakeMeta: null,
  keysyms: [],
};

const h = vi.hoisted(() => ({
  file: null as unknown,
  shown: null as Keymap | null,
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
  useUnitsyncScan: () => ({ data: null, error: null, loading: false }),
  useUnitsyncGameHeaders: () => ({ headers: {} }),
  useUnitsyncArchiveFile: () => ({ data: null }),
  useKeybinds: () => ({ data: h.file, error: null, write: vi.fn() }),
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: "a-code" }),
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
vi.mock("./components/BindingList", () => ({
  BindingList: ({ keymap }: { keymap: Keymap }) => {
    h.shown = keymap;
    return null;
  },
}));
vi.mock("./components/KeyBindingEditor", () => ({
  KeyBindingEditor: () => null,
}));
vi.mock("./components/KeymapsPanel", () => ({
  KeymapsPanel: () => null,
  applyContainerText: (
    _text: string,
    onApply: (saved: SavedKeymap) => void,
  ) => {
    onApply(LINKED);
    return null;
  },
}));

import KeybindsSection from "./KeybindsSection";

afterEach(cleanup);

function page() {
  return (
    <MemoryRouter>
      <KeybindsSection />
    </MemoryRouter>
  );
}

const actions = () => h.shown?.bindings.map((b) => b.action) ?? [];

describe("KeybindsSection opened from a keymap link", () => {
  it("keeps the linked keymap once the file has loaded", () => {
    h.file = null;
    const { rerender } = render(page());
    expect(actions()).toContain("linkedaction");

    h.file = {
      path: "/data/uikeys.txt",
      exists: true,
      ours: true,
      text: "unbindall\nbind Ctrl+w fileaction\n",
    };
    rerender(page());
    expect(actions()).toContain("linkedaction");
    expect(actions()).not.toContain("fileaction");
  });
});
