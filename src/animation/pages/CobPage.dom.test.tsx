// @vitest-environment happy-dom

/**
 * The COB tools page: the three readings of one file, and finding it still
 * there after going somewhere else.
 *
 * The page used to hold the file in component state, so any navigation threw
 * it away and left somebody who had changed nothing looking at an empty page,
 * having to open the same file again.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EMPTY_COB_SESSION, updateCobSession } from "../cobSession";
import CobPage from "./CobPage";

const picked = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => picked(),
  save: vi.fn(),
  ask: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(vi.fn()),
  }),
}));
vi.mock("../bindings", () => ({
  animCobDisasm: () =>
    Promise.resolve({ listing: "0000  RETURN", lineOffsets: [0] }),
  animCobDecompile: () =>
    Promise.resolve({
      source: "Create()\n{\n\treturn (0);\n}\n",
      warnings: [],
    }),
  animCobHex: () =>
    Promise.resolve({ dump: "00000000  04 00  |..|", bytes: 2 }),
  animBos2cob: vi.fn(),
  animBosRead: vi.fn(),
  animBosLint: vi.fn(),
}));

afterEach(() => {
  cleanup();
  updateCobSession(EMPTY_COB_SESSION);
  vi.clearAllMocks();
});

/** Open a `.cob` through the button, as somebody using the page would. */
async function openCob() {
  picked.mockResolvedValue("/tmp/armcom.cob");
  render(<CobPage />);
  fireEvent.click(screen.getByRole("button", { name: /Open \.cob/ }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "BOS" })).toBeTruthy(),
  );
}

it("shows the rebuilt source, the bytes and the opcodes of one file", async () => {
  await openCob();
  // The rebuilt source is what a compiled file opens on.
  expect(screen.getByDisplayValue(/return \(0\);/)).toBeTruthy();

  // Radix tabs switch on mouse down, not on a synthetic click.
  fireEvent.mouseDown(screen.getByRole("tab", { name: "COB" }));
  await waitFor(() => expect(screen.getByDisplayValue(/04 00/)).toBeTruthy());

  fireEvent.mouseDown(screen.getByRole("tab", { name: "Opcodes" }));
  await waitFor(() => expect(screen.getByDisplayValue(/RETURN/)).toBeTruthy());
});

it("still has the file after leaving the page and coming back", async () => {
  await openCob();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Opcodes" }));
  await waitFor(() => expect(screen.getByDisplayValue(/RETURN/)).toBeTruthy());

  // Navigating away unmounts the route, and nothing re-opens the file.
  cleanup();
  picked.mockReset();
  render(<CobPage />);

  expect(screen.getByDisplayValue(/RETURN/)).toBeTruthy();
  expect(picked).not.toHaveBeenCalled();
});
