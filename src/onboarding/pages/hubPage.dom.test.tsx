// @vitest-environment happy-dom

/**
 * The hub page inside the real wizard shell. The Tauri commands under the hub
 * account store are stubbed, so `signInToHub` runs for real but never opens a
 * browser. The profile names its own hub, and the external opener is stubbed,
 * so a test can see which address Open the hub hands the browser.
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
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeError } from "@/i18n/uiError";

const hubAccount = vi.fn();
const hubSignIn = vi.fn();
vi.mock("@/hub/auth", () => ({
  hubAccount: (args: { hubUrl: string }) => hubAccount(args),
  hubProviders: async () => ({ providers: ["discord", "github", "twitch"] }),
  hubSignIn: (args: { hubUrl: string; provider: string }) => hubSignIn(args),
  hubSignOut: async () => {},
}));

const HUB = "https://hub.example";
vi.mock("@/profile/profile", async (original) => ({
  ...(await original<typeof import("@/profile/profile")>()),
  getProfile: () => ({ version: 1, hubUrl: HUB }),
}));

const openExternal = vi.fn();
vi.mock("@/home/navItem", async (original) => ({
  ...(await original<typeof import("@/home/navItem")>()),
  openExternal: (href: string) => openExternal(href),
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

/** A provider's button, behind the Sign in button that opens the panel. */
async function signInButton(name = "Discord") {
  const listed = screen.queryByRole("button", { name: `Sign in with ${name}` });
  if (listed) return listed;
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  return screen.findByRole("button", { name: `Sign in with ${name}` });
}

beforeEach(() => {
  forgetHubAccounts();
  hubAccount.mockReset();
  hubSignIn.mockReset();
  onSettle.mockReset();
  openExternal.mockReset();
  hubAccount.mockResolvedValue({
    signedIn: false,
    account: null,
    problem: null,
  });
});

afterEach(() => {
  cleanup();
});

it("signs in with the provider whose button is pressed", async () => {
  hubSignIn.mockReturnValue(new Promise(() => {}));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  await screen.findByRole("button", { name: "Sign in with Discord" });
  await screen.findByRole("button", { name: "Sign in with Twitch" });
  fireEvent.click(await signInButton("GitHub"));
  expect(hubSignIn).toHaveBeenCalledTimes(1);
  expect(hubSignIn).toHaveBeenCalledWith({ hubUrl: HUB, provider: "github" });
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
  fireEvent.click(await signInButton());
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith("hub"));
  expect(screen.getByText("You're ready")).toBeTruthy();
});

it("shows a failed sign in and stays on the page", async () => {
  const error = new Error("The sign in was cancelled in the browser");
  hubSignIn.mockRejectedValue(error);
  show();
  fireEvent.click(await signInButton());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(describeError(error));
  expect(onSettle).not.toHaveBeenCalled();
  expect(screen.getByText("Sign in to the hub")).toBeTruthy();
  expect((await signInButton()).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onSettle).toHaveBeenCalledWith("hub");
});

it("does not show a problem from the account check on open", async () => {
  hubAccount.mockRejectedValue(new Error("The keychain did not answer"));
  show();
  await waitFor(() => expect(hubAccount).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("stays on the page when a sign in fails while already signed in", async () => {
  hubAccount.mockResolvedValue({
    signedIn: true,
    account: { id: "1", name: "Someone", avatarUrl: null },
    problem: null,
  });
  const error = new Error("The sign in was cancelled in the browser");
  hubSignIn.mockRejectedValue(error);
  show();
  await waitFor(() => expect(hubAccount).toHaveBeenCalled());
  fireEvent.click(await signInButton());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(describeError(error));
  expect(onSettle).not.toHaveBeenCalled();
  expect(screen.getByText("Sign in to the hub")).toBeTruthy();
});

it("paints the hub drawing behind the page", () => {
  show();
  const art = screen.getByTestId("page-art");
  expect(art.getAttribute("data-art")).toBe("hub.browse");
  expect(art.getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
});

it("holds the title and the buttons in one column", async () => {
  show();
  const column = screen.getByTestId("hub-column");
  const title = within(column).getByRole("heading", {
    name: "Sign in to the hub",
  });
  expect(
    screen.getByRole("dialog", { name: "Sign in to the hub" }),
  ).toBeTruthy();
  expect(title.id).toBeTruthy();
  await within(column).findByRole("button", { name: "Sign in" });
  within(column).getByRole("button", { name: "Open the hub" });
});

it("opens the profile's hub in the browser without moving on", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Open the hub" }));
  expect(openExternal).toHaveBeenCalledWith(HUB);
  expect(hubSignIn).not.toHaveBeenCalled();
  expect(onSettle).not.toHaveBeenCalled();
  expect(screen.getByText("Sign in to the hub")).toBeTruthy();
});
