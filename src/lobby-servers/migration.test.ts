import { describe, expect, it, vi } from "vitest";

// migration.ts imports BUILTIN_SERVERS from config.ts, which pulls in useSetting
// from @picoframe/frame and, transitively via profile.ts, defineCommand from
// @picoframe/plugin-sdk; neither package's dist loads under Vitest's resolver. The
// planner is pure, so stubbing the leaves lets the module load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { LobbyAccount } from "./config";
import {
  type LegacyLobbyServer,
  planBarPortMove,
  planBarTlsRemap,
  planMigration,
} from "./migration";

const row = (p: Partial<LegacyLobbyServer>): LegacyLobbyServer => ({
  id: "row-uuid",
  name: "",
  host: "example.org",
  port: 8200,
  tls: false,
  allowSelfSigned: false,
  ...p,
});

// Deterministic id generator for assertions.
const ids = () => {
  let n = 0;
  return () => `acc-${++n}`;
};

describe("planMigration", () => {
  it("maps a catalog-matched row to a built-in account and re-keys its secret", () => {
    const plan = planMigration(
      {
        servers: [
          row({
            host: "server4.beyondallreason.info",
            port: 8200,
            username: "alice",
          }),
        ],
      },
      ids(),
    );
    // 8200 is where the BAR built-in now lives, upgraded with STLS, so the row
    // lands on it rather than becoming a custom server.
    expect(plan.customServers).toEqual([]);
    expect(plan.accounts).toEqual([
      { id: "acc-1", serverId: "bar-ssl", username: "alice" },
    ]);
    expect(plan.reKey).toEqual([
      {
        from: { serverId: "row-uuid", username: "alice" },
        to: { serverId: "bar-ssl", username: "alice" },
      },
    ]);
  });

  it("keeps an unknown server as custom (reusing its id) with no re-key", () => {
    const plan = planMigration(
      {
        servers: [
          row({
            id: "lan-1",
            host: "10.0.0.5",
            port: 8200,
            name: "LAN",
            username: "bob",
          }),
        ],
      },
      ids(),
    );
    expect(plan.customServers).toEqual([
      {
        id: "lan-1",
        name: "LAN",
        host: "10.0.0.5",
        port: 8200,
        tls: false,
        allowSelfSigned: false,
      },
    ]);
    expect(plan.accounts).toEqual([
      { id: "acc-1", serverId: "lan-1", username: "bob" },
    ]);
    expect(plan.reKey).toEqual([]);
  });

  it("moves a row on BAR's old 8201 port onto the built-in", () => {
    const plan = planMigration(
      {
        servers: [
          row({
            host: "server4.beyondallreason.info",
            port: 8201,
            tls: true,
            username: "carol",
          }),
        ],
      },
      ids(),
    );
    expect(plan.accounts[0].serverId).toBe("bar-ssl");
  });

  it("never matches the Tachyon built-in, keeping such a row custom", () => {
    // The old directory only ever held TASServer connections, so a row on the BAR
    // host and port 443 is a user's own entry, not the Tachyon endpoint.
    const plan = planMigration(
      {
        servers: [
          row({
            id: "odd-1",
            host: "server4.beyondallreason.info",
            port: 443,
            tls: true,
            username: "dave",
          }),
        ],
      },
      ids(),
    );
    expect(plan.customServers[0]).toMatchObject({ id: "odd-1", port: 443 });
    expect(plan.accounts[0].serverId).toBe("odd-1");
    expect(plan.reKey).toEqual([]);
  });

  it("emits a server but no account when the row has no username", () => {
    const plan = planMigration(
      { servers: [row({ id: "lan-2", host: "10.0.0.6" })] },
      ids(),
    );
    expect(plan.customServers).toHaveLength(1);
    expect(plan.accounts).toEqual([]);
    expect(plan.reKey).toEqual([]);
  });

  it("emits nothing for a catalog-matched row with no username", () => {
    const plan = planMigration(
      { servers: [row({ host: "lobby.springrts.com", port: 8200 })] },
      ids(),
    );
    expect(plan).toEqual({ customServers: [], accounts: [], reKey: [] });
  });
});

describe("planBarTlsRemap", () => {
  const acc = (p: Partial<LobbyAccount>): LobbyAccount => ({
    id: "a1",
    serverId: "bar",
    username: "alice",
    ...p,
  });

  it("moves a login onto the SSL entry and re-keys its secret", () => {
    const plan = planBarTlsRemap(
      [acc({ lastUsedAt: 7, hasSecret: true })],
      null,
    );
    expect(plan.changed).toBe(true);
    expect(plan.accounts).toEqual([
      {
        id: "a1",
        serverId: "bar-ssl",
        username: "alice",
        lastUsedAt: 7,
        hasSecret: true,
      },
    ]);
    expect(plan.reKey).toEqual([
      {
        from: { serverId: "bar", username: "alice" },
        to: { serverId: "bar-ssl", username: "alice" },
      },
    ]);
  });

  it("carries the last login across, so auto-connect still fires", () => {
    const plan = planBarTlsRemap([acc({})], {
      serverId: "bar",
      username: "alice",
    });
    expect(plan.lastLogin).toEqual({ serverId: "bar-ssl", username: "alice" });
  });

  it("leaves every other login alone", () => {
    const other = acc({ id: "a2", serverId: "techa", username: "bob" });
    const plan = planBarTlsRemap([acc({}), other], null);
    expect(plan.accounts[1]).toBe(other);
  });

  it("is a no-op when nothing points at the retired entry", () => {
    const accounts = [acc({ serverId: "bar-ssl" })];
    const plan = planBarTlsRemap(accounts, null);
    expect(plan.changed).toBe(false);
    expect(plan.accounts).toBe(accounts);
    expect(plan.reKey).toEqual([]);
  });

  it("absorbs a login that already exists on the SSL entry, keeping its password", () => {
    const kept = acc({ id: "a2", serverId: "bar-ssl", username: "Alice" });
    const plan = planBarTlsRemap([acc({}), kept], null);
    expect(plan.accounts).toEqual([kept]);
    expect(plan.reKey).toEqual([]);
  });
});

describe("planBarPortMove", () => {
  const acct = (p: Partial<LobbyAccount>): LobbyAccount => ({
    id: "a",
    serverId: "bar-ssl",
    username: "AF_",
    ...p,
  });

  it("moves each BAR login's server key from 8201 to 8200", () => {
    expect(
      planBarPortMove([acct({}), acct({ id: "b", username: "bob" })]),
    ).toEqual([
      {
        oldKey: "AF_@server4.beyondallreason.info:8201",
        newKey: "AF_@server4.beyondallreason.info:8200",
      },
      {
        oldKey: "bob@server4.beyondallreason.info:8201",
        newKey: "bob@server4.beyondallreason.info:8200",
      },
    ]);
  });

  it("leaves logins on other servers, and nameless ones, alone", () => {
    expect(
      planBarPortMove([
        acct({ serverId: "techa" }),
        acct({ serverId: "bar-tachyon" }),
        acct({ username: "" }),
      ]),
    ).toEqual([]);
  });
});
