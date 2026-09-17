// @vitest-environment happy-dom

/**
 * `useMpServerAdmin`, the Server admin nav item's `useVisible` and the
 * page's `NavGate` predicate (issue #2772). It is true only while a live
 * lobby login (not a room) is uberserver, that connection's own account has
 * the `access` status bit, and the distribution profile has not hidden
 * `multiplayer.admin`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbyServer } from "../lobby-servers/config";
import type { LobbyState } from "./bindings";

let hidden = false;
vi.mock("../profile/hidden", () => ({
  isProfileHidden: (id: string) => hidden && id === "multiplayer.admin",
}));

const servers: LobbyServer[] = [
  {
    id: "uber",
    name: "Uberserver",
    host: "uber.example",
    port: 8200,
    tls: false,
    allowSelfSigned: false,
    protocol: "tasserver",
  },
  {
    id: "tei",
    name: "Teiserver",
    host: "tei.example",
    port: 8201,
    tls: true,
    allowSelfSigned: false,
    protocol: "tasserver",
  },
];

let connections: Record<
  string,
  {
    serverKey: string;
    live: boolean;
    direct: boolean;
    mirror: { state: LobbyState | null };
  }
> = {};
let activeKey: string | null = null;

vi.mock("./store", () => ({
  useMultiplayer: () => ({ connections, activeKey }),
  useProtocolServers: () => servers,
}));

import { useMpServerAdmin } from "./navPredicates";

function state(compflags: string[], me: string, access: boolean): LobbyState {
  return {
    myUsername: me,
    compflags,
    users: {
      [me]: {
        name: me,
        country: "",
        userId: "1",
        agent: "",
        status: { ingame: false, away: false, rank: 0, access, bot: false },
        rating: {},
      },
    },
  } as unknown as LobbyState;
}

function connection(
  serverKey: string,
  over: { live?: boolean; direct?: boolean; state?: LobbyState | null } = {},
) {
  return {
    serverKey,
    live: over.live ?? true,
    direct: over.direct ?? false,
    mirror: { state: over.state ?? null },
  };
}

function Harness() {
  return <>{useMpServerAdmin() ? "visible" : "hidden"}</>;
}

afterEach(() => {
  cleanup();
  connections = {};
  activeKey = null;
  hidden = false;
});

describe("useMpServerAdmin", () => {
  it("is visible for a moderator on uberserver", () => {
    connections = {
      "mod@uber.example:8200": connection("mod@uber.example:8200", {
        state: state(["u", "sp", "b"], "mod", true),
      }),
    };
    render(<Harness />);
    expect(screen.getByText("visible")).toBeTruthy();
  });

  it("is hidden for a normal account on uberserver", () => {
    connections = {
      "p@uber.example:8200": connection("p@uber.example:8200", {
        state: state(["u", "sp", "b"], "p", false),
      }),
    };
    render(<Harness />);
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("is hidden for a moderator-flagged account on Teiserver", () => {
    connections = {
      "mod@tei.example:8201": connection("mod@tei.example:8201", {
        state: state(["sp", "teiserver"], "mod", true),
      }),
    };
    render(<Harness />);
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("is hidden with no connection", () => {
    connections = {};
    render(<Harness />);
    expect(screen.getByText("hidden")).toBeTruthy();
  });

  it("is hidden when the profile hides multiplayer.admin, even for a qualifying moderator", () => {
    hidden = true;
    connections = {
      "mod@uber.example:8200": connection("mod@uber.example:8200", {
        state: state(["u", "sp", "b"], "mod", true),
      }),
    };
    render(<Harness />);
    expect(screen.getByText("hidden")).toBeTruthy();
  });
});
