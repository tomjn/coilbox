import { describe, expect, it, vi } from "vitest";

// protocol.ts imports the server catalog from lobby-servers/config, which pulls in
// useSetting from @picoframe/frame and, via profile.ts, defineCommand from
// @picoframe/plugin-sdk. Both published dists use extensionless relative imports
// that Vitest's node resolver won't load from node_modules, and nothing here calls
// either, so stubbing the leaves is enough to let the module load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { BUILTIN_SERVERS, type LobbyServer } from "../lobby-servers/config";
import { protocolForKey, syncsOnReady } from "./protocol";

/** A built-in server by id, failing loudly if the catalog entry is renamed. */
function builtin(id: string): LobbyServer {
  const server = BUILTIN_SERVERS.find((s) => s.id === id);
  if (!server) throw new Error(`no built-in server with id ${id}`);
  return server;
}

const bar = builtin("bar");
const tachyon = builtin("bar-tachyon");

describe("protocolForKey", () => {
  it("reads a Tachyon connection off its server key", () => {
    const key = `player@${tachyon.host}:${tachyon.port}`;
    expect(protocolForKey(key, BUILTIN_SERVERS)).toBe("tachyon");
  });

  it("reads a TASServer connection off its server key", () => {
    const key = `player@${bar.host}:${bar.port}`;
    expect(protocolForKey(key, BUILTIN_SERVERS)).toBe("tasserver");
  });

  it("tells the two Beyond All Reason endpoints apart by port", () => {
    // The same host runs both protocols, so the port is the whole discriminator.
    expect(bar.host).toBe(tachyon.host);
    expect(protocolForKey(`p@${bar.host}:8200`, BUILTIN_SERVERS)).toBe(
      "tasserver",
    );
    expect(protocolForKey(`p@${bar.host}:8201`, BUILTIN_SERVERS)).toBe(
      "tasserver",
    );
    expect(protocolForKey(`p@${bar.host}:443`, BUILTIN_SERVERS)).toBe(
      "tachyon",
    );
  });

  it("is not confused by a username that ends in a host and port", () => {
    const key = `me@evil.example:8200@${tachyon.host}:${tachyon.port}`;
    expect(protocolForKey(key, BUILTIN_SERVERS)).toBe("tachyon");
  });

  it("reads no connection as tasserver", () => {
    expect(protocolForKey(null, BUILTIN_SERVERS)).toBe("tasserver");
  });

  it("reads a key with no configured server as tasserver", () => {
    expect(protocolForKey("player@nowhere.example:8200", [])).toBe("tasserver");
  });

  it("honours a custom server's protocol", () => {
    const custom: LobbyServer = {
      id: "mine",
      name: "Mine",
      host: "lobby.example",
      port: 443,
      tls: true,
      allowSelfSigned: false,
      protocol: "tachyon",
    };
    expect(protocolForKey("player@lobby.example:443", [custom])).toBe(
      "tachyon",
    );
  });
});

describe("syncsOnReady", () => {
  it("sends the ready-time commands on TASServer", () => {
    expect(syncsOnReady("tasserver")).toBe(true);
  });

  it("sends none of them on Tachyon", () => {
    expect(syncsOnReady("tachyon")).toBe(false);
  });

  it("skips the ready-time sync for a live Tachyon connection", () => {
    const key = `player@${tachyon.host}:${tachyon.port}`;
    expect(syncsOnReady(protocolForKey(key, BUILTIN_SERVERS))).toBe(false);
  });
});
