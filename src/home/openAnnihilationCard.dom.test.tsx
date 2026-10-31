// @vitest-environment happy-dom

/**
 * The Open Annihilation welcome card (issue #4945), drawn where the home page
 * draws it: in the Multiplayer group of the tool grid.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const MAC_OA = {
  path: "/Applications/Open Annihilation.app/Contents/MacOS/open-annihilation",
  version: "Open Annihilation 0.8.9 (macos-universal arm64, 9eb18ad4)",
};

const bindings = vi.hoisted(() => ({ playOaLaunch: vi.fn() }));
vi.mock("../play/bindings", () => bindings);

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

// The real Channel needs the Tauri bridge, which a test has no window for.
const channels = vi.hoisted(() => ({ made: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    constructor() {
      channels.made += 1;
    }
  },
}));

const state = vi.hoisted(() => ({
  program: null as { path: string; version: string } | null,
  matcher: null as ((name: string) => boolean) | null,
}));
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (_key: string, initial: unknown) => [
    state.program ?? initial,
    () => {},
  ],
  useFrame: () => ({
    nav: [
      {
        id: "multiplayer",
        label: "Multiplayer",
        items: [
          { id: "multiplayer.battles", label: "Battles", to: "/battles" },
        ],
      },
    ],
  }),
  useTheme: () => ({ resolved: "dark", accent: "default" }),
}));
vi.mock("../profile/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../profile/profile")>()),
  getGameMatcher: () => state.matcher,
}));

import ToolCards from "./zones/ToolCards";

/** What a Rust `UiError` looks like once it reaches a rejected promise. */
const refusal = (text: string) =>
  new Error(JSON.stringify({ code: "oa.refused", params: {}, fallback: text }));

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <ToolCards />
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  state.program = null;
  state.matcher = null;
  channels.made = 0;
  bindings.playOaLaunch.mockReset().mockResolvedValue({});
  opener.openUrl.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("starts Open Annihilation on its main menu when the program is set", async () => {
  state.program = MAC_OA;
  show();
  fireEvent.click(
    screen.getByRole("button", { name: /play open annihilation/i }),
  );
  await waitFor(() => expect(bindings.playOaLaunch).toHaveBeenCalledOnce());
  const call = bindings.playOaLaunch.mock.calls[0][0];
  expect(call.executable).toBe(MAC_OA.path);
  expect(call.args).toEqual(["--skip-intro"]);
  expect(call.runId).toEqual(expect.any(String));
  expect(opener.openUrl).not.toHaveBeenCalled();
});

it("gives each launch its own channel and run id", async () => {
  state.program = MAC_OA;
  show();
  const card = screen.getByRole("button", { name: /play open annihilation/i });
  fireEvent.click(card);
  fireEvent.click(card);
  await waitFor(() => expect(bindings.playOaLaunch).toHaveBeenCalledTimes(2));
  const [first, second] = bindings.playOaLaunch.mock.calls.map((c) => c[0]);
  expect(channels.made).toBe(2);
  expect(first.onEvent).not.toBe(second.onEvent);
  expect(first.runId).not.toBe(second.runId);
});

it("opens Core Prime in the browser when no program is set", async () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: /get open annihilation/i }),
  );
  await waitFor(() =>
    expect(opener.openUrl).toHaveBeenCalledWith("https://play.coreprime.net"),
  );
  expect(bindings.playOaLaunch).not.toHaveBeenCalled();
});

it("shows the message when the launch is refused, and clears it on the next press", async () => {
  state.program = MAC_OA;
  bindings.playOaLaunch.mockRejectedValueOnce(
    refusal("Open Annihilation is already running."),
  );
  show();
  const card = screen.getByRole("button", { name: /play open annihilation/i });
  fireEvent.click(card);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Open Annihilation is already running.");

  fireEvent.click(card);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(bindings.playOaLaunch).toHaveBeenCalledTimes(2);
});

it("is hidden by a profile narrowed to a game", () => {
  state.program = MAC_OA;
  state.matcher = (name) => name === "Splinter Faction";
  show();
  expect(screen.getByText("Battles")).toBeTruthy();
  expect(screen.queryByText(/open annihilation/i)).toBeNull();
});

it("sits in the Multiplayer group with the other cards", () => {
  show();
  const group = screen.getByRole("heading", { name: "Multiplayer" })
    .parentElement?.parentElement as HTMLElement;
  expect(group.textContent).toContain("Battles");
  expect(group.textContent).toContain("Get Open Annihilation");
});
