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

// `AccountPicker` composes `OptionSelect`, a Radix `Select`, and is exercised
// on its own. Here it's swapped for plain buttons so a test can pick an
// account with a click rather than driving a listbox.
vi.mock("../../multiplayer/AccountPicker", () => ({
  AccountPicker: ({
    keys,
    onChange,
  }: {
    keys: string[];
    value: string;
    onChange: (key: string) => void;
  }) => (
    <div>
      {keys.map((key) => (
        <button key={key} type="button" onClick={() => onChange(key)}>
          pick {key}
        </button>
      ))}
    </div>
  ),
}));

const mp = vi.hoisted(() => ({
  getUserInfo: vi.fn(),
  changePassword: vi.fn(),
  changeEmailRequest: vi.fn(async () => {}),
  changeEmail: vi.fn(async () => {}),
  resendVerification: vi.fn(async () => {}),
  openLoginPopover: vi.fn(),
}));

type Protocol = "tasserver" | "tachyon" | "zerok";

interface ConnEntry {
  serverKey: string;
  live: boolean;
  mirror: { state: { myUsername: string } | null };
  accountInfo: {
    registrationDate: string | null;
    email: string | null;
    ingameHours: string | null;
  } | null;
}

const SERVER = {
  id: "bar-ssl",
  name: "BAR",
  host: "bar.example",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

function keyFor(username: string) {
  return `${username}@${SERVER.host}:${SERVER.port}`;
}

function connectionFor(
  username: string,
  accountEmail: string | null | undefined,
): ConnEntry {
  const key = keyFor(username);
  return {
    serverKey: key,
    live: true,
    mirror: { state: { myUsername: username } },
    accountInfo:
      accountEmail == null
        ? null
        : { registrationDate: null, email: accountEmail, ingameHours: null },
  };
}

let connections: Record<string, ConnEntry> = {};
let activeKey: string | null = null;
let servers: (typeof SERVER & { protocol?: Protocol })[] = [];

vi.mock("../../multiplayer/store", () => ({
  useMultiplayer: () => ({
    connections,
    activeKey,
    getUserInfo: mp.getUserInfo,
    changePassword: mp.changePassword,
    changeEmailRequest: mp.changeEmailRequest,
    changeEmail: mp.changeEmail,
    resendVerification: mp.resendVerification,
    openLoginPopover: mp.openLoginPopover,
  }),
  useConnection: (key: string | null) =>
    key ? (connections[key] ?? null) : null,
  useProtocolServers: () => servers,
  liveConnectionKeys: (
    conns: Record<string, ConnEntry>,
    focusKey: string | null,
  ) => {
    const keys = Object.keys(conns).filter((k) => conns[k].live);
    if (focusKey == null || !keys.includes(focusKey)) return keys;
    return [focusKey, ...keys.filter((k) => k !== focusKey)];
  },
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
  connections = {};
  activeKey = null;
  servers = [];
});

afterEach(() => {
  cleanup();
});

function renderPage({
  connected,
  protocol = "tasserver",
  myUsername,
  changePasswordResult,
  accountEmail,
}: {
  connected: boolean;
  protocol?: Protocol;
  myUsername: string | null;
  changePasswordResult?: { message: string; succeeded: boolean };
  accountEmail?: string | null;
}) {
  if (changePasswordResult) {
    mp.changePassword.mockResolvedValue(changePasswordResult);
  }
  servers = [{ ...SERVER, protocol }];
  if (connected && myUsername) {
    const key = keyFor(myUsername);
    connections = { [key]: connectionFor(myUsername, accountEmail) };
    activeKey = key;
    lastLogin = { serverId: SERVER.id, username: myUsername };
  } else {
    connections = {};
    activeKey = null;
  }
  render(<AccountSettings />);
  return { lsStoreCredential };
}

/** Two live tasserver connections, `alice` focused. */
function renderTwoAccounts() {
  servers = [{ ...SERVER, protocol: "tasserver" }];
  connections = {
    [keyFor("alice")]: connectionFor("alice", "alice@example.com"),
    [keyFor("bob")]: connectionFor("bob", "bob@example.com"),
  };
  activeKey = keyFor("alice");
  render(<AccountSettings />);
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
  expect(mp.changeEmailRequest).toHaveBeenCalledWith(
    "new@example.com",
    keyFor("alice"),
  );

  typeInto(screen.getByLabelText("Verification code"), "12345678");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mp.changeEmail).toHaveBeenCalledWith(
      "new@example.com",
      "12345678",
      keyFor("alice"),
    ),
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
    expect(mp.resendVerification).toHaveBeenCalledWith(
      "alice@example.com",
      keyFor("alice"),
    ),
  );
});

/**
 * `changeEmailRequest` now rejects with the server's reason on a refusal
 * (e.g. the address is already registered to somebody else) instead of
 * resolving as soon as the command reached the wire. The form must stay on
 * the email step and show that reason rather than asking for a code that
 * will never arrive.
 */
it("stays on the email step and shows the reason when the server refuses the request", async () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  mp.changeEmailRequest.mockRejectedValueOnce(new Error("already registered"));
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  typeInto(screen.getByLabelText("New email address"), "new@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  expect(await screen.findByText(/already registered/)).toBeTruthy();
  expect(screen.queryByLabelText("Verification code")).toBeNull();
});

/**
 * A refused code must not be shown as a completed change: the server's
 * reason belongs on the code step, and the drawer must not advance to "Email
 * address changed."
 */
it("shows the reason and does not claim the address changed when the server refuses the code", async () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  mp.changeEmail.mockRejectedValueOnce(new Error("bad code"));
  fireEvent.click(screen.getByRole("button", { name: "Change email" }));
  typeInto(screen.getByLabelText("New email address"), "new@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  typeInto(await screen.findByLabelText("Verification code"), "00000000");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/bad code/)).toBeTruthy();
  expect(screen.queryByText(/Email address changed/)).toBeNull();
});

/**
 * A refused resend must not tell the user an email is on its way when the
 * server said otherwise.
 */
it("does not say the verification email was sent when the server refuses the resend", async () => {
  renderPage({
    connected: true,
    protocol: "tasserver",
    myUsername: "alice",
    accountEmail: "alice@example.com",
  });
  mp.resendVerification.mockRejectedValueOnce(new Error("verification is off"));
  fireEvent.click(
    screen.getByRole("button", { name: "Resend verification email" }),
  );
  expect(await screen.findByText(/verification is off/)).toBeTruthy();
  expect(screen.queryByText(/Verification email sent/)).toBeNull();
});

/**
 * With two connections a picker is needed to say which one every action
 * below acts on (issue #2846). With one, there is nothing to pick.
 */
it("does not show an account picker with a single connection", () => {
  renderPage({ connected: true, protocol: "tasserver", myUsername: "alice" });
  expect(screen.queryByText(/^pick /)).toBeNull();
});

it("shows an account picker when more than one connection is live", () => {
  renderTwoAccounts();
  expect(screen.getByText(`pick ${keyFor("alice")}`)).toBeTruthy();
  expect(screen.getByText(`pick ${keyFor("bob")}`)).toBeTruthy();
});

it("shows the focused account's details until another is picked", () => {
  renderTwoAccounts();
  expect(screen.getByText("alice")).toBeTruthy();
  expect(screen.getByText("alice@example.com")).toBeTruthy();
});

it("shows the picked account's details once a different one is chosen", () => {
  renderTwoAccounts();
  fireEvent.click(screen.getByText(`pick ${keyFor("bob")}`));
  expect(screen.getByText("bob")).toBeTruthy();
  expect(screen.getByText("bob@example.com")).toBeTruthy();
  expect(screen.queryByText("alice@example.com")).toBeNull();
});

it("changes the password on the picked account, not the focused one", async () => {
  renderTwoAccounts();
  mp.changePassword.mockResolvedValue({
    message: "Password changed successfully.",
    succeeded: true,
  });
  fireEvent.click(screen.getByText(`pick ${keyFor("bob")}`));
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  typeInto(screen.getByLabelText("Current password"), "old");
  typeInto(screen.getByLabelText("New password"), "new");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mp.changePassword).toHaveBeenCalledWith("old", "new", keyFor("bob")),
  );
});

it("resends verification for the picked account, not the focused one", async () => {
  renderTwoAccounts();
  fireEvent.click(screen.getByText(`pick ${keyFor("bob")}`));
  fireEvent.click(
    screen.getByRole("button", { name: "Resend verification email" }),
  );
  await waitFor(() =>
    expect(mp.resendVerification).toHaveBeenCalledWith(
      "bob@example.com",
      keyFor("bob"),
    ),
  );
});

it("requests account details for the picked account once it is chosen", () => {
  renderTwoAccounts();
  mp.getUserInfo.mockClear();
  fireEvent.click(screen.getByText(`pick ${keyFor("bob")}`));
  expect(mp.getUserInfo).toHaveBeenCalledWith(keyFor("bob"));
});
