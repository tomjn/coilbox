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
import {
  autoJoinsChannels,
  founderRunsTheGame,
  messageLimit,
  protocolForKey,
  publishesStatus,
  seatIsServerAssigned,
  syncsOnReady,
} from "./protocol";

/** A built-in server by id, failing loudly if the catalog entry is renamed. */
function builtin(id: string): LobbyServer {
  const server = BUILTIN_SERVERS.find((s) => s.id === id);
  if (!server) throw new Error(`no built-in server with id ${id}`);
  return server;
}

const bar = builtin("bar-ssl");
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

describe("messageLimit", () => {
  it("caps a Tachyon message at what the schema allows", () => {
    expect(messageLimit("tachyon")).toBe(512);
  });

  it("sets no limit on TASServer, which publishes none", () => {
    expect(messageLimit("tasserver")).toBeNull();
  });
});

describe("Zero-K", () => {
  const zerok = builtin("zero-k");

  it("reads a Zero-K connection off its server key", () => {
    const key = `player@${zerok.host}:${zerok.port}`;
    expect(protocolForKey(key, BUILTIN_SERVERS)).toBe("zerok");
  });

  it("is not mistaken for TASServer by its port", () => {
    // Zero-K listens on 8200, the number TASServer conventionally uses, so the
    // host is what tells them apart.
    expect(zerok.port).toBe(8200);
    expect(protocolForKey(`p@lobby.springrts.com:8200`, BUILTIN_SERVERS)).toBe(
      "tasserver",
    );
  });

  it("asks for neither list, because it is sent both unasked", () => {
    expect(syncsOnReady("zerok")).toBe(false);
  });

  it("still rejoins the channels the account is configured for", () => {
    // The server force-joins its own defaults and nothing else, so a channel
    // somebody added themselves is silent after a reconnect without this.
    expect(autoJoinsChannels("zerok")).toBe(true);
  });

  it("still publishes an away and ingame status of its own", () => {
    // The one part of the ready-time sync Zero-K does want. The server pushes
    // the channels and the lists, but only the client knows it is away.
    expect(publishesStatus("zerok")).toBe(true);
  });

  it("sets no message limit, because none is published", () => {
    expect(messageLimit("zerok")).toBeNull();
  });
});

describe("autoJoinsChannels", () => {
  it("is true on TASServer and false on Tachyon, which has no channels", () => {
    expect(autoJoinsChannels("tasserver")).toBe(true);
    expect(autoJoinsChannels("tachyon")).toBe(false);
  });
});

describe("seatIsServerAssigned", () => {
  it("is false on TASServer, where the client picks all of it", () => {
    expect(seatIsServerAssigned("tasserver")).toBe(false);
  });

  it("is true on Tachyon and Zero-K, which carry no colour or faction", () => {
    expect(seatIsServerAssigned("tachyon")).toBe(true);
    expect(seatIsServerAssigned("zerok")).toBe(true);
  });
});

describe("founderRunsTheGame", () => {
  it("is true on TASServer, where a host advertises their own port", () => {
    expect(founderRunsTheGame("tasserver")).toBe(true);
  });

  it("is false on Zero-K, where founding a room runs nothing here", () => {
    expect(founderRunsTheGame("zerok")).toBe(false);
    expect(founderRunsTheGame("tachyon")).toBe(false);
  });
});

describe("publishesStatus", () => {
  it("is true on TASServer, which packs it into MYSTATUS", () => {
    expect(publishesStatus("tasserver")).toBe(true);
  });

  it("is false on Tachyon, which carries readiness per lobby instead", () => {
    expect(publishesStatus("tachyon")).toBe(false);
  });
});
