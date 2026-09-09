// @vitest-environment happy-dom

/**
 * The three ends of recovery, which differ by server rather than by anything the
 * user did. uberserver takes a code and finishes by emailing a new password.
 * teiserver has no in-lobby recovery at all and hands back its own web page.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LobbyServer } from "./config";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const mp = vi.hoisted(() => ({
  recoverPassword: vi.fn(),
  submitRecoveryCode: vi.fn(),
  cancelRecovery: vi.fn(async () => {}),
}));
vi.mock("../multiplayer/store", () => ({
  useMultiplayer: () => ({
    recoverPassword: mp.recoverPassword,
    submitRecoveryCode: mp.submitRecoveryCode,
    cancelRecovery: mp.cancelRecovery,
    busy: false,
  }),
}));

import type { RecoveryStart } from "../multiplayer/store";
import { PasswordRecoveryForm } from "./PasswordRecoveryForm";

const DEFAULT_SERVERS: LobbyServer[] = [
  {
    id: "u",
    name: "Uber",
    host: "h",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
  },
];

beforeEach(() => {
  mp.recoverPassword.mockReset();
  mp.submitRecoveryCode.mockReset();
  mp.cancelRecovery.mockReset();
  mp.cancelRecovery.mockResolvedValue(undefined);
  openUrl.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderForm({
  servers = DEFAULT_SERVERS,
  start,
  submit,
}: {
  servers?: LobbyServer[];
  start?: RecoveryStart;
  submit?: { username: string };
} = {}) {
  if (start) mp.recoverPassword.mockResolvedValue(start);
  if (submit) mp.submitRecoveryCode.mockResolvedValue(submit);
  return render(
    <PasswordRecoveryForm
      servers={servers}
      onSignIn={() => {}}
      onCancel={() => {}}
    />,
  );
}

/** Type into a labelled field via `fireEvent`, since `@testing-library/user-event`
 * is not a dependency of this repo (other dom tests use `fireEvent` throughout). */
function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

it("asks for the code when the server sent one", async () => {
  renderForm({ start: { kind: "codeSent", serverKey: "k" } });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByLabelText("Code")).toBeTruthy();
});

it("offers the server's own page when it has no in-lobby recovery", async () => {
  renderForm({
    start: { kind: "redirected", url: "https://example.test/reset" },
  });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByText("https://example.test/reset")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(openUrl).toHaveBeenCalledWith("https://example.test/reset");
});

/**
 * The username is the point of this screen. A user who has forgotten their
 * password usually cannot name their account either, and this is the only moment
 * the protocol tells them.
 */
it("shows the username the server returned", async () => {
  renderForm({
    start: { kind: "codeSent", serverKey: "k" },
    submit: { username: "alice" },
  });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  typeInto(await screen.findByLabelText("Code"), "12345678");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText("alice")).toBeTruthy();
});

it("does not offer servers whose protocol has no recovery", () => {
  renderForm({
    servers: [
      {
        id: "u",
        name: "Uber",
        host: "h",
        port: 8200,
        tls: false,
        allowSelfSigned: false,
      },
      {
        id: "z",
        name: "Zero-K",
        host: "h",
        port: 8200,
        tls: false,
        allowSelfSigned: false,
        protocol: "zerok",
      },
    ],
  });
  // A regex, not an exact match: the label appends " (custom)" for a
  // non-builtin server, and an exact "Zero-K" would never match that suffix
  // even if the filtering broke and the option rendered anyway.
  expect(screen.queryByText(/Zero-K/)).toBeNull();
});

/**
 * uberserver allows three attempts at the code before it locks the request, so a
 * wrong one must not throw the user back to the email step or hide the reason.
 */
it("keeps the code field open and shows the reason after a refused code", async () => {
  mp.submitRecoveryCode
    .mockRejectedValueOnce(new Error("Wrong code entered too many times"))
    .mockResolvedValueOnce({ username: "alice" });
  renderForm({ start: { kind: "codeSent", serverKey: "k" } });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));

  const codeField = await screen.findByLabelText("Code");
  typeInto(codeField, "000000");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

  expect(
    await screen.findByText("Error: Wrong code entered too many times"),
  ).toBeTruthy();
  // Still on the code step, not bounced back to email.
  expect(screen.getByLabelText("Code")).toBeTruthy();
  expect(mp.cancelRecovery).not.toHaveBeenCalled();

  // A retry on the same connection succeeds.
  typeInto(screen.getByLabelText("Code"), "111111");
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText("alice")).toBeTruthy();
});

it("closes the parked connection when the user cancels from the code step", async () => {
  renderForm({ start: { kind: "codeSent", serverKey: "k" } });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("Code");

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mp.cancelRecovery).toHaveBeenCalledWith("k");
});

it("closes an abandoned connection left open when the form unmounts", async () => {
  const { unmount } = renderForm({
    start: { kind: "codeSent", serverKey: "k" },
  });
  typeInto(screen.getByLabelText("Email"), "a@b.c");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("Code");

  unmount();
  expect(mp.cancelRecovery).toHaveBeenCalledWith("k");
});

it("does not cancel a connection that was never parked awaiting a code", () => {
  const { unmount } = renderForm();
  // Never got past the email step, so no connection was ever parked.
  unmount();
  expect(mp.cancelRecovery).not.toHaveBeenCalled();
});
