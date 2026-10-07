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
const onLookUp = vi.fn();

beforeEach(() => {
  send.mockReset();
  onLookUp.mockReset();
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
      onLookUp={onLookUp}
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

it("offers to look up the member in Server admin, gated on serverMod", () => {
  render(
    <MemberActionsMenu
      nick="bob"
      channel="lobby"
      channelOps={false}
      serverMod={true}
      targetIsOp={false}
      send={send}
      onLookUp={onLookUp}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Look up in Server admin" }),
  );
  expect(onLookUp).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});

it("does not offer the Server admin look-up to a channel op who is not a server mod", () => {
  render(
    <MemberActionsMenu
      nick="bob"
      channel="lobby"
      channelOps={true}
      serverMod={false}
      targetIsOp={false}
      send={send}
      onLookUp={onLookUp}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Look up in Server admin" }),
  ).toBeNull();
});

// The personal actions everybody gets (issue #3695).

function personalMenu(over: { text?: string; ignored?: boolean } = {}) {
  const onSave = vi.fn();
  const onToggle = vi.fn();
  render(
    <MemberActionsMenu
      nick="bob"
      channel="lobby"
      channelOps={false}
      serverMod={false}
      targetIsOp={false}
      send={send}
      onLookUp={onLookUp}
      note={{ text: over.text ?? "", onSave }}
      ignore={{ ignored: over.ignored ?? false, onToggle }}
    />,
  );
  return { onSave, onToggle };
}

it("offers a note and ignore with no moderation actions beside them", () => {
  personalMenu();
  expect(screen.getByRole("button", { name: "Add private note" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ignore" })).toBeTruthy();
  expect(screen.queryByText("Moderator")).toBeNull();
  expect(screen.queryByText("Channel")).toBeNull();
});

it("saves a note from the menu", () => {
  const { onSave } = personalMenu();
  fireEvent.click(screen.getByRole("button", { name: "Add private note" }));
  fireEvent.change(screen.getByLabelText("Note for bob"), {
    target: { value: "good teammate" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith("good teammate");
});

it("says on the trigger that a member has a note", () => {
  personalMenu({ text: "good teammate" });
  expect(
    screen.getByRole("button", { name: "Actions for bob, who has a note" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Edit private note" }),
  ).toBeTruthy();
});

it("toggles ignore, and offers to undo it for somebody ignored", () => {
  const { onToggle } = personalMenu({ ignored: true });
  fireEvent.click(screen.getByRole("button", { name: "Unignore" }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
