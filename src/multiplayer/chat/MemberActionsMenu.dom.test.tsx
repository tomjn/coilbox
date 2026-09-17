// @vitest-environment happy-dom

/**
 * "Ban from server" sends uberserver's `BAN`, which takes a plain number of
 * days (decimals allowed) and has no default reason. This is unlike
 * ChanServ's `:mute`/`:ban`, which take spans like `10m`/`2h`/`3d`. This
 * covers the two ways the old shared duration field broke that: a
 * span-shaped default the server rejects, and a submit with no reason the
 * server also rejects.
 *
 * The popover is stood in for so its contents are always drawn, matching the
 * pattern in relayIndicator.dom.test.tsx.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { MemberActionsMenu } from "./MemberActionsMenu";

const send = vi.fn();

beforeEach(() => {
  send.mockReset();
});

afterEach(() => {
  cleanup();
});

function openBanForm() {
  render(
    <MemberActionsMenu
      nick="bob"
      channel="lobby"
      channelOps={false}
      serverMod={true}
      targetIsOp={false}
      send={send}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ban from server…" }));
}

it("defaults the server ban duration to a plain number of days, not a span", () => {
  openBanForm();
  const days = screen.getByLabelText("Days") as HTMLInputElement;
  expect(days.value).toBe("1");
  expect(days.placeholder).not.toMatch(/[hdm]/);
});

it("sends the days value entered, unchanged, once a reason is given", () => {
  openBanForm();
  fireEvent.change(screen.getByLabelText("Days"), {
    target: { value: "0.5" },
  });
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "cheating" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(send).toHaveBeenCalledWith("BAN bob 0.5 cheating");
});

it("does not submit a server ban with no reason", () => {
  openBanForm();
  fireEvent.change(screen.getByLabelText("Days"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(send).not.toHaveBeenCalled();
  // Still on the form, not closed as if it had sent.
  expect(screen.getByLabelText("Days")).toBeTruthy();
});
