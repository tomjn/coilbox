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

import { type LegacyLobbyServer, planMigration } from "./migration";

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
    expect(plan.customServers).toEqual([]);
    expect(plan.accounts).toEqual([
      { id: "acc-1", serverId: "bar", username: "alice" },
    ]);
    expect(plan.reKey).toEqual([
      {
        from: { serverId: "row-uuid", username: "alice" },
        to: { serverId: "bar", username: "alice" },
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

  it("matches BAR SSL by port 8201", () => {
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
