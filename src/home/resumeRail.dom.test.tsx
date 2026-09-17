// @vitest-environment happy-dom

/**
 * The combined multi-login card's click (issue #2936).
 *
 * `resumeRail.test.ts` renders the rail with `renderToStaticMarkup`, which
 * never runs a click, so it can only check the markup an `onClick` card
 * produces. This file drives a real click through Testing Library, so the
 * button the rail actually draws is proven to call the multiplayer store's
 * `reconnectAll` with every remembered login, rather than only the `RailCard`
 * the pure helpers build for it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyAccount, LobbyServer } from "../lobby-servers/config";
import type { ResumeCandidate } from "./continue";

// Same stubs `resumeRail.test.ts` uses, and for the same reasons: node/happy-dom
// cannot load @picoframe/frame's published dist, and the collector is replaced
// so this file is free to say only what the rail itself does with what it
// returns.
vi.mock("@picoframe/frame", () => ({ useSetting: () => [{}, () => {}] }));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

/** Kept in step with the real `serverKeyFor` (store.tsx), same as `resumeRail.test.ts`. */
function fakeServerKeyFor(server: LobbyServer, username: string): string {
  return `${username}@${server.host}:${server.port}`;
}

const reconnectAll =
  vi.fn<
    (targets: { account: LobbyAccount; server: LobbyServer }[]) => Promise<void>
  >();
vi.mock("../multiplayer/store", () => ({
  useMultiplayer: () => ({
    connections: {},
    busyKeys: new Set<string>(),
    reconnectAll,
  }),
  serverKeyFor: fakeServerKeyFor,
}));

const accounts = vi.fn<() => LobbyAccount[]>();
const servers = vi.fn<() => LobbyServer[]>();
vi.mock("../lobby-servers/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lobby-servers/config")>()),
  useLobbyAccounts: () => [{ accounts: accounts() }, () => {}],
  useLastLogin: () => [null, () => {}],
  useCustomServers: () => [{ servers: [] }, () => {}],
  allServers: () => servers(),
}));

import ResumeRail from "./zones/ResumeRail";

const BAR: LobbyServer = {
  id: "bar",
  name: "Beyond All Reason",
  host: "server4.beyondallreason.info",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};
const TECHA: LobbyServer = { ...BAR, id: "techa", name: "Tech Annihilation" };

function account(
  id: string,
  username: string,
  over: Partial<LobbyAccount> = {},
) {
  return { id, serverId: "bar", username, ...over };
}

function draw() {
  return render(
    <MemoryRouter>
      <ResumeRail />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [], loading: false });
  reconnectAll.mockClear();
  reconnectAll.mockResolvedValue(undefined);
  accounts.mockReturnValue([]);
  servers.mockReturnValue([BAR, TECHA]);
});

afterEach(cleanup);

describe("the combined login card", () => {
  it("reconnects every remembered login when clicked, rather than navigating", () => {
    const first = account("a1", "First", { openAtQuit: true });
    const second = account("a2", "Second", {
      serverId: "techa",
      openAtQuit: true,
    });
    accounts.mockReturnValue([first, second]);

    draw();

    const card = screen.getByRole("button", { name: /First and 1 other/ });
    fireEvent.click(card);

    expect(reconnectAll).toHaveBeenCalledTimes(1);
    const [targets] = reconnectAll.mock.calls[0];
    expect(targets.map((t) => t.account.username)).toEqual(["First", "Second"]);
  });

  it("stays a link to /lobby with only one remembered login", () => {
    accounts.mockReturnValue([account("a1", "AF_")]);

    draw();

    expect(screen.queryByRole("button", { name: /Log in/ })).toBeNull();
    const link = screen.getByRole("link", { name: /Log in/ });
    expect(link.getAttribute("href")).toBe("/lobby");
    fireEvent.click(link);
    expect(reconnectAll).not.toHaveBeenCalled();
  });
});
