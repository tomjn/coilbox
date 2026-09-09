// @vitest-environment happy-dom

/**
 * The page has three states because the account it manages may not be there.
 * A settings page that is blank most of the time is worse than one that says
 * what it would manage and offers to connect.
 *
 * `@testing-library/user-event` is not a dependency of this repo (see
 * `../../lobby-servers/passwordRecoveryForm.dom.test.tsx`), so this drives the
 * form with `fireEvent` and waits on the resulting DOM change instead.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LastLogin } from "../../lobby-servers/config";

const lsStoreCredential = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("../../lobby-servers/bindings", () => ({ lsStoreCredential }));

const mp = vi.hoisted(() => ({
  getUserInfo: vi.fn(),
  changePassword: vi.fn(),
  changeEmailRequest: vi.fn(async () => {}),
  changeEmail: vi.fn(async () => {}),
  resendVerification: vi.fn(async () => {}),
  openLoginPopover: vi.fn(),
}));

interface MultiplayerMockState {
  connected: boolean;
  protocol: "tasserver" | "tachyon" | "zerok";
  myUsername: string | null;
  changePasswordResult?: { message: string; succeeded: boolean };
  accountEmail?: string | null;
}

let current: MultiplayerMockState = {
  connected: false,
  protocol: "tasserver",
  myUsername: null,
};

vi.mock("../../multiplayer/store", () => ({
  useMultiplayer: () => ({
    connected: current.connected,
    protocol: current.protocol,
    mirror: {
      state: current.myUsername ? { myUsername: current.myUsername } : null,
    },
    accountInfo:
      current.accountEmail == null
        ? null
        : {
            registrationDate: null,
            email: current.accountEmail,
            ingameHours: null,
          },
    getUserInfo: mp.getUserInfo,
    changePassword: mp.changePassword,
    changeEmailRequest: mp.changeEmailRequest,
    changeEmail: mp.changeEmail,
    resendVerification: mp.resendVerification,
    openLoginPopover: mp.openLoginPopover,
  }),
}));

let lastLogin: LastLogin | null = null;
vi.mock("../../lobby-servers/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lobby-servers/config")>();
  return {
    ...actual,
    useLastLogin: () => [lastLogin, vi.fn()],
  };
});

import AccountSettings from "./SettingsSection";

beforeEach(() => {
  mp.getUserInfo.mockClear();
  mp.changePassword.mockReset();
  mp.changeEmailRequest.mockClear();
  mp.changeEmail.mockClear();
  mp.resendVerification.mockClear();
  mp.openLoginPopover.mockClear();
  lsStoreCredential.mockClear();
  lastLogin = null;
});

afterEach(() => {
  cleanup();
});

function renderPage({
  connected,
  protocol,
  myUsername,
  changePasswordResult,
  accountEmail,
}: MultiplayerMockState) {
  current = {
    connected,
    protocol,
    myUsername,
    changePasswordResult,
    accountEmail,
  };
  if (changePasswordResult) {
    mp.changePassword.mockResolvedValue(changePasswordResult);
  }
  if (connected && protocol === "tasserver" && myUsername) {
    lastLogin = { serverId: "bar-ssl", username: myUsername };
  }
  render(<AccountSettings />);
  return { lsStoreCredential };
}

function typeInto(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

it("shows the account controls when signed in to a TASServer server", () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  expect(screen.getByRole("button", { name: "Change password" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Change email" })).toBeTruthy();
});

it("offers nothing to change on a server whose protocol has no account commands", () => {
  renderPage({ connected: true, protocol: "zerok", myUsername: "alice" });
  expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
  expect(screen.getByText(/on the server's own site/i)).toBeTruthy();
});

it("offers to connect rather than showing an empty page", () => {
  renderPage({ connected: false, protocol: "tasserver", myUsername: null });
  expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
});

it("requests account details once on mount when signed in to a TASServer server", () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  expect(mp.getUserInfo).toHaveBeenCalledTimes(1);
});

it("does not request account details on a protocol with no account commands", () => {
  renderPage({ connected: true, protocol: "zerok", myUsername: "alice" });
  expect(mp.getUserInfo).not.toHaveBeenCalled();
});

/**
 * A stale saved password can be retyped. One overwritten on a change that did
 * not happen locks the user out of their own saved login.
 */
it("only saves the new password when the server said it changed", async () => {
  const { lsStoreCredential } = renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    changePasswordResult: {
      message: "New password must be different to current password.",
      succeeded: false,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/must be different/)).toBeTruthy();
  expect(lsStoreCredential).not.toHaveBeenCalled();
});

it("saves the new password when the server said it changed", async () => {
  const { lsStoreCredential } = renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    changePasswordResult: {
      message: "Password changed successfully.",
      succeeded: true,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(lsStoreCredential).toHaveBeenCalled());
});

it("stores the changed password under the signed-in login's own server id", async () => {
  renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    changePasswordResult: {
      message: "Password changed successfully.",
      succeeded: true,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(lsStoreCredential).toHaveBeenCalledWith({
      serverId: "bar-ssl",
      username: "alice",
      secret: "new",
    }),
  );
});

/**
 * The server-side password really did change here. Losing that message and
 * reporting a plain failure would send the user to retry a change that
 * already happened. But the saved copy is now actively wrong rather than
 * merely stale, so the user still needs telling.
 */
it("tells the user their saved password is stale when the server confirmed the change but the keychain write fails", async () => {
  const { lsStoreCredential } = renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    changePasswordResult: {
      message: "Password changed successfully.",
      succeeded: true,
    },
  });
  lsStoreCredential.mockRejectedValueOnce(new Error("keychain locked"));
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/could not save it/)).toBeTruthy();
  // The server's own success message still shows: the change genuinely
  // happened, so this must not read as a failed attempt.
  expect(screen.getByText(/changed successfully/)).toBeTruthy();
});

/**
 * `changePassword` rejects outright (rather than resolving with
 * `succeeded: false`) when one is already pending. That is a different code
 * path to a refusal, and only a refusal was covered before this test.
 */
it("does not save a password change that was rejected as already in progress", async () => {
  const { lsStoreCredential } = renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
  });
  mp.changePassword.mockRejectedValueOnce(
    new Error("A password change is already in progress."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/already in progress/)).toBeTruthy();
  expect(lsStoreCredential).not.toHaveBeenCalled();
});

it("requests a code then submits it to change the email address", async () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  typeInto(screen.getByLabelText("New email address"), "new@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByLabelText("Verification code")).toBeTruthy();
  expect(mp.changeEmailRequest).toHaveBeenCalledWith("new@example.com");

  typeInto(screen.getByLabelText("Verification code"), "12345678");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mp.changeEmail).toHaveBeenCalledWith("new@example.com", "12345678"),
  );
});

it("disables resending verification until an email address is known", () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  const button = screen.getByRole("button", {
    name: "Resend verification email",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

it("resends verification to the known email address", async () => {
  renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    accountEmail: "alice@example.com",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Resend verification email" }),
  );
  await waitFor(() =>
    expect(mp.resendVerification).toHaveBeenCalledWith("alice@example.com"),
  );
});
