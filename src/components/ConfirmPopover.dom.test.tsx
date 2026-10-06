// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmPopover } from "./ConfirmPopover";

afterEach(cleanup);

function renderIt(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmPopover
      triggerProps={{ "aria-label": "Delete thing" }}
      heading="Delete thing?"
      description="Its progress is lost."
      confirmLabel="Delete for good"
      busyLabel="Deleting…"
      onConfirm={onConfirm}
    >
      x
    </ConfirmPopover>,
  );
}

describe("ConfirmPopover", () => {
  it("does nothing on the first click, and says what is lost", () => {
    const onConfirm = vi.fn();
    renderIt(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Delete thing" }));
    expect(screen.getByText("Delete thing?")).toBeTruthy();
    expect(screen.getByText("Its progress is lost.")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the confirming button apart from the trigger", () => {
    renderIt(vi.fn());
    const trigger = screen.getByRole("button", { name: "Delete thing" });
    fireEvent.click(trigger);
    const confirm = screen.getByRole("button", { name: "Delete for good" });
    expect(confirm).not.toBe(trigger);
    expect(trigger.contains(confirm)).toBe(false);
  });

  it("does nothing when cancelled", async () => {
    const onConfirm = vi.fn();
    renderIt(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Delete thing" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Delete thing?")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("acts once when confirmed, then closes", async () => {
    const onConfirm = vi.fn();
    renderIt(onConfirm);
    fireEvent.click(screen.getByRole("button", { name: "Delete thing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(screen.queryByText("Delete thing?")).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
