// @vitest-environment happy-dom

/**
 * The hub page inside the real wizard shell. The Tauri commands under the hub
 * account store are stubbed, so `signInToHub` runs for real but never opens a
 * browser.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeError } from "@/i18n/uiError";

const hubAccount = vi.fn();
const hubSignIn = vi.fn();
vi.mock("@/hub/auth", () => ({
  hubAccount: (args: { hubUrl: string }) => hubAccount(args),
  hubSignIn: (args: { hubUrl: string }) => hubSignIn(args),
  hubSignOut: async () => {},
}));

const { forgetHubAccounts } = await import("@/hub/account");
const { Wizard } = await import("../Wizard");

const onSettle = vi.fn();

function show() {
  return render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <Wizard
          pages={["hub", "done"]}
          newPagesRun={false}
          onSettle={onSettle}
          onClose={() => {}}
          downloads={[]}
          onCancelDownload={() => {}}
          onRetryDownload={() => {}}
        />
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const signInButton = () =>
  screen.getByRole("button", { name: "Sign in with Discord" });

beforeEach(() => {
  forgetHubAccounts();
  hubAccount.mockReset();
  hubSignIn.mockReset();
  onSettle.mockReset();
  hubAccount.mockResolvedValue({
    signedIn: false,
    account: null,
    problem: null,
  });
});

afterEach(() => {
  cleanup();
});

it("signs in when Sign in with Discord is pressed", async () => {
  hubSignIn.mockReturnValue(new Promise(() => {}));
  show();
  fireEvent.click(signInButton());
  expect(hubSignIn).toHaveBeenCalledTimes(1);
  const busy = await screen.findByRole("button", {
    name: "Waiting for your browser",
  });
  expect(busy.hasAttribute("disabled")).toBe(true);
  fireEvent.click(busy);
  expect(hubSignIn).toHaveBeenCalledTimes(1);
});

it("moves on after a successful sign in", async () => {
  hubSignIn.mockResolvedValue({
    account: { id: "1", name: "Someone", avatarUrl: null },
    problem: null,
  });
  show();
  fireEvent.click(signInButton());
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith("hub"));
  expect(screen.getByText("You're ready")).toBeTruthy();
});

it("shows a failed sign in and stays on the page", async () => {
  const error = new Error("The sign in was cancelled in the browser");
  hubSignIn.mockRejectedValue(error);
  show();
  fireEvent.click(signInButton());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(describeError(error));
  expect(onSettle).not.toHaveBeenCalled();
  expect(screen.getByText("Sign in to the hub")).toBeTruthy();
  expect(signInButton().hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onSettle).toHaveBeenCalledWith("hub");
});
