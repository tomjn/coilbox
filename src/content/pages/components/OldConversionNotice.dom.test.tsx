// @vitest-environment happy-dom
/**
 * Issue #4196. A game converted before #4174 draws every face from the wrong
 * part of its sheet, and only the sheet's record says so.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
const undo = vi.fn();

vi.mock("@/notify/notify", () => ({ notify: async () => {} }));

vi.mock("../../bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("../../bindings");
  return {
    ...actual,
    content3doInstallStatus: (args: unknown) => status(args),
    contentUndo3doInstall: (args: unknown) => undo(args),
  };
});

const { OldConversionNotice } = await import("./OldConversionNotice");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function notice(hasOriginals: boolean, gameDir: string | null = "/g/ba.sdd") {
  const onConvert = vi.fn();
  const onRestored = vi.fn();
  render(
    <OldConversionNotice
      gameDir={gameDir}
      hasOriginals={hasOriginals}
      onConvert={onConvert}
      onRestored={onRestored}
    />,
  );
  return { onConvert, onRestored };
}

describe("OldConversionNotice", () => {
  it("says nothing about a game with no old sheet", async () => {
    status.mockResolvedValue({ backups: 0, oldSheets: 0 });
    notice(true);

    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByText(/older coilbox/i)).toBeNull();
  });

  it("does not look in a packed archive", () => {
    notice(true, null);

    expect(status).not.toHaveBeenCalled();
    expect(screen.queryByText(/older coilbox/i)).toBeNull();
  });

  it("offers to convert again while the game still has its .3do files", async () => {
    status.mockResolvedValue({ backups: 0, oldSheets: 1 });
    const { onConvert } = notice(true);

    fireEvent.click(
      await screen.findByRole("button", { name: /convert again/i }),
    );
    expect(onConvert).toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it("restores the originals first when an install moved them aside", async () => {
    status.mockResolvedValue({ backups: 3, oldSheets: 2 });
    undo.mockResolvedValue({ restored: ["objects3d/armcom.3do"] });
    const { onRestored, onConvert } = notice(false);

    fireEvent.click(
      await screen.findByRole("button", { name: /restore originals/i }),
    );

    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(undo).toHaveBeenCalledWith({ gameDir: "/g/ba.sdd" });
    expect(onConvert).not.toHaveBeenCalled();
  });
});
