// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubAccount } from "../account";

const started = vi.fn();
vi.mock("./run", () => ({
  startManualSend: (...args: unknown[]) => started(...args),
}));

const opened = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => opened(url),
}));

vi.mock("../config", () => ({ useHubUrl: () => "https://hub.test" }));

let account: HubAccount;
vi.mock("../account", () => ({ useHubAccount: () => account }));

vi.mock("../pages/components/AccountControl", () => ({
  SignInButton: ({ onSignIn }: { onSignIn: (p: string) => Promise<void> }) => (
    <button type="button" onClick={() => void onSignIn("discord")}>
      Sign in with Discord
    </button>
  ),
}));

let running: unknown;
vi.mock("../assets/runningUploads", () => ({
  useRunningSendFor: () => running,
}));

import { HubPageButton, HubSendControl } from "./HubSendControl";

function signedOut(): HubAccount {
  return {
    loading: false,
    busy: false,
    signedIn: false,
    unknown: false,
    account: null,
    problem: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    recheck: vi.fn(async () => {}),
  };
}

const PROPS = {
  subject: { kind: "map", map_name: "Tabula 3" } as const,
  label: "Tabula 3",
  enginePath: "/e",
  dataDir: "/d",
};

beforeEach(() => {
  account = signedOut();
  running = undefined;
  started.mockClear();
  opened.mockClear();
});

afterEach(() => cleanup());

describe("the hub control on a detail page", () => {
  it("shows nothing until the hub has answered", () => {
    const { container } = render(
      <HubSendControl {...PROPS} presence={{ state: "unknown" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing when the hub has it, which the page links to instead", () => {
    const { container } = render(
      <HubSendControl
        {...PROPS}
        presence={{ state: "present", url: "https://hub.test/map/tabula-3" }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens the hub page from the page's own button", () => {
    render(
      <HubPageButton
        url="https://hub.test/map/tabula-3"
        label="Show on hub"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show on hub" }));
    expect(opened).toHaveBeenCalledWith("https://hub.test/map/tabula-3");
  });

  it("sends at once for somebody signed in", () => {
    account = { ...signedOut(), signedIn: true };
    render(<HubSendControl {...PROPS} presence={{ state: "missing" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Send to hub" }));
    expect(started).toHaveBeenCalledWith({
      hubUrl: "https://hub.test",
      enginePath: "/e",
      dataDir: "/d",
      subject: PROPS.subject,
      label: "Tabula 3",
    });
  });

  it("asks somebody signed out to sign in, and sends once they have", () => {
    const { rerender } = render(
      <HubSendControl {...PROPS} presence={{ state: "missing" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to hub" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Discord" }),
    );
    expect(account.signIn).toHaveBeenCalledWith("discord");
    expect(started).not.toHaveBeenCalled();

    account = { ...account, signedIn: true };
    act(() => {
      rerender(<HubSendControl {...PROPS} presence={{ state: "missing" }} />);
    });
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the sign in does not land", () => {
    const { rerender } = render(
      <HubSendControl {...PROPS} presence={{ state: "missing" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send to hub" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Discord" }),
    );
    act(() => {
      rerender(<HubSendControl {...PROPS} presence={{ state: "missing" }} />);
    });
    expect(started).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sign in with Discord" }),
    ).toBeTruthy();
  });

  it("shows the send is running, whatever the hub said before", () => {
    running = { opId: "op-1" };
    render(<HubSendControl {...PROPS} presence={{ state: "unknown" }} />);
    const button = screen.getByRole("button", { name: "Sending…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
