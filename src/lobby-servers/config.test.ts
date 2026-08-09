import { describe, expect, it, vi } from "vitest";

// config.ts imports useSetting from @picoframe/frame and, transitively via
// profile.ts, defineCommand from @picoframe/plugin-sdk — both published dists use
// extensionless relative imports that Vitest's node resolver won't load from
// node_modules. These tests only exercise the pure helpers, so stubbing the leaves
// is enough to let the module load. `allServers` reads the profile singleton, which
// stays the empty `{ version: 1 }` here (loadProfile is never called), so its output
// is the vanilla catalog.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { ProfileLobby } from "../profile/profile";
import {
  allServers,
  autoConnectTarget,
  BUILTIN_SERVERS,
  buildCatalog,
  type CustomServersConfig,
  isLastLogin,
  type LobbyAccount,
  type LobbyServer,
  OFFICIAL_ID,
  resolveProfileServerRules,
  resolveServer,
  serverOfferable,
  serverProtocol,
  sortAccountsByRecency,
} from "./config";

const custom: LobbyServer = {
  id: "custom-1",
  name: "LAN",
  host: "192.168.1.10",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
};

describe("allServers", () => {
  it("puts built-ins first, tagged builtin, then custom servers", () => {
    const offered = BUILTIN_SERVERS.filter(serverOfferable);
    const all = allServers([custom]);
    expect(all).toHaveLength(offered.length + 1);
    expect(all.slice(0, offered.length).every((s) => s.builtin)).toBe(true);
    expect(all[all.length - 1]).toMatchObject({ id: "custom-1" });
  });

  it("does not mutate BUILTIN_SERVERS with the builtin flag", () => {
    allServers([]);
    expect(BUILTIN_SERVERS.every((s) => s.builtin === undefined)).toBe(true);
  });
});

describe("resolveServer", () => {
  it("finds a built-in by id", () => {
    expect(resolveServer("bar-ssl", [])?.port).toBe(8201);
  });
  it("finds a custom server by id", () => {
    expect(resolveServer("custom-1", [custom])?.host).toBe("192.168.1.10");
  });
  it("returns undefined for an unknown id", () => {
    expect(resolveServer("nope", [custom])).toBeUndefined();
  });
});

describe("serverProtocol", () => {
  it("reads a server stored before the field existed as tasserver", () => {
    // Exactly the JSON a pre-Tachyon build wrote under `lobbyServers.servers`.
    const stored: LobbyServer = JSON.parse(
      '{"id":"lan-1","name":"LAN","host":"10.0.0.5","port":8200,"tls":false,"allowSelfSigned":false}',
    );
    expect(stored.protocol).toBeUndefined();
    expect(serverProtocol(stored)).toBe("tasserver");
  });

  it("reads every TASServer built-in as tasserver", () => {
    const tas = BUILTIN_SERVERS.filter((s) => s.id !== "bar-tachyon");
    expect(tas.map(serverProtocol)).toEqual(tas.map(() => "tasserver"));
  });

  it("reads an explicit tachyon value back", () => {
    expect(serverProtocol({ protocol: "tachyon" })).toBe("tachyon");
  });

  it("survives a round trip through the stored custom-server settings", () => {
    const saved: CustomServersConfig = {
      servers: [{ ...custom, id: "custom-tachyon", protocol: "tachyon" }],
    };
    const loaded: CustomServersConfig = JSON.parse(JSON.stringify(saved));
    expect(serverProtocol(loaded.servers[0])).toBe("tachyon");
  });
});

// Temporary scaffolding, see serverOfferable in config.ts. Issue #1224 lands the
// Tachyon connection, deletes the filter, and these cases go with it.
describe("the Tachyon built-in, defined but not offered", () => {
  it("is in the built-in list with the Tachyon shape", () => {
    expect(BUILTIN_SERVERS.find((s) => s.id === "bar-tachyon")).toMatchObject({
      host: "server4.beyondallreason.info",
      port: 443,
      tls: true,
      protocol: "tachyon",
    });
  });

  it("is kept out of the catalog, so no user can select it", () => {
    expect(allServers([]).some((s) => s.id === "bar-tachyon")).toBe(false);
    expect(resolveServer("bar-tachyon", [])).toBeUndefined();
  });

  it("stays out when a profile preset names it", () => {
    const out = buildCatalog([], { presets: ["bar", "bar-tachyon"] });
    expect(out.map((s) => s.id)).toEqual(["bar"]);
  });

  it("stays out when a profile promotes it as the official server", () => {
    const rules = resolveProfileServerRules({ official: "bar-tachyon" });
    // The promotion still carries the protocol. Only the catalog hides it.
    expect(rules.official).toMatchObject({ protocol: "tachyon" });
    const out = buildCatalog([], rules);
    expect(out.some((s) => s.id === "bar-tachyon")).toBe(false);
  });

  it("hides a hand-written custom Tachyon server too", () => {
    const tachyonCustom: LobbyServer = {
      ...custom,
      id: "custom-tachyon",
      protocol: "tachyon",
    };
    expect(allServers([tachyonCustom, custom]).map((s) => s.id)).not.toContain(
      "custom-tachyon",
    );
  });
});

describe("resolveProfileServerRules", () => {
  it("returns empty rules when there's no lobby block", () => {
    expect(resolveProfileServerRules(undefined)).toEqual({});
  });

  it("promotes a built-in by id, flagged official", () => {
    const { official } = resolveProfileServerRules({
      official: "recoil-official",
    });
    expect(official).toMatchObject({ id: "recoil-official", official: true });
  });

  it("ignores an unknown built-in id", () => {
    expect(
      resolveProfileServerRules({ official: "nope" }).official,
    ).toBeUndefined();
  });

  it("builds an inline server with defaulted ports/flags", () => {
    const { official } = resolveProfileServerRules({
      official: { host: "lobby.example.org" },
    });
    expect(official).toEqual({
      id: OFFICIAL_ID,
      name: "lobby.example.org",
      host: "lobby.example.org",
      port: 8200,
      tls: false,
      allowSelfSigned: false,
      official: true,
    });
  });

  it("honours explicit inline fields", () => {
    const lobby: ProfileLobby = {
      official: {
        name: "Scary",
        host: "s.host",
        port: 9000,
        tls: true,
        allowSelfSigned: true,
      },
    };
    expect(resolveProfileServerRules(lobby).official).toMatchObject({
      name: "Scary",
      port: 9000,
      tls: true,
      allowSelfSigned: true,
    });
  });

  it("ignores an object official with no host", () => {
    expect(
      resolveProfileServerRules({ official: {} as never }).official,
    ).toBeUndefined();
  });

  it("gives an inline official server the default protocol", () => {
    // The profile schema has no protocol key, so an inline server is TASServer.
    // A profile wanting Tachyon promotes the `bar-tachyon` built-in by id.
    const { official } = resolveProfileServerRules({
      official: { host: "lobby.example.org" },
    });
    expect(official && serverProtocol(official)).toBe("tasserver");
  });

  it("passes the preset allow-list through", () => {
    expect(resolveProfileServerRules({ presets: ["bar"] }).presets).toEqual([
      "bar",
    ]);
  });
});

describe("buildCatalog", () => {
  it("puts the official server first and marks it non-removable", () => {
    const rules = resolveProfileServerRules({ official: { host: "off.host" } });
    const out = buildCatalog([], rules);
    expect(out[0]).toMatchObject({
      id: OFFICIAL_ID,
      official: true,
      builtin: true,
    });
  });

  it("hides every stock preset when presets is empty, keeping the official one", () => {
    const rules = resolveProfileServerRules({
      official: { host: "off.host" },
      presets: [],
    });
    const out = buildCatalog([custom], rules);
    expect(out.map((s) => s.id)).toEqual([OFFICIAL_ID, "custom-1"]);
  });

  it("narrows built-ins to the allow-list", () => {
    const out = buildCatalog([], { presets: ["bar", "techa"] });
    expect(out.map((s) => s.id)).toEqual(["techa", "bar"]);
  });

  it("keeps the protocol on the entries it does offer", () => {
    const out = buildCatalog([], { presets: ["bar", "techa"] });
    expect(out.map(serverProtocol)).toEqual(["tasserver", "tasserver"]);
  });

  it("does not list a promoted built-in twice", () => {
    const rules = resolveProfileServerRules({ official: "recoil-official" });
    const out = buildCatalog([], rules);
    expect(out.filter((s) => s.id === "recoil-official")).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "recoil-official", official: true });
  });
});

describe("autoConnectTarget", () => {
  const account: LobbyAccount = {
    id: "acc-1",
    serverId: "bar",
    username: "player",
  };
  const servers = allServers([]);
  const lastLogin = { serverId: "bar", username: "player" };

  it("returns the account + server when enabled and the last login resolves", () => {
    const t = autoConnectTarget(true, lastLogin, [account], servers);
    expect(t?.account).toBe(account);
    expect(t?.server.id).toBe("bar");
  });

  it("returns null when auto-connect is off", () => {
    expect(autoConnectTarget(false, lastLogin, [account], servers)).toBeNull();
  });

  it("returns null when there is no last login", () => {
    expect(autoConnectTarget(true, null, [account], servers)).toBeNull();
  });

  it("returns null when the account no longer exists", () => {
    expect(autoConnectTarget(true, lastLogin, [], servers)).toBeNull();
  });

  it("returns null when the profile catalog disallows the server", () => {
    // The account/last-login name `bar`, but the profile-filtered catalog only
    // offers `techa`, so the disallowed server never resolves and never connects.
    const narrowed = buildCatalog([], { presets: ["techa"] });
    expect(autoConnectTarget(true, lastLogin, [account], narrowed)).toBeNull();
  });
});

describe("sortAccountsByRecency", () => {
  const acc = (id: string, extra?: Partial<LobbyAccount>): LobbyAccount => ({
    id,
    serverId: id,
    username: "player",
    ...extra,
  });

  it("orders by lastUsedAt, newest first, never-used last", () => {
    const a = acc("a", { lastUsedAt: 100 });
    const b = acc("b", { lastUsedAt: 300 });
    const c = acc("c");
    expect(sortAccountsByRecency([a, b, c], null).map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("ranks the last login first even without a timestamp (pre-flag login)", () => {
    const a = acc("a", { lastUsedAt: 100 });
    const b = acc("b");
    const sorted = sortAccountsByRecency([a, b], {
      serverId: "b",
      username: "player",
    });
    expect(sorted.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("keeps saved order for ties and does not mutate the input", () => {
    const list = [acc("a"), acc("b"), acc("c")];
    const sorted = sortAccountsByRecency(list, null);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(sorted).not.toBe(list);
  });
});

describe("isLastLogin", () => {
  const account: LobbyAccount = {
    id: "acc-1",
    serverId: "bar",
    username: "player",
  };
  it("matches on serverId + username, not account id", () => {
    expect(isLastLogin(account, { serverId: "bar", username: "player" })).toBe(
      true,
    );
    expect(isLastLogin(account, { serverId: "bar", username: "other" })).toBe(
      false,
    );
    expect(isLastLogin(account, null)).toBe(false);
  });
});
