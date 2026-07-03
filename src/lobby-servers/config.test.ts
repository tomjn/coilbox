import { describe, expect, it, vi } from "vitest";

// config.ts imports useSetting from @picoframe/frame, whose published dist uses
// extensionless relative imports that Vitest's node resolver won't load from
// node_modules. These tests only exercise the pure helpers, so stubbing the leaf
// package is enough to let the module load.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));

import {
  allServers,
  BUILTIN_SERVERS,
  type LobbyServer,
  resolveServer,
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
    const all = allServers([custom]);
    expect(all).toHaveLength(BUILTIN_SERVERS.length + 1);
    expect(all.slice(0, BUILTIN_SERVERS.length).every((s) => s.builtin)).toBe(
      true,
    );
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
