// @vitest-environment happy-dom
/**
 * The BOS → Lua page around the converter, which Rust tests on its own. What
 * is left here: a script loaded from disk is converted with its path so its
 * includes come with it, the path is shown as code, the Lua is a read-only
 * view rather than a second text box, find searches the BOS, and warnings sit
 * behind a counted button rather than under the code.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { animBos2lua, animBosRead, open } = vi.hoisted(() => ({
  animBos2lua: vi.fn(async () => ({
    lua: 'local base = piece("base")\nfunction script.Create()\nend',
    warnings: ["first difference", "second difference"],
    linearScale: 65536,
    cobVars: "-- cob_vars" as string | null,
    missingIncludes: [] as string[],
  })),
  animBosRead: vi.fn(async () => ({ source: "piece base;\nCreate() { }\n" })),
  open: vi.fn(async () => "/games/THIS.sdd/scripts/carrier.bos"),
}));

vi.mock("../bindings", () => ({ animBos2lua, animBosRead }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import Bos2LuaPage from "./Bos2LuaPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function loadCarrier() {
  render(<Bos2LuaPage />);
  fireEvent.click(screen.getByRole("button", { name: /Load \.bos/ }));
  await screen.findByRole("region", { name: "Converted Lua" });
}

describe("the BOS to Lua page", () => {
  it("converts a loaded script with its path and shows the path as code", async () => {
    await loadCarrier();
    expect(animBos2lua).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/games/THIS.sdd/scripts/carrier.bos",
        name: "carrier.bos",
      }),
    );
    const path = screen.getByText("/games/THIS.sdd/scripts/carrier.bos");
    expect(path.tagName).toBe("CODE");
  });

  it("leaves out unused code until the box is unticked, then converts again", async () => {
    await loadCarrier();
    expect(animBos2lua).toHaveBeenLastCalledWith(
      expect.objectContaining({ prune: true }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Leave out unused code/ }),
    );
    await waitFor(() =>
      expect(animBos2lua).toHaveBeenLastCalledWith(
        expect.objectContaining({ prune: false }),
      ),
    );
  });

  it("shows the Lua as a read-only view, not a text box", async () => {
    await loadCarrier();
    // The BOS, and nothing for the Lua.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByPlaceholderText(/Converted Lua/)).toBeNull();
  });

  it("puts warnings behind a counted button that opens a drawer", async () => {
    await loadCarrier();
    expect(screen.queryByText("first difference")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 warnings/ }));
    await waitFor(() =>
      expect(screen.getByText("first difference")).toBeTruthy(),
    );
    expect(screen.getByText("second difference")).toBeTruthy();
  });

  it("finds in the BOS from Cmd+F and marks each match", async () => {
    await loadCarrier();
    // Only an icon until asked for.
    expect(
      screen.queryByRole("textbox", { name: "Find in the BOS" }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const find = await screen.findByRole("textbox", {
      name: "Find in the BOS",
    });
    expect(document.activeElement).toBe(find);
    fireEvent.change(find, { target: { value: "base" } });
    await screen.findByText("1 of 1");
    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("base");
  });

  it("opens find from its icon and closes it again on Escape", async () => {
    await loadCarrier();
    fireEvent.click(screen.getByRole("button", { name: /Find in the BOS/ }));
    const find = await screen.findByRole("textbox", {
      name: "Find in the BOS",
    });
    fireEvent.change(find, { target: { value: "base" } });
    fireEvent.keyDown(find, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "Find in the BOS" }),
    ).toBeNull();
    expect(document.querySelectorAll("mark")).toHaveLength(0);
  });

  it("numbers the BOS lines", async () => {
    await loadCarrier();
    const box = screen.getByRole("textbox");
    const gutter = box.closest("div.flex")?.firstElementChild;
    expect(gutter?.textContent).toBe("123");
  });

  it("offers cob_vars.lua from the header rather than under the code", async () => {
    await loadCarrier();
    expect(screen.queryByText(/VFS\.Include/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cob_vars\.lua/ }));
    await screen.findByText(/VFS\.Include/);
    expect(screen.getByRole("button", { name: /Copy file/ })).toBeTruthy();
  });
});
